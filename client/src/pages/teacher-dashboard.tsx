import { useState, useCallback, useEffect, useMemo, useRef, createContext, useContext } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  GraduationCap, Loader2, LogOut, ArrowLeft, ArrowRight, History, ChevronDown,
} from "lucide-react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getQueryFn, setViewSessionId } from "@/lib/queryClient";

import ProfileModule from "@/pages/teacher-modules/profile";
import AttendanceModule from "@/pages/teacher-modules/attendance";
import HomeworkModule from "@/pages/teacher-modules/homework";
import ClassworkModule from "@/pages/teacher-modules/classwork";
import NoticeboardModule from "@/pages/teacher-modules/noticeboard";
import ComplaintModule from "@/pages/teacher-modules/complaint";
import ExaminationModule from "@/pages/teacher-modules/examination";
import GalleryModule from "@/pages/teacher-modules/gallery";
import FacultyInfoModule from "@/pages/teacher-modules/faculty-info";
import CalendarModule from "@/pages/teacher-modules/calendar";
import LibraryModule from "@/pages/teacher-modules/library";
import LeaveModule from "@/pages/teacher-modules/leave";
import TimetableModule from "@/pages/teacher-modules/timetable";
import StudentProfilesModule from "@/pages/teacher-modules/student-profiles";

interface AcademicSessionItem {
  id: number;
  sessionName: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
}

// ── Archive Mode Context ────────────────────────────────────────────────────
// Provides a boolean to every teacher sub-module without prop drilling.
// true  → viewing an archived/historical session (all writes are blocked)
// false → normal active session (default)
export const ArchiveModeContext = createContext<boolean>(false);
export function useArchiveMode(): boolean { return useContext(ArchiveModeContext); }

export interface TeacherMe {
  id: number;
  userId: number;
  fullName: string;
  email: string;
  phone: string;
  subject: string;
  assignedClass: string;
  assignedSection: string;
  mustChangePassword: boolean;
  schoolId: number;
  schoolName: string;
  schoolCode: string;
  attendanceDoneToday: boolean;
  profileImageUrl: string | null;
  mappings: { className: string; section: string; subject: string | null }[];
}

const moduleComponents: Record<string, React.ComponentType<{ teacher: TeacherMe }>> = {
  profile: ProfileModule,
  attendance: AttendanceModule,
  homework: HomeworkModule,
  classwork: ClassworkModule,
  noticeboard: NoticeboardModule,
  complaint: ComplaintModule,
  examination: ExaminationModule,
  gallery: GalleryModule,
  "faculty-info": FacultyInfoModule,
  calendar: CalendarModule,
  library: LibraryModule,
  leave: LeaveModule,
  timetable: TimetableModule,
  "student-profiles": StudentProfilesModule,
};

interface TileConfig {
  id: string;
  label: string;
  emoji: string;
  zone: string;
  desc: string;
  accentColor: string;
}

const TILES: TileConfig[] = [
  { id: "profile",         label: "Teacher Profile",  emoji: "👤", zone: "Classroom",      desc: "Your info, photo, subject & security",     accentColor: "#6366f1" },
  { id: "attendance",      label: "Attendance",        emoji: "📋", zone: "Classroom",      desc: "Mark daily class attendance rolls",         accentColor: "#6366f1" },
  { id: "homework",        label: "Homework",          emoji: "📚", zone: "Classroom",      desc: "Assign and review student homework",         accentColor: "#6366f1" },
  { id: "classwork",       label: "Classwork",         emoji: "✏️", zone: "Classroom",      desc: "In-class tasks and activity records",        accentColor: "#6366f1" },
  { id: "noticeboard",     label: "Noticeboard",       emoji: "🔔", zone: "School Life",    desc: "Post notices to classes or school-wide",    accentColor: "#14b8a6" },
  { id: "complaint",       label: "Complaint",         emoji: "🛡️", zone: "School Life",    desc: "Raise or track staff complaints",            accentColor: "#14b8a6" },
  { id: "examination",     label: "Examination",       emoji: "🏆", zone: "School Life",    desc: "Enter scores and manage exam results",       accentColor: "#14b8a6" },
  { id: "gallery",         label: "Gallery",           emoji: "🖼️", zone: "School Life",    desc: "Class photos, events and memories",          accentColor: "#14b8a6" },
  { id: "faculty-info",    label: "Faculty Info",      emoji: "👥", zone: "School Life",    desc: "All teachers & support staff directory",     accentColor: "#14b8a6" },
  { id: "calendar",        label: "School Calendar",   emoji: "📅", zone: "School Life",    desc: "Events, holidays and academic schedule",     accentColor: "#14b8a6" },
  { id: "library",         label: "Library",           emoji: "📖", zone: "School Life",    desc: "E-books, resources and reading material",    accentColor: "#14b8a6" },
  { id: "leave",           label: "Leave",             emoji: "🗓️", zone: "Administration", desc: "Apply for and track leave requests",         accentColor: "#fb7185" },
  { id: "timetable",       label: "Timetable",         emoji: "⏰", zone: "Administration", desc: "Your class periods and weekly schedule",     accentColor: "#fb7185" },
  { id: "student-profiles",label: "Approval Center",  emoji: "✅", zone: "Administration", desc: "Review and approve student profile edits",   accentColor: "#fb7185" },
];

