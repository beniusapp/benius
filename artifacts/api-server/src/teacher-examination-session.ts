import {
  resolveTeacherAcademicSession,
  type TeacherAcademicSessionMode,
  type TeacherAcademicSessionDependencies,
  type TeacherAcademicSessionRequest,
} from "./teacher-academic-session";
import type { Teacher } from "@workspace/db";

export type TeacherExaminationSessionResolution =
  | { ok: true; teacher: Teacher; schoolId: number; sessionId: number }
  | {
      ok: false;
      status: 400 | 401 | 403 | 409 | 503;
      code: string;
      message: string;
    };

/**
 * Examination requires an explicit selected session. Identity and tenant
 * ownership are resolved by the shared Teacher foundation.
 */
export async function resolveTeacherExaminationSession(
  request: TeacherAcademicSessionRequest,
  dependencies: TeacherAcademicSessionDependencies,
  mode: TeacherAcademicSessionMode = "SELECTED_SESSION_REQUIRED",
): Promise<TeacherExaminationSessionResolution> {
  const resolution = await resolveTeacherAcademicSession(
    request,
    mode,
    dependencies,
  );
  if (!resolution.ok) return resolution;
  if (!resolution.session) {
    return {
      ok: false,
      status: 503,
      code: "TEACHER_SESSION_VERIFY_FAILED",
      message: "Unable to verify the academic session.",
    };
  }
  return {
    ok: true,
    teacher: resolution.teacher,
    schoolId: resolution.schoolId,
    sessionId: resolution.session.id,
  };
}