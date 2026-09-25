import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MOBILE_ACCESS_TTL_MS = 15 * 60 * 1000;
export const MOBILE_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MOBILE_CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type TeacherPasswordChangeChallenge = {
  purpose: "teacher_password_change";
  userId: number;
  teacherId: number;
  schoolId: number;
  authIssuedAt: number;
  passwordVersion: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

/** Generate opaque credentials with Node's CSPRNG; only their SHA-256 digest is persisted. */
export function createMobileCredential(): string {
  return randomBytes(32).toString("base64url");
}

export function hashMobileCredential(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function teacherPasswordChangeSigningKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret?.trim()) throw new Error("SESSION_SECRET is required for teacher password challenges.");
  return createHash("sha256")
    .update("benius/mobile/teacher-password-change/v1\0", "utf8")
    .update(sessionSecret, "utf8")
    .digest();
}

export function createTeacherPasswordChangeChallenge(input: Pick<
  TeacherPasswordChangeChallenge,
  "userId" | "teacherId" | "schoolId" | "authIssuedAt" | "passwordVersion"
>): string {
  const issuedAt = Date.now();
  const claims: TeacherPasswordChangeChallenge = {
    purpose: "teacher_password_change",
    ...input,
    issuedAt,
    expiresAt: issuedAt + MOBILE_CHALLENGE_TTL_MS,
    nonce: createMobileCredential(),
  };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = createHmac("sha256", teacherPasswordChangeSigningKey())
    .update(encoded, "utf8")
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyTeacherPasswordChangeChallenge(
  token: string,
  now = Date.now(),
): TeacherPasswordChangeChallenge | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) {
    return null;
  }

  const expected = createHmac("sha256", teacherPasswordChangeSigningKey())
    .update(parts[0], "utf8")
    .digest();
  const provided = Buffer.from(parts[1], "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<TeacherPasswordChangeChallenge>;
    const positiveInteger = (value: unknown): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value > 0;
    if (
      claims.purpose !== "teacher_password_change"
      || !positiveInteger(claims.userId)
      || !positiveInteger(claims.teacherId)
      || !positiveInteger(claims.schoolId)
      || !positiveInteger(claims.authIssuedAt)
      || typeof claims.passwordVersion !== "string"
      || !/^[a-f0-9]{64}$/.test(claims.passwordVersion)
      || !positiveInteger(claims.issuedAt)
      || !positiveInteger(claims.expiresAt)
      || typeof claims.nonce !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(claims.nonce)
      || claims.issuedAt > now + 30_000
      || claims.expiresAt <= now
      || claims.expiresAt <= claims.issuedAt
      || claims.expiresAt - claims.issuedAt > MOBILE_CHALLENGE_TTL_MS
    ) {
      return null;
    }
    return claims as TeacherPasswordChangeChallenge;
  } catch {
    return null;
  }
}