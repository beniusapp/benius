import assert from "node:assert/strict";
import test from "node:test";
import type { AcademicSession, Teacher } from "@workspace/db";
import { resolveTeacherExaminationSession } from "./teacher-examination-session";
import {
  resolveTeacherAcademicSession,
  type TeacherAcademicSessionDependencies,
  type TeacherAcademicSessionRequest,
} from "./teacher-academic-session";

const teacher = {
  id: 7,
  userId: 70,
  schoolId: 1,
  assignedClass: "10",
  assignedSection: "A",
  isActive: true,
} as unknown as Teacher;
const teacherAccount = {
  teacher,
  school: { id: 1 },
  user: { id: 70, role: "teacher", schoolId: 1, isActive: true },
};
const active = { id: 22, schoolId: 1, isActive: true } as AcademicSession;
const historical = { id: 21, schoolId: 1, isActive: false } as AcademicSession;
const foreign = { id: 31, schoolId: 2, isActive: true } as AcademicSession;
const sessions = [active, historical, foreign];

function fixture(overrides: Partial<TeacherAcademicSessionDependencies> = {}) {
  const calls = {
    teacher: [] as number[],
    selected: [] as Array<[number, number]>,
    active: [] as number[],
  };
  const dependencies: TeacherAcademicSessionDependencies = {
    async getTeacherWithSchool(teacherId) {
      calls.teacher.push(teacherId);
      return teacherId === teacher.id ? teacherAccount : undefined;
    },
    async getAcademicSessionForSchool(sessionId, schoolId) {
      calls.selected.push([sessionId, schoolId]);
      return sessions.find(session => session.id === sessionId && session.schoolId === schoolId);
    },
    async getActiveSession(schoolId) {
      calls.active.push(schoolId);
      return schoolId === 1 ? active : undefined;
    },
    ...overrides,
  };
  return { dependencies, calls };
}

function webRequest(
  header: string | string[] | undefined = undefined,
): TeacherAcademicSessionRequest {
  return {
    headers: header === undefined ? {} : { "x-view-session-id": header },
    session: { teacherId: 7, userId: 70, schoolId: 1, userRole: "teacher" },
  };
}

function mobileRequest(
  header: string | string[] | undefined = undefined,
): TeacherAcademicSessionRequest {
  return {
    headers: header === undefined ? {} : { "x-view-session-id": header },
    mobileAuth: {
      principal: {
        id: 7,
        principalId: 70,
        entityId: 7,
        role: "teacher",
        schoolId: 1,
      },
    },
  };
}

test("Web and Mobile accept a selected session from the authenticated Teacher's school", async () => {
  for (const request of [webRequest("22"), mobileRequest("22")]) {
    const { dependencies, calls } = fixture();
    const result = await resolveTeacherAcademicSession(
      request, "SELECTED_SESSION_REQUIRED", dependencies,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.teacher.id, 7);
      assert.equal(result.schoolId, 1);
      assert.equal(result.sessionId, 22);
    }
    assert.deepEqual(calls.selected, [[22, 1]]);
  }
});

test("foreign and nonexistent sessions receive the same tenant-safe rejection", async () => {
  const { dependencies, calls } = fixture();
  const nonexistent = await resolveTeacherAcademicSession(
    webRequest("999"), "SELECTED_SESSION_REQUIRED", dependencies,
  );
  const foreignSession = await resolveTeacherAcademicSession(
    webRequest("31"), "SELECTED_SESSION_REQUIRED", dependencies,
  );
  assert.deepEqual(foreignSession, nonexistent);
  assert.deepEqual(foreignSession, {
    ok: false,
    status: 403,
    code: "TEACHER_SESSION_FORBIDDEN",
    message: "The selected academic session is not available.",
  });
  assert.deepEqual(calls.selected, [[999, 1], [31, 1]]);

  const faultyStorage = fixture({
    async getAcademicSessionForSchool() { return foreign; },
  });
  const leakedRow = await resolveTeacherAcademicSession(
    webRequest("31"), "SELECTED_SESSION_REQUIRED", faultyStorage.dependencies,
  );
  assert.deepEqual(leakedRow, nonexistent);
});

test("malformed and repeated session headers fail without a session lookup", async () => {
  for (const header of [
    "22junk", "22.0", "", " 22", "0", "-1", "9007199254740992", ["22"],
  ]) {
    const { dependencies, calls } = fixture();
    const result = await resolveTeacherAcademicSession(
      webRequest(header), "SELECTED_SESSION_REQUIRED", dependencies,
    );
    assert.equal(result.ok, false, `unexpectedly accepted ${String(header)}`);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.code, "TEACHER_SESSION_INVALID");
    }
    assert.deepEqual(calls.selected, []);
  }
});

test("required and current-write modes reject a missing selected session", async () => {
  for (const mode of ["SELECTED_SESSION_REQUIRED", "CURRENT_SESSION_WRITE"] as const) {
    const { dependencies, calls } = fixture();
    const result = await resolveTeacherAcademicSession(webRequest(), mode, dependencies);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.code, "TEACHER_SESSION_REQUIRED");
    }
    assert.deepEqual(calls.selected, []);
    assert.deepEqual(calls.active, []);
  }
});

