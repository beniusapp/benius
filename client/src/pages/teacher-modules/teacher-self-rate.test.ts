import { describe, expect, it } from "vitest";
import { isWorkingDate } from "./teacher-self-rate";

describe("Teacher attendance date labels on both screens", () => {
  it("uses the server-provided weekdays and holidays rather than a hardcoded weekend", () => {
    const rate = {
      attendanceRate: 50, applicableDays: 2, earned: 1,
      workingDays: {
        monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
        saturday: true, sunday: false,
      },
      holidayDates: ["2026-09-19"],
    };
    expect(isWorkingDate("2026-09-19", rate)).toBe(false);
    expect(isWorkingDate("2026-09-26", rate)).toBe(true);
    expect(isWorkingDate("2026-09-27", rate)).toBe(false);
  });
});