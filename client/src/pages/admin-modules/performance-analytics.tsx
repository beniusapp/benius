import { useState, useMemo, useCallback, memo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, Loader2, Download, Search, X, Users,
  CheckCircle, XCircle, AlertCircle, BarChart2, BookOpen,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props { schoolId: number; classes: string[]; sections: string[]; subjects: string[]; examTypes: string[] }

type AStudent = {
  studentId: number; dsid: string; name: string;
  subjectScores: Record<string, { marks: number; totalMarks: number; isAbsent: boolean }>;
  totalObtained: number; totalMax: number; percentage: number;
  gradeLabel: string | null; gradePoint: string | null; gradeRemarks: string | null;
  tierPassThreshold: number; passStatus: "PASS" | "FAIL" | "GRACE_PASS";
  overrideStatus: string | null;
};
type AnalyticsData = {
  students: AStudent[];
  subjectAverages: { subject: string; average: number }[];
  subjectList: string[];
  passThreshold: number;
};
type JourneyData = {
  examTypes: string[];
  subjectRows: { subject: string; scores: (number | null)[] }[];
  totals: number[];
};

type SliceFilter = "PASS" | "FAIL" | "GRACE_PASS" | null;

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

function PieChart({ pass, fail, grace, active, onClick }: {
  pass: number; fail: number; grace: number; active: SliceFilter; onClick: (s: SliceFilter) => void;
}) {
  const total = pass + fail + grace;
  if (total === 0) return (
    <div className="flex items-center justify-center h-40">
      <p className="text-white/30 text-sm">No data to display</p>
    </div>
  );
  const passAngle = (pass / total) * 360;
  const failAngle = (fail / total) * 360;
  const graceAngle = (grace / total) * 360;
  const slices = [
    { key: "PASS" as SliceFilter, angle: passAngle, color: "#10b981", label: "Pass", count: pass },
    { key: "FAIL" as SliceFilter, angle: failAngle, color: "#f43f5e", label: "Fail", count: fail },
    { key: "GRACE_PASS" as SliceFilter, angle: graceAngle, color: "#f59e0b", label: "Grace", count: grace },
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
              active === p.key
                ? "border-white/40 scale-105"
                : active && active !== p.key
                ? "opacity-40 border-transparent"
                : "border-transparent hover:border-white/20"
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
  const barH = 22;
  const gap = 8;
  const svgH = data.length * (barH + gap);
  const labelW = 90;
  const barAreaW = 220;
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
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xStep = examTypes.length > 1 ? plotW / (examTypes.length - 1) : plotW / 2;
  const toX = (i: number) => padL + (examTypes.length > 1 ? i * xStep : plotW / 2);
  const toY = (v: number) => padT + plotH - (v / 100) * plotH;
  const pts = (scores: (number | null)[]) =>
    scores.map((v, i) => v !== null ? `${toX(i)},${toY(v)}` : null)
      .filter(Boolean).join(" ");
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
          <polyline key={row.subject}
            points={pts(row.scores)}
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

function pctColor(pct: number, threshold: number) {
  if (pct >= 80) return "text-emerald-400";
  if (pct < threshold) return "text-rose-400 font-bold";
  if (pct <= threshold + 5) return "text-amber-400";
  return "text-white";
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-2.5">
          <div className="h-3.5 rounded bg-white/10 animate-pulse" style={{ width: `${50 + (i * 17) % 50}%` }} />
        </td>
      ))}
    </tr>
  );
}

type TableProps = {
  students: AStudent[];
  subjectList: string[];
  sliceFilter: SliceFilter;
  search: string;
  passThreshold: number;
  onStudentClick: (s: AStudent) => void;
};

