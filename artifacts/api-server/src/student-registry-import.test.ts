import assert from "node:assert/strict";
import test from "node:test";
import { academicSessions, enrollments, schoolMetadata, students } from "@workspace/db";
import { db } from "./db";
import { storage } from "./storage";
import {
  persistStudentImportCandidates,
  prepareStudentImportCandidates,
  StudentImportIssueCollector,
  type StudentImportCandidate,
} from "./student-registry-import";
import { summarizeWebDailyPresence } from "./web-daily-presence";

const placementMetadata = [
  { metaKey: "classes", metaValue: JSON.stringify(["5", "6"]) },
  { metaKey: "sections", metaValue: JSON.stringify(["A", "B"]) },
  { metaKey: "class_sections", metaValue: JSON.stringify({ "5": ["A"], "6": ["B"] }) },
];

function candidate(rowNumber: number, overrides: Partial<StudentImportCandidate> = {}): StudentImportCandidate {
  return {
    rowNumber,
    name: `Student ${rowNumber}`,
    className: "5",
    sectionName: "A",
    phone: `987654${String(rowNumber).padStart(4, "0")}`,
    dob: "2008-04-02",
    email: `student${rowNumber}@example.test`,
    rollNumber: rowNumber,
    ...overrides,
  };
}

function validRawRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    name: "Student One",
    class: "5",
    section: "A",
    phone: "9876543210",
    dob: "2008-04-02",
    email: "student.one@example.test",
    rollnumber: "1",
    ...overrides,
  };
}

function replace(target: any, key: string, value: unknown): () => void {
  const hadOwn = Object.prototype.hasOwnProperty.call(target, key);
  const original = target[key];
  target[key] = value;
  return () => {
    if (hadOwn) target[key] = original;
    else delete target[key];
  };
}

function fakeTransaction(
  options: {
    sessions?: Array<{ id: number }>;
    metadata?: Array<{ metaKey: string; metaValue: string }>;
    failEnrollment?: Error & { code?: string };
  } = {},
) {
  const state = {
    committedStudents: [] as any[],
    committedEnrollments: [] as any[],
    attemptedTables: [] as string[],
    transactionCalls: 0,
  };
  let nextStudentId = 1000;
  const restore = replace(db as any, "transaction", async (work: (tx: any) => Promise<unknown>) => {
    state.transactionCalls += 1;
    const stagedStudents: any[] = [];
    const stagedEnrollments: any[] = [];
    const tx: any = {
      select: () => {
        let table: unknown;
        const query: any = {
          from(value: unknown) { table = value; return query; },
          where() { return query; },
          limit() { return query; },
          for() { return query; },
          then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
            const rows = table === academicSessions
              ? (options.sessions ?? [{ id: 101 }])
              : table === schoolMetadata
                ? (options.metadata ?? placementMetadata)
                : [];
            return Promise.resolve(rows).then(resolve, reject);
          },
        };
        return query;
      },
      insert: (table: unknown) => {
        let values: any[] = [];
        const query: any = {
          values(input: any) {
            values = Array.isArray(input) ? input : [input];
            state.attemptedTables.push(table === students ? "students" : table === enrollments ? "enrollments" : "other");
            return query;
          },
          returning() {
            if (table !== students) return Promise.resolve([]);
            const returned = values.map(value => ({ id: nextStudentId++, ...value }));
            stagedStudents.push(...returned);
            return Promise.resolve(returned);
          },
          then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
            if (table === enrollments) {
              if (options.failEnrollment) return Promise.reject(options.failEnrollment).then(resolve, reject);
              stagedEnrollments.push(...values);
            }
            return Promise.resolve([]).then(resolve, reject);
          },
        };
        return query;
      },
    };
    const result = await work(tx);
    state.committedStudents.push(...stagedStudents);
    state.committedEnrollments.push(...stagedEnrollments);
    return result;
  });
  return { state, restore };
}

