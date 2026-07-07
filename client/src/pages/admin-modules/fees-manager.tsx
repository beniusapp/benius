import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CreditCard, Plus, Search, Loader2, Trash2, Pencil, CheckCircle2, AlertTriangle, Clock, X, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";

interface StudentItem {
  id: number;
  name: string;
  class: string;
  section: string;
  digitalStudentId: string;
  isActive: boolean;
}

interface FeeRecordWithStudent {
  id: number;
  studentId: number;
  schoolId: number;
  feeType: string;
  amount: number;
  dueDate: string;
  paidDate: string | null;
  status: string;
  receiptNumber: string | null;
  notes: string | null;
  academicYear: string | null;
  createdAt: string;
  student: { name: string; class: string; section: string; digitalStudentId: string } | null;
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusChip({ status }: { status: string }) {
  if (status === "Paid") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>
      <CheckCircle2 className="w-3 h-3" /> Paid
    </span>
  );
  if (status === "Overdue") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
      <AlertTriangle className="w-3 h-3" /> Overdue
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a" }}>
      <Clock className="w-3 h-3" /> Due
    </span>
  );
}

const feeFormSchema = z.object({
  studentId: z.string().min(1, "Select a student"),
  feeType: z.string().min(1, "Fee type is required"),
  amount: z.string().min(1, "Amount is required").refine(v => !isNaN(Number(v)) && Number(v) > 0, "Must be positive"),
  dueDate: z.string().min(1, "Due date is required"),
  status: z.enum(["Due", "Paid", "Overdue"]),
  paidDate: z.string().optional(),
  receiptNumber: z.string().optional(),
  notes: z.string().optional(),
  academicYear: z.string().optional(),
});
type FeeFormValues = z.infer<typeof feeFormSchema>;

