import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Clock, Loader2, School, Coffee } from "lucide-react";
import { getQueryFn, sessionFetchForViewSession } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";
import { SessionArchiveBanner } from "@/components/session-archive-banner";
import { useISTToday } from "@/hooks/use-ist-today";
import {
  isTimetablePeriodActive,
  timetableDateForDay,
  timetableDayForDate,
  timetableTimeToMinutes,
} from "@/lib/student-timetable-time";
import { minutesSinceMidnightIST } from "@shared/ist-time";

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

// Admin/teacher grid stores Mon=0, Tue=1 … Sat=5 — student view must match exactly.
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS = [0, 1, 2, 3, 4, 5]; // Mon=0 to Sat=5 — matches admin dayOfWeek storage

function formatTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${String(m || 0).padStart(2, "0")} ${ampm}`;
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
  const { isArchiveMode, selectedSession, isSessionsLoading } = useSessionView();
  // The provider restores a deliberate selection before falling back to the active session.
  const sessionId = selectedSession?.id ?? null;
  const today = useISTToday();
  const previousToday = useRef(today);
  const [selectedDay, setSelectedDay] = useState<number>(() => timetableDayForDate(today));
  const [currentMinutes, setCurrentMinutes] = useState(minutesSinceMidnightIST);

  useEffect(() => {
    const updateCurrentMinutes = () => setCurrentMinutes(minutesSinceMidnightIST());
    updateCurrentMinutes();
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      updateCurrentMinutes();
      interval = window.setInterval(updateCurrentMinutes, 60000);
    }, 60000 - (Date.now() % 60000) + 25);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const previousDay = timetableDayForDate(previousToday.current);
    setSelectedDay(current => current === previousDay ? timetableDayForDate(today) : current);
    previousToday.current = today;
  }, [today]);

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const { data: ttData, isLoading: ttLoading, isError: ttError, error: ttFailure } = useQuery<{ entries: TimetableEntry[]; structure: StructureRow[] }>({
    queryKey: ["/api/student/timetable", sessionId],
    queryFn: async ({ queryKey, signal }) => {
      const querySessionId = queryKey[1] as number;
      const r = await sessionFetchForViewSession("/api/student/timetable", querySessionId, { signal });
      if (!r.ok) throw new Error(`Unable to load timetable (${r.status}).`);
      return r.json();
    },
    enabled: !!student && sessionId !== null,
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

  const selectedDateStr = timetableDateForDay(today, selectedDay);
  const isHolidayDay = calEvents.some(e => e.date === selectedDateStr && e.eventType.toLowerCase() === "holiday");
  const holidayEvent = calEvents.find(e => e.date === selectedDateStr && e.eventType.toLowerCase() === "holiday");
  const isTodaySelected = selectedDay === timetableDayForDate(today) && selectedDateStr === today;

  // Build ordered display: merge structure (with breaks) + timetable entries
  const structureForDay = structure.length > 0 ? structure : [];

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: "#f8fafc" }}>

      {/* ── Decorative blobs ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", top: "38%", left: "28%", width: "360px", height: "360px", borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 65%)" }} />
      </div>

      {/* ── Header ── */}
      <header
        className="sticky top-0 z-30"
        style={{
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          background: "rgba(255, 255, 255, 0.75)",
          borderBottom: "1px solid rgba(255,255,255,0.7)",
          boxShadow: "0 1px 28px rgba(0,0,0,0.07)",
        }}
      >
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-10 h-10 rounded-xl transition-colors flex-shrink-0"
            style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0" style={{ background: "linear-gradient(135deg, #0ea5e9, #3b82f6)" }}>
              <Clock className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="font-bold text-sm text-slate-800">Timetable</p>
              <p className="text-[11px] text-slate-400 truncate">Class {student.class} – {student.section} · {student.schoolName}</p>
            </div>
          </div>
        </div>
      </header>

      {/* ── Archive mode banner ── */}
      {isArchiveMode && selectedSession && (
        <div className="max-w-2xl mx-auto w-full px-4 pt-4">
          <SessionArchiveBanner sessionName={selectedSession.sessionName} />
        </div>
      )}

      {/* ── Day Strip ── */}
      <div className="sticky top-14 z-20 border-b bg-white/80 backdrop-blur-sm" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
        <div className="max-w-2xl mx-auto px-2 py-2.5">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
            {DAYS.map(day => {
              const isSelected = day === selectedDay;
              const dateStr = timetableDateForDay(today, day);
              const isHoliday = calEvents.some(e => e.date === dateStr && e.eventType.toLowerCase() === "holiday");
              const isTodayDow = timetableDayForDate(today) === day;
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className="flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl min-w-[54px] transition-all"
                  style={{
                    background: isSelected ? "#10b981" : "rgba(100,116,139,0.08)",
                    border: isSelected ? "none" : "1px solid rgba(100,116,139,0.15)",
                  }}
                  data-testid={`day-btn-${day}`}
                >
                  <span className="text-xs font-bold" style={{ color: isSelected ? "#fff" : "#4B5563" }}>
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
        <p className="text-xs font-semibold text-slate-400">
          {DAY_FULL[selectedDay]}{isTodaySelected ? " · Today" : ""}
        </p>
      </div>

      <motion.main
        className="flex-1 max-w-2xl mx-auto w-full px-4 pb-8 space-y-2"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >

        {/* ── Loading ── */}
        {(ttLoading || isSessionsLoading) && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-[#10b981]" />
          </div>
        )}

        {!isSessionsLoading && sessionId === null && (
          <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
            No academic session available for timetable.
          </p>
        )}

        {!isSessionsLoading && sessionId !== null && ttError && (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
            {ttFailure?.message ?? "Unable to load timetable."}
          </p>
        )}

        {/* ── Holiday State ── */}
        {!ttLoading && !isSessionsLoading && sessionId !== null && !ttError && isHolidayDay && (
          <div className="rounded-2xl border border-red-100 p-8 flex flex-col items-center text-center gap-4 mt-2 bg-white shadow-sm">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center bg-red-50">
              <School className="w-10 h-10 text-red-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">School Closed</h3>
              {holidayEvent && (
                <p className="text-sm font-semibold mt-1 text-red-500">{holidayEvent.title}</p>
              )}
              <p className="text-sm mt-1 text-slate-400">Enjoy your holiday!</p>
            </div>
          </div>
        )}

        {/* ── Empty Timetable (no structure, no entries) ── */}
        {!ttLoading && !isSessionsLoading && sessionId !== null && !ttError && !isHolidayDay && structureForDay.length === 0 && dayEntries.length === 0 && (
          <div className="rounded-2xl border border-slate-100 p-8 flex flex-col items-center text-center gap-3 mt-2 bg-white shadow-sm">
            <Clock className="w-12 h-12 text-slate-200" />
            <div>
              <h3 className="text-base font-bold text-slate-700">No periods scheduled</h3>
              <p className="text-sm mt-1 text-slate-400">No timetable set for {DAY_LABELS[selectedDay]}.</p>
            </div>
          </div>
        )}

        {/* ── Full Schedule with Breaks ── */}
        {!ttLoading && !isSessionsLoading && sessionId !== null && !ttError && !isHolidayDay && (structureForDay.length > 0 || dayEntries.length > 0) && (
          <div className="space-y-2 pt-1">
            {/* If structure exists, merge breaks with periods */}
            {structureForDay.length > 0 ? (
              structureForDay.map((srow, idx) => {
                if (srow.isBreak) {
                  return (
                    <div key={idx} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-100">
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-amber-100">
                        <Coffee className="w-4 h-4 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-amber-700">{srow.label || "Break"}</p>
                        {srow.startTime && srow.endTime && (
                          <p className="text-xs text-amber-500">
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
                  ? isTimetablePeriodActive(currentMinutes, timeStart!, timeEnd!)
                  : false;
                const isPast = isTodaySelected && hasTime
                  ? currentMinutes >= timetableTimeToMinutes(timeEnd!)
                  : false;
                const subjectColor = entry ? getSubjectColor(entry.subject) : "#94a3b8";

                return (
                  <div
                    key={idx}
                    className="relative rounded-2xl overflow-hidden transition-all bg-white"
                    style={{
                      border: isActive ? `1px solid ${subjectColor}` : "1px solid rgba(0,0,0,0.07)",
                      opacity: isPast && !isActive ? 0.55 : 1,
                      boxShadow: isActive ? `0 0 20px ${subjectColor}33` : "0 1px 4px rgba(0,0,0,0.05)",
                    }}
                    data-testid={entry ? `period-card-${entry.id}` : `period-empty-${idx}`}
                  >
                    {/* Active accent bar */}
                    {isActive && (
                      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: subjectColor }} />
                    )}

                    <div className="px-4 py-3.5 flex items-center gap-4">
                      {/* Period badge */}
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center"
                        style={{ background: entry ? `${subjectColor}15` : "rgba(0,0,0,0.03)" }}>
                        <span className="text-[10px] font-bold" style={{ color: entry ? subjectColor : "#cbd5e1" }}>P</span>
                        <span className="text-base font-black leading-none" style={{ color: entry ? subjectColor : "#cbd5e1" }}>{srow.periodNumber}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        {entry ? (
                          <>
                            <p className="font-bold text-sm truncate text-slate-800">{entry.subject}</p>
                            {entry.teacherName && (
                              <p className="text-xs truncate mt-0.5 font-medium text-slate-500">{entry.teacherName}</p>
                            )}
                            {hasTime ? (
                              <p className="text-xs mt-0.5 font-bold" style={{ color: isActive ? subjectColor : "#64748b" }}>
                                {formatTime(timeStart)} – {formatTime(timeEnd)}
                              </p>
                            ) : srow.label && srow.label !== `Period ${srow.periodNumber}` ? (
                              <p className="text-xs mt-0.5 font-bold text-slate-500">{srow.label}</p>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <p className="font-bold text-sm text-slate-400">Free Period</p>
                            {hasTime && (
                              <p className="text-xs mt-0.5 font-bold text-slate-400">
                                {formatTime(timeStart)} – {formatTime(timeEnd)}
                              </p>
                            )}
                          </>
                        )}
                      </div>

                      {isActive && (
                        <span className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black"
                          style={{ background: `${subjectColor}20`, color: subjectColor, border: `1px solid ${subjectColor}40` }}>
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
                  ? isTimetablePeriodActive(currentMinutes, entry.startTime!, entry.endTime!)
                  : false;
                const isPast = isTodaySelected && hasTime
                  ? currentMinutes >= timetableTimeToMinutes(entry.endTime!)
                  : false;
                const subjectColor = getSubjectColor(entry.subject);

                return (
                  <div
                    key={entry.id}
                    className="relative rounded-2xl overflow-hidden transition-all bg-white"
                    style={{
                      border: isActive ? `1px solid ${subjectColor}` : "1px solid rgba(0,0,0,0.07)",
                      opacity: isPast && !isActive ? 0.55 : 1,
                      boxShadow: isActive ? `0 0 20px ${subjectColor}33` : "0 1px 4px rgba(0,0,0,0.05)",
                    }}
                    data-testid={`period-card-${entry.id}`}
                  >
                    {isActive && <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: subjectColor }} />}
                    <div className="px-4 py-3.5 flex items-center gap-4">
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center"
                        style={{ background: `${subjectColor}15` }}>
                        <span className="text-[10px] font-bold" style={{ color: subjectColor }}>P</span>
                        <span className="text-base font-black leading-none" style={{ color: subjectColor }}>{entry.period}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-slate-800">{entry.subject}</p>
                        {entry.teacherName && (
                          <p className="text-xs mt-0.5 font-medium text-slate-500">{entry.teacherName}</p>
                        )}
                        {hasTime && (
                          <p className="text-xs mt-0.5 font-bold" style={{ color: isActive ? subjectColor : "#64748b" }}>
                            {formatTime(entry.startTime)} – {formatTime(entry.endTime)}
                          </p>
                        )}
                      </div>
                      {isActive && (
                        <span className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black"
                          style={{ background: `${subjectColor}20`, color: subjectColor, border: `1px solid ${subjectColor}40` }}>
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
      </motion.main>
    </div>
  );
}
