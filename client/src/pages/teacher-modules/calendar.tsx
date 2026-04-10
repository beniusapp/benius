import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, Loader2, Calendar, CalendarDays,
  Flame, BookOpen, Award, Star, Repeat, RefreshCw, X,
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
  { value: "holiday", label: "Holiday", color: "#ef4444", icon: Flame },
  { value: "academic", label: "Academic", color: "#3b82f6", icon: BookOpen },
  { value: "examination", label: "Examination", color: "#3b82f6", icon: Award },
  { value: "event", label: "Event", color: "#10b981", icon: Star },
];

function getColor(ev: CalendarEvent) {
  return ev.colorCode || EVENT_TYPES.find(t => t.value === ev.eventType)?.color || "#10b981";
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

function HoverEventPopover({ ev, onClose }: { ev: CalendarEvent; onClose: () => void }) {
  const color = getColor(ev);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 4 }}
      transition={{ duration: 0.15 }}
      className="absolute z-30 bottom-full left-0 mb-1 w-52 rounded-xl border border-white/10 shadow-xl p-3 text-left"
      style={{ background: "#1a2942" }}
      onMouseLeave={onClose}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <p className="text-xs font-semibold text-white leading-tight">{ev.title}</p>
      </div>
      <p className="text-[10px] mb-1" style={{ color }}><EventTypeLabel eventType={ev.eventType} /></p>
      <p className="text-[10px] text-white/40">{formatDate(ev.date)}</p>
      {ev.isRecurring && (
        <div className="flex items-center gap-1 mt-1">
          <Repeat className="w-2.5 h-2.5 text-white/30" />
          <span className="text-[9px] text-white/30">Recurring annually</span>
        </div>
      )}
      {ev.description && (
        <p className="text-[10px] text-white/40 mt-1 border-t border-white/10 pt-1">{ev.description}</p>
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
        style={{ backgroundColor: `${color}22`, color }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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

export default function CalendarModule({ teacher }: { teacher: TeacherMe }) {
  const now = new Date();
  const [view, setView] = useState<View>("month");
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [weekStart, setWeekStart] = useState(() => getWeekStart(now));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  /* ── Month query (Month view) ── */
  const monthQuery = useQuery<CalendarEvent[]>({
    queryKey: ["/api/teacher/calendar", month + 1, year],
    queryFn: async () => {
      const r = await fetch(`/api/teacher/calendar?month=${month + 1}&year=${year}`, { credentials:"include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: view === "month",
    staleTime: 30000,
  });

  /* ── Year query (Week + Year views) ── */
  const yearQuery = useQuery<CalendarEvent[]>({
    queryKey: ["/api/teacher/calendar", "year", year],
    queryFn: async () => {
      const r = await fetch(`/api/teacher/calendar?year=${year}`, { credentials:"include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: view === "week" || view === "year",
    staleTime: 30000,
  });

  const events = view === "month" ? (monthQuery.data ?? []) : (yearQuery.data ?? []);
  const isLoading = view === "month" ? monthQuery.isLoading : yearQuery.isLoading;
  const isFetching = view === "month" ? monthQuery.isFetching : yearQuery.isFetching;
  const isError = view === "month" ? monthQuery.isError : yearQuery.isError;

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

  /* ── Week view: 7 days starting from weekStart ── */
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }, [weekStart]);

  /* ── Year/Agenda view: group by month ── */
  const yearGroupedByMonth = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {};
    events.forEach(ev => {
      const m = new Date(ev.date.split("T")[0] + "T00:00:00").getMonth();
      if (!map[m]) map[m] = [];
      map[m].push(ev);
    });
    return map;
  }, [events]);

  /* ── Month view agenda (mobile) ── */
  const sortedMonthEvents = useMemo(() =>
    events.slice().sort((a, b) => a.date.localeCompare(b.date)), [events]);
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

  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];
  const holidayCount = view === "month"
    ? events.filter(e => e.eventType === "holiday").length
    : 0;

  /* ── Navigation helpers ── */
  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
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
    if (v === "week") {
      const ws = getWeekStart(new Date());
      setWeekStart(ws); setYear(ws.getFullYear());
    }
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

  /* ── Title for navigation bar ── */
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

  /* ═══════════════ VIEW SWITCHER ═══════════════ */
  const viewSwitcher = (
    <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5" data-testid="view-switcher">
      {(["month","week","year"] as View[]).map(v => (
        <button
          key={v}
          onClick={() => switchView(v)}
          data-testid={`button-view-${v}`}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all capitalize ${
            view === v
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "text-white/40 hover:text-white/70"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );

  /* ═══════════════ NAV BAR ═══════════════ */
  const navBar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-white" data-testid="heading-teacher-calendar">School Calendar</h2>
        <p className="text-white/40 text-sm">
          {view === "month" ? `${events.length} events · ${holidayCount} holidays this month` :
           view === "week" ? `${weekDays.map(d => buildKey(d.getFullYear(),d.getMonth(),d.getDate())).reduce((c,k) => c + (eventsByDate[k]?.length || 0), 0)} events this week` :
           `${events.length} events in ${year}`}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {viewSwitcher}
        <button
          onClick={refetch}
          disabled={isFetching}
          data-testid="button-sync-now"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/50 text-sm hover:text-white hover:border-white/20 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </button>
        <button onClick={view === "week" ? prevWeek : view === "year" ? () => { setYear(y => y - 1); setSelectedDay(null); } : prevMonth}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          data-testid={view === "week" ? "button-prev-week" : view === "year" ? "button-prev-year" : "button-prev-month"}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-white font-semibold min-w-[150px] text-center text-sm" data-testid="text-calendar-title">
          {navTitle()}
        </span>
        <button onClick={view === "week" ? nextWeek : view === "year" ? () => { setYear(y => y + 1); setSelectedDay(null); } : nextMonth}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          data-testid={view === "week" ? "button-next-week" : view === "year" ? "button-next-year" : "button-next-month"}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={goToday}
          className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-colors"
          data-testid="button-today"
        >
          Today
        </button>
      </div>
    </div>
  );

  /* ═══════════════ LEGEND ═══════════════ */
  const legend = (
    <div className="flex items-center gap-4 flex-wrap">
      {EVENT_TYPES.map(t => (
        <div key={t.value} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
          <span className="text-xs text-white/40">{t.label}</span>
        </div>
      ))}
    </div>
  );

  /* ═══════════════ BOTTOM SHEET ═══════════════ */
  const bottomSheet = (
    <AnimatePresence>
      {bottomSheetOpen && selectedDay && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setBottomSheetOpen(false)} />
          <motion.div
            className="relative rounded-t-2xl border-t border-white/10 shadow-2xl max-h-[70vh] overflow-y-auto"
            style={{ background: "#1A2942" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 sticky top-0 bg-[#1A2942]">
              <div>
                <p className="text-base font-bold text-white">{formatDate(selectedDay)}</p>
                <p className="text-xs text-white/40">{DAYS_FULL[new Date(selectedDay + "T00:00:00").getDay()]}</p>
              </div>
              <button
                onClick={() => setBottomSheetOpen(false)}
                className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                data-testid="button-close-bottom-sheet"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {selectedEvents.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-10 h-10 text-white/10 mx-auto mb-3" />
                  <p className="text-white/30">No events on this day</p>
                </div>
              ) : selectedEvents.map(ev => (
                <div
                  key={ev.id}
                  className="p-3 rounded-xl border border-white/5"
                  style={{ borderLeftColor: getColor(ev), borderLeftWidth: 3, background: `${getColor(ev)}10` }}
                  data-testid={`bottom-sheet-event-${ev.id}`}
                >
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-semibold text-white">{ev.title}</p>
                    {ev.isRecurring && <Repeat className="w-3.5 h-3.5 text-white/30 mt-0.5" />}
                  </div>
                  <p className="text-xs mt-1" style={{ color: getColor(ev) }}>
                    <EventTypeLabel eventType={ev.eventType} />
                  </p>
                  {ev.description && <p className="text-xs text-white/40 mt-1">{ev.description}</p>}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  /* ═══════════════ MONTH VIEW ═══════════════ */
  const monthView = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 bg-[#1A2942] rounded-xl border border-white/10 overflow-hidden">
        <div className="grid grid-cols-7">
          {DAYS.map(d => (
            <div key={d} className="py-2 text-center text-[11px] font-medium text-white/30 border-b border-white/5">{d}</div>
          ))}
          {isLoading ? (
            <div className="col-span-7 flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-white/40" />
            </div>
          ) : calendarDays.map((day, i) => {
            if (day === null) {
              return <div key={`e-${i}`} className="min-h-[68px] border-b border-r border-white/5 bg-white/[0.01]" />;
            }
            const key = buildKey(year, month, day);
            const dayEvs = eventsByDate[key] || [];
            const today = isTodayFn(year, month, day);
            const isSelected = selectedDay === key;
            const hasHoliday = dayEvs.some(e => e.eventType === "holiday");

            return (
              <div
                key={key}
                onClick={() => handleDayClick(key)}
                data-testid={`cell-day-${day}`}
                className={`min-h-[68px] border-b border-r border-white/5 p-1.5 cursor-pointer transition-colors
                  ${hasHoliday ? "bg-red-500/5" : ""}
                  ${isSelected ? "bg-emerald-500/10" : "hover:bg-white/5"}
                `}
              >
                <span
                  className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1
                    ${today ? "bg-emerald-500 text-white font-bold" : "text-white/50"}
                  `}
                  style={today ? { boxShadow: "0 0 0 3px rgba(16,185,129,0.25), 0 0 12px rgba(16,185,129,0.35)" } : {}}
                  data-testid={`text-day-${day}`}
                >
                  {day}
                </span>
                <div className="space-y-0.5">
                  {dayEvs.slice(0, 2).map(ev => <EventChip key={ev.id} ev={ev} />)}
                  {dayEvs.length > 2 && <div className="text-[9px] text-white/30 pl-1">+{dayEvs.length - 2}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hidden lg:block bg-[#1A2942] rounded-xl border border-white/10 p-4">
        <h4 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-emerald-400" />
          {selectedDay ? formatDate(selectedDay) : "Click a day to view"}
        </h4>
        {!selectedDay ? (
          <div className="space-y-2 mt-4">
            <p className="text-xs text-white/30 mb-3">Upcoming events this month:</p>
            {events.length === 0 ? (
              <p className="text-white/20 text-sm text-center py-4">No events this month</p>
            ) : events.slice().sort((a,b) => a.date.localeCompare(b.date)).slice(0,8).map(ev => (
              <div key={ev.id} className="flex items-center gap-2" data-testid={`sidebar-event-${ev.id}`}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getColor(ev) }} />
                <span className="text-xs text-white/40 shrink-0">{new Date(ev.date + "T00:00:00").getDate()}</span>
                <span className="text-xs text-white/60 truncate">{ev.title}</span>
                {ev.isRecurring && <Repeat className="w-3 h-3 text-white/20 shrink-0" />}
              </div>
            ))}
          </div>
        ) : selectedEvents.length === 0 ? (
          <div className="text-center py-8">
            <Calendar className="w-8 h-8 text-white/10 mx-auto mb-2" />
            <p className="text-white/30 text-sm">No events on this day</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {selectedEvents.map(ev => (
              <motion.div
                key={ev.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="p-3 rounded-lg bg-white/5 border border-white/5"
                style={{ borderLeftColor: getColor(ev), borderLeftWidth: 3 }}
                data-testid={`event-detail-${ev.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-white" data-testid={`text-event-title-${ev.id}`}>{ev.title}</p>
                  {ev.isRecurring && <Repeat className="w-3.5 h-3.5 text-white/30 shrink-0 mt-0.5" />}
                </div>
                <p className="text-[11px] mt-1" style={{ color: getColor(ev) }}>
                  <EventTypeLabel eventType={ev.eventType} />
                </p>
                {ev.description && <p className="text-[11px] text-white/40 mt-1">{ev.description}</p>}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  /* ═══════════════ WEEK VIEW ═══════════════ */
  const weekView = (
    <div className="space-y-3">
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
      ) : (
        <div
          className={`${isMobile ? "overflow-x-auto" : ""} rounded-xl border border-white/10 overflow-hidden`}
          data-testid="week-grid"
        >
          <div className={`${isMobile ? "flex min-w-[700px]" : "grid grid-cols-7"} bg-[#1A2942]`}>
            {weekDays.map(day => {
              const key = buildKey(day.getFullYear(), day.getMonth(), day.getDate());
              const dayEvs = eventsByDate[key] || [];
              const today = isTodayFn(day.getFullYear(), day.getMonth(), day.getDate());
              const isSelected = selectedDay === key;
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              const hasHoliday = dayEvs.some(e => e.eventType === "holiday");

              return (
                <div
                  key={key}
                  className={`${isMobile ? "min-w-[100px] flex-1" : ""} flex flex-col border-r border-white/5 last:border-0
                    ${hasHoliday ? "bg-red-500/5" : ""} ${isSelected ? "bg-emerald-500/10" : ""}
                  `}
                >
                  <div
                    className={`py-2 px-1.5 text-center border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors ${today ? "bg-emerald-500/10" : ""}`}
                    onClick={() => handleDayClick(key)}
                  >
                    <p className="text-[10px] text-white/40 font-medium">{DAYS[day.getDay()]}</p>
                    <span
                      className={`w-7 h-7 flex items-center justify-center mx-auto rounded-full text-sm font-bold mt-0.5
                        ${today ? "bg-emerald-500 text-white" : isWeekend ? "text-red-400/70" : "text-white/60"}
                      `}
                      style={today ? { boxShadow: "0 0 0 3px rgba(16,185,129,0.25), 0 0 12px rgba(16,185,129,0.35)" } : {}}
                      data-testid={`week-day-${key}`}
                    >
                      {day.getDate()}
                    </span>
                    <p className="text-[9px] text-white/20 mt-0.5">{MONTHS_SHORT[day.getMonth()]}</p>
                  </div>
                  <div className="flex-1 p-1 space-y-1 min-h-[120px] cursor-pointer" onClick={() => handleDayClick(key)}>
                    {dayEvs.map(ev => {
                      const color = getColor(ev);
                      return (
                        <div
                          key={ev.id}
                          className="p-1.5 rounded-lg text-[10px] font-medium truncate"
                          style={{ backgroundColor: `${color}20`, color }}
                          data-testid={`week-event-${ev.id}`}
                        >
                          {ev.title}
                        </div>
                      );
                    })}
                    {dayEvs.length === 0 && (
                      <div className="flex items-center justify-center h-full pt-4">
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

  /* ═══════════════ YEAR / AGENDA VIEW ═══════════════ */
  const yearView = (
    <div className="space-y-6" data-testid="year-agenda">
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
      ) : MONTHS.map((monthName, mi) => {
        const monthEvs = (yearGroupedByMonth[mi] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        return (
          <div key={mi} data-testid={`year-month-section-${mi}`}>
            <div className="sticky top-0 z-10 py-2 px-1 flex items-center gap-2 border-b border-white/10 mb-3"
              style={{ background: "rgba(10,22,40,0.95)" }}
              data-testid={`year-month-header-${mi}`}
            >
              <span className="text-sm font-bold text-white">{monthName}</span>
              <span className="text-xs text-white/30">{year}</span>
              <span className="ml-auto text-[10px] text-white/20">{monthEvs.length} event{monthEvs.length !== 1 ? "s" : ""}</span>
            </div>
            {monthEvs.length === 0 ? (
              <p className="text-white/20 text-xs px-1 py-2">No events scheduled</p>
            ) : (
              <div className="space-y-2">
                {monthEvs.map(ev => {
                  const color = getColor(ev);
                  const d = new Date(ev.date.split("T")[0] + "T00:00:00");
                  const isCurrentDay = isTodayFn(d.getFullYear(), d.getMonth(), d.getDate());
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                      onClick={() => handleDayClick(ev.date.split("T")[0])}
                      data-testid={`year-event-${ev.id}`}
                    >
                      <div className="w-10 text-center shrink-0">
                        <p className="text-[10px] text-white/30 uppercase">{DAYS[d.getDay()]}</p>
                        <p className={`text-lg font-bold leading-tight ${isCurrentDay ? "text-emerald-400" : "text-white/50"}`}
                          style={isCurrentDay ? { textShadow: "0 0 8px rgba(16,185,129,0.5)" } : {}}>
                          {d.getDate()}
                        </p>
                      </div>
                      <div className="w-0.5 h-10 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{ev.title}</p>
                        <p className="text-[11px] capitalize" style={{ color }}>
                          <EventTypeLabel eventType={ev.eventType} />
                        </p>
                        {ev.description && <p className="text-[10px] text-white/30 truncate">{ev.description}</p>}
                      </div>
                      {ev.isRecurring && <Repeat className="w-3 h-3 text-white/20 shrink-0" />}
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

  /* ═══════════════ MOBILE MONTH AGENDA ═══════════════ */
  if (isMobile && view === "month") {
    return (
      <div className="space-y-4" data-testid="teacher-calendar-mobile">
        {navBar}
        {legend}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
        ) : agendaDates.length === 0 ? (
          <div className="text-center py-12 rounded-xl bg-white/5 border border-white/10">
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
                    className={`flex items-center gap-2 mb-2 px-1 w-full text-left rounded-lg hover:bg-white/5 transition-colors min-h-[44px] ${isCurrentDay ? "text-emerald-400" : "text-white/40"}`}
                    onClick={() => { setSelectedDay(dateKey); setBottomSheetOpen(true); }}
                    data-testid={`agenda-date-header-${dateKey}`}
                  >
                    <span className="text-xs font-bold uppercase tracking-widest">
                      {d.toLocaleDateString("en-GB", { day:"2-digit", month:"short" })}
                    </span>
                    <span className="text-xs">{DAYS_FULL[d.getDay()]}</span>
                    {isCurrentDay && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full">Today</span>}
                    <span className="ml-auto text-[10px] text-white/20">{dayEvs.length} event{dayEvs.length !== 1 ? "s" : ""} ›</span>
                  </button>
                  <div className="space-y-2">
                    {dayEvs.map(ev => {
                      const color = getColor(ev);
                      return (
                        <div
                          key={ev.id}
                          className="p-3 rounded-xl border border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                          style={{ borderLeftColor: color, borderLeftWidth: 3, background: `${color}10` }}
                          data-testid={`mobile-event-detail-${ev.id}`}
                          onClick={() => { setSelectedDay(dateKey); setBottomSheetOpen(true); }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold text-white">{ev.title}</p>
                            {ev.isRecurring && <Repeat className="w-3.5 h-3.5 text-white/30 mt-0.5 shrink-0" />}
                          </div>
                          <p className="text-xs mt-1 capitalize" style={{ color }}>
                            <EventTypeLabel eventType={ev.eventType} />
                          </p>
                          {ev.description && <p className="text-xs text-white/40 mt-1">{ev.description}</p>}
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

  /* ═══════════════ MAIN (Desktop + Week/Year mobile) ═══════════════ */
  return (
    <div className="space-y-5" data-testid="teacher-calendar-desktop">
      {navBar}
      {view !== "year" && legend}
      {view === "month" && monthView}
      {view === "week" && weekView}
      {view === "year" && yearView}
      {(view === "month" || view === "week") && bottomSheet}
    </div>
  );
}
