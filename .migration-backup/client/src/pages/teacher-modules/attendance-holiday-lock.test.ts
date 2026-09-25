import { describe, expect, it } from "vitest";
import {
  canSaveStudentAttendance,
  schoolWideAttendanceHoliday,
  type AttendanceCalendarEvent,
} from "./attendance-holiday-lock";

const date = "2026-09-24";
const targeted = (targetClass: string, targetSection: string): AttendanceCalendarEvent => ({
  date, eventType: "holiday", audienceScope: "Specific_Section",
  title: `${targetClass}-${targetSection} holiday`,
});

function canMark(events: AttendanceCalendarEvent[], overrides: Partial<Parameters<typeof canSaveStudentAttendance>[0]> = {}) {
  return canSaveStudentAttendance({
    isArchiveMode: false,
    isEditable: true,
    allAtLimit: false,
    studentCount: 1,
    holiday: schoolWideAttendanceHoliday(events, date),
    ...overrides,
  });
}

describe("Teacher Student-Attendance holiday UI lock", () => {
  it("blocks marking on an All_School holiday even when a targeted holiday comes first", () => {
    const events = [targeted("5", "A"), { date, eventType: "holiday", audienceScope: "All_School", title: "School holiday" }];
    expect(schoolWideAttendanceHoliday(events, date)?.title).toBe("School holiday");
    expect(canMark(events)).toBe(false);
  });

  it.each([
    ["another section", targeted("5", "A")],
    ["the currently marked section", targeted("5", "B")],
  ])("does not block marking for a targeted holiday for %s", (_description, event) => {
    expect(schoolWideAttendanceHoliday([event], date)).toBeUndefined();
    expect(canMark([event])).toBe(true);
  });

  it("does not confuse other dates or non-holiday events with a school-wide holiday", () => {
    expect(canMark([{ date: "2026-09-23", eventType: "holiday", audienceScope: "All_School", title: "Yesterday" }])).toBe(true);
    expect(canMark([{ date, eventType: "event", audienceScope: "All_School", title: "Assembly" }])).toBe(true);
  });

  it("preserves archived, date-window, edit-limit, and empty-roster restrictions", () => {
    for (const override of [
      { isArchiveMode: true },
      { isEditable: false },
      { allAtLimit: true },
      { studentCount: 0 },
    ]) {
      expect(canMark([targeted("5", "B")], override)).toBe(false);
    }
  });
});