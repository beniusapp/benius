/**
 * AcademicSessions — Enterprise-grade, multi-tenant academic year management.
 *
 * Session creation rules:
 *  • Only ONE session per school may be active at any time.
 *  • Activation requires typing "ROLLOVER" in a safety confirmation modal.
 *  • Deleting an active session is blocked in the UI.
 *  • All API calls carry implicit tenant scope via the admin session cookie.
 *  • Session names must be unique; dates must not overlap; start < end.
 *
 * Copy Configuration categories:
 *  A – Safe to Copy (green, default-checked)
 *  B – Copy with Review (yellow, default-unchecked, warnings shown)
 *  C – Never Copy (red lock, disabled)
 *  D – Generated after creation (blue info banner)
 */

import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  CalendarRange, Plus, Trash2, Zap, CheckCircle2, Clock, Loader2,
  AlertTriangle, X, ChevronDown, ChevronRight, Check, Copy,
  Users, UserPlus, BookOpen, LayoutGrid, ArrowRight, Shield,
  ToggleLeft, ToggleRight, GraduationCap, Settings,
  Lock, Info, CreditCard, Package, MapPin, Calendar,
  FileText, BarChart2, Bell, UserSquare, CheckSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fmtDate } from "@/lib/dateUtils";

// ── Types ──────────────────────────────────────────────────────────────────────

// Matches the SessionCopyResult the backend writes into copiedModules JSON
// and returns in the creation response body.
interface SessionCopyEntry {
  module: string;       // sub-module ID, e.g. "classes"
  parentModule: string; // parent group label, e.g. "School Setup"
  label: string;        // sub-module label, e.g. "Classes"
  count: number;
  note: string;
}
interface SessionCopyResult {
  sourceSessionId: number;
  sourceSessionName: string;
  destSessionId: number;
  approvedModules: string[];
  copied: SessionCopyEntry[];           // physically duplicated records
  sharedSchoolwide: SessionCopyEntry[]; // school-level configs, already available
  requestedButEmpty: SessionCopyEntry[]; // requested but no source data existed
  cleanSlate: string[];                 // Category C — never copied
  totalRecordsCopied: number;
  timestamp: string;
}

interface AcademicSession {
  id: number;
  schoolId: number;
  sessionName: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  status: string;
  newAdmissionsEnabled: boolean;
  promotionStrategy: string;
  copiedFromSessionId: number | null;
  copiedModules: string | null; // JSON-stringified SessionCopyResult or null
  createdAt: string | null;
  // Extra fields returned only by the POST /api/admin/academic-sessions endpoint
  copyResult?: SessionCopyResult | null;
  executionLog?: string[];
}

interface Props { schoolId: number }

// ── Module Tree — 4-Category Classification ────────────────────────────────────
type ModuleCategory = "A" | "B" | "C";

interface SubModule {
  id: string;
  label: string;
  notCopied?: string;   // displayed on Category B items
}
interface CopyModule {
  id: string;
  label: string;
  emoji: string;
  category: ModuleCategory;
  subModules: SubModule[];
  warning?: string;     // shown on Category B
  reason?: string;      // shown on Category C
}

const COPY_MODULE_TREE: CopyModule[] = [
  // ─── Category A: Safe to Copy ───────────────────────────────────────────────
  {
    id: "school-setup", label: "School Setup", emoji: "⚙️", category: "A",
    subModules: [
      { id: "classes",           label: "Classes" },
      { id: "sections",          label: "Sections" },
      { id: "subjects",          label: "Subjects" },
      { id: "exam-types",        label: "Exam Types" },
      { id: "class-mapping",     label: "Class–Section Mapping" },
      { id: "subject-mapping",   label: "Class–Subject Mapping" },
      { id: "promotion-policy",  label: "Exam & Promotion Policy" },
      { id: "attendance-policy", label: "Attendance Policy" },
      { id: "leave-policy",      label: "Leave Policy" },
      { id: "grading-policy",    label: "Academic Policy" },
    ],
  },
  {
    id: "timetable-master", label: "Timetable Master", emoji: "📅", category: "A",
    subModules: [
      { id: "bell-structure", label: "Bell Structure" },
      { id: "period-config",  label: "Schedule Grid" },
    ],
  },
  {
    id: "school-calendar", label: "School Calendar", emoji: "🗓️", category: "A",
    subModules: [
      { id: "holiday-templates",  label: "Holiday Templates" },
      { id: "recurring-events",   label: "Recurring Events" },
    ],
  },
  {
    id: "id-card-gen", label: "ID Card Generator", emoji: "💳", category: "A",
    subModules: [
      { id: "card-layouts",     label: "Card Layouts" },
      { id: "print-templates",  label: "Print Templates" },
    ],
  },

  // ─── Category B: Copy with Review ───────────────────────────────────────────
  {
    id: "faculty-mapping", label: "Faculty Mapping", emoji: "🗂️", category: "B",
    warning: "Teacher allocations should be reviewed before activating the session.",
    subModules: [
      { id: "teacher-class-assignments", label: "Teacher–Class–Subject Assignments" },
    ],
  },
  {
    id: "fees-payments", label: "Fees & Payments", emoji: "💰", category: "B",
    warning: "Only fee configuration will be copied. Ledger, receipts and dues are excluded.",
    subModules: [
      { id: "fee-categories",   label: "Fee Categories" },
      { id: "fee-heads",        label: "Fee Heads" },
      { id: "fee-structure",    label: "Fee Structure" },
      { id: "fine-rules",       label: "Fine Rules" },
      { id: "concession-rules", label: "Concession Rules" },
    ],
  },
  {
    id: "assets-inventory", label: "Assets & Inventory", emoji: "📦", category: "B",
    warning: "Only asset master and categories will be copied. Movement and maintenance history is excluded.",
    subModules: [
      { id: "asset-categories",    label: "Asset Categories" },
      { id: "asset-master",        label: "Asset Master" },
      { id: "storage-locations",   label: "Storage Locations" },
    ],
  },

  // ─── Category C: Never Copy ──────────────────────────────────────────────────
  {
    id: "student-registry", label: "Student Registry", emoji: "🎓", category: "C",
    reason: "Students are transferred only through the Student Promotion Engine or New Admissions workflow.",
    subModules: [],
  },
  {
    id: "exam-controller", label: "Exam Controller", emoji: "🏆", category: "C",
    reason: "Marks, grades and report card records must never be copied.",
    subModules: [],
  },
  {
    id: "attendance", label: "Attendance Overview", emoji: "📊", category: "C",
    reason: "Attendance is strictly session-specific.",
    subModules: [],
  },
  {
    id: "complaint-hub", label: "Complaint Hub", emoji: "🛡️", category: "C",
    reason: "Complaints belong only to the session they were raised in.",
    subModules: [],
  },
  {
    id: "noticeboard", label: "Noticeboard", emoji: "🔔", category: "C",
    reason: "Announcements should not carry forward to a new academic year.",
    subModules: [],
  },
  {
    id: "visitor-log", label: "Visitor Log", emoji: "🚪", category: "C",
    reason: "Visitor history must remain archived in the original session.",
    subModules: [],
  },
  {
    id: "audit-logs", label: "Audit Logs", emoji: "🔐", category: "C",
    reason: "Audit history is immutable and must not be replicated.",
    subModules: [],
  },
];


