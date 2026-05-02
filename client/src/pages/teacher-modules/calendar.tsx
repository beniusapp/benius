import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fmtDateLong, fmtDateShort } from "@/lib/dateUtils";
import {
  ChevronLeft, ChevronRight, Loader2, Calendar, CalendarDays,
  RefreshCw, X, Repeat,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  { value: "holiday",     label: "Holiday",     color: "#dc2626" },
  { value: "academic",    label: "Academic",    color: "#2563eb" },
  { value: "examination", label: "Examination", color: "#ca8a04" },
  { value: "event",       label: "Event",       color: "#10b981" },
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

/* Simple light tooltip popover */
function EventTooltip({ ev, onClose }: { ev: CalendarEvent; onClose: () => void }) {
  const color = getColor(ev);
  const typeLabel = EVENT_TYPES.find(t => t.value === ev.eventType)?.label || ev.eventType;
  return (
    <div
      className="absolute z-50 bottom-full left-0 mb-2 w-56 rounded-xl shadow-lg bg-white border border-gray-200 text-left overflow-hidden"
      onMouseLeave={onClose}
    >
      <div className="h-1 w-full" style={{ backgroundColor: color }} />
      <div className="p-3">
        <p className="text-sm font-bold text-gray-900 leading-snug mb-1.5">{ev.title}</p>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: color }}>
            {typeLabel}
          </span>
          {ev.isRecurring && (
            <span className="flex items-center gap-0.5 text-xs text-gray-500">
              <Repeat className="w-3 h-3" /> Recurring
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">{fmtDateLong(ev.date)}</p>
        {ev.description && (
          <p className="text-xs text-gray-600 mt-1.5 pt-1.5 border-t border-gray-100 leading-relaxed">
            {ev.description}
          </p>
        )}
      </div>
    </div>
  );
}

/* Event Pill — solid opaque colored pill */
function EventPill({
  ev, size = "sm", onClick,
}: {
  ev: CalendarEvent; size?: "xs" | "sm"; onClick?: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = getColor(ev);
  return (
    <div className="relative">
      <div
        className={`rounded-full truncate font-semibold cursor-pointer transition-opacity hover:opacity-85 ${
          size === "xs" ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-xs"
        }`}
        style={{ backgroundColor: color, color: "#ffffff" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onClick}
        data-testid={`event-chip-${ev.id}`}
      >
        {ev.title}
      </div>
      {hovered && <EventTooltip ev={ev} onClose={() => setHovered(false)} />}
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
      <div className="text-center py-12 text-red-500" data-testid="text-calendar-error">
        Failed to load calendar. Please try again.
      </div>
    );
  }

  /* ── View Tab Switcher (underline style like timetable) ── */
  const viewSwitcher = (
    <div className="flex gap-0 border-b border-gray-200" data-testid="view-switcher">
      {(["month", "week", "year"] as View[]).map(v => (
        <button
          key={v}
          onClick={() => switchView(v)}
          data-testid={`button-view-${v}`}
          className={`px-4 py-2 text-sm font-semibold border-b-2 capitalize transition-colors ${
            view === v
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {v === "year" ? "Agenda" : v}
        </button>
      ))}
    </div>
  );

  /* ── Legend ── */
  const legend = (
    <div className="flex items-center gap-2 flex-wrap" data-testid="calendar-legend">
      {EVENT_TYPES.map(et => (
        <span
          key={et.value}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full text-white"
          style={{ backgroundColor: et.color }}
        >
          {et.label}
        </span>
      ))}
    </div>
  );

  /* ── Nav Bar ── */
  const navBar = (
    <div className="space-y-3">
      {/* Title row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2" data-testid="heading-teacher-calendar">
            <CalendarDays className="w-5 h-5 text-emerald-600" />
            School Calendar
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {view === "month"
              ? `${events.length} events · ${holidayCount} holidays in ${MONTHS[month]}`
              : view === "week"
              ? `${weekDays.map(d => buildKey(d.getFullYear(), d.getMonth(), d.getDate())).reduce((c, k) => c + (eventsByDate[k]?.length || 0), 0)} events this week`
              : `${events.length} events in ${year}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refetch}
          disabled={isFetching}
          data-testid="button-sync-now"
          className="h-9"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Sync
        </Button>
      </div>

      {/* Nav controls row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Quick-jump month selector (month view only) */}
        {view === "month" && (
          <select
            value={month}
            onChange={e => { setMonth(parseInt(e.target.value)); setSelectedDay(null); }}
            className="h-9 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            data-testid="select-month-jump"
            aria-label="Jump to month"
          >
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        )}
        {/* Year selector */}
        <select
          value={year}
          onChange={e => {
            const y = parseInt(e.target.value);
            setYear(y);
            if (view === "week") {
              const ws = new Date(weekStart); ws.setFullYear(y);
              setWeekStart(getWeekStart(ws));
            }
            setSelectedDay(null);
          }}
          className="h-9 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          data-testid="select-year-jump"
          aria-label="Jump to year"
        >
          {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        {/* Prev / Title / Next / Today */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={view === "week" ? prevWeek : view === "year" ? () => { setYear(y => Math.max(2020, y - 1)); setSelectedDay(null); } : prevMonth}
            className="p-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
            data-testid={view === "week" ? "button-prev-week" : view === "year" ? "button-prev-year" : "button-prev-month"}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span
            className="font-bold min-w-[150px] text-center text-sm text-gray-900"
            data-testid="text-calendar-title"
          >
            {navTitle()}
          </span>
          <button
            onClick={view === "week" ? nextWeek : view === "year" ? () => { setYear(y => Math.min(2120, y + 1)); setSelectedDay(null); } : nextMonth}
            className="p-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
            data-testid={view === "week" ? "button-next-week" : view === "year" ? "button-next-year" : "button-next-month"}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            data-testid="button-today"
          >
            Today
          </button>
        </div>
      </div>
    </div>
  );

  /* ── Bottom Sheet (mobile) ── */
  const bottomSheet = bottomSheetOpen && selectedDay && (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      onClick={() => setBottomSheetOpen(false)}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative rounded-t-3xl bg-white max-h-[75vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 sticky top-0 bg-white border-b border-gray-100">
          <div>
            <p className="text-base font-bold text-gray-900">{fmtDateLong(selectedDay)}</p>
            <p className="text-xs text-gray-500 mt-0.5">{DAYS_FULL[new Date(selectedDay + "T00:00:00").getDay()]}</p>
          </div>
          <button
            onClick={() => setBottomSheetOpen(false)}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"
            data-testid="button-close-bottom-sheet"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 pb-8">
          {selectedEvents.length === 0 ? (
            <div className="text-center py-10">
              <Calendar className="w-10 h-10 mx-auto mb-3 text-gray-200" />
              <p className="text-sm text-gray-400">No events on this day</p>
            </div>
          ) : selectedEvents.map(ev => {
            const color = getColor(ev);
            return (
              <div key={ev.id} className="rounded-2xl overflow-hidden border border-gray-200" data-testid={`bottom-sheet-event-${ev.id}`}>
                <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
                <div className="p-4 bg-white">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900 leading-snug">{ev.title}</p>
                    {ev.isRecurring && <Repeat className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />}
                  </div>
                  <span
                    className="inline-block mt-2 text-xs font-semibold px-2.5 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: color }}
                  >
                    <EventTypeLabel eventType={ev.eventType} />
                  </span>
                  {ev.description && (
                    <p className="text-xs text-gray-600 mt-2 leading-relaxed">{ev.description}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  /* ── Month View ── */
  const monthView = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Calendar grid */}
      <Card className="lg:col-span-2 overflow-hidden">
        {/* Day name headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {DAYS.map((d, i) => (
            <div
              key={d}
              className={`py-2.5 text-center text-xs font-bold uppercase tracking-wide ${i === 0 || i === 6 ? "text-red-500" : "text-gray-600"}`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map((day, i) => {
              if (day === null) {
                return (
                  <div
                    key={`e-${i}`}
                    className="min-h-[80px] bg-gray-50 border-b border-r border-gray-200"
                  />
                );
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
                  className={`min-h-[80px] p-1.5 cursor-pointer transition-colors border-b border-r border-gray-200 hover:bg-gray-50 ${
                    isSelected ? "bg-emerald-50" : "bg-white"
                  } ${today ? "ring-2 ring-emerald-500 ring-inset" : ""}`}
                >
                  {/* Date number */}
                  <div className="flex justify-end mb-1">
                    <span
                      className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                        today
                          ? "bg-emerald-600 text-white"
                          : isWeekend
                          ? "text-red-500"
                          : "text-gray-700"
                      }`}
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
                      <div className="text-[10px] pl-1 font-semibold text-gray-500">
                        +{dayEvs.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Desktop sidebar */}
      <Card className="hidden lg:flex flex-col shadow-none">
        <CardContent className="pt-4 flex-1 flex flex-col min-h-0">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-emerald-600" />
            {selectedDay ? fmtDateLong(selectedDay) : "Events this month"}
          </h4>
          {!selectedDay ? (
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {events.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No events this month</p>
              ) : events.slice().sort((a, b) => a.date.localeCompare(b.date)).map(ev => (
                <div
                  key={ev.id}
                  className="flex items-center gap-2.5 p-2 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors"
                  data-testid={`sidebar-event-${ev.id}`}
                  onClick={() => handleDayClick(ev.date.split("T")[0])}
                >
                  <span className="w-2 h-6 rounded-full shrink-0" style={{ backgroundColor: getColor(ev) }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-800 truncate">{ev.title}</p>
                    <p className="text-[10px] text-gray-500">
                      {new Date(ev.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                    </p>
                  </div>
                  {ev.isRecurring && <Repeat className="w-3 h-3 shrink-0 text-gray-400" />}
                </div>
              ))}
            </div>
          ) : selectedEvents.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <Calendar className="w-10 h-10 mb-3 text-gray-200" />
              <p className="text-sm text-gray-400">No events on this day</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-3">
              {selectedEvents.map(ev => {
                const color = getColor(ev);
                return (
                  <div
                    key={ev.id}
                    className="rounded-xl overflow-hidden border border-gray-200"
                    data-testid={`event-detail-${ev.id}`}
                  >
                    <div className="h-1 w-full" style={{ backgroundColor: color }} />
                    <div className="p-3 bg-white">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm font-bold text-gray-900 leading-snug" data-testid={`text-event-title-${ev.id}`}>{ev.title}</p>
                        {ev.isRecurring && <Repeat className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />}
                      </div>
                      <span
                        className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: color }}
                      >
                        <EventTypeLabel eventType={ev.eventType} />
                      </span>
                      {ev.description && (
                        <p className="text-xs text-gray-600 mt-2 leading-relaxed">{ev.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  /* ── Week View ── */
  const weekView = (
    <div>
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
      ) : (
        <Card className="overflow-hidden" data-testid="week-grid">
          <div className="overflow-x-auto">
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
                    className={`flex flex-col border-r border-gray-200 last:border-r-0 ${
                      isSelected ? "bg-emerald-50" : "bg-white"
                    } ${today ? "ring-2 ring-emerald-500 ring-inset" : ""}`}
                  >
                    {/* Day header */}
                    <div
                      className={`py-3 px-2 text-center cursor-pointer border-b border-gray-200 hover:bg-gray-50 transition-colors ${today ? "bg-emerald-50" : ""}`}
                      onClick={() => handleDayClick(key)}
                      data-testid={`week-day-header-${key}`}
                    >
                      <p className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${isWeekend ? "text-red-500" : "text-gray-500"}`}>
                        {DAYS[day.getDay()]}
                      </p>
                      <span
                        className={`w-8 h-8 flex items-center justify-center mx-auto rounded-full text-sm font-bold ${
                          today ? "bg-emerald-600 text-white" : isWeekend ? "text-red-500" : "text-gray-800"
                        }`}
                        data-testid={`week-day-${key}`}
                      >
                        {day.getDate()}
                      </span>
                      <p className="text-[9px] text-gray-400 mt-0.5">{MONTHS_SHORT[day.getMonth()]}</p>
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
                          <span className="text-xs text-gray-300">—</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Selected day events (week view below grid) */}
      {selectedDay && selectedEvents.length > 0 && (
        <Card className="mt-4">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm font-bold text-gray-800 mb-3">{fmtDateLong(selectedDay)}</p>
            <div className="space-y-2">
              {selectedEvents.map(ev => {
                const color = getColor(ev);
                return (
                  <div key={ev.id} className="flex items-center gap-3 p-2 rounded-xl border border-gray-200">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{ev.title}</p>
                      <p className="text-xs font-medium" style={{ color }}><EventTypeLabel eventType={ev.eventType} /></p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  /* ── Year / Agenda View ── */
  const yearView = (
    <div className="space-y-5" data-testid="year-agenda">
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
      ) : MONTHS.map((monthName, mi) => {
        const monthEvs = (yearGroupedByMonth[mi] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        const isCurrentMonth = mi === now.getMonth() && year === now.getFullYear();
        return (
          <div key={mi} data-testid={`year-month-section-${mi}`}>
            {/* Month header */}
            <div
              className={`sticky top-0 z-10 flex items-center gap-3 py-2.5 px-3 mb-2 border-b bg-white ${isCurrentMonth ? "border-emerald-300" : "border-gray-200"}`}
              data-testid={`year-month-header-${mi}`}
            >
              <span className={`text-sm font-bold ${isCurrentMonth ? "text-emerald-700" : "text-gray-800"}`}>
                {monthName}
              </span>
              <span className="text-xs text-gray-400">{year}</span>
              {isCurrentMonth && (
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">Current month</Badge>
              )}
              <span className="ml-auto text-xs text-gray-500">
                {monthEvs.length} event{monthEvs.length !== 1 ? "s" : ""}
              </span>
            </div>

            {monthEvs.length === 0 ? (
              <p className="text-xs text-gray-400 px-3 py-2">No events scheduled</p>
            ) : (
              <div className="space-y-2">
                {monthEvs.map(ev => {
                  const color = getColor(ev);
                  const d = new Date(ev.date.split("T")[0] + "T00:00:00");
                  const isCurrentDay = isTodayFn(d.getFullYear(), d.getMonth(), d.getDate());
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-200"
                      onClick={() => handleDayClick(ev.date.split("T")[0])}
                      data-testid={`year-event-${ev.id}`}
                    >
                      <div className="w-10 text-center shrink-0">
                        <p className="text-[9px] uppercase font-bold text-gray-400">{DAYS[d.getDay()]}</p>
                        <p className={`text-lg font-black leading-tight ${isCurrentDay ? "text-emerald-700" : "text-gray-800"}`}>
                          {d.getDate()}
                        </p>
                      </div>
                      <div
                        className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-xl text-white text-sm font-semibold"
                        style={{ backgroundColor: color }}
                        data-testid={`event-chip-${ev.id}`}
                      >
                        <span className="truncate">{ev.title}</span>
                        {ev.isRecurring && <Repeat className="w-3 h-3 shrink-0 opacity-70" />}
                      </div>
                      {ev.description && (
                        <p className="text-xs text-gray-500 truncate max-w-[120px] hidden lg:block">{ev.description}</p>
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

  /* ── Mobile Month View ── */
  if (isMobile && view === "month") {
    return (
      <div className="space-y-4" data-testid="teacher-calendar-mobile">
        {navBar}
        {viewSwitcher}
        {legend}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          </div>
        ) : (
          <Card className="overflow-hidden">
            {/* Day headers */}
            <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
              {DAYS.map((d, i) => (
                <div key={d} className={`py-2 text-center text-[10px] font-bold uppercase ${i === 0 || i === 6 ? "text-red-500" : "text-gray-600"}`}>
                  {d}
                </div>
              ))}
            </div>
            {/* Cells */}
            <div className="grid grid-cols-7">
              {calendarDays.map((day, i) => {
                if (day === null) {
                  return <div key={`e-${i}`} className="min-h-[48px] bg-gray-50 border-b border-r border-gray-200" />;
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
                    className={`min-h-[48px] p-1 cursor-pointer border-b border-r border-gray-200 ${
                      isSelected ? "bg-emerald-50" : "bg-white"
                    } ${today ? "ring-2 ring-emerald-500 ring-inset" : ""}`}
                  >
                    <div className="flex justify-end">
                      <span
                        className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full ${
                          today ? "bg-emerald-600 text-white" : isWeekend ? "text-red-500" : "text-gray-700"
                        }`}
                        data-testid={`text-day-${day}`}
                      >
                        {day}
                      </span>
                    </div>
                    <div className="space-y-px mt-0.5">
                      {dayEvs.slice(0, 1).map(ev => (
                        <div key={ev.id} className="w-full h-1.5 rounded-full" style={{ backgroundColor: getColor(ev) }} />
                      ))}
                      {dayEvs.length > 1 && (
                        <div className="w-full h-1.5 rounded-full bg-gray-300" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Selected day details */}
        {selectedDay && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm font-bold text-gray-800 mb-3">{fmtDateLong(selectedDay)}</p>
              {selectedEvents.length === 0 ? (
                <p className="text-sm text-gray-400">No events on this day</p>
              ) : selectedEvents.map(ev => {
                const color = getColor(ev);
                return (
                  <div key={ev.id} className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-b-0" data-testid={`mobile-event-detail-${ev.id}`}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{ev.title}</p>
                      <p className="text-xs font-medium" style={{ color }}><EventTypeLabel eventType={ev.eventType} /></p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
        {bottomSheet}
      </div>
    );
  }

  /* ── Main Render (desktop + non-month mobile views) ── */
  return (
    <div className="space-y-4" data-testid="teacher-calendar-desktop">
      {navBar}
      {viewSwitcher}
      {legend}
      {view === "month" && monthView}
      {view === "week" && weekView}
      {view === "year" && yearView}
      {bottomSheet}
    </div>
  );
}
