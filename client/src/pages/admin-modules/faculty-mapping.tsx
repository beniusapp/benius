import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Save, Loader2, X, Users, BookOpen, Grid3X3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Teacher } from "@shared/schema";

interface Props { schoolId: number; classes: string[]; sections: string[]; subjects: string[] }
type TeacherWithEmail = Teacher & { email: string };
type MappingRow = { id: number; teacherId: number; teacherName: string; email: string; className: string; section: string; schoolId: number };

const DEFAULT_CLASSES = ["1","2","3","4","5","6","7","8","9","10","11","12"];
const DEFAULT_SECTIONS = ["A","B","C","D"];

export default function FacultyMapping({ schoolId, classes, sections }: Props) {
  const { toast } = useToast();
  const [searchQ, setSearchQ] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherWithEmail | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [savingFor, setSavingFor] = useState<number | null>(null);

  const { data: schoolConfig } = useQuery<{ classes: string[]; sections: string[]; subjects: string[] }>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [] };
    },
  });

  const cfgClasses = (schoolConfig?.classes ?? []).length > 0 ? schoolConfig!.classes : (classes.length > 0 ? classes : DEFAULT_CLASSES);
  const cfgSections = (schoolConfig?.sections ?? []).length > 0 ? schoolConfig!.sections : (sections.length > 0 ? sections : DEFAULT_SECTIONS);

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
    setSelectedCells(cells);
  }, [allMappings]);

  const toggleCell = useCallback((cls: string, section: string) => {
    const key = `${cls}:${section}`;
    setSelectedCells(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleRow = useCallback((cls: string) => {
    setSelectedCells(prev => {
      const next = new Set(prev);
      const allSelected = cfgSections.every(s => next.has(`${cls}:${s}`));
      if (allSelected) cfgSections.forEach(s => next.delete(`${cls}:${s}`));
      else cfgSections.forEach(s => next.add(`${cls}:${s}`));
      return next;
    });
  }, [cfgSections]);

  const toggleCol = useCallback((section: string) => {
    setSelectedCells(prev => {
      const next = new Set(prev);
      const allSelected = cfgClasses.every(c => next.has(`${c}:${section}`));
      if (allSelected) cfgClasses.forEach(c => next.delete(`${c}:${section}`));
      else cfgClasses.forEach(c => next.add(`${c}:${section}`));
      return next;
    });
  }, [cfgClasses]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTeacher) return;
      setSavingFor(selectedTeacher.id);
      const mappings = Array.from(selectedCells).map(key => {
        const [className, section] = key.split(":");
        return { className, section };
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
      if (selectedTeacher) setSelectedCells(new Set());
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
    const map = new Map<number, { name: string; email: string; classes: string }>();
    allMappings.forEach(m => {
      if (!map.has(m.teacherId)) {
        map.set(m.teacherId, { name: m.teacherName, email: m.email, classes: "" });
      }
      const entry = map.get(m.teacherId)!;
      entry.classes = entry.classes ? `${entry.classes}, ${m.className}-${m.section}` : `${m.className}-${m.section}`;
    });
    return map;
  }, [allMappings]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Faculty Mapping</h2>
        <p className="text-white/50 text-sm">Assign teachers to classes and sections. Pick a teacher, then click cells in the grid.</p>
      </div>

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
                    onClick={() => setSelectedCells(new Set())}
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
                            title={`Toggle all Section ${sec}`}
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
                            return (
                              <td key={sec} className="py-1.5 px-1 text-center">
                                <button
                                  onClick={() => toggleCell(cls, sec)}
                                  data-testid={`cell-${cls}-${sec}`}
                                  title={`Class ${cls} – Section ${sec}`}
                                  className={`w-8 h-8 rounded-lg border transition-all duration-150 ${
                                    isOn
                                      ? "bg-[#D4AF37] border-[#D4AF37] text-[#0A1628] font-bold shadow-sm shadow-[#D4AF37]/30"
                                      : "bg-white/5 border-white/10 text-white/30 hover:bg-white/10 hover:border-white/30"
                                  }`}
                                >
                                  {isOn ? "✓" : ""}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-white/30 text-[10px] mt-3">Click a class or section header to toggle all cells in that row/column.</p>
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
                    {["Teacher","Subject","Assigned To","Actions"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-white/50 font-medium text-xs uppercase tracking-wide border-b border-white/10">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from(mappingsByTeacher.entries()).map(([teacherId, entry]) => {
                    const teacher = teachers.find(t => t.id === teacherId);
                    return (
                      <tr key={teacherId} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`summary-row-${teacherId}`}>
                        <td className="py-2.5 px-4 text-white font-medium text-sm">{entry.name}</td>
                        <td className="py-2.5 px-4 text-[#D4AF37] text-xs">{teacher?.subject || "—"}</td>
                        <td className="py-2.5 px-4 text-white/60 text-xs">{entry.classes}</td>
                        <td className="py-2.5 px-4">
                          <button
                            className="text-xs text-red-400 hover:text-red-300 transition-colors"
                            onClick={() => {
                              clearMutation.mutate(teacherId);
                              if (selectedTeacher?.id === teacherId) setSelectedCells(new Set());
                            }}
                            data-testid={`button-clear-mapping-${teacherId}`}
                          >
                            Clear
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
