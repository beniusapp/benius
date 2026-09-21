import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import {
  schools,
  studentPasswordResetChallenges,
  students,
  studentVerifiedRecoveryContacts,
} from "@shared/schema";
import {
  generatePasswordRecoveryOtp,
  hashPasswordRecoverySecret,
  passwordRecoverySecretsEqual,
} from "../password-recovery";

let serial = 0;
const schoolIds: number[] = [];

async function createSchool() {
  const suffix = `${Date.now()}-${serial++}`;
  const [school] = await db.insert(schools).values({
    name: `Student Reset Test ${suffix}`,
    code: `SRT-${suffix}`,
  }).returning();
  schoolIds.push(school.id);
  return school;
}

async function createStudent(schoolId: number, overrides: Partial<typeof students.$inferInsert> = {}) {
  const suffix = `${Date.now()}-${serial++}`;
  const [student] = await db.insert(students).values({
    schoolId,
    digitalStudentId: `SRT-${suffix}`,
    name: `Student ${suffix}`,
    class: "10",
    section: "A",
    phone: String(9200000000 + serial).slice(0, 10),
    dob: "2010-01-01",
    passwordHash: `unchanged-${suffix}`,
    email: `student-${suffix}@example.test`,
    isActive: true,
    isActivated: true,
    ...overrides,
  }).returning();
  return student;
}

async function createContact(student: typeof students.$inferSelect, verified = true) {
  const [contact] = await db.insert(studentVerifiedRecoveryContacts).values({
    schoolId: student.schoolId,
    studentId: student.id,
    contactType: "email",
    contactValue: student.email!,
    contactValueNormalized: student.email!.trim().toLowerCase(),
    verifiedAt: verified ? new Date() : null,
    verificationMethod: verified ? "email_otp" : null,
  }).returning();
  return contact;
}

async function createChallenge(
  student: typeof students.$inferSelect,
  contactId: number,
  otp = "123456",
  now = new Date(),
) {
  return storage.createStudentPasswordResetChallenge(
    student.id,
    student.schoolId,
    contactId,
    hashPasswordRecoverySecret(otp),
    new Date(now.getTime() + 10 * 60 * 1000),
    "127.0.0.1",
    now,
  );
}

