import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { resolveStudentExaminationSession } from "./student-examination-session";
import { studentPublishedRankScope, studentPublishedScoreScope } from "./student-examination-score-scope";

const student = { id: 17, schoolId: 1, class: "9", section: "B" };
const archived = { id: 21, schoolId: 1, isActive: false };
const current = { id: 22, schoolId: 1, isActive: true };
const foreign = { id: 31, schoolId: 2, isActive: true };
const historicalEnrollment = {
  schoolId: 1, studentId: 17, sessionId: 21,
  className: "8", sectionName: "A", rollNo: 4, status: "Promoted",
};
const currentEnrollment = { ...historicalEnrollment, sessionId: 22, className: "9", sectionName: "B" };

function fixture() {
  const calls: { school: number[]; enrollments: number[] } = { school: [], enrollments: [] };
  const dependencies = {
    async getStudentById(id: number) { return id === student.id ? student : undefined; },
    async getAcademicSessionForSchool(id: number, schoolId: number) {
      calls.school.push(id);
      return [archived, current, foreign].find(s => s.id === id && s.schoolId === schoolId);
    },
    async resolveEnrollmentForStudentSession(schoolId: number, studentId: number, sessionId: number) {
      calls.enrollments.push(sessionId);
      return [historicalEnrollment, currentEnrollment].find(
        e => e.schoolId === schoolId && e.studentId === studentId && e.sessionId === sessionId,
      );
    },
  };
  return { dependencies, calls };
}

test("A/B/C/H: historical read uses exact 8A enrollment and never current 9B", async () => {
  const { dependencies, calls } = fixture();
  const a = await resolveStudentExaminationSession(17, "21", dependencies);
  const b = await resolveStudentExaminationSession(17, "22", dependencies);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.deepEqual([a.schoolId, a.sessionId, a.enrollment.className, a.enrollment.sectionName], [1, 21, "8", "A"]);
  assert.deepEqual([b.schoolId, b.sessionId, b.enrollment.className, b.enrollment.sectionName], [1, 22, "9", "B"]);
  assert.deepEqual(calls.enrollments, [21, 22]);
});

test("D/K: client class or student ID cannot replace authenticated enrollment", async () => {
  const { dependencies } = fixture();
  const clientInput = { studentId: 44, class: "9", section: "B" };
  const result = await resolveStudentExaminationSession(17, "21", dependencies);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.student.id, clientInput.studentId);
  assert.notEqual(result.enrollment.className, clientInput.class);
  assert.notEqual(result.enrollment.sectionName, clientInput.section);
});

test("J/N/O: missing, malformed, and foreign selected sessions fail closed", async () => {
  const { dependencies, calls } = fixture();
  const missing = await resolveStudentExaminationSession(17, undefined, dependencies);
  const malformed = await resolveStudentExaminationSession(17, "21oops", dependencies);
  const foreignResult = await resolveStudentExaminationSession(17, "31", dependencies);
  assert.equal(missing.ok, false);
  assert.equal(malformed.ok, false);
  assert.equal(foreignResult.ok, false);
  if (!missing.ok && !malformed.ok && !foreignResult.ok) {
    assert.deepEqual([missing.code, malformed.code, foreignResult.code], [
      "STUDENT_SESSION_REQUIRED", "STUDENT_SESSION_INVALID", "STUDENT_SESSION_FORBIDDEN",
    ]);
  }
  assert.deepEqual(calls.enrollments, []);
});

test("no selected-year enrollment cannot fall back to current placement", async () => {
  const { dependencies } = fixture();
  const result = await resolveStudentExaminationSession(17, "21", {
    ...dependencies, async resolveEnrollmentForStudentSession() { return undefined; },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "STUDENT_ENROLLMENT_REQUIRED");
});

test("E/F/G/I/M: score, type and class readers require published rows in the selected cohort", () => {
  const dialect = new PgDialect();
  const a = dialect.sqlToQuery(studentPublishedScoreScope(1, 17, 21, "8", "A"));
  const b = dialect.sqlToQuery(studentPublishedScoreScope(1, 17, 22, "9", "B"));
  for (const column of ["school_id", "student_id", "session_id", "class", "section", "published"]) {
    assert.match(a.sql, new RegExp(`"${column}"`));
  }
  assert.deepEqual(a.params, [1, 17, 21, "8", "A", true]);
  assert.deepEqual(b.params, [1, 17, 22, "9", "B", true]);
  assert.throws(() => studentPublishedScoreScope(1, 17, 0, "8", "A"));
});

test("L: rank cohort uses selected-year section and published scores only", () => {
  const rank = new PgDialect().sqlToQuery(studentPublishedRankScope(1, 21, "8", "A", "Annual"));
  assert.deepEqual(rank.params, [1, 21, "8", "A", "Annual", true]);
  assert.match(rank.sql, /"section"/);
  assert.match(rank.sql, /"published"/);
});