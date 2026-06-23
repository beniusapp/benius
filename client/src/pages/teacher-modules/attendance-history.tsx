import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Calendar, Clock, Flame, TrendingUp, CheckCircle,
  AlertTriangle, UserX, BarChart2, FileSpreadsheet, Printer,
  ChevronLeft, ChevronRight, History,
} from "lucide-react";
import type { TeacherMe } from "@/pages/teacher-dashboard";

/* ── Types ────────────────────────────────────────────────────────── */

interface HistRecord {
  id: number;
  attendanceDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: string;
  totalWorkingMinutes: number;
  locationVerified: boolean;
}

interface HistSummary {
  present: number; late: number; halfDay: number;
  absent: number; leave: number;
  totalWorkingMinutes: number; avgWorkingMinutes: number;
}

interface HistStats {
  attendanceRate: number; streak: number; longestStreak: number;
  totalWorkingHours: number; avgDailyHours: number;
}

interface HistResponse {
  records: HistRecord[];
  summary: HistSummary;
  statistics: HistStats;
  pagination: { page: number; pageSize: number; totalRecords: number; totalPages: number };
}

/* Full day entry — merges DB records + generated absent/weekend entries */
interface DayEntry {
  dateStr: string;
  isWeekend: boolean;
  isFuture: boolean;
  record: HistRecord | null;
  effectiveStatus: string;
}

type TabView = "daily" | "weekly" | "monthly";

/* ── Helpers ──────────────────────────────────────────────────────── */

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtDuration(mins: number): string {
  if (!mins || mins <= 0) return "—";
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDateShort(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function fmtDateFull(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "short", year: "numeric",
  });
}

function dayName(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-IN", { weekday: "long" });
}

function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}

function weekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString("en-CA");
}

function statusCfg(s: string) {
  switch (s) {
    case "Present":   return { dot: "bg-emerald-400", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", rowBorder: "border-emerald-500/10" };
    case "Late":      return { dot: "bg-amber-400",   badge: "bg-amber-500/20   text-amber-300   border-amber-500/30",   rowBorder: "border-amber-500/10"   };
    case "Half Day":  return { dot: "bg-orange-400",  badge: "bg-orange-500/20  text-orange-300  border-orange-500/30",  rowBorder: "border-orange-500/10"  };
    case "Absent":    return { dot: "bg-red-400",     badge: "bg-red-500/20     text-red-300     border-red-500/30",     rowBorder: "border-red-500/10"     };
    case "Leave":     return { dot: "bg-slate-400",   badge: "bg-slate-500/20  text-slate-300   border-slate-500/30",   rowBorder: "border-slate-500/10"   };
    case "Weekend":   return { dot: "bg-sky-400/30",    badge: "bg-sky-500/10    text-sky-300/60    border-sky-500/10",     rowBorder: "border-white/5"         };
    case "Holiday":   return { dot: "bg-blue-400",     badge: "bg-blue-500/20   text-blue-300      border-blue-500/30",    rowBorder: "border-blue-500/10"    };
    case "Scheduled": return { dot: "bg-violet-400/50",badge: "bg-violet-500/10 text-violet-300/70 border-violet-500/20",  rowBorder: "border-violet-500/5"   };
    default:          return { dot: "bg-white/15",     badge: "bg-white/5       text-white/30      border-white/10",       rowBorder: "border-white/5"        };
  }
}

/** Build a complete day-by-day list for the date range, filling absent/weekend entries */
function buildDayList(from: string, to: string, dbRecords: HistRecord[]): DayEntry[] {
  const today  = localToday();
  // Normalize attendanceDate — defensive slice(0,10) handles any ISO datetime leak
  const recMap = new Map(dbRecords.map(r => [String(r.attendanceDate).slice(0, 10), r]));
  const list: DayEntry[] = [];

  const start = new Date(from + "T12:00:00");
  const end   = new Date(to   + "T12:00:00");

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toLocaleDateString("en-CA");
    const dow     = d.getDay();
    const isWk    = dow === 0 || dow === 6;
    const isFut   = dateStr > today;
    const record  = recMap.get(dateStr) ?? null;

    let effectiveStatus: string;
    if (isWk)        effectiveStatus = "Weekend";
    else if (isFut)  effectiveStatus = "Scheduled";
    else if (record) effectiveStatus = record.status ?? "Not Marked";
    else             effectiveStatus = "Absent";

    list.push({ dateStr, isWeekend: isWk, isFuture: isFut, record, effectiveStatus });
  }

  return list.reverse(); // most-recent first
}