describe("Student password-reset challenge foundation", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = "student-reset-foundation-secret";
    const result = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.student_password_reset_challenges') AS table_name",
    );
    if (!result.rows[0]?.table_name) {
      throw new Error("student_password_reset_challenges is missing; migration 010 must be applied");
    }
  });

  afterAll(async () => {
    if (schoolIds.length) await db.delete(schools).where(inArray(schools.id, schoolIds));
  });

  it("creates a tenant-bound challenge only for an active, activated Student's current verified contact", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const beforePassword = student.passwordHash;
    const challenge = await createChallenge(student, contact.id);
    expect(challenge).toMatchObject({
      schoolId: school.id,
      studentId: student.id,
      contactId: contact.id,
      purpose: "student_password_recovery",
      attemptCount: 0,
      consumedAt: null,
    });
    expect(challenge!.otpHash).not.toBe("123456");
    const [after] = await db.select().from(students).where(eq(students.id, student.id));
    expect(after.passwordHash).toBe(beforePassword);
    expect(after.isActive).toBe(true);
    expect(after.isActivated).toBe(true);
  });

  it("rejects unverified, stale-email, inactive, and unactivated contacts", async () => {
    const school = await createSchool();
    const unverifiedStudent = await createStudent(school.id);
    const unverified = await createContact(unverifiedStudent, false);
    expect(await createChallenge(unverifiedStudent, unverified.id)).toBeNull();

    const inactiveStudent = await createStudent(school.id, { isActive: false });
    const inactiveContact = await createContact(inactiveStudent);
    expect(await createChallenge(inactiveStudent, inactiveContact.id)).toBeNull();

    const unactivatedStudent = await createStudent(school.id, { isActivated: false });
    const unactivatedContact = await createContact(unactivatedStudent);
    expect(await createChallenge(unactivatedStudent, unactivatedContact.id)).toBeNull();

    const staleStudent = await createStudent(school.id);
    const staleContact = await createContact(staleStudent);
    await db.update(students).set({ email: "changed@example.test" }).where(eq(students.id, staleStudent.id));
    expect(await createChallenge({ ...staleStudent, email: "changed@example.test" }, staleContact.id)).toBeNull();
  });

  it("rejects contacts and Students from another tenant or identity", async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const studentA = await createStudent(schoolA.id);
    const studentB = await createStudent(schoolB.id);
    const contactA = await createContact(studentA);
    const contactB = await createContact(studentB);
    expect(await storage.createStudentPasswordResetChallenge(
      studentA.id, schoolB.id, contactA.id, hashPasswordRecoverySecret("123456"),
      new Date(Date.now() + 600_000), null,
    )).toBeNull();
    expect(await createChallenge(studentA, contactB.id)).toBeNull();
    expect(await createChallenge(studentB, contactA.id)).toBeNull();
  });

  it("replaces only the same Student's active challenge", async () => {
    const school = await createSchool();
    const studentA = await createStudent(school.id);
    const studentB = await createStudent(school.id);
    const contactA = await createContact(studentA);
    const contactB = await createContact(studentB);
    const firstA = await createChallenge(studentA, contactA.id, "111111");
    const challengeB = await createChallenge(studentB, contactB.id, "222222");
    const secondA = await createChallenge(studentA, contactA.id, "333333");
    const [storedFirstA] = await db.select().from(studentPasswordResetChallenges)
      .where(eq(studentPasswordResetChallenges.id, firstA!.id));
    const [storedB] = await db.select().from(studentPasswordResetChallenges)
      .where(eq(studentPasswordResetChallenges.id, challengeB!.id));
    expect(storedFirstA.consumedAt).not.toBeNull();
    expect(storedB.consumedAt).toBeNull();
    expect(secondA!.consumedAt).toBeNull();
  });

  it("serializes concurrent creation and leaves exactly one active challenge", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    await Promise.all([
      createChallenge(student, contact.id, "101010"),
      createChallenge(student, contact.id, "202020"),
    ]);
    const active = await db.select().from(studentPasswordResetChallenges).where(isNull(studentPasswordResetChallenges.consumedAt));
    expect(active.filter(row => row.studentId === student.id && row.schoolId === school.id)).toHaveLength(1);
  });

  it("requires exact challenge, Student, and school for lookup and invalidation", async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const studentA = await createStudent(schoolA.id);
    const studentB = await createStudent(schoolA.id);
    const contactA = await createContact(studentA);
    const challenge = await createChallenge(studentA, contactA.id);
    expect(await storage.getStudentPasswordResetChallenge(challenge!.id, studentA.id, schoolA.id)).toBeDefined();
    expect(await storage.getStudentPasswordResetChallenge(challenge!.id, studentB.id, schoolA.id)).toBeUndefined();
    expect(await storage.getStudentPasswordResetChallenge(challenge!.id, studentA.id, schoolB.id)).toBeUndefined();
    await storage.invalidateStudentPasswordResetChallenge(challenge!.id, studentB.id, schoolA.id);
    expect((await storage.getStudentPasswordResetChallenge(challenge!.id, studentA.id, schoolA.id))!.consumedAt).toBeNull();
    await storage.invalidateStudentPasswordResetChallenge(challenge!.id, studentA.id, schoolA.id);
    expect((await storage.getStudentPasswordResetChallenge(challenge!.id, studentA.id, schoolA.id))!.consumedAt).not.toBeNull();
  });

  it("rejects expired OTPs without changing challenge state", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const now = new Date();
    const challenge = await createChallenge(student, contact.id, "444444", now);
    expect(await storage.verifyStudentPasswordResetOtp(
      challenge!.id, student.id, school.id, "444444", new Date(now.getTime() + 600_000),
    )).toBeNull();
    const stored = await storage.getStudentPasswordResetChallenge(challenge!.id, student.id, school.id);
    expect(stored?.verifiedAt).toBeNull();
    expect(stored?.attemptCount).toBe(0);
  });

  it("caps wrong attempts at five and never permits the correct OTP afterward", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const challenge = await createChallenge(student, contact.id, "555555");
    for (let i = 0; i < 6; i += 1) {
      expect(await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "000000")).toBeNull();
    }
    expect(await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "555555")).toBeNull();
    const stored = await storage.getStudentPasswordResetChallenge(challenge!.id, student.id, school.id);
    expect(stored?.attemptCount).toBe(5);
  });

  it("serializes concurrent wrong attempts without lost increments", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const challenge = await createChallenge(student, contact.id, "666666");
    await Promise.all(Array.from({ length: 8 }, () =>
      storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "000000"),
    ));
    const stored = await storage.getStudentPasswordResetChallenge(challenge!.id, student.id, school.id);
    expect(stored?.attemptCount).toBe(5);
  });

  it("stores only reset-token HMAC material for 15 minutes and rejects OTP replay", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const now = new Date();
    const challenge = await createChallenge(student, contact.id, "777777", now);
    const token = await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "777777", now);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const stored = await storage.getStudentPasswordResetChallenge(challenge!.id, student.id, school.id);
    expect(stored?.resetTokenHash).not.toBe(token);
    expect(passwordRecoverySecretsEqual(stored!.resetTokenHash!, hashPasswordRecoverySecret(token!))).toBe(true);
    expect(stored?.resetTokenExpiresAt?.getTime()).toBe(now.getTime() + 15 * 60 * 1000);
    expect(stored?.verifiedAt).not.toBeNull();
    expect(stored?.consumedAt).toBeNull();
    expect(await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "777777", now)).toBeNull();
  });

  it("does not replace a live PASSWORD_RESET challenge with a stale forgot request", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const original = await createChallenge(student, contact.id, "707070");
    const resetToken = await storage.verifyStudentPasswordResetOtp(
      original!.id,
      student.id,
      school.id,
      "707070",
    );
    expect(resetToken).toMatch(/^[a-f0-9]{64}$/);
    const replacement = await storage.createStudentPasswordResetChallenge(
      student.id,
      school.id,
      contact.id,
      hashPasswordRecoverySecret("717171"),
      new Date(Date.now() + 10 * 60 * 1000),
      "127.0.0.1",
    );
    expect(replacement).toBeNull();
    const preserved = await storage.getStudentPasswordResetChallenge(
      original!.id,
      student.id,
      school.id,
    );
    expect(preserved?.consumedAt).toBeNull();
    expect(preserved?.verifiedAt).not.toBeNull();
    expect(preserved?.resetTokenHash).not.toBe(resetToken);
    expect(passwordRecoverySecretsEqual(
      preserved!.resetTokenHash!,
      hashPasswordRecoverySecret(resetToken!),
    )).toBe(true);
  });

  it("allows exactly one winner for concurrent correct OTP submissions", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const challenge = await createChallenge(student, contact.id, "888888");
    const results = await Promise.all([
      storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "888888"),
      storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "888888"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("rejects cross-school and cross-Student OTP verification", async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const studentA = await createStudent(schoolA.id);
    const studentB = await createStudent(schoolA.id);
    const contactA = await createContact(studentA);
    const challenge = await createChallenge(studentA, contactA.id, "919191");
    expect(await storage.verifyStudentPasswordResetOtp(
      challenge!.id, studentA.id, schoolB.id, "919191",
    )).toBeNull();
    expect(await storage.verifyStudentPasswordResetOtp(
      challenge!.id, studentB.id, schoolA.id, "919191",
    )).toBeNull();
    expect((await storage.getStudentPasswordResetChallenge(
      challenge!.id, studentA.id, schoolA.id,
    ))?.verifiedAt).toBeNull();
  });

  it("revalidates contact verification and Student eligibility before OTP success", async () => {
    const school = await createSchool();

    const contactRevokedStudent = await createStudent(school.id);
    const revokedContact = await createContact(contactRevokedStudent);
    const revokedChallenge = await createChallenge(contactRevokedStudent, revokedContact.id, "121212");
    await db.update(studentVerifiedRecoveryContacts).set({ verifiedAt: null })
      .where(eq(studentVerifiedRecoveryContacts.id, revokedContact.id));
    expect(await storage.verifyStudentPasswordResetOtp(
      revokedChallenge!.id, contactRevokedStudent.id, school.id, "121212",
    )).toBeNull();

    const inactiveStudent = await createStudent(school.id);
    const inactiveContact = await createContact(inactiveStudent);
    const inactiveChallenge = await createChallenge(inactiveStudent, inactiveContact.id, "232323");
    await db.update(students).set({ isActive: false }).where(eq(students.id, inactiveStudent.id));
    expect(await storage.verifyStudentPasswordResetOtp(
      inactiveChallenge!.id, inactiveStudent.id, school.id, "232323",
    )).toBeNull();

    const unactivatedStudent = await createStudent(school.id);
    const unactivatedContact = await createContact(unactivatedStudent);
    const unactivatedChallenge = await createChallenge(unactivatedStudent, unactivatedContact.id, "343434");
    await db.update(students).set({ isActivated: false }).where(eq(students.id, unactivatedStudent.id));
    expect(await storage.verifyStudentPasswordResetOtp(
      unactivatedChallenge!.id, unactivatedStudent.id, school.id, "343434",
    )).toBeNull();
  });

  it("is race-safe when the fifth wrong attempt competes with the correct OTP", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const challenge = await createChallenge(student, contact.id, "454545");
    for (let i = 0; i < 4; i += 1) {
      await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "000000");
    }
    const [wrongResult, correctResult] = await Promise.all([
      storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "000000"),
      storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, "454545"),
    ]);
    expect(wrongResult).toBeNull();
    const stored = await storage.getStudentPasswordResetChallenge(challenge!.id, student.id, school.id);
    expect(stored!.attemptCount).toBeLessThanOrEqual(5);
    if (correctResult) {
      expect(stored!.verifiedAt).not.toBeNull();
      expect(stored!.attemptCount).toBe(4);
    } else {
      expect(stored!.verifiedAt).toBeNull();
      expect(stored!.attemptCount).toBe(5);
    }
  });

  it("keeps replacement and verification concurrency in one valid state", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const original = await createChallenge(student, contact.id, "565656");
    const [token, replacement] = await Promise.all([
      storage.verifyStudentPasswordResetOtp(original!.id, student.id, school.id, "565656"),
      createChallenge(student, contact.id, "676767"),
    ]);
    const originalStored = await storage.getStudentPasswordResetChallenge(original!.id, student.id, school.id);
    if (token) {
      expect(replacement).toBeNull();
      expect(originalStored?.verifiedAt).not.toBeNull();
      expect(originalStored?.consumedAt).toBeNull();
      expect(originalStored?.resetTokenHash).not.toBeNull();
    } else {
      expect(replacement).not.toBeNull();
      const replacementStored = await storage.getStudentPasswordResetChallenge(
        replacement!.id,
        student.id,
        school.id,
      );
      expect(originalStored?.consumedAt).not.toBeNull();
      expect(originalStored?.verifiedAt).toBeNull();
      expect(replacementStored?.consumedAt).toBeNull();
    }
  });

  it("does not write plaintext OTP or reset-token material to console logs", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const otp = "787878";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const challenge = await createChallenge(student, contact.id, otp);
      const token = await storage.verifyStudentPasswordResetOtp(challenge!.id, student.id, school.id, otp);
      const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
      expect(logged).not.toContain(otp);
      expect(logged).not.toContain(token!);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("enforces database tenant, purpose, and attempt-count constraints", async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const studentA = await createStudent(schoolA.id);
    const studentB = await createStudent(schoolB.id);
    const contactA = await createContact(studentA);
    await expect(db.insert(studentPasswordResetChallenges).values({
      schoolId: schoolB.id,
      studentId: studentB.id,
      contactId: contactA.id,
      otpHash: hashPasswordRecoverySecret("999999"),
      otpExpiresAt: new Date(Date.now() + 600_000),
    })).rejects.toThrow();
    const challenge = await createChallenge(studentA, contactA.id);
    await expect(db.update(studentPasswordResetChallenges).set({ attemptCount: 6 })
      .where(eq(studentPasswordResetChallenges.id, challenge!.id))).rejects.toThrow();
    await expect(db.update(studentPasswordResetChallenges).set({ purpose: "password_reset" })
      .where(eq(studentPasswordResetChallenges.id, challenge!.id))).rejects.toThrow();
  });

  it("rolls back replacement when insertion fails and keeps the prior challenge active", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const first = await createChallenge(student, contact.id, "313131");
    await expect(storage.createStudentPasswordResetChallenge(
      student.id,
      school.id,
      contact.id,
      hashPasswordRecoverySecret("414141"),
      new Date(NaN),
      null,
    )).rejects.toThrow();
    const stored = await storage.getStudentPasswordResetChallenge(first!.id, student.id, school.id);
    expect(stored?.consumedAt).toBeNull();
  });

  it("cannot verify after the current recovery email changes", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const contact = await createContact(student);
    const challenge = await createChallenge(student, contact.id, "515151");
    await storage.updateStudent(student.id, school.id, {
      name: student.name,
      class: student.class,
      section: student.section,
      phone: student.phone,
      email: "replacement@example.test",
    });
    expect(await storage.verifyStudentPasswordResetOtp(
      challenge!.id, student.id, school.id, "515151",
    )).toBeNull();
    const stored = await storage.getStudentPasswordResetChallenge(challenge!.id, student.id, school.id);
    expect(stored?.consumedAt).not.toBeNull();
  });

  it("uses six-digit cryptographic OTP generation without deterministic collisions", () => {
    const values = Array.from({ length: 64 }, generatePasswordRecoveryOtp);
    expect(values.every(value => /^\d{6}$/.test(value))).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});