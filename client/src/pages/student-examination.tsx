import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft, GraduationCap, Loader2, ClipboardList, Download,
  Trophy, AlertCircle, CheckCircle, XCircle, Calendar, BookOpen,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────
interface StudentMeResponse {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  schoolName: string;
  schoolCode: string;
  schoolId?: number;
}

interface ExamScore {
  id: number;
  subject: string;
  examType: string;
  marks: number;
  totalMarks: number;
  passMarks: number;
  isAbsent: boolean;
  class: string | null;
  section: string | null;
}

interface ExamPolicyTier {
  id: number;
  tierName: string;
  applicableClasses: string[];
  examWeights: string;
  promotionFailRules: string;
  passPercentage?: number;
}

interface AllScoresResponse {
  scores: ExamScore[];
  cls: string;
}

// Fallback (no policy) types
interface FallbackScoresResponse {
  scores: ExamScore[];
  summary: { totalObtained: number; totalMax: number; percentage: number; grade: string; rank: { rank: number; total: number } | null };
}

// Term computation types
interface ComponentBreakdown {
  sourceExam: string;
  weight: number;
  marks: number | null;
  totalMarks: number | null;
  pct: number | null;
  isAbsent: boolean;
  status: "scored" | "absent" | "missing";
}

interface SubjectTermResult {
  subject: string;
  breakdown: ComponentBreakdown[];
  percentage: number | null;
  passed: boolean | null;
  status: "scored" | "absent" | "incomplete";
}

