import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  calendarDayDifference,
  calendarMonthEndDate,
  calendarWeekday,
  calendarWeekStartMonday,
  dateOnlyInIST,
  formatDateOnly,
  formatDateOnlyWithWeekday,
  formatDateTimeIST,
  formatInstantIST,
  getAcademicYearForISTDate,
  instantEpochMillis,
  isValidDateOnly,
  millisecondsUntilNextISTMidnight,
  todayInIST,
} from "../ist-time";

describe("IST date/time policy", () => {
  it("formats the same persisted instant in IST regardless of host timezone", () => {
    expect(formatDateTimeIST("2026-03-31 18:30:00")).toBe("01 Apr 2026, 12:00 AM IST");
    expect(formatInstantIST("2026-03-31T18:30:00Z")).toContain("01 Apr 2026");
  });

  it("formats PostgreSQL timestamps with short and full timezone offsets", () => {
    // Raw Drizzle queries serialize TIMESTAMPTZ offsets as "+00" / "-05".
    expect(formatInstantIST("2026-08-21 23:14:01+00"))
      .toBe("22 Aug 2026, 04:44:01 AM IST");
    expect(formatInstantIST("2026-08-21 23:14:01-05"))
      .toBe("22 Aug 2026, 09:44:01 AM IST");
    expect(formatInstantIST("2026-08-21 23:14:01+05:30"))
      .toBe("21 Aug 2026, 11:14:01 PM IST");
    expect(formatInstantIST("2026-08-21T23:14:01Z"))
      .toBe("22 Aug 2026, 04:44:01 AM IST");
  });

  it("accepts Date instances and rejects missing or invalid instants", () => {
    expect(formatInstantIST(new Date("2026-08-21T23:14:01.000Z")))
      .toBe("22 Aug 2026, 04:44:01 AM IST");
    expect(formatInstantIST(null)).toBe("—");
    expect(formatInstantIST(undefined)).toBe("—");
    expect(formatInstantIST("not-a-timestamp")).toBe("—");
  });

  it("keeps calendar DATE values calendar-only", () => {
    expect(formatDateOnly("2026-04-01")).toBe("01 Apr 2026");
    expect(addCalendarDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("uses IST boundaries for the business date and academic year", () => {
    expect(todayInIST(new Date("2026-03-31T18:29:59Z"))).toBe("2026-03-31");
    expect(todayInIST(new Date("2026-03-31T18:30:00Z"))).toBe("2026-04-01");
    expect(getAcademicYearForISTDate("2026-03-31")).toBe("2025-2026");
    expect(getAcademicYearForISTDate("2026-04-01")).toBe("2026-2027");
  });

  it.each([
    "2026-04-01",
    "2026-03-31",
    "2024-02-29",
  ])("accepts the valid calendar date %s", date => {
    expect(isValidDateOnly(date)).toBe(true);
  });

  it.each([
    "2026-02-30",
    "2026-13-01",
    "2026-00-01",
    "2026-2-01",
    "not-a-date",
  ])("rejects the invalid calendar date %s", date => {
    expect(isValidDateOnly(date)).toBe(false);
  });

  it("calculates the seven-day correction window using calendar dates", () => {
    expect(calendarDayDifference("2026-09-18", "2026-09-18")).toBe(0);
    expect(calendarDayDifference("2026-09-17", "2026-09-18")).toBe(1);
    expect(calendarDayDifference("2026-09-11", "2026-09-18")).toBe(7);
    expect(calendarDayDifference("2026-09-10", "2026-09-18")).toBe(8);
    expect(calendarDayDifference("2026-09-19", "2026-09-18")).toBe(-1);
    expect(calendarDayDifference("2026-02-30", "2026-09-18")).toBeNull();
  });

  it("builds Attendance daily, weekly, and monthly periods as calendar dates", () => {
    expect(addCalendarDays("2026-09-18", -29)).toBe("2026-08-20");
    expect(calendarWeekStartMonday("2026-09-18")).toBe("2026-09-14");
    expect(calendarWeekStartMonday("2026-09-20")).toBe("2026-09-14");
    expect(calendarMonthEndDate(2026, 2)).toBe("2026-02-28");
    expect(calendarMonthEndDate(2024, 2)).toBe("2024-02-29");
    expect(calendarMonthEndDate(2026, 12)).toBe("2026-12-31");
  });

  it("keeps attendance calendar calculations independent of the host timezone", () => {
    const original = process.env.TZ;
    try {
      for (const timezone of ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York"]) {
        process.env.TZ = timezone;
        expect(getAcademicYearForISTDate("2026-03-31")).toBe("2025-2026");
        expect(getAcademicYearForISTDate("2026-04-01")).toBe("2026-2027");
        expect(calendarDayDifference("2026-09-11", "2026-09-18")).toBe(7);
        expect(calendarWeekday("2026-09-18")).toBe(5);
        expect(calendarWeekStartMonday("2026-09-18")).toBe("2026-09-14");
        expect(calendarMonthEndDate(2026, 2)).toBe("2026-02-28");
        expect(formatDateOnlyWithWeekday("2026-09-18", { weekday: "long", includeYear: true }))
          .toBe("Friday, 18 Sep 2026");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it.each([
    ["2026-09-18T18:29:59.000Z", 1000],
    ["2026-09-18T18:30:00.000Z", 86_400_000],
    ["2026-09-18T18:30:01.000Z", 86_399_000],
    ["2026-03-31T18:29:59.000Z", 1000],
    ["2026-12-31T18:29:59.000Z", 1000],
  ])("calculates the next IST midnight from %s", (instant, expectedMs) => {
    expect(millisecondsUntilNextISTMidnight(new Date(instant))).toBe(expectedMs);
  });

  it.each([
    ["2026-08-21T18:29:59Z", "2026-08-21"],
    ["2026-08-21T18:30:00Z", "2026-08-22"],
    ["2026-08-21T18:30:01Z", "2026-08-22"],
    ["2026-08-22T18:29:59Z", "2026-08-22"],
    ["2026-08-22T18:30:00Z", "2026-08-23"],
  ])("assigns %s to the correct IST business date", (instant, expectedDate) => {
    expect(dateOnlyInIST(instant)).toBe(expectedDate);
  });

  it("normalizes every persisted UTC timestamp shape to the same IST instant", () => {
    const expected = "22 Aug 2026, 12:00:00 AM IST";
    expect(formatInstantIST("2026-08-21 18:30:00")).toBe(expected);
    expect(formatInstantIST("2026-08-21T18:30:00Z")).toBe(expected);
    expect(formatInstantIST("2026-08-21 18:30:00+00")).toBe(expected);
    expect(formatInstantIST("2026-08-22 00:00:00+05:30")).toBe(expected);
    expect(formatInstantIST(new Date("2026-08-21T18:30:00Z"))).toBe(expected);
  });

  it("sorts persisted instant shapes by their real instant rather than host-local parsing", () => {
    const expected = Date.parse("2026-08-21T18:30:00Z");
    expect(instantEpochMillis("2026-08-21 18:30:00")).toBe(expected);
    expect(instantEpochMillis("2026-08-21 18:30:00+00")).toBe(expected);
    expect(instantEpochMillis("2026-08-22 00:00:00+05:30")).toBe(expected);
    expect(instantEpochMillis(String(new Date(expected)))).toBe(expected);
    expect(instantEpochMillis("invalid")).toBeNull();
  });
});