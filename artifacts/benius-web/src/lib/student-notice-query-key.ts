export const studentNoticeQueryKey = (sessionId: number | null) =>
  ["/api/student/notices", sessionId] as const;