interface TermResult {
  termName: string;
  components: Array<{ sourceExam: string; weight: number }>;
  subjectResults: SubjectTermResult[];
  summary: {
    totalSubjects: number;
    passed: number;
    failed: number;
    avgPercentage: number | null;
    grade: string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCurrentAcademicYear(): string {
  const now = new Date();
  const y = now.getFullYear();
  const startYear = now.getMonth() >= 3 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function classToAcademicYear(cls: string, currentClass: string, currentAcYear: string): string {
  const currentNum = parseInt(currentClass);
  const clsNum = parseInt(cls);
  if (!isNaN(currentNum) && !isNaN(clsNum)) {
    const diff = currentNum - clsNum;
    const startYearMatch = currentAcYear.match(/^(\d{4})/);
    if (startYearMatch) {
      const sy = parseInt(startYearMatch[1]) - diff;
      return `${sy}-${String(sy + 1).slice(-2)}`;
    }
  }
  return `Class ${cls}`;
}

function buildYearOptions(
  currentClass: string,
  currentAcYear: string,
  allClasses: string[],
): Array<{ label: string; cls: string; isCurrent: boolean }> {
  const unique = Array.from(new Set([currentClass, ...allClasses]));
  unique.sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    return b.localeCompare(a);
  });
  return unique.map(cls => ({
    label: classToAcademicYear(cls, currentClass, currentAcYear),
    cls,
    isCurrent: cls === currentClass,
  }));
}

function calcGrade(pct: number): string {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B+";
  if (pct >= 60) return "B";
  if (pct >= 50) return "C";
  if (pct >= 40) return "D";
  return "F";
}

function computeTermResults(
  scores: ExamScore[],
  policy: ExamPolicyTier,
  passThreshold = 35,
): TermResult[] {
  let rawWeights: Record<string, { source_exam: string; weight: number }[]> = {};
  try { rawWeights = JSON.parse(policy.examWeights || "{}"); } catch {}

  const termNames = Object.keys(rawWeights).map(k => k.trim());

  const bySubject: Record<string, ExamScore[]> = {};
  for (const sc of scores) {
    if (!bySubject[sc.subject]) bySubject[sc.subject] = [];
    bySubject[sc.subject].push(sc);
  }
  const subjects = Object.keys(bySubject).sort();

  return termNames.map(termName => {
    const components = (rawWeights[termName] || []).map(c => ({
      sourceExam: c.source_exam,
      weight: c.weight,
    }));

    const subjectResults: SubjectTermResult[] = subjects.map(subject => {
      const subjectScores = bySubject[subject];
      let weightedSum = 0, totalWeight = 0;
      let hasAbsent = false, hasData = false;

      const breakdown: ComponentBreakdown[] = components.map(comp => {
        const record = subjectScores.find(s => s.examType === comp.sourceExam);
        if (!record) {
          return { sourceExam: comp.sourceExam, weight: comp.weight, marks: null, totalMarks: null, pct: null, isAbsent: false, status: "missing" as const };
        }
        hasData = true;
        if (record.isAbsent) {
          hasAbsent = true;
          return { sourceExam: comp.sourceExam, weight: comp.weight, marks: 0, totalMarks: record.totalMarks, pct: null, isAbsent: true, status: "absent" as const };
        }
        const pct = record.totalMarks > 0 ? (record.marks / record.totalMarks) * 100 : 0;
        const contribution = pct * (comp.weight / 100);
        weightedSum += contribution;
        totalWeight += comp.weight;
        return { sourceExam: comp.sourceExam, weight: comp.weight, marks: record.marks, totalMarks: record.totalMarks, pct, isAbsent: false, status: "scored" as const };
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

      return { subject, breakdown, percentage, passed: percentage !== null ? percentage >= passThreshold : null, status };
    });

    const scored = subjectResults.filter(s => s.status === "scored");
    const passedCount = scored.filter(s => s.passed).length;
    const failedCount = scored.filter(s => !s.passed).length;
    const avgPct = scored.length > 0
      ? Math.round((scored.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / scored.length) * 10) / 10
      : null;

    return {
      termName,
      components,
      subjectResults,
      summary: { totalSubjects: subjectResults.length, passed: passedCount, failed: failedCount, avgPercentage: avgPct, grade: avgPct !== null ? calcGrade(avgPct) : "—" },
    };
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────
function GradeChip({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    "A+": "bg-emerald-100 text-emerald-800 border-emerald-300",
    "A":  "bg-emerald-50  text-emerald-700 border-emerald-200",
    "B+": "bg-blue-50    text-blue-700    border-blue-200",
    "B":  "bg-blue-50    text-blue-600    border-blue-200",
    "C":  "bg-amber-50   text-amber-700   border-amber-200",
    "D":  "bg-orange-50  text-orange-700  border-orange-200",
    "F":  "bg-red-50     text-red-700     border-red-200",
  };
  return (
    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-lg border text-xs font-bold ${colors[grade] ?? colors["F"]}`}>
      {grade}
    </span>
  );
}

function PrintStyles() {
  return (
    <style>{`
      @media print {
        body * { visibility: hidden !important; }
        #marksheet-print, #marksheet-print * { visibility: visible !important; }
        #marksheet-print { position: fixed; top: 0; left: 0; width: 100%; padding: 24px; }
        .no-print { display: none !important; }
      }
    `}</style>
  );
}

// ── Term breakdown table (policy-based view) ──────────────────────────────────
function TermBreakdownTable({ termResult, passThreshold }: { termResult: TermResult; passThreshold: number }) {
  return (
    <div className="rounded-2xl overflow-hidden bg-white/80 border border-white/70 shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: `${260 + termResult.components.length * 120}px` }} data-testid="table-term-breakdown">
          <thead>
            <tr className="bg-emerald-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide sticky left-0 bg-emerald-50">Subject</th>
              {termResult.components.map(comp => (
                <th key={comp.sourceExam} className="text-center px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                  {comp.sourceExam}
                  <span className="ml-1 text-[10px] font-normal text-gray-400">({comp.weight}%)</span>
                </th>
              ))}
              <th className="text-center px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Term %</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Grade</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {termResult.subjectResults.map((sr, i) => (
              <tr
                key={sr.subject}
                className={`transition-colors hover:bg-emerald-50/30 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}
                data-testid={`row-subject-${i}`}
              >
                <td className="px-4 py-3.5 font-semibold text-gray-800 sticky left-0 bg-inherit">{sr.subject}</td>
                {sr.breakdown.map(b => (
                  <td key={b.sourceExam} className="px-3 py-3.5 text-center">
                    {b.status === "missing" ? (
                      <span className="text-gray-300 text-xs">—</span>
                    ) : b.status === "absent" ? (
                      <span className="text-xs font-semibold text-red-400 bg-red-50 px-2 py-0.5 rounded-full">AB</span>
                    ) : (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-semibold text-gray-800 text-xs">{b.marks}/{b.totalMarks}</span>
                        <span className="text-[10px] text-gray-400">{b.pct !== null ? `${Math.round(b.pct)}%` : ""}</span>
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-3 py-3.5 text-center">
                  {sr.percentage !== null ? (
                    <span className={`font-bold text-sm ${sr.percentage >= passThreshold ? "text-gray-800" : "text-red-600"}`}>
                      {sr.percentage}%
                    </span>
                  ) : (
                    <span className="text-gray-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-3.5 text-center">
                  {sr.percentage !== null ? <GradeChip grade={calcGrade(sr.percentage)} /> : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-3.5 text-center">
                  {sr.status === "incomplete" ? (
                    <span className="text-xs text-gray-400 italic">Pending</span>
                  ) : sr.status === "absent" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400">Absent</span>
                  ) : sr.passed ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#10b981]" data-testid={`status-pass-${i}`}>
                      <CheckCircle className="w-3.5 h-3.5" /> Pass
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500" data-testid={`status-fail-${i}`}>
                      <XCircle className="w-3.5 h-3.5" /> Fail
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StudentExamination() {
  const [, setLocation] = useLocation();
  const currentAcYear = useMemo(() => getCurrentAcademicYear(), []);

  const [selectedClass, setSelectedClass] = useState<string>("");
  const [selectedTerm, setSelectedTerm] = useState<string>("");
  const [selectedExamType, setSelectedExamType] = useState<string>("");

  // ── Student data ──────────────────────────────────────────────────────────
  const { data: student, isLoading: studentLoading } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  // ── Available classes (historical) ────────────────────────────────────────
  const { data: classesData } = useQuery<{ classes: string[] }>({
    queryKey: ["/api/student/exam/classes"],
    enabled: !!student,
  });

  // Set default selectedClass once student loads
  useEffect(() => {
    if (student && !selectedClass) setSelectedClass(student.class);
  }, [student, selectedClass]);

  // Build year options
  const yearOptions = useMemo(() => {
    if (!student) return [];
    return buildYearOptions(student.class, currentAcYear, classesData?.classes ?? []);
  }, [student, currentAcYear, classesData]);

  // ── Policy for selected class ──────────────────────────────────────────────
  const {
    data: policyData,
    isLoading: policyLoading,
    isError: policyError,
  } = useQuery<ExamPolicyTier>({
    queryKey: ["/api/student/exam/policy", selectedClass],
    queryFn: async () => {
      const r = await fetch(`/api/student/exam/policy?class=${encodeURIComponent(selectedClass)}`, { credentials: "include" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as any).message ?? "No policy");
      }
      return r.json();
    },
    enabled: !!selectedClass,
    retry: false,
    staleTime: 60000,
  });

  // ── All scores for selected class (for term-based view) ───────────────────
  const { data: allScoresData, isLoading: allScoresLoading } = useQuery<AllScoresResponse>({
    queryKey: ["/api/student/exam/all-scores", selectedClass],
    queryFn: async () => {
      const r = await fetch(`/api/student/exam/all-scores?class=${encodeURIComponent(selectedClass)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!selectedClass && !policyError,
    staleTime: 0,
  });

  // ── Fallback: exam types (when no policy) ─────────────────────────────────
  const { data: typesData } = useQuery<{ examTypes: string[] }>({
    queryKey: ["/api/student/exam/types", selectedClass],
    queryFn: async () => {
      const r = await fetch(`/api/student/exam/types?class=${encodeURIComponent(selectedClass)}`, { credentials: "include" });
      if (!r.ok) return { examTypes: [] };
      return r.json();
    },
    enabled: !!selectedClass && !!policyError,
  });

  // ── Fallback: per-exam-type scores ────────────────────────────────────────
  const { data: fallbackScores, isLoading: fallbackLoading } = useQuery<FallbackScoresResponse>({
    queryKey: ["/api/student/exam/scores", selectedClass, selectedExamType],
    queryFn: async () => {
      const r = await fetch(`/api/student/exam/scores?class=${encodeURIComponent(selectedClass)}&examType=${encodeURIComponent(selectedExamType)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!selectedClass && !!selectedExamType && !!policyError,
  });

  // ── Derived state ──────────────────────────────────────────────────────────
  const usePolicy = !!policyData && !policyError;
  const passThreshold = policyData?.passPercentage ?? 35;

  const termResults = useMemo(() => {
    if (!usePolicy || !allScoresData || !policyData) return [];
    return computeTermResults(allScoresData.scores, policyData, passThreshold);
  }, [usePolicy, allScoresData, policyData, passThreshold]);

  const termNames = termResults.map(t => t.termName);

  // Auto-select first term
  useEffect(() => {
    if (termNames.length > 0 && !selectedTerm) setSelectedTerm(termNames[0]);
  }, [termNames, selectedTerm]);
  useEffect(() => {
    if (termNames.length > 0 && !termNames.includes(selectedTerm)) setSelectedTerm(termNames[0]);
  }, [termNames, selectedTerm]);

  // Auto-select exam type (fallback)
  const examTypes = typesData?.examTypes ?? [];
  useEffect(() => {
    if (examTypes.length > 0 && (!selectedExamType || !examTypes.includes(selectedExamType))) {
      setSelectedExamType(examTypes[0]);
    }
  }, [examTypes, selectedExamType]);

  const activeTermResult = termResults.find(t => t.termName === selectedTerm);

  // Class change handler
  function handleClassChange(cls: string) {
    setSelectedClass(cls);
    setSelectedTerm("");
    setSelectedExamType("");
  }

  const handlePrint = useCallback(() => { window.print(); }, []);

  const isLoadingContent = policyLoading || (usePolicy && allScoresLoading) || (!usePolicy && fallbackLoading);

  // ── Render loading skeleton ───────────────────────────────────────────────
  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  const selectedYearLabel = yearOptions.find(y => y.cls === selectedClass)?.label ?? currentAcYear;

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: "#f8fafc" }}>
      <PrintStyles />

      {/* Decorative blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
      </div>

      {/* ── Sticky header ── */}
      <header
        className="sticky top-0 z-30 no-print"
        style={{
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          background: "rgba(255,255,255,0.75)",
          borderBottom: "1px solid rgba(255,255,255,0.7)",
          boxShadow: "0 1px 28px rgba(0,0,0,0.07)",
        }}
      >
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-10 h-10 rounded-xl transition-colors flex-shrink-0"
            style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0" style={{ background: "linear-gradient(135deg, #f97316, #ef4444)" }}>
              <ClipboardList className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="font-bold text-sm text-slate-800 truncate">Academic Performance</p>
              <p className="text-[11px] text-slate-400 truncate">{student.digitalStudentId} · Class {student.class}-{student.section}</p>
            </div>
          </div>
          <span className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0" style={{ background: "rgba(0,0,0,0.05)", color: "#475569" }}>
            <GraduationCap className="w-3.5 h-3.5" />
            {student.schoolCode}
          </span>
        </div>
      </header>

      <motion.main
        className="flex-1 max-w-3xl mx-auto w-full px-4 py-5 space-y-5"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >

        {/* ── Academic Session Selector ── */}
        <div className="rounded-2xl p-4 bg-white/80 border border-white/70 shadow-sm no-print">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-[#10b981]" />
            <h2 className="text-sm font-bold text-gray-800">Academic Session</h2>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {yearOptions.map(opt => (
              <button
                key={opt.cls}
                onClick={() => handleClassChange(opt.cls)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all min-h-[40px] ${
                  opt.cls === selectedClass
                    ? "bg-[#10b981] text-white border-[#10b981] shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-emerald-300 hover:text-[#10b981]"
                }`}
                data-testid={`pill-year-${opt.cls}`}
              >
                {opt.label}
                {opt.isCurrent && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${opt.cls === selectedClass ? "bg-white/25 text-white" : "bg-emerald-50 text-emerald-600"}`}>
                    Current
                  </span>
                )}
              </button>
            ))}
            {yearOptions.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-1">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading sessions…
              </div>
            )}
          </div>
        </div>

        {/* ── Policy info strip ── */}
        {!policyLoading && selectedClass && (
          <div className={`no-print flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium ${
            usePolicy
              ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
              : "bg-amber-50 border border-amber-200 text-amber-700"
          }`}>
            <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
            {usePolicy
              ? `Policy: ${policyData.tierName} · ${termNames.length} term${termNames.length !== 1 ? "s" : ""} · Session ${selectedYearLabel}`
              : `No exam policy configured for Class ${selectedClass} — showing exam-type view`}
          </div>
        )}

        {/* ── POLICY VIEW: Term tabs + breakdown table ── */}
        {usePolicy && (
          <>
            {/* Term tabs */}
            {termNames.length > 0 && (
              <div className="no-print flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {termNames.map(term => (
                  <button
                    key={term}
                    onClick={() => setSelectedTerm(term)}
                    className={`flex-shrink-0 px-4 rounded-xl text-sm font-semibold border transition-all min-h-[44px] ${
                      selectedTerm === term
                        ? "bg-[#10b981] text-white border-[#10b981] shadow-sm"
                        : "bg-white text-gray-600 border-gray-200 hover:border-emerald-300 hover:text-[#10b981]"
                    }`}
                    data-testid={`tab-term-${term.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    {term}
                  </button>
                ))}
              </div>
            )}

            {/* Content */}
            {isLoadingContent ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
              </div>
            ) : !activeTermResult ? (
              <div className="rounded-2xl p-8 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
                  <AlertCircle className="w-7 h-7 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-gray-700">Results Awaiting Publication</h3>
                <p className="text-sm text-gray-400 max-w-xs">
                  Your teacher or principal hasn't published marks for {selectedYearLabel} yet. Check back soon.
                </p>
              </div>
            ) : activeTermResult.subjectResults.length === 0 ? (
              <div className="rounded-2xl p-8 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
                  <AlertCircle className="w-7 h-7 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-gray-700">No Records Found</h3>
                <p className="text-sm text-gray-400 max-w-xs">No published marks found for {selectedTerm} — {selectedYearLabel}.</p>
              </div>
            ) : (
              <div id="marksheet-print">
                {/* Print header */}
                <div className="hidden print:block mb-6">
                  <div className="text-center border-b-2 border-emerald-600 pb-4 mb-4">
                    <div className="flex justify-center mb-2">
                      <div className="w-14 h-14 rounded-full border-2 border-emerald-700 flex items-center justify-center bg-emerald-50">
                        <GraduationCap className="w-7 h-7 text-emerald-700" />
                      </div>
                    </div>
                    <h1 className="text-2xl font-bold text-emerald-800">{student.schoolName}</h1>
                    <p className="text-sm text-gray-600 mt-1">Academic Marksheet · {selectedTerm} · Session {selectedYearLabel}</p>
                    <div className="mt-3 grid grid-cols-2 gap-x-8 text-sm text-left max-w-sm mx-auto">
                      <span className="text-gray-500">Student Name:</span><span className="font-semibold">{student.name}</span>
                      <span className="text-gray-500">DSID:</span><span className="font-semibold">{student.digitalStudentId}</span>
                      <span className="text-gray-500">Class / Section:</span><span className="font-semibold">Class {selectedClass}-{student.section}</span>
                      <span className="text-gray-500">School Code:</span><span className="font-semibold">{student.schoolCode}</span>
                      <span className="text-gray-500">Date Issued:</span><span className="font-semibold">{new Date().toLocaleDateString("en-GB")}</span>
                    </div>
                  </div>
                </div>

                {/* Table header bar */}
                <div className="rounded-t-2xl overflow-hidden bg-white/80 border border-white/70 border-b-0 no-print">
                  <div className="px-4 py-3 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-800">{selectedTerm} — {selectedYearLabel}</h3>
                    <button
                      onClick={handlePrint}
                      className="flex items-center gap-1.5 px-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-[#10b981] text-xs font-semibold border border-emerald-200 transition-colors min-h-[36px]"
                      data-testid="button-download-marksheet"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Marksheet
                    </button>
                  </div>
                </div>

                {/* Breakdown table */}
                <div className="rounded-b-2xl overflow-hidden border border-white/70 border-t-0 shadow-sm">
                  <TermBreakdownTable termResult={activeTermResult} passThreshold={passThreshold} />
                </div>

                {/* ── Term Summary Card ── */}
                <div className="bg-gradient-to-br from-[#10b981] to-[#059669] rounded-2xl shadow-sm p-5 mt-5" data-testid="card-summary">
                  <div className="flex items-center gap-2 mb-4">
                    <Trophy className="w-5 h-5 text-emerald-100" />
                    <h3 className="text-sm font-bold text-white">{selectedTerm} Summary</h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-white/15 rounded-xl p-3 text-center">
                      <p className="text-xs text-emerald-100 font-medium">Term Average</p>
                      <p className="text-xl font-extrabold text-white mt-1" data-testid="text-term-avg">
                        {activeTermResult.summary.avgPercentage !== null ? `${activeTermResult.summary.avgPercentage}%` : "—"}
                      </p>
                    </div>
                    <div className="bg-white/15 rounded-xl p-3 text-center">
                      <p className="text-xs text-emerald-100 font-medium">Overall Grade</p>
                      <p className="text-xl font-extrabold text-white mt-1" data-testid="text-grade">
                        {activeTermResult.summary.grade}
                      </p>
                    </div>
                    <div className="bg-white/15 rounded-xl p-3 text-center">
                      <p className="text-xs text-emerald-100 font-medium">Subjects Passed</p>
                      <p className="text-xl font-extrabold text-white mt-1" data-testid="text-passed">
                        {activeTermResult.summary.passed} / {activeTermResult.summary.totalSubjects}
                      </p>
                    </div>
                    <div className="bg-white/15 rounded-xl p-3 text-center">
                      <p className="text-xs text-emerald-100 font-medium">Need Improvement</p>
                      <p className={`text-xl font-extrabold mt-1 ${activeTermResult.summary.failed > 0 ? "text-red-200" : "text-white"}`} data-testid="text-failed">
                        {activeTermResult.summary.failed}
                      </p>
                    </div>
                  </div>

                  {/* All-terms summary strip */}
                  {termResults.length > 1 && (
                    <div className="mt-4 pt-4 border-t border-white/20">
                      <p className="text-xs text-emerald-200 font-semibold mb-2 uppercase tracking-wide">All Terms — {selectedYearLabel}</p>
                      <div className="flex flex-wrap gap-2">
                        {termResults.map(tr => (
                          <button
                            key={tr.termName}
                            onClick={() => setSelectedTerm(tr.termName)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                              tr.termName === selectedTerm
                                ? "bg-white/30 border-white/50 text-white"
                                : "bg-white/10 border-white/20 text-emerald-100 hover:bg-white/20"
                            }`}
                            data-testid={`summary-term-${tr.termName}`}
                          >
                            {tr.termName}
                            <span className="font-extrabold">
                              {tr.summary.avgPercentage !== null ? `${tr.summary.avgPercentage}%` : "—"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Print footer */}
                  <div className="hidden print:block mt-6 pt-4 border-t border-white/20 text-center text-xs text-emerald-100">
                    This is a computer-generated document. · {student.schoolName} · {new Date().toLocaleDateString("en-GB")}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── FALLBACK VIEW: Exam-type tabs + simple table ── */}
        {!usePolicy && !policyLoading && (
          <>
            {/* Exam type tabs */}
            {examTypes.length > 0 ? (
              <div className="no-print flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {examTypes.map(et => (
                  <button
                    key={et}
                    onClick={() => setSelectedExamType(et)}
                    className={`flex-shrink-0 px-4 rounded-xl text-sm font-semibold border transition-all min-h-[44px] ${
                      selectedExamType === et
                        ? "bg-[#10b981] text-white border-[#10b981] shadow-sm"
                        : "bg-white text-gray-600 border-gray-200 hover:border-emerald-300 hover:text-[#10b981]"
                    }`}
                    data-testid={`tab-examtype-${et.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    {et}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl p-8 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
                  <AlertCircle className="w-7 h-7 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-gray-700">Results Awaiting Publication</h3>
                <p className="text-sm text-gray-400 max-w-xs">
                  Your teacher or principal hasn't published marks for {selectedYearLabel} yet. Check back soon.
                </p>
              </div>
            )}

            {/* Marks table */}
            {selectedExamType && (
              fallbackLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
                </div>
              ) : !fallbackScores || fallbackScores.scores.length === 0 ? (
                <div className="rounded-2xl p-8 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-3 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
                    <AlertCircle className="w-7 h-7 text-amber-400" />
                  </div>
                  <h3 className="text-base font-bold text-gray-700">Results Awaiting Publication</h3>
                  <p className="text-sm text-gray-400 max-w-xs">No published marks found for {selectedExamType} — {selectedYearLabel}.</p>
                </div>
              ) : (
                <div id="marksheet-print">
                  <div className="rounded-2xl overflow-hidden bg-white/80 border border-white/70 shadow-sm">
                    <div className="px-4 py-3 border-b border-emerald-50 flex items-center justify-between no-print">
                      <h3 className="text-sm font-bold text-gray-800">{selectedExamType} — {selectedYearLabel}</h3>
                      <button
                        onClick={handlePrint}
                        className="flex items-center gap-1.5 px-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-[#10b981] text-xs font-semibold border border-emerald-200 transition-colors min-h-[36px]"
                        data-testid="button-download-marksheet"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Marksheet
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-marks">
                        <thead>
                          <tr className="bg-emerald-50">
                            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Subject</th>
                            <th className="text-center px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Full Marks</th>
                            <th className="text-center px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Pass Marks</th>
                            <th className="text-center px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Obtained</th>
                            <th className="text-center px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Grade</th>
                            <th className="text-center px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {fallbackScores.scores.map((score, i) => {
                            const pct = score.totalMarks > 0 ? (score.marks / score.totalMarks) * 100 : 0;
                            const grade = score.isAbsent ? "—" : calcGrade(pct);
                            const passed = !score.isAbsent && score.marks >= score.passMarks;
                            return (
                              <tr key={score.id} className={`hover:bg-emerald-50/30 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`} data-testid={`row-subject-${i}`}>
                                <td className="px-4 py-3.5 font-medium text-gray-800">{score.subject}</td>
                                <td className="px-3 py-3.5 text-center text-gray-600">{score.totalMarks}</td>
                                <td className="px-3 py-3.5 text-center text-gray-500">{score.passMarks}</td>
                                <td className="px-3 py-3.5 text-center">
                                  {score.isAbsent ? <span className="text-gray-400 italic text-xs">Absent</span> : <span className={`font-bold ${passed ? "text-gray-900" : "text-red-600"}`}>{score.marks}</span>}
                                </td>
                                <td className="px-3 py-3.5 text-center">
                                  {score.isAbsent ? <span className="text-gray-400">—</span> : <GradeChip grade={grade} />}
                                </td>
                                <td className="px-3 py-3.5 text-center">
                                  {score.isAbsent ? (
                                    <span className="text-xs text-gray-400">Absent</span>
                                  ) : passed ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#10b981]"><CheckCircle className="w-3.5 h-3.5" /> Pass</span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500"><XCircle className="w-3.5 h-3.5" /> Fail</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Summary */}
                  {fallbackScores.summary && (
                    <div className="bg-gradient-to-br from-[#10b981] to-[#059669] rounded-2xl shadow-sm p-5 mt-5" data-testid="card-summary">
                      <div className="flex items-center gap-2 mb-4">
                        <Trophy className="w-5 h-5 text-emerald-100" />
                        <h3 className="text-sm font-bold text-white">Result Summary — {selectedExamType}</h3>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-white/15 rounded-xl p-3 text-center">
                          <p className="text-xs text-emerald-100 font-medium">Grand Total</p>
                          <p className="text-xl font-extrabold text-white mt-1" data-testid="text-grand-total">
                            {fallbackScores.summary.totalObtained}/{fallbackScores.summary.totalMax}
                          </p>
                        </div>
                        <div className="bg-white/15 rounded-xl p-3 text-center">
                          <p className="text-xs text-emerald-100 font-medium">Percentage</p>
                          <p className="text-xl font-extrabold text-white mt-1" data-testid="text-percentage">
                            {fallbackScores.summary.percentage}%
                          </p>
                        </div>
                        <div className="bg-white/15 rounded-xl p-3 text-center">
                          <p className="text-xs text-emerald-100 font-medium">Overall Grade</p>
                          <p className="text-xl font-extrabold text-white mt-1" data-testid="text-overall-grade">
                            {fallbackScores.summary.grade}
                          </p>
                        </div>
                        <div className="bg-white/15 rounded-xl p-3 text-center">
                          <p className="text-xs text-emerald-100 font-medium">Class Rank</p>
                          <p className="text-xl font-extrabold text-white mt-1" data-testid="text-class-rank">
                            {fallbackScores.summary.rank ? `${fallbackScores.summary.rank.rank} / ${fallbackScores.summary.rank.total}` : "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </>
        )}

        {/* Policy loading state */}
        {policyLoading && selectedClass && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
          </div>
        )}

      </motion.main>
    </div>
  );
}
