import {
  resolveStudentAcademicSession,
  type SchoolAcademicSession,
  type StudentAcademicSessionDependencies,
  type StudentSessionIdentity,
} from "./student-academic-session";

export type StudentExaminationSessionDependencies<
  TStudent extends StudentSessionIdentity,
  TSession extends SchoolAcademicSession,
> = Pick<
  StudentAcademicSessionDependencies<TStudent, TSession, never>,
  "getStudentById" | "getAcademicSessionForSchool"
>;

export type StudentExaminationSessionResolution<TStudent extends StudentSessionIdentity, TSession extends SchoolAcademicSession> =
  | { ok: true; student: TStudent; schoolId: number; sessionId: number }
  | { ok: false; status: 401 | 403; message: string };

/**
 * Resolves a required Student Examination session inside the authenticated
 * student's school boundary without revealing whether a foreign session exists.
 */
export async function resolveStudentExaminationSession<
  TStudent extends StudentSessionIdentity,
  TSession extends SchoolAcademicSession,
>(
  studentId: number | undefined,
  requestedSessionId: unknown,
  dependencies: StudentExaminationSessionDependencies<TStudent, TSession>,
): Promise<StudentExaminationSessionResolution<TStudent, TSession>> {
  const result = await resolveStudentAcademicSession(
    studentId,
    requestedSessionId,
    "SELECTED_SESSION_REQUIRED",
    dependencies,
  );
  if (!result.ok) {
    return {
      ok: false,
      status: result.status === 401 ? 401 : 403,
      message: result.status === 401 ? result.message : "Invalid academic session",
    };
  }
  return { ok: true, student: result.student, schoolId: result.schoolId, sessionId: result.sessionId! };
}