import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import {
  schools,
  studentRecoveryContactVerificationChallenges,
  students,
  studentVerifiedRecoveryContacts,
} from "@shared/schema";
import {
  hashPasswordRecoverySecret,
  passwordRecoverySecretsEqual,
} from "../password-recovery";

let tablesAvailable = false;
let serial = 0;
const schoolIds: number[] = [];

async function createSchool(): Promise<number> {
  const suffix = `${Date.now()}-${serial++}`;
  const [row] = await db.insert(schools).values({
    name: `Student Contact Test ${suffix}`,
    code: `SCV-${suffix}`,
  }).returning({ id: schools.id });
  schoolIds.push(row.id);
  return row.id;
}

async function createStudent(schoolId: number, email = `student-${serial}@example.test`) {
  const suffix = `${Date.now()}-${serial++}`;
  const [row] = await db.insert(students).values({
    schoolId,
    digitalStudentId: `SCV-${suffix}`,
    name: `Student ${suffix}`,
    class: "8",
    section: "A",
    phone: String(9000000000 + serial).slice(0, 10),
    dob: "2012-01-01",
    passwordHash: "not-used-by-contact-verification",
    email,
  }).returning();
  return row;
}

async function createChallenge(
  studentId: number,
  schoolId: number,
  email: string,
  otp: string,
  now = new Date(),
) {
  return storage.createStudentRecoveryContactVerificationChallenge(
    studentId,
    schoolId,
    email,
    hashPasswordRecoverySecret(otp),
    new Date(now.getTime() + 10 * 60 * 1000),
    "127.0.0.1",
    now,
  );
}

async function verify(
  challengeId: number,
  studentId: number,
  schoolId: number,
  otp: string,
  now = new Date(),
) {
  return storage.verifyStudentRecoveryContactChallenge(
    challengeId,
    studentId,
    schoolId,
    hashPasswordRecoverySecret(otp),
    passwordRecoverySecretsEqual,
    now,
  );
}

