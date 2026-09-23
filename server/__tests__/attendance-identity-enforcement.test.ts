import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { storage } from "../storage";
import {
  academicSessions,
  attendanceRecords,
  schools,
  students,
  teachers,
  users,
} from "@shared/schema";

// These integration tests deliberately assume development migration 015 has
// already been applied.  They do not execute migration SQL against the shared
// development database; migration validation belongs in the migration pipeline.
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const schoolIds: number[] = [];
let schoolA = 0;
let schoolB = 0;
let teacherA = 0;
let teacherB = 0;
let sessionA = 0;
let sessionA2 = 0;
let sessionB = 0;
let deletedStudent = 0;
let liveStudent = 0;
let deletedKey = "";

async function makeTeacher(schoolId: number, label: string) {
  const [user] = await db.insert(users).values({
    email: `identity-enforcement-${label}-${suffix}@example.test`,
    passwordHash: "test-only",
    role: "teacher",
    schoolId,
  }).returning({ id: users.id });
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId,
    fullName: `Identity Teacher ${label}`,
    phone: `9${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Attendance",
    assignedClass: "5",
    assignedSection: "A",
  }).returning({ id: teachers.id });
  return teacher.id;
}

async function makeStudent(schoolId: number, code: string, name: string, explicitKey?: string) {
  const [student] = await db.insert(students).values({
    schoolId,
    ...(explicitKey ? { attendanceIdentityKey: explicitKey } : {}),
    digitalStudentId: code,
    name,
    class: "5",
    section: "A",
    phone: "9000000001",
    dob: "2014-01-01",
    passwordHash: "test-only",
  }).returning();
  return student;
}

beforeAll(async () => {
  const createdSchools = await db.insert(schools).values([
    { name: `Identity Enforcement A ${suffix}`, code: `IEA-${suffix.slice(-7)}` },
    { name: `Identity Enforcement B ${suffix}`, code: `IEB-${suffix.slice(-7)}` },
  ]).returning({ id: schools.id });
  schoolA = createdSchools[0].id;
  schoolB = createdSchools[1].id;
  schoolIds.push(schoolA, schoolB);
  teacherA = await makeTeacher(schoolA, "a");
  teacherB = await makeTeacher(schoolB, "b");
  const first = await makeStudent(schoolA, `IE-${suffix}`, "Identity Student");
  deletedStudent = first.id;
  deletedKey = first.attendanceIdentityKey;
  const second = await makeStudent(schoolA, `IE-LIVE-${suffix}`, "Live Student");
  liveStudent = second.id;
  const sessions = await db.insert(academicSessions).values([
    { schoolId: schoolA, sessionName: `Identity A ${suffix}`, startDate: "2040-04-01", endDate: "2041-03-31" },
    { schoolId: schoolA, sessionName: `Identity A2 ${suffix}`, startDate: "2040-04-01", endDate: "2041-03-31" },
    { schoolId: schoolB, sessionName: `Identity B ${suffix}`, startDate: "2040-04-01", endDate: "2041-03-31" },
  ]).returning({ id: academicSessions.id });
  sessionA = sessions[0].id;
  sessionA2 = sessions[1].id;
  sessionB = sessions[2].id;
});

afterAll(async () => {
  if (schoolIds.length) await db.delete(schools).where(inArray(schools.id, schoolIds));
});

describe("PostgreSQL attendance identity enforcement", () => {
  it("makes each live Student attendanceIdentityKey unique", async () => {
    const student = await db.select({ key: students.attendanceIdentityKey })
      .from(students).where(eq(students.id, deletedStudent));
    await expect(db.insert(students).values({
      schoolId: schoolA,
      attendanceIdentityKey: student[0].key,
      digitalStudentId: `IE-DUP-${suffix}`,
      name: "Duplicate Key",
      class: "5",
      section: "A",
      phone: "9000000003",
      dob: "2014-01-01",
      passwordHash: "test-only",
    })).rejects.toThrow();
  });

  it("rejects key changes while allowing ordinary Student edits", async () => {
    const [before] = await db.select().from(students).where(eq(students.id, liveStudent));
    await db.update(students).set({ name: "Renamed Live Student", class: "6" })
      .where(eq(students.id, liveStudent));
    const [updated] = await db.select().from(students).where(eq(students.id, liveStudent));
    expect(updated).toMatchObject({ name: "Renamed Live Student", class: "6", attendanceIdentityKey: before.attendanceIdentityKey });
    await db.update(students).set({ class: "5" }).where(eq(students.id, liveStudent));
    await expect(db.update(students)
      .set({ attendanceIdentityKey: randomUUID() })
      .where(eq(students.id, liveStudent))).rejects.toThrow(/immutable|identity/i);
  });

  it("reserves a deleted Student key and gives a replacement a distinct numeric and identity key", async () => {
    await storage.upsertAttendance([{
      studentId: deletedStudent, teacherId: teacherA, schoolId: schoolA, sessionId: sessionA2,
      date: "2040-04-03", status: "present", class: "5", section: "A", markedBy: "identity test",
    }]);
    await db.delete(students).where(eq(students.id, deletedStudent));
    await expect(makeStudent(schoolA, `IE-REUSE-${suffix}`, "Reused Historical Key", deletedKey))
      .rejects.toThrow(/reserved|identity/i);
    const replacement = await makeStudent(schoolA, `IE-REPLACEMENT-${suffix}`, "Replacement Student");
    expect(replacement.id).not.toBe(deletedStudent);
    expect(replacement.attendanceIdentityKey).not.toBe(deletedKey);
    await db.update(students).set({ class: "6" }).where(eq(students.id, replacement.id));
  });

  it("rejects Attendance reassignment, but permits status updates and nulls student_id on delete", async () => {
    const [other] = await db.insert(students).values({
      schoolId: schoolA, digitalStudentId: `IE-OTHER-${suffix}`, name: "Other Student",
      class: "5", section: "A", phone: "9000000004", dob: "2014-01-01", passwordHash: "test-only",
    }).returning({ id: students.id });
    const [record] = await storage.upsertAttendance([{
      studentId: other.id, teacherId: teacherA, schoolId: schoolA, sessionId: sessionA,
      date: "2040-04-02", status: "present", class: "5", section: "A", markedBy: "identity test",
    }]);
    await expect(db.update(attendanceRecords).set({ studentId: liveStudent })
      .where(eq(attendanceRecords.id, record.id))).rejects.toThrow(/reassign/i);
    await db.update(attendanceRecords).set({ status: "absent" })
      .where(eq(attendanceRecords.id, record.id));
    expect((await db.select({ status: attendanceRecords.status }).from(attendanceRecords)
      .where(eq(attendanceRecords.id, record.id)))[0].status).toBe("absent");
    await db.delete(students).where(eq(students.id, other.id));
    const [preserved] = await db.select().from(attendanceRecords)
      .where(eq(attendanceRecords.id, record.id));
    expect(preserved.studentId).toBeNull();
    expect(preserved.originalStudentId).toBe(other.id);
  });

  it("summarizes deleted history once, live attendance once, and isolates schools and sessions", async () => {
    const [foreign] = await db.insert(students).values({
      schoolId: schoolB, digitalStudentId: `IE-FOREIGN-${suffix}`, name: "Foreign Student",
      class: "5", section: "A", phone: "9000000005", dob: "2014-01-01", passwordHash: "test-only",
    }).returning({ id: students.id });
    await storage.upsertAttendance([
      { studentId: liveStudent, teacherId: teacherA, schoolId: schoolA, sessionId: sessionA2, date: "2040-04-03", status: "absent", class: "5", section: "A", markedBy: "identity test" },
      { studentId: liveStudent, teacherId: teacherA, schoolId: schoolA, sessionId: sessionA, date: "2040-04-03", status: "late", class: "5", section: "A", markedBy: "identity test" },
      { studentId: foreign.id, teacherId: teacherB, schoolId: schoolB, sessionId: sessionB, date: "2040-04-03", status: "leave", class: "5", section: "A", markedBy: "identity test" },
    ]);
    const summary = await storage.getDailyAttendanceSummary(schoolA, sessionA2, "2040-04-03");
    expect(summary).toMatchObject({ total: 2, present: 1, absent: 1 });
    const roster = await storage.getAttendanceReportRosterForSessionClass(schoolA, sessionA2, "5", "A");
    expect(roster).toHaveLength(2);
    expect(roster.filter(row => row.name === "Identity Student")).toHaveLength(1);
    expect(roster.filter(row => row.name === "Renamed Live Student")).toHaveLength(1);
    expect((await storage.getDailyAttendanceSummary(schoolA, sessionA, "2040-04-03")).late).toBe(1);
    expect((await storage.getDailyAttendanceSummary(schoolB, sessionB, "2040-04-03")).leave).toBe(1);
    expect((await storage.getAttendanceRosterForSessionClass(schoolA, sessionA2, "5", "A"))
      .every(student => student.id !== deletedStudent)).toBe(true);
  });
});