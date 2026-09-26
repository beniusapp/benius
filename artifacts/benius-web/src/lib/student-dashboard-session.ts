export function studentDashboardGlobalQueryKey(resource: string) {
  return [resource] as const;
}

export function studentDashboardSessionQueryKey(resource: string, sessionId: number | null) {
  return [resource, sessionId] as const;
}

export function studentDashboardSessionIdFromQueryKey(queryKey: readonly unknown[]): number {
  const sessionId = queryKey[1];
  if (!Number.isSafeInteger(sessionId) || typeof sessionId !== "number" || sessionId <= 0) {
    throw new Error("A selected academic session is required for this dashboard request");
  }
  return sessionId;
}

export function canFetchStudentDashboardSessionData(
  hasStudent: boolean,
  isSessionsLoading: boolean,
  sessionId: number | null,
): boolean {
  return hasStudent
    && !isSessionsLoading
    && Number.isSafeInteger(sessionId)
    && (sessionId ?? 0) > 0;
}