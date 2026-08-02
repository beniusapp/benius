import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CreditCard, Plus, Search, Loader2, Trash2, Pencil, CheckCircle2, AlertTriangle, Clock,
  Receipt, DollarSign, TrendingUp, TrendingDown, Banknote, BookOpen, Bell, ExternalLink,
  Shield, ChevronLeft, ChevronRight, Lock, X, Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, sessionFetch, queryClient } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface FeeStructure {
  id: number;
  schoolId: number;
  name: string;
  feeType: string;
  amount: number;
  frequency: string;
  applicableClasses: string[];
  concessionType: string;
  concessionPercent: number;
  dueDayOfMonth: number | null;
  isActive: boolean;
  createdAt: string;
}

interface AuditLogEntry {
  id: number;
  schoolId: number;
  actorId: number | null;
  actorName: string | null;
  ipAddress: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  description: string | null;
  createdAt: string;
}

interface ExternalSettings {
  isEnabled: boolean;
  gatewayUrl: string | null;
  bannerMessage: string | null;
}

interface AcademicSession {
  id: number;
  sessionName: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
}

interface FeeSummary {
  totalRevenue: number;
  outstanding: number;
  collectionRate: number;
  offlinePaymentsCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusChip({ status }: { status: string }) {
  const variants: Record<string, { cls: string; icon: React.ReactNode }> = {
    Paid:    { cls: "bg-emerald-900/40 text-emerald-400 border-emerald-700/40", icon: <CheckCircle2 className="w-3 h-3" /> },
    Overdue: { cls: "bg-red-900/40 text-red-400 border-red-700/40",           icon: <AlertTriangle className="w-3 h-3" /> },
    Partial: { cls: "bg-blue-900/40 text-blue-400 border-blue-700/40",        icon: <Clock className="w-3 h-3" /> },
    Waived:  { cls: "bg-purple-900/40 text-purple-400 border-purple-700/40",  icon: <Shield className="w-3 h-3" /> },
    Due:     { cls: "bg-amber-900/40 text-amber-400 border-amber-700/40",     icon: <Clock className="w-3 h-3" /> },
  };
  const v = variants[status] ?? variants.Due;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${v.cls}`}>
      {v.icon} {status}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    create:          "bg-emerald-900/40 text-emerald-400 border-emerald-700/40",
    update:          "bg-blue-900/40 text-blue-400 border-blue-700/40",
    delete:          "bg-red-900/40 text-red-400 border-red-700/40",
    payment:         "bg-cyan-900/40 text-cyan-400 border-cyan-700/40",
    settings_change: "bg-purple-900/40 text-purple-400 border-purple-700/40",
    waiver:          "bg-amber-900/40 text-amber-400 border-amber-700/40",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border ${map[action] ?? "bg-white/10 text-white/60 border-white/10"}`}>
      {action}
    </span>
  );
}

// ─── MetricBar ────────────────────────────────────────────────────────────────

