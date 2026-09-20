import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import {
  createTeacherPasswordRecoveryChallenge,
  hashPasswordRecoverySecret,
} from "../password-recovery";
import { verifyTeacherPasswordRecoveryOtp } from "../teacher-password-recovery";
import { passwordResetChallenges, schools, teachers, users } from "@shared/schema";

type Account = {
  email: string;
  userId: number;
  teacherId?: number;
  schoolId: number;
};

type CreatedChallenge = NonNullable<Awaited<ReturnType<typeof createTeacherPasswordRecoveryChallenge>>>;

let tableAvailable = false;
let serial = 0;
const schoolIds: number[] = [];

async function createSchool(): Promise<number> {
  const suffix = `${Date.now().toString(36)}${serial++}`;
  const [school] = await db.insert(schools).values({
    name: `Teacher OTP Verification ${suffix}`,
    code: `TV-${suffix}`.slice(0, 20),
  }).returning({ id: schools.id });
  schoolIds.push(school.id);
  return school.id;
}

async function createAccount(options: {
  userSchoolId: number;
  teacherSchoolId?: number;
  role?: string;
  userIsActive?: boolean;
  teacherIsActive?: boolean;
  linkedTeacher?: boolean;
  otpCode?: string | null;
  resetToken?: string | null;
}): Promise<Account> {
  const email = `teacher-otp-${Date.now()}-${serial++}@example.test`;
  const [user] = await db.insert(users).values({
    email,
    passwordHash: await bcrypt.hash("teacher-otp-test-password", 10),
    role: options.role ?? "teacher",
    schoolId: options.userSchoolId,
    isActive: options.userIsActive ?? true,
  }).returning({ id: users.id });
  if (options.linkedTeacher === false) {
    return { email, userId: user.id, schoolId: options.userSchoolId };
  }
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId: options.teacherSchoolId ?? options.userSchoolId,
    fullName: `OTP Teacher ${serial}`,
    phone: `6${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Security Testing",
    assignedClass: "1",
    assignedSection: "A",
    isActive: options.teacherIsActive ?? true,
    otpCode: options.otpCode,
    otpExpiresAt: options.otpCode ? new Date(Date.now() + 600_000) : null,
    resetToken: options.resetToken,
    resetTokenExpiresAt: options.resetToken ? new Date(Date.now() + 600_000) : null,
  }).returning({ id: teachers.id });
  return {
    email,
    userId: user.id,
    teacherId: teacher.id,
    schoolId: options.userSchoolId,
  };
}

async function createChallenge(
  account: Account,
  now = new Date(),
): Promise<CreatedChallenge> {
  const result = await createTeacherPasswordRecoveryChallenge(
    account.email,
    account.schoolId,
    null,
    now,
  );
  if (!result) throw new Error("Expected Teacher challenge fixture");
  return result;
}

async function challengeRow(id: number) {
  const row = await storage.getPasswordResetChallenge(id);
  if (!row) throw new Error("Expected password reset challenge");
  return row;
}

async function verify(
  created: CreatedChallenge,
  account: Account,
  otp = created.otp,
  now = new Date(),
) {
  return verifyTeacherPasswordRecoveryOtp(
    created.challenge.id,
    account.userId,
    account.schoolId,
    otp,
    now,
  );
}

async function legacyTeacher(teacherId: number) {
  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, teacherId));
  return teacher;
}

describe("verifyTeacherPasswordRecoveryOtp", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = "teacher-otp-verification-test-secret";
    const result = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.password_reset_challenges') AS table_name",
    );
    tableAvailable = !!result.rows[0]?.table_name;
    if (!tableAvailable) {
      console.warn("SKIP teacher-password-recovery-otp.test.ts: password_reset_challenges is unavailable");
    }
  });

  afterAll(async () => {
    if (schoolIds.length) {
      await db.delete(schools).where(inArray(schools.id, schoolIds));
    }
  });

  it("verifies the correct OTP, rotates the reset token, and leaves the challenge unconsumed", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const createdAt = new Date("2026-09-20T12:00:00.000Z");
    const verifiedAt = new Date("2026-09-20T12:05:00.000Z");
    const created = await createChallenge(account, createdAt);
    const oldTokenHash = created.challenge.resetTokenHash;

    const result = await verify(created, account, created.otp, verifiedAt);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected successful verification");
    expect(result.resetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.resetToken).not.toBe(created.resetToken);
    const stored = await challengeRow(created.challenge.id);
    expect(stored.verifiedAt).toEqual(verifiedAt);
    expect(stored.consumedAt).toBeNull();
    expect(stored.resetTokenExpiresAt).toEqual(new Date(verifiedAt.getTime() + 15 * 60 * 1000));
    expect(stored.resetTokenHash).toBe(hashPasswordRecoverySecret(result.resetToken));
    expect(stored.resetTokenHash).not.toBe(result.resetToken);
    expect(stored.resetTokenHash).not.toBe(oldTokenHash);
    expect(stored.resetTokenHash).not.toBe(hashPasswordRecoverySecret(created.resetToken));
  });

  it("requires the exact challenge, user, and school identity", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const accountA = await createAccount({ userSchoolId: schoolA });
    const accountB = await createAccount({ userSchoolId: schoolB });
    const createdA = await createChallenge(accountA);
    const createdB = await createChallenge(accountB);

    expect((await verifyTeacherPasswordRecoveryOtp(
      createdB.challenge.id, accountA.userId, schoolA, createdA.otp,
    )).success).toBe(false);
    expect((await verifyTeacherPasswordRecoveryOtp(
      createdA.challenge.id, accountB.userId, schoolB, createdA.otp,
    )).success).toBe(false);
    expect((await verifyTeacherPasswordRecoveryOtp(
      createdA.challenge.id, accountA.userId, schoolB, createdA.otp,
    )).success).toBe(false);
    expect((await challengeRow(createdA.challenge.id)).verifiedAt).toBeNull();
    expect((await challengeRow(createdB.challenge.id)).verifiedAt).toBeNull();
  });

  it("independently rejects a wrong challenge ID and a wrong same-school user ID", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const sameSchoolUser = await createAccount({ userSchoolId: schoolId });
    const created = await createChallenge(account);

    expect((await verifyTeacherPasswordRecoveryOtp(
      created.challenge.id + 1_000_000,
      account.userId,
      schoolId,
      created.otp,
    )).success).toBe(false);
    expect((await verifyTeacherPasswordRecoveryOtp(
      created.challenge.id,
      sameSchoolUser.userId,
      schoolId,
      created.otp,
    )).success).toBe(false);
    expect(await challengeRow(created.challenge.id)).toEqual(created.challenge);
  });

  it("rejects both cross-tenant directions without altering either challenge", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const accountA = await createAccount({ userSchoolId: schoolA });
    const accountB = await createAccount({ userSchoolId: schoolB });
    const createdA = await createChallenge(accountA);
    const createdB = await createChallenge(accountB);

    expect((await verifyTeacherPasswordRecoveryOtp(
      createdA.challenge.id, accountB.userId, schoolB, createdA.otp,
    )).success).toBe(false);
    expect((await verifyTeacherPasswordRecoveryOtp(
      createdB.challenge.id, accountA.userId, schoolA, createdB.otp,
    )).success).toBe(false);
    expect(await challengeRow(createdA.challenge.id)).toEqual(createdA.challenge);
    expect(await challengeRow(createdB.challenge.id)).toEqual(createdB.challenge);
  });

  it.each([
    ["non-teacher user", { role: "admin" }],
    ["inactive user", { userIsActive: false }],
    ["inactive Teacher", { teacherIsActive: false }],
    ["missing Teacher relationship", { linkedTeacher: false }],
  ])("rejects a %s account without changing the challenge", async (_label, accountOptions) => {
    if (!tableAvailable) return;
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId, ...accountOptions });
    const otp = "123456";
    const now = new Date();
    const [challenge] = await db.insert(passwordResetChallenges).values({
      userId: account.userId,
      schoolId,
      otpHash: hashPasswordRecoverySecret(otp),
      otpExpiresAt: new Date(now.getTime() + 600_000),
      resetTokenHash: hashPasswordRecoverySecret("initial-token"),
      resetTokenExpiresAt: new Date(now.getTime() + 900_000),
    }).returning();

    expect((await verifyTeacherPasswordRecoveryOtp(
      challenge.id, account.userId, schoolId, otp, now,
    )).success).toBe(false);
    expect(await challengeRow(challenge.id)).toEqual(challenge);
  });

  it("rejects a user/Teacher school mismatch without changing the challenge", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const userSchool = await createSchool();
    const teacherSchool = await createSchool();
    const account = await createAccount({
      userSchoolId: userSchool,
      teacherSchoolId: teacherSchool,
    });
    const otp = "234567";
    const now = new Date();
    const [challenge] = await db.insert(passwordResetChallenges).values({
      userId: account.userId,
      schoolId: userSchool,
      otpHash: hashPasswordRecoverySecret(otp),
      otpExpiresAt: new Date(now.getTime() + 600_000),
      resetTokenHash: hashPasswordRecoverySecret("mismatch-token"),
      resetTokenExpiresAt: new Date(now.getTime() + 900_000),
    }).returning();

    expect((await verifyTeacherPasswordRecoveryOtp(
      challenge.id, account.userId, userSchool, otp, now,
    )).success).toBe(false);
    expect(await challengeRow(challenge.id)).toEqual(challenge);
  });

  it("increments wrong attempts atomically, locks out at five, and rejects a later correct OTP", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const created = await createChallenge(account);
    const originalTokenHash = created.challenge.resetTokenHash;
    const originalTokenExpiry = created.challenge.resetTokenExpiresAt;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await verify(created, account, "000000")).success).toBe(false);
      const stored = await challengeRow(created.challenge.id);
      expect(stored.attemptCount).toBe(attempt);
      expect(stored.consumedAt).toBeNull();
      expect(stored.resetTokenHash).toBe(originalTokenHash);
      expect(stored.resetTokenExpiresAt).toEqual(originalTokenExpiry);
    }
    expect((await verify(created, account, "000000")).success).toBe(false);
    expect((await challengeRow(created.challenge.id)).attemptCount).toBe(5);
    expect((await verify(created, account)).success).toBe(false);
    const stored = await challengeRow(created.challenge.id);
    expect(stored.attemptCount).toBe(5);
    expect(stored.verifiedAt).toBeNull();
    expect(stored.consumedAt).toBeNull();
    expect(stored.resetTokenHash).toBe(originalTokenHash);
    expect(stored.resetTokenExpiresAt).toEqual(originalTokenExpiry);
  });

  it("fails safely when the stored OTP hash is empty", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const created = await createChallenge(account);
    await db.update(passwordResetChallenges)
      .set({ otpHash: "" })
      .where(eq(passwordResetChallenges.id, created.challenge.id));
    const before = await challengeRow(created.challenge.id);

    expect((await verify(created, account)).success).toBe(false);
    const after = await challengeRow(created.challenge.id);
    expect(after.verifiedAt).toBeNull();
    expect(after.consumedAt).toBeNull();
    expect(after.attemptCount).toBe(1);
    expect(after.resetTokenHash).toBe(before.resetTokenHash);
    expect(after.resetTokenExpiresAt).toEqual(before.resetTokenExpiresAt);
  });

  it("rejects expired OTPs and the exact Admin expiry boundary", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const createdAt = new Date("2026-09-20T12:00:00.000Z");
    const created = await createChallenge(account, createdAt);
    const expiry = created.challenge.otpExpiresAt;

    expect((await verify(created, account, created.otp, new Date(expiry.getTime() + 1))).success).toBe(false);
    expect((await verify(created, account, created.otp, expiry)).success).toBe(false);
    expect(await challengeRow(created.challenge.id)).toEqual(created.challenge);
  });

  it("rejects replay, already verified, and consumed challenges without rotating again", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const replay = await createChallenge(account);
    const first = await verify(replay, account);
    expect(first.success).toBe(true);
    const afterFirst = await challengeRow(replay.challenge.id);
    expect((await verify(replay, account)).success).toBe(false);
    expect(await challengeRow(replay.challenge.id)).toEqual(afterFirst);

    const consumed = await createChallenge(account);
    await db.update(passwordResetChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(passwordResetChallenges.id, consumed.challenge.id));
    const consumedBefore = await challengeRow(consumed.challenge.id);
    expect((await verify(consumed, account)).success).toBe(false);
    expect(await challengeRow(consumed.challenge.id)).toEqual(consumedBefore);
  });

  it("leaves another user's and another school's challenges unchanged", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const accountA = await createAccount({ userSchoolId: schoolA });
    const otherUser = await createAccount({ userSchoolId: schoolA });
    const otherSchool = await createAccount({ userSchoolId: schoolB });
    const target = await createChallenge(accountA);
    const otherUserChallenge = await createChallenge(otherUser);
    const otherSchoolChallenge = await createChallenge(otherSchool);

    expect((await verify(target, accountA)).success).toBe(true);
    expect(await challengeRow(otherUserChallenge.challenge.id)).toEqual(otherUserChallenge.challenge);
    expect(await challengeRow(otherSchoolChallenge.challenge.id)).toEqual(otherSchoolChallenge.challenge);
  });

  it("allows exactly one concurrent correct verification and one token rotation", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const created = await createChallenge(account);

    const results = await Promise.all([
      verify(created, account),
      verify(created, account),
    ]);

    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(results.filter(result => !result.success)).toHaveLength(1);
    const successful = results.find(result => result.success);
    if (!successful?.success) throw new Error("Expected one successful verification");
    const stored = await challengeRow(created.challenge.id);
    expect(stored.resetTokenHash).toBe(hashPasswordRecoverySecret(successful.resetToken));
    expect(stored.verifiedAt).not.toBeNull();
    expect(stored.consumedAt).toBeNull();
  });

  it("does not let concurrent incorrect attempts exceed or bypass the five-attempt limit", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const created = await createChallenge(account);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => verify(created, account, "999999")),
    );

    expect(results.every(result => !result.success)).toBe(true);
    expect((await challengeRow(created.challenge.id)).attemptCount).toBe(5);
    expect((await verify(created, account)).success).toBe(false);
  });

  it("rolls back verification and token rotation after a real database failure", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const created = await createChallenge(account);
    const triggerSuffix = `${Date.now()}_${serial++}`;
    const functionName = `fail_teacher_otp_rotation_${triggerSuffix}`;
    const triggerName = `fail_teacher_otp_rotation_${triggerSuffix}`;
    await pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced teacher OTP rotation failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE UPDATE ON password_reset_challenges
      FOR EACH ROW
      WHEN (OLD.id = ${created.challenge.id} AND NEW.verified_at IS NOT NULL)
      EXECUTE FUNCTION ${functionName}()
    `);
    try {
      await expect(verify(created, account)).rejects.toThrow("forced teacher OTP rotation failure");
      expect(await challengeRow(created.challenge.id)).toEqual(created.challenge);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON password_reset_challenges`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  });

  it("leaves legacy fields untouched and emits no secrets through logging", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({
      userSchoolId: schoolId,
      otpCode: "345678",
      resetToken: "legacy-reset-token",
    });
    const created = await createChallenge(account);
    const before = await legacyTeacher(account.teacherId!);
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    try {
      expect((await verify(created, account)).success).toBe(true);
      expect(spies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      spies.forEach(spy => spy.mockRestore());
    }
    const after = await legacyTeacher(account.teacherId!);
    expect(after.otpCode).toBe(before.otpCode);
    expect(after.otpExpiresAt).toEqual(before.otpExpiresAt);
    expect(after.resetToken).toBe(before.resetToken);
    expect(after.resetTokenExpiresAt).toEqual(before.resetTokenExpiresAt);
  });
});