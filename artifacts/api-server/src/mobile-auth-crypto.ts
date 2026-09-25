import { createHash, randomBytes } from "node:crypto";

export const MOBILE_ACCESS_TTL_MS = 15 * 60 * 1000;
export const MOBILE_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MOBILE_CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** Generate opaque credentials with Node's CSPRNG; only their SHA-256 digest is persisted. */
export function createMobileCredential(): string {
  return randomBytes(32).toString("base64url");
}

export function hashMobileCredential(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}