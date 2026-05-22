import { useState, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  GraduationCap, ChevronLeft, AlertTriangle, CheckCircle2,
  Clock, Lock, Shield, Users, TrendingUp, UserX, Award,
  Loader2, Play, CheckSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LedgerRow {
  class: string; section: string; term: string;
  status: "none" | "draft" | "locked";
  totalStudents: number; lockedCount: number; manualInterventionCount: number;
  teacherName: string | null; teacherId: number | null;
  lockedAt: string | null; adminExecuted: boolean;
}

interface LedgerDecision {
  studentId: number; decision: string; targetClass: string; targetSection: string;
  autoSuggestion: string | null; manualIntervention: boolean;
  locked: boolean; lockedAt: string | null;
}

interface AggStudent {
  studentId: number; dsid: string; name: string;
  totalObtained: number; totalMax: number; percentage: number; subjects: string[];
  gradeLabel: string | null; gradePoint: string | null; gradeRemarks: string | null;
  tierPassThreshold: number;
  ledger: LedgerDecision | null;
}

interface AggData {
  students: AggStudent[];
  overrides: { studentId: number; overrideStatus: string; nextClass: string; nextSection: string }[];
  missingSubjects: string[];
  passThreshold: number;
}

type AdminDecision = "promote" | "retain" | "grace_pass";
interface AdminOverride { status: AdminDecision; nextClass: string; nextSection: string; }

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  schoolId: number;
  classes: string[];
  sections: string[];
  examTypes: string[];
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function nxtCls(cls: string) {
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
function Chip({ c, icon, label }: { c: ChipColor; icon?: ReactNode; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${CHIP[c]}`}>
      {icon}{label}
    </span>
  );
}

function LedgerBadge({ row }: { row: LedgerRow }) {
  if (row.adminExecuted)  return <Chip c="blue"    icon={<CheckCircle2 className="w-3 h-3"/>} label="Executed" />;
  if (row.status==="locked") return <Chip c="emerald" icon={<Lock className="w-3 h-3"/>}        label="Locked & Ready" />;
  if (row.status==="draft")  return <Chip c="amber"   icon={<Clock className="w-3 h-3"/>}        label="Draft Saved" />;
  return                          <Chip c="slate"   icon={<Clock className="w-3 h-3"/>}          label="Pending Marks" />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExamController({ examTypes }: Props) {
  const { toast } = useToast();

  const [view, setView]                 = useState<"table"|"wizard">("table");
  const [selectedTerm, setSelectedTerm] = useState("");
  const [cohort, setCohort]             = useState<LedgerRow | null>(null);
  const [examType, setExamType]         = useState(examTypes[0] ?? "");
  const [step, setStep]                 = useState<1|2|3>(1);
  const [overrides, setOverrides]       = useState<Record<number, AdminOverride>>({});
  const [confirmed, setConfirmed]       = useState(false);

  // ── Fetch terms list ──────────────────────────────────────────────────────
  const { data: terms = [] } = useQuery<string[]>({
    queryKey: ["/api/admin/ledger-terms"],
    staleTime: 0,
    refetchOnMount: "always",
  });

  // ── Fetch ledger status rows ──────────────────────────────────────────────
  const { data: ledgerRows = [], isLoading: ledgerLoading } = useQuery<LedgerRow[]>({
    queryKey: ["/api/admin/ledger-status", selectedTerm],
    queryFn: async () => {
      if (!selectedTerm) return [];
      const r = await fetch(`/api/admin/ledger-status?term=${encodeURIComponent(selectedTerm)}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!selectedTerm,
    staleTime: 0,
  });

  // ── Fetch aggregated student data (wizard) ────────────────────────────────
  const { data: agg, isLoading: aggLoading } = useQuery<AggData | null>({
    queryKey: ["/api/admin/exam/aggregated", cohort?.class, cohort?.section, examType, cohort?.term],
    queryFn: async () => {
      if (!cohort || !examType) return null;
      const p = new URLSearchParams({ class: cohort.class, section: cohort.section, examType, term: cohort.term });
      const r = await fetch(`/api/admin/exam/aggregated?${p}`, { credentials: "include" });
      return r.ok ? r.json() : null;
    },
    enabled: !!cohort && !!examType,
    staleTime: 0,
  });

  // ── Dynamic counters for step 3 ───────────────────────────────────────────
  const counters = useMemo(() => {
    if (!agg) return { total: 0, promote: 0, retain: 0, grace: 0 };
    let promote = 0, retain = 0, grace = 0;
    for (const s of agg.students) {
      const ov = overrides[s.studentId];
      if (ov?.status === "retain")     { retain++; continue; }
      if (ov?.status === "grace_pass") { grace++;  continue; }
      if (ov?.status === "promote")    { promote++; continue; }
      s.ledger?.decision === "retained" ? retain++ : promote++;
    }
    return { total: agg.students.length, promote, retain, grace };
  }, [agg, overrides]);

  // ── Execute mutation ──────────────────────────────────────────────────────
  const executeMut = useMutation({
    mutationFn: async () => {
      if (!cohort || !agg) throw new Error("No cohort");
      const items = agg.students.map(s => {
        const ov  = overrides[s.studentId];
        const led = s.ledger;
        let nc: string, ns: string;
        if (ov?.status === "retain")        { nc = cohort.class;   ns = cohort.section; }
        else if (ov)                         { nc = ov.nextClass || led?.targetClass || nxtCls(cohort.class); ns = ov.nextSection || led?.targetSection || cohort.section; }
        else if (led?.decision === "retained"){ nc = cohort.class;   ns = cohort.section; }
        else                                 { nc = led?.targetClass || nxtCls(cohort.class); ns = led?.targetSection || cohort.section; }
        return {
          studentId: s.studentId, fromClass: cohort.class, fromSection: cohort.section,
          nextClass: nc, nextSection: ns, examType,
          totalObtained: s.totalObtained, totalMax: s.totalMax, percentage: Math.round(s.percentage),
          gradeLabel: s.gradeLabel ?? null, gradePoint: s.gradePoint ?? null, gradeRemarks: s.gradeRemarks ?? null,
        };
      });
      const res = await apiRequest("POST", "/api/admin/promote", { term: cohort.term, items });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any)?.message ?? "Failed"); }
      return res.json();
    },
    onSuccess: (d) => {
      toast({ title: "✅ Promotion Executed", description: `${d.promoted} student(s) advanced & records archived.`, duration: 5000 });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ledger-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/exam/aggregated"] });
      closeWizard();
    },
    onError: (e: Error) => toast({ title: "Execution failed", description: e.message, variant: "destructive" }),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function openWizard(row: LedgerRow) {
    setCohort(row);
    setExamType(examTypes[0] ?? "");
    setOverrides({}); setConfirmed(false); setStep(1);
    setView("wizard");
  }
  function closeWizard() {
    setView("table"); setCohort(null); setOverrides({}); setConfirmed(false); setStep(1);
  }
  function toggleOverride(studentId: number, dec: AdminDecision, s: AggStudent) {
    setOverrides(prev => {
      if (prev[studentId]?.status === dec) { const n = { ...prev }; delete n[studentId]; return n; }
      const led = s.ledger;
      const nc = dec === "retain" ? (cohort?.class ?? "") : (led?.targetClass || nxtCls(cohort?.class ?? ""));
      const ns = dec === "retain" ? (cohort?.section ?? "") : (led?.targetSection || (cohort?.section ?? ""));
      return { ...prev, [studentId]: { status: dec, nextClass: nc, nextSection: ns } };
    });
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Class",   val: `Class ${cohort.class}` },
              { label: "Section", val: `Section ${cohort.section}` },
              { label: "Term",    val: cohort.term },
            ].map(({ label, val }) => (
              <div key={label} className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">{label}</label>
                <div className="h-10 px-3 rounded-xl border border-[#1e2d44] bg-[#0A1628] flex items-center text-white text-sm font-medium">{val}</div>
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Exam Type <span className="text-amber-400">*</span></label>
              <Select value={examType} onValueChange={setExamType}>
                <SelectTrigger className="bg-[#0A1628] border-[#1e2d44] text-white h-10" data-testid="select-wizard-examtype">
                  <SelectValue placeholder="Select exam type" />
                </SelectTrigger>
                <SelectContent className="bg-[#1A2942] border-[#1e2d44]">
                  {examTypes.map(t => <SelectItem key={t} value={t} className="text-white hover:bg-[#0A1628]">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1">
            {[
              { label: "Total in Ledger",  val: cohort.totalStudents,         icon: <Users className="w-4 h-4 text-[#D4AF37]" /> },
              { label: "Locked Entries",   val: cohort.lockedCount,            icon: <Lock className="w-4 h-4 text-emerald-400" /> },
              { label: "Teacher Overrides",val: cohort.manualInterventionCount, icon: <AlertTriangle className="w-4 h-4 text-amber-400" /> },
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1e2d44]">
                      {["DSID","Name","Marks","%","Teacher Decision","Admin Override"].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agg.students.map((s, idx) => {
                      const led     = s.ledger;
                      const ov      = overrides[s.studentId];
                      const isManual = !!led?.manualIntervention;
                      const thresh  = s.tierPassThreshold ?? agg.passThreshold;
                      const passing = s.percentage >= thresh;
                      return (
                        <tr key={s.studentId}
                          className={`border-b border-[#1e2d44]/50 transition-colors ${isManual ? "bg-amber-500/5 hover:bg-amber-500/10" : idx%2===0 ? "hover:bg-[#0A1628]/30" : "bg-[#0A1628]/20 hover:bg-[#0A1628]/30"}`}
                          data-testid={`row-student-${s.studentId}`}>
                          <td className="px-4 py-3 font-mono text-xs text-slate-300">{s.dsid}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-white">{s.name}</p>
                            {isManual && led && (
                              <p className="text-xs text-amber-400 mt-0.5 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Teacher changed system suggestion from{" "}
                                <strong className="capitalize">{led.autoSuggestion ?? "—"}</strong>
                                {" to "}
                                <strong className="capitalize">{led.decision}</strong>
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-white font-medium">
                            {s.totalObtained}<span className="text-slate-500">/{s.totalMax}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`font-semibold ${passing ? "text-emerald-400" : "text-red-400"}`}>
                              {s.percentage.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {led ? (
                              <Chip
                                c={led.decision === "promoted" ? "emerald" : "red"}
                                icon={led.decision === "promoted" ? <TrendingUp className="w-3 h-3"/> : <UserX className="w-3 h-3"/>}
                                label={led.decision === "promoted" ? "↑ Promote" : "↺ Retain"}
                              />
                            ) : <span className="text-slate-500 text-xs">No ledger</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1.5">
                              {(["promote","retain","grace_pass"] as AdminDecision[]).map(dec => (
                                <button key={dec}
                                  onClick={() => toggleOverride(s.studentId, dec, s)}
                                  data-testid={`btn-override-${dec}-${s.studentId}`}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                                    ov?.status === dec
                                      ? dec==="promote"    ? "bg-emerald-500 border-emerald-500 text-white"
                                      : dec==="retain"     ? "bg-red-500 border-red-500 text-white"
                                      :                      "bg-purple-500 border-purple-500 text-white"
                                      : "bg-transparent border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white"
                                  }`}>
                                  {dec==="promote" ? "Promote" : dec==="retain" ? "Retain" : "Grace"}
                                </button>
                              ))}
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
                  {agg.students.length} student(s) — click an override to change decision; click again to clear
                </p>
                <Button onClick={() => setStep(3)}
                  className="h-9 px-6 font-semibold text-sm"
                  style={{ background: "linear-gradient(135deg,#D4AF37,#b8972e)", color: "#0A1628" }}
                  data-testid="btn-step2-next">
                  Next — Execute Promotion →
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STEP 3: Execute ───────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Aggregate counters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label:"Total Students",   val: counters.total,   color:"text-white",       icon:<Users      className="w-5 h-5 text-[#D4AF37]"     /> },
              { label:"Will Be Promoted", val: counters.promote, color:"text-emerald-400", icon:<TrendingUp className="w-5 h-5 text-emerald-400"    /> },
              { label:"Repeating Year",   val: counters.retain,  color:"text-red-400",     icon:<UserX      className="w-5 h-5 text-red-400"        /> },
              { label:"Grace Passes",     val: counters.grace,   color:"text-purple-400",  icon:<Award      className="w-5 h-5 text-purple-400"     /> },
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

          {/* Per-student summary */}
          {agg && (
            <div className="rounded-2xl border border-[#1e2d44] p-5" style={{ background:"#1A2942" }}>
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-[#D4AF37]" />Final Promotion Summary
              </h3>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {agg.students.map(s => {
                  const ov  = overrides[s.studentId];
                  const led = s.ledger;
                  let fin: AdminDecision;
                  if (ov)                            fin = ov.status;
                  else if (led?.decision==="retained") fin = "retain";
                  else                               fin = "promote";
                  const destCls = fin==="retain" ? cohort.class : (led?.targetClass || nxtCls(cohort.class));
                  const destLabel = fin==="retain"
                    ? `Retained in Class ${cohort.class}`
                    : `→ Class ${destCls}`;
                  return (
                    <div key={s.studentId} className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-[#0A1628]/50">
                      <span className="text-slate-300">{s.name} <span className="text-slate-500 font-mono">({s.dsid})</span></span>
                      <Chip
                        c={fin==="promote" ? "emerald" : fin==="retain" ? "red" : "purple"}
                        icon={fin==="promote" ? <TrendingUp className="w-3 h-3"/> : fin==="retain" ? <UserX className="w-3 h-3"/> : <Award className="w-3 h-3"/>}
                        label={fin==="grace_pass" ? `Grace ${destLabel}` : destLabel}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Confirmation + execute button */}
          <div className="rounded-2xl border border-[#1e2d44] p-5 space-y-4" style={{ background:"#1A2942" }}>
            <div className="flex items-start gap-3">
              <Checkbox id="exec-confirm" checked={confirmed} onCheckedChange={v => setConfirmed(!!v)}
                className="mt-0.5 border-slate-500 data-[state=checked]:bg-[#D4AF37] data-[state=checked]:border-[#D4AF37]"
                data-testid="checkbox-confirm-execute" />
              <label htmlFor="exec-confirm" className="text-sm text-slate-300 leading-relaxed cursor-pointer select-none">
                I confirm this will <strong className="text-white">permanently update the class and section</strong> for{" "}
                <strong className="text-[#D4AF37]">{counters.promote + counters.grace}</strong> promoted student(s) and archive their academic records.{" "}
                <span className="text-red-400 font-semibold">This action cannot be undone.</span>
              </label>
            </div>
            <div className="flex items-center justify-between pt-1">
              <Button variant="outline" className="border-[#1e2d44] text-slate-400 hover:bg-[#0A1628] h-9"
                onClick={() => setStep(2)} data-testid="btn-step3-back">
                ← Back to Review
              </Button>
              <Button
                disabled={!confirmed || executeMut.isPending || !agg || agg.students.length===0}
                onClick={() => executeMut.mutate()}
                className="h-9 px-8 font-bold text-sm"
                style={{ background: confirmed ? "linear-gradient(135deg,#D4AF37,#b8972e)" : undefined, color: confirmed ? "#0A1628" : undefined }}
                data-testid="btn-execute-promotion">
                {executeMut.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Executing…</>
                  : <><CheckSquare className="w-4 h-4 mr-2"/>Execute Promotion</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────────
  // VIEW A — Global Class Status Table
  // ────────────────────────────────────────────────────────────────────────────
  const readyCount = ledgerRows.filter(r => r.status==="locked" && !r.adminExecuted).length;
  const doneCount  = ledgerRows.filter(r => r.adminExecuted).length;

  return (
    <div className="space-y-5">

      {/* Header */}
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
        {selectedTerm && ledgerRows.length > 0 && (
          <div className="flex gap-2">
            <Chip c="emerald" icon={<Lock className="w-3 h-3"/>}          label={`${readyCount} Ready`} />
            <Chip c="blue"    icon={<CheckCircle2 className="w-3 h-3"/>}   label={`${doneCount} Executed`} />
          </div>
        )}
      </div>

      {/* Term selector */}
      <div className="rounded-2xl border border-[#1e2d44] p-5" style={{ background:"#1A2942" }}>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Select Promotion Term</label>
        <div className="flex items-center gap-4 flex-wrap">
          <Select value={selectedTerm} onValueChange={setSelectedTerm}>
            <SelectTrigger className="bg-[#0A1628] border-[#1e2d44] text-white h-10 w-80" data-testid="select-ledger-term">
              <SelectValue placeholder="Choose a term to view ledger status…" />
            </SelectTrigger>
            <SelectContent className="bg-[#1A2942] border-[#1e2d44]">
              {terms.map(t => <SelectItem key={t} value={t} className="text-white hover:bg-[#0A1628]">{t}</SelectItem>)}
            </SelectContent>
          </Select>
          {terms.length === 0 && (
            <p className="text-xs text-slate-500 italic">No terms found — teachers must save promotion ledgers first.</p>
          )}
        </div>
      </div>

      {/* Status table */}
      {selectedTerm && (
        <div className="rounded-2xl border border-[#1e2d44] overflow-hidden" style={{ background:"#1A2942" }}>
          <div className="px-5 py-4 border-b border-[#1e2d44] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-[#D4AF37]" />
              Ledger Status — {selectedTerm}
            </h2>
            <span className="text-xs text-slate-400">{ledgerRows.length} class-section(s) on record</span>
          </div>

          {ledgerLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading…</span>
            </div>
          ) : ledgerRows.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-25" />
              <p className="text-sm">No ledger entries found for <strong className="text-white">{selectedTerm}</strong>.</p>
              <p className="text-xs mt-1">Teachers must run auto-suggestion and save their promotion ledgers first.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e2d44]">
                    {["Class / Section","Ledger Status","Submitted By","Students","Interventions","Action"].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((row, idx) => (
                    <tr key={`${row.class}-${row.section}`}
                      className={`border-b border-[#1e2d44]/50 ${idx%2!==0 ? "bg-[#0A1628]/25" : ""}`}
                      data-testid={`row-ledger-${row.class}-${row.section}`}>
                      <td className="px-5 py-3.5">
                        <span className="font-semibold text-white">Class {row.class}</span>
                        <span className="text-slate-400"> — Sec {row.section}</span>
                      </td>
                      <td className="px-5 py-3.5"><LedgerBadge row={row} /></td>
                      <td className="px-5 py-3.5">
                        {row.teacherName ? (
                          <div>
                            <p className="text-white text-xs font-medium">{row.teacherName}</p>
                            <p className="text-slate-500 text-xs">{fmt(row.lockedAt)}</p>
                          </div>
                        ) : <span className="text-slate-500 text-xs">—</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-white font-semibold">{row.lockedCount}</span>
                        <span className="text-slate-500"> / {row.totalStudents}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {row.manualInterventionCount > 0 ? (
                          <Chip c="amber" icon={<AlertTriangle className="w-3 h-3"/>}
                            label={`${row.manualInterventionCount} Override${row.manualInterventionCount>1?"s":""}`} />
                        ) : <span className="text-slate-500 text-xs">None</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        {row.adminExecuted ? (
                          <Button size="sm" variant="outline"
                            className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10 text-xs h-8"
                            onClick={() => openWizard(row)}
                            data-testid={`btn-view-${row.class}-${row.section}`}>
                            View Results
                          </Button>
                        ) : row.status === "locked" ? (
                          <Button size="sm" className="text-xs h-8 font-semibold px-4"
                            style={{ background:"linear-gradient(135deg,#D4AF37,#b8972e)", color:"#0A1628" }}
                            onClick={() => openWizard(row)}
                            data-testid={`btn-review-${row.class}-${row.section}`}>
                            <Play className="w-3 h-3 mr-1.5"/>Review & Execute
                          </Button>
                        ) : (
                          <Button size="sm" disabled variant="outline"
                            className="border-slate-700 text-slate-600 text-xs h-8"
                            data-testid={`btn-awaiting-${row.class}-${row.section}`}>
                            Awaiting Lock
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
