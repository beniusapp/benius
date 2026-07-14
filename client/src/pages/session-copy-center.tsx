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
  ArrowRight, SkipForward, RotateCcw, X,
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
      { id: "grading-policy",          label: "Grading Policy",          desc: "Grade boundaries and GPA thresholds" },
      { id: "promotion-policy",        label: "Promotion Policy",        desc: "Rules governing student promotion" },
      { id: "attendance-policy",       label: "Attendance Policy",       desc: "Minimum attendance requirements" },
      { id: "leave-policy",            label: "Leave Policy",            desc: "Student and staff leave entitlements" },
    ],
  },
  {
    id: "timetable-master", label: "Timetable Master", emoji: "📅",
    category: "A", group: "FOUNDATION",
    subModules: [
      { id: "bell-structure",     label: "Bell Structure",         desc: "Daily period timing and bell schedule" },
      { id: "period-config",      label: "Period Configuration",   desc: "Period lengths, breaks, and types" },
      { id: "timetable-template", label: "Timetable Template",     desc: "Draft period assignments per class" },
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
      { id: "teacher-class-assignments", label: "Teacher–Class Assignments", desc: "Teacher allocations to classes and subjects" },
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

  const destSessionId = parseInt(sessionIdStr ?? "0");

  // ── Views ──
  type View = "grid" | "detail" | "summary";
  const [view, setView] = useState<View>("grid");
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);
  const [selectedSubIds, setSelectedSubIds] = useState<Set<string>>(new Set());
  const [moduleStatuses, setModuleStatuses] = useState<Record<string, ModuleStatus>>({});
  const [failedError, setFailedError] = useState<string>("");

  // ── Data ──
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ["/api/admin/academic-sessions"],
    queryFn: async () => {
      const r = await fetch("/api/admin/academic-sessions", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load sessions");
      return r.json();
    },
  });

  const destSession  = sessions.find(s => s.id === destSessionId) ?? null;
  const srcSessionId = destSession?.copiedFromSessionId ?? null;
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
    // Default: select all sub-modules that have data
    const initialSelected = new Set(
      mod.subModules
        .filter(s => (counts[s.id] ?? 0) > 0 || mod.category === "A")
        .map(s => s.id)
    );
    setSelectedSubIds(initialSelected.size > 0 ? initialSelected : new Set(mod.subModules.map(s => s.id)));
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

  // ── Computed ──
  const foundationModules  = COPY_MODULES.filter(m => m.group === "FOUNDATION");
  const managementModules  = COPY_MODULES.filter(m => m.group === "MANAGEMENT");
  const totalModules       = COPY_MODULES.length;
  const copiedCount        = Object.values(moduleStatuses).filter(s => s === "copied").length;
  const skippedCount       = Object.values(moduleStatuses).filter(s => s === "skipped").length;
  const doneCount          = copiedCount + skippedCount;
  const allDone            = doneCount === totalModules;

  const existingResult = useMemo(
    () => parseExistingResult(destSession?.copiedModules ?? null),
    [destSession?.copiedModules]
  );

  // ── No source session state ────────────────────────────────────────────────

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
    const allSubIds  = openModule.subModules.map(s => s.id);
    const allOn      = allSubIds.every(id => selectedSubIds.has(id));
    const isCopying  = moduleStatuses[openModule.id] === "copying";

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
                  {openModule.subModules.length} configuration item{openModule.subModules.length !== 1 ? "s" : ""}
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

              {/* Sub-module rows */}
              {openModule.subModules.map((sub, idx) => {
                const isOn  = selectedSubIds.has(sub.id);
                const cnt   = counts[sub.id] ?? 0;
                const isLast = idx === openModule.subModules.length - 1;
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
          <StatusBadge status={status} />
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
          {(srcSession || destSession) && (
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
                  {destSession?.sessionName ?? "—"}
                </p>
                {destSession && (
                  <p className="text-[10px] text-white/35 mt-0.5">
                    {fmtDate(destSession.startDate)} → {fmtDate(destSession.endDate)}
                  </p>
                )}
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
          </div>

        </div>
      </div>
    </div>
  );
}
