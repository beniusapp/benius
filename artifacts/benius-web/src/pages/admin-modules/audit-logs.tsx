import { useQuery } from "@tanstack/react-query";
import { sessionFetchForViewSession } from "@/lib/queryClient";
import { AlertCircle, Loader2, RefreshCw, Shield } from "lucide-react";
import { fmtDateTime } from "@/lib/dateUtils";
import {
  AUDIT_LOG_DESCRIPTION,
  auditLogErrorMessage,
  auditLogsQueryKey,
  formatAuditActor,
  getAuditLogsViewState,
  sortAuditLogsNewestFirst,
} from "./audit-logs-utils";

interface Props {
  schoolId: number;
  viewSessionId?: number | null;
}

interface AuditLogEntry {
  id: number;
  createdAt: string;
  actionType: string;
  entityType: string;
  entityId: number;
  actionBy?: number | null;
  actionByRole?: string | null;
  details?: string | null;
}

class AuditLogRequestError extends Error {
  constructor(readonly status: number) {
    super(`Audit Log request failed with status ${status}`);
    this.name = "AuditLogRequestError";
  }
}

const ACTION_COLORS: Record<string, string> = {
  upload: "text-blue-400", approve: "text-green-400", reject: "text-red-400",
  batch_upload: "text-blue-400", verify: "text-purple-400", forward: "text-yellow-400",
  checkin: "text-cyan-400", checkout: "text-orange-400",
};


export default function AuditLogs({ schoolId, viewSessionId = null }: Props) {
  const { data: logs, isLoading, isError, error, refetch } = useQuery<AuditLogEntry[]>({
    queryKey: auditLogsQueryKey(schoolId, viewSessionId),
    queryFn: async () => {
      const response = await sessionFetchForViewSession(
        `/api/audit-logs/${schoolId}`,
        viewSessionId,
      );
      if (!response.ok) throw new AuditLogRequestError(response.status);
      return response.json() as Promise<AuditLogEntry[]>;
    },
    enabled: !!schoolId,
    refetchInterval: 30000,
  });
  const orderedLogs = sortAuditLogsNewestFirst(logs ?? []);
  const viewState = getAuditLogsViewState({
    isLoading,
    isError,
    hasEntries: orderedLogs.length > 0,
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Audit Logs</h2>
        <p className="text-white/50 text-sm">{AUDIT_LOG_DESCRIPTION} Showing up to 100 recent entries.</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        {viewState === "loading" ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
        ) : viewState === "error" ? (
          <div className="py-12 px-5 text-center" role="alert">
            <AlertCircle className="w-9 h-9 mx-auto mb-3 text-red-400/70" />
            <p className="text-red-200/80">{auditLogErrorMessage(error instanceof AuditLogRequestError ? error.status : null)}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-2 mt-4 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/5"
            >
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        ) : viewState === "empty" ? (
          <div className="py-16 text-center">
            <Shield className="w-10 h-10 mx-auto mb-3 text-white/20" />
            <p className="text-white/40">No audit events recorded yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#0F1E35]">
              <tr>
                {["Timestamp", "Action", "Entity", "Actor", "Details"].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedLogs.map(log => (
                <tr key={log.id} className="border-b border-white/5 hover:bg-white/3 transition-colors" data-testid={`row-audit-${log.id}`}>
                  <td className="py-2.5 px-4 text-white/50 text-xs font-mono whitespace-nowrap">{fmtDateTime(log.createdAt)}</td>
                  <td className="py-2.5 px-4">
                    <span className={`text-xs font-semibold uppercase tracking-wide ${ACTION_COLORS[log.actionType] || "text-white/70"}`}>
                      {log.actionType}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/70">{log.entityType}</span>
                  </td>
                  <td className="py-2.5 px-4 text-white/50 text-xs capitalize">{formatAuditActor(log.actionBy, log.actionByRole)}</td>
                  <td className="py-2.5 px-4 text-white/60 text-xs truncate max-w-[240px]">{log.details ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
