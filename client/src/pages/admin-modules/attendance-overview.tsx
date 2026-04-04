import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, UserX, Loader2, Calendar, Filter, CheckCircle, Search, Eye,
  Clock, BookOpen, ChevronRight, AlertTriangle, TrendingUp, X,
  Phone, MapPin, User, type LucideIcon,
} from "lucide-react";

interface Props {
  schoolId: number;
  onViewStudent?: (studentId: number) => void;
}

interface StudentSummary {
  id: number;
  name: string;
  class: string;
  section: string;
  digitalStudentId: string;
  phone: string;
  rollNo: string;
  fatherName: string;
  presentAddress: string;
  isActive: boolean;
}

interface SchoolConfig {
  classes: string[];
  sections: string[];
  subjects: string[];
}

interface DailySummary {
  total: number;
  present: number;
  absent: number;
  leave: number;
  percentage: number;
}

interface StudentAttendance {
  studentId: number;
  name: string;
  rollNo: string;
  digitalStudentId: string;
  status: "present" | "absent" | "leave" | "late" | "not-marked";
}

interface TeacherAttendanceRow {
  teacherId: number;
  name: string;
  assignedClass: string;
  assignedSection: string;
  subject: string;
  department: string;
  status: "marked" | "not-marked";
  isLate: boolean;
  submittedAt: string | null;
}

interface TeacherSummaryResponse {
  summary: { totalFaculty: number; marked: number; notMarked: number };
  teachers: TeacherAttendanceRow[];
}

type Tab = "students" | "teachers";

function StatusBadge({ status }: { status: string }) {
  if (status === "present") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
        <CheckCircle className="w-3 h-3" /> Present
      </span>
    );
  }
  if (status === "absent") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
        <UserX className="w-3 h-3" /> Absent
      </span>
    );
  }
  if (status === "leave") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
        <Calendar className="w-3 h-3" /> Leave
      </span>
    );
  }
  if (status === "late") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30">
        <Clock className="w-3 h-3" /> Late
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-white/10 text-white/50 border border-white/10">
      Not Marked
    </span>
  );
}

