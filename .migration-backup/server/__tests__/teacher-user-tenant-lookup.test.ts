import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { schools, teachers, users } from "@shared/schema";

type Fixture = {
  email: string;
  schoolId: number;
  teacherId: number;
  userId: number;
};

const schoolIds: number[] = [];
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const codeSuffix = Math.random().toString(36).slice(2, 10);
let schoolAId = 0;
let schoolBId = 0;
let teacherA: Fixture;
let teacherB: Fixture;
let inactiveTeacher: Fixture;
let nonTeacher: Fixture;
let userSchoolMatchesOnly: Fixture;
let teacherSchoolMatchesOnly: Fixture;

async function createAccount(options: {
  email: string;
  userSchoolId: number;
  teacherSchoolId: number;
  role?: string;
  isActive?: boolean;
}): Promise<Fixture> {
  const [user] = await db.insert(users).values({
    email: options.email,
    passwordHash: await bcrypt.hash("tenant-lookup-test-password", 10),
    role: options.role ?? "teacher",
    schoolId: options.userSchoolId,
    isActive: options.isActive ?? true,
  }).returning({ id: users.id });
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId: options.teacherSchoolId,
    fullName: `Lookup Teacher ${options.email}`,
    phone: `9${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Security Testing",
    assignedClass: "1",
    assignedSection: "A",
  }).returning({ id: teachers.id });
  return {
    email: options.email,
    schoolId: options.userSchoolId,
    teacherId: teacher.id,
    userId: user.id,
  };
}

beforeAll(async () => {
  const [schoolA, schoolB] = await db.insert(schools).values([
    { name: `Teacher Lookup School A ${suffix}`, code: `TLSA-${codeSuffix}` },
    { name: `Teacher Lookup School B ${suffix}`, code: `TLSB-${codeSuffix}` },
  ]).returning({ id: schools.id });
  schoolAId = schoolA.id;
  schoolBId = schoolB.id;
  schoolIds.push(schoolAId, schoolBId);

  teacherA = await createAccount({
    email: `teacher-a-${suffix}@example.test`,
    userSchoolId: schoolAId,
    teacherSchoolId: schoolAId,
  });
  teacherB = await createAccount({
    email: `teacher-b-${suffix}@example.test`,
    userSchoolId: schoolBId,
    teacherSchoolId: schoolBId,
  });
  inactiveTeacher = await createAccount({
    email: `inactive-${suffix}@example.test`,
    userSchoolId: schoolAId,
    teacherSchoolId: schoolAId,
    isActive: false,
  });
  nonTeacher = await createAccount({
    email: `admin-${suffix}@example.test`,
    userSchoolId: schoolAId,
    teacherSchoolId: schoolAId,
    role: "admin",
  });
  userSchoolMatchesOnly = await createAccount({
    email: `user-school-only-${suffix}@example.test`,
    userSchoolId: schoolAId,
    teacherSchoolId: schoolBId,
  });
  teacherSchoolMatchesOnly = await createAccount({
    email: `teacher-school-only-${suffix}@example.test`,
    userSchoolId: schoolBId,
    teacherSchoolId: schoolAId,
  });
}, 30_000);

afterAll(async () => {
  if (schoolIds.length) {
    await db.delete(schools).where(inArray(schools.id, schoolIds));
  }
});

describe("getTeacherUserByEmailAndSchool", () => {
  it("returns Teacher A only for School A", async () => {
    const result = await storage.getTeacherUserByEmailAndSchool(teacherA.email, schoolAId);
    expect(result?.user.id).toBe(teacherA.userId);
    expect(result?.teacher.id).toBe(teacherA.teacherId);
    expect(result?.user.schoolId).toBe(schoolAId);
    expect(result?.teacher.schoolId).toBe(schoolAId);
  });

  it("returns Teacher B only for School B", async () => {
    const result = await storage.getTeacherUserByEmailAndSchool(teacherB.email, schoolBId);
    expect(result?.user.id).toBe(teacherB.userId);
    expect(result?.teacher.id).toBe(teacherB.teacherId);
    expect(result?.user.schoolId).toBe(schoolBId);
    expect(result?.teacher.schoolId).toBe(schoolBId);
  });

  it("does not return Teacher B for School A", async () => {
    expect(await storage.getTeacherUserByEmailAndSchool(teacherB.email, schoolAId)).toBeNull();
  });

  it("does not return Teacher A for School B", async () => {
    expect(await storage.getTeacherUserByEmailAndSchool(teacherA.email, schoolBId)).toBeNull();
  });

  it("does not return an inactive Teacher user", async () => {
    expect(await storage.getTeacherUserByEmailAndSchool(inactiveTeacher.email, schoolAId)).toBeNull();
  });

  it("does not return a linked user with a non-Teacher role", async () => {
    expect(await storage.getTeacherUserByEmailAndSchool(nonTeacher.email, schoolAId)).toBeNull();
  });

  it("does not return a Teacher when only users.schoolId matches", async () => {
    expect(await storage.getTeacherUserByEmailAndSchool(userSchoolMatchesOnly.email, schoolAId)).toBeNull();
  });

  it("does not return a Teacher when only teachers.schoolId matches", async () => {
    expect(await storage.getTeacherUserByEmailAndSchool(teacherSchoolMatchesOnly.email, schoolAId)).toBeNull();
  });

  it("uses the existing exact case-sensitive email convention", async () => {
    expect(await storage.getTeacherUserByEmailAndSchool(teacherA.email.toUpperCase(), schoolAId)).toBeNull();
    expect(await storage.getTeacherUserByEmailAndSchool(teacherA.email, schoolAId)).not.toBeNull();
  });

  it("returns only the linked server-side Teacher and user records", async () => {
    const result = await storage.getTeacherUserByEmailAndSchool(teacherA.email, schoolAId);
    expect(result).toEqual({
      teacher: expect.objectContaining({
        id: teacherA.teacherId,
        userId: teacherA.userId,
        schoolId: schoolAId,
      }),
      user: expect.objectContaining({
        id: teacherA.userId,
        schoolId: schoolAId,
        email: teacherA.email,
        role: "teacher",
        isActive: true,
      }),
    });
  });
});