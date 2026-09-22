import { describe, expect, it } from "vitest";
import {
  aggregateStudentAttendance,
  normalizeStudentAttendanceStatus,
} from "../student-attendance-calculation";

const aggregate = (statuses: Array<string | null | undefined>) =>
  aggregateStudentAttendance({ schoolId: 11, sessionId: 22, statuses });

describe("authoritative Student Attendance calculation", () => {
  it("gives full credit to Present", () => {
    const result = aggregate(Array(10).fill("present"));
    expect(result).toMatchObject({
      weightedAttendance: 10,
      percentage: 100,
      present: 10,
    });
  });

  it("calculates Present and Absent as 80 percent", () => {
    const result = aggregate([
      ...Array(8).fill("present"),
      ...Array(2).fill("absent"),
    ]);
    expect(result).toMatchObject({
      weightedAttendance: 8,
      percentage: 80,
      present: 8,
      absent: 2,
    });
  });

  it("gives full credit to Late", () => {
    const result = aggregate([
      ...Array(8).fill("present"),
      "absent",
      "late",
    ]);
    expect(result).toMatchObject({
      weightedAttendance: 9,
      percentage: 90,
      late: 1,
    });
  });

  it("gives half credit to Half Day", () => {
    const result = aggregate([
      ...Array(8).fill("present"),
      "absent",
      "halfday",
    ]);
    expect(result).toMatchObject({
      weightedAttendance: 8.5,
      percentage: 85,
      halfDay: 1,
    });
  });

  it("gives full credit to Leave", () => {
    const result = aggregate([
      ...Array(8).fill("present"),
      "absent",
      "leave",
    ]);
    expect(result).toMatchObject({
      weightedAttendance: 9,
      percentage: 90,
      leave: 1,
    });
  });

  it("keeps missing distinct from explicit Absent", () => {
    const result = aggregate(["absent", null, undefined, ""]);
    expect(result).toMatchObject({
      absent: 1,
      missing: 3,
      markedTotal: 1,
      applicableWorkingDays: 4,
      weightedAttendance: 0,
      percentage: 0,
    });
  });

  it("gives unknown statuses no credit", () => {
    const result = aggregate(["present", "unexpected"]);
    expect(result).toMatchObject({
      present: 1,
      unknown: 1,
      weightedAttendance: 1,
      percentage: 50,
    });
  });

  it("normalizes halfday and half_day identically", () => {
    expect(normalizeStudentAttendanceStatus("halfday")).toBe("halfday");
    expect(normalizeStudentAttendanceStatus("half_day")).toBe("halfday");
    expect(aggregate(["halfday", "half_day"])).toMatchObject({
      halfDay: 2,
      weightedAttendance: 1,
      percentage: 50,
    });
  });

  it("returns a safe zero when there are no applicable working days", () => {
    const result = aggregate([]);
    expect(result.percentage).toBe(0);
    expect(result.weightedAttendance).toBe(0);
    expect(Number.isFinite(result.percentage)).toBe(true);
  });

  it("rejects aggregation without valid tenant and Session context", () => {
    expect(() => aggregateStudentAttendance({
      schoolId: 0,
      sessionId: 22,
      statuses: ["present"],
    })).toThrow("schoolId");
    expect(() => aggregateStudentAttendance({
      schoolId: 11,
      sessionId: 0,
      statuses: ["present"],
    })).toThrow("sessionId");
  });
});