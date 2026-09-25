import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { fmtDateLong } from "@/lib/dateUtils";
import {
  ArrowLeft, ChevronLeft, ChevronRight, CalendarDays, Loader2,
  Repeat, RefreshCw, X, Calendar, Flame, BookOpen, Award, Star,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

interface StudentMe {
  id: number;
  name: string;
  schoolName: string;
}

interface CalendarEvent {
  id: number;
  schoolId: number;
  title: string;
  date: string;
  eventType: string;
  venue: string | null;
  description: string | null;
  colorCode: string | null;
  isRecurring: boolean;
}

type View = "month" | "week" | "year";

const DAYS        = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAYS_FULL   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS      = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const EVENT_TYPES = [
  { value: "holiday",     label: "Holiday",     color: "#ef4444", icon: Flame    },
  { value: "academic",    label: "Academic",     color: "#3b82f6", icon: BookOpen },
  { value: "examination", label: "Examination",  color: "#a855f7", icon: Award   },
  { value: "event",       label: "School Event", color: "#10b981", icon: Star    },
];

function getColor(ev: CalendarEvent) {
  return ev.colorCode || EVENT_TYPES.find(t => t.value === ev.eventType)?.color || "#10b981";
}
function getLabel(ev: CalendarEvent) {
  return EVENT_TYPES.find(t => t.value === ev.eventType)?.label || ev.eventType;
}
function buildKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
function isTodayFn(y: number, m: number, d: number) {
  const n = new Date();
  return n.getFullYear() === y && n.getMonth() === m && n.getDate() === d;
}
function getWeekStart(d: Date): Date {
  const s = new Date(d);
  s.setDate(d.getDate() - d.getDay());
  s.setHours(0,0,0,0);
  return s;
}
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
}