describe("Student verified recovery-contact database lifecycle", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = "student-contact-storage-test-secret";
    const result = await pool.query<{ contact_table: string | null; challenge_table: string | null }>(`
      SELECT
        to_regclass('public.student_verified_recovery_contacts') AS contact_table,
        to_regclass('public.student_recovery_contact_verification_challenges') AS challenge_table
    `);
    tablesAvailable = !!result.rows[0]?.contact_table && !!result.rows[0]?.challenge_table;
    if (!tablesAvailable) {
      throw new Error("Student recovery-contact tables are missing; migration 009 must be applied before tests");
    }
  });

  afterAll(async () => {
    if (!tablesAvailable) return;
    if (schoolIds.length) await db.delete(schools).where(inArray(schools.id, schoolIds));
  });

  it("stores only an HMAC and binds the challenge to the exact Student and school", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    const created = await createChallenge(student.id, schoolId, student.email!, "123456");
    expect(created).not.toBeNull();
    expect(created!.challenge.schoolId).toBe(schoolId);
    expect(created!.challenge.studentId).toBe(student.id);
    expect(created!.challenge.contactId).toBe(created!.contact.id);
    expect(created!.challenge.codeHash).not.toBe("123456");
    expect(created!.contact.verifiedAt).toBeNull();
  });

  it("rejects cross-school and cross-Student challenge creation", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const studentA = await createStudent(schoolA);
    const studentB = await createStudent(schoolA);
    expect(await createChallenge(studentA.id, schoolB, studentA.email!, "111111")).toBeNull();
    expect(await createChallenge(studentB.id, schoolA, studentA.email!, "111111")).toBeNull();
  });

  it("expires after ten minutes and leaves the contact unverified", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    const now = new Date();
    const created = await createChallenge(student.id, schoolId, student.email!, "222222", now);
    expect(created).not.toBeNull();
    expect(await verify(created!.challenge.id, student.id, schoolId, "222222", new Date(now.getTime() + 10 * 60 * 1000))).toBe(false);
    expect(await storage.getStudentVerifiedRecoveryContact(student.id, schoolId)).toBeUndefined();
  });

  it("caps wrong attempts at five and rejects the sixth attempt", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    const created = await createChallenge(student.id, schoolId, student.email!, "333333");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await verify(created!.challenge.id, student.id, schoolId, "000000")).toBe(false);
    }
    expect(await verify(created!.challenge.id, student.id, schoolId, "333333")).toBe(false);
    const [stored] = await db.select().from(studentRecoveryContactVerificationChallenges)
      .where(eq(studentRecoveryContactVerificationChallenges.id, created!.challenge.id));
    expect(stored.attemptCount).toBe(5);
    expect(await storage.getStudentVerifiedRecoveryContact(student.id, schoolId)).toBeUndefined();
  });

  it("verifies once, consumes the challenge, and rejects replay", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    const created = await createChallenge(student.id, schoolId, student.email!, "444444");
    expect(await verify(created!.challenge.id, student.id, schoolId, "444444")).toBe(true);
    expect(await verify(created!.challenge.id, student.id, schoolId, "444444")).toBe(false);
    const contact = await storage.getStudentVerifiedRecoveryContact(student.id, schoolId);
    expect(contact?.contactValueNormalized).toBe(student.email!.toLowerCase());
    expect(contact?.verificationMethod).toBe("email_otp");
    const [stored] = await db.select().from(studentRecoveryContactVerificationChallenges)
      .where(eq(studentRecoveryContactVerificationChallenges.id, created!.challenge.id));
    expect(stored.consumedAt).not.toBeNull();
  });

  it("atomically replaces an older challenge", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    const first = await createChallenge(student.id, schoolId, student.email!, "555555");
    const second = await createChallenge(student.id, schoolId, student.email!, "666666");
    const [oldRow] = await db.select().from(studentRecoveryContactVerificationChallenges)
      .where(eq(studentRecoveryContactVerificationChallenges.id, first!.challenge.id));
    expect(oldRow.consumedAt).not.toBeNull();
    expect(await verify(first!.challenge.id, student.id, schoolId, "555555")).toBe(false);
    expect(await verify(second!.challenge.id, student.id, schoolId, "666666")).toBe(true);
  });

  it("allows exactly one winner for simultaneous correct submissions", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    const created = await createChallenge(student.id, schoolId, student.email!, "777777");
    const results = await Promise.all([
      verify(created!.challenge.id, student.id, schoolId, "777777"),
      verify(created!.challenge.id, student.id, schoolId, "777777"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("serializes simultaneous wrong attempts without lost increments or exceeding five", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    const created = await createChallenge(student.id, schoolId, student.email!, "141414");
    await Promise.all(Array.from({ length: 8 }, () =>
      verify(created!.challenge.id, student.id, schoolId, "000000")
    ));
    const [stored] = await db.select().from(studentRecoveryContactVerificationChallenges)
      .where(eq(studentRecoveryContactVerificationChallenges.id, created!.challenge.id));
    expect(stored.attemptCount).toBe(5);
    expect(await verify(created!.challenge.id, student.id, schoolId, "141414")).toBe(false);
  });

  it("invalidates verification and pending challenges when the Student email changes", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    const verified = await createChallenge(student.id, schoolId, student.email!, "888888");
    expect(await verify(verified!.challenge.id, student.id, schoolId, "888888")).toBe(true);
    const pending = await createChallenge(student.id, schoolId, student.email!, "999999");

    await storage.updateStudent(student.id, schoolId, {
      name: student.name,
      class: student.class,
      section: student.section,
      phone: student.phone,
      email: "replacement@example.test",
    });

    expect(await storage.getStudentVerifiedRecoveryContact(student.id, schoolId)).toBeUndefined();
    expect(await verify(pending!.challenge.id, student.id, schoolId, "999999")).toBe(false);
    const [stored] = await db.select().from(studentRecoveryContactVerificationChallenges)
      .where(eq(studentRecoveryContactVerificationChallenges.id, pending!.challenge.id));
    expect(stored.consumedAt).not.toBeNull();
  });

  it("does not transfer verification when the current email no longer matches the candidate", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    const created = await createChallenge(student.id, schoolId, student.email!, "121212");
    await db.update(students).set({ email: "changed-outside-flow@example.test" }).where(and(
      eq(students.id, student.id),
      eq(students.schoolId, schoolId),
    ));
    expect(await verify(created!.challenge.id, student.id, schoolId, "121212")).toBe(false);
    expect(await storage.getStudentVerifiedRecoveryContact(student.id, schoolId)).toBeUndefined();
  });

  it("does not affect another Student's verified contact when replacing or verifying a challenge", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const studentA = await createStudent(schoolId);
    const studentB = await createStudent(schoolId);
    const challengeA = await createChallenge(studentA.id, schoolId, studentA.email!, "151515");
    const challengeB = await createChallenge(studentB.id, schoolId, studentB.email!, "161616");
    expect(await verify(challengeA!.challenge.id, studentA.id, schoolId, "151515")).toBe(true);
    expect(await verify(challengeB!.challenge.id, studentB.id, schoolId, "161616")).toBe(true);
    await createChallenge(studentA.id, schoolId, studentA.email!, "171717");
    expect(await storage.getStudentVerifiedRecoveryContact(studentB.id, schoolId)).toMatchObject({
      studentId: studentB.id,
      schoolId,
      contactValueNormalized: studentB.email!.toLowerCase(),
    });
  });

  it("rolls back the contact update when challenge insertion violates a database constraint", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    const first = await createChallenge(student.id, schoolId, student.email!, "181818");
    expect(await verify(first!.challenge.id, student.id, schoolId, "181818")).toBe(true);
    const before = await storage.getStudentVerifiedRecoveryContact(student.id, schoolId);

    await expect(storage.createStudentRecoveryContactVerificationChallenge(
      student.id,
      schoolId,
      student.email!,
      hashPasswordRecoverySecret("191919"),
      new Date(Date.now() + 10 * 60 * 1000),
      "127.0.0.1",
      new Date(NaN),
    )).rejects.toThrow();

    const after = await storage.getStudentVerifiedRecoveryContact(student.id, schoolId);
    expect(after?.verifiedAt?.getTime()).toBe(before?.verifiedAt?.getTime());
    expect(after?.contactValueNormalized).toBe(before?.contactValueNormalized);
  });

  it("enforces contact type, challenge purpose, and attempt-count constraints", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolId = await createSchool();
    const student = await createStudent(schoolId);
    await expect(db.insert(studentVerifiedRecoveryContacts).values({
      schoolId,
      studentId: student.id,
      contactType: "phone",
      contactValue: student.phone,
      contactValueNormalized: student.phone,
    })).rejects.toThrow();

    const created = await createChallenge(student.id, schoolId, student.email!, "131313");
    await expect(db.update(studentRecoveryContactVerificationChallenges)
      .set({ attemptCount: 6 })
      .where(eq(studentRecoveryContactVerificationChallenges.id, created!.challenge.id))
    ).rejects.toThrow();
    await expect(db.update(studentRecoveryContactVerificationChallenges)
      .set({ purpose: "password_reset" })
      .where(eq(studentRecoveryContactVerificationChallenges.id, created!.challenge.id))
    ).rejects.toThrow();
  });

  it("rejects database rows whose school, Student, and contact tenant identities disagree", async ({ skip }) => {
    if (!tablesAvailable) return skip();
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const studentA = await createStudent(schoolA);
    const studentB = await createStudent(schoolB);
    await expect(db.insert(studentVerifiedRecoveryContacts).values({
      schoolId: schoolB,
      studentId: studentA.id,
      contactType: "email",
      contactValue: studentA.email!,
      contactValueNormalized: studentA.email!.toLowerCase(),
    })).rejects.toThrow();

    const contactA = await createChallenge(studentA.id, schoolA, studentA.email!, "202020");
    await expect(db.insert(studentRecoveryContactVerificationChallenges).values({
      schoolId: schoolB,
      studentId: studentB.id,
      contactId: contactA!.contact.id,
      purpose: "student_recovery_email_verification",
      codeHash: hashPasswordRecoverySecret("212121"),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    })).rejects.toThrow();
  });
});