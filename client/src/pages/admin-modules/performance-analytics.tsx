import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, Award, BarChart3, Search, X, FileText, Printer, TrendingUp,
  AlertTriangle, CheckCircle2, XCircle, Download, ChevronDown, ChevronUp, BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  schoolId: number;
  classes: string[];
  sections: string[];
  subjects: string[];
  examTypes: string[];
  classSections: Record<string, string[]>;
  classSubjects: Record<string, string[]>;
  classExamTypes: Record<string, string[]>;
  initialTab?: string;
  onNavigateTab?: (tab: string) => void;
  allowedSubs?: string[];
}

// ── Shared types ───────────────────────────────────────────────────────────────
interface ExamScoreEntry {
  id: number; studentId: number; studentName: string; dsid: string;
  marks: number; totalMarks: number; isAbsent: boolean;
  updatedBy?: string | null; updatedAt?: string | null;
}
interface StudentExamScore {
  id: number; subject: string; examType: string;
  marks: number; totalMarks: number; isAbsent: boolean;
}
interface ClassAvgEntry { examType: string; avgPercentage: number; }

// ── Results-tab types ─────────────────────────────────────────────────────────
interface RawStudentScore {
  studentId: number; name: string; digitalStudentId: string; rollNumber: number | null;
  scores: Array<{ subject: string; examType: string; marks: number; totalMarks: number; isAbsent: boolean }>;
}
interface AttendanceSummary { studentId: number; attendancePct: number | null; presentDays: number; totalDays: number; }
interface ExamPolicyTier {
  id: number; tierName: string; applicableClasses: string[]; examWeights: string;
  promotionFailRules: string; resultsConfig?: string;
}
interface CompBreakdown {
  sourceExam: string; weight: number;
  marks: number | null; totalMarks: number | null;
  isAbsent: boolean; pct: number | null; contribution: number | null;
  status: "scored" | "absent" | "missing";
}
interface SubjectTermResult {
  subject: string; percentage: number | null; passed: boolean | null;
  breakdown: CompBreakdown[]; status: "scored" | "absent" | "incomplete";
}
interface ComputedStudentResult {
  studentId: number; name: string; digitalStudentId: string; rollNumber: number | null;
  termResults: Record<string, SubjectTermResult[]>;
  allTermFailCounts: Record<string, number>;
  attendancePct: number | null;
  promoted: boolean; promotionReason: string;
  detentionViolations: string[];
}
interface GradingRuleClient {
  id: number; tierId: number; gradeLabel: string;
  minPercent: number; maxPercent: number; remarks: string | null; sortOrder: number;
}
type CumulConfigShape = {
  enabled: boolean; triggerTerm: string;
  termWeights: Record<string, number>;
  promotionEnabled?: boolean; minPercent?: number;
} | null;
interface PromoEntry {
  decision: "promoted" | "retained";
  targetClass: string; targetSection: string;
  editCount: number;
  editTrail: Array<{ ts: string; fromDecision: string; toDecision: string; toClass: string; toSection: string }>;
}

