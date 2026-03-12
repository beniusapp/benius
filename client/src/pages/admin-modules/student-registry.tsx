import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, ChevronLeft, ChevronRight, UserPlus, Upload, X, Loader2, Users } from "lucide-react";
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

interface Props { schoolId: number; classes: string[]; sections: string[] }

const addSchema = z.object({
  name: z.string().min(1), class: z.string().min(1), section: z.string().min(1),
  phone: z.string().min(7), dob: z.string().min(1),
});
type AddForm = z.infer<typeof addSchema>;

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {[...Array(5)].map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: `${60 + Math.random() * 40}%` }} />
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
  const [showForm, setShowForm] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

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

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  const form = useForm<AddForm>({ resolver: zodResolver(addSchema), defaultValues: { name: "", class: "", section: "", phone: "", dob: "" } });

  const addMutation = useMutation({
    mutationFn: async (d: AddForm) => {
      const r = await apiRequest("POST", `/api/schools/${schoolId}/students`, d);
      return r.json();
    },
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Student Registry</h2>
          <p className="text-white/50 text-sm">{data?.total ?? "..."} students enrolled · Page {page} of {totalPages}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10"
            onClick={() => { uploadRef.current?.click(); }} data-testid="button-upload-csv" disabled={uploadMutation.isPending}>
            <Upload className="w-4 h-4 mr-1" /> {uploadMutation.isPending ? "Uploading..." : "Bulk CSV"}
          </Button>
          <input ref={el => uploadRef.current = el} type="file" accept=".csv,.xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); }} />
          <Button size="sm" className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
            onClick={() => setShowForm(!showForm)} data-testid="button-add-student-toggle">
            <UserPlus className="w-4 h-4 mr-1" /> Add Student
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">New Student</h3>
            <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
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
                    <SelectContent>{(classes.length > 0 ? classes : ["LKG","UKG","1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="section" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Section</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-student-section">
                      <SelectValue placeholder="Section" />
                    </SelectTrigger>
                    <SelectContent>{(sections.length > 0 ? sections : ["A","B","C","D","E"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
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

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <Input value={q} onChange={e => handleSearch(e.target.value)}
            placeholder="Search name or DSID..."
            className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30"
            data-testid="input-search-students" />
        </div>
        <Select value={cls} onValueChange={v => { setCls(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-32 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-class">
            <SelectValue placeholder="All Classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {(classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={section} onValueChange={v => { setSection(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-32 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-section">
            <SelectValue placeholder="All Sections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sections</SelectItem>
            {(sections.length > 0 ? sections : ["A","B","C","D","E"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#0F1E35]">
            <tr>
              {["DSID", "Name", "Class", "Section", "Phone"].map(h => (
                <th key={h} className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? [...Array(8)].map((_, i) => <SkeletonRow key={i} />) :
              data?.data.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-white/40">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />No students found
                </td></tr>
              ) : data?.data.map(s => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`row-student-${s.id}`}>
                  <td className="py-3 px-4 font-mono text-[#D4AF37] text-xs">{s.digitalStudentId}</td>
                  <td className="py-3 px-4 text-white font-medium">{s.name}</td>
                  <td className="py-3 px-4 text-white/70">{s.class}</td>
                  <td className="py-3 px-4 text-white/70">{s.section}</td>
                  <td className="py-3 px-4 text-white/70">{s.phone}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-white/40 text-sm">Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, data?.total ?? 0)} of {data?.total ?? 0}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="border-white/20 text-white hover:bg-white/10" data-testid="button-prev-page">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="px-3 py-1.5 rounded bg-[#1A2942] text-white text-sm">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="border-white/20 text-white hover:bg-white/10" data-testid="button-next-page">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
