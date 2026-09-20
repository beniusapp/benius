import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { passwordResetChallenges, schools, teachers, users } from "@shared/schema";
import { hashPasswordRecoverySecret } from "../password-recovery";

type Account = {
  userId: number;
  teacherId?: number;
  schoolId: number;
  password: string;
};

let tableAvailable = false;
let serial = 0;
const schoolIds: number[] = [];

async function createSchool(): Promise<number> {
  const suffix = `${Date.now().toString(36)}${serial++}`;
  const [row] = await db.insert(schools).values({
    name: `Teacher Reset School ${suffix}`,
    code: `TR-${suffix}`.slice(0, 20),
  }).returning({ id: schools.id });
  schoolIds.push(row.id);
  return row.id;
}

async function createAccount(options: {
  schoolId: number;
  role?: string;
  isActive?: boolean;
  teacherSchoolId?: number;
  linkedTeacher?: boolean;
  mustChangePassword?: boolean;
  otpCode?: string | null;
  resetToken?: string | null;
}): Promise<Account> {
  const password = `old-password-${serial}`;
  const [user] = await db.insert(users).values({
    email: `teacher-reset-${Date.now()}-${serial++}@example.test`,
    passwordHash: await bcrypt.hash(password, 10),
    role: options.role ?? "teacher",
    schoolId: options.schoolId,
    isActive: options.isActive ?? true,
  }).returning({ id: users.id });
  if (options.linkedTeacher === false) {
    return { userId: user.id, schoolId: options.schoolId, password };
  }
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId: options.teacherSchoolId ?? options.schoolId,
    fullName: `Teacher Reset ${serial}`,
    phone: `8${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Security Testing",
    assignedClass: "1",
    assignedSection: "A",
    mustChangePassword: options.mustChangePassword ?? true,
    otpCode: options.otpCode,
    otpExpiresAt: options.otpCode ? new Date(Date.now() + 600_000) : null,
    resetToken: options.resetToken,
    resetTokenExpiresAt: options.resetToken ? new Date(Date.now() + 600_000) : null,
  }).returning({ id: teachers.id });
  return {
    userId: user.id,
    teacherId: teacher.id,
    schoolId: options.schoolId,
    password,
  };
}

async function createChallenge(
  account: Pick<Account, "userId" | "schoolId">,
  token: string,
  options: {
    verified?: boolean;
    consumed?: boolean;
    expired?: boolean;
  } = {},
) {
  const now = new Date();
  const [row] = await db.insert(passwordResetChallenges).values({
    userId: account.userId,
    schoolId: account.schoolId,
    otpHash: hashPasswordRecoverySecret(`otp-${serial++}`),
    otpExpiresAt: new Date(now.getTime() + 600_000),
    verifiedAt: options.verified === false ? null : now,
    resetTokenHash: hashPasswordRecoverySecret(token),
    resetTokenExpiresAt: new Date(now.getTime() + (options.expired ? -1_000 : 600_000)),
    consumedAt: options.consumed ? now : null,
    requestIp: "127.0.0.1",
  }).returning();
  return row;
}

async function reset(
  challengeId: number,
  account: Pick<Account, "userId" | "schoolId">,
  token: string,
  password: string,
) {
  return storage.resetTeacherPasswordForChallenge(
    challengeId,
    account.userId,
    account.schoolId,
    hashPasswordRecoverySecret(token),
    await bcrypt.hash(password, 10),
  );
}

async function storedUser(userId: number) {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row;
}

async function storedTeacher(teacherId: number) {
  const [row] = await db.select().from(teachers).where(eq(teachers.id, teacherId));
  return row;
}

describe("resetTeacherPasswordForChallenge", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = "teacher-password-reset-storage-test-secret";
    const result = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.password_reset_challenges') AS table_name",
    );
    tableAvailable = !!result.rows[0]?.table_name;
    if (!tableAvailable) {
      console.warn("SKIP teacher-password-reset-storage.test.ts: password_reset_challenges is unavailable");
    }
  });

  afterAll(async () => {
    if (schoolIds.length) {
      await db.delete(schools).where(inArray(schools.id, schoolIds));
    }
  });

  it("resets the correct active Teacher in the correct school and stores only the bcrypt hash", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });
    const token = "valid-token";
    const challenge = await createChallenge(account, token);
    const newPassword = "new-secure-password";

    expect(await reset(challenge.id, account, token, newPassword)).toBe(true);

    const user = await storedUser(account.userId);
    expect(await bcrypt.compare(account.password, user.passwordHash)).toBe(false);
    expect(await bcrypt.compare(newPassword, user.passwordHash)).toBe(true);
    expect(user.passwordHash).not.toBe(newPassword);
    expect((await storedTeacher(account.teacherId!)).mustChangePassword).toBe(false);
    expect((await storage.getPasswordResetChallenge(challenge.id))?.consumedAt).not.toBeNull();
  });

  it("rejects wrong user ID and wrong school ID without changing or consuming anything", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const accountA = await createAccount({ schoolId: schoolA });
    const accountB = await createAccount({ schoolId: schoolB });
    const challengeA = await createChallenge(accountA, "token-a");

    expect(await reset(challengeA.id, { userId: accountB.userId, schoolId: schoolA }, "token-a", "wrong-user")).toBe(false);
    expect(await reset(challengeA.id, { userId: accountA.userId, schoolId: schoolB }, "token-a", "wrong-school")).toBe(false);
    expect(await bcrypt.compare(accountA.password, (await storedUser(accountA.userId)).passwordHash)).toBe(true);
    expect(await bcrypt.compare(accountB.password, (await storedUser(accountB.userId)).passwordHash)).toBe(true);
    expect((await storage.getPasswordResetChallenge(challengeA.id))?.consumedAt).toBeNull();
  });

  it("rejects both cross-tenant challenge directions and preserves both accounts and challenges", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const accountA = await createAccount({ schoolId: schoolA });
    const accountB = await createAccount({ schoolId: schoolB });
    const challengeA = await createChallenge(accountA, "cross-a");
    const challengeB = await createChallenge(accountB, "cross-b");

    expect(await reset(challengeA.id, accountB, "cross-a", "cross-reset-a")).toBe(false);
    expect(await reset(challengeB.id, accountA, "cross-b", "cross-reset-b")).toBe(false);
    expect(await bcrypt.compare(accountA.password, (await storedUser(accountA.userId)).passwordHash)).toBe(true);
    expect(await bcrypt.compare(accountB.password, (await storedUser(accountB.userId)).passwordHash)).toBe(true);
    expect((await storage.getPasswordResetChallenge(challengeA.id))?.consumedAt).toBeNull();
    expect((await storage.getPasswordResetChallenge(challengeB.id))?.consumedAt).toBeNull();
  });

  it.each([
    ["non-teacher role", { role: "admin" }],
    ["inactive user", { isActive: false }],
    ["missing linked Teacher", { linkedTeacher: false }],
  ])("rejects %s without changing or consuming the challenge", async (_label, accountOptions) => {
    if (!tableAvailable) return;
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId, ...accountOptions });
    const challenge = await createChallenge(account, "invalid-account-token");

    expect(await reset(challenge.id, account, "invalid-account-token", "must-not-apply")).toBe(false);
    expect(await bcrypt.compare(account.password, (await storedUser(account.userId)).passwordHash)).toBe(true);
    expect((await storage.getPasswordResetChallenge(challenge.id))?.consumedAt).toBeNull();
  });

  it("rejects a Teacher school mismatch", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const userSchool = await createSchool();
    const teacherSchool = await createSchool();
    const account = await createAccount({ schoolId: userSchool, teacherSchoolId: teacherSchool });
    const challenge = await createChallenge(account, "teacher-school-mismatch");

    expect(await reset(challenge.id, account, "teacher-school-mismatch", "must-not-apply")).toBe(false);
    expect(await bcrypt.compare(account.password, (await storedUser(account.userId)).passwordHash)).toBe(true);
    expect((await storage.getPasswordResetChallenge(challenge.id))?.consumedAt).toBeNull();
  });

  it("rejects a user school mismatch", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const userSchool = await createSchool();
    const suppliedSchool = await createSchool();
    const account = await createAccount({ schoolId: userSchool });
    const challenge = await createChallenge(account, "user-school-mismatch");

    expect(await reset(challenge.id, { userId: account.userId, schoolId: suppliedSchool }, "user-school-mismatch", "must-not-apply")).toBe(false);
    expect(await bcrypt.compare(account.password, (await storedUser(account.userId)).passwordHash)).toBe(true);
    expect((await storage.getPasswordResetChallenge(challenge.id))?.consumedAt).toBeNull();
  });

  it.each([
    ["unverified challenge", { verified: false }, "valid-token"],
    ["consumed challenge", { consumed: true }, "valid-token"],
    ["expired reset token", { expired: true }, "valid-token"],
    ["wrong reset-token HMAC", {}, "wrong-token"],
  ])("rejects an %s without changing the password", async (_label, challengeOptions, suppliedToken) => {
    if (!tableAvailable) return;
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });
    const challenge = await createChallenge(account, "valid-token", challengeOptions);
    const consumedBefore = challenge.consumedAt;

    expect(await reset(challenge.id, account, suppliedToken, "must-not-apply")).toBe(false);
    expect(await bcrypt.compare(account.password, (await storedUser(account.userId)).passwordHash)).toBe(true);
    expect((await storage.getPasswordResetChallenge(challenge.id))?.consumedAt).toEqual(consumedBefore);
  });

  it("accepts a reset token whose expiry equals the supplied current time", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });
    const token = "boundary-token";
    const boundary = new Date(Date.now() + 60_000);
    const challenge = await createChallenge(account, token);
    await db.update(passwordResetChallenges)
      .set({ resetTokenExpiresAt: boundary })
      .where(eq(passwordResetChallenges.id, challenge.id));
    const newPasswordHash = await bcrypt.hash("boundary-password", 10);

    expect(await storage.resetTeacherPasswordForChallenge(
      challenge.id,
      account.userId,
      schoolId,
      hashPasswordRecoverySecret(token),
      newPasswordHash,
      boundary,
    )).toBe(true);
    expect(await bcrypt.compare("boundary-password", (await storedUser(account.userId)).passwordHash)).toBe(true);
  });

  it("consumes every active challenge for the same user and school only", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const accountA = await createAccount({ schoolId: schoolA });
    const otherUser = await createAccount({ schoolId: schoolA });
    const otherSchoolUser = await createAccount({ schoolId: schoolB });
    const current = await createChallenge(accountA, "current-token");
    const sameAccount = await createChallenge(accountA, "same-account-token");
    const otherUserChallenge = await createChallenge(otherUser, "other-user-token");
    const otherSchoolChallenge = await createChallenge(otherSchoolUser, "other-school-token");

    expect(await reset(current.id, accountA, "current-token", "new-password")).toBe(true);
    expect((await storage.getPasswordResetChallenge(current.id))?.consumedAt).not.toBeNull();
    expect((await storage.getPasswordResetChallenge(sameAccount.id))?.consumedAt).not.toBeNull();
    expect((await storage.getPasswordResetChallenge(otherUserChallenge.id))?.consumedAt).toBeNull();
    expect((await storage.getPasswordResetChallenge(otherSchoolChallenge.id))?.consumedAt).toBeNull();
  });

  it("allows exactly one of two concurrent resets using the same challenge", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });
    const challenge = await createChallenge(account, "concurrent-token");
    const hashA = await bcrypt.hash("concurrent-password-a", 10);
    const hashB = await bcrypt.hash("concurrent-password-b", 10);

    const results = await Promise.all([
      storage.resetTeacherPasswordForChallenge(
        challenge.id, account.userId, schoolId, hashPasswordRecoverySecret("concurrent-token"), hashA,
      ),
      storage.resetTeacherPasswordForChallenge(
        challenge.id, account.userId, schoolId, hashPasswordRecoverySecret("concurrent-token"), hashB,
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(result => !result)).toHaveLength(1);
    const finalHash = (await storedUser(account.userId)).passwordHash;
    const expectedPassword = results[0] ? "concurrent-password-a" : "concurrent-password-b";
    expect(await bcrypt.compare(expectedPassword, finalHash)).toBe(true);
    expect((await storage.getPasswordResetChallenge(challenge.id))?.consumedAt).not.toBeNull();
  });

  it("does not read, clear, or modify legacy Teacher recovery fields", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({
      schoolId,
      otpCode: "123456",
      resetToken: "legacy-reset-token",
    });
    const before = await storedTeacher(account.teacherId!);
    const challenge = await createChallenge(account, "modern-token");

    expect(await reset(challenge.id, account, "modern-token", "new-password")).toBe(true);
    const after = await storedTeacher(account.teacherId!);
    expect(after.otpCode).toBe(before.otpCode);
    expect(after.otpExpiresAt).toEqual(before.otpExpiresAt);
    expect(after.resetToken).toBe(before.resetToken);
    expect(after.resetTokenExpiresAt).toEqual(before.resetTokenExpiresAt);
  });

  it("uses exact challenge, user, school, and token identity", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });
    const challenge = await createChallenge(account, "exact-token");
    const unrelated = await createChallenge(account, "unrelated-token");

    expect(await reset(unrelated.id, account, "exact-token", "must-not-apply")).toBe(false);
    expect(await bcrypt.compare(account.password, (await storedUser(account.userId)).passwordHash)).toBe(true);
    expect((await storage.getPasswordResetChallenge(challenge.id))?.consumedAt).toBeNull();
    expect((await storage.getPasswordResetChallenge(unrelated.id))?.consumedAt).toBeNull();
  });

  it("leaves no partial state after a failed reset", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId, mustChangePassword: true });
    const challenge = await createChallenge(account, "rollback-token");

    expect(await reset(challenge.id, account, "incorrect-token", "must-not-apply")).toBe(false);
    expect(await bcrypt.compare(account.password, (await storedUser(account.userId)).passwordHash)).toBe(true);
    expect((await storedTeacher(account.teacherId!)).mustChangePassword).toBe(true);
    expect((await storage.getPasswordResetChallenge(challenge.id))?.consumedAt).toBeNull();
  });

  it("does not disturb consumed challenges when invalidating remaining active challenges", async ({ skip }) => {
    if (!tableAvailable) return skip();
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });
    const current = await createChallenge(account, "active-token");
    const alreadyConsumed = await createChallenge(account, "consumed-token", { consumed: true });
    const consumedAt = alreadyConsumed.consumedAt;

    expect(await reset(current.id, account, "active-token", "new-password")).toBe(true);
    const rows = await db.select().from(passwordResetChallenges).where(and(
      eq(passwordResetChallenges.userId, account.userId),
      eq(passwordResetChallenges.schoolId, schoolId),
    ));
    expect(rows.find(row => row.id === alreadyConsumed.id)?.consumedAt).toEqual(consumedAt);
  });
});