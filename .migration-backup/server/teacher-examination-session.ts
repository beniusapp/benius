export interface TeacherExaminationSessionDependencies<TTeacher, TSession> {
  getTeacherById: (teacherId: number) => Promise<TTeacher | undefined>;
  getAcademicSessionForSchool: (sessionId: number, schoolId: number) => Promise<TSession | undefined>;
}

type TeacherWithSchool = { schoolId: number };
type SessionWithId = { id: number };

export type TeacherExaminationSessionResolution<TTeacher extends TeacherWithSchool, TSession extends SessionWithId> =
  | { ok: true; teacher: TTeacher; schoolId: number; sessionId: number }
  | { ok: false; status: 401 | 403; message: string };

/**
 * Resolves the required Teacher Examination session inside the authenticated
 * teacher's school boundary. Missing, unknown, and foreign session IDs share
 * one response so callers cannot enumerate another school's sessions.
 */
export async function resolveTeacherExaminationSession<TTeacher extends TeacherWithSchool, TSession extends SessionWithId>(
  teacherId: number | undefined,
  requestedSessionId: unknown,
  dependencies: TeacherExaminationSessionDependencies<TTeacher, TSession>,
): Promise<TeacherExaminationSessionResolution<TTeacher, TSession>> {
  if (!teacherId) return { ok: false, status: 401, message: "Not authenticated" };
  const teacher = await dependencies.getTeacherById(teacherId);
  if (!teacher) return { ok: false, status: 401, message: "Teacher not found" };
  if (!Number.isInteger(requestedSessionId)) {
    return { ok: false, status: 403, message: "Invalid academic session" };
  }
  const academicSession = await dependencies.getAcademicSessionForSchool(requestedSessionId as number, teacher.schoolId);
  if (!academicSession) return { ok: false, status: 403, message: "Invalid academic session" };
  return { ok: true, teacher, schoolId: teacher.schoolId, sessionId: academicSession.id };
}