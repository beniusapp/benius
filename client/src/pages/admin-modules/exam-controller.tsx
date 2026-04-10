import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Lock, FileText, Shield, CheckCircle, Loader2, Search,
  ChevronRight, AlertTriangle, TrendingUp, Users, Award,
  Pencil, X, GraduationCap, PlayCircle, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number; classes: string[]; sections: string[]; examTypes: string[] }

type StudentResult = {
  studentId: number;
  dsid: string;
  name: string;
  totalObtained: number;
  totalMax: number;
  percentage: number;
  subjects: string[];
  gradeLabel: string | null;
  gradePoint: string | null;
  gradeRemarks: string | null;
  tierPassThreshold: number;
};

type OverrideStatus = "PASS" | "FAIL" | "GRACE_PASS" | "REPEAT";

type Override = {
  studentId: number;
  overrideStatus: OverrideStatus;
  nextClass: string;
  nextSection: string;
};

type AggregatedData = {
  students: StudentResult[];
  overrides: Override[];
  missingSubjects: string[];
  passThreshold: number;
};

const CLASS_ORDER = ["LKG","UKG","1","2","3","4","5","6","7","8","9","10","11","12"];

function getNextClass(cls: string, allClasses: string[]): string {
  const idx = CLASS_ORDER.indexOf(cls);
  if (idx >= 0 && idx < CLASS_ORDER.length - 1) return CLASS_ORDER[idx + 1];
  const idx2 = allClasses.indexOf(cls);
  if (idx2 >= 0 && idx2 < allClasses.length - 1) return allClasses[idx2 + 1];
  return cls;
}

function ConfettiPiece({ style }: { style: React.CSSProperties }) {
  return <div className="confetti-piece absolute rounded-sm" style={style} />;
}

