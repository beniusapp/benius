import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { fmtDateLong, fmtDateShort } from "@/lib/dateUtils";
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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const EVENT_TYPES = [
  { value: "holiday", label: "Holiday", color: "#ef4444", icon: Flame },
  { value: "academic", label: "Academic", color: "#3b82f6", icon: BookOpen },
  { value: "examination", label: "Examination", color: "#3b82f6", icon: Award },
  { value: "event", label: "School Event", color: "#10b981", icon: Star },
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

function HoverEventPopover({ ev, onClose }: { ev: CalendarEvent; onClose: () => void }) {
  const color = getColor(ev);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 4 }}
      transition={{ duration: 0.15 }}
      className="absolute z-30 bottom-full left-0 mb-1 w-52 rounded-xl border border-emerald-100 shadow-xl p-3 text-left bg-white"
      onMouseLeave={onClose}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <p className="text-xs font-semibold text-gray-800 leading-tight">{ev.title}</p>
      </div>
      <p className="text-[10px] mb-1 capitalize font-medium" style={{ color }}>
        {EVENT_TYPES.find(t => t.value === ev.eventType)?.label || ev.eventType}
      </p>
      <p className="text-[10px] text-gray-400">{fmtDateLong(ev.date)}</p>
      {ev.isRecurring && (
        <div className="flex items-center gap-1 mt-1">
          <Repeat className="w-2.5 h-2.5 text-gray-300" />
          <span className="text-[9px] text-gray-400">Recurring annually</span>
        </div>
      )}
      {ev.description && (
        <p className="text-[10px] text-gray-500 mt-1 border-t border-gray-100 pt-1">{ev.description}</p>
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
        {hovered ? <HoverEventPopover ev={ev} onClose={() => setHovered(false)} /> : null}
      </AnimatePresence>
    </div>
  );
}

