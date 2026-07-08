import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  UserCheck, LogOut, Plus, X, Loader2, Mail, Clock, Users,
  ChevronDown, Phone, MapPin, CreditCard, User, Target,
  CalendarClock, Calendar, TrendingUp, BarChart2, Sun, Filter,
} from "lucide-react";
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
  visitorIdNumber: string | null;
  address: string | null;
  checkIn: string;
  checkOut: string | null;
}

type FilterMode = "all" | "day" | "week" | "month" | "custom";

// ── Date helpers ───────────────────────────────────────────────────────────────
function startOfDay(d: Date)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d: Date)     { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d: Date)  {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday-based week
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return startOfDay(mon);
}
function inRange(dateStr: string, from: Date, to: Date): boolean {
  const d = new Date(dateStr);
  return d >= from && d <= to;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── General helpers ────────────────────────────────────────────────────────────
function getElapsed(checkIn: string): string {
  const diff = Math.floor((Date.now() - new Date(checkIn).getTime()) / 60000);
  if (diff < 1) return "Just arrived";
  if (diff < 60) return `Active for ${diff} min${diff === 1 ? "" : "s"}`;
  const h = Math.floor(diff / 60); const m = diff % 60;
  return `Active for ${h}h ${m > 0 ? `${m}m` : ""}`.trim();
}
function getDuration(checkIn: string, checkOut: string): string {
  const diff = Math.floor((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000);
  if (diff < 1) return "< 1 min";
  if (diff < 60) return `${diff} min${diff === 1 ? "" : "s"}`;
  const h = Math.floor(diff / 60); const m = diff % 60;
  return `${h}h${m > 0 ? ` ${m}m` : ""}`;
}

function useTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
}

function PulseDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 flex-shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
    </span>
  );
}

function DetailItem({ icon, label, value, spanFull, highlight }: {
  icon: React.ReactNode; label: string; value: string;
  spanFull?: boolean; highlight?: boolean;
}) {
  return (
    <div className={spanFull ? "col-span-2 sm:col-span-3" : ""}>
      <p className="text-white/35 text-[10px] uppercase tracking-wider font-semibold mb-0.5 flex items-center gap-1">
        <span className="text-white/25">{icon}</span>{label}
      </p>
      <p className={`text-sm font-medium leading-snug ${highlight ? "text-[#D4AF37]" : "text-white/75"}`}>
        {value}
      </p>
    </div>
  );
}