test("valid multi-row import sends matching profile and active-session enrollment data", async () => {
  const rows = [
    candidate(2, { className: "5", sectionName: "A", rollNumber: 1 }),
    candidate(3, { className: "6", sectionName: "B", rollNumber: 2 }),
  ];
  const storedProfiles: any[] = [];
  const storedEnrollments: any[] = [];
  let nextSerial = 40;
  const issues = new StudentImportIssueCollector();
  const result = await persistStudentImportCandidates(
    rows,
    { schoolId: 7, schoolCode: "SCH7", sessionId: 101 },
    issues,
    {
      allocateSerials: async count => Array.from({ length: count }, () => ++nextSerial),
      hashPassword: async password => `bcrypt:${password}`,
      findExistingDsids: async () => new Set(),
      insertBatch: async (schoolId, sessionId, records) => {
        storedProfiles.push(...records);
        storedEnrollments.push(...records.map((record, index) => ({
          schoolId,
          studentId: index + 1,
          sessionId,
          className: record.class,
          sectionName: record.section,
          rollNo: record.rollNumber ?? null,
          status: "Active",
        })));
      },
      insertOne: async () => assert.fail("A valid batch must not need row fallback"),
    },
  );

  assert.deepEqual(result, { imported: 2, failed: 0 });
  assert.equal(storedProfiles[0].digitalStudentId, "SCH7-0041");
  assert.equal(storedProfiles[0].passwordHash, "bcrypt:SCH7-0041");
  assert.deepEqual(
    storedProfiles.map(record => [record.schoolId, record.class, record.section, record.rollNumber]),
    [[7, "5", "A", 1], [7, "6", "B", 2]],
  );
  assert.deepEqual(
    storedEnrollments.map(record => [record.schoolId, record.sessionId, record.className, record.sectionName, record.rollNo, record.status]),
    [[7, 101, "5", "A", 1, "Active"], [7, 101, "6", "B", 2, "Active"]],
  );
  assert.equal(issues.count, 0);
});

test("active imported enrollments are roster-eligible and import creates no Attendance rows", async () => {
  const fake = fakeTransaction();
  try {
    const [created] = await storage.bulkCreateStudentsWithActiveSessionEnrollment(7, [{
      schoolId: 7,
      digitalStudentId: "SCH7-0090",
      name: "Roster Student",
      class: "5",
      section: "A",
      phone: "9876543210",
      dob: "2008-04-02",
      passwordHash: "test-hash",
      rollNumber: 12,
    }], 101);
    assert.ok(created.id);
    assert.deepEqual(fake.state.committedEnrollments.map(row => [
      row.schoolId, row.studentId, row.sessionId, row.className, row.sectionName, row.rollNo, row.status,
    ]), [[7, created.id, 101, "5", "A", 12, "Active"]]);
    assert.ok(fake.state.committedEnrollments.some(row => row.status === "Active" && row.sessionId === 101));
    assert.equal(fake.state.attemptedTables.includes("attendanceRecords"), false);
    assert.deepEqual(fake.state.attemptedTables, ["students", "enrollments"]);

    const profile = { ...created, isActive: true };
    const enrollment = fake.state.committedEnrollments[0];
    const restoreSelect = replace(db as any, "select", () => {
      const query: any = {
        from() { return query; },
        innerJoin() { return query; },
        where() { return Promise.resolve([{ student: profile, enrollment }]); },
      };
      return query;
    });
    try {
      const roster = await storage.getLiveAttendanceRosterForSessionClass(7, 101, "5", "A");
      assert.deepEqual(roster.map(student => student.id), [created.id]);
      const dailyPresence = summarizeWebDailyPresence({
        schoolId: 7,
        sessionId: 101,
        eligibleStudentIds: roster.map(student => student.id),
        records: [],
      });
      assert.equal(dailyPresence.notMarked, 1);
      assert.equal(dailyPresence.percentage, null);
    } finally {
      restoreSelect();
    }
  } finally {
    fake.restore();
  }
});

test("invalid or unconfigured placement is skipped before serial allocation or database writes", async () => {
  const issues = new StudentImportIssueCollector();
  let serialAllocationAttempted = false;
  const plan = prepareStudentImportCandidates(
    [validRawRow({ class: "5", section: "B" })],
    placementMetadata,
    issues,
    { parseDate: value => value, isValidPhone: value => /^\d{10}$/.test(value) },
  );
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.skipped, 1);
  assert.match(issues.issues[0].reason, /not configured/i);
  await persistStudentImportCandidates(
    plan.candidates,
    { schoolId: 7, schoolCode: "SCH7", sessionId: 101 },
    issues,
    {
      allocateSerials: async () => { serialAllocationAttempted = true; return []; },
      hashPassword: async value => value,
      findExistingDsids: async () => new Set(),
      insertBatch: async () => { serialAllocationAttempted = true; },
      insertOne: async () => { serialAllocationAttempted = true; },
    },
  );
  assert.equal(serialAllocationAttempted, false);
});

