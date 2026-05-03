import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft, GraduationCap, Loader2, ClipboardList, Download,
  Trophy, TrendingUp, AlertCircle, ChevronDown, CheckCircle, XCircle,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

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

interface ExamSummary {
  totalObtained: number;
  totalMax: number;
  percentage: number;
  grade: string;
  rank: { rank: number; total: number } | null;
}

interface ScoresResponse {
  scores: ExamScore[];
  summary: ExamSummary;
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
    <span className={`inline-flex items-center justify-center w-9 h-7 rounded-lg border text-xs font-bold ${colors[grade] ?? colors["F"]}`}>
      {grade}
    </span>
  );
}

function AcademicJourneyChart({ classData }: { classData: { cls: string; pct: number }[] }) {
  if (classData.length < 1) return null;
  const W = 320;
  const H = 140;
  const PADL = 32;
  const PADR = 16;
  const PADT = 16;
  const PADB = 32;
  const chartW = W - PADL - PADR;
  const chartH = H - PADT - PADB;

  const maxPct = 100;
  const minPct = 0;

  const xs = classData.map((_, i) => PADL + (chartW / Math.max(classData.length - 1, 1)) * i);
  const ys = classData.map(d => PADT + chartH - (chartH * (d.pct - minPct)) / (maxPct - minPct));

  const pathD = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x} ${ys[i]}`).join(" ");
  const areaD = `${pathD} L ${xs[xs.length - 1]} ${H - PADB} L ${xs[0]} ${H - PADB} Z`;

  const yLines = [0, 25, 50, 75, 100];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="emeraldGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {yLines.map(y => {
        const cy = PADT + chartH - (chartH * y) / 100;
        return (
          <g key={y}>
            <line x1={PADL} y1={cy} x2={W - PADR} y2={cy} stroke="#e5e7eb" strokeWidth="1" />
            <text x={PADL - 4} y={cy + 3} textAnchor="end" fontSize="8" fill="#9ca3af">{y}%</text>
          </g>
        );
      })}

      <path d={areaD} fill="url(#emeraldGrad)" />
      <path d={pathD} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {classData.map((d, i) => (
        <g key={i}>
          <circle cx={xs[i]} cy={ys[i]} r="5" fill="#10b981" stroke="white" strokeWidth="2" />
          <text x={xs[i]} y={ys[i] - 9} textAnchor="middle" fontSize="8.5" fill="#10b981" fontWeight="700">
            {d.pct}%
          </text>
          <text x={xs[i]} y={H - PADB + 13} textAnchor="middle" fontSize="8" fill="#6b7280">
            Cl {d.cls}
          </text>
        </g>
      ))}
    </svg>
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

export default function StudentExamination() {
  const [, setLocation] = useLocation();
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [selectedExamType, setSelectedExamType] = useState<string>("");
  const [showClassDropdown, setShowClassDropdown] = useState(false);

  const { data: student, isLoading: studentLoading } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const { data: classesData } = useQuery<{ classes: string[] }>({
    queryKey: ["/api/student/exam/classes"],
    enabled: !!student,
  });

  const { data: typesData, isLoading: typesLoading } = useQuery<{ examTypes: string[] }>({
    queryKey: ["/api/student/exam/types", selectedClass],
    queryFn: async () => {
      const params = new URLSearchParams({ class: selectedClass });
      const res = await fetch(`/api/student/exam/types?${params}`, { credentials: "include" });
      if (res.status === 401) return { examTypes: [] };
      if (!res.ok) throw new Error("Failed to fetch exam types");
      return res.json();
    },
    enabled: !!student && !!selectedClass,
  });

  const { data: scoresData, isLoading: scoresLoading } = useQuery<ScoresResponse>({
    queryKey: ["/api/student/exam/scores", selectedClass, selectedExamType],
    queryFn: async () => {
      const params = new URLSearchParams({ class: selectedClass, examType: selectedExamType });
      const res = await fetch(`/api/student/exam/scores?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch scores");
      return res.json();
    },
    enabled: !!student && !!selectedClass && !!selectedExamType,
  });

  const currentClass = student?.class ?? "";

  useEffect(() => {
    if (student && !selectedClass) {
      setSelectedClass(student.class);
    }
  }, [student, selectedClass]);

  useEffect(() => {
    if (typesData?.examTypes.length) {
      setSelectedExamType(prev => typesData.examTypes.includes(prev) ? prev : typesData.examTypes[0]);
    } else {
      setSelectedExamType("");
    }
  }, [typesData]);

  const classes = classesData?.classes ?? [];
  const examTypes = typesData?.examTypes ?? [];
  const scores = scoresData?.scores ?? [];
  const summary = scoresData?.summary;

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  const noPublishedTypes = !typesLoading && examTypes.length === 0;

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: "#f8fafc" }}>
      <PrintStyles />

      {/* ── Decorative blobs ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", top: "38%", left: "28%", width: "360px", height: "360px", borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 65%)" }} />
      </div>

      {/* ── Sticky header ── */}
      <header
        className="sticky top-0 z-30 no-print"
        style={{
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          background: "rgba(255, 255, 255, 0.75)",
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

        {/* ── Year/Class Switcher ── */}
        <div className="rounded-2xl p-4 bg-white/80 border border-white/70 shadow-sm no-print">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-gray-800">Academic Year</h2>
              <p className="text-xs text-gray-500 mt-0.5">Switch between class years</p>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowClassDropdown(v => !v)}
                className="flex items-center gap-2 min-w-[130px] px-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold hover:bg-emerald-100 transition-colors h-11"
                data-testid="button-class-switcher"
              >
                <GraduationCap className="w-4 h-4 text-[#10b981]" />
                Class {selectedClass}
                <ChevronDown className="w-4 h-4 ml-auto text-[#10b981]" />
              </button>
              {showClassDropdown && (
                <div className="absolute right-0 mt-1 w-40 bg-white border border-emerald-100 rounded-xl shadow-lg z-20 py-1">
                  {[currentClass, ...classes.filter(c => c !== currentClass)].map(cls => (
                    <button
                      key={cls}
                      onClick={() => { setSelectedClass(cls); setShowClassDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors min-h-[44px] flex items-center ${
                        cls === selectedClass ? "bg-emerald-50 text-[#10b981]" : "text-gray-700 hover:bg-gray-50"
                      }`}
                      data-testid={`option-class-${cls}`}
                    >
                      Class {cls}{cls === currentClass ? " (Current)" : ""}
                    </button>
                  ))}
                  {classes.length === 0 && (
                    <p className="px-4 py-2 text-xs text-gray-400">No historical data</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Exam Type Tabs ── */}
        {typesLoading ? (
          <div className="flex justify-center py-4 no-print">
            <Loader2 className="w-6 h-6 animate-spin text-[#10b981]" />
          </div>
        ) : noPublishedTypes ? (
          <div className="no-print" />
        ) : (
          <div className="no-print">
            {/* Mobile: horizontal scroll; Desktop: flex-wrap standard tab bar */}
            <div className="flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-x-visible pb-1 scrollbar-hide">
              {examTypes.map(et => (
                <button
                  key={et}
                  onClick={() => setSelectedExamType(et)}
                  className={`flex-shrink-0 sm:flex-shrink px-4 rounded-xl text-sm font-semibold border transition-all min-h-[44px] ${
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
          </div>
        )}

        {/* ── Marks Table / Empty State ── */}
        {!selectedExamType || noPublishedTypes ? (
          <div className="rounded-2xl p-8 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-amber-400" />
            </div>
            <h3 className="text-base font-bold text-gray-700">Results Awaiting Publication</h3>
            <p className="text-sm text-gray-400 max-w-xs">
              Your teacher or principal hasn't published marks for this class yet. Check back soon.
            </p>
          </div>
        ) : scoresLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
          </div>
        ) : scores.length === 0 ? (
          <div className="rounded-2xl p-8 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-amber-400" />
            </div>
            <h3 className="text-base font-bold text-gray-700">Results Awaiting Publication</h3>
            <p className="text-sm text-gray-400 max-w-xs">
              No published marks found for {selectedExamType} — Class {selectedClass}.
            </p>
          </div>
        ) : (
          <div id="marksheet-print">
            {/* Print header (only shows on print) */}
            <div className="hidden print:block mb-6">
              <div className="text-center border-b-2 border-emerald-600 pb-4 mb-4">
                {/* Logo placeholder for print marksheet */}
                <div className="flex justify-center mb-2">
                  <div className="w-14 h-14 rounded-full border-2 border-emerald-700 flex items-center justify-center bg-emerald-50">
                    <GraduationCap className="w-7 h-7 text-emerald-700" />
                  </div>
                </div>
                <h1 className="text-2xl font-bold text-emerald-800">{student.schoolName}</h1>
                <p className="text-sm text-gray-600 mt-1">Academic Marksheet · {selectedExamType} Examination · Class {selectedClass}</p>
                <div className="mt-3 grid grid-cols-2 gap-x-8 text-sm text-left max-w-sm mx-auto">
                  <span className="text-gray-500">Student Name:</span><span className="font-semibold">{student.name}</span>
                  <span className="text-gray-500">DSID:</span><span className="font-semibold">{student.digitalStudentId}</span>
                  <span className="text-gray-500">Class/Section:</span><span className="font-semibold">Class {selectedClass} – {student.section}</span>
                  <span className="text-gray-500">School Code:</span><span className="font-semibold">{student.schoolCode}</span>
                  <span className="text-gray-500">Date Issued:</span>
                  <span className="font-semibold">{new Date().toLocaleDateString("en-GB")}</span>
                </div>
              </div>
            </div>

            {/* Marks Table */}
            <div className="rounded-2xl overflow-hidden bg-white/80 border border-white/70 shadow-sm">
              <div className="px-4 py-3 border-b border-emerald-50 flex items-center justify-between no-print">
                <h3 className="text-sm font-bold text-gray-800">{selectedExamType} — Class {selectedClass}</h3>
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-1.5 px-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-[#10b981] text-xs font-semibold border border-emerald-200 transition-colors min-h-[44px]"
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
                    {scores.map((score, i) => {
                      const pct = score.totalMarks > 0 ? (score.marks / score.totalMarks) * 100 : 0;
                      const grade = score.isAbsent ? "—" : calcGrade(pct);
                      const passed = !score.isAbsent && score.marks >= score.passMarks;
                      return (
                        <tr
                          key={score.id}
                          className={`transition-colors hover:bg-emerald-50/30 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}
                          data-testid={`row-subject-${i}`}
                        >
                          <td className="px-4 py-3.5 font-medium text-gray-800">{score.subject}</td>
                          <td className="px-3 py-3.5 text-center text-gray-600">{score.totalMarks}</td>
                          <td className="px-3 py-3.5 text-center text-gray-500">{score.passMarks}</td>
                          <td className="px-3 py-3.5 text-center">
                            {score.isAbsent ? (
                              <span className="text-gray-400 italic text-xs">Absent</span>
                            ) : (
                              <span className={`font-bold ${passed ? "text-gray-900" : "text-red-600"}`}>{score.marks}</span>
                            )}
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            {score.isAbsent ? <span className="text-gray-400">—</span> : <GradeChip grade={grade} />}
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            {score.isAbsent ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400">Absent</span>
                            ) : passed ? (
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Summary Card ── */}
            {summary && (
              <div className="bg-gradient-to-br from-[#10b981] to-[#059669] rounded-2xl shadow-sm p-5 mt-5" data-testid="card-summary">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="w-5 h-5 text-emerald-100" />
                  <h3 className="text-sm font-bold text-white">Result Summary</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white/15 rounded-xl p-3 text-center">
                    <p className="text-xs text-emerald-100 font-medium">Grand Total</p>
                    <p className="text-xl font-extrabold text-white mt-1" data-testid="text-grand-total">
                      {summary.totalObtained}/{summary.totalMax}
                    </p>
                  </div>
                  <div className="bg-white/15 rounded-xl p-3 text-center">
                    <p className="text-xs text-emerald-100 font-medium">Percentage</p>
                    <p className="text-xl font-extrabold text-white mt-1" data-testid="text-percentage">
                      {summary.percentage}%
                    </p>
                  </div>
                  <div className="bg-white/15 rounded-xl p-3 text-center">
                    <p className="text-xs text-emerald-100 font-medium">Overall Grade</p>
                    <p className="text-xl font-extrabold text-white mt-1" data-testid="text-overall-grade">
                      {summary.grade}
                    </p>
                  </div>
                  <div className="bg-white/15 rounded-xl p-3 text-center">
                    <p className="text-xs text-emerald-100 font-medium">Class Rank</p>
                    <p className="text-xl font-extrabold text-white mt-1" data-testid="text-class-rank">
                      {summary.rank ? `${summary.rank.rank} / ${summary.rank.total}` : "—"}
                    </p>
                  </div>
                </div>

                {/* Print footer */}
                <div className="hidden print:block mt-6 pt-4 border-t border-white/20 text-center">
                  <p className="text-xs text-emerald-100">This is a computer-generated marksheet. Issued by {student.schoolName}.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Academic Journey Section ── */}
        <AcademicJourneySection student={student} currentClass={currentClass} classes={classes} />

      </motion.main>
    </div>
  );
}

interface JourneyPoint {
  cls: string;
  examType: string;
  percentage: number;
}

function AcademicJourneySection({
  currentClass: _currentClass,
  classes: _classes,
}: {
  student: StudentMeResponse;
  currentClass: string;
  classes: string[];
}) {
  const { data: journeyData, isLoading } = useQuery<{ journey: JourneyPoint[] }>({
    queryKey: ["/api/student/exam/journey"],
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl p-6 bg-white/80 border border-white/70 shadow-sm flex justify-center no-print">
        <Loader2 className="w-6 h-6 animate-spin text-[#10b981]" />
      </div>
    );
  }

  const journey = journeyData?.journey ?? [];
  if (journey.length === 0) return null;

  const chartData = journey.map(j => ({ cls: j.cls, pct: j.percentage }));
  const uniqueExamTypes = Array.from(new Set(journey.map(j => j.examType)));
  const subtitle = uniqueExamTypes.length === 1
    ? `${uniqueExamTypes[0]} percentage across classes`
    : "Final exam percentage across classes";

  return (
    <div className="rounded-2xl p-5 bg-white/80 border border-white/70 shadow-sm no-print" data-testid="section-academic-journey">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50">
          <TrendingUp className="w-4 h-4 text-[#10b981]" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-800">Academic Journey</h3>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
      </div>
      <AcademicJourneyChart classData={chartData} />
    </div>
  );
}
