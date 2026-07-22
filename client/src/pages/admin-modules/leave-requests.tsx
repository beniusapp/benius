import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  Check, X, UserCheck, Users, Loader2,
  CalendarOff, Eye, Paperclip, UserCircle2,
  History, CheckCircle2, XCircle, ChevronRight, ArrowLeft, CalendarDays,
} from "lucide-react";
import { fmtDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props {
  schoolId: number;
  initialSection?: string | null;
  onNavigateSection?: (sec: string | null) => void;
  allowedSubs?: string[];
}

// ── Section colour tokens ──────────────────────────────────────────────────────
const VARIANTS = {
  teacher: {
    gradient: "linear-gradient(135deg, #0ea5e9, #06b6d4)",
    glow: "rgba(14,165,233,0.25)",
    border: "rgba(14,165,233,0.20)",
    badge: "from-sky-500 to-cyan-500",
    emptyIcon: CalendarOff,
    emptyColor: "text-sky-400/50",
    emptyBg: "rgba(14,165,233,0.08)",
  },
  student: {
    gradient: "linear-gradient(135deg, #818cf8, #6366f1)",
    glow: "rgba(99,102,241,0.25)",
    border: "rgba(99,102,241,0.20)",
    badge: "from-indigo-500 to-violet-500",
    emptyIcon: Users,
    emptyColor: "text-indigo-400/50",
    emptyBg: "rgba(99,102,241,0.08)",
  },
} as const;
type Variant = keyof typeof VARIANTS;

type ActiveSection = "teacher-leave" | "student-leave" | "leave-history" | null;

// ── Glass section card ─────────────────────────────────────────────────────────
function Section({ title, icon: Icon, badge, variant, children }: {
  title: string; icon: React.ElementType; badge?: number; variant: Variant; children: React.ReactNode;
}) {
  const v = VARIANTS[variant];
  return (
    <div className="rounded-2xl p-5 transition-all duration-300"
      style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(12px)", border: `1px solid ${v.border}`, boxShadow: `0 4px 24px ${v.glow}` }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: v.gradient, boxShadow: `0 0 16px ${v.glow}` }}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <h3 className="font-bold text-white tracking-tight">{title}</h3>
        {badge !== undefined && badge > 0 && (
          <span className={`ml-auto px-2.5 py-0.5 rounded-full text-xs font-bold text-white bg-gradient-to-r ${v.badge} shadow-lg`}>{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Empty slot ─────────────────────────────────────────────────────────────────
function EmptyState({ label, variant }: { label: string; variant: Variant }) {
  const v = VARIANTS[variant];
  const EmptyIcon = v.emptyIcon;
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: v.emptyBg }}>
        <EmptyIcon className={`w-6 h-6 ${v.emptyColor}`} />
      </div>
      <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>{label}</p>
    </div>
  );
}

// ── Item row ───────────────────────────────────────────────────────────────────
function ItemRow({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div className="group flex items-center justify-between gap-3 p-3 rounded-xl transition-all duration-200 cursor-default hover:scale-[1.015]"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.20)"; (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.07)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)"; }}
      data-testid={testId}>
      {children}
    </div>
  );
}

// ── Approve / Reject buttons ───────────────────────────────────────────────────
function ActionButtons({ disabled, onApprove, onReject, approveLabel = "Approve", approveTestId, rejectTestId }: {
  disabled: boolean; onApprove: () => void; onReject: () => void;
  approveLabel?: string; approveTestId: string; rejectTestId: string;
}) {
  return (
    <div className="flex gap-2 shrink-0">
      <button disabled={disabled} onClick={onApprove} data-testid={approveTestId}
        className="flex items-center gap-1 h-7 px-3 rounded-lg text-xs font-semibold text-white transition-all duration-150 disabled:opacity-50 hover:brightness-110 active:scale-95"
        style={{ background: "linear-gradient(135deg, #16a34a, #22c55e)", boxShadow: "0 2px 10px rgba(34,197,94,0.30)" }}>
        <Check className="w-3 h-3" /> {approveLabel}
      </button>
      <button disabled={disabled} onClick={onReject} data-testid={rejectTestId}
        className="flex items-center gap-1 h-7 px-3 rounded-lg text-xs font-semibold text-red-400 transition-all duration-150 disabled:opacity-50 hover:bg-red-500/15 active:scale-95"
        style={{ border: "1px solid rgba(239,68,68,0.40)", background: "rgba(239,68,68,0.08)" }}>
        <X className="w-3 h-3" /> Reject
      </button>
    </div>
  );
}

