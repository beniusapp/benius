import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, ChevronLeft, ChevronRight, CalendarDays, Loader2 } from "lucide-react";
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
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getEventColor(eventType: string): { dot: string; bg: string; text: string; border: string } {
  switch (eventType.toLowerCase()) {
    case "holiday":
      return { dot: "bg-red-400", bg: "bg-red-50", text: "text-red-700", border: "border-red-200" };
    case "examination":
      return { dot: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
    case "academic":
      return { dot: "bg-blue-400", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
    default:
      return { dot: "bg-[#10b981]", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" };
  }
}

function getEventDotColor(ev: CalendarEvent): string {
  if (ev.colorCode) return ev.colorCode;
  switch (ev.eventType.toLowerCase()) {
    case "holiday": return "#f87171";
    case "examination": return "#3b82f6";
    case "academic": return "#60a5fa";
    default: return "#10b981";
  }
}

function getEventTypeLabel(eventType: string): string {
  switch (eventType.toLowerCase()) {
    case "holiday": return "Holiday / School Closed";
    case "examination": return "Examination";
    case "academic": return "Academic";
    default: return "School Event";
  }
}

export default function StudentCalendar() {
  const [, setLocation] = useLocation();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [modalEvents, setModalEvents] = useState<CalendarEvent[] | null>(null);
  const [modalDate, setModalDate] = useState<string>("");

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const { data: events = [], isLoading: eventsLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/student/calendar"],
    enabled: !!student,
  });

  const eventsByDate = events.reduce<Record<string, CalendarEvent[]>>((acc, ev) => {
    if (!acc[ev.date]) acc[ev.date] = [];
    acc[ev.date].push(ev);
    return acc;
  }, {});

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  function dateStr(d: number) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function isSunday(d: number) {
    return new Date(viewYear, viewMonth, d).getDay() === 0;
  }

  function handleDayClick(d: number) {
    const ds = dateStr(d);
    const dayEvents = eventsByDate[ds] || [];
    const sunday = isSunday(d);
    if (dayEvents.length > 0) {
      setModalDate(ds);
      setModalEvents(dayEvents);
    } else if (sunday) {
      setModalDate(ds);
      setModalEvents([]);
    }
  }

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fdf4] flex flex-col">

      {/* ── Header ── */}
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
          <CalendarDays className="w-5 h-5 text-white/70 flex-shrink-0" />
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 space-y-4">

        {/* ── Month Navigator ── */}
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

          {/* Day header row */}
          <div className="grid grid-cols-7 border-b border-emerald-50">
            {DAYS.map(d => (
              <div key={d} className={`py-2 text-center text-xs font-semibold ${d === "Sun" ? "text-red-400" : "text-gray-500"}`}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          {eventsLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {/* Empty cells for first week */}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`e-${i}`} className="min-h-[52px] sm:min-h-[64px] border-r border-b border-emerald-50/50" />
              ))}

              {/* Day cells */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const d = i + 1;
                const ds = dateStr(d);
                const dayEvents = eventsByDate[ds] || [];
                const isToday = ds === todayStr;
                const sunday = isSunday(d);
                const isHoliday = dayEvents.some(e => e.eventType.toLowerCase() === "holiday");
                const hasEvents = dayEvents.length > 0 || sunday;
                const col = (firstDay + i) % 7;

                return (
                  <div
                    key={d}
                    className={`min-h-[52px] sm:min-h-[64px] p-1 border-r border-b border-emerald-50/50 flex flex-col items-center gap-1 transition-colors
                      ${hasEvents ? "cursor-pointer hover:bg-emerald-50/60 active:bg-emerald-100/60" : ""}
                      ${col === 0 ? "border-l-0" : ""}
                    `}
                    onClick={() => handleDayClick(d)}
                    data-testid={`day-cell-${ds}`}
                  >
                    <span className={`
                      w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold
                      ${isToday ? "bg-[#10b981] text-white shadow-sm" : ""}
                      ${(sunday || isHoliday) && !isToday ? "text-red-400" : ""}
                      ${!isToday && !sunday && !isHoliday ? "text-gray-700" : ""}
                    `}>
                      {d}
                    </span>
                    {/* Event dots */}
                    <div className="flex flex-wrap gap-0.5 justify-center">
                      {sunday && dayEvents.length === 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-300" />
                      )}
                      {dayEvents.slice(0, 3).map(ev => (
                        <span key={ev.id} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getEventDotColor(ev) }} />
                      ))}
                      {dayEvents.length > 3 && <span className="text-[8px] text-gray-400">+{dayEvents.length - 3}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Legend ── */}
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Event Legend</p>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#10b981]" />
              <span className="text-xs text-gray-600">School Events</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-400" />
              <span className="text-xs text-gray-600">Holiday / Sunday</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-xs text-gray-600">Examination</span>
            </div>
          </div>
        </div>

        {/* ── This month's events list ── */}
        {!eventsLoading && (() => {
          const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
          const monthEvents = events.filter(e => e.date.startsWith(monthPrefix)).sort((a, b) => a.date.localeCompare(b.date));
          if (monthEvents.length === 0) return null;
          return (
            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Events This Month</p>
              {monthEvents.map(ev => {
                const { bg, text, border, dot } = getEventColor(ev.eventType);
                const d = new Date(ev.date + "T12:00:00");
                const label = d.toLocaleDateString("en-GB");
                return (
                  <div key={ev.id} className={`flex items-start gap-3 p-3 rounded-xl border ${bg} ${border}`} data-testid={`event-item-${ev.id}`}>
                    <span className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold ${text}`}>{ev.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{label} · {getEventTypeLabel(ev.eventType)}</p>
                      {ev.venue && <p className="text-xs text-gray-400 mt-0.5">📍 {ev.venue}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </main>

      {/* ── Glassmorphism Event Modal ── */}
      {modalEvents !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
          onClick={() => setModalEvents(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
            style={{
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.6)",
            }}
            onClick={e => e.stopPropagation()}
            data-testid="modal-event"
          >
            {/* Modal header */}
            <div className="bg-[#10b981] px-5 py-4">
              <p className="text-white font-bold text-base">
                {new Date(modalDate + "T12:00:00").toLocaleDateString("en-GB")}
                {" — "}{new Date(modalDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long" })}
              </p>
            </div>

            {/* Modal body */}
            <div className="px-5 py-4 space-y-3 max-h-80 overflow-y-auto">
              {modalEvents.length === 0 ? (
                <div className="text-center py-4">
                  <span className="text-3xl">🌴</span>
                  <p className="font-semibold text-gray-700 mt-2">Sunday — No School</p>
                  <p className="text-sm text-gray-400 mt-1">Enjoy your rest day!</p>
                </div>
              ) : (
                modalEvents.map(ev => {
                  const { bg, text, border } = getEventColor(ev.eventType);
                  return (
                    <div key={ev.id} className={`p-3 rounded-xl border ${bg} ${border}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className={`font-semibold text-sm ${text}`}>{ev.title}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${bg} ${text} ${border} border`}>
                          {getEventTypeLabel(ev.eventType)}
                        </span>
                      </div>
                      {ev.venue && <p className="text-xs text-gray-500">📍 {ev.venue}</p>}
                      {ev.description && <p className="text-xs text-gray-600 mt-1">{ev.description}</p>}
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-5 pb-4">
              <button
                onClick={() => setModalEvents(null)}
                className="w-full h-11 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-sm transition-colors"
                data-testid="button-close-modal"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
