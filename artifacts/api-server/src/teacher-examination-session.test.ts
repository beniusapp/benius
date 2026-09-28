import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTeacherExaminationSession,
} from "./teacher-examination-session";
import type {
  TeacherAcademicSessionDependencies,
  TeacherAcademicSessionRequest,
} from "./teacher-academic-session";

const dependencies = {
  getTeacherWithSchool: async () => ({
    teacher: { id: 7, userId: 8, schoolId: 11, isActive: true },
    school: { id: 11 },
    user: { id: 8, schoolId: 11, role: "teacher", isActive: true },
  }),
  getAcademicSessionForSchool: async (id: number, schoolId: number) =>
    id === 41 && schoolId === 11
      ? { id: 41, schoolId: 11, isActive: false }
      : id === 42 && schoolId === 11
        ? { id: 42, schoolId: 11, isActive: true }
        : undefined,
  getActiveSession: async () => ({ id: 42, schoolId: 11, isActive: true }),
} as unknown as TeacherAcademicSessionDependencies;

function request(headers: Record<string, string> = {}): TeacherAcademicSessionRequest {
  return {
    session: {
      teacherId: 7,
      userId: 8,
      schoolId: 11,
      userRole: "teacher",
    },
    headers,
    // These untrusted request fields must not replace authenticated identity.
    body: { teacherId: 900, schoolId: 901 },
  } as unknown as TeacherAcademicSessionRequest;
}

test("Teacher Examination resolver requires and validates the selected school session", async () => {
  const historical = await resolveTeacherExaminationSession(
    request({ "x-view-session-id": "41" }),
    dependencies,
  );
  assert.equal(historical.ok, true);
  if (historical.ok) {
    assert.equal(historical.teacher.id, 7);
    assert.equal(historical.schoolId, 11);
    assert.equal(historical.sessionId, 41);
  }

  const missing = await resolveTeacherExaminationSession(request(), dependencies);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 400);

  const malformed = await resolveTeacherExaminationSession(
    request({ "x-view-session-id": "41abc" }),
    dependencies,
  );
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.status, 400);

  const foreign = await resolveTeacherExaminationSession(
    request({ "x-view-session-id": "999" }),
    dependencies,
  );
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.status, 403);
});

test("Teacher Examination current-session writes reject historical sessions", async () => {
  const historicalRead = await resolveTeacherExaminationSession(
    request({ "x-view-session-id": "41" }),
    dependencies,
  );
  assert.equal(historicalRead.ok, true);

  const historicalWrite = await resolveTeacherExaminationSession(
    request({ "x-view-session-id": "41" }),
    dependencies,
    "CURRENT_SESSION_WRITE",
  );
  assert.equal(historicalWrite.ok, false);
  if (!historicalWrite.ok) assert.equal(historicalWrite.status, 403);

  const activeWrite = await resolveTeacherExaminationSession(
    request({ "x-view-session-id": "42" }),
    dependencies,
    "CURRENT_SESSION_WRITE",
  );
  assert.equal(activeWrite.ok, true);
  if (activeWrite.ok) assert.equal(activeWrite.sessionId, 42);
});