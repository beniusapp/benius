import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { fmtDateTimeAmPm } from "@/lib/dateUtils";
import {
  MessageSquare, CheckCircle, Loader2, Lock, Shield, ArrowUpCircle,
  AlertTriangle, ChevronDown, ChevronUp, Clock, ArrowUp, Settings, Trash2, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number; initialTab?: string; onNavigateTab?: (tab: string) => void; }

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
  resolvedAt: string | null;
  studentName: string | null;
  students?: { id: number; name: string; class: string | null; section: string | null }[];
  teacherName: string | null;
  complainantName: string | null;
  complainantClass: string | null;
  complainantSection: string | null;
  complainantPhone: string | null;
}

type TabKey = "private" | "grievances" | "escalated";
type StatusFilter = "all" | "Pending" | "Investigating" | "Resolved" | "Escalated";

const COMPLAINT_TYPES_BY_TAB: Record<TabKey, string[]> = {
  private:    ["teacher-to-admin"],
  grievances: ["student-to-staff"],
  escalated:  ["student-peer-report", "teacher-to-student"],
};

const BULK_DELETE_OPTIONS: { label: string; days: number }[] = [
  { label: "Resolved > 30 days ago",    days: 30 },
  { label: "Resolved > 60 days ago",    days: 60 },
  { label: "Resolved > 90 days ago",    days: 90 },
  { label: "Resolved > 180 days ago",   days: 180 },
  { label: "All resolved (any age)",     days: 0 },
];

// ── Status Badge ──────────────────────────────────────────────────────────────
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

