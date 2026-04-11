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

const EVENT_TYPES = [
  { value: "holiday",     label: "Holiday",     color: "#dc2626", icon: Flame    },
  { value: "academic",    label: "Academic",    color: "#2563eb", icon: BookOpen },
  { value: "examination", label: "Examination", color: "#2563eb", icon: Award    },
  { value: "event",       label: "Event",       color: "#10b981", icon: Star     },
];

const YEAR_OPTIONS = Array.from({ length: 101 }, (_, i) => 2020 + i);

/* Deep navy backgrounds */
const BG_MAIN  = "#0f172a";
const BG_CARD  = "#0f172a";
const BG_CELL  = "#0c1526";

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
        background: "rgba(10,22,40,0.95)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.15)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
      onMouseLeave={onClose}
    >
      <div className="h-1 w-full" style={{ backgroundColor: color }} />
      <div className="p-3.5">
        <p className="text-sm font-bold leading-snug mb-2" style={{ color: "#fff" }}>{ev.title}</p>
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${color}33`, color }}
          >
            {typeLabel}
          </span>
          {ev.isRecurring && (
            <span className="flex items-center gap-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.6)" }}>
              <Repeat className="w-2.5 h-2.5" />
              Recurring
            </span>
          )}
        </div>
        <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.7)" }}>{formatDate(ev.date)}</p>
        {ev.description && (
          <p className="text-[11px] mt-2 pt-2 leading-relaxed" style={{ color: "rgba(255,255,255,0.65)", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            {ev.description}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/* Event Pill — solid opaque color, pure white text */
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
        className={`rounded-full truncate font-semibold cursor-pointer transition-opacity hover:opacity-90 ${
          size === "xs" ? "px-1.5 py-px text-[9px]" : "px-2 py-0.5 text-[10px]"
        }`}
        style={{ backgroundColor: color, color: "#ffffff" }}
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

/* Agenda Event Pill — for year/agenda view rows, with hover popover */
function AgendaEventPill({ ev, onClick }: { ev: CalendarEvent; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const color = getColor(ev);
  return (
    <div className="relative flex-1 min-w-0">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-xl font-semibold text-xs min-w-0 truncate cursor-pointer hover:opacity-90 transition-opacity"
        style={{ backgroundColor: color, color: "#ffffff" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onClick}
        data-testid={`event-chip-${ev.id}`}
      >
        <span className="truncate">{ev.title}</span>
        {ev.isRecurring && <Repeat className="w-3 h-3 shrink-0" style={{ color: "rgba(255,255,255,0.7)" }} />}
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

  const monthQuery = useQuery<CalendarEvent[]>({
    queryKey: ["/api/teacher/calendar", month + 1, year],
    queryFn: async () => {
      const r = await fetch(`/api/teacher/calendar?month=${month + 1}&year=${year}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: view === "month",
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const yearQuery = useQuery<CalendarEvent[]>({
    queryKey: ["/api/teacher/calendar", "year", year],
    queryFn: async () => {
      const r = await fetch(`/api/teacher/calendar?year=${year}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: view === "week" || view === "year",
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const events    = view === "month" ? (monthQuery.data ?? []) : (yearQuery.data ?? []);
  const isLoading = view === "month" ? monthQuery.isLoading  : yearQuery.isLoading;
  const isFetching= view === "month" ? monthQuery.isFetching : yearQuery.isFetching;
  const isError   = view === "month" ? monthQuery.isError    : yearQuery.isError;

  function refetch() {
    if (view === "month") monthQuery.refetch();
    else yearQuery.refetch();
  }

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

  const weekDays = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    }), [weekStart]);

  const yearGroupedByMonth = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {};
    events.forEach(ev => {
      const m = new Date(ev.date.split("T")[0] + "T00:00:00").getMonth();
      if (!map[m]) map[m] = [];
      map[m].push(ev);
    });
    return map;
  }, [events]);

  const sortedMonthEvents = useMemo(() => events.slice().sort((a, b) => a.date.localeCompare(b.date)), [events]);
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
  function handleMonthJump(m: number) { setMonth(m); setSelectedDay(null); }
  function handleYearJump(y: number) {
    setYear(y);
    if (view === "week") {
      const ws = new Date(weekStart); ws.setFullYear(y);
      setWeekStart(getWeekStart(ws));
    }
    setSelectedDay(null);
  }

  function navTitle() {
    if (view === "month") return `${MONTHS[month]} ${year}`;
    if (view === "week") {
      const end = weekDays[6];
      const sameMonth = weekDays[0].getMonth() === end.getMonth();
      if (sameMonth)
        return `${MONTHS_SHORT[weekDays[0].getMonth()]} ${weekDays[0].getDate()}–${end.getDate()}, ${weekDays[0].getFullYear()}`;
      return `${MONTHS_SHORT[weekDays[0].getMonth()]} ${weekDays[0].getDate()} – ${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}, ${weekDays[0].getFullYear()}`;
    }
    return `${year}`;
  }

  if (isError) {
    return (
      <div className="text-center py-12" style={{ color: "#f87171" }} data-testid="text-calendar-error">
        Failed to load calendar. Please try again.
      </div>
    );
  }

  /* View switcher */
  const viewSwitcher = (
    <div
      className="flex items-center gap-0.5 rounded-xl p-1"
      style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
      data-testid="view-switcher"
    >
      {(["month", "week", "year"] as View[]).map(v => (
        <button
          key={v}
          onClick={() => switchView(v)}
          data-testid={`button-view-${v}`}
          className="px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize"
          style={{
            backgroundColor: view === v ? "#10b981" : "transparent",
            color: view === v ? "#ffffff" : "rgba(255,255,255,0.7)",
          }}
        >
          {v === "year" ? "Agenda" : v}
        </button>
      ))}
    </div>
  );

  /* Quick-jump selectors */
  const selectStyle: React.CSSProperties = {
    background: "#0f172a",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "8px",
    padding: "6px 28px 6px 10px",
    fontSize: "14px",
    color: "#ffffff",
    cursor: "pointer",
    outline: "none",
    appearance: "none" as const,
    WebkitAppearance: "none" as const,
    backgroundImage: "none",
  };

  const quickJump = (
    <div className="flex items-center gap-1.5">
      {view === "month" && (
        <div className="relative">
          <select
            value={month}
            onChange={e => handleMonthJump(parseInt(e.target.value))}
            style={selectStyle}
            data-testid="select-month-jump"
            aria-label="Jump to month"
          >
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <ChevronRight className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" style={{ color: "#ffffff" }} />
        </div>
      )}
      <div className="relative">
        <select
          value={year}
          onChange={e => handleYearJump(parseInt(e.target.value))}
          style={selectStyle}
          data-testid="select-year-jump"
          aria-label="Jump to year"
        >
          {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <ChevronRight className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" style={{ color: "#ffffff" }} />
      </div>
    </div>
  );

  /* Nav bar */
  const navBar = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "#ffffff" }} data-testid="heading-teacher-calendar">
            <CalendarDays className="w-5 h-5" style={{ color: "#10b981" }} />
            School Calendar
          </h2>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>
            {view === "month"
              ? `${events.length} events · ${holidayCount} holidays in ${MONTHS[month]}`
              : view === "week"
              ? `${weekDays.map(d => buildKey(d.getFullYear(), d.getMonth(), d.getDate())).reduce((c, k) => c + (eventsByDate[k]?.length || 0), 0)} events this week`
              : `${events.length} events in ${year}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {viewSwitcher}
          <div
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold"
            style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981" }}
            title="Auto-refreshes every 60 seconds"
          >
            <Zap className="w-2.5 h-2.5" />
            Live
          </div>
          <button
            onClick={refetch}
            disabled={isFetching}
            data-testid="button-sync-now"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-60"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.8)" }}
            title="Sync now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {quickJump}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={view === "week" ? prevWeek : view === "year" ? () => { setYear(y => Math.max(2020, y - 1)); setSelectedDay(null); } : prevMonth}
            className="p-2 rounded-lg transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", color: "#ffffff" }}
            data-testid={view === "week" ? "button-prev-week" : view === "year" ? "button-prev-year" : "button-prev-month"}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-semibold min-w-[140px] text-center text-sm" style={{ color: "#ffffff" }} data-testid="text-calendar-title">
            {navTitle()}
          </span>
          <button
            onClick={view === "week" ? nextWeek : view === "year" ? () => { setYear(y => Math.min(2120, y + 1)); setSelectedDay(null); } : nextMonth}
            className="p-2 rounded-lg transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", color: "#ffffff" }}
            data-testid={view === "week" ? "button-next-week" : view === "year" ? "button-next-year" : "button-next-month"}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", color: "#10b981" }}
            data-testid="button-today"
          >
            Today
          </button>
        </div>
      </div>
    </div>
  );

  /* Legend */
  const legend = (
    <div className="flex items-center gap-4 flex-wrap" data-testid="calendar-legend">
      {EVENT_TYPES.map(t => (
        <div key={t.value} className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
          <span className="text-xs font-medium" style={{ color: "#ffffff" }}>{t.label}</span>
        </div>
      ))}
    </div>
  );

  /* Bottom sheet */
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
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={() => setBottomSheetOpen(false)}
          />
          <motion.div
            className="relative rounded-t-3xl max-h-[75vh] overflow-y-auto"
            style={{ background: BG_MAIN, borderTop: "1px solid rgba(255,255,255,0.12)" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.25)" }} />
            </div>
            <div
              className="flex items-center justify-between px-5 py-3 sticky top-0"
              style={{ background: BG_MAIN, borderBottom: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div>
                <p className="text-base font-bold" style={{ color: "#ffffff" }}>{formatDate(selectedDay)}</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>{DAYS_FULL[new Date(selectedDay + "T00:00:00").getDay()]}</p>
              </div>
              <button
                onClick={() => setBottomSheetOpen(false)}
                className="p-2 rounded-xl transition-colors"
                style={{ color: "rgba(255,255,255,0.7)" }}
                data-testid="button-close-bottom-sheet"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 pb-8">
              {selectedEvents.length === 0 ? (
                <div className="text-center py-10">
                  <Calendar className="w-10 h-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>No events on this day</p>
                </div>
              ) : selectedEvents.map(ev => {
                const color = getColor(ev);
                return (
                  <div key={ev.id} className="rounded-2xl overflow-hidden" data-testid={`bottom-sheet-event-${ev.id}`}>
                    <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
                    <div className="p-4" style={{ background: `${color}1a`, border: "1px solid rgba(255,255,255,0.08)", borderTop: "none", borderBottomLeftRadius: "16px", borderBottomRightRadius: "16px" }}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold leading-snug" style={{ color: "#ffffff" }}>{ev.title}</p>
                        {ev.isRecurring && <Repeat className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "rgba(255,255,255,0.5)" }} />}
                      </div>
                      <span
                        className="inline-block mt-2 text-[10px] font-semibold px-2.5 py-0.5 rounded-full"
                        style={{ backgroundColor: `${color}33`, color }}
                      >
                        <EventTypeLabel eventType={ev.eventType} />
                      </span>
                      {ev.description && (
                        <p className="text-xs mt-2 leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>{ev.description}</p>
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

  /* Month view — 7-column grid, date top-right, event pills inside cells */
  const monthView = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 rounded-2xl overflow-hidden shadow-xl" style={{ background: BG_CARD, border: "1px solid rgba(255,255,255,0.12)" }}>
        {/* Day name headers — Sun to Sat */}
        <div className="grid grid-cols-7" style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
          {DAYS.map((d, i) => (
            <div
              key={d}
              className="py-2.5 text-center text-[11px] font-bold uppercase tracking-wide"
              style={{ color: i === 0 || i === 6 ? "#f87171" : "#ffffff" }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#10b981" }} />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map((day, i) => {
              if (day === null) {
                return <div key={`e-${i}`} className="min-h-[80px]" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", borderRight: "1px solid rgba(255,255,255,0.08)", background: BG_CELL }} />;
              }
              const key = buildKey(year, month, day);
              const dayEvs = eventsByDate[key] || [];
              const today = isTodayFn(year, month, day);
              const isSelected = selectedDay === key;
              const isWeekend = new Date(year, month, day).getDay() === 0 || new Date(year, month, day).getDay() === 6;

              return (
                <div
                  key={key}
                  onClick={() => handleDayClick(key)}
                  data-testid={`cell-day-${day}`}
                  className="min-h-[80px] p-1.5 cursor-pointer transition-all"
                  style={{
                    background: isSelected ? "rgba(16,185,129,0.15)" : BG_CARD,
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    borderRight: "1px solid rgba(255,255,255,0.08)",
                    boxShadow: today
                      ? "0 0 0 2px rgba(16,185,129,0.6), 0 0 16px rgba(16,185,129,0.2)"
                      : "none",
                  }}
                >
                  {/* Date number — top right */}
                  <div className="flex justify-end mb-1">
                    <span
                      className="text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full"
                      style={
                        today
                          ? { background: "#10b981", color: "#ffffff", boxShadow: "0 0 0 3px rgba(16,185,129,0.3), 0 0 12px rgba(16,185,129,0.4)" }
                          : { color: isWeekend ? "#f87171" : "#ffffff" }
                      }
                      data-testid={`text-day-${day}`}
                    >
                      {day}
                    </span>
                  </div>
                  {/* Event pills */}
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
                      <div className="text-[9px] pl-1 font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>
                        +{dayEvs.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-col rounded-2xl shadow-xl p-4" style={{ background: BG_CARD, border: "1px solid rgba(255,255,255,0.12)" }}>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "#ffffff" }}>
          <CalendarDays className="w-4 h-4" style={{ color: "#10b981" }} />
          {selectedDay ? formatDate(selectedDay) : "Events this month"}
        </h4>
        {!selectedDay ? (
          <div className="flex-1 overflow-y-auto space-y-2">
            {events.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: "rgba(255,255,255,0.5)" }}>No events this month</p>
            ) : events.slice().sort((a, b) => a.date.localeCompare(b.date)).map(ev => (
              <div
                key={ev.id}
                className="flex items-center gap-2.5 p-2 rounded-xl cursor-pointer transition-colors"
                style={{ color: "#ffffff" }}
                data-testid={`sidebar-event-${ev.id}`}
                onClick={() => handleDayClick(ev.date.split("T")[0])}
              >
                <span className="w-2 h-6 rounded-full shrink-0" style={{ backgroundColor: getColor(ev) }} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: "#ffffff" }}>{ev.title}</p>
                  <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.6)" }}>
                    {new Date(ev.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                  </p>
                </div>
                {ev.isRecurring && <Repeat className="w-3 h-3 shrink-0 ml-auto" style={{ color: "rgba(255,255,255,0.4)" }} />}
              </div>
            ))}
          </div>
        ) : selectedEvents.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <Calendar className="w-10 h-10 mb-3" style={{ color: "rgba(255,255,255,0.15)" }} />
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>No events on this day</p>
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
                  <div className="p-3" style={{ background: `${color}1a`, border: "1px solid rgba(255,255,255,0.08)", borderTop: "none", borderBottomLeftRadius: "12px", borderBottomRightRadius: "12px" }}>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="text-sm font-bold leading-snug" style={{ color: "#ffffff" }} data-testid={`text-event-title-${ev.id}`}>{ev.title}</p>
                      {ev.isRecurring && <Repeat className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }} />}
                    </div>
                    <span
                      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${color}33`, color }}
                    >
                      <EventTypeLabel eventType={ev.eventType} />
                    </span>
                    {ev.description && (
                      <p className="text-xs mt-2 leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>{ev.description}</p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  /* Week view — 7-column grid with solid pills */
  const weekView = (
    <div className="space-y-3">
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#10b981" }} /></div>
      ) : (
        <div
          className="rounded-2xl overflow-x-auto shadow-xl"
          style={{ background: BG_CARD, border: "1px solid rgba(255,255,255,0.12)" }}
          data-testid="week-grid"
        >
          <div className="grid grid-cols-7 min-w-[560px]">
            {weekDays.map(day => {
              const key = buildKey(day.getFullYear(), day.getMonth(), day.getDate());
              const dayEvs = eventsByDate[key] || [];
              const today = isTodayFn(day.getFullYear(), day.getMonth(), day.getDate());
              const isSelected = selectedDay === key;
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;

              return (
                <div
                  key={key}
                  className="flex flex-col last:border-r-0"
                  style={{
                    borderRight: "1px solid rgba(255,255,255,0.08)",
                    background: isSelected ? "rgba(16,185,129,0.1)" : BG_CARD,
                    boxShadow: today ? "0 0 0 2px rgba(16,185,129,0.6), 0 0 16px rgba(16,185,129,0.2)" : "none",
                  }}
                >
                  <div
                    className="py-3 px-2 text-center cursor-pointer transition-colors"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", background: today ? "rgba(16,185,129,0.08)" : "transparent" }}
                    onClick={() => handleDayClick(key)}
                    data-testid={`week-day-header-${key}`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: isWeekend ? "#f87171" : "#ffffff" }}>
                      {DAYS[day.getDay()]}
                    </p>
                    <span
                      className="w-8 h-8 flex items-center justify-center mx-auto rounded-full text-sm font-bold"
                      style={
                        today
                          ? { background: "#10b981", color: "#ffffff", boxShadow: "0 0 0 3px rgba(16,185,129,0.3), 0 0 12px rgba(16,185,129,0.4)" }
                          : { color: isWeekend ? "#f87171" : "#ffffff" }
                      }
                      data-testid={`week-day-${key}`}
                    >
                      {day.getDate()}
                    </span>
                    <p className="text-[9px] mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>{MONTHS_SHORT[day.getMonth()]}</p>
                  </div>
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
                        <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.2)" }}>—</span>
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

  /* Year / Agenda view */
  const yearView = (
    <div className="space-y-6" data-testid="year-agenda">
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#10b981" }} /></div>
      ) : MONTHS.map((monthName, mi) => {
        const monthEvs = (yearGroupedByMonth[mi] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        const isCurrentMonth = mi === now.getMonth() && year === now.getFullYear();
        return (
          <div key={mi} data-testid={`year-month-section-${mi}`}>
            <div
              className="sticky top-0 z-10 flex items-center gap-3 py-2.5 px-3 mb-3 rounded-t-xl"
              style={{
                background: "rgba(10,22,40,0.97)",
                backdropFilter: "blur(8px)",
                borderBottom: "1px solid rgba(255,255,255,0.12)",
              }}
              data-testid={`year-month-header-${mi}`}
            >
              <span className="text-sm font-bold" style={{ color: isCurrentMonth ? "#10b981" : "#ffffff" }}>
                {monthName}
              </span>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.65)" }}>{year}</span>
              {isCurrentMonth && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(16,185,129,0.2)", color: "#10b981" }}>
                  Current month
                </span>
              )}
              <span className="ml-auto text-[10px] font-medium" style={{ color: "rgba(255,255,255,0.65)" }}>
                {monthEvs.length} event{monthEvs.length !== 1 ? "s" : ""}
              </span>
            </div>
            {monthEvs.length === 0 ? (
              <p className="text-xs px-3 py-2" style={{ color: "rgba(255,255,255,0.4)" }}>No events scheduled</p>
            ) : (
              <div className="space-y-2">
                {monthEvs.map(ev => {
                  const color = getColor(ev);
                  const d = new Date(ev.date.split("T")[0] + "T00:00:00");
                  const isCurrentDay = isTodayFn(d.getFullYear(), d.getMonth(), d.getDate());
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors"
                      onClick={() => handleDayClick(ev.date.split("T")[0])}
                      data-testid={`year-event-${ev.id}`}
                    >
                      <div className="w-10 text-center shrink-0">
                        <p className="text-[9px] uppercase font-bold" style={{ color: "rgba(255,255,255,0.7)" }}>{DAYS[d.getDay()]}</p>
                        <p
                          className="text-lg font-black leading-tight"
                          style={{ color: isCurrentDay ? "#10b981" : "#ffffff", textShadow: isCurrentDay ? "0 0 10px rgba(16,185,129,0.5)" : "none" }}
                        >
                          {d.getDate()}
                        </p>
                      </div>
                      <AgendaEventPill ev={ev} onClick={() => handleDayClick(ev.date.split("T")[0])} />
                      {ev.description && (
                        <p className="text-[10px] truncate max-w-[120px] hidden lg:block" style={{ color: "rgba(255,255,255,0.6)" }}>{ev.description}</p>
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

  /* Mobile month — 7-column compact grid (not agenda list) */
  if (isMobile && view === "month") {
    return (
      <div className="space-y-4" data-testid="teacher-calendar-mobile">
        {navBar}
        {legend}
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#10b981" }} /></div>
        ) : (
          <div className="rounded-2xl overflow-hidden shadow-xl" style={{ background: BG_CARD, border: "1px solid rgba(255,255,255,0.12)" }}>
            {/* Day headers */}
            <div className="grid grid-cols-7" style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
              {DAYS.map((d, i) => (
                <div key={d} className="py-2 text-center text-[10px] font-bold uppercase" style={{ color: i === 0 || i === 6 ? "#f87171" : "#ffffff" }}>
                  {d}
                </div>
              ))}
            </div>
            {/* Cells */}
            <div className="grid grid-cols-7">
              {calendarDays.map((day, i) => {
                if (day === null) {
                  return <div key={`e-${i}`} className="min-h-[48px]" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", borderRight: "1px solid rgba(255,255,255,0.08)", background: BG_CELL }} />;
                }
                const key = buildKey(year, month, day);
                const dayEvs = eventsByDate[key] || [];
                const today = isTodayFn(year, month, day);
                const isSelected = selectedDay === key;
                const isWeekend = new Date(year, month, day).getDay() === 0 || new Date(year, month, day).getDay() === 6;
                return (
                  <div
                    key={key}
                    onClick={() => handleDayClick(key)}
                    data-testid={`mobile-cell-day-${day}`}
                    className="min-h-[48px] p-1 cursor-pointer"
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                      borderRight: "1px solid rgba(255,255,255,0.08)",
                      background: isSelected ? "rgba(16,185,129,0.15)" : BG_CARD,
                      boxShadow: today ? "0 0 0 2px rgba(16,185,129,0.6)" : "none",
                    }}
                  >
                    <div className="flex justify-end">
                      <span
                        className="text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full"
                        style={today ? { background: "#10b981", color: "#ffffff" } : { color: isWeekend ? "#f87171" : "#ffffff" }}
                        data-testid={`text-day-${day}`}
                      >
                        {day}
                      </span>
                    </div>
                    <div className="space-y-px mt-0.5">
                      {dayEvs.slice(0, 1).map(ev => (
                        <div
                          key={ev.id}
                          className="w-full h-1.5 rounded-full"
                          style={{ backgroundColor: getColor(ev) }}
                        />
                      ))}
                      {dayEvs.length > 1 && (
                        <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.3)" }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Event list for selected day (below the grid) */}
        {selectedDay && (
          <div className="rounded-2xl p-4" style={{ background: BG_CARD, border: "1px solid rgba(255,255,255,0.12)" }}>
            <p className="text-sm font-bold mb-3" style={{ color: "#ffffff" }}>{formatDate(selectedDay)}</p>
            {selectedEvents.length === 0 ? (
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>No events on this day</p>
            ) : selectedEvents.map(ev => {
              const color = getColor(ev);
              return (
                <div key={ev.id} className="flex items-center gap-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }} data-testid={`mobile-event-detail-${ev.id}`}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: "#ffffff" }}>{ev.title}</p>
                    <p className="text-[11px]" style={{ color }}><EventTypeLabel eventType={ev.eventType} /></p>
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

  /* Main render — desktop + non-month mobile views */
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
