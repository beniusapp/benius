import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, MapPin, AlertTriangle, CheckCircle, Clock, Timer,
  LogIn, LogOut, TrendingUp, Calendar, Edit3, ChevronDown,
  Loader2, Flame, BarChart2, X,
} from "lucide-react";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface SelfAttRecord {
  id: number;
  attendanceDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: "Present" | "Late" | "Half Day" | "Absent" | "Not Marked" | "Leave";
  totalWorkingMinutes: number;
  locationVerified: boolean;
}

interface AttendancePolicyInfo {
  policyName: string;
  expectedArrivalTime: string;
  gracePeriodMinutes: number;
  halfDayCutoffTime: string;
  schoolEndTime: string;
  attendanceTarget: number;
}

interface CorrectionReq {
  id: number;
  attendanceDate: string;
  requestedCheckIn: string;
  requestedCheckOut: string;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  createdAt: string;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtDuration(mins: number): string {
  if (!mins || mins <= 0) return "—";
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtElapsed(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function statusColors(status: string) {
  if (status === "Present")  return { dot: "bg-emerald-400", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", text: "text-emerald-400" };
  if (status === "Late")     return { dot: "bg-amber-400",   badge: "bg-amber-500/20 text-amber-300 border-amber-500/30",   text: "text-amber-400"   };
  if (status === "Half Day") return { dot: "bg-orange-400",  badge: "bg-orange-500/20 text-orange-300 border-orange-500/30", text: "text-orange-400"  };
  if (status === "Absent")   return { dot: "bg-red-400",     badge: "bg-red-500/20 text-red-300 border-red-500/30",         text: "text-red-400"     };
  if (status === "Leave")    return { dot: "bg-slate-400",   badge: "bg-slate-500/20 text-slate-300 border-slate-500/30",   text: "text-slate-300"   };
  return { dot: "bg-white/20", badge: "bg-white/10 text-white/40 border-white/10", text: "text-white/40" };
}

function correctionStatusStyle(s: string) {
  if (s === "Approved") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
  if (s === "Rejected") return "bg-red-500/20 text-red-300 border-red-500/30";
  return "bg-amber-500/20 text-amber-300 border-amber-500/30";
}

/** Returns today's date as YYYY-MM-DD in the browser's local timezone (IST for Indian users) */
function getLocalDateStr(): string {
  return new Date().toLocaleDateString("en-CA"); // en-CA locale → YYYY-MM-DD
}

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00");
  return d.getDay() === 0 || d.getDay() === 6;
}

export default function MyAttendanceModule({ teacher, onBack }: { teacher: TeacherMe; onBack: () => void }) {
  const { toast } = useToast();

  // ── Reactive today date — updates automatically at local midnight ─────────────
  const [today, setToday] = useState(getLocalDateStr);

  useEffect(() => {
    const now = new Date();
    // Compute ms until next midnight in local (browser) timezone
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    const id = setTimeout(() => {
      // Date has rolled over — update state and flush all attendance caches
      setToday(getLocalDateStr());
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/self-attendance/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/self-attendance/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/self-attendance/corrections"] });
    }, msUntilMidnight);

    return () => clearTimeout(id);
  }, [today]); // re-schedules each time `today` changes (i.e., after each midnight tick)

  // ── Geolocation ─────────────────────────────────────────────────────────────
  const [geo, setGeo] = useState<{ lat: number | null; lng: number | null; verified: boolean }>({ lat: null, lng: null, verified: false });
  const [geoLoading, setGeoLoading] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, verified: true }); setGeoLoading(false); },
      () => { setGeo({ lat: null, lng: null, verified: false }); setGeoLoading(false); },
      { timeout: 8000 }
    );
  }, []);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: todayRaw, isLoading: todayLoading } = useQuery<SelfAttRecord | null>({
    queryKey: ["/api/teacher/self-attendance/today", today],
    queryFn: async () => { const r = await fetch("/api/teacher/self-attendance/today", { credentials: "include" }); return r.ok ? r.json() : null; },
    staleTime: 0, refetchOnMount: "always",
    refetchInterval: 60000, // polling fallback — catches midnight if setTimeout missed (e.g. browser was suspended)
  });

  // Date guard: only use a record if it truly belongs to today; this prevents stale
  // cross-day data from ever rendering as the active shift after midnight
  const todayRec = todayRaw?.attendanceDate === today ? todayRaw : null;

  const { data: history = [], isLoading: historyLoading } = useQuery<SelfAttRecord[]>({
    queryKey: ["/api/teacher/self-attendance/history"],
    queryFn: async () => { const r = await fetch("/api/teacher/self-attendance/history?days=30", { credentials: "include" }); return r.ok ? r.json() : []; },
    staleTime: 60000,
  });

  const { data: corrections = [], isLoading: correctionsLoading } = useQuery<CorrectionReq[]>({
    queryKey: ["/api/teacher/self-attendance/corrections"],
    queryFn: async () => { const r = await fetch("/api/teacher/self-attendance/corrections", { credentials: "include" }); return r.ok ? r.json() : []; },
  });

  const { data: policy } = useQuery<AttendancePolicyInfo>({
    queryKey: ["/api/teacher/attendance-policy"],
    queryFn: async () => { const r = await fetch("/api/teacher/attendance-policy", { credentials: "include" }); return r.ok ? r.json() : null; },
    staleTime: 0,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/teacher/self-attendance/today"] });
    queryClient.invalidateQueries({ queryKey: ["/api/teacher/self-attendance/history"] });
  };

  const checkInMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/teacher/self-attendance/check-in", { latitude: geo.lat, longitude: geo.lng, locationVerified: geo.verified }).then(r => r.json()),
    onSuccess: (d) => {
      if (d.status === "Leave") {
        toast({ title: "🏫 School Day Ended", description: `Attendance recorded as Leave. School ended at ${policy?.schoolEndTime ?? "—"}.`, variant: "destructive" });
      } else if (d.status === "Late" || d.status === "Half Day") {
        toast({ title: "⚠️ Checked In — Late", description: `Shift started at ${fmtTime(d.checkInTime)}` });
      } else {
        toast({ title: "✅ Checked In!", description: `Shift started at ${fmtTime(d.checkInTime)}` });
      }
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Check-in failed", description: e.message, variant: "destructive" }),
  });

  const checkOutMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/teacher/self-attendance/check-out", {}).then(r => r.json()),
    onSuccess: (d) => { toast({ title: "✅ Checked Out!", description: `Total: ${fmtDuration(d.totalWorkingMinutes)}` }); invalidate(); },
    onError:   (e: Error) => toast({ title: "Check-out failed", description: e.message, variant: "destructive" }),
  });

  // ── Live timer ───────────────────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (todayRec?.checkInTime && !todayRec?.checkOutTime) {
      const start = new Date(todayRec.checkInTime).getTime();
      setElapsed(Math.floor((Date.now() - start) / 1000));
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [todayRec?.checkInTime, todayRec?.checkOutTime]);

  // ── Derived analytics ────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const workdays = history.filter(r => !isWeekend(r.attendanceDate));
    const present  = workdays.filter(r => r.status === "Present").length;
    const late     = workdays.filter(r => r.status === "Late").length;
    const halfDay  = workdays.filter(r => r.status === "Half Day").length;
    const absent   = workdays.filter(r => r.status === "Absent").length;
    const marked   = present + late + halfDay;
    const rate     = workdays.length > 0 ? Math.round((marked / workdays.length) * 100) : 0;
    const durations = history.filter(r => r.totalWorkingMinutes > 0).map(r => r.totalWorkingMinutes);
    const avgDur   = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    // Streak: consecutive Present/Late days going back from yesterday
    const sorted = [...history].sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate));
    let streak = 0, longest = 0, cur = 0;
    let prevDate: string | null = null;
    for (const r of sorted) {
      if (r.attendanceDate === today) continue;
      if (isWeekend(r.attendanceDate)) continue;
      const ok = r.status === "Present" || r.status === "Late" || r.status === "Half Day";
      if (ok) {
        cur++;
        if (cur > longest) longest = cur;
        if (prevDate === null || isPrevWorkday(r.attendanceDate, prevDate)) streak = cur;
      } else { if (streak === 0) streak = 0; cur = 0; }
      prevDate = r.attendanceDate;
    }
    return { present, late, absent, rate, avgDur, streak, longest };
  }, [history, today]);

  function isPrevWorkday(earlier: string, later: string): boolean {
    const e = new Date(earlier + "T12:00:00"), l = new Date(later + "T12:00:00");
    const diff = Math.round((l.getTime() - e.getTime()) / 86400000);
    return diff <= 3;
  }

  // ── 7-day timeline data ──────────────────────────────────────────────────────
  const timeline = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local timezone
      const rec = dateStr === today ? todayRec ?? undefined : history.find(r => r.attendanceDate === dateStr);
      return { dateStr, label: getDayLabel(dateStr), isToday: dateStr === today, isWeekend: isWeekend(dateStr), rec };
    });
  }, [history, todayRec, today]);

  // ── Monthly calendar ─────────────────────────────────────────────────────────
  const calDays = useMemo(() => {
    const now = new Date(), yr = now.getFullYear(), mo = now.getMonth();
    const first = new Date(yr, mo, 1), last = new Date(yr, mo + 1, 0);
    const cells: Array<{ d: number; dateStr: string; rec?: SelfAttRecord; isToday: boolean; isWeekend: boolean } | null> = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let d = 1; d <= last.getDate(); d++) {
      const dateStr = `${yr}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ d, dateStr, rec: history.find(r => r.attendanceDate === dateStr), isToday: dateStr === today, isWeekend: new Date(yr, mo, d).getDay() === 0 || new Date(yr, mo, d).getDay() === 6 });
    }
    return cells;
  }, [history, today]);

  // ── Correction modal ─────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [corrForm, setCorrForm] = useState({ date: "", checkIn: "", checkOut: "", reason: "" });
  const sevenAgo = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toLocaleDateString("en-CA"); }, []);

  const corrMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/teacher/self-attendance/correction", { date: corrForm.date, requestedCheckIn: corrForm.checkIn, requestedCheckOut: corrForm.checkOut, reason: corrForm.reason }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "✅ Attendance Corrected", description: "Your record has been updated immediately." });
      setShowModal(false); setCorrForm({ date: "", checkIn: "", checkOut: "", reason: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/self-attendance/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/self-attendance/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/self-attendance/corrections"] });
    },
    onError: (e: Error) => toast({ title: "Correction failed", description: e.message, variant: "destructive" }),
  });

  const [activeTab, setActiveTab] = useState<"timeline" | "calendar">("timeline");

  // ── Shift state ──────────────────────────────────────────────────────────────
  const shiftState: "unmarked" | "active" | "done" | "leave" =
    !todayRec || !todayRec.checkInTime ? "unmarked" :
    todayRec.status === "Leave" ? "leave" :
    !todayRec.checkOutTime ? "active" : "done";

  // ── School-over detection (IST) ──────────────────────────────────────────────
  const isSchoolOver = (() => {
    if (!policy?.schoolEndTime) return false;
    const now = new Date();
    const istNow = new Date(now.getTime() + 19_800_000);
    const hh = String(istNow.getUTCHours()).padStart(2, "0");
    const mm = String(istNow.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}` > policy.schoolEndTime;
  })();

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-24" data-testid="view-my-attendance">

      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors" data-testid="button-back">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 transition-colors" data-testid="button-request-correction">
          <Edit3 className="w-3.5 h-3.5" /> Correct Attendance
        </button>
      </div>

      <div>
        <h2 className="text-xl font-bold text-white">My Attendance</h2>
        <p className="text-xs text-white/40 mt-0.5">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </div>

      {/* Location badge */}
      <div className="flex items-center gap-2">
        {geoLoading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-white/40"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Detecting location…</span>
        ) : geo.verified ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/25" data-testid="badge-location-verified">
            <MapPin className="w-3.5 h-3.5" /> Location Verified
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/25" data-testid="badge-location-unavailable">
            <AlertTriangle className="w-3.5 h-3.5" /> Location Unavailable
          </span>
        )}
      </div>

      {/* Policy info strip */}
      {policy && (() => {
        const isDefault = policy.policyName === "System Default";
        return (
          <div
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-xl border text-xs ${
              isDefault
                ? "border-amber-500/25 bg-amber-500/5 text-white/50"
                : "border-[#8b5cf6]/20 bg-[#8b5cf6]/5 text-white/50"
            }`}
            data-testid="banner-attendance-policy"
          >
            <span className={`flex items-center gap-1.5 font-semibold ${isDefault ? "text-amber-400" : "text-[#8b5cf6]"}`}>
              <Timer className="w-3.5 h-3.5" />
              {policy.policyName}
              {isDefault && <span className="font-normal text-amber-400/70 text-[10px]">(no policy set by admin)</span>}
            </span>
            <span>Expected: <strong className="text-white/70">{policy.expectedArrivalTime}</strong></span>
            {policy.gracePeriodMinutes > 0 && <span>· Grace: <strong className="text-white/70">{policy.gracePeriodMinutes}m</strong></span>}
            <span>· Half-day after: <strong className="text-white/70">{policy.halfDayCutoffTime}</strong></span>
            {policy.schoolEndTime && (
              <span>· School ends: <strong className="text-red-400/80">{policy.schoolEndTime}</strong></span>
            )}
            <span>· Target: <strong className="text-white/70">{policy.attendanceTarget}%</strong></span>
          </div>
        );
      })()}

      {/* ── Today's Shift Card ── */}
      <div className="rounded-2xl border border-white/10 bg-[#1A2942] p-5 space-y-4" data-testid="card-shift">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Today's Shift</p>
          {todayRec?.checkInTime && todayRec.status && (() => {
            const sc = statusColors(todayRec.status);
            return (
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${sc.badge}`}>
                <CheckCircle className="w-3 h-3" /> {todayRec.status}
              </span>
            );
          })()}
        </div>

        {todayLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-white/5" />
        ) : shiftState === "unmarked" ? (
          <div className="text-center py-4 space-y-3">
            {isSchoolOver && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-left mb-2">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">
                  School day ended at <strong>{policy?.schoolEndTime}</strong>. Checking in now will record your attendance as <strong>Leave</strong>.
                </p>
              </div>
            )}
            <p className="text-white/40 text-sm">Not Checked In</p>
            <button
              onClick={() => checkInMut.mutate()}
              disabled={checkInMut.isPending}
              className={`relative inline-flex items-center gap-2 px-8 py-3 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-60 ${
                isSchoolOver
                  ? "bg-slate-600 hover:bg-slate-500 text-white"
                  : "bg-emerald-500 hover:bg-emerald-400 text-white"
              }`}
              data-testid="button-check-in"
            >
              {!isSchoolOver && <span className="absolute -inset-1 rounded-xl bg-emerald-500/30 animate-ping opacity-75" />}
              {checkInMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {isSchoolOver ? "Record as Leave" : "Check In"}
            </button>
          </div>
        ) : shiftState === "leave" ? (
          <div className="text-center py-4 space-y-2">
            <div className="w-12 h-12 mx-auto rounded-full bg-slate-500/10 flex items-center justify-center">
              <LogOut className="w-5 h-5 text-slate-400" />
            </div>
            <p className="text-sm font-semibold text-slate-300">Marked as Leave</p>
            <p className="text-xs text-white/30">
              Check-in was recorded after school end time ({policy?.schoolEndTime ?? "—"}).
            </p>
            {todayRec?.checkInTime && (
              <p className="text-[11px] text-white/20">Recorded at {fmtTime(todayRec.checkInTime)}</p>
            )}
          </div>
        ) : shiftState === "active" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/5 p-3 text-center">
                <p className="text-xs text-white/40 mb-1">Check-In</p>
                <p className="text-lg font-bold text-emerald-400 tabular-nums">{fmtTime(todayRec!.checkInTime)}</p>
              </div>
              <div className="rounded-xl bg-white/5 p-3 text-center">
                <p className="text-xs text-white/40 mb-1">Working</p>
                <p className="text-lg font-bold text-sky-400 tabular-nums" data-testid="text-elapsed">{fmtElapsed(elapsed)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-emerald-400/80">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              Shift Active
            </div>
            <button
              onClick={() => checkOutMut.mutate()}
              disabled={checkOutMut.isPending}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 font-semibold text-sm hover:bg-red-500/30 transition-all active:scale-95 disabled:opacity-60"
              data-testid="button-check-out"
            >
              {checkOutMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              Check Out
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-white/5 p-3 text-center">
                <p className="text-[10px] text-white/40 mb-1">Check-In</p>
                <p className="text-sm font-bold text-emerald-400 tabular-nums">{fmtTime(todayRec!.checkInTime)}</p>
              </div>
              <div className="rounded-xl bg-white/5 p-3 text-center">
                <p className="text-[10px] text-white/40 mb-1">Check-Out</p>
                <p className="text-sm font-bold text-red-400 tabular-nums">{fmtTime(todayRec!.checkOutTime)}</p>
              </div>
              <div className="rounded-xl bg-white/5 p-3 text-center">
                <p className="text-[10px] text-white/40 mb-1">Duration</p>
                <p className="text-sm font-bold text-sky-400">{fmtDuration(todayRec!.totalWorkingMinutes)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/50">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Shift completed for today
            </div>
          </div>
        )}
      </div>

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-2 gap-3" data-testid="section-kpi">
        {[
          { label: "Attendance Rate", value: `${kpi.rate}%`, icon: TrendingUp, color: "text-[#D4AF37]", bg: "bg-[#D4AF37]/10" },
          { label: "Present (Month)", value: kpi.present, icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Absent Days",     value: kpi.absent,  icon: Clock,       color: "text-red-400",    bg: "bg-red-500/10"    },
          { label: "Avg Duration",    value: fmtDuration(kpi.avgDur), icon: BarChart2, color: "text-sky-400", bg: "bg-sky-500/10" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-xl border border-white/10 bg-[#1A2942] p-4" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
            <div className={`inline-flex p-2 rounded-lg ${bg} mb-2`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
            <p className="text-white/40 text-xs mt-0.5 leading-tight">{label}</p>
          </div>
        ))}
      </div>

      {/* Streak Card */}
      <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 flex items-center gap-4" data-testid="card-streak">
        <div className="p-2.5 rounded-xl bg-orange-500/15">
          <Flame className="w-5 h-5 text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-white/40">Attendance Streak</p>
          <p className="font-bold text-white"><span className="text-orange-400 text-lg">{kpi.streak}</span> <span className="text-white/50 text-sm">current</span> &nbsp; <span className="text-[#D4AF37] text-lg">{kpi.longest}</span> <span className="text-white/50 text-sm">longest</span></p>
        </div>
        <p className="text-[10px] text-white/30 text-right leading-tight">Consecutive<br/>workdays</p>
      </div>

      {/* ── Timeline / Calendar toggle ── */}
      <div className="flex rounded-xl overflow-hidden border border-white/10 bg-white/5 p-0.5 gap-0.5" data-testid="tab-toggle">
        {(["timeline", "calendar"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${activeTab === tab ? "bg-[#D4AF37] text-[#0A1628]" : "text-white/50 hover:text-white"}`}
            data-testid={`tab-${tab}`}
          >
            {tab === "timeline" ? <Clock className="w-3.5 h-3.5" /> : <Calendar className="w-3.5 h-3.5" />}
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ── 7-Day Timeline ── */}
      {activeTab === "timeline" && (
        <div className="space-y-2" data-testid="section-timeline">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider px-1">Last 7 Days</p>
          {(historyLoading && !history.length) ? (
            Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />)
          ) : (
            timeline.map(({ dateStr, label, isToday, isWeekend: wk, rec }) => {
              const s = rec ? statusColors(rec.status) : statusColors("Not Marked");
              return (
                <div
                  key={dateStr}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors ${isToday ? "border-[#D4AF37]/30 bg-[#D4AF37]/5" : "border-white/5 bg-white/3"}`}
                  data-testid={`timeline-day-${dateStr}`}
                >
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${wk ? "bg-white/15" : s.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isToday ? "text-[#D4AF37]" : "text-white"}`}>
                      {label}{isToday && <span className="ml-1.5 text-[10px] text-[#D4AF37]/70">Today</span>}
                    </p>
                    {wk ? (
                      <p className="text-xs text-white/30">Weekend</p>
                    ) : rec?.checkInTime ? (
                      <p className="text-xs text-white/40 tabular-nums">{fmtTime(rec.checkInTime)}{rec.checkOutTime ? ` – ${fmtTime(rec.checkOutTime)}` : " (active)"} · {fmtDuration(rec.totalWorkingMinutes)}</p>
                    ) : (
                      <p className="text-xs text-white/25">—</p>
                    )}
                  </div>
                  {!wk && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${s.badge} flex-shrink-0`}>
                      {rec?.status ?? "—"}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Monthly Calendar ── */}
      {activeTab === "calendar" && (
        <div className="rounded-2xl border border-white/10 bg-[#1A2942] p-4 space-y-3" data-testid="section-calendar">
          <p className="text-sm font-semibold text-white text-center">
            {new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </p>
          <div className="grid grid-cols-7 gap-px">
            {["S","M","T","W","T","F","S"].map((d, i) => (
              <div key={i} className="text-center text-[10px] font-bold text-white/30 py-1">{d}</div>
            ))}
            {calDays.map((cell, i) => {
              if (!cell) return <div key={`e-${i}`} />;
              const s = cell.rec ? statusColors(cell.rec.status) : null;
              return (
                <div key={cell.dateStr} className={`flex flex-col items-center py-1.5 rounded-lg ${cell.isToday ? "bg-[#D4AF37]/15 ring-1 ring-[#D4AF37]/40" : ""}`}>
                  <span className={`text-xs font-medium ${cell.isToday ? "text-[#D4AF37]" : cell.isWeekend ? "text-white/25" : "text-white/70"}`}>{cell.d}</span>
                  {s && !cell.isWeekend && (
                    <div className={`w-1.5 h-1.5 rounded-full mt-0.5 ${s.dot}`} />
                  )}
                  {!s && !cell.isWeekend && cell.dateStr < today && (
                    <div className="w-1.5 h-1.5 rounded-full mt-0.5 bg-white/10" />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 pt-1 justify-center">
            {[["Present","bg-emerald-400"],["Late","bg-amber-400"],["Absent","bg-red-400"]].map(([label, cls]) => (
              <div key={label} className="flex items-center gap-1.5 text-[10px] text-white/50">
                <div className={`w-2 h-2 rounded-full ${cls}`} /> {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Corrections ── */}
      <div className="space-y-3" data-testid="section-corrections">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider px-1">Correction Requests</p>
        {correctionsLoading ? (
          <div className="h-16 animate-pulse rounded-xl bg-white/5" />
        ) : corrections.length === 0 ? (
          <div className="rounded-xl border border-white/5 bg-white/3 py-8 text-center">
            <p className="text-sm text-white/30">No correction requests yet</p>
          </div>
        ) : (
          corrections.slice(0, 5).map(c => (
            <div key={c.id} className="rounded-xl border border-white/10 bg-[#1A2942] px-4 py-3" data-testid={`correction-${c.id}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-sm font-medium text-white">{getDayLabel(c.attendanceDate)}</p>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${correctionStatusStyle(c.status)}`}>{c.status}</span>
              </div>
              <p className="text-xs text-white/50">{c.requestedCheckIn} – {c.requestedCheckOut}</p>
              <p className="text-xs text-white/30 mt-0.5 truncate">{c.reason}</p>
            </div>
          ))
        )}
      </div>

      {/* ── Correction Request Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4 pb-4" data-testid="modal-correction">
          <div className="w-full max-w-md rounded-2xl bg-[#0A1628] border border-white/15 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">Correct Attendance</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-white/40">Changes apply immediately. Allowed within the last 7 days only.</p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/60 mb-1 block">Attendance Date</label>
                <input type="date" value={corrForm.date} min={sevenAgo} max={today}
                  onChange={e => setCorrForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full rounded-xl bg-white/5 border border-white/15 text-white text-sm px-3 py-2 focus:outline-none focus:border-white/30"
                  style={{ colorScheme: "dark" }} data-testid="input-correction-date" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Check-In Time</label>
                  <input type="time" value={corrForm.checkIn}
                    onChange={e => setCorrForm(f => ({ ...f, checkIn: e.target.value }))}
                    className="w-full rounded-xl bg-white/5 border border-white/15 text-white text-sm px-3 py-2 focus:outline-none focus:border-white/30"
                    style={{ colorScheme: "dark" }} data-testid="input-correction-checkin" />
                </div>
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Check-Out Time</label>
                  <input type="time" value={corrForm.checkOut}
                    onChange={e => setCorrForm(f => ({ ...f, checkOut: e.target.value }))}
                    className="w-full rounded-xl bg-white/5 border border-white/15 text-white text-sm px-3 py-2 focus:outline-none focus:border-white/30"
                    style={{ colorScheme: "dark" }} data-testid="input-correction-checkout" />
                </div>
              </div>
              <div>
                <label className="text-xs text-white/60 mb-1 block">Reason</label>
                <textarea rows={3} value={corrForm.reason} placeholder="Explain why you need this correction…"
                  onChange={e => setCorrForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full rounded-xl bg-white/5 border border-white/15 text-white text-sm px-3 py-2 focus:outline-none focus:border-white/30 placeholder:text-white/25 resize-none"
                  data-testid="input-correction-reason" />
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-xl border border-white/15 text-white/60 text-sm hover:bg-white/5 transition-colors">Cancel</button>
              <button
                onClick={() => corrMut.mutate()}
                disabled={corrMut.isPending || !corrForm.date || !corrForm.checkIn || !corrForm.checkOut || !corrForm.reason.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#D4AF37] text-[#0A1628] font-bold text-sm hover:bg-[#c49f2e] transition-colors disabled:opacity-50"
                data-testid="button-submit-correction"
              >
                {corrMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Apply Correction"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
