import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveStudentAcademicSession,
  type StudentAcademicSessionDependencies,
  type StudentSessionEnrollment,
} from "./student-academic-session";
import { resolveStudentExaminationSession } from "./student-examination-session";

const student = { id: 17, schoolId: 1, class: "10", section: "A" };
const current = { id: 22, schoolId: 1, isActive: true };
const historical = { id: 21, schoolId: 1, isActive: false };
const foreign = { id: 31, schoolId: 2, isActive: true };
type Student = typeof student;
type Session = typeof current;
type Enrollment = StudentSessionEnrollment;

function fixture(overrides: Partial<StudentAcademicSessionDependencies<Student, Session, Enrollment>> = {}) {
  const calls: { session: Array<[number, number]>; enrollment: Array<[number, number, number]> } = {
    session: [],
    enrollment: [],
  };
  const dependencies: StudentAcademicSessionDependencies<Student, Session, Enrollment> = {
    async getStudentById(id) { return id === student.id ? student : undefined; },
    async getAcademicSessionForSchool(id, schoolId) {
      calls.session.push([id, schoolId]);
      return [current, historical, foreign].find(s => s.id === id && s.schoolId === schoolId);
    },
    async getActiveSession(schoolId) { return schoolId === student.schoolId ? current : undefined; },
    async resolveEnrollmentForStudentSession(schoolId, studentId, sessionId) {
      calls.enrollment.push([schoolId, studentId, sessionId]);
      return schoolId === 1 && studentId === 17 && sessionId === 21
        ? { schoolId, studentId, sessionId, className: "9", sectionName: "B", rollNo: 4, status: "Promoted" }
        : undefined;
    },
    ...overrides,
  };
  return { dependencies, calls };
}

test("accepts a selected same-school session and returns server-derived identity", async () => {
  const { dependencies, calls } = fixture();
  const result = await resolveStudentAcademicSession(17, "22", "SELECTED_SESSION_REQUIRED", dependencies);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.schoolId, 1);
  assert.equal(result.student.id, 17);
  assert.equal(result.sessionId, 22);
  assert.deepEqual(calls.session, [[22, 1]]);
});

test("foreign and nonexistent sessions have the same safe rejection", async () => {
  const { dependencies } = fixture();
  const foreignResult = await resolveStudentAcademicSession(17, "31", "SELECTED_SESSION_REQUIRED", dependencies);
  const missingResult = await resolveStudentAcademicSession(17, "999", "SELECTED_SESSION_REQUIRED", dependencies);
  assert.deepEqual(foreignResult, missingResult);
  assert.deepEqual(foreignResult, {
    ok: false, status: 403, code: "STUDENT_SESSION_FORBIDDEN", message: "Invalid academic session",
  });
});

test("a storage implementation cannot return a different school's session", async () => {
  const { dependencies } = fixture({ async getAcademicSessionForSchool() { return foreign; } });
  const result = await resolveStudentAcademicSession(17, "31", "SELECTED_SESSION_REQUIRED", dependencies);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "STUDENT_SESSION_FORBIDDEN");
});

test("malformed IDs fail, including values parseInt would have accepted", async () => {
  const { dependencies, calls } = fixture();
  for (const value of ["22junk", "22.0", "", " 22", "0", "-1", "9007199254740992", ["22"]]) {
    const result = await resolveStudentAcademicSession(17, value, "SELECTED_SESSION_REQUIRED", dependencies);
    assert.equal(result.ok, false, `unexpectedly accepted ${String(value)}`);
    if (!result.ok) assert.equal(result.code, "STUDENT_SESSION_INVALID");
  }
  assert.deepEqual(calls.session, []);
});

test("required mode fails closed when the header is absent", async () => {
  const { dependencies, calls } = fixture();
  const result = await resolveStudentAcademicSession(17, undefined, "SELECTED_SESSION_REQUIRED", dependencies);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "STUDENT_SESSION_REQUIRED");
  assert.deepEqual(calls.session, []);
});

