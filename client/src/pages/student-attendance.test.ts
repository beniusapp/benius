import { describe, expect, it } from "vitest";
import { aggregateStudentAttendance } from "../../../server/student-attendance-calculation";
import { getDayCell, getMonthlySummary, getYearlyMonthPercentage, type DayData } from "./student-attendance";

function day(date: string, status = "none", isSunday = false): DayData {
  return {
    date,
    dayOfWeek: isSunday ? 0 : 1,
    status,
    teacherId: status === "none" ? null : 1,
    markedBy: status === "none" ? null : "Teacher",
    isHoliday: false,
    holidayName: null,
    isApprovedLeave: false,
    isSunday,
    isFuture: false,
  };
}

describe("Student Attendance monthly display", () => {
  it("keeps an unmarked Sunday identified as Sunday without fabricating a count", () => {
    const sunday = day("2026-09-06", "none", true);
    expect(getDayCell(sunday).label).toBe("Sunday");
    expect(getMonthlySummary([sunday])).toEqual({
      present: 0, absent: 0, halfDay: 0, late: 0, leave: 0, holiday: 0,
    });
    expect(aggregateStudentAttendance({ schoolId: 1, sessionId: 2, statuses: [] }).applicableWorkingDays).toBe(0);
  });

  it.each([
    ["present", "Present", "present"],
    ["absent", "Absent", "absent"],
    ["late", "Late", "late"],
    ["half_day", "Half Day", "halfDay"],
    ["halfday", "Half Day", "halfDay"],
    ["leave", "Leave", "leave"],
  ] as const)("displays a marked Sunday %s and counts its stored status", (status, label, tally) => {
    const sunday = day("2026-09-06", status, true);
    expect(getDayCell(sunday).label).toBe(label);
    expect(getMonthlySummary([sunday])[tally]).toBe(1);
    const canonical = aggregateStudentAttendance({ schoolId: 1, sessionId: 2, statuses: [status] });
    expect(canonical[tally]).toBe(1);
  });

  it("uses the same canonical Late and Half Day weights regardless of weekday", () => {
    for (const status of ["late", "half_day"]) {
      const sunday = day("2026-09-06", status, true);
      const weekday = day("2026-09-07", status);
      expect(getDayCell(sunday).label).toBe(getDayCell(weekday).label);
      expect(getMonthlySummary([sunday])).toEqual(getMonthlySummary([weekday]));
      const canonical = (date: DayData) => aggregateStudentAttendance({
        schoolId: 1, sessionId: 2, statuses: [date.status],
      }).weightedAttendance;
      expect(canonical(sunday)).toBe(canonical(weekday));
      expect(canonical(sunday)).toBe(status === "late" ? 1 : 0.5);
    }
  });

  it("keeps Present and Absent weekdays and a marked Saturday unchanged", () => {
    const monday = day("2026-09-07", "present");
    const tuesday = day("2026-09-08", "absent");
    const saturday = { ...day("2026-09-12", "present"), dayOfWeek: 6 };
    expect(getDayCell(monday).label).toBe("Present");
    expect(getDayCell(tuesday).label).toBe("Absent");
    expect(getDayCell(saturday).label).toBe("Present");
    expect(getMonthlySummary([monday, tuesday, saturday])).toMatchObject({
      present: 2, absent: 1,
    });
  });

  it("preserves holiday and approved-leave handling for unmarked weekdays", () => {
    const holiday = { ...day("2026-09-09"), isHoliday: true, holidayName: "Holiday" };
    const leave = { ...day("2026-09-10"), isApprovedLeave: true };
    expect(getMonthlySummary([holiday, leave])).toMatchObject({ holiday: 1, leave: 1 });
    expect(getDayCell(holiday).label).toBe("Holiday");
    expect(getDayCell(leave).label).toBe("Approved Leave");
  });
});

describe("Student yearly Attendance percentage", () => {
  const month = (overrides: Partial<{
    present: number; late: number; halfDay: number; leave: number; workingDays: number;
  }> = {}) => ({
    present: 0, late: 0, halfDay: 0, leave: 0, workingDays: 1,
    ...overrides,
  });

  it.each([
    ["Late", { late: 1 }, "late", 100],
    ["Present", { present: 1 }, "present", 100],
    ["Half Day", { halfDay: 1 }, "halfday", 50],
    ["Absent", {}, "absent", 0],
    ["Leave", { leave: 1 }, "leave", 100],
  ] as const)("gives %s the canonical weight", (_label, counts, status, expected) => {
    const percentage = getYearlyMonthPercentage(month(counts));
    expect(percentage).toBe(expected);
    expect(percentage).toBe(aggregateStudentAttendance({
      schoolId: 1, sessionId: 2, statuses: [status],
    }).percentage);
    expect(percentage.toFixed(1)).toBe(expected.toFixed(1));
  });

  it("uses all status weights and keeps Missing in the existing workingDays denominator", () => {
    const counts = month({
      present: 1, late: 1, halfDay: 1, leave: 1, workingDays: 6,
    });
    const percentage = getYearlyMonthPercentage(counts);
    expect(percentage).toBe(58.3);
    expect(percentage.toFixed(1)).toBe("58.3");
    expect(percentage).toBe(aggregateStudentAttendance({
      schoolId: 1, sessionId: 2,
      statuses: ["present", "late", "halfday", "leave", "absent", null],
    }).percentage);
  });

  it("rounds to one decimal like Student Stats", () => {
    const percentage = getYearlyMonthPercentage(month({ present: 1, workingDays: 3 }));
    expect(percentage).toBe(33.3);
    expect(percentage.toFixed(1)).toBe("33.3");
    expect(percentage).toBe(aggregateStudentAttendance({
      schoolId: 1, sessionId: 2, statuses: ["present", "absent", null],
    }).percentage);
  });

  it("displays zero safely when there are no applicable dates", () => {
    const percentage = getYearlyMonthPercentage(month({ workingDays: 0 }));
    expect(percentage).toBe(0);
    expect(percentage.toFixed(1)).toBe("0.0");
    expect(Number.isFinite(percentage)).toBe(true);
    expect(percentage).toBe(aggregateStudentAttendance({
      schoolId: 1, sessionId: 2, statuses: [],
    }).percentage);
  });
});