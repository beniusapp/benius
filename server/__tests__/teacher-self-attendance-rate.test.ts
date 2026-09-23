import { describe, expect, it } from "vitest";
import { addCalendarDays, todayInIST } from "@shared/ist-time";
import { calculateTeacherSelfRate, getTeacherSelfRate } from "../teacher-self-attendance-rate";
import { DEFAULT_WORKING_DAYS, parseWorkingDays } from "../teacher-working-days";

const days = DEFAULT_WORKING_DAYS;
const rate = (start: string, end: string, today: string, overrides = days,
  holidays = new Set<string>(), rows: { attendanceDate: string; status: string }[] = []) =>
  calculateTeacherSelfRate(start, end, today, overrides, holidays, rows);

describe("school working days", () => {
  it("defaults to Monday–Friday; Saturday and Sunday are off", () => {
    expect(days).toEqual({
      monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
      saturday: false, sunday: false,
    });
    expect(rate("2026-09-19", "2026-09-20", "2026-09-20").applicableDays).toBe(0);
  });

  it("validates exactly seven booleans, one or more enabled", () => {
    expect(parseWorkingDays({ ...days, saturday: true })).toEqual({ ...days, saturday: true });
    for (const bad of [
      {}, [], null, { ...days, saturday: "true" }, { ...days, unknown: true },
      { ...days, monday: undefined }, Object.fromEntries(Object.keys(days).map(day => [day, false])),
    ]) expect(() => parseWorkingDays(bad)).toThrow();
  });
});

describe("canonical Teacher self-attendance rate", () => {
  it("includes enabled Saturdays and Sundays and ignores disabled ones", () => {
    const start = "2026-09-19", end = "2026-09-20";
    expect(rate(start, end, end).applicableDays).toBe(0);
    expect(rate(start, end, end, { ...days, saturday: true }).applicableDays).toBe(1);
    expect(rate(start, end, end, { ...days, sunday: true }).applicableDays).toBe(1);
    expect(rate(start, end, end, { ...days, saturday: true, sunday: true }).applicableDays).toBe(2);
  });

  it("excludes All-School holiday dates even when Saturday is on", () => {
    expect(rate("2026-09-19", "2026-09-19", "2026-09-19",
      { ...days, saturday: true }, new Set(["2026-09-19"]),
      [{ attendanceDate: "2026-09-19", status: "Present" }])).toEqual({
      attendanceRate: 0, applicableDays: 0, earned: 0,
    });
  });

  it("counts missing, Leave, Absent, and Not Marked as zero; Half Day as half", () => {
    const rows = [
      { attendanceDate: "2026-09-21", status: "Present" },
      { attendanceDate: "2026-09-22", status: "Late" },
      { attendanceDate: "2026-09-23", status: "Half Day" },
      { attendanceDate: "2026-09-24", status: "Leave" },
      { attendanceDate: "2026-09-25", status: "Absent" },
      { attendanceDate: "2026-09-28", status: "Not Marked" },
    ];
    expect(rate("2026-09-21", "2026-09-29", "2026-09-29", days, new Set(), rows)).toEqual({
      attendanceRate: 35.7, applicableDays: 7, earned: 2.5,
    });
  });

  it("enforces inclusive Session bounds and excludes the future", () => {
    const rows = [
      { attendanceDate: "2026-09-20", status: "Present" },
      { attendanceDate: "2026-09-21", status: "Present" },
      { attendanceDate: "2026-09-22", status: "Present" },
      { attendanceDate: "2026-09-23", status: "Present" },
    ];
    expect(rate("2026-09-21", "2026-09-22", "2026-09-30", days, new Set(), rows)).toEqual({
      attendanceRate: 100, applicableDays: 2, earned: 2,
    });
    expect(rate("2026-09-21", "2026-09-30", "2026-09-22", days, new Set(), rows).applicableDays).toBe(2);
    expect(rate("2026-09-28", "2026-09-30", "2026-09-22").attendanceRate).toBe(0);
  });

  it("uses IST for the as-of date at midnight, without local timezone", () => {
    const istDate = todayInIST(new Date("2026-09-20T19:00:00.000Z"));
    expect(istDate).toBe("2026-09-21");
    expect(addCalendarDays(istDate, 1)).toBe("2026-09-22");
    expect(rate("2026-09-21", "2026-09-22", istDate).applicableDays).toBe(1);
  });

  it("rejects a Session owned by another school before reading school configuration or rows", async () => {
    await expect(getTeacherSelfRate(1, 10, {
      id: 5, schoolId: 2, startDate: "2026-09-21", endDate: "2026-09-22",
    } as any)).rejects.toThrow("does not belong to school");
  });
});