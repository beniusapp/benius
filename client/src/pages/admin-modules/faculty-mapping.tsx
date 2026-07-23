import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Search, Save, Loader2, X, Users, BookOpen,
  Grid3X3, ChevronDown, AlertTriangle, CheckCircle2,
  XCircle, Sparkles, Filter, Zap, Edit2, Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import type { Teacher } from "@shared/schema";

interface Props { schoolId: number; classes: string[]; sections: string[]; subjects: string[]; allowedSubs?: string[] }
type TeacherWithEmail = Teacher & { email: string };
type MappingRow = { id: number; teacherId: number; teacherName: string; email: string; className: string; section: string; schoolId: number; subject?: string | null };

const DEFAULT_CLASSES  = ["1","2","3","4","5","6","7","8","9","10","11","12"];
const DEFAULT_SECTIONS = ["A","B","C","D"];

/* ── colour palette for teacher card avatars ─────────────────────────── */
const AVATAR_PALETTES = [
  { bg: "from-violet-500 to-indigo-600",  ring: "ring-violet-500/40",  glow: "shadow-violet-500/20" },
  { bg: "from-teal-400 to-emerald-600",   ring: "ring-teal-400/40",    glow: "shadow-teal-400/20"   },
  { bg: "from-rose-500 to-pink-600",      ring: "ring-rose-500/40",    glow: "shadow-rose-500/20"   },
  { bg: "from-amber-400 to-orange-500",   ring: "ring-amber-400/40",   glow: "shadow-amber-400/20"  },
  { bg: "from-sky-400 to-blue-600",       ring: "ring-sky-400/40",     glow: "shadow-sky-400/20"    },
  { bg: "from-fuchsia-500 to-purple-600", ring: "ring-fuchsia-500/40", glow: "shadow-fuchsia-500/20"},
];

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getPalette(id: number) { return AVATAR_PALETTES[id % AVATAR_PALETTES.length]; }

