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
  existingDecisions?: Array<{ adminExecuted: boolean }>;
};

function fakePromotionTransaction(fixture: Fixture) {
  const state = {
    committedHistory: [] as any[],
    committedStudentUpdates: [] as any[],
    committedDecisionUpdates: [] as any[],
    enrollmentUpdates: 0,
    attemptedInserts: [] as unknown[],
    attemptedUpdates: [] as unknown[],
    profile: { class: "5", section: "A", idCardPendingReissue: false },
  };
  const restore = (db as any).transaction;

  (db as any).transaction = async (work: (tx: any) => Promise<unknown>) => {
    const stagedHistory: any[] = [];
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
              ? [{ id: 42, schoolId: 11, isActive: true }]
              : table === students
                ? [fixture.student]
                : table === enrollments
                  ? [fixture.enrollment]
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
      insert: (table: unknown) => ({
        values(values: any[]) {
          state.attemptedInserts.push(table);
          if (table === academicHistory) stagedHistory.push(...values);
          return Promise.resolve();
        },
      }),
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
    [item],
    "Term 2",
    { id: 7, role: "support_staff" },
  );

  assert.equal(result.promoted, 1);
  assert.equal(fake.state.committedHistory.length, 1);
  assert.equal(fake.state.committedHistory[0].schoolId, 11);
  assert.equal(fake.state.committedHistory[0].studentId, 7);
  assert.equal(fake.state.committedHistory[0].sessionId, 42);
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
    class: "6",
    section: "A",
    idCardPendingReissue: true,
  });
  assert.equal(fake.state.enrollmentUpdates, 0);
  assert.deepEqual(baseFixture.enrollment, sourceEnrollmentBefore);
  assert.equal(fake.state.committedDecisionUpdates.length, 1);
  assert.equal(fake.state.committedDecisionUpdates[0].adminExecuted, true);
  assert.ok(fake.state.committedDecisionUpdates[0].adminExecutedAt instanceof Date);
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
