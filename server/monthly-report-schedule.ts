import {
  SCHOOL_TIME_ZONE,
  formatMonthYearFromDateOnly,
  todayInIST,
} from "../shared/ist-time";

export interface MonthlyReportPeriod {
  reportMonth: string;
  startDate: string;
  endDate: string;
  label: string;
}

function parseReportMonth(reportMonth: string): { year: number; month: number } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(reportMonth)) {
    throw new Error(`Invalid report month: ${reportMonth}`);
  }
  const [year, month] = reportMonth.split("-").map(Number);
  return { year: year!, month: month! };
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function reportPeriodForMonth(reportMonth: string): MonthlyReportPeriod {
  const { year, month } = parseReportMonth(reportMonth);
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDate = isoDate(year, month, 1);
  return {
    reportMonth,
    startDate,
    endDate: isoDate(year, month, endDay),
    label: formatMonthYearFromDateOnly(startDate),
  };
}

/**
 * The monthly report always covers the previous completed IST calendar month,
 * never the partially complete month in which the scheduler happens to run.
 */
export function previousCalendarMonthPeriod(now: Date = new Date()): MonthlyReportPeriod {
  const [year, month] = todayInIST(now).split("-").map(Number);
  const previousMonthEnd = new Date(Date.UTC(year!, month! - 1, 0));
  const previousYear = previousMonthEnd.getUTCFullYear();
  const previousMonth = previousMonthEnd.getUTCMonth() + 1;
  const startDate = isoDate(previousYear, previousMonth, 1);
  const endDate = isoDate(previousYear, previousMonth, previousMonthEnd.getUTCDate());
  return {
    reportMonth: startDate.slice(0, 7),
    startDate,
    endDate,
    label: formatMonthYearFromDateOnly(startDate),
  };
}

export function reportMonthsAfter(
  completedMonth: string,
  throughMonth: string,
): string[] {
  const completed = parseReportMonth(completedMonth);
  const through = parseReportMonth(throughMonth);
  const months: string[] = [];
  let year = completed.year;
  let month = completed.month + 1;
  while (year < through.year || (year === through.year && month <= through.month)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return months;
}

function istClock(now: Date): { day: number; time: string } {
  const pieces = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHOOL_TIME_ZONE,
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(pieces.find(part => part.type === type)?.value ?? 0);
  return {
    day: value("day"),
    time: `${String(value("hour")).padStart(2, "0")}:${String(value("minute")).padStart(2, "0")}`,
  };
}

function daysInCurrentISTMonth(now: Date): number {
  const [year, month] = todayInIST(now).split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0)).getUTCDate();
}

/**
 * Day 29–31 schedules run on the final day in shorter months. The at-or-after
 * comparison lets a restart recover a schedule that was due during downtime.
 */
export function isMonthlyReportDue(
  schedule: { dayOfMonth: number; sendTime: string },
  now: Date = new Date(),
): boolean {
  const clock = istClock(now);
  const targetDay = Math.min(schedule.dayOfMonth, daysInCurrentISTMonth(now));
  return clock.day > targetDay || (clock.day === targetDay && clock.time >= schedule.sendTime);
}