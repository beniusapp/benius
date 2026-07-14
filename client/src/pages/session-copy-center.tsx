/**
 * SessionCopyCenterPage
 *
 * Guided, module-by-module configuration copy wizard shown after a new
 * academic session is created with a source session selected.
 *
 * Route: /session-copy-center/:sessionId
 *
 * Flow:
 *   grid     — module cards with Open / Skip per module
 *   detail   — sub-module toggles + record counts, Copy Selected button
 *   summary  — full copy report + next-step CTAs
 */

import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, CheckCircle2, Circle, ChevronRight, AlertTriangle,
  Copy, Loader2, Check, ToggleLeft, ToggleRight, Info, Zap,
  GraduationCap, UserPlus, Users, LayoutGrid, CreditCard,
  ArrowRight, SkipForward, RotateCcw, X, Plus, CalendarRange,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtDate } from "@/lib/dateUtils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Session {
  id: number;
  sessionName: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  status: string;
  copiedFromSessionId: number | null;
  copiedModules: string | null;
}

interface CopyEntry {
  module: string;
  parentModule: string;
  label: string;
  count: number;
  note: string;
}

interface SessionCopyResult {
  sourceSessionId: number;
  sourceSessionName: string;
  destSessionId: number;
  approvedModules: string[];
  copied: CopyEntry[];
  sharedSchoolwide: CopyEntry[];
  requestedButEmpty: CopyEntry[];
  cleanSlate: string[];
  totalRecordsCopied: number;
  timestamp: string;
}

type ModuleStatus = "pending" | "copying" | "copied" | "skipped" | "failed";

interface SubModuleDef {
  id: string;
  label: string;
  desc: string;
}

interface CopyModuleDef {
  id: string;
  label: string;
  emoji: string;
  category: "A" | "B";
  group: "FOUNDATION" | "MANAGEMENT";
  warning?: string;
  subModules: SubModuleDef[];
}

// ── Module definitions ─────────────────────────────────────────────────────────

const COPY_MODULES: CopyModuleDef[] = [
  // ── FOUNDATION ───────────────────────────────────────────────────────────────
  {
    id: "school-setup", label: "School Setup", emoji: "⚙️",
    category: "A", group: "FOUNDATION",
    subModules: [
      { id: "classes",                 label: "Classes",                 desc: "Class divisions (Class I, II, III…)" },
      { id: "sections",                label: "Sections",                desc: "Sections within each class (A, B, C…)" },
      { id: "subjects",                label: "Subjects",                desc: "Subjects taught across all classes" },
      { id: "exam-types",              label: "Exam Types",              desc: "Exam categories (Unit Test, Half Yearly…)" },
      { id: "class-mapping",           label: "Class–Section Mapping",   desc: "Which sections exist in each class" },
      { id: "subject-mapping",         label: "Class–Subject Mapping",   desc: "Which subjects are taught in each class" },
      { id: "class-exam-type-mapping", label: "Class–Exam Type Mapping", desc: "Which exam types apply per class" },
      { id: "grading-policy",          label: "Academic Policy",          desc: "Grading tiers, pass percentages, and grade brackets" },
      { id: "promotion-policy",        label: "Exam & Promotion Policy",  desc: "Exam weighting formulas and promotion rules" },
      { id: "attendance-policy",       label: "Attendance Policy",       desc: "Minimum attendance requirements" },
      { id: "leave-policy",            label: "Leave Policy",            desc: "Student and staff leave entitlements" },
    ],
  },
  {
    id: "timetable-master", label: "Timetable Master", emoji: "📅",
    category: "A", group: "FOUNDATION",
    subModules: [
      { id: "bell-structure", label: "Bell Structure", desc: "Daily period timing and bell schedule" },
      { id: "period-config",  label: "Schedule Grid",  desc: "Period-by-period subject assignments per class" },
    ],
  },
  {
    id: "school-calendar", label: "School Calendar", emoji: "🗓️",
    category: "A", group: "FOUNDATION",
    subModules: [
      { id: "holiday-templates", label: "Holiday Templates", desc: "Public holidays — dates advanced to new year" },
      { id: "recurring-events",  label: "Recurring Events",  desc: "Annual events — dates advanced to new year" },
    ],
  },
  {
    id: "id-card-gen", label: "ID Card Generator", emoji: "💳",
    category: "A", group: "FOUNDATION",
    subModules: [
      { id: "card-layouts",    label: "Card Layouts",    desc: "Student and staff ID card design templates" },
      { id: "print-templates", label: "Print Templates", desc: "Print-ready output configuration" },
    ],
  },
  // ── MANAGEMENT ───────────────────────────────────────────────────────────────
  {
    id: "faculty-mapping", label: "Faculty Mapping", emoji: "🗂️",
    category: "B", group: "MANAGEMENT",
    warning: "Review all teacher allocations before activating the new session.",
    subModules: [
      { id: "teacher-class-assignments", label: "Teacher–Class–Subject Assignments", desc: "Teacher allocations to classes, sections, and subjects" },
    ],
  },
  {
    id: "fees-payments", label: "Fees & Payments", emoji: "💰",
    category: "B", group: "MANAGEMENT",
    warning: "Only fee configuration templates are copied. Ledger, receipts, and outstanding dues are excluded.",
    subModules: [
      { id: "fee-categories",   label: "Fee Categories",   desc: "Fee groupings and classifications" },
      { id: "fee-heads",        label: "Fee Heads",        desc: "Individual fee line items" },
      { id: "fee-structure",    label: "Fee Structure",    desc: "Per-class fee assignment matrix" },
      { id: "fine-rules",       label: "Fine Rules",       desc: "Late payment penalty configuration" },
      { id: "concession-rules", label: "Concession Rules", desc: "Discount and waiver rules" },
    ],
  },
  {
    id: "assets-inventory", label: "Assets & Inventory", emoji: "📦",
    category: "B", group: "MANAGEMENT",
    warning: "Only asset master and categories are copied. Movement, maintenance, and issue history is excluded.",
    subModules: [
      { id: "asset-categories", label: "Asset Categories",  desc: "Asset classification groups" },
      { id: "asset-master",     label: "Asset Master",      desc: "School asset registry" },
      { id: "storage-locations",label: "Storage Locations", desc: "Physical storage location directory" },
    ],
  },
];

