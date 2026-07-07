import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, UserPlus, Trash2, Pencil, ChevronLeft, ChevronRight, Loader2, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { Teacher } from "@shared/schema";
import { useSessionView } from "@/contexts/session-view-context";

interface Props { schoolId: number; classes: string[]; sections: string[]; subjects: string[]; onNavigate?: (module: string) => void; allowedSubs?: string[]; }
type TeacherWithEmail = Teacher & { email: string; mappings: { className: string; section: string }[] };

const PAGE_SIZE = 20;

const addSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().min(7, "Phone number required"),
  designation: z.string().optional(),
});
type AddForm = z.infer<typeof addSchema>;

const editSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(7),
  designation: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: `${45 + (i * 11) % 50}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function TeacherRegistry({ schoolId, classes, sections, onNavigate, allowedSubs }: Props) {
  const { toast } = useToast();
  const { isArchiveMode } = useSessionView();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<TeacherWithEmail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeacherWithEmail | null>(null);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  const { data: schoolConfig } = useQuery<{ classes: string[]; sections: string[]; subjects: string[] }>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [] };
    },
  });

  const cfgClasses = (schoolConfig?.classes ?? []).length > 0 ? schoolConfig!.classes : (classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"]);
  const cfgSections = (schoolConfig?.sections ?? []).length > 0 ? schoolConfig!.sections : (sections.length > 0 ? sections : ["A","B","C","D"]);

  const handleSearch = useCallback((val: string) => {
    setQ(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => { setDebouncedQ(val); setPage(1); }, 400);
    setDebounceTimer(t);
  }, [debounceTimer]);

  const handleFilterClass = (val: string) => {
    setFilterClass(val === "__all__" ? "" : val);
    setPage(1);
  };

  const handleFilterSection = (val: string) => {
    setFilterSection(val === "__all__" ? "" : val);
    setPage(1);
  };

  const hasFilters = debouncedQ || filterClass || filterSection;
  const clearFilters = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    setQ(""); setDebouncedQ(""); setFilterClass(""); setFilterSection(""); setPage(1);
  };

  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  if (filterClass) params.set("filterClass", filterClass);
  if (filterSection) params.set("filterSection", filterSection);
  params.set("page", String(page));

  const { data, isLoading } = useQuery<{ data: TeacherWithEmail[]; total: number }>({
    queryKey: ["/api/admin/teachers", debouncedQ, filterClass, filterSection, page],
    queryFn: async () => {
      const r = await fetch(`/api/admin/teachers?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const addForm = useForm<AddForm>({
    resolver: zodResolver(addSchema),
    defaultValues: { fullName: "", email: "", password: "", phone: "", designation: "" },
  });

  const addMutation = useMutation({
    mutationFn: async (d: AddForm) => {
      const r = await apiRequest("POST", "/api/admin/teachers", d);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Teacher Added", description: "Teacher account created and added to registry." });
      addForm.reset(); setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/teachers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "teachers"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { fullName: "", phone: "", designation: "" },
  });

  useEffect(() => {
    if (editTarget) {
      editForm.reset({
        fullName: editTarget.fullName,
        phone: editTarget.phone,
        designation: editTarget.designation ?? "",
      });
    }
  }, [editTarget]);

  const editMutation = useMutation({
    mutationFn: async (d: EditForm) => {
      const r = await apiRequest("PATCH", `/api/admin/teachers/${editTarget!.id}`, d);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Teacher Updated" });
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/teachers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "teachers"] });
    },
    onError: (e: Error) => toast({ title: "Update Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/teachers/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Teacher Removed", description: `${deleteTarget?.fullName} has been removed from the registry.` });
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/teachers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "teachers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/faculty-mappings"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const rangeStart = data ? ((page - 1) * PAGE_SIZE) + 1 : 0;
  const rangeEnd = data ? Math.min(page * PAGE_SIZE, data.total) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Teacher Registry</h2>
          <p className="text-white/50 text-sm">
            {data?.total ?? "..."} teacher{(data?.total ?? 0) !== 1 ? "s" : ""} · Page {page} of {totalPages}
          </p>
        </div>
        {(!allowedSubs || allowedSubs.includes("add")) && (
        <Button
          size="sm"
          className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
          onClick={() => setShowForm(!showForm)}
          disabled={isArchiveMode}
          data-testid="button-add-teacher-toggle"
        >
          <UserPlus className="w-4 h-4 mr-1" /> Add Teacher
        </Button>
        )}
      </div>

      {/* Add Teacher Form */}
      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Register New Teacher</h3>
            <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(d => addMutation.mutate(d))} className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {(["fullName", "email", "password", "phone", "designation"] as const).map(name => (
                <FormField key={name} control={addForm.control} name={name} render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70 text-xs">
                      {name === "fullName" ? "Full Name" : name.charAt(0).toUpperCase() + name.slice(1)}
                      {name === "designation" && <span className="text-white/30 ml-1">(optional)</span>}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type={name === "password" ? "password" : "text"}
                        className="bg-[#0A1628] border-white/20 text-white h-9 text-sm"
                        data-testid={`input-reg-teacher-${name}`}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ))}
              <div className="flex items-end col-span-2 md:col-span-3">
                <Button
                  type="submit"
                  disabled={isArchiveMode || addMutation.isPending}
                  className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
                  data-testid="button-submit-register-teacher"
                >
                  {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <UserPlus className="w-4 h-4 mr-1" />}
                  Register Teacher
                </Button>
              </div>
            </form>
          </Form>
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
          <Input
            value={q}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30 h-10"
            data-testid="input-search-teacher-registry"
          />
        </div>
        <Select value={filterClass || "__all__"} onValueChange={handleFilterClass}>
          <SelectTrigger
            className="bg-[#1A2942] border-white/20 text-white h-10 w-[130px]"
            data-testid="select-filter-class"
          >
            <SelectValue placeholder="All Classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Classes</SelectItem>
            {cfgClasses.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSection || "__all__"} onValueChange={handleFilterSection}>
          <SelectTrigger
            className="bg-[#1A2942] border-white/20 text-white h-10 w-[130px]"
            data-testid="select-filter-section"
          >
            <SelectValue placeholder="All Sections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Sections</SelectItem>
            {cfgSections.map(s => <SelectItem key={s} value={s}>Section {s}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button
            size="sm"
            variant="ghost"
            onClick={clearFilters}
            className="text-white/50 hover:text-white hover:bg-white/10 h-10 px-3"
            data-testid="button-clear-teacher-filters"
          >
            <X className="w-4 h-4 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="max-h-[480px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#D4AF37_#0A1628]">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="sticky top-0 z-10 bg-[#0F1E35]">
              <tr>
                {["Name","Email","Phone","Subject","Assigned Sections","Designation","Actions"].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide border-b border-white/10">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : !data?.data.length
                  ? (
                    <tr><td colSpan={7} className="py-12 text-center text-white/40">
                      {hasFilters
                        ? `No teachers found${filterClass ? ` in Class ${filterClass}` : ""}${filterSection ? ` Section ${filterSection}` : ""}${debouncedQ ? ` matching "${debouncedQ}"` : ""}`
                        : "No teachers registered yet"}
                    </td></tr>
                  )
                  : data.data.map(t => (
                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`row-teacher-reg-${t.id}`}>
                      <td className="py-3 px-4 text-white font-medium">{t.fullName}</td>
                      <td className="py-3 px-4 text-white/70 text-xs">{t.email}</td>
                      <td className="py-3 px-4 text-white/70 text-xs">{t.phone}</td>
                      <td className="py-3 px-4 text-[#D4AF37] text-xs">{t.subject}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1" data-testid={`cell-sections-${t.id}`}>
                          {(t.mappings ?? []).length > 0
                            ? (t.mappings ?? []).map((m, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => onNavigate?.("faculty-mapping")}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30 hover:bg-[#D4AF37]/30 transition-colors cursor-pointer"
                                  title="Go to Faculty Mapping"
                                  data-testid={`badge-section-${t.id}-${idx}`}
                                >
                                  {m.className}-{m.section}
                                </button>
                              ))
                            : (
                                <button
                                  onClick={() => onNavigate?.("faculty-mapping")}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer"
                                  title="Go to Faculty Mapping"
                                  data-testid={`badge-section-primary-${t.id}`}
                                >
                                  {t.assignedClass}-{t.assignedSection}
                                </button>
                              )
                          }
                        </div>
                      </td>
                      <td className="py-3 px-4 text-white/50 text-xs">{t.designation || "—"}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          {(!allowedSubs || allowedSubs.includes("edit")) && (
                          <Button variant="ghost" size="icon" className="text-[#D4AF37] hover:text-yellow-300 hover:bg-yellow-400/10 h-8 w-8"
                            onClick={() => setEditTarget(t)} disabled={isArchiveMode} data-testid={`button-edit-teacher-reg-${t.id}`} title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          )}
                          {(!allowedSubs || allowedSubs.includes("deactivate")) && (
                          <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-8 w-8"
                            onClick={() => setDeleteTarget(t)} disabled={isArchiveMode} data-testid={`button-delete-teacher-reg-${t.id}`} title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-sm">
          {data?.total ? `${rangeStart}–${rangeEnd} of ${data.total}` : "No results"}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="border-white/20 text-white hover:bg-white/10" data-testid="button-registry-prev">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="px-3 py-1.5 rounded bg-[#1A2942] text-white text-sm min-w-[64px] text-center">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="border-white/20 text-white hover:bg-white/10" data-testid="button-registry-next">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Edit Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-edit-teacher-registry"
          onClick={e => { if (e.target === e.currentTarget) setEditTarget(null); }}>
          <div className="w-full max-w-lg rounded-2xl bg-[#1A2942] border border-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Pencil className="w-4 h-4 text-[#D4AF37]" /> Edit Teacher</h3>
                <p className="text-xs text-white/40">{editTarget.email}</p>
              </div>
              <button onClick={() => setEditTarget(null)} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors" data-testid="button-close-edit-teacher-registry">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(d => editMutation.mutate(d))} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={editForm.control} name="fullName" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel className="text-white/70 text-xs">Full Name</FormLabel>
                        <FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-edit-reg-name" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={editForm.control} name="phone" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70 text-xs">Phone</FormLabel>
                        <FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-edit-reg-phone" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={editForm.control} name="designation" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70 text-xs">Designation</FormLabel>
                        <FormControl><Input {...field} placeholder="e.g. HOD, Senior Teacher" className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-edit-reg-designation" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button type="submit" disabled={isArchiveMode || editMutation.isPending} className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold flex-1" data-testid="button-save-edit-teacher-registry">
                      {editMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                      Save Changes
                    </Button>
                    <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => setEditTarget(null)}>Cancel</Button>
                  </div>
                </form>
              </Form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-delete-teacher-registry"
          onClick={e => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div className="w-full max-w-sm rounded-2xl bg-[#1A2942] border border-red-500/30 shadow-2xl p-6">
            <h3 className="text-white font-semibold mb-2">Remove Teacher?</h3>
            <p className="text-white/60 text-sm mb-1">
              This will permanently remove <span className="text-white font-medium">{deleteTarget.fullName}</span> from the registry.
            </p>
            <p className="text-red-400 text-xs mb-5">Their login account and all assignments will also be deleted.</p>
            <div className="flex gap-2">
              <Button
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={isArchiveMode || deleteMutation.isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold"
                data-testid="button-confirm-delete-teacher-registry"
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
                Remove
              </Button>
              <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
