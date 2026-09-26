import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { resolveStudentAcademicSession } from "./student-academic-session";
import { studentTimetableScope } from "./student-timetable-visibility";
import {
  countUnreadStudentNotices,
  studentCanMarkNoticeIds,
  studentNoticeMatchesAudience,
  studentNoticeSessionScope,
} from "./student-notice-visibility";

const dialect = new PgDialect();
const student = { id: 17, schoolId: 1, class: "9", section: "A" };
const sessions = [
  { id: 21, schoolId: 1, isActive: false },
  { id: 22, schoolId: 1, isActive: true },
  { id: 31, schoolId: 2, isActive: true },
];
const enrollment = (sessionId: number) => ({
  studentId: student.id, schoolId: student.schoolId, sessionId,
  className: sessionId === 21 ? "8" : "9", sectionName: "A",
  rollNo: 1, status: "Active",
});
const dependencies = {
  async getStudentById(id: number) { return id === student.id ? student : undefined; },
  async getAcademicSessionForSchool(id: number, schoolId: number) {
    return sessions.find(s => s.id === id && s.schoolId === schoolId);
  },
  async resolveEnrollmentForStudentSession(schoolId: number, studentId: number, sessionId: number) {
    return schoolId === student.schoolId && studentId === student.id && (sessionId === 21 || sessionId === 22)
      ? enrollment(sessionId) : undefined;
  },
};
const resolve = (id: unknown) =>
  resolveStudentAcademicSession(student.id, id, "SELECTED_SESSION_ENROLLMENT_REQUIRED", dependencies);

test("historical timetable uses enrolled 8A, not today's 9A; drafts remain included", async () => {
  const context = await resolve("21");
  assert.equal(context.ok, true);
  if (!context.ok || !context.enrollment) return;
  assert.equal(context.session?.isActive, false);
  assert.equal(student.class, "9");
  assert.equal(context.enrollment.className, "8");
  const scope = dialect.sqlToQuery(studentTimetableScope(
    context.schoolId, context.sessionId!, context.enrollment.className, context.enrollment.sectionName,
  ));
  assert.deepEqual(scope.params, [1, 21, "8", "A"]);
  assert.doesNotMatch(scope.sql, /published/);
  assert.notDeepEqual(scope.params, dialect.sqlToQuery(studentTimetableScope(1, 22, "9", "A")).params);
});

test("Student session rejects missing, malformed, foreign and unenrolled session IDs", async () => {
  for (const [id, expected] of [[undefined, 400], ["21x", 400], ["31", 403], ["999", 403]] as const) {
    const result = await resolve(id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, expected);
  }
  const noEnrollment = await resolveStudentAcademicSession(
    student.id, "22", "SELECTED_SESSION_ENROLLMENT_REQUIRED",
    { ...dependencies, async resolveEnrollmentForStudentSession() { return undefined; } },
  );
  assert.equal(noEnrollment.ok, false);
  assert.throws(() => studentTimetableScope(1, 0, "8", "A"));
});

test("notices use strict school+session equality; null is not a cross-session global", () => {
  const scope = dialect.sqlToQuery(studentNoticeSessionScope(1, 21));
  assert.deepEqual(scope.params, [1, 21]);
  assert.match(scope.sql, /session_id/);
  assert.doesNotMatch(scope.sql, /IS NULL| OR /i);
  assert.notDeepEqual(scope.params, dialect.sqlToQuery(studentNoticeSessionScope(1, 22)).params);
  assert.throws(() => studentNoticeSessionScope(1, 0));
});

test("historical notice audience and unread count use selected enrollment 8A", async () => {
  const context = await resolve("21");
  assert.equal(context.ok, true);
  if (!context.ok || !context.enrollment) return;
  const audience = (targetType: string, targetClass: string | null, targetSection: string | null) =>
    studentNoticeMatchesAudience({ targetType, targetClass, targetSection },
      context.enrollment!.className, context.enrollment!.sectionName);
  assert.equal(audience("class", "8", "A"), true);
  assert.equal(audience("class", "9", "A"), false);
  assert.equal(audience("class", "8", "B"), false);
  assert.equal(audience("student", "8, 9", "A"), true);
  assert.equal(audience("student", null, null), true);
  assert.equal(audience("whole_school", "9", "B"), true);
  const visible = [
    { id: 1, isRead: false, class: "8" },
    { id: 2, isRead: true, class: "8" },
    { id: 3, isRead: false, class: "9" },
  ].filter(n => audience("class", n.class, "A"));
  assert.equal(countUnreadStudentNotices(visible), 1);
  assert.equal(studentCanMarkNoticeIds([1], visible), true);
  assert.equal(studentCanMarkNoticeIds([3], visible), false);
  assert.equal(studentCanMarkNoticeIds([1, 99], visible), false);
});