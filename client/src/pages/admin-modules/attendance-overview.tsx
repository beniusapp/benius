import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, UserX, Loader2, Calendar, Filter, CheckCircle, Search, Eye,
  ChevronRight, AlertTriangle, TrendingUp, X, Phone, MapPin, User,
  Clock, GraduationCap, BookOpen,
  type LucideIcon,
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

interface AttendanceOverview {
  enrolledTotal: number;
  markedTotal: number;
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

interface TeacherRow {
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
  teachers: TeacherRow[];
}

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
        <AlertTriangle className="w-3 h-3" /> Late
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-white/10 text-white/50 border border-white/10">
      Not Marked
    </span>
  );
}

function TeacherStatusBadge({ status, isLate }: { status: string; isLate: boolean }) {
  if (status === "not-marked") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-white/10 text-white/50 border border-white/10">
        Not Marked
      </span>
    );
  }
  if (isLate) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30">
        <AlertTriangle className="w-3 h-3" /> Late
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
      <CheckCircle className="w-3 h-3" /> On Time
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

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-3 border-b border-white/5">
          <div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: `${60 + i * 10}%` }} />
        </td>
      ))}
    </tr>
  );
}

function formatTime(isoString: string | null): string {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function AttendanceOverview({ schoolId, onViewStudent }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [filterClass, setFilterClass] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [teacherSearch, setTeacherSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);

  // School config
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

  // School-wide enrollment-based overview
  const { data: overview, isLoading: overviewLoading } = useQuery<AttendanceOverview>({
    queryKey: ["/api/admin/attendance/overview", date],
    queryFn: async () => {
      const r = await fetch(`/api/admin/attendance/overview?date=${date}`, { credentials: "include" });
      return r.ok ? r.json() : { enrolledTotal: 0, markedTotal: 0, present: 0, absent: 0, leave: 0, percentage: 0 };
    },
    enabled: !!schoolId,
    staleTime: 0,
  });

  // Teacher summary (for quick-stat + Section B)
  const { data: teacherSummaryData, isLoading: teacherLoading } = useQuery<TeacherSummaryResponse>({
    queryKey: ["/api/admin/attendance/teacher-summary", date],
    queryFn: async () => {
      const r = await fetch(`/api/admin/attendance/teacher-summary?date=${date}`, { credentials: "include" });
      return r.ok ? r.json() : { summary: { totalFaculty: 0, marked: 0, notMarked: 0 }, teachers: [] };
    },
    enabled: !!schoolId,
    staleTime: 0,
  });

  // Class-level student attendance — staleTime:0 so attendance changes always reflect immediately
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
    staleTime: 0,
  });

  // Class stats
  // attendanceSubmitted = true only when at least one record exists (not-marked ≠ submitted)
  const classStats = useMemo(() => {
    const total   = studentData.length;
    const marked  = studentData.filter(s => s.status !== "not-marked").length;
    const present = studentData.filter(s => s.status === "present").length;
    const absent  = studentData.filter(s => s.status === "absent").length;
    // Use marked count as denominator so "not-marked" students don't dilute %
    const pct     = marked > 0 ? Math.round((present / marked) * 100) : 0;
    const attendanceSubmitted = marked > 0;
    return { total, present, absent, pct, attendanceSubmitted };
  }, [studentData]);

  // Filtered student rows
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return studentData;
    return studentData.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.rollNo.toLowerCase().includes(q) ||
      s.digitalStudentId.toLowerCase().includes(q)
    );
  }, [studentData, studentSearch]);

  // Filtered teacher rows
  const filteredTeachers = useMemo(() => {
    const q = teacherSearch.trim().toLowerCase();
    const rows = teacherSummaryData?.teachers ?? [];
    if (!q) return rows;
    return rows.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.department ?? "").toLowerCase().includes(q) ||
      (t.subject ?? "").toLowerCase().includes(q)
    );
  }, [teacherSummaryData, teacherSearch]);

  // Student detail query
  const { data: selectedStudentDetail, isLoading: studentDetailLoading } = useQuery<StudentSummary>({
    queryKey: ["/api/admin/students", selectedStudentId, "summary"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/students/${selectedStudentId}/summary`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch student");
      return r.json();
    },
    enabled: selectedStudentId !== null,
  });

  const selectedStudentStatus = useMemo(
    () => studentData.find(s => s.studentId === selectedStudentId)?.status ?? null,
    [studentData, selectedStudentId]
  );

  const displayDate = new Date(date).toLocaleDateString("en-GB");
  const teacherSummary = teacherSummaryData?.summary ?? { totalFaculty: 0, marked: 0, notMarked: 0 };

  return (
    <div className="space-y-5">
      {/* ── HEADER: left = title/subtitle, right = Teacher Quick-Stat + date picker ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        {/* Left */}
        <div>
          <h2 className="text-xl font-bold text-white" data-testid="text-attendance-title">Attendance Overview</h2>
          <p className="text-white/50 text-sm">School-wide daily attendance for {displayDate}</p>
        </div>

        {/* Right: Teacher Quick-Stat box + date picker stacked */}
        <div className="flex flex-col items-end gap-3">
          {/* Teacher Quick-Stat mini-card */}
          <div className="flex items-stretch gap-0 rounded-xl border border-white/10 overflow-hidden bg-[#1A2942]" data-testid="card-teacher-quickstat">
            <div className="flex items-center gap-2 px-4 py-2 border-r border-white/10">
              <GraduationCap className="w-4 h-4 text-[#D4AF37]" />
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Faculty</p>
                <p className="text-lg font-bold text-white" data-testid="stat-faculty-total">
                  {teacherLoading ? <span className="inline-block w-6 h-4 rounded bg-white/10 animate-pulse" /> : teacherSummary.totalFaculty}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-r border-white/10">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Present</p>
                <p className="text-lg font-bold text-emerald-400" data-testid="stat-faculty-present">
                  {teacherLoading ? <span className="inline-block w-6 h-4 rounded bg-white/10 animate-pulse" /> : teacherSummary.marked}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2">
              <UserX className="w-4 h-4 text-red-400" />
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Not Marked</p>
                <p className="text-lg font-bold text-red-400" data-testid="stat-faculty-absent">
                  {teacherLoading ? <span className="inline-block w-6 h-4 rounded bg-white/10 animate-pulse" /> : teacherSummary.notMarked}
                </p>
              </div>
            </div>
          </div>

          {/* Date picker below Quick-Stat */}
          <div>
            <label className="block text-xs text-white/40 mb-1 text-right">Date</label>
            <input
              type="date"
              value={date}
              max={today}
              onChange={e => setDate(e.target.value)}
              className="h-11 px-3 rounded-xl border border-white/20 bg-[#1A2942] text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              data-testid="input-attendance-date"
            />
          </div>
        </div>
      </div>

      {/* ── STUDENT PULSE — School-Wide Master Summary ── */}
      <div className="rounded-xl border border-white/10 bg-[#0A1628] p-4">
        <h3 className="text-xs font-bold text-[#D4AF37] uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" /> Student Pulse — School-Wide
        </h3>
        {overviewLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-20 rounded-xl bg-white/5 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Total Students" value={overview?.enrolledTotal ?? 0} color="text-blue-400" bg="bg-blue-500/20" icon={Users} />
            <StatCard label="Total Marked" value={overview?.markedTotal ?? 0} color="text-indigo-400" bg="bg-indigo-500/20" icon={CheckCircle} />
            <StatCard label="Present" value={overview?.present ?? 0} color="text-emerald-400" bg="bg-emerald-500/20" icon={CheckCircle} />
            <StatCard label="Absent" value={overview?.absent ?? 0} color="text-red-400" bg="bg-red-500/20" icon={UserX} />
            <StatCard label="Attendance %" value={`${overview?.percentage ?? 0}%`} color="text-[#D4AF37]" bg="bg-yellow-500/20" icon={TrendingUp} />
          </div>
        )}
        {!overviewLoading && (
          <div className="mt-3">
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${overview?.percentage ?? 0}%`, background: "linear-gradient(90deg, #D4AF37, #F4D03F)" }}
              />
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-white/30">
              <span>0%</span><span>Target: 85%</span><span>100%</span>
            </div>
          </div>
        )}
        {!overviewLoading && (overview?.markedTotal ?? 0) === 0 && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-xs text-amber-300">No attendance records found for {displayDate}. Teachers may not have marked attendance yet.</p>
          </div>
        )}
      </div>

      {/* ── SECTION A: STUDENT ATTENDANCE ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs font-bold text-white/40 uppercase tracking-widest px-2 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Section A — Student Attendance
          </span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        {/* Class / Section Filter */}
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

        {/* Class-level detail (shown when class + section selected) */}
        {filterClass && filterSection && (
          <div className="space-y-4">
            {studentLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />)}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <StatCard label="Class Strength" value={classStats.total} color="text-blue-400" bg="bg-blue-500/20" icon={Users} />
                  {/* Combined Present / Absent */}
                  <div className="rounded-xl border border-white/10 bg-[#1A2942] p-4 min-w-0">
                    <div className="flex gap-6">
                      <div>
                        <div className="inline-flex p-2 rounded-lg bg-emerald-500/20 mb-2">
                          <CheckCircle className="w-5 h-5 text-emerald-400" />
                        </div>
                        <p
                          className={`text-2xl font-bold ${classStats.attendanceSubmitted ? "text-emerald-400" : "text-white/30"}`}
                          data-testid="stat-present"
                        >
                          {classStats.attendanceSubmitted ? classStats.present : "—"}
                        </p>
                        <p className="text-white/50 text-xs mt-1">Present</p>
                      </div>
                      <div className="w-px bg-white/10 self-stretch" />
                      <div>
                        <div className="inline-flex p-2 rounded-lg bg-red-500/20 mb-2">
                          <UserX className="w-5 h-5 text-red-400" />
                        </div>
                        <p
                          className={`text-2xl font-bold ${classStats.attendanceSubmitted ? "text-red-400" : "text-white/30"}`}
                          data-testid="stat-absent"
                        >
                          {classStats.attendanceSubmitted ? classStats.absent : "—"}
                        </p>
                        <p className="text-white/50 text-xs mt-1">Absent</p>
                      </div>
                    </div>
                  </div>
                  <StatCard
                    label="Attendance %"
                    value={classStats.attendanceSubmitted ? `${classStats.pct}%` : "N/A"}
                    color={classStats.attendanceSubmitted ? "text-[#D4AF37]" : "text-white/30"}
                    bg="bg-yellow-500/20"
                    icon={TrendingUp}
                  />
                </div>
                {/* Not-marked alert banner — shown only when class is selected but no attendance submitted */}
                {!classStats.attendanceSubmitted && classStats.total > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <p className="text-xs text-amber-300">
                      Attendance for Class {filterClass}-{filterSection} on {displayDate} has not been submitted by the teacher yet.
                      All {classStats.total} students are shown as <strong>Not Marked</strong>.
                    </p>
                  </div>
                )}
              </>
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
                      Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={4} />)
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
                              className="inline-flex items-center gap-1 text-xs text-[#10b981] hover:text-emerald-300 transition-colors min-h-[44px] px-3 rounded-lg hover:bg-emerald-500/10"
                              data-testid={`button-view-student-${s.studentId}`}
                            >
                              <Eye className="w-4 h-4" />
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
          </div>
        )}

        {/* Prompt when no class+section selected */}
        {(!filterClass || !filterSection) && hasClasses && hasSections && (
          <div className="rounded-xl border border-white/10 bg-[#1A2942]/50 p-10 text-center">
            <Users className="w-8 h-8 text-white/20 mx-auto mb-3" />
            <p className="text-white/40 text-sm">Select a class and section to view detailed student attendance</p>
          </div>
        )}
      </div>

      {/* ── SECTION B: TEACHER ATTENDANCE ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs font-bold text-white/40 uppercase tracking-widest px-2 flex items-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5" /> Section B — Teacher Attendance
          </span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        {/* Late-submission alert */}
        {!teacherLoading && (teacherSummaryData?.teachers ?? []).some(t => t.isLate) && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-orange-500/30 bg-orange-500/10" data-testid="alert-late-submissions">
            <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0" />
            <p className="text-xs text-orange-300">
              <strong>{(teacherSummaryData?.teachers ?? []).filter(t => t.isLate).length}</strong> teacher{(teacherSummaryData?.teachers ?? []).filter(t => t.isLate).length !== 1 ? "s" : ""} submitted attendance late (after 9:00 AM).
            </p>
          </div>
        )}

        {/* Teacher search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
          <input
            type="text"
            placeholder="Search teacher, department, or subject…"
            value={teacherSearch}
            onChange={e => setTeacherSearch(e.target.value)}
            className="w-full h-11 pl-9 pr-4 rounded-xl border border-white/20 bg-[#1A2942] text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
            data-testid="input-teacher-search"
          />
        </div>

        {/* Teacher Table */}
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm min-w-[540px]">
              <thead>
                <tr className="bg-[#0A1628]">
                  <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Teacher Name</th>
                  <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Department</th>
                  <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Assigned</th>
                  <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Status</th>
                  <th className="text-left px-3 py-3 text-xs font-bold text-white/50 uppercase tracking-wider border-b border-white/10">Clock-In</th>
                </tr>
              </thead>
              <tbody>
                {teacherLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={5} />)
                ) : filteredTeachers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-12 text-center text-white/40 text-sm">
                      {(teacherSummaryData?.teachers ?? []).length === 0
                        ? "No teachers found for this school"
                        : "No teachers match your search"}
                    </td>
                  </tr>
                ) : (
                  filteredTeachers.map((t, idx) => (
                    <tr
                      key={t.teacherId}
                      className={`border-b border-white/5 transition-colors ${
                        t.isLate
                          ? "bg-orange-500/5 hover:bg-orange-500/10"
                          : idx % 2 === 0
                            ? "bg-[#1A2942] hover:bg-white/5"
                            : "bg-[#0A1628] hover:bg-white/5"
                      }`}
                      data-testid={`row-teacher-${t.teacherId}`}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/30 flex items-center justify-center flex-shrink-0">
                            <span className="text-[#D4AF37] font-bold text-xs">{t.name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div>
                            <p className="text-white text-sm font-medium">{t.name}</p>
                            {t.subject && <p className="text-white/30 text-xs flex items-center gap-1"><BookOpen className="w-3 h-3" />{t.subject}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-white/60 text-sm">{t.department || "—"}</td>
                      <td className="px-3 py-3 text-white/60 text-xs">
                        {t.assignedClass && t.assignedSection
                          ? `Class ${t.assignedClass}-${t.assignedSection}`
                          : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <TeacherStatusBadge status={t.status} isLate={t.isLate} />
                      </td>
                      <td className="px-3 py-3">
                        {t.submittedAt ? (
                          <div className="flex items-center gap-1 text-xs text-white/50">
                            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className={t.isLate ? "text-orange-400 font-medium" : ""}>
                              {formatTime(t.submittedAt)}
                            </span>
                            {t.isLate && <span className="text-[10px] text-orange-500 font-bold">LATE</span>}
                          </div>
                        ) : (
                          <span className="text-white/30 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredTeachers.length > 0 && (
            <div className="px-3 py-2 bg-[#0A1628] border-t border-white/10 flex items-center justify-between">
              <p className="text-xs text-white/30">{filteredTeachers.length} teacher{filteredTeachers.length !== 1 ? "s" : ""} shown</p>
              <p className="text-xs text-white/30">
                {teacherSummary.marked}/{teacherSummary.totalFaculty} marked attendance
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Student Detail Modal */}
      {selectedStudentId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-student-detail"
          onClick={e => { if (e.target === e.currentTarget) setSelectedStudentId(null); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-[#1A2942] border border-white/10 shadow-2xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-[#D4AF37]" />
                <span className="text-sm font-semibold text-white">Student Profile</span>
              </div>
              <button
                onClick={() => setSelectedStudentId(null)}
                className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
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

                <div className="flex gap-2 pt-2 border-t border-white/10">
                  <button
                    onClick={() => {
                      const id = selectedStudentDetail.id;
                      setSelectedStudentId(null);
                      onViewStudent?.(id);
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/20 transition-colors text-sm font-medium"
                    data-testid="button-go-to-registry"
                  >
                    <Users className="w-4 h-4" />
                    Open in Registry
                  </button>
                  <button
                    onClick={() => setSelectedStudentId(null)}
                    className="min-h-[44px] px-4 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-colors text-sm"
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
