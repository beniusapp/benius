import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X, Save, BookOpen, Grid3X3, FileText, ChevronDown, ChevronRight, Trash2, GraduationCap, AlertTriangle, CalendarClock, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number }

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

export default function SchoolSetup({ schoolId }: Props) {
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

  const saveMutation = useMutation({
    mutationFn: async ({ key, values }: { key: string; values: string[] }) => {
      await apiRequest("PUT", `/api/school-metadata/${schoolId}/${key}`, { values });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "School configuration updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/school-metadata", schoolId] });
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

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h2 className="text-xl font-bold text-white">School Setup</h2>
        <p className="text-white/50 text-sm">Configure master lists for classes, sections, subjects and exam types.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetaSection title="Classes" icon={Grid3X3} items={classes} input={classInput} setInput={setClassInput}
          onAdd={() => addTo(classes, setClasses, classInput, setClassInput)}
          onRemove={v => removeFrom(classes, setClasses, v)}
          onSave={() => saveMutation.mutate({ key: "classes", values: classes })}
          testId="classes" isPending={saveMutation.isPending} />
        <MetaSection title="Sections" icon={Grid3X3} items={sections} input={sectionInput} setInput={setSectionInput}
          onAdd={() => addTo(sections, setSections, sectionInput, setSectionInput)}
          onRemove={v => removeFrom(sections, setSections, v)}
          onSave={() => saveMutation.mutate({ key: "sections", values: sections })}
          testId="sections" isPending={saveMutation.isPending} />
        <MetaSection title="Subjects" icon={BookOpen} items={subjects} input={subjectInput} setInput={setSubjectInput}
          onAdd={() => addTo(subjects, setSubjects, subjectInput, setSubjectInput)}
          onRemove={v => removeFrom(subjects, setSubjects, v)}
          onSave={() => saveMutation.mutate({ key: "subjects", values: subjects })}
          testId="subjects" isPending={saveMutation.isPending} />
        <MetaSection title="Exam Types" icon={FileText} items={examTypes} input={examInput} setInput={setExamInput}
          onAdd={() => addTo(examTypes, setExamTypes, examInput, setExamInput)}
          onRemove={v => removeFrom(examTypes, setExamTypes, v)}
          onSave={() => saveMutation.mutate({ key: "exam_types", values: examTypes })}
          testId="exam-types" isPending={saveMutation.isPending} />
      </div>

      {/* ===== CLASS → SECTION ASSIGNMENT ===== */}
      <div className="pt-2">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#6366f1]/20">
            <Grid3X3 className="w-5 h-5 text-[#6366f1]" />
          </div>
          <div>
            <h3 className="font-bold text-white">Class-Section Mapping</h3>
            <p className="text-white/40 text-xs">Define which sections belong to each class. Teachers will see only these sections when selecting a class.</p>
          </div>
        </div>
        {classes.length === 0 || sections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-white/30 text-sm">
            Add classes and sections above first, then map them here.
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

      {/* ===== CLASS → SUBJECT ASSIGNMENT ===== */}
      <div className="pt-2">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#10b981]/20">
            <BookOpen className="w-5 h-5 text-[#10b981]" />
          </div>
          <div>
            <h3 className="font-bold text-white">Class-Subject Mapping</h3>
            <p className="text-white/40 text-xs">Define which subjects are taught in each class. Teachers will see only these subjects when selecting a class.</p>
          </div>
        </div>
        {classes.length === 0 || subjects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-white/30 text-sm">
            Add classes and subjects above first, then map them here.
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

      {/* ===== CLASS → EXAM TYPE ASSIGNMENT ===== */}
      <div className="pt-2">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#D4AF37]/20">
            <FileText className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div>
            <h3 className="font-bold text-white">Class-Exam Type Mapping</h3>
            <p className="text-white/40 text-xs">Define which exam types apply to each class. Teachers will see only these exam types when selecting a class.</p>
          </div>
        </div>
        {classes.length === 0 || examTypes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-white/30 text-sm">
            Add classes and exam types above first, then map them here.
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

      {/* ===== ACADEMIC POLICY ===== */}
      <div className="pt-2">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#10b981]/20">
            <GraduationCap className="w-5 h-5 text-[#10b981]" />
          </div>
          <div>
            <h3 className="font-bold text-white">Academic Policy</h3>
            <p className="text-white/40 text-xs">
              Define grading tiers for different class ranges. The <span className="text-[#D4AF37]/80 font-medium">From Class</span> and <span className="text-[#D4AF37]/80 font-medium">To Class</span> dropdowns are populated from your saved <span className="text-[#D4AF37]/80 font-medium">Classes</span> configuration above.
            </p>
          </div>
          <Button size="sm" onClick={addTier}
            className="ml-auto bg-[#10b981] hover:bg-emerald-600 text-white font-semibold h-9"
            data-testid="btn-add-tier">
            <Plus className="w-4 h-4 mr-1" /> Add Tier
          </Button>
        </div>

        {policyErrors.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 mb-3 flex gap-2">
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

      {/* ===== LEAVE POLICY ===== */}
      <div className="pt-2">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#D4AF37]/20">
            <CalendarClock className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div>
            <h3 className="font-bold text-white">Leave Policy</h3>
            <p className="text-white/40 text-xs">Configure leave types, annual quotas, renewal dates and expiry rules for your school.</p>
          </div>
          <Button size="sm" onClick={() => setLeavePolicies(prev => [...prev, emptyPolicy()])}
            className="ml-auto bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold h-9"
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
    </div>
  );
}
