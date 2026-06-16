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

const DAYS       = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAYS_FULL  = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS     = ["January","February","March","April","May","June","July","August","September","October","November","December"];
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
   Premium event row — date box + details + pill badge
───────────────────────────────────────────────────────── */
function PremiumEventRow({ ev, onClick, isToday = false }: { ev: CalendarEvent; onClick?: () => void; isToday?: boolean }) {
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
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors cursor-pointer group"
      style={{
        background: "rgba(26,41,66,0.85)",
        borderColor: isToday ? "rgba(212,175,55,0.35)" : "rgba(255,255,255,0.07)",
      }}
      onClick={onClick}
      data-testid={`event-row-${ev.id}`}
    >
      {/* Left: date anchor box */}
      <div
        className="flex-shrink-0 w-[52px] h-[52px] rounded-lg flex flex-col items-center justify-center"
        style={{
          border: `2px solid ${isToday ? "#D4AF37" : "rgba(212,175,55,0.45)"}`,
          background: "rgba(10,22,40,0.7)",
          boxShadow: isToday ? "0 0 12px rgba(212,175,55,0.2)" : "none",
        }}
      >
        <span className="text-xl font-black text-white leading-none">{dayNum}</span>
        <span className="text-[9px] font-bold tracking-widest text-amber-400 uppercase mt-0.5">{monthA}</span>
      </div>

      {/* Center: event details */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white leading-snug truncate group-hover:text-amber-100 transition-colors">
          {ev.title}
        </p>
        {ev.description ? (
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">{ev.description}</p>
        ) : ev.venue ? (
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">📍 {ev.venue}</p>
        ) : (
          <p className="text-[11px] text-slate-500 mt-0.5">{DAYS_FULL[d.getDay()]}</p>
        )}
        {ev.isRecurring && (
          <div className="flex items-center gap-1 mt-1">
            <Repeat className="w-2.5 h-2.5 text-slate-500" />
            <span className="text-[9px] text-slate-500 tracking-wide">Recurring annually</span>
          </div>
        )}
      </div>

      {/* Right: event type pill */}
      <div className="flex-shrink-0 ml-1">
        <span
          className="text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
          style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}40` }}
        >
          {label}
        </span>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   Hover popover for month grid chips
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
      className="absolute z-30 bottom-full left-0 mb-1 w-52 rounded-xl shadow-2xl p-3 text-left"
      style={{ background: "#1A2942", border: "1px solid rgba(212,175,55,0.2)" }}
      onMouseLeave={onClose}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <p className="text-xs font-semibold text-white leading-tight">{ev.title}</p>
      </div>
      <p className="text-[10px] mb-1 capitalize font-medium" style={{ color }}>{label}</p>
      <p className="text-[10px] text-slate-400">{fmtDateLong(ev.date)}</p>
      {ev.isRecurring && (
        <div className="flex items-center gap-1 mt-1">
          <Repeat className="w-2.5 h-2.5 text-slate-500" />
          <span className="text-[9px] text-slate-500">Recurring annually</span>
        </div>
      )}
      {ev.description && (
        <p className="text-[10px] text-slate-400 mt-1 border-t border-white/10 pt-1">{ev.description}</p>
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
        style={{ backgroundColor: `${color}30`, color }}
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
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
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

  const agendaDates  = useMemo(() => Object.keys(agendaGrouped).sort(), [agendaGrouped]);
  const todayKey     = buildKey(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  function prevMonth()  { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1); } else setViewMonth(m => m-1); setSelectedDay(null); }
  function nextMonth()  { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1); } else setViewMonth(m => m+1); setSelectedDay(null); }
  function prevWeek()   { const s = new Date(weekStart); s.setDate(s.getDate()-7); setWeekStart(s); setViewYear(s.getFullYear()); setSelectedDay(null); }
  function nextWeek()   { const s = new Date(weekStart); s.setDate(s.getDate()+7); setWeekStart(s); setViewYear(s.getFullYear()); setSelectedDay(null); }
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0A1628" }}>
        <Loader2 className="w-9 h-9 animate-spin text-amber-400" />
      </div>
    );
  }

  /* ─── view switcher ─── */
  const viewSwitcher = (
    <div
      className="flex items-center justify-center gap-0.5 rounded-xl p-1"
      style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
      data-testid="view-switcher"
    >
      {(["month","week","year"] as View[]).map(v => (
        <button
          key={v}
          onClick={() => switchView(v)}
          data-testid={`button-view-${v}`}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all"
          style={view === v
            ? { background: "#D4AF37", color: "#0A1628" }
            : { color: "rgba(255,255,255,0.5)" }
          }
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
        background: "rgba(10,22,40,0.9)",
        borderBottom: "1px solid rgba(212,175,55,0.15)",
        boxShadow: "0 2px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
        <button
          onClick={() => setLocation("/student-dashboard")}
          className="flex items-center justify-center w-10 h-10 rounded-xl transition-colors flex-shrink-0"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          data-testid="button-back"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-slate-300" />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4AF37, #10b981)" }}
          >
            <CalendarDays className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight min-w-0">
            <p className="font-bold text-sm text-white">School Calendar</p>
            <p className="text-[11px] text-slate-400 truncate">{student.schoolName}</p>
          </div>
        </div>

        {viewSwitcher}

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors disabled:opacity-50"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          data-testid="button-sync-now"
          aria-label="Sync"
        >
          <RefreshCw className={`w-4 h-4 text-slate-300 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>
    </header>
  );

  /* ─── month/week nav bar ─── */
  const monthNav = (
    <div
      className="flex items-center justify-between px-4 py-3"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(26,41,66,0.6)" }}
    >
      <button
        onClick={view === "week" ? prevWeek : view === "year" ? () => { setViewYear(y => y-1); setSelectedDay(null); } : prevMonth}
        className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
        data-testid={view === "week" ? "button-prev-week" : view === "year" ? "button-prev-year" : "button-prev-month"}
      >
        <ChevronLeft className="w-5 h-5 text-slate-300" />
      </button>
      <div className="text-center">
        <p className="text-white font-bold text-base" data-testid="text-month-year">{navTitle()}</p>
        <button onClick={goToday} className="text-[10px] text-amber-400 hover:text-amber-300 transition-colors" data-testid="button-today">
          Today
        </button>
      </div>
      <button
        onClick={view === "week" ? nextWeek : view === "year" ? () => { setViewYear(y => y+1); setSelectedDay(null); } : nextMonth}
        className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
        data-testid={view === "week" ? "button-next-week" : view === "year" ? "button-next-year" : "button-next-month"}
      >
        <ChevronRight className="w-5 h-5 text-slate-300" />
      </button>
    </div>
  );

  /* ─── bottom sheet (mobile event detail) ─── */
  const bottomSheet = (
    <AnimatePresence>
      {bottomSheetOpen && selectedDay && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.65)" }} onClick={() => setBottomSheetOpen(false)} />
          <motion.div
            className="relative rounded-t-2xl overflow-hidden shadow-2xl max-h-[75vh] overflow-y-auto"
            style={{ background: "#0F1E33", border: "1px solid rgba(212,175,55,0.2)" }}
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            data-testid="modal-event"
          >
            {/* sheet header */}
            <div
              className="px-5 py-4 flex items-center justify-between sticky top-0"
              style={{ background: "#0F1E33", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div>
                <p className="text-white font-bold text-base">{fmtDateLong(selectedDay)}</p>
                <p className="text-slate-400 text-xs">{DAYS_FULL[new Date(selectedDay + "T00:00:00").getDay()]}</p>
              </div>
              <button
                onClick={() => setBottomSheetOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                data-testid="button-close-modal"
              >
                <X className="w-4 h-4 text-slate-300" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-2.5">
              {selectedEvents.length === 0 ? (
                <div className="text-center py-10">
                  <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="font-semibold text-slate-400">No events on this day</p>
                </div>
              ) : selectedEvents.map(ev => (
                <PremiumEventRow
                  key={ev.id}
                  ev={ev}
                  isToday={selectedDay === todayKey}
                  data-testid={`modal-event-detail-${ev.id}`}
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
      {/* day-of-week headers */}
      <div
        className="grid grid-cols-7"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        {DAYS.map(d => (
          <div
            key={d}
            className={`py-2 text-center text-xs font-bold uppercase tracking-wide ${d === "Sun" ? "text-red-400" : "text-slate-500"}`}
          >
            {d}
          </div>
        ))}
      </div>

      {eventsLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
        </div>
      ) : (
        <div className="grid grid-cols-7">
          {calendarDays.map((day, i) => {
            if (day === null) return (
              <div
                key={`e-${i}`}
                className="min-h-[72px]"
                style={{ borderRight: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.1)" }}
              />
            );
            const key = buildKey(viewYear, viewMonth, day);
            const dayEvs      = eventsByDate[key] || [];
            const isCurrentDay = key === todayKey;
            const isSunday    = new Date(viewYear, viewMonth, day).getDay() === 0;
            const isHoliday   = dayEvs.some(e => e.eventType === "holiday");
            const isSelected  = selectedDay === key;

            return (
              <div
                key={key}
                onClick={() => handleDayClick(key)}
                data-testid={`cell-day-${day}`}
                className="min-h-[72px] p-1.5 cursor-pointer transition-colors"
                style={{
                  borderRight: "1px solid rgba(255,255,255,0.05)",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  background: isSelected
                    ? "rgba(212,175,55,0.08)"
                    : isHoliday
                    ? "rgba(239,68,68,0.07)"
                    : "transparent",
                }}
              >
                <span
                  className="text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1"
                  style={
                    isCurrentDay
                      ? { background: "#D4AF37", color: "#0A1628", boxShadow: "0 0 10px rgba(212,175,55,0.4)" }
                      : isSunday || isHoliday
                      ? { color: "#ef4444" }
                      : { color: "rgba(255,255,255,0.65)" }
                  }
                  data-testid={`text-day-${day}`}
                >
                  {day}
                </span>
                <div className="space-y-0.5">
                  {dayEvs.slice(0, 2).map(ev => <EventChip key={ev.id} ev={ev} />)}
                  {dayEvs.length > 2 && (
                    <div className="text-[9px] text-slate-500 pl-1">+{dayEvs.length - 2}</div>
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
      className="rounded-2xl overflow-hidden"
      style={{ background: "rgba(26,41,66,0.7)", border: "1px solid rgba(255,255,255,0.07)" }}
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
              className="flex flex-col"
              style={{
                borderRight: "1px solid rgba(255,255,255,0.06)",
                background: isSelected ? "rgba(212,175,55,0.07)" : "transparent",
              }}
            >
              {/* day header */}
              <div
                className="py-2 px-1 text-center cursor-pointer transition-colors"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
                onClick={() => handleDayClick(key)}
              >
                <p className={`text-[10px] font-bold uppercase tracking-wide ${isSunday ? "text-red-400" : "text-slate-500"}`}>
                  {DAYS[day.getDay()]}
                </p>
                <span
                  className="w-7 h-7 flex items-center justify-center mx-auto rounded-full text-sm font-black mt-0.5"
                  style={
                    isToday
                      ? { background: "#D4AF37", color: "#0A1628", boxShadow: "0 0 10px rgba(212,175,55,0.4)" }
                      : { color: isSunday ? "#ef4444" : "rgba(255,255,255,0.8)" }
                  }
                >
                  {day.getDate()}
                </span>
                <p className="text-[8px] text-slate-600 mt-0.5">{MONTHS_SHORT[day.getMonth()]}</p>
              </div>

              {/* events */}
              <div className="flex-1 p-1 space-y-1 min-h-[110px] cursor-pointer" onClick={() => handleDayClick(key)}>
                {dayEvs.map(ev => {
                  const color = getColor(ev);
                  return (
                    <div
                      key={ev.id}
                      className="p-1.5 rounded-lg text-[10px] font-semibold truncate"
                      style={{ backgroundColor: `${color}25`, color }}
                      data-testid={`week-event-${ev.id}`}
                    >
                      {ev.title}
                    </div>
                  );
                })}
                {dayEvs.length === 0 && (
                  <div className="flex items-center justify-center h-full pt-4">
                    <span className="text-[9px] text-slate-700">—</span>
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
      className="rounded-2xl overflow-hidden"
      style={{ background: "rgba(26,41,66,0.5)", border: "1px solid rgba(255,255,255,0.07)" }}
      data-testid="year-agenda"
    >
      {eventsLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
        </div>
      ) : MONTHS.map((monthName, mi) => {
        const monthEvs = (yearGroupedByMonth[mi] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        return (
          <div key={mi} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }} data-testid={`year-month-section-${mi}`}>
            {/* month header */}
            <div
              className="sticky py-2.5 px-4 flex items-center gap-2.5"
              style={{
                top: "56px",
                zIndex: 10,
                background: "rgba(10,22,40,0.95)",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
              data-testid={`year-month-header-${mi}`}
            >
              <span className="text-sm font-black text-white">{monthName}</span>
              <span className="text-xs text-slate-500">{viewYear}</span>
              <span className="ml-auto text-[10px] text-slate-600">
                {monthEvs.length} event{monthEvs.length !== 1 ? "s" : ""}
              </span>
            </div>

            {monthEvs.length === 0 ? (
              <p className="text-slate-700 text-xs px-4 py-3 italic">No events scheduled</p>
            ) : (
              <div className="px-3 py-2 space-y-2">
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

  /* ─────────────────────────────────────────────────────────
     EVENT LEGEND
  ───────────────────────────────────────────────────────── */
  const eventLegend = (
    <div
      className="rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2"
      style={{ background: "rgba(26,41,66,0.5)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mr-2 flex items-center gap-1.5">
        <CalendarDays className="w-3 h-3 text-amber-500" /> Legend
      </p>
      {EVENT_TYPES.map(t => (
        <div key={t.value} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
          <span className="text-xs text-slate-400">{t.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
        <span className="text-xs text-slate-400">Sunday</span>
      </div>
    </div>
  );

  /* ═══════════════════════════════════════════════════════
     MOBILE LAYOUT
  ═══════════════════════════════════════════════════════ */
  if (isMobile) {
    return (
      <div
        className="min-h-screen flex flex-col"
        style={{ background: "#0A1628" }}
        data-testid="student-calendar-mobile"
      >
        {topHeader}
        <motion.main
          className="flex-1 max-w-xl mx-auto w-full px-3 pb-8"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          {/* nav */}
          <div
            className="rounded-b-2xl overflow-hidden mb-4"
            style={{ border: "1px solid rgba(255,255,255,0.07)", borderTop: "none" }}
          >
            {monthNav}
            {/* month grid for month view */}
            {view === "month" && (
              <div style={{ background: "rgba(26,41,66,0.5)" }}>
                {monthViewGrid}
              </div>
            )}
          </div>

          <div className="space-y-3">
            {/* ── Month agenda list ── */}
            {view === "month" && (
              eventsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
                </div>
              ) : agendaDates.length === 0 ? (
                <div
                  className="rounded-2xl p-10 text-center"
                  style={{ background: "rgba(26,41,66,0.5)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400 font-medium">No events in {MONTHS[viewMonth]} {viewYear}</p>
                </div>
              ) : (
                <div
                  className="rounded-2xl overflow-hidden"
                  style={{ border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  {/* section header */}
                  <div
                    className="px-4 py-2.5 flex items-center gap-2"
                    style={{ background: "rgba(10,22,40,0.8)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <span className="text-xs font-black text-white uppercase tracking-widest">{MONTHS[viewMonth]} Events</span>
                    <span
                      className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(212,175,55,0.15)", color: "#D4AF37" }}
                    >
                      {sortedMonthEvents.length}
                    </span>
                  </div>
                  <div className="p-3 space-y-2" style={{ background: "rgba(26,41,66,0.4)" }}>
                    {agendaDates.map(dateKey => {
                      const dayEvs     = agendaGrouped[dateKey];
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

            {view === "week"  && weekViewGrid}
            {view === "year"  && yearViewAgenda}
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
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#0A1628" }}
      data-testid="student-calendar-desktop"
    >
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
            <div
              className="col-span-2 rounded-2xl overflow-hidden"
              style={{ background: "rgba(26,41,66,0.7)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              {monthNav}
              {monthViewGrid}
            </div>

            {/* Right sidebar: event list */}
            <div
              className="rounded-2xl overflow-hidden flex flex-col"
              style={{ background: "rgba(26,41,66,0.7)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              {/* sidebar header */}
              <div
                className="px-4 py-3 flex items-center gap-2 shrink-0"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
              >
                <CalendarDays className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-bold text-white">
                  {selectedDay ? fmtDateLong(selectedDay) : `${MONTHS[viewMonth]} Events`}
                </span>
                {!selectedDay && sortedMonthEvents.length > 0 && (
                  <span
                    className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(212,175,55,0.15)", color: "#D4AF37" }}
                  >
                    {sortedMonthEvents.length}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {!selectedDay ? (
                  sortedMonthEvents.length === 0 ? (
                    <div className="text-center py-10">
                      <Calendar className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                      <p className="text-slate-500 text-sm">No events this month</p>
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
                    <Calendar className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                    <p className="text-slate-500 text-sm">No events on this day</p>
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
                  className="mx-3 mb-3 py-2 text-xs font-semibold rounded-xl transition-colors"
                  style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}
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
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: "rgba(26,41,66,0.7)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              {monthNav}
            </div>
            {eventsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
              </div>
            ) : weekViewGrid}
          </div>
        )}

        {/* ── YEAR VIEW ── */}
        {view === "year" && (
          <div className="space-y-4">
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: "rgba(26,41,66,0.7)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
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
