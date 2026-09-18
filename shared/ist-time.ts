/**
 * India school time policy.
 *
 * Persisted timestamp-without-time-zone values are treated as UTC wall-clock
 * instants by the existing deployment convention. Calendar DATE values are
 * never parsed as Date objects.
 */
export const SCHOOL_TIME_ZONE = "Asia/Kolkata";
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type InstantInput = string | Date | null | undefined;

function instant(value: InstantInput): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const source = String(value).trim();
  const isPostgresTimestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(source);
  if (!isPostgresTimestamp) {
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = source.replace(" ", "T");
  // PostgreSQL timestamp-without-time-zone values in this app are UTC.
  // PostgreSQL TIMESTAMPTZ values returned by raw Drizzle queries can use a
  // shortened offset such as "+00" or "-05". JavaScript rejects that offset
  // once the timestamp has an ISO "T", so expand it before parsing. Do this
  // only for timestamp values so a calendar date like "2026-08-21" remains
  // untouched.
  const withFullOffset = raw.includes("T")
    ? raw.replace(/([+-]\d{2})$/, "$1:00")
    : raw;
  const normalized = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(withFullOffset)
    ? withFullOffset
    : `${withFullOffset}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parts(value: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: SCHOOL_TIME_ZONE, ...options })
    .format(value)
    .replace(/\bam\b/gi, "AM")
    .replace(/\bpm\b/gi, "PM");
}

export function formatInstantIST(value: InstantInput): string {
  const date = instant(value);
  return date ? `${parts(date, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })} IST` : "—";
}

export function formatDateTimeIST(value: InstantInput): string {
  const date = instant(value);
  return date ? `${parts(date, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })} IST` : "—";
}

export function formatTimeIST(value: InstantInput): string {
  const date = instant(value);
  return date ? `${parts(date, { hour: "2-digit", minute: "2-digit", hour12: true })} IST` : "—";
}

export function formatMonthYearIST(value: InstantInput): string {
  const date = instant(value);
  return date ? parts(date, { month: "long", year: "numeric" }) : "—";
}

/** Epoch milliseconds for a persisted instant, including bare-UTC timestamps. */
export function instantEpochMillis(value: InstantInput): number | null {
  return instant(value)?.getTime() ?? null;
}

/** Formats a PostgreSQL DATE / YYYY-MM-DD string without timezone conversion. */
export function formatDateOnly(value: string | null | undefined, long = false): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).slice(0, 10));
  if (!match) return String(value);
  const [, year, month, day] = match;
  const monthName = (long ? MONTHS_LONG : MONTHS_SHORT)[Number(month) - 1];
  if (!monthName) return String(value);
  return `${day} ${monthName} ${year}`;
}

/** Formats a calendar DATE with its weekday without browser-local conversion. */
export function formatDateOnlyWithWeekday(
  value: string,
  options: { weekday?: "short" | "long"; includeYear?: boolean } = {},
): string {
  const dateParts = dateOnlyParts(String(value).slice(0, 10));
  const weekday = calendarWeekday(String(value).slice(0, 10));
  if (!dateParts || weekday === null) return String(value);
  const weekdayName = (options.weekday === "long" ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[weekday];
  const monthName = MONTHS_SHORT[dateParts.month - 1];
  return `${weekdayName}, ${dateParts.day} ${monthName}${options.includeYear ? ` ${dateParts.year}` : ""}`;
}

/** Month/year label ("August 2026") for a calendar DATE without timezone conversion. */
export function formatMonthYearFromDateOnly(value: string, long = true): string {
  const parts = dateOnlyParts(String(value).slice(0, 10));
  if (!parts) return String(value);
  const monthName = (long ? MONTHS_LONG : MONTHS_SHORT)[parts.month - 1];
  return monthName ? `${monthName} ${parts.year}` : String(value);
}

/** Month-only label ("August") for a calendar DATE without timezone conversion. */
export function formatMonthFromDateOnly(value: string, long = true): string {
  const parts = dateOnlyParts(String(value).slice(0, 10));
  if (!parts) return String(value);
  return (long ? MONTHS_LONG : MONTHS_SHORT)[parts.month - 1] ?? String(value);
}

/** Day-of-month (1–31) for a calendar DATE without timezone conversion. */
export function dayOfMonthFromDateOnly(value: string): number | null {
  return dateOnlyParts(String(value).slice(0, 10))?.day ?? null;
}

export function dateOnlyParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const parts = { year: Number(year), month: Number(month), day: Number(day) };
  return parts.month >= 1 && parts.month <= 12 && parts.day >= 1 && parts.day <= 31 ? parts : null;
}

/** Validates an exact Gregorian calendar DATE without parsing it as an instant. */
export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const dateParts = dateOnlyParts(value);
  if (!dateParts) return false;
  const { year, month, day } = dateParts;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/**
 * Calendar-day distance from `fromDate` to `toDate`.
 * Positive means `fromDate` is earlier; negative means it is later.
 */
export function calendarDayDifference(fromDate: string, toDate: string): number | null {
  if (!isValidDateOnly(fromDate) || !isValidDateOnly(toDate)) return null;
  const from = dateOnlyParts(fromDate)!;
  const to = dateOnlyParts(toDate)!;
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000,
  );
}

/** Adds calendar days without using the host timezone. */
export function addCalendarDays(dateOnly: string, days: number): string {
  const value = dateOnlyParts(dateOnly);
  if (!value || !Number.isInteger(days)) return dateOnly;
  const anchor = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}-${String(anchor.getUTCDate()).padStart(2, "0")}`;
}

export function calendarWeekday(dateOnly: string): number | null {
  const value = dateOnlyParts(dateOnly);
  return value ? new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay() : null;
}

/** Monday starting the calendar week that contains the supplied DATE. */
export function calendarWeekStartMonday(dateOnly: string): string {
  const weekday = calendarWeekday(dateOnly);
  if (weekday === null) return dateOnly;
  return addCalendarDays(dateOnly, weekday === 0 ? -6 : 1 - weekday);
}

/** Last calendar date in a year/month, with month numbered 1–12. */
export function calendarMonthEndDate(year: number, month: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return addCalendarDays(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`, -1);
}

export function replaceCalendarYear(dateOnly: string, year: number): string {
  const value = dateOnlyParts(dateOnly);
  if (!value || !Number.isInteger(year)) return dateOnly;
  const result = new Date(Date.UTC(year, value.month - 1, value.day));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

export function dateOnlyInIST(value: InstantInput): string | null {
  const date = instant(value);
  return date ? todayInIST(date) : null;
}

export function todayInIST(now: Date = new Date()): string {
  const values = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => values.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Milliseconds until the next Asia/Kolkata calendar day begins. */
export function millisecondsUntilNextISTMidnight(now: Date = new Date()): number {
  const nextDate = addCalendarDays(todayInIST(now), 1);
  const nextMidnight = Date.parse(`${nextDate}T00:00:00+05:30`);
  return Math.max(0, nextMidnight - now.getTime());
}

export function getAcademicYearForISTDate(date: string = todayInIST()): string {
  const dateParts = dateOnlyParts(date);
  if (!dateParts) throw new Error(`Expected YYYY-MM-DD academic-year date, received ${date}`);
  const { year, month } = dateParts;
  const start = month >= 4 ? year : year - 1;
  return `${start}-${start + 1}`;
}