function MetricBar({ viewSessionId }: { viewSessionId: number | null }) {
  const { data, isLoading } = useQuery<FeeSummary>({
    queryKey: ["/api/admin/fees/summary", viewSessionId],
    staleTime: 30_000,
  });

  const cards = [
    { label: "Total Revenue",     value: isLoading ? "…" : fmt(data?.totalRevenue ?? 0),            Icon: DollarSign,    ib: "border-[#D4AF37]/30 bg-[#D4AF37]/5",  ic: "text-[#D4AF37]" },
    { label: "Outstanding",       value: isLoading ? "…" : fmt(data?.outstanding ?? 0),             Icon: TrendingDown,  ib: "border-red-500/30 bg-red-500/5",       ic: "text-red-400"   },
    { label: "Collection Rate",   value: isLoading ? "…" : `${data?.collectionRate ?? 0}%`,         Icon: TrendingUp,    ib: "border-emerald-500/30 bg-emerald-500/5",ic: "text-emerald-400"},
    { label: "Offline Payments",  value: isLoading ? "…" : String(data?.offlinePaymentsCount ?? 0), Icon: Banknote,      ib: "border-cyan-500/30 bg-cyan-500/5",     ic: "text-cyan-400"  },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(({ label, value, Icon, ib, ic }) => (
        <div key={label} className={`rounded-xl border ${ib} p-4 flex items-center gap-3`}>
          <div className={`p-2 rounded-lg bg-white/5 ${ic}`}><Icon className="w-5 h-5" /></div>
          <div>
            <p className="text-white/50 text-xs mb-0.5">{label}</p>
            <p className="text-white font-bold text-lg leading-none">{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────

interface RecordPaymentModalProps {
  open: boolean;
  onClose: () => void;
  feeRecord: FeeRecordWithStudent | null;
  students: StudentItem[];
  onSuccess?: () => void;
}

function RecordPaymentModal({ open, onClose, feeRecord, students, onSuccess }: RecordPaymentModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"form" | "confirm" | "done">("form");
  const [lastPaymentId, setLastPaymentId] = useState<number | null>(null);
  const [pendingPayload, setPendingPayload] = useState<any>(null);
  const [adminPwd, setAdminPwd] = useState("");
  const [pwdError, setPwdError] = useState("");

  const [method, setMethod] = useState("Cash");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [sid, setSid] = useState("");
  // Idempotency key is generated once per modal open and reused across retries
  const [idempotencyKey, setIdempotencyKey] = useState("");

  // Sync amount + student when feeRecord changes; generate a fresh idempotency key
  useEffect(() => {
    if (feeRecord) {
      setAmount(String(feeRecord.amount));
      setSid(String(feeRecord.studentId));
    } else {
      setAmount("");
      setSid("");
    }
    setStep("form");
    setLastPaymentId(null);
    setPendingPayload(null);
    setAdminPwd("");
    setPwdError("");
    setMethod("Cash");
    setRef("");
    setDate(new Date().toISOString().split("T")[0]);
    setNotes("");
    // Fresh key per modal open — stable across retries within the same open session
    setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }, [feeRecord?.id, open]);

  const mut = useMutation({
    mutationFn: async (payload: any) => {
      // Use sessionFetch so x-view-session-id is always injected (archive write guard)
      const r = await sessionFetch("/api/admin/fees/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json();
      if (!r.ok) {
        const err: any = new Error(body.message ?? "Failed");
        err.requiresConfirm = body.requiresConfirm;
        err.payload = payload;
        throw err;
      }
      return body;
    },
    onSuccess: (rec: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      onSuccess?.();
      setLastPaymentId(rec?.id ?? null);
      setStep("done");
    },
    onError: (e: any) => {
      if (e.requiresConfirm) {
        setPendingPayload(e.payload);
        setStep("confirm");
      } else {
        toast({ title: "Error", description: e.message, variant: "destructive" });
      }
    },
  });

  function submit() {
    mut.mutate({
      feeRecordId: feeRecord?.id ?? null,
      studentId: feeRecord?.studentId ?? parseInt(sid),
      paymentMethod: method,
      referenceNumber: ref || null,
      receivedDate: date,
      amount: parseInt(amount),
      cashierNotes: notes || null,
      idempotencyKey: idempotencyKey || null,
    });
  }

  function submitConfirm() {
    setPwdError("");
    mut.mutate({ ...pendingPayload, adminPassword: adminPwd });
  }

  const amtNum = parseInt(amount) || 0;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-cyan-400">
            <Receipt className="w-5 h-5" />
            {step === "confirm" ? "Confirm High-Value Payment" : "Record Offline Payment"}
          </DialogTitle>
        </DialogHeader>

        {step === "form" && (
          <div className="space-y-4">
            {feeRecord ? (
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm">
                <p className="text-white font-semibold">{feeRecord.student?.name}</p>
                <p className="text-white/50 text-xs">{feeRecord.feeType} · {feeRecord.student?.class}-{feeRecord.student?.section}</p>
                <p className="text-white/40 text-xs">Invoice: {fmt(feeRecord.amount)}</p>
              </div>
            ) : (
              <div>
                <label className="text-xs text-white/60 mb-1 block">Student</label>
                <select value={sid} onChange={e => setSid(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                  <option value="">Select student…</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.class}-{s.section})</option>)}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/60 mb-1 block">Method</label>
                <select value={method} onChange={e => setMethod(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                  {["Cash","Cheque","BankTransfer","DemandDraft","Online"].map(m =>
                    <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-white/60 mb-1 block">Amount (₹)</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min={1}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
              </div>
            </div>

            {method !== "Cash" && (
              <div>
                <label className="text-xs text-white/60 mb-1 block">Reference Number</label>
                <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Cheque / UTR / DD no."
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
              </div>
            )}

            <div>
              <label className="text-xs text-white/60 mb-1 block">Received Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
            </div>

            <div>
              <label className="text-xs text-white/60 mb-1 block">Cashier Notes (optional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 resize-none placeholder:text-white/20" />
            </div>

            {amtNum >= 10000 && (
              <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-700/40 text-xs text-amber-400">
                ⚠️ Payments ≥ ₹10,000 require admin password confirmation in the next step.
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={onClose} className="text-white/60">Cancel</Button>
              <Button onClick={submit}
                disabled={mut.isPending || !amount || !date || (!feeRecord && !sid)}
                className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1">
                {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                Record Payment
              </Button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-700/40">
              <p className="text-amber-400 text-sm font-semibold">High-Value Transaction</p>
              <p className="text-white/60 text-xs mt-1">Re-authentication required for {fmt(amtNum)} payment.</p>
            </div>
            <div>
              <label className="text-xs text-white/60 mb-1 flex items-center gap-1 block"><Lock className="w-3 h-3" /> Admin Password</label>
              <input type="password" value={adminPwd} onChange={e => { setAdminPwd(e.target.value); setPwdError(""); }} autoFocus
                className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
              {pwdError && <p className="text-red-400 text-xs mt-1">{pwdError}</p>}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setStep("form")} className="text-white/60">Back</Button>
              <Button onClick={submitConfirm} disabled={!adminPwd || mut.isPending}
                className="bg-amber-600 hover:bg-amber-500 text-white gap-1">
                {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Confirm
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-900/20 border border-emerald-700/40 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
              <p className="text-emerald-400 font-semibold text-lg">Payment Recorded</p>
              <p className="text-white/60 text-sm mt-1">The payment has been logged successfully.</p>
            </div>
            {lastPaymentId && (
              <Button
                className="w-full bg-white/10 hover:bg-white/20 text-white gap-2"
                onClick={() => window.open(`/api/admin/fees/payments/${lastPaymentId}/receipt`, "_blank")}
              >
                <Printer className="w-4 h-4" /> Print Receipt
              </Button>
            )}
            <Button className="w-full bg-cyan-600 hover:bg-cyan-500 text-white" onClick={onClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Fee Form Schema ──────────────────────────────────────────────────────────

const feeFormSchema = z.object({
  studentId: z.string().min(1, "Select a student"),
  feeType: z.string().min(1, "Fee type is required"),
  amount: z.string().min(1).refine(v => !isNaN(Number(v)) && Number(v) > 0, "Must be positive"),
  dueDate: z.string().min(1, "Due date is required"),
  status: z.enum(["Due", "Paid", "Overdue", "Partial", "Waived"]),
  paidDate: z.string().optional(),
  receiptNumber: z.string().optional(),
  notes: z.string().optional(),
  academicYear: z.string().optional(),
});
type FeeFormValues = z.infer<typeof feeFormSchema>;

// ─── Ledger Tab ───────────────────────────────────────────────────────────────

function LedgerTab({ canRecord, isArchiveMode, students, viewSessionId }: {
  canRecord: boolean; isArchiveMode: boolean; students: StudentItem[]; viewSessionId: number | null;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FeeRecordWithStudent | null>(null);
  const [payTarget, setPayTarget] = useState<FeeRecordWithStudent | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showStandalonePay, setShowStandalonePay] = useState(false);

  const { data: feeRecords = [], isLoading } = useQuery<FeeRecordWithStudent[]>({
    queryKey: ["/api/admin/fees", viewSessionId],
  });

  const form = useForm<FeeFormValues>({
    resolver: zodResolver(feeFormSchema),
    defaultValues: { studentId: "", feeType: "", amount: "", dueDate: "", status: "Due", paidDate: "", receiptNumber: "", notes: "", academicYear: "" },
  });
  const watchStatus = form.watch("status");

  const createMut = useMutation({
    mutationFn: (data: FeeFormValues) => apiRequest("POST", "/api/admin/fees", {
      studentId: Number(data.studentId), feeType: data.feeType, amount: Number(data.amount),
      dueDate: data.dueDate, status: data.status, paidDate: data.paidDate || null,
      receiptNumber: data.receiptNumber || null, notes: data.notes || null, academicYear: data.academicYear || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      toast({ title: "Fee record created" });
      setShowForm(false); form.reset();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: FeeFormValues }) => apiRequest("PATCH", `/api/admin/fees/${id}`, {
      studentId: Number(data.studentId), feeType: data.feeType, amount: Number(data.amount),
      dueDate: data.dueDate, status: data.status, paidDate: data.paidDate || null,
      receiptNumber: data.receiptNumber || null, notes: data.notes || null, academicYear: data.academicYear || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      toast({ title: "Fee record updated" });
      setEditing(null); setShowForm(false); form.reset();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/fees/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      toast({ title: "Fee record deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const classes = useMemo(() =>
    [...new Set(feeRecords.map(r => r.student?.class).filter(Boolean))].sort() as string[],
    [feeRecords]);

  const filtered = useMemo(() => feeRecords.filter(r => {
    const q = search.toLowerCase();
    const ms = !q || (r.student?.name ?? "").toLowerCase().includes(q) || r.feeType.toLowerCase().includes(q) || (r.student?.digitalStudentId ?? "").toLowerCase().includes(q);
    return ms && (statusFilter === "all" || r.status === statusFilter) && (classFilter === "all" || r.student?.class === classFilter);
  }), [feeRecords, search, statusFilter, classFilter]);

  function openCreate() {
    setEditing(null);
    form.reset({ studentId: "", feeType: "", amount: "", dueDate: "", status: "Due", paidDate: "", receiptNumber: "", notes: "", academicYear: "" });
    setShowForm(true);
  }

  function openEdit(rec: FeeRecordWithStudent) {
    setEditing(rec);
    form.reset({ studentId: String(rec.studentId), feeType: rec.feeType, amount: String(rec.amount), dueDate: rec.dueDate, status: rec.status as any, paidDate: rec.paidDate ?? "", receiptNumber: rec.receiptNumber ?? "", notes: rec.notes ?? "", academicYear: rec.academicYear ?? "" });
    setShowForm(true);
  }

  function openRecordPayment(rec: FeeRecordWithStudent) {
    setPayTarget(rec);
    setShowPay(true);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, ID or fee type…"
            className="w-full bg-[#1A2942] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 min-w-28">
          <option value="all">All Status</option>
          {["Due","Paid","Overdue","Partial","Waived"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
          className="bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 min-w-28">
          <option value="all">All Classes</option>
          {classes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {canRecord && !isArchiveMode && (
          <div className="flex gap-2 ml-auto">
            <Button size="sm" variant="outline" onClick={() => setShowStandalonePay(true)}
              className="border-cyan-700 text-cyan-400 hover:bg-cyan-900/30 gap-1">
              <Banknote className="w-4 h-4" /> Record Payment
            </Button>
            <Button size="sm" onClick={openCreate} className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1">
              <Plus className="w-4 h-4" /> Add Fee
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-white/40">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading records…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <Receipt className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No fee records match your filters.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  {["Student","Fee Type","Amount","Due Date","Status","Paid On","Actions"].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-white/50 font-medium ${i === 2 ? "text-right" : i >= 6 ? "text-right" : i >= 3 ? "text-center" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(rec => (
                  <tr key={rec.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-white font-medium leading-tight">{rec.student?.name ?? "—"}</p>
                      <p className="text-white/40 text-xs">{rec.student?.digitalStudentId} · {rec.student?.class}-{rec.student?.section}</p>
                    </td>
                    <td className="px-4 py-3 text-white/70">{rec.feeType}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">{fmt(rec.amount)}</td>
                    <td className="px-4 py-3 text-center text-white/50 text-xs">{fmtDate(rec.dueDate)}</td>
                    <td className="px-4 py-3 text-center"><StatusChip status={rec.status} /></td>
                    <td className="px-4 py-3 text-center text-white/50 text-xs">{fmtDate(rec.paidDate)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canRecord && !isArchiveMode && rec.status !== "Paid" && rec.status !== "Waived" && (
                          <Button size="sm" variant="ghost" onClick={() => openRecordPayment(rec)}
                            className="h-7 px-2 text-xs text-cyan-400 hover:bg-cyan-900/30 gap-1">
                            <Receipt className="w-3 h-3" /> Pay
                          </Button>
                        )}
                        {rec.receiptNumber && (() => {
                          const m = rec.receiptNumber.match(/^REC-(\d+)$/);
                          return m ? (
                            <Button size="icon" variant="ghost"
                              onClick={() => window.open(`/api/admin/fees/payments/${m[1]}/receipt`, "_blank")}
                              className="h-7 w-7 text-white/40 hover:text-cyan-400"
                              title="Print receipt">
                              <Printer className="w-3.5 h-3.5" />
                            </Button>
                          ) : null;
                        })()}
                        {canRecord && !isArchiveMode && (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => openEdit(rec)} className="h-7 w-7 text-white/40 hover:text-white">
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(rec.id)} className="h-7 w-7 text-white/40 hover:text-red-400">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-white/30 text-xs">{filtered.length} of {feeRecords.length} records</p>

      {/* Payment modals */}
      <RecordPaymentModal open={showPay} onClose={() => { setShowPay(false); setPayTarget(null); }} feeRecord={payTarget} students={students} />
      <RecordPaymentModal open={showStandalonePay} onClose={() => setShowStandalonePay(false)} feeRecord={null} students={students} />

      {/* Add / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); setEditing(null); } }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-cyan-400">{editing ? "Edit Fee Record" : "Add Fee Record"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => editing ? updateMut.mutate({ id: editing.id, data: d }) : createMut.mutate(d))} className="space-y-4">
              <FormField control={form.control} name="studentId" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Student</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-[#0A1628] border-white/20 text-white">
                        <SelectValue placeholder="Select student" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-[#1A2942] border-white/10 max-h-56">
                      {students.filter(s => s.isActive).map(s => (
                        <SelectItem key={s.id} value={String(s.id)} className="text-white focus:bg-white/10">
                          {s.name} ({s.class}-{s.section})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage className="text-red-400" />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="feeType" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Fee Type</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Tuition, Transport…" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" />
                    </FormControl>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Amount (₹)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min={1} placeholder="0" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" />
                    </FormControl>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="dueDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Due Date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white" />
                    </FormControl>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-[#0A1628] border-white/20 text-white"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-[#1A2942] border-white/10">
                        {["Due","Paid","Overdue","Partial","Waived"].map(s => (
                          <SelectItem key={s} value={s} className="text-white focus:bg-white/10">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )} />
              </div>
              {(watchStatus === "Paid" || watchStatus === "Partial") && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="paidDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70">Paid Date</FormLabel>
                      <FormControl><Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="receiptNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70">Receipt No.</FormLabel>
                      <FormControl><Input {...field} placeholder="REC-001" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" /></FormControl>
                    </FormItem>
                  )} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="academicYear" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Academic Year</FormLabel>
                    <FormControl><Input {...field} placeholder="2024-25" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Notes</FormLabel>
                    <FormControl><Input {...field} placeholder="Optional" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" /></FormControl>
                  </FormItem>
                )} />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="ghost" onClick={() => { setShowForm(false); setEditing(null); }} className="text-white/60">Cancel</Button>
                <Button type="submit" disabled={createMut.isPending || updateMut.isPending} className="bg-cyan-600 hover:bg-cyan-500 text-white">
                  {(createMut.isPending || updateMut.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
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

// ─── Structures Tab ───────────────────────────────────────────────────────────

function StructuresTab({ isArchiveMode }: { isArchiveMode: boolean }) {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<FeeStructure | null>(null);
  const [delId, setDelId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [feeType, setFeeType] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("annual");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [concType, setConcType] = useState("none");
  const [concPct, setConcPct] = useState("0");
  const [dueDay, setDueDay] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data: structures = [], isLoading } = useQuery<FeeStructure[]>({
    queryKey: ["/api/admin/fees/structures"],
  });

  const { data: schoolConfig } = useQuery<{ classes: string[] }>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      if (!r.ok) return { classes: [] };
      return r.json();
    },
    staleTime: 300_000,
  });
  const schoolClasses: string[] = schoolConfig?.classes ?? [];

  function openCreate() {
    setEditing(null);
    setName(""); setFeeType(""); setAmount(""); setFrequency("annual");
    setSelectedClasses([]); setConcType("none"); setConcPct("0"); setDueDay(""); setIsActive(true);
    setShowModal(true);
  }

  function openEdit(s: FeeStructure) {
    setEditing(s);
    setName(s.name); setFeeType(s.feeType); setAmount(String(s.amount)); setFrequency(s.frequency);
    setSelectedClasses([...s.applicableClasses]); setConcType(s.concessionType);
    setConcPct(String(s.concessionPercent)); setDueDay(s.dueDayOfMonth ? String(s.dueDayOfMonth) : ""); setIsActive(s.isActive);
    setShowModal(true);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name, feeType, amount: parseInt(amount), frequency,
        applicableClasses: selectedClasses,
        concessionType: concType, concessionPercent: parseInt(concPct) || 0,
        dueDayOfMonth: dueDay ? parseInt(dueDay) : null, isActive,
      };
      return editing
        ? apiRequest("PATCH", `/api/admin/fees/structures/${editing.id}`, payload)
        : apiRequest("POST", "/api/admin/fees/structures", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/structures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      toast({ title: editing ? "Structure updated" : "Structure created" });
      setShowModal(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/fees/structures/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/structures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      toast({ title: "Structure deleted" });
      setDelId(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Generate Invoices state ────────────────────────────────────────────────
  const [genTarget, setGenTarget] = useState<FeeStructure | null>(null);
  const [genSessionId, setGenSessionId] = useState("");
  const [genClasses, setGenClasses] = useState<string[]>([]);
  const [genDueDate, setGenDueDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [genResult, setGenResult] = useState<{ created: number; skipped: number } | null>(null);

  const { data: sessions = [] } = useQuery<AcademicSession[]>({
    queryKey: ["/api/admin/fees/sessions"],
    staleTime: 60_000,
  });

  const genMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/admin/fees/structures/${genTarget!.id}/generate-invoices`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: parseInt(genSessionId),
          targetClasses: genTarget!.applicableClasses.length > 0 ? genClasses : [],
          dueDate: genDueDate,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Failed");
      return r.json() as Promise<{ created: number; skipped: number }>;
    },
    onSuccess: (data: { created: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      toast({ title: "Invoices generated", description: `${data.created} created${data.skipped > 0 ? `, ${data.skipped} skipped` : ""}` });
      setGenResult(data);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openGenInvoices(s: FeeStructure) {
    setGenTarget(s);
    setGenResult(null);
    setGenSessionId("");
    setGenClasses([...s.applicableClasses]);
    setGenDueDate(new Date().toISOString().split("T")[0]);
  }

  const FREQ: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", "one-time": "One-Time" };
  const CONC: Record<string, string> = { none: "None", sibling: "Sibling", merit: "Merit", other: "Other" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-sm">{structures.length} structure{structures.length !== 1 ? "s" : ""} defined</p>
        {!isArchiveMode && (
          <Button size="sm" onClick={openCreate} className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1">
            <Plus className="w-4 h-4" /> Add Structure
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : structures.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No fee structures yet.</p>
          {!isArchiveMode && <Button size="sm" onClick={openCreate} className="mt-3 bg-cyan-600 hover:bg-cyan-500 text-white">Add First Structure</Button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {structures.map(s => (
            <div key={s.id} className={`rounded-xl border p-4 space-y-3 ${s.isActive ? "border-cyan-700/40 bg-cyan-900/10" : "border-white/10 bg-white/5 opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-white font-semibold leading-tight">{s.name}</h3>
                  <p className="text-white/50 text-xs">{s.feeType}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${s.isActive ? "bg-emerald-900/30 text-emerald-400 border-emerald-700/30" : "bg-white/5 text-white/30 border-white/10"}`}>
                  {s.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-white">{fmt(s.amount)}</span>
                <span className="text-white/40 text-xs">/ {FREQ[s.frequency] ?? s.frequency}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {s.applicableClasses.length > 0 && (
                  <div><p className="text-white/40 mb-0.5">Classes</p><p className="text-white/70 truncate">{s.applicableClasses.join(", ")}</p></div>
                )}
                {s.concessionType !== "none" && (
                  <div><p className="text-white/40 mb-0.5">Concession</p><p className="text-white/70">{CONC[s.concessionType]} {s.concessionPercent}%</p></div>
                )}
                {s.dueDayOfMonth != null && (
                  <div><p className="text-white/40 mb-0.5">Due Day</p><p className="text-white/70">{s.dueDayOfMonth}<sup>th</sup></p></div>
                )}
              </div>
              {!isArchiveMode && (
                <div className="space-y-1 pt-1 border-t border-white/10">
                  <Button size="sm" variant="ghost" onClick={() => openGenInvoices(s)}
                    className="w-full text-cyan-400 hover:bg-cyan-900/30 text-xs h-7 gap-1 border border-cyan-700/30">
                    <Printer className="w-3 h-3" /> Generate Invoices
                  </Button>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(s)} className="flex-1 text-white/50 hover:text-white text-xs h-7 gap-1">
                      <Pencil className="w-3 h-3" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDelId(s.id)} className="flex-1 text-white/40 hover:text-red-400 text-xs h-7 gap-1">
                      <Trash2 className="w-3 h-3" /> Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Dialog open={showModal} onOpenChange={v => { if (!v) setShowModal(false); }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-cyan-400">{editing ? "Edit Fee Structure" : "New Fee Structure"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[["Name", name, setName, "Annual Tuition Fee"], ["Fee Type", feeType, setFeeType, "Tuition / Transport…"]].map(([label, val, set, ph]) => (
                <div key={label as string}>
                  <label className="text-xs text-white/60 mb-1 block">{label as string}</label>
                  <input value={val as string} onChange={e => (set as any)(e.target.value)} placeholder={ph as string}
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/60 mb-1 block">Amount (₹)</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min={1} placeholder="0"
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
              </div>
              <div>
                <label className="text-xs text-white/60 mb-1 block">Frequency</label>
                <select value={frequency} onChange={e => setFrequency(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                  {Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-white/60 mb-1.5 block">
                Applicable Classes
                {selectedClasses.length > 0 && (
                  <span className="ml-1.5 text-cyan-400">({selectedClasses.length} selected)</span>
                )}
              </label>
              {schoolClasses.length === 0 ? (
                <p className="text-white/30 text-xs py-2 px-1">No classes configured in School Setup yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {schoolClasses.map(cls => {
                    const checked = selectedClasses.includes(cls);
                    return (
                      <label key={cls} className={`flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-lg border transition-all ${checked ? "border-cyan-500/50 bg-cyan-900/20" : "border-white/10 bg-[#0A1628] hover:border-white/20"}`}>
                        <input type="checkbox" checked={checked}
                          onChange={e => setSelectedClasses(prev =>
                            e.target.checked ? [...prev, cls] : prev.filter(c => c !== cls)
                          )}
                          className="accent-cyan-500 flex-shrink-0" />
                        <span className="text-xs text-white/80 truncate">{cls}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-white/60 mb-1 block">Concession</label>
                <select value={concType} onChange={e => setConcType(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                  {Object.entries(CONC).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {concType !== "none" && (
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Percent %</label>
                  <input type="number" value={concPct} onChange={e => setConcPct(e.target.value)} min={0} max={100}
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
                </div>
              )}
              <div>
                <label className="text-xs text-white/60 mb-1 block">Due Day</label>
                <input type="number" value={dueDay} onChange={e => setDueDay(e.target.value)} min={1} max={31} placeholder="—"
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <label className="text-sm text-white/70">Active — visible in fee reports</label>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" onClick={() => setShowModal(false)} className="text-white/60">Cancel</Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name || !feeType || !amount}
                className="bg-cyan-600 hover:bg-cyan-500 text-white">
                {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Save Changes" : "Create Structure"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={delId !== null} onOpenChange={v => { if (!v) setDelId(null); }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-sm">
          <DialogHeader><DialogTitle className="text-red-400">Delete Fee Structure</DialogTitle></DialogHeader>
          <p className="text-white/60 text-sm">This structure will be permanently deleted. Existing fee records are not affected.</p>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="ghost" onClick={() => setDelId(null)} className="text-white/60">Cancel</Button>
            <Button onClick={() => delId && deleteMut.mutate(delId)} disabled={deleteMut.isPending}
              className="bg-red-600 hover:bg-red-500 text-white gap-1">
              {deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Generate Invoices Dialog */}
      <Dialog open={genTarget !== null} onOpenChange={v => { if (!v) { setGenTarget(null); setGenResult(null); } }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-cyan-400 flex items-center gap-2">
              <Printer className="w-5 h-5" /> Generate Invoices
            </DialogTitle>
          </DialogHeader>
          {genTarget && !genResult && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm">
                <p className="text-white font-semibold">{genTarget.name}</p>
                <p className="text-white/50 text-xs">{genTarget.feeType} · {fmt(genTarget.amount)} / {FREQ[genTarget.frequency] ?? genTarget.frequency}</p>
              </div>
              <div>
                <label className="text-xs text-white/60 mb-1 block">Academic Session</label>
                <select value={genSessionId} onChange={e => setGenSessionId(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                  <option value="">Select session…</option>
                  {sessions.map(s => (
                    <option key={s.id} value={s.id}>{s.sessionName}{s.isActive ? " (Active)" : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-white/60 mb-1 block">Due Date for Generated Invoices</label>
                <input type="date" value={genDueDate} onChange={e => setGenDueDate(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
              </div>
              {genTarget.applicableClasses.length > 0 && (
                <div>
                  <label className="text-xs text-white/60 mb-2 block">Target Classes (uncheck to exclude)</label>
                  <div className="flex flex-wrap gap-3">
                    {genTarget.applicableClasses.map(cls => (
                      <label key={cls} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={genClasses.includes(cls)}
                          onChange={e => setGenClasses(prev =>
                            e.target.checked ? [...prev, cls] : prev.filter(c => c !== cls)
                          )}
                          className="accent-cyan-500 w-4 h-4" />
                        <span className="text-sm text-white/80">{cls}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {genTarget.applicableClasses.length === 0 && (
                <p className="text-white/40 text-xs p-3 rounded-lg bg-white/5 border border-white/10">
                  No classes defined — invoices will be generated for{" "}
                  <span className="text-white/70 font-medium">all enrolled students</span> in the selected session.
                </p>
              )}
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" onClick={() => setGenTarget(null)} className="text-white/60">Cancel</Button>
                <Button
                  onClick={() => genMut.mutate()}
                  disabled={genMut.isPending || !genSessionId || !genDueDate ||
                    (genTarget.applicableClasses.length > 0 && genClasses.length === 0)}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1"
                >
                  {genMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  Generate
                </Button>
              </div>
            </div>
          )}
          {genResult && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-900/20 border border-emerald-700/40 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <p className="text-emerald-400 font-semibold text-lg">
                  {genResult.created} Invoice{genResult.created !== 1 ? "s" : ""} Generated
                </p>
                {genResult.skipped > 0 && (
                  <p className="text-white/50 text-xs mt-1">{genResult.skipped} skipped — already existed</p>
                )}
              </div>
              <Button
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white"
                onClick={() => { setGenTarget(null); setGenResult(null); }}
              >
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Reminders Tab ────────────────────────────────────────────────────────────

function RemindersTab() {
  const ROWS = [
    { day: "D+0",  label: "On Due Date",       note: "Notify parent/guardian of the fee amount now due.", icon: "📅" },
    { day: "D+7",  label: "7 Days Overdue",    note: "First reminder — polite nudge via SMS or email.",   icon: "📩" },
    { day: "D+14", label: "14 Days Overdue",   note: "Second escalation — copy to class guardian.",       icon: "⚠️"  },
    { day: "D+30", label: "30 Days Overdue",   note: "Final notice — flag account, apply late fee if applicable.", icon: "🚨" },
  ];
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="p-4 rounded-xl border border-amber-700/30 bg-amber-900/10">
        <p className="text-amber-400 text-sm font-semibold">Automated Dunning Schedule</p>
        <p className="text-white/50 text-xs mt-1">Connect an SMS / email provider via the External Portal tab to enable automated dispatch at each stage below.</p>
      </div>
      <div className="space-y-3">
        {ROWS.map(r => (
          <div key={r.day} className="flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/5">
            <span className="text-2xl w-8 text-center flex-shrink-0">{r.icon}</span>
            <div className="w-14 flex-shrink-0 text-center">
              <p className="text-cyan-400 text-xs font-bold">{r.day}</p>
            </div>
            <div className="h-6 w-px bg-white/10 flex-shrink-0" />
            <div>
              <p className="text-white font-medium text-sm">{r.label}</p>
              <p className="text-white/50 text-xs mt-0.5">{r.note}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-white/30 text-xs p-3 rounded-lg border border-white/5 bg-white/5">
        <span className="text-white/50 font-medium">Note:</span> Automated delivery requires a third-party SMS gateway (e.g. Twilio, MSG91) or email provider (e.g. SendGrid). Configure your webhook URL in the <span className="text-cyan-400">External Portal</span> tab.
      </p>
    </div>
  );
}

// ─── External Portal Tab ──────────────────────────────────────────────────────

function ExternalPortalTab({ isArchiveMode }: { isArchiveMode: boolean }) {
  const { toast } = useToast();
  const [isEnabled, setIsEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [banner, setBanner] = useState("");
  const [synced, setSynced] = useState(false);

  const { data: settings, isLoading } = useQuery<ExternalSettings>({
    queryKey: ["/api/admin/fees/external-settings"],
    staleTime: 60_000,
  });

  useEffect(() => {
    if (settings && !synced) {
      setIsEnabled(settings.isEnabled);
      setUrl(settings.gatewayUrl ?? "");
      setBanner(settings.bannerMessage ?? "");
      setSynced(true);
    }
  }, [settings, synced]);

  const saveMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/fees/external-settings", {
      isEnabled, gatewayUrl: url || null, bannerMessage: banner || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/external-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      toast({ title: "Portal settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;

  return (
    <div className="space-y-5 max-w-xl">
      <div className="p-4 rounded-xl border border-white/10 bg-[#1A2942] flex items-center justify-between">
        <div>
          <p className="text-white font-semibold">Payment Portal</p>
          <p className="text-white/40 text-xs mt-0.5">Allow students/parents to initiate payments via an external link.</p>
        </div>
        <Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={isArchiveMode} />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-white/60 flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Gateway / Portal URL</label>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://pay.yourschool.edu/" disabled={isArchiveMode}
          className="w-full bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 disabled:opacity-40" />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-white/60 flex items-center gap-1"><Bell className="w-3 h-3" /> Banner Message (shown to students)</label>
        <textarea value={banner} onChange={e => setBanner(e.target.value)} rows={3} disabled={isArchiveMode}
          placeholder="Pay your fees online at the link below. For queries, contact the accounts office."
          className="w-full bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 resize-none disabled:opacity-40" />
        <p className="text-white/25 text-xs text-right">{banner.length}/500</p>
      </div>

      {(isEnabled || banner) && (
        <div className="space-y-1.5">
          <p className="text-white/40 text-xs uppercase tracking-widest">Student Portal Preview</p>
          <div className="p-4 rounded-xl border border-cyan-700/30 bg-cyan-900/10">
            <p className="text-cyan-400 text-sm font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4" /> Pay Fees Online</p>
            {banner && <p className="text-white/60 text-xs mt-2 leading-relaxed">{banner}</p>}
            {isEnabled && url
              ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-2 text-cyan-400 text-xs underline"><ExternalLink className="w-3 h-3" /> {url}</a>
              : isEnabled && <p className="text-white/25 text-xs mt-2">No gateway URL configured.</p>}
          </div>
        </div>
      )}

      {!isArchiveMode && (
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="bg-cyan-600 hover:bg-cyan-500 text-white">
          {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Save Settings
        </Button>
      )}
    </div>
  );
}

// ─── Audit Tab ────────────────────────────────────────────────────────────────

function AuditTab() {
  const PAGE = 20;
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery<{ entries: AuditLogEntry[]; total: number }>({
    queryKey: ["/api/admin/fees/audit-log", page],
    queryFn: async () => {
      const r = await fetch(`/api/admin/fees/audit-log?limit=${PAGE}&offset=${page * PAGE}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 15_000,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-sm">{data ? `${data.total} entries` : "…"}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="h-7 px-2 text-white/50">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-white/40 text-xs">{page + 1} / {totalPages || 1}</span>
          <Button size="sm" variant="ghost" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="h-7 px-2 text-white/50">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : !data?.entries.length ? (
        <div className="text-center py-16 text-white/30">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No audit entries yet. Actions in this module will appear here.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  {["Timestamp","Actor","Action","Description","IP"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-white/50 font-medium text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.entries.map(e => (
                  <tr key={e.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-white/40 text-xs whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
                    <td className="px-4 py-3 text-white/70 text-xs">{e.actorName ?? `#${e.actorId}`}</td>
                    <td className="px-4 py-3"><ActionBadge action={e.action} /></td>
                    <td className="px-4 py-3 text-white/60 text-xs max-w-xs truncate">{e.description ?? "—"}</td>
                    <td className="px-4 py-3 text-white/30 text-xs font-mono">{e.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = "ledger" | "structures" | "reminders" | "external" | "audit";

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "ledger",     label: "Ledger & Transactions", Icon: Receipt       },
  { id: "structures", label: "Fee Structures",        Icon: BookOpen      },
  { id: "reminders",  label: "Reminders",             Icon: Bell          },
  { id: "external",   label: "External Portal",       Icon: ExternalLink  },
  { id: "audit",      label: "Audit Log",             Icon: Shield        },
];

export default function FeesManager({ schoolId, allowedSubs }: { schoolId: number; allowedSubs?: string[] }) {
  const canRecord = allowedSubs === undefined || allowedSubs.includes("record");
  const canExport  = allowedSubs === undefined || allowedSubs.includes("export");
  const { isArchiveMode, selectedSession } = useSessionView();
  const viewSessionId = selectedSession?.id ?? null;
  const [activeTab, setActiveTab] = useState<Tab>("ledger");

  const { data: students = [] } = useQuery<StudentItem[]>({
    queryKey: ["/api/schools", schoolId, "students"],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/students`, { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-cyan-900/30 border border-cyan-700/40">
          <CreditCard className="w-6 h-6 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-white text-xl font-bold">Fees & Payments</h2>
          <p className="text-white/40 text-xs">Financial hub — ledger, structures, audit trail</p>
        </div>
        {isArchiveMode ? (
          <span className="ml-auto px-3 py-1 rounded-full text-xs bg-amber-900/30 text-amber-400 border border-amber-700/30 flex-shrink-0">
            Archive — read-only
          </span>
        ) : selectedSession ? (
          <span className="ml-auto px-3 py-1 rounded-full text-xs bg-cyan-900/30 text-cyan-400 border border-cyan-700/30 flex-shrink-0">
            {selectedSession.sessionName}
          </span>
        ) : null}
      </div>

      {/* Metric bar */}
      <MetricBar viewSessionId={viewSessionId} />

      {/* Tab nav */}
      <div className="flex gap-1 p-1 bg-[#1A2942] rounded-xl border border-white/10 overflow-x-auto">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${active ? "bg-cyan-600 text-white shadow-sm" : "text-white/50 hover:text-white hover:bg-white/5"}`}>
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTab === "ledger"     && <LedgerTab canRecord={canRecord} isArchiveMode={isArchiveMode} students={students} viewSessionId={viewSessionId} />}
      {activeTab === "structures" && <StructuresTab isArchiveMode={isArchiveMode} />}
      {activeTab === "reminders"  && <RemindersTab />}
      {activeTab === "external"   && <ExternalPortalTab isArchiveMode={isArchiveMode} />}
      {activeTab === "audit"      && <AuditTab />}
    </div>
  );
}
