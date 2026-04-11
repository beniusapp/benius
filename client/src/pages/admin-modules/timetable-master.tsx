import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Save, Loader2, Lock, Grid3x3, X, Pencil, Trash2, Settings, Plus, Clock, Coffee,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number; classes: string[]; sections: string[]; subjects: string[] }

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

interface SlotEntry {
  id: number;
  teacherId: number;
  dayOfWeek: number;
  period: number;
  class: string;
  section: string;
  subject: string;
  teacherName: string;
}

interface SlotDraft {
  teacherId: number | null;
  subject: string;
}

type DraftMap = Record<string, SlotDraft | null>;

interface PopoverState {
  day: number;
  period: number;
  existing: SlotEntry | null;
}

interface StructureRow {
  id?: number;
  periodNumber: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  sortOrder: number;
}

type TabType = "schedule" | "structure" | "publish";

export default function TimetableMaster({ schoolId, classes, sections, subjects }: Props) {
  const { toast } = useToast();
  const CLASS_LIST = classes;
  const SECTION_LIST = sections;
  const SUBJECT_LIST = subjects;
  const hasConfig = CLASS_LIST.length > 0 && SUBJECT_LIST.length > 0;

  const [activeTab, setActiveTab] = useState<TabType>("schedule");

  // ── Schedule tab state ──
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [draftMap, setDraftMap] = useState<DraftMap>({});
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [popTeacher, setPopTeacher] = useState<string>("");
  const [popSubject, setPopSubject] = useState<string>("");

  // ── Structure tab state ──
  const [structClass, setStructClass] = useState("");
  const [structRows, setStructRows] = useState<StructureRow[]>([]);
  const [structDirty, setStructDirty] = useState(false);

  const { data: teachers = [] } = useQuery<{ id: number; fullName: string }[]>({
    queryKey: ["/api/schools", schoolId, "teachers"],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/teachers`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: classViewData, isLoading: gridLoading } = useQuery<{ entries: SlotEntry[]; structure: StructureRow[] }>({
    queryKey: ["/api/timetable/class-view", selectedClass, selectedSection],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/class-view?class=${selectedClass}&section=${selectedSection}`, { credentials: "include" });
      if (!r.ok) return { entries: [], structure: [] };
      return r.json();
    },
    enabled: !!selectedClass && !!selectedSection,
  });
  const gridEntries: SlotEntry[] = classViewData?.entries ?? [];
  const gridStructure: StructureRow[] = classViewData?.structure ?? [];

  // ── Structure query ──
  const { data: savedStructure = [], isLoading: structLoading } = useQuery<StructureRow[]>({
    queryKey: ["/api/timetable/structure", structClass],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/structure?class=${encodeURIComponent(structClass)}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!structClass,
    select: (data) => data.map((d: StructureRow, i: number) => ({ ...d, sortOrder: d.sortOrder ?? i })),
  });

  // When class changes in Structure tab, reset rows to saved structure
  const handleStructClassChange = (cls: string) => {
    setStructClass(cls);
    setStructDirty(false);
  };

  // Sync structRows when savedStructure loads
  const displayStructRows = structDirty ? structRows : savedStructure;

  function addRow(isBreak: boolean) {
    const existing = displayStructRows;
    const nextPeriod = isBreak ? 0 : (Math.max(0, ...existing.filter(r => !r.isBreak).map(r => r.periodNumber)) + 1);
    const newRow: StructureRow = {
      periodNumber: nextPeriod,
      label: isBreak ? "Break" : `Period ${nextPeriod}`,
      startTime: "",
      endTime: "",
      isBreak,
      sortOrder: existing.length,
    };
    setStructRows([...existing, newRow]);
    setStructDirty(true);
  }

  function removeRow(idx: number) {
    const updated = displayStructRows.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sortOrder: i }));
    setStructRows(updated);
    setStructDirty(true);
  }

  function updateRow(idx: number, field: keyof StructureRow, value: string | number | boolean) {
    const updated = [...displayStructRows];
    updated[idx] = { ...updated[idx], [field]: value };
    setStructRows(updated);
    setStructDirty(true);
  }

  function moveRow(idx: number, dir: -1 | 1) {
    const arr = [...displayStructRows];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    setStructRows(arr.map((r, i) => ({ ...r, sortOrder: i })));
    setStructDirty(true);
  }

  const saveStructMutation = useMutation({
    mutationFn: async () => {
      const rows = displayStructRows.map((r, i) => ({
        periodNumber: r.periodNumber,
        label: r.label,
        startTime: r.startTime,
        endTime: r.endTime,
        isBreak: r.isBreak,
        sortOrder: i,
      }));
      const res = await apiRequest("POST", "/api/timetable/structure", { class: structClass, rows });
      return (res as Response).json();
    },
    onSuccess: () => {
      toast({ title: "Structure saved", description: `Bell schedule for Class ${structClass} has been saved.`, className: "border-emerald-500 bg-emerald-900/30 text-emerald-100" });
      setStructDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/structure", structClass] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // ── Schedule tab logic ──
  const hasDraft = Object.keys(draftMap).length > 0;

  const getEffectiveSlot = useCallback((day: number, period: number): { teacherName: string; subject: string; isDraft: boolean; isDelete: boolean } | null => {
    const key = `${day}-${period}`;
    if (key in draftMap) {
      const draft = draftMap[key];
      if (draft === null) return { teacherName: "", subject: "", isDraft: true, isDelete: true };
      const t = teachers.find(t => t.id === draft.teacherId);
      return { teacherName: t?.fullName ?? "", subject: draft.subject, isDraft: true, isDelete: false };
    }
    const entry = gridEntries.find(e => e.dayOfWeek === day && e.period === period);
    if (!entry) return null;
    return { teacherName: entry.teacherName, subject: entry.subject, isDraft: false, isDelete: false };
  }, [draftMap, gridEntries, teachers]);

  function openPopover(day: number, period: number) {
    const key = `${day}-${period}`;
    const existing = gridEntries.find(e => e.dayOfWeek === day && e.period === period) ?? null;
    const draft = draftMap[key];
    if (draft !== undefined && draft !== null) {
      setPopTeacher(String(draft.teacherId ?? ""));
      setPopSubject(draft.subject);
    } else if (existing) {
      setPopTeacher(String(existing.teacherId));
      setPopSubject(existing.subject);
    } else {
      setPopTeacher("");
      setPopSubject("");
    }
    setPopover({ day, period, existing });
  }

  function applyPopoverChange(isDelete: boolean) {
    if (!popover) return;
    const key = `${popover.day}-${popover.period}`;
    if (isDelete) {
      setDraftMap(prev => ({ ...prev, [key]: null }));
    } else {
      if (!popTeacher || !popSubject) return;
      setDraftMap(prev => ({ ...prev, [key]: { teacherId: parseInt(popTeacher), subject: popSubject } }));
    }
    setPopover(null);
  }

  const saveMutation = useMutation({
    mutationFn: async (): Promise<{ saved: unknown[]; errors: string[] }> => {
      const changes = Object.entries(draftMap).map(([key, draft]) => {
        const [day, period] = key.split("-").map(Number);
        if (draft === null) {
          return { dayOfWeek: day, period, class: selectedClass, section: selectedSection, teacherId: null, subject: null, _delete: true };
        }
        return { dayOfWeek: day, period, class: selectedClass, section: selectedSection, teacherId: draft.teacherId, subject: draft.subject };
      });
      const res = await apiRequest("POST", "/api/timetable/admin/save-batch", { changes });
      return (res as Response).json();
    },
    onSuccess: (data: { saved: unknown[]; errors: string[] }) => {
      if (data.errors && data.errors.length > 0) {
        toast({ title: "Saved with warnings", description: data.errors.join("; "), variant: "destructive" });
      } else {
        toast({ title: "Timetable saved", description: `${data.saved?.length ?? 0} slot(s) updated for Class ${selectedClass}-${selectedSection}.`, className: "border-emerald-500 bg-emerald-900/30 text-emerald-100" });
      }
      setDraftMap({});
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/class-view", selectedClass, selectedSection] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  function discardDrafts() { setDraftMap({}); setPopover(null); }
  function handleClassChange(val: string) { setSelectedClass(val); setDraftMap({}); setPopover(null); }
  function handleSectionChange(val: string) { setSelectedSection(val); setDraftMap({}); setPopover(null); }

  if (!hasConfig) {
    return (
      <div className="space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Lock className="w-4 h-4 text-[#D4AF37]" />
            <h2 className="text-xl font-bold text-white">Timetable Master</h2>
          </div>
          <p className="text-white/50 text-sm">School-isolated · Source-of-Truth mode</p>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-900/15 p-8 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
            <Settings className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <p className="text-amber-300 font-semibold text-base mb-1">School configuration required</p>
            <p className="text-amber-200/70 text-sm max-w-sm">
              No classes or subjects have been defined yet.<br />
              Please configure them in <strong>School Settings → Metadata</strong> first.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" onClick={() => popover && setPopover(null)}>
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Lock className="w-4 h-4 text-[#D4AF37]" />
          <h2 className="text-xl font-bold text-white">Timetable Master</h2>
        </div>
        <p className="text-white/50 text-sm">School-isolated · Mon–Sat grid · Period Structure Builder</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#0F1E35] border border-white/10 w-fit">
        {([
          { id: "schedule", label: "Schedule Grid", icon: <Grid3x3 className="w-3.5 h-3.5" /> },
          { id: "structure", label: "Bell Structure", icon: <Clock className="w-3.5 h-3.5" /> },
          { id: "publish", label: "Publish", icon: <Lock className="w-3.5 h-3.5" /> },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`tab-${tab.id}`}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === tab.id
                ? "bg-[#D4AF37] text-[#0A1628] shadow-sm"
                : "text-white/50 hover:text-white hover:bg-white/5"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Schedule Grid ── */}
      {activeTab === "schedule" && (
        <div className="space-y-4">
          {/* Class/Section selector + Save bar */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs text-white/60 mb-1">Class</label>
              <Select value={selectedClass} onValueChange={handleClassChange}>
                <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-11" data-testid="select-view-class">
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {CLASS_LIST.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="block text-xs text-white/60 mb-1">Section</label>
              <Select value={selectedSection} onValueChange={handleSectionChange}>
                <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-11" data-testid="select-view-section">
                  <SelectValue placeholder="Section" />
                </SelectTrigger>
                <SelectContent>
                  {SECTION_LIST.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {hasDraft && (
              <div className="flex gap-2 ml-auto">
                <button onClick={discardDrafts} className="h-11 px-4 rounded-xl border border-white/20 text-white/70 hover:bg-white/5 text-sm font-medium flex items-center gap-2 transition-colors" data-testid="button-discard-changes">
                  <X className="w-4 h-4" /> Discard
                </button>
                <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="h-11 px-5 rounded-xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-60 text-white font-semibold text-sm flex items-center gap-2 transition-colors min-w-[130px] justify-center" data-testid="button-save-changes">
                  {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Changes
                </button>
              </div>
            )}
          </div>

          {hasDraft && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-900/20 border border-amber-500/30">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <p className="text-xs text-amber-300 font-medium">{Object.keys(draftMap).length} unsaved change(s) — click "Save Changes" to commit</p>
            </div>
          )}

          {!selectedClass || !selectedSection ? (
            <div className="rounded-xl border border-white/10 bg-[#1A2942] p-12 text-center">
              <Grid3x3 className="w-8 h-8 text-white/20 mx-auto mb-3" />
              <p className="text-white/40 text-sm">Select a Class and Section above to view and edit the timetable</p>
            </div>
          ) : gridLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#D4AF37]" /></div>
          ) : gridStructure.length === 0 ? (
            <div className="rounded-xl border border-blue-500/20 bg-blue-900/10 p-10 text-center space-y-3">
              <Settings className="w-8 h-8 text-blue-400/50 mx-auto" />
              <div>
                <p className="text-sm font-semibold text-blue-300">Bell schedule not configured</p>
                <p className="text-xs text-blue-200/50 mt-1 max-w-xs mx-auto">
                  Go to the "Bell Structure" tab to set up the period structure for Class {selectedClass} before assigning subjects.
                </p>
              </div>
            </div>
          ) : (
            <div className="relative overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full border-collapse text-sm min-w-[480px]">
                <thead>
                  <tr>
                    <th className="border-b border-r border-white/10 p-3 bg-[#0F1E35] text-xs font-semibold text-white/40 text-center w-12">P</th>
                    {DAY_NAMES.map((d, i) => (
                      <th key={i} className="border-b border-r border-white/10 p-3 bg-[#0F1E35] text-xs font-semibold text-white/60 text-center">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gridStructure.map((srow, sIdx) => {
                    const isBreakRow = srow.isBreak;
                    const p = srow.periodNumber;
                    return isBreakRow ? (
                      <tr key={sIdx}>
                        <td className="border-b border-r border-white/10 p-2 text-center text-xs bg-amber-900/10">
                          <div className="flex flex-col items-center gap-0.5">
                            <Coffee className="w-3 h-3 text-amber-400" />
                            <span className="font-semibold text-amber-300 text-[10px]">{srow.label || "Break"}</span>
                          </div>
                        </td>
                        {DAY_NAMES.map((_, di) => (
                          <td key={di} className="border-b border-r border-white/10 bg-amber-900/5 p-1">
                            <div className="rounded-lg min-h-[48px] flex items-center justify-center">
                              <span className="text-[10px] text-amber-300/25">{srow.label || "Break"}</span>
                            </div>
                          </td>
                        ))}
                      </tr>
                    ) : (
                    <tr key={sIdx}>
                      <td className="border-b border-r border-white/10 p-2 text-center text-xs font-bold text-white/40 bg-[#0F1E35]/50">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="font-bold text-white/60">P{p}</span>
                          {srow.startTime && srow.endTime && (
                            <span className="text-[8px] text-[#10b981]/60">{srow.startTime}–{srow.endTime}</span>
                          )}
                        </div>
                      </td>
                      {DAY_NAMES.map((_, dayIdx) => {
                        const slot = getEffectiveSlot(dayIdx, p);
                        const key = `${dayIdx}-${p}`;
                        const isPopoverOpen = popover?.day === dayIdx && popover?.period === p;
                        return (
                          <td key={dayIdx} className="border-b border-r border-white/10 relative p-1 min-w-[110px]" onClick={e => { e.stopPropagation(); openPopover(dayIdx, p); }}>
                            <div className={`rounded-lg p-2 min-h-[54px] flex flex-col justify-center cursor-pointer transition-colors ${
                              slot?.isDelete ? "bg-red-900/20 border border-red-500/30"
                              : slot?.isDraft ? "bg-amber-900/20 border border-amber-500/40"
                              : slot ? "bg-[#10b981]/10 border border-[#10b981]/30 hover:bg-[#10b981]/15"
                              : "bg-white/3 border border-transparent hover:border-white/15 hover:bg-white/5"
                            }`} data-testid={`cell-${dayIdx}-${p}`}>
                              {slot && !slot.isDelete ? (
                                <>
                                  <p className="text-[11px] font-bold text-white leading-tight truncate">{slot.subject}</p>
                                  <p className="text-[10px] text-white/50 truncate mt-0.5">{slot.teacherName}</p>
                                  {slot.isDraft && <span className="text-[9px] text-amber-400 font-semibold mt-0.5">unsaved</span>}
                                </>
                              ) : slot?.isDelete ? (
                                <p className="text-[10px] text-red-400 italic text-center">will delete</p>
                              ) : (
                                <span className="text-xs text-white/20 text-center block">—</span>
                              )}
                            </div>

                            {isPopoverOpen && (
                              <div className="absolute left-0 top-full z-50 w-64 bg-[#1A2942] border border-white/20 rounded-xl shadow-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-bold text-white">{DAY_NAMES[dayIdx]} · Period {p}</p>
                                  <button onClick={() => setPopover(null)} className="text-white/40 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                                </div>
                                <div>
                                  <label className="block text-xs text-white/50 mb-1">Teacher</label>
                                  <select value={popTeacher} onChange={e => setPopTeacher(e.target.value)} className="w-full h-11 px-2 rounded-lg bg-[#0A1628] border border-white/20 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#10b981]" data-testid={`select-pop-teacher-${dayIdx}-${p}`}>
                                    <option value="">Select teacher</option>
                                    {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-xs text-white/50 mb-1">Subject</label>
                                  <select value={popSubject} onChange={e => setPopSubject(e.target.value)} className="w-full h-11 px-2 rounded-lg bg-[#0A1628] border border-white/20 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#10b981]" data-testid={`select-pop-subject-${dayIdx}-${p}`}>
                                    <option value="">Select subject</option>
                                    {SUBJECT_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </div>
                                <div className="flex gap-2 pt-1">
                                  {(slot || (key in draftMap && draftMap[key] !== null)) && (
                                    <button onClick={() => applyPopoverChange(true)} className="h-11 px-3 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-900/20 text-xs font-semibold flex items-center gap-1" data-testid={`button-pop-delete-${dayIdx}-${p}`}>
                                      <Trash2 className="w-3 h-3" /> Clear
                                    </button>
                                  )}
                                  <button onClick={() => applyPopoverChange(false)} disabled={!popTeacher || !popSubject} className="flex-1 h-11 rounded-lg bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1" data-testid={`button-pop-apply-${dayIdx}-${p}`}>
                                    <Pencil className="w-3 h-3" /> Apply
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
          )}

          {hasDraft && selectedClass && selectedSection && (
            <div className="sticky bottom-4 flex justify-end">
              <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="h-12 px-6 rounded-2xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-60 text-white font-bold text-sm flex items-center gap-2 shadow-lg transition-colors" data-testid="button-save-changes-bottom">
                {saveMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                Save Changes
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Bell Structure ── */}
      {activeTab === "structure" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px] max-w-[240px]">
              <label className="block text-xs text-white/60 mb-1">Class</label>
              <Select value={structClass} onValueChange={handleStructClassChange}>
                <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-11" data-testid="select-struct-class">
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {CLASS_LIST.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {structClass && structDirty && (
              <div className="flex gap-2 ml-auto">
                <button onClick={() => { setStructRows(savedStructure); setStructDirty(false); }} className="h-11 px-4 rounded-xl border border-white/20 text-white/70 hover:bg-white/5 text-sm font-medium flex items-center gap-2 transition-colors" data-testid="button-struct-discard">
                  <X className="w-4 h-4" /> Discard
                </button>
                <button onClick={() => saveStructMutation.mutate()} disabled={saveStructMutation.isPending} className="h-11 px-5 rounded-xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-60 text-white font-semibold text-sm flex items-center gap-2 transition-colors min-w-[130px] justify-center" data-testid="button-struct-save">
                  {saveStructMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Structure
                </button>
              </div>
            )}
          </div>

          {!structClass ? (
            <div className="rounded-xl border border-white/10 bg-[#1A2942] p-12 text-center">
              <Clock className="w-8 h-8 text-white/20 mx-auto mb-3" />
              <p className="text-white/40 text-sm">Select a class to configure its daily period structure</p>
            </div>
          ) : structLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#D4AF37]" /></div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-white/40">Define the daily period schedule for Class {structClass} — teachers and students will see these times in their timetable view.</p>

              {/* Row list */}
              {displayStructRows.length === 0 && (
                <div className="rounded-xl border border-white/10 bg-[#1A2942] p-8 text-center">
                  <Clock className="w-7 h-7 text-white/20 mx-auto mb-2" />
                  <p className="text-white/40 text-sm">No periods defined yet. Add periods or breaks below.</p>
                </div>
              )}

              {displayStructRows.map((row, idx) => (
                <div key={idx} className={`rounded-xl border p-4 flex flex-wrap items-center gap-3 ${row.isBreak ? "bg-amber-900/10 border-amber-500/20" : "bg-[#1A2942] border-white/10"}`} data-testid={`struct-row-${idx}`}>
                  {/* Drag order buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveRow(idx, -1)} disabled={idx === 0} className="w-6 h-6 rounded text-white/30 hover:text-white disabled:opacity-20 text-xs flex items-center justify-center bg-white/5">▲</button>
                    <button onClick={() => moveRow(idx, 1)} disabled={idx === displayStructRows.length - 1} className="w-6 h-6 rounded text-white/30 hover:text-white disabled:opacity-20 text-xs flex items-center justify-center bg-white/5">▼</button>
                  </div>

                  {/* Break/Period badge */}
                  <div className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${row.isBreak ? "bg-amber-500/20 text-amber-300" : "bg-[#10b981]/20 text-[#10b981]"}`}>
                    {row.isBreak ? <Coffee className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                    {row.isBreak ? "Break" : `P${row.periodNumber}`}
                  </div>

                  {/* Label */}
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[10px] text-white/40 mb-0.5">Label</label>
                    <input
                      value={row.label}
                      onChange={e => updateRow(idx, "label", e.target.value)}
                      placeholder={row.isBreak ? "Lunch Break" : `Period ${row.periodNumber}`}
                      className="w-full h-9 px-2.5 rounded-lg bg-[#0A1628] border border-white/15 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#10b981] placeholder:text-white/25"
                      data-testid={`input-struct-label-${idx}`}
                    />
                  </div>

                  {/* Start Time */}
                  <div className="min-w-[100px]">
                    <label className="block text-[10px] text-white/40 mb-0.5">Start</label>
                    <input
                      type="time"
                      value={row.startTime}
                      onChange={e => updateRow(idx, "startTime", e.target.value)}
                      className="w-full h-9 px-2 rounded-lg bg-[#0A1628] border border-white/15 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#10b981]"
                      data-testid={`input-struct-start-${idx}`}
                    />
                  </div>

                  {/* End Time */}
                  <div className="min-w-[100px]">
                    <label className="block text-[10px] text-white/40 mb-0.5">End</label>
                    <input
                      type="time"
                      value={row.endTime}
                      onChange={e => updateRow(idx, "endTime", e.target.value)}
                      className="w-full h-9 px-2 rounded-lg bg-[#0A1628] border border-white/15 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#10b981]"
                      data-testid={`input-struct-end-${idx}`}
                    />
                  </div>

                  {/* If not break, period number */}
                  {!row.isBreak && (
                    <div className="min-w-[70px]">
                      <label className="block text-[10px] text-white/40 mb-0.5">Period #</label>
                      <input
                        type="number"
                        min={1}
                        value={row.periodNumber}
                        onChange={e => updateRow(idx, "periodNumber", parseInt(e.target.value) || 1)}
                        className="w-full h-9 px-2 rounded-lg bg-[#0A1628] border border-white/15 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#10b981]"
                        data-testid={`input-struct-period-${idx}`}
                      />
                    </div>
                  )}

                  {/* Delete */}
                  <button onClick={() => removeRow(idx)} className="ml-auto flex-shrink-0 w-9 h-9 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-900/20 flex items-center justify-center transition-colors" data-testid={`button-struct-delete-${idx}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Add buttons */}
              <div className="flex gap-3 pt-2">
                <button onClick={() => addRow(false)} className="h-11 px-4 rounded-xl border border-[#10b981]/40 text-[#10b981] hover:bg-[#10b981]/10 text-sm font-medium flex items-center gap-2 transition-colors" data-testid="button-add-period">
                  <Plus className="w-4 h-4" /> Add Period
                </button>
                <button onClick={() => addRow(true)} className="h-11 px-4 rounded-xl border border-amber-500/40 text-amber-400 hover:bg-amber-900/15 text-sm font-medium flex items-center gap-2 transition-colors" data-testid="button-add-break">
                  <Coffee className="w-4 h-4" /> Add Break
                </button>
              </div>

              {/* Sticky save */}
              {structDirty && (
                <div className="sticky bottom-4 flex justify-end pt-2">
                  <button onClick={() => saveStructMutation.mutate()} disabled={saveStructMutation.isPending} className="h-12 px-6 rounded-2xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-60 text-white font-bold text-sm flex items-center gap-2 shadow-lg transition-colors" data-testid="button-struct-save-bottom">
                    {saveStructMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    Save Structure
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "publish" && (
        <PublishTab schoolId={schoolId} />
      )}
    </div>
  );
}

function PublishTab({ schoolId }: { schoolId: number }) {
  const { toast } = useToast();

  const { data: statuses = [], isLoading, refetch } = useQuery<{ class: string; section: string; totalCount: number; draftCount: number; publishedCount: number }[]>({
    queryKey: ["/api/timetable/class-status"],
    queryFn: async () => {
      const r = await fetch("/api/timetable/class-status", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const publishMutation = useMutation({
    mutationFn: async ({ cls, section }: { cls: string; section: string }) => {
      const r = await fetch("/api/timetable/publish", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class: cls, section }),
      });
      if (!r.ok) throw new Error("Failed to publish");
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: "Published", description: data.message, className: "border-emerald-500 bg-emerald-900/30 text-emerald-100" });
      refetch();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to publish timetable", variant: "destructive" });
    },
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#D4AF37]" /></div>;

  if (statuses.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#1A2942] p-12 text-center">
        <Lock className="w-8 h-8 text-white/20 mx-auto mb-3" />
        <p className="text-white/40 text-sm">No timetable entries found. Add periods in the Schedule Grid tab first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white">Publish Timetable</h3>
          <p className="text-xs text-white/40 mt-0.5">Publish draft entries so teachers and students can view them</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {statuses.map(s => {
          const isFullyPublished = s.draftCount === 0 && s.publishedCount > 0;
          const hasUnpublished = s.draftCount > 0;
          return (
            <div key={`${s.class}-${s.section}`} className="rounded-xl border p-4 space-y-3"
              style={{ background: "#1A2942", borderColor: isFullyPublished ? "rgba(16,185,129,0.30)" : "rgba(255,255,255,0.08)" }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-white text-sm">Class {s.class} – {s.section}</p>
                  <p className="text-xs text-white/40 mt-0.5">{s.totalCount} total · {s.publishedCount} published · {s.draftCount} draft</p>
                </div>
                {isFullyPublished && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-900/30 text-emerald-400 border border-emerald-500/30">Live</span>
                )}
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5">
                <div className="bg-[#10b981] h-1.5 rounded-full transition-all"
                  style={{ width: s.totalCount > 0 ? `${Math.round((s.publishedCount / s.totalCount) * 100)}%` : "0%" }} />
              </div>
              {hasUnpublished && (
                <button
                  onClick={() => publishMutation.mutate({ cls: s.class, section: s.section })}
                  disabled={publishMutation.isPending}
                  className="w-full h-10 rounded-lg bg-[#D4AF37] hover:bg-[#c9a632] disabled:opacity-60 text-[#0A1628] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                  data-testid={`button-publish-${s.class}-${s.section}`}
                >
                  {publishMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                  Publish {s.draftCount} Draft{s.draftCount !== 1 ? "s" : ""}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
