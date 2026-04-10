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

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAYS_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

const EVENT_TYPES = [
  { value: "holiday", label: "Holiday", color: "#ef4444", icon: Flame },
  { value: "academic", label: "Academic", color: "#3b82f6", icon: BookOpen },
  { value: "examination", label: "Examination", color: "#3b82f6", icon: Award },
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
      <p className="text-[10px] mb-1" style={{ color }}>
        <EventTypeLabel eventType={ev.eventType} />
      </p>
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

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export default function CalendarModule({ teacher }: { teacher: TeacherMe }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  const { data: events = [], isLoading, isError, refetch, isFetching } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/teacher/calendar", month + 1, year],
    queryFn: async () => {
      const r = await fetch(`/api/teacher/calendar?month=${month + 1}&year=${year}`, { credentials:"include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    staleTime: 30000,
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

  function handleDayClick(key: string) {
    const isMobile = window.innerWidth < 1024;
    setSelectedDay(key);
    if (isMobile) setBottomSheetOpen(true);
  }

  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  const holidayCount = events.filter(e => e.eventType === "holiday").length;

  const sortedMonthEvents = useMemo(() =>
    events.slice().sort((a, b) => a.date.localeCompare(b.date)),
    [events]
  );

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

  const navBar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-white" data-testid="heading-teacher-calendar">School Calendar</h2>
        <p className="text-white/40 text-sm">{events.length} events · {holidayCount} holidays this month</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-sync-now"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/50 text-sm hover:text-white hover:border-white/20 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Sync Now
        </button>
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
  );

  if (isMobile) {
    return (
      <div className="space-y-4" data-testid="teacher-calendar-mobile">
        {navBar}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-white/40" />
          </div>
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
                    aria-label={`View events for ${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`}
                  >
                    <span className="text-xs font-bold uppercase tracking-widest">
                      {d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
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

        <AnimatePresence>
          {bottomSheetOpen && selectedDay ? (
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
                  {(eventsByDate[selectedDay] || []).length === 0 ? (
                    <div className="text-center py-8">
                      <Calendar className="w-10 h-10 text-white/10 mx-auto mb-3" />
                      <p className="text-white/30">No events on this day</p>
                    </div>
                  ) : (
                    (eventsByDate[selectedDay] || []).map(ev => (
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
                    ))
                  )}
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {navBar}

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
                  onClick={() => handleDayClick(key)}
                  data-testid={`cell-day-${day}`}
                  className={`min-h-[68px] border-b border-r border-white/5 p-1.5 cursor-pointer transition-colors
                    ${hasHoliday ? "bg-red-500/5" : ""}
                    ${isSelected ? "bg-emerald-500/10" : "hover:bg-white/5"}
                  `}
                >
                  <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1
                    ${today ? "bg-emerald-500 text-white font-bold" : "text-white/50"}
                  `} data-testid={`text-day-${day}`}>
                    {day}
                  </span>
                  <div className="space-y-0.5">
                    {dayEvs.slice(0, 2).map(ev => (
                      <EventChip key={ev.id} ev={ev} />
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
                  <p className="text-[11px] mt-1 capitalize" style={{ color: getColor(ev) }}>
                    <EventTypeLabel eventType={ev.eventType} />
                  </p>
                  {ev.description && (
                    <p className="text-[11px] text-white/40 mt-1">{ev.description}</p>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {bottomSheetOpen && selectedDay && (
          <motion.div
            className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0"
              style={{ background: "rgba(0,0,0,0.6)" }}
              onClick={() => setBottomSheetOpen(false)}
            />
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
                  <p className="text-xs text-white/40">
                    {DAYS_FULL[new Date(selectedDay + "T00:00:00").getDay()]}
                  </p>
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
                ) : (
                  selectedEvents.map(ev => (
                    <div
                      key={ev.id}
                      className="p-3 rounded-xl border border-white/5"
                      style={{ borderLeftColor: getColor(ev), borderLeftWidth: 3, background: `${getColor(ev)}10` }}
                      data-testid={`mobile-event-detail-${ev.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <p className="text-sm font-semibold text-white">{ev.title}</p>
                        {ev.isRecurring && <Repeat className="w-3.5 h-3.5 text-white/30 mt-0.5" />}
                      </div>
                      <p className="text-xs mt-1" style={{ color: getColor(ev) }}>
                        <EventTypeLabel eventType={ev.eventType} />
                      </p>
                      {ev.description && (
                        <p className="text-xs text-white/40 mt-1">{ev.description}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
