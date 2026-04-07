import { useState, useCallback, useEffect, type KeyboardEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Search, ChevronLeft, ChevronRight, UserPlus, Upload, X,
  Loader2, Users, UserX, Pencil, AlignJustify,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { Student } from "@shared/schema";
import DeactivationModal from "@/components/deactivation-modal";

interface Props { schoolId: number; classes: string[]; sections: string[] }

const PAGE_SIZE = 50;

const addSchema = z.object({
  name: z.string().min(1), class: z.string().min(1), section: z.string().min(1),
  phone: z.string().min(7), dob: z.string().min(1),
});
type AddForm = z.infer<typeof addSchema>;

const editSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  class: z.string().min(1, "Class is required"),
  section: z.string().min(1, "Section is required"),
  phone: z.string().regex(/^[0-9+\-\s()]{7,15}$/, "Invalid phone number (7–15 digits)"),
});
type EditForm = z.infer<typeof editSchema>;

function SkeletonRow({ compact }: { compact: boolean }) {
  return (
    <tr className="border-b border-white/5">
      {[...Array(7)].map((_, i) => (
        <td key={i} className={compact ? "py-1.5 px-3" : "py-3 px-4"}>
          <div className="h-3.5 rounded bg-white/10 animate-pulse" style={{ width: `${55 + (i * 7) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function StudentRegistry({ schoolId, classes, sections }: Props) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [page, setPage] = useState(1);
  const [gotoPage, setGotoPage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [compact, setCompact] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Student | null>(null);
  const [editTarget, setEditTarget] = useState<Student | null>(null);

  const handleSearch = useCallback((val: string) => {
    setQ(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => { setDebouncedQ(val); setPage(1); }, 400);
    setDebounceTimer(t);
  }, [debounceTimer]);

  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  if (cls) params.set("cls", cls);
  if (section) params.set("section", section);
  params.set("page", String(page));

  const { data, isLoading } = useQuery<{ data: Student[]; total: number }>({
    queryKey: ["/api/schools", schoolId, "students", "paginated", debouncedQ, cls, section, page],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/students/paginated?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!schoolId,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const form = useForm<AddForm>({ resolver: zodResolver(addSchema), defaultValues: { name: "", class: "", section: "", phone: "", dob: "" } });
  const addMutation = useMutation({
    mutationFn: async (d: AddForm) => { const r = await apiRequest("POST", `/api/schools/${schoolId}/students`, d); return r.json(); },
    onSuccess: (d) => {
      toast({ title: "Student Added", description: `DSID: ${d.digitalStudentId}` });
      form.reset(); setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "students"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const uploadRef = { current: null as HTMLInputElement | null };
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch(`/api/schools/${schoolId}/students/upload`, { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      return r.json();
    },
    onSuccess: (d) => {
      toast({ title: "Upload Complete", description: d.message });
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "students"] });
    },
    onError: (e: Error) => toast({ title: "Upload Failed", description: e.message, variant: "destructive" }),
  });

  const editForm = useForm<EditForm>({ resolver: zodResolver(editSchema), defaultValues: { name: "", class: "", section: "", phone: "" } });

  useEffect(() => {
    if (editTarget) {
      editForm.reset({
        name: editTarget.name,
        class: editTarget.class,
        section: editTarget.section,
        phone: editTarget.phone,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTarget]);

  const editMutation = useMutation({
    mutationFn: async (d: EditForm) => {
      const r = await apiRequest("PATCH", `/api/admin/students/${editTarget!.id}`, d);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Student Updated", description: `${editTarget?.name} record saved.` });
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "students", "paginated"] });
    },
    onError: (e: Error) => toast({ title: "Update Failed", description: e.message, variant: "destructive" }),
  });

  function commitGotoPage() {
    const n = parseInt(gotoPage);
    if (!isNaN(n) && n >= 1 && n <= totalPages) { setPage(n); }
    setGotoPage("");
  }
  function onGotoKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitGotoPage();
  }

  const cell = compact ? "py-1.5 px-3 text-xs" : "py-3 px-4 text-sm";

  const classList = classes.length > 0 ? classes : ["LKG", "UKG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
  const sectionList = sections.length > 0 ? sections : ["A", "B", "C", "D", "E"];

  const editClassList = editTarget && !classList.includes(editTarget.class)
    ? [editTarget.class, ...classList] : classList;
  const editSectionList = editTarget && !sectionList.includes(editTarget.section)
    ? [editTarget.section, ...sectionList] : sectionList;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Student Registry</h2>
          <p className="text-white/50 text-sm">{data?.total ?? "…"} active students · Page {page} of {totalPages}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setCompact(c => !c)}
            title={compact ? "Normal View" : "Compact View"}
            data-testid="button-toggle-compact"
            className={`flex items-center gap-1.5 px-3 rounded-lg border text-xs font-medium transition-colors h-11 min-w-[44px]
              ${compact ? "border-[#10b981]/50 bg-[#10b981]/10 text-[#10b981]" : "border-white/20 text-white/60 hover:bg-white/10"}`}
          >
            <AlignJustify className="w-3.5 h-3.5" />
            {compact ? "Compact" : "Normal"}
          </button>
          <Button size="sm" variant="outline" className="border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10 h-11"
            onClick={() => uploadRef.current?.click()} data-testid="button-upload-csv" disabled={uploadMutation.isPending}>
            <Upload className="w-4 h-4 mr-1" /> {uploadMutation.isPending ? "Uploading…" : "Bulk CSV"}
          </Button>
          <input ref={el => uploadRef.current = el} type="file" accept=".csv,.xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); }} />
          <Button size="sm" className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold h-11"
            onClick={() => setShowForm(!showForm)} data-testid="button-add-student-toggle">
            <UserPlus className="w-4 h-4 mr-1" /> Add Student
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">New Student</h3>
            <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white h-11 w-11 flex items-center justify-center"><X className="w-4 h-4" /></button>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => addMutation.mutate(d))} className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Full Name</FormLabel>
                  <FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white" data-testid="input-student-name" /></FormControl>
                  <FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="class" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Class</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-student-class">
                      <SelectValue placeholder="Class" />
                    </SelectTrigger>
                    <SelectContent>{classList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="section" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Section</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-student-section">
                      <SelectValue placeholder="Section" />
                    </SelectTrigger>
                    <SelectContent>{sectionList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Phone</FormLabel>
                  <FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white" data-testid="input-student-phone" /></FormControl>
                  <FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="dob" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Date of Birth</FormLabel>
                  <FormControl><Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white" data-testid="input-student-dob" /></FormControl>
                  <FormMessage /></FormItem>
              )} />
              <div className="flex items-end">
                <Button type="submit" disabled={addMutation.isPending} className="w-full bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid="button-submit-student">
                  {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Student"}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      )}

      <div className="pb-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <Input value={q} onChange={e => handleSearch(e.target.value)}
              placeholder="Search name, DSID or phone…"
              className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30"
              data-testid="input-search-students" />
          </div>
          <Select value={cls} onValueChange={v => { setCls(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-32 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-class">
              <SelectValue placeholder="All Classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {classList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={section} onValueChange={v => { setSection(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-32 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-section">
              <SelectValue placeholder="All Sections" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sections</SelectItem>
              {sectionList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="overflow-x-auto" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <table className="text-sm" style={{ minWidth: "640px", width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "150px" }} />
              <col style={{ width: "auto" }} />
              <col style={{ width: "70px" }} />
              <col style={{ width: "55px" }} />
              <col style={{ width: "130px" }} />
              <col style={{ width: "96px" }} />
            </colgroup>
            <thead className="bg-[#0F1E35] sticky top-0 z-10">
              <tr>
                <th className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide">DSID</th>
                <th className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide">Name</th>
                <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Class</th>
                <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Sec</th>
                <th className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide">Phone</th>
                <th className="text-left py-3 px-2 text-white/60 font-medium text-xs uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? [...Array(8)].map((_, i) => <SkeletonRow key={i} compact={compact} />)
                : data?.data.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-white/40">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />No students found
                      </td>
                    </tr>
                  )
                  : data?.data.map(s => (
                    <tr key={s.id}
                      className="border-b border-white/5 hover:bg-white/5 even:bg-white/[0.025] transition-colors"
                      data-testid={`row-student-${s.id}`}>
                      <td className={`${cell} font-mono text-[#D4AF37] overflow-hidden text-ellipsis`}>{s.digitalStudentId}</td>
                      <td className={`${cell} text-white font-medium overflow-hidden text-ellipsis`}>{s.name}</td>
                      <td className={`${compact ? "py-1.5 px-3 text-xs" : "py-3 px-3 text-sm"} text-white/70`}>{s.class}</td>
                      <td className={`${compact ? "py-1.5 px-3 text-xs" : "py-3 px-3 text-sm"} text-white/70`}>{s.section}</td>
                      <td className={`${cell} text-white/70 overflow-hidden text-ellipsis`}>{s.phone}</td>
                      <td className={`${compact ? "py-1.5 px-2" : "py-3 px-2"} whitespace-nowrap`}>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost" size="icon"
                            className="text-[#10b981] hover:text-emerald-300 hover:bg-[#10b981]/10 h-11 w-11 shrink-0"
                            onClick={() => setEditTarget(s)}
                            data-testid={`button-edit-student-${s.id}`}
                            title="Edit student">
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-11 w-11 shrink-0"
                            onClick={() => setDeactivateTarget(s)}
                            data-testid={`button-deactivate-student-${s.id}`}
                            title="Deactivate student">
                            <UserX className="w-4 h-4" />
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

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-white/40 text-sm">
          Showing {data?.total ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, data?.total ?? 0)} of {data?.total ?? 0}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="border-white/20 text-white hover:bg-white/10 h-11 min-w-[44px]" data-testid="button-prev-page">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="px-3 py-2 rounded bg-[#1A2942] text-white text-sm min-w-[70px] text-center">{page} / {totalPages}</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={gotoPage}
            onChange={e => setGotoPage(e.target.value)}
            onKeyDown={onGotoKeyDown}
            onBlur={commitGotoPage}
            placeholder="Go to…"
            data-testid="input-goto-page"
            className="w-[72px] h-11 px-2 rounded bg-[#1A2942] border border-white/20 text-white text-sm text-center placeholder:text-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:border-[#10b981]/60"
          />
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="border-white/20 text-white hover:bg-white/10 h-11 min-w-[44px]" data-testid="button-next-page">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="modal-edit-student">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditTarget(null)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#1A2942] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#10b981]/20 flex items-center justify-center">
                  <Pencil className="w-4 h-4 text-[#10b981]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Edit Student</h3>
                  <p className="text-xs text-white/40">{editTarget.name}</p>
                </div>
              </div>
              <button
                onClick={() => setEditTarget(null)}
                className="rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors h-11 w-11 flex items-center justify-center"
                data-testid="button-close-edit-modal">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(d => editMutation.mutate(d))} className="space-y-4">
                  <div>
                    <label className="text-xs text-white/50 font-medium uppercase tracking-wide mb-1.5 block">DSID (read-only)</label>
                    <Input
                      value={editTarget.digitalStudentId}
                      readOnly
                      data-testid="input-edit-dsid"
                      className="bg-[#0A1628] border-white/10 text-[#D4AF37] font-mono cursor-not-allowed opacity-75" />
                  </div>
                  <FormField control={editForm.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70">Full Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-name" className="bg-[#0A1628] border-white/20 text-white" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={editForm.control} name="class" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70">Class</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-edit-class">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            {editClassList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={editForm.control} name="section" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70">Section</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-edit-section">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            {editSectionList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={editForm.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70">Phone Number</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-phone" placeholder="e.g. 9876543210"
                          className="bg-[#0A1628] border-white/20 text-white" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="flex gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={editMutation.isPending}
                      onClick={() => setEditTarget(null)}
                      className="flex-1 border-white/20 text-white/60 hover:bg-white/10 h-11"
                      data-testid="button-cancel-edit">
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={editMutation.isPending}
                      className="flex-1 h-11 font-semibold text-white"
                      style={{ background: "#10b981" }}
                      data-testid="button-save-student">
                      {editMutation.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving…</>
                        : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          </div>
        </div>
      )}

      {deactivateTarget && (
        <DeactivationModal
          open={!!deactivateTarget}
          onClose={() => setDeactivateTarget(null)}
          type="student"
          targetId={deactivateTarget.id}
          targetName={deactivateTarget.name}
          schoolId={schoolId}
          invalidateKeys={[
            ["/api/schools", schoolId, "students", "paginated"],
            ["/api/schools", schoolId, "students"],
            ["/api/me"],
          ]}
        />
      )}
    </div>
  );
}
