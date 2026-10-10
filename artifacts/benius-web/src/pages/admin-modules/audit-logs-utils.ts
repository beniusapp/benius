export interface AuditLogOrderEntry {
  id: number;
  createdAt: string;
}

export const AUDIT_LOG_DESCRIPTION =
  "View recorded school activities for the selected Academic Session.";

export function auditLogsQueryKey(schoolId: number, viewSessionId: number | null | undefined) {
  return ["/api/audit-logs", schoolId, viewSessionId ?? null] as const;
}

export function formatAuditActor(actionBy: number | null | undefined, role: string | null | undefined) {
  const actor = Number.isSafeInteger(actionBy) && Number(actionBy) > 0
    ? `ID ${actionBy}`
    : "Unknown actor";
  return role ? `${actor} · ${role}` : actor;
}

export function sortAuditLogsNewestFirst<T extends AuditLogOrderEntry>(entries: T[]) {
  return [...entries].sort((a, b) => {
    const timeDifference = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
    return Number(b.id) - Number(a.id);
  });
}

export function auditLogErrorMessage(status: number | null) {
  if (status === 403) {
    return "You do not have permission to view Audit Logs for this school.";
  }
  return "Audit Logs could not be loaded. Please try again.";
}

export function getAuditLogsViewState({
  isLoading,
  isError,
  hasEntries,
}: {
  isLoading: boolean;
  isError: boolean;
  hasEntries: boolean;
}): "loading" | "error" | "empty" | "entries" {
  if (isLoading) return "loading";
  if (isError) return "error";
  return hasEntries ? "entries" : "empty";
}
