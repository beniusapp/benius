import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft, GraduationCap, Loader2, Download, Printer,
  BarChart3, CreditCard, BookOpen, Archive, FileCheck,
  TrendingUp, AlertCircle, ChevronDown,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

interface AcademicSession {
  id: number;
  sessionName: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
}

interface StudentMe {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  schoolName: string;
  schoolId: number;
}

interface ExamScoreRow {
  id: number;
  subject: string;
  marks: number;
  totalMarks: number;
  isAbsent: boolean;
  examType: string;
  class: string;
}

interface ExamSummary {
  totalObtained: number;
  totalMax: number;
  percentage: number;
  grade: string;
  rank: { rank: number; total: number } | null;
}

interface FeeRecord {
  id: number;
  feeType: string;
  amount: number;
  status: string;
  dueDate: string;
  paidDate: string | null;
  academicYear: string | null;
}

interface AttendanceStats {
  totalDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  startDate: string;
}

function sessionToShort(name: string) {
  const p = name.split("-");
  return p.length >= 2 ? `${p[0]}-${p[1].slice(-2)}` : name;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function gradeColor(g: string) {
  const map: Record<string, string> = {
    "A+": "#10b981", A: "#3b82f6", "B+": "#8b5cf6", B: "#7c3aed", C: "#f59e0b", D: "#fb923c",
  };
  return map[g] || "#ef4444";
}

const TABS = [
  { id: "report-cards", label: "Report Cards",     shortLabel: "Reports",    Icon: BookOpen,  color: "#7c3aed" },
  { id: "fee-ledger",   label: "Fee Ledger",        shortLabel: "Fees",       Icon: CreditCard, color: "#0891b2" },
  { id: "attendance",   label: "Attendance Summary", shortLabel: "Attendance", Icon: BarChart3, color: "#10b981" },
] as const;

type TabId = typeof TABS[number]["id"];

export default function StudentArchivesPage() {
  const [, setLocation] = useLocation();
  const [selectedSession, setSelectedSession] = useState<AcademicSession | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("report-cards");
  const [selectedExamType, setSelectedExamType] = useState("");

  useEffect(() => { setSelectedExamType(""); }, [selectedSession?.id]);

  const { data: student } = useQuery<StudentMe>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery<AcademicSession[]>({
    queryKey: ["/api/student/academic-sessions"],
  });

  const pastSessions = useMemo(
    () => (sessions || []).filter(s => !s.isActive).sort((a, b) => b.sessionName.localeCompare(a.sessionName)),
    [sessions],
  );

  const archiveFetch = useCallback(async (url: string) => {
    const r = await fetch(url, {
      credentials: "include",
      headers: selectedSession ? { "x-view-session-id": String(selectedSession.id) } : {},
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, [selectedSession?.id]);

  const { data: journeyData, isLoading: journeyLoading } = useQuery<{ journey: { cls: string; examType: string; percentage: number }[] }>({
    queryKey: ["/api/student/archive/journey", selectedSession?.id],
    queryFn: () => archiveFetch("/api/student/exam/journey"),
    enabled: !!selectedSession && activeTab === "report-cards",
  });

  const { data: examTypesData } = useQuery<{ examTypes: string[] }>({
    queryKey: ["/api/student/archive/exam-types", selectedSession?.id],
    queryFn: () => archiveFetch("/api/student/exam/types"),
    enabled: !!selectedSession && activeTab === "report-cards",
  });
  const examTypes = examTypesData?.examTypes || [];

  const { data: scoresData, isLoading: scoresLoading } = useQuery<{ scores: ExamScoreRow[]; summary: ExamSummary }>({
    queryKey: ["/api/student/archive/scores", selectedSession?.id, selectedExamType],
    queryFn: () => archiveFetch(`/api/student/exam/scores?examType=${encodeURIComponent(selectedExamType)}`),
    enabled: !!selectedSession && !!selectedExamType && activeTab === "report-cards",
  });

  const { data: feeRecords, isLoading: feesLoading } = useQuery<FeeRecord[]>({
    queryKey: ["/api/student/archive/fees", selectedSession?.id],
    queryFn: () => archiveFetch("/api/student/fees"),
    enabled: !!selectedSession && activeTab === "fee-ledger",
  });

  const sessionYear = selectedSession?.sessionName.split("-")[0];
  const shortYear = selectedSession ? sessionToShort(selectedSession.sessionName) : "";

  const filteredFees = useMemo(() => {
    if (!feeRecords) return [];
    const matched = feeRecords.filter(f =>
      !f.academicYear ||
      f.academicYear.startsWith(sessionYear ?? "__x__") ||
      f.academicYear === shortYear ||
      f.academicYear === selectedSession?.sessionName,
    );
    return matched.length > 0 ? matched : feeRecords;
  }, [feeRecords, sessionYear, shortYear, selectedSession?.sessionName]);

  const { data: attendStats, isLoading: attendLoading } = useQuery<AttendanceStats>({
    queryKey: ["/api/student/archive/attendance", selectedSession?.id],
    queryFn: () => archiveFetch(`/api/student/attendance/stats?academicYear=${shortYear}`),
    enabled: !!selectedSession && !!shortYear && activeTab === "attendance",
  });

  const handlePrint = () => {
    if (!scoresData || !student || !selectedSession) return;
    const { scores, summary } = scoresData;
    const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rows = scores.map(sc =>
      `<tr><td>${esc(sc.subject)}</td><td style="text-align:center">${sc.isAbsent ? "ABS" : sc.marks}</td><td style="text-align:center">${sc.totalMarks}</td><td style="text-align:center">${sc.isAbsent ? "—" : ((sc.marks / sc.totalMarks) * 100).toFixed(1) + "%"}</td></tr>`,
    ).join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Transcript - ${esc(student.name)}</title><style>
body{font-family:Arial,sans-serif;padding:32px;color:#1e293b;background:#fff}
.box{max-width:600px;margin:auto;border:2px solid #7c3aed;border-radius:12px;padding:32px}
.hd{text-align:center;border-bottom:2px solid #e2e8f0;padding-bottom:16px;margin-bottom:20px}
h1{margin:0;font-size:20px;color:#7c3aed}h2{margin:4px 0 0;font-size:13px;color:#64748b}
table{width:100%;border-collapse:collapse;margin:16px 0}
th{background:#f5f3ff;padding:9px 8px;font-size:12px;text-align:left;border-bottom:2px solid #ddd8f5}
td{padding:8px 8px;font-size:12px;border-bottom:1px solid #f1f5f9}
.sum{margin-top:16px;background:#f8fafc;border-radius:8px;padding:14px}
.sr{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #e2e8f0;font-size:13px}
.grd{font-size:28px;font-weight:900;color:#7c3aed}
@media print{button{display:none}}
</style></head><body><div class="box">
<div class="hd"><h1>${esc(student.schoolName)}</h1><h2>Academic Transcript · ${esc(selectedSession.sessionName)} · ${esc(selectedExamType)}</h2></div>
<p style="margin:0 0 4px"><strong>${esc(student.name)}</strong></p>
<p style="margin:0;font-size:12px;color:#64748b">ID: ${esc(student.digitalStudentId)} &nbsp;|&nbsp; Class: ${esc(student.class)}-${esc(student.section)}</p>
<table><thead><tr><th>Subject</th><th style="text-align:center">Marks</th><th style="text-align:center">Max</th><th style="text-align:center">%</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="sum">
<div class="sr"><span>Total Marks</span><span><b>${summary.totalObtained} / ${summary.totalMax}</b></span></div>
<div class="sr"><span>Percentage</span><span><b>${summary.percentage}%</b></span></div>
<div class="sr"><span>Grade</span><span class="grd">${summary.grade}</span></div>
${summary.rank ? `<div class="sr"><span>Class Rank</span><span><b>${summary.rank.rank} / ${summary.rank.total}</b></span></div>` : ""}
</div>
<p style="margin-top:20px;font-size:10px;color:#94a3b8;text-align:center">Generated by BENIUS · Read-Only Archived Record</p>
<div style="text-align:center;margin-top:14px"><button onclick="window.print()" style="padding:8px 22px;background:#7c3aed;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px">🖨 Print / Save as PDF</button></div>
</div></body></html>`);
    w.document.close();
  };

  const attendPct = attendStats && attendStats.totalDays > 0
    ? Math.round((attendStats.presentDays / attendStats.totalDays) * 100)
    : null;

  return (
    <div className="min-h-screen" style={{ background: "#f8fafc" }}>
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-80px", right: "-60px", width: "420px", height: "420px", borderRadius: "50%", background: "radial-gradient(circle, rgba(124,58,237,0.09) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-80px", left: "-50px", width: "380px", height: "380px", borderRadius: "50%", background: "radial-gradient(circle, rgba(8,145,178,0.06) 0%, transparent 65%)" }} />
      </div>

      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{ backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", background: "rgba(255,255,255,0.82)", borderBottom: "1px solid rgba(255,255,255,0.7)", boxShadow: "0 1px 28px rgba(0,0,0,0.07)" }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-xl"
              style={{ background: "linear-gradient(135deg, #7c3aed, #6366f1)" }}
            >
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="font-bold text-base text-slate-800 tracking-tight">BENIUS</p>
              <p className="text-[11px] text-slate-400 font-medium">My Archives</p>
            </div>
          </div>
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all text-slate-600 hover:text-slate-800 hover:bg-slate-100"
            style={{ border: "1px solid rgba(0,0,0,0.07)" }}
            data-testid="button-back-dashboard"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto w-full px-4 sm:px-6 pt-24 pb-12 space-y-5">

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-[24px] px-6 py-7 sm:px-8 flex items-center gap-5 sm:gap-7"
          style={{ background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 50%, #ddd6fe 100%)", border: "1.5px solid #c4b5fd", boxShadow: "0 8px 40px rgba(124,58,237,0.13)" }}
          data-testid="card-archives-hero"
        >
          <div
            className="flex items-center justify-center rounded-2xl flex-shrink-0"
            style={{ width: 72, height: 72, background: "rgba(124,58,237,0.12)", border: "2px solid rgba(124,58,237,0.25)", fontSize: 36, boxShadow: "0 4px 18px rgba(124,58,237,0.2)" }}
            role="img" aria-label="archive vault"
          >🗄️</div>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-violet-900 mb-1">My Archives</h1>
            <p className="text-sm text-violet-600 font-medium leading-snug max-w-sm">
              Historical records are read-only and immutable. Select a past academic year to explore your archived transcript, fees, and attendance.
            </p>
          </div>
        </motion.div>

        {/* Session picker */}
        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-2xl p-5 sm:p-6"
          style={{ background: "rgba(255,255,255,0.88)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.75)", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}
        >
          <label className="block text-sm font-bold text-slate-700 mb-2.5" htmlFor="session-picker">
            📅 Select Academic Year
          </label>
          {sessionsLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading sessions…
            </div>
          ) : pastSessions.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">No archived academic years found for your school.</p>
          ) : (
            <div className="relative">
              <select
                id="session-picker"
                className="w-full appearance-none px-4 py-3 pr-10 rounded-xl text-sm font-semibold text-slate-700 border-2 transition-all focus:outline-none focus:ring-2 focus:ring-violet-400"
                style={{ background: "rgba(245,243,255,0.9)", borderColor: selectedSession ? "#7c3aed" : "#e2e8f0", cursor: "pointer" }}
                value={selectedSession?.id ?? ""}
                onChange={e => {
                  const id = parseInt(e.target.value);
                  setSelectedSession(pastSessions.find(s => s.id === id) ?? null);
                  setActiveTab("report-cards");
                }}
                data-testid="select-archive-session"
                aria-label="Select academic year"
              >
                <option value="">— Choose an academic year —</option>
                {pastSessions.map(s => (
                  <option key={s.id} value={s.id}>{s.sessionName}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1">
            <span>🔒</span> Sessions are immutable historical records · No changes permitted
          </p>
        </motion.div>

        {/* Empty state */}
        {!selectedSession && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="rounded-2xl p-12 flex flex-col items-center text-center"
            style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(12px)", border: "1.5px dashed #c4b5fd" }}
          >
            <div className="text-6xl mb-4 select-none" role="img" aria-label="archive box">📦</div>
            <h3 className="text-base font-bold text-slate-600 mb-1.5">No Academic Year Selected</h3>
            <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
              Pick an archived academic year from the dropdown above to view historical transcripts, fee records, and attendance reports.
            </p>
          </motion.div>
        )}

        {/* Archive content */}
        {selectedSession && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-4"
          >
            {/* Session banner */}
            <div
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl flex-wrap"
              style={{ background: "linear-gradient(90deg, #f5f3ff, #ede9fe)", border: "1px solid #c4b5fd" }}
              data-testid="banner-archive-session"
            >
              <Archive className="w-4 h-4 text-violet-600 flex-shrink-0" />
              <span className="text-sm font-semibold text-violet-800">Viewing:</span>
              <span className="text-sm font-bold text-violet-900">{selectedSession.sessionName}</span>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                style={{ background: "rgba(124,58,237,0.1)", color: "#7c3aed", border: "1px solid #c4b5fd" }}
              >Archived</span>
              <span className="ml-auto text-[11px] text-violet-500 font-semibold">🔒 Read-Only</span>
            </div>

            {/* Tab navigation */}
            <div
              className="flex gap-1.5 p-1 rounded-2xl"
              style={{ background: "rgba(255,255,255,0.88)", border: "1px solid rgba(255,255,255,0.75)", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}
              role="tablist"
            >
              {TABS.map(tab => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all"
                    style={active
                      ? { background: tab.color, color: "white", boxShadow: `0 4px 14px ${tab.color}45` }
                      : { color: "#64748b" }}
                    data-testid={`tab-${tab.id}`}
                    aria-selected={active}
                    role="tab"
                  >
                    <tab.Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            {/* ── Report Cards Tab ── */}
            {activeTab === "report-cards" && (
              <div className="space-y-4" role="tabpanel" aria-label="Report Cards">

                {/* Journey overview */}
                <div
                  className="rounded-2xl p-5 sm:p-6"
                  style={{ background: "rgba(255,255,255,0.88)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.75)", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-700">Academic Performance Overview</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Final exam results across all classes</p>
                    </div>
                    <TrendingUp className="w-5 h-5 text-violet-400" />
                  </div>

                  {journeyLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
                    </div>
                  ) : journeyData?.journey && journeyData.journey.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full" role="table" data-testid="table-journey">
                        <thead>
                          <tr>
                            {["Class", "Exam", "Score", "Grade"].map(h => (
                              <th key={h} className="text-left text-xs font-bold text-slate-500 pb-2.5 pr-4" style={{ borderBottom: "2px solid #f1f5f9" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {journeyData.journey.map((j, i) => {
                            const pct = j.percentage;
                            const g = pct >= 90 ? "A+" : pct >= 80 ? "A" : pct >= 70 ? "B+" : pct >= 60 ? "B" : pct >= 50 ? "C" : pct >= 40 ? "D" : "F";
                            return (
                              <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                                <td className="py-3 pr-4 text-sm font-bold text-slate-700">{j.cls}</td>
                                <td className="py-3 pr-4 text-sm text-slate-500">{j.examType}</td>
                                <td className="py-3 pr-4">
                                  <div className="flex items-center gap-2">
                                    <div className="h-1.5 w-20 rounded-full" style={{ background: "#f1f5f9" }}>
                                      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: gradeColor(g) }} />
                                    </div>
                                    <span className="text-xs font-bold text-slate-600">{pct}%</span>
                                  </div>
                                </td>
                                <td className="py-3">
                                  <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: `${gradeColor(g)}18`, color: gradeColor(g) }}>{g}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <FileCheck className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">No exam records found for this academic year.</p>
                    </div>
                  )}
                </div>

                {/* Detailed score picker */}
                {examTypes.length > 0 && (
                  <div
                    className="rounded-2xl p-5 sm:p-6 space-y-4"
                    style={{ background: "rgba(255,255,255,0.88)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.75)", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="text-sm font-bold text-slate-700">Detailed Score Report</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Subject-wise marks for a selected exam</p>
                      </div>
                      {scoresData && (
                        <button
                          onClick={handlePrint}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                          style={{ background: "#7c3aed", color: "white", boxShadow: "0 2px 10px rgba(124,58,237,0.35)" }}
                          data-testid="button-download-transcript"
                          aria-label="Download PDF Transcript"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Download PDF Transcript
                        </button>
                      )}
                    </div>

                    <div className="relative">
                      <select
                        className="w-full appearance-none px-4 py-3 pr-10 rounded-xl text-sm font-semibold text-slate-700 border-2 transition-all focus:outline-none focus:ring-2 focus:ring-violet-300"
                        style={{ background: "rgba(245,243,255,0.9)", borderColor: selectedExamType ? "#7c3aed" : "#e2e8f0", cursor: "pointer" }}
                        value={selectedExamType}
                        onChange={e => setSelectedExamType(e.target.value)}
                        data-testid="select-exam-type"
                        aria-label="Select exam type"
                      >
                        <option value="">— Select Exam Type —</option>
                        {examTypes.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>

                    {selectedExamType && (
                      scoresLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
                        </div>
                      ) : scoresData ? (
                        <>
                          {/* Summary pills */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                              { label: "Total Marks", value: `${scoresData.summary.totalObtained}/${scoresData.summary.totalMax}`, color: "#7c3aed" },
                              { label: "Percentage",  value: `${scoresData.summary.percentage}%`,                                  color: "#3b82f6" },
                              { label: "Grade",       value: scoresData.summary.grade,                                             color: gradeColor(scoresData.summary.grade) },
                              { label: "Class Rank",  value: scoresData.summary.rank ? `${scoresData.summary.rank.rank}/${scoresData.summary.rank.total}` : "—", color: "#10b981" },
                            ].map(stat => (
                              <div key={stat.label} className="rounded-xl p-3 text-center" style={{ background: `${stat.color}0d`, border: `1.5px solid ${stat.color}28` }}>
                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-0.5">{stat.label}</p>
                                <p className="text-lg font-extrabold" style={{ color: stat.color }}>{stat.value}</p>
                              </div>
                            ))}
                          </div>

                          {/* Scores table */}
                          <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #f1f5f9" }}>
                            <table className="w-full text-sm" role="table" data-testid="table-exam-scores">
                              <thead>
                                <tr style={{ background: "#f8fafc" }}>
                                  {["Subject", "Marks", "Max", "%", "Status"].map(h => (
                                    <th key={h} className="px-3 sm:px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide text-left first:text-left">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {scoresData.scores.map((sc, i) => {
                                  const pct = sc.isAbsent ? 0 : Math.round((sc.marks / sc.totalMarks) * 100);
                                  const sg = pct >= 90 ? "A+" : pct >= 80 ? "A" : pct >= 70 ? "B+" : pct >= 60 ? "B" : pct >= 50 ? "C" : pct >= 40 ? "D" : "F";
                                  return (
                                    <tr key={sc.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f1f5f9" }} data-testid={`row-score-${sc.id}`}>
                                      <td className="px-3 sm:px-4 py-3 font-semibold text-slate-700">{sc.subject}</td>
                                      <td className="px-3 sm:px-4 py-3 font-bold text-slate-700 text-center">{sc.isAbsent ? "ABS" : sc.marks}</td>
                                      <td className="px-3 sm:px-4 py-3 text-slate-500 text-center">{sc.totalMarks}</td>
                                      <td className="px-3 sm:px-4 py-3 text-center">
                                        {sc.isAbsent ? <span className="text-slate-300">—</span> : <span className="font-semibold" style={{ color: gradeColor(sg) }}>{pct}%</span>}
                                      </td>
                                      <td className="px-3 sm:px-4 py-3 text-center">
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                                          style={sc.isAbsent
                                            ? { background: "#fef2f2", color: "#ef4444" }
                                            : { background: `${gradeColor(sg)}18`, color: gradeColor(sg) }}>
                                          {sc.isAbsent ? "Absent" : sg}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Fee Ledger Tab ── */}
            {activeTab === "fee-ledger" && (
              <div
                className="rounded-2xl p-5 sm:p-6 space-y-4"
                style={{ background: "rgba(255,255,255,0.88)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.75)", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}
                role="tabpanel" aria-label="Fee Ledger"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-700">Fee Ledger</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Immutable payment history · {selectedSession.sessionName}</p>
                  </div>
                  <CreditCard className="w-5 h-5 text-cyan-400" />
                </div>

                {feesLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                  </div>
                ) : filteredFees.length === 0 ? (
                  <div className="text-center py-10">
                    <CreditCard className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">No fee records found for this academic year.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #f1f5f9" }}>
                    <table className="w-full text-sm" data-testid="table-fee-ledger">
                      <thead>
                        <tr style={{ background: "#f0f9ff" }}>
                          {["Fee Type", "Amount", "Due Date", "Paid On", "Status", "Receipt"].map(h => (
                            <th key={h} className="text-left px-3 sm:px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFees.map((fee, i) => (
                          <tr
                            key={fee.id}
                            style={{ background: i % 2 === 0 ? "#fff" : "#fafbff", borderBottom: "1px solid #f1f5f9" }}
                            data-testid={`row-fee-${fee.id}`}
                          >
                            <td className="px-3 sm:px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">{fee.feeType}</td>
                            <td className="px-3 sm:px-4 py-3 font-bold text-slate-800 whitespace-nowrap">{fmtCurrency(fee.amount)}</td>
                            <td className="px-3 sm:px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(fee.dueDate)}</td>
                            <td className="px-3 sm:px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(fee.paidDate)}</td>
                            <td className="px-3 sm:px-4 py-3">
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                                style={fee.status === "Paid"
                                  ? { background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }
                                  : fee.status === "Overdue"
                                  ? { background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca" }
                                  : { background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a" }}
                              >
                                {fee.status}
                              </span>
                            </td>
                            <td className="px-3 sm:px-4 py-3">
                              {fee.status === "Paid" ? (
                                <a
                                  href={`/api/student/fees/${fee.id}/receipt`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-xs font-semibold text-cyan-600 hover:text-cyan-800 transition-colors whitespace-nowrap"
                                  data-testid={`link-receipt-${fee.id}`}
                                  aria-label={`View receipt for ${fee.feeType}`}
                                >
                                  <Download className="w-3 h-3" /> Receipt
                                </a>
                              ) : (
                                <span className="text-xs text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <span>🔒</span> Payment actions and new fee entries are disabled in archive mode.
                </p>
              </div>
            )}

            {/* ── Attendance Summary Tab ── */}
            {activeTab === "attendance" && (
              <div className="space-y-4" role="tabpanel" aria-label="Attendance Summary">
                {attendLoading ? (
                  <div className="rounded-2xl p-10 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.88)", border: "1px solid rgba(255,255,255,0.75)" }}>
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  </div>
                ) : attendStats ? (
                  <>
                    <div
                      className="rounded-2xl p-5 sm:p-6"
                      style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)", border: "1.5px solid #bbf7d0", boxShadow: "0 4px 24px rgba(16,185,129,0.11)" }}
                    >
                      <div className="flex items-center justify-between mb-5">
                        <div>
                          <h3 className="text-sm font-bold text-emerald-800">Year-End Attendance Summary</h3>
                          <p className="text-xs text-emerald-600 mt-0.5">{selectedSession.sessionName} · Read-only archived report</p>
                        </div>
                        <BarChart3 className="w-5 h-5 text-emerald-500" />
                      </div>

                      <div className="flex flex-col sm:flex-row items-center gap-6">
                        {/* Circular % display */}
                        <div
                          className="flex flex-col items-center justify-center w-32 h-32 rounded-full flex-shrink-0"
                          style={{ background: "rgba(255,255,255,0.65)", border: "5px solid #10b981", boxShadow: "0 4px 24px rgba(16,185,129,0.22)" }}
                          data-testid="stat-attendance-percent"
                        >
                          <span className="text-3xl font-extrabold text-emerald-700">
                            {attendPct !== null ? `${attendPct}%` : "—"}
                          </span>
                          <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wide">Present</span>
                        </div>

                        {/* 4-cell stats grid */}
                        <div className="grid grid-cols-2 gap-3 flex-1 w-full">
                          {[
                            { label: "Total Days",   value: attendStats.totalDays,              color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
                            { label: "Days Present", value: attendStats.presentDays,             color: "#10b981", bg: "#f0fdf4", border: "#bbf7d0" },
                            { label: "Days Absent",  value: attendStats.absentDays,              color: "#ef4444", bg: "#fef2f2", border: "#fecaca" },
                            { label: "Leave Days",   value: attendStats.leaveDays ?? 0,          color: "#f59e0b", bg: "#fffbeb", border: "#fde68a" },
                          ].map(stat => (
                            <div
                              key={stat.label}
                              className="rounded-xl p-3 text-center"
                              style={{ background: stat.bg, border: `1.5px solid ${stat.border}` }}
                              data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: stat.color }}>{stat.label}</p>
                              <p className="text-2xl font-extrabold" style={{ color: stat.color }}>{stat.value}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Progress bar */}
                      {attendStats.totalDays > 0 && (
                        <div className="mt-6">
                          <div className="flex justify-between text-xs text-emerald-700 font-semibold mb-1.5">
                            <span>Attendance Rate</span>
                            <span>{attendPct}%</span>
                          </div>
                          <div className="h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.6)" }}>
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${attendPct ?? 0}%`, background: "linear-gradient(90deg, #10b981, #059669)" }}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-semibold">
                            <span style={{ color: "#10b981" }}>● Present: {attendStats.presentDays}d</span>
                            <span style={{ color: "#ef4444" }}>● Absent: {attendStats.absentDays}d</span>
                            {(attendStats.leaveDays ?? 0) > 0 && <span style={{ color: "#f59e0b" }}>● Leave: {attendStats.leaveDays}d</span>}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl px-4 py-3 flex items-start gap-2.5" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
                      <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700">
                        This is a read-only archived attendance record for <strong>{selectedSession.sessionName}</strong>. Records are final and cannot be modified.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl p-10 text-center" style={{ background: "rgba(255,255,255,0.88)", border: "1px solid rgba(255,255,255,0.75)" }}>
                    <BarChart3 className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">No attendance data found for this academic year.</p>
                    <p className="text-xs text-slate-400 mt-1">Attendance records may not have been captured for this session.</p>
                  </div>
                )}
              </div>
            )}

          </motion.div>
        )}

        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
          className="text-center text-[11px] text-slate-400 pb-2"
        >
          © {new Date().getFullYear()} BENIUS · Secure Archive Portal
        </motion.p>
      </main>
    </div>
  );
}