// ── Noticeboard unread tracking (mirrors noticeboard.tsx localStorage key) ──
function getDashboardReadIds(teacherId: number): Set<number> {
  try {
    const raw = localStorage.getItem(`noticeReads_teacher_${teacherId}`);
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
  } catch { return new Set(); }
}

const ZONE_ORDER = ["Classroom", "School Life", "Administration"];
const ZONE_COLOR: Record<string, string> = {
  "Classroom":      "#6366f1",
  "School Life":    "#14b8a6",
  "Administration": "#fb7185",
};

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 200, damping: 22 } },
};

function TileCard({
  tile,
  badge,
  dotColor,
  onClick,
}: {
  tile: TileConfig;
  badge?: number;
  dotColor?: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useTransform(mouseY, [-0.5, 0.5], [8, -8]);
  const rotateY = useTransform(mouseX, [-0.5, 0.5], [-8, 8]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
  }, [mouseX, mouseY]);

  const handleMouseLeave = useCallback(() => {
    mouseX.set(0);
    mouseY.set(0);
    setHovered(false);
  }, [mouseX, mouseY]);

  return (
    <motion.button
      variants={cardVariants}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleMouseLeave}
      whileHover={{ scale: 1.04 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      data-testid={`card-module-${tile.id}`}
      className="relative text-left focus:outline-none flex flex-col"
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRadius: "16px",
        border: "1px solid rgba(255,255,255,0.08)",
        borderTop: `3px solid ${tile.accentColor}`,
        boxShadow: hovered
          ? `0 24px 64px ${tile.accentColor}20, 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px ${tile.accentColor}25`
          : "0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)",
        padding: "20px",
        minHeight: "160px",
        cursor: "pointer",
      }}
    >
      {/* count badge (e.g. pending approvals) */}
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute top-3 right-3 min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1.5"
          data-testid={`badge-${tile.id}`}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}


      {/* emoji icon block */}
      <div
        className="flex items-center justify-center rounded-2xl mb-4"
        style={{
          width: "58px",
          height: "58px",
          background: `${tile.accentColor}18`,
          boxShadow: hovered
            ? `0 0 28px ${tile.accentColor}50, 0 0 60px ${tile.accentColor}18`
            : `0 0 22px ${tile.accentColor}28, 0 0 40px ${tile.accentColor}10`,
          fontSize: "28px",
          lineHeight: 1,
          flexShrink: 0,
          transition: "box-shadow 0.25s ease",
        }}
      >
        {tile.emoji}
      </div>

      <h3 className="font-bold text-white text-sm leading-tight mb-1.5">{tile.label}</h3>
      <p className="text-white/40 text-xs leading-relaxed flex-1">{tile.desc}</p>

      <div
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg self-start transition-all duration-200"
        style={{
          background: hovered ? `${tile.accentColor}20` : "transparent",
          color: hovered ? tile.accentColor : "rgba(255,255,255,0.30)",
          border: `1px solid ${hovered ? tile.accentColor + "40" : "transparent"}`,
        }}
      >
        Open <ArrowRight className="w-3 h-3" />
      </div>
    </motion.button>
  );
}

