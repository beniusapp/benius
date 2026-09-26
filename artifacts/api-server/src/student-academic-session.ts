/**
 * Student-only academic-session boundary. Callers must pass the authenticated
 * server-side student ID and the raw x-view-session-id header, never a
 * client-supplied student or school ID. GLOBAL reads deliberately skip sessions.
 */
export type StudentAcademicSessionMode =
  | "GLOBAL"
  | "SELECTED_SESSION_REQUIRED"
  | "SELECTED_OR_ACTIVE_SESSION"
  | "SELECTED_SESSION_ENROLLMENT_REQUIRED"
  | "CURRENT_SESSION_WRITE";

export type StudentSessionIdentity = { id: number; schoolId: number };
export type SchoolAcademicSession = { id: number; schoolId: number; isActive: boolean };
export type StudentSessionEnrollment = {
  schoolId: number;
  studentId: number;
  sessionId: number;
  className: string;
  sectionName: string;
  rollNo: number | null;
  status: string;
};

export interface StudentAcademicSessionDependencies<
  TStudent extends StudentSessionIdentity,
  TSession extends SchoolAcademicSession,
  TEnrollment extends StudentSessionEnrollment,
> {
  getStudentById(studentId: number): Promise<TStudent | undefined>;
  getAcademicSessionForSchool(sessionId: number, schoolId: number): Promise<TSession | undefined>;
  getActiveSession?(schoolId: number): Promise<TSession | undefined>;
  resolveEnrollmentForStudentSession?(
    schoolId: number,
    studentId: number,
    sessionId: number,
  ): Promise<TEnrollment | undefined>;
}

export type StudentAcademicSessionResolution<
  TStudent extends StudentSessionIdentity,
  TSession extends SchoolAcademicSession,
  TEnrollment extends StudentSessionEnrollment,
> =
  | {
      ok: true;
      student: TStudent;
      schoolId: number;
      session: TSession | null;
      sessionId: number | null;
      enrollment: TEnrollment | null;
    }
  | {
      ok: false;
      status: 400 | 401 | 403 | 409;
      code:
        | "STUDENT_AUTH_REQUIRED"
        | "STUDENT_SESSION_REQUIRED"
        | "STUDENT_SESSION_INVALID"
        | "STUDENT_SESSION_FORBIDDEN"
        | "STUDENT_ACTIVE_SESSION_UNAVAILABLE"
        | "STUDENT_ENROLLMENT_REQUIRED"
        | "STUDENT_SESSION_READ_ONLY";
      message: string;
    };

function parseSelectedSessionId(
  raw: unknown,
): { kind: "missing" } | { kind: "invalid" } | { kind: "selected"; id: number } {
  if (raw == null) return { kind: "missing" };
  if (typeof raw !== "number" && (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw))) {
    return { kind: "invalid" };
  }
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0
    ? { kind: "selected", id }
    : { kind: "invalid" };
}

export async function resolveStudentAcademicSession<
  TStudent extends StudentSessionIdentity,
  TSession extends SchoolAcademicSession,
  TEnrollment extends StudentSessionEnrollment = StudentSessionEnrollment,
>(
  authenticatedStudentId: number | undefined,
  rawSelectedSessionId: unknown,
  mode: StudentAcademicSessionMode,
  dependencies: StudentAcademicSessionDependencies<TStudent, TSession, TEnrollment>,
): Promise<StudentAcademicSessionResolution<TStudent, TSession, TEnrollment>> {
  if (!Number.isSafeInteger(authenticatedStudentId) || (authenticatedStudentId ?? 0) <= 0) {
    return { ok: false, status: 401, code: "STUDENT_AUTH_REQUIRED", message: "Not authenticated" };
  }
  const student = await dependencies.getStudentById(authenticatedStudentId!);
  if (!student || student.id !== authenticatedStudentId || !Number.isSafeInteger(student.schoolId) || student.schoolId <= 0) {
    return { ok: false, status: 401, code: "STUDENT_AUTH_REQUIRED", message: "Student not found" };
  }
  const schoolId = student.schoolId;

  if (mode === "GLOBAL") {
    return { ok: true, student, schoolId, session: null, sessionId: null, enrollment: null };
  }

  const selected = parseSelectedSessionId(rawSelectedSessionId);
  if (selected.kind === "invalid") {
    return { ok: false, status: 400, code: "STUDENT_SESSION_INVALID", message: "Invalid academic session" };
  }
  if (selected.kind === "missing" && mode !== "SELECTED_OR_ACTIVE_SESSION") {
    return { ok: false, status: 400, code: "STUDENT_SESSION_REQUIRED", message: "Academic session is required" };
  }

  // Active fallback is an explicit product choice, never an unscoped query.
  const active = selected.kind === "missing" ? await dependencies.getActiveSession?.(schoolId) : undefined;
  if (selected.kind === "missing" && (!active || active.schoolId !== schoolId || !active.isActive)) {
    return {
      ok: false, status: 409, code: "STUDENT_ACTIVE_SESSION_UNAVAILABLE",
      message: "No active academic session is available",
    };
  }
  const id = selected.kind === "selected" ? selected.id : active!.id;
  const session = await dependencies.getAcademicSessionForSchool(id, schoolId);
  if (!session || session.id !== id || session.schoolId !== schoolId) {
    // Nonexistent and foreign-school IDs share the same response.
    return { ok: false, status: 403, code: "STUDENT_SESSION_FORBIDDEN", message: "Invalid academic session" };
  }
  if (mode === "CURRENT_SESSION_WRITE" && !session.isActive) {
    return {
      ok: false, status: 403, code: "STUDENT_SESSION_READ_ONLY",
      message: "Historical academic sessions are read-only",
    };
  }

  let enrollment: TEnrollment | null = null;
  if (mode === "SELECTED_SESSION_ENROLLMENT_REQUIRED") {
    const found = await dependencies.resolveEnrollmentForStudentSession?.(schoolId, student.id, session.id);
    // Check the returned compound key even if a future storage implementation changes.
    if (!found || found.schoolId !== schoolId || found.studentId !== student.id || found.sessionId !== session.id) {
      return {
        ok: false, status: 403, code: "STUDENT_ENROLLMENT_REQUIRED",
        message: "Student is not enrolled in this academic session",
      };
    }
    enrollment = found;
  }

  return { ok: true, student, schoolId, session, sessionId: session.id, enrollment };
}