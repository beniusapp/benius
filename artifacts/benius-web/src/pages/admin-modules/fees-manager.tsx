import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
  Receipt, DollarSign, TrendingUp, TrendingDown, Banknote, Wallet, BookOpen, Bell, ExternalLink,
  Shield, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Lock, X, Printer, History, Download, FileText,
  FileCheck2, Building2, QrCode, Monitor, MessageSquare, Mail, Send, Eye, EyeOff, Zap, Phone, BarChart2, Calendar, Users,
  PenLine, Upload, Undo2, Filter, SlidersHorizontal, Check, Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, sessionFetch, sessionFetchForViewSession, queryClient } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";
import { amountInWords, formatIndianRupees } from "@/lib/amount-in-words";
import { formatPersistedInvoiceDateTimeIST } from "@/lib/invoice-date-time";
import { offlinePaymentEntryDefaults, offlinePaymentDetailRows } from "@shared/offline-payment-details";
import {
  formatDateOnly, formatDateTimeIST, todayInIST,
  formatMonthYearFromDateOnly, formatMonthFromDateOnly, dayOfMonthFromDateOnly,
  dateOnlyParts, addCalendarDays,
} from "@shared/ist-time";
import {
  type LedgerFilters, emptyLedgerFilters, ledgerFiltersToSearchParams,
  ledgerFiltersToBody, countActiveLedgerFilters,
} from "@shared/ledger-filters";

// ─── Types ────────────────────────────────────────────────────────────────────
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  paymentMethod: string | null;
  receiptNumber: string | null;
  invoiceNumber: string | null;
  notes: string | null;
  academicYear: string | null;
  createdAt: string;
  student: { name: string; class: string; section: string; digitalStudentId: string } | null;
}