export default function FeesManager({ schoolId, allowedSubs }: { schoolId: number; allowedSubs?: string[] }) {
  const canRecord = allowedSubs === undefined || allowedSubs.includes("record");
  const canExport  = allowedSubs === undefined || allowedSubs.includes("export");
  const { toast } = useToast();
  const { isArchiveMode } = useSessionView();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FeeRecordWithStudent | null>(null);

  const { data: students = [] } = useQuery<StudentItem[]>({
    queryKey: ["/api/schools", schoolId, "students"],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/students`, { credentials: "include" });
      if (!r.ok) return [];
      const json = await r.json();
      return Array.isArray(json) ? json : [];
    },
  });

  const { data: feeRecords = [], isLoading } = useQuery<FeeRecordWithStudent[]>({
    queryKey: ["/api/admin/fees"],
  });

  const form = useForm<FeeFormValues>({
    resolver: zodResolver(feeFormSchema),
    defaultValues: {
      studentId: "",
      feeType: "",
      amount: "",
      dueDate: "",
      status: "Due",
      paidDate: "",
      receiptNumber: "",
      notes: "",
      academicYear: "",
    },
  });

  const watchStatus = form.watch("status");

  const createMutation = useMutation({
    mutationFn: async (data: FeeFormValues) => {
      return await apiRequest("POST", "/api/admin/fees", {
        studentId: Number(data.studentId),
        feeType: data.feeType,
        amount: Number(data.amount),
        dueDate: data.dueDate,
        status: data.status,
        paidDate: data.paidDate || null,
        receiptNumber: data.receiptNumber || null,
        notes: data.notes || null,
        academicYear: data.academicYear || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      toast({ title: "Fee record created" });
      setShowForm(false);
      form.reset();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FeeFormValues }) => {
      return await apiRequest("PATCH", `/api/admin/fees/${id}`, {
        studentId: Number(data.studentId),
        feeType: data.feeType,
        amount: Number(data.amount),
        dueDate: data.dueDate,
        status: data.status,
        paidDate: data.paidDate || null,
        receiptNumber: data.receiptNumber || null,
        notes: data.notes || null,
        academicYear: data.academicYear || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      toast({ title: "Fee record updated" });
      setEditing(null);
      setShowForm(false);
      form.reset();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => await apiRequest("DELETE", `/api/admin/fees/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      toast({ title: "Fee record deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ studentId: "", feeType: "", amount: "", dueDate: "", status: "Due", paidDate: "", receiptNumber: "", notes: "", academicYear: "" });
    setShowForm(true);
  };

  const openEdit = (rec: FeeRecordWithStudent) => {
    setEditing(rec);
    form.reset({
      studentId: String(rec.studentId),
      feeType: rec.feeType,
      amount: String(rec.amount),
      dueDate: rec.dueDate,
      status: rec.status as "Due" | "Paid" | "Overdue",
      paidDate: rec.paidDate ?? "",
      receiptNumber: rec.receiptNumber ?? "",
      notes: rec.notes ?? "",
      academicYear: rec.academicYear ?? "",
    });
    setShowForm(true);
  };

  const onSubmit = (data: FeeFormValues) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const filtered = feeRecords.filter(rec => {
    const matchStatus = statusFilter === "all" || rec.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || rec.feeType.toLowerCase().includes(q) || rec.student?.name.toLowerCase().includes(q) || rec.student?.digitalStudentId.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const totalDue = feeRecords.filter(r => r.status !== "Paid").reduce((s, r) => s + r.amount, 0);
  const totalPaid = feeRecords.filter(r => r.status === "Paid").reduce((s, r) => s + r.amount, 0);
  const overdueCount = feeRecords.filter(r => r.status === "Overdue").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl" style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}>
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Fees & Payments</h1>
            <p className="text-xs text-slate-400">Manage student fee records and payment history</p>
          </div>
        </div>
        {canRecord && (
          <Button onClick={openCreate} disabled={isArchiveMode} className="flex items-center gap-2 text-sm" data-testid="button-add-fee">
            <Plus className="w-4 h-4" /> Add Fee Record
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-4 text-center" style={{ background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ef4444" }}>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Outstanding</p>
          <p className="text-lg font-extrabold text-red-500">{formatAmount(totalDue)}</p>
          {overdueCount > 0 && <p className="text-[10px] text-red-400">{overdueCount} overdue</p>}
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #10b981" }}>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Collected</p>
          <p className="text-lg font-extrabold text-emerald-500">{formatAmount(totalPaid)}</p>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #06b6d4" }}>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Total Records</p>
          <p className="text-lg font-extrabold text-cyan-500">{feeRecords.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search by student name, ID, or fee type…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-fee-search"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="Due">Due</SelectItem>
            <SelectItem value="Overdue">Overdue</SelectItem>
            <SelectItem value="Paid">Paid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Records list */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl p-10 flex flex-col items-center gap-3 text-center" style={{ background: "#fff", border: "1px solid #e2e8f0" }} data-testid="section-no-records">
          <div className="text-4xl">💳</div>
          <p className="font-bold text-slate-700">No fee records found</p>
          <p className="text-sm text-slate-400">{feeRecords.length === 0 ? "Click 'Add Fee Record' to create the first record." : "Try changing the search or filter."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(rec => (
            <div
              key={rec.id}
              className="rounded-xl p-4 flex items-center gap-4 flex-wrap"
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderLeft: `4px solid ${rec.status === "Paid" ? "#10b981" : rec.status === "Overdue" ? "#ef4444" : "#f59e0b"}`,
              }}
              data-testid={`row-fee-${rec.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <StatusChip status={rec.status} />
                  {rec.academicYear && <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">{rec.academicYear}</span>}
                </div>
                <p className="font-bold text-slate-800 text-sm" data-testid={`text-admin-fee-type-${rec.id}`}>{rec.feeType}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="font-medium text-slate-700">{rec.student?.name ?? "Unknown"}</span>
                  {rec.student && <span className="text-slate-400"> · {rec.student.class}-{rec.student.section} · {rec.student.digitalStudentId}</span>}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Due: {formatDate(rec.dueDate)}
                  {rec.paidDate && <span> · Paid: {formatDate(rec.paidDate)}</span>}
                  {rec.receiptNumber && <span className="text-emerald-600 font-semibold"> · #{rec.receiptNumber}</span>}
                </p>
                {rec.notes && <p className="text-xs text-slate-400 italic mt-0.5">{rec.notes}</p>}
              </div>
              <div className="flex items-center gap-3">
                <p className="text-base font-extrabold text-slate-800" data-testid={`text-admin-fee-amount-${rec.id}`}>{formatAmount(rec.amount)}</p>
                {canRecord && (
                  <button
                    onClick={() => openEdit(rec)}
                    className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                    data-testid={`button-edit-fee-${rec.id}`}
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4 text-slate-500" />
                  </button>
                )}
                {canRecord && (
                  <button
                    onClick={() => {
                      if (confirm("Delete this fee record?")) deleteMutation.mutate(rec.id);
                    }}
                    className="p-2 rounded-lg hover:bg-red-50 transition-colors"
                    data-testid={`button-delete-fee-${rec.id}`}
                    title="Delete"
                    disabled={isArchiveMode || deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); setEditing(null); form.reset(); } }}>
        <DialogContent className="max-w-lg" data-testid="dialog-fee-form">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Fee Record" : "Add Fee Record"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="studentId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Student</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-fee-student">
                        <SelectValue placeholder="Select student" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {students.map(s => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name} · {s.class}-{s.section} · {s.digitalStudentId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="feeType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fee Type</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Tuition, Transport" {...field} data-testid="input-fee-type" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (₹)</FormLabel>
                    <FormControl>
                      <Input type="number" min="1" placeholder="5000" {...field} data-testid="input-fee-amount" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="dueDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-fee-due-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-fee-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Due">Due</SelectItem>
                        <SelectItem value="Overdue">Overdue</SelectItem>
                        <SelectItem value="Paid">Paid</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {watchStatus === "Paid" && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="paidDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Paid Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-fee-paid-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="receiptNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Receipt No.</FormLabel>
                      <FormControl>
                        <Input placeholder="REC-001" {...field} data-testid="input-receipt-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="academicYear" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Academic Year</FormLabel>
                    <FormControl>
                      <Input placeholder="2025-26" {...field} data-testid="input-academic-year" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Any remarks" {...field} data-testid="input-fee-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex gap-3 justify-end pt-1">
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); form.reset(); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isArchiveMode || createMutation.isPending || updateMutation.isPending} data-testid="button-submit-fee">
                  {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {editing ? "Save Changes" : "Create Record"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
