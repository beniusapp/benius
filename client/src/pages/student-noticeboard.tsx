import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { fmtDate } from "@/lib/dateUtils";
import {
  ArrowLeft, Bell, Loader2, Megaphone, BookOpen, AlertTriangle, Info, FileText, X, ExternalLink,
} from "lucide-react";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";
import { SessionArchiveBanner } from "@/components/session-archive-banner";

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
  creatorName: string | null;
  targetType: string;
  targetClass: string | null;
  targetSection: string | null;
  fileUrl: string | null;
  createdAt: string;
  isRead: boolean;
}

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Megaphone; color: string; bg: string; accent: string }> = {
  Urgent:   { label: "Urgent",   icon: AlertTriangle, color: "text-red-600",    bg: "bg-red-50 border-red-200",    accent: "#ef4444" },
  Academic: { label: "Academic", icon: BookOpen,      color: "text-blue-600",   bg: "bg-blue-50 border-blue-200",  accent: "#3b82f6" },
  Event:    { label: "Event",    icon: Megaphone,     color: "text-purple-600", bg: "bg-purple-50 border-purple-200", accent: "#8b5cf6" },
  Routine:  { label: "Routine",  icon: Info,          color: "text-gray-500",   bg: "bg-gray-50 border-gray-200",  accent: "#6b7280" },
  Holiday:  { label: "Holiday",  icon: Bell,          color: "text-green-600",  bg: "bg-green-50 border-green-200", accent: "#10b981" },
  Exam:     { label: "Exam",     icon: BookOpen,      color: "text-blue-700",   bg: "bg-blue-50 border-blue-200",  accent: "#1d4ed8" },
};

function getTypeConfig(t: string | null) {
  if (!t) return TYPE_CONFIG["Routine"];
  return TYPE_CONFIG[t] || TYPE_CONFIG["Routine"];
}

function formatSender(role: string, creatorName?: string | null): string {
  if (!role) return "Notice";
  if (role === "admin") return "From Principal";
  if (role === "teacher") return creatorName ? `From ${creatorName}` : "From Teacher";
  return `From ${role.charAt(0).toUpperCase() + role.slice(1)}`;
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url);
}

