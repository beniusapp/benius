import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  AttendanceReadSessionError,
  resolveAttendanceReadSession,
} from "../attendance-read-session";
import { todayInIST } from "@shared/ist-time";
import {
  academicSessions,
  attendanceRecords,
  enrollments,
  examScores,
  schools,
  studentLeaveRequests,
  students,
  teachers,
  users,
} from "@shared/schema";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const schoolIds: number[] = [];

let schoolAId = 0;
let schoolBId = 0;
let studentId = 0;
let studentBId = 0;
let teacherAId = 0;
let teacherBId = 0;
let sessionAId = 0;
let sessionBId = 0;
let otherSchoolSessionId = 0;

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
    class: string;
    section: string;
}> = {}) {
  return {
    schoolId: schoolAId,
    sessionId: sessionAId,
    studentId,
    teacherId: teacherAId,
    date: "2040-04-02",
    status: "present",
    class: "5",
    section: "A",
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
  const [studentB] = await db.insert(students).values({
    schoolId: schoolBId,
    digitalStudentId: `ATT-B-${suffix}`,
    name: "Attendance Identity Student B",
    class: "5",
    section: "A",
    phone: "9000000002",
    dob: "2014-01-01",
    passwordHash: "test-only",
  }).returning({ id: students.id });
  studentBId = studentB.id;

  const [sessionA, sessionB] = await db.insert(academicSessions).values([
    {
      schoolId: schoolAId,
      sessionName: `Attendance-A-${suffix}`,
      startDate: "2025-04-01",
      endDate: "2041-03-31",
    },
    {
      schoolId: schoolAId,
      sessionName: `Attendance-B-${suffix}`,
      startDate: "2025-04-01",
      endDate: "2042-03-31",
    },
  ]).returning({ id: academicSessions.id });
  sessionAId = sessionA.id;
  sessionBId = sessionB.id;
  const [otherSchoolSession] = await db.insert(academicSessions).values({
    schoolId: schoolBId,
    sessionName: `Attendance-Other-School-${suffix}`,
    startDate: "2025-04-01",
    endDate: "2041-03-31",
  }).returning({ id: academicSessions.id });
  otherSchoolSessionId = otherSchoolSession.id;
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

  it("clamps Leave synchronization to the validated Session boundaries", async () => {
    const [boundedSession] = await db.insert(academicSessions).values({
      schoolId: schoolAId,
      sessionName: "2040 boundary",
      startDate: "2040-04-01",
      endDate: "2040-04-03",
      isActive: false,
    }).returning();

    await storage.markAttendanceAsLeave(
      studentId, teacherAId, schoolAId, boundedSession.id, "2040-03-30", "2040-04-05",
    );

    const rows = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolAId),
      eq(attendanceRecords.sessionId, boundedSession.id),
      eq(attendanceRecords.studentId, studentId),
    ));
    expect(rows.map(row => row.date).sort()).toEqual(["2040-04-02", "2040-04-03"]);
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

  it("keeps every Attendance storage reader isolated by school and Session", async () => {
    const date = "2025-06-15";
    const [year, month] = date.split("-").map(Number);
    await storage.upsertAttendance([
      attendanceInput({ date, sessionId: sessionAId, status: "present" }),
      attendanceInput({ date, sessionId: sessionBId, status: "absent" }),
    ]);

    const classDateA = await storage.getAttendanceByClassDate(
      schoolAId, sessionAId, "5", "A", date,
    );
    const classDateB = await storage.getAttendanceByClassDate(
      schoolAId, sessionBId, "5", "A", date,
    );
    expect(classDateA.map(row => row.status)).toEqual(["present"]);
    expect(classDateB.map(row => row.status)).toEqual(["absent"]);

    const dailyA = await storage.getAttendanceForStudentsOnDate(
      schoolAId, sessionAId, [studentId], "5", "A", date,
    );
    const dailyB = await storage.getAttendanceForStudentsOnDate(
      schoolAId, sessionBId, [studentId], "5", "A", date,
    );
    expect(dailyA.map(row => row.status)).toEqual(["present"]);
    expect(dailyB.map(row => row.status)).toEqual(["absent"]);

    const historyA = await storage.getAttendanceHistory(
      schoolAId, sessionAId, "5", "A", date, date,
    );
    const historyB = await storage.getAttendanceHistory(
      schoolAId, sessionBId, "5", "A", date, date,
    );
    expect(historyA.map(row => row.status)).toEqual(["present"]);
    expect(historyB.map(row => row.status)).toEqual(["absent"]);

    await expect(storage.hasAttendanceToday(
      teacherAId, "5", "A", schoolAId, sessionAId,
    )).resolves.toBe(false);
    await expect(storage.hasAttendanceToday(
      teacherAId, "5", "A", schoolAId, sessionBId,
    )).resolves.toBe(false);

    const summaryA = await storage.getDailyAttendanceSummary(
      schoolAId, sessionAId, date,
    );
    const summaryB = await storage.getDailyAttendanceSummary(
      schoolAId, sessionBId, date,
    );
    expect(summaryA).toMatchObject({ total: 1, present: 1, absent: 0 });
    expect(summaryB).toMatchObject({ total: 1, present: 0, absent: 1 });

    const monthlyA = await storage.getStudentMonthlyAttendance(
      studentId, schoolAId, sessionAId, year, month,
    );
    const monthlyB = await storage.getStudentMonthlyAttendance(
      studentId, schoolAId, sessionBId, year, month,
    );
    expect(monthlyA.find(day => day.date === date)?.status).toBe("present");
    expect(monthlyB.find(day => day.date === date)?.status).toBe("absent");

    const yearlyA = await storage.getStudentYearlyAttendance(
      studentId, schoolAId, sessionAId, "5", "A", date, date,
    );
    const yearlyB = await storage.getStudentYearlyAttendance(
      studentId, schoolAId, sessionBId, "5", "A", date, date,
    );
    expect(yearlyA).toEqual([expect.objectContaining({ present: 1, absent: 0 })]);
    expect(yearlyB).toEqual([expect.objectContaining({ present: 0, absent: 1 })]);

    const statsA = await storage.getStudentAttendanceStats(
      studentId, schoolAId, sessionAId, "5", "A", date, date,
    );
    const statsB = await storage.getStudentAttendanceStats(
      studentId, schoolAId, sessionBId, "5", "A", date, date,
    );
    expect(statsA).toMatchObject({ workingDays: 1, totalPresent: 1, totalAbsent: 0 });
    expect(statsB).toMatchObject({ workingDays: 1, totalPresent: 0, totalAbsent: 1 });
  });

  it("preserves historical class membership after promotion, inactivity, and missing Enrollment", async () => {
    const [promotedStudent, attendanceOnlyStudent, historicalClassmate] = await db.insert(students).values([
      {
        schoolId: schoolAId,
        digitalStudentId: `PROMOTED-${suffix}`,
        name: "Promoted Historical Student",
        class: "10",
        section: "B",
        phone: "9000000011",
        dob: "2014-01-01",
        passwordHash: "test-only",
        isActive: false,
      },
      {
        schoolId: schoolAId,
        digitalStudentId: `NO-ENROLLMENT-${suffix}`,
        name: "Attendance Only Historical Student",
        class: "10",
        section: "B",
        phone: "9000000012",
        dob: "2014-01-01",
        passwordHash: "test-only",
      },
      {
        schoolId: schoolAId,
        digitalStudentId: `CLASSMATE-${suffix}`,
        name: "Historical Classmate",
        class: "10",
        section: "B",
        phone: "9000000013",
        dob: "2014-01-01",
        passwordHash: "test-only",
      },
    ]).returning({ id: students.id });

    await db.insert(enrollments).values([
      {
        schoolId: schoolAId,
        sessionId: sessionAId,
        studentId: promotedStudent.id,
        className: "9",
        sectionName: "A",
      },
      {
        schoolId: schoolAId,
        sessionId: sessionAId,
        studentId: historicalClassmate.id,
        className: "9",
        sectionName: "A",
      },
      {
        schoolId: schoolAId,
        sessionId: sessionBId,
        studentId: promotedStudent.id,
        className: "10",
        sectionName: "B",
      },
    ]);

    await storage.upsertAttendance([
      attendanceInput({
        studentId: promotedStudent.id,
        date: "2025-05-01",
        class: "9",
        section: "A",
      }),
      attendanceInput({
        studentId: attendanceOnlyStudent.id,
        date: "2025-05-01",
        class: "9",
        section: "A",
      }),
      attendanceInput({
        studentId: historicalClassmate.id,
        date: "2025-05-02",
        class: "9",
        section: "A",
      }),
      attendanceInput({
        studentId: promotedStudent.id,
        date: "2025-05-03",
        class: "10",
        section: "B",
      }),
    ]);

    const roster = await storage.getAttendanceRosterForSessionClass(
      schoolAId, sessionAId, "9", "A",
    );
    expect(roster.map(student => student.id)).toEqual(expect.arrayContaining([
      promotedStudent.id,
      attendanceOnlyStudent.id,
      historicalClassmate.id,
    ]));

    const history = await storage.getAttendanceHistory(
      schoolAId, sessionAId, "9", "A", "2025-05-01", "2025-05-03",
    );
    expect(history.map(record => record.studentId)).toEqual(expect.arrayContaining([
      promotedStudent.id,
      attendanceOnlyStudent.id,
      historicalClassmate.id,
    ]));

    await expect(storage.resolveAttendanceClassSectionForStudent(
      schoolAId, sessionAId, promotedStudent.id,
    )).resolves.toEqual({ class: "9", section: "A" });
    await expect(storage.resolveAttendanceClassSectionForStudent(
      schoolAId, sessionAId, attendanceOnlyStudent.id,
    )).resolves.toEqual({ class: "9", section: "A" });

    const yearly = await storage.getStudentYearlyAttendance(
      promotedStudent.id, schoolAId, sessionAId, "9", "A",
      "2025-05-01", "2025-05-03",
    );
    expect(yearly).toEqual([
      expect.objectContaining({ workingDays: 2, present: 1, absent: 0 }),
    ]);

    const stats = await storage.getStudentAttendanceStats(
      promotedStudent.id, schoolAId, sessionAId, "9", "A",
      "2025-05-01", "2025-05-03",
    );
    expect(stats).toMatchObject({
      workingDays: 2,
      totalPresent: 1,
      totalAbsent: 0,
      overallPercent: 50,
    });

    const classAggregates = await storage.getStudentAttendanceAggregatesForSessionClass(
      schoolAId, sessionAId, "9", "A", "2025-05-01", "2025-05-03",
    );
    const promotedAggregate = classAggregates.find(
      entry => entry.student.id === promotedStudent.id,
    )?.aggregation;
    expect(promotedAggregate).toMatchObject({
      applicableWorkingDays: 2,
      present: 1,
      absent: 0,
      missing: 1,
      percentage: 50,
    });

    await expect(storage.getAttendancePopulationForSession(
      schoolAId, sessionAId,
    )).resolves.toBeGreaterThanOrEqual(3);

    await db.insert(examScores).values({
      studentId: promotedStudent.id,
      teacherId: teacherAId,
      schoolId: schoolAId,
      sessionId: sessionAId,
      subject: "History",
      examType: "Term",
      marks: 80,
      totalMarks: 100,
      class: "10",
      section: "B",
    });
    const historicalExamRoster = await storage.getStudentsByClassSectionForExamSession(
      schoolAId, sessionAId, "9", "A",
    );
    const staleScoreRoster = await storage.getStudentsByClassSectionForExamSession(
      schoolAId, sessionAId, "10", "B",
    );
    expect(historicalExamRoster.map(student => student.id)).toContain(promotedStudent.id);
    expect(staleScoreRoster.map(student => student.id)).not.toContain(promotedStudent.id);
  });

  it("keeps active-session current students available before their first Enrollment or Attendance row", async () => {
    await db.update(academicSessions)
      .set({ isActive: true })
      .where(eq(academicSessions.id, sessionBId));
    const [currentStudent] = await db.insert(students).values({
      schoolId: schoolAId,
      digitalStudentId: `FIRST-MARK-${suffix}`,
      name: "First Mark Student",
      class: "10",
      section: "B",
      phone: "9000000015",
      dob: "2014-01-01",
      passwordHash: "test-only",
      isActive: true,
    }).returning({ id: students.id });

    const roster = await storage.getAttendanceRosterForSessionClass(
      schoolAId, sessionBId, "10", "B",
    );
    expect(roster.map(student => student.id)).toContain(currentStudent.id);
    await expect(storage.getAttendancePopulationForSession(
      schoolAId, sessionBId,
    )).resolves.toBeGreaterThanOrEqual(1);
  });

  it("keeps unclassified legacy Attendance readable without inventing a working-day context", async () => {
    const [student] = await db.insert(students).values({
      schoolId: schoolAId,
      digitalStudentId: `ORPHAN-CONTEXT-${suffix}`,
      name: "Attendance Without Context",
      class: "10",
      section: "B",
      phone: "9000000014",
      dob: "2014-01-01",
      passwordHash: "test-only",
    }).returning({ id: students.id });
    await db.insert(attendanceRecords).values({
      schoolId: schoolAId,
      sessionId: sessionAId,
      studentId: student.id,
      teacherId: teacherAId,
      date: "2025-06-01",
      status: "present",
      markedBy: "Historical fallback test",
    });

    await expect(storage.resolveAttendanceClassSectionForStudent(
      schoolAId, sessionAId, student.id,
    )).resolves.toBeNull();

    const yearly = await storage.getStudentYearlyAttendance(
      student.id, schoolAId, sessionAId, null, null,
      "2025-06-01", "2025-06-01",
    );
    expect(yearly).toEqual([]);

    const stats = await storage.getStudentAttendanceStats(
      student.id, schoolAId, sessionAId, null, null,
      "2025-06-01", "2025-06-01",
    );
    expect(stats).toMatchObject({ workingDays: 0, totalPresent: 0 });

    const monthly = await storage.getStudentMonthlyAttendance(
      student.id, schoolAId, sessionAId, 2025, 6,
    );
    expect(monthly.find(day => day.date === "2025-06-01")?.status).toBe("present");
  });

  it("validates Attendance read Sessions against the authenticated school and fails closed", async () => {
    await expect(resolveAttendanceReadSession(schoolAId, sessionAId))
      .resolves.toMatchObject({ id: sessionAId, schoolId: schoolAId });

    await expect(resolveAttendanceReadSession(schoolAId, otherSchoolSessionId))
      .rejects.toMatchObject<Partial<AttendanceReadSessionError>>({
        status: 403,
        code: "ATTENDANCE_SESSION_FORBIDDEN",
      });

    await expect(resolveAttendanceReadSession(schoolAId, undefined))
      .rejects.toMatchObject<Partial<AttendanceReadSessionError>>({
        status: 400,
        code: "ATTENDANCE_SESSION_REQUIRED",
      });
  });

  it("rejects a mixed-school Student batch before writing any Attendance", async () => {
    const date = "2040-08-01";

    await expect(storage.upsertAttendance([
      attendanceInput({ date }),
      attendanceInput({ date, studentId: studentBId }),
    ])).rejects.toThrow("Attendance entities do not belong to the same school");

    const rows = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolAId),
      eq(attendanceRecords.date, date),
    ));
    expect(rows).toHaveLength(0);
  });

  it("rejects a foreign Teacher at the Attendance storage boundary", async () => {
    const date = "2040-08-02";

    await expect(storage.upsertAttendance([
      attendanceInput({ date, teacherId: teacherBId }),
    ])).rejects.toThrow("Attendance entities do not belong to the same school");

    const rows = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolAId),
      eq(attendanceRecords.date, date),
    ));
    expect(rows).toHaveLength(0);
  });

  it("rejects a foreign Session at the Attendance storage boundary", async () => {
    const date = "2040-08-03";

    await expect(storage.upsertAttendance([
      attendanceInput({ date, sessionId: otherSchoolSessionId }),
    ])).rejects.toThrow("Attendance entities do not belong to the same school");

    const rows = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolAId),
      eq(attendanceRecords.date, date),
    ));
    expect(rows).toHaveLength(0);
  });

  it("rejects Leave synchronization for a foreign Student", async () => {
    const date = "2040-05-04";

    await expect(storage.markAttendanceAsLeave(
      studentBId, teacherAId, schoolAId, sessionAId, date, date,
    )).rejects.toThrow("Leave Attendance entities do not belong to the same school");

    const rows = await db.select().from(attendanceRecords).where(eq(attendanceRecords.date, date));
    expect(rows).toHaveLength(0);
  });

  it("rejects Leave synchronization for a foreign Session", async () => {
    const date = "2040-05-05";

    await expect(storage.markAttendanceAsLeave(
      studentId, teacherAId, schoolAId, otherSchoolSessionId, date, date,
    )).rejects.toThrow("Leave Attendance entities do not belong to the same school");

    const rows = await db.select().from(attendanceRecords).where(eq(attendanceRecords.date, date));
    expect(rows).toHaveLength(0);
  });

  it("does not return or mutate another school's Student leave", async () => {
    const [foreignLeave] = await db.insert(studentLeaveRequests).values({
      studentId: studentBId,
      schoolId: schoolBId,
      sessionId: otherSchoolSessionId,
      startDate: "2040-05-06",
      endDate: "2040-05-06",
      reason: "Tenant isolation test",
      status: "pending_teacher",
    }).returning();

    await expect(storage.getStudentLeaveById(foreignLeave.id, schoolAId))
      .resolves.toBeNull();
    await expect(storage.updateStudentLeaveStatus(
      foreignLeave.id,
      schoolAId,
      "approved",
      teacherAId,
      "teacher",
    )).resolves.toBeNull();

    const [unchanged] = await db.select().from(studentLeaveRequests)
      .where(eq(studentLeaveRequests.id, foreignLeave.id));
    expect(unchanged.status).toBe("pending_teacher");
    await expect(storage.getStudentLeaveById(foreignLeave.id, schoolBId))
      .resolves.toMatchObject({ id: foreignLeave.id, schoolId: schoolBId });
  });
});