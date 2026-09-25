import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createMobileCredential,
  createTeacherPasswordChangeChallenge,
  hashMobileCredential,
  MOBILE_ACCESS_TTL_MS,
  MOBILE_CHALLENGE_TTL_MS,
  MOBILE_REFRESH_TTL_MS,
  verifyTeacherPasswordChangeChallenge,
} from "./mobile-auth-crypto";

test("mobile credentials are opaque CSPRNG values and only the expected digest is stored", () => {
  const first = createMobileCredential();
  const second = createMobileCredential();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(hashMobileCredential(first), createHash("sha256").update(first, "utf8").digest("hex"));
  assert.notEqual(hashMobileCredential(first), first);
});

test("mobile credential lifetimes satisfy the contract", () => {
  assert.equal(MOBILE_ACCESS_TTL_MS, 15 * 60 * 1000);
  assert.equal(MOBILE_REFRESH_TTL_MS, 30 * 24 * 60 * 60 * 1000);
});

test("teacher password-change challenges are signed, bounded, and reject replay-time expiry", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-secret-for-mobile-challenge-signing";
  try {
    const token = createTeacherPasswordChangeChallenge({
      userId: 12,
      teacherId: 34,
      schoolId: 56,
      authIssuedAt: Date.now(),
      passwordVersion: "a".repeat(64),
    });
    const claims = verifyTeacherPasswordChangeChallenge(token);
    assert.equal(claims?.purpose, "teacher_password_change");
    assert.equal(claims?.userId, 12);
    assert.equal(claims?.teacherId, 34);
    assert.equal(claims?.schoolId, 56);
    assert.equal(claims?.expiresAt! - claims?.issuedAt!, MOBILE_CHALLENGE_TTL_MS);

    const [body, signature] = token.split(".");
    const changedBody = `${body[0] === "A" ? "B" : "A"}${body.slice(1)}`;
    assert.equal(verifyTeacherPasswordChangeChallenge(`${changedBody}.${signature}`), null);
    assert.equal(verifyTeacherPasswordChangeChallenge(token, Date.now() + MOBILE_CHALLENGE_TTL_MS + 1), null);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});