import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, Bell, Loader2, Megaphone, BookOpen, AlertTriangle, Info, FileText,
} from "lucide-react";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface StudentMe {
  id: number;
  name: string;
  class: string;
  section: string;
  schoolName: string;
}

interface StudentNotice {
  id: number;
  content: string;
  noticeType: string | null;
  creatorRole: string;
  targetType: string;
  targetClass: string | null;
  targetSection: string | null;
  fileUrl: string | null;
  createdAt: string;
  isRead: boolean;
}

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Megaphone; color: string; bg: string }> = {
  Urgent:   { label: "Urgent",   icon: AlertTriangle, color: "text-red-600",    bg: "bg-red-50 border-red-200" },
  Academic: { label: "Academic", icon: BookOpen,      color: "text-blue-600",   bg: "bg-blue-50 border-blue-200" },
  Event:    { label: "Event",    icon: Megaphone,     color: "text-purple-600", bg: "bg-purple-50 border-purple-200" },
  Routine:  { label: "Routine",  icon: Info,          color: "text-gray-500",   bg: "bg-gray-50 border-gray-200" },
};

function getTypeConfig(t: string | null) {
  if (!t) return TYPE_CONFIG["Routine"];
  return TYPE_CONFIG[t] || TYPE_CONFIG["Routine"];
}

function formatSender(role: string): string {
  if (!role) return "Notice";
  if (role === "admin") return "From Principal";
  if (role === "teacher") return "From Teacher";
  return `From ${role.charAt(0).toUpperCase() + role.slice(1)}`;
}

function formatDate(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export default function StudentNoticeboard() {
  const [, setLocation] = useLocation();

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const { data: notices = [], isLoading: noticesLoading } = useQuery<StudentNotice[]>({
    queryKey: ["/api/student/notices"],
    enabled: !!student,
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      if (ids.length === 0) return;
      await apiRequest("POST", "/api/student/notices/mark-read", { noticeIds: ids });
    },
    onSuccess: (_, ids) => {
      // Optimistically mark items as read in cache so NEW badges clear immediately
      queryClient.setQueryData<StudentNotice[]>(["/api/student/notices"], (old) =>
        old ? old.map(n => (ids as number[]).includes(n.id) ? { ...n, isRead: true } : n) : old
      );
      queryClient.invalidateQueries({ queryKey: ["/api/student/notices/unread-count"] });
    },
  });

  useEffect(() => {
    if (notices.length > 0) {
      const unreadIds = notices.filter(n => !n.isRead).map(n => n.id);
      if (unreadIds.length > 0) {
        markReadMutation.mutate(unreadIds);
      }
    }
  }, [notices]);

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fdf4] flex flex-col">

      <header className="sticky top-0 z-30 bg-[#10b981] shadow-md">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors flex-shrink-0"
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight">Noticeboard</p>
            <p className="text-emerald-100 text-xs">Class {student.class} – {student.section}</p>
          </div>
          <Bell className="w-5 h-5 text-white/70" />
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 space-y-3">

        {noticesLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl border border-emerald-50 shadow-sm p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
                <div className="h-3 bg-gray-100 rounded w-full mb-2" />
                <div className="h-3 bg-gray-100 rounded w-3/4" />
              </div>
            ))}
          </div>
        ) : notices.length === 0 ? (
          <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-10 flex flex-col items-center text-center gap-3">
            <Bell className="w-12 h-12 text-emerald-200" />
            <div>
              <p className="font-bold text-gray-700">No notices yet</p>
              <p className="text-sm text-gray-400 mt-1">New notices will appear here.</p>
            </div>
          </div>
        ) : (
          notices.map(notice => {
            const cfg = getTypeConfig(notice.noticeType);
            const Icon = cfg.icon;
            return (
              <div
                key={notice.id}
                className={`bg-white rounded-2xl shadow-sm p-4 transition-all border ${!notice.isRead ? "border-l-4 border-l-[#FF0000] border-emerald-50" : "border-emerald-50"}`}
                data-testid={`notice-card-${notice.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl border ${cfg.bg}`}>
                    <Icon className={`w-4 h-4 ${cfg.color}`} strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      <span className="text-xs text-gray-400 font-medium" data-testid={`text-sender-${notice.id}`}>
                        {formatSender(notice.creatorRole)}
                      </span>
                      {notice.targetType === "whole_school" && (
                        <span className="text-xs text-gray-300">· School-wide</span>
                      )}
                      {!notice.isRead && (
                        <span
                          className="text-[10px] font-bold text-white bg-[#FF0000] px-1.5 py-0.5 rounded-full"
                          data-testid={`badge-unread-${notice.id}`}
                        >
                          NEW
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 leading-relaxed">{notice.content}</p>
                    {notice.fileUrl && (
                      <a
                        href={notice.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs text-[#10b981] underline hover:no-underline"
                        data-testid={`link-notice-file-${notice.id}`}
                      >
                        <FileText className="w-3 h-3" />
                        View attachment
                      </a>
                    )}
                    <p className="text-[10px] text-gray-300 mt-2" data-testid={`text-date-${notice.id}`}>
                      {formatDate(notice.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
