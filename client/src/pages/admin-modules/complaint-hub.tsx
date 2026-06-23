import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { fmtDateTimeAmPm } from "@/lib/dateUtils";
import {
  MessageSquare, CheckCircle, Loader2, Lock, Shield, ArrowUpCircle,
  AlertTriangle, ChevronDown, ChevronUp, Clock, ArrowUp, Settings,
  Trash2, X, Save, Filter,
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

const RETENTION_OPTIONS: { label: string; days: number }[] = [
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
  { label: "1 year", days: 365 },
  { label: "Never delete", days: -1 },
];

const BULK_DELETE_OPTIONS: { label: string; days: number }[] = [
  { label: "Resolved > 30 days ago", days: 30 },
  { label: "Resolved > 60 days ago", days: 60 },
  { label: "Resolved > 90 days ago", days: 90 },
  { label: "Resolved > 180 days ago", days: 180 },
  { label: "All resolved (any age)", days: 1 },
];

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
                  <p className="text-xs font-bold text-slate-800">
                    Filed by: <span className="text-blue-700">{c.complainantName}</span>
                  </p>
                  {(c.complainantClass || c.complainantSection) && (
                    <p className="text-xs text-slate-500 font-semibold">
                      Class {c.complainantClass ?? "—"} · Section {c.complainantSection ?? "—"}
                    </p>
                  )}
                  {c.complainantPhone && (
                    <p className="text-xs text-slate-500 font-semibold">Phone: {c.complainantPhone}</p>
                  )}
                </div>
              )}
              {c.teacherName && (
                <p className="text-xs font-bold text-slate-800 mt-0.5">
                  Against: <span className="text-rose-700">{c.teacherName}</span>
                </p>
              )}
            </>
          ) : (
            <>
              {c.teacherName && (
                <p className="text-xs font-bold text-slate-800">From: {c.teacherName}</p>
              )}
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
              {(c.students?.length ?? 0) === 0 && c.studentName && (
                <p className="text-xs font-bold text-slate-800">Against: {c.studentName}</p>
              )}
              {c.reportedStudentName && !c.studentName && (c.students?.length ?? 0) === 0 && (
                <p className="text-xs font-bold text-slate-800">Against: {c.reportedStudentName}</p>
              )}
            </>
          )}

          <p className="text-slate-400 text-xs mt-0.5">
            {fmtDateTimeAmPm(c.createdAt)}
            {c.resolvedAt && (
              <span className="ml-2 text-emerald-500">· Resolved {fmtDateTimeAmPm(c.resolvedAt)}</span>
            )}
          </p>
        </div>
      </div>

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

      {c.resolutionRemarks && (
        <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
          <p className="text-xs font-bold text-emerald-700">Principal's Remarks</p>
          <p className="text-xs font-semibold text-emerald-900 mt-0.5">{c.resolutionRemarks}</p>
        </div>
      )}

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
  items, schoolId, emptyIcon: EmptyIcon, emptyMessage, showRemarksInput,
  statusFilter, onFilterChange,
}: {
  items: AdminComplaint[];
  schoolId: number;
  emptyIcon: typeof Lock;
  emptyMessage: string;
  showRemarksInput?: boolean;
  statusFilter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);

  const filtered = statusFilter === "all"
    ? items
    : items.filter(c => c.status === statusFilter);

  function handleScroll() {
    if (scrollRef.current) setAtTop(scrollRef.current.scrollTop < 80);
  }

  const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "Pending", label: "Pending" },
    { value: "Investigating", label: "Investigating" },
    { value: "Resolved", label: "Resolved" },
    { value: "Escalated", label: "Escalated" },
  ];

  const activeCounts: Partial<Record<StatusFilter, number>> = {};
  for (const s of ["Pending", "Investigating", "Resolved", "Escalated"] as StatusFilter[]) {
    activeCounts[s] = items.filter(c => c.status === s).length;
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="status-filter-bar">
        <Filter className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
        <span className="text-white/40 text-xs font-semibold mr-1">Filter:</span>
        {STATUS_FILTERS.map(f => {
          const cnt = f.value === "all" ? items.length : (activeCounts[f.value] ?? 0);
          if (f.value !== "all" && cnt === 0) return null;
          const isActive = statusFilter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => onFilterChange(f.value)}
              data-testid={`filter-${f.value}`}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all duration-150 ${
                isActive
                  ? "bg-[#D4AF37] text-black shadow-sm"
                  : "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white/80"
              }`}
            >
              {f.label}
              {cnt > 0 && <span className="ml-1 opacity-70">({cnt})</span>}
            </button>
          );
        })}
      </div>

      {/* Scrollable list */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="overflow-y-auto h-[500px] pr-1 space-y-3 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
          data-testid="tab-panel-scroll"
        >
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#1A2942]/60 py-12 text-center h-full flex flex-col items-center justify-center">
              <EmptyIcon className="w-8 h-8 mb-2 text-white/20" />
              <p className="text-white/30 text-xs font-semibold">
                {statusFilter !== "all" ? `No ${statusFilter} complaints` : emptyMessage}
              </p>
            </div>
          ) : (
            filtered.map(c => (
              <ComplaintCard key={c.id} c={c} schoolId={schoolId} showRemarksInput={showRemarksInput} />
            ))
          )}
        </div>

        <button
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className={`absolute bottom-3 right-3 p-2 rounded-full bg-[#D4AF37] text-black shadow-lg transition-all duration-300 ${atTop ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"}`}
          title="Scroll to top"
          data-testid="button-scroll-to-top"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </div>
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

function SettingsPanel({
  schoolId,
  onClose,
}: {
  schoolId: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [bulkDays, setBulkDays] = useState(30);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [pendingBulkDays, setPendingBulkDays] = useState<number | null>(null);
  const [localRetentionDays, setLocalRetentionDays] = useState<number | null>(null);

  const { data: policyData, isLoading: policyLoading } = useQuery<{ days: number }>({
    queryKey: ["/api/complaints/retention-policy"],
    queryFn: async () => {
      const r = await fetch("/api/complaints/retention-policy", { credentials: "include" });
      return r.ok ? r.json() : { days: -1 };
    },
    enabled: !!schoolId,
  });

  const currentDays = localRetentionDays ?? policyData?.days ?? -1;

  const saveRetentionMutation = useMutation({
    mutationFn: (days: number) =>
      apiRequest("POST", "/api/complaints/retention-policy", { days }),
    onSuccess: (_, days) => {
      toast({ title: "Retention policy saved", description: days === -1 ? "Complaints will never be auto-deleted." : `Resolved complaints older than ${days} days will be auto-deleted daily.` });
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/retention-policy"] });
      setLocalRetentionDays(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (olderThanDays: number) =>
      apiRequest("DELETE", "/api/complaints/bulk", { olderThanDays }),
    onSuccess: (data: { deleted: number }) => {
      toast({
        title: "Bulk delete complete",
        description: data.deleted === 0
          ? "No eligible complaints found to delete."
          : `${data.deleted} resolved complaint(s) permanently deleted.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/school", schoolId] });
      setShowBulkConfirm(false);
      setPendingBulkDays(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleBulkDeleteClick() {
    setPendingBulkDays(bulkDays);
    setShowBulkConfirm(true);
  }

  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-[#1A2942] p-5 space-y-6" data-testid="settings-panel">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#D4AF37]" />
            <h3 className="text-sm font-bold text-white">Complaint Hub Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
            data-testid="button-close-settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <hr className="border-white/10" />

        {/* Retention Policy */}
        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-bold text-[#D4AF37] uppercase tracking-widest mb-0.5">Retention Policy</h4>
            <p className="text-white/40 text-xs">Auto-delete resolved complaints after this period. Runs daily.</p>
          </div>
          {policyLoading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="retention-options">
              {RETENTION_OPTIONS.map(opt => {
                const isSelected = currentDays === opt.days;
                return (
                  <button
                    key={opt.days}
                    onClick={() => setLocalRetentionDays(opt.days)}
                    data-testid={`retention-option-${opt.days}`}
                    className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all duration-150 text-left ${
                      isSelected
                        ? "bg-[#D4AF37]/20 border-[#D4AF37] text-[#D4AF37]"
                        : "bg-[#0A1628]/60 border-white/10 text-white/50 hover:border-white/30 hover:text-white/80"
                    }`}
                  >
                    {isSelected && <span className="mr-1">✓</span>}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
          <Button
            size="sm"
            disabled={saveRetentionMutation.isPending || policyLoading || localRetentionDays === null}
            onClick={() => saveRetentionMutation.mutate(currentDays)}
            className="h-8 px-4 bg-[#D4AF37] hover:bg-[#B8962E] text-black font-bold text-xs rounded-lg disabled:opacity-40"
            data-testid="button-save-retention"
          >
            {saveRetentionMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
            Save Policy
          </Button>
        </div>

        <hr className="border-white/10" />

        {/* Manual Bulk Delete */}
        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-bold text-rose-400 uppercase tracking-widest mb-0.5">Manual Bulk Delete</h4>
            <p className="text-white/40 text-xs">Permanently delete <strong className="text-white/60">resolved</strong> complaints matching the selected age. This action is irreversible.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={bulkDays}
              onChange={e => setBulkDays(parseInt(e.target.value))}
              className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg bg-[#0A1628]/80 border border-white/10 text-white/80 text-xs font-semibold focus:outline-none focus:border-[#D4AF37]"
              data-testid="select-bulk-days"
            >
              {BULK_DELETE_OPTIONS.map(o => (
                <option key={o.days} value={o.days}>{o.label}</option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={handleBulkDeleteClick}
              className="h-8 px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg"
              data-testid="button-bulk-delete-open"
            >
              <Trash2 className="w-3 h-3 mr-1" /> Delete Selected
            </Button>
          </div>
        </div>
      </div>

      {/* Bulk Delete Confirmation Modal */}
      {showBulkConfirm && pendingBulkDays !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" data-testid="bulk-delete-modal">
          <div className="bg-[#1A2942] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-rose-500/20">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Confirm Bulk Deletion</h3>
                <p className="text-white/50 text-xs mt-0.5">This action cannot be undone</p>
              </div>
            </div>
            <div className="px-4 py-3 rounded-xl bg-rose-900/20 border border-rose-500/30">
              <p className="text-xs text-white/80 font-semibold">
                You are about to permanently delete all <span className="text-rose-300 font-bold">Resolved</span> complaints{" "}
                {pendingBulkDays === 1
                  ? <span className="text-rose-300 font-bold">regardless of age</span>
                  : <>older than <span className="text-rose-300 font-bold">{pendingBulkDays} days</span></>
                }.
              </p>
              <p className="text-xs text-white/50 mt-1">An audit log entry will be created recording this deletion.</p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowBulkConfirm(false); setPendingBulkDays(null); }}
                className="flex-1 h-9 text-white/60 hover:text-white font-bold text-xs border border-white/10 rounded-xl"
                data-testid="button-bulk-cancel"
                disabled={bulkDeleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => bulkDeleteMutation.mutate(pendingBulkDays)}
                disabled={bulkDeleteMutation.isPending}
                className="flex-1 h-9 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl"
                data-testid="button-bulk-confirm"
              >
                {bulkDeleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Trash2 className="w-3.5 h-3.5 mr-1" /> Yes, Delete Permanently</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ComplaintHub({ schoolId }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("private");
  const [showSettings, setShowSettings] = useState(false);
  const [tabFilters, setTabFilters] = useState<Record<TabKey, StatusFilter>>({
    private: "all",
    grievances: "all",
    escalated: "all",
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

  function setFilterForTab(tab: TabKey, filter: StatusFilter) {
    setTabFilters(prev => ({ ...prev, [tab]: filter }));
  }

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
          {TAB_CONFIG.map(t =>
            activeByKey[t.key] > 0 && (
              <span key={t.key} className={`text-xs font-bold px-2 py-0.5 rounded-full ${t.badgeBg}`}>
                {activeByKey[t.key]} active
              </span>
            )
          )}
          <button
            onClick={() => setShowSettings(v => !v)}
            data-testid="button-toggle-settings"
            className={`p-2 rounded-xl border transition-all duration-200 ${
              showSettings
                ? "bg-[#D4AF37]/20 border-[#D4AF37] text-[#D4AF37]"
                : "bg-white/5 border-white/10 text-white/40 hover:text-white/80 hover:border-white/30"
            }`}
            title="Complaint Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Settings Panel ── */}
      {showSettings && (
        <SettingsPanel schoolId={schoolId} onClose={() => setShowSettings(false)} />
      )}

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

      {/* ── Tab Panels ── */}
      {TAB_CONFIG.map(tab => (
        <div
          key={tab.key}
          className={activeTab === tab.key ? "block" : "hidden"}
          role="tabpanel"
          data-testid={`panel-${tab.key}`}
        >
          <TabPanel
            items={itemsByKey[tab.key]}
            schoolId={schoolId}
            emptyIcon={tab.icon}
            emptyMessage={tab.emptyMessage}
            showRemarksInput={tab.showRemarksInput}
            statusFilter={tabFilters[tab.key]}
            onFilterChange={f => setFilterForTab(tab.key, f)}
          />
        </div>
      ))}
    </div>
  );
}
