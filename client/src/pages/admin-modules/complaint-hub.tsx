import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MessageSquare, CheckCircle, Loader2, Lock, Shield, ArrowUpCircle,
  AlertTriangle, ChevronDown, ChevronUp, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number }

interface AdminComplaint {
  id: number;
  ticketId: string;
  complaintType: string;
  status: string;
  content: string;
  reportedStudentName: string | null;
  resolutionRemarks: string | null;
  escalatedToPrincipal: boolean;
  notifyAdmin: boolean;
  createdAt: string;
  studentName: string | null;
  teacherName: string | null;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    Pending:       "bg-amber-400 text-black border-amber-500",
    Investigating: "bg-blue-400 text-black border-blue-500",
    Resolved:      "bg-emerald-400 text-black border-emerald-500",
    Escalated:     "bg-red-400 text-black border-red-500",
  };
  const Icon = status === "Resolved" ? CheckCircle : status === "Escalated" ? ArrowUpCircle : Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold ${map[status] ?? "bg-gray-300 text-black border-gray-400"}`}>
      <Icon className="w-3 h-3" />{status}
    </span>
  );
}

function ComplaintCard({
  c, schoolId, showRemarksInput,
}: {
  c: AdminComplaint;
  schoolId: number;
  showRemarksInput?: boolean;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [showRemarks, setShowRemarks] = useState(false);

  const resolveMutation = useMutation({
    mutationFn: ({ status, resolutionRemarks }: { status: string; resolutionRemarks?: string }) =>
      apiRequest("PATCH", `/api/complaints/${c.id}/status`, { status, resolutionRemarks }),
    onSuccess: () => {
      toast({ title: "Status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/school", schoolId] });
      setRemarks("");
      setShowRemarks(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isActive = c.status !== "Resolved";

  return (
    <div className="rounded-xl border border-white/10 bg-[#1A2942] p-4 space-y-3" data-testid={`card-complaint-${c.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-mono text-xs font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-0.5 rounded" data-testid={`ticket-${c.id}`}>
              {c.ticketId}
            </span>
            <StatusChip status={c.status} />
          </div>
          {c.teacherName && (
            <p className="text-xs font-bold text-white/90">
              {c.complaintType === "teacher-to-admin" ? "From:" : "Teacher:"} {c.teacherName}
            </p>
          )}
          {c.studentName && (
            <p className="text-xs font-bold text-white/90">
              {c.complaintType === "student-to-staff" ? "Against staff:" : "Student:"} {c.studentName}
            </p>
          )}
          {c.reportedStudentName && !c.studentName && (
            <p className="text-xs font-bold text-white/90">Reported: {c.reportedStudentName}</p>
          )}
          <p className="text-white/40 text-xs mt-0.5">{fmtDate(c.createdAt)}</p>
        </div>
      </div>

      <p className={`text-sm text-white/80 font-medium leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
        {c.content}
      </p>
      {c.content.length > 100 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-xs font-bold text-[#D4AF37] min-h-[28px]"
          data-testid={`btn-expand-${c.id}`}
        >
          {expanded ? <><ChevronUp className="w-3 h-3" /> Less</> : <><ChevronDown className="w-3 h-3" /> Read more</>}
        </button>
      )}

      {/* Principal's Remarks display */}
      {c.resolutionRemarks && (
        <div className="px-3 py-2 rounded-lg bg-green-900/20 border border-green-700/30">
          <p className="text-xs font-bold text-green-400">Principal's Remarks</p>
          <p className="text-xs font-semibold text-green-300 mt-0.5">{c.resolutionRemarks}</p>
        </div>
      )}

      {/* Actions */}
      {isActive && (
        <div className="flex flex-wrap gap-2 pt-1">
          {showRemarksInput && !showRemarks && (
            <Button
              size="sm"
              onClick={() => setShowRemarks(true)}
              className="h-8 px-3 rounded-lg bg-[#D4AF37] hover:bg-[#b8962e] text-black font-bold text-xs"
              data-testid={`button-post-remarks-${c.id}`}
            >
              Post Principal's Remarks
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => resolveMutation.mutate({ status: "Resolved" })}
            disabled={resolveMutation.isPending}
            className="h-8 px-3 rounded-lg bg-emerald-400 hover:bg-emerald-500 text-black font-bold text-xs"
            data-testid={`button-resolve-${c.id}`}
          >
            {resolveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
            Mark Resolved
          </Button>
          {c.status !== "Investigating" && (
            <Button
              size="sm"
              onClick={() => resolveMutation.mutate({ status: "Investigating" })}
              disabled={resolveMutation.isPending}
              className="h-8 px-3 rounded-lg bg-blue-400 hover:bg-blue-500 text-black font-bold text-xs"
              data-testid={`button-investigating-${c.id}`}
            >
              <Clock className="w-3 h-3 mr-1" /> Mark Investigating
            </Button>
          )}
        </div>
      )}

      {/* Remarks input box */}
      {showRemarksInput && showRemarks && isActive && (
        <div className="space-y-2 pt-1 border-t border-white/10">
          <label className="text-xs font-bold text-white/70">Principal's Remarks *</label>
          <textarea
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            rows={3}
            placeholder="Write your decision or feedback..."
            className="w-full px-3 py-2 rounded-xl bg-[#0A1628] border border-white/20 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[#D4AF37] resize-none font-medium"
            data-testid={`input-remarks-${c.id}`}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => resolveMutation.mutate({ status: c.status, resolutionRemarks: remarks.trim() })}
              disabled={!remarks.trim() || resolveMutation.isPending}
              className="h-8 px-3 rounded-lg bg-[#D4AF37] hover:bg-[#b8962e] text-black font-bold text-xs"
              data-testid={`button-post-only-remarks-${c.id}`}
            >
              {resolveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3 mr-1" />}
              Post Remarks
            </Button>
            <Button
              size="sm"
              onClick={() => resolveMutation.mutate({ status: "Resolved", resolutionRemarks: remarks.trim() })}
              disabled={!remarks.trim() || resolveMutation.isPending}
              className="h-8 px-3 rounded-lg bg-emerald-400 hover:bg-emerald-500 text-black font-bold text-xs"
              data-testid={`button-submit-remarks-${c.id}`}
            >
              {resolveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
              Post & Resolve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowRemarks(false); setRemarks(""); }}
              className="h-8 px-3 rounded-lg text-white/60 hover:text-white font-bold text-xs"
              data-testid={`button-cancel-remarks-${c.id}`}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  count,
  color,
}: {
  icon: typeof Shield;
  title: string;
  subtitle: string;
  count: number;
  color: string;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${color}`}>
      <Icon className="w-5 h-5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">{title}</p>
        <p className="text-xs text-white/50">{subtitle}</p>
      </div>
      <span className="text-xs font-bold text-white/70 bg-white/10 px-2 py-0.5 rounded-full">{count}</span>
    </div>
  );
}

