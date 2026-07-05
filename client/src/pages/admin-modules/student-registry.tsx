import { useState, useCallback, useEffect, type KeyboardEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Search, ChevronLeft, ChevronRight, UserPlus, Upload, X,
  Loader2, Users, UserX, Pencil, AlignJustify, FileDown,
  RotateCcw, Hash, Eye, Trash2, CheckSquare,
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

interface Props {
  schoolId: number;
  classes: string[];
  sections: string[];
  viewSessionId?: number;
  isArchiveMode?: boolean;
}

const PAGE_SIZE = 50;

const addSchema = z.object({
  name: z.string().min(1, "Name required"),
  class: z.string().min(1, "Class required"),
  section: z.string().min(1, "Section required"),
  phone: z.string().min(7, "Valid phone required"),
  dob: z.string().min(1, "Date of birth required"),
  gender: z.enum(["Boy", "Girl"]).optional(),
  rollNumber: z.string().optional(),
  guardianName: z.string().optional(),
});
type AddForm = z.infer<typeof addSchema>;

const editSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  class: z.string().min(1, "Class is required"),
  section: z.string().min(1, "Section is required"),
  phone: z.string().regex(/^[0-9+\-\s()]{7,15}$/, "Invalid phone number (7–15 digits)"),
  gender: z.enum(["Boy", "Girl"]).optional().nullable(),
  rollNumber: z.string().optional(),
  guardianName: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function SkeletonRow({ compact, cols }: { compact: boolean; cols: number }) {
  return (
    <tr className="border-b border-white/5">
      {[...Array(cols)].map((_, i) => (
        <td key={i} className={compact ? "py-1.5 px-3" : "py-3 px-3"}>
          <div className="h-3.5 rounded bg-white/10 animate-pulse" style={{ width: `${50 + (i * 11) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

function GenderBadge({ gender }: { gender: string | null | undefined }) {
  if (!gender) return <span className="text-white/30 text-xs">—</span>;
  const isBoy = gender === "Boy";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold
      ${isBoy ? "bg-blue-500/20 text-blue-300" : "bg-pink-500/20 text-pink-300"}`}>
      {gender}
    </span>
  );
}

export default function StudentRegistry({ schoolId, classes, sections, viewSessionId, isArchiveMode }: Props) {
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
  const [viewTarget, setViewTarget] = useState<Student | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  const handleSearch = useCallback((val: string) => {
    setQ(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => { setDebouncedQ(val); setPage(1); }, 400);
    setDebounceTimer(t);
  }, [debounceTimer]);

  function handleResetFilters() {
    setQ(""); setDebouncedQ(""); setCls(""); setSection(""); setPage(1); setSelected(new Set());
  }

  const hasFilters = q || cls || section;

  async function handleExport() {
    setIsExporting(true);
    try {
      const exportParams = new URLSearchParams();
      if (debouncedQ) exportParams.set("q", debouncedQ);
      if (cls) exportParams.set("cls", cls);
      if (section) exportParams.set("section", section);
      const r = await fetch(`/api/schools/${schoolId}/students/export?${exportParams}`, { credentials: "include" });
      if (!r.ok) { toast({ title: "Export Failed", description: "Could not generate the file.", variant: "destructive" }); return; }
      const blob = await r.blob();
      const disposition = r.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : `Student_Registry_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      toast({ title: "Export Failed", description: "An unexpected error occurred.", variant: "destructive" });
    } finally { setIsExporting(false); }
  }

  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  if (cls) params.set("cls", cls);
  if (section) params.set("section", section);
  params.set("page", String(page));

  const sessionHeaders: HeadersInit = viewSessionId
    ? { "x-view-session-id": String(viewSessionId) }
    : {};

  const { data, isLoading } = useQuery<{ data: Student[]; total: number }>({
    queryKey: ["/api/schools", schoolId, "students", "paginated", debouncedQ, cls, section, page, viewSessionId],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/students/paginated?${params}`, { credentials: "include", headers: sessionHeaders });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!schoolId,
  });

  const statsParams = new URLSearchParams();
  if (cls) statsParams.set("cls", cls);
  if (section) statsParams.set("section", section);

  const { data: stats } = useQuery<{ total: number; boys: number; girls: number }>({
    queryKey: ["/api/schools", schoolId, "students", "stats", cls, section, viewSessionId],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/students/stats?${statsParams}`, { credentials: "include", headers: sessionHeaders });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!schoolId,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const uploadRef = { current: null as HTMLInputElement | null };

  const form = useForm<AddForm>({
    resolver: zodResolver(addSchema),
    defaultValues: { name: "", class: "", section: "", phone: "", dob: "", gender: undefined, rollNumber: "", guardianName: "" },
  });

  const addMutation = useMutation({
    mutationFn: async (d: AddForm) => {
      const payload = {
        ...d,
        rollNumber: d.rollNumber ? parseInt(d.rollNumber) : undefined,
      };
      const r = await apiRequest("POST", `/api/schools/${schoolId}/students`, payload);
      return r.json();
    },
    onSuccess: (d) => {
      toast({ title: "Student Added", description: `DSID: ${d.digitalStudentId}` });
      form.reset(); setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "students"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

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

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: "", class: "", section: "", phone: "", gender: undefined, rollNumber: "", guardianName: "" },
  });

  useEffect(() => {
    if (editTarget) {
      editForm.reset({
        name: editTarget.name,
        class: editTarget.class,
        section: editTarget.section,
        phone: editTarget.phone,
        gender: (editTarget.gender as "Boy" | "Girl" | null) ?? undefined,
        rollNumber: editTarget.rollNumber != null ? String(editTarget.rollNumber) : "",
        guardianName: editTarget.guardianName ?? "",
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTarget]);

  const editMutation = useMutation({
    mutationFn: async (d: EditForm) => {
      const payload = {
        name: d.name, class: d.class, section: d.section, phone: d.phone,
        gender: d.gender ?? null,
        rollNumber: d.rollNumber ? parseInt(d.rollNumber) : null,
        guardianName: d.guardianName || null,
      };
      const r = await apiRequest("PATCH", `/api/admin/students/${editTarget!.id}`, payload);
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Student Updated", description: `${editTarget?.name} record saved.` });
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "students"] });
    },
    onError: (e: Error) => toast({ title: "Update Failed", description: e.message, variant: "destructive" }),
  });

  const autoAssignMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/schools/${schoolId}/students/auto-assign-roll`, { cls, section });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      return r.json();
    },
    onSuccess: (d) => {
      toast({ title: "Roll Numbers Assigned", description: d.message });
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "students"] });
    },
    onError: (e: Error) => toast({ title: "Auto-Assign Failed", description: e.message, variant: "destructive" }),
  });

  const bulkDeactivateMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      const r = await apiRequest("POST", `/api/schools/${schoolId}/students/bulk-deactivate`, { ids });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      return r.json();
    },
    onSuccess: (d) => {
      toast({ title: "Students Deactivated", description: `${d.deactivated} student(s) deactivated.` });
      setSelected(new Set()); setShowBulkConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "students"] });
    },
    onError: (e: Error) => toast({ title: "Bulk Deactivate Failed", description: e.message, variant: "destructive" }),
  });

  function commitGotoPage() {
    const n = parseInt(gotoPage);
    if (!isNaN(n) && n >= 1 && n <= totalPages) setPage(n);
    setGotoPage("");
  }
  function onGotoKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitGotoPage();
  }

  const cell = compact ? "py-1.5 px-3 text-xs" : "py-3 px-3 text-sm";

  const classList = classes.length > 0 ? classes : ["LKG", "UKG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
  const sectionList = sections.length > 0 ? sections : ["A", "B", "C", "D", "E"];

  const editClassList = editTarget && !classList.includes(editTarget.class) ? [editTarget.class, ...classList] : classList;
  const editSectionList = editTarget && !sectionList.includes(editTarget.section) ? [editTarget.section, ...sectionList] : sectionList;

  const allPageIds = data?.data.map(s => s.id) ?? [];
  const allSelected = allPageIds.length > 0 && allPageIds.every(id => selected.has(id));
  const someSelected = allPageIds.some(id => selected.has(id));

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) { allPageIds.forEach(id => next.delete(id)); }
      else { allPageIds.forEach(id => next.add(id)); }
      return next;
    });
  }
  function toggleOne(id: number) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  const colCount = 9;

  return (
    <div className="space-y-4">

      {/* Archive mode notice */}
      {isArchiveMode && (
        <div
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-semibold"
          style={{
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.22)",
            color: "#fbbf24",
          }}
          data-testid="registry-archive-notice"
        >
          <span role="img" aria-label="archive">⚠️</span>
          <span>Archive View — this roster reflects session data only. Write operations are disabled.</span>
        </div>
      )}

      {/* Header */}
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
          <Button size="sm" variant="outline"
            className="border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10 h-11"
            onClick={handleExport} disabled={isExporting} data-testid="button-export-excel">
            {isExporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />}
            {isExporting ? "Exporting…" : "Export"}
          </Button>
          <Button size="sm" variant="outline" className="border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10 h-11"
            onClick={() => uploadRef.current?.click()} data-testid="button-upload-csv" disabled={isArchiveMode || uploadMutation.isPending}>
            <Upload className="w-4 h-4 mr-1" /> {uploadMutation.isPending ? "Uploading…" : "Bulk CSV"}
          </Button>
          <input ref={el => uploadRef.current = el} type="file" accept=".csv,.xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); }} />
          <Button size="sm" className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold h-11"
            onClick={() => setShowForm(!showForm)} disabled={isArchiveMode} data-testid="button-add-student-toggle">
            <UserPlus className="w-4 h-4 mr-1" /> Add Student
          </Button>
        </div>
      </div>

      {/* Analytics Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/10 bg-[#1A2942] p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#D4AF37]/15 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide">Total</p>
            <p className="text-2xl font-bold text-white" data-testid="stat-total">{stats?.total ?? "—"}</p>
          </div>
        </div>
        <div className="rounded-xl border border-blue-500/20 bg-[#1A2942] p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
            <span className="text-blue-300 text-lg font-bold">♂</span>
          </div>
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide">Boys</p>
            <p className="text-2xl font-bold text-blue-300" data-testid="stat-boys">{stats?.boys ?? "—"}</p>
          </div>
        </div>
        <div className="rounded-xl border border-pink-500/20 bg-[#1A2942] p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-pink-500/15 flex items-center justify-center shrink-0">
            <span className="text-pink-300 text-lg font-bold">♀</span>
          </div>
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide">Girls</p>
            <p className="text-2xl font-bold text-pink-300" data-testid="stat-girls">{stats?.girls ?? "—"}</p>
          </div>
        </div>
      </div>

      {/* Add Form */}
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
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-student-class"><SelectValue placeholder="Class" /></SelectTrigger>
                    <SelectContent>{classList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="section" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Section</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-student-section"><SelectValue placeholder="Section" /></SelectTrigger>
                    <SelectContent>{sectionList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="gender" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Gender</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-student-gender"><SelectValue placeholder="Gender" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Boy">Boy</SelectItem>
                      <SelectItem value="Girl">Girl</SelectItem>
                    </SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="rollNumber" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Roll Number</FormLabel>
                  <FormControl><Input {...field} type="number" min="1" placeholder="Optional" className="bg-[#0A1628] border-white/20 text-white" data-testid="input-student-roll" /></FormControl>
                  <FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="guardianName" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Guardian Name</FormLabel>
                  <FormControl><Input {...field} placeholder="Optional" className="bg-[#0A1628] border-white/20 text-white" data-testid="input-student-guardian" /></FormControl>
                  <FormMessage /></FormItem>
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

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <Input value={q} onChange={e => handleSearch(e.target.value)}
            placeholder="Search name, DSID or phone…"
            className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30"
            data-testid="input-search-students" />
        </div>
        <Select value={cls || "all"} onValueChange={v => { setCls(v === "all" ? "" : v); setPage(1); setSelected(new Set()); }}>
          <SelectTrigger className="w-32 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-class">
            <SelectValue placeholder="All Classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {classList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={section || "all"} onValueChange={v => { setSection(v === "all" ? "" : v); setPage(1); setSelected(new Set()); }}>
          <SelectTrigger className="w-32 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-section">
            <SelectValue placeholder="All Sections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sections</SelectItem>
            {sectionList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button size="sm" variant="outline" onClick={handleResetFilters}
            className="border-white/20 text-white/60 hover:bg-white/10 h-11"
            data-testid="button-reset-filters">
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset
          </Button>
        )}
        {cls && section && (
          <Button size="sm" variant="outline"
            className="border-[#10b981]/40 text-[#10b981] hover:bg-[#10b981]/10 h-11"
            onClick={() => autoAssignMutation.mutate()}
            disabled={isArchiveMode || autoAssignMutation.isPending}
            data-testid="button-auto-assign-roll"
            title={`Auto-assign roll numbers to all students in ${cls}-${section} alphabetically`}>
            {autoAssignMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Hash className="w-3.5 h-3.5 mr-1.5" />}
            Auto Roll#
          </Button>
        )}
        {selected.size > 0 && (
          <Button size="sm" variant="outline"
            className="border-red-400/40 text-red-400 hover:bg-red-400/10 h-11"
            onClick={() => setShowBulkConfirm(true)}
            disabled={isArchiveMode}
            data-testid="button-bulk-deactivate">
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Deactivate {selected.size} Selected
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942]">
        <div className="overflow-x-auto" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <table className="text-sm" style={{ minWidth: "800px", width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "40px" }} />
              <col style={{ width: "130px" }} />
              <col style={{ width: "auto" }} />
              <col style={{ width: "60px" }} />
              <col style={{ width: "65px" }} />
              <col style={{ width: "65px" }} />
              <col style={{ width: "72px" }} />
              <col style={{ width: "115px" }} />
              <col style={{ width: "108px" }} />
            </colgroup>
            <thead className="bg-[#0F1E35] sticky top-0 z-10">
              <tr>
                <th className="py-3 px-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    data-testid="checkbox-select-all"
                    className="w-4 h-4 accent-[#10b981] cursor-pointer"
                  />
                </th>
                <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">DSID</th>
                <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Name</th>
                <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Roll#</th>
                <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Class</th>
                <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Sec</th>
                <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Gender</th>
                <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Phone</th>
                <th className="text-left py-3 px-2 text-white/60 font-medium text-xs uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? [...Array(8)].map((_, i) => <SkeletonRow key={i} compact={compact} cols={colCount} />)
                : data?.data.length === 0
                  ? (
                    <tr>
                      <td colSpan={colCount} className="py-12 text-center text-white/40">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />No students found
                      </td>
                    </tr>
                  )
                  : data?.data.map(s => (
                    <tr key={s.id}
                      className={`border-b border-white/5 hover:bg-white/5 even:bg-white/[0.025] transition-colors
                        ${selected.has(s.id) ? "bg-[#10b981]/5 border-l-2 border-l-[#10b981]/40" : ""}`}
                      data-testid={`row-student-${s.id}`}>
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={() => toggleOne(s.id)}
                          data-testid={`checkbox-student-${s.id}`}
                          className="w-4 h-4 accent-[#10b981] cursor-pointer"
                        />
                      </td>
                      <td className={`${cell} font-mono overflow-hidden`}>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[#D4AF37] truncate">{s.digitalStudentId}</span>
                          {s.idCardPendingReissue && (
                            <span className="text-[9px] font-semibold text-orange-400 leading-none">🔄 Reissue</span>
                          )}
                        </div>
                      </td>
                      <td className={`${cell} text-white font-medium overflow-hidden text-ellipsis`}>{s.name}</td>
                      <td className={`${cell} text-white/50 font-mono`}>
                        {s.rollNumber != null ? <span className="text-white/80">{s.rollNumber}</span> : <span className="text-white/20">—</span>}
                      </td>
                      <td className={`${cell} text-white/70`}>{s.class}</td>
                      <td className={`${cell} text-white/70`}>{s.section}</td>
                      <td className={`${cell}`}><GenderBadge gender={s.gender} /></td>
                      <td className={`${cell} text-white/70 overflow-hidden text-ellipsis`}>{s.phone}</td>
                      <td className={`${compact ? "py-1.5 px-2" : "py-2 px-2"} whitespace-nowrap`}>
                        <div className="flex items-center gap-0.5">
                          <Button variant="ghost" size="icon"
                            className="text-white/40 hover:text-white hover:bg-white/10 h-9 w-9 shrink-0"
                            onClick={() => setViewTarget(s)}
                            data-testid={`button-view-student-${s.id}`}
                            title="View profile">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon"
                            className="text-[#10b981] hover:text-emerald-300 hover:bg-[#10b981]/10 h-9 w-9 shrink-0"
                            onClick={() => setEditTarget(s)}
                            disabled={isArchiveMode}
                            data-testid={`button-edit-student-${s.id}`}
                            title="Edit student">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon"
                            className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-9 w-9 shrink-0"
                            onClick={() => setDeactivateTarget(s)}
                            disabled={isArchiveMode}
                            data-testid={`button-deactivate-student-${s.id}`}
                            title="Deactivate student">
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-white/40 text-sm">
          Showing {data?.total ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, data?.total ?? 0)} of {data?.total ?? 0}
          {selected.size > 0 && <span className="ml-2 text-[#10b981]">· {selected.size} selected</span>}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="border-white/20 text-white hover:bg-white/10 h-11 min-w-[44px]" data-testid="button-prev-page">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="px-3 py-2 rounded bg-[#1A2942] text-white text-sm min-w-[70px] text-center">{page} / {totalPages}</span>
          <input
            type="number" min={1} max={totalPages} value={gotoPage}
            onChange={e => setGotoPage(e.target.value)}
            onKeyDown={onGotoKeyDown} onBlur={commitGotoPage}
            placeholder="Go to…" data-testid="input-goto-page"
            className="w-[72px] h-11 px-2 rounded bg-[#1A2942] border border-white/20 text-white text-sm text-center placeholder:text-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:border-[#10b981]/60"
          />
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="border-white/20 text-white hover:bg-white/10 h-11 min-w-[44px]" data-testid="button-next-page">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* View Profile Modal */}
      {viewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="modal-view-student">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setViewTarget(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-[#1A2942] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Eye className="w-4 h-4 text-white/60" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Student Profile</h3>
                  <p className="text-xs text-white/40">{viewTarget.digitalStudentId}</p>
                </div>
              </div>
              <button onClick={() => setViewTarget(null)}
                className="rounded-lg hover:bg-white/10 text-white/50 hover:text-white h-11 w-11 flex items-center justify-center"
                data-testid="button-close-view-modal">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: "Full Name", value: viewTarget.name },
                { label: "DSID", value: viewTarget.digitalStudentId, mono: true, gold: true },
                { label: "Class", value: `${viewTarget.class} – ${viewTarget.section}` },
                { label: "Roll Number", value: viewTarget.rollNumber != null ? String(viewTarget.rollNumber) : "Not assigned" },
                { label: "Gender", value: viewTarget.gender ?? "Not set" },
                { label: "Phone", value: viewTarget.phone },
                { label: "Guardian", value: viewTarget.guardianName ?? "Not recorded" },
                { label: "Date of Birth", value: viewTarget.dob ?? "—" },
                { label: "Status", value: viewTarget.isActivated ? "Activated" : "Pending activation" },
              ].map(({ label, value, mono, gold }) => (
                <div key={label} className="flex justify-between items-start gap-3 text-sm">
                  <span className="text-white/50 shrink-0">{label}</span>
                  <span className={`text-right break-all ${mono ? "font-mono" : ""} ${gold ? "text-[#D4AF37]" : "text-white"}`}>{value}</span>
                </div>
              ))}
            </div>
            <div className="px-5 pb-5">
              <Button className="w-full h-11" variant="outline"
                onClick={() => { setViewTarget(null); setEditTarget(viewTarget); }}
                data-testid="button-view-to-edit">
                <Pencil className="w-4 h-4 mr-2" /> Edit this student
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
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
              <button onClick={() => setEditTarget(null)}
                className="rounded-lg hover:bg-white/10 text-white/50 hover:text-white h-11 w-11 flex items-center justify-center"
                data-testid="button-close-edit-modal">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto" style={{ maxHeight: "80vh" }}>
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(d => editMutation.mutate(d))} className="space-y-4">
                  <div>
                    <label className="text-xs text-white/50 font-medium uppercase tracking-wide mb-1.5 block">DSID (read-only)</label>
                    <Input value={editTarget.digitalStudentId} readOnly data-testid="input-edit-dsid"
                      className="bg-[#0A1628] border-white/10 text-[#D4AF37] font-mono cursor-not-allowed opacity-75" />
                  </div>
                  <FormField control={editForm.control} name="name" render={({ field }) => (
                    <FormItem><FormLabel className="text-white/70">Full Name</FormLabel>
                      <FormControl><Input {...field} data-testid="input-edit-name" className="bg-[#0A1628] border-white/20 text-white" /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={editForm.control} name="class" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Class</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-edit-class"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>{editClassList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={editForm.control} name="section" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Section</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-edit-section"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>{editSectionList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={editForm.control} name="gender" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Gender</FormLabel>
                        <Select onValueChange={v => field.onChange(v || null)} value={field.value ?? ""}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-edit-gender"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Boy">Boy</SelectItem>
                            <SelectItem value="Girl">Girl</SelectItem>
                          </SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={editForm.control} name="rollNumber" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Roll Number</FormLabel>
                        <FormControl><Input {...field} type="number" min="1" placeholder="Optional" data-testid="input-edit-roll"
                          className="bg-[#0A1628] border-white/20 text-white" /></FormControl>
                        <FormMessage /></FormItem>
                    )} />
                  </div>
                  <FormField control={editForm.control} name="phone" render={({ field }) => (
                    <FormItem><FormLabel className="text-white/70">Phone Number</FormLabel>
                      <FormControl><Input {...field} data-testid="input-edit-phone" placeholder="e.g. 9876543210"
                        className="bg-[#0A1628] border-white/20 text-white" /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={editForm.control} name="guardianName" render={({ field }) => (
                    <FormItem><FormLabel className="text-white/70">Guardian Name</FormLabel>
                      <FormControl><Input {...field} placeholder="Optional" data-testid="input-edit-guardian"
                        className="bg-[#0A1628] border-white/20 text-white" /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <div className="flex gap-3 pt-2">
                    <Button type="button" variant="outline" disabled={editMutation.isPending}
                      onClick={() => setEditTarget(null)}
                      className="flex-1 border-white/20 text-white/60 hover:bg-white/10 h-11"
                      data-testid="button-cancel-edit">Cancel</Button>
                    <Button type="submit" disabled={editMutation.isPending}
                      className="flex-1 h-11 font-semibold text-white" style={{ background: "#10b981" }}
                      data-testid="button-save-student">
                      {editMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving…</> : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Deactivate Confirm Modal */}
      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="modal-bulk-confirm">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowBulkConfirm(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-[#1A2942] shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0">
                <CheckSquare className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Confirm Bulk Deactivation</h3>
                <p className="text-xs text-white/50">This will deactivate {selected.size} student(s)</p>
              </div>
            </div>
            <p className="text-sm text-white/60 mb-5">
              Deactivated students will lose portal access. This action can be reversed by reactivating individual students.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 border-white/20 text-white/60 h-11"
                onClick={() => setShowBulkConfirm(false)} data-testid="button-cancel-bulk">Cancel</Button>
              <Button className="flex-1 h-11 bg-red-500 hover:bg-red-600 text-white font-semibold"
                onClick={() => bulkDeactivateMutation.mutate()}
                disabled={bulkDeactivateMutation.isPending}
                data-testid="button-confirm-bulk">
                {bulkDeactivateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Deactivate {selected.size}
              </Button>
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