const HeatmapTable = memo(function HeatmapTable({ students, subjectList, sliceFilter, search, passThreshold, onStudentClick }: TableProps) {
  const rows = useMemo(() => {
    let list = students;
    if (sliceFilter) list = list.filter(s => s.passStatus === sliceFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.dsid.toLowerCase().includes(q));
    }
    return list;
  }, [students, sliceFilter, search]);

  const cols = 3 + subjectList.length + 2;

  return (
    <div className="overflow-auto max-h-[520px] rounded-xl border border-white/10" id="analytics-table">
      <table className="w-full text-xs" style={{ minWidth: `${300 + subjectList.length * 80}px` }}>
        <thead className="sticky top-0 z-10 bg-[#1A2942]">
          <tr className="border-b border-white/10">
            <th className="text-left px-3 py-2.5 font-semibold text-white/50 sticky left-0 bg-[#1A2942] z-20 whitespace-nowrap">#</th>
            <th className="text-left px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap">DSID</th>
            <th className="text-left px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap min-w-[120px]">Name</th>
            {subjectList.map(s => (
              <th key={s} className="text-center px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap">{s}</th>
            ))}
            <th className="text-center px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap">Total %</th>
            <th className="text-center px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap">Grade</th>
            <th className="text-center px-3 py-2.5 font-semibold text-white/50 whitespace-nowrap">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols} className="text-center py-10 text-white/30">
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
                const score = s.subjectScores[subj];
                if (!score) return <td key={subj} className="px-3 py-2.5 text-center text-white/20">—</td>;
                if (score.isAbsent) return <td key={subj} className="px-3 py-2.5 text-center text-amber-400/60 italic text-[10px]">Absent</td>;
                const raw = score.totalMarks > 0 ? Math.round((score.marks / score.totalMarks) * 100) : 0;
                return (
                  <td key={subj} className={`px-3 py-2.5 text-center ${pctColor(raw, passThreshold)}`}>
                    {score.marks}/{score.totalMarks}
                  </td>
                );
              })}
              <td className={`px-3 py-2.5 text-center font-bold ${pctColor(s.percentage, s.tierPassThreshold)}`}>
                <span>{s.percentage.toFixed(1)}%</span>
                {s.percentage >= 80 && (
                  <span className="ml-1 inline-block px-1 py-0.5 text-[9px] rounded bg-emerald-500/20 text-emerald-400 font-bold leading-none">HP</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-center text-[#D4AF37] font-semibold">
                {s.gradeLabel || "—"}
              </td>
              <td className="px-3 py-2.5 text-center">
                {s.passStatus === "PASS" && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">PASS</span>}
                {s.passStatus === "FAIL" && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">FAIL</span>}
                {s.passStatus === "GRACE_PASS" && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">GRACE</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default function PerformanceAnalytics({ schoolId, classes, sections: configSections, subjects, examTypes }: Props) {
  const [filterClass, setFilterClass] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [filterExam, setFilterExam] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [search, setSearch] = useState("");
  const [sliceFilter, setSliceFilter] = useState<SliceFilter>(null);
  const [selectedStudent, setSelectedStudent] = useState<AStudent | null>(null);

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
    setSliceFilter(null);
  }, []);

  const { data: availSections = [] } = useQuery<string[]>({
    queryKey: ["/api/admin/analytics/sections", filterClass],
    queryFn: async () => {
      if (!filterClass) return [];
      const r = await fetch(`/api/admin/analytics/sections?class=${encodeURIComponent(filterClass)}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!filterClass,
  });

  const sectionList = availSections.length > 0 ? availSections : configSections;

  const effectiveSection = filterSection && filterSection !== "all" ? filterSection : "";
  const effectiveExam = filterExam && filterExam !== "all" ? filterExam : "";
  const effectiveSubject = filterSubject && filterSubject !== "all" ? filterSubject : "";

  const params = new URLSearchParams();
  params.set("class", filterClass);
  if (effectiveSection) params.set("section", effectiveSection);
  if (effectiveExam) params.set("examType", effectiveExam);
  if (effectiveSubject) params.set("subject", effectiveSubject);

  const { data: analyticsData, isLoading: loadingData } = useQuery<AnalyticsData>({
    queryKey: ["/api/admin/analytics/performance", filterClass, effectiveSection, effectiveExam, effectiveSubject],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/performance?${params}`, { credentials: "include" });
      return r.ok ? r.json() : { students: [], subjectAverages: [], subjectList: [], passThreshold: 35 };
    },
    enabled: !!filterClass,
    staleTime: 30000,
  });

  const { data: journeyData, isLoading: loadingJourney } = useQuery<JourneyData>({
    queryKey: ["/api/admin/analytics/student-journey", selectedStudent?.studentId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/student-journey/${selectedStudent!.studentId}`, { credentials: "include" });
      return r.ok ? r.json() : { examTypes: [], subjectRows: [], totals: [] };
    },
    enabled: !!selectedStudent,
  });

  const students = analyticsData?.students ?? [];
  const subjectAverages = analyticsData?.subjectAverages ?? [];
  const subjectList = analyticsData?.subjectList ?? [];
  const passThreshold = analyticsData?.passThreshold ?? 35;

  const kpi = useMemo(() => {
    const filtered = sliceFilter ? students.filter(s => s.passStatus === sliceFilter) : students;
    const pass = students.filter(s => s.passStatus === "PASS").length;
    const fail = students.filter(s => s.passStatus === "FAIL").length;
    const grace = students.filter(s => s.passStatus === "GRACE_PASS").length;
    const avg = students.length > 0
      ? (students.reduce((s, r) => s + r.percentage, 0) / students.length).toFixed(1)
      : "0";
    return { total: students.length, pass, fail, grace, avg, filteredCount: filtered.length };
  }, [students, sliceFilter]);

  const noData = !filterClass;
  const hasData = !!analyticsData && students.length > 0;

  return (
    <div className="space-y-5" id="analytics-root">
      <style>{`@media print { #analytics-root * { color: black !important; background: white !important; } }`}</style>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white">Academic Intelligence Dashboard</h2>
          <p className="text-white/50 text-sm">Cross-filter charts, heatmap table, and student progress journeys</p>
        </div>
        {hasData && (
          <Button
            size="sm"
            onClick={() => window.print()}
            className="bg-[#1A2942] border border-white/20 text-white hover:bg-white/10 gap-2"
            data-testid="btn-download-analytics"
          >
            <Download className="w-4 h-4" /> Download Analytics
          </Button>
        )}
      </div>

      {/* ===== FILTER BAR ===== */}
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
            <SelectItem value="all">All Sections</SelectItem>
            {sectionList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterSubject} onValueChange={v => { setFilterSubject(v); setSliceFilter(null); }} disabled={!filterClass}>
          <SelectTrigger className="w-32 bg-[#0A1628] border-white/20 text-white h-9 disabled:opacity-40" data-testid="select-analytics-subject">
            <SelectValue placeholder="Subject" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Subjects</SelectItem>
            {(subjects.length > 0 ? subjects : ["Math","Science","English"]).map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterExam} onValueChange={v => { setFilterExam(v); setSliceFilter(null); }} disabled={!filterClass}>
          <SelectTrigger className="w-36 bg-[#0A1628] border-white/20 text-white h-9 disabled:opacity-40" data-testid="select-analytics-exam">
            <SelectValue placeholder="Exam Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Exams</SelectItem>
            {(examTypes.length > 0 ? examTypes : ["UT1","UT2","Mid-term","Annual"]).map(e => (
              <SelectItem key={e} value={e}>{e}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <Input
            placeholder="Search student name / DSID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 bg-[#0A1628] border-white/20 text-white placeholder:text-white/30 text-sm"
            data-testid="input-analytics-search"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ===== EMPTY STATE ===== */}
      {noData && (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#1A2942]/50 py-20 text-center">
          <TrendingUp className="w-12 h-12 mx-auto mb-3 text-white/15" />
          <p className="text-white/40 text-sm font-medium">Select a Class to begin</p>
          <p className="text-white/25 text-xs mt-1">Use the filters above to drill into class, section, exam, or subject performance.</p>
        </div>
      )}

      {/* ===== LOADING ===== */}
      {!noData && loadingData && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
          <p className="text-white/40 text-sm">Loading analytics data…</p>
        </div>
      )}

      {/* ===== MAIN CONTENT ===== */}
      {!noData && !loadingData && (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { icon: Users, label: "Total Students", value: kpi.total, color: "text-[#D4AF37]", bg: "bg-[#D4AF37]/10" },
              { icon: CheckCircle, label: "Passed", value: kpi.pass, color: "text-emerald-400", bg: "bg-emerald-500/10" },
              { icon: XCircle, label: "Failed", value: kpi.fail, color: "text-rose-400", bg: "bg-rose-500/10" },
              { icon: AlertCircle, label: "Grace Pass", value: kpi.grace, color: "text-amber-400", bg: "bg-amber-500/10" },
              { icon: BarChart2, label: "Class Average", value: `${kpi.avg}%`, color: "text-blue-400", bg: "bg-blue-500/10" },
            ].map(k => (
              <div key={k.label} className={`rounded-xl border border-white/10 bg-[#1A2942] p-4 flex gap-3 items-center`}>
                <div className={`p-2 rounded-lg ${k.bg} shrink-0`}>
                  <k.icon className={`w-4 h-4 ${k.color}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-white/40 text-xs leading-tight">{k.label}</p>
                </div>
              </div>
            ))}
          </div>

          {students.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#1A2942] py-14 text-center">
              <BookOpen className="w-9 h-9 mx-auto mb-3 text-white/20" />
              <p className="text-white/40 text-sm">No published exam data found for this filter combination.</p>
              <p className="text-white/25 text-xs mt-1">Try a different class, section, or exam type.</p>
            </div>
          ) : (
            <>
              {/* Charts row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5">
                  <h3 className="font-semibold text-white text-sm mb-1">Outcome Distribution</h3>
                  <p className="text-white/40 text-xs mb-4">Click a slice to cross-filter the table</p>
                  <PieChart
                    pass={kpi.pass} fail={kpi.fail} grace={kpi.grace}
                    active={sliceFilter} onClick={setSliceFilter}
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5">
                  <h3 className="font-semibold text-white text-sm mb-1">Subject Mastery</h3>
                  <p className="text-white/40 text-xs mb-4">Average marks per subject for current selection</p>
                  <SubjectMasteryChart data={subjectAverages} />
                </div>
              </div>

              {/* Heatmap Table */}
              <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                  <div>
                    <h3 className="font-semibold text-white text-sm">Performance Heatmap</h3>
                    <p className="text-white/40 text-xs">
                      {sliceFilter ? `Showing ${kpi.filteredCount} ${sliceFilter.replace("_"," ")} student(s)` : `${kpi.total} students`}
                      {search ? ` · filtered by "${search}"` : ""}
                      {" · Click a name to see their journey"}
                    </p>
                  </div>
                  {sliceFilter && (
                    <button onClick={() => setSliceFilter(null)} className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1" data-testid="btn-clear-slice">
                      <X className="w-3 h-3" /> Clear filter
                    </button>
                  )}
                </div>
                <div className="p-0">
                  <HeatmapTable
                    students={students}
                    subjectList={subjectList}
                    sliceFilter={sliceFilter}
                    search={search}
                    passThreshold={passThreshold}
                    onStudentClick={setSelectedStudent}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ===== STUDENT JOURNEY MODAL ===== */}
      <Dialog open={!!selectedStudent} onOpenChange={open => !open && setSelectedStudent(null)}>
        <DialogContent className="bg-[#0A1628] border border-white/20 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white">
              Progress Journey — {selectedStudent?.name}
              <span className="ml-2 text-xs text-white/40 font-normal">{selectedStudent?.dsid}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            {loadingJourney ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-[#10b981]" />
              </div>
            ) : journeyData ? (
              <>
                <div className="rounded-lg bg-[#1A2942] border border-white/10 p-4 mb-3">
                  <JourneyChart data={journeyData} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-[#1A2942] border border-white/10 p-3 text-center">
                    <p className="text-[#D4AF37] font-bold text-lg">{selectedStudent?.percentage.toFixed(1)}%</p>
                    <p className="text-white/40 text-xs">Current %</p>
                  </div>
                  <div className="rounded-lg bg-[#1A2942] border border-white/10 p-3 text-center">
                    <p className="text-white font-bold text-lg">{selectedStudent?.gradeLabel || "—"}</p>
                    <p className="text-white/40 text-xs">Grade</p>
                  </div>
                  <div className="rounded-lg bg-[#1A2942] border border-white/10 p-3 text-center">
                    {selectedStudent?.passStatus === "PASS" && <p className="text-emerald-400 font-bold text-lg">PASS</p>}
                    {selectedStudent?.passStatus === "FAIL" && <p className="text-rose-400 font-bold text-lg">FAIL</p>}
                    {selectedStudent?.passStatus === "GRACE_PASS" && <p className="text-amber-400 font-bold text-lg">GRACE</p>}
                    <p className="text-white/40 text-xs">Status</p>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
