import { storage } from "./storage";

export class AttendanceReadSessionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "ATTENDANCE_SESSION_REQUIRED") {
    super(message);
    this.name = "AttendanceReadSessionError";
    this.status = status;
    this.code = code;
  }
}

export async function resolveAttendanceReadSession(
  schoolId: number,
  requestedSessionId: number | null | undefined,
  options: { allowActiveFallback?: boolean } = {},
) {
  let sessionId = requestedSessionId;

  if (!Number.isInteger(sessionId) || (sessionId as number) <= 0) {
    if (!options.allowActiveFallback) {
      throw new AttendanceReadSessionError(
        "A valid academic session is required to read Attendance.",
      );
    }

    const activeSession = await storage.getActiveSession(schoolId);
    if (!activeSession) {
      throw new AttendanceReadSessionError(
        "No active academic session is available for Attendance.",
        409,
        "ATTENDANCE_SESSION_UNAVAILABLE",
      );
    }
    sessionId = activeSession.id;
  }

  const session = await storage.getAcademicSessionById(sessionId as number);
  if (!session || session.schoolId !== schoolId) {
    throw new AttendanceReadSessionError(
      "The selected academic session is not valid for this school.",
      403,
      "ATTENDANCE_SESSION_FORBIDDEN",
    );
  }

  return session;
}

export function sendAttendanceReadSessionError(
  res: import("express").Response,
  error: unknown,
) {
  if (!(error instanceof AttendanceReadSessionError)) return false;
  res.status(error.status).json({ message: error.message, code: error.code });
  return true;
}