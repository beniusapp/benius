import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, UserPlus, UserX, ChevronLeft, ChevronRight, Loader2, X, Pencil, Save } from "lucide-react";
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
import DeactivationModal from "@/components/deactivation-modal";

const PAGE_SIZE = 20;

interface Props { schoolId: number; classes: string[]; sections: string[]; subjects: string[] }
type TeacherWithEmail = Teacher & { email: string };

interface SchoolConfig { classes: string[]; sections: string[]; subjects: string[] }

const addTeacherSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(7),
  subject: z.string().min(1),
  assignedClass: z.string().min(1),
  assignedSection: z.string().min(1),
});
type AddTeacherForm = z.infer<typeof addTeacherSchema>;

const editTeacherSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  subject: z.string().min(1, "Subject is required"),
  assignedClass: z.string().min(1, "Class is required"),
  assignedSection: z.string().min(1, "Section is required"),
});
type EditTeacherForm = z.infer<typeof editTeacherSchema>;

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: `${50 + (i * 13) % 50}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function FacultyMapping({ schoolId, classes, sections, subjects }: Props) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<TeacherWithEmail | null>(null);
  const [editTarget, setEditTarget] = useState<TeacherWithEmail | null>(null);

  // Fetch school config for edit modal dropdowns (session-scoped, no schoolId in URL)
  const { data: schoolConfig } = useQuery<SchoolConfig>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [] };
    },
    enabled: !!schoolId,
  });

  const configClasses = (schoolConfig?.classes ?? []).length > 0 ? schoolConfig!.classes : classes;
  const configSections = (schoolConfig?.sections ?? []).length > 0 ? schoolConfig!.sections : sections;
  const configSubjects = (schoolConfig?.subjects ?? []).length > 0 ? schoolConfig!.subjects : (subjects.length > 0 ? subjects : ["Math","Science","English","Hindi","Social"]);

  const handleSearch = useCallback((val: string) => {
    setQ(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => { setDebouncedQ(val); setPage(1); }, 400);
    setDebounceTimer(t);
  }, [debounceTimer]);

  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  params.set("page", String(page));

  const { data, isLoading } = useQuery<{ data: TeacherWithEmail[]; total: number }>({
    queryKey: ["/api/schools", schoolId, "teachers", "paginated", debouncedQ, page],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/teachers/paginated?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!schoolId,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  // ── Add Teacher Form ──
  const form = useForm<AddTeacherForm>({
    resolver: zodResolver(addTeacherSchema),
    defaultValues: { fullName: "", email: "", password: "", phone: "", subject: "", assignedClass: "", assignedSection: "" },
  });

  const addMutation = useMutation({
    mutationFn: async (d: AddTeacherForm) => {
      const r = await apiRequest("POST", `/api/schools/${schoolId}/teachers`, d);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Teacher Added" });
      form.reset(); setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "teachers"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Edit Teacher Form ──
  const editForm = useForm<EditTeacherForm>({
    resolver: zodResolver(editTeacherSchema),
    defaultValues: { fullName: "", subject: "", assignedClass: "", assignedSection: "" },
  });

  useEffect(() => {
    if (editTarget) {
      editForm.reset({
        fullName: editTarget.fullName,
        subject: editTarget.subject,
        assignedClass: editTarget.assignedClass,
        assignedSection: editTarget.assignedSection,
      });
    }
  }, [editTarget]);

  const editMutation = useMutation({
    mutationFn: async (d: EditTeacherForm) => {
      const r = await apiRequest("PATCH", `/api/admin/teachers/${editTarget!.id}`, d);
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: "Failed to update teacher" }));
        throw new Error(err.message);
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Teacher Updated", description: `${editTarget?.fullName} has been updated successfully.` });
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "teachers"] });
    },
    onError: (e: Error) => toast({ title: "Update Failed", description: e.message, variant: "destructive" }),
  });

  const rangeStart = data ? ((page - 1) * PAGE_SIZE) + 1 : 0;
  const rangeEnd = data ? Math.min(page * PAGE_SIZE, data.total) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Faculty Mapping</h2>
          <p className="text-white/50 text-sm">
            {data?.total ?? "..."} active teacher{(data?.total ?? 0) !== 1 ? "s" : ""} · Page {page} of {totalPages}
          </p>
        </div>
        <Button
          size="sm"
          className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
          onClick={() => setShowForm(!showForm)}
          data-testid="button-add-teacher-toggle"
        >
          <UserPlus className="w-4 h-4 mr-1" /> Add Teacher
        </Button>
      </div>

      {/* Add Teacher Form */}
      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">New Teacher</h3>
            <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => addMutation.mutate(d))} className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {(["fullName", "email", "password", "phone"] as const).map(name => (
                <FormField key={name} control={form.control} name={name} render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70 capitalize">
                      {name === "fullName" ? "Full Name" : name.charAt(0).toUpperCase() + name.slice(1)}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type={name === "password" ? "password" : "text"}
                        className="bg-[#0A1628] border-white/20 text-white"
                        data-testid={`input-teacher-${name}`}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ))}
              <FormField control={form.control} name="subject" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Subject</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-teacher-subject">
                      <SelectValue placeholder="Subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {configSubjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="assignedClass" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Assigned Class</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-teacher-class">
                      <SelectValue placeholder="Class" />
                    </SelectTrigger>
                    <SelectContent>
                      {(configClasses.length > 0 ? configClasses : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="assignedSection" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Section</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-teacher-section">
                      <SelectValue placeholder="Section" />
                    </SelectTrigger>
                    <SelectContent>
                      {(configSections.length > 0 ? configSections : ["A","B","C","D"]).map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex items-end col-span-2 md:col-span-3">
                <Button
                  type="submit"
                  disabled={addMutation.isPending}
                  className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
                  data-testid="button-submit-teacher"
                >
                  {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <UserPlus className="w-4 h-4 mr-1" />}
                  Add Teacher
                </Button>
              </div>
            </form>
          </Form>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
        <Input
          value={q}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search by name, email, or subject..."
          className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30 h-11"
          data-testid="input-search-teachers"
        />
      </div>

      {/* Table — fixed height scroll container with sticky header */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="max-h-[480px] overflow-y-auto scroll-smooth [scrollbar-width:thin] [scrollbar-color:#D4AF37_#0A1628]">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="sticky top-0 z-10 bg-[#0F1E35]">
              <tr>
                <th className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide border-b border-white/10">Name</th>
                <th className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide border-b border-white/10">Email</th>
                <th className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide border-b border-white/10">Subject</th>
                <th className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide border-b border-white/10">Class</th>
                <th className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide border-b border-white/10">Section</th>
                <th className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide border-b border-white/10 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                : !data?.data.length
                  ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-white/40">
                        {debouncedQ ? `No teachers match "${debouncedQ}"` : "No active teachers found"}
                      </td>
                    </tr>
                  )
                  : data.data.map(t => (
                    <tr
                      key={t.id}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                      data-testid={`row-teacher-${t.id}`}
                    >
                      <td className="py-3 px-4 text-white font-medium">{t.fullName}</td>
                      <td className="py-3 px-4 text-white/70 text-xs">{t.email}</td>
                      <td className="py-3 px-4 text-[#D4AF37] text-xs">{t.subject}</td>
                      <td className="py-3 px-4 text-white/70">{t.assignedClass}</td>
                      <td className="py-3 px-4 text-white/70">{t.assignedSection}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-[#D4AF37] hover:text-yellow-300 hover:bg-yellow-400/10 h-8 w-8"
                            onClick={() => setEditTarget(t)}
                            data-testid={`button-edit-teacher-${t.id}`}
                            title="Edit teacher"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-8 w-8"
                            onClick={() => setDeactivateTarget(t)}
                            data-testid={`button-deactivate-teacher-${t.id}`}
                            title="Deactivate teacher"
                          >
                            <UserX className="w-3.5 h-3.5" />
                          </Button>
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
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
            className="border-white/20 text-white hover:bg-white/10"
            data-testid="button-faculty-prev"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="px-3 py-1.5 rounded bg-[#1A2942] text-white text-sm min-w-[64px] text-center">
            {page} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="border-white/20 text-white hover:bg-white/10"
            data-testid="button-faculty-next"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Deactivate Modal */}
      {deactivateTarget && (
        <DeactivationModal
          open={!!deactivateTarget}
          onClose={() => setDeactivateTarget(null)}
          type="teacher"
          targetId={deactivateTarget.id}
          targetName={deactivateTarget.fullName}
          schoolId={schoolId}
          invalidateKeys={[
            ["/api/schools", schoolId, "teachers", "paginated"],
            ["/api/schools", schoolId, "teachers"],
          ]}
        />
      )}

      {/* Edit Teacher Modal */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-edit-teacher"
          onClick={e => { if (e.target === e.currentTarget) setEditTarget(null); }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-[#1A2942] border border-white/10 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-[#D4AF37]" />
                <div>
                  <h3 className="text-sm font-semibold text-white">Edit Teacher</h3>
                  <p className="text-xs text-white/40">{editTarget.email}</p>
                </div>
              </div>
              <button
                onClick={() => setEditTarget(null)}
                className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                data-testid="button-cancel-edit"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5">
              <Form {...editForm}>
                <form
                  onSubmit={editForm.handleSubmit(d => editMutation.mutate(d))}
                  className="space-y-4"
                >
                  {/* Full Name */}
                  <FormField control={editForm.control} name="fullName" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70">Full Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="bg-[#0A1628] border-white/20 text-white h-11"
                          data-testid="input-edit-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Subject */}
                    <FormField control={editForm.control} name="subject" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70">Subject</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-11" data-testid="select-edit-subject">
                            <SelectValue placeholder="Subject" />
                          </SelectTrigger>
                          <SelectContent>
                            {configSubjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />

                    {/* Class */}
                    <FormField control={editForm.control} name="assignedClass" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70">Class</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-11" data-testid="select-edit-class">
                            <SelectValue placeholder="Class" />
                          </SelectTrigger>
                          <SelectContent>
                            {(configClasses.length > 0 ? configClasses : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />

                    {/* Section */}
                    <FormField control={editForm.control} name="assignedSection" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70">Section</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-11" data-testid="select-edit-section">
                            <SelectValue placeholder="Section" />
                          </SelectTrigger>
                          <SelectContent>
                            {(configSections.length > 0 ? configSections : ["A","B","C","D"]).map(s => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      type="submit"
                      disabled={editMutation.isPending}
                      className="flex-1 bg-[#10b981] hover:bg-emerald-600 text-white font-semibold min-h-[44px]"
                      data-testid="button-save-teacher"
                    >
                      {editMutation.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Updating...</>
                        : <><Save className="w-4 h-4 mr-1.5" /> Save Changes</>
                      }
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={editMutation.isPending}
                      onClick={() => setEditTarget(null)}
                      className="border-white/20 text-white/60 hover:bg-white/10 min-h-[44px]"
                      data-testid="button-cancel-edit-footer"
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
