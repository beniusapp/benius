export const studentLeaveQueryKey = (sessionId: number | null, studentId: number | null) =>
  ["/api/student/leave", sessionId, studentId] as const;