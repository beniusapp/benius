import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Save, GraduationCap, BarChart3, Download, ChevronDown, ChevronUp, BookOpen,
  Award, Search, X, FileText, Printer, TrendingUp, AlertTriangle, CheckCircle2, XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";
import { useSchoolConfigStrict } from "@/hooks/use-school-config";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ── Shared types ──────────────────────────────────────────────────────────────
interface StudentInfo { studentId: number; name: string; dsid: string; }
interface ExamScoreEntry {
  id: number; studentId: number; studentName: string; dsid: string;
  marks: number; totalMarks: number; isAbsent: boolean;
}
interface StudentExamScore {
  id: number; subject: string; examType: string;
  marks: number; totalMarks: number; isAbsent: boolean;
}

// ── Results-tab types ─────────────────────────────────────────────────────────
interface RawStudentScore {
  studentId: number; name: string; digitalStudentId: string; rollNumber: number | null;
  scores: Array<{ subject: string; examType: string; marks: number; totalMarks: number; isAbsent: boolean }>;
}
interface AttendanceSummary { studentId: number; attendancePct: number | null; presentDays: number; totalDays: number; }
interface ExamPolicyTier {
  id: number; tierName: string; applicableClasses: string[]; examWeights: string; promotionFailRules: string;
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
}

// ── Promotion engine (runs on frontend) ───────────────────────────────────────
function computeAllStudentResults(
  students: RawStudentScore[],
  policy: ExamPolicyTier,
  attendanceSummary: AttendanceSummary[],
  passPercentage: number = 35,
): ComputedStudentResult[] {
  let rawWeights: Record<string, { source_exam: string; weight: number }[]> = {};
  let rules: any = {};
  try { rawWeights = JSON.parse(policy.examWeights || "{}"); } catch {}
  try { rules = JSON.parse(policy.promotionFailRules || "{}"); } catch {}

  // Normalise term names: trim whitespace so "Finally term " === "Finally term"
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
        let weightedSum = 0, totalWeight = 0;
        let hasAbsent = false, hasData = false;
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
          weightedSum += contribution;
          totalWeight += comp.weight;
          breakdown.push({ sourceExam: comp.source_exam, weight: comp.weight, marks: record.marks, totalMarks: record.totalMarks, isAbsent: false, pct, contribution, status: "scored" });
        }

        let percentage: number | null = null, passed: boolean | null = null;
        let status: SubjectTermResult["status"] = "incomplete";
        if (!hasData) { status = "incomplete"; }
        else if (hasAbsent) { status = "absent"; percentage = 0; passed = false; }
        else {
          const ep = totalWeight > 0 ? (weightedSum * 100) / totalWeight : 0;
          percentage = Math.round(ep * 10) / 10;
          passed = ep >= passPercentage;
          status = "scored";
        }
        subjectResults.push({ subject, percentage, passed, breakdown, status });
      }

      termResults[termName] = subjectResults;
      allTermFailCounts[termName] = subjectResults.filter(s => s.passed === false).length;
    }

    // Apply promotion rules (new rule1/rule2 format) — trim term names for safety
    const rule1 = rules.rule1 ?? {};
    const rule2 = rules.rule2 ?? {};
    let promoted = true, promotionReason = "Meets all promotion criteria.";

    if (rule1.enabled !== false && termNames.length > 0) {
      const r1Term = (rule1.term ?? termNames[termNames.length - 1]).trim();
      const r1Max = parseInt(rule1.max_fails) || 3;
      const r1Fails = allTermFailCounts[r1Term] ?? 0;
      if (r1Fails >= r1Max) {
        promoted = false;
        promotionReason = `Failed ${r1Fails} subject(s) in "${r1Term}" — max allowed before retention is ${r1Max - 1}.`;
      }
    }

    if (promoted && rule2.enabled === true) {
      const t1 = (rule2.first_term ?? termNames[0]).trim();
      const t2 = (rule2.second_term ?? termNames[termNames.length - 1]).trim();
      const f1Thresh = parseInt(rule2.first_fails) || 5;
      const f2Thresh = parseInt(rule2.second_fails) || 3;
      const f1 = allTermFailCounts[t1] ?? 0;
      const f2 = allTermFailCounts[t2] ?? 0;
      if (f1 >= f1Thresh && f2 >= f2Thresh) {
        promoted = false;
        promotionReason = `Composite rule: ${f1} fail(s) in "${t1}" (≥${f1Thresh}) AND ${f2} fail(s) in "${t2}" (≥${f2Thresh}).`;
      }
    }

    return {
      studentId: student.studentId,
      name: student.name,
      digitalStudentId: student.digitalStudentId,
      rollNumber: student.rollNumber,
      termResults, allTermFailCounts,
      attendancePct: attendanceMap.get(student.studentId)?.attendancePct ?? null,
      promoted, promotionReason,
    };
  });
}

