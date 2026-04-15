import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2, X, AlertTriangle, BookOpen, Calendar, Trash2, Plus,
  Clock, Coffee, Info, ChevronRight, DoorOpen, Search,
} from "lucide-react";
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
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FALLBACK_PERIODS: StructureRow[] = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
  periodNumber: n, label: `Period ${n}`, startTime: "", endTime: "", isBreak: false, sortOrder: n - 1,
}));

/* ─────────────────── Subject colour map ─────────────────── */
const SUBJECT_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  default:     { bg: "rgba(100,116,139,0.18)", border: "#64748b",  text: "#ffffff", dot: "#64748b"  },
  math:        { bg: "rgba(59,130,246,0.18)",  border: "#3b82f6",  text: "#ffffff", dot: "#3b82f6"  },
  science:     { bg: "rgba(16,185,129,0.18)",  border: "#10b981",  text: "#ffffff", dot: "#10b981"  },
  english:     { bg: "rgba(139,92,246,0.18)",  border: "#8b5cf6",  text: "#ffffff", dot: "#8b5cf6"  },
  history:     { bg: "rgba(245,158,11,0.18)",  border: "#f59e0b",  text: "#ffffff", dot: "#f59e0b"  },
  geography:   { bg: "rgba(20,184,166,0.18)",  border: "#14b8a6",  text: "#ffffff", dot: "#14b8a6"  },
  physics:     { bg: "rgba(6,182,212,0.18)",   border: "#06b6d4",  text: "#ffffff", dot: "#06b6d4"  },
  chemistry:   { bg: "rgba(249,115,22,0.18)",  border: "#f97316",  text: "#ffffff", dot: "#f97316"  },
  biology:     { bg: "rgba(34,197,94,0.18)",   border: "#22c55e",  text: "#ffffff", dot: "#22c55e"  },
  computer:    { bg: "rgba(99,102,241,0.18)",  border: "#6366f1",  text: "#ffffff", dot: "#6366f1"  },
  art:         { bg: "rgba(236,72,153,0.18)",  border: "#ec4899",  text: "#ffffff", dot: "#ec4899"  },
  music:       { bg: "rgba(168,85,247,0.18)",  border: "#a855f7",  text: "#ffffff", dot: "#a855f7"  },
  pe:          { bg: "rgba(239,68,68,0.18)",   border: "#ef4444",  text: "#ffffff", dot: "#ef4444"  },
  social:      { bg: "rgba(234,179,8,0.18)",   border: "#eab308",  text: "#ffffff", dot: "#eab308"  },
  hindi:       { bg: "rgba(244,63,94,0.18)",   border: "#f43f5e",  text: "#ffffff", dot: "#f43f5e"  },
  economics:   { bg: "rgba(251,191,36,0.18)",  border: "#fbbf24",  text: "#ffffff", dot: "#fbbf24"  },
};

function getSubjectColor(subject: string) {
  const s = subject.toLowerCase();
  if (s.includes("math"))       return SUBJECT_COLORS.math;
  if (s.includes("science"))    return SUBJECT_COLORS.science;
  if (s.includes("english"))    return SUBJECT_COLORS.english;
  if (s.includes("history"))    return SUBJECT_COLORS.history;
  if (s.includes("geography") || s.includes("geo")) return SUBJECT_COLORS.geography;
  if (s.includes("physics"))    return SUBJECT_COLORS.physics;
  if (s.includes("chemistry") || s.includes("chem")) return SUBJECT_COLORS.chemistry;
  if (s.includes("biology") || s.includes("bio"))    return SUBJECT_COLORS.biology;
  if (s.includes("computer") || s.includes("it") || s.includes("cs")) return SUBJECT_COLORS.computer;
  if (s.includes("art") || s.includes("drawing"))    return SUBJECT_COLORS.art;
  if (s.includes("music"))      return SUBJECT_COLORS.music;
  if (s.includes("pe") || s.includes("physical") || s.includes("sport")) return SUBJECT_COLORS.pe;
  if (s.includes("social") || s.includes("sst"))     return SUBJECT_COLORS.social;
  if (s.includes("hindi") || s.includes("sanskrit"))  return SUBJECT_COLORS.hindi;
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
  const d = new Date().getDay(); // 0=Sun,1=Mon,...,6=Sat
  if (d === 0) return 0; // Sunday → show Mon
  return d - 1; // Mon=0, Tue=1, ... Sat=5
}

