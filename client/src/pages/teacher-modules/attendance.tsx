import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { fmtDateWithWeekday } from "@/lib/dateUtils";
import {
  Loader2, Search, Save, AlertCircle, ArrowLeft,
  ClipboardCheck, User, Edit3, History, Calendar, Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSchoolConfigStrict } from "@/hooks/use-school-config";
import type { TeacherMe } from "@/pages/teacher-dashboard";
import MyAttendanceModule from "./my-attendance";

interface StudentAttendance {
  studentId: number;
  name: string;
  dsid: string;
  status: string;
  editCount: number;
  markedBy: string | null;
  markedAt: string | null;
  hasRecord: boolean;
}

interface HistoryRecord {
  id: number;
  studentId: number;
  studentName: string;
  dsid: string;
  date: string;
  status: string;
  markedBy: string;
  markedAt: string;
  editCount: number;
}

type ViewState = "landing" | "class-menu" | "mark" | "history" | "my-attendance";

const STATUS_CONFIG = [
  { value: "present",  label: "P", bg: "bg-emerald-500", ring: "ring-emerald-400" },
  { value: "absent",   label: "A", bg: "bg-red-500",     ring: "ring-red-400"     },
  { value: "late",     label: "L", bg: "bg-amber-500",   ring: "ring-amber-400"   },
  { value: "halfday",  label: "H", bg: "bg-blue-500",    ring: "ring-blue-400"    },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || "?").toUpperCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const colors = [
    "bg-violet-500", "bg-indigo-500", "bg-sky-500", "bg-teal-500",
    "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-pink-500",
    "bg-cyan-500", "bg-fuchsia-500",
  ];
  return colors[Math.abs(hash) % colors.length];
}

