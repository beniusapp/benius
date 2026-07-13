import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, GraduationCap, Loader2, ClipboardList, Printer,
  CheckCircle2, XCircle, AlertTriangle, TrendingUp, Trophy,
  Award, BookOpen, CalendarDays, BarChart3, ChevronDown,
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

// ─────────────────────────── Session→Class Mapping ─────────────────────────────
function mapSessionsToClasses(
  sessions: AcademicSession[], currentClass: string,
): Array<AcademicSession & { cls: string; displayLabel: string }> {
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
  );
  const currentNum = parseInt(currentClass, 10);
  const result: Array<AcademicSession & { cls: string; displayLabel: string }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const cls = isNaN(currentNum) ? (i === 0 ? currentClass : "") : String(currentNum - i);
    if (!isNaN(currentNum) && parseInt(cls, 10) < 1) break;
    if (cls === "") break;
    result.push({ ...s, cls, displayLabel: s.sessionName });
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

// ─────────────────────────── Grade Helpers ─────────────────────────────────────
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
function gradeColor(label: string) {
  const l = label.toUpperCase();
  if (l === "O" || l === "A+") return "text-emerald-400";
  if (l.startsWith("A"))       return "text-green-400";
  if (l === "B+")              return "text-teal-400";
  if (l.startsWith("B"))       return "text-blue-400";
  if (l.startsWith("C"))       return "text-yellow-400";
  if (l.startsWith("D"))       return "text-orange-400";
  return "text-red-400";
}

// ─────────────────────────── Print CSS ─────────────────────────────────────────
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

// ─────────────────────────── Tab type ──────────────────────────────────────────
type MainTab = "view" | "results";

