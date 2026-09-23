import { describe, expect, it } from "vitest";
import { aggregateStudentAttendance } from "../../../server/student-attendance-calculation";
import { getDayCell, getMonthlySummary, type DayData } from "./student-attendance";

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