// ── Glassmorphic style tokens ──────────────────────────────────────────────────
const GLASS = {
  card: {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.08)",
  } as React.CSSProperties,
  activeCard: {
    background: "rgba(34,211,238,0.06)",
    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(34,211,238,0.25)",
    boxShadow: "0 0 24px rgba(34,211,238,0.10)",
  } as React.CSSProperties,
  modalOverlay: {
    background: "rgba(0,0,0,0.85)",
    backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
  } as React.CSSProperties,
  modal: {
    background: "rgba(10,18,36,0.98)",
    backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
    border: "1px solid rgba(255,255,255,0.10)",
  } as React.CSSProperties,
};

// ── Small UI helpers ───────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold tracking-widest uppercase mb-3"
      style={{ color: "rgba(34,211,238,0.7)" }}>
      {children}
    </p>
  );
}

// ── Simple toggle UI (used in CreateSessionModal) ──────────────────────────────
function ToggleSwitch({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      data-testid={`toggle-${on ? "on" : "off"}`}
      className="flex items-center gap-2 text-sm transition-opacity disabled:opacity-40"
    >
      {on
        ? <ToggleRight className="w-6 h-6" style={{ color: "#22d3ee" }} />
        : <ToggleLeft  className="w-6 h-6 text-white/30" />}
    </button>
  );
}

