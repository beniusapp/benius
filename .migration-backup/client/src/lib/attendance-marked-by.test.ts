import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatAttendanceMarkedBy } from "./attendance-marked-by";

describe("Attendance marking attribution", () => {
  it("shows a known historical UTC instant in Asia/Kolkata without changing the Teacher's identity", () => {
    const displayed = formatAttendanceMarkedBy("Attendance Teacher at 2026-09-22T18:30:00.000Z");
    expect(displayed).toBe("Attendance Teacher at 23 Sept 2026, 12:00 AM IST");
    expect(displayed).not.toContain("2026-09-22T18:30:00.000Z");
  });

  it("leaves new IST marks and identity-only system marks unchanged", () => {
    expect(formatAttendanceMarkedBy("Attendance Teacher at 23 Sep 2026, 12:00 AM IST"))
      .toBe("Attendance Teacher at 23 Sep 2026, 12:00 AM IST");
    expect(formatAttendanceMarkedBy("System (Leave Approved)"))
      .toBe("System (Leave Approved)");
  });

  it("formats both Teacher display paths and both Admin attribution paths", () => {
    const teacher = readFileSync("client/src/pages/teacher-modules/attendance.tsx", "utf8");
    const admin = readFileSync("client/src/pages/admin-modules/attendance-overview.tsx", "utf8");
    expect(teacher.match(/formatAttendanceMarkedBy\(/g)).toHaveLength(2);
    expect(admin.match(/formatAttendanceMarkedBy\(/g)).toHaveLength(2);
    expect(admin).toContain("formatTimeIST(isoString)");
    expect(admin).toContain("formatDateTimeIST(isoString)");
  });
});