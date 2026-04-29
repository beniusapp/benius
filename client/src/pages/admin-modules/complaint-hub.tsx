import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MessageSquare, CheckCircle, Loader2, Lock, Shield, ArrowUpCircle,
  AlertTriangle, ChevronDown, ChevronUp, Clock, ArrowUp,
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

type TabKey = "private" | "grievances" | "escalated";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Pending:       "bg-amber-100 text-amber-800 border border-amber-300",
    Investigating: "bg-blue-100 text-blue-800 border border-blue-300",
    Resolved:      "bg-emerald-100 text-emerald-800 border border-emerald-300",
    Escalated:     "bg-red-100 text-red-800 border border-red-300",
  };
  const Icon = status === "Resolved" ? CheckCircle : status === "Escalated" ? ArrowUpCircle : Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${styles[status] ?? "bg-gray-100 text-gray-700 border border-gray-300"}`}>
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
    <div
      className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow p-4 space-y-3"
      data-testid={`card-complaint-${c.id}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="font-mono text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded" data-testid={`ticket-${c.id}`}>
              {c.ticketId}
            </span>
            <StatusBadge status={c.status} />
          </div>
          {c.teacherName && (
            <p className="text-xs font-bold text-slate-800">
              {c.complaintType === "teacher-to-admin" ? "From:" : "Teacher:"} {c.teacherName}
            </p>
          )}
          {c.studentName && (
            <p className="text-xs font-bold text-slate-800">
              {c.complaintType === "student-to-staff" ? "Against staff:" : "Student:"} {c.studentName}
            </p>
          )}
          {c.reportedStudentName && !c.studentName && (
            <p className="text-xs font-bold text-slate-800">Reported: {c.reportedStudentName}</p>
          )}
          <p className="text-slate-400 text-xs mt-0.5">{fmtDate(c.createdAt)}</p>
        </div>
      </div>

      {/* Content */}
      <p className={`text-sm text-slate-900 font-semibold leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
        {c.content}
      </p>
      {c.content.length > 100 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-xs font-bold text-amber-700 min-h-[28px]"
          data-testid={`btn-expand-${c.id}`}
        >
          {expanded ? <><ChevronUp className="w-3 h-3" /> Less</> : <><ChevronDown className="w-3 h-3" /> Read more</>}
        </button>
      )}

      {/* Principal's Remarks display */}
      {c.resolutionRemarks && (
        <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
          <p className="text-xs font-bold text-emerald-700">Principal's Remarks</p>
          <p className="text-xs font-semibold text-emerald-900 mt-0.5">{c.resolutionRemarks}</p>
        </div>
      )}

      {/* Actions */}
      {isActive && (
        <div className="flex flex-wrap gap-2 pt-1">
          {showRemarksInput && !showRemarks && (
            <Button
              size="sm"
              onClick={() => setShowRemarks(true)}
              className="h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs"
              data-testid={`button-post-remarks-${c.id}`}
            >
              Post Principal's Remarks
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => resolveMutation.mutate({ status: "Resolved" })}
            disabled={resolveMutation.isPending}
            className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs"
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
              className="h-8 px-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-bold text-xs"
              data-testid={`button-investigating-${c.id}`}
            >
              <Clock className="w-3 h-3 mr-1" /> Mark Investigating
            </Button>
          )}
        </div>
      )}

      {/* Remarks textarea */}
      {showRemarksInput && showRemarks && isActive && (
        <div className="space-y-2 pt-1 border-t border-slate-200">
          <label className="text-xs font-bold text-slate-600">Principal's Remarks *</label>
          <textarea
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            rows={3}
            placeholder="Write your decision or feedback..."
            className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none font-medium"
            data-testid={`input-remarks-${c.id}`}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => resolveMutation.mutate({ status: c.status, resolutionRemarks: remarks.trim() })}
              disabled={!remarks.trim() || resolveMutation.isPending}
              className="h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs"
              data-testid={`button-post-only-remarks-${c.id}`}
            >
              {resolveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3 mr-1" />}
              Post Remarks
            </Button>
            <Button
              size="sm"
              onClick={() => resolveMutation.mutate({ status: "Resolved", resolutionRemarks: remarks.trim() })}
              disabled={!remarks.trim() || resolveMutation.isPending}
              className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs"
              data-testid={`button-submit-remarks-${c.id}`}
            >
              {resolveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
              Post & Resolve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowRemarks(false); setRemarks(""); }}
              className="h-8 px-3 rounded-lg text-slate-500 hover:text-slate-700 font-bold text-xs"
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

function TabPanel({
  items,
  schoolId,
  emptyIcon: EmptyIcon,
  emptyMessage,
  showRemarksInput,
}: {
  items: AdminComplaint[];
  schoolId: number;
  emptyIcon: typeof Lock;
  emptyMessage: string;
  showRemarksInput?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);

  function handleScroll() {
    if (scrollRef.current) setAtTop(scrollRef.current.scrollTop < 80);
  }

  function scrollToTop() {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto h-[520px] pr-1 space-y-3 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
        data-testid="tab-panel-scroll"
      >
        {items.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1A2942]/60 py-12 text-center h-full flex flex-col items-center justify-center">
            <EmptyIcon className="w-8 h-8 mb-2 text-white/20" />
            <p className="text-white/30 text-xs font-semibold">{emptyMessage}</p>
          </div>
        ) : (
          items.map(c => (
            <ComplaintCard key={c.id} c={c} schoolId={schoolId} showRemarksInput={showRemarksInput} />
          ))
        )}
      </div>

      {/* Scroll to Top button */}
      <button
        onClick={scrollToTop}
        className={`absolute bottom-3 right-3 p-2 rounded-full bg-[#D4AF37] text-black shadow-lg transition-all duration-300 ${atTop ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"}`}
        title="Scroll to top"
        data-testid="button-scroll-to-top"
      >
        <ArrowUp className="w-4 h-4" />
      </button>
    </div>
  );
}