// ── Grade types & helpers ─────────────────────────────────────────────────────
interface GradingRuleClient {
  id: number; tierId: number; gradeLabel: string;
  minPercent: number; maxPercent: number; remarks: string | null; sortOrder: number;
}

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
  // Fallback static grades when no school rules configured
  if (pct >= 90) return { label: "A+", color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/30", remarks: "Outstanding" };
  if (pct >= 80) return { label: "A",  color: "text-green-400",   bg: "bg-green-500/15 border-green-500/30",   remarks: "Excellent" };
  if (pct >= 70) return { label: "B+", color: "text-teal-400",    bg: "bg-teal-500/15 border-teal-500/30",    remarks: "Very Good" };
  if (pct >= 60) return { label: "B",  color: "text-blue-400",    bg: "bg-blue-500/15 border-blue-500/30",    remarks: "Good" };
  if (pct >= 50) return { label: "C+", color: "text-yellow-400",  bg: "bg-yellow-500/15 border-yellow-500/30", remarks: "Average" };
  if (pct >= 40) return { label: "C",  color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/30",  remarks: "Below Average" };
  if (pct >= 33) return { label: "D",  color: "text-orange-400",  bg: "bg-orange-500/15 border-orange-500/30", remarks: "Poor" };
  return { label: "F", color: "text-red-400", bg: "bg-red-500/15 border-red-500/30", remarks: "Fail" };
}

interface ClassAvgEntry { examType: string; avgPercentage: number; }

function StudentTimeline({ studentId, studentName, schoolId, subject, examTypes, viewClass, viewSection }: {
  studentId: number; studentName: string; schoolId: number; subject: string; examTypes: string[];
  viewClass: string; viewSection: string;
}) {
  const { data: scores = [], isLoading } = useQuery<StudentExamScore[]>({
    queryKey: ["/api/exam-scores/student", studentId, schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/exam-scores/student/${studentId}/${schoolId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const { data: classAverages = [] } = useQuery<ClassAvgEntry[]>({
    queryKey: ["/api/exam-scores/class-average", schoolId, viewClass, viewSection, subject],
    queryFn: async () => {
      const res = await fetch(`/api/exam-scores/class-average/${schoolId}/${encodeURIComponent(viewClass)}/${encodeURIComponent(viewSection)}/${encodeURIComponent(subject)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!viewClass && !!viewSection && !!subject,
  });
  const subjectScores = useMemo(() => scores.filter(s => s.subject === subject && !s.isAbsent), [scores, subject]);
  const chartData = useMemo(() => {
    const avgMap = new Map(classAverages.map(a => [a.examType, a.avgPercentage]));
    return examTypes.map(et => {
      const s = subjectScores.find(sc => sc.examType === et);
      const studentPct = s ? Math.round((s.marks / s.totalMarks) * 100) : null;
      const classAvg = avgMap.get(et) ?? null;
      if (studentPct === null && classAvg === null) return null;
      return { exam: et, studentPct, classAvg };
    }).filter(Boolean) as { exam: string; studentPct: number | null; classAvg: number | null }[];
  }, [subjectScores, classAverages, examTypes]);
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
            <div className="h-52 w-full" data-testid={`chart-dual-line-${studentId}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="exam" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip formatter={(value: number, name: string) => [`${value}%`, name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="studentPct" stroke="#6366f1" strokeWidth={2} name={`${studentName}`} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
                  <Line type="monotone" dataKey="classAvg" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Class Average" dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
      {allSubjects.length > 0 && (
        <div className="mt-4 pt-4 border-t" data-testid={`history-360-${studentId}`}>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-indigo-500" />
            <h4 className="text-sm font-bold">360° Academic History</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {allSubjects.map(([subj, subjectScoresList]) => (
              <div key={subj} className="rounded-lg border bg-background p-3" data-testid={`history-subject-${subj}`}>
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

// ── Report Card Modal ─────────────────────────────────────────────────────────
function ReportCardModal({ student, term, policy, gradingRules, onClose }: {
  student: ComputedStudentResult;
  term: string;
  policy: ExamPolicyTier;
  gradingRules: GradingRuleClient[];
  onClose: () => void;
}) {
  const termSubjects = student.termResults[term] ?? [];
  let weights: Record<string, { source_exam: string; weight: number }[]> = {};
  try { weights = JSON.parse(policy.examWeights || "{}"); } catch {}
  const components = weights[term] ?? [];

  const subjectsWithScores = termSubjects.filter(s => s.status === "scored");
  const overallAvg = subjectsWithScores.length > 0
    ? Math.round((subjectsWithScores.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / subjectsWithScores.length) * 10) / 10
    : null;
  const overallGrade = overallAvg !== null ? computeGrade(overallAvg, gradingRules) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl bg-[#0f172a] border border-[#1e293b] rounded-2xl shadow-2xl my-4" data-testid="modal-report-card">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e293b]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-yellow-500/20">
              <FileText className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h2 className="text-white font-bold text-base leading-tight">Performance Report Card</h2>
              <p className="text-slate-400 text-xs mt-0.5">Term: <span className="text-yellow-400 font-semibold">{term}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => window.print()}
              className="text-slate-400 hover:text-white hover:bg-white/10 h-8 hidden sm:flex gap-1.5"
              data-testid="btn-print-report">
              <Printer className="w-3.5 h-3.5" /> Print
            </Button>
            <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors" data-testid="btn-close-report">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Student info bar */}
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
                <span className={`inline-flex items-center justify-center px-3 py-1 rounded-xl border text-xl font-bold ${overallGrade.color} ${overallGrade.bg}`}
                  title={overallGrade.remarks ?? ""}>
                  {overallGrade.label}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Per-subject breakdown */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Subject-wise Aggregation Breakdown</h3>
            <div className="space-y-3">
              {termSubjects.length === 0 && (
                <p className="text-slate-500 text-sm italic text-center py-4">No subject data available for this term.</p>
              )}
              {termSubjects.map(subj => (
                <div key={subj.subject} className="rounded-xl border border-[#1e293b] bg-[#0f172a] overflow-hidden" data-testid={`report-subject-${subj.subject}`}>
                  <div className="flex items-center justify-between px-4 py-2.5 bg-[#1e293b]/60 border-b border-[#1e293b]">
                    <span className="text-white text-sm font-semibold">{subj.subject}</span>
                    <div className="flex items-center gap-2">
                      {subj.percentage !== null && (
                        <span className="text-yellow-400 font-bold text-sm">{subj.percentage}%</span>
                      )}
                      {subj.status === "scored" && subj.percentage !== null && (() => {
                        const g = computeGrade(subj.percentage, gradingRules);
                        return (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${g.color} ${g.bg}`}
                            title={g.remarks ?? ""}>{g.label}</span>
                        );
                      })()}
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
                            <td className="py-2 px-3 text-center">
                              {comp.pct !== null ? <span className="text-slate-300">{comp.pct.toFixed(1)}%</span> : <span className="text-slate-600">—</span>}
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
                          <tr className="bg-[#1e293b]/40 border-t border-[#1e293b]">
                            <td colSpan={4} className="py-2 px-4 text-right text-slate-400 font-semibold text-xs">Weighted Aggregate</td>
                            <td className="py-2 px-3 text-center text-yellow-400 font-bold">{subj.percentage}%</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Term fail summary */}
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

          {/* Promotion verdict */}
          <div className={`rounded-xl p-4 border ${student.promoted ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>
            <div className="flex items-center gap-2.5 mb-1">
              {student.promoted
                ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                : <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
              <span className={`text-sm font-bold ${student.promoted ? "text-emerald-300" : "text-red-300"}`}>
                {student.promoted ? "Promoted to Next Class" : "Detained / Retained"}
              </span>
            </div>
            <p className="text-xs text-slate-400 pl-7">{student.promotionReason}</p>
            {student.attendancePct !== null && (
              <p className="text-xs text-slate-500 pl-7 mt-1">
                Attendance: <span className={`font-semibold ${student.attendancePct < 75 ? "text-red-400" : "text-emerald-400"}`}>{student.attendancePct}%</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Results Tab ───────────────────────────────────────────────────────────────
function ResultsTab({ teacher }: { teacher: TeacherMe }) {
  const { classes, getSectionsForClass } = useSchoolConfigStrict(teacher.schoolId);
  const [resClass, setResClass] = useState("");
  const [resSection, setResSection] = useState("");
  const [resTerm, setResTerm] = useState("");
  const [resSearch, setResSearch] = useState("");
  const [reportStudent, setReportStudent] = useState<ComputedStudentResult | null>(null);

  const resSections = useMemo(() => getSectionsForClass(resClass), [resClass, getSectionsForClass]);

  // Policy fetch — useEffect+state, bypassing React Query cache entirely
  // so a stale/errored cache entry can never block a fresh network request.
  const [policyTier, setPolicyTier] = useState<ExamPolicyTier | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyRetry, setPolicyRetry] = useState(0);

  useEffect(() => {
    if (!resClass) {
      setPolicyTier(null);
      setPolicyError(null);
      return;
    }

    // Main fetch — shows loading + clears stale data
    let cancelled = false;
    const doFetch = (silent = false) => {
      if (!silent) { setPolicyLoading(true); setPolicyTier(null); setPolicyError(null); }
      fetch(`/api/teacher/exam-policy/${encodeURIComponent(resClass)}`, { credentials: "include" })
        .then(async r => {
          if (cancelled) return;
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body.message || `No policy for class ${resClass}`);
          }
          return r.json();
        })
        .then(data => {
          if (!cancelled) { setPolicyTier(data); setPolicyLoading(false); setPolicyError(null); }
        })
        .catch(err => {
          if (!cancelled) { setPolicyError(err.message); setPolicyLoading(false); }
        });
    };

    doFetch(false);

    // Silent background re-fetch every 60 s so admin changes propagate automatically
    const interval = setInterval(() => doFetch(true), 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [resClass, policyRetry]);

  // Grading rules fetch — same no-cache useEffect pattern
  const [gradingRules, setGradingRules] = useState<GradingRuleClient[]>([]);
  const [gradingPassPct, setGradingPassPct] = useState(35);

  useEffect(() => {
    if (!resClass) { setGradingRules([]); setGradingPassPct(35); return; }
    let cancelled = false;
    fetch(`/api/teacher/grading-rules/${encodeURIComponent(resClass)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { rules: [], passPercentage: 35 })
      .then(d => { if (!cancelled) { setGradingRules(d.rules ?? []); setGradingPassPct(d.passPercentage ?? 35); } })
      .catch(() => { if (!cancelled) { setGradingRules([]); setGradingPassPct(35); } });
    return () => { cancelled = true; };
  }, [resClass]);

  function handleResClassChange(cls: string) {
    setResClass(cls);
    setResSection("");
    setResTerm("");
  }

  const { data: classScores = [], isLoading: scoresLoading } = useQuery<RawStudentScore[]>({
    queryKey: ["/api/teacher/class-scores", resClass, resSection],
    queryFn: async () => {
      const res = await fetch(`/api/teacher/class-scores/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch scores");
      return res.json();
    },
    enabled: !!resClass && !!resSection,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: attendanceSummary = [] } = useQuery<AttendanceSummary[]>({
    queryKey: ["/api/teacher/attendance-summary", resClass, resSection],
    queryFn: async () => {
      const res = await fetch(`/api/teacher/attendance-summary/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!resClass && !!resSection,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Parse term names from policy — trim to handle accidental whitespace in DB
  const termNames = useMemo(() => {
    if (!policyTier) return [];
    try {
      const w = JSON.parse(policyTier.examWeights || "{}");
      return Object.keys(w).map(k => k.trim());
    } catch { return []; }
  }, [policyTier]);

  // Auto-select first term when policy loads
  useEffect(() => {
    if (termNames.length > 0 && !resTerm) setResTerm(termNames[0]);
  }, [termNames, resTerm]);

  // Compute results — pass school's pass% to engine
  const allResults = useMemo(() => {
    if (!policyTier || classScores.length === 0) return [];
    return computeAllStudentResults(classScores, policyTier, attendanceSummary, gradingPassPct);
  }, [policyTier, classScores, attendanceSummary, gradingPassPct]);

  // Filter by search
  const filteredResults = useMemo(() => {
    const q = resSearch.toLowerCase().trim();
    if (!q) return allResults;
    return allResults.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.digitalStudentId?.toLowerCase().includes(q) ||
      String(s.rollNumber).includes(q)
    );
  }, [allResults, resSearch]);

  const isLoading = policyLoading || scoresLoading;
  const ready = !!resClass && !!resSection && !!resTerm && !!policyTier;

  return (
    <div className="space-y-5" data-testid="tab-results">
      {/* Filters */}
      <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Award className="w-5 h-5 text-yellow-400" />
          <h2 className="text-white font-bold text-base">Performance & Promotion Results</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Class */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400">Class *</label>
            <select value={resClass} onChange={e => handleResClassChange(e.target.value)}
              className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-yellow-500/50"
              style={{ colorScheme: "dark" }} data-testid="select-results-class">
              <option value="">Select class</option>
              {classes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* Section */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400">Section *</label>
            <select value={resSection} onChange={e => setResSection(e.target.value)} disabled={!resClass}
              className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-yellow-500/50 disabled:opacity-50"
              style={{ colorScheme: "dark" }} data-testid="select-results-section">
              <option value="">Select section</option>
              {resSections.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {/* Term */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400">Term *</label>
            <select value={resTerm} onChange={e => setResTerm(e.target.value)} disabled={!resClass || termNames.length === 0}
              className="w-full h-9 rounded-xl border border-[#1e293b] bg-[#020617] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-yellow-500/50 disabled:opacity-50"
              style={{ colorScheme: "dark" }} data-testid="select-results-term">
              <option value="">
                {!resClass ? "Pick class first" : policyLoading ? "Loading…" : policyError ? "No policy" : termNames.length === 0 ? "No terms" : "Select term"}
              </option>
              {termNames.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {/* Search */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400">Quick Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <Input value={resSearch} onChange={e => setResSearch(e.target.value)}
                placeholder="Name / DSID / Roll…"
                className="pl-8 h-9 bg-[#020617] border-[#1e293b] text-white text-sm placeholder:text-slate-600 rounded-xl"
                data-testid="input-results-search" />
            </div>
          </div>
        </div>

        {/* Policy info pill + refresh */}
        {resClass && !policyLoading && (policyTier || policyError) && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {policyTier && (
                <>
                  <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 font-semibold">{policyTier.tierName}</span>
                  <span>policy applied · {termNames.length} term{termNames.length !== 1 ? "s" : ""} configured</span>
                </>
              )}
            </div>
            <button
              onClick={() => setPolicyRetry(r => r + 1)}
              className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-yellow-400 transition-colors px-2 py-1 rounded-lg hover:bg-yellow-500/10 border border-transparent hover:border-yellow-500/20"
              title="Re-fetch latest policy from server"
              data-testid="btn-refresh-policy">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />
              </svg>
              Refresh
            </button>
          </div>
        )}
        {policyLoading && resClass && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Loading policy…</span>
          </div>
        )}

        {/* No policy warning */}
        {resClass && !policyLoading && policyError && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{policyError.toLowerCase().startsWith("no policy") || policyError.toLowerCase().startsWith("no exam policy")
                ? `No Exam Policy configured for Class ${resClass}. Ask your admin to set one up in School Setup → Exam Aggregation & Promotion Policy.`
                : policyError
              }</span>
            </div>
            <button
              onClick={() => setPolicyRetry(r => r + 1)}
              className="self-start flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-100 underline underline-offset-2 transition-colors"
              data-testid="btn-retry-policy">
              ↻ Retry
            </button>
          </div>
        )}
      </div>

      {/* Loading state */}
      {isLoading && resClass && resSection && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-2xl bg-[#0f172a] border border-[#1e293b] animate-pulse" />
          ))}
        </div>
      )}

      {/* Results table */}
      {ready && !isLoading && (
        <>
          {filteredResults.length === 0 ? (
            <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] p-12 text-center">
              <TrendingUp className="w-10 h-10 mx-auto mb-3 text-slate-700" />
              <p className="text-slate-500 text-sm">
                {resSearch ? "No students match your search." : "No student score data available for this class & section yet."}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] overflow-hidden" data-testid="results-table">
              {/* Stats bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#1e293b] border-b border-[#1e293b]">
                {[
                  { label: "Total Students", value: filteredResults.length },
                  { label: "Promoted", value: filteredResults.filter(r => r.promoted).length, color: "text-emerald-400" },
                  { label: "Retained", value: filteredResults.filter(r => !r.promoted).length, color: "text-red-400" },
                  {
                    label: "Avg Attendance",
                    value: (() => {
                      const valid = filteredResults.filter(r => r.attendancePct !== null);
                      if (valid.length === 0) return "—";
                      return `${Math.round(valid.reduce((s, r) => s + (r.attendancePct ?? 0), 0) / valid.length)}%`;
                    })(),
                    color: "text-yellow-400",
                  },
                ].map(stat => (
                  <div key={stat.label} className="bg-[#0f172a] px-4 py-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide">{stat.label}</p>
                    <p className={`text-xl font-bold mt-0.5 ${stat.color ?? "text-white"}`}>{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: "700px" }}>
                  <thead>
                    <tr className="border-b border-[#1e293b] bg-[#1e293b]/40">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 w-10">#</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400">Student</th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400">Weighted Avg<br /><span className="font-normal text-slate-600">({resTerm})</span></th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400">Grade<br /><span className="font-normal text-slate-600">({resTerm})</span></th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400">Subject Fails<br /><span className="font-normal text-slate-600">({resTerm})</span></th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400">Attendance</th>
                      <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400">Promotion Gate</th>
                      <th className="text-center py-3 px-3 text-xs font-semibold text-slate-400 w-28">Report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((student, idx) => {
                      const termSubjects = student.termResults[resTerm] ?? [];
                      const scoredSubjs = termSubjects.filter(s => s.status === "scored");
                      const weightedAvg = scoredSubjs.length > 0
                        ? Math.round((scoredSubjs.reduce((s, sub) => s + (sub.percentage ?? 0), 0) / scoredSubjs.length) * 10) / 10
                        : null;
                      const failCount = student.allTermFailCounts[resTerm] ?? 0;
                      const att = student.attendancePct;

                      return (
                        <tr key={student.studentId} className="border-b border-[#1e293b]/60 hover:bg-[#1e293b]/30 transition-colors" data-testid={`result-row-${student.studentId}`}>
                          {/* Roll / index */}
                          <td className="py-3 px-4 text-slate-500 text-xs">{student.rollNumber ?? idx + 1}</td>

                          {/* Student card */}
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

                          {/* Weighted avg */}
                          <td className="py-3 px-4 text-center">
                            {weightedAvg !== null ? (
                              <div>
                                <span className={`text-base font-bold ${weightedAvg >= 60 ? "text-emerald-400" : weightedAvg >= gradingPassPct ? "text-yellow-400" : "text-red-400"}`}>
                                  {weightedAvg}%
                                </span>
                                <div className="w-20 mx-auto mt-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
                                  <div className={`h-full rounded-full ${weightedAvg >= 60 ? "bg-emerald-500" : weightedAvg >= gradingPassPct ? "bg-yellow-500" : "bg-red-500"}`}
                                    style={{ width: `${Math.min(100, weightedAvg)}%` }} />
                                </div>
                              </div>
                            ) : <span className="text-slate-600 text-xs italic">No data</span>}
                          </td>

                          {/* Grade */}
                          <td className="py-3 px-4 text-center">
                            {weightedAvg !== null ? (() => {
                              const g = computeGrade(weightedAvg, gradingRules);
                              return (
                                <span className={`inline-flex items-center justify-center min-w-[2.2rem] px-2 py-1 rounded-lg border text-sm font-bold ${g.color} ${g.bg}`}
                                  title={g.remarks ?? ""} data-testid={`grade-${student.studentId}`}>
                                  {g.label}
                                </span>
                              );
                            })() : <span className="text-slate-600 text-xs">—</span>}
                          </td>

                          {/* Fail count */}
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border ${failCount === 0 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : failCount <= 2 ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
                              {failCount}
                            </span>
                          </td>

                          {/* Attendance bar */}
                          <td className="py-3 px-4 text-center">
                            {att !== null ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className={`text-xs font-bold ${att < 75 ? "text-red-400" : att < 85 ? "text-yellow-400" : "text-emerald-400"}`}>{att}%</span>
                                <div className="w-16 h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
                                  <div className={`h-full rounded-full ${att < 75 ? "bg-red-500" : att < 85 ? "bg-yellow-500" : "bg-emerald-500"}`}
                                    style={{ width: `${att}%` }} />
                                </div>
                                {att < 75 && <span className="text-[9px] text-red-400">Low</span>}
                              </div>
                            ) : <span className="text-slate-600 text-xs">—</span>}
                          </td>

                          {/* Promotion verdict */}
                          <td className="py-3 px-4 text-center">
                            <div className="flex flex-col items-center gap-1">
                              {student.promoted ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                                  <CheckCircle2 className="w-3 h-3" /> Promoted
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold">
                                  <XCircle className="w-3 h-3" /> Retained
                                </span>
                              )}
                              <span className="text-[9px] text-slate-600 leading-tight max-w-[140px] text-center">{student.promotionReason}</span>
                            </div>
                          </td>

                          {/* Report card button */}
                          <td className="py-3 px-3 text-center">
                            <button onClick={() => setReportStudent(student)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-semibold hover:bg-yellow-500/20 transition-colors"
                              data-testid={`btn-report-card-${student.studentId}`}>
                              <FileText className="w-3 h-3" /> Report
                            </button>
                          </td>
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

      {/* Report Card Modal */}
      {reportStudent && policyTier && (
        <ReportCardModal
          student={reportStudent}
          term={resTerm}
          policy={policyTier}
          gradingRules={gradingRules}
          onClose={() => setReportStudent(null)}
        />
      )}
    </div>
  );
}

// ── Main Examination Module ───────────────────────────────────────────────────
export default function ExaminationModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const {
    classes, subjects, examTypes, isLoading: configLoading,
    hasClasses, hasSections, getSectionsForClass, getSubjectsForClass, getExamTypesForClass,
  } = useSchoolConfigStrict(teacher.schoolId);
  const today = new Date().toISOString().split("T")[0];
  const [tab, setTab] = useState<"add" | "view" | "results">("add");

  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [subject, setSubject] = useState("");
  const [examType, setExamType] = useState("");
  const [totalMarks, setTotalMarks] = useState("");
  const [marks, setMarks] = useState<Record<number, string>>({});
  const [absentMap, setAbsentMap] = useState<Record<number, boolean>>({});
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const [viewClass, setViewClass] = useState("");
  const [viewSection, setViewSection] = useState("");
  const [viewSubject, setViewSubject] = useState("");
  const [viewExamType, setViewExamType] = useState("");
  const [expandedStudent, setExpandedStudent] = useState<number | null>(null);

  const addSectionOpts = useMemo(() => getSectionsForClass(selectedClass), [selectedClass, getSectionsForClass]);
  const viewSectionOpts = useMemo(() => getSectionsForClass(viewClass), [viewClass, getSectionsForClass]);
  const addSubjectOpts = useMemo(() => getSubjectsForClass(selectedClass), [selectedClass, getSubjectsForClass]);
  const viewSubjectOpts = useMemo(() => getSubjectsForClass(viewClass), [viewClass, getSubjectsForClass]);
  const addExamTypeOpts = useMemo(() => getExamTypesForClass(selectedClass), [selectedClass, getExamTypesForClass]);
  const viewExamTypeOpts = useMemo(() => getExamTypesForClass(viewClass), [viewClass, getExamTypesForClass]);

  function handleAddClassChange(cls: string) { setSelectedClass(cls); setSelectedSection(""); setSubject(""); setExamType(""); }
  function handleViewClassChange(cls: string) { setViewClass(cls); setViewSection(""); setViewSubject(""); }

  const { data: students = [] } = useQuery<StudentInfo[]>({
    queryKey: ["/api/attendance", teacher.schoolId, selectedClass, selectedSection, today],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/${teacher.schoolId}/${encodeURIComponent(selectedClass)}/${selectedSection}/${today}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedClass && !!selectedSection,
  });

  const { data: existingScores = [] } = useQuery<ExamScoreEntry[]>({
    queryKey: ["/api/exam-scores", teacher.schoolId, subject, examType, selectedClass, selectedSection],
    queryFn: async () => {
      if (!subject || !examType) return [];
      const res = await fetch(`/api/exam-scores/${teacher.schoolId}/${encodeURIComponent(subject)}/${encodeURIComponent(examType)}/${encodeURIComponent(selectedClass)}/${selectedSection}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!subject && !!examType && !!selectedClass && !!selectedSection,
  });

  const { data: viewScores = [], isLoading: viewLoading } = useQuery<ExamScoreEntry[]>({
    queryKey: ["/api/exam-scores", teacher.schoolId, viewSubject, viewExamType, viewClass, viewSection],
    queryFn: async () => {
      if (!viewSubject || !viewExamType) return [];
      const res = await fetch(`/api/exam-scores/${teacher.schoolId}/${encodeURIComponent(viewSubject)}/${encodeURIComponent(viewExamType)}/${encodeURIComponent(viewClass)}/${viewSection}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "view" && !!viewSubject && !!viewExamType && !!viewClass && !!viewSection,
  });

  useEffect(() => {
    const m: Record<number, string> = {};
    const a: Record<number, boolean> = {};
    existingScores.forEach(s => { m[s.studentId] = String(s.marks); a[s.studentId] = s.isAbsent; });
    setMarks(m); setAbsentMap(a);
    if (existingScores.length > 0) setTotalMarks(String(existingScores[0].totalMarks));
    else setTotalMarks("");
  }, [existingScores]);

  const maxMarks = parseInt(totalMarks) || 100;
  const hasInvalidMarks = useMemo(() => students.some(s => {
    if (absentMap[s.studentId]) return false;
    return parseInt(marks[s.studentId] || "0") > maxMarks;
  }), [students, marks, absentMap, maxMarks]);

  const classAverage = useMemo(() => {
    const valid = students.filter(s => !absentMap[s.studentId] && marks[s.studentId] && marks[s.studentId] !== "");
    if (valid.length === 0) return null;
    return Math.round((valid.reduce((sum, s) => sum + (parseInt(marks[s.studentId]) || 0), 0) / valid.length / maxMarks) * 100);
  }, [students, marks, absentMap, maxMarks]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const scores = students
        .filter(s => absentMap[s.studentId] || (marks[s.studentId] !== undefined && marks[s.studentId] !== ""))
        .map(s => ({ studentId: s.studentId, marks: absentMap[s.studentId] ? 0 : marks[s.studentId], isAbsent: !!absentMap[s.studentId] }));
      const res = await apiRequest("POST", "/api/exam-scores", { scores, subject, examType, totalMarks: maxMarks, class: selectedClass, section: selectedSection });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Scores Saved", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/exam-scores", teacher.schoolId, subject, examType, selectedClass, selectedSection] });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const handleTabNav = useCallback((studentId: number, studentIndex: number, e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const nextIndex = e.shiftKey ? studentIndex - 1 : studentIndex + 1;
      if (nextIndex >= 0 && nextIndex < students.length) inputRefs.current[students[nextIndex].studentId]?.focus();
    }
  }, [students]);

  const readyToSave = !!selectedClass && !!selectedSection && !!subject && !!examType && !!totalMarks && !hasInvalidMarks;
  const notConfigured = !configLoading && (!hasClasses || !hasSections);

  if (configLoading) return (
    <div className="space-y-4" data-testid="loading-config">
      {[0, 1].map(i => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}
    </div>
  );

  if (notConfigured) return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-6 text-center" data-testid="banner-not-configured">
      <GraduationCap className="w-8 h-8 mx-auto text-amber-500 mb-3" />
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">School setup incomplete</p>
      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Ask your admin to configure classes and sections in School Setup before recording exam scores.</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1.5 p-1 bg-[#020617] border border-[#1e293b] rounded-2xl" data-testid="tabs-exam">
        {([
          { key: "add", label: "Add Marks", Icon: GraduationCap },
          { key: "view", label: "View Marks", Icon: BarChart3 },
          { key: "results", label: "Results", Icon: Award },
        ] as const).map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === key
                ? "bg-yellow-500 text-[#020617] shadow-sm"
                : "text-slate-400 hover:text-white hover:bg-[#1e293b]"
            }`}
            data-testid={`tab-${key}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* ── Add Marks ── */}
      {tab === "add" && (
        <Card className="rounded-2xl shadow-lg border-0 bg-white dark:bg-gray-950" data-testid="card-add-marks">
          <CardContent className="p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <GraduationCap className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-bold tracking-tight" data-testid="text-examination-title">
                Examination & Performance Engine
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Class *</label>
                <Select value={selectedClass} onValueChange={handleAddClassChange}>
                  <SelectTrigger className="rounded-xl" data-testid="select-class"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{classes.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Section *</label>
                <Select value={selectedSection} onValueChange={setSelectedSection} disabled={!selectedClass}>
                  <SelectTrigger className="rounded-xl" data-testid="select-section"><SelectValue placeholder="Select section" /></SelectTrigger>
                  <SelectContent>{addSectionOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Subject *</label>
                {addSubjectOpts.length > 0 ? (
                  <Select value={subject} onValueChange={setSubject}>
                    <SelectTrigger className="rounded-xl" data-testid="select-subject"><SelectValue placeholder="Select subject" /></SelectTrigger>
                    <SelectContent>{addSubjectOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Enter subject *" className="rounded-xl" data-testid="input-subject" />
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Exam Type *</label>
                <Select value={examType} onValueChange={setExamType}>
                  <SelectTrigger className="rounded-xl" data-testid="select-exam-type"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{addExamTypeOpts.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Total Marks *</label>
                <Input type="number" value={totalMarks} onChange={e => setTotalMarks(e.target.value)}
                  min="1" placeholder="e.g. 100"
                  className={`rounded-xl ${examType && selectedClass && selectedSection && !totalMarks ? "border-amber-400 focus-visible:ring-amber-400" : ""}`}
                  data-testid="input-total-marks" />
              </div>
            </div>

            {examType && selectedClass && selectedSection && !totalMarks && students.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="prompt-total-marks">
                <span className="text-base">✏️</span>
                Enter <strong className="mx-1">Total Marks</strong> above to start recording student scores.
              </div>
            )}

            {examType && selectedClass && selectedSection && !!totalMarks && students.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm" data-testid="table-marks">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        {["#", "DSID", "Name", "Marks", "%", "Grade", "Ab"].map((h, i) => (
                          <th key={i} className={`py-2.5 px-3 text-xs font-semibold text-muted-foreground ${i > 2 ? "text-center" : "text-left"} ${i === 0 ? "w-10" : i === 3 ? "w-24" : i === 4 || i === 5 ? "w-16" : i === 6 ? "w-12" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s, idx) => {
                        const isAbsent = !!absentMap[s.studentId];
                        const val = parseInt(marks[s.studentId] || "0");
                        const pct = isAbsent ? 0 : Math.round((val / maxMarks) * 100);
                        const g = computeGrade(pct, []);
                        const isOverMax = !isAbsent && val > maxMarks;
                        return (
                          <tr key={s.studentId} className={`border-b last:border-0 ${isAbsent ? "bg-muted/20" : isOverMax ? "bg-red-50 dark:bg-red-950/20" : "hover:bg-muted/20"}`}
                            data-testid={`row-student-${s.studentId}`}>
                            <td className="py-2 px-3 text-xs text-muted-foreground">{idx + 1}</td>
                            <td className="py-2 px-3 font-mono text-xs">{s.dsid}</td>
                            <td className="py-2 px-3 text-sm font-medium">{s.name}</td>
                            <td className="py-2 px-3 text-center">
                              <Input
                                ref={el => { inputRefs.current[s.studentId] = el; }}
                                type="number" min={0} max={maxMarks}
                                value={isAbsent ? "" : (marks[s.studentId] ?? "")}
                                disabled={isAbsent}
                                onChange={e => setMarks(prev => ({ ...prev, [s.studentId]: e.target.value }))}
                                onKeyDown={e => handleTabNav(s.studentId, idx, e)}
                                className={`w-full text-center h-8 text-sm ${isOverMax ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                                placeholder="—"
                                data-testid={`input-marks-${s.studentId}`}
                              />
                            </td>
                            <td className="py-2 px-3 text-center text-xs font-medium">{isAbsent ? "—" : `${pct}%`}</td>
                            <td className="py-2 px-3 text-center">
                              {isAbsent ? <span className="text-xs text-muted-foreground">—</span> : (
                                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${g.color} ${g.bg}`}>{g.label}</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <Checkbox checked={isAbsent}
                                onCheckedChange={v => setAbsentMap(prev => ({ ...prev, [s.studentId]: !!v }))}
                                data-testid={`checkbox-absent-${s.studentId}`} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {classAverage !== null && (
                  <div className="flex items-center gap-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-800 px-4 py-3" data-testid="class-average-bar">
                    <BarChart3 className="w-4 h-4 text-indigo-500" />
                    <span className="text-sm text-indigo-700 dark:text-indigo-300">Class average: <strong>{classAverage}%</strong></span>
                  </div>
                )}

                {hasInvalidMarks && (
                  <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300" data-testid="alert-invalid-marks">
                    Some students have marks exceeding the total ({maxMarks}). Please correct before saving.
                  </div>
                )}

                <Button onClick={() => saveMutation.mutate()} disabled={!readyToSave || saveMutation.isPending}
                  className={`w-full h-12 rounded-xl text-sm font-semibold transition-all ${readyToSave ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-md active:scale-[0.98]" : "opacity-50 cursor-not-allowed bg-gradient-to-r from-indigo-600 to-purple-600 text-white"}`}
                  data-testid="button-save-scores">
                  {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Scores
                </Button>
              </>
            )}

            {examType && selectedClass && selectedSection && students.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <GraduationCap className="w-10 h-10 mx-auto mb-2 opacity-20" />
                No students found for this class/section.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── View Marks ── */}
      {tab === "view" && (
        <Card className="rounded-2xl shadow-lg border-0 bg-white dark:bg-gray-950" data-testid="card-view-marks">
          <CardContent className="p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-bold tracking-tight">View Marks — 360° History</h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Class *</label>
                <Select value={viewClass} onValueChange={handleViewClassChange}>
                  <SelectTrigger className="rounded-xl" data-testid="select-view-class"><SelectValue placeholder="Select class" /></SelectTrigger>
                  <SelectContent>{classes.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Section *</label>
                <Select value={viewSection} onValueChange={setViewSection} disabled={!viewClass}>
                  <SelectTrigger className="rounded-xl" data-testid="select-view-section"><SelectValue placeholder="Select section" /></SelectTrigger>
                  <SelectContent>{viewSectionOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Subject *</label>
                {viewSubjectOpts.length > 0 ? (
                  <Select value={viewSubject} onValueChange={setViewSubject}>
                    <SelectTrigger className="rounded-xl" data-testid="select-view-subject"><SelectValue placeholder="Select subject" /></SelectTrigger>
                    <SelectContent>{viewSubjectOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={viewSubject} onChange={e => setViewSubject(e.target.value)} placeholder="Enter subject *" className="rounded-xl" data-testid="input-view-subject" />
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Exam Type *</label>
                <Select value={viewExamType} onValueChange={setViewExamType}>
                  <SelectTrigger className="rounded-xl" data-testid="select-view-exam-type"><SelectValue placeholder="Select exam type" /></SelectTrigger>
                  <SelectContent>{viewExamTypeOpts.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {viewLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="rounded-xl border bg-card p-4 animate-pulse"><div className="h-4 bg-muted rounded w-3/4 mb-2" /><div className="h-4 bg-muted rounded w-1/2" /></div>)}
              </div>
            ) : viewExamType && viewScores.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-scores">
                <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-20" />
                No scores recorded yet for this selection.
              </div>
            ) : viewExamType && viewScores.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm" data-testid="table-view-scores">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        {["#", "DSID", "Name", "Marks", "%", "Grade", ""].map((h, i) => (
                          <th key={i} className={`py-2.5 px-3 text-xs font-semibold text-muted-foreground ${i > 2 ? "text-center" : "text-left"} ${i === 0 ? "w-10" : i === 6 ? "w-10" : ""}`}>{h}</th>
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
                            <tr className="border-b last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => setExpandedStudent(isExpanded ? null : s.studentId)} data-testid={`row-view-${s.studentId}`}>
                              <td className="py-2 px-3 text-xs text-muted-foreground">{idx + 1}</td>
                              <td className="py-2 px-3 font-mono text-xs">{s.dsid}</td>
                              <td className="py-2 px-3 text-sm font-medium text-indigo-600 hover:underline">{s.studentName}</td>
                              <td className="py-2 px-3 text-center text-xs">{s.isAbsent ? <span className="font-bold text-gray-500">AB</span> : `${s.marks}/${s.totalMarks}`}</td>
                              <td className="py-2 px-3 text-center text-xs font-medium">{s.isAbsent ? "—" : `${pct}%`}</td>
                              <td className="py-2 px-3 text-center">
                                {s.isAbsent ? <span className="text-xs text-muted-foreground">—</span> : <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${g.color} ${g.bg}`}>{g.label}</span>}
                              </td>
                              <td className="py-2 px-3 text-center">{isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</td>
                            </tr>
                            {isExpanded && (
                              <tr><td colSpan={7} className="p-0">
                                <StudentTimeline studentId={s.studentId} studentName={s.studentName} schoolId={teacher.schoolId} subject={viewSubject} examTypes={examTypes} viewClass={viewClass} viewSection={viewSection} />
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Button variant="outline" className="rounded-xl"
                  onClick={() => toast({ title: "Coming Soon", description: "PDF progress report generation will be available soon." })}
                  data-testid="button-download-report">
                  <Download className="w-4 h-4 mr-2" /> Download Progress Report
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ── Results Tab ── */}
      {tab === "results" && <ResultsTab teacher={teacher} />}
    </div>
  );
}
