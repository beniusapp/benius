import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X, Save, BookOpen, Grid3X3, FileText, ChevronDown, ChevronRight, Trash2, GraduationCap, AlertTriangle, CalendarClock } from "lucide-react";
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
  minClass: string;
  maxClass: string;
  passPercentage: string;
  sortOrder: number;
  expanded: boolean;
  rules: GradeRow[];
}

function emptyRule(): GradeRow { return { gradeLabel: "", minPercent: "", maxPercent: "", gradePoint: "", remarks: "" }; }

function validateTiers(tiers: TierLocal[]): string[] {
  const errors: string[] = [];
  for (const t of tiers) {
    if (!t.name.trim()) { errors.push(`A tier is missing a name.`); continue; }
    const minIdx = CLASS_ORDER.indexOf(t.minClass);
    const maxIdx = CLASS_ORDER.indexOf(t.maxClass);
    if (minIdx === -1 || maxIdx === -1) { errors.push(`"${t.name}": Invalid class selection.`); continue; }
    if (minIdx > maxIdx) { errors.push(`"${t.name}": Min class must be before Max class.`); continue; }
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
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i]; const b = tiers[j];
      const aMin = CLASS_ORDER.indexOf(a.minClass); const aMax = CLASS_ORDER.indexOf(a.maxClass);
      const bMin = CLASS_ORDER.indexOf(b.minClass); const bMax = CLASS_ORDER.indexOf(b.maxClass);
      if (aMin <= bMax && bMin <= aMax) {
        errors.push(`"${a.name}" and "${b.name}" have overlapping class ranges.`);
      }
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
  const setField = (field: keyof TierLocal, val: any) => onChange({ ...tier, [field]: val });
  const setRule = (idx: number, field: keyof GradeRow, val: string) => {
    const newRules = tier.rules.map((r, i) => i === idx ? { ...r, [field]: val } : r);
    onChange({ ...tier, rules: newRules });
  };
  const addRule = () => onChange({ ...tier, rules: [...tier.rules, emptyRule()] });
  const removeRule = (idx: number) => onChange({ ...tier, rules: tier.rules.filter((_, i) => i !== idx) });

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
            {tier.minClass && tier.maxClass ? `Classes ${tier.minClass} – ${tier.maxClass}` : "No range set"} &nbsp;·&nbsp; Pass: {tier.passPercentage || "?"}%
          </p>
        </div>
        <span className="text-xs text-white/40 mr-2">{tier.rules.length} grade{tier.rules.length !== 1 ? "s" : ""}</span>
        {tier.expanded ? <ChevronDown className="w-4 h-4 text-white/40 shrink-0" /> : <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />}
      </button>

      {tier.expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-white/10">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
            <div>
              <label className="text-xs text-white/50 mb-1 block">Tier Name</label>
              <Input value={tier.name} onChange={e => setField("name", e.target.value)}
                placeholder="e.g. Primary" className="bg-[#0A1628] border-white/20 text-white text-sm h-9"
                data-testid={`input-tier-name-${tier.tempId}`} />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Pass Percentage (%)</label>
              <Input type="number" min={0} max={100} value={tier.passPercentage}
                onChange={e => setField("passPercentage", e.target.value)}
                placeholder="35" className="bg-[#0A1628] border-white/20 text-white text-sm h-9"
                data-testid={`input-tier-pass-${tier.tempId}`} />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">From Class</label>
              <select value={tier.minClass} onChange={e => setField("minClass", e.target.value)}
                className="w-full h-9 rounded-md bg-[#0A1628] border border-white/20 text-white text-sm px-3"
                data-testid={`select-min-class-${tier.tempId}`}>
                <option value="">Select</option>
                {classesList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">To Class</label>
              <select value={tier.maxClass} onChange={e => setField("maxClass", e.target.value)}
                className="w-full h-9 rounded-md bg-[#0A1628] border border-white/20 text-white text-sm px-3"
                data-testid={`select-max-class-${tier.tempId}`}>
                <option value="">Select</option>
                {classesList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

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
        minClass: t.minClass, maxClass: t.maxClass,
        passPercentage: String(t.passPercentage), sortOrder: t.sortOrder,
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

  const addTo = (arr: string[], set: (v: string[]) => void, val: string, setInput: (v: string) => void) => {
    const trimmed = val.trim();
    if (trimmed && !arr.includes(trimmed)) { set([...arr, trimmed]); setInput(""); }
  };
  const removeFrom = (arr: string[], set: (v: string[]) => void, val: string) => set(arr.filter(x => x !== val));

  const addTier = () => {
    const tempId = `new-${Date.now()}`;
    setTiers(prev => [...prev, {
      tempId, name: "", minClass: "", maxClass: "", passPercentage: "35",
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
        minClass: tier.minClass,
        maxClass: tier.maxClass,
        passPercentage: parseInt(tier.passPercentage) || 35,
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

  const classesList = classes.length > 0
    ? CLASS_ORDER.filter(c => classes.includes(c))
    : CLASS_ORDER;

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

      {/* ===== ACADEMIC POLICY ===== */}
      <div className="pt-2">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#10b981]/20">
            <GraduationCap className="w-5 h-5 text-[#10b981]" />
          </div>
          <div>
            <h3 className="font-bold text-white">Academic Policy</h3>
            <p className="text-white/40 text-xs">Define grading tiers for different class ranges, each with its own pass mark and grade brackets.</p>
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
