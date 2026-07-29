import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, UserPlus, Trash2, Pencil, ChevronLeft, ChevronRight, Loader2, X, Save, Eye, Calendar, MapPin, CreditCard, GraduationCap, User, Lock, History } from "lucide-react";
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
type TeacherWithEmail = Teacher & { email: string; mappings: { className: string; section: string; subject: string | null }[] };

const PAGE_SIZE = 20;

const GOVT_ID_TYPES = ["Aadhar", "Voter ID", "PAN", "Driving Licence"];

const addSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().length(10, "Phone must be exactly 10 digits").regex(/^\d{10}$/, "Only digits allowed"),
  designation: z.string().optional(),
  gender: z.string().optional(),
  dateOfBirth: z.string().optional(),
  govtIdType: z.string().optional(),
  govtIdNumber: z.string().optional(),
  address: z.string().optional(),
  joiningDate: z.string().optional(),
  qualifications: z.string().optional(),
});
type AddForm = z.infer<typeof addSchema>;

const editSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().length(10, "Phone must be exactly 10 digits").regex(/^\d{10}$/, "Only digits allowed"),
  designation: z.string().optional(),
  subject: z.string().optional(),
  assignedClass: z.string().optional(),
  assignedSection: z.string().optional(),
  gender: z.string().optional(),
  dateOfBirth: z.string().optional(),
  govtIdType: z.string().optional(),
  govtIdNumber: z.string().optional(),
  address: z.string().optional(),
  joiningDate: z.string().optional(),
  qualifications: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: 9 }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: `${45 + (i * 11) % 50}%` }} />
        </td>
      ))}
    </tr>
  );
}

function InfoRow({ label, value, icon: Icon }: { label: string; value?: string | null; icon?: any }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
      {Icon && <Icon className="w-3.5 h-3.5 text-[#D4AF37] mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-white/40 text-[10px] uppercase tracking-wide mb-0.5">{label}</p>
        <p className="text-white text-xs font-medium break-words">{value || "—"}</p>
      </div>
    </div>
  );
}

