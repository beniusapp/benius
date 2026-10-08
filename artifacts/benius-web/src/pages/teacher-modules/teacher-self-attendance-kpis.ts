import { calendarMonthEndDate, dateOnlyParts } from "@shared/ist-time";

export interface TeacherSelfAttendanceKpiRecord {
  attendanceDate: string;
  status: string;
  totalWorkingMinutes: number;
}

export interface TeacherSelfAttendanceKpis {
  present: number;
  late: number;
  halfDay: number;
  avgDur: number;
}

function currentISTMonthSessionRange(
  today: string,
  sessionStartDate: string | null | undefined,
  sessionEndDate: string | null | undefined,
): { start: string; end: string } | null {
  const todayParts = dateOnlyParts(today);
  if (!todayParts || !sessionStartDate || !sessionEndDate || sessionStartDate > sessionEndDate) {
    return null;
  }

  const monthStart = `${todayParts.year}-${String(todayParts.month).padStart(2, "0")}-01`;
  const monthEnd = calendarMonthEndDate(todayParts.year, todayParts.month);
  if (!monthEnd) return null;

  const start = sessionStartDate > monthStart ? sessionStartDate : monthStart;
  const endLimit = sessionEndDate < monthEnd ? sessionEndDate : monthEnd;
  const end = today < endLimit ? today : endLimit;
  return start <= end ? { start, end } : null;
}

export function calculateTeacherSelfAttendanceKpis(
  records: readonly TeacherSelfAttendanceKpiRecord[],
  today: string,
  sessionStartDate: string | null | undefined,
  sessionEndDate: string | null | undefined,
  isWorkingDate: (date: string) => boolean,
): TeacherSelfAttendanceKpis {
  const workdays = records.filter(record => isWorkingDate(record.attendanceDate));
  const monthRange = currentISTMonthSessionRange(today, sessionStartDate, sessionEndDate);
  const present = monthRange
    ? workdays.filter(record =>
        record.status === "Present" &&
        record.attendanceDate >= monthRange.start &&
        record.attendanceDate <= monthRange.end
      ).length
    : 0;
  const late = workdays.filter(record => record.status === "Late").length;
  const halfDay = workdays.filter(record => record.status === "Half Day").length;
  const durations = records.filter(record => record.totalWorkingMinutes > 0)
    .map(record => record.totalWorkingMinutes);
  const avgDur = durations.length > 0
    ? Math.round(durations.reduce((total, minutes) => total + minutes, 0) / durations.length)
    : 0;

  return { present, late, halfDay, avgDur };
}
