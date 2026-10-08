import assert from "node:assert/strict";
import test from "node:test";
import {
  canFetchStudentDashboardSessionData,
  studentDashboardGlobalQueryKey,
  studentDashboardIdentityQueryPolicy,
  studentDashboardSessionIdFromQueryKey,
  studentDashboardSessionQueryKey,
  resetStudentDashboardIdentity,
} from "./student-dashboard-session";

const sessionResources = [
  "/api/student/attendance/stats",
  "/api/student/homework",
  "/api/student/notices/unread-count",
  "/api/student/fees",
];

test("all session-dependent Dashboard resources have isolated A → B → A keys", () => {
  for (const resource of sessionResources) {
    const sessionA = studentDashboardSessionQueryKey(resource, 21);
    const sessionB = studentDashboardSessionQueryKey(resource, 22);
    const sessionAAgain = studentDashboardSessionQueryKey(resource, 21);

    assert.notDeepEqual(sessionA, sessionB);
    assert.deepEqual(sessionA, sessionAAgain);
    assert.equal(studentDashboardSessionIdFromQueryKey(sessionA), 21);
    assert.equal(studentDashboardSessionIdFromQueryKey(sessionB), 22);
  }
});

test("session-dependent Dashboard requests stay disabled without a verified student session", () => {
  assert.equal(canFetchStudentDashboardSessionData(true, false, 21), true);
  assert.equal(canFetchStudentDashboardSessionData(false, false, 21), false);
  assert.equal(canFetchStudentDashboardSessionData(true, true, 21), false);
  assert.equal(canFetchStudentDashboardSessionData(true, false, null), false);
  assert.throws(
    () => studentDashboardSessionIdFromQueryKey(studentDashboardSessionQueryKey("/api/student/fees", null)),
    /selected academic session is required/,
  );
});

test("global identity and portal configuration keys do not depend on academic session", () => {
  const identity = studentDashboardGlobalQueryKey("/api/student-me");
  const portalInfo = studentDashboardGlobalQueryKey("/api/student/fees/portal-info");
  assert.deepEqual(identity, ["/api/student-me"]);
  assert.deepEqual(portalInfo, ["/api/student/fees/portal-info"]);
});

test("account-switch refresh resets only the Student identity cache key", () => {
  let resetFilters: { queryKey: readonly unknown[]; exact: true } | null = null;

  resetStudentDashboardIdentity(filters => {
    resetFilters = filters;
  });

  assert.deepEqual(resetFilters, {
    queryKey: ["/api/student-me"],
    exact: true,
  });
});

test("Student identity is always refreshed on Dashboard mount and not retained after unmount", () => {
  assert.deepEqual(studentDashboardIdentityQueryPolicy, {
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
});