export type ComplaintNotificationScope = {
  schoolId: number;
  studentId: number;
  sessionId: number;
};

export function notificationEventMatchesScope(
  event: ComplaintNotificationScope,
  scope: ComplaintNotificationScope,
): boolean {
  return event.schoolId === scope.schoolId
    && event.studentId === scope.studentId
    && event.sessionId === scope.sessionId;
}

export function isQualifyingTeacherReply(input: {
  enabled: boolean;
  complaintType: string;
  authorRole: string;
  schoolId: number | null;
  sessionId: number | null;
}): boolean {
  return input.enabled
    && input.complaintType === "teacher-to-student"
    && ["teacher", "admin"].includes(input.authorRole.toLowerCase())
    && Number.isSafeInteger(input.schoolId)
    && Number.isSafeInteger(input.sessionId);
}

export function countUnreadComplaintIds(
  inboxIds: readonly number[],
  readIds: ReadonlySet<number>,
  unreadReplyIds: ReadonlySet<number>,
): number {
  return new Set(inboxIds.filter(id => !readIds.has(id) || unreadReplyIds.has(id))).size;
}

export function safeDisplayedEventIds(ids: readonly unknown[]): number[] {
  return [...new Set(ids.filter((id): id is number =>
    typeof id === "number" && Number.isSafeInteger(id) && id > 0))];
}
