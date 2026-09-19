import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { passwordResetChallenges, schools, users } from "@shared/schema";
import { generatePasswordRecoveryToken, hashPasswordRecoverySecret } from "../password-recovery";

let tableAvailable = false;
let serial = 0;
const schoolIds: number[] = [];
const userIds: number[] = [];

async function school(): Promise<number> {
  const suffix = `${Date.now()}-${serial++}`;
  const [row] = await db.insert(schools).values({ name: `Recovery DB Test ${suffix}`, code: `RDB-${suffix}` }).returning({ id: schools.id });
  schoolIds.push(row.id);
  return row.id;
}

async function admin(schoolId: number, recoveryEmail = `recovery-${serial}@example.test`): Promise<number> {
  const [row] = await db.insert(users).values({
    email: `admin-${Date.now()}-${serial++}@example.test`,
    passwordHash: await bcrypt.hash("old-password", 10),
    role: "admin",
    schoolId,
    recoveryEmail,
    isActive: true,
  }).returning({ id: users.id });
  userIds.push(row.id);
  return row.id;
}

async function challenge(userId: number, schoolId: number, otp: string, expiresAt = new Date(Date.now() + 600_000)) {
  return storage.createPasswordResetChallenge(userId, schoolId, hashPasswordRecoverySecret(otp), expiresAt, "127.0.0.1");
}

async function verify(challengeId: number, otp: string, token: string) {
  return storage.verifyPasswordResetOtp(
    challengeId,
    hashPasswordRecoverySecret(otp),
    hashPasswordRecoverySecret(token),
    new Date(Date.now() + 900_000),
  );
}

describe("password recovery database lifecycle", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = "password-recovery-storage-test-secret";
    const result = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.password_reset_challenges') AS table_name",
    );
    tableAvailable = !!result.rows[0]?.table_name;
    if (!tableAvailable) {
      console.warn("SKIP password-recovery-storage.test.ts: apply migrations/008_password_reset_challenges.sql first");
    }
  });

  afterAll(async () => {
    if (!tableAvailable) return;
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    if (schoolIds.length) await db.delete(schools).where(inArray(schools.id, schoolIds));
  });

  it("tenant-scopes recovery-email lookup and replacement invalidates the prior challenge", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolA = await school();
    const schoolB = await school();
    const email = "same@example.test";
    const userA = await admin(schoolA, email);
    const userB = await admin(schoolB, email);
    expect((await storage.getUserByRecoveryEmail(email, schoolA))?.id).toBe(userA);
    expect((await storage.getUserByRecoveryEmail(email, schoolB))?.id).toBe(userB);
    const first = await challenge(userA, schoolA, "111111");
    const second = await challenge(userA, schoolA, "222222");
    expect((await storage.getPasswordResetChallenge(first.id))?.consumedAt).not.toBeNull();
    expect((await storage.getPasswordResetChallenge(second.id))?.consumedAt).toBeNull();
  });

  it("rejects expired OTPs and consumes a challenge after five failed attempts", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await school();
    const userId = await admin(schoolId);
    const expired = await challenge(userId, schoolId, "333333", new Date(Date.now() - 1));
    expect(await verify(expired.id, "333333", generatePasswordRecoveryToken())).toBeUndefined();
    const locked = await challenge(userId, schoolId, "444444");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await storage.recordPasswordResetOtpFailure(locked.id)).toBeTruthy();
    }
    const lockedRow = await storage.getPasswordResetChallenge(locked.id);
    expect(lockedRow?.attemptCount).toBe(5);
    expect(lockedRow?.consumedAt).not.toBeNull();
    expect(await storage.recordPasswordResetOtpFailure(locked.id)).toBeUndefined();
  });

  it("verifies a valid OTP only once and stores hashes rather than plaintext secrets", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await school();
    const userId = await admin(schoolId);
    const otp = "555555";
    const token = generatePasswordRecoveryToken();
    const row = await challenge(userId, schoolId, otp);
    expect(await verify(row.id, otp, token)).toBeTruthy();
    expect(await verify(row.id, otp, generatePasswordRecoveryToken())).toBeUndefined();
    const stored = await storage.getPasswordResetChallenge(row.id);
    expect(stored?.otpHash).not.toBe(otp);
    expect(stored?.resetTokenHash).not.toBe(token);
  });

  it("rejects wrong tenant, user, or token and leaves the valid challenge usable", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolA = await school();
    const schoolB = await school();
    const userA = await admin(schoolA);
    const userB = await admin(schoolB);
    const token = generatePasswordRecoveryToken();
    const row = await challenge(userA, schoolA, "666666");
    expect(await verify(row.id, "666666", token)).toBeTruthy();
    const newHash = await bcrypt.hash("new-password", 10);
    expect(await storage.resetPasswordForChallenge(row.id, userB, schoolB, hashPasswordRecoverySecret(token), newHash)).toBe(false);
    expect(await storage.resetPasswordForChallenge(row.id, userA, schoolA, hashPasswordRecoverySecret("wrong"), newHash)).toBe(false);
    expect((await storage.getPasswordResetChallenge(row.id))?.consumedAt).toBeNull();
  });

  it("atomically updates bcrypt password, invalidates all account challenges, and never stores plaintext password", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await school();
    const userId = await admin(schoolId);
    const oldChallenge = await challenge(userId, schoolId, "777777");
    const currentChallenge = await challenge(userId, schoolId, "888888");
    const token = generatePasswordRecoveryToken();
    expect(await verify(currentChallenge.id, "888888", token)).toBeTruthy();
    const newPassword = "new-secure-password";
    const newHash = await bcrypt.hash(newPassword, 10);
    expect(await storage.resetPasswordForChallenge(currentChallenge.id, userId, schoolId, hashPasswordRecoverySecret(token), newHash)).toBe(true);
    const updated = await storage.getUserById(userId);
    expect(await bcrypt.compare("old-password", updated!.passwordHash)).toBe(false);
    expect(await bcrypt.compare(newPassword, updated!.passwordHash)).toBe(true);
    expect(updated!.passwordHash).not.toBe(newPassword);
    const rows = await db.select().from(passwordResetChallenges).where(and(
      eq(passwordResetChallenges.userId, userId),
      eq(passwordResetChallenges.schoolId, schoolId),
    ));
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.consumedAt !== null)).toBe(true);
    expect((await storage.getPasswordResetChallenge(oldChallenge.id))?.otpHash).not.toBe("777777");
  });
});