export default function TeacherRegistry({ schoolId, classes, sections, subjects, onNavigate, allowedSubs }: Props) {
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
  const [deleteReason, setDeleteReason] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [viewTarget, setViewTarget] = useState<TeacherWithEmail | null>(null);
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

  const handleFilterClass = (val: string) => { setFilterClass(val === "__all__" ? "" : val); setPage(1); };
  const handleFilterSection = (val: string) => { setFilterSection(val === "__all__" ? "" : val); setPage(1); };

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

  // ── Add form ──────────────────────────────────────────────
  const addForm = useForm<AddForm>({
    resolver: zodResolver(addSchema),
    defaultValues: { fullName: "", email: "", password: "", phone: "", designation: "", gender: "", dateOfBirth: "", govtIdType: "", govtIdNumber: "", address: "", joiningDate: "", qualifications: "" },
  });

  const watchGovtIdType = addForm.watch("govtIdType");

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

  // ── Edit form ─────────────────────────────────────────────
  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { fullName: "", phone: "", designation: "", subject: "", assignedClass: "", assignedSection: "", gender: "", dateOfBirth: "", govtIdType: "", govtIdNumber: "", address: "", joiningDate: "", qualifications: "" },
  });

  const watchEditGovtIdType = editForm.watch("govtIdType");

  useEffect(() => {
    if (editTarget) {
      editForm.reset({
        fullName: editTarget.fullName,
        phone: editTarget.phone,
        designation: editTarget.designation ?? "",
        subject: editTarget.subject ?? "",
        assignedClass: editTarget.assignedClass ?? "",
        assignedSection: editTarget.assignedSection ?? "",
        gender: (editTarget as any).gender ?? "",
        dateOfBirth: (editTarget as any).dateOfBirth ?? "",
        govtIdType: (editTarget as any).govtIdType ?? "",
        govtIdNumber: (editTarget as any).govtIdNumber ?? "",
        address: (editTarget as any).address ?? "",
        joiningDate: (editTarget as any).joiningDate ?? "",
        qualifications: (editTarget as any).qualifications ?? "",
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
    mutationFn: async ({ id, reason, adminPassword }: { id: number; reason: string; adminPassword: string }) => {
      await apiRequest("DELETE", `/api/admin/teachers/${id}`, { reason, adminPassword });
    },
    onSuccess: () => {
      toast({ title: "Teacher Removed", description: `${deleteTarget?.fullName} has been removed from the registry.` });
      setDeleteTarget(null);
      setDeleteReason("");
      setDeletePassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/teachers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "teachers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/faculty-mappings"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });


  const rangeStart = data ? ((page - 1) * PAGE_SIZE) + 1 : 0;
  const rangeEnd = data ? Math.min(page * PAGE_SIZE, data.total) : 0;

  // ── helper to get subjects from mappings ──────────────────
  const getSubjects = (t: TeacherWithEmail) => {
    const subjects = [...new Set((t.mappings ?? []).map(m => m.subject).filter(Boolean))] as string[];
    return subjects.length > 0 ? subjects.join(", ") : (t.subject || "—");
  };

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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline"
            className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 text-xs h-8 px-3"
            onClick={() => onNavigate?.("removed-teacher-history")}
            title="View removed teacher history">
            <History className="w-3.5 h-3.5 mr-1.5" /> Removed History
          </Button>
          {(!allowedSubs || allowedSubs.includes("add")) && (
            <Button size="sm" className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
              onClick={() => setShowForm(!showForm)} disabled={isArchiveMode} data-testid="button-add-teacher-toggle">
              <UserPlus className="w-4 h-4 mr-1" /> Add Teacher
            </Button>
          )}
        </div>
      </div>

      {/* ── Register New Teacher Form ── */}
      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Register New Teacher</h3>
            <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white p-1"><X className="w-4 h-4" /></button>
          </div>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(d => addMutation.mutate(d))} className="space-y-4">

              {/* Row 1 – Account credentials */}
              <div>
                <p className="text-[#D4AF37] text-[10px] uppercase tracking-widest mb-2 font-semibold">Account Info</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {(["fullName", "email", "password", "phone", "designation"] as const).map(name => (
                    <FormField key={name} control={addForm.control} name={name} render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70 text-xs">
                          {name === "fullName" ? "Full Name" : name.charAt(0).toUpperCase() + name.slice(1)}
                        </FormLabel>
                        <FormControl>
                          <Input {...field} type={name === "password" ? "password" : "text"}
                            className="bg-[#0A1628] border-white/20 text-white h-9 text-sm"
                            data-testid={`input-reg-teacher-${name}`}
                            {...(name === "phone" ? { inputMode: "numeric" as const, maxLength: 10, placeholder: "10-digit mobile number", onChange: (e: React.ChangeEvent<HTMLInputElement>) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 10)) } : {})} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  ))}
                </div>
              </div>

              {/* Row 2 – Personal details */}
              <div>
                <p className="text-[#D4AF37] text-[10px] uppercase tracking-widest mb-2 font-semibold">Personal Details</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {/* Gender */}
                  <FormField control={addForm.control} name="gender" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70 text-xs">Gender</FormLabel>
                      <Select value={field.value || ""} onValueChange={field.onChange}>
                        <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-9 text-sm">
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />

                  {/* Date of Birth */}
                  <FormField control={addForm.control} name="dateOfBirth" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70 text-xs">Date of Birth</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white h-9 text-sm" />
                      </FormControl>
                    </FormItem>
                  )} />

                  {/* Joining Date */}
                  <FormField control={addForm.control} name="joiningDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70 text-xs">Joining Date</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white h-9 text-sm" />
                      </FormControl>
                    </FormItem>
                  )} />

                  {/* Qualification */}
                  <FormField control={addForm.control} name="qualifications" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70 text-xs">Qualification</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. B.Ed, M.Sc" className="bg-[#0A1628] border-white/20 text-white h-9 text-sm" />
                      </FormControl>
                    </FormItem>
                  )} />

                  {/* Govt ID Type */}
                  <FormField control={addForm.control} name="govtIdType" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70 text-xs">Government ID Type</FormLabel>
                      <Select value={field.value || ""} onValueChange={field.onChange}>
                        <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-9 text-sm">
                          <SelectValue placeholder="Select ID type" />
                        </SelectTrigger>
                        <SelectContent>
                          {GOVT_ID_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />

                  {/* Govt ID Number – only show when type selected */}
                  {watchGovtIdType && (
                    <FormField control={addForm.control} name="govtIdNumber" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70 text-xs">{watchGovtIdType} Number</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Enter ID number" className="bg-[#0A1628] border-white/20 text-white h-9 text-sm" />
                        </FormControl>
                      </FormItem>
                    )} />
                  )}
                </div>

                {/* Address – full width */}
                <div className="mt-3">
                  <FormField control={addForm.control} name="address" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70 text-xs">Address</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Full residential address" className="bg-[#0A1628] border-white/20 text-white h-9 text-sm" />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button type="submit" disabled={isArchiveMode || addMutation.isPending}
                  className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
                  data-testid="button-submit-register-teacher">
                  {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <UserPlus className="w-4 h-4 mr-1" />}
                  Register Teacher
                </Button>
                <Button type="button" variant="ghost" className="text-white/50 hover:text-white hover:bg-white/10"
                  onClick={() => { setShowForm(false); addForm.reset(); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </div>
      )}

      {/* ── Search + Filters ── */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
          <Input value={q} onChange={e => handleSearch(e.target.value)} placeholder="Search by name or email…"
            className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30 h-10"
            data-testid="input-search-teacher-registry" />
        </div>
        <Select value={filterClass || "__all__"} onValueChange={handleFilterClass}>
          <SelectTrigger className="bg-[#1A2942] border-white/20 text-white h-10 w-[130px]" data-testid="select-filter-class">
            <SelectValue placeholder="All Classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Classes</SelectItem>
            {cfgClasses.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSection || "__all__"} onValueChange={handleFilterSection}>
          <SelectTrigger className="bg-[#1A2942] border-white/20 text-white h-10 w-[130px]" data-testid="select-filter-section">
            <SelectValue placeholder="All Sections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Sections</SelectItem>
            {cfgSections.map(s => <SelectItem key={s} value={s}>Section {s}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={clearFilters}
            className="text-white/50 hover:text-white hover:bg-white/10 h-10 px-3" data-testid="button-clear-teacher-filters">
            <X className="w-4 h-4 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="max-h-[480px] overflow-y-auto overflow-x-auto [scrollbar-width:thin] [scrollbar-color:#D4AF37_#0A1628]">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-[#0F1E35]">
              <tr>
                {["DTID","Name","Email","Phone","Subject","Sections","Designation","Gender","DOB","Joining","Qualification","Govt ID","Actions"].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide border-b border-white/10 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : !data?.data.length
                  ? (
                    <tr><td colSpan={13} className="py-12 text-center text-white/40">
                      {hasFilters
                        ? `No teachers found${filterClass ? ` in Class ${filterClass}` : ""}${filterSection ? ` Section ${filterSection}` : ""}${debouncedQ ? ` matching "${debouncedQ}"` : ""}`
                        : "No teachers registered yet"}
                    </td></tr>
                  )
                  : data.data.map(t => {
                    const ta = t as any;
                    return (
                      <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`row-teacher-reg-${t.id}`}>
                        {/* DTID */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="text-[#D4AF37] font-mono text-xs font-semibold tracking-wide">{ta.digitalTeacherId || "—"}</span>
                        </td>
                        {/* Name */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {ta.profileImageUrl
                              ? <img src={ta.profileImageUrl} alt={t.fullName} className="w-7 h-7 rounded-full object-cover shrink-0 border border-white/10" />
                              : <div className="w-7 h-7 rounded-full bg-[#D4AF37]/20 text-[#D4AF37] text-xs font-bold flex items-center justify-center shrink-0">
                                  {t.fullName.charAt(0).toUpperCase()}
                                </div>
                            }
                            <span className="text-white font-medium">{t.fullName}</span>
                          </div>
                        </td>
                        {/* Email */}
                        <td className="py-3 px-4 text-white/70 text-xs">{t.email}</td>
                        {/* Phone */}
                        <td className="py-3 px-4 text-white/70 text-xs whitespace-nowrap">{t.phone}</td>
                        {/* Subject */}
                        <td className="py-3 px-4 text-[#D4AF37] text-xs">{getSubjects(t)}</td>
                        {/* Sections */}
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1" data-testid={`cell-sections-${t.id}`}>
                            {(t.mappings ?? []).length > 0
                              ? (t.mappings ?? []).map((m, idx) => (
                                  <button key={idx} onClick={() => onNavigate?.("faculty-mapping")}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30 hover:bg-[#D4AF37]/30 transition-colors cursor-pointer"
                                    title="Go to Faculty Mapping" data-testid={`badge-section-${t.id}-${idx}`}>
                                    {m.className}-{m.section}
                                  </button>
                                ))
                              : (
                                <button onClick={() => onNavigate?.("faculty-mapping")}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer"
                                  title="Go to Faculty Mapping" data-testid={`badge-section-primary-${t.id}`}>
                                  {t.assignedClass}-{t.assignedSection}
                                </button>
                              )}
                          </div>
                        </td>
                        {/* Designation */}
                        <td className="py-3 px-4 text-white/50 text-xs whitespace-nowrap">{t.designation || "—"}</td>
                        {/* Gender */}
                        <td className="py-3 px-4 text-white/70 text-xs whitespace-nowrap">{ta.gender || "—"}</td>
                        {/* DOB */}
                        <td className="py-3 px-4 text-white/70 text-xs whitespace-nowrap">{ta.dateOfBirth || "—"}</td>
                        {/* Joining Date */}
                        <td className="py-3 px-4 text-white/70 text-xs whitespace-nowrap">{ta.joiningDate || "—"}</td>
                        {/* Qualification */}
                        <td className="py-3 px-4 text-white/70 text-xs">{ta.qualifications || "—"}</td>
                        {/* Govt ID */}
                        <td className="py-3 px-4 text-white/70 text-xs whitespace-nowrap">
                          {ta.govtIdType ? <span>{ta.govtIdType}{ta.govtIdNumber ? ` · ${ta.govtIdNumber}` : ""}</span> : "—"}
                        </td>
                        {/* Actions */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            {/* View */}
                            <Button variant="ghost" size="icon" className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10 h-8 w-8"
                              onClick={() => setViewTarget(t)} title="View Details" data-testid={`button-view-teacher-reg-${t.id}`}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            {/* Edit */}
                            {(!allowedSubs || allowedSubs.includes("edit")) && (
                              <Button variant="ghost" size="icon" className="text-[#D4AF37] hover:text-yellow-300 hover:bg-yellow-400/10 h-8 w-8"
                                onClick={() => setEditTarget(t)} disabled={isArchiveMode} title="Edit" data-testid={`button-edit-teacher-reg-${t.id}`}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {/* Delete */}
                            {(!allowedSubs || allowedSubs.includes("deactivate")) && (
                              <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-8 w-8"
                                onClick={() => setDeleteTarget(t)} disabled={isArchiveMode} title="Remove" data-testid={`button-delete-teacher-reg-${t.id}`}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
              }
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-sm">{data?.total ? `${rangeStart}–${rangeEnd} of ${data.total}` : "No results"}</p>
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

      {/* ── View Details Modal ── */}
      {viewTarget && (() => {
        const va = viewTarget as any;
        const subjects = [...new Set((viewTarget.mappings ?? []).map(m => m.subject).filter(Boolean))] as string[];
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setViewTarget(null); }}>
            <div className="w-full max-w-lg rounded-2xl bg-[#1A2942] border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-[#0F1E35]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#D4AF37]/20 flex items-center justify-center overflow-hidden shrink-0">
                    {va.profileImageUrl
                      ? <img src={va.profileImageUrl} alt={viewTarget.fullName} className="w-full h-full object-cover rounded-full" />
                      : <User className="w-5 h-5 text-[#D4AF37]" />}
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-sm">{viewTarget.fullName}</h3>
                    {va.digitalTeacherId && <p className="text-[#D4AF37] font-mono text-xs">{va.digitalTeacherId}</p>}
                    <p className="text-white/40 text-xs">{viewTarget.email}</p>
                  </div>
                </div>
                <button onClick={() => setViewTarget(null)} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="overflow-y-auto p-5 space-y-4 [scrollbar-width:thin]">
                {/* Account */}
                <div>
                  <p className="text-[#D4AF37] text-[10px] uppercase tracking-widest mb-1 font-semibold">Account Info</p>
                  <div className="bg-[#0A1628]/50 rounded-xl px-4">
                    <InfoRow label="Email" value={viewTarget.email} />
                    <InfoRow label="Phone" value={viewTarget.phone} />
                    <InfoRow label="Designation" value={viewTarget.designation} />
                  </div>
                </div>

                {/* Personal */}
                <div>
                  <p className="text-[#D4AF37] text-[10px] uppercase tracking-widest mb-1 font-semibold">Personal Details</p>
                  <div className="bg-[#0A1628]/50 rounded-xl px-4">
                    <InfoRow label="Gender" value={va.gender} icon={User} />
                    <InfoRow label="Date of Birth" value={va.dateOfBirth} icon={Calendar} />
                    <InfoRow label="Joining Date" value={va.joiningDate} icon={Calendar} />
                    <InfoRow label="Qualification" value={va.qualifications} icon={GraduationCap} />
                    <InfoRow label="Address" value={va.address} icon={MapPin} />
                  </div>
                </div>

                {/* Govt ID – always visible */}
                <div>
                  <p className="text-[#D4AF37] text-[10px] uppercase tracking-widest mb-1 font-semibold">Government ID</p>
                  <div className="bg-[#0A1628]/50 rounded-xl px-4">
                    <InfoRow label="ID Type" value={va.govtIdType} icon={CreditCard} />
                    <InfoRow label="ID Number" value={va.govtIdNumber} />
                  </div>
                </div>

                {/* Assignments */}
                <div>
                  <p className="text-[#D4AF37] text-[10px] uppercase tracking-widest mb-1 font-semibold">Faculty Assignments</p>
                  <div className="bg-[#0A1628]/50 rounded-xl px-4">
                    <InfoRow label="Subjects" value={subjects.length > 0 ? subjects.join(", ") : (viewTarget.subject || "—")} />
                    <div className="py-2.5">
                      <p className="text-white/40 text-[10px] uppercase tracking-wide mb-1.5">Assigned Sections</p>
                      {(viewTarget.mappings ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {(viewTarget.mappings ?? []).map((m, idx) => (
                            <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30">
                              {m.className}-{m.section}{m.subject ? ` (${m.subject})` : ""}
                            </span>
                          ))}
                        </div>
                      ) : <p className="text-white text-xs">—</p>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 py-3 border-t border-white/10 flex justify-end">
                <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => setViewTarget(null)}>Close</Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Edit Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-edit-teacher-registry"
          onClick={e => { if (e.target === e.currentTarget) setEditTarget(null); }}>
          <div className="w-full max-w-2xl rounded-2xl bg-[#1A2942] border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Pencil className="w-4 h-4 text-[#D4AF37]" /> Edit Teacher</h3>
                <p className="text-xs text-white/40">{editTarget.email}</p>
                {(editTarget as any).digitalTeacherId && (
                  <p className="text-xs text-[#D4AF37] font-mono font-semibold mt-0.5">{(editTarget as any).digitalTeacherId}</p>
                )}
              </div>
              <button onClick={() => setEditTarget(null)} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors" data-testid="button-close-edit-teacher-registry">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto [scrollbar-width:thin] space-y-4">
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(d => editMutation.mutate(d))} className="space-y-4">

                  {/* Account */}
                  <div>
                    <p className="text-[#D4AF37] text-[10px] uppercase tracking-widest mb-2 font-semibold">Account Info</p>
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
                          <FormControl><Input {...field} inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-edit-reg-phone" onChange={e => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 10))} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={editForm.control} name="designation" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/70 text-xs">Designation</FormLabel>
                          <FormControl><Input {...field} placeholder="e.g. HOD, Senior Teacher" className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-edit-reg-designation" /></FormControl>
                        </FormItem>
                      )} />
                    </div>
                  </div>

                  {/* Personal */}
                  <div>
                    <p className="text-[#D4AF37] text-[10px] uppercase tracking-widest mb-2 font-semibold">Personal Details</p>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={editForm.control} name="gender" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/70 text-xs">Gender</FormLabel>
                          <Select value={field.value || ""} onValueChange={field.onChange}>
                            <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-10">
                              <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Male">Male</SelectItem>
                              <SelectItem value="Female">Female</SelectItem>
                              <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={editForm.control} name="dateOfBirth" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/70 text-xs">Date of Birth</FormLabel>
                          <FormControl><Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white h-10" /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={editForm.control} name="joiningDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/70 text-xs">Joining Date</FormLabel>
                          <FormControl><Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white h-10" /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={editForm.control} name="qualifications" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/70 text-xs">Qualification</FormLabel>
                          <FormControl><Input {...field} placeholder="e.g. B.Ed, M.Sc" className="bg-[#0A1628] border-white/20 text-white h-10" /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={editForm.control} name="govtIdType" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/70 text-xs">Government ID Type</FormLabel>
                          <Select value={field.value || ""} onValueChange={field.onChange}>
                            <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-10">
                              <SelectValue placeholder="Select ID type" />
                            </SelectTrigger>
                            <SelectContent>
                              {GOVT_ID_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      {watchEditGovtIdType && (
                        <FormField control={editForm.control} name="govtIdNumber" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/70 text-xs">{watchEditGovtIdType} Number</FormLabel>
                            <FormControl><Input {...field} placeholder="Enter ID number" className="bg-[#0A1628] border-white/20 text-white h-10" /></FormControl>
                          </FormItem>
                        )} />
                      )}
                    </div>
                    <div className="mt-3">
                      <FormField control={editForm.control} name="address" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/70 text-xs">Address</FormLabel>
                          <FormControl><Input {...field} placeholder="Full residential address" className="bg-[#0A1628] border-white/20 text-white h-10" /></FormControl>
                        </FormItem>
                      )} />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button type="submit" disabled={isArchiveMode || editMutation.isPending}
                      className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold flex-1" data-testid="button-save-edit-teacher-registry">
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

      {/* ── Delete Confirm Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-delete-teacher-registry"
          onClick={e => { if (e.target === e.currentTarget) { setDeleteTarget(null); setDeleteReason(""); setDeletePassword(""); } }}>
          <div className="w-full max-w-md rounded-2xl bg-[#1A2942] border border-red-500/30 shadow-2xl overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-red-500/10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-red-500/20 flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-sm">Remove Teacher?</h3>
                  <p className="text-white/40 text-xs">{deleteTarget.fullName} · {(deleteTarget as any).digitalTeacherId || deleteTarget.email}</p>
                </div>
              </div>
              <button onClick={() => { setDeleteTarget(null); setDeleteReason(""); setDeletePassword(""); }}
                className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-white/60 text-sm">
                This will <span className="text-red-300 font-medium">permanently remove</span> this teacher from the registry. Their login account and all assignments will also be deleted.
              </p>

              {/* Reason */}
              <div className="space-y-1.5">
                <label className="text-white/70 text-xs font-medium uppercase tracking-wide">
                  Reason for Removal <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={deleteReason}
                  onChange={e => setDeleteReason(e.target.value)}
                  placeholder="Enter reason (e.g. Resigned, Transferred, Duplicate record…)"
                  rows={3}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-red-400/60 resize-none"
                />
                {deleteReason.length > 0 && deleteReason.length < 5 && (
                  <p className="text-red-400 text-xs">Minimum 5 characters required</p>
                )}
              </div>

              {/* Admin Password */}
              <div className="space-y-1.5">
                <label className="text-white/70 text-xs font-medium uppercase tracking-wide flex items-center gap-1.5">
                  <Lock className="w-3 h-3" /> Admin Password <span className="text-red-400">*</span>
                </label>
                <Input
                  type="password"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  placeholder="Enter your admin password to confirm"
                  className="bg-[#0A1628] border-white/20 text-white h-10 placeholder:text-white/30"
                  onKeyDown={e => {
                    if (e.key === "Enter" && deleteReason.length >= 5 && deletePassword) {
                      deleteMutation.mutate({ id: deleteTarget.id, reason: deleteReason, adminPassword: deletePassword });
                    }
                  }}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  onClick={() => deleteMutation.mutate({ id: deleteTarget.id, reason: deleteReason, adminPassword: deletePassword })}
                  disabled={isArchiveMode || deleteMutation.isPending || deleteReason.length < 5 || !deletePassword}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold"
                  data-testid="button-confirm-delete-teacher-registry">
                  {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
                  Remove Teacher
                </Button>
                <Button variant="outline" className="border-white/20 text-white hover:bg-white/10"
                  onClick={() => { setDeleteTarget(null); setDeleteReason(""); setDeletePassword(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
