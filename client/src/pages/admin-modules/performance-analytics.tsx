import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { sessionFetch } from "@/lib/queryClient";
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
import { useSessionView } from "@/contexts/session-view-context";
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
  grade: string | null; gradePoint: string | null; remarks: string | null;
}
interface ComputedStudentResult {
  studentId: number; name: string; digitalStudentId: string; rollNumber: number | null;
  termResults: Record<string, SubjectTermResult[]>;
  allTermFailCounts: Record<string, number>;
  attendancePct: number | null;
  promoted: boolean | null; promotionReason: string;
  detentionViolations: string[];
  termAverages: Record<string, number | null>;
  termGrades: Record<string, { label: string; gradePoint: string | null; remarks: string | null } | null>;
  cumulativeAverage: number | null;
  cumulativeGrade: { label: string; gradePoint: string | null; remarks: string | null } | null;
  complete: boolean;
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
        subjectResults.push({ subject, percentage, passed, breakdown, status, grade: null, gradePoint: null, remarks: null });
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
      termAverages: {},
      termGrades: {},
      cumulativeAverage: null,
      cumulativeGrade: null,
      complete: true,
    };
  });
}

type AuthoritativeAcademicResult = {
  scope: { studentId: number };
  subjectResults: Array<{ subject: string; terms: Record<string, {
    percentage: number | null; grade: string | null; gradePoint: string | null; remarks: string | null;
    status: "pass" | "fail" | "absent" | "incomplete"; breakdown: CompBreakdown[];
  }> }>;
  termAverages: Record<string, number | null>;
  termGrades: ComputedStudentResult["termGrades"];
  cumulativeAverage: number | null;
  cumulativeGrade: ComputedStudentResult["cumulativeGrade"];
  attendance: Record<string, number | null>;
  failedSubjectCounts: Record<string, number>;
  violations: Array<{ rule: string; term?: string; reason: string }>;
  promoted: boolean | null;
  complete: boolean;
  name: string; digitalStudentId: string; rollNumber: number | null;
};

function mapAuthoritativeResult(result: AuthoritativeAcademicResult, selectedTerm: string): ComputedStudentResult {
  const termResults: Record<string, SubjectTermResult[]> = {};
  for (const subject of result.subjectResults) {
    for (const [term, value] of Object.entries(subject.terms)) {
      (termResults[term] ??= []).push({
        subject: subject.subject,
        percentage: value.percentage,
        passed: value.status === "pass" ? true : value.status === "fail" ? false : null,
        breakdown: value.breakdown,
        status: value.status === "pass" || value.status === "fail" ? "scored" : value.status,
        grade: value.grade,
        gradePoint: value.gradePoint,
        remarks: value.remarks,
      });
    }
  }
  const violations = result.violations.map(v => `${v.term ? `${v.term}: ` : ""}${v.reason}`);
  return {
    studentId: result.scope.studentId,
    name: result.name,
    digitalStudentId: result.digitalStudentId,
    rollNumber: result.rollNumber,
    termResults,
    allTermFailCounts: result.failedSubjectCounts,
    attendancePct: result.attendance[selectedTerm] ?? null,
    promoted: result.promoted,
    promotionReason: result.promoted === null
      ? "No authoritative promotion verdict is available until the academic data or policy configuration is complete."
      : violations[0] ?? "Meets all promotion criteria.",
    detentionViolations: violations,
    termAverages: result.termAverages,
    termGrades: result.termGrades,
    cumulativeAverage: result.cumulativeAverage,
    cumulativeGrade: result.cumulativeGrade,
    complete: result.complete,
  };
}

