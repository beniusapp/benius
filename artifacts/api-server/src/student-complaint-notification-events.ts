import { and, eq, inArray, isNull } from "drizzle-orm";
import { studentComplaintNotificationEvents } from "@workspace/db";
import { db } from "./db";
import { notificationEventMatchesScope } from "./student-complaint-notification-policy";

export type StudentComplaintNotificationScope = {
  schoolId: number;
  studentId: number;
  sessionId: number;
};

export async function getUnreadReplyComplaintIds(
  scope: StudentComplaintNotificationScope,
  complaintIds: readonly number[],
): Promise<Set<number>> {
  if (complaintIds.length === 0) return new Set();
  const rows = await db.select({
    complaintId: studentComplaintNotificationEvents.complaintId,
    schoolId: studentComplaintNotificationEvents.schoolId,
    studentId: studentComplaintNotificationEvents.studentId,
    sessionId: studentComplaintNotificationEvents.sessionId,
  }).from(studentComplaintNotificationEvents).where(and(
    eq(studentComplaintNotificationEvents.schoolId, scope.schoolId),
    eq(studentComplaintNotificationEvents.studentId, scope.studentId),
    eq(studentComplaintNotificationEvents.sessionId, scope.sessionId),
    inArray(studentComplaintNotificationEvents.complaintId, [...complaintIds]),
    isNull(studentComplaintNotificationEvents.readAt),
  ));
  return new Set(rows
    .filter(row => notificationEventMatchesScope(row, scope))
    .map(row => row.complaintId));
}

export async function getReplyEventIdsForNotes(
  scope: StudentComplaintNotificationScope,
  complaintId: number,
  noteIds: readonly number[],
): Promise<Map<number, number[]>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db.select({
    id: studentComplaintNotificationEvents.id,
    noteId: studentComplaintNotificationEvents.noteId,
    schoolId: studentComplaintNotificationEvents.schoolId,
    studentId: studentComplaintNotificationEvents.studentId,
    sessionId: studentComplaintNotificationEvents.sessionId,
  }).from(studentComplaintNotificationEvents).where(and(
    eq(studentComplaintNotificationEvents.schoolId, scope.schoolId),
    eq(studentComplaintNotificationEvents.studentId, scope.studentId),
    eq(studentComplaintNotificationEvents.sessionId, scope.sessionId),
    eq(studentComplaintNotificationEvents.complaintId, complaintId),
    inArray(studentComplaintNotificationEvents.noteId, [...noteIds]),
    isNull(studentComplaintNotificationEvents.readAt),
  ));
  const result = new Map<number, number[]>();
  for (const row of rows) {
    if (row.noteId === null || !notificationEventMatchesScope(row, scope)) continue;
    result.set(row.noteId, [...(result.get(row.noteId) ?? []), row.id]);
  }
  return result;
}

export async function markDisplayedReplyEventsRead(
  scope: StudentComplaintNotificationScope,
  complaintId: number,
  eventIds: readonly number[],
): Promise<void> {
  const ids = [...new Set(eventIds.filter(id => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return;
  await db.update(studentComplaintNotificationEvents)
    .set({ readAt: new Date() })
    .where(and(
      eq(studentComplaintNotificationEvents.schoolId, scope.schoolId),
      eq(studentComplaintNotificationEvents.studentId, scope.studentId),
      eq(studentComplaintNotificationEvents.sessionId, scope.sessionId),
      eq(studentComplaintNotificationEvents.complaintId, complaintId),
      inArray(studentComplaintNotificationEvents.id, ids),
      isNull(studentComplaintNotificationEvents.readAt),
    ));
}
