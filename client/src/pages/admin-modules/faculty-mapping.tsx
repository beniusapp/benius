import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, UserPlus, Trash2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { X } from "lucide-react";
import type { Teacher } from "@shared/schema";

interface Props { schoolId: number; classes: string[]; sections: string[]; subjects: string[] }

const addTeacherSchema = z.object({
  fullName: z.string().min(2), email: z.string().email(), password: z.string().min(6),
  phone: z.string().min(7), subject: z.string().min(1), assignedClass: z.string().min(1), assignedSection: z.string().min(1),
});
type AddTeacherForm = z.infer<typeof addTeacherSchema>;

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {[...Array(6)].map((_, i) => (
        <td key={i} className="py-3 px-4"><div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: `${50 + Math.random() * 50}%` }} /></td>
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

  const handleSearch = useCallback((val: string) => {
    setQ(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => { setDebouncedQ(val); setPage(1); }, 400);
    setDebounceTimer(t);
  }, [debounceTimer]);

  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  params.set("page", String(page));

  const { data, isLoading } = useQuery<{ data: Teacher[]; total: number }>({
    queryKey: ["/api/schools", schoolId, "teachers", "paginated", debouncedQ, page],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/teachers/paginated?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!schoolId,
  });

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

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

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/teachers/${id}`); },
    onSuccess: () => {
      toast({ title: "Teacher Removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "teachers"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Faculty Mapping</h2>
          <p className="text-white/50 text-sm">{data?.total ?? "..."} teachers · Page {page} of {totalPages}</p>
        </div>
        <Button size="sm" className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
          onClick={() => setShowForm(!showForm)} data-testid="button-add-teacher-toggle">
          <UserPlus className="w-4 h-4 mr-1" /> Add Teacher
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">New Teacher</h3>
            <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => addMutation.mutate(d))} className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {["fullName", "email", "password", "phone"].map(name => (
                <FormField key={name} control={form.control} name={name as any} render={({ field }) => (
                  <FormItem><FormLabel className="text-white/70 capitalize">{name === "fullName" ? "Full Name" : name.charAt(0).toUpperCase() + name.slice(1)}</FormLabel>
                    <FormControl><Input {...field} type={name === "password" ? "password" : "text"} className="bg-[#0A1628] border-white/20 text-white" data-testid={`input-teacher-${name}`} /></FormControl>
                    <FormMessage /></FormItem>
                )} />
              ))}
              <FormField control={form.control} name="subject" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Subject</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-teacher-subject">
                      <SelectValue placeholder="Subject" />
                    </SelectTrigger>
                    <SelectContent>{(subjects.length > 0 ? subjects : ["Math","Science","English","Hindi","Social"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="assignedClass" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Assigned Class</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-teacher-class">
                      <SelectValue placeholder="Class" />
                    </SelectTrigger>
                    <SelectContent>{(classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="assignedSection" render={({ field }) => (
                <FormItem><FormLabel className="text-white/70">Section</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-teacher-section">
                      <SelectValue placeholder="Section" />
                    </SelectTrigger>
                    <SelectContent>{(sections.length > 0 ? sections : ["A","B","C","D"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <div className="flex items-end col-span-2 md:col-span-3">
                <Button type="submit" disabled={addMutation.isPending} className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid="button-submit-teacher">
                  {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Teacher"}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
        <Input value={q} onChange={e => handleSearch(e.target.value)}
          placeholder="Search by name, email, or subject..."
          className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30"
          data-testid="input-search-teachers" />
      </div>

      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#0F1E35]">
            <tr>
              {["Name", "Email", "Subject", "Class", "Section", ""].map(h => (
                <th key={h} className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? [...Array(8)].map((_, i) => <SkeletonRow key={i} />) :
              data?.data.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-white/40">No teachers found</td></tr>
              ) : data?.data.map(t => (
                <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`row-teacher-${t.id}`}>
                  <td className="py-3 px-4 text-white font-medium">{t.fullName}</td>
                  <td className="py-3 px-4 text-white/70 text-xs">{t.email}</td>
                  <td className="py-3 px-4 text-[#D4AF37] text-xs">{t.subject}</td>
                  <td className="py-3 px-4 text-white/70">{t.assignedClass}</td>
                  <td className="py-3 px-4 text-white/70">{t.assignedSection}</td>
                  <td className="py-3 px-4">
                    <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-7 w-7"
                      onClick={() => { if (confirm("Remove this teacher?")) deleteMutation.mutate(t.id); }}
                      data-testid={`button-delete-teacher-${t.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-white/40 text-sm">{((page - 1) * 50) + 1}–{Math.min(page * 50, data?.total ?? 0)} of {data?.total ?? 0}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="border-white/20 text-white hover:bg-white/10" data-testid="button-faculty-prev">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="px-3 py-1.5 rounded bg-[#1A2942] text-white text-sm">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="border-white/20 text-white hover:bg-white/10" data-testid="button-faculty-next">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
