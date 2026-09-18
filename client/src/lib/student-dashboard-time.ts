import { getAcademicYearForISTDate } from "@shared/ist-time";

/** Preserves the dashboard's compact academic-year format, e.g. 2025-26. */
export function studentDashboardAcademicYear(dateOnly: string): string {
  const [startYear, endYear] = getAcademicYearForISTDate(dateOnly).split("-");
  return `${startYear}-${endYear.slice(-2)}`;
}

/** Preserves the existing greeting boundaries: morning <12, afternoon <17, evening otherwise. */
export function studentDashboardGreeting(minutesSinceMidnight: number): string {
  if (minutesSinceMidnight < 12 * 60) return "Good Morning";
  if (minutesSinceMidnight < 17 * 60) return "Good Afternoon";
  return "Good Evening";
}

export function nextStudentDashboardGreetingHour(minutesSinceMidnight: number): number {
  if (minutesSinceMidnight < 12 * 60) return 12;
  if (minutesSinceMidnight < 17 * 60) return 17;
  return 0;
}