/* ─────────────────── Slot Assignment Modal ─────────────────── */
function SlotModal({
  modal, structure, explorerClass, explorerSection,
  subjectList, teacherName, teacherId, myEntries,
  onClose, onSaved,
}: {
  modal: ModalState;
  structure: StructureRow[];
  explorerClass: string;
  explorerSection: string;
  subjectList: string[];
  teacherName: string;
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

  /* ── Self-collision: teacher already assigned to a DIFFERENT class at this time ── */
  const selfConflict = myEntries.find(
    e => e.dayOfWeek === modal.day &&
         e.period === modal.period &&
         !(e.class === explorerClass && e.section === explorerSection)
  ) ?? null;

  /* ── Slot-occupancy collision: another teacher already has this class/section slot ── */
  const { data: collision, isFetching: collisionChecking } = useQuery<SlotCheckResult>({
    queryKey: ["/api/timetable/slot-check", explorerClass, explorerSection, modal.day, modal.period],
    queryFn: async () => {
      const r = await fetch(
        `/api/timetable/slot-check?class=${encodeURIComponent(explorerClass)}&section=${encodeURIComponent(explorerSection)}&dayOfWeek=${modal.day}&period=${modal.period}`,
        { credentials: "include" }
      );
      return r.ok ? r.json() : { taken: false };
    },
    /* Always check slot-check — even for edit path. The API excludes the current teacher's own
       entries via excludeTeacherId, so editing your own slot returns taken:false (correct).
       Editing another teacher's slot returns taken:true → save is blocked. */
    enabled: !!explorerClass && !!explorerSection,
    staleTime: 0,
  });

  const isSlotTaken = collision?.taken === true;
  /* Block save if: slot is taken by another teacher OR teacher already teaches elsewhere this period */
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
      /* Backend returns { saved:[], conflicts:[...] } on conflict — must check explicitly */
      if (data.conflicts?.length > 0 && data.saved?.length === 0) {
        const c = data.conflicts[0];
        toast({
          title: "Slot conflict — not saved",
          description: `${c.teacherName} is already teaching ${c.subject} in this slot.`,
          variant: "destructive",
        });
        return; // keep modal open so teacher can see the issue
      }
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/teacher", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/class-view", explorerClass, explorerSection] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/timetable"] });
      toast({ title: "Slot saved", description: `${dayLabel} P${modal.period} → ${subject}`, className: "border-[#10b981] bg-[#10b981]/10 text-white" });
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
          dayOfWeek: modal.day,
          period: modal.period,
          class: explorerClass,
          section: explorerSection,
          subject: "",
          _delete: true,
        }],
      });
      return (res as Response).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/teacher", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/class-view", explorerClass, explorerSection] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/timetable"] });
      toast({ title: "Slot cleared", className: "border-amber-500 bg-amber-900/10 text-white" });
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/15 p-6 space-y-5"
        style={{ backgroundColor: "#0A1628" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-bold" style={{ color: "#ffffff" }}>
              {modal.existing ? "Edit Slot" : "Assign Subject"}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
              {dayLabel} · Period {modal.period}
              {structureRow?.startTime && ` · ${formatTime(structureRow.startTime)}–${formatTime(structureRow.endTime)}`}
            </p>
            <p className="text-xs mt-0.5 font-semibold" style={{ color: "#10b981" }}>
              Class {explorerClass} – {explorerSection}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}
            data-testid="button-modal-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Self-collision warning — teacher already booked elsewhere at this time */}
        {selfConflict && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-amber-600/40" style={{ backgroundColor: "rgba(245,158,11,0.1)" }} data-testid="modal-self-collision-warning">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
            <div>
              <p className="text-xs font-bold" style={{ color: "#f59e0b" }}>You have a scheduling conflict</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(245,158,11,0.85)" }}>
                You are already teaching <strong>{selfConflict.subject}</strong> in{" "}
                Class {selfConflict.class}–{selfConflict.section} at this time. Saving will overwrite that assignment.
              </p>
            </div>
          </div>
        )}

        {/* Slot-occupancy collision — another teacher holds this class/section slot */}
        {collisionChecking && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "rgba(255,255,255,0.4)" }} />
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Checking slot availability…</span>
          </div>
        )}
        {isSlotTaken && !collisionChecking && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-red-700/40" style={{ backgroundColor: "rgba(239,68,68,0.1)" }} data-testid="modal-collision-warning">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
            <div>
              <p className="text-xs font-bold" style={{ color: "#ef4444" }}>Slot already taken</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(239,68,68,0.8)" }}>
                {collision?.teacherName} is teaching <strong>{collision?.subject}</strong> here. Saving is blocked.
              </p>
            </div>
          </div>
        )}

        {/* Subject */}
        <div>
          <label className="block text-xs font-bold mb-1.5" style={{ color: subjectErr ? "#ef4444" : "rgba(255,255,255,0.6)" }}>
            Subject {subjectErr && <span style={{ color: "#ef4444" }}>*</span>}
          </label>
          <select
            value={subject}
            onChange={e => { setSubject(e.target.value); setSubjectErr(false); }}
            className="w-full h-11 px-3 rounded-xl text-sm font-medium focus:outline-none focus:ring-2"
            style={{
              backgroundColor: "#1A2942",
              color: "#ffffff",
              border: subjectErr ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.2)",
            }}
            data-testid="select-modal-subject"
          >
            <option value="">Choose a subject…</option>
            {subjectList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Room (optional) */}
        <div>
          <label className="block text-xs font-bold mb-1.5" style={{ color: "rgba(255,255,255,0.6)" }}>
            Room <span style={{ color: "rgba(255,255,255,0.3)" }}>(optional)</span>
          </label>
          <input
            type="text"
            value={room}
            onChange={e => setRoom(e.target.value)}
            placeholder="e.g. Lab 2, Room 104"
            className="w-full h-11 px-3 rounded-xl text-sm font-medium focus:outline-none focus:ring-2"
            style={{
              backgroundColor: "#1A2942",
              color: "#ffffff",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
            data-testid="input-modal-room"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {modal.existing && (
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="h-11 px-4 rounded-xl border text-sm font-semibold flex items-center gap-1.5 transition-colors"
              style={{ borderColor: "rgba(239,68,68,0.4)", color: "#ef4444", backgroundColor: "transparent" }}
              data-testid="button-modal-delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || isBlocked || collisionChecking}
            className="flex-1 h-11 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#10b981", color: "#ffffff" }}
            data-testid="button-modal-save"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {modal.existing ? "Update" : "Assign Slot"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Main Component ─────────────────── */
export default function TimetableModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"explorer" | "schedule">("explorer");
  const [tabDirection, setTabDirection] = useState(1);

  const {
    classes: CLASS_LIST,
    sections: SECTION_LIST,
    subjects: SUBJECT_LIST,
    isLoading: configLoading,
    hasClasses, hasSections, hasSubjects, isFullyConfigured,
  } = useSchoolConfigStrict(teacher.schoolId);

  /* ── Explorer state ── */
  const [explorerClass, setExplorerClass] = useState("");
  const [explorerSection, setExplorerSection] = useState("");
  const [modal, setModal] = useState<ModalState | null>(null);

  /* ── My Schedule state ── */
  const [selectedDay, setSelectedDay] = useState<number>(todayDayIndex());

  function switchTab(tab: "explorer" | "schedule") {
    setTabDirection(tab === "schedule" ? 1 : -1);
    setActiveTab(tab);
  }

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

  /* Structure for "My Schedule" time-range display — use teacher's assigned class or first entry class */
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

  /* ── Loading / not configured ── */
  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-16">
        <Loader2 className="w-7 h-7 animate-spin" style={{ color: "#10b981" }} />
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
        <h3 className="text-base font-bold" style={{ color: "#ffffff" }}>My Timetable</h3>
        <div className="rounded-2xl border border-amber-500/30 p-8 flex flex-col items-center gap-4 text-center" style={{ backgroundColor: "rgba(245,158,11,0.08)" }} data-testid="timetable-config-warning">
          <Info className="w-8 h-8" style={{ color: "#f59e0b" }} />
          <div>
            <p className="font-bold text-sm mb-1" style={{ color: "#fbbf24" }}>Timetable configuration required</p>
            <p className="text-xs max-w-xs" style={{ color: "rgba(251,191,36,0.7)" }}>
              Admin has not yet defined <strong>{missing.join(", ")}</strong>. Once configured you can allocate subjects.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ── My Schedule: day entries ── */
  const dayEntries = myEntries
    .filter(e => e.dayOfWeek === selectedDay)
    .sort((a, b) => {
      const aRow = scheduleStructure.find(r => !r.isBreak && r.periodNumber === a.period);
      const bRow = scheduleStructure.find(r => !r.isBreak && r.periodNumber === b.period);
      const aMin = aRow?.startTime ? timeToMinutes(aRow.startTime) : a.period * 100;
      const bMin = bRow?.startTime ? timeToMinutes(bRow.startTime) : b.period * 100;
      return aMin - bMin;
    });

  /* ── Variant config for Framer Motion ── */
  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
  };

  return (
    <div className="space-y-0">
      {/* ── Tab Bar ── */}
      <div className="flex gap-1 p-1 rounded-2xl mb-5" style={{ backgroundColor: "rgba(255,255,255,0.06)" }}>
        <button
          onClick={() => switchTab("explorer")}
          className="flex-1 h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
          style={{
            backgroundColor: activeTab === "explorer" ? "#10b981" : "transparent",
            color: activeTab === "explorer" ? "#ffffff" : "rgba(255,255,255,0.5)",
          }}
          data-testid="tab-class-explorer"
        >
          <Search className="w-4 h-4" />
          Class Explorer
        </button>
        <button
          onClick={() => switchTab("schedule")}
          className="flex-1 h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
          style={{
            backgroundColor: activeTab === "schedule" ? "#10b981" : "transparent",
            color: activeTab === "schedule" ? "#ffffff" : "rgba(255,255,255,0.5)",
          }}
          data-testid="tab-my-schedule"
        >
          <Calendar className="w-4 h-4" />
          My Schedule
          {myEntries.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{
              backgroundColor: activeTab === "schedule" ? "rgba(255,255,255,0.25)" : "rgba(16,185,129,0.25)",
              color: activeTab === "schedule" ? "#ffffff" : "#10b981",
            }}>
              {myEntries.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Animated Tab Content ── */}
      <div className="overflow-hidden">
        <AnimatePresence mode="wait" custom={tabDirection} initial={false}>
          {activeTab === "explorer" ? (
            <motion.div
              key="explorer"
              custom={tabDirection}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: "easeInOut" }}
            >
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
                modal={modal}
                setModal={setModal}
                subjectList={SUBJECT_LIST}
                teacherName={teacher.fullName}
                teacherId={teacher.id}
              />
            </motion.div>
          ) : (
            <motion.div
              key="schedule"
              custom={tabDirection}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: "easeInOut" }}
            >
              <MyScheduleTab
                myEntries={myEntries}
                dayEntries={dayEntries}
                scheduleStructure={scheduleStructure}
                selectedDay={selectedDay}
                setSelectedDay={setSelectedDay}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Slot Assignment Modal ── */}
      {modal && (
        <SlotModal
          modal={modal}
          structure={explorerStructure}
          explorerClass={explorerClass}
          explorerSection={explorerSection}
          subjectList={SUBJECT_LIST}
          teacherName={teacher.fullName}
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
  classList, sectionList, modal, setModal,
  subjectList, teacherName, teacherId,
}: {
  explorerClass: string; explorerSection: string;
  setExplorerClass: (v: string) => void; setExplorerSection: (v: string) => void;
  explorerEntries: TimetableEntry[]; explorerStructure: StructureRow[];
  explorerLoading: boolean;
  classList: string[]; sectionList: string[];
  modal: ModalState | null; setModal: (m: ModalState | null) => void;
  subjectList: string[]; teacherName: string; teacherId: number;
}) {
  const selectorRef = useRef<HTMLDivElement>(null);
  const hasSelection = !!explorerClass && !!explorerSection;

  return (
    <div className="space-y-4">
      {/* Sticky selector */}
      <div
        ref={selectorRef}
        className="sticky top-0 z-20 pb-3 pt-1"
        style={{ backgroundColor: "#0A1628" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Search className="w-4 h-4" style={{ color: "#10b981" }} />
          <h3 className="text-sm font-bold" style={{ color: "#ffffff" }}>Class Explorer</h3>
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: "rgba(16,185,129,0.15)", color: "#10b981" }}>
            Allocation Mode
          </span>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <select
              value={explorerClass}
              onChange={e => setExplorerClass(e.target.value)}
              className="w-full h-11 px-3 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2"
              style={{
                backgroundColor: "#1A2942",
                color: explorerClass ? "#ffffff" : "rgba(255,255,255,0.4)",
                border: "1px solid rgba(255,255,255,0.15)",
              }}
              data-testid="select-explorer-class"
            >
              <option value="">Select Class</option>
              {classList.map(c => <option key={c} value={c}>Class {c}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <select
              value={explorerSection}
              onChange={e => setExplorerSection(e.target.value)}
              className="w-full h-11 px-3 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2"
              style={{
                backgroundColor: "#1A2942",
                color: explorerSection ? "#ffffff" : "rgba(255,255,255,0.4)",
                border: "1px solid rgba(255,255,255,0.15)",
              }}
              data-testid="select-explorer-section"
            >
              <option value="">Section</option>
              {sectionList.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Empty state — no class selected */}
      {!hasSelection && (
        <div className="rounded-2xl border p-12 flex flex-col items-center gap-3 text-center" style={{ borderColor: "rgba(255,255,255,0.08)", borderStyle: "dashed", backgroundColor: "rgba(255,255,255,0.02)" }}>
          <BookOpen className="w-8 h-8" style={{ color: "rgba(255,255,255,0.2)" }} />
          <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>Select a class and section above</p>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>Then click any empty period to assign your subjects</p>
        </div>
      )}

      {/* Loading */}
      {hasSelection && explorerLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#10b981" }} />
        </div>
      )}

      {/* Timetable grid */}
      {hasSelection && !explorerLoading && (
        <>
          {/* No structure banner */}
          {explorerStructure === null || (explorerData_structureIsDefault(explorerStructure)) && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-blue-500/20" style={{ backgroundColor: "rgba(59,130,246,0.08)" }} data-testid="banner-no-structure">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#60a5fa" }} />
              <p className="text-xs" style={{ color: "rgba(96,165,250,0.85)" }}>
                No bell schedule configured for Class {explorerClass}. Admin can set one under Timetable Master → Bell Structure.
              </p>
            </div>
          )}

          {/* Grid */}
          <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
            <table className="w-full border-collapse text-sm min-w-[520px]">
              <thead>
                <tr>
                  <th className="border-b border-r p-2.5 text-center w-[110px]" style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "#0F1E35" }}>
                    <span className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.4)" }}>Period</span>
                  </th>
                  {DAY_NAMES.map((d, i) => (
                    <th key={i} className="border-b border-r p-2.5 text-center" style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "#0F1E35" }}>
                      <span className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>{d}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {explorerStructure.map((srow, sIdx) => {
                  if (srow.isBreak) {
                    return (
                      <tr key={sIdx}>
                        <td className="border-b border-r p-2 text-center" style={{ borderColor: "rgba(255,255,255,0.06)", backgroundColor: "rgba(245,158,11,0.06)" }}>
                          <div className="flex flex-col items-center gap-0.5">
                            <Coffee className="w-3 h-3" style={{ color: "#f59e0b" }} />
                            <span className="text-[10px] font-bold" style={{ color: "#f59e0b" }}>{srow.label || "Break"}</span>
                            {srow.startTime && (
                              <span className="text-[9px]" style={{ color: "rgba(245,158,11,0.6)" }}>
                                {formatTime(srow.startTime)}–{formatTime(srow.endTime)}
                              </span>
                            )}
                          </div>
                        </td>
                        {DAY_NAMES.map((_, di) => (
                          <td key={di} className="border-b border-r p-1" style={{ borderColor: "rgba(255,255,255,0.06)", backgroundColor: "rgba(245,158,11,0.03)" }}>
                            <div className="min-h-[44px] flex items-center justify-center">
                              <span className="text-[10px] font-medium" style={{ color: "rgba(245,158,11,0.25)" }}>{srow.label || "Break"}</span>
                            </div>
                          </td>
                        ))}
                      </tr>
                    );
                  }

                  const p = srow.periodNumber;
                  const isPeriodActive = isCurrentPeriod(srow);

                  return (
                    <tr key={sIdx}>
                      {/* Period label */}
                      <td className="border-b border-r p-2 text-center" style={{ borderColor: "rgba(255,255,255,0.06)", backgroundColor: "rgba(15,30,53,0.5)" }}>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[11px] font-bold" style={{ color: isPeriodActive ? "#10b981" : "rgba(255,255,255,0.8)" }}>
                            P{p}
                          </span>
                          {srow.startTime && (
                            <span className="text-[9px] font-semibold" style={{ color: isPeriodActive ? "#10b981" : "rgba(255,255,255,0.35)" }}>
                              {formatTime(srow.startTime)}
                            </span>
                          )}
                          {srow.endTime && (
                            <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                              {formatTime(srow.endTime)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Day cells */}
                      {DAY_NAMES.map((_, dayIdx) => {
                        const entry = explorerEntries.find(e => e.dayOfWeek === dayIdx && e.period === p);
                        /* Only highlight as active if this is today's column AND current time falls in this period */
                        const isActive = isPeriodActive && dayIdx === todayDayIndex();
                        const col = entry ? getSubjectColor(entry.subject) : null;

                        return (
                          <td
                            key={dayIdx}
                            className="border-b border-r p-1.5 min-w-[90px]"
                            style={{ borderColor: "rgba(255,255,255,0.06)" }}
                            data-testid={`explorer-cell-${dayIdx}-${p}`}
                          >
                            {entry ? (
                              /* Filled slot — own slot is editable; another teacher's slot is read-only */
                              entry.teacherId === teacherId ? (
                                <div
                                  className={`rounded-xl p-2.5 min-h-[54px] flex flex-col justify-between cursor-pointer transition-all group relative ${isActive ? "animate-pulse-border" : ""}`}
                                  style={{
                                    backgroundColor: col?.bg,
                                    border: `1.5px solid ${isActive ? "#10b981" : col?.border}`,
                                    boxShadow: isActive ? "0 0 12px rgba(16,185,129,0.3)" : "none",
                                  }}
                                  onClick={() => setModal({ day: dayIdx, period: p, existing: entry })}
                                  data-testid={`slot-own-${dayIdx}-${p}`}
                                >
                                  <div>
                                    <p className="text-[11px] font-bold leading-tight" style={{ color: "#ffffff" }}>{entry.subject}</p>
                                    <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>{entry.teacherName || "—"}</p>
                                  </div>
                                  <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
                                      <ChevronRight className="w-3 h-3" style={{ color: "#ffffff" }} />
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                /* Read-only: another teacher's slot — not editable */
                                <div
                                  className="rounded-xl p-2.5 min-h-[54px] flex flex-col justify-center"
                                  style={{
                                    backgroundColor: "rgba(100,116,139,0.12)",
                                    border: "1.5px solid rgba(100,116,139,0.3)",
                                  }}
                                  data-testid={`slot-other-${dayIdx}-${p}`}
                                >
                                  <p className="text-[11px] font-bold leading-tight" style={{ color: "rgba(255,255,255,0.7)" }}>{entry.subject}</p>
                                  <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>{entry.teacherName || "—"}</p>
                                </div>
                              )
                            ) : (
                              /* Empty slot */
                              <button
                                className="w-full min-h-[54px] rounded-xl flex items-center justify-center transition-all group"
                                style={{
                                  border: "1.5px dashed rgba(255,255,255,0.15)",
                                  backgroundColor: "transparent",
                                }}
                                onMouseEnter={e => {
                                  (e.currentTarget as HTMLElement).style.borderColor = "#10b981";
                                  (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(16,185,129,0.06)";
                                }}
                                onMouseLeave={e => {
                                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.15)";
                                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                                }}
                                onClick={() => setModal({ day: dayIdx, period: p, existing: null })}
                                data-testid={`button-add-slot-${dayIdx}-${p}`}
                              >
                                <Plus className="w-4 h-4 transition-colors" style={{ color: "rgba(255,255,255,0.2)" }} />
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

          {/* Legend */}
          <div className="flex flex-wrap gap-3 pt-1">
            {Object.entries(SUBJECT_COLORS).filter(([k]) => k !== "default").slice(0, 6).map(([name, col]) => (
              <div key={name} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.dot }} />
                <span className="text-[10px] font-medium capitalize" style={{ color: "rgba(255,255,255,0.4)" }}>{name}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* helper: detect if structure is the fallback (no IDs) */
function explorerData_structureIsDefault(rows: StructureRow[]) {
  return rows.every(r => !r.id);
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
      {/* Header */}
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4" style={{ color: "#10b981" }} />
        <h3 className="text-sm font-bold" style={{ color: "#ffffff" }}>My Schedule</h3>
        <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>
          Read-only
        </span>
      </div>

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
              className="flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl min-w-[50px] transition-all"
              style={{
                backgroundColor: isSelected ? "#10b981" : isToday ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.05)",
                border: isToday && !isSelected ? "1px solid rgba(16,185,129,0.4)" : "1px solid transparent",
              }}
              data-testid={`day-btn-${i}`}
            >
              <span className="text-[10px] font-bold" style={{ color: isSelected ? "#ffffff" : "rgba(255,255,255,0.5)" }}>{d}</span>
              {dayCount > 0 && (
                <span className="text-[9px] font-bold px-1 rounded-full" style={{
                  backgroundColor: isSelected ? "rgba(255,255,255,0.2)" : "rgba(16,185,129,0.2)",
                  color: isSelected ? "#ffffff" : "#10b981",
                }}>
                  {dayCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Day label */}
      <div className="flex items-center gap-2">
        <p className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>{DAY_FULL[selectedDay]}</p>
        {selectedDay === today && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(16,185,129,0.2)", color: "#10b981" }}>Today</span>
        )}
      </div>

      {/* Timeline */}
      {dayEntries.length === 0 ? (
        <div className="rounded-2xl border p-12 flex flex-col items-center gap-3 text-center" style={{ borderColor: "rgba(255,255,255,0.08)", borderStyle: "dashed", backgroundColor: "rgba(255,255,255,0.02)" }}>
          <Clock className="w-8 h-8" style={{ color: "rgba(255,255,255,0.15)" }} />
          <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.3)" }}>No classes on {DAY_NAMES[selectedDay]}</p>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.18)" }}>Assign yourself to periods in Class Explorer</p>
        </div>
      ) : (
        <div className="space-y-3">
          {dayEntries.map((entry, idx) => {
            const srow = scheduleStructure.find(r => !r.isBreak && r.periodNumber === entry.period);
            /* Active only when viewing today AND the current system time is within this period */
            const active = selectedDay === todayDayIndex() && (srow ? isCurrentPeriod(srow) : false);
            const col = getSubjectColor(entry.subject);

            return (
              <div
                key={entry.id ?? idx}
                className="flex gap-0 overflow-hidden rounded-2xl transition-all"
                style={{
                  border: `1.5px solid ${active ? "#10b981" : col.border}`,
                  boxShadow: active ? "0 0 16px rgba(16,185,129,0.25)" : "none",
                  animation: active ? "pulse-glow 2s ease-in-out infinite" : "none",
                }}
                data-testid={`schedule-card-${entry.id ?? idx}`}
              >
                {/* Colored left bar */}
                <div className="w-1 flex-shrink-0 rounded-l-2xl" style={{ backgroundColor: col.dot }} />

                {/* Card body */}
                <div className="flex-1 p-4" style={{ backgroundColor: col.bg }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 flex-1">
                      {/* Subject */}
                      <p className="text-sm font-bold leading-tight" style={{ color: "#ffffff" }}>{entry.subject}</p>
                      {/* Class + Section */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "#ffffff" }}>
                          Class {entry.class} – {entry.section}
                        </span>
                        {entry.room && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}>
                            <DoorOpen className="w-3 h-3" />
                            {entry.room}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Time + Period */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-[11px] font-bold" style={{ color: active ? "#10b981" : "rgba(255,255,255,0.6)" }}>
                        P{entry.period}
                      </p>
                      {srow?.startTime && (
                        <p className="text-[10px] font-semibold mt-0.5" style={{ color: active ? "#10b981" : "rgba(255,255,255,0.45)" }}>
                          {formatTime(srow.startTime)}
                        </p>
                      )}
                      {srow?.endTime && (
                        <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                          {formatTime(srow.endTime)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Active NOW badge */}
                  {active && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#10b981", animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite" }} />
                      <span className="text-[10px] font-bold" style={{ color: "#10b981" }}>You should be here NOW</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Total summary */}
      {myEntries.length > 0 && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl mt-2" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Total assigned periods (week)</span>
          <span className="text-sm font-bold" style={{ color: "#10b981" }}>{myEntries.length}</span>
        </div>
      )}
    </div>
  );
}
