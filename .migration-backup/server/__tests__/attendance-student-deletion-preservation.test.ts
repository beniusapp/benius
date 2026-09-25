import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { academicSessions, attendanceRecords, schools, students, teachers, users } from "@shared/schema";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
let schoolId = 0;
let otherSchoolId = 0;
let teacherId = 0;
let studentId = 0;
let sessionA = 0;
let sessionB = 0;
let otherSession = 0;

beforeAll(async () => {
  const [school, other] = await db.insert(schools).values([
    { name: `Preservation A ${suffix}`, code: `PRA-${suffix.slice(-7)}` },
    { name: `Preservation B ${suffix}`, code: `PRB-${suffix.slice(-7)}` },
  ]).returning();
  schoolId = school.id;
  otherSchoolId = other.id;

  const [user] = await db.insert(users).values({
    email: `attendance-preservation-${suffix}@example.test`,
    passwordHash: "test-only",
    role: "teacher",
    schoolId,
  }).returning();
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId,
    fullName: "Historical Teacher",
    phone: "9000000001",
    subject: "History",
    assignedClass: "5",
    assignedSection: "A",
  }).returning();
  teacherId = teacher.id;
  const [student] = await db.insert(students).values({
    schoolId,
    digitalStudentId: `PRES-${suffix}`,
    name: "Original Student",
    class: "5",
    section: "A",
    phone: "9000000002",
    dob: "2014-01-01",
    passwordHash: "test-only",
  }).returning();
  studentId = student.id;
  const [first, second, foreign] = await db.insert(academicSessions).values([
    { schoolId, sessionName: `Preserve A ${suffix}`, startDate: "2025-04-01", endDate: "2026-03-31" },
    { schoolId, sessionName: `Preserve B ${suffix}`, startDate: "2026-04-01", endDate: "2027-03-31" },
    { schoolId: otherSchoolId, sessionName: `Foreign ${suffix}`, startDate: "2025-04-01", endDate: "2026-03-31" },
  ]).returning();
  sessionA = first.id;
  sessionB = second.id;
  otherSession = foreign.id;
});

afterAll(async () => {
  if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId));
  if (otherSchoolId) await db.delete(schools).where(eq(schools.id, otherSchoolId));
});

describe("historical Attendance after physical Student deletion", () => {
  it("retains original identities, class placement, and both Sessions while excluding the active roster", async () => {
    const input = (sessionId: number, date: string, status: string, cls = "5") => ({
      studentId,
      teacherId,
      schoolId,
      sessionId,
      date,
      status,
      class: cls,
      section: "A",
      markedBy: "Historical Teacher",
    });
    await storage.upsertAttendance([
      input(sessionA, "2025-04-06", "present"),
      input(sessionA, "2025-04-07", "absent"),
      input(sessionB, "2026-04-05", "late", "6"),
    ]);
    const before = await db.select().from(attendanceRecords).where(eq(attendanceRecords.schoolId, schoolId));
    expect(before).toHaveLength(3);
    expect(before.every(row => row.studentId === studentId)).toBe(true);

    // There is no production single-Student hard-delete endpoint: use the same
    // database-level DELETE that an external physical deletion would perform.
    await db.delete(students).where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)));

    expect(await db.select().from(students).where(eq(students.id, studentId))).toHaveLength(0);
    const preserved = await db.select().from(attendanceRecords).where(eq(attendanceRecords.schoolId, schoolId));
    expect(preserved).toHaveLength(3);
    expect(preserved.every(row =>
      row.studentId === null &&
      row.originalStudentId === studentId &&
      row.studentNameSnapshot === "Original Student" &&
      row.studentCodeSnapshot === `PRES-${suffix}` &&
      !!row.identityKey
    )).toBe(true);
    expect(new Set(preserved.map(row => row.identityKey)).size).toBe(1);
    expect(preserved.filter(row => row.sessionId === sessionA)).toHaveLength(2);
    expect(preserved.filter(row => row.sessionId === sessionB)).toHaveLength(1);
    expect(preserved.find(row => row.sessionId === sessionB)).toMatchObject({ class: "6", section: "A" });

    const historyA = await storage.getAttendanceHistory(schoolId, sessionA, "5", "A", "2025-04-01", "2026-03-31");
    const historyB = await storage.getAttendanceHistory(schoolId, sessionB, "6", "A", "2026-04-01", "2027-03-31");
    expect(historyA).toHaveLength(2);
    expect(historyA.map(row => row.status).sort()).toEqual(["absent", "present"]);
    expect(historyA.every(row => row.studentName === "Original Student" && row.dsid === `PRES-${suffix}`)).toBe(true);
    expect(historyB).toHaveLength(1);
    expect(historyB[0].status).toBe("late");
    expect(await storage.getAttendanceHistory(otherSchoolId, otherSession, "5", "A", "2025-04-01", "2026-03-31")).toHaveLength(0);

    const reportRoster = await storage.getAttendanceReportRosterForSessionClass(schoolId, sessionA, "5", "A");
    expect(reportRoster).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Original Student", digitalStudentId: `PRES-${suffix}`, class: "5", section: "A" }),
    ]));
    expect(await storage.getAttendanceRosterForSessionClass(schoolId, sessionA, "5", "A")).toHaveLength(0);
    expect(await storage.getAttendancePopulationForSession(schoolId, sessionA)).toBe(1);
    expect(await storage.getAttendancePopulationForSession(otherSchoolId, otherSession)).toBe(0);
  });

  it("never attaches preserved history to a new Student reusing the numeric ID or code", async () => {
    const [replacement] = await db.insert(students).values({
      id: studentId,
      schoolId,
      digitalStudentId: `PRES-${suffix}`,
      name: "Replacement Student",
      class: "5",
      section: "A",
      phone: "9000000003",
      dob: "2014-01-01",
      passwordHash: "test-only",
    }).returning();
    expect(replacement.attendanceIdentityKey).toBeTruthy();

    const [newRow] = await storage.upsertAttendance([{
      studentId: replacement.id,
      teacherId,
      schoolId,
      sessionId: sessionA,
      date: "2025-04-06",
      status: "leave",
      class: "5",
      section: "A",
      markedBy: "Historical Teacher",
    }]);
    const sameDate = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionA),
      eq(attendanceRecords.date, "2025-04-06"),
    ));
    expect(sameDate).toHaveLength(2);
    expect(newRow.identityKey).not.toBe(sameDate.find(row => row.id !== newRow.id)?.identityKey);
    expect(sameDate.find(row => row.id !== newRow.id)).toMatchObject({
      studentId: null, studentNameSnapshot: "Original Student", status: "present",
    });
    expect(newRow).toMatchObject({ studentId, studentNameSnapshot: "Replacement Student", status: "leave" });
    const history = await storage.getAttendanceHistory(schoolId, sessionA, "5", "A", "2025-04-06", "2025-04-06");
    expect(history.map(row => row.studentName).sort()).toEqual(["Original Student", "Replacement Student"]);
    const reportRoster = await storage.getAttendanceReportRosterForSessionClass(schoolId, sessionA, "5", "A");
    expect(reportRoster.map(row => row.name).sort()).toEqual(["Original Student", "Replacement Student"]);
    expect(new Set(reportRoster.map(row => row.id)).size).toBe(2);
    const activeRows = await storage.getAttendanceForStudentsOnDate(schoolId, sessionA, [studentId], "5", "A", "2025-04-06");
    expect(activeRows.map(row => row.id)).toEqual([newRow.id]);
  });
});