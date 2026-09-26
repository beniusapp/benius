import assert from "node:assert/strict";
import test from "node:test";
import { homeworkBelongsToStudentWorkSession, resolveStudentWorkSession } from "./student-work-session";

const student = { id: 17, schoolId: 1, class: "9", section: "A" };
const archived = { id: 21, schoolId: 1, isActive: false };
const active = { id: 22, schoolId: 1, isActive: true };
const foreign = { id: 31, schoolId: 2, isActive: true };
const enrollmentA = {
  schoolId: 1, studentId: 17, sessionId: 21,
  className: "8", sectionName: "A", rollNo: 4, status: "Promoted",
};
const enrollmentB = { ...enrollmentA, sessionId: 22, className: "9" };

function fixture() {
  const calls: { school: Array<[number, number]>; enrollment: Array<[number, number, number]> } = {
    school: [], enrollment: [],
  };
  const dependencies = {
    async getStudentById(id: number) { return id === student.id ? student : undefined; },
    async getAcademicSessionForSchool(id: number, schoolId: number) {
      calls.school.push([id, schoolId]);
      return [archived, active, foreign].find(s => s.id === id && s.schoolId === schoolId);
    },
    async resolveEnrollmentForStudentSession(schoolId: number, studentId: number, sessionId: number) {
      calls.enrollment.push([schoolId, studentId, sessionId]);
      return [enrollmentA, enrollmentB].find(
        e => e.schoolId === schoolId && e.studentId === studentId && e.sessionId === sessionId,
      );
    },
  };
  return { dependencies, calls };
}

test("A/C: historical Homework uses the selected year's 8A enrollment, not current 9A", async () => {
  const { dependencies, calls } = fixture();
  const context = await resolveStudentWorkSession(17, "21", dependencies);
  assert.equal(context.ok, true);
  if (!context.ok) return;
  assert.deepEqual(
    [context.schoolId, context.enrollment.className, context.enrollment.sectionName, context.student.id, context.sessionId],
    [1, "8", "A", 17, 21],
  );
  assert.deepEqual(calls.enrollment, [[1, 17, 21]]);
  assert.equal(homeworkBelongsToStudentWorkSession({ schoolId: 1, sessionId: 21, class: "8", section: "A" }, context), true);
  assert.equal(homeworkBelongsToStudentWorkSession({ schoolId: 1, sessionId: 21, class: "9", section: "A" }, context), false);
});

test("B/D/E: detail and submission reject another session, including legacy null", async () => {
  const { dependencies } = fixture();
  const context = await resolveStudentWorkSession(17, "21", dependencies);
  assert.equal(context.ok, true);
  if (!context.ok) return;
  for (const sessionId of [22, null]) {
    assert.equal(homeworkBelongsToStudentWorkSession({
      schoolId: 1, sessionId, class: "8", section: "A",
    }, context), false);
  }
});

test("F: archived Homework is readable but cannot receive a new submission", async () => {
  const { dependencies } = fixture();
  const read = await resolveStudentWorkSession(17, "21", dependencies);
  assert.equal(read.ok, true);
  const write = await resolveStudentWorkSession(17, "21", dependencies, true);
  assert.equal(write.ok, false);
  if (!write.ok) assert.equal(write.code, "STUDENT_SESSION_READ_ONLY");
  const liveWrite = await resolveStudentWorkSession(17, "22", dependencies, true);
  assert.equal(liveWrite.ok, true);
});

test("G/H: Classwork cohorts and session IDs follow each selected enrollment", async () => {
  const { dependencies } = fixture();
  const a = await resolveStudentWorkSession(17, "21", dependencies);
  const b = await resolveStudentWorkSession(17, "22", dependencies);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.deepEqual([a.schoolId, a.enrollment.className, a.enrollment.sectionName, a.sessionId], [1, "8", "A", 21]);
  assert.deepEqual([b.schoolId, b.enrollment.className, b.enrollment.sectionName, b.sessionId], [1, "9", "A", 22]);
  assert.notEqual(a.sessionId, b.sessionId);
});

test("I/J: foreign-school session or Homework is rejected", async () => {
  const { dependencies, calls } = fixture();
  const result = await resolveStudentWorkSession(17, "31", dependencies);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "STUDENT_SESSION_FORBIDDEN");
  assert.deepEqual(calls.school, [[31, 1]]);
  assert.deepEqual(calls.enrollment, []);
  const context = await resolveStudentWorkSession(17, "21", dependencies);
  assert.equal(context.ok, true);
  if (context.ok) {
    assert.equal(homeworkBelongsToStudentWorkSession({
      schoolId: 2, sessionId: 21, class: "8", section: "A",
    }, context), false);
  }
});

test("K: missing or malformed session fails before work can be queried", async () => {
  const { dependencies, calls } = fixture();
  const missing = await resolveStudentWorkSession(17, undefined, dependencies);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "STUDENT_SESSION_REQUIRED");
  const malformed = await resolveStudentWorkSession(17, "21junk", dependencies);
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.code, "STUDENT_SESSION_INVALID");
  assert.deepEqual(calls.school, []);
  assert.deepEqual(calls.enrollment, []);
});

test("no selected-year enrollment cannot fall back to the student's current class", async () => {
  const { dependencies } = fixture();
  const unenrolled = await resolveStudentWorkSession(17, "21", {
    ...dependencies,
    async resolveEnrollmentForStudentSession() { return undefined; },
  });
  assert.equal(unenrolled.ok, false);
  if (!unenrolled.ok) assert.equal(unenrolled.code, "STUDENT_ENROLLMENT_REQUIRED");
});

test("authenticated student identity is required", async () => {
  const { dependencies } = fixture();
  const result = await resolveStudentWorkSession(undefined, "22", dependencies);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});