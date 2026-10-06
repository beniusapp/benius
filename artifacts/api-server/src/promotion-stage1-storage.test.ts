import assert from "node:assert/strict";
import test from "node:test";
import { db } from "./db";
import { storage } from "./storage";
import {
  academicHistory,
  academicSessions,
  enrollments,
  examScores,
  promotionDecisions,
  students,
} from "@workspace/db";

type Fixture = {
  student: { id: number; schoolId: number; isActive: boolean; digitalStudentId: string; name: string };
  enrollment: {
    studentId: number;
    schoolId: number;
    sessionId: number;
    className: string;
    sectionName: string;
    status: string;
  };
  additionalStudents?: Array<{ id: number; schoolId: number; isActive: boolean; digitalStudentId: string; name: string }>;
  additionalEnrollments?: Array<{
    studentId: number;
    schoolId: number;
    sessionId: number;
    className: string;
    sectionName: string;
    status: string;
  }>;
  targetSession?: { id: number; schoolId: number; status: string; sessionName: string };
  targetEnrollments?: Array<{
    studentId: number;
    schoolId: number;
    sessionId: number;
    className: string;
    sectionName: string;
    rollNo: number | null;
    status: string;
  }>;
  existingDecisions?: Array<{ adminExecuted: boolean }>;
};

function fakePromotionTransaction(fixture: Fixture) {
  const state = {
    committedHistory: [] as any[],
    committedTargetEnrollments: [] as any[],
    committedStudentUpdates: [] as any[],
    committedDecisionUpdates: [] as any[],
    enrollmentUpdates: 0,
    attemptedInserts: [] as unknown[],
    attemptedUpdates: [] as unknown[],
    profile: { class: "5", section: "A", idCardPendingReissue: false },
  };
  const restore = (db as any).transaction;
  let academicSessionSelects = 0;
  let enrollmentSelects = 0;

  (db as any).transaction = async (work: (tx: any) => Promise<unknown>) => {
    const stagedHistory: any[] = [];
    const stagedTargetEnrollments: any[] = [];
    const stagedStudentUpdates: any[] = [];
    const stagedDecisionUpdates: any[] = [];
    const tx: any = {
      select: () => {
        let table: unknown;
        const query: any = {
          from(value: unknown) { table = value; return query; },
          where() { return query; },
          for() { return query; },
          then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
            const rows = table === academicSessions
              ? (++academicSessionSelects === 1
                  ? [{ id: 42, schoolId: 11, isActive: true }]
                  : [fixture.targetSession ?? {
                      id: 44, schoolId: 11, status: "draft", sessionName: "2027–2028",
                    }])
              : table === students
                ? [fixture.student, ...(fixture.additionalStudents ?? [])]
                : table === enrollments
                  ? (++enrollmentSelects === 1
                      ? [fixture.enrollment, ...(fixture.additionalEnrollments ?? [])]
                      : (fixture.targetEnrollments ?? []))
                  : table === promotionDecisions
                    ? (fixture.existingDecisions ?? [])
                    : table === examScores
                      ? [{
                          studentId: fixture.student.id,
                          subject: "Mathematics",
                          examType: "Term 2",
                          marks: 80,
                          totalMarks: 100,
                          isAbsent: false,
                        }]
                      : [];
            return Promise.resolve(rows).then(resolve, reject);
          },
        };
        return query;
      },
      insert: (table: unknown) => {
        const query: any = {
          values(values: any[] | Record<string, unknown>) {
            const records = Array.isArray(values) ? values : [values];
            state.attemptedInserts.push(table);
            if (table === academicHistory) stagedHistory.push(...records);
            if (table === enrollments) stagedTargetEnrollments.push(...records);
            return query;
          },
          onConflictDoNothing() { return query; },
          returning() {
            return Promise.resolve(table === enrollments ? [{ id: 100 }] : []);
          },
          then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
            return Promise.resolve().then(resolve, reject);
          },
        };
        return query;
      },
      update: (table: unknown) => {
        let changes: any;
        const query: any = {
          set(values: any) {
            changes = values;
            state.attemptedUpdates.push(table);
            return query;
          },
          where() { return query; },
          returning() {
            if (table === students && fixture.student.isActive) {
              stagedStudentUpdates.push(changes);
              return Promise.resolve([{ id: fixture.student.id }]);
            }
            return Promise.resolve([]);
          },
          then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
            if (table === promotionDecisions) stagedDecisionUpdates.push(changes);
            if (table === enrollments) state.enrollmentUpdates += 1;
            return Promise.resolve().then(resolve, reject);
          },
        };
        return query;
      },
    };

    const result = await work(tx);
    state.committedHistory.push(...stagedHistory);
    state.committedTargetEnrollments.push(...stagedTargetEnrollments);
    state.committedStudentUpdates.push(...stagedStudentUpdates);
    state.committedDecisionUpdates.push(...stagedDecisionUpdates);
    if (stagedStudentUpdates.length > 0) {
      Object.assign(state.profile, stagedStudentUpdates[0]);
    }
    return result;
  };

  return {
    state,
    restore() {
      (db as any).transaction = restore;
    },
  };
}