function getAttemptsBadge(editCount: number) {
  const remaining = Math.max(0, 3 - editCount);
  if (remaining === 3) return { label: "3/3", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" };
  if (remaining === 2) return { label: "2/3", cls: "bg-orange-500/20 text-orange-300 border-orange-500/30" };
  if (remaining === 1) return { label: "1/3", cls: "bg-red-500/20 text-red-300 border-red-500/30" };
  return { label: "0/3", cls: "bg-white/10 text-white/40 border-white/20" };
}

function statusBadgeColor(status: string) {
  switch (status) {
    case "present":  return "bg-emerald-500/20 text-emerald-300";
    case "absent":   return "bg-red-500/20 text-red-300";
    case "late":     return "bg-amber-500/20 text-amber-300";
    case "halfday":  return "bg-blue-500/20 text-blue-300";
    default:         return "bg-white/10 text-white/50";
  }
}

function SkeletonCards() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-white/10 rounded w-32" />
              <div className="h-3 bg-white/10 rounded w-20" />
            </div>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map(j => (
                <div key={j} className="w-10 h-10 rounded-full bg-white/10" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* Shared dark-styled select */
function DarkSelect({
  value, onValueChange, disabled, options, placeholder, testId,
}: {
  value: string;
  onValueChange: (v: string) => void;
  disabled?: boolean;
  options: string[];
  placeholder?: string;
  testId?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onValueChange(e.target.value)}
      disabled={disabled}
      data-testid={testId}
      className="w-full rounded-xl bg-white/5 border border-white/15 text-white text-sm px-3 py-2 focus:outline-none focus:border-white/30 disabled:opacity-50 disabled:cursor-not-allowed appearance-none cursor-pointer"
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" }}
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map(o => (
        <option key={o} value={o} style={{ background: "#1A2942", color: "#fff" }}>{o}</option>
      ))}
    </select>
  );
}

/* Shared dark-styled date / text input */
function DarkInput({
  type = "text", value, onChange, placeholder, max, className = "", testId,
}: {
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  max?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      max={max}
      data-testid={testId}
      className={`w-full rounded-xl bg-white/5 border border-white/15 text-white text-sm px-3 py-2 focus:outline-none focus:border-white/30 placeholder:text-white/30 ${className}`}
      style={type === "date" ? { colorScheme: "dark" } : undefined}
    />
  );
}

export default function AttendanceModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const {
    classes,
    isLoading: configLoading,
    hasClasses,
    hasSections,
    getSectionsForClass,
  } = useSchoolConfigStrict(teacher.schoolId);
  const today = new Date().toISOString().split("T")[0];

  const [view, setView] = useState<ViewState>("landing");
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");

  const sectionOpts = useMemo(
    () => getSectionsForClass(selectedClass),
    [selectedClass, getSectionsForClass]
  );

  const handleClassChange = useCallback((cls: string, setter: (v: string) => void) => {
    setter(cls);
    setSelectedSection("");
  }, []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [searchQuery, setSearchQuery] = useState("");
  const [localStatuses, setLocalStatuses] = useState<Record<number, string>>({});

  const [historyStartDate, setHistoryStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [historyEndDate, setHistoryEndDate] = useState(today);

  const sevenDaysAgo = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  }, []);

  const isEditable = selectedDate >= sevenDaysAgo && selectedDate <= today;

  const { data: students = [], isLoading, isError } = useQuery<StudentAttendance[]>({
    queryKey: ["/api/attendance", teacher.schoolId, selectedClass, selectedSection, selectedDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/attendance/${teacher.schoolId}/${encodeURIComponent(selectedClass)}/${selectedSection}/${selectedDate}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load attendance");
      return res.json();
    },
    enabled: view === "mark",
  });

  const { data: historyRecords = [], isLoading: historyLoading } = useQuery<HistoryRecord[]>({
    queryKey: ["/api/attendance/history", teacher.schoolId, selectedClass, selectedSection, historyStartDate, historyEndDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/attendance/history/${teacher.schoolId}/${encodeURIComponent(selectedClass)}/${selectedSection}/${historyStartDate}/${historyEndDate}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
    enabled: view === "history",
  });

  const filteredStudents = useMemo(() => {
    if (!searchQuery) return students;
    const q = searchQuery.toLowerCase();
    return students.filter(s => s.name.toLowerCase().includes(q) || s.dsid.toLowerCase().includes(q));
  }, [students, searchQuery]);

  // Holiday lockdown — fetch calendar events for the selected month so we can
  // detect holidays before the teacher even tries to submit.
  const selectedDateObj = useMemo(() => new Date(selectedDate + "T00:00:00"), [selectedDate]);
  const calMonth = selectedDateObj.getMonth() + 1;
  const calYear = selectedDateObj.getFullYear();

  const { data: calendarEventsForMonth = [] } = useQuery<{ id: number; date: string; eventType: string; title: string }[]>({
    queryKey: ["/api/teacher/calendar", calYear, calMonth],
    queryFn: async () => {
      const res = await fetch(
        `/api/teacher/calendar?month=${calMonth}&year=${calYear}`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: view === "mark",
    staleTime: 5 * 60 * 1000,
  });

  const holidayOnDate = useMemo(
    () => calendarEventsForMonth.find(e => e.date === selectedDate && e.eventType === "holiday"),
    [calendarEventsForMonth, selectedDate]
  );
  const isHolidayDate = !!holidayOnDate;

  const groupedHistory = useMemo(() => {
    const groups: Record<string, HistoryRecord[]> = {};
    historyRecords.forEach(r => {
      if (!groups[r.date]) groups[r.date] = [];
      groups[r.date].push(r);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [historyRecords]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const records = students.map(s => ({
        studentId: s.studentId,
        status: localStatuses[s.studentId] || s.status,
      }));
      const res = await apiRequest("POST", "/api/attendance", {
        date: selectedDate,
        records,
        class: selectedClass,
        section: selectedSection,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Attendance Saved!", description: data.message });
      setLocalStatuses({});
      queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher-me"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  function getStatus(studentId: number, defaultStatus: string) {
    return localStatuses[studentId] || defaultStatus;
  }

  function setStatus(studentId: number, status: string) {
    setLocalStatuses(prev => ({ ...prev, [studentId]: status }));
  }

  function navigateTo(v: ViewState) {
    setView(v);
    if (v === "mark" || v === "history") {
      setSearchQuery("");
      setLocalStatuses({});
    }
  }

  /* ── LANDING ── */
  if (view === "landing") {
    return (
      <div className="space-y-6" data-testid="view-landing">
        <h2 className="text-xl font-bold text-white" data-testid="text-attendance-title">Attendance</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => navigateTo("my-attendance")}
            className="group relative overflow-hidden rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-500/15 to-indigo-500/15 p-6 text-left transition-all hover:shadow-lg hover:border-violet-500/40 hover:-translate-y-0.5 active:scale-[0.98]"
            data-testid="card-my-attendance"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-violet-500/20 p-3">
                <User className="w-6 h-6 text-violet-300" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-white">My Attendance</h3>
                <p className="text-sm text-white/60 mt-1">View your personal attendance log</p>
              </div>
            </div>
          </button>
          <button
            onClick={() => navigateTo("class-menu")}
            className="group relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/15 to-teal-500/15 p-6 text-left transition-all hover:shadow-lg hover:border-emerald-500/40 hover:-translate-y-0.5 active:scale-[0.98]"
            data-testid="card-class-attendance"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-emerald-500/20 p-3">
                <ClipboardCheck className="w-6 h-6 text-emerald-300" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-white">Class Attendance</h3>
                <p className="text-sm text-white/60 mt-1">Mark or view student attendance</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  /* ── MY ATTENDANCE ── */
  if (view === "my-attendance") {
    return <MyAttendanceModule teacher={teacher} onBack={() => navigateTo("landing")} />;
  }

  /* ── CLASS MENU ── */
  if (view === "class-menu") {
    const classNotReady = !configLoading && (!hasClasses || !hasSections);
    const selectionReady = selectedClass !== "" && selectedSection !== "";
    return (
      <div className="space-y-6" data-testid="view-class-menu">
        <button
          onClick={() => navigateTo("landing")}
          className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h2 className="text-xl font-bold text-white">Class Attendance</h2>

        {configLoading ? (
          <div className="h-24 rounded-2xl bg-white/5 animate-pulse" />
        ) : classNotReady ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center" data-testid="banner-not-configured">
            <p className="text-sm font-medium text-amber-300">School setup incomplete</p>
            <p className="text-xs text-amber-400/70 mt-1">Ask your admin to configure classes and sections in School Setup before marking attendance.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl border border-white/10 bg-white/5" data-testid="selector-class-section">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/60">Class *</label>
                <DarkSelect
                  value={selectedClass}
                  onValueChange={(v) => handleClassChange(v, setSelectedClass)}
                  options={classes}
                  placeholder="Select class"
                  testId="select-class-menu"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/60">Section *</label>
                <DarkSelect
                  value={selectedSection}
                  onValueChange={setSelectedSection}
                  disabled={!selectedClass}
                  options={sectionOpts}
                  placeholder="Select section"
                  testId="select-section-menu"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => selectionReady && navigateTo("mark")}
                disabled={!selectionReady}
                className={`group relative overflow-hidden rounded-2xl border p-6 text-left transition-all ${
                  selectionReady
                    ? "border-sky-500/25 bg-gradient-to-br from-sky-500/15 to-blue-500/15 hover:shadow-lg hover:border-sky-500/40 hover:-translate-y-0.5 active:scale-[0.98]"
                    : "border-white/10 bg-white/5 opacity-50 cursor-not-allowed"
                }`}
                data-testid="card-mark-today"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-xl bg-sky-500/20 p-3">
                    <Edit3 className="w-6 h-6 text-sky-300" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-white">Mark Attendance</h3>
                    <p className="text-sm text-white/60 mt-1">{selectionReady ? `Class ${selectedClass}-${selectedSection}` : "Select class & section first"}</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => selectionReady && navigateTo("history")}
                disabled={!selectionReady}
                className={`group relative overflow-hidden rounded-2xl border p-6 text-left transition-all ${
                  selectionReady
                    ? "border-amber-500/25 bg-gradient-to-br from-amber-500/15 to-orange-500/15 hover:shadow-lg hover:border-amber-500/40 hover:-translate-y-0.5 active:scale-[0.98]"
                    : "border-white/10 bg-white/5 opacity-50 cursor-not-allowed"
                }`}
                data-testid="card-history"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-xl bg-amber-500/20 p-3">
                    <History className="w-6 h-6 text-amber-300" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-white">Attendance History</h3>
                    <p className="text-sm text-white/60 mt-1">{selectionReady ? `Class ${selectedClass}-${selectedSection}` : "Select class & section first"}</p>
                  </div>
                </div>
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  /* ── HISTORY ── */
  if (view === "history") {
    return (
      <div className="space-y-4" data-testid="view-history">
        <button
          onClick={() => navigateTo("class-menu")}
          className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h2 className="text-xl font-bold text-white">Attendance History</h2>

        <div className="border border-white/10 bg-white/5 rounded-2xl p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/60">Class</label>
              <DarkSelect
                value={selectedClass}
                onValueChange={(v) => handleClassChange(v, setSelectedClass)}
                options={classes}
                testId="select-class-history"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/60">Section</label>
              <DarkSelect
                value={selectedSection}
                onValueChange={setSelectedSection}
                options={sectionOpts}
                testId="select-section-history"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/60">From</label>
              <DarkInput
                type="date"
                value={historyStartDate}
                onChange={e => setHistoryStartDate(e.target.value)}
                testId="input-start-date"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/60">To</label>
              <DarkInput
                type="date"
                value={historyEndDate}
                max={today}
                onChange={e => setHistoryEndDate(e.target.value)}
                testId="input-end-date"
              />
            </div>
          </div>
        </div>

        {historyLoading ? <SkeletonCards /> : groupedHistory.length === 0 ? (
          <div className="text-center py-12 text-white/40 text-sm" data-testid="text-no-history">
            <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
            No attendance records found for this period.
          </div>
        ) : (
          <div className="space-y-6">
            {groupedHistory.map(([date, records]) => {
              const counts = records.reduce<Record<string, number>>(
                (acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; },
                {}
              );
              const summaryPills = [
                { key: "present",  label: "Present",  cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
                { key: "absent",   label: "Absent",   cls: "bg-red-500/20 text-red-300 border-red-500/30"             },
                { key: "late",     label: "Late",     cls: "bg-amber-500/20 text-amber-300 border-amber-500/30"       },
                { key: "halfday",  label: "Half Day", cls: "bg-blue-500/20 text-blue-300 border-blue-500/30"          },
              ].filter(p => counts[p.key] > 0);
              return (
              <div key={date}>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Calendar className="w-4 h-4 text-white/40 shrink-0" />
                  <h3 className="font-semibold text-sm text-white">{fmtDateWithWeekday(date)}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/10">
                    {records.length} total
                  </span>
                  {summaryPills.map(p => (
                    <span
                      key={p.key}
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${p.cls}`}
                      data-testid={`count-${p.key}-${date}`}
                    >
                      {counts[p.key]} {p.label}
                    </span>
                  ))}
                </div>
                <div className="space-y-2">
                  {records.map(r => (
                    <div
                      key={`${r.studentId}-${r.date}`}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm"
                      data-testid={`history-card-${r.studentId}-${r.date}`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${getAvatarColor(r.studentName)}`}>
                        {getInitials(r.studentName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-white">{r.studentName}</p>
                        <p className="text-xs text-white/50 font-mono">{r.dsid}</p>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusBadgeColor(r.status)}`}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                      <div className="hidden sm:block text-xs text-white/40 text-right max-w-[180px]">
                        <p className="truncate">{r.markedBy}</p>
                        <p>Edits: {r.editCount}/3</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ── MARK ATTENDANCE ── */
  const allAtLimit = students.length > 0 && students.every(s => s.editCount >= 3);
  const canSave = isEditable && !allAtLimit && students.length > 0 && !isHolidayDate;

  return (
    <div className="space-y-4 pb-24" data-testid="view-mark">
      <button
        onClick={() => navigateTo("class-menu")}
        className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors"
        data-testid="button-back"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h2 className="text-xl font-bold text-white" data-testid="text-mark-title">Mark Attendance</h2>

      <div className="border border-white/10 bg-white/5 rounded-2xl p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/60">Class</label>
            <DarkSelect
              value={selectedClass}
              onValueChange={(v) => { handleClassChange(v, setSelectedClass); setLocalStatuses({}); }}
              options={classes}
              testId="select-class"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/60">Section</label>
            <DarkSelect
              value={selectedSection}
              onValueChange={(v) => { setSelectedSection(v); setLocalStatuses({}); }}
              options={sectionOpts}
              testId="select-section"
            />
          </div>
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <label className="text-xs font-medium text-white/60">Date</label>
            <DarkInput
              type="date"
              value={selectedDate}
              max={today}
              onChange={(e) => { setSelectedDate(e.target.value); setLocalStatuses({}); }}
              testId="input-date"
            />
          </div>
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <label className="text-xs font-medium text-white/60">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <DarkInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Name or DSID…"
                className="pl-9"
                testId="input-search"
              />
            </div>
          </div>
        </div>

        {isHolidayDate && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-red-500/15 border border-red-500/35 text-red-300 text-sm mt-2" data-testid="text-holiday-lockdown">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>
              <strong className="font-semibold text-red-200">{holidayOnDate?.title}</strong>
              <span className="text-red-300/80"> — Attendance is locked on school-wide holidays.</span>
            </span>
          </div>
        )}
        {!isHolidayDate && !isEditable && selectedDate < sevenDaysAgo && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm mt-2" data-testid="text-date-warning">
            <AlertCircle className="w-4 h-4 shrink-0" />
            This date is outside the 7-day edit window.
          </div>
        )}
        {selectedDate > today && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm mt-2" data-testid="text-future-warning">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Cannot mark attendance for future dates.
          </div>
        )}
        {isError && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm mt-2" data-testid="text-attendance-error">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Failed to load attendance data.
          </div>
        )}
      </div>

      {isLoading ? <SkeletonCards /> : filteredStudents.length === 0 ? (
        <div className="text-center py-12 text-white/40 text-sm" data-testid="text-no-students">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-2 opacity-30" />
          No students found for {selectedClass}-{selectedSection}.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredStudents.map((student) => {
            const currentStatus = getStatus(student.studentId, student.status);
            const locked = student.editCount >= 3;
            const isAbsent = currentStatus === "absent";
            const badge = getAttemptsBadge(student.editCount);

            return (
              <div
                key={student.studentId}
                className={`relative rounded-xl border border-white/10 bg-white/5 p-3 sm:p-4 transition-shadow hover:border-white/20 ${locked ? "opacity-50" : ""}`}
                data-testid={`card-student-${student.studentId}`}
              >
                {locked && (
                  <div className="absolute inset-0 rounded-xl bg-black/40 flex items-center justify-center z-10">
                    <span className="text-xs font-semibold text-red-300 bg-red-500/20 border border-red-500/30 px-3 py-1 rounded-full" data-testid={`text-locked-${student.studentId}`}>
                      Edit limit reached
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${getAvatarColor(student.name)}`}>
                    {getInitials(student.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate text-white" data-testid={`text-student-name-${student.studentId}`}>{student.name}</p>
                    <p className="text-xs text-white/50 font-mono">{student.dsid}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {STATUS_CONFIG.map((opt) => {
                      const isActive = currentStatus === opt.value;
                      const isDisabledByAbsent = isAbsent && (opt.value === "late" || opt.value === "halfday");
                      return (
                        <button
                          key={opt.value}
                          disabled={locked || !isEditable || isDisabledByAbsent}
                          onClick={() => setStatus(student.studentId, opt.value)}
                          className={`
                            w-10 h-10 rounded-full text-xs font-bold transition-all duration-200 flex items-center justify-center
                            ${isActive
                              ? `${opt.bg} text-white ring-2 ring-offset-2 ring-offset-transparent ${opt.ring} scale-105`
                              : "bg-white/10 text-white/60 hover:bg-white/20"
                            }
                            ${isDisabledByAbsent ? "opacity-20 grayscale pointer-events-none" : ""}
                            ${locked || !isEditable ? "cursor-not-allowed" : "cursor-pointer active:scale-90"}
                          `}
                          data-testid={`button-status-${opt.value}-${student.studentId}`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 pl-[52px]">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center text-[10px] font-semibold border px-2 py-0.5 rounded-full ${badge.cls}`}
                      data-testid={`badge-attempts-${student.studentId}`}
                    >
                      {badge.label}
                    </span>
                    {student.markedBy && (
                      <span className="text-[10px] text-white/40 truncate max-w-[200px]" data-testid={`text-audit-${student.studentId}`}>
                        <Clock className="w-3 h-3 inline mr-0.5 -mt-px" />
                        {student.markedBy}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "mark" && students.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 z-50 pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || saveMutation.isPending}
              className="w-full h-14 rounded-2xl text-base font-semibold shadow-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-all text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              data-testid="button-save-attendance"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Save className="w-5 h-5" />
              )}
              Save Attendance
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