test("historical same-school sessions are readable but rejected for current-session writes", async () => {
  const { dependencies } = fixture();
  const read = await resolveTeacherAcademicSession(
    webRequest("21"), "SELECTED_SESSION_REQUIRED", dependencies,
  );
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.session?.isActive, false);

  const write = await resolveTeacherAcademicSession(
    webRequest("21"), "CURRENT_SESSION_WRITE", dependencies,
  );
  assert.equal(write.ok, false);
  if (!write.ok) {
    assert.equal(write.status, 403);
    assert.equal(write.code, "TEACHER_SESSION_READ_ONLY");
  }

  const currentWrite = await resolveTeacherAcademicSession(
    webRequest("22"), "CURRENT_SESSION_WRITE", dependencies,
  );
  assert.equal(currentWrite.ok, true);
});

test("active fallback is explicit and does not mask malformed selection", async () => {
  const { dependencies, calls } = fixture();
  const fallback = await resolveTeacherAcademicSession(
    webRequest(), "SELECTED_OR_ACTIVE_SESSION", dependencies,
  );
  assert.equal(fallback.ok, true);
  if (fallback.ok) assert.equal(fallback.sessionId, active.id);
  assert.deepEqual(calls.active, [1]);

  const invalid = await resolveTeacherAcademicSession(
    webRequest("bad"), "SELECTED_OR_ACTIVE_SESSION", dependencies,
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "TEACHER_SESSION_INVALID");
  assert.deepEqual(calls.active, [1]);

  const unavailable = fixture({ async getActiveSession() { return undefined; } });
  const noActiveSession = await resolveTeacherAcademicSession(
    webRequest(), "SELECTED_OR_ACTIVE_SESSION", unavailable.dependencies,
  );
  assert.equal(noActiveSession.ok, false);
  if (!noActiveSession.ok) {
    assert.equal(noActiveSession.status, 409);
    assert.equal(noActiveSession.code, "TEACHER_ACTIVE_SESSION_UNAVAILABLE");
  }
});

test("GLOBAL resolves the authenticated Teacher but never reads session state", async () => {
  const { dependencies, calls } = fixture();
  const request = webRequest("not-a-session");
  const result = await resolveTeacherAcademicSession(request, "GLOBAL", dependencies);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.schoolId, 1);
    assert.equal(result.session, null);
    assert.equal(result.sessionId, null);
  }
  assert.deepEqual(calls.selected, []);
  assert.deepEqual(calls.active, []);
});

test("client-supplied Teacher and school values do not replace Web session identity", async () => {
  const { dependencies, calls } = fixture();
  const request = Object.assign(webRequest("22"), {
    query: { teacherId: 99, schoolId: 2 },
    body: { teacherId: 99, schoolId: 2 },
  });
  const result = await resolveTeacherAcademicSession(
    request, "SELECTED_SESSION_REQUIRED", dependencies,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls.teacher, [7]);
  assert.deepEqual(calls.selected, [[22, 1]]);
});

test("spoofed or inconsistent authenticated identities fail before session lookup", async () => {
  const badWeb = webRequest("22");
  badWeb.session = { teacherId: 7, userId: 71, schoolId: 1, userRole: "teacher" };
  const badWebSchool = webRequest("22");
  badWebSchool.session = { teacherId: 7, userId: 70, schoolId: 2, userRole: "teacher" };
  const badMobile = mobileRequest("22");
  badMobile.mobileAuth!.principal!.principalId = 71;
  const invalidBearerWithCookie = {
    ...badMobile,
    session: { teacherId: 7, userId: 70, schoolId: 1, userRole: "teacher" },
  };
  for (const request of [badWeb, badWebSchool, badMobile, invalidBearerWithCookie]) {
    const { dependencies, calls } = fixture();
    const result = await resolveTeacherAcademicSession(
      request, "SELECTED_SESSION_REQUIRED", dependencies,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
    assert.deepEqual(calls.selected, []);
  }

  const wrongTenant = fixture({
    async getTeacherWithSchool() {
      return {
        teacher: { ...teacher, schoolId: 2 },
        school: { id: 2 },
        user: { id: 70, role: "teacher", schoolId: 2, isActive: true },
      } as typeof teacherAccount;
    },
  });
  const mismatch = await resolveTeacherAcademicSession(
    webRequest("22"), "SELECTED_SESSION_REQUIRED", wrongTenant.dependencies,
  );
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.status, 401);
  assert.deepEqual(wrongTenant.calls.selected, []);
});

test("unknown Teachers and storage failures fail closed", async () => {
  const unauthenticated = await resolveTeacherAcademicSession(
    { headers: { "x-view-session-id": "22" } },
    "SELECTED_SESSION_REQUIRED",
    fixture().dependencies,
  );
  assert.equal(unauthenticated.ok, false);
  if (!unauthenticated.ok) assert.equal(unauthenticated.status, 401);

  const missingTeacher = fixture({
    async getTeacherWithSchool() { return undefined; },
  });
  const unknown = await resolveTeacherAcademicSession(
    webRequest("22"), "SELECTED_SESSION_REQUIRED", missingTeacher.dependencies,
  );
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.status, 401);

  const failedStorage = fixture({
    async getAcademicSessionForSchool() { throw new Error("database unavailable"); },
  });
  const unavailable = await resolveTeacherAcademicSession(
    webRequest("22"), "SELECTED_SESSION_REQUIRED", failedStorage.dependencies,
  );
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.status, 503);
});

test("Examination wrapper uses the shared selected-session policy", async () => {
  const { dependencies } = fixture();
  const missing = await resolveTeacherExaminationSession(webRequest(), dependencies);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 400);

  const valid = await resolveTeacherExaminationSession(webRequest("22"), dependencies);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.teacher.id, 7);
    assert.equal(valid.schoolId, 1);
    assert.equal(valid.sessionId, 22);
  }
});