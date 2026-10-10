export type TeacherInboxReadState = {
  id: number;
  status: string;
  isRead?: boolean;
};

export function teacherComplaintBadgeCount(
  complaints: readonly TeacherInboxReadState[],
  readTrackingEnabled: boolean,
): number {
  return readTrackingEnabled
    ? complaints.filter(complaint => complaint.isRead !== true).length
    : complaints.length;
}

export function studentComplaintDashboardDot(
  replyAwareEnabled: boolean,
  unreadCount: number | null | undefined,
  legacyModuleDot: boolean,
): boolean {
  return replyAwareEnabled && typeof unreadCount === "number" && Number.isSafeInteger(unreadCount)
    ? (unreadCount ?? 0) > 0
    : legacyModuleDot;
}

export function studentModuleTilePulse(
  tileId: string,
  legacyModuleDot: boolean,
  replyAwareEnabled: boolean,
  replyUnreadCount: number | null | undefined,
): boolean {
  return tileId === "complaints"
    ? studentComplaintDashboardDot(replyAwareEnabled, replyUnreadCount, legacyModuleDot)
    : legacyModuleDot;
}
