import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
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

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const schoolIds: number[] = [];

let schoolAId = 0;
let schoolBId = 0;
let studentId = 0;
let teacherAId = 0;
let teacherBId = 0;
let sessionAId = 0;
let sessionBId = 0;

async function createTeacher(schoolId: number, label: string) {
  const [user] = await db.insert(users).values({
    email: `attendance-${label}-${suffix}@example.test`,
    passwordHash: "test-only",
    role: "teacher",
    schoolId,
  }).returning({ id: users.id });
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId,
    fullName: `Attendance Teacher ${label}`,
    phone: `9${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Attendance",
    assignedClass: "5",
    assignedSection: "A",
  }).returning({ id: teachers.id });
  return teacher.id;
}

function attendanceInput(overrides: Partial<{
  schoolId: number;
  sessionId: number;
  studentId: number;
  teacherId: number;
  date: string;
  status: string;
}> = {}) {
  return {
    schoolId: schoolAId,
    sessionId: sessionAId,
    studentId,
    teacherId: teacherAId,
    date: "2040-04-02",
    status: "present",
    markedBy: "Canonical identity test",
    ...overrides,
  };
}

beforeAll(async () => {
  const [schoolA, schoolB] = await db.insert(schools).values([
    { name: `Attendance Identity A ${suffix}`, code: `AIA-${suffix.slice(-8)}` },
    { name: `Attendance Identity B ${suffix}`, code: `AIB-${suffix.slice(-8)}` },
  ]).returning({ id: schools.id });
  schoolAId = schoolA.id;
  schoolBId = schoolB.id;
  schoolIds.push(schoolAId, schoolBId);

  teacherAId = await createTeacher(schoolAId, "a");
  teacherBId = await createTeacher(schoolBId, "b");

  const [student] = await db.insert(students).values({
    schoolId: schoolAId,
    digitalStudentId: `ATT-${suffix}`,
    name: "Attendance Identity Student",
    class: "5",
    section: "A",
    phone: "9000000001",
    dob: "2014-01-01",
    passwordHash: "test-only",
  }).returning({ id: students.id });
  studentId = student.id;

  const [sessionA, sessionB] = await db.insert(academicSessions).values([
    {
      schoolId: schoolAId,
      sessionName: `Attendance-A-${suffix}`,
      startDate: "2040-04-01",
      endDate: "2041-03-31",
    },
    {
      schoolId: schoolAId,
      sessionName: `Attendance-B-${suffix}`,
      startDate: "2041-04-01",
      endDate: "2042-03-31",
    },
  ]).returning({ id: academicSessions.id });
  sessionAId = sessionA.id;
  sessionBId = sessionB.id;
}, 30_000);

afterAll(async () => {
  if (schoolIds.length) {
    await db.delete(schools).where(inArray(schools.id, schoolIds));
  }
});

describe("Attendance canonical persistence identity", () => {
  it("updates the existing row for the same canonical key", async () => {
    const input = attendanceInput({ date: "2040-04-02" });
    const [created] = await storage.upsertAttendance([input]);
    const [updated] = await storage.upsertAttendance([{ ...input, status: "absent" }]);

    expect(updated.id).toBe(created.id);
    expect(updated.status).toBe("absent");
    expect(updated.editCount).toBe(1);
    const rows = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolAId),
      eq(attendanceRecords.sessionId, sessionAId),
      eq(attendanceRecords.studentId, studentId),
      eq(attendanceRecords.date, input.date),
    ));
    expect(rows).toHaveLength(1);
  });

  it("keeps the same Student and date separate across Sessions", async () => {
    const date = "2040-04-03";
    const [first] = await storage.upsertAttendance([attendanceInput({ date, sessionId: sessionAId })]);
    const [second] = await storage.upsertAttendance([attendanceInput({ date, sessionId: sessionBId, status: "absent" })]);

    expect(second.id).not.toBe(first.id);
    expect(first.sessionId).toBe(sessionAId);
    expect(second.sessionId).toBe(sessionBId);
  });

  it("does not cross-match another school's row", async () => {
    const date = "2040-04-04";
    const [otherSchoolRow] = await db.insert(attendanceRecords).values({
      schoolId: schoolBId,
      sessionId: sessionAId,
      studentId,
      teacherId: teacherBId,
      date,
      status: "absent",
      markedBy: "Cross-tenant fixture",
    }).returning();

    const [schoolARow] = await storage.upsertAttendance([attendanceInput({ date })]);
    expect(schoolARow.id).not.toBe(otherSchoolRow.id);
    expect(schoolARow.schoolId).toBe(schoolAId);
    const [unchanged] = await db.select().from(attendanceRecords)
      .where(eq(attendanceRecords.id, otherSchoolRow.id));
    expect(unchanged.status).toBe("absent");
  });

  it("rejects a missing Session before writing", async () => {
    const date = "2040-04-05";
    await expect(storage.upsertAttendance([
      { ...attendanceInput({ date }), sessionId: undefined } as any,
    ])).rejects.toThrow("Attendance sessionId is required");

    const rows = await db.select().from(attendanceRecords)
      .where(eq(attendanceRecords.date, date));
    expect(rows).toHaveLength(0);
  });

  it("uses the canonical identity for Leave synchronization", async () => {
    const date = "2040-04-09";
    const [created] = await storage.upsertAttendance([attendanceInput({ date, status: "present" })]);
    await storage.markAttendanceAsLeave(studentId, teacherAId, schoolAId, sessionAId, date, date);

    const [updated] = await db.select().from(attendanceRecords)
      .where(eq(attendanceRecords.id, created.id));
    expect(updated.status).toBe("leave");
  });

  it("keeps Leave synchronization separate across Sessions", async () => {
    const date = "2040-04-10";
    await storage.markAttendanceAsLeave(studentId, teacherAId, schoolAId, sessionAId, date, date);
    await storage.markAttendanceAsLeave(studentId, teacherAId, schoolAId, sessionBId, date, date);

    const rows = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolAId),
      eq(attendanceRecords.studentId, studentId),
      eq(attendanceRecords.date, date),
    ));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row => row.sessionId))).toEqual(new Set([sessionAId, sessionBId]));
  });

  it("lets the database reject a duplicate canonical key", async () => {
    const values = attendanceInput({ date: "2040-04-11" });
    await db.insert(attendanceRecords).values(values);
    await expect(db.insert(attendanceRecords).values(values)).rejects.toMatchObject({
      code: "23505",
      constraint: "attendance_records_canonical_identity_uidx",
    });
  });

  it("prevents a referenced Session from being deleted or nulling Attendance.sessionId", async () => {
    const [session] = await db.insert(academicSessions).values({
      schoolId: schoolAId,
      sessionName: `Attendance-Delete-${suffix}`,
      startDate: "2042-04-01",
      endDate: "2043-03-31",
    }).returning({ id: academicSessions.id });
    const [attendance] = await storage.upsertAttendance([
      attendanceInput({ date: "2040-04-12", sessionId: session.id }),
    ]);

    await expect(db.delete(academicSessions).where(eq(academicSessions.id, session.id)))
      .rejects.toMatchObject({ code: "23503" });
    const [preserved] = await db.select().from(attendanceRecords)
      .where(eq(attendanceRecords.id, attendance.id));
    expect(preserved.sessionId).toBe(session.id);
  });
});