import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  GraduationCap, ChevronLeft, AlertTriangle, CheckCircle2,
  Clock, Lock, Shield, Users, TrendingUp, UserX, Award,
  Loader2, Play, CheckSquare, RefreshCw, Trash2,
  Bell, Search, ChevronDown, ChevronRight, Filter, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  apiRequestForViewSession,
  queryClient,
  sessionFetchForViewSession,
} from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";
import {
  getPromotionPreview,
  summarizePromotionPreviews,
  type PromotionReadiness,
} from "@/lib/examination-promotion-preview";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LedgerRow {
  class: string; section: string; term: string;
  status: "none" | "draft" | "locked";
  totalStudents: number; lockedCount: number; manualInterventionCount: number;
  teacherName: string | null; teacherId: number | null;
  lockedAt: string | null;
  // adminExecuted = true ONLY when ALL students in this cohort have been fully executed
  adminExecuted: boolean;
  // Tripartite student-level state counts
  executedCount: number;  // admin finalized these students through wizard
  readyCount: number;     // execution-compatible teacher-locked students
  pendingCount: number;   // missing or unlocked decisions
  ineligibleCount: number;
  historicalCount: number;
  readyStudentIds: number[];
  pendingStudentIds: number[];
  ineligibleStudentIds: number[];
  historicalStudentIds: number[];
  executedStudentIds: number[];
}

interface LedgerDecision {
  studentId: number; decision: string; targetClass: string; targetSection: string;
  autoSuggestion: string | null; manualIntervention: boolean;
  locked: boolean; lockedAt: string | null;
}

interface FinalDecisionRecord {
  readiness: "ready" | "pending" | "blocked" | "historical" | "executed";
  code?: string;
  message?: string;
  teacherRecommendation: {
    status: "PROMOTE" | "RETAIN";
    nextClass: string;
    nextSection: string;
  } | null;
  proposal: {
    eventId: number;
    status: "PROMOTE" | "RETAIN";
    nextClass: string;
    nextSection: string;
    reason: string;
    actorId: number;
    actorRole: "admin" | "support_staff";
    createdAt: string;
  } | null;
  finalDecision: {
    status: "PROMOTE" | "RETAIN" | null;
    nextClass: string;
    nextSection: string;
  } | null;
  overrideApplied: boolean | null;
  execution: {
    targetSessionId: number;
    executedAt: string | null;
    actorId: number | null;
    actorRole: "admin" | "support_staff" | null;
    evidenceStatus: "atomic" | "legacy";
  } | null;
}

interface AggStudent {
  studentId: number; dsid: string; name: string;
  totalObtained: number; totalMax: number; percentage: number | null; resultStatus: "complete" | "incomplete"; subjects: string[];
  gradeLabel: string | null; gradePoint: string | null; gradeRemarks: string | null;
  tierPassThreshold: number;
  ledger: LedgerDecision | null;
  finalDecision: FinalDecisionRecord | null;
}

interface PromotionOverrideAudit {
  reason: string;
  actorId: number;
  actorRole: "admin" | "support_staff";
  createdAt: string;
}

interface AggData {
  students: AggStudent[];
  finalDecisions: Array<FinalDecisionRecord & { studentId: number }>;
  overrides: {
    studentId: number;
    overrideStatus: string;
    nextClass: string;
    nextSection: string;
    audit: PromotionOverrideAudit | null;
    isProposal: boolean;
  }[];
  overrideSessionIsolation?: "SESSION_AWARE" | "SCHEMA_MIGRATION_REQUIRED";
  missingSubjects: string[];
  passThreshold: number;
}

interface AcademicSessionOption {
  id: number;
  sessionName: string;
  status: string;
  isActive: boolean;
}

type AdminDecision = "promote" | "retain" | "grace_pass";
interface AdminOverride {
  status: AdminDecision;
  nextClass: string;
  nextSection: string;
  rawStatus: string;
  audit: PromotionOverrideAudit | null;
  isProposal: boolean;
}
type OverrideSaveItem = {
  studentId: number;
  dec: "promote" | "retain";
  nextClass: string;
  nextSection: string;
};
type OverrideReasonAction =
  | { kind: "save"; items: OverrideSaveItem[]; bulk: boolean }
  | { kind: "clear"; studentId: number };

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  schoolId: number;
  classes: string[];
  sections: string[];
  examTypes: string[];
  allowedSubs?: string[];
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatOverrideAuditTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Recorded time unavailable";
  return `${new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date)} IST`;
}

function nxtCls(cls: string, classList: string[]): string {
  if (classList.length > 0) {
    const idx = classList.findIndex(c => c.trim().toLowerCase() === cls.trim().toLowerCase());
    if (idx !== -1 && idx < classList.length - 1) return classList[idx + 1];
    if (idx === classList.length - 1) return cls;
  }
  const n = parseInt(cls, 10);
  return isNaN(n) ? cls : String(n + 1);
}

type ChipColor = "blue" | "emerald" | "amber" | "slate" | "purple" | "red";
const CHIP: Record<ChipColor, string> = {
  blue:    "bg-blue-500/20 text-blue-300 border-blue-500/30",
  emerald: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  amber:   "bg-amber-500/20 text-amber-300 border-amber-500/30",
  slate:   "bg-slate-500/20 text-slate-400 border-slate-500/30",
  purple:  "bg-purple-500/20 text-purple-300 border-purple-500/30",
  red:     "bg-red-500/20 text-red-300 border-red-500/30",
};
function Chip({ c, icon, label, onClick, active }: { c: ChipColor; icon?: ReactNode; label: string; onClick?: () => void; active?: boolean }) {
  const base = `inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${CHIP[c]}`;
  const interactive = onClick ? " cursor-pointer transition-all duration-150 hover:brightness-125 select-none" : "";
  const ring = active ? " ring-2 ring-offset-1 ring-offset-[#0A1628] ring-current scale-105 shadow-lg" : "";
  return (
    <span className={base + interactive + ring} onClick={onClick} role={onClick ? "button" : undefined}>
      {icon}{label}
    </span>
  );
}

