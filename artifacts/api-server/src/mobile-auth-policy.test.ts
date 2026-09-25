import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
  adminInitializationPasswordMatches,
  mobilePrincipalMatchesSession,
  mobileRequestUsesTrustedHttps,
  refreshCredentialDecision,
  rejectBearerOutsideMobileAuth,
  shouldLogJsonResponseBody,
  shouldFallbackToSupportStaff,
} from "./mobile-auth-policy";
import { hashMobileCredential } from "./mobile-auth-crypto";

const now = Date.now();
const validSession = {
  role: "teacher",
  principal_id: 31,
  principal_entity_id: 12,
  school_id: 4,
  principal_password_version: "version-1",
  access_expires_at: new Date(now + 60_000),
  expires_at: new Date(now + 60_000),
  revoked_at: null,
};
const validPrincipal = {
  role: "teacher",
  principalId: 31,
  entityId: 12,
  schoolId: 4,
  passwordVersion: "version-1",
};

test("mobile bearer is accepted only inside the mobile auth route namespace", () => {
  const call = (
    path: string,
    authorization = "Bearer opaque-mobile-token",
    method = "GET",
  ) => {
    let statusCode = 200;
    let responseBody: unknown;
    let continued = false;
    const req = {
      path,
      method,
      get: () => authorization,
    } as unknown as Request;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        responseBody = body;
        return this;
      },
    } as unknown as Response;
    rejectBearerOutsideMobileAuth(req, res, (() => { continued = true; }) as never);
    return { statusCode, responseBody, continued };
  };

  assert.equal(call("/api/mobile/auth/me").continued, true);
  assert.equal(call("/api/mobile/auth/login").continued, true);
  assert.equal(call("/api/mobile/student/dashboard").continued, true);
  for (const [path, method] of [
    ["/api/mobile/student/homework", "GET"],
    ["/api/mobile/student/homework/pending-dates", "GET"],
    ["/api/mobile/student/homework/14", "GET"],
    ["/api/mobile/student/homework/14/submit", "POST"],
    ["/api/mobile/student/classwork", "GET"],
  ]) {
    assert.equal(call(path, "Bearer opaque-mobile-token", method).continued, true);
  }
  for (const [path, method] of [
    ["/api/mobile/student/notices", "GET"],
    ["/api/mobile/student/notices/mark-read", "POST"],
    ["/api/mobile/student/fees/17/invoice", "GET"],
    ["/api/mobile/student/fees/17/receipt", "GET"],
    ["/api/mobile/student/payments/create-order", "POST"],
    ["/api/mobile/student/payments/verify", "POST"],
    ["/api/mobile/student/complaints/17/notes", "GET"],
    ["/api/mobile/student/leave-files/123e4567-e89b-42d3-a456-426614174000.pdf", "GET"],
    ["/api/mobile/teacher/modules/examination/save-scores", "POST"],
    ["/api/mobile/teacher/modules/attendance/self-check-in", "POST"],
    ["/api/mobile/teacher/modules/attendance/self-check-out", "POST"],
    ["/api/mobile/teacher/modules/attendance/self-correction", "POST"],
    ["/api/mobile/teacher/modules/calendar", "GET"],
    ["/api/mobile/teacher/modules/timetable/save", "POST"],
    ["/api/mobile/teacher/modules/timetable/delete", "POST"],
    ["/api/mobile/teacher/modules/homework/private-files/123e4567-e89b-42d3-a456-426614174000.pdf", "GET"],
    ["/api/mobile/teacher/modules/noticeboard/edit", "POST"],
    ["/api/mobile/teacher/modules/noticeboard/delete", "POST"],
    ["/api/mobile/teacher/modules/noticeboard/private-files/123e4567-e89b-42d3-a456-426614174000.pdf", "GET"],
    ["/api/mobile/teacher/modules/complaint/create", "POST"],
    ["/api/mobile/teacher/modules/complaint/private-files/123e4567-e89b-42d3-a456-426614174000.pdf", "GET"],
    ["/api/mobile/admin/modules/exam-controller/decision", "POST"],
    ["/api/mobile/admin/modules/fees/analytics", "GET"],
    ["/api/mobile/admin/modules/fees/invoices/17", "PATCH"],
    ["/api/mobile/admin/modules/fees/transactions/17/receipt", "GET"],
    ["/api/mobile/admin/modules/student-registry/export.xlsx", "GET"],
    ["/api/mobile/admin/modules/student-registry/deactivated/export.xlsx", "GET"],
    ["/api/mobile/admin/modules/student-registry/import.xlsx", "POST"],
    ["/api/mobile/admin/modules/exam-controller/reminder-all", "POST"],
    ["/api/mobile/admin/workflow/noticeboard/actions", "POST"],
    ["/api/mobile/admin/workflow/private-notices/123e4567-e89b-42d3-a456-426614174000.pdf", "GET"],
  ]) {
    assert.equal(call(path, "Bearer opaque-mobile-token", method).continued, true, `${method} ${path}`);
  }
  for (const [path, method] of [
    ["/api/mobile/student/payments/verify/", "POST"],
    ["/api/mobile/teacher/modules/examination/private-files/not-a-uuid.pdf", "GET"],
    ["/api/mobile/teacher/modules/unknown-module", "GET"],
    ["/api/mobile/teacher/modules/noticeboard/delete/", "POST"],
    ["/api/mobile/teacher/modules/attendance/self-check-in", "GET"],
    ["/api/mobile/teacher/modules/timetable/publish", "POST"],
    ["/api/mobile/admin/modules/fees/invoices/17", "POST"],
    ["/api/mobile/admin/workflow/unknown-module/actions", "POST"],
    ["/api/mobile/admin/modules/school-setup/sessions/17/activate", "GET"],
  ]) {
    assert.equal(call(path, "Bearer opaque-mobile-token", method).continued, false, `${method} ${path}`);
  }
  for (const [path, method] of [
    ["/api/mobile/student/homework/14/", "GET"],
    ["/api/mobile/student/homework/14abc", "GET"],
    ["/api/mobile/student/homework/14/submit/", "POST"],
    ["/api/mobile/student/homework/14/submit", "GET"],
    ["/api/mobile/student/homework", "POST"],
    ["/api/mobile/student/classwork/", "GET"],
  ]) {
    assert.equal(call(path, "Bearer opaque-mobile-token", method).continued, false);
  }
  const privateHomeworkFile = "/api/mobile/homework-submission-files/123e4567-e89b-42d3-a456-426614174000.pdf";
  assert.equal(call(privateHomeworkFile, "Bearer opaque-mobile-token", "GET").continued, true);
  assert.equal(call(privateHomeworkFile, "Bearer opaque-mobile-token", "POST").continued, false);
  assert.equal(call(`${privateHomeworkFile}/`, "Bearer opaque-mobile-token", "GET").continued, false);
  assert.equal(call("/api/mobile/homework-submission-files/not-a-uuid.pdf", "Bearer opaque-mobile-token", "GET").continued, false);
  assert.equal(call("/api/mobile/student/dashboard/", "Bearer opaque-mobile-token").continued, false);
  assert.equal(call("/api/mobile/student/dashboard", "Bearer opaque-mobile-token", "POST").continued, false);
  assert.equal(call("/api/mobile/student/profile", "Bearer opaque-mobile-token", "GET").continued, true);
  assert.equal(call("/api/mobile/student/profile", "Bearer opaque-mobile-token", "POST").continued, true);
  assert.equal(call("/api/mobile/student/profile/submit", "Bearer opaque-mobile-token", "POST").continued, true);
  assert.equal(call("/api/mobile/student/profile/photo", "Bearer opaque-mobile-token", "POST").continued, true);
  assert.equal(call("/api/mobile/student/profile/change-password", "Bearer opaque-mobile-token", "POST").continued, true);
  assert.equal(call("/api/mobile/student/profile", "Bearer opaque-mobile-token", "DELETE").continued, false);
  assert.equal(call("/api/mobile/student/profile/", "Bearer opaque-mobile-token", "GET").continued, false);
  assert.equal(call("/api/mobile/student/profile/submit", "Bearer opaque-mobile-token", "GET").continued, false);
  assert.equal(call("/api/mobile/student/profile/unrelated", "Bearer opaque-mobile-token", "POST").continued, false);
  for (const [path, method] of [
    ["/api/mobile/teacher/me", "GET"],
    ["/api/mobile/teacher/pending-profiles/count", "GET"],
    ["/api/mobile/teacher/profile-photo", "POST"],
    ["/api/mobile/teacher/change-password", "POST"],
  ]) {
    assert.equal(call(path, "Bearer opaque-mobile-token", method).continued, true);
    assert.equal(call(`${path}/`, "Bearer opaque-mobile-token", method).continued, false);
    assert.equal(call(path, "Bearer opaque-mobile-token", method === "GET" ? "POST" : "GET").continued, false);
  }
  for (const path of ["/api/mobile/admin/overview", "/api/mobile/admin/profile"]) {
    assert.equal(call(path, "Bearer opaque-mobile-token", "GET").continued, true);
    assert.equal(call(`${path}/`, "Bearer opaque-mobile-token", "GET").continued, false);
    assert.equal(call(path, "Bearer opaque-mobile-token", "POST").continued, false);
  }
  for (const endpoint of ["monthly", "yearly", "stats", "policy"]) {
    assert.equal(call(`/api/mobile/student/attendance/${endpoint}`).continued, true);
    assert.equal(call(`/api/mobile/student/attendance/${endpoint}`, "Bearer opaque-mobile-token", "POST").continued, false);
    assert.equal(call(`/api/mobile/student/attendance/${endpoint}/`).continued, false);
  }
  assert.equal(call("/api/mobile/student/attendance/unrelated").continued, false);
  const webResult = call("/api/admin/profile");
  assert.equal(webResult.statusCode, 401);
  assert.equal(webResult.continued, false);
  assert.deepEqual(webResult.responseBody, {
    message: "Bearer credentials are accepted only by mobile authentication endpoints.",
  });
  assert.equal(call("/dashboard", "Bearer opaque-mobile-token").continued, true);
  assert.equal(call("/api/admin/profile", "").continued, true);
  assert.equal(call("/api/teacher-me").statusCode, 401);
});

