import type { AcademicSession, Teacher } from "@workspace/db";

export type TeacherAcademicSessionMode =
  | "GLOBAL"
  | "SELECTED_SESSION_REQUIRED"
  | "SELECTED_OR_ACTIVE_SESSION"
  | "CURRENT_SESSION_WRITE";

type TeacherAccount = {
  teacher: Teacher;
  school: { id: number };
  user: { id: number; role: string; schoolId: number; isActive?: boolean };
};

type MobileTeacherPrincipal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
};

export type TeacherAcademicSessionRequest = {
  headers?: Record<string, string | string[] | undefined>;
  session?: {
    teacherId?: number;
    userId?: number;
    schoolId?: number;
    userRole?: string;
  };
  mobileAuth?: { principal?: MobileTeacherPrincipal };
};

export type TeacherAcademicSessionDependencies = {
  getTeacherWithSchool: (teacherId: number) => Promise<TeacherAccount | undefined>;
  getAcademicSessionForSchool: (sessionId: number, schoolId: number) => Promise<AcademicSession | undefined>;
  getActiveSession: (schoolId: number) => Promise<AcademicSession | undefined>;
};

type Failure = {
  ok: false;
  status: 400 | 401 | 403 | 409 | 503;
  code: string;
  message: string;
};

export type TeacherAcademicSessionResolution =
  | {
      ok: true;
      mode: TeacherAcademicSessionMode;
      teacher: Teacher;
      schoolId: number;
      session: AcademicSession | null;
      sessionId: number | null;
    }
  | Failure;

type AuthenticatedTeacherIdentity = {
  teacherId: number;
  userId: number;
  schoolId: number;
};

function failure(
  status: Failure["status"],
  code: string,
  message: string,
): Failure {
  return { ok: false, status, code, message };
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function authenticatedTeacherIdentity(
  request: TeacherAcademicSessionRequest,
): AuthenticatedTeacherIdentity | Failure {
  if (request.mobileAuth !== undefined) {
    const principal = request.mobileAuth.principal;
    if (!principal || principal.role !== "teacher"
      || !isPositiveSafeInteger(principal.id)
      || principal.entityId !== principal.id
      || !isPositiveSafeInteger(principal.principalId)
      || !isPositiveSafeInteger(principal.schoolId)) {
      return failure(401, "TEACHER_NOT_AUTHENTICATED", "Not authenticated as a teacher.");
    }
    return {
      teacherId: principal.id,
      userId: principal.principalId,
      schoolId: principal.schoolId,
    };
  }

  const session = request.session;
  if (!session || !isPositiveSafeInteger(session.teacherId)
    || !isPositiveSafeInteger(session.userId)
    || !isPositiveSafeInteger(session.schoolId)
    || session.userRole !== "teacher") {
    return failure(401, "TEACHER_NOT_AUTHENTICATED", "Not authenticated as a teacher.");
  }
  return {
    teacherId: session.teacherId,
    userId: session.userId,
    schoolId: session.schoolId,
  };
}

function selectedSessionId(
  request: TeacherAcademicSessionRequest,
): { kind: "missing" } | { kind: "invalid" } | { kind: "valid"; id: number } {
  const raw = request.headers?.["x-view-session-id"];
  if (raw === undefined) return { kind: "missing" };
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return { kind: "invalid" };
  const id = Number(raw);
  return Number.isSafeInteger(id) ? { kind: "valid", id } : { kind: "invalid" };
}

function validTeacherAccount(
  account: TeacherAccount | undefined,
  identity: AuthenticatedTeacherIdentity,
): account is TeacherAccount {
  if (!account) return false;
  const { teacher, school, user } = account;
  return teacher.id === identity.teacherId
    && isPositiveSafeInteger(teacher.schoolId)
    && school.id === teacher.schoolId
    && teacher.userId === user.id
    && user.role === "teacher"
    && user.schoolId === teacher.schoolId
    && user.id === identity.userId
    && identity.schoolId === teacher.schoolId
    && teacher.isActive !== false
    && user.isActive !== false;
}

function successful(
  mode: TeacherAcademicSessionMode,
  teacher: Teacher,
  schoolId: number,
  session: AcademicSession | null,
): TeacherAcademicSessionResolution {
  return {
    ok: true,
    mode,
    teacher,
    schoolId,
    session,
    sessionId: session?.id ?? null,
  };
}

/**
 * Resolves Teacher identity from the authenticated Web session or Mobile
 * bearer principal, reloads the Teacher and school from storage, then applies
 * the requested session policy within that server-derived school boundary.
 */
export async function resolveTeacherAcademicSession(
  request: TeacherAcademicSessionRequest,
  mode: TeacherAcademicSessionMode,
  dependencies: TeacherAcademicSessionDependencies,
): Promise<TeacherAcademicSessionResolution> {
  const identity = authenticatedTeacherIdentity(request);
  if ("ok" in identity) return identity;

  let account: TeacherAccount | undefined;
  try {
    account = await dependencies.getTeacherWithSchool(identity.teacherId);
  } catch {
    return failure(503, "TEACHER_AUTHORIZATION_UNAVAILABLE", "Unable to verify the teacher account.");
  }
  if (!validTeacherAccount(account, identity)) {
    return failure(401, "TEACHER_NOT_AUTHENTICATED", "Teacher account is no longer authorized.");
  }

  const schoolId = account.teacher.schoolId;
  if (mode === "GLOBAL") return successful(mode, account.teacher, schoolId, null);

  const selection = selectedSessionId(request);
  if (selection.kind === "invalid") {
    return failure(400, "TEACHER_SESSION_INVALID", "Invalid selected academic session.");
  }
  if (selection.kind === "missing" && mode !== "SELECTED_OR_ACTIVE_SESSION") {
    return failure(400, "TEACHER_SESSION_REQUIRED", "A selected academic session is required.");
  }

  let selected: AcademicSession | undefined;
  try {
    if (selection.kind === "valid") {
      selected = await dependencies.getAcademicSessionForSchool(selection.id, schoolId);
    } else {
      selected = await dependencies.getActiveSession(schoolId);
    }
  } catch {
    return failure(503, "TEACHER_SESSION_VERIFY_FAILED", "Unable to verify the academic session.");
  }

  if (!selected && selection.kind === "missing") {
    return failure(
      409,
      "TEACHER_ACTIVE_SESSION_UNAVAILABLE",
      "No active academic session is available.",
    );
  }
  if (!selected
    || (selection.kind === "valid" && selected.id !== selection.id)
    || selected.schoolId !== schoolId) {
    return failure(403, "TEACHER_SESSION_FORBIDDEN", "The selected academic session is not available.");
  }
  if (selection.kind === "missing" && selected.isActive !== true) {
    return failure(503, "TEACHER_SESSION_VERIFY_FAILED", "Unable to verify the active academic session.");
  }
  if (mode === "CURRENT_SESSION_WRITE" && selected.isActive !== true) {
    return failure(403, "TEACHER_SESSION_READ_ONLY", "Archived academic sessions are read-only.");
  }

  return successful(mode, account.teacher, schoolId, selected);
}