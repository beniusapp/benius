import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAttendanceDateInSession } from "@shared/attendance-session-date";
import { aggregateStudentAttendance } from "../student-attendance-calculation";
import { AttendanceReadSessionError, requireAttendanceDateInSession, resolveAttendanceReadSession } from "../attendance-read-session";
import { storage } from "../storage";

const session = { id: 11, schoolId: 7, startDate: "2026-04-01", endDate: "2027-03-31" };

afterEach(() => vi.restoreAllMocks());

describe("selected-Session attendance display dates", () => {
  it.each([
    ["Admin before start", "2026-03-31"],
    ["Admin after end", "2027-04-01"],
    ["Teacher roster before start", "2026-03-31"],
    ["Teacher roster after end", "2027-04-01"],
    ["invalid date", "2026-04-99"],
  ])("rejects %s", (_surface, date) => {
    expect(isAttendanceDateInSession(date, session)).toBe(false);
    expect(() => requireAttendanceDateInSession(date, session)).toThrow(AttendanceReadSessionError);
  });

  it.each(["2026-04-01", "2026-09-24", "2027-03-31"])("preserves in-Session %s", date => {
    expect(isAttendanceDateInSession(date, session)).toBe(true);
    expect(() => requireAttendanceDateInSession(date, session)).not.toThrow();
  });

  it("refuses a selected Session owned by a different authenticated school", async () => {
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue(session as any);
    await expect(resolveAttendanceReadSession(8, session.id)).rejects.toMatchObject({
      status: 403, code: "ATTENDANCE_SESSION_FORBIDDEN",
    });
    await expect(resolveAttendanceReadSession(7, session.id)).resolves.toMatchObject(session);
  });

  it("does not change the Student percentage formula", () => {
    expect(aggregateStudentAttendance({
      schoolId: 7, sessionId: 11,
      statuses: ["present", "late", "leave", "halfday", "absent", null],
    }).percentage).toBe(58.3);
  });

  it("wires the boundary guard after Session validation on all Admin and Teacher roster reads", () => {
    const admin = readFileSync(resolve("server/routes.ts"), "utf8");
    const teacher = readFileSync(resolve("server/teacher-routes.ts"), "utf8");
    for (const [source, start, end] of [
      [admin, 'app.get("/api/admin/attendance/class-detail"', '// ===== ADMIN ATTENDANCE: SCHOOL-WIDE OVERVIEW'],
      [admin, 'app.get("/api/admin/attendance/overview"', 'app.get("/api/admin/attendance/teacher-summary"'],
      [admin, 'app.get("/api/admin/attendance/teacher-summary"', '// ===== ACADEMIC SESSIONS API'],
      [teacher, 'app.get("/api/attendance/:schoolId/:class/:section/:date"', 'app.post("/api/attendance"'],
    ]) {
      const block = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
      expect(block.indexOf("requireAttendanceDateInSession(date, attendanceSession)"))
        .toBeGreaterThan(block.indexOf("resolveAttendanceReadSession("));
    }
  });
});