test("historical reads are allowed but operational writes reject archived sessions", async () => {
  const { dependencies } = fixture();
  const read = await resolveStudentAcademicSession(17, "21", "SELECTED_SESSION_REQUIRED", dependencies);
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.session?.isActive, false);
  const write = await resolveStudentAcademicSession(17, "21", "CURRENT_SESSION_WRITE", dependencies);
  assert.equal(write.ok, false);
  if (!write.ok) assert.equal(write.code, "STUDENT_SESSION_READ_ONLY");
  const currentWrite = await resolveStudentAcademicSession(17, "22", "CURRENT_SESSION_WRITE", dependencies);
  assert.equal(currentWrite.ok, true);
});

test("enrollment mode returns historical placement for the exact school/student/session", async () => {
  const { dependencies, calls } = fixture();
  const result = await resolveStudentAcademicSession(17, "21", "SELECTED_SESSION_ENROLLMENT_REQUIRED", dependencies);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.enrollment?.className, "9");
    assert.equal(result.enrollment?.sectionName, "B");
    assert.equal(result.enrollment?.rollNo, 4);
    assert.notEqual(result.enrollment?.className, result.student.class);
  }
  assert.deepEqual(calls.enrollment, [[1, 17, 21]]);
  const noEnrollment = await resolveStudentAcademicSession(17, "22", "SELECTED_SESSION_ENROLLMENT_REQUIRED", dependencies);
  assert.equal(noEnrollment.ok, false);
  if (!noEnrollment.ok) assert.equal(noEnrollment.code, "STUDENT_ENROLLMENT_REQUIRED");
});

test("rejects an enrollment returned for another student, school or session", async () => {
  for (const mismatch of [{ studentId: 18 }, { schoolId: 2 }, { sessionId: 22 }]) {
    const { dependencies } = fixture({
      async resolveEnrollmentForStudentSession() {
        return {
          schoolId: 1, studentId: 17, sessionId: 21,
          className: "9", sectionName: "B", rollNo: null, status: "Active",
          ...mismatch,
        };
      },
    });
    const result = await resolveStudentAcademicSession(17, "21", "SELECTED_SESSION_ENROLLMENT_REQUIRED", dependencies);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STUDENT_ENROLLMENT_REQUIRED");
  }
});

test("global mode needs no session and never queries one", async () => {
  const { dependencies, calls } = fixture();
  const result = await resolveStudentAcademicSession(17, undefined, "GLOBAL", dependencies);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.session, null);
  assert.deepEqual(calls.session, []);
  const malformed = await resolveStudentAcademicSession(17, "not-a-session", "GLOBAL", dependencies);
  assert.equal(malformed.ok, true);
  assert.deepEqual(calls.session, []);
});

test("active fallback is explicit and never accepts a malformed selection", async () => {
  const { dependencies } = fixture();
  const result = await resolveStudentAcademicSession(17, undefined, "SELECTED_OR_ACTIVE_SESSION", dependencies);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.sessionId, current.id);
  const invalid = await resolveStudentAcademicSession(17, "bad", "SELECTED_OR_ACTIVE_SESSION", dependencies);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "STUDENT_SESSION_INVALID");
  const { dependencies: unavailable } = fixture({ async getActiveSession() { return undefined; } });
  const absent = await resolveStudentAcademicSession(17, undefined, "SELECTED_OR_ACTIVE_SESSION", unavailable);
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.equal(absent.code, "STUDENT_ACTIVE_SESSION_UNAVAILABLE");
});

test("student identity is server-required", async () => {
  const { dependencies } = fixture();
  const absent = await resolveStudentAcademicSession(undefined, "22", "GLOBAL", dependencies);
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.equal(absent.status, 401);
  const unknown = await resolveStudentAcademicSession(99, "22", "SELECTED_SESSION_REQUIRED", dependencies);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.status, 401);
});

test("existing examination resolver delegates to the same school-owned boundary", async () => {
  const { dependencies } = fixture();
  const valid = await resolveStudentExaminationSession(17, 22, dependencies);
  assert.deepEqual(valid, { ok: true, student, schoolId: 1, sessionId: 22 });
  const invalid = await resolveStudentExaminationSession(17, 31, dependencies);
  assert.deepEqual(invalid, { ok: false, status: 403, message: "Invalid academic session" });
});