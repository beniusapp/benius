import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { todayInIST } from "@shared/ist-time";
import { db } from "../db";
import { storage } from "../storage";
import { getStudentAttendanceWorkingDates } from "../student-attendance-working-days";
import {
  academicSessions,
  attendanceRecords,
  calendarEvents,
  enrollments,
  schools,
  studentLeaveRequests,
  students,
  teachers,
  users,
} from "@shared/schema";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const schoolIds: number[] = [];
let schoolAId = 0;
let schoolBId = 0;
let sessionAId = 0;
let sessionBId = 0;
let sessionOtherSchoolId = 0;
let teacherAId = 0;
let teacherBId = 0;
let studentOneId = 0;
let studentTwoId = 0;
let classSevenStudentId = 0;
let wrongClassSnapshotStudentId = 0;
let otherSchoolStudentId = 0;

async function createTeacher(schoolId: number, label: string) {
  const [user] = await db.insert(users).values({
    email: `step2j-${label}-${suffix}@example.test`,
    passwordHash: "test-only",
    role: "teacher",
    schoolId,
  }).returning({ id: users.id });
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId,
    fullName: `Step 2J Teacher ${label}`,
    phone: `8${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Attendance",
    assignedClass: "6",
    assignedSection: "A",
  }).returning({ id: teachers.id });
  return teacher.id;
}

async function createStudent(
  schoolId: number,
  label: string,
  cls: string,
  section: string,
) {
  const [student] = await db.insert(students).values({
    schoolId,
    digitalStudentId: `STEP2J-${label}-${suffix}`,
    name: `Step 2J Student ${label}`,
    class: cls,
    section,
    phone: `7${label.padStart(9, "0").slice(-9)}`,
    dob: "2014-01-01",
    passwordHash: "test-only",
  }).returning({ id: students.id });
  return student.id;
}

beforeAll(async () => {
  const [schoolA, schoolB] = await db.insert(schools).values([
    { name: `Step 2J School A ${suffix}`, code: `S2JA-${suffix.slice(-8)}` },
    { name: `Step 2J School B ${suffix}`, code: `S2JB-${suffix.slice(-8)}` },
  ]).returning({ id: schools.id });
  schoolAId = schoolA.id;
  schoolBId = schoolB.id;
  schoolIds.push(schoolAId, schoolBId);

  teacherAId = await createTeacher(schoolAId, "a");
  teacherBId = await createTeacher(schoolBId, "b");
  studentOneId = await createStudent(schoolAId, "1", "6", "A");
  studentTwoId = await createStudent(schoolAId, "2", "6", "A");
  classSevenStudentId = await createStudent(schoolAId, "3", "7", "A");
  wrongClassSnapshotStudentId = await createStudent(schoolAId, "5", "6", "A");
  otherSchoolStudentId = await createStudent(schoolBId, "4", "6", "A");

  const [sessionA, sessionB, otherSchoolSession] = await db.insert(academicSessions).values([
    {
      schoolId: schoolAId,
      sessionName: `Step2J-A-${suffix}`,
      startDate: "2025-04-01",
      endDate: "2025-04-30",
    },
    {
      schoolId: schoolAId,
      sessionName: `Step2J-B-${suffix}`,
      startDate: "2025-04-01",
      endDate: "2025-04-30",
    },
    {
      schoolId: schoolBId,
      sessionName: `Step2J-Other-${suffix}`,
      startDate: "2025-04-01",
      endDate: "2025-04-30",
    },
  ]).returning({ id: academicSessions.id });
  sessionAId = sessionA.id;
  sessionBId = sessionB.id;
  sessionOtherSchoolId = otherSchoolSession.id;

  await db.insert(enrollments).values([
    {
      schoolId: schoolAId,
      sessionId: sessionAId,
      studentId: studentOneId,
      className: "6",
      sectionName: "A",
    },
    {
      schoolId: schoolAId,
      sessionId: sessionAId,
      studentId: studentTwoId,
      className: "6",
      sectionName: "A",
    },
    {
      schoolId: schoolAId,
      sessionId: sessionAId,
      studentId: classSevenStudentId,
      className: "7",
      sectionName: "A",
    },
    {
      schoolId: schoolAId,
      sessionId: sessionAId,
      studentId: wrongClassSnapshotStudentId,
      className: "6",
      sectionName: "A",
    },
  ]);

  await db.insert(attendanceRecords).values([
    { schoolId: schoolAId, sessionId: sessionAId, studentId: studentOneId, teacherId: teacherAId, date: "2025-03-31", status: "present", class: "6", section: "A", markedBy: "test" },
    { schoolId: schoolAId, sessionId: sessionAId, studentId: studentOneId, teacherId: teacherAId, date: "2025-04-01", status: "present", class: "6", section: "A", markedBy: "test" },
    { schoolId: schoolAId, sessionId: sessionAId, studentId: wrongClassSnapshotStudentId, teacherId: teacherAId, date: "2025-04-01", status: "present", class: "7", section: "A", markedBy: "test" },
    { schoolId: schoolAId, sessionId: sessionAId, studentId: classSevenStudentId, teacherId: teacherAId, date: "2025-04-02", status: "present", class: "7", section: "A", markedBy: "test" },
    { schoolId: schoolAId, sessionId: sessionAId, studentId: studentOneId, teacherId: teacherAId, date: "2025-04-06", status: "leave", class: "6", section: "A", markedBy: "test" },
    { schoolId: schoolAId, sessionId: sessionAId, studentId: studentTwoId, teacherId: teacherAId, date: "2025-04-30", status: "halfday", class: "6", section: "A", markedBy: "test" },
    { schoolId: schoolAId, sessionId: sessionAId, studentId: studentTwoId, teacherId: teacherAId, date: "2025-05-01", status: "present", class: "6", section: "A", markedBy: "test" },
    { schoolId: schoolAId, sessionId: sessionBId, studentId: studentOneId, teacherId: teacherAId, date: "2025-04-10", status: "absent", class: "6", section: "A", markedBy: "test" },
    { schoolId: schoolBId, sessionId: sessionOtherSchoolId, studentId: otherSchoolStudentId, teacherId: teacherBId, date: "2025-04-11", status: "present", class: "6", section: "A", markedBy: "test" },
  ]);

  await db.insert(calendarEvents).values({
    schoolId: schoolAId,
    title: "Holiday that remains applicable",
    date: "2025-04-06",
    eventType: "holiday",
  });
  await db.insert(studentLeaveRequests).values({
    schoolId: schoolAId,
    sessionId: sessionAId,
    studentId: studentTwoId,
    startDate: "2025-04-15",
    endDate: "2025-04-15",
    reason: "Approved leave without Attendance",
    status: "approved",
  });
}, 30_000);

afterAll(async () => {
  await db.delete(schools).where(inArray(schools.id, schoolIds));
});

describe("canonical Student Attendance working dates", () => {
  it("uses exact class/section evidence and inclusive Session boundaries", async () => {
    await expect(getStudentAttendanceWorkingDates({
      schoolId: schoolAId,
      sessionId: sessionAId,
      class: "6",
      section: "A",
      startDate: "2025-03-01",
      endDate: "2025-05-31",
    })).resolves.toEqual(["2025-04-01", "2025-04-06", "2025-04-30"]);

    await expect(getStudentAttendanceWorkingDates({
      schoolId: schoolAId,
      sessionId: sessionAId,
      class: "7",
      section: "A",
      startDate: "2025-04-01",
      endDate: "2025-04-30",
    })).resolves.toEqual(["2025-04-01", "2025-04-02"]);

    await expect(getStudentAttendanceWorkingDates({
      schoolId: schoolAId,
      sessionId: sessionAId,
      class: "6",
      section: "B",
      startDate: "2025-04-01",
      endDate: "2025-04-30",
    })).resolves.toEqual([]);
  });

  it("isolates Sessions and schools even when date ranges overlap", async () => {
    await expect(getStudentAttendanceWorkingDates({
      schoolId: schoolAId,
      sessionId: sessionBId,
      class: "6",
      section: "A",
      startDate: "2025-04-01",
      endDate: "2025-04-30",
    })).resolves.toEqual(["2025-04-10"]);

    await expect(getStudentAttendanceWorkingDates({
      schoolId: schoolBId,
      sessionId: sessionOtherSchoolId,
      class: "6",
      section: "A",
      startDate: "2025-04-01",
      endDate: "2025-04-30",
    })).resolves.toEqual(["2025-04-11"]);

    await expect(getStudentAttendanceWorkingDates({
      schoolId: schoolBId,
      sessionId: sessionAId,
      class: "6",
      section: "A",
      startDate: "2025-04-01",
      endDate: "2025-04-30",
    })).rejects.toThrow("Invalid Academic Session");
  });

  it("keeps Sunday and holiday Attendance while leave without a row creates no date", async () => {
    const dates = await getStudentAttendanceWorkingDates({
      schoolId: schoolAId,
      sessionId: sessionAId,
      class: "6",
      section: "A",
      startDate: "2025-04-01",
      endDate: "2025-04-30",
    });
    expect(dates).toContain("2025-04-06");
    expect(dates).not.toContain("2025-04-15");
  });

  it("keeps a partially marked class date and preserves missing separately", async () => {
    const aggregates = await storage.getStudentAttendanceAggregatesForSessionClass(
      schoolAId, sessionAId, "6", "A", "2025-04-01", "2025-04-30",
    );
    const first = aggregates.find(entry => entry.student.id === studentOneId)?.aggregation;
    const second = aggregates.find(entry => entry.student.id === studentTwoId)?.aggregation;
    const wrongClass = aggregates.find(
      entry => entry.student.id === wrongClassSnapshotStudentId,
    )?.aggregation;

    expect(first).toMatchObject({
      applicableWorkingDays: 3,
      present: 1,
      leave: 1,
      missing: 1,
      weightedAttendance: 2,
      percentage: 66.7,
    });
    expect(second).toMatchObject({
      applicableWorkingDays: 3,
      halfDay: 1,
      absent: 0,
      missing: 2,
      weightedAttendance: 0.5,
      percentage: 16.7,
    });
    expect(wrongClass).toMatchObject({
      applicableWorkingDays: 3,
      present: 0,
      absent: 0,
      missing: 3,
      weightedAttendance: 0,
      percentage: 0,
    });

    const dailyClassRecords = await storage.getAttendanceForStudentsOnDate(
      schoolAId,
      sessionAId,
      [studentOneId, studentTwoId, wrongClassSnapshotStudentId],
      "6",
      "A",
      "2025-04-01",
    );
    expect(dailyClassRecords.map(record => record.studentId)).toEqual([studentOneId]);
  });

  it("does not let a wrong-class row mark the Teacher class as submitted", async () => {
    const today = todayInIST();
    await db.insert(attendanceRecords).values({
      schoolId: schoolAId,
      sessionId: sessionAId,
      studentId: wrongClassSnapshotStudentId,
      teacherId: teacherAId,
      date: today,
      status: "present",
      class: "7",
      section: "A",
      markedBy: "wrong-class submission test",
    });

    await expect(storage.hasAttendanceToday(
      teacherAId, "6", "A", schoolAId, sessionAId,
    )).resolves.toBe(false);
  });

  it("gives daily Admin and historical Student calculations the same evidenced date", async () => {
    const daily = await storage.getDailyAttendanceSummary(
      schoolAId, sessionAId, "2025-04-01",
    );
    const stats = await storage.getStudentAttendanceStats(
      studentOneId, schoolAId, sessionAId, "6", "A",
      "2025-04-01", "2025-04-01",
    );

    expect(daily).toMatchObject({
      total: 2,
      applicableTotal: 4,
      present: 2,
      missing: 2,
      percentage: 50,
    });
    expect(stats).toMatchObject({
      workingDays: 1,
      totalPresent: 1,
      overallPercent: 100,
    });
  });
});