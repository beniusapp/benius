import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UserCheck, LogOut, Plus, X, Loader2 } from "lucide-react";
import { fmtDateTime } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";

interface Props { schoolId: number }


export default function VisitorLog({ schoolId }: Props) {
  const { toast } = useToast();
  const { isArchiveMode } = useSessionView();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [host, setHost] = useState("");
  const [phone, setPhone] = useState("");
  const [badge, setBadge] = useState("");

  const { data: visitors = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/visitor-logs", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/visitor-logs/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
    refetchInterval: 30000,
  });

  const checkinMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/visitor-logs", { visitorName: name, purpose, hostName: host, phone: phone || null, badge: badge || null });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Visitor Checked In" });
      setName(""); setPurpose(""); setHost(""); setPhone(""); setBadge("");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-logs", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const checkoutMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PATCH", `/api/visitor-logs/${id}/checkout`, {}); },
    onSuccess: () => {
      toast({ title: "Visitor Checked Out" });
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-logs", schoolId] });
    },
  });

  const active = visitors.filter((v: any) => !v.checkOut);
  const past = visitors.filter((v: any) => !!v.checkOut);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Visitor Log</h2>
          <p className="text-white/50 text-sm">{active.length} currently on campus</p>
        </div>
        <Button size="sm" className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
          onClick={() => setShowForm(!showForm)} data-testid="button-checkin-visitor">
          <Plus className="w-4 h-4 mr-1" /> Check In Visitor
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">New Visitor Entry</h3>
            <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: "Visitor Name *", val: name, set: setName, testid: "input-visitor-name" },
              { label: "Purpose *", val: purpose, set: setPurpose, testid: "input-visitor-purpose" },
              { label: "Host / Meeting *", val: host, set: setHost, testid: "input-visitor-host" },
              { label: "Phone", val: phone, set: setPhone, testid: "input-visitor-phone" },
              { label: "Badge No.", val: badge, set: setBadge, testid: "input-visitor-badge" },
            ].map(f => (
              <div key={f.testid}>
                <label className="block text-xs text-white/60 mb-1">{f.label}</label>
                <Input value={f.val} onChange={e => f.set(e.target.value)}
                  className="bg-[#0A1628] border-white/20 text-white" data-testid={f.testid} />
              </div>
            ))}
            <div className="flex items-end">
              <Button disabled={isArchiveMode || !name || !purpose || !host || checkinMutation.isPending}
                onClick={() => checkinMutation.mutate()}
                className="w-full bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid="button-submit-checkin">
                {checkinMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserCheck className="w-4 h-4 mr-1" /> Check In</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div className="rounded-xl border border-green-500/30 bg-[#1A2942] overflow-hidden">
          <div className="bg-green-500/10 px-4 py-2 border-b border-green-500/20">
            <p className="text-green-400 text-sm font-semibold">Currently On Campus ({active.length})</p>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-[#0F1E35]">
              {["Visitor", "Purpose", "Host", "Badge", "Check In", ""].map(h => (
                <th key={h} className="text-left py-2.5 px-4 text-white/60 font-medium text-xs uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {active.map((v: any) => (
                <tr key={v.id} className="border-b border-white/5 hover:bg-white/5" data-testid={`row-visitor-active-${v.id}`}>
                  <td className="py-3 px-4 text-white font-medium">{v.visitorName}</td>
                  <td className="py-3 px-4 text-white/70 text-xs">{v.purpose}</td>
                  <td className="py-3 px-4 text-white/70 text-xs">{v.hostName}</td>
                  <td className="py-3 px-4 text-[#D4AF37] text-xs font-mono">{v.badge ?? "—"}</td>
                  <td className="py-3 px-4 text-white/50 text-xs">{fmtDateTime(v.checkIn)}</td>
                  <td className="py-3 px-4">
                    <Button size="sm" variant="outline" onClick={() => checkoutMutation.mutate(v.id)}
                      disabled={checkoutMutation.isPending}
                      className="h-7 px-2 border-orange-500/40 text-orange-400 hover:bg-orange-500/10" data-testid={`button-checkout-${v.id}`}>
                      <LogOut className="w-3 h-3 mr-1" /> Out
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="px-4 py-2 border-b border-white/10">
          <p className="text-white/60 text-sm font-semibold">Visit History</p>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
        ) : past.length === 0 ? (
          <p className="py-8 text-center text-white/40 text-sm">No visit history</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-[#0F1E35]">
              {["Visitor", "Purpose", "Host", "Check In", "Check Out"].map(h => (
                <th key={h} className="text-left py-2.5 px-4 text-white/60 font-medium text-xs uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {past.slice(0, 30).map((v: any) => (
                <tr key={v.id} className="border-b border-white/5 hover:bg-white/5" data-testid={`row-visitor-past-${v.id}`}>
                  <td className="py-2.5 px-4 text-white/80">{v.visitorName}</td>
                  <td className="py-2.5 px-4 text-white/50 text-xs">{v.purpose}</td>
                  <td className="py-2.5 px-4 text-white/50 text-xs">{v.hostName}</td>
                  <td className="py-2.5 px-4 text-white/50 text-xs">{fmtDateTime(v.checkIn)}</td>
                  <td className="py-2.5 px-4 text-white/50 text-xs">{fmtDateTime(v.checkOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