const baseFixture: Fixture = {
  student: {
    id: 7,
    schoolId: 11,
    isActive: true,
    digitalStudentId: "B-007",
    name: "Student One",
  },
  enrollment: {
    studentId: 7,
    schoolId: 11,
    sessionId: 42,
    className: "5",
    sectionName: "A",
    status: "Active",
  },
};

const item = {
  studentId: 7,
  fromClass: "5",
  fromSection: "A",
  nextClass: "6",
  nextSection: "A",
  examType: "Term 2",
  totalObtained: 80,
  totalMax: 100,
  percentage: 80,
};

test("Promotion rejects a foreign-school Student before history, profile, or decision writes", async (t) => {
  const fake = fakePromotionTransaction({
    ...baseFixture,
    student: { ...baseFixture.student, schoolId: 12 },
    enrollment: { ...baseFixture.enrollment, schoolId: 12 },
  });
  t.after(fake.restore);

  await assert.rejects(
    storage.executePromotionTransaction(
      11,
      42,
      44,
      [item],
      "Term 2",
      { id: 7, role: "support_staff" },
    ),
    (error: any) => error?.code === "STUDENT_NOT_IN_SOURCE_SESSION",
  );
  assert.deepEqual(fake.state.committedHistory, []);
  assert.deepEqual(fake.state.committedStudentUpdates, []);
  assert.deepEqual(fake.state.committedDecisionUpdates, []);
  assert.deepEqual(fake.state.attemptedInserts, []);
  assert.deepEqual(fake.state.attemptedUpdates, []);
  assert.deepEqual(fake.state.profile, {
    class: "5",
    section: "A",
    idCardPendingReissue: false,
  });
});

test("Promotion writes source-session history without changing source enrollment", async (t) => {
  const sourceEnrollmentBefore = { ...baseFixture.enrollment };
  const fake = fakePromotionTransaction(baseFixture);
  t.after(fake.restore);

  const result = await storage.executePromotionTransaction(
    11,
    42,
    44,
    [item],
    "Term 2",
    { id: 7, role: "support_staff" },
  );

  assert.equal(result.prepared, 1);
  assert.equal(result.targetEnrollmentsCreated, 1);
  assert.equal(result.targetSessionId, 44);
  assert.equal(result.targetSessionName, "2027–2028");
  assert.equal(fake.state.committedHistory.length, 1);
  assert.equal(fake.state.committedHistory[0].schoolId, 11);
  assert.equal(fake.state.committedHistory[0].studentId, 7);
  assert.equal(fake.state.committedHistory[0].sessionId, 42);
  assert.equal(fake.state.committedHistory[0].targetSessionId, 44);
  assert.equal(fake.state.committedHistory[0].snapshotJson.sourceSessionId, 42);
  assert.equal(fake.state.committedHistory[0].snapshotJson.targetSessionId, 44);
  assert.equal(fake.state.committedHistory[0].snapshotJson.targetSessionName, "2027–2028");
  assert.deepEqual(fake.state.committedHistory[0].snapshotJson.examBreakdown, [{
    subject: "Mathematics",
    examType: "Term 2",
    marks: 80,
    totalMarks: 100,
    isAbsent: false,
  }]);
  assert.equal(fake.state.committedHistory[0].snapshotJson.actorRole, "support_staff");
  assert.equal(fake.state.committedHistory[0].snapshotJson.staffId, 7);
  assert.equal(fake.state.committedHistory[0].snapshotJson.adminId, undefined);
  assert.deepEqual(fake.state.profile, {
    class: "5",
    section: "A",
    idCardPendingReissue: false,
  });
  assert.deepEqual(fake.state.committedStudentUpdates, []);
  assert.deepEqual(fake.state.committedTargetEnrollments, [{
    schoolId: 11,
    studentId: 7,
    sessionId: 44,
    className: "6",
    sectionName: "A",
    rollNo: null,
    status: "Active",
  }]);
  assert.equal(fake.state.enrollmentUpdates, 0);
  assert.deepEqual(baseFixture.enrollment, sourceEnrollmentBefore);
  assert.equal(fake.state.committedDecisionUpdates.length, 1);
  assert.equal(fake.state.committedDecisionUpdates[0].adminExecuted, true);
  assert.ok(fake.state.committedDecisionUpdates[0].adminExecutedAt instanceof Date);
});

