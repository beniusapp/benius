export interface StudentExaminationSessionDependencies<TStudent, TSession> {
  getStudentById: (studentId: number) => Promise<TStudent | undefined>;
  getAcademicSessionForSchool: (sessionId: number, schoolId: number) => Promise<TSession | undefined>;
}

type StudentWithSchool = { schoolId: number };
type SessionWithId = { id: number };

export type StudentExaminationSessionResolution<TStudent extends StudentWithSchool, TSession extends SessionWithId> =
  | { ok: true; student: TStudent; schoolId: number; sessionId: number }
  | { ok: false; status: 401 | 403; message: string };

/**
 * Resolves a required Student Examination session inside the authenticated
 * student's school boundary without revealing whether a foreign session exists.
 */
export async function resolveStudentExaminationSession<
  TStudent extends StudentWithSchool,
  TSession extends SessionWithId,
>(
  studentId: number | undefined,
  requestedSessionId: unknown,
  dependencies: StudentExaminationSessionDependencies<TStudent, TSession>,
): Promise<StudentExaminationSessionResolution<TStudent, TSession>> {
  if (!studentId) return { ok: false, status: 401, message: "Not authenticated" };
  const student = await dependencies.getStudentById(studentId);
  if (!student) return { ok: false, status: 401, message: "Student not found" };
  if (!Number.isInteger(requestedSessionId)) {
    return { ok: false, status: 403, message: "Invalid academic session" };
  }
  const academicSession = await dependencies.getAcademicSessionForSchool(
    requestedSessionId as number,
    student.schoolId,
  );
  if (!academicSession) return { ok: false, status: 403, message: "Invalid academic session" };
  return { ok: true, student, schoolId: student.schoolId, sessionId: academicSession.id };
}