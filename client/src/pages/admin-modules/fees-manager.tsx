import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CreditCard, Plus, Search, Loader2, Trash2, Pencil, CheckCircle2, AlertTriangle, Clock,
  Receipt, DollarSign, TrendingUp, TrendingDown, Banknote, BookOpen, Bell, ExternalLink,
  Shield, ChevronLeft, ChevronRight, Lock, X, Printer, History, Download, FileText,
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
  maxOvercollectionPercent: number | null;
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
    // Reset fee record fields
    setFeeType("");
    setDueDate("");
    setFeeStatus("Due");
    setAcademicYear(selectedSession?.sessionName ?? "");
    setFeeNotes("");
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
      feeNotes: feeRecord ? null : (feeNotes || null),
      paymentMethod: method,
      referenceNumber: ref || null,
      receivedDate: date,
      amount: parseInt(amount),
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
            {feeRecord ? (
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm">
                <p className="text-white font-semibold">{feeRecord.student?.name}</p>
                <p className="text-white/50 text-xs">{feeRecord.feeType} · {feeRecord.student?.class}-{feeRecord.student?.section}</p>
                <p className="text-white/40 text-xs">Invoice: {fmt(feeRecord.amount)}</p>
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
              <div>
                <label className="text-xs text-white/60 mb-1 block">Received Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
              </div>
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
      `PAY-${p.id}`,
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
        <td class="mono">PAY-${p.id}</td>
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
                  <p className="text-white/20 text-[10px] mt-1.5 font-mono">PAY-{p.id}</p>
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

// ─── Fee Form Schema ──────────────────────────────────────────────────────────

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
  open: boolean;
  onClose: () => void;
  availableClasses: string[];
  availableFeeTypes: string[];
}

function ExportLedgerDialog({ open, onClose, availableClasses, availableFeeTypes }: ExportLedgerDialogProps) {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [cls, setCls] = useState("");
  const [feeType, setFeeType] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!open) {
      setDateFrom(""); setDateTo(""); setCls(""); setFeeType(""); setIsDownloading(false);
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
          {(dateFrom || dateTo || cls || feeType) && (
            <div className="px-3 py-2 rounded-lg bg-emerald-900/20 border border-emerald-700/30 text-xs text-emerald-400 space-y-0.5">
              <p className="font-semibold mb-1">Active filters:</p>
              {dateFrom && <p>Due from: {new Date(dateFrom).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>}
              {dateTo   && <p>Due to: {new Date(dateTo).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>}
              {cls      && <p>Class: {cls}</p>}
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
  const [showForm, setShowForm] = useState(false);
  const [showExportLedger, setShowExportLedger] = useState(false);
  const [editing, setEditing] = useState<FeeRecordWithStudent | null>(null);
  const [payTarget, setPayTarget] = useState<FeeRecordWithStudent | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showStandalonePay, setShowStandalonePay] = useState(false);
  const [showPaymentsModal, setShowPaymentsModal] = useState(false);
  const [viewPaymentsRecord, setViewPaymentsRecord] = useState<FeeRecordWithStudent | null>(null);
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
  // Map feeType → structure name for the Fee Name column
  const feeTypeToName = useMemo(() => {
    const m = new Map<string, string>();
    activeStructures.forEach(s => { if (!m.has(s.feeType)) m.set(s.feeType, s.name); });
    return m;
  }, [activeStructures]);

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
    mutationFn: (data: FeeFormValues) => apiRequest("POST", "/api/admin/fees", {
      studentId: Number(data.studentId), feeType: data.feeType, amount: Number(data.amount),
      dueDate: data.dueDate, status: data.status, paidDate: data.paidDate || null,
      receiptNumber: data.receiptNumber || null, notes: data.notes || null, academicYear: data.academicYear || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
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
    const ms = !q || (r.student?.name ?? "").toLowerCase().includes(q) || r.feeType.toLowerCase().includes(q) || (r.student?.digitalStudentId ?? "").toLowerCase().includes(q);
    const statusMatch = statusFilter === "all"
      ? true
      : statusFilter === "offline"
        ? offlinePaidIds.has(r.id)
        : r.status === statusFilter;
    return ms && statusMatch && (classFilter === "all" || r.student?.class === classFilter);
  }), [feeRecords, search, statusFilter, classFilter, offlinePaidIds]);

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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, ID or fee type…"
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
                  {["Student","Fee Name","Fee Type","Amount","Due Date","Status","Paid On","Acad. Year","Notes","Actions"].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-white/50 font-medium ${i === 3 ? "text-right" : i >= 9 ? "text-right" : i >= 4 ? "text-center" : "text-left"}`}>{h}</th>
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
                    <td className="px-4 py-3 text-white/80 text-sm">{feeTypeToName.get(rec.feeType) ?? "—"}</td>
                    <td className="px-4 py-3 text-white/70">{rec.feeType}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">{fmt(rec.amount)}</td>
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
                    <td className="px-4 py-3 text-left text-white/50 text-xs max-w-[120px] truncate" title={rec.notes ?? ""}>{rec.notes || "—"}</td>
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
      />

      {/* Add / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); setEditing(null); } }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-cyan-400">{editing ? "Edit Fee Record" : "Add Fee Record"}</DialogTitle>
          </DialogHeader>
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
    setConcPct(String(s.concessionPercent));
    if (s.dueDayOfMonth) {
      const now = new Date();
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(Math.min(s.dueDayOfMonth, 28)).padStart(2, "0");
      setDueDay(`${y}-${mo}-${d}`);
    } else { setDueDay(""); }
    setIsActive(s.isActive);
    setShowModal(true);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name, feeType, amount: parseInt(amount), frequency,
        applicableClasses: selectedClasses,
        concessionType: concType, concessionPercent: parseInt(concPct) || 0,
        dueDayOfMonth: dueDay ? new Date(dueDay + "T00:00:00").getDate() : null, isActive,
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
                <label className="text-xs text-white/60 mb-1 block">Due Date</label>
                <input type="date" value={dueDay} onChange={e => setDueDay(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                {dueDay && (
                  <p className="text-white/40 text-xs mt-1">Day {new Date(dueDay + "T00:00:00").getDate()} of each month</p>
                )}
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
  const [maxOvercollectionPercent, setMaxOvercollectionPercent] = useState(150);
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
      setMaxOvercollectionPercent(settings.maxOvercollectionPercent ?? 150);
      setSynced(true);
    }
  }, [settings, synced]);

  const saveMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/fees/external-settings", {
      isEnabled, gatewayUrl: url || null, bannerMessage: banner || null, maxOvercollectionPercent,
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

      <div className="p-4 rounded-xl border border-white/10 bg-[#1A2942] space-y-3">
        <div>
          <p className="text-white font-semibold flex items-center gap-2"><Shield className="w-4 h-4 text-amber-400" /> Max Over-collection Cap</p>
          <p className="text-white/40 text-xs mt-0.5">Payments that would bring the total collected above this percentage of the invoice amount are blocked. Default is 150%.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={100}
            max={500}
            step={1}
            value={maxOvercollectionPercent}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v)) setMaxOvercollectionPercent(Math.min(500, Math.max(100, v)));
            }}
            disabled={isArchiveMode}
            className="w-24 bg-[#0F1E35] border border-white/10 rounded-lg px-3 py-2 text-sm text-white text-center focus:outline-none focus:border-amber-500 disabled:opacity-40"
          />
          <span className="text-white/60 text-sm">%</span>
          <span className="text-white/30 text-xs">Range: 100% – 500%</span>
        </div>
        {maxOvercollectionPercent !== 150 && (
          <p className="text-amber-400/70 text-xs flex items-center gap-1">
            <Shield className="w-3 h-3" />
            {maxOvercollectionPercent < 150
              ? `Tighter than default — payments exceeding ${maxOvercollectionPercent}% of the invoice will be blocked.`
              : `Looser than default — payments up to ${maxOvercollectionPercent}% of the invoice are allowed.`}
          </p>
        )}
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
