import { calendarWeekday } from "@shared/ist-time";

export interface TeacherSelfRate {
  attendanceRate: number;
  applicableDays: number;
  earned: number;
  workingDays: Record<"sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday", boolean>;
  holidayDates: string[];
}

const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export function isWorkingDate(date: string, rate: TeacherSelfRate): boolean {
  const weekday = calendarWeekday(date);
  return weekday !== null && rate.workingDays[weekdayNames[weekday]] && !rate.holidayDates.includes(date);
}