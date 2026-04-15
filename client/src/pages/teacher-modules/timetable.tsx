import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, X, AlertTriangle, BookOpen, Calendar, Trash2, Plus,
  Clock, Coffee, Info, ChevronRight, DoorOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";
import { useSchoolConfigStrict } from "@/hooks/use-school-config";

/* ─────────────────── Types ─────────────────── */
interface TimetableEntry {
  id: number;
  dayOfWeek: number;
  period: number;
  class: string;
  section: string;
  subject: string;
  room?: string;
  teacherId: number;
  teacherName?: string;
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

interface ModalState {
  day: number;
  period: number;
  existing: TimetableEntry | null;
}

interface SlotCheckResult {
  taken: boolean;
  teacherName?: string;
  subject?: string;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL  = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FALLBACK_PERIODS: StructureRow[] = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
  periodNumber: n, label: `Period ${n}`, startTime: "", endTime: "", isBreak: false, sortOrder: n - 1,
}));

/* ─────────────────── Subject flat-colour map (light mode) ─────────────────── */
const SUBJECT_COLORS: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  default:   { bg: "bg-slate-100",   text: "text-slate-700",   dot: "#64748b", border: "border-slate-300"  },
  math:      { bg: "bg-blue-100",    text: "text-blue-800",    dot: "#3b82f6", border: "border-blue-300"   },
  science:   { bg: "bg-emerald-100", text: "text-emerald-800", dot: "#10b981", border: "border-emerald-300"},
  english:   { bg: "bg-violet-100",  text: "text-violet-800",  dot: "#8b5cf6", border: "border-violet-300" },
  history:   { bg: "bg-amber-100",   text: "text-amber-800",   dot: "#f59e0b", border: "border-amber-300"  },
  geography: { bg: "bg-teal-100",    text: "text-teal-800",    dot: "#14b8a6", border: "border-teal-300"   },
  physics:   { bg: "bg-cyan-100",    text: "text-cyan-800",    dot: "#06b6d4", border: "border-cyan-300"   },
  chemistry: { bg: "bg-orange-100",  text: "text-orange-800",  dot: "#f97316", border: "border-orange-300" },
  biology:   { bg: "bg-green-100",   text: "text-green-800",   dot: "#22c55e", border: "border-green-300"  },
  computer:  { bg: "bg-indigo-100",  text: "text-indigo-800",  dot: "#6366f1", border: "border-indigo-300" },
  art:       { bg: "bg-pink-100",    text: "text-pink-800",    dot: "#ec4899", border: "border-pink-300"   },
  music:     { bg: "bg-purple-100",  text: "text-purple-800",  dot: "#a855f7", border: "border-purple-300" },
  pe:        { bg: "bg-red-100",     text: "text-red-800",     dot: "#ef4444", border: "border-red-300"    },
  social:    { bg: "bg-yellow-100",  text: "text-yellow-800",  dot: "#eab308", border: "border-yellow-300" },
  hindi:     { bg: "bg-rose-100",    text: "text-rose-800",    dot: "#f43f5e", border: "border-rose-300"   },
  economics: { bg: "bg-lime-100",    text: "text-lime-800",    dot: "#84cc16", border: "border-lime-300"   },
};

function getSubjectColor(subject: string) {
  const s = subject.toLowerCase();
  if (s.includes("math"))                             return SUBJECT_COLORS.math;
  if (s.includes("science"))                          return SUBJECT_COLORS.science;
  if (s.includes("english"))                          return SUBJECT_COLORS.english;
  if (s.includes("history"))                          return SUBJECT_COLORS.history;
  if (s.includes("geography") || s.includes("geo"))  return SUBJECT_COLORS.geography;
  if (s.includes("physics"))                          return SUBJECT_COLORS.physics;
  if (s.includes("chemistry") || s.includes("chem")) return SUBJECT_COLORS.chemistry;
  if (s.includes("biology") || s.includes("bio"))    return SUBJECT_COLORS.biology;
  if (s.includes("computer") || s.includes("it") || s.includes("cs")) return SUBJECT_COLORS.computer;
  if (s.includes("art") || s.includes("drawing"))    return SUBJECT_COLORS.art;
  if (s.includes("music"))                            return SUBJECT_COLORS.music;
  if (s.includes("pe") || s.includes("physical") || s.includes("sport")) return SUBJECT_COLORS.pe;
  if (s.includes("social") || s.includes("sst"))     return SUBJECT_COLORS.social;
  if (s.includes("hindi") || s.includes("sanskrit")) return SUBJECT_COLORS.hindi;
  if (s.includes("economics") || s.includes("eco"))  return SUBJECT_COLORS.economics;
  return SUBJECT_COLORS.default;
}

function formatTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

function timeToMinutes(t: string): number {
  if (!t) return -1;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isCurrentPeriod(row: StructureRow): boolean {
  if (!row.startTime || !row.endTime) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= timeToMinutes(row.startTime) && cur < timeToMinutes(row.endTime);
}

function todayDayIndex(): number {
  const d = new Date().getDay();
  if (d === 0) return 0;
  return d - 1;
}

function structureIsDefault(rows: StructureRow[]) {
  return rows.every(r => !r.id);
}

/* ─────────────────── Slot Assignment Modal ─────────────────── */
function SlotModal({
  modal, structure, explorerClass, explorerSection,
  subjectList, teacherId, myEntries,
  onClose, onSaved,
}: {
  modal: ModalState;
  structure: StructureRow[];
  explorerClass: string;
  explorerSection: string;
  subjectList: string[];
  teacherId: number;
  myEntries: TimetableEntry[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [subject, setSubject] = useState(modal.existing?.subject ?? "");
  const [room, setRoom] = useState(modal.existing?.room ?? "");
  const [subjectErr, setSubjectErr] = useState(false);

  const structureRow = structure.find(r => !r.isBreak && r.periodNumber === modal.period);
  const dayLabel = DAY_NAMES[modal.day];

  /* ── Self-collision ── */
  const selfConflict = myEntries.find(
    e => e.dayOfWeek === modal.day &&
         e.period === modal.period &&
         !(e.class === explorerClass && e.section === explorerSection)
  ) ?? null;

  /* ── Slot-occupancy collision ── */
  const { data: collision, isFetching: collisionChecking } = useQuery<SlotCheckResult>({
    queryKey: ["/api/timetable/slot-check", explorerClass, explorerSection, modal.day, modal.period],
    queryFn: async () => {
      const r = await fetch(
        `/api/timetable/slot-check?class=${encodeURIComponent(explorerClass)}&section=${encodeURIComponent(explorerSection)}&dayOfWeek=${modal.day}&period=${modal.period}`,
        { credentials: "include" }
      );
      return r.ok ? r.json() : { taken: false };
    },
    enabled: !!explorerClass && !!explorerSection,
    staleTime: 0,
  });

  const isSlotTaken = collision?.taken === true;
  const isBlocked = isSlotTaken || !!selfConflict;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/timetable/teacher/save-batch", {
        changes: [{
          dayOfWeek: modal.day,
          period: modal.period,
          class: explorerClass,
          section: explorerSection,
          subject,
          room: room || undefined,
        }],
      });
      return (res as Response).json() as Promise<{ saved: unknown[]; conflicts: Array<{ teacherName: string; subject: string }> }>;
    },
    onSuccess: (data) => {
      if (data.conflicts?.length > 0 && data.saved?.length === 0) {
        const c = data.conflicts[0];
        toast({ title: "Slot conflict — not saved", description: `${c.teacherName} is already teaching ${c.subject} here.`, variant: "destructive" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/teacher", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/class-view", explorerClass, explorerSection] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/timetable"] });
      toast({ title: "Slot saved", description: `${dayLabel} · Period ${modal.period} → ${subject}` });
      onSaved();
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/timetable/teacher/save-batch", {
        changes: [{
          dayOfWeek: modal.day, period: modal.period,
          class: explorerClass, section: explorerSection,
          subject: "", _delete: true,
        }],
      });
      return (res as Response).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/teacher", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/class-view", explorerClass, explorerSection] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/timetable"] });
      toast({ title: "Slot cleared" });
      onSaved();
    },
    onError: (e: Error) => {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    },
  });

  function handleSave() {
    if (!subject) { setSubjectErr(true); return; }
    if (isBlocked) return;
    saveMutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-sm shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <CardContent className="pt-5 pb-5 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-base font-bold text-gray-900">
                {modal.existing ? "Edit Slot" : "Assign Subject"}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {dayLabel} · Period {modal.period}
                {structureRow?.startTime && ` · ${formatTime(structureRow.startTime)}–${formatTime(structureRow.endTime)}`}
              </p>
              <p className="text-xs font-semibold text-emerald-600 mt-0.5">
                Class {explorerClass} – {explorerSection}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
              data-testid="button-modal-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Self-collision warning */}
          {selfConflict && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200" data-testid="modal-self-collision-warning">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-700">You are already teaching elsewhere at this time!</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  You're assigned to Class {selfConflict.class}–{selfConflict.section} ({selfConflict.subject}) at this time. Saving will overwrite that slot.
                </p>
              </div>
            </div>
          )}

          {/* Slot-occupancy collision */}
          {collisionChecking && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
              <span className="text-xs text-gray-500">Checking slot availability…</span>
            </div>
          )}
          {isSlotTaken && !collisionChecking && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200" data-testid="modal-collision-warning">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-red-700">This slot is taken — save blocked</p>
                <p className="text-xs text-red-600 mt-0.5">
                  {collision?.teacherName} is already teaching {collision?.subject} here. Cannot overwrite another teacher's slot.
                </p>
              </div>
            </div>
          )}

          {/* Subject */}
          <div>
            <label className={`block text-sm font-semibold mb-1.5 ${subjectErr ? "text-red-600" : "text-gray-700"}`}>
              Subject {subjectErr && <span className="text-red-500">*</span>}
            </label>
            <select
              value={subject}
              onChange={e => { setSubject(e.target.value); setSubjectErr(false); }}
              className={`w-full h-12 px-3 rounded-xl text-base font-medium bg-white border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${subjectErr ? "border-red-400" : "border-gray-300"}`}
              data-testid="select-modal-subject"
            >
              <option value="">Choose a subject…</option>
              {subjectList.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Room */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Room <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={room}
              onChange={e => setRoom(e.target.value)}
              placeholder="e.g. Lab 2, Room 104"
              className="w-full h-12 px-3 rounded-xl text-base border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              data-testid="input-modal-room"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {modal.existing && (
              <Button
                variant="outline"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="h-12 px-4 text-red-600 border-red-200 hover:bg-red-50"
                data-testid="button-modal-delete"
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                <span className="ml-1.5">Remove</span>
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || isBlocked || collisionChecking}
              className="flex-1 h-12 text-base font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
              data-testid="button-modal-save"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {modal.existing ? "Update Slot" : "Assign Slot"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────── Main Component ─────────────────── */
export default function TimetableModule({ teacher }: { teacher: TeacherMe }) {
  const [activeTab, setActiveTab] = useState<"explorer" | "schedule">("explorer");

  const {
    classes: CLASS_LIST,
    sections: SECTION_LIST,
    subjects: SUBJECT_LIST,
    isLoading: configLoading,
    hasClasses, hasSections, hasSubjects, isFullyConfigured,
  } = useSchoolConfigStrict(teacher.schoolId);

  const [explorerClass, setExplorerClass] = useState("");
  const [explorerSection, setExplorerSection] = useState("");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [selectedDay, setSelectedDay] = useState<number>(todayDayIndex());

  /* ── Queries ── */
  const { data: myEntries = [], isLoading: myEntriesLoading } = useQuery<TimetableEntry[]>({
    queryKey: ["/api/timetable/teacher", teacher.id],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/teacher/${teacher.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const { data: explorerData, isLoading: explorerLoading } = useQuery<{ entries: TimetableEntry[]; structure: StructureRow[] }>({
    queryKey: ["/api/timetable/class-view", explorerClass, explorerSection],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/class-view?class=${explorerClass}&section=${explorerSection}`, { credentials: "include" });
      if (!r.ok) return { entries: [], structure: [] };
      return r.json();
    },
    enabled: !!explorerClass && !!explorerSection,
  });

  const scheduleClass = teacher.assignedClass || (myEntries[0]?.class ?? "");
  const { data: scheduleStructure = [] } = useQuery<StructureRow[]>({
    queryKey: ["/api/timetable/structure", scheduleClass],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/structure?class=${encodeURIComponent(scheduleClass)}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!scheduleClass,
  });

  const explorerEntries: TimetableEntry[] = explorerData?.entries ?? [];
  const explorerStructure: StructureRow[] = explorerData?.structure?.length ? explorerData.structure : FALLBACK_PERIODS;

  const isLoading = myEntriesLoading || configLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-16">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!isFullyConfigured) {
    const missing: string[] = [];
    if (!hasClasses) missing.push("classes");
    if (!hasSections) missing.push("sections");
    if (!hasSubjects) missing.push("subjects");
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">My Timetable</h2>
        <Card className="border-amber-200 bg-amber-50" data-testid="timetable-config-warning">
          <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
            <Info className="w-8 h-8 text-amber-500" />
            <div>
              <p className="font-bold text-sm text-amber-800 mb-1">Timetable configuration required</p>
              <p className="text-xs text-amber-700 max-w-xs">
                Admin has not yet defined <strong>{missing.join(", ")}</strong>. Once configured you can allocate subjects.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dayEntries = myEntries
    .filter(e => e.dayOfWeek === selectedDay)
    .sort((a, b) => {
      const aRow = scheduleStructure.find(r => !r.isBreak && r.periodNumber === a.period);
      const bRow = scheduleStructure.find(r => !r.isBreak && r.periodNumber === b.period);
      const aMin = aRow?.startTime ? timeToMinutes(aRow.startTime) : a.period * 100;
      const bMin = bRow?.startTime ? timeToMinutes(bRow.startTime) : b.period * 100;
      return aMin - bMin;
    });

  return (
    <div className="space-y-4">
      {/* Page title */}
      <h2 className="text-xl font-bold tracking-tight">My Timetable</h2>

      {/* ── Tab Bar ── */}
      <div className="flex gap-2 border-b border-gray-200 pb-0">
        <button
          onClick={() => setActiveTab("explorer")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "explorer"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
          data-testid="tab-class-explorer"
        >
          <BookOpen className="w-4 h-4" />
          Class Explorer
        </button>
        <button
          onClick={() => setActiveTab("schedule")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "schedule"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
          data-testid="tab-my-schedule"
        >
          <Calendar className="w-4 h-4" />
          My Schedule
          {myEntries.length > 0 && (
            <Badge className="ml-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs px-1.5">
              {myEntries.length}
            </Badge>
          )}
        </button>
      </div>

      {/* ── Tab Content ── */}
      {activeTab === "explorer" ? (
        <ClassExplorerTab
          explorerClass={explorerClass}
          explorerSection={explorerSection}
          setExplorerClass={setExplorerClass}
          setExplorerSection={setExplorerSection}
          explorerEntries={explorerEntries}
          explorerStructure={explorerStructure}
          explorerLoading={explorerLoading}
          classList={CLASS_LIST}
          sectionList={SECTION_LIST}
          setModal={setModal}
          teacherId={teacher.id}
        />
      ) : (
        <MyScheduleTab
          myEntries={myEntries}
          dayEntries={dayEntries}
          scheduleStructure={scheduleStructure}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
        />
      )}

      {/* ── Slot Assignment Modal ── */}
      {modal && (
        <SlotModal
          modal={modal}
          structure={explorerStructure}
          explorerClass={explorerClass}
          explorerSection={explorerSection}
          subjectList={SUBJECT_LIST}
          teacherId={teacher.id}
          myEntries={myEntries}
          onClose={() => setModal(null)}
          onSaved={() => setModal(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────── Class Explorer Tab ─────────────────── */
function ClassExplorerTab({
  explorerClass, explorerSection, setExplorerClass, setExplorerSection,
  explorerEntries, explorerStructure, explorerLoading,
  classList, sectionList, setModal, teacherId,
}: {
  explorerClass: string; explorerSection: string;
  setExplorerClass: (v: string) => void; setExplorerSection: (v: string) => void;
  explorerEntries: TimetableEntry[]; explorerStructure: StructureRow[];
  explorerLoading: boolean;
  classList: string[]; sectionList: string[];
  setModal: (m: ModalState | null) => void; teacherId: number;
}) {
  const hasSelection = !!explorerClass && !!explorerSection;

  return (
    <div className="space-y-4">
      {/* Class / Section selectors */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm font-semibold text-gray-700 mb-1">Class</label>
          <Select value={explorerClass} onValueChange={setExplorerClass}>
            <SelectTrigger className="h-11" data-testid="select-explorer-class">
              <SelectValue placeholder="Select Class" />
            </SelectTrigger>
            <SelectContent>
              {classList.map(c => (
                <SelectItem key={c} value={c}>Class {c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <label className="block text-sm font-semibold text-gray-700 mb-1">Section</label>
          <Select value={explorerSection} onValueChange={setExplorerSection}>
            <SelectTrigger className="h-11" data-testid="select-explorer-section">
              <SelectValue placeholder="Select Section" />
            </SelectTrigger>
            <SelectContent>
              {sectionList.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Empty state */}
      {!hasSelection && (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <BookOpen className="w-10 h-10 text-gray-300" />
            <p className="font-semibold text-gray-500">Select a class and section above</p>
            <p className="text-sm text-gray-400">Then click any empty period slot to assign a subject</p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {hasSelection && explorerLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
      )}

      {/* Grid */}
      {hasSelection && !explorerLoading && (
        <>
          {structureIsDefault(explorerStructure) && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200" data-testid="banner-no-structure">
              <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-700">
                No bell schedule configured for Class {explorerClass}. Admin can set one under Timetable Master → Bell Structure.
              </p>
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm min-w-[520px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="py-3 px-3 text-left w-[120px] border-r border-gray-200">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Period</span>
                    </th>
                    {DAY_NAMES.map((d, i) => (
                      <th key={i} className="py-3 px-2 text-center border-r border-gray-200 last:border-r-0">
                        <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">{d}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {explorerStructure.map((srow, sIdx) => {
                    if (srow.isBreak) {
                      return (
                        <tr key={sIdx} className="bg-amber-50 border-b border-gray-200">
                          <td className="py-2 px-3 border-r border-gray-200">
                            <div className="flex items-center gap-1.5">
                              <Coffee className="w-3.5 h-3.5 text-amber-600" />
                              <div>
                                <p className="text-xs font-bold text-amber-700">{srow.label || "Break"}</p>
                                {srow.startTime && (
                                  <p className="text-[11px] text-amber-500">{formatTime(srow.startTime)}–{formatTime(srow.endTime)}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          {DAY_NAMES.map((_, di) => (
                            <td key={di} className="border-r border-gray-200 last:border-r-0 text-center">
                              <span className="text-[11px] text-amber-400 font-medium">—</span>
                            </td>
                          ))}
                        </tr>
                      );
                    }

                    const p = srow.periodNumber;
                    const isPeriodActive = isCurrentPeriod(srow);

                    return (
                      <tr key={sIdx} className={`border-b border-gray-200 ${isPeriodActive ? "bg-emerald-50/50" : "bg-white hover:bg-gray-50/50"}`}>
                        {/* Period label */}
                        <td className={`py-3 px-3 border-r border-gray-200 ${isPeriodActive ? "border-l-4 border-l-emerald-500" : ""}`}>
                          <p className={`text-sm font-bold ${isPeriodActive ? "text-emerald-700" : "text-gray-800"}`}>Period {p}</p>
                          {srow.startTime && (
                            <p className={`text-xs mt-0.5 ${isPeriodActive ? "text-emerald-600" : "text-gray-500"}`}>
                              {formatTime(srow.startTime)} – {formatTime(srow.endTime)}
                            </p>
                          )}
                          {isPeriodActive && (
                            <span className="inline-block mt-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">Now</span>
                          )}
                        </td>

                        {/* Day cells */}
                        {DAY_NAMES.map((_, dayIdx) => {
                          const entry = explorerEntries.find(e => e.dayOfWeek === dayIdx && e.period === p);
                          const isActive = isPeriodActive && dayIdx === todayDayIndex();
                          const col = entry ? getSubjectColor(entry.subject) : null;

                          return (
                            <td
                              key={dayIdx}
                              className="px-1.5 py-1.5 border-r border-gray-200 last:border-r-0 min-w-[90px]"
                              data-testid={`explorer-cell-${dayIdx}-${p}`}
                            >
                              {entry ? (
                                entry.teacherId === teacherId ? (
                                  /* Own slot — editable */
                                  <button
                                    className={`w-full rounded-lg p-2 text-left transition-all group ${col?.bg} ${isActive ? `ring-2 ring-emerald-500 ring-offset-1` : ""}`}
                                    onClick={() => setModal({ day: dayIdx, period: p, existing: entry })}
                                    data-testid={`slot-own-${dayIdx}-${p}`}
                                  >
                                    <p className={`text-[13px] font-bold leading-tight ${col?.text}`}>{entry.subject}</p>
                                    <div className="flex items-center justify-between mt-1">
                                      <p className="text-[10px] text-gray-500">{entry.teacherName || "You"}</p>
                                      <ChevronRight className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                  </button>
                                ) : (
                                  /* Other teacher's slot — read-only */
                                  <div
                                    className="w-full rounded-lg p-2 bg-gray-100 border border-gray-200"
                                    data-testid={`slot-other-${dayIdx}-${p}`}
                                  >
                                    <p className="text-[13px] font-bold text-gray-600 leading-tight">{entry.subject}</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">{entry.teacherName || "—"}</p>
                                  </div>
                                )
                              ) : (
                                /* Empty slot */
                                <button
                                  className="w-full min-h-[52px] rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center hover:border-emerald-400 hover:bg-emerald-50 transition-all group"
                                  onClick={() => setModal({ day: dayIdx, period: p, existing: null })}
                                  data-testid={`button-add-slot-${dayIdx}-${p}`}
                                >
                                  <Plus className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors" />
                                </button>
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
          </Card>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 pt-1">
            {Object.entries(SUBJECT_COLORS).filter(([k]) => k !== "default").slice(0, 8).map(([name, col]) => (
              <div key={name} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.dot }} />
                <span className="text-xs text-gray-500 capitalize">{name}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────── My Schedule Tab ─────────────────── */
function MyScheduleTab({
  myEntries, dayEntries, scheduleStructure, selectedDay, setSelectedDay,
}: {
  myEntries: TimetableEntry[];
  dayEntries: TimetableEntry[];
  scheduleStructure: StructureRow[];
  selectedDay: number;
  setSelectedDay: (d: number) => void;
}) {
  const today = todayDayIndex();

  return (
    <div className="space-y-4">
      {/* Day picker */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {DAY_NAMES.map((d, i) => {
          const isToday = i === today;
          const isSelected = i === selectedDay;
          const dayCount = myEntries.filter(e => e.dayOfWeek === i).length;
          return (
            <button
              key={i}
              onClick={() => setSelectedDay(i)}
              className={`flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl min-w-[52px] min-h-[52px] justify-center border transition-all ${
                isSelected
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : isToday
                  ? "border-emerald-400 text-emerald-700 bg-emerald-50"
                  : "border-gray-200 text-gray-600 bg-white hover:bg-gray-50"
              }`}
              data-testid={`day-btn-${i}`}
            >
              <span className="text-xs font-bold">{d}</span>
              {dayCount > 0 && (
                <span className={`text-[10px] font-bold px-1.5 rounded-full ${isSelected ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700"}`}>
                  {dayCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Day label */}
      <div className="flex items-center gap-2">
        <p className="text-sm font-bold text-gray-700">{DAY_FULL[selectedDay]}</p>
        {selectedDay === today && (
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">Today</Badge>
        )}
      </div>

      {/* Empty state */}
      {dayEntries.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <Clock className="w-10 h-10 text-gray-300" />
            <p className="font-semibold text-gray-500">No classes on {DAY_NAMES[selectedDay]}</p>
            <p className="text-sm text-gray-400">Assign yourself to periods in the Class Explorer tab</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {dayEntries.map((entry, idx) => {
            const srow = scheduleStructure.find(r => !r.isBreak && r.periodNumber === entry.period);
            const active = selectedDay === todayDayIndex() && (srow ? isCurrentPeriod(srow) : false);
            const col = getSubjectColor(entry.subject);

            return (
              <Card
                key={entry.id ?? idx}
                className={`overflow-hidden transition-all ${active ? "ring-2 ring-emerald-500 shadow-md shadow-emerald-100" : ""}`}
                data-testid={`schedule-card-${entry.id ?? idx}`}
              >
                <div className="flex">
                  {/* Colored left bar */}
                  <div className="w-1.5 flex-shrink-0" style={{ backgroundColor: col.dot }} />

                  {/* Card body */}
                  <CardContent className="flex-1 py-4 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Subject */}
                        <p className="text-base font-bold text-gray-900 leading-tight">{entry.subject}</p>

                        {/* Class + Section + Room */}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${col.bg} ${col.text}`}>
                            Class {entry.class} – {entry.section}
                          </span>
                          {entry.room && (
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <DoorOpen className="w-3 h-3" />
                              {entry.room}
                            </span>
                          )}
                        </div>

                        {/* Active badge */}
                        {active && (
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-xs font-bold text-emerald-700">You should be here NOW</span>
                          </div>
                        )}
                      </div>

                      {/* Time + Period */}
                      <div className="text-right flex-shrink-0">
                        <p className={`text-sm font-bold ${active ? "text-emerald-700" : "text-gray-800"}`}>Period {entry.period}</p>
                        {srow?.startTime && (
                          <p className={`text-xs font-semibold mt-0.5 ${active ? "text-emerald-600" : "text-gray-600"}`}>
                            {formatTime(srow.startTime)}
                          </p>
                        )}
                        {srow?.endTime && (
                          <p className="text-xs text-gray-400">{formatTime(srow.endTime)}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Weekly total */}
      {myEntries.length > 0 && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 mt-2">
          <span className="text-sm font-semibold text-gray-600">Total assigned periods this week</span>
          <span className="text-base font-bold text-emerald-700">{myEntries.length}</span>
        </div>
      )}
    </div>
  );
}