function findAuthoritativeComponent(
  result: AuthoritativeAcademicResult | undefined,
  subjectName: string,
  examType: string,
) {
  const subject = result?.subjectResults.find(item => item.subject === subjectName);
  if (!subject) return null;
  for (const [term, termResult] of Object.entries(subject.terms)) {
    const component = termResult.breakdown.find(item => item.sourceExam === examType);
    if (component) return { component, term, termResult };
  }
  return null;
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
      const r = await sessionFetch(`/api/admin/analytics/student-scores/${studentId}`);
      return r.ok ? r.json() : [];
    },
    staleTime: 0,
  });

  const { data: classAverages = [] } = useQuery<ClassAvgEntry[]>({
    queryKey: ["/api/admin/analytics/class-average", viewClass, viewSection, subject],
    queryFn: async () => {
      const r = await sessionFetch(
        `/api/admin/analytics/class-average/${encodeURIComponent(viewClass)}/${encodeURIComponent(viewSection)}/${encodeURIComponent(subject)}`
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
              </tr></thead>
              <tbody>
                {subjectScores.map((s, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5 px-2 font-medium">{s.examType}</td>
                      <td className="py-1.5 px-2 text-center">{s.marks}/{s.totalMarks}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
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
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-muted-foreground">{s.examType}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.marks}/{s.totalMarks}</span>
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
function ReportCardModal({ student, term, policy, showPromoVerdict, promoEntry, onClose }: {
  student: ComputedStudentResult;
  term: string;
  policy: ExamPolicyTier;
  showPromoVerdict: boolean;
  promoEntry: PromoEntry | undefined;
  onClose: () => void;
}) {
  const termSubjects = student.termResults[term] ?? [];
  const isDetained = promoEntry?.decision === "retained";
  const isManualOverride = isDetained && student.promoted === true;
  const detentionReasons = isDetained ? buildDetentionReasons(student, isManualOverride) : [];

  const overallAvg = student.termAverages[term] ?? null;
  const overallGrade = student.termGrades[term] ?? null;

  function printReportCard() {
    const esc = (s: string | number | null | undefined) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Subject rows
    const subjectRows = termSubjects.map(subj => {
      const g = subj.grade;
      const statusBadge = subj.status === "incomplete"
        ? `<span class="badge incomplete">INCOMPLETE</span>`
        : subj.status === "absent"
          ? `<span class="badge absent">ABSENT</span>`
          : subj.passed === true
            ? `<span class="badge pass">PASS</span>`
            : subj.passed === false
              ? `<span class="badge fail">FAIL</span>` : "";
      const gradeBadge = g ? `<span class="grade">${esc(g)}</span>` : "";
      const pctCell = subj.percentage !== null ? `${esc(subj.percentage)}%` : "—";

      const compRows = subj.breakdown.map(comp => `
        <tr>
          <td style="padding-left:24px;color:#475569">${esc(comp.sourceExam)}</td>
          <td class="center">${esc(comp.weight)}%</td>
          <td class="center">${
            comp.status === "missing" ? '<span style="color:#94a3b8;font-style:italic">No data</span>' :
            comp.status === "absent" ? '<span style="color:#f97316;font-weight:600">Absent</span>' :
            `${esc(comp.marks)}/${esc(comp.totalMarks)}`
          }</td>
          <td class="center">${comp.pct !== null ? `${comp.pct.toFixed(1)}%` : "—"}</td>
          <td class="center">${comp.contribution !== null ? `+${comp.contribution.toFixed(2)}` : "—"}</td>
        </tr>`).join("");

      return `
        <div class="subj-block">
          <div class="subj-header">
            <span class="subj-name">${esc(subj.subject)}</span>
            <span class="subj-meta">
              ${pctCell !== "—" ? `<strong>${esc(pctCell)}</strong>` : ""}
              ${gradeBadge} ${statusBadge}
            </span>
          </div>
          <table>
            <thead><tr>
              <th>Component</th><th class="center w16">Weight</th>
              <th class="center w20">Raw Score</th><th class="center w16">Score %</th>
              <th class="center w20">Contribution</th>
            </tr></thead>
            <tbody>${compRows}</tbody>
            ${subj.status === "scored" && subj.percentage !== null ? `
            <tfoot><tr class="agg-row">
              <td colspan="4" style="text-align:right;color:#64748b;font-weight:600">Weighted Aggregate</td>
              <td class="center" style="font-weight:700;color:#b45309">${esc(subj.percentage)}%</td>
            </tr></tfoot>` : ""}
          </table>
        </div>`;
    }).join("");

    // Failure counts per term
    const failCounts = Object.entries(student.allTermFailCounts);
    const failSection = failCounts.length > 0 ? `
      <div class="section-title">Failure Count per Term</div>
      <div class="fail-row">
        ${failCounts.map(([t, n]) => `
          <span class="fail-chip ${n > 0 ? "fail-chip-red" : "fail-chip-green"}">
            ${esc(t)}&nbsp;·&nbsp;<strong>${n} fail${n !== 1 ? "s" : ""}</strong>
          </span>`).join("")}
      </div>` : "";

    // Promotion verdict
    let verdictSection = "";
    if (student.promoted === null) {
      verdictSection = `
        <div class="policy-box">
          <p class="policy-title">Academic Result Incomplete</p>
          <p class="policy-reason">${esc(student.promotionReason)}</p>
        </div>`;
    } else if (showPromoVerdict && promoEntry) {
      const isP = promoEntry.decision === "promoted";
      const verdictLabel = isP
        ? `Promoted to Class ${esc(promoEntry.targetClass)} — Section ${esc(promoEntry.targetSection)}`
        : `Retained in Class ${esc(promoEntry.targetClass)} — Section ${esc(promoEntry.targetSection)}`;
      const reasons = isDetained && detentionReasons.length > 0
        ? `<div class="detention-reasons"><p class="detention-title">Reason${detentionReasons.length > 1 ? "s" : ""} for Detention</p><ol>${
            detentionReasons.map(r => `<li>${esc(r)}</li>`).join("")}</ol></div>` : "";
      const attLine = student.attendancePct !== null
        ? `<span class="meta-att ${student.attendancePct < 75 ? "att-warn" : "att-ok"}">Attendance: ${esc(student.attendancePct)}%</span>` : "";
      verdictSection = `
        <div class="verdict-box ${isP ? "verdict-promoted" : "verdict-retained"}">
          <div class="verdict-header">
            <span class="verdict-icon">${isP ? "✓" : "✗"}</span>
            <div class="verdict-text">
              <strong>${verdictLabel}</strong>
              <span class="verdict-sub">Final Academic Verdict · ${esc(term)}</span>
            </div>
            <span class="verdict-badge ${isP ? "badge-promoted" : "badge-retained"}">${isP ? "PROMOTED" : "DETAINED"}</span>
          </div>
          ${reasons}
          <div class="verdict-footer">${attLine}${isP ? `<span class="verdict-reason">${esc(student.promotionReason)}</span>` : ""}</div>
        </div>`;
    } else if (!showPromoVerdict) {
      verdictSection = `
        <div class="policy-box">
          <p class="policy-title">Policy Criteria Assessment</p>
          <p class="policy-reason">${esc(student.promotionReason)}</p>
          ${student.attendancePct !== null ? `<p class="policy-att ${student.attendancePct < 75 ? "att-warn" : "att-ok"}">Attendance: ${esc(student.attendancePct)}%</p>` : ""}
        </div>`;
    }

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>Performance Report Card — ${esc(student.name)} · ${esc(term)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1e293b;background:#fff;padding:24px 28px;}
@media print{body{padding:0;}button{display:none!important;}}
.page-header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:16px;}
.app-name{font-size:20px;font-weight:800;color:#1e3a5f;}
.report-title h1{font-size:15px;font-weight:700;color:#1e3a5f;text-align:right;}
.report-title p{font-size:10px;color:#64748b;text-align:right;}
.meta-bar{display:flex;flex-wrap:wrap;gap:20px;background:#f0f4f8;border-radius:8px;padding:12px 16px;margin-bottom:16px;align-items:center;}
.meta-item label{font-size:9px;text-transform:uppercase;color:#64748b;display:block;}
.meta-item span{font-size:13px;font-weight:700;color:#1e3a5f;}
.meta-avg{margin-left:auto;text-align:right;}
.meta-avg .avg-val{font-size:22px;font-weight:800;color:#b45309;}
.meta-avg label{font-size:9px;text-transform:uppercase;color:#64748b;}
.section-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin:14px 0 8px;}
.subj-block{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:10px;}
.subj-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;}
.subj-name{font-weight:700;color:#1e3a5f;font-size:12px;}
.subj-meta{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#b45309;}
table{width:100%;border-collapse:collapse;}
th{padding:7px 10px;text-align:left;font-size:10px;font-weight:600;background:#1e3a5f;color:#fff;}
td{padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#334155;}
tr:last-child td{border-bottom:none;}
.center{text-align:center;}
.w16{width:60px;}.w20{width:80px;}
.agg-row td{background:#fefce8;}
.badge{display:inline-block;padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700;}
.badge.pass{background:#dcfce7;color:#166534;}
.badge.fail{background:#fee2e2;color:#991b1b;}
.badge.absent{background:#ffedd5;color:#9a3412;}
.badge.incomplete{background:#f1f5f9;color:#475569;}
.grade{display:inline-block;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:800;background:#e0f2fe;color:#0c4a6e;}
.fail-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}
.fail-chip{padding:4px 10px;border-radius:8px;font-size:10px;border:1px solid;}
.fail-chip-green{background:#f0fdf4;border-color:#bbf7d0;color:#166534;}
.fail-chip-red{background:#fff5f5;border-color:#fecaca;color:#991b1b;}
.verdict-box{border-radius:10px;overflow:hidden;margin-bottom:14px;border:1px solid;}
.verdict-promoted{border-color:#6ee7b7;background:#ecfdf5;}
.verdict-retained{border-color:#fca5a5;background:#fff5f5;}
.verdict-header{display:flex;align-items:center;gap:12px;padding:12px 16px;}
.verdict-icon{font-size:20px;font-weight:900;line-height:1;}
.verdict-promoted .verdict-icon{color:#059669;}
.verdict-retained .verdict-icon{color:#dc2626;}
.verdict-text{flex:1;}
.verdict-text strong{display:block;font-size:13px;color:#1e293b;}
.verdict-sub{font-size:10px;color:#64748b;}
.verdict-badge{padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;border:1px solid;}
.badge-promoted{background:#d1fae5;border-color:#6ee7b7;color:#065f46;}
.badge-retained{background:#fee2e2;border-color:#fca5a5;color:#991b1b;}
.detention-reasons{margin:0 14px 0;padding:10px 14px;border-radius:8px;border:1px solid #fca5a5;background:#fff1f1;}
.detention-title{font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;}
.detention-reasons ol{padding-left:16px;}
.detention-reasons li{font-size:11px;color:#7f1d1d;margin-bottom:4px;line-height:1.5;}
.verdict-footer{display:flex;justify-content:space-between;padding:8px 16px;border-top:1px solid #e2e8f0;background:rgba(255,255,255,.6);font-size:10px;}
.att-ok{color:#059669;font-weight:700;}
.att-warn{color:#dc2626;font-weight:700;}
.verdict-reason{color:#94a3b8;font-style:italic;}
.policy-box{border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:14px;background:#f8fafc;}
.policy-title{font-size:10px;font-weight:700;color:#334155;margin-bottom:4px;}
.policy-reason{font-size:11px;color:#475569;}
.policy-att{font-size:11px;margin-top:4px;}
.sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;}
.sig-slot{display:flex;flex-direction:column;align-items:center;gap:6px;}
.sig-line{width:100%;border-bottom:1px dashed #94a3b8;height:28px;}
.sig-label{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;text-align:center;}
.print-btn{position:fixed;bottom:20px;right:20px;background:#1e3a5f;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.2);}
</style></head><body>
<div class="page-header">
  <div class="app-name">BENIUS</div>
  <div class="report-title"><h1>Performance Report Card</h1><p>Term: <strong>${esc(term)}</strong></p></div>
</div>
<div class="meta-bar">
  <div class="meta-item"><label>Student Name</label><span>${esc(student.name)}</span></div>
  <div class="meta-item"><label>DSID</label><span style="font-family:monospace;font-size:11px">${esc(student.digitalStudentId)}</span></div>
  ${student.rollNumber !== null ? `<div class="meta-item"><label>Roll No.</label><span>${esc(student.rollNumber)}</span></div>` : ""}
  ${overallAvg !== null ? `<div class="meta-avg"><label>Term Average</label><div class="avg-val">${esc(overallAvg)}%${overallGrade ? `&nbsp;<span style="font-size:16px;background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:6px;border:1px solid #fde68a">${esc(overallGrade.label)}</span>` : ""}</div></div>` : ""}
</div>
<div class="section-title">Subject-wise Aggregation Breakdown</div>
${subjectRows || "<p style='color:#94a3b8;text-align:center;padding:12px;font-style:italic'>No subject data available for this term.</p>"}
${failSection}
${verdictSection}
<div class="sigs">
  ${["Class Teacher","Principal / H.O.D","Parent / Guardian"].map(l => `<div class="sig-slot"><div class="sig-line"></div><div class="sig-label">${l}</div></div>`).join("")}
</div>
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
<script>setTimeout(()=>window.print(),400);</script>
</body></html>`;

    const win = window.open("", "_blank", "width=860,height=700");
    if (!win) { alert("Popup blocked — please allow popups for this site."); return; }
    win.document.write(html);
    win.document.close();
  }

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
            <Button size="sm" variant="ghost" onClick={printReportCard}
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
                <span className="inline-flex items-center justify-center px-3 py-1 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-300 text-xl font-bold" title={overallGrade.remarks ?? ""}>{overallGrade.label}</span>
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
                       {subj.grade && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300" title={subj.remarks ?? ""}>{subj.grade}</span>}
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

          {student.promoted === null ? (
            <div className="rounded-xl p-4 border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-300">Academic Result Incomplete</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{student.promotionReason}</p>
              </div>
            </div>
          ) : showPromoVerdict ? (
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

  // ── Session context — ensures queries re-fetch when admin switches session ──
  const { selectedSession } = useSessionView();
  const sessionId = selectedSession?.id ?? null;

  // Reset all class/section/subject selections when the session switcher changes
  // so stale results from the previous year never linger on screen.
  useEffect(() => {
    setViewClass(""); setViewSection(""); setViewSubject(""); setViewExamType("");
    setResClass(""); setResSection(""); setResTerm("");
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    queryKey: ["/api/admin/analytics/view-marks", viewClass, viewSection, viewSubject, viewExamType, sessionId],
    queryFn: async () => {
      const res = await sessionFetch(
        `/api/admin/analytics/view-marks/${encodeURIComponent(viewClass)}/${encodeURIComponent(viewSection)}/${encodeURIComponent(viewSubject)}/${encodeURIComponent(viewExamType)}`
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

  const { data: viewAuthoritativeResults = [], isLoading: viewAuthorityLoading } = useQuery<AuthoritativeAcademicResult[]>({
    queryKey: ["/api/admin/academic-results", viewClass, viewSection, "view-marks", sessionId],
    queryFn: async () => {
      const r = await sessionFetch(`/api/admin/academic-results/${encodeURIComponent(viewClass)}/${encodeURIComponent(viewSection)}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || "Authoritative academic results are unavailable");
      return body.results ?? [];
    },
    enabled: tab === "view" && !!viewClass && !!viewSection,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  function generateProgressReport() {
    const reportRows = viewScores.map(score => ({
      score,
      authority: findAuthoritativeComponent(
        viewAuthoritativeResults.find(result => result.scope.studentId === score.studentId),
        viewSubject,
        viewExamType,
      ),
    }));
    const absent = reportRows.filter(row => row.authority?.component.status === "absent");
    const passCount = reportRows.filter(row => row.authority?.termResult.status === "pass").length;
    const failCount = reportRows.filter(row => row.authority?.termResult.status === "fail").length;
    const generatedOn = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
    const rows = reportRows.map(({ score: s, authority }, idx) => {
      const component = authority?.component;
      const resultStatus = authority?.termResult.status;
      const grade = authority?.termResult.grade;
      const remarks = authority?.termResult.remarks ?? "";
      if (!component || component.status !== "scored") {
        const label = component?.status === "absent" ? "ABSENT" : "INCOMPLETE";
        return `<tr><td>${idx + 1}</td><td>${s.dsid}</td><td class="name">${s.studentName}</td><td>—</td><td>—</td><td>—</td><td><span class="badge absent">${label}</span></td><td>${remarks}</td></tr>`;
      }
      return `<tr><td>${idx + 1}</td><td>${s.dsid}</td><td class="name">${s.studentName}</td><td><strong>${component.marks}/${component.totalMarks}</strong></td><td><strong>${component.pct?.toFixed(1) ?? "—"}%</strong></td><td>${grade ? `<span class="grade-badge">${grade}</span>` : "—"}</td><td>${resultStatus === "pass" || resultStatus === "fail" ? `<span class="badge ${resultStatus}">${resultStatus.toUpperCase()}</span>` : "—"}</td><td class="remarks">${remarks}</td></tr>`;
    });
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Progress Report — ${viewSubject} ${viewExamType}</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1a1a2e;background:#fff;padding:20px;}@media print{body{padding:0;}button{display:none!important;}}.page-header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:16px;}.school-name{font-size:20px;font-weight:800;color:#1e3a5f;}.report-label h1{font-size:15px;font-weight:700;color:#1e3a5f;text-align:right;}.report-label p{font-size:10px;color:#64748b;text-align:right;}.meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;background:#f0f4f8;border-radius:8px;padding:12px 16px;margin-bottom:16px;}.meta-item label{font-size:9px;text-transform:uppercase;color:#64748b;display:block;}.meta-item span{font-size:13px;font-weight:700;color:#1e3a5f;}.stat-bar{display:flex;gap:10px;margin-bottom:16px;}.stat-card{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;text-align:center;}.stat-card .val{font-size:20px;font-weight:800;color:#1e3a5f;}.stat-card .lbl{font-size:9px;text-transform:uppercase;color:#64748b;}.stat-card.green{border-color:#d1fae5;background:#f0fdf4;}.stat-card.green .val{color:#065f46;}.stat-card.red{border-color:#fee2e2;background:#fff5f5;}.stat-card.red .val{color:#991b1b;}.stat-card.blue .val{color:#1e40af;}table{width:100%;border-collapse:collapse;margin-bottom:16px;}thead tr{background:#1e3a5f;color:#fff;}th{padding:9px 10px;text-align:left;font-size:10px;font-weight:600;}td{padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;}tr:nth-child(even) td{background:#f8fafc;}td.name{font-weight:600;color:#1e3a5f;}td.remarks{color:#64748b;font-style:italic;}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:9px;font-weight:700;}.badge.pass{background:#dcfce7;color:#166534;}.badge.fail{background:#fee2e2;color:#991b1b;}.badge.absent{background:#f1f5f9;color:#64748b;}.grade-badge{display:inline-block;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:800;background:#e0f2fe;color:#0c4a6e;}.print-btn{position:fixed;bottom:20px;right:20px;background:#1e3a5f;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;cursor:pointer;}</style></head><body>
<div class="page-header"><div><div class="school-name">Performance Report</div></div><div class="report-label"><h1>Progress Report</h1><p>Generated: ${generatedOn}</p></div></div>
<div class="meta-grid"><div class="meta-item"><label>Class</label><span>${viewClass}</span></div><div class="meta-item"><label>Section</label><span>${viewSection}</span></div><div class="meta-item"><label>Subject</label><span>${viewSubject}</span></div><div class="meta-item"><label>Exam</label><span>${viewExamType}</span></div></div>
<div class="stat-bar"><div class="stat-card blue"><div class="val">${viewScores.length}</div><div class="lbl">Total</div></div><div class="stat-card green"><div class="val">${passCount}</div><div class="lbl">Passed</div></div><div class="stat-card red"><div class="val">${failCount}</div><div class="lbl">Failed</div></div><div class="stat-card"><div class="val">${absent.length}</div><div class="lbl">Absent</div></div><div class="stat-card blue"><div class="val">—</div><div class="lbl">Class Avg Not Provided</div></div><div class="stat-card"><div class="val">—</div><div class="lbl">Ranking Not Provided</div></div></div>
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
      const r = await sessionFetch(`/api/admin/analytics/exam-policy/${encodeURIComponent(resClass)}`);
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
    sessionFetch(`/api/admin/analytics/grading-rules/${encodeURIComponent(resClass)}`)
      .then(r => r.ok ? r.json() : { rules: [], passPercentage: 35 })
      .then(d => { if (!cancelled) { setGradingRules(d.rules ?? []); setGradingPassPct(d.passPercentage ?? 35); } })
      .catch(() => { if (!cancelled) { setGradingRules([]); setGradingPassPct(35); } });
    return () => { cancelled = true; };
  }, [resClass]);

  function handleResClassChange(cls: string) { setResClass(cls); setResSection(""); setResTerm(""); }

  const { data: classScores = [], isLoading: scoresLoading } = useQuery<RawStudentScore[]>({
    queryKey: ["/api/admin/analytics/class-scores", resClass, resSection, sessionId],
    queryFn: async () => {
      const res = await sessionFetch(`/api/admin/analytics/class-scores/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}`);
      if (!res.ok) throw new Error("Failed to fetch scores");
      return res.json();
    },
    enabled: !!resClass && !!resSection, staleTime: 0, refetchOnMount: "always",
    refetchOnWindowFocus: true, refetchInterval: 30000,
  });

  const { data: attendanceSummary = [] } = useQuery<AttendanceSummary[]>({
    queryKey: ["/api/admin/analytics/attendance-summary", resClass, resSection, sessionId],
    queryFn: async () => {
      const res = await sessionFetch(`/api/admin/analytics/attendance-summary/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}`);
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

  const legacyResults = useMemo(() => {
    if (!policyTier || classScores.length === 0) return [];
    return computeAllStudentResults(classScores, policyTier, attendanceSummary, gradingPassPct, ruleTermAvg, resTerm || undefined, cumulConfig ?? undefined);
  }, [policyTier, classScores, attendanceSummary, gradingPassPct, ruleTermAvg, resTerm, cumulConfig]);

  const {
    data: allResults = [],
    isLoading: authoritativeLoading,
    error: authoritativeErrorRaw,
    refetch: refetchAuthoritative,
  } = useQuery<ComputedStudentResult[]>({
    queryKey: ["/api/admin/academic-results", resClass, resSection, resTerm, sessionId],
    queryFn: async () => {
      const r = await sessionFetch(
        `/api/admin/academic-results/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}?term=${encodeURIComponent(resTerm)}`,
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const error = new Error(body.message || "Authoritative academic results are unavailable");
        (error as Error & { code?: string }).code = body.code;
        throw error;
      }
      return ((body.results ?? []) as AuthoritativeAcademicResult[]).map(result => mapAuthoritativeResult(result, resTerm));
    },
    enabled: !!resClass && !!resSection && !!resTerm,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
  });
  const authoritativeError = authoritativeErrorRaw as (Error & { code?: string }) | null;
  const hasIncompleteResults = allResults.some(result => result.promoted === null);

  useEffect(() => {
    if (!allResults.length || !legacyResults.length) return;
    const differences: Array<Record<string, unknown>> = [];
    for (const authoritative of allResults) {
      const legacy = legacyResults.find(result => result.studentId === authoritative.studentId);
      if (!legacy) {
        differences.push({ studentId: authoritative.studentId, field: "student", legacy: "missing", authoritative: "present" });
        continue;
      }
      const legacySubjects = legacy.termResults[resTerm] ?? [];
      const scored = legacySubjects.filter(subject => subject.status === "scored");
      const checks = [
        ["termAverage", scored.length ? Math.round(scored.reduce((sum, subject) => sum + (subject.percentage ?? 0), 0) / scored.length * 10) / 10 : null, authoritative.termAverages[resTerm] ?? null],
        ["failedSubjects", legacy.allTermFailCounts[resTerm] ?? 0, authoritative.allTermFailCounts[resTerm] ?? 0],
        ["attendance", legacy.attendancePct, authoritative.attendancePct],
        ["promoted", legacy.promoted, authoritative.promoted],
      ] as const;
      for (const [field, legacyValue, authoritativeValue] of checks) {
        if (legacyValue !== authoritativeValue) differences.push({ studentId: authoritative.studentId, field, legacy: legacyValue, authoritative: authoritativeValue });
      }
    }
    if (differences.length) console.warn("[academic-parity][admin]", { class: resClass, section: resSection, term: resTerm, differences });
  }, [allResults, legacyResults, resClass, resSection, resTerm]);

  const filteredResults = useMemo(() => {
    const q = resSearch.toLowerCase().trim();
    if (!q) return allResults;
    return allResults.filter(s => s.name.toLowerCase().includes(q) || s.digitalStudentId?.toLowerCase().includes(q) || String(s.rollNumber).includes(q));
  }, [allResults, resSearch]);

  const isLoading = policyLoading || scoresLoading || authoritativeLoading;
  const ready = !!resClass && !!resSection && !!resTerm && !!policyTier;
  const isPromotionTerm = showCol.promotionGate;

  const [promoMap, setPromoMap] = useState<Record<number, PromoEntry>>({});
  const [promoLocked, setPromoLocked] = useState(false);

  const { data: savedDecisions = [] } = useQuery<Array<{ studentId: number; decision: string; targetClass: string; targetSection: string; editCount: number; locked: boolean }>>({
    queryKey: ["/api/admin/analytics/promotion-decisions", resClass, resSection, resTerm, sessionId],
    queryFn: async () => {
      const r = await sessionFetch(`/api/admin/analytics/promotion-decisions/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}/${encodeURIComponent(resTerm)}`);
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

            {viewLoading || viewAuthorityLoading ? (
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
                        {["#", "DSID", "Name", "Marks", "%", "Term Grade", ""].map((h, i) => (
                          <th key={i} className={`py-2.5 px-3 text-xs font-semibold text-slate-400 ${i > 2 ? "text-center" : "text-left"} ${i === 0 ? "w-10" : i === 6 ? "w-10" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {viewScores.map((s, idx) => {
                        const isExpanded = expandedStudent === s.studentId;
                        const authority = findAuthoritativeComponent(
                          viewAuthoritativeResults.find(result => result.scope.studentId === s.studentId),
                          viewSubject,
                          viewExamType,
                        );
                        const pct = authority?.component.pct ?? null;
                        const grade = authority?.termResult.grade ?? null;
                        return (
                          <Fragment key={s.studentId}>
                            <tr className="border-b border-[#1e293b]/60 last:border-0 hover:bg-[#1e293b]/40 cursor-pointer transition-colors" onClick={() => setExpandedStudent(isExpanded ? null : s.studentId)} data-testid={`row-view-${s.studentId}`}>
                              <td className="py-2.5 px-3 text-xs text-slate-500">{idx + 1}</td>
                              <td className="py-2.5 px-3 font-mono text-xs text-slate-400">{s.dsid}</td>
                              <td className="py-2.5 px-3 text-sm font-semibold text-yellow-300 hover:text-yellow-200">{s.studentName}</td>
                              <td className="py-2.5 px-3 text-center text-xs text-slate-300">{s.isAbsent ? <span className="font-bold text-slate-500">AB</span> : `${s.marks}/${s.totalMarks}`}</td>
                              <td className="py-2.5 px-3 text-center text-xs font-semibold text-white">{pct === null ? <span className="text-amber-400">Incomplete</span> : `${pct.toFixed(1)}%`}</td>
                              <td className="py-2.5 px-3 text-center">
                                {grade ? <span className="px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300 text-[10px] font-bold">{grade}</span> : <span className="text-xs text-slate-600">—</span>}
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
            {authoritativeError && resClass && resSection && resTerm && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <p className="font-semibold">Authoritative results unavailable{authoritativeError.code ? ` (${authoritativeError.code})` : ""}</p>
                <p className="mt-1 text-xs text-red-200/80">{authoritativeError.message}</p>
                <button onClick={() => refetchAuthoritative()} className="mt-2 text-xs font-semibold underline">Retry</button>
              </div>
            )}
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
                          const weightedAvg = student.termAverages[resTerm] ?? null;
                          const termGrade = student.termGrades[resTerm] ?? null;
                          const failCount = student.allTermFailCounts[resTerm] ?? 0;
                          const att = student.attendancePct;
                          const cumulativePct = student.cumulativeAverage;

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
                                      <span className="text-base font-bold text-blue-300">{weightedAvg}%</span>
                                      <div className="w-20 mx-auto mt-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
                                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, weightedAvg)}%` }} />
                                      </div>
                                    </div>
                                  ) : <span className="text-slate-600 text-xs italic">No data</span>}
                                </td>
                              )}
                              {showCol.termGrade && (
                                <td className="py-3 px-4 text-center">
                                  {termGrade ? <span className="inline-flex items-center justify-center min-w-[2.2rem] px-2 py-1 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-300 text-sm font-bold" title={termGrade.remarks ?? ""} data-testid={`grade-${student.studentId}`}>{termGrade.label}</span> : <span className="text-slate-600 text-xs">—</span>}
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
                              {showCol.promotionGate && <td className="py-3 px-4 text-center">{student.promoted === null ? <span className="inline-flex px-2.5 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs font-bold" title={student.promotionReason}>Incomplete</span> : <PromoCellReadOnly entry={promoMap[student.studentId]} />}</td>}
                              {showCol.cumulativeTotal && isCumulativeTerm && (
                                <td className="py-3 px-4 text-center">
                                  {cumulativePct !== null ? (
                                    <div>
                                      <span className="text-base font-bold text-blue-300">{cumulativePct}%</span>
                                      <div className="w-20 mx-auto mt-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, cumulativePct)}%` }} /></div>
                                    </div>
                                  ) : <span className="text-slate-600 text-xs italic" title="Scores for all contributing terms are required">Partial</span>}
                                </td>
                              )}
                              {showCol.finalGrade && isCumulativeTerm && (
                                <td className="py-3 px-4 text-center">
                                  {student.cumulativeGrade ? <span className="inline-flex items-center justify-center min-w-[2.2rem] px-2 py-1 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-300 text-sm font-bold" title={student.cumulativeGrade.remarks ?? ""} data-testid={`cumul-grade-${student.studentId}`}>{student.cumulativeGrade.label}</span> : <span className="text-slate-600 text-xs">—</span>}
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
            <ReportCardModal student={reportStudent} term={resTerm} policy={policyTier} showPromoVerdict={isPromotionTerm} promoEntry={promoMap[reportStudent.studentId]} onClose={() => setReportStudent(null)} />
          )}
        </div>
      )}
    </div>
  );
}
