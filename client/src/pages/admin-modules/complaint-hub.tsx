import { useQuery, useMutation } from "@tanstack/react-query";
import { MessageSquare, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number }

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-500/20 text-red-400 border-red-500/30",
  resolved: "bg-green-500/20 text-green-400 border-green-500/30",
  in_progress: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

export default function ComplaintHub({ schoolId }: Props) {
  const { toast } = useToast();

  const { data: complaints = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/complaints/school", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/complaints/school/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/complaints/${id}/status`, { status });
    },
    onSuccess: () => {
      toast({ title: "Complaint Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/school", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const open = complaints.filter((c: any) => c.status === "open" || c.status === "in_progress");
  const resolved = complaints.filter((c: any) => c.status === "resolved");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Complaint Hub</h2>
        <p className="text-white/50 text-sm">{open.length} open · {resolved.length} resolved</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
      ) : complaints.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
          <MessageSquare className="w-10 h-10 mx-auto mb-3 text-white/20" />
          <p className="text-white/40">No complaints filed</p>
        </div>
      ) : (
        <div className="space-y-3">
          {complaints.map((c: any) => (
            <div key={c.id} className="rounded-xl border border-white/10 bg-[#1A2942] p-4" data-testid={`card-complaint-${c.id}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-white font-medium">{c.subject ?? c.title ?? "Complaint"}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[c.status] ?? "bg-white/10 text-white/60 border-white/20"}`}>
                      {c.status}
                    </span>
                  </div>
                  <p className="text-white/60 text-sm line-clamp-2">{c.description ?? c.body ?? ""}</p>
                  <p className="text-white/30 text-xs mt-1">{new Date(c.createdAt).toLocaleDateString("en-GB")}</p>
                </div>
                {c.status !== "resolved" && (
                  <Button size="sm" disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: c.id, status: "resolved" })}
                    className="h-7 px-3 bg-green-600 hover:bg-green-500 text-white shrink-0"
                    data-testid={`button-resolve-complaint-${c.id}`}>
                    <CheckCircle className="w-3 h-3 mr-1" /> Resolve
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
