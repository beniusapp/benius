import assert from "node:assert/strict";
import test from "node:test";
import { resolveAcademicSessionListAccess } from "./academic-session-list-access";

test("Admin retains read access to the authenticated school's sessions", () => {
  assert.deepEqual(
    resolveAcademicSessionListAccess({
      userId: 12,
      userRole: "admin",
      schoolId: 8,
    }),
    { authorized: true, schoolId: 8 },
  );
});

test("authenticated Support Staff can read their school's sessions without a module grant", () => {
  const supportSession = {
    userId: -14,
    userRole: "support_staff",
    staffId: 14,
    schoolId: 8,
    allowedModules: [],
    requestedSchoolId: 99,
  };

  assert.deepEqual(
    resolveAcademicSessionListAccess(supportSession),
    { authorized: true, schoolId: 8 },
  );
});

test("rejects Support Staff sessions with an invalid staff identity", () => {
  assert.deepEqual(
    resolveAcademicSessionListAccess({
      userId: -99,
      userRole: "support_staff",
      staffId: 14,
      schoolId: 8,
    }),
    { authorized: false },
  );
});

test("rejects other roles and unauthenticated sessions", () => {
  assert.deepEqual(
    resolveAcademicSessionListAccess({
      userId: 4,
      userRole: "teacher",
      schoolId: 8,
    }),
    { authorized: false },
  );
  assert.deepEqual(
    resolveAcademicSessionListAccess({
      userRole: "support_staff",
      staffId: 14,
      schoolId: 8,
    }),
    { authorized: false },
  );
});

test("keeps an authenticated reader bound to a valid server-session school", () => {
  assert.deepEqual(
    resolveAcademicSessionListAccess({
      userId: -14,
      userRole: "support_staff",
      staffId: 14,
      schoolId: null,
    }),
    { authorized: true, schoolId: null },
  );
});
