import { useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { GraduationCap, Loader2, LogOut } from "lucide-react";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface StudentMeResponse {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  phone: string;
  dob: string;
  schoolName: string;
  schoolCode: string;
  schoolId?: number;
}

interface MonthlyAttendanceDay {
  date: string;
  dayOfWeek: number;
  status: string;
  isHoliday: boolean;
  isSunday: boolean;
  isFuture: boolean;
  isApprovedLeave: boolean;
}

interface MonthlyAttendanceResponse {
  schoolId: number;
  studentId: number;
  year: number;
  month: number;
  days: MonthlyAttendanceDay[];
}

interface HomeworkSubmission {
  id: number;
  homeworkId: number;
  studentId: number;
  schoolId: number;
  fileUrl: string | null;
  status: string;
  submittedAt: string;
}

interface HomeworkItem {
  id: number;
  schoolId: number;
  teacherId: number;
  class: string;
  section: string;
  subject: string;
  content: string;
  fileUrl: string | null;
  dueDate: string | null;
  createdAt: string;
  teacherName: string;
  submission: HomeworkSubmission | null;
}

const TILES = [
  { id: "profile",          label: "Profile",          emoji: "🎓", accent: "#3b82f6", bg: "#eff6ff", route: "/student-profile",      pulse: false },
  { id: "attendance",       label: "Attendance",       emoji: "✅", accent: "#10b981", bg: "#f0fdf4", route: "/student/attendance",    pulse: false },
  { id: "homework",         label: "Homework",         emoji: "📝", accent: "#f59e0b", bg: "#fffbeb", route: "/student/homework",      pulse: true  },
  { id: "classwork",        label: "Classwork",        emoji: "📚", accent: "#8b5cf6", bg: "#f5f3ff", route: "/student/classwork",    pulse: false },
  { id: "noticeboard",      label: "Noticeboard",      emoji: "🔔", accent: "#ef4444", bg: "#fef2f2", route: "/student/noticeboard",  pulse: true, noticeKey: true },
  { id: "fees",             label: "Fees",             emoji: "💳", accent: "#06b6d4", bg: "#ecfeff", route: "/student/fees",          pulse: false },
  { id: "examination",      label: "Examination",      emoji: "🏆", accent: "#f97316", bg: "#fff7ed", route: "/student/examination", pulse: false },
  { id: "complaints",       label: "Complaints",       emoji: "🎭", accent: "#ec4899", bg: "#fdf2f8", route: "/student/complaints",   pulse: false },
  { id: "gallery",          label: "Gallery",          emoji: "🎨", accent: "#6366f1", bg: "#eef2ff", route: "/student/gallery",      pulse: false },
  { id: "faculty-info",     label: "Faculty Info",     emoji: "👨‍🏫", accent: "#14b8a6", bg: "#f0fdfa", route: "/student/faculty",     pulse: false },
  { id: "school-calendar",  label: "School Calendar",  emoji: "📅", accent: "#84cc16", bg: "#f7fee7", route: "/student/calendar",    pulse: false },
  { id: "leave",            label: "Leave",            emoji: "🌴", accent: "#a78bfa", bg: "#faf5ff", route: "/student/leave",        pulse: false },
  { id: "timetable",        label: "Timetable",        emoji: "🗓️", accent: "#0ea5e9", bg: "#f0f9ff", route: "/student/timetable",   pulse: false },
] as const;

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 22 },
  show:   { opacity: 1, y: 0,  transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

export default function StudentDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: student, isLoading, isError } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/student/notices/unread-count"],
    enabled: !!student,
    refetchInterval: 60000,
  });

  const now = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const { data: monthlyAttendance } = useQuery<MonthlyAttendanceResponse>({
    queryKey: ["/api/student/attendance/monthly", currentYear, currentMonth],
    queryFn: async () => {
      const r = await fetch(
        `/api/student/attendance/monthly?year=${currentYear}&month=${currentMonth}`,
        { credentials: "include" }
      );
      if (!r.ok) throw new Error(`Attendance fetch failed: ${r.status}`);
      return r.json() as Promise<MonthlyAttendanceResponse>;
    },
    enabled: !!student,
  });

  const { data: homeworkItems } = useQuery<HomeworkItem[]>({
    queryKey: ["/api/student/homework"],
    enabled: !!student,
  });

  useEffect(() => {
    if (!isLoading && (isError || !student || !student.schoolId)) {
      setLocation("/student-login");
    }
  }, [isLoading, isError, student, setLocation]);

  const logoutMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/student-logout"); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student-me"] });
      setLocation("/student-login");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const initials = useMemo(() => {
    if (!student) return "";
    return student.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  }, [student?.name]);

  const attendPct = useMemo(() => {
    if (!monthlyAttendance) return null;
    const workingDays = monthlyAttendance.days.filter(
      (d) => !d.isHoliday && !d.isSunday && !d.isFuture
    );
    if (workingDays.length === 0) return null;
    const present = workingDays.filter((d) => d.status === "present").length;
    return Math.round((present / workingDays.length) * 100);
  }, [monthlyAttendance]);

  const pendingHwCount = useMemo(() => {
    if (!homeworkItems) return null;
    return homeworkItems.filter(
      (hw) => hw.submission === null || hw.submission.status === "rejected"
    ).length;
  }, [homeworkItems]);

  const unreadCount = unreadData?.count ?? 0;

  if (isLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
          <p className="text-sm text-slate-400 font-medium">Loading your portal…</p>
        </div>
      </div>
    );
  }

  const firstName = student.name.split(" ")[0];
  const greeting   = getGreeting();

  const handleTileClick = (label: string, route: string | null) => {
    if (route) { setLocation(route); return; }
    toast({ title: label, description: `${label} module coming soon.` });
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "#f8fafc" }}
    >
      {/* Decorative background radial accents */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px",  width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", top: "38%", left: "28%",        width: "360px", height: "360px", borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 65%)" }} />
      </div>

      {/* ── Fixed glass navigation bar ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          background: "rgba(255, 255, 255, 0.75)",
          borderBottom: "1px solid rgba(255,255,255,0.7)",
          boxShadow: "0 1px 28px rgba(0,0,0,0.07)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-xl"
              style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}
            >
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="font-bold text-base text-slate-800 tracking-tight" data-testid="text-app-title">BENIUS</p>
              <p className="text-[11px] text-slate-400 font-medium">Student Portal</p>
            </div>
          </div>

          <button
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-60 text-slate-600 hover:text-slate-800"
            style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.07)" }}
            data-testid="button-student-logout"
          >
            {logoutMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <LogOut className="w-4 h-4" />}
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* ── Main content (offset for fixed header) ── */}
      <main className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 pt-24 pb-12 space-y-8">

        {/* ── Hero greeting + profile card ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-[24px] p-6 sm:p-8"
          style={{
            background: "rgba(255,255,255,0.78)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            border: "1px solid rgba(255,255,255,0.75)",
            boxShadow: "0 8px 40px rgba(59,130,246,0.10), 0 1px 3px rgba(0,0,0,0.05)",
          }}
          data-testid="card-student-profile"
        >
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
            {/* Avatar */}
            <div
              className="flex-shrink-0 w-[72px] h-[72px] sm:w-20 sm:h-20 rounded-full flex items-center justify-center shadow-lg"
              style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}
              data-testid="avatar-student"
            >
              <span className="text-white font-bold text-2xl sm:text-3xl select-none">{initials}</span>
            </div>

            {/* Greeting + info */}
            <div className="flex-1 text-center sm:text-left min-w-0">
              <p className="text-sm font-medium text-slate-400 mb-0.5">{student.schoolName}</p>
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-800 mb-2 truncate" data-testid="text-student-name">
                {greeting}, {firstName}! 👋
              </h1>

              {/* Info badges */}
              <div className="flex flex-wrap justify-center sm:justify-start gap-2">
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                  style={{ background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe" }}
                  data-testid="text-student-dsid"
                >
                  {student.digitalStudentId}
                </span>
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                  style={{ background: "#f0fdf4", color: "#10b981", border: "1px solid #a7f3d0" }}
                  data-testid="text-student-class"
                >
                  Class {student.class} – {student.section}
                </span>
              </div>

              {/* Quick stats pills — always rendered once data loads */}
              <div className="flex flex-wrap justify-center sm:justify-start gap-2 mt-3">
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shadow-sm"
                  style={{
                    background: attendPct === null ? "#f1f5f9" : attendPct >= 75 ? "#f0fdf4" : "#fef2f2",
                    color:      attendPct === null ? "#94a3b8" : attendPct >= 75 ? "#10b981" : "#ef4444",
                    border:     `1px solid ${attendPct === null ? "#e2e8f0" : attendPct >= 75 ? "#bbf7d0" : "#fecaca"}`,
                  }}
                  data-testid="badge-attendance-pct"
                >
                  <span>📊</span>
                  Attendance: {attendPct !== null ? `${attendPct}%` : "—"}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shadow-sm"
                  style={{
                    background: pendingHwCount === null ? "#f1f5f9" : "#fffbeb",
                    color:      pendingHwCount === null ? "#94a3b8" : "#f59e0b",
                    border:     `1px solid ${pendingHwCount === null ? "#e2e8f0" : "#fde68a"}`,
                  }}
                  data-testid="badge-hw-pending"
                >
                  <span>📝</span>
                  {pendingHwCount !== null ? pendingHwCount : "—"} Pending
                </span>
                {unreadCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shadow-sm"
                    style={{ background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca" }}
                    data-testid="badge-unread-notices"
                  >
                    <span>🔔</span>
                    {unreadCount} New Notice{unreadCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>

            {/* School code badge (desktop) */}
            <div className="hidden sm:flex flex-col items-center gap-1.5 flex-shrink-0">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", boxShadow: "0 4px 12px rgba(99,102,241,0.3)" }}
              >
                <GraduationCap className="w-6 h-6 text-white" />
              </div>
              <p className="text-[10px] text-slate-400 font-mono font-semibold">{student.schoolCode}</p>
            </div>
          </div>
        </motion.div>

        {/* ── Section heading ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          <h2 className="text-base font-bold text-slate-700">My Modules</h2>
          <p className="text-xs text-slate-400 mt-0.5">Tap a card to access your portal</p>
        </motion.div>

        {/* ── Module grid ── */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4"
        >
          {TILES.map((tile) => {
            const showPulse =
              (tile.noticeKey && unreadCount > 0) ||
              (tile.pulse && !tile.noticeKey && (pendingHwCount ?? 0) > 0);

            return (
              <motion.button
                key={tile.id}
                variants={cardVariants}
                whileHover={{
                  scale: 1.05,
                  boxShadow: `0 0 0 2px ${tile.accent}55, 0 12px 36px ${tile.accent}30`,
                  transition: { duration: 0.18, ease: "easeOut" },
                }}
                whileTap={{ scale: 0.97 }}
                data-testid={`tile-${tile.id}`}
                onClick={() => handleTileClick(tile.label, tile.route)}
                className="relative text-left focus:outline-none"
                style={{
                  background: "rgba(255,255,255,0.78)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  borderRadius: "20px",
                  border: "1px solid rgba(255,255,255,0.72)",
                  boxShadow: "0 4px 18px rgba(0,0,0,0.06)",
                  borderTop: `4px solid ${tile.accent}`,
                  cursor: "pointer",
                  padding: "20px 16px",
                  minHeight: "130px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "12px",
                }}
              >
                {/* Pulse dot */}
                {showPulse && (
                  <span
                    className="absolute top-3 right-3"
                    data-testid={`badge-${tile.id}-pulse`}
                    aria-label={tile.noticeKey ? `${unreadCount} unread notices` : `${pendingHwCount ?? 0} pending`}
                  >
                    <span
                      className="relative flex h-3 w-3"
                    >
                      <span
                        className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                        style={{ background: "#ef4444" }}
                      />
                      <span
                        className="relative inline-flex rounded-full h-3 w-3"
                        style={{ background: "#ef4444" }}
                      />
                    </span>
                  </span>
                )}

                {/* Emoji icon in colored circle */}
                <div
                  className="flex items-center justify-center rounded-2xl"
                  style={{
                    width: "68px",
                    height: "68px",
                    background: tile.bg,
                    boxShadow: `0 4px 14px ${tile.accent}22`,
                    fontSize: "36px",
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  {tile.emoji}
                </div>

                {/* Label */}
                <div className="text-center">
                  <span
                    className="text-xs sm:text-sm font-bold leading-tight block"
                    style={{ color: "#1e293b" }}
                  >
                    {tile.label}
                  </span>
                  {tile.route === null && (
                    <span
                      className="text-[10px] font-semibold mt-0.5 block"
                      style={{ color: tile.accent }}
                    >
                      Coming Soon
                    </span>
                  )}
                </div>
              </motion.button>
            );
          })}
        </motion.div>

        {/* ── Footer ── */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.4 }}
          className="text-center text-[11px] text-slate-400 pb-2"
        >
          © {new Date().getFullYear()} BENIUS · {student.schoolName}
        </motion.p>
      </main>
    </div>
  );
}
