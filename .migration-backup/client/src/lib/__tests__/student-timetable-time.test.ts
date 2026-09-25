import { describe, expect, it } from "vitest";
import { minutesSinceMidnightIST, todayInIST } from "@shared/ist-time";
import {
  isTimetablePeriodActive,
  timetableDateForDay,
  timetableDayForDate,
} from "../student-timetable-time";

describe("Student Timetable IST time policy", () => {
  it.each([
    ["2026-09-18T18:29:59.000Z", "2026-09-18", 4],
    ["2026-09-18T18:30:00.000Z", "2026-09-19", 5],
    ["2026-09-18T18:30:01.000Z", "2026-09-19", 5],
  ])("uses the IST date and timetable weekday at %s", (instant, expectedDate, expectedDay) => {
    const date = todayInIST(new Date(instant));
    expect(date).toBe(expectedDate);
    expect(timetableDayForDate(date)).toBe(expectedDay);
  });

  it("builds the Monday-to-Saturday school week using date-only arithmetic", () => {
    const friday = "2026-09-18";
    expect(timetableDateForDay(friday, 0)).toBe("2026-09-14");
    expect(timetableDateForDay(friday, 4)).toBe("2026-09-18");
    expect(timetableDateForDay(friday, 5)).toBe("2026-09-19");

    const sunday = "2026-09-20";
    expect(timetableDayForDate(sunday)).toBe(0);
    expect(timetableDateForDay(sunday, 0)).toBe("2026-09-21");
  });

  it.each([
    [8 * 60 + 59, false],
    [9 * 60, true],
    [9 * 60 + 30, true],
    [9 * 60 + 44, true],
    [9 * 60 + 45, false],
    [9 * 60 + 46, false],
  ])("preserves the active-period boundary at minute %i", (currentMinutes, expected) => {
    expect(isTimetablePeriodActive(currentMinutes, "09:00", "09:45")).toBe(expected);
  });

  it("is independent of the host timezone for the same school instant", () => {
    const original = process.env.TZ;
    const instant = new Date("2026-09-18T18:45:00.000Z"); // 19 Sep, 00:15 IST
    try {
      for (const timezone of ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York"]) {
        process.env.TZ = timezone;
        const date = todayInIST(instant);
        expect(date).toBe("2026-09-19");
        expect(timetableDayForDate(date)).toBe(5);
        expect(timetableDateForDay(date, 5)).toBe("2026-09-19");
        expect(minutesSinceMidnightIST(instant)).toBe(15);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("uses IST school time for a period while the host timezone differs", () => {
    const instant = new Date("2026-09-18T04:00:00.000Z"); // 09:30 IST
    const currentMinutes = minutesSinceMidnightIST(instant);
    expect(currentMinutes).toBe(9 * 60 + 30);
    expect(isTimetablePeriodActive(currentMinutes, "09:00", "09:45")).toBe(true);
  });
});