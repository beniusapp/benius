import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  GraduationCap, ChevronLeft, AlertTriangle, CheckCircle2,
  Clock, Lock, Shield, Users, TrendingUp, UserX, Award,
  Loader2, Play, CheckSquare, RefreshCw, Trash2,
  Bell, Search, ChevronDown, ChevronRight,
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
function Chip({ c, icon, label }: { c: ChipColor; icon?: ReactNode; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${CHIP[c]}`}>
      {icon}{label}
    </span>
  );
}

function LedgerBadge({ row }: { row: LedgerRow }) {
  if (row.adminExecuted)       return <Chip c="blue"    icon={<CheckCircle2 className="w-3 h-3"/>} label="Executed" />;
  if (row.status === "locked") return <Chip c="emerald" icon={<Lock className="w-3 h-3"/>}         label="Locked & Ready" />;
  if (row.status === "draft")  return <Chip c="amber"   icon={<Clock className="w-3 h-3"/>}         label="In Progress" />;
  return                              <Chip c="slate"   icon={<Clock className="w-3 h-3"/>}         label="Not Started" />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExamController({ examTypes, classes: schoolClasses }: Props) {
  const { toast } = useToast();

  // ── Core view state ───────────────────────────────────────────────────────
  const [view, setView]                 = useState<"table"|"wizard">("table");
  const [selectedTerm, setSelectedTerm] = useState("");
  const [cohort, setCohort]             = useState<LedgerRow | null>(null);
  const [examType, setExamType]         = useState(examTypes[0] ?? "");
  const [step, setStep]                 = useState<1|2|3>(1);
  const [overrides, setOverrides]       = useState<Record<number, AdminOverride>>({});
  const [confirmed, setConfirmed]       = useState(false);

  // ── Filter + accordion state ──────────────────────────────────────────────
  const [searchText, setSearchText]         = useState("");
  const [filterClass, setFilterClass]       = useState("all");
  const [filterSection, setFilterSection]   = useState("all");
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [remindingKey, setRemindingKey]     = useState("");
  const [termToDelete, setTermToDelete]     = useState<string | null>(null);

  // ── Fetch terms list ──────────────────────────────────────────────────────
  const { data: terms = [], refetch: refetchTerms } = useQuery<string[]>({
    queryKey: ["/api/admin/ledger-terms"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Auto-select first term when terms load
  useEffect(() => {
    if (!selectedTerm && terms.length > 0) setSelectedTerm(terms[0]);
  }, [terms, selectedTerm]);

  // ── Fetch ledger status rows ──────────────────────────────────────────────
  const { data: ledgerRows = [], isLoading: ledgerLoading, refetch: refetchLedger } = useQuery<LedgerRow[]>({
    queryKey: ["/api/admin/ledger-status", selectedTerm],
    queryFn: async () => {
      if (!selectedTerm) return [];
      const r = await fetch(`/api/admin/ledger-status?term=${encodeURIComponent(selectedTerm)}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!selectedTerm,
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
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // ── Delete term mutation ──────────────────────────────────────────────────
  const deleteTermMut = useMutation({
    mutationFn: async (term: string) => {
      const res = await apiRequest("DELETE", `/api/admin/ledger-term/${encodeURIComponent(term)}`);
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
      const res = await apiRequest("POST", "/api/admin/send-ledger-reminder", { className, section, term: selectedTerm });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any)?.message ?? "Failed"); }
      return res.json();
    },
    onSuccess: (d) => { toast({ title: "✉ Reminder Sent", description: d.message }); setRemindingKey(""); },
    onError: (e: Error) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); setRemindingKey(""); },
  });

  const reminderAllMut = useMutation({
    mutationFn: async (term: string) => {
      const res = await apiRequest("POST", "/api/admin/send-ledger-reminder-all", { term });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any)?.message ?? "Failed"); }
      return res.json();
    },
    onSuccess: (d) => toast({ title: "✉ Bulk Reminders Sent", description: d.message }),
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Execute mutation ──────────────────────────────────────────────────────
  const executeMut = useMutation({
    mutationFn: async () => {
      if (!cohort || !agg) throw new Error("No cohort");
      const items = agg.students.map(s => {
        const ov  = overrides[s.studentId];
        const led = s.ledger;
        let nc: string, ns: string;
        if (ov?.status === "retain")         { nc = cohort.class;   ns = cohort.section; }
        else if (ov)                          { nc = ov.nextClass || led?.targetClass || nxtCls(cohort.class, schoolClasses); ns = ov.nextSection || led?.targetSection || cohort.section; }
        else if (led?.decision === "retained"){ nc = cohort.class;   ns = cohort.section; }
        else                                  { nc = led?.targetClass || nxtCls(cohort.class, schoolClasses); ns = led?.targetSection || cohort.section; }
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

  // ── KPI stats ─────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const totalClasses   = new Set(ledgerRows.map(r => r.class)).size;
    const totalSections  = ledgerRows.length;
    const lockedReady    = ledgerRows.filter(r => r.status === "locked" && !r.adminExecuted).length;
    const executed       = ledgerRows.filter(r => r.adminExecuted).length;
    const inProgress     = ledgerRows.filter(r => r.status === "draft").length;
    const notStarted     = ledgerRows.filter(r => r.status === "none").length;
    const pending        = inProgress + notStarted;
    return { totalClasses, totalSections, lockedReady, executed, inProgress, notStarted, pending };
  }, [ledgerRows]);

  // ── Filter options ────────────────────────────────────────────────────────
  const allClassOptions = useMemo(() => [...new Set(ledgerRows.map(r => r.class))], [ledgerRows]);
  const allSectionOptions = useMemo(() => {
    const base = filterClass === "all" ? ledgerRows : ledgerRows.filter(r => r.class === filterClass);
    return [...new Set(base.map(r => r.section))].sort();
  }, [ledgerRows, filterClass]);

  // ── Filtered + grouped rows ───────────────────────────────────────────────
  const filteredRows = useMemo(() => ledgerRows.filter(row => {
    if (filterClass !== "all" && row.class !== filterClass) return false;
    if (filterSection !== "all" && row.section !== filterSection) return false;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      if (!row.class.toLowerCase().includes(q) &&
          !row.section.toLowerCase().includes(q) &&
          !(row.teacherName?.toLowerCase().includes(q) ?? false)) return false;
    }
    return true;
  }), [ledgerRows, filterClass, filterSection, searchText]);

  const groupedRows = useMemo(() => {
    const groups: Record<string, LedgerRow[]> = {};
    for (const row of filteredRows) {
      if (!groups[row.class]) groups[row.class] = [];
      groups[row.class].push(row);
    }
    return groups;
  }, [filteredRows]);

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

  // ── Helpers ───────────────────────────────────────────────────────────────
  function handleRefresh() { refetchTerms(); if (selectedTerm) refetchLedger(); }
  function toggleClass(cls: string) {
    setExpandedClasses(prev => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls); else next.add(cls);
      return next;
    });
  }
  function openWizard(row: LedgerRow) {
    setCohort(row); setExamType(examTypes[0] ?? "");
    setOverrides({}); setConfirmed(false); setStep(1); setView("wizard");
  }
  function closeWizard() {
    setView("table"); setCohort(null); setOverrides({}); setConfirmed(false); setStep(1);
  }
  function toggleOverride(studentId: number, dec: AdminDecision, s: AggStudent) {
    setOverrides(prev => {
      if (prev[studentId]?.status === dec) { const n = { ...prev }; delete n[studentId]; return n; }
      const led = s.ledger;
      const nc = dec === "retain" ? (cohort?.class ?? "") : (led?.targetClass || nxtCls(cohort?.class ?? "", schoolClasses));
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
                      const led      = s.ledger;
                      const ov       = overrides[s.studentId];
                      const isManual = !!led?.manualIntervention;
                      const thresh   = s.tierPassThreshold ?? agg.passThreshold;
                      const passing  = s.percentage >= thresh;
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
                                Teacher changed from{" "}
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
                                  {dec === "promote" ? "↑ Promote" : dec === "retain" ? "↺ Retain" : "✦ Grace"}
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
                  {agg.students.length} student(s) — click override to change; click again to clear
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
                  if (ov)                             fin = ov.status;
                  else if (led?.decision==="retained") fin = "retain";
                  else                                fin = "promote";
                  const destCls = fin==="retain" ? cohort.class : (led?.targetClass || nxtCls(cohort.class, schoolClasses));
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
              {kpi.lockedReady > 0 && <Chip c="emerald" icon={<Lock className="w-3 h-3"/>}        label={`${kpi.lockedReady} Ready`} />}
              {kpi.executed > 0    && <Chip c="blue"    icon={<CheckCircle2 className="w-3 h-3"/>} label={`${kpi.executed} Executed`} />}
              {kpi.pending > 0     && <Chip c="amber"   icon={<Clock className="w-3 h-3"/>}        label={`${kpi.pending} Pending`} />}
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
          <Select value={selectedTerm} onValueChange={v => { setSelectedTerm(v); setTermToDelete(null); setSearchText(""); setFilterClass("all"); setFilterSection("all"); }}>
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
                <button onClick={() => deleteTermMut.mutate(selectedTerm)} disabled={deleteTermMut.isPending}
                  className="text-xs font-semibold text-red-300 hover:text-white border border-red-500/50 px-2 py-0.5 rounded"
                  data-testid="btn-confirm-delete-term">
                  {deleteTermMut.isPending ? "Deleting…" : "Yes, Delete"}
                </button>
                <button onClick={() => setTermToDelete(null)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setTermToDelete(selectedTerm)}
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Classes",    val: kpi.totalClasses,  color: "text-white",       icon: <GraduationCap className="w-5 h-5 text-[#D4AF37]" /> },
                { label: "Total Sections",   val: kpi.totalSections, color: "text-white",       icon: <Users className="w-5 h-5 text-blue-400" /> },
                { label: "Ready to Advance", val: kpi.lockedReady,   color: "text-emerald-400", icon: <Lock className="w-5 h-5 text-emerald-400" /> },
                { label: "Pending Ledgers",  val: kpi.pending,       color: "text-amber-400",   icon: <AlertTriangle className="w-5 h-5 text-amber-400" /> },
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
                <Select value={filterClass} onValueChange={v => { setFilterClass(v); setFilterSection("all"); }}>
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
                {/* Send All Pending */}
                {kpi.pending > 0 && (
                  <Button size="sm" onClick={() => reminderAllMut.mutate(selectedTerm)}
                    disabled={reminderAllMut.isPending}
                    className="h-9 px-3 text-xs font-semibold ml-auto"
                    style={{ background:"linear-gradient(135deg,#f59e0b,#d97706)", color:"#0A1628" }}
                    data-testid="btn-send-reminder-all">
                    {reminderAllMut.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      : <Bell className="w-3.5 h-3.5 mr-1.5" />}
                    Remind All Pending ({kpi.pending})
                  </Button>
                )}
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
                const isExpanded    = expandedClasses.has(cls);
                const clsLocked     = rows.filter(r => r.status === "locked" || r.adminExecuted).length;
                const clsInProgress = rows.filter(r => r.status === "draft").length;
                const clsNotStarted = rows.filter(r => r.status === "none").length;

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
                        {clsLocked > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            {clsLocked} Ready
                          </span>
                        )}
                        {clsInProgress > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            {clsInProgress} In Progress
                          </span>
                        )}
                        {clsNotStarted > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-slate-500/20 text-slate-400 border border-slate-500/30">
                            {clsNotStarted} Not Started
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
                          const isPending = row.status !== "locked" && !row.adminExecuted;
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

                              {/* Status badge */}
                              <div className="w-36 shrink-0">
                                <LedgerBadge row={row} />
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
                                  <Button size="sm" variant="outline"
                                    className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10 text-xs h-8"
                                    onClick={() => openWizard(row)}
                                    data-testid={`btn-view-${row.class}-${row.section}`}>
                                    View Results
                                  </Button>
                                ) : row.status === "locked" ? (
                                  <Button size="sm"
                                    className="text-xs h-8 font-semibold px-3"
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
