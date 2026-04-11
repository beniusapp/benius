import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, Loader2, Calendar, CalendarDays,
  Flame, BookOpen, Award, Star, Repeat, RefreshCw, X, Zap,
} from "lucide-react";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface CalendarEvent {
  id: number;
  title: string;
  date: string;
  eventType: string;
  description: string | null;
  colorCode: string | null;
  isRecurring: boolean;
}

type View = "month" | "week" | "year";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAYS_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/* ── Updated: vibrant opaque colours ── */
const EVENT_TYPES = [
  { value: "holiday",     label: "Holiday",     color: "#dc2626", icon: Flame    },
  { value: "academic",    label: "Academic",    color: "#2563eb", icon: BookOpen },
  { value: "examination", label: "Examination", color: "#2563eb", icon: Award    },
  { value: "event",       label: "Event",       color: "#10b981", icon: Star     },
];

const YEAR_OPTIONS = Array.from({ length: 101 }, (_, i) => 2020 + i);

function getColor(ev: CalendarEvent) {
  if (ev.colorCode) return ev.colorCode;
  return EVENT_TYPES.find(t => t.value === ev.eventType)?.color ?? "#10b981";
}

function buildKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function isTodayFn(y: number, m: number, d: number) {
  const n = new Date();
  return n.getFullYear() === y && n.getMonth() === m && n.getDate() === d;
}

function formatDate(s: string) {
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}