// ── Grade helpers ─────────────────────────────────────────────────────────────
function gradeColor(label: string): string {
  const l = label.toUpperCase();
  if (l === "O" || l === "A+") return "text-emerald-400";
  if (l.startsWith("A")) return "text-green-400";
  if (l === "B+") return "text-teal-400";
  if (l.startsWith("B")) return "text-blue-400";
  if (l.startsWith("C")) return "text-yellow-400";
  if (l.startsWith("D")) return "text-orange-400";
  return "text-red-400";
}
function gradeBg(label: string): string {
  const l = label.toUpperCase();
  if (l === "O" || l === "A+") return "bg-emerald-500/15 border-emerald-500/30";
  if (l.startsWith("A")) return "bg-green-500/15 border-green-500/30";
  if (l === "B+") return "bg-teal-500/15 border-teal-500/30";
  if (l.startsWith("B")) return "bg-blue-500/15 border-blue-500/30";
  if (l.startsWith("C")) return "bg-yellow-500/15 border-yellow-500/30";
  if (l.startsWith("D")) return "bg-orange-500/15 border-orange-500/30";
  return "bg-red-500/15 border-red-500/30";
}
function computeGrade(pct: number, rules: GradingRuleClient[]): { label: string; color: string; bg: string; remarks: string | null } {
  if (rules.length > 0) {
    const sorted = [...rules].sort((a, b) => b.minPercent - a.minPercent);
    for (const r of sorted) {
      if (pct >= r.minPercent) return { label: r.gradeLabel, color: gradeColor(r.gradeLabel), bg: gradeBg(r.gradeLabel), remarks: r.remarks };
    }
    const last = sorted[sorted.length - 1];
    return { label: last.gradeLabel, color: gradeColor(last.gradeLabel), bg: gradeBg(last.gradeLabel), remarks: last.remarks };
  }
  if (pct >= 90) return { label: "A+", color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/30", remarks: "Outstanding" };
  if (pct >= 80) return { label: "A",  color: "text-green-400",   bg: "bg-green-500/15 border-green-500/30",   remarks: "Excellent" };
  if (pct >= 70) return { label: "B+", color: "text-teal-400",    bg: "bg-teal-500/15 border-teal-500/30",    remarks: "Very Good" };
  if (pct >= 60) return { label: "B",  color: "text-blue-400",    bg: "bg-blue-500/15 border-blue-500/30",    remarks: "Good" };
  if (pct >= 50) return { label: "C+", color: "text-yellow-400",  bg: "bg-yellow-500/15 border-yellow-500/30", remarks: "Average" };
  if (pct >= 40) return { label: "C",  color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/30",  remarks: "Below Average" };
  if (pct >= 33) return { label: "D",  color: "text-orange-400",  bg: "bg-orange-500/15 border-orange-500/30", remarks: "Poor" };
  return { label: "F", color: "text-red-400", bg: "bg-red-500/15 border-red-500/30", remarks: "Fail" };
}

// ── Compute engine (exact copy from teacher examination.tsx) ──────────────────
function computeAllStudentResults(
  students: RawStudentScore[],
  policy: ExamPolicyTier,
  attendanceSummary: AttendanceSummary[],
  passPercentage: number = 35,
  ruleTermAvg?: { enabled: boolean; minPct: number },
  currentTerm?: string,
  cumulConfig?: CumulConfigShape,
): ComputedStudentResult[] {
  let rawWeights: Record<string, { source_exam: string; weight: number }[]> = {};
  let rules: any = {};
  try { rawWeights = JSON.parse(policy.examWeights || "{}"); } catch {}
  try { rules = JSON.parse(policy.promotionFailRules || "{}"); } catch {}

  const weights: Record<string, { source_exam: string; weight: number }[]> = {};
  for (const [k, v] of Object.entries(rawWeights)) weights[k.trim()] = v;
  const termNames = Object.keys(weights);
  const attendanceMap = new Map(attendanceSummary.map(a => [a.studentId, a]));

  return students.map(student => {
    const bySubject: Record<string, RawStudentScore["scores"]> = {};
    for (const sc of student.scores) {
      if (!bySubject[sc.subject]) bySubject[sc.subject] = [];
      bySubject[sc.subject].push(sc);
    }
    const termResults: Record<string, SubjectTermResult[]> = {};
    const allTermFailCounts: Record<string, number> = {};

    for (const termName of termNames) {
      const components = weights[termName] || [];
      const subjectResults: SubjectTermResult[] = [];
      for (const subject of Object.keys(bySubject)) {
        const subjectScores = bySubject[subject];
        let weightedSum = 0, totalWeight = 0, hasAbsent = false, hasData = false;
        const breakdown: CompBreakdown[] = [];
        for (const comp of components) {
          const record = subjectScores.find(s => s.examType === comp.source_exam);
          if (!record) {
            breakdown.push({ sourceExam: comp.source_exam, weight: comp.weight, marks: null, totalMarks: null, isAbsent: false, pct: null, contribution: null, status: "missing" });
            continue;
          }
          hasData = true;
          if (record.isAbsent) {
            hasAbsent = true;
            breakdown.push({ sourceExam: comp.source_exam, weight: comp.weight, marks: 0, totalMarks: record.totalMarks, isAbsent: true, pct: null, contribution: null, status: "absent" });
            continue;
          }
          const pct = record.totalMarks > 0 ? (record.marks / record.totalMarks) * 100 : 0;
          const contribution = pct * (comp.weight / 100);
          weightedSum += contribution; totalWeight += comp.weight;
          breakdown.push({ sourceExam: comp.source_exam, weight: comp.weight, marks: record.marks, totalMarks: record.totalMarks, isAbsent: false, pct, contribution, status: "scored" });
        }
        let percentage: number | null = null, passed: boolean | null = null;
        let status: SubjectTermResult["status"] = "incomplete";
        if (!hasData) { status = "incomplete"; }
        else if (hasAbsent) { status = "absent"; percentage = 0; passed = false; }
        else {
          const ep = totalWeight > 0 ? (weightedSum * 100) / totalWeight : 0;
          percentage = Math.round(ep * 10) / 10; passed = ep >= passPercentage; status = "scored";
        }
        subjectResults.push({ subject, percentage, passed, breakdown, status });
      }
      termResults[termName] = subjectResults;
      allTermFailCounts[termName] = subjectResults.filter(s => s.passed === false).length;
    }

    const violations: string[] = [];
    const rule1 = rules.rule1 ?? {}, ruleAtt = rules.rule_attendance ?? {};
    const attPct = attendanceMap.get(student.studentId)?.attendancePct ?? null;

    if (rule1.enabled !== false && termNames.length > 0) {
      type TR = { term: string; fail_count: number };
      const termRules: TR[] = Array.isArray(rule1.rules) && rule1.rules.length > 0
        ? (rule1.rules as any[]).map((r: any) => ({ term: String(r.term ?? "").trim(), fail_count: Number(r.fail_count ?? 3) }))
        : rule1.term ? [{ term: String(rule1.term).trim(), fail_count: Number(rule1.max_fails) || 3 }]
          : [{ term: termNames[termNames.length - 1], fail_count: Number(rule1.max_fails) || 3 }];
      for (const tr of termRules) {
        if (tr.fail_count <= 0) continue;
        const fails = allTermFailCounts[tr.term] ?? 0;
        if (fails >= tr.fail_count) {
          const failedNames = (termResults[tr.term] ?? []).filter(s => s.passed === false).map(s => s.subject);
          const maxAllowed = tr.fail_count - 1;
          const nameList = failedNames.length > 0 ? ` (${failedNames.join(", ")})` : "";
          violations.push(`The student failed ${fails} subject${fails !== 1 ? "s" : ""}${nameList} in ${tr.term}, which exceeds the maximum allowed limit of ${maxAllowed} failing subject${maxAllowed !== 1 ? "s" : ""} set by the school board.`);
        }
      }
    }
    if (ruleAtt.enabled === true && Array.isArray(ruleAtt.rules) && ruleAtt.rules.length > 0 && attPct !== null) {
      for (const r of ruleAtt.rules as any[]) {
        const minPct = Number(r.min_pct ?? 0);
        if (minPct <= 0) continue;
        if (attPct < minPct) {
          violations.push(`The student achieved an attendance rate of ${attPct.toFixed(1)}%${r.term ? ` in ${r.term}` : ""}, falling below the required minimum threshold of ${minPct}%.`);
          break;
        }
      }
    }
    if (ruleTermAvg?.enabled && currentTerm) {
      const scoredSubjects = (termResults[currentTerm] ?? []).filter(s => s.status === "scored");
      if (scoredSubjects.length > 0) {
        const avg = scoredSubjects.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / scoredSubjects.length;
        const rounded = Math.round(avg * 10) / 10;
        if (rounded < ruleTermAvg.minPct)
          violations.push(`The student's weighted average score for ${currentTerm} was ${rounded}%, which falls below the configured pass threshold of ${ruleTermAvg.minPct}%.`);
      }
    }
    const isCumulTerm = cumulConfig?.enabled && cumulConfig.triggerTerm && currentTerm
      ? currentTerm.trim() === cumulConfig.triggerTerm.trim() : false;
    if (isCumulTerm && cumulConfig?.promotionEnabled) {
      const minPct = cumulConfig.minPercent ?? 0;
      if (minPct > 0) {
        const twEntries = Object.entries(cumulConfig.termWeights ?? {});
        let totalContrib = 0, allHaveData = twEntries.length > 0;
        for (const [termName, weight] of twEntries) {
          const tScored = (termResults[termName.trim()] ?? []).filter(s => s.status === "scored");
          if (tScored.length === 0) { allHaveData = false; break; }
          totalContrib += (tScored.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / tScored.length) * (Number(weight) / 100);
        }
        if (allHaveData) {
          const cumPct = Math.round(totalContrib * 10) / 10;
          if (cumPct < minPct)
            violations.push(`The student's cumulative year-end percentage of ${cumPct}% falls below the required minimum threshold of ${minPct}%.`);
        }
      }
    }
    const promoted = violations.length === 0;
    return {
      studentId: student.studentId, name: student.name,
      digitalStudentId: student.digitalStudentId, rollNumber: student.rollNumber,
      termResults, allTermFailCounts, attendancePct: attPct,
      promoted, promotionReason: violations.length > 0 ? violations[0] : "Meets all promotion criteria.",
      detentionViolations: violations,
    };
  });
}

// ── Detention reason builder ───────────────────────────────────────────────────
function buildDetentionReasons(student: ComputedStudentResult, isManualOverride: boolean): string[] {
  if (isManualOverride) return ["The teacher has manually designated this student as Detained, overriding the automated promotion criteria."];
  if (student.detentionViolations.length > 0) return student.detentionViolations;
  if (!student.promoted) return [student.promotionReason];
  return [];
}

// ── Admin Student Timeline (mirrors teacher's StudentTimeline) ─────────────────
function AdminStudentTimeline({
  studentId, studentName, subject, examTypes: allExamTypes, viewClass, viewSection,
}: {
  studentId: number; studentName: string; subject: string;
  examTypes: string[]; viewClass: string; viewSection: string;
}) {
  const { data: scores = [], isLoading } = useQuery<StudentExamScore[]>({
    queryKey: ["/api/admin/analytics/student-scores", studentId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/student-scores/${studentId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    staleTime: 0,
  });

  const { data: classAverages = [] } = useQuery<ClassAvgEntry[]>({
    queryKey: ["/api/admin/analytics/class-average", viewClass, viewSection, subject],
    queryFn: async () => {
      const r = await fetch(
        `/api/admin/analytics/class-average/${encodeURIComponent(viewClass)}/${encodeURIComponent(viewSection)}/${encodeURIComponent(subject)}`,
        { credentials: "include" }
      );
      return r.ok ? r.json() : [];
    },
    enabled: !!viewClass && !!viewSection && !!subject,
  });

  const subjectScores = useMemo(() => scores.filter(s => s.subject === subject && !s.isAbsent), [scores, subject]);
  const avgMap = useMemo(() => {
    const m: Record<string, number> = {};
    classAverages.forEach(a => { m[a.examType] = a.avgPercentage; });
    return m;
  }, [classAverages]);

  const chartData = useMemo(() => {
    return allExamTypes.map(et => {
      const s = subjectScores.find(x => x.examType === et);
      const studentPct = s ? Math.round((s.marks / s.totalMarks) * 100) : null;
      const classAvg = avgMap[et] ?? null;
      return { exam: et, studentPct, classAvg };
    }).filter(Boolean) as { exam: string; studentPct: number | null; classAvg: number | null }[];
  }, [subjectScores, avgMap, allExamTypes]);

  const allSubjects = useMemo(() => {
    const map: Record<string, StudentExamScore[]> = {};
    for (const s of scores) { if (!map[s.subject]) map[s.subject] = []; map[s.subject].push(s); }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [scores]);

  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="mt-3 p-4 bg-muted/30 rounded-xl border" data-testid={`timeline-${studentId}`}>
      <h4 className="text-sm font-bold mb-3">{studentName} — Performance ({subject})</h4>
      {subjectScores.length === 0 ? (
        <p className="text-xs text-muted-foreground">No exam records found for this subject.</p>
      ) : (
        <>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead><tr className="border-b">
                <th className="text-left py-1.5 px-2">Exam</th>
                <th className="text-center py-1.5 px-2">Marks</th>
                <th className="text-center py-1.5 px-2">%</th>
                <th className="text-center py-1.5 px-2">Grade</th>
              </tr></thead>
              <tbody>
                {subjectScores.map((s, i) => {
                  const pct = Math.round((s.marks / s.totalMarks) * 100);
                  const g = computeGrade(pct, []);
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5 px-2 font-medium">{s.examType}</td>
                      <td className="py-1.5 px-2 text-center">{s.marks}/{s.totalMarks}</td>
                      <td className="py-1.5 px-2 text-center">{pct}%</td>
                      <td className="py-1.5 px-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${g.color} ${g.bg}`}>{g.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {chartData.length > 1 && (
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="exam" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip formatter={(value: number, name: string) => [`${value}%`, name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="studentPct" stroke="#6366f1" strokeWidth={2} name={studentName} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
                  <Line type="monotone" dataKey="classAvg" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Class Average" dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
      {allSubjects.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-indigo-500" />
            <h4 className="text-sm font-bold">360° Academic History</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {allSubjects.map(([subj, subjectScoresList]) => (
              <div key={subj} className="rounded-lg border bg-background p-3">
                <h5 className="text-xs font-semibold mb-2 text-indigo-600">{subj}</h5>
                <div className="space-y-1">
                  {subjectScoresList.map((s, i) => {
                    if (s.isAbsent) return (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-muted-foreground">{s.examType}</span>
                        <span className="font-bold text-gray-500">AB</span>
                      </div>
                    );
                    const pct = Math.round((s.marks / s.totalMarks) * 100);
                    const g = computeGrade(pct, []);
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-muted-foreground">{s.examType}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.marks}/{s.totalMarks}</span>
                          <span className="text-muted-foreground">({pct}%)</span>
                          <span className={`px-1 py-0.5 rounded border text-[9px] font-bold ${g.color} ${g.bg}`}>{g.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Report Card Modal (exact copy from teacher examination.tsx) ────────────────
function ReportCardModal({ student, term, policy, gradingRules, showPromoVerdict, promoEntry, onClose }: {
  student: ComputedStudentResult;
  term: string;
  policy: ExamPolicyTier;
  gradingRules: GradingRuleClient[];
  showPromoVerdict: boolean;
  promoEntry: PromoEntry | undefined;
  onClose: () => void;
}) {
  const termSubjects = student.termResults[term] ?? [];
  const isDetained = promoEntry?.decision === "retained";
  const isManualOverride = isDetained && student.promoted === true;
  const detentionReasons = isDetained ? buildDetentionReasons(student, isManualOverride) : [];

  const subjectsWithScores = termSubjects.filter(s => s.status === "scored");
  const overallAvg = subjectsWithScores.length > 0
    ? Math.round((subjectsWithScores.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / subjectsWithScores.length) * 10) / 10 : null;
  const overallGrade = overallAvg !== null ? computeGrade(overallAvg, gradingRules) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl bg-[#0f172a] border border-[#1e293b] rounded-2xl shadow-2xl my-4" data-testid="modal-report-card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e293b]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-yellow-500/20"><FileText className="w-5 h-5 text-yellow-400" /></div>
            <div>
              <h2 className="text-white font-bold text-base leading-tight">Performance Report Card</h2>
              <p className="text-slate-400 text-xs mt-0.5">Term: <span className="text-yellow-400 font-semibold">{term}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => window.print()}
              className="text-slate-400 hover:text-white hover:bg-white/10 h-8 hidden sm:flex gap-1.5" data-testid="btn-print-report">
              <Printer className="w-3.5 h-3.5" /> Print
            </Button>
            <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors" data-testid="btn-close-report">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 bg-[#1e293b]/50 border-b border-[#1e293b] flex flex-wrap gap-4 text-sm">
          <div><span className="text-slate-500 text-xs block">Student Name</span><span className="text-white font-semibold">{student.name}</span></div>
          <div><span className="text-slate-500 text-xs block">DSID</span><span className="text-slate-300 font-mono text-xs">{student.digitalStudentId}</span></div>
          {student.rollNumber !== null && <div><span className="text-slate-500 text-xs block">Roll No.</span><span className="text-slate-300">{student.rollNumber}</span></div>}
          <div className="ml-auto flex items-end gap-4">
            <div className="text-right">
              <span className="text-slate-500 text-xs block">Term Average</span>
              <span className="text-yellow-400 font-bold text-lg">{overallAvg !== null ? `${overallAvg}%` : "—"}</span>
            </div>
            {overallGrade && (
              <div className="text-right">
                <span className="text-slate-500 text-xs block">Overall Grade</span>
                <span className={`inline-flex items-center justify-center px-3 py-1 rounded-xl border text-xl font-bold ${overallGrade.color} ${overallGrade.bg}`} title={overallGrade.remarks ?? ""}>{overallGrade.label}</span>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Subject-wise Aggregation Breakdown</h3>
            <div className="space-y-3">
              {termSubjects.length === 0 && <p className="text-slate-500 text-sm italic text-center py-4">No subject data available for this term.</p>}
              {termSubjects.map(subj => (
                <div key={subj.subject} className="rounded-xl border border-[#1e293b] bg-[#0f172a] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-[#1e293b]/60 border-b border-[#1e293b]">
                    <span className="text-white text-sm font-semibold">{subj.subject}</span>
                    <div className="flex items-center gap-2">
                      {subj.percentage !== null && <span className="text-yellow-400 font-bold text-sm">{subj.percentage}%</span>}
                      {subj.status === "scored" && subj.percentage !== null && (() => { const g = computeGrade(subj.percentage, gradingRules); return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${g.color} ${g.bg}`} title={g.remarks ?? ""}>{g.label}</span>; })()}
                      {subj.passed === true && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">PASS</span>}
                      {subj.passed === false && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">FAIL</span>}
                      {subj.status === "incomplete" && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400 border border-slate-500/30">INCOMPLETE</span>}
                      {subj.status === "absent" && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">ABSENT</span>}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-[#1e293b]">
                        <th className="text-left py-2 px-4 text-slate-500 font-medium">Component</th>
                        <th className="text-center py-2 px-3 text-slate-500 font-medium w-20">Weight</th>
                        <th className="text-center py-2 px-3 text-slate-500 font-medium w-24">Raw Score</th>
                        <th className="text-center py-2 px-3 text-slate-500 font-medium w-20">Score %</th>
                        <th className="text-center py-2 px-3 text-slate-500 font-medium w-24">Contribution</th>
                      </tr></thead>
                      <tbody>
                        {subj.breakdown.map((comp, i) => (
                          <tr key={i} className="border-b border-[#1e293b]/50 last:border-0">
                            <td className="py-2 px-4 text-slate-300 font-medium">{comp.sourceExam}</td>
                            <td className="py-2 px-3 text-center text-slate-400">{comp.weight}%</td>
                            <td className="py-2 px-3 text-center">
                              {comp.status === "missing" && <span className="text-slate-600 italic">No data</span>}
                              {comp.status === "absent" && <span className="text-orange-400 font-semibold">Absent</span>}
                              {comp.status === "scored" && <span className="text-slate-300">{comp.marks}/{comp.totalMarks}</span>}
                            </td>
                            <td className="py-2 px-3 text-center">{comp.pct !== null ? <span className="text-slate-300">{comp.pct.toFixed(1)}%</span> : <span className="text-slate-600">—</span>}</td>
                            <td className="py-2 px-3 text-center">{comp.contribution !== null ? <span className="text-yellow-400 font-semibold">+{comp.contribution.toFixed(2)}</span> : <span className="text-slate-600">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                      {subj.status === "scored" && subj.percentage !== null && (
                        <tfoot><tr className="bg-[#1e293b]/40 border-t border-[#1e293b]">
                          <td colSpan={4} className="py-2 px-4 text-right text-slate-400 font-semibold text-xs">Weighted Aggregate</td>
                          <td className="py-2 px-3 text-center text-yellow-400 font-bold">{subj.percentage}%</td>
                        </tr></tfoot>
                      )}
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {Object.keys(student.allTermFailCounts).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Failure Count per Term</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(student.allTermFailCounts).map(([t, n]) => (
                  <div key={t} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${n > 0 ? "border-red-500/30 bg-red-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}>
                    <span className={n > 0 ? "text-red-400" : "text-emerald-400"}>{t}</span>
                    <span className={`font-bold ${n > 0 ? "text-red-300" : "text-emerald-300"}`}>{n} fail{n !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showPromoVerdict ? (
            promoEntry ? (
              <div className={`rounded-xl border overflow-hidden ${promoEntry.decision === "promoted" ? "border-emerald-500/30" : "border-red-500/30"}`}>
                <div className={`px-5 py-4 flex items-center gap-3 ${promoEntry.decision === "promoted" ? "bg-emerald-500/15" : "bg-red-500/15"}`}>
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 border ${promoEntry.decision === "promoted" ? "bg-emerald-500/25 border-emerald-500/40" : "bg-red-500/25 border-red-500/40"}`}>
                    {promoEntry.decision === "promoted" ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold leading-snug ${promoEntry.decision === "promoted" ? "text-emerald-300" : "text-red-300"}`}>
                      {promoEntry.decision === "promoted"
                        ? `Promoted to Class ${promoEntry.targetClass} — Section ${promoEntry.targetSection}`
                        : `Retained in Class ${promoEntry.targetClass} — Section ${promoEntry.targetSection}`}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Final Academic Verdict · {term}</p>
                  </div>
                  <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-bold border ${promoEntry.decision === "promoted" ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300" : "bg-red-500/20 border-red-500/30 text-red-300"}`}>
                    {promoEntry.decision === "promoted" ? "PROMOTED" : "DETAINED"}
                  </span>
                </div>
                {isDetained && detentionReasons.length > 0 && (
                  <div className="mx-5 mb-0 mt-0 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-red-300 uppercase tracking-wide mb-2">
                      <XCircle className="w-3.5 h-3.5 shrink-0" /> Reason{detentionReasons.length > 1 ? "s" : ""} for Detention
                    </p>
                    <ol className="space-y-1.5 list-none">
                      {detentionReasons.map((reason, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-red-100">
                          {detentionReasons.length > 1 && <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-red-500/30 border border-red-500/40 text-red-300 text-[9px] font-bold flex items-center justify-center">{i + 1}</span>}
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <div className="px-5 py-3 border-t border-[#1e293b] bg-[#0f172a] flex flex-wrap gap-4 text-xs text-slate-400">
                  {student.attendancePct !== null && <span>Attendance: <span className={`font-semibold ${student.attendancePct < 75 ? "text-red-400" : "text-emerald-400"}`}>{student.attendancePct}%</span></span>}
                  {promoEntry.decision === "promoted" && <span className="text-slate-600 text-[10px] italic flex-1 text-right">{student.promotionReason}</span>}
                </div>
                <div className="px-5 py-4 grid grid-cols-3 gap-6 border-t border-[#1e293b] bg-[#0f172a]">
                  {["Class Teacher", "Principal / H.O.D", "Parent / Guardian"].map(label => (
                    <div key={label} className="flex flex-col items-center gap-2">
                      <div className="w-full h-9 border-b border-dashed border-[#334155]" />
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider text-center">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl p-4 border border-amber-500/20 bg-amber-500/5 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-300">Promotion Verdict Not Yet Set</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">The class teacher has not yet filled the Promotion Ledger for this student.</p>
                </div>
              </div>
            )
          ) : (
            <div className="rounded-xl p-4 border border-[#1e293b] bg-[#1e293b]/30">
              <p className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-yellow-400" /> Policy Criteria Assessment
              </p>
              <p className="text-xs text-slate-400">{student.promotionReason}</p>
              {student.attendancePct !== null && <p className="text-xs text-slate-500 mt-1">Attendance: <span className={`font-semibold ${student.attendancePct < 75 ? "text-red-400" : "text-emerald-400"}`}>{student.attendancePct}%</span></p>}
              <p className="text-[10px] text-slate-600 italic mt-2">Promotion routing is determined in the Final Term Promotion Ledger.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Read-only Promotion Cell ───────────────────────────────────────────────────
function PromoCellReadOnly({ entry }: { entry: PromoEntry | undefined }) {
  if (!entry) return <span className="inline-flex items-center px-2.5 py-1.5 rounded-full text-xs font-bold border border-slate-700/50 bg-slate-800/30 text-slate-500">Not set</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold border ${entry.decision === "promoted" ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" : "bg-red-500/15 border-red-500/30 text-red-400"}`}>
      {entry.decision === "promoted"
        ? <><CheckCircle2 className="w-3 h-3" />Promoted → {entry.targetClass}-{entry.targetSection}</>
        : <><XCircle className="w-3 h-3" />Retained in {entry.targetClass}-{entry.targetSection}</>}
    </span>
  );
}

// ── Main Admin Performance Analytics ──────────────────────────────────────────
export default function PerformanceAnalytics({
  classes, sections: allSections, classSections, classSubjects, classExamTypes, examTypes: globalExamTypes,
  initialTab, onNavigateTab, allowedSubs,
}: Props) {
  const allAnalyticsTabs = [
    { key: "view" as const, label: "View Marks", Icon: BarChart3 },
    { key: "results" as const, label: "Results", Icon: Award },
  ];
  const visibleAnalyticsTabs = allowedSubs ? allAnalyticsTabs.filter(t => allowedSubs.includes(t.key)) : allAnalyticsTabs;
  const defaultAnalyticsTab = (visibleAnalyticsTabs[0]?.key ?? "view") as "view" | "results";
  const [tab, setTab] = useState<"view" | "results">(
    (initialTab === "view" || initialTab === "results") && (!allowedSubs || allowedSubs.includes(initialTab))
      ? initialTab : defaultAnalyticsTab
  );
  useEffect(() => {
    if ((initialTab === "view" || initialTab === "results") && (!allowedSubs || allowedSubs.includes(initialTab)))
      setTab(initialTab);
  }, [initialTab]);

  // ── View Marks state ─────────────────────────────────────────────
  const [viewClass, setViewClass] = useState("");
  const [viewSection, setViewSection] = useState("");
  const [viewSubject, setViewSubject] = useState("");
  const [viewExamType, setViewExamType] = useState("");
  const [expandedStudent, setExpandedStudent] = useState<number | null>(null);

  const viewSectionOpts = useMemo(() => {
    if (!viewClass) return [];
    const perClass = classSections[viewClass];
    return perClass?.length ? perClass : allSections;
  }, [viewClass, classSections, allSections]);

  const viewSubjectOpts = useMemo(() => {
    if (!viewClass) return [];
    const perClass = classSubjects[viewClass];
    return perClass?.length ? perClass : [];
  }, [viewClass, classSubjects]);

  // Exact replica of teacher's getExamTypesForClass logic
  const viewExamTypeOpts = useMemo(() => {
    if (viewClass && classExamTypes[viewClass]?.length) {
      const valid = globalExamTypes.length
        ? classExamTypes[viewClass].filter(et => globalExamTypes.includes(et))
        : classExamTypes[viewClass];
      return valid.length ? valid : globalExamTypes;
    }
    return globalExamTypes;
  }, [viewClass, classExamTypes, globalExamTypes]);

  function handleViewClassChange(cls: string) {
    setViewClass(cls); setViewSection(""); setViewSubject(""); setViewExamType(""); setExpandedStudent(null);
  }

  const { data: viewScores = [], isLoading: viewLoading } = useQuery<ExamScoreEntry[]>({
    queryKey: ["/api/admin/analytics/view-marks", viewClass, viewSection, viewSubject, viewExamType],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/analytics/view-marks/${encodeURIComponent(viewClass)}/${encodeURIComponent(viewSection)}/${encodeURIComponent(viewSubject)}/${encodeURIComponent(viewExamType)}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch scores");
      return res.json();
    },
    enabled: tab === "view" && !!viewClass && !!viewSection && !!viewSubject && !!viewExamType,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
  });

  function generateProgressReport() {
    const scored = viewScores.filter(s => !s.isAbsent);
    const absent = viewScores.filter(s => s.isAbsent);
    const totalMax = viewScores[0]?.totalMarks ?? 0;
    const gradedScores = scored.map(s => {
      const pct = totalMax > 0 ? Math.round((s.marks / totalMax) * 100) : 0;
      const g = computeGrade(pct, []);
      return { ...s, pct, grade: g.label, remarks: g.remarks ?? "" };
    }).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const passCount = gradedScores.filter(s => s.pct >= 33).length;
    const failCount = gradedScores.filter(s => s.pct < 33).length;
    const avgPct = scored.length > 0 ? Math.round(scored.reduce((sum, s) => sum + (totalMax > 0 ? (s.marks / totalMax) * 100 : 0), 0) / scored.length) : 0;
    const topper = gradedScores[0];
    const generatedOn = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
    const rows = viewScores.map((s, idx) => {
      if (s.isAbsent) return `<tr><td>${idx + 1}</td><td>${s.dsid}</td><td class="name">${s.studentName}</td><td>—</td><td>—</td><td>—</td><td><span class="badge absent">ABSENT</span></td><td>—</td></tr>`;
      const pct = totalMax > 0 ? Math.round((s.marks / totalMax) * 100) : 0;
      const g = computeGrade(pct, []);
      const isPass = pct >= 33;
      return `<tr><td>${idx + 1}</td><td>${s.dsid}</td><td class="name">${s.studentName}</td><td><strong>${s.marks}/${totalMax}</strong></td><td><strong>${pct}%</strong></td><td><span class="grade-badge">${g.label}</span></td><td><span class="badge ${isPass ? "pass" : "fail"}">${isPass ? "PASS" : "FAIL"}</span></td><td class="remarks">${g.remarks ?? ""}</td></tr>`;
    });
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Progress Report — ${viewSubject} ${viewExamType}</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1a1a2e;background:#fff;padding:20px;}@media print{body{padding:0;}button{display:none!important;}}.page-header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:16px;}.school-name{font-size:20px;font-weight:800;color:#1e3a5f;}.report-label h1{font-size:15px;font-weight:700;color:#1e3a5f;text-align:right;}.report-label p{font-size:10px;color:#64748b;text-align:right;}.meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;background:#f0f4f8;border-radius:8px;padding:12px 16px;margin-bottom:16px;}.meta-item label{font-size:9px;text-transform:uppercase;color:#64748b;display:block;}.meta-item span{font-size:13px;font-weight:700;color:#1e3a5f;}.stat-bar{display:flex;gap:10px;margin-bottom:16px;}.stat-card{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;text-align:center;}.stat-card .val{font-size:20px;font-weight:800;color:#1e3a5f;}.stat-card .lbl{font-size:9px;text-transform:uppercase;color:#64748b;}.stat-card.green{border-color:#d1fae5;background:#f0fdf4;}.stat-card.green .val{color:#065f46;}.stat-card.red{border-color:#fee2e2;background:#fff5f5;}.stat-card.red .val{color:#991b1b;}.stat-card.blue .val{color:#1e40af;}table{width:100%;border-collapse:collapse;margin-bottom:16px;}thead tr{background:#1e3a5f;color:#fff;}th{padding:9px 10px;text-align:left;font-size:10px;font-weight:600;}td{padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;}tr:nth-child(even) td{background:#f8fafc;}td.name{font-weight:600;color:#1e3a5f;}td.remarks{color:#64748b;font-style:italic;}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:9px;font-weight:700;}.badge.pass{background:#dcfce7;color:#166534;}.badge.fail{background:#fee2e2;color:#991b1b;}.badge.absent{background:#f1f5f9;color:#64748b;}.grade-badge{display:inline-block;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:800;background:#e0f2fe;color:#0c4a6e;}.print-btn{position:fixed;bottom:20px;right:20px;background:#1e3a5f;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;cursor:pointer;}</style></head><body>
<div class="page-header"><div><div class="school-name">Performance Report</div></div><div class="report-label"><h1>Progress Report</h1><p>Generated: ${generatedOn}</p></div></div>
<div class="meta-grid"><div class="meta-item"><label>Class</label><span>${viewClass}</span></div><div class="meta-item"><label>Section</label><span>${viewSection}</span></div><div class="meta-item"><label>Subject</label><span>${viewSubject}</span></div><div class="meta-item"><label>Exam</label><span>${viewExamType}</span></div></div>
<div class="stat-bar"><div class="stat-card blue"><div class="val">${viewScores.length}</div><div class="lbl">Total</div></div><div class="stat-card green"><div class="val">${passCount}</div><div class="lbl">Passed</div></div><div class="stat-card red"><div class="val">${failCount}</div><div class="lbl">Failed</div></div><div class="stat-card"><div class="val">${absent.length}</div><div class="lbl">Absent</div></div><div class="stat-card blue"><div class="val">${scored.length > 0 ? avgPct + "%" : "—"}</div><div class="lbl">Avg</div></div><div class="stat-card"><div class="val" style="font-size:13px">${topper ? topper.studentName.split(" ")[0] + " · " + topper.pct + "%" : "—"}</div><div class="lbl">Topper</div></div></div>
<table><thead><tr><th>#</th><th>DSID</th><th>Student Name</th><th>Marks</th><th>Score %</th><th>Grade</th><th>Result</th><th>Remarks</th></tr></thead><tbody>${rows.join("")}</tbody></table>
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button><script>setTimeout(()=>window.print(),400);</script></body></html>`;
    const win = window.open("", "_blank", "width=900,height=700");
    if (win) { win.document.write(html); win.document.close(); }
  }

  // ── Results tab state ─────────────────────────────────────────────
  const [resClass, setResClass] = useState("");
  const [resSection, setResSection] = useState("");
  const [resTerm, setResTerm] = useState("");
  const [resSearch, setResSearch] = useState("");
  const [reportStudent, setReportStudent] = useState<ComputedStudentResult | null>(null);

  const resSections = useMemo(() => resClass ? (classSections[resClass]?.length > 0 ? classSections[resClass] : allSections) : [], [resClass, classSections, allSections]);

  const {
    data: policyTier = null, isLoading: policyLoading, isError: policyIsError,
    error: policyErrorRaw, refetch: refetchPolicy,
  } = useQuery<ExamPolicyTier | null>({
    queryKey: ["/api/admin/analytics/exam-policy", resClass],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/exam-policy/${encodeURIComponent(resClass)}`, { credentials: "include" });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error((b as any).message || `No policy for class ${resClass}`); }
      return r.json();
    },
    enabled: !!resClass,
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, refetchInterval: 30000, retry: false,
  });
  const policyError = policyIsError ? ((policyErrorRaw as Error)?.message ?? "Failed to load policy") : null;

  const [gradingRules, setGradingRules] = useState<GradingRuleClient[]>([]);
  const [gradingPassPct, setGradingPassPct] = useState(35);
  useEffect(() => {
    if (!resClass) { setGradingRules([]); setGradingPassPct(35); return; }
    let cancelled = false;
    fetch(`/api/admin/analytics/grading-rules/${encodeURIComponent(resClass)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { rules: [], passPercentage: 35 })
      .then(d => { if (!cancelled) { setGradingRules(d.rules ?? []); setGradingPassPct(d.passPercentage ?? 35); } })
      .catch(() => { if (!cancelled) { setGradingRules([]); setGradingPassPct(35); } });
    return () => { cancelled = true; };
  }, [resClass]);

  function handleResClassChange(cls: string) { setResClass(cls); setResSection(""); setResTerm(""); }

  const { data: classScores = [], isLoading: scoresLoading } = useQuery<RawStudentScore[]>({
    queryKey: ["/api/admin/analytics/class-scores", resClass, resSection],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/class-scores/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch scores");
      return res.json();
    },
    enabled: !!resClass && !!resSection, staleTime: 0, refetchOnMount: "always",
    refetchOnWindowFocus: true, refetchInterval: 30000,
  });

  const { data: attendanceSummary = [] } = useQuery<AttendanceSummary[]>({
    queryKey: ["/api/admin/analytics/attendance-summary", resClass, resSection],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/attendance-summary/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: !!resClass && !!resSection, staleTime: 0, refetchOnMount: "always",
    refetchOnWindowFocus: true, refetchInterval: 30000,
  });

  const termNames = useMemo(() => {
    if (!policyTier) return [];
    try { const w = JSON.parse(policyTier.examWeights || "{}"); return Object.keys(w).map(k => k.trim()); } catch { return []; }
  }, [policyTier]);

  const { showCol, cumulConfig } = useMemo(() => {
    const defaults = { showCol: { studentProfile: true, weightedAvg: true, termGrade: true, subjectFails: true, attendance: true, promotionGate: true, reportCard: true, cumulativeTotal: false, finalGrade: false }, cumulConfig: null as CumulConfigShape };
    if (!policyTier?.resultsConfig) return defaults;
    try {
      const rc = JSON.parse(policyTier.resultsConfig);
      const cumConf = rc.cumulative ?? null;
      if (rc.termConfigs && resTerm) {
        const key = Object.keys(rc.termConfigs).find(k => k.trim() === resTerm.trim());
        const tc = key ? rc.termConfigs[key] : null;
        if (tc) return { showCol: { studentProfile: tc.studentProfile !== false, weightedAvg: tc.weightedAvg !== false, termGrade: tc.termGrade !== false, subjectFails: tc.subjectFails !== false, attendance: tc.attendance !== false, promotionGate: tc.promotionGate !== false, reportCard: tc.reportCard !== false, cumulativeTotal: tc.cumulativeTotal === true, finalGrade: tc.finalGrade === true }, cumulConfig: cumConf };
      }
      if (rc.columns) { const cols = rc.columns; return { showCol: { studentProfile: cols.studentProfile !== false, weightedAvg: cols.weightedAvg !== false, termGrade: cols.termGrade !== false, subjectFails: cols.subjectFails !== false, attendance: cols.attendance !== false, promotionGate: cols.promotionGate !== false, reportCard: cols.reportCard !== false, cumulativeTotal: cols.cumulativeTotal === true, finalGrade: cols.finalGrade === true }, cumulConfig: cumConf }; }
      return { ...defaults, cumulConfig: cumConf };
    } catch { return defaults; }
  }, [policyTier, resTerm]);

  const isCumulativeTerm = useMemo(() => cumulConfig?.enabled && cumulConfig.triggerTerm && resTerm ? resTerm.trim() === cumulConfig.triggerTerm.trim() : false, [cumulConfig, resTerm]);
  const ruleTermAvg = useMemo<{ enabled: boolean; minPct: number }>(() => {
    try { const pr = JSON.parse(policyTier?.promotionFailRules || "{}"); const rta = pr.rule_term_avg ?? {}; return { enabled: rta.enabled === true, minPct: Number(rta.minPct ?? 35) }; }
    catch { return { enabled: false, minPct: 35 }; }
  }, [policyTier]);

  useEffect(() => { if (termNames.length > 0 && !resTerm) setResTerm(termNames[0]); }, [termNames, resTerm]);

  const allResults = useMemo(() => {
    if (!policyTier || classScores.length === 0) return [];
    return computeAllStudentResults(classScores, policyTier, attendanceSummary, gradingPassPct, ruleTermAvg, resTerm || undefined, cumulConfig ?? undefined);
  }, [policyTier, classScores, attendanceSummary, gradingPassPct, ruleTermAvg, resTerm, cumulConfig]);

  const filteredResults = useMemo(() => {
    const q = resSearch.toLowerCase().trim();
    if (!q) return allResults;
    return allResults.filter(s => s.name.toLowerCase().includes(q) || s.digitalStudentId?.toLowerCase().includes(q) || String(s.rollNumber).includes(q));
  }, [allResults, resSearch]);

  const isLoading = policyLoading || scoresLoading;
  const ready = !!resClass && !!resSection && !!resTerm && !!policyTier;
  const isPromotionTerm = showCol.promotionGate;

  const [promoMap, setPromoMap] = useState<Record<number, PromoEntry>>({});
  const [promoLocked, setPromoLocked] = useState(false);

  const { data: savedDecisions = [] } = useQuery<Array<{ studentId: number; decision: string; targetClass: string; targetSection: string; editCount: number; locked: boolean }>>({
    queryKey: ["/api/admin/analytics/promotion-decisions", resClass, resSection, resTerm],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/promotion-decisions/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}/${encodeURIComponent(resTerm)}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!resClass && !!resSection && !!resTerm, staleTime: 0, refetchInterval: 30000,
  });

  useEffect(() => { setPromoMap({}); setPromoLocked(false); }, [resClass, resSection, resTerm]);
  useEffect(() => {
    if (!savedDecisions.length) return;
    setPromoLocked(savedDecisions.some(d => d.locked));
    setPromoMap(prev => {
      const next = { ...prev };
      savedDecisions.forEach(d => { if (!next[d.studentId]) next[d.studentId] = { decision: d.decision as "promoted" | "retained", targetClass: d.targetClass, targetSection: d.targetSection, editCount: d.editCount, editTrail: [] }; });
      return next;
    });
  }, [savedDecisions]);

  return (
    <div className="space-y-6">
      {/* ── Tab bar — identical styling to teacher examination module ── */}
      <div className="flex items-center gap-1.5 p-1 bg-[#020617] border border-[#1e293b] rounded-2xl" data-testid="tabs-analytics">
        {visibleAnalyticsTabs.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => { setTab(key); onNavigateTab?.(key); }}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === key ? "bg-yellow-500 text-[#020617] shadow-sm" : "text-slate-400 hover:text-white hover:bg-[#1e293b]"}`}
            data-testid={`tab-${key}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 px-3 shrink-0" title="Auto-syncs with teacher entries every 30 seconds">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">Live</span>
        </div>
      </div>

      {/* ── View Marks tab ── */}
      {tab === "view" && (
        <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a]" data-testid="card-view-marks">
          <div className="p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-5 h-5 text-yellow-400" />
              <h2 className="text-white font-bold text-base tracking-tight">View Marks — 360° History</h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Class *</label>
                <select value={viewClass} onChange={e => handleViewClassChange(e.target.value)}
                  className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-yellow-500/50"
                  style={{ colorScheme: "dark" }} data-testid="select-view-class">
                  <option value="">Select class</option>
                  {classes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Section *</label>
                <select value={viewSection} onChange={e => setViewSection(e.target.value)} disabled={!viewClass}
                  className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-yellow-500/50 disabled:opacity-50"
                  style={{ colorScheme: "dark" }} data-testid="select-view-section">
                  <option value="">Select section</option>
                  {viewSectionOpts.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Subject *</label>
                {viewSubjectOpts.length > 0 ? (
                  <select value={viewSubject} onChange={e => setViewSubject(e.target.value)} disabled={!viewClass}
                    className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-yellow-500/50 disabled:opacity-50"
                    style={{ colorScheme: "dark" }} data-testid="select-view-subject">
                    <option value="">Select subject</option>
                    {viewSubjectOpts.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input value={viewSubject} onChange={e => setViewSubject(e.target.value)} placeholder="Enter subject"
                    className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-yellow-500/50"
                    style={{ colorScheme: "dark" }} data-testid="input-view-subject" />
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Exam Type *</label>
                <select value={viewExamType} onChange={e => setViewExamType(e.target.value)}
                  className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-yellow-500/50"
                  style={{ colorScheme: "dark" }} data-testid="select-view-exam-type">
                  <option value="">Select exam type</option>
                  {viewExamTypeOpts.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {viewLoading ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="rounded-xl border border-[#1e293b] bg-[#1e293b]/30 p-4 animate-pulse"><div className="h-4 bg-[#1e293b] rounded w-3/4 mb-2" /><div className="h-4 bg-[#1e293b] rounded w-1/2" /></div>)}</div>
            ) : viewExamType && viewScores.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm" data-testid="text-no-scores">
                <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-20" />
                No scores recorded yet for this selection.
              </div>
            ) : viewExamType && viewScores.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-xl border border-[#1e293b]">
                  <table className="w-full text-sm" data-testid="table-view-scores">
                    <thead>
                      <tr className="bg-[#1e293b]/60 border-b border-[#1e293b]">
                        {["#", "DSID", "Name", "Marks", "%", "Grade", ""].map((h, i) => (
                          <th key={i} className={`py-2.5 px-3 text-xs font-semibold text-slate-400 ${i > 2 ? "text-center" : "text-left"} ${i === 0 ? "w-10" : i === 6 ? "w-10" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {viewScores.map((s, idx) => {
                        const isExpanded = expandedStudent === s.studentId;
                        const pct = s.isAbsent ? 0 : Math.round((s.marks / s.totalMarks) * 100);
                        const g = computeGrade(pct, []);
                        return (
                          <Fragment key={s.studentId}>
                            <tr className="border-b border-[#1e293b]/60 last:border-0 hover:bg-[#1e293b]/40 cursor-pointer transition-colors" onClick={() => setExpandedStudent(isExpanded ? null : s.studentId)} data-testid={`row-view-${s.studentId}`}>
                              <td className="py-2.5 px-3 text-xs text-slate-500">{idx + 1}</td>
                              <td className="py-2.5 px-3 font-mono text-xs text-slate-400">{s.dsid}</td>
                              <td className="py-2.5 px-3 text-sm font-semibold text-yellow-300 hover:text-yellow-200">{s.studentName}</td>
                              <td className="py-2.5 px-3 text-center text-xs text-slate-300">{s.isAbsent ? <span className="font-bold text-slate-500">AB</span> : `${s.marks}/${s.totalMarks}`}</td>
                              <td className="py-2.5 px-3 text-center text-xs font-semibold text-white">{s.isAbsent ? "—" : `${pct}%`}</td>
                              <td className="py-2.5 px-3 text-center">
                                {s.isAbsent ? <span className="text-xs text-slate-600">—</span> : <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${g.color} ${g.bg}`}>{g.label}</span>}
                              </td>
                              <td className="py-2.5 px-3 text-center text-slate-500">{isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</td>
                            </tr>
                            {isExpanded && (
                              <tr><td colSpan={7} className="p-0 bg-[#020617]">
                                <AdminStudentTimeline studentId={s.studentId} studentName={s.studentName} subject={viewSubject} examTypes={viewExamTypeOpts} viewClass={viewClass} viewSection={viewSection} />
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button onClick={generateProgressReport}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#1e293b] bg-[#1e293b]/50 text-slate-300 hover:text-white hover:bg-[#1e293b] text-sm font-medium transition-colors"
                  data-testid="button-download-report">
                  <Download className="w-4 h-4" /> Download Progress Report
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Results tab ── */}
      {tab === "results" && (
        <div className="space-y-5" data-testid="tab-results">
          <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Award className="w-5 h-5 text-yellow-400" />
              <h2 className="text-white font-bold text-base">Performance & Promotion Results</h2>
              <span className="ml-auto px-2.5 py-1 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20 text-[#D4AF37] text-[10px] font-bold uppercase tracking-wide">Admin View · Read-Only</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Class *</label>
                <select value={resClass} onChange={e => handleResClassChange(e.target.value)}
                  className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-yellow-500/50"
                  style={{ colorScheme: "dark" }} data-testid="select-results-class">
                  <option value="">Select class</option>
                  {classes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Section *</label>
                <select value={resSection} onChange={e => setResSection(e.target.value)} disabled={!resClass}
                  className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-yellow-500/50 disabled:opacity-50"
                  style={{ colorScheme: "dark" }} data-testid="select-results-section">
                  <option value="">Select section</option>
                  {resSections.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Term *</label>
                <select value={resTerm} onChange={e => setResTerm(e.target.value)} disabled={!resClass || termNames.length === 0}
                  className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-yellow-500/50 disabled:opacity-50"
                  style={{ colorScheme: "dark" }} data-testid="select-results-term">
                  <option value="">{!resClass ? "Pick class first" : policyLoading ? "Loading…" : policyError ? "No policy" : termNames.length === 0 ? "No terms" : "Select term"}</option>
                  {termNames.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Quick Search</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <Input value={resSearch} onChange={e => setResSearch(e.target.value)} placeholder="Name / DSID / Roll…"
                    className="pl-8 h-9 bg-[#020617] border-[#1e293b] text-white text-sm placeholder:text-slate-600 rounded-xl" data-testid="input-results-search" />
                </div>
              </div>
            </div>

            {resClass && !policyLoading && (policyTier || policyError) && (
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {policyTier && (<><span className="px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 font-semibold">{policyTier.tierName}</span><span>policy applied · {termNames.length} term{termNames.length !== 1 ? "s" : ""} configured</span></>)}
                </div>
                <button onClick={() => refetchPolicy()}
                  className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-yellow-400 transition-colors px-2 py-1 rounded-lg hover:bg-yellow-500/10 border border-transparent hover:border-yellow-500/20"
                  data-testid="btn-refresh-policy">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>
                  Refresh
                </button>
              </div>
            )}
            {policyLoading && resClass && <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3 h-3 animate-spin" /><span>Loading policy…</span></div>}
            {resClass && !policyLoading && policyError && (
              <div className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
                <div className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{policyError.toLowerCase().startsWith("no policy") || policyError.toLowerCase().startsWith("no exam policy") ? `No Exam Policy configured for Class ${resClass}. Set one up in School Setup → Exam Aggregation & Promotion Policy.` : policyError}</span></div>
                <button onClick={() => refetchPolicy()} className="self-start flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-100 underline underline-offset-2 transition-colors" data-testid="btn-retry-policy">↻ Retry</button>
              </div>
            )}
          </div>

          {isLoading && resClass && resSection && (
            <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-2xl bg-[#0f172a] border border-[#1e293b] animate-pulse" />)}</div>
          )}

          {ready && !isLoading && (
            <>
              {filteredResults.length === 0 ? (
                <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] p-12 text-center">
                  <TrendingUp className="w-10 h-10 mx-auto mb-3 text-slate-700" />
                  <p className="text-slate-500 text-sm">{resSearch ? "No students match your search." : "No student score data available for this class & section yet."}</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] overflow-hidden" data-testid="results-table">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#1e293b] border-b border-[#1e293b]">
                    {[
                      { label: "Total Students", value: filteredResults.length },
                      { label: "Promoted", value: filteredResults.filter(r => promoMap[r.studentId]?.decision === "promoted").length, color: "text-emerald-400" },
                      { label: "Retained", value: filteredResults.filter(r => promoMap[r.studentId]?.decision === "retained").length, color: "text-red-400" },
                      { label: "Avg Attendance", value: (() => { const v = filteredResults.filter(r => r.attendancePct !== null); return v.length === 0 ? "—" : `${Math.round(v.reduce((s, r) => s + (r.attendancePct ?? 0), 0) / v.length)}%`; })(), color: "text-yellow-400" },
                    ].map(stat => (
                      <div key={stat.label} className="bg-[#0f172a] px-4 py-3">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">{stat.label}</p>
                        <p className={`text-xl font-bold mt-0.5 ${stat.color ?? "text-white"}`}>{stat.value}</p>
                      </div>
                    ))}
                  </div>

                  {showCol.promotionGate && (
                    <div className="px-4 py-3 border-b border-[#1e293b] flex flex-wrap items-center gap-3">
                      {promoLocked && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[11px] font-bold">🔒 Ledger Locked</span>}
                      {!promoLocked && savedDecisions.length > 0 && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px] font-semibold">📋 Draft Saved</span>}
                      <span className="text-[11px] text-slate-500 italic">Promotion decisions are set by the class teacher — Admin view is read-only.</span>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ minWidth: "640px" }}>
                      <thead>
                        <tr className="border-b border-[#1e293b] bg-[#1e293b]/40">
                          <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 w-10">#</th>
                          {showCol.studentProfile && <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400">Student</th>}
                          {showCol.weightedAvg && <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400">Weighted Avg<br /><span className="font-normal text-slate-600">({resTerm})</span></th>}
                          {showCol.termGrade && <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400">Grade<br /><span className="font-normal text-slate-600">({resTerm})</span></th>}
                          {showCol.subjectFails && <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400">Subject Fails<br /><span className="font-normal text-slate-600">({resTerm})</span></th>}
                          {showCol.attendance && <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400">Attendance</th>}
                          {showCol.promotionGate && <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400">Promotion Gate</th>}
                          {showCol.cumulativeTotal && isCumulativeTerm && <th className="text-center py-3 px-4 text-xs font-semibold text-blue-400">Cumulative Total %<br /><span className="font-normal text-blue-600 text-[10px]">{cumulConfig ? Object.entries(cumulConfig.termWeights ?? {}).map(([t, w]) => `${t}×${w}%`).join(" + ") : ""}</span></th>}
                          {showCol.finalGrade && isCumulativeTerm && <th className="text-center py-3 px-4 text-xs font-semibold text-blue-400">Final Grade</th>}
                          {showCol.reportCard && <th className="text-center py-3 px-3 text-xs font-semibold text-slate-400 w-28">Report</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredResults.map((student, idx) => {
                          const termSubjects = student.termResults[resTerm] ?? [];
                          const scoredSubjs = termSubjects.filter(s => s.status === "scored");
                          const weightedAvg = scoredSubjs.length > 0 ? Math.round((scoredSubjs.reduce((s, sub) => s + (sub.percentage ?? 0), 0) / scoredSubjs.length) * 10) / 10 : null;
                          const failCount = student.allTermFailCounts[resTerm] ?? 0;
                          const att = student.attendancePct;

                          let cumulativePct: number | null = null;
                          if (isCumulativeTerm && cumulConfig?.termWeights) {
                            const twEntries = Object.entries(cumulConfig.termWeights);
                            let totalContrib = 0, allHaveData = twEntries.length > 0;
                            for (const [termName, weight] of twEntries) {
                              const tSubjs = student.termResults[termName.trim()] ?? [];
                              const tScored = tSubjs.filter(s => s.status === "scored");
                              if (tScored.length === 0) { allHaveData = false; break; }
                              totalContrib += (tScored.reduce((s, sub) => s + (sub.percentage ?? 0), 0) / tScored.length) * (Number(weight) / 100);
                            }
                            if (allHaveData) cumulativePct = Math.round(totalContrib * 10) / 10;
                          }

                          return (
                            <tr key={student.studentId} className="border-b border-[#1e293b]/60 hover:bg-[#1e293b]/30 transition-colors" data-testid={`result-row-${student.studentId}`}>
                              <td className="py-3 px-4 text-slate-500 text-xs">{student.rollNumber ?? idx + 1}</td>
                              {showCol.studentProfile && (
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                                      <span className="text-yellow-400 font-bold text-xs">{student.name.charAt(0)}</span>
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-white font-semibold text-sm truncate">{student.name}</p>
                                      <p className="text-slate-500 font-mono text-[10px]">{student.digitalStudentId}</p>
                                    </div>
                                  </div>
                                </td>
                              )}
                              {showCol.weightedAvg && (
                                <td className="py-3 px-4 text-center">
                                  {weightedAvg !== null ? (
                                    <div>
                                      <span className={`text-base font-bold ${weightedAvg >= 60 ? "text-emerald-400" : weightedAvg >= gradingPassPct ? "text-yellow-400" : "text-red-400"}`}>{weightedAvg}%</span>
                                      <div className="w-20 mx-auto mt-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
                                        <div className={`h-full rounded-full ${weightedAvg >= 60 ? "bg-emerald-500" : weightedAvg >= gradingPassPct ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, weightedAvg)}%` }} />
                                      </div>
                                    </div>
                                  ) : <span className="text-slate-600 text-xs italic">No data</span>}
                                </td>
                              )}
                              {showCol.termGrade && (
                                <td className="py-3 px-4 text-center">
                                  {weightedAvg !== null ? (() => { const g = computeGrade(weightedAvg, gradingRules); return <span className={`inline-flex items-center justify-center min-w-[2.2rem] px-2 py-1 rounded-lg border text-sm font-bold ${g.color} ${g.bg}`} title={g.remarks ?? ""} data-testid={`grade-${student.studentId}`}>{g.label}</span>; })() : <span className="text-slate-600 text-xs">—</span>}
                                </td>
                              )}
                              {showCol.subjectFails && (
                                <td className="py-3 px-4 text-center">
                                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border ${failCount === 0 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : failCount <= 2 ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>{failCount}</span>
                                </td>
                              )}
                              {showCol.attendance && (
                                <td className="py-3 px-4 text-center">
                                  {att !== null ? (
                                    <div className="flex flex-col items-center gap-1">
                                      <span className={`text-xs font-bold ${att < 75 ? "text-red-400" : att < 85 ? "text-yellow-400" : "text-emerald-400"}`}>{att}%</span>
                                      <div className="w-16 h-1.5 rounded-full bg-[#1e293b] overflow-hidden"><div className={`h-full rounded-full ${att < 75 ? "bg-red-500" : att < 85 ? "bg-yellow-500" : "bg-emerald-500"}`} style={{ width: `${att}%` }} /></div>
                                      {att < 75 && <span className="text-[9px] text-red-400">Low</span>}
                                    </div>
                                  ) : <span className="text-slate-600 text-xs">—</span>}
                                </td>
                              )}
                              {showCol.promotionGate && <td className="py-3 px-4 text-center"><PromoCellReadOnly entry={promoMap[student.studentId]} /></td>}
                              {showCol.cumulativeTotal && isCumulativeTerm && (
                                <td className="py-3 px-4 text-center">
                                  {cumulativePct !== null ? (
                                    <div>
                                      <span className={`text-base font-bold ${cumulativePct >= 60 ? "text-blue-300" : cumulativePct >= gradingPassPct ? "text-blue-400" : "text-red-400"}`}>{cumulativePct}%</span>
                                      <div className="w-20 mx-auto mt-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden"><div className={`h-full rounded-full ${cumulativePct >= 60 ? "bg-blue-500" : cumulativePct >= gradingPassPct ? "bg-blue-400" : "bg-red-500"}`} style={{ width: `${Math.min(100, cumulativePct)}%` }} /></div>
                                    </div>
                                  ) : <span className="text-slate-600 text-xs italic" title="Scores for all contributing terms are required">Partial</span>}
                                </td>
                              )}
                              {showCol.finalGrade && isCumulativeTerm && (
                                <td className="py-3 px-4 text-center">
                                  {cumulativePct !== null ? (() => { const g = computeGrade(cumulativePct, gradingRules); return <span className={`inline-flex items-center justify-center min-w-[2.2rem] px-2 py-1 rounded-lg border text-sm font-bold ${g.color} ${g.bg}`} title={g.remarks ?? ""} data-testid={`cumul-grade-${student.studentId}`}>{g.label}</span>; })() : <span className="text-slate-600 text-xs">—</span>}
                                </td>
                              )}
                              {showCol.reportCard && (
                                <td className="py-3 px-3 text-center">
                                  <button onClick={() => setReportStudent(student)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-semibold hover:bg-yellow-500/20 transition-colors" data-testid={`btn-report-card-${student.studentId}`}>
                                    <FileText className="w-3 h-3" /> Report
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {reportStudent && policyTier && (
            <ReportCardModal student={reportStudent} term={resTerm} policy={policyTier} gradingRules={gradingRules} showPromoVerdict={isPromotionTerm} promoEntry={promoMap[reportStudent.studentId]} onClose={() => setReportStudent(null)} />
          )}
        </div>
      )}
    </div>
  );
}