/* ── CSV Export ───────────────────────────────────────────────────── */
function exportCSV(teacherName: string, period: string, days: DayEntry[]) {
  const rows = days
    .filter(d => !d.isFuture && d.effectiveStatus !== "Weekend" && d.effectiveStatus !== "Scheduled")
    .map(d => [
      d.dateStr,
      dayName(d.dateStr),
      fmtTime(d.record?.checkInTime),
      fmtTime(d.record?.checkOutTime),
      fmtDuration(d.record?.totalWorkingMinutes ?? 0),
      d.effectiveStatus,
    ]);

  const headers = ["Date", "Day", "Check In", "Check Out", "Duration", "Status"];
  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), {
    href: url,
    download: `attendance_${teacherName.replace(/\s+/g, "_")}_${period.replace(/\s+/g, "_")}.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

/* ── PDF Export ───────────────────────────────────────────────────── */
function exportPDF(teacherName: string, period: string, days: DayEntry[]) {
  const statusColor: Record<string, string> = {
    Present: "#10b981", Late: "#f59e0b", "Half Day": "#f97316",
    Absent: "#ef4444", Leave: "#6b7280", Weekend: "#888",
  };

  const tableRows = days
    .filter(d => !d.isFuture && d.effectiveStatus !== "Scheduled")
    .map(d => {
      const c = statusColor[d.effectiveStatus] ?? "#888";
      return `<tr>
        <td>${d.dateStr}</td>
        <td>${dayName(d.dateStr)}</td>
        <td>${fmtTime(d.record?.checkInTime)}</td>
        <td>${fmtTime(d.record?.checkOutTime)}</td>
        <td>${fmtDuration(d.record?.totalWorkingMinutes ?? 0)}</td>
        <td style="color:${c};font-weight:600">${d.effectiveStatus}</td>
      </tr>`;
    }).join("");

  const html = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>Attendance History — ${teacherName}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; color: #1a1a2e; }
      h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
      .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      thead th { background: #0A1628; color: #fff; padding: 10px 12px; text-align: left; font-weight: 600; }
      tbody td { padding: 8px 12px; border-bottom: 1px solid #eee; }
      tbody tr:nth-child(even) td { background: #f8fafc; }
      @media print {
        body { padding: 0; }
        button { display: none; }
      }
    </style>
  </head><body>
    <h1>Attendance History — ${teacherName}</h1>
    <p class="meta">Period: ${period} &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString("en-IN")}</p>
    <table>
      <thead><tr>
        <th>Date</th><th>Day</th><th>Check In</th><th>Check Out</th><th>Duration</th><th>Status</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </body></html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

/* ── Skeleton ─────────────────────────────────────────────────────── */
function HistSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[72px] rounded-2xl bg-white/5 animate-pulse" />
      ))}
    </div>
  );
}

/* ── Stat Card ────────────────────────────────────────────────────── */
type IconComp = React.ComponentType<{ className?: string }>;

function StatCard({ label, value, color, bg, icon: Icon }: {
  label: string; value: string | number; color: string; bg: string; icon: IconComp;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#1A2942] p-4">
      <div className={`inline-flex p-2 rounded-xl ${bg} mb-2`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <p className={`text-2xl font-bold tabular-nums leading-none ${color}`}>{value}</p>
      <p className="text-white/40 text-[11px] mt-1 leading-tight">{label}</p>
    </div>
  );
}

/* ── Day Card ─────────────────────────────────────────────────────── */
function DayCard({ entry }: { entry: DayEntry }) {
  const cfg = statusCfg(entry.effectiveStatus);
  return (
    <div
      className={`rounded-2xl border ${cfg.rowBorder} bg-[#1A2942] p-4 transition-colors ${entry.isFuture ? "opacity-60" : ""}`}
      data-testid={`hist-day-${entry.dateStr}`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-2.5 h-2.5 rounded-full mt-[5px] flex-shrink-0 ${cfg.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-white leading-tight">{fmtDateShort(entry.dateStr)}</p>
              <p className="text-[11px] text-white/30 mt-0.5">{dayName(entry.dateStr)}</p>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border flex-shrink-0 ${cfg.badge}`}>
              {entry.effectiveStatus}
            </span>
          </div>
          {!entry.isWeekend && !entry.isFuture && entry.record && (
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-white/45">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {fmtTime(entry.record.checkInTime)}
                {entry.record.checkOutTime ? ` → ${fmtTime(entry.record.checkOutTime)}` : " (active)"}
              </span>
              {entry.record.totalWorkingMinutes > 0 && (
                <span className="text-[#D4AF37]/80 font-medium">{fmtDuration(entry.record.totalWorkingMinutes)}</span>
              )}
            </div>
          )}
          {!entry.isWeekend && !entry.isFuture && !entry.record && (
            <p className="mt-1.5 text-xs text-white/20">No check-in recorded</p>
          )}
          {entry.isFuture && !entry.isWeekend && (
            <p className="mt-1.5 text-xs text-violet-300/40 italic">Upcoming school day</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Monthly Calendar Grid ────────────────────────────────────────── */
function MonthCalendar({ year, month, dayList }: { year: number; month: number; dayList: DayEntry[] }) {
  const today  = localToday();
  const dayMap = new Map(dayList.map(d => [d.dateStr, d]));
  const first  = new Date(year, month - 1, 1);
  const last   = new Date(year, month, 0);

  const cells: Array<{ day: number; dateStr: string } | null> = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push({
      day:     d,
      dateStr: `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    });
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#1A2942] p-4 space-y-3">
      <div className="grid grid-cols-7 gap-px">
        {["S","M","T","W","T","F","S"].map((h, i) => (
          <div key={i} className="text-center text-[10px] font-bold text-white/30 py-1">{h}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e-${i}`} />;
          const entry   = dayMap.get(cell.dateStr);
          const cfg     = entry ? statusCfg(entry.effectiveStatus) : null;
          const isToday = cell.dateStr === today;
          const isPast  = cell.dateStr < today;
          const isWk    = new Date(cell.dateStr + "T12:00:00").getDay() % 6 === 0;
          return (
            <div
              key={cell.dateStr}
              title={entry?.effectiveStatus}
              className={`flex flex-col items-center py-1.5 rounded-lg ${isToday ? "bg-[#D4AF37]/15 ring-1 ring-[#D4AF37]/40" : ""}`}
            >
              <span className={`text-[11px] font-medium ${isToday ? "text-[#D4AF37]" : isWk ? "text-white/25" : "text-white/65"}`}>
                {cell.day}
              </span>
              {cfg && !entry?.isWeekend && !entry?.isFuture && (
                <div className={`w-1.5 h-1.5 rounded-full mt-0.5 ${cfg.dot}`} />
              )}
              {!cfg && !isWk && isPast && (
                <div className="w-1.5 h-1.5 rounded-full mt-0.5 bg-red-400/35" title="Absent" />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 justify-center pt-1 border-t border-white/5">
        {[["Present","bg-emerald-400"],["Late","bg-amber-400"],["Half Day","bg-orange-400"],
          ["Absent","bg-red-400/40"],["Leave","bg-slate-400"],["Weekend","bg-sky-400/30"]].map(([lbl, cls]) => (
          <div key={lbl} className="flex items-center gap-1.5 text-[10px] text-white/45">
            <div className={`w-2 h-2 rounded-full ${cls}`} /> {lbl}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Status Filter Pills ──────────────────────────────────────────── */
type StatusFilter = "all" | "Present" | "Late" | "Half Day" | "Absent" | "Leave" | "Scheduled" | "Weekend";

const STATUS_PILLS: { value: StatusFilter; label: string; active: string }[] = [
  { value: "all",        label: "All",        active: "bg-white/20 text-white border-white/30" },
  { value: "Present",    label: "Present",    active: "bg-emerald-500/30 text-emerald-200 border-emerald-500/50" },
  { value: "Late",       label: "Late",       active: "bg-amber-500/30 text-amber-200 border-amber-500/50" },
  { value: "Half Day",   label: "Half Day",   active: "bg-orange-500/30 text-orange-200 border-orange-500/50" },
  { value: "Absent",     label: "Absent",     active: "bg-red-500/30 text-red-200 border-red-500/50" },
  { value: "Leave",      label: "Leave",      active: "bg-slate-500/30 text-slate-200 border-slate-500/50" },
  { value: "Scheduled",  label: "Upcoming",   active: "bg-violet-500/30 text-violet-200 border-violet-500/50" },
];

/* ════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════ */
export default function AttendanceHistoryView({ teacher, onBack }: { teacher: TeacherMe; onBack: () => void }) {
  const today = localToday();

  const [tab, setTab]             = useState<TabView>("daily");
  const [statusFilter, setStatus] = useState<StatusFilter>("all");

  /* Daily — default: last 30 days → end of current month (includes future) */
  const [fromDate, setFromDate] = useState(() => addDays(today, -29));
  const [toDate,   setToDate]   = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth() + 1, 0).toLocaleDateString("en-CA");
  });

  /* Weekly */
  const [weekStart, setWeekStart] = useState(() => weekMonday(today));
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  /* Monthly */
  const [selMonth, setSelMonth] = useState(() => new Date().getMonth() + 1);
  const [selYear,  setSelYear]  = useState(() => new Date().getFullYear());

  /* Effective date range for the API query */
  const { eff_from, eff_to } = useMemo(() => {
    if (tab === "daily")  return { eff_from: fromDate, eff_to: toDate };
    if (tab === "weekly") return { eff_from: weekStart, eff_to: weekEnd };
    const startM = `${selYear}-${String(selMonth).padStart(2, "0")}-01`;
    const endM   = new Date(selYear, selMonth, 0).toLocaleDateString("en-CA");
    return { eff_from: startM, eff_to: endM };
  }, [tab, fromDate, toDate, weekStart, weekEnd, selMonth, selYear]);

  // Use the default fetcher (queryKey[0] is the exact fetch URL) so credentials
  // and error handling are handled uniformly. staleTime:0 ensures today's
  // check-in is always reflected the moment the history view is opened.
  const apiUrl = `/api/teacher/attendance/history?fromDate=${eff_from}&toDate=${eff_to}&pageSize=200`;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<HistResponse>({
    queryKey: [apiUrl],
    staleTime: 0,
  });

  const dbRecords = data?.records ?? [];
  const stats     = data?.statistics;

  /* Full day list for the current range */
  const allDays = useMemo(() => buildDayList(eff_from, eff_to, dbRecords), [eff_from, eff_to, dbRecords]);

  /* Client-side summary computed from the full day list */
  const clientSummary = useMemo(() => {
    const wkDays = allDays.filter(d => !d.isWeekend && !d.isFuture);
    const totalMins = wkDays.reduce((s, d) => s + (d.record?.totalWorkingMinutes ?? 0), 0);
    const workedDays = wkDays.filter(d => (d.record?.totalWorkingMinutes ?? 0) > 0).length;
    return {
      present:  wkDays.filter(d => d.effectiveStatus === "Present").length,
      late:     wkDays.filter(d => d.effectiveStatus === "Late").length,
      halfDay:  wkDays.filter(d => d.effectiveStatus === "Half Day").length,
      absent:   wkDays.filter(d => d.effectiveStatus === "Absent").length,
      leave:    wkDays.filter(d => d.effectiveStatus === "Leave").length,
      totalMins,
      avgMins:  workedDays > 0 ? Math.round(totalMins / workedDays) : 0,
    };
  }, [allDays]);

  const attendanceRate = useMemo(() => {
    const att = clientSummary.present + clientSummary.late + clientSummary.halfDay;
    const tot = att + clientSummary.absent + clientSummary.leave;
    return tot > 0 ? Math.round((att / tot) * 100) : 0;
  }, [clientSummary]);

  /* Apply status filter — future "Scheduled" days are included and visible */
  const filteredDays = useMemo(() => {
    if (statusFilter === "all") return allDays;
    return allDays.filter(d => d.effectiveStatus === statusFilter);
  }, [allDays, statusFilter]);

  const periodLabel = useMemo(() => {
    if (tab === "daily")  return `${fromDate} to ${toDate}`;
    if (tab === "weekly") return `Week ${fmtDateShort(weekStart)} – ${fmtDateShort(weekEnd)}`;
    return new Date(selYear, selMonth - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }, [tab, fromDate, toDate, weekStart, weekEnd, selMonth, selYear]);

  /* ── Week navigation — allow up to 3 months ahead ── */
  const maxFutureWeek = addDays(today, 90);
  const canNextWeek   = addDays(weekStart, 7) <= maxFutureWeek;
  function prevWeek() { setWeekStart(w => addDays(w, -7)); }
  function nextWeek() { if (canNextWeek) setWeekStart(w => addDays(w, 7)); }

  /* ── Month navigation — allow up to 12 months ahead ── */
  const maxFutureMonth = (() => { const d = new Date(); d.setMonth(d.getMonth() + 12); return d; })();
  const canNextMonth   = new Date(selYear, selMonth, 1) <= maxFutureMonth;
  function prevMonth() {
    if (selMonth === 1) { setSelMonth(12); setSelYear(y => y - 1); }
    else setSelMonth(m => m - 1);
  }
  function nextMonth() {
    if (!canNextMonth) return;
    if (selMonth === 12) { setSelMonth(1); setSelYear(y => y + 1); }
    else setSelMonth(m => m + 1);
  }

  /* ── Tab change resets filter ── */
  function handleTabChange(t: TabView) {
    setTab(t);
    setStatus("all");
  }

  /* ─────────────────────── RENDER ─────────────────────── */
  return (
    <div className="space-y-4" data-testid="attendance-history-view">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors"
          data-testid="button-back-history"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-white">Attendance History</h2>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          title="Refresh"
          className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
          data-testid="button-refresh-history"
        >
          <History className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex rounded-2xl overflow-hidden border border-white/10 bg-white/5 p-0.5 gap-0.5" data-testid="tab-bar-history">
        {(["daily", "weekly", "monthly"] as TabView[]).map(t => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold capitalize transition-all ${
              tab === t ? "bg-[#D4AF37] text-[#0A1628] shadow-sm" : "text-white/50 hover:text-white/80"
            }`}
            data-testid={`tab-${t}`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Period Picker (view-specific) ── */}
      {tab === "daily" && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-white/50 font-medium">From</label>
            <input type="date" value={fromDate} max={toDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-full rounded-xl bg-white/5 border border-white/15 text-white text-sm px-3 py-2 focus:outline-none focus:border-[#D4AF37]/50"
              style={{ colorScheme: "dark" }} data-testid="input-history-from" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-white/50 font-medium">To</label>
            <input type="date" value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="w-full rounded-xl bg-white/5 border border-white/15 text-white text-sm px-3 py-2 focus:outline-none focus:border-[#D4AF37]/50"
              style={{ colorScheme: "dark" }} data-testid="input-history-to" />
          </div>
        </div>
      )}

      {tab === "weekly" && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center justify-between gap-3">
          <button onClick={prevWeek}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            data-testid="button-prev-week">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">Week of {fmtDateShort(weekStart)}</p>
            <p className="text-[11px] text-white/40 mt-0.5">{fmtDateShort(weekStart)} – {fmtDateShort(weekEnd)}</p>
          </div>
          <button onClick={nextWeek} disabled={!canNextWeek}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid="button-next-week">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {tab === "monthly" && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center justify-between gap-3">
          <button onClick={prevMonth}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            data-testid="button-prev-month">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <p className="text-sm font-semibold text-white">
            {new Date(selYear, selMonth - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </p>
          <button onClick={nextMonth} disabled={!canNextMonth}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid="button-next-month">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Status Filter Pills ── */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none" data-testid="status-filter-pills">
        {STATUS_PILLS.map(p => (
          <button key={p.value} onClick={() => setStatus(p.value)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              statusFilter === p.value ? p.active : "bg-white/5 border-white/10 text-white/40 hover:text-white/70 hover:border-white/20"
            }`}
            data-testid={`pill-${p.value}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Export Actions ── */}
      <div className="flex gap-2">
        <button
          onClick={() => exportCSV(teacher.fullName, periodLabel, statusFilter === "all" ? allDays : filteredDays)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25 transition-colors"
          data-testid="button-export-excel"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
        </button>
        <button
          onClick={() => exportPDF(teacher.fullName, periodLabel, statusFilter === "all" ? allDays : filteredDays)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-semibold hover:bg-sky-500/25 transition-colors"
          data-testid="button-export-pdf"
        >
          <Printer className="w-3.5 h-3.5" /> Export PDF
        </button>
      </div>

      {/* ── Content ── */}
      {isError && (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-center space-y-2" data-testid="error-history">
          <p className="text-sm text-red-300 font-medium">Failed to load attendance data</p>
          <button onClick={() => refetch()} className="text-xs text-red-300/70 underline underline-offset-2">Tap to retry</button>
        </div>
      )}
      {isLoading ? <HistSkeleton /> : isError ? null : (

        /* ═══════════════ DAILY VIEW ═══════════════ */
        tab === "daily" ? (
          <div className="space-y-3" data-testid="view-daily">
            {filteredDays.length === 0 ? (
              <div className="text-center py-16 text-white/30" data-testid="empty-daily">
                <Calendar className="w-10 h-10 mx-auto mb-3 opacity-25" />
                <p className="text-sm font-medium">No attendance records found.</p>
                <p className="text-xs mt-1 opacity-60">Try adjusting the date range or filter.</p>
              </div>
            ) : (
              filteredDays.map(d => <DayCard key={d.dateStr} entry={d} />)
            )}
          </div>

        /* ═══════════════ WEEKLY VIEW ═══════════════ */
        ) : tab === "weekly" ? (
          <div className="space-y-4" data-testid="view-weekly">
            {/* Summary stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Present Days"    value={clientSummary.present}  color="text-emerald-400" bg="bg-emerald-500/10" icon={CheckCircle} />
              <StatCard label="Late Arrivals"   value={clientSummary.late}     color="text-amber-400"   bg="bg-amber-500/10"   icon={AlertTriangle} />
              <StatCard label="Half Days"       value={clientSummary.halfDay}  color="text-orange-400"  bg="bg-orange-500/10"  icon={Clock} />
              <StatCard label="Absent Days"     value={clientSummary.absent}   color="text-red-400"     bg="bg-red-500/10"     icon={UserX} />
              <StatCard label="Leave Days"      value={clientSummary.leave}    color="text-slate-400"   bg="bg-slate-500/10"   icon={Calendar} />
              <StatCard
                label="Total Working Hrs"
                value={clientSummary.totalMins > 0 ? `${(clientSummary.totalMins / 60).toFixed(1)}h` : "—"}
                color="text-[#D4AF37]" bg="bg-[#D4AF37]/10" icon={BarChart2}
              />
            </div>
            {/* Day list */}
            <div className="space-y-2">
              {filteredDays.length === 0 ? (
                <div className="text-center py-10 text-white/30" data-testid="empty-weekly">
                  <Calendar className="w-8 h-8 mx-auto mb-2 opacity-25" />
                  <p className="text-sm">No records match this filter.</p>
                </div>
              ) : (
                filteredDays.map(d => <DayCard key={d.dateStr} entry={d} />)
              )}
            </div>
          </div>

        /* ═══════════════ MONTHLY VIEW ═══════════════ */
        ) : (
          <div className="space-y-4" data-testid="view-monthly">
            {/* High-level stat grid */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Attendance Rate"   value={`${attendanceRate}%`}             color="text-[#D4AF37]"   bg="bg-[#D4AF37]/10"   icon={TrendingUp} />
              <StatCard label="Present Days"      value={clientSummary.present}             color="text-emerald-400" bg="bg-emerald-500/10"  icon={CheckCircle} />
              <StatCard label="Absent Days"       value={clientSummary.absent}              color="text-red-400"     bg="bg-red-500/10"      icon={UserX} />
              <StatCard label="Leave Days"        value={clientSummary.leave}               color="text-slate-400"   bg="bg-slate-500/10"    icon={Calendar} />
              <StatCard label="Half Days"         value={clientSummary.halfDay}             color="text-orange-400"  bg="bg-orange-500/10"   icon={Clock} />
              <StatCard label="Late Arrivals"     value={clientSummary.late}                color="text-amber-400"   bg="bg-amber-500/10"    icon={AlertTriangle} />
              <StatCard
                label="Total Working Hrs"
                value={clientSummary.totalMins > 0 ? `${(clientSummary.totalMins / 60).toFixed(1)}h` : "—"}
                color="text-sky-400" bg="bg-sky-500/10" icon={BarChart2}
              />
              <StatCard
                label="Avg Daily Duration"
                value={clientSummary.avgMins > 0 ? fmtDuration(clientSummary.avgMins) : "—"}
                color="text-violet-400" bg="bg-violet-500/10" icon={Clock}
              />
              <StatCard
                label="Attendance Streak"
                value={stats?.streak ?? 0}
                color="text-orange-400" bg="bg-orange-500/10" icon={Flame}
              />
              <StatCard
                label="Longest Streak"
                value={stats?.longestStreak ?? 0}
                color="text-[#D4AF37]" bg="bg-[#D4AF37]/10" icon={TrendingUp}
              />
            </div>
            {/* Calendar grid */}
            <MonthCalendar year={selYear} month={selMonth} dayList={allDays} />
          </div>
        )
      )}
    </div>
  );
}
