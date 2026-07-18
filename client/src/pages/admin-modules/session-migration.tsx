/**
 * SessionMigrationPage — 3-step academic session migration wizard.
 *
 * Route: /admin-dashboard/school-setup/session-migration
 *        ?name=&start=&end=&copyFrom=<srcSessionId>
 *
 * Step 1 — Session Details  (completed in the modal; wizard starts at Step 2)
 * Step 2 — Module Selector  (mandatory / chooseable / blocked)
 * Step 3 — Migration        (creates session in DB → copies modules → live log)
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Check, Lock, AlertTriangle, Loader2, Info,
  GraduationCap, CheckCircle2, AlertCircle, ArrowRight, Zap, Shield,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtDate } from "@/lib/dateUtils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Session {
  id: number;
  sessionName: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  copiedFromSessionId: number | null;
}

interface CopyEntry {
  module: string;
  parentModule: string;
  label: string;
  count: number;
  note: string;
}

interface CopyResult {
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

// ── Module catalogue ──────────────────────────────────────────────────────────

// School Setup — the one module whose subIds are always sent to the backend
const MANDATORY_MODULE = {
  id: "school-setup",
  label: "School Setup",
  emoji: "⚙️",
  desc: "Classes, Sections, Subjects, Exam Types, Grading & Promotion Policy, Attendance & Leave Policy",
  subIds: [
    "classes", "sections", "subjects", "exam-types",
    "class-mapping", "subject-mapping", "class-exam-type-mapping",
    "grading-policy", "promotion-policy", "attendance-policy", "leave-policy",
  ],
};

// Always-carried global frameworks (non-session-keyed; shown as permanent in UI)
// Their subIds are also injected into every migration run automatically.
const GLOBAL_FRAMEWORK_MODULES = [
  {
    id: "teacher-staff",
    label: "Teacher Registry & Support Staff",
    emoji: "👩‍🏫",
    note: "School employees — maintained globally, permissions persist",
    subIds: [] as string[],
  },
  {
    id: "student-registry",
    label: "Student Registry",
    emoji: "🎓",
    note: "Student identities are permanent — only class assignments change per session",
    subIds: [] as string[],
  },
  {
    id: "faculty-mapping",
    label: "Faculty Mapping",
    emoji: "🗂️",
    note: "Teacher–class–subject assignment matrix carried into every session",
    subIds: ["teacher-class-assignments"],
  },
  {
    id: "assets-inventory",
    label: "Assets & Inventory",
    emoji: "📦",
    note: "Asset masters and storage locations are school-wide records",
    subIds: ["asset-categories", "asset-master", "storage-locations"],
  },
  {
    id: "school-calendar",
    label: "School Calendar",
    emoji: "🗓️",
    note: "Calendar is always available — historical events remain in their session",
    subIds: [] as string[],
  },
];

interface ChooseableMod {
  id: string;
  label: string;
  emoji: string;
  desc: string;
  note: string;
  subIds: string[];
  accentColor: string;
  accentHex: string;
}

const CHOOSEABLE_MODULES: ChooseableMod[] = [
  {
    id: "timetable-master",
    label: "Timetable Master",
    emoji: "📅",
    desc: "Bell Structure layout only · Period schedule grid resets",
    note: "Copies bell intervals only — the day/hour schedule grid starts blank",
    subIds: ["bell-structure"],          // period-config intentionally excluded
    accentColor: "#3b82f6",
    accentHex: "59,130,246",
  },
  {
    id: "approval-center",
    label: "Approval Center",
    emoji: "✅",
    desc: "Gallery Hub catalog & E-Book Library catalog framework",
    note: "Retains catalog categories only — all pending leaves & uploads clear out",
    subIds: ["gallery-catalog", "ebook-catalog"],
    accentColor: "#8b5cf6",
    accentHex: "139,92,246",
  },
];

const BLOCKED_MODULES = [
  { id: "exam-controller",       label: "Exam Controller",       emoji: "🏆" },
  { id: "attendance",            label: "Attendance Overview",    emoji: "📊" },
  { id: "complaint-hub",         label: "Complaint Hub",          emoji: "🛡️" },
  { id: "noticeboard",           label: "Noticeboard",            emoji: "🔔" },
  { id: "visitor-log",           label: "Visitor Log",            emoji: "🚪" },
  { id: "audit-logs",            label: "Audit Logs",             emoji: "🔐" },
  { id: "id-card-gen",           label: "ID Card Generator",      emoji: "💳" },
  { id: "fees-payments",         label: "Fees & Payments",        emoji: "💰" },
  { id: "performance-analytics", label: "Performance Analytics",  emoji: "📈" },
];

// ── Step Bar ──────────────────────────────────────────────────────────────────

function StepBar({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1 as const, label: "Session Details" },
    { n: 2 as const, label: "Select Modules" },
    { n: 3 as const, label: "Migration" },
  ];
  return (
    <div className="flex items-center w-full max-w-xl mx-auto">
      {steps.map((s, i) => {
        const done   = s.n < current;
        const active = s.n === current;
        return (
          <div key={s.n} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                style={{
                  background: done    ? "#10b981"
                             : active ? "linear-gradient(135deg,#22d3ee,#6366f1)"
                             :          "rgba(255,255,255,0.08)",
                  boxShadow: active ? "0 0 18px rgba(34,211,238,0.40)" : "none",
                  color: done || active ? "#fff" : "rgba(255,255,255,0.25)",
                }}>
                {done ? <Check className="w-4 h-4" /> : s.n}
              </div>
              <span
                className="text-[9px] font-semibold text-center hidden sm:block"
                style={{ color: active ? "#22d3ee" : done ? "#10b981" : "rgba(255,255,255,0.25)" }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className="flex-1 h-px mx-2 mt-[-14px] sm:mt-[-20px]"
                style={{ background: done ? "#10b981" : "rgba(255,255,255,0.10)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Chooseable tile ───────────────────────────────────────────────────────────

function ChooseTile({ mod, selected, onToggle }: {
  mod: ChooseableMod; selected: boolean; onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={`tile-choose-${mod.id}`}
      className="w-full text-left rounded-xl p-4 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
      style={{
        background: selected ? `rgba(${mod.accentHex},0.09)` : "rgba(255,255,255,0.04)",
        border: selected ? `1.5px solid rgba(${mod.accentHex},0.35)` : "1px solid rgba(255,255,255,0.08)",
        boxShadow: selected ? `0 0 20px rgba(${mod.accentHex},0.10)` : "none",
      }}>
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{
            background: selected ? `rgba(${mod.accentHex},0.18)` : "rgba(255,255,255,0.06)",
            border: selected ? `1px solid rgba(${mod.accentHex},0.30)` : "1px solid rgba(255,255,255,0.08)",
          }}>
          {mod.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold" style={{ color: selected ? "#fff" : "rgba(255,255,255,0.75)" }}>
            {mod.label}
          </p>
          <p className="text-[10px] text-white/35 mt-0.5 leading-relaxed">{mod.desc}</p>
          <p className="text-[10px] mt-1 leading-relaxed italic" style={{ color: selected ? `rgba(${mod.accentHex},0.65)` : "rgba(255,255,255,0.18)" }}>
            {mod.note}
          </p>
          <p className="text-[10px] mt-1" style={{ color: selected ? mod.accentColor : "rgba(255,255,255,0.20)" }}>
            {mod.subIds.length} configuration{mod.subIds.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all mt-0.5"
          style={{
            background: selected ? mod.accentColor : "transparent",
            border: selected ? `1.5px solid ${mod.accentColor}` : "1.5px solid rgba(255,255,255,0.20)",
          }}>
          {selected && <Check className="w-3 h-3 text-white" />}
        </div>
      </div>
    </button>
  );
}

// ── Log entry chip ────────────────────────────────────────────────────────────

type EntryKind = "copied" | "shared" | "empty" | "fresh";

function LogEntryRow({ label, parent, note, count, kind, visible }: {
  label: string; parent: string; note: string; count: number;
  kind: EntryKind; visible: boolean;
}) {
  const cfg: Record<EntryKind, { icon: typeof Check; color: string; bg: string; border: string; badge: string }> = {
    copied: { icon: CheckCircle2, color: "#22d3ee", bg: "rgba(34,211,238,0.05)", border: "rgba(34,211,238,0.16)", badge: count > 0 ? `Copied · ${count}` : "Copied" },
    shared: { icon: Check,        color: "#10b981", bg: "rgba(16,185,129,0.05)", border: "rgba(16,185,129,0.16)", badge: count > 0 ? `Shared · ${count}` : "Shared" },
    empty:  { icon: AlertTriangle, color: "#f59e0b", bg: "rgba(245,158,11,0.05)", border: "rgba(245,158,11,0.14)", badge: "Not Configured" },
    fresh:  { icon: Shield,        color: "rgba(255,255,255,0.20)", bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.06)", badge: "Always Fresh" },
  };
  const c = cfg[kind];
  const Icon = c.icon;
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(6px)",
        transition: "opacity 0.3s ease, transform 0.3s ease",
      }}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: c.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white/80">{label}</p>
        <p className="text-[10px] text-white/30 mt-0.5">{parent} · {note}</p>
      </div>
      <span
        className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0"
        style={{ background: `${c.color}18`, color: c.color, border: `1px solid ${c.color}28` }}>
        {c.badge}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SessionMigrationPage() {
  const [, setLocation] = useLocation();
  const { toast }       = useToast();

  // ── Parse URL params ───────────────────────────────────────────────────────
  const search = typeof window !== "undefined" ? window.location.search : "";
  const sp     = new URLSearchParams(search);
  const newName    = sp.get("name")     ?? "";
  const newStart   = sp.get("start")    ?? "";
  const newEnd     = sp.get("end")      ?? "";
  const srcIdStr   = sp.get("copyFrom") ?? "";
  const srcSessionId = parseInt(srcIdStr) || null;

  // Guard — if essential params are missing redirect back
  useEffect(() => {
    if (!newName || !newStart || !newEnd || !srcSessionId) {
      toast({ title: "Invalid wizard state", description: "Please start again from the session form.", variant: "destructive" });
      setLocation("/admin-dashboard/academic-sessions");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Source session info ────────────────────────────────────────────────────
  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ["/api/admin/academic-sessions"],
  });
  const srcSession = srcSessionId ? (sessions.find(s => s.id === srcSessionId) ?? null) : null;

  // ── View state ─────────────────────────────────────────────────────────────
  type View = "selector" | "worklog";
  const [view, setView]         = useState<View>("selector");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // worklog state
  type MigStatus = "creating" | "copying" | "complete" | "error";
  const [migStatus,    setMigStatus]    = useState<MigStatus>("creating");
  const [migSubMsg,    setMigSubMsg]    = useState("");
  const [copyResult,   setCopyResult]   = useState<CopyResult | null>(null);
  const [createdId,    setCreatedId]    = useState<number | null>(null);
  const [errorMsg,     setErrorMsg]     = useState("");
  const [visibleCount, setVisibleCount] = useState(0);

  function toggleModule(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Migration runner — Step 3 logic ───────────────────────────────────────
  const runMigration = useCallback(async () => {
    if (!srcSessionId || !newName || !newStart || !newEnd) {
      setErrorMsg("Missing session details. Please go back and try again.");
      setMigStatus("error");
      return;
    }

    setMigStatus("creating");
    setMigSubMsg(`Creating "${newName}"…`);
    setCopyResult(null);
    setVisibleCount(0);
    setErrorMsg("");

    // Step 3a — Create the session in DB
    let newSessionId: number;
    try {
      const cr = await apiRequest("POST", "/api/admin/academic-sessions", {
        sessionName:         newName,
        startDate:           newStart,
        endDate:             newEnd,
        copiedFromSessionId: srcSessionId,
        status:              "draft",
      });
      if (!cr.ok) {
        const e = await cr.json();
        throw new Error(e.message || "Failed to create session");
      }
      const session: Session = await cr.json();
      newSessionId = session.id;
      setCreatedId(session.id);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-sessions"] });
    } catch (e: any) {
      setErrorMsg(e.message || "Could not create session");
      setMigStatus("error");
      return;
    }

    // Step 3b — Copy modules
    setMigStatus("copying");
    setMigSubMsg("Copying configurations…");

    const mandatorySubIds = [
      ...MANDATORY_MODULE.subIds,
      ...GLOBAL_FRAMEWORK_MODULES.flatMap(m => m.subIds),
    ];
    const chosenSubIds = CHOOSEABLE_MODULES.filter(m => selected.has(m.id)).flatMap(m => m.subIds);
    const allSubIds    = [...mandatorySubIds, ...chosenSubIds];

    try {
      const mr = await apiRequest(
        "POST",
        `/api/admin/academic-sessions/${newSessionId}/copy-modules`,
        { sourceSessionId: srcSessionId, subModuleIds: allSubIds }
      );
      if (!mr.ok) {
        const e = await mr.json();
        throw new Error(e.message || "Migration failed");
      }
      const data = await mr.json() as { copyResult: CopyResult };
      setCopyResult(data.copyResult);
      setMigStatus("complete");
      toast({ title: "Session created", description: `"${newName}" is ready with copied configurations.` });
    } catch (e: any) {
      setErrorMsg(e.message || "An unexpected error occurred during migration");
      setMigStatus("error");
    }
  }, [srcSessionId, newName, newStart, newEnd, selected]);

  useEffect(() => {
    if (view === "worklog") runMigration();
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate log entries after result
  useEffect(() => {
    if (!copyResult || migStatus !== "complete") return;
    const total = copyResult.copied.length + copyResult.sharedSchoolwide.length +
                  copyResult.requestedButEmpty.length + BLOCKED_MODULES.length;
    let count = 0;
    const timer = setInterval(() => { count++; setVisibleCount(count); if (count >= total) clearInterval(timer); }, 70);
    return () => clearInterval(timer);
  }, [copyResult, migStatus]);

  // ── Shared page shell ──────────────────────────────────────────────────────

  function PageHeader({ onBack, backDisabled = false }: { onBack: () => void; backDisabled?: boolean }) {
    return (
      <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <button
          onClick={onBack}
          disabled={backDisabled}
          className="flex items-center gap-2 text-white/45 hover:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
          data-testid="button-migration-back">
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Back</span>
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-white/80">Session Migration Wizard</p>
          <p className="text-[10px] text-white/35">{newName || "New Session"}</p>
        </div>
        <div className="w-16" />
      </div>
    );
  }

  function SessionBanner() {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
        style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.13)" }}>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-white/30 uppercase font-bold tracking-wider mb-0.5">Source</p>
          <p className="text-sm font-semibold text-white/70 truncate">
            {srcSession?.sessionName ?? `Session #${srcSessionId}`}
          </p>
          {srcSession && (
            <p className="text-[10px] text-white/30 mt-0.5">
              {fmtDate(srcSession.startDate)} → {fmtDate(srcSession.endDate)}
            </p>
          )}
        </div>
        <ArrowRight className="w-5 h-5 text-cyan-400/40 flex-shrink-0" />
        <div className="flex-1 min-w-0 text-right">
          <p className="text-[10px] text-white/30 uppercase font-bold tracking-wider mb-0.5">Target (New)</p>
          <p className="text-sm font-semibold text-cyan-300 truncate">{newName}</p>
          {newStart && newEnd && (
            <p className="text-[10px] text-white/30 mt-0.5">
              {fmtDate(newStart)} → {fmtDate(newEnd)}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — MODULE SELECTOR
  // ══════════════════════════════════════════════════════════════════════════

  if (view === "selector") {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>
        <PageHeader onBack={() => setLocation("/admin-dashboard/academic-sessions")} />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">

            <StepBar current={2} />
            <SessionBanner />

            {/* MANDATORY */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-5 rounded-full" style={{ background: "linear-gradient(180deg,#10b981,#34d399)" }} />
                <h3 className="text-[11px] font-black tracking-widest uppercase text-emerald-400/80">Mandatory / Permanent Frameworks</h3>
                <span className="text-[10px] text-white/25">Never Reset</span>
              </div>

              {/* School Setup hero card */}
              <div className="rounded-xl p-4"
                style={{ background: "rgba(16,185,129,0.06)", border: "1.5px solid rgba(16,185,129,0.28)", boxShadow: "0 0 24px rgba(16,185,129,0.08)" }}>
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.28)" }}>
                    ⚙️
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-white/90">School Setup</p>
                      <span className="text-[8px] font-black tracking-wider px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.28)" }}>
                        REQUIRED
                      </span>
                    </div>
                    <p className="text-[10px] text-white/40 mt-0.5 leading-relaxed">{MANDATORY_MODULE.desc}</p>
                    <p className="text-[10px] text-emerald-400/55 mt-1.5">
                      {MANDATORY_MODULE.subIds.length} configurations · Auto-included in every migration
                    </p>
                  </div>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.35)" }}>
                    <Check className="w-4 h-4 text-emerald-400" />
                  </div>
                </div>
              </div>

              {/* Global framework modules — always carried, non-removable */}
              <div className="rounded-xl overflow-hidden"
                style={{ background: "rgba(16,185,129,0.03)", border: "1px solid rgba(16,185,129,0.16)" }}>
                {GLOBAL_FRAMEWORK_MODULES.map((mod, idx) => (
                  <div key={mod.id}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{
                      borderBottom: idx < GLOBAL_FRAMEWORK_MODULES.length - 1
                        ? "1px solid rgba(255,255,255,0.05)" : "none",
                    }}
                    data-testid={`tile-global-${mod.id}`}>
                    <span className="text-base w-6 text-center flex-shrink-0 opacity-70">{mod.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white/70">{mod.label}</p>
                      <p className="text-[10px] text-white/30 mt-0.5 leading-relaxed">{mod.note}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {mod.subIds.length > 0 && (
                        <span className="text-[9px] text-emerald-400/50">
                          {mod.subIds.length} config{mod.subIds.length !== 1 ? "s" : ""}
                        </span>
                      )}
                      <div className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.30)" }}>
                        <Check className="w-3 h-3 text-emerald-400" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* CHOOSEABLE */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-5 rounded-full" style={{ background: "linear-gradient(180deg,#22d3ee,#6366f1)" }} />
                <h3 className="text-[11px] font-black tracking-widest uppercase text-cyan-400/80">Reusable Configurations</h3>
                <span className="text-[10px] text-white/25">Select what to carry forward</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CHOOSEABLE_MODULES.map(mod => (
                  <ChooseTile
                    key={mod.id}
                    mod={mod}
                    selected={selected.has(mod.id)}
                    onToggle={() => toggleModule(mod.id)}
                  />
                ))}
              </div>
              {selected.size === 0 && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[10px]"
                  style={{ background: "rgba(34,211,238,0.04)", border: "1px solid rgba(34,211,238,0.10)", color: "rgba(147,197,253,0.60)" }}>
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-400" />
                  <span>Only mandatory frameworks will be migrated. Select modules above to carry additional configurations into the new session.</span>
                </div>
              )}
            </section>

            {/* BLOCKED */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-5 rounded-full" style={{ background: "linear-gradient(180deg,#ef4444,#f87171)" }} />
                <h3 className="text-[11px] font-black tracking-widest uppercase text-red-400/80">Always Start Fresh</h3>
                <span className="text-[10px] text-white/25">Historical data cannot be duplicated</span>
              </div>
              <div className="rounded-xl px-1 py-1"
                style={{ background: "rgba(239,68,68,0.03)", border: "1px solid rgba(239,68,68,0.14)" }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
                  {BLOCKED_MODULES.map(mod => (
                    <div key={mod.id} className="flex items-center gap-2.5 px-3 py-2.5"
                      data-testid={`tile-blocked-${mod.id}`}>
                      <span className="text-sm opacity-40">{mod.emoji}</span>
                      <p className="text-xs text-white/30 flex-1">{mod.label}</p>
                      <Lock className="w-3 h-3 text-red-400/35 flex-shrink-0" />
                    </div>
                  ))}
                </div>
                <div className="mx-3 mb-2 mt-1 flex items-start gap-2 px-3 py-2 rounded-lg text-[10px]"
                  style={{ background: "rgba(239,68,68,0.05)", color: "rgba(252,165,165,0.55)" }}>
                  <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5 text-red-400/50" />
                  <span>Fresh data required for new session — these records are tied to a specific academic period and cannot be duplicated.</span>
                </div>
              </div>
            </section>

            {/* ── FOOTER: Previous + Next ─────────────────────────────────── */}
            <div className="pb-4 space-y-3">
              <div className="flex gap-3">
                <button
                  onClick={() => setLocation("/admin-dashboard/academic-sessions")}
                  className="flex-1 h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-white/6"
                  style={{ border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.50)" }}
                  data-testid="button-step2-previous">
                  <ArrowLeft className="w-4 h-4" />
                  Previous
                </button>
                <button
                  onClick={() => setView("worklog")}
                  className="flex-1 h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.99]"
                  style={{
                    background: "linear-gradient(135deg,#22d3ee,#6366f1)",
                    color: "#fff",
                    boxShadow: "0 4px 24px rgba(34,211,238,0.30)",
                  }}
                  data-testid="button-step2-next">
                  Create New Session
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[10px] text-center text-white/20">
                School Setup is always included ·{" "}
                {selected.size > 0
                  ? `${selected.size} additional module${selected.size !== 1 ? "s" : ""} selected`
                  : "No optional modules selected"}
              </p>
            </div>

          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — MIGRATION WORK LOG
  // ══════════════════════════════════════════════════════════════════════════

  const isRunning = migStatus === "creating" || migStatus === "copying";

  const allLogEntries: Array<{ kind: EntryKind; label: string; parent: string; note: string; count: number }> = [];
  if (copyResult) {
    copyResult.sharedSchoolwide.forEach(e =>
      allLogEntries.push({ kind: "shared", label: e.label, parent: e.parentModule, note: e.note, count: e.count }));
    copyResult.copied.forEach(e =>
      allLogEntries.push({ kind: "copied", label: e.label, parent: e.parentModule, note: e.note, count: e.count }));
    copyResult.requestedButEmpty.forEach(e =>
      allLogEntries.push({ kind: "empty",  label: e.label, parent: e.parentModule, note: e.note, count: 0 }));
  }

  const blockedEntries = BLOCKED_MODULES.map(m => ({
    kind: "fresh" as EntryKind,
    label: m.label,
    parent: "System",
    note: "Always starts fresh — historical data not carried forward",
    count: 0,
  }));

  const totalEntries = allLogEntries.length + blockedEntries.length;
  const allVisible   = migStatus === "complete" && visibleCount >= totalEntries;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>
      <PageHeader
        onBack={() => {
          if (isRunning) return;
          setView("selector");
          setCopyResult(null);
          setVisibleCount(0);
          setMigStatus("creating");
          setCreatedId(null);
          setErrorMsg("");
        }}
        backDisabled={isRunning}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">

          <StepBar current={3} />
          <SessionBanner />

          {/* Status banner */}
          {migStatus === "creating" && (
            <div className="flex items-center gap-4 px-5 py-4 rounded-xl"
              style={{ background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.18)" }}>
              <Loader2 className="w-6 h-6 text-cyan-400 animate-spin flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-cyan-300">Creating session…</p>
                <p className="text-[10px] text-white/40 mt-0.5">{migSubMsg}</p>
              </div>
            </div>
          )}

          {migStatus === "copying" && (
            <div className="flex items-center gap-4 px-5 py-4 rounded-xl"
              style={{ background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.18)" }}>
              <Loader2 className="w-6 h-6 text-cyan-400 animate-spin flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-cyan-300">Migration in progress…</p>
                <p className="text-[10px] text-white/40 mt-0.5">{migSubMsg}</p>
              </div>
            </div>
          )}

          {migStatus === "error" && (
            <div className="flex items-start gap-3 px-5 py-4 rounded-xl"
              style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)" }}>
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-400">Migration failed</p>
                <p className="text-[10px] text-white/50 mt-0.5">{errorMsg}</p>
                {!createdId && (
                  <button onClick={runMigration}
                    className="mt-2 text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                    Retry
                  </button>
                )}
                {createdId && (
                  <p className="text-[10px] text-amber-400/60 mt-1">
                    Session #{createdId} was created but module copy failed. You can retry the copy from Academic Sessions.
                  </p>
                )}
              </div>
            </div>
          )}

          {migStatus === "complete" && copyResult && (
            <div className="flex items-center gap-4 px-5 py-4 rounded-xl"
              style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.22)" }}>
              <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-bold text-emerald-300">Session created &amp; migration complete</p>
                <p className="text-[10px] text-white/40 mt-0.5">
                  {copyResult.sharedSchoolwide.length + copyResult.copied.length} configurations verified
                  {copyResult.requestedButEmpty.length > 0
                    ? ` · ${copyResult.requestedButEmpty.length} not yet configured in source`
                    : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-black" style={{ color: "#22d3ee" }}>
                  {copyResult.sharedSchoolwide.length + copyResult.copied.length}
                </p>
                <p className="text-[9px] text-white/30">verified</p>
              </div>
            </div>
          )}

          {/* Log entries — grouped by module */}
          {copyResult && (() => {
            // Build ordered module groups preserving insertion order
            const groupMap = new Map<string, typeof allLogEntries>();
            for (const e of allLogEntries) {
              if (!groupMap.has(e.parent)) groupMap.set(e.parent, []);
              groupMap.get(e.parent)!.push(e);
            }
            const groups = Array.from(groupMap.entries()); // [moduleName, entries[]]

            // Flatten for visibility index tracking (same order as before)
            let globalIdx = 0;

            return (
              <div className="space-y-4">
                <p className="text-[10px] uppercase font-black tracking-widest text-white/25 px-1">
                  Migration Pipeline
                </p>

                {groups.map(([moduleName, entries]) => {
                  const allOk     = entries.every(e => e.kind === "shared" || e.kind === "copied");
                  const anyEmpty  = entries.some(e => e.kind === "empty");
                  const anyFailed = entries.some(e => e.kind === "copied" && e.count === 0);
                  const successCount = entries.filter(e => e.kind === "shared" || e.kind === "copied").length;

                  // Module header colours
                  const hdrBg     = anyEmpty  ? "rgba(245,158,11,0.06)"
                                  : anyFailed ? "rgba(239,68,68,0.06)"
                                  :             "rgba(16,185,129,0.06)";
                  const hdrBorder = anyEmpty  ? "rgba(245,158,11,0.22)"
                                  : anyFailed ? "rgba(239,68,68,0.22)"
                                  :             "rgba(16,185,129,0.22)";
                  const hdrColor  = anyEmpty  ? "#f59e0b"
                                  : anyFailed ? "#f87171"
                                  :             "#34d399";
                  const hdrIcon   = anyEmpty  ? <AlertTriangle className="w-3.5 h-3.5" style={{ color: hdrColor }} />
                                  : anyFailed ? <AlertCircle   className="w-3.5 h-3.5" style={{ color: hdrColor }} />
                                  :             <CheckCircle2  className="w-3.5 h-3.5" style={{ color: hdrColor }} />;
                  const hdrBadge  = anyEmpty  ? `${successCount}/${entries.length} configured`
                                  : anyFailed ? `${successCount}/${entries.length} ok`
                                  :             `${entries.length}/${entries.length} ✓`;

                  return (
                    <div key={moduleName} className="rounded-xl overflow-hidden"
                      style={{ border: `1px solid ${hdrBorder}` }}>
                      {/* Module header */}
                      <div className="flex items-center gap-2.5 px-4 py-2.5"
                        style={{ background: hdrBg, borderBottom: `1px solid ${hdrBorder}` }}>
                        {hdrIcon}
                        <p className="text-xs font-black tracking-wide flex-1" style={{ color: hdrColor }}>
                          {moduleName}
                        </p>
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: `${hdrColor}18`, color: hdrColor, border: `1px solid ${hdrColor}28` }}>
                          {hdrBadge}
                        </span>
                      </div>

                      {/* Sub-module rows */}
                      <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                        {entries.map((item) => {
                          const myIdx = globalIdx++;
                          const isVis = visibleCount > myIdx;
                          const cfg: Record<EntryKind, { icon: typeof Check; color: string; badge: string }> = {
                            copied: { icon: CheckCircle2, color: "#22d3ee", badge: item.count > 0 ? `Copied · ${item.count}` : "Copied" },
                            shared: { icon: Check,        color: "#10b981", badge: item.count > 0 ? `Shared · ${item.count}` : "Shared" },
                            empty:  { icon: AlertTriangle,color: "#f59e0b", badge: "Not Configured" },
                            fresh:  { icon: Shield,       color: "rgba(255,255,255,0.20)", badge: "Always Fresh" },
                          };
                          const c = cfg[item.kind];
                          const Icon = c.icon;
                          return (
                            <div key={`${item.kind}-${item.label}`}
                              className="flex items-center gap-3 px-4 py-2.5"
                              style={{
                                background: "rgba(255,255,255,0.01)",
                                opacity: isVis ? 1 : 0,
                                transform: isVis ? "translateY(0)" : "translateY(4px)",
                                transition: "opacity 0.25s ease, transform 0.25s ease",
                              }}>
                              <Icon className="w-3 h-3 flex-shrink-0" style={{ color: c.color }} />
                              <p className="text-xs text-white/70 flex-1">{item.label}</p>
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0"
                                style={{ background: `${c.color}18`, color: c.color, border: `1px solid ${c.color}28` }}>
                                {c.badge}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Always Fresh section */}
                {allLogEntries.length > 0 && (
                  <p className="text-[9px] uppercase font-black tracking-widest px-1 pt-1"
                    style={{ color: "rgba(255,255,255,0.18)" }}>
                    Always Fresh — Not Migrated
                  </p>
                )}
                <div className="rounded-xl overflow-hidden"
                  style={{ border: "1px solid rgba(239,68,68,0.14)" }}>
                  {/* Fresh section header */}
                  <div className="flex items-center gap-2.5 px-4 py-2.5"
                    style={{ background: "rgba(239,68,68,0.05)", borderBottom: "1px solid rgba(239,68,68,0.12)" }}>
                    <Lock className="w-3.5 h-3.5 text-red-400/50" />
                    <p className="text-xs font-black tracking-wide flex-1 text-red-400/70">Historical Operational Data</p>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(239,68,68,0.10)", color: "rgba(248,113,113,0.70)", border: "1px solid rgba(239,68,68,0.18)" }}>
                      {blockedEntries.length} modules
                    </span>
                  </div>
                  <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                    {blockedEntries.map((item, idx) => {
                      const myIdx = globalIdx++;
                      const isVis = visibleCount > myIdx;
                      return (
                        <div key={`blocked-${item.label}`}
                          className="flex items-center gap-3 px-4 py-2.5"
                          style={{
                            background: "rgba(255,255,255,0.01)",
                            opacity: isVis ? 1 : 0,
                            transform: isVis ? "translateY(0)" : "translateY(4px)",
                            transition: `opacity 0.25s ease ${idx * 40}ms, transform 0.25s ease ${idx * 40}ms`,
                          }}>
                          <Lock className="w-3 h-3 flex-shrink-0 text-red-400/30" />
                          <p className="text-xs text-white/30 flex-1">{item.label}</p>
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.06)" }}>
                            Always Fresh
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            );
          })()}

          {/* CTA — shown once all entries animated */}
          {allVisible && (
            <div className="pb-4 space-y-3">
              <button
                onClick={() => setLocation("/admin-dashboard/exam-controller")}
                className="w-full h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all hover:brightness-110 active:scale-[0.99]"
                style={{
                  background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
                  color: "#fff",
                  boxShadow: "0 4px 24px rgba(99,102,241,0.32)",
                }}
                data-testid="button-proceed-promote-students">
                <GraduationCap className="w-5 h-5" />
                Proceed to Promote Students
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setLocation("/admin-dashboard/academic-sessions")}
                className="w-full h-10 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-white/5"
                style={{ color: "rgba(255,255,255,0.40)", border: "1px solid rgba(255,255,255,0.08)" }}
                data-testid="button-go-to-sessions">
                Back to Academic Sessions
              </button>
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[10px]"
                style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.14)", color: "rgba(196,181,253,0.60)" }}>
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "#a78bfa" }} />
                <span>
                  The session is saved as a <strong>Draft</strong>. Activate it from the Sessions page when you are ready to make it live.
                  Use <strong>Student Registry → Promote Students</strong> to advance students into the new session.
                </span>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