function StatCard({ label, value, color, bg, icon: Icon }: { label: string; value: number | string; color: string; bg: string; icon: LucideIcon }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#1A2942] p-4 min-w-0">
      <div className={`inline-flex p-2 rounded-lg ${bg} mb-2`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <p className={`text-2xl font-bold ${color}`} data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</p>
      <p className="text-white/50 text-xs mt-1 truncate">{label}</p>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {[1, 2, 3, 4].map(i => (
        <td key={i} className="px-3 py-3 border-b border-white/5">
          <div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: `${60 + i * 10}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function AttendanceOverview({ schoolId, onViewStudent }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [activeTab, setActiveTab] = useState<Tab>("students");
  const [filterClass, setFilterClass] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [teacherSearch, setTeacherSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);

  // ── School config (admin-scoped endpoint, no fallbacks) ──
  const { data: schoolConfig, isLoading: configLoading } = useQuery<SchoolConfig>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [] };
    },
    enabled: !!schoolId,
  });

  const hasClasses = (schoolConfig?.classes ?? []).length > 0;
  const hasSections = (schoolConfig?.sections ?? []).length > 0;

  // ── Master (school-wide) daily summary ──
  const { data: summary, isLoading: summaryLoading } = useQuery<DailySummary>({
    queryKey: ["/api/attendance/daily-summary", schoolId, date],
    queryFn: async () => {
      const r = await fetch(`/api/attendance/daily-summary/${schoolId}/${date}`, { credentials: "include" });
      return r.ok ? r.json() : { total: 0, present: 0, absent: 0, leave: 0, percentage: 0 };
    },
    enabled: !!schoolId,
  });

  // ── Student class-detail ──
  const { data: studentData = [], isLoading: studentLoading } = useQuery<StudentAttendance[]>({
    queryKey: ["/api/admin/attendance/class-detail", filterClass, filterSection, date],
    queryFn: async () => {
      const r = await fetch(
        `/api/admin/attendance/class-detail?class=${encodeURIComponent(filterClass)}&section=${encodeURIComponent(filterSection)}&date=${date}`,
        { credentials: "include" }
      );
      return r.ok ? r.json() : [];
    },
    enabled: !!filterClass && !!filterSection,
  });

  // ── Teacher summary ──
  const { data: teacherSummaryData, isLoading: teacherLoading } = useQuery<TeacherSummaryResponse>({
    queryKey: ["/api/admin/attendance/teacher-summary", date],
    queryFn: async () => {
      const r = await fetch(`/api/admin/attendance/teacher-summary?date=${date}`, { credentials: "include" });
      return r.ok ? r.json() : { summary: { totalFaculty: 0, marked: 0, notMarked: 0 }, teachers: [] };
    },
    enabled: !!schoolId,
  });

  // ── Class-level stats ──
  const classStats = useMemo(() => {
    const total = studentData.length;
    const present = studentData.filter(s => s.status === "present").length;
    const absent = studentData.filter(s => s.status === "absent").length;
    const leave = studentData.filter(s => s.status === "leave").length;
    const notMarked = studentData.filter(s => s.status === "not-marked").length;
    const pct = (total - notMarked) > 0 ? Math.round((present / (total - notMarked)) * 100) : 0;
    return { total, present, absent, leave, notMarked, pct };
  }, [studentData]);

  // ── Filtered student rows ──
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return studentData;
    return studentData.filter(s =>
      s.name.toLowerCase().includes(q) || s.rollNo.toLowerCase().includes(q) || s.digitalStudentId.toLowerCase().includes(q)
    );
  }, [studentData, studentSearch]);

  // ── Filtered teacher rows ──
  const filteredTeachers = useMemo(() => {
    const q = teacherSearch.trim().toLowerCase();
    const rows = teacherSummaryData?.teachers ?? [];
    if (!q) return rows;
    return rows.filter(t => t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || t.department.toLowerCase().includes(q));
  }, [teacherSummaryData, teacherSearch]);

  // ── Student detail (for Quick Action panel) ──
  const { data: selectedStudentDetail, isLoading: studentDetailLoading } = useQuery<StudentSummary>({
    queryKey: ["/api/admin/students", selectedStudentId, "summary"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/students/${selectedStudentId}/summary`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch student");
      return r.json();
    },
    enabled: selectedStudentId !== null,
  });

  const displayDate = new Date(date).toLocaleDateString("en-GB");
  const ts = teacherSummaryData?.summary;

  // ── Student status in current view for detail panel ──
  const selectedStudentStatus = useMemo(
    () => studentData.find(s => s.studentId === selectedStudentId)?.status ?? null,
    [studentData, selectedStudentId]
  );

  return (
    <div className="space-y-5">
      {/* ── Header row ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white" data-testid="text-attendance-title">Attendance Overview</h2>
          <p className="text-white/50 text-sm">Multi-layer daily attendance for {displayDate}</p>
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Select Date
          </label>
          <input
            type="date"
            value={date}
            max={today}
            onChange={e => setDate(e.target.value)}
            className="bg-[#1A2942] border border-white/20 text-white rounded-xl px-3 py-2.5 text-sm h-11 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
            data-testid="input-attendance-date"
          />
        </div>
      </div>

      {/* ── Master Summary Strip ── */}
      <div className="rounded-xl border border-white/10 bg-[#0A1628] p-4">
        <h3 className="text-xs font-bold text-[#D4AF37] uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" /> Daily Pulse — School-Wide
        </h3>
        {summaryLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[1,2,3,4,5,6].map(i => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            <StatCard label="Total Students" value={summary?.total ?? 0} color="text-blue-400" bg="bg-blue-500/20" icon={Users} />
            <StatCard label="Total Marked" value={summary?.total ?? 0} color="text-white/70" bg="bg-white/10" icon={BookOpen} />
            <StatCard label="Present" value={summary?.present ?? 0} color="text-emerald-400" bg="bg-emerald-500/20" icon={CheckCircle} />
            <StatCard label="Absent" value={summary?.absent ?? 0} color="text-red-400" bg="bg-red-500/20" icon={UserX} />
            <StatCard label="On Leave" value={summary?.leave ?? 0} color="text-amber-400" bg="bg-amber-500/20" icon={Calendar} />
            <StatCard label="Attendance %" value={`${summary?.percentage ?? 0}%`} color="text-[#D4AF37]" bg="bg-yellow-500/20" icon={TrendingUp} />
          </div>
        )}
        {/* Progress bar */}
        {!summaryLoading && (
          <div className="mt-3">
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${summary?.percentage ?? 0}%`, background: "linear-gradient(90deg, #D4AF37, #F4D03F)" }}
              />
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-white/30">
              <span>0%</span><span>Target: 85%</span><span>100%</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-0 rounded-xl border border-white/10 overflow-hidden w-fit">
        {(["students", "teachers"] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`h-11 px-5 text-sm font-semibold capitalize transition-colors ${
              activeTab === tab
                ? "bg-[#10b981] text-white"
                : "bg-[#1A2942] text-white/50 hover:text-white hover:bg-white/5"
            }`}
            data-testid={`tab-${tab}`}
          >
            {tab === "students" ? "Students" : "Teachers"}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════ */}
      {/* STUDENTS TAB                           */}
      {/* ══════════════════════════════════════ */}
      {activeTab === "students" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="rounded-xl border border-white/10 bg-[#1A2942] p-4">
            <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Filter className="w-3.5 h-3.5" /> Class Filter
            </p>
            {configLoading ? (
              <div className="flex gap-3">
                <div className="h-11 flex-1 rounded-xl bg-white/5 animate-pulse" />
                <div className="h-11 flex-1 rounded-xl bg-white/5 animate-pulse" />
              </div>
            ) : !hasClasses || !hasSections ? (
              <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <p className="text-xs text-amber-300">
                  No classes or sections configured. Go to <strong>School Settings → Metadata</strong> to add them.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-[130px]">
                  <label className="block text-xs text-white/40 mb-1">Class</label>
                  <select
                    value={filterClass}
                    onChange={e => { setFilterClass(e.target.value); setFilterSection(""); setStudentSearch(""); }}
                    className="w-full h-11 px-3 rounded-xl border border-white/20 bg-[#0A1628] text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                    data-testid="select-filter-class"
                  >
                    <option value="">All Classes</option>
                    {(schoolConfig?.classes ?? []).map(c => <option key={c} value={c}>Class {c}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-[110px]">
                  <label className="block text-xs text-white/40 mb-1">Section</label>
                  <select
                    value={filterSection}
                    onChange={e => { setFilterSection(e.target.value); setStudentSearch(""); }}
                    className="w-full h-11 px-3 rounded-xl border border-white/20 bg-[#0A1628] text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                    data-testid="select-filter-section"
                  >
                    <option value="">Select Section</option>
                    {(schoolConfig?.sections ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Class-level stats when class+section selected */}
          {filterClass && filterSection && (
            <>
              {studentLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[1,2,3,4].map(i => <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />)}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Class Strength" value={classStats.total} color="text-blue-400" bg="bg-blue-500/20" icon={Users} />
                  <StatCard label="Present" value={classStats.present} color="text-emerald-400" bg="bg-emerald-500/20" icon={CheckCircle} />
                  <StatCard label="Absent" value={classStats.absent} color="text-red-400" bg="bg-red-500/20" icon={UserX} />
                  <StatCard label="Attendance %" value={`${classStats.pct}%`} color="text-[#D4AF37]" bg="bg-yellow-500/20" icon={TrendingUp} />
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search by name, roll no, or DSID…"
                  value={studentSearch}
                  onChange={e => setStudentSearch(e.target.value)}
                  className="w-full h-11 pl-9 pr-4 rounded-xl border border-white/20 bg-[#1A2942] text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                  data-testid="input-student-search"
                />
              </div>

              {/* Student Table */}
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm min-w-[480px]">
                    <thead>
                      <tr className="bg-[#0A1628]">
                        <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Roll No</th>
                        <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Student Name</th>
                        <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Status</th>
                        <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentLoading ? (
                        Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                      ) : filteredStudents.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-12 text-center text-white/40 text-sm">
                            {studentData.length === 0
                              ? `No students found in Class ${filterClass}-${filterSection}`
                              : "No students match your search"}
                          </td>
                        </tr>
                      ) : (
                        filteredStudents.map((s, idx) => (
                          <tr
                            key={s.studentId}
                            className={`border-b border-white/5 transition-colors ${idx % 2 === 0 ? "bg-[#1A2942]" : "bg-[#0A1628]"} hover:bg-white/5`}
                            data-testid={`row-student-${s.studentId}`}
                          >
                            <td className="px-3 py-3 text-white/60 text-xs font-mono">{s.rollNo || "—"}</td>
                            <td className="px-3 py-3">
                              <div>
                                <p className="text-white text-sm font-medium">{s.name}</p>
                                <p className="text-white/30 text-xs">{s.digitalStudentId}</p>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge status={s.status} />
                            </td>
                            <td className="px-3 py-3">
                              <button
                                title="View student detail"
                                onClick={() => setSelectedStudentId(s.studentId)}
                                className="inline-flex items-center gap-1 text-xs text-[#10b981] hover:text-emerald-300 transition-colors h-8 px-2 rounded-lg hover:bg-emerald-500/10"
                                data-testid={`button-view-student-${s.studentId}`}
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">View</span>
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {filteredStudents.length > 0 && (
                  <div className="px-3 py-2 bg-[#0A1628] border-t border-white/10">
                    <p className="text-xs text-white/30">{filteredStudents.length} student{filteredStudents.length !== 1 ? "s" : ""} shown</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Prompt when no class+section selected */}
          {(!filterClass || !filterSection) && hasClasses && hasSections && (
            <div className="rounded-xl border border-white/10 bg-[#1A2942]/50 p-10 text-center">
              <Users className="w-8 h-8 text-white/20 mx-auto mb-3" />
              <p className="text-white/40 text-sm">Select a class and section to view detailed student attendance</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════ */}
      {/* TEACHERS TAB                           */}
      {/* ══════════════════════════════════════ */}
      {activeTab === "teachers" && (
        <div className="space-y-4">
          {/* Teacher summary cards */}
          {teacherLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard label="Total Faculty" value={ts?.totalFaculty ?? 0} color="text-blue-400" bg="bg-blue-500/20" icon={Users} />
              <StatCard label="Marked Attendance" value={ts?.marked ?? 0} color="text-emerald-400" bg="bg-emerald-500/20" icon={CheckCircle} />
              <StatCard label="Not Marked" value={ts?.notMarked ?? 0} color="text-red-400" bg="bg-red-500/20" icon={AlertTriangle} />
            </div>
          )}

          {/* Late submission notice */}
          {!teacherLoading && (teacherSummaryData?.teachers ?? []).filter(t => t.isLate).length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-orange-500/30 bg-orange-500/10">
              <Clock className="w-4 h-4 text-orange-400 flex-shrink-0" />
              <p className="text-xs text-orange-300">
                <strong>{(teacherSummaryData?.teachers ?? []).filter(t => t.isLate).length}</strong> teacher(s) submitted attendance after 9:00 AM
              </p>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name, subject, or department…"
              value={teacherSearch}
              onChange={e => setTeacherSearch(e.target.value)}
              className="w-full h-11 pl-9 pr-4 rounded-xl border border-white/20 bg-[#1A2942] text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
              data-testid="input-teacher-search"
            />
          </div>

          {/* Teacher Table */}
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm min-w-[520px]">
                <thead>
                  <tr className="bg-[#0A1628]">
                    <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Teacher</th>
                    <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Class / Subject</th>
                    <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Status</th>
                    <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {teacherLoading ? (
                    Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
                  ) : filteredTeachers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-12 text-center text-white/40 text-sm">
                        {(teacherSummaryData?.teachers ?? []).length === 0
                          ? "No teachers registered for this school"
                          : "No teachers match your search"}
                      </td>
                    </tr>
                  ) : (
                    filteredTeachers.map((t, idx) => (
                      <tr
                        key={t.teacherId}
                        className={`border-b border-white/5 transition-colors ${idx % 2 === 0 ? "bg-[#1A2942]" : "bg-[#0A1628]"} hover:bg-white/5`}
                        data-testid={`row-teacher-${t.teacherId}`}
                      >
                        <td className="px-3 py-3">
                          <div>
                            <p className="text-white text-sm font-medium">{t.name}</p>
                            {t.department && <p className="text-white/30 text-xs">{t.department}</p>}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div>
                            <p className="text-white/80 text-sm">{t.subject}</p>
                            <p className="text-white/40 text-xs">Class {t.assignedClass}-{t.assignedSection}</p>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            {t.status === "marked" ? (
                              <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                <CheckCircle className="w-3 h-3" /> Marked
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
                                <AlertTriangle className="w-3 h-3" /> Not Marked
                              </span>
                            )}
                            {t.isLate && (
                              <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30">
                                <Clock className="w-3 h-3" /> Late Submission
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-white/50 text-xs">
                          {t.submittedAt
                            ? new Date(t.submittedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {filteredTeachers.length > 0 && (
              <div className="px-3 py-2 bg-[#0A1628] border-t border-white/10">
                <p className="text-xs text-white/30">{filteredTeachers.length} teacher{filteredTeachers.length !== 1 ? "s" : ""} shown</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* No-data notice */}
      {!summaryLoading && (summary?.total ?? 0) === 0 && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-center">
          <p className="text-yellow-400 text-sm">
            No student attendance records found for {displayDate}. Teachers may not have marked attendance yet.
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* STUDENT DETAIL MODAL (Quick Action drill-down)            */}
      {/* ══════════════════════════════════════════════════════════ */}
      {selectedStudentId !== null && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm" data-testid="modal-student-detail">
          <div className="w-full max-w-md rounded-2xl bg-[#1A2942] border border-white/10 shadow-2xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-[#D4AF37]" />
                <span className="text-sm font-semibold text-white">Student Profile</span>
              </div>
              <button
                onClick={() => setSelectedStudentId(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                data-testid="button-close-student-modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal body */}
            {studentDetailLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" />
              </div>
            ) : selectedStudentDetail ? (
              <div className="p-5 space-y-4">
                {/* Name + DSID */}
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-[#D4AF37] font-bold text-lg">
                      {selectedStudentDetail.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-white font-semibold" data-testid="text-modal-student-name">{selectedStudentDetail.name}</p>
                    <p className="text-white/40 text-xs font-mono mt-0.5" data-testid="text-modal-student-dsid">{selectedStudentDetail.digitalStudentId}</p>
                    {selectedStudentStatus && (
                      <div className="mt-1">
                        <StatusBadge status={selectedStudentStatus} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-[#0A1628] rounded-lg p-3">
                    <p className="text-white/40 text-xs mb-1">Class / Section</p>
                    <p className="text-white font-medium" data-testid="text-modal-student-class">
                      Class {selectedStudentDetail.class} – {selectedStudentDetail.section}
                    </p>
                  </div>
                  <div className="bg-[#0A1628] rounded-lg p-3">
                    <p className="text-white/40 text-xs mb-1">Roll No</p>
                    <p className="text-white font-medium" data-testid="text-modal-student-roll">
                      {selectedStudentDetail.rollNo || "—"}
                    </p>
                  </div>
                </div>

                {selectedStudentDetail.phone && (
                  <div className="flex items-center gap-2 text-sm text-white/60">
                    <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                    <span data-testid="text-modal-student-phone">{selectedStudentDetail.phone}</span>
                  </div>
                )}
                {selectedStudentDetail.fatherName && (
                  <div className="flex items-center gap-2 text-sm text-white/60">
                    <User className="w-3.5 h-3.5 flex-shrink-0" />
                    <span data-testid="text-modal-student-father">Father: {selectedStudentDetail.fatherName}</span>
                  </div>
                )}
                {selectedStudentDetail.presentAddress && (
                  <div className="flex items-start gap-2 text-sm text-white/60">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span data-testid="text-modal-student-address" className="line-clamp-2">{selectedStudentDetail.presentAddress}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t border-white/10">
                  <button
                    onClick={() => { setSelectedStudentId(null); onViewStudent?.(selectedStudentDetail.id); }}
                    className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-lg bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/20 transition-colors text-sm font-medium"
                    data-testid="button-go-to-registry"
                  >
                    <Users className="w-4 h-4" />
                    Open in Registry
                  </button>
                  <button
                    onClick={() => setSelectedStudentId(null)}
                    className="h-10 px-4 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-colors text-sm"
                    data-testid="button-close-student-detail"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-10 text-center text-white/40 text-sm">Failed to load student data</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
