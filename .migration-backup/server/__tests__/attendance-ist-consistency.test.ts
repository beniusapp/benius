import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recomputeStatus, utcToISTHHMM, DEFAULT_POLICY } from "../attendance-policy-engine";
import { calendarDayDifference, calendarWeekday, instantEpochMillis, minutesSinceMidnightIST, todayInIST } from "@shared/ist-time";

describe("Step 2K Attendance IST consistency", () => {
  it("switches the business date exactly at IST midnight", () => {
    expect(todayInIST(new Date("2026-09-22T18:29:59Z"))).toBe("2026-09-22");
    expect(todayInIST(new Date("2026-09-22T18:30:00Z"))).toBe("2026-09-23");
  });

  it("keeps date-only weekday and inclusive duration independent of host timezone", () => {
    expect(calendarWeekday("2026-09-01")).toBe(2);
    expect(calendarDayDifference("2026-12-31", "2027-01-02")).toBe(2);
  });

  it("parses bare database timestamps as UTC instants for policy evaluation and elapsed time", () => {
    expect(utcToISTHHMM("2026-09-22 18:30:00")).toBe("00:00");
    expect(instantEpochMillis("2026-09-22 18:30:00")).toBe(Date.parse("2026-09-22T18:30:00Z"));
    expect(recomputeStatus({ checkInTime: "2026-09-22 03:30:00" }, DEFAULT_POLICY)).toBe("Present");
  });

  it("uses canonical IST wall-clock minutes", () => {
    expect(minutesSinceMidnightIST(new Date("2026-09-22T18:30:00Z"))).toBe(0);
  });

  it("keeps audited implementation sites on canonical helpers", () => {
    const teacherRoutes = readFileSync("server/teacher-routes.ts", "utf8");
    const storage = readFileSync("server/storage.ts", "utf8");
    const client = readFileSync("client/src/pages/teacher-modules/my-attendance.tsx", "utf8");
    const detailedHistory = readFileSync("client/src/pages/teacher-modules/attendance-history.tsx", "utf8");
    expect(teacherRoutes).not.toContain("const year = new Date().getFullYear()");
    expect(storage).not.toContain("new Date(year, month - 1, day).getDay()");
    expect(storage).not.toContain("new Date(r.startDate)");
    expect(client).not.toContain("19_800_000");
    expect(client).not.toContain("new Date(todayRec.checkInTime)");
    expect(client).toContain("sessionId={selectedSessionId}");
    expect(detailedHistory).toContain("queryKey: [apiUrl, sessionId]");
    expect(detailedHistory).toContain("sessionFetchForViewSession(apiUrl, sessionId)");
  });
});