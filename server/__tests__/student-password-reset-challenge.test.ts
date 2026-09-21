import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { schools, studentPasswordResetChallenges, students } from "@shared/schema";
import { generatePasswordRecoveryOtp, hashPasswordRecoverySecret, passwordRecoverySecretsEqual } from "../password-recovery";

let serial = 0;
const schoolIds: number[] = [];

async function createSchool() {
  const suffix = `${Date.now()}-${serial++}`;
  const [school] = await db.insert(schools).values({ name: `Reset Test ${suffix}`, code: `SRT-${suffix}` }).returning();
  schoolIds.push(school.id);
  return school;
}
async function createStudent(schoolId: number, overrides: Partial<typeof students.$inferInsert> = {}) {
  const suffix = `${Date.now()}-${serial++}`;
  const [student] = await db.insert(students).values({
    schoolId, digitalStudentId: `SRT-${suffix}`, name: `Student ${suffix}`, class: "10", section: "A",
    phone: String(9200000000 + serial).slice(0, 10), dob: "2010-01-01", passwordHash: `unchanged-${suffix}`,
    email: `student-${suffix}@example.test`, isActive: true, isActivated: true, ...overrides,
  }).returning();
  return student;
}
async function createChallenge(student: typeof students.$inferSelect, otp = "123456", now = new Date()) {
  return storage.createStudentPasswordResetChallenge(
    student.id, student.schoolId, student.email!,
    hashPasswordRecoverySecret(otp),
    new Date(now.getTime() + 10 * 60 * 1000), "127.0.0.1", now,
  );
}

