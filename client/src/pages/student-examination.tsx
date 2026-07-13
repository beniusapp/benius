import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, GraduationCap, Loader2, ClipboardList, Printer,
  AlertTriangle, TrendingUp, Trophy, Award, BookOpen,
  CalendarDays, BarChart3, ChevronDown, Filter, X,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

// ─────────────────────────── Types ─────────────────────────────────────────────
interface AcademicSession {
  id: number; sessionName: string; startDate: string; endDate: string;
  isActive: boolean; schoolId: number;
}
interface StudentMeResponse {
  id: number; name: string; digitalStudentId: string;
  class: string; section: string; schoolName: string; schoolCode: string;
  schoolId: number;
}
interface ExamScore {
  id: number; subject: string; examType: string;
  marks: number; totalMarks: number; passMarks: number;
  isAbsent: boolean; class: string | null; section: string | null;
  published: boolean;
}
interface ExamPolicyTier {
  id: number; tierName: string; applicableClasses: string[];
  examWeights: string; promotionFailRules: string; passPercentage?: number;
}
interface AttendanceStatsResponse {
  overallPercent: number; workingDays: number; daysPresent: number;
}

// Enrollment registry — one record per student per academic session
interface EnrollmentRecord {
  id: number;
  sessionId: number;
  className: string;
  sectionName: string;
  status: string;
}

// Resolved session metadata — class/section verified from enrollment table when possible
type SessionMeta = AcademicSession & {
  cls: string;       // resolved class for this session
  section: string;   // resolved section for this session
  displayLabel: string;
  verified: boolean; // true = from enrollment registry; false = arithmetic estimate
};

// ─────────────────────────── Computation Types ──────────────────────────────────
interface CompBreakdown {
  sourceExam: string; weight: number;
  marks: number | null; totalMarks: number | null;
  pct: number | null; contribution: number | null;
  isAbsent: boolean; status: "scored" | "absent" | "missing";
}
interface SubjectTermResult {
  subject: string; percentage: number | null; passed: boolean | null;
  breakdown: CompBreakdown[]; status: "scored" | "absent" | "incomplete";
}
interface StudentTermResults {
  termResults: Record<string, SubjectTermResult[]>;
  allTermFailCounts: Record<string, number>;
}

// ─────────────────── Enrollment-aware Session→Class Resolution ──────────────────
// Priority: verified enrollment record → arithmetic progression fallback.
// The enrollment registry (`/api/student/exam/enrollment-history`) stores the
// student's exact class+section per session.  When that data is present it is
// used verbatim (verified=true).  When absent the function falls back to the
// traditional "currentClass - i" arithmetic, marked verified=false, so the UI
// can surface the uncertainty to the user.
function resolveSessionsWithEnrollments(
  sessions: AcademicSession[],
  enrollments: EnrollmentRecord[],
  currentClass: string,
  currentSection: string,
): SessionMeta[] {
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
  );
  const enrollMap = new Map<number, EnrollmentRecord>(enrollments.map(e => [e.sessionId, e]));
  const currentNum = parseInt(currentClass, 10);
  const result: SessionMeta[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const rec = enrollMap.get(s.id);

    if (rec) {
      // ── Verified: enrollment registry has an authoritative record
      result.push({
        ...s,
        cls: rec.className,
        section: rec.sectionName,
        displayLabel: s.sessionName,
        verified: true,
      });
    } else {
      // ── Estimated: use arithmetic class progression as best guess
      const cls = isNaN(currentNum)
        ? (i === 0 ? currentClass : "")
        : String(currentNum - i);
      if (!isNaN(currentNum) && parseInt(cls, 10) < 1) break;
      if (cls === "") break;
      result.push({
        ...s,
        cls,
        section: currentSection,
        displayLabel: s.sessionName,
        verified: false,
      });
    }
  }
  return result;
}

// ─────────────────────────── Term Computation ──────────────────────────────────
function computeStudentTermResults(
  scores: ExamScore[], policy: ExamPolicyTier, passThreshold = 35,
): StudentTermResults {
  let rawWeights: Record<string, { source_exam: string; weight: number }[]> = {};
  try { rawWeights = JSON.parse(policy.examWeights || "{}"); } catch {}
  const termNames = Object.keys(rawWeights).map(k => k.trim());

  const bySubject: Record<string, ExamScore[]> = {};
  for (const sc of scores) {
    if (!bySubject[sc.subject]) bySubject[sc.subject] = [];
    bySubject[sc.subject].push(sc);
  }
  const subjects = Object.keys(bySubject).sort();

  const termResults: Record<string, SubjectTermResult[]> = {};
  const allTermFailCounts: Record<string, number> = {};

  for (const termName of termNames) {
    const components = rawWeights[termName] || [];
    const subjectResults: SubjectTermResult[] = subjects.map(subject => {
      const subjectScores = bySubject[subject];
      let weightedSum = 0, totalWeight = 0;
      let hasAbsent = false, hasData = false;

      const breakdown: CompBreakdown[] = components.map(comp => {
        const record = subjectScores.find(s => s.examType === comp.source_exam);
        if (!record) return {
          sourceExam: comp.source_exam, weight: comp.weight,
          marks: null, totalMarks: null, pct: null, contribution: null,
          isAbsent: false, status: "missing" as const,
        };
        hasData = true;
        if (record.isAbsent) {
          hasAbsent = true;
          return {
            sourceExam: comp.source_exam, weight: comp.weight,
            marks: 0, totalMarks: record.totalMarks, pct: null, contribution: null,
            isAbsent: true, status: "absent" as const,
          };
        }
        const pct = record.totalMarks > 0 ? (record.marks / record.totalMarks) * 100 : 0;
        const contribution = pct * (comp.weight / 100);
        weightedSum += contribution;
        totalWeight += comp.weight;
        return {
          sourceExam: comp.source_exam, weight: comp.weight,
          marks: record.marks, totalMarks: record.totalMarks, pct, contribution,
          isAbsent: false, status: "scored" as const,
        };
      });

      let percentage: number | null = null;
      let status: SubjectTermResult["status"] = "incomplete";
      if (!hasData) { status = "incomplete"; }
      else if (hasAbsent) { status = "absent"; percentage = 0; }
      else {
        percentage = Math.round(((totalWeight > 0 ? (weightedSum * 100) / totalWeight : 0)) * 10) / 10;
        status = "scored";
      }
      return {
        subject, percentage,
        passed: percentage !== null ? percentage >= passThreshold : null,
        breakdown, status,
      };
    });

    termResults[termName] = subjectResults;
    allTermFailCounts[termName] = subjectResults.filter(s => s.passed === false).length;
  }
  return { termResults, allTermFailCounts };
}

