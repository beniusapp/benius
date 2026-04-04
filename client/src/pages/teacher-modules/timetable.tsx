import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Plus, Trash2, ShieldCheck, AlertTriangle, RefreshCw, X, Edit3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface TimetableEntry {
  id: number; dayOfWeek: number; period: number; class: string; section: string;
  subject: string; status: string; room: string | null; teacherId: number;
}

interface TeacherAllocation {
  id: number; subject: string; class: string; section: string; weeklyQuota: number;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

interface SlotModalState {
  mode: "add" | "edit";
  dayOfWeek?: number;
  period?: number;
  entry?: TimetableEntry;
}

export default function TimetableModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [modal, setModal] = useState<SlotModalState | null>(null);
  const [conflictError, setConflictError] = useState<string>("");

  // Form state for modal
  const [formSubject, setFormSubject] = useState("");
  const [formClass, setFormClass] = useState("");
  const [formSection, setFormSection] = useState("");
  const [formRoom, setFormRoom] = useState("");
  const [formDay, setFormDay] = useState<number | "">("");
  const [formPeriod, setFormPeriod] = useState<number | "">("");

  const { data: entries = [], isLoading } = useQuery<TimetableEntry[]>({
    queryKey: ["/api/timetable/teacher", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/timetable/teacher/${teacher.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: allocations = [] } = useQuery<TeacherAllocation[]>({
    queryKey: ["/api/teacher-allocations/teacher", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/teacher-allocations/teacher/${teacher.id}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const uniqueClassSections = Array.from(new Set(allocations.map(a => `${a.class}-${a.section}`))).map(cs => {
    const [cls, sec] = cs.split("-");
    return { class: cls, section: sec };
  });

  const subjectsForClassSection = (cls: string, sec: string) =>
    allocations.filter(a => a.class === cls && a.section === sec).map(a => a.subject);

  function getEntry(day: number, period: number): TimetableEntry | undefined {
    return entries.find(e => e.dayOfWeek === day && e.period === period);
  }

  function openAddModal(day: number, period: number) {
    setModal({ mode: "add", dayOfWeek: day, period });
    setFormSubject(""); setFormClass(""); setFormSection(""); setFormRoom("");
    setFormDay(day); setFormPeriod(period);
    setConflictError("");
  }

  function openEditModal(entry: TimetableEntry) {
    setModal({ mode: "edit", entry });
    setFormSubject(entry.subject);
    setFormClass(entry.class);
    setFormSection(entry.section);
    setFormRoom(entry.room || "");
    setFormDay(entry.dayOfWeek);
    setFormPeriod(entry.period);
    setConflictError("");
  }

  function closeModal() {
    setModal(null);
    setConflictError("");
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/timetable/teacher-slot", {
        dayOfWeek: formDay, period: formPeriod,
        class: formClass, section: formSection,
        subject: formSubject, room: formRoom || undefined,
      });
      return res;
    },
    onSuccess: () => {
      toast({ title: "Slot Added", description: "Period added to your timetable (draft)." });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/teacher", teacher.id] });
      closeModal();
    },
    onError: (e: Error) => {
      setConflictError(e.message);
    },
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!modal?.entry) return;
      const res = await apiRequest("PATCH", `/api/timetable/${modal.entry.id}/teacher`, {
        dayOfWeek: formDay, period: formPeriod,
        class: formClass, section: formSection,
        subject: formSubject, room: formRoom || undefined,
      });
      return res;
    },
    onSuccess: () => {
      toast({ title: "Slot Updated", description: modal?.entry?.status === "published" ? "Reverted to draft — admin re-approval needed." : "Changes saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/teacher", teacher.id] });
      closeModal();
    },
    onError: (e: Error) => {
      setConflictError(e.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/timetable/${id}/teacher`);
    },
    onSuccess: () => {
      toast({ title: "Slot Removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/teacher", teacher.id] });
      closeModal();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSubmit = formSubject && formClass && formSection && formDay !== "" && formPeriod !== "";
  const currentSubjects = formClass && formSection ? subjectsForClassSection(formClass, formSection) : [];
  const isEditing = modal?.mode === "edit";
  const wasPublished = modal?.entry?.status === "published";

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2 className="w-7 h-7 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white" data-testid="text-timetable-title">
            My Weekly Timetable
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {entries.length} periods scheduled · Click any cell to add or edit
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 text-[#10b981]" />Published
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />Draft
          </div>
        </div>
      </div>

      {/* No allocations notice */}
      {allocations.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-500/30 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              No subject allocations assigned yet. Contact your administrator to get allocations set up before adding timetable slots.
            </p>
          </div>
        </div>
      )}

      {/* Timetable Grid */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm min-w-[600px]">
          <thead>
            <tr>
              <th className="border-b border-r border-border p-2.5 bg-muted text-xs font-semibold text-muted-foreground text-center w-16">Period</th>
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
                <td className="border-b border-r border-border p-2 text-center text-xs font-semibold text-muted-foreground bg-muted/40">
                  P{p}
                </td>
                {DAY_NAMES.map((_, dayIdx) => {
                  const entry = getEntry(dayIdx, p);
                  return (
                    <td
                      key={dayIdx}
                      className={`border-b border-r border-border p-1.5 text-center transition-colors min-w-[90px] ${
                        entry
                          ? "cursor-pointer hover:bg-emerald-50/70 dark:hover:bg-emerald-900/20"
                          : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 group"
                      }`}
                      onClick={() => entry ? openEditModal(entry) : (allocations.length > 0 && openAddModal(dayIdx, p))}
                      data-testid={`cell-${dayIdx}-${p}`}
                    >
                      {entry ? (
                        <div className="relative">
                          <div className={`rounded-lg p-1.5 text-left border ${
                            entry.status === "published"
                              ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/30"
                              : "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/30"
                          }`}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] font-bold text-gray-700 dark:text-white truncate">{entry.subject}</span>
                              {entry.status === "published"
                                ? <ShieldCheck className="w-3 h-3 text-[#10b981] flex-shrink-0" />
                                : <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                              }
                            </div>
                            <p className="text-[9px] text-muted-foreground">{entry.class}-{entry.section}</p>
                            {entry.room && <p className="text-[9px] text-muted-foreground truncate">📍{entry.room}</p>}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/40 group-hover:text-[#10b981] transition-colors">
                          {allocations.length > 0 ? <Plus className="w-3.5 h-3.5 mx-auto opacity-40 group-hover:opacity-100" /> : "–"}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Slot Modal ── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-border overflow-hidden"
            onClick={e => e.stopPropagation()}
            data-testid="modal-slot"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-[#10b981]/5">
              <div className="flex items-center gap-2">
                {isEditing ? <Edit3 className="w-4 h-4 text-[#10b981]" /> : <Plus className="w-4 h-4 text-[#10b981]" />}
                <p className="font-bold text-gray-900 dark:text-white text-sm">
                  {isEditing ? "Edit Slot" : `Add Slot — ${DAY_NAMES[modal.dayOfWeek!]} · P${modal.period}`}
                </p>
              </div>
              <button onClick={closeModal} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {/* Published warning */}
              {isEditing && wasPublished && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/30">
                  <RefreshCw className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    This slot is published. Editing will revert it to draft until the admin re-approves.
                  </p>
                </div>
              )}

              {/* Day + Period (only shown in edit modal for changing) */}
              {isEditing && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Day</label>
                    <select
                      value={formDay}
                      onChange={e => setFormDay(parseInt(e.target.value))}
                      className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                      data-testid="select-slot-day"
                    >
                      {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Period</label>
                    <select
                      value={formPeriod}
                      onChange={e => setFormPeriod(parseInt(e.target.value))}
                      className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                      data-testid="select-slot-period"
                    >
                      {PERIODS.map(p => <option key={p} value={p}>Period {p}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Class / Section */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Class & Section</label>
                {uniqueClassSections.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic px-1">No allocations assigned. Contact admin.</p>
                ) : (
                  <select
                    value={formClass && formSection ? `${formClass}-${formSection}` : ""}
                    onChange={e => {
                      const [c, s] = e.target.value.split("-");
                      setFormClass(c || ""); setFormSection(s || ""); setFormSubject("");
                    }}
                    className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                    data-testid="select-slot-class-section"
                  >
                    <option value="">Select class/section</option>
                    {uniqueClassSections.map(cs => (
                      <option key={`${cs.class}-${cs.section}`} value={`${cs.class}-${cs.section}`}>
                        Class {cs.class} – {cs.section}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Subject — restricted to allocations */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Subject</label>
                {currentSubjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic px-1">Select a class first.</p>
                ) : (
                  <select
                    value={formSubject}
                    onChange={e => setFormSubject(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                    data-testid="select-slot-subject"
                  >
                    <option value="">Select subject</option>
                    {currentSubjects.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>

              {/* Room (optional) */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Room / Lab (optional)</label>
                <input
                  type="text"
                  value={formRoom}
                  onChange={e => setFormRoom(e.target.value)}
                  placeholder="e.g. Room 101, Physics Lab..."
                  className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                  data-testid="input-slot-room"
                />
              </div>

              {/* Conflict Error */}
              {conflictError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-700/30" data-testid="text-conflict-error">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600 dark:text-red-400">{conflictError}</p>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="px-5 pb-5 flex gap-2">
              {isEditing && (
                <button
                  onClick={() => deleteMutation.mutate(modal.entry!.id)}
                  disabled={deleteMutation.isPending}
                  className="h-10 px-4 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 text-sm font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  data-testid="button-delete-slot"
                >
                  {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Remove
                </button>
              )}
              <button
                onClick={() => isEditing ? editMutation.mutate() : createMutation.mutate()}
                disabled={!canSubmit || createMutation.isPending || editMutation.isPending}
                className="flex-1 h-10 rounded-xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-1.5 transition-colors"
                data-testid="button-save-slot"
              >
                {(createMutation.isPending || editMutation.isPending) ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isEditing ? (
                  <><RefreshCw className="w-4 h-4" />Update Slot</>
                ) : (
                  <><Plus className="w-4 h-4" />Add Slot</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
