import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  GraduationCap, Loader2, LogOut, User, ClipboardCheck, BookOpen, PenTool,
  Bell, AlertTriangle, FileText, Image, Users, Calendar, BookMarked,
  CalendarOff, Clock, ArrowLeft, ClipboardList,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";

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

type TeacherModule = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  hasBadge?: boolean;
  hasPendingBadge?: boolean;
};

const modules: TeacherModule[] = [
  { key: "profile", label: "Teacher Profile", icon: User, color: "bg-blue-500" },
  { key: "attendance", label: "Attendance", icon: ClipboardCheck, color: "bg-green-500", hasBadge: true },
  { key: "homework", label: "Homework", icon: BookOpen, color: "bg-purple-500" },
  { key: "classwork", label: "Classwork", icon: PenTool, color: "bg-indigo-500" },
  { key: "noticeboard", label: "Noticeboard", icon: Bell, color: "bg-yellow-500" },
  { key: "complaint", label: "Complaint", icon: AlertTriangle, color: "bg-red-500" },
  { key: "examination", label: "Examination", icon: FileText, color: "bg-teal-500" },
  { key: "gallery", label: "Gallery", icon: Image, color: "bg-pink-500" },
  { key: "faculty-info", label: "Faculty Info", icon: Users, color: "bg-cyan-500" },
  { key: "calendar", label: "School Calendar", icon: Calendar, color: "bg-orange-500" },
  { key: "library", label: "Library", icon: BookMarked, color: "bg-emerald-500" },
  { key: "leave", label: "Leave", icon: CalendarOff, color: "bg-rose-500" },
  { key: "timetable", label: "Timetable", icon: Clock, color: "bg-violet-500" },
  { key: "student-profiles", label: "Approval Center", icon: ClipboardList, color: "bg-amber-600", hasPendingBadge: true },
];

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

export default function TeacherDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [matched, params] = useRoute("/teacher-dashboard/:module");
  const activeModule = matched ? params?.module : null;

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
      queryClient.invalidateQueries({ queryKey: ["/api/teacher-me"] });
      setLocation("/teacher-login");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading || !teacher) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const ActiveComponent = activeModule ? moduleComponents[activeModule] : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {activeModule && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation("/teacher-dashboard")}
                data-testid="button-back"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
            )}
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
              <GraduationCap className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight" data-testid="text-dashboard-title">BENIUS</h1>
              <p className="text-xs text-muted-foreground">{teacher.schoolName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              {/* Avatar — updates instantly when photo is changed */}
              {teacher.profileImageUrl ? (
                <img
                  src={teacher.profileImageUrl}
                  alt={teacher.fullName}
                  className="w-9 h-9 rounded-full object-cover border-2 border-[#10b981]/50 flex-shrink-0"
                  data-testid="img-navbar-avatar"
                />
              ) : (
                <div
                  className="w-9 h-9 rounded-full bg-gradient-to-br from-[#10b981]/30 to-emerald-700/40 border-2 border-[#10b981]/40 flex items-center justify-center flex-shrink-0"
                  data-testid="div-navbar-initials"
                >
                  <span className="text-xs font-bold text-[#10b981]">
                    {teacher.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium" data-testid="text-teacher-name">{teacher.fullName}</p>
                <p className="text-xs text-muted-foreground">{teacher.subject}</p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              data-testid="button-logout"
            >
              <LogOut className="w-3.5 h-3.5 mr-1" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {ActiveComponent ? (
          <ActiveComponent teacher={teacher} />
        ) : (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold tracking-tight" data-testid="text-welcome">
                Welcome, {teacher.fullName}
              </h2>
              {teacher.mappings && teacher.mappings.length > 0 ? (
                <p className="text-muted-foreground mt-1 text-sm" data-testid="text-assigned-summary">
                  Assigned to:{" "}
                  {teacher.mappings.map((m, i) => (
                    <span key={i}>
                      {i > 0 && " · "}
                      <span className="font-medium text-foreground">
                        {m.className}{m.section}
                      </span>
                      {m.subject && <span className="text-muted-foreground"> – {m.subject}</span>}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="text-muted-foreground mt-1" data-testid="text-assigned-summary">
                  Class {teacher.assignedClass}-{teacher.assignedSection} | {teacher.subject}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {modules.map((mod) => {
                const Icon = mod.icon;
                return (
                  <Card
                    key={mod.key}
                    className="cursor-pointer hover:shadow-md transition-shadow relative group"
                    onClick={() => setLocation(`/teacher-dashboard/${mod.key}`)}
                    data-testid={`card-module-${mod.key}`}
                  >
                    <CardContent className="pt-6 pb-4 flex flex-col items-center text-center gap-3">
                      <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${mod.color} text-white`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-medium leading-tight">{mod.label}</span>
                      {mod.hasBadge && (
                        <span
                          className={`absolute top-2 right-2 w-3 h-3 rounded-full ${teacher.attendanceDoneToday ? "bg-green-500" : "bg-red-500"}`}
                          title={teacher.attendanceDoneToday ? "Attendance marked today" : "Attendance pending"}
                          data-testid="badge-attendance-status"
                        />
                      )}
                      {mod.hasPendingBadge && pendingProfilesCount > 0 && (
                        <span
                          className="absolute top-2 right-2 min-w-[20px] h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shadow"
                          title={`${pendingProfilesCount} pending profile${pendingProfilesCount !== 1 ? "s" : ""}`}
                          data-testid="badge-pending-profiles"
                        >
                          {pendingProfilesCount}
                        </span>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
