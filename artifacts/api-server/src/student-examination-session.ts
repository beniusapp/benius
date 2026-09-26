import {
  resolveStudentAcademicSession,
  type SchoolAcademicSession,
  type StudentAcademicSessionDependencies,
  type StudentSessionEnrollment,
  type StudentSessionIdentity,
} from "./student-academic-session";

export type StudentExaminationSessionDependencies<
  TStudent extends StudentSessionIdentity,
  TSession extends SchoolAcademicSession,
  TEnrollment extends StudentSessionEnrollment,
> = StudentAcademicSessionDependencies<TStudent, TSession, TEnrollment>;

/**
 * Resolves a required Student Examination session inside the authenticated
 * student's school boundary without revealing whether a foreign session exists.
 */
export async function resolveStudentExaminationSession<
  TStudent extends StudentSessionIdentity,
  TSession extends SchoolAcademicSession,
  TEnrollment extends StudentSessionEnrollment,
>(
  studentId: number | undefined,
  rawSessionHeader: unknown,
  dependencies: StudentExaminationSessionDependencies<TStudent, TSession, TEnrollment>,
) {
  const result = await resolveStudentAcademicSession(
    studentId,
    rawSessionHeader,
    "SELECTED_SESSION_ENROLLMENT_REQUIRED",
    dependencies,
  );
  if (!result.ok) return result;
  // The Step 1 enrollment-required mode guarantees these values.
  if (!result.enrollment || result.sessionId === null) {
    return {
      ok: false as const, status: 403 as const,
      message: "Student is not enrolled in this academic session",
      code: "STUDENT_ENROLLMENT_REQUIRED" as const,
    };
  }
  return {
    ok: true as const, student: result.student, schoolId: result.schoolId,
    sessionId: result.sessionId, enrollment: result.enrollment,
  };
}