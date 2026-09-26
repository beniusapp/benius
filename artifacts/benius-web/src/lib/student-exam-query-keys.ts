export const studentExamPolicyQueryKey = (sessionId: number | null, cls: string) =>
  ["/api/student/exam/policy", sessionId, cls] as const;

export const studentExamScoresQueryKey = (sessionId: number | null, cls: string) =>
  ["/api/student/exam/all-scores", sessionId, cls] as const;

export const studentArchiveJourneyQueryKey = (sessionId: number | null) =>
  ["/api/student/archive/journey", sessionId] as const;

export const studentArchiveTypesQueryKey = (sessionId: number | null) =>
  ["/api/student/archive/exam-types", sessionId] as const;

export const studentArchiveScoresQueryKey = (sessionId: number | null, examType: string) =>
  ["/api/student/archive/scores", sessionId, examType] as const;