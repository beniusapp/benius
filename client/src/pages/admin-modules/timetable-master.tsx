import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Save, Loader2, Lock, Grid3x3, Search, X, ChevronDown, Pencil, Trash2, BookOpen,
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

type DraftMap = Record<string, SlotDraft | null>; // key: `${day}-${period}`, null = delete

interface PopoverState {
  day: number;
  period: number;
  existing: SlotEntry | null;
}

export default function TimetableMaster({ schoolId, classes, sections, subjects }: Props) {
  const { toast } = useToast();

  const CLASS_LIST = classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"];
  const SECTION_LIST = sections.length > 0 ? sections : ["A","B","C","D"];
  const SUBJECT_LIST = subjects.length > 0 ? subjects : ["Math","Science","English","Hindi","Social Studies","Computer"];

  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [draftMap, setDraftMap] = useState<DraftMap>({});
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [popTeacher, setPopTeacher] = useState<string>("");
  const [popSubject, setPopSubject] = useState<string>("");

  const { data: teachers = [] } = useQuery<{ id: number; fullName: string }[]>({
    queryKey: ["/api/schools", schoolId, "teachers"],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/teachers`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const gridKey = selectedClass && selectedSection ? `${selectedClass}-${selectedSection}` : null;

  const { data: gridEntries = [], isLoading: gridLoading } = useQuery<SlotEntry[]>({
    queryKey: ["/api/timetable/class-view", selectedClass, selectedSection],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/class-view?class=${selectedClass}&section=${selectedSection}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!selectedClass && !!selectedSection,
  });

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
          return {
            dayOfWeek: day, period,
            class: selectedClass, section: selectedSection,
            teacherId: null, subject: null,
            _delete: true,
          };
        }
        return {
          dayOfWeek: day, period,
          class: selectedClass, section: selectedSection,
          teacherId: draft.teacherId, subject: draft.subject,
        };
      });
      const res = await apiRequest("POST", "/api/timetable/admin/save-batch", { changes });
      return (res as Response).json();
    },
    onSuccess: (data: { saved: unknown[]; errors: string[] }) => {
      if (data.errors && data.errors.length > 0) {
        toast({ title: "Saved with warnings", description: data.errors.join("; "), variant: "destructive" });
      } else {
        toast({ title: "Timetable saved", description: `${data.saved?.length ?? 0} slot(s) updated for Class ${selectedClass}-${selectedSection}.` });
      }
      setDraftMap({});
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/class-view", selectedClass, selectedSection] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  function discardDrafts() {
    setDraftMap({});
    setPopover(null);
  }

  function handleClassChange(val: string) {
    setSelectedClass(val);
    setDraftMap({});
    setPopover(null);
  }

  function handleSectionChange(val: string) {
    setSelectedSection(val);
    setDraftMap({});
    setPopover(null);
  }

  return (
    <div className="space-y-5" onClick={() => popover && setPopover(null)}>
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Lock className="w-4 h-4 text-[#D4AF37]" />
          <h2 className="text-xl font-bold text-white">Timetable Master</h2>
        </div>
        <p className="text-white/50 text-sm">School-isolated · Mon–Sat grid · Click any cell to edit</p>
      </div>

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
            <button
              onClick={discardDrafts}
              className="h-11 px-4 rounded-xl border border-white/20 text-white/70 hover:bg-white/5 text-sm font-medium flex items-center gap-2 transition-colors"
              data-testid="button-discard-changes"
            >
              <X className="w-4 h-4" /> Discard
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="h-11 px-5 rounded-xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-60 text-white font-semibold text-sm flex items-center gap-2 transition-colors min-w-[130px] justify-center"
              data-testid="button-save-changes"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          </div>
        )}
      </div>

      {/* Draft indicator */}
      {hasDraft && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-900/20 border border-amber-500/30">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <p className="text-xs text-amber-300 font-medium">{Object.keys(draftMap).length} unsaved change(s) — click "Save Changes" to commit</p>
        </div>
      )}

      {/* Grid */}
      {!selectedClass || !selectedSection ? (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] p-12 text-center">
          <Grid3x3 className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-white/40 text-sm">Select a Class and Section above to view and edit the timetable</p>
        </div>
      ) : gridLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#D4AF37]" /></div>
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full border-collapse text-sm min-w-[480px]">
            <thead>
              <tr>
                <th className="border-b border-r border-white/10 p-3 bg-[#0F1E35] text-xs font-semibold text-white/40 text-center w-12">P</th>
                {DAY_NAMES.map((d, i) => (
                  <th key={i} className="border-b border-r border-white/10 p-3 bg-[#0F1E35] text-xs font-semibold text-white/60 text-center">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERIODS.map(p => (
                <tr key={p}>
                  <td className="border-b border-r border-white/10 p-2 text-center text-xs font-bold text-white/40 bg-[#0F1E35]/50">
                    {p}
                  </td>
                  {DAY_NAMES.map((_, dayIdx) => {
                    const slot = getEffectiveSlot(dayIdx, p);
                    const key = `${dayIdx}-${p}`;
                    const isPopoverOpen = popover?.day === dayIdx && popover?.period === p;
                    return (
                      <td
                        key={dayIdx}
                        className="border-b border-r border-white/10 relative p-1 min-w-[110px]"
                        onClick={e => { e.stopPropagation(); openPopover(dayIdx, p); }}
                      >
                        <div
                          className={`rounded-lg p-2 min-h-[54px] flex flex-col justify-center cursor-pointer transition-colors ${
                            slot?.isDelete
                              ? "bg-red-900/20 border border-red-500/30"
                              : slot?.isDraft
                              ? "bg-amber-900/20 border border-amber-500/40"
                              : slot
                              ? "bg-[#10b981]/10 border border-[#10b981]/30 hover:bg-[#10b981]/15"
                              : "bg-white/3 border border-transparent hover:border-white/15 hover:bg-white/5"
                          }`}
                          data-testid={`cell-${dayIdx}-${p}`}
                        >
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

                        {/* Popover */}
                        {isPopoverOpen && (
                          <div
                            className="absolute left-0 top-full z-50 w-64 bg-[#1A2942] border border-white/20 rounded-xl shadow-2xl p-4 space-y-3"
                            onClick={e => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-white">{DAY_NAMES[dayIdx]} · Period {p}</p>
                              <button onClick={() => setPopover(null)} className="text-white/40 hover:text-white">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div>
                              <label className="block text-xs text-white/50 mb-1">Teacher</label>
                              <select
                                value={popTeacher}
                                onChange={e => setPopTeacher(e.target.value)}
                                className="w-full h-9 px-2 rounded-lg bg-[#0A1628] border border-white/20 text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#10b981]"
                                data-testid={`select-pop-teacher-${dayIdx}-${p}`}
                              >
                                <option value="">Select teacher</option>
                                {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-white/50 mb-1">Subject</label>
                              <select
                                value={popSubject}
                                onChange={e => setPopSubject(e.target.value)}
                                className="w-full h-9 px-2 rounded-lg bg-[#0A1628] border border-white/20 text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#10b981]"
                                data-testid={`select-pop-subject-${dayIdx}-${p}`}
                              >
                                <option value="">Select subject</option>
                                {SUBJECT_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div className="flex gap-2 pt-1">
                              {(slot || (key in draftMap && draftMap[key] !== null)) && (
                                <button
                                  onClick={() => applyPopoverChange(true)}
                                  className="h-8 px-3 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-900/20 text-xs font-semibold flex items-center gap-1"
                                  data-testid={`button-pop-delete-${dayIdx}-${p}`}
                                >
                                  <Trash2 className="w-3 h-3" /> Clear
                                </button>
                              )}
                              <button
                                onClick={() => applyPopoverChange(false)}
                                disabled={!popTeacher || !popSubject}
                                className="flex-1 h-8 rounded-lg bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1"
                                data-testid={`button-pop-apply-${dayIdx}-${p}`}
                              >
                                <Pencil className="w-3 h-3" /> Apply
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bottom save bar for easy mobile access */}
      {hasDraft && selectedClass && selectedSection && (
        <div className="sticky bottom-4 flex justify-end">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="h-12 px-6 rounded-2xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-60 text-white font-bold text-sm flex items-center gap-2 shadow-lg transition-colors"
            data-testid="button-save-changes-bottom"
          >
            {saveMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}
