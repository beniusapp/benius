import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  GraduationCap,
  Loader2,
  LogOut,
  User,
  CalendarCheck,
  BookOpen,
  PenLine,
  CreditCard,
  ClipboardList,
  MessageSquareWarning,
  Image,
  Users,
  CalendarDays,
  FileText,
  Clock,
  Bell,
} from "lucide-react";
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

const TILES = [
  { id: "profile",          label: "Profile",          Icon: User },
  { id: "attendance",       label: "Attendance",       Icon: CalendarCheck },
  { id: "homework",         label: "Homework",         Icon: BookOpen },
  { id: "classwork",        label: "Classwork",        Icon: PenLine },
  { id: "noticeboard",      label: "Noticeboard",      Icon: Bell },
  { id: "fees",             label: "Fees",             Icon: CreditCard },
  { id: "examination",      label: "Examination",      Icon: ClipboardList },
  { id: "complaints",       label: "Complaints",       Icon: MessageSquareWarning },
  { id: "gallery",          label: "Gallery",          Icon: Image },
  { id: "faculty-info",     label: "Faculty Info",     Icon: Users },
  { id: "school-calendar",  label: "School Calendar",  Icon: CalendarDays },
  { id: "leave",            label: "Leave",            Icon: FileText },
  { id: "timetable",        label: "Timetable",        Icon: Clock },
];

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

  const unreadNoticeCount = unreadData?.count ?? 0;

  useEffect(() => {
    if (!isLoading && (isError || !student || !student.schoolId)) {
      setLocation("/student-login");
    }
  }, [isLoading, isError, student, setLocation]);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/student-logout");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student-me"] });
      setLocation("/student-login");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  const initials = student.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-[#f0fdf4]">

      {/* ── Sticky top nav ── */}
      <header className="sticky top-0 z-30 bg-[#10b981] shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/20">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-white font-bold text-base sm:text-lg tracking-tight" data-testid="text-app-title">
                BENIUS
              </p>
              <p className="text-emerald-100 text-xs">Student Portal</p>
            </div>
          </div>

          <button
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 active:bg-white/40 text-white text-sm font-medium transition-colors disabled:opacity-60"
            data-testid="button-student-logout"
          >
            {logoutMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <LogOut className="w-4 h-4" />}
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">

        {/* ── Profile Summary Card ── */}
        <div
          className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-4 sm:p-6 flex flex-col sm:flex-row items-center sm:items-start gap-4"
          data-testid="card-student-profile"
        >
          {/* Avatar */}
          <div
            className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#10b981] flex items-center justify-center shadow-md"
            data-testid="avatar-student"
          >
            <span className="text-white font-bold text-xl sm:text-2xl select-none">{initials}</span>
          </div>

          {/* Info */}
          <div className="flex-1 text-center sm:text-left space-y-1 min-w-0">
            <h2
              className="text-lg sm:text-xl font-bold text-gray-900 truncate"
              data-testid="text-student-name"
            >
              {student.name}
            </h2>
            <p className="text-sm text-gray-500" data-testid="text-school-name">{student.schoolName}</p>
            <div className="flex flex-wrap justify-center sm:justify-start gap-2 pt-1">
              <span
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[#10b981] text-xs font-semibold"
                data-testid="text-student-dsid"
              >
                DSID: {student.digitalStudentId}
              </span>
              <span
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[#10b981] text-xs font-semibold"
                data-testid="text-student-class"
              >
                Class {student.class} – {student.section}
              </span>
            </div>
          </div>

          {/* School badge (desktop) */}
          <div className="hidden sm:flex flex-col items-end gap-1 flex-shrink-0">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-[#10b981]/10">
              <GraduationCap className="w-6 h-6 text-[#10b981]" />
            </div>
            <p className="text-xs text-gray-400 font-mono">{student.schoolCode}</p>
          </div>
        </div>

        {/* ── Section heading ── */}
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-gray-700 mb-1">My Modules</h3>
          <p className="text-xs sm:text-sm text-gray-400">Tap a card to access your module</p>
        </div>

        {/* ── 12-Tile grid ── */}
        {/*
          Breakpoints:
            Mobile  < 768px  → 2 columns  (grid-cols-2)
            Tablet  768–1023px → 3 columns (md:grid-cols-3)
            Desktop ≥ 1024px → 4 columns  (lg:grid-cols-4)
        */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
          {TILES.map(({ id, label, Icon }) => (
            <button
              key={id}
              data-testid={`tile-${id}`}
              className="
                group relative bg-white rounded-2xl border border-emerald-50
                p-4 sm:p-5 lg:p-6
                flex flex-col items-center justify-center gap-3
                min-h-[110px] sm:min-h-[130px] lg:min-h-[140px]
                cursor-pointer select-none
                shadow-sm hover:shadow-lg active:shadow-md
                hover:-translate-y-1 active:translate-y-0
                transition-all duration-200 ease-out
                focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:ring-offset-2
              "
              onClick={() => {
                if (id === "profile") {
                  setLocation("/student-profile");
                  return;
                }
                if (id === "attendance") {
                  setLocation("/student/attendance");
                  return;
                }
                if (id === "homework") {
                  setLocation("/student/homework");
                  return;
                }
                if (id === "classwork") {
                  setLocation("/student/classwork");
                  return;
                }
                if (id === "examination") {
                  setLocation("/student/examination");
                  return;
                }
                if (id === "complaints") {
                  setLocation("/student/complaints");
                  return;
                }
                if (id === "gallery") {
                  setLocation("/student/gallery");
                  return;
                }
                if (id === "faculty-info") {
                  setLocation("/student/faculty");
                  return;
                }
                if (id === "school-calendar") {
                  setLocation("/student/calendar");
                  return;
                }
                if (id === "timetable") {
                  setLocation("/student/timetable");
                  return;
                }
                if (id === "leave") {
                  setLocation("/student/leave");
                  return;
                }
                if (id === "noticeboard") {
                  setLocation("/student/noticeboard");
                  return;
                }
                toast({
                  title: label,
                  description: `${label} module coming soon.`,
                });
              }}
            >
              {/* Icon container with optional red dot */}
              <div className="relative">
                <div className="
                  flex items-center justify-center
                  w-12 h-12 sm:w-14 sm:h-14
                  rounded-xl bg-emerald-50
                  group-hover:bg-[#10b981]/15
                  transition-colors duration-200
                ">
                  <Icon className="w-6 h-6 sm:w-7 sm:h-7 text-[#10b981]" strokeWidth={1.75} />
                </div>
                {id === "noticeboard" && unreadNoticeCount > 0 && (
                  <span
                    className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-[#FF0000] border border-white"
                    data-testid="badge-noticeboard-unread"
                    aria-label={`${unreadNoticeCount} unread notices`}
                  />
                )}
              </div>

              {/* Label */}
              <span className="
                text-gray-800 font-semibold
                text-xs sm:text-sm
                text-center leading-tight
              ">
                {label}
              </span>

              {/* Subtle emerald glow on hover (desktop only) */}
              <span className="
                absolute inset-0 rounded-2xl opacity-0
                group-hover:opacity-100 transition-opacity duration-200
                ring-1 ring-inset ring-[#10b981]/20
                pointer-events-none
              " />
            </button>
          ))}
        </div>

        {/* ── Footer ── */}
        <p className="text-center text-xs text-gray-400 pb-4">
          © {new Date().getFullYear()} BENIUS · {student.schoolName}
        </p>
      </main>
    </div>
  );
}
