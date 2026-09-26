import { complaints } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/** Student-only case boundary. Null legacy sessions cannot match a selected year. */
export function studentComplaintSessionScope(schoolId: number, sessionId: number) {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new Error("Student Complaints require a valid academic session");
  }
  return and(eq(complaints.schoolId, schoolId), eq(complaints.sessionId, sessionId))!;
}

export function studentComplaintMatchesSession(
  complaint: { schoolId: number; sessionId: number | null; isDeleted: boolean },
  schoolId: number,
  sessionId: number,
) {
  return complaint.schoolId === schoolId && complaint.sessionId === sessionId && !complaint.isDeleted;
}

export function validStudentPeerTarget(
  reporter: { id: number; schoolId: number },
  peer: { id: number; schoolId: number } | null | undefined,
) {
  return !!peer && peer.schoolId === reporter.schoolId && peer.id !== reporter.id;
}