export function CopyConfigSelector({ selected, onChange }: { selected: Set<string>; onChange: (next: Set<string>) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(COPY_MODULE_TREE.filter(m => m.category !== "C").map(m => m.id))
  );

  const selectableIds = COPY_MODULE_TREE
    .filter(m => m.category === "A" || m.category === "B")
    .flatMap(m => m.subModules.map(s => s.id));

  const allSelected  = selectableIds.every(id => selected.has(id));
  const someSelected = !allSelected && selectableIds.some(id => selected.has(id));

  function toggleAll() {
    onChange(allSelected ? new Set() : new Set(selectableIds));
  }

  function toggleModule(mod: CopyModule) {
    if (mod.category === "C") return;
    const childIds = mod.subModules.map(s => s.id);
    const allOn    = childIds.every(id => selected.has(id));
    const next     = new Set(selected);
    if (allOn) childIds.forEach(id => next.delete(id));
    else        childIds.forEach(id => next.add(id));
    onChange(next);
  }

  function toggleSub(mod: CopyModule, subId: string) {
    if (mod.category === "C") return;
    const next = new Set(selected);
    if (next.has(subId)) {
      next.delete(subId);
    } else {
      next.add(subId);
    }
    onChange(next);
  }

  function toggleExpand(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else               next.add(id);
    setExpanded(next);
  }

  const catAModules = COPY_MODULE_TREE.filter(m => m.category === "A");
  const catBModules = COPY_MODULE_TREE.filter(m => m.category === "B");
  const catCModules = COPY_MODULE_TREE.filter(m => m.category === "C");

  function renderModuleRow(mod: CopyModule) {
    const isC        = mod.category === "C";
    const childIds   = mod.subModules.map(s => s.id);
    const allChildOn = childIds.length > 0 && childIds.every(id => selected.has(id));
    const someChildOn= childIds.length > 0 && !allChildOn && childIds.some(id => selected.has(id));
    const isExpanded = expanded.has(mod.id);

    return (
      <div key={mod.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        {/* Parent row */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 select-none"
          style={{ background: isC ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.02)" }}>

          {isC ? (
            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
              <Lock className="w-3 h-3 text-red-500/50" />
            </div>
          ) : (
            <Checkbox
              checked={allChildOn}
              indeterminate={someChildOn}
              onChange={() => toggleModule(mod)}
              testId={`module-check-${mod.id}`}
            />
          )}

          <span className="text-sm mr-1">{mod.emoji}</span>

          <span
            className="flex-1 text-sm font-semibold"
            style={{ color: isC ? "rgba(255,255,255,0.25)" : (allChildOn || someChildOn) ? "#e2e8f0" : "rgba(255,255,255,0.55)" }}
          >
            {mod.label}
          </span>

          {!isC && (
            <span className="text-[10px] text-white/30 mr-1">
              {childIds.filter(id => selected.has(id)).length}/{childIds.length}
            </span>
          )}

          {isC ? (
            <span className="text-[9px] font-bold text-red-500/60 tracking-wider mr-1">NEVER COPY</span>
          ) : (
            <button
              type="button"
              onClick={() => toggleExpand(mod.id)}
              className="text-white/30 hover:text-white/70 transition-colors"
              data-testid={`module-expand-${mod.id}`}
            >
              {isExpanded
                ? <ChevronDown  className="w-3.5 h-3.5" />
                : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Category C reason row */}
        {isC && (
          <div className="pl-10 pr-4 pb-2 -mt-0.5">
            <p className="text-[10px] text-white/25 italic leading-relaxed">{mod.reason}</p>
          </div>
        )}

        {/* Sub-module rows */}
        {!isC && isExpanded && (
          <div style={{ background: "rgba(0,0,0,0.20)" }}>
            {/* Category B warning */}
            {mod.category === "B" && mod.warning && (
              <div className="mx-4 mt-2.5 mb-1.5 flex items-start gap-2 px-3 py-2 rounded-lg text-[10px]"
                style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.20)", color: "#fbbf24" }}>
                <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                {mod.warning}
              </div>
            )}

            {mod.subModules.map(sub => (
              <div
                key={sub.id}
                className="flex items-center gap-3 pl-10 pr-4 py-2 cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
                onClick={() => toggleSub(mod, sub.id)}
                data-testid={`submodule-check-${sub.id}`}
              >
                <Checkbox
                  checked={selected.has(sub.id)}
                  size="sm"
                  onChange={() => toggleSub(mod, sub.id)}
                />
                <span
                  className="text-xs"
                  style={{ color: selected.has(sub.id) ? "#cbd5e1" : "rgba(255,255,255,0.40)" }}
                >
                  {sub.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const totalSelected = selectableIds.filter(id => selected.has(id)).length;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>

      {/* ── Select All ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        style={{ background: "rgba(34,211,238,0.06)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        onClick={toggleAll}
        data-testid="module-select-all"
      >
        <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} testId="check-select-all" />
        <span className="text-sm font-bold text-white">Select All</span>
        <span className="ml-auto text-xs text-white/40">
          {totalSelected} / {selectableIds.length} sub-modules
        </span>
      </div>

      {/* ── Category A: Safe to Copy ── */}
      <div style={{ borderBottom: "1px solid rgba(16,185,129,0.15)" }}>
        <div className="flex items-center gap-2 px-4 py-2"
          style={{ background: "rgba(16,185,129,0.05)" }}>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-[10px] font-bold tracking-widest uppercase text-emerald-400/80">
            Category A — Safe to Copy
          </span>
          <span className="ml-auto text-[10px] text-white/30">Default: Selected</span>
        </div>
        {catAModules.map(renderModuleRow)}
      </div>

      {/* ── Category B: Copy with Review ── */}
      <div style={{ borderBottom: "1px solid rgba(245,158,11,0.15)" }}>
        <div className="flex items-center gap-2 px-4 py-2"
          style={{ background: "rgba(245,158,11,0.04)" }}>
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span className="text-[10px] font-bold tracking-widest uppercase text-amber-400/80">
            Category B — Verify Before Copying
          </span>
          <span className="ml-auto text-[10px] text-white/30">Default: Unselected</span>
        </div>
        {catBModules.map(renderModuleRow)}
      </div>

      {/* ── Category C: Never Copy ── */}
      <div style={{ borderBottom: "1px solid rgba(239,68,68,0.12)" }}>
        <div className="flex items-center gap-2 px-4 py-2"
          style={{ background: "rgba(239,68,68,0.04)" }}>
          <Lock className="w-3 h-3 text-red-500/60" />
          <span className="text-[10px] font-bold tracking-widest uppercase text-red-500/70">
            Category C — Never Copied
          </span>
          <span className="ml-auto text-[10px] text-white/30">Always clean slate</span>
        </div>
        <div className="px-4 pt-1 pb-2">
          <p className="text-[10px] text-white/30 italic mb-2">
            This module always starts as a clean slate to preserve historical records.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {catCModules.map(mod => (
              <div key={mod.id}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)" }}>
                <Lock className="w-2.5 h-2.5 text-red-500/40 flex-shrink-0" />
                <span className="text-[10px] text-white/25">{mod.emoji} {mod.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Category D: Generated After Creation ── */}
      <div className="px-4 py-3" style={{ background: "rgba(59,130,246,0.04)" }}>
        <div className="flex items-center gap-2 mb-2">
          <Info className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] font-bold tracking-widest uppercase text-blue-400/80">
            Category D — Generated After Session Creation
          </span>
        </div>
        <p className="text-[10px] text-white/30 mb-2">
          These are not copied — they are automatically generated after the session is activated.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {["Student Promotion","New Admissions","Attendance Records","Marks Entry","Report Cards","Fee Transactions"].map(item => (
            <span key={item}
              className="text-[10px] px-2 py-1 rounded-full"
              style={{ background: "rgba(59,130,246,0.08)", color: "rgba(147,197,253,0.70)", border: "1px solid rgba(59,130,246,0.15)" }}>
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Keep the old export name for any external references
export { CopyConfigSelector as ModulePermissionSelector };

// ══════════════════════════════════════════════════════════════════════════════
// CREATE SESSION MODAL — Enterprise 4xl wide, scrollable, 2-section form
// ══════════════════════════════════════════════════════════════════════════════
interface CreateModalProps {
  sessions:  AcademicSession[];
  onClose:   () => void;
  isPending: boolean;
  onSubmit:  (payload: CreatePayload) => void;
}
export interface CreatePayload {
  sessionName:          string;
  startDate:            string;
  endDate:              string;
  status:               "draft" | "active";
  setAsActive:          boolean;
  newAdmissionsEnabled: boolean;
  promotionStrategy:    "defer" | "immediate";
  copiedFromSessionId:  number | null;
  copiedModules:        string | null;
}

function CreateSessionModal({ sessions, onClose, isPending, onSubmit }: CreateModalProps) {

  // ── Section 1: Basic info ────────────────────────────────────────────────
  const [name,      setName]      = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");

  // ── Section 2: Copy previous session ─────────────────────────────────────
  const [copyPrev,     setCopyPrev]     = useState(false);
  const [copiedFromId, setCopiedFromId] = useState<number | null>(null);

  // ── Validation ───────────────────────────────────────────────────────────
  const trimName = name.trim();

  const nameError = useMemo(() => {
    if (!trimName) return "";
    if (sessions.some(s => s.sessionName.trim().toLowerCase() === trimName.toLowerCase()))
      return `Session "${trimName}" already exists`;
    return "";
  }, [trimName, sessions]);

  const dateError = useMemo(() => {
    if (!startDate || !endDate) return "";
    if (new Date(startDate) >= new Date(endDate)) return "Start date must be before end date";
    return "";
  }, [startDate, endDate]);

  const overlapError = useMemo(() => {
    if (!startDate || !endDate || dateError) return "";
    const ns = new Date(startDate), ne = new Date(endDate);
    const ov = sessions.find(s => {
      const es = new Date(s.startDate), ee = new Date(s.endDate);
      return ns <= ee && ne >= es;
    });
    return ov ? `Dates overlap with "${ov.sessionName}"` : "";
  }, [startDate, endDate, dateError, sessions]);

  const isValid =
    trimName.length > 0 &&
    startDate && endDate &&
    !nameError && !dateError && !overlapError;

  // ── Derived helpers ──────────────────────────────────────────────────────
  const prevSessions = [...sessions].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
  );
  const latestPrev = prevSessions[0] ?? null;

  function handleCopyPrevToggle() {
    const next = !copyPrev;
    setCopyPrev(next);
    if (next && !copiedFromId && latestPrev) setCopiedFromId(latestPrev.id);
  }

  function handleSubmit() {
    if (!isValid) return;
    onSubmit({
      sessionName:          trimName,
      startDate,
      endDate,
      status:               "draft",
      setAsActive:          false,
      newAdmissionsEnabled: false,
      promotionStrategy:    "defer",
      copiedFromSessionId:  copyPrev ? copiedFromId : null,
      copiedModules:        null,
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={GLASS.modalOverlay}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl h-[90vh] md:h-auto max-h-[90vh] flex flex-col
                   rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={GLASS.modal}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", boxShadow: "0 0 20px rgba(34,211,238,0.30)" }}>
              <CalendarRange className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base leading-tight">New Academic Session</h3>
              <p className="text-[11px] text-white/40 mt-0.5">Configure the academic year and copy settings</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-all"
            data-testid="button-close-modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-6 space-y-8">

          {/* ── SECTION 1: Session Details ──────────────────────────────── */}
          <div>
            <SectionLabel>1 · Session Details</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

              {/* Session Name — spans 3 cols on md */}
              <div className="md:col-span-3">
                <label className="text-xs font-semibold text-white/60 block mb-2">
                  Session Name <span className="text-red-400">*</span>
                </label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. 2026–2027"
                  className="bg-[#0A1628] border-white/15 text-white placeholder:text-white/20
                             focus:border-cyan-400/50 h-10 text-sm"
                  data-testid="input-session-name"
                />
                {nameError && (
                  <p className="text-xs mt-2 text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />{nameError}
                  </p>
                )}
              </div>

              {/* Start Date */}
              <div className="md:col-span-1">
                <label className="text-xs font-semibold text-white/60 block mb-2">
                  Start Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg text-sm text-white bg-[#0A1628]
                             border border-white/15 focus:outline-none focus:border-cyan-400/50"
                  data-testid="input-session-start"
                />
              </div>

              {/* End Date */}
              <div className="md:col-span-1">
                <label className="text-xs font-semibold text-white/60 block mb-2">
                  End Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg text-sm text-white bg-[#0A1628]
                             border border-white/15 focus:outline-none focus:border-cyan-400/50"
                  data-testid="input-session-end"
                />
              </div>

              {/* Duration preview */}
              <div className="md:col-span-1 flex flex-col justify-end">
                {startDate && endDate && !dateError && !overlapError ? (
                  <div className="h-10 flex items-center px-3 rounded-lg text-xs font-semibold text-emerald-400"
                    style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.20)" }}>
                    {(() => {
                      const days = Math.round(
                        (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
                      );
                      const months = Math.round(days / 30);
                      return `≈ ${months} months (${days} days)`;
                    })()}
                  </div>
                ) : (
                  <div className="h-10 flex items-center px-3 rounded-lg text-xs text-white/25"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    Duration will appear here
                  </div>
                )}
              </div>

              {/* Date / overlap errors */}
              {(dateError || overlapError) && (
                <div className="md:col-span-3">
                  <p className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />{dateError || overlapError}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── SECTION 2: Copy Configuration ──────────────────────────── */}
          <div>
            <SectionLabel>2 · Copy Configuration</SectionLabel>

            {/* Toggle */}
            <label
              className="flex items-start gap-3 cursor-pointer select-none group p-4 rounded-xl transition-all"
              style={{
                background: copyPrev ? "rgba(34,211,238,0.06)" : "rgba(255,255,255,0.03)",
                border:     copyPrev ? "1px solid rgba(34,211,238,0.20)" : "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div
                className="w-4 h-4 rounded mt-0.5 flex items-center justify-center flex-shrink-0 transition-all"
                style={{
                  background: copyPrev ? "#22d3ee" : "rgba(255,255,255,0.06)",
                  border:     copyPrev ? "none" : "1px solid rgba(255,255,255,0.20)",
                }}
                onClick={handleCopyPrevToggle}
                data-testid="toggle-copy-prev"
              >
                {copyPrev && <Check className="w-3 h-3 text-[#0a1628]" />}
              </div>
              <div onClick={handleCopyPrevToggle} className="flex-1">
                <p className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">
                  Copy configuration from previous academic session
                </p>
                <p className="text-xs text-white/35 mt-0.5">
                  Choose exactly which modules carry over. Safe configurations are pre-selected by default.
                </p>
              </div>
            </label>

            {/* Source picker */}
            {copyPrev && (
              <div className="mt-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-white/60 block mb-2">
                    Copy From Session
                  </label>
                  {prevSessions.length === 0 ? (
                    <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs text-white/40 italic"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <Info className="w-3.5 h-3.5 text-white/30" />
                      No previous sessions available — this will be your first session.
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={copiedFromId ?? ""}
                        onChange={e => setCopiedFromId(e.target.value ? Number(e.target.value) : null)}
                        className="w-full h-10 pl-3 pr-8 rounded-lg text-sm text-white bg-[#0A1628]
                                   border border-white/15 focus:outline-none focus:border-cyan-400/50 appearance-none"
                        data-testid="select-copy-source"
                      >
                        <option value="">— Select a session to copy from —</option>
                        {prevSessions.map(s => (
                          <option key={s.id} value={s.id}>{s.sessionName}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
                    </div>
                  )}
                </div>

                {/* Copy Center callout */}
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.18)" }}>
                  <Info className="w-4 h-4 text-cyan-400/70 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-cyan-300/80">
                      You'll be taken to the Configuration Copy Center after creation
                    </p>
                    <p className="text-[10px] text-white/40 mt-1 leading-relaxed">
                      Choose exactly which modules to copy — module by module — with live record counts
                      from the source session. You can come back and copy more modules anytime.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 px-6 py-4 flex-shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>

          {/* Summary pill */}
          {isValid && (
            <div className="hidden sm:flex items-center gap-2 text-[10px] text-white/40 flex-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              {trimName}
              <span className="text-white/20">·</span>
              {fmtDate(startDate)} → {fmtDate(endDate)}
              {copyPrev && copiedFromId && (
                <>
                  <span className="text-white/20">·</span>
                  <span style={{ color: "#22d3ee" }}>Opens Copy Center →</span>
                </>
              )}
            </div>
          )}

          <div className="flex gap-3 sm:ml-auto">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 sm:flex-none sm:px-6 border-white/15 text-white/60 hover:bg-white/5 h-10"
              data-testid="button-modal-cancel"
            >
              Cancel
            </Button>
            <button
              disabled={!isValid || isPending}
              onClick={handleSubmit}
              data-testid="button-modal-save"
              className="flex-1 sm:flex-none sm:px-8 h-10 rounded-lg font-semibold text-sm
                         flex items-center justify-center gap-2
                         disabled:opacity-40 transition-all hover:brightness-110 active:scale-95"
              style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", color: "#fff",
                       boxShadow: isValid ? "0 4px 18px rgba(34,211,238,0.30)" : "none" }}
            >
              {isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                : <><Plus className="w-4 h-4" /> Create Session</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  , document.body);
}

// ── SuccessDialog retained for sessions created via the old flow ───────────────
// (sessions that already have copiedModules from the POST handler copy engine)
function SuccessDialog({ session, onClose, onNavigate }: {
  session: AcademicSession; onClose: () => void; onNavigate: (path: string) => void;
}) {
  const [showLog,    setShowLog]    = useState(false);
  const [showReport, setShowReport] = useState(true);

  // Parse copyResult — prefer the top-level field (present right after creation),
  // fall back to parsing copiedModules JSON (for sessions loaded from the GET list).
  const copyResult = useMemo<SessionCopyResult | null>(() => {
    if (session.copyResult) return session.copyResult;
    if (!session.copiedModules) return null;
    try {
      const parsed = JSON.parse(session.copiedModules);
      if (parsed && typeof parsed === "object" && "approvedModules" in parsed)
        return parsed as SessionCopyResult;
      return null;
    } catch { return null; }
  }, [session.copyResult, session.copiedModules]);

  const executionLog = session.executionLog ?? [];

  const hasCopy     = copyResult !== null;
  const totalNew    = copyResult?.totalRecordsCopied ?? 0;
  const totalShared = copyResult?.sharedSchoolwide.length ?? 0;
  const totalEmpty  = copyResult?.requestedButEmpty.length ?? 0;

  const NEXT_STEPS = [
    { icon: GraduationCap, label: "Promote Students",       desc: "Move students from previous session",       path: "/admin-dashboard/student-registry", color: "#8b5cf6" },
    { icon: UserPlus,      label: "Add New Admissions",     desc: "Register new students for this year",       path: "/admin-dashboard/student-registry", color: "#10b981" },
    { icon: Users,         label: "Update Faculty Mapping", desc: "Assign teachers to classes and subjects",   path: "/admin-dashboard/faculty-mapping",   color: "#6366f1" },
    { icon: LayoutGrid,    label: "Configure Timetable",    desc: "Build the period schedule for this session",path: "/admin-dashboard/timetable",         color: "#3b82f6" },
    { icon: CreditCard,    label: "Review Fee Structure",   desc: "Verify and update fee categories",          path: "/admin-dashboard/fees-manager",      color: "#10b981" },
    { icon: Zap,           label: "Activate Session",       desc: "Set this as the live session",              path: "",                                   color: "#D4AF37" },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={GLASS.modalOverlay}>
      <div className="w-full max-w-xl rounded-2xl overflow-hidden flex flex-col"
        style={{ ...GLASS.modal, maxHeight: "90vh" }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="px-6 pt-7 pb-5 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-start gap-4">
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", boxShadow: "0 0 28px rgba(34,211,238,0.40)" }}>
                <CheckCircle2 className="w-7 h-7 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-400 flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-white text-base">Academic Session Created!</h3>
              <p className="text-sm font-semibold mt-0.5" style={{ color: "#22d3ee" }}>
                {session.sessionName}
              </p>
              <p className="text-xs text-white/40 mt-0.5">
                {fmtDate(session.startDate)} → {fmtDate(session.endDate)}
              </p>
              {/* Summary badges */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {totalNew > 0 && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                    style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }}>
                    <CheckSquare className="w-2.5 h-2.5" />
                    {totalNew} records duplicated
                  </span>
                )}
                {totalShared > 0 && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                    style={{ background: "rgba(34,211,238,0.10)", color: "#67e8f9", border: "1px solid rgba(34,211,238,0.20)" }}>
                    <Copy className="w-2.5 h-2.5" />
                    {totalShared} configs verified
                  </span>
                )}
                {hasCopy && totalNew === 0 && totalShared === 0 && totalEmpty > 0 && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                    style={{ background: "rgba(251,191,36,0.10)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.20)" }}>
                    <AlertTriangle className="w-2.5 h-2.5" />
                    Source not yet configured
                  </span>
                )}
                {!hasCopy && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.40)", border: "1px solid rgba(255,255,255,0.10)" }}>
                    Fresh session
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* Copy Report section */}
          {hasCopy && (
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <button
                onClick={() => setShowReport(v => !v)}
                className="w-full flex items-center justify-between px-5 py-3 text-left"
                style={{ background: "rgba(34,211,238,0.03)" }}
                data-testid="toggle-copy-report"
              >
                <div className="flex items-center gap-2">
                  <Copy className="w-3.5 h-3.5 text-cyan-400/70" />
                  <span className="text-[10px] font-bold tracking-widest uppercase text-cyan-400/70">
                    Copy Report
                  </span>
                  <span className="text-[9px] text-white/25">
                    ({copyResult!.approvedModules.length} modules processed)
                  </span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-white/30 transition-transform ${showReport ? "" : "-rotate-90"}`} />
              </button>

              {showReport && (
                <div className="px-5 pb-4 space-y-4">

                  {/* Source info */}
                  <div className="flex items-center gap-2 text-[10px] text-white/30 pt-1">
                    <span>Copied from:</span>
                    <span className="font-semibold text-white/50">{copyResult!.sourceSessionName}</span>
                    <span className="text-white/20">·</span>
                    <span>{new Date(copyResult!.timestamp).toLocaleTimeString()}</span>
                  </div>

                  {/* Physically Copied */}
                  {copyResult!.copied.length > 0 && (
                    <div className="rounded-xl p-3 space-y-2"
                      style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}>
                      <div className="flex items-center gap-2">
                        <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-xs font-bold text-emerald-400">Physically Duplicated</span>
                        <span className="text-[10px] text-emerald-400/60">
                          {copyResult!.totalRecordsCopied} new records created
                        </span>
                      </div>
                      <div className="space-y-1.5 pl-1">
                        {copyResult!.copied.map(e => (
                          <div key={e.module} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] font-semibold shrink-0"
                                style={{ color: "rgba(52,211,153,0.60)" }}>
                                {e.parentModule}
                              </span>
                              <span className="text-white/25 text-[10px] shrink-0">›</span>
                              <span className="text-xs text-white/80 font-semibold truncate">{e.label}</span>
                            </div>
                            <span className="text-[10px] font-bold text-emerald-400 shrink-0 px-2 py-0.5 rounded-full"
                              style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.20)" }}>
                              {e.count} records
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Shared Schoolwide */}
                  {copyResult!.sharedSchoolwide.length > 0 && (
                    <div className="rounded-xl p-3 space-y-2"
                      style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.15)" }}>
                      <div className="flex items-center gap-2">
                        <Copy className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-xs font-bold text-cyan-400">Shared School-Wide Configs</span>
                        <span className="text-[10px] text-cyan-400/50">available to all sessions</span>
                      </div>
                      <div className="space-y-1.5 pl-1">
                        {copyResult!.sharedSchoolwide.map(e => (
                          <div key={e.module} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] font-semibold shrink-0"
                                style={{ color: "rgba(34,211,238,0.55)" }}>
                                {e.parentModule}
                              </span>
                              <span className="text-white/25 text-[10px] shrink-0">›</span>
                              <span className="text-xs text-white/75 truncate">{e.label}</span>
                            </div>
                            <span className="text-[10px] text-cyan-400/60 shrink-0 px-2 py-0.5 rounded-full font-medium"
                              style={{ background: "rgba(34,211,238,0.07)", border: "1px solid rgba(34,211,238,0.12)" }}>
                              {e.count > 0 ? `${e.count} items` : "✓"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Requested but Empty */}
                  {copyResult!.requestedButEmpty.length > 0 && (
                    <div className="rounded-xl p-3 space-y-2"
                      style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.15)" }}>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-xs font-bold text-amber-400">Requested but Not Configured</span>
                      </div>
                      <p className="text-[10px] text-white/35 pl-1">
                        Selected for copying but no source data existed. Configure these after activation.
                      </p>
                      <div className="space-y-1 pl-1">
                        {copyResult!.requestedButEmpty.map(e => (
                          <div key={e.module} className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold shrink-0"
                              style={{ color: "rgba(251,191,36,0.55)" }}>
                              {e.parentModule}
                            </span>
                            <span className="text-white/25 text-[10px] shrink-0">›</span>
                            <span className="text-xs text-amber-300/70">{e.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Clean Slate */}
                  {copyResult!.cleanSlate.length > 0 && (
                    <div className="rounded-xl p-3 space-y-2"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <div className="flex items-center gap-2">
                        <Info className="w-3.5 h-3.5 text-white/35" />
                        <span className="text-xs font-bold text-white/35">Category C — Always Start Fresh</span>
                      </div>
                      <p className="text-[10px] text-white/22 pl-1">
                        These modules are never copied — they begin empty every session by design.
                      </p>
                      <div className="space-y-1 pl-1">
                        {copyResult!.cleanSlate.map(id => {
                          const mod = COPY_MODULE_TREE.find(m => m.id === id);
                          return (
                            <div key={id} className="flex items-center gap-1.5">
                              {mod && <span className="text-[10px]">{mod.emoji}</span>}
                              <span className="text-[10px] text-white/35 font-semibold">
                                {mod?.label ?? id}
                              </span>
                              <span className="text-[9px] text-white/18 font-mono">({id})</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {/* Execution Log section */}
          {executionLog.length > 0 && (
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <button
                onClick={() => setShowLog(v => !v)}
                className="w-full flex items-center justify-between px-5 py-3 text-left"
                style={{ background: "rgba(99,102,241,0.03)" }}
                data-testid="toggle-execution-log"
              >
                <div className="flex items-center gap-2">
                  <Info className="w-3.5 h-3.5 text-indigo-400/70" />
                  <span className="text-[10px] font-bold tracking-widest uppercase text-indigo-400/70">
                    Execution Log
                  </span>
                  <span className="text-[9px] text-white/25">({executionLog.length} steps)</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-white/30 transition-transform ${showLog ? "" : "-rotate-90"}`} />
              </button>

              {showLog && (
                <div className="px-5 pb-4">
                  <div className="rounded-xl p-3 space-y-1"
                    style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    {executionLog.map((line, i) => {
                      const isOk    = line.includes("✓");
                      const isWarn  = line.includes("⚠");
                      const isSkip  = line.includes("SKIP") || line.includes("skipped");
                      const isArrow = line.startsWith("STEP") || line.startsWith("  [");
                      return (
                        <p key={i}
                          className="text-[10px] font-mono leading-relaxed"
                          style={{
                            color: isOk   ? "#34d399"
                                 : isWarn ? "#fbbf24"
                                 : isSkip ? "rgba(255,255,255,0.30)"
                                 : isArrow ? "rgba(255,255,255,0.55)"
                                 : "rgba(255,255,255,0.35)",
                          }}>
                          {line}
                        </p>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Next Steps */}
          <div className="p-4">
            <p className="text-[10px] font-bold tracking-widest uppercase text-indigo-400/70 mb-2 px-1">
              Recommended Next Steps
            </p>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-hide mb-3">
              {["Promote", "Admissions", "Faculty", "Timetable", "Fees", "Activate"].map((step, i, arr) => (
                <div key={step} className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[9px] font-bold text-white/40 px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    {step}
                  </span>
                  {i < arr.length - 1 && <ArrowRight className="w-2.5 h-2.5 text-white/20 shrink-0" />}
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              {NEXT_STEPS.map(({ icon: Icon, label, desc, path, color }) => (
                <button
                  key={label}
                  onClick={() => { if (path) onNavigate(path); else onClose(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all hover:scale-[1.01] group"
                  style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}
                  data-testid={`success-action-${label.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all group-hover:scale-110"
                    style={{ background: `${color}18` }}>
                    <Icon className="w-3.5 h-3.5" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white/80 group-hover:text-white transition-colors leading-tight">{label}</p>
                    <p className="text-[10px] text-white/30 mt-0.5 truncate">{desc}</p>
                  </div>
                  <ArrowRight className="w-3 h-3 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-5 pb-5 pt-3 flex-shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <Button
            variant="outline"
            onClick={onClose}
            className="w-full border-white/15 text-white/60 hover:bg-white/5 h-10"
            data-testid="button-success-close"
          >
            Done — I'll set it up later
          </Button>
        </div>
      </div>
    </div>
  , document.body);
}

// ══════════════════════════════════════════════════════════════════════════════
// ROLLOVER MODAL — type "ROLLOVER" to confirm session activation
// ══════════════════════════════════════════════════════════════════════════════
interface RolloverModalProps {
  session:   AcademicSession;
  onClose:   () => void;
  onConfirm: () => void;
  isPending: boolean;
}
function RolloverModal({ session, onClose, onConfirm, isPending }: RolloverModalProps) {
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim() === "ROLLOVER";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={GLASS.modalOverlay} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-6 space-y-5"
        style={{ ...GLASS.modal, border: "1px solid rgba(239,68,68,0.35)" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: "rgba(239,68,68,0.15)" }}>
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-bold text-white">Session Rollover Warning</h3>
            <p className="text-xs text-white/50 mt-1">
              Activating <span className="font-semibold text-cyan-300">"{session.sessionName}"</span> will
              immediately shift the <strong className="text-white">live tracking roster</strong> for all
              teachers and students to this session.
            </p>
          </div>
        </div>
        <div className="rounded-xl p-3 space-y-1.5 text-xs"
          style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.20)" }}>
          {[
            "The currently active session will be automatically archived.",
            "New student registrations will be enrolled in this session.",
            "Existing data from the previous session is retained and unaffected.",
          ].map(line => (
            <p key={line} className="flex items-start gap-2 text-white/65">
              <span className="text-red-400 mt-0.5 shrink-0">›</span> {line}
            </p>
          ))}
        </div>
        <div>
          <label className="text-xs font-semibold text-white/60 block mb-1.5">
            Type <span className="font-mono text-red-400 font-bold">ROLLOVER</span> to confirm
          </label>
          <Input
            value={typed} onChange={e => setTyped(e.target.value)}
            placeholder="ROLLOVER"
            className="bg-[#0A1628] border-red-500/30 text-white placeholder:text-white/20 font-mono tracking-widest focus:border-red-400/60"
            data-testid="input-rollover-confirm"
          />
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose}
            className="flex-1 border-white/15 text-white/60 hover:bg-white/5"
            data-testid="button-rollover-cancel">Cancel</Button>
          <button disabled={!confirmed || isPending} onClick={onConfirm}
            data-testid="button-rollover-proceed"
            className="flex-1 h-9 rounded-lg font-semibold text-sm flex items-center justify-center gap-2
              disabled:opacity-40 transition-all hover:brightness-110 active:scale-95"
            style={{
              background: confirmed ? "linear-gradient(135deg,#dc2626,#ef4444)" : "rgba(239,68,68,0.20)",
              color: "#fff", border: "1px solid rgba(239,68,68,0.50)",
            }}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Activate Session
          </button>
        </div>
      </div>
    </div>
  , document.body);
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE MODAL
// ══════════════════════════════════════════════════════════════════════════════
interface DeleteModalProps {
  session:   AcademicSession;
  onClose:   () => void;
  onConfirm: () => void;
  isPending: boolean;
}
function DeleteModal({ session, onClose, onConfirm, isPending }: DeleteModalProps) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={GLASS.modalOverlay} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl p-6 space-y-4"
        style={{ ...GLASS.modal, border: "1px solid rgba(239,68,68,0.25)" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(239,68,68,0.12)" }}>
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h3 className="font-bold text-white">Delete Session</h3>
            <p className="text-xs text-white/50">
              "{session.sessionName}" and all its enrollment records will be permanently removed.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <Button variant="outline" onClick={onClose}
            className="flex-1 border-white/15 text-white/60"
            data-testid="button-delete-cancel">Cancel</Button>
          <button disabled={isPending} onClick={onConfirm}
            data-testid="button-delete-confirm"
            className="flex-1 h-9 rounded-lg font-semibold text-sm text-white flex items-center justify-center gap-2
              disabled:opacity-50 hover:brightness-110 active:scale-95 transition-all"
            style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)" }}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  , document.body);
}

// ══════════════════════════════════════════════════════════════════════════════
// EMPTY STATE
// ══════════════════════════════════════════════════════════════════════════════
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-4">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(34,211,238,0.08)" }}>
        <CalendarRange className="w-7 h-7 text-cyan-400/50" />
      </div>
      <div className="text-center">
        <p className="font-semibold text-white/70">No academic sessions yet</p>
        <p className="text-xs mt-1 text-white/40">
          Create your first session to start tracking enrollments by year.
        </p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function AcademicSessions({ schoolId }: Props) {
  const { toast }       = useToast();
  const [, setLocation] = useLocation();

  const [showCreate,     setShowCreate]     = useState(false);
  const [rolloverTarget, setRolloverTarget] = useState<AcademicSession | null>(null);
  const [deleteTarget,   setDeleteTarget]   = useState<AcademicSession | null>(null);

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: sessions = [], isLoading } = useQuery<AcademicSession[]>({
    queryKey: ["/api/admin/academic-sessions"],
    queryFn: async () => {
      const r = await fetch("/api/admin/academic-sessions", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load sessions");
      return r.json();
    },
  });

  // ── Create mutation ───────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: async (payload: CreatePayload) => {
      const r = await apiRequest("POST", "/api/admin/academic-sessions", payload);
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.message || "Failed to create session");
      }
      return r.json() as Promise<AcademicSession>;
    },
    onSuccess: (session) => {
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-sessions"] });
      if (session.copiedFromSessionId) {
        toast({ title: "Session created", description: `"${session.sessionName}" created. Opening Copy Center…` });
        setLocation(`/session-copy-center/${session.id}`);
      } else {
        toast({ title: "Session created", description: `"${session.sessionName}" is ready as a fresh session.` });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Activate mutation ─────────────────────────────────────────────────────
  const activateMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("PATCH", `/api/admin/academic-sessions/${id}/activate`, {});
      if (!r.ok) { const err = await r.json(); throw new Error(err.message || "Failed to activate"); }
      return r.json();
    },
    onSuccess: () => {
      setRolloverTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-sessions"] });
      toast({ title: "Session activated", description: "Roster rolled over to the new session." });
    },
    onError: (e: Error) => toast({ title: "Activation failed", description: e.message, variant: "destructive" }),
  });

  // ── Delete mutation ───────────────────────────────────────────────────────
  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("DELETE", `/api/admin/academic-sessions/${id}`, undefined);
      if (!r.ok) { const err = await r.json(); throw new Error(err.message || "Failed to delete"); }
    },
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-sessions"] });
      toast({ title: "Session deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Section header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-bold text-white text-lg tracking-tight">Academic Sessions</h3>
          <p className="text-xs mt-0.5 text-white/50">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} · Only one may be active at a time
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          data-testid="button-add-session"
          className="flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-semibold text-white
            transition-all hover:brightness-110 active:scale-95"
          style={{
            background: "linear-gradient(135deg,#22d3ee,#6366f1)",
            boxShadow:  "0 4px 16px rgba(34,211,238,0.25)",
          }}
        >
          <Plus className="w-4 h-4" /> New Session
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400/50" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && sessions.length === 0 && <EmptyState />}

      {/* Session cards */}
      {!isLoading && sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map(session => {
            const isActive = session.isActive;

            // Count modules in copy result (handles both old string[] and new SessionCopyResult format)
            let copiedCount = 0;
            if (session.copiedModules) {
              try {
                const parsed = JSON.parse(session.copiedModules);
                if (Array.isArray(parsed)) {
                  copiedCount = parsed.length; // legacy format
                } else if (parsed && typeof parsed === "object" && "approvedModules" in parsed) {
                  copiedCount = (parsed as SessionCopyResult).approvedModules?.length ?? 0;
                }
              } catch { /* noop */ }
            }

            return (
              <div
                key={session.id}
                className="rounded-xl p-4 flex items-center gap-4 transition-all duration-200 hover:scale-[1.01]"
                style={isActive ? GLASS.activeCard : GLASS.card}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.18)";
                    (e.currentTarget as HTMLDivElement).style.background  = "rgba(255,255,255,0.06)";
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)";
                    (e.currentTarget as HTMLDivElement).style.background  = "rgba(255,255,255,0.04)";
                  }
                }}
                data-testid={`session-card-${session.id}`}
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: isActive ? "linear-gradient(135deg,#22d3ee,#6366f1)" : "rgba(255,255,255,0.06)",
                    boxShadow:  isActive ? "0 0 14px rgba(34,211,238,0.30)" : "none",
                  }}>
                  {isActive
                    ? <CheckCircle2 className="w-5 h-5 text-white" />
                    : <Clock className="w-5 h-5 text-white/35" />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-white text-sm">{session.sessionName}</p>
                    {isActive ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide"
                        style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.30)" }}>
                        ● ACTIVE
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize"
                        style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.40)", border: "1px solid rgba(255,255,255,0.10)" }}>
                        {session.status ?? "archived"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 text-white/50">
                    {fmtDate(session.startDate)} → {fmtDate(session.endDate)}
                  </p>
                  {copiedCount > 0 && (
                    <p className="text-[10px] mt-0.5 text-white/30 flex items-center gap-1">
                      <Copy className="w-2.5 h-2.5" />
                      {copiedCount} modules copied from session #{session.copiedFromSessionId}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {}}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-white/25
                      hover:text-white/60 transition-colors"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    title="Session settings"
                    data-testid={`button-settings-${session.id}`}
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>

                  {!isActive && (
                    <button
                      onClick={() => setRolloverTarget(session)}
                      data-testid={`button-activate-${session.id}`}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-cyan-300
                        transition-all hover:brightness-110 active:scale-95"
                      style={{ background: "rgba(34,211,238,0.10)", border: "1px solid rgba(34,211,238,0.25)" }}
                    >
                      <Zap className="w-3.5 h-3.5" /> Activate
                    </button>
                  )}

                  {isActive ? (
                    <span className="text-[10px] text-white/20 px-2" title="Cannot delete the active session">
                      Protected
                    </span>
                  ) : (
                    <button
                      onClick={() => setDeleteTarget(session)}
                      data-testid={`button-delete-${session.id}`}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400/50
                        hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {showCreate && (
        <CreateSessionModal
          sessions={sessions}
          onClose={() => setShowCreate(false)}
          isPending={createMut.isPending}
          onSubmit={payload => createMut.mutate(payload)}
        />
      )}
      {rolloverTarget && (
        <RolloverModal
          session={rolloverTarget}
          onClose={() => setRolloverTarget(null)}
          onConfirm={() => activateMut.mutate(rolloverTarget.id)}
          isPending={activateMut.isPending}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          session={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMut.mutate(deleteTarget.id)}
          isPending={deleteMut.isPending}
        />
      )}
    </>
  );
}
