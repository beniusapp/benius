import { and, eq, gte, lte } from "drizzle-orm";
import { academicSessions, attendanceRecords } from "@shared/schema";
import { db } from "./db";

export async function getStudentAttendanceWorkingDates(input: {
  schoolId: number;
  sessionId: number;
  class: string;
  section: string;
  startDate: string;
  endDate: string;
}): Promise<string[]> {
  const [session] = await db.select({
    startDate: academicSessions.startDate,
    endDate: academicSessions.endDate,
  }).from(academicSessions).where(and(
    eq(academicSessions.id, input.sessionId),
    eq(academicSessions.schoolId, input.schoolId),
  )).limit(1);

  if (!session) {
    throw new Error("Invalid Academic Session for Student Attendance working dates");
  }

  const startDate = input.startDate > session.startDate
    ? input.startDate
    : session.startDate;
  const endDate = input.endDate < session.endDate
    ? input.endDate
    : session.endDate;

  if (startDate > endDate) return [];

  const rows = await db.selectDistinct({ date: attendanceRecords.date })
    .from(attendanceRecords)
    .where(and(
      eq(attendanceRecords.schoolId, input.schoolId),
      eq(attendanceRecords.sessionId, input.sessionId),
      eq(attendanceRecords.class, input.class),
      eq(attendanceRecords.section, input.section),
      gte(attendanceRecords.date, startDate),
      lte(attendanceRecords.date, endDate),
    ));

  return rows.map(row => row.date).sort();
}