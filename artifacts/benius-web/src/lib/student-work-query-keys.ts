export const homeworkQueryKey = (sessionId: number | null, date: string) =>
  ["/api/student/homework", sessionId, date] as const;

export const homeworkPendingDatesQueryKey = (sessionId: number | null, month: string) =>
  ["/api/student/homework/pending-dates", sessionId, month] as const;

export const classworkQueryKey = (sessionId: number | null, date: string) =>
  ["/api/student/classwork", sessionId, date] as const;