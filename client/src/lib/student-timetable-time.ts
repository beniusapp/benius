import { addCalendarDays, calendarWeekday } from "@shared/ist-time";

/** Admin timetable convention: Monday=0 … Saturday=5; Sunday falls back to Monday. */
export function timetableDayForDate(dateOnly: string): number {
  const weekday = calendarWeekday(dateOnly);
  if (weekday === null || weekday === 0) return 0;
  return weekday - 1;
}

/** Date for an admin timetable day within the school week containing today. */
export function timetableDateForDay(today: string, adminDay: number): string {
  const todayWeekday = calendarWeekday(today);
  if (todayWeekday === null || !Number.isInteger(adminDay) || adminDay < 0 || adminDay > 5) return today;
  return addCalendarDays(today, adminDay + 1 - todayWeekday);
}

export function timetableTimeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + (minute || 0);
}

/** Preserves the existing start-inclusive, end-exclusive period boundary. */
export function isTimetablePeriodActive(currentMinutes: number, startTime: string, endTime: string): boolean {
  return currentMinutes >= timetableTimeToMinutes(startTime)
    && currentMinutes < timetableTimeToMinutes(endTime);
}