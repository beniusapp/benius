import { useState, useMemo, useCallback, memo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp, Loader2, Download, Search, X, Users,
  CheckCircle, XCircle, AlertCircle, BarChart2, BookOpen,
  RotateCcw, RefreshCw, Clock, Info,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  schoolId: number;
  classes: string[];
  sections: string[];
  subjects: string[];
  examTypes: string[];
  classSections: Record<string, string[]>;
  classSubjects: Record<string, string[]>;
  classExamTypes: Record<string, string[]>;
}

interface RawStudentScore {
  studentId: number;
  name: string;
  digitalStudentId: string;
  rollNumber: number | null;
  scores: Array<{ subject: string; examType: string; marks: number; totalMarks: number; isAbsent: boolean }>;
}

interface ExamPolicyTier {
  id: number;
  schoolId: number;
  tierName: string;
  applicableClasses: string[];
  examWeights: string;
  promotionFailRules: string;
  resultsConfig: string;
}

interface GradingRuleClient {
  id: number;
  tierId: number;
  gradeLabel: string;
  minPercent: number;
  maxPercent: number;
  remarks: string | null;
  sortOrder: number;
}

interface ComputedStudent {
  studentId: number;
  dsid: string;
  name: string;
  subjectWeightedPct: Record<string, number | null>;
  termAvg: number | null;
  gradeLabel: string;
  gradeColor: string;
  gradeRemarks: string | null;
  passPercentage: number;
  decision: "promoted" | "retained" | null;
}

type JourneyData = {
  examTypes: string[];
  subjectRows: { subject: string; scores: (number | null)[] }[];
  totals: number[];
};

type SliceFilter = "promoted" | "retained" | "pending" | null;

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

function computeGrade(pct: number, rules: GradingRuleClient[]): { label: string; color: string; remarks: string | null } {
  if (rules.length > 0) {
    const sorted = [...rules].sort((a, b) => b.minPercent - a.minPercent);
    for (const r of sorted) {
      if (pct >= r.minPercent) return { label: r.gradeLabel, color: gradeColor(r.gradeLabel), remarks: r.remarks };
    }
    const last = sorted[sorted.length - 1];
    return { label: last.gradeLabel, color: gradeColor(last.gradeLabel), remarks: last.remarks };
  }
  if (pct >= 90) return { label: "A+", color: "text-emerald-400", remarks: "Outstanding" };
  if (pct >= 80) return { label: "A",  color: "text-green-400",   remarks: "Excellent" };
  if (pct >= 70) return { label: "B+", color: "text-teal-400",    remarks: "Very Good" };
  if (pct >= 60) return { label: "B",  color: "text-blue-400",    remarks: "Good" };
  if (pct >= 50) return { label: "C+", color: "text-yellow-400",  remarks: "Average" };
  if (pct >= 40) return { label: "C",  color: "text-amber-400",   remarks: "Below Average" };
  if (pct >= 33) return { label: "D",  color: "text-orange-400",  remarks: "Poor" };
  return { label: "F", color: "text-red-400", remarks: "Fail" };
}