// ── Complaint Card ─────────────────────────────────────────────────────────────
function ComplaintCard({ c, schoolId, showRemarksInput }: {
  c: AdminComplaint; schoolId: number; showRemarksInput?: boolean;
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
      setRemarks(""); setShowRemarks(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isActive = c.status !== "Resolved";

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow p-4 space-y-3" data-testid={`card-complaint-${c.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="font-mono text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded" data-testid={`ticket-${c.id}`}>
              {c.ticketId}
            </span>
            <StatusBadge status={c.status} />
          </div>

          {(c.complaintType === "student-to-staff" || c.complaintType === "student-peer-report") ? (
            <>
              {c.complainantName && (
                <div className="flex flex-col gap-0.5 border-l-2 border-blue-300 pl-2">
                  <p className="text-xs font-bold text-slate-800">Filed by: <span className="text-blue-700">{c.complainantName}</span></p>
                  {(c.complainantClass || c.complainantSection) && (
                    <p className="text-xs text-slate-500 font-semibold">Class {c.complainantClass ?? "—"} · Section {c.complainantSection ?? "—"}</p>
                  )}
                  {c.complainantPhone && <p className="text-xs text-slate-500 font-semibold">Phone: {c.complainantPhone}</p>}
                </div>
              )}
              {c.teacherName && <p className="text-xs font-bold text-slate-800 mt-0.5">Against: <span className="text-rose-700">{c.teacherName}</span></p>}
            </>
          ) : (
            <>
              {c.teacherName && <p className="text-xs font-bold text-slate-800">From: {c.teacherName}</p>}
              {(c.students?.length ?? 0) > 0 && (
                <div className="mt-0.5" data-testid={`students-admin-${c.id}`}>
                  <span className="text-xs font-bold text-slate-500 mr-1">Against:</span>
                  <span className="inline-flex flex-wrap gap-1">
                    {c.students!.map((s, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-[11px] font-semibold text-rose-800">
                        {s.name}{s.class ? ` · ${s.class}${s.section ? `-${s.section}` : ""}` : ""}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {(c.students?.length ?? 0) === 0 && c.studentName && <p className="text-xs font-bold text-slate-800">Against: {c.studentName}</p>}
              {c.reportedStudentName && !c.studentName && (c.students?.length ?? 0) === 0 && <p className="text-xs font-bold text-slate-800">Against: {c.reportedStudentName}</p>}
            </>
          )}

          <p className="text-slate-400 text-xs mt-0.5">
            {fmtDateTimeAmPm(c.createdAt)}
            {c.resolvedAt && <span className="ml-2 text-emerald-500">· Resolved {fmtDateTimeAmPm(c.resolvedAt)}</span>}
          </p>
        </div>
      </div>

      <p className={`text-sm text-slate-900 font-semibold leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>{c.content}</p>
      {c.content.length > 100 && (
        <button onClick={() => setExpanded(v => !v)} className="flex items-center gap-1 text-xs font-bold text-amber-700 min-h-[28px]" data-testid={`btn-expand-${c.id}`}>
          {expanded ? <><ChevronUp className="w-3 h-3" /> Less</> : <><ChevronDown className="w-3 h-3" /> Read more</>}
        </button>
      )}

      {c.resolutionRemarks && (
        <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
          <p className="text-xs font-bold text-emerald-700">Principal's Remarks</p>
          <p className="text-xs font-semibold text-emerald-900 mt-0.5">{c.resolutionRemarks}</p>
        </div>
      )}

      {isActive && (
        <div className="flex flex-wrap gap-2 pt-1">
          {showRemarksInput && !showRemarks && (
            <Button size="sm" onClick={() => setShowRemarks(true)} className="h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs" data-testid={`button-post-remarks-${c.id}`}>
              Post Principal's Remarks
            </Button>
          )}
          <Button size="sm" onClick={() => resolveMutation.mutate({ status: "Resolved" })} disabled={resolveMutation.isPending} className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs" data-testid={`button-resolve-${c.id}`}>
            {resolveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />} Mark Resolved
          </Button>
          {c.status !== "Investigating" && (
            <Button size="sm" onClick={() => resolveMutation.mutate({ status: "Investigating" })} disabled={resolveMutation.isPending} className="h-8 px-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-bold text-xs" data-testid={`button-investigating-${c.id}`}>
              <Clock className="w-3 h-3 mr-1" /> Mark Investigating
            </Button>
          )}
        </div>
      )}

      {showRemarksInput && showRemarks && isActive && (
        <div className="space-y-2 pt-1 border-t border-slate-200">
          <label className="text-xs font-bold text-slate-600">Principal's Remarks *</label>
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={3} placeholder="Write your decision or feedback..."
            className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none font-medium"
            data-testid={`input-remarks-${c.id}`} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => resolveMutation.mutate({ status: c.status, resolutionRemarks: remarks.trim() })} disabled={!remarks.trim() || resolveMutation.isPending} className="h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs" data-testid={`button-post-only-remarks-${c.id}`}>
              {resolveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3 mr-1" />} Post Remarks
            </Button>
            <Button size="sm" onClick={() => resolveMutation.mutate({ status: "Resolved", resolutionRemarks: remarks.trim() })} disabled={!remarks.trim() || resolveMutation.isPending} className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs" data-testid={`button-submit-remarks-${c.id}`}>
              {resolveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />} Post & Resolve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowRemarks(false); setRemarks(""); }} className="h-8 px-3 rounded-lg text-slate-500 hover:text-slate-700 font-bold text-xs" data-testid={`button-cancel-remarks-${c.id}`}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Per-Tab Settings (inline, collapsible) ────────────────────────────────────
function TabSettings({ tabKey, schoolId, complaintTypes, onBulkDeleted }: {
  tabKey: TabKey;
  schoolId: number;
  complaintTypes: string[];
  onBulkDeleted: () => void;
}) {
  const { toast } = useToast();
  const [bulkDays, setBulkDays] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDays, setPendingDays] = useState<number | null>(null);

  const bulkDeleteMutation = useMutation({
    mutationFn: (olderThanDays: number) =>
      apiRequest("DELETE", "/api/admin/complaints/bulk", { olderThanDays, complaintTypes })
        .then(r => r.json() as Promise<{ deleted: number }>),
    onSuccess: (data) => {
      toast({
        title: "Bulk delete complete",
        description: data.deleted === 0
          ? "No eligible resolved complaints found in this section."
          : `${data.deleted} resolved complaint(s) permanently deleted.`,
      });
      onBulkDeleted();
      setConfirmOpen(false);
      setPendingDays(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="rounded-xl border border-white/10 bg-[#0A1628]/70 p-4 space-y-4" data-testid={`settings-panel-${tabKey}`}>
        {/* Manual Bulk Delete */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Trash2 className="w-3 h-3 text-rose-400" />
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">Manual Bulk Delete</span>
          </div>
          <p className="text-white/40 text-[11px]">Permanently delete <strong className="text-white/60">resolved</strong> complaints from <em>this section only</em>. Irreversible.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={bulkDays}
              onChange={e => setBulkDays(parseInt(e.target.value))}
              className="flex-1 min-w-[170px] px-2.5 py-1.5 rounded-lg bg-[#0A1628] border border-white/10 text-white/80 text-xs font-semibold focus:outline-none focus:border-[#D4AF37]"
              data-testid={`select-bulk-days-${tabKey}`}
            >
              {BULK_DELETE_OPTIONS.map(o => (
                <option key={o.days} value={o.days}>{o.label}</option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => { setPendingDays(bulkDays); setConfirmOpen(true); }}
              className="h-8 px-3 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg"
              data-testid={`button-bulk-delete-open-${tabKey}`}
            >
              <Trash2 className="w-3 h-3 mr-1" /> Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmOpen && pendingDays !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" data-testid={`bulk-delete-modal-${tabKey}`}>
          <div className="bg-[#1A2942] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-rose-500/20 flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Confirm Bulk Deletion</h3>
                <p className="text-white/40 text-xs mt-0.5">This section only · Cannot be undone</p>
              </div>
            </div>
            <div className="px-4 py-3 rounded-xl bg-rose-900/20 border border-rose-500/30 space-y-1">
              <p className="text-xs text-white/80 font-semibold">
                Permanently delete all <span className="text-rose-300 font-bold">Resolved</span> complaints{" "}
                {pendingDays === 0
                  ? <span className="text-rose-300 font-bold">regardless of age</span>
                  : <>older than <span className="text-rose-300 font-bold">{pendingDays} days</span></>
                }.
              </p>
              <p className="text-[11px] text-white/40">An audit log entry will record this deletion.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setConfirmOpen(false); setPendingDays(null); }} disabled={bulkDeleteMutation.isPending}
                className="flex-1 h-9 text-white/60 hover:text-white font-bold text-xs border border-white/10 rounded-xl" data-testid={`button-bulk-cancel-${tabKey}`}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => bulkDeleteMutation.mutate(pendingDays)} disabled={bulkDeleteMutation.isPending}
                className="flex-1 h-9 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl" data-testid={`button-bulk-confirm-${tabKey}`}>
                {bulkDeleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Now</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Tab Panel ─────────────────────────────────────────────────────────────────
function TabPanel({ items, schoolId, emptyIcon: EmptyIcon, emptyMessage, showRemarksInput, tabKey, statusFilter, onFilterChange }: {
  items: AdminComplaint[];
  schoolId: number;
  emptyIcon: typeof Lock;
  emptyMessage: string;
  showRemarksInput?: boolean;
  tabKey: TabKey;
  statusFilter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const filtered = statusFilter === "all" ? items : items.filter(c => c.status === statusFilter);

  const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "all",           label: "All" },
    { value: "Pending",       label: "Pending" },
    { value: "Investigating", label: "Investigating" },
    { value: "Resolved",      label: "Resolved" },
    { value: "Escalated",     label: "Escalated" },
  ];

  const countByStatus: Partial<Record<StatusFilter, number>> = {};
  for (const s of ["Pending", "Investigating", "Resolved", "Escalated"] as StatusFilter[]) {
    countByStatus[s] = items.filter(c => c.status === s).length;
  }

  function handleBulkDeleted() {
    queryClient.invalidateQueries({ queryKey: ["/api/complaints/school", schoolId] });
  }

  return (
    <div className="space-y-3">
      {/* Filter + Settings bar */}
      <div className="flex items-center gap-2 flex-wrap" data-testid={`filter-bar-${tabKey}`}>
        <Filter className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
        <span className="text-white/40 text-xs font-semibold">Filter:</span>
        {STATUS_FILTERS.map(f => {
          const cnt = f.value === "all" ? items.length : (countByStatus[f.value] ?? 0);
          if (f.value !== "all" && cnt === 0) return null;
          const isActive = statusFilter === f.value;
          return (
            <button key={f.value} onClick={() => onFilterChange(f.value)} data-testid={`filter-${tabKey}-${f.value}`}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all duration-150 ${isActive ? "bg-[#D4AF37] text-black shadow-sm" : "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white/80"}`}>
              {f.label}{cnt > 0 && <span className="ml-1 opacity-70">({cnt})</span>}
            </button>
          );
        })}
        <button
          onClick={() => setShowSettings(v => !v)}
          data-testid={`button-settings-${tabKey}`}
          className={`ml-auto p-1.5 rounded-lg border text-xs transition-all duration-150 ${showSettings ? "bg-[#D4AF37]/20 border-[#D4AF37] text-[#D4AF37]" : "bg-white/5 border-white/10 text-white/30 hover:text-white/70 hover:border-white/30"}`}
          title="Section Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Per-tab Settings (collapsible) */}
      {showSettings && (
        <TabSettings tabKey={tabKey} schoolId={schoolId} complaintTypes={COMPLAINT_TYPES_BY_TAB[tabKey]} onBulkDeleted={handleBulkDeleted} />
      )}

      {/* Scrollable complaint list */}
      <div className="relative">
        <div ref={scrollRef} onScroll={() => { if (scrollRef.current) setAtTop(scrollRef.current.scrollTop < 80); }}
          className="overflow-y-auto h-[480px] pr-1 space-y-3 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
          data-testid={`scroll-panel-${tabKey}`}>
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#1A2942]/60 py-12 text-center flex flex-col items-center justify-center h-full">
              <EmptyIcon className="w-8 h-8 mb-2 text-white/20" />
              <p className="text-white/30 text-xs font-semibold">
                {statusFilter !== "all" ? `No ${statusFilter} complaints` : emptyMessage}
              </p>
            </div>
          ) : (
            filtered.map(c => <ComplaintCard key={c.id} c={c} schoolId={schoolId} showRemarksInput={showRemarksInput} />)
          )}
        </div>
        <button onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className={`absolute bottom-3 right-3 p-2 rounded-full bg-[#D4AF37] text-black shadow-lg transition-all duration-300 ${atTop ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"}`}
          title="Scroll to top" data-testid={`button-scroll-top-${tabKey}`}>
          <ArrowUp className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Tab Config ─────────────────────────────────────────────────────────────────
const TAB_CONFIG: {
  key: TabKey; label: string; icon: typeof Lock; subtitle: string; emptyMessage: string;
  accentBg: string; accentText: string; activeBorder: string; badgeBg: string; showRemarksInput?: boolean;
}[] = [
  { key: "private",    label: "Private Teacher Messages", icon: Lock, subtitle: "Direct messages from teachers — not visible to students",
    emptyMessage: "No teacher messages filed", accentBg: "bg-amber-900/10", accentText: "text-amber-400",
    activeBorder: "border-amber-500", badgeBg: "bg-amber-500/20 text-amber-200" },
  { key: "grievances", label: "Student Staff Grievances", icon: Shield, subtitle: "Filed directly by students — bypassed the staff member entirely",
    emptyMessage: "No student grievances filed", accentBg: "bg-blue-900/10", accentText: "text-blue-400",
    activeBorder: "border-blue-500", badgeBg: "bg-blue-500/20 text-blue-200" },
  { key: "escalated",  label: "Escalated Reports", icon: ArrowUpCircle, subtitle: "Peer reports escalated by teachers · Teacher complaints flagged for Admin",
    emptyMessage: "No escalated reports", accentBg: "bg-red-900/10", accentText: "text-red-400",
    activeBorder: "border-red-500", badgeBg: "bg-red-500/20 text-red-200", showRemarksInput: true },
];

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ComplaintHub({ schoolId, initialTab, onNavigateTab }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>((initialTab as TabKey) ?? "private");
  useEffect(() => {
    if (initialTab && (["private", "grievances", "escalated"] as string[]).includes(initialTab))
      setActiveTab(initialTab as TabKey);
  }, [initialTab]);
  const [tabFilters, setTabFilters] = useState<Record<TabKey, StatusFilter>>({
    private: "all", grievances: "all", escalated: "all",
  });

  const { data: all = [], isLoading } = useQuery<AdminComplaint[]>({
    queryKey: ["/api/complaints/school", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/complaints/school/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const privateTeacher    = all.filter(c => c.complaintType === "teacher-to-admin");
  const studentGrievances = all.filter(c => c.complaintType === "student-to-staff");
  const escalated         = all.filter(c =>
    (c.complaintType === "student-peer-report" && c.escalatedToPrincipal) ||
    (c.complaintType === "teacher-to-student" && c.notifyAdmin)
  );

  const countByKey: Record<TabKey, number> = {
    private: privateTeacher.length, grievances: studentGrievances.length, escalated: escalated.length,
  };
  const activeByKey: Record<TabKey, number> = {
    private: privateTeacher.filter(c => c.status !== "Resolved").length,
    grievances: studentGrievances.filter(c => c.status !== "Resolved").length,
    escalated: escalated.filter(c => c.status !== "Resolved").length,
  };
  const itemsByKey: Record<TabKey, AdminComplaint[]> = {
    private: privateTeacher, grievances: studentGrievances, escalated,
  };
  const totalActive = activeByKey.private + activeByKey.grievances + activeByKey.escalated;
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
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
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
          {TAB_CONFIG.map(t => activeByKey[t.key] > 0 && (
            <span key={t.key} className={`text-xs font-bold px-2 py-0.5 rounded-full ${t.badgeBg}`}>
              {t.label.split(" ")[0]}: {activeByKey[t.key]} active
            </span>
          ))}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#0A1628] border border-white/10" role="tablist" data-testid="complaint-tabs">
        {TAB_CONFIG.map(tab => {
          const isActive = activeTab === tab.key;
          const Icon = tab.icon;
          return (
            <button key={tab.key} role="tab" aria-selected={isActive} onClick={() => { setActiveTab(tab.key); onNavigateTab?.(tab.key); }} data-testid={`tab-${tab.key}`}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                isActive ? `bg-[#1A2942] ${tab.accentText} border-b-2 ${tab.activeBorder} shadow-sm` : "text-white/40 hover:text-white/70 hover:bg-white/5"
              }`}>
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline truncate">{tab.label}</span>
              {countByKey[tab.key] > 0 && (
                <span className={`flex-shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full ${isActive ? tab.badgeBg : "bg-white/10 text-white/50"}`}>
                  {countByKey[tab.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Tab Subtitle */}
      <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/10 ${activeConfig.accentBg}`}>
        <activeConfig.icon className={`w-4 h-4 flex-shrink-0 ${activeConfig.accentText}`} />
        <p className="text-xs text-white/60 font-medium">{activeConfig.subtitle}</p>
        <span className="ml-auto text-xs text-white/40 font-semibold tabular-nums">
          {countByKey[activeTab]} total · {activeByKey[activeTab]} active
        </span>
      </div>

      {/* Tab Panels */}
      {TAB_CONFIG.map(tab => (
        <div key={tab.key} className={activeTab === tab.key ? "block" : "hidden"} role="tabpanel" data-testid={`panel-${tab.key}`}>
          <TabPanel
            items={itemsByKey[tab.key]}
            schoolId={schoolId}
            emptyIcon={tab.icon}
            emptyMessage={tab.emptyMessage}
            showRemarksInput={tab.showRemarksInput}
            tabKey={tab.key}
            statusFilter={tabFilters[tab.key]}
            onFilterChange={f => setTabFilters(prev => ({ ...prev, [tab.key]: f }))}
          />
        </div>
      ))}
    </div>
  );
}
