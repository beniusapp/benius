/**
 * AcademicSessions — enhanced tenant-scoped academic year management.
 *
 * Rules enforced:
 *  • Only ONE session per school may be active at any time.
 *  • Activation requires typing "ROLLOVER" in a safety confirmation modal.
 *  • Deleting an active session is blocked in the UI.
 *  • All API calls carry implicit tenant scope via the admin session cookie.
 *  • Session names must be unique; dates must not overlap; start < end.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  CalendarRange, Plus, Trash2, Zap, CheckCircle2, Clock, Loader2,
  AlertTriangle, X, ChevronDown, ChevronRight, Check, Copy,
  Users, UserPlus, BookOpen, LayoutGrid, ArrowRight, Shield,
  ToggleLeft, ToggleRight, GraduationCap, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fmtDate } from "@/lib/dateUtils";

// ── Types ──────────────────────────────────────────────────────────────────────
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
  copiedModules: string | null;
  createdAt: string | null;
}

interface Props { schoolId: number }

// ── Module tree definition ─────────────────────────────────────────────────────
// Each parent has sub-modules. This structure can be fetched from the DB in
// future — for now it is declared statically so every school gets the same set.
interface SubModule { id: string; label: string }
interface Module    { id: string; label: string; subModules: SubModule[] }

const MODULE_TREE: Module[] = [
  {
    id: "classes-sections", label: "Classes & Sections",
    subModules: [
      { id: "classes-list",          label: "Classes Configuration" },
      { id: "sections-list",         label: "Sections Configuration" },
      { id: "class-section-mapping", label: "Class–Section Mapping" },
    ],
  },
  {
    id: "subject-management", label: "Subject Management",
    subModules: [
      { id: "subjects-list",         label: "Subject List" },
      { id: "class-subject-mapping", label: "Class–Subject Mapping" },
      { id: "exam-types",            label: "Exam Types Configuration" },
    ],
  },
  {
    id: "faculty-mapping", label: "Faculty Mapping",
    subModules: [
      { id: "teacher-class-assign",  label: "Teacher–Class Assignments" },
      { id: "subject-teacher-map",   label: "Subject–Teacher Mapping" },
    ],
  },
  {
    id: "teacher-assignments", label: "Teacher Assignments",
    subModules: [
      { id: "class-teacher",         label: "Class Teacher Assignment" },
      { id: "subject-teacher-rec",   label: "Subject Teacher Records" },
    ],
  },
  {
    id: "timetable", label: "Timetable",
    subModules: [
      { id: "bell-structure",        label: "Bell Structure" },
      { id: "schedule-grid",         label: "Schedule Grid" },
    ],
  },
  {
    id: "academic-calendar", label: "Academic Calendar",
    subModules: [
      { id: "calendar-events",       label: "Events & Programmes" },
      { id: "holiday-calendar",      label: "Holiday Calendar" },
    ],
  },
  {
    id: "fee-structure", label: "Fee Structure",
    subModules: [
      { id: "fee-categories",        label: "Fee Categories" },
      { id: "fee-assignments",       label: "Class-Wise Fee Assignments" },
      { id: "concessions",           label: "Concessions & Waivers" },
    ],
  },
  {
    id: "exam-grade-config", label: "Exam & Grade Configuration",
    subModules: [
      { id: "exam-policy-tiers",     label: "Exam Policy Tiers" },
      { id: "grade-bands",           label: "Grade Bands" },
      { id: "promotion-rules",       label: "Promotion Rules" },
    ],
  },
  {
    id: "attendance-config", label: "Attendance Configuration",
    subModules: [
      { id: "working-days",          label: "Working Days" },
      { id: "attendance-rules",      label: "Attendance Marking Rules" },
    ],
  },
  {
    id: "house-management", label: "House Management",
    subModules: [
      { id: "houses-list",           label: "House List" },
      { id: "house-captains",        label: "House Captains" },
    ],
  },
  {
    id: "clubs-activities", label: "Clubs & Activities",
    subModules: [
      { id: "clubs-list",            label: "Club Registrations" },
      { id: "activity-schedule",     label: "Activity Schedule" },
    ],
  },
  {
    id: "transport-config", label: "Transport Configuration",
    subModules: [
      { id: "transport-routes",      label: "Transport Routes" },
      { id: "vehicle-assignments",   label: "Vehicle Assignments" },
    ],
  },
  {
    id: "hostel-config", label: "Hostel Configuration",
    subModules: [
      { id: "hostel-rooms",          label: "Hostel Rooms & Blocks" },
      { id: "hostel-assignments",    label: "Student Hostel Assignments" },
    ],
  },
  {
    id: "library-config", label: "Library Configuration",
    subModules: [
      { id: "book-catalog",          label: "Book Catalog" },
      { id: "borrowing-rules",       label: "Borrowing Rules" },
    ],
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
    background: "rgba(0,0,0,0.80)",
    backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
  } as React.CSSProperties,
  modal: {
    background: "rgba(10,18,36,0.98)",
    backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
    border: "1px solid rgba(255,255,255,0.12)",
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

// ══════════════════════════════════════════════════════════════════════════════
// MODULE PERMISSION SELECTOR — reusable tree with parent/child checkboxes
// ══════════════════════════════════════════════════════════════════════════════
interface ModulePermissionSelectorProps {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function ModulePermissionSelector({ selected, onChange }: ModulePermissionSelectorProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(MODULE_TREE.map(m => m.id)));

  const allSubIds = useMemo(() => MODULE_TREE.flatMap(m => m.subModules.map(s => s.id)), []);

  const allSelected  = allSubIds.every(id => selected.has(id));
  const someSelected = !allSelected && allSubIds.some(id => selected.has(id));

  function toggleAll() {
    if (allSelected) onChange(new Set());
    else             onChange(new Set(allSubIds));
  }

  function toggleModule(mod: Module) {
    const childIds = mod.subModules.map(s => s.id);
    const allChildOn = childIds.every(id => selected.has(id));
    const next = new Set(selected);
    if (allChildOn) childIds.forEach(id => next.delete(id));
    else            childIds.forEach(id => next.add(id));
    onChange(next);
  }

  function toggleSub(sub: SubModule) {
    const next = new Set(selected);
    if (next.has(sub.id)) next.delete(sub.id);
    else                  next.add(sub.id);
    onChange(next);
  }

  function toggleExpand(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else              next.add(id);
    setExpanded(next);
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
      {/* Select All row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        style={{ background: "rgba(34,211,238,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        onClick={toggleAll}
        data-testid="module-select-all"
      >
        <div
          className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
          style={{
            background:  allSelected ? "#22d3ee" : someSelected ? "rgba(34,211,238,0.35)" : "rgba(255,255,255,0.08)",
            border:      allSelected ? "none"    : "1px solid rgba(255,255,255,0.20)",
          }}
        >
          {allSelected  && <Check  className="w-3 h-3 text-[#0a1628]" />}
          {someSelected && <span className="w-2 h-0.5 rounded-full bg-cyan-300 block" />}
        </div>
        <span className="text-sm font-bold text-white">Select All</span>
        <span className="ml-auto text-xs text-white/40">
          {selected.size} / {allSubIds.length} sub-modules
        </span>
      </div>

      {/* Module rows */}
      {MODULE_TREE.map(mod => {
        const childIds    = mod.subModules.map(s => s.id);
        const allChildOn  = childIds.every(id => selected.has(id));
        const someChildOn = !allChildOn && childIds.some(id => selected.has(id));
        const isExpanded  = expanded.has(mod.id);

        return (
          <div key={mod.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {/* Parent row */}
            <div className="flex items-center gap-3 px-4 py-2.5 select-none"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              {/* Checkbox */}
              <div
                className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 cursor-pointer"
                style={{
                  background: allChildOn ? "#22d3ee" : someChildOn ? "rgba(34,211,238,0.25)" : "rgba(255,255,255,0.06)",
                  border:     allChildOn ? "none"     : "1px solid rgba(255,255,255,0.18)",
                }}
                onClick={() => toggleModule(mod)}
                data-testid={`module-check-${mod.id}`}
              >
                {allChildOn  && <Check className="w-3 h-3 text-[#0a1628]" />}
                {someChildOn && <span className="w-2 h-0.5 rounded-full bg-cyan-400 block" />}
              </div>

              {/* Label */}
              <span
                className="flex-1 text-sm font-semibold cursor-pointer"
                style={{ color: (allChildOn || someChildOn) ? "#e2e8f0" : "rgba(255,255,255,0.55)" }}
                onClick={() => toggleModule(mod)}
              >
                {mod.label}
              </span>

              {/* Sub-count */}
              <span className="text-[10px] text-white/30 mr-2">
                {childIds.filter(id => selected.has(id)).length}/{childIds.length}
              </span>

              {/* Expand/collapse */}
              <button
                type="button"
                onClick={() => toggleExpand(mod.id)}
                className="text-white/30 hover:text-white/70 transition-colors"
                data-testid={`module-expand-${mod.id}`}
              >
                {isExpanded
                  ? <ChevronDown    className="w-3.5 h-3.5" />
                  : <ChevronRight   className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Sub-module rows */}
            {isExpanded && (
              <div style={{ background: "rgba(0,0,0,0.25)" }}>
                {mod.subModules.map(sub => (
                  <div
                    key={sub.id}
                    className="flex items-center gap-3 pl-10 pr-4 py-2 cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
                    onClick={() => toggleSub(sub)}
                    data-testid={`submodule-check-${sub.id}`}
                  >
                    <div
                      className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
                      style={{
                        background: selected.has(sub.id) ? "#22d3ee" : "rgba(255,255,255,0.06)",
                        border:     selected.has(sub.id) ? "none"     : "1px solid rgba(255,255,255,0.18)",
                      }}
                    >
                      {selected.has(sub.id) && <Check className="w-2.5 h-2.5 text-[#0a1628]" />}
                    </div>
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
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CREATE SESSION MODAL — enhanced with all 4 workflow sections
// ══════════════════════════════════════════════════════════════════════════════
interface CreateModalProps {
  sessions:  AcademicSession[];
  onClose:   () => void;
  onCreated: (s: AcademicSession) => void;
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
  const [name,        setName]        = useState("");
  const [startDate,   setStartDate]   = useState("");
  const [endDate,     setEndDate]     = useState("");
  const [status,      setStatus]      = useState<"draft" | "active">("draft");
  const [setAsActive, setSetAsActive] = useState(false);

  // ── Section 2: Copy previous session ─────────────────────────────────────
  const [copyPrev,          setCopyPrev]          = useState(false);
  const [copiedFromId,      setCopiedFromId]      = useState<number | null>(null);
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<string>>(new Set());

  // ── Section 3: Student promotion ─────────────────────────────────────────
  const [promoStrategy, setPromoStrategy] = useState<"defer" | "immediate">("defer");

  // ── Section 4: New admissions ─────────────────────────────────────────────
  const [newAdmissions, setNewAdmissions] = useState(false);

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

  const activeSession  = sessions.find(s => s.isActive);
  const hasActiveConflict = setAsActive && !!activeSession;

  const isValid =
    trimName.length > 0 &&
    startDate && endDate &&
    !nameError && !dateError && !overlapError;

  function handleSubmit() {
    if (!isValid) return;
    onSubmit({
      sessionName:          trimName,
      startDate,
      endDate,
      status:               setAsActive ? "active" : status,
      setAsActive,
      newAdmissionsEnabled: newAdmissions,
      promotionStrategy:    promoStrategy,
      copiedFromSessionId:  copyPrev ? copiedFromId : null,
      copiedModules:        copyPrev && selectedModuleIds.size > 0
                              ? JSON.stringify([...selectedModuleIds])
                              : null,
    });
  }

  // ── Derived helpers ──────────────────────────────────────────────────────
  const prevSessions = sessions.filter(s => !s.isActive);
  const latestPrev   = prevSessions[0] ?? null;

  function handleCopyPrevToggle() {
    const next = !copyPrev;
    setCopyPrev(next);
    if (next && !copiedFromId && latestPrev) setCopiedFromId(latestPrev.id);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-center sm:p-4"
      style={GLASS.modalOverlay}
      onClick={onClose}
    >
      <div
        className="flex-1 sm:flex-none w-full sm:max-w-xl sm:rounded-2xl sm:max-h-[92dvh] flex flex-col overflow-hidden"
        style={GLASS.modal}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)" }}>
              <CalendarRange className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white leading-tight">New Academic Session</h3>
              <p className="text-[11px] text-white/40">Configure the full year workflow</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7 min-h-0">

          {/* ── SECTION 1: Basic Information ──────────────────────────── */}
          <div>
            <SectionLabel>1 · Basic Information</SectionLabel>
            <div className="space-y-4">

              {/* Session Name */}
              <div>
                <label className="text-xs font-semibold text-white/60 block mb-1.5">
                  Session Name <span className="text-red-400">*</span>
                </label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. 2026–2027"
                  className="bg-[#0A1628] border-white/15 text-white placeholder:text-white/20 focus:border-cyan-400/50"
                  data-testid="input-session-name"
                />
                {nameError && (
                  <p className="text-xs mt-1.5 text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />{nameError}
                  </p>
                )}
              </div>

              {/* Start + End Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-white/60 block mb-1.5">
                    Start Date <span className="text-red-400">*</span>
                  </label>
                  <input type="date" value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full h-9 px-3 rounded-md text-sm text-white bg-[#0A1628] border border-white/15 focus:outline-none focus:border-cyan-400/50"
                    data-testid="input-session-start" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-white/60 block mb-1.5">
                    End Date <span className="text-red-400">*</span>
                  </label>
                  <input type="date" value={endDate} min={startDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full h-9 px-3 rounded-md text-sm text-white bg-[#0A1628] border border-white/15 focus:outline-none focus:border-cyan-400/50"
                    data-testid="input-session-end" />
                </div>
              </div>
              {(dateError || overlapError) && (
                <p className="text-xs text-red-400 flex items-center gap-1 -mt-2">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />{dateError || overlapError}
                </p>
              )}

              {/* Status radio + Set-as-Active toggle */}
              <div className="grid grid-cols-2 gap-3">
                {/* Status */}
                <div>
                  <label className="text-xs font-semibold text-white/60 block mb-2">Status</label>
                  <div className="flex gap-2">
                    {(["draft", "active"] as const).map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { setStatus(s); if (s === "active") setSetAsActive(true); }}
                        className="flex-1 h-8 rounded-lg text-xs font-semibold capitalize transition-all"
                        style={{
                          background: status === s
                            ? s === "active" ? "rgba(34,211,238,0.20)" : "rgba(255,255,255,0.10)"
                            : "rgba(255,255,255,0.04)",
                          border: status === s
                            ? s === "active" ? "1px solid rgba(34,211,238,0.50)" : "1px solid rgba(255,255,255,0.25)"
                            : "1px solid rgba(255,255,255,0.08)",
                          color: status === s ? (s === "active" ? "#22d3ee" : "#fff") : "rgba(255,255,255,0.35)",
                        }}
                        data-testid={`status-${s}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Set as Active toggle */}
                <div>
                  <label className="text-xs font-semibold text-white/60 block mb-2">Set as Active Session</label>
                  <div className="flex items-center gap-2 h-8">
                    <ToggleSwitch
                      on={setAsActive}
                      onChange={() => {
                        const next = !setAsActive;
                        setSetAsActive(next);
                        if (next) setStatus("active");
                      }}
                    />
                    <span className="text-xs" style={{ color: setAsActive ? "#22d3ee" : "rgba(255,255,255,0.30)" }}>
                      {setAsActive ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Active conflict warning */}
              {hasActiveConflict && activeSession && (
                <div className="flex items-start gap-2 p-3 rounded-xl text-xs"
                  style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#fbbf24" }}>
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>"{activeSession.sessionName}"</strong> is currently active.
                    Creating this session as active will archive it and rollover all rosters.
                    A "ROLLOVER" confirmation will be required.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── SECTION 2: Copy Previous Session ─────────────────────── */}
          <div>
            <SectionLabel>2 · Copy Previous Session</SectionLabel>

            {/* Toggle checkbox */}
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <div
                className="w-4 h-4 rounded mt-0.5 flex items-center justify-center flex-shrink-0 transition-all"
                style={{
                  background: copyPrev ? "#22d3ee" : "rgba(255,255,255,0.06)",
                  border:     copyPrev ? "none"    : "1px solid rgba(255,255,255,0.20)",
                }}
                onClick={handleCopyPrevToggle}
                data-testid="toggle-copy-prev"
              >
                {copyPrev && <Check className="w-3 h-3 text-[#0a1628]" />}
              </div>
              <div onClick={handleCopyPrevToggle}>
                <p className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">
                  Copy configuration from previous academic session
                </p>
                <p className="text-xs text-white/35 mt-0.5">
                  Choose exactly which modules should carry over into the new year.
                </p>
              </div>
            </label>

            {/* Source session picker + module selector */}
            {copyPrev && (
              <div className="mt-4 space-y-4 pl-7">
                {/* Source selector */}
                <div>
                  <label className="text-xs font-semibold text-white/60 block mb-1.5">
                    Copy From Session
                  </label>
                  {prevSessions.length === 0 ? (
                    <p className="text-xs text-white/35 italic">No previous sessions available.</p>
                  ) : (
                    <div className="relative">
                      <select
                        value={copiedFromId ?? ""}
                        onChange={e => setCopiedFromId(e.target.value ? Number(e.target.value) : null)}
                        className="w-full h-9 pl-3 pr-8 rounded-lg text-sm text-white bg-[#0A1628] border border-white/15 focus:outline-none focus:border-cyan-400/50 appearance-none"
                        data-testid="select-copy-source"
                      >
                        <option value="">— Select a session —</option>
                        {prevSessions.map(s => (
                          <option key={s.id} value={s.id}>{s.sessionName}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
                    </div>
                  )}
                </div>

                {/* Module permission selector */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-white/60">
                      Select Modules to Copy
                    </label>
                    <span className="text-[10px] text-white/30">
                      {selectedModuleIds.size} sub-modules selected
                    </span>
                  </div>
                  <ModulePermissionSelector
                    selected={selectedModuleIds}
                    onChange={setSelectedModuleIds}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── SECTION 3: Student Promotion ──────────────────────────── */}
          <div>
            <SectionLabel>3 · Student Promotion</SectionLabel>
            <div className="space-y-2.5">
              {([
                {
                  value: "defer",
                  label: "Promote students later",
                  desc:  "Students remain in their current class. Run promotions manually after the session is set up.",
                },
                {
                  value: "immediate",
                  label: "Promote students immediately",
                  desc:  "Trigger the promotion workflow right after session creation. Confirmation required.",
                },
              ] as const).map(opt => (
                <label
                  key={opt.value}
                  className="flex items-start gap-3 p-3.5 rounded-xl cursor-pointer transition-all"
                  style={{
                    background: promoStrategy === opt.value ? "rgba(34,211,238,0.07)" : "rgba(255,255,255,0.03)",
                    border:     promoStrategy === opt.value ? "1px solid rgba(34,211,238,0.25)" : "1px solid rgba(255,255,255,0.07)",
                  }}
                  data-testid={`promo-${opt.value}`}
                >
                  <div
                    className="w-4 h-4 rounded-full mt-0.5 flex-shrink-0 flex items-center justify-center"
                    style={{
                      background: promoStrategy === opt.value ? "#22d3ee" : "transparent",
                      border:     promoStrategy === opt.value ? "none" : "1.5px solid rgba(255,255,255,0.25)",
                    }}
                    onClick={() => setPromoStrategy(opt.value)}
                  >
                    {promoStrategy === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-[#0a1628]" />}
                  </div>
                  <div onClick={() => setPromoStrategy(opt.value)}>
                    <p className="text-sm font-semibold" style={{ color: promoStrategy === opt.value ? "#e2e8f0" : "rgba(255,255,255,0.55)" }}>
                      {opt.label}
                    </p>
                    <p className="text-xs mt-0.5 text-white/35">{opt.desc}</p>
                  </div>
                </label>
              ))}
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs"
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", color: "rgba(252,165,165,0.80)" }}>
                <Shield className="w-3.5 h-3.5 flex-shrink-0" />
                Students are never promoted automatically without an explicit confirmation step.
              </div>
            </div>
          </div>

          {/* ── SECTION 4: New Admissions ─────────────────────────────── */}
          <div>
            <SectionLabel>4 · New Admissions</SectionLabel>
            <div
              className="flex items-center justify-between p-4 rounded-xl"
              style={{
                background: newAdmissions ? "rgba(16,185,129,0.07)" : "rgba(255,255,255,0.03)",
                border:     newAdmissions ? "1px solid rgba(16,185,129,0.25)" : "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: newAdmissions ? "#e2e8f0" : "rgba(255,255,255,0.55)" }}>
                  Enable New Admissions for this Session
                </p>
                <p className="text-xs mt-0.5 text-white/35">
                  Allow the student registry to register new students under this session.
                </p>
              </div>
              <ToggleSwitch
                on={newAdmissions}
                onChange={() => setNewAdmissions(v => !v)}
              />
            </div>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="flex gap-3 px-6 py-4 flex-shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 border-white/15 text-white/60 hover:bg-white/5"
            data-testid="button-modal-cancel"
          >
            Cancel
          </Button>
          <button
            disabled={!isValid || isPending}
            onClick={handleSubmit}
            data-testid="button-modal-save"
            className="flex-1 h-9 rounded-lg font-semibold text-sm flex items-center justify-center gap-2
              disabled:opacity-40 transition-all hover:brightness-110 active:scale-95"
            style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", color: "#fff" }}
          >
            {isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
              : <><Plus className="w-4 h-4" /> Create Session</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUCCESS DIALOG — quick actions after creation
// ══════════════════════════════════════════════════════════════════════════════
interface SuccessDialogProps {
  session:    AcademicSession;
  onClose:    () => void;
  onNavigate: (path: string) => void;
}
function SuccessDialog({ session, onClose, onNavigate }: SuccessDialogProps) {
  const actions = [
    { icon: Copy,         label: "Copy Previous Session Setup",    path: "/admin-dashboard/school-setup/academic-sessions" },
    { icon: GraduationCap, label: "Promote Students",              path: "/admin-dashboard/student-registry" },
    { icon: UserPlus,     label: "Add New Admissions",              path: "/admin-dashboard/student-registry" },
    { icon: LayoutGrid,   label: "Manage Timetable",               path: "/admin-dashboard/timetable" },
    { icon: Users,        label: "Assign Teachers",                 path: "/admin-dashboard/faculty-mapping" },
    { icon: Zap,          label: "Switch Active Session",           path: "" },
    { icon: CalendarRange, label: "Go to Academic Sessions Dashboard", path: "" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={GLASS.modalOverlay}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={GLASS.modal}>
        {/* Success header */}
        <div className="px-6 pt-6 pb-5 text-center"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
            style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)", boxShadow: "0 0 24px rgba(34,211,238,0.35)" }}>
            <CheckCircle2 className="w-7 h-7 text-white" />
          </div>
          <h3 className="font-bold text-white text-lg">Session Created!</h3>
          <p className="text-sm mt-1" style={{ color: "rgba(34,211,238,0.80)" }}>
            {session.sessionName}
          </p>
          <p className="text-xs text-white/40 mt-1">
            {fmtDate(session.startDate)} → {fmtDate(session.endDate)}
          </p>
        </div>

        {/* Quick actions */}
        <div className="p-4 space-y-1.5 max-h-64 overflow-y-auto">
          {actions.map(({ icon: Icon, label, path }) => (
            <button
              key={label}
              onClick={() => { path ? onNavigate(path) : onClose(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-left text-sm font-semibold text-white/70 hover:text-white transition-all"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              data-testid={`success-action-${label.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(34,211,238,0.10)" }}>
                <Icon className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              {label}
              <ArrowRight className="w-3.5 h-3.5 ml-auto text-white/25" />
            </button>
          ))}
        </div>

        {/* Close */}
        <div className="px-6 pb-5 pt-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="w-full border-white/15 text-white/60 hover:bg-white/5"
            data-testid="button-success-close"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
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

  return (
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
  );
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
  return (
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
  );
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

  const [showCreate,      setShowCreate]      = useState(false);
  const [createdSession,  setCreatedSession]  = useState<AcademicSession | null>(null);
  const [rolloverTarget,  setRolloverTarget]  = useState<AcademicSession | null>(null);
  const [deleteTarget,    setDeleteTarget]    = useState<AcademicSession | null>(null);

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: sessions = [], isLoading } = useQuery<AcademicSession[]>({
    queryKey: ["/api/admin/academic-sessions"],
    queryFn: async () => {
      const r = await fetch("/api/admin/academic-sessions", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load sessions");
      return r.json();
    },
  });

  const activeSession = sessions.find(s => s.isActive);

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
      setCreatedSession(session);
      toast({ title: "Session created", description: `"${session.sessionName}" has been created.` });
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
            background:  "linear-gradient(135deg,#22d3ee,#6366f1)",
            boxShadow:   "0 4px 16px rgba(34,211,238,0.25)",
          }}
        >
          <Plus className="w-4 h-4" /> Add Session
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
                    {session.newAdmissionsEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                        style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.20)" }}>
                        Admissions Open
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 text-white/50">
                    {fmtDate(session.startDate)} → {fmtDate(session.endDate)}
                  </p>
                  {session.copiedFromSessionId && (
                    <p className="text-[10px] mt-0.5 text-white/30 flex items-center gap-1">
                      <Copy className="w-2.5 h-2.5" />
                      Copied from session #{session.copiedFromSessionId}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Settings / expand — placeholder for future detail view */}
                  <button
                    onClick={() => {}}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-white/25 hover:text-white/60 transition-colors"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    title="Session settings"
                    data-testid={`button-settings-${session.id}`}
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>

                  {/* Activate toggle */}
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

                  {/* Delete */}
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

      {/* ── Modals ────────────────────────────────────────────────────── */}
      {showCreate && (
        <CreateSessionModal
          sessions={sessions}
          onClose={() => setShowCreate(false)}
          onCreated={setCreatedSession}
          isPending={createMut.isPending}
          onSubmit={payload => createMut.mutate(payload)}
        />
      )}
      {createdSession && (
        <SuccessDialog
          session={createdSession}
          onClose={() => setCreatedSession(null)}
          onNavigate={path => { setCreatedSession(null); setLocation(path); }}
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
