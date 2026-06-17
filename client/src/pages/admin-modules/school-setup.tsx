import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X, Save, BookOpen, Grid3X3, FileText, ChevronDown, ChevronRight, ChevronLeft, Trash2, GraduationCap, AlertTriangle, CalendarClock, Check, ChevronsUpDown, Scale, Timer } from "lucide-react";
import { AttendancePolicySetup } from "./attendance-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number; section?: string; onNavigateSection?: (section: string | null) => void; }

const CLASS_ORDER = ["LKG","UKG","1","2","3","4","5","6","7","8","9","10","11","12"];

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

interface LeavePolicyLocal {
  id?: number;
  name: string;
  annualLimit: string;
  targetRoles: string;
  renewalMonth: string;
  renewalDay: string;
  expiryBehavior: string;
  isActive: boolean;
  editing: boolean;
}

interface LeavePolicyServerData {
  id: number;
  name: string;
  annualLimit: number;
  targetRoles: string;
  renewalMonth: number;
  renewalDay: number;
  expiryBehavior: string;
  isActive: boolean;
}

function emptyPolicy(): LeavePolicyLocal {
  return { name: "", annualLimit: "12", targetRoles: "all", renewalMonth: "1", renewalDay: "1", expiryBehavior: "expire", isActive: true, editing: true };
}