interface LedgerPageResponse {
  records: FeeRecordWithStudent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface FeeStructure {
  id: number;
  schoolId: number;
  name: string;
  feeType: string;
  amount: number;
  frequency: string;
  applicableClasses: string[];
  dueDayOfMonth: number | null;
  breakdown: Array<{ name: string; purpose: string; amount: number }>;
  lateFeeConfig?: {
    enabled?: boolean;
    type?: "NONE" | "FLAT" | "DAILY" | "TIERED";
    grace_period_days?: number;
    flat_amount?: number;
    daily_rate?: number;
    max_cap?: number;
    tiered_slabs?: Array<{ from_day: number; to_day: number; amount: number }>;
  } | null;
  lastInvoicesGeneratedAt: string | null;
  latestGeneratedFeePeriodStart: string | null;
  latestGeneratedFeePeriodEnd: string | null;
  createdAt: string;
}

type InvoiceBreakdownRow = { name: string; purpose: string; amount: string };


type InvoicePeriodOption = {
  value: string;
  label: string;
  start: string;
  end: string;
};

/**
 * Last calendar day of a month as a YYYY-MM-DD string, computed without the
 * host timezone. `month` is 0-based. Uses UTC arithmetic so the result never
 * shifts across a DST/offset boundary.
 */
export function monthEndDateOnly(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function addInvoicePeriodOptionsForSession(
  frequency: string,
  session: { startDate?: string | null; endDate?: string | null } | null,
): InvoicePeriodOption[] {
  const sessionStart = String(session?.startDate ?? "").slice(0, 10);
  const sessionEnd = String(session?.endDate ?? "").slice(0, 10);
  if (!sessionStart || !sessionEnd) return [];
  if (frequency === "annual" || frequency === "one-time") {
    return [{
      value: "active-session",
      label: (session as AcademicSession | null)?.sessionName ?? `${sessionStart} – ${sessionEnd}`,
      start: sessionStart,
      end: sessionEnd,
    }];
  }

  const isWithinSession = (start: string, end: string) =>
    start >= sessionStart && end <= sessionEnd;
  const options: InvoicePeriodOption[] = [];
  const monthPeriod = (year: number, month: number): InvoicePeriodOption => {
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    return {
      value: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: formatMonthYearFromDateOnly(start),
      start,
      end: monthEndDateOnly(year, month),
    };
  };
  const quarterPeriod = (year: number, quarterStartMonth: number): InvoicePeriodOption => {
    const endMonthIndex = (quarterStartMonth + 2) % 12;
    const endYear = year + Math.floor((quarterStartMonth + 2) / 12);
    const start = `${year}-${String(quarterStartMonth + 1).padStart(2, "0")}-01`;
    const endMonthStart = `${endYear}-${String(endMonthIndex + 1).padStart(2, "0")}-01`;
    return {
      value: `${year}-Q${Math.floor(quarterStartMonth / 3) + 1}`,
      label: `${formatMonthFromDateOnly(start)}–${formatMonthYearFromDateOnly(endMonthStart)}`,
      start,
      end: monthEndDateOnly(endYear, endMonthIndex),
    };
  };

  // Calendar-only iteration: month indices are absolute (year * 12 + month) so
  // the walk never touches the host timezone. The session bounds are compared
  // as YYYY-MM-DD strings, which are lexicographically ordered.
  const startParts = dateOnlyParts(sessionStart);
  const endParts = dateOnlyParts(sessionEnd);
  if (!startParts || !endParts) return options;
  const startIndex = startParts.year * 12 + (startParts.month - 1);
  const endIndex = endParts.year * 12 + (endParts.month - 1);
  const step = frequency === "quarterly" ? 3 : 1;
  const firstIndex = frequency === "quarterly"
    ? startParts.year * 12 + Math.floor((startParts.month - 1) / 3) * 3
    : startIndex;
  for (let index = firstIndex; index <= endIndex; index += step) {
    const year = Math.floor(index / 12);
    const month = index % 12;
    const candidate = frequency === "quarterly"
      ? quarterPeriod(year, month)
      : monthPeriod(year, month);
    if (isWithinSession(candidate.start, candidate.end)) options.push(candidate);
  }
  return options;
}

function preferredInvoicePeriod(options: InvoicePeriodOption[]): InvoicePeriodOption | undefined {
  const today = todayInIST();
  return options.find(option => option.start <= today && option.end >= today) ?? options[0];
}

interface AuditLogEntry {
  id: number;
  actorName: string | null;
  actorRole: string | null;
  actorIdentifier: string | null;
  actorType: string | null;
  action: string;
  actionLabel: string | null;
  entityType: string | null;
  entityId: number | null;
  studentId: number | null;
  studentName: string | null;
  studentIdentifier: string | null;
  recordLabel: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  sessionId: number | null;
  createdAt: string;
}

interface ExternalSettings {
  isEnabled: boolean;
  gatewayUrl: string | null;
  bannerMessage: string | null;
  razorpayEnabled: boolean;
  razorpayKeyId: string | null;
  razorpayKeySecret: string | null;
  razorpayWebhookSecret: string | null;
  razorpayMode: string;
  feeReceiptSignatureUrl: string | null;
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

interface UnpaidInvoice {
  id: number;
  studentId: number;
  feeType: string;
  feeName?: string | null;
  amount: number;
  dueDate: string;
  status: string;
  invoiceNumber: string | null;
  feePeriodStart: string | null;
  feePeriodEnd: string | null;
  lateFeeAmount: number;
  academicYear: string | null;
  accruedLateFee: number;
  totalDue: number;  // amount + accruedLateFee
}

interface PaymentRecord {
  id: number;
  feeRecordId: number | null;
  studentId: number;
  paymentMethod: string;
  amount: number;
  lateFeePaid?: number;
  receivedDate: string;
  referenceNumber: string | null;
  cashierNotes: string | null;
  receiptNumber: string | null;
  invoiceNumber?: string | null;
  // Razorpay metadata (populated for online payments)
  razorpayPaymentId?: string | null;
  razorpayOrderId?: string | null;
  razorpaySignature?: string | null;
  paymentMode?: string | null;
  bankName?: string | null;
  cardLast4?: string | null;
  vpa?: string | null;
  payerName?: string | null;
  payerEmail?: string | null;
  payerContact?: string | null;
  gatewayStatus?: string | null;
  createdAt?: string;
  denominationBreakdown?: Record<string, number> | null;
  instrumentDate?: string | null;
  branchName?: string | null;
  recordedBy?: number | null;
  recordedByName?: string | null;
  offlineDetail?: {
    transactionTime?: string | null;
    instrumentStatus?: string | null;
    transferMode?: string | null;
    transactionReference?: string | null;
    receivingBank?: string | null;
    receiverUpiId?: string | null;
    payeeName?: string | null;
    payableAt?: string | null;
    collectionLocation?: string | null;
    depositDate?: string | null;
    depositBank?: string | null;
    depositReference?: string | null;
    returnDate?: string | null;
    returnReason?: string | null;
  } | null;
  corrections?: Array<{
    reason: string;
    changedByName: string | null;
    createdAt: string;
    previousValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
  }>;
}

interface TransactionDetail {
  feeRecord: {
    id: number;
    feeType: string;
    feeName: string;
    amount: number;
    lateFeeAmount: number;
    dueDate: string;
    paidDate: string | null;
    status: string;
    academicYear: string | null;
    notes: string | null;
    invoiceNumber: string | null;
    frequency: string | null;
    feePeriodStart: string | null;
    feePeriodEnd: string | null;
    lateFeeConfig: {
      enabled?: boolean;
      type?: "NONE" | "FLAT" | "DAILY" | "TIERED";
      grace_period_days?: number;
      flat_amount?: number;
      daily_rate?: number;
      max_cap?: number;
      tiered_slabs?: Array<{ from_day: number; to_day: number; amount: number }>;
    } | null;
    createdAt: string;
    createdBy: number | null;
    breakdown: Array<{ name: string; purpose: string; amount: number }>;
  };
  payments: PaymentRecord[];
  payment: PaymentRecord | null;
  refundSummary?: {
    grossCapturedPaise: number;
    processedRefundedPaise: number;
    netRetainedPaise: number;
    remainingRefundablePaise: number;
  };
  refunds?: Array<{
    id: number; paymentRecordId: number; razorpayRefundId: string | null;
    requestedAmountPaise: number; processedAmountPaise: number | null; currency: string;
    reasonCode: string | null; reasonText: string | null; localStatus: string;
    providerStatus: string | null; requestedAt: string; providerProcessedAt: string | null;
    failureMessage: string | null;
  }>;
  paymentAttempts: Array<{
    id: number;
    attemptNumber: number | null;
    outcome: string;
    source: string;
    razorpayPaymentId: string | null;
    razorpayOrderId: string | null;
    amountPaise: number | null;
    currency: string;
    paymentMethod: string | null;
    errorCode: string | null;
    errorDescription: string | null;
    apiEnrichmentStatus: string | null;
    apiEnrichmentError: string | null;
    createdAt: string;
    updatedAt: string;
    events: Array<{
      id: number;
      eventType: string;
      outcome: string | null;
      source: string;
      razorpayPaymentId: string | null;
      razorpayOrderId: string | null;
      refundId: string | null;
      disputeId: string | null;
      amountPaise: number | null;
      providerOccurredAt: string | null;
      occurredAt: string | null;
      recordedAt: string;
      historical: boolean;
      payload: unknown;
      webhookEventId: number | null;
    }>;
  }>;
  webhookEvents: Array<{
    id: number;
    providerEventId: string;
    eventType: string;
    razorpayPaymentId: string | null;
    razorpayOrderId: string | null;
    razorpayRefundId: string | null;
    razorpayDisputeId: string | null;
    signatureVerified: boolean;
    verificationStatus: string;
    processingStatus: string;
    processingError: string | null;
    providerOccurredAt: string | null;
    resolutionSource: string | null;
    resolutionStatus: string;
    resolutionReason: string | null;
    receivedAt: string;
    lastReceivedAt: string;
    processedAt: string | null;
    deliveryCount: number;
    payload: unknown;
  }>;
  webhookProcessingEvents: Array<{
    id: number;
    webhookDeliveryId: number;
    status: string;
    error: string | null;
    createdAt: string;
  }>;
  student: {
    name: string;
    digitalStudentId: string;
    class: string;
    section: string;
    rollNumber: number | null;
    guardianName: string | null;
    phone: string | null;
    email: string | null;
  };
  school: {
    name: string;
    logoUrl: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    pinCode: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    affiliationNumber: string | null;
    gstin: string | null;
  };
  auditEntries: Array<{
    id: number;
    action: string;
    actorName: string | null;
    actorId: number | null;
    ipAddress: string | null;
    description: string | null;
    createdAt: string;
  }>;
}

function RefundPaymentDialog({ payment, onSaved }: { payment: PaymentRecord; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [eligibility, setEligibility] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [reasonCode, setReasonCode] = useState("fee_correction");
  const [reasonText, setReasonText] = useState("");
  const [actionKey, setActionKey] = useState("");
  const { toast } = useToast();
  useEffect(() => {
    if (!open) return;
    const keyName = `refund-action:${payment.id}`;
    const savedKey = sessionStorage.getItem(keyName);
    const key = savedKey ?? `refund-${crypto.randomUUID()}`;
    if (!savedKey) sessionStorage.setItem(keyName, key);
    setActionKey(key);
    setEligibility(null);
    sessionFetch(`/api/admin/fees/payments/${payment.id}/refund-eligibility`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        setEligibility(data);
        setAmount((data.currentlyRefundablePaise / 100).toFixed(2));
      })
      .catch(error => toast({ title: "Refund unavailable", description: error.message, variant: "destructive" }));
  }, [open, payment.id, toast]);
  const refundMutation = useMutation({
    mutationFn: async () => {
      const amountPaise = Math.round(Number(amount) * 100);
      const response = await sessionFetch(`/api/admin/fees/payments/${payment.id}/refunds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": actionKey },
        body: JSON.stringify({ amountPaise, reasonCode, reasonText }),
      });
      const data = await response.json();
      if (!response.ok && response.status !== 202) throw new Error(data.message);
      return data;
    },
    onSuccess: data => {
      sessionStorage.removeItem(`refund-action:${payment.id}`);
      toast({ title: data.reconciliationRequired ? "Refund queued for reconciliation" : "Refund requested", description: data.reconciliationRequired ? "Do not submit it again; its outcome will be reconciled." : "Razorpay will confirm the final refund status by webhook." });
      setOpen(false); onSaved();
    },
    onError: (error: Error) => toast({ title: "Refund could not be requested", description: error.message, variant: "destructive" }),
  });
  const max = Number(eligibility?.currentlyRefundablePaise ?? 0) / 100;
  return <>
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}
      className="h-7 px-2 text-xs text-amber-300 hover:bg-amber-900/30 gap-1">
      <Undo2 className="w-3 h-3" /> Refund
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-md">
        <DialogHeader><DialogTitle className="text-amber-300">Request Razorpay refund</DialogTitle></DialogHeader>
        {!eligibility ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div> : (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg bg-amber-950/30 border border-amber-700/30 p-3 text-amber-100/80">
              Original payment and receipt are preserved. Final financial status changes only after Razorpay confirms the refund.
            </div>
            <p className="text-white/60">Refundable now: <b className="text-white">₹{max.toFixed(2)}</b></p>
            {!eligibility.eligible || !eligibility.canInitiateRefund ? <p className="text-red-300">{eligibility.ineligibleReason ?? "You do not have permission to initiate refunds."}</p> : <>
              <label className="block text-white/60">Amount (₹)<Input type="number" min="0.01" max={max} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 bg-white/5 border-white/15" /></label>
              <label className="block text-white/60">Reason
                <select value={reasonCode} onChange={e => setReasonCode(e.target.value)} className="mt-1 w-full h-9 rounded-md bg-[#102038] border border-white/15 px-3 text-white">
                  {(eligibility.reasonCodes ?? []).map((code: string) => <option key={code} value={code}>{code.replaceAll("_", " ")}</option>)}
                </select>
              </label>
              <label className="block text-white/60">Customer-visible note (optional)<textarea value={reasonText} onChange={e => setReasonText(e.target.value)} maxLength={500} className="mt-1 w-full rounded-md bg-white/5 border border-white/15 p-2 text-white" /></label>
              <Button disabled={refundMutation.isPending || !actionKey || !amount || Number(amount) <= 0 || Number(amount) > max} onClick={() => refundMutation.mutate()} className="w-full bg-amber-600 hover:bg-amber-500">
                {refundMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Request refund
              </Button>
            </>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  </>;
}
function fmt(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function fmtDate(d: string | null) {
  return formatDateOnly(d);
}

function fmtDateTime(d: string) {
  return formatDateTimeIST(d);
}

function AttemptOutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  const value = outcome ?? "unknown";
  const tones: Record<string, string> = {
    captured: "bg-emerald-900/40 text-emerald-300 border-emerald-700/50",
    refunded: "bg-violet-900/40 text-violet-300 border-violet-700/50",
    failed: "bg-red-900/40 text-red-300 border-red-700/50",
    cancelled: "bg-slate-700/50 text-slate-300 border-slate-500/50",
    pending: "bg-amber-900/40 text-amber-300 border-amber-700/50",
    authorized: "bg-blue-900/40 text-blue-300 border-blue-700/50",
  };
  return <span className={`inline-flex border rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${tones[value] ?? "bg-white/10 text-white/60 border-white/20"}`}>{value}</span>;
}

function PaymentAttemptTimeline({ detail }: { detail: TransactionDetail }) {
  const attempts = detail.paymentAttempts ?? [];
  if (attempts.length === 0) {
    return <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-sm text-white/35">No online checkout attempts recorded for this invoice.</div>;
  }
  return (
    <section className="rounded-xl border border-cyan-800/40 bg-cyan-950/10 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-cyan-300" />
        <div>
          <h4 className="text-sm font-semibold text-cyan-100">Payment Attempt History</h4>
          <p className="text-[11px] text-white/40">Chronological online checkout audit trail. Receipts are issued only for captured payments.</p>
        </div>
      </div>
      <div className="space-y-2">
        {attempts.map((attempt, index) => (
          <details key={attempt.id} className="group rounded-lg border border-white/10 bg-slate-950/30" open={attempts.length === 1}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
              <ChevronDown className="h-3.5 w-3.5 text-white/40 transition-transform group-open:rotate-180" />
              <span className="text-xs font-semibold text-white/75">Attempt #{attempt.attemptNumber ?? index + 1}</span>
              <AttemptOutcomeBadge outcome={attempt.outcome} />
              <span className="ml-auto text-[11px] text-white/35">{fmtDateTime(attempt.createdAt)}</span>
            </summary>
            <div className="border-t border-white/10 px-3 pb-3 pt-2 space-y-3">
              <div className="grid gap-1 text-xs sm:grid-cols-2">
                <TxnDetailRow label="Order ID" value={<span className="font-mono text-[11px]">{attempt.razorpayOrderId ?? "Unavailable"}</span>} />
                <TxnDetailRow label="Payment ID" value={<span className="font-mono text-[11px]">{attempt.razorpayPaymentId ?? "Not created"}</span>} />
                <TxnDetailRow label="Amount" value={attempt.amountPaise == null ? "—" : `₹${(attempt.amountPaise / 100).toLocaleString("en-IN")}`} />
                <TxnDetailRow label="Source" value={attempt.source} />
                {attempt.errorCode && <TxnDetailRow label="Failure" value={`${attempt.errorCode}${attempt.errorDescription ? ` — ${attempt.errorDescription}` : ""}`} />}
                {attempt.apiEnrichmentStatus && <TxnDetailRow label="Enrichment" value={`${attempt.apiEnrichmentStatus}${attempt.apiEnrichmentError ? ` — ${attempt.apiEnrichmentError}` : ""}`} />}
              </div>
              <div className="border-l border-cyan-700/40 pl-3 space-y-2">
                {attempt.events.map(event => (
                  <details key={event.id} className="rounded border border-white/10 bg-black/15 px-2 py-1.5">
                    <summary className="cursor-pointer list-none flex items-center gap-2 text-xs">
                      <span className="font-medium text-white/80">{event.eventType.replace(/_/g, " ")}</span>
                      <AttemptOutcomeBadge outcome={event.outcome} />
                      {event.historical && <span className="text-[10px] text-amber-300">historical projection</span>}
                      <span className="ml-auto text-[10px] text-white/35">{fmtDateTime(event.occurredAt ?? event.recordedAt)}</span>
                    </summary>
                    <div className="mt-2 space-y-1 text-[11px] text-white/55">
                      {event.refundId && <p>Refund: <span className="font-mono">{event.refundId}</span></p>}
                      {event.disputeId && <p>Dispute: <span className="font-mono">{event.disputeId}</span></p>}
                      {event.providerOccurredAt
                        ? <p>Provider event time: {fmtDateTime(event.providerOccurredAt)}</p>
                        : <p>Provider event time: unavailable</p>}
                      <p>Recorded by application: {fmtDateTime(event.recordedAt)}</p>
                      {event.payload != null && <pre className="max-h-44 overflow-auto rounded bg-black/30 p-2 text-[10px] leading-relaxed text-cyan-100/75">{JSON.stringify(event.payload, null, 2)}</pre>}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </details>
        ))}
      </div>
      {(detail.webhookEvents ?? []).length > 0 && (
        <details className="text-xs text-white/55">
          <summary className="cursor-pointer text-white/55">Webhook deliveries ({detail.webhookEvents.length})</summary>
          <div className="mt-2 space-y-1.5">
            {detail.webhookEvents.map(event => (
              <details key={event.id} className="rounded border border-white/10 px-2 py-1.5">
                <summary className="cursor-pointer list-none flex gap-2 items-center">
                  <span className="font-mono text-[10px] text-cyan-200">{event.eventType}</span>
                  <span className="capitalize">{event.processingStatus}</span>
                  <span className="text-[10px] text-white/35">delivery ×{event.deliveryCount} · {fmtDateTime(event.receivedAt)}</span>
                </summary>
                <div className="mt-1 text-[10px] text-white/45">
                  Verification: {event.verificationStatus} · Resolution: {event.resolutionStatus}{event.resolutionSource ? ` via ${event.resolutionSource.replace(/_/g, " ")}` : ""}
                  {event.resolutionReason ? ` · ${event.resolutionReason}` : ""}
                  {event.providerOccurredAt ? ` · provider time ${fmtDateTime(event.providerOccurredAt)}` : ""}
                </div>
                {(event.razorpayRefundId || event.razorpayDisputeId) && <div className="text-[10px] text-white/45">{event.razorpayRefundId ? `Refund: ${event.razorpayRefundId}` : `Dispute: ${event.razorpayDisputeId}`}</div>}
                {event.payload != null && <pre className="mt-2 max-h-44 overflow-auto rounded bg-black/30 p-2 text-[10px] text-cyan-100/75">{JSON.stringify(event.payload, null, 2)}</pre>}
                {(detail.webhookProcessingEvents ?? []).filter(processing => processing.webhookDeliveryId === event.id).map(processing => (
                  <div key={processing.id} className="mt-1 border-t border-white/10 pt-1 text-[10px] text-amber-200/70">
                    Processing {processing.status} · {fmtDateTime(processing.createdAt)}
                    {processing.error ? ` · ${processing.error}` : ""}
                  </div>
                ))}
              </details>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function invoiceFrequencyLabel(frequency: string | null): string {
  const labels: Record<string, string> = {
    monthly: "Monthly",
    quarterly: "Quarterly",
    annual: "Annual",
    "one-time": "One-Time",
  };
  return frequency ? (labels[frequency] ?? frequency) : "—";
}

function lateFeeRuleLabel(type: string | undefined): string {
  if (type === "FLAT") return "Flat One-Time Penalty";
  if (type === "DAILY") return "Daily Accumulating Fine";
  if (type === "TIERED") return "Tiered Schedule";
  return type ?? "—";
}

function invoiceFeePeriodLabel(feeRecord: Pick<TransactionDetail["feeRecord"], "feePeriodStart" | "feePeriodEnd" | "frequency" | "academicYear">): string {
  if (!feeRecord.feePeriodStart || !feeRecord.feePeriodEnd) return "—";
  if ((feeRecord.frequency === "annual" || feeRecord.frequency === "one-time") && feeRecord.academicYear) {
    return feeRecord.academicYear;
  }
  return clientFeePeriodLabel(feeRecord.feePeriodStart, feeRecord.feePeriodEnd);
}

function escapeInvoiceHtml(value: unknown): string {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function printCreatedInvoice(detail: TransactionDetail, existingWindow?: Window | null): boolean {
  const { feeRecord, student, school } = detail;
  const lateFee = feeRecord.lateFeeConfig;
  const lateFeeEnabled = lateFee?.enabled === true;
  const feePeriod = invoiceFeePeriodLabel(feeRecord);
  const invoiceAmount = Number(feeRecord.amount);
  const assessedLateFee = Math.max(0, Number(feeRecord.lateFeeAmount ?? 0));
  const totalPayable = invoiceAmount + assessedLateFee;
  const fmtInvoiceAmount = (amount: number) => formatIndianRupees(amount);
  const componentSubtotal = feeRecord.breakdown.reduce(
    (total, component) => total + Number(component.amount ?? 0),
    0,
  );
  // Due date is a calendar DATE value — format it calendar-only so it never
  // shifts across a timezone boundary.
  const formatIssueDate = (value: string | null) => formatDateOnly(value);
  const schoolAddress = [
    school.addressLine1,
    school.addressLine2,
    [school.city, school.state, school.pinCode].filter(Boolean).join(", "),
    school.country && school.country !== "India" ? school.country : null,
  ].filter(Boolean);
  const schoolContact = [
    school.phone ? `Phone: ${school.phone}` : null,
    school.email ? `Email: ${school.email}` : null,
  ].filter(Boolean);
  const schoolRegulatoryDetails = [
    school.affiliationNumber ? `Affiliation No. ${school.affiliationNumber}` : null,
    school.gstin ? `GSTIN ${school.gstin}` : null,
  ].filter(Boolean);
  const lateFeePolicy = !lateFeeEnabled
    ? `<div class="policy policy-disabled"><span>Late Fee &amp; Penalty</span><strong>Disabled</strong></div>`
    : `
      <section class="policy">
        <div class="policy-heading"><span>Late Fee &amp; Penalty</span><strong>Enabled</strong></div>
        <dl class="policy-grid">
          <div><dt>Rule type</dt><dd>${escapeInvoiceHtml(lateFeeRuleLabel(lateFee?.type))}</dd></div>
          ${lateFee?.type === "FLAT" ? `<div><dt>Penalty amount</dt><dd>${escapeInvoiceHtml(fmt(Number(lateFee.flat_amount ?? 0)))}</dd></div>` : ""}
          ${lateFee?.type === "DAILY" ? `<div><dt>Daily penalty</dt><dd>${escapeInvoiceHtml(fmt(Number(lateFee.daily_rate ?? 0)))} / day</dd></div>` : ""}
          ${lateFee?.type === "DAILY" && Number(lateFee.grace_period_days ?? 0) > 0 ? `<div><dt>Grace period</dt><dd>${escapeInvoiceHtml(lateFee.grace_period_days)} day(s)</dd></div>` : ""}
          ${lateFee?.type === "DAILY" && Number(lateFee.max_cap ?? 0) > 0 ? `<div><dt>Maximum cap</dt><dd>${escapeInvoiceHtml(fmt(Number(lateFee.max_cap)))}</dd></div>` : ""}
          ${lateFee?.type === "TIERED" && lateFee.tiered_slabs?.length ? `<div class="policy-full"><dt>Penalty schedule</dt><dd>${lateFee.tiered_slabs.map(slab => `${escapeInvoiceHtml(slab.from_day)}–${escapeInvoiceHtml(slab.to_day)} days: ${escapeInvoiceHtml(fmt(Number(slab.amount)))}`).join(" &nbsp;•&nbsp; ")}</dd></div>` : ""}
        </dl>
      </section>
    `;
  const componentRows = feeRecord.breakdown.length > 0
    ? `
      <section class="document-section component-section">
        <div class="section-label">Fee Breakdown</div>
        <table class="invoice-table">
          <thead><tr><th>Component</th><th>Description</th><th class="amount-cell">Amount</th></tr></thead>
          <tbody>${feeRecord.breakdown.map(component => `
            <tr>
              <td>${escapeInvoiceHtml(component.name)}</td>
              <td>${escapeInvoiceHtml(component.purpose || "—")}</td>
              <td class="amount-cell">${escapeInvoiceHtml(fmt(Number(component.amount)))}</td>
            </tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="2">Component subtotal</td><td class="amount-cell">${escapeInvoiceHtml(fmt(componentSubtotal))}</td></tr></tfoot>
        </table>
      </section>`
    : "";
  const logo = school.logoUrl
    ? `<img class="school-logo" src="${escapeInvoiceHtml(school.logoUrl)}" alt="" onerror="this.style.display='none'">`
    : "";
  const printWindow = existingWindow ?? window.open("", "_blank");
  if (!printWindow) return false;
  // Keep a usable same-origin document reference for printing while preventing
  // the printed tab from retaining access back to the admin portal.
  printWindow.opener = null;
  printWindow.document.write(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice ${escapeInvoiceHtml(feeRecord.invoiceNumber)}</title>
<style>
  @page{size:A4;margin:15mm}
  :root{color-scheme:light} *{box-sizing:border-box}
  body{margin:0;background:#edf1f5;color:#172033;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:10.5pt;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .invoice{width:min(100%,180mm);min-height:267mm;margin:24px auto;background:#fff;box-shadow:0 8px 28px rgba(15,39,71,.14);padding:0 11mm 8mm}
  .invoice-header{display:flex;justify-content:space-between;gap:18mm;padding:11mm 0 8mm;border-bottom:2px solid #183b61}
  .school-identity{display:flex;gap:12px;min-width:0}.school-logo{width:42px;height:42px;object-fit:contain;flex:0 0 auto}.school-name{font-size:16pt;line-height:1.15;font-weight:800;letter-spacing:-.025em;color:#102b49;margin:0 0 5px}.school-address,.school-contact,.school-regulatory{font-size:8.6pt;color:#536579;margin:0;overflow-wrap:anywhere}.school-contact{margin-top:3px}.school-regulatory{margin-top:2px;color:#75869a}
  .document-title{text-align:right;flex:0 0 auto}.document-title h1{font-size:24pt;letter-spacing:.15em;line-height:1;margin:0 0 9px;color:#102b49;font-weight:850}.invoice-number-label,.section-label,.metadata-label{display:block;font-size:8.2pt;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:#708196}.invoice-number{font-size:17pt;font-weight:850;color:#102b49;letter-spacing:.035em;overflow-wrap:anywhere}.status-badge{display:inline-block;margin-top:8px;border:1px solid #c78b24;background:#fff7e8;color:#8b5a08;padding:3px 8px;font-size:8pt;line-height:1.25;font-weight:800;letter-spacing:.1em}
  .metadata-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:8mm 0 6mm;border-bottom:1px solid #d9e1e8}.metadata-card{min-width:0}.metadata-card+.metadata-card{border-left:1px solid #d9e1e8;padding-left:16px}.metadata-title{margin:0 0 8px;color:#102b49;font-size:8.2pt;text-transform:uppercase;letter-spacing:.13em;font-weight:800}.student-name{font-size:13pt;color:#172033;font-weight:800;margin:0 0 3px}.student-id{margin:0;color:#627386;font-size:9pt}.metadata-rows{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;margin:10px 0 0}.metadata-label{font-size:7.6pt;align-self:baseline}.metadata-value{font-size:9.3pt;font-weight:650;text-align:right;overflow-wrap:anywhere;color:#26384a}
  .document-section{padding-top:7mm;break-inside:avoid}.invoice-table{width:100%;border-collapse:collapse;table-layout:fixed}.invoice-table th{background:#102b49;color:#fff;font-size:7.8pt;font-weight:800;letter-spacing:.1em;text-transform:uppercase;text-align:left;padding:8px 9px}.invoice-table td{padding:9px;border-bottom:1px solid #dce4eb;vertical-align:top;font-size:9.4pt;overflow-wrap:anywhere}.invoice-table td:first-child{font-weight:700;color:#26384a}.invoice-table th:first-child{width:29%}.invoice-table th:nth-child(2){width:18%}.invoice-table th:nth-child(3){width:17%}.invoice-table th:nth-child(4){width:21%}.amount-cell{text-align:right!important;font-variant-numeric:tabular-nums;white-space:nowrap}.invoice-table tfoot td{border-top:1px solid #aab8c5;border-bottom:0;background:#f6f8fa;font-size:8.8pt;font-weight:800}.component-section .invoice-table th:first-child{width:30%}.component-section .invoice-table th:nth-child(2){width:auto}.component-section .invoice-table th:nth-child(3){width:22%}
  .summary-layout{display:grid;grid-template-columns:minmax(0,1fr) 68mm;gap:16px;padding-top:7mm;align-items:start}.policy{border:1px solid #dce4eb;border-left:3px solid #3b6388;padding:10px 11px;break-inside:avoid}.policy-disabled{display:flex;align-items:center;justify-content:space-between;gap:12px;border-left-color:#aab8c5;background:#fafbfc;color:#4d5f72;font-size:9pt}.policy-heading{display:flex;justify-content:space-between;gap:12px;color:#102b49;font-size:9.2pt;font-weight:800}.policy-heading strong{color:#8b5a08}.policy-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;margin:9px 0 0}.policy-grid div{min-width:0}.policy-grid .policy-full{grid-column:1/-1}.policy-grid dt{font-size:7.4pt;text-transform:uppercase;letter-spacing:.09em;color:#708196;font-weight:800}.policy-grid dd{margin:2px 0 0;font-size:8.8pt;color:#314457;overflow-wrap:anywhere}
  .amount-summary{border:1px solid #b9c7d4;break-inside:avoid}.amount-summary-header{padding:8px 10px;background:#eef4f8;color:#102b49;font-size:8pt;font-weight:800;text-transform:uppercase;letter-spacing:.12em}.summary-rows{padding:7px 10px 0}.summary-row{display:flex;justify-content:space-between;gap:14px;padding:4px 0;color:#536579;font-size:9pt}.summary-row strong{font-variant-numeric:tabular-nums;color:#26384a}.amount-words{margin-top:7px;padding:8px 10px;border-top:1px solid #dce4eb;background:#fafbfc}.amount-words-label{display:block;color:#708196;font-size:7.4pt;text-transform:uppercase;letter-spacing:.09em;font-weight:800}.amount-words-value{display:block;margin-top:3px;color:#26384a;font-size:8.7pt;font-weight:700;line-height:1.35;overflow-wrap:anywhere}.summary-total{display:flex;justify-content:space-between;gap:14px;margin-top:7px;padding:9px 10px;background:#102b49;color:#fff;font-size:9.4pt;font-weight:800;text-transform:uppercase;letter-spacing:.055em}.summary-total strong{font-size:14pt;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:0}.payment-status{padding:8px 10px;font-size:8.2pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8b5a08;background:#fffaf0;border-top:1px solid #efd6a3}
  .notes{margin-top:7mm;border:1px solid #dce4eb;padding:10px 11px;break-inside:avoid}.notes p{margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:#34485b;font-size:9.2pt}.invoice-footer{margin-top:8mm;padding-top:5mm;border-top:1px solid #d9e1e8;color:#617387;font-size:8.1pt;text-align:center}.invoice-footer p{margin:2px 0}.invoice-footer .invoice-notice{color:#394e63;font-weight:650}
  thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}h1,h2,h3,p{orphans:3;widows:3}
  @media print{body{background:#fff}.invoice{width:auto;min-height:0;margin:0;box-shadow:none;padding:0}.invoice-header{padding-top:0}.document-section,.policy,.amount-summary,.notes{break-inside:avoid;page-break-inside:avoid}}
  @media screen and (max-width:720px){body{background:#fff}.invoice{width:100%;margin:0;padding:0 20px 24px;box-shadow:none}.invoice-header{gap:18px}.metadata-grid,.summary-layout{grid-template-columns:1fr}.metadata-card+.metadata-card{border-left:0;border-top:1px solid #d9e1e8;padding:14px 0 0}.document-title h1{font-size:18pt}.invoice-table{font-size:8.5pt}.policy-grid{grid-template-columns:1fr}}
</style></head><body>
<article class="invoice">
   <header class="invoice-header">
     <div class="school-identity">
       ${logo}
       <div>
         <p class="school-name">${escapeInvoiceHtml(school.name)}</p>
         ${schoolAddress.length ? `<p class="school-address">${schoolAddress.map(line => escapeInvoiceHtml(line)).join("<br>")}</p>` : ""}
         ${schoolContact.length ? `<p class="school-contact">${schoolContact.map(item => escapeInvoiceHtml(item)).join(" &nbsp;|&nbsp; ")}</p>` : ""}
         ${schoolRegulatoryDetails.length ? `<p class="school-regulatory">${schoolRegulatoryDetails.map(item => escapeInvoiceHtml(item)).join(" &nbsp;|&nbsp; ")}</p>` : ""}
       </div>
     </div>
     <div class="document-title">
       <h1>INVOICE</h1>
       <span class="invoice-number-label">Invoice No.</span>
       <div class="invoice-number">${escapeInvoiceHtml(feeRecord.invoiceNumber)}</div>
       <span class="status-badge">Status: ${escapeInvoiceHtml(feeRecord.status.toUpperCase())}</span>
     </div>
  </header>
   <section class="metadata-grid">
     <div class="metadata-card">
       <h2 class="metadata-title">Billed To / Student Details</h2>
       <p class="student-name">${escapeInvoiceHtml(student.name)}</p>
       <p class="student-id">Student ID / MIS ID: ${escapeInvoiceHtml(student.digitalStudentId)}</p>
       <div class="metadata-rows">
         <span class="metadata-label">Parent / Guardian</span><span class="metadata-value">${escapeInvoiceHtml(student.guardianName?.trim() || "Not available")}</span>
         <span class="metadata-label">Class</span><span class="metadata-value">${escapeInvoiceHtml(student.class)}</span>
         <span class="metadata-label">Section</span><span class="metadata-value">${escapeInvoiceHtml(student.section)}</span>
       </div>
     </div>
     <div class="metadata-card">
       <h2 class="metadata-title">Invoice Metadata</h2>
       <div class="metadata-rows">
         <span class="metadata-label">Invoice Date &amp; Time</span><span class="metadata-value">${escapeInvoiceHtml(formatPersistedInvoiceDateTimeIST(feeRecord.createdAt))}</span>
         <span class="metadata-label">Academic Session</span><span class="metadata-value">${escapeInvoiceHtml(feeRecord.academicYear)}</span>
         <span class="metadata-label">Fee Period</span><span class="metadata-value">${escapeInvoiceHtml(feePeriod)}</span>
         <span class="metadata-label">Due Date</span><span class="metadata-value">${escapeInvoiceHtml(formatIssueDate(feeRecord.dueDate))}</span>
         <span class="metadata-label">Frequency</span><span class="metadata-value">${escapeInvoiceHtml(invoiceFrequencyLabel(feeRecord.frequency))}</span>
       </div>
     </div>
   </section>
   <section class="document-section">
     <div class="section-label">Invoice Details</div>
     <table class="invoice-table">
       <thead><tr><th>Description</th><th>Fee Type</th><th>Frequency</th><th>Fee Period</th><th class="amount-cell">Amount</th></tr></thead>
       <tbody><tr><td>${escapeInvoiceHtml(feeRecord.feeName)}</td><td>${escapeInvoiceHtml(feeRecord.feeType)}</td><td>${escapeInvoiceHtml(invoiceFrequencyLabel(feeRecord.frequency))}</td><td>${escapeInvoiceHtml(feePeriod)}</td><td class="amount-cell">${escapeInvoiceHtml(fmtInvoiceAmount(invoiceAmount))}</td></tr></tbody>
     </table>
   </section>
   ${componentRows}
   <section class="summary-layout">
     <div>${lateFeePolicy}</div>
     <aside class="amount-summary">
       <div class="amount-summary-header">Amount Summary</div>
       <div class="summary-rows">
         <div class="summary-row"><span>Invoice amount</span><strong>${escapeInvoiceHtml(fmtInvoiceAmount(invoiceAmount))}</strong></div>
         ${assessedLateFee > 0 ? `<div class="summary-row"><span>Late fee assessed</span><strong>${escapeInvoiceHtml(fmtInvoiceAmount(assessedLateFee))}</strong></div>` : ""}
       </div>
       <div class="amount-words"><span class="amount-words-label">Amount in Words</span><span class="amount-words-value">${escapeInvoiceHtml(amountInWords(invoiceAmount))}</span></div>
       <div class="summary-total"><span>Total Payable</span><strong>${escapeInvoiceHtml(fmtInvoiceAmount(totalPayable))}</strong></div>
       <div class="payment-status">Payment Status: ${escapeInvoiceHtml(feeRecord.status.toUpperCase())}</div>
     </aside>
   </section>
   ${feeRecord.notes ? `<section class="notes"><span class="section-label">Notes</span><p>${escapeInvoiceHtml(feeRecord.notes)}</p></section>` : ""}
   <footer class="invoice-footer">
     <p class="invoice-notice">This document is an invoice and confirms the amount due. A payment receipt will be issued separately after successful payment.</p>
     ${schoolContact.length ? `<p>${schoolContact.map(item => escapeInvoiceHtml(item)).join(" &nbsp;|&nbsp; ")}</p>` : ""}
     <p>Computer-generated invoice. No signature is required.</p>
   </footer>
</article>
<script>
  (function () {
    var printDocument = function () { window.setTimeout(function () { window.print(); }, 180); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(printDocument);
    else if (document.readyState === "complete") printDocument();
    else window.addEventListener("load", printDocument, { once: true });
  })();
</script></body></html>`);
  printWindow.document.close();
  return true;
}

// IST helpers — always use Asia/Kolkata so the time is correct regardless of
// the server's or browser's local timezone.
function fmtDateTimeIST(ts: string | Date | null | undefined): string {
  return formatPersistedInvoiceDateTimeIST(ts);
}

/** Returns the current wall-clock time formatted in IST, e.g. "09:15 PM IST" */
function nowIST(): string {
  return new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase() + " IST";
}

function StatusChip({ status }: { status: string }) {
  const variants: Record<string, { cls: string; icon: React.ReactNode }> = {
    Paid:    { cls: "bg-emerald-900/40 text-emerald-400 border-emerald-700/40", icon: <CheckCircle2 className="w-3 h-3" /> },
    Overdue: { cls: "bg-red-900/40 text-red-400 border-red-700/40",           icon: <AlertTriangle className="w-3 h-3" /> },
    Due:     { cls: "bg-amber-900/40 text-amber-400 border-amber-700/40",     icon: <Clock className="w-3 h-3" /> },
  };
  const v = variants[status] ?? variants.Due;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${v.cls}`}>
      {v.icon} {status}
    </span>
  );
}

function PaymentMethodBadge({ method: rawMethod }: { method: string | null }) {
  // Normalize the legacy "Online" stored value to its canonical display label.
  const method = rawMethod === "Online" ? "Portal Payment" : rawMethod;
  const variants: Record<string, { cls: string; icon?: React.ReactNode }> = {
    Cash: {
      cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
      icon: <Wallet className="w-3 h-3" />,
    },
    Cheque: {
      cls: "bg-blue-500/10 text-blue-300 border-blue-500/25",
      icon: <FileCheck2 className="w-3 h-3" />,
    },
    "Bank Transfer": {
      cls: "bg-indigo-500/10 text-indigo-300 border-indigo-500/25",
      icon: <Building2 className="w-3 h-3" />,
    },
    "Demand Draft": {
      cls: "bg-amber-500/10 text-amber-300 border-amber-500/25",
      icon: <FileText className="w-3 h-3" />,
    },
    "UPI / QR": {
      cls: "bg-cyan-500/10 text-cyan-300 border-cyan-500/25",
      icon: <QrCode className="w-3 h-3" />,
    },
    "Portal Payment": {
      cls: "bg-violet-500/10 text-violet-300 border-violet-500/25",
      icon: <Monitor className="w-3 h-3" />,
    },
    "—": {
      cls: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    },
  };
  const label = method ?? "—";
  const variant = variants[label] ?? variants["—"];

  return (
    <span
      className={`inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium leading-4 whitespace-nowrap ${variant.cls}`}
      title={label}
    >
      {variant.icon && <span aria-hidden="true">{variant.icon}</span>}
      {label}
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
    payment_failed:   "bg-red-900/60 text-red-400 border-red-700/60",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border ${map[action] ?? "bg-white/10 text-white/60 border-white/10"}`}>
      {action}
    </span>
  );
}

function TxnDetailRow({ label, value }: { label: string; value: React.ReactNode | string | null | undefined }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-white/35 w-28 shrink-0 leading-snug">{label}</span>
      <span className="text-white/80 font-medium leading-snug break-all">
        {value == null || value === "" ? <span className="text-white/25 italic">—</span> : value}
      </span>
    </div>
  );
}

function OfflinePaymentCorrectionDialog({
  payment,
  onSaved,
}: {
  payment: PaymentRecord;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const fields = payment.paymentMethod === "Cash"
    ? [{ key: "collectionLocation", label: "Collection Location", placeholder: "e.g. Main fee counter" }]
    : payment.paymentMethod === "UpiQr"
      ? [
          { key: "referenceNumber", label: "UPI Transaction ID / UTR", placeholder: "Transaction reference" },
          { key: "instrumentDate", label: "Payment Date", placeholder: "", type: "date" },
          { key: "bankName", label: "Bank / UPI App", placeholder: "e.g. GPay, HDFC" },
          { key: "payerName", label: "Payer Name", placeholder: "Account holder" },
          { key: "payerUpiId", label: "Payer UPI ID", placeholder: "name@upi" },
          { key: "transactionTime", label: "Payment Time", placeholder: "", type: "time" },
          { key: "instrumentStatus", label: "Payment Status", placeholder: "e.g. Verified" },
          { key: "transactionReference", label: "Bank / PSP Reference", placeholder: "Optional bank reference" },
          { key: "receiverUpiId", label: "Receiver UPI ID", placeholder: "school@bank" },
        ]
      : payment.paymentMethod === "BankTransfer"
        ? [
            { key: "referenceNumber", label: "UTR Number", placeholder: "Transfer reference" },
            { key: "instrumentDate", label: "Transfer Date", placeholder: "", type: "date" },
            { key: "bankName", label: "Payer Bank", placeholder: "Sender's bank" },
            { key: "branchName", label: "Branch", placeholder: "Branch name" },
            { key: "payerName", label: "Payer / Sender", placeholder: "Account holder" },
            { key: "transactionTime", label: "Transfer Time", placeholder: "", type: "time" },
            { key: "instrumentStatus", label: "Transfer Status", placeholder: "e.g. Verified" },
            { key: "transferMode", label: "Transfer Mode", placeholder: "NEFT, RTGS, IMPS" },
            { key: "transactionReference", label: "Bank Transaction Reference", placeholder: "Internal / bank reference" },
            { key: "receivingBank", label: "Receiving Bank", placeholder: "School account bank" },
          ]
        : [
            { key: "referenceNumber", label: payment.paymentMethod === "Cheque" ? "Cheque Number" : "DD Number", placeholder: "Instrument number" },
            { key: "instrumentDate", label: payment.paymentMethod === "Cheque" ? "Cheque Date" : "DD Date", placeholder: "", type: "date" },
            { key: "bankName", label: "Bank Name", placeholder: "Bank" },
            { key: "branchName", label: "Branch", placeholder: "Branch name" },
            { key: "payerName", label: "Payer Name", placeholder: "Account holder" },
            { key: "instrumentStatus", label: "Instrument Status", placeholder: "Received, Cleared, Returned" },
            { key: "payeeName", label: "Payee Name", placeholder: "Named payee" },
            ...(payment.paymentMethod === "DemandDraft" ? [{ key: "payableAt", label: "Payable At", placeholder: "City / branch" }] : []),
            { key: "depositDate", label: "Deposit Date", placeholder: "", type: "date" },
            { key: "depositBank", label: "Deposit Bank", placeholder: "Bank" },
            { key: "depositReference", label: "Deposit Reference", placeholder: "Slip / reference" },
            { key: "returnDate", label: "Return Date", placeholder: "", type: "date" },
            { key: "returnReason", label: "Return / Bounce Reason", placeholder: "Reason, if returned" },
          ];

  useEffect(() => {
    if (!open) return;
    setReason("");
    setValues({
      referenceNumber: payment.referenceNumber ?? "",
      instrumentDate: payment.instrumentDate ?? "",
      bankName: payment.bankName ?? "",
      branchName: payment.branchName ?? "",
      payerName: payment.payerName ?? "",
      payerUpiId: payment.vpa ?? "",
      transactionTime: payment.offlineDetail?.transactionTime ?? "",
      instrumentStatus: payment.offlineDetail?.instrumentStatus ?? "",
      transferMode: payment.offlineDetail?.transferMode ?? "",
      transactionReference: payment.offlineDetail?.transactionReference ?? "",
      receivingBank: payment.offlineDetail?.receivingBank ?? "",
      receiverUpiId: payment.offlineDetail?.receiverUpiId ?? "",
      payeeName: payment.offlineDetail?.payeeName ?? "",
      payableAt: payment.offlineDetail?.payableAt ?? "",
      collectionLocation: payment.offlineDetail?.collectionLocation ?? "",
      depositDate: payment.offlineDetail?.depositDate ?? "",
      depositBank: payment.offlineDetail?.depositBank ?? "",
      depositReference: payment.offlineDetail?.depositReference ?? "",
      returnDate: payment.offlineDetail?.returnDate ?? "",
      returnReason: payment.offlineDetail?.returnReason ?? "",
    });
  }, [open, payment]);

  async function save() {
    if (reason.trim().length < 3) {
      toast({ title: "Reason required", description: "Explain why this accounting detail is being corrected.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const response = await sessionFetch(`/api/admin/fees/payments/${payment.id}/offline-details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim(),
          ...Object.fromEntries(fields.map(field => [field.key, (values[field.key] ?? "").trim()])),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Could not save correction");
      toast({ title: "Correction recorded", description: "The previous value was preserved in the payment audit trail." });
      setOpen(false);
      onSaved();
    } catch (error: any) {
      toast({ title: "Correction not saved", description: error.message ?? "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}
        className="h-7 border-amber-500/30 text-amber-300 hover:bg-amber-500/10">
        Correct details
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Correct Offline Payment Details</DialogTitle></DialogHeader>
          <p className="text-xs text-white/50">The payment amount, receipt, method, invoice, and original entry stay unchanged. This correction creates a before/after audit record.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map(field => (
              <div key={field.key} className={field.key === "returnReason" || field.key === "collectionLocation" ? "sm:col-span-2" : ""}>
                <label className="text-xs text-white/60 mb-1 block">{field.label}</label>
                <Input
                  type={field.type ?? "text"}
                  value={values[field.key] ?? ""}
                  onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                  className="bg-[#0A1628] border-white/20 text-white"
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-white/60 mb-1 block">Correction Reason <span className="text-red-400">*</span></label>
              <Input value={reason} onChange={event => setReason(event.target.value)} placeholder="Why is this being corrected?" className="bg-[#0A1628] border-white/20 text-white" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-amber-600 hover:bg-amber-500">
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Save audited correction
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

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

/** Denomination face values (₹) for cash payment counting */
const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

// ─── Standalone Offline Payment Modal (Invoice-Picker) ────────────────────────
// Admin selects a student → sees their unpaid invoices → picks one invoice →
// enters payment method/date → one payment is created for that invoice.
// No free-form fee-type or amount entry — amounts come exclusively from invoices.

interface StandaloneOfflinePayModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

function StandaloneOfflinePayModal({ open, onClose, onSuccess }: StandaloneOfflinePayModalProps) {
  const { toast } = useToast();
  type Step = "search" | "select" | "payment" | "done";
  const [step, setStep] = useState<Step>("search");

  // Student search — backend-driven; two separate fields (invoice number vs name/DSID)
  const [searchInvoice, setSearchInvoice] = useState("");
  const [searchQ,       setSearchQ]       = useState("");
  const [searching,     setSearching]     = useState(false);
  const [searchResults, setSearchResults] = useState<StudentItem[] | null>(null);
  const [searchError,   setSearchError]   = useState<string | null>(null);
  const [selStudent,    setSelStudent]    = useState<StudentItem | null>(null);

  // Unpaid invoices for selected student
  const [invoices,       setInvoices]       = useState<UnpaidInvoice[]>([]);
  const [invoicesLoading,setInvoicesLoading] = useState(false);

  // A single offline payment must be linked to a single invoice.
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

  // Payment details
  const [method,   setMethod]   = useState("Cash");
  const [ref,      setRef]      = useState("");
  const [date,     setDate]     = useState(() => todayInIST());
  const [notes,    setNotes]    = useState("");
  // Cash denomination state — keys are denomination face values, values are counts
  const [denomQty,   setDenomQty]   = useState<Record<number, number>>(() => Object.fromEntries(DENOMS.map(d => [d, 0])));
  // Method-specific extra fields (Cheque / BankTransfer / DemandDraft / UpiQr)
  const [instrDate,  setInstrDate]  = useState("");   // instrument date (cheque / DD / transfer / UPI payment date)
  const [bankName,   setBankName]   = useState("");
  const [branchName, setBranchName] = useState("");
  const [payerName,  setPayerName]  = useState("");
  const [payerUpiId, setPayerUpiId] = useState("");   // UPI / QR: payer's UPI ID / VPA
  // Additional accounting fields are deliberately method-specific. They are
  // stored separately from the shared payment record to keep the audit clean.
  const [transactionTime, setTransactionTime] = useState("");
  const [instrumentStatus, setInstrumentStatus] = useState("");
  const [transferMode, setTransferMode] = useState("");
  const [transactionReference, setTransactionReference] = useState("");
  const [receivingBank, setReceivingBank] = useState("");
  const [receiverUpiId, setReceiverUpiId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [payableAt, setPayableAt] = useState("");
  const [collectionLocation, setCollectionLocation] = useState("");
  const [depositDate, setDepositDate] = useState("");
  const [depositBank, setDepositBank] = useState("");
  const [depositReference, setDepositReference] = useState("");

  // Submit state
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState<string | null>(null);
  const [donePayments, setDonePayments] = useState<Array<{ id: number; receipt: string; feeType: string; amount: number }>>([]);

  // Idempotency key — one per modal open and one selected invoice
  const [baseKey, setBaseKey] = useState("");

  // Reset on every open
  useEffect(() => {
    if (!open) return;
    setStep("search");
    setSearchInvoice(""); setSearchQ(""); setSearching(false); setSearchResults(null); setSearchError(null); setSelStudent(null);
    setInvoices([]); setInvoicesLoading(false);
    setSelectedInvoiceId(null);
    setMethod("Cash"); setRef(""); setDate(todayInIST()); setNotes("");
    setDenomQty(Object.fromEntries(DENOMS.map(d => [d, 0])));
    setInstrDate(""); setBankName(""); setBranchName(""); setPayerName(""); setPayerUpiId("");
    setTransactionTime(""); setInstrumentStatus(""); setTransferMode(""); setTransactionReference("");
    setReceivingBank(""); setReceiverUpiId(""); setPayeeName(""); setPayableAt("");
    setCollectionLocation(""); setDepositDate(""); setDepositBank(""); setDepositReference("");
    setSubmitting(false); setSubmitError(null); setDonePayments([]);
    setBaseKey(`idem-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }, [open]);

  const selectPaymentMethod = (nextMethod: string) => {
    const defaults = offlinePaymentEntryDefaults(nextMethod);
    setMethod(nextMethod);
    setRef(""); setInstrDate(""); setBankName(""); setBranchName(""); setPayerName(""); setPayerUpiId("");
    setTransactionTime(""); setInstrumentStatus(defaults.instrumentStatus ?? "");
    setTransferMode(defaults.transferMode ?? ""); setTransactionReference("");
    setReceivingBank(""); setReceiverUpiId(""); setPayeeName(""); setPayableAt("");
    setCollectionLocation(""); setDepositDate(""); setDepositBank(""); setDepositReference("");
  };

  // Search students — invoice number uses dedicated param; name/DSID uses ?q=
  async function doSearch() {
    const inv = searchInvoice.trim();
    const q   = searchQ.trim();
    if (!inv && !q)   { setSearchError("Enter an invoice number or student name / DSID to search"); return; }
    if (inv && q)     { setSearchError("Use only one field at a time"); return; }
    if ((inv || q).length < 2) { setSearchError("Enter at least 2 characters to search"); return; }

    setSearching(true); setSearchError(null); setSearchResults(null);
    try {
      const param = inv
        ? `invoiceNumber=${encodeURIComponent(inv)}`
        : `q=${encodeURIComponent(q)}`;
      const r    = await sessionFetch(`/api/admin/fees/students/search?${param}`);
      const body = await r.json();
      if (!r.ok) { setSearchError(body.message ?? "Search failed"); return; }
      setSearchResults(body as StudentItem[]);
    } catch (e: any) { setSearchError(e?.message ?? "Network error — please try again"); }
    finally  { setSearching(false); }
  }

  // Fetch unpaid invoices for a student
  async function fetchInvoices(studentId: number) {
    setInvoicesLoading(true);
    try {
      const r = await sessionFetch(`/api/admin/fees/students/${studentId}/unpaid-invoices`);
      if (!r.ok) { toast({ title: "Error", description: "Failed to load invoices", variant: "destructive" }); return; }
      const data: UnpaidInvoice[] = await r.json();
      setInvoices(data);
      // An admin must deliberately choose the one invoice being settled.
      setSelectedInvoiceId(null);
      setStep("select");
    } catch { toast({ title: "Error", description: "Network error", variant: "destructive" }); }
    finally   { setInvoicesLoading(false); }
  }

  const selectedInvoice = invoices.find(i => i.id === selectedInvoiceId) ?? null;
  const totalAmount = selectedInvoice?.totalDue ?? 0;

  // Cash denomination totals — used in the payment step verification panel
  const cashTotal = DENOMS.reduce((s, d) => s + d * (denomQty[d] ?? 0), 0);
  const cashDiff  = cashTotal - totalAmount;
  const cashMatch = cashTotal > 0 && cashDiff === 0;
  // Submit guard per spec req 20:
  //  Cash         — denomination total matches invoice + received date
  //  Cheque       — cheque number + cheque date + received date
  //  BankTransfer — UTR + transfer date + received date
  //  DemandDraft  — DD number + DD date + received date
  const canSubmit = selectedInvoice != null && (method === "Cash"
    ? cashMatch && date.length > 0
    : ref.trim().length > 0 && instrDate.length > 0 && date.length > 0);

  async function doSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    if (!selectedInvoice) {
      setSubmitError("Select one unpaid invoice before recording the payment.");
      setSubmitting(false);
      return;
    }
    const inv = selectedInvoice;
    const payload: Record<string, any> = {
      feeRecordId:    inv.id,
      studentId:      inv.studentId,
      paymentMethod:  method,
      receivedDate:   date,
      amount:         inv.totalDue,
      lateFeePaid:    inv.accruedLateFee,
      cashierNotes:   notes || null,
      idempotencyKey: baseKey,
      offlineDetails: {
        transactionTime: transactionTime || null,
        instrumentStatus: instrumentStatus || null,
        transferMode: transferMode || null,
        transactionReference: transactionReference || null,
        receivingBank: receivingBank || null,
        receiverUpiId: receiverUpiId || null,
        payeeName: payeeName || null,
        payableAt: payableAt || null,
        collectionLocation: collectionLocation || null,
        depositDate: depositDate || null,
        depositBank: depositBank || null,
        depositReference: depositReference || null,
      },
    };

    if (method === "Cash") {
      payload.denominationBreakdown = denomQty;
      payload.denominationTotal     = totalAmount;
    } else if (method === "UpiQr") {
      payload.referenceNumber = ref        || null;  // UTR
      payload.chequeDate      = instrDate  || null;  // Payment Date
      payload.bankName        = bankName   || null;  // Bank / UPI App
      payload.payerName       = payerName  || null;
      payload.payerUpiId      = payerUpiId || null;
    } else {
      payload.referenceNumber = ref        || null;
      payload.chequeDate      = instrDate  || null;
      payload.bankName        = bankName   || null;
      payload.branchName      = branchName || null;
      payload.payerName       = payerName  || null;
    }

    try {
      const r    = await sessionFetch("/api/admin/fees/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? "Payment failed");
      setDonePayments([{ id: body.id, receipt: body.receipt_number ?? "—", feeType: inv.feeType, amount: inv.totalDue }]);
    } catch (e: any) {
      setSubmitError(e.message);
      setSubmitting(false);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/failed-counts"] });
    onSuccess?.();
    setSubmitting(false);
    setStep("done");
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-cyan-400">
            <Banknote className="w-5 h-5" />
            {step === "done" ? "Payment Recorded" : "Record Offline Payment"}
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Search student ──────────────────────────────────────────── */}
        {step === "search" && (
          <div className="space-y-4">
            {selStudent ? (
              /* ── Selected student chip ───────────────────────────────── */
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/40">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{selStudent.name}</p>
                  <p className="text-white/40 text-xs">{selStudent.digitalStudentId} · Class {selStudent.class}-{selStudent.section}</p>
                </div>
                <button type="button"
                  onClick={() => { setSelStudent(null); setSearchResults(null); setSearchError(null); }}
                  className="text-white/40 hover:text-red-400 shrink-0 text-lg leading-none">✕</button>
              </div>
            ) : (
              /* ── Search form ─────────────────────────────────────────── */
              <div className="space-y-3">
                {/* Invoice Number row */}
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Invoice Number</label>
                  <input
                    value={searchInvoice}
                    onChange={e => { setSearchInvoice(e.target.value); setSearchError(null); }}
                    onKeyDown={e => e.key === "Enter" && doSearch()}
                    placeholder="e.g. INV-0071"
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20"
                  />
                </div>

                {/* Divider */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 border-t border-white/10" />
                  <span className="text-white/20 text-xs">or</span>
                  <div className="flex-1 border-t border-white/10" />
                </div>

                {/* Student Name / DSID row */}
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Student Name / DSID</label>
                  <input
                    value={searchQ}
                    onChange={e => { setSearchQ(e.target.value); setSearchError(null); }}
                    onKeyDown={e => e.key === "Enter" && doSearch()}
                    placeholder="e.g. Rahul or MIS-0003"
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20"
                  />
                </div>

                {/* Error */}
                {searchError && (
                  <p className="text-red-400 text-xs flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />{searchError}
                  </p>
                )}

                {/* Results */}
                {searchResults !== null && !searchError && (
                  searchResults.length === 0
                    ? <p className="text-white/40 text-xs">No students found.</p>
                    : <div className="max-h-44 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
                        {searchResults.map(s => (
                          <button key={s.id} type="button"
                            onClick={() => { setSelStudent(s); setSearchResults(null); }}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors">
                            <p className="text-white text-sm">{s.name}</p>
                            <p className="text-white/40 text-xs">{s.digitalStudentId} · Class {s.class}-{s.section}</p>
                          </button>
                        ))}
                      </div>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={onClose} className="text-white/60">Cancel</Button>
              {!selStudent ? (
                <button type="button" onClick={doSearch} disabled={searching}
                  className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-1">
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Search
                </button>
              ) : (
                <Button
                  disabled={invoicesLoading}
                  onClick={() => fetchInvoices(selStudent!.id)}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1">
                  {invoicesLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  View Unpaid Invoices →
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Select one invoice ───────────────────────────────────────── */}
        {step === "select" && selStudent && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/5 border border-white/10">
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold">{selStudent.name}</p>
                <p className="text-white/40 text-xs">{selStudent.digitalStudentId} · Class {selStudent.class}-{selStudent.section}</p>
              </div>
              <button type="button" onClick={() => { setSelStudent(null); setInvoices([]); setStep("search"); }}
                className="text-white/40 hover:text-cyan-400 text-xs">← Change</button>
            </div>

            {invoices.length === 0 ? (
              <div className="p-6 rounded-lg bg-white/5 border border-white/10 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-white/60 text-sm">No unpaid invoices for this student.</p>
                <p className="text-white/30 text-xs mt-1">All invoices are paid or there are no invoices yet.</p>
              </div>
            ) : (
              <>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {invoices.map(inv => {
                    const checked = selectedInvoiceId === inv.id;
                    return (
                      <button key={inv.id} type="button" role="radio" aria-checked={checked}
                        onClick={() => setSelectedInvoiceId(inv.id)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          checked
                            ? "bg-cyan-900/20 border-cyan-600/50"
                            : "bg-white/3 border-white/10 hover:border-white/20"
                        }`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                              checked ? "bg-cyan-500 border-cyan-500" : "border-white/30"
                            }`}>
                              {checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                            <div>
                              <p className="text-white text-sm font-medium">{inv.feeName || inv.feeType}</p>
                              <p className="text-white/40 text-[11px]">
                                {inv.invoiceNumber ?? "—"}
                                {inv.feePeriodStart && inv.feePeriodEnd && (
                                  <> · {clientFeePeriodLabel(inv.feePeriodStart, inv.feePeriodEnd)}</>
                                )}
                              </p>
                              <p className="text-white/30 text-[11px]">Session: {inv.academicYear ?? "—"}</p>
                              <p className="text-white/30 text-[11px]">Due: {fmtDate(inv.dueDate)}</p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {inv.accruedLateFee > 0 ? (
                              <>
                                <p className="text-white text-sm font-semibold">{fmt(inv.totalDue)}</p>
                                <p className="text-amber-400/70 text-[10px]">+{fmt(inv.accruedLateFee)} fine</p>
                              </>
                            ) : (
                              <p className="text-white text-sm font-semibold">{fmt(inv.amount)}</p>
                            )}
                            <span className={`text-[10px] font-medium ${inv.status === "Overdue" ? "text-red-400" : "text-amber-400"}`}>
                              {inv.status}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

              </>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setStep("search")} className="text-white/60">← Back</Button>
              {invoices.length > 0 && (
                <Button
                  disabled={selectedInvoiceId === null}
                  onClick={() => setStep("payment")}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white">
                  Payment Details →
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Payment details ─────────────────────────────────────────── */}
        {step === "payment" && (
          <div className="space-y-4">
            {/* ── Selected invoice summary ─────────────────────────────────────── */}
            {selectedInvoice && (
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-1.5">
                <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-1">Selected Invoice</p>
                <div className="flex justify-between text-sm">
                  <span className="text-white/70">{selectedInvoice.feeName || selectedInvoice.feeType}
                    {selectedInvoice.feePeriodStart && selectedInvoice.feePeriodEnd && (
                      <span className="text-white/30 text-xs ml-1">({clientFeePeriodLabel(selectedInvoice.feePeriodStart, selectedInvoice.feePeriodEnd)})</span>
                    )}
                  </span>
                  <span className="text-white font-medium">{fmt(selectedInvoice.totalDue)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-white/40">{selectedInvoice.invoiceNumber ?? "—"}</span>
                  <span className="text-white/40">Session: {selectedInvoice.academicYear ?? "—"}</span>
                </div>
              </div>
            )}

            {/* ── Method selector (5 buttons, Online/Razorpay excluded) ──────── */}
            <div>
              <label className="text-xs text-white/60 mb-1.5 block">Payment Method</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "Cash",         label: "Cash" },
                  { value: "Cheque",       label: "Cheque" },
                  { value: "BankTransfer", label: "Bank Transfer" },
                  { value: "DemandDraft",  label: "Demand Draft" },
                ].map(({ value, label }) => (
                  <button key={value} type="button"
                    onClick={() => selectPaymentMethod(value)}
                    className={`py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                      method === value
                        ? "bg-cyan-900/40 border-cyan-500/60 text-cyan-300"
                        : "bg-[#0A1628] border-white/15 text-white/60 hover:border-white/30 hover:text-white/80"
                    }`}>
                    {label}
                  </button>
                ))}
                {/* UPI / QR Payment — full-width on its own row */}
                <button type="button"
                  onClick={() => selectPaymentMethod("UpiQr")}
                  className={`col-span-2 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                    method === "UpiQr"
                      ? "bg-cyan-900/40 border-cyan-500/60 text-cyan-300"
                      : "bg-[#0A1628] border-white/15 text-white/60 hover:border-white/30 hover:text-white/80"
                  }`}>
                  UPI/QR
                </button>
              </div>
            </div>

            {/* ── Received date (always shown) ─────────────────────────────────── */}
            <div>
              <label className="text-xs text-white/60 mb-1 block">Received Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
            </div>

            {/* ── Method-aware accounting context ─────────────────────────────── */}
            {method === "Cash" && (
              <div>
                <label className="text-xs text-white/60 mb-1 block">Collection Location</label>
                <input value={collectionLocation} onChange={e => setCollectionLocation(e.target.value)}
                  placeholder="e.g. Main fee counter"
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
              </div>
            )}

            {/* ── Cash: denomination grid + verification panel ──────────────────── */}
            {method === "Cash" && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">Denomination Count</p>
                <div className="rounded-lg border border-white/10 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-white/5 border-b border-white/10">
                        <th className="text-left px-3 py-1.5 text-white/40 font-medium text-[11px]">Note / Coin</th>
                        <th className="text-center px-3 py-1.5 text-white/40 font-medium text-[11px]">Qty</th>
                        <th className="text-right px-3 py-1.5 text-white/40 font-medium text-[11px]">Sub-total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {DENOMS.map(d => (
                        <tr key={d}>
                          <td className="px-3 py-1 text-white/70 text-sm">₹{d}</td>
                          <td className="px-3 py-1 text-center">
                            <input
                              type="number" min="0" step="1"
                              value={denomQty[d] || ""}
                              onChange={e => {
                                const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                setDenomQty(prev => ({ ...prev, [d]: v }));
                              }}
                              className="w-16 text-center bg-[#0A1628] border border-white/15 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:border-cyan-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-3 py-1 text-right text-white/60 font-mono text-xs tabular-nums">
                            {d * (denomQty[d] ?? 0) > 0 ? fmt(d * (denomQty[d] ?? 0)) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Cash verification panel */}
                <div className={`p-3 rounded-lg border text-xs space-y-1 ${
                  cashMatch ? "bg-emerald-900/20 border-emerald-700/40"
                            : cashTotal > 0 ? "bg-red-900/15 border-red-700/30"
                            : "bg-white/3 border-white/10"
                }`}>
                  <div className="flex justify-between">
                    <span className="text-white/50">Invoice Due</span>
                    <span className="text-white font-medium">{fmt(totalAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Cash Counted</span>
                    <span className="text-white font-medium">{cashTotal > 0 ? fmt(cashTotal) : "—"}</span>
                  </div>
                  <div className="flex justify-between border-t border-white/10 pt-1 mt-1">
                    <span className="text-white/50">Difference</span>
                    <span className={`font-semibold ${cashDiff === 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {cashDiff === 0 ? "₹0 ✓" : cashDiff > 0 ? `+${fmt(cashDiff)} excess` : `${fmt(Math.abs(cashDiff))} short`}
                    </span>
                  </div>
                  {cashTotal > 0 && !cashMatch && (
                    <p className="text-red-400 flex items-center gap-1 pt-1 border-t border-white/10 mt-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Cash must exactly match the invoice due amount
                    </p>
                  )}
                  {cashMatch && (
                    <p className="text-emerald-400 flex items-center gap-1 pt-1 border-t border-white/10 mt-1">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      Cash matches — ready to record
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── UPI / QR Payment fields ──────────────────────────────────────── */}
            {method === "UpiQr" && (
              <div className="space-y-3">
                {/* UPI Transaction ID / UTR — required */}
                <div>
                  <label className="text-xs text-white/60 mb-1 block">
                    UPI Transaction ID / UTR <span className="text-red-400">*</span>
                  </label>
                  <input value={ref} onChange={e => setRef(e.target.value)}
                    placeholder="e.g. 123456789012"
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 font-mono" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Payment Date — required */}
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">
                      Payment Date <span className="text-red-400">*</span>
                    </label>
                    <input type="date" value={instrDate} onChange={e => setInstrDate(e.target.value)}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                  </div>
                  {/* Bank / UPI App — supporting detail */}
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Bank / UPI App</label>
                    <input value={bankName} onChange={e => setBankName(e.target.value)}
                      placeholder="e.g. GPay, PhonePe, HDFC"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Payer Name — supporting detail */}
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Payer Name</label>
                    <input value={payerName} onChange={e => setPayerName(e.target.value)}
                      placeholder="Account holder name"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                  {/* Payer UPI ID — supporting detail */}
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Payer UPI ID</label>
                    <input value={payerUpiId} onChange={e => setPayerUpiId(e.target.value)}
                      placeholder="e.g. name@upi"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Payment Time</label>
                    <input type="time" value={transactionTime} onChange={e => setTransactionTime(e.target.value)}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Receiver UPI ID</label>
                    <input value={receiverUpiId} onChange={e => setReceiverUpiId(e.target.value)}
                      placeholder="e.g. school@bank"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">UPI Reference</label>
                    <input value={transactionReference} onChange={e => setTransactionReference(e.target.value)}
                      placeholder="Optional bank / PSP reference"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Payment Status</label>
                    <Select value={instrumentStatus} onValueChange={setInstrumentStatus}>
                      <SelectTrigger className="bg-[#0A1628] border-white/20 text-white"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="Verified">Verified</SelectItem><SelectItem value="Pending">Pending</SelectItem><SelectItem value="Failed">Failed</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* ── Cheque / Bank Transfer / Demand Draft fields ──────────────────── */}
            {method !== "Cash" && method !== "UpiQr" && (
              <div className="space-y-3">
                {/* Reference number — required */}
                <div>
                  <label className="text-xs text-white/60 mb-1 block">
                    {method === "Cheque" ? "Cheque Number" : method === "BankTransfer" ? "UTR / Transaction Reference" : "DD Number"}
                    <span className="text-red-400 ml-0.5">*</span>
                  </label>
                  <input value={ref} onChange={e => setRef(e.target.value)}
                    placeholder={
                      method === "Cheque" ? "e.g. 123456"
                      : method === "BankTransfer" ? "e.g. HDFC12345678901"
                      : "e.g. DD/2024/00123"
                    }
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">
                      {method === "Cheque" ? "Cheque Date" : method === "BankTransfer" ? "Transfer Date" : "DD Date"}
                      <span className="text-red-400 ml-0.5">*</span>
                    </label>
                    <input type="date" value={instrDate} onChange={e => setInstrDate(e.target.value)}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">
                      {method === "BankTransfer" ? "Sender's Bank" : "Bank Name"}
                    </label>
                    <input value={bankName} onChange={e => setBankName(e.target.value)}
                      placeholder="e.g. SBI, HDFC"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Branch</label>
                    <input value={branchName} onChange={e => setBranchName(e.target.value)}
                      placeholder="Branch name"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">
                      {method === "BankTransfer" ? "Sender Name" : "Payer Name"}
                    </label>
                    <input value={payerName} onChange={e => setPayerName(e.target.value)}
                      placeholder="Account holder"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                </div>
                {method === "BankTransfer" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">Transfer Mode</label>
                        <Select value={transferMode} onValueChange={setTransferMode}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="NEFT">NEFT</SelectItem><SelectItem value="RTGS">RTGS</SelectItem><SelectItem value="IMPS">IMPS</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">Transaction Time</label>
                        <input type="time" value={transactionTime} onChange={e => setTransactionTime(e.target.value)}
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">Bank Transaction Reference</label>
                        <input value={transactionReference} onChange={e => setTransactionReference(e.target.value)}
                          placeholder="Optional internal reference"
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                      </div>
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">Receiving Bank</label>
                        <input value={receivingBank} onChange={e => setReceivingBank(e.target.value)}
                          placeholder="School account bank"
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                      </div>
                    </div>
                  </>
                )}
                {method !== "BankTransfer" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">{method === "Cheque" ? "Cheque Status" : "Draft Status"}</label>
                        <Select value={instrumentStatus} onValueChange={setInstrumentStatus}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="Received">Received</SelectItem><SelectItem value="Deposited">Deposited</SelectItem><SelectItem value="Cleared">Cleared</SelectItem><SelectItem value="Returned">Returned</SelectItem></SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">Payee Name</label>
                        <input value={payeeName} onChange={e => setPayeeName(e.target.value)}
                          placeholder="Named payee"
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                      </div>
                    </div>
                    {method === "DemandDraft" && (
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">Payable At</label>
                        <input value={payableAt} onChange={e => setPayableAt(e.target.value)}
                          placeholder="City / branch where the draft is payable"
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">Deposit Date</label>
                        <input type="date" value={depositDate} onChange={e => setDepositDate(e.target.value)}
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                      </div>
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">Deposit Bank</label>
                        <input value={depositBank} onChange={e => setDepositBank(e.target.value)}
                          placeholder="Bank"
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                      </div>
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">Deposit Reference</label>
                        <input value={depositReference} onChange={e => setDepositReference(e.target.value)}
                          placeholder="Slip / ref."
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Notes ───────────────────────────────────────────────────────── */}
            <div>
              <label className="text-xs text-white/60 mb-1 block">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notes, Collected by"
                className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
            </div>

            {/* ── Payment verification card (spec §5/6/7) ─────────────────────── */}
            <div className={`rounded-lg border transition-colors ${
              canSubmit ? "border-emerald-700/40 bg-emerald-900/10" : "border-white/10 bg-white/3"
            }`}>
              <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-white/30 uppercase tracking-widest">
                Payment Verification
              </p>
              <div className="px-3 pb-3 space-y-1.5 text-xs">
                {/* Student */}
                <div className="flex justify-between">
                  <span className="text-white/50">Student</span>
                  <span className="text-white font-medium">{selStudent?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">DSID</span>
                  <span className="text-white/80 font-mono">{selStudent?.digitalStudentId}</span>
                </div>

                {selectedInvoice && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-white/50">Invoice</span>
                      <span className="text-white font-mono">{selectedInvoice.invoiceNumber ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">Fee</span>
                      <span className="text-white">{selectedInvoice.feeName || selectedInvoice.feeType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">Outstanding</span>
                      <span className="text-white font-semibold">{fmt(selectedInvoice.totalDue)}</span>
                    </div>
                  </>
                )}

                {/* Method + dates */}
                <div className="flex justify-between">
                  <span className="text-white/50">Payment Method</span>
                  <span className="text-white">
                    {method === "BankTransfer" ? "Bank Transfer"
                     : method === "DemandDraft" ? "Demand Draft"
                     : method === "UpiQr" ? "UPI/QR"
                     : method}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Received Date</span>
                  <span className="text-white">{date ? `${fmtDate(date)}, ${nowIST()}` : "—"}</span>
                </div>

                {/* UPI-specific: show UTR in verification */}
                {method === "UpiQr" && (
                  <div className="flex justify-between">
                    <span className="text-white/50">UPI Transaction ID</span>
                    <span className="text-white font-mono">{ref.trim() || "—"}</span>
                  </div>
                )}

                {/* Cash-specific mini-summary inside verification */}
                {method === "Cash" && cashTotal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-white/50">Cash Counted</span>
                    <span className={cashMatch ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
                      {fmt(cashTotal)}
                    </span>
                  </div>
                )}

                {/* Verification status */}
                <div className={`flex items-center gap-1.5 pt-1.5 border-t border-white/10 mt-0.5 font-medium ${
                  canSubmit ? "text-emerald-400" : "text-white/25"
                }`}>
                  {canSubmit
                    ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    : <span className="w-3.5 h-3.5 shrink-0 rounded-full border border-white/20 inline-block" />
                  }
                  Amount verified
                </div>
              </div>
            </div>

            {/* ── Error ────────────────────────────────────────────────────────── */}
            {submitError && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-600/50 text-xs text-red-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setStep("select")} className="text-white/60">← Back</Button>
              <Button
                disabled={submitting || !canSubmit}
                onClick={() => doSubmit()}
                className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white gap-1">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                Record Payment
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Done ────────────────────────────────────────────────────── */}
        {step === "done" && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-900/20 border border-emerald-700/40 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
              <p className="text-emerald-400 font-semibold text-lg">
                Payment Recorded
              </p>
            </div>

            {/* Receipt for the recorded invoice */}
            {donePayments.length > 0 && (
              <div className="rounded-lg border border-white/10 overflow-hidden divide-y divide-white/5">
                {donePayments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <p className="text-white text-sm">{p.feeType}</p>
                      <p className="font-mono text-xs text-cyan-300">{p.receipt}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white/60 text-sm">{fmt(p.amount)}</span>
                      {p.id && (
                        <button type="button"
                          onClick={() => window.open(`/api/admin/fees/payments/${p.id}/receipt?print=1`, "_blank")}
                          className="text-white/40 hover:text-cyan-400 transition-colors" title="Print receipt">
                          <Printer className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button className="w-full bg-cyan-600 hover:bg-cyan-500 text-white" onClick={onClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const NOTIF_CHANNEL_ICONS: Record<string, React.ReactNode> = {
  sms:      <MessageSquare className="w-3.5 h-3.5" />,
  whatsapp: <Phone className="w-3.5 h-3.5" />,
  email:    <Mail className="w-3.5 h-3.5" />,
};
const SUPPORTED_FREQUENCIES = ["monthly", "quarterly", "annual", "one-time"] as const;
type SupportedFrequency = typeof SUPPORTED_FREQUENCIES[number];

const feeFormSchema = z.object({
  studentId: z.string().min(1, "Select a student"),
  feeName: z.string().optional(),
  feeType: z.string().min(1, "Fee type is required"),
  amount: z.string().min(1, "Amount is required").refine(v => !isNaN(Number(v)) && Number(v) > 0, "Must be a positive number"),
  frequency: z.string().optional(),
  feePeriod: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.enum(["Due", "Paid", "Overdue"]),
  paidDate: z.string().optional(),
  receiptNumber: z.string().optional(),
  notes: z.string().optional(),
  academicYear: z.string().optional(),
}).superRefine((val, ctx) => {
  const noDeadlineNeeded = val.status === "Paid";
  if (!noDeadlineNeeded && !val.dueDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Due date is required", path: ["dueDate"] });
  }
});
type FeeFormValues = z.infer<typeof feeFormSchema>;

/**
 * Client-side mirror of server/fee-period.ts feePeriodLabel — used for period
 * preview in the form. Operates only on calendar DATE values (YYYY-MM-DD) via
 * shared calendar helpers, so labels never shift with the host timezone.
 */
export function clientFeePeriodLabel(start: string, end: string): string {
  if (!start || !end) return "";
  const s = dateOnlyParts(start.slice(0, 10));
  const e = dateOnlyParts(end.slice(0, 10));
  if (!s || !e) return "";
  // Calendar-day span computed in UTC (never local) so DST/offset never shifts it.
  const days = Math.round(
    (Date.UTC(e.year, e.month - 1, e.day) - Date.UTC(s.year, s.month - 1, s.day)) / 86400000,
  );
  if (days <= 31) return formatMonthYearFromDateOnly(start);
  if (days <= 92) return `${formatMonthFromDateOnly(start)}–${formatMonthYearFromDateOnly(end)}`;
  return `${s.year}–${String(s.year + 1).slice(2)}`;
}

// ─── Ledger Tab ───────────────────────────────────────────────────────────────

type FilterOption = { value: string; label: string };
type HeaderFilterProps = {
  label: string; field: keyof LedgerFilters; toField?: keyof LedgerFilters; filters: LedgerFilters; setFilters: React.Dispatch<React.SetStateAction<LedgerFilters>>;
  options?: FilterOption[]; kind?: "text" | "multi" | "range" | "date";
};
function HeaderFilter({ label, field, toField, filters, setFilters, options = [], kind = "multi" }: HeaderFilterProps) {
  const active = Array.isArray(filters[field])
    ? (filters[field] as string[]).length > 0
    : filters[field] != null || Boolean(toField && filters[toField] != null);
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [mobile, setMobile] = useState(false);
  const [draft, setDraft] = useState<LedgerFilters>(filters);
  useEffect(() => { const sync = () => setMobile(window.matchMedia("(max-width: 767px)").matches); sync(); window.addEventListener("resize", sync); return () => window.removeEventListener("resize", sync); }, []);
  useEffect(() => { if (open) setDraft(filters); }, [open, filters]);
  const value = draft[field];
  const visible = options.filter(option => option.label.toLowerCase().includes(query.toLowerCase()));
  const selected = Array.isArray(value) ? value : [];
  const selectedVisible = visible.filter(option => selected.includes(option.value)).length;
  const allVisible = visible.length > 0 && selectedVisible === visible.length;
  const someVisible = selectedVisible > 0 && !allVisible;
  const setField = (key: keyof LedgerFilters, next: LedgerFilters[keyof LedgerFilters]) => setDraft(previous => ({ ...previous, [key]: next }));
  const apply = () => { setFilters(draft); setOpen(false); };
  const clear = () => {
    setDraft(previous => ({ ...previous, [field]: Array.isArray(previous[field]) ? [] : null, ...(toField ? { [toField]: null } : {}) }));
  };
  const content = <div className="space-y-2.5 p-3 text-white">
    <div className="flex items-center justify-between"><span className="text-xs font-semibold">{label}</span><button type="button" className="text-[11px] text-white/45 hover:text-white" onClick={clear}>Clear</button></div>
    {kind === "text" && <Input autoFocus value={(value as string[])[0] ?? ""} onChange={e => setField(field, e.target.value ? [e.target.value] : [])} placeholder={`Contains ${label.toLowerCase()}...`} className="h-8 border-white/10 bg-white/5 text-xs" />}
    {kind === "multi" && <><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find an option..." className="h-8 border-white/10 bg-white/5 text-xs" />
      <button type="button" role="checkbox" aria-checked={someVisible ? "mixed" : allVisible} onClick={() => setField(field, allVisible ? selected.filter(v => !visible.some(option => option.value === v)) : [...new Set([...selected, ...visible.map(option => option.value)])])} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-cyan-200 hover:bg-white/10">
        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${allVisible || someVisible ? "border-cyan-400 bg-cyan-500 text-[#08111f]" : "border-white/25"}`}>{allVisible ? <Check className="h-3 w-3" /> : someVisible ? <Minus className="h-3 w-3" /> : null}</span>Select all visible <span className="ml-auto text-white/35">{selected.length}</span>
      </button>
      <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">{visible.map(option => { const checked = selected.includes(option.value); return <button type="button" role="checkbox" aria-checked={checked} key={option.value} onClick={() => setField(field, checked ? selected.filter(v => v !== option.value) : [...selected, option.value])} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-white/10"><span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${checked ? "border-cyan-400 bg-cyan-500 text-[#08111f]" : "border-white/25"}`}>{checked && <Check className="h-3 w-3" />}</span>{option.label}</button>; })}</div>
    </>}
    {(kind === "range" || kind === "date") && <div className="grid grid-cols-2 gap-2"><Input type={kind === "date" ? "date" : "number"} value={value == null ? "" : String(value)} onChange={e => setField(field, kind === "range" ? (e.target.value === "" ? null : Number(e.target.value)) : (e.target.value || null))} placeholder={kind === "range" ? "Minimum" : "From"} className="h-8 border-white/10 bg-white/5 text-xs" /><Input type={kind === "date" ? "date" : "number"} value={toField && draft[toField] != null ? String(draft[toField]) : ""} onChange={e => toField && setField(toField, kind === "range" ? (e.target.value === "" ? null : Number(e.target.value)) : (e.target.value || null))} placeholder={kind === "range" ? "Maximum" : "To"} className="h-8 border-white/10 bg-white/5 text-xs" /></div>}
    <div className="sticky bottom-0 -mx-3 flex justify-end gap-2 border-t border-white/10 bg-[#101d32] px-3 pt-2"><Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-7 text-xs text-white/55">Cancel</Button><Button size="sm" onClick={apply} className="h-7 bg-cyan-600 text-xs hover:bg-cyan-500">Apply</Button></div>
  </div>;
  const trigger = <button type="button" onClick={mobile ? () => setOpen(true) : undefined} aria-label={`Filter ${label}`} aria-pressed={active} className={`ml-1 inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${active ? "bg-cyan-400/15 text-cyan-300" : "text-white/25 hover:bg-white/10 hover:text-white/65"}`}><Filter className="h-3 w-3" /></button>;
  if (mobile) return <>{trigger}<Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" className="max-h-[82dvh] overflow-y-auto border-white/10 bg-[#101d32] p-0"><SheetHeader className="sr-only"><SheetTitle>{label} filter</SheetTitle><SheetDescription>Choose values for the {label.toLowerCase()} ledger column, then apply the filter.</SheetDescription></SheetHeader>{content}</SheetContent></Sheet></>;
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>{trigger}</PopoverTrigger><PopoverContent align="start" className="w-64 border-white/10 bg-[#101d32] p-0 shadow-2xl">{content}</PopoverContent></Popover>;
}

// ─── Export Ledger Dialog ─────────────────────────────────────────────────────

interface ExportLedgerDialogProps {
  open: boolean;
  onClose: () => void;
  canonicalFilters: LedgerFilters;
  selectedIds: Set<number>;
  selectAllMatching: boolean;
  excludedIds: Set<number>;
}

function ExportLedgerDialog({
  open, onClose, canonicalFilters,
  selectedIds, selectAllMatching, excludedIds,
}: ExportLedgerDialogProps) {
  const { toast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!open) setIsDownloading(false);
  }, [open]);

  const hasSelection = selectAllMatching || selectedIds.size > 0;
  const effectiveCount = selectAllMatching
    ? `all matching (excl. ${excludedIds.size})`
    : selectedIds.size > 0
      ? `${selectedIds.size} selected`
      : "all matching";

  async function handleExport() {
    setIsDownloading(true);
    try {
      let r: Response;

      if (hasSelection) {
        // Selection active — POST so IDs stay in the body (avoids URL length limits).
        r = await sessionFetch("/api/admin/fees/export-ledger", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            ...ledgerFiltersToBody(canonicalFilters),
            selectAllMatching,
            // Explicit mode: send picked IDs. All-matching mode: IDs are irrelevant.
            selectedIds: selectAllMatching ? [] : [...selectedIds],
            // Exclusions only apply in all-matching mode.
            excludedIds: selectAllMatching ? [...excludedIds] : [],
          }),
        });
      } else {
        // No selection — GET with canonical filter query params (unchanged behaviour).
        const params = ledgerFiltersToSearchParams(canonicalFilters);
        r = await sessionFetch(
          `/api/admin/fees/export-ledger${params.size ? "?" + params.toString() : ""}`,
        );
      }

      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as any).message ?? "Export failed");
      }
      const blob = await r.blob();
      const dateTag = todayInIST();
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

        <div className="space-y-4">
          <p className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-sm text-white/60">
            {hasSelection
              ? <>Exporting <span className="text-white/80 font-medium">{effectiveCount}</span> record{selectedIds.size === 1 && !selectAllMatching ? "" : "s"} with {countActiveLedgerFilters(canonicalFilters)} active filter{countActiveLedgerFilters(canonicalFilters) === 1 ? "" : "s"}.</>
              : <>This CSV will use the {countActiveLedgerFilters(canonicalFilters)} active ledger filter{countActiveLedgerFilters(canonicalFilters) === 1 ? "" : "s"} currently applied to the table.</>
            }
          </p>

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
  const [filters, setFilters] = useState<LedgerFilters>(() => emptyLedgerFilters());
  const [showFilterOverview, setShowFilterOverview] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [addFeeSuccessId, setAddFeeSuccessId] = useState<number | null>(null);
  const [showExportLedger, setShowExportLedger] = useState(false);
  const [isDownloadingLedgerPdf, setIsDownloadingLedgerPdf]  = useState(false);
  const [isDownloadingTxPdf,     setIsDownloadingTxPdf]      = useState(false);
  const [editing, setEditing] = useState<FeeRecordWithStudent | null>(null);
  const [showStandalonePay, setShowStandalonePay] = useState(false);
  // ── Bulk selection ────────────────────────────────────────────────────────
  // Explicit-ID mode (selectAllMatching=false): selectedIds holds every picked record.
  // All-matching mode (selectAllMatching=true): every record matching current filters
  //   is selected EXCEPT those in excludedIds. This lets the user deselect individual
  //   rows without losing selections on unseen pages.
  const [selectedIds,        setSelectedIds]        = useState<Set<number>>(new Set());
  const [selectAllMatching,  setSelectAllMatching]  = useState(false);
  const [excludedIds,        setExcludedIds]        = useState<Set<number>>(new Set());
  // selectionModeActive: true once the user enters selection mode; only the explicit
  // Clear action sets it back to false. Prevents the checkbox column from disappearing
  // merely because selectedIds.size hits 0 (e.g. after deselecting the current page).
  const [selectionModeActive, setSelectionModeActive] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifStudentId, setNotifStudentId] = useState<number | null>(null);
  const [notifStudentName, setNotifStudentName] = useState<string | null>(null);
  // ── Expandable accordion state ─────────────────────────────────────────────
  const [expandedLedgerRow, setExpandedLedgerRow] = useState<number | null>(null);
  const [detailCache, setDetailCache] = useState<Map<number, TransactionDetail>>(new Map());
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [detailSection, setDetailSection] = useState<Record<number, number>>({});
  const [adminNotes, setAdminNotes] = useState<Record<number, string>>({});
  const [savingNotes, setSavingNotes] = useState<Set<number>>(new Set());
  const [studentSearchQ, setStudentSearchQ] = useState("");
  const [studentResults, setStudentResults] = useState<StudentItem[] | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [studentSearchLoading, setStudentSearchLoading] = useState(false);
  const [invoiceBreakdown, setInvoiceBreakdown] = useState<InvoiceBreakdownRow[]>([]);
  const [invoiceLateFeeEnabled, setInvoiceLateFeeEnabled] = useState(false);
  const [invoiceLateFeeType, setInvoiceLateFeeType] = useState<"NONE" | "FLAT" | "DAILY" | "TIERED">("FLAT");
  const [invoiceLateFeeGraceDays, setInvoiceLateFeeGraceDays] = useState("0");
  const [invoiceLateFeeFlat, setInvoiceLateFeeFlat] = useState("");
  const [invoiceLateFeeDailyRate, setInvoiceLateFeeDailyRate] = useState("");
  const [invoiceLateFeeCap, setInvoiceLateFeeCap] = useState("0");
  const [invoiceLateFeeSlabs, setInvoiceLateFeeSlabs] = useState<Array<{ from_day: string; to_day: string; amount: string }>>([]);

  // The manual invoice endpoint always uses the server's active session. Fetch
  // that same session here rather than deriving periods from the archive view.
  const { data: invoiceSessions = [] } = useQuery<AcademicSession[]>({
    queryKey: ["/api/admin/fees/sessions"],
    queryFn: async () => {
      const response = await sessionFetch("/api/admin/fees/sessions");
      if (!response.ok) throw new Error("Failed to load academic sessions");
      return response.json();
    },
    staleTime: 60_000,
  });
  const activeInvoiceSession = useMemo(
    () => invoiceSessions.find(session => session.isActive) ?? null,
    [invoiceSessions],
  );
  const {
    data: addFeeSuccessDetail,
    isLoading: isAddFeeSuccessLoading,
    isError: isAddFeeSuccessDetailError,
  } = useQuery<TransactionDetail>({
    queryKey: ["/api/admin/fees", viewSessionId, addFeeSuccessId, "transaction-detail"],
    queryFn: async () => {
      const response = await sessionFetch(`/api/admin/fees/${addFeeSuccessId}/transaction-detail`);
      if (!response.ok) throw new Error("Failed to load the created invoice");
      return response.json();
    },
    enabled: addFeeSuccessId !== null,
    retry: false,
  });

  const { data: ledgerData, isLoading, isFetching } = useQuery<LedgerPageResponse>({
    queryKey: ["/api/admin/fees", viewSessionId, ledgerPage, filters],
    queryFn: async () => {
      const params = ledgerFiltersToSearchParams(filters);
      params.set("page", String(ledgerPage)); params.set("pageSize", "20");
      const r = await sessionFetch(`/api/admin/fees?${params.toString()}`);
      if (!r.ok) throw new Error("Failed to fetch fee records");
      return r.json();
    },
    refetchInterval: 30_000,
  });
  const feeRecords = ledgerData?.records ?? [];
  const ledgerTotal = ledgerData?.total ?? 0;
  const ledgerTotalPages = ledgerData?.totalPages ?? 0;

  useEffect(() => {
    setLedgerPage(1);
    // Clear the "all matching" scope + exclusions when filters/search change (Case 5).
    // Explicit selectedIds persist so records picked on earlier pages stay checked.
    setSelectAllMatching(false);
    setExcludedIds(new Set());
    setExpandedLedgerRow(null);
  }, [filters, viewSessionId]);
  useEffect(() => {
    setDetailCache(new Map());
    setExpandedLedgerRow(null);
  }, [viewSessionId]);
  // NOTE: we intentionally do NOT clear selectedIds on page change —
  // selections persist across pagination (see task #272).

  // Fee structures remain the source for historical display-name fallbacks.
  const { data: feeStructures = [] } = useQuery<FeeStructure[]>({
    queryKey: ["/api/admin/fees/structures"],
    staleTime: 300_000,
  });
  const activeStructures = useMemo(() => feeStructures, [feeStructures]);
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

  // ── Accordion callbacks ────────────────────────────────────────────────────
  const fetchDetail = useCallback(async (feeRecordId: number, forceRefresh = false): Promise<TransactionDetail | null> => {
    if (!forceRefresh) {
      const cached = detailCache.get(feeRecordId);
      if (cached) return cached;
    }
    setDetailLoading(feeRecordId);
    try {
      const r = await sessionFetch(`/api/admin/fees/${feeRecordId}/transaction-detail`);
      if (!r.ok) return null;
      const data: TransactionDetail = await r.json();
      setDetailCache(prev => new Map(prev).set(feeRecordId, data));
      if (data.payment?.cashierNotes) {
        setAdminNotes(prev => ({ ...prev, [feeRecordId]: data.payment!.cashierNotes! }));
      }
      return data;
    } catch { /* non-critical */ }
    finally { setDetailLoading(null); }
    return null;
  }, [detailCache]);

  const toggleLedgerRow = useCallback((id: number) => {
    if (expandedLedgerRow === id) {
      setExpandedLedgerRow(null);
    } else {
      setExpandedLedgerRow(id);
      fetchDetail(id);
    }
  }, [expandedLedgerRow, fetchDetail]);

  const printInvoiceFromRecord = useCallback((recordId: number) => {
    const printWindow = window.open(`/api/admin/fees/${recordId}/invoice`, "_blank");
    if (!printWindow) {
      toast({ title: "Invoice could not open", description: "Allow pop-ups for this site to print or download invoices.", variant: "destructive" });
    }
  }, [toast]);

  const saveAdminNotes = useCallback(async (feeRecordId: number, paymentId: number | undefined, notes: string) => {
    if (!paymentId) return;
    setSavingNotes(prev => new Set(prev).add(feeRecordId));
    try {
      await sessionFetch(`/api/admin/fees/payments/${paymentId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashierNotes: notes }),
      });
      // Invalidate cache so a re-open shows fresh data
      setDetailCache(prev => { const m = new Map(prev); m.delete(feeRecordId); return m; });
    } catch { /* non-critical */ }
    finally { setSavingNotes(prev => { const s = new Set(prev); s.delete(feeRecordId); return s; }); }
  }, []);

  // ── PDF download handlers ─────────────────────────────────────────────────
  const downloadLedgerPdf = useCallback(async () => {
    setIsDownloadingLedgerPdf(true);
    try {
      // Selection-aware: use POST when any selection is active so that IDs are
      // sent in the request body (avoids URL-length limits and is more secure).
      // With no selection, fall back to the simple GET path (no change in behavior).
      const hasSelection = selectAllMatching || selectedIds.size > 0;

      let r: Response;
      if (hasSelection) {
        // Build the body — filters + selection scope.
        const body: Record<string, unknown> = {
          ...ledgerFiltersToBody(filters),
          selectAllMatching,
          // Individual mode: send the explicit IDs.
          // All-matching mode: selectedIds are irrelevant; send empty array.
          selectedIds: selectAllMatching ? [] : [...selectedIds],
          // Exclusions apply only in all-matching mode.
          excludedIds: selectAllMatching ? [...excludedIds] : [],
        };
        r = await sessionFetch("/api/admin/fees/ledger/pdf", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        });
      } else {
        // No selection — GET with toolbar filters, same as before.
        const params = ledgerFiltersToSearchParams(filters);
        r = await sessionFetch(`/api/admin/fees/ledger/pdf${params.size ? "?" + params.toString() : ""}`);
      }

      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: "Download failed" }));
        toast({ title: "PDF download failed", description: err.message, variant: "destructive" });
        return;
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const cd = r.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(cd);
      a.download = match?.[1] ?? "Fee-Ledger.pdf";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: "PDF download failed", description: "Could not generate the ledger PDF.", variant: "destructive" });
    } finally {
      setIsDownloadingLedgerPdf(false);
    }
  }, [toast, filters, selectedIds, selectAllMatching, excludedIds]);

  const downloadTransactionPdf = useCallback(async () => {
    setIsDownloadingTxPdf(true);
    try {
      const hasSelection = selectAllMatching || selectedIds.size > 0;
      let r: Response;

      if (hasSelection) {
        r = await sessionFetch("/api/admin/fees/payments/report/pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...ledgerFiltersToBody(filters),
            selectAllMatching,
            selectedIds: selectAllMatching ? [] : [...selectedIds],
            excludedIds: selectAllMatching ? [...excludedIds] : [],
          }),
        });
      } else {
        const params = ledgerFiltersToSearchParams(filters);
        r = await sessionFetch(
          `/api/admin/fees/payments/report/pdf${params.size ? "?" + params.toString() : ""}`,
        );
      }

      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: "Download failed" }));
        toast({ title: "PDF download failed", description: err.message, variant: "destructive" });
        return;
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const cd = r.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(cd);
      a.download = match?.[1] ?? "Payment-Transaction-Report.pdf";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: "PDF download failed", description: "Could not generate the transaction report PDF.", variant: "destructive" });
    } finally {
      setIsDownloadingTxPdf(false);
    }
  }, [toast, filters, selectedIds, selectAllMatching, excludedIds]);

  // Failed payment counts — per-fee-record badge showing how many payment_failed audit entries exist
  const { data: failedCounts = {} } = useQuery<Record<number, { count: number; lastError: string | null }>>({
    queryKey: ["/api/admin/fees/failed-counts", viewSessionId],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/failed-counts");
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: 30_000,
  });

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

  // Payment records are retained here to select the correct receipt route.
  const { data: paymentRecordsList = [] } = useQuery<PaymentRecord[]>({
    queryKey: ["/api/admin/fees/payments", viewSessionId],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/payments");
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 30_000,
  });
  // Map feeRecordId → payment records, sorted newest-first, for receipt selection.
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
    defaultValues: { studentId: "", feeName: "", feeType: "", amount: "", frequency: "", feePeriod: "", dueDate: "", status: "Due", paidDate: "", receiptNumber: "", notes: "", academicYear: "" },
  });
  const watchStatus = form.watch("status");
  const dueDateNotNeeded = watchStatus === "Paid";
  const watchFeePeriod   = form.watch("feePeriod") ?? "";
  const watchFrequency   = form.watch("frequency") ?? "";
  const invoiceBreakdownTotal = invoiceBreakdown.reduce((sum, row) => sum + (parseInt(row.amount) || 0), 0);
  const invoiceBreakdownMismatch = invoiceBreakdown.length > 0
    && invoiceBreakdownTotal !== (parseInt(form.watch("amount")) || 0);
  const invoicePeriodOptions = useMemo(
    () => addInvoicePeriodOptionsForSession(watchFrequency, activeInvoiceSession),
    [watchFrequency, activeInvoiceSession],
  );
  const selectedInvoicePeriod = invoicePeriodOptions.find(option => option.value === watchFeePeriod);

  // Auto-clear due date when status makes it irrelevant
  useEffect(() => {
    if (dueDateNotNeeded) form.setValue("dueDate", "");
  }, [dueDateNotNeeded]);

  // Frequency drives one logical period selection; raw dates remain server-owned.
  useEffect(() => {
    if (editing || !selectedStudent || !watchFrequency) return;
    if (!SUPPORTED_FREQUENCIES.includes(watchFrequency as SupportedFrequency)) return;
    const period = preferredInvoicePeriod(invoicePeriodOptions);
    if (period) {
      form.setValue("feePeriod", period.value, { shouldValidate: true });
    }
  }, [editing, watchFrequency, selectedStudent, invoicePeriodOptions]);

  // Keep Due Date separate, but reset an empty or now-invalid default to the
  // selected period end so the manual due-date validation remains satisfiable.
  useEffect(() => {
    if (editing || !selectedStudent || !selectedInvoicePeriod) return;
    const dueDate = form.getValues("dueDate");
    if (
      !dueDate
      || dueDate < selectedInvoicePeriod.start
      || dueDate > selectedInvoicePeriod.end
    ) {
      form.setValue("dueDate", selectedInvoicePeriod.end, { shouldValidate: true });
    }
  }, [editing, selectedStudent, selectedInvoicePeriod, form]);

  function resetInvoiceStructureDraft() {
    setInvoiceBreakdown([]);
    setInvoiceLateFeeEnabled(false);
    setInvoiceLateFeeType("FLAT");
    setInvoiceLateFeeGraceDays("0");
    setInvoiceLateFeeFlat("");
    setInvoiceLateFeeDailyRate("");
    setInvoiceLateFeeCap("0");
    setInvoiceLateFeeSlabs([]);
  }

  function addInvoiceBreakdownRow() {
    setInvoiceBreakdown(previous => [...previous, { name: "", purpose: "", amount: "" }]);
  }

  function updateInvoiceBreakdownRow(index: number, field: keyof InvoiceBreakdownRow, value: string) {
    setInvoiceBreakdown(previous => previous.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [field]: value } : row,
    ));
  }

  function removeInvoiceBreakdownRow(index: number) {
    setInvoiceBreakdown(previous => previous.filter((_, rowIndex) => rowIndex !== index));
  }

  function addInvoiceLateFeeSlab() {
    setInvoiceLateFeeSlabs(previous => [...previous, { from_day: "", to_day: "", amount: "" }]);
  }

  function updateInvoiceLateFeeSlab(
    index: number,
    field: "from_day" | "to_day" | "amount",
    value: string,
  ) {
    setInvoiceLateFeeSlabs(previous => previous.map((slab, slabIndex) =>
      slabIndex === index ? { ...slab, [field]: value } : slab,
    ));
  }

  function removeInvoiceLateFeeSlab(index: number) {
    setInvoiceLateFeeSlabs(previous => previous.filter((_, slabIndex) => slabIndex !== index));
  }

  const createMut = useMutation({
    mutationFn: async (data: FeeFormValues) => {
      if (!data.feeName?.trim()) throw new Error("Fee name is required");
      if (!data.feeType?.trim()) throw new Error("Fee type is required");
      if (!data.frequency || !SUPPORTED_FREQUENCIES.includes(data.frequency as SupportedFrequency)) throw new Error("Valid frequency is required");
      if (!data.feePeriod) throw new Error("Fee period is required");
      if (!data.dueDate) throw new Error("Due date is required");

      const parsedBreakdown = invoiceBreakdown
        .filter(row => row.name.trim())
        .map(row => ({
          name: row.name.trim(),
          purpose: row.purpose.trim(),
          amount: parseInt(row.amount) || 0,
        }));

      const lateFeeConfig = {
        enabled: invoiceLateFeeEnabled,
        type: invoiceLateFeeEnabled ? invoiceLateFeeType : "NONE",
        grace_period_days: invoiceLateFeeEnabled && invoiceLateFeeType === "DAILY"
          ? (parseInt(invoiceLateFeeGraceDays) || 0) : 0,
        flat_amount: parseInt(invoiceLateFeeFlat) || 0,
        daily_rate: parseFloat(invoiceLateFeeDailyRate) || 0,
        max_cap: invoiceLateFeeEnabled && invoiceLateFeeType === "DAILY"
          ? (parseInt(invoiceLateFeeCap) || 0) : 0,
        tiered_slabs: invoiceLateFeeSlabs
          .filter(slab => slab.from_day && slab.to_day && slab.amount)
          .map(slab => ({
            from_day: parseInt(slab.from_day),
            to_day: parseInt(slab.to_day),
            amount: parseInt(slab.amount),
          })),
      };

      const res = await apiRequest("POST", "/api/admin/fees", {
        studentId: Number(data.studentId),
        feeName: data.feeName.trim(),
        feeType: data.feeType.trim(),
        amount: Number(data.amount),
        frequency: data.frequency,
        feePeriod: data.feePeriod,
        dueDate: data.dueDate,
        lateFeeConfig,
        breakdown: parsedBreakdown,
        notes: data.notes || null,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to create invoice");
      }
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/failed-counts"] });
      toast({ title: "Fee record updated" });
      setEditing(null); setShowForm(false); form.reset();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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
  const classes = studentClasses;
  const { data: ledgerFilterOptions } = useQuery<{
    classes: string[]; sections: string[]; feeNames: string[]; feeTypes: string[]; feePeriods: Array<{ value: string; label: string }>;
    frequencies: string[]; statuses: string[]; paymentMethods: string[]; academicYears: string[];
  }>({
    queryKey: ["/api/admin/fees/filter-options", viewSessionId],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/filter-options");
      if (!r.ok) throw new Error("Failed to load filter options");
      return r.json();
    },
    staleTime: 300_000,
  });

  async function runStudentSearch() {
    const q = studentSearchQ.trim();
    if (q.length < 2) {
      setStudentResults([]);
      return;
    }
    setStudentSearchLoading(true);
    try {
      const response = await sessionFetch(`/api/admin/fees/students/search?q=${encodeURIComponent(q)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Student search failed");
      setStudentResults(body as StudentItem[]);
    } catch (error: any) {
      setStudentResults([]);
      toast({ title: "Student search failed", description: error.message, variant: "destructive" });
    } finally {
      setStudentSearchLoading(false);
    }
  }

  function pickStudent(s: StudentItem) {
    setSelectedStudent(s);
    form.setValue("studentId", String(s.id), { shouldValidate: true });
    setStudentResults(null);
    setStudentSearchQ("");
    setInvoiceBreakdown([]);
    form.setValue("feeName", "");
    form.setValue("feeType", "");
    form.setValue("amount", "");
    form.setValue("frequency", "");
    form.setValue("feePeriod", "");
    form.setValue("dueDate", "");
  }

  function clearStudentPick() {
    setSelectedStudent(null);
    setStudentSearchQ(""); setStudentResults(null);
    setInvoiceBreakdown([]);
    resetInvoiceStructureDraft();
    form.setValue("studentId", "", { shouldValidate: false });
    form.setValue("feeName", "");
    form.setValue("feeType", "");
    form.setValue("amount", "");
    form.setValue("frequency", "");
    form.setValue("feePeriod", "");
    form.setValue("dueDate", "");
  }

  // The server applies all ledger filters; these are only the current page rows.
  const filtered = feeRecords;
  const activeFilterEntries = useMemo(() => {
    type ActiveFilterEntry = { keys: Array<keyof LedgerFilters>; label: string; value: string };
    const entries: ActiveFilterEntry[] = [];
    const paymentMethodLabels: Record<string, string> = {
      Online: "Portal Payment",
      BankTransfer: "Bank Transfer",
      DemandDraft: "Demand Draft",
      UpiQr: "UPI / QR",
    };
    const names: Partial<Record<keyof LedgerFilters, string>> = {
      search: "Global search", invoiceNumbers: "Invoice", receiptNumbers: "Receipt",
      studentNames: "Student", dsids: "DSID", referenceNumbers: "Reference",
      classes: "Class", sections: "Section", feeNames: "Fee name", feeTypes: "Fee type",
      feePeriods: "Fee period", frequencies: "Frequency", statuses: "Status",
      paymentMethods: "Payment method", academicYears: "Academic year",
    };
    const simpleKeys: Array<keyof LedgerFilters> = [
      "search", "invoiceNumbers", "receiptNumbers", "studentNames", "dsids",
      "referenceNumbers", "classes", "sections", "feeNames", "feeTypes",
      "feePeriods", "frequencies", "statuses", "paymentMethods", "academicYears",
    ];
    for (const key of simpleKeys) {
      const raw = filters[key];
      if (Array.isArray(raw) ? raw.length === 0 : raw == null || raw === "") continue;
      const value = Array.isArray(raw)
        ? raw.map(item => {
            if (key === "feePeriods") return ledgerFilterOptions?.feePeriods.find(period => period.value === item)?.label ?? item;
            if (key === "paymentMethods") return paymentMethodLabels[item] ?? item;
            return item;
          }).join(", ")
        : String(raw);
      entries.push({ keys: [key], label: names[key] ?? String(key), value });
    }
    if (filters.amountMin != null || filters.amountMax != null) {
      entries.push({
        keys: ["amountMin", "amountMax"],
        label: "Amount",
        value: `${filters.amountMin != null ? fmt(filters.amountMin) : "Any"} – ${filters.amountMax != null ? fmt(filters.amountMax) : "Any"}`,
      });
    }
    if (filters.dueDateFrom || filters.dueDateTo) {
      entries.push({
        keys: ["dueDateFrom", "dueDateTo"],
        label: "Due date",
        value: `${filters.dueDateFrom ? fmtDate(filters.dueDateFrom) : "Any"} – ${filters.dueDateTo ? fmtDate(filters.dueDateTo) : "Any"}`,
      });
    }
    if (filters.paidDateFrom || filters.paidDateTo) {
      entries.push({
        keys: ["paidDateFrom", "paidDateTo"],
        label: "Paid date",
        value: `${filters.paidDateFrom ? fmtDate(filters.paidDateFrom) : "Any"} – ${filters.paidDateTo ? fmtDate(filters.paidDateTo) : "Any"}`,
      });
    }
    return entries;
  }, [filters, ledgerFilterOptions]);

  // ── Selection derived state ───────────────────────────────────────────────
  const inSelectionMode = selectionModeActive && canRecord && !isArchiveMode;
  const currentPageIds  = filtered.map(r => r.id);

  // isRowSelected: in "all matching" mode a row is selected unless explicitly excluded.
  const isRowSelected = (id: number) =>
    selectAllMatching ? !excludedIds.has(id) : selectedIds.has(id);

  const allCurrentPageSelected =
    currentPageIds.length > 0 && currentPageIds.every(isRowSelected);
  const someCurrentPageSelected =
    currentPageIds.some(isRowSelected);

  // effectiveSelectedCount: total matching minus any explicit exclusions.
  const effectiveSelectedCount = selectAllMatching
    ? Math.max(0, ledgerTotal - excludedIds.size)
    : selectedIds.size;

  // Distinct fee names/types come from fee structures so pagination does not
  // remove filter options that are not present on the current page.
  const allFeeNames = useMemo(() =>
    [...new Set([...activeStructures.map(s => s.name), ...feeRecords.map(r => resolveFeeDisplayName(r))])].filter(Boolean).sort(),
    [activeStructures, feeRecords, resolveFeeDisplayName]);

  const allFeeTypes = useMemo(() =>
    [...new Set([...activeStructures.map(s => s.feeType), ...feeRecords.map(r => r.feeType)])].sort(),
    [activeStructures, feeRecords]);

  function openCreate() {
    setEditing(null);
    form.reset({ studentId: "", feeName: "", feeType: "", amount: "", frequency: "", feePeriod: "", dueDate: "", status: "Due", paidDate: "", receiptNumber: "", notes: "", academicYear: activeInvoiceSession?.sessionName ?? selectedSession?.sessionName ?? "" });
    setSelectedStudent(null); setStudentSearchQ(""); setStudentResults(null); setInvoiceBreakdown([]);
    resetInvoiceStructureDraft();
    setShowForm(true);
  }

  function openEdit(rec: FeeRecordWithStudent) {
    setEditing(rec);
    form.reset({
      studentId: String(rec.studentId), feeType: rec.feeType, amount: String(rec.amount),
      dueDate: rec.dueDate, status: rec.status as any, paidDate: rec.paidDate ?? "",
      receiptNumber: rec.receiptNumber ?? "", notes: rec.notes ?? "", academicYear: rec.academicYear ?? "",
    });
    setSelectedStudent(students.find(s => s.id === rec.studentId) ?? null);
    setStudentSearchQ(""); setStudentResults(null); setInvoiceBreakdown([]);
    setShowForm(true);
  }

  return (
    <div className="space-y-4">
      {/* Compact filter overview: column filters live in their headers. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#101d32] p-2.5">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input aria-label="Search ledger" value={filters.search} onChange={e => setFilters(previous => ({ ...previous, search: e.target.value }))} placeholder="Search invoice, receipt, student or DSID..."
            className="w-full rounded-lg border border-white/10 bg-[#1A2942] py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-cyan-500 focus:outline-none" />
        </div>
        <button type="button" onClick={() => setShowFilterOverview(true)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/65 hover:border-cyan-400/40 hover:text-cyan-200"><SlidersHorizontal className="h-3.5 w-3.5 text-cyan-300" />Filters <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 text-cyan-200">{countActiveLedgerFilters(filters)}</span></button>
        {countActiveLedgerFilters(filters) > 0 && <button type="button" onClick={() => setFilters(emptyLedgerFilters())} className="text-xs text-cyan-300 hover:text-cyan-200">Clear all</button>}
        <div className="flex gap-2 ml-auto items-center">
          {canRecord && !isArchiveMode && !inSelectionMode && filtered.length > 0 && (
            <button
              onClick={() => { setSelectionModeActive(true); setSelectedIds(new Set(filtered.map(r => r.id))); }}
              className="text-xs text-white/40 hover:text-cyan-400 transition-colors underline underline-offset-2">
              Select all
            </button>
          )}
          {inSelectionMode && (
            <button
              onClick={() => { setSelectedIds(new Set()); setSelectAllMatching(false); setExcludedIds(new Set()); setSelectionModeActive(false); }}
              className="text-xs text-white/40 hover:text-white/70 transition-colors underline underline-offset-2">
              Clear
            </button>
          )}
          <Button size="sm" variant="outline" onClick={downloadLedgerPdf} disabled={isDownloadingLedgerPdf}
            title="Download the current filtered ledger as a PDF"
            className="border-violet-700 text-violet-400 hover:bg-violet-900/30 gap-1">
            {isDownloadingLedgerPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Ledger PDF
          </Button>
          <Button size="sm" variant="outline" onClick={downloadTransactionPdf} disabled={isDownloadingTxPdf}
            title="Download transactions for the current filtered or selected invoice scope"
            className="border-blue-700 text-blue-400 hover:bg-blue-900/30 gap-1">
            {isDownloadingTxPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Tx Report PDF
          </Button>
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
                <Plus className="w-4 h-4" /> Add Invoice
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
        <div className="relative rounded-xl border border-white/10 overflow-hidden">
          {isFetching && (
            <div className="absolute inset-0 z-10 flex items-start justify-center pt-3 pointer-events-none">
              <span className="rounded-full bg-[#0A1628]/90 border border-cyan-700/40 px-3 py-1 text-[11px] text-cyan-300">
                Loading page…
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  {/* Expand chevron */}
                  <th className="px-2 py-3 w-8" />
                  {/* Tri-state header checkbox — visible whenever selection mode is active */}
                  {inSelectionMode && (
                    <th className="px-3 py-3 w-8">
                      <input
                        type="checkbox"
                        className="accent-cyan-500 w-4 h-4 cursor-pointer"
                        checked={allCurrentPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someCurrentPageSelected && !allCurrentPageSelected;
                        }}
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (selectAllMatching) {
                              // Remove current page from exclusion set
                              setExcludedIds(prev => {
                                const next = new Set(prev);
                                currentPageIds.forEach(id => next.delete(id));
                                return next;
                              });
                            } else {
                              // Add current page to explicit selection
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                currentPageIds.forEach(id => next.add(id));
                                return next;
                              });
                            }
                          } else {
                            if (selectAllMatching) {
                              // Add current page to exclusion set (keep scope, exclude these)
                              setExcludedIds(prev => {
                                const next = new Set(prev);
                                currentPageIds.forEach(id => next.add(id));
                                return next;
                              });
                            } else {
                              // Remove current page from explicit selection
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                currentPageIds.forEach(id => next.delete(id));
                                return next;
                              });
                            }
                          }
                        }}
                      />
                    </th>
                  )}
                  {([
                    ["Invoice No.","invoiceNumbers","text"],["Receipt No.","receiptNumbers","text"],["Student","studentNames","text"],["DSID","dsids","text"],
                    ["Class","classes","multi"],["Section","sections","multi"],["Fee Name","feeNames","multi"],["Fee Type","feeTypes","multi"],
                    ["Fee Period","feePeriods","multi"],["Frequency","frequencies","multi"],["Invoice Amount","amountMin","range"],["Due Date","dueDateFrom","date"],
                    ["Status","statuses","multi"],["Payment Method","paymentMethods","multi"],["Payment On","paidDateFrom","date"],["Acad. Year","academicYears","multi"],["Actions","","text"],
                  ] as const).map(([h, field, kind], i) => (
                    <th key={h} className={`px-4 py-3 text-white/50 font-medium text-xs ${i === 10 || i === 16 ? "text-right" : i >= 11 && i <= 15 ? "text-center" : "text-left"}`}>
                      <span className="inline-flex items-center gap-0.5">{h}{field && <HeaderFilter label={h} field={field as keyof LedgerFilters} toField={field === "amountMin" ? "amountMax" : field === "dueDateFrom" ? "dueDateTo" : field === "paidDateFrom" ? "paidDateTo" : undefined} filters={filters} setFilters={setFilters} kind={kind} options={(field === "feePeriods" ? (ledgerFilterOptions?.feePeriods ?? []) : (
                        field === "classes" ? (ledgerFilterOptions?.classes ?? classes) : field === "feeNames" ? (ledgerFilterOptions?.feeNames ?? allFeeNames) : field === "feeTypes" ? (ledgerFilterOptions?.feeTypes ?? allFeeTypes) :
                        field === "sections" ? (ledgerFilterOptions?.sections ?? [...new Set(feeRecords.map(r => r.student?.section).filter(Boolean) as string[])].sort()) :
                        field === "statuses" ? (ledgerFilterOptions?.statuses ?? ["Due","Paid","Overdue"]) : field === "paymentMethods" ? (ledgerFilterOptions?.paymentMethods ?? ["Portal Payment","Cash","Cheque","BankTransfer","DemandDraft","UpiQr"]) :
                        field === "frequencies" ? (ledgerFilterOptions?.frequencies ?? ["monthly","quarterly","annual","one-time"]) : field === "academicYears" ? (ledgerFilterOptions?.academicYears ?? [...new Set(feeRecords.map(r => r.academicYear).filter(Boolean) as string[])].sort()) : []
                      )).map(option => typeof option === "string" ? ({ value: option, label: field === "paymentMethods" ? ({ Online: "Portal Payment", BankTransfer: "Bank Transfer", DemandDraft: "Demand Draft", UpiQr: "UPI / QR" }[option] ?? option) : option }) : option)} />}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* ── Select-all-matching banner ──────────────────────────────────────── */}
                {inSelectionMode && (selectAllMatching || (allCurrentPageSelected && ledgerTotal > filtered.length)) && (
                  <tr>
                    <td colSpan={19} className="py-2 px-6 bg-cyan-950/40 border-b border-cyan-800/30 text-center text-xs text-cyan-300">
                      {selectAllMatching ? (
                        <>
                          {excludedIds.size > 0 ? (
                            <><span className="font-semibold">{effectiveSelectedCount.toLocaleString()}</span> of <span className="font-semibold">{ledgerTotal.toLocaleString()}</span> matching records selected.</>
                          ) : (
                            <>All <span className="font-semibold">{ledgerTotal.toLocaleString()}</span> matching records are selected.</>
                          )}{" "}
                          <button
                            onClick={() => { setSelectAllMatching(false); setSelectedIds(new Set()); setExcludedIds(new Set()); setSelectionModeActive(false); }}
                            className="underline hover:text-white transition-colors">
                            Clear selection
                          </button>
                        </>
                      ) : (
                        <>
                          All{" "}
                          <span className="font-semibold">{filtered.length}</span>{" "}
                          records on this page are selected.{" "}
                          <button
                            onClick={() => { setSelectAllMatching(true); setExcludedIds(new Set()); }}
                            className="underline hover:text-white transition-colors">
                            Select all {ledgerTotal.toLocaleString()} matching records
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )}
                {filtered.map(rec => {
                  const isExpanded = expandedLedgerRow === rec.id;
                  const detail = detailCache.get(rec.id);
                  const isLoadingDetail = detailLoading === rec.id;
                  const activeSection = detailSection[rec.id] ?? 0;
                  const mainPayment = detail?.payment ?? null;
                  const colSpan = 17 + (inSelectionMode ? 1 : 0) + 1; /* +1 for chevron */
                  return (
                  <React.Fragment key={rec.id}>
                  <tr className={`border-b border-white/5 transition-colors ${isRowSelected(rec.id) ? "bg-red-900/10" : isExpanded ? "bg-white/[0.04]" : "hover:bg-white/5"}`}
                    onClick={(e) => {
                      const t = e.target as HTMLElement;
                      if (!t.closest("button") && !t.closest("input") && !t.closest("a")) toggleLedgerRow(rec.id);
                    }}
                    style={{ cursor: "pointer" }}>
                    {/* Chevron expand cell */}
                    <td className="px-2 py-3 text-white/30 select-none">
                      {isExpanded
                        ? <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
                        : <ChevronDown className="w-3.5 h-3.5" />}
                    </td>
                    {/* Row checkbox — visible whenever selection mode is active */}
                    {inSelectionMode && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          className="accent-cyan-500 w-4 h-4 cursor-pointer"
                          checked={isRowSelected(rec.id)}
                          onChange={e => {
                            if (selectAllMatching) {
                              // Stay in "all matching" mode — just adjust the exclusion set.
                              // Unchecking adds to excludedIds; re-checking removes from it.
                              setExcludedIds(prev => {
                                const next = new Set(prev);
                                if (!e.target.checked) next.add(rec.id); else next.delete(rec.id);
                                return next;
                              });
                            } else {
                              const next = new Set(selectedIds);
                              if (e.target.checked) next.add(rec.id); else next.delete(rec.id);
                              setSelectedIds(next);
                            }
                          }}
                        />
                      </td>
                    )}
                    {/* Invoice No. — permanent identifier (INV-xxxx), never overwritten by payment */}
                    <td className="px-4 py-3 text-left">
                      {rec.invoiceNumber
                        ? <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-violet-700/30 text-violet-300">{rec.invoiceNumber}</span>
                        : <span className="text-white/20 text-xs">—</span>}
                    </td>
                    {/* Receipt No. — payment receipt (ON-xxxx / OF-xxxx), set after payment */}
                    <td className="px-4 py-3 text-left">
                      {rec.receiptNumber
                        ? <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-cyan-700/30 text-cyan-300">{rec.receiptNumber}</span>
                        : <span className="text-white/20 text-xs">—</span>}
                    </td>
                    {/* Student */}
                    <td className="px-4 py-3">
                      <p className="text-white font-medium leading-tight text-sm">{rec.student?.name ?? "—"}</p>
                    </td>
                    {/* DSID */}
                    <td className="px-4 py-3 text-left">
                      <span className="text-xs font-mono text-cyan-400/80">{rec.student?.digitalStudentId ?? "—"}</span>
                    </td>
                    {/* Class */}
                    <td className="px-4 py-3 text-white/70 text-xs text-center">{rec.student?.class ?? "—"}</td>
                    {/* Section */}
                    <td className="px-4 py-3 text-white/70 text-xs text-center">{rec.student?.section ?? "—"}</td>
                    <td className="px-4 py-3 text-white/80 text-sm">{resolveFeeDisplayName(rec)}</td>
                    <td className="px-4 py-3 text-white/70 text-xs">{rec.feeType}</td>
                    <td className="px-4 py-3 text-white/70 text-xs">
                      {(rec as any).feePeriodStart && (rec as any).feePeriodEnd
                        ? clientFeePeriodLabel((rec as any).feePeriodStart, (rec as any).feePeriodEnd)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-white/70 text-xs">
                      {invoiceFrequencyLabel((rec as any).frequency ?? null)}
                    </td>
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
                    </td>
                    <td className="px-4 py-3 text-center">
                      <PaymentMethodBadge method={rec.paymentMethod} />
                    </td>
                    <td className="px-4 py-3 text-center text-white/50 text-xs">{fmtDate(rec.paidDate)}</td>
                    <td className="px-4 py-3 text-center text-white/50 text-xs">{rec.academicYear ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
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
                          const failedInfo = failedCounts[rec.id];
                          if (!failedInfo || failedInfo.count === 0) return null;
                          return (
                            <span
                              title={failedInfo.lastError ? `Last error: ${failedInfo.lastError}` : `${failedInfo.count} failed payment attempt${failedInfo.count !== 1 ? "s" : ""}`}
                              className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded text-[10px] font-semibold bg-red-900/50 border border-red-700/60 text-red-400 cursor-default select-none"
                            >
                              {failedInfo.count} failed
                            </span>
                          );
                        })()}
                        {rec.status === "Paid" ? (() => {
                          const offlinePayment = (paymentsByFeeRecordId.get(rec.id) ?? [])
                            .find(p => p.cashierNotes !== "Auto-recorded from Add Fee Record");
                          return (
                            <Button size="sm" variant="ghost"
                              onClick={() => window.open(
                                offlinePayment
                                  ? `/api/admin/fees/payments/${offlinePayment.id}/receipt?print=1`
                                  : `/api/admin/fees/${rec.id}/receipt?print=1`,
                                "_blank",
                              )}
                              className="h-7 px-2 text-xs text-cyan-400 hover:bg-cyan-900/30 gap-1"
                              title={`Open receipt ${rec.receiptNumber ?? ""}`}>
                              <Receipt className="w-3 h-3" /> Receipt
                            </Button>
                          );
                        })() : (
                          <Button size="sm" variant="ghost"
                            onClick={() => printInvoiceFromRecord(rec.id)}
                            className="h-7 px-2 text-xs text-blue-300 hover:bg-blue-900/30 gap-1"
                            title={`Print or download invoice ${rec.invoiceNumber ?? ""}`}>
                            <FileText className="w-3 h-3" /> Invoice
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* ── Expandable accordion row ─── */}
                  {isExpanded && (
                    <tr className="border-b border-cyan-900/30 bg-[#08111f]">
                      <td colSpan={colSpan} className="px-0 py-0">
                        {isLoadingDetail ? (
                          <div className="flex items-center justify-center gap-2 py-8 text-white/40">
                            <Loader2 className="w-4 h-4 animate-spin" /> Loading transaction details…
                          </div>
                        ) : detail ? (
                          <div className="px-6 py-5 space-y-4">
                            {/* Section tabs + action toolbar */}
                            <div className="flex flex-wrap items-center gap-1 border-b border-white/10 pb-3">
                              {["Online Payment","Financial","Student Profile","Audit & Notes"].map((label, i) => (
                                <button key={i}
                                  onClick={() => setDetailSection(prev => ({ ...prev, [rec.id]: i }))}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeSection === i ? "bg-cyan-600 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/5"}`}>
                                  {label}
                                </button>
                              ))}
                              <div className="ml-auto flex items-center gap-2">
                                <Button size="sm" variant="ghost"
                                  onClick={() => window.open(`/api/admin/fees/${rec.id}/transaction-pdf`, "_blank")}
                                  className="h-7 px-2 text-xs text-emerald-400 hover:bg-emerald-900/30 gap-1">
                                  <FileText className="w-3 h-3" /> Full Detail PDF
                                </Button>
                                {rec.status !== "Paid" && (
                                  <Button size="sm" variant="ghost"
                                    onClick={() => printInvoiceFromRecord(rec.id)}
                                    className="h-7 px-2 text-xs text-blue-300 hover:bg-blue-900/30 gap-1">
                                    <FileText className="w-3 h-3" /> Invoice
                                  </Button>
                                )}
                                {rec.status === "Paid" && (() => {
                                  const offPay = (paymentsByFeeRecordId.get(rec.id) ?? []).find(p => p.cashierNotes !== "Auto-recorded from Add Fee Record");
                                  const receiptHtmlUrl = offPay
                                    ? `/api/admin/fees/payments/${offPay.id}/receipt?print=1`
                                    : `/api/admin/fees/${rec.id}/receipt?print=1`;
                                  return (
                                    <Button size="sm" variant="ghost"
                                      onClick={() => window.open(receiptHtmlUrl, "_blank")}
                                      className="h-7 px-2 text-xs text-cyan-400 hover:bg-cyan-900/30 gap-1"
                                      title={`Open receipt ${rec.receiptNumber ?? ""}`}>
                                      <Receipt className="w-3 h-3" /> Receipt
                                    </Button>
                                  );
                                })()}
                              </div>
                            </div>

                            {/* Section 0 — Online Payment Details (all payment records) */}
                            {activeSection === 0 && (
                              <div className="space-y-4">
                                <PaymentAttemptTimeline detail={detail} />
                                {detail.payments.length === 0 ? (
                                  <div className="py-6 text-center text-white/30 text-sm">
                                    <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                    <p>No payment records found for this fee.</p>
                                  </div>
                                ) : detail.payments.map((pay, pi) => (
                                  <div key={pay.id} className="border border-white/10 rounded-xl p-4 space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-white/60 border-b border-white/8 pb-2">
                                      <span className="text-white/40">Payment {detail.payments.length > 1 ? `#${pi + 1} of ${detail.payments.length}` : ""}</span>
                                      <span className="font-mono text-cyan-300">{fmt(pay.amount)}</span>
                                      <span className="ml-auto text-white/30">{pay.createdAt ? fmtDateTimeIST(pay.createdAt) : fmtDate(pay.receivedDate)}</span>
                                    </div>
                                    {(pay.paymentMethod === "Online" || pay.paymentMethod === "Portal Payment") ? (
                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                          <TxnDetailRow label="Payment Method" value="Portal Payment" />
                                          <TxnDetailRow label="Gateway" value="Razorpay" />
                                          <TxnDetailRow label="Payment ID" value={
                                            pay.razorpayPaymentId
                                              ? <a href={`https://dashboard.razorpay.com/app/payments/${pay.razorpayPaymentId}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline font-mono text-xs flex items-center gap-1">{pay.razorpayPaymentId} <ExternalLink className="w-3 h-3" /></a>
                                              : null
                                          } />
                                          <TxnDetailRow label="Order ID" value={<span className="font-mono text-xs">{pay.razorpayOrderId ?? "—"}</span>} />
                                          <TxnDetailRow label="Gateway Method" value={
                                            pay.paymentMode
                                              ? <span className="capitalize px-2 py-0.5 rounded-full text-xs bg-blue-900/40 text-blue-300 border border-blue-700/40">{pay.paymentMode}</span>
                                              : null
                                          } />
                                          <TxnDetailRow label="Bank" value={pay.bankName} />
                                          <TxnDetailRow label="Card (last 4)" value={pay.cardLast4 ? `●●●● ${pay.cardLast4}` : null} />
                                          <TxnDetailRow label="UPI VPA" value={<span className="font-mono text-xs">{pay.vpa ?? "—"}</span>} />
                                        </div>
                                        <div className="space-y-1.5">
                                          <TxnDetailRow label="Payer Name" value={pay.payerName} />
                                          <TxnDetailRow label="Payer Email" value={pay.payerEmail} />
                                          <TxnDetailRow label="Payer Contact" value={pay.payerContact} />
                                          <TxnDetailRow label="Gateway Status" value={
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${pay.gatewayStatus === "captured" ? "bg-emerald-900/40 text-emerald-400 border-emerald-700/40" : pay.gatewayStatus === "refunded" ? "bg-red-900/40 text-red-400 border-red-700/40" : "bg-white/10 text-white/50 border-white/10"}`}>
                                              {pay.gatewayStatus ?? "—"}
                                            </span>
                                          } />
                                          <TxnDetailRow label="Receipt No." value={<span className="font-mono text-cyan-300 text-xs">{pay.receiptNumber ?? "—"}</span>} />
                                          <div className="mt-1">
                                            <p className="text-white/30 text-[10px] mb-0.5">HMAC Signature</p>
                                            <p className="text-white/35 font-mono text-[9px] break-all leading-tight">{pay.razorpaySignature ?? "—"}</p>
                                          </div>
                                           <div className="pt-2">
                                             <RefundPaymentDialog payment={pay} onSaved={() => { void fetchDetail(rec.id, true); }} />
                                           </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                          <TxnDetailRow label="Method" value={
                                            pay.paymentMethod === "BankTransfer" ? "Offline (Bank Transfer)"
                                              : pay.paymentMethod === "DemandDraft" ? "Offline (Demand Draft)"
                                              : pay.paymentMethod === "UpiQr" ? "Offline (UPI/QR)"
                                              : `Offline (${pay.paymentMethod})`
                                          } />
                                          <TxnDetailRow label="Receipt No." value={<span className="font-mono text-cyan-300 text-xs">{pay.receiptNumber ?? "—"}</span>} />
                                          <TxnDetailRow label="Received Date" value={fmtDate(pay.receivedDate)} />
                                          <TxnDetailRow label="Recorded By" value={pay.recordedByName ?? null} />
                                        </div>
                                        <div className="space-y-1.5">
                                          <TxnDetailRow label="Notes" value={pay.cashierNotes} />
                                          <OfflinePaymentCorrectionDialog payment={pay} onSaved={() => { void fetchDetail(rec.id, true); }} />
                                        </div>
                                        {(() => {
                                          const rows = offlinePaymentDetailRows(pay.paymentMethod, pay.offlineDetail, {
                                            referenceNumber: pay.referenceNumber,
                                            instrumentDate: pay.instrumentDate,
                                            bankName: pay.bankName,
                                            branchName: pay.branchName,
                                            payerName: pay.payerName,
                                            payerUpiId: pay.vpa,
                                          });
                                          const denominations = Object.entries(pay.denominationBreakdown ?? {})
                                            .filter(([, count]) => Number(count) > 0)
                                            .sort(([a], [b]) => Number(b) - Number(a));
                                          return (
                                            <>
                                              {rows.length > 0 && (
                                                <div className="col-span-2 mt-1 pt-3 border-t border-white/10 grid grid-cols-2 gap-x-4 gap-y-1.5">
                                                  {rows.map(row => <TxnDetailRow key={row.label} label={row.label} value={row.value} />)}
                                                </div>
                                              )}
                                              {denominations.length > 0 && (
                                                <div className="col-span-2 mt-1 rounded-lg bg-emerald-950/20 border border-emerald-700/30 p-3">
                                                  <p className="text-[10px] uppercase tracking-widest font-semibold text-emerald-300/70 mb-2">Cash Denominations</p>
                                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/70">
                                                    {denominations.map(([denomination, count]) => (
                                                      <span key={denomination} className="font-mono">₹{denomination} × {count} = {fmt(Number(denomination) * Number(count))}</span>
                                                    ))}
                                                  </div>
                                                  <p className="mt-2 pt-2 border-t border-emerald-700/20 text-xs font-semibold text-emerald-200">
                                                    Counted Total: {fmt(denominations.reduce((total, [denomination, count]) => total + Number(denomination) * Number(count), 0))}
                                                  </p>
                                                </div>
                                              )}
                                              {(pay.corrections?.length ?? 0) > 0 && (
                                                <div className="col-span-2 mt-1 rounded-lg bg-amber-950/20 border border-amber-700/30 p-3">
                                                  <p className="text-[10px] uppercase tracking-widest font-semibold text-amber-300/70 mb-1.5">Audited Corrections</p>
                                                  <div className="space-y-1">
                                                    {pay.corrections!.map((correction, index) => {
                                                      const labels: Record<string, string> = {
                                                        referenceNumber: "Primary reference", instrumentDate: "Instrument date",
                                                        bankName: "Bank", branchName: "Branch", payerName: "Payer",
                                                        payerUpiId: "Payer UPI ID", transactionTime: "Payment time",
                                                        instrumentStatus: "Method status", transferMode: "Transfer mode",
                                                        transactionReference: "Transaction reference", receivingBank: "Receiving bank",
                                                        receiverUpiId: "Receiver UPI ID", payeeName: "Payee name",
                                                        payableAt: "Payable at", collectionLocation: "Collection location",
                                                        depositDate: "Deposit date", depositBank: "Deposit bank",
                                                        depositReference: "Deposit reference", returnDate: "Return date",
                                                        returnReason: "Return / bounce reason",
                                                      };
                                                      const changedFields = Array.from(new Set([
                                                        ...Object.keys(correction.previousValues ?? {}),
                                                        ...Object.keys(correction.newValues ?? {}),
                                                      ])).filter(key => {
                                                        const before = correction.previousValues?.[key] ?? null;
                                                        const after = correction.newValues?.[key] ?? null;
                                                        return before !== after;
                                                      });
                                                      const displayValue = (value: unknown) =>
                                                        value == null || value === "" ? "—" : String(value);
                                                      return (
                                                        <div key={`${correction.createdAt}-${index}`} className="text-xs text-white/65 py-1.5 border-b border-amber-700/15 last:border-0">
                                                          <p>{correction.reason} <span className="text-white/30">· {correction.changedByName ?? "Administrator"} · {fmtDateTimeIST(correction.createdAt)}</span></p>
                                                          <div className="mt-1 space-y-0.5 text-[11px]">
                                                            {changedFields.length > 0 ? changedFields.map(key => (
                                                              <p key={key} className="font-mono text-white/50">
                                                                <span className="font-sans text-white/40">{labels[key] ?? key}: </span>
                                                                <span className="text-red-200/70">{displayValue(correction.previousValues?.[key])}</span>
                                                                <span className="mx-1 text-amber-300">→</span>
                                                                <span className="text-emerald-200/80">{displayValue(correction.newValues?.[key])}</span>
                                                              </p>
                                                            )) : <p className="italic text-white/35">No field value changed.</p>}
                                                          </div>
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                </div>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Section 1 — Financial & Fee Breakdown */}
                            {activeSection === 1 && (
                              <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                  <TxnDetailRow label="Fee Name" value={resolveFeeDisplayName(rec)} />
                                  <TxnDetailRow label="Fee Type" value={rec.feeType} />
                                  <TxnDetailRow label="Base Fee" value={fmt(detail.feeRecord.amount)} />
                                  <TxnDetailRow label="Late Fee" value={detail.feeRecord.lateFeeAmount > 0 ? <span className="text-amber-400">{fmt(detail.feeRecord.lateFeeAmount)}</span> : null} />
                                  <TxnDetailRow label="Total Charged" value={<span className="font-black">{fmt(detail.feeRecord.amount + detail.feeRecord.lateFeeAmount)}</span>} />
                                  <TxnDetailRow label="Total Received" value={<span className="font-black text-emerald-400">{fmt(detail.payments.reduce((s, p) => s + p.amount, 0))}</span>} />
                                   <TxnDetailRow label="Processed Refunds" value={<span className="font-black text-amber-300">{fmt((detail.refundSummary?.processedRefundedPaise ?? 0) / 100)}</span>} />
                                   <TxnDetailRow label="Net Retained" value={<span className="font-black text-cyan-300">{fmt((detail.refundSummary?.netRetainedPaise ?? detail.payments.reduce((s, p) => s + p.amount, 0) * 100) / 100)}</span>} />
                                   {(detail.refunds?.length ?? 0) > 0 && <div className="mt-3 rounded-lg border border-amber-700/30 bg-amber-950/15 p-3">
                                     <p className="text-[10px] uppercase tracking-widest text-amber-200/70 mb-2">Refund lifecycle</p>
                                     {detail.refunds!.map(refund => <div key={refund.id} className="flex justify-between gap-3 py-1.5 text-xs border-t border-amber-700/15 first:border-0">
                                       <span className="text-white/70">{fmt(refund.processedAmountPaise != null ? refund.processedAmountPaise / 100 : refund.requestedAmountPaise / 100)} · {refund.reasonCode?.replaceAll("_", " ") ?? "Provider refund"}</span>
                                       <span className={refund.localStatus === "processed" ? "text-emerald-300" : refund.localStatus === "failed" ? "text-red-300" : "text-amber-300"}>{refund.localStatus.replaceAll("_", " ")}</span>
                                     </div>)}
                                   </div>}
                                  <TxnDetailRow label="Invoice No." value={<span className="font-mono text-violet-300 text-xs">{rec.invoiceNumber ?? "—"}</span>} />
                                   <TxnDetailRow label="Invoice Date & Time" value={formatPersistedInvoiceDateTimeIST(detail.feeRecord.createdAt)} />
                                  <TxnDetailRow label="Receipt No." value={<span className="font-mono text-cyan-300 text-xs">{rec.receiptNumber ?? mainPayment?.receiptNumber ?? "—"}</span>} />
                                  {detail.payments.length > 1 && (
                                    <div className="mt-2 pt-2 border-t border-white/10">
                                      <p className="text-white/30 text-[10px] mb-1">Payment history ({detail.payments.length} transactions)</p>
                                      {detail.payments.map((p, i) => (
                                        <div key={p.id} className="flex justify-between text-xs py-0.5 text-white/50">
                                          <span>#{i + 1} {p.paymentMethod} · {p.createdAt ? fmtDateTimeIST(p.createdAt) : fmtDate(p.receivedDate)}</span>
                                          <span className="text-white/70">{fmt(p.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <p className="text-white/40 text-xs font-medium mb-2">Fee Breakdown</p>
                                  {detail.feeRecord.breakdown?.length > 0 ? (
                                    <div className="space-y-1">
                                      {detail.feeRecord.breakdown.map((b, bi) => (
                                        <div key={bi} className="flex justify-between text-xs py-1 border-b border-white/5">
                                          <span className="text-white/60">{b.name}</span>
                                          <span className="text-white/80">{fmt(b.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-white/25 text-xs italic">No breakdown items</p>
                                  )}
                                  <div className="mt-3 p-2 rounded bg-white/5 border border-white/10 text-[10px] text-white/30 italic">
                                    Convenience fee / GST / settlement batch — N/A (requires Razorpay Settlements API)
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Section 2 — Student & Academic Profile */}
                            {activeSection === 2 && (
                              <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                  <TxnDetailRow label="Student Name" value={detail.student.name} />
                                  <TxnDetailRow label="DSID" value={<span className="font-mono text-xs text-cyan-400">{detail.student.digitalStudentId}</span>} />
                                  <TxnDetailRow label="Class" value={detail.student.class} />
                                  <TxnDetailRow label="Section" value={detail.student.section} />
                                  {detail.student.rollNumber != null && <TxnDetailRow label="Roll No." value={String(detail.student.rollNumber)} />}
                                </div>
                                <div className="space-y-2">
                                  <TxnDetailRow label="Academic Year" value={detail.feeRecord.academicYear} />
                                  {detail.student.guardianName && <TxnDetailRow label="Guardian" value={detail.student.guardianName} />}
                                  {detail.student.phone && <TxnDetailRow label="Contact" value={detail.student.phone} />}
                                  {detail.student.email && <TxnDetailRow label="Email" value={detail.student.email} />}
                                </div>
                              </div>
                            )}

                            {/* Section 3 — Audit & Notes */}
                            {activeSection === 3 && (
                              <div className="space-y-4">
                                <div>
                                  <p className="text-white/40 text-xs font-medium mb-1.5">Admin Notes</p>
                                  <textarea
                                    value={adminNotes[rec.id] ?? mainPayment?.cashierNotes ?? ""}
                                    onChange={e => setAdminNotes(prev => ({ ...prev, [rec.id]: e.target.value }))}
                                    onBlur={() => mainPayment && saveAdminNotes(rec.id, mainPayment.id, adminNotes[rec.id] ?? "")}
                                    placeholder="Add notes visible only to admins…"
                                    rows={2}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 resize-none"
                                  />
                                  {savingNotes.has(rec.id) && <p className="text-white/30 text-[10px] mt-0.5">Saving…</p>}
                                  {!mainPayment && <p className="text-white/25 text-[10px] mt-0.5 italic">Notes can only be saved once a payment is recorded.</p>}
                                </div>
                                <div>
                                  <p className="text-white/40 text-xs font-medium mb-2">Audit Trail ({detail.auditEntries.length} entries)</p>
                                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                                    {detail.auditEntries.length === 0 ? (
                                      <p className="text-white/20 text-xs italic">No audit entries for this fee record.</p>
                                    ) : detail.auditEntries.map(a => (
                                      <div key={a.id} className="flex gap-3 text-xs border-b border-white/5 pb-1.5">
                                        <div className="shrink-0 text-white/30 text-[10px] w-32 leading-tight">
                                          {fmtDateTime(a.createdAt)}<br/>
                                          <span className="font-mono">{a.ipAddress ?? "—"}</span>
                                        </div>
                                        <div className="grow">
                                          <span className="text-white/50 font-medium">{a.actorName ?? "System"}</span>
                                          <span className="text-white/30 mx-1">·</span>
                                          <ActionBadge action={a.action} />
                                          {a.description && <p className="text-white/45 text-[10px] mt-0.5 leading-snug">{a.description}</p>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-2 py-6 text-white/30 text-xs">
                            <AlertTriangle className="w-4 h-4" /> Failed to load transaction details.
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ledgerTotalPages > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={ledgerPage <= 1 || isFetching}
            onClick={() => setLedgerPage(page => Math.max(1, page - 1))}
            className="min-w-28 min-h-9 border-white/15 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
          </Button>
          <span className="text-xs text-white/60 min-w-24 text-center">
            Page {ledgerData?.page ?? ledgerPage} of {ledgerTotalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={ledgerPage >= ledgerTotalPages || isFetching}
            onClick={() => setLedgerPage(page => Math.min(ledgerTotalPages, page + 1))}
            className="min-w-28 min-h-9 border-white/15 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-40"
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Summary strip — updates live as filters change */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="text-white/30">
          <span className="text-white/50 font-semibold">{students.length}</span> active student{students.length !== 1 ? "s" : ""} in registry
        </span>
        <span className="text-white/20">·</span>
        <span className="text-white/30">
          <span className="text-white/50 font-semibold">{new Set(filtered.map(r => r.studentId)).size}</span> student{new Set(filtered.map(r => r.studentId)).size !== 1 ? "s" : ""} in view
        </span>
        <span className="text-white/20">·</span>
        <span className="text-white/30">
          <span className="text-white/50 font-semibold">{filtered.length}</span> of <span className="text-white/50 font-semibold">{ledgerTotal}</span> records
        </span>
        {selectionModeActive && (
          <>
            <span className="text-white/20">·</span>
            <span className="text-red-400/80"><span className="font-semibold">{effectiveSelectedCount.toLocaleString()}</span> selected</span>
          </>
        )}
      </div>

      {/* Payment modals */}
      <Sheet open={showFilterOverview} onOpenChange={setShowFilterOverview}>
        <SheetContent side="right" className="w-full border-white/10 bg-[#101d32] p-5 text-white sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-white">Active ledger filters</SheetTitle>
            <SheetDescription className="text-xs text-white/45">{countActiveLedgerFilters(filters)} filter{countActiveLedgerFilters(filters) === 1 ? "" : "s"} currently shape the ledger, PDFs, and CSV export.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-2">
            {activeFilterEntries.length ? activeFilterEntries.map(entry => <div key={entry.keys.join(":")} className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{entry.label}</p><p className="mt-0.5 break-words text-sm text-white/80">{entry.value}</p></div><button type="button" onClick={() => setFilters(previous => { const next = { ...previous }; for (const key of entry.keys) (next as any)[key] = Array.isArray(previous[key]) ? [] : key === "search" ? "" : null; return next; })} className="text-xs text-cyan-300 hover:text-cyan-100">Clear</button></div>) : <div className="rounded-lg border border-dashed border-white/15 p-6 text-center text-sm text-white/35">No filters are active.</div>}
          </div>
          {activeFilterEntries.length > 0 && <Button variant="outline" onClick={() => setFilters(emptyLedgerFilters())} className="mt-5 w-full border-white/15 text-white/75 hover:bg-white/10">Clear all filters</Button>}
        </SheetContent>
      </Sheet>
      <StandaloneOfflinePayModal open={showStandalonePay} onClose={() => setShowStandalonePay(false)} />
      <ExportLedgerDialog
        open={showExportLedger}
        onClose={() => setShowExportLedger(false)}
        canonicalFilters={filters}
        selectedIds={selectedIds}
        selectAllMatching={selectAllMatching}
        excludedIds={excludedIds}
      />
      <NotificationHistoryModal
        open={showNotifModal}
        onClose={() => { setShowNotifModal(false); setNotifStudentId(null); setNotifStudentName(null); }}
        studentId={notifStudentId}
        studentName={notifStudentName}
      />

      {/* Add / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); setEditing(null); setAddFeeSuccessId(null); } }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-cyan-400">
              {addFeeSuccessId !== null ? "Invoice Created Successfully" : editing ? "Edit Fee Record" : "Add Invoice"}
            </DialogTitle>
          </DialogHeader>
          {addFeeSuccessId !== null ? (
            <div className="space-y-4 py-2">
              {isAddFeeSuccessLoading ? (
                <div className="py-12 text-center">
                  <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-3" />
                  <p className="text-white/60 text-sm">Loading the created invoice…</p>
                </div>
              ) : addFeeSuccessDetail ? (
                <>
                  <div className="p-5 rounded-xl bg-emerald-900/20 border border-emerald-700/40 text-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                    <p className="text-emerald-400 font-bold tracking-wide">INVOICE CREATED SUCCESSFULLY</p>
                    <div className="mt-4 rounded-lg bg-[#081426] border border-cyan-400/30 px-4 py-3">
                      <p className="text-[10px] font-bold tracking-[0.18em] text-cyan-300/70">INVOICE NO.</p>
                      <p className="mt-1 text-2xl font-black tracking-wide text-cyan-300">
                        {addFeeSuccessDetail.feeRecord.invoiceNumber ?? "—"}
                      </p>
                    </div>
                    <span className="inline-flex mt-3 rounded-full border border-amber-500/30 bg-amber-900/20 px-3 py-1 text-xs font-bold text-amber-300">
                      STATUS: {addFeeSuccessDetail.feeRecord.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="space-y-4 rounded-xl border border-white/10 bg-[#0A1628]/60 p-4 text-sm">
                    <div>
                      <p className="text-[10px] font-bold tracking-[0.14em] text-white/40 uppercase mb-2">Student</p>
                      <p className="font-semibold text-white">{addFeeSuccessDetail.student.name}</p>
                      <p className="text-xs text-white/50 mt-1">
                        {addFeeSuccessDetail.student.digitalStudentId} · Class {addFeeSuccessDetail.student.class ?? "—"}-{addFeeSuccessDetail.student.section ?? "—"}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-4">
                      {[
                        ["Fee Name", addFeeSuccessDetail.feeRecord.feeName],
                        ["Fee Type", addFeeSuccessDetail.feeRecord.feeType],
                        ["Amount", fmt(addFeeSuccessDetail.feeRecord.amount)],
                        ["Frequency", invoiceFrequencyLabel(addFeeSuccessDetail.feeRecord.frequency)],
                        ["Fee Period", invoiceFeePeriodLabel(addFeeSuccessDetail.feeRecord)],
                        ["Due Date", fmtDate(addFeeSuccessDetail.feeRecord.dueDate)],
                        ["Academic Session", addFeeSuccessDetail.feeRecord.academicYear ?? "—"],
                        ["Invoice Date & Time", formatPersistedInvoiceDateTimeIST(addFeeSuccessDetail.feeRecord.createdAt)],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">{label}</p>
                          <p className="mt-0.5 font-medium text-white/85 break-words">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-white/10 pt-4">
                      <p className="text-[10px] font-bold tracking-[0.14em] text-white/40 uppercase">Late Fee &amp; Penalty</p>
                      {addFeeSuccessDetail.feeRecord.lateFeeConfig?.enabled ? (
                        <div className="mt-2 text-white/85 space-y-1">
                          <p><span className="text-amber-300 font-semibold">Enabled</span> · {lateFeeRuleLabel(addFeeSuccessDetail.feeRecord.lateFeeConfig.type)}</p>
                          {addFeeSuccessDetail.feeRecord.lateFeeConfig.type === "FLAT" && <p className="text-white/60">Penalty Amount: {fmt(Number(addFeeSuccessDetail.feeRecord.lateFeeConfig.flat_amount ?? 0))}</p>}
                          {addFeeSuccessDetail.feeRecord.lateFeeConfig.type === "DAILY" && (
                            <>
                              <p className="text-white/60">Daily Penalty: {fmt(Number(addFeeSuccessDetail.feeRecord.lateFeeConfig.daily_rate ?? 0))} / day</p>
                              {Number(addFeeSuccessDetail.feeRecord.lateFeeConfig.grace_period_days ?? 0) > 0 && <p className="text-white/60">Grace Period: {addFeeSuccessDetail.feeRecord.lateFeeConfig.grace_period_days} day(s)</p>}
                              {Number(addFeeSuccessDetail.feeRecord.lateFeeConfig.max_cap ?? 0) > 0 && <p className="text-white/60">Maximum Penalty Cap: {fmt(Number(addFeeSuccessDetail.feeRecord.lateFeeConfig.max_cap))}</p>}
                            </>
                          )}
                          {addFeeSuccessDetail.feeRecord.lateFeeConfig.type === "TIERED" && (addFeeSuccessDetail.feeRecord.lateFeeConfig.tiered_slabs?.length ?? 0) > 0 && (
                            <div className="pt-1 space-y-1">
                              {addFeeSuccessDetail.feeRecord.lateFeeConfig.tiered_slabs!.map((slab, index) => (
                                <p key={`${slab.from_day}-${slab.to_day}-${index}`} className="text-white/60">
                                  Days {slab.from_day}–{slab.to_day}: {fmt(Number(slab.amount))}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-white/60">Disabled</p>
                      )}
                    </div>

                    {addFeeSuccessDetail.feeRecord.breakdown.length > 0 && (
                      <div className="border-t border-white/10 pt-4">
                        <p className="text-[10px] font-bold tracking-[0.14em] text-white/40 uppercase mb-2">Fee Components</p>
                        <div className="space-y-2">
                          {addFeeSuccessDetail.feeRecord.breakdown.map((component, index) => (
                            <div key={`${component.name}-${index}`} className="flex items-start justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                              <div><p className="font-medium text-white/85">{component.name}</p>{component.purpose && <p className="text-xs text-white/45">{component.purpose}</p>}</div>
                              <p className="font-semibold text-cyan-300">{fmt(Number(component.amount))}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {addFeeSuccessDetail.feeRecord.notes && (
                      <div className="border-t border-white/10 pt-4">
                        <p className="text-[10px] font-bold tracking-[0.14em] text-white/40 uppercase">Notes</p>
                        <p className="mt-2 whitespace-pre-wrap text-white/70">{addFeeSuccessDetail.feeRecord.notes}</p>
                      </div>
                    )}
                  </div>

                  <p className="text-center text-xs text-white/40">
                    This is an invoice only. A payment receipt is available after successful payment.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Button className="bg-white/10 hover:bg-white/20 text-white gap-2"
                      onClick={() => printInvoiceFromRecord(addFeeSuccessDetail.feeRecord.id)}>
                      <Printer className="w-4 h-4" /> View / Print Invoice
                    </Button>
                    <Button className="bg-cyan-600 hover:bg-cyan-500 text-white" onClick={() => { setShowForm(false); setAddFeeSuccessId(null); }}>
                      Done
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-4 py-8 text-center">
                  <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
                  <p className="text-white/70 text-sm">{isAddFeeSuccessDetailError ? "The invoice was created, but its details could not be loaded." : "The invoice details are unavailable."}</p>
                  <Button className="w-full bg-cyan-600 hover:bg-cyan-500 text-white" onClick={() => { setShowForm(false); setAddFeeSuccessId(null); }}>Done</Button>
                </div>
              )}
            </div>
          ) : (
          <>
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
                        <input value={studentSearchQ} onChange={e => setStudentSearchQ(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void runStudentSearch(); } }}
                          placeholder="Search by student name or DSID…"
                          className="flex-1 bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 min-w-0" />
                        <button type="button" onClick={() => void runStudentSearch()}
                          disabled={studentSearchLoading || studentSearchQ.trim().length < 2}
                          className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium flex-shrink-0">
                          {studentSearchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
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
              {!editing && selectedStudent && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="feeName" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-white/60 mb-1 block">Fee Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. Tuition Fee" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" />
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="feeType" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-white/60 mb-1 block">Fee Type</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Tuition / Transport…" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" />
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="amount" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-white/60 mb-1 block">Amount (₹)</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" min={1} placeholder="Enter amount" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" />
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="frequency" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-white/60 mb-1 block">Frequency</FormLabel>
                        <FormControl>
                          <select
                            {...field}
                            className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                            <option value="">— Select frequency —</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="annual">Annual</option>
                            <option value="one-time">One-Time</option>
                          </select>
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="feePeriod" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-white/60 mb-1 block">Fee Period</FormLabel>
                      {watchFrequency === "monthly" || watchFrequency === "quarterly" ? (
                        <FormControl>
                          <select
                            {...field}
                            disabled={invoicePeriodOptions.length === 0}
                            className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50">
                            <option value="">
                              {invoicePeriodOptions.length === 0
                                ? "No complete periods in the active session"
                                : "— Select fee period —"}
                            </option>
                            {invoicePeriodOptions.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </FormControl>
                      ) : watchFrequency === "annual" || watchFrequency === "one-time" ? (
                        <div className="rounded-lg border border-white/10 bg-[#0A1628] px-3 py-2 text-sm text-white/80">
                          {activeInvoiceSession
                            ? `${activeInvoiceSession.sessionName} (Active academic session)`
                            : "No active academic session found"}
                          <input type="hidden" name={field.name} value={field.value} onChange={field.onChange} />
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-sm text-white/30">
                          Select a frequency to choose a fee period.
                        </div>
                      )}
                      {selectedInvoicePeriod && (
                        <p className="text-xs text-white/40">
                          Resolved period: {selectedInvoicePeriod.start} → {selectedInvoicePeriod.end}
                        </p>
                      )}
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="dueDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-white/60 mb-1 block">Due Date</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white [color-scheme:dark]" />
                      </FormControl>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )} />

                  <div className={`rounded-xl border p-4 space-y-3 transition-all ${invoiceLateFeeEnabled ? "border-amber-600/40 bg-amber-900/10" : "border-white/10 bg-white/5"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Switch checked={invoiceLateFeeEnabled} onCheckedChange={enabled => {
                          setInvoiceLateFeeEnabled(enabled);
                          if (enabled && invoiceLateFeeType === "NONE") setInvoiceLateFeeType("FLAT");
                        }} />
                        <div>
                          <p className="text-sm font-semibold text-white/80">Late Fee &amp; Penalty</p>
                          <p className="text-xs text-white/40 leading-tight">Automatically fine overdue invoices</p>
                        </div>
                      </div>
                      {invoiceLateFeeEnabled && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-700/40 flex-shrink-0">ACTIVE</span>
                      )}
                    </div>
                    {invoiceLateFeeEnabled && (
                      <div className="pt-2 border-t border-white/10 space-y-3">
                        <div>
                          <label className="text-xs text-white/50 block mb-1">Rule Type</label>
                          <select value={invoiceLateFeeType} onChange={event => setInvoiceLateFeeType(event.target.value as "FLAT" | "DAILY" | "TIERED")} className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
                            <option value="FLAT">Flat One-Time Penalty</option>
                            <option value="DAILY">Daily Accumulating Fine</option>
                            <option value="TIERED">Tiered Schedule</option>
                          </select>
                        </div>
                        {invoiceLateFeeType === "FLAT" && (
                          <div>
                            <label className="text-xs text-white/50 block mb-1">Penalty Amount (₹)</label>
                            <input type="number" min={0} value={invoiceLateFeeFlat} onChange={event => setInvoiceLateFeeFlat(event.target.value)} placeholder="Enter amount" className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-500" />
                          </div>
                        )}
                        {invoiceLateFeeType === "DAILY" && (
                          <>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-white/50 block mb-1">Grace Period (Days)</label>
                                <input type="number" min={0} value={invoiceLateFeeGraceDays} onChange={event => setInvoiceLateFeeGraceDays(event.target.value)} className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                              </div>
                              <div>
                                <label className="text-xs text-white/50 block mb-1">Daily Rate (₹/day)</label>
                                <input type="number" min={0} step="0.5" value={invoiceLateFeeDailyRate} onChange={event => setInvoiceLateFeeDailyRate(event.target.value)} placeholder="Enter rate" className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-500" />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-white/50 block mb-1">Maximum Cap (₹) <span className="text-white/30">— 0 = no cap</span></label>
                              <input type="number" min={0} value={invoiceLateFeeCap} onChange={event => setInvoiceLateFeeCap(event.target.value)} className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                            </div>
                          </>
                        )}
                        {invoiceLateFeeType === "TIERED" && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-white/50">Penalty Slabs</label>
                              <button type="button" onClick={addInvoiceLateFeeSlab} className="text-xs px-2.5 py-0.5 rounded border border-amber-700/40 text-amber-400 hover:bg-amber-900/20 transition-all">+ Add Slab</button>
                            </div>
                            {invoiceLateFeeSlabs.length > 0 ? (
                              <div className="rounded-lg border border-white/10 overflow-hidden">
                                <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-3 py-1.5 bg-white/5 border-b border-white/10">
                                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">From Day</span>
                                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">To Day</span>
                                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Fine (₹)</span>
                                  <span />
                                </div>
                                {invoiceLateFeeSlabs.map((slab, index) => (
                                  <div key={index} className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-3 py-2 border-b border-white/5 last:border-0 bg-[#0A1628]/60">
                                    <input type="number" min={1} placeholder="e.g. 1" value={slab.from_day} onChange={event => updateInvoiceLateFeeSlab(index, "from_day", event.target.value)} className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                                    <input type="number" min={1} placeholder="e.g. 7" value={slab.to_day} onChange={event => updateInvoiceLateFeeSlab(index, "to_day", event.target.value)} className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                                    <input type="number" min={0} placeholder="e.g. 100" value={slab.amount} onChange={event => updateInvoiceLateFeeSlab(index, "amount", event.target.value)} className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                                    <button type="button" onClick={() => removeInvoiceLateFeeSlab(index)} className="flex items-center justify-center w-7 h-7 rounded hover:bg-red-900/30 text-white/30 hover:text-red-400 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-white/25 px-1">No slabs. Add slabs — e.g. Day 1–7: ₹100 fine, Day 8–14: ₹200 fine.</p>
                            )}
                          </div>
                        )}
                        <p className="text-[11px] text-amber-400/60 leading-snug">⏰ The nightly cron recalculates fines for all overdue invoices with a matching late fee config automatically.</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-white/60 flex items-center gap-1.5">
                        <span className="text-cyan-400">⊞</span> Fee Breakdown / Components
                        <span className="text-white/30 font-normal">(optional — shown to students)</span>
                      </label>
                      <button type="button" onClick={addInvoiceBreakdownRow}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all hover:bg-cyan-900/40 border border-cyan-700/40 text-cyan-400">
                        <Plus className="w-3 h-3" /> Add Component
                      </button>
                    </div>
                    {invoiceBreakdown.length > 0 ? (
                      <div className="rounded-xl border border-white/10 overflow-hidden">
                        <div className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 bg-white/5 border-b border-white/10">
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Component</span>
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Purpose / Description</span>
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide text-right">Amount ₹</span>
                          <span />
                        </div>
                        {invoiceBreakdown.map((row, index) => (
                          <div key={index} className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 border-b border-white/5 last:border-0 bg-[#0A1628]/60">
                            <input value={row.name} onChange={event => updateInvoiceBreakdownRow(index, "name", event.target.value)} placeholder="Lab Fee…" className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full" />
                            <input value={row.purpose} onChange={event => updateInvoiceBreakdownRow(index, "purpose", event.target.value)} placeholder="Covers equipment & software…" className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full" />
                            <input type="number" min={0} value={row.amount} onChange={event => updateInvoiceBreakdownRow(index, "amount", event.target.value)} placeholder="0" className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full text-right" />
                            <button type="button" onClick={() => removeInvoiceBreakdownRow(index)} className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-red-900/30 text-white/30 hover:text-red-400 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        <div className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 bg-white/5 border-t border-white/10">
                          <span className="text-xs font-bold text-white/60 col-span-2">Components Total</span>
                          <span className={`text-xs font-black text-right ${invoiceBreakdownMismatch ? "text-red-400" : "text-emerald-400"}`}>₹{invoiceBreakdownTotal.toLocaleString("en-IN")}</span>
                          <span />
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-white/25 px-1">No components added. Click "+ Add Component" to itemise this fee (e.g. Tuition ₹2,500 + Library ₹500).</p>
                    )}
                    {invoiceBreakdownMismatch && (
                      <p className="text-xs text-red-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        Components total (₹{invoiceBreakdownTotal.toLocaleString("en-IN")}) doesn't match main amount (₹{(parseInt(form.watch("amount")) || 0).toLocaleString("en-IN")}). Adjust or remove components.
                      </p>
                    )}
                    <p className="text-[11px] text-white/30 px-1">Components are saved as this invoice's breakdown snapshot.</p>
                  </div>
                </>
              )}

              {editing && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="feeType" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Fee Type</FormLabel><FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white" /></FormControl><FormMessage className="text-red-400" /></FormItem>
                    )} />
                    <FormField control={form.control} name="amount" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Amount (₹)</FormLabel><FormControl><Input {...field} type="text" inputMode="numeric" className="bg-[#0A1628] border-white/20 text-white" /></FormControl><FormMessage className="text-red-400" /></FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="status" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70">Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger className="bg-[#0A1628] border-white/20 text-white"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent className="bg-[#1A2942] border-white/10">
                            {["Due","Paid","Overdue"].map(status => <SelectItem key={status} value={status} className="text-white focus:bg-white/10">{status}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="dueDate" render={({ field }) => (
                      <FormItem><FormLabel className={dueDateNotNeeded ? "text-white/30" : "text-white/70"}>Due Date</FormLabel><FormControl><Input {...field} type="date" disabled={dueDateNotNeeded} className="bg-[#0A1628] border-white/20 text-white [color-scheme:dark]" /></FormControl></FormItem>
                    )} />
                  </div>
                  {watchStatus === "Paid" && (
                    <FormField control={form.control} name="paidDate" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Paid Date</FormLabel><FormControl><Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white [color-scheme:dark]" /></FormControl></FormItem>
                    )} />
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="academicYear" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Academic Year</FormLabel><FormControl><Input {...field} readOnly className="bg-[#0A1628] border-white/10 text-white/60 cursor-default select-none" /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="notes" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Notes</FormLabel><FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white" /></FormControl></FormItem>
                    )} />
                  </div>
                </>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="ghost" onClick={() => { setShowForm(false); setEditing(null); }} className="text-white/60">Cancel</Button>
                <Button type="submit"
                  disabled={
                    createMut.isPending || updateMut.isPending || (
                      !editing && (
                        !selectedStudent ||
                        !form.watch("feeName")?.trim() ||
                        !form.watch("feeType")?.trim() ||
                        !(Number(form.watch("amount")) > 0) ||
                        !SUPPORTED_FREQUENCIES.includes(watchFrequency as SupportedFrequency) ||
                         !selectedInvoicePeriod ||
                        !form.watch("dueDate") ||
                        invoiceBreakdownMismatch
                      )
                    )
                  }
                  className="bg-cyan-600 hover:bg-cyan-500 text-white">
                  {(createMut.isPending || updateMut.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  {editing ? "Save Changes" : "Create Invoice"}
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
  const [dueDay, setDueDay] = useState("");
  const [breakdown, setBreakdown] = useState<Array<{ name: string; purpose: string; amount: string }>>([]);

  // ── Late Fee state ────────────────────────────────────────────────────────
  const [lateFeeEnabled, setLateFeeEnabled] = useState(false);
  const [lateFeeType, setLateFeeType] = useState<"NONE" | "FLAT" | "DAILY" | "TIERED">("NONE");
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState("0");
  const [lateFeeFlat, setLateFeeFlat] = useState("");
  const [lateFeeDailyRate, setLateFeeDailyRate] = useState("");
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
    setSelectedClasses([]); setDueDay("");
    setBreakdown([]);
    setLateFeeEnabled(false); setLateFeeType("FLAT"); setLateFeeGraceDays("0");
    setLateFeeFlat(""); setLateFeeDailyRate(""); setLateFeeCap("0"); setLateFeeSlabs([]);
    setShowModal(true);
  }

  function openEdit(s: FeeStructure) {
    setEditing(s);
    setName(s.name); setFeeType(s.feeType); setAmount(String(s.amount));
    setFrequency(s.frequency);
    setSelectedClasses([...s.applicableClasses]);
    if (s.dueDayOfMonth) {
      // Synthesize a DATE for the date-input using the current IST calendar
      // month/year so the day-of-month never shifts near the midnight boundary.
      const [y, mo] = todayInIST().split("-");
      const d = String(Math.min(s.dueDayOfMonth, 28)).padStart(2, "0");
      setDueDay(`${y}-${mo}-${d}`);
    } else { setDueDay(""); }
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
        name, feeType, amount: parseInt(amount),
        frequency,
        applicableClasses: selectedClasses,
        dueDayOfMonth: dueDay ? dayOfMonthFromDateOnly(dueDay) : null,
        breakdown: parsedBreakdown,
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


  // ── Generate Invoices state ────────────────────────────────────────────────
  const [genTarget, setGenTarget] = useState<FeeStructure | null>(null);
  const [genFeePeriodStart, setGenFeePeriodStart] = useState("");
  const [genFeePeriodEnd, setGenFeePeriodEnd] = useState("");
  const [genClasses, setGenClasses] = useState<string[]>([]);
  const [genResult, setGenResult] = useState<{ created: number; synced: number; skipped: number; voided: number; total: number } | null>(null);

  const { data: sessions = [] } = useQuery<AcademicSession[]>({
    queryKey: ["/api/admin/fees/sessions"],
    staleTime: 60_000,
  });

  const genMut = useMutation({
    mutationFn: async () => {
      const freq = genTarget!.frequency;
      const body: Record<string, unknown> = {};
      // Attach the admin-selected fee period for monthly/quarterly fees.
      // Annual/one-time and the academic session are both resolved server-side automatically.
      if ((freq === "monthly" || freq === "quarterly") && genFeePeriodStart && genFeePeriodEnd) {
        body.feePeriodStart = genFeePeriodStart;
        body.feePeriodEnd   = genFeePeriodEnd;
      }
      const r = await fetch(`/api/admin/fees/structures/${genTarget!.id}/generate-invoices`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Failed");
      return r.json() as Promise<{ created: number; synced: number; skipped: number; voided: number; total: number }>;
    },
    onSuccess: (data: { created: number; synced: number; skipped: number; voided: number; total: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/structures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      const parts: string[] = [];
      if (data.created > 0) parts.push(`${data.created} created`);
      if ((data.synced ?? 0) > 0) parts.push(`${data.synced} synced`);
      if (data.skipped > 0) parts.push(`${data.skipped} unchanged`);
      if ((data.voided ?? 0) > 0) parts.push(`${data.voided} out-of-scope removed`);
      const totalStr = (data.total ?? 0) > 0 ? ` · ${data.total} eligible students` : "";
      toast({ title: "✅ Invoices generated", description: (parts.join(" · ") || "No changes") + totalStr });
      setGenResult(data);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  /** Compute start/end for a calendar quarter by quarter-index (0=Q1 Jan-Mar) and year */
  function quarterBounds(qi: number, year: number): { start: string; end: string } {
    const sm = qi * 3;
    const em = sm + 2;
    return {
      start: `${year}-${String(sm + 1).padStart(2, "0")}-01`,
      end:   monthEndDateOnly(year, em),
    };
  }

  type PeriodOption = { label: string; start: string; end: string };

  /**
   * Generate all valid fee periods within a session date range.
   * Monthly → every month from sessionStart to sessionEnd (inclusive).
   * Quarterly → every calendar quarter that overlaps with the session.
   * Annual/one-time → single entry covering the full session.
   * Returns options chronologically oldest-first.
   */
  function periodsForSession(freq: string, sessionStart: string, sessionEnd: string): PeriodOption[] {
    const options: PeriodOption[] = [];
    if (!sessionStart || !sessionEnd) return options;

    // Calendar-only iteration on absolute month indices (year * 12 + month) so
    // the walk never touches the host timezone.
    const sParts = dateOnlyParts(sessionStart.slice(0, 10));
    const eParts = dateOnlyParts(sessionEnd.slice(0, 10));
    if (!sParts || !eParts) return options;
    const startIndex = sParts.year * 12 + (sParts.month - 1);
    const endIndex = eParts.year * 12 + (eParts.month - 1);

    if (freq === "monthly") {
      // Walk month by month from session start to session end (inclusive).
      for (let index = startIndex; index <= endIndex; index++) {
        const py = Math.floor(index / 12); const pm = index % 12;
        const start = `${py}-${String(pm + 1).padStart(2, "0")}-01`;
        const end   = monthEndDateOnly(py, pm);
        const label = formatMonthYearFromDateOnly(start);
        options.push({ label, start, end });
      }
    } else if (freq === "quarterly") {
      // Walk quarter by quarter — each quarter whose START is ≤ session end.
      const firstQuarterIndex = sParts.year * 12 + Math.floor((sParts.month - 1) / 3) * 3;
      for (let index = firstQuarterIndex; index <= endIndex; index += 3) {
        const qy = Math.floor(index / 12);
        const qi = Math.floor((index % 12) / 3);
        const b = quarterBounds(qi, qy);
        const label = `${formatMonthFromDateOnly(b.start)}–${formatMonthYearFromDateOnly(monthEndDateOnly(qy, qi * 3 + 2))}`;
        options.push({ label, ...b });
      }
    } else {
      // Annual / one-time — single period = full session
      options.push({
        label: `${formatMonthYearFromDateOnly(sessionStart.slice(0, 10), false)} – ${formatMonthYearFromDateOnly(sessionEnd.slice(0, 10), false)}`,
        start: sessionStart.slice(0, 10),
        end:   sessionEnd.slice(0, 10),
      });
    }

    return options;
  }

  /**
   * Given a list of period options, pick the best default:
   *  - the period whose start ≤ today ≤ end (current month is inside the session), OR
   *  - if today is outside the session (before OR after) → first option (first month of session).
   */
  function bestDefaultPeriod(options: PeriodOption[]): PeriodOption | null {
    if (!options.length) return null;
    const today = todayInIST();
    // Return the period that contains today (current month is within the active session).
    const current = options.find(o => o.start <= today && o.end >= today);
    if (current) return current;
    // Current month is outside the session (before or after) → always default to first month.
    return options[0];
  }

  /**
   * When a session is chosen in the Generate modal, compute period options
   * for the structure's frequency and pre-select the best default period.
   */
  function applySessionPeriods(sessionIdStr: string, freq: string) {
    const sess = sessions.find((s: any) => String(s.id) === sessionIdStr) as any;
    if (!sess) return;
    const start = String(sess.startDate ?? "").slice(0, 10);
    const end   = String(sess.endDate   ?? "").slice(0, 10);
    if (freq !== "monthly" && freq !== "quarterly") {
      // Annual/one-time: period = session dates directly
      setGenFeePeriodStart(start);
      setGenFeePeriodEnd(end);
    } else {
      const opts = periodsForSession(freq, start, end);
      const best = bestDefaultPeriod(opts);
      if (best) { setGenFeePeriodStart(best.start); setGenFeePeriodEnd(best.end); }
    }
  }

  function openGenInvoices(s: FeeStructure) {
    setGenTarget(s);
    setGenResult(null);
    setGenClasses([...s.applicableClasses]);

    // Auto-apply the active session's periods — the session is always fixed server-side.
    const activeSess = sessions.find((x: any) => x.isActive) as any;
    if (activeSess) {
      applySessionPeriods(String(activeSess.id), s.frequency);
    } else {
      setGenFeePeriodStart("");
      setGenFeePeriodEnd("");
    }
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
            <div key={s.id} className="rounded-xl border p-4 space-y-3 border-cyan-700/40 bg-cyan-900/10">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-white font-semibold leading-tight">{s.name}</h3>
                  <p className="text-white/50 text-xs">{s.feeType}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-900/30 text-emerald-400 border-emerald-700/30 flex-shrink-0">
                  Active
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
                {s.dueDayOfMonth != null && (
                  <div><p className="text-white/40 mb-0.5">Due Day</p><p className="text-white/70">{s.dueDayOfMonth}<sup>th</sup></p></div>
                )}
                {s.lastInvoicesGeneratedAt && (
                  <div className="col-span-2">
                    <p className="text-white/40 mb-0.5">Last Invoices Generated</p>
                    <p className="text-emerald-400/80 text-[11px]">
                      🕐 {formatDateTimeIST(s.lastInvoicesGeneratedAt)}
                    </p>
                  </div>
                )}
                {(s.frequency === "monthly" || s.frequency === "quarterly") &&
                  s.latestGeneratedFeePeriodStart &&
                  s.latestGeneratedFeePeriodEnd && (
                    <div className="col-span-2">
                      <p className="text-white/40 mb-0.5">Latest Fee Period</p>
                      <p className="text-emerald-400/80 text-[11px]">
                        {clientFeePeriodLabel(s.latestGeneratedFeePeriodStart, s.latestGeneratedFeePeriodEnd)}
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
              {[["Fee Name", name, setName, "Annual Tuition Fee"], ["Fee Type", feeType, setFeeType, "Tuition / Transport…"]].map(([label, val, set, ph]) => (
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
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min={1} placeholder="Enter amount"
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500" />
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/60 mb-1 block">Due Date</label>
                <input type="date" value={dueDay} onChange={e => setDueDay(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                {dueDay && (
                  <p className="text-white/40 text-xs mt-1">Day {dayOfMonthFromDateOnly(dueDay)} of each month</p>
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
                      <input type="number" min={0} value={lateFeeFlat} placeholder="Enter amount"
                        onChange={e => setLateFeeFlat(e.target.value)}
                        className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-500" />
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
                        <input type="number" min={0} step="0.5" value={lateFeeDailyRate} placeholder="Enter rate"
                          onChange={e => setLateFeeDailyRate(e.target.value)}
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-500" />
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
          {genTarget && !genResult && (() => {
            // Active session is always the source of truth — resolved server-side too.
            const activeSess = sessions.find((x: any) => x.isActive) as any;
            const freq = genTarget.frequency;

            // Build period options from the active session's date range.
            const periodOptions: PeriodOption[] = activeSess
              ? periodsForSession(freq, String(activeSess.startDate ?? "").slice(0, 10), String(activeSess.endDate ?? "").slice(0, 10))
              : [];

            // Generate button is disabled when: no active session found, or (monthly/quarterly with no period picked).
            const needsPeriod = freq === "monthly" || freq === "quarterly";
            const canGenerate = !!activeSess && (!needsPeriod || !!genFeePeriodStart);

            return (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm">
                <p className="text-white font-semibold">{genTarget.name}</p>
                <p className="text-white/50 text-xs">
                  {genTarget.feeType} · {fmt(genTarget.amount)} / {FREQ[genTarget.frequency] ?? genTarget.frequency}
                </p>
              </div>

              {/* Academic Session — read-only, always the active session */}
              <div>
                <label className="text-xs text-white/60 mb-1 block">Academic Session</label>
                {activeSess ? (
                  <div className="px-3 py-2 rounded-lg bg-[#0A1628] border border-white/10 text-sm text-white/80 flex items-center justify-between">
                    <span>{(activeSess as any).sessionName} (Active)</span>
                    <span className="text-[10px] text-white/30 ml-2">auto-selected</span>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-red-900/20 border border-red-700/30 text-xs text-red-400">
                    No active academic session found. Please activate a session first.
                  </div>
                )}
              </div>

              {/* Fee Period Picker — session-scoped, all months/quarters within the active session */}
              {needsPeriod && (
                <div>
                  <label className="text-xs text-white/60 mb-1 block">
                    Fee Period
                    <span className="ml-1.5 text-white/30">— all {freq === "monthly" ? "months" : "quarters"} in this session</span>
                  </label>
                  {!activeSess ? (
                    <div className="p-2 rounded-lg bg-amber-900/15 border border-amber-700/30 text-xs text-amber-400/80">
                      Activate an academic session to see available fee periods.
                    </div>
                  ) : (
                    <select
                      value={genFeePeriodStart}
                      onChange={e => {
                        const opt = periodOptions.find(o => o.start === e.target.value);
                        if (opt) { setGenFeePeriodStart(opt.start); setGenFeePeriodEnd(opt.end); }
                      }}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      {periodOptions.length === 0 && <option value="">No periods available</option>}
                      {periodOptions.map(o => {
                        const today = todayInIST();
                        const isCurrent = o.start <= today && o.end >= today;
                        const isPast    = o.end < today;
                        return (
                          <option key={o.start} value={o.start}>
                            {o.label}{isCurrent ? " ← current" : isPast ? " (past)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  )}
                  <p className="text-indigo-400/60 text-[11px] mt-1">
                    This period is stored permanently on each invoice. You can backfill any missed period.
                  </p>
                </div>
              )}

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
                  disabled={genMut.isPending || !canGenerate}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1"
                >
                  {genMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  Generate
                </Button>
              </div>
            </div>
          );
          })()}
          {genResult && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-900/20 border border-emerald-700/40 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                  <p className="text-emerald-400 font-semibold text-base leading-snug">
                    {genResult.created > 0
                      ? `${genResult.created} invoice${genResult.created !== 1 ? "s" : ""} created`
                      : genResult.synced > 0 ? "Invoices synced" : "No changes"}
                  </p>
                </div>
                <div className="divide-y divide-white/10 text-sm">
                  <div className="flex justify-between py-2">
                    <span className="text-white/60">New invoices created</span>
                    <span className="text-emerald-400 font-semibold">{genResult.created}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-white/60">Already existed · synced to latest amount</span>
                    <span className="text-cyan-400 font-semibold">{genResult.synced}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-white/60">Already up to date / settled — no change</span>
                    <span className="text-white/50 font-semibold">{genResult.skipped}</span>
                  </div>
                  {(genResult.total ?? 0) > 0 && (
                    <div className="flex justify-between py-2 border-t border-white/20">
                      <span className="text-white/80 font-medium">Eligible students in this run</span>
                      <span className="text-white font-bold">{genResult.total}</span>
                    </div>
                  )}
                  {(genResult.voided ?? 0) > 0 && (
                    <div className="flex justify-between py-2">
                      <span className="text-amber-400/80">Stale invoices cleaned up (no longer in scope)</span>
                      <span className="text-amber-400 font-semibold">{genResult.voided}</span>
                    </div>
                  )}
                </div>
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
  const { selectedSession } = useSessionView();
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

  // Template editor state — keyed "stage|channel"
  const [templateDraft, setTemplateDraft] = useState<Record<string, { bodyText: string; subjectText: string }>>({});
  const [templatesSynced, setTemplatesSynced] = useState(false);
  const [activeTemplateStage, setActiveTemplateStage] = useState<string>("D+0");

  const { data: cfg, isLoading } = useQuery<NotifConfig | null>({
    queryKey: ["/api/admin/fees/notification-config"],
    staleTime: 60_000,
  });

  const { data: logEntries = [] } = useQuery<DunningLogEntry[]>({
    queryKey: ["/api/admin/fees/dunning-log", selectedSession?.id ?? "unselected"],
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
    "D-2":  `Dear {guardian_name}, this is a reminder that {student_name}'s fee "{fee_name}" of Rs.{amount} is due on {due_date}. Please pay before the due date.`,
    "D+0":  `Dear {guardian_name}, {student_name}'s fee "{fee_name}" of Rs.{amount} is due today. Please pay promptly.`,
    "D+3":  `Reminder: {student_name}'s fee "{fee_name}" of Rs.{amount} is 3 days overdue. Please clear it at the earliest.`,
    "D+7":  `Reminder: {student_name}'s fee "{fee_name}" of Rs.{amount} is 7 days overdue. Please clear it immediately.`,
    "D+14": `FINAL NOTICE: {student_name}'s fee "{fee_name}" of Rs.{amount} is 14 days overdue. Please contact admin immediately.`,
  };
  const DEFAULT_EMAIL_SUBJECT: Record<string, string> = {
    "D-2":  "Upcoming Fee Due in 2 Days",
    "D+0":  "Fee Due Today",
    "D+3":  "Fee Reminder — 3 Days Overdue",
    "D+7":  "Fee Reminder — 7 Days Overdue",
    "D+14": "Final Notice — Fee 14 Days Overdue",
  };
  const DEFAULT_EMAIL_BODY: Record<string, string> = {
    "D-2":  `This is an advance reminder that {student_name}'s fee "{fee_name}" of ₹{amount} is due on {due_date}. Please ensure timely payment to avoid late fees.`,
    "D+0":  `This is a reminder that {student_name}'s fee "{fee_name}" of ₹{amount} is due today. Please pay to avoid late penalties.`,
    "D+3":  `{student_name}'s fee "{fee_name}" of ₹{amount} is 3 days overdue. Please clear the dues as soon as possible.`,
    "D+7":  `{student_name}'s fee "{fee_name}" of ₹{amount} is 7 days overdue. Please clear the dues immediately.`,
    "D+14": `FINAL NOTICE: {student_name}'s fee "{fee_name}" of ₹{amount} is 14 days overdue. Please contact the school admin without further delay.`,
  };

  useEffect(() => {
    // Only seed draft once the query has actually resolved (templatesLoaded = true).
    // Using the isSuccess flag prevents premature hydration before API data arrives,
    // which would seed defaults and silently ignore saved school-specific templates.
    if (!templatesSynced && templatesLoaded) {
      const rows = savedTemplates ?? [];
      const draft: Record<string, { bodyText: string; subjectText: string }> = {};
      for (const stage of ["D-2", "D+0", "D+3", "D+7", "D+14"]) {
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

  const DUNNING_ROWS = [
    { day: "D-2",  label: "2 Days Before Due",  note: "Early warning — remind parent before the due date.", icon: "📬" },
    { day: "D+0",  label: "On Due Date",         note: "Notify parent/guardian of the fee amount now due.", icon: "📅" },
    { day: "D+3",  label: "3 Days Overdue",      note: "First overdue nudge — prompt payment reminder.", icon: "📩" },
    { day: "D+7",  label: "7 Days Overdue",      note: "Escalation reminder — polite but firm.", icon: "⚠️" },
    { day: "D+14", label: "14 Days Overdue",     note: "Final notice — account may be flagged.", icon: "🚨" },
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
    "D-2": "text-violet-400", "D+0": "text-cyan-400", "D+3": "text-green-400", "D+7": "text-amber-400", "D+14": "text-orange-400",
  };

  if (isLoading) return <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;

  const anyEnabled = smsEnabled || waEnabled || emailEnabled;

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Section header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white font-semibold">Automatic Reminder System</p>
          <p className="text-white/40 text-xs mt-0.5">Reminders are processed automatically every hour based on the configured schedule. No manual action is required.</p>
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
              ? "Automatic check running…"
              : jobStatus?.lastCompletedAt
                ? `Last automatic check: ${fmtDateTime(jobStatus.lastCompletedAt)} IST`
                : "Automatic check has not run yet"
            }
          </span>
        </div>
        {jobRunning
          ? jobStatus?.startedAt && <span className="text-amber-400/70">Started {fmtDateTime(jobStatus.startedAt)}</span>
          : <span className="text-white/30">Checks run every hour</span>
        }
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

      {/* ── Save + Test ── */}
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
        </div>
      )}

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
        <div className="flex gap-1 flex-wrap">
          {[
            { key: "D-2",  label: "D−2",  color: "text-violet-400", border: "border-violet-500/60" },
            { key: "D+0",  label: "D+0",  color: "text-cyan-400",   border: "border-cyan-500/60" },
            { key: "D+3",  label: "D+3",  color: "text-green-400",  border: "border-green-500/60" },
            { key: "D+7",  label: "D+7",  color: "text-amber-400",  border: "border-amber-500/60" },
            { key: "D+14", label: "D+14", color: "text-orange-400", border: "border-orange-500/60" },
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

function ExternalPortalTab({
  onReauthRequired,
}: {
  onReauthRequired: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isReauthError = (error: unknown) =>
    error instanceof Error && error.message.includes("Admin verification is required");

  // ── Razorpay state (production / live only — no test mode) ────────────────
  // Draft values survive a mobile page-reload (switching apps to copy a key).
  // They are cleared from localStorage after a successful Save.
  const [rzpEnabled, setRzpEnabled] = useState(false);
  const [rzpKeyId, setRzpKeyId] = useState(() => localStorage.getItem("rzp_draft_key_id") ?? "");
  const [rzpKeySecret, setRzpKeySecret] = useState(() => localStorage.getItem("rzp_draft_key_secret") ?? "");
  const [rzpWebhookSecret, setRzpWebhookSecret] = useState(() => localStorage.getItem("rzp_draft_webhook_secret") ?? "");
  const [showWebhookEvents, setShowWebhookEvents] = useState(false);

  const saveKeyIdDraft     = (v: string) => { setRzpKeyId(v);         v && v !== "••••••••" ? localStorage.setItem("rzp_draft_key_id", v) : localStorage.removeItem("rzp_draft_key_id"); };
  const saveSecretDraft    = (v: string) => { setRzpKeySecret(v);     v && v !== "••••••••" ? localStorage.setItem("rzp_draft_key_secret", v)     : localStorage.removeItem("rzp_draft_key_secret"); };
  const saveWebhookDraft   = (v: string) => { setRzpWebhookSecret(v); v && v !== "••••••••" ? localStorage.setItem("rzp_draft_webhook_secret", v) : localStorage.removeItem("rzp_draft_webhook_secret"); };
  const clearDrafts        = () => { localStorage.removeItem("rzp_draft_key_id"); localStorage.removeItem("rzp_draft_key_secret"); localStorage.removeItem("rzp_draft_webhook_secret"); };

  // ── External portal state ──────────────────────────────────────────────────
  const [isEnabled, setIsEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [banner, setBanner] = useState("");

  const [synced, setSynced] = useState(false);

  // ── Fee receipt signature state ────────────────────────────────────────────
  const [selectedSigFile, setSelectedSigFile]           = useState<File | null>(null);
  const [sigPreviewUrl, setSigPreviewUrl]               = useState<string | null>(null);
  const [sigUploading, setSigUploading]                 = useState(false);
  const [sigRemoving, setSigRemoving]                   = useState(false);
  const [showSigConfirmRemove, setShowSigConfirmRemove] = useState(false);
  const sigFileRef = React.useRef<HTMLInputElement>(null);

  const { data: settings, isLoading, error } = useQuery<ExternalSettings>({
    queryKey: ["/api/admin/fees/external-settings"],
    staleTime: 60_000,
    queryFn: async () => {
      const response = await sessionFetch("/api/admin/fees/external-settings");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const requestError = new Error(body.message ?? body.error ?? "External Portal settings could not be loaded.");
        (requestError as Error & { code?: string }).code = body.code;
        throw requestError;
      }
      return body;
    },
  });

  useEffect(() => {
    if (isReauthError(error)) onReauthRequired();
  }, [error, onReauthRequired]);

  useEffect(() => {
    if (settings && !synced) {
      setRzpEnabled(settings.razorpayEnabled ?? false);
      // Only restore from server when there is no in-progress draft (draft wins).
      if (!localStorage.getItem("rzp_draft_key_id"))     setRzpKeyId(settings.razorpayKeyId ?? "");
      if (!localStorage.getItem("rzp_draft_key_secret"))  setRzpKeySecret(settings.razorpayKeySecret ?? "");
      if (!localStorage.getItem("rzp_draft_webhook_secret")) setRzpWebhookSecret(settings.razorpayWebhookSecret ?? "");
      setIsEnabled(settings.isEnabled);
      setUrl(settings.gatewayUrl ?? "");
      setBanner(settings.bannerMessage ?? "");
      setSynced(true);
    }
  }, [settings, synced]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/external-settings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
  };

  // ── Fee receipt signature handlers ────────────────────────────────────────
  const handleSigFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!ALLOWED.includes(file.type)) {
      toast({ title: "Unsupported format", description: "Please choose a PNG, JPG, or WebP image.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum allowed size is 2 MB.", variant: "destructive" });
      return;
    }
    if (sigPreviewUrl) URL.revokeObjectURL(sigPreviewUrl);
    setSigPreviewUrl(URL.createObjectURL(file));
    setSelectedSigFile(file);
    setShowSigConfirmRemove(false);
  };

  // Safe JSON parse helper — never throws even if server returns HTML or empty body
  const parseJsonResponse = async (res: Response): Promise<any> => {
    const text = await res.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { error: text.slice(0, 120) }; }
  };

  const handleSigSave = async () => {
    if (!selectedSigFile) return;
    setSigUploading(true);
    try {
      const form = new FormData();
      form.append("file", selectedSigFile, selectedSigFile.name);
      const res = await sessionFetch("/api/admin/fees/external-portal/signature", {
        method: "POST", body: form,
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) throw new Error(json.error || json.message || `Upload failed (${res.status})`);
      toast({ title: "Signature saved successfully." });
      if (sigPreviewUrl) { URL.revokeObjectURL(sigPreviewUrl); setSigPreviewUrl(null); }
      setSelectedSigFile(null);
      setSynced(false);   // force re-sync from server so preview shows processed version
      invalidate();
    } catch (err: any) {
      if (isReauthError(err)) {
        onReauthRequired();
        return;
      }
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setSigUploading(false);
    }
  };

  const handleSigRemove = async () => {
    setSigRemoving(true);
    try {
      const res = await sessionFetch("/api/admin/fees/external-portal/signature", {
        method: "DELETE",
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) throw new Error(json.error || json.message || `Remove failed (${res.status})`);
      toast({ title: "Signature removed." });
      setShowSigConfirmRemove(false);
      if (sigPreviewUrl) { URL.revokeObjectURL(sigPreviewUrl); setSigPreviewUrl(null); }
      setSelectedSigFile(null);
      setSynced(false);
      invalidate();
    } catch (err: any) {
      if (isReauthError(err)) {
        onReauthRequired();
        return;
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSigRemoving(false);
    }
  };

  // ── Razorpay save mutation (live mode only) ────────────────────────────────
  const rzpMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/fees/external-settings/razorpay", {
      razorpayEnabled: rzpEnabled,
      razorpayKeyId:   rzpKeyId || null,
      razorpayKeySecret:     rzpKeySecret || null,
      razorpayWebhookSecret: rzpWebhookSecret || null,
    }),
    onSuccess: (data: any) => {
      invalidate();
      clearDrafts(); // wipe localStorage drafts — server is now the source of truth
      if (data) {
        setRzpKeySecret(data.razorpayKeySecret ?? "");
        setRzpWebhookSecret(data.razorpayWebhookSecret ?? "");
      }
      toast({ title: "✅ Razorpay settings saved" });
    },
    onError: (e: Error) => {
      if (isReauthError(e)) return onReauthRequired();
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  // ── Portal link save mutation ──────────────────────────────────────────────
  const portalMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/fees/external-settings/portal", {
      isEnabled,
      gatewayUrl:               url || null,
      bannerMessage:            banner || null,
    }),
    onSuccess: () => {
      invalidate();
      toast({ title: "✅ External portal settings saved" });
    },
    onError: (e: Error) => {
      if (isReauthError(e)) return onReauthRequired();
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-white/40">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
  if (error) return null;

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
          <Switch checked={rzpEnabled} onCheckedChange={setRzpEnabled} />
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Mode badge — auto-detected from key prefix */}
          {rzpKeyId.startsWith("rzp_test_") ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-600/15 border border-amber-500/30">
              <span className="text-amber-400 text-sm">🧪</span>
              <span className="text-amber-300 text-xs font-bold">Test / Sandbox Mode</span>
              <span className="ml-auto text-amber-500/70 text-[10px]">No real money charged</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600/15 border border-emerald-500/30">
              <span className="text-emerald-400 text-sm">🚀</span>
              <span className="text-emerald-300 text-xs font-bold">Production / Live Mode</span>
              <span className="ml-auto text-emerald-500/70 text-[10px]">Real payments accepted</span>
            </div>
          )}

          {/* Wipe credentials button */}
          {(rzpKeyId || rzpKeySecret === "••••••••" || rzpWebhookSecret === "••••••••") && (
            <button
              onClick={() => {
                const ok = window.confirm(
                  "Wipe ALL Razorpay credentials?\n\n" +
                  "Key ID, Key Secret, and Webhook Secret will be permanently removed and Razorpay will be disabled. " +
                  "This cannot be undone."
                );
                if (!ok) return;
                apiRequest("DELETE", "/api/admin/fees/external-settings/razorpay/credentials")
                  .then(() => {
                    setRzpKeyId("");
                    setRzpKeySecret("");
                    setRzpWebhookSecret("");
                    setRzpEnabled(false);
                    clearDrafts(); // also wipe localStorage so drafts don't resurrect on next reload
                    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/external-settings"] });
                    setSynced(false);
                    toast({ title: "Credentials wiped", description: "All Razorpay keys have been removed." });
                  })
                  .catch((error: Error) => {
                    if (isReauthError(error)) return onReauthRequired();
                    toast({ title: "Error wiping credentials", variant: "destructive" });
                  });
              }}
              className="w-full py-2 rounded-xl text-xs font-bold border border-red-700/40 bg-red-900/10 text-red-400 hover:bg-red-900/20 transition-all">
              🗑️ Clear All Credentials
            </button>
          )}

          {/* Key ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60">Key ID <span className="text-red-400">*</span></label>
            <input value={rzpKeyId} onChange={e => saveKeyIdDraft(e.target.value)}
              placeholder="rzp_live_… or rzp_test_…"
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500 placeholder:text-white/20 disabled:opacity-40" />
          </div>

          {/* Key Secret */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60">Key Secret <span className="text-red-400">*</span></label>
            <input type="password" value={rzpKeySecret} onChange={e => saveSecretDraft(e.target.value)}
              placeholder={rzpKeySecret === "••••••••" ? "Leave blank to keep existing secret" : "Enter Key Secret…"}
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500 placeholder:text-white/20 disabled:opacity-40" />
            <p className="text-white/25 text-[11px]">Stored server-side only — never exposed to the browser after saving.</p>
          </div>

          {/* Webhook Secret */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60">Webhook Secret <span className="text-red-400">*</span></label>
            <input type="password" value={rzpWebhookSecret} onChange={e => saveWebhookDraft(e.target.value)}
              placeholder={rzpWebhookSecret === "••••••••" ? "Leave blank to keep existing secret" : "Enter Webhook Secret…"}
              className={`w-full bg-[#0F1E35] border rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500 placeholder:text-white/20 disabled:opacity-40 ${!rzpWebhookSecret ? "border-red-500/50" : "border-white/10"}`} />
            <div className="space-y-1">
              <p className="text-white/25 text-[11px]">
                Register this URL in Razorpay Dashboard → Webhooks →{" "}
                <span className="font-mono text-blue-400/70">/api/webhooks/razorpay</span> → enable{" "}
                <button
                  type="button"
                  onClick={() => setShowWebhookEvents(v => !v)}
                  className="inline-flex items-center gap-0.5 font-mono text-blue-400/80 hover:text-blue-300 transition-colors underline underline-offset-2 cursor-pointer"
                >
                  15 events
                  <svg className={`w-2.5 h-2.5 transition-transform ${showWebhookEvents ? "rotate-180" : ""}`} fill="none" viewBox="0 0 10 10" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 3.5l3 3 3-3" />
                  </svg>
                </button>
              </p>
              {showWebhookEvents && (
                <div className="mt-1.5 rounded-xl border border-blue-500/20 bg-blue-950/30 p-3 space-y-2">
                  {[
                    { label: "Core payments", events: ["payment.captured", "payment.failed", "payment.authorized"] },
                    { label: "Refunds", events: ["refund.created", "refund.processed", "refund.failed"] },
                    { label: "Disputes", events: ["payment.dispute.created", "payment.dispute.action_required", "payment.dispute.won", "payment.dispute.lost", "payment.dispute.closed", "payment.dispute.under_review"] },
                    { label: "Downtime alerts", events: ["payment.downtime.started", "payment.downtime.updated", "payment.downtime.resolved"] },
                  ].map(group => (
                    <div key={group.label}>
                      <p className="text-[11px] font-bold text-white/70 uppercase tracking-wider mb-1.5">{group.label}</p>
                      <div className="flex flex-wrap gap-1">
                        {group.events.map(e => (
                          <span key={e} className="font-mono text-[11px] bg-blue-900/50 text-blue-200 border border-blue-400/30 rounded px-1.5 py-0.5">{e}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-white/50 pt-2 border-t border-white/10">All others (order.paid, invoice.*, settlement.*, account.*, payment_link.*) can be left disabled.</p>
                </div>
              )}
            </div>
          </div>

          {rzpEnabled && !rzpConfigured && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
              <Shield className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-amber-400/90 text-xs leading-relaxed">
                Enter and save Key ID + Key Secret before enabling. Students cannot pay until both are saved.
              </p>
            </div>
          )}

          {!rzpWebhookSecret && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25">
              <Shield className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-400/90 text-xs leading-relaxed">
                Webhook Secret is required. Copy it from Razorpay Dashboard → Webhooks → your webhook → Secret. Without it, payment confirmations cannot be verified.
              </p>
            </div>
          )}

          <Button onClick={() => rzpMut.mutate()} disabled={rzpMut.isPending || !rzpWebhookSecret}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl py-2.5 disabled:opacity-50 disabled:cursor-not-allowed">
            {rzpMut.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving…</>
              : "Save Razorpay Settings"}
          </Button>
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
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Gateway / Portal URL
            </label>
            <input value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://pay.yourschool.edu/fees"
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 disabled:opacity-40" />
          </div>

          {/* Banner message */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60 flex items-center gap-1">
              <Bell className="w-3 h-3" /> Banner Message (shown to students)
            </label>
            <textarea value={banner} onChange={e => setBanner(e.target.value)} rows={3}
              placeholder="Pay your fees online at the link below. For queries, contact the accounts office."
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 resize-none disabled:opacity-40" />
            <p className="text-white/25 text-xs text-right">{banner.length}/500</p>
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

          <Button onClick={() => portalMut.mutate()} disabled={portalMut.isPending}
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl py-2.5">
            {portalMut.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving…</>
              : "Save Portal Settings"}
          </Button>
        </div>
      </div>

      {/* ══ SECTION 3 — Fee Receipt Signature ═══════════════════════════════════ */}
      <div className="rounded-2xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)" }}>
            <PenLine className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-white font-bold">Fee Receipt Signature</p>
            <p className="text-white/40 text-xs mt-0.5">Upload the authorized signature that will appear on student fee receipts.</p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Hidden file input */}
          <input
            ref={sigFileRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={handleSigFilePick}
          />

          {/* Preview / empty state */}
          {(sigPreviewUrl || settings?.feeReceiptSignatureUrl) ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-[#0F1E35] flex items-center justify-center overflow-hidden p-4" style={{ minHeight: 100 }}>
                <img
                  src={sigPreviewUrl ?? settings?.feeReceiptSignatureUrl ?? ""}
                  alt="Fee receipt signature"
                  className="max-h-20 max-w-full object-contain"
                  style={{ imageRendering: "crisp-edges" }}
                />
              </div>
              {selectedSigFile && (
                <p className="text-xs text-purple-400 font-medium">
                  📎 {selectedSigFile.name} — click &ldquo;Save Signature&rdquo; to apply
                </p>
              )}
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => sigFileRef.current?.click()}
                  disabled={sigUploading || sigRemoving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/15 text-white/70 hover:text-white hover:bg-white/5 transition-all disabled:opacity-40">
                  <Upload className="w-3.5 h-3.5" /> Replace Signature
                </button>
                {(settings?.feeReceiptSignatureUrl || sigPreviewUrl) && (
                  <button type="button" onClick={() => setShowSigConfirmRemove(true)}
                    disabled={sigRemoving || sigUploading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-700/30 text-red-400 hover:bg-red-900/20 transition-all disabled:opacity-40">
                    <Trash2 className="w-3.5 h-3.5" /> Remove Signature
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => sigFileRef.current?.click()}
              disabled={sigUploading}
              className="w-full border-2 border-dashed border-white/15 rounded-xl py-8 flex flex-col items-center gap-3 hover:border-purple-500/40 hover:bg-purple-900/10 transition-all group disabled:opacity-40">
              <div className="w-10 h-10 rounded-xl bg-purple-900/30 border border-purple-500/25 flex items-center justify-center group-hover:bg-purple-900/50 transition-all">
                <Upload className="w-5 h-5 text-purple-400" />
              </div>
              <div className="text-center">
                <p className="text-white/70 text-sm font-semibold">Upload Authorized Signature</p>
                <p className="text-white/30 text-xs mt-1">Click to select a file</p>
              </div>
            </button>
          )}

          {/* Confirm removal inline dialog */}
          {showSigConfirmRemove && (
            <div className="p-3.5 rounded-xl border border-red-700/30 bg-red-900/10 space-y-2.5">
              <p className="text-red-400 text-xs font-semibold">Remove the fee receipt signature permanently?</p>
              <div className="flex gap-2">
                <button type="button" onClick={handleSigRemove} disabled={sigRemoving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-700/30 text-red-300 hover:bg-red-700/50 transition-all disabled:opacity-50">
                  {sigRemoving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Yes, Remove
                </button>
                <button type="button" onClick={() => setShowSigConfirmRemove(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/50 hover:text-white/80 transition-all">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Save staged file */}
          {selectedSigFile && (
            <button type="button" onClick={handleSigSave} disabled={sigUploading}
              className="w-full py-2.5 rounded-xl text-sm font-bold bg-purple-700 hover:bg-purple-600 text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {sigUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save Signature
            </button>
          )}

          {/* Requirements block */}
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 space-y-1.5">
            <p className="text-white/60 text-xs font-semibold tracking-wide uppercase">Signature Image Requirements</p>
            <p className="text-white/50 text-xs leading-relaxed">
              For a clean and professional appearance on student fee receipts, please upload your signature
              with a <span className="text-white/75 font-medium">transparent background</span>. If your signature has a
              white or coloured background, remove the background before uploading.
            </p>
            <p className="text-white/30 text-[11px] pt-0.5">
              Accepted: PNG, JPG, WEBP &bull; Max 2 MB
            </p>
            <p className="text-purple-400/60 text-[11px]">Recommended: PNG with transparent background</p>
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-purple-900/15 border border-purple-700/20">
            <span className="text-purple-400 text-xs leading-none mt-0.5">ℹ️</span>
            <p className="text-purple-300/70 text-xs leading-relaxed">
              This signature will appear on the student fee receipt as the Authorized Accounts Signatory.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}

function ExternalPortalVerificationDialog({
  open,
  onOpenChange,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (expiresAt: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const verifyMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/fees/external-settings/verify-access", { password });
      return response.json() as Promise<{ expiresAt: string }>;
    },
    onSuccess: ({ expiresAt }) => {
      setPassword("");
      setError(null);
      onVerified(expiresAt);
    },
    onError: (requestError: Error) => {
      setError(requestError.message === "Incorrect password. Please try again."
        ? requestError.message
        : "Verification could not be completed. Please try again.");
    },
  });

  const close = () => {
    if (verifyMutation.isPending) return;
    setPassword("");
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) close(); }}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-cyan-300">
            <Shield className="w-5 h-5" /> Admin Verification Required
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-white/65">
            For security, please enter your current account password to access External Payment Portal settings.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={event => { event.preventDefault(); setError(null); verifyMutation.mutate(); }} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="external-portal-current-password" className="text-xs font-semibold text-white/70">
              Current Password
            </label>
            <input
              id="external-portal-current-password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
              disabled={verifyMutation.isPending}
              className="w-full rounded-xl border border-white/10 bg-[#0F1E35] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500 disabled:opacity-50"
            />
          </div>
          {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close} disabled={verifyMutation.isPending} className="text-white/65 hover:text-white">
              Cancel
            </Button>
            <Button type="submit" disabled={verifyMutation.isPending || !password} className="bg-cyan-600 hover:bg-cyan-500 text-white">
              {verifyMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…</> : "Verify & Continue"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const AUDIT_ACTION_OPTIONS = [{ value: "", label: "All actions" }];

export interface AuditLogPage {
  entries: AuditLogEntry[];
  total: number;
  actionOptions?: Array<{ value: string; label: string }>;
}

export async function fetchAuditLogPage({
  page,
  fromDate,
  toDate,
  actionFilter,
  searchTerm,
  viewSessionId,
  signal,
}: {
  page: number;
  fromDate: string;
  toDate: string;
  actionFilter: string;
  searchTerm: string;
  viewSessionId?: number | null;
  signal?: AbortSignal;
}): Promise<AuditLogPage> {
  const params = new URLSearchParams({ limit: "20", offset: String(page * 20) });
  if (fromDate) params.set("from", fromDate);
  if (toDate) params.set("to", toDate);
  if (actionFilter) params.set("action", actionFilter);
  if (searchTerm) params.set("search", searchTerm);
  if (viewSessionId) params.set("sessionId", String(viewSessionId));

  // `viewSessionId` is captured by this query's key. Do not use the mutable
  // global session selection here: it can advance during a rapid switch, which
  // would otherwise pair this request's old `sessionId` query value with a new
  // session header and correctly trigger the server mismatch guard.
  const response = await sessionFetchForViewSession(
    `/api/admin/fees/audit-log?${params}`,
    viewSessionId,
    { signal },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || "The register could not be loaded.");
  }
  return response.json();
}

function AuditLogTab({ viewSessionId }: { viewSessionId?: number | null }) {
  const PAGE = 20;
  const [page, setPage] = useState(0);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]     = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [searchTerm, setSearchTerm]     = useState("");

  // Reset to page 0 when filters change
  const handleFromDate     = (v: string) => { setFromDate(v); setPage(0); };
  const handleToDate       = (v: string) => { setToDate(v);   setPage(0); };
  const handleActionFilter = (v: string) => { setActionFilter(v); setPage(0); };
  const handleSearchTerm   = (v: string) => { setSearchTerm(v);   setPage(0); };
  const clearFilters       = () => { setFromDate(""); setToDate(""); setActionFilter(""); setSearchTerm(""); setPage(0); };

  const normalizedSearch = searchTerm.trim();
  const invalidDateRange = Boolean(fromDate && toDate && fromDate > toDate);
  const hasFilter = Boolean(fromDate || toDate || actionFilter || normalizedSearch);

  useEffect(() => {
    setPage(0);
  }, [viewSessionId]);

  const { data, isLoading, isError, error, refetch } = useQuery<AuditLogPage>({
    queryKey: ["/api/admin/fees/audit-log", viewSessionId, page, fromDate, toDate, actionFilter, searchTerm],
    queryFn: ({ signal }) => fetchAuditLogPage({
      page,
      fromDate,
      toDate,
      actionFilter,
      searchTerm: normalizedSearch,
      viewSessionId,
      signal,
    }),
    staleTime: 15_000,
    enabled: !invalidDateRange,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE) : 0;
  const actionOptions = useMemo(
    () => [...AUDIT_ACTION_OPTIONS, ...(data?.actionOptions ?? []).filter(option => option.value)],
    [data?.actionOptions],
  );

  const actionTone = (action: string) => {
    if (action.includes("fail") || action.includes("block") || action === "delete") {
      return "border-rose-200 bg-rose-50 text-rose-700";
    }
    if (action.includes("payment") || action.includes("create")) {
      return "border-teal-200 bg-teal-50 text-teal-700";
    }
    if (action.includes("waiver") || action.includes("setting")) {
      return "border-amber-200 bg-amber-50 text-amber-700";
    }
    return "border-slate-200 bg-slate-50 text-slate-700";
  };

  return (
    <div className="space-y-4 text-slate-800">
      <div className="rounded-xl border border-[#d8e1e0] bg-[#f8fbfa] p-4 shadow-[0_2px_12px_rgba(25,64,60,0.04)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#dcefeb] text-[#16756d]"><Shield className="h-4 w-4" /></div>
              <h3 className="text-sm font-semibold tracking-tight text-[#173f3c]">Fees activity register</h3>
            </div>
            <p className="ml-9 mt-0.5 text-[11px] text-slate-500">A clear record of changes made to fee records and payments.</p>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-[#c9e1dc] bg-[#eef8f5] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#27766d] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#3b9b8c]" /> Register active
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex min-w-[210px] flex-1 items-center sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            aria-label="Search fees activity"
            placeholder="Search student, invoice, actor or description"
            value={searchTerm}
            onChange={e => handleSearchTerm(e.target.value)}
            className="h-8 w-full rounded-lg border border-[#d6e2df] bg-white pl-8 pr-3 text-xs text-slate-700 outline-none transition-shadow placeholder:text-slate-400 focus:border-[#62a99e] focus:ring-2 focus:ring-[#bde0d9]"
          />
        </div>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-[#d6e2df] bg-white px-2.5 text-[11px] text-slate-500">
          From
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            aria-invalid={invalidDateRange}
            onChange={e => handleFromDate(e.target.value)}
            className="bg-transparent text-xs text-slate-700 outline-none [color-scheme:light]"
          />
        </label>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-[#d6e2df] bg-white px-2.5 text-[11px] text-slate-500">
          To
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            aria-invalid={invalidDateRange}
            onChange={e => handleToDate(e.target.value)}
            className="bg-transparent text-xs text-slate-700 outline-none [color-scheme:light]"
          />
        </label>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-[#d6e2df] bg-white px-2.5 text-[11px] text-slate-500">
          Action
          <select
            value={actionFilter}
            onChange={e => handleActionFilter(e.target.value)}
            className="max-w-[150px] bg-transparent text-xs text-slate-700 outline-none"
          >
            {actionOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        {hasFilter && (
          <button
            onClick={clearFilters}
            className="h-8 rounded-lg px-2 text-xs font-medium text-[#27766d] underline-offset-2 transition-colors hover:bg-[#e5f3ef] hover:underline">
            Clear filters
          </button>
        )}
        <p className="ml-auto text-[11px] tabular-nums text-slate-500">
          {invalidDateRange ? "Fix date range" : data ? `${data.total} entr${data.total !== 1 ? "ies" : "y"}` : "Loading register…"}
        </p>
      </div>
      {invalidDateRange && (
        <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
          From date must be on or before To date.
        </p>
      )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500">{hasFilter ? "Filtered view" : "Most recent activity first"} <span className="text-slate-400">· IST</span></p>
        <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="h-7 px-2 text-slate-500 hover:bg-[#e7f2ef] hover:text-[#27766d]">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="min-w-[72px] text-center text-xs tabular-nums text-slate-500">{page + 1} / {totalPages || 1}</span>
        <Button size="sm" variant="ghost" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="h-7 px-2 text-slate-500 hover:bg-[#e7f2ef] hover:text-[#27766d]">
          <ChevronRight className="w-4 h-4" />
        </Button>
        </div>
      </div>

      {invalidDateRange ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-12 text-center">
          <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-rose-500" />
          <p className="text-sm font-medium text-rose-800">Choose a From date that is on or before the To date.</p>
          <p className="mt-1 text-xs text-rose-600">No audit records were requested for this invalid range.</p>
        </div>
      ) : isLoading ? (
        <div className="overflow-hidden rounded-xl border border-[#d8e1e0] bg-white">
          {[1, 2, 3, 4, 5].map(row => <div key={row} className="h-14 animate-pulse border-b border-[#edf2f1] bg-gradient-to-r from-[#f5f9f8] via-white to-[#f5f9f8]" />)}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-12 text-center">
          <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-rose-500" />
          <p className="text-sm font-medium text-rose-800">The register could not be loaded.</p>
          <p className="mt-1 text-xs text-rose-600">{error instanceof Error ? error.message : "Please try again."}</p>
          <button onClick={() => refetch()} className="mt-3 text-xs font-semibold text-rose-700 underline underline-offset-2">Try again</button>
        </div>
      ) : !data?.entries.length ? (
        <div className="rounded-xl border border-dashed border-[#cbded9] bg-[#f8fbfa] px-4 py-16 text-center">
          <Shield className="mx-auto mb-3 h-10 w-10 text-[#8bbdb5]" />
          <p className="text-sm font-medium text-[#315e59]">{hasFilter ? "No activity found for the selected filters." : "No activity has been recorded yet."}</p>
          <p className="mt-1 text-xs text-slate-500">{hasFilter ? "Try widening the date range or clearing a filter." : "Fee record changes will appear here as they happen."}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#d8e1e0] bg-white shadow-[0_3px_16px_rgba(25,64,60,0.05)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-[#d8e1e0] bg-[#eef6f4]">
                  {["Date & Time", "Who", "Role", "ID", "Action", "Student / Record", "Description"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.09em] text-[#52716d]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.entries.map(e => {
                  const actorCaption =
                    e.actorType === "system" ? "Automatic entry"
                    : e.actorType === "payment_gateway" ? "Provider event"
                    : e.actorType === "student" ? "Student portal"
                    : ["principal", "teacher", "non_teaching_staff"].includes(e.actorType ?? "") ? "Authenticated user"
                    : "Historical entry";
                  const entityReference = e.recordLabel
                    ?? (e.entityId != null
                      ? `${(e.entityType ?? "record").replaceAll("_", " ")} #${e.entityId}`
                      : null);
                  const studentRecord = [e.studentName, e.studentIdentifier, entityReference]
                    .filter((value): value is string => Boolean(value))
                    .join(" · ");
                  return (
                    <tr key={e.id} className="border-b border-[#edf2f1] transition-colors hover:bg-[#f4faf8]">
                      <td className="whitespace-nowrap px-3 py-3 align-top text-[11px] tabular-nums text-slate-500">{fmtDateTime(e.createdAt)}</td>
                      <td className="max-w-[150px] px-3 py-3 align-top">
                        <div className="truncate text-xs font-semibold text-[#274b47]">{e.actorName ?? "School system"}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">{actorCaption}</div>
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-slate-600">{e.actorRole ?? "—"}</td>
                      <td className="px-3 py-3 align-top font-mono text-[11px] text-slate-500">{e.actorIdentifier ?? "—"}</td>
                      <td className="px-3 py-3 align-top"><span className={`inline-flex rounded-md border px-2 py-1 text-[10px] font-bold capitalize ${actionTone(e.action)}`}>{e.actionLabel ?? e.action.replaceAll("_", " ")}</span></td>
                      <td className="max-w-[190px] px-3 py-3 align-top">
                        <div className="text-xs font-medium leading-relaxed text-[#315e59]" title={studentRecord || "School-wide"}>
                          {studentRecord || "School-wide"}
                        </div>
                      </td>
                      <td className="max-w-[280px] px-3 py-3 align-top text-xs leading-relaxed text-slate-600">{e.description ?? "No additional details recorded."}</td>
                    </tr>
                  );
                })}
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

type AnalyticsPreset = "today" | "this_week" | "this_month" | "academic_year" | "custom";
type AnalyticsComparison = { billedChange?: number | null; grossCollectedChange?: number | null; netCollectedChange?: number | null } | null;
type AnalyticsData = {
  generatedAt?: string;
  sessionInfo?: { id?: number; sessionName?: string; startDate?: string; endDate?: string };
  filter?: { preset?: AnalyticsPreset; startDate?: string; endDate?: string; label?: string; timezone?: string; comparison?: unknown };
  accountingBasis?: {
    billed?: { label?: string; description?: string };
    grossCollected?: { label?: string; description?: string };
    netCollected?: { label?: string; description?: string };
    outstanding?: { label?: string; description?: string };
    collectionEfficiency?: { label?: string; description?: string };
  };
  comparison?: AnalyticsComparison;
  summary?: Record<string, number | null>;
  trend?: Array<{ key: string; label: string; startDate: string; billed: number; grossCollected: number; netCollected: number }>;
  online?: AnalyticsChannel;
  offline?: AnalyticsChannel;
  paymentChannelSplit?: {
    totalCollected: number;
    totalTransactions: number;
    channels: Array<{ method: string; count: number; amount: number; percentage: number }>;
  };
  classWise?: Array<Record<string, string | number>>;
  feeCategories?: Array<Record<string, string | number>>;
  aging?: Array<{ bucket: string; count: number; amount: number }>;
  cashDenominations?: { cashCollected: number; cashPaymentCount: number; withBreakdownCount: number; withoutBreakdownCount: number; documentedAmount: number; denominations: Array<{ denomination: number; quantity: number; total: number }> };
};
type AnalyticsChannel = { grossCollected: number; netCollected: number; transactionCount: number; averageTransaction: number; statuses: Array<{ status: string; count: number; amount: number }>; methods: Array<{ method: string; count: number; amount: number }> };

function AnalyticsCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-xl border border-white/10 bg-[#17263d] p-4 shadow-[0_10px_28px_rgba(0,0,0,.12)] ${className}`}>{children}</section>;
}

function AnalyticsTab({ viewSessionId }: { viewSessionId: number | null }) {
  const { selectedSession } = useSessionView();
  const { toast } = useToast();
  const [preset, setPresetState] = useState<AnalyticsPreset>("academic_year");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedBucket, setSelectedBucket] = useState<(typeof AGING_BUCKETS)[number] | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const handlePresetChange = (next: AnalyticsPreset) => {
    if (next === "custom") {
      setStartDate("");
      setEndDate("");
    }
    setPresetState(next);
  };
  const setPreset = handlePresetChange;
  const sessionStart = selectedSession?.startDate?.slice(0, 10) ?? "";
  const sessionEnd = selectedSession?.endDate?.slice(0, 10) ?? "";
  useEffect(() => {
    if (preset === "academic_year") { setStartDate(sessionStart); setEndDate(sessionEnd); }
  }, [preset, sessionStart, sessionEnd]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ preset });
    if (preset === "custom") { if (startDate) p.set("startDate", startDate); if (endDate) p.set("endDate", endDate); }
    return p.toString();
  }, [preset, startDate, endDate]);
  const { data, isLoading, isFetching, error, refetch } = useQuery<AnalyticsData>({
    queryKey: ["/api/fees/analytics", viewSessionId, preset, startDate, endDate],
    queryFn: async () => { const r = await sessionFetch(`/api/fees/analytics?${params}`); const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message ?? body?.error ?? "Analytics request failed"); return body; },
    enabled: preset !== "custom" || (!!startDate && !!endDate && startDate <= endDate),
    staleTime: 0, refetchOnMount: "always",
  });
  const fmtMoney = (v: unknown) => formatIndianRupees(Number(v ?? 0));
  const s = data?.summary ?? {};
  const paymentChannelSplit = data?.paymentChannelSplit;
  const agingData = useMemo(() => AGING_BUCKETS.map(b => ({ ...b, ...(data?.aging?.find(a => a.bucket === b.key) ?? { count: 0, amount: 0 }) })), [data]);
  const downloadPdf = async (section: string) => {
    setExporting(section);
    try {
      const r = await sessionFetch(`/api/fees/analytics/pdf?${params}&section=${section}`);
      if (!r.ok) { const body = await r.json().catch(() => ({})); throw new Error(body.message ?? body.error ?? "PDF unavailable"); }
      const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `financial-analytics-${preset}-${section}-${todayInIST()}.pdf`; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast({ title: "Download failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }); } finally { setExporting(null); }
  };
  const DownloadButton = ({ section = "summary" }: { section?: string }) => <button type="button" onClick={() => downloadPdf(section)} disabled={!!exporting} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-cyan-300/70 hover:bg-cyan-300/10 hover:text-cyan-200 disabled:opacity-40" aria-label={`Download ${section} PDF`}><Download className="h-3 w-3" />{exporting === section ? "Preparing" : "PDF"}</button>;
  const Card = AnalyticsCard;
  const comparison = data?.comparison ?? null;
  const changeFor = (key: string) => {
    const field = key === "billed" ? "billedChange" : key === "grossCollected" ? "grossCollectedChange" : key === "netCollected" ? "netCollectedChange" : null;
    return field ? comparison?.[field] ?? null : null;
  };
  const moneyMetric = (label: string, key: string, tone: string) => { const change = changeFor(key); return <div className={`rounded-lg border p-3 ${tone}`}><div className="text-[10px] uppercase tracking-[.14em] text-white/45">{label}</div><div className="mt-1 text-lg font-bold tabular-nums text-white">{fmtMoney(s[key])}</div>{change != null && <div className={`mt-1 text-[10px] tabular-nums ${change >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{change >= 0 ? "+" : ""}{change}% prior period</div>}</div>; };
  const statusLabel = (status: string) => status.toLowerCase().split(/[_-]+/).map(word => word ? word[0].toUpperCase() + word.slice(1) : "").join(" ");
  const invalidCustom = preset === "custom" && (!startDate || !endDate || startDate > endDate);
  if (invalidCustom) return <div className="rounded-xl border border-cyan-300/15 bg-[#132238] p-4 text-white"><div className="flex flex-wrap items-center gap-2"><select value={preset} onChange={e => setPreset(e.target.value as AnalyticsPreset)} className="rounded-md border border-white/15 bg-[#0d1a2d] px-3 py-2 text-xs"><option value="today">Today</option><option value="this_week">This Week</option><option value="this_month">This Month</option><option value="academic_year">Academic Year</option><option value="custom">Custom</option></select><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} aria-label="Start date" className="rounded-md border border-white/15 bg-[#0d1a2d] px-2 py-2 text-xs" /><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} aria-label="End date" className="rounded-md border border-white/15 bg-[#0d1a2d] px-2 py-2 text-xs" /></div><p className="mt-2 text-[11px] text-amber-200/80">Choose both dates; start date must be on or before end date.</p></div>;
  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-white/5" />)}</div>;
  if (error || !data) return <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-6 text-center text-sm text-red-200"><p>Financial analytics could not be loaded.</p>{error instanceof Error && <p className="mt-1 text-xs text-red-200/70">{error.message}</p>}<button onClick={() => refetch()} className="mt-3 rounded-md bg-red-300/15 px-3 py-2 text-xs font-semibold hover:bg-red-300/25">Retry</button></div>;
  const filterLabel = data.filter?.label ?? `${data.filter?.startDate ?? ""} – ${data.filter?.endDate ?? ""}`;
  return <div className="min-w-0 space-y-4 text-white">
    <div className="flex flex-col gap-3 rounded-xl border border-cyan-300/15 bg-[#132238] p-4 lg:flex-row lg:items-end lg:justify-between">
      <div><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" /><span className="text-[11px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">Financial cockpit</span><span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/60">{data.sessionInfo?.sessionName ?? selectedSession?.sessionName ?? "Active session"}</span></div><h2 className="mt-2 text-xl font-bold tracking-tight">Collections & receivables</h2><p className="mt-1 text-xs text-white/45">{filterLabel} · {data.filter?.timezone ?? "IST"} · Updated {data.generatedAt ? formatDateTimeIST(data.generatedAt) : "—"}</p></div>
      <div><div className="flex flex-wrap items-center gap-2"><select value={preset} onChange={e => setPreset(e.target.value as AnalyticsPreset)} className="rounded-md border border-white/15 bg-[#0d1a2d] px-3 py-2 text-xs text-white"><option value="today">Today</option><option value="this_week">This Week</option><option value="this_month">This Month</option><option value="academic_year">Academic Year</option><option value="custom">Custom</option></select>{preset === "custom" && <><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} max={endDate || undefined} className="rounded-md border border-white/15 bg-[#0d1a2d] px-2 py-2 text-xs" aria-label="Start date" /><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate || undefined} className="rounded-md border border-white/15 bg-[#0d1a2d] px-2 py-2 text-xs" aria-label="End date" /></>}<button onClick={() => refetch()} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/10" aria-label="Refresh analytics"><Loader2 className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />Refresh</button><DownloadButton section="complete" /></div>{invalidCustom && <p className="mt-2 text-[11px] text-amber-200/80">Choose both dates; start date must be on or before end date.</p>}</div>
    </div>
    <div><div className="mb-2 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Executive summary</h3><p className="text-[11px] text-white/40">Demand, collections, and receivables at a glance</p></div><DownloadButton section="summary" /></div><p className="mb-2 text-[10px] leading-relaxed text-cyan-100/55">{data.accountingBasis?.billed?.description ?? "Due This Period is based on invoice due dates."} {data.accountingBasis?.grossCollected?.description ?? "Gross Collected is based on successful payment received dates."}</p><div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">{moneyMetric(data.accountingBasis?.billed?.label ?? "Due this period", "billed", "border-white/10 bg-white/[.03]")}{moneyMetric(data.accountingBasis?.grossCollected?.label ?? "Gross collected", "grossCollected", "border-cyan-300/20 bg-cyan-300/[.04]")}{moneyMetric(data.accountingBasis?.netCollected?.label ?? "Net collected", "netCollected", "border-emerald-300/20 bg-emerald-300/[.04]")}{moneyMetric(data.accountingBasis?.outstanding?.label ?? "Outstanding", "outstanding", "border-rose-300/20 bg-rose-300/[.04]")}{<div className="rounded-lg border border-indigo-300/20 bg-indigo-300/[.04] p-3"><div className="text-[10px] uppercase tracking-[.14em] text-white/45">{data.accountingBasis?.collectionEfficiency?.label ?? "Collection efficiency"}</div><div className="mt-1 text-lg font-bold tabular-nums text-white">{s.collectionEfficiency == null ? "N/A" : `${s.collectionEfficiency}%`}</div>{s.collectionEfficiency == null && <div className="mt-1 text-[10px] text-white/45">No invoices due</div>}</div>}{moneyMetric("Online collection", "onlineCollected", "border-cyan-300/20 bg-cyan-300/[.04]")}{moneyMetric("Offline collection", "offlineCollected", "border-amber-300/20 bg-amber-300/[.04]")}{moneyMetric("Overdue amount", "overdueAmount", "border-rose-300/20 bg-rose-300/[.04]")}</div></div>
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]"><Card><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Collection trend</h3><p className="text-[11px] text-white/40">Due-period demand and receipts, reported by the server</p></div><DownloadButton section="trend" /></div>{data.trend?.length ? <ResponsiveContainer width="100%" height={240}><BarChart data={data.trend}><CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} /><XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,.5)", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tickFormatter={v => `₹${Math.round(v/1000)}k`} tick={{ fill: "rgba(255,255,255,.4)", fontSize: 10 }} axisLine={false} tickLine={false} width={42} /><Tooltip {...CustomTooltipStyle} formatter={(v: number, n: string) => [fmtMoney(v), n === "billed" ? "Due this period" : "Net collected"]} /><Bar dataKey="billed" fill="rgba(255,255,255,.14)" radius={[3,3,0,0]} /><Bar dataKey="netCollected" fill="#2dd4bf" radius={[3,3,0,0]} /></BarChart></ResponsiveContainer> : <div className="flex h-60 items-center justify-center text-sm text-white/35">No trend data for this range.</div>}</Card>
      <Card><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Payment channels</h3><p className="text-[11px] text-white/40">Revenue and transaction flow</p></div><DownloadButton section="channels" /></div>{(["online","offline"] as const).map((key, i) => { const c = data[key]; return <div key={key} className={`rounded-lg border p-3 ${i ? "mt-3 border-amber-300/15 bg-amber-300/[.03]" : "border-cyan-300/15 bg-cyan-300/[.03]"}`}><div className="flex justify-between"><span className="text-xs font-semibold">{i ? "Offline" : "Online / Portal"}</span><span className="text-sm font-bold text-emerald-300">{fmtMoney(c?.netCollected)}</span></div><div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-white/45 sm:grid-cols-3"><span>Gross<br/><b className="text-white/75">{fmtMoney(c?.grossCollected)}</b></span><span>Transactions<br/><b className="text-white/75">{c?.transactionCount ?? 0}</b></span><span>Average transaction<br/><b className="text-white/75">{fmtMoney(c?.averageTransaction)}</b></span></div><div className="mt-3 flex flex-wrap gap-1.5">{(c?.methods ?? []).map(m => <span key={m.method} className="rounded bg-white/10 px-2 py-1 text-[10px] text-white/70">{m.method} · {m.count}</span>)}</div>{key === "online" && <div className="mt-3 border-t border-white/10 pt-2"><p className="text-[10px] uppercase tracking-wider text-white/35">Portal lifecycle · not revenue</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{(c?.statuses ?? []).map(st => <span key={st.status} className="text-[10px] text-white/55">{statusLabel(st.status)}: <b className="text-white/80">{st.count}</b></span>)}</div></div>}</div>})}</Card></div>
    <Card><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Payment Channel Split</h3><p className="text-[11px] text-white/40">Successful recorded payments by method · IST reporting dates</p></div><div className="text-right"><p className="text-[10px] uppercase tracking-[.14em] text-white/40">Reconciled collected total</p><p className="mt-1 text-sm font-bold tabular-nums text-emerald-300">{fmtMoney(paymentChannelSplit?.totalCollected)}</p><p className="text-[10px] text-white/45">{paymentChannelSplit?.totalCollected === Number(s.grossCollected ?? 0) ? "Matches Gross Collected" : "Loading reconciliation…"}</p></div></div>{paymentChannelSplit?.channels?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-xs"><thead className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/40"><tr><th className="px-2 py-2 text-left">Payment Channel</th><th className="px-2 py-2 text-right">Transactions</th><th className="px-2 py-2 text-right">Collected</th><th className="px-2 py-2 text-right">Share</th></tr></thead><tbody className="divide-y divide-white/5">{paymentChannelSplit.channels.map(channel => <tr key={channel.method} className="hover:bg-white/[.03]"><td className="px-2 py-2.5 font-medium text-white/85">{channel.method}</td><td className="px-2 py-2.5 text-right tabular-nums text-white/60">{channel.count}</td><td className="px-2 py-2.5 text-right tabular-nums font-semibold text-emerald-300">{fmtMoney(channel.amount)}</td><td className="px-2 py-2.5 text-right tabular-nums text-cyan-200">{Number(channel.percentage ?? 0).toFixed(2)}%</td></tr>)}</tbody><tfoot className="border-t border-cyan-300/20 bg-cyan-300/[.04] text-xs font-bold"><tr><td className="px-2 py-2.5">All recorded channels</td><td className="px-2 py-2.5 text-right tabular-nums">{paymentChannelSplit.totalTransactions}</td><td className="px-2 py-2.5 text-right tabular-nums text-emerald-300">{fmtMoney(paymentChannelSplit.totalCollected)}</td><td className="px-2 py-2.5 text-right tabular-nums text-cyan-200">100.00%</td></tr></tfoot></table></div> : <div className="rounded-lg border border-dashed border-white/15 bg-white/[.02] p-5 text-center text-xs text-white/45">No successful recorded payments were received in this range.</div>}</Card>
    <div className="grid gap-4 lg:grid-cols-2"><Card><div className="mb-3 flex justify-between"><h3 className="text-sm font-semibold">Class performance</h3><DownloadButton section="classes" /></div><div className="overflow-x-auto"><table className="w-full min-w-[460px] text-xs"><thead className="text-[10px] uppercase tracking-wider text-white/35"><tr><th className="pb-2 text-left">Class</th><th className="pb-2 text-right">Due this period</th><th className="pb-2 text-right">Collected</th><th className="pb-2 text-right">Outstanding</th></tr></thead><tbody className="divide-y divide-white/5">{(data.classWise ?? []).map((r, i) => <tr key={String(r.class ?? i)} className="hover:bg-white/[.03]"><td className="py-2">{String(r.class ?? "—")}</td><td className="py-2 text-right tabular-nums text-white/60">{fmtMoney(r.billed)}</td><td className="py-2 text-right tabular-nums text-emerald-300">{fmtMoney(r.grossCollected ?? r.netCollected)}</td><td className="py-2 text-right tabular-nums text-rose-300">{fmtMoney(r.outstanding)}</td></tr>)}</tbody></table>{!data.classWise?.length && <p className="py-10 text-center text-xs text-white/35">No class data in this range.</p>}</div></Card>
      <Card><div className="mb-3 flex justify-between"><h3 className="text-sm font-semibold">Fee categories</h3><DownloadButton section="categories" /></div><div className="space-y-3">{(data.feeCategories ?? []).map((r, i) => <div key={String(r.feeType ?? r.fee_type ?? i)}><div className="flex justify-between text-xs"><span>{String(r.feeType ?? r.fee_type ?? "Unlabelled")}</span><span className="tabular-nums text-emerald-300">{fmtMoney(r.netCollected ?? r.grossCollected)}</span></div><div className="mt-1 grid grid-cols-2 gap-2 text-[10px] text-white/40"><span>Due this period {fmtMoney(r.billed)}</span><span>Outstanding {fmtMoney(r.outstanding)}</span></div></div>)}</div>{!data.feeCategories?.length && <p className="py-10 text-center text-xs text-white/35">No category data in this range.</p>}</Card></div>
    <Card><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Receivables aging</h3><p className="text-[11px] text-white/40">Select a bucket to inspect responsible students</p></div><DownloadButton section="aging" /></div><div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{agingData.map(b => <button key={b.key} onClick={() => b.count > 0 && setSelectedBucket(b)} disabled={!b.count} className="rounded-lg border p-3 text-left transition-colors hover:bg-white/[.05] disabled:cursor-default disabled:opacity-50" style={{ borderColor: `${b.color}45` }}><div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: b.color }}>{b.label}</div><div className="mt-2 text-lg font-bold tabular-nums">{fmtMoney(b.amount)}</div><div className="mt-1 text-[10px] text-white/40">{b.count} invoices · {b.risk} risk</div></button>)}</div>{agingData.every(b => !b.count) && <p className="py-5 text-center text-xs text-white/35">No overdue receivables in this range.</p>}</Card>
    <Card><div className="mb-3 flex justify-between"><div><h3 className="text-sm font-semibold">Cash denomination coverage</h3><p className="text-[11px] text-white/40">Documented cash breakdown versus cash collected</p></div><DownloadButton section="cash" /></div>{data.cashDenominations?.cashPaymentCount ? <div className="grid gap-4 md:grid-cols-[1fr_1.5fr]"><div className="grid grid-cols-2 gap-2 text-xs">{[["Cash collected",fmtMoney(data.cashDenominations.cashCollected)],["Cash payments",data.cashDenominations.cashPaymentCount],["With breakdown",data.cashDenominations.withBreakdownCount],["Without breakdown",data.cashDenominations.withoutBreakdownCount]].map(([l,v]) => <div key={String(l)} className="rounded bg-white/[.04] p-2"><span className="block text-[10px] text-white/40">{l}</span><b>{v}</b></div>)}</div><div className="overflow-x-auto"><table className="w-full min-w-[360px] text-xs"><thead className="text-[10px] text-white/40"><tr><th className="text-left">Denomination</th><th className="text-right">Quantity</th><th className="text-right">Documented total</th></tr></thead><tbody>{(data.cashDenominations.denominations ?? []).map(d => <tr key={d.denomination} className="border-t border-white/5"><td className="py-2">₹{d.denomination}</td><td className="py-2 text-right">{d.quantity}</td><td className="py-2 text-right">{fmtMoney(d.total)}</td></tr>)}</tbody></table></div></div> : <div className="rounded-lg border border-dashed border-amber-300/20 bg-amber-300/[.03] p-5 text-center text-xs text-amber-100/70">No cash denomination data is available for this range. Cash may be recorded without a breakdown.</div>}</Card>
    <AgingDefaultersDrawer bucket={selectedBucket} startDate={data.filter?.startDate} endDate={data.filter?.endDate} onClose={() => setSelectedBucket(null)} />
  </div>;
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
  const queryClient = useQueryClient();
  const [externalVerificationOpen, setExternalVerificationOpen] = useState(false);
  const [externalAccessExpiry, setExternalAccessExpiry] = useState<number | null>(null);

  const clearExternalPortalAccess = useCallback(() => {
    setExternalAccessExpiry(null);
    setExternalVerificationOpen(false);
    queryClient.removeQueries({ queryKey: ["/api/admin/fees/external-settings"] });
    setActiveTab(currentTab => currentTab === "external" ? "ledger" : currentTab);
  }, [queryClient]);

  useEffect(() => {
    if (externalAccessExpiry === null) return;
    const delay = Math.max(0, externalAccessExpiry - Date.now());
    const timer = window.setTimeout(clearExternalPortalAccess, delay);
    return () => window.clearTimeout(timer);
  }, [clearExternalPortalAccess, externalAccessExpiry]);

  const openTab = useCallback((tab: Tab) => {
    if (tab !== "external") {
      setActiveTab(tab);
      return;
    }
    if (
      externalAccessExpiry !== null &&
      externalAccessExpiry > Date.now()
    ) {
      setActiveTab("external");
      return;
    }
    clearExternalPortalAccess();
    setExternalVerificationOpen(true);
  }, [clearExternalPortalAccess, externalAccessExpiry]);

  const handleExternalPortalVerified = useCallback((expiresAt: string) => {
    const parsedExpiry = Date.parse(expiresAt);
    if (!Number.isFinite(parsedExpiry) || parsedExpiry <= Date.now()) {
      clearExternalPortalAccess();
      return;
    }
    setExternalAccessExpiry(parsedExpiry);
    setExternalVerificationOpen(false);
    setActiveTab("external");
  }, [clearExternalPortalAccess]);

  // ── Real-time sync: listen for Razorpay webhook payment-update events ──────
  // When a student pays via Razorpay the webhook fires on the server, which
  // broadcasts a "payment-update" SSE event.  We intercept it here so the
  // ledger, summary and analytics refresh instantly without a manual reload.
  useEffect(() => {
    const es = new EventSource("/api/events/session-change");
    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "payment-update") {
          // Refresh every data slice that changes when a payment comes in —
          // ledger rows, summary totals, payment count badges, failed-attempt
          // badges, analytics, and the audit log (new payment entry).
          queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/failed-counts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
          queryClient.invalidateQueries({ queryKey: ["/api/fees/analytics"] });
        }
      } catch { /* ignore parse errors */ }
    };
    return () => es.close();
  }, [queryClient]);

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
    <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden">
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
      <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-xl border border-white/10 bg-[#1A2942] p-1">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button key={id} onClick={() => openTab(id)}
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
      {activeTab === "external"   && <ExternalPortalTab onReauthRequired={clearExternalPortalAccess} />}
      {activeTab === "audit"      && <AuditLogTab viewSessionId={viewSessionId} />}
      <ExternalPortalVerificationDialog
        open={externalVerificationOpen}
        onOpenChange={setExternalVerificationOpen}
        onVerified={handleExternalPortalVerified}
      />
    </div>
  );
}

const NOTIF_CHANNEL_COLORS: Record<string, string> = {
  sms:      "bg-blue-900/40 text-blue-300 border-blue-700/40",
  whatsapp: "bg-green-900/40 text-green-300 border-green-700/40",
  email:    "bg-purple-900/40 text-purple-300 border-purple-700/40",
};

const NOTIF_STAGE_COLORS: Record<string, string> = {
  "D-2": "text-violet-400", "D+0": "text-cyan-400", "D+3": "text-green-400", "D+7": "text-amber-400", "D+14": "text-orange-400",
};

const NOTIF_STAGE_LABELS: Record<string, string> = {
  "D-2": "2 days before due", "D+0": "Due today", "D+3": "3 days overdue", "D+7": "7 days overdue", "D+14": "14 days overdue",
};

interface NotificationHistoryModalProps {
  open: boolean;
  onClose: () => void;
  studentId: number | null;
  studentName: string | null;
}

function NotificationHistoryModal({ open, onClose, studentId, studentName }: NotificationHistoryModalProps) {
  const { selectedSession } = useSessionView();
  const { data: entries = [], isLoading } = useQuery<DunningLogEntry[]>({
    queryKey: ["/api/admin/fees/dunning-log", selectedSession?.id ?? "unselected", studentId],
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
  startDate,
  endDate,
  onClose,
}: {
  bucket: (typeof AGING_BUCKETS)[number] | null;
  startDate?: string;
  endDate?: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { selectedSession } = useSessionView();
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [filterClass, setFilterClass] = useState<string>("__all__");
  const [filterFeeType, setFilterFeeType] = useState<string>("__all__");

  // Reset filters whenever a different bucket is opened
  useEffect(() => {
    setFilterClass("__all__");
    setFilterFeeType("__all__");
  }, [bucket?.key]);

  const { data: students = [], isLoading } = useQuery<AgingStudent[]>({
    queryKey: ["/api/fees/analytics/aging-students", selectedSession?.id ?? "unselected", bucket?.key, startDate, endDate],
    queryFn: async () => {
      if (!bucket) return [];
      const params = new URLSearchParams({ bucket: bucket.key });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const r = await sessionFetch(`/api/fees/analytics/aging-students?${params.toString()}`);
      if (!r.ok) throw new Error("Failed to load defaulters");
      return r.json();
    },
    enabled: !!bucket && !!startDate && !!endDate,
    staleTime: 30_000,
  });

  // Derive unique option lists from the full fetched data (not the filtered slice)
  const classOptions = useMemo(() => {
    const seen = new Set<string>();
    students.forEach(s => { if (s.class) seen.add(s.class); });
    return Array.from(seen).sort((a, b) => {
      const na = Number(a), nb = Number(b);
      return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b);
    });
  }, [students]);

  const feeTypeOptions = useMemo(() => {
    const seen = new Set<string>();
    students.forEach(s => { if (s.fee_type) seen.add(s.fee_type); });
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [students]);

  // Apply client-side filters
  const visibleStudents = useMemo(() => {
    return students.filter(s => {
      if (filterClass !== "__all__" && s.class !== filterClass) return false;
      if (filterFeeType !== "__all__" && s.fee_type !== filterFeeType) return false;
      return true;
    });
  }, [students, filterClass, filterFeeType]);

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

            {/* Filter bar */}
            {!isLoading && students.length > 0 && (
              <div className="px-5 py-3 border-b border-white/10 flex gap-2 flex-wrap">
                <Select value={filterClass} onValueChange={setFilterClass}>
                  <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-white/80 w-36">
                    <SelectValue placeholder="All Classes" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0D1F3C] border-white/10 text-white">
                    <SelectItem value="__all__" className="text-xs text-white/60">All Classes</SelectItem>
                    {classOptions.map(c => (
                      <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterFeeType} onValueChange={setFilterFeeType}>
                  <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-white/80 flex-1 min-w-36">
                    <SelectValue placeholder="All Fee Types" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0D1F3C] border-white/10 text-white">
                    <SelectItem value="__all__" className="text-xs text-white/60">All Fee Types</SelectItem>
                    {feeTypeOptions.map(ft => (
                      <SelectItem key={ft} value={ft} className="text-xs">{ft}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(filterClass !== "__all__" || filterFeeType !== "__all__") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setFilterClass("__all__"); setFilterFeeType("__all__"); }}
                    className="h-8 px-2 text-xs text-white/40 hover:text-white/70"
                  >
                    <X className="w-3 h-3 mr-1" />Clear
                  </Button>
                )}
              </div>
            )}

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
              ) : visibleStudents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-white/25">
                  <Search className="w-10 h-10" />
                  <p className="text-sm">No matches for the selected filters</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-white/40 text-xs mb-3">
                    {visibleStudents.length}{visibleStudents.length !== students.length ? ` of ${students.length}` : ""} student{visibleStudents.length !== 1 ? "s" : ""} found
                  </p>
                  {visibleStudents.map(s => (
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
