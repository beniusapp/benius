import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fmtDate } from "@/lib/dateUtils";
import {
  ArrowLeft, FileText, PlusCircle, X, Loader2, Clock, CheckCircle2, XCircle, Forward,
  CalendarDays, Trash2,
} from "lucide-react";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");

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
      await apiRequest("POST", "/api/student/leave", {
        startDate,
        endDate,
        reason,
        category: category || undefined,
        attachmentUrl: attachmentUrl.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Leave Applied", description: "Your request has been submitted to your class teacher." });
      setDrawerOpen(false);
      setCategory("");
      setStartDate("");
      setEndDate("");
      setReason("");
      setAttachmentUrl("");
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
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fdf4] flex flex-col">

      {/* ── Header ── */}
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
            <p className="text-white font-bold text-sm leading-tight">Leave Hub</p>
            <p className="text-emerald-100 text-xs">Class {student.class} – {student.section}</p>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 h-10 rounded-xl bg-white/20 hover:bg-white/30 text-white text-sm font-semibold transition-colors"
            data-testid="button-apply-leave"
          >
            <PlusCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Apply</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 space-y-4">

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

        {/* ── Mobile Apply Button ── */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="sm:hidden w-full h-12 rounded-2xl bg-[#10b981] hover:bg-[#059669] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-colors"
          data-testid="button-apply-leave-mobile"
        >
          <PlusCircle className="w-5 h-5" />
          Apply for Leave
        </button>

        {/* ── Leave History ── */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-600 px-1">Leave History</p>

          {leavesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-2xl border border-emerald-50 shadow-sm p-4 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : leaves.length === 0 ? (
            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-8 flex flex-col items-center text-center gap-3">
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
                  className="bg-white rounded-2xl border border-emerald-50 shadow-sm p-4"
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
                      {leave.status === "pending" && (
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
      </main>

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

            {/* Form */}
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

              {/* Attachment URL */}
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Attachment URL (optional)</label>
                <input
                  type="url"
                  value={attachmentUrl}
                  onChange={e => setAttachmentUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full h-11 px-3 rounded-xl border border-emerald-100 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  data-testid="input-leave-attachment"
                />
              </div>
            </div>

            {/* Submit */}
            <div className="px-5 pb-6 pt-3 border-t border-emerald-50">
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
                {submitMutation.isPending ? "Submitting..." : "Submit Leave Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
