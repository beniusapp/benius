import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  GraduationCap, LogOut, Users, UserCheck, Settings, BookOpen, Clock,
  Bell, Image, BarChart2, Shield, UserSquare, CreditCard, Package,
  TrendingUp, MessageSquare, CalendarDays, ChevronLeft, Loader2,
  ArrowRight, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";

import SchoolSetup from "./admin-modules/school-setup";
import StudentRegistry from "./admin-modules/student-registry";
import FacultyMapping from "./admin-modules/faculty-mapping";
import ApprovalCenter from "./admin-modules/approval-center";
import AuditLogsModule from "./admin-modules/audit-logs";
import VisitorLogModule from "./admin-modules/visitor-log";
import AttendanceOverview from "./admin-modules/attendance-overview";
import PerformanceAnalytics from "./admin-modules/performance-analytics";
import ExamController from "./admin-modules/exam-controller";
import ComplaintHub from "./admin-modules/complaint-hub";
import NoticeboardAdmin from "./admin-modules/noticeboard-admin";
import TimetableMaster from "./admin-modules/timetable-master";
import IdCardGen from "./admin-modules/id-card-gen";
import AssetsInventory from "./admin-modules/assets-inventory";

interface MeResponse {
  id: number; email: string; role: string;
  schoolId: number; schoolName: string; schoolCode: string; studentCount: number;
}

type ActiveModule =
  | "grid" | "school-setup" | "timetable" | "attendance" | "exam-controller"
  | "complaint-hub" | "noticeboard" | "approval-center" | "faculty-mapping"
  | "student-registry" | "analytics" | "audit-logs" | "visitor-log"
  | "id-card-gen" | "assets";

interface TileConfig {
  id: ActiveModule;
  label: string;
  icon: any;
  group: string;
  desc: string;
  badgeKey?: string;
}

const TILES: TileConfig[] = [
  { id: "school-setup", label: "School Setup", icon: Settings, group: "Foundation", desc: "Classes, Sections, Subjects, Exam Types" },
  { id: "timetable", label: "Timetable Master", icon: Clock, group: "Foundation", desc: "Map teachers to periods and classes" },
  { id: "attendance", label: "Attendance Overview", icon: CalendarDays, group: "Oversight", desc: "School-wide daily presence stats" },
  { id: "exam-controller", label: "Exam Controller", icon: Shield, group: "Oversight", desc: "Lock scores & generate report cards" },
  { id: "complaint-hub", label: "Complaint Hub", icon: MessageSquare, group: "Oversight", desc: "All teacher complaints in one place", badgeKey: "complaints" },
  { id: "noticeboard", label: "Noticeboard", icon: Bell, group: "Oversight", desc: "Post notices to classes or whole school" },
  { id: "approval-center", label: "Approval Center", icon: UserCheck, group: "Management", desc: "Leaves, gallery, e-books — unified", badgeKey: "approvals" },
  { id: "faculty-mapping", label: "Faculty Mapping", icon: Users, group: "Management", desc: "Add, search, and manage teachers" },
  { id: "student-registry", label: "Student Registry", icon: GraduationCap, group: "Management", desc: "5000+ students with smart pagination" },
  { id: "analytics", label: "Performance Analytics", icon: BarChart2, group: "Enterprise", desc: "Exam scores and class analytics" },
  { id: "audit-logs", label: "Audit Logs", icon: Shield, group: "Enterprise", desc: "Immutable trail of all admin actions" },
  { id: "visitor-log", label: "Visitor Log", icon: UserSquare, group: "Enterprise", desc: "Campus visitor check-in & check-out" },
  { id: "id-card-gen", label: "ID Card Gen", icon: CreditCard, group: "Enterprise", desc: "Generate & print student ID cards" },
  { id: "assets", label: "Assets & Inventory", icon: Package, group: "Enterprise", desc: "Track school equipment and resources" },
];

const GROUP_COLORS: Record<string, string> = {
  Foundation: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  Oversight: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  Management: "text-green-400 bg-green-500/10 border-green-500/20",
  Enterprise: "text-[#D4AF37] bg-[#D4AF37]/10 border-[#D4AF37]/20",
};

const GROUP_ORDER = ["Foundation", "Oversight", "Management", "Enterprise"];