test("Promotion confirms an exact target enrollment without duplicating it", async (t) => {
  const fake = fakePromotionTransaction({
    ...baseFixture,
    targetEnrollments: [{
      studentId: 7,
      schoolId: 11,
      sessionId: 44,
      className: "6",
      sectionName: "A",
      rollNo: null,
      status: "Active",
    }],
  });
  t.after(fake.restore);

  const result = await storage.executePromotionTransaction(
    11,
    42,
    44,
    [item],
    "Term 2",
    { id: 7, role: "admin" },
  );

  assert.equal(result.prepared, 1);
  assert.equal(result.targetEnrollmentsCreated, 0);
  assert.deepEqual(fake.state.committedTargetEnrollments, []);
  assert.equal(fake.state.committedHistory[0].targetSessionId, 44);
});

test("A conflicting target enrollment rolls back earlier target writes and all history/decision writes", async (t) => {
  const secondStudent = {
    id: 8,
    schoolId: 11,
    isActive: true,
    digitalStudentId: "B-008",
    name: "Student Two",
  };
  const fake = fakePromotionTransaction({
    ...baseFixture,
    additionalStudents: [secondStudent],
    additionalEnrollments: [{
      studentId: 8,
      schoolId: 11,
      sessionId: 42,
      className: "5",
      sectionName: "A",
      status: "Active",
    }],
    targetEnrollments: [{
      studentId: 8,
      schoolId: 11,
      sessionId: 44,
      className: "8",
      sectionName: "A",
      rollNo: null,
      status: "Active",
    }],
  });
  t.after(fake.restore);

  await assert.rejects(
    storage.executePromotionTransaction(
      11,
      42,
      44,
      [item, { ...item, studentId: 8 }],
      "Term 2",
      { id: 7, role: "support_staff" },
    ),
    (error: any) => error?.code === "TARGET_ENROLLMENT_CONFLICT",
  );

  assert.deepEqual(fake.state.committedTargetEnrollments, []);
  assert.deepEqual(fake.state.committedHistory, []);
  assert.deepEqual(fake.state.committedDecisionUpdates, []);
  assert.deepEqual(fake.state.committedStudentUpdates, []);
  assert.deepEqual(fake.state.profile, {
    class: "5",
    section: "A",
    idCardPendingReissue: false,
  });
});

test("Promotion blocks an inactive Student before writes", async (t) => {
  const fake = fakePromotionTransaction({
    ...baseFixture,
    student: { ...baseFixture.student, isActive: false },
  });
  t.after(fake.restore);

  await assert.rejects(
    storage.executePromotionTransaction(
      11,
      42,
      44,
      [item],
      "Term 2",
      { id: 7, role: "support_staff" },
    ),
    (error: any) => error?.code === "STUDENT_NOT_IN_SOURCE_SESSION",
  );
  assert.deepEqual(fake.state.committedHistory, []);
  assert.deepEqual(fake.state.committedStudentUpdates, []);
  assert.deepEqual(fake.state.committedDecisionUpdates, []);
  assert.equal(fake.state.enrollmentUpdates, 0);
});

test("Promotion refuses to re-execute an already executed source-session decision", async (t) => {
  const fake = fakePromotionTransaction({
    ...baseFixture,
    existingDecisions: [{ adminExecuted: true }],
  });
  t.after(fake.restore);

  await assert.rejects(
    storage.executePromotionTransaction(
      11,
      42,
      44,
      [item],
      "Term 2",
      { id: 7, role: "support_staff" },
    ),
    (error: any) => error?.code === "PROMOTION_ALREADY_EXECUTED",
  );
  assert.deepEqual(fake.state.committedHistory, []);
  assert.deepEqual(fake.state.committedStudentUpdates, []);
  assert.deepEqual(fake.state.committedDecisionUpdates, []);
});
