import { describe, expect, it } from "vitest";
import { isSessionAttendanceDate, recentSessionAttendanceDates } from "./teacher-attendance-display-dates";

describe("My Attendance generated dates", () => {
  it("does not show recent dates before a Session starts", () => {
    expect(recentSessionAttendanceDates("2026-09-24", "2026-09-22", "2026-10-31"))
      .toEqual(["2026-09-22", "2026-09-23", "2026-09-24"]);
    expect(isSessionAttendanceDate("2026-09-21", "2026-09-22", "2026-10-31", "2026-09-24")).toBe(false);
  });

  it("does not show dates after a historical Session ends", () => {
    expect(recentSessionAttendanceDates("2026-09-24", "2025-04-01", "2026-03-31")).toEqual([]);
    expect(isSessionAttendanceDate("2026-04-01", "2025-04-01", "2026-03-31", "2026-09-24")).toBe(false);
  });

  it("leaves future monthly calendar dates blank, even within the Session", () => {
    expect(isSessionAttendanceDate("2026-09-25", "2026-09-01", "2026-10-31", "2026-09-24")).toBe(false);
    expect(isSessionAttendanceDate("2026-09-24", "2026-09-01", "2026-10-31", "2026-09-24")).toBe(true);
  });

  it("retains all seven recent dates in a current Session", () => {
    expect(recentSessionAttendanceDates("2026-09-24", "2026-04-01", "2027-03-31"))
      .toEqual(["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"]);
  });
});