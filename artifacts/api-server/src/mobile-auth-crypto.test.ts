import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createMobileCredential,
  hashMobileCredential,
  MOBILE_ACCESS_TTL_MS,
  MOBILE_REFRESH_TTL_MS,
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