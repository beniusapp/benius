import { useQuery } from "@tanstack/react-query";
import { Shield, Loader2 } from "lucide-react";

interface Props { schoolId: number }

const ACTION_COLORS: Record<string, string> = {
  upload: "text-blue-400", approve: "text-green-400", reject: "text-red-400",
  batch_upload: "text-blue-400", verify: "text-purple-400", forward: "text-yellow-400",
  checkin: "text-cyan-400", checkout: "text-orange-400",
};

function fmt(d: string | Date) {
  const date = new Date(d);
  return `${date.toLocaleDateString("en-GB")} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function AuditLogs({ schoolId }: Props) {
  const { data: logs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/audit-logs", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/audit-logs/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Audit Logs</h2>
        <p className="text-white/50 text-sm">Complete immutable trail of all admin and teacher actions. Last 100 entries.</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center">
            <Shield className="w-10 h-10 mx-auto mb-3 text-white/20" />
            <p className="text-white/40">No audit events recorded yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#0F1E35]">
              <tr>
                {["Timestamp", "Action", "Entity", "Role", "Details"].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id} className="border-b border-white/5 hover:bg-white/3 transition-colors" data-testid={`row-audit-${log.id}`}>
                  <td className="py-2.5 px-4 text-white/50 text-xs font-mono whitespace-nowrap">{fmt(log.createdAt)}</td>
                  <td className="py-2.5 px-4">
                    <span className={`text-xs font-semibold uppercase tracking-wide ${ACTION_COLORS[log.actionType] || "text-white/70"}`}>
                      {log.actionType}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/70">{log.entityType}</span>
                  </td>
                  <td className="py-2.5 px-4 text-white/50 text-xs capitalize">{log.actionByRole}</td>
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