test("private student dashboard and profile JSON bodies are excluded from response logging", () => {
  assert.equal(shouldLogJsonResponseBody("/api/mobile/student/dashboard"), false);
  for (const path of [
    "/api/mobile/student/homework",
    "/api/mobile/student/homework/pending-dates",
    "/api/mobile/student/homework/14",
    "/api/mobile/student/homework/14/submit",
    "/api/mobile/student/classwork",
    "/api/mobile/homework-submission-files/123e4567-e89b-42d3-a456-426614174000.pdf",
  ]) {
    assert.equal(shouldLogJsonResponseBody(path), false);
  }
  assert.equal(shouldLogJsonResponseBody("/api/mobile/student/dashboard/"), false);
  assert.equal(shouldLogJsonResponseBody("/api/mobile/student/dashboard/extra"), false);
  for (const path of [
    "/api/mobile/student/profile",
    "/api/mobile/student/profile/submit",
    "/api/mobile/student/profile/photo",
    "/api/mobile/student/profile/change-password",
  ]) {
    assert.equal(shouldLogJsonResponseBody(path), false);
    assert.equal(shouldLogJsonResponseBody(`${path}/`), false);
  }
  assert.equal(shouldLogJsonResponseBody("/api/mobile/auth/me"), false);
  assert.equal(shouldLogJsonResponseBody("/api/mobile/unknown/private-route"), false);
  assert.equal(shouldLogJsonResponseBody("/api/admin/profile"), true);
  for (const path of [
    "/api/mobile/teacher/me",
    "/api/mobile/teacher/pending-profiles/count",
    "/api/mobile/teacher/profile-photo",
    "/api/mobile/teacher/change-password",
  ]) {
    assert.equal(shouldLogJsonResponseBody(path), false);
    assert.equal(shouldLogJsonResponseBody(`${path}/`), false);
  }
  for (const path of ["/api/mobile/admin/overview", "/api/mobile/admin/profile"]) {
    assert.equal(shouldLogJsonResponseBody(path), false);
    assert.equal(shouldLogJsonResponseBody(`${path}/`), false);
  }
  for (const endpoint of ["monthly", "yearly", "stats", "policy"]) {
    const path = `/api/mobile/student/attendance/${endpoint}`;
    assert.equal(shouldLogJsonResponseBody(path), false);
    assert.equal(shouldLogJsonResponseBody(`${path}/`), false);
  }
});

