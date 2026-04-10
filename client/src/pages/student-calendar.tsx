import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const EVENT_TYPES = [
  { value: "holiday", label: "Holiday", color: "#ef4444", dotClass: "bg-red-400", bg: "bg-red-50", text: "text-red-700", border: "border-red-200", icon: Flame },
  { value: "academic", label: "Academic", color: "#3b82f6", dotClass: "bg-blue-400", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-100", icon: BookOpen },
  { value: "examination", label: "Examination", color: "#8b5cf6", dotClass: "bg-purple-500", bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-100", icon: Award },
  { value: "event", label: "School Event", color: "#10b981", dotClass: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-100", icon: Star },
];

function getEventMeta(ev: CalendarEvent) {
  const et = EVENT_TYPES.find(t => t.value === ev.eventType) || EVENT_TYPES[3];
  const color = ev.colorCode || et.color;
  return { ...et, color };
}

function buildKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function formatDisplay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}

export default function StudentCalendar() {
  const [, setLocation] = useLocation();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const { data: events = [], isLoading: eventsLoading, refetch, isFetching } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/student/calendar"],
    enabled: !!student,
    staleTime: 30000,
  });

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

  const todayKey = buildKey(today.getFullYear(), today.getMonth(), today.getDate());
  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
  const monthEvents = events
    .filter(e => e.date.startsWith(monthPrefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  function handleDayClick(key: string, dayEvs: CalendarEvent[], isSunday: boolean) {
    if (dayEvs.length > 0 || isSunday) {
      setSelectedDay(key);
      setBottomSheetOpen(true);
    }
  }

  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fdf4] flex flex-col">
      <header className="sticky top-0 z-30 bg-[#10b981] shadow-md">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
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

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 space-y-4">
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-[#10b981]">
            <button
              onClick={prevMonth}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors"
              data-testid="button-prev-month"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <p className="text-white font-bold text-base" data-testid="text-month-year">
              {MONTHS[viewMonth]} {viewYear}
            </p>
            <button
              onClick={nextMonth}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors"
              data-testid="button-next-month"
              aria-label="Next month"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

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
                  return <div key={`e-${i}`} className="min-h-[52px] sm:min-h-[64px] border-r border-b border-emerald-50/50" />;
                }
                const key = buildKey(viewYear, viewMonth, day);
                const dayEvs = eventsByDate[key] || [];
                const isCurrentDay = key === todayKey;
                const isSunday = new Date(viewYear, viewMonth, day).getDay() === 0;
                const isHoliday = dayEvs.some(e => e.eventType === "holiday");
                const hasContent = dayEvs.length > 0 || isSunday;
                const isSelected = selectedDay === key;

                return (
                  <div
                    key={key}
                    className={`min-h-[52px] sm:min-h-[64px] p-1 border-r border-b border-emerald-50/50 flex flex-col items-center gap-1 transition-colors
                      ${hasContent ? "cursor-pointer hover:bg-emerald-50/60 active:bg-emerald-100/60" : ""}
                      ${isSelected ? "bg-emerald-50/80" : ""}
                    `}
                    onClick={() => handleDayClick(key, dayEvs, isSunday)}
                    data-testid={`day-cell-${key}`}
                  >
                    <span className={`
                      w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold
                      ${isCurrentDay ? "bg-[#10b981] text-white shadow-sm" : ""}
                      ${(isSunday || isHoliday) && !isCurrentDay ? "text-red-400" : ""}
                      ${!isCurrentDay && !isSunday && !isHoliday ? "text-gray-700" : ""}
                    `} data-testid={`text-day-${day}`}>
                      {day}
                    </span>
                    <div className="flex flex-wrap gap-0.5 justify-center">
                      {isSunday && dayEvs.length === 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-300" />
                      )}
                      {dayEvs.slice(0, 3).map(ev => (
                        <span
                          key={ev.id}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: (ev.colorCode || EVENT_TYPES.find(t => t.value === ev.eventType)?.color || "#10b981") }}
                        />
                      ))}
                      {dayEvs.length > 3 && <span className="text-[8px] text-gray-400">+{dayEvs.length - 3}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide flex items-center gap-2">
            <CalendarDays className="w-3.5 h-3.5 text-[#10b981]" /> Event Legend
          </p>
          <div className="flex flex-wrap gap-3">
            {EVENT_TYPES.map(t => (
              <div key={t.value} className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded-full ${t.dotClass}`} />
                <span className="text-xs text-gray-600">{t.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-300" />
              <span className="text-xs text-gray-600">Sunday</span>
            </div>
          </div>
        </div>

        {!eventsLoading && monthEvents.length > 0 && (
          <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Events This Month</p>
            {monthEvents.map(ev => {
              const meta = getEventMeta(ev);
              const displayDate = new Date(ev.date + "T00:00:00").toLocaleDateString("en-GB");
              return (
                <div
                  key={ev.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border ${meta.bg} ${meta.border}`}
                  data-testid={`event-item-${ev.id}`}
                  onClick={() => { setSelectedDay(ev.date.split("T")[0]); setBottomSheetOpen(true); }}
                  style={{ cursor: "pointer" }}
                >
                  <span className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: meta.color }} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${meta.text}`}>{ev.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{displayDate} · {meta.label}</p>
                    {ev.venue && <p className="text-xs text-gray-400 mt-0.5">📍 {ev.venue}</p>}
                    {ev.isRecurring && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Repeat className="w-2.5 h-2.5 text-gray-300" />
                        <span className="text-[10px] text-gray-400">Recurring</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!eventsLoading && monthEvents.length === 0 && (
          <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-8 text-center">
            <Calendar className="w-10 h-10 text-emerald-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No events this month</p>
            <p className="text-gray-400 text-sm mt-1">Check back later or view other months</p>
          </div>
        )}
      </main>

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
              style={{ background: "rgba(0,0,0,0.5)" }}
              onClick={() => setBottomSheetOpen(false)}
            />
            <motion.div
              className="relative rounded-t-2xl overflow-hidden shadow-2xl max-h-[75vh] overflow-y-auto"
              style={{ background: "white" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              data-testid="modal-event"
            >
              <div className="bg-[#10b981] px-5 py-4 flex items-center justify-between sticky top-0">
                <div>
                  <p className="text-white font-bold text-base">{formatDisplay(selectedDay)}</p>
                  <p className="text-emerald-100 text-xs">
                    {DAYS_FULL[new Date(selectedDay + "T00:00:00").getDay()]}
                  </p>
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
                    <span className="text-4xl">🌴</span>
                    <p className="font-semibold text-gray-700 mt-2">Sunday — No School</p>
                    <p className="text-sm text-gray-400 mt-1">Enjoy your rest day!</p>
                  </div>
                ) : (
                  selectedEvents.map(ev => {
                    const meta = getEventMeta(ev);
                    return (
                      <div key={ev.id} className={`p-3 rounded-xl border ${meta.bg} ${meta.border}`} data-testid={`modal-event-detail-${ev.id}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className={`font-semibold text-sm ${meta.text}`}>{ev.title}</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.text} border ${meta.border}`}>
                            {meta.label}
                          </span>
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
                  })
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