const CLEAN_SLATE = [
  { id: "student-registry", label: "Student Registry",     emoji: "🎓" },
  { id: "exam-controller",  label: "Exam Controller",      emoji: "🏆" },
  { id: "attendance",       label: "Attendance Records",   emoji: "📊" },
  { id: "complaint-hub",    label: "Complaint Hub",        emoji: "🛡️" },
  { id: "noticeboard",      label: "Noticeboard",          emoji: "🔔" },
  { id: "visitor-log",      label: "Visitor Log",          emoji: "🚪" },
  { id: "audit-logs",       label: "Audit Logs",           emoji: "🔐" },
];

// ── Glassmorphic style tokens ──────────────────────────────────────────────────

const GLASS = {
  card: {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.08)",
  } as React.CSSProperties,
  panel: {
    background: "rgba(10,18,40,0.85)",
    backdropFilter: "blur(24px)",
    border: "1px solid rgba(255,255,255,0.10)",
  } as React.CSSProperties,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseExistingResult(copiedModules: string | null): SessionCopyResult | null {
  if (!copiedModules) return null;
  try {
    const p = JSON.parse(copiedModules);
    if (p && "approvedModules" in p) return p as SessionCopyResult;
  } catch { /* noop */ }
  return null;
}

function deriveStatuses(result: SessionCopyResult | null): Record<string, ModuleStatus> {
  if (!result) return {};
  const processedIds = new Set([
    ...(result.copied || []).map(e => e.module),
    ...(result.sharedSchoolwide || []).map(e => e.module),
    ...(result.requestedButEmpty || []).map(e => e.module),
  ]);
  const statuses: Record<string, ModuleStatus> = {};
  for (const mod of COPY_MODULES) {
    const hasDone = mod.subModules.some(s => processedIds.has(s.id));
    if (hasDone) statuses[mod.id] = "copied";
  }
  return statuses;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepBar({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = [
    { n: 1, label: "Create Session" },
    { n: 2, label: "Copy Configuration" },
    { n: 3, label: "Promote Students" },
    { n: 4, label: "Activate Session" },
  ];
  return (
    <div className="flex items-center gap-0 w-full max-w-2xl mx-auto">
      {steps.map((s, i) => {
        const done   = s.n < current;
        const active = s.n === current;
        return (
          <div key={s.n} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                style={{
                  background: done    ? "#10b981"
                             : active ? "linear-gradient(135deg,#22d3ee,#6366f1)"
                             : "rgba(255,255,255,0.08)",
                  boxShadow: active ? "0 0 16px rgba(34,211,238,0.40)" : "none",
                  color: done || active ? "#fff" : "rgba(255,255,255,0.25)",
                }}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : s.n}
              </div>
              <span
                className="text-[9px] font-semibold tracking-wide text-center leading-tight hidden sm:block"
                style={{ color: active ? "#22d3ee" : done ? "#10b981" : "rgba(255,255,255,0.25)" }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 h-px mx-2 mt-[-14px] sm:mt-[-20px]"
                style={{ background: done ? "#10b981" : "rgba(255,255,255,0.10)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: ModuleStatus }) {
  if (status === "pending") return (
    <span className="text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.10)" }}>
      PENDING
    </span>
  );
  if (status === "copying") return (
    <span className="flex items-center gap-1 text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)" }}>
      <Loader2 className="w-2.5 h-2.5 animate-spin" /> COPYING…
    </span>
  );
  if (status === "copied") return (
    <span className="flex items-center gap-1 text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }}>
      <Check className="w-2.5 h-2.5" /> COPIED
    </span>
  );
  if (status === "skipped") return (
    <span className="text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.08)" }}>
      SKIPPED
    </span>
  );
  if (status === "failed") return (
    <span className="flex items-center gap-1 text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}>
      <X className="w-2.5 h-2.5" /> FAILED
    </span>
  );
  return null;
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onToggle(); }}
      className="flex items-center transition-opacity hover:opacity-80 flex-shrink-0">
      {on
        ? <ToggleRight className="w-6 h-6" style={{ color: "#22d3ee" }} />
        : <ToggleLeft  className="w-6 h-6 text-white/30" />}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SessionCopyCenter() {
  const { sessionId: sessionIdStr } = useParams<{ sessionId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // ── New-session mode: user clicked "Next" in the modal, session not yet created ──
  const isNewMode = sessionIdStr === "new";
  const urlParams   = new URLSearchParams(window.location.search);
  const draftName   = isNewMode ? (urlParams.get("name")  ?? "")  : "";
  const draftStart  = isNewMode ? (urlParams.get("start") ?? "")  : "";
  const draftEnd    = isNewMode ? (urlParams.get("end")   ?? "")  : "";
  const draftCopyFrom = isNewMode ? (parseInt(urlParams.get("copyFrom") ?? "") || null) : null;

  const destSessionId = isNewMode ? 0 : parseInt(sessionIdStr ?? "0");

  // ── Views ──
  type View = "grid" | "detail" | "summary" | "step3" | "step4";
  const [view, setView] = useState<View>("grid");
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);
  const [selectedSubIds, setSelectedSubIds] = useState<Set<string>>(new Set());
  const [moduleStatuses, setModuleStatuses] = useState<Record<string, ModuleStatus>>({});
  const [failedError, setFailedError] = useState<string>("");
  // In new mode: stores confirmed sub-module selections per module (copied on "Create Session")
  const [moduleSelections, setModuleSelections] = useState<Record<string, string[]>>({});
  const [isCreating, setIsCreating] = useState(false);

  // ── Data ──
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ["/api/admin/academic-sessions"],
    queryFn: async () => {
      const r = await fetch("/api/admin/academic-sessions", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load sessions");
      return r.json();
    },
  });

  const destSession  = isNewMode ? null : (sessions.find(s => s.id === destSessionId) ?? null);
  const srcSessionId = isNewMode ? draftCopyFrom : (destSession?.copiedFromSessionId ?? null);
  const srcSession   = sessions.find(s => s.id === srcSessionId) ?? null;

  const { data: preview, isLoading: previewLoading } = useQuery<{ counts: Record<string, number> }>({
    queryKey: ["/api/admin/academic-sessions/module-preview"],
    queryFn: async () => {
      const r = await fetch("/api/admin/academic-sessions/module-preview", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load module preview");
      return r.json();
    },
    enabled: !!srcSessionId,
  });

  const counts: Record<string, number> = preview?.counts ?? {};

  // ── Derive initial statuses from existing copiedModules ──
  useEffect(() => {
    if (!destSession?.copiedModules) return;
    const existing = parseExistingResult(destSession.copiedModules);
    const derived  = deriveStatuses(existing);
    setModuleStatuses(prev => ({ ...derived, ...prev }));
  }, [destSession?.copiedModules]);

  // ── Open module ──
  const openModule = useMemo(() => COPY_MODULES.find(m => m.id === openModuleId) ?? null, [openModuleId]);

  function handleOpenModule(modId: string) {
    const mod = COPY_MODULES.find(m => m.id === modId);
    if (!mod) return;
    setOpenModuleId(modId);
    // In new mode: restore previously confirmed selections if they exist
    if (isNewMode && moduleSelections[modId]) {
      setSelectedSubIds(new Set(moduleSelections[modId]));
    } else {
      // Pre-select only sub-modules that have data in the source session
      const withData = new Set(
        mod.subModules
          .filter(s => (counts[s.id] ?? 0) > 0)
          .map(s => s.id)
      );
      setSelectedSubIds(withData);
    }
    setFailedError("");
    setView("detail");
  }

  function handleSkipModule(modId: string) {
    setModuleStatuses(prev => ({ ...prev, [modId]: "skipped" }));
  }

  // ── Copy mutation ──
  const copyMut = useMutation({
    mutationFn: async ({ modId, subIds }: { modId: string; subIds: string[] }) => {
      const r = await apiRequest("POST", `/api/admin/academic-sessions/${destSessionId}/copy-modules`, {
        sourceSessionId: srcSessionId,
        subModuleIds: subIds,
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.message || "Copy failed");
      }
      return r.json();
    },
    onMutate: ({ modId }) => {
      setModuleStatuses(prev => ({ ...prev, [modId]: "copying" }));
      setFailedError("");
    },
    onSuccess: (_, { modId }) => {
      setModuleStatuses(prev => ({ ...prev, [modId]: "copied" }));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-sessions"] });
      toast({ title: "Configuration copied", description: `${openModule?.label} copied successfully.` });
      setView("grid");
    },
    onError: (e: Error, { modId }) => {
      setModuleStatuses(prev => ({ ...prev, [modId]: "failed" }));
      setFailedError(e.message);
    },
  });

  // ── Create Session handler (new mode only) ──────────────────────────────────
  async function handleCreateSession() {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const r = await apiRequest("POST", "/api/admin/academic-sessions", {
        sessionName:          draftName,
        startDate:            draftStart,
        endDate:              draftEnd,
        status:               "draft",
        setAsActive:          false,
        newAdmissionsEnabled: false,
        promotionStrategy:    "defer",
        copiedFromSessionId:  draftCopyFrom,
        copiedModules:        null,
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message || "Failed to create session"); }
      const session = await r.json() as Session;

      // Copy all confirmed modules sequentially
      const entries = Object.entries(moduleSelections);
      for (const [, subIds] of entries) {
        if (subIds.length === 0) continue;
        await apiRequest("POST", `/api/admin/academic-sessions/${session.id}/copy-modules`, {
          sourceSessionId: srcSessionId,
          subModuleIds:    subIds,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-sessions"] });
      toast({ title: "Session created!", description: `"${session.sessionName}" is ready. Proceeding to next steps.` });
      setLocation(`/session-copy-center/${session.id}`);
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  }

  // ── Computed ──
  const foundationModules  = COPY_MODULES.filter(m => m.group === "FOUNDATION");
  const managementModules  = COPY_MODULES.filter(m => m.group === "MANAGEMENT");
  const totalModules       = COPY_MODULES.length;
  const copiedCount        = Object.values(moduleStatuses).filter(s => s === "copied").length;
  const skippedCount       = Object.values(moduleStatuses).filter(s => s === "skipped").length;
  const doneCount          = copiedCount + skippedCount;
  const allDone            = doneCount === totalModules;
  const readyCount         = Object.keys(moduleSelections).length; // new mode: confirmed modules

  const existingResult = useMemo(
    () => parseExistingResult(destSession?.copiedModules ?? null),
    [destSession?.copiedModules]
  );

  // ── No source session state ────────────────────────────────────────────────
  // In new mode with no copyFrom: fresh session — show direct "Create Session" UI
  if (isNewMode && !srcSessionId && !sessionsLoading) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>
        <div className="flex items-center gap-3 px-6 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <button onClick={() => setLocation("/admin-dashboard/academic-sessions")}
            className="flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
              style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", boxShadow: "0 0 24px rgba(34,211,238,0.35)" }}>
              <CalendarRange className="w-8 h-8 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">Fresh Academic Session</h2>
              <p className="text-white font-semibold text-base mt-1" style={{ color: "#22d3ee" }}>{draftName}</p>
              <p className="text-white/50 text-sm mt-2">
                No copy source selected. This will be a blank session — you can configure each module directly from the Admin Dashboard after creation.
              </p>
            </div>
            <button
              onClick={handleCreateSession}
              disabled={isCreating}
              className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:brightness-110"
              style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", color: "#fff", boxShadow: "0 4px 18px rgba(34,211,238,0.30)" }}
              data-testid="button-create-fresh-session">
              {isCreating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <><Plus className="w-4 h-4" /> Create Session</>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!sessionsLoading && !srcSessionId) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>
        <div className="flex items-center gap-3 px-6 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <button onClick={() => setLocation("/admin-dashboard/academic-sessions")}
            className="flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
              style={{ background: "rgba(255,255,255,0.05)" }}>
              <Info className="w-8 h-8 text-white/30" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">No Source Session</h2>
              <p className="text-white/50 text-sm mt-2">
                This session was created without a source to copy from. Configure each module directly from the Admin Dashboard.
              </p>
            </div>
            <Button onClick={() => setLocation("/admin-dashboard")}
              className="bg-indigo-600 hover:bg-indigo-500 text-white">
              Go to Admin Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── SUMMARY VIEW ──────────────────────────────────────────────────────────

  if (view === "summary") {
    const result = existingResult;
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <button onClick={() => setView("grid")}
            className="flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /> Back to Modules
          </button>
          <span className="text-xs font-bold tracking-widest uppercase"
            style={{ color: "rgba(34,211,238,0.70)" }}>Configuration Copy Center</span>
          <div className="w-20" />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">

            {/* Title */}
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", boxShadow: "0 0 24px rgba(34,211,238,0.35)" }}>
                <CheckCircle2 className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-white font-bold text-xl">Configuration Copy Summary</h1>
                <p className="text-white/50 text-sm mt-1">
                  {destSession?.sessionName} — review what was copied before proceeding.
                </p>
                {result && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {result.totalRecordsCopied > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }}>
                        {result.totalRecordsCopied} records duplicated
                      </span>
                    )}
                    {result.sharedSchoolwide.length > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(34,211,238,0.10)", color: "#67e8f9", border: "1px solid rgba(34,211,238,0.20)" }}>
                        {result.sharedSchoolwide.length} shared configs verified
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Copied / Shared */}
            {result && (result.copied.length > 0 || result.sharedSchoolwide.length > 0) && (
              <div className="rounded-xl overflow-hidden" style={GLASS.card}>
                <div className="px-4 py-3 flex items-center gap-2"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(16,185,129,0.05)" }}>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-400">Copied Successfully</span>
                </div>
                <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                  {[...result.copied, ...result.sharedSchoolwide].map(e => (
                    <div key={e.module} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-semibold shrink-0" style={{ color: "rgba(34,211,238,0.55)" }}>
                          {e.parentModule}
                        </span>
                        <span className="text-white/20 text-[10px] shrink-0">›</span>
                        <span className="text-xs text-white/80 font-medium truncate">{e.label}</span>
                      </div>
                      {e.count > 0 && (
                        <span className="text-[10px] text-emerald-400 shrink-0 font-semibold">
                          {e.count} {result.copied.some(c => c.module === e.module) ? "records" : "items"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Requested but empty */}
            {result && result.requestedButEmpty.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={GLASS.card}>
                <div className="px-4 py-3 flex items-center gap-2"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(251,191,36,0.05)" }}>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-bold text-amber-400">Not Configured in Source</span>
                </div>
                <p className="px-4 py-2 text-[10px] text-white/35">
                  These were selected but had no data in the source session. Configure them after activation.
                </p>
                <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                  {result.requestedButEmpty.map(e => (
                    <div key={e.module} className="px-4 py-2.5 flex items-center gap-2">
                      <span className="text-[10px] font-semibold shrink-0" style={{ color: "rgba(251,191,36,0.55)" }}>
                        {e.parentModule}
                      </span>
                      <span className="text-white/20 text-[10px] shrink-0">›</span>
                      <span className="text-xs text-amber-300/60">{e.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skipped */}
            {skippedCount > 0 && (
              <div className="rounded-xl overflow-hidden" style={GLASS.card}>
                <div className="px-4 py-3 flex items-center gap-2"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                  <SkipForward className="w-3.5 h-3.5 text-white/35" />
                  <span className="text-xs font-bold text-white/35">Skipped</span>
                </div>
                <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                  {COPY_MODULES.filter(m => moduleStatuses[m.id] === "skipped").map(m => (
                    <div key={m.id} className="px-4 py-2.5 flex items-center gap-2">
                      <span className="text-sm">{m.emoji}</span>
                      <span className="text-xs text-white/30">{m.label}</span>
                      <span className="ml-auto text-[9px] text-white/20">Configure manually after activation</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clean slate */}
            <div className="rounded-xl overflow-hidden" style={GLASS.card}>
              <div className="px-4 py-3 flex items-center gap-2"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                <Info className="w-3.5 h-3.5 text-white/25" />
                <span className="text-xs font-bold text-white/25">Always Start Fresh</span>
                <span className="text-[10px] text-white/18 ml-1">Historical data is never copied</span>
              </div>
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {CLEAN_SLATE.map(m => (
                  <span key={m.id} className="text-[10px] px-2 py-1 rounded-lg flex items-center gap-1"
                    style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.25)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span>{m.emoji}</span> {m.label}
                  </span>
                ))}
              </div>
            </div>

            {/* CTAs */}
            <div className="space-y-3 pt-2">
              {[
                { icon: GraduationCap, label: "Promote Students",     desc: "Move students from the previous session",  path: "/admin-dashboard/student-registry", color: "#8b5cf6" },
                { icon: UserPlus,      label: "New Admissions",        desc: "Register new students for this session",   path: "/admin-dashboard/student-registry", color: "#10b981" },
                { icon: Users,         label: "Update Faculty Mapping",desc: "Assign teachers to classes and subjects",  path: "/admin-dashboard/faculty-mapping",  color: "#6366f1" },
                { icon: LayoutGrid,    label: "Configure Timetable",   desc: "Build the period schedule",               path: "/admin-dashboard/timetable",        color: "#3b82f6" },
                { icon: CreditCard,    label: "Review Fee Structure",  desc: "Verify fee categories and amounts",        path: "/admin-dashboard/fees-manager",     color: "#10b981" },
                { icon: Zap,           label: "Activate Session",      desc: "Set this as the live academic session",    path: "/admin-dashboard/academic-sessions",color: "#D4AF37" },
              ].map(({ icon: Icon, label, desc, path, color }) => (
                <button key={label}
                  onClick={() => setLocation(path)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all hover:scale-[1.01] group"
                  style={GLASS.card}
                  data-testid={`summary-cta-${label.replace(/\s+/g,"-").toLowerCase()}`}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all group-hover:scale-110"
                    style={{ background: `${color}18` }}>
                    <Icon className="w-4 h-4" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">{label}</p>
                    <p className="text-[10px] text-white/35 mt-0.5 truncate">{desc}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
                </button>
              ))}
            </div>

          </div>
        </div>
      </div>
    );
  }

  // ── DETAIL VIEW ───────────────────────────────────────────────────────────

  if (view === "detail" && openModule) {
    // Only show sub-modules that actually have data in the source session
    const visibleSubs = openModule.subModules.filter(s => (counts[s.id] ?? 0) > 0);
    const allSubIds   = visibleSubs.map(s => s.id);
    const allOn       = allSubIds.length > 0 && allSubIds.every(id => selectedSubIds.has(id));
    const isCopying   = moduleStatuses[openModule.id] === "copying";

    function toggleSub(id: string) {
      setSelectedSubIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else              next.add(id);
        return next;
      });
    }

    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <button
            onClick={() => { setView("grid"); setOpenModuleId(null); }}
            className="flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm"
            data-testid="button-back-to-grid">
            <ArrowLeft className="w-4 h-4" /> Module Overview
          </button>
          <span className="text-xs font-bold tracking-widest uppercase"
            style={{ color: "rgba(34,211,238,0.70)" }}>Configuration Copy Center</span>
          <div className="w-28 flex justify-end">
            <span className="text-[10px] px-2 py-1 rounded-full"
              style={{ background: openModule.category === "A" ? "rgba(16,185,129,0.10)" : "rgba(245,158,11,0.10)",
                       color: openModule.category === "A" ? "#34d399" : "#fbbf24",
                       border: `1px solid ${openModule.category === "A" ? "rgba(16,185,129,0.25)" : "rgba(245,158,11,0.25)"}` }}>
              {openModule.category === "A" ? "Safe to Copy" : "Review First"}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">

            {/* Module title */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}>
                {openModule.emoji}
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">{openModule.label}</h2>
                <p className="text-white/40 text-xs mt-0.5">
                  {visibleSubs.length} configuration item{visibleSubs.length !== 1 ? "s" : ""}
                  {srcSession && <> · Copying from <span className="text-white/60">{srcSession.sessionName}</span></>}
                </p>
              </div>
            </div>

            {/* Category B warning */}
            {openModule.warning && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-xs"
                style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.20)", color: "#fbbf24" }}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p className="leading-relaxed">{openModule.warning}</p>
              </div>
            )}

            {/* Error */}
            {failedError && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-xs"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Copy failed</p>
                  <p className="mt-0.5 opacity-80">{failedError}</p>
                </div>
              </div>
            )}

            {/* Select all */}
            <div className="rounded-xl overflow-hidden" style={GLASS.card}>
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                style={{ background: "rgba(34,211,238,0.04)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                onClick={() => {
                  if (allOn) setSelectedSubIds(new Set());
                  else setSelectedSubIds(new Set(allSubIds));
                }}
                data-testid="toggle-select-all-sub">
                <Toggle on={allOn} onToggle={() => {
                  if (allOn) setSelectedSubIds(new Set());
                  else setSelectedSubIds(new Set(allSubIds));
                }} />
                <span className="text-sm font-bold text-white/80">Select All</span>
                <span className="ml-auto text-xs text-white/30">
                  {selectedSubIds.size}/{allSubIds.length} selected
                </span>
              </div>

              {/* Sub-module rows — only sub-modules with data in the source session */}
              {visibleSubs.map((sub, idx) => {
                const isOn   = selectedSubIds.has(sub.id);
                const cnt    = counts[sub.id] ?? 0;
                const isLast = idx === visibleSubs.length - 1;
                return (
                  <div
                    key={sub.id}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-white/[0.02]"
                    style={{ borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)" }}
                    onClick={() => toggleSub(sub.id)}
                    data-testid={`toggle-sub-${sub.id}`}>
                    <Toggle on={isOn} onToggle={() => toggleSub(sub.id)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold"
                        style={{ color: isOn ? "#e2e8f0" : "rgba(255,255,255,0.40)" }}>
                        {sub.label}
                      </p>
                      <p className="text-[10px] mt-0.5 text-white/30 leading-relaxed">{sub.desc}</p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      {previewLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin text-white/20" />
                      ) : cnt > 0 ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(16,185,129,0.08)", color: "#34d399", border: "1px solid rgba(16,185,129,0.18)" }}>
                          Available · {cnt}
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(251,191,36,0.07)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.18)" }}>
                          No data yet
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Info note for schoolwide items */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[10px]"
              style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.14)", color: "rgba(147,197,253,0.70)" }}>
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-400" />
              <span>
                Most configurations are <strong>school-wide</strong> — they are shared across all sessions and verified rather than physically duplicated.
                Calendar events are the exception: they are physically duplicated with dates advanced to the new year.
              </span>
            </div>

          </div>
        </div>

        {/* Sticky footer */}
        <div className="flex-shrink-0 px-4 sm:px-6 py-4 space-y-2"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)", background: "rgba(10,18,40,0.95)" }}>
          {isNewMode ? (
            <>
              <button
                disabled={selectedSubIds.size === 0}
                onClick={() => {
                  setModuleSelections(prev => ({ ...prev, [openModule.id]: [...selectedSubIds] }));
                  setModuleStatuses(prev => ({ ...prev, [openModule.id]: "copied" }));
                  setView("grid");
                }}
                data-testid="button-confirm-selection"
                className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2
                           disabled:opacity-40 transition-all hover:brightness-110 active:scale-[0.99]"
                style={{ background: "linear-gradient(135deg,#10b981,#22d3ee)", color: "#fff",
                         boxShadow: "0 4px 18px rgba(16,185,129,0.25)" }}>
                <Check className="w-4 h-4" /> Confirm Selection ({selectedSubIds.size})
              </button>
              <button
                onClick={() => { handleSkipModule(openModule.id); setView("grid"); }}
                className="w-full h-9 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all hover:bg-white/5"
                style={{ color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}
                data-testid="button-skip-module">
                <SkipForward className="w-3.5 h-3.5" /> Skip this module
              </button>
            </>
          ) : (
          <>
            <button
              disabled={selectedSubIds.size === 0 || isCopying || !srcSessionId}
              onClick={() => copyMut.mutate({ modId: openModule.id, subIds: [...selectedSubIds] })}
              data-testid="button-copy-selected"
              className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2
                         disabled:opacity-40 transition-all hover:brightness-110 active:scale-[0.99]"
              style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", color: "#fff",
                       boxShadow: "0 4px 18px rgba(34,211,238,0.25)" }}>
              {isCopying
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Copying…</>
                : <><Copy className="w-4 h-4" /> Copy Selected Configuration ({selectedSubIds.size})</>}
            </button>
            <button
              onClick={() => { handleSkipModule(openModule.id); setView("grid"); }}
              className="w-full h-9 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all hover:bg-white/5"
              style={{ color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}
              data-testid="button-skip-module">
              <SkipForward className="w-3.5 h-3.5" /> Skip this module
            </button>
          </>
          )}
        </div>
      </div>
    );
  }

  // ── GRID VIEW (default) ───────────────────────────────────────────────────

  function ModuleCard({ mod }: { mod: CopyModuleDef }) {
    const status    = moduleStatuses[mod.id] ?? "pending";
    const isCopied  = status === "copied";
    const isSkipped = status === "skipped";
    const isFailed  = status === "failed";
    const subCnt    = mod.subModules.length;

    return (
      <div
        className="rounded-xl p-4 flex flex-col gap-3 transition-all duration-200"
        style={{
          background: isCopied  ? "rgba(16,185,129,0.07)"
                    : isFailed  ? "rgba(239,68,68,0.07)"
                    : isSkipped ? "rgba(255,255,255,0.025)"
                    : "rgba(255,255,255,0.04)",
          border: isCopied  ? "1px solid rgba(16,185,129,0.25)"
                : isFailed  ? "1px solid rgba(239,68,68,0.25)"
                : isSkipped ? "1px solid rgba(255,255,255,0.06)"
                : "1px solid rgba(255,255,255,0.08)",
        }}
        data-testid={`module-card-${mod.id}`}>

        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-base"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {mod.emoji}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate"
                style={{ color: isSkipped ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.85)" }}>
                {mod.label}
              </p>
              <p className="text-[10px] text-white/30 mt-0.5">
                {subCnt} item{subCnt !== 1 ? "s" : ""}
                {mod.category === "B" && <span className="ml-1.5 text-amber-400/60">Review required</span>}
              </p>
            </div>
          </div>
          {isNewMode && isCopied ? (
            <span className="flex items-center gap-1 text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full"
              style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }}>
              <Check className="w-2.5 h-2.5" /> READY
            </span>
          ) : (
            <StatusBadge status={status} />
          )}
        </div>

        <div className="flex items-center gap-2 mt-auto">
          {isCopied ? (
            <button
              onClick={() => handleOpenModule(mod.id)}
              className="flex-1 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all hover:brightness-110"
              style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.22)" }}
              data-testid={`button-review-${mod.id}`}>
              <Copy className="w-3 h-3" /> Review
            </button>
          ) : isFailed ? (
            <button
              onClick={() => handleOpenModule(mod.id)}
              className="flex-1 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all hover:brightness-110"
              style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.22)" }}
              data-testid={`button-retry-${mod.id}`}>
              <RotateCcw className="w-3 h-3" /> Retry
            </button>
          ) : (
            <button
              onClick={() => handleOpenModule(mod.id)}
              className="flex-1 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all hover:brightness-110 active:scale-95"
              style={{ background: "rgba(34,211,238,0.10)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.22)" }}
              data-testid={`button-open-${mod.id}`}>
              Open <ChevronRight className="w-3 h-3" />
            </button>
          )}
          {!isCopied && !isFailed && (
            <button
              onClick={() => handleSkipModule(mod.id)}
              title="Skip this module"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5"
              style={{ color: "rgba(255,255,255,0.20)", border: "1px solid rgba(255,255,255,0.07)" }}
              data-testid={`button-skip-card-${mod.id}`}>
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── STEP 3 VIEW (new mode: Promote Students) ─────────────────────────────
  if (isNewMode && view === "step3") {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <button onClick={() => setView("grid")}
            className="flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Copy Config</span>
          </button>
          <div className="text-center">
            <p className="text-sm font-bold text-white/80">Configuration Copy Center</p>
            <p className="text-[10px] text-white/35">Academic Session Setup</p>
          </div>
          <div className="w-24" />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">
            <StepBar current={3} />

            {/* Session banner */}
            {(srcSession || draftName) && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.15)" }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-white/35 uppercase font-bold tracking-wider mb-0.5">Copying from</p>
                  <p className="text-sm font-semibold text-white/80 truncate">{srcSession?.sessionName ?? "—"}</p>
                </div>
                <ArrowRight className="w-5 h-5 text-cyan-400/50 flex-shrink-0" />
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-[10px] text-white/35 uppercase font-bold tracking-wider mb-0.5">New Session</p>
                  <p className="text-sm font-semibold text-cyan-300 truncate">{draftName}</p>
                  {draftStart && draftEnd && (
                    <p className="text-[10px] text-white/35 mt-0.5">{fmtDate(draftStart)} → {fmtDate(draftEnd)}</p>
                  )}
                </div>
              </div>
            )}

            {/* Promote Students info card */}
            <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="px-5 py-4 flex items-center gap-3"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(99,102,241,0.06)" }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", boxShadow: "0 0 16px rgba(99,102,241,0.30)" }}>
                  <GraduationCap className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white/85">Promote Students</p>
                  <p className="text-[10px] text-white/40 mt-0.5">Move students to the next class/grade</p>
                </div>
              </div>
              <div className="px-5 py-5 space-y-4">
                <p className="text-xs text-white/55 leading-relaxed">
                  After the session is created, you can promote students from <span className="text-white/75 font-semibold">{srcSession?.sessionName ?? "the previous session"}</span> to <span className="text-cyan-300 font-semibold">{draftName}</span>.
                  Promotion moves each student to their next class based on their exam results and promotion rules.
                </p>
                <div className="space-y-2">
                  {[
                    { icon: "📋", label: "Review exam results first", desc: "Promotion is based on Term 3 final results" },
                    { icon: "✅", label: "Bulk or individual promotion", desc: "Promote entire class or select students manually" },
                    { icon: "🔒", label: "Safe to defer", desc: "You can promote students at any time after session creation" },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-3 px-3 py-2.5 rounded-lg"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <span className="text-base flex-shrink-0 mt-0.5">{item.icon}</span>
                      <div>
                        <p className="text-xs font-semibold text-white/75">{item.label}</p>
                        <p className="text-[10px] text-white/40 mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[10px]"
                  style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.14)", color: "rgba(196,181,253,0.70)" }}>
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "#a78bfa" }} />
                  <span>Promotion can be done from the <strong>Admin Dashboard → Student Management</strong> after the session is created.</span>
                </div>
              </div>
            </div>

            {/* Footer navigation */}
            <div className="pb-4 flex gap-3">
              <button
                onClick={() => setView("grid")}
                className="flex-1 h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-white/5"
                style={{ color: "rgba(255,255,255,0.60)", border: "1px solid rgba(255,255,255,0.12)" }}
                data-testid="button-step3-prev">
                <ArrowLeft className="w-4 h-4" /> Previous
              </button>
              <button
                onClick={() => setView("step4")}
                className="flex-1 h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.99]"
                style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", color: "#fff",
                         boxShadow: "0 4px 18px rgba(34,211,238,0.25)" }}
                data-testid="button-step3-next">
                Next <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP 4 VIEW (new mode: Activate / Create Session) ────────────────────
  if (isNewMode && view === "step4") {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <button onClick={() => setView("step3")}
            className="flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Promote Students</span>
          </button>
          <div className="text-center">
            <p className="text-sm font-bold text-white/80">Configuration Copy Center</p>
            <p className="text-[10px] text-white/35">Academic Session Setup</p>
          </div>
          <div className="w-24" />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">
            <StepBar current={4} />

            {/* Title */}
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", boxShadow: "0 0 24px rgba(34,211,238,0.35)" }}>
                <CalendarRange className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-white font-bold text-xl">Ready to Create Session</h1>
                <p className="text-white/50 text-sm mt-1">Review the details below and confirm to create your new academic session.</p>
              </div>
            </div>

            {/* Session summary card */}
            <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="px-5 py-4 flex items-center gap-2"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(34,211,238,0.05)" }}>
                <Check className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs font-bold text-cyan-400 tracking-wider uppercase">Session Summary</span>
              </div>
              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                {[
                  { label: "Session Name", value: draftName, highlight: true },
                  { label: "Start Date",   value: draftStart ? fmtDate(draftStart) : "—", highlight: false },
                  { label: "End Date",     value: draftEnd   ? fmtDate(draftEnd)   : "—", highlight: false },
                  { label: "Copy Source",  value: srcSession?.sessionName ?? "None (fresh session)", highlight: false },
                  { label: "Modules Ready", value: readyCount > 0 ? `${readyCount} module${readyCount !== 1 ? "s" : ""} confirmed` : "No modules selected (fresh start)", highlight: false },
                ].map(row => (
                  <div key={row.label} className="px-5 py-3 flex items-center justify-between gap-4">
                    <span className="text-xs text-white/40 shrink-0">{row.label}</span>
                    <span className={`text-xs font-semibold text-right ${row.highlight ? "text-cyan-300" : "text-white/75"}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Info note */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[10px]"
              style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.12)", color: "rgba(147,197,253,0.70)" }}>
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-400" />
              <span>The session starts as a <strong>Draft</strong>. Activate it from the Sessions page when you are ready to make it the active session for your school.</span>
            </div>

            {/* Footer navigation */}
            <div className="pb-4 space-y-3">
              <button
                onClick={handleCreateSession}
                disabled={isCreating}
                className="w-full h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:brightness-110 active:scale-[0.99]"
                style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", color: "#fff",
                         boxShadow: "0 4px 24px rgba(34,211,238,0.35)", fontSize: "15px" }}
                data-testid="button-create-session-final">
                {isCreating
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> Creating session…</>
                  : <><Plus className="w-5 h-5" /> Create Session</>}
              </button>
              <button
                onClick={() => setView("step3")}
                disabled={isCreating}
                className="w-full h-10 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-white/5 disabled:opacity-40"
                style={{ color: "rgba(255,255,255,0.50)", border: "1px solid rgba(255,255,255,0.10)" }}
                data-testid="button-step4-prev">
                <ArrowLeft className="w-4 h-4" /> Previous
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <button
          onClick={() => setLocation("/admin-dashboard/academic-sessions")}
          className="flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm"
          data-testid="button-back-to-dashboard">
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Admin Dashboard</span>
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-white/80">Configuration Copy Center</p>
          <p className="text-[10px] text-white/35">Academic Session Setup</p>
        </div>
        <div className="w-24 flex justify-end">
          {allDone && (
            <button
              onClick={() => setView("summary")}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:brightness-110"
              style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", color: "#fff" }}
              data-testid="button-view-summary">
              Summary →
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-8">

          {/* Step bar */}
          <StepBar current={2} />

          {/* Session banner */}
          {(srcSession || destSession || (isNewMode && draftName)) && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.15)" }}>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-white/35 uppercase font-bold tracking-wider mb-0.5">Copying from</p>
                <p className="text-sm font-semibold text-white/80 truncate">
                  {srcSession?.sessionName ?? "—"}
                </p>
                {srcSession && (
                  <p className="text-[10px] text-white/35 mt-0.5">
                    {fmtDate(srcSession.startDate)} → {fmtDate(srcSession.endDate)}
                  </p>
                )}
              </div>
              <ArrowRight className="w-5 h-5 text-cyan-400/50 flex-shrink-0" />
              <div className="flex-1 min-w-0 text-right">
                <p className="text-[10px] text-white/35 uppercase font-bold tracking-wider mb-0.5">New Session</p>
                <p className="text-sm font-semibold text-cyan-300 truncate">
                  {isNewMode ? draftName : (destSession?.sessionName ?? "—")}
                </p>
                <p className="text-[10px] text-white/35 mt-0.5">
                  {isNewMode
                    ? (draftStart && draftEnd ? `${fmtDate(draftStart)} → ${fmtDate(draftEnd)}` : "")
                    : (destSession ? `${fmtDate(destSession.startDate)} → ${fmtDate(destSession.endDate)}` : "")}
                </p>
              </div>
            </div>
          )}

          {/* Progress pill */}
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-white/50">
              {doneCount} of {totalModules} modules configured
            </p>
            <div className="flex items-center gap-3">
              {copiedCount > 0 && (
                <span className="text-[10px] font-semibold text-emerald-400">
                  {copiedCount} copied
                </span>
              )}
              {skippedCount > 0 && (
                <span className="text-[10px] font-semibold text-white/30">
                  {skippedCount} skipped
                </span>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 rounded-full -mt-4" style={{ background: "rgba(255,255,255,0.07)" }}>
            <div
              className="h-1 rounded-full transition-all duration-500"
              style={{
                width: `${totalModules > 0 ? (doneCount / totalModules) * 100 : 0}%`,
                background: allDone ? "#10b981" : "linear-gradient(90deg,#22d3ee,#6366f1)",
              }} />
          </div>

          {/* FOUNDATION section */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
              <span className="text-[10px] font-bold tracking-widest uppercase px-3"
                style={{ color: "rgba(16,185,129,0.70)" }}>Foundation</span>
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
            </div>
            <p className="text-[10px] text-white/30 mb-4 -mt-2">
              Safe to copy — school-wide configuration templates shared across all sessions.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {foundationModules.map(m => <ModuleCard key={m.id} mod={m} />)}
            </div>
          </div>

          {/* MANAGEMENT section */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
              <span className="text-[10px] font-bold tracking-widest uppercase px-3"
                style={{ color: "rgba(245,158,11,0.70)" }}>Management</span>
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
            </div>
            <p className="text-[10px] text-white/30 mb-4 -mt-2">
              Review before copying — these modules contain operational configurations that may need adjustment.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {managementModules.map(m => <ModuleCard key={m.id} mod={m} />)}
            </div>
          </div>

          {/* Clean slate notice */}
          <div className="rounded-xl px-4 py-4"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Circle className="w-3 h-3 text-white/20" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-white/25">
                Always Start Fresh
              </span>
              <span className="text-[9px] text-white/15 ml-1">Historical data is never copied</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CLEAN_SLATE.map(m => (
                <span key={m.id}
                  className="text-[10px] px-2 py-1 rounded-lg flex items-center gap-1"
                  style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  {m.emoji} {m.label}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom CTA */}
          <div className="pb-4">
            {isNewMode ? (
              <div className="space-y-2">
                {readyCount > 0 && (
                  <p className="text-[10px] text-center text-white/35">
                    {readyCount} module{readyCount !== 1 ? "s" : ""} confirmed — you can adjust this any time
                  </p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setLocation("/admin-dashboard/academic-sessions")}
                    className="flex-1 h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-white/5"
                    style={{ color: "rgba(255,255,255,0.60)", border: "1px solid rgba(255,255,255,0.12)" }}
                    data-testid="button-step2-prev">
                    <ArrowLeft className="w-4 h-4" /> Previous
                  </button>
                  <button
                    onClick={() => setView("step3")}
                    className="flex-1 h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.99]"
                    style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", color: "#fff",
                             boxShadow: "0 4px 18px rgba(34,211,238,0.25)" }}
                    data-testid="button-step2-next">
                    Next <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setView("summary")}
                className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.99]"
                style={{
                  background: allDone
                    ? "linear-gradient(135deg,#22d3ee,#6366f1)"
                    : "rgba(255,255,255,0.06)",
                  color: allDone ? "#fff" : "rgba(255,255,255,0.40)",
                  border: allDone ? "none" : "1px solid rgba(255,255,255,0.10)",
                  boxShadow: allDone ? "0 4px 18px rgba(34,211,238,0.25)" : "none",
                }}
                data-testid="button-finish-copy">
                {allDone
                  ? <><CheckCircle2 className="w-4 h-4" /> View Copy Summary</>
                  : <><Info className="w-4 h-4" /> View Summary (configure remaining modules later)</>}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