export default function ComplaintHub({ schoolId }: Props) {
  const { data: all = [], isLoading } = useQuery<AdminComplaint[]>({
    queryKey: ["/api/complaints/school", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/complaints/school/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  // ── Section 1: Private Teacher → Admin messages ──
  const privateTeacher = all.filter(c => c.complaintType === "teacher-to-admin");

  // ── Section 2: Student Staff Grievances (direct to principal, bypass teacher) ──
  const studentGrievances = all.filter(c => c.complaintType === "student-to-staff");

  // ── Section 3: Escalated Reports ──
  //   a) Peer reports escalated by class teacher (escalatedToPrincipal=true)
  //   b) Teacher-to-student flagged with "Notify Admin" (dedicated notifyAdmin=true column)
  const escalated = all.filter(c =>
    (c.complaintType === "student-peer-report" && c.escalatedToPrincipal) ||
    (c.complaintType === "teacher-to-student" && c.notifyAdmin)
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    );
  }

  const totalActive = [
    ...privateTeacher.filter(c => c.status !== "Resolved"),
    ...studentGrievances.filter(c => c.status !== "Resolved"),
    ...escalated.filter(c => c.status !== "Resolved"),
  ].length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Complaint Hub</h2>
        <p className="text-white/50 text-sm">
          {totalActive} active · {all.length - totalActive} resolved
        </p>
      </div>

      {all.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
          <MessageSquare className="w-10 h-10 mx-auto mb-3 text-white/20" />
          <p className="text-white/40 font-semibold">No complaints filed</p>
        </div>
      )}

      {/* ── Section 1: Private Teacher Messages ── always visible ── */}
      <section className="space-y-3" data-testid="section-private-teacher">
        <SectionHeader
          icon={Lock}
          title="Private Teacher Messages"
          subtitle="Direct messages from teachers — not visible to students"
          count={privateTeacher.length}
          color="border-amber-500/30 bg-amber-900/10"
        />
        {privateTeacher.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1A2942]/60 py-6 text-center" data-testid="empty-private-teacher">
            <Lock className="w-6 h-6 mx-auto mb-1.5 text-white/20" />
            <p className="text-white/30 text-xs font-semibold">No teacher messages filed</p>
          </div>
        ) : (
          privateTeacher.map(c => (
            <ComplaintCard key={c.id} c={c} schoolId={schoolId} />
          ))
        )}
      </section>

      {/* ── Section 2: Student Staff Grievances ── always visible ── */}
      <section className="space-y-3" data-testid="section-student-grievances">
        <SectionHeader
          icon={Shield}
          title="Student Staff Grievances"
          subtitle="Filed directly by students — bypassed the staff member entirely"
          count={studentGrievances.length}
          color="border-blue-500/30 bg-blue-900/10"
        />
        {studentGrievances.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1A2942]/60 py-6 text-center" data-testid="empty-student-grievances">
            <Shield className="w-6 h-6 mx-auto mb-1.5 text-white/20" />
            <p className="text-white/30 text-xs font-semibold">No student grievances filed</p>
          </div>
        ) : (
          studentGrievances.map(c => (
            <ComplaintCard key={c.id} c={c} schoolId={schoolId} />
          ))
        )}
      </section>

      {/* ── Section 3: Escalated Reports ── always visible ── */}
      <section className="space-y-3" data-testid="section-escalated">
        <SectionHeader
          icon={ArrowUpCircle}
          title="Escalated Reports"
          subtitle="Peer reports escalated by class teachers · Teacher complaints flagged for Admin"
          count={escalated.length}
          color="border-red-500/30 bg-red-900/10"
        />
        {escalated.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1A2942]/60 py-6 text-center" data-testid="empty-escalated">
            <ArrowUpCircle className="w-6 h-6 mx-auto mb-1.5 text-white/20" />
            <p className="text-white/30 text-xs font-semibold">No escalated reports</p>
          </div>
        ) : (
          escalated.map(c => (
            <ComplaintCard key={c.id} c={c} schoolId={schoolId} showRemarksInput />
          ))
        )}
      </section>
    </div>
  );
}