export default function AdminDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeModule, setActiveModule] = useState<ActiveModule>("grid");

  const { data: me, isLoading, isError } = useQuery<MeResponse | null>({
    queryKey: ["/api/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!isLoading && (isError || !me)) setLocation("/login");
  }, [isLoading, isError, me, setLocation]);

  const { data: schoolMeta } = useQuery<{ classes: string[]; sections: string[]; subjects: string[]; exam_types: string[] }>({
    queryKey: ["/api/school-metadata", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return { classes: [], sections: [], subjects: [], exam_types: [] };
      const r = await fetch(`/api/school-metadata/${me.schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [], exam_types: [] };
    },
    enabled: !!me?.schoolId,
  });

  const { data: teachersList = [] } = useQuery<any[]>({
    queryKey: ["/api/schools", me?.schoolId, "teachers"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch(`/api/schools/${me.schoolId}/teachers`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const today = new Date().toISOString().split("T")[0];
  const { data: dailySummary } = useQuery<{ total: number; present: number; percentage: number }>({
    queryKey: ["/api/attendance/daily-summary", me?.schoolId, today],
    queryFn: async () => {
      if (!me?.schoolId) return { total: 0, present: 0, percentage: 0 };
      const r = await fetch(`/api/attendance/daily-summary/${me.schoolId}/${today}`, { credentials: "include" });
      return r.ok ? r.json() : { total: 0, present: 0, percentage: 0 };
    },
    enabled: !!me?.schoolId,
  });

  const { data: pendingLeaves = [] } = useQuery<any[]>({
    queryKey: ["/api/leave/school", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch(`/api/leave/school/${me.schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: galleryItems = [] } = useQuery<any[]>({
    queryKey: ["/api/gallery", me?.schoolId, "all"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch(`/api/gallery/${me.schoolId}?all=true`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: pendingEbooks = [] } = useQuery<any[]>({
    queryKey: ["/api/library/books", me?.schoolId, "pending"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch(`/api/library/books/${me.schoolId}/pending`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: complaints = [] } = useQuery<any[]>({
    queryKey: ["/api/complaints/school", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch(`/api/complaints/school/${me.schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const pendingLeavesCount = (pendingLeaves as any[]).filter(l => l.status === "pending").length;
  const pendingGalleryCount = (galleryItems as any[]).filter(g => !g.approved).length;
  const openComplaintsCount = (complaints as any[]).filter(c => c.status === "open" || c.status === "in_progress").length;
  const totalActionRequired = pendingLeavesCount + pendingGalleryCount + pendingEbooks.length;

  const BADGES: Record<string, number> = {
    approvals: totalActionRequired,
    complaints: openComplaintsCount,
  };

  const logoutMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/logout"); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/me"] }); setLocation("/login"); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A1628]">
        <Loader2 className="w-8 h-8 animate-spin text-[#D4AF37]" />
      </div>
    );
  }

  const meta = {
    classes: schoolMeta?.classes ?? [],
    sections: schoolMeta?.sections ?? [],
    subjects: schoolMeta?.subjects ?? [],
    exam_types: schoolMeta?.exam_types ?? [],
  };

  const renderModule = () => {
    switch (activeModule) {
      case "school-setup": return <SchoolSetup schoolId={me.schoolId} />;
      case "student-registry": return <StudentRegistry schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} />;
      case "faculty-mapping": return <FacultyMapping schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} />;
      case "approval-center": return <ApprovalCenter schoolId={me.schoolId} />;
      case "audit-logs": return <AuditLogsModule schoolId={me.schoolId} />;
      case "visitor-log": return <VisitorLogModule schoolId={me.schoolId} />;
      case "attendance": return <AttendanceOverview schoolId={me.schoolId} onViewStudent={() => setActiveModule("student-registry")} />;
      case "analytics": return <PerformanceAnalytics schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} examTypes={meta.exam_types} />;
      case "exam-controller": return <ExamController schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} examTypes={meta.exam_types} />;
      case "complaint-hub": return <ComplaintHub schoolId={me.schoolId} />;
      case "noticeboard": return <NoticeboardAdmin schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} />;
      case "timetable": return <TimetableMaster schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} />;
      case "id-card-gen": return <IdCardGen schoolId={me.schoolId} schoolName={me.schoolName} classes={meta.classes} sections={meta.sections} />;
      case "assets": return <AssetsInventory schoolId={me.schoolId} />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#0A1628] text-white flex flex-col">
      {/* ===== TOP NAVBAR ===== */}
      <header className="border-b border-white/10 bg-[#0F1E35] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {activeModule !== "grid" && (
              <button onClick={() => setActiveModule("grid")}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors mr-1" data-testid="button-back-to-grid">
                <ChevronLeft className="w-5 h-5 text-white/70" />
              </button>
            )}
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#D4AF37] to-[#B8962E] flex items-center justify-center shadow-lg">
              <GraduationCap className="w-5 h-5 text-[#0A1628]" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight" data-testid="text-dashboard-title">BENIUS</h1>
              <p className="text-[10px] text-white/40 leading-none" data-testid="text-school-name">{me.schoolName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-white/40" data-testid="text-user-email">{me.email}</span>
            <Button variant="ghost" size="sm" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}
              className="text-white/60 hover:text-white hover:bg-white/10" data-testid="button-logout">
              <LogOut className="w-4 h-4 mr-1" /> Logout
            </Button>
          </div>
        </div>
      </header>

      {/* ===== LIVE PULSE HEADER ===== */}
      <div className="border-b border-white/5 bg-[#0F1E35]/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex flex-wrap items-center gap-4 sm:gap-8">
            <div className="flex items-center gap-2" data-testid="stat-students">
              <GraduationCap className="w-4 h-4 text-[#D4AF37]" />
              <div>
                <p className="text-[10px] text-white/40 leading-none">Total Students</p>
                <p className="text-base font-bold text-white">{me.studentCount.toLocaleString()}</p>
              </div>
            </div>
            <div className="w-px h-8 bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-2" data-testid="stat-teachers">
              <Users className="w-4 h-4 text-blue-400" />
              <div>
                <p className="text-[10px] text-white/40 leading-none">Faculty Strength</p>
                <p className="text-base font-bold text-white">{teachersList.length}</p>
              </div>
            </div>
            <div className="w-px h-8 bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-2" data-testid="stat-attendance">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <div>
                <p className="text-[10px] text-white/40 leading-none">Daily Presence</p>
                <p className="text-base font-bold text-white">
                  {dailySummary?.total ? `${dailySummary.percentage}%` : "—"}
                </p>
              </div>
            </div>
            <div className="w-px h-8 bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveModule("approval-center")} data-testid="stat-action-required">
              <AlertTriangle className={`w-4 h-4 ${totalActionRequired > 0 ? "text-red-400" : "text-white/30"}`} />
              <div>
                <p className="text-[10px] text-white/40 leading-none">Action Required</p>
                <p className={`text-base font-bold ${totalActionRequired > 0 ? "text-red-400" : "text-white"}`}>{totalActionRequired}</p>
              </div>
            </div>
            <div className="ml-auto text-right hidden sm:block">
              <p className="text-[10px] text-white/40 leading-none">Today</p>
              <p className="text-sm font-medium text-white/70">{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {activeModule === "grid" ? (
          <div className="space-y-8">
            {GROUP_ORDER.map(group => {
              const groupTiles = TILES.filter(t => t.group === group);
              return (
                <div key={group}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full border ${GROUP_COLORS[group]}`}>
                      {group}
                    </span>
                    <div className="flex-1 h-px bg-white/5" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {groupTiles.map(tile => {
                      const badge = tile.badgeKey ? BADGES[tile.badgeKey] : undefined;
                      return (
                        <button
                          key={tile.id}
                          onClick={() => setActiveModule(tile.id)}
                          data-testid={`tile-${tile.id}`}
                          className="group relative text-left rounded-xl border border-white/10 bg-[#1A2942] p-5 hover:bg-[#1E3350] hover:border-[#D4AF37]/40 transition-all duration-200 hover:shadow-lg hover:shadow-[#D4AF37]/5"
                        >
                          {badge !== undefined && badge > 0 && (
                            <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center" data-testid={`badge-${tile.id}`}>
                              {badge > 9 ? "9+" : badge}
                            </span>
                          )}
                          <div className="flex items-start gap-3 mb-3">
                            <div className="p-2.5 rounded-lg bg-[#D4AF37]/15 group-hover:bg-[#D4AF37]/25 transition-colors shrink-0">
                              <tile.icon className="w-5 h-5 text-[#D4AF37]" />
                            </div>
                          </div>
                          <h3 className="font-semibold text-white text-sm leading-tight mb-1 group-hover:text-[#D4AF37] transition-colors">{tile.label}</h3>
                          <p className="text-white/40 text-xs leading-relaxed">{tile.desc}</p>
                          <div className="mt-3 flex items-center gap-1 text-[#D4AF37]/50 text-xs group-hover:text-[#D4AF37] transition-colors">
                            <span>Open</span>
                            <ArrowRight className="w-3 h-3" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            <div className="mb-6 flex items-center gap-2">
              <button onClick={() => setActiveModule("grid")}
                className="text-white/40 hover:text-white text-sm flex items-center gap-1 transition-colors" data-testid="breadcrumb-back">
                <ChevronLeft className="w-4 h-4" /> Dashboard
              </button>
              <span className="text-white/20">/</span>
              <span className="text-white/70 text-sm">{TILES.find(t => t.id === activeModule)?.label ?? activeModule}</span>
            </div>
            {renderModule()}
          </div>
        )}
      </main>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-white/5 py-4 text-center">
        <p className="text-white/20 text-xs">BENIUS School Management Platform · {me.schoolName} · School Code: <span className="font-mono text-[#D4AF37]/50">{me.schoolCode}</span></p>
      </footer>
    </div>
  );
}
