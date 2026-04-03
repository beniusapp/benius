import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Clock, Loader2, School } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

interface StudentMe {
  id: number;
  name: string;
  class: string;
  section: string;
  schoolName: string;
}

interface TimetableEntry {
  id: number;
  teacherId: number;
  schoolId: number;
  dayOfWeek: number;
  period: number;
  class: string;
  section: string;
  subject: string;
  startTime: string | null;
  endTime: string | null;
  teacherName?: string;
}

interface CalendarEvent {
  id: number;
  date: string;
  eventType: string;
  title: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS = [1, 2, 3, 4, 5, 6]; // Mon=1 to Sat=6

function getCurrentMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function formatTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

function todayDayOfWeek(): number {
  const d = new Date().getDay();
  return d === 0 ? 6 : d; // Mon=1..Sat=6, Sun maps to 6 for "today" fallback
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekDateFor(dayOfWeek: number): string {
  const today = new Date();
  const todayDow = today.getDay(); // 0=Sun..6=Sat
  const targetDow = dayOfWeek === 6 ? 6 : dayOfWeek; // we use 1=Mon..6=Sat
  const diff = targetDow - todayDow;
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
}

export default function StudentTimetable() {
  const [, setLocation] = useLocation();
  const initialDay = (() => {
    const d = new Date().getDay();
    return d === 0 ? 1 : d; // if Sunday, default to Monday
  })();
  const [selectedDay, setSelectedDay] = useState<number>(initialDay);
  const [currentMinutes, setCurrentMinutes] = useState(getCurrentMinutes());

  useEffect(() => {
    const interval = setInterval(() => setCurrentMinutes(getCurrentMinutes()), 60000);
    return () => clearInterval(interval);
  }, []);

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const { data: entries = [], isLoading: ttLoading } = useQuery<TimetableEntry[]>({
    queryKey: ["/api/student/timetable"],
    enabled: !!student,
  });

  const { data: calEvents = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/student/calendar"],
    enabled: !!student,
  });

  const dayEntries = entries
    .filter(e => e.dayOfWeek === selectedDay)
    .sort((a, b) => a.period - b.period);

  const selectedDateStr = weekDateFor(selectedDay);
  const isHolidayDay = calEvents.some(
    e => e.date === selectedDateStr && e.eventType.toLowerCase() === "holiday"
  );
  const holidayEvent = calEvents.find(
    e => e.date === selectedDateStr && e.eventType.toLowerCase() === "holiday"
  );

  const isTodaySelected = selectedDay === todayDayOfWeek() && selectedDateStr === todayDateStr();

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
            <p className="text-white font-bold text-sm leading-tight">Timetable</p>
            <p className="text-emerald-100 text-xs">Class {student.class} – {student.section} · {student.schoolName}</p>
          </div>
          <Clock className="w-5 h-5 text-white/70 flex-shrink-0" />
        </div>
      </header>

      {/* ── Day Strip ── */}
      <div className="sticky top-[60px] z-20 bg-[#f0fdf4]/90 backdrop-blur-sm border-b border-emerald-100">
        <div className="max-w-2xl mx-auto px-2 py-2">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
            {DAYS.map(day => {
              const isSelected = day === selectedDay;
              const dateStr = weekDateFor(day);
              const isHoliday = calEvents.some(e => e.date === dateStr && e.eventType.toLowerCase() === "holiday");
              const isTodayDow = new Date().getDay() === day;
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl min-w-[52px] transition-all ${
                    isSelected
                      ? "bg-[#10b981] text-white shadow-sm"
                      : "bg-white text-gray-700 border border-emerald-100 hover:border-[#10b981]"
                  }`}
                  data-testid={`day-btn-${day}`}
                >
                  <span className="text-xs font-semibold">{DAY_LABELS[day]}</span>
                  {isTodayDow && (
                    <span className={`mt-0.5 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : "bg-[#10b981]"}`} />
                  )}
                  {isHoliday && !isTodayDow && (
                    <span className={`mt-0.5 text-[8px] font-bold ${isSelected ? "text-red-200" : "text-red-400"}`}>Off</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 space-y-3">

        {/* ── Loading ── */}
        {ttLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-[#10b981]" />
          </div>
        )}

        {/* ── Holiday State ── */}
        {!ttLoading && isHolidayDay && (
          <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-8 flex flex-col items-center text-center gap-4">
            <div className="w-24 h-24 rounded-3xl bg-red-50 flex items-center justify-center">
              <School className="w-12 h-12 text-red-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800">School Closed</h3>
              {holidayEvent && (
                <p className="text-sm text-red-500 font-semibold mt-1">{holidayEvent.title}</p>
              )}
              <p className="text-sm text-gray-400 mt-1">Enjoy your holiday!</p>
            </div>
          </div>
        )}

        {/* ── Empty Timetable ── */}
        {!ttLoading && !isHolidayDay && dayEntries.length === 0 && (
          <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-8 flex flex-col items-center text-center gap-3">
            <Clock className="w-12 h-12 text-emerald-200" />
            <div>
              <h3 className="text-base font-bold text-gray-700">No periods scheduled</h3>
              <p className="text-sm text-gray-400 mt-1">No timetable set for {DAY_LABELS[selectedDay]}.</p>
            </div>
          </div>
        )}

        {/* ── Period List ── */}
        {!ttLoading && !isHolidayDay && dayEntries.length > 0 && (
          <div className="space-y-2.5">
            {dayEntries.map(entry => {
              const hasTime = entry.startTime && entry.endTime;
              const isActive = isTodaySelected && hasTime
                ? currentMinutes >= timeToMinutes(entry.startTime!) && currentMinutes < timeToMinutes(entry.endTime!)
                : false;
              const isPast = isTodaySelected && hasTime
                ? currentMinutes >= timeToMinutes(entry.endTime!)
                : false;

              return (
                <div
                  key={entry.id}
                  className={`relative bg-white rounded-2xl border shadow-sm px-4 py-4 flex items-center gap-4 overflow-hidden transition-all ${
                    isActive
                      ? "border-[#10b981] shadow-emerald-100 shadow-md"
                      : isPast
                      ? "border-gray-100 opacity-60"
                      : "border-emerald-50"
                  }`}
                  data-testid={`period-card-${entry.id}`}
                >
                  {/* Active pulsing left border */}
                  {isActive && (
                    <span className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#10b981] animate-pulse rounded-l-2xl" />
                  )}

                  {/* Period number badge */}
                  <div className={`flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm ${
                    isActive ? "bg-[#10b981] text-white" : "bg-emerald-50 text-[#10b981]"
                  }`}>
                    P{entry.period}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate">{entry.subject}</p>
                    {entry.teacherName && (
                      <p className="text-xs text-gray-500 truncate mt-0.5">{entry.teacherName}</p>
                    )}
                    {hasTime ? (
                      <p className={`text-xs mt-0.5 font-medium ${isActive ? "text-[#10b981]" : "text-gray-400"}`}>
                        {formatTime(entry.startTime)} – {formatTime(entry.endTime)}
                      </p>
                    ) : null}
                  </div>

                  {isActive && (
                    <span className="flex-shrink-0 px-2 py-1 rounded-full bg-emerald-50 text-[#10b981] text-[10px] font-bold border border-emerald-200">
                      NOW
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