function TagList({ items, onRemove }: { items: string[]; onRemove: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map(v => (
        <span key={v} className="flex items-center gap-1 px-3 py-1 rounded-full text-sm bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40">
          {v}
          <button onClick={() => onRemove(v)} className="hover:text-red-400 transition-colors" data-testid={`btn-remove-tag-${v}`}>
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function MetaSection({ title, icon: Icon, items, onAdd, onRemove, onSave, input, setInput, testId, isPending }: {
  title: string; icon: any; items: string[]; onAdd: () => void; onRemove: (v: string) => void;
  onSave: () => void; input: string; setInput: (v: string) => void; testId: string; isPending: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-lg bg-[#D4AF37]/20">
          <Icon className="w-4 h-4 text-[#D4AF37]" />
        </div>
        <h3 className="font-semibold text-white">{title}</h3>
        <span className="ml-auto text-xs text-white/40">{items.length} configured</span>
      </div>
      <div className="flex gap-2 mb-2">
        <Input
          value={input} onChange={e => setInput(e.target.value)}
          placeholder={`Add ${title.toLowerCase()}...`}
          className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30 flex-1"
          data-testid={`input-${testId}`}
          onKeyDown={e => e.key === "Enter" && onAdd()}
        />
        <Button onClick={onAdd} size="sm" variant="outline" className="border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10" data-testid={`button-add-${testId}`}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <TagList items={items} onRemove={onRemove} />
      <Button onClick={onSave} disabled={isPending} size="sm" className="mt-3 bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid={`button-save-${testId}`}>
        <Save className="w-3.5 h-3.5 mr-1" /> Save {title}
      </Button>
    </div>
  );
}

interface WeightComponentLocal { sourceExam: string; weight: string; }
interface TargetTermLocal { targetName: string; components: WeightComponentLocal[]; }
interface TermColsLocal {
  studentProfile: boolean; weightedAvg: boolean; termGrade: boolean;
  subjectFails: boolean; attendance: boolean; promotionGate: boolean;
  reportCard: boolean; cumulativeTotal: boolean; finalGrade: boolean;
}
function defaultTermCols(): TermColsLocal {
  return {
    studentProfile: true, weightedAvg: true, termGrade: true,
    subjectFails: true, attendance: true, promotionGate: true,
    reportCard: true, cumulativeTotal: false, finalGrade: false,
  };
}
interface CumulativeTermWeight { termName: string; weight: string; }
interface MaxFailedRule { term: string; failCount: string; }
interface AttendanceRule { term: string; minPct: string; }
interface ExamPolicyTierLocal {
  id?: number;
  tempId: string;
  tierName: string;
  applicableClasses: string[];
  targetTerms: TargetTermLocal[];
  enableMaxFailed: boolean;
  /** Dynamic list — each entry defines a term + threshold pair for Rule 1. */
  maxFailedRules: MaxFailedRule[];
  enableAttendanceRule: boolean;
  /** Dynamic list — each entry defines a term + minimum attendance % for Rule 2. */
  attendanceRules: AttendanceRule[];
  expanded: boolean;
  // Section C — per-term column visibility
  termColumnConfigs: Record<string, TermColsLocal>;
  cumulativeEnabled: boolean;
  cumulativeTriggerTerm: string;
  cumulativeTermWeights: CumulativeTermWeight[];
  cumulativePromotionEnabled: boolean;
  cumulativeMinPercent: string;
  enableTermAvgRule: boolean;
  termAvgMinPct: string;
}

function emptyTargetTerm(): TargetTermLocal {
  return { targetName: "", components: [{ sourceExam: "", weight: "" }] };
}
function emptyExamPolicyTier(): ExamPolicyTierLocal {
  return {
    tempId: `new-${Date.now()}`,
    tierName: "",
    applicableClasses: [],
    targetTerms: [emptyTargetTerm()],
    enableMaxFailed: true,
    maxFailedRules: [{ term: "", failCount: "3" }],
    enableAttendanceRule: false,
    attendanceRules: [{ term: "", minPct: "75" }],
    expanded: true,
    termColumnConfigs: {},
    cumulativeEnabled: false,
    cumulativeTriggerTerm: "",
    cumulativeTermWeights: [],
    cumulativePromotionEnabled: false,
    cumulativeMinPercent: "35",
    enableTermAvgRule: false,
    termAvgMinPct: "35",
  };
}
function validateExamPolicyTiers(tiers: ExamPolicyTierLocal[]): string[] {
  const errors: string[] = [];
  const classMap = new Map<string, string>();
  for (const t of tiers) {
    if (!t.tierName.trim()) { errors.push("A policy tier is missing a name."); continue; }
    if (t.applicableClasses.length === 0) errors.push(`"${t.tierName}": At least one class must be selected.`);
    for (const cls of t.applicableClasses) {
      if (classMap.has(cls)) errors.push(`Class "${cls}" is assigned to both "${classMap.get(cls)}" and "${t.tierName}".`);
      else classMap.set(cls, t.tierName);
    }
    if (t.targetTerms.length === 0) errors.push(`"${t.tierName}": At least one target term must be defined.`);
    for (const term of t.targetTerms) {
      if (!term.targetName.trim()) errors.push(`"${t.tierName}": A target term is missing a name.`);
      if (term.components.length === 0) { errors.push(`"${t.tierName}" / "${term.targetName || "Unnamed term"}": At least one exam component is required.`); continue; }
      const totalWeight = term.components.reduce((s, c) => s + (parseFloat(c.weight) || 0), 0);
      if (Math.abs(totalWeight - 100) >= 0.01) errors.push(`"${t.tierName}" / "${term.targetName || "Unnamed term"}": Weights must sum to exactly 100% (currently ${totalWeight.toFixed(1)}%).`);
      for (const comp of term.components) {
        if (!comp.sourceExam.trim()) errors.push(`"${t.tierName}" / "${term.targetName || "Unnamed term"}": A component is missing a source exam.`);
      }
    }
    if (!t.enableMaxFailed && !t.enableAttendanceRule && !t.enableTermAvgRule && !t.cumulativePromotionEnabled) errors.push(`"${t.tierName}": Enable at least one retention rule.`);
    if (t.enableMaxFailed) {
      if (t.maxFailedRules.length === 0) errors.push(`"${t.tierName}": Add at least one term rule for Rule 1.`);
      t.maxFailedRules.forEach((r, i) => {
        if (!r.term) errors.push(`"${t.tierName}": Rule 1 — Row ${i + 1} needs a term.`);
      });
    }
    if (t.enableAttendanceRule) {
      if (t.attendanceRules.length === 0) errors.push(`"${t.tierName}": Add at least one term rule for Rule 2.`);
      t.attendanceRules.forEach((r, i) => {
        if (!r.term) errors.push(`"${t.tierName}": Rule 2 — Row ${i + 1} needs a term.`);
      });
    }
  }
  return Array.from(new Set(errors));
}

interface GradeRow { gradeLabel: string; minPercent: string; maxPercent: string; gradePoint: string; remarks: string; }
interface TierLocal {
  id?: number;
  tempId: string;
  name: string;
  classes: string[];
  passPercentage: string;
  gradingSystem: "percentage" | "grade" | "both";
  passingGrades: string[];
  sortOrder: number;
  expanded: boolean;
  rules: GradeRow[];
}

function emptyRule(): GradeRow { return { gradeLabel: "", minPercent: "", maxPercent: "", gradePoint: "", remarks: "" }; }

function validateTiers(tiers: TierLocal[]): string[] {
  const errors: string[] = [];
  const classTierMap = new Map<string, string>();

  for (const t of tiers) {
    if (!t.name.trim()) { errors.push(`A tier is missing a name.`); continue; }
    if (t.classes.length === 0) { errors.push(`"${t.name || "Unnamed"}": At least one class must be selected.`); }
    for (const cls of t.classes) {
      if (classTierMap.has(cls)) {
        errors.push(`Class "${cls}" is assigned to both "${classTierMap.get(cls)}" and "${t.name}".`);
      } else {
        classTierMap.set(cls, t.name || "Unnamed");
      }
    }
    for (const r of t.rules) {
      const mn = parseInt(r.minPercent); const mx = parseInt(r.maxPercent);
      if (!r.gradeLabel.trim()) { errors.push(`"${t.name}": Grade label is required for all rows.`); }
      if (isNaN(mn) || isNaN(mx)) { errors.push(`"${t.name}": Min/Max % must be numbers.`); }
      else if (mn >= mx) { errors.push(`"${t.name}": Min % must be less than Max % in each grade row.`); }
    }
    const sortedRules = [...t.rules].sort((a, b) => parseInt(a.minPercent) - parseInt(b.minPercent));
    for (let i = 1; i < sortedRules.length; i++) {
      const prev = parseInt(sortedRules[i - 1].maxPercent);
      const cur = parseInt(sortedRules[i].minPercent);
      if (cur < prev) { errors.push(`"${t.name}": Grade ranges overlap.`); break; }
      if (cur > prev + 1) { errors.push(`"${t.name}": Gap between grade ranges (${prev} to ${cur}).`); break; }
    }
  }
  return Array.from(new Set(errors));
}

function TierAccordion({ tier, classesList, onChange, onDelete, onSave, isSaving }: {
  tier: TierLocal;
  classesList: string[];
  onChange: (t: TierLocal) => void;
  onDelete: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const [showClassPicker, setShowClassPicker] = useState(false);

  const setField = (field: keyof TierLocal, val: any) => onChange({ ...tier, [field]: val });
  const setRule = (idx: number, field: keyof GradeRow, val: string) => {
    const newRules = tier.rules.map((r, i) => i === idx ? { ...r, [field]: val } : r);
    onChange({ ...tier, rules: newRules });
  };
  const addRule = () => onChange({ ...tier, rules: [...tier.rules, emptyRule()] });
  const removeRule = (idx: number) => onChange({ ...tier, rules: tier.rules.filter((_, i) => i !== idx) });

  const toggleClass = (cls: string) => {
    const updated = tier.classes.includes(cls)
      ? tier.classes.filter(c => c !== cls)
      : [...tier.classes, cls];
    setField("classes", updated);
  };

  const usePercentage = tier.gradingSystem === "percentage" || tier.gradingSystem === "both";
  const useGrade = tier.gradingSystem === "grade" || tier.gradingSystem === "both";

  const handleSystemToggle = (toggled: "percentage" | "grade") => {
    const isOn = toggled === "percentage" ? usePercentage : useGrade;
    const otherOn = toggled === "percentage" ? useGrade : usePercentage;
    if (isOn && !otherOn) return; // keep at least one active
    if (isOn) {
      setField("gradingSystem", toggled === "percentage" ? "grade" : "percentage");
    } else {
      setField("gradingSystem", "both");
    }
  };

  const gradeLabels = tier.rules.map(r => r.gradeLabel).filter(Boolean);
  const togglePassingGrade = (grade: string) => {
    const updated = tier.passingGrades.includes(grade)
      ? tier.passingGrades.filter(g => g !== grade)
      : [...tier.passingGrades, grade];
    setField("passingGrades", updated);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden" data-testid={`tier-card-${tier.tempId}`}>
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/5 transition-colors"
        onClick={() => setField("expanded", !tier.expanded)}
        data-testid={`btn-expand-tier-${tier.tempId}`}
      >
        <div className="p-1.5 rounded-lg bg-[#10b981]/20">
          <GraduationCap className="w-4 h-4 text-[#10b981]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm truncate">{tier.name || "Unnamed Tier"}</p>
          <p className="text-white/40 text-xs">
            {tier.classes.length > 0 ? tier.classes.join(", ") : "No classes selected"}
            &nbsp;·&nbsp;
            {tier.gradingSystem === "both" ? `${tier.passPercentage}% + Grade` : tier.gradingSystem === "grade" ? "Grade-based" : `${tier.passPercentage}% pass`}
          </p>
        </div>
        <span className="text-xs text-white/40 mr-2">{tier.rules.length} grade{tier.rules.length !== 1 ? "s" : ""}</span>
        {tier.expanded ? <ChevronDown className="w-4 h-4 text-white/40 shrink-0" /> : <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />}
      </button>

      {tier.expanded && (
        <div className="px-5 pb-5 space-y-5 border-t border-white/10 pt-4">

          {/* ── Name ── */}
          <div>
            <label className="text-xs text-white/50 mb-1 block">Tier Name</label>
            <Input value={tier.name} onChange={e => setField("name", e.target.value)}
              placeholder="e.g. Primary" className="bg-[#0A1628] border-white/20 text-white text-sm h-9"
              data-testid={`input-tier-name-${tier.tempId}`} />
          </div>

          {/* ── For Classes (multi-select) ── */}
          <div>
            <label className="text-xs text-white/50 mb-1 block">For Classes</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowClassPicker(p => !p)}
                className="w-full flex items-center justify-between h-9 px-3 rounded-md bg-[#0A1628] border border-white/20 text-sm text-left transition-colors hover:border-white/40"
                data-testid={`btn-class-picker-${tier.tempId}`}
              >
                <span className={tier.classes.length === 0 ? "text-white/30" : "text-white"}>
                  {tier.classes.length === 0
                    ? "Select classes…"
                    : tier.classes.length === 1
                      ? tier.classes[0]
                      : `${tier.classes.length} classes selected`}
                </span>
                <ChevronsUpDown className="w-3.5 h-3.5 text-white/30 shrink-0" />
              </button>

              {showClassPicker && (
                <div className="absolute z-20 top-10 left-0 w-full rounded-md border border-white/20 bg-[#0F1E35] shadow-xl py-1 max-h-52 overflow-y-auto">
                  {classesList.length === 0 ? (
                    <p className="text-white/30 text-xs px-3 py-2 italic">No classes configured — add them in the Classes section above.</p>
                  ) : (
                    classesList.map(cls => {
                      const checked = tier.classes.includes(cls);
                      return (
                        <button
                          key={cls}
                          type="button"
                          onClick={() => toggleClass(cls)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${checked ? "bg-[#10b981]/10 text-[#10b981]" : "text-white/70 hover:bg-white/5"}`}
                          data-testid={`class-option-${tier.tempId}-${cls}`}
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-[#10b981] border-[#10b981]" : "border-white/30"}`}>
                            {checked && <Check className="w-2.5 h-2.5 text-white" />}
                          </span>
                          {cls}
                        </button>
                      );
                    })
                  )}
                  {classesList.length > 0 && (
                    <div className="border-t border-white/10 mt-1 pt-1 px-3 pb-1 flex gap-2">
                      <button type="button" onClick={() => setField("classes", classesList)}
                        className="text-[10px] text-[#10b981] hover:underline" data-testid={`btn-select-all-${tier.tempId}`}>
                        Select all
                      </button>
                      <button type="button" onClick={() => setField("classes", [])}
                        className="text-[10px] text-white/40 hover:underline" data-testid={`btn-clear-all-${tier.tempId}`}>
                        Clear
                      </button>
                      <button type="button" onClick={() => setShowClassPicker(false)}
                        className="text-[10px] text-white/40 hover:underline ml-auto">
                        Done
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {tier.classes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tier.classes.map(cls => (
                  <span key={cls} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30">
                    {cls}
                    <button onClick={() => toggleClass(cls)} className="hover:text-red-400 transition-colors" data-testid={`remove-class-${tier.tempId}-${cls}`}>
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Grading System ── */}
          <div>
            <label className="text-xs text-white/50 mb-2 block">Passing System</label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => handleSystemToggle("percentage")}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                  usePercentage
                    ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                    : "bg-white/5 border-white/15 text-white/40 hover:border-white/30"
                }`}
                data-testid={`btn-system-pct-${tier.tempId}`}
              >
                <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${usePercentage ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
                  {usePercentage && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                Percentage-Based
              </button>
              <button
                type="button"
                onClick={() => handleSystemToggle("grade")}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                  useGrade
                    ? "bg-purple-500/20 border-purple-500/50 text-purple-300"
                    : "bg-white/5 border-white/15 text-white/40 hover:border-white/30"
                }`}
                data-testid={`btn-system-grade-${tier.tempId}`}
              >
                <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${useGrade ? "bg-purple-500 border-purple-500" : "border-white/30"}`}>
                  {useGrade && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                Grade-Based
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {usePercentage && (
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                  <label className="text-[11px] text-blue-300 font-medium mb-1.5 block">Pass Percentage (%)</label>
                  <Input type="number" min={0} max={100} value={tier.passPercentage}
                    onChange={e => setField("passPercentage", e.target.value)}
                    placeholder="35" className="bg-[#0A1628] border-white/20 text-white text-sm h-9"
                    data-testid={`input-tier-pass-${tier.tempId}`} />
                  <p className="text-[10px] text-blue-300/50 mt-1">Students must score ≥ {tier.passPercentage || "?"}% to pass.</p>
                </div>
              )}
              {useGrade && (
                <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
                  <label className="text-[11px] text-purple-300 font-medium mb-1.5 block">Passing Grades</label>
                  {gradeLabels.length === 0 ? (
                    <p className="text-[11px] text-white/30 italic">Add grade brackets below first to define passing grades.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {gradeLabels.map(g => {
                        const isPass = tier.passingGrades.includes(g);
                        return (
                          <button key={g} type="button" onClick={() => togglePassingGrade(g)}
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                              isPass
                                ? "bg-purple-500/30 border-purple-500/60 text-purple-200"
                                : "bg-white/5 border-white/20 text-white/40 hover:border-white/40"
                            }`}
                            data-testid={`btn-passing-grade-${tier.tempId}-${g}`}>
                            {g} {isPass ? "✓ Pass" : "Fail"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[10px] text-purple-300/50 mt-1.5">
                    {tier.passingGrades.length > 0
                      ? `Pass: ${tier.passingGrades.join(", ")}`
                      : "No passing grades selected."}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Grade Brackets ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">Grade Brackets</p>
              <Button size="sm" variant="ghost" onClick={addRule}
                className="h-7 text-[#10b981] hover:bg-[#10b981]/10 text-xs"
                data-testid={`btn-add-rule-${tier.tempId}`}>
                <Plus className="w-3 h-3 mr-1" /> Add Row
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ minWidth: "520px" }}>
                <thead>
                  <tr className="border-b border-white/10">
                    {["Grade","Min %","Max %","Grade Point","Remarks",""].map((h, i) => (
                      <th key={i} className="text-left py-1.5 px-2 text-white/40 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tier.rules.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-3 text-white/30 italic">No grade rows yet. Add one above.</td></tr>
                  )}
                  {tier.rules.map((r, idx) => (
                    <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-1.5 px-2">
                        <Input value={r.gradeLabel} onChange={e => setRule(idx, "gradeLabel", e.target.value)}
                          placeholder="A+" className="h-7 bg-[#0A1628] border-white/20 text-white text-xs w-16"
                          data-testid={`input-grade-label-${tier.tempId}-${idx}`} />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input type="number" min={0} max={100} value={r.minPercent}
                          onChange={e => setRule(idx, "minPercent", e.target.value)}
                          placeholder="0" className="h-7 bg-[#0A1628] border-white/20 text-white text-xs w-16"
                          data-testid={`input-min-pct-${tier.tempId}-${idx}`} />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input type="number" min={0} max={100} value={r.maxPercent}
                          onChange={e => setRule(idx, "maxPercent", e.target.value)}
                          placeholder="100" className="h-7 bg-[#0A1628] border-white/20 text-white text-xs w-16"
                          data-testid={`input-max-pct-${tier.tempId}-${idx}`} />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input value={r.gradePoint} onChange={e => setRule(idx, "gradePoint", e.target.value)}
                          placeholder="4.0" className="h-7 bg-[#0A1628] border-white/20 text-white text-xs w-16"
                          data-testid={`input-grade-point-${tier.tempId}-${idx}`} />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input value={r.remarks} onChange={e => setRule(idx, "remarks", e.target.value)}
                          placeholder="Excellent" className="h-7 bg-[#0A1628] border-white/20 text-white text-xs w-24"
                          data-testid={`input-remarks-${tier.tempId}-${idx}`} />
                      </td>
                      <td className="py-1.5 px-2">
                        <button onClick={() => removeRule(idx)} className="text-red-400/60 hover:text-red-400 transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center"
                          data-testid={`btn-del-rule-${tier.tempId}-${idx}`}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={onSave} disabled={isSaving} size="sm"
              className="bg-[#10b981] hover:bg-emerald-600 text-white font-semibold h-9"
              data-testid={`btn-save-tier-${tier.tempId}`}>
              <Save className="w-3.5 h-3.5 mr-1.5" /> {isSaving ? "Saving…" : "Save Tier"}
            </Button>
            <Button onClick={onDelete} size="sm" variant="ghost"
              className="text-red-400/70 hover:text-red-400 hover:bg-red-400/10 h-9"
              data-testid={`btn-del-tier-${tier.tempId}`}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete Tier
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TermSelect({ value, onChange, terms, placeholder, testId }: {
  value: string; onChange: (v: string) => void; terms: string[]; placeholder: string; testId?: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-white/20 bg-[#0A1628] text-sm px-2 text-white appearance-none cursor-pointer focus:outline-none focus:border-[#D4AF37]/60"
      style={{ colorScheme: "dark" }} data-testid={testId}>
      <option value="" className="bg-[#0A1628] text-white/40">{placeholder}</option>
      {terms.filter(t => t.trim()).map(t => (
        <option key={t} value={t} className="bg-[#0A1628] text-white">{t}</option>
      ))}
    </select>
  );
}

function ExamPolicyTierAccordion({ tier, classesList, examTypesList, onChange, onDelete, onSave, isSaving, justSaved }: {
  tier: ExamPolicyTierLocal;
  classesList: string[];
  examTypesList: string[];
  onChange: (t: ExamPolicyTierLocal) => void;
  onDelete: () => void;
  onSave: () => void;
  isSaving: boolean;
  justSaved?: boolean;
}) {
  const [showClassPicker, setShowClassPicker] = useState(false);
  const [sectionCTerm, setSectionCTerm] = useState<string>("");
  const setField = (field: keyof ExamPolicyTierLocal, val: any) => onChange({ ...tier, [field]: val });

  const termNames = tier.targetTerms.map(t => t.targetName).filter(n => n.trim());
  const pendingTermNames = termNames.filter(n => !tier.termColumnConfigs[n]);
  const currentTermCumulativeEnabled = !!(
    sectionCTerm &&
    tier.termColumnConfigs[sectionCTerm] &&
    (tier.termColumnConfigs[sectionCTerm].cumulativeTotal || tier.termColumnConfigs[sectionCTerm].finalGrade)
  );

  const toggleClass = (cls: string) => {
    const updated = tier.applicableClasses.includes(cls)
      ? tier.applicableClasses.filter(c => c !== cls)
      : [...tier.applicableClasses, cls];
    setField("applicableClasses", updated);
  };
  const addTargetTerm = () => onChange({ ...tier, targetTerms: [...tier.targetTerms, emptyTargetTerm()] });
  const removeTargetTerm = (idx: number) => onChange({ ...tier, targetTerms: tier.targetTerms.filter((_, i) => i !== idx) });
  const updateTargetTermName = (idx: number, name: string) =>
    onChange({ ...tier, targetTerms: tier.targetTerms.map((t, i) => i === idx ? { ...t, targetName: name } : t) });
  const addComponent = (termIdx: number) =>
    onChange({ ...tier, targetTerms: tier.targetTerms.map((t, i) => i === termIdx ? { ...t, components: [...t.components, { sourceExam: "", weight: "" }] } : t) });
  const removeComponent = (termIdx: number, compIdx: number) =>
    onChange({ ...tier, targetTerms: tier.targetTerms.map((t, i) => i === termIdx ? { ...t, components: t.components.filter((_, ci) => ci !== compIdx) } : t) });
  const updateComponent = (termIdx: number, compIdx: number, field: "sourceExam" | "weight", val: string) =>
    onChange({ ...tier, targetTerms: tier.targetTerms.map((t, i) => i === termIdx ? { ...t, components: t.components.map((c, ci) => ci === compIdx ? { ...c, [field]: val } : c) } : t) });

  return (
    <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden" data-testid={`exam-policy-card-${tier.tempId}`}>
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/5 transition-colors"
        onClick={() => setField("expanded", !tier.expanded)}
        data-testid={`btn-expand-exam-policy-${tier.tempId}`}
      >
        <div className="p-1.5 rounded-lg bg-[#D4AF37]/20">
          <Scale className="w-4 h-4 text-[#D4AF37]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm truncate">{tier.tierName || "Unnamed Policy"}</p>
          <p className="text-white/40 text-xs">
            {tier.applicableClasses.length > 0 ? `Classes: ${tier.applicableClasses.join(", ")}` : "No classes selected"}
            &nbsp;·&nbsp;{tier.targetTerms.length} target term{tier.targetTerms.length !== 1 ? "s" : ""}
          </p>
        </div>
        {tier.expanded ? <ChevronDown className="w-4 h-4 text-white/40 shrink-0" /> : <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />}
      </button>

      {tier.expanded && (
        <div className="px-5 pb-5 space-y-5 border-t border-white/10 pt-4">

          {/* Tier Name */}
          <div>
            <label className="text-xs text-white/50 mb-1 block">Policy Tier Name</label>
            <Input value={tier.tierName} onChange={e => setField("tierName", e.target.value)}
              placeholder="e.g. Middle School Policy"
              className="bg-[#0A1628] border-white/20 text-white text-sm h-9"
              data-testid={`input-exam-policy-name-${tier.tempId}`} />
          </div>

          {/* Class Multi-select */}
          <div>
            <label className="text-xs text-white/50 mb-1 block">Applicable Classes</label>
            <div className="relative">
              <button type="button" onClick={() => setShowClassPicker(p => !p)}
                className="w-full flex items-center justify-between h-9 px-3 rounded-md bg-[#0A1628] border border-white/20 text-sm text-left hover:border-white/40 transition-colors"
                data-testid={`btn-exam-policy-class-picker-${tier.tempId}`}>
                <span className={tier.applicableClasses.length === 0 ? "text-white/30" : "text-white"}>
                  {tier.applicableClasses.length === 0 ? "Select classes…"
                    : tier.applicableClasses.length === 1 ? tier.applicableClasses[0]
                    : `${tier.applicableClasses.length} classes selected`}
                </span>
                <ChevronsUpDown className="w-3.5 h-3.5 text-white/30 shrink-0" />
              </button>
              {showClassPicker && (
                <div className="absolute z-20 top-10 left-0 w-full rounded-md border border-white/20 bg-[#0F1E35] shadow-xl py-1 max-h-52 overflow-y-auto">
                  {classesList.length === 0 ? (
                    <p className="text-white/30 text-xs px-3 py-2 italic">No classes configured — add them in the Classes section above.</p>
                  ) : (
                    classesList.map(cls => {
                      const checked = tier.applicableClasses.includes(cls);
                      return (
                        <button key={cls} type="button" onClick={() => toggleClass(cls)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${checked ? "bg-[#D4AF37]/10 text-[#D4AF37]" : "text-white/70 hover:bg-white/5"}`}
                          data-testid={`exam-policy-class-option-${tier.tempId}-${cls}`}>
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-[#D4AF37] border-[#D4AF37]" : "border-white/30"}`}>
                            {checked && <Check className="w-2.5 h-2.5 text-[#0A1628]" />}
                          </span>
                          {cls}
                        </button>
                      );
                    })
                  )}
                  {classesList.length > 0 && (
                    <div className="border-t border-white/10 mt-1 pt-1 px-3 pb-1 flex gap-2">
                      <button type="button" onClick={() => setField("applicableClasses", classesList)}
                        className="text-[10px] text-[#D4AF37] hover:underline" data-testid={`btn-exam-policy-select-all-${tier.tempId}`}>
                        Select all
                      </button>
                      <button type="button" onClick={() => setField("applicableClasses", [])}
                        className="text-[10px] text-white/40 hover:underline">Clear</button>
                      <button type="button" onClick={() => setShowClassPicker(false)}
                        className="text-[10px] text-white/40 hover:underline ml-auto">Done</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {tier.applicableClasses.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tier.applicableClasses.map(cls => (
                  <span key={cls} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30">
                    {cls}
                    <button onClick={() => toggleClass(cls)} className="hover:text-red-400 transition-colors">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Section A: Exam Aggregation Weights */}
          <div className="rounded-lg border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#D4AF37]">Section A — Exam Aggregation Weights</p>
                <p className="text-xs text-white/40 mt-0.5">
                  Define how component exams (from your configured Exam Types) combine into each composite result term. Weights must sum to exactly 100%.
                </p>
              </div>
              <Button size="sm" type="button" onClick={addTargetTerm}
                className="bg-[#D4AF37]/20 hover:bg-[#D4AF37]/30 text-[#D4AF37] border border-[#D4AF37]/40 h-8 text-xs shrink-0 ml-3"
                data-testid={`btn-add-target-term-${tier.tempId}`}>
                <Plus className="w-3 h-3 mr-1" /> Add Term
              </Button>
            </div>

            {examTypesList.length === 0 && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-400/70">
                No exam types configured yet. Go to the <span className="font-semibold">Exam Types</span> section above to add them first.
              </div>
            )}

            {tier.targetTerms.length === 0 && (
              <p className="text-white/30 text-xs italic text-center py-2">No target terms yet. Click "Add Term" to define a composite result.</p>
            )}

            {tier.targetTerms.map((term, termIdx) => {
              const totalWeight = term.components.reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0);
              const weightOk = Math.abs(totalWeight - 100) < 0.01;
              return (
                <div key={termIdx} className="rounded-md border border-white/10 bg-[#0A1628] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input value={term.targetName} onChange={e => updateTargetTermName(termIdx, e.target.value)}
                      placeholder="Result term name (e.g. Final Exam Result)"
                      className="bg-[#1A2942] border-white/20 text-white text-xs h-8 flex-1"
                      data-testid={`input-target-term-name-${tier.tempId}-${termIdx}`} />
                    <button onClick={() => removeTargetTerm(termIdx)}
                      className="text-red-400/60 hover:text-red-400 transition-colors shrink-0 p-1"
                      data-testid={`btn-remove-target-term-${tier.tempId}-${termIdx}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" style={{ minWidth: "340px" }}>
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left text-white/40 font-medium pb-1.5 pr-2">Source Exam</th>
                          <th className="text-left text-white/40 font-medium pb-1.5 pr-2" style={{ width: "96px" }}>Weight (%)</th>
                          <th className="pb-1.5" style={{ width: "28px" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {term.components.map((comp, compIdx) => (
                          <tr key={compIdx}>
                            <td className="py-1 pr-2">
                              {examTypesList.length > 0 ? (
                                <select value={comp.sourceExam}
                                  onChange={e => updateComponent(termIdx, compIdx, "sourceExam", e.target.value)}
                                  className="h-7 w-full rounded border border-white/20 bg-[#1A2942] text-xs px-2 text-white appearance-none cursor-pointer focus:outline-none focus:border-[#D4AF37]/60"
                                  style={{ colorScheme: "dark" }}
                                  data-testid={`select-source-exam-${tier.tempId}-${termIdx}-${compIdx}`}>
                                  <option value="" className="bg-[#1A2942] text-white/40">— pick exam —</option>
                                  {examTypesList.map(et => (
                                    <option key={et} value={et} className="bg-[#1A2942] text-white">{et}</option>
                                  ))}
                                </select>
                              ) : (
                                <Input value={comp.sourceExam}
                                  onChange={e => updateComponent(termIdx, compIdx, "sourceExam", e.target.value)}
                                  placeholder="Exam name"
                                  className="bg-[#1A2942] border-white/20 text-white text-xs h-7"
                                  data-testid={`input-source-exam-${tier.tempId}-${termIdx}-${compIdx}`} />
                              )}
                            </td>
                            <td className="py-1 pr-2">
                              <Input type="number" min="1" max="100" value={comp.weight}
                                onChange={e => updateComponent(termIdx, compIdx, "weight", e.target.value)}
                                placeholder="0"
                                className="bg-[#1A2942] border-white/20 text-white text-xs h-7"
                                data-testid={`input-weight-${tier.tempId}-${termIdx}-${compIdx}`} />
                            </td>
                            <td className="py-1">
                              <button onClick={() => removeComponent(termIdx, compIdx)}
                                className="text-red-400/60 hover:text-red-400 transition-colors p-0.5"
                                data-testid={`btn-remove-component-${tier.tempId}-${termIdx}-${compIdx}`}>
                                <X className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button onClick={() => addComponent(termIdx)}
                      className="text-xs text-white/40 hover:text-[#D4AF37] transition-colors flex items-center gap-1"
                      data-testid={`btn-add-component-${tier.tempId}-${termIdx}`}>
                      <Plus className="w-3 h-3" /> Add component
                    </button>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${weightOk ? "bg-emerald-500/20 text-emerald-400" : term.components.length > 0 ? "bg-red-500/20 text-red-400" : "bg-white/10 text-white/30"}`}>
                      {totalWeight.toFixed(1)}% / 100%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Section B: Promotion & Failure Logic */}
          <div className="rounded-lg border border-white/10 bg-[#0A1628]/60 p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-[#D4AF37]">Section B — Promotion & Failure Logic</p>
              <p className="text-xs text-white/40 mt-0.5">
                Student is retained if <span className="text-white/60 font-medium">any row</span> below is triggered.
                Term names are pulled from Section A above.
              </p>
            </div>

            {termNames.length === 0 && (
              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/30 italic">
                Define target terms in Section A first — they will appear as dropdown options here.
              </div>
            )}

            {/* Rule 1 — dynamic multi-term rows */}
            <div className={`rounded-md border p-3 space-y-3 transition-colors ${tier.enableMaxFailed ? "border-[#D4AF37]/30 bg-[#D4AF37]/5" : "border-white/10 bg-[#1A2942]/40"}`}>
              <div className="flex items-center gap-3">
                <button type="button"
                  onClick={() => setField("enableMaxFailed", !tier.enableMaxFailed)}
                  className={`w-9 h-5 rounded-full border-2 relative transition-colors shrink-0 ${tier.enableMaxFailed ? "bg-[#D4AF37] border-[#D4AF37]" : "bg-white/10 border-white/20"}`}
                  data-testid={`toggle-enable-max-failed-${tier.tempId}`}>
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-transform ${tier.enableMaxFailed ? "bg-[#0A1628] translate-x-4" : "bg-white/40 translate-x-0.5"}`} />
                </button>
                <div>
                  <p className={`text-xs font-semibold ${tier.enableMaxFailed ? "text-[#D4AF37]" : "text-white/40"}`}>Rule 1 — Max Failed Subjects in a Term</p>
                  <p className="text-[10px] text-white/30 mt-0.5">Student is retained if they fail ≥ N subjects in <span className="italic">any</span> of the configured terms below.</p>
                </div>
              </div>

              {tier.enableMaxFailed && (
                <div className="space-y-2 pl-1">
                  <p className="text-xs text-white/50">Configure per-term fail thresholds. Student is retained if <span className="text-white/70 font-medium">any</span> row is triggered.</p>

                  {/* Dynamic term rows */}
                  {tier.maxFailedRules.map((rule, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2 bg-[#0A1628]/60 rounded-md px-3 py-2 border border-white/10">
                      {/* Term picker */}
                      <div className="w-48 shrink-0">
                        <TermSelect
                          value={rule.term}
                          onChange={v => {
                            const next = tier.maxFailedRules.map((r, i) => i === idx ? { ...r, term: v } : r);
                            setField("maxFailedRules", next);
                          }}
                          terms={termNames}
                          placeholder="— pick term —"
                          testId={`select-max-failed-term-${tier.tempId}-${idx}`}
                        />
                      </div>

                      {/* Fail count */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs text-white/40">≥</span>
                        <Input
                          type="number" min="0" max="99"
                          value={rule.failCount}
                          onChange={e => {
                            const next = tier.maxFailedRules.map((r, i) => i === idx ? { ...r, failCount: e.target.value } : r);
                            setField("maxFailedRules", next);
                          }}
                          className="bg-[#0A1628] border-white/20 text-white text-sm h-8 w-16"
                          data-testid={`input-max-failed-count-${tier.tempId}-${idx}`}
                        />
                        <span className="text-xs text-white/40">subjects failed → retain</span>
                      </div>

                      {/* Remove button — only shown when more than one row exists */}
                      {tier.maxFailedRules.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = tier.maxFailedRules.filter((_, i) => i !== idx);
                            setField("maxFailedRules", next);
                          }}
                          className="ml-auto shrink-0 text-red-400/70 hover:text-red-400 text-[10px] font-semibold px-2 py-0.5 rounded border border-red-400/20 hover:border-red-400/40 transition-colors"
                          data-testid={`btn-remove-max-failed-rule-${tier.tempId}-${idx}`}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}

                  {/* + Add Term */}
                  <button
                    type="button"
                    onClick={() => setField("maxFailedRules", [...tier.maxFailedRules, { term: "", failCount: "3" }])}
                    className="flex items-center gap-1.5 text-[#D4AF37] text-xs font-semibold hover:text-yellow-300 transition-colors mt-1"
                    data-testid={`btn-add-max-failed-rule-${tier.tempId}`}>
                    <span className="text-base leading-none">+</span> Add Term
                  </button>
                </div>
              )}
            </div>

            {/* Rule 2 — Min Attendance % */}
            <div className={`rounded-md border p-3 space-y-3 transition-colors ${tier.enableAttendanceRule ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/10 bg-[#1A2942]/40"}`}>
              <div className="flex items-center gap-3">
                <button type="button"
                  onClick={() => setField("enableAttendanceRule", !tier.enableAttendanceRule)}
                  className={`w-9 h-5 rounded-full border-2 relative transition-colors shrink-0 ${tier.enableAttendanceRule ? "bg-emerald-500 border-emerald-500" : "bg-white/10 border-white/20"}`}
                  data-testid={`toggle-enable-attendance-${tier.tempId}`}>
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-transform ${tier.enableAttendanceRule ? "bg-[#0A1628] translate-x-4" : "bg-white/40 translate-x-0.5"}`} />
                </button>
                <div>
                  <p className={`text-xs font-semibold ${tier.enableAttendanceRule ? "text-emerald-400" : "text-white/40"}`}>Rule 2 — Minimum Attendance %</p>
                  <p className="text-[10px] text-white/30 mt-0.5">Student is retained if attendance in <span className="italic">any</span> configured term falls below the threshold.</p>
                </div>
              </div>

              {tier.enableAttendanceRule && (
                <div className="space-y-2 pl-1">
                  <p className="text-xs text-white/50">Configure per-term attendance thresholds. Student is retained if <span className="text-white/70 font-medium">any</span> row is triggered.</p>

                  {tier.attendanceRules.map((rule, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2 bg-[#0A1628]/60 rounded-md px-3 py-2 border border-white/10">
                      <div className="w-48 shrink-0">
                        <TermSelect
                          value={rule.term}
                          onChange={v => {
                            const next = tier.attendanceRules.map((r, i) => i === idx ? { ...r, term: v } : r);
                            setField("attendanceRules", next);
                          }}
                          terms={termNames}
                          placeholder="— pick term —"
                          testId={`select-attendance-term-${tier.tempId}-${idx}`}
                        />
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs text-white/40">&lt;</span>
                        <Input
                          type="number" min="0" max="100"
                          value={rule.minPct}
                          onChange={e => {
                            const next = tier.attendanceRules.map((r, i) => i === idx ? { ...r, minPct: e.target.value } : r);
                            setField("attendanceRules", next);
                          }}
                          className="bg-[#0A1628] border-white/20 text-white text-sm h-8 w-16"
                          data-testid={`input-attendance-pct-${tier.tempId}-${idx}`}
                        />
                        <span className="text-xs text-white/40">% attendance → retain</span>
                      </div>

                      {tier.attendanceRules.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setField("attendanceRules", tier.attendanceRules.filter((_, i) => i !== idx))}
                          className="ml-auto shrink-0 text-red-400/70 hover:text-red-400 text-[10px] font-semibold px-2 py-0.5 rounded border border-red-400/20 hover:border-red-400/40 transition-colors"
                          data-testid={`btn-remove-attendance-rule-${tier.tempId}-${idx}`}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => setField("attendanceRules", [...tier.attendanceRules, { term: "", minPct: "75" }])}
                    className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold hover:text-emerald-300 transition-colors mt-1"
                    data-testid={`btn-add-attendance-rule-${tier.tempId}`}>
                    <span className="text-base leading-none">+</span> Add Term
                  </button>
                </div>
              )}
            </div>

            {/* Rule 3 — Minimum Term Weighted Average */}
            <div className={`rounded-md border p-3 space-y-3 transition-colors ${tier.enableTermAvgRule ? "border-purple-500/30 bg-purple-500/5" : "border-white/10 bg-[#1A2942]/40"}`}>
              <div className="flex items-center gap-3">
                <button type="button"
                  onClick={() => setField("enableTermAvgRule", !tier.enableTermAvgRule)}
                  className={`w-9 h-5 rounded-full border-2 relative transition-colors shrink-0 ${tier.enableTermAvgRule ? "bg-purple-500 border-purple-500" : "bg-white/10 border-white/20"}`}
                  data-testid={`toggle-enable-term-avg-${tier.tempId}`}>
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-transform ${tier.enableTermAvgRule ? "bg-white translate-x-4" : "bg-white/40 translate-x-0.5"}`} />
                </button>
                <div>
                  <p className={`text-xs font-semibold ${tier.enableTermAvgRule ? "text-purple-300" : "text-white/40"}`}>Rule 3 — Minimum Term Weighted Average Score</p>
                  <p className="text-[10px] text-white/30 mt-0.5">Student is retained if the weighted average score for the selected term falls below the configured pass percentage threshold.</p>
                </div>
              </div>
              {tier.enableTermAvgRule && (
                <div className="pl-1 space-y-1.5">
                  <label className="text-[10px] text-white/50 uppercase tracking-wide">Minimum Term Pass % Required</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min="0" max="100"
                      value={tier.termAvgMinPct}
                      onChange={e => setField("termAvgMinPct", e.target.value)}
                      placeholder="35"
                      className="bg-[#0A1628] border-white/20 text-white text-sm h-8 w-16"
                      data-testid={`input-term-avg-min-pct-${tier.tempId}`}
                    />
                    <span className="text-xs text-white/40">%</span>
                    <span className="text-[10px] text-white/30 italic">Students with term average below this are retained.</span>
                  </div>
                </div>
              )}
            </div>

            {/* Rule 4 — Minimum Cumulative Percentage (only available when Section C cumulative is ON) */}
            {tier.cumulativeEnabled ? (
              <div className={`rounded-md border p-3 space-y-3 transition-colors ${tier.cumulativePromotionEnabled ? "border-blue-500/30 bg-blue-500/5" : "border-white/10 bg-[#1A2942]/40"}`}>
                <div className="flex items-center gap-3">
                  <button type="button"
                    onClick={() => setField("cumulativePromotionEnabled", !tier.cumulativePromotionEnabled)}
                    className={`w-9 h-5 rounded-full border-2 relative transition-colors shrink-0 ${tier.cumulativePromotionEnabled ? "bg-blue-500 border-blue-500" : "bg-white/10 border-white/20"}`}
                    data-testid={`toggle-enable-cumul-promotion-${tier.tempId}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-transform ${tier.cumulativePromotionEnabled ? "bg-white translate-x-4" : "bg-white/40 translate-x-0.5"}`} />
                  </button>
                  <div>
                    <p className={`text-xs font-semibold ${tier.cumulativePromotionEnabled ? "text-blue-300" : "text-white/40"}`}>Rule 4 — Minimum Cumulative Percentage</p>
                    <p className="text-[10px] text-white/30 mt-0.5">Student is retained if their year-end cumulative percentage across all weighted terms falls below the minimum required threshold.</p>
                  </div>
                </div>
                {tier.cumulativePromotionEnabled && (
                  <div className="pl-1 space-y-1.5">
                    <label className="text-[10px] text-white/50 uppercase tracking-wide">Minimum Cumulative Percentage Required</label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min="0" max="100"
                        value={tier.cumulativeMinPercent}
                        onChange={e => setField("cumulativeMinPercent", e.target.value)}
                        placeholder="35"
                        className="bg-[#0A1628] border-white/20 text-white text-sm h-8 w-16"
                        data-testid={`input-cumul-min-pct-${tier.tempId}`}
                      />
                      <span className="text-xs text-white/40">%</span>
                      <span className="text-[10px] text-white/30 italic">Applies only on the cumulative trigger term.</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-white/10 bg-[#1A2942]/40 p-3 flex items-center gap-3 opacity-50">
                <div className="w-9 h-5 rounded-full border-2 border-white/20 bg-white/10 shrink-0 relative">
                  <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white/40 translate-x-0.5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-white/30">Rule 4 — Minimum Cumulative Percentage</p>
                  <p className="text-[10px] text-white/20 mt-0.5">Enable Cumulative Aggregation in Section C to unlock this rule.</p>
                </div>
              </div>
            )}

            {!tier.enableMaxFailed && !tier.enableAttendanceRule && !tier.enableTermAvgRule && !tier.cumulativePromotionEnabled && (
              <p className="text-xs text-red-400/70 italic">⚠ Enable at least one retention rule before saving.</p>
            )}
          </div>

          {/* Section C: Results Panel Configuration */}
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-blue-300">Section C — Results Panel Configuration</p>
              <p className="text-xs text-white/40 mt-0.5">
                Configure which columns appear in the Teacher Results sheet. Every term from Section A must be configured before saving.
              </p>
            </div>

            {termNames.length === 0 ? (
              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/30 italic">
                Define target terms in Section A first — they will appear here as term buttons to configure.
              </div>
            ) : (
              <>
                {/* Term selector — dropdown + per-term status badges */}
                <div className="space-y-2">
                  <label className="text-[11px] text-white/50 font-medium uppercase tracking-wide">Select Term to Configure</label>
                  <select
                    value={sectionCTerm}
                    onChange={e => {
                      const termName = e.target.value;
                      setSectionCTerm(termName);
                      if (termName && !tier.termColumnConfigs[termName]) {
                        const freshConfigs: Record<string, TermColsLocal> = {};
                        for (const [k, v] of Object.entries(tier.termColumnConfigs)) {
                          freshConfigs[k] = { ...v };
                        }
                        freshConfigs[termName] = defaultTermCols();
                        onChange({ ...tier, termColumnConfigs: freshConfigs });
                      }
                    }}
                    className="w-full h-10 rounded-lg border border-white/20 bg-[#1A2942] text-sm px-3 text-white appearance-none cursor-pointer focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30"
                    style={{ colorScheme: "dark" }}
                    data-testid={`select-section-c-term-${tier.tempId}`}>
                    <option value="" className="bg-[#1A2942] text-white/40">— choose a term to configure —</option>
                    {termNames.map(n => (
                      <option key={n} value={n} className="bg-[#1A2942] text-white">{n}</option>
                    ))}
                  </select>
                  {/* Per-term status badges */}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {termNames.map(termName => {
                      const isConfigured = !!tier.termColumnConfigs[termName];
                      return (
                        <span key={termName} className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border">
                          <span className={isConfigured ? "text-emerald-300" : "text-white/50"}>{termName}:</span>
                          {isConfigured ? (
                            <span className="flex items-center gap-0.5 text-emerald-400 font-bold">
                              <Check className="w-2.5 h-2.5" /> Done
                            </span>
                          ) : (
                            <span className="text-amber-400 font-bold">● Pending</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Column toggles for selected term */}
                {sectionCTerm && tier.termColumnConfigs[sectionCTerm] && (
                  <div className="rounded-md border border-blue-400/20 bg-[#0A1628] p-3 space-y-2.5">
                    <p className="text-[11px] font-semibold text-blue-300/80">
                      Configuring columns for: <span className="text-blue-200">{sectionCTerm}</span>
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {([
                        { key: "studentProfile" as keyof TermColsLocal, label: "Student Profile (Avatar · Roll · Name · ID)" },
                        { key: "weightedAvg" as keyof TermColsLocal, label: "Term Weighted Average Score" },
                        { key: "termGrade" as keyof TermColsLocal, label: "Term Grade (based on weighted score)" },
                        { key: "subjectFails" as keyof TermColsLocal, label: "Subject Fails Count" },
                        { key: "attendance" as keyof TermColsLocal, label: "Attendance Meter" },
                        { key: "promotionGate" as keyof TermColsLocal, label: "Promotion Gate Verdict" },
                        { key: "reportCard" as keyof TermColsLocal, label: "Detailed Report Card Trigger Button" },
                        { key: "cumulativeTotal" as keyof TermColsLocal, label: "Cumulative Total % (Combined Terms)" },
                        { key: "finalGrade" as keyof TermColsLocal, label: "Final Cumulative Grade" },
                      ]).map(({ key, label }) => {
                        const isOn = tier.termColumnConfigs[sectionCTerm][key];
                        return (
                          <button key={key} type="button"
                            onClick={() => {
                              // Deep-copy every entry to prevent any shared-reference bleed between terms
                              const freshConfigs: Record<string, TermColsLocal> = {};
                              for (const [k, v] of Object.entries(tier.termColumnConfigs)) {
                                freshConfigs[k] = k === sectionCTerm
                                  ? { ...v, [key]: !isOn }
                                  : { ...v };
                              }
                              onChange({ ...tier, termColumnConfigs: freshConfigs });
                            }}
                            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors text-xs ${isOn ? "border-blue-500/40 bg-blue-500/10 text-blue-200" : "border-white/10 bg-[#1A2942] text-white/40 hover:border-white/20"}`}
                            data-testid={`toggle-col-${key}-${tier.tempId}`}>
                            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${isOn ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
                              {isOn && <Check className="w-2.5 h-2.5 text-white" />}
                            </span>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Cumulative aggregation setup — only shown when the currently-selected term has cumulative columns ON */}
                {currentTermCumulativeEnabled && (
                  <div className="rounded-md border border-blue-400/20 bg-[#0A1628] p-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <button type="button"
                        onClick={() => {
                          const enabling = !tier.cumulativeEnabled;
                          const autoWeights = enabling && tier.cumulativeTermWeights.length === 0
                            ? termNames.map(n => ({ termName: n, weight: "" }))
                            : tier.cumulativeTermWeights;
                          onChange({ ...tier, cumulativeEnabled: enabling, cumulativeTermWeights: autoWeights });
                        }}
                        className={`w-9 h-5 rounded-full border-2 relative transition-colors shrink-0 ${tier.cumulativeEnabled ? "bg-blue-500 border-blue-500" : "bg-white/10 border-white/20"}`}
                        data-testid={`toggle-cumulative-${tier.tempId}`}>
                        <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-transform ${tier.cumulativeEnabled ? "bg-white translate-x-4" : "bg-white/40 translate-x-0.5"}`} />
                      </button>
                      <div>
                        <p className={`text-xs font-semibold ${tier.cumulativeEnabled ? "text-blue-300" : "text-white/40"}`}>Enable Cumulative Aggregation</p>
                        <p className="text-[10px] text-white/30">Combine multiple term scores into a year-end cumulative percentage.</p>
                      </div>
                    </div>

                    {tier.cumulativeEnabled && (
                      <div className="space-y-3 pl-1">
                        <div className="space-y-1">
                          <label className="text-[10px] text-white/50 uppercase tracking-wide">Cumulative Trigger Term</label>
                          <p className="text-[10px] text-white/30">Cumulative columns appear only when teacher selects this term.</p>
                          <TermSelect
                            value={tier.cumulativeTriggerTerm}
                            onChange={v => setField("cumulativeTriggerTerm", v)}
                            terms={termNames}
                            placeholder="— pick year-end term —"
                            testId={`select-cumulative-trigger-${tier.tempId}`}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-white/50 uppercase tracking-wide">Term Contribution Weights (must sum to 100%)</label>
                            <button type="button"
                              onClick={() => setField("cumulativeTermWeights", [...tier.cumulativeTermWeights, { termName: "", weight: "" }])}
                              className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                              data-testid={`btn-add-cumul-weight-${tier.tempId}`}>
                              <Plus className="w-3 h-3" /> Add term
                            </button>
                          </div>
                          {tier.cumulativeTermWeights.length === 0 && (
                            <p className="text-[10px] text-white/30 italic">No weights configured. Click "Add term" or toggle off and on to auto-fill from Section A.</p>
                          )}
                          {tier.cumulativeTermWeights.map((tw, wi) => (
                            <div key={wi} className="flex items-center gap-2">
                              <div className="flex-1">
                                {termNames.length > 0 ? (
                                  <select value={tw.termName}
                                    onChange={e => {
                                      const updated = tier.cumulativeTermWeights.map((w, i) => i === wi ? { ...w, termName: e.target.value } : w);
                                      setField("cumulativeTermWeights", updated);
                                    }}
                                    className="h-7 w-full rounded border border-white/20 bg-[#1A2942] text-xs px-2 text-white appearance-none cursor-pointer focus:outline-none focus:border-blue-500/60"
                                    style={{ colorScheme: "dark" }}
                                    data-testid={`select-cumul-term-${tier.tempId}-${wi}`}>
                                    <option value="" className="bg-[#1A2942] text-white/40">— pick term —</option>
                                    {termNames.map(n => <option key={n} value={n} className="bg-[#1A2942] text-white">{n}</option>)}
                                  </select>
                                ) : (
                                  <Input value={tw.termName}
                                    onChange={e => {
                                      const updated = tier.cumulativeTermWeights.map((w, i) => i === wi ? { ...w, termName: e.target.value } : w);
                                      setField("cumulativeTermWeights", updated);
                                    }}
                                    placeholder="Term name"
                                    className="bg-[#1A2942] border-white/20 text-white text-xs h-7"
                                    data-testid={`input-cumul-term-${tier.tempId}-${wi}`} />
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Input type="number" min="0" max="100" value={tw.weight}
                                  onChange={e => {
                                    const updated = tier.cumulativeTermWeights.map((w, i) => i === wi ? { ...w, weight: e.target.value } : w);
                                    setField("cumulativeTermWeights", updated);
                                  }}
                                  placeholder="0"
                                  className="bg-[#1A2942] border-white/20 text-white text-xs h-7 w-16"
                                  data-testid={`input-cumul-weight-${tier.tempId}-${wi}`} />
                                <span className="text-[10px] text-white/40">%</span>
                                <button type="button"
                                  onClick={() => setField("cumulativeTermWeights", tier.cumulativeTermWeights.filter((_, i) => i !== wi))}
                                  className="text-red-400/60 hover:text-red-400 transition-colors p-0.5"
                                  data-testid={`btn-remove-cumul-weight-${tier.tempId}-${wi}`}>
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                          {tier.cumulativeTermWeights.length > 0 && (() => {
                            const total = tier.cumulativeTermWeights.reduce((s, tw) => s + (parseFloat(tw.weight) || 0), 0);
                            const ok = Math.abs(total - 100) < 0.01;
                            return (
                              <div className="flex items-center justify-between pt-0.5">
                                <p className="text-[10px] text-blue-300/60 italic">
                                  Formula: {tier.cumulativeTermWeights.filter(tw => tw.termName).map(tw => `(${tw.termName} × ${tw.weight || "?"}%)`).join(" + ")}
                                </p>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ok ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                  {total.toFixed(1)}% / 100%
                                </span>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Rule 4 minimum % is configured in Section B above */}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Validation banner — shown when any term is still pending */}
          {pendingTermNames.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
              <span>
                Please configure the Results Panel Layout for all terms before saving.{" "}
                <span className="font-semibold text-amber-200">Missing: {pendingTermNames.join(", ")}</span>
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-1">
            <Button onClick={onSave}
              disabled={isSaving || pendingTermNames.length > 0 || termNames.length === 0}
              size="sm"
              className={`font-semibold h-9 transition-all duration-300 ${
                justSaved
                  ? "bg-emerald-500 hover:bg-emerald-600 text-white border-0"
                  : "bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628]"
              } disabled:opacity-50`}
              data-testid={`btn-save-exam-policy-${tier.tempId}`}>
              {justSaved ? (
                <><Check className="w-3.5 h-3.5 mr-1.5" /> Policy Saved!</>
              ) : isSaving ? (
                "Saving…"
              ) : (
                <><Save className="w-3.5 h-3.5 mr-1.5" /> Save Policy</>
              )}
            </Button>
            <Button onClick={onDelete} size="sm" variant="ghost"
              className="text-red-400/70 hover:text-red-400 hover:bg-red-400/10 h-9"
              data-testid={`btn-del-exam-policy-${tier.tempId}`}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SchoolSetup({ schoolId, section, onNavigateSection }: Props) {
  const { toast } = useToast();
  const [classes, setClasses] = useState<string[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [examTypes, setExamTypes] = useState<string[]>([]);
  const [classSections, setClassSections] = useState<Record<string, string[]>>({});
  const [classSubjects, setClassSubjects] = useState<Record<string, string[]>>({});
  const [classExamTypes, setClassExamTypes] = useState<Record<string, string[]>>({});
  const [classInput, setClassInput] = useState("");
  const [sectionInput, setSectionInput] = useState("");
  const [subjectInput, setSubjectInput] = useState("");
  const [examInput, setExamInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [tiers, setTiers] = useState<TierLocal[]>([]);
  const [policyLoaded, setPolicyLoaded] = useState(false);
  const [savingTierId, setSavingTierId] = useState<string | null>(null);
  const [policyErrors, setPolicyErrors] = useState<string[]>([]);
  const [leavePolicies, setLeavePolicies] = useState<LeavePolicyLocal[]>([]);
  const [savingPolicyIdx, setSavingPolicyIdx] = useState<number | null>(null);
  const [examPolicyTierList, setExamPolicyTierList] = useState<ExamPolicyTierLocal[]>([]);
  const [examPolicyLoaded, setExamPolicyLoaded] = useState(false);
  const [savingExamPolicyId, setSavingExamPolicyId] = useState<string | null>(null);
  const [savedExamPolicyId, setSavedExamPolicyId] = useState<string | null>(null);
  const [examPolicyErrors, setExamPolicyErrors] = useState<string[]>([]);

  const { data: meta } = useQuery({
    queryKey: ["/api/school-metadata", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/school-metadata/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [], exam_types: [] };
    },
    enabled: !!schoolId,
  });

  const { data: policyData } = useQuery({
    queryKey: ["/api/admin/grading-tiers"],
    queryFn: async () => {
      const r = await fetch("/api/admin/grading-tiers", { credentials: "include" });
      return r.ok ? r.json() : { tiers: [], rules: [] };
    },
    enabled: !!schoolId,
  });

  const { data: leavePolicyData } = useQuery<LeavePolicyServerData[]>({
    queryKey: ["/api/admin/leave-policies"],
    queryFn: async () => {
      const r = await fetch("/api/admin/leave-policies", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: examPolicyData } = useQuery<any[]>({
    queryKey: ["/api/admin/exam-policy-tiers"],
    queryFn: async () => {
      const r = await fetch("/api/admin/exam-policy-tiers", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  useEffect(() => {
    if (meta && !loaded) {
      setClasses(meta.classes || []);
      setSections(meta.sections || []);
      setSubjects(meta.subjects || []);
      setExamTypes(meta.exam_types || []);
      const raw = meta as unknown as Record<string, unknown>;
      const cs = raw.class_sections;
      if (cs && typeof cs === "object" && !Array.isArray(cs)) {
        setClassSections(cs as Record<string, string[]>);
      }
      const csu = raw.class_subjects;
      if (csu && typeof csu === "object" && !Array.isArray(csu)) {
        setClassSubjects(csu as Record<string, string[]>);
      }
      const cet = raw.class_exam_types;
      if (cet && typeof cet === "object" && !Array.isArray(cet)) {
        setClassExamTypes(cet as Record<string, string[]>);
      }
      setLoaded(true);
    }
  }, [meta, loaded]);

  useEffect(() => {
    if (!leavePolicyData) return;
    setLeavePolicies(prev => {
      const editingIds = new Set(prev.filter(p => p.editing && p.id).map(p => p.id));
      const unsavedNew = prev.filter(p => p.editing && !p.id);
      const fromServer = leavePolicyData
        .filter(p => !editingIds.has(p.id))
        .map((p: LeavePolicyServerData) => ({
          id: p.id, name: p.name, annualLimit: String(p.annualLimit),
          targetRoles: p.targetRoles, renewalMonth: String(p.renewalMonth),
          renewalDay: String(p.renewalDay), expiryBehavior: p.expiryBehavior,
          isActive: p.isActive, editing: false,
        }));
      const editingExisting = prev.filter(p => p.editing && p.id && editingIds.has(p.id));
      return [...fromServer, ...editingExisting, ...unsavedNew];
    });
  }, [leavePolicyData]);

  useEffect(() => {
    if (policyData && !policyLoaded) {
      const { tiers: dbTiers, rules: dbRules } = policyData as { tiers: any[]; rules: any[] };
      setTiers(dbTiers.map((t: any) => ({
        id: t.id, tempId: String(t.id), name: t.name,
        classes: t.classes || [],
        passPercentage: String(t.passPercentage),
        gradingSystem: (t.gradingSystem as "percentage" | "grade" | "both") || "percentage",
        passingGrades: t.passingGrades || [],
        sortOrder: t.sortOrder,
        expanded: false,
        rules: dbRules.filter((r: any) => r.tierId === t.id).map((r: any) => ({
          gradeLabel: r.gradeLabel, minPercent: String(r.minPercent),
          maxPercent: String(r.maxPercent), gradePoint: r.gradePoint, remarks: r.remarks,
        })),
      })));
      setPolicyLoaded(true);
    }
  }, [policyData, policyLoaded]);

  useEffect(() => {
    if (examPolicyData && !examPolicyLoaded) {
      setExamPolicyTierList(examPolicyData.map((t: any) => {
        let weights: Record<string, { source_exam: string; weight: number }[]> = {};
        try { weights = JSON.parse(t.examWeights || "{}"); } catch {}
        let rules: any = {};
        try { rules = JSON.parse(t.promotionFailRules || "{}"); } catch {}
        let rc: any = {};
        try { rc = JSON.parse(t.resultsConfig || "{}"); } catch {}
        const targetTerms: TargetTermLocal[] = Object.entries(weights).map(([name, comps]) => ({
          targetName: name,
          components: (comps as any[]).map(c => ({ sourceExam: c.source_exam ?? "", weight: String(c.weight ?? "") })),
        }));
        const r1 = rules.rule1 ?? {};
        const cumul = rc.cumulative ?? {};
        // Parse per-term column configs — new format only (termConfigs).
        // Deep-copy each entry individually to guarantee no shared references between terms.
        // Legacy (rc.columns) is intentionally NOT migrated: admin must configure each term fresh.
        const termColumnConfigs: Record<string, TermColsLocal> = {};
        if (rc.termConfigs && typeof rc.termConfigs === "object") {
          for (const [termKey, v] of Object.entries(rc.termConfigs)) {
            const tc = v as Record<string, unknown>;
            termColumnConfigs[termKey] = {
              studentProfile: tc.studentProfile !== false,
              weightedAvg: tc.weightedAvg !== false,
              termGrade: tc.termGrade !== false,
              subjectFails: tc.subjectFails !== false,
              attendance: tc.attendance !== false,
              promotionGate: tc.promotionGate !== false,
              reportCard: tc.reportCard !== false,
              cumulativeTotal: tc.cumulativeTotal === true,
              finalGrade: tc.finalGrade === true,
            };
          }
        }
        return {
          id: t.id,
          tempId: String(t.id),
          tierName: t.tierName,
          applicableClasses: t.applicableClasses || [],
          targetTerms: targetTerms.length > 0 ? targetTerms : [emptyTargetTerm()],
          enableMaxFailed: r1.enabled !== false,
          maxFailedRules: Array.isArray(r1.rules) && r1.rules.length > 0
            ? r1.rules.map((r: any) => ({ term: r.term ?? "", failCount: String(r.fail_count ?? 3) }))
            : [{ term: r1.term ?? "", failCount: String(r1.max_fails ?? rules.max_failed_subjects_final ?? 3) }],
          enableAttendanceRule: (rules as any).rule_attendance?.enabled === true,
          attendanceRules: Array.isArray((rules as any).rule_attendance?.rules) && (rules as any).rule_attendance.rules.length > 0
            ? (rules as any).rule_attendance.rules.map((r: any) => ({ term: r.term ?? "", minPct: String(r.min_pct ?? 75) }))
            : [{ term: "", minPct: "75" }],
          expanded: false,
          termColumnConfigs,
          cumulativeEnabled: cumul.enabled === true,
          cumulativeTriggerTerm: cumul.triggerTerm ?? "",
          cumulativeTermWeights: Object.entries(cumul.termWeights ?? {}).map(([termName, w]) => ({ termName, weight: String(w) })),
          cumulativePromotionEnabled: cumul.promotionEnabled === true,
          cumulativeMinPercent: cumul.minPercent !== undefined ? String(cumul.minPercent) : "35",
          enableTermAvgRule: (rules as any).rule_term_avg?.enabled === true,
          termAvgMinPct: (rules as any).rule_term_avg?.minPct !== undefined ? String((rules as any).rule_term_avg.minPct) : "35",
        } as ExamPolicyTierLocal;
      }));
      setExamPolicyLoaded(true);
    }
  }, [examPolicyData, examPolicyLoaded]);

  const saveMutation = useMutation({
    mutationFn: async ({ key, values }: { key: string; values: string[] }) => {
      await apiRequest("PUT", `/api/school-metadata/${schoolId}/${key}`, { values });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "School configuration updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/school-metadata", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/school-config"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveClassSectionsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/school-metadata/${schoolId}/class-sections-map`, { classSections });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Class-section mapping updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/school-metadata", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/school-config"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveClassSubjectsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/school-metadata/${schoolId}/class-subjects-map`, { classSubjects });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Class-subject mapping updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/school-metadata", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/school-config"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveClassExamTypesMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/school-metadata/${schoolId}/class-exam-types-map`, { classExamTypes });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Class-exam-type mapping updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/school-metadata", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/school-config"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function toggleClassSection(cls: string, sec: string) {
    setClassSections(prev => {
      const current = prev[cls] || [];
      const updated = current.includes(sec)
        ? current.filter(s => s !== sec)
        : [...current, sec];
      return { ...prev, [cls]: updated };
    });
  }

  function toggleClassSubject(cls: string, sub: string) {
    setClassSubjects(prev => {
      const current = prev[cls] || [];
      const updated = current.includes(sub)
        ? current.filter(s => s !== sub)
        : [...current, sub];
      return { ...prev, [cls]: updated };
    });
  }

  function toggleClassExamType(cls: string, et: string) {
    setClassExamTypes(prev => {
      const current = prev[cls] || [];
      const updated = current.includes(et)
        ? current.filter(s => s !== et)
        : [...current, et];
      return { ...prev, [cls]: updated };
    });
  }

  const addTo = (arr: string[], set: (v: string[]) => void, val: string, setInput: (v: string) => void) => {
    const trimmed = val.trim();
    if (trimmed && !arr.includes(trimmed)) { set([...arr, trimmed]); setInput(""); }
  };
  const removeFrom = (arr: string[], set: (v: string[]) => void, val: string) => set(arr.filter(x => x !== val));

  const addTier = () => {
    const tempId = `new-${Date.now()}`;
    setTiers(prev => [...prev, {
      tempId, name: "", classes: [], passPercentage: "35",
      gradingSystem: "percentage", passingGrades: [],
      sortOrder: prev.length, expanded: true, rules: [],
    }]);
  };

  const addExamPolicyTierFn = () => setExamPolicyTierList(prev => [...prev, emptyExamPolicyTier()]);
  const updateExamPolicyTierFn = (tempId: string, updated: ExamPolicyTierLocal) => {
    setExamPolicyTierList(prev => prev.map(t => t.tempId === tempId ? updated : t));
    setExamPolicyErrors([]);
  };
  const saveExamPolicyTierFn = async (tier: ExamPolicyTierLocal) => {
    const errs = validateExamPolicyTiers([tier]);
    if (errs.length > 0) { setExamPolicyErrors(errs); return; }
    setExamPolicyErrors([]);
    setSavingExamPolicyId(tier.tempId);
    try {
      const examWeights: Record<string, { source_exam: string; weight: number }[]> = {};
      for (const term of tier.targetTerms) {
        if (term.targetName.trim()) {
          examWeights[term.targetName] = term.components.map(c => ({
            source_exam: c.sourceExam,
            weight: parseFloat(c.weight) || 0,
          }));
        }
      }
      const promotionFailRules = {
        rule1: {
          enabled: tier.enableMaxFailed,
          rules: tier.maxFailedRules.map(r => ({
            term: r.term,
            fail_count: parseInt(r.failCount) || 0,
          })),
        },
        rule_attendance: {
          enabled: tier.enableAttendanceRule,
          rules: tier.attendanceRules.map(r => ({
            term: r.term,
            min_pct: parseFloat(r.minPct) || 75,
          })),
        },
        rule_term_avg: {
          enabled: tier.enableTermAvgRule,
          minPct: parseFloat(tier.termAvgMinPct) || 35,
        },
      };
      const resultsConfig = {
        termConfigs: tier.termColumnConfigs,
        cumulative: {
          enabled: tier.cumulativeEnabled,
          triggerTerm: tier.cumulativeTriggerTerm,
          termWeights: Object.fromEntries(
            tier.cumulativeTermWeights.map(tw => [tw.termName, parseFloat(tw.weight) || 0])
          ),
          promotionEnabled: tier.cumulativePromotionEnabled,
          minPercent: parseFloat(tier.cumulativeMinPercent) || 35,
        },
      };
      const payload = {
        tierName: tier.tierName.trim(),
        applicableClasses: tier.applicableClasses,
        examWeights: JSON.stringify(examWeights),
        promotionFailRules: JSON.stringify(promotionFailRules),
        resultsConfig: JSON.stringify(resultsConfig),
      };
      if (tier.id) {
        const res = await apiRequest("PATCH", `/api/admin/exam-policy-tiers/${tier.id}`, payload);
        const updated = await res.json();
        setExamPolicyTierList(prev => prev.map(t => t.tempId === tier.tempId ? { ...t, id: updated.id } : t));
      } else {
        const res = await apiRequest("POST", "/api/admin/exam-policy-tiers", payload);
        const created = await res.json();
        setExamPolicyTierList(prev => prev.map(t => t.tempId === tier.tempId ? { ...t, id: created.id, tempId: String(created.id) } : t));
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/exam-policy-tiers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/exam-policy"] });
      toast({ title: "✓ Policy Saved", description: `"${tier.tierName.trim()}" has been saved securely.`, duration: 3000 });
      setSavedExamPolicyId(tier.tempId);
      setTimeout(() => setSavedExamPolicyId(prev => prev === tier.tempId ? null : prev), 2500);
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "An error occurred", variant: "destructive" });
    } finally {
      setSavingExamPolicyId(null);
    }
  };
  const deleteExamPolicyTierFn = async (tier: ExamPolicyTierLocal) => {
    if (tier.id) {
      try {
        await apiRequest("DELETE", `/api/admin/exam-policy-tiers/${tier.id}`, undefined);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/exam-policy-tiers"] });
        toast({ title: "Policy deleted" });
      } catch {
        toast({ title: "Delete failed", variant: "destructive" });
        return;
      }
    }
    setExamPolicyTierList(prev => prev.filter(t => t.tempId !== tier.tempId));
  };

  const updateTier = (tempId: string, updated: TierLocal) => {
    setTiers(prev => prev.map(t => t.tempId === tempId ? updated : t));
    setPolicyErrors([]);
  };

  const deleteTier = async (tier: TierLocal) => {
    if (tier.id) {
      try {
        await apiRequest("DELETE", `/api/admin/grading-tiers/${tier.id}`, undefined);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/grading-tiers"] });
        toast({ title: "Tier deleted" });
      } catch {
        toast({ title: "Delete failed", variant: "destructive" });
        return;
      }
    }
    setTiers(prev => prev.filter(t => t.tempId !== tier.tempId));
  };

  const saveTier = async (tier: TierLocal) => {
    const errors = validateTiers(tiers);
    if (errors.length > 0) { setPolicyErrors(errors); return; }
    setPolicyErrors([]);
    setSavingTierId(tier.tempId);
    try {
      const tierRes = await apiRequest("POST", "/api/admin/grading-tiers", {
        id: tier.id,
        name: tier.name.trim(),
        classes: tier.classes,
        passPercentage: parseInt(tier.passPercentage) || 35,
        gradingSystem: tier.gradingSystem,
        passingGrades: tier.passingGrades,
        sortOrder: tier.sortOrder,
      });
      const saved = await tierRes.json();
      await apiRequest("POST", `/api/admin/grading-rules/${saved.id}`,
        tier.rules.map((r, i) => ({
          gradeLabel: r.gradeLabel, minPercent: parseInt(r.minPercent),
          maxPercent: parseInt(r.maxPercent), gradePoint: r.gradePoint,
          remarks: r.remarks, sortOrder: i,
        }))
      );
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grading-tiers"] });
      setPolicyLoaded(false);
      toast({ title: "Tier saved", description: `"${tier.name}" updated successfully.` });
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "An error occurred", variant: "destructive" });
    } finally {
      setSavingTierId(null);
    }
  };

  // Sort configured classes by CLASS_ORDER position; custom names come after
  const classesList = [
    ...CLASS_ORDER.filter(c => classes.includes(c)),
    ...classes.filter(c => !CLASS_ORDER.includes(c)),
  ];

  const SETUP_SECTIONS = [
    { id: "classes",                label: "Classes",                   icon: Grid3X3,       color: "#D4AF37", desc: "Add and manage class names used across your school (e.g. LKG, 1–12)." },
    { id: "sections",               label: "Sections",                  icon: Grid3X3,       color: "#6366f1", desc: "Add and manage section labels assigned to each class (e.g. A, B, C)." },
    { id: "subjects",               label: "Subjects",                  icon: BookOpen,      color: "#10b981", desc: "Define the subjects taught in your school." },
    { id: "exam-types",             label: "Exam Types",                icon: FileText,      color: "#3b82f6", desc: "Define exam categories such as SA1, FA2, Half-Yearly, etc." },
    { id: "class-section-mapping",  label: "Class–Section Mapping",     icon: Grid3X3,       color: "#6366f1", desc: "Specify which sections are available for each class." },
    { id: "class-subject-mapping",  label: "Class–Subject Mapping",     icon: BookOpen,      color: "#10b981", desc: "Specify which subjects are taught in each class." },
    { id: "class-examtype-mapping", label: "Class–Exam Type Mapping",   icon: FileText,      color: "#D4AF37", desc: "Specify which exam types apply to each class." },
    { id: "grading",                label: "Academic Policy",           icon: GraduationCap, color: "#10b981", desc: "Define grading tiers, pass percentages, and grade brackets." },
    { id: "exam-policy",            label: "Exam & Promotion Policy",   icon: Scale,         color: "#D4AF37", desc: "Configure exam weighting formulas and promotion rules." },
    { id: "leave-policy",           label: "Leave Policy",              icon: CalendarClock, color: "#f59e0b", desc: "Set leave types, annual limits, renewal dates and expiry rules." },
    { id: "attendance-policy",      label: "Attendance Policy",         icon: Timer,         color: "#8b5cf6", desc: "Configure arrival time thresholds, grace periods, half-day cutoffs and attendance targets." },
  ];

  // ─── Landing page ───────────────────────────────────────────
  if (!section) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white">School Setup</h2>
          <p className="text-white/50 text-sm">Select a category to configure your school's master lists, mappings and policies.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {SETUP_SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => onNavigateSection?.(s.id)}
              className="rounded-xl border border-white/10 bg-[#1A2942] p-5 text-left hover:bg-[#243555] hover:border-white/20 transition-all"
              data-testid={`setup-tile-${s.id}`}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2.5 rounded-xl flex-shrink-0" style={{ background: `${s.color}18` }}>
                  <s.icon className="w-5 h-5" style={{ color: s.color }} />
                </div>
                <h3 className="font-bold text-white text-sm leading-tight pt-1">{s.label}</h3>
              </div>
              <p className="text-white/40 text-xs leading-relaxed mb-3">{s.desc}</p>
              <div className="flex items-center gap-1 text-xs font-semibold" style={{ color: s.color }}>
                Configure <ChevronRight className="w-3 h-3" />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ─── Per-section page ────────────────────────────────────────
  const sectionMeta = SETUP_SECTIONS.find(s => s.id === section);
  const SectionIcon = sectionMeta?.icon ?? Grid3X3;

  return (
    <div className="space-y-6">

      {/* Back button + section header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onNavigateSection?.(null)}
          className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/10 flex-shrink-0"
          data-testid="btn-setup-back"
        >
          <ChevronLeft className="w-4 h-4 text-white/60" />
        </button>
        {sectionMeta && (
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg" style={{ background: `${sectionMeta.color}18` }}>
              <SectionIcon className="w-4 h-4" style={{ color: sectionMeta.color }} />
            </div>
            <div>
              <p className="text-[10px] text-white/35 leading-none">School Setup</p>
              <h2 className="text-base font-bold text-white leading-tight mt-0.5">{sectionMeta.label}</h2>
            </div>
          </div>
        )}
      </div>

      {/* ─── classes ─── */}
      {section === "classes" && (
        <MetaSection title="Classes" icon={Grid3X3} items={classes} input={classInput} setInput={setClassInput}
          onAdd={() => addTo(classes, setClasses, classInput, setClassInput)}
          onRemove={v => removeFrom(classes, setClasses, v)}
          onSave={() => saveMutation.mutate({ key: "classes", values: classes })}
          testId="classes" isPending={saveMutation.isPending} />
      )}

      {/* ─── sections ─── */}
      {section === "sections" && (
        <MetaSection title="Sections" icon={Grid3X3} items={sections} input={sectionInput} setInput={setSectionInput}
          onAdd={() => addTo(sections, setSections, sectionInput, setSectionInput)}
          onRemove={v => removeFrom(sections, setSections, v)}
          onSave={() => saveMutation.mutate({ key: "sections", values: sections })}
          testId="sections" isPending={saveMutation.isPending} />
      )}

      {/* ─── subjects ─── */}
      {section === "subjects" && (
        <MetaSection title="Subjects" icon={BookOpen} items={subjects} input={subjectInput} setInput={setSubjectInput}
          onAdd={() => addTo(subjects, setSubjects, subjectInput, setSubjectInput)}
          onRemove={v => removeFrom(subjects, setSubjects, v)}
          onSave={() => saveMutation.mutate({ key: "subjects", values: subjects })}
          testId="subjects" isPending={saveMutation.isPending} />
      )}

      {/* ─── exam-types ─── */}
      {section === "exam-types" && (
        <MetaSection title="Exam Types" icon={FileText} items={examTypes} input={examInput} setInput={setExamInput}
          onAdd={() => addTo(examTypes, setExamTypes, examInput, setExamInput)}
          onRemove={v => removeFrom(examTypes, setExamTypes, v)}
          onSave={() => saveMutation.mutate({ key: "exam_types", values: examTypes })}
          testId="exam-types" isPending={saveMutation.isPending} />
      )}

      {/* ─── class-section-mapping ─── */}
      {section === "class-section-mapping" && (
        <div>
          <p className="text-white/40 text-xs mb-4">Define which sections belong to each class. Teachers will see only these sections when selecting a class.</p>
          {classes.length === 0 || sections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-white/30 text-sm">
              Configure classes and sections first, then return here to map them.
            </div>
          ) : (
            <div className="space-y-2">
              {classes.map(cls => (
                <div key={cls} className="rounded-xl border border-white/10 bg-[#1A2942] px-4 py-3 flex flex-wrap items-center gap-3">
                  <span className="text-white font-semibold text-sm w-20 shrink-0">Class {cls}</span>
                  <div className="flex flex-wrap gap-2 flex-1">
                    {sections.map(sec => {
                      const active = (classSections[cls] || []).includes(sec);
                      return (
                        <button
                          key={sec}
                          onClick={() => toggleClassSection(cls, sec)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                            active
                              ? "bg-[#6366f1] text-white border-[#6366f1]"
                              : "border-white/20 text-white/40 hover:border-white/50 hover:text-white/70"
                          }`}
                          data-testid={`btn-toggle-section-${cls}-${sec}`}
                        >
                          {sec}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                onClick={() => saveClassSectionsMutation.mutate()}
                disabled={saveClassSectionsMutation.isPending}
                className="mt-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-semibold h-9"
                data-testid="btn-save-class-sections"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {saveClassSectionsMutation.isPending ? "Saving…" : "Save Class-Section Mapping"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ─── class-subject-mapping ─── */}
      {section === "class-subject-mapping" && (
        <div>
          <p className="text-white/40 text-xs mb-4">Define which subjects are taught in each class. Teachers will see only these subjects when selecting a class.</p>
          {classes.length === 0 || subjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-white/30 text-sm">
              Configure classes and subjects first, then return here to map them.
            </div>
          ) : (
            <div className="space-y-2">
              {classes.map(cls => (
                <div key={cls} className="rounded-xl border border-white/10 bg-[#1A2942] px-4 py-3 flex flex-wrap items-center gap-3">
                  <span className="text-white font-semibold text-sm w-20 shrink-0">Class {cls}</span>
                  <div className="flex flex-wrap gap-2 flex-1">
                    {subjects.map(sub => {
                      const active = (classSubjects[cls] || []).includes(sub);
                      return (
                        <button
                          key={sub}
                          onClick={() => toggleClassSubject(cls, sub)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                            active
                              ? "bg-[#10b981] text-white border-[#10b981]"
                              : "border-white/20 text-white/40 hover:border-white/50 hover:text-white/70"
                          }`}
                          data-testid={`btn-toggle-subject-${cls}-${sub}`}
                        >
                          {sub}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                onClick={() => saveClassSubjectsMutation.mutate()}
                disabled={saveClassSubjectsMutation.isPending}
                className="mt-2 bg-[#10b981] hover:bg-emerald-600 text-white font-semibold h-9"
                data-testid="btn-save-class-subjects"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {saveClassSubjectsMutation.isPending ? "Saving…" : "Save Class-Subject Mapping"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ─── class-examtype-mapping ─── */}
      {section === "class-examtype-mapping" && (
        <div>
          <p className="text-white/40 text-xs mb-4">Define which exam types apply to each class. Teachers will see only these exam types when selecting a class.</p>
          {classes.length === 0 || examTypes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-white/30 text-sm">
              Configure classes and exam types first, then return here to map them.
            </div>
          ) : (
            <div className="space-y-2">
              {classes.map(cls => (
                <div key={cls} className="rounded-xl border border-white/10 bg-[#1A2942] px-4 py-3 flex flex-wrap items-center gap-3">
                  <span className="text-white font-semibold text-sm w-20 shrink-0">Class {cls}</span>
                  <div className="flex flex-wrap gap-2 flex-1">
                    {examTypes.map(et => {
                      const active = (classExamTypes[cls] || []).includes(et);
                      return (
                        <button
                          key={et}
                          onClick={() => toggleClassExamType(cls, et)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                            active
                              ? "bg-[#D4AF37] text-[#0A1628] border-[#D4AF37]"
                              : "border-white/20 text-white/40 hover:border-white/50 hover:text-white/70"
                          }`}
                          data-testid={`btn-toggle-examtype-${cls}-${et}`}
                        >
                          {et}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                onClick={() => saveClassExamTypesMutation.mutate()}
                disabled={saveClassExamTypesMutation.isPending}
                className="mt-2 bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold h-9"
                data-testid="btn-save-class-exam-types"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {saveClassExamTypesMutation.isPending ? "Saving…" : "Save Class-Exam Type Mapping"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ─── grading (Academic Policy) ─── */}
      {section === "grading" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <p className="text-white/40 text-xs flex-1 pt-0.5">
              Define grading tiers for different class ranges. The <span className="text-[#D4AF37]/80 font-medium">From Class</span> and <span className="text-[#D4AF37]/80 font-medium">To Class</span> dropdowns are populated from your saved Classes configuration.
            </p>
            <Button size="sm" onClick={addTier}
              className="bg-[#10b981] hover:bg-emerald-600 text-white font-semibold h-9 shrink-0"
              data-testid="btn-add-tier">
              <Plus className="w-4 h-4 mr-1" /> Add Tier
            </Button>
          </div>

          {policyErrors.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {policyErrors.map((e, i) => <p key={i} className="text-red-300 text-xs">{e}</p>)}
              </div>
            </div>
          )}

          {tiers.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/10 p-8 text-center">
              <GraduationCap className="w-8 h-8 mx-auto mb-2 text-white/20" />
              <p className="text-white/30 text-sm">No grading tiers configured yet.</p>
              <p className="text-white/20 text-xs mt-1">Click "Add Tier" to create your first grading group (e.g. Primary: Classes 1–5).</p>
            </div>
          )}

          <div className="space-y-3">
            {tiers.map(tier => (
              <TierAccordion
                key={tier.tempId}
                tier={tier}
                classesList={classesList}
                onChange={updated => updateTier(tier.tempId, updated)}
                onDelete={() => deleteTier(tier)}
                onSave={() => saveTier(tier)}
                isSaving={savingTierId === tier.tempId}
              />
            ))}
          </div>
        </div>
      )}

      {/* ─── exam-policy ─── */}
      {section === "exam-policy" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <p className="text-white/40 text-xs flex-1 pt-0.5">
              Configure how component exam scores are weighted into composite results, and define the subject-failure thresholds that gate student promotion.
            </p>
            <Button size="sm" onClick={addExamPolicyTierFn}
              className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold h-9 shrink-0"
              data-testid="btn-add-exam-policy-tier">
              <Plus className="w-4 h-4 mr-1" /> Add Policy
            </Button>
          </div>

          {examPolicyErrors.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {examPolicyErrors.map((e, i) => <p key={i} className="text-red-300 text-xs">{e}</p>)}
              </div>
            </div>
          )}

          {examPolicyTierList.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/10 p-8 text-center">
              <Scale className="w-8 h-8 mx-auto mb-2 text-white/20" />
              <p className="text-white/30 text-sm">No exam policy tiers configured yet.</p>
              <p className="text-white/20 text-xs mt-1">Click "Add Policy" to define how exams are weighted and how promotion is decided for each class group.</p>
            </div>
          )}

          <div className="space-y-3">
            {examPolicyTierList.map(tier => (
              <ExamPolicyTierAccordion
                key={tier.tempId}
                tier={tier}
                classesList={classesList}
                examTypesList={examTypes}
                onChange={updated => updateExamPolicyTierFn(tier.tempId, updated)}
                onDelete={() => deleteExamPolicyTierFn(tier)}
                onSave={() => saveExamPolicyTierFn(tier)}
                isSaving={savingExamPolicyId === tier.tempId}
                justSaved={savedExamPolicyId === tier.tempId}
              />
            ))}
          </div>
        </div>
      )}

      {/* ─── leave-policy ─── */}
      {section === "attendance-policy" && (
        <AttendancePolicySetup schoolId={schoolId} />
      )}

      {section === "leave-policy" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <p className="text-white/40 text-xs flex-1">Configure leave types, annual quotas, renewal dates and expiry rules for your school.</p>
            <Button size="sm" onClick={() => setLeavePolicies(prev => [...prev, emptyPolicy()])}
              className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold h-9 shrink-0"
              data-testid="btn-add-leave-policy">
              <Plus className="w-4 h-4 mr-1" /> Add Leave Type
            </Button>
          </div>

          {leavePolicies.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
              <CalendarClock className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-gray-500 text-sm">No leave types configured yet.</p>
              <p className="text-gray-400 text-xs mt-1">Click "Add Leave Type" to create your first leave policy (e.g. Sick Leave, 12 days).</p>
            </div>
          )}

          <div className="space-y-3">
            {leavePolicies.map((policy, idx) => (
              <div key={idx} className="rounded-xl border border-gray-200 bg-white overflow-hidden" data-testid={`leave-policy-card-${idx}`}>
                {!policy.editing ? (
                  <div className="flex items-center gap-3 px-5 py-4">
                    <div className="p-1.5 rounded-lg bg-[#D4AF37]/10">
                      <CalendarClock className="w-4 h-4 text-[#D4AF37]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{policy.name}</p>
                      <p className="text-gray-500 text-xs">
                        {policy.annualLimit} days/year · Renews {MONTHS[parseInt(policy.renewalMonth) - 1]} {policy.renewalDay} · {policy.expiryBehavior === "carry_forward" ? "Carry forward" : "Expires"} · {policy.isActive ? "Active" : "Inactive"}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setLeavePolicies(prev => prev.map((p, i) => i === idx ? { ...p, editing: true } : p))}
                      className="text-gray-500 hover:text-gray-900 h-8 text-xs" data-testid={`btn-edit-leave-policy-${idx}`}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      if (policy.id) {
                        try {
                          await apiRequest("DELETE", `/api/admin/leave-policies/${policy.id}`, undefined);
                          queryClient.invalidateQueries({ queryKey: ["/api/admin/leave-policies"] });
                          toast({ title: "Leave type deleted" });
                        } catch {
                          toast({ title: "Delete failed", variant: "destructive" });
                          return;
                        }
                      }
                      setLeavePolicies(prev => prev.filter((_, i) => i !== idx));
                    }} className="text-red-400 hover:text-red-600 h-8" data-testid={`btn-delete-leave-policy-${idx}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="p-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-gray-700 mb-1 block">Leave Type Name</label>
                        <Input value={policy.name} onChange={e => setLeavePolicies(prev => prev.map((p, i) => i === idx ? { ...p, name: e.target.value } : p))}
                          placeholder="e.g. Sick Leave" className="bg-white border-gray-300 text-gray-900 text-sm h-9"
                          data-testid={`input-leave-name-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700 mb-1 block">Annual Limit (days)</label>
                        <Input type="number" min={1} max={365} value={policy.annualLimit}
                          onChange={e => setLeavePolicies(prev => prev.map((p, i) => i === idx ? { ...p, annualLimit: e.target.value } : p))}
                          placeholder="12" className="bg-white border-gray-300 text-gray-900 text-sm h-9"
                          data-testid={`input-leave-limit-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700 mb-1 block">Renewal Month</label>
                        <select value={policy.renewalMonth}
                          onChange={e => setLeavePolicies(prev => prev.map((p, i) => i === idx ? { ...p, renewalMonth: e.target.value } : p))}
                          className="w-full h-9 rounded-md bg-white border border-gray-300 text-gray-900 text-sm px-3"
                          data-testid={`select-renewal-month-${idx}`}>
                          {MONTHS.map((m, mi) => <option key={mi} value={mi + 1}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700 mb-1 block">Renewal Day (1–28 for all months)</label>
                        <Input type="number" min={1} max={31} value={policy.renewalDay}
                          onChange={e => setLeavePolicies(prev => prev.map((p, i) => i === idx ? { ...p, renewalDay: e.target.value } : p))}
                          placeholder="1" className="bg-white border-gray-300 text-gray-900 text-sm h-9"
                          data-testid={`input-renewal-day-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700 mb-1 block">Expiry Behaviour</label>
                        <select value={policy.expiryBehavior}
                          onChange={e => setLeavePolicies(prev => prev.map((p, i) => i === idx ? { ...p, expiryBehavior: e.target.value } : p))}
                          className="w-full h-9 rounded-md bg-white border border-gray-300 text-gray-900 text-sm px-3"
                          data-testid={`select-expiry-${idx}`}>
                          <option value="expire">Expire unused days</option>
                          <option value="carry_forward">Carry forward unused days</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700 mb-1 block">Target Roles</label>
                        <select value={policy.targetRoles}
                          onChange={e => setLeavePolicies(prev => prev.map((p, i) => i === idx ? { ...p, targetRoles: e.target.value } : p))}
                          className="w-full h-9 rounded-md bg-white border border-gray-300 text-gray-900 text-sm px-3"
                          data-testid={`select-target-roles-${idx}`}>
                          <option value="all">All Staff</option>
                          <option value="teacher">Teaching Staff</option>
                          <option value="non_teaching">Non-Teaching Staff</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={policy.isActive}
                          onChange={e => setLeavePolicies(prev => prev.map((p, i) => i === idx ? { ...p, isActive: e.target.checked } : p))}
                          className="rounded" data-testid={`checkbox-active-${idx}`} />
                        <span className="text-xs text-gray-600 font-medium">Active</span>
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={savingPolicyIdx === idx}
                        className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold h-9"
                        data-testid={`btn-save-leave-policy-${idx}`}
                        onClick={async () => {
                          if (!policy.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
                          setSavingPolicyIdx(idx);
                          try {
                            const payload = {
                              name: policy.name.trim(),
                              annualLimit: parseInt(policy.annualLimit) || 12,
                              targetRoles: policy.targetRoles,
                              renewalMonth: parseInt(policy.renewalMonth) || 1,
                              renewalDay: parseInt(policy.renewalDay) || 1,
                              expiryBehavior: policy.expiryBehavior,
                              isActive: policy.isActive,
                            };
                            if (policy.id) {
                              await apiRequest("PATCH", `/api/admin/leave-policies/${policy.id}`, payload);
                              setLeavePolicies(prev => prev.map((p, i) => i === idx ? { ...p, editing: false } : p));
                            } else {
                              const res = await apiRequest("POST", "/api/admin/leave-policies", payload);
                              const created: LeavePolicyServerData = await res.json();
                              setLeavePolicies(prev => prev.map((p, i) => i === idx ? {
                                id: created.id, name: created.name, annualLimit: String(created.annualLimit),
                                targetRoles: created.targetRoles, renewalMonth: String(created.renewalMonth),
                                renewalDay: String(created.renewalDay), expiryBehavior: created.expiryBehavior,
                                isActive: created.isActive, editing: false,
                              } : p));
                            }
                            queryClient.invalidateQueries({ queryKey: ["/api/admin/leave-policies"] });
                            toast({ title: "Leave policy saved", description: `"${policy.name.trim()}" updated.` });
                          } catch (e) {
                            toast({ title: "Save failed", description: e instanceof Error ? e.message : "An error occurred", variant: "destructive" });
                          } finally {
                            setSavingPolicyIdx(null);
                          }
                        }}>
                        <Save className="w-3.5 h-3.5 mr-1.5" /> {savingPolicyIdx === idx ? "Saving…" : "Save"}
                      </Button>
                      {policy.id && (
                        <Button size="sm" variant="ghost"
                          className="text-gray-500 hover:text-gray-700 h-9"
                          onClick={() => setLeavePolicies(prev => prev.map((p, i) => i === idx ? { ...p, editing: false } : p))}>
                          Cancel
                        </Button>
                      )}
                      {!policy.id && (
                        <Button size="sm" variant="ghost"
                          className="text-red-400 hover:text-red-600 h-9"
                          onClick={() => setLeavePolicies(prev => prev.filter((_, i) => i !== idx))}>
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
