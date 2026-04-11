import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Clock, Loader2, School, Coffee } from "lucide-react";
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

interface StructureRow {
  id?: number;
  periodNumber: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  sortOrder: number;
}

interface CalendarEvent {
  id: number;
  date: string;
  eventType: string;
  title: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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
  return d === 0 ? 6 : d;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekDateFor(dayOfWeek: number): string {
  const today = new Date();
  const todayDow = today.getDay();
  const targetDow = dayOfWeek === 6 ? 6 : dayOfWeek;
  const diff = targetDow - todayDow;
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
}

function getSubjectColor(subject: string): string {
  const colors: Record<string, string> = {
    Mathematics: "#6366f1",
    Maths: "#6366f1",
    Math: "#6366f1",
    Science: "#10b981",
    Physics: "#3b82f6",
    Chemistry: "#8b5cf6",
    Biology: "#22c55e",
    English: "#f59e0b",
    History: "#ef4444",
    Geography: "#14b8a6",
    Hindi: "#ec4899",
    Computer: "#06b6d4",
    "Computer Science": "#06b6d4",
    PE: "#84cc16",
    Art: "#f97316",
    Music: "#a855f7",
  };
  return colors[subject] ?? "#10b981";
}

export default function StudentTimetable() {
  const [, setLocation] = useLocation();
  const initialDay = (() => {
    const d = new Date().getDay();
    return d === 0 ? 1 : d;
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

  const { data: ttData, isLoading: ttLoading } = useQuery<{ entries: TimetableEntry[]; structure: StructureRow[] }>({
    queryKey: ["/api/student/timetable"],
    queryFn: async () => {
      const r = await fetch("/api/student/timetable", { credentials: "include" });
      if (!r.ok) return { entries: [], structure: [] };
      return r.json();
    },
    enabled: !!student,
  });
  const entries: TimetableEntry[] = ttData?.entries ?? [];
  const structure: StructureRow[] = ttData?.structure ?? [];

  const { data: calEvents = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/student/calendar"],
    enabled: !!student,
  });

  const dayEntries = entries
    .filter(e => e.dayOfWeek === selectedDay)
    .sort((a, b) => a.period - b.period);

  const selectedDateStr = weekDateFor(selectedDay);
  const isHolidayDay = calEvents.some(e => e.date === selectedDateStr && e.eventType.toLowerCase() === "holiday");
  const holidayEvent = calEvents.find(e => e.date === selectedDateStr && e.eventType.toLowerCase() === "holiday");
  const isTodaySelected = selectedDay === todayDayOfWeek() && selectedDateStr === todayDateStr();

  // Build ordered display: merge structure (with breaks) + timetable entries
  const structureForDay = structure.length > 0 ? structure : [];

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0A1628" }}>
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-30" style={{ background: "#10b981", boxShadow: "0 2px 16px rgba(16,185,129,0.25)" }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-11 h-11 rounded-xl transition-colors flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.18)" }}
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: "#fff" }} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm leading-tight" style={{ color: "#fff" }}>Timetable</p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.80)" }}>
              Class {student.class} – {student.section} · {student.schoolName}
            </p>
          </div>
          <Clock className="w-5 h-5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.70)" }} />
        </div>
      </header>

      {/* ── Day Strip ── */}
      <div className="sticky top-[60px] z-20 border-b" style={{ background: "#0D1F3C", borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="max-w-2xl mx-auto px-2 py-2.5">
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
                  className="flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl min-w-[54px] transition-all"
                  style={{
                    background: isSelected ? "#10b981" : "rgba(255,255,255,0.05)",
                    border: isSelected ? "none" : "1px solid rgba(255,255,255,0.08)",
                  }}
                  data-testid={`day-btn-${day}`}
                >
                  <span className="text-xs font-bold" style={{ color: isSelected ? "#fff" : "rgba(255,255,255,0.60)" }}>
                    {DAY_LABELS[day]}
                  </span>
                  {isTodayDow && (
                    <span className="mt-0.5 w-1.5 h-1.5 rounded-full" style={{ background: isSelected ? "#fff" : "#10b981" }} />
                  )}
                  {isHoliday && !isTodayDow && (
                    <span className="mt-0.5 text-[8px] font-bold" style={{ color: isSelected ? "rgba(255,200,200,0.9)" : "#ef4444" }}>Off</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Selected day label ── */}
      <div className="max-w-2xl mx-auto w-full px-4 pt-4 pb-1">
        <p className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.40)" }}>
          {DAY_FULL[selectedDay]}{isTodaySelected ? " · Today" : ""}
        </p>
      </div>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 pb-8 space-y-2">

        {/* ── Loading ── */}
        {ttLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-[#10b981]" />
          </div>
        )}

        {/* ── Holiday State ── */}
        {!ttLoading && isHolidayDay && (
          <div className="rounded-2xl border p-8 flex flex-col items-center text-center gap-4 mt-2"
            style={{ background: "#1A2942", borderColor: "rgba(239,68,68,0.20)" }}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.12)" }}>
              <School className="w-10 h-10" style={{ color: "rgba(239,68,68,0.50)" }} />
            </div>
            <div>
              <h3 className="text-lg font-bold" style={{ color: "#fff" }}>School Closed</h3>
              {holidayEvent && (
                <p className="text-sm font-semibold mt-1" style={{ color: "#ef4444" }}>{holidayEvent.title}</p>
              )}
              <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.40)" }}>Enjoy your holiday!</p>
            </div>
          </div>
        )}

        {/* ── Empty Timetable (no structure, no entries) ── */}
        {!ttLoading && !isHolidayDay && structureForDay.length === 0 && dayEntries.length === 0 && (
          <div className="rounded-2xl border p-8 flex flex-col items-center text-center gap-3 mt-2"
            style={{ background: "#1A2942", borderColor: "rgba(255,255,255,0.08)" }}>
            <Clock className="w-12 h-12" style={{ color: "rgba(16,185,129,0.20)" }} />
            <div>
              <h3 className="text-base font-bold" style={{ color: "#fff" }}>No periods scheduled</h3>
              <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>No timetable set for {DAY_LABELS[selectedDay]}.</p>
            </div>
          </div>
        )}

        {/* ── Full Schedule with Breaks ── */}
        {!ttLoading && !isHolidayDay && (structureForDay.length > 0 || dayEntries.length > 0) && (
          <div className="space-y-2 pt-1">
            {/* If structure exists, merge breaks with periods */}
            {structureForDay.length > 0 ? (
              structureForDay.map((srow, idx) => {
                if (srow.isBreak) {
                  return (
                    <div key={idx} className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
                      style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.15)" }}>
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ background: "rgba(245,158,11,0.12)" }}>
                        <Coffee className="w-4 h-4" style={{ color: "#f59e0b" }} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "#f59e0b" }}>{srow.label || "Break"}</p>
                        {srow.startTime && srow.endTime && (
                          <p className="text-xs" style={{ color: "rgba(245,158,11,0.60)" }}>
                            {formatTime(srow.startTime)} – {formatTime(srow.endTime)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }

                // Find the matching timetable entry for this period
                const entry = dayEntries.find(e => e.period === srow.periodNumber);
                const timeStart = srow.startTime || entry?.startTime || null;
                const timeEnd = srow.endTime || entry?.endTime || null;
                const hasTime = !!(timeStart && timeEnd);
                const isActive = isTodaySelected && hasTime
                  ? currentMinutes >= timeToMinutes(timeStart!) && currentMinutes < timeToMinutes(timeEnd!)
                  : false;
                const isPast = isTodaySelected && hasTime
                  ? currentMinutes >= timeToMinutes(timeEnd!)
                  : false;
                const subjectColor = entry ? getSubjectColor(entry.subject) : "#334155";

                return (
                  <div
                    key={idx}
                    className="relative rounded-2xl overflow-hidden transition-all"
                    style={{
                      background: "#1A2942",
                      border: isActive
                        ? "1px solid #10b981"
                        : "1px solid rgba(255,255,255,0.07)",
                      opacity: isPast && !isActive ? 0.55 : 1,
                      boxShadow: isActive ? "0 0 20px rgba(16,185,129,0.22)" : "none",
                    }}
                    data-testid={entry ? `period-card-${entry.id}` : `period-empty-${idx}`}
                  >
                    {/* Active glow bar */}
                    {isActive && (
                      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: "#10b981" }} />
                    )}

                    <div className="px-4 py-3.5 flex items-center gap-4">
                      {/* Period badge */}
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center"
                        style={{ background: entry ? `${subjectColor}18` : "rgba(255,255,255,0.04)" }}>
                        <span className="text-[10px] font-bold" style={{ color: entry ? subjectColor : "rgba(255,255,255,0.20)" }}>P</span>
                        <span className="text-base font-black leading-none" style={{ color: entry ? subjectColor : "rgba(255,255,255,0.20)" }}>{srow.periodNumber}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        {entry ? (
                          <>
                            <p className="font-bold text-sm truncate" style={{ color: "#fff" }}>{entry.subject}</p>
                            {entry.teacherName && (
                              <p className="text-xs truncate mt-0.5 font-medium" style={{ color: "#fff" }}>{entry.teacherName}</p>
                            )}
                            {hasTime ? (
                              <p className="text-xs mt-0.5 font-bold" style={{ color: isActive ? "#10b981" : "#fff" }}>
                                {formatTime(timeStart)} – {formatTime(timeEnd)}
                              </p>
                            ) : srow.label && srow.label !== `Period ${srow.periodNumber}` ? (
                              <p className="text-xs mt-0.5 font-bold" style={{ color: "#fff" }}>{srow.label}</p>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <p className="font-bold text-sm" style={{ color: "#fff" }}>Free Period</p>
                            {hasTime && (
                              <p className="text-xs mt-0.5 font-bold" style={{ color: "#fff" }}>
                                {formatTime(timeStart)} – {formatTime(timeEnd)}
                              </p>
                            )}
                          </>
                        )}
                      </div>

                      {isActive && (
                        <span className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black"
                          style={{ background: "rgba(16,185,129,0.20)", color: "#10b981", border: "1px solid rgba(16,185,129,0.40)" }}>
                          NOW
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              /* No structure — just list period cards */
              dayEntries.map(entry => {
                const hasTime = entry.startTime && entry.endTime;
                const isActive = isTodaySelected && hasTime
                  ? currentMinutes >= timeToMinutes(entry.startTime!) && currentMinutes < timeToMinutes(entry.endTime!)
                  : false;
                const isPast = isTodaySelected && hasTime
                  ? currentMinutes >= timeToMinutes(entry.endTime!)
                  : false;
                const subjectColor = getSubjectColor(entry.subject);

                return (
                  <div
                    key={entry.id}
                    className="relative rounded-2xl overflow-hidden transition-all"
                    style={{
                      background: "#1A2942",
                      border: isActive ? "1px solid #10b981" : "1px solid rgba(255,255,255,0.07)",
                      opacity: isPast && !isActive ? 0.55 : 1,
                      boxShadow: isActive ? "0 0 20px rgba(16,185,129,0.22)" : "none",
                    }}
                    data-testid={`period-card-${entry.id}`}
                  >
                    {isActive && <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: "#10b981" }} />}
                    <div className="px-4 py-3.5 flex items-center gap-4">
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center"
                        style={{ background: `${subjectColor}18` }}>
                        <span className="text-[10px] font-bold" style={{ color: subjectColor }}>P</span>
                        <span className="text-base font-black leading-none" style={{ color: subjectColor }}>{entry.period}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm" style={{ color: "#fff" }}>{entry.subject}</p>
                        {entry.teacherName && (
                          <p className="text-xs mt-0.5 font-medium" style={{ color: "#fff" }}>{entry.teacherName}</p>
                        )}
                        {hasTime && (
                          <p className="text-xs mt-0.5 font-bold" style={{ color: isActive ? "#10b981" : "#fff" }}>
                            {formatTime(entry.startTime)} – {formatTime(entry.endTime)}
                          </p>
                        )}
                      </div>
                      {isActive && (
                        <span className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black"
                          style={{ background: "rgba(16,185,129,0.20)", color: "#10b981", border: "1px solid rgba(16,185,129,0.40)" }}>
                          NOW
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>
    </div>
  );
}
