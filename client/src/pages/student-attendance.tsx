import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, Calendar, BarChart2, Info, Download,
  ChevronLeft, ChevronRight, GraduationCap, Loader2,
  CheckCircle, XCircle, AlertCircle, Clock, Sun, Umbrella,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface StudentMeResponse {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  schoolName: string;
  schoolCode: string;
  schoolId?: number;
}

interface DayData {
  date: string;
  dayOfWeek: number;
  status: string;
  teacherId: number | null;
  markedBy: string | null;
  isHoliday: boolean;
  holidayName: string | null;
  isApprovedLeave: boolean;
  isSunday: boolean;
  isFuture: boolean;
}

interface MonthlyResponse {
  schoolId: number;
  studentId: number;
  year: number;
  month: number;
  days: DayData[];
}

interface MonthStat {
  month: number;
  year: number;
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  holiday: number;
  workingDays: number;
}

interface YearlyResponse {
  months: MonthStat[];
}

interface StatsResponse {
  overallPercent: number;
  workingDays: number;
  totalPresent: number;
  totalAbsent: number;
  totalHalfDay: number;
  totalLeave: number;
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function getCurrentAcademicYear(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const startYear = m >= 3 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function getAcademicYearOptions(): string[] {
  const base = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => {
    const y = base - 2 + i;
    return `${y}-${String(y + 1).slice(-2)}`;
  }).reverse();
}

function getDayCell(day: DayData): {
  bg: string;
  ring: string;
  dot: string | null;
  label: string;
  textColor: string;
} {
  if (day.isSunday || day.isHoliday) {
    return { bg: "bg-slate-100", ring: "", dot: null, label: day.isHoliday ? (day.holidayName || "Holiday") : "Sunday", textColor: "text-slate-400" };
  }
  if (day.isFuture) {
    return { bg: "", ring: "", dot: null, label: "", textColor: "text-slate-400" };
  }
  if (day.isApprovedLeave && day.status === "none") {
    return { bg: "bg-sky-100", ring: "ring-2 ring-sky-400", dot: null, label: "Approved Leave", textColor: "text-sky-700" };
  }
  if (day.status === "present") {
    return { bg: "bg-emerald-500", ring: "", dot: null, label: "Present", textColor: "text-white" };
  }
  if (day.status === "absent") {
    return { bg: "bg-red-400", ring: "", dot: null, label: "Absent", textColor: "text-white" };
  }
  if (day.status === "half_day" || day.status === "late") {
    return { bg: "bg-amber-100", ring: "", dot: "bg-amber-500", label: day.status === "late" ? "Late" : "Half Day", textColor: "text-amber-800" };
  }
  if (day.status === "leave") {
    return { bg: "bg-sky-100", ring: "ring-2 ring-sky-400", dot: null, label: "Leave", textColor: "text-sky-700" };
  }
  return { bg: "", ring: "", dot: null, label: "Not marked", textColor: "text-slate-300" };
}

export default function StudentAttendance() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"monthly" | "yearly">("monthly");

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [academicYear, setAcademicYear] = useState(getCurrentAcademicYear);
  const [tooltip, setTooltip] = useState<{ day: DayData; x: number; y: number } | null>(null);