export default function StudentCalendar() {
  const [, setLocation] = useLocation();
  const today = new Date();
  const [view, setView] = useState<View>("month");
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  /* ── Month query ── */
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

  /* ── Year query (Week + Year views) ── */
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

  const events = view === "month" ? (monthQuery.data ?? []) : (yearQuery.data ?? []);
  const eventsLoading = view === "month" ? monthQuery.isLoading : yearQuery.isLoading;
  const isFetching = view === "month" ? monthQuery.isFetching : yearQuery.isFetching;

  function refetch() {
    if (view === "month") monthQuery.refetch();
    else yearQuery.refetch();
  }

  const eventsByDate = useMemo(() => {
    return events.reduce<Record<string, CalendarEvent[]>>((acc, ev) => {
      const k = ev.date.split("T")[0];
      if (!acc[k]) acc[k] = [];
      acc[k].push(ev);
      return acc;
    }, {});
  }, [events]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [viewYear, viewMonth]);

  /* ── Week view days ── */
  const weekDays = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    }), [weekStart]);

  /* ── Year agenda grouped by month ── */
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

  const agendaDates = useMemo(() => Object.keys(agendaGrouped).sort(), [agendaGrouped]);

  const todayKey = buildKey(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  /* ── Navigation ── */
  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
    setSelectedDay(null);
  }
  function prevWeek() {
    const s = new Date(weekStart); s.setDate(s.getDate() - 7);
    setWeekStart(s); setViewYear(s.getFullYear()); setSelectedDay(null);
  }
  function nextWeek() {
    const s = new Date(weekStart); s.setDate(s.getDate() + 7);
    setWeekStart(s); setViewYear(s.getFullYear()); setSelectedDay(null);
  }

  function switchView(v: View) {
    if (v === "week") {
      const ws = getWeekStart(new Date());
      setWeekStart(ws); setViewYear(ws.getFullYear());
    }
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
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  /* ═══════════════ VIEW SWITCHER ═══════════════ */
  const viewSwitcher = (
    <div className="flex items-center justify-center gap-1 bg-white/20 rounded-xl p-1" data-testid="view-switcher">
      {(["month","week","year"] as View[]).map(v => (
        <button
          key={v}
          onClick={() => switchView(v)}
          data-testid={`button-view-${v}`}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
            view === v ? "bg-white text-[#10b981]" : "text-white/80 hover:text-white"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );

  /* ═══════════════ HEADER ═══════════════ */
  const topHeader = (
    <header className="sticky top-0 z-30 bg-[#10b981] shadow-md">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setLocation("/student-dashboard")}
          className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors flex-shrink-0"
          data-testid="button-back"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm leading-tight">School Calendar</p>
          <p className="text-emerald-100 text-xs">{student.schoolName}</p>
        </div>
        {viewSwitcher}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors disabled:opacity-60"
          data-testid="button-sync-now"
          aria-label="Sync Now"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>
    </header>
  );

  /* ═══════════════ MONTH NAV BAR ═══════════════ */
  const monthNav = (
    <div className="flex items-center justify-between px-4 py-3 bg-[#10b981]">
      <button
        onClick={view === "week" ? prevWeek : view === "year" ? () => { setViewYear(y => y - 1); setSelectedDay(null); } : prevMonth}
        className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors"
        data-testid={view === "week" ? "button-prev-week" : view === "year" ? "button-prev-year" : "button-prev-month"}
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <div className="text-center">
        <p className="text-white font-bold text-base" data-testid="text-month-year">{navTitle()}</p>
        <button onClick={goToday} className="text-[10px] text-emerald-100 hover:text-white transition-colors" data-testid="button-today">
          Today
        </button>
      </div>
      <button
        onClick={view === "week" ? nextWeek : view === "year" ? () => { setViewYear(y => y + 1); setSelectedDay(null); } : nextMonth}
        className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors"
        data-testid={view === "week" ? "button-next-week" : view === "year" ? "button-next-year" : "button-next-month"}
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );

  /* ═══════════════ BOTTOM SHEET ═══════════════ */
  const bottomSheet = (
    <AnimatePresence>
      {bottomSheetOpen && selectedDay && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setBottomSheetOpen(false)} />
          <motion.div
            className="relative rounded-t-2xl overflow-hidden shadow-2xl max-h-[75vh] overflow-y-auto bg-white"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            data-testid="modal-event"
          >
            <div className="bg-[#10b981] px-5 py-4 flex items-center justify-between sticky top-0">
              <div>
                <p className="text-white font-bold text-base">{fmtDateLong(selectedDay)}</p>
                <p className="text-emerald-100 text-xs">{DAYS_FULL[new Date(selectedDay + "T00:00:00").getDay()]}</p>
              </div>
              <button
                onClick={() => setBottomSheetOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors"
                data-testid="button-close-modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {selectedEvents.length === 0 ? (
                <div className="text-center py-6">
                  <span className="text-4xl">📅</span>
                  <p className="font-semibold text-gray-700 mt-2">No events on this day</p>
                </div>
              ) : selectedEvents.map(ev => {
                const color = getColor(ev);
                const label = EVENT_TYPES.find(t => t.value === ev.eventType)?.label || ev.eventType;
                return (
                  <div key={ev.id} className="p-3 rounded-xl border border-gray-100 bg-gray-50" style={{ borderLeftColor: color, borderLeftWidth: 3 }} data-testid={`modal-event-detail-${ev.id}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-semibold text-sm text-gray-800">{ev.title}</p>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}20`, color }}>{label}</span>
                    </div>
                    {ev.venue && <p className="text-xs text-gray-500">📍 {ev.venue}</p>}
                    {ev.isRecurring && (
                      <div className="flex items-center gap-1 mt-1">
                        <Repeat className="w-3 h-3 text-gray-400" />
                        <span className="text-[10px] text-gray-500">Recurring annually</span>
                      </div>
                    )}
                    {ev.description && <p className="text-xs text-gray-600 mt-1">{ev.description}</p>}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  /* ═══════════════ MONTH VIEW ═══════════════ */
  const monthViewGrid = (
    <>
      <div className="grid grid-cols-7 border-b border-emerald-50">
        {DAYS.map(d => (
          <div key={d} className={`py-2 text-center text-xs font-semibold ${d === "Sun" ? "text-red-400" : "text-gray-500"}`}>{d}</div>
        ))}
      </div>
      {eventsLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
        </div>
      ) : (
        <div className="grid grid-cols-7">
          {calendarDays.map((day, i) => {
            if (day === null) {
              return <div key={`e-${i}`} className="min-h-[80px] border-r border-b border-emerald-50/50 bg-gray-50/30" />;
            }
            const key = buildKey(viewYear, viewMonth, day);
            const dayEvs = eventsByDate[key] || [];
            const isCurrentDay = key === todayKey;
            const isSunday = new Date(viewYear, viewMonth, day).getDay() === 0;
            const isHoliday = dayEvs.some(e => e.eventType === "holiday");
            const isSelected = selectedDay === key;

            return (
              <div
                key={key}
                onClick={() => handleDayClick(key)}
                data-testid={`cell-day-${day}`}
                className={`min-h-[80px] border-r border-b border-emerald-50/50 p-1.5 cursor-pointer transition-colors
                  ${isHoliday ? "bg-red-50/40" : ""}
                  ${isSelected ? "bg-emerald-50" : "hover:bg-emerald-50/30"}
                `}
              >
                <span
                  className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full mb-1
                    ${isCurrentDay ? "bg-[#10b981] text-white" : ""}
                    ${(isSunday || isHoliday) && !isCurrentDay ? "text-red-400" : ""}
                    ${!isCurrentDay && !isSunday && !isHoliday ? "text-gray-700" : ""}
                  `}
                  style={isCurrentDay ? { boxShadow: "0 0 0 3px rgba(16,185,129,0.25), 0 0 12px rgba(16,185,129,0.35)" } : {}}
                  data-testid={`text-day-${day}`}
                >
                  {day}
                </span>
                <div className="space-y-0.5">
                  {dayEvs.slice(0, 2).map(ev => <EventChip key={ev.id} ev={ev} />)}
                  {dayEvs.length > 2 && <div className="text-[9px] text-gray-400 pl-1">+{dayEvs.length - 2}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  /* ═══════════════ WEEK VIEW ═══════════════ */
  const weekViewGrid = (
    <div className={`${isMobile ? "overflow-x-auto" : ""} rounded-2xl border border-emerald-100 shadow-sm overflow-hidden bg-white`} data-testid="week-grid">
      <div className={`${isMobile ? "flex min-w-[700px]" : "grid grid-cols-7"}`}>
        {weekDays.map(day => {
          const key = buildKey(day.getFullYear(), day.getMonth(), day.getDate());
          const dayEvs = eventsByDate[key] || [];
          const todayCurrent = isTodayFn(day.getFullYear(), day.getMonth(), day.getDate());
          const isSelected = selectedDay === key;
          const isSunday = day.getDay() === 0;
          const isHoliday = dayEvs.some(e => e.eventType === "holiday");

          return (
            <div
              key={key}
              className={`${isMobile ? "min-w-[100px] flex-1" : ""} flex flex-col border-r border-emerald-50 last:border-0
                ${isHoliday ? "bg-red-50/40" : ""} ${isSelected ? "bg-emerald-50" : ""}
              `}
            >
              <div
                className={`py-2 px-1.5 text-center border-b border-emerald-100 cursor-pointer hover:bg-emerald-50/30 transition-colors ${todayCurrent ? "bg-emerald-50" : ""}`}
                onClick={() => handleDayClick(key)}
              >
                <p className={`text-[10px] font-semibold uppercase ${isSunday ? "text-red-400" : "text-gray-400"}`}>{DAYS[day.getDay()]}</p>
                <span
                  className={`w-7 h-7 flex items-center justify-center mx-auto rounded-full text-sm font-bold mt-0.5
                    ${todayCurrent ? "bg-[#10b981] text-white" : isSunday || isHoliday ? "text-red-400" : "text-gray-700"}
                  `}
                  style={todayCurrent ? { boxShadow: "0 0 0 3px rgba(16,185,129,0.25), 0 0 12px rgba(16,185,129,0.35)" } : {}}
                  data-testid={`week-day-${key}`}
                >
                  {day.getDate()}
                </span>
                <p className="text-[9px] text-gray-300 mt-0.5">{MONTHS_SHORT[day.getMonth()]}</p>
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
                    <span className="text-[9px] text-gray-200">—</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /* ═══════════════ YEAR / AGENDA VIEW ═══════════════ */
  const yearViewAgenda = (
    <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm divide-y divide-emerald-50" data-testid="year-agenda">
      {eventsLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
        </div>
      ) : MONTHS.map((monthName, mi) => {
        const monthEvs = (yearGroupedByMonth[mi] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        return (
          <div key={mi} data-testid={`year-month-section-${mi}`}>
            <div
              className="sticky top-[56px] z-10 bg-white/95 py-2 px-4 flex items-center gap-2"
              data-testid={`year-month-header-${mi}`}
            >
              <span className="text-sm font-bold text-gray-700">{monthName}</span>
              <span className="text-xs text-gray-400">{viewYear}</span>
              <span className="ml-auto text-[10px] text-gray-300">{monthEvs.length} event{monthEvs.length !== 1 ? "s" : ""}</span>
            </div>
            {monthEvs.length === 0 ? (
              <p className="text-gray-300 text-xs px-4 py-3">No events scheduled</p>
            ) : (
              <div className="px-3 pb-2 space-y-1.5">
                {monthEvs.map(ev => {
                  const color = getColor(ev);
                  const d = new Date(ev.date.split("T")[0] + "T00:00:00");
                  const isCurrentDay = isTodayFn(d.getFullYear(), d.getMonth(), d.getDate());
                  const label = EVENT_TYPES.find(t => t.value === ev.eventType)?.label || ev.eventType;
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center gap-3 p-2 rounded-xl hover:bg-emerald-50/40 transition-colors cursor-pointer"
                      onClick={() => handleDayClick(ev.date.split("T")[0])}
                      data-testid={`year-event-${ev.id}`}
                    >
                      <div className="w-10 text-center shrink-0">
                        <p className="text-[10px] text-gray-400 uppercase">{DAYS[d.getDay()]}</p>
                        <p className={`text-lg font-bold leading-tight ${isCurrentDay ? "text-[#10b981]" : "text-gray-500"}`}
                          style={isCurrentDay ? { textShadow: "0 0 8px rgba(16,185,129,0.4)" } : {}}>
                          {d.getDate()}
                        </p>
                      </div>
                      <div className="w-0.5 h-10 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{ev.title}</p>
                        <p className="text-[11px] font-medium capitalize" style={{ color }}>{label}</p>
                        {ev.description && <p className="text-[10px] text-gray-400 truncate">{ev.description}</p>}
                      </div>
                      {ev.isRecurring && <Repeat className="w-3 h-3 text-gray-300 shrink-0" />}
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
  if (isMobile) {
    return (
      <div className="min-h-screen bg-[#f0fdf4] flex flex-col" data-testid="student-calendar-mobile">
        {topHeader}
        <main className="flex-1 max-w-xl mx-auto w-full">
          {view !== "year" && (
            <div className="bg-white rounded-b-2xl border border-emerald-100 shadow-sm overflow-hidden mb-4">
              {monthNav}
            </div>
          )}

          {view === "year" && (
            <div className="bg-[#10b981] mb-4">
              {monthNav}
            </div>
          )}

          <div className={`${view === "year" ? "" : "px-4"} pb-6 space-y-3`}>
            {view === "month" && (
              eventsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
                </div>
              ) : agendaDates.length === 0 ? (
                <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-8 text-center">
                  <Calendar className="w-10 h-10 text-emerald-200 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No events in {MONTHS[viewMonth]} {viewYear}</p>
                </div>
              ) : agendaDates.map(dateKey => {
                const d = new Date(dateKey + "T00:00:00");
                const isCurrentDay = dateKey === todayKey;
                const dayEvs = agendaGrouped[dateKey];
                return (
                  <div key={dateKey} data-testid={`agenda-group-${dateKey}`}>
                    <button
                      className={`flex items-center gap-2 mb-1.5 w-full text-left rounded-xl hover:bg-emerald-50/60 active:bg-emerald-100/60 transition-colors min-h-[44px] px-1 ${isCurrentDay ? "text-[#10b981]" : "text-gray-400"}`}
                      onClick={() => { setSelectedDay(dateKey); setBottomSheetOpen(true); }}
                      data-testid={`agenda-date-header-${dateKey}`}
                    >
                      <span className="text-xs font-bold uppercase tracking-widest">
                        {d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                      </span>
                      <span className="text-xs">{DAYS_FULL[d.getDay()]}</span>
                      {isCurrentDay && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded-full font-semibold">Today</span>}
                      <span className="ml-auto text-[10px] text-gray-300">{dayEvs.length} event{dayEvs.length !== 1 ? "s" : ""} ›</span>
                    </button>
                    <div className="space-y-2">
                      {dayEvs.map(ev => {
                        const color = getColor(ev);
                        const label = EVENT_TYPES.find(t => t.value === ev.eventType)?.label || ev.eventType;
                        return (
                          <div
                            key={ev.id}
                            className="bg-white rounded-xl border border-emerald-100 shadow-sm p-3 flex gap-3 cursor-pointer hover:bg-emerald-50/40 active:bg-emerald-100/40 transition-colors"
                            style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                            data-testid={`mobile-event-detail-${ev.id}`}
                            onClick={() => { setSelectedDay(dateKey); setBottomSheetOpen(true); }}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-800">{ev.title}</p>
                              <p className="text-xs mt-0.5 font-medium" style={{ color }}>{label}</p>
                              {ev.venue && <p className="text-xs text-gray-400 mt-0.5">📍 {ev.venue}</p>}
                              {ev.isRecurring && (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <Repeat className="w-2.5 h-2.5 text-gray-300" />
                                  <span className="text-[10px] text-gray-400">Recurring annually</span>
                                </div>
                              )}
                              {ev.description && <p className="text-xs text-gray-500 mt-1">{ev.description}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}

            {view === "week" && weekViewGrid}
            {view === "year" && yearViewAgenda}
          </div>
        </main>
        {bottomSheet}
      </div>
    );
  }

  /* ═══════════════ DESKTOP LAYOUT ═══════════════ */
  return (
    <div className="min-h-screen bg-[#f0fdf4] flex flex-col" data-testid="student-calendar-desktop">
      {topHeader}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-5">

        {view === "month" && (
          <div className="grid grid-cols-3 gap-5">
            <div className="col-span-2 bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
              {monthNav}
              {monthViewGrid}
            </div>

            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-4">
              <h4 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[#10b981]" />
                {selectedDay ? fmtDateLong(selectedDay) : "Click a day to view"}
              </h4>
              {!selectedDay ? (
                <div className="space-y-2 mt-2">
                  <p className="text-xs text-gray-400 mb-3">Events this month:</p>
                  {sortedMonthEvents.length === 0 ? (
                    <p className="text-gray-300 text-sm text-center py-4">No events this month</p>
                  ) : sortedMonthEvents.slice(0, 10).map(ev => (
                    <div key={ev.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded-lg px-1 py-0.5 transition-colors" onClick={() => setSelectedDay(ev.date.split("T")[0])} data-testid={`sidebar-event-${ev.id}`}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getColor(ev) }} />
                      <span className="text-xs text-gray-400 shrink-0 w-4">{new Date(ev.date + "T00:00:00").getDate()}</span>
                      <span className="text-xs text-gray-600 truncate">{ev.title}</span>
                      {ev.isRecurring && <Repeat className="w-3 h-3 text-gray-300 shrink-0" />}
                    </div>
                  ))}
                </div>
              ) : selectedEvents.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-8 h-8 text-emerald-100 mx-auto mb-2" />
                  <p className="text-gray-400 text-sm">No events on this day</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {selectedEvents.map(ev => (
                    <motion.div
                      key={ev.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="p-3 rounded-xl bg-gray-50 border border-gray-100"
                      style={{ borderLeftColor: getColor(ev), borderLeftWidth: 3 }}
                      data-testid={`event-detail-${ev.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-800">{ev.title}</p>
                        {ev.isRecurring && <Repeat className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5" />}
                      </div>
                      <p className="text-xs mt-1 font-medium capitalize" style={{ color: getColor(ev) }}>
                        {EVENT_TYPES.find(t => t.value === ev.eventType)?.label || ev.eventType}
                      </p>
                      {ev.venue && <p className="text-xs text-gray-400 mt-0.5">📍 {ev.venue}</p>}
                      {ev.description && <p className="text-xs text-gray-500 mt-1">{ev.description}</p>}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {view === "week" && (
          <div className="space-y-4">
            <div className="bg-[#10b981] rounded-2xl overflow-hidden">
              {monthNav}
            </div>
            {eventsLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-[#10b981]" /></div>
            ) : weekViewGrid}
          </div>
        )}

        {view === "year" && (
          <div className="space-y-4">
            <div className="bg-[#10b981] rounded-2xl overflow-hidden">
              {monthNav}
            </div>
            {yearViewAgenda}
          </div>
        )}

        <div className="mt-4 bg-white rounded-2xl border border-emerald-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide flex items-center gap-2">
            <CalendarDays className="w-3.5 h-3.5 text-[#10b981]" /> Event Legend
          </p>
          <div className="flex flex-wrap gap-4">
            {EVENT_TYPES.map(t => (
              <div key={t.value} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />
                <span className="text-xs text-gray-600">{t.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-300" />
              <span className="text-xs text-gray-600">Sunday</span>
            </div>
          </div>
        </div>
      </main>

      {(view === "month" || view === "week") && bottomSheet}
    </div>
  );
}
