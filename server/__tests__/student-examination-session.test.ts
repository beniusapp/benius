import { describe, expect, it, vi } from "vitest";
import { resolveStudentExaminationSession } from "../student-examination-session";

describe("Student Examination session authority", () => {
  it("allows a session only when it belongs to the authenticated student's school", async () => {
    const getStudentById = vi.fn().mockResolvedValue({ id: 101, schoolId: 11 });
    const getAcademicSessionForSchool = vi.fn().mockResolvedValue({ id: 2028, schoolId: 11 });

    const result = await resolveStudentExaminationSession(101, 2028, {
      getStudentById,
      getAcademicSessionForSchool,
    });

    expect(result).toMatchObject({ ok: true, schoolId: 11, sessionId: 2028 });
    expect(getAcademicSessionForSchool).toHaveBeenCalledWith(2028, 11);
  });

  it("rejects missing, malformed, unknown, and foreign sessions without revealing ownership", async () => {
    const dependencies = {
      getStudentById: vi.fn().mockResolvedValue({ id: 101, schoolId: 11 }),
      getAcademicSessionForSchool: vi.fn().mockResolvedValue(undefined),
    };

    const missing = await resolveStudentExaminationSession(101, undefined, dependencies);
    const malformed = await resolveStudentExaminationSession(101, "2028", dependencies);
    const foreign = await resolveStudentExaminationSession(101, 9090, dependencies);

    expect(missing).toEqual({ ok: false, status: 403, message: "Invalid academic session" });
    expect(malformed).toEqual(missing);
    expect(foreign).toEqual(missing);
    expect(dependencies.getAcademicSessionForSchool).toHaveBeenCalledWith(9090, 11);
  });

  it("always uses the authenticated student's school as the tenant boundary", async () => {
    const getAcademicSessionForSchool = vi.fn().mockResolvedValue({ id: 303, schoolId: 11 });

    await resolveStudentExaminationSession(101, 303, {
      getStudentById: vi.fn().mockResolvedValue({ id: 101, schoolId: 11 }),
      getAcademicSessionForSchool,
    });

    expect(getAcademicSessionForSchool).toHaveBeenCalledWith(303, 11);
    expect(getAcademicSessionForSchool).not.toHaveBeenCalledWith(303, 99);
  });
});