// ══════════════════════════════════════════════════════════════════════════════
// VIEW MARKS PANEL
// Exam-Type picker → per-subject raw scores + term-contribution breakdown
// ══════════════════════════════════════════════════════════════════════════════
function ViewMarksPanel({
  allScores,
  policy,
  passThreshold,
  isLoading,
  selectedClass,
  section,
}: {
  allScores: ExamScore[];
  policy: ExamPolicyTier | null;
  passThreshold: number;
  isLoading: boolean;
  selectedClass: string;
  section: string;
}) {
  const [viewExamType, setViewExamType] = useState("");

  // Derive available exam types from actual score data (not from config)
  const availableExamTypes = useMemo(() => {
    const s = new Set<string>();
    allScores.forEach(sc => s.add(sc.examType));
    return Array.from(s).sort();
  }, [allScores]);

  // Auto-select first exam type
  useEffect(() => {
    if (availableExamTypes.length > 0 && (!viewExamType || !availableExamTypes.includes(viewExamType)))
      setViewExamType(availableExamTypes[0]);
  }, [availableExamTypes, viewExamType]);

  // Reset when class changes
  useEffect(() => { setViewExamType(""); }, [selectedClass]);

  // Scores for the selected exam type
  const examTypeScores = useMemo(
    () => allScores.filter(sc => sc.examType === viewExamType),
    [allScores, viewExamType],
  );

  // Parse policy weights to find how this exam type contributes to each term
  const termContributions = useMemo(() => {
    if (!policy || !viewExamType) return [];
    let weights: Record<string, { source_exam: string; weight: number }[]> = {};
    try { weights = JSON.parse(policy.examWeights || "{}"); } catch {}
    const result: { termName: string; weight: number }[] = [];
    for (const [termName, comps] of Object.entries(weights)) {
      const comp = comps.find(c => c.source_exam === viewExamType);
      if (comp) result.push({ termName: termName.trim(), weight: comp.weight });
    }
    return result;
  }, [policy, viewExamType]);

  if (isLoading) return (
    <div className="flex justify-center py-14">
      <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
    </div>
  );

  return (
    <div className="space-y-4" data-testid="panel-view-marks">

      {/* Exam Type Selector */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-yellow-400" />
          <h2 className="text-sm font-bold text-white">Exam Type</h2>
          <span className="text-xs text-slate-500">— select to view your scores</span>
        </div>

        {availableExamTypes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Trophy className="w-7 h-7 text-slate-700" />
            <p className="text-slate-400 font-semibold text-sm">No marks recorded yet for Class {selectedClass}</p>
            <p className="text-slate-600 text-xs">Marks appear here the moment your teacher saves them — no publish step needed.</p>
          </div>
        ) : (
          <>
            {/* Dropdown styled to match teacher dashboard */}
            <div className="relative max-w-xs">
              <select
                value={viewExamType}
                onChange={e => setViewExamType(e.target.value)}
                className="w-full h-10 rounded-xl border px-3 pr-9 text-sm text-white appearance-none cursor-pointer focus:outline-none"
                style={{
                  background: "#020617", borderColor: "#1e293b",
                  colorScheme: "dark",
                }}
                data-testid="select-exam-type"
              >
                {availableExamTypes.map(et => (
                  <option key={et} value={et}>{et}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>

            {/* Term-contribution pills */}
            {termContributions.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide self-center">Used in:</span>
                {termContributions.map(tc => (
                  <span key={tc.termName}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={{ background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.25)", color: "#fbbf24" }}>
                    {tc.termName} · {tc.weight}% weight
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Per-subject score cards for selected exam type */}
      {viewExamType && examTypeScores.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Subject-wise Marks — {viewExamType}
            </h3>
            <span className="text-[10px] text-slate-600">
              Class {selectedClass} · Section {section}
            </span>
          </div>

          {examTypeScores.map(score => {
            const pct = score.isAbsent || score.totalMarks === 0
              ? 0 : (score.marks / score.totalMarks) * 100;
            const roundedPct = Math.round(pct * 10) / 10;
            const g = score.isAbsent ? null : computeGrade(roundedPct);
            const passed = !score.isAbsent && score.marks >= score.passMarks;

            // Contribution toward each term that uses this exam type
            const subjectContribs = termContributions.map(tc => ({
              termName: tc.termName,
              weight: tc.weight,
              contribution: score.isAbsent ? null : Math.round((pct * tc.weight / 100) * 100) / 100,
            }));

            return (
              <div key={score.subject}
                className="rounded-2xl overflow-hidden"
                style={{ border: "1px solid #1e293b" }}
                data-testid={`viewmarks-card-${score.subject}`}>

                {/* Subject header — matches teacher ReportCardModal exactly */}
                <div className="flex items-center justify-between px-4 py-3"
                  style={{ background: "rgba(30,41,59,0.6)", borderBottom: "1px solid #1e293b" }}>
                  <span className="text-white text-sm font-semibold">{score.subject}</span>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {!score.isAbsent && (
                      <span className="text-slate-300 text-sm font-medium">{score.marks}/{score.totalMarks}</span>
                    )}
                    {!score.isAbsent && (
                      <span className={`font-bold text-sm ${roundedPct >= 60 ? "text-emerald-400" : roundedPct >= 33 ? "text-yellow-400" : "text-red-400"}`}>
                        {roundedPct}%
                      </span>
                    )}
                    {g && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${g.color} ${g.bg}`}
                        title={g.remarks}>{g.label}</span>
                    )}
                    {!score.isAbsent && (
                      passed
                        ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">PASS</span>
                        : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">FAIL</span>
                    )}
                    {score.isAbsent && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">ABSENT</span>
                    )}
                  </div>
                </div>

                {/* Contribution table — Component / Weight / Raw Score / Score % / Contribution */}
                <div className="overflow-x-auto" style={{ background: "#0f172a" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1e293b" }}>
                        <th className="text-left py-2 px-4 text-slate-500 font-medium">Component</th>
                        <th className="text-center py-2 px-3 text-slate-500 font-medium w-20">Weight</th>
                        <th className="text-center py-2 px-3 text-slate-500 font-medium w-24">Raw Score</th>
                        <th className="text-center py-2 px-3 text-slate-500 font-medium w-20">Score %</th>
                        <th className="text-center py-2 px-3 text-slate-500 font-medium w-28">Contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subjectContribs.length > 0 ? (
                        subjectContribs.map((tc, i) => (
                          <tr key={i} style={{ borderBottom: i < subjectContribs.length - 1 ? "1px solid rgba(30,41,59,0.5)" : "none" }}>
                            <td className="py-2 px-4 text-slate-300 font-medium">{viewExamType}</td>
                            <td className="py-2 px-3 text-center text-slate-400">{tc.weight}%</td>
                            <td className="py-2 px-3 text-center">
                              {score.isAbsent
                                ? <span className="text-orange-400 font-semibold">Absent</span>
                                : <span className="text-slate-300">{score.marks}/{score.totalMarks}</span>}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {score.isAbsent
                                ? <span className="text-slate-600">—</span>
                                : <span className="text-slate-300">{roundedPct.toFixed(1)}%</span>}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                {tc.contribution !== null
                                  ? <span className="text-yellow-400 font-semibold">+{tc.contribution.toFixed(2)}</span>
                                  : <span className="text-slate-600">—</span>}
                                <span className="text-[9px] text-slate-600">{tc.termName}</span>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        /* No policy — just show the raw row */
                        <tr>
                          <td className="py-2 px-4 text-slate-300 font-medium">{viewExamType}</td>
                          <td className="py-2 px-3 text-center text-slate-600">—</td>
                          <td className="py-2 px-3 text-center">
                            {score.isAbsent
                              ? <span className="text-orange-400 font-semibold">Absent</span>
                              : <span className="text-slate-300">{score.marks}/{score.totalMarks}</span>}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {score.isAbsent
                              ? <span className="text-slate-600">—</span>
                              : <span className="text-slate-300">{roundedPct.toFixed(1)}%</span>}
                          </td>
                          <td className="py-2 px-3 text-center text-slate-600">—</td>
                        </tr>
                      )}
                    </tbody>
                    {/* Progress bar footer */}
                    {!score.isAbsent && (
                      <tfoot>
                        <tr style={{ background: "rgba(30,41,59,0.3)", borderTop: "1px solid #1e293b" }}>
                          <td colSpan={3} className="py-2 px-4">
                            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "#1e293b" }}>
                              <div
                                className={`h-full rounded-full transition-all ${roundedPct >= 60 ? "bg-emerald-500" : roundedPct >= 33 ? "bg-yellow-500" : "bg-red-500"}`}
                                style={{ width: `${Math.min(100, roundedPct)}%` }}
                              />
                            </div>
                          </td>
                          <td className="py-2 px-3 text-center text-slate-400 text-xs font-medium">{roundedPct.toFixed(1)}%</td>
                          <td className="py-2 px-3 text-center text-slate-500 text-xs">
                            Pass: {score.passMarks}/{score.totalMarks}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            );
          })}

          {/* Summary mini-bar */}
          {(() => {
            const scored = examTypeScores.filter(s => !s.isAbsent);
            if (scored.length === 0) return null;
            const totalObtained = scored.reduce((sum, s) => sum + s.marks, 0);
            const totalMax = scored.reduce((sum, s) => sum + s.totalMarks, 0);
            const pct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100 * 10) / 10 : 0;
            const passCount = scored.filter(s => s.marks >= s.passMarks).length;
            const failCount = scored.length - passCount;
            const g = computeGrade(pct);
            return (
              <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #1e293b" }}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: "#1e293b" }}>
                  {[
                    { label: "Total Obtained", value: `${totalObtained}/${totalMax}`, color: "text-white" },
                    { label: "Overall %",      value: `${pct}%`, color: pct >= 60 ? "text-emerald-400" : pct >= 33 ? "text-yellow-400" : "text-red-400" },
                    { label: "Grade",          value: g.label,   color: g.color },
                    { label: "Pass / Fail",    value: `${passCount}P · ${failCount}F`, color: failCount === 0 ? "text-emerald-400" : "text-amber-400" },
                  ].map(stat => (
                    <div key={stat.label} className="px-4 py-3" style={{ background: "#0f172a" }}>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide">{stat.label}</p>
                      <p className={`text-lg font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* No-policy mode note */}
      {viewExamType && termContributions.length === 0 && policy && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl text-xs"
          style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.18)", color: "#fbbf24" }}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{viewExamType} is not mapped to any term in the exam policy — no aggregation contribution shown.</span>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RESULTS PANEL
// Term selector tabs → full weighted ReportCard per subject
// Exact structural replica of teacher's ReportCardModal
// ══════════════════════════════════════════════════════════════════════════════
function ResultsPanel({
  allScores,
  policy,
  passThreshold,
  isLoading,
  attendancePct,
  selectedClass,
  section,
  sessionLabel,
  studentName,
  dsid,
  onPrint,
}: {
  allScores: ExamScore[];
  policy: ExamPolicyTier | null;
  passThreshold: number;
  isLoading: boolean;
  attendancePct: number | null;
  selectedClass: string;
  section: string;
  sessionLabel: string;
  studentName: string;
  dsid: string;
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
        Ask your admin to configure an Exam Aggregation Policy. Results view requires a policy to compute term-weighted scores.
      </p>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="panel-results" id="exam-print-area">

      {/* Term selector tabs — horizontal scrollable pills */}
      {termNames.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide no-print">
          {termNames.map(term => (
            <button
              key={term}
              onClick={() => setResTerm(term)}
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

      {/* Main results card */}
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #1e293b" }}>

        {/* ── Student info bar (mirrors teacher's ReportCardModal student info) ── */}
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
                {dsid} · Class {selectedClass}-{section}
                {sessionLabel && <> · {sessionLabel}</>}
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
                  title={termGrade.remarks}>
                  {termGrade.label}
                </span>
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

        {/* ── Stats bar — 4 columns (mirrors teacher Results tab stats bar) ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: "#1e293b" }}>
          {[
            { label: "Term Avg",   value: termAvg !== null ? `${termAvg}%` : "—",
              color: termAvg !== null ? (termAvg >= 60 ? "text-emerald-400" : termAvg >= passThreshold ? "text-yellow-400" : "text-red-400") : "text-slate-600" },
            { label: "Grade",      value: termGrade?.label ?? "—",
              color: termGrade ? termGrade.color : "text-slate-600" },
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

        {/* ── Subject-wise Aggregation Breakdown — exact clone of teacher's ReportCardModal ── */}
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
                Marks appear here instantly the moment your teacher saves them — no publish step required.
              </p>
            </div>
          ) : (
            activeTermSubjects.map(subj => {
              const g = subj.percentage !== null ? computeGrade(subj.percentage) : null;
              return (
                <div key={subj.subject} className="rounded-xl overflow-hidden"
                  style={{ border: "1px solid #1e293b" }}
                  data-testid={`results-subject-${subj.subject}`}>

                  {/* Subject header */}
                  <div className="flex items-center justify-between px-4 py-2.5"
                    style={{ background: "rgba(30,41,59,0.6)", borderBottom: "1px solid #1e293b" }}>
                    <span className="text-white text-sm font-semibold">{subj.subject}</span>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {subj.percentage !== null && (
                        <span className="text-emerald-400 font-bold text-sm">{subj.percentage}%</span>
                      )}
                      {g && subj.status === "scored" && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${g.color} ${g.bg}`}
                          title={g.remarks}>{g.label}</span>
                      )}
                      {subj.passed === true  && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">PASS</span>}
                      {subj.passed === false && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">FAIL</span>}
                      {subj.status === "absent"     && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">ABSENT</span>}
                      {subj.status === "incomplete" && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400 border border-slate-500/30">PENDING</span>}
                    </div>
                  </div>

                  {/* Component table — identical columns to teacher's ReportCardModal */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ borderBottom: "1px solid #1e293b" }}>
                          <th className="text-left py-2 px-4 text-slate-500 font-medium">Component</th>
                          <th className="text-center py-2 px-3 text-slate-500 font-medium w-20">Weight</th>
                          <th className="text-center py-2 px-3 text-slate-500 font-medium w-24">Raw Score</th>
                          <th className="text-center py-2 px-3 text-slate-500 font-medium w-20">Score %</th>
                          <th className="text-center py-2 px-3 text-slate-500 font-medium w-24">Contribution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subj.breakdown.map((comp, i) => (
                          <tr key={i} style={{ borderBottom: i < subj.breakdown.length - 1 ? "1px solid rgba(30,41,59,0.5)" : "none" }}>
                            <td className="py-2 px-4 text-slate-300 font-medium">{comp.sourceExam}</td>
                            <td className="py-2 px-3 text-center text-slate-400">{comp.weight}%</td>
                            <td className="py-2 px-3 text-center">
                              {comp.status === "missing" && <span className="text-slate-600 italic">Not entered</span>}
                              {comp.status === "absent"  && <span className="text-orange-400 font-semibold">Absent</span>}
                              {comp.status === "scored"  && <span className="text-slate-300">{comp.marks}/{comp.totalMarks}</span>}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {comp.pct !== null
                                ? <span className="text-slate-300">{comp.pct.toFixed(1)}%</span>
                                : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {comp.contribution !== null
                                ? <span className="text-yellow-400 font-semibold">+{comp.contribution.toFixed(2)}</span>
                                : <span className="text-slate-600">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {subj.status === "scored" && subj.percentage !== null && (
                        <tfoot>
                          <tr style={{ background: "rgba(30,41,59,0.4)", borderTop: "1px solid #1e293b" }}>
                            <td colSpan={4} className="py-2 px-4 text-right text-slate-400 font-semibold text-xs">Weighted Aggregate</td>
                            <td className="py-2 px-3 text-center text-emerald-400 font-bold">{subj.percentage}%</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Cross-term fail summary (mirrors teacher's ReportCardModal) ── */}
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

        {/* ── Policy Assessment Note ── */}
        {activeTermSubjects.length > 0 && (
          <div className="mx-5 mb-5 rounded-xl p-4"
            style={{ border: "1px solid #1e293b", background: "rgba(30,41,59,0.3)" }}>
            <p className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              Policy: {policy?.tierName}
            </p>
            <p className="text-xs text-slate-500">
              Marks are computed using weighted exam components and appear in real-time — no publish step needed.
            </p>
            {attendancePct !== null && (
              <p className="text-xs text-slate-500 mt-1">
                Your attendance:{" "}
                <span className={`font-semibold ${attendancePct < 75 ? "text-red-400" : "text-emerald-400"}`}>{attendancePct}%</span>
                {attendancePct < 75 && <span className="text-red-400 ml-1 text-[10px]">⚠ Below 75% minimum</span>}
              </p>
            )}
          </div>
        )}

        {/* Signature placeholders — matches teacher's ReportCardModal footer */}
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

  // ── Academic sessions (admin-configured) ────────────────────────────────────
  const { data: rawSessions = [], isLoading: sessionsLoading } = useQuery<AcademicSession[]>({
    queryKey: ["/api/student/academic-sessions"],
    enabled: !!student,
    staleTime: 60000,
  });

  const sessions = useMemo(
    () => (student ? mapSessionsToClasses(rawSessions, student.class) : []),
    [rawSessions, student],
  );

  // Auto-select active session on mount
  useEffect(() => {
    if (sessions.length > 0 && selectedSessionId === null) {
      const active = sessions.find(s => s.isActive) ?? sessions[0];
      setSelectedSessionId(active.id);
    }
  }, [sessions, selectedSessionId]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId) ?? null;
  const selectedClass = selectedSession?.cls ?? student?.class ?? "";

  // Reset tab sub-state when session changes
  useEffect(() => { setTab("view"); }, [selectedSessionId]);

  // ── Exam policy ─────────────────────────────────────────────────────────────
  const {
    data: policyData, isLoading: policyLoading, isError: policyMissing,
  } = useQuery<ExamPolicyTier>({
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

  // ── All scores for selected class (real-time, no published gate) ─────────────
  const { data: allScoresData, isLoading: scoresLoading } = useQuery<{ scores: ExamScore[]; cls: string }>({
    queryKey: ["/api/student/exam/all-scores", selectedClass],
    queryFn: async () => {
      const r = await fetch(
        `/api/student/exam/all-scores?class=${encodeURIComponent(selectedClass)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!selectedClass,
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

  if (studentLoading || sessionsLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#020617" }}>
        <Loader2 className="w-9 h-9 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#020617", color: "#e2e8f0" }}>
      <PrintStyles />

      {/* ── Sticky Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 no-print"
        style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", boxShadow: "0 1px 20px rgba(0,0,0,0.4)" }}>
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
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
                {student.digitalStudentId} · Class {student.class}-{student.section}
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

        {/* ── Session Pills (admin-configured) ──────────────────────────────── */}
        <div className="rounded-2xl p-4 no-print"
          style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">Academic Session</h2>
          </div>
          {sessions.length === 0 ? (
            <p className="text-slate-600 text-xs italic">No academic sessions configured by your admin.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {sessions.map(s => (
                <button key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
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
                  <span className="text-[10px] text-slate-600 whitespace-nowrap">Cl.{s.cls}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Main Tab Bar — EXACT replica of teacher's tab bar style ───────── */}
        <div className="flex gap-1.5 p-1 rounded-2xl no-print"
          style={{ background: "#020617", border: "1px solid #1e293b" }}
          data-testid="tabs-exam">
          {([
            { key: "view",    label: "View Marks", Icon: BarChart3 },
            { key: "results", label: "Results",    Icon: Award },
          ] as const).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                tab === key
                  ? "bg-yellow-500 text-[#020617] shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-[#1e293b]"
              }`}
              data-testid={`tab-${key}`}>
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* ── No-policy banner (shown under tabs so both sub-views can display a fallback) ── */}
        {!policyLoading && policyMissing && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium no-print"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24" }}>
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            No exam policy configured for Class {selectedClass} — aggregated results unavailable. Raw marks still shown in View Marks.
          </div>
        )}

        {/* ── Policy info strip when policy is loaded ───────────────────────── */}
        {!policyLoading && policyData && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium no-print"
            style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.18)", color: "#6ee7b7" }}>
            <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
            {policyData.tierName} · Session <strong>{selectedSession?.displayLabel}</strong> · Class {selectedClass}
          </div>
        )}

        {/* ── Tab Content ────────────────────────────────────────────────────── */}
        {tab === "view" && (
          <ViewMarksPanel
            allScores={allScores}
            policy={policyData ?? null}
            passThreshold={passThreshold}
            isLoading={isDataLoading}
            selectedClass={selectedClass}
            section={student.section}
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
            section={student.section}
            sessionLabel={selectedSession?.displayLabel ?? ""}
            studentName={student.name}
            dsid={student.digitalStudentId}
            onPrint={handlePrint}
          />
        )}

        {/* No sessions at all */}
        {sessions.length === 0 && !sessionsLoading && (
          <div className="rounded-2xl p-10 flex flex-col items-center gap-3 text-center"
            style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
            <Trophy className="w-8 h-8 text-slate-700" />
            <h3 className="text-slate-400 font-bold">No Academic Sessions Found</h3>
            <p className="text-slate-600 text-sm max-w-xs">
              Ask your school administrator to configure academic sessions in the admin portal.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
