import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UserCheck, LogOut, Plus, X, Loader2, Mail, Clock, Users } from "lucide-react";
import { fmtDateTime } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";

interface Props { schoolId: number; allowedSubs?: string[] }

interface VisitorEntry {
  id: number;
  visitorName: string;
  purpose: string;
  hostName: string;
  phone: string | null;
  email: string | null;
  checkIn: string;
  checkOut: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getElapsed(checkIn: string): string {
  const diff = Math.floor((Date.now() - new Date(checkIn).getTime()) / 60000);
  if (diff < 1) return "Just arrived";
  if (diff < 60) return `Active for ${diff} min${diff === 1 ? "" : "s"}`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `Active for ${h}h ${m > 0 ? `${m}m` : ""}`.trim();
}

function getDuration(checkIn: string, checkOut: string): string {
  const diff = Math.floor((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000);
  if (diff < 1) return "< 1 min";
  if (diff < 60) return `${diff} min${diff === 1 ? "" : "s"}`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}h${m > 0 ? ` ${m}m` : ""}`;
}

// ── Animated elapsed ticker (updates every 60s) ───────────────────────────────
function useTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
}

// ── Status pulse dot ──────────────────────────────────────────────────────────
function PulseDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 flex-shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function VisitorLog({ schoolId, allowedSubs }: Props) {
  const canCheckin  = allowedSubs === undefined || allowedSubs.includes("checkin");
  const canCheckout = allowedSubs === undefined || allowedSubs.includes("checkout");
  const { toast } = useToast();
  const { isArchiveMode } = useSessionView();
  useTick(); // re-renders every 60s to refresh elapsed times

  const [showForm, setShowForm] = useState(false);
  const [name, setName]       = useState("");
  const [purpose, setPurpose] = useState("");
  const [host, setHost]       = useState("");
  const [phone, setPhone]     = useState("");
  const [email, setEmail]     = useState("");
  const [checkingOutId, setCheckingOutId] = useState<number | null>(null);

  const { data: visitors = [], isLoading } = useQuery<VisitorEntry[]>({
    queryKey: ["/api/visitor-logs", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/visitor-logs/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
    refetchInterval: 30000,
  });

  const active = visitors.filter(v => !v.checkOut);
  const past   = visitors.filter(v => !!v.checkOut);

  const resetForm = useCallback(() => {
    setName(""); setPurpose(""); setHost(""); setPhone(""); setEmail("");
    setShowForm(false);
  }, []);

  const checkinMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/visitor-logs", { visitorName: name, purpose, hostName: host, phone: phone || null, email });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Visitor Checked In", description: `${name} has been logged on campus.` });
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-logs", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const checkoutMutation = useMutation({
    mutationFn: async (id: number) => {
      setCheckingOutId(id);
      await new Promise(r => setTimeout(r, 380)); // let animation play
      await apiRequest("PATCH", `/api/visitor-logs/${id}/checkout`, {});
    },
    onSuccess: () => {
      toast({ title: "Visitor Checked Out" });
      setCheckingOutId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-logs", schoolId] });
    },
    onError: (e: Error) => {
      setCheckingOutId(null);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const formFields = [
    { label: "Visitor Name *", val: name,    set: setName,    testid: "input-visitor-name",    type: "text",  half: false },
    { label: "Purpose *",      val: purpose,  set: setPurpose, testid: "input-visitor-purpose",  type: "text",  half: false },
    { label: "Host / Meeting *",val: host,    set: setHost,    testid: "input-visitor-host",    type: "text",  half: false },
    { label: "Phone",          val: phone,    set: setPhone,   testid: "input-visitor-phone",   type: "tel",   half: true  },
    { label: "Email *",        val: email,    set: setEmail,   testid: "input-visitor-email",   type: "email", half: true  },
  ];

  const canSubmit = !isArchiveMode && !!name && !!purpose && !!host && !!email && !checkinMutation.isPending;

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Visitor Log</h2>
          <p className="text-white/50 text-sm flex items-center gap-1.5">
            <PulseDot />
            {active.length} currently on campus
          </p>
        </div>
        {canCheckin && (
          <Button
            size="sm"
            className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
            onClick={() => setShowForm(v => !v)}
            data-testid="button-checkin-visitor"
          >
            <Plus className="w-4 h-4 mr-1" /> Check In Visitor
          </Button>
        )}
      </div>

      {/* ── New Visitor Form ── */}
      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white text-sm">New Visitor Entry</h3>
            <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 2-column grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Full-width fields */}
            {formFields.filter(f => !f.half).map(f => (
              <div key={f.testid} className="col-span-2">
                <label className="block text-xs text-white/60 mb-1 font-medium">{f.label}</label>
                <Input
                  type={f.type}
                  value={f.val}
                  onChange={e => f.set(e.target.value)}
                  className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/20 focus:border-[#D4AF37]/60 focus:ring-[#D4AF37]/20"
                  data-testid={f.testid}
                />
              </div>
            ))}
            {/* Half-width fields */}
            {formFields.filter(f => f.half).map(f => (
              <div key={f.testid} className="col-span-1">
                <label className="block text-xs text-white/60 mb-1 font-medium">{f.label}</label>
                <Input
                  type={f.type}
                  value={f.val}
                  onChange={e => f.set(e.target.value)}
                  className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/20 focus:border-[#D4AF37]/60 focus:ring-[#D4AF37]/20"
                  data-testid={f.testid}
                />
              </div>
            ))}
            {/* Submit */}
            <div className="col-span-2">
              <Button
                disabled={!canSubmit}
                onClick={() => checkinMutation.mutate()}
                className="w-full bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold disabled:opacity-40"
                data-testid="button-submit-checkin"
              >
                {checkinMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><UserCheck className="w-4 h-4 mr-1.5" /> Check In</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Currently On Campus ── */}
      {active.length > 0 && (
        <div className="rounded-xl border border-green-500/30 bg-[#1A2942] overflow-hidden">
          <div className="bg-green-500/10 px-4 py-2.5 border-b border-green-500/20 flex items-center gap-2">
            <PulseDot />
            <p className="text-green-400 text-sm font-semibold">Currently On Campus</p>
            <span className="ml-auto text-green-400/60 text-xs font-mono">{active.length} active</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-[#0F1E35]">
                  {["Visitor", "Purpose", "Host", "Check In", "Action"].map(h => (
                    <th key={h} className="text-left py-2.5 px-4 text-white/50 font-semibold text-[11px] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map(v => (
                  <tr
                    key={v.id}
                    data-testid={`row-visitor-active-${v.id}`}
                    className="border-b border-white/5 transition-all duration-400"
                    style={checkingOutId === v.id ? {
                      opacity: 0,
                      transform: "translateY(8px)",
                      transition: "opacity 0.35s ease, transform 0.35s ease",
                    } : {
                      opacity: 1,
                      transform: "translateY(0)",
                      transition: "opacity 0.35s ease, transform 0.35s ease",
                    }}
                  >
                    {/* Visitor name + pulse */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <PulseDot />
                        <span className="text-white font-semibold text-sm leading-tight">{v.visitorName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-white/60 text-xs">{v.purpose}</td>
                    <td className="py-3 px-4 text-white/60 text-xs">{v.hostName}</td>
                    {/* Check-in + elapsed */}
                    <td className="py-3 px-4">
                      <p className="text-white/60 text-xs">{fmtDateTime(v.checkIn)}</p>
                      <p className="text-green-400/80 text-[10px] font-medium mt-0.5">{getElapsed(v.checkIn)}</p>
                    </td>
                    {/* Check-out button */}
                    <td className="py-3 px-4">
                      {canCheckout && (
                        <button
                          onClick={() => checkoutMutation.mutate(v.id)}
                          disabled={checkoutMutation.isPending}
                          data-testid={`button-checkout-${v.id}`}
                          className="
                            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                            bg-red-500/10 text-red-400 border border-red-500/20
                            hover:bg-red-500 hover:text-white hover:border-red-500 hover:scale-105
                            active:scale-95
                            disabled:opacity-40 disabled:cursor-not-allowed
                            transition-all duration-200 ease-out
                          "
                        >
                          <LogOut className="w-3 h-3" />
                          Check Out
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Visit History ── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Clock className="w-4 h-4 text-white/40" />
          <p className="text-white/60 text-sm font-semibold">Visit History</p>
          {past.length > 0 && (
            <span className="ml-auto text-white/30 text-xs">{past.length} record{past.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-white/30" />
          </div>
        ) : past.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Users className="w-8 h-8 text-white/10" />
            <p className="text-white/30 text-sm">No visit history yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="bg-[#0F1E35]">
                  {["Visitor", "Purpose", "Host", "Check In", "Check Out", "Duration"].map(h => (
                    <th key={h} className="text-left py-2.5 px-4 text-white/50 font-semibold text-[11px] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {past.slice(0, 50).map(v => (
                  <tr key={v.id} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors" data-testid={`row-visitor-past-${v.id}`}>
                    {/* Visitor: name + email */}
                    <td className="py-3 px-4">
                      <p className="text-white/85 font-medium text-sm leading-tight">{v.visitorName}</p>
                      {v.email && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Mail className="w-3 h-3 text-white/25 flex-shrink-0" />
                          <p className="text-white/35 text-[10px] truncate max-w-[140px]">{v.email}</p>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-white/50 text-xs">{v.purpose}</td>
                    <td className="py-3 px-4 text-white/50 text-xs">{v.hostName}</td>
                    <td className="py-3 px-4 text-white/50 text-xs whitespace-nowrap">{fmtDateTime(v.checkIn)}</td>
                    <td className="py-3 px-4 text-white/50 text-xs whitespace-nowrap">{v.checkOut ? fmtDateTime(v.checkOut) : "—"}</td>
                    {/* Duration */}
                    <td className="py-3 px-4">
                      {v.checkOut ? (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] text-[10px] font-semibold whitespace-nowrap">
                          {getDuration(v.checkIn, v.checkOut)}
                        </span>
                      ) : (
                        <span className="text-white/20 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