test("a failed enrollment insert rolls back the Student insert in the same transaction", async () => {
  const fake = fakeTransaction({ failEnrollment: Object.assign(new Error("injected"), { code: "23514" }) });
  try {
    await assert.rejects(
      storage.bulkCreateStudentsWithActiveSessionEnrollment(7, [{
        schoolId: 7,
        digitalStudentId: "SCH7-0091",
        name: "Rollback Student",
        class: "5",
        section: "A",
        phone: "9876543210",
        dob: "2008-04-02",
        passwordHash: "test-hash",
      }], 101),
      error => (error as { code?: string }).code === "23514",
    );
    assert.equal(fake.state.transactionCalls, 1);
    assert.deepEqual(fake.state.committedStudents, []);
    assert.deepEqual(fake.state.committedEnrollments, []);
    assert.deepEqual(fake.state.attemptedTables, ["students", "enrollments"]);
  } finally {
    fake.restore();
  }
});

test("an exact duplicate row in one file is reported once and not imported twice", () => {
  const issues = new StudentImportIssueCollector();
  const row = validRawRow();
  const plan = prepareStudentImportCandidates(
    [row, { ...row }],
    placementMetadata,
    issues,
    { parseDate: value => value, isValidPhone: value => /^\d{10}$/.test(value) },
  );
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.skipped, 1);
  assert.equal(issues.issues[0].row, 3);
  assert.match(issues.issues[0].reason, /duplicate of row 2/i);
});

test("a generated DSID conflict is rejected without overwriting an existing Student or history", async () => {
  const existingStudent = { id: 23, schoolId: 7, digitalStudentId: "SCH7-0100", name: "Existing" };
  const historicalEnrollment = { schoolId: 7, studentId: 23, sessionId: 90, className: "4", sectionName: "B", rollNo: 8, status: "Completed" };
  const before = JSON.stringify({ existingStudent, historicalEnrollment });
  const issues = new StudentImportIssueCollector();
  const result = await persistStudentImportCandidates(
    [candidate(2)],
    { schoolId: 7, schoolCode: "SCH7", sessionId: 101 },
    issues,
    {
      allocateSerials: async () => [100],
      hashPassword: async value => `hash:${value}`,
      findExistingDsids: async () => new Set(["SCH7-0100"]),
      insertBatch: async () => assert.fail("Conflicting ID must be rejected before insert"),
      insertOne: async () => assert.fail("Conflicting ID must not be retried"),
    },
  );
  assert.deepEqual(result, { imported: 0, failed: 1 });
  assert.match(issues.issues[0].reason, /already exists/i);
  assert.equal(JSON.stringify({ existingStudent, historicalEnrollment }), before);
});

test("a missing or ambiguous active session prevents profile and enrollment inserts", async () => {
  const fake = fakeTransaction({ sessions: [] });
  try {
    await assert.rejects(
      storage.bulkCreateStudentsWithActiveSessionEnrollment(7, [{
        schoolId: 7,
        digitalStudentId: "SCH7-0092",
        name: "No Session Student",
        class: "5",
        section: "A",
        phone: "9876543210",
        dob: "2008-04-02",
        passwordHash: "test-hash",
      }], 101),
      error => (error as { code?: string }).code === "NO_ACTIVE_SESSION",
    );
    assert.equal(fake.state.transactionCalls, 1);
    assert.deepEqual(fake.state.attemptedTables, []);
    assert.deepEqual(fake.state.committedStudents, []);
  } finally {
    fake.restore();
  }
});

test("tenant mismatch is rejected before opening a database transaction", async () => {
  const fake = fakeTransaction();
  try {
    await assert.rejects(
      storage.bulkCreateStudentsWithActiveSessionEnrollment(7, [{
        schoolId: 8,
        digitalStudentId: "SCH8-0001",
        name: "Cross Tenant",
        class: "5",
        section: "A",
        phone: "9876543210",
        dob: "2008-04-02",
        passwordHash: "test-hash",
      }], 101),
      /authenticated school/i,
    );
    assert.equal(fake.state.transactionCalls, 0);
    assert.deepEqual(fake.state.committedStudents, []);
  } finally {
    fake.restore();
  }
});

test("bulk creation writes only the pinned active session and leaves historical enrollments untouched", async () => {
  const fake = fakeTransaction({ sessions: [{ id: 101 }] });
  const historicalEnrollment = {
    schoolId: 7, studentId: 77, sessionId: 90, className: "4", sectionName: "B", rollNo: 8, status: "Completed",
  };
  const historyBefore = structuredClone(historicalEnrollment);
  try {
    await storage.bulkCreateStudentsWithActiveSessionEnrollment(7, [{
      schoolId: 7,
      digitalStudentId: "SCH7-0093",
      name: "Current Session Student",
      class: "5",
      section: "A",
      phone: "9876543210",
      dob: "2008-04-02",
      passwordHash: "test-hash",
    }], 101);
    assert.deepEqual(historicalEnrollment, historyBefore);
    assert.deepEqual(fake.state.committedEnrollments.map(row => row.sessionId), [101]);
  } finally {
    fake.restore();
  }
});

