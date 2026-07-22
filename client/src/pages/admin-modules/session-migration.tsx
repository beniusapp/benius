/**
 * SessionMigrationPage — 3-step academic session creation wizard.
 *
 * Route: /admin-dashboard/school-setup/session-migration
 *        ?name=&start=&end=&copyFrom=<srcSessionId>
 *
 * Step 1 — Session Details  (completed in the modal; wizard starts at Step 2)
 * Step 2 — Reset Overview   (informational; shows what resets vs global data)
 * Step 3 — Summary          (GLOBAL DATA preserved + SESSION DATA reset)
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Lock,
  AlertTriangle, AlertCircle, Loader2, Info,
  Globe, RefreshCw, GraduationCap, Shield,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
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

// ── Data constants ─────────────────────────────────────────────────────────────

const GLOBAL_DATA_ITEMS = [
  { id: "school-setup",       label: "School Setup",                      emoji: "⚙️",  detail: "Classes, Sections, Subjects, Exam Types, all Policies — 11 configurations" },
  { id: "teacher-staff",      label: "Teacher Registry & Support Staff",   emoji: "👩‍🏫", detail: "School employees maintained globally — permissions persist" },
  { id: "student-registry",   label: "Student Registry Identities",        emoji: "🎓",  detail: "Student records are permanent — only class assignments change per session" },
  { id: "faculty-mapping",    label: "Faculty Mapping Matrices",           emoji: "🗂️",  detail: "Teacher–class–subject assignment matrix" },
  { id: "assets-inventory",   label: "Assets & Inventory",                 emoji: "📦",  detail: "Asset masters, categories and storage locations" },
  { id: "school-calendar",    label: "School Calendar",                    emoji: "🗓️",  detail: "Calendar is always available — historical events stay in their session" },
  { id: "bell-structure",     label: "Timetable Bell Structure",           emoji: "🕐",  detail: "Period intervals and break layout — never reset" },
  { id: "approval-catalogs",  label: "Approval Center Catalogs",           emoji: "✅",  detail: "Gallery Hub catalog & E-Book Library catalog framework" },
];

const FULL_RESET_MODULES = [
  { id: "exam-controller",        label: "Exam Controller",       emoji: "🏆", detail: "All exam marks, scores and grade entries" },
  { id: "attendance",             label: "Attendance Overview",   emoji: "📊", detail: "All attendance records — fresh date window per session" },
  { id: "complaint-hub",          label: "Complaint Hub",         emoji: "🛡️", detail: "All complaints, grievances and escalations" },
  { id: "noticeboard",            label: "Noticeboard",           emoji: "🔔", detail: "All posted notices and announcements" },
  { id: "visitor-log",            label: "Visitor Log",           emoji: "🚪", detail: "All visitor entries and check-outs" },
  { id: "audit-logs",             label: "Audit Logs",            emoji: "🔐", detail: "All audit trail entries" },
  { id: "id-card-gen",            label: "ID Card Generator",     emoji: "💳", detail: "All generated ID card records" },
  { id: "fees-payments",          label: "Fees & Payments",       emoji: "💰", detail: "All fee records, invoices and payments" },
  { id: "performance-analytics",  label: "Performance Analytics", emoji: "📈", detail: "All analytics data and report cards" },
];

const PARTIAL_RESET_MODULES = [
  {
    id: "timetable-master",
    label: "Timetable Master",
    emoji: "📅",
    resets: ["Schedule Grid (day/hour assignments)", "Publish Status"],
    retains: ["Bell Structure layout (period intervals & breaks)"],
  },
  {
    id: "approval-center",
    label: "Approval Center",
    emoji: "✅",
    resets: ["Teacher Leave Requests", "Student Leave Requests"],
    retains: ["Gallery Hub catalog framework", "E-Book Library catalog framework"],
  },
];

// ── Step Bar ──────────────────────────────────────────────────────────────────

function StepBar({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1 as const, label: "Session Details" },
    { n: 2 as const, label: "Reset Overview" },
    { n: 3 as const, label: "Summary" },
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SessionMigrationPage() {
  const [, setLocation] = useLocation();
  const { toast }       = useToast();

  // ── Parse URL params ───────────────────────────────────────────────────────
  const search       = typeof window !== "undefined" ? window.location.search : "";
  const sp           = new URLSearchParams(search);
  const newName      = sp.get("name")     ?? "";
  const newStart     = sp.get("start")    ?? "";
  const newEnd       = sp.get("end")      ?? "";
  const srcIdStr     = sp.get("copyFrom") ?? "";
  const srcSessionId = parseInt(srcIdStr) || null;

  useEffect(() => {
    if (!newName || !newStart || !newEnd) {
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
  type View = "overview" | "summary";
  const [view,     setView]     = useState<View>("overview");
  type MigStatus = "idle" | "creating" | "complete" | "error";
  const [migStatus, setMigStatus] = useState<MigStatus>("idle");
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [errorMsg,  setErrorMsg]  = useState("");

  // ── Session creation ───────────────────────────────────────────────────────
  const createSession = useCallback(async () => {
    setMigStatus("creating");
    setErrorMsg("");
    try {
      const res = await apiRequest("POST", "/api/admin/academic-sessions", {
        sessionName:         newName,
        startDate:           newStart,
        endDate:             newEnd,
        copiedFromSessionId: srcSessionId ?? undefined,
        status:              "draft",
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || "Failed to create session");
      }
      const session: Session = await res.json();
      setCreatedId(session.id);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-sessions"] });
      setMigStatus("complete");
      setView("summary");
      toast({ title: "Session created", description: `"${newName}" is ready as a draft session.` });
    } catch (e: any) {
      setErrorMsg(e.message || "Could not create session");
      setMigStatus("error");
    }
  }, [newName, newStart, newEnd, srcSessionId]);

  // ── Shared components ──────────────────────────────────────────────────────

  function PageHeader({ onBack, backDisabled = false }: { onBack: () => void; backDisabled?: boolean }) {
    return (
      <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <button onClick={onBack} disabled={backDisabled}
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
            {srcSession?.sessionName ?? (srcSessionId ? `Session #${srcSessionId}` : "—")}
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
  // STEP 2 — SESSION-BASED RESET OVERVIEW
  // ══════════════════════════════════════════════════════════════════════════

  if (view === "overview") {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>
        <PageHeader onBack={() => setLocation("/admin-dashboard/academic-sessions")} />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">

            <StepBar current={2} />
            <SessionBanner />

            {/* Page title */}
            <div className="space-y-1">
              <h2 className="text-base font-black text-white/90">Session-Based Reset Configuration</h2>
              <p className="text-[11px] text-white/40 leading-relaxed">
                When you create a new session, the following modules reset automatically.
                Global data is never touched — it exists independently of any session.
              </p>
            </div>

            {/* ── A. FULL MODULE RESETS ─────────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-5 rounded-full" style={{ background: "linear-gradient(180deg,#ef4444,#f87171)" }} />
                <h3 className="text-[11px] font-black tracking-widest uppercase text-red-400/80">Full Module Resets</h3>
                <span className="text-[10px] text-white/25">Reset completely for the new session</span>
              </div>
              <div className="rounded-xl overflow-hidden"
                style={{ background: "rgba(239,68,68,0.03)", border: "1px solid rgba(239,68,68,0.18)" }}>
                {/* Header row */}
                <div className="flex items-center gap-2.5 px-4 py-2.5"
                  style={{ background: "rgba(239,68,68,0.08)", borderBottom: "1px solid rgba(239,68,68,0.14)" }}>
                  <RefreshCw className="w-3.5 h-3.5 text-red-400/70" />
                  <p className="text-[10px] font-black tracking-widest uppercase text-red-400/70 flex-1">
                    {FULL_RESET_MODULES.length} modules — all data cleared for new session ID
                  </p>
                </div>
                {FULL_RESET_MODULES.map((mod, idx) => (
                  <div key={mod.id}
                    className="flex items-start gap-3 px-4 py-3"
                    style={{ borderBottom: idx < FULL_RESET_MODULES.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
                    data-testid={`reset-full-${mod.id}`}>
                    <span className="text-sm opacity-50 flex-shrink-0 mt-0.5">{mod.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white/60">{mod.label}</p>
                      <p className="text-[10px] text-white/25 mt-0.5">{mod.detail}</p>
                    </div>
                    <Lock className="w-3 h-3 text-red-400/35 flex-shrink-0 mt-1" />
                  </div>
                ))}
                <div className="mx-3 mb-3 mt-2 flex items-start gap-2 px-3 py-2 rounded-lg text-[10px]"
                  style={{ background: "rgba(239,68,68,0.06)", color: "rgba(252,165,165,0.55)" }}>
                  <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5 text-red-400/50" />
                  <span>These records are tied to a specific academic period and cannot be carried over.</span>
                </div>
              </div>
            </section>

            {/* ── B. PARTIAL MODULE RESETS ──────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-5 rounded-full" style={{ background: "linear-gradient(180deg,#f59e0b,#fcd34d)" }} />
                <h3 className="text-[11px] font-black tracking-widest uppercase text-amber-400/80">Partial Module Resets</h3>
                <span className="text-[10px] text-white/25">Specific sub-components reset; frameworks stay</span>
              </div>
              <div className="space-y-3">
                {PARTIAL_RESET_MODULES.map(mod => (
                  <div key={mod.id} className="rounded-xl overflow-hidden"
                    style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.20)" }}>
                    {/* Module name header */}
                    <div className="flex items-center gap-2.5 px-4 py-2.5"
                      style={{ background: "rgba(245,158,11,0.07)", borderBottom: "1px solid rgba(245,158,11,0.14)" }}>
                      <span className="text-sm opacity-70">{mod.emoji}</span>
                      <p className="text-xs font-black text-amber-300/80 flex-1">{mod.label}</p>
                    </div>
                    <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* What resets */}
                      <div>
                        <p className="text-[9px] font-black tracking-widest uppercase text-red-400/60 mb-1.5">
                          🔄 Resets
                        </p>
                        <div className="space-y-1">
                          {mod.resets.map(r => (
                            <div key={r} className="flex items-center gap-1.5">
                              <div className="w-1 h-1 rounded-full bg-red-400/40 flex-shrink-0" />
                              <span className="text-[10px] text-white/45">{r}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* What stays */}
                      <div>
                        <p className="text-[9px] font-black tracking-widest uppercase text-emerald-400/60 mb-1.5">
                          ✓ Stays (Global)
                        </p>
                        <div className="space-y-1">
                          {mod.retains.map(r => (
                            <div key={r} className="flex items-center gap-1.5">
                              <div className="w-1 h-1 rounded-full bg-emerald-400/40 flex-shrink-0" />
                              <span className="text-[10px] text-white/50">{r}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── C. GLOBAL DATA — NEVER RESETS ──────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-5 rounded-full" style={{ background: "linear-gradient(180deg,#10b981,#34d399)" }} />
                <h3 className="text-[11px] font-black tracking-widest uppercase text-emerald-400/80">Global Data</h3>
                <span className="text-[10px] text-white/25">Never resets — session-independent</span>
              </div>
              <div className="rounded-xl overflow-hidden"
                style={{ background: "rgba(16,185,129,0.03)", border: "1px solid rgba(16,185,129,0.20)" }}>
                <div className="flex items-center gap-2.5 px-4 py-2.5"
                  style={{ background: "rgba(16,185,129,0.07)", borderBottom: "1px solid rgba(16,185,129,0.14)" }}>
                  <Globe className="w-3.5 h-3.5 text-emerald-400/70" />
                  <p className="text-[10px] font-black tracking-widest uppercase text-emerald-400/70 flex-1">
                    {GLOBAL_DATA_ITEMS.length} permanent frameworks — untouched regardless of sessions created
                  </p>
                </div>
                {GLOBAL_DATA_ITEMS.map((item, idx) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-2.5"
                    style={{ borderBottom: idx < GLOBAL_DATA_ITEMS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                    <span className="text-sm opacity-60 w-5 text-center flex-shrink-0">{item.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white/60">{item.label}</p>
                      <p className="text-[10px] text-white/25 mt-0.5">{item.detail}</p>
                    </div>
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.30)" }}>
                      <Check className="w-3 h-3 text-emerald-400" />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Error state ────────────────────────────────────────────── */}
            {migStatus === "error" && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
                style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)" }}>
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-400">Failed to create session</p>
                  <p className="text-[10px] text-white/50 mt-0.5">{errorMsg}</p>
                </div>
              </div>
            )}

            {/* ── Footer CTA ─────────────────────────────────────────────── */}
            <div className="pb-6 space-y-3">
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
                  onClick={createSession}
                  disabled={migStatus === "creating"}
                  className="flex-1 h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
                  style={{
                    background: "linear-gradient(135deg,#22d3ee,#6366f1)",
                    color: "#fff",
                    boxShadow: "0 4px 24px rgba(34,211,238,0.30)",
                  }}
                  data-testid="button-create-new-session">
                  {migStatus === "creating"
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                    : <>Create New Session <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
              <p className="text-[10px] text-center text-white/20">
                Global data is never modified · Session data starts fresh
              </p>
            </div>

          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — SUMMARY & PROMOTION HANDOFF
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0A1628" }}>
      <PageHeader
        onBack={() => {
          setView("overview");
          setMigStatus("idle");
          setCreatedId(null);
          setErrorMsg("");
        }}
        backDisabled={migStatus === "creating"}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">

          <StepBar current={3} />
          <SessionBanner />

          {/* Success banner */}
          <div className="flex items-center gap-4 px-5 py-4 rounded-xl"
            style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.22)" }}>
            <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-emerald-300">Session created successfully</p>
              <p className="text-[10px] text-white/40 mt-0.5">
                "{newName}" is saved as a Draft
                {createdId ? ` (ID #${createdId})` : ""}
                {" "}· Activate it when you're ready to go live
              </p>
            </div>
          </div>

          {/* ── A. GLOBAL DATA — NOT RESET ────────────────────────────────── */}
          <section className="space-y-3">
            {/* Section header badge */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.22)" }}>
              <Globe className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-[11px] font-black tracking-widest uppercase text-emerald-400">
                  Global Data — Not Reset
                </p>
                <p className="text-[10px] text-emerald-400/50">Session-Independent Frameworks</p>
              </div>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(16,185,129,0.15)", color: "#34d399", border: "1px solid rgba(16,185,129,0.28)" }}>
                {GLOBAL_DATA_ITEMS.length} preserved
              </span>
            </div>

            <div className="rounded-xl overflow-hidden"
              style={{ border: "1px solid rgba(16,185,129,0.16)" }}>
              {GLOBAL_DATA_ITEMS.map((item, idx) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3"
                  style={{
                    borderBottom: idx < GLOBAL_DATA_ITEMS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    background: idx % 2 === 0 ? "rgba(16,185,129,0.02)" : "transparent",
                  }}>
                  <span className="text-sm opacity-60 w-5 text-center flex-shrink-0">{item.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white/65">{item.label}</p>
                    <p className="text-[10px] text-white/25 mt-0.5">{item.detail}</p>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400/50 flex-shrink-0" />
                </div>
              ))}
            </div>

            {/* Explanation note */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[10px]"
              style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.13)", color: "rgba(167,243,208,0.55)" }}>
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-emerald-400/50" />
              <span>
                These modules never reset because they represent <strong className="text-emerald-300/60">permanent global school structures</strong>.
                Even if 10,000 sessions are created, this data remains unchanged.
              </span>
            </div>
          </section>

          {/* ── B. SESSION DATA — RESET ───────────────────────────────────── */}
          <section className="space-y-3">
            {/* Section header badge */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.22)" }}>
              <RefreshCw className="w-4 h-4 text-red-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-[11px] font-black tracking-widest uppercase text-red-400">
                  Session Data — Reset
                </p>
                <p className="text-[10px] text-red-400/50">Fresh Start Operational Logs</p>
              </div>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.22)" }}>
                {FULL_RESET_MODULES.length} full + 2 partial
              </span>
            </div>

            {/* Full resets */}
            <div>
              <p className="text-[9px] font-black tracking-widest uppercase px-1 mb-2"
                style={{ color: "rgba(239,68,68,0.50)" }}>
                Full Resets — {FULL_RESET_MODULES.length} modules
              </p>
              <div className="rounded-xl overflow-hidden"
                style={{ border: "1px solid rgba(239,68,68,0.16)" }}>
                {FULL_RESET_MODULES.map((mod, idx) => (
                  <div key={mod.id} className="flex items-center gap-3 px-4 py-2.5"
                    style={{ borderBottom: idx < FULL_RESET_MODULES.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                    <span className="text-sm opacity-40 w-5 text-center flex-shrink-0">{mod.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white/45">{mod.label}</p>
                      <p className="text-[10px] text-white/22 mt-0.5">{mod.detail}</p>
                    </div>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0"
                      style={{ background: "rgba(239,68,68,0.08)", color: "rgba(248,113,113,0.60)", border: "1px solid rgba(239,68,68,0.16)" }}>
                      Fresh Start
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Partial resets */}
            <div>
              <p className="text-[9px] font-black tracking-widest uppercase px-1 mb-2"
                style={{ color: "rgba(245,158,11,0.50)" }}>
                Partial Resets — 2 modules
              </p>
              <div className="space-y-2">
                {PARTIAL_RESET_MODULES.map(mod => (
                  <div key={mod.id} className="rounded-xl overflow-hidden"
                    style={{ border: "1px solid rgba(245,158,11,0.20)" }}>
                    <div className="flex items-center gap-2.5 px-4 py-2.5"
                      style={{ background: "rgba(245,158,11,0.06)", borderBottom: "1px solid rgba(245,158,11,0.12)" }}>
                      <span className="text-sm opacity-60">{mod.emoji}</span>
                      <p className="text-xs font-bold text-amber-300/70 flex-1">{mod.label}</p>
                    </div>
                    <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <p className="text-[9px] font-black tracking-widest uppercase text-red-400/50 mb-1.5">Cleared for new session</p>
                        {mod.resets.map(r => (
                          <div key={r} className="flex items-center gap-1.5 mb-1">
                            <div className="w-1 h-1 rounded-full bg-red-400/35 flex-shrink-0" />
                            <span className="text-[10px] text-white/35">{r}</span>
                          </div>
                        ))}
                      </div>
                      <div>
                        <p className="text-[9px] font-black tracking-widest uppercase text-emerald-400/50 mb-1.5">Retained (global)</p>
                        {mod.retains.map(r => (
                          <div key={r} className="flex items-center gap-1.5 mb-1">
                            <div className="w-1 h-1 rounded-full bg-emerald-400/35 flex-shrink-0" />
                            <span className="text-[10px] text-white/40">{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── C. ACTION BUTTONS ─────────────────────────────────────────── */}
          <div className="pb-6 space-y-3">
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
                Use <strong>Exam Controller → Promotion Wizard</strong> to advance students into the new session.
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
