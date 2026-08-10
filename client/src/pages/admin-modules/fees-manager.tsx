import { useState, useMemo, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CreditCard, Plus, Search, Loader2, Trash2, Pencil, CheckCircle2, AlertTriangle, Clock,
  Receipt, DollarSign, TrendingUp, TrendingDown, Banknote, BookOpen, Bell, ExternalLink,
  Shield, ChevronLeft, ChevronRight, Lock, X, Printer, History, Download, FileText,
  MessageSquare, Mail, Send, Eye, EyeOff, Zap, Phone, BarChart2,
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

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
  feeName: string;          // resolved server-side: always current structure name
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
  autoGenerate: boolean;
  autoGenDueDay: number | null;
  breakdown: Array<{ name: string; purpose: string; amount: number }>;
  lastInvoicesGeneratedAt: string | null;
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
  maxOvercollectionPercent: number | null;
  razorpayEnabled: boolean;
  razorpayKeyId: string | null;
  razorpayKeySecret: string | null;
  razorpayWebhookSecret: string | null;
  razorpayMode: string;
}

interface NotifConfig {
  smsEnabled: boolean;
  msg91AuthKey: string | null;
  msg91SenderId: string | null;
  waEnabled: boolean;
  msg91WaNumber: string | null;
  msg91WaTemplate: string | null;
  emailEnabled: boolean;
  sendgridApiKey: string | null;
  sendgridFromEmail: string | null;
  sendgridFromName: string | null;
}

interface DunningLogEntry {
  id: number;
  feeRecordId: number;
  channel: string;
  stage: string;
  sentAt: string;
  status: string;
  errorMessage: string | null;
  recipient: string | null;
  studentName: string | null;
}

interface DunningTemplateRow {
  id: number;
  stage: string;
  channel: string;
  bodyText: string;
  subjectText: string | null;
}

interface SimResult {
  totalFees: number;
  entriesLogged: number;
  byChannel: Record<string, { would_send: number; missing_contact: number }>;
  entries: Array<{
    studentName: string;
    feeType: string;
    amount: number;
    dueDate: string;
    stage: string;
    channel: string;
    recipient: string | null;
    issue: string | null;
  }>;
}

interface DunningJobStatusData {
  isRunning: boolean;
  startedAt: string | null;
  lastCompletedAt: string | null;
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

interface PaymentRecord {
  id: number;
  feeRecordId: number | null;
  studentId: number;
  paymentMethod: string;
  amount: number;
  receivedDate: string;
  referenceNumber: string | null;
  cashierNotes: string | null;
  receiptNumber: string | null;
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
    create:           "bg-emerald-900/40 text-emerald-400 border-emerald-700/40",
    update:           "bg-blue-900/40 text-blue-400 border-blue-700/40",
    delete:           "bg-red-900/40 text-red-400 border-red-700/40",
    payment:          "bg-cyan-900/40 text-cyan-400 border-cyan-700/40",
    settings_change:  "bg-purple-900/40 text-purple-400 border-purple-700/40",
    waiver:           "bg-amber-900/40 text-amber-400 border-amber-700/40",
    blocked_payment:  "bg-orange-900/40 text-orange-400 border-orange-700/40",
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
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/summary");
      if (!r.ok) throw new Error("Failed to fetch fee summary");
      return r.json();
    },
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
  existingFeeRecords?: FeeRecordWithStudent[];
  onSuccess?: () => void;
}