function computeWeightedForTerm(
  students: RawStudentScore[],
  policy: ExamPolicyTier,
  term: string,
  gradingPassPct: number,
  gradingRules: GradingRuleClient[],
  promotionMap: Record<number, string>,
): ComputedStudent[] {
  let rawWeights: Record<string, { source_exam: string; weight: number }[]> = {};
  try { rawWeights = JSON.parse(policy.examWeights || "{}"); } catch {}

  const termKey = Object.keys(rawWeights).find(k => k.trim() === term.trim());
  const components = termKey ? rawWeights[termKey] : [];

  return students.map(student => {
    const bySubject: Record<string, typeof student.scores> = {};
    for (const sc of student.scores) {
      if (!bySubject[sc.subject]) bySubject[sc.subject] = [];
      bySubject[sc.subject].push(sc);
    }

    const allSubjects = Object.keys(bySubject);
    const subjectWeightedPct: Record<string, number | null> = {};

    for (const subject of allSubjects) {
      const subjectScores = bySubject[subject];
      let weightedSum = 0, totalWeight = 0;
      let hasAbsent = false, hasData = false;

      for (const comp of components) {
        const record = subjectScores.find(s => s.examType === comp.source_exam);
        if (!record) continue;
        hasData = true;
        if (record.isAbsent) { hasAbsent = true; continue; }
        const pct = record.totalMarks > 0 ? (record.marks / record.totalMarks) * 100 : 0;
        weightedSum += pct * (comp.weight / 100);
        totalWeight += comp.weight;
      }

      if (!hasData) { subjectWeightedPct[subject] = null; continue; }
      if (hasAbsent) { subjectWeightedPct[subject] = 0; continue; }
      subjectWeightedPct[subject] = totalWeight > 0
        ? Math.round((weightedSum * 100 / totalWeight) * 10) / 10
        : 0;
    }

    const scoredPcts = Object.values(subjectWeightedPct).filter(p => p !== null) as number[];
    const termAvg = scoredPcts.length > 0
      ? Math.round((scoredPcts.reduce((a, b) => a + b, 0) / scoredPcts.length) * 10) / 10
      : null;

    const grade = computeGrade(termAvg ?? 0, gradingRules);
    const rawDecision = promotionMap[student.studentId] ?? null;
    const decision: "promoted" | "retained" | null =
      rawDecision === "promoted" ? "promoted" :
      rawDecision === "retained" ? "retained" : null;

    return {
      studentId: student.studentId,
      dsid: student.digitalStudentId,
      name: student.name,
      subjectWeightedPct,
      termAvg,
      gradeLabel: grade.label,
      gradeColor: grade.color,
      gradeRemarks: grade.remarks,
      passPercentage: gradingPassPct,
      decision,
    };
  });
}

