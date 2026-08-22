import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  dateOnlyInIST,
  formatDateOnly,
  formatDateTimeIST,
  formatInstantIST,
  getAcademicYearForISTDate,
  instantEpochMillis,
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