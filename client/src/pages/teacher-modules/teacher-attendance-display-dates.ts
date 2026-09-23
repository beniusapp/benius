import { addCalendarDays } from "@shared/ist-time";

export function isSessionAttendanceDate(date: string, start: string, end: string, today: string): boolean {
  return !!start && !!end && date >= start && date <= end && date <= today;
}

export function recentSessionAttendanceDates(today: string, start: string, end: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(today, i - 6))
    .filter(date => isSessionAttendanceDate(date, start, end, today));
}