const TAB_CONFIG: {
  key: TabKey;
  label: string;
  icon: typeof Lock;
  subtitle: string;
  emptyMessage: string;
  accentBg: string;
  accentText: string;
  activeBorder: string;
  badgeBg: string;
  showRemarksInput?: boolean;
}[] = [
  {
    key: "private",
    label: "Private Teacher Messages",
    icon: Lock,
    subtitle: "Direct messages from teachers — not visible to students",
    emptyMessage: "No teacher messages filed",
    accentBg: "bg-amber-900/10",
    accentText: "text-amber-400",
    activeBorder: "border-amber-500",
    badgeBg: "bg-amber-500/20 text-amber-200",
  },
  {
    key: "grievances",
    label: "Student Staff Grievances",
    icon: Shield,
    subtitle: "Filed directly by students — bypassed the staff member entirely",
    emptyMessage: "No student grievances filed",
    accentBg: "bg-blue-900/10",
    accentText: "text-blue-400",
    activeBorder: "border-blue-500",
    badgeBg: "bg-blue-500/20 text-blue-200",
  },
  {
    key: "escalated",
    label: "Escalated Reports",
    icon: ArrowUpCircle,
    subtitle: "Peer reports escalated by teachers · Teacher complaints flagged for Admin",
    emptyMessage: "No escalated reports",
    accentBg: "bg-red-900/10",
    accentText: "text-red-400",
    activeBorder: "border-red-500",
    badgeBg: "bg-red-500/20 text-red-200",
    showRemarksInput: true,
  },
];

export default function ComplaintHub({ schoolId }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("private");

  const { data: all = [], isLoading } = useQuery<AdminComplaint[]>({
    queryKey: ["/api/complaints/school", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/complaints/school/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const privateTeacher  = all.filter(c => c.complaintType === "teacher-to-admin");
  const studentGrievances = all.filter(c => c.complaintType === "student-to-staff");
  const escalated = all.filter(c =>
    (c.complaintType === "student-peer-report" && c.escalatedToPrincipal) ||
    (c.complaintType === "teacher-to-student" && c.notifyAdmin)
  );

  const countByKey: Record<TabKey, number> = {
    private: privateTeacher.length,
    grievances: studentGrievances.length,
    escalated: escalated.length,
  };

  const activeByKey: Record<TabKey, number> = {
    private: privateTeacher.filter(c => c.status !== "Resolved").length,
    grievances: studentGrievances.filter(c => c.status !== "Resolved").length,
    escalated: escalated.filter(c => c.status !== "Resolved").length,
  };

  const totalActive = activeByKey.private + activeByKey.grievances + activeByKey.escalated;

  const itemsByKey: Record<TabKey, AdminComplaint[]> = {
    private: privateTeacher,
    grievances: studentGrievances,
    escalated,
  };

  const activeConfig = TAB_CONFIG.find(t => t.key === activeTab)!;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        <Loader2 className="w-7 h-7 animate-spin text-white/40" />
        <p className="text-white/30 text-xs">Loading complaints…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="complaint-hub">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Complaint Hub</h2>
          <p className="text-white/50 text-sm mt-0.5">
            {totalActive > 0
              ? <><span className="text-amber-400 font-semibold">{totalActive} active</span> · {all.length - totalActive} resolved</>
              : <span className="text-emerald-400 font-semibold">All complaints resolved ✓</span>
            }
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {TAB_CONFIG.map(t => (
            activeByKey[t.key] > 0 && (
              <span key={t.key} className={`text-xs font-bold px-2 py-0.5 rounded-full ${t.badgeBg}`}>
                {activeByKey[t.key]} active
              </span>
            )
          ))}
        </div>
      </div>

      {/* ── Tab Navigation ── */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#0A1628] border border-white/10" role="tablist" data-testid="complaint-tabs">
        {TAB_CONFIG.map(tab => {
          const isActive = activeTab === tab.key;
          const Icon = tab.icon;
          const count = countByKey[tab.key];
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.key)}
              data-testid={`tab-${tab.key}`}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                isActive
                  ? `bg-[#1A2942] ${tab.accentText} border-b-2 ${tab.activeBorder} shadow-sm`
                  : "text-white/40 hover:text-white/70 hover:bg-white/5"
              }`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline truncate">{tab.label}</span>
              {count > 0 && (
                <span className={`flex-shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full ${isActive ? tab.badgeBg : "bg-white/10 text-white/50"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Active Tab Subtitle ── */}
      <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/10 ${activeConfig.accentBg}`}>
        <activeConfig.icon className={`w-4 h-4 flex-shrink-0 ${activeConfig.accentText}`} />
        <p className="text-xs text-white/60 font-medium">{activeConfig.subtitle}</p>
        <span className="ml-auto text-xs text-white/40 font-semibold tabular-nums">
          {countByKey[activeTab]} total · {activeByKey[activeTab]} active
        </span>
      </div>

      {/* ── Tab Panels with independent scroll ── */}
      {TAB_CONFIG.map(tab => (
        <div
          key={tab.key}
          className={`transition-all duration-200 ${activeTab === tab.key ? "opacity-100" : "hidden opacity-0"}`}
          role="tabpanel"
          data-testid={`panel-${tab.key}`}
        >
          <TabPanel
            items={itemsByKey[tab.key]}
            schoolId={schoolId}
            emptyIcon={tab.icon}
            emptyMessage={tab.emptyMessage}
            showRemarksInput={tab.showRemarksInput}
          />
        </div>
      ))}
    </div>
  );
}
