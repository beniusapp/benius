import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Calendar, CalendarDays, Flame, BookOpen, Award, Star, Repeat } from "lucide-react";
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

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const EVENT_TYPES = [
  { value: "holiday", label: "Holiday", color: "#ef4444", icon: Flame },
  { value: "academic", label: "Academic", color: "#3b82f6", icon: BookOpen },
  { value: "examination", label: "Examination", color: "#8b5cf6", icon: Award },
  { value: "event", label: "Event", color: "#10b981", icon: Star },
];

function getColor(ev: CalendarEvent) {
  return ev.colorCode || EVENT_TYPES.find(t => t.value === ev.eventType)?.color || "#D4AF37";
}

function buildKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function isToday(y: number, m: number, d: number) {
  const n = new Date();
  return n.getFullYear() === y && n.getMonth() === m && n.getDate() === d;
}

function formatDate(s: string) {
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}

export default function CalendarModule({ teacher }: { teacher: TeacherMe }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { data: events = [], isLoading, isError } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/teacher/calendar", month + 1, year],
    queryFn: async () => {
      const r = await fetch(`/api/teacher/calendar?month=${month + 1}&year=${year}`, { credentials:"include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

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

  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12 text-red-400" data-testid="text-calendar-error">
        Failed to load calendar. Please try again.
      </div>
    );
  }

  const holidayCount = events.filter(e => e.eventType === "holiday").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white" data-testid="heading-teacher-calendar">School Calendar</h2>
          <p className="text-white/40 text-sm">{events.length} events · {holidayCount} holidays this month</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors" data-testid="button-prev-month">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-white font-semibold min-w-[140px] text-center" data-testid="text-calendar-title">{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors" data-testid="button-next-month">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setMonth(now.getMonth()); setYear(now.getFullYear()); setSelectedDay(null); }}
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-colors"
            data-testid="button-today"
          >
            Today
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        {EVENT_TYPES.map(t => (
          <div key={t.value} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="text-xs text-white/40">{t.label}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-[#1A2942] rounded-xl border border-white/10 overflow-hidden">
          <div className="grid grid-cols-7">
            {DAYS.map(d => (
              <div key={d} className="py-2 text-center text-[11px] font-medium text-white/30 border-b border-white/5">{d}</div>
            ))}
            {calendarDays.map((day, i) => {
              if (day === null) {
                return <div key={`e-${i}`} className="min-h-[68px] border-b border-r border-white/5 bg-white/[0.01]" />;
              }
              const key = buildKey(year, month, day);
              const dayEvs = eventsByDate[key] || [];
              const today = isToday(year, month, day);
              const isSelected = selectedDay === key;
              const hasHoliday = dayEvs.some(e => e.eventType === "holiday");

              return (
                <div
                  key={key}
                  onClick={() => setSelectedDay(isSelected ? null : key)}
                  data-testid={`cell-day-${day}`}
                  className={`min-h-[68px] border-b border-r border-white/5 p-1.5 cursor-pointer transition-colors
                    ${hasHoliday ? "bg-red-500/5" : ""}
                    ${isSelected ? "bg-emerald-500/10 border-emerald-500/20" : "hover:bg-white/5"}
                  `}
                >
                  <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1
                    ${today ? "bg-emerald-500 text-white font-bold" : "text-white/50"}
                  `} data-testid={`text-day-${day}`}>
                    {day}
                  </span>
                  <div className="space-y-0.5">
                    {dayEvs.slice(0, 2).map(ev => (
                      <div
                        key={ev.id}
                        className="px-1 py-0.5 rounded text-[9px] truncate font-medium"
                        style={{ backgroundColor: `${getColor(ev)}22`, color: getColor(ev) }}
                        data-testid={`event-chip-${ev.id}`}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {dayEvs.length > 2 && (
                      <div className="text-[9px] text-white/30 pl-1">+{dayEvs.length - 2}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-[#1A2942] rounded-xl border border-white/10 p-4">
          <h4 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-emerald-400" />
            {selectedDay ? formatDate(selectedDay) : "Click a day to view"}
          </h4>

          {!selectedDay ? (
            <div className="space-y-2 mt-4">
              <p className="text-xs text-white/30 mb-3">Upcoming events this month:</p>
              {events.length === 0 ? (
                <p className="text-white/20 text-sm text-center py-4">No events this month</p>
              ) : (
                events
                  .slice()
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .slice(0, 8)
                  .map(ev => (
                    <div key={ev.id} className="flex items-center gap-2" data-testid={`sidebar-event-${ev.id}`}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getColor(ev) }} />
                      <span className="text-xs text-white/40 shrink-0">{new Date(ev.date + "T00:00:00").getDate()}</span>
                      <span className="text-xs text-white/60 truncate">{ev.title}</span>
                      {ev.isRecurring && <Repeat className="w-3 h-3 text-white/20 shrink-0" />}
                    </div>
                  ))
              )}
            </div>
          ) : selectedEvents.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="w-8 h-8 text-white/10 mx-auto mb-2" />
              <p className="text-white/30 text-sm">No events on this day</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {selectedEvents.map(ev => (
                <div key={ev.id} className="p-3 rounded-lg border border-white/5" style={{ borderLeftColor: getColor(ev), borderLeftWidth: 3 }} data-testid={`event-detail-${ev.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-white" data-testid={`text-event-title-${ev.id}`}>{ev.title}</p>
                    {ev.isRecurring && <Repeat className="w-3.5 h-3.5 text-white/30 shrink-0 mt-0.5" />}
                  </div>
                  <p className="text-[11px] mt-1 capitalize" style={{ color: getColor(ev) }}>
                    {EVENT_TYPES.find(t => t.value === ev.eventType)?.label || ev.eventType}
                  </p>
                  {ev.description && (
                    <p className="text-[11px] text-white/40 mt-1">{ev.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
