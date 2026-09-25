import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
  adminInitializationPasswordMatches,
  mobilePrincipalMatchesSession,
  mobileRequestUsesTrustedHttps,
  refreshCredentialDecision,
  rejectBearerOutsideMobileAuth,
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
  const call = (path: string, authorization = "Bearer opaque-mobile-token") => {
    let statusCode = 200;
    let responseBody: unknown;
    let continued = false;
    const req = {
      path,
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
  const webResult = call("/api/admin/profile");
  assert.equal(webResult.statusCode, 401);
  assert.equal(webResult.continued, false);
  assert.deepEqual(webResult.responseBody, {
    message: "Bearer credentials are accepted only by mobile authentication endpoints.",
  });
  assert.equal(call("/dashboard", "Bearer opaque-mobile-token").continued, true);
  assert.equal(call("/api/admin/profile", "").continued, true);
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