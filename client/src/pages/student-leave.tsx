import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { fmtDate } from "@/lib/dateUtils";
import {
  ArrowLeft, FileText, PlusCircle, X, Loader2, Clock, CheckCircle2, XCircle, Forward,
  CalendarDays, Trash2, Lock, Upload, Paperclip,
} from "lucide-react";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSessionView } from "@/contexts/session-view-context";

interface StudentMe {
  id: number;
  name: string;
  class: string;
  section: string;
  schoolName: string;
  phone: string;
}

interface StudentLeaveRequest {
  id: number;
  studentId: number;
  schoolId: number;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  category: string | null;
  attachmentUrl: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

const LEAVE_CATEGORIES = [
  "Medical Leave",
  "Family Emergency",
  "Personal Reasons",
  "Academic Event",
  "Sports / Co-curricular",
  "Other",
];

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  pending: { icon: Clock, color: "text-amber-500 bg-amber-50 border-amber-200", label: "Pending" },
  approved: { icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50 border-emerald-200", label: "Approved" },
  rejected: { icon: XCircle, color: "text-red-500 bg-red-50 border-red-200", label: "Rejected" },
  forwarded: { icon: Forward, color: "text-blue-500 bg-blue-50 border-blue-200", label: "Sent to Principal" },
};


function daysBetween(start: string, end: string): number {
  const s = new Date(start), e = new Date(end);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}

export default function StudentLeave() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { isArchiveMode } = useSessionView();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const { data: leaves = [], isLoading: leavesLoading } = useQuery<StudentLeaveRequest[]>({
    queryKey: ["/api/student/leave"],
    enabled: !!student,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      // Single atomic FormData request — file + fields in one POST, no two-step race
      const fd = new FormData();
      fd.append("startDate", startDate);
      fd.append("endDate", endDate);
      fd.append("reason", reason);
      if (category) fd.append("category", category);
      if (attachmentFile) fd.append("file", attachmentFile);
      const res = await fetch("/api/student/leave", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Submission failed");
      }
    },
    onSuccess: () => {
      toast({ title: "Leave Applied", description: "Your request has been submitted to your class teacher." });
      setDrawerOpen(false);
      setCategory("");
      setStartDate("");
      setEndDate("");
      setReason("");
      setAttachmentFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/student/leave"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteLeaveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/student/leave/${id}`, undefined);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Failed to delete");
      }
    },
    onSuccess: () => {
      toast({ title: "Leave application deleted", description: "Your balance has been restored." });
      queryClient.invalidateQueries({ queryKey: ["/api/student/leave"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const totalLeaves = leaves.length;
  const pendingCount = leaves.filter(l => l.status === "pending").length;
  const approvedCount = leaves.filter(l => l.status === "approved").length;
  const rejectedCount = leaves.filter(l => l.status === "rejected").length;

  const canSubmit = startDate && endDate && reason.trim() && startDate <= endDate;

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: "#f8fafc" }}>

      {/* ── Decorative blobs ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", top: "38%", left: "28%", width: "360px", height: "360px", borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 65%)" }} />
      </div>

      {/* ── Header ── */}
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
            <div className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0" style={{ background: "linear-gradient(135deg, #a78bfa, #6366f1)" }}>
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="font-bold text-sm text-slate-800">Leave Hub</p>
              <p className="text-[11px] text-slate-400 truncate">Class {student.class} – {student.section}</p>
            </div>
          </div>
          <button
            onClick={() => !isArchiveMode && setDrawerOpen(true)}
            disabled={isArchiveMode}
            className={`flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 ${
              isArchiveMode ? "opacity-40 pointer-events-none cursor-not-allowed" : ""
            }`}
            style={{ background: "linear-gradient(135deg, #10b981, #3b82f6)", color: "#fff" }}
            data-testid="button-apply-leave"
            title={isArchiveMode ? "Leave applications are locked in Archive Mode" : "Apply for Leave"}
          >
            {isArchiveMode ? <Lock className="w-4 h-4" /> : <PlusCircle className="w-4 h-4" />}
            <span className="hidden sm:inline">{isArchiveMode ? "Locked" : "Apply"}</span>
          </button>
        </div>
      </header>

      <motion.main
        className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 space-y-4"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", val: totalLeaves, color: "bg-gray-50 border-gray-200 text-gray-700" },
            { label: "Pending", val: pendingCount, color: "bg-amber-50 border-amber-200 text-amber-700" },
            { label: "Approved", val: approvedCount, color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
            { label: "Rejected", val: rejectedCount, color: "bg-red-50 border-red-200 text-red-600" },
          ].map(card => (
            <div key={card.label} className={`rounded-2xl border shadow-sm p-4 ${card.color}`} data-testid={`card-summary-${card.label.toLowerCase()}`}>
              <p className="text-2xl font-bold">{leavesLoading ? "—" : card.val}</p>
              <p className="text-xs font-semibold mt-0.5">{card.label}</p>
            </div>
          ))}
        </div>

        {/* ── Archive Mode Banner ── */}
        {isArchiveMode && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "#fefce8", border: "1.5px solid #fde68a" }}
            data-testid="banner-archive-leave"
          >
            <Lock className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-xs font-semibold text-amber-800">
              Archive Mode — Read Only. Switch to the active session to apply for leave or delete requests.
            </p>
          </div>
        )}

        {/* ── Mobile Apply Button ── */}
        <button
          onClick={() => !isArchiveMode && setDrawerOpen(true)}
          disabled={isArchiveMode}
          className={`sm:hidden w-full h-12 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-colors ${
            isArchiveMode
              ? "bg-gray-300 opacity-40 pointer-events-none cursor-not-allowed"
              : "bg-[#10b981] hover:bg-[#059669]"
          }`}
          data-testid="button-apply-leave-mobile"
        >
          {isArchiveMode ? <Lock className="w-5 h-5" /> : <PlusCircle className="w-5 h-5" />}
          {isArchiveMode ? "Locked in Archive Mode" : "Apply for Leave"}
        </button>

        {/* ── Leave History ── */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-600 px-1">Leave History</p>

          {leavesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-2xl p-4 bg-white/80 border border-white/70 shadow-sm animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : leaves.length === 0 ? (
            <div className="rounded-2xl p-8 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center text-center gap-3">
              <FileText className="w-12 h-12 text-emerald-200" />
              <div>
                <p className="font-bold text-gray-700">No leave requests yet</p>
                <p className="text-sm text-gray-400 mt-1">Your leave history will appear here.</p>
              </div>
            </div>
          ) : (
            leaves.map(leave => {
              const cfg = STATUS_CONFIG[leave.status] || STATUS_CONFIG.pending;
              const Icon = cfg.icon;
              const days = daysBetween(leave.startDate, leave.endDate);
              return (
                <div
                  key={leave.id}
                  className="rounded-2xl p-4 bg-white/80 border border-white/70 shadow-sm"
                  data-testid={`card-leave-${leave.id}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 text-sm truncate">
                        {leave.category || "Leave Request"}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {fmtDate(leave.startDate)}
                        {leave.startDate !== leave.endDate ? ` – ${fmtDate(leave.endDate)}` : ""}
                        {" "}· {days} day{days !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.color}`}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                      {leave.status === "pending" && !isArchiveMode && (
                        <button
                          onClick={() => deleteLeaveMutation.mutate(leave.id)}
                          disabled={deleteLeaveMutation.isPending}
                          className="flex items-center justify-center w-8 h-8 rounded-xl text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                          title="Delete pending request"
                          data-testid={`button-delete-leave-${leave.id}`}
                        >
                          {deleteLeaveMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{leave.reason}</p>
                  {leave.rejectionReason && (
                    <div className="mt-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100">
                      <p className="text-xs text-red-600"><span className="font-semibold">Rejection reason:</span> {leave.rejectionReason}</p>
                    </div>
                  )}
                  {leave.attachmentUrl && (
                    <a
                      href={leave.attachmentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-xs text-[#10b981] underline hover:no-underline"
                    >
                      View attachment
                    </a>
                  )}
                  <p className="text-[10px] text-gray-300 mt-2">
                    Submitted {new Date(leave.createdAt).toLocaleDateString("en-GB")}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </motion.main>

      {/* ── Leave Application Drawer ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center"
          style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
            data-testid="drawer-apply-leave"
          >
            {/* Drawer handle (mobile) */}
            <div className="sm:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-200" />
            </div>

            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-emerald-50">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-[#10b981]" />
                <p className="font-bold text-gray-900">Apply for Leave</p>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors"
                data-testid="button-close-drawer"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Form + Submit — single scrollable column so Submit is always reachable even when the keyboard is open */}
            <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[70vh]">
              {/* Category */}
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-emerald-100 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  data-testid="select-leave-category"
                >
                  <option value="">Select category (optional)</option>
                  {LEAVE_CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-emerald-100 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="input-leave-start-date"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1.5 block">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-emerald-100 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="input-leave-end-date"
                  />
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Reason <span className="text-red-400">*</span></label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Explain the reason for your leave request..."
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl border border-emerald-100 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent resize-none"
                  data-testid="textarea-leave-reason"
                />
              </div>

              {/* Attachment upload */}
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Attachment (optional)</label>
                {attachmentFile ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50">
                    <Paperclip className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <span className="text-xs text-emerald-800 font-medium truncate flex-1">{attachmentFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setAttachmentFile(null)}
                      className="text-gray-400 hover:text-red-500 flex-shrink-0"
                      data-testid="button-remove-attachment"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label
                    className="flex flex-col items-center justify-center gap-2 w-full py-5 rounded-xl cursor-pointer transition-colors hover:bg-emerald-50"
                    style={{ border: "2px dashed #a7f3d0" }}
                    data-testid="label-upload-attachment"
                  >
                    <Upload className="w-6 h-6 text-gray-400" />
                    <span className="text-sm font-medium text-gray-600">Click to upload image or document</span>
                    <span className="text-xs text-gray-400">JPG, PNG, PDF, DOC (Max 10MB)</span>
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      className="hidden"
                      onChange={e => setAttachmentFile(e.target.files?.[0] ?? null)}
                      data-testid="input-leave-attachment"
                    />
                  </label>
                )}
              </div>

              {/* Submit — inside the scroll so it's always reachable above the keyboard */}
              <div className="pt-2 pb-4">
                <button
                  onClick={() => submitMutation.mutate()}
                  disabled={!canSubmit || submitMutation.isPending}
                  className="w-full h-12 rounded-xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                  data-testid="button-submit-leave"
                >
                  {submitMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <FileText className="w-5 h-5" />
                  )}
                  {submitMutation.isPending
                    ? attachmentFile ? "Uploading & submitting…" : "Submitting…"
                    : "Submit Leave Request"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