function RecordPaymentModal({ open, onClose, feeRecord, students, existingFeeRecords = [], onSuccess }: RecordPaymentModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"form" | "duplicate_warn" | "confirm" | "done">("form");
  const [lastPaymentId, setLastPaymentId] = useState<number | null>(null);
  const [pendingPayload, setPendingPayload] = useState<any>(null);
  const [adminPwd, setAdminPwd] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [duplicateRecord, setDuplicateRecord] = useState<FeeRecordWithStudent | null>(null);
  const [overpaymentError, setOverpaymentError] = useState<string | null>(null);

  const { selectedSession } = useSessionView();

  // Fetch prior payments on this fee record so we can compute the remaining balance
  const { data: priorPayments = [] } = useQuery<PaymentRecord[]>({
    queryKey: ["/api/admin/fees/payments", feeRecord?.id],
    queryFn: async () => {
      if (!feeRecord) return [];
      const r = await sessionFetch(`/api/admin/fees/payments?feeRecordId=${feeRecord.id}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: open && !!feeRecord,
    staleTime: 0,
  });

  const totalAlreadyPaid = priorPayments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = feeRecord ? feeRecord.amount - totalAlreadyPaid : null;

  const [method, setMethod] = useState("Cash");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [sid, setSid] = useState("");
  // Fee record fields (used when creating a standalone payment with no pre-linked fee record)
  const [feeType, setFeeType] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [feeStatus, setFeeStatus] = useState("Due");
  const [academicYear, setAcademicYear] = useState("");
  const [feeNotes, setFeeNotes] = useState("");
  // Student search state (used when no feeRecord is pre-linked)
  const [paySearchCls, setPaySearchCls] = useState("");
  const [paySearchQ, setPaySearchQ] = useState("");
  const [paySearchResults, setPaySearchResults] = useState<StudentItem[] | null>(null);
  const [paySelectedStudent, setPaySelectedStudent] = useState<StudentItem | null>(null);
  // Idempotency key is generated once per modal open and reused across retries
  const [idempotencyKey, setIdempotencyKey] = useState("");

  // School config — classes list for the student search filter
  const { data: paySchoolConfig } = useQuery<{ classes: string[] }>({
    queryKey: ["/api/admin/school-config"],
    staleTime: 300_000,
  });
  const payClasses: string[] = paySchoolConfig?.classes ?? [];

  // Fee structures — for "Fee Name" picker
  const { data: payFeeStructures = [] } = useQuery<FeeStructure[]>({
    queryKey: ["/api/admin/fees/structures"],
    staleTime: 300_000,
  });
  const payActiveStructures = useMemo(() => {
    const cls = paySelectedStudent?.class ?? null;
    return payFeeStructures.filter(s =>
      s.isActive && (s.applicableClasses.length === 0 || (cls && s.applicableClasses.includes(cls)))
    );
  }, [payFeeStructures, paySelectedStudent]);

  // Preview next OP receipt number — peek only, no DB write
  const { data: opPreviewData } = useQuery<{ preview: string }>({
    queryKey: ["/api/admin/fees/next-receipt", "OP", open],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/next-receipt?prefix=OP");
      if (!r.ok) return { preview: "OP—" };
      return r.json();
    },
    enabled: open && step === "form",
    staleTime: 0,
  });
  const opPreview = opPreviewData?.preview ?? "…";

  // Sync amount + student when feeRecord changes; generate a fresh idempotency key
  useEffect(() => {
    if (feeRecord) {
      const fine = (feeRecord as any).accrued_late_fee ?? 0;
      setAmount(String(feeRecord.amount + fine));
      setSid(String(feeRecord.studentId));
      setAcademicYear(feeRecord.academicYear ?? selectedSession?.sessionName ?? "");
      setFeeNotes(feeRecord.notes ?? "");
    } else {
      setAmount("");
      setSid("");
      setAcademicYear(selectedSession?.sessionName ?? "");
      setFeeNotes("");
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
    // Reset fee record fields
    setFeeType("");
    setDueDate("");
    setFeeStatus("Due");
    // Reset student search
    setPaySearchCls("");
    setPaySearchQ("");
    setPaySearchResults(null);
    setPaySelectedStudent(null);
    // Reset duplicate warn state
    setDuplicateRecord(null);
    // Reset overpayment error
    setOverpaymentError(null);
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
        err.overpaymentGuard = body.overpaymentGuard;
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
      } else if (e.overpaymentGuard) {
        // Surface the overpayment error inline in the form instead of a fleeting toast.
        // Also return to the form step in case this was triggered from the high-value
        // confirm step — the inline banner only renders when step === "form".
        setOverpaymentError(e.message);
        setStep("form");
      } else {
        toast({ title: "Error", description: e.message, variant: "destructive" });
      }
    },
  });

  function buildPayload(overrides: Record<string, any> = {}) {
    return {
      feeRecordId: feeRecord?.id ?? null,
      studentId: feeRecord?.studentId ?? parseInt(sid),
      feeType: feeRecord ? null : (feeType || null),
      dueDate: feeRecord ? null : (dueDate || null),
      feeStatus: feeRecord ? null : (feeStatus || null),
      academicYear: feeRecord ? null : (academicYear || null),
      feeNotes: feeNotes || null,
      paymentMethod: method,
      referenceNumber: ref || null,
      receivedDate: date,
      amount: parseInt(amount),
      lateFeePaid: feeRecord ? ((feeRecord as any).accrued_late_fee ?? 0) : 0,
      cashierNotes: notes || null,
      idempotencyKey: idempotencyKey || null,
      ...overrides,
    };
  }

  function submit() {
    // In standalone mode, check for an existing Due/Overdue/Partial fee record with the same student + fee type
    if (!feeRecord && sid && feeType.trim()) {
      const studentIdNum = parseInt(sid);
      const normalizedType = feeType.trim().toLowerCase();
      const dupe = existingFeeRecords.find(
        r => r.studentId === studentIdNum &&
          r.feeType.trim().toLowerCase() === normalizedType &&
          r.status !== "Paid" && r.status !== "Waived",
      );
      if (dupe) {
        setDuplicateRecord(dupe);
        setStep("duplicate_warn");
        return;
      }
    }
    mut.mutate(buildPayload());
  }

  function submitLinkExisting() {
    // Link the payment to the existing fee record instead of creating a new one
    mut.mutate(buildPayload({
      feeRecordId: duplicateRecord!.id,
      studentId: duplicateRecord!.studentId,
      feeType: null,
      dueDate: null,
      feeStatus: null,
      academicYear: null,
      feeNotes: null,
    }));
  }

  function submitCreateAnyway() {
    // Skip the duplicate check and create a fresh fee record
    mut.mutate(buildPayload());
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
            {step === "confirm" ? "Confirm High-Value Payment"
              : step === "duplicate_warn" ? "Existing Fee Record Found"
              : "Record Offline Payment"}
          </DialogTitle>
        </DialogHeader>

        {step === "form" && (
          <div className="space-y-4">
            {/* Read-only OP receipt preview */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-white/10">
              <span className="text-white/40 text-xs">Receipt No.</span>
              <span className="font-mono text-sm text-cyan-300 font-semibold tracking-wider">{opPreview}</span>
              <span className="text-white/20 text-[10px] ml-auto">auto-assigned on save</span>
            </div>
            {feeRecord ? (
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm space-y-1">
                <p className="text-white font-semibold">{feeRecord.student?.name}</p>
                <p className="text-white/50 text-xs">{feeRecord.feeType} · {feeRecord.student?.class}-{feeRecord.student?.section}</p>
                {(feeRecord as any).accrued_late_fee > 0 ? (
                  <div className="space-y-0.5 pt-1 border-t border-white/10">
                    <div className="flex justify-between text-xs">
                      <span className="text-white/40">Base Amount</span>
                      <span className="text-white/60">{fmt(feeRecord.amount)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-amber-400/80">Accrued Late Fine</span>
                      <span className="text-amber-400 font-semibold">+{fmt((feeRecord as any).accrued_late_fee)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold border-t border-white/10 pt-0.5 mt-0.5">
                      <span className="text-white/70">Total Due</span>
                      <span className="text-white">{fmt(feeRecord.amount + (feeRecord as any).accrued_late_fee)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-white/40 text-xs">Invoice: {fmt(feeRecord.amount)}</p>
                )}
              </div>
            ) : (
              <div>
                <label className="text-xs text-white/60 mb-1 block">Student</label>
                {paySelectedStudent ? (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/40">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{paySelectedStudent.name}</p>
                      <p className="text-white/40 text-xs">{paySelectedStudent.digitalStudentId} · Class {paySelectedStudent.class}-{paySelectedStudent.section}</p>
                    </div>
                    <button type="button" onClick={() => { setPaySelectedStudent(null); setSid(""); setPaySearchResults(null); }}
                      className="text-white/40 hover:text-red-400 transition-colors shrink-0 text-lg leading-none">✕</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <select value={paySearchCls} onChange={e => setPaySearchCls(e.target.value)}
                        className="bg-[#0A1628] border border-white/20 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 shrink-0">
                        <option value="">All Classes</option>
                        {payClasses.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input value={paySearchQ} onChange={e => setPaySearchQ(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            const q = paySearchQ.toLowerCase().trim();
                            setPaySearchResults(students.filter(s => {
                              if (paySearchCls && s.class !== paySearchCls) return false;
                              return !q || s.name.toLowerCase().includes(q) || (s.digitalStudentId ?? "").toLowerCase().includes(q);
                            }));
                          }
                        }}
                        placeholder="Name or Student ID…"
                        className="flex-1 bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                      <button type="button"
                        onClick={() => {
                          const q = paySearchQ.toLowerCase().trim();
                          setPaySearchResults(students.filter(s => {
                            if (paySearchCls && s.class !== paySearchCls) return false;
                            return !q || s.name.toLowerCase().includes(q) || (s.digitalStudentId ?? "").toLowerCase().includes(q);
                          }));
                        }}
                        className="bg-cyan-600 hover:bg-cyan-500 text-white text-sm px-3 py-2 rounded-lg shrink-0 transition-colors">
                        Search
                      </button>
                    </div>
                    {paySearchResults !== null && (
                      paySearchResults.length === 0
                        ? <p className="text-white/40 text-xs px-1">No students found.</p>
                        : <div className="max-h-36 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
                            {paySearchResults.map(s => (
                              <button key={s.id} type="button"
                                onClick={() => { setPaySelectedStudent(s); setSid(String(s.id)); setPaySearchResults(null); }}
                                className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors">
                                <p className="text-white text-sm">{s.name}</p>
                                <p className="text-white/40 text-xs">{s.digitalStudentId} · Class {s.class}-{s.section}</p>
                              </button>
                            ))}
                          </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Fee Details (only for standalone opens with no pre-linked fee record) ── */}
            {!feeRecord && (
              <>
                <div className="pt-1 pb-0">
                  <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">Fee Details</p>
                </div>

                {/* Fee Name picker — auto-fills Fee Type & Amount */}
                {payActiveStructures.length > 0 && (
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Fee Name</label>
                    <select
                      onChange={e => {
                        const s = payActiveStructures.find(s => String(s.id) === e.target.value);
                        if (s) { setFeeType(s.feeType); setAmount(String(s.amount)); }
                      }}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                      <option value="">— Select fee name —</option>
                      {payActiveStructures.map(s => (
                        <option key={s.id} value={s.id}>{s.name} · ₹{s.amount.toLocaleString("en-IN")}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Fee Type</label>
                    <input value={feeType} onChange={e => setFeeType(e.target.value)}
                      placeholder="Tuition, Transport…"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Amount (₹)</label>
                    <input type="number" value={amount} onChange={e => { setAmount(e.target.value); setOverpaymentError(null); }} min={1}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Status</label>
                    <input value="Paid" readOnly
                      className="w-full bg-[#0A1628] border border-white/10 rounded-lg px-3 py-2 text-sm text-emerald-400 font-medium cursor-default" />
                  </div>
                  <div>
                    <label className="text-xs text-white/30 mb-1 block">Due Date <span className="font-normal">(not required)</span></label>
                    <input type="date" disabled value=""
                      className="w-full bg-[#0A1628] border border-white/10 rounded-lg px-3 py-2 text-sm text-white opacity-40 cursor-not-allowed [color-scheme:dark]" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Academic Year</label>
                    <input value={academicYear} readOnly
                      className="w-full bg-[#0A1628] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/40 cursor-default" />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Notes</label>
                    <input value={feeNotes} onChange={e => setFeeNotes(e.target.value)} placeholder=""
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                </div>

                <div className="pt-1 pb-0">
                  <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">Payment Details</p>
                </div>
              </>
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
                {/* Amount only shown here when pre-linked (feeRecord exists); standalone uses the fee-details block above */}
                {feeRecord ? (
                  <>
                    <label className="text-xs text-white/60 mb-1 block">Amount (₹)</label>
                    <input type="number" value={amount} onChange={e => { setAmount(e.target.value); setOverpaymentError(null); }} min={1}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
                  </>
                ) : (
                  <>
                    <label className="text-xs text-white/60 mb-1 block">Received Date</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                  </>
                )}
              </div>
            </div>

            {feeRecord && (
              <>
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Received Date</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Status</label>
                    <input value="Paid" readOnly
                      className="w-full bg-[#0A1628] border border-white/10 rounded-lg px-3 py-2 text-sm text-emerald-400 font-medium cursor-default" />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Academic Year</label>
                    <input value={academicYear} readOnly
                      className="w-full bg-[#0A1628] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/50 cursor-default" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-white/60 mb-1 block">Notes</label>
                  <input value={feeNotes} onChange={e => setFeeNotes(e.target.value)}
                    placeholder="Optional note for this payment…"
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                </div>
              </>
            )}

            {method !== "Cash" && (
              <div>
                <label className="text-xs text-white/60 mb-1 block">Reference Number</label>
                <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Cheque / UTR / DD no."
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
              </div>
            )}

            {amtNum >= 10000 && (
              <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-700/40 text-xs text-amber-400">
                ⚠️ Payments ≥ ₹10,000 require admin password confirmation in the next step.
              </div>
            )}

            {feeRecord && remainingBalance !== null && amtNum > remainingBalance && !overpaymentError && (
              <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-600/40 text-xs text-yellow-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  This payment of {fmt(amtNum)} exceeds the outstanding balance of {fmt(remainingBalance)} — the record will be marked <span className="font-semibold">Paid</span>.
                </span>
              </div>
            )}

            {overpaymentError && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-600/50 text-xs text-red-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{overpaymentError}</span>
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

        {step === "duplicate_warn" && duplicateRecord && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-700/40">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-400 text-sm font-semibold">Duplicate Fee Type Detected</p>
                  <p className="text-white/60 text-xs mt-1">
                    This student already has an open <span className="text-white font-medium">{duplicateRecord.feeType}</span> fee record.
                    Creating another will double-bill them in the ledger.
                  </p>
                </div>
              </div>
            </div>

            {/* Existing record details */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm space-y-1">
              <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-1.5">Existing Record</p>
              <div className="flex justify-between">
                <span className="text-white/50">Fee Type</span>
                <span className="text-white font-medium">{duplicateRecord.feeType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Amount</span>
                <span className="text-white font-medium">{fmt(duplicateRecord.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Status</span>
                <StatusChip status={duplicateRecord.status} />
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Due Date</span>
                <span className="text-white/70">{fmtDate(duplicateRecord.dueDate)}</span>
              </div>
            </div>

            <p className="text-white/50 text-xs">What would you like to do?</p>

            <div className="flex flex-col gap-2">
              <Button onClick={submitLinkExisting} disabled={mut.isPending}
                className="bg-cyan-600 hover:bg-cyan-500 text-white gap-2 justify-start">
                {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                Link payment to existing record
              </Button>
              <Button onClick={submitCreateAnyway} disabled={mut.isPending}
                variant="outline"
                className="border-white/20 text-white/70 hover:bg-white/10 gap-2 justify-start">
                <Plus className="w-4 h-4" />
                Create new record anyway
              </Button>
              <Button variant="ghost" onClick={() => setStep("form")} className="text-white/40 text-xs">
                ← Back to form
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

// ─── Payment History Modal ────────────────────────────────────────────────────

interface PaymentHistoryModalProps {
  open: boolean;
  onClose: () => void;
  feeRecord: FeeRecordWithStudent | null;
}

function PaymentHistoryModal({ open, onClose, feeRecord }: PaymentHistoryModalProps) {
  const { toast } = useToast();
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterMethod, setFilterMethod] = useState("All");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Fetch payments directly inside the modal with polling so the list stays
  // live while the modal is open — no manual refresh needed.
  const { data: payments = [], isFetching } = useQuery<PaymentRecord[]>({
    queryKey: ["/api/admin/fees/payments", feeRecord?.id],
    queryFn: async () => {
      if (!feeRecord) return [];
      const r = await sessionFetch(`/api/admin/fees/payments?feeRecordId=${feeRecord.id}`);
      if (!r.ok) return [];
      const data = await r.json();
      setLastRefreshed(new Date());
      return data;
    },
    enabled: open && !!feeRecord,
    staleTime: 0,
    refetchInterval: open ? 30_000 : false,
  });

  // Reset filters whenever the modal is opened/closed
  useEffect(() => {
    if (!open) {
      setFilterFrom("");
      setFilterTo("");
      setFilterMethod("All");
      setLastRefreshed(null);
    }
  }, [open]);

  const methodLabel: Record<string, string> = {
    Cash: "Cash", Cheque: "Cheque", BankTransfer: "Bank Transfer",
    DemandDraft: "Demand Draft", Online: "Online",
  };

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = Math.max(0, (feeRecord?.amount ?? 0) - totalPaid);

  // Apply filters
  const filteredPayments = useMemo(() => {
    return payments.filter(p => {
      if (filterMethod !== "All" && p.paymentMethod !== filterMethod) return false;
      const date = p.receivedDate.split("T")[0];
      if (filterFrom && date < filterFrom) return false;
      if (filterTo && date > filterTo) return false;
      return true;
    });
  }, [payments, filterFrom, filterTo, filterMethod]);

  const filteredTotal = filteredPayments.reduce((sum, p) => sum + p.amount, 0);
  const isFiltered = filterMethod !== "All" || filterFrom !== "" || filterTo !== "";

  if (!feeRecord) return null;

  function clearFilters() {
    setFilterFrom("");
    setFilterTo("");
    setFilterMethod("All");
  }

  function exportToCSV() {
    if (filteredPayments.length === 0) {
      toast({ title: "Nothing to export", description: "No transactions match the current filters.", variant: "destructive" });
      return;
    }
    const studentName = feeRecord!.student?.name ?? "student";
    const headers = ["#", "Date", "Amount (INR)", "Method", "Reference No.", "Notes", "Receipt No."];
    const dataRows = filteredPayments.map((p, idx) => [
      idx + 1,
      fmtDate(p.receivedDate),
      p.amount,
      methodLabel[p.paymentMethod] ?? p.paymentMethod,
      p.referenceNumber ?? "",
      p.cashierNotes ?? "",
      p.receiptNumber ?? `PAY-${p.id}`,
    ]);
    // Summary footer rows
    dataRows.push(["", "", "", "", "", "", ""]);
    dataRows.push(["", "Filtered Total", filteredTotal, "", "", "", ""]);
    if (isFiltered) {
      dataRows.push(["", "Overall Total", feeRecord!.amount, "", "", "", ""]);
    }

    const csvContent = [headers, ...dataRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = studentName.replace(/[^a-zA-Z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
    a.download = `payment-history-${safeName}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportToPDF() {
    if (filteredPayments.length === 0) {
      toast({ title: "Nothing to export", description: "No transactions match the current filters.", variant: "destructive" });
      return;
    }
    const studentName = feeRecord!.student?.name ?? "—";
    const studentInfo = feeRecord!.student ? `${feeRecord!.student.class}-${feeRecord!.student.section}` : "";
    const feeTypeLabel = feeRecord!.feeType;
    const esc = (s: string | null | undefined) =>
      (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const filterDesc = [
      filterFrom ? `From: ${fmtDate(filterFrom)}` : "",
      filterTo ? `To: ${fmtDate(filterTo)}` : "",
      filterMethod !== "All" ? `Method: ${methodLabel[filterMethod] ?? filterMethod}` : "",
    ].filter(Boolean).join(" · ");

    const rows = filteredPayments.map((p, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(fmtDate(p.receivedDate))}</td>
        <td class="amount">₹${p.amount.toLocaleString("en-IN")}</td>
        <td>${esc(methodLabel[p.paymentMethod] ?? p.paymentMethod)}</td>
        <td>${esc(p.referenceNumber ?? "—")}</td>
        <td>${esc(p.cashierNotes ?? "—")}</td>
        <td class="mono">${p.receiptNumber ?? `PAY-${p.id}`}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Payment History – ${esc(studentName)}</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#1e293b;font-size:13px;}
  h1{font-size:18px;margin:0 0 4px;color:#0891b2;}
  .meta{color:#64748b;font-size:12px;margin-bottom:16px;}
  .filter-badge{display:inline-block;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;padding:2px 8px;font-size:11px;color:#0369a1;margin-bottom:12px;}
  table{width:100%;border-collapse:collapse;margin-top:4px;}
  th{background:#0891b2;color:#fff;text-align:left;padding:8px 6px;font-size:12px;}
  td{padding:7px 6px;border-bottom:1px solid #f1f5f9;}
  tr:nth-child(even) td{background:#f8fafc;}
  .amount{font-weight:700;}
  .mono{font-family:monospace;font-size:11px;color:#94a3b8;}
  .total-row td{border-top:2px solid #0891b2;font-weight:700;background:#f0f9ff;}
  .footer{margin-top:20px;font-size:11px;color:#94a3b8;text-align:center;}
  @media print{body{padding:0;}}
</style></head><body>
<h1>Payment History</h1>
<div class="meta">
  <strong>${esc(studentName)}</strong> · ${esc(studentInfo)} · ${esc(feeTypeLabel)}<br>
  Invoice: ₹${feeRecord!.amount.toLocaleString("en-IN")} · Status: ${esc(feeRecord!.status)}
</div>
${filterDesc ? `<div class="filter-badge">Filtered: ${esc(filterDesc)}</div>` : ""}
<table>
  <thead><tr>
    <th>#</th><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Notes</th><th>Receipt</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total-row">
    <td colspan="2">${isFiltered ? `Filtered Total (${filteredPayments.length} of ${payments.length})` : "Total"}</td>
    <td class="amount">₹${filteredTotal.toLocaleString("en-IN")}</td>
    <td colspan="4"></td>
  </tr></tfoot>
</table>
<div class="footer">Generated ${new Date().toLocaleString("en-IN")} · BENIUS</div>
<script>window.print();</script>
</body></html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-cyan-400">
            <History className="w-5 h-5" />
            Payment History
            {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500/60 ml-1" />}
          </DialogTitle>
          {lastRefreshed && !isFetching && (
            <p className="text-white/30 text-[10px] mt-0.5">
              Updated {lastRefreshed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · auto-refreshes every 30 s
            </p>
          )}
        </DialogHeader>

        {/* Fee record summary */}
        <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm shrink-0">
          <p className="text-white font-semibold">{feeRecord.student?.name ?? "—"}</p>
          <p className="text-white/50 text-xs">{feeRecord.feeType} · {feeRecord.student?.class}-{feeRecord.student?.section}</p>
          <div className="mt-2 flex items-center gap-4 flex-wrap">
            <span className="text-white/40 text-xs">Invoice: <span className="text-white font-medium">{fmt(feeRecord.amount)}</span></span>
            <span className="text-white/40 text-xs">Paid: <span className="text-emerald-400 font-medium">{fmt(totalPaid)}</span></span>
            {outstanding > 0 && (
              <span className="text-white/40 text-xs">Outstanding: <span className="text-amber-400 font-medium">{fmt(outstanding)}</span></span>
            )}
            <StatusChip status={feeRecord.status} />
          </div>
        </div>

        {/* Filters */}
        <div className="shrink-0 space-y-2">
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-1 min-w-[130px]">
              <label className="text-white/40 text-xs shrink-0">From</label>
              <input
                type="date"
                value={filterFrom}
                onChange={e => setFilterFrom(e.target.value)}
                className="flex-1 bg-[#0A1628] border border-white/20 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-1 min-w-[130px]">
              <label className="text-white/40 text-xs shrink-0">To</label>
              <input
                type="date"
                value={filterTo}
                onChange={e => setFilterTo(e.target.value)}
                className="flex-1 bg-[#0A1628] border border-white/20 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]"
              />
            </div>
            <select
              value={filterMethod}
              onChange={e => setFilterMethod(e.target.value)}
              className="bg-[#0A1628] border border-white/20 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="All">All Methods</option>
              <option value="Cash">Cash</option>
              <option value="Cheque">Cheque</option>
              <option value="BankTransfer">Bank Transfer</option>
              <option value="DemandDraft">Demand Draft</option>
              <option value="Online">Online</option>
            </select>
            {isFiltered && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-white/40 hover:text-red-400 text-xs flex items-center gap-1 transition-colors"
              >
                <X className="w-3 h-3" /> Reset
              </button>
            )}
          </div>
          {isFiltered && (
            <div className="flex items-center gap-3 px-1">
              <span className="text-white/40 text-xs">
                {filteredPayments.length} of {payments.length} transaction{payments.length !== 1 ? "s" : ""}
              </span>
              <span className="text-white/40 text-xs">
                Filtered total: <span className="text-cyan-400 font-medium">{fmt(filteredTotal)}</span>
                {" "}/ <span className="text-emerald-400 font-medium">{fmt(totalPaid)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Payment list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {filteredPayments.length === 0 ? (
            <div className="py-10 text-center text-white/30 text-sm">
              <Receipt className="w-8 h-8 mx-auto mb-2 opacity-20" />
              {payments.length === 0 ? "No payment transactions recorded yet." : "No transactions match the current filters."}
            </div>
          ) : (
            <div className="space-y-2 pr-1">
              {filteredPayments.map((p, idx) => (
                <div key={p.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-white/30 text-xs font-mono shrink-0">#{idx + 1}</span>
                      <div className="min-w-0">
                        <p className="text-white font-semibold text-sm">{fmt(p.amount)}</p>
                        <p className="text-white/50 text-xs mt-0.5">{fmtDate(p.receivedDate)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-cyan-900/40 border border-cyan-700/40 text-cyan-300">
                        {methodLabel[p.paymentMethod] ?? p.paymentMethod}
                      </span>
                      <Button size="icon" variant="ghost"
                        onClick={() => window.open(`/api/admin/fees/payments/${p.id}/receipt`, "_blank")}
                        className="h-6 w-6 text-white/30 hover:text-cyan-400"
                        title="Print receipt">
                        <Printer className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  {(p.referenceNumber || p.cashierNotes) && (
                    <div className="mt-2 pt-2 border-t border-white/5 space-y-0.5">
                      {p.referenceNumber && (
                        <p className="text-white/40 text-xs">Ref: <span className="text-white/60 font-mono">{p.referenceNumber}</span></p>
                      )}
                      {p.cashierNotes && (
                        <p className="text-white/40 text-xs">Note: <span className="text-white/60">{p.cashierNotes}</span></p>
                      )}
                    </div>
                  )}
                  <p className="text-white/20 text-[10px] mt-1.5 font-mono">{p.receiptNumber ?? `PAY-${p.id}`}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 pt-2 border-t border-white/10 flex justify-between items-center gap-2 flex-wrap">
          {!isFiltered && (
            <span className="text-white/40 text-xs">{payments.length} transaction{payments.length !== 1 ? "s" : ""}</span>
          )}
          {isFiltered && <span />}
          <div className="flex items-center gap-2 ml-auto">
            {filteredPayments.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={exportToCSV}
                  className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20 h-8 gap-1.5 text-xs"
                  title="Download filtered payments as CSV"
                >
                  <Download className="w-3.5 h-3.5" /> CSV
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={exportToPDF}
                  className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-900/20 h-8 gap-1.5 text-xs"
                  title="Print / save as PDF"
                >
                  <FileText className="w-3.5 h-3.5" /> PDF
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={onClose} className="text-white/60 h-8 text-sm">Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const NOTIF_CHANNEL_ICONS: Record<string, React.ReactNode> = {
  sms:      <MessageSquare className="w-3.5 h-3.5" />,
  whatsapp: <Phone className="w-3.5 h-3.5" />,
  email:    <Mail className="w-3.5 h-3.5" />,
};
const feeFormSchema = z.object({
  studentId: z.string().min(1, "Select a student"),
  feeType: z.string().min(1, "Fee type is required"),
  amount: z.string().min(1, "Amount is required").refine(v => !isNaN(Number(v)) && Number(v) > 0, "Must be a positive number"),
  dueDate: z.string().optional(),
  status: z.enum(["Due", "Paid", "Overdue", "Partial", "Waived"]),
  paidDate: z.string().optional(),
  receiptNumber: z.string().optional(),
  notes: z.string().optional(),
  academicYear: z.string().optional(),
}).superRefine((val, ctx) => {
  const noDeadlineNeeded = val.status === "Paid" || val.status === "Waived";
  if (!noDeadlineNeeded && !val.dueDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Due date is required", path: ["dueDate"] });
  }
});
type FeeFormValues = z.infer<typeof feeFormSchema>;

// ─── Ledger Tab ───────────────────────────────────────────────────────────────

// ─── Export Ledger Dialog ─────────────────────────────────────────────────────

interface ExportLedgerDialogProps {
  availableFeeNames: string[];
  open: boolean;
  onClose: () => void;
  availableClasses: string[];
  availableFeeTypes: string[];
}

function ExportLedgerDialog({ open, onClose, availableClasses, availableFeeTypes, availableFeeNames }: ExportLedgerDialogProps) {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [cls, setCls] = useState("");
  const [feeType, setFeeType] = useState("");
  const [feeName, setFeeName] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!open) {
      setDateFrom(""); setDateTo(""); setCls(""); setFeeType(""); setFeeName(""); setIsDownloading(false);
    }
  }, [open]);

  async function handleExport() {
    setIsDownloading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo)   params.set("dateTo",   dateTo);
      if (cls)      params.set("class",    cls);
      if (feeType)  params.set("feeType",  feeType);
      if (feeName)  params.set("feeName",  feeName);

      const url = `/api/admin/fees/export-ledger${params.size ? "?" + params.toString() : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as any).message ?? "Export failed");
      }
      const blob = await r.blob();
      const dateTag = new Date().toISOString().split("T")[0];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `payment-ledger-${dateTag}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast({ title: "Ledger exported", description: "CSV downloaded successfully." });
      onClose();
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-400">
            <Download className="w-5 h-5" />
            Export School-wide Ledger
          </DialogTitle>
        </DialogHeader>

        <p className="text-white/50 text-sm">
          Downloads a CSV with every fee record and its aggregated payment totals. Use filters to narrow the slice.
        </p>

        <div className="space-y-4">
          {/* Date range */}
          <div>
            <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">Due Date Range</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/60 mb-1 block">From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 [color-scheme:dark]" />
              </div>
              <div>
                <label className="text-xs text-white/60 mb-1 block">To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 [color-scheme:dark]" />
              </div>
            </div>
          </div>

          {/* Class filter */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">Class</label>
            <select value={cls} onChange={e => setCls(e.target.value)}
              className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
              <option value="">All Classes</option>
              {availableClasses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Fee Name filter */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">Fee Name</label>
            <select value={feeName} onChange={e => setFeeName(e.target.value)}
              className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
              <option value="">All Fee Names</option>
              {availableFeeNames.map(fn => <option key={fn} value={fn}>{fn}</option>)}
            </select>
          </div>

          {/* Fee Type filter */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">Fee Type</label>
            <select value={feeType} onChange={e => setFeeType(e.target.value)}
              className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
              <option value="">All Fee Types</option>
              {availableFeeTypes.map(ft => <option key={ft} value={ft}>{ft}</option>)}
            </select>
          </div>

          {/* Active filters summary */}
          {(dateFrom || dateTo || cls || feeName || feeType) && (
            <div className="px-3 py-2 rounded-lg bg-emerald-900/20 border border-emerald-700/30 text-xs text-emerald-400 space-y-0.5">
              <p className="font-semibold mb-1">Active filters:</p>
              {dateFrom && <p>Due from: {new Date(dateFrom).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>}
              {dateTo   && <p>Due to: {new Date(dateTo).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>}
              {cls      && <p>Class: {cls}</p>}
              {feeName  && <p>Fee Name: {feeName}</p>}
              {feeType  && <p>Fee Type: {feeType}</p>}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" onClick={onClose} className="text-white/60">Cancel</Button>
            <Button onClick={handleExport} disabled={isDownloading}
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2">
              {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Download CSV
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ledger Tab ───────────────────────────────────────────────────────────────

function LedgerTab({ canRecord, isArchiveMode, students, viewSessionId }: {
  canRecord: boolean; isArchiveMode: boolean; students: StudentItem[]; viewSessionId: number | null;
}) {
  const { toast } = useToast();
  const { selectedSession } = useSessionView();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [feeNameFilter, setFeeNameFilter] = useState("all");
  const [feeTypeFilter, setFeeTypeFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [addFeeSuccessId, setAddFeeSuccessId] = useState<number | null>(null);
  const [showExportLedger, setShowExportLedger] = useState(false);
  const [editing, setEditing] = useState<FeeRecordWithStudent | null>(null);
  const [payTarget, setPayTarget] = useState<FeeRecordWithStudent | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showStandalonePay, setShowStandalonePay] = useState(false);
  const [showPaymentsModal, setShowPaymentsModal] = useState(false);
  const [viewPaymentsRecord, setViewPaymentsRecord] = useState<FeeRecordWithStudent | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifStudentId, setNotifStudentId] = useState<number | null>(null);
  const [notifStudentName, setNotifStudentName] = useState<string | null>(null);
  const [studentSearchCls, setStudentSearchCls] = useState("");
  const [studentSearchQ, setStudentSearchQ] = useState("");
  const [studentResults, setStudentResults] = useState<StudentItem[] | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);

  const { data: feeRecords = [], isLoading } = useQuery<FeeRecordWithStudent[]>({
    queryKey: ["/api/admin/fees", viewSessionId],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees");
      if (!r.ok) throw new Error("Failed to fetch fee records");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  // Fee structures — used for "Fee Name" picker in Add Fee form
  const { data: feeStructures = [] } = useQuery<FeeStructure[]>({
    queryKey: ["/api/admin/fees/structures"],
    staleTime: 300_000,
  });
  const activeStructures = useMemo(() => feeStructures.filter(s => s.isActive), [feeStructures]);
  // Structures filtered to the currently selected student's class (or all if no student / no class restriction)
  const structuresForStudent = useMemo(() => {
    const cls = selectedStudent?.class ?? null;
    return activeStructures.filter(s =>
      s.applicableClasses.length === 0 || (cls && s.applicableClasses.includes(cls))
    );
  }, [activeStructures, selectedStudent]);
  // Map feeType (normalized: trim+lowercase) → structure name.
  // Used as a client-side fallback when the server-side feeName field is absent
  // (e.g. stale React Query cache from before the field was added).
  const feeTypeToName = useMemo(() => {
    const m = new Map<string, string>();
    activeStructures.forEach(s => {
      const key = s.feeType.trim().toLowerCase();
      if (!m.has(key)) m.set(key, s.name);
    });
    return m;
  }, [activeStructures]);

  // Resolve display name for a fee record: prefer server-supplied feeName,
  // fall back to client-side map, then raw feeType. || catches empty strings too.
  const resolveFeeDisplayName = useCallback(
    (rec: { feeType: string; feeName?: string }) =>
      rec.feeName || feeTypeToName.get(rec.feeType.trim().toLowerCase()) || rec.feeType || "—",
    [feeTypeToName],
  );

  // Dunning counts — per-student reminder counts for the bell badge
  const { data: dunningCounts = {} } = useQuery<Record<number, number>>({
    queryKey: ["/api/admin/fees/dunning-counts", viewSessionId],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/dunning-counts");
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: 30_000,
  });

  // Payment records — used for "Offline Payment" filter + method badge
  const { data: paymentRecordsList = [] } = useQuery<PaymentRecord[]>({
    queryKey: ["/api/admin/fees/payments"],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/payments");
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 30_000,
  });
  // Map feeRecordId → most recent payment method (for badge display).
  // Exclude auto-created records so "Add Fee" rows never show a Cash/method badge.
  const paymentMethodMap = useMemo(() => {
    const map = new Map<number, string>();
    // Sort oldest-first so the last write wins (most recent payment method)
    [...paymentRecordsList]
      .filter(p => p.cashierNotes !== "Auto-recorded from Add Fee Record")
      .sort((a, b) => a.id - b.id)
      .forEach(p => { if (p.feeRecordId != null) map.set(p.feeRecordId, p.paymentMethod); });
    return map;
  }, [paymentRecordsList]);
  // Set of feeRecordIds that have at least one explicitly recorded offline payment
  const offlinePaidIds = useMemo(
    () => new Set(
      paymentRecordsList
        .filter(p => p.feeRecordId != null && p.cashierNotes !== "Auto-recorded from Add Fee Record")
        .map(p => p.feeRecordId as number)
    ),
    [paymentRecordsList]
  );
  // Map feeRecordId → all payment records (sorted newest-first) for the history modal
  const paymentsByFeeRecordId = useMemo(() => {
    const map = new Map<number, PaymentRecord[]>();
    [...paymentRecordsList]
      .sort((a, b) => b.id - a.id)
      .forEach(p => {
        if (p.feeRecordId == null) return;
        const existing = map.get(p.feeRecordId) ?? [];
        existing.push(p);
        map.set(p.feeRecordId, existing);
      });
    return map;
  }, [paymentRecordsList]);

  // Preview next AF receipt number — peek only, no DB write
  const { data: afPreviewData } = useQuery<{ preview: string }>({
    queryKey: ["/api/admin/fees/next-receipt", "AF", showForm],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/next-receipt?prefix=AF");
      if (!r.ok) return { preview: "AF—" };
      return r.json();
    },
    enabled: showForm && !editing,
    staleTime: 0,
  });
  const afPreview = afPreviewData?.preview ?? "…";

  const form = useForm<FeeFormValues>({
    resolver: zodResolver(feeFormSchema),
    defaultValues: { studentId: "", feeType: "", amount: "", dueDate: "", status: "Due", paidDate: "", receiptNumber: "", notes: "", academicYear: "" },
  });
  const watchStatus = form.watch("status");
  const dueDateNotNeeded = watchStatus === "Paid" || watchStatus === "Waived";

  // Auto-clear due date when status makes it irrelevant
  useEffect(() => {
    if (dueDateNotNeeded) form.setValue("dueDate", "");
  }, [dueDateNotNeeded]);

  const createMut = useMutation({
    mutationFn: async (data: FeeFormValues) => {
      const res = await apiRequest("POST", "/api/admin/fees", {
        studentId: Number(data.studentId), feeType: data.feeType, amount: Number(data.amount),
        dueDate: data.dueDate, status: data.status, paidDate: data.paidDate || null,
        receiptNumber: data.receiptNumber || null, notes: data.notes || null, academicYear: data.academicYear || null,
      });
      return res.json();
    },
    onSuccess: (rec: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
      form.reset();
      setAddFeeSuccessId(rec?.id ?? null);
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

  const { data: ledgerSchoolConfig } = useQuery<{ classes: string[] }>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      if (!r.ok) return { classes: [] };
      return r.json();
    },
    staleTime: 300_000,
  });
  // Prefer school-setup classes; fall back to distinct classes of enrolled students
  const studentClasses: string[] = (ledgerSchoolConfig?.classes ?? []).length > 0
    ? ledgerSchoolConfig!.classes
    : [...new Set(students.filter(s => s.isActive).map(s => s.class))].sort();

  function runStudentSearch() {
    const q = studentSearchQ.toLowerCase().trim();
    setStudentResults(students.filter(s => {
      if (!s.isActive) return false;
      if (studentSearchCls && s.class !== studentSearchCls) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.digitalStudentId.toLowerCase().includes(q)) return false;
      return true;
    }));
  }

  function pickStudent(s: StudentItem) {
    setSelectedStudent(s);
    form.setValue("studentId", String(s.id), { shouldValidate: true });
    setStudentResults(null);
  }

  function clearStudentPick() {
    setSelectedStudent(null);
    setStudentSearchCls(""); setStudentSearchQ(""); setStudentResults(null);
    form.setValue("studentId", "", { shouldValidate: false });
  }

  const filtered = useMemo(() => feeRecords.filter(r => {
    const q = search.toLowerCase();
    const ms = !q ||
      (r.student?.name ?? "").toLowerCase().includes(q) ||
      r.feeType.toLowerCase().includes(q) ||
      (r.student?.digitalStudentId ?? "").toLowerCase().includes(q) ||
      (r.receiptNumber ?? "").toLowerCase().includes(q);
    const statusMatch = statusFilter === "all"
      ? true
      : statusFilter === "offline"
        ? offlinePaidIds.has(r.id)
        : r.status === statusFilter;
    const classMatch    = classFilter   === "all" || r.student?.class === classFilter;
    const feeTypeMatch  = feeTypeFilter === "all" || r.feeType === feeTypeFilter;
    const feeNameMatch  = feeNameFilter === "all" || resolveFeeDisplayName(r) === feeNameFilter;
    return ms && statusMatch && classMatch && feeTypeMatch && feeNameMatch;
  }), [feeRecords, search, statusFilter, classFilter, feeTypeFilter, feeNameFilter, offlinePaidIds, resolveFeeDisplayName]);

  // Distinct fee names from all loaded records — uses resolver so stale cache still populates list
  const allFeeNames = useMemo(() =>
    [...new Set(feeRecords.map(r => resolveFeeDisplayName(r)))].filter(Boolean).sort(),
    [feeRecords, resolveFeeDisplayName]);

  // Distinct fee types from all loaded records (for the export dialog filter)
  const allFeeTypes = useMemo(() =>
    [...new Set(feeRecords.map(r => r.feeType))].sort(),
    [feeRecords]);

  function openCreate() {
    setEditing(null);
    form.reset({ studentId: "", feeType: "", amount: "", dueDate: "", status: "Due", paidDate: "", receiptNumber: "", notes: "", academicYear: selectedSession?.sessionName ?? "" });
    setSelectedStudent(null); setStudentSearchCls(""); setStudentSearchQ(""); setStudentResults(null);
    setShowForm(true);
  }

  function openEdit(rec: FeeRecordWithStudent) {
    setEditing(rec);
    form.reset({ studentId: String(rec.studentId), feeType: rec.feeType, amount: String(rec.amount), dueDate: rec.dueDate, status: rec.status as any, paidDate: rec.paidDate ?? "", receiptNumber: rec.receiptNumber ?? "", notes: rec.notes ?? "", academicYear: rec.academicYear ?? "" });
    setSelectedStudent(students.find(s => s.id === rec.studentId) ?? null);
    setStudentSearchCls(""); setStudentSearchQ(""); setStudentResults(null);
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, ID, fee type or receipt no…"
            className="w-full bg-[#1A2942] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 min-w-28">
          <option value="all">All Status</option>
          {["Due","Paid","Overdue","Partial","Waived"].map(s => <option key={s} value={s}>{s}</option>)}
          <option value="offline">Offline Payment</option>
        </select>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
          className="bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 min-w-28">
          <option value="all">All Classes</option>
          {classes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={feeNameFilter} onChange={e => setFeeNameFilter(e.target.value)}
          className="bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 min-w-32">
          <option value="all">All Fee Names</option>
          {allFeeNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={feeTypeFilter} onChange={e => setFeeTypeFilter(e.target.value)}
          className="bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 min-w-32">
          <option value="all">All Fee Types</option>
          {allFeeTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => setShowExportLedger(true)}
            className="border-emerald-700 text-emerald-400 hover:bg-emerald-900/30 gap-1">
            <Download className="w-4 h-4" /> Export Ledger
          </Button>
          {canRecord && !isArchiveMode && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowStandalonePay(true)}
                className="border-cyan-700 text-cyan-400 hover:bg-cyan-900/30 gap-1">
                <Banknote className="w-4 h-4" /> Record Offline Payment
              </Button>
              <Button size="sm" onClick={openCreate} className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1">
                <Plus className="w-4 h-4" /> Add Fee
              </Button>
            </>
          )}
        </div>
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
                  {["Receipt No.","Student","Class","Section","Fee Name","Fee Type","Amount","Due Date","Status","Paid On","Acad. Year","Notes","Actions"].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-white/50 font-medium text-xs ${i === 6 ? "text-right" : i >= 12 ? "text-right" : i >= 7 ? "text-center" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(rec => (
                  <tr key={rec.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    {/* Receipt */}
                    <td className="px-4 py-3 text-left">
                      {rec.receiptNumber
                        ? <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-cyan-700/30 text-cyan-300">{rec.receiptNumber}</span>
                        : <span className="text-white/20 text-xs">—</span>}
                    </td>
                    {/* Student */}
                    <td className="px-4 py-3">
                      <p className="text-white font-medium leading-tight text-sm">{rec.student?.name ?? "—"}</p>
                      <p className="text-white/40 text-xs">{rec.student?.digitalStudentId ?? "—"}</p>
                    </td>
                    {/* Class */}
                    <td className="px-4 py-3 text-white/70 text-xs text-center">{rec.student?.class ?? "—"}</td>
                    {/* Section */}
                    <td className="px-4 py-3 text-white/70 text-xs text-center">{rec.student?.section ?? "—"}</td>
                    <td className="px-4 py-3 text-white/80 text-sm">{resolveFeeDisplayName(rec)}</td>
                    <td className="px-4 py-3 text-white/70 text-xs">{rec.feeType}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">
                      {(rec as any).lateFeeAmount > 0 ? (
                        <div className="text-right leading-tight space-y-0.5">
                          <p className="text-white/50 text-xs">Base {fmt(rec.amount)}</p>
                          <p className="text-amber-400 text-xs">+{fmt((rec as any).lateFeeAmount)} fine</p>
                          <p className="font-black text-white text-sm">{fmt(rec.amount + (rec as any).lateFeeAmount)}</p>
                        </div>
                      ) : fmt(rec.amount)}
                    </td>
                    <td className="px-4 py-3 text-center text-white/50 text-xs">{fmtDate(rec.dueDate)}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusChip status={rec.status} />
                      {paymentMethodMap.has(rec.id) && (
                        <span className="mt-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-cyan-900/40 border border-cyan-700/40 text-cyan-300">
                          {paymentMethodMap.get(rec.id) === "BankTransfer" ? "Bank" :
                           paymentMethodMap.get(rec.id) === "DemandDraft" ? "DD" :
                           paymentMethodMap.get(rec.id)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-white/50 text-xs">{fmtDate(rec.paidDate)}</td>
                    <td className="px-4 py-3 text-center text-white/50 text-xs">{rec.academicYear ?? "—"}</td>
                    <td className="px-4 py-3 text-left text-white/50 text-xs max-w-[100px] truncate" title={rec.notes ?? ""}>{rec.notes || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canRecord && !isArchiveMode && rec.status !== "Paid" && rec.status !== "Waived" && (
                          <Button size="sm" variant="ghost" onClick={() => openRecordPayment(rec)}
                            className="h-7 px-2 text-xs text-cyan-400 hover:bg-cyan-900/30 gap-1">
                            <Receipt className="w-3 h-3" /> Pay
                          </Button>
                        )}
                        {(() => {
                          const count = paymentsByFeeRecordId.get(rec.id)?.length ?? 0;
                          const hasPayments = count > 0;
                          return (
                            <Button size="sm" variant="ghost"
                              onClick={() => { setViewPaymentsRecord(rec); setShowPaymentsModal(true); }}
                              className={`h-7 px-2 text-xs gap-1 ${hasPayments ? "text-purple-400 hover:bg-purple-900/30" : "text-white/20 hover:bg-white/5 hover:text-white/40"}`}
                              title={hasPayments ? "View payment transactions" : "No transactions recorded"}>
                              <History className="w-3 h-3" />
                              <span>{count}</span>
                            </Button>
                          );
                        })()}
                        {(() => {
                          const dCount = dunningCounts[rec.id] ?? 0;
                          const hasDunning = dCount > 0;
                          return (
                            <Button size="sm" variant="ghost"
                              onClick={() => {
                                setNotifStudentId(rec.studentId);
                                setNotifStudentName(rec.student?.name ?? null);
                                setShowNotifModal(true);
                              }}
                              className={`h-7 px-2 text-xs gap-1 ${hasDunning ? "text-violet-400 hover:bg-violet-900/30" : "text-white/20 hover:bg-white/5 hover:text-white/40"}`}
                              title={hasDunning ? `${dCount} reminder${dCount !== 1 ? "s" : ""} sent` : "No reminders sent yet"}>
                              <Bell className="w-3 h-3" />
                              <span>{dCount}</span>
                            </Button>
                          );
                        })()}
                        {(() => {
                          // Prefer the most recent offline (OP) payment receipt;
                          // fall back to the fee-record (AF) receipt for Add Fee entries.
                          const offlinePayment = (paymentsByFeeRecordId.get(rec.id) ?? [])
                            .find(p => p.cashierNotes !== "Auto-recorded from Add Fee Record");
                          if (offlinePayment) {
                            return (
                              <Button size="icon" variant="ghost"
                                onClick={() => window.open(`/api/admin/fees/payments/${offlinePayment.id}/receipt`, "_blank")}
                                className="h-7 w-7 text-white/40 hover:text-cyan-400"
                                title={`Print offline receipt ${offlinePayment.receiptNumber ?? ""}`}>
                                <Printer className="w-3.5 h-3.5" />
                              </Button>
                            );
                          }
                          // Show AF fee-record receipt for any Paid / Partial / Waived record
                          if (rec.status === "Paid" || rec.status === "Partial" || rec.status === "Waived") {
                            return (
                              <Button size="icon" variant="ghost"
                                onClick={() => window.open(`/api/admin/fees/${rec.id}/receipt`, "_blank")}
                                className="h-7 w-7 text-white/40 hover:text-cyan-400"
                                title={`Print receipt ${rec.receiptNumber ?? ""}`}>
                                <Printer className="w-3.5 h-3.5" />
                              </Button>
                            );
                          }
                          return null;
                        })()}
                        {canRecord && !isArchiveMode && (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => openEdit(rec)} className="h-7 w-7 text-white/40 hover:text-white">
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setConfirmDeleteId(rec.id)} className="h-7 w-7 text-white/40 hover:text-red-400">
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
      <RecordPaymentModal open={showPay} onClose={() => { setShowPay(false); setPayTarget(null); }} feeRecord={payTarget} students={students} existingFeeRecords={feeRecords} />
      <RecordPaymentModal open={showStandalonePay} onClose={() => setShowStandalonePay(false)} feeRecord={null} students={students} existingFeeRecords={feeRecords} />
      <PaymentHistoryModal
        open={showPaymentsModal}
        onClose={() => { setShowPaymentsModal(false); setViewPaymentsRecord(null); }}
        feeRecord={viewPaymentsRecord}
      />
      <ExportLedgerDialog
        open={showExportLedger}
        onClose={() => setShowExportLedger(false)}
        availableClasses={classes}
        availableFeeTypes={allFeeTypes}
        availableFeeNames={allFeeNames}
      />
      <NotificationHistoryModal
        open={showNotifModal}
        onClose={() => { setShowNotifModal(false); setNotifStudentId(null); setNotifStudentName(null); }}
        studentId={notifStudentId}
        studentName={notifStudentName}
      />

      {/* Delete confirmation */}
      <Dialog open={confirmDeleteId !== null} onOpenChange={v => { if (!v) setConfirmDeleteId(null); }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <Trash2 className="w-4 h-4" /> Delete Fee Record
            </DialogTitle>
          </DialogHeader>
          <p className="text-white/70 text-sm">Are you sure you want to delete this fee record? This action cannot be undone.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" className="text-white/60" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => {
                if (confirmDeleteId !== null) {
                  deleteMut.mutate(confirmDeleteId, {
                    onSuccess: () => setConfirmDeleteId(null),
                    onError: () => setConfirmDeleteId(null),
                  });
                }
              }}
            >
              {deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); setEditing(null); setAddFeeSuccessId(null); } }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-cyan-400">{editing ? "Edit Fee Record" : "Add Fee Record"}</DialogTitle>
          </DialogHeader>
          {addFeeSuccessId !== null ? (
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-xl bg-emerald-900/20 border border-emerald-700/40 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <p className="text-emerald-400 font-semibold text-lg">Fee Added</p>
                <p className="text-white/60 text-sm mt-1">The fee record has been saved successfully.</p>
              </div>
              <Button
                className="w-full bg-white/10 hover:bg-white/20 text-white gap-2"
                onClick={() => window.open(`/api/admin/fees/${addFeeSuccessId}/receipt`, "_blank")}
              >
                <Printer className="w-4 h-4" /> Print Receipt
              </Button>
              <Button className="w-full bg-cyan-600 hover:bg-cyan-500 text-white" onClick={() => { setShowForm(false); setAddFeeSuccessId(null); }}>
                Done
              </Button>
            </div>
          ) : (
          <>
          {!editing && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-white/10">
              <span className="text-white/40 text-xs">Receipt No.</span>
              <span className="font-mono text-sm text-cyan-300 font-semibold tracking-wider">{afPreview}</span>
              <span className="text-white/20 text-[10px] ml-auto">auto-assigned on save</span>
            </div>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => editing ? updateMut.mutate({ id: editing.id, data: d }) : createMut.mutate(d))} className="space-y-4">
              {/* ── Student search & select ── */}
              <FormField control={form.control} name="studentId" render={() => (
                <FormItem>
                  <FormLabel className="text-white/70">Student</FormLabel>
                  {selectedStudent ? (
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-cyan-500/50 bg-cyan-900/20">
                      <div>
                        <p className="text-white text-sm font-medium">{selectedStudent.name}</p>
                        <p className="text-white/40 text-xs">{selectedStudent.digitalStudentId} · Class {selectedStudent.class}-{selectedStudent.section}</p>
                      </div>
                      {!editing && (
                        <button type="button" onClick={clearStudentPick} className="text-white/30 hover:text-white/70 ml-3 text-lg leading-none">✕</button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <select value={studentSearchCls} onChange={e => setStudentSearchCls(e.target.value)}
                          className="bg-[#0A1628] border border-white/20 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 w-28 flex-shrink-0">
                          <option value="">All Classes</option>
                          {studentClasses.map(c => <option key={c} value={c}>Class {c}</option>)}
                        </select>
                        <input value={studentSearchQ} onChange={e => setStudentSearchQ(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); runStudentSearch(); } }}
                          placeholder="Name or Student ID…"
                          className="flex-1 bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 min-w-0" />
                        <button type="button" onClick={runStudentSearch}
                          className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium flex-shrink-0">
                          Search
                        </button>
                      </div>
                      {studentResults !== null && (
                        studentResults.length === 0 ? (
                          <p className="text-white/30 text-xs text-center py-3">No students found.</p>
                        ) : (
                          <div className="rounded-lg border border-white/10 overflow-hidden max-h-44 overflow-y-auto">
                            {studentResults.map(s => (
                              <button key={s.id} type="button" onClick={() => pickStudent(s)}
                                className="w-full text-left px-3 py-2.5 hover:bg-cyan-900/30 border-b border-white/5 last:border-0 transition-colors">
                                <p className="text-white text-sm">{s.name}</p>
                                <p className="text-white/40 text-xs">{s.digitalStudentId} · Class {s.class}-{s.section}</p>
                              </button>
                            ))}
                          </div>
                        )
                      )}
                    </div>
                  )}
                  <FormMessage className="text-red-400" />
                </FormItem>
              )} />
              {/* Fee Name picker — filtered to selected student's class */}
              {structuresForStudent.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-white/70 block mb-1.5">Fee Name</label>
                  <select
                    onChange={e => {
                      const s = structuresForStudent.find(s => String(s.id) === e.target.value);
                      if (s) {
                        form.setValue("feeType", s.feeType, { shouldValidate: true });
                        form.setValue("amount", String(s.amount), { shouldValidate: true });
                      }
                    }}
                    className="w-full bg-[#0A1628] border border-white/20 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                    <option value="">— Select fee name —</option>
                    {structuresForStudent.map(s => (
                      <option key={s.id} value={s.id}>{s.name} · ₹{s.amount.toLocaleString("en-IN")}</option>
                    ))}
                  </select>
                </div>
              )}
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
                      <Input {...field} type="text" inputMode="numeric" placeholder="0" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" />
                    </FormControl>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                <FormField control={form.control} name="dueDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel className={dueDateNotNeeded ? "text-white/30" : "text-white/70"}>
                      Due Date {dueDateNotNeeded && <span className="font-normal text-xs">(not required)</span>}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} type="date" disabled={dueDateNotNeeded}
                        className={`bg-[#0A1628] border-white/20 text-white [color-scheme:dark] ${dueDateNotNeeded ? "opacity-40 cursor-not-allowed" : ""}`} />
                    </FormControl>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )} />
              </div>
              {(watchStatus === "Paid" || watchStatus === "Partial") && (
                <FormField control={form.control} name="paidDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Paid Date</FormLabel>
                    <FormControl><Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white" /></FormControl>
                  </FormItem>
                )} />
              )}
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="academicYear" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Academic Year</FormLabel>
                    <FormControl><Input {...field} readOnly className="bg-[#0A1628] border-white/10 text-white/60 cursor-default select-none" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70">Notes</FormLabel>
                    <FormControl><Input {...field} placeholder="" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" /></FormControl>
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
          </>
          )}
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
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [autoGenDueDay, setAutoGenDueDay] = useState("");
  const [breakdown, setBreakdown] = useState<Array<{ name: string; purpose: string; amount: string }>>([]);

  // ── Late Fee state ────────────────────────────────────────────────────────
  const [lateFeeEnabled, setLateFeeEnabled] = useState(false);
  const [lateFeeType, setLateFeeType] = useState<"NONE" | "FLAT" | "DAILY" | "TIERED">("NONE");
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState("0");
  const [lateFeeFlat, setLateFeeFlat] = useState("0");
  const [lateFeeDailyRate, setLateFeeDailyRate] = useState("0");
  const [lateFeeCap, setLateFeeCap] = useState("0");
  const [lateFeeSlabs, setLateFeeSlabs] = useState<Array<{ from_day: string; to_day: string; amount: string }>>([]);

  function addBreakdownRow() {
    setBreakdown(prev => [...prev, { name: "", purpose: "", amount: "" }]);
  }
  function removeBreakdownRow(idx: number) {
    setBreakdown(prev => prev.filter((_, i) => i !== idx));
  }
  function updateBreakdownRow(idx: number, field: "name" | "purpose" | "amount", value: string) {
    setBreakdown(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  }
  const breakdownTotal = breakdown.reduce((s, r) => s + (parseInt(r.amount) || 0), 0);
  const amountNum = parseInt(amount) || 0;
  const breakdownMismatch = breakdown.length > 0 && breakdownTotal !== amountNum;

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
    setAutoGenerate(false); setAutoGenDueDay("");
    setBreakdown([]);
    setLateFeeEnabled(false); setLateFeeType("FLAT"); setLateFeeGraceDays("0");
    setLateFeeFlat("0"); setLateFeeDailyRate("0"); setLateFeeCap("0"); setLateFeeSlabs([]);
    setShowModal(true);
  }

  function openEdit(s: FeeStructure) {
    setEditing(s);
    setName(s.name); setFeeType(s.feeType); setAmount(String(s.amount)); setFrequency(s.frequency);
    setSelectedClasses([...s.applicableClasses]); setConcType(s.concessionType);
    setConcPct(String(s.concessionPercent));
    if (s.dueDayOfMonth) {
      const now = new Date();
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(Math.min(s.dueDayOfMonth, 28)).padStart(2, "0");
      setDueDay(`${y}-${mo}-${d}`);
    } else { setDueDay(""); }
    setIsActive(s.isActive);
    setAutoGenerate(!!(s as any).autoGenerate);
    setAutoGenDueDay((s as any).autoGenDueDay ? String((s as any).autoGenDueDay) : "");
    setBreakdown(((s as any).breakdown ?? []).map((b: any) => ({
      name: b.name ?? "", purpose: b.purpose ?? "", amount: String(b.amount ?? ""),
    })));
    const lfc = (s as any).lateFeeConfig ?? {};
    setLateFeeEnabled(!!lfc.enabled);
    setLateFeeType(lfc.type && lfc.type !== "NONE" ? lfc.type : "FLAT");
    setLateFeeGraceDays(String(lfc.grace_period_days ?? 0));
    setLateFeeFlat(String(lfc.flat_amount ?? 0));
    setLateFeeDailyRate(String(lfc.daily_rate ?? 0));
    setLateFeeCap(String(lfc.max_cap ?? 0));
    setLateFeeSlabs((lfc.tiered_slabs ?? []).map((sl: any) => ({
      from_day: String(sl.from_day ?? ""), to_day: String(sl.to_day ?? ""), amount: String(sl.amount ?? ""),
    })));
    setShowModal(true);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const parsedBreakdown = breakdown
        .filter(b => b.name.trim())
        .map(b => ({ name: b.name.trim(), purpose: b.purpose.trim(), amount: parseInt(b.amount) || 0 }));
      const payload = {
        name, feeType, amount: parseInt(amount), frequency,
        applicableClasses: selectedClasses,
        concessionType: concType, concessionPercent: parseInt(concPct) || 0,
        dueDayOfMonth: dueDay ? new Date(dueDay + "T00:00:00").getDate() : null, isActive,
        breakdown: parsedBreakdown,
        autoGenerate: frequency === "monthly" ? autoGenerate : false,
        autoGenDueDay: frequency === "monthly" && autoGenDueDay ? parseInt(autoGenDueDay) : null,
        lateFeeConfig: {
          enabled: lateFeeEnabled,
          type: lateFeeEnabled ? lateFeeType : "NONE",
          // Grace period only applies to DAILY (FLAT fires immediately; TIERED uses slab from_day)
          grace_period_days: (lateFeeEnabled && lateFeeType === "DAILY")
            ? (parseInt(lateFeeGraceDays) || 0) : 0,
          flat_amount: parseInt(lateFeeFlat) || 0,
          daily_rate: parseFloat(lateFeeDailyRate) || 0,
          // Max cap only applies to DAILY (0 = no cap)
          max_cap: (lateFeeEnabled && lateFeeType === "DAILY")
            ? (parseInt(lateFeeCap) || 0) : 0,
          tiered_slabs: lateFeeSlabs
            .filter(s => s.from_day && s.to_day && s.amount)
            .map(s => ({ from_day: parseInt(s.from_day), to_day: parseInt(s.to_day), amount: parseInt(s.amount) })),
        },
      };
      return editing
        ? apiRequest("PATCH", `/api/admin/fees/structures/${editing.id}`, payload)
        : apiRequest("POST", "/api/admin/fees/structures", payload);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/structures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      const synced = data?.syncedInvoices ?? 0;
      const fields: string[] = data?.syncedFields ?? [];
      toast({
        title: editing ? "Structure updated" : "Structure created",
        description: synced > 0
          ? `✅ ${synced} unpaid invoice${synced !== 1 ? "s" : ""} updated — ${fields.join(", ")}`
          : undefined,
      });
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

  // Manually trigger the auto-invoice job for a single structure right now
  const triggerAutoMut = useMutation({
    mutationFn: async (structureId: number) => {
      const r = await fetch(`/api/admin/fees/structures/${structureId}/auto-invoice/trigger`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Failed");
      return r.json() as Promise<{ created: number; synced: number; skipped: number; dueDate: string; session: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/structures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      const parts = [`${data.created} created`];
      if ((data.synced ?? 0) > 0) parts.push(`${data.synced} updated to latest amount`);
      if (data.skipped > 0) parts.push(`${data.skipped} unchanged`);
      toast({ title: `✅ Auto-invoice run complete`, description: `${parts.join(", ")} (due ${data.dueDate})` });
    },
    onError: (e: Error) => toast({ title: "Auto-invoice failed", description: e.message, variant: "destructive" }),
  });

  // ── Generate Invoices state ────────────────────────────────────────────────
  const [genTarget, setGenTarget] = useState<FeeStructure | null>(null);
  const [genSessionId, setGenSessionId] = useState("");
  const [genClasses, setGenClasses] = useState<string[]>([]);
  const [genDueDate, setGenDueDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [genResult, setGenResult] = useState<{ created: number; synced: number; skipped: number } | null>(null);

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
          // targetClasses is ignored by the backend — the structure's applicableClasses
          // are the single source of truth. We omit it to keep the payload clean.
          dueDate: genDueDate,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Failed");
      return r.json() as Promise<{ created: number; synced: number; skipped: number }>;
    },
    onSuccess: (data: { created: number; synced: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/structures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      const parts = [`${data.created} new`];
      if ((data.synced ?? 0) > 0) parts.push(`${data.synced} updated to latest amount`);
      if (data.skipped > 0) parts.push(`${data.skipped} unchanged`);
      toast({ title: "✅ Invoices generated", description: parts.join(", ") });
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
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${s.isActive ? "bg-emerald-900/30 text-emerald-400 border-emerald-700/30" : "bg-white/5 text-white/30 border-white/10"}`}>
                    {s.isActive ? "Active" : "Inactive"}
                  </span>
                  {(s as any).autoGenerate && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 border border-emerald-700/30 font-bold flex items-center gap-1">
                      ⚙ Auto
                    </span>
                  )}
                </div>
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
                {s.lastInvoicesGeneratedAt && (
                  <div className="col-span-2">
                    <p className="text-white/40 mb-0.5">Last Invoices Generated</p>
                    <p className="text-emerald-400/80 text-[11px]">
                      🕐 {new Date(s.lastInvoicesGeneratedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                )}
              </div>
              {!isArchiveMode && (
                <div className="space-y-1 pt-1 border-t border-white/10">
                  <Button size="sm" variant="ghost" onClick={() => openGenInvoices(s)}
                    className="w-full text-cyan-400 hover:bg-cyan-900/30 text-xs h-7 gap-1 border border-cyan-700/30">
                    <Printer className="w-3 h-3" /> Generate Invoices
                  </Button>
                  {(s as any).autoGenerate && (
                    <Button size="sm" variant="ghost"
                      onClick={() => triggerAutoMut.mutate(s.id)}
                      disabled={triggerAutoMut.isPending && triggerAutoMut.variables === s.id}
                      className="w-full text-emerald-400 hover:bg-emerald-900/30 text-xs h-7 gap-1 border border-emerald-700/30">
                      {triggerAutoMut.isPending && triggerAutoMut.variables === s.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <span>⚙</span>}
                      Run Auto-Invoice Now
                    </Button>
                  )}
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
                <select value={frequency} onChange={e => {
                  setFrequency(e.target.value);
                  if (e.target.value !== "monthly") {
                    setAutoGenerate(false);
                    setAutoGenDueDay("");
                  }
                }}
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
                <label className="text-xs text-white/60 mb-1 block">Due Date</label>
                <input type="date" value={dueDay} onChange={e => setDueDay(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                {dueDay && (
                  <p className="text-white/40 text-xs mt-1">Day {new Date(dueDay + "T00:00:00").getDate()} of each month</p>
                )}
              </div>
            </div>

            {/* ── Late Fee & Penalty Settings ────────────────────────────── */}
            <div className={`rounded-xl border p-4 space-y-3 transition-all ${lateFeeEnabled ? "border-amber-600/40 bg-amber-900/10" : "border-white/10 bg-white/5"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Switch checked={lateFeeEnabled} onCheckedChange={v => {
        setLateFeeEnabled(v);
        // Ensure a concrete rule type is selected when turning on
        if (v && (lateFeeType === "NONE" || !lateFeeType)) setLateFeeType("FLAT");
      }} />
                  <div>
                    <p className="text-sm font-semibold text-white/80">Late Fee &amp; Penalty</p>
                    <p className="text-xs text-white/40 leading-tight">Automatically fine overdue invoices</p>
                  </div>
                </div>
                {lateFeeEnabled && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-700/40 flex-shrink-0">
                    ACTIVE
                  </span>
                )}
              </div>

              {lateFeeEnabled && (
                <div className="pt-2 border-t border-white/10 space-y-3">
                  {/* Rule Type */}
                  <div>
                    <label className="text-xs text-white/50 block mb-1">Rule Type</label>
                    <select value={lateFeeType} onChange={e => setLateFeeType(e.target.value as any)}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
                      <option value="FLAT">Flat One-Time Penalty</option>
                      <option value="DAILY">Daily Accumulating Fine</option>
                      <option value="TIERED">Tiered Schedule</option>
                    </select>
                  </div>

                  {/* Flat penalty */}
                  {lateFeeType === "FLAT" && (
                    <div>
                      <label className="text-xs text-white/50 block mb-1">Penalty Amount (₹)</label>
                      <input type="number" min={0} value={lateFeeFlat}
                        onChange={e => setLateFeeFlat(e.target.value)}
                        className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                    </div>
                  )}

                  {/* Daily rate */}
                  {lateFeeType === "DAILY" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-white/50 block mb-1">Grace Period (Days)</label>
                        <input type="number" min={0} value={lateFeeGraceDays}
                          onChange={e => setLateFeeGraceDays(e.target.value)}
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                      </div>
                      <div>
                        <label className="text-xs text-white/50 block mb-1">Daily Rate (₹/day)</label>
                        <input type="number" min={0} step="0.5" value={lateFeeDailyRate}
                          onChange={e => setLateFeeDailyRate(e.target.value)}
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                      </div>
                    </div>
                  )}

                  {/* Tiered slabs */}
                  {lateFeeType === "TIERED" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-white/50">Penalty Slabs</label>
                        <button type="button"
                          onClick={() => setLateFeeSlabs(prev => [...prev, { from_day: "", to_day: "", amount: "" }])}
                          className="text-xs px-2.5 py-0.5 rounded border border-amber-700/40 text-amber-400 hover:bg-amber-900/20 transition-all">
                          + Add Slab
                        </button>
                      </div>
                      {lateFeeSlabs.length > 0 && (
                        <div className="rounded-lg border border-white/10 overflow-hidden">
                          <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-3 py-1.5 bg-white/5 border-b border-white/10">
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">From Day</span>
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">To Day</span>
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Fine (₹)</span>
                            <span />
                          </div>
                          {lateFeeSlabs.map((slab, idx) => (
                            <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-3 py-2 border-b border-white/5 last:border-0 bg-[#0A1628]/60">
                              <input type="number" min={1} placeholder="e.g. 1" value={slab.from_day}
                                onChange={e => setLateFeeSlabs(prev => prev.map((s, i) => i === idx ? { ...s, from_day: e.target.value } : s))}
                                className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                              <input type="number" min={1} placeholder="e.g. 7" value={slab.to_day}
                                onChange={e => setLateFeeSlabs(prev => prev.map((s, i) => i === idx ? { ...s, to_day: e.target.value } : s))}
                                className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                              <input type="number" min={0} placeholder="e.g. 100" value={slab.amount}
                                onChange={e => setLateFeeSlabs(prev => prev.map((s, i) => i === idx ? { ...s, amount: e.target.value } : s))}
                                className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                              <button type="button" onClick={() => setLateFeeSlabs(prev => prev.filter((_, i) => i !== idx))}
                                className="flex items-center justify-center w-7 h-7 rounded hover:bg-red-900/30 text-white/30 hover:text-red-400 transition-all">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {lateFeeSlabs.length === 0 && (
                        <p className="text-[11px] text-white/25 px-1">
                          No slabs. Add slabs — e.g. Day 1–7: ₹100 fine, Day 8–14: ₹200 fine.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Max cap — only for Daily Accumulating Fine (spec: FLAT has no cap; TIERED uses slab amounts directly) */}
                  {lateFeeType === "DAILY" && (
                    <div>
                      <label className="text-xs text-white/50 block mb-1">
                        Maximum Cap (₹) <span className="text-white/30">— 0 = no cap</span>
                      </label>
                      <input type="number" min={0} value={lateFeeCap}
                        onChange={e => setLateFeeCap(e.target.value)}
                        className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                    </div>
                  )}

                  <p className="text-[11px] text-amber-400/60 leading-snug">
                    ⏰ The nightly cron recalculates fines for all overdue invoices under this structure automatically.
                  </p>
                </div>
              )}
            </div>

            {/* ── Fee Breakdown / Components ─────────────────────────────── */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white/60 flex items-center gap-1.5">
                  <span className="text-cyan-400">⊞</span> Fee Breakdown / Components
                  <span className="text-white/30 font-normal">(optional — shown to students)</span>
                </label>
                <button type="button" onClick={addBreakdownRow}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all hover:bg-cyan-900/40 border border-cyan-700/40 text-cyan-400">
                  <Plus className="w-3 h-3" /> Add Component
                </button>
              </div>

              {breakdown.length > 0 && (
                <div className="rounded-xl border border-white/10 overflow-hidden">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 bg-white/5 border-b border-white/10">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Component</span>
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Purpose / Description</span>
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide text-right">Amount ₹</span>
                    <span />
                  </div>
                  {breakdown.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 border-b border-white/5 last:border-0 bg-[#0A1628]/60">
                      <input
                        value={row.name}
                        onChange={e => updateBreakdownRow(idx, "name", e.target.value)}
                        placeholder="Lab Fee…"
                        className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full"
                      />
                      <input
                        value={row.purpose}
                        onChange={e => updateBreakdownRow(idx, "purpose", e.target.value)}
                        placeholder="Covers equipment & software…"
                        className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full"
                      />
                      <input
                        type="number"
                        value={row.amount}
                        onChange={e => updateBreakdownRow(idx, "amount", e.target.value)}
                        placeholder="0"
                        min={0}
                        className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full text-right"
                      />
                      <button type="button" onClick={() => removeBreakdownRow(idx)}
                        className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-red-900/30 text-white/30 hover:text-red-400 transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {/* Totals row */}
                  <div className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 bg-white/5 border-t border-white/10">
                    <span className="text-xs font-bold text-white/60 col-span-2">Components Total</span>
                    <span className={`text-xs font-black text-right ${breakdownMismatch ? "text-red-400" : "text-emerald-400"}`}>
                      ₹{breakdownTotal.toLocaleString("en-IN")}
                    </span>
                    <span />
                  </div>
                </div>
              )}

              {breakdownMismatch && (
                <p className="text-xs text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Components total (₹{breakdownTotal.toLocaleString("en-IN")}) doesn't match main amount (₹{amountNum.toLocaleString("en-IN")}). Adjust or remove components.
                </p>
              )}
              {breakdown.length === 0 && (
                <p className="text-[11px] text-white/25 px-1">
                  No components added. Click "+ Add Component" to itemise this fee (e.g. Tuition ₹2,500 + Library ₹500).
                </p>
              )}
            </div>

            {/* ── Auto-Invoice Generation ─────────────────────────────── */}
            {frequency !== "monthly" ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/40 text-center">
                  {frequency === "one-time"
                    ? "⚡ Auto-Generate is not available for One-Time fees — these are issued manually when needed."
                    : `⚡ Auto-Generate is only available for Monthly fees. ${frequency === "quarterly" ? "Quarterly" : "Annual"} invoices should be generated manually so you control the exact billing cycle.`}
                </p>
              </div>
            ) : (
            <div className={`rounded-xl border p-4 space-y-3 transition-all ${autoGenerate ? "border-emerald-600/40 bg-emerald-900/10" : "border-white/10 bg-white/5"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Switch checked={autoGenerate} onCheckedChange={setAutoGenerate} />
                  <div>
                    <p className="text-sm font-semibold text-white/80">Auto-Generate Invoices</p>
                    <p className="text-xs text-white/40 leading-tight">
                      Automatically create invoices on the 1st of every month
                    </p>
                  </div>
                </div>
                {autoGenerate && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-700/40 flex-shrink-0">
                    AUTO ON
                  </span>
                )}
              </div>
              {autoGenerate && (
                <div className="pt-1 border-t border-white/10 space-y-2">
                  <label className="text-xs text-white/50 block">
                    Invoice due day each month
                  </label>
                  <select
                    value={autoGenDueDay}
                    onChange={e => setAutoGenDueDay(e.target.value)}
                    className="w-44 bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">
                      {dueDay
                        ? `Same as Due Date (${new Date(dueDay + "T00:00:00").getDate()}th)`
                        : "Default (10th of month)"}
                    </option>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={String(d)}>
                        {d}{d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"} of every month
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-emerald-400/70">
                    🗓 Invoices will be auto-created on the 1st of each month for all enrolled students in the applicable classes.
                    You can still generate manually anytime — both work independently.
                  </p>
                </div>
              )}
            </div>
            )}

            <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <label className="text-sm text-white/70">Active — visible in fee reports</label>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" onClick={() => setShowModal(false)} className="text-white/60">Cancel</Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name || !feeType || !amount || breakdownMismatch}
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
              {genTarget.applicableClasses.length > 0 ? (
                <div className="p-3 rounded-lg bg-cyan-900/15 border border-cyan-700/30 space-y-1.5">
                  <p className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5">
                    <span>🎯</span> Strictly applies to these classes only
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {genTarget.applicableClasses.map(cls => (
                      <span key={cls} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-900/40 text-cyan-300 border border-cyan-700/40">
                        {cls}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-white/30 pt-0.5">
                    Invoices will only be generated for students enrolled in the above classes. This is set on the fee structure and cannot be changed here.
                  </p>
                </div>
              ) : (
                <p className="text-white/40 text-xs p-3 rounded-lg bg-white/5 border border-white/10">
                  No class restriction — invoices will be generated for{" "}
                  <span className="text-white/70 font-medium">all enrolled students</span> in the selected session.
                </p>
              )}
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" onClick={() => setGenTarget(null)} className="text-white/60">Cancel</Button>
                <Button
                  onClick={() => genMut.mutate()}
                  disabled={genMut.isPending || !genSessionId || !genDueDate}
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
                  {genResult.created > 0
                    ? `${genResult.created} Invoice${genResult.created !== 1 ? "s" : ""} Generated`
                    : genResult.synced > 0 ? "Invoices Updated" : "No Changes"}
                </p>
                {genResult.synced > 0 && (
                  <p className="text-cyan-400 text-xs mt-1">✅ {genResult.synced} existing invoice{genResult.synced !== 1 ? "s" : ""} synced to latest amount</p>
                )}
                {genResult.skipped > 0 && (
                  <p className="text-white/50 text-xs mt-1">{genResult.skipped} already up to date</p>
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

// ─── Reminders / Notifications Tab ────────────────────────────────────────────

function KeyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 pr-10 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20"
      />
      <button type="button" onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function RemindersTab({ isArchiveMode }: { isArchiveMode: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Provider form state ──────────────────────────────────────────────────
  const [smsEnabled,        setSmsEnabled]        = useState(false);
  const [msg91AuthKey,      setMsg91AuthKey]       = useState("");
  const [msg91SenderId,     setMsg91SenderId]      = useState("");
  const [waEnabled,         setWaEnabled]          = useState(false);
  const [msg91WaNumber,     setMsg91WaNumber]      = useState("");
  const [msg91WaTemplate,   setMsg91WaTemplate]    = useState("");
  const [emailEnabled,      setEmailEnabled]       = useState(false);
  const [sgApiKey,          setSgApiKey]           = useState("");
  const [sgFromEmail,       setSgFromEmail]        = useState("");
  const [sgFromName,        setSgFromName]         = useState("");
  const [synced,            setSynced]             = useState(false);

  // Test notification state
  const [testChannel,  setTestChannel]  = useState<"sms" | "email" | "webhook">("webhook");
  const [testRecipient,setTestRecipient]= useState("");
  const [testOpen,     setTestOpen]     = useState(false);

  // Simulation state
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [simOpen,   setSimOpen]   = useState(false);

  // Template editor state — keyed "stage|channel"
  const [templateDraft, setTemplateDraft] = useState<Record<string, { bodyText: string; subjectText: string }>>({});
  const [templatesSynced, setTemplatesSynced] = useState(false);
  const [activeTemplateStage, setActiveTemplateStage] = useState<string>("D0");

  const { data: cfg, isLoading } = useQuery<NotifConfig | null>({
    queryKey: ["/api/admin/fees/notification-config"],
    staleTime: 60_000,
  });

  const { data: logEntries = [] } = useQuery<DunningLogEntry[]>({
    queryKey: ["/api/admin/fees/dunning-log"],
    staleTime: 30_000,
  });

  const { data: savedTemplates, isSuccess: templatesLoaded } = useQuery<DunningTemplateRow[]>({
    queryKey: ["/api/admin/fees/dunning-templates"],
    staleTime: 60_000,
  });

  // Job status — poll every 5s so the UI reflects live running state
  const { data: jobStatus } = useQuery<DunningJobStatusData>({
    queryKey: ["/api/admin/fees/dunning-job-status"],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/dunning-job-status");
      if (!r.ok) return { isRunning: false, startedAt: null, lastCompletedAt: null };
      return r.json();
    },
    staleTime: 0,
    refetchInterval: 5_000,
  });
  const jobRunning = jobStatus?.isRunning ?? false;

  useEffect(() => {
    if (cfg !== undefined && !synced) {
      if (cfg) {
        setSmsEnabled(cfg.smsEnabled);
        setMsg91AuthKey(cfg.msg91AuthKey ?? "");
        setMsg91SenderId(cfg.msg91SenderId ?? "");
        setWaEnabled(cfg.waEnabled);
        setMsg91WaNumber(cfg.msg91WaNumber ?? "");
        setMsg91WaTemplate(cfg.msg91WaTemplate ?? "");
        setEmailEnabled(cfg.emailEnabled);
        setSgApiKey(cfg.sendgridApiKey ?? "");
        setSgFromEmail(cfg.sendgridFromEmail ?? "");
        setSgFromName(cfg.sendgridFromName ?? "");
      }
      setSynced(true);
    }
  }, [cfg, synced]);

  // Default template texts shown before any school-specific override is saved
  const DEFAULT_SMS: Record<string, string> = {
    D0:  `Dear {guardian_name}, {student_name}'s fee "{fee_name}" of Rs.{amount} is due today. Please pay promptly.`,
    D7:  `Reminder: {student_name}'s fee "{fee_name}" of Rs.{amount} is 7 days overdue. Please clear it at the earliest.`,
    D14: `2nd Notice: {student_name}'s fee "{fee_name}" of Rs.{amount} is 14 days overdue. Please contact admin immediately.`,
    D30: `FINAL NOTICE: {student_name}'s fee "{fee_name}" of Rs.{amount} is 30 days overdue. Account may be flagged.`,
  };
  const DEFAULT_EMAIL_SUBJECT: Record<string, string> = {
    D0:  "Fee Due Today",
    D7:  "Fee Reminder — 7 Days Overdue",
    D14: "Second Notice — Fee 14 Days Overdue",
    D30: "Final Notice — Fee 30 Days Overdue",
  };
  const DEFAULT_EMAIL_BODY: Record<string, string> = {
    D0:  `This is a reminder that {student_name}'s fee "{fee_name}" of ₹{amount} is due today. Please pay to avoid late penalties.`,
    D7:  `{student_name}'s fee "{fee_name}" of ₹{amount} is 7 days overdue. Please clear the dues immediately.`,
    D14: `This is a second notice. {student_name}'s fee "{fee_name}" of ₹{amount} is 14 days overdue. Please contact the school admin without further delay.`,
    D30: `FINAL NOTICE: {student_name}'s fee "{fee_name}" of ₹{amount} is 30 days overdue. Failure to pay may result in account restrictions.`,
  };

  useEffect(() => {
    // Only seed draft once the query has actually resolved (templatesLoaded = true).
    // Using the isSuccess flag prevents premature hydration before API data arrives,
    // which would seed defaults and silently ignore saved school-specific templates.
    if (!templatesSynced && templatesLoaded) {
      const rows = savedTemplates ?? [];
      const draft: Record<string, { bodyText: string; subjectText: string }> = {};
      for (const stage of ["D0", "D7", "D14", "D30"]) {
        for (const channel of ["sms", "email"]) {
          const key = `${stage}|${channel}`;
          const saved = rows.find(t => t.stage === stage && t.channel === channel);
          draft[key] = {
            bodyText: saved?.bodyText ?? (channel === "sms" ? DEFAULT_SMS[stage] : DEFAULT_EMAIL_BODY[stage]),
            subjectText: saved?.subjectText ?? (channel === "email" ? DEFAULT_EMAIL_SUBJECT[stage] : ""),
          };
        }
      }
      setTemplateDraft(draft);
      setTemplatesSynced(true);
    }
  }, [templatesLoaded, templatesSynced, savedTemplates]);

  const saveTemplatesMut = useMutation({
    mutationFn: () => {
      const templates: Array<{ stage: string; channel: string; bodyText: string; subjectText: string | null }> = [];
      for (const [key, val] of Object.entries(templateDraft)) {
        const [stage, channel] = key.split("|");
        templates.push({
          stage,
          channel,
          bodyText: val.bodyText,
          subjectText: channel === "email" ? (val.subjectText || null) : null,
        });
      }
      return apiRequest("PUT", "/api/admin/fees/dunning-templates", { templates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/dunning-templates"] });
      toast({ title: "Message templates saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/fees/notification-config", {
      smsEnabled, msg91AuthKey: msg91AuthKey || null, msg91SenderId: msg91SenderId || null,
      waEnabled, msg91WaNumber: msg91WaNumber || null, msg91WaTemplate: msg91WaTemplate || null,
      emailEnabled,
      sendgridApiKey: sgApiKey || null, sendgridFromEmail: sgFromEmail || null, sendgridFromName: sgFromName || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/notification-config"] });
      toast({ title: "Notification settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const testMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/fees/notification-config/test", { channel: testChannel, recipient: testRecipient }),
    onSuccess: () => toast({ title: "Test sent!", description: `Test ${testChannel} sent to ${testRecipient}` }),
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const simulateMut = useMutation({
    mutationFn: (): Promise<SimResult> => apiRequest("POST", "/api/admin/fees/dunning-simulate", {}).then(r => r.json()),
    onSuccess: (data: SimResult) => {
      setSimResult(data);
      setSimOpen(true);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/dunning-log"] });
    },
    onError: (e: Error) => toast({ title: "Simulation failed", description: e.message, variant: "destructive" }),
  });

  const DUNNING_ROWS = [
    { day: "D+0",  label: "On Due Date",       note: "Notify parent/guardian of the fee amount now due.", icon: "📅" },
    { day: "D+7",  label: "7 Days Overdue",    note: "First reminder — polite nudge via SMS / WhatsApp / email.", icon: "📩" },
    { day: "D+14", label: "14 Days Overdue",   note: "Second escalation — copy to class guardian.", icon: "⚠️" },
    { day: "D+30", label: "30 Days Overdue",   note: "Final notice — account may be flagged.", icon: "🚨" },
  ];

  const CHANNEL_ICONS: Record<string, React.ReactNode> = {
    sms:       <MessageSquare className="w-3.5 h-3.5" />,
    whatsapp:  <Phone className="w-3.5 h-3.5" />,
    email:     <Mail className="w-3.5 h-3.5" />,
  };
  const CHANNEL_COLORS: Record<string, string> = {
    sms:       "bg-blue-900/40 text-blue-300 border-blue-700/40",
    whatsapp:  "bg-green-900/40 text-green-300 border-green-700/40",
    email:     "bg-purple-900/40 text-purple-300 border-purple-700/40",
  };
  const STAGE_COLORS: Record<string, string> = {
    D0: "text-cyan-400", D7: "text-amber-400", D14: "text-orange-400", D30: "text-red-400",
  };

  if (isLoading) return <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;

  const anyEnabled = smsEnabled || waEnabled || emailEnabled;

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Section header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white font-semibold">Notification Providers</p>
          <p className="text-white/40 text-xs mt-0.5">Enable SMS, WhatsApp, and email to automatically remind parents at each overdue stage.</p>
        </div>
        {anyEnabled && (
          <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-700/30 px-2.5 py-1 rounded-full">
            <Zap className="w-3 h-3" /> Active
          </span>
        )}
      </div>

      {/* ── Dunning job status row ── */}
      <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs ${
        jobRunning
          ? "bg-amber-900/20 border-amber-700/40 text-amber-300"
          : "bg-white/5 border-white/10 text-white/50"
      }`}>
        <div className="flex items-center gap-2">
          {jobRunning
            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            : <Clock className="w-3.5 h-3.5 text-white/30" />
          }
          <span className="font-medium">
            {jobRunning
              ? "Job running…"
              : jobStatus?.lastCompletedAt
                ? `Last run: ${fmtDateTime(jobStatus.lastCompletedAt)}`
                : "Job has not run yet"
            }
          </span>
        </div>
        {jobRunning && jobStatus?.startedAt && (
          <span className="text-amber-400/70">Started {fmtDateTime(jobStatus.startedAt)}</span>
        )}
      </div>

      {/* ── SMS Card ── */}
      <div className={`rounded-xl border p-4 space-y-3 transition-colors ${smsEnabled ? "border-blue-700/40 bg-blue-900/10" : "border-white/10 bg-white/5"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-400" />
            <span className="text-white font-medium text-sm">SMS via MSG91</span>
          </div>
          <Switch checked={smsEnabled} onCheckedChange={setSmsEnabled} disabled={isArchiveMode} />
        </div>
        {smsEnabled && (
          <div className="space-y-2 pt-1">
            <div>
              <p className="text-white/50 text-xs mb-1">MSG91 Auth Key</p>
              <KeyInput value={msg91AuthKey} onChange={setMsg91AuthKey} placeholder="Enter your MSG91 auth key" />
            </div>
            <div>
              <p className="text-white/50 text-xs mb-1">Sender ID <span className="text-white/30">(6 chars, e.g. SCHOOL)</span></p>
              <input value={msg91SenderId} onChange={e => setMsg91SenderId(e.target.value)} maxLength={6}
                placeholder="SCHOOL"
                className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20 uppercase" />
            </div>
          </div>
        )}
      </div>

      {/* ── WhatsApp Card ── */}
      <div className={`rounded-xl border p-4 space-y-3 transition-colors ${waEnabled ? "border-green-700/40 bg-green-900/10" : "border-white/10 bg-white/5"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-green-400" />
            <span className="text-white font-medium text-sm">WhatsApp via MSG91</span>
          </div>
          <Switch checked={waEnabled} onCheckedChange={setWaEnabled} disabled={isArchiveMode} />
        </div>
        {waEnabled && (
          <div className="space-y-2 pt-1">
            <div className="p-2.5 rounded-lg bg-amber-900/20 border border-amber-700/30">
              <p className="text-amber-300 text-xs">WhatsApp requires a <strong>pre-approved message template</strong> in your MSG91 dashboard. Your template must have 5 body parameters: <code>{"{{1}}"}</code> parent name, <code>{"{{2}}"}</code> student name, <code>{"{{3}}"}</code> fee name, <code>{"{{4}}"}</code> amount, <code>{"{{5}}"}</code> overdue status.</p>
            </div>
            <div>
              <p className="text-white/50 text-xs mb-1">MSG91 Auth Key <span className="text-white/30">(same as SMS if using same account)</span></p>
              <KeyInput value={msg91AuthKey} onChange={setMsg91AuthKey} placeholder="Enter your MSG91 auth key" />
            </div>
            <div>
              <p className="text-white/50 text-xs mb-1">Integrated WhatsApp Number <span className="text-white/30">(91XXXXXXXXXX)</span></p>
              <input value={msg91WaNumber} onChange={e => setMsg91WaNumber(e.target.value)}
                placeholder="91XXXXXXXXXX"
                className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20" />
            </div>
            <div>
              <p className="text-white/50 text-xs mb-1">Approved Template Name</p>
              <input value={msg91WaTemplate} onChange={e => setMsg91WaTemplate(e.target.value)}
                placeholder="fee_reminder"
                className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20" />
            </div>
          </div>
        )}
      </div>

      {/* ── Email Card ── */}
      <div className={`rounded-xl border p-4 space-y-3 transition-colors ${emailEnabled ? "border-purple-700/40 bg-purple-900/10" : "border-white/10 bg-white/5"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-purple-400" />
            <span className="text-white font-medium text-sm">Email</span>
          </div>
          <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} disabled={isArchiveMode} />
        </div>
        {emailEnabled && (
          <div className="space-y-2 pt-1">
            <div>
              <p className="text-white/50 text-xs mb-1">SendGrid API Key</p>
              <KeyInput value={sgApiKey} onChange={setSgApiKey} placeholder="SG.xxxxxxxxxxxx" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-white/50 text-xs mb-1">From Email</p>
                <input value={sgFromEmail} onChange={e => setSgFromEmail(e.target.value)}
                  placeholder="fees@school.edu"
                  className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20" />
              </div>
              <div>
                <p className="text-white/50 text-xs mb-1">From Name</p>
                <input value={sgFromName} onChange={e => setSgFromName(e.target.value)}
                  placeholder="School Admin"
                  className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Save + Test + Simulate ── */}
      {!isArchiveMode && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="bg-cyan-600 hover:bg-cyan-500 text-white">
            {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
            Save Settings
          </Button>
          {anyEnabled && (
            <Button variant="outline" onClick={() => setTestOpen(true)}
              className="border-white/20 text-white/70 hover:text-white hover:bg-white/5">
              <Send className="w-4 h-4 mr-1" /> Test Send
            </Button>
          )}
          <Button variant="outline" onClick={() => simulateMut.mutate()} disabled={simulateMut.isPending || jobRunning}
            title={jobRunning ? "Dunning job is currently running — please wait" : undefined}
            className="border-amber-700/40 text-amber-400 hover:bg-amber-900/20 disabled:opacity-50 disabled:cursor-not-allowed">
            {simulateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Zap className="w-4 h-4 mr-1" />}
            {jobRunning ? "Job Running…" : "Run Simulation"}
          </Button>
        </div>
      )}

      {/* ── Simulation Results Dialog ── */}
      <Dialog open={simOpen} onOpenChange={setSimOpen}>
        <DialogContent className="bg-[#0f1923] border border-white/10 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" /> Simulation Results
            </DialogTitle>
          </DialogHeader>
          {simResult && (
            <div className="space-y-4 pt-2">
              {/* Summary banner */}
              <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-700/30">
                <p className="text-amber-300 text-xs">
                  <span className="font-semibold">Dry-run complete.</span> No real messages were sent.
                  The system scanned <span className="font-semibold">{simResult.totalFees}</span> fee record(s) across all statuses
                  and logged <span className="font-semibold">{simResult.entriesLogged}</span> simulated entries to the delivery log.
                </p>
              </div>

              {/* Per-channel stats */}
              <div className="grid grid-cols-3 gap-3">
                {(["sms", "whatsapp", "email"] as const).map(ch => {
                  const stats = simResult.byChannel[ch] ?? { would_send: 0, missing_contact: 0 };
                  const colors: Record<string, string> = {
                    sms: "border-blue-700/30 bg-blue-900/10", whatsapp: "border-green-700/30 bg-green-900/10", email: "border-purple-700/30 bg-purple-900/10",
                  };
                  const icons: Record<string, React.ReactNode> = {
                    sms: <MessageSquare className="w-4 h-4 text-blue-400" />, whatsapp: <Phone className="w-4 h-4 text-green-400" />, email: <Mail className="w-4 h-4 text-purple-400" />,
                  };
                  return (
                    <div key={ch} className={`p-3 rounded-xl border ${colors[ch]}`}>
                      <div className="flex items-center gap-1.5 mb-2">{icons[ch]}<span className="text-white/60 text-xs capitalize">{ch}</span></div>
                      <p className="text-white font-bold text-lg">{stats.would_send}</p>
                      <p className="text-white/40 text-xs">would send</p>
                      {stats.missing_contact > 0 && (
                        <p className="text-amber-400 text-xs mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {stats.missing_contact} missing
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Entry table */}
              {simResult.entries.length > 0 && (
                <div>
                  <p className="text-white/50 text-xs mb-2 font-medium">What would be sent:</p>
                  <div className="rounded-xl border border-white/10 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-white/10 bg-white/5">
                        <th className="px-3 py-2 text-left text-white/50 font-medium">Student</th>
                        <th className="px-3 py-2 text-left text-white/50 font-medium">Fee</th>
                        <th className="px-3 py-2 text-left text-white/50 font-medium">Stage</th>
                        <th className="px-3 py-2 text-left text-white/50 font-medium">Channel</th>
                        <th className="px-3 py-2 text-left text-white/50 font-medium">To</th>
                      </tr></thead>
                      <tbody>
                        {simResult.entries.map((e, i) => (
                          <tr key={i} className={`border-b border-white/5 ${i % 2 === 0 ? "" : "bg-white/[0.02]"}`}>
                            <td className="px-3 py-2 text-white/80">{e.studentName}</td>
                            <td className="px-3 py-2 text-white/60">{e.feeType} · ₹{e.amount}</td>
                            <td className={`px-3 py-2 font-bold ${{D0:"text-cyan-400",D7:"text-amber-400",D14:"text-orange-400",D30:"text-red-400"}[e.stage] ?? "text-white/60"}`}>{e.stage}</td>
                            <td className="px-3 py-2 capitalize text-white/60">{e.channel}</td>
                            <td className="px-3 py-2">
                              {e.issue
                                ? <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{e.issue}</span>
                                : <span className="text-emerald-400 truncate block max-w-[120px]">{e.recipient}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <Button className="w-full bg-white/10 hover:bg-white/20 text-white" onClick={() => setSimOpen(false)}>
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Test Dialog ── */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="bg-[#0f1923] border border-white/10 text-white max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="w-4 h-4 text-cyan-400" /> Test Send</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">

            {/* Channel picker */}
            <div>
              <p className="text-white/50 text-xs mb-2">Choose channel</p>
              <div className="grid grid-cols-3 gap-2">
                {(["webhook", "sms", "email"] as const).map(ch => {
                  const labels: Record<string, string> = { webhook: "Webhook", sms: "SMS", email: "Email" };
                  const icons: Record<string, React.ReactNode> = {
                    webhook: <Zap className="w-3.5 h-3.5" />,
                    sms: <MessageSquare className="w-3.5 h-3.5" />,
                    email: <Mail className="w-3.5 h-3.5" />,
                  };
                  return (
                    <button key={ch} onClick={() => setTestChannel(ch)}
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border text-xs font-medium transition-colors ${testChannel === ch ? "bg-cyan-700/40 border-cyan-500/60 text-white" : "border-white/10 text-white/40 hover:text-white/70"}`}>
                      {icons[ch]}{labels[ch]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Webhook instructions */}
            {testChannel === "webhook" && (
              <div className="p-3 rounded-lg bg-cyan-900/20 border border-cyan-700/30 space-y-1.5">
                <p className="text-cyan-300 text-xs font-semibold">No API keys needed!</p>
                <p className="text-white/50 text-xs">
                  1. Open <span className="text-cyan-400 font-medium">webhook.site</span> in a new tab — you get a free unique URL instantly.<br />
                  2. Copy that URL and paste it below.<br />
                  3. Click Send — the server will POST the notification payload to your URL.<br />
                  4. Watch it arrive live at webhook.site.
                </p>
              </div>
            )}

            {/* Recipient input */}
            <div>
              <p className="text-white/50 text-xs mb-1">
                {testChannel === "webhook" ? "Webhook URL (from webhook.site)" :
                 testChannel === "email"   ? "Email address" :
                                             "Phone number (91XXXXXXXXXX)"}
              </p>
              <input value={testRecipient} onChange={e => setTestRecipient(e.target.value)}
                placeholder={
                  testChannel === "webhook" ? "https://webhook.site/your-unique-id" :
                  testChannel === "email"   ? "test@example.com" :
                                              "91XXXXXXXXXX"
                }
                className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20" />
            </div>

            <Button className="w-full bg-cyan-600 hover:bg-cyan-500" onClick={() => testMut.mutate()} disabled={testMut.isPending || !testRecipient}>
              {testMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
              Send Test
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Message Templates ── */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white font-semibold text-sm">Message Templates</p>
            <p className="text-white/40 text-xs mt-0.5">Customise the text sent at each overdue stage. Supports variables: <code className="text-cyan-400 text-[10px]">{"{student_name}"}</code> <code className="text-cyan-400 text-[10px]">{"{guardian_name}"}</code> <code className="text-cyan-400 text-[10px]">{"{fee_name}"}</code> <code className="text-cyan-400 text-[10px]">{"{amount}"}</code> <code className="text-cyan-400 text-[10px]">{"{due_date}"}</code></p>
          </div>
          {!isArchiveMode && (
            <Button size="sm" onClick={() => saveTemplatesMut.mutate()} disabled={saveTemplatesMut.isPending}
              className="bg-cyan-700 hover:bg-cyan-600 text-white text-xs h-8 px-3">
              {saveTemplatesMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              Save Templates
            </Button>
          )}
        </div>

        {/* Stage tabs */}
        <div className="flex gap-1">
          {[
            { key: "D0",  label: "D+0",  color: "text-cyan-400",   border: "border-cyan-500/60" },
            { key: "D7",  label: "D+7",  color: "text-amber-400",  border: "border-amber-500/60" },
            { key: "D14", label: "D+14", color: "text-orange-400", border: "border-orange-500/60" },
            { key: "D30", label: "D+30", color: "text-red-400",    border: "border-red-500/60" },
          ].map(({ key, label, color, border }) => (
            <button key={key} onClick={() => setActiveTemplateStage(key)}
              className={`px-3 py-1 rounded text-xs font-bold border transition-colors ${activeTemplateStage === key ? `${color} ${border} bg-white/5` : "text-white/40 border-white/10 hover:text-white/70"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* SMS template */}
        {templatesSynced && (
          <div className="space-y-3">
            {/* SMS */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-white/70 text-xs font-medium">SMS Body</span>
              </div>
              <textarea
                rows={3}
                value={templateDraft[`${activeTemplateStage}|sms`]?.bodyText ?? ""}
                onChange={e => setTemplateDraft(d => ({
                  ...d,
                  [`${activeTemplateStage}|sms`]: { ...d[`${activeTemplateStage}|sms`], bodyText: e.target.value },
                }))}
                disabled={isArchiveMode}
                className="w-full bg-[#0f1923] border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500/50 placeholder:text-white/20 resize-y disabled:opacity-50"
              />
            </div>

            {/* Email */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Mail className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-white/70 text-xs font-medium">Email</span>
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-white/40 text-[10px] mb-1">Subject line</p>
                  <input
                    value={templateDraft[`${activeTemplateStage}|email`]?.subjectText ?? ""}
                    onChange={e => setTemplateDraft(d => ({
                      ...d,
                      [`${activeTemplateStage}|email`]: { ...d[`${activeTemplateStage}|email`], subjectText: e.target.value },
                    }))}
                    disabled={isArchiveMode}
                    className="w-full bg-[#0f1923] border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500/50 placeholder:text-white/20 disabled:opacity-50"
                  />
                </div>
                <div>
                  <p className="text-white/40 text-[10px] mb-1">Message body</p>
                  <textarea
                    rows={3}
                    value={templateDraft[`${activeTemplateStage}|email`]?.bodyText ?? ""}
                    onChange={e => setTemplateDraft(d => ({
                      ...d,
                      [`${activeTemplateStage}|email`]: { ...d[`${activeTemplateStage}|email`], bodyText: e.target.value },
                    }))}
                    disabled={isArchiveMode}
                    className="w-full bg-[#0f1923] border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500/50 placeholder:text-white/20 resize-y disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
              <p className="text-white/30 text-[10px]">WhatsApp uses a pre-approved MSG91 template (configured above) — its body text is managed in your MSG91 dashboard and cannot be customised here.</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Dunning schedule ── */}
      <div>
        <p className="text-white font-semibold mb-3">Automated Dunning Schedule</p>
        <div className="space-y-2">
          {DUNNING_ROWS.map(r => {
            const stage = r.day.replace("+", "");
            return (
              <div key={r.day} className="flex items-center gap-4 p-3.5 rounded-xl border border-white/10 bg-white/5">
                <span className="text-xl w-7 text-center flex-shrink-0">{r.icon}</span>
                <div className="w-12 flex-shrink-0 text-center">
                  <p className={`text-xs font-bold ${STAGE_COLORS[stage] ?? "text-cyan-400"}`}>{r.day}</p>
                </div>
                <div className="h-5 w-px bg-white/10 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{r.label}</p>
                  <p className="text-white/40 text-xs mt-0.5">{r.note}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {smsEnabled    && <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border bg-blue-900/30 text-blue-300 border-blue-700/30"><MessageSquare className="w-3 h-3" /></span>}
                  {waEnabled     && <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border bg-green-900/30 text-green-300 border-green-700/30"><Phone className="w-3 h-3" /></span>}
                  {emailEnabled  && <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border bg-purple-900/30 text-purple-300 border-purple-700/30"><Mail className="w-3 h-3" /></span>}
                  {!anyEnabled   && <span className="text-white/20 text-xs">—</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Delivery log ── */}
      <div>
        <p className="text-white font-semibold mb-3">Recent Deliveries <span className="text-white/30 text-xs font-normal">(last 50)</span></p>
        {logEntries.length === 0 ? (
          <div className="text-center py-10 text-white/30 text-sm border border-white/5 rounded-xl bg-white/5">
            No notifications sent yet. They will appear here once the dunning job fires.
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-white/10 bg-white/5">
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Student</th>
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Channel</th>
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Stage</th>
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Recipient</th>
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Sent</th>
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {logEntries.map((l, i) => (
                  <tr key={l.id} className={`border-b border-white/5 ${i % 2 === 0 ? "" : "bg-white/[0.02]"}`}>
                    <td className="px-3 py-2 text-white/80">{l.studentName ?? `Fee #${l.feeRecordId}`}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs ${CHANNEL_COLORS[l.channel] ?? "text-white/50 border-white/10"}`}>
                        {CHANNEL_ICONS[l.channel]} {l.channel}
                      </span>
                    </td>
                    <td className={`px-3 py-2 font-bold ${STAGE_COLORS[l.stage] ?? "text-white/60"}`}>{l.stage}</td>
                    <td className="px-3 py-2 text-white/50 truncate max-w-[120px]">{l.recipient ?? "—"}</td>
                    <td className="px-3 py-2 text-white/40">{fmtDateTime(l.sentAt)}</td>
                    <td className="px-3 py-2">
                      {l.status === "sent" ? (
                        <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> sent</span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1" title={l.errorMessage ?? ""}><AlertTriangle className="w-3 h-3" /> failed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── External Portal Tab ──────────────────────────────────────────────────────

function ExternalPortalTab({ isArchiveMode }: { isArchiveMode: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Razorpay state ─────────────────────────────────────────────────────────
  const [rzpEnabled, setRzpEnabled] = useState(false);
  const [rzpKeyId, setRzpKeyId] = useState("");
  const [rzpKeySecret, setRzpKeySecret] = useState("");
  const [rzpWebhookSecret, setRzpWebhookSecret] = useState("");
  const [rzpMode, setRzpMode] = useState<"test" | "live">("test");

  // ── External portal state ──────────────────────────────────────────────────
  const [isEnabled, setIsEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [banner, setBanner] = useState("");
  const [maxOvercollectionPercent, setMaxOvercollectionPercent] = useState(150);

  const [synced, setSynced] = useState(false);

  const { data: settings, isLoading } = useQuery<ExternalSettings>({
    queryKey: ["/api/admin/fees/external-settings"],
    staleTime: 60_000,
  });

  useEffect(() => {
    if (settings && !synced) {
      setRzpEnabled(settings.razorpayEnabled ?? false);
      setRzpKeyId(settings.razorpayKeyId ?? "");
      setRzpKeySecret(settings.razorpayKeySecret ?? "");
      setRzpWebhookSecret(settings.razorpayWebhookSecret ?? "");
      setRzpMode((settings.razorpayMode as "test" | "live") ?? "test");
      setIsEnabled(settings.isEnabled);
      setUrl(settings.gatewayUrl ?? "");
      setBanner(settings.bannerMessage ?? "");
      setMaxOvercollectionPercent(settings.maxOvercollectionPercent ?? 150);
      setSynced(true);
    }
  }, [settings, synced]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/external-settings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
  };

  // ── Razorpay save mutation ─────────────────────────────────────────────────
  const rzpMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/fees/external-settings/razorpay", {
      razorpayEnabled: rzpEnabled,
      razorpayKeyId:   rzpKeyId || null,
      razorpayKeySecret:     rzpKeySecret || null,
      razorpayWebhookSecret: rzpWebhookSecret || null,
      razorpayMode: rzpMode,
    }),
    onSuccess: (data: any) => {
      invalidate();
      if (data) {
        setRzpKeySecret(data.razorpayKeySecret ?? "");
        setRzpWebhookSecret(data.razorpayWebhookSecret ?? "");
      }
      toast({ title: "✅ Razorpay settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Portal link save mutation ──────────────────────────────────────────────
  const portalMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/fees/external-settings/portal", {
      isEnabled,
      gatewayUrl:               url || null,
      bannerMessage:            banner || null,
      maxOvercollectionPercent,
    }),
    onSuccess: () => {
      invalidate();
      toast({ title: "✅ External portal settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-white/40">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );

  const rzpConfigured = !!(settings?.razorpayKeyId && settings?.razorpayKeySecret);

  return (
    <div className="space-y-6 max-w-xl">

      {/* ══ SECTION 1 — Razorpay Gateway ══════════════════════════════════════ */}
      <div className="rounded-2xl border border-blue-700/30 bg-blue-900/10 overflow-hidden">
        {/* Section header */}
        <div className="px-5 py-4 border-b border-blue-700/20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#528FF0,#2D6EE8)" }}>
              <CreditCard className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-white font-bold flex items-center gap-2">
                Razorpay Gateway
                {rzpConfigured
                  ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ CONFIGURED</span>
                  : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">NOT SET UP</span>
                }
              </p>
              <p className="text-white/40 text-xs mt-0.5">Accept UPI, cards, net banking & wallets in the student portal.</p>
            </div>
          </div>
          <Switch checked={rzpEnabled} onCheckedChange={setRzpEnabled} disabled={isArchiveMode} />
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            {(["test", "live"] as const).map(m => (
              <button key={m} onClick={() => !isArchiveMode && setRzpMode(m)} disabled={isArchiveMode}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${rzpMode === m
                  ? m === "live" ? "bg-emerald-600/30 border-emerald-500/60 text-emerald-300" : "bg-amber-600/20 border-amber-500/40 text-amber-300"
                  : "bg-[#1A2942] border-white/10 text-white/30 hover:text-white/50"
                } disabled:opacity-40`}>
                {m === "test" ? "🧪 Test / Sandbox" : "🚀 Live"}
              </button>
            ))}
          </div>

          {/* Key ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60">Key ID <span className="text-red-400">*</span></label>
            <input value={rzpKeyId} onChange={e => setRzpKeyId(e.target.value)}
              placeholder={rzpMode === "test" ? "rzp_test_XXXXXXXXXXXXXXXX" : "rzp_live_XXXXXXXXXXXXXXXX"}
              disabled={isArchiveMode}
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500 placeholder:text-white/20 disabled:opacity-40" />
          </div>

          {/* Key Secret */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60">Key Secret <span className="text-red-400">*</span></label>
            <input type="password" value={rzpKeySecret} onChange={e => setRzpKeySecret(e.target.value)}
              placeholder={rzpKeySecret === "••••••••" ? "Leave blank to keep existing secret" : "Enter Key Secret…"}
              disabled={isArchiveMode}
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500 placeholder:text-white/20 disabled:opacity-40" />
            <p className="text-white/25 text-[11px]">Stored server-side only — never exposed to the browser after saving.</p>
          </div>

          {/* Webhook Secret */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60">Webhook Secret</label>
            <input type="password" value={rzpWebhookSecret} onChange={e => setRzpWebhookSecret(e.target.value)}
              placeholder={rzpWebhookSecret === "••••••••" ? "Leave blank to keep existing secret" : "Enter Webhook Secret…"}
              disabled={isArchiveMode}
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500 placeholder:text-white/20 disabled:opacity-40" />
            <p className="text-white/25 text-[11px]">
              Register this URL in Razorpay Dashboard → Webhooks → <span className="font-mono text-blue-400/70">/api/webhooks/razorpay</span> → enable <span className="font-mono text-blue-400/70">payment.captured</span>
            </p>
          </div>

          {rzpEnabled && !rzpConfigured && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
              <Shield className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-amber-400/90 text-xs leading-relaxed">
                Enter and save Key ID + Key Secret before enabling. Students cannot pay until both are saved.
              </p>
            </div>
          )}

          {!isArchiveMode && (
            <Button onClick={() => rzpMut.mutate()} disabled={rzpMut.isPending}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl py-2.5">
              {rzpMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving…</> : "Save Razorpay Settings"}
            </Button>
          )}
        </div>
      </div>

      {/* ══ SECTION 2 — External Portal Link ══════════════════════════════════ */}
      <div className="rounded-2xl border border-white/10 bg-[#1A2942] overflow-hidden">
        {/* Section header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#06b6d4,#0891b2)" }}>
              <ExternalLink className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-white font-bold">External Payment Portal</p>
              <p className="text-white/40 text-xs mt-0.5">Show a third-party payment link to students (Instamojo, PayU, etc.).</p>
            </div>
          </div>
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={isArchiveMode} />
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Gateway / Portal URL
            </label>
            <input value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://pay.yourschool.edu/fees"
              disabled={isArchiveMode}
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 disabled:opacity-40" />
          </div>

          {/* Banner message */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60 flex items-center gap-1">
              <Bell className="w-3 h-3" /> Banner Message (shown to students)
            </label>
            <textarea value={banner} onChange={e => setBanner(e.target.value)} rows={3}
              disabled={isArchiveMode}
              placeholder="Pay your fees online at the link below. For queries, contact the accounts office."
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 resize-none disabled:opacity-40" />
            <p className="text-white/25 text-xs text-right">{banner.length}/500</p>
          </div>

          {/* Over-collection cap */}
          <div className="p-3.5 rounded-xl border border-amber-700/25 bg-amber-900/10 space-y-2.5">
            <p className="text-white font-semibold text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" /> Max Over-collection Cap
            </p>
            <p className="text-white/40 text-xs leading-relaxed">
              Payments that would bring total collected above this % of the invoice are blocked. Default 150%.
            </p>
            <div className="flex items-center gap-3">
              <input type="number" min={100} max={500} step={1}
                value={maxOvercollectionPercent}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setMaxOvercollectionPercent(Math.min(500, Math.max(100, v)));
                }}
                disabled={isArchiveMode}
                className="w-24 bg-[#0F1E35] border border-white/10 rounded-lg px-3 py-2 text-sm text-white text-center focus:outline-none focus:border-amber-500 disabled:opacity-40" />
              <span className="text-white/60 text-sm">%</span>
              <span className="text-white/30 text-xs">Range: 100–500%</span>
            </div>
          </div>

          {/* Preview */}
          {(isEnabled || banner) && (
            <div className="space-y-1.5">
              <p className="text-white/40 text-xs uppercase tracking-widest font-semibold">Student Portal Preview</p>
              <div className="p-4 rounded-xl border border-cyan-700/30 bg-cyan-900/10">
                <p className="text-cyan-400 text-sm font-semibold flex items-center gap-2">
                  <CreditCard className="w-4 h-4" /> Pay Fees Online
                </p>
                {banner && <p className="text-white/60 text-xs mt-2 leading-relaxed">{banner}</p>}
                {isEnabled && url
                  ? <a href={url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-cyan-400 text-xs underline">
                      <ExternalLink className="w-3 h-3" /> {url}
                    </a>
                  : isEnabled && <p className="text-white/25 text-xs mt-2">No gateway URL configured yet.</p>}
              </div>
            </div>
          )}

          {!isArchiveMode && (
            <Button onClick={() => portalMut.mutate()} disabled={portalMut.isPending}
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl py-2.5">
              {portalMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving…</> : "Save Portal Settings"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Data Maintenance ─────────────────────────────────────────────── */}
      <BackfillReceiptsSection />
    </div>
  );
}

// ─── Backfill Receipts Section ────────────────────────────────────────────────
// Assigns AF/OP receipt numbers to any fee/payment records that pre-date the
// receipt system.  Safe to run multiple times — already-numbered rows are skipped.

function BackfillReceiptsSection() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ feeRecordsUpdated: number; paymentRecordsUpdated: number; afRange: string | null; opRange: string | null } | null>(null);
  const [alreadyRunning, setAlreadyRunning] = useState(false);

  const backfillMut = useMutation({
    mutationFn: async () => {
      setAlreadyRunning(false);
      const r = await sessionFetch("/api/admin/fees/backfill-receipts", { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (r.status === 409) {
        const err: any = new Error(body.message ?? "Backfill already running");
        err.alreadyRunning = true;
        throw err;
      }
      if (!r.ok) {
        throw new Error(body.message ?? "Backfill failed");
      }
      return body as { feeRecordsUpdated: number; paymentRecordsUpdated: number; afRange: string | null; opRange: string | null; message: string };
    },
    onSuccess: (data) => {
      setResult({ feeRecordsUpdated: data.feeRecordsUpdated, paymentRecordsUpdated: data.paymentRecordsUpdated, afRange: data.afRange ?? null, opRange: data.opRange ?? null });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      toast({ title: "Receipt backfill complete", description: data.message });
    },
    onError: (e: any) => {
      if (e.alreadyRunning) {
        setAlreadyRunning(true);
      } else {
        toast({ title: "Backfill failed", description: e.message, variant: "destructive" });
      }
    },
  });

  return (
    <div className="p-4 rounded-xl border border-amber-700/30 bg-amber-900/10 space-y-3">
      <div>
        <p className="text-white font-semibold flex items-center gap-2">
          <Receipt className="w-4 h-4 text-amber-400" /> Assign Missing Receipt Numbers
        </p>
        <p className="text-white/40 text-xs mt-0.5 leading-relaxed">
          Fee and payment records created before the receipt system was added show "—" in the Receipt column.
          Run this once to assign sequential AF/OP numbers to all such records. Safe to run multiple times.
        </p>
      </div>

      {result && !alreadyRunning && (
        <div className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-700/30 rounded-lg px-3 py-2 space-y-1">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              Done — {result.feeRecordsUpdated} fee record{result.feeRecordsUpdated !== 1 ? "s" : ""} and{" "}
              {result.paymentRecordsUpdated} payment record{result.paymentRecordsUpdated !== 1 ? "s" : ""} updated.
              {result.feeRecordsUpdated === 0 && result.paymentRecordsUpdated === 0 && " All records already have receipt numbers."}
            </span>
          </div>
          {(result.afRange || result.opRange) && (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-5 text-emerald-300/80 font-mono">
              {result.afRange && (
                <span>Fee receipts: <span className="font-semibold text-emerald-300">{result.afRange}</span></span>
              )}
              {result.opRange && (
                <span>Payment receipts: <span className="font-semibold text-emerald-300">{result.opRange}</span></span>
              )}
            </div>
          )}
        </div>
      )}

      {alreadyRunning && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          <span>Another admin is running the backfill. Please wait a moment and try again.</span>
        </div>
      )}

      <Button
        onClick={() => backfillMut.mutate()}
        disabled={backfillMut.isPending}
        variant="outline"
        className="border-amber-600/50 text-amber-300 hover:bg-amber-900/30 hover:text-amber-200 bg-transparent text-xs h-8"
      >
        {backfillMut.isPending
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Running backfill…</>
          : <><Receipt className="w-3.5 h-3.5 mr-1.5" /> Run Receipt Backfill</>}
      </Button>
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

// ─── Financial Analytics Tab ──────────────────────────────────────────────────

const AGING_BUCKETS = [
  { key: "1-30",  label: "1–30 Days",  color: "#f59e0b", risk: "Low",      dot: "bg-amber-500"  },
  { key: "31-60", label: "31–60 Days", color: "#f97316", risk: "Medium",   dot: "bg-orange-500" },
  { key: "61-90", label: "61–90 Days", color: "#ef4444", risk: "High",     dot: "bg-red-500"    },
  { key: "90+",   label: "90+ Days",   color: "#9b1c1c", risk: "Critical", dot: "bg-red-900"    },
] as const;

const CHANNEL_COLORS = ["#06b6d4", "#10b981", "#8b5cf6", "#f59e0b", "#64748b"];

interface TSRow { period: string; period_date: string; billed: number; collected: number; }

function aggregateToQuarterly(rows: TSRow[]): TSRow[] {
  const map = new Map<string, TSRow>();
  for (const r of rows) {
    const d   = new Date(r.period_date);
    const q   = Math.ceil((d.getMonth() + 1) / 3);
    const key = `Q${q} '${String(d.getFullYear()).slice(2)}`;
    const ex  = map.get(key) ?? { period: key, period_date: r.period_date, billed: 0, collected: 0 };
    map.set(key, { ...ex, billed: ex.billed + r.billed, collected: ex.collected + r.collected });
  }
  return Array.from(map.values());
}

const CustomTooltipStyle = {
  contentStyle: { background: "#0A1628", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 },
  labelStyle:   { color: "rgba(255,255,255,0.7)" },
};

interface AgingStudent {
  fee_record_id: number;
  student_id: number;
  student_name: string;
  class: string;
  section: string;
  fee_type: string;
  due_date: string;
  amount: number;
  days_overdue: number;
}

function AnalyticsTab({ viewSessionId }: { viewSessionId: number | null }) {
  const { selectedSession } = useSessionView();
  const [period, setPeriod] = useState<"monthly" | "quarterly" | "ytd">("monthly");
  const [selectedBucket, setSelectedBucket] = useState<(typeof AGING_BUCKETS)[number] | null>(null);

  const { data: raw, isLoading, error } = useQuery<any>({
    queryKey: ["/api/fees/analytics", viewSessionId],
    queryFn: async () => {
      const r = await sessionFetch("/api/fees/analytics");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });

  // Time-series aggregation
  const timeSeriesData = useMemo<TSRow[]>(() => {
    if (!raw?.timeSeries) return [];
    const rows: TSRow[] = (raw.timeSeries as any[]).map(r => ({
      period: r.period, period_date: r.period_date,
      billed: Number(r.billed), collected: Number(r.collected),
    }));
    if (period === "quarterly") return aggregateToQuarterly(rows);
    if (period === "ytd") {
      const now = new Date();
      // Indian academic year starts April; fall back to Jan if before April
      const ytdStart = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);
      return rows.filter(r => new Date(r.period_date) >= ytdStart);
    }
    return rows.slice(-12); // monthly: last 12
  }, [raw, period]);

  // Payment channel grouping
  const channelData = useMemo(() => {
    if (!raw?.paymentChannels) return [];
    const groups: Record<string, number> = {};
    for (const ch of raw.paymentChannels as any[]) {
      const m   = String(ch.payment_method ?? "Other");
      const cat = ["Online", "Razorpay", "UPI", "Card", "NetBanking"].includes(m) ? "Online"
                : m === "Cash" ? "Cash"
                : ["Cheque", "DD", "Bank Transfer"].includes(m) ? "Cheque"
                : m;
      groups[cat] = (groups[cat] ?? 0) + Number(ch.amount);
    }
    return Object.entries(groups).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [raw]);

  // Aging with guaranteed 4 buckets
  const agingData = useMemo(() => {
    const map = Object.fromEntries(((raw?.aging ?? []) as any[]).map((a: any) => [a.bucket, a]));
    return AGING_BUCKETS.map(b => ({
      ...b,
      count:  Number(map[b.key]?.count  ?? 0),
      amount: Number(map[b.key]?.amount ?? 0),
    }));
  }, [raw]);

  const totalAging = agingData.reduce((s, r) => s + r.amount, 0);
  const feeCategories = ((raw?.feeCategories ?? []) as any[]).map(r => ({
    fee_type: r.fee_type, billed: Number(r.billed), collected: Number(r.collected),
  }));

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
    </div>
  );
  if (error) return (
    <div className="rounded-xl border border-red-700/40 bg-red-900/10 p-6 text-center text-sm text-red-400">
      Failed to load analytics data. Please refresh and try again.
    </div>
  );

  const s = raw?.summary ?? {};

  const execCards = [
    { label: "Gross Billed Demand",      value: fmt(s.grossBilled ?? 0),        Icon: FileText,     ib: "border-white/10 bg-white/5",              ic: "text-white/50"    },
    { label: "Net Collected Revenue",    value: fmt(s.netCollected ?? 0),       Icon: DollarSign,   ib: "border-[#D4AF37]/30 bg-[#D4AF37]/5",      ic: "text-[#D4AF37]"  },
    { label: "Outstanding Deficit",      value: fmt(s.outstanding ?? 0),        Icon: TrendingDown, ib: "border-red-500/30 bg-red-500/5",           ic: "text-red-400"    },
    { label: "Collection Efficiency",    value: `${s.collectionRate ?? 0}%`,    Icon: TrendingUp,   ib: "border-emerald-500/30 bg-emerald-500/5",   ic: "text-emerald-400"},
    { label: "Discounts & Concessions",  value: fmt(s.totalDiscounts ?? 0),     Icon: Banknote,     ib: "border-purple-500/30 bg-purple-500/5",     ic: "text-purple-400" },
    { label: "Late Penalties Collected", value: fmt(s.totalLatePenalties ?? 0), Icon: AlertTriangle,ib: "border-amber-500/30 bg-amber-500/5",       ic: "text-amber-400"  },
  ];

  return (
    <div className="space-y-5">

      {/* Session label */}
      {selectedSession && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-white/40">Showing data for</span>
          <span className="px-2 py-0.5 rounded-full font-semibold bg-cyan-900/30 text-cyan-400 border border-cyan-700/30">
            {selectedSession.sessionName}
          </span>
        </div>
      )}

      {/* ── Executive Summary Cards ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {execCards.map(({ label, value, Icon, ib, ic }) => (
          <div key={label} className={`rounded-xl border ${ib} p-4 flex items-center gap-3`}>
            <div className={`p-2 rounded-lg bg-white/5 ${ic} flex-shrink-0`}><Icon className="w-5 h-5" /></div>
            <div className="min-w-0">
              <p className="text-white/50 text-xs mb-0.5 leading-tight">{label}</p>
              <p className="text-white font-bold text-lg leading-none tabular-nums truncate">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Revenue Collection Trend ─────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-white font-semibold text-sm">Revenue Collection Trend</h3>
            <p className="text-white/40 text-xs">Billed demand vs collected revenue by period</p>
          </div>
          <div className="flex gap-0.5 p-0.5 bg-black/20 rounded-lg border border-white/10">
            {(["monthly", "quarterly", "ytd"] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${period === p ? "bg-cyan-600 text-white" : "text-white/40 hover:text-white"}`}>
                {p === "monthly" ? "Monthly" : p === "quarterly" ? "Quarterly" : "YTD"}
              </button>
            ))}
          </div>
        </div>

        {timeSeriesData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-white/25 text-sm">
            No collection data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={timeSeriesData} barGap={2} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
              <Tooltip {...CustomTooltipStyle}
                formatter={(v: number, name: string) => [fmt(v), name === "billed" ? "Billed" : "Collected"]} />
              <Legend formatter={v => v === "billed" ? "Billed" : "Collected"}
                wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }} />
              <Bar dataKey="billed"    name="billed"    fill="rgba(255,255,255,0.08)" radius={[4,4,0,0]} />
              <Bar dataKey="collected" name="collected" fill="#06b6d4"                radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Class-Wise Table + Payment Channel Pie ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Class-Wise */}
        <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5 space-y-3">
          <h3 className="text-white font-semibold text-sm">Class-Wise Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-white/40 uppercase tracking-widest text-[10px]">
                  <th className="pb-2 text-left font-semibold">Class</th>
                  <th className="pb-2 text-right font-semibold">Billed</th>
                  <th className="pb-2 text-right font-semibold">Collected</th>
                  <th className="pb-2 text-right font-semibold">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {((raw?.classWise ?? []) as any[]).map((row: any) => {
                  const billed = Number(row.billed), collected = Number(row.collected), out = Number(row.outstanding);
                  const pct = billed > 0 ? Math.round((collected / billed) * 100) : 0;
                  return (
                    <tr key={row.class} className="hover:bg-white/[0.03] transition-colors">
                      <td className="py-2 text-white font-medium">
                        Class {row.class}
                        <span className="ml-1.5 text-[10px] text-white/30">{pct}%</span>
                      </td>
                      <td className="py-2 text-right text-white/50 tabular-nums">{fmt(billed)}</td>
                      <td className="py-2 text-right text-emerald-400 tabular-nums font-semibold">{fmt(collected)}</td>
                      <td className="py-2 text-right text-red-400 tabular-nums">{fmt(out)}</td>
                    </tr>
                  );
                })}
                {((raw?.classWise ?? []) as any[]).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-white/25">No class data available</td>
                  </tr>
                )}
              </tbody>
              {((raw?.classWise ?? []) as any[]).length > 0 && (
                <tfoot className="border-t border-white/10">
                  <tr className="text-xs font-bold">
                    <td className="pt-2 text-white/60">Total</td>
                    <td className="pt-2 text-right text-white/60 tabular-nums">
                      {fmt((raw?.classWise as any[]).reduce((s: number, r: any) => s + Number(r.billed), 0))}
                    </td>
                    <td className="pt-2 text-right text-emerald-400 tabular-nums">
                      {fmt((raw?.classWise as any[]).reduce((s: number, r: any) => s + Number(r.collected), 0))}
                    </td>
                    <td className="pt-2 text-right text-red-400 tabular-nums">
                      {fmt((raw?.classWise as any[]).reduce((s: number, r: any) => s + Number(r.outstanding), 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Payment Channel Pie */}
        <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5 space-y-3">
          <h3 className="text-white font-semibold text-sm">Payment Channel Split</h3>
          {channelData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-white/25 text-sm">No payment data yet</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={channelData} cx="50%" cy="50%" innerRadius={54} outerRadius={80}
                    dataKey="value" paddingAngle={3} stroke="none">
                    {channelData.map((_, i) => (
                      <Cell key={i} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...CustomTooltipStyle} formatter={(v: number) => [fmt(v), "Amount"]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 justify-center">
                {channelData.map((d, i) => {
                  const total = channelData.reduce((s, c) => s + c.value, 0);
                  const pct   = total > 0 ? Math.round((d.value / total) * 100) : 0;
                  return (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs text-white/60">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }} />
                      <span>{d.name}</span>
                      <span className="text-white/30">{pct}%</span>
                      <span className="text-white/40 tabular-nums">{fmt(d.value)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Fee Category Breakdown (horizontal bars) ─────────────────── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5 space-y-4">
        <h3 className="text-white font-semibold text-sm">Fee Category Breakdown</h3>
        {feeCategories.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-white/25 text-sm">No fee category data</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, feeCategories.length * 44)}>
            <BarChart data={feeCategories} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="fee_type" width={110}
                tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...CustomTooltipStyle}
                formatter={(v: number, name: string) => [fmt(v), name === "billed" ? "Billed" : "Collected"]} />
              <Legend formatter={v => v === "billed" ? "Billed" : "Collected"}
                wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }} />
              <Bar dataKey="billed"    name="billed"    fill="rgba(255,255,255,0.08)" radius={[0,4,4,0]} />
              <Bar dataKey="collected" name="collected" fill="#10b981"                radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── AR Aging Analysis ────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5 space-y-4">
        <div>
          <h3 className="text-white font-semibold text-sm">Accounts Receivable Aging</h3>
          <p className="text-white/40 text-xs">Outstanding balance by days overdue — click any bucket to see which students are responsible</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {agingData.map(bucket => (
            <button
              key={bucket.key}
              onClick={() => bucket.count > 0 ? setSelectedBucket(bucket) : undefined}
              disabled={bucket.count === 0}
              className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2.5 text-left transition-all duration-150 disabled:opacity-50 disabled:cursor-default enabled:cursor-pointer enabled:hover:bg-black/40 enabled:hover:scale-[1.02] group"
              style={{ borderColor: `${bucket.color}30` }}
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${bucket.dot}`} />
                <span className="text-white/60 text-xs font-semibold leading-none">{bucket.label}</span>
                {bucket.count > 0 && (
                  <Users className="w-3 h-3 ml-auto text-white/20 group-hover:text-white/50 transition-colors" />
                )}
              </div>
              <p className="text-white font-black text-xl tabular-nums leading-none">{fmt(bucket.amount)}</p>
              <div className="flex items-center justify-between">
                <span className="text-white/30 text-xs">{bucket.count} invoice{bucket.count !== 1 ? "s" : ""}</span>
                {totalAging > 0 && (
                  <span className="text-xs font-bold" style={{ color: bucket.color }}>
                    {Math.round((bucket.amount / totalAging) * 100)}%
                  </span>
                )}
              </div>
              {totalAging > 0 && (
                <div className="w-full bg-white/5 rounded-full h-1">
                  <div className="h-1 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((bucket.amount / totalAging) * 100)}%`, background: bucket.color }} />
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider"
                  style={{ color: bucket.color, background: `${bucket.color}22` }}>
                  {bucket.risk} Risk
                </span>
                {bucket.count > 0 && (
                  <span className="text-[10px] text-white/30 group-hover:text-white/60 transition-colors font-medium">
                    View →
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
        {totalAging === 0 && (
          <p className="text-center text-white/25 text-sm py-4">No overdue receivables — all current ✓</p>
        )}
      </div>

      {/* ── Aging Defaulters Drawer ───────────────────────────────────── */}
      <AgingDefaultersDrawer
        bucket={selectedBucket}
        onClose={() => setSelectedBucket(null)}
      />

    </div>
  );
}

type Tab = "ledger" | "structures" | "reminders" | "external" | "audit" | "analytics";

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "analytics",  label: "Financial Analytics",   Icon: BarChart2     },
  { id: "structures", label: "Fee Structures",        Icon: BookOpen      },
  { id: "ledger",     label: "Ledger & Transactions", Icon: Receipt       },
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
      {activeTab === "analytics"  && <AnalyticsTab viewSessionId={viewSessionId} />}
      {activeTab === "reminders"  && <RemindersTab isArchiveMode={isArchiveMode} />}
      {activeTab === "external"   && <ExternalPortalTab isArchiveMode={isArchiveMode} />}
      {activeTab === "audit"      && <AuditTab />}
    </div>
  );
}

const NOTIF_CHANNEL_COLORS: Record<string, string> = {
  sms:      "bg-blue-900/40 text-blue-300 border-blue-700/40",
  whatsapp: "bg-green-900/40 text-green-300 border-green-700/40",
  email:    "bg-purple-900/40 text-purple-300 border-purple-700/40",
};

const NOTIF_STAGE_COLORS: Record<string, string> = {
  D0: "text-cyan-400", D7: "text-amber-400", D14: "text-orange-400", D30: "text-red-400",
};

const NOTIF_STAGE_LABELS: Record<string, string> = {
  D0: "Due today", D7: "7 days overdue", D14: "14 days overdue", D30: "30 days overdue",
};

interface NotificationHistoryModalProps {
  open: boolean;
  onClose: () => void;
  studentId: number | null;
  studentName: string | null;
}

function NotificationHistoryModal({ open, onClose, studentId, studentName }: NotificationHistoryModalProps) {
  const { data: entries = [], isLoading } = useQuery<DunningLogEntry[]>({
    queryKey: ["/api/admin/fees/dunning-log", studentId],
    queryFn: async () => {
      if (!studentId) return [];
      const r = await sessionFetch(`/api/admin/fees/dunning-log?studentId=${studentId}`);
      if (!r.ok) return [];
      const rows: any[] = await r.json();
      // Normalise snake_case from raw SQL → camelCase
      return rows.map(row => ({
        id:            row.id,
        feeRecordId:   row.fee_record_id,
        channel:       row.channel,
        stage:         row.stage,
        sentAt:        row.sent_at,
        status:        row.status,
        errorMessage:  row.error_message ?? null,
        recipient:     row.recipient ?? null,
        studentName:   row.student_name ?? null,
      }));
    },
    enabled: open && !!studentId,
    staleTime: 60_000,
  });

  const sentCount  = entries.filter(e => e.status === "sent").length;
  const failCount  = entries.filter(e => e.status !== "sent").length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-violet-400">
            <Bell className="w-5 h-5" />
            Notification History
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400/60 ml-1" />}
          </DialogTitle>
        </DialogHeader>

        {/* Student + summary strip */}
        <div className="shrink-0 p-3 rounded-lg bg-white/5 border border-white/10 text-sm">
          <p className="text-white font-semibold">{studentName ?? "—"}</p>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            <span className="text-white/40 text-xs">
              Total: <span className="text-white font-medium">{entries.length}</span>
            </span>
            {sentCount > 0 && (
              <span className="text-white/40 text-xs">
                Sent: <span className="text-emerald-400 font-medium">{sentCount}</span>
              </span>
            )}
            {failCount > 0 && (
              <span className="text-white/40 text-xs">
                Failed: <span className="text-red-400 font-medium">{failCount}</span>
              </span>
            )}
          </div>
        </div>

        {/* Log table */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-white/30">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-white/30">
              <Bell className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">No notifications sent for this student yet.</p>
              <p className="text-xs mt-1">Dunning reminders appear here once the automated job fires.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 overflow-hidden mt-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Channel</th>
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Stage</th>
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Sent</th>
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Recipient</th>
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Status</th>
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Fee Record</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={e.id} className={`border-b border-white/5 ${i % 2 === 0 ? "" : "bg-white/[0.02]"}`}>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs ${NOTIF_CHANNEL_COLORS[e.channel] ?? "text-white/50 border-white/10"}`}>
                          {NOTIF_CHANNEL_ICONS[e.channel]} {e.channel}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`font-bold ${NOTIF_STAGE_COLORS[e.stage] ?? "text-white/60"}`}>{e.stage}</span>
                        <span className="text-white/30 ml-1.5">{NOTIF_STAGE_LABELS[e.stage] ?? ""}</span>
                      </td>
                      <td className="px-3 py-2 text-white/50 whitespace-nowrap">{fmtDateTime(e.sentAt)}</td>
                      <td className="px-3 py-2 text-white/50 max-w-[140px] truncate" title={e.recipient ?? ""}>{e.recipient ?? "—"}</td>
                      <td className="px-3 py-2">
                        {e.status === "sent" ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> sent
                          </span>
                        ) : (
                          <span className="text-red-400 flex items-center gap-1" title={e.errorMessage ?? ""}>
                            <AlertTriangle className="w-3 h-3" /> failed
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-white/30 font-mono">#{e.feeRecordId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="shrink-0 pt-2 border-t border-white/10 flex justify-between items-center">
          <p className="text-white/25 text-xs">Showing up to 200 most recent notifications</p>
          <Button variant="ghost" onClick={onClose} className="text-white/60 h-8 text-sm">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AgingDefaultersDrawer({
  bucket,
  onClose,
}: {
  bucket: (typeof AGING_BUCKETS)[number] | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [sendingId, setSendingId] = useState<number | null>(null);

  const { data: students = [], isLoading } = useQuery<AgingStudent[]>({
    queryKey: ["/api/fees/analytics/aging-students", bucket?.key],
    queryFn: async () => {
      if (!bucket) return [];
      const r = await sessionFetch(`/api/fees/analytics/aging-students?bucket=${encodeURIComponent(bucket.key)}`);
      if (!r.ok) throw new Error("Failed to load defaulters");
      return r.json();
    },
    enabled: !!bucket,
    staleTime: 30_000,
  });

  async function sendReminder(student: AgingStudent) {
    setSendingId(student.fee_record_id);
    try {
      const r = await sessionFetch("/api/admin/fees/dunning-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeRecordId: student.fee_record_id }),
      });
      const body = await r.json();
      if (!r.ok) {
        toast({ title: "Failed", description: body.message ?? "Could not send reminder", variant: "destructive" });
        return;
      }
      const sentCount = (body.sent ?? []).length;
      const skipped   = (body.skipped ?? []).length;
      if (sentCount > 0) {
        toast({ title: "Reminder sent", description: `Notified ${student.student_name} via ${(body.sent as string[]).join(", ")}` });
      } else if (skipped > 0) {
        toast({ title: "Reminder skipped", description: (body.skipped as string[])[0] ?? "No channels available", variant: "destructive" });
      } else {
        toast({ title: "Reminder failed", description: "Could not send on any channel", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  }

  return (
    <Sheet open={!!bucket} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl bg-[#0A1628] border-l border-white/10 text-white overflow-y-auto p-0"
      >
        {bucket && (
          <>
            {/* Header */}
            <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: bucket.color }} />
                <SheetTitle className="text-white font-bold text-base leading-tight">
                  {bucket.label} Defaulters
                </SheetTitle>
                <span
                  className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider"
                  style={{ color: bucket.color, background: `${bucket.color}22` }}
                >
                  {bucket.risk} Risk
                </span>
              </div>
              <p className="text-white/40 text-xs mt-1">
                Overdue invoices sorted by outstanding amount — highest risk first
              </p>
            </SheetHeader>

            {/* Body */}
            <div className="px-5 py-4">
              {isLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                </div>
              ) : students.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-white/25">
                  <Users className="w-10 h-10" />
                  <p className="text-sm">No defaulters in this bucket</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-white/40 text-xs mb-3">{students.length} student{students.length !== 1 ? "s" : ""} found</p>
                  {students.map(s => (
                    <div
                      key={s.fee_record_id}
                      className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2.5"
                      style={{ borderColor: `${bucket.color}20` }}
                    >
                      {/* Student info row */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-white font-semibold text-sm leading-tight truncate">
                            {s.student_name}
                          </p>
                          <p className="text-white/40 text-xs mt-0.5">
                            Class {s.class}{s.section ? `–${s.section}` : ""}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-white font-black text-base tabular-nums leading-tight">
                            {fmt(s.amount)}
                          </p>
                          <p className="text-[10px] mt-0.5 font-bold" style={{ color: bucket.color }}>
                            {s.days_overdue}d overdue
                          </p>
                        </div>
                      </div>

                      {/* Fee detail row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/50 border border-white/10">
                            {s.fee_type}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/30 border border-white/10">
                            Due {fmtDate(s.due_date)}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={sendingId === s.fee_record_id}
                          onClick={() => sendReminder(s)}
                          className="h-7 px-2.5 text-xs font-semibold border-cyan-700/50 text-cyan-400 bg-cyan-900/20 hover:bg-cyan-900/40 hover:text-cyan-300 flex-shrink-0"
                        >
                          {sendingId === s.fee_record_id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Bell className="w-3 h-3 mr-1" />
                          )}
                          {sendingId === s.fee_record_id ? "Sending…" : "Remind"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