export default function StudentNoticeboard() {
  const [, setLocation] = useLocation();
  const { isArchiveMode, selectedSession } = useSessionView();
  const [selectedNotice, setSelectedNotice] = useState<StudentNotice | null>(null);

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
      queryClient.setQueryData<StudentNotice[]>(["/api/student/notices"], (old) =>
        old ? old.map(n => (ids as number[]).includes(n.id) ? { ...n, isRead: true } : n) : old
      );
      queryClient.setQueryData<{ count: number }>(["/api/student/notices/unread-count"], (old) => {
        if (!old) return old;
        const readIds = ids as number[];
        const currentNotices = queryClient.getQueryData<StudentNotice[]>(["/api/student/notices"]) ?? [];
        const stillUnread = currentNotices.filter(n => !n.isRead && !readIds.includes(n.id)).length;
        return { count: Math.max(0, stillUnread) };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/student/notices/unread-count"] });
    },
  });

  const openNotice = (notice: StudentNotice) => {
    setSelectedNotice(notice);
    // Don't mark-read in archive mode — the mutation would be blocked server-side
    // anyway (403) but we skip it to avoid a noisy error toast.
    if (!notice.isRead && !isArchiveMode) {
      markReadMutation.mutate([notice.id]);
    }
  };

  const closeNotice = () => setSelectedNotice(null);

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  const unreadCount = notices.filter(n => !n.isRead).length;

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: "#f8fafc" }}>

      {/* Decorative blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", top: "38%", left: "28%", width: "360px", height: "360px", borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 65%)" }} />
      </div>

      <header
        className="sticky top-0 z-30"
        style={{
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          background: "rgba(255, 255, 255, 0.75)",
          borderBottom: "1px solid rgba(255,255,255,0.7)",
          boxShadow: "0 1px 28px rgba(0,0,0,0.07)",
        }}
      >
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-10 h-10 rounded-xl transition-colors flex-shrink-0"
            style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0" style={{ background: "linear-gradient(135deg, #ef4444, #f97316)" }}>
              <Bell className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="font-bold text-sm text-slate-800">Noticeboard</p>
              <p className="text-[11px] text-slate-400 truncate">Class {student.class} – {student.section}</p>
            </div>
            {unreadCount > 0 && (
              <span className="ml-1 text-[10px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full" data-testid="badge-header-unread">
                {unreadCount} new
              </span>
            )}
          </div>
        </div>
      </header>

      <motion.main
        className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 space-y-3"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        {/* ── Archive mode banner ── */}
        {isArchiveMode && selectedSession && (
          <SessionArchiveBanner sessionName={selectedSession.sessionName} />
        )}

        {noticesLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-2xl p-4 bg-white/80 border border-white/70 shadow-sm animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
                <div className="h-3 bg-gray-100 rounded w-full mb-2" />
                <div className="h-3 bg-gray-100 rounded w-3/4" />
              </div>
            ))}
          </div>
        ) : notices.length === 0 ? (
          <div className="rounded-2xl p-10 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center text-center gap-3">
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
              <motion.button
                key={notice.id}
                onClick={() => openNotice(notice)}
                whileTap={{ scale: 0.985 }}
                className={`w-full text-left bg-white rounded-2xl shadow-sm p-4 transition-all border active:shadow-md ${
                  !notice.isRead
                    ? "border-l-4 border-l-[#FF0000] border-emerald-50"
                    : "border-emerald-50 hover:border-emerald-100"
                }`}
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
                        {formatSender(notice.creatorRole, notice.creatorName)}
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
                    <p className="text-sm font-bold text-black leading-relaxed line-clamp-2">{notice.content}</p>
                    {notice.fileUrl && (
                      <span className="inline-flex items-center gap-1 mt-2 text-xs text-[#10b981] font-medium">
                        <FileText className="w-3 h-3" />
                        Attachment
                      </span>
                    )}
                    <p className="text-[10px] text-gray-300 mt-2" data-testid={`text-date-${notice.id}`}>
                      {fmtDate(notice.createdAt)} · Tap to read
                    </p>
                  </div>
                </div>
              </motion.button>
            );
          })
        )}
      </motion.main>

      {/* ── Notice Detail Bottom Sheet ── */}
      <AnimatePresence>
        {selectedNotice && (() => {
          const cfg = getTypeConfig(selectedNotice.noticeType);
          const Icon = cfg.icon;
          const isImg = selectedNotice.fileUrl ? isImageUrl(selectedNotice.fileUrl) : false;
          return (
            <>
              {/* Backdrop */}
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/40"
                style={{ backdropFilter: "blur(3px)" }}
                onClick={closeNotice}
                data-testid="backdrop-notice-detail"
              />

              {/* Sheet */}
              <motion.div
                key="sheet"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 28, stiffness: 300 }}
                className="fixed bottom-0 left-0 right-0 z-50 max-w-2xl mx-auto"
                data-testid="sheet-notice-detail"
              >
                <div
                  className="rounded-t-3xl overflow-hidden"
                  style={{
                    background: "#fff",
                    boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
                    maxHeight: "88vh",
                    overflowY: "auto",
                  }}
                >
                  {/* Drag handle */}
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 rounded-full bg-gray-200" />
                  </div>

                  {/* Sheet header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <div className={`flex items-center justify-center w-8 h-8 rounded-xl border ${cfg.bg}`}>
                        <Icon className={`w-4 h-4 ${cfg.color}`} strokeWidth={1.75} />
                      </div>
                      <div>
                        <p className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</p>
                        <p className="text-[11px] text-gray-400">{formatSender(selectedNotice.creatorRole, selectedNotice.creatorName)}</p>
                      </div>
                    </div>
                    <button
                      onClick={closeNotice}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
                      data-testid="button-close-notice-detail"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>

                  {/* Sheet body */}
                  <div className="px-5 py-4 space-y-4">
                    {/* Meta row */}
                    <div className="flex items-center gap-2 text-[11px] text-gray-400 flex-wrap">
                      <span>{fmtDate(selectedNotice.createdAt)}</span>
                      {selectedNotice.targetType === "whole_school" && (
                        <>
                          <span>·</span>
                          <span>School-wide</span>
                        </>
                      )}
                      {selectedNotice.targetClass && selectedNotice.targetType !== "whole_school" && (
                        <>
                          <span>·</span>
                          <span>
                            Class {selectedNotice.targetClass}
                            {selectedNotice.targetSection ? ` – ${selectedNotice.targetSection}` : " (All Sections)"}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Full notice content */}
                    <div
                      className="rounded-2xl p-4"
                      style={{ background: "#f8fafc", border: `1px solid ${cfg.accent}22` }}
                    >
                      <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap" data-testid="text-notice-full-content">
                        {selectedNotice.content}
                      </p>
                    </div>

                    {/* Attachment */}
                    {selectedNotice.fileUrl && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Attachment</p>
                        {isImg ? (
                          <a
                            href={selectedNotice.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded-xl overflow-hidden border border-gray-100"
                            data-testid="link-notice-detail-image"
                          >
                            <img
                              src={selectedNotice.fileUrl}
                              alt="Notice attachment"
                              className="w-full max-h-64 object-cover"
                            />
                            <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50">
                              <ExternalLink className="w-3 h-3 text-gray-400" />
                              <span className="text-xs text-gray-500">Tap image to open full size</span>
                            </div>
                          </a>
                        ) : (
                          <a
                            href={selectedNotice.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 rounded-xl border border-emerald-100 bg-emerald-50/50 hover:bg-emerald-50 transition-colors"
                            data-testid="link-notice-detail-file"
                          >
                            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                              <FileText className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-emerald-700">View Attachment</p>
                              <p className="text-xs text-emerald-500">Opens in new tab</p>
                            </div>
                            <ExternalLink className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          </a>
                        )}
                      </div>
                    )}

                    {/* Bottom padding for safe area */}
                    <div className="h-4" />
                  </div>
                </div>
              </motion.div>
            </>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