/* ─────────────────────────────────────────────────────────
   Premium event row — light theme
   Left amber date box · centre details · right pill badge
───────────────────────────────────────────────────────── */
function PremiumEventRow({
  ev,
  onClick,
  isToday = false,
}: {
  ev: CalendarEvent;
  onClick?: () => void;
  isToday?: boolean;
}) {
  const color  = getColor(ev);
  const label  = getLabel(ev);
  const d      = new Date(ev.date.split("T")[0] + "T00:00:00");
  const dayNum = d.getDate();
  const monthA = MONTHS_SHORT[d.getMonth()];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer group transition-colors hover:bg-slate-50"
      style={{
        background: isToday ? "#fffbeb" : "#ffffff",
        borderColor: isToday ? "rgba(217,119,6,0.35)" : "#e2e8f0",
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      }}
      onClick={onClick}
      data-testid={`event-row-${ev.id}`}
    >
      {/* Left: date anchor box */}
      <div
        className="flex-shrink-0 w-[52px] h-[52px] rounded-lg flex flex-col items-center justify-center"
        style={{
          border: `2px solid ${isToday ? "#D97706" : "rgba(217,119,6,0.55)"}`,
          background: isToday ? "#fef3c7" : "#fffbeb",
          boxShadow: isToday ? "0 0 10px rgba(217,119,6,0.18)" : "none",
        }}
      >
        <span className="text-xl font-black leading-none" style={{ color: "#92400e" }}>{dayNum}</span>
        <span className="text-[9px] font-bold tracking-widest uppercase mt-0.5" style={{ color: "#b45309" }}>{monthA}</span>
      </div>

      {/* Centre: event details */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 leading-snug truncate group-hover:text-slate-900 transition-colors">
          {ev.title}
        </p>
        {ev.description ? (
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">{ev.description}</p>
        ) : ev.venue ? (
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">📍 {ev.venue}</p>
        ) : (
          <p className="text-[11px] text-slate-400 mt-0.5">{DAYS_FULL[d.getDay()]}</p>
        )}
        {ev.isRecurring && (
          <div className="flex items-center gap-1 mt-1">
            <Repeat className="w-2.5 h-2.5 text-slate-300" />
            <span className="text-[9px] text-slate-400 tracking-wide">Recurring annually</span>
          </div>
        )}
      </div>

      {/* Right: event type pill */}
      <div className="flex-shrink-0 ml-1">
        <span
          className="text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
          style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}40` }}
        >
          {label}
        </span>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   Hover popover for month grid chips — light theme
───────────────────────────────────────────────────────── */
function HoverEventPopover({ ev, onClose }: { ev: CalendarEvent; onClose: () => void }) {
  const color = getColor(ev);
  const label = getLabel(ev);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 4 }}
      transition={{ duration: 0.15 }}
      className="absolute z-30 bottom-full left-0 mb-1 w-52 rounded-xl shadow-xl p-3 text-left bg-white"
      style={{ border: "1px solid #e2e8f0" }}
      onMouseLeave={onClose}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <p className="text-xs font-semibold text-slate-800 leading-tight">{ev.title}</p>
      </div>
      <p className="text-[10px] mb-1 capitalize font-medium" style={{ color }}>{label}</p>
      <p className="text-[10px] text-slate-400">{fmtDateLong(ev.date)}</p>
      {ev.isRecurring && (
        <div className="flex items-center gap-1 mt-1">
          <Repeat className="w-2.5 h-2.5 text-slate-300" />
          <span className="text-[9px] text-slate-400">Recurring annually</span>
        </div>
      )}
      {ev.description && (
        <p className="text-[10px] text-slate-500 mt-1 border-t border-slate-100 pt-1">{ev.description}</p>
      )}
    </motion.div>
  );
}

function EventChip({ ev }: { ev: CalendarEvent }) {
  const [hovered, setHovered] = useState(false);
  const color = getColor(ev);
  return (
    <div className="relative">
      <div
        className="px-1 py-0.5 rounded text-[9px] truncate font-medium cursor-pointer"
        style={{ backgroundColor: `${color}20`, color }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        data-testid={`event-chip-${ev.id}`}
      >
        {ev.title}
      </div>
      <AnimatePresence>
        {hovered ? <HoverEventPopover ev={ev} onClose={() => setHovered(false)} /> : null}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Main component
═══════════════════════════════════════════════════════ */
export default function StudentCalendar() {
  const [, setLocation] = useLocation();
  const today = new Date();
  const [view, setView]             = useState<View>("month");
  const [viewYear, setViewYear]     = useState(today.getFullYear());
  const [viewMonth, setViewMonth]   = useState(today.getMonth());
  const [weekStart, setWeekStart]   = useState(() => getWeekStart(today));
  const [selectedDay, setSelectedDay]         = useState<string | null>(null);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const monthQuery = useQuery<CalendarEvent[]>({
    queryKey: ["/api/student/calendar", viewMonth, viewYear],
    queryFn: async () => {
      const r = await fetch(`/api/student/calendar?month=${viewMonth}&year=${viewYear}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load calendar");
      return r.json();
    },
    enabled: !!student && view === "month",
    staleTime: 30000,
  });
  const yearQuery = useQuery<CalendarEvent[]>({
    queryKey: ["/api/student/calendar", "year", viewYear],
    queryFn: async () => {
      const r = await fetch(`/api/student/calendar?year=${viewYear}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load calendar");
      return r.json();
    },
    enabled: !!student && (view === "week" || view === "year"),
    staleTime: 30000,
  });

  const events        = view === "month" ? (monthQuery.data ?? []) : (yearQuery.data ?? []);
  const eventsLoading = view === "month" ? monthQuery.isLoading : yearQuery.isLoading;
  const isFetching    = view === "month" ? monthQuery.isFetching : yearQuery.isFetching;

  function refetch() {
    if (view === "month") monthQuery.refetch(); else yearQuery.refetch();
  }

  const eventsByDate = useMemo(() =>
    events.reduce<Record<string, CalendarEvent[]>>((acc, ev) => {
      const k = ev.date.split("T")[0];
      if (!acc[k]) acc[k] = [];
      acc[k].push(ev);
      return acc;
    }, {}), [events]);

  const calendarDays = useMemo(() => {
    const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [viewYear, viewMonth]);

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

  const sortedMonthEvents = useMemo(() =>
    events.slice().sort((a, b) => a.date.localeCompare(b.date)), [events]);

  const agendaGrouped = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    sortedMonthEvents.forEach(ev => {
      const k = ev.date.split("T")[0];
      if (!map[k]) map[k] = [];
      map[k].push(ev);
    });
    return map;
  }, [sortedMonthEvents]);

  const agendaDates    = useMemo(() => Object.keys(agendaGrouped).sort(), [agendaGrouped]);
  const todayKey       = buildKey(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  function prevMonth() { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1); } else setViewMonth(m => m-1); setSelectedDay(null); }
  function nextMonth() { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1); } else setViewMonth(m => m+1); setSelectedDay(null); }
  function prevWeek()  { const s = new Date(weekStart); s.setDate(s.getDate()-7); setWeekStart(s); setViewYear(s.getFullYear()); setSelectedDay(null); }
  function nextWeek()  { const s = new Date(weekStart); s.setDate(s.getDate()+7); setWeekStart(s); setViewYear(s.getFullYear()); setSelectedDay(null); }
  function switchView(v: View) {
    if (v === "week") { const ws = getWeekStart(new Date()); setWeekStart(ws); setViewYear(ws.getFullYear()); }
    setView(v); setSelectedDay(null);
  }
  function goToday() {
    const n = new Date();
    setViewMonth(n.getMonth()); setViewYear(n.getFullYear());
    setWeekStart(getWeekStart(n)); setSelectedDay(null);
  }
  function handleDayClick(key: string) {
    setSelectedDay(key);
    if (window.innerWidth < 1024) setBottomSheetOpen(true);
  }
  function navTitle() {
    if (view === "month") return `${MONTHS[viewMonth]} ${viewYear}`;
    if (view === "week") {
      const end = weekDays[6];
      const sameMonth = weekDays[0].getMonth() === end.getMonth();
      if (sameMonth) return `${MONTHS_SHORT[weekDays[0].getMonth()]} ${weekDays[0].getDate()}–${end.getDate()}, ${weekDays[0].getFullYear()}`;
      return `${MONTHS_SHORT[weekDays[0].getMonth()]} ${weekDays[0].getDate()} – ${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}, ${weekDays[0].getFullYear()}`;
    }
    return `${viewYear}`;
  }

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-9 h-9 animate-spin text-emerald-500" />
      </div>
    );
  }

  /* ─── view switcher ─── */
  const viewSwitcher = (
    <div
      className="flex items-center justify-center gap-0.5 rounded-xl p-1 bg-slate-100 border border-slate-200"
      data-testid="view-switcher"
    >
      {(["month","week","year"] as View[]).map(v => (
        <button
          key={v}
          onClick={() => switchView(v)}
          data-testid={`button-view-${v}`}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
            view === v
              ? "bg-white text-slate-800 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );

  /* ─── top header ─── */
  const topHeader = (
    <header
      className="sticky top-0 z-30"
      style={{
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        background: "rgba(255,255,255,0.92)",
        borderBottom: "1px solid #e2e8f0",
        boxShadow: "0 1px 12px rgba(0,0,0,0.07)",
      }}
    >
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
        <button
          onClick={() => setLocation("/student-dashboard")}
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 transition-colors hover:bg-slate-200 flex-shrink-0"
          data-testid="button-back"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #84cc16, #10b981)" }}
          >
            <CalendarDays className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight min-w-0">
            <p className="font-bold text-sm text-slate-800">School Calendar</p>
            <p className="text-[11px] text-slate-400 truncate">{student.schoolName}</p>
          </div>
        </div>

        {viewSwitcher}

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 border border-slate-200 transition-colors hover:bg-slate-200 disabled:opacity-50"
          data-testid="button-sync-now"
          aria-label="Sync"
        >
          <RefreshCw className={`w-4 h-4 text-slate-500 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>
    </header>
  );

  /* ─── month/week nav bar ─── */
  const monthNav = (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-100">
      <button
        onClick={view === "week" ? prevWeek : view === "year" ? () => { setViewYear(y => y-1); setSelectedDay(null); } : prevMonth}
        className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 border border-slate-200 text-slate-600 transition-colors hover:bg-slate-200"
        data-testid={view === "week" ? "button-prev-week" : view === "year" ? "button-prev-year" : "button-prev-month"}
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <div className="text-center">
        <p className="text-slate-800 font-bold text-base" data-testid="text-month-year">{navTitle()}</p>
        <button onClick={goToday} className="text-[10px] text-emerald-600 hover:text-emerald-700 transition-colors" data-testid="button-today">
          Today
        </button>
      </div>
      <button
        onClick={view === "week" ? nextWeek : view === "year" ? () => { setViewYear(y => y+1); setSelectedDay(null); } : nextMonth}
        className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 border border-slate-200 text-slate-600 transition-colors hover:bg-slate-200"
        data-testid={view === "week" ? "button-next-week" : view === "year" ? "button-next-year" : "button-next-month"}
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );

  /* ─── bottom sheet ─── */
  const bottomSheet = (
    <AnimatePresence>
      {bottomSheetOpen && selectedDay && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setBottomSheetOpen(false)} />
          <motion.div
            className="relative rounded-t-2xl overflow-hidden shadow-2xl max-h-[75vh] overflow-y-auto bg-white"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            data-testid="modal-event"
          >
            <div className="bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between sticky top-0">
              <div>
                <p className="text-slate-800 font-bold text-base">{fmtDateLong(selectedDay)}</p>
                <p className="text-slate-400 text-xs">{DAYS_FULL[new Date(selectedDay + "T00:00:00").getDay()]}</p>
              </div>
              <button
                onClick={() => setBottomSheetOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 border border-slate-200 text-slate-500 transition-colors"
                data-testid="button-close-modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-4 space-y-2.5 bg-slate-50">
              {selectedEvents.length === 0 ? (
                <div className="text-center py-10">
                  <Calendar className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="font-semibold text-slate-400">No events on this day</p>
                </div>
              ) : selectedEvents.map(ev => (
                <PremiumEventRow
                  key={ev.id}
                  ev={ev}
                  isToday={selectedDay === todayKey}
                />
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  /* ─── month grid ─── */
  const monthViewGrid = (
    <>
      <div className="grid grid-cols-7 bg-white border-b border-slate-100">
        {DAYS.map(d => (
          <div
            key={d}
            className={`py-2 text-center text-xs font-bold uppercase tracking-wide ${d === "Sun" ? "text-red-400" : "text-slate-400"}`}
          >
            {d}
          </div>
        ))}
      </div>

      {eventsLoading ? (
        <div className="flex items-center justify-center h-48 bg-white">
          <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
        </div>
      ) : (
        <div className="grid grid-cols-7 bg-white">
          {calendarDays.map((day, i) => {
            if (day === null) return (
              <div
                key={`e-${i}`}
                className="min-h-[72px] bg-slate-50/70 border-r border-b border-slate-100"
              />
            );
            const key          = buildKey(viewYear, viewMonth, day);
            const dayEvs       = eventsByDate[key] || [];
            const isCurrentDay = key === todayKey;
            const isSunday     = new Date(viewYear, viewMonth, day).getDay() === 0;
            const isHoliday    = dayEvs.some(e => e.eventType === "holiday");
            const isSelected   = selectedDay === key;

            return (
              <div
                key={key}
                onClick={() => handleDayClick(key)}
                data-testid={`cell-day-${day}`}
                className={`min-h-[72px] border-r border-b border-slate-100 p-1.5 cursor-pointer transition-colors
                  ${isHoliday ? "bg-red-50/60" : ""}
                  ${isSelected ? "bg-emerald-50" : "hover:bg-slate-50"}
                `}
              >
                <span
                  className="text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1"
                  style={
                    isCurrentDay
                      ? { background: "#10b981", color: "#fff", boxShadow: "0 0 0 3px rgba(16,185,129,0.2), 0 0 10px rgba(16,185,129,0.3)" }
                      : { color: isSunday || isHoliday ? "#ef4444" : "#475569" }
                  }
                  data-testid={`text-day-${day}`}
                >
                  {day}
                </span>
                <div className="space-y-0.5">
                  {dayEvs.slice(0, 2).map(ev => <EventChip key={ev.id} ev={ev} />)}
                  {dayEvs.length > 2 && (
                    <div className="text-[9px] text-slate-400 pl-1">+{dayEvs.length - 2}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  /* ─── week view ─── */
  const weekViewGrid = (
    <div
      className="rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm"
      data-testid="week-grid"
    >
      <div className="grid grid-cols-7">
        {weekDays.map(day => {
          const key       = buildKey(day.getFullYear(), day.getMonth(), day.getDate());
          const dayEvs    = eventsByDate[key] || [];
          const isToday   = isTodayFn(day.getFullYear(), day.getMonth(), day.getDate());
          const isSelected = selectedDay === key;
          const isSunday  = day.getDay() === 0;

          return (
            <div
              key={key}
              className={`flex flex-col border-r border-slate-100 last:border-0 ${isSelected ? "bg-emerald-50" : ""}`}
            >
              <div
                className={`py-2 px-1 text-center cursor-pointer transition-colors border-b border-slate-100 ${isToday ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                onClick={() => handleDayClick(key)}
              >
                <p className={`text-[10px] font-bold uppercase tracking-wide ${isSunday ? "text-red-400" : "text-slate-400"}`}>
                  {DAYS[day.getDay()]}
                </p>
                <span
                  className="w-7 h-7 flex items-center justify-center mx-auto rounded-full text-sm font-black mt-0.5"
                  style={
                    isToday
                      ? { background: "#10b981", color: "#fff", boxShadow: "0 0 0 3px rgba(16,185,129,0.2)" }
                      : { color: isSunday ? "#ef4444" : "#334155" }
                  }
                >
                  {day.getDate()}
                </span>
                <p className="text-[8px] text-slate-300 mt-0.5">{MONTHS_SHORT[day.getMonth()]}</p>
              </div>

              <div className="flex-1 p-1 space-y-1 min-h-[110px] cursor-pointer" onClick={() => handleDayClick(key)}>
                {dayEvs.map(ev => {
                  const color = getColor(ev);
                  return (
                    <div
                      key={ev.id}
                      className="p-1.5 rounded-lg text-[10px] font-semibold truncate"
                      style={{ backgroundColor: `${color}18`, color }}
                      data-testid={`week-event-${ev.id}`}
                    >
                      {ev.title}
                    </div>
                  );
                })}
                {dayEvs.length === 0 && (
                  <div className="flex items-center justify-center h-full pt-4">
                    <span className="text-[9px] text-slate-200">—</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /* ─── year / agenda view ─── */
  const yearViewAgenda = (
    <div
      className="rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm divide-y divide-slate-100"
      data-testid="year-agenda"
    >
      {eventsLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
        </div>
      ) : MONTHS.map((monthName, mi) => {
        const monthEvs = (yearGroupedByMonth[mi] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        return (
          <div key={mi} data-testid={`year-month-section-${mi}`}>
            <div
              className="sticky py-2.5 px-4 flex items-center gap-2.5 bg-white/95"
              style={{ top: "56px", zIndex: 10, borderBottom: "1px solid #f1f5f9" }}
              data-testid={`year-month-header-${mi}`}
            >
              <span className="text-sm font-black text-slate-700">{monthName}</span>
              <span className="text-xs text-slate-400">{viewYear}</span>
              <span className="ml-auto text-[10px] text-slate-400">
                {monthEvs.length} event{monthEvs.length !== 1 ? "s" : ""}
              </span>
            </div>
            {monthEvs.length === 0 ? (
              <p className="text-slate-300 text-xs px-4 py-3 italic">No events scheduled</p>
            ) : (
              <div className="px-3 py-2 space-y-2 bg-slate-50/40">
                {monthEvs.map(ev => {
                  const d = new Date(ev.date.split("T")[0] + "T00:00:00");
                  const isCurrentDay = isTodayFn(d.getFullYear(), d.getMonth(), d.getDate());
                  return (
                    <PremiumEventRow
                      key={ev.id}
                      ev={ev}
                      isToday={isCurrentDay}
                      onClick={() => handleDayClick(ev.date.split("T")[0])}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  /* ─── event legend ─── */
  const eventLegend = (
    <div className="rounded-2xl px-4 py-3 bg-white border border-slate-200 shadow-sm flex flex-wrap items-center gap-x-5 gap-y-2">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-2 flex items-center gap-1.5">
        <CalendarDays className="w-3 h-3 text-emerald-500" /> Legend
      </p>
      {EVENT_TYPES.map(t => (
        <div key={t.value} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
          <span className="text-xs text-slate-500">{t.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <span className="text-xs text-slate-500">Sunday</span>
      </div>
    </div>
  );

  /* ═══════════════════════════════════════════════════════
     MOBILE LAYOUT
  ═══════════════════════════════════════════════════════ */
  if (isMobile) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50" data-testid="student-calendar-mobile">
        {topHeader}
        <motion.main
          className="flex-1 max-w-xl mx-auto w-full px-3 pb-8"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          {/* nav + optional grid */}
          <div className="rounded-b-2xl overflow-hidden bg-white border border-slate-200 shadow-sm mb-4" style={{ borderTop: "none" }}>
            {monthNav}
            {view === "month" && monthViewGrid}
          </div>

          <div className="space-y-3">
            {/* ── Month agenda list ── */}
            {view === "month" && (
              eventsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
                </div>
              ) : agendaDates.length === 0 ? (
                <div className="rounded-2xl p-10 text-center bg-white border border-slate-200 shadow-sm">
                  <Calendar className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-400 font-medium">No events in {MONTHS[viewMonth]} {viewYear}</p>
                </div>
              ) : (
                <div className="rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm">
                  <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-100 bg-white">
                    <span className="text-xs font-black text-slate-700 uppercase tracking-widest">{MONTHS[viewMonth]} Events</span>
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
                      {sortedMonthEvents.length}
                    </span>
                  </div>
                  <div className="p-3 space-y-2 bg-slate-50/60">
                    {agendaDates.map(dateKey => {
                      const dayEvs       = agendaGrouped[dateKey];
                      const isCurrentDay = dateKey === todayKey;
                      return (
                        <div key={dateKey} data-testid={`agenda-group-${dateKey}`}>
                          {dayEvs.map(ev => (
                            <div key={ev.id} className="mb-2">
                              <PremiumEventRow
                                ev={ev}
                                isToday={isCurrentDay}
                                onClick={() => { setSelectedDay(dateKey); setBottomSheetOpen(true); }}
                              />
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            )}

            {view === "week" && weekViewGrid}
            {view === "year" && yearViewAgenda}
            {eventLegend}
          </div>
        </motion.main>
        {bottomSheet}
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════
     DESKTOP LAYOUT
  ═══════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen flex flex-col bg-slate-50" data-testid="student-calendar-desktop">
      {topHeader}
      <motion.main
        className="flex-1 max-w-5xl mx-auto w-full px-4 py-5 space-y-4"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >

        {/* ── MONTH VIEW ── */}
        {view === "month" && (
          <div className="grid grid-cols-3 gap-5">
            {/* Calendar grid */}
            <div className="col-span-2 rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm">
              {monthNav}
              {monthViewGrid}
            </div>

            {/* Right sidebar */}
            <div className="rounded-2xl overflow-hidden flex flex-col bg-white border border-slate-200 shadow-sm">
              <div className="px-4 py-3 flex items-center gap-2 border-b border-slate-100 shrink-0">
                <CalendarDays className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-bold text-slate-700">
                  {selectedDay ? fmtDateLong(selectedDay) : `${MONTHS[viewMonth]} Events`}
                </span>
                {!selectedDay && sortedMonthEvents.length > 0 && (
                  <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
                    {sortedMonthEvents.length}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/60">
                {!selectedDay ? (
                  sortedMonthEvents.length === 0 ? (
                    <div className="text-center py-10">
                      <Calendar className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                      <p className="text-slate-400 text-sm">No events this month</p>
                    </div>
                  ) : sortedMonthEvents.map(ev => (
                    <PremiumEventRow
                      key={ev.id}
                      ev={ev}
                      isToday={ev.date.split("T")[0] === todayKey}
                      onClick={() => setSelectedDay(ev.date.split("T")[0])}
                    />
                  ))
                ) : selectedEvents.length === 0 ? (
                  <div className="text-center py-10">
                    <Calendar className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">No events on this day</p>
                  </div>
                ) : selectedEvents.map(ev => (
                  <PremiumEventRow
                    key={ev.id}
                    ev={ev}
                    isToday={selectedDay === todayKey}
                  />
                ))}
              </div>

              {selectedDay && (
                <button
                  onClick={() => setSelectedDay(null)}
                  className="mx-3 mb-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200 transition-colors"
                  data-testid="button-back-to-month"
                >
                  ← All {MONTHS[viewMonth]} Events
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── WEEK VIEW ── */}
        {view === "week" && (
          <div className="space-y-4">
            <div className="rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm">
              {monthNav}
            </div>
            {eventsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
              </div>
            ) : weekViewGrid}
          </div>
        )}

        {/* ── YEAR VIEW ── */}
        {view === "year" && (
          <div className="space-y-4">
            <div className="rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm">
              {monthNav}
            </div>
            {yearViewAgenda}
          </div>
        )}

        {eventLegend}
      </motion.main>

      {(view === "month" || view === "week") && bottomSheet}
    </div>
  );
}