// ── Analytics card ─────────────────────────────────────────────────────────────
function StatCard({ icon, label, count, color, glow }: {
  icon: React.ReactNode; label: string; count: number;
  color: string; glow: string;
}) {
  return (
    <div className={`relative rounded-xl border bg-[#0F1E35] p-4 flex items-center gap-4 overflow-hidden ${color}`}>
      {/* glow blob */}
      <div className={`absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-20 blur-xl ${glow}`} />
      {/* icon badge */}
      <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${glow} bg-opacity-20`}
        style={{ background: "rgba(255,255,255,0.06)" }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-white/45 text-[10px] uppercase tracking-widest font-semibold leading-tight">{label}</p>
        <p className="text-3xl font-extrabold text-white leading-none mt-0.5 tabular-nums">{count}</p>
        <p className="text-white/30 text-[10px] mt-0.5">visitor{count !== 1 ? "s" : ""}</p>
      </div>
    </div>
  );
}

const FILTER_LABELS: Record<FilterMode, string> = {
  all: "All Time",
  day: "Today",
  week: "This Week",
  month: "This Month",
  custom: "Custom Range",
};

// ── Main Component ─────────────────────────────────────────────────────────────
export default function VisitorLog({ schoolId, allowedSubs }: Props) {
  const canCheckin  = allowedSubs === undefined || allowedSubs.includes("checkin");
  const canCheckout = allowedSubs === undefined || allowedSubs.includes("checkout");
  const { toast } = useToast();
  const { isArchiveMode } = useSessionView();
  useTick();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [showForm, setShowForm]     = useState(false);
  const [name, setName]             = useState("");
  const [purpose, setPurpose]       = useState("");
  const [host, setHost]             = useState("");
  const [phone, setPhone]           = useState("");
  const [email, setEmail]           = useState("");
  const [idNumber, setIdNumber]     = useState("");
  const [address, setAddress]       = useState("");
  const [checkingOutId, setCheckingOutId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds]     = useState<Set<number>>(new Set());

  // ── Filter state ────────────────────────────────────────────────────────────
  const [filterMode, setFilterMode]     = useState<FilterMode>("all");
  const [showFilterDrop, setShowFilterDrop] = useState(false);
  const [customFrom, setCustomFrom]     = useState(todayStr());
  const [customTo, setCustomTo]         = useState(todayStr());
  const filterRef = useRef<HTMLDivElement>(null);

  // close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterDrop(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggleExpand = (id: number) =>
    setExpandedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // ── Data ────────────────────────────────────────────────────────────────────
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

  // ── Analytics (always from full dataset) ────────────────────────────────────
  const now          = new Date();
  const todayStart   = startOfDay(now);
  const todayEnd     = endOfDay(now);
  const weekStart    = startOfWeek(now);
  const monthStart   = startOfMonth(now);
  const dailyCount   = visitors.filter(v => inRange(v.checkIn, todayStart, todayEnd)).length;
  const weeklyCount  = visitors.filter(v => inRange(v.checkIn, weekStart, todayEnd)).length;
  const monthlyCount = visitors.filter(v => inRange(v.checkIn, monthStart, todayEnd)).length;

  // ── Filtered history ────────────────────────────────────────────────────────
  function getFilterRange(): [Date, Date] | null {
    if (filterMode === "day")   return [todayStart, todayEnd];
    if (filterMode === "week")  return [weekStart, todayEnd];
    if (filterMode === "month") return [monthStart, todayEnd];
    if (filterMode === "custom" && customFrom && customTo) {
      const from = customFrom <= customTo ? customFrom : customTo;
      const to   = customFrom <= customTo ? customTo   : customFrom;
      return [startOfDay(new Date(from)), endOfDay(new Date(to))];
    }
    return null;
  }
  const filterRange   = getFilterRange();
  const filteredPast  = filterRange ? past.filter(v => inRange(v.checkIn, filterRange[0], filterRange[1])) : past;

  // ── Mutations ────────────────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setName(""); setPurpose(""); setHost(""); setPhone("");
    setEmail(""); setIdNumber(""); setAddress(""); setShowForm(false);
  }, []);

  const checkinMutation = useMutation({
    mutationFn: async () => {
      const payload = { visitorName: name, purpose, hostName: host, phone: phone || null, email: email || null, visitorIdNumber: idNumber || null, address: address || null };
      const r = await apiRequest("POST", "/api/visitor-logs", payload);
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
      await new Promise(r => setTimeout(r, 380));
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
    { label: "Visitor Name *",  val: name,     set: setName,     testid: "input-visitor-name",    type: "text",  half: false },
    { label: "Purpose *",       val: purpose,  set: setPurpose,  testid: "input-visitor-purpose", type: "text",  half: false },
    { label: "Host / Meeting *",val: host,     set: setHost,     testid: "input-visitor-host",    type: "text",  half: false },
    { label: "Phone",           val: phone,    set: setPhone,    testid: "input-visitor-phone",   type: "tel",   half: true  },
    { label: "Email",           val: email,    set: setEmail,    testid: "input-visitor-email",   type: "email", half: true  },
    { label: "ID / ID Number",  val: idNumber, set: setIdNumber, testid: "input-visitor-id",      type: "text",  half: false },
    { label: "Address",         val: address,  set: setAddress,  testid: "input-visitor-address", type: "text",  half: false },
  ];

  const phoneError = phone.length > 0 && !/^\d{10}$/.test(phone);
  const canSubmit  = !isArchiveMode && !!name && !!purpose && !!host && !phoneError && !checkinMutation.isPending;

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

        <div className="flex items-center gap-2 flex-wrap">

          {/* ── Date-Range Filter Dropdown ── */}
          <div className="relative" ref={filterRef}>
            <button
              data-testid="button-filter-date"
              onClick={() => setShowFilterDrop(v => !v)}
              className="
                inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                bg-[#1A2942] border border-white/15 text-white/70
                hover:border-[#D4AF37]/40 hover:text-white
                transition-all duration-200
              "
            >
              <Filter className="w-3.5 h-3.5 text-[#D4AF37]/70" />
              <span>{FILTER_LABELS[filterMode]}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showFilterDrop ? "rotate-180" : ""}`} />
            </button>

            {showFilterDrop && (
              <div className="
                absolute right-0 top-full mt-1.5 z-50 w-52
                rounded-xl border border-white/15 bg-[#0F1E35]/95 backdrop-blur-xl
                shadow-2xl shadow-black/60 overflow-hidden
              ">
                {(["all", "day", "week", "month", "custom"] as FilterMode[]).map(mode => (
                  <button
                    key={mode}
                    data-testid={`filter-option-${mode}`}
                    onClick={() => { setFilterMode(mode); if (mode !== "custom") setShowFilterDrop(false); }}
                    className={`
                      w-full text-left px-4 py-2.5 text-sm transition-colors duration-150
                      ${filterMode === mode
                        ? "text-[#D4AF37] bg-[#D4AF37]/10 font-semibold"
                        : "text-white/65 hover:text-white hover:bg-white/5"}
                    `}
                  >
                    {FILTER_LABELS[mode]}
                  </button>
                ))}

                {/* Custom date pickers */}
                {filterMode === "custom" && (
                  <div className="px-3 pb-3 pt-1 border-t border-white/10 space-y-2">
                    <div>
                      <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1">From</label>
                      <input
                        type="date"
                        value={customFrom}
                        max={customTo}
                        onChange={e => setCustomFrom(e.target.value)}
                        data-testid="filter-custom-from"
                        className="w-full rounded-lg bg-[#1A2942] border border-white/15 text-white text-xs px-2.5 py-1.5 focus:outline-none focus:border-[#D4AF37]/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1">To</label>
                      <input
                        type="date"
                        value={customTo}
                        min={customFrom}
                        onChange={e => setCustomTo(e.target.value)}
                        data-testid="filter-custom-to"
                        className="w-full rounded-lg bg-[#1A2942] border border-white/15 text-white text-xs px-2.5 py-1.5 focus:outline-none focus:border-[#D4AF37]/50"
                      />
                    </div>
                    <button
                      onClick={() => setShowFilterDrop(false)}
                      className="w-full mt-1 px-3 py-1.5 rounded-lg bg-[#D4AF37] text-[#0A1628] text-xs font-semibold hover:bg-[#B8962E] transition-colors"
                    >
                      Apply Range
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Check In Visitor button ── */}
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
          <div className="grid grid-cols-2 gap-3">
            {formFields.filter(f => !f.half).map(f => (
              <div key={f.testid} className="col-span-2">
                <label className="block text-xs text-white/60 mb-1 font-medium">{f.label}</label>
                <Input
                  type={f.type} value={f.val}
                  onChange={e => f.set(e.target.value)}
                  className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/20 focus:border-[#D4AF37]/60 focus:ring-[#D4AF37]/20"
                  data-testid={f.testid}
                />
              </div>
            ))}
            {formFields.filter(f => f.half).map(f => {
              const isPhone = f.testid === "input-visitor-phone";
              return (
                <div key={f.testid} className="col-span-1">
                  <label className="block text-xs text-white/60 mb-1 font-medium">{f.label}</label>
                  <Input
                    type={f.type} value={f.val}
                    maxLength={isPhone ? 10 : undefined}
                    onChange={e => {
                      if (isPhone) f.set(e.target.value.replace(/\D/g, ""));
                      else f.set(e.target.value);
                    }}
                    className={`bg-[#0A1628] text-white placeholder:text-white/20 focus:ring-[#D4AF37]/20 ${
                      isPhone && phoneError ? "border-red-500/70 focus:border-red-500" : "border-white/20 focus:border-[#D4AF37]/60"
                    }`}
                    data-testid={f.testid}
                  />
                  {isPhone && phoneError && (
                    <p className="text-red-400 text-[10px] mt-1 font-medium">Must be exactly 10 digits</p>
                  )}
                </div>
              );
            })}
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
                    className="border-b border-white/5"
                    style={checkingOutId === v.id
                      ? { opacity: 0, transform: "translateY(8px)", transition: "opacity 0.35s ease, transform 0.35s ease" }
                      : { opacity: 1, transform: "translateY(0)", transition: "opacity 0.35s ease, transform 0.35s ease" }}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <PulseDot />
                        <div>
                          <span className="text-white font-semibold text-sm leading-tight">{v.visitorName}</span>
                          {v.visitorIdNumber && <p className="text-white/35 text-[10px] mt-0.5">ID: {v.visitorIdNumber}</p>}
                          {v.address && <p className="text-white/30 text-[10px] mt-0.5 truncate max-w-[160px]">{v.address}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-white/60 text-xs">{v.purpose}</td>
                    <td className="py-3 px-4 text-white/60 text-xs">{v.hostName}</td>
                    <td className="py-3 px-4">
                      <p className="text-white/60 text-xs">{fmtDateTime(v.checkIn)}</p>
                      <p className="text-green-400/80 text-[10px] font-medium mt-0.5">{getElapsed(v.checkIn)}</p>
                    </td>
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
                            active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
                            transition-all duration-200 ease-out
                          "
                        >
                          <LogOut className="w-3 h-3" /> Check Out
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

      {/* ── Analytics Summary Strip ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          icon={<Sun className="w-5 h-5 text-amber-400" />}
          label="Daily Traffic"
          count={dailyCount}
          color="border-amber-500/20"
          glow="bg-amber-400"
        />
        <StatCard
          icon={<Calendar className="w-5 h-5 text-cyan-400" />}
          label="Weekly Volume"
          count={weeklyCount}
          color="border-cyan-500/20"
          glow="bg-cyan-400"
        />
        <StatCard
          icon={<BarChart2 className="w-5 h-5 text-violet-400" />}
          label="Monthly Overview"
          count={monthlyCount}
          color="border-violet-500/20"
          glow="bg-violet-400"
        />
      </div>

      {/* ── Visit History ── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Clock className="w-4 h-4 text-white/40" />
          <p className="text-white/60 text-sm font-semibold">Visit History</p>
          {/* Active filter badge */}
          {filterMode !== "all" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/25 text-[#D4AF37] text-[10px] font-semibold">
              <Filter className="w-2.5 h-2.5" />
              {FILTER_LABELS[filterMode]}
            </span>
          )}
          <span className="ml-auto text-white/30 text-xs">
            {filteredPast.length} record{filteredPast.length !== 1 ? "s" : ""}
            {filterMode !== "all" && past.length !== filteredPast.length && (
              <span className="text-white/20"> of {past.length}</span>
            )}
          </span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-white/30" />
          </div>
        ) : filteredPast.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Users className="w-8 h-8 text-white/10" />
            <p className="text-white/30 text-sm">
              {filterMode !== "all" ? `No visits found for ${FILTER_LABELS[filterMode].toLowerCase()}` : "No visit history yet"}
            </p>
            {filterMode !== "all" && (
              <button
                onClick={() => setFilterMode("all")}
                className="text-[#D4AF37]/70 text-xs hover:text-[#D4AF37] transition-colors underline underline-offset-2"
              >
                Show all records
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="bg-[#0F1E35]">
                  {["Visitor", "Purpose", "Check In", "Check Out", "Duration", ""].map((h, i) => (
                    <th key={i} className={`text-left py-2.5 px-4 text-white/50 font-semibold text-[11px] uppercase tracking-wider ${i === 5 ? "w-8" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPast.slice(0, 50).map(v => {
                  const isOpen = expandedIds.has(v.id);
                  return (
                    <>
                      <tr
                        key={v.id}
                        data-testid={`row-visitor-past-${v.id}`}
                        onClick={() => toggleExpand(v.id)}
                        className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer select-none"
                      >
                        <td className="py-3 px-4">
                          <p className="text-white/85 font-medium text-sm leading-tight">{v.visitorName}</p>
                        </td>
                        <td className="py-3 px-4 text-white/50 text-xs">{v.purpose}</td>
                        <td className="py-3 px-4 text-white/50 text-xs whitespace-nowrap">{fmtDateTime(v.checkIn)}</td>
                        <td className="py-3 px-4 text-white/50 text-xs whitespace-nowrap">{v.checkOut ? fmtDateTime(v.checkOut) : "—"}</td>
                        <td className="py-3 px-4">
                          {v.checkOut ? (
                            <span className="inline-block px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] text-[10px] font-semibold whitespace-nowrap">
                              {getDuration(v.checkIn, v.checkOut)}
                            </span>
                          ) : (
                            <span className="text-white/20 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-300 ${isOpen ? "rotate-180 text-[#D4AF37]/70" : ""}`} />
                        </td>
                      </tr>

                      {isOpen && (
                        <tr key={`${v.id}-detail`} className="bg-[#0F1E35]/60 border-b border-[#D4AF37]/10">
                          <td colSpan={6} className="px-5 py-4">
                            <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
                              <DetailItem icon={<User className="w-3.5 h-3.5" />}          label="Visitor Name"   value={v.visitorName} />
                              <DetailItem icon={<Target className="w-3.5 h-3.5" />}        label="Purpose"        value={v.purpose} />
                              <DetailItem icon={<User className="w-3.5 h-3.5" />}          label="Host / Meeting" value={v.hostName} />
                              <DetailItem icon={<Phone className="w-3.5 h-3.5" />}         label="Phone"          value={v.phone || "—"} />
                              <DetailItem icon={<Mail className="w-3.5 h-3.5" />}          label="Email"          value={v.email || "—"} />
                              <DetailItem icon={<CreditCard className="w-3.5 h-3.5" />}    label="ID / ID Number" value={v.visitorIdNumber || "—"} />
                              <DetailItem icon={<MapPin className="w-3.5 h-3.5" />}        label="Address"        value={v.address || "—"} spanFull />
                              <DetailItem icon={<CalendarClock className="w-3.5 h-3.5" />} label="Checked In"     value={fmtDateTime(v.checkIn)} />
                              <DetailItem icon={<CalendarClock className="w-3.5 h-3.5" />} label="Checked Out"    value={v.checkOut ? fmtDateTime(v.checkOut) : "—"} />
                              <DetailItem icon={<Clock className="w-3.5 h-3.5" />}         label="Total Duration" value={v.checkOut ? getDuration(v.checkIn, v.checkOut) : "—"} highlight={!!v.checkOut} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
