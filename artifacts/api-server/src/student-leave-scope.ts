import { studentLeaveRequests } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export function requireStudentLeaveSession(sessionId: number | null | undefined): asserts sessionId is number {
  if (!Number.isSafeInteger(sessionId) || (sessionId ?? 0) <= 0) {
    throw new Error("Student Leave requires a valid academic session");
  }
}

/** Student leave reads and writes are always bound to the Student's school and selected session. */
export function studentLeaveSessionScope(studentId: number, schoolId: number, sessionId: number) {
  requireStudentLeaveSession(sessionId);
  return and(
    eq(studentLeaveRequests.studentId, studentId),
    eq(studentLeaveRequests.schoolId, schoolId),
    eq(studentLeaveRequests.sessionId, sessionId),
  )!;
}