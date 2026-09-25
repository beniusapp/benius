import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "./db";
import { calendarEvents, teacherSelfAttendance } from "@workspace/db";
import type { AcademicSession } from "@workspace/db";
import { addCalendarDays, calendarWeekday, isValidDateOnly, todayInIST } from "@shared/ist-time";
import { getWorkingDays, WEEKDAYS, type WorkingDays } from "./teacher-working-days";

type AttendanceRow = { attendanceDate: string; status: string };

export function calculateTeacherSelfRate(
  start: string, end: string, today: string, workingDays: WorkingDays,
  holidays: ReadonlySet<string>, rows: readonly AttendanceRow[],
) {
  if (![start, end, today].every(isValidDateOnly) || start > end) {
    throw new Error("Invalid Academic Session dates");
  }
  const last = end < today ? end : today;
  const byDate = new Map(rows.map(row => [row.attendanceDate, row.status]));
  let applicableDays = 0;
  let earned = 0;
  for (let day = start; day <= last; day = addCalendarDays(day, 1)) {
    const weekday = calendarWeekday(day);
    if (weekday === null || !workingDays[WEEKDAYS[weekday]] || holidays.has(day)) continue;
    applicableDays++;
    const status = byDate.get(day);
    if (status === "Present" || status === "Late") earned++;
    else if (status === "Half Day") earned += 0.5;
    // Missing rows, Absent, Leave and Not Marked earn zero; stored statuses are untouched.
  }
  return {
    attendanceRate: applicableDays ? Math.round((earned / applicableDays) * 1000) / 10 : 0,
    applicableDays,
    earned,
  };
}

export async function getTeacherSelfRate(
  schoolId: number, teacherId: number, session: AcademicSession, today = todayInIST(),
) {
  if (session.schoolId !== schoolId) throw new Error("Academic Session does not belong to school");
  const workingDays = await getWorkingDays(schoolId);
  const last = session.endDate < today ? session.endDate : today;
  if (!isValidDateOnly(session.startDate) || !isValidDateOnly(session.endDate) ||
      session.startDate > session.endDate) throw new Error("Invalid Academic Session dates");
  const [rows, events] = session.startDate <= last ? await Promise.all([
    db.select({ attendanceDate: teacherSelfAttendance.attendanceDate, status: teacherSelfAttendance.status })
      .from(teacherSelfAttendance).where(and(
        eq(teacherSelfAttendance.schoolId, schoolId), eq(teacherSelfAttendance.teacherId, teacherId),
        eq(teacherSelfAttendance.sessionId, session.id),
        gte(teacherSelfAttendance.attendanceDate, session.startDate),
        lte(teacherSelfAttendance.attendanceDate, last),
      )),
    db.select({ date: calendarEvents.date }).from(calendarEvents).where(and(
      eq(calendarEvents.schoolId, schoolId), eq(calendarEvents.eventType, "holiday"),
      eq(calendarEvents.audienceScope, "All_School"),
      gte(calendarEvents.date, session.startDate), lte(calendarEvents.date, last),
    )),
  ]) : [[], []];
  const holidayDates = [...new Set(events.map(event => event.date))];
  return {
    ...calculateTeacherSelfRate(session.startDate, session.endDate, today, workingDays, new Set(holidayDates), rows),
    workingDays,
    holidayDates,
  };
}