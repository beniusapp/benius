import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { hashPasswordRecoverySecret } from "../password-recovery";
import { passwordResetChallenges, schools, teachers, users } from "@shared/schema";

type Account = {
  userId: number;
  teacherId: number;
  schoolId: number;
  password: string;
};

let serial = 0;
const schoolIds: number[] = [];

async function createSchool(): Promise<number> {
  const suffix = `${Date.now().toString(36)}${serial++}`;
  const [school] = await db.insert(schools).values({
    name: `Teacher Password Change ${suffix}`,
    code: `TPC-${suffix}`.slice(0, 20),
  }).returning({ id: schools.id });
  schoolIds.push(school.id);
  return school.id;
}

async function createAccount(options: {
  schoolId: number;
  password?: string;
  userActive?: boolean;
  teacherActive?: boolean;
  mustChangePassword?: boolean;
}): Promise<Account> {
  const password = options.password ?? `old-password-${serial}`;
  const [user] = await db.insert(users).values({
    email: `teacher-password-change-${Date.now()}-${serial++}@example.test`,
    passwordHash: await bcrypt.hash(password, 10),
    role: "teacher",
    schoolId: options.schoolId,
    isActive: options.userActive ?? true,
  }).returning({ id: users.id });
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId: options.schoolId,
    fullName: `Password Change Teacher ${serial}`,
    phone: `7${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Security",
    assignedClass: "1",
    assignedSection: "A",
    isActive: options.teacherActive ?? true,
    mustChangePassword: options.mustChangePassword ?? true,
  }).returning({ id: teachers.id });
  return {
    userId: user.id,
    teacherId: teacher.id,
    schoolId: options.schoolId,
    password,
  };
}

async function createVerifiedChallenge(account: Account, token: string) {
  const now = new Date();
  const [challenge] = await db.insert(passwordResetChallenges).values({
    userId: account.userId,
    schoolId: account.schoolId,
    otpHash: hashPasswordRecoverySecret(`otp-${serial++}`),
    otpExpiresAt: new Date(now.getTime() + 600_000),
    verifiedAt: now,
    resetTokenHash: hashPasswordRecoverySecret(token),
    resetTokenExpiresAt: new Date(now.getTime() + 600_000),
    requestIp: "127.0.0.1",
  }).returning();
  return challenge;
}

async function changePassword(
  account: Account,
  currentPassword: string,
  newPassword: string,
  schoolId = account.schoolId,
) {
  return storage.changeTeacherPasswordAtomically(
    account.userId,
    account.teacherId,
    schoolId,
    currentPassword,
    await bcrypt.hash(newPassword, 10),
  );
}

async function storedPasswordHash(userId: number) {
  const [user] = await db.select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  return user.passwordHash;
}

async function storedMustChangePassword(teacherId: number) {
  const [teacher] = await db.select({ mustChangePassword: teachers.mustChangePassword })
    .from(teachers)
    .where(eq(teachers.id, teacherId));
  return teacher.mustChangePassword;
}

describe("atomic authenticated Teacher password change", () => {
  beforeAll(async () => {
    await db.select({ id: passwordResetChallenges.id })
      .from(passwordResetChallenges)
      .limit(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (schoolIds.length === 0) return;
    const schoolFilter = inArray(schools.id, schoolIds);
    const userRows = await db.select({ id: users.id }).from(users)
      .where(inArray(users.schoolId, schoolIds));
    const userIds = userRows.map(row => row.id);
    if (userIds.length > 0) {
      await db.delete(passwordResetChallenges)
        .where(inArray(passwordResetChallenges.userId, userIds));
      await pool.query(
        `DELETE FROM "session"
         WHERE sess->>'userId' = ANY($1::text[])
            OR sid = ANY($2::text[])`,
        [
          userIds.map(String),
          userIds.map(id => `user-revocation:${id}`),
        ],
      );
    }
    await db.delete(teachers).where(inArray(teachers.schoolId, schoolIds));
    await db.delete(users).where(inArray(users.schoolId, schoolIds));
    await db.delete(schools).where(schoolFilter);
  });

  it("updates the password and mustChangePassword atomically for the authenticated tenant", async () => {
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });
    const challenge = await createVerifiedChallenge(account, "change-wins-token");

    expect(await changePassword(account, account.password, "new-unicode-password-🔐")).toBe(true);
    expect(await bcrypt.compare(
      "new-unicode-password-🔐",
      await storedPasswordHash(account.userId),
    )).toBe(true);
    expect(await storedMustChangePassword(account.teacherId)).toBe(false);

    const [consumed] = await db.select({ consumedAt: passwordResetChallenges.consumedAt })
      .from(passwordResetChallenges)
      .where(eq(passwordResetChallenges.id, challenge.id));
    expect(consumed.consumedAt).toBeInstanceOf(Date);
  });

  it("rejects wrong passwords, foreign tenants, and inactive accounts without partial mutation", async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const account = await createAccount({ schoolId: schoolA });
    const inactive = await createAccount({ schoolId: schoolA, userActive: false });

    expect(await changePassword(account, "wrong-password", "wrong-result")).toBe(false);
    expect(await changePassword(account, account.password, "foreign-result", schoolB)).toBe(false);
    expect(await changePassword(inactive, inactive.password, "inactive-result")).toBe(false);

    expect(await bcrypt.compare(account.password, await storedPasswordHash(account.userId))).toBe(true);
    expect(await storedMustChangePassword(account.teacherId)).toBe(true);
    expect(await bcrypt.compare(inactive.password, await storedPasswordHash(inactive.userId))).toBe(true);
    expect(await storedMustChangePassword(inactive.teacherId)).toBe(true);
  });

  it("allows exactly one concurrent password change using the same old password", async () => {
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });

    const [a, b] = await Promise.all([
      changePassword(account, account.password, "concurrent-password-a"),
      changePassword(account, account.password, "concurrent-password-b"),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    const finalHash = await storedPasswordHash(account.userId);
    const matchesA = await bcrypt.compare("concurrent-password-a", finalHash);
    const matchesB = await bcrypt.compare("concurrent-password-b", finalHash);
    expect(Number(matchesA) + Number(matchesB)).toBe(1);
    expect(await bcrypt.compare(account.password, finalHash)).toBe(false);
    expect(await storedMustChangePassword(account.teacherId)).toBe(false);
  });

  it("prevents a stale authenticated change from overwriting a completed recovery reset", async () => {
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });
    const token = "recovery-wins-token";
    const challenge = await createVerifiedChallenge(account, token);
    const attackerPassword = "attacker-selected-password";
    const recoveryPassword = "recovery-established-password";

    let comparisonReached!: () => void;
    const reachedComparison = new Promise<void>(resolve => {
      comparisonReached = resolve;
    });
    let releaseComparison!: () => void;
    const comparisonReleased = new Promise<void>(resolve => {
      releaseComparison = resolve;
    });
    const realCompare = bcrypt.compare.bind(bcrypt);
    vi.spyOn(bcrypt, "compare").mockImplementation(async (plain, hash) => {
      if (plain === account.password) {
        comparisonReached();
        await comparisonReleased;
      }
      return realCompare(plain, hash);
    });

    const staleChange = changePassword(account, account.password, attackerPassword);
    await reachedComparison;

    const reset = await storage.resetTeacherPasswordForChallenge(
      challenge.id,
      account.userId,
      account.schoolId,
      hashPasswordRecoverySecret(token),
      await bcrypt.hash(recoveryPassword, 10),
    );
    expect(reset).toBe(true);

    releaseComparison();
    expect(await staleChange).toBe(false);
    vi.restoreAllMocks();

    const finalHash = await storedPasswordHash(account.userId);
    expect(await bcrypt.compare(recoveryPassword, finalHash)).toBe(true);
    expect(await bcrypt.compare(account.password, finalHash)).toBe(false);
    expect(await bcrypt.compare(attackerPassword, finalHash)).toBe(false);
  });

  it("prevents recovery from overwriting a password change that committed first", async () => {
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });
    const token = "authenticated-change-wins-token";
    const challenge = await createVerifiedChallenge(account, token);

    expect(await changePassword(account, account.password, "authenticated-winner")).toBe(true);
    expect(await storage.resetTeacherPasswordForChallenge(
      challenge.id,
      account.userId,
      account.schoolId,
      hashPasswordRecoverySecret(token),
      await bcrypt.hash("stale-recovery-password", 10),
    )).toBe(false);

    const finalHash = await storedPasswordHash(account.userId);
    expect(await bcrypt.compare("authenticated-winner", finalHash)).toBe(true);
    expect(await bcrypt.compare("stale-recovery-password", finalHash)).toBe(false);
  });

  it("rolls back the password update if linked Teacher state changes before mutation completes", async () => {
    const schoolId = await createSchool();
    const account = await createAccount({ schoolId });

    let comparisonReached!: () => void;
    const reachedComparison = new Promise<void>(resolve => {
      comparisonReached = resolve;
    });
    let releaseComparison!: () => void;
    const comparisonReleased = new Promise<void>(resolve => {
      releaseComparison = resolve;
    });
    const realCompare = bcrypt.compare.bind(bcrypt);
    vi.spyOn(bcrypt, "compare").mockImplementation(async (plain, hash) => {
      if (plain === account.password) {
        comparisonReached();
        await comparisonReleased;
      }
      return realCompare(plain, hash);
    });

    const change = changePassword(account, account.password, "must-roll-back");
    await reachedComparison;
    await db.update(teachers)
      .set({ isActive: false })
      .where(and(
        eq(teachers.id, account.teacherId),
        eq(teachers.schoolId, account.schoolId),
      ));
    releaseComparison();

    await expect(change).rejects.toThrow("Teacher password state changed during update");
    vi.restoreAllMocks();
    expect(await bcrypt.compare(account.password, await storedPasswordHash(account.userId))).toBe(true);
    expect(await storedMustChangePassword(account.teacherId)).toBe(true);
  });
});