function polarToCartesian(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  if (end - start >= 360) end = start + 359.99;
  const s = polarToCartesian(cx, cy, r, start);
  const e = polarToCartesian(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
}

function PieChart({ promoted, retained, pending, active, onClick }: {
  promoted: number; retained: number; pending: number; active: SliceFilter; onClick: (s: SliceFilter) => void;
}) {
  const total = promoted + retained + pending;
  if (total === 0) return (
    <div className="flex items-center justify-center h-40">
      <p className="text-white/30 text-sm">No data to display</p>
    </div>
  );
  const slices = [
    { key: "promoted" as SliceFilter, angle: (promoted / total) * 360, color: "#10b981", label: "Promoted", count: promoted },
    { key: "retained" as SliceFilter, angle: (retained / total) * 360, color: "#f43f5e", label: "Retained", count: retained },
    { key: "pending" as SliceFilter, angle: (pending / total) * 360, color: "#6b7280", label: "No Decision", count: pending },
  ];
  let cursor = 0;
  const paths = slices.map(s => {
    const start = cursor;
    const end = cursor + s.angle;
    cursor = end;
    return { ...s, start, end };
  });
  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 160 160" width="160" height="160" className="shrink-0">
        {paths.map(p => p.angle > 0 && (
          <path
            key={p.key}
            d={arcPath(80, 80, 70, p.start, p.end)}
            fill={p.color}
            opacity={active && active !== p.key ? 0.35 : 1}
            stroke={active === p.key ? "white" : "transparent"}
            strokeWidth={active === p.key ? 2 : 0}
            className="cursor-pointer transition-all duration-200"
            onClick={() => onClick(active === p.key ? null : p.key)}
            data-testid={`pie-slice-${p.key}`}
          />
        ))}
        <circle cx="80" cy="80" r="32" fill="#1A2942" />
        <text x="80" y="76" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">{total}</text>
        <text x="80" y="92" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="9">Students</text>
      </svg>
      <div className="flex flex-wrap gap-3 justify-center">
        {paths.map(p => (
          <button
            key={p.key}
            onClick={() => onClick(active === p.key ? null : p.key)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all border ${
              active === p.key ? "border-white/40 scale-105" : active && active !== p.key ? "opacity-40 border-transparent" : "border-transparent hover:border-white/20"
            }`}
            style={{ color: p.color, background: `${p.color}18` }}
            data-testid={`legend-${p.key}`}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.label}: {p.count}
          </button>
        ))}
      </div>
      {active && (
        <button onClick={() => onClick(null)} className="text-xs text-white/40 hover:text-white/60 transition-colors" data-testid="clear-slice-filter">
          Clear filter
        </button>
      )}
    </div>
  );
}

function SubjectMasteryChart({ data }: { data: { subject: string; average: number }[] }) {
  if (data.length === 0) return (
    <div className="flex items-center justify-center h-24">
      <p className="text-white/30 text-sm">No subject data</p>
    </div>
  );
  const max = Math.max(...data.map(d => d.average), 1);
  const barH = 22, gap = 8;
  const svgH = data.length * (barH + gap);
  const labelW = 90, barAreaW = 220;
  return (
    <svg viewBox={`0 0 ${labelW + barAreaW + 60} ${svgH}`} width="100%" height={svgH}>
      {data.map((d, i) => {
        const y = i * (barH + gap);
        const bw = Math.max((d.average / max) * barAreaW, 2);
        const color = d.average >= 80 ? "#10b981" : d.average >= 35 ? "#D4AF37" : "#f43f5e";
        return (
          <g key={d.subject}>
            <text x={labelW - 6} y={y + barH / 2 + 4} textAnchor="end" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="inherit">
              {d.subject.length > 11 ? d.subject.slice(0, 11) + "…" : d.subject}
            </text>
            <rect x={labelW} y={y + 2} width={bw} height={barH - 4} rx="3" fill={color} opacity="0.85" />
            <text x={labelW + bw + 6} y={y + barH / 2 + 4} fill={color} fontSize="10" fontWeight="bold" fontFamily="inherit">
              {d.average}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const JOURNEY_COLORS = ["#10b981","#D4AF37","#60a5fa","#f472b6","#a78bfa","#34d399","#fb923c"];

function JourneyChart({ data }: { data: JourneyData }) {
  const { examTypes, totals, subjectRows } = data;
  if (examTypes.length === 0) return (
    <div className="flex items-center justify-center h-32">
      <p className="text-white/30 text-sm">No exam history found</p>
    </div>
  );
  const W = 420, H = 180, padL = 36, padR = 16, padT = 12, padB = 36;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xStep = examTypes.length > 1 ? plotW / (examTypes.length - 1) : plotW / 2;
  const toX = (i: number) => padL + (examTypes.length > 1 ? i * xStep : plotW / 2);
  const toY = (v: number) => padT + plotH - (v / 100) * plotH;
  const pts = (scores: (number | null)[]) =>
    scores.map((v, i) => v !== null ? `${toX(i)},${toY(v)}` : null).filter(Boolean).join(" ");
  const yTicks = [0, 25, 50, 75, 100];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="overflow-visible">
        {yTicks.map(v => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={toY(v)} y2={toY(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={padL - 6} y={toY(v) + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="inherit">{v}</text>
          </g>
        ))}
        <polyline points={totals.map((v, i) => `${toX(i)},${toY(v)}`).join(" ")}
          fill="none" stroke="white" strokeWidth="2.5" strokeDasharray="5 3" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        {subjectRows.map((row, ri) => (
          <polyline key={row.subject} points={pts(row.scores)}
            fill="none" stroke={JOURNEY_COLORS[ri % JOURNEY_COLORS.length]} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {examTypes.map((et, i) => (
          <text key={et} x={toX(i)} y={H - 6} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="8" fontFamily="inherit">
            {et.length > 8 ? et.slice(0, 8) + "…" : et}
          </text>
        ))}
        {totals.map((v, i) => (
          <circle key={i} cx={toX(i)} cy={toY(v)} r="3" fill="white" opacity="0.7" />
        ))}
      </svg>
      <div className="flex flex-wrap gap-2 mt-2">
        <span className="flex items-center gap-1 text-xs text-white/40">
          <svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="white" strokeWidth="2" strokeDasharray="4 2" /></svg>
          Overall %
        </span>
        {subjectRows.map((row, ri) => (
          <span key={row.subject} className="flex items-center gap-1 text-xs" style={{ color: JOURNEY_COLORS[ri % JOURNEY_COLORS.length] }}>
            <svg width="12" height="4"><line x1="0" y1="2" x2="12" y2="2" stroke={JOURNEY_COLORS[ri % JOURNEY_COLORS.length]} strokeWidth="2" /></svg>
            {row.subject}
          </span>
        ))}
      </div>
    </div>
  );
}

function fmtAge(d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function pctColor(pct: number | null, threshold: number) {
  if (pct === null) return "text-white/20";
  if (pct >= 80) return "text-emerald-400";
  if (pct < threshold) return "text-rose-400 font-bold";
  if (pct <= threshold + 5) return "text-amber-400";
  return "text-white";
}

type TableProps = {
  students: ComputedStudent[];
  subjectList: string[];
  sliceFilter: SliceFilter;
  passThreshold: number;
  onStudentClick: (s: ComputedStudent) => void;
};

const HeatmapTable = memo(function HeatmapTable({ students, subjectList, sliceFilter, passThreshold, onStudentClick }: TableProps) {
  const rows = useMemo(() => {
    if (!sliceFilter) return students;
    if (sliceFilter === "promoted") return students.filter(s => s.decision === "promoted");
    if (sliceFilter === "retained") return students.filter(s => s.decision === "retained");
    return students.filter(s => s.decision === null);
  }, [students, sliceFilter]);

  return (
    <div className="overflow-auto max-h-[520px] rounded-xl border border-white/10" id="analytics-table">
      <table className="w-full text-xs" style={{ minWidth: `${300 + subjectList.length * 90}px` }}>
        <thead className="sticky top-0 z-10 bg-[#1A2942]">
          <tr className="border-b border-white/10">
            <th className="text-left px-3 py-2.5 font-semibold text-white/50 sticky left-0 bg-[#1A2942] z-20 whitespace-nowrap">#</th>
            <th className="text-left px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap">DSID</th>
            <th className="text-left px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap min-w-[120px]">Name</th>
            {subjectList.map(s => (
              <th key={s} className="text-center px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap">{s}</th>
            ))}
            <th className="text-center px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap">Term Avg %</th>
            <th className="text-center px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap">Grade</th>
            <th className="text-center px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap">Decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3 + subjectList.length + 3} className="text-center py-10 text-white/30">
                No students match the current filters.
              </td>
            </tr>
          )}
          {rows.map((s, idx) => (
            <tr key={s.studentId} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`row-student-${s.studentId}`}>
              <td className="px-3 py-2.5 text-white/30 sticky left-0 bg-[#0A1628] hover:bg-[#0e1e36]">{idx + 1}</td>
              <td className="px-3 py-2.5 text-white/50 font-mono">{s.dsid}</td>
              <td className="px-3 py-2.5">
                <button
                  className="text-white hover:text-[#10b981] hover:underline transition-colors text-left font-medium"
                  onClick={() => onStudentClick(s)}
                  data-testid={`btn-student-journey-${s.studentId}`}
                >
                  {s.name}
                </button>
              </td>
              {subjectList.map(subj => {
                const pct = s.subjectWeightedPct[subj];
                if (pct === undefined) return <td key={subj} className="px-3 py-2.5 text-center text-white/20">—</td>;
                if (pct === null) return <td key={subj} className="px-3 py-2.5 text-center text-white/20 text-[10px]">No data</td>;
                return (
                  <td key={subj} className={`px-3 py-2.5 text-center font-medium ${pctColor(pct, passThreshold)}`}>
                    {pct.toFixed(1)}%
                  </td>
                );
              })}
              <td className={`px-3 py-2.5 text-center font-bold ${pctColor(s.termAvg, s.passPercentage)}`}>
                {s.termAvg !== null ? (
                  <span className="flex flex-col items-center gap-0.5">
                    <span>{s.termAvg.toFixed(1)}%</span>
                    {s.termAvg >= 90 && (
                      <span className="inline-block px-1 py-0.5 text-[9px] rounded bg-emerald-500/20 text-emerald-400 font-bold leading-none">HP</span>
                    )}
                  </span>
                ) : "—"}
              </td>
              <td className={`px-3 py-2.5 text-center font-semibold ${s.gradeColor}`}>
                {s.gradeLabel || "—"}
              </td>
              <td className="px-3 py-2.5 text-center">
                {s.decision === "promoted" && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Promoted</span>}
                {s.decision === "retained" && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">Retained</span>}
                {s.decision === null && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-white/30 border border-white/10">Pending</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default function PerformanceAnalytics({ schoolId, classes, sections: configSections, classSections }: Props) {
  const queryClient = useQueryClient();
  const [filterClass, setFilterClass] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [filterTerm, setFilterTerm] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [sliceFilter, setSliceFilter] = useState<SliceFilter>(null);
  const [selectedStudent, setSelectedStudent] = useState<ComputedStudent | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [gradingRules, setGradingRules] = useState<GradingRuleClient[]>([]);
  const [gradingPassPct, setGradingPassPct] = useState(35);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const style = document.getElementById("benius-print-css") || document.createElement("style");
    style.id = "benius-print-css";
    style.setAttribute("media", "print");
    style.innerHTML = `
      nav, aside, header, [data-print-hide], .print\\:hidden { display: none !important; }
      #analytics-root { display: block !important; padding: 0 !important; }
      body { background: white !important; color: black !important; }
      .rounded-xl { border: 1px solid #ddd !important; }
      * { color: black !important; background: white !important; border-color: #ccc !important; }
    `;
    if (!document.getElementById("benius-print-css")) document.head.appendChild(style);
    return () => { style.innerHTML = ""; };
  }, []);

  const handleClassChange = useCallback((cls: string) => {
    setFilterClass(cls);
    setFilterSection("");
    setFilterTerm("");
    setSliceFilter(null);
  }, []);

  const handleReset = useCallback(() => {
    setFilterClass(""); setFilterSection(""); setFilterTerm("");
    setSearch(""); setSearchDebounced(""); setSliceFilter(null);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/class-scores", filterClass, filterSection] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/exam-policy", filterClass] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/promotion-decisions", filterClass, filterSection, filterTerm] }),
    ]);
    setRefreshing(false);
    setLastUpdated(new Date());
  }, [queryClient, filterClass, filterSection, filterTerm]);

  const sectionList = (filterClass && classSections[filterClass]?.length > 0) ? classSections[filterClass] : configSections;

  const { data: policyTier = null, isLoading: policyLoading } = useQuery<ExamPolicyTier | null>({
    queryKey: ["/api/admin/analytics/exam-policy", filterClass],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/exam-policy/${encodeURIComponent(filterClass)}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!filterClass,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const termNames = useMemo(() => {
    if (!policyTier) return [];
    try {
      const w = JSON.parse(policyTier.examWeights || "{}");
      return Object.keys(w).map(k => k.trim());
    } catch { return []; }
  }, [policyTier]);

  useEffect(() => {
    if (termNames.length > 0 && !filterTerm) setFilterTerm(termNames[0]);
  }, [termNames, filterTerm]);

  const { data: classScores = [], isLoading: scoresLoading } = useQuery<RawStudentScore[]>({
    queryKey: ["/api/admin/analytics/class-scores", filterClass, filterSection],
    queryFn: async () => {
      const r = await fetch(
        `/api/admin/analytics/class-scores/${encodeURIComponent(filterClass)}/${encodeURIComponent(filterSection)}`,
        { credentials: "include" },
      );
      return r.ok ? r.json() : [];
    },
    enabled: !!filterClass && !!filterSection,
    staleTime: 0,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!filterClass) { setGradingRules([]); setGradingPassPct(35); return; }
    let cancelled = false;
    fetch(`/api/admin/analytics/grading-rules/${encodeURIComponent(filterClass)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { rules: [], passPercentage: 35 })
      .then(d => { if (!cancelled) { setGradingRules(d.rules ?? []); setGradingPassPct(d.passPercentage ?? 35); } })
      .catch(() => { if (!cancelled) { setGradingRules([]); setGradingPassPct(35); } });
    return () => { cancelled = true; };
  }, [filterClass]);

  const { data: promotionDecisions = [] } = useQuery<Array<{ studentId: number; decision: string }>>({
    queryKey: ["/api/admin/analytics/promotion-decisions", filterClass, filterSection, filterTerm],
    queryFn: async () => {
      const r = await fetch(
        `/api/admin/analytics/promotion-decisions/${encodeURIComponent(filterClass)}/${encodeURIComponent(filterSection)}/${encodeURIComponent(filterTerm)}`,
        { credentials: "include" },
      );
      return r.ok ? r.json() : [];
    },
    enabled: !!filterClass && !!filterSection && !!filterTerm,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });

  const promotionMap = useMemo<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    for (const d of promotionDecisions) map[d.studentId] = d.decision;
    return map;
  }, [promotionDecisions]);

  const allComputedStudents = useMemo<ComputedStudent[]>(() => {
    if (!policyTier || classScores.length === 0 || !filterTerm) return [];
    return computeWeightedForTerm(classScores, policyTier, filterTerm, gradingPassPct, gradingRules, promotionMap);
  }, [policyTier, classScores, filterTerm, gradingPassPct, gradingRules, promotionMap]);

  useEffect(() => {
    if (allComputedStudents.length > 0) setLastUpdated(new Date());
  }, [allComputedStudents]);

  const computedStudents = useMemo(() => {
    if (!searchDebounced) return allComputedStudents;
    const q = searchDebounced.toLowerCase();
    return allComputedStudents.filter(s => s.name.toLowerCase().includes(q) || s.dsid.toLowerCase().includes(q));
  }, [allComputedStudents, searchDebounced]);

  const subjectList = useMemo(() => {
    const set = new Set<string>();
    for (const s of allComputedStudents) for (const subj of Object.keys(s.subjectWeightedPct)) set.add(subj);
    return Array.from(set).sort();
  }, [allComputedStudents]);

  const subjectAverages = useMemo(() => {
    const sums: Record<string, { sum: number; cnt: number }> = {};
    for (const s of computedStudents) {
      for (const [subj, pct] of Object.entries(s.subjectWeightedPct)) {
        if (pct !== null) {
          if (!sums[subj]) sums[subj] = { sum: 0, cnt: 0 };
          sums[subj].sum += pct;
          sums[subj].cnt++;
        }
      }
    }
    return Object.entries(sums).map(([subject, { sum, cnt }]) => ({
      subject, average: parseFloat((sum / cnt).toFixed(1)),
    })).sort((a, b) => b.average - a.average);
  }, [computedStudents]);

  const kpi = useMemo(() => {
    const promoted = computedStudents.filter(s => s.decision === "promoted").length;
    const retained = computedStudents.filter(s => s.decision === "retained").length;
    const pending = computedStudents.filter(s => s.decision === null).length;
    const scored = computedStudents.filter(s => s.termAvg !== null);
    const avg = scored.length > 0
      ? (scored.reduce((acc, s) => acc + (s.termAvg ?? 0), 0) / scored.length).toFixed(1)
      : "0";
    return { total: computedStudents.length, promoted, retained, pending, avg };
  }, [computedStudents]);

  const { data: journeyData, isLoading: loadingJourney } = useQuery<JourneyData>({
    queryKey: ["/api/admin/analytics/student-journey", selectedStudent?.studentId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/student-journey/${selectedStudent!.studentId}`, { credentials: "include" });
      return r.ok ? r.json() : { examTypes: [], subjectRows: [], totals: [] };
    },
    enabled: !!selectedStudent,
  });

  const isLoading = policyLoading || scoresLoading;
  const noPolicyForClass = !!filterClass && !policyLoading && policyTier === null;
  const hasPolicyForClass = !!filterClass && !policyLoading && policyTier !== null;
  const hasData = computedStudents.length > 0;
  const isFiltered = !!(filterClass || filterSection || filterTerm || search || sliceFilter);

  return (
    <div className="space-y-5" id="analytics-root">
      <style>{`@media print { #analytics-root * { color: black !important; background: white !important; } }`}</style>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white">Academic Intelligence Dashboard</h2>
          <p className="text-white/50 text-sm">Weighted term results · Promotion decisions · Student journeys</p>
        </div>
        {hasData && (
          <Button size="sm" onClick={() => window.print()}
            className="bg-[#1A2942] border border-white/20 text-white hover:bg-white/10 gap-2"
            data-testid="btn-download-analytics">
            <Download className="w-4 h-4" /> Download Analytics
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center rounded-xl border border-white/10 bg-[#1A2942] p-3">
        <Select value={filterClass} onValueChange={handleClassChange}>
          <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white h-9" data-testid="select-analytics-class">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent>
            {(classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterSection} onValueChange={v => { setFilterSection(v); setSliceFilter(null); }} disabled={!filterClass}>
          <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white h-9 disabled:opacity-40" data-testid="select-analytics-section">
            <SelectValue placeholder="Section" />
          </SelectTrigger>
          <SelectContent>
            {sectionList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterTerm} onValueChange={v => { setFilterTerm(v); setSliceFilter(null); }} disabled={!filterSection || termNames.length === 0}>
          <SelectTrigger className="w-40 bg-[#0A1628] border-white/20 text-white h-9 disabled:opacity-40" data-testid="select-analytics-term">
            <SelectValue placeholder={!filterClass ? "Term" : termNames.length === 0 ? "No policy" : "Term"} />
          </SelectTrigger>
          <SelectContent>
            {termNames.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <Input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name / DSID…"
            className="pl-7 h-9 bg-[#0A1628] border-white/20 text-white placeholder:text-white/30 text-xs"
            data-testid="input-analytics-search"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-white/40 hover:text-white" />
            </button>
          )}
        </div>

        <button onClick={handleRefresh} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0A1628] border border-white/20 text-white/60 hover:text-white text-xs transition-colors disabled:opacity-40"
          data-testid="btn-refresh-analytics">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>

        {isFiltered && (
          <button onClick={handleReset}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-white/10 text-white/40 hover:text-white/60 text-xs transition-colors"
            data-testid="btn-reset-analytics">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        )}
      </div>

      {!filterClass && (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] p-8 text-center">
          <BarChart2 className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <p className="text-white/40 text-sm">Select a class to load analytics</p>
          <p className="text-white/20 text-xs mt-1">Section and term will appear once a class is chosen</p>
        </div>
      )}

      {noPolicyForClass && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-400 font-semibold text-sm">No Exam Policy for Class {filterClass}</p>
            <p className="text-amber-400/70 text-xs mt-1">
              Weighted analytics requires an Exam Policy Tier with exam weights. Configure one in School Setup → Exam Controller.
            </p>
          </div>
        </div>
      )}

      {isLoading && filterClass && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-[#D4AF37]" />
          <span className="ml-3 text-white/40 text-sm">Loading weighted results…</span>
        </div>
      )}

      {!isLoading && hasPolicyForClass && filterSection && filterTerm && (
        <>
          {lastUpdated && (
            <div className="flex items-center gap-1.5 text-[11px] text-white/30" data-testid="text-last-updated">
              <Clock className="w-3 h-3" />
              Last updated {fmtAge(lastUpdated)}
              <span className="ml-1 text-white/20">· promotion decisions refresh every 15s</span>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Total Students", value: kpi.total, icon: Users, color: "text-white" },
              { label: "Promoted", value: kpi.promoted, icon: CheckCircle, color: "text-emerald-400" },
              { label: "Retained", value: kpi.retained, icon: XCircle, color: "text-rose-400" },
              { label: "No Decision", value: kpi.pending, icon: AlertCircle, color: "text-white/40" },
              { label: "Class Avg", value: `${kpi.avg}%`, icon: TrendingUp, color: "text-[#D4AF37]" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-xl border border-white/10 bg-[#1A2942] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-xs text-white/40">{label}</span>
                </div>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {hasData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/10 bg-[#1A2942] p-4">
                <h3 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
                  <BarChart2 className="w-4 h-4" /> Promotion Distribution
                </h3>
                <PieChart promoted={kpi.promoted} retained={kpi.retained} pending={kpi.pending} active={sliceFilter} onClick={setSliceFilter} />
              </div>
              <div className="rounded-xl border border-white/10 bg-[#1A2942] p-4">
                <h3 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" /> Weighted Subject Averages
                </h3>
                <p className="text-white/30 text-[10px] mb-2">Class average per subject for {filterTerm} (weighted)</p>
                <SubjectMasteryChart data={subjectAverages} />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-[#1A2942] p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Performance Heatmap</h3>
                <p className="text-white/40 text-xs">
                  {computedStudents.length} student(s) · {filterTerm} · Weighted % per subject · Click name for journey
                </p>
              </div>
            </div>
            {computedStudents.length === 0 ? (
              <div className="text-center py-10 text-white/30 text-sm">
                No scores found for Class {filterClass}-{filterSection} in {filterTerm}.
                <p className="text-xs mt-1 text-white/20">Ensure exam scores are entered for the components of this term.</p>
              </div>
            ) : (
              <HeatmapTable
                students={computedStudents}
                subjectList={subjectList}
                sliceFilter={sliceFilter}
                passThreshold={gradingPassPct}
                onStudentClick={setSelectedStudent}
              />
            )}
          </div>
        </>
      )}

      {!isLoading && hasPolicyForClass && (!filterSection || !filterTerm) && (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] p-6 text-center text-white/30 text-sm">
          {!filterSection ? "Select a section to load student data" : "Select a term to compute weighted results"}
        </div>
      )}

      <Dialog open={!!selectedStudent} onOpenChange={o => !o && setSelectedStudent(null)}>
        <DialogContent className="bg-[#0A1628] border border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white font-semibold">
              {selectedStudent?.name} — Exam Journey
            </DialogTitle>
          </DialogHeader>
          <p className="text-white/40 text-xs">{selectedStudent?.dsid} · Class {filterClass}-{filterSection}</p>
          {loadingJourney ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" /></div>
          ) : journeyData ? (
            <JourneyChart data={journeyData} />
          ) : (
            <p className="text-white/30 text-sm text-center py-8">No journey data available.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
