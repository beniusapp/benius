import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UserPlus, Pencil, Trash2, Loader2, X, Save, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";
import { useForm, UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { NonTeachingStaff } from "@shared/schema";

interface Props { schoolId: number }

const DESIGNATIONS = ["Principal", "Vice Principal", "Admin", "Accountant", "Librarian", "Lab Assistant", "Peon", "Security", "Driver", "Clerk", "Counselor", "Other"];

const staffSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email required").or(z.literal("")).optional(),
  phone: z.string().optional(),
  designation: z.string().min(1, "Designation required"),
  customDesignation: z.string().optional(),
});
type StaffForm = z.infer<typeof staffSchema>;

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: `${45 + (i * 15) % 50}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function NonTeachingStaffModule({ schoolId }: Props) {
  const { toast } = useToast();
  const { isArchiveMode } = useSessionView();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<NonTeachingStaff | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NonTeachingStaff | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const { data: staff = [], isLoading } = useQuery<NonTeachingStaff[]>({
    queryKey: ["/api/admin/non-teaching-staff"],
    queryFn: async () => {
      const r = await fetch("/api/admin/non-teaching-staff", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const filtered = staff.filter(s =>
    s.fullName.toLowerCase().includes(searchQ.toLowerCase()) ||
    s.designation.toLowerCase().includes(searchQ.toLowerCase()) ||
    s.email?.toLowerCase().includes(searchQ.toLowerCase())
  );

  const addForm = useForm<StaffForm>({
    resolver: zodResolver(staffSchema),
    defaultValues: { fullName: "", email: "", phone: "", designation: "", customDesignation: "" },
  });

  const editForm = useForm<StaffForm>({
    resolver: zodResolver(staffSchema),
    defaultValues: { fullName: "", email: "", phone: "", designation: "", customDesignation: "" },
  });

  useEffect(() => {
    if (editTarget) {
      const isCustom = !DESIGNATIONS.includes(editTarget.designation);
      editForm.reset({
        fullName: editTarget.fullName,
        email: editTarget.email || "",
        phone: editTarget.phone || "",
        designation: isCustom ? "Other" : editTarget.designation,
        customDesignation: isCustom ? editTarget.designation : "",
      });
    }
  }, [editTarget]);

  const addMutation = useMutation({
    mutationFn: async (d: StaffForm) => {
      const designation = (d.designation === "Other" && d.customDesignation) ? d.customDesignation : d.designation;
      const r = await apiRequest("POST", "/api/admin/non-teaching-staff", {
        fullName: d.fullName, email: d.email || "", phone: d.phone || "", designation,
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Staff Added", description: "Non-teaching staff member registered." });
      addForm.reset(); setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/non-teaching-staff"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async (d: StaffForm) => {
      const designation = (d.designation === "Other" && d.customDesignation) ? d.customDesignation : d.designation;
      const r = await apiRequest("PATCH", `/api/admin/non-teaching-staff/${editTarget!.id}`, {
        fullName: d.fullName, email: d.email || "", phone: d.phone || "", designation,
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Staff Updated" });
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/non-teaching-staff"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/non-teaching-staff/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Staff Removed" });
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/non-teaching-staff"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const StaffFormFields = ({ form, isEdit }: { form: UseFormReturn<StaffForm>; isEdit?: boolean }) => {
    const isOther = form.watch("designation") === "Other";

    return (
      <div className="grid grid-cols-2 gap-3">
        <FormField control={form.control} name="fullName" render={({ field }) => (
          <FormItem className="col-span-2">
            <FormLabel className="text-white/70 text-xs">Full Name</FormLabel>
            <FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white h-10" data-testid={`input-nts-${isEdit ? "edit" : "add"}-fullname`} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-white/70 text-xs">Email <span className="text-white/30">(optional)</span></FormLabel>
            <FormControl><Input {...field} type="email" className="bg-[#0A1628] border-white/20 text-white h-10" data-testid={`input-nts-${isEdit ? "edit" : "add"}-email`} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="phone" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-white/70 text-xs">Phone <span className="text-white/30">(optional)</span></FormLabel>
            <FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white h-10" data-testid={`input-nts-${isEdit ? "edit" : "add"}-phone`} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="designation" render={({ field }) => (
          <FormItem className={isOther ? "" : "col-span-2"}>
            <FormLabel className="text-white/70 text-xs">Designation / Role</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-10" data-testid={`select-nts-${isEdit ? "edit" : "add"}-designation`}>
                <SelectValue placeholder="Select designation" />
              </SelectTrigger>
              <SelectContent>
                {DESIGNATIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        {isOther && (
          <FormField control={form.control} name="customDesignation" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-white/70 text-xs">Custom Designation</FormLabel>
              <FormControl><Input {...field} placeholder="e.g. Bus Driver, Nurse" className="bg-[#0A1628] border-white/20 text-white h-10" data-testid={`input-nts-${isEdit ? "edit" : "add"}-custom`} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Non-Teaching Staff Registry</h2>
          <p className="text-white/50 text-sm">{staff.length} staff member{staff.length !== 1 ? "s" : ""} registered</p>
        </div>
        <Button
          size="sm"
          className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
          onClick={() => setShowForm(!showForm)}
          disabled={isArchiveMode}
          data-testid="button-add-nts-toggle"
        >
          <UserPlus className="w-4 h-4 mr-1" /> Add Staff
        </Button>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Register Non-Teaching Staff</h3>
            <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white p-1"><X className="w-4 h-4" /></button>
          </div>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(d => addMutation.mutate(d))} className="space-y-3">
              <StaffFormFields form={addForm} />
              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={isArchiveMode || addMutation.isPending} className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid="button-submit-nts">
                  {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <UserPlus className="w-4 h-4 mr-1" />}
                  Register
                </Button>
                <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => { setShowForm(false); addForm.reset(); }}>Cancel</Button>
              </div>
            </form>
          </Form>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
        <Input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Search by name, designation, or email…"
          className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30 h-10"
          data-testid="input-search-nts"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="max-h-[480px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#D4AF37_#0A1628]">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="sticky top-0 z-10 bg-[#0F1E35]">
              <tr>
                {["Name","Email","Phone","Designation","Actions"].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide border-b border-white/10">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                : !filtered.length
                  ? (
                    <tr><td colSpan={5} className="py-12 text-center text-white/40">
                      {searchQ ? `No staff match "${searchQ}"` : "No non-teaching staff registered yet"}
                    </td></tr>
                  )
                  : filtered.map(s => (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`row-nts-${s.id}`}>
                      <td className="py-3 px-4 text-white font-medium">{s.fullName}</td>
                      <td className="py-3 px-4 text-white/70 text-xs">{s.email || "—"}</td>
                      <td className="py-3 px-4 text-white/70 text-xs">{s.phone || "—"}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-xs border border-green-500/20">{s.designation}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="text-[#D4AF37] hover:text-yellow-300 hover:bg-yellow-400/10 h-8 w-8"
                            onClick={() => setEditTarget(s)} disabled={isArchiveMode} data-testid={`button-edit-nts-${s.id}`} title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-8 w-8"
                            onClick={() => setDeleteTarget(s)} disabled={isArchiveMode} data-testid={`button-delete-nts-${s.id}`} title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
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

      {/* Edit Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-edit-nts"
          onClick={e => { if (e.target === e.currentTarget) setEditTarget(null); }}>
          <div className="w-full max-w-lg rounded-2xl bg-[#1A2942] border border-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Pencil className="w-4 h-4 text-[#D4AF37]" /> Edit Staff Member</h3>
              <button onClick={() => setEditTarget(null)} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors" data-testid="button-close-edit-nts">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(d => editMutation.mutate(d))} className="space-y-3">
                  <StaffFormFields form={editForm} isEdit />
                  <div className="flex gap-2 pt-2">
                    <Button type="submit" disabled={isArchiveMode || editMutation.isPending} className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold flex-1" data-testid="button-save-edit-nts">
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

      {/* Delete Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-delete-nts"
          onClick={e => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div className="w-full max-w-sm rounded-2xl bg-[#1A2942] border border-red-500/30 shadow-2xl p-6">
            <h3 className="text-white font-semibold mb-2">Remove Staff Member?</h3>
            <p className="text-white/60 text-sm mb-5">
              This will remove <span className="text-white font-medium">{deleteTarget.fullName}</span> ({deleteTarget.designation}) from the registry.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={isArchiveMode || deleteMutation.isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold" data-testid="button-confirm-delete-nts">
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
