import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Save, X, AlertTriangle, Search, BookOpen, Calendar, Pencil, Trash2, Plus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface TimetableEntry {
  id: number;
  dayOfWeek: number;
  period: number;
  class: string;
  section: string;
  subject: string;
  teacherId: number;
  teacherName?: string;
}

interface SlotDraft {
  class: string;
  section: string;
  subject: string;
}

type DraftMap = Record<string, SlotDraft | null>; // key: `${day}-${period}`, null = delete

interface ConflictInfo {
  dayOfWeek: number;
  period: number;
  teacherName: string;
  subject: string;
}

interface PopoverState {
  day: number;
  period: number;
  existing: TimetableEntry | null;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

const COMMON_SUBJECTS = [
  "Math", "Science", "English", "Hindi", "Social Studies", "Computer",
  "Physics", "Chemistry", "Biology", "History", "Geography", "Economics",
  "Bengali", "Sanskrit", "Physical Education", "Art", "Music",
];

const CLASS_LIST = ["1","2","3","4","5","6","7","8","9","10","11","12"];
const SECTION_LIST = ["A","B","C","D","E"];

export default function TimetableModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();

  // ── My Schedule state ──
  const [draftMap, setDraftMap] = useState<DraftMap>({});
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [popClass, setPopClass] = useState("");
  const [popSection, setPopSection] = useState("");
  const [popSubject, setPopSubject] = useState("");
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);

  // ── Class Explorer state ──
  const [explorerClass, setExplorerClass] = useState("");
  const [explorerSection, setExplorerSection] = useState("");

  // ── My Schedule query ──
  const { data: myEntries = [], isLoading } = useQuery<TimetableEntry[]>({
    queryKey: ["/api/timetable/teacher", teacher.id],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/teacher/${teacher.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  // ── Class Explorer query ──
  const { data: explorerEntries = [], isLoading: explorerLoading } = useQuery<TimetableEntry[]>({
    queryKey: ["/api/timetable/class-view", explorerClass, explorerSection],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/class-view?class=${explorerClass}&section=${explorerSection}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!explorerClass && !!explorerSection,
  });

  const hasDraft = Object.keys(draftMap).length > 0;

  const getEffectiveSlot = useCallback((day: number, period: number): { class: string; section: string; subject: string; isDraft: boolean; isDelete: boolean } | null => {
    const key = `${day}-${period}`;
    if (key in draftMap) {
      const draft = draftMap[key];
      if (draft === null) return { class: "", section: "", subject: "", isDraft: true, isDelete: true };
      return { ...draft, isDraft: true, isDelete: false };
    }
    const entry = myEntries.find(e => e.dayOfWeek === day && e.period === period);
    if (!entry) return null;
    return { class: entry.class, section: entry.section, subject: entry.subject, isDraft: false, isDelete: false };
  }, [draftMap, myEntries]);

  function openPopover(day: number, period: number) {
    const key = `${day}-${period}`;
    const existing = myEntries.find(e => e.dayOfWeek === day && e.period === period) ?? null;
    const draft = draftMap[key];
    if (draft !== undefined && draft !== null) {
      setPopClass(draft.class);
      setPopSection(draft.section);
      setPopSubject(draft.subject);
    } else if (existing) {
      setPopClass(existing.class);
      setPopSection(existing.section);
      setPopSubject(existing.subject);
    } else {
      setPopClass("");
      setPopSection("");
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
      if (!popClass || !popSection || !popSubject) return;
      setDraftMap(prev => ({ ...prev, [key]: { class: popClass, section: popSection, subject: popSubject } }));
    }
    setPopover(null);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const changes = Object.entries(draftMap).map(([key, draft]) => {
        const [day, period] = key.split("-").map(Number);
        if (draft === null) {
          return { dayOfWeek: day, period, class: "", section: "", subject: "", _delete: true };
        }
        return { dayOfWeek: day, period, class: draft.class, section: draft.section, subject: draft.subject };
      });
      const res = await apiRequest("POST", "/api/timetable/teacher/save-batch", { changes });
      return (res as Response).json() as Promise<{ saved: unknown[]; conflicts: ConflictInfo[] }>;
    },
    onSuccess: (data) => {
      const saved = data.saved ?? [];
      const newConflicts = data.conflicts ?? [];
      setConflicts(newConflicts);
      if (newConflicts.length > 0 && saved.length === 0) {
        toast({
          title: "Conflicts detected",
          description: `${newConflicts.length} slot(s) could not be saved. See conflict details below.`,
          variant: "destructive",
        });
      } else if (newConflicts.length > 0) {
        toast({
          title: `${saved.length} saved, ${newConflicts.length} conflict(s)`,
          description: "Some slots were skipped — see conflict banner below.",
          className: "border-amber-500 bg-amber-900/30 text-amber-100",
        });
      } else {
        toast({ title: "Schedule saved", description: `${saved.length} slot(s) updated.`, className: "border-emerald-500 bg-emerald-900/30 text-emerald-100" });
      }
      // Remove successfully saved/deleted from draft
      const conflictKeys = new Set(newConflicts.map(c => `${c.dayOfWeek}-${c.period}`));
      setDraftMap(prev => {
        const next: DraftMap = {};
        for (const [key, val] of Object.entries(prev)) {
          if (conflictKeys.has(key)) next[key] = val;
        }
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/teacher", teacher.id] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  function discardDrafts() {
    setDraftMap({});
    setConflicts([]);
    setPopover(null);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-16">
        <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="space-y-6" onClick={() => popover && setPopover(null)}>

      {/* ── Section 1: My Schedule ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2" data-testid="text-timetable-title">
              <Calendar className="w-4 h-4 text-[#10b981]" />
              My Schedule
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {myEntries.length} period(s) assigned · Click any cell to add or edit
            </p>
          </div>
          {hasDraft && (
            <div className="flex items-center gap-2">
              <button
                onClick={discardDrafts}
                className="h-10 px-3 rounded-xl border border-border text-muted-foreground hover:bg-muted text-sm font-medium flex items-center gap-1.5 transition-colors"
                data-testid="button-discard"
              >
                <X className="w-3.5 h-3.5" /> Discard
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="h-10 px-4 rounded-xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-60 text-white font-semibold text-sm flex items-center gap-1.5 transition-colors min-w-[130px] justify-center"
                data-testid="button-save-schedule"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          )}
        </div>

        {/* Draft indicator */}
        {hasDraft && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
              {Object.keys(draftMap).length} unsaved change(s) — click "Save Changes" to commit
            </p>
          </div>
        )}

        {/* Conflict banners */}
        {conflicts.length > 0 && (
          <div className="rounded-xl border border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/15 p-4 space-y-2" data-testid="conflict-banner">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">Slot conflicts detected</p>
            </div>
            {conflicts.map((c, i) => (
              <p key={i} className="text-xs text-red-600 dark:text-red-400 pl-6" data-testid={`conflict-item-${i}`}>
                {DAY_NAMES[c.dayOfWeek]} P{c.period}: already booked by <strong>{c.teacherName}</strong> for <strong>{c.subject}</strong>
              </p>
            ))}
          </div>
        )}

        {/* My Schedule grid */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-sm min-w-[540px]">
            <thead>
              <tr>
                <th className="border-b border-r border-border p-2.5 bg-muted text-xs font-semibold text-muted-foreground text-center w-12">P</th>
                {DAY_NAMES.map((d, i) => (
                  <th key={i} className="border-b border-r border-border p-2.5 bg-muted text-xs font-semibold text-muted-foreground text-center">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERIODS.map(p => (
                <tr key={p}>
                  <td className="border-b border-r border-border p-2 text-center text-xs font-bold text-muted-foreground bg-muted/40">
                    {p}
                  </td>
                  {DAY_NAMES.map((_, dayIdx) => {
                    const slot = getEffectiveSlot(dayIdx, p);
                    const key = `${dayIdx}-${p}`;
                    const isConflict = conflicts.some(c => c.dayOfWeek === dayIdx && c.period === p);
                    const isPopoverOpen = popover?.day === dayIdx && popover?.period === p;
                    return (
                      <td
                        key={dayIdx}
                        className="border-b border-r border-border relative p-1 min-w-[100px]"
                        onClick={e => { e.stopPropagation(); openPopover(dayIdx, p); }}
                      >
                        <div
                          className={`rounded-lg p-2 min-h-[54px] flex flex-col justify-center cursor-pointer transition-colors ${
                            isConflict
                              ? "bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700/50"
                              : slot?.isDelete
                              ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/30"
                              : slot?.isDraft
                              ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40"
                              : slot
                              ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                              : "border border-transparent hover:border-border hover:bg-muted/50 group"
                          }`}
                          data-testid={`cell-${dayIdx}-${p}`}
                        >
                          {slot && !slot.isDelete ? (
                            <>
                              <p className="text-[11px] font-bold text-gray-800 dark:text-white leading-tight truncate">{slot.subject}</p>
                              <p className="text-[10px] text-muted-foreground truncate mt-0.5">{slot.class}-{slot.section}</p>
                              {slot.isDraft && <span className="text-[9px] text-amber-500 font-semibold mt-0.5">unsaved</span>}
                              {isConflict && <span className="text-[9px] text-red-500 font-semibold mt-0.5">conflict</span>}
                            </>
                          ) : slot?.isDelete ? (
                            <p className="text-[10px] text-red-400 italic text-center">will delete</p>
                          ) : (
                            <Plus className="w-3.5 h-3.5 text-muted-foreground/30 mx-auto group-hover:text-[#10b981] transition-colors" />
                          )}
                        </div>

                        {/* Inline Popover */}
                        {isPopoverOpen && (
                          <div
                            className="absolute left-0 top-full z-50 w-64 bg-white dark:bg-slate-900 border border-border rounded-xl shadow-2xl p-4 space-y-3"
                            onClick={e => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-gray-900 dark:text-white">{DAY_NAMES[dayIdx]} · Period {p}</p>
                              <button onClick={() => setPopover(null)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground mb-1">Class</label>
                              <select
                                value={popClass}
                                onChange={e => setPopClass(e.target.value)}
                                className="w-full h-9 px-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                                data-testid={`select-pop-class-${dayIdx}-${p}`}
                              >
                                <option value="">Select class</option>
                                {CLASS_LIST.map(c => <option key={c} value={c}>Class {c}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground mb-1">Section</label>
                              <select
                                value={popSection}
                                onChange={e => setPopSection(e.target.value)}
                                className="w-full h-9 px-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                                data-testid={`select-pop-section-${dayIdx}-${p}`}
                              >
                                <option value="">Select section</option>
                                {SECTION_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground mb-1">Subject</label>
                              <select
                                value={popSubject}
                                onChange={e => setPopSubject(e.target.value)}
                                className="w-full h-9 px-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                                data-testid={`select-pop-subject-${dayIdx}-${p}`}
                              >
                                <option value="">Select subject</option>
                                {COMMON_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div className="flex gap-2 pt-1">
                              {(slot || (key in draftMap && draftMap[key] !== null)) && (
                                <button
                                  onClick={() => applyPopoverChange(true)}
                                  className="h-11 px-3 rounded-lg border border-red-200 dark:border-red-700/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs font-semibold flex items-center gap-1"
                                  data-testid={`button-pop-delete-${dayIdx}-${p}`}
                                >
                                  <Trash2 className="w-3 h-3" /> Remove
                                </button>
                              )}
                              <button
                                onClick={() => applyPopoverChange(false)}
                                disabled={!popClass || !popSection || !popSubject}
                                className="flex-1 h-11 rounded-lg bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1"
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

        {/* Sticky Save button at bottom for mobile */}
        {hasDraft && (
          <div className="sticky bottom-4 flex justify-end">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="h-12 px-6 rounded-2xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-60 text-white font-bold text-sm flex items-center gap-2 shadow-lg transition-colors"
              data-testid="button-save-bottom"
            >
              {saveMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              Save Changes
            </button>
          </div>
        )}
      </div>

      {/* ── Section 2: Class Explorer ── */}
      <div className="space-y-4 pt-2 border-t border-border">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Search className="w-4 h-4 text-[#10b981]" />
            Class Explorer
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">View any class's full timetable (read-only)</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[130px]">
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Class</label>
            <select
              value={explorerClass}
              onChange={e => setExplorerClass(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
              data-testid="select-explorer-class"
            >
              <option value="">Select class</option>
              {CLASS_LIST.map(c => <option key={c} value={c}>Class {c}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[110px]">
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Section</label>
            <select
              value={explorerSection}
              onChange={e => setExplorerSection(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
              data-testid="select-explorer-section"
            >
              <option value="">Select section</option>
              {SECTION_LIST.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {explorerClass && explorerSection && (
          explorerLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-[#10b981]" /></div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-sm min-w-[540px]">
                <thead>
                  <tr>
                    <th className="border-b border-r border-border p-2.5 bg-muted text-xs font-semibold text-muted-foreground text-center w-12">P</th>
                    {DAY_NAMES.map((d, i) => (
                      <th key={i} className="border-b border-r border-border p-2.5 bg-muted text-xs font-semibold text-muted-foreground text-center">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERIODS.map(p => (
                    <tr key={p}>
                      <td className="border-b border-r border-border p-2 text-center text-xs font-bold text-muted-foreground bg-muted/40">
                        {p}
                      </td>
                      {DAY_NAMES.map((_, dayIdx) => {
                        const entry = explorerEntries.find(e => e.dayOfWeek === dayIdx && e.period === p);
                        return (
                          <td key={dayIdx} className="border-b border-r border-border p-1 min-w-[100px]" data-testid={`explorer-cell-${dayIdx}-${p}`}>
                            {entry ? (
                              <div className="rounded-lg p-2 min-h-[48px] flex flex-col justify-center bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-700/30">
                                <p className="text-[11px] font-bold text-gray-800 dark:text-white leading-tight truncate">{entry.subject}</p>
                                <p className="text-[10px] text-muted-foreground truncate mt-0.5">{entry.teacherName || "—"}</p>
                              </div>
                            ) : (
                              <div className="rounded-lg p-2 min-h-[48px] flex items-center justify-center">
                                <span className="text-xs text-muted-foreground/30">—</span>
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
          )
        )}

        {!explorerClass && !explorerSection && (
          <div className="rounded-xl border border-border bg-muted/20 p-10 text-center">
            <BookOpen className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Select a class and section to view their timetable</p>
          </div>
        )}
      </div>
    </div>
  );
}