/* ── tiny Select dropdown ────────────────────────────────────────────── */
function FilterSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: { label: string; value: string }[]; placeholder: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="
          appearance-none h-9 pl-3 pr-8 rounded-xl
          bg-white/5 border border-white/10 text-white/70
          text-xs backdrop-blur-sm
          hover:bg-white/10 hover:border-white/20 focus:outline-none
          focus:border-[#D4AF37]/60 transition-all cursor-pointer
        "
      >
        <option value="" className="bg-[#0F1E35]">{placeholder}</option>
        {options.map(o => (
          <option key={o.value} value={o.value} className="bg-[#0F1E35]">{o.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/40 pointer-events-none" />
    </div>
  );
}

/* ── KPI badge ───────────────────────────────────────────────────────── */
function KpiBadge({ color, icon: Icon, label, count }: {
  color: "green" | "red"; icon: React.ComponentType<{ className?: string }>;
  label: string; count: number;
}) {
  const cfg = color === "green"
    ? { outer: "bg-emerald-500/10 border-emerald-500/30", dot: "bg-emerald-400", text: "text-emerald-400", num: "text-emerald-300" }
    : { outer: "bg-red-500/10 border-red-500/30",         dot: "bg-red-400",     text: "text-red-400",     num: "text-red-300"     };
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border backdrop-blur-sm ${cfg.outer}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot} animate-pulse`} />
      <span className={`text-xs font-medium ${cfg.text}`}>{label}</span>
      <span className={`text-sm font-bold ${cfg.num}`}>{count}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
export default function FacultyMapping({ schoolId, classes, sections, allowedSubs }: Props) {
  const canAssign = allowedSubs === undefined || allowedSubs.includes("assign");
  const { toast } = useToast();

  /* ── filter / search state ─── */
  const [searchQ,        setSearchQ]        = useState("");
  const [filterStatus,   setFilterStatus]   = useState("");   // "" | "mapped" | "unmapped"
  const [filterSubject,  setFilterSubject]  = useState("");
  const [filterClass,    setFilterClass]    = useState("");

  /* ── selection & grid state ─── */
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherWithEmail | null>(null);
  const [selectedCells,   setSelectedCells]   = useState<Set<string>>(new Set());
  const [cellSubjects,    setCellSubjects]    = useState<Map<string, string>>(new Map());
  const [savingFor,       setSavingFor]       = useState<number | null>(null);

  /* ── subject dialog (multi-select) ─── */
  const [pendingCells,    setPendingCells]    = useState<{ cls: string; section: string }[] | null>(null);
  const [pendingSubjects, setPendingSubjects] = useState<Set<string>>(new Set());
  const [customInput,     setCustomInput]     = useState("");

  /* ── bottom-table view ─── */
  const [summaryFilter, setSummaryFilter] = useState<"all"|"mapped"|"unmapped">("all");

  /* ── data fetching ────────────────────────────────────────────── */
  const { data: schoolConfig } = useQuery<{ classes: string[]; sections: string[]; subjects: string[] }>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [] };
    },
  });

  const cfgClasses  = (schoolConfig?.classes  ?? []).length > 0 ? schoolConfig!.classes  : (classes.length  > 0 ? classes  : DEFAULT_CLASSES);
  const cfgSections = (schoolConfig?.sections ?? []).length > 0 ? schoolConfig!.sections : (sections.length > 0 ? sections : DEFAULT_SECTIONS);
  const cfgSubjects = schoolConfig?.subjects ?? [];

  const { data: teachers = [], isLoading: teachersLoading } = useQuery<TeacherWithEmail[]>({
    queryKey: ["/api/schools", schoolId, "teachers"],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/teachers`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: allMappings = [], isLoading: mappingsLoading } = useQuery<MappingRow[]>({
    queryKey: ["/api/admin/faculty-mappings"],
    queryFn: async () => {
      const r = await fetch("/api/admin/faculty-mappings", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  /* ── derived data ─────────────────────────────────────────────── */
  const teacherMappingCounts = useMemo(() => {
    const map = new Map<number, number>();
    allMappings.forEach(m => map.set(m.teacherId, (map.get(m.teacherId) ?? 0) + 1));
    return map;
  }, [allMappings]);

  /** Map of "cls:section" → { teacherId, teacherName } for collision detection */
  const cellOwnerMap = useMemo(() => {
    const map = new Map<string, { teacherId: number; teacherName: string }>();
    allMappings.forEach(m => {
      const key = `${m.className}:${m.section}`;
      if (!map.has(key)) map.set(key, { teacherId: m.teacherId, teacherName: m.teacherName });
    });
    return map;
  }, [allMappings]);

  const mappingsByTeacher = useMemo(() => {
    const map = new Map<number, { name: string; email: string; assignments: { className: string; section: string; subject: string | null }[] }>();
    allMappings.forEach(m => {
      if (!map.has(m.teacherId)) map.set(m.teacherId, { name: m.teacherName, email: m.email, assignments: [] });
      map.get(m.teacherId)!.assignments.push({ className: m.className, section: m.section, subject: m.subject ?? null });
    });
    return map;
  }, [allMappings]);

  const mappedCount   = useMemo(() => teachers.filter(t => (teacherMappingCounts.get(t.id) ?? 0) > 0).length, [teachers, teacherMappingCounts]);
  const unmappedCount = teachers.length - mappedCount;

  /* ── unique subjects already assigned (for filter dropdown) ─── */
  const assignedSubjects = useMemo(() => {
    const s = new Set<string>();
    allMappings.forEach(m => { if (m.subject) s.add(m.subject); });
    cfgSubjects.forEach(s2 => s.add(s2));
    return Array.from(s).sort();
  }, [allMappings, cfgSubjects]);

  /* ── filtered teacher list ─────────────────────────────────── */
  const filteredTeachers = useMemo(() => {
    let list = [...teachers];
    const q = searchQ.toLowerCase();
    if (q) list = list.filter(t =>
      t.fullName.toLowerCase().includes(q) ||
      t.email.toLowerCase().includes(q) ||
      (t.subject ?? "").toLowerCase().includes(q)
    );
    if (filterStatus === "mapped")   list = list.filter(t => (teacherMappingCounts.get(t.id) ?? 0) > 0);
    if (filterStatus === "unmapped") list = list.filter(t => (teacherMappingCounts.get(t.id) ?? 0) === 0);
    if (filterSubject) list = list.filter(t =>
      allMappings.some(m => m.teacherId === t.id && m.subject === filterSubject) ||
      (t.subject ?? "").toLowerCase().includes(filterSubject.toLowerCase())
    );
    if (filterClass) list = list.filter(t =>
      allMappings.some(m => m.teacherId === t.id && m.className === filterClass)
    );
    return list;
  }, [teachers, searchQ, filterStatus, filterSubject, filterClass, teacherMappingCounts, allMappings]);

  /* ── select teacher ────────────────────────────────────────── */
  const handleSelectTeacher = useCallback((teacher: TeacherWithEmail) => {
    setSelectedTeacher(teacher);
    const existingMaps = allMappings.filter(m => m.teacherId === teacher.id);
    const cells = new Set(existingMaps.map(m => `${m.className}:${m.section}`));
    const subjects = new Map<string, string>();
    existingMaps.forEach(m => { if (m.subject) subjects.set(`${m.className}:${m.section}`, m.subject); });
    setSelectedCells(cells);
    setCellSubjects(subjects);
  }, [allMappings]);

  /* ── subject dialog (multi-select) ─────────────────────────── */
  const openSubjectDialogForCells = useCallback((
    cells: { cls: string; section: string }[],
    existingSubject?: string
  ) => {
    if (cells.length === 0) return;
    setPendingCells(cells);
    // Pre-populate with existing subjects when editing a single cell
    const initial = new Set<string>();
    if (existingSubject) {
      existingSubject.split(",").map(s => s.trim()).filter(Boolean).forEach(s => initial.add(s));
    }
    setPendingSubjects(initial);
    setCustomInput("");
  }, []);

  const togglePendingSubject = useCallback((subj: string) => {
    setPendingSubjects(prev => {
      const next = new Set(prev);
      if (next.has(subj)) next.delete(subj);
      else next.add(subj);
      return next;
    });
  }, []);

  const addCustomSubject = useCallback(() => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    setPendingSubjects(prev => new Set([...prev, trimmed]));
    setCustomInput("");
  }, [customInput]);

  const confirmSubjectDialog = useCallback(() => {
    if (!pendingCells) return;
    const subjectStr = Array.from(pendingSubjects).join(", ");
    setSelectedCells(prev => {
      const next = new Set(prev);
      pendingCells.forEach(({ cls, section }) => next.add(`${cls}:${section}`));
      return next;
    });
    setCellSubjects(prev => {
      const next = new Map(prev);
      pendingCells.forEach(({ cls, section }) => {
        const key = `${cls}:${section}`;
        if (subjectStr) next.set(key, subjectStr);
        else next.delete(key);
      });
      return next;
    });
    setPendingCells(null);
    setPendingSubjects(new Set());
    setCustomInput("");
  }, [pendingCells, pendingSubjects]);

  const cancelSubjectDialog = useCallback(() => {
    setPendingCells(null);
    setPendingSubjects(new Set());
    setCustomInput("");
  }, []);

  /* ── cell / row / col toggles ─────────────────────────────── */
  const toggleCell = useCallback((cls: string, section: string) => {
    const key = `${cls}:${section}`;
    if (selectedCells.has(key)) {
      // Re-open dialog pre-filled so user can edit subjects (hold Shift to remove directly)
      openSubjectDialogForCells([{ cls, section }], cellSubjects.get(key));
    } else {
      openSubjectDialogForCells([{ cls, section }]);
    }
  }, [selectedCells, cellSubjects, openSubjectDialogForCells]);

  const toggleRow = useCallback((cls: string) => {
    const allSelected = cfgSections.every(s => selectedCells.has(`${cls}:${s}`));
    if (allSelected) {
      setSelectedCells(prev => { const n = new Set(prev); cfgSections.forEach(s => n.delete(`${cls}:${s}`)); return n; });
      setCellSubjects(prev => { const n = new Map(prev); cfgSections.forEach(s => n.delete(`${cls}:${s}`)); return n; });
    } else {
      openSubjectDialogForCells(cfgSections.filter(s => !selectedCells.has(`${cls}:${s}`)).map(s => ({ cls, section: s })));
    }
  }, [cfgSections, selectedCells, openSubjectDialogForCells]);

  const toggleCol = useCallback((section: string) => {
    const allSelected = cfgClasses.every(c => selectedCells.has(`${c}:${section}`));
    if (allSelected) {
      setSelectedCells(prev => { const n = new Set(prev); cfgClasses.forEach(c => n.delete(`${c}:${section}`)); return n; });
      setCellSubjects(prev => { const n = new Map(prev); cfgClasses.forEach(c => n.delete(`${c}:${section}`)); return n; });
    } else {
      openSubjectDialogForCells(cfgClasses.filter(c => !selectedCells.has(`${c}:${section}`)).map(c => ({ cls: c, section })));
    }
  }, [cfgClasses, selectedCells, openSubjectDialogForCells]);

  /* ── mutations ────────────────────────────────────────────── */
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTeacher) return;
      setSavingFor(selectedTeacher.id);
      const mappings = Array.from(selectedCells).map(key => {
        const [className, section] = key.split(":");
        return { className, section, subject: cellSubjects.get(key) ?? null };
      });
      const r = await apiRequest("POST", "/api/admin/faculty-mappings", { teacherId: selectedTeacher.id, mappings });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping Saved", description: `${selectedTeacher?.fullName}'s assignments have been updated.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/faculty-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher-me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/faculty"] });
      setSavingFor(null);
    },
    onError: (e: Error) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); setSavingFor(null); },
  });

  const clearMutation = useMutation({
    mutationFn: async (teacherId: number) => { await apiRequest("DELETE", `/api/admin/faculty-mappings/${teacherId}`); },
    onSuccess: () => {
      toast({ title: "Mappings Cleared" });
      if (selectedTeacher) { setSelectedCells(new Set()); setCellSubjects(new Map()); }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/faculty-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher-me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/faculty"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  /* ── summary table rows ──────────────────────────────────── */
  const summaryRows = useMemo(() => {
    const mapped = Array.from(mappingsByTeacher.entries()).map(([id, e]) => ({ id, ...e, isMapped: true }));
    const unmappedTeachers = teachers
      .filter(t => !mappingsByTeacher.has(t.id))
      .map(t => ({ id: t.id, name: t.fullName, email: t.email, assignments: [], isMapped: false }));
    const all = [...mapped, ...unmappedTeachers];
    if (summaryFilter === "mapped")   return all.filter(r => r.isMapped);
    if (summaryFilter === "unmapped") return all.filter(r => !r.isMapped);
    return all;
  }, [mappingsByTeacher, teachers, summaryFilter]);

  const hasAnyFilters = searchQ || filterStatus || filterSubject || filterClass;

  /* ════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#D4AF37]" />
            Faculty Mapping
          </h2>
          <p className="text-white/40 text-xs mt-0.5">
            Assign teachers to classes & sections with subjects. Select a teacher, then toggle cells in the matrix.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <KpiBadge color="green" icon={CheckCircle2} label="Mapped"   count={mappedCount}   />
          <KpiBadge color="red"   icon={XCircle}      label="Unmapped" count={unmappedCount} />
        </div>
      </div>

      {/* ── Search + Filter Bar ─────────────────────────────── */}
      <div className="
        flex flex-wrap items-center gap-2 p-3 rounded-2xl
        bg-white/[0.03] border border-white/10 backdrop-blur-xl
      ">
        {/* Global search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
          <Input
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="Search faculty by name, subject, or class…"
            className="
              pl-9 h-9 text-xs bg-white/5 border-white/10 text-white
              placeholder:text-white/30 rounded-xl
              focus:border-[#D4AF37]/50 focus:bg-white/8 transition-all
            "
            data-testid="input-search-faculty-mapping"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-white/30 ml-1" />

          <FilterSelect
            value={filterStatus}
            onChange={setFilterStatus}
            placeholder="All Faculty"
            options={[
              { label: "Mapped Only",         value: "mapped"   },
              { label: "Unmapped / Unassigned", value: "unmapped" },
            ]}
          />

          <FilterSelect
            value={filterSubject}
            onChange={setFilterSubject}
            placeholder="All Subjects"
            options={assignedSubjects.map(s => ({ label: s, value: s }))}
          />

          <FilterSelect
            value={filterClass}
            onChange={setFilterClass}
            placeholder="All Classes"
            options={cfgClasses.map(c => ({ label: `Class ${c}`, value: c }))}
          />

          {hasAnyFilters && (
            <button
              onClick={() => { setSearchQ(""); setFilterStatus(""); setFilterSubject(""); setFilterClass(""); }}
              className="h-9 px-2.5 rounded-xl text-xs text-white/50 hover:text-white hover:bg-white/10 transition-all flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Subject Prompt Dialog (multi-select) ────────────── */}
      <Dialog open={!!pendingCells} onOpenChange={open => { if (!open) cancelSubjectDialog(); }}>
        <DialogContent className="bg-[#0d1b2e]/95 border border-white/10 text-white max-w-sm backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#D4AF37]" /> Assign Subjects
            </DialogTitle>
          </DialogHeader>

          {/* target label */}
          {pendingCells && (
            <p className="text-white/50 text-sm -mt-1">
              {pendingCells.length === 1
                ? <>Class <span className="text-[#D4AF37] font-semibold">{pendingCells[0].cls}</span> – Section <span className="text-[#D4AF37] font-semibold">{pendingCells[0].section}</span></>
                : <><span className="text-[#D4AF37] font-semibold">{pendingCells.length} cells</span> will receive these subjects</>
              }
            </p>
          )}

          {/* selected preview chips */}
          {pendingSubjects.size > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {Array.from(pendingSubjects).map(s => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#D4AF37] text-[#0A1628] text-[11px] font-bold"
                >
                  {s}
                  <button
                    onClick={() => togglePendingSubject(s)}
                    className="hover:opacity-70 transition-opacity ml-0.5"
                    aria-label={`Remove ${s}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {/* preset subject grid — multi-toggle */}
            {cfgSubjects.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#D4AF37_transparent]">
                {cfgSubjects.map(s => {
                  const isChosen = pendingSubjects.has(s);
                  return (
                    <button
                      key={s}
                      onClick={() => togglePendingSubject(s)}
                      data-testid={`subject-option-${s}`}
                      className={`
                        text-xs px-2.5 py-2 rounded-xl border transition-all text-left
                        flex items-center justify-between gap-1
                        ${isChosen
                          ? "bg-[#D4AF37]/20 border-[#D4AF37]/60 text-[#D4AF37] font-semibold"
                          : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/25"
                        }
                      `}
                    >
                      <span>{s}</span>
                      {isChosen && (
                        <span className="w-4 h-4 rounded-full bg-[#D4AF37] flex items-center justify-center flex-shrink-0">
                          <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-[#0A1628]">
                            <path d="M1 4l2.5 2.5L9 1" stroke="#0A1628" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* custom subject input */}
            <div className="flex gap-2">
              <Input
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                placeholder="Type a custom subject…"
                className="flex-1 bg-white/5 border-white/15 text-white placeholder:text-white/30 text-sm h-9 rounded-xl focus:border-[#D4AF37]/50"
                data-testid="input-pending-subject"
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); addCustomSubject(); }
                  if (e.key === "Escape") cancelSubjectDialog();
                }}
                autoFocus={cfgSubjects.length === 0}
              />
              <button
                onClick={addCustomSubject}
                disabled={!customInput.trim()}
                className="h-9 px-3 rounded-xl text-xs font-semibold bg-white/8 border border-white/15 text-white/60 hover:bg-white/12 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all whitespace-nowrap"
              >
                + Add
              </button>
            </div>
          </div>

          <DialogFooter className="gap-2 mt-1">
            <Button variant="outline" size="sm" className="border-white/20 text-white/60 hover:bg-white/10" onClick={cancelSubjectDialog} data-testid="button-cancel-subject-dialog">
              Cancel
            </Button>
            {/* Allow deselecting a cell by confirming with 0 subjects */}
            <Button
              size="sm"
              className="bg-gradient-to-r from-[#D4AF37] to-amber-500 hover:from-[#B8962E] hover:to-amber-600 text-[#0A1628] font-bold"
              onClick={confirmSubjectDialog}
              data-testid="button-confirm-subject-dialog"
            >
              {pendingSubjects.size === 0
                ? "Assign (no subject)"
                : `Assign ${pendingSubjects.size} Subject${pendingSubjects.size > 1 ? "s" : ""}`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Split Panel ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* ═══ LEFT: Faculty Card Directory ═══════════════════ */}
        <div className="lg:col-span-2 flex flex-col">
          <div className="
            flex-1 rounded-2xl border border-white/10 overflow-hidden
            bg-white/[0.03] backdrop-blur-xl
            flex flex-col
          ">
            {/* panel header */}
            <div className="px-4 py-3 border-b border-white/8 bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#D4AF37]/20 to-amber-600/10 border border-[#D4AF37]/20 flex items-center justify-center">
                  <Users className="w-3.5 h-3.5 text-[#D4AF37]" />
                </div>
                <span className="text-xs font-bold text-white/70 uppercase tracking-widest">
                  Faculty Directory
                </span>
              </div>
              <span className="text-xs text-white/30 font-mono">{filteredTeachers.length}/{teachers.length}</span>
            </div>

            {/* teacher cards */}
            <div className="flex-1 overflow-y-auto max-h-[520px] [scrollbar-width:thin] [scrollbar-color:#D4AF37_transparent] p-2 space-y-1.5">
              {teachersLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]/60" />
                  <p className="text-white/30 text-xs">Loading faculty…</p>
                </div>
              ) : !filteredTeachers.length ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <Users className="w-8 h-8 text-white/10" />
                  <p className="text-white/30 text-xs text-center px-4">
                    {hasAnyFilters ? "No teachers match your filters." : "No teachers found. Add teachers first."}
                  </p>
                </div>
              ) : (
                filteredTeachers.map(t => {
                  const isSelected  = selectedTeacher?.id === t.id;
                  const count       = teacherMappingCounts.get(t.id) ?? 0;
                  const isMapped    = count > 0;
                  const palette     = getPalette(t.id);
                  const initials    = getInitials(t.fullName);

                  return (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTeacher(t)}
                      data-testid={`button-select-teacher-${t.id}`}
                      className={`
                        w-full text-left p-3 rounded-xl border transition-all duration-200 group
                        ${isSelected
                          ? `bg-[#D4AF37]/10 border-[#D4AF37]/40 shadow-lg shadow-[#D4AF37]/10`
                          : `bg-white/[0.02] border-white/8 hover:bg-white/5 hover:border-white/15 hover:shadow-md ${palette.glow}`
                        }
                      `}
                    >
                      <div className="flex items-center gap-3">
                        {/* avatar */}
                        <div className={`
                          w-10 h-10 rounded-xl bg-gradient-to-br ${palette.bg}
                          flex items-center justify-center flex-shrink-0
                          ring-2 ${isSelected ? "ring-[#D4AF37]/50" : `${palette.ring} ring-offset-0`}
                          text-white text-xs font-bold shadow-lg
                          transition-transform group-hover:scale-105
                        `}>
                          {initials}
                        </div>

                        {/* info */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold truncate leading-tight ${isSelected ? "text-[#D4AF37]" : "text-white"}`}>
                            {t.fullName}
                          </p>
                          <p className="text-[11px] text-white/40 truncate mt-0.5">{t.subject || "—"}</p>
                        </div>

                        {/* badge */}
                        {isMapped ? (
                          <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-[10px] font-semibold whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            {count} {count === 1 ? "Class" : "Classes"}
                          </span>
                        ) : (
                          <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-semibold whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            Unmapped
                          </span>
                        )}
                      </div>

                      {/* mini subject pills if mapped */}
                      {isMapped && mappingsByTeacher.has(t.id) && (
                        <div className="mt-2 flex flex-wrap gap-1 pl-13">
                          {Array.from(new Set(
                            (mappingsByTeacher.get(t.id)?.assignments ?? []).map(a => a.subject).filter(Boolean)
                          )).slice(0, 4).map((subj, i) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-md bg-[#D4AF37]/10 border border-[#D4AF37]/20 text-[#D4AF37]/80">
                              {subj}
                            </span>
                          ))}
                          {(mappingsByTeacher.get(t.id)?.assignments ?? []).length > 4 && (
                            <span className="text-[9px] text-white/30">+{(mappingsByTeacher.get(t.id)?.assignments ?? []).length - 4} more</span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ═══ RIGHT: Assignment Matrix ════════════════════════ */}
        <div className="lg:col-span-3 flex flex-col">
          {!selectedTeacher ? (
            <div className="
              flex-1 rounded-2xl border border-white/8 bg-white/[0.02] backdrop-blur-xl
              flex flex-col items-center justify-center min-h-[400px] gap-4
            ">
              <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                <Grid3X3 className="w-8 h-8 text-white/15" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-white/40 text-sm font-medium">No teacher selected</p>
                <p className="text-white/20 text-xs">Choose a faculty member from the left panel<br/>to start assigning classes and subjects</p>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-white/20 mt-2">
                <Zap className="w-3 h-3" /> Click any teacher card to begin
              </div>
            </div>
          ) : (
            <div className="
              flex-1 rounded-2xl border border-white/10 overflow-hidden
              bg-white/[0.03] backdrop-blur-xl flex flex-col
            ">
              {/* panel header */}
              <div className="px-4 py-3 border-b border-white/8 bg-white/[0.02] flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`
                    w-9 h-9 rounded-xl bg-gradient-to-br ${getPalette(selectedTeacher.id).bg}
                    flex items-center justify-center flex-shrink-0 text-white text-xs font-bold shadow-lg
                  `}>
                    {getInitials(selectedTeacher.fullName)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{selectedTeacher.fullName}</p>
                    <p className="text-[11px] text-white/40 truncate">
                      {selectedTeacher.subject} · <span className="text-[#D4AF37]">{selectedCells.size}</span> cell{selectedCells.size !== 1 ? "s" : ""} selected
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setSelectedCells(new Set()); setCellSubjects(new Map()); }}
                    className="h-8 px-3 rounded-xl text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/8 transition-all flex items-center gap-1.5"
                    data-testid="button-clear-grid-selection"
                  >
                    <X className="w-3 h-3" /> Clear
                  </button>
                  <Button
                    size="sm"
                    className="h-8 bg-gradient-to-r from-[#D4AF37] to-amber-500 hover:from-[#B8962E] hover:to-amber-600 text-[#0A1628] font-bold text-xs px-4 rounded-xl shadow-lg shadow-[#D4AF37]/20"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || !canAssign}
                    data-testid="button-save-faculty-mapping"
                  >
                    {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <Save className="w-3 h-3 mr-1.5" />}
                    Save Mapping
                  </Button>
                </div>
              </div>

              {/* matrix: section header row */}
              <div className="p-4 overflow-y-auto max-h-[460px] [scrollbar-width:thin] [scrollbar-color:#D4AF37_transparent]">

                {/* Section column toggles */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-[10px] text-white/30 uppercase tracking-wider mr-1">Sections →</span>
                  {cfgSections.map(sec => (
                    <button
                      key={sec}
                      onClick={() => toggleCol(sec)}
                      data-testid={`button-toggle-section-${sec}`}
                      className="
                        w-8 h-8 rounded-lg border border-white/15 bg-white/5 text-white/60
                        hover:bg-[#D4AF37]/15 hover:border-[#D4AF37]/40 hover:text-[#D4AF37]
                        text-xs font-bold transition-all
                      "
                      title={`Toggle all classes for Section ${sec}`}
                    >
                      {sec}
                    </button>
                  ))}
                  <span className="text-[10px] text-white/20 ml-auto">Click section/class headers to toggle all</span>
                </div>

                {/* class rows as cards */}
                <div className="space-y-2">
                  {cfgClasses.map(cls => {
                    const rowSelected = cfgSections.every(s => selectedCells.has(`${cls}:${s}`));
                    return (
                      <div key={cls} className={`
                        rounded-xl border p-3 transition-all duration-200
                        ${rowSelected
                          ? "bg-[#D4AF37]/5 border-[#D4AF37]/25"
                          : "bg-white/[0.02] border-white/8 hover:border-white/12"
                        }
                      `}>
                        <div className="flex items-center gap-3 flex-wrap">
                          {/* class label / row toggle */}
                          <button
                            onClick={() => toggleRow(cls)}
                            data-testid={`button-toggle-class-${cls}`}
                            title={`Toggle all sections for Class ${cls}`}
                            className={`
                              w-14 h-8 rounded-lg border text-xs font-bold transition-all flex-shrink-0
                              ${rowSelected
                                ? "bg-[#D4AF37]/20 border-[#D4AF37]/50 text-[#D4AF37]"
                                : "bg-white/5 border-white/15 text-white/50 hover:bg-white/10 hover:text-white"
                              }
                            `}
                          >
                            Cls {cls}
                          </button>

                          {/* section cells */}
                          <div className="flex flex-wrap gap-2 flex-1">
                            {cfgSections.map(sec => {
                              const key            = `${cls}:${sec}`;
                              const isOn           = selectedCells.has(key);
                              const subj           = cellSubjects.get(key);
                              const subjList       = subj ? subj.split(",").map(s => s.trim()).filter(Boolean) : [];
                              const owner          = cellOwnerMap.get(key);
                              const isOwnedByOther = owner && owner.teacherId !== selectedTeacher.id;
                              const isCollision    = isOwnedByOther && isOn;

                              return (
                                <div key={sec} className="relative group/cell">
                                  {/* main cell button — click to open edit dialog */}
                                  <button
                                    onClick={() => toggleCell(cls, sec)}
                                    data-testid={`cell-${cls}-${sec}`}
                                    title={
                                      isCollision
                                        ? `⚠️ Collision: ${owner?.teacherName} also has ${cls}-${sec}`
                                        : isOn
                                          ? `Edit subjects for ${cls}-${sec}`
                                          : `Assign Class ${cls} – Section ${sec}`
                                    }
                                    className={`
                                      relative h-auto min-w-[56px] max-w-[90px] px-2 py-1.5 rounded-lg border
                                      text-[10px] font-semibold transition-all duration-150
                                      flex flex-col items-start gap-0.5 text-left
                                      ${isCollision
                                        ? "bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-md shadow-amber-500/10"
                                        : isOn
                                          ? "bg-gradient-to-br from-[#D4AF37]/30 to-amber-500/20 border-[#D4AF37]/60 text-[#D4AF37] shadow-md shadow-[#D4AF37]/15"
                                          : "bg-white/[0.03] border-white/10 text-white/30 hover:bg-white/8 hover:border-white/25 hover:text-white/60"
                                      }
                                    `}
                                  >
                                    <span className="text-[10px] font-bold">{cls}-{sec}</span>
                                    {isOn && (
                                      <>
                                        {subjList.length > 0
                                          ? subjList.map((s, i) => (
                                              <span key={i} className="text-[8px] font-normal opacity-90 leading-tight truncate max-w-full">
                                                · {s}
                                              </span>
                                            ))
                                          : <span className="text-[8px] opacity-50 italic">No subject</span>
                                        }
                                        {isCollision && <AlertTriangle className="w-2.5 h-2.5 text-amber-400 mt-0.5" />}
                                      </>
                                    )}
                                  </button>

                                  {/* remove button — only when cell is assigned */}
                                  {isOn && (
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        setSelectedCells(prev => { const n = new Set(prev); n.delete(key); return n; });
                                        setCellSubjects(prev => { const n = new Map(prev); n.delete(key); return n; });
                                      }}
                                      className="
                                        absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full
                                        bg-red-500 border border-red-400 text-white
                                        flex items-center justify-center
                                        opacity-0 group-hover/cell:opacity-100
                                        transition-opacity duration-150 z-10
                                      "
                                      title={`Remove ${cls}-${sec}`}
                                    >
                                      <X className="w-2 h-2" />
                                    </button>
                                  )}

                                  {/* collision tooltip */}
                                  {isOwnedByOther && !isOn && (
                                    <div className="
                                      absolute -top-8 left-1/2 -translate-x-1/2
                                      bg-amber-900/90 border border-amber-500/30 text-amber-200
                                      text-[9px] px-2 py-1 rounded-lg whitespace-nowrap
                                      opacity-0 group-hover/cell:opacity-100 pointer-events-none
                                      transition-opacity z-20
                                    ">
                                      ⚠ {owner.teacherName}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="text-white/20 text-[10px] mt-3 text-right">
                  ⚡ Click a cell to toggle assignment · Amber = collision with another teacher
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ BOTTOM: Summary Table ═══════════════════════════════ */}
      <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/[0.03] backdrop-blur-xl">
        {/* table header */}
        <div className="px-4 py-3 border-b border-white/8 bg-white/[0.02] flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-600/10 border border-emerald-500/20 flex items-center justify-center">
              <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Assignments Overview</span>
          </div>

          {/* summary filter tabs */}
          <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1 border border-white/8">
            {([["all","All"],["mapped","Mapped"],["unmapped","Unmapped"]] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setSummaryFilter(v)}
                className={`
                  text-[11px] font-semibold px-3 py-1 rounded-lg transition-all
                  ${summaryFilter === v
                    ? "bg-[#D4AF37] text-[#0A1628]"
                    : "text-white/40 hover:text-white/70"
                  }
                `}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[340px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#D4AF37_transparent]">
          {mappingsLoading || teachersLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-[#D4AF37]/40" />
            </div>
          ) : summaryRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Users className="w-7 h-7 text-white/10" />
              <p className="text-white/20 text-xs">No records for this filter</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-[#0d1b2e]/95 backdrop-blur-sm">
                <tr>
                  {["Teacher", "Status", "Class & Subject Assignments", "Actions"].map(h => (
                    <th key={h} className="text-left py-2.5 px-4 text-white/35 font-semibold text-[10px] uppercase tracking-wider border-b border-white/8">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaryRows.map(entry => {
                  const palette = getPalette(entry.id);
                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group"
                      data-testid={`summary-row-${entry.id}`}
                    >
                      {/* teacher */}
                      <td className="py-3 px-4 align-middle">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${palette.bg} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>
                            {getInitials(entry.name)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white leading-tight">{entry.name}</p>
                            <p className="text-[10px] text-white/30">{entry.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* status */}
                      <td className="py-3 px-4 align-middle">
                        {entry.isMapped ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/12 border border-emerald-500/25 text-emerald-400 text-[10px] font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Mapped · {entry.assignments.length}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            Unmapped
                          </span>
                        )}
                      </td>

                      {/* assignments */}
                      <td className="py-3 px-4 align-middle">
                        {entry.assignments.length === 0 ? (
                          <span className="text-[10px] text-white/20 italic">No classes assigned yet</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {entry.assignments.map((a, i) => (
                              <span
                                key={i}
                                data-testid={`assignment-badge-${entry.id}-${i}`}
                                className="
                                  inline-flex items-center gap-1 px-2 py-0.5 rounded-lg
                                  bg-white/5 border border-white/10 text-[10px]
                                  hover:bg-white/8 hover:border-white/15 transition-colors
                                "
                              >
                                <span className="text-white/60 font-medium">{a.className}-{a.section}</span>
                                {a.subject && (
                                  <>
                                    <span className="text-white/20">·</span>
                                    <span className="text-[#D4AF37] font-semibold">{a.subject}</span>
                                  </>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* actions */}
                      <td className="py-3 px-4 align-middle">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const teacher = teachers.find(t => t.id === entry.id);
                              if (teacher) handleSelectTeacher(teacher as TeacherWithEmail);
                            }}
                            className="
                              h-7 px-2.5 rounded-lg text-[10px] font-medium
                              text-white/40 border border-white/10 hover:border-white/20 hover:text-white hover:bg-white/8
                              transition-all flex items-center gap-1
                            "
                            title="Edit this teacher's assignments"
                          >
                            <Edit2 className="w-2.5 h-2.5" /> Edit
                          </button>
                          {entry.isMapped && (
                            <button
                              onClick={() => {
                                clearMutation.mutate(entry.id);
                                if (selectedTeacher?.id === entry.id) { setSelectedCells(new Set()); setCellSubjects(new Map()); }
                              }}
                              data-testid={`button-clear-mapping-${entry.id}`}
                              className="
                                h-7 px-2.5 rounded-lg text-[10px] font-medium
                                text-red-400/70 border border-red-500/15 hover:border-red-500/40 hover:text-red-300 hover:bg-red-500/8
                                transition-all flex items-center gap-1
                              "
                              title="Clear all mappings for this teacher"
                            >
                              <Trash2 className="w-2.5 h-2.5" /> Clear All
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
