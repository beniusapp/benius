import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Save, Loader2, X, Users, BookOpen, Grid3X3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Teacher } from "@shared/schema";

interface Props { schoolId: number; classes: string[]; sections: string[]; subjects: string[] }
type TeacherWithEmail = Teacher & { email: string };
type MappingRow = { id: number; teacherId: number; teacherName: string; email: string; className: string; section: string; schoolId: number; subject?: string | null };

const DEFAULT_CLASSES = ["1","2","3","4","5","6","7","8","9","10","11","12"];
const DEFAULT_SECTIONS = ["A","B","C","D"];

export default function FacultyMapping({ schoolId, classes, sections }: Props) {
  const { toast } = useToast();
  const [searchQ, setSearchQ] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherWithEmail | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [cellSubjects, setCellSubjects] = useState<Map<string, string>>(new Map());
  const [savingFor, setSavingFor] = useState<number | null>(null);

  // Subject prompt dialog state (supports single cell or bulk row/col toggle)
  const [pendingCells, setPendingCells] = useState<{ cls: string; section: string }[] | null>(null);
  const [pendingSubject, setPendingSubject] = useState("");

  const { data: schoolConfig } = useQuery<{ classes: string[]; sections: string[]; subjects: string[] }>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [] };
    },
  });

  const cfgClasses = (schoolConfig?.classes ?? []).length > 0 ? schoolConfig!.classes : (classes.length > 0 ? classes : DEFAULT_CLASSES);
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

  const filteredTeachers = useMemo(() => {
    const q = searchQ.toLowerCase();
    if (!q) return teachers;
    return teachers.filter(t =>
      t.fullName.toLowerCase().includes(q) ||
      t.email.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q)
    );
  }, [teachers, searchQ]);

  const handleSelectTeacher = useCallback((teacher: TeacherWithEmail) => {
    setSelectedTeacher(teacher);
    const existingMaps = allMappings.filter(m => m.teacherId === teacher.id);
    const cells = new Set(existingMaps.map(m => `${m.className}:${m.section}`));
    const subjects = new Map<string, string>();
    existingMaps.forEach(m => {
      if (m.subject) subjects.set(`${m.className}:${m.section}`, m.subject);
    });
    setSelectedCells(cells);
    setCellSubjects(subjects);
  }, [allMappings]);

  const openSubjectDialogForCells = useCallback((cells: { cls: string; section: string }[]) => {
    if (cells.length === 0) return;
    setPendingCells(cells);
    setPendingSubject("");
  }, []);

  const confirmSubjectDialog = useCallback(() => {
    if (!pendingCells) return;
    setSelectedCells(prev => {
      const next = new Set(prev);
      pendingCells.forEach(({ cls, section }) => next.add(`${cls}:${section}`));
      return next;
    });
    setCellSubjects(prev => {
      const next = new Map(prev);
      pendingCells.forEach(({ cls, section }) => {
        const key = `${cls}:${section}`;
        if (pendingSubject.trim()) next.set(key, pendingSubject.trim());
        else next.delete(key);
      });
      return next;
    });
    setPendingCells(null);
    setPendingSubject("");
  }, [pendingCells, pendingSubject]);

  const cancelSubjectDialog = useCallback(() => {
    setPendingCells(null);
    setPendingSubject("");
  }, []);

  const toggleCell = useCallback((cls: string, section: string) => {
    const key = `${cls}:${section}`;
    if (selectedCells.has(key)) {
      setSelectedCells(prev => { const next = new Set(prev); next.delete(key); return next; });
      setCellSubjects(prev => { const next = new Map(prev); next.delete(key); return next; });
    } else {
      openSubjectDialogForCells([{ cls, section }]);
    }
  }, [selectedCells, openSubjectDialogForCells]);

  const toggleRow = useCallback((cls: string) => {
    const allSelected = cfgSections.every(s => selectedCells.has(`${cls}:${s}`));
    if (allSelected) {
      setSelectedCells(prev => {
        const next = new Set(prev);
        cfgSections.forEach(s => next.delete(`${cls}:${s}`));
        return next;
      });
      setCellSubjects(prev => {
        const next = new Map(prev);
        cfgSections.forEach(s => next.delete(`${cls}:${s}`));
        return next;
      });
    } else {
      const missing = cfgSections.filter(s => !selectedCells.has(`${cls}:${s}`)).map(s => ({ cls, section: s }));
      openSubjectDialogForCells(missing);
    }
  }, [cfgSections, selectedCells, openSubjectDialogForCells]);

  const toggleCol = useCallback((section: string) => {
    const allSelected = cfgClasses.every(c => selectedCells.has(`${c}:${section}`));
    if (allSelected) {
      setSelectedCells(prev => {
        const next = new Set(prev);
        cfgClasses.forEach(c => next.delete(`${c}:${section}`));
        return next;
      });
      setCellSubjects(prev => {
        const next = new Map(prev);
        cfgClasses.forEach(c => next.delete(`${c}:${section}`));
        return next;
      });
    } else {
      const missing = cfgClasses.filter(c => !selectedCells.has(`${c}:${section}`)).map(c => ({ cls: c, section }));
      openSubjectDialogForCells(missing);
    }
  }, [cfgClasses, selectedCells, openSubjectDialogForCells]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTeacher) return;
      setSavingFor(selectedTeacher.id);
      const mappings = Array.from(selectedCells).map(key => {
        const [className, section] = key.split(":");
        return { className, section, subject: cellSubjects.get(key) ?? null };
      });
      const r = await apiRequest("POST", "/api/admin/faculty-mappings", {
        teacherId: selectedTeacher.id,
        mappings,
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping Saved", description: `${selectedTeacher?.fullName}'s assignments have been updated.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/faculty-mappings"] });
      setSavingFor(null);
    },
    onError: (e: Error) => {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
      setSavingFor(null);
    },
  });

  const clearMutation = useMutation({
    mutationFn: async (teacherId: number) => {
      const r = await apiRequest("DELETE", `/api/admin/faculty-mappings/${teacherId}`);
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
    },
    onSuccess: () => {
      toast({ title: "Mappings Cleared" });
      if (selectedTeacher) { setSelectedCells(new Set()); setCellSubjects(new Map()); }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/faculty-mappings"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const teacherMappingCounts = useMemo(() => {
    const map = new Map<number, number>();
    allMappings.forEach(m => map.set(m.teacherId, (map.get(m.teacherId) ?? 0) + 1));
    return map;
  }, [allMappings]);

  const mappingsByTeacher = useMemo(() => {
    const map = new Map<number, { name: string; email: string; assignments: { className: string; section: string; subject: string | null }[] }>();
    allMappings.forEach(m => {
      if (!map.has(m.teacherId)) {
        map.set(m.teacherId, { name: m.teacherName, email: m.email, assignments: [] });
      }
      map.get(m.teacherId)!.assignments.push({ className: m.className, section: m.section, subject: m.subject ?? null });
    });
    return map;
  }, [allMappings]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Faculty Mapping</h2>
        <p className="text-white/50 text-sm">Assign teachers to classes and sections with subjects. Pick a teacher, then click cells in the grid.</p>
      </div>

      {/* Subject Prompt Dialog */}
      <Dialog open={!!pendingCells} onOpenChange={open => { if (!open) cancelSubjectDialog(); }}>
        <DialogContent className="bg-[#0F1E35] border border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white text-base">
              Assign Subject
            </DialogTitle>
          </DialogHeader>
          {pendingCells && (
            <p className="text-white/60 text-sm">
              {pendingCells.length === 1
                ? <>Class <span className="text-[#D4AF37] font-semibold">{pendingCells[0].cls}</span> – Section <span className="text-[#D4AF37] font-semibold">{pendingCells[0].section}</span></>
                : <><span className="text-[#D4AF37] font-semibold">{pendingCells.length} cells</span> will be assigned this subject</>
              }
            </p>
          )}
          <div className="space-y-3 mt-1">
            {cfgSubjects.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto [scrollbar-width:thin]">
                {cfgSubjects.map(s => (
                  <button
                    key={s}
                    onClick={() => setPendingSubject(s)}
                    data-testid={`subject-option-${s}`}
                    className={`text-xs px-2 py-1.5 rounded-lg border transition-all text-left ${
                      pendingSubject === s
                        ? "bg-[#D4AF37] border-[#D4AF37] text-[#0A1628] font-semibold"
                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/30"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <Input
              value={pendingSubject}
              onChange={e => setPendingSubject(e.target.value)}
              placeholder={cfgSubjects.length > 0 ? "Or type a custom subject…" : "Enter subject name (optional)…"}
              className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30 text-sm h-9"
              data-testid="input-pending-subject"
              onKeyDown={e => { if (e.key === "Enter") confirmSubjectDialog(); if (e.key === "Escape") cancelSubjectDialog(); }}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 mt-1">
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 text-white/60 hover:bg-white/10"
              onClick={cancelSubjectDialog}
              data-testid="button-cancel-subject-dialog"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
              onClick={confirmSubjectDialog}
              data-testid="button-confirm-subject-dialog"
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Teacher Picker */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 bg-[#0F1E35]">
              <p className="text-xs font-bold text-white/60 uppercase tracking-wide flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Teachers ({teachers.length})
              </p>
            </div>
            <div className="p-3 border-b border-white/5">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
                <Input
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search teachers…"
                  className="pl-8 bg-[#0A1628] border-white/20 text-white placeholder:text-white/30 h-8 text-xs"
                  data-testid="input-search-faculty-mapping"
                />
              </div>
            </div>
            <div className="max-h-[400px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#D4AF37_#0A1628]">
              {teachersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-white/40" />
                </div>
              ) : !filteredTeachers.length ? (
                <p className="text-white/30 text-xs text-center py-8 px-4">
                  {searchQ ? `No teachers match "${searchQ}"` : "No teachers in registry. Add teachers first."}
                </p>
              ) : (
                filteredTeachers.map(t => {
                  const isSelected = selectedTeacher?.id === t.id;
                  const count = teacherMappingCounts.get(t.id) ?? 0;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTeacher(t)}
                      data-testid={`button-select-teacher-${t.id}`}
                      className={`w-full text-left px-4 py-3 border-b border-white/5 transition-all ${
                        isSelected ? "bg-[#D4AF37]/10 border-l-2 border-l-[#D4AF37]" : "hover:bg-white/5"
                      }`}
                    >
                      <p className={`text-sm font-medium truncate ${isSelected ? "text-[#D4AF37]" : "text-white"}`}>{t.fullName}</p>
                      <p className="text-xs text-white/40 truncate">{t.subject}</p>
                      {count > 0 && (
                        <p className="text-[10px] text-emerald-400 mt-0.5">{count} assignment{count !== 1 ? "s" : ""}</p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right: Checkbox Grid */}
        <div className="lg:col-span-2">
          {!selectedTeacher ? (
            <div className="rounded-xl border border-white/10 bg-[#1A2942] flex items-center justify-center min-h-[300px]">
              <div className="text-center space-y-2">
                <Grid3X3 className="w-10 h-10 text-white/20 mx-auto" />
                <p className="text-white/40 text-sm">Select a teacher to assign classes</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 bg-[#0F1E35] flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{selectedTeacher.fullName}</p>
                  <p className="text-xs text-white/40">{selectedTeacher.subject} · {selectedCells.size} cell{selectedCells.size !== 1 ? "s" : ""} selected</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/20 text-white/60 hover:bg-white/10 text-xs h-8"
                    onClick={() => { setSelectedCells(new Set()); setCellSubjects(new Map()); }}
                    data-testid="button-clear-grid-selection"
                  >
                    <X className="w-3 h-3 mr-1" /> Clear
                  </Button>
                  <Button
                    size="sm"
                    className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold text-xs h-8"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    data-testid="button-save-faculty-mapping"
                  >
                    {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                    Save
                  </Button>
                </div>
              </div>

              <div className="p-4 overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left py-2 pr-4 text-white/50 font-medium w-24">Class</th>
                      {cfgSections.map(sec => (
                        <th key={sec} className="py-2 px-1 text-center">
                          <button
                            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors font-medium"
                            onClick={() => toggleCol(sec)}
                            title={`Toggle all classes for Section ${sec}`}
                            data-testid={`button-toggle-section-${sec}`}
                          >
                            {sec}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cfgClasses.map(cls => {
                      const rowSelected = cfgSections.every(s => selectedCells.has(`${cls}:${s}`));
                      return (
                        <tr key={cls} className="border-t border-white/5">
                          <td className="py-1.5 pr-4">
                            <button
                              className={`px-2 py-1 rounded text-xs font-medium transition-colors w-full text-left ${
                                rowSelected ? "bg-[#D4AF37]/20 text-[#D4AF37]" : "text-white/60 hover:text-white hover:bg-white/5"
                              }`}
                              onClick={() => toggleRow(cls)}
                              title={`Toggle all sections for Class ${cls}`}
                              data-testid={`button-toggle-class-${cls}`}
                            >
                              Class {cls}
                            </button>
                          </td>
                          {cfgSections.map(sec => {
                            const key = `${cls}:${sec}`;
                            const isOn = selectedCells.has(key);
                            const subj = cellSubjects.get(key);
                            return (
                              <td key={sec} className="py-1.5 px-1 text-center">
                                <button
                                  onClick={() => toggleCell(cls, sec)}
                                  data-testid={`cell-${cls}-${sec}`}
                                  title={isOn ? `${cls}-${sec}${subj ? `: ${subj}` : ""} (click to remove)` : `Class ${cls} – Section ${sec}`}
                                  className={`w-8 h-8 rounded-lg border transition-all duration-150 relative group ${
                                    isOn
                                      ? "bg-[#D4AF37] border-[#D4AF37] text-[#0A1628] font-bold shadow-sm shadow-[#D4AF37]/30"
                                      : "bg-white/5 border-white/10 text-white/30 hover:bg-white/10 hover:border-white/30"
                                  }`}
                                >
                                  {isOn ? "✓" : ""}
                                  {isOn && subj && (
                                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 bg-[#0A1628] border border-white/20 text-white text-[9px] px-1 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 max-w-[80px] truncate">
                                      {subj}
                                    </span>
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-white/30 text-[10px] mt-3">Click a cell to assign a class-section. Click a class or section header to toggle all at once with a shared subject.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mapping Summary Table */}
      {(allMappings.length > 0 || mappingsLoading) && (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 bg-[#0F1E35] flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#D4AF37]" />
            <p className="text-xs font-bold text-white/60 uppercase tracking-wide">Current Assignments Summary</p>
          </div>
          <div className="max-h-[300px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#D4AF37_#0A1628]">
            {mappingsLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#0F1E35]">
                  <tr>
                    {["Teacher","Assignments","Actions"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-white/50 font-medium text-xs uppercase tracking-wide border-b border-white/10">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from(mappingsByTeacher.entries()).map(([teacherId, entry]) => (
                    <tr key={teacherId} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`summary-row-${teacherId}`}>
                      <td className="py-2.5 px-4 text-white font-medium text-sm align-top">{entry.name}</td>
                      <td className="py-2.5 px-4 align-top">
                        <div className="flex flex-wrap gap-1">
                          {entry.assignments.map((a, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px]"
                              data-testid={`assignment-badge-${teacherId}-${i}`}
                            >
                              <span className="text-white/70">{a.className}-{a.section}</span>
                              {a.subject && (
                                <span className="text-[#D4AF37] font-medium">{a.subject}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 align-top">
                        <button
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                          onClick={() => {
                            clearMutation.mutate(teacherId);
                            if (selectedTeacher?.id === teacherId) { setSelectedCells(new Set()); setCellSubjects(new Map()); }
                          }}
                          data-testid={`button-clear-mapping-${teacherId}`}
                        >
                          Clear
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
