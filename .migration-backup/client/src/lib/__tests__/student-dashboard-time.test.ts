import { describe, expect, it } from "vitest";
import { minutesSinceMidnightIST, todayInIST } from "@shared/ist-time";
import {
  nextStudentDashboardGreetingHour,
  studentDashboardAcademicYear,
  studentDashboardGreeting,
} from "../student-dashboard-time";

describe("Student Dashboard IST time policy", () => {
  it.each([
    ["2026-03-31T18:29:59.000Z", "2026-03-31", "2025-26"],
    ["2026-03-31T18:30:00.000Z", "2026-04-01", "2026-27"],
    ["2026-03-31T18:30:01.000Z", "2026-04-01", "2026-27"],
  ])("uses the IST academic-year boundary at %s", (instant, expectedDate, expectedYear) => {
    const date = todayInIST(new Date(instant));
    expect(date).toBe(expectedDate);
    expect(studentDashboardAcademicYear(date)).toBe(expectedYear);
  });

  it.each([
    [0, "Good Morning"],
    [11 * 60 + 59, "Good Morning"],
    [12 * 60, "Good Afternoon"],
    [16 * 60 + 59, "Good Afternoon"],
    [17 * 60, "Good Evening"],
    [23 * 60 + 59, "Good Evening"],
  ])("preserves the greeting at minute %i", (minutes, expectedGreeting) => {
    expect(studentDashboardGreeting(minutes)).toBe(expectedGreeting);
  });

  it.each([
    [11 * 60 + 59, 12],
    [12 * 60, 17],
    [16 * 60 + 59, 17],
    [17 * 60, 0],
  ])("selects the next greeting boundary from minute %i", (minutes, expectedHour) => {
    expect(nextStudentDashboardGreetingHour(minutes)).toBe(expectedHour);
  });

  it("is independent of host timezone when IST has crossed into April", () => {
    const original = process.env.TZ;
    const instant = new Date("2026-03-31T18:45:00.000Z"); // 1 Apr, 00:15 IST
    try {
      for (const timezone of ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York"]) {
        process.env.TZ = timezone;
        const date = todayInIST(instant);
        expect(date).toBe("2026-04-01");
        expect(studentDashboardAcademicYear(date)).toBe("2026-27");
        expect(minutesSinceMidnightIST(instant)).toBe(15);
        expect(studentDashboardGreeting(minutesSinceMidnightIST(instant))).toBe("Good Morning");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("uses the IST greeting when the browser-local hour would differ", () => {
    const instant = new Date("2026-09-18T11:45:00.000Z"); // 17:15 IST
    expect(minutesSinceMidnightIST(instant)).toBe(17 * 60 + 15);
    expect(studentDashboardGreeting(minutesSinceMidnightIST(instant))).toBe("Good Evening");
  });
});