test("forwarded HTTPS is trusted only from local proxy sockets, while native TLS is accepted", () => {
  const request = (remoteAddress: string, forwardedProto: string, encrypted = false) => ({
    hostname: "mobile.example.test",
    headers: { "x-forwarded-proto": forwardedProto },
    socket: { remoteAddress, encrypted },
  }) as unknown as Request;

  assert.equal(mobileRequestUsesTrustedHttps(
    request("203.0.113.25", "https"), "production",
  ), false);
  assert.equal(mobileRequestUsesTrustedHttps(
    request("::ffff:127.0.0.1", "https"), "production",
  ), true);
  assert.equal(mobileRequestUsesTrustedHttps(
    request("::1", "https"), "production",
  ), true);
  assert.equal(mobileRequestUsesTrustedHttps(
    request("203.0.113.25", "http", true), "production",
  ), true);
  assert.equal(mobileRequestUsesTrustedHttps(
    request("203.0.113.25", "https"), "production",
  ), false);
});

test("refresh lifecycle distinguishes valid rotation, reuse, revocation, and expiry", () => {
  const active = {
    now,
    tokenUsedAt: null,
    tokenRevokedAt: null,
    tokenExpiresAt: new Date(now + 60_000),
    sessionRevokedAt: null,
    sessionExpiresAt: new Date(now + 60_000),
  };
  assert.equal(refreshCredentialDecision(active), "rotate");
  assert.equal(refreshCredentialDecision({ ...active, tokenUsedAt: new Date(now) }), "reuse");
  assert.equal(refreshCredentialDecision({ ...active, tokenRevokedAt: new Date(now) }), "reuse");
  assert.equal(refreshCredentialDecision({ ...active, sessionRevokedAt: new Date(now) }), "expired");
  assert.equal(refreshCredentialDecision({
    ...active,
    tokenExpiresAt: new Date(now),
  }), "expired");
  assert.equal(refreshCredentialDecision({
    ...active,
    sessionExpiresAt: new Date(now),
  }), "expired");
});