function Confetti() {
  const colors = ["#10b981","#D4AF37","#60a5fa","#f472b6","#a78bfa","#34d399","#fbbf24"];
  const pieces = Array.from({ length: 60 }, (_, i) => ({
    left: `${Math.random() * 100}%`,
    width: `${6 + Math.random() * 8}px`,
    height: `${10 + Math.random() * 12}px`,
    background: colors[i % colors.length],
    animationDelay: `${Math.random() * 0.8}s`,
    animationDuration: `${1.2 + Math.random() * 0.8}s`,
  }));
  return (
    <div className="fixed inset-0 pointer-events-none z-[200] overflow-hidden">
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
        .confetti-piece { animation: confetti-fall linear forwards; }
      `}</style>
      {pieces.map((p, i) => <ConfettiPiece key={i} style={p} />)}
    </div>
  );
}

function StatusBadge({ status }: { status: OverrideStatus | "AUTO_PASS" | "AUTO_FAIL" }) {
  const map: Record<string, { label: string; cls: string }> = {
    PASS:      { label: "PASS",       cls: "bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/30" },
    AUTO_PASS: { label: "PASS",       cls: "bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/30" },
    FAIL:      { label: "FAIL",       cls: "bg-red-500/20 text-red-400 border border-red-500/30" },
    AUTO_FAIL: { label: "FAIL",       cls: "bg-red-500/20 text-red-400 border border-red-500/30" },
    GRACE_PASS:{ label: "GRACE PASS", cls: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" },
    REPEAT:    { label: "REPEAT",     cls: "bg-orange-500/20 text-orange-400 border border-orange-500/30" },
  };
  const { label, cls } = map[status] ?? map.FAIL;
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cls}`}>{label}</span>;
}

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {[...Array(10)].map((_, i) => (
        <td key={i} className="py-3 px-2">
          <div className="h-3.5 rounded bg-white/10 animate-pulse" style={{ width: `${50 + (i * 11) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function ExamController({ schoolId, classes, sections, examTypes }: Props) {
  const { toast } = useToast();

  // ── Wizard Selector ──
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [examType, setExamType] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [searchQ, setSearchQ] = useState("");

  // ── Overrides ──
  const [overrideMap, setOverrideMap] = useState<Record<number, Override>>({});
  const [openOverrideFor, setOpenOverrideFor] = useState<number | null>(null);
  const [draftOverride, setDraftOverride] = useState<{ status: OverrideStatus; nextClass: string; nextSection: string } | null>(null);

  // ── Selection for bulk-promote ──
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ── Execution ──
  const [confirmed, setConfirmed] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [progress, setProgress] = useState(0);

  // ── Legacy lock ──
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const lockKey = `${cls}-${section}-${examType}`;
  const isLocked = locked.has(lockKey);

  const classList = classes.length > 0 ? classes : CLASS_ORDER;
  const sectionList = sections.length > 0 ? sections : ["A","B","C","D","E"];
  const examTypeList = examTypes.length > 0 ? examTypes : ["UT1","UT2","Mid-term","Pre-Final","Annual"];

  // ── Fetch aggregated data ──
  const { data, isLoading, isError, refetch } = useQuery<AggregatedData>({
    queryKey: ["/api/admin/exam/aggregated", cls, section, examType],
    queryFn: async () => {
      const r = await fetch(`/api/admin/exam/aggregated?class=${encodeURIComponent(cls)}&section=${encodeURIComponent(section)}&examType=${encodeURIComponent(examType)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load results");
      return r.json();
    },
    enabled: loaded && !!cls && !!section && !!examType,
  });

  // Sync server-persisted overrides into local map
  useEffect(() => {
    if (data?.overrides) {
      const map: Record<number, Override> = {};
      for (const o of data.overrides) map[o.studentId] = o;
      setOverrideMap(map);
    }
  }, [data]);

  // ── Override mutation ──
  const overrideMutation = useMutation({
    mutationFn: async (payload: Override & { examType: string; class: string; section: string }) =>
      apiRequest("POST", "/api/admin/exam/override", payload),
    onSuccess: (_r, vars) => {
      setOverrideMap(prev => ({ ...prev, [vars.studentId]: { studentId: vars.studentId, overrideStatus: vars.overrideStatus, nextClass: vars.nextClass, nextSection: vars.nextSection } }));
      setOpenOverrideFor(null);
      toast({ title: "Override Saved", description: `Status updated for student.` });
    },
    onError: (e: Error) => toast({ title: "Override Failed", description: e.message, variant: "destructive" }),
  });

  // ── Promote mutation ──
  type PromoteItem = {
    studentId: number; nextClass: string; nextSection: string;
    fromClass: string; fromSection: string; examType: string;
    totalObtained: number; totalMax: number; percentage: number;
    gradeLabel?: string | null; gradePoint?: string | null; gradeRemarks?: string | null;
  };
  const promoteMutation = useMutation({
    mutationFn: async (items: PromoteItem[]) => {
      const r = await apiRequest("POST", "/api/admin/promote", { items });
      return r.json();
    },
    onSuccess: (d) => {
      setProgress(100);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2500);
      toast({ title: "Promotion Complete!", description: `${d.promoted} students have been advanced to their new class.` });
      setConfirmed(false);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "students"] });
    },
    onError: (e: Error) => toast({ title: "Promotion Failed", description: e.message, variant: "destructive" }),
  });

  function handleLoadResults() {
    if (!cls || !section || !examType) {
      toast({ title: "Please select Class, Section and Exam Type", variant: "destructive" }); return;
    }
    setLoaded(true);
    setOverrideMap({});
    setConfirmed(false);
    setProgress(0);
  }

  function handleReset() {
    setLoaded(false);
    setOverrideMap({});
    setConfirmed(false);
    setProgress(0);
    setSearchQ("");
    setSelectedIds(new Set());
  }

  function selectAllPassed() {
    const ids = (data?.students ?? []).filter(s => {
      const st = getEffectiveStatus(s, passThreshold);
      return st === "AUTO_PASS" || st === "PASS" || st === "GRACE_PASS";
    }).map(s => s.studentId);
    setSelectedIds(new Set(ids));
  }

  function selectAllFailed() {
    const ids = (data?.students ?? []).filter(s => {
      const st = getEffectiveStatus(s, passThreshold);
      return st === "AUTO_FAIL" || st === "FAIL";
    }).map(s => s.studentId);
    setSelectedIds(new Set(ids));
  }

  function getEffectiveStatus(s: StudentResult, passThreshold: number): OverrideStatus | "AUTO_PASS" | "AUTO_FAIL" {
    const ov = overrideMap[s.studentId];
    if (ov) return ov.overrideStatus;
    return s.percentage >= passThreshold ? "AUTO_PASS" : "AUTO_FAIL";
  }

  function getNextClassForStudent(s: StudentResult): string {
    return overrideMap[s.studentId]?.nextClass ?? getNextClass(cls, classList);
  }
  function getNextSectionForStudent(s: StudentResult): string {
    return overrideMap[s.studentId]?.nextSection ?? section;
  }

  const passThreshold = data?.passThreshold ?? 35;
  const filteredStudents = (data?.students ?? []).filter(s =>
    !searchQ || s.name.toLowerCase().includes(searchQ.toLowerCase()) || s.dsid.toLowerCase().includes(searchQ.toLowerCase())
  );

  const totalStudents = data?.students.length ?? 0;
  const passing = (data?.students ?? []).filter(s => {
    const st = getEffectiveStatus(s, passThreshold);
    return st === "AUTO_PASS" || st === "PASS" || st === "GRACE_PASS";
  }).length;
  const failing = (data?.students ?? []).filter(s => {
    const st = getEffectiveStatus(s, passThreshold);
    return st === "AUTO_FAIL" || st === "FAIL";
  }).length;
  const repeating = (data?.students ?? []).filter(s => overrideMap[s.studentId]?.overrideStatus === "REPEAT").length;
  const graceCount = (data?.students ?? []).filter(s => overrideMap[s.studentId]?.overrideStatus === "GRACE_PASS").length;

  // Build promotion items: if selectedIds is non-empty, use selection; else auto-include all passing
  const eligibleByStatus = (data?.students ?? []).filter(s => {
    const st = getEffectiveStatus(s, passThreshold);
    return st !== "AUTO_FAIL" && st !== "FAIL" && st !== "REPEAT";
  });
  const promotionItems: PromoteItem[] = (selectedIds.size > 0
    ? (data?.students ?? []).filter(s => selectedIds.has(s.studentId))
    : eligibleByStatus
  ).map(s => ({
    studentId: s.studentId,
    nextClass: getNextClassForStudent(s),
    nextSection: getNextSectionForStudent(s),
    fromClass: cls,
    fromSection: section,
    examType,
    totalObtained: s.totalObtained,
    totalMax: s.totalMax,
    percentage: s.percentage,
    gradeLabel: s.gradeLabel ?? null,
    gradePoint: s.gradePoint ?? null,
    gradeRemarks: s.gradeRemarks ?? null,
  }));

  function openOverride(s: StudentResult) {
    const ov = overrideMap[s.studentId];
    setDraftOverride({
      status: ov?.overrideStatus ?? (s.percentage >= passThreshold ? "PASS" : "FAIL"),
      nextClass: ov?.nextClass ?? getNextClass(cls, classList),
      nextSection: ov?.nextSection ?? section,
    });
    setOpenOverrideFor(s.studentId);
  }

  function saveOverride(studentId: number) {
    if (!draftOverride) return;
    overrideMutation.mutate({
      studentId,
      examType,
      class: cls,
      section,
      overrideStatus: draftOverride.status,
      nextClass: draftOverride.nextClass,
      nextSection: draftOverride.nextSection,
    });
  }

  function handleExecutePromotion() {
    if (promotionItems.length === 0) {
      toast({ title: "No students to promote", variant: "destructive" }); return;
    }
    setProgress(20);
    const interval = setInterval(() => setProgress(p => Math.min(p + 15, 90)), 300);
    promoteMutation.mutate(promotionItems, {
      onSettled: () => clearInterval(interval),
    });
  }

  return (
    <div className="space-y-6">
      {showConfetti && <Confetti />}

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-[#10b981]" />
            Academic Advancement Wizard
          </h2>
          <p className="text-white/50 text-sm">Aggregate results · override statuses · execute class promotion</p>
        </div>
        {loaded && (
          <Button variant="ghost" size="sm" onClick={handleReset}
            className="text-white/50 hover:text-white hover:bg-white/10 h-11"
            data-testid="button-reset-wizard">
            <RefreshCw className="w-4 h-4 mr-1" /> New Selection
          </Button>
        )}
      </div>

      {/* ── Phase 1: Selector ── */}
      <div className="rounded-xl border border-[#10b981]/30 bg-[#1A2942] p-5">
        <p className="text-white/60 text-xs uppercase tracking-wide font-medium mb-3">Step 1 — Select Cohort</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-white/50 text-xs">Class</label>
            <Select value={cls} onValueChange={v => { setCls(v); setLoaded(false); }} disabled={loaded}>
              <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white h-11" data-testid="select-exam-class">
                <SelectValue placeholder="Class" />
              </SelectTrigger>
              <SelectContent>{classList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-white/50 text-xs">Section</label>
            <Select value={section} onValueChange={v => { setSection(v); setLoaded(false); }} disabled={loaded}>
              <SelectTrigger className="w-24 bg-[#0A1628] border-white/20 text-white h-11" data-testid="select-exam-section">
                <SelectValue placeholder="Sec" />
              </SelectTrigger>
              <SelectContent>{sectionList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-white/50 text-xs">Exam Type</label>
            <Select value={examType} onValueChange={v => { setExamType(v); setLoaded(false); }} disabled={loaded}>
              <SelectTrigger className="w-40 bg-[#0A1628] border-white/20 text-white h-11" data-testid="select-exam-type">
                <SelectValue placeholder="Exam Type" />
              </SelectTrigger>
              <SelectContent>{examTypeList.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {!loaded && (
            <Button onClick={handleLoadResults}
              className="h-11 bg-[#10b981] hover:bg-emerald-600 text-white font-semibold px-6"
              data-testid="button-load-results">
              <PlayCircle className="w-4 h-4 mr-2" /> Load Results
            </Button>
          )}
          {loaded && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#10b981]/10 border border-[#10b981]/30">
              <CheckCircle className="w-4 h-4 text-[#10b981]" />
              <span className="text-[#10b981] text-sm font-medium">Class {cls}-{section} · {examType}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Phase 2: Results Grid ── */}
      {loaded && (
        <div className="space-y-4">
          {/* Missing subjects alert */}
          {(data?.missingSubjects ?? []).length > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/8 p-4"
              data-testid="alert-missing-subjects">
              <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-400 text-sm font-semibold">Results Incomplete</p>
                <p className="text-yellow-400/70 text-xs mt-0.5">
                  Pending marks from: {data!.missingSubjects.join(", ")}
                </p>
              </div>
            </div>
          )}

          {/* Stat cards */}
          {!isLoading && data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total", value: totalStudents, icon: Users, color: "text-white" },
                { label: "Passing", value: passing, icon: CheckCircle, color: "text-[#10b981]" },
                { label: "Failing", value: failing, icon: X, color: "text-red-400" },
                { label: "Grace Pass", value: graceCount, icon: Award, color: "text-yellow-400" },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="rounded-xl border border-white/10 bg-[#1A2942] p-4 text-center">
                  <Icon className={`w-5 h-5 mx-auto mb-1 ${color}`} />
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-white/40 text-xs">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Bulk selection + Search */}
          <div className="flex flex-wrap gap-2 items-center">
            <Button size="sm" variant="outline" onClick={selectAllPassed}
              className="h-9 border-[#10b981]/40 text-[#10b981] hover:bg-[#10b981]/10 text-xs font-semibold"
              data-testid="button-select-all-passed">
              ✓ Select All Passed
            </Button>
            <Button size="sm" variant="outline" onClick={selectAllFailed}
              className="h-9 border-red-400/40 text-red-400 hover:bg-red-400/10 text-xs font-semibold"
              data-testid="button-select-all-failed">
              ✗ Select All Failed
            </Button>
            {selectedIds.size > 0 && (
              <span className="text-xs text-white/50 ml-1">{selectedIds.size} selected</span>
            )}
            {selectedIds.size > 0 && (
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-white/30 hover:text-white/60 underline" data-testid="button-clear-selection">
                Clear
              </button>
            )}
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <Input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                placeholder="Search by name or DSID…"
                className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30"
                data-testid="input-search-results" />
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-white/10 bg-[#1A2942]">
            <div className="overflow-x-auto" style={{ maxHeight: "70vh", overflowY: "auto" }}>
              <table className="text-sm" style={{ minWidth: "900px", width: "100%", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "36px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "auto" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "64px" }} />
                  <col style={{ width: "90px" }} />
                  <col style={{ width: "70px" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "56px" }} />
                </colgroup>
                <thead className="bg-[#0F1E35] sticky top-0 z-10">
                  <tr>
                    {["","DSID","Name","Total / Max","%","Status","Grade","Remarks","Next Class",""].map((h, i) => (
                      <th key={i} className="text-left py-3 px-2 text-white/60 font-medium text-xs uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? [...Array(6)].map((_, i) => <SkeletonRow key={i} />)
                    : isError
                      ? (
                        <tr><td colSpan={10} className="py-12 text-center text-red-400 text-sm">
                          Failed to load results. Try reloading.
                        </td></tr>
                      )
                      : filteredStudents.length === 0
                        ? (
                          <tr><td colSpan={10} className="py-12 text-center text-white/40">
                            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
                            {data?.students.length === 0 ? "No exam scores found for this cohort." : "No results match your search."}
                          </td></tr>
                        )
                        : filteredStudents.map((s, rowIdx) => {
                          const effStatus = getEffectiveStatus(s, passThreshold);
                          const isOverrideOpen = openOverrideFor === s.studentId;
                          const nextCls = getNextClassForStudent(s);
                          const nextSec = getNextSectionForStudent(s);
                          const isSelected = selectedIds.has(s.studentId);
                          return (
                            <React.Fragment key={s.studentId}>
                              <tr
                                className={`border-b border-white/5 hover:bg-white/5 transition-colors ${rowIdx % 2 === 1 ? "bg-white/[0.025]" : ""} ${isSelected ? "ring-1 ring-inset ring-[#10b981]/30" : ""}`}
                                data-testid={`row-result-${s.studentId}`}>
                                <td className="py-3 px-2">
                                  <div
                                    onClick={() => setSelectedIds(prev => { const n = new Set(prev); isSelected ? n.delete(s.studentId) : n.add(s.studentId); return n; })}
                                    className={`w-4 h-4 rounded border cursor-pointer flex items-center justify-center ${isSelected ? "bg-[#10b981] border-[#10b981]" : "border-white/30"}`}
                                    data-testid={`checkbox-select-${s.studentId}`}>
                                    {isSelected && <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 fill-white"><path d="M1 4l2.5 2.5L9 1"/></svg>}
                                  </div>
                                </td>
                                <td className="py-3 px-2 font-mono text-[#D4AF37] text-xs overflow-hidden text-ellipsis">{s.dsid}</td>
                                <td className="py-3 px-2 text-white font-medium text-sm overflow-hidden text-ellipsis">{s.name}</td>
                                <td className="py-3 px-2 text-white/70 text-sm">{s.totalObtained} / {s.totalMax}</td>
                                <td className="py-3 px-2 text-white font-semibold text-sm">{s.percentage.toFixed(1)}%</td>
                                <td className="py-3 px-2 whitespace-nowrap"><StatusBadge status={effStatus} /></td>
                                <td className="py-3 px-2">
                                  {s.gradeLabel
                                    ? <span className="px-1.5 py-0.5 rounded bg-[#D4AF37]/20 text-[#D4AF37] text-xs font-bold">{s.gradeLabel}</span>
                                    : <span className="text-white/20 text-xs">—</span>}
                                </td>
                                <td className="py-3 px-2 text-white/50 text-xs overflow-hidden text-ellipsis">{s.gradeRemarks || "—"}</td>
                                <td className="py-3 px-2 text-white/60 text-xs whitespace-nowrap">
                                  {effStatus === "REPEAT" ? <span className="text-orange-400">Repeat {cls}-{section}</span> : `${nextCls}-${nextSec}`}
                                </td>
                                <td className="py-3 px-2 whitespace-nowrap">
                                  <Button variant="ghost" size="icon"
                                    className="h-9 w-9 text-[#10b981] hover:bg-[#10b981]/10"
                                    onClick={() => isOverrideOpen ? setOpenOverrideFor(null) : openOverride(s)}
                                    data-testid={`button-override-${s.studentId}`}
                                    title="Override status">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                </td>
                              </tr>
                              {isOverrideOpen && draftOverride && (
                                <tr key={`override-${s.studentId}`} className="bg-[#0F1E35]/80">
                                  <td colSpan={10} className="px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-3">
                                      <span className="text-white/60 text-xs font-medium w-16">Override:</span>
                                      <Select value={draftOverride.status}
                                        onValueChange={v => setDraftOverride(d => d ? { ...d, status: v as OverrideStatus } : d)}>
                                        <SelectTrigger className="w-36 bg-[#0A1628] border-white/20 text-white h-9 text-xs"
                                          data-testid={`select-override-status-${s.studentId}`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="PASS">Pass</SelectItem>
                                          <SelectItem value="FAIL">Fail</SelectItem>
                                          <SelectItem value="GRACE_PASS">Grace Pass</SelectItem>
                                          <SelectItem value="REPEAT">Repeat Year</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      {draftOverride.status !== "REPEAT" && (
                                        <>
                                          <span className="text-white/40 text-xs">→ Next Class:</span>
                                          <Select value={draftOverride.nextClass}
                                            onValueChange={v => setDraftOverride(d => d ? { ...d, nextClass: v } : d)}>
                                            <SelectTrigger className="w-24 bg-[#0A1628] border-white/20 text-white h-9 text-xs"
                                              data-testid={`select-next-class-${s.studentId}`}>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>{classList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                                          </Select>
                                          <Select value={draftOverride.nextSection}
                                            onValueChange={v => setDraftOverride(d => d ? { ...d, nextSection: v } : d)}>
                                            <SelectTrigger className="w-20 bg-[#0A1628] border-white/20 text-white h-9 text-xs"
                                              data-testid={`select-next-section-${s.studentId}`}>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>{sectionList.map(sec => <SelectItem key={sec} value={sec}>{sec}</SelectItem>)}</SelectContent>
                                          </Select>
                                        </>
                                      )}
                                      <Button size="sm" onClick={() => saveOverride(s.studentId)}
                                        disabled={overrideMutation.isPending}
                                        className="h-11 min-h-[44px] bg-[#10b981] hover:bg-emerald-600 text-white text-xs font-semibold"
                                        data-testid={`button-save-override-${s.studentId}`}>
                                        {overrideMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                                      </Button>
                                      <Button variant="ghost" size="sm" onClick={() => setOpenOverrideFor(null)}
                                        className="h-11 min-h-[44px] text-white/40 hover:text-white text-xs"
                                        data-testid={`button-cancel-override-${s.studentId}`}>
                                        Cancel
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                  }
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Phase 3: Execution Hub ── */}
          {!isLoading && data && data.students.length > 0 && (
            <div className="rounded-xl border border-[#10b981]/20 bg-[#1A2942] p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <ChevronRight className="w-4 h-4 text-[#10b981]" />
                <h3 className="text-white font-semibold text-sm">Step 3 — Execute Promotion</h3>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-[#0A1628] p-3">
                  <p className="text-[#10b981] font-bold text-lg">{promotionItems.length}</p>
                  <p className="text-white/40 text-xs">Will Be Promoted</p>
                </div>
                <div className="rounded-lg bg-[#0A1628] p-3">
                  <p className="text-orange-400 font-bold text-lg">{repeating}</p>
                  <p className="text-white/40 text-xs">Repeating Year</p>
                </div>
                <div className="rounded-lg bg-[#0A1628] p-3">
                  <p className="text-yellow-400 font-bold text-lg">{graceCount}</p>
                  <p className="text-white/40 text-xs">Grace Passes</p>
                </div>
              </div>

              {promoteMutation.isPending && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-white/50">
                    <span>Promoting students…</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-[#10b981] transition-all duration-300 rounded-full"
                      style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-3 cursor-pointer select-none" data-testid="label-confirm-promotion">
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${confirmed ? "border-[#10b981] bg-[#10b981]" : "border-white/30 bg-transparent"}`}
                  onClick={() => setConfirmed(c => !c)}
                  data-testid="checkbox-confirm-promotion">
                  {confirmed && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                </div>
                <span className="text-white/70 text-sm">
                  I confirm this will permanently update the class/section for {promotionItems.length} students. This action cannot be undone.
                </span>
              </label>

              <Button
                onClick={handleExecutePromotion}
                disabled={!confirmed || promoteMutation.isPending || promotionItems.length === 0}
                className="w-full h-12 bg-[#10b981] hover:bg-emerald-600 disabled:opacity-40 text-white font-bold text-base"
                data-testid="button-execute-promotion">
                {promoteMutation.isPending
                  ? <><Loader2 className="w-5 h-5 animate-spin mr-2" />Promoting…</>
                  : <><GraduationCap className="w-5 h-5 mr-2" />Execute Promotion</>}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Preserved: Score Locking + Report Card ── */}
      <div className="rounded-xl border border-[#D4AF37]/20 bg-[#1A2942] p-5 space-y-4">
        <p className="text-white/40 text-xs uppercase tracking-wide font-medium">Legacy Controls</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`rounded-lg border p-4 ${isLocked ? "border-green-500/30 bg-green-500/10" : "border-white/10 bg-[#0A1628]"}`}>
            <div className="flex items-center gap-2 mb-2">
              {isLocked ? <CheckCircle className="w-5 h-5 text-green-400" /> : <Lock className="w-5 h-5 text-[#D4AF37]" />}
              <h3 className="font-semibold text-white text-sm">Score Locking</h3>
            </div>
            <p className="text-white/50 text-xs mb-3">
              {isLocked ? `Scores for Class ${cls}-${section} ${examType} are locked.` : "Lock exam scores to prevent further edits by teachers."}
            </p>
            <Button disabled={!cls || !section || !examType || isLocked}
              onClick={() => { setLocked(prev => { const n = new Set(prev); n.add(lockKey); return n; }); toast({ title: "Exam Locked", description: `${examType} for ${cls}-${section} locked.` }); }}
              className={`w-full h-11 ${isLocked ? "bg-green-600/50 cursor-not-allowed" : "bg-[#D4AF37] hover:bg-[#B8962E]"} text-[#0A1628] font-semibold`}
              data-testid="button-lock-exam">
              <Lock className="w-4 h-4 mr-1" /> {isLocked ? "Scores Locked" : "Lock Scores"}
            </Button>
          </div>
          <div className="rounded-lg border border-white/10 bg-[#0A1628] p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold text-white text-sm">Report Card Gen</h3>
            </div>
            <p className="text-white/50 text-xs mb-3">Generate printable report cards for the selected class and exam.</p>
            <Button disabled={!cls || !section || !examType}
              onClick={() => toast({ title: "Coming Soon", description: "Report card PDF generation is in development." })}
              className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-semibold"
              data-testid="button-generate-report">
              <FileText className="w-4 h-4 mr-1" /> Generate Reports
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4 text-yellow-400" />
          <p className="text-yellow-400 text-sm font-semibold">Coming in Next Release</p>
        </div>
        <p className="text-white/50 text-xs">Full report card PDF generation with school letterhead, student photo, and grade calculation is in active development.</p>
      </div>
    </div>
  );
}