export default function TeacherDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [matched, params] = useRoute("/teacher-dashboard/:module");
  const activeModule = matched ? params?.module : null;

  // ── Session look-back state ──────────────────────────────────────────────
  // null  → teacher is viewing the active/current session (default)
  // number → teacher is in archive mode viewing that past session's data
  const [viewingSessionId, setViewingSessionId] = useState<number | null>(null);
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const sessionDropdownRef = useRef<HTMLDivElement>(null);

  const { data: teacher, isLoading, isError } = useQuery<TeacherMe | null>({
    queryKey: ["/api/teacher-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: pendingProfilesData } = useQuery<{ count: number }>({
    queryKey: ["/api/teacher/pending-profiles/count"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!teacher,
    refetchInterval: 60000,
  });
  const pendingProfilesCount = pendingProfilesData?.count ?? 0;

  // Fetch teacher-scoped admin notices to compute unread badge for the noticeboard tile
  const { data: adminNoticesForBadge = [] } = useQuery<Array<{ id: number }>>({
    queryKey: ["/api/notices", teacher?.schoolId, "teacher"],
    queryFn: async () => {
      if (!teacher) return [];
      const res = await fetch(`/api/notices/${teacher.schoolId}?target=teacher`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!teacher,
    staleTime: 30000,
    refetchOnMount: "always",
  });

  // Unread count = notices whose IDs are not in the teacher's localStorage read-set
  const noticeboardUnreadCount = useMemo(() => {
    if (!teacher) return 0;
    const readIds = getDashboardReadIds(teacher.id);
    return adminNoticesForBadge.filter(n => !readIds.has(n.id)).length;
  }, [adminNoticesForBadge, teacher?.id]);

  // ── Academic sessions for look-back picker ─────────────────────────────
  const { data: allSessions = [] } = useQuery<AcademicSessionItem[]>({
    queryKey: ["/api/teacher/academic-sessions"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!teacher,
    staleTime: 60000,
  });
  const activeSession = allSessions.find(s => s.isActive) ?? null;
  const viewingSession = viewingSessionId != null
    ? (allSessions.find(s => s.id === viewingSessionId) ?? null)
    : null;

  // Sync viewingSessionId → global queryClient header whenever it changes.
  useEffect(() => {
    setViewSessionId(viewingSessionId);
  }, [viewingSessionId]);

  // On unmount (logout / route away), always reset the global session context.
  useEffect(() => {
    return () => { setViewSessionId(null); };
  }, []);

  // Close session dropdown on outside click.
  useEffect(() => {
    if (!sessionDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(e.target as Node)) {
        setSessionDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sessionDropdownOpen]);

  useEffect(() => {
    if (!isLoading && (isError || !teacher)) {
      setLocation("/teacher-login");
    }
    if (!isLoading && teacher?.mustChangePassword) {
      setLocation("/teacher-login");
    }
  }, [isLoading, isError, teacher, setLocation]);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/teacher-logout");
    },
    onSuccess: () => {
      setViewSessionId(null);
      queryClient.clear();
      setLocation("/teacher-login");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading || !teacher) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#0f172a" }}
      >
        <Loader2 className="w-8 h-8 animate-spin text-teal-400" />
      </div>
    );
  }

  const ActiveComponent = activeModule ? moduleComponents[activeModule] : null;
  const firstName = teacher.fullName.split(" ")[0];
  const initials = teacher.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen" style={{ background: "#0f172a" }}>

      {/* Decorative radial blobs */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: "-20%", left: "-10%",
          width: "600px", height: "600px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute", top: "30%", right: "-15%",
          width: "500px", height: "500px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(20,184,166,0.10) 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute", bottom: "10%", left: "30%",
          width: "400px", height: "400px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(251,113,133,0.08) 0%, transparent 70%)",
        }} />
      </div>

      {/* Fixed glassmorphic navbar */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 border-b"
        style={{
          background: "rgba(15,23,42,0.82)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderColor: "rgba(255,255,255,0.06)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">

          {/* Left: back button + logo */}
          <div className="flex items-center gap-3">
            {activeModule && (
              <button
                onClick={() => setLocation("/teacher-dashboard")}
                data-testid="button-back"
                className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}

            {/* BENIUS logo */}
            <div
              className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, #6366f1, #14b8a6)",
                boxShadow: "0 0 16px rgba(99,102,241,0.4)",
              }}
            >
              <GraduationCap className="w-5 h-5 text-white" />
            </div>

            <div>
              <p className="text-sm font-extrabold text-white tracking-wider" data-testid="text-dashboard-title">
                BENIUS
              </p>
              <p className="text-[10px] text-white/40 leading-none">{teacher.schoolName}</p>
            </div>
          </div>

          {/* Centre: Session look-back picker (only when sessions exist) */}
          {allSessions.length > 1 && (
            <div className="flex-1 flex justify-center" ref={sessionDropdownRef}>
              <div className="relative">
                <button
                  onClick={() => setSessionDropdownOpen(prev => !prev)}
                  data-testid="button-session-picker"
                  className="flex items-center gap-2 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all duration-200"
                  style={{
                    background: viewingSessionId
                      ? "rgba(251,191,36,0.12)"
                      : "rgba(20,184,166,0.10)",
                    border: viewingSessionId
                      ? "1px solid rgba(251,191,36,0.35)"
                      : "1px solid rgba(20,184,166,0.25)",
                    color: viewingSessionId ? "#fbbf24" : "rgba(94,234,212,0.9)",
                  }}
                >
                  {viewingSessionId
                    ? <History className="w-3 h-3 flex-shrink-0" />
                    : <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse flex-shrink-0" style={{ boxShadow: "0 0 6px #14b8a6" }} />}
                  <span className="hidden sm:inline">
                    {viewingSession
                      ? `${viewingSession.sessionName} · Archive`
                      : activeSession
                        ? `${activeSession.sessionName} · Active`
                        : "Current Session"}
                  </span>
                  <ChevronDown
                    className="w-3 h-3 transition-transform"
                    style={{ transform: sessionDropdownOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>

                {sessionDropdownOpen && (
                  <div
                    className="absolute top-full mt-2 left-1/2 z-[60] rounded-xl overflow-hidden"
                    style={{
                      transform: "translateX(-50%)",
                      minWidth: "220px",
                      background: "rgba(15,23,42,0.97)",
                      backdropFilter: "blur(20px)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
                    }}
                  >
                    <div className="px-3 py-2 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Academic Sessions</p>
                    </div>
                    {allSessions.map(s => (
                      <button
                        key={s.id}
                        data-testid={`session-option-${s.id}`}
                        onClick={() => {
                          setViewingSessionId(s.isActive ? null : s.id);
                          setSessionDropdownOpen(false);
                          queryClient.invalidateQueries({ queryKey: ["/api/homework"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/exam-scores"] });
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 transition-colors text-left"
                        style={{
                          background: (s.isActive ? !viewingSessionId : viewingSessionId === s.id)
                            ? "rgba(255,255,255,0.05)"
                            : "transparent",
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                        }}
                      >
                        <span className="text-xs font-medium text-white/80">{s.sessionName}</span>
                        {s.isActive
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(20,184,166,0.15)", color: "#14b8a6" }}>Active</span>
                          : (viewingSessionId === s.id)
                            ? <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24" }}>Viewing</span>
                            : <History className="w-3 h-3 text-white/25" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Right: avatar + name + logout */}
          <div className="flex items-center gap-3">
            {teacher.profileImageUrl ? (
              <img
                src={teacher.profileImageUrl}
                alt={teacher.fullName}
                className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                style={{ border: "2px solid rgba(20,184,166,0.5)" }}
                data-testid="img-navbar-avatar"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.35), rgba(20,184,166,0.35))",
                  border: "2px solid rgba(20,184,166,0.40)",
                }}
                data-testid="div-navbar-initials"
              >
                <span className="text-[10px] font-bold text-teal-300">{initials}</span>
              </div>
            )}

            <div className="hidden sm:block text-right">
              <p className="text-xs font-semibold text-white leading-none" data-testid="text-teacher-name">
                {teacher.fullName}
              </p>
              <p className="text-[10px] text-white/40 mt-0.5">{teacher.subject}</p>
            </div>

            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              data-testid="button-logout"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.65)",
              }}
            >
              {logoutMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <LogOut className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">
                {logoutMutation.isPending ? "Logging out…" : "Logout"}
              </span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main content — padded below fixed nav */}
      <div className="relative z-10 pt-16">
        {ActiveComponent ? (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 text-foreground">
            <ArchiveModeContext.Provider value={viewingSessionId != null}>
              <ActiveComponent teacher={teacher} />
            </ArchiveModeContext.Provider>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

            {/* ── Archive mode banner ─────────────────────────────────── */}
            {viewingSession && (
              <div
                className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl"
                data-testid="banner-archive-mode"
                style={{
                  background: "rgba(251,191,36,0.07)",
                  border: "1px solid rgba(251,191,36,0.25)",
                }}
              >
                <History className="w-4 h-4 flex-shrink-0" style={{ color: "#fbbf24" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: "#fbbf24" }}>
                    Archive Mode — Viewing {viewingSession.sessionName}
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5">
                    All Attendance, Homework, and Marks data shown is from this past session. Edits are disabled.
                  </p>
                </div>
                <button
                  onClick={() => setViewingSessionId(null)}
                  data-testid="button-exit-archive"
                  className="flex-shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all"
                  style={{
                    background: "rgba(251,191,36,0.15)",
                    border: "1px solid rgba(251,191,36,0.30)",
                    color: "#fbbf24",
                  }}
                >
                  Return to Active
                </button>
              </div>
            )}

            {/* Hero greeting */}
            <div className="mb-8 text-center">
              <h2
                className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3"
                data-testid="text-welcome"
                style={{
                  background: "linear-gradient(90deg, #6366f1, #14b8a6, #fb7185)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Welcome back, {firstName}! 🍎
              </h2>

              {/* Pill badges */}
              <div className="flex flex-wrap justify-center gap-2 mt-3" data-testid="text-assignments">
                {/* Pending approvals pill */}
                {pendingProfilesCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                    style={{
                      background: "rgba(239,68,68,0.12)",
                      border: "1px solid rgba(239,68,68,0.30)",
                      color: "#ef4444",
                    }}
                    data-testid="badge-pending-profiles"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" style={{ boxShadow: "0 0 6px #ef4444" }} />
                    {pendingProfilesCount} Pending Approval{pendingProfilesCount !== 1 ? "s" : ""}
                  </span>
                )}

                {/* Class mapping pills */}
                {(teacher.mappings && teacher.mappings.length > 0
                  ? teacher.mappings
                  : [{ className: teacher.assignedClass, section: teacher.assignedSection, subject: teacher.subject }]
                ).map((m, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium"
                    style={{
                      background: "rgba(99,102,241,0.10)",
                      border: "1px solid rgba(99,102,241,0.25)",
                      color: "rgba(165,163,255,0.9)",
                    }}
                    data-testid={`badge-assignment-${i}`}
                  >
                    Class {m.className}{m.section}{m.subject ? ` · ${m.subject}` : ""}
                  </span>
                ))}
              </div>
            </div>

            {/* Zone-grouped tile grid */}
            {ZONE_ORDER.map((zone) => {
              const zoneTiles = TILES.filter((t) => t.zone === zone);
              const zoneColor = ZONE_COLOR[zone];
              return (
                <div key={zone} className="mb-10">
                  {/* Zone header */}
                  <div className="flex items-center gap-3 mb-5">
                    <h3
                      className="text-xs font-extrabold tracking-widest uppercase flex-shrink-0"
                      style={{
                        color: zoneColor,
                        textShadow: `0 0 12px ${zoneColor}80`,
                      }}
                    >
                      {zone}
                    </h3>
                    <div
                      className="flex-1 h-px"
                      style={{
                        background: `linear-gradient(to right, ${zoneColor}50, transparent)`,
                      }}
                    />
                  </div>

                  {/* Tile grid with stagger */}
                  <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="show"
                    className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                  >
                    {zoneTiles.map((tile) => {
                      const isAttendance = tile.id === "attendance";
                      const isApproval = tile.id === "student-profiles";
                      const isNoticeboard = tile.id === "noticeboard";

                      const badge = isApproval && pendingProfilesCount > 0
                        ? pendingProfilesCount
                        : isNoticeboard && noticeboardUnreadCount > 0
                          ? noticeboardUnreadCount
                          : undefined;

                      return (
                        <TileCard
                          key={tile.id}
                          tile={tile}
                          badge={badge}
                          dotColor={isAttendance
                            ? (teacher.attendanceDoneToday ? "#10b981" : "#ef4444")
                            : undefined}
                          onClick={() => setLocation(`/teacher-dashboard/${tile.id}`)}
                        />
                      );
                    })}
                  </motion.div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
