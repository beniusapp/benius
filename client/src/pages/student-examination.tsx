import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, GraduationCap, Loader2, ClipboardList, Printer,
  CheckCircle2, XCircle, AlertTriangle, TrendingUp, Trophy,
  Award, BookOpen, CalendarDays,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────────────
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
interface AllScoresResponse { scores: ExamScore[]; cls: string; }
interface FallbackScoresResponse {
  scores: ExamScore[];
  summary: { totalObtained: number; totalMax: number; percentage: number; grade: string; rank: { rank: number; total: number } | null };
}
interface AttendanceStatsResponse { overallPercent: number; workingDays: number; daysPresent: number; }

// ── Computation types ──────────────────────────────────────────────────────────
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

// ── Session ↔ Class mapping ────────────────────────────────────────────────────
/**
 * Sort sessions newest-first by startDate, then map each positionally to a class:
 *   sessions[0] (active / newest) → student.class
 *   sessions[1]                   → student.class - 1
 *   …and so on until class < "1"
 */
function mapSessionsToClasses(
  sessions: AcademicSession[],
  currentClass: string,
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
    if (!isNaN(currentNum) && cls === "") break;
    result.push({ ...s, cls, displayLabel: s.sessionName });
  }
  return result;
}

// ── Term computation (same logic as teacher's computeAllStudentResults) ────────
function computeStudentTermResults(
  scores: ExamScore[],
  policy: ExamPolicyTier,
  passThreshold = 35,
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
        const ep = totalWeight > 0 ? (weightedSum * 100) / totalWeight : 0;
        percentage = Math.round(ep * 10) / 10;
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

// ── Grade helpers (same as teacher) ───────────────────────────────────────────
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

// ── Print helper ───────────────────────────────────────────────────────────────
function PrintStyles() {
  return (
    <style>{`
      @media print {
        body * { visibility: hidden !important; }
        #marksheet-print, #marksheet-print * { visibility: visible !important; }
        #marksheet-print { position: fixed; top: 0; left: 0; width: 100%; padding: 24px; background: #fff; color: #000; }
        .no-print { display: none !important; }
      }
    `}</style>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function StudentExamination() {
  const [, setLocation] = useLocation();
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedTerm, setSelectedTerm] = useState("");
  const [selectedExamType, setSelectedExamType] = useState("");

  // ── Auth ────────────────────────────────────────────────────────────────────
  const { data: student, isLoading: studentLoading } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  // ── Academic sessions (admin-configured source of truth) ────────────────────
  const { data: rawSessions = [], isLoading: sessionsLoading } = useQuery<AcademicSession[]>({
    queryKey: ["/api/student/academic-sessions"],
    enabled: !!student,
    staleTime: 60000,
  });

  // Map sessions → classes + auto-select active session
  const sessions = useMemo(
    () => (student ? mapSessionsToClasses(rawSessions, student.class) : []),
    [rawSessions, student],
  );

  useEffect(() => {
    if (sessions.length > 0 && selectedSessionId === null) {
      const active = sessions.find(s => s.isActive) ?? sessions[0];
      setSelectedSessionId(active.id);
    }
  }, [sessions, selectedSessionId]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId) ?? null;
  const selectedClass = selectedSession?.cls ?? student?.class ?? "";

  // Reset term/examType whenever the class changes
  useEffect(() => {
    setSelectedTerm("");
    setSelectedExamType("");
  }, [selectedClass]);

  // ── Exam policy for selected class ──────────────────────────────────────────
  const { data: policyData, isLoading: policyLoading, isError: policyMissing } = useQuery<ExamPolicyTier>({
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

  // ── All scores for selected class (real-time — no published gate) ────────────
  const { data: allScoresData, isLoading: scoresLoading } = useQuery<AllScoresResponse>({
    queryKey: ["/api/student/exam/all-scores", selectedClass],
    queryFn: async () => {
      const r = await fetch(
        `/api/student/exam/all-scores?class=${encodeURIComponent(selectedClass)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!selectedClass && !policyMissing,
    staleTime: 0,
    refetchInterval: 30000, // poll every 30s for real-time sync
  });

  // ── Attendance for selected session ─────────────────────────────────────────
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

  // ── Fallback: exam types (no policy) ────────────────────────────────────────
  const { data: typesData } = useQuery<{ examTypes: string[] }>({
    queryKey: ["/api/student/exam/types", selectedClass],
    queryFn: async () => {
      const r = await fetch(
        `/api/student/exam/types?class=${encodeURIComponent(selectedClass)}`,
        { credentials: "include" },
      );
      if (!r.ok) return { examTypes: [] };
      return r.json();
    },
    enabled: !!selectedClass && policyMissing,
    staleTime: 0,
    refetchInterval: 30000,
  });

  const { data: fallbackScores, isLoading: fallbackLoading } = useQuery<FallbackScoresResponse>({
    queryKey: ["/api/student/exam/scores", selectedClass, selectedExamType],
    queryFn: async () => {
      const r = await fetch(
        `/api/student/exam/scores?class=${encodeURIComponent(selectedClass)}&examType=${encodeURIComponent(selectedExamType)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!selectedClass && !!selectedExamType && policyMissing,
    staleTime: 0,
    refetchInterval: 30000,
  });

  // ── Compute term results ─────────────────────────────────────────────────────
  const usePolicy = !!policyData && !policyMissing;
  const passThreshold = policyData?.passPercentage ?? 35;

  const { termResults, allTermFailCounts } = useMemo<StudentTermResults>(() => {
    if (!usePolicy || !allScoresData || !policyData) return { termResults: {}, allTermFailCounts: {} };
    return computeStudentTermResults(allScoresData.scores, policyData, passThreshold);
  }, [usePolicy, allScoresData, policyData, passThreshold]);

  const termNames = useMemo(() => {
    if (!policyData) return [];
    try { return Object.keys(JSON.parse(policyData.examWeights || "{}")).map(k => k.trim()); }
    catch { return []; }
  }, [policyData]);

  useEffect(() => {
    if (termNames.length > 0 && !selectedTerm) setSelectedTerm(termNames[0]);
  }, [termNames, selectedTerm]);
  useEffect(() => {
    if (termNames.length > 0 && !termNames.includes(selectedTerm)) setSelectedTerm(termNames[0]);
  }, [termNames, selectedTerm]);

  const examTypes = typesData?.examTypes ?? [];
  useEffect(() => {
    if (examTypes.length > 0 && (!selectedExamType || !examTypes.includes(selectedExamType)))
      setSelectedExamType(examTypes[0]);
  }, [examTypes, selectedExamType]);

  const activeTermSubjects = termResults[selectedTerm] ?? [];
  const scoredSubjects = activeTermSubjects.filter(s => s.status === "scored");
  const termAvg = scoredSubjects.length > 0
    ? Math.round((scoredSubjects.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / scoredSubjects.length) * 10) / 10
    : null;
  const failCount = allTermFailCounts[selectedTerm] ?? 0;
  const termGrade = termAvg !== null ? computeGrade(termAvg) : null;
  const attPct = attendanceData?.overallPercent ?? null;

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

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-30 no-print"
        style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", boxShadow: "0 1px 20px rgba(0,0,0,0.4)" }}>
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-9 h-9 rounded-xl transition-colors"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid="button-back"
          >
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

        {/* ── Session Selector (admin-configured, source of truth) ── */}
        <div className="rounded-2xl p-4 no-print"
          style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">Academic Session</h2>
            <span className="text-xs text-slate-500">— tap a session to view its marks</span>
          </div>

          {sessions.length === 0 ? (
            <p className="text-slate-600 text-xs italic">No academic sessions configured by the school admin.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all min-h-[40px]"
                  style={s.id === selectedSessionId
                    ? { background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399" }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid #1e293b", color: "#94a3b8" }}
                  data-testid={`pill-session-${s.id}`}
                >
                  <span className="whitespace-nowrap">{s.displayLabel}</span>
                  {s.isActive && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                      style={{ background: "rgba(16,185,129,0.2)", color: "#34d399" }}>
                      Current
                    </span>
                  )}
                  <span className="text-[10px] text-slate-600 whitespace-nowrap">Cl. {s.cls}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Loading state */}
        {policyLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            POLICY VIEW — term-based weighted results
            Exact replica of teacher examination Results tab + Report Card
        ══════════════════════════════════════════════════════════════ */}
        {!policyLoading && usePolicy && (
          <>
            {/* Policy info strip */}
            <div className="no-print flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium"
              style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#6ee7b7" }}>
              <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
              {policyData.tierName} · {termNames.length} term{termNames.length !== 1 ? "s" : ""} ·&nbsp;
              Session <strong>{selectedSession?.displayLabel}</strong> · Class {selectedClass}
            </div>

            {/* Term tabs */}
            {termNames.length > 0 && (
              <div className="no-print flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {termNames.map(term => (
                  <button
                    key={term}
                    onClick={() => setSelectedTerm(term)}
                    className="flex-shrink-0 px-4 rounded-xl text-sm font-semibold transition-all min-h-[42px]"
                    style={selectedTerm === term
                      ? { background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399" }
                      : { background: "#0f172a", border: "1px solid #1e293b", color: "#94a3b8" }}
                    data-testid={`tab-term-${term.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    {term}
                  </button>
                ))}
              </div>
            )}

            {scoresLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
              </div>
            ) : (
              <div id="marksheet-print">
                {/* ── Student identity + summary bar ── */}
                <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #1e293b" }}>

                  {/* Identity row */}
                  <div className="px-5 py-4 flex flex-wrap gap-4 items-center justify-between"
                    style={{ background: "rgba(30,41,59,0.5)", borderBottom: "1px solid #1e293b" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}>
                        <span className="text-emerald-400 font-bold text-sm">{student.name.charAt(0)}</span>
                      </div>
                      <div>
                        <p className="text-white font-bold">{student.name}</p>
                        <p className="text-slate-400 text-xs font-mono">
                          {student.digitalStudentId} · Class {selectedClass}-{student.section}
                          {selectedSession && <> · {selectedSession.displayLabel}</>}
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
                          <span className="text-slate-500 text-xs block">Grade</span>
                          <span className={`inline-flex items-center justify-center px-3 py-1 rounded-xl border text-xl font-bold ${termGrade.color} ${termGrade.bg}`}
                            title={termGrade.remarks}>
                            {termGrade.label}
                          </span>
                        </div>
                      )}
                      <button onClick={handlePrint}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold no-print"
                        style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#34d399" }}
                        data-testid="button-print">
                        <Printer className="w-3.5 h-3.5" /> Print
                      </button>
                    </div>
                  </div>

                  {/* Stats bar — same 4-column layout as teacher Results tab */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: "#1e293b" }}>
                    {[
                      { label: "Term Avg", value: termAvg !== null ? `${termAvg}%` : "—", color: termAvg !== null ? (termAvg >= 60 ? "text-emerald-400" : termAvg >= passThreshold ? "text-yellow-400" : "text-red-400") : "text-slate-600" },
                      { label: "Grade",    value: termGrade?.label ?? "—", color: termGrade ? termGrade.color : "text-slate-600" },
                      { label: "Fails",    value: String(failCount), color: failCount === 0 ? "text-emerald-400" : failCount <= 2 ? "text-amber-400" : "text-red-400" },
                      { label: "Attendance", value: attPct !== null ? `${attPct}%` : "—", color: attPct !== null ? (attPct < 75 ? "text-red-400" : attPct < 85 ? "text-yellow-400" : "text-emerald-400") : "text-slate-600" },
                    ].map(stat => (
                      <div key={stat.label} className="px-5 py-4" style={{ background: "#0f172a" }}>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">{stat.label}</p>
                        <p className={`text-xl font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Per-subject breakdown — exact match of teacher's ReportCardModal */}
                  <div className="p-5 space-y-3" style={{ background: "#0f172a" }}>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                      Subject-wise Aggregation — {selectedTerm}
                    </h3>

                    {activeTermSubjects.length === 0 ? (
                      <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <AlertTriangle className="w-8 h-8 text-amber-500/60" />
                        <p className="text-slate-400 font-semibold text-sm">No Marks Entered Yet</p>
                        <p className="text-slate-600 text-xs max-w-xs">
                          Your class teacher has not entered marks for {selectedTerm} yet.
                          They will appear here as soon as marks are saved — no publish step required.
                        </p>
                      </div>
                    ) : (
                      activeTermSubjects.map(subj => {
                        const g = subj.percentage !== null ? computeGrade(subj.percentage) : null;
                        return (
                          <div key={subj.subject} className="rounded-xl overflow-hidden"
                            style={{ border: "1px solid #1e293b" }}
                            data-testid={`subject-card-${subj.subject}`}>
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

                            {/* Component breakdown table — same columns as teacher's ReportCardModal */}
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
                                        {comp.pct !== null ? <span className="text-slate-300">{comp.pct.toFixed(1)}%</span> : <span className="text-slate-600">—</span>}
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        {comp.contribution !== null
                                          ? <span className="text-emerald-400 font-semibold">+{comp.contribution.toFixed(2)}</span>
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

                  {/* Cross-term fail summary */}
                  {Object.keys(allTermFailCounts).length > 0 && activeTermSubjects.length > 0 && (
                    <div className="px-5 pb-5" style={{ background: "#0f172a" }}>
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Failure Count per Term</h3>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(allTermFailCounts).map(([t, n]) => (
                          <button key={t} onClick={() => setSelectedTerm(t)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all ${t === selectedTerm ? "ring-1 ring-slate-400" : ""} ${n > 0 ? "border-red-500/30 bg-red-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}>
                            <span className={n > 0 ? "text-red-400" : "text-emerald-400"}>{t}</span>
                            <span className={`font-bold ${n > 0 ? "text-red-300" : "text-emerald-300"}`}>{n} fail{n !== 1 ? "s" : ""}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Policy criteria note */}
                  {activeTermSubjects.length > 0 && (
                    <div className="mx-5 mb-5 rounded-xl p-4"
                      style={{ border: "1px solid #1e293b", background: "rgba(30,41,59,0.3)" }}>
                      <p className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                        Policy: {policyData?.tierName}
                      </p>
                      <p className="text-xs text-slate-500">
                        Marks are computed using weighted exam components.
                        They appear here the moment your teacher saves them.
                      </p>
                      {attPct !== null && (
                        <p className="text-xs text-slate-500 mt-1">
                          Attendance for {selectedSession?.displayLabel}:{" "}
                          <span className={`font-semibold ${attPct < 75 ? "text-red-400" : "text-emerald-400"}`}>{attPct}%</span>
                          {attPct < 75 && <span className="text-red-400 ml-1">⚠ Below 75%</span>}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════
            NO-POLICY FALLBACK — exam-type tabs + raw marks table
        ══════════════════════════════════════════════════════════════ */}
        {!policyLoading && policyMissing && (
          <>
            <div className="no-print flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium"
              style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24" }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              No exam policy for Class {selectedClass} — showing raw marks
            </div>

            {examTypes.length > 0 && (
              <div className="no-print flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {examTypes.map(et => (
                  <button key={et} onClick={() => setSelectedExamType(et)}
                    className="flex-shrink-0 px-4 rounded-xl text-sm font-semibold transition-all min-h-[42px]"
                    style={selectedExamType === et
                      ? { background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399" }
                      : { background: "#0f172a", border: "1px solid #1e293b", color: "#94a3b8" }}
                    data-testid={`tab-examtype-${et.replace(/\s+/g, "-").toLowerCase()}`}>
                    {et}
                  </button>
                ))}
              </div>
            )}

            {selectedExamType && (
              fallbackLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-emerald-400" /></div>
              ) : !fallbackScores || fallbackScores.scores.length === 0 ? (
                <div className="rounded-2xl p-10 flex flex-col items-center gap-3 text-center"
                  style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
                  <AlertTriangle className="w-8 h-8 text-amber-500/60" />
                  <h3 className="text-slate-300 font-bold">No Marks Entered Yet</h3>
                  <p className="text-slate-600 text-sm max-w-xs">
                    Your teacher hasn't saved marks for {selectedExamType} yet. They'll appear here instantly once entered.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #1e293b" }}>
                  <div className="px-5 py-3 flex items-center justify-between"
                    style={{ background: "rgba(30,41,59,0.5)", borderBottom: "1px solid #1e293b" }}>
                    <div>
                      <h3 className="text-white font-bold text-sm">{selectedExamType} — {selectedSession?.displayLabel}</h3>
                      <p className="text-slate-500 text-xs mt-0.5">Class {selectedClass}-{student.section}</p>
                    </div>
                    <button onClick={handlePrint}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold no-print"
                      style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#34d399" }}
                      data-testid="button-print-fallback">
                      <Printer className="w-3.5 h-3.5" /> Print
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: "1px solid #1e293b", background: "rgba(30,41,59,0.4)" }}>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Subject</th>
                          <th className="text-center py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">Full Marks</th>
                          <th className="text-center py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">Pass Marks</th>
                          <th className="text-center py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">Obtained</th>
                          <th className="text-center py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Score %</th>
                          <th className="text-center py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Grade</th>
                          <th className="text-center py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fallbackScores.scores.map((score, i) => {
                          const pct = score.totalMarks > 0 ? (score.marks / score.totalMarks) * 100 : 0;
                          const g = score.isAbsent ? null : computeGrade(pct);
                          const passed = !score.isAbsent && score.marks >= score.passMarks;
                          return (
                            <tr key={score.id} style={{ borderBottom: "1px solid rgba(30,41,59,0.6)" }}
                              className="hover:bg-white/[0.02] transition-colors"
                              data-testid={`row-subject-${i}`}>
                              <td className="py-3 px-4 font-medium text-slate-200">{score.subject}</td>
                              <td className="py-3 px-3 text-center text-slate-400">{score.totalMarks}</td>
                              <td className="py-3 px-3 text-center text-slate-500">{score.passMarks}</td>
                              <td className="py-3 px-3 text-center">
                                {score.isAbsent
                                  ? <span className="text-slate-600 italic text-xs">Absent</span>
                                  : <span className={`font-bold ${passed ? "text-slate-200" : "text-red-400"}`}>{score.marks}</span>}
                              </td>
                              <td className="py-3 px-3 text-center">
                                {score.isAbsent
                                  ? <span className="text-slate-600">—</span>
                                  : <span className={pct >= 60 ? "text-emerald-400" : pct >= passThreshold ? "text-yellow-400" : "text-red-400"}>{pct.toFixed(1)}%</span>}
                              </td>
                              <td className="py-3 px-3 text-center">
                                {g
                                  ? <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-lg border text-xs font-bold ${g.color} ${g.bg}`}>{g.label}</span>
                                  : <span className="text-slate-600">—</span>}
                              </td>
                              <td className="py-3 px-3 text-center">
                                {score.isAbsent
                                  ? <span className="text-xs font-semibold text-slate-500">Absent</span>
                                  : passed
                                    ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400" data-testid={`status-pass-${i}`}><CheckCircle2 className="w-3.5 h-3.5" /> Pass</span>
                                    : <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400" data-testid={`status-fail-${i}`}><XCircle className="w-3.5 h-3.5" /> Fail</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {fallbackScores.summary && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px"
                      style={{ background: "#1e293b", borderTop: "1px solid #1e293b" }}>
                      {[
                        { label: "Grand Total", value: `${fallbackScores.summary.totalObtained}/${fallbackScores.summary.totalMax}`, color: "text-white" },
                        { label: "Percentage",  value: `${fallbackScores.summary.percentage}%`, color: fallbackScores.summary.percentage >= 60 ? "text-emerald-400" : fallbackScores.summary.percentage >= passThreshold ? "text-yellow-400" : "text-red-400" },
                        { label: "Grade",       value: fallbackScores.summary.grade, color: gradeColor(fallbackScores.summary.grade) },
                        { label: "Class Rank",  value: fallbackScores.summary.rank ? `${fallbackScores.summary.rank.rank} / ${fallbackScores.summary.rank.total}` : "—", color: "text-yellow-400" },
                      ].map(stat => (
                        <div key={stat.label} className="px-4 py-3" style={{ background: "#0f172a" }}>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide">{stat.label}</p>
                          <p className={`text-lg font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}

            {/* No exam types at all */}
            {examTypes.length === 0 && !policyLoading && (
              <div className="rounded-2xl p-10 flex flex-col items-center gap-3 text-center"
                style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
                <Trophy className="w-8 h-8 text-slate-700" />
                <h3 className="text-slate-400 font-bold">No Marks Entered Yet</h3>
                <p className="text-slate-600 text-sm max-w-xs">
                  Your teacher hasn't entered any marks for Class {selectedClass} ({selectedSession?.displayLabel}) yet.
                  This page refreshes automatically every 30 seconds.
                </p>
              </div>
            )}
          </>
        )}

        {/* No sessions configured */}
        {!policyLoading && sessions.length === 0 && !sessionsLoading && (
          <div className="rounded-2xl p-10 flex flex-col items-center gap-3 text-center"
            style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
            <Award className="w-8 h-8 text-slate-700" />
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
