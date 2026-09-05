import { describe, expect, it, vi } from "vitest";
import { resolveTeacherExaminationSession } from "../teacher-examination-session";

describe("Teacher Examination session authority", () => {
  it("allows a teacher session only when resolved inside the teacher school", async () => {
    const getTeacherById = vi.fn().mockResolvedValue({ id: 9, schoolId: 11 });
    const getAcademicSessionForSchool = vi.fn().mockResolvedValue({ id: 101, schoolId: 11 });

    const result = await resolveTeacherExaminationSession(9, 101, { getTeacherById, getAcademicSessionForSchool });

    expect(result).toMatchObject({ ok: true, schoolId: 11, sessionId: 101 });
    expect(getAcademicSessionForSchool).toHaveBeenCalledWith(101, 11);
  });

  it("rejects missing and foreign/unknown sessions with the same non-enumerating response", async () => {
    const dependencies = {
      getTeacherById: vi.fn().mockResolvedValue({ id: 9, schoolId: 11 }),
      getAcademicSessionForSchool: vi.fn().mockResolvedValue(undefined),
    };

    const missing = await resolveTeacherExaminationSession(9, undefined, dependencies);
    const foreign = await resolveTeacherExaminationSession(9, 202, dependencies);

    expect(missing).toEqual({ ok: false, status: 403, message: "Invalid academic session" });
    expect(foreign).toEqual(missing);
    expect(dependencies.getAcademicSessionForSchool).toHaveBeenCalledWith(202, 11);
  });

  it("always uses authenticated teacher school rather than a client-supplied school", async () => {
    const getAcademicSessionForSchool = vi.fn().mockResolvedValue({ id: 303, schoolId: 11 });

    await resolveTeacherExaminationSession(9, 303, {
      getTeacherById: vi.fn().mockResolvedValue({ id: 9, schoolId: 11 }),
      getAcademicSessionForSchool,
    });

    expect(getAcademicSessionForSchool).toHaveBeenCalledWith(303, 11);
    expect(getAcademicSessionForSchool).not.toHaveBeenCalledWith(303, 99);
  });
});