function getWeekStart(d: Date): Date {
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  start.setHours(0,0,0,0);
  return start;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

function EventTypeLabel({ eventType }: { eventType: string }) {
  const et = EVENT_TYPES.find(t => t.value === eventType);
  return <span>{et?.label || eventType}</span>;
}

/* Glassmorphic hover popover */
function HoverEventPopover({ ev, onClose }: { ev: CalendarEvent; onClose: () => void }) {
  const color = getColor(ev);
  const typeLabel = EVENT_TYPES.find(t => t.value === ev.eventType)?.label || ev.eventType;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: 6 }}
      transition={{ duration: 0.13, ease: "easeOut" }}
      className="absolute z-50 bottom-full left-0 mb-2 w-60 rounded-2xl shadow-2xl text-left overflow-hidden"
      style={{
        background: "rgba(10, 22, 40, 0.88)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)`,
      }}
      onMouseLeave={onClose}
    >
      {/* Colour accent bar */}
      <div className="h-1 w-full" style={{ backgroundColor: color }} />
      <div className="p-3.5">
        <p className="text-sm font-bold text-white leading-snug mb-2">{ev.title}</p>
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${color}30`, color }}
          >
            {typeLabel}
          </span>
          {ev.isRecurring && (
            <span className="flex items-center gap-0.5 text-[10px] text-white/40">
              <Repeat className="w-2.5 h-2.5" />
              Recurring
            </span>
          )}
        </div>
        <p className="text-[11px] text-white/50 mb-1">
          {formatDate(ev.date)}
        </p>
        {ev.description && (
          <p className="text-[11px] text-white/60 border-t border-white/10 pt-2 mt-2 leading-relaxed">
            {ev.description}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/* EVENT PILL — solid opaque, white text, glassmorphic hover tooltip */
function EventPill({
  ev,
  size = "sm",
  onClick,
}: {
  ev: CalendarEvent;
  size?: "xs" | "sm";
  onClick?: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = getColor(ev);
  return (
    <div className="relative">
      <div
        className={`rounded-full truncate font-semibold cursor-pointer select-none transition-opacity hover:opacity-90 ${
          size === "xs" ? "px-1.5 py-px text-[9px]" : "px-2 py-0.5 text-[10px]"
        }`}
        style={{ backgroundColor: color, color: "#fff" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onClick}
        data-testid={`event-chip-${ev.id}`}
      >
        {ev.title}
      </div>
      <AnimatePresence>
        {hovered && <HoverEventPopover ev={ev} onClose={() => setHovered(false)} />}
      </AnimatePresence>
    </div>
  );
}

/* AGENDA EVENT ROW — year/agenda view pill with hover popover */
function AgendaEventPill({ ev, onClick }: { ev: CalendarEvent; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const color = getColor(ev);
  return (
    <div className="relative flex-1 min-w-0">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-xl font-semibold text-white text-xs min-w-0 truncate cursor-pointer hover:opacity-90 transition-opacity"
        style={{ backgroundColor: color }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onClick}
        data-testid={`event-chip-${ev.id}`}
      >
        <span className="truncate">{ev.title}</span>
        {ev.isRecurring && <Repeat className="w-3 h-3 text-white/60 shrink-0" />}
      </div>
      <AnimatePresence>
        {hovered && <HoverEventPopover ev={ev} onClose={() => setHovered(false)} />}
      </AnimatePresence>
    </div>
  );
}

export default function CalendarModule({ teacher }: { teacher: TeacherMe }) {
  const now = new Date();
  const [view, setView] = useState<View>("month");
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [weekStart, setWeekStart] = useState(() => getWeekStart(now));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  /* ── Month query — with 60-second auto-refresh ── */
  const monthQuery = useQuery<CalendarEvent[]>({
    queryKey: ["/api/teacher/calendar", month + 1, year],
    queryFn: async () => {
      const r = await fetch(`/api/teacher/calendar?month=${month + 1}&year=${year}`, { credentials:"include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: view === "month",
    staleTime: 30000,
    refetchInterval: 60000,
  });

  /* ── Year query (Week + Year/Agenda views) — with 60-second auto-refresh ── */
  const yearQuery = useQuery<CalendarEvent[]>({
    queryKey: ["/api/teacher/calendar", "year", year],
    queryFn: async () => {
      const r = await fetch(`/api/teacher/calendar?year=${year}`, { credentials:"include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: view === "week" || view === "year",
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const events    = view === "month" ? (monthQuery.data ?? []) : (yearQuery.data ?? []);
  const isLoading = view === "month" ? monthQuery.isLoading   : yearQuery.isLoading;
  const isFetching= view === "month" ? monthQuery.isFetching  : yearQuery.isFetching;
  const isError   = view === "month" ? monthQuery.isError     : yearQuery.isError;

  function refetch() {
    if (view === "month") monthQuery.refetch();
    else yearQuery.refetch();
  }

  /* ── Calendar days for month grid ── */
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [month, year]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach(e => {
      const k = e.date.split("T")[0];
      if (!map[k]) map[k] = [];
      map[k].push(e);
    });
    return map;
  }, [events]);

  /* ── Week view days ── */
  const weekDays = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    }), [weekStart]);

  /* ── Year/Agenda: group by month ── */
  const yearGroupedByMonth = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {};
    events.forEach(ev => {
      const m = new Date(ev.date.split("T")[0] + "T00:00:00").getMonth();
      if (!map[m]) map[m] = [];
      map[m].push(ev);
    });
    return map;
  }, [events]);

  /* ── Mobile agenda (month view) ── */
  const sortedMonthEvents = useMemo(() => events.slice().sort((a,b) => a.date.localeCompare(b.date)), [events]);
  const groupedByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    sortedMonthEvents.forEach(ev => {
      const k = ev.date.split("T")[0];
      if (!map[k]) map[k] = [];
      map[k].push(ev);
    });
    return map;
  }, [sortedMonthEvents]);
  const agendaDates = useMemo(() => Object.keys(groupedByDate).sort(), [groupedByDate]);

  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] ?? []) : [];
  const holidayCount = view === "month" ? events.filter(e => e.eventType === "holiday").length : 0;

  /* ── Navigation ── */
  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => Math.max(2020, y - 1)); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => Math.min(2120, y + 1)); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  }
  function prevWeek() {
    const s = new Date(weekStart); s.setDate(s.getDate() - 7);
    setWeekStart(s); setYear(s.getFullYear()); setSelectedDay(null);
  }
  function nextWeek() {
    const s = new Date(weekStart); s.setDate(s.getDate() + 7);
    setWeekStart(s); setYear(s.getFullYear()); setSelectedDay(null);
  }

  function switchView(v: View) {
    if (v === "week") { const ws = getWeekStart(new Date()); setWeekStart(ws); setYear(ws.getFullYear()); }
    if (v === "month") { /* keep current month/year */ }
    setView(v); setSelectedDay(null);
  }

  function handleDayClick(key: string) {
    setSelectedDay(key);
    if (window.innerWidth < 1024) setBottomSheetOpen(true);
  }

  function goToday() {
    const n = new Date();
    setMonth(n.getMonth()); setYear(n.getFullYear());
    setWeekStart(getWeekStart(n)); setSelectedDay(null);
  }

  /* ── Quick-jump handlers ── */
  function handleMonthJump(m: number) { setMonth(m); setSelectedDay(null); }
  function handleYearJump(y: number) {
    setYear(y);
    if (view === "week") {
      const ws = new Date(weekStart); ws.setFullYear(y);
      setWeekStart(getWeekStart(ws));
    }
    setSelectedDay(null);
  }

  /* ── Nav title ── */
  function navTitle() {
    if (view === "month") return `${MONTHS[month]} ${year}`;
    if (view === "week") {
      const end = weekDays[6];
      const sameMonth = weekDays[0].getMonth() === end.getMonth();
      if (sameMonth) return `${MONTHS_SHORT[weekDays[0].getMonth()]} ${weekDays[0].getDate()}–${end.getDate()}, ${weekDays[0].getFullYear()}`;
      return `${MONTHS_SHORT[weekDays[0].getMonth()]} ${weekDays[0].getDate()} – ${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}, ${weekDays[0].getFullYear()}`;
    }
    return `${year}`;
  }

  if (isError) {
    return (
      <div className="text-center py-12 text-red-400" data-testid="text-calendar-error">
        Failed to load calendar. Please try again.
      </div>
    );
  }

  /* VIEW SWITCHER */
  const viewSwitcher = (
    <div className="flex items-center gap-0.5 bg-white/5 rounded-xl p-1 border border-white/10" data-testid="view-switcher">
      {(["month","week","year"] as View[]).map(v => (
        <button
          key={v}
          onClick={() => switchView(v)}
          data-testid={`button-view-${v}`}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize ${
            view === v
              ? "bg-emerald-500 text-white shadow-md shadow-emerald-900/40"
              : "text-white/40 hover:text-white/70 hover:bg-white/5"
          }`}
        >
          {v === "year" ? "Agenda" : v}
        </button>
      ))}
    </div>
  );

  /* QUICK-JUMP SELECTORS */
  const selectClass = "bg-[#0A1628] border border-white/15 rounded-lg px-2.5 py-1.5 text-sm text-white/80 focus:outline-none focus:border-emerald-500/60 cursor-pointer appearance-none pr-6 hover:border-white/30 transition-colors";

  const quickJump = (
    <div className="flex items-center gap-1.5">
      {view === "month" && (
        <div className="relative">
          <select
            value={month}
            onChange={e => handleMonthJump(parseInt(e.target.value))}
            className={selectClass}
            data-testid="select-month-jump"
            aria-label="Jump to month"
            style={{ backgroundImage: "none" }}
          >
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <ChevronRight className="w-3 h-3 text-white/30 absolute right-1.5 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" />
        </div>
      )}
      <div className="relative">
        <select
          value={year}
          onChange={e => handleYearJump(parseInt(e.target.value))}
          className={selectClass}
          data-testid="select-year-jump"
          aria-label="Jump to year"
          style={{ backgroundImage: "none" }}
        >
          {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <ChevronRight className="w-3 h-3 text-white/30 absolute right-1.5 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" />
      </div>
    </div>
  );

  /* NAV BAR */
  const navBar = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2" data-testid="heading-teacher-calendar">
            <CalendarDays className="w-5 h-5 text-emerald-400" />
            School Calendar
          </h2>
          <p className="text-white/40 text-sm mt-0.5">
            {view === "month"
              ? `${events.length} events · ${holidayCount} holidays in ${MONTHS[month]}`
              : view === "week"
              ? `${weekDays.map(d => buildKey(d.getFullYear(),d.getMonth(),d.getDate())).reduce((c,k) => c + (eventsByDate[k]?.length || 0), 0)} events this week`
              : `${events.length} events in ${year}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {viewSwitcher}
          {/* auto-refresh indicator */}
          <div
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400/70 text-[10px] font-medium"
            title="Auto-refreshes every 60 seconds"
          >
            <Zap className="w-2.5 h-2.5" />
            Live
          </div>
          <button
            onClick={refetch}
            disabled={isFetching}
            data-testid="button-sync-now"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 text-sm hover:text-white hover:border-white/20 transition-colors disabled:opacity-60"
            title="Sync now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Second row: quick-jump + prev/today/next */}
      <div className="flex items-center gap-2 flex-wrap">
        {quickJump}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={view === "week" ? prevWeek : view === "year" ? () => { setYear(y => Math.max(2020, y - 1)); setSelectedDay(null); } : prevMonth}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            data-testid={view === "week" ? "button-prev-week" : view === "year" ? "button-prev-year" : "button-prev-month"}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-white font-semibold min-w-[140px] text-center text-sm" data-testid="text-calendar-title">
            {navTitle()}
          </span>
          <button
            onClick={view === "week" ? nextWeek : view === "year" ? () => { setYear(y => Math.min(2120, y + 1)); setSelectedDay(null); } : nextMonth}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            data-testid={view === "week" ? "button-next-week" : view === "year" ? "button-next-year" : "button-next-month"}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-sm font-medium hover:bg-emerald-500/25 transition-colors"
            data-testid="button-today"
          >
            Today
          </button>
        </div>
      </div>
    </div>
  );

  /* LEGEND — solid pill swatches */
  const legend = (
    <div className="flex items-center gap-3 flex-wrap" data-testid="calendar-legend">
      {EVENT_TYPES.map(t => (
        <div key={t.value} className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
          <span className="text-xs text-white/50 font-medium">{t.label}</span>
        </div>
      ))}
    </div>
  );

  /* BOTTOM SHEET (works for all views on mobile) */
  const bottomSheet = (
    <AnimatePresence>
      {bottomSheetOpen && selectedDay && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.65)" }}
            onClick={() => setBottomSheetOpen(false)}
          />
          <motion.div
            className="relative rounded-t-3xl border-t border-white/10 shadow-2xl max-h-[75vh] overflow-y-auto"
            style={{ background: "#0F1F35" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
          >
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 sticky top-0" style={{ background: "#0F1F35" }}>
              <div>
                <p className="text-base font-bold text-white">{formatDate(selectedDay)}</p>
                <p className="text-xs text-white/40">{DAYS_FULL[new Date(selectedDay + "T00:00:00").getDay()]}</p>
              </div>
              <button
                onClick={() => setBottomSheetOpen(false)}
                className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                data-testid="button-close-bottom-sheet"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 pb-8">
              {selectedEvents.length === 0 ? (
                <div className="text-center py-10">
                  <Calendar className="w-10 h-10 text-white/10 mx-auto mb-3" />
                  <p className="text-white/30 text-sm">No events on this day</p>
                </div>
              ) : selectedEvents.map(ev => {
                const color = getColor(ev);
                return (
                  <div
                    key={ev.id}
                    className="rounded-2xl overflow-hidden"
                    data-testid={`bottom-sheet-event-${ev.id}`}
                  >
                    <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
                    <div className="p-4 border border-t-0 border-white/10 rounded-b-2xl" style={{ background: `${color}12` }}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold text-white leading-snug">{ev.title}</p>
                        {ev.isRecurring && <Repeat className="w-3.5 h-3.5 text-white/30 mt-0.5 shrink-0" />}
                      </div>
                      <span
                        className="inline-block mt-2 text-[10px] font-semibold px-2.5 py-0.5 rounded-full"
                        style={{ backgroundColor: `${color}30`, color }}
                      >
                        <EventTypeLabel eventType={ev.eventType} />
                      </span>
                      {ev.description && (
                        <p className="text-xs text-white/50 mt-2 leading-relaxed">{ev.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  /* MONTH VIEW */
  const monthView = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 bg-[#0F1F35] rounded-2xl border border-white/10 overflow-hidden shadow-xl">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-white/10">
          {DAYS.map((d, i) => (
            <div
              key={d}
              className={`py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide ${
                i === 0 || i === 6 ? "text-red-400/60" : "text-white/35"
              }`}
            >
              {d}
            </div>
          ))}
        </div>
        {/* Calendar cells */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400/60" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map((day, i) => {
              if (day === null) {
                return <div key={`e-${i}`} className="min-h-[72px] border-b border-r border-white/10 bg-black/10" />;
              }
              const key = buildKey(year, month, day);
              const dayEvs = eventsByDate[key] || [];
              const today = isTodayFn(year, month, day);
              const isSelected = selectedDay === key;
              const isWeekend = (new Date(year, month, day).getDay() === 0) || (new Date(year, month, day).getDay() === 6);

              return (
                <div
                  key={key}
                  onClick={() => handleDayClick(key)}
                  data-testid={`cell-day-${day}`}
                  className={`min-h-[72px] border-b border-r border-white/10 p-1.5 cursor-pointer transition-all ${
                    isSelected ? "bg-emerald-500/12" : "hover:bg-white/4"
                  }`}
                  style={today ? { boxShadow: "0 0 0 2px rgba(16,185,129,0.55), 0 0 18px rgba(16,185,129,0.25)" } : {}}
                >
                  <div className="flex justify-end mb-1">
                    <span
                      className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                        today
                          ? "bg-emerald-500 text-white"
                          : isWeekend
                          ? "text-red-400/70"
                          : "text-white/50"
                      }`}
                      style={today ? { boxShadow: "0 0 0 3px rgba(16,185,129,0.25), 0 0 12px rgba(16,185,129,0.4)" } : {}}
                      data-testid={`text-day-${day}`}
                    >
                      {day}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {dayEvs.slice(0, 2).map(ev => (
                      <EventPill
                        key={ev.id}
                        ev={ev}
                        size="xs"
                        onClick={e => { e.stopPropagation(); handleDayClick(key); }}
                      />
                    ))}
                    {dayEvs.length > 2 && (
                      <div className="text-[9px] text-white/30 pl-1">+{dayEvs.length - 2} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-col bg-[#0F1F35] rounded-2xl border border-white/10 p-4 shadow-xl">
        <h4 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-emerald-400" />
          {selectedDay ? formatDate(selectedDay) : "Events this month"}
        </h4>
        {!selectedDay ? (
          <div className="flex-1 overflow-y-auto space-y-2">
            {events.length === 0 ? (
              <p className="text-white/20 text-sm text-center py-6">No events this month</p>
            ) : events.slice().sort((a,b) => a.date.localeCompare(b.date)).map(ev => (
              <div
                key={ev.id}
                className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                data-testid={`sidebar-event-${ev.id}`}
                onClick={() => handleDayClick(ev.date.split("T")[0])}
              >
                <span
                  className="w-2 h-6 rounded-full shrink-0"
                  style={{ backgroundColor: getColor(ev) }}
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{ev.title}</p>
                  <p className="text-[10px] text-white/35">
                    {new Date(ev.date + "T00:00:00").toLocaleDateString("en-GB", { day:"2-digit", month:"short" })}
                  </p>
                </div>
                {ev.isRecurring && <Repeat className="w-3 h-3 text-white/20 shrink-0 ml-auto" />}
              </div>
            ))}
          </div>
        ) : selectedEvents.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <Calendar className="w-10 h-10 text-white/10 mb-3" />
            <p className="text-white/30 text-sm">No events on this day</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3">
            {selectedEvents.map(ev => {
              const color = getColor(ev);
              return (
                <motion.div
                  key={ev.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-xl overflow-hidden"
                  data-testid={`event-detail-${ev.id}`}
                >
                  <div className="h-1 w-full" style={{ backgroundColor: color }} />
                  <div className="p-3 border border-t-0 border-white/10 rounded-b-xl" style={{ background: `${color}12` }}>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="text-sm font-bold text-white leading-snug" data-testid={`text-event-title-${ev.id}`}>{ev.title}</p>
                      {ev.isRecurring && <Repeat className="w-3.5 h-3.5 text-white/30 shrink-0 mt-0.5" />}
                    </div>
                    <span
                      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${color}30`, color }}
                    >
                      <EventTypeLabel eventType={ev.eventType} />
                    </span>
                    {ev.description && <p className="text-xs text-white/40 mt-2 leading-relaxed">{ev.description}</p>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  /* WEEK VIEW */
  const weekView = (
    <div className="space-y-3">
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-emerald-400/60" /></div>
      ) : (
        <div
          className="rounded-2xl border border-white/10 overflow-x-auto shadow-xl"
          data-testid="week-grid"
        >
          <div className="grid grid-cols-7 min-w-[560px] bg-[#0F1F35]">
            {weekDays.map(day => {
              const key = buildKey(day.getFullYear(), day.getMonth(), day.getDate());
              const dayEvs = eventsByDate[key] || [];
              const today = isTodayFn(day.getFullYear(), day.getMonth(), day.getDate());
              const isSelected = selectedDay === key;
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;

              return (
                <div
                  key={key}
                  className={`flex flex-col border-r border-white/10 last:border-0 ${isSelected ? "bg-emerald-500/8" : ""}`}
                  style={today ? { boxShadow: "0 0 0 2px rgba(16,185,129,0.55), 0 0 18px rgba(16,185,129,0.25)" } : {}}
                >
                  {/* Day header */}
                  <div
                    className={`py-3 px-2 text-center border-b border-white/10 cursor-pointer hover:bg-white/5 transition-colors ${today ? "bg-emerald-500/8" : ""}`}
                    onClick={() => handleDayClick(key)}
                    data-testid={`week-day-header-${key}`}
                  >
                    <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1 ${isWeekend ? "text-red-400/60" : "text-white/35"}`}>
                      {DAYS[day.getDay()]}
                    </p>
                    <span
                      className={`w-8 h-8 flex items-center justify-center mx-auto rounded-full text-sm font-bold ${
                        today ? "bg-emerald-500 text-white" : isWeekend ? "text-red-400/70" : "text-white/60"
                      }`}
                      style={today ? { boxShadow: "0 0 0 3px rgba(16,185,129,0.25), 0 0 12px rgba(16,185,129,0.4)" } : {}}
                      data-testid={`week-day-${key}`}
                    >
                      {day.getDate()}
                    </span>
                    <p className="text-[9px] text-white/20 mt-1">{MONTHS_SHORT[day.getMonth()]}</p>
                  </div>
                  {/* Events */}
                  <div
                    className="flex-1 p-1.5 space-y-1 min-h-[120px] cursor-pointer"
                    onClick={() => handleDayClick(key)}
                  >
                    {dayEvs.map(ev => (
                      <EventPill
                        key={ev.id}
                        ev={ev}
                        size="xs"
                        onClick={e => { e.stopPropagation(); handleDayClick(key); }}
                      />
                    ))}
                    {dayEvs.length === 0 && (
                      <div className="flex items-center justify-center h-full pt-6">
                        <span className="text-[9px] text-white/10">—</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  /* YEAR / AGENDA VIEW */
  const yearView = (
    <div className="space-y-6" data-testid="year-agenda">
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-emerald-400/60" /></div>
      ) : MONTHS.map((monthName, mi) => {
        const monthEvs = (yearGroupedByMonth[mi] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        const isCurrentMonth = mi === now.getMonth() && year === now.getFullYear();
        return (
          <div key={mi} data-testid={`year-month-section-${mi}`}>
            <div
              className="sticky top-0 z-10 flex items-center gap-3 py-2.5 px-3 border-b border-white/10 mb-3 rounded-t-xl"
              style={{ background: "rgba(10,22,40,0.96)", backdropFilter: "blur(8px)" }}
              data-testid={`year-month-header-${mi}`}
            >
              <span className={`text-sm font-bold ${isCurrentMonth ? "text-emerald-400" : "text-white"}`}>
                {monthName}
              </span>
              <span className="text-xs text-white/30">{year}</span>
              {isCurrentMonth && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold">
                  Current month
                </span>
              )}
              <span className="ml-auto text-[10px] text-white/25">
                {monthEvs.length} event{monthEvs.length !== 1 ? "s" : ""}
              </span>
            </div>
            {monthEvs.length === 0 ? (
              <p className="text-white/15 text-xs px-3 py-2">No events scheduled</p>
            ) : (
              <div className="space-y-2">
                {monthEvs.map(ev => {
                  const color = getColor(ev);
                  const d = new Date(ev.date.split("T")[0] + "T00:00:00");
                  const isCurrentDay = isTodayFn(d.getFullYear(), d.getMonth(), d.getDate());
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer group"
                      onClick={() => handleDayClick(ev.date.split("T")[0])}
                      data-testid={`year-event-${ev.id}`}
                    >
                      <div className="w-10 text-center shrink-0">
                        <p className="text-[9px] text-white/30 uppercase font-medium">{DAYS[d.getDay()]}</p>
                        <p className={`text-lg font-black leading-tight ${isCurrentDay ? "text-emerald-400" : "text-white/50"}`}
                          style={isCurrentDay ? { textShadow: "0 0 10px rgba(16,185,129,0.5)" } : {}}>
                          {d.getDate()}
                        </p>
                      </div>
                      <AgendaEventPill ev={ev} onClick={() => handleDayClick(ev.date.split("T")[0])} />
                      {ev.description && (
                        <p className="text-[10px] text-white/30 truncate max-w-[120px] hidden lg:block">{ev.description}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  /* MOBILE MONTH — agenda list with solid pills */
  if (isMobile && view === "month") {
    return (
      <div className="space-y-4" data-testid="teacher-calendar-mobile">
        {navBar}
        {legend}
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-emerald-400/60" /></div>
        ) : agendaDates.length === 0 ? (
          <div className="text-center py-12 rounded-2xl bg-white/3 border border-white/10">
            <Calendar className="w-10 h-10 text-white/10 mx-auto mb-3" />
            <p className="text-white/30">No events in {MONTHS[month]} {year}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {agendaDates.map(dateKey => {
              const d = new Date(dateKey + "T00:00:00");
              const isCurrentDay = dateKey === buildKey(now.getFullYear(), now.getMonth(), now.getDate());
              const dayEvs = groupedByDate[dateKey];
              return (
                <div key={dateKey} data-testid={`agenda-group-${dateKey}`}>
                  <button
                    className={`flex items-center gap-2 mb-2 px-1 w-full text-left rounded-xl hover:bg-white/5 transition-colors min-h-[44px] ${isCurrentDay ? "text-emerald-400" : "text-white/40"}`}
                    onClick={() => { setSelectedDay(dateKey); setBottomSheetOpen(true); }}
                    data-testid={`agenda-date-header-${dateKey}`}
                  >
                    <span className="text-xs font-bold uppercase tracking-widest">
                      {d.toLocaleDateString("en-GB", { day:"2-digit", month:"short" })}
                    </span>
                    <span className="text-xs">{DAYS_FULL[d.getDay()]}</span>
                    {isCurrentDay && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-semibold">Today</span>
                    )}
                    <span className="ml-auto text-[10px] text-white/20">{dayEvs.length} ›</span>
                  </button>
                  <div className="space-y-2 pl-1">
                    {dayEvs.map(ev => {
                      const color = getColor(ev);
                      return (
                        <div
                          key={ev.id}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-white text-sm cursor-pointer hover:opacity-90 transition-opacity"
                          style={{ backgroundColor: color }}
                          data-testid={`mobile-event-detail-${ev.id}`}
                          onClick={() => { setSelectedDay(dateKey); setBottomSheetOpen(true); }}
                        >
                          <span className="flex-1 truncate">{ev.title}</span>
                          {ev.isRecurring && <Repeat className="w-3.5 h-3.5 text-white/60 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {bottomSheet}
      </div>
    );
  }

  /* MAIN (Desktop + Week/Year mobile) */
  return (
    <div className="space-y-5" data-testid="teacher-calendar-desktop">
      {navBar}
      {legend}
      {view === "month" && monthView}
      {view === "week" && weekView}
      {view === "year" && yearView}
      {bottomSheet}
    </div>
  );
}