  const calendarRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  const { data: student, isLoading: studentLoading } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: statsData, isLoading: statsLoading } = useQuery<StatsResponse>({
    queryKey: ["/api/student/attendance/stats", academicYear],
    queryFn: async (): Promise<StatsResponse> => {
      const res = await fetch(`/api/student/attendance/stats?academicYear=${encodeURIComponent(academicYear)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load attendance stats (${res.status})`);
      return res.json();
    },
    enabled: !!student,
  });

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery<MonthlyResponse>({
    queryKey: ["/api/student/attendance/monthly", selectedYear, selectedMonth],
    queryFn: async (): Promise<MonthlyResponse> => {
      const res = await fetch(`/api/student/attendance/monthly?year=${selectedYear}&month=${selectedMonth}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load monthly attendance (${res.status})`);
      return res.json();
    },
    enabled: !!student && activeTab === "monthly",
  });

  const { data: yearlyData, isLoading: yearlyLoading } = useQuery<YearlyResponse>({
    queryKey: ["/api/student/attendance/yearly", academicYear],
    queryFn: async (): Promise<YearlyResponse> => {
      const res = await fetch(`/api/student/attendance/yearly?academicYear=${academicYear}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load yearly attendance (${res.status})`);
      return res.json();
    },
    enabled: !!student && activeTab === "yearly",
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const goToPrevMonth = useCallback(() => {
    setSelectedMonth(m => {
      if (m === 1) { setSelectedYear(y => y - 1); return 12; }
      return m - 1;
    });
    setTooltip(null);
  }, []);

  const goToNextMonth = useCallback(() => {
    const nextDate = new Date(selectedYear, selectedMonth, 1);
    const todayDate = new Date(now.getFullYear(), now.getMonth(), 1);
    if (nextDate > todayDate) return;
    setSelectedMonth(m => {
      if (m === 12) { setSelectedYear(y => y + 1); return 1; }
      return m + 1;
    });
    setTooltip(null);
  }, [selectedYear, selectedMonth]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) goToNextMonth();
      else goToPrevMonth();
    }
    touchStartX.current = null;
  };

  const handleDayClick = (day: DayData, e: React.MouseEvent) => {
    if (day.isFuture) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const parentRect = calendarRef.current?.getBoundingClientRect();
    if (!parentRect) return;
    setTooltip(prev => prev?.day.date === day.date ? null : {
      day,
      x: rect.left - parentRect.left + rect.width / 2,
      y: rect.top - parentRect.top,
    });
  };

  const handleDownload = () => {
    window.print();
  };

  const closeTooltip = () => setTooltip(null);

  if (studentLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  if (!student) return null;

  const days = monthlyData?.days || [];
  const firstDayOfMonth = days.length > 0 ? new Date(days[0].date + "T00:00:00").getDay() : 0;

  const monthlySummary = days.reduce(
    (acc, d) => {
      if (d.isSunday || d.isFuture) return acc;
      if (d.isHoliday) { acc.holiday++; return acc; }
      if (d.isApprovedLeave && d.status === "none") { acc.leave++; return acc; }
      if (d.status === "present") acc.present++;
      else if (d.status === "absent") acc.absent++;
      else if (d.status === "half_day" || d.status === "late") acc.halfDay++;
      else if (d.status === "leave") acc.leave++;
      return acc;
    },
    { present: 0, absent: 0, halfDay: 0, leave: 0, holiday: 0 }
  );

  const yearMonths = yearlyData?.months || [];
  const maxWorkingDays = Math.max(...yearMonths.map(m => m.workingDays), 1);

  const isNextDisabled = (() => {
    const nextDate = new Date(selectedYear, selectedMonth, 1);
    const todayDate = new Date(now.getFullYear(), now.getMonth(), 1);
    return nextDate > todayDate;
  })();

  return (
    <div className="min-h-screen flex flex-col bg-[#f0fdf4] print:bg-white" onClick={() => tooltip && closeTooltip()}>

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-30 bg-[#10b981] shadow-md print:hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-11 h-11 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
            data-testid="button-back"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-white" />
            <div className="leading-tight">
              <p className="text-white font-bold text-base">Attendance</p>
              <p className="text-emerald-100 text-xs">{student.schoolName}</p>
            </div>
          </div>
          <div className="ml-auto text-right">
            <p className="text-white text-xs font-semibold">{student.digitalStudentId}</p>
            <p className="text-emerald-100 text-[10px]">Class {student.class}–{student.section}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-5 space-y-5 print:space-y-4 print:py-2">

        {/* ── Print Header (only in PDF) ── */}
        <div className="hidden print:flex print:items-center print:justify-between print:border-b print:border-slate-200 print:pb-3 print:mb-2">
          <div>
            <h1 className="text-xl font-bold text-emerald-700">BENIUS — Attendance Report</h1>
            <p className="text-sm text-slate-600">{student.name} ({student.digitalStudentId}) · Class {student.class}–{student.section}</p>
            <p className="text-xs text-slate-400">{student.schoolName} · Generated {new Date().toLocaleDateString("en-GB")}</p>
          </div>
        </div>

        {/* ── Quick Stats Bar ── */}
        <div
          className="flex overflow-x-auto gap-3 pb-1 sm:pb-0 sm:grid sm:grid-cols-4 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-none"
          data-testid="stats-bar"
        >
          {statsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-40 sm:w-auto bg-white rounded-2xl border border-emerald-100 shadow-sm p-4 animate-pulse h-20" />
            ))
          ) : (
            <>
              <div className="flex-shrink-0 w-40 sm:w-auto bg-white rounded-2xl border border-emerald-100 shadow-sm p-4 flex flex-col items-center justify-center" data-testid="stat-overall-percent">
                <p className="text-2xl sm:text-3xl font-extrabold text-emerald-500">
                  {statsData?.overallPercent ?? 0}%
                </p>
                <p className="text-[10px] sm:text-xs text-slate-500 font-medium mt-0.5 text-center">Overall Attendance</p>
              </div>
              <div className="flex-shrink-0 w-40 sm:w-auto bg-white rounded-2xl border border-emerald-100 shadow-sm p-4 flex flex-col items-center justify-center" data-testid="stat-working-days">
                <p className="text-2xl sm:text-3xl font-extrabold text-slate-700">{statsData?.workingDays ?? 0}</p>
                <p className="text-[10px] sm:text-xs text-slate-500 font-medium mt-0.5 text-center">Working Days</p>
              </div>
              <div className="flex-shrink-0 w-40 sm:w-auto bg-white rounded-2xl border border-emerald-100 shadow-sm p-4 flex flex-col items-center justify-center" data-testid="stat-present">
                <p className="text-2xl sm:text-3xl font-extrabold text-emerald-600">{statsData?.totalPresent ?? 0}</p>
                <p className="text-[10px] sm:text-xs text-slate-500 font-medium mt-0.5 text-center">Days Present</p>
              </div>
              <div className="flex-shrink-0 w-40 sm:w-auto bg-white rounded-2xl border border-emerald-100 shadow-sm p-4 flex flex-col items-center justify-center" data-testid="stat-absent">
                <p className="text-2xl sm:text-3xl font-extrabold text-red-500">{statsData?.totalAbsent ?? 0}</p>
                <p className="text-[10px] sm:text-xs text-slate-500 font-medium mt-0.5 text-center">Days Absent</p>
              </div>
            </>
          )}
        </div>

        {/* ── Tab Toggle ── */}
        <div className="flex gap-2 print:hidden">
          <button
            onClick={() => setActiveTab("monthly")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors min-h-[44px] ${
              activeTab === "monthly"
                ? "bg-[#10b981] text-white shadow"
                : "bg-white text-slate-600 border border-emerald-100 hover:bg-emerald-50"
            }`}
            data-testid="tab-monthly"
          >
            <Calendar className="w-4 h-4" />
            Monthly View
          </button>
          <button
            onClick={() => setActiveTab("yearly")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors min-h-[44px] ${
              activeTab === "yearly"
                ? "bg-[#10b981] text-white shadow"
                : "bg-white text-slate-600 border border-emerald-100 hover:bg-emerald-50"
            }`}
            data-testid="tab-yearly"
          >
            <BarChart2 className="w-4 h-4" />
            Year View
          </button>
        </div>

        {/* ══════════════════════════════════
            MONTHLY VIEW
            ══════════════════════════════════ */}
        {(activeTab === "monthly") && (
          <>
            {/* Month navigator */}
            <div className="flex items-center justify-between gap-3 print:hidden">
              <button
                onClick={goToPrevMonth}
                className="w-11 h-11 flex items-center justify-center rounded-xl bg-white border border-emerald-100 text-slate-600 hover:bg-emerald-50 transition-colors shadow-sm"
                data-testid="button-prev-month"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 flex items-center justify-center gap-2">
                <select
                  value={selectedMonth}
                  onChange={e => { setSelectedMonth(Number(e.target.value)); setTooltip(null); }}
                  className="border border-emerald-100 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 min-h-[44px]"
                  data-testid="select-month"
                >
                  {MONTH_NAMES.map((name, i) => (
                    <option key={i} value={i + 1}>{name}</option>
                  ))}
                </select>
                <select
                  value={selectedYear}
                  onChange={e => { setSelectedYear(Number(e.target.value)); setTooltip(null); }}
                  className="border border-emerald-100 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 min-h-[44px]"
                  data-testid="select-year"
                >
                  {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={goToNextMonth}
                disabled={isNextDisabled}
                className="w-11 h-11 flex items-center justify-center rounded-xl bg-white border border-emerald-100 text-slate-600 hover:bg-emerald-50 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="button-next-month"
                aria-label="Next month"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Print-only month label */}
            <div className="hidden print:block text-center font-bold text-slate-700 text-lg">
              {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </div>

            {/* Calendar grid */}
            <div
              ref={calendarRef}
              className="relative bg-white rounded-2xl border border-emerald-50 shadow-sm overflow-hidden select-none"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              data-testid="calendar-grid"
            >
              {/* Day-of-week headers */}
              <div className="grid grid-cols-7 border-b border-slate-100">
                {DAY_LABELS.map(d => (
                  <div key={d} className={`py-2 text-center text-[10px] sm:text-xs font-bold uppercase tracking-wide ${d === "Sun" ? "text-red-400" : "text-slate-400"}`}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Cells */}
              {monthlyLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-px bg-slate-50 p-2">
                  {/* Empty offset cells */}
                  {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square" />
                  ))}
                  {/* Date cells */}
                  {days.map((day) => {
                    const { bg, ring, dot, textColor } = getDayCell(day);
                    const dayNum = new Date(day.date + "T00:00:00").getDate();
                    return (
                      <button
                        key={day.date}
                        onClick={e => { e.stopPropagation(); handleDayClick(day, e); }}
                        disabled={day.isFuture}
                        className={`
                          aspect-square flex flex-col items-center justify-center rounded-full sm:rounded-xl
                          transition-all duration-150 relative
                          ${bg} ${ring} ${textColor}
                          ${!day.isFuture && !day.isSunday ? "cursor-pointer hover:scale-105 active:scale-95" : "cursor-default"}
                          text-[11px] sm:text-sm font-semibold
                          focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-400
                        `}
                        data-testid={`day-cell-${day.date}`}
                        aria-label={`${dayNum} - ${getDayCell(day).label}`}
                      >
                        {dayNum}
                        {dot && (
                          <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${dot}`} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Tooltip */}
              {tooltip && (
                <div
                  className="absolute z-20 bg-slate-800 text-white rounded-xl shadow-xl px-3 py-2.5 text-xs min-w-[160px] pointer-events-none"
                  style={{
                    left: `${tooltip.x}px`,
                    top: `${tooltip.y - 8}px`,
                    transform: "translate(-50%, -100%)",
                  }}
                  data-testid="tooltip-day"
                >
                  <p className="font-bold text-emerald-300 mb-1">
                    {new Date(tooltip.day.date + "T00:00:00").toLocaleDateString("en-GB")}
                  </p>
                  {tooltip.day.isHoliday && (
                    <p className="text-slate-300">🏖️ {tooltip.day.holidayName || "School Holiday"}</p>
                  )}
                  {tooltip.day.isApprovedLeave && tooltip.day.status === "none" && (
                    <p className="text-sky-300">✅ Approved Leave</p>
                  )}
                  {!tooltip.day.isHoliday && !tooltip.day.isApprovedLeave && tooltip.day.status === "none" && (
                    <p className="text-slate-400">— Not marked yet</p>
                  )}
                  {!tooltip.day.isHoliday && tooltip.day.status !== "none" && (
                    <>
                      <p className="capitalize">
                        {tooltip.day.status === "present" && "✅ Present"}
                        {tooltip.day.status === "absent" && "❌ Absent"}
                        {tooltip.day.status === "half_day" && "⚠️ Half Day"}
                        {tooltip.day.status === "late" && "⚠️ Late"}
                        {tooltip.day.status === "leave" && "🔵 Leave"}
                      </p>
                      {tooltip.day.markedBy && (
                        <p className="text-slate-400 mt-1 text-[10px] truncate max-w-[200px]">
                          By: {tooltip.day.markedBy.split(" at ")[0]}
                        </p>
                      )}
                    </>
                  )}
                  {tooltip.day.isSunday && <p className="text-slate-300">☀️ Sunday</p>}
                </div>
              )}
            </div>

            {/* Legend Card */}
            <div className="bg-white rounded-2xl border border-emerald-50 shadow-sm p-4 print:border-slate-200">
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Legend</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { color: "bg-emerald-500", label: "Present" },
                  { color: "bg-red-400", label: "Absent" },
                  { color: "bg-amber-100 border border-amber-400", label: "Half Day / Late", dot: true },
                  { color: "bg-sky-100 ring-2 ring-sky-400", label: "Approved Leave" },
                  { color: "bg-slate-100", label: "Holiday / Sunday" },
                  { color: "bg-white border border-slate-200", label: "Not Marked Yet" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className={`w-4 h-4 rounded-full flex-shrink-0 ${item.color}`} />
                    {item.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Status Summary Grid */}
            <div className="bg-white rounded-2xl border border-emerald-50 shadow-sm overflow-hidden print:border-slate-200">
              <div className="px-4 py-3 border-b border-slate-50 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#10b981]" />
                <span className="text-sm font-bold text-slate-700">{MONTH_NAMES[selectedMonth - 1]} {selectedYear} — Summary</span>
              </div>
              <div className="grid grid-cols-5 divide-x divide-slate-100">
                {[
                  { icon: <CheckCircle className="w-4 h-4 text-emerald-500" />, label: "Present", val: monthlySummary.present, color: "text-emerald-600" },
                  { icon: <XCircle className="w-4 h-4 text-red-400" />, label: "Absent", val: monthlySummary.absent, color: "text-red-500" },
                  { icon: <AlertCircle className="w-4 h-4 text-amber-500" />, label: "Half Day", val: monthlySummary.halfDay, color: "text-amber-600" },
                  { icon: <Clock className="w-4 h-4 text-sky-400" />, label: "Leave", val: monthlySummary.leave, color: "text-sky-500" },
                  { icon: <Sun className="w-4 h-4 text-slate-400" />, label: "Holiday", val: monthlySummary.holiday, color: "text-slate-500" },
                ].map(({ icon, label, val, color }) => (
                  <div key={label} className="flex flex-col items-center justify-center py-3 gap-1" data-testid={`summary-${label.toLowerCase().replace(" ", "-")}`}>
                    {icon}
                    <span className={`text-lg sm:text-xl font-extrabold ${color}`}>{val}</span>
                    <span className="text-[9px] sm:text-[10px] text-slate-400 font-medium text-center leading-tight">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ══════════════════════════════════
            YEARLY / BAR CHART VIEW
            ══════════════════════════════════ */}
        {activeTab === "yearly" && (
          <>
            {/* Academic Year Dropdown */}
            <div className="flex items-center gap-3 print:hidden">
              <label className="text-sm font-semibold text-slate-600">Academic Year</label>
              <select
                value={academicYear}
                onChange={e => setAcademicYear(e.target.value)}
                className="border border-emerald-100 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 min-h-[44px]"
                data-testid="select-academic-year"
              >
                {getAcademicYearOptions().map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* Bar Chart */}
            <div className="bg-white rounded-2xl border border-emerald-50 shadow-sm overflow-hidden print:border-slate-200">
              <div className="px-4 py-3 border-b border-slate-50 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-[#10b981]" />
                <span className="text-sm font-bold text-slate-700">Monthly Attendance — {academicYear}</span>
              </div>

              {yearlyLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
                </div>
              ) : yearMonths.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Umbrella className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">No attendance data for this period</p>
                </div>
              ) : (
                <div className="p-4 sm:p-6">
                  {/* SVG Bar Chart */}
                  <div
                    className="overflow-x-auto"
                    data-testid="yearly-chart"
                  >
                    <svg
                      viewBox={`0 0 ${Math.max(yearMonths.length * 52, 400)} 180`}
                      className="w-full min-w-[400px]"
                      aria-label="Yearly attendance bar chart"
                    >
                      {/* Y-axis guide lines */}
                      {[0, 25, 50, 75, 100].map(pct => {
                        const y = 140 - (pct / 100) * 120;
                        return (
                          <g key={pct}>
                            <line x1="30" x2={yearMonths.length * 52 + 10} y1={y} y2={y}
                              stroke="#f1f5f9" strokeWidth="1" />
                            <text x="26" y={y + 4} textAnchor="end" fontSize="8" fill="#94a3b8">{pct}%</text>
                          </g>
                        );
                      })}

                      {yearMonths.map((m, i) => {
                        const x = 36 + i * 52;
                        const barW = 18;
                        const totalH = 120;
                        const wd = m.workingDays || 1;
                        const presentH = Math.round((m.present / wd) * totalH);
                        const absentH = Math.round((m.absent / wd) * totalH);
                        const monthLabel = MONTH_NAMES[m.month - 1].slice(0, 3);
                        const absentX = x + barW + 2;

                        return (
                          <g key={`${m.year}-${m.month}`}>
                            {/* Present bar */}
                            <rect
                              x={x}
                              y={140 - presentH}
                              width={barW}
                              height={Math.max(presentH, 2)}
                              rx="3"
                              fill="#10b981"
                              opacity="0.85"
                            />
                            {/* Absent bar */}
                            <rect
                              x={absentX}
                              y={140 - absentH}
                              width={barW}
                              height={Math.max(absentH, 2)}
                              rx="3"
                              fill="#f87171"
                              opacity="0.75"
                            />
                            {/* Month label */}
                            <text
                              x={x + barW + 1}
                              y={155}
                              textAnchor="middle"
                              fontSize="8"
                              fill="#64748b"
                              fontWeight="600"
                            >
                              {monthLabel}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Chart Legend */}
                  <div className="flex items-center gap-4 mt-2 justify-center">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="w-3 h-3 rounded-sm bg-emerald-500 opacity-85" />
                      Present
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="w-3 h-3 rounded-sm bg-red-400 opacity-75" />
                      Absent
                    </div>
                  </div>

                  {/* Monthly table below chart */}
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-xs text-center min-w-[500px]">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="py-2 text-left text-slate-500 font-semibold">Month</th>
                          <th className="py-2 text-emerald-600 font-semibold">Present</th>
                          <th className="py-2 text-red-400 font-semibold">Absent</th>
                          <th className="py-2 text-amber-500 font-semibold">Half Day</th>
                          <th className="py-2 text-sky-400 font-semibold">Leave</th>
                          <th className="py-2 text-slate-400 font-semibold">Working</th>
                          <th className="py-2 text-emerald-700 font-semibold">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {yearMonths.map(m => {
                          const wd = m.workingDays || 1;
                          const pct = wd > 0 ? Math.round(((m.present + m.halfDay * 0.5 + m.leave) / wd) * 100) : 0;
                          return (
                            <tr key={`${m.year}-${m.month}`} className="border-b border-slate-50 hover:bg-slate-50">
                              <td className="py-1.5 text-left text-slate-700 font-medium">
                                {MONTH_NAMES[m.month - 1].slice(0, 3)} {m.year}
                              </td>
                              <td className="py-1.5 text-emerald-600 font-semibold">{m.present}</td>
                              <td className="py-1.5 text-red-400 font-semibold">{m.absent}</td>
                              <td className="py-1.5 text-amber-500 font-semibold">{m.halfDay}</td>
                              <td className="py-1.5 text-sky-400 font-semibold">{m.leave}</td>
                              <td className="py-1.5 text-slate-400">{m.workingDays}</td>
                              <td className={`py-1.5 font-bold ${pct >= 75 ? "text-emerald-600" : "text-red-500"}`}>{pct}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Download Button ── */}
        <div className="flex justify-center pb-6 print:hidden">
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#10b981] text-white text-sm font-semibold hover:bg-emerald-600 active:bg-emerald-700 transition-colors shadow-md min-h-[44px]"
            data-testid="button-download"
          >
            <Download className="w-4 h-4" />
            Download Attendance Report
          </button>
        </div>
      </main>

      {/* Print styles */}
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .print\\:flex { display: flex !important; }
          .print\\:bg-white { background-color: white !important; }
          .print\\:border-slate-200 { border-color: #e2e8f0 !important; }
          .print\\:space-y-4 > * + * { margin-top: 1rem !important; }
          .print\\:py-2 { padding-top: 0.5rem !important; padding-bottom: 0.5rem !important; }
          .print\\:pb-3 { padding-bottom: 0.75rem !important; }
          .print\\:mb-2 { margin-bottom: 0.5rem !important; }
          .print\\:border-b { border-bottom-width: 1px !important; }
          .print\\:items-center { align-items: center !important; }
          .print\\:justify-between { justify-content: space-between !important; }
        }
      `}</style>
    </div>
  );
}
