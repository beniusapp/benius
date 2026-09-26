import {
  resolveStudentAcademicSession,
  type SchoolAcademicSession,
  type StudentAcademicSessionDependencies,
  type StudentSessionEnrollment,
  type StudentSessionIdentity,
} from "./student-academic-session";

export type StudentWorkContext<
  TStudent extends StudentSessionIdentity = StudentSessionIdentity,
  TEnrollment extends StudentSessionEnrollment = StudentSessionEnrollment,
> = {
  ok: true;
  student: TStudent;
  schoolId: number;
  sessionId: number;
  enrollment: TEnrollment;
};

/**
 * Both Student Homework and Classwork use the same selected-session placement.
 * Writes additionally require the active session, matching the existing
 * archive-mode Homework UI and native submission rule.
 */
export async function resolveStudentWorkSession<
  TStudent extends StudentSessionIdentity,
  TSession extends SchoolAcademicSession,
  TEnrollment extends StudentSessionEnrollment,
>(
  authenticatedStudentId: number | undefined,
  rawSessionHeader: unknown,
  dependencies: StudentAcademicSessionDependencies<TStudent, TSession, TEnrollment>,
  forWrite = false,
) {
  const result = await resolveStudentAcademicSession(
    authenticatedStudentId,
    rawSessionHeader,
    "SELECTED_SESSION_ENROLLMENT_REQUIRED",
    dependencies,
  );
  if (!result.ok) return result;
  if (!result.session || result.sessionId === null || !result.enrollment) {
    return {
      ok: false as const, status: 403 as const,
      message: "Student is not enrolled in this academic session",
      code: "STUDENT_ENROLLMENT_REQUIRED" as const,
    };
  }
  if (forWrite && !result.session.isActive) {
    return {
      ok: false as const, status: 403 as const,
      message: "Homework submissions are not allowed for an archived academic session",
      code: "STUDENT_SESSION_READ_ONLY" as const,
    };
  }
  return {
    ok: true as const,
    student: result.student,
    schoolId: result.schoolId,
    sessionId: result.sessionId,
    enrollment: result.enrollment,
  };
}

export function homeworkBelongsToStudentWorkSession(
  homework: { schoolId: number; sessionId: number | null; class: string; section: string },
  context: StudentWorkContext,
): boolean {
  return homework.schoolId === context.schoolId
    && homework.sessionId === context.sessionId
    && homework.class === context.enrollment.className
    && homework.section === context.enrollment.sectionName;
}