// ─────────────────────────── Helpers ───────────────────────────────────────────
function computeGrade(pct: number) {
  if (pct >= 90) return { label: "A+", color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/30", remarks: "Outstanding" };
  if (pct >= 80) return { label: "A",  color: "text-green-400",   bg: "bg-green-500/15 border-green-500/30",   remarks: "Excellent" };
  if (pct >= 70) return { label: "B+", color: "text-teal-400",    bg: "bg-teal-500/15 border-teal-500/30",    remarks: "Very Good" };
  if (pct >= 60) return { label: "B",  color: "text-blue-400",    bg: "bg-blue-500/15 border-blue-500/30",    remarks: "Good" };
  if (pct >= 50) return { label: "C+", color: "text-yellow-400",  bg: "bg-yellow-500/15 border-yellow-500/30", remarks: "Average" };
  if (pct >= 40) return { label: "C",  color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/30",  remarks: "Below Average" };
  if (pct >= 33) return { label: "D",  color: "text-orange-400",  bg: "bg-orange-500/15 border-orange-500/30", remarks: "Poor" };
  return { label: "F", color: "text-red-400", bg: "bg-red-500/15 border-red-500/30", remarks: "Fail" };
}

function PrintStyles() {
  return (
    <style>{`
      @media print {
        body * { visibility: hidden !important; }
        #exam-print-area, #exam-print-area * { visibility: visible !important; }
        #exam-print-area { position: fixed; top: 0; left: 0; width: 100%; padding: 20px; background: #fff; color: #000; }
        .no-print { display: none !important; }
      }
    `}</style>
  );
}

// ─────────────────────────── Score status badge ─────────────────────────────────
function StatusBadge({ score }: { score: ExamScore | undefined }) {
  if (!score) return <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-700/40 text-slate-500 border border-slate-700">Pending</span>;
  if (score.isAbsent) return <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-orange-500/15 text-orange-400 border border-orange-500/30">Absent</span>;
  const pct = score.totalMarks > 0 ? (score.marks / score.totalMarks) * 100 : 0;
  return pct >= (score.passMarks / score.totalMarks * 100)
    ? <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Pass</span>
    : <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/15 text-red-400 border border-red-500/30">Fail</span>;
}

// ─────────────────────────── Shared dropdown style ─────────────────────────────
const selectCls = [
  "w-full h-10 rounded-xl border px-3 pr-9 text-sm text-white appearance-none cursor-pointer",
  "focus:outline-none focus:border-yellow-500/40 transition-colors",
].join(" ");
const selectStyle = { background: "#020617", borderColor: "#1e293b", colorScheme: "dark" } as const;

// ══════════════════════════════════════════════════════════════════════════════
// VIEW MARKS PANEL
// Two-column filter row (Subject + Exam Type) → three display modes
// Mode A: subject only  → per-exam-type row table
// Mode B: exam type only → per-subject row table
// Mode C: subject + exam type → single focused result card
// ══════════════════════════════════════════════════════════════════════════════
function ViewMarksPanel({
  allScores, policy, passThreshold, isLoading, selectedClass, section,
}: {
  allScores: ExamScore[]; policy: ExamPolicyTier | null; passThreshold: number;
  isLoading: boolean; selectedClass: string; section: string;
}) {
  const [viewSubject,  setViewSubject]  = useState("");
  const [viewExamType, setViewExamType] = useState("");

  // ── Derive dropdown options strictly from actual score data ──────────────────
  // Using real score subjects/exam-types instead of school config guarantees
  // historical accuracy — no current-schema bleed into past sessions.
  const subjectOptions  = useMemo(
    () => [...new Set(allScores.map(s => s.subject))].sort(),
    [allScores],
  );
  const examTypeOptions = useMemo(
    () => [...new Set(allScores.map(s => s.examType))].sort(),
    [allScores],
  );

  // Reset both filters when the session (class) changes
  useEffect(() => { setViewSubject(""); setViewExamType(""); }, [selectedClass]);

  // ── Parse policy term contributions ──────────────────────────────────────────
  const termComponents = useMemo<Record<string, { source_exam: string; weight: number }[]>>(() => {
    if (!policy) return {};
    try { return JSON.parse(policy.examWeights || "{}"); } catch { return {}; }
  }, [policy]);

  /** For a given examType, which terms use it and at what weight */
  function termContributionsFor(et: string) {
    const result: { termName: string; weight: number }[] = [];
    for (const [termName, comps] of Object.entries(termComponents)) {
      const comp = comps.find(c => c.source_exam === et);
      if (comp) result.push({ termName: termName.trim(), weight: comp.weight });
    }
    return result;
  }

  // ── Determine mode ───────────────────────────────────────────────────────────
  type FilterMode = "A" | "B" | "C" | null;
  const mode: FilterMode =
    viewSubject && viewExamType ? "C"
    : viewSubject                ? "A"
    : viewExamType               ? "B"
    : null;

  // ── Utility ─────────────────────────────────────────────────────────────────
  function scoreFor(subject: string, examType: string): ExamScore | undefined {
    return allScores.find(s => s.subject === subject && s.examType === examType);
  }

  function renderPct(score: ExamScore | undefined) {
    if (!score || score.isAbsent) return null;
    return score.totalMarks > 0 ? Math.round((score.marks / score.totalMarks) * 1000) / 10 : 0;
  }

  // ── Shared: the two-column filter row ────────────────────────────────────────
  const filterRow = (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: "#0f172a", border: "1px solid #1e293b" }}>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-yellow-400" />
          <h2 className="text-sm font-bold text-white">View Marks — 360° History</h2>
        </div>
        {mode && (
          <button onClick={() => { setViewSubject(""); setViewExamType(""); }}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
            data-testid="btn-clear-filters">
            <X className="w-3.5 h-3.5" /> Clear filters
          </button>
        )}
      </div>

      {/* Two-column dropdown row */}
      <div className="grid grid-cols-2 gap-3">
        {/* Subject */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Subject</label>
          <div className="relative">
            <select value={viewSubject} onChange={e => setViewSubject(e.target.value)}
              className={selectCls} style={selectStyle} data-testid="select-subject">
              <option value="">All Subjects</option>
              {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          </div>
        </div>

        {/* Exam Type */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Exam Type</label>
          <div className="relative">
            <select value={viewExamType} onChange={e => setViewExamType(e.target.value)}
              className={selectCls} style={selectStyle} data-testid="select-exam-type">
              <option value="">All Exam Types</option>
              {examTypeOptions.map(et => <option key={et} value={et}>{et}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          </div>
        </div>
      </div>

      {/* Active filter chips */}
      {mode && (
        <div className="flex flex-wrap gap-2 pt-1">
          {viewSubject && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399" }}>
              <BookOpen className="w-3 h-3" /> {viewSubject}
            </span>
          )}
          {viewExamType && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{ background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.3)", color: "#fbbf24" }}>
              <Award className="w-3 h-3" /> {viewExamType}
            </span>
          )}
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] text-slate-500"
            style={{ border: "1px solid #1e293b" }}>
            {mode === "A" ? "Showing all exams for selected subject"
              : mode === "B" ? "Showing all subjects for selected exam"
              : "Showing exact result for selected combination"}
          </span>
        </div>
      )}
    </div>
  );

  // ── Inline results loading node (filter form always visible above) ───────────
  const resultsLoadingNode = (
    <div className="flex justify-center py-14">
      <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
    </div>
  );

  // ── No filter selected — prompt ───────────────────────────────────────────────
  if (!mode) return (
    <div className="space-y-4" data-testid="panel-view-marks">
      {filterRow}
      {isLoading ? resultsLoadingNode : (
        <div className="rounded-2xl p-10 flex flex-col items-center gap-3 text-center"
          style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
          <BarChart3 className="w-8 h-8 text-slate-700" />
          <p className="text-slate-400 font-semibold text-sm">Select a subject, an exam type, or both</p>
          <p className="text-slate-600 text-xs max-w-xs">
            Pick a subject to see all your exam history for it, pick an exam type to see all subjects in that test cycle, or pick both for a focused result.
          </p>
        </div>
      )}
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // MODE A — Subject selected only: show all exam types as rows
  // ══════════════════════════════════════════════════════════════════════════════
  if (isLoading) return (
    <div className="space-y-4" data-testid="panel-view-marks-loading">
      {filterRow}
      {resultsLoadingNode}
    </div>
  );

  // ── Empty state — no scores for this compound key (session + class) ──────────
  // Strict guard: never fall through to display empty arrays or wrong-session data.
  if (allScores.length === 0) return (
    <div className="rounded-2xl p-12 flex flex-col items-center gap-4 text-center no-print"
      data-testid="panel-no-scores"
      style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(100,116,139,0.1)", border: "1px solid #1e293b" }}>
        <ClipboardList className="w-7 h-7 text-slate-600" />
      </div>
      <div className="space-y-1">
        <h3 className="text-slate-300 font-bold text-base">No marks data for this session</h3>
        <p className="text-slate-500 text-sm">
          No exam records found for Class {selectedClass}‑{section}.
        </p>
        <p className="text-slate-600 text-xs mt-2 max-w-xs mx-auto">
          Your teacher has not yet entered scores for this academic year,
          or this class had no exams recorded in the system.
        </p>
      </div>
    </div>
  );

  if (mode === "A") {
    const rows = examTypeOptions.map(et => {
      const score = scoreFor(viewSubject, et);
      const pct   = renderPct(score);
      const g     = pct !== null ? computeGrade(pct) : null;
      const contribs = termContributionsFor(et);
      return { et, score, pct, g, contribs };
    });

    const scored = rows.filter(r => r.score && !r.score.isAbsent);
    const avgPct = scored.length > 0
      ? Math.round(scored.reduce((s, r) => s + (r.pct ?? 0), 0) / scored.length * 10) / 10
      : null;
    const bestRow = scored.reduce<typeof rows[number] | null>(
      (best, r) => (!best || (r.pct ?? 0) > (best.pct ?? 0)) ? r : best, null,
    );

    return (
      <div className="space-y-4" data-testid="panel-view-marks-mode-a">
        {filterRow}

        {/* Summary strip */}
        {scored.length > 0 && (
          <div className="grid grid-cols-3 gap-px rounded-2xl overflow-hidden" style={{ border: "1px solid #1e293b", background: "#1e293b" }}>
            {[
              { label: "Exams Taken", value: `${scored.length} / ${examTypeOptions.length}`, color: "text-white" },
              { label: "Average %",   value: avgPct !== null ? `${avgPct}%` : "—",
                color: avgPct !== null ? (avgPct >= 60 ? "text-emerald-400" : avgPct >= 33 ? "text-yellow-400" : "text-red-400") : "text-slate-600" },
              { label: "Best Exam",   value: bestRow ? `${bestRow.et} · ${bestRow.pct}%` : "—", color: "text-yellow-400" },
            ].map(s => (
              <div key={s.label} className="px-4 py-3" style={{ background: "#0f172a" }}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">{s.label}</p>
                <p className={`text-base font-bold mt-0.5 truncate ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Per-exam-type table */}
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #1e293b" }}>
          <div className="px-5 py-3 flex items-center gap-2"
            style={{ background: "rgba(30,41,59,0.6)", borderBottom: "1px solid #1e293b" }}>
            <BookOpen className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-bold text-white">{viewSubject}</span>
            <span className="text-xs text-slate-500">— all exam results · Class {selectedClass}-{section}</span>
          </div>

          <div className="overflow-x-auto" style={{ background: "#0f172a" }}>
            <table className="w-full text-sm" style={{ minWidth: "560px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  {["Exam Type", "Marks", "Total", "Score %", "Grade", "Status", "Contributes to"].map(h => (
                    <th key={h} className="text-left py-3 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-wide first:pl-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ et, score, pct, g, contribs }, i) => (
                  <tr key={et}
                    style={{ borderBottom: i < rows.length - 1 ? "1px solid rgba(30,41,59,0.5)" : "none" }}
                    className="hover:bg-white/[0.02] transition-colors"
                    data-testid={`mode-a-row-${et}`}>
                    <td className="py-3 px-4 pl-5">
                      <span className="text-white font-semibold text-sm">{et}</span>
                    </td>
                    <td className="py-3 px-4">
                      {!score ? <span className="text-slate-600 text-xs italic">—</span>
                        : score.isAbsent ? <span className="text-orange-400 font-semibold text-xs">Absent</span>
                        : <span className="text-slate-300">{score.marks}</span>}
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-sm">{score ? score.totalMarks : "—"}</td>
                    <td className="py-3 px-4">
                      {pct !== null
                        ? <span className={`font-bold ${pct >= 60 ? "text-emerald-400" : pct >= 33 ? "text-yellow-400" : "text-red-400"}`}>
                            {pct.toFixed(1)}%
                          </span>
                        : <span className="text-slate-600 text-xs">—</span>}
                    </td>
                    <td className="py-3 px-4">
                      {g
                        ? <span className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${g.color} ${g.bg}`} title={g.remarks}>{g.label}</span>
                        : <span className="text-slate-600 text-xs">—</span>}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge score={score} />
                    </td>
                    <td className="py-3 px-4">
                      {contribs.length > 0
                        ? <div className="flex flex-wrap gap-1">
                            {contribs.map(c => (
                              <span key={c.termName}
                                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                style={{ background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.25)", color: "#fbbf24" }}>
                                {c.termName} {c.weight}%
                              </span>
                            ))}
                          </div>
                        : <span className="text-slate-600 text-[10px]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {rows.every(r => !r.score) && (
          <div className="rounded-2xl p-8 flex flex-col items-center gap-3 text-center"
            style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
            <Trophy className="w-7 h-7 text-slate-700" />
            <p className="text-slate-400 font-semibold text-sm">No marks recorded for {viewSubject} yet</p>
            <p className="text-slate-600 text-xs">Marks appear here the moment your teacher saves them.</p>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // MODE B — Exam Type selected only: cross-subject report sheet
  // ══════════════════════════════════════════════════════════════════════════════
  if (mode === "B") {
    const contribs = termContributionsFor(viewExamType);
    const rows = subjectOptions.map(sub => {
      const score = scoreFor(sub, viewExamType);
      const pct   = renderPct(score);
      const g     = pct !== null ? computeGrade(pct) : null;
      return { sub, score, pct, g };
    });

    const scored = rows.filter(r => r.score && !r.score.isAbsent);
    const avgPct = scored.length > 0
      ? Math.round(scored.reduce((s, r) => s + (r.pct ?? 0), 0) / scored.length * 10) / 10
      : null;
    const passCount = scored.filter(r => r.pct !== null && r.score && r.pct >= (r.score.passMarks / r.score.totalMarks * 100)).length;
    const failCount = scored.length - passCount;
    const absentCount = rows.filter(r => r.score?.isAbsent).length;

    return (
      <div className="space-y-4" data-testid="panel-view-marks-mode-b">
        {filterRow}

        {/* Term-contribution chips */}
        {contribs.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Counts towards:</span>
            {contribs.map(c => (
              <span key={c.termName}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                style={{ background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.25)", color: "#fbbf24" }}>
                {c.termName} · {c.weight}% weight
              </span>
            ))}
          </div>
        )}

        {/* Stats bar */}
        {scored.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-2xl overflow-hidden" style={{ border: "1px solid #1e293b", background: "#1e293b" }}>
            {[
              { label: "Subjects Taken",  value: `${rows.filter(r => r.score).length} / ${subjectOptions.length}`, color: "text-white" },
              { label: "Average %",       value: avgPct !== null ? `${avgPct}%` : "—",
                color: avgPct !== null ? (avgPct >= 60 ? "text-emerald-400" : avgPct >= 33 ? "text-yellow-400" : "text-red-400") : "text-slate-600" },
              { label: "Passed",          value: String(passCount), color: "text-emerald-400" },
              { label: "Failed / Absent", value: `${failCount} / ${absentCount}`, color: failCount + absentCount === 0 ? "text-slate-400" : "text-red-400" },
            ].map(s => (
              <div key={s.label} className="px-4 py-3" style={{ background: "#0f172a" }}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">{s.label}</p>
                <p className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Per-subject table */}
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #1e293b" }}>
          <div className="px-5 py-3 flex items-center gap-2"
            style={{ background: "rgba(30,41,59,0.6)", borderBottom: "1px solid #1e293b" }}>
            <Award className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-bold text-white">{viewExamType}</span>
            <span className="text-xs text-slate-500">— cross-subject report · Class {selectedClass}-{section}</span>
          </div>

          <div className="overflow-x-auto" style={{ background: "#0f172a" }}>
            <table className="w-full text-sm" style={{ minWidth: "480px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  {["Subject", "Marks", "Total", "Score %", "Grade", "Status", "Contribution"].map(h => (
                    <th key={h} className="text-left py-3 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-wide first:pl-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ sub, score, pct, g }, i) => {
                  const termPctContrib = pct !== null && contribs.length > 0
                    ? contribs.map(c => ({ termName: c.termName, val: Math.round(pct * c.weight / 100 * 100) / 100 }))
                    : null;
                  return (
                    <tr key={sub}
                      style={{ borderBottom: i < rows.length - 1 ? "1px solid rgba(30,41,59,0.5)" : "none" }}
                      className="hover:bg-white/[0.02] transition-colors"
                      data-testid={`mode-b-row-${sub}`}>
                      <td className="py-3 px-4 pl-5">
                        <span className="text-white font-semibold text-sm">{sub}</span>
                      </td>
                      <td className="py-3 px-4">
                        {!score ? <span className="text-slate-600 text-xs italic">—</span>
                          : score.isAbsent ? <span className="text-orange-400 font-semibold text-xs">Absent</span>
                          : <span className="text-slate-300">{score.marks}</span>}
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-sm">{score ? score.totalMarks : "—"}</td>
                      <td className="py-3 px-4">
                        {pct !== null
                          ? <span className={`font-bold ${pct >= 60 ? "text-emerald-400" : pct >= 33 ? "text-yellow-400" : "text-red-400"}`}>
                              {pct.toFixed(1)}%
                            </span>
                          : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="py-3 px-4">
                        {g
                          ? <span className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${g.color} ${g.bg}`} title={g.remarks}>{g.label}</span>
                          : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge score={score} />
                      </td>
                      <td className="py-3 px-4">
                        {termPctContrib
                          ? <div className="flex flex-wrap gap-1">
                              {termPctContrib.map(tc => (
                                <span key={tc.termName}
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                  style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.2)", color: "#fbbf24" }}>
                                  +{tc.val} ({tc.termName})
                                </span>
                              ))}
                            </div>
                          : <span className="text-slate-600 text-[10px]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {rows.every(r => !r.score) && (
          <div className="rounded-2xl p-8 flex flex-col items-center gap-3 text-center"
            style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
            <Trophy className="w-7 h-7 text-slate-700" />
            <p className="text-slate-400 font-semibold text-sm">No marks recorded for {viewExamType} yet</p>
            <p className="text-slate-600 text-xs">Marks appear here the moment your teacher saves them.</p>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // MODE C — Both selected: single focused result card
  // ══════════════════════════════════════════════════════════════════════════════
  const score = scoreFor(viewSubject, viewExamType);
  const pct   = renderPct(score);
  const g     = pct !== null ? computeGrade(pct) : null;
  const contribsC = termContributionsFor(viewExamType);

  return (
    <div className="space-y-4" data-testid="panel-view-marks-mode-c">
      {filterRow}

      {/* Single result card */}
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #1e293b" }}>

        {/* Card header */}
        <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-4"
          style={{ background: "rgba(30,41,59,0.6)", borderBottom: "1px solid #1e293b" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.25)" }}>
              <Award className="w-5 h-5 text-yellow-400" />
            </div>
            <div className="leading-tight">
              <p className="text-white font-bold text-sm">{viewSubject}</p>
              <p className="text-slate-400 text-xs">{viewExamType} · Class {selectedClass}-{section}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {score && !score.isAbsent && pct !== null && (
              <span className={`text-2xl font-extrabold ${pct >= 60 ? "text-emerald-400" : pct >= 33 ? "text-yellow-400" : "text-red-400"}`}>
                {pct.toFixed(1)}%
              </span>
            )}
            {g && <span className={`text-sm font-bold px-3 py-1 rounded-xl border ${g.color} ${g.bg}`} title={g.remarks}>{g.label}</span>}
            <StatusBadge score={score} />
          </div>
        </div>

        <div className="p-5 space-y-4" style={{ background: "#0f172a" }}>

          {/* No data state */}
          {!score && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Trophy className="w-8 h-8 text-slate-700" />
              <p className="text-slate-400 font-semibold text-sm">No marks recorded yet</p>
              <p className="text-slate-600 text-xs">
                No score found for {viewSubject} × {viewExamType} in Class {selectedClass}.
              </p>
            </div>
          )}

          {/* Raw score block */}
          {score && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Marks Obtained", value: score.isAbsent ? "Absent" : String(score.marks),
                  color: score.isAbsent ? "text-orange-400" : "text-white" },
                { label: "Full Marks",  value: String(score.totalMarks), color: "text-slate-300" },
                { label: "Pass Marks",  value: String(score.passMarks),  color: "text-slate-300" },
              ].map(s => (
                <div key={s.label} className="rounded-xl px-4 py-3" style={{ background: "rgba(30,41,59,0.5)", border: "1px solid #1e293b" }}>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">{s.label}</p>
                  <p className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Progress bar */}
          {score && !score.isAbsent && pct !== null && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Score progress</span>
                <span>{pct.toFixed(1)}%</span>
              </div>
              <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "#1e293b" }}>
                <div
                  className={`h-full rounded-full transition-all ${pct >= 60 ? "bg-emerald-500" : pct >= 33 ? "bg-yellow-500" : "bg-red-500"}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>0</span>
                <span className="text-slate-500">Pass: {score.passMarks}/{score.totalMarks} ({Math.round(score.passMarks / score.totalMarks * 100)}%)</span>
                <span>{score.totalMarks}</span>
              </div>
            </div>
          )}

          {/* Component/Weight/Raw Score/Score%/Contribution table */}
          {contribsC.length > 0 && score && !score.isAbsent && pct !== null && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Term Contribution Breakdown
              </p>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #1e293b" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1e293b", background: "rgba(30,41,59,0.4)" }}>
                      {["Component", "Weight", "Raw Score", "Score %", "Contribution"].map(h => (
                        <th key={h} className="text-left py-2.5 px-4 text-slate-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {contribsC.map((c, i) => (
                      <tr key={c.termName} style={{ borderBottom: i < contribsC.length - 1 ? "1px solid rgba(30,41,59,0.5)" : "none" }}>
                        <td className="py-2.5 px-4 text-slate-300 font-medium">{viewExamType}</td>
                        <td className="py-2.5 px-4 text-slate-400">{c.weight}%</td>
                        <td className="py-2.5 px-4 text-slate-300">{score.marks}/{score.totalMarks}</td>
                        <td className="py-2.5 px-4 text-slate-300">{pct.toFixed(1)}%</td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="text-yellow-400 font-bold">+{Math.round(pct * c.weight / 100 * 100) / 100}</span>
                            <span className="text-[9px] text-slate-600">pts → {c.termName}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Grade remarks footer */}
          {g && score && !score.isAbsent && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
              style={{ background: "rgba(30,41,59,0.3)", border: "1px solid #1e293b" }}>
              <span className={`text-sm font-bold ${g.color}`}>{g.label}</span>
              <span className="text-slate-400 text-sm">—</span>
              <span className="text-slate-300 text-sm">{g.remarks}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RESULTS PANEL  (unchanged from previous build)
// ══════════════════════════════════════════════════════════════════════════════
function ResultsPanel({
  allScores, policy, passThreshold, isLoading, attendancePct,
  selectedClass, section, sessionLabel, studentName, dsid, onPrint,
}: {
  allScores: ExamScore[]; policy: ExamPolicyTier | null; passThreshold: number;
  isLoading: boolean; attendancePct: number | null; selectedClass: string;
  section: string; sessionLabel: string; studentName: string; dsid: string;
  onPrint: () => void;
}) {
  const [resTerm, setResTerm] = useState("");

  const termNames = useMemo(() => {
    if (!policy) return [];
    try { return Object.keys(JSON.parse(policy.examWeights || "{}")).map(k => k.trim()); }
    catch { return []; }
  }, [policy]);

  useEffect(() => {
    if (termNames.length > 0 && (!resTerm || !termNames.includes(resTerm)))
      setResTerm(termNames[0]);
  }, [termNames, resTerm]);

  const { termResults, allTermFailCounts } = useMemo<StudentTermResults>(() => {
    if (!policy || allScores.length === 0) return { termResults: {}, allTermFailCounts: {} };
    return computeStudentTermResults(allScores, policy, passThreshold);
  }, [allScores, policy, passThreshold]);

  const activeTermSubjects = termResults[resTerm] ?? [];
  const scoredSubjects = activeTermSubjects.filter(s => s.status === "scored");
  const termAvg = scoredSubjects.length > 0
    ? Math.round((scoredSubjects.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / scoredSubjects.length) * 10) / 10
    : null;
  const failCount = allTermFailCounts[resTerm] ?? 0;
  const termGrade = termAvg !== null ? computeGrade(termAvg) : null;

  if (isLoading) return (
    <div className="flex justify-center py-14">
      <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
    </div>
  );

  if (!policy) return (
    <div className="rounded-2xl p-10 flex flex-col items-center gap-3 text-center"
      style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
      <AlertTriangle className="w-7 h-7 text-amber-500/60" />
      <p className="text-slate-300 font-bold text-sm">No Exam Policy for Class {selectedClass}</p>
      <p className="text-slate-600 text-xs max-w-xs">
        Ask your admin to configure an Exam Aggregation Policy.
      </p>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="panel-results" id="exam-print-area">
      {/* Term selector */}
      {termNames.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide no-print">
          {termNames.map(term => (
            <button key={term} onClick={() => setResTerm(term)}
              className="flex-shrink-0 px-4 rounded-xl text-sm font-semibold transition-all min-h-[42px]"
              style={resTerm === term
                ? { background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399" }
                : { background: "#0f172a", border: "1px solid #1e293b", color: "#94a3b8" }}
              data-testid={`tab-term-${term.replace(/\s+/g, "-").toLowerCase()}`}>
              {term}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #1e293b" }}>
        {/* Student info bar */}
        <div className="px-5 py-4 flex flex-wrap gap-4 items-center justify-between"
          style={{ background: "rgba(30,41,59,0.5)", borderBottom: "1px solid #1e293b" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}>
              <span className="text-emerald-400 font-bold text-sm">{studentName.charAt(0)}</span>
            </div>
            <div className="leading-tight">
              <p className="text-white font-bold text-sm">{studentName}</p>
              <p className="text-slate-400 text-xs font-mono">
                {dsid} · Class {selectedClass}-{section}{sessionLabel && ` · ${sessionLabel}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5 flex-wrap">
            {termAvg !== null && (
              <div className="text-right">
                <span className="text-slate-500 text-xs block">Term Average</span>
                <span className="text-emerald-400 font-bold text-xl">{termAvg}%</span>
              </div>
            )}
            {termGrade && (
              <div className="text-right">
                <span className="text-slate-500 text-xs block">Overall Grade</span>
                <span className={`inline-flex items-center justify-center px-3 py-1 rounded-xl border text-xl font-bold ${termGrade.color} ${termGrade.bg}`}
                  title={termGrade.remarks}>{termGrade.label}</span>
              </div>
            )}
            <button onClick={onPrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold no-print"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#34d399" }}
              data-testid="button-print-results">
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: "#1e293b" }}>
          {[
            { label: "Term Avg",   value: termAvg !== null ? `${termAvg}%` : "—",
              color: termAvg !== null ? (termAvg >= 60 ? "text-emerald-400" : termAvg >= passThreshold ? "text-yellow-400" : "text-red-400") : "text-slate-600" },
            { label: "Grade",      value: termGrade?.label ?? "—", color: termGrade ? termGrade.color : "text-slate-600" },
            { label: "Fails",      value: String(failCount),
              color: failCount === 0 ? "text-emerald-400" : failCount <= 2 ? "text-amber-400" : "text-red-400" },
            { label: "Attendance", value: attendancePct !== null ? `${attendancePct}%` : "—",
              color: attendancePct !== null ? (attendancePct < 75 ? "text-red-400" : attendancePct < 85 ? "text-yellow-400" : "text-emerald-400") : "text-slate-600" },
          ].map(stat => (
            <div key={stat.label} className="px-5 py-4" style={{ background: "#0f172a" }}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">{stat.label}</p>
              <p className={`text-xl font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Subject breakdown */}
        <div className="p-5 space-y-3" style={{ background: "#0f172a" }}>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Subject-wise Aggregation Breakdown
            {resTerm && <span className="text-slate-600 font-normal"> — {resTerm}</span>}
          </h3>

          {activeTermSubjects.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500/60" />
              <p className="text-slate-400 font-semibold text-sm">No Marks Entered Yet</p>
              <p className="text-slate-600 text-xs max-w-xs">
                Marks appear here instantly the moment your teacher saves them.
              </p>
            </div>
          ) : activeTermSubjects.map(subj => {
            const gS = subj.percentage !== null ? computeGrade(subj.percentage) : null;
            return (
              <div key={subj.subject} className="rounded-xl overflow-hidden"
                style={{ border: "1px solid #1e293b" }} data-testid={`results-subject-${subj.subject}`}>
                <div className="flex items-center justify-between px-4 py-2.5"
                  style={{ background: "rgba(30,41,59,0.6)", borderBottom: "1px solid #1e293b" }}>
                  <span className="text-white text-sm font-semibold">{subj.subject}</span>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {subj.percentage !== null && (
                      <span className="text-emerald-400 font-bold text-sm">{subj.percentage}%</span>
                    )}
                    {gS && subj.status === "scored" && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${gS.color} ${gS.bg}`} title={gS.remarks}>{gS.label}</span>
                    )}
                    {subj.passed === true  && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">PASS</span>}
                    {subj.passed === false && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">FAIL</span>}
                    {subj.status === "absent"     && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">ABSENT</span>}
                    {subj.status === "incomplete" && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400 border border-slate-500/30">PENDING</span>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1e293b" }}>
                        {["Component", "Weight", "Raw Score", "Score %", "Contribution"].map(h => (
                          <th key={h} className="text-left py-2 px-4 text-slate-500 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {subj.breakdown.map((comp, i) => (
                        <tr key={i} style={{ borderBottom: i < subj.breakdown.length - 1 ? "1px solid rgba(30,41,59,0.5)" : "none" }}>
                          <td className="py-2 px-4 text-slate-300 font-medium">{comp.sourceExam}</td>
                          <td className="py-2 px-4 text-slate-400">{comp.weight}%</td>
                          <td className="py-2 px-4">
                            {comp.status === "missing" && <span className="text-slate-600 italic">Not entered</span>}
                            {comp.status === "absent"  && <span className="text-orange-400 font-semibold">Absent</span>}
                            {comp.status === "scored"  && <span className="text-slate-300">{comp.marks}/{comp.totalMarks}</span>}
                          </td>
                          <td className="py-2 px-4">
                            {comp.pct !== null ? <span className="text-slate-300">{comp.pct.toFixed(1)}%</span> : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="py-2 px-4">
                            {comp.contribution !== null ? <span className="text-yellow-400 font-semibold">+{comp.contribution.toFixed(2)}</span> : <span className="text-slate-600">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {subj.status === "scored" && subj.percentage !== null && (
                      <tfoot>
                        <tr style={{ background: "rgba(30,41,59,0.4)", borderTop: "1px solid #1e293b" }}>
                          <td colSpan={4} className="py-2 px-4 text-right text-slate-400 font-semibold text-xs">Weighted Aggregate</td>
                          <td className="py-2 px-4 text-emerald-400 font-bold">{subj.percentage}%</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            );
          })}
        </div>

        {/* Cross-term fail summary */}
        {Object.keys(allTermFailCounts).length > 0 && activeTermSubjects.length > 0 && (
          <div className="px-5 pb-5" style={{ background: "#0f172a" }}>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Failure Count per Term</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(allTermFailCounts).map(([t, n]) => (
                <button key={t} onClick={() => setResTerm(t)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all ${t === resTerm ? "ring-1 ring-slate-400" : ""} ${n > 0 ? "border-red-500/30 bg-red-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}>
                  <span className={n > 0 ? "text-red-400" : "text-emerald-400"}>{t}</span>
                  <span className={`font-bold ${n > 0 ? "text-red-300" : "text-emerald-300"}`}>{n} fail{n !== 1 ? "s" : ""}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Policy note */}
        {activeTermSubjects.length > 0 && (
          <div className="mx-5 mb-5 rounded-xl p-4"
            style={{ border: "1px solid #1e293b", background: "rgba(30,41,59,0.3)" }}>
            <p className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              Policy: {policy?.tierName}
            </p>
            <p className="text-xs text-slate-500">
              Marks appear in real-time — no publish step needed.
            </p>
            {attendancePct !== null && (
              <p className="text-xs text-slate-500 mt-1">
                Attendance: <span className={`font-semibold ${attendancePct < 75 ? "text-red-400" : "text-emerald-400"}`}>{attendancePct}%</span>
                {attendancePct < 75 && <span className="text-red-400 ml-1 text-[10px]">⚠ Below 75% minimum</span>}
              </p>
            )}
          </div>
        )}

        {/* Signature footer */}
        {activeTermSubjects.length > 0 && (
          <div className="px-5 py-4 grid grid-cols-3 gap-6 border-t" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
            {["Class Teacher", "Principal / H.O.D", "Parent / Guardian"].map(label => (
              <div key={label} className="flex flex-col items-center gap-2">
                <div className="w-full h-9 border-b border-dashed" style={{ borderColor: "#334155" }} />
                <p className="text-[9px] text-slate-500 uppercase tracking-wider text-center">{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
type MainTab = "view" | "results";

export default function StudentExamination() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<MainTab>("view");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  // ── Auth ────────────────────────────────────────────────────────────────────
  const { data: student, isLoading: studentLoading } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  // ── Academic sessions — fire in parallel with student, don't block page render
  const { data: rawSessions = [], isLoading: sessionsLoading } = useQuery<AcademicSession[]>({
    queryKey: ["/api/student/academic-sessions"],
    staleTime: 60000,
  });

  // ── Enrollment history — authoritative class/section per session ─────────────
  // Auto-upserts the current-session record on the server, so the registry stays
  // self-healing without any admin action.
  const { data: enrollmentHistory = [] } = useQuery<EnrollmentRecord[]>({
    queryKey: ["/api/student/exam/enrollment-history"],
    enabled: !!student,
    staleTime: 300000, // 5 min — enrollment rarely changes mid-session
  });

  // ── Resolve sessions with enrollment data ────────────────────────────────────
  const sessions: SessionMeta[] = useMemo(
    () =>
      student
        ? resolveSessionsWithEnrollments(
            rawSessions,
            enrollmentHistory,
            student.class,
            student.section,
          )
        : [],
    [rawSessions, enrollmentHistory, student],
  );

  useEffect(() => {
    if (sessions.length > 0 && selectedSessionId === null) {
      const active = sessions.find(s => s.isActive) ?? sessions[0];
      setSelectedSessionId(active.id);
    }
  }, [sessions, selectedSessionId]);

  const selectedSession: SessionMeta | null =
    sessions.find(s => s.id === selectedSessionId) ?? null;

  // These are the historically-accurate class and section for the selected session
  const selectedClass   = selectedSession?.cls     ?? student?.class   ?? "";
  const selectedSection = selectedSession?.section ?? student?.section ?? "";

  // Reset tab when session changes
  useEffect(() => { setTab("view"); }, [selectedSessionId]);

  // ── Exam policy for resolved historical class ────────────────────────────────
  const { data: policyData, isLoading: policyLoading, isError: policyMissing } =
    useQuery<ExamPolicyTier>({
      queryKey: ["/api/student/exam/policy", selectedClass],
      queryFn: async () => {
        const r = await fetch(
          `/api/student/exam/policy?class=${encodeURIComponent(selectedClass)}`,
          { credentials: "include" },
        );
        if (!r.ok) throw new Error("No policy");
        return r.json();
      },
      enabled: !!selectedClass,
      retry: false,
      staleTime: 60000,
    });

  const passThreshold = policyData?.passPercentage ?? 35;

  // ── All scores — keyed by (class, sessionId) for strict cache isolation ──────
  // Backend filters by studentId + class. The sessionId in the cache key prevents
  // cross-session cache bleed when the same class appears in multiple sessions
  // (e.g. a student who repeated a year).
  const { data: allScoresData, isLoading: scoresLoading } =
    useQuery<{ scores: ExamScore[]; cls: string }>({
      queryKey: ["/api/student/exam/all-scores", selectedClass, selectedSessionId],
      queryFn: async () => {
        const r = await fetch(
          `/api/student/exam/all-scores?class=${encodeURIComponent(selectedClass)}`,
          { credentials: "include" },
        );
        if (!r.ok) throw new Error("Failed");
        return r.json();
      },
      enabled: !!selectedClass && selectedSessionId !== null,
      staleTime: 0,
      refetchInterval: 30000,
    });

  const allScores = allScoresData?.scores ?? [];

  // ── Attendance ───────────────────────────────────────────────────────────────
  const { data: attendanceData } = useQuery<AttendanceStatsResponse>({
    queryKey: ["/api/student/attendance/stats", selectedSession?.sessionName],
    queryFn: async () => {
      const r = await fetch(
        `/api/student/attendance/stats?academicYear=${encodeURIComponent(selectedSession!.sessionName)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!selectedSession,
    staleTime: 60000,
  });

  const attPct = attendanceData?.overallPercent ?? null;
  const isDataLoading = policyLoading || scoresLoading;
  const handlePrint = useCallback(() => window.print(), []);

  // Only block on student auth — sessions/data load in background without blocking the page
  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#020617" }}>
        <Loader2 className="w-9 h-9 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#020617", color: "#e2e8f0" }}>
      <PrintStyles />

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 no-print"
        style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", boxShadow: "0 1px 20px rgba(0,0,0,0.4)" }}>
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-9 h-9 rounded-xl transition-colors"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid="button-back">
            <ArrowLeft className="w-4 h-4 text-slate-400" />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#f97316,#ef4444)" }}>
              <ClipboardList className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="font-bold text-sm text-white truncate">Academic Performance</p>
              <p className="text-[11px] text-slate-500 truncate">
                {student.digitalStudentId} · {selectedSession
                  ? `Session ${selectedSession.displayLabel} · Class ${selectedClass}-${selectedSection}`
                  : `Class ${student.class}-${student.section}`}
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-slate-400"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <GraduationCap className="w-3.5 h-3.5" />
            {student.schoolCode}
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-5 space-y-5">

        {/* ── Session pills ────────────────────────────────────────────────── */}
        <div className="rounded-2xl p-4 no-print"
          style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">Academic Session</h2>
          </div>
          {sessions.length === 0 && sessionsLoading ? (
            <div className="flex gap-2">
              {[1,2].map(i => (
                <div key={i} className="h-10 w-28 rounded-xl animate-pulse" style={{ background: "#1e293b" }} />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-slate-600 text-xs italic">No academic sessions configured by your admin.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {sessions.map(s => (
                  <button key={s.id} onClick={() => setSelectedSessionId(s.id)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all min-h-[40px]"
                    style={s.id === selectedSessionId
                      ? { background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399" }
                      : { background: "rgba(255,255,255,0.04)", border: "1px solid #1e293b", color: "#94a3b8" }}
                    data-testid={`pill-session-${s.id}`}>
                    <span className="whitespace-nowrap">{s.displayLabel}</span>
                    {s.isActive && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                        style={{ background: "rgba(16,185,129,0.2)", color: "#34d399" }}>
                        Current
                      </span>
                    )}
                    <span className="text-[10px] whitespace-nowrap" style={{ color: s.verified ? "#6ee7b7" : "#64748b" }}>
                      Cl.{s.cls}{s.verified ? " ✓" : " ~"}
                    </span>
                  </button>
                ))}
              </div>
              {/* ── Scope badge — authoritative compound key for the selected session ── */}
              {selectedSession && (
                <div className="flex items-center gap-2 text-[11px] flex-wrap"
                  data-testid="scope-badge">
                  <span className="text-slate-500">{student.schoolName}</span>
                  <span className="text-slate-700">·</span>
                  <span className="text-slate-500">Session <span className="text-slate-400 font-semibold">{selectedSession.displayLabel}</span></span>
                  <span className="text-slate-700">·</span>
                  <span className="text-slate-500">
                    Class <span className="text-slate-300 font-bold">{selectedClass}-{selectedSection}</span>
                  </span>
                  {selectedSession.verified ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                      style={{ background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}>
                      ✓ Enrollment Verified
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                      style={{ background: "rgba(245,158,11,0.08)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.2)" }}>
                      ~ Class Estimated
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Golden-yellow tab bar — exact mirror of teacher dashboard ────── */}
        <div className="flex gap-1.5 p-1 rounded-2xl no-print"
          style={{ background: "#020617", border: "1px solid #1e293b" }}
          data-testid="tabs-exam">
          {([
            { key: "view",    label: "View Marks", Icon: BarChart3 },
            { key: "results", label: "Results",    Icon: Award },
          ] as const).map(({ key, label, Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                tab === key
                  ? "bg-yellow-500 text-[#020617] shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-[#1e293b]"
              }`}
              data-testid={`tab-${key}`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        {/* ── Policy banner strips ─────────────────────────────────────────── */}
        {!policyLoading && policyMissing && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium no-print"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24" }}>
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            No exam policy configured for Class {selectedClass} in Session {selectedSession?.displayLabel ?? ""} — aggregated results unavailable. Raw marks still visible in View Marks.
          </div>
        )}
        {!policyLoading && policyData && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium no-print"
            style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.18)", color: "#6ee7b7" }}>
            <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
            {policyData.tierName} · {student.schoolName} · Session <strong>{selectedSession?.displayLabel}</strong> · Class <strong>{selectedClass}-{selectedSection}</strong>
          </div>
        )}

        {/* ── Tab content ──────────────────────────────────────────────────── */}
        {tab === "view" && (
          <ViewMarksPanel
            allScores={allScores}
            policy={policyData ?? null}
            passThreshold={passThreshold}
            isLoading={isDataLoading}
            selectedClass={selectedClass}
            section={selectedSection}
          />
        )}
        {tab === "results" && (
          <ResultsPanel
            allScores={allScores}
            policy={policyData ?? null}
            passThreshold={passThreshold}
            isLoading={isDataLoading}
            attendancePct={attPct}
            selectedClass={selectedClass}
            section={selectedSection}
            sessionLabel={selectedSession?.displayLabel ?? ""}
            studentName={student.name}
            dsid={student.digitalStudentId}
            onPrint={handlePrint}
          />
        )}

        {/* No sessions */}
        {sessions.length === 0 && !sessionsLoading && (
          <div className="rounded-2xl p-10 flex flex-col items-center gap-3 text-center"
            style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
            <Trophy className="w-8 h-8 text-slate-700" />
            <h3 className="text-slate-400 font-bold">No Academic Sessions Found</h3>
            <p className="text-slate-600 text-sm max-w-xs">
              Ask your school administrator to configure academic sessions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