// ── Landing tile ───────────────────────────────────────────────────────────────
function LeaveTile({ title, subtitle, icon: Icon, gradient, glow, badge, badgeColor, onClick, fullWidth }: {
  title: string; subtitle: string; icon: React.ElementType;
  gradient: string; glow: string; badge: number | null; badgeColor: string;
  onClick: () => void; fullWidth?: boolean;
}) {
  return (
    <button onClick={onClick}
      data-testid={`tile-leave-${title.toLowerCase().replace(/\s+/g, "-")}`}
      className={`${fullWidth ? "col-span-2" : ""} w-full text-left rounded-2xl p-5 flex flex-col gap-3 transition-all duration-200 hover:scale-[1.025] active:scale-[0.98]`}
      style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.10)", boxShadow: `0 4px 24px ${glow}` }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.border = "1px solid rgba(255,255,255,0.22)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 8px 32px ${glow}`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.border = "1px solid rgba(255,255,255,0.10)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 4px 24px ${glow}`; }}>
      <div className="flex items-start justify-between gap-2">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: gradient, boxShadow: `0 0 20px ${glow}` }}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {badge !== null && badge > 0 && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white flex-shrink-0"
            style={{ background: badgeColor }}>{badge} pending</span>
        )}
      </div>
      <div className="flex-1">
        <p className="font-bold text-white text-base leading-tight">{title}</p>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(255,255,255,0.50)" }}>{subtitle}</p>
      </div>
      <span className="text-xs font-semibold flex items-center gap-1 mt-1" style={{ color: "rgba(255,255,255,0.40)" }}>
        Open <ChevronRight className="w-3 h-3" />
      </span>
    </button>
  );
}

// ── Section back-header ────────────────────────────────────────────────────────
function SectionHeader({ title, icon: Icon, gradient, glow, onBack, badge }: {
  title: string; icon: React.ElementType; gradient: string; glow: string;
  onBack: () => void; badge?: number;
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <button onClick={onBack} data-testid="button-leave-back"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex-shrink-0"
        style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.12)" }}>
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: gradient, boxShadow: `0 0 16px ${glow}` }}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-white tracking-tight text-lg">{title}</h3>
      </div>
      {badge !== undefined && badge > 0 && (
        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white flex-shrink-0"
          style={{ background: gradient }}>{badge}</span>
      )}
    </div>
  );
}

