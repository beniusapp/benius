export const MONTH_NAMES: string[];
export const DAY_LABELS: string[];
export type DisplayDay = { date: string; status: string; isInSession: boolean; isFuture: boolean; isSunday: boolean; isHoliday: boolean; holidayName: string | null; isApprovedLeave: boolean };
export function getDayCell(day: DisplayDay): { tone: 'outside' | 'closed' | 'future' | 'leave' | 'present' | 'absent' | 'partial' | 'unknown' | 'unmarked'; dot: boolean; label: string };
export function getMonthlySummary(days: DisplayDay[]): { present: number; absent: number; halfDay: number; late: number; leave: number; holiday: number };
export function getYearlyMonthPercentage(month: { present: number; late: number; leave: number; halfDay: number; workingDays: number }): number;
export function istToday(now?: Date): { year: number; month: number; day: number };
export function calendarWeekday(date: string): number | null;
export function formatDateOnly(date: string): string;