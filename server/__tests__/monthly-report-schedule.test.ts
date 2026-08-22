import { describe, expect, it } from "vitest";
import {
  isMonthlyReportDue,
  previousCalendarMonthPeriod,
  reportMonthsAfter,
} from "../monthly-report-schedule";

describe("monthly report schedule policy", () => {
  it("uses the previous completed IST calendar month, including year boundaries", () => {
    expect(previousCalendarMonthPeriod(new Date("2026-01-01T03:30:00.000Z"))).toMatchObject({
      reportMonth: "2025-12",
      startDate: "2025-12-01",
      endDate: "2025-12-31",
      label: "December 2025",
    });
    expect(previousCalendarMonthPeriod(new Date("2026-03-01T03:30:00.000Z"))).toMatchObject({
      reportMonth: "2026-02",
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
  });

  it("uses Asia/Kolkata rather than the host timezone for the default 1st/09:00 schedule", () => {
    const schedule = { dayOfMonth: 1, sendTime: "09:00" };
    expect(isMonthlyReportDue(schedule, new Date("2026-08-01T03:29:00.000Z"))).toBe(false);
    expect(isMonthlyReportDue(schedule, new Date("2026-08-01T03:30:00.000Z"))).toBe(true);
  });

  it("runs a 31st schedule on the final day of a short month and recovers after the target minute", () => {
    const schedule = { dayOfMonth: 31, sendTime: "09:00" };
    expect(isMonthlyReportDue(schedule, new Date("2026-02-28T03:29:00.000Z"))).toBe(false);
    expect(isMonthlyReportDue(schedule, new Date("2026-02-28T03:30:00.000Z"))).toBe(true);
    expect(isMonthlyReportDue(schedule, new Date("2026-02-28T07:00:00.000Z"))).toBe(true);
  });

  it("enumerates every unfinished report month after the contiguous completion watermark", () => {
    expect(reportMonthsAfter("2026-05", "2026-08")).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });
});