test("bearer principal binding rejects expired, revoked, wrong-role, wrong-school, or changed-password sessions", () => {
  assert.equal(mobilePrincipalMatchesSession(validSession, validPrincipal, now), true);
  assert.equal(mobilePrincipalMatchesSession(validSession, null, now), false);
  assert.equal(mobilePrincipalMatchesSession({
    ...validSession,
    access_expires_at: new Date(now),
  }, validPrincipal, now), false);
  assert.equal(mobilePrincipalMatchesSession({
    ...validSession,
    access_expires_at: new Date(now),
  }, validPrincipal, now, false), true);
  assert.equal(mobilePrincipalMatchesSession({
    ...validSession,
    revoked_at: new Date(now),
  }, validPrincipal, now), false);
  assert.equal(mobilePrincipalMatchesSession(
    { ...validSession, role: "admin" }, validPrincipal, now,
  ), false);
  assert.equal(mobilePrincipalMatchesSession(
    { ...validSession, school_id: 99 }, validPrincipal, now,
  ), false);
  assert.equal(mobilePrincipalMatchesSession(
    { ...validSession, principal_id: 99 }, validPrincipal, now,
  ), false);
  assert.equal(mobilePrincipalMatchesSession(
    validSession, { ...validPrincipal, passwordVersion: "changed" }, now,
  ), false);
});

test("admin initialization requires the exact password version captured at login", () => {
  const capturedVersion = hashMobileCredential("stored-bcrypt-password-hash");
  assert.equal(adminInitializationPasswordMatches("stored-bcrypt-password-hash", capturedVersion), true);
  assert.equal(adminInitializationPasswordMatches("changed-bcrypt-password-hash", capturedVersion), false);
});

test("support staff fallback follows the existing users-before-staff lookup order", () => {
  assert.equal(shouldFallbackToSupportStaff(false), true);
  assert.equal(shouldFallbackToSupportStaff(true), false);
});