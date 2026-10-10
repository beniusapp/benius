export const studentComplaintInboxQueryKey = (sessionId: number | null) =>
  ["/api/student/complaints/inbox", sessionId] as const;

export const studentComplaintFiledQueryKey = (sessionId: number | null) =>
  ["/api/student/complaints/filed", sessionId] as const;

export const studentComplaintNotesQueryKey = (complaintId: number, sessionId: number | null) =>
  ["/api/student/complaints", complaintId, "notes", sessionId] as const;

export const studentComplaintReplyUnreadCountQueryKey = (sessionId: number | null, studentId: number | null) =>
  ["/api/student/complaints/reply-notifications/unread-count", sessionId, studentId] as const;