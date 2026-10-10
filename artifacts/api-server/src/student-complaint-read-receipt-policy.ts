export type StudentComplaintReceiptScope = {
  schoolId: number;
  studentId: number;
  sessionId: number;
};

export function complaintReadTrackingEnabled(config: {
  nodeEnv?: string;
  enabled?: string;
  migrationApplied?: string;
}): boolean {
  return config.nodeEnv === "development"
    && config.enabled === "true"
    && config.migrationApplied === "true";
}

export async function queryReceiptsWhenEnabled<T>(
  enabled: boolean,
  query: () => Promise<T>,
): Promise<T | undefined> {
  return enabled ? query() : undefined;
}

export function inboxContainsComplaint(
  inbox: readonly { id: number }[],
  complaintId: number,
): boolean {
  return inbox.some(item => item.id === complaintId);
}

export function receiptScopeKey(scope: StudentComplaintReceiptScope, complaintId: number): string {
  return `${scope.schoolId}:${scope.studentId}:${scope.sessionId}:${complaintId}`;
}