// ── Tripartite fractional pills for each section row ──────────────────────────
// Show the full mixed-cohort readiness breakdown, not just whether a ledger is locked.
function LedgerPills({ row }: { row: LedgerRow }) {
  if (row.totalStudents === 0)
    return <Chip c="slate" icon={<Clock className="w-3 h-3"/>} label="Not Started" />;
  return (
    <div className="flex flex-wrap gap-1">
      {row.executedCount > 0 && (
        <Chip c="blue" icon={<CheckCircle2 className="w-3 h-3"/>}
          label={`${row.executedCount} Executed`} />
      )}
      {row.readyCount > 0 && (
        <Chip c="emerald" icon={<Lock className="w-3 h-3"/>}
          label={`${row.readyCount} Ready`} />
      )}
      {row.ineligibleCount > 0 && (
        <Chip c="red" icon={<AlertTriangle className="w-3 h-3"/>}
          label={`${row.ineligibleCount} Requires Review`} />
      )}
      {row.pendingCount > 0 && (
        <Chip c="amber" icon={<Clock className="w-3 h-3"/>}
          label={`${row.pendingCount} Pending`} />
      )}
      {row.historicalCount > 0 && (
        <Chip c="slate" icon={<Lock className="w-3 h-3"/>}
          label={`${row.historicalCount} Historical`} />
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExamController({ examTypes, classes: schoolClasses, sections: schoolSections, allowedSubs }: Props) {
  const canWizard = allowedSubs === undefined || allowedSubs.includes("wizard");
  const { toast } = useToast();
  const { isArchiveMode, selectedSession } = useSessionView();
  const selectedSessionId = selectedSession?.id ?? null;
  const requireSelectedSessionId = () => {
    if (selectedSessionId === null) {
      throw new Error("Select an Academic Session before using the Exam Controller.");
    }
    return selectedSessionId;
  };
  const { data: academicSessions = [], isLoading: sessionsLoading, isError: sessionsError } =
    useQuery<AcademicSessionOption[]>({
      queryKey: ["/api/admin/academic-sessions"],
      queryFn: async ({ signal }) => {
        const response = await fetch("/api/admin/academic-sessions", { signal });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error((body as any)?.message ?? "Failed to load Academic Sessions");
        }
        return response.json();
      },
      staleTime: 60_000,
    });
  const eligibleTargetSessions = useMemo(
    () => academicSessions.filter(session =>
      session.id !== selectedSessionId && session.status.toLowerCase() !== "archived",
    ),
    [academicSessions, selectedSessionId],
  );

  // ── Core view state ───────────────────────────────────────────────────────
  const [view, setView]                 = useState<"table"|"wizard">("table");
  const [selectedTerm, setSelectedTerm] = useState("");
  const [cohort, setCohort]             = useState<LedgerRow | null>(null);
  const [examType, setExamType]         = useState(examTypes[0] ?? "");
  const [step, setStep]                 = useState<1|2|3>(1);
  const [targetSessionId, setTargetSessionId] = useState<number | null>(null);
  const [overrides, setOverrides]       = useState<Record<number, AdminOverride>>({});
  const [confirmed, setConfirmed]       = useState(false);
  const [selectedStudents,  setSelectedStudents]  = useState<Set<number>>(new Set());
  const [savingStudents,    setSavingStudents]    = useState<Set<number>>(new Set());
  const [showResetConfirm, setShowResetConfirm]  = useState(false);
  const [overrideReasonAction, setOverrideReasonAction] = useState<OverrideReasonAction | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideReasonError, setOverrideReasonError] = useState("");
  const [resetAllReason, setResetAllReason] = useState("");
  const [resetAllReasonError, setResetAllReasonError] = useState("");
  // Snapshot of which students are targeted for Step 3 execution.
  // null = entire cohort; non-null Set = only those IDs.
  const [executionScope, setExecutionScope]      = useState<Set<number> | null>(null);

  // ── Step-2 filter state ───────────────────────────────────────────────────
  const [filterText,     setFilterText]     = useState("");
  const [filterPctOp,    setFilterPctOp]    = useState<"gte"|"lte">("gte");
  const [filterPctVal,   setFilterPctVal]   = useState("");
  const [filterDecision, setFilterDecision] = useState<"all"|"promote"|"retain">("all");

  // ── Filter + accordion state ──────────────────────────────────────────────
  const [searchText, setSearchText]         = useState("");
  const [filterClass, setFilterClass]       = useState("all");
  const [filterSection, setFilterSection]   = useState("all");
  const [statusFilter, setStatusFilter]     = useState<"all"|"ready"|"pending">("all");
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [remindingKey, setRemindingKey]     = useState("");
  const [termToDelete, setTermToDelete]     = useState<string | null>(null);
  const selectedTargetSession = useMemo(
    () => eligibleTargetSessions.find(session => session.id === targetSessionId) ?? null,
    [eligibleTargetSessions, targetSessionId],
  );

  useEffect(() => {
    setTargetSessionId(null);
    setConfirmed(false);
  }, [selectedSessionId]);

  const toggleStatusFilter = (f: "ready"|"pending") =>
    setStatusFilter(prev => prev === f ? "all" : f);

  // ── Fetch terms — all exam types from school setup (strictly school-scoped) ──
  const { data: terms = [], refetch: refetchTerms } = useQuery<string[]>({
    queryKey: ["/api/admin/ledger-terms"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Auto-select first term when the list loads or changes
  useEffect(() => {
    if (!selectedTerm && terms.length > 0) setSelectedTerm(terms[0]);
  }, [terms, selectedTerm]);

  // ── Fetch ledger status rows ──────────────────────────────────────────────
  const { data: ledgerRows = [], isLoading: ledgerLoading, refetch: refetchLedger } = useQuery<LedgerRow[]>({
    queryKey: ["/api/admin/ledger-status", selectedSessionId, selectedTerm],
    queryFn: async ({ queryKey, signal }) => {
      const [, querySessionId, queryTerm] = queryKey as [string, number | null, string];
      if (querySessionId === null || !queryTerm) return [];
      const r = await sessionFetchForViewSession(
        `/api/admin/ledger-status?term=${encodeURIComponent(queryTerm)}`,
        querySessionId,
        { signal },
      );
      return r.ok ? r.json() : [];
    },
    enabled: selectedSessionId !== null && !!selectedTerm,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Auto-expand classes that have pending sections when data loads
  useEffect(() => {
    if (ledgerRows.length === 0) return;
    const pending = new Set(
      ledgerRows.filter(r => r.status !== "locked" && !r.adminExecuted).map(r => r.class)
    );
    setExpandedClasses(pending.size > 0 ? pending : new Set(ledgerRows.map(r => r.class)));
  }, [ledgerRows.length, selectedTerm]);

  // ── Fetch aggregated student data (wizard) ────────────────────────────────
  const { data: agg, isLoading: aggLoading, isError: aggError, error: aggQueryError } = useQuery<AggData | null>({
    queryKey: ["/api/admin/exam/aggregated", selectedSessionId, cohort?.class, cohort?.section, examType, cohort?.term],
    queryFn: async ({ queryKey, signal }) => {
      const [, querySessionId, queryClass, querySection, queryExamType, queryTerm] = queryKey as [
        string, number | null, string | undefined, string | undefined, string | undefined, string | undefined,
      ];
      if (querySessionId === null || !queryClass || !querySection || !queryExamType || !queryTerm) return null;
      const p = new URLSearchParams({ class: queryClass, section: querySection, examType: queryExamType, term: queryTerm });
      const r = await sessionFetchForViewSession(`/api/admin/exam/aggregated?${p}`, querySessionId, { signal });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as any)?.message ?? "Unable to resolve this Promotion cohort safely.");
      }
      return r.json();
    },
    enabled: selectedSessionId !== null && !!cohort && !!examType,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const overridesAvailable = !!agg && agg.overrideSessionIsolation === "SESSION_AWARE";
  const hasExecutedOverrides = !!agg && !!cohort && agg.overrides.some(override =>
    override.isProposal && cohort.executedStudentIds.includes(override.studentId),
  );
  const hasProposedOverrides = Object.values(overrides).some(override => override.isProposal);

  // ── Filtered student list (client-side, AND logic) ────────────────────────
  const filteredStudents = useMemo(() => {
    if (!agg) return [];
    return agg.students.filter(s => {
      if (filterText) {
        const q = filterText.toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.dsid.toLowerCase().includes(q)) return false;
      }
      if (filterPctVal !== "") {
        const pct = parseFloat(filterPctVal);
        if (!isNaN(pct)) {
          if (s.percentage === null) return false;
          if (filterPctOp === "gte" && s.percentage < pct) return false;
          if (filterPctOp === "lte" && s.percentage > pct) return false;
        }
      }
      if (filterDecision !== "all") {
        const dec = s.ledger?.decision;
        if (filterDecision === "promote" && dec !== "promoted") return false;
        if (filterDecision === "retain"  && dec === "promoted") return false;
      }
      return true;
    });
  }, [agg, filterText, filterPctOp, filterPctVal, filterDecision]);
  const hasFilters = filterText !== "" || filterPctVal !== "" || filterDecision !== "all";

  // Seed overrides from the selected-session API response. The raw value is kept
  // so legacy outcomes remain visible without presenting them as new choices.
  useEffect(() => {
    if (agg?.overrideSessionIsolation !== "SESSION_AWARE") {
      setOverrides({});
      return;
    }
    const seed: Record<number, AdminOverride> = {};
    for (const ov of agg?.overrides ?? []) {
      seed[ov.studentId] = {
        status: ov.overrideStatus === "PROMOTE" || ov.overrideStatus === "PASS"
          ? "promote"
          : ov.overrideStatus === "GRACE_PASS" ? "grace_pass" : "retain",
        nextClass: ov.nextClass,
        nextSection: ov.nextSection,
        rawStatus: ov.overrideStatus,
        audit: ov.audit ?? null,
        isProposal: ov.isProposal,
      };
    }
    setOverrides(seed);
  }, [agg]);

  // ── Delete term mutation ──────────────────────────────────────────────────
  const deleteTermMut = useMutation({
    mutationFn: async (term: string) => {
      const res = await apiRequestForViewSession(
        "DELETE",
        `/api/admin/ledger-term/${encodeURIComponent(term)}`,
        undefined,
        requireSelectedSessionId(),
      );
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any)?.message ?? "Failed to delete term"); }
      return res.json();
    },
    onSuccess: (d, term) => {
      toast({ title: "Term ledger purged", description: d.message, duration: 4000 });
      if (selectedTerm === term) setSelectedTerm("");
      setTermToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ledger-terms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ledger-status"] });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  // ── Reminder mutations ────────────────────────────────────────────────────
  const reminderMut = useMutation({
    mutationFn: async ({ className, section }: { className: string; section: string }) => {
      const res = await apiRequestForViewSession(
        "POST",
        "/api/admin/send-ledger-reminder",
        { className, section, term: selectedTerm },
        requireSelectedSessionId(),
      );
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any)?.message ?? "Failed"); }
      return res.json();
    },
    onSuccess: (d) => { toast({ title: "📨 Notice Dispatched", description: d.message }); setRemindingKey(""); },
    onError: (e: Error) => { toast({ title: "Dispatch Failed", description: e.message, variant: "destructive" }); setRemindingKey(""); },
  });

  // ── Principal override writes are audited and remain separate from execution ─
  const OVERRIDE_TO_STATUS: Record<"promote" | "retain", "PROMOTE" | "RETAIN"> = {
    promote: "PROMOTE",
    retain: "RETAIN",
  };

  const overrideSaveMut = useMutation({
    mutationFn: async ({ studentId, dec, nextClass, nextSection, reason }: OverrideSaveItem & { reason: string }) => {
      if (!cohort) throw new Error("No cohort");
      const res = await apiRequestForViewSession("POST", "/api/admin/exam/override", {
        studentId,
        examType,
        class: cohort.class,
        section: cohort.section,
        overrideStatus: OVERRIDE_TO_STATUS[dec],
        nextClass,
        nextSection,
        reason,
      }, requireSelectedSessionId());
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any)?.message ?? "Save failed"); }
      return res.json();
    },
    onSuccess: (_, { studentId, dec }) => {
      setSavingStudents(prev => { const n = new Set(prev); n.delete(studentId); return n; });
      toast({
        title: "Override saved — NOT YET EXECUTED",
        description: `Saved ${dec === "promote" ? "Promote" : "Retain"} separately from the Teacher recommendation.`,
        duration: 2500,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/exam/aggregated"] });
    },
    onError: (e: Error, { studentId }) => {
      setSavingStudents(prev => { const n = new Set(prev); n.delete(studentId); return n; });
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const overrideClearMut = useMutation({
    mutationFn: async ({ studentId, reason }: { studentId: number; reason: string }) => {
      if (!cohort) throw new Error("No cohort");
      const res = await apiRequestForViewSession("DELETE", "/api/admin/exam/override", {
        studentId, examType, class: cohort.class, section: cohort.section, reason,
      }, requireSelectedSessionId());
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any)?.message ?? "Clear failed"); }
      return res.json();
    },
    onSuccess: (_, { studentId }) => {
      setSavingStudents(prev => { const n = new Set(prev); n.delete(studentId); return n; });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/exam/aggregated"] });
    },
    onError: (e: Error, { studentId }) => {
      setSavingStudents(prev => { const n = new Set(prev); n.delete(studentId); return n; });
      toast({ title: "Clear failed", description: e.message, variant: "destructive" });
    },
  });

  const bulkOverrideMut = useMutation({
    mutationFn: async ({ items, reason }: { items: OverrideSaveItem[]; reason: string }) => {
      if (!cohort) throw new Error("No cohort");
      const res = await apiRequestForViewSession("POST", "/api/admin/exam/override/bulk", {
        reason,
        items: items.map(item => ({
          studentId: item.studentId,
          examType,
          class: cohort.class,
          section: cohort.section,
          overrideStatus: OVERRIDE_TO_STATUS[item.dec],
          nextClass: item.nextClass,
          nextSection: item.nextSection,
        })),
      }, requireSelectedSessionId());
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any)?.message ?? "Bulk save failed"); }
      return res.json() as Promise<{ count: number }>;
    },
    onSuccess: (data, { items }) => {
      setSelectedStudents(new Set());
      setSavingStudents(prev => {
        const n = new Set(prev);
        items.forEach(item => n.delete(item.studentId));
        return n;
      });
      toast({
        title: "Bulk overrides saved — NOT YET EXECUTED",
        description: `${data.count} student${data.count !== 1 ? "s" : ""} updated. Saved overrides remain separate from Teacher decisions.`,
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/exam/aggregated"] });
    },
    onError: (e: Error, { items }) => {
      setSavingStudents(prev => {
        const n = new Set(prev);
        items.forEach(item => n.delete(item.studentId));
        return n;
      });
      toast({ title: "Bulk save failed", description: e.message, variant: "destructive" });
    },
  });

  const resetAllMut = useMutation({
    mutationFn: async ({ reason }: { reason: string }) => {
      if (!cohort) throw new Error("No cohort");
      const res = await apiRequestForViewSession("DELETE", "/api/admin/exam/override/cohort", {
        class: cohort.class, section: cohort.section, examType, reason,
      }, requireSelectedSessionId());
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any)?.message ?? "Reset failed"); }
      return res.json();
    },
    onSuccess: () => {
      setSelectedStudents(new Set());
      setShowResetConfirm(false);
      setResetAllReason("");
      setResetAllReasonError("");
      toast({ title: "Saved proposals cleared", description: "Legacy override records were left unchanged.", duration: 2500 });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/exam/aggregated"] });
    },
    onError: (e: Error) => {
      toast({ title: "Reset failed", description: e.message, variant: "destructive" });
    },
  });

  // ── Execute mutation ──────────────────────────────────────────────────────
  const executeMut = useMutation({
    mutationFn: async () => {
      if (!cohort || !agg) throw new Error("No cohort");
      if (!selectedTargetSession || targetSessionId === null) {
        throw new Error("Select a target Academic Session before preparing Promotion.");
      }
      // Never send Pending, Ineligible, Historical or already Executed Students.
      const targetStudents = agg.students.filter(student =>
        readinessForStudent(student) === "ready" &&
        student.finalDecision?.finalDecision !== null &&
        (executionScope === null || executionScope.has(student.studentId)),
      );
      if (targetStudents.length === 0) {
        throw new Error("There are no backend-approved Students ready for Promotion in this selection.");
      }
      if (targetStudents.some(student =>
        student.resultStatus !== "complete" ||
        !student.ledger?.locked ||
        !["promoted", "retained"].includes(student.ledger.decision) ||
        !student.finalDecision?.finalDecision,
      )) {
        throw new Error("Every selected Student needs a complete result and a server-validated final decision before Promotion can be prepared.");
      }
      const items = targetStudents.map(s => {
        const resolved = s.finalDecision!.finalDecision!;
        return {
          studentId: s.studentId, fromClass: cohort.class, fromSection: cohort.section,
          nextClass: resolved.nextClass, nextSection: resolved.nextSection, examType: cohort.term,
          totalObtained: 0, totalMax: 100, percentage: 0,
          gradeLabel: null, gradePoint: null, gradeRemarks: null,
        };
      });
      const res = await apiRequestForViewSession(
        "POST",
        "/api/admin/promote",
        { term: cohort.term, targetSessionId, items },
        requireSelectedSessionId(),
      );
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any)?.message ?? "Failed"); }
      return res.json();
    },
    onSuccess: (d) => {
      toast({
        title: d.idempotent ? "Promotion Already Prepared" : "Promotion Prepared",
        description: d.idempotent
          ? `${d.alreadyPrepared} student(s) were already prepared for ${d.targetSessionName}. No changes were made.`
          : `${d.prepared} student(s) newly prepared${d.alreadyPrepared ? `; ${d.alreadyPrepared} already prepared` : ""} for ${d.targetSessionName}. Student Registry placement and source enrollment remain unchanged.`,
        duration: 6000,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ledger-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/exam/aggregated"] });
      closeWizard();
    },
    onError: (e: Error) => toast({ title: "Execution failed", description: e.message, variant: "destructive" }),
  });

  // ── KPI stats — tripartite state machine ──────────────────────────────────
  // lockedReady  = sections with at least one execution-compatible student
  // executed     = sections where EVERY student has been wizard-executed (fully done)
  // pending      = sections containing Students with missing or unlocked decisions
  const kpi = useMemo(() => {
    const totalClasses  = new Set(ledgerRows.map(r => r.class)).size;
    const totalSections = ledgerRows.length;
    const lockedReady   = ledgerRows.filter(r => r.readyCount > 0).length;
    const executed      = ledgerRows.filter(r => r.adminExecuted).length;
    const pending       = ledgerRows.filter(r => r.pendingCount > 0).length;
    const needsReview   = ledgerRows.filter(r => r.ineligibleCount > 0).length;
    const inProgress    = ledgerRows.filter(r => r.status === "draft").length;
    const notStarted    = ledgerRows.filter(r => r.status === "none").length;
    return { totalClasses, totalSections, lockedReady, executed, pending, needsReview, inProgress, notStarted };
  }, [ledgerRows]);

  // ── Filter options — live from school setup (props from school_metadata) ──
  // Classes: always use school-configured list, not ledger rows
  const allClassOptions = useMemo(() => schoolClasses, [schoolClasses]);
  // Sections: all school-configured sections when no class selected;
  //           narrow to sections that exist for the chosen class in ledger rows
  const allSectionOptions = useMemo(() => {
    if (filterClass === "all") {
      // Use school_metadata sections directly — the source of truth
      return [...schoolSections].sort();
    }
    // For a specific class, only show sections that appear in ledger rows
    return [...new Set(ledgerRows.filter(r => r.class === filterClass).map(r => r.section))].sort();
  }, [ledgerRows, filterClass, schoolSections]);

  // ── Filtered + grouped rows ───────────────────────────────────────────────
  const filteredRows = useMemo(() => ledgerRows.filter(row => {
    if (filterClass !== "all" && row.class !== filterClass) return false;
    if (filterSection !== "all" && row.section !== filterSection) return false;
    // "ready"   = at least one locked-not-executed student (even if partially executed)
    if (statusFilter === "ready"   && row.readyCount === 0) return false;
    // "pending" = at least one Student still has a missing or unlocked decision
    if (statusFilter === "pending" && row.pendingCount === 0) return false;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      if (!row.class.toLowerCase().includes(q) &&
          !row.section.toLowerCase().includes(q) &&
          !(row.teacherName?.toLowerCase().includes(q) ?? false)) return false;
    }
    return true;
  }), [ledgerRows, filterClass, filterSection, statusFilter, searchText]);

  const groupedRows = useMemo(() => {
    const groups: Record<string, LedgerRow[]> = {};
    for (const row of filteredRows) {
      if (!groups[row.class]) groups[row.class] = [];
      groups[row.class].push(row);
    }
    return groups;
  }, [filteredRows]);

  function teacherReadinessForStudent(student: AggStudent): PromotionReadiness {
    if (cohort?.executedStudentIds?.includes(student.studentId)) return "executed";
    if (cohort?.readyStudentIds?.includes(student.studentId)) return "ready";
    if (cohort?.ineligibleStudentIds?.includes(student.studentId)) return "ineligible";
    if (cohort?.historicalStudentIds?.includes(student.studentId)) return "historical";
    return "pending";
  }

  function readinessForStudent(student: AggStudent): PromotionReadiness {
    if (!student.finalDecision) return "blocked";
    if (student.finalDecision.readiness === "historical") return "historical";
    if (student.finalDecision.readiness === "blocked") return "blocked";
    if (student.finalDecision.readiness === "executed") return "executed";
    if (student.finalDecision.readiness === "ready") return "ready";
    return "pending";
  }

  function canSaveOverride(student: AggStudent): boolean {
    return overridesAvailable &&
      student.resultStatus === "complete" &&
      teacherReadinessForStudent(student) === "ready" &&
      !cohort?.executedStudentIds?.includes(student.studentId);
  }

  function requestOverrideSave(items: OverrideSaveItem[], bulk: boolean) {
    if (items.length === 0) return;
    setOverrideReason("");
    setOverrideReasonError("");
    setOverrideReasonAction({ kind: "save", items, bulk });
  }

  function requestOverrideClear(studentId: number) {
    setOverrideReason("");
    setOverrideReasonError("");
    setOverrideReasonAction({ kind: "clear", studentId });
  }

  function submitOverrideReason() {
    const reason = overrideReason.trim();
    if (!reason || reason.length > 500) {
      setOverrideReasonError("Enter a reason of 1–500 characters.");
      return;
    }
    const action = overrideReasonAction;
    if (!action) return;
    setOverrideReasonAction(null);
    setOverrideReason("");
    setOverrideReasonError("");
    if (action.kind === "save") {
      setSavingStudents(prev => {
        const next = new Set(prev);
        action.items.forEach(item => next.add(item.studentId));
        return next;
      });
      if (action.bulk) {
        bulkOverrideMut.mutate({ items: action.items, reason });
      } else {
        overrideSaveMut.mutate({ ...action.items[0], reason });
      }
      return;
    }
    setSavingStudents(prev => new Set(prev).add(action.studentId));
    overrideClearMut.mutate({ studentId: action.studentId, reason });
  }

  function previewForStudent(student: AggStudent) {
    return getPromotionPreview({
      resultStatus: student.resultStatus,
      readiness: readinessForStudent(student),
      resolved: {
        readiness: student.finalDecision?.readiness ?? "blocked",
        finalDecision: student.finalDecision?.finalDecision ?? null,
      },
      ledgerDecision: student.ledger ? {
        decision: student.ledger.decision,
        targetClass: student.ledger.targetClass,
        targetSection: student.ledger.targetSection,
      } : null,
      sourceClass: cohort?.class ?? "",
      sourceSection: cohort?.section ?? "",
    });
  }

  function includeInPromotionSummary(student: AggStudent): boolean {
    if (executionScope === null || executionScope.has(student.studentId)) return true;
    return ["pending", "ineligible", "blocked", "historical", "executed"].includes(readinessForStudent(student));
  }

  // ── Dynamic counters for step 3 (scoped to executionScope when active) ──────
  const counters = useMemo(() => {
    if (!agg) {
      return { total: 0, promote: 0, retain: 0, grace: 0, pending: 0, review: 0, historical: 0, executed: 0, eligible: 0 };
    }
    const students = agg.students.filter(includeInPromotionSummary);
    const summary = summarizePromotionPreviews(students.map(previewForStudent));
    const eligible = agg.students.filter(student =>
      readinessForStudent(student) === "ready" &&
      (executionScope === null || executionScope.has(student.studentId)),
    ).length;
    return {
      total: students.length,
      promote: summary.promoted,
      retain: summary.retained,
      grace: summary.grace_pass,
      pending: summary.pending,
      review: summary.review,
      historical: summary.historical,
      executed: summary.executed,
      eligible,
    };
  }, [agg, cohort, overrides, executionScope]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function handleRefresh() { refetchTerms(); if (selectedTerm) refetchLedger(); }
  function toggleClass(cls: string) {
    setExpandedClasses(prev => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls); else next.add(cls);
      return next;
    });
  }
  function resetAuditFilters() {
    setFilterText(""); setFilterPctOp("gte"); setFilterPctVal(""); setFilterDecision("all");
  }
  function openWizard(row: LedgerRow) {
    if (!canWizard) return;
    setCohort(row);
    setExamType(row.term);
    setOverrides({}); setConfirmed(false); setStep(1); setTargetSessionId(null);
    setSelectedStudents(new Set()); setSavingStudents(new Set());
    setExecutionScope(null);
    resetAuditFilters();
    setView("wizard");
  }
  function closeWizard() {
    setView("table"); setCohort(null); setOverrides({}); setConfirmed(false); setStep(1); setTargetSessionId(null);
    setSelectedStudents(new Set()); setSavingStudents(new Set());
    setExecutionScope(null);
    resetAuditFilters();
  }
  function handleDestChange(studentId: number, field: "nextClass" | "nextSection", value: string, ov: AdminOverride) {
    const student = agg?.students.find(candidate => candidate.studentId === studentId);
    if (!student || !canSaveOverride(student) || (ov.status !== "promote" && ov.status !== "retain")) return;
    requestOverrideSave([{
      studentId,
      dec: ov.status,
      nextClass: field === "nextClass" ? value : ov.nextClass,
      nextSection: field === "nextSection" ? value : ov.nextSection,
    }], false);
  }

  function toggleOverride(studentId: number, dec: AdminDecision, s: AggStudent) {
    if ((dec !== "promote" && dec !== "retain") || !canSaveOverride(s)) return;
    if (overrides[studentId]?.status === dec) {
      requestOverrideClear(studentId);
      return;
    }
    const led = s.ledger;
    const nextClass = dec === "retain"
      ? (cohort?.class ?? "")
      : (led?.targetClass || nxtCls(cohort?.class ?? "", schoolClasses));
    const nextSection = dec === "retain"
      ? (cohort?.section ?? "")
      : (led?.targetSection || (cohort?.section ?? ""));
    requestOverrideSave([{ studentId, dec, nextClass, nextSection }], false);
  }
  function handleBulkOverride(dec: AdminDecision) {
    if (!overridesAvailable || !agg || !cohort || selectedStudents.size === 0 || bulkOverrideMut.isPending) return;
    if (dec !== "promote" && dec !== "retain") return;
    const selected = agg.students.filter(student => selectedStudents.has(student.studentId));
    if (selected.length !== selectedStudents.size || selected.some(student => !canSaveOverride(student))) {
      toast({
        title: "Overrides not saved",
        description: "Select only eligible Students with complete results and a valid locked Teacher decision.",
        variant: "destructive",
      });
      return;
    }
    const items = selected.map(student => ({
      studentId: student.studentId,
      dec,
      nextClass: dec === "retain"
        ? cohort.class
        : (student.ledger?.targetClass || nxtCls(cohort.class, schoolClasses)),
      nextSection: dec === "retain"
        ? cohort.section
        : (student.ledger?.targetSection || cohort.section),
    }));
    requestOverrideSave(items, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // VIEW B — Academic Advancement Wizard
  // ────────────────────────────────────────────────────────────────────────────
  if (view === "wizard" && cohort) return (
    <div className="space-y-5">

      {/* Back + title */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" className="border-[#1e2d44] text-slate-300 hover:bg-[#1A2942] h-9"
          onClick={closeWizard} data-testid="btn-back-to-table">
          <ChevronLeft className="w-4 h-4 mr-1" />Back
        </Button>
        <div>
          <h1 className="text-lg font-bold text-white">Academic Advancement Wizard</h1>
          <p className="text-xs text-slate-400">Class {cohort.class} — Section {cohort.section} — {cohort.term}</p>
        </div>
      </div>

      {/* Verified banner */}
      {cohort.teacherName && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-200">
            📝 Verified ledger submitted by{" "}
            <strong className="text-white">{cohort.teacherName}</strong>{" on "}
            <strong className="text-white">{fmt(cohort.lockedAt)}</strong>
          </p>
        </div>
      )}
      {aggError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
          {aggQueryError instanceof Error
            ? aggQueryError.message
            : "The Promotion cohort could not be resolved safely. Refresh or review the saved records."}
        </div>
      )}

      {/* Step tab bar */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: "#1A2942" }}>
        {([1,2,3] as const).map(s => (
          <button key={s} onClick={() => { if (s <= step) setStep(s); }}
            className={`flex-1 rounded-lg py-2.5 text-xs font-semibold transition-all ${step===s ? "text-[#0A1628]" : "text-slate-400 hover:text-slate-200"}`}
            style={step===s ? { background: "linear-gradient(135deg,#D4AF37,#b8972e)" } : {}}
            data-testid={`tab-step-${s}`}>
            Step {s} — {s===1 ? "Cohort Details" : s===2 ? "Audit & Review" : "Execute"}
          </button>
        ))}
      </div>

      {/* ── STEP 1: Cohort Details ─────────────────────────────────────────── */}
      {step === 1 && (
        <div className="rounded-2xl border border-[#1e2d44] p-6 space-y-5" style={{ background: "#1A2942" }}>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-[#D4AF37]" />Cohort Details
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { label: "Class",              val: `Class ${cohort.class}` },
              { label: "Section",            val: `Section ${cohort.section}` },
              { label: "Target Term / Exam", val: cohort.term },
            ].map(({ label, val }) => (
              <div key={label} className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">{label}</label>
                <div className="h-10 px-3 rounded-xl border border-[#1e2d44] bg-[#0A1628] flex items-center text-white text-sm font-medium">{val}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1">
            {[
              { label: "Total in Ledger",   val: cohort.totalStudents,          icon: <Users className="w-4 h-4 text-[#D4AF37]" /> },
              { label: "Locked Entries",    val: cohort.lockedCount,             icon: <Lock className="w-4 h-4 text-emerald-400" /> },
              { label: "Teacher Overrides", val: cohort.manualInterventionCount, icon: <AlertTriangle className="w-4 h-4 text-amber-400" /> },
            ].map(({ label, val, icon }) => (
              <div key={label} className="rounded-xl border border-[#1e2d44] bg-[#0A1628]/50 p-3 flex items-center gap-2.5">
                {icon}
                <div>
                  <p className="text-lg font-bold text-white">{val}</p>
                  <p className="text-xs text-slate-400">{label}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-1">
            <Button onClick={() => setStep(2)} disabled={!examType}
              className="h-9 px-6 font-semibold text-sm"
              style={{ background: examType ? "linear-gradient(135deg,#D4AF37,#b8972e)" : undefined, color: examType ? "#0A1628" : undefined }}
              data-testid="btn-step1-next">
              Next — Review Students →
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Audit & Discrepancy Table ─────────────────────────────── */}
      {step === 2 && (
        <div className="rounded-2xl border border-[#1e2d44] overflow-hidden" style={{ background: "#1A2942" }}>
          <div className="px-5 py-4 border-b border-[#1e2d44] flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />Audit & Discrepancy Review
            </h2>
            {cohort.manualInterventionCount > 0 && (
              <Chip c="amber" icon={<AlertTriangle className="w-3 h-3" />}
                label={`⚠️ ${cohort.manualInterventionCount} Teacher Override${cohort.manualInterventionCount > 1 ? "s" : ""} Detected`} />
            )}
          </div>

          {aggLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading student data…</span>
            </div>
          ) : !agg || agg.students.length === 0 ? (
            <div className="text-center py-14 text-slate-500">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-25" />
              <p className="text-sm">No exam scores found for Class {cohort.class}-{cohort.section} — {examType}.</p>
              <p className="text-xs mt-1">Ensure teachers have entered marks for this exam type.</p>
            </div>
          ) : (
            <>
              {agg.missingSubjects.length > 0 && (
                <div className="mx-5 mt-4 flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Missing subject data: {agg.missingSubjects.join(", ")}
                </div>
              )}
              {!overridesAvailable && (
                <div role="alert" className="mx-5 mt-3 flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Manual Promotion overrides are unavailable because saved override records do not identify an Academic Session. They are not applied or cleared until session-aware storage is approved.</span>
                </div>
              )}
              {/* ── Filter bar ─────────────────────────────────────────────── */}
              <div className="mx-5 mt-4 mb-1 flex flex-wrap items-center gap-2">
                {/* Text search */}
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={filterText}
                    onChange={e => setFilterText(e.target.value)}
                    placeholder="Search by Name or DSID…"
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[#1e2d44] bg-[#0A1628] text-white placeholder-slate-500 focus:outline-none focus:border-[#D4AF37]/50"
                    data-testid="filter-text-input"
                  />
                </div>
                {/* Percentage filter */}
                <div className="flex items-center gap-1">
                  <select
                    value={filterPctOp}
                    onChange={e => setFilterPctOp(e.target.value as "gte"|"lte")}
                    className="px-2 py-1.5 text-xs rounded-lg border border-[#1e2d44] bg-[#0A1628] text-white focus:outline-none focus:border-[#D4AF37]/50"
                    data-testid="filter-pct-op">
                    <option value="gte">Above (≥)</option>
                    <option value="lte">Below (≤)</option>
                  </select>
                  <input
                    type="number"
                    min={0} max={100}
                    value={filterPctVal}
                    onChange={e => setFilterPctVal(e.target.value)}
                    placeholder="% Value"
                    className="w-20 px-2 py-1.5 text-xs rounded-lg border border-[#1e2d44] bg-[#0A1628] text-white placeholder-slate-500 focus:outline-none focus:border-[#D4AF37]/50"
                    data-testid="filter-pct-val"
                  />
                </div>
                {/* Teacher decision */}
                <select
                  value={filterDecision}
                  onChange={e => setFilterDecision(e.target.value as "all"|"promote"|"retain")}
                  className="px-2 py-1.5 text-xs rounded-lg border border-[#1e2d44] bg-[#0A1628] text-white focus:outline-none focus:border-[#D4AF37]/50"
                  data-testid="filter-decision">
                  <option value="all">All Decisions</option>
                  <option value="promote">Promote</option>
                  <option value="retain">Retain</option>
                </select>
                {/* Reset filters */}
                {hasFilters && (
                  <button
                    onClick={resetAuditFilters}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors"
                    data-testid="btn-reset-filters">
                    <X className="w-3 h-3" />Reset Filters
                  </button>
                )}
                {/* Clear audited Web proposals only */}
                <button
                  onClick={() => {
                    setResetAllReason("");
                    setResetAllReasonError("");
                    setShowResetConfirm(true);
                  }}
                  disabled={!overridesAvailable || !hasProposedOverrides || hasExecutedOverrides}
                  title={hasExecutedOverrides ? "Overrides cannot be changed after Student execution." : undefined}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                  data-testid="btn-reset-all-overrides">
                  <RefreshCw className="w-3 h-3" />Clear Saved Proposals
                </button>
                <div className="ml-auto text-xs text-slate-500 whitespace-nowrap">
                  {hasFilters
                    ? <span><span className="text-white font-semibold">{filteredStudents.length}</span> / {agg.students.length} shown</span>
                    : <span><span className="text-white font-semibold">{agg.students.length}</span> student{agg.students.length !== 1 ? "s" : ""}</span>}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1e2d44]">
                      <th className="px-4 py-3 w-10">
                        <Checkbox
                          checked={
                            filteredStudents.some(canSaveOverride) &&
                            filteredStudents.filter(canSaveOverride).every(s => selectedStudents.has(s.studentId))
                          }
                          disabled={!filteredStudents.some(canSaveOverride)}
                          onCheckedChange={v => {
                            setSelectedStudents(prev => {
                              const n = new Set(prev);
                              if (v) filteredStudents.filter(canSaveOverride).forEach(s => n.add(s.studentId));
                              else   filteredStudents.forEach(s => n.delete(s.studentId));
                              return n;
                            });
                          }}
                          className="border-slate-500 data-[state=checked]:bg-[#D4AF37] data-[state=checked]:border-[#D4AF37]"
                          data-testid="checkbox-select-all"
                        />
                      </th>
                      {["DSID","Name","Marks","%","Ledger Eligibility","Teacher Decision","Admin Override"].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                          <Filter className="w-6 h-6 mx-auto mb-2 opacity-30" />
                          No students match the current filters.
                          <button onClick={resetAuditFilters} className="ml-2 text-[#D4AF37] underline text-xs">Reset</button>
                        </td>
                      </tr>
                    ) : filteredStudents.map((s, idx) => {
                      const led      = s.ledger;
                      const ov       = overrides[s.studentId];
                      const isManual = !!led?.manualIntervention;
                      const thresh   = s.tierPassThreshold ?? agg.passThreshold;
                      const passing  = s.percentage !== null && s.percentage >= thresh;
                      const ledgerReadiness = readinessForStudent(s);
                      const canEditOverride = canSaveOverride(s);
                      const isExecuted = ledgerReadiness === "executed";
                      return (
                        <tr key={s.studentId}
                          className={`border-b border-[#1e2d44]/50 transition-colors ${selectedStudents.has(s.studentId) ? "bg-[#D4AF37]/5" : isManual ? "bg-amber-500/5 hover:bg-amber-500/10" : idx%2===0 ? "hover:bg-[#0A1628]/30" : "bg-[#0A1628]/20 hover:bg-[#0A1628]/30"}`}
                          data-testid={`row-student-${s.studentId}`}>
                          <td className="px-4 py-3 w-10">
                            <Checkbox
                              checked={selectedStudents.has(s.studentId)}
                              disabled={!canEditOverride}
                              onCheckedChange={v => setSelectedStudents(prev => {
                                const n = new Set(prev);
                                if (v) n.add(s.studentId); else n.delete(s.studentId);
                                return n;
                              })}
                              className="border-slate-500 data-[state=checked]:bg-[#D4AF37] data-[state=checked]:border-[#D4AF37] disabled:opacity-30"
                              data-testid={`checkbox-select-${s.studentId}`}
                            />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-300">{s.dsid}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-white">{s.name}</p>
                            {isManual && led && (
                              <p className="text-xs text-amber-400 mt-0.5 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Teacher changed from{" "}
                                <strong className="capitalize">{led.autoSuggestion ?? "—"}</strong>
                                {" to "}
                                <strong className="capitalize">{led.decision}</strong>
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-white font-medium">
                            {s.resultStatus === "complete"
                              ? <>{s.totalObtained}<span className="text-slate-500">/{s.totalMax}</span></>
                              : <span className="text-amber-400 text-xs">Pending</span>}
                          </td>
                          <td className="px-4 py-3">
                            {s.resultStatus === "complete" && s.percentage !== null
                              ? <span className={`font-semibold ${passing ? "text-emerald-400" : "text-red-400"}`}>{s.percentage.toFixed(1)}%</span>
                              : <span className="text-amber-400 text-xs">Incomplete / Pending</span>}
                          </td>
                          <td className="px-4 py-3">
                            {ledgerReadiness === "ready" ? (
                              <Chip c="emerald" icon={<Lock className="w-3 h-3"/>} label="Ready" />
                            ) : ledgerReadiness === "blocked" ? (
                              <Chip c="red" icon={<AlertTriangle className="w-3 h-3"/>} label="Blocked · Review Required" />
                            ) : ledgerReadiness === "ineligible" ? (
                              <Chip c="red" icon={<AlertTriangle className="w-3 h-3"/>} label="Ineligible · Requires Review" />
                            ) : ledgerReadiness === "historical" ? (
                              <Chip c="slate" icon={<Lock className="w-3 h-3"/>} label="Historical · Read-only" />
                            ) : ledgerReadiness === "executed" ? (
                              <Chip c="blue" icon={<CheckCircle2 className="w-3 h-3"/>} label="Executed" />
                            ) : (
                              <Chip c="amber" icon={<Clock className="w-3 h-3"/>} label="Pending" />
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {led ? (
                              <div>
                                <Chip
                                  c={led.decision === "promoted" ? "emerald" : "red"}
                                  icon={led.decision === "promoted" ? <TrendingUp className="w-3 h-3"/> : <UserX className="w-3 h-3"/>}
                                  label={led.decision === "promoted" ? "↑ Promote" : "↺ Retain"}
                                />
                                <p className="text-xs text-slate-400 mt-1 pl-0.5 font-mono">
                                  {led.decision === "promoted" ? "→" : "↺"} Class {led.targetClass} — {led.targetSection}
                                </p>
                              </div>
                            ) : <span className="text-slate-500 text-xs">No ledger</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex gap-1.5 items-center flex-wrap">
                                {savingStudents.has(s.studentId) && (
                                  <Loader2 className="w-3 h-3 animate-spin text-[#D4AF37] shrink-0" />
                                )}
                                {(["promote", "retain"] as const).map(dec => (
                                  <button key={dec}
                                    onClick={() => toggleOverride(s.studentId, dec, s)}
                                    disabled={!canEditOverride || (!!ov && !ov.isProposal) || savingStudents.has(s.studentId)}
                                    data-testid={`btn-override-${dec}-${s.studentId}`}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border disabled:opacity-50 disabled:cursor-not-allowed ${
                                      ov?.status === dec
                                        ? dec === "promote"
                                          ? "bg-emerald-500 border-emerald-500 text-white"
                                          : "bg-red-500 border-red-500 text-white"
                                        : "bg-transparent border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white"
                                    }`}>
                                    {dec === "promote" ? "↑ Promote" : "↺ Retain"}
                                  </button>
                                ))}
                              </div>
                              {ov && (
                                <div className="rounded-lg border border-[#D4AF37]/20 bg-[#0A1628]/60 px-2.5 py-2 space-y-1.5"
                                  data-testid={`saved-override-${s.studentId}`}>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Chip
                                      c={ov.status === "promote" ? "emerald" : ov.status === "grace_pass" ? "purple" : "red"}
                                      label={
                                        ov.isProposal
                                          ? (ov.rawStatus === "PROMOTE" ? "Saved Promote" : "Saved Retain")
                                          : ov.rawStatus === "GRACE_PASS" ? "Legacy Grace" : `Legacy ${ov.rawStatus}`
                                      }
                                    />
                                    <span className="text-[10px] font-bold tracking-wide text-amber-300"
                                      data-testid={`status-override-not-executed-${s.studentId}`}>
                                      {isExecuted
                                        ? s.finalDecision?.overrideApplied === true
                                          ? "APPLIED IN EXECUTED DECISION"
                                          : s.finalDecision?.overrideApplied === false
                                            ? "NOT APPLIED · TEACHER DECISION EXECUTED"
                                            : "EXECUTION EVIDENCE UNAVAILABLE"
                                        : s.finalDecision?.readiness === "blocked"
                                          ? "BLOCKED · REVIEW REQUIRED"
                                          : s.finalDecision?.readiness === "historical"
                                            ? "HISTORICAL · READ ONLY"
                                          : "NOT YET EXECUTED"}
                                    </span>
                                  </div>
                                  {ov.audit ? (
                                    <p className="text-[10px] leading-relaxed text-slate-400"
                                      data-testid={`text-override-audit-${s.studentId}`}>
                                      Reason: {ov.audit.reason} · {ov.audit.actorRole === "admin" ? "Admin" : "Support Staff"} #{ov.audit.actorId}
                                      {" · "}{formatOverrideAuditTime(ov.audit.createdAt)}
                                    </p>
                                  ) : (
                                    <p className="text-[10px] leading-relaxed text-slate-500"
                                      data-testid={`text-override-legacy-${s.studentId}`}>
                                      Legacy override — no reason or actor was recorded.
                                    </p>
                                  )}
                                  <p className="text-[10px] text-slate-400">
                                    Saved proposal destination: Class {ov.nextClass} — {ov.nextSection}.
                                    {isExecuted && s.finalDecision?.overrideApplied === true ? " · this audited proposal was applied" : ""}
                                    {isExecuted && s.finalDecision?.overrideApplied === false ? " · this proposal was not applied" : ""}
                                    {isExecuted && s.finalDecision?.overrideApplied === null ? " · legacy execution; proposal application cannot be confirmed" : ""}
                                    {!isExecuted && s.finalDecision?.readiness === "ready" ? " · validated, pending execution" : ""}
                                  </p>
                                  {s.finalDecision?.readiness === "blocked" && s.finalDecision.message && (
                                    <p className="text-[10px] text-red-300" role="alert">{s.finalDecision.message}</p>
                                  )}
                                  {isExecuted && s.finalDecision?.execution?.evidenceStatus === "legacy" && (
                                    <p className="text-[10px] text-amber-300">
                                      Existing execution history predates atomic final-decision evidence.
                                    </p>
                                  )}
                                  {!isExecuted && ov.rawStatus === "GRACE_PASS" && (
                                    <p className="text-[10px] text-purple-300">
                                      Legacy Grace remains unchanged and does not authorize a new Promote/Retain execution.
                                    </p>
                                  )}
                                  <button
                                    onClick={() => requestOverrideClear(s.studentId)}
                                    disabled={isExecuted || !ov.isProposal || savingStudents.has(s.studentId) || !overridesAvailable}
                                    className="text-[10px] font-semibold text-red-300 hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                    data-testid={`btn-clear-override-${s.studentId}`}>
                                    Clear saved override (reason required)
                                  </button>
                                </div>
                              )}
                              {ov && cohort && ov.status !== "grace_pass" && (
                                <div className="flex gap-1.5 items-center flex-wrap pl-0.5" data-testid={`dest-selectors-${s.studentId}`}>
                                  <select
                                    value={ov.nextClass}
                                     disabled={!canEditOverride || (!!ov && !ov.isProposal) || ov.status === "retain" || savingStudents.has(s.studentId)}
                                    onChange={e => handleDestChange(s.studentId, "nextClass", e.target.value, ov)}
                                    className="px-2 py-1 text-xs rounded-md border border-[#1e2d44] bg-[#0A1628] text-white focus:outline-none focus:border-[#D4AF37]/60 disabled:opacity-50 disabled:cursor-not-allowed"
                                    data-testid={`select-nextclass-${s.studentId}`}>
                                    {ov.status === "retain"
                                      ? <option value={cohort.class}>Class {cohort.class}</option>
                                      : schoolClasses.map(c => <option key={c} value={c}>Class {c}</option>)
                                    }
                                  </select>
                                  <select
                                    value={ov.nextSection}
                                     disabled={!canEditOverride || (!!ov && !ov.isProposal) || ov.status === "retain" || savingStudents.has(s.studentId)}
                                    onChange={e => handleDestChange(s.studentId, "nextSection", e.target.value, ov)}
                                    className="px-2 py-1 text-xs rounded-md border border-[#1e2d44] bg-[#0A1628] text-white focus:outline-none focus:border-[#D4AF37]/60 disabled:opacity-50 disabled:cursor-not-allowed"
                                    data-testid={`select-nextsection-${s.studentId}`}>
                                    {schoolSections.map(sec => <option key={sec} value={sec}>Sec {sec}</option>)}
                                  </select>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    </tbody>
                </table>
              </div>
              <div className="px-5 py-4 border-t border-[#1e2d44] flex justify-between items-center">
                <p className="text-xs text-slate-500">
                  {agg.students.length} student(s) — Promote/Retain changes require a reason; clear and reset actions are audited
                  {selectedStudents.size > 0 && <span className="ml-2 text-[#D4AF37] font-semibold">· {selectedStudents.size} selected</span>}
                </p>
                <Button
                  onClick={() => {
                    const eligibleIds = cohort?.readyStudentIds ?? [];
                    const scopedEligibleIds = selectedStudents.size > 0
                      ? eligibleIds.filter(id => selectedStudents.has(id))
                      : eligibleIds;
                    setExecutionScope(new Set(scopedEligibleIds));
                    setConfirmed(false);
                    setStep(3);
                  }}
                  className="h-9 px-6 font-semibold text-sm"
                  style={{ background: "linear-gradient(135deg,#D4AF37,#b8972e)", color: "#0A1628" }}
                  disabled={isArchiveMode}
                  data-testid="btn-step2-next">
                  {selectedStudents.size > 0
                    ? `Next — Review ${cohort?.readyStudentIds.filter(id => selectedStudents.has(id)).length ?? 0} Eligible →`
                    : `Next — Review ${cohort?.readyCount ?? 0} Eligible →`}
                </Button>
              </div>

              {/* ── Reset-all confirmation dialog ───────────────────────────── */}
              {showResetConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                  data-testid="reset-confirm-overlay">
                  <div className="rounded-2xl border border-red-500/30 bg-[#1A2942] p-6 max-w-sm w-full mx-4 shadow-2xl">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                        <RefreshCw className="w-5 h-5 text-red-400" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white text-sm">Clear Saved Proposals?</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Class {cohort?.class}-{cohort?.section} · {examType}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm text-slate-300 mb-3">
                      Clear only audited Web proposals in this exact cohort and term. Legacy override records remain unchanged. If any Student with a saved proposal has already been executed, the entire clear is rejected.
                    </p>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5" htmlFor="reset-overrides-reason">
                      Reason (required)
                    </label>
                    <textarea
                      id="reset-overrides-reason"
                      value={resetAllReason}
                      onChange={event => {
                        setResetAllReason(event.target.value);
                        setResetAllReasonError("");
                      }}
                      maxLength={500}
                      rows={3}
                      placeholder="Explain why these proposals should be cleared"
                      className="w-full resize-y rounded-lg border border-[#1e2d44] bg-[#0A1628] px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]/60"
                      data-testid="input-reset-overrides-reason"
                    />
                    {resetAllReasonError && (
                      <p className="mt-1 text-xs text-red-300" data-testid="error-reset-overrides-reason">
                        {resetAllReasonError}
                      </p>
                    )}
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline"
                        onClick={() => {
                          setShowResetConfirm(false);
                          setResetAllReason("");
                          setResetAllReasonError("");
                        }}
                        className="h-8 px-4 text-xs border-slate-600 text-slate-300 hover:text-white"
                        data-testid="btn-reset-cancel">
                        Cancel
                      </Button>
                      <Button size="sm"
                        onClick={() => {
                          const reason = resetAllReason.trim();
                          if (!reason || reason.length > 500) {
                            setResetAllReasonError("Enter a reason of 1–500 characters.");
                            return;
                          }
                          resetAllMut.mutate({ reason });
                        }}
                        disabled={!overridesAvailable || resetAllMut.isPending || !resetAllReason.trim() || hasExecutedOverrides}
                        className="h-8 px-4 text-xs bg-red-600 hover:bg-red-500 text-white border-0"
                        data-testid="btn-reset-confirm">
                        {resetAllMut.isPending
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : "Yes, Clear Proposals"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {overrideReasonAction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                  data-testid="override-reason-overlay">
                  <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#1A2942] p-6 max-w-md w-full mx-4 shadow-2xl">
                    <h3 className="font-bold text-white text-sm">
                      {overrideReasonAction.kind === "clear"
                        ? "Clear Saved Override"
                        : overrideReasonAction.bulk
                          ? "Save Bulk Overrides"
                          : "Save Promotion Override"}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 mb-4">
                      Class {cohort?.class}-{cohort?.section} · {examType}. Saved overrides are separate from the Teacher recommendation and are NOT YET EXECUTED.
                    </p>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5" htmlFor="promotion-override-reason">
                      Reason (required)
                    </label>
                    <textarea
                      id="promotion-override-reason"
                      value={overrideReason}
                      onChange={event => {
                        setOverrideReason(event.target.value);
                        setOverrideReasonError("");
                      }}
                      maxLength={500}
                      rows={4}
                      placeholder="Explain why this override should be saved or cleared"
                      className="w-full resize-y rounded-lg border border-[#1e2d44] bg-[#0A1628] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]/60"
                      data-testid="input-promotion-override-reason"
                    />
                    {overrideReasonError && (
                      <p className="mt-1 text-xs text-red-300" data-testid="error-promotion-override-reason">
                        {overrideReasonError}
                      </p>
                    )}
                    <div className="mt-4 flex gap-2 justify-end">
                      <Button size="sm" variant="outline"
                        onClick={() => {
                          setOverrideReasonAction(null);
                          setOverrideReason("");
                          setOverrideReasonError("");
                        }}
                        className="h-8 px-4 text-xs border-slate-600 text-slate-300 hover:text-white"
                        data-testid="btn-promotion-override-cancel">
                        Cancel
                      </Button>
                      <Button size="sm"
                        onClick={submitOverrideReason}
                        disabled={!overrideReason.trim() || overrideReason.length > 500}
                        className="h-8 px-4 text-xs bg-blue-600 hover:bg-blue-500 text-white border-0"
                        data-testid="btn-promotion-override-submit">
                        {overrideSaveMut.isPending || bulkOverrideMut.isPending || overrideClearMut.isPending
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : "Confirm change"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Batch action bar (slides in when rows are selected) ──────── */}
              {selectedStudents.size > 0 && (
                <div className="mx-1 mb-1 rounded-xl border border-[#D4AF37]/40 bg-[#0A1628] px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                  data-testid="batch-action-bar">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-[#D4AF37]" />
                    <span className="text-sm font-semibold text-white">
                      {selectedStudents.size} student{selectedStudents.size !== 1 ? "s" : ""} selected
                    </span>
                    <button
                      onClick={() => setSelectedStudents(new Set())}
                      className="text-xs text-slate-400 hover:text-white transition-colors ml-1"
                      data-testid="btn-clear-selection">
                      Clear
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleBulkOverride("promote")}
                      disabled={!overridesAvailable || bulkOverrideMut.isPending}
                      className="h-8 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white border-0 disabled:opacity-60"
                      data-testid="btn-bulk-promote">
                      {bulkOverrideMut.isPending
                        ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                        : <TrendingUp className="w-3 h-3 mr-1.5" />}
                      Bulk Promote Selected
                    </Button>
                    <Button size="sm" onClick={() => handleBulkOverride("retain")}
                      disabled={!overridesAvailable || bulkOverrideMut.isPending}
                      className="h-8 px-3 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white border-0 disabled:opacity-60"
                      data-testid="btn-bulk-retain">
                      {bulkOverrideMut.isPending
                        ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                        : <UserX className="w-3 h-3 mr-1.5" />}
                      Bulk Retain Selected
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── STEP 3: Execute ───────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#1e2d44] p-5 space-y-4" style={{ background: "#1A2942" }}
            data-testid="promotion-session-target">
            <div>
              <h2 className="text-sm font-bold text-white">Promotion Academic Sessions</h2>
              <p className="text-xs text-slate-400 mt-1">
                Choose where to prepare the next-session enrollment. This does not change the current Student Registry placement or activate a session.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Promoting From</label>
                <div className="h-10 px-3 rounded-xl border border-[#1e2d44] bg-[#0A1628] flex items-center text-white text-sm font-medium"
                  data-testid="promotion-source-session">
                  {selectedSession?.sessionName ?? "Select a source Academic Session"}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400" htmlFor="promotion-target-session">
                  Promoting To
                </label>
                {sessionsLoading ? (
                  <div className="h-10 px-3 rounded-xl border border-[#1e2d44] bg-[#0A1628] flex items-center text-slate-400 text-sm">
                    Loading Academic Sessions…
                  </div>
                ) : sessionsError ? (
                  <div role="alert" className="h-10 px-3 rounded-xl border border-red-500/30 bg-[#0A1628] flex items-center text-red-300 text-xs">
                    Unable to load target sessions. Refresh and try again.
                  </div>
                ) : eligibleTargetSessions.length === 0 ? (
                  <div className="h-10 px-3 rounded-xl border border-[#1e2d44] bg-[#0A1628] flex items-center text-slate-400 text-xs">
                    No eligible target sessions are available.
                  </div>
                ) : (
                  <Select
                    value={targetSessionId === null ? "" : String(targetSessionId)}
                    onValueChange={value => {
                      setTargetSessionId(Number(value));
                      setConfirmed(false);
                    }}
                  >
                    <SelectTrigger id="promotion-target-session" aria-label="Target Academic Session"
                      className="bg-[#0A1628] border-[#1e2d44] text-white h-10 w-full"
                      data-testid="select-promotion-target-session">
                      <SelectValue placeholder="Choose a target session…" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1A2942] border-[#1e2d44]">
                      {eligibleTargetSessions.map(session => (
                        <SelectItem key={session.id} value={String(session.id)} className="text-white hover:bg-[#0A1628]">
                          {session.sessionName} · {session.isActive ? "Active" : session.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            {selectedTargetSession && (
              <p className="text-xs text-emerald-200" data-testid="promotion-target-session-selected">
                Target: {selectedTargetSession.sessionName}. The target session status will remain unchanged.
              </p>
            )}
          </div>

          {/* Scope indicator — shown when executing a subset */}
          {executionScope !== null && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[#D4AF37]/30 bg-[#D4AF37]/5 text-xs text-[#D4AF37]"
              data-testid="execution-scope-banner">
              <CheckSquare className="w-3.5 h-3.5 shrink-0" />
              <span>
                Executing for <strong>{counters.eligible}</strong> backend-approved eligible Student{counters.eligible !== 1 ? "s" : ""} only.
                <span className="text-slate-400 ml-1">
                  {counters.pending} Pending and {counters.review} requiring review are excluded and remain unchanged.
                </span>
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
            {[
              { label:"Total Students",   val: counters.total,   color:"text-white",       icon:<Users      className="w-5 h-5 text-[#D4AF37]"     /> },
              { label:"Will Be Promoted", val: counters.promote, color:"text-emerald-400", icon:<TrendingUp className="w-5 h-5 text-emerald-400"    /> },
              { label:"Repeating Year",   val: counters.retain,  color:"text-red-400",     icon:<UserX      className="w-5 h-5 text-red-400"        /> },
              { label:"Grace Passes",     val: counters.grace,   color:"text-purple-400",  icon:<Award      className="w-5 h-5 text-purple-400"     /> },
              { label:"Pending",          val: counters.pending, color:"text-amber-400",   icon:<Clock      className="w-5 h-5 text-amber-400"      /> },
              { label:"Requires Review",  val: counters.review,  color:"text-red-400",     icon:<AlertTriangle className="w-5 h-5 text-red-400"    /> },
              { label:"Executed",         val: counters.executed, color:"text-blue-400",   icon:<CheckCircle2 className="w-5 h-5 text-blue-400" /> },
              { label:"Historical",       val: counters.historical, color:"text-slate-400", icon:<Lock       className="w-5 h-5 text-slate-400"     /> },
            ].map(({ label, val, color, icon }) => (
              <div key={label} className="rounded-xl border border-[#1e2d44] p-4 flex items-center gap-3" style={{ background:"#1A2942" }}>
                {icon}
                <div>
                  <p className={`text-2xl font-bold ${color}`}>{val}</p>
                  <p className="text-xs text-slate-400">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {agg && (
            <div className="rounded-2xl border border-[#1e2d44] p-5" style={{ background:"#1A2942" }}>
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-[#D4AF37]" />Final Promotion Summary
              </h3>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {agg.students.filter(includeInPromotionSummary).map(s => {
                  const preview = previewForStudent(s);
                  const { outcome, destination } = preview;
                  const statusLabel = outcome === "executed"
                    ? `Executed${s.finalDecision?.finalDecision?.status ? ` · ${s.finalDecision.finalDecision.status}` : ""} → Class ${destination?.className} — ${destination?.sectionName}${s.finalDecision?.overrideApplied === true ? " · audited override applied" : s.finalDecision?.overrideApplied === false ? " · Teacher recommendation" : " · legacy evidence"}`
                    : outcome === "pending"
                    ? s.resultStatus === "incomplete" ? "Pending — No marks" : "Pending — No locked decision"
                    : outcome === "review" ? "Ineligible — Requires Review"
                    : outcome === "historical" ? "Historical — Read-only"
                    : outcome === "retained"
                    ? `${s.finalDecision?.overrideApplied ? "Validated override · " : "Ready to execute · "}Retain in Class ${destination?.className} — ${destination?.sectionName}`
                    : outcome === "grace_pass"
                    ? `Grace Pass → Class ${destination?.className} — ${destination?.sectionName}`
                    : `Ready to execute · ${s.finalDecision?.overrideApplied ? "Validated override · " : ""}Promote → Class ${destination?.className} — ${destination?.sectionName}`;
                  const color = outcome === "executed" ? "blue"
                    : outcome === "promoted" ? "emerald"
                    : outcome === "retained" ? "red"
                    : outcome === "grace_pass" ? "purple"
                    : outcome === "review" ? "red"
                    : outcome === "historical" ? "slate" : "amber";
                  const icon = outcome === "executed" ? <CheckCircle2 className="w-3 h-3"/>
                    : outcome === "promoted" ? <TrendingUp className="w-3 h-3"/>
                    : outcome === "retained" ? <UserX className="w-3 h-3"/>
                    : outcome === "grace_pass" ? <Award className="w-3 h-3"/>
                    : outcome === "review" ? <AlertTriangle className="w-3 h-3"/>
                    : outcome === "historical" ? <Lock className="w-3 h-3"/>
                    : <Clock className="w-3 h-3"/>;
                  return (
                    <div key={s.studentId} className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-[#0A1628]/50">
                      <span className="text-slate-300">{s.name} <span className="text-slate-500 font-mono">({s.dsid})</span></span>
                      <Chip c={color} icon={icon} label={statusLabel} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-[#1e2d44] p-5 space-y-4" style={{ background:"#1A2942" }}>
            <div className="flex items-start gap-3">
              <Checkbox id="exec-confirm" checked={confirmed} disabled={!selectedTargetSession}
                onCheckedChange={v => setConfirmed(!!v)}
                className="mt-0.5 border-slate-500 data-[state=checked]:bg-[#D4AF37] data-[state=checked]:border-[#D4AF37]"
                data-testid="checkbox-confirm-execute" />
              <label htmlFor="exec-confirm" className="text-sm text-slate-300 leading-relaxed cursor-pointer select-none">
                I confirm this will prepare a separate enrollment and Promotion history in{" "}
                <strong className="text-[#D4AF37]">{selectedTargetSession?.sessionName ?? "the selected target session"}</strong>.
                The Student Registry placement and source enrollment will remain unchanged.
              </label>
            </div>
            <div className="flex items-center justify-between pt-1">
              <Button variant="outline" className="border-[#1e2d44] text-slate-400 hover:bg-[#0A1628] h-9"
                onClick={() => setStep(2)} data-testid="btn-step3-back">
                ← Back to Review
              </Button>
              <Button
                disabled={!confirmed || !selectedTargetSession || executeMut.isPending || !agg || counters.eligible === 0 || isArchiveMode}
                onClick={() => executeMut.mutate()}
                className="h-9 px-8 font-bold text-sm"
                style={{ background: confirmed ? "linear-gradient(135deg,#D4AF37,#b8972e)" : undefined, color: confirmed ? "#0A1628" : undefined }}
                data-testid="btn-execute-promotion">
                {executeMut.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Preparing…</>
                  : <><CheckSquare className="w-4 h-4 mr-2"/>Prepare Promotion</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────────
  // VIEW A — Ledger Tracking Dashboard
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg,#D4AF37,#f59e0b)" }}>
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Exam Controller</h1>
            <p className="text-xs text-slate-400">Oversee teacher ledgers and execute final academic advancement</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectedTerm && (
            <>
              {kpi.lockedReady > 0 && (
                <Chip c="emerald" icon={<Lock className="w-3 h-3"/>}
                  label={`${kpi.lockedReady} Ready`}
                  onClick={() => toggleStatusFilter("ready")}
                  active={statusFilter === "ready"}
                  data-testid="pill-filter-ready" />
              )}
              {kpi.executed > 0 && <Chip c="blue" icon={<CheckCircle2 className="w-3 h-3"/>} label={`${kpi.executed} Executed`} />}
              {kpi.pending > 0 && (
                <Chip c="amber" icon={<Clock className="w-3 h-3"/>}
                  label={`${kpi.pending} Pending`}
                  onClick={() => toggleStatusFilter("pending")}
                  active={statusFilter === "pending"}
                  data-testid="pill-filter-pending" />
              )}
            </>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh}
            className="border-[#1e2d44] text-slate-300 hover:bg-[#1A2942] h-8 px-3 text-xs"
            data-testid="btn-refresh-ledger">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh
          </Button>
        </div>
      </div>

      {/* ── Term Selector ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#1e2d44] p-4" style={{ background:"#1A2942" }}>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Select Promotion Term</label>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={selectedTerm} onValueChange={v => { setSelectedTerm(v); setTermToDelete(null); setSearchText(""); setFilterClass("all"); setFilterSection("all"); setStatusFilter("all"); }}>
            <SelectTrigger className="bg-[#0A1628] border-[#1e2d44] text-white h-10 w-64" data-testid="select-ledger-term">
              <SelectValue placeholder="Choose a term…" />
            </SelectTrigger>
            <SelectContent className="bg-[#1A2942] border-[#1e2d44]">
              {terms.map(t => <SelectItem key={t} value={t} className="text-white hover:bg-[#0A1628]">{t}</SelectItem>)}
            </SelectContent>
          </Select>
          {terms.length === 0 && (
            <p className="text-xs text-slate-500 italic">No promotion-gated terms — configure Exam Policy in School Setup.</p>
          )}
          {selectedTerm && (
            termToDelete === selectedTerm ? (
              <div className="flex items-center gap-2 bg-red-900/30 border border-red-500/40 rounded-lg px-3 py-2">
                <span className="text-xs text-red-300">Delete all ledger data for <strong>"{selectedTerm}"</strong>?</span>
                <button onClick={() => deleteTermMut.mutate(selectedTerm)} disabled={deleteTermMut.isPending || isArchiveMode}
                  className="text-xs font-semibold text-red-300 hover:text-white border border-red-500/50 px-2 py-0.5 rounded"
                  data-testid="btn-confirm-delete-term">
                  {deleteTermMut.isPending ? "Deleting…" : "Yes, Delete"}
                </button>
                <button onClick={() => setTermToDelete(null)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setTermToDelete(selectedTerm)}
                disabled={isArchiveMode}
                className="border-red-900/50 text-red-400 hover:bg-red-900/20 hover:text-red-300 h-9 px-3 text-xs"
                data-testid="btn-delete-term">
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete Term
              </Button>
            )
          )}
        </div>
      </div>

      {selectedTerm && (
        <>
          {/* ── KPI Summary Banner ──────────────────────────────────────────── */}
          {!ledgerLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {/* Non-interactive cards */}
              <div className="rounded-xl border border-[#1e2d44] p-4 flex items-center gap-3" style={{ background:"#1A2942" }}>
                <GraduationCap className="w-5 h-5 text-[#D4AF37]" />
                <div>
                  <p className="text-2xl font-bold text-white">{kpi.totalClasses}</p>
                  <p className="text-xs text-slate-400">Total Classes</p>
                </div>
              </div>
              <div className="rounded-xl border border-[#1e2d44] p-4 flex items-center gap-3" style={{ background:"#1A2942" }}>
                <Users className="w-5 h-5 text-blue-400" />
                <div>
                  <p className="text-2xl font-bold text-white">{kpi.totalSections}</p>
                  <p className="text-xs text-slate-400">Total Sections</p>
                </div>
              </div>
              {/* Interactive: Ready to Advance */}
              <div
                onClick={() => toggleStatusFilter("ready")}
                data-testid="kpi-card-ready"
                className={`rounded-xl border p-4 flex items-center gap-3 cursor-pointer select-none transition-all duration-150 hover:brightness-110
                  ${statusFilter === "ready"
                    ? "border-emerald-500/60 ring-2 ring-emerald-500/40 shadow-[0_0_12px_rgba(52,211,153,0.2)]"
                    : "border-[#1e2d44] hover:border-emerald-500/30"}`}
                style={{ background: statusFilter === "ready" ? "rgba(52,211,153,0.08)" : "#1A2942" }}>
                <Lock className="w-5 h-5 text-emerald-400" />
                <div>
                  <p className="text-2xl font-bold text-emerald-400">{kpi.lockedReady}</p>
                  <p className="text-xs text-slate-400">Sections with Ready Students</p>
                </div>
                {statusFilter === "ready" && (
                  <span className="ml-auto text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded-full">ON</span>
                )}
              </div>
              {/* Interactive: Pending Ledgers */}
              <div
                onClick={() => toggleStatusFilter("pending")}
                data-testid="kpi-card-pending"
                className={`rounded-xl border p-4 flex items-center gap-3 cursor-pointer select-none transition-all duration-150 hover:brightness-110
                  ${statusFilter === "pending"
                    ? "border-amber-500/60 ring-2 ring-amber-500/40 shadow-[0_0_12px_rgba(251,191,36,0.2)]"
                    : "border-[#1e2d44] hover:border-amber-500/30"}`}
                style={{ background: statusFilter === "pending" ? "rgba(251,191,36,0.08)" : "#1A2942" }}>
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <div>
                  <p className="text-2xl font-bold text-amber-400">{kpi.pending}</p>
                  <p className="text-xs text-slate-400">Sections with Pending Students</p>
                </div>
                {statusFilter === "pending" && (
                  <span className="ml-auto text-[10px] font-bold text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded-full">ON</span>
                )}
              </div>
            <div
              data-testid="kpi-card-review"
              className="rounded-xl border border-red-500/30 p-4 flex items-center gap-3"
              style={{ background:"rgba(239,68,68,0.06)" }}>
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <div>
                <p className="text-2xl font-bold text-red-400">{kpi.needsReview}</p>
                <p className="text-xs text-slate-400">Sections Requiring Review</p>
              </div>
            </div>
            </div>
          )}

          {/* ── Filter Row ──────────────────────────────────────────────────── */}
          {!ledgerLoading && ledgerRows.length > 0 && (
            <div className="rounded-2xl border border-[#1e2d44] p-3" style={{ background:"#1A2942" }}>
              <div className="flex flex-wrap gap-2 items-center">
                {/* Search */}
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  <input value={searchText} onChange={e => setSearchText(e.target.value)}
                    placeholder="Search class, section or teacher…"
                    data-testid="input-ledger-search"
                    className="w-full pl-9 pr-3 h-9 rounded-xl bg-[#0A1628] border border-[#1e2d44] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]/50" />
                </div>
                {/* Class filter */}
                <Select value={filterClass} onValueChange={v => { setFilterClass(v); setFilterSection("all"); if (v === "all") setStatusFilter("all"); }}>
                  <SelectTrigger className="bg-[#0A1628] border-[#1e2d44] text-white h-9 w-36 text-xs" data-testid="select-filter-class">
                    <SelectValue placeholder="All Classes" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A2942] border-[#1e2d44]">
                    <SelectItem value="all" className="text-white hover:bg-[#0A1628] text-xs">All Classes</SelectItem>
                    {allClassOptions.map(c => (
                      <SelectItem key={c} value={c} className="text-white hover:bg-[#0A1628] text-xs">Class {c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Section filter */}
                <Select value={filterSection} onValueChange={setFilterSection}>
                  <SelectTrigger className="bg-[#0A1628] border-[#1e2d44] text-white h-9 w-32 text-xs" data-testid="select-filter-section">
                    <SelectValue placeholder="All Sections" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A2942] border-[#1e2d44]">
                    <SelectItem value="all" className="text-white hover:bg-[#0A1628] text-xs">All Sections</SelectItem>
                    {allSectionOptions.map(s => (
                      <SelectItem key={s} value={s} className="text-white hover:bg-[#0A1628] text-xs">Sec {s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* ── Accordion Ledger Grid ────────────────────────────────────────── */}
          <div className="space-y-2">
            {ledgerLoading ? (
              <div className="rounded-2xl border border-[#1e2d44] flex items-center justify-center py-16 gap-2 text-slate-400" style={{ background:"#1A2942" }}>
                <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading ledger…</span>
              </div>
            ) : Object.keys(groupedRows).length === 0 ? (
              <div className="rounded-2xl border border-[#1e2d44] text-center py-16 text-slate-500" style={{ background:"#1A2942" }}>
                <Shield className="w-10 h-10 mx-auto mb-3 opacity-25" />
                <p className="text-sm">
                  {searchText || filterClass !== "all" || filterSection !== "all"
                    ? "No results match your filters."
                    : "No class-sections found. Ensure School Setup → Class-Section mapping is configured."}
                </p>
              </div>
            ) : (
              Object.entries(groupedRows).map(([cls, rows]) => {
                const isExpanded = expandedClasses.has(cls);

                // Class-level tripartite counters: sum student counts across all sections in this class
                const clsTotalExecuted = rows.reduce((s, r) => s + r.executedCount, 0);
                const clsTotalReady    = rows.reduce((s, r) => s + r.readyCount, 0);
                const clsTotalPending  = rows.reduce((s, r) => s + r.pendingCount, 0);
                const clsNotStarted    = rows.filter(r => r.totalStudents === 0).length;

                return (
                  <div key={cls} className="rounded-2xl border border-[#1e2d44] overflow-hidden" style={{ background:"#1A2942" }}>

                    {/* Class accordion header */}
                    <button onClick={() => toggleClass(cls)}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#0A1628]/40 transition-colors text-left"
                      data-testid={`accordion-class-${cls}`}>
                      <div className="flex items-center gap-3">
                        <GraduationCap className="w-4 h-4 text-[#D4AF37] shrink-0" />
                        <span className="text-sm font-bold text-white">Class {cls}</span>
                        <span className="text-xs text-slate-400">{rows.length} section{rows.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {clsTotalExecuted > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            {clsTotalExecuted} Executed
                          </span>
                        )}
                        {clsTotalReady > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            {clsTotalReady} Ready
                          </span>
                        )}
                        {clsTotalPending > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            {clsTotalPending} Pending
                          </span>
                        )}
                        {clsNotStarted > 0 && clsTotalExecuted === 0 && clsTotalReady === 0 && clsTotalPending === 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-slate-500/20 text-slate-400 border border-slate-500/30">
                            Not Started
                          </span>
                        )}
                        {isExpanded
                          ? <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
                          : <ChevronRight className="w-4 h-4 text-slate-400 ml-1" />}
                      </div>
                    </button>

                    {/* Expanded section rows */}
                    {isExpanded && (
                      <div className="border-t border-[#1e2d44]">
                        {rows.map((row, idx) => {
                          // Remind only when a current Student has a missing/unlocked decision.
                          const isPending = row.pendingCount > 0 && row.readyCount === 0 && row.executedCount === 0;
                          const rKey = `${row.class}|${row.section}`;
                          return (
                            <div key={row.section}
                              className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 border-b border-[#1e2d44]/50 last:border-b-0 ${idx%2!==0 ? "bg-[#0A1628]/20" : ""}`}
                              data-testid={`row-ledger-${row.class}-${row.section}`}>

                              {/* Section label */}
                              <div className="w-16 shrink-0">
                                <span className="text-xs text-slate-400">Sec </span>
                                <span className="font-bold text-white text-sm">{row.section}</span>
                              </div>

                              {/* Tripartite state pills */}
                              <div className="min-w-[160px] shrink-0">
                                <LedgerPills row={row} />
                              </div>

                              {/* Teacher */}
                              <div className="flex-1 min-w-[120px]">
                                {row.teacherName ? (
                                  <div>
                                    <p className="text-white text-xs font-medium">{row.teacherName}</p>
                                    {row.lockedAt && <p className="text-slate-500 text-xs">{fmt(row.lockedAt)}</p>}
                                  </div>
                                ) : <span className="text-slate-500 text-xs italic">No teacher assigned</span>}
                              </div>

                              {/* Students */}
                              <div className="w-14 text-right shrink-0">
                                {row.totalStudents > 0 ? (
                                  <>
                                    <span className="text-white font-semibold text-sm">{row.lockedCount}</span>
                                    <span className="text-slate-500 text-xs">/{row.totalStudents}</span>
                                  </>
                                ) : <span className="text-slate-500 text-xs">—</span>}
                              </div>

                              {/* Interventions */}
                              <div className="w-24 shrink-0 text-center">
                                {row.manualInterventionCount > 0 ? (
                                  <Chip c="amber" icon={<AlertTriangle className="w-3 h-3"/>}
                                    label={`${row.manualInterventionCount} Override${row.manualInterventionCount > 1 ? "s" : ""}`} />
                                ) : row.status !== "none" ? (
                                  <span className="text-slate-600 text-xs">None</span>
                                ) : null}
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-2 ml-auto shrink-0">
                                {isPending && (
                                  <button
                                    onClick={() => { setRemindingKey(rKey); reminderMut.mutate({ className: row.class, section: row.section }); }}
                                    disabled={reminderMut.isPending && remindingKey === rKey}
                                    className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                                    title="Send reminder to teacher"
                                    data-testid={`btn-remind-${row.class}-${row.section}`}>
                                    {reminderMut.isPending && remindingKey === rKey
                                      ? <Loader2 className="w-3 h-3 animate-spin" />
                                      : <Bell className="w-3 h-3" />}
                                    Remind
                                  </button>
                                )}
                                {row.adminExecuted ? (
                                  // All students fully executed — view-only mode
                                  <Button size="sm" variant="outline"
                                    className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10 text-xs h-8"
                                    onClick={() => openWizard(row)}
                                    data-testid={`btn-view-${row.class}-${row.section}`}>
                                    View Results
                                  </Button>
                                ) : row.readyCount > 0 ? (
                                  // Execute only the backend-approved subset of a mixed cohort.
                                  <Button size="sm"
                                    className="text-xs h-8 font-semibold px-3"
                                    style={{ background:"linear-gradient(135deg,#D4AF37,#b8972e)", color:"#0A1628" }}
                                    onClick={() => openWizard(row)}
                                    disabled={isArchiveMode}
                                    data-testid={`btn-review-${row.class}-${row.section}`}>
                                    <Play className="w-3 h-3 mr-1.5"/>Review & Execute ({row.readyCount} eligible)
                                  </Button>
                                ) : row.ineligibleCount > 0 ? (
                                  <Button size="sm" disabled variant="outline"
                                    className="border-red-500/30 text-red-300 text-xs h-8"
                                    data-testid={`btn-ineligible-${row.class}-${row.section}`}>
                                    Requires Review
                                  </Button>
                                ) : row.historicalCount > 0 ? (
                                  <Button size="sm" variant="outline"
                                    className="border-slate-700 text-slate-500 text-xs h-8"
                                    onClick={() => openWizard(row)}
                                    data-testid={`btn-historical-${row.class}-${row.section}`}>
                                    View Historical · Read-only
                                  </Button>
                                ) : (
                                  // No locked students yet — teacher hasn't locked the ledger
                                  <Button size="sm" disabled variant="outline"
                                    className="border-slate-700 text-slate-600 text-xs h-8"
                                    data-testid={`btn-awaiting-${row.class}-${row.section}`}>
                                    Awaiting Lock
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Empty placeholder when no term selected */}
      {!selectedTerm && !ledgerLoading && (
        <div className="rounded-2xl border border-[#1e2d44] text-center py-16 text-slate-500" style={{ background:"#1A2942" }}>
          <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-25" />
          <p className="text-sm">Select a promotion term above to view the ledger status grid.</p>
        </div>
      )}
    </div>
  );
}