describe("Student password-reset challenge foundation", () => {
  beforeAll(async () => {
    const result = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.student_password_reset_challenges') AS table_name",
    );
    if (!result.rows[0]?.table_name) throw new Error("student_password_reset_challenges is missing");
  });
  afterAll(async () => { if (schoolIds.length) await db.delete(schools).where(inArray(schools.id, schoolIds)); });

  it("creates a tenant-bound challenge from students.email without a contact record", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const challenge = await createChallenge(student);
    expect(challenge).toMatchObject({
      schoolId: school.id, studentId: student.id, purpose: "student_password_recovery",
      attemptCount: 0, consumedAt: null,
    });
    expect(challenge).not.toHaveProperty("contactId");
    expect(challenge!.otpHash).not.toBe("123456");
  });

  it.each([
    ["inactive", { isActive: false }],
    ["unactivated", { isActivated: false }],
    ["missing email", { email: null }],
    ["invalid email", { email: "invalid" }],
  ])("rejects %s Students", async (_label, overrides) => {
    const student = await createStudent((await createSchool()).id, overrides);
    expect(await createChallenge(student)).toBeNull();
  });

  it("rejects cross-school and cross-Student challenge creation", async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const studentA = await createStudent(schoolA.id);
    const studentB = await createStudent(schoolB.id);
    expect(await storage.createStudentPasswordResetChallenge(
      studentA.id, schoolB.id, studentA.email!, hashPasswordRecoverySecret("123456"),
      new Date(Date.now() + 600_000), null,
    )).toBeNull();
    expect(await storage.createStudentPasswordResetChallenge(
      studentB.id, schoolA.id, studentB.email!, hashPasswordRecoverySecret("123456"),
      new Date(Date.now() + 600_000), null,
    )).toBeNull();
  });

  it("replaces only the same Student active challenge", async () => {
    const school = await createSchool();
    const a = await createStudent(school.id);
    const b = await createStudent(school.id);
    const first = await createChallenge(a, "111111");
    const other = await createChallenge(b, "222222");
    const second = await createChallenge(a, "333333");
    expect((await storage.getStudentPasswordResetChallenge(first!.id, a.id, school.id))?.consumedAt).not.toBeNull();
    expect((await storage.getStudentPasswordResetChallenge(other!.id, b.id, school.id))?.consumedAt).toBeNull();
    expect(second?.consumedAt).toBeNull();
  });

  it("serializes concurrent creation to one active challenge", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    await Promise.all([createChallenge(student, "101010"), createChallenge(student, "202020")]);
    const rows = await db.select().from(studentPasswordResetChallenges)
      .where(and(eq(studentPasswordResetChallenges.studentId, student.id), eq(studentPasswordResetChallenges.schoolId, school.id)));
    expect(rows.filter(row => !row.consumedAt)).toHaveLength(1);
  });

  it("requires exact challenge, Student, and school for lookup and invalidation", async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const studentA = await createStudent(schoolA.id);
    const studentB = await createStudent(schoolA.id);
    const challenge = await createChallenge(studentA);
    expect(await storage.getStudentPasswordResetChallenge(challenge!.id, studentA.id, schoolA.id)).toBeDefined();
    expect(await storage.getStudentPasswordResetChallenge(challenge!.id, studentB.id, schoolA.id)).toBeUndefined();
    expect(await storage.getStudentPasswordResetChallenge(challenge!.id, studentA.id, schoolB.id)).toBeUndefined();
    await storage.invalidateStudentPasswordResetChallenge(challenge!.id, studentB.id, schoolA.id);
    expect((await storage.getStudentPasswordResetChallenge(challenge!.id, studentA.id, schoolA.id))!.consumedAt).toBeNull();
    await storage.invalidateStudentPasswordResetChallenge(challenge!.id, studentA.id, schoolA.id);
    expect((await storage.getStudentPasswordResetChallenge(challenge!.id, studentA.id, schoolA.id))!.consumedAt).not.toBeNull();
  });

  it("rejects expired OTPs and caps wrong attempts", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const now = new Date();
    const expired = await createChallenge(student, "444444", now);
    expect(await storage.verifyStudentPasswordResetOtp(expired!.id, student.id, school.id, "444444", new Date(now.getTime() + 600_000))).toBeNull();
    const challenge = await createChallenge(student, "555555");
    for (let i = 0; i < 6; i++) await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "000000");
    expect(await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "555555")).toBeNull();
    expect((await storage.getStudentPasswordResetChallenge(challenge!.id, student.id, school.id))?.attemptCount).toBe(5);
  });

  it("serializes wrong attempts and allows exactly one correct OTP winner", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const challenge = await createChallenge(student, "666666");
    await Promise.all(Array.from({ length: 8 }, () =>
      storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "000000")));
    expect((await storage.getStudentPasswordResetChallenge(challenge!.id, student.id, school.id))?.attemptCount).toBe(5);
    const next = await createChallenge(student, "777777");
    const results = await Promise.all([
      storage.verifyStudentPasswordResetOtp(next!.id, student.id, school.id, "777777"),
      storage.verifyStudentPasswordResetOtp(next!.id, student.id, school.id, "777777"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("stores only HMAC material for OTP and reset token", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const otp = "888888";
    const challenge = await createChallenge(student, otp);
    expect(challenge!.otpHash).not.toContain(otp);
    const token = await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, otp);
    const stored = await storage.getStudentPasswordResetChallenge(challenge!.id, student.id, school.id);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(stored!.resetTokenHash).not.toBe(token);
    expect(passwordRecoverySecretsEqual(stored!.resetTokenHash!, hashPasswordRecoverySecret(token!))).toBe(true);
    expect(stored!.resetTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("invalidates a pending challenge when students.email changes", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const challenge = await createChallenge(student, "515151");
    await storage.updateStudent(student.id, school.id, {
      name: student.name, class: student.class, section: student.section, phone: student.phone,
      email: "replacement@example.test",
    });
    expect(await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "515151")).toBeNull();
    expect((await storage.getStudentPasswordResetChallenge(challenge!.id, student.id, school.id))?.consumedAt).not.toBeNull();
  });

  it("rejects a stale expected email without consuming an active challenge, then accepts the authoritative email", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id, { email: "email-a@example.test" });
    const seeded = await createChallenge(student, "616161");
    const emailB = "email-b@example.test";

    await db.update(students).set({ email: emailB }).where(eq(students.id, student.id));

    const before = await db.select().from(studentPasswordResetChallenges)
      .where(and(
        eq(studentPasswordResetChallenges.studentId, student.id),
        eq(studentPasswordResetChallenges.schoolId, school.id),
      ));
    const stale = await storage.createStudentPasswordResetChallenge(
      student.id,
      school.id,
      "email-a@example.test",
      hashPasswordRecoverySecret("626262"),
      new Date(Date.now() + 10 * 60 * 1000),
      "127.0.0.1",
    );
    const afterStale = await db.select().from(studentPasswordResetChallenges)
      .where(and(
        eq(studentPasswordResetChallenges.studentId, student.id),
        eq(studentPasswordResetChallenges.schoolId, school.id),
      ));

    expect(stale).toBeNull();
    expect(afterStale).toHaveLength(before.length);
    expect(afterStale.find(row => row.id === seeded!.id)?.consumedAt).toBeNull();

    const accepted = await storage.createStudentPasswordResetChallenge(
      student.id,
      school.id,
      emailB,
      hashPasswordRecoverySecret("636363"),
      new Date(Date.now() + 10 * 60 * 1000),
      "127.0.0.1",
    );
    expect(accepted).toMatchObject({
      studentId: student.id,
      schoolId: school.id,
      purpose: "student_password_recovery",
    });
    expect((await storage.getStudentPasswordResetChallenge(
      seeded!.id, student.id, school.id,
    ))?.consumedAt).not.toBeNull();
  });

  it("secures teacher-approved live-profile email updates by tenant and normalized value", async () => {
    const school = await createSchool();
    const otherSchool = await createSchool();
    const student = await createStudent(school.id);

    const changedChallenge = await createChallenge(student, "616161");
    const changedEmail = `teacher-approved-${serial}@example.test`;
    const updated = await storage.updateStudentLiveFieldsForTeacherApproval(student.id, school.id, {
      name: "Teacher Approved Name",
      email: `  ${changedEmail.toUpperCase()} `,
    });
    expect(updated).toMatchObject({
      id: student.id,
      schoolId: school.id,
      name: "Teacher Approved Name",
      email: `  ${changedEmail.toUpperCase()} `,
    });
    expect((await storage.getStudentPasswordResetChallenge(
      changedChallenge!.id, student.id, school.id,
    ))?.consumedAt).not.toBeNull();

    const unchangedChallenge = await createChallenge(updated!, "626262");
    const unchanged = await storage.updateStudentLiveFieldsForTeacherApproval(student.id, school.id, {
      email: `  ${updated!.email!.toUpperCase()}  `,
    });
    expect(unchanged?.schoolId).toBe(school.id);
    expect((await storage.getStudentPasswordResetChallenge(
      unchangedChallenge!.id, student.id, school.id,
    ))?.consumedAt).toBeNull();

    const beforeWrongSchool = await db.select({
      name: students.name,
      email: students.email,
    }).from(students).where(eq(students.id, student.id));
    const wrongSchool = await storage.updateStudentLiveFieldsForTeacherApproval(student.id, otherSchool.id, {
      name: "Wrong School Attempt",
      email: "wrong-school@example.test",
    });
    expect(wrongSchool).toBeUndefined();
    expect(await db.select({
      name: students.name,
      email: students.email,
    }).from(students).where(eq(students.id, student.id))).toEqual(beforeWrongSchool);
    expect((await storage.getStudentPasswordResetChallenge(
      unchangedChallenge!.id, student.id, school.id,
    ))?.consumedAt).toBeNull();
  });

  it("does not log OTP or reset-token material", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const otp = "787878";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const challenge = await createChallenge(student, otp);
      const token = await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, otp);
      const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
      expect(logged).not.toContain(otp);
      expect(logged).not.toContain(token!);
    } finally { logSpy.mockRestore(); errorSpy.mockRestore(); }
  });

  it("enforces database tenant, purpose, and attempt constraints", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const challenge = await createChallenge(student);
    await expect(db.update(studentPasswordResetChallenges).set({ attemptCount: 6 })
      .where(eq(studentPasswordResetChallenges.id, challenge!.id))).rejects.toThrow();
    await expect(db.update(studentPasswordResetChallenges).set({ purpose: "password_reset" })
      .where(eq(studentPasswordResetChallenges.id, challenge!.id))).rejects.toThrow();
  });
});