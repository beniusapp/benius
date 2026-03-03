import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Search, Save, AlertCircle, ArrowLeft,
  ClipboardCheck, User, Edit3, History, Calendar, Clock
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

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

const CLASS_OPTIONS = ["L.K.G", "U.K.G", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const SECTION_OPTIONS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const STATUS_CONFIG = [
  { value: "present", label: "P", bg: "bg-emerald-500", ring: "ring-emerald-400", text: "text-emerald-700", lightBg: "bg-emerald-50" },
  { value: "absent", label: "A", bg: "bg-red-500", ring: "ring-red-400", text: "text-red-700", lightBg: "bg-red-50" },
  { value: "late", label: "L", bg: "bg-amber-500", ring: "ring-amber-400", text: "text-amber-700", lightBg: "bg-amber-50" },
  { value: "halfday", label: "H", bg: "bg-blue-500", ring: "ring-blue-400", text: "text-blue-700", lightBg: "bg-blue-50" },
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
  if (remaining === 3) return { label: "3/3", cls: "bg-emerald-100 text-emerald-700 border-emerald-300 shadow-emerald-200/50 shadow-sm" };
  if (remaining === 2) return { label: "2/3", cls: "bg-orange-100 text-orange-700 border-orange-300 shadow-orange-200/50 shadow-sm" };
  if (remaining === 1) return { label: "1/3", cls: "bg-red-100 text-red-700 border-red-300 shadow-red-200/50 shadow-sm" };
  return { label: "0/3", cls: "bg-gray-200 text-gray-500 border-gray-300" };
}

function statusBadgeColor(status: string) {
  switch (status) {
    case "present": return "bg-emerald-100 text-emerald-700";
    case "absent": return "bg-red-100 text-red-700";
    case "late": return "bg-amber-100 text-amber-700";
    case "halfday": return "bg-blue-100 text-blue-700";
    default: return "bg-gray-100 text-gray-700";
  }
}

function SkeletonCards() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="rounded-xl border bg-card p-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-muted rounded w-32" />
              <div className="h-3 bg-muted rounded w-20" />
            </div>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map(j => (
                <div key={j} className="w-10 h-10 rounded-full bg-muted" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AttendanceModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const today = new Date().toISOString().split("T")[0];

  const [view, setView] = useState<ViewState>("landing");
  const [selectedClass, setSelectedClass] = useState(teacher.assignedClass || "10");
  const [selectedSection, setSelectedSection] = useState(teacher.assignedSection || "A");
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

  if (view === "landing") {
    return (
      <div className="space-y-6" data-testid="view-landing">
        <h2 className="text-xl font-bold tracking-tight" data-testid="text-attendance-title">Attendance</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => navigateTo("my-attendance")}
            className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30 p-6 text-left transition-all hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98]"
            data-testid="card-my-attendance"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-violet-100 dark:bg-violet-900/50 p-3">
                <User className="w-6 h-6 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h3 className="font-semibold text-base">My Attendance</h3>
                <p className="text-sm text-muted-foreground mt-1">View your personal attendance log</p>
              </div>
            </div>
          </button>
          <button
            onClick={() => navigateTo("class-menu")}
            className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 p-6 text-left transition-all hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98]"
            data-testid="card-class-attendance"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-emerald-100 dark:bg-emerald-900/50 p-3">
                <ClipboardCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="font-semibold text-base">Class Attendance</h3>
                <p className="text-sm text-muted-foreground mt-1">Mark or view student attendance</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (view === "my-attendance") {
    return (
      <div className="space-y-4" data-testid="view-my-attendance">
        <Button variant="ghost" size="sm" onClick={() => navigateTo("landing")} data-testid="button-back">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Card className="rounded-2xl">
          <CardContent className="py-12 text-center">
            <User className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
            <h3 className="font-semibold text-lg">My Attendance</h3>
            <p className="text-sm text-muted-foreground mt-2">Coming Soon — Personal attendance log will be available here.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view === "class-menu") {
    return (
      <div className="space-y-6" data-testid="view-class-menu">
        <Button variant="ghost" size="sm" onClick={() => navigateTo("landing")} data-testid="button-back">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h2 className="text-xl font-bold tracking-tight">Class Attendance</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => navigateTo("mark")}
            className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-950/30 dark:to-blue-950/30 p-6 text-left transition-all hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98]"
            data-testid="card-mark-today"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-sky-100 dark:bg-sky-900/50 p-3">
                <Edit3 className="w-6 h-6 text-sky-600 dark:text-sky-400" />
              </div>
              <div>
                <h3 className="font-semibold text-base">Mark Attendance</h3>
                <p className="text-sm text-muted-foreground mt-1">Mark today's or recent attendance</p>
              </div>
            </div>
          </button>
          <button
            onClick={() => navigateTo("history")}
            className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 p-6 text-left transition-all hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98]"
            data-testid="card-history"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-amber-100 dark:bg-amber-900/50 p-3">
                <History className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-base">Attendance History</h3>
                <p className="text-sm text-muted-foreground mt-1">View past attendance records</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (view === "history") {
    return (
      <div className="space-y-4" data-testid="view-history">
        <Button variant="ghost" size="sm" onClick={() => navigateTo("class-menu")} data-testid="button-back">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h2 className="text-xl font-bold tracking-tight">Attendance History</h2>

        <div className="backdrop-blur-md bg-white/70 dark:bg-gray-900/70 border border-white/20 rounded-2xl shadow-lg p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Class</label>
              <Select value={selectedClass} onValueChange={setSelectedClass}>
                <SelectTrigger className="rounded-xl" data-testid="select-class-history">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLASS_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Section</label>
              <Select value={selectedSection} onValueChange={setSelectedSection}>
                <SelectTrigger className="rounded-xl" data-testid="select-section-history">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECTION_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={historyStartDate} onChange={e => setHistoryStartDate(e.target.value)}
                className="rounded-xl" data-testid="input-start-date" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={historyEndDate} max={today} onChange={e => setHistoryEndDate(e.target.value)}
                className="rounded-xl" data-testid="input-end-date" />
            </div>
          </div>
        </div>

        {historyLoading ? <SkeletonCards /> : groupedHistory.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm" data-testid="text-no-history">
            <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
            No attendance records found for this period.
          </div>
        ) : (
          <div className="space-y-6">
            {groupedHistory.map(([date, records]) => (
              <div key={date}>
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm">{new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</h3>
                  <Badge variant="secondary" className="text-xs">{records.length} records</Badge>
                </div>
                <div className="space-y-2">
                  {records.map(r => (
                    <div key={`${r.studentId}-${r.date}`}
                      className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm"
                      data-testid={`history-card-${r.studentId}-${r.date}`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${getAvatarColor(r.studentName)}`}>
                        {getInitials(r.studentName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{r.studentName}</p>
                        <p className="text-xs text-muted-foreground font-mono">{r.dsid}</p>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusBadgeColor(r.status)}`}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                      <div className="hidden sm:block text-xs text-muted-foreground text-right max-w-[180px]">
                        <p className="truncate">{r.markedBy}</p>
                        <p>Edits: {r.editCount}/3</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const allAtLimit = students.length > 0 && students.every(s => s.editCount >= 3);
  const canSave = isEditable && !allAtLimit && students.length > 0;

  return (
    <div className="space-y-4 pb-24" data-testid="view-mark">
      <Button variant="ghost" size="sm" onClick={() => navigateTo("class-menu")} data-testid="button-back">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </Button>
      <h2 className="text-xl font-bold tracking-tight" data-testid="text-mark-title">Mark Attendance</h2>

      <div className="backdrop-blur-md bg-white/70 dark:bg-gray-900/70 border border-white/20 rounded-2xl shadow-lg p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Class</label>
            <Select value={selectedClass} onValueChange={(v) => { setSelectedClass(v); setLocalStatuses({}); }}>
              <SelectTrigger className="rounded-xl" data-testid="select-class">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLASS_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Section</label>
            <Select value={selectedSection} onValueChange={(v) => { setSelectedSection(v); setLocalStatuses({}); }}>
              <SelectTrigger className="rounded-xl" data-testid="select-section">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECTION_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 col-span-2 sm:col-span-1">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <Input
              type="date" value={selectedDate} max={today}
              onChange={(e) => { setSelectedDate(e.target.value); setLocalStatuses({}); }}
              className="rounded-xl"
              data-testid="input-date"
            />
          </div>
          <div className="space-y-1 col-span-2 sm:col-span-1">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Name or DSID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 rounded-xl"
                data-testid="input-search"
              />
            </div>
          </div>
        </div>

        {!isEditable && selectedDate < sevenDaysAgo && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm mt-2" data-testid="text-date-warning">
            <AlertCircle className="w-4 h-4 shrink-0" />
            This date is outside the 7-day edit window.
          </div>
        )}
        {selectedDate > today && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm mt-2" data-testid="text-future-warning">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Cannot mark attendance for future dates.
          </div>
        )}
        {isError && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm mt-2" data-testid="text-attendance-error">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Failed to load attendance data.
          </div>
        )}
      </div>

      {isLoading ? <SkeletonCards /> : filteredStudents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm" data-testid="text-no-students">
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
                className={`relative rounded-xl border bg-card p-3 sm:p-4 transition-shadow hover:shadow-md ${locked ? "opacity-50" : ""}`}
                data-testid={`card-student-${student.studentId}`}
              >
                {locked && (
                  <div className="absolute inset-0 rounded-xl bg-background/60 flex items-center justify-center z-10">
                    <span className="text-xs font-semibold text-destructive bg-destructive/10 px-3 py-1 rounded-full" data-testid={`text-locked-${student.studentId}`}>
                      Edit limit reached
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${getAvatarColor(student.name)}`}>
                    {getInitials(student.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" data-testid={`text-student-name-${student.studentId}`}>{student.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{student.dsid}</p>
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
                            w-10 h-10 rounded-full text-xs font-bold transition-all duration-300 flex items-center justify-center
                            ${isActive
                              ? `${opt.bg} text-white ring-2 ring-offset-2 ${opt.ring} scale-105`
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
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
                      <span className="text-[10px] text-muted-foreground truncate max-w-[200px]" data-testid={`text-audit-${student.studentId}`}>
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
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || saveMutation.isPending}
              className="w-full h-14 rounded-2xl text-base font-semibold shadow-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-transform"
              data-testid="button-save-attendance"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <Save className="w-5 h-5 mr-2" />
              )}
              Save Attendance
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
