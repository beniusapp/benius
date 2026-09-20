import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import {
  createTeacherPasswordRecoveryChallenge,
  hashPasswordRecoverySecret,
} from "../password-recovery";
import { passwordResetChallenges, schools, teachers, users } from "@shared/schema";

type Account = {
  email: string;
  userId: number;
  teacherId?: number;
  schoolId: number;
};

let tableAvailable = false;
let serial = 0;
const schoolIds: number[] = [];

async function createSchool(): Promise<number> {
  const suffix = `${Date.now().toString(36)}${serial++}`;
  const [school] = await db.insert(schools).values({
    name: `Teacher Recovery Creation ${suffix}`,
    code: `TC-${suffix}`.slice(0, 20),
  }).returning({ id: schools.id });
  schoolIds.push(school.id);
  return school.id;
}

async function createAccount(options: {
  userSchoolId: number;
  teacherSchoolId?: number;
  role?: string;
  isActive?: boolean;
  linkedTeacher?: boolean;
  teacherIsActive?: boolean;
  otpCode?: string | null;
  resetToken?: string | null;
}): Promise<Account> {
  const email = `teacher-challenge-${Date.now()}-${serial++}@example.test`;
  const [user] = await db.insert(users).values({
    email,
    passwordHash: await bcrypt.hash("teacher-recovery-test-password", 10),
    role: options.role ?? "teacher",
    schoolId: options.userSchoolId,
    isActive: options.isActive ?? true,
  }).returning({ id: users.id });
  if (options.linkedTeacher === false) {
    return { email, userId: user.id, schoolId: options.userSchoolId };
  }
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId: options.teacherSchoolId ?? options.userSchoolId,
    fullName: `Recovery Teacher ${serial}`,
    phone: `7${String(user.id).padStart(9, "0").slice(-9)}`,
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

async function activeChallenges(userId: number, schoolId: number) {
  return db.select().from(passwordResetChallenges).where(and(
    eq(passwordResetChallenges.userId, userId),
    eq(passwordResetChallenges.schoolId, schoolId),
  ));
}

async function legacyTeacher(teacherId: number) {
  const [teacher] = await db.select().from(teachers).where(eq(teachers.id, teacherId));
  return teacher;
}

describe("createTeacherPasswordRecoveryChallenge", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = "teacher-recovery-creation-test-secret";
    const result = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.password_reset_challenges') AS table_name",
    );
    tableAvailable = !!result.rows[0]?.table_name;
    if (!tableAvailable) {
      console.warn("SKIP teacher-password-recovery-creation.test.ts: password_reset_challenges is unavailable");
    }
  });

  afterAll(async () => {
    if (schoolIds.length) {
      await db.delete(schools).where(inArray(schools.id, schoolIds));
    }
  });

  it("creates a tenant-bound challenge for the active Teacher with transient secure secrets", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const now = new Date("2026-09-20T12:00:00.000Z");

    const result = await createTeacherPasswordRecoveryChallenge(account.email, schoolId, "127.0.0.1", now);

    expect(result).not.toBeNull();
    expect(result!.otp).toMatch(/^\d{6}$/);
    expect(result!.resetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result!.challenge.userId).toBe(account.userId);
    expect(result!.challenge.schoolId).toBe(schoolId);
    expect(result!.challenge.otpExpiresAt).toEqual(new Date(now.getTime() + 10 * 60 * 1000));
    expect(result!.challenge.resetTokenExpiresAt).toEqual(new Date(now.getTime() + 15 * 60 * 1000));
    expect(result!.challenge.verifiedAt).toBeNull();
    expect(result!.challenge.consumedAt).toBeNull();
    expect(result!.challenge.attemptCount).toBe(0);
    expect(result!.challenge.otpHash).toBe(hashPasswordRecoverySecret(result!.otp));
    expect(result!.challenge.otpHash).not.toBe(result!.otp);
    expect(result!.challenge.resetTokenHash).toBe(hashPasswordRecoverySecret(result!.resetToken));
    expect(result!.challenge.resetTokenHash).not.toBe(result!.resetToken);
  });

  it("produces different OTPs and reset tokens for separate creations", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const firstAccount = await createAccount({ userSchoolId: schoolId });
    const secondAccount = await createAccount({ userSchoolId: schoolId });

    const first = await createTeacherPasswordRecoveryChallenge(firstAccount.email, schoolId, null);
    const second = await createTeacherPasswordRecoveryChallenge(secondAccount.email, schoolId, null);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.otp).not.toBe(second!.otp);
    expect(first!.resetToken).not.toBe(second!.resetToken);
    expect(first!.challenge.otpHash).not.toBe(second!.challenge.otpHash);
    expect(first!.challenge.resetTokenHash).not.toBe(second!.challenge.resetTokenHash);
  });

  it.each([
    ["inactive Teacher", { isActive: false }],
    ["inactive Teacher record", { teacherIsActive: false }],
    ["non-teacher user", { role: "admin" }],
    ["missing Teacher relationship", { linkedTeacher: false }],
  ])("rejects an %s without creating a challenge", async (_label, options) => {
    if (!tableAvailable) return;
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId, ...options });

    expect(await createTeacherPasswordRecoveryChallenge(account.email, schoolId, null)).toBeNull();
    expect(await activeChallenges(account.userId, schoolId)).toHaveLength(0);
  });

  it("rejects a user/Teacher school mismatch", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const userSchool = await createSchool();
    const teacherSchool = await createSchool();
    const account = await createAccount({
      userSchoolId: userSchool,
      teacherSchoolId: teacherSchool,
    });

    expect(await createTeacherPasswordRecoveryChallenge(account.email, userSchool, null)).toBeNull();
    expect(await activeChallenges(account.userId, userSchool)).toHaveLength(0);
    expect(await createTeacherPasswordRecoveryChallenge(account.email, teacherSchool, null)).toBeNull();
    expect(await activeChallenges(account.userId, teacherSchool)).toHaveLength(0);
  });

  it("rejects both cross-tenant lookup directions without disturbing either school's recovery state", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const accountA = await createAccount({ userSchoolId: schoolA });
    const accountB = await createAccount({ userSchoolId: schoolB });
    const existingA = await createTeacherPasswordRecoveryChallenge(accountA.email, schoolA, null);
    const existingB = await createTeacherPasswordRecoveryChallenge(accountB.email, schoolB, null);

    expect(await createTeacherPasswordRecoveryChallenge(accountA.email, schoolB, null)).toBeNull();
    expect(await createTeacherPasswordRecoveryChallenge(accountB.email, schoolA, null)).toBeNull();
    expect((await storage.getPasswordResetChallenge(existingA!.challenge.id))?.consumedAt).toBeNull();
    expect((await storage.getPasswordResetChallenge(existingB!.challenge.id))?.consumedAt).toBeNull();
    expect(await activeChallenges(accountA.userId, schoolB)).toHaveLength(0);
    expect(await activeChallenges(accountB.userId, schoolA)).toHaveLength(0);
  });

  it("atomically replaces only the same Teacher and school's active challenge", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const accountA = await createAccount({ userSchoolId: schoolA });
    const otherUser = await createAccount({ userSchoolId: schoolA });
    const otherSchool = await createAccount({ userSchoolId: schoolB });
    const first = await createTeacherPasswordRecoveryChallenge(accountA.email, schoolA, null);
    const otherUserChallenge = await createTeacherPasswordRecoveryChallenge(otherUser.email, schoolA, null);
    const otherSchoolChallenge = await createTeacherPasswordRecoveryChallenge(otherSchool.email, schoolB, null);
    const [sameUserOtherSchoolChallenge] = await db.insert(passwordResetChallenges).values({
      userId: accountA.userId,
      schoolId: schoolB,
      otpHash: hashPasswordRecoverySecret("cross-school-otp"),
      otpExpiresAt: new Date(Date.now() + 600_000),
      resetTokenHash: hashPasswordRecoverySecret("cross-school-token"),
      resetTokenExpiresAt: new Date(Date.now() + 900_000),
    }).returning();
    const second = await createTeacherPasswordRecoveryChallenge(accountA.email, schoolA, null);

    expect(first!.challenge.id).not.toBe(second!.challenge.id);
    expect(first!.challenge.otpHash).not.toBe(second!.challenge.otpHash);
    expect(first!.challenge.resetTokenHash).not.toBe(second!.challenge.resetTokenHash);
    expect((await storage.getPasswordResetChallenge(first!.challenge.id))?.consumedAt).not.toBeNull();
    expect((await storage.getPasswordResetChallenge(second!.challenge.id))?.consumedAt).toBeNull();
    expect((await storage.getPasswordResetChallenge(otherUserChallenge!.challenge.id))?.consumedAt).toBeNull();
    expect((await storage.getPasswordResetChallenge(otherSchoolChallenge!.challenge.id))?.consumedAt).toBeNull();
    expect((await storage.getPasswordResetChallenge(sameUserOtherSchoolChallenge.id))?.consumedAt).toBeNull();
  });

  it("uses the secure helpers without calling Math.random", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random must not be used for recovery secrets");
    });
    try {
      const result = await createTeacherPasswordRecoveryChallenge(account.email, schoolId, null);
      expect(result).not.toBeNull();
      expect(result!.otp).toMatch(/^\d{6}$/);
      expect(result!.resetToken).toMatch(/^[a-f0-9]{64}$/);
      expect(randomSpy).not.toHaveBeenCalled();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("rolls back prior-challenge invalidation when the new database insert fails", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const existing = await createTeacherPasswordRecoveryChallenge(account.email, schoolId, null);

    await expect(storage.createTeacherPasswordResetChallenge(
      account.userId,
      account.teacherId!,
      schoolId,
      null as unknown as string,
      new Date(Date.now() + 600_000),
      hashPasswordRecoverySecret("rollback-token"),
      new Date(Date.now() + 900_000),
      null,
    )).rejects.toThrow();

    expect((await storage.getPasswordResetChallenge(existing!.challenge.id))?.consumedAt).toBeNull();
    expect(await activeChallenges(account.userId, schoolId)).toHaveLength(1);
  });

  it("leaves all legacy Teacher recovery fields untouched", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({
      userSchoolId: schoolId,
      otpCode: "654321",
      resetToken: "legacy-token",
    });
    const before = await legacyTeacher(account.teacherId!);

    expect(await createTeacherPasswordRecoveryChallenge(account.email, schoolId, null)).not.toBeNull();
    const after = await legacyTeacher(account.teacherId!);
    expect(after.otpCode).toBe(before.otpCode);
    expect(after.otpExpiresAt).toEqual(before.otpExpiresAt);
    expect(after.resetToken).toBe(before.resetToken);
    expect(after.resetTokenExpiresAt).toEqual(before.resetTokenExpiresAt);
  });

  it("does not emit OTPs, tokens, or hashes through application logging", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ userSchoolId: schoolId });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await createTeacherPasswordRecoveryChallenge(account.email, schoolId, null)).not.toBeNull();
      expect(logSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(debugSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});