test("imports use bounded chunks and bounded password-hash concurrency", async () => {
  const candidates = Array.from({ length: 205 }, (_unused, index) => candidate(index + 2));
  const batchSizes: number[] = [];
  const allocatedSizes: number[] = [];
  const importedPairs: Array<{ profile: any; enrollment: any }> = [];
  let nextSerial = 0;
  let nextImportedStudentId = 0;
  let activeHashes = 0;
  let maxActiveHashes = 0;
  const result = await persistStudentImportCandidates(
    candidates,
    { schoolId: 7, schoolCode: "SCH7", sessionId: 101 },
    new StudentImportIssueCollector(),
    {
      allocateSerials: async count => {
        allocatedSizes.push(count);
        return Array.from({ length: count }, () => ++nextSerial);
      },
      hashPassword: async value => {
        activeHashes += 1;
        maxActiveHashes = Math.max(maxActiveHashes, activeHashes);
        await Promise.resolve();
        activeHashes -= 1;
        return `hash:${value}`;
      },
      findExistingDsids: async () => new Set(),
      insertBatch: async (schoolId, sessionId, records) => {
        batchSizes.push(records.length);
        records.forEach(record => {
          const profile = { id: ++nextImportedStudentId, ...record };
          importedPairs.push({
            profile,
            enrollment: {
              schoolId,
              studentId: profile.id,
              sessionId,
              className: profile.class,
              sectionName: profile.section,
              rollNo: profile.rollNumber ?? null,
              status: "Active",
            },
          });
        });
      },
      insertOne: async () => assert.fail("Valid rows should remain batched"),
    },
  );
  assert.deepEqual(result, { imported: 205, failed: 0 });
  assert.deepEqual(allocatedSizes, [100, 100, 5]);
  assert.deepEqual(batchSizes, [100, 100, 5]);
  assert.ok(maxActiveHashes <= 4);
  assert.equal(importedPairs.length, 205);
  assert.ok(importedPairs.every(({ profile, enrollment }) =>
    enrollment.studentId === profile.id
    && enrollment.schoolId === profile.schoolId
    && enrollment.sessionId === 101
    && enrollment.className === profile.class
    && enrollment.sectionName === profile.section
    && enrollment.rollNo === profile.rollNumber
    && enrollment.status === "Active"));

  const failedIssues = new StudentImportIssueCollector();
  let failedBatchCalls = 0;
  let idLookupCalls = 0;
  let lookupsBeforeFirstWrite = 0;
  let nextFailureSerial = 0;
  const partialResult = await persistStudentImportCandidates(
    candidates,
    { schoolId: 7, schoolCode: "SCH7", sessionId: 101 },
    failedIssues,
    {
      allocateSerials: async count => Array.from({ length: count }, () => ++nextFailureSerial),
      hashPassword: async value => `hash:${value}`,
      findExistingDsids: async () => {
        idLookupCalls += 1;
        return new Set();
      },
      insertBatch: async () => {
        if (failedBatchCalls === 0) lookupsBeforeFirstWrite = idLookupCalls;
        failedBatchCalls += 1;
        if (failedBatchCalls === 2) throw new Error("injected bounded batch failure");
      },
      insertOne: async () => assert.fail("Unknown batch failures are not row-retried"),
    },
  );
  assert.deepEqual(partialResult, { imported: 100, failed: 105 });
  assert.equal(failedIssues.count, 105);
  assert.equal(failedIssues.issues[0].row, 102);
  assert.equal(failedIssues.issues.at(-1)?.row, 201);
  assert.equal(failedIssues.truncated, true);
  assert.equal(idLookupCalls, 3);
  assert.equal(lookupsBeforeFirstWrite, 3);
});

test("the active-session pin is checked again inside every write transaction", async () => {
  const fake = fakeTransaction({ sessions: [{ id: 102 }] });
  try {
    await assert.rejects(
      storage.bulkCreateStudentsWithActiveSessionEnrollment(7, [{
        schoolId: 7,
        digitalStudentId: "SCH7-0094",
        name: "Changed Session Student",
        class: "5",
        section: "A",
        phone: "9876543210",
        dob: "2008-04-02",
        passwordHash: "test-hash",
      }], 101),
      error => (error as { code?: string }).code === "ACTIVE_SESSION_CHANGED",
    );
    assert.deepEqual(fake.state.attemptedTables, []);
    assert.deepEqual(fake.state.committedStudents, []);
  } finally {
    fake.restore();
  }
});