// ── History helpers ────────────────────────────────────────────────────────────
function HistoryRow({ children, status }: { children: React.ReactNode; status: string }) {
  const borderColor = status === "approved" ? "rgba(34,197,94,0.30)" : "rgba(239,68,68,0.30)";
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg"
      style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${borderColor}` }}>
      {children}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const approved = status === "approved";
  return (
    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 self-start mt-0.5"
      style={{ background: approved ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", color: approved ? "#4ade80" : "#f87171", border: `1px solid ${approved ? "rgba(34,197,94,0.30)" : "rgba(239,68,68,0.30)"}` }}>
      {approved ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {approved ? "Approved" : "Rejected"}
    </span>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: "rgba(255,255,255,0.30)" }} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function LeaveRequests({ schoolId, initialSection, onNavigateSection, allowedSubs }: Props) {
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<ActiveSection>((initialSection as ActiveSection) ?? null);
  useEffect(() => { setActiveSection((initialSection as ActiveSection) ?? null); }, [initialSection]);

  const [selectedLeave, setSelectedLeave] = useState<any | null>(null);
  const [adminComment, setAdminComment] = useState("");

  const canTeacherLeave = !allowedSubs || allowedSubs.includes("teacher-leave");
  const canStudentLeave = !allowedSubs || allowedSubs.includes("student-leave");
  const canHistory      = !allowedSubs || allowedSubs.includes("leave-history");

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: leaveRequests = [], isLoading: leavesLoading } = useQuery<any[]>({
    queryKey: ["/api/leave/school", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/leave/school/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: studentLeaves = [], isLoading: sleavesLoading } = useQuery<any[]>({
    queryKey: ["/api/student-leaves/school", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/student-leaves/school/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery<any>({
    queryKey: ["/api/approval-history/leaves", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/approval-history/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : { teacherLeaves: [], studentLeaves: [] };
    },
    enabled: !!schoolId && activeSection === "leave-history",
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const leaveStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/leave/${id}/status`, { status });
    },
    onSuccess: (_, vars) => {
      toast({ title: vars.status === "approved" ? "Leave Approved" : "Leave Rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/school", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const studentLeaveApproveMutation = useMutation({
    mutationFn: async ({ id, action, comment }: { id: number; action: "admin-approve" | "reject"; comment?: string }) => {
      await apiRequest("PATCH", `/api/student-leaves/${id}/${action}`, { adminComment: comment || undefined });
    },
    onSuccess: (_, vars) => {
      toast({ title: vars.action === "admin-approve" ? "Student Leave Approved & Attendance Synced" : "Leave Rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/student-leaves/school", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pendingLeaves          = leaveRequests.filter((l: any) => l.status === "pending");
  const forwardedStudentLeaves = studentLeaves;
  const isPending              = leaveStatusMutation.isPending || studentLeaveApproveMutation.isPending;

  // ── Student Leave Detail Modal ────────────────────────────────────────────────
  const StudentLeaveModal = selectedLeave ? (
    <Dialog open={!!selectedLeave} onOpenChange={() => { setSelectedLeave(null); setAdminComment(""); }}>
      <DialogContent className="max-w-md"
        style={{ background: "#1A2942", border: "1px solid rgba(99,102,241,0.30)", color: "white" }}>
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-bold">Student Leave Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between">
            <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.75rem" }}>Student</span>
            <span className="font-semibold text-white text-sm">
              {selectedLeave.studentName}
              <span className="ml-1.5 font-normal" style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.7rem" }}>({selectedLeave.dsid})</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.75rem" }}>Class</span>
            <span className="text-white text-sm">{selectedLeave.class}-{selectedLeave.section}</span>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.75rem" }}>Dates</span>
            <span className="text-white text-sm">{fmtDate(selectedLeave.startDate)} – {fmtDate(selectedLeave.endDate)}</span>
          </div>
          {selectedLeave.category && (
            <div className="flex items-center justify-between">
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.75rem" }}>Category</span>
              <span className="text-white text-sm">{selectedLeave.category}</span>
            </div>
          )}
          <div className="flex items-start justify-between gap-4">
            <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.75rem" }} className="mt-0.5 flex-shrink-0">Reason</span>
            <span className="text-white text-sm text-right leading-relaxed">{selectedLeave.reason}</span>
          </div>
          {selectedLeave.attachmentUrl && (
            <div className="flex items-center justify-between">
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.75rem" }}>Attachment</span>
              <a href={selectedLeave.attachmentUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-indigo-300 hover:text-indigo-100 text-sm"
                data-testid={`link-leave-attachment-${selectedLeave.id}`}>
                <Paperclip className="w-3 h-3" /> View file
              </a>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.75rem" }}>Submitted</span>
            <span className="text-white text-sm">{fmtDate(selectedLeave.createdAt)}</span>
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(99,102,241,0.25)" }}>
            <div className="flex items-center gap-2 px-3 py-2" style={{ background: "rgba(99,102,241,0.12)" }}>
              <UserCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#818cf8" }} />
              <div className="flex-1 min-w-0">
                <p style={{ color: "rgba(255,255,255,0.50)", fontSize: "0.7rem" }}>Forwarded by Teacher</p>
                <p className="text-white font-semibold text-sm truncate">{selectedLeave.forwardedByTeacherName ?? "—"}</p>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                style={{ background: "rgba(99,102,241,0.20)", color: "#818cf8" }}>
                Awaiting Principal
              </span>
            </div>
            {selectedLeave.teacherComment && (
              <div className="px-3 py-2 flex items-start gap-2"
                style={{ background: "rgba(99,102,241,0.06)", borderTop: "1px solid rgba(99,102,241,0.18)" }}>
                <Paperclip className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "#818cf8" }} />
                <div>
                  <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.68rem" }} className="mb-0.5">Teacher's note to principal</p>
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.85)" }}>{selectedLeave.teacherComment}</p>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <label style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.75rem" }}>
              Principal Comment <span style={{ color: "rgba(255,255,255,0.30)" }}>(optional)</span>
            </label>
            <Textarea value={adminComment} onChange={e => setAdminComment(e.target.value)}
              placeholder="Add a comment or note for this decision…" rows={3} className="resize-none text-sm"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", color: "white" }}
              data-testid="textarea-admin-comment" />
          </div>
        </div>
        <DialogFooter className="gap-2 mt-1">
          <Button variant="outline" onClick={() => { setSelectedLeave(null); setAdminComment(""); }}
            className="border-white/20 text-white hover:bg-white/10" data-testid="button-close-leave-detail">
            Close
          </Button>
          <button disabled={isPending}
            onClick={() => { studentLeaveApproveMutation.mutate({ id: selectedLeave.id, action: "reject", comment: adminComment || undefined }); setSelectedLeave(null); setAdminComment(""); }}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
            style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
            data-testid={`button-detail-reject-${selectedLeave.id}`}>
            ✕ Reject
          </button>
          <button disabled={isPending}
            onClick={() => { studentLeaveApproveMutation.mutate({ id: selectedLeave.id, action: "admin-approve", comment: adminComment || undefined }); setSelectedLeave(null); setAdminComment(""); }}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "white" }}
            data-testid={`button-detail-approve-${selectedLeave.id}`}>
            ✓ Approve + Sync
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  // ══════════════════════════════════════════════════════════════════════════
  // LANDING PAGE
  // ══════════════════════════════════════════════════════════════════════════
  if (activeSection === null) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight">Leave Requests</h2>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
            Manage teacher leave balances and student leave requests forwarded by teachers
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {canTeacherLeave && (
            <LeaveTile
              title="Teacher Leave"
              subtitle="Review and approve teacher leave requests. Syncs with leave balance."
              icon={UserCheck}
              gradient="linear-gradient(135deg, #0ea5e9, #06b6d4)"
              glow="rgba(14,165,233,0.18)"
              badge={pendingLeaves.length}
              badgeColor="linear-gradient(135deg,#0ea5e9,#06b6d4)"
              onClick={() => { setActiveSection("teacher-leave"); onNavigateSection?.("teacher-leave"); }}
            />
          )}
          {canStudentLeave && (
            <LeaveTile
              title="Student Leave"
              subtitle="Admin decisions on student leaves forwarded by teachers."
              icon={Users}
              gradient="linear-gradient(135deg, #818cf8, #6366f1)"
              glow="rgba(99,102,241,0.18)"
              badge={forwardedStudentLeaves.length}
              badgeColor="linear-gradient(135deg,#818cf8,#6366f1)"
              onClick={() => { setActiveSection("student-leave"); onNavigateSection?.("student-leave"); }}
            />
          )}
          {canHistory && (
            <LeaveTile
              title="Leave Approval History"
              subtitle="Historical log of all past approved and rejected teacher and student leave applications."
              icon={History}
              gradient="linear-gradient(135deg, #D4AF37, #f59e0b)"
              glow="rgba(212,175,55,0.18)"
              badge={null}
              badgeColor=""
              fullWidth
              onClick={() => { setActiveSection("leave-history"); onNavigateSection?.("leave-history"); }}
            />
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LEAVE HISTORY — FULL SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if (activeSection === "leave-history") {
    const hCanTeacher = canTeacherLeave;
    const hCanStudent = canStudentLeave;
    const tabCount    = [hCanTeacher, hCanStudent].filter(Boolean).length;
    const gridCols    = tabCount === 1 ? "grid-cols-1" : "grid-cols-2";
    const defaultTab  = hCanTeacher ? "teacher_leaves" : "student_leaves";
    return (
      <div className="space-y-5">
        <SectionHeader
          title="Leave Approval History"
          icon={History}
          gradient="linear-gradient(135deg, #D4AF37, #f59e0b)"
          glow="rgba(212,175,55,0.25)"
          onBack={() => { setActiveSection(null); onNavigateSection?.(null); }}
        />
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "#0A1628", border: "1px solid rgba(212,175,55,0.20)" }}>
          <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(212,175,55,0.12)" }}>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
              All leave applications that have been actioned (approved or rejected)
            </p>
          </div>
          {historyLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#D4AF37" }} />
            </div>
          ) : (
            <div className="p-5">
              <Tabs defaultValue={defaultTab}>
                <TabsList className={`grid ${gridCols} w-full mb-4`}
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}>
                  {hCanTeacher && (
                    <TabsTrigger value="teacher_leaves"
                      className="text-xs data-[state=active]:text-white data-[state=active]:bg-amber-600/20"
                      style={{ color: "rgba(255,255,255,0.55)" }}
                      data-testid="tab-leave-history-teacher">
                      Teacher Leaves
                      <span className="ml-1 text-[10px] opacity-70">({historyData?.teacherLeaves?.length ?? 0})</span>
                    </TabsTrigger>
                  )}
                  {hCanStudent && (
                    <TabsTrigger value="student_leaves"
                      className="text-xs data-[state=active]:text-white data-[state=active]:bg-amber-600/20"
                      style={{ color: "rgba(255,255,255,0.55)" }}
                      data-testid="tab-leave-history-student">
                      Student Leaves
                      <span className="ml-1 text-[10px] opacity-70">({historyData?.studentLeaves?.length ?? 0})</span>
                    </TabsTrigger>
                  )}
                </TabsList>
                {hCanTeacher && (
                  <TabsContent value="teacher_leaves" className="space-y-2">
                    {!historyData?.teacherLeaves?.length
                      ? <div className="text-center py-10 text-sm" style={{ color: "rgba(255,255,255,0.40)" }}>No teacher leave history</div>
                      : historyData.teacherLeaves.map((l: any) => (
                          <HistoryRow key={l.id} status={l.status}>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-semibold text-sm">{l.teacherName}</p>
                              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                                {l.leaveType} · {fmtDate(l.startDate)} – {fmtDate(l.endDate)}
                              </p>
                              {l.reason && <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.40)" }}>{l.reason}</p>}
                            </div>
                            <StatusChip status={l.status} />
                          </HistoryRow>
                        ))
                    }
                  </TabsContent>
                )}
                {hCanStudent && (
                  <TabsContent value="student_leaves" className="space-y-2">
                    {!historyData?.studentLeaves?.length
                      ? <div className="text-center py-10 text-sm" style={{ color: "rgba(255,255,255,0.40)" }}>No student leave history</div>
                      : historyData.studentLeaves.map((l: any) => (
                          <HistoryRow key={l.id} status={l.status}>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-semibold text-sm">{l.studentName}</p>
                              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                                {l.dsid} · Class {l.class}{l.section ? `-${l.section}` : ""} · {fmtDate(l.startDate)} – {fmtDate(l.endDate)}
                              </p>
                              {l.adminComment && (
                                <p className="text-xs mt-0.5 truncate italic" style={{ color: "rgba(255,255,255,0.40)" }}>
                                  Admin note: {l.adminComment}
                                </p>
                              )}
                            </div>
                            <StatusChip status={l.status} />
                          </HistoryRow>
                        ))
                    }
                  </TabsContent>
                )}
              </Tabs>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION VIEWS
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* ── Teacher Leave ── */}
      {activeSection === "teacher-leave" && (
        <>
          <SectionHeader
            title="Teacher Leave Requests"
            icon={UserCheck}
            gradient="linear-gradient(135deg,#0ea5e9,#06b6d4)"
            glow="rgba(14,165,233,0.25)"
            onBack={() => { setActiveSection(null); onNavigateSection?.(null); }}
            badge={pendingLeaves.length}
          />
          <Section title="Teacher Leave Requests" icon={UserCheck} badge={pendingLeaves.length} variant="teacher">
            {leavesLoading ? <Spinner /> :
              pendingLeaves.length === 0
                ? <EmptyState label="No pending teacher leave requests" variant="teacher" />
                : (
                  <div className="space-y-2">
                    {pendingLeaves.map((l: any) => (
                      <ItemRow key={l.id} testId={`card-leave-${l.id}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm">{l.teacherName}</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                            {l.leaveType} · {fmtDate(l.startDate)} – {fmtDate(l.endDate)}
                          </p>
                          <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{l.reason}</p>
                        </div>
                        <ActionButtons
                          disabled={isPending}
                          onApprove={() => leaveStatusMutation.mutate({ id: l.id, status: "approved" })}
                          onReject={() => leaveStatusMutation.mutate({ id: l.id, status: "rejected" })}
                          approveTestId={`button-approve-leave-${l.id}`}
                          rejectTestId={`button-reject-leave-${l.id}`}
                        />
                      </ItemRow>
                    ))}
                  </div>
                )
            }
          </Section>
        </>
      )}

      {/* ── Student Leave ── */}
      {activeSection === "student-leave" && (
        <>
          <SectionHeader
            title="Student Leave Requests"
            icon={Users}
            gradient="linear-gradient(135deg,#818cf8,#6366f1)"
            glow="rgba(99,102,241,0.25)"
            onBack={() => { setActiveSection(null); onNavigateSection?.(null); }}
            badge={forwardedStudentLeaves.length}
          />
          <Section title="Student Leave Requests (Forwarded by Teacher)" icon={Users} badge={forwardedStudentLeaves.length} variant="student">
            {sleavesLoading ? <Spinner /> :
              forwardedStudentLeaves.length === 0
                ? <EmptyState label="No student leave requests forwarded" variant="student" />
                : (
                  <div className="space-y-2">
                    {forwardedStudentLeaves.map((l: any) => (
                      <ItemRow key={l.id} testId={`card-student-leave-${l.id}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm">
                            {l.studentName}{" "}
                            <span className="font-normal text-xs" style={{ color: "rgba(255,255,255,0.40)" }}>({l.dsid})</span>
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                            Class {l.class}-{l.section} · {fmtDate(l.startDate)} – {fmtDate(l.endDate)}
                          </p>
                          <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{l.reason}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={() => setSelectedLeave(l)}
                            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
                            style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
                            data-testid={`button-view-student-leave-${l.id}`} title="View details">
                            <Eye className="w-4 h-4" />
                          </button>
                          <ActionButtons
                            disabled={isPending}
                            onApprove={() => studentLeaveApproveMutation.mutate({ id: l.id, action: "admin-approve", comment: undefined })}
                            onReject={() => studentLeaveApproveMutation.mutate({ id: l.id, action: "reject", comment: undefined })}
                            approveLabel="Approve + Sync"
                            approveTestId={`button-approve-student-leave-${l.id}`}
                            rejectTestId={`button-reject-student-leave-${l.id}`}
                          />
                        </div>
                      </ItemRow>
                    ))}
                  </div>
                )
            }
          </Section>
        </>
      )}

      {StudentLeaveModal}
    </div>
  );
}
