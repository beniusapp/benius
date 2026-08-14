import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, CreditCard, Loader2, CheckCircle2, Clock, AlertTriangle,
  Receipt, Download, Lock, ExternalLink, Copy, Check, Zap, Bell,
  Mail, MessageSquare, Webhook, TrendingUp, Shield, ChevronRight, ChevronDown,
  Sparkles, CircleDollarSign, CalendarDays, BadgeCheck, WifiOff,
  XCircle, RotateCcw, X,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";

// ── Types ──────────────────────────────────────────────────────────────────────

interface StudentMeResponse {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  schoolName: string;
  schoolCode: string;
  schoolId?: number;
}

interface BreakdownItem {
  name: string;
  purpose: string;
  amount: number;
}

interface FeeRecord {
  id: number;
  studentId: number;
  schoolId: number;
  feeType: string;
  feeName: string;          // current structure display name — always fresh from server
  amount: number;
  dueDate: string;
  paidDate: string | null;
  status: string;
  receiptNumber: string | null;
  notes: string | null;
  academicYear: string | null;
  createdAt: string;
  breakdown: BreakdownItem[];
  failed_count?: number;
  last_failed_error?: string | null;
}

interface FeesSummary {
  previousArrears: number;
  currentMonthCharges: number;
  totalOutstanding: number;
  totalPaid: number;
  currentMonth: string; // "YYYY-MM"
}

interface NotificationHistoryEntry {
  id: number;
  feeRecordId: number | null;
  channel: string;
  stage: string;
  sentAt: string | null;
  status: string;
  recipient: string | null;
}

interface PortalInfo {
  isEnabled: boolean;
  gatewayUrl: string | null;
  bannerMessage: string | null;
  razorpayEnabled: boolean;
  razorpayKeyId: string | null;
}

interface PaymentAttempt {
  id: number;
  // Backward-compat fields
  type: "paid" | "failed";
  isCancelled: boolean;
  /** Authoritative outcome from payment_attempts table */
  outcome: "captured" | "failed" | "cancelled" | "authorized" | "refunded" | "pending";

  feeRecordId: number | null;
  feeType: string | null;
  feeName: string | null;

  // Amount: display rupees + raw paise for the financial breakdown
  amount: number | null;              // rupees (for display)
  amountPaise: number | null;         // paise
  amountCapturedPaise: number | null;
  amountRefundedPaise: number | null;
  razorpayFeePaise: number | null;    // Razorpay processing fee in paise
  razorpayTaxPaise: number | null;    // GST on processing fee in paise
  currency: string | null;

  date: string | null;
  receiptNumber: string | null;

  // Payment method
  paymentMethod: string | null;
  paymentMode: string | null;         // alias kept for backward compat
  cardLast4: string | null;
  cardNetwork: string | null;         // Visa, Mastercard, RuPay…
  cardType: string | null;            // 'credit' | 'debit'
  cardIssuer: string | null;          // HDFC, DCBL…
  cardName: string | null;
  cardInternational: boolean | null;
  bankName: string | null;
  bankRrn: string | null;             // Retrieval Reference Number
  bankAuthCode: string | null;        // Authorization code from issuing bank
  vpa: string | null;                 // UPI VPA
  wallet: string | null;

  // Identifiers
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;

  // Customer (server masks email/phone before sending; never exposes full card/CVV)
  payerName: string | null;
  payerEmail: string | null;
  payerContact: string | null;

  // Failure
  errorCode: string | null;
  errorDescription: string | null;
  errorSource: string | null;
  errorStep: string | null;
  errorReason: string | null;

  // Razorpay lifecycle timestamps (epoch from API, returned as ISO strings)
  rzpCreatedAt: string | null;
  rzpAuthorizedAt: string | null;
  rzpCapturedAt: string | null;
  rzpFailedAt: string | null;

  // Refund
  refundId: string | null;
  refundStatus: string | null;
  refundAmountPaise: number | null;
  refundInitiatedAt: string | null;
  refundProcessedAt: string | null;

  apiSyncedAt: string | null;
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatAmount(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

/** Formats a UTC ISO timestamp as IST date + time with seconds.
 *  e.g. "14 Aug 2026, 04:49:24 PM"
 *
 *  DB columns are `timestamp without time zone` — values are UTC but the
 *  serialised string has no timezone marker (e.g. "2026-08-14 11:19:24.018887").
 *  Without normalisation, V8 parses such strings as *browser-local* time, so an
 *  IST browser would treat 11:19 UTC as 11:19 IST — 5 h 30 m too early.
 *  Fix: replace the space separator with T and append Z before parsing, forcing
 *  UTC interpretation exactly once.  If the server ever starts returning a
 *  timezone-aware string (ends in Z or ±HH:MM) this guard is a no-op. */
function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  // Normalise to UTC: "2026-08-14 11:19:24.018887" → "2026-08-14T11:19:24.018887Z"
  const s = dateStr.trim().replace(" ", "T");
  const utc = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z";
  const result = new Date(utc).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true,
  });
  // en-IN gives lowercase am/pm — normalise to uppercase for readability.
  return result.replace(/\bam\b/gi, "AM").replace(/\bpm\b/gi, "PM");
}

/** Derives the precise payment outcome from the attempt record.
 *  Returns a { label, accent } pair used by StatusPill and the date line. */
function classifyAttempt(attempt: PaymentAttempt): "Paid" | "Payment Cancelled" | "Payment Expired" | "Payment Failed" {
  if (attempt.type === "paid") return "Paid";
  // Use the structured isCancelled flag first (most reliable — set by the server
  // based on the payment_cancelled action which is written when the student
  // voluntarily closes the checkout modal without attempting a payment).
  if (attempt.isCancelled) return "Payment Cancelled";
  // Detect order-expiry from structured errorReason, then fall back to description text
  const reason = (attempt.errorReason ?? "").toLowerCase();
  const desc   = (attempt.errorDescription ?? "").toLowerCase();
  if (
    reason === "order_expired" || reason === "expired_order" ||
    desc.includes("order_expired") || desc.includes("order has expired") ||
    desc.includes("session expired") || desc.includes("razorpay order expired")
  ) return "Payment Expired";
  return "Payment Failed";
}

/** Maps a payment attempt outcome to student-friendly copy.
 *  Returns the section heading, plain-language reason, and advice line. */
function getFriendlyFailureContent(outcome: string): {
  sectionLabel: string;
  reason: string;
  advice: string;
} {
  if (outcome === "Payment Cancelled") {
    return {
      sectionLabel: "Reason",
      reason: "Payment checkout was closed before the payment was completed.",
      advice: "You can try the payment again.",
    };
  }
  if (outcome === "Payment Expired") {
    return {
      sectionLabel: "Why did it expire?",
      reason: "The payment session timed out. The checkout window was left open for too long without completing a payment.",
      advice: "Please try the payment again. The fee has not been marked as paid.",
    };
  }
  // Payment Failed — for gateway errors Razorpay may have attempted a debit,
  // so warn the student about the refund timeline.
  return {
    sectionLabel: "Why did it fail?",
    reason: "Payment could not be completed because the payment gateway returned an error.",
    advice: "Please try the payment again. The fee has not been marked as paid.",
  };
}

/** Returns a tailored advice string when the error source is "gateway" —
 *  indicating the bank may have attempted a debit even though the payment
 *  ultimately failed.  Call after classifyAttempt returns "Payment Failed". */
function getGatewayAdvice(attempt: PaymentAttempt): string | null {
  if ((attempt.errorSource ?? "").toLowerCase() === "gateway") {
    return "If your bank account was debited, the amount will be automatically refunded within 5–7 working days by your bank or Razorpay.";
  }
  return null;
}

/** Returns a human-readable payment mode label, e.g. "UPI · priya@okaxis",
 *  "Card ···4242", "Netbanking · HDFC", or null when mode is unavailable. */
function formatPaymentMode(attempt: PaymentAttempt): string | null {
  const mode = (attempt.paymentMode ?? "").toLowerCase().trim();
  if (!mode) return null;
  if (mode === "upi")        return attempt.vpa       ? `UPI · ${attempt.vpa}`         : "UPI";
  if (mode === "card")       return attempt.cardLast4 ? `Card ···${attempt.cardLast4}` : "Card";
  if (mode === "netbanking") return attempt.bankName  ? `Netbanking · ${attempt.bankName}` : "Netbanking";
  // wallet, emi, paylater, etc.
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

/** Masks an email for display: shows first char, hides middle of local part and domain. */
function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local  = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot    = domain.lastIndexOf(".");
  const tld    = dot >= 0 ? domain.slice(dot) : "";
  const base   = dot >= 0 ? domain.slice(0, dot) : domain;
  const maskedLocal  = local.charAt(0) + "●".repeat(Math.max(1, local.length - 1));
  const maskedDomain = base.charAt(0) + "●".repeat(Math.max(1, base.length - 1));
  return `${maskedLocal}@${maskedDomain}${tld}`;
}

/** Masks a phone/contact for display: shows first 2 and last 2 digits. */
function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return digits.slice(0, 2) + "●".repeat(digits.length - 4) + digits.slice(-2);
}

/** A labeled section header + content group for the Technical Details accordion. */
function SectionGroup({ title, accent, children }: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-widest mb-1.5"
        style={{ color: accent + "99" }}>
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/** A single key → value row inside a SectionGroup. Suppressed when value is falsy. */
function TechRow({ label, value, mono = false }: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="flex gap-2">
      <span className="text-[9.5px] font-semibold flex-shrink-0 mt-px"
        style={{ color: "#94a3b8", minWidth: 96 }}>
        {label}
      </span>
      <span className={`text-[10px] leading-snug break-all ${mono ? "font-mono" : ""}`}
        style={{ color: "#475569" }}>
        {String(value)}
      </span>
    </div>
  );
}

class RazorpayScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RazorpayScriptError";
  }
}

class RazorpayOrderExpiredError extends Error {
  constructor() {
    super("order_expired");
    this.name = "RazorpayOrderExpiredError";
  }
}

class PaymentInProgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentInProgressError";
  }
}

/** Returns true when the Razorpay payment.failed response indicates the order
 *  window has closed (15-minute expiry).  Razorpay does not publish a single
 *  canonical error code for this case, so we match on the most reliable
 *  signals: the `reason` field and key phrases in the `description`. */
function isOrderExpiredError(error: any): boolean {
  if (!error) return false;
  const reason = (error.reason ?? "").toLowerCase();
  const desc   = (error.description ?? "").toLowerCase();
  return (
    reason === "order_expired" ||
    reason === "expired_order" ||
    desc.includes("order has expired") ||
    desc.includes("order expired") ||
    desc.includes("payment session expired") ||
    desc.includes("session has expired") ||
    desc.includes("session expired")
  );
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Razorpay) { resolve(); return; }

    const TIMEOUT_MS = 10_000;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new RazorpayScriptError("Razorpay script load timed out after 10 s"));
    }, TIMEOUT_MS);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () =>
      settle(() => {
        if ((window as any).Razorpay) {
          resolve();
        } else {
          reject(new RazorpayScriptError("Razorpay script loaded but SDK is unavailable"));
        }
      });
    script.onerror = () =>
      settle(() => reject(new RazorpayScriptError("Failed to load Razorpay checkout script")));
    document.head.appendChild(script);
  });
}

// ── Stagger animation config ───────────────────────────────────────────────────
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
};
const item = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 22 } },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  if (status === "Paid") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide"
      style={{ background: "linear-gradient(135deg,#d1fae5,#a7f3d0)", color: "#065f46", border: "1px solid #6ee7b7" }}>
      <BadgeCheck className="w-3 h-3" /> Paid
    </span>
  );
  if (status === "Overdue") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide"
      style={{ background: "linear-gradient(135deg,#fee2e2,#fecaca)", color: "#991b1b", border: "1px solid #fca5a5" }}>
      <AlertTriangle className="w-3 h-3" /> Overdue
    </span>
  );
  if (status === "Payment Failed") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide"
      style={{ background: "linear-gradient(135deg,#fff1f2,#ffe4e6)", color: "#9f1239", border: "1px solid #fda4af" }}>
      <XCircle className="w-3 h-3" /> Payment Failed
    </span>
  );
  if (status === "Payment Cancelled") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide"
      style={{ background: "linear-gradient(135deg,#fdf4ff,#f5d0fe)", color: "#7e22ce", border: "1px solid #e879f9" }}>
      <XCircle className="w-3 h-3" /> Payment Cancelled
    </span>
  );
  if (status === "Payment Expired") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide"
      style={{ background: "linear-gradient(135deg,#fff7ed,#fed7aa)", color: "#92400e", border: "1px solid #fdba74" }}>
      <Clock className="w-3 h-3" /> Payment Expired
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide"
      style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)", color: "#92400e", border: "1px solid #fcd34d" }}>
      <Clock className="w-3 h-3" /> Due
    </span>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "email") return <Mail className="w-4 h-4" />;
  if (channel === "sms") return <MessageSquare className="w-4 h-4" />;
  if (channel === "whatsapp") return <Webhook className="w-4 h-4" />;
  return <Bell className="w-4 h-4" />;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function StudentFees() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { isArchiveMode, selectedSession, subscribeToPaymentUpdate } = useSessionView();
  const [copiedReceiptId, setCopiedReceiptId] = useState<number | null>(null);
  const [payingFeeId, setPayingFeeId] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payWarning, setPayWarning] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"outstanding" | "history" | "reminders">("outstanding");
  // Tracks which history-card "Technical details" drawers are open (keyed by attempt.id)
  const [expandedTechnical, setExpandedTechnical] = useState<Set<number>>(new Set());

  // ── Payment lifecycle refs ──────────────────────────────────────────────────
  //
  // Scenario A — tab closed / SPA navigation BEFORE create-order response:
  //   The AbortController cancels the in-flight fetch.  No Razorpay order is
  //   created (or the server-side call may still complete, but the response is
  //   discarded).  On return, payingFeeId starts as null — no stale spinner.
  //
  // Scenario B — tab closed / SPA navigation AFTER order created but checkout open:
  //   The Razorpay checkout modal's modal.timeout (600 s) fires ondismiss,
  //   which rejects the promise and clears payingFeeId.  This is the in-session
  //   path (SPA navigation unmounts the component; timeout fires on the
  //   background page).  For a hard tab close, the component is discarded;
  //   payingFeeId is ephemeral React state and always starts as null on the
  //   next visit — no stale spinner.  The Razorpay order stays in "created"
  //   state on Razorpay's dashboard (cosmetic only; it does not block the
  //   student from paying again — a new order is created on the next attempt).
  //   This residual order risk is accepted: Razorpay's Orders API does not
  //   provide a programmatic cancel for orders in "created" state.
  //
  // isMountedRef prevents state updates on an already-unmounted component.
  const paymentAbortRef = useRef<AbortController | null>(null);
  const isMountedRef    = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any in-flight create-order fetch (Scenario A above).
      paymentAbortRef.current?.abort();
    };
  }, []);

  const copyReceiptNumber = useCallback((recId: number, receiptNumber: string) => {
    navigator.clipboard.writeText(receiptNumber).then(() => {
      setCopiedReceiptId(recId);
      setTimeout(() => setCopiedReceiptId(null), 1500);
    });
  }, []);

  const { data: student, isLoading: studentLoading, isError } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: feeRecords = [], isLoading: feesLoading, refetch: refetchFees } = useQuery<FeeRecord[]>({
    queryKey: ["/api/student/fees"],
    enabled: !!student,
    staleTime: 0,               // always treat as stale — payment status must never be served from cache
    refetchOnWindowFocus: true, // re-check status the moment the student returns to this tab
  });

  const { data: feesSummary, refetch: refetchSummary } = useQuery<FeesSummary>({
    queryKey: ["/api/student/fees/summary"],
    enabled: !!student,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: portalInfo } = useQuery<PortalInfo>({
    queryKey: ["/api/student/fees/portal-info"],
    enabled: !!student,
    staleTime: 0,              // always fetch fresh — admin can toggle at any time
    refetchOnWindowFocus: true,
  });

  const { data: notificationHistory = [], isLoading: notifLoading } = useQuery<NotificationHistoryEntry[]>({
    queryKey: ["/api/student/fees/notification-history"],
    enabled: !!student,
    staleTime: 30_000,
  });

  const { data: paymentAttempts = [], isLoading: attemptsLoading } = useQuery<PaymentAttempt[]>({
    queryKey: ["/api/student/fees/payment-attempts"],
    enabled: !!student,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!studentLoading && (isError || !student || !student.schoolId)) {
      setLocation("/student-login");
    }
  }, [studentLoading, isError, student, setLocation]);

  // ── Real-time payment updates via the shared SSE connection ─────────────────
  // The StudentSessionProvider already holds the single EventSource for this
  // tab.  Subscribing here (instead of opening a second EventSource) keeps the
  // server fan-out count at one per tab regardless of how many pages are mounted.
  useEffect(() => {
    return subscribeToPaymentUpdate(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/fees/payment-attempts"] });
    });
  }, [subscribeToPaymentUpdate, queryClient]);

  // Real Razorpay payment
  const handlePayNow = useCallback(async (rec: FeeRecord, studentData: StudentMeResponse) => {
    if (!portalInfo?.razorpayEnabled || !portalInfo.razorpayKeyId) return;
    setPayingFeeId(rec.id);
    setPayError(null);

    // Create a fresh AbortController for this payment attempt and store it so
    // the unmount cleanup can abort the in-flight request if the student closes
    // the tab or navigates away before the order response arrives.
    const abort = new AbortController();
    paymentAbortRef.current = abort;

    try {
      await loadRazorpayScript();
      const resp = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeRecordId: rec.id }),
        credentials: "include",
        signal: abort.signal,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (err.code === "PAYMENT_IN_PROGRESS")
          throw new PaymentInProgressError(err.message ?? "A payment is already in progress for this fee.");
        throw new Error(err.message ?? "Failed to create order");
      }
      const { orderId, amount, currency, keyId } = await resp.json();
      await new Promise<void>((resolve, reject) => {
        const refreshFeesData = () => {
          refetchFees();
          refetchSummary();
          queryClient.invalidateQueries({ queryKey: ["/api/student/fees"] });
          queryClient.invalidateQueries({ queryKey: ["/api/student/fees/summary"] });
        };

        // ── Checkout-timeout tracking ────────────────────────────────────────
        // Razorpay fires `ondismiss` for both voluntary closes (user clicks ✕)
        // and automatic closes when the configured `timeout` elapses — there is
        // no separate callback for the two cases.  We use a parallel timer that
        // fires 500 ms before Razorpay's own timeout to set a flag; when
        // ondismiss then fires, the flag tells us which path triggered it.
        const CHECKOUT_TIMEOUT_S  = 600;
        let   timedOut            = false;
        let   timeoutHandle: ReturnType<typeof setTimeout> | null =
          setTimeout(() => { timedOut = true; }, (CHECKOUT_TIMEOUT_S - 1) * 1_000);

        const clearCheckoutTimer = () => {
          if (timeoutHandle !== null) { clearTimeout(timeoutHandle); timeoutHandle = null; }
        };

        const options = {
          key: keyId, amount, currency,
          name: studentData.schoolName,
          description: rec.feeType,
          order_id: orderId,
          prefill: { name: studentData.name, contact: "", email: "" },
          theme: { color: "#6366f1" },
          handler: (response: any) => {
            // Payment succeeded — cancel the expiry tracker.
            clearCheckoutTimer();
            // Immediately verify via our endpoint — no 15 s polling wait.
            // Falls back to a plain refetch if verify fails (webhook may have
            // already run, making the fee Paid anyway).
            fetch("/api/payments/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_signature:  response.razorpay_signature,
                feeRecordId: rec.id,
                payer_name:    studentData.name,
                payer_contact: "",
                payer_email:   "",
              }),
            })
              .then(r => r.json())
              .catch(() => ({ ok: false }))
              .finally(() => refreshFeesData());
            resolve();
          },
          // Auto-close the checkout after 10 minutes.  Razorpay fires ondismiss
          // when the timeout elapses OR when the user closes the modal manually.
          // The `timedOut` flag above distinguishes the two cases so we can show
          // a helpful message on timeout while staying silent on voluntary close.
          timeout: CHECKOUT_TIMEOUT_S,
          modal: {
            ondismiss: () => {
              clearCheckoutTimer();
              if (timedOut) {
                // The checkout window closed because the timeout elapsed — the
                // student likely stepped away.  Show a friendly "try again" prompt.
                reject(new RazorpayOrderExpiredError());
              } else {
                // Voluntary close by the student — release the order lock
                // immediately so the student can retry this invoice or pay a
                // different one without waiting for the 10-minute checkout
                // window to elapse.  The endpoint is a no-op if the fee is
                // already Paid (status guard on the server prevents the UPDATE).
                fetch("/api/payments/clear-failed-order", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({
                    feeRecordId:     rec.id,
                    razorpayOrderId: orderId,
                    errorDescription: "Checkout dismissed by student (no payment attempted)",
                    isCancelled:     true,
                  }),
                }).catch(() => { /* best-effort — stale order expires automatically */ });
                reject(new Error("dismissed"));
              }
            },
          },
        };

        const rzp = new (window as any).Razorpay(options);

        // Capture payment failures reported by the Razorpay SDK (card declined,
        // gateway-side order expiry, etc.)
        rzp.on("payment.failed", (response: any) => {
          clearCheckoutTimer();
          // Clear the order lock AND write the audit log entry immediately.
          // Razorpay webhooks can't reach a Replit dev server, so this is the
          // only reliable path for recording the failure.
          const errCode        = response?.error?.code        ?? "";
          const errDescription = response?.error?.description ?? response?.error?.reason ?? "Payment failed";
          const errSource      = response?.error?.source      ?? "";
          const errStep        = response?.error?.step        ?? "";
          const errReason      = response?.error?.reason      ?? "";
          const rzpPaymentId   = response?.error?.metadata?.payment_id ?? "";
          fetch("/api/payments/clear-failed-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              feeRecordId:       rec.id,
              razorpayOrderId:   orderId,
              razorpayPaymentId: rzpPaymentId  || undefined,
              errorCode:         errCode        || undefined,
              errorDescription:  errDescription || undefined,
              errorSource:       errSource      || undefined,
              errorStep:         errStep        || undefined,
              errorReason:       errReason      || undefined,
              isCancelled:       false,
              rawResponse:       response       ?? undefined,
            }),
          })
            .then(() => {
              // Refresh fees so the card immediately shows "Payment Failed" + "Try Again"
              queryClient.invalidateQueries({ queryKey: ["/api/student/fees"] });
              queryClient.invalidateQueries({ queryKey: ["/api/student/fees/payment-attempts"] });
            })
            .catch(() => { /* best-effort — webhook clears it too */ });

          if (isOrderExpiredError(response?.error)) {
            // Gateway rejected the payment because the order window had already
            // elapsed (e.g. student left the tab open overnight then returned).
            reject(new RazorpayOrderExpiredError());
          } else {
            const desc = response?.error?.description ?? response?.error?.reason ?? "Payment failed";
            reject(new Error(desc));
          }
        });

        rzp.open();
      });
    } catch (err: any) {
      if (err?.message === "dismissed") {
        // User closed the Razorpay modal (or modal.timeout elapsed) — no error shown
      } else if (err?.name === "AbortError") {
        // Scenario A: the component unmounted while the create-order fetch was
        // still in-flight.  The request was aborted; we must not touch React
        // state on a dead component.
        paymentAbortRef.current = null;
        return;
      } else if (err instanceof PaymentInProgressError) {
        // Server returned 409 PAYMENT_IN_PROGRESS — show as amber warning, not red error.
        if (isMountedRef.current) setPayWarning(err.message);
      } else if (err instanceof RazorpayOrderExpiredError) {
        // The 10-minute checkout window elapsed (or the gateway rejected the
        // order as expired) before the student completed payment.
        if (isMountedRef.current) setPayError("Your payment session expired — please try again");
      } else if (err instanceof RazorpayScriptError) {
        if (isMountedRef.current) setPayError("Payment service unavailable — please try again later");
      } else {
        if (isMountedRef.current) setPayError(err?.message ?? "Payment failed");
      }
    } finally {
      paymentAbortRef.current = null;
      // Guard: component may have unmounted while the modal was open (Scenario B).
      // payingFeeId is ephemeral React state — it always starts null on mount,
      // so there is no stale spinner risk on the student's next visit.
      if (isMountedRef.current) setPayingFeeId(null);
    }
  }, [portalInfo, refetchFees, queryClient]);


  // ── Loading splash ───────────────────────────────────────────────────────────
  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: "linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)" }}>
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#06b6d4)" }}>
            <CreditCard className="w-8 h-8 text-white" />
          </div>
          <motion.div className="absolute inset-0 rounded-2xl"
            style={{ background: "linear-gradient(135deg,#6366f1,#06b6d4)", opacity: 0.4 }}
            animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ repeat: Infinity, duration: 1.8 }} />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
      </div>
    );
  }

  // ── Derived values ───────────────────────────────────────────────────────────
  const totalDue    = feeRecords.filter(r => r.status !== "Paid").reduce((s, r) => s + r.amount + ((r as any).accrued_late_fee ?? 0), 0);
  const totalPaid   = feeRecords.filter(r => r.status === "Paid").reduce((s, r) => s + r.amount, 0);
  const overdueCount = feeRecords.filter(r => r.status === "Overdue").length;
  const paidRecords = feeRecords.filter(r => r.status === "Paid");
  const pendingRecords = feeRecords.filter(r => r.status !== "Paid");
  const razorpayActive = !isArchiveMode && (portalInfo?.razorpayEnabled ?? false) && !!portalInfo?.razorpayKeyId;

  const tabs = [
    { key: "outstanding" as const, label: "Outstanding", count: pendingRecords.length },
    { key: "history"     as const, label: "History",     count: paymentAttempts.length },
    { key: "reminders"   as const, label: "Reminders",   count: notificationHistory.length },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#f1f5f9" }}>

      {/* ── Ambient background ─────────────────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "340px",
          background: "linear-gradient(160deg,#0f172a 0%,#1e1b4b 55%,#0c4a6e 100%)" }} />
        <div style={{ position: "absolute", top: "60px", right: "-100px", width: "380px", height: "380px",
          borderRadius: "50%", background: "radial-gradient(circle,rgba(99,102,241,0.25) 0%,transparent 65%)" }} />
        <div style={{ position: "absolute", top: "100px", left: "-60px", width: "300px", height: "300px",
          borderRadius: "50%", background: "radial-gradient(circle,rgba(6,182,212,0.18) 0%,transparent 65%)" }} />
      </div>

      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50"
        style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          background: "rgba(15,23,42,0.72)", borderBottom: "1px solid rgba(99,102,241,0.18)",
          boxShadow: "0 1px 30px rgba(0,0,0,0.35)" }}>
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-9 h-9 rounded-xl transition-all active:scale-90"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
            data-testid="button-back">
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <div className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#6366f1,#06b6d4)" }}>
            <CreditCard className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight flex-1 min-w-0">
            <p className="font-bold text-sm text-white tracking-tight truncate">Fees & Payments</p>
            <p className="text-[10px] text-indigo-300 font-medium truncate">{student.schoolName}</p>
          </div>
          {isArchiveMode && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
              style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>
              <Lock className="w-3 h-3" /> Archive
            </span>
          )}
        </div>
      </header>

      <div className="relative z-10 max-w-2xl mx-auto px-4 pt-14">

        {/* ── Hero balance card ───────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22,1,0.36,1] }}
          className="relative mt-6 rounded-3xl overflow-hidden p-6"
          style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.18) 0%,rgba(6,182,212,0.12) 100%)",
            border: "1px solid rgba(99,102,241,0.28)", boxShadow: "0 20px 60px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)" }}>

          {/* Decorative glow orbs */}
          <div className="absolute top-[-40px] right-[-40px] w-48 h-48 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle,rgba(99,102,241,0.3) 0%,transparent 65%)" }} />
          <div className="absolute bottom-[-30px] left-[-20px] w-36 h-36 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle,rgba(6,182,212,0.2) 0%,transparent 65%)" }} />

          <div className="relative">
            <p className="text-xs font-semibold text-indigo-300 uppercase tracking-widest mb-1 flex items-center gap-1.5">
              <CircleDollarSign className="w-3.5 h-3.5" />
              Outstanding Balance
            </p>
            <div className="flex items-end gap-3 mb-4">
              <p className="text-4xl sm:text-5xl font-black text-white tracking-tight"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatAmount(totalDue)}
              </p>
              {overdueCount > 0 && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ delay: 0.3, type: "spring", stiffness: 300 }}
                  className="mb-1 px-2.5 py-1 rounded-xl text-[11px] font-bold"
                  style={{ background: "rgba(239,68,68,0.2)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.35)" }}>
                  {overdueCount} overdue
                </motion.span>
              )}
            </div>

            {/* Arrears breakdown — shows when there are both prior and current charges */}
            {feesSummary && (feesSummary.previousArrears > 0 || feesSummary.currentMonthCharges > 0) && (
              <div className="mb-4 rounded-2xl overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.18)" }}>
                <div className="grid grid-cols-2 divide-x"
                  style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                  <div className="p-3 text-center">
                    <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5"
                      style={{ color: feesSummary.previousArrears > 0 ? "#fca5a5" : "rgba(255,255,255,0.4)" }}>
                      Previous Arrears
                    </p>
                    <p className="font-extrabold text-sm"
                      style={{ color: feesSummary.previousArrears > 0 ? "#f87171" : "rgba(255,255,255,0.3)",
                        fontVariantNumeric: "tabular-nums" }}>
                      {formatAmount(feesSummary.previousArrears)}
                    </p>
                  </div>
                  <div className="p-3 text-center">
                    <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5"
                      style={{ color: feesSummary.currentMonthCharges > 0 ? "#93c5fd" : "rgba(255,255,255,0.4)" }}>
                      Current Month
                    </p>
                    <p className="font-extrabold text-sm"
                      style={{ color: feesSummary.currentMonthCharges > 0 ? "#60a5fa" : "rgba(255,255,255,0.3)",
                        fontVariantNumeric: "tabular-nums" }}>
                      {formatAmount(feesSummary.currentMonthCharges)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Paid",    value: formatAmount(feesSummary?.totalPaid ?? totalPaid), color: "#34d399", icon: <TrendingUp className="w-3.5 h-3.5" /> },
                { label: "Records", value: feeRecords.length,       color: "#818cf8", icon: <Receipt className="w-3.5 h-3.5" /> },
                { label: "Pending", value: pendingRecords.length,   color: "#fb923c", icon: <Clock className="w-3.5 h-3.5" /> },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl p-3 text-center"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}>
                  <div className="flex items-center justify-center gap-1 mb-1" style={{ color: s.color }}>
                    {s.icon}
                    <p className="text-[10px] font-bold uppercase tracking-wide">{s.label}</p>
                  </div>
                  <p className="font-extrabold text-white text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Archive banner ──────────────────────────────────────────────── */}
        <AnimatePresence>
          {isArchiveMode && selectedSession && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="mt-4 flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: "rgba(251,191,36,0.1)", border: "1.5px solid rgba(251,191,36,0.3)" }}
              data-testid="banner-archive-fees">
              <Lock className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-amber-300">Archive Mode — Read Only</p>
                <p className="text-xs text-amber-500 mt-0.5">
                  Viewing <span className="font-semibold">{selectedSession.sessionName}</span>. Payments disabled.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Payment-in-progress warning (amber) ─────────────────────────── */}
        <AnimatePresence>
          {payWarning && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="mt-4 flex items-start gap-3 rounded-2xl px-4 py-3.5 overflow-hidden relative"
              style={{
                background: "linear-gradient(135deg, rgba(120,60,0,0.55) 0%, rgba(92,45,0,0.45) 100%)",
                border: "1.5px solid rgba(251,191,36,0.35)",
                boxShadow: "0 0 0 1px rgba(251,191,36,0.08), 0 4px 16px rgba(0,0,0,0.25)",
              }}>
              {/* left accent bar */}
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl bg-gradient-to-b from-amber-400 to-amber-600" />
              <div className="ml-1 mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)" }}>
                <Clock className="w-3.5 h-3.5 text-amber-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-0.5">Payment In Progress</p>
                <p className="text-sm text-amber-100 leading-snug">{payWarning}</p>
              </div>
              <button onClick={() => setPayWarning(null)}
                className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center transition-colors hover:bg-amber-400/20"
                style={{ color: "rgba(251,191,36,0.7)" }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Pay error banner (red) ───────────────────────────────────────── */}
        <AnimatePresence>
          {payError && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="mt-4 flex items-start gap-3 rounded-2xl px-4 py-3.5 overflow-hidden relative"
              style={{
                background: "linear-gradient(135deg, rgba(100,10,10,0.55) 0%, rgba(80,0,0,0.45) 100%)",
                border: "1.5px solid rgba(239,68,68,0.35)",
                boxShadow: "0 0 0 1px rgba(239,68,68,0.08), 0 4px 16px rgba(0,0,0,0.25)",
              }}>
              {/* left accent bar */}
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl bg-gradient-to-b from-red-400 to-red-600" />
              <div className="ml-1 mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <WifiOff className="w-3.5 h-3.5 text-red-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-red-300 uppercase tracking-wider mb-0.5">Payment Error</p>
                <p className="text-sm text-red-100 leading-snug">{payError}</p>
              </div>
              <button onClick={() => setPayError(null)}
                className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center transition-colors hover:bg-red-400/20"
                style={{ color: "rgba(239,68,68,0.7)" }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── External portal banner — shows independently of Razorpay ───── */}
        {portalInfo?.isEnabled && portalInfo.gatewayUrl && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-2xl p-4 flex items-center gap-3"
            style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.25)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#06b6d4,#0891b2)" }}>
              <ExternalLink className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              {portalInfo.bannerMessage && <p className="text-sm text-slate-300 mb-2">{portalInfo.bannerMessage}</p>}
              <a href={portalInfo.gatewayUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg,#06b6d4,#0891b2)" }}>
                Pay Online <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </motion.div>
        )}

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="mt-5 flex gap-2">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-bold transition-all active:scale-95"
              style={activeTab === t.key
                ? { background: "linear-gradient(135deg,#6366f1,#818cf8)", color: "#fff",
                    boxShadow: "0 4px 20px rgba(99,102,241,0.4)", border: "1px solid rgba(129,140,248,0.5)" }
                : { background: "rgba(255,255,255,0.9)", color: "#64748b",
                    border: "1px solid rgba(255,255,255,0.8)", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              {t.label}
              {t.count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black"
                  style={activeTab === t.key
                    ? { background: "rgba(255,255,255,0.25)", color: "#fff" }
                    : { background: "#e0e7ff", color: "#4f46e5" }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </motion.div>

        {/* ── Tab content ────────────────────────────────────────────────── */}
        <div className="mt-4 pb-12">
          <AnimatePresence mode="wait">

            {/* ══ OUTSTANDING TAB ══════════════════════════════════════════ */}
            {activeTab === "outstanding" && (
              <motion.div key="outstanding"
                initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.22 }}>
                {feesLoading ? (
                  <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                  </div>
                ) : pendingRecords.length === 0 ? (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-4 py-20 rounded-3xl"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.8)",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg,#d1fae5,#a7f3d0)" }}>
                      <Shield className="w-8 h-8 text-emerald-600" />
                    </div>
                    <div className="text-center">
                      <p className="font-extrabold text-slate-700 text-lg">All Clear!</p>
                      <p className="text-sm text-slate-400 mt-1">No outstanding fees. You're all good.</p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
                    {pendingRecords.map((rec) => (
                      <motion.div key={rec.id} variants={item}
                        className="rounded-3xl overflow-hidden"
                        style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(255,255,255,0.8)",
                          boxShadow: "0 4px 20px rgba(0,0,0,0.07)" }}
                        data-testid={`card-fee-${rec.id}`}>
                        {/* Accent top bar — red-rose when last attempt failed */}
                        <div className="h-1 w-full"
                          style={{ background: (rec.failed_count ?? 0) > 0
                            ? "linear-gradient(90deg,#f43f5e,#fb7185)"
                            : rec.status === "Overdue"
                            ? "linear-gradient(90deg,#ef4444,#f87171)"
                            : "linear-gradient(90deg,#f59e0b,#fbbf24)" }} />
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                {/* Always show the invoice's actual status */}
                                <StatusPill status={rec.status} />
                                {/* When ≥1 payment attempt failed, show the attempt
                                    result as a SECOND independent pill so the
                                    invoice status is never lost or overwritten. */}
                                {(rec.failed_count ?? 0) > 0 && (() => {
                                  const err = (rec.last_failed_error ?? "").toLowerCase();
                                  const attemptStatus =
                                    err.includes("dismissed by student") || err.includes("no payment attempted")
                                      ? "Payment Cancelled"
                                      : err.includes("expired") || err.includes("order_expired")
                                      ? "Payment Expired"
                                      : "Payment Failed";
                                  return <StatusPill status={attemptStatus} />;
                                })()}
                                {rec.academicYear && (
                                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold"
                                    style={{ background: "#f1f5f9", color: "#64748b" }}>
                                    {rec.academicYear}
                                  </span>
                                )}
                              </div>
                              <p className="font-extrabold text-slate-800 text-base leading-tight"
                                data-testid={`text-fee-type-${rec.id}`}>{rec.feeName || rec.feeType}</p>
                              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-400">
                                <CalendarDays className="w-3 h-3 flex-shrink-0" />
                                Due {formatDate(rec.dueDate)}
                              </div>
                              {rec.notes && (
                                <p className="text-xs text-slate-400 mt-1 italic">{rec.notes}</p>
                              )}
                              {/* Fee breakdown */}
                              {rec.breakdown?.length > 0 && (
                                <div className="mt-2.5 w-full rounded-xl overflow-hidden border border-slate-100">
                                  <div className="px-2.5 py-1 bg-slate-50 border-b border-slate-100">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">What's included</p>
                                  </div>
                                  {rec.breakdown.map((b, i) => (
                                    <div key={i} className="flex items-start justify-between gap-2 px-2.5 py-1.5 border-b border-slate-50 last:border-0">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs font-semibold text-slate-700 leading-tight">{b.name}</p>
                                        {b.purpose && <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{b.purpose}</p>}
                                      </div>
                                      <p className="text-xs font-bold text-slate-600 flex-shrink-0 tabular-nums">{formatAmount(b.amount)}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-3 flex-shrink-0">
                              <div className="text-right">
                                <p className="text-2xl font-black text-slate-800"
                                  style={{ fontVariantNumeric: "tabular-nums" }}
                                  data-testid={`text-fee-amount-${rec.id}`}>
                                  {(rec as any).accrued_late_fee > 0
                                    ? formatAmount(rec.amount + (rec as any).accrued_late_fee)
                                    : formatAmount(rec.amount)}
                                </p>
                                {(rec as any).accrued_late_fee > 0 && (
                                  <div className="mt-0.5 space-y-px text-right">
                                    <p className="text-xs text-slate-400 tabular-nums">Base {formatAmount(rec.amount)}</p>
                                    <p className="text-xs font-bold text-amber-500 tabular-nums">+{formatAmount((rec as any).accrued_late_fee)} fine</p>
                                  </div>
                                )}
                              </div>
                              {/* Razorpay Pay Now / Try Again — shown only when toggle is ON and live keys are saved */}
                              {razorpayActive && (() => {
                                const hasFailed = (rec.failed_count ?? 0) > 0;
                                const isProcessing = payingFeeId === rec.id;
                                return (
                                  <button
                                    onClick={() => handlePayNow(rec, student)}
                                    disabled={isProcessing}
                                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black text-white transition-all active:scale-95 disabled:opacity-60"
                                    style={{
                                      background: isProcessing
                                        ? "linear-gradient(135deg,#94a3b8,#cbd5e1)"
                                        : hasFailed
                                        ? "linear-gradient(135deg,#e11d48,#f43f5e)"
                                        : "linear-gradient(135deg,#6366f1,#818cf8)",
                                      boxShadow: isProcessing ? "none" : hasFailed
                                        ? "0 4px 18px rgba(225,29,72,0.45)"
                                        : "0 4px 18px rgba(99,102,241,0.45)",
                                    }}
                                    data-testid={`button-pay-now-${rec.id}`}>
                                    {isProcessing
                                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                                      : hasFailed
                                      ? <><RotateCcw className="w-3.5 h-3.5" /> Try Again</>
                                      : <><Zap className="w-3.5 h-3.5" /> Pay Now</>}
                                  </button>
                                );
                              })()}
                              {/* Toggle OFF → hide payment button entirely */}
                              {!isArchiveMode && !portalInfo?.razorpayEnabled && (
                                <span className="text-[10px] text-slate-400 font-medium">Pay at school</span>
                              )}
                            </div>
                          </div>

                          {/* Failed payment warning — shown when ≥1 attempt failed and fee still unpaid */}
                          {(rec.failed_count ?? 0) > 0 && (
                            <div className="mt-3 flex items-start gap-2.5 rounded-2xl px-3.5 py-3"
                              style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.22)" }}
                              data-testid={`banner-payment-failed-${rec.id}`}>
                              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-red-600 leading-snug">
                                  Your last payment attempt failed — please try again
                                </p>
                                {rec.last_failed_error && (
                                  <p className="text-[11px] text-red-400 mt-0.5 leading-snug truncate"
                                    data-testid={`text-failed-reason-${rec.id}`}>
                                    {rec.last_failed_error}
                                  </p>
                                )}
                              </div>
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-xl flex-shrink-0 self-center"
                                style={{ background: "rgba(239,68,68,0.15)", color: "#dc2626" }}>
                                {rec.failed_count}×
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ══ HISTORY TAB ══════════════════════════════════════════════ */}
            {activeTab === "history" && (
              <motion.div key="history"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.22 }}>
                {attemptsLoading ? (
                  <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                  </div>
                ) : paymentAttempts.length === 0 ? (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-4 py-20 rounded-3xl"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.8)",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg,#e0e7ff,#c7d2fe)" }}>
                      <Receipt className="w-8 h-8 text-indigo-500" />
                    </div>
                    <div className="text-center">
                      <p className="font-extrabold text-slate-700 text-lg">No attempts yet</p>
                      <p className="text-sm text-slate-400 mt-1">All payment attempts — successful and failed — will appear here.</p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
                    {paymentAttempts.map((attempt, idx) => {
                      const isPaid   = attempt.type === "paid";
                      const isFailed = attempt.type === "failed";
                      const outcome  = classifyAttempt(attempt);
                      const accentGradient =
                        outcome === "Paid"              ? "linear-gradient(90deg,#10b981,#34d399)" :
                        outcome === "Payment Cancelled" ? "linear-gradient(90deg,#a855f7,#c084fc)" :
                        outcome === "Payment Expired"   ? "linear-gradient(90deg,#f97316,#fb923c)" :
                                                         "linear-gradient(90deg,#f43f5e,#fb7185)";
                      const dateLineLabel =
                        outcome === "Paid"              ? "Paid" :
                        outcome === "Payment Cancelled" ? "Cancelled" :
                        outcome === "Payment Expired"   ? "Expired" :
                                                         "Failed";
                      return (
                        <motion.div key={`${attempt.type}-${attempt.id}-${idx}`} variants={item}
                          className="rounded-3xl overflow-hidden"
                          style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(255,255,255,0.8)",
                            boxShadow: "0 4px 20px rgba(0,0,0,0.07)" }}
                          data-testid={isPaid ? `card-attempt-paid-${attempt.id}` : `card-attempt-failed-${attempt.id}`}>
                          {/* Accent bar */}
                          <div className="h-1 w-full" style={{ background: accentGradient }} />
                          <div className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                {/* Status pill + Online badge + payment mode */}
                                <div className="flex items-center gap-2 flex-wrap mb-2">
                                  <StatusPill status={outcome} />
                                  {isPaid && attempt.receiptNumber?.startsWith("ON") && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                                      style={{ background: "linear-gradient(135deg,#eff6ff,#dbeafe)", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
                                      <Sparkles className="w-2.5 h-2.5" /> Online
                                    </span>
                                  )}
                                  {/* Payment mode chip — UPI, Card ···4242, Netbanking · HDFC, etc. */}
                                  {isPaid && (() => {
                                    const modeLabel = formatPaymentMode(attempt);
                                    if (!modeLabel) return null;
                                    return (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                        style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>
                                        {modeLabel}
                                      </span>
                                    );
                                  })()}
                                </div>

                                {/* Fee name */}
                                <p className="font-extrabold text-slate-800 text-base leading-tight">
                                  {attempt.feeName || attempt.feeType || "Fee"}
                                </p>

                                {/* Student name + DSID — muted, below title */}
                                {student && (
                                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug truncate">
                                    {student.name}
                                    {student.digitalStudentId && (
                                      <span className="text-slate-300"> &bull; DSID: {student.digitalStudentId}</span>
                                    )}
                                  </p>
                                )}

                                {/* Date + time line — always from server createdAt in IST */}
                                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-400">
                                  <CalendarDays className="w-3 h-3 flex-shrink-0" />
                                  {dateLineLabel} {formatDateTime(attempt.createdAt)}
                                </div>

                                {/* Receipt row (paid only) */}
                                {isPaid && attempt.receiptNumber && (
                                  <div className="flex items-center gap-2 mt-2.5"
                                    data-testid={`text-attempt-receipt-${attempt.id}`}>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
                                      style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "1px solid #86efac" }}>
                                      <Receipt className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                                      <span className="font-mono text-xs font-black tracking-widest text-emerald-700">
                                        {attempt.receiptNumber}
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => copyReceiptNumber(attempt.id, attempt.receiptNumber!)}
                                      className="flex items-center justify-center w-7 h-7 rounded-xl transition-all active:scale-90"
                                      style={{ background: copiedReceiptId === attempt.id ? "#d1fae5" : "#f1f5f9",
                                        color: copiedReceiptId === attempt.id ? "#059669" : "#94a3b8",
                                        border: `1px solid ${copiedReceiptId === attempt.id ? "#6ee7b7" : "#e2e8f0"}` }}
                                      title="Copy receipt number">
                                      {copiedReceiptId === attempt.id
                                        ? <Check className="w-3.5 h-3.5" />
                                        : <Copy className="w-3.5 h-3.5" />}
                                    </button>
                                  </div>
                                )}

                                {/* ── Technical details for paid attempts ───────────────────────────── */}
                                {isPaid && (
                                  attempt.razorpayPaymentId || attempt.cardNetwork ||
                                  attempt.bankAuthCode || attempt.bankRrn ||
                                  attempt.razorpayFeePaise != null ||
                                  attempt.rzpCreatedAt || attempt.payerEmail
                                ) && (() => {
                                  const isTOpen = expandedTechnical.has(attempt.id);
                                  const toggleT = () =>
                                    setExpandedTechnical(prev => {
                                      const next = new Set(prev);
                                      isTOpen ? next.delete(attempt.id) : next.add(attempt.id);
                                      return next;
                                    });
                                  const tAccent = "#475569";
                                  return (
                                    <div className="mt-3 rounded-2xl overflow-hidden"
                                      style={{ background: "rgba(248,250,252,0.9)", border: "1px solid rgba(226,232,240,0.8)" }}>
                                      <button onClick={toggleT}
                                        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold transition-colors"
                                        style={{ background: "transparent", color: isTOpen ? tAccent : "#94a3b8" }}>
                                        <span>Technical details</span>
                                        <ChevronDown className="w-3.5 h-3.5 transition-transform"
                                          style={{ transform: isTOpen ? "rotate(180deg)" : "rotate(0deg)" }} />
                                      </button>
                                      {isTOpen && (
                                        <div className="px-3 pb-3 space-y-3"
                                          style={{ borderTop: "1px solid rgba(226,232,240,0.6)" }}>
                                          {(attempt.razorpayPaymentId || attempt.razorpayOrderId) && (
                                            <SectionGroup title="Payment Identification" accent={tAccent}>
                                              <TechRow label="Payment ID" value={attempt.razorpayPaymentId} mono />
                                              <TechRow label="Order ID" value={attempt.razorpayOrderId} mono />
                                              {attempt.feeRecordId ? <TechRow label="Fee Record" value={`#${attempt.feeRecordId}`} /> : null}
                                              <TechRow label="Timestamp" value={formatDateTime(attempt.createdAt)} />
                                            </SectionGroup>
                                          )}
                                          {attempt.amountPaise != null && (
                                            <SectionGroup title="Amount & Financial" accent={tAccent}>
                                              <TechRow label="Amount" value={`₹${(attempt.amountPaise / 100).toLocaleString("en-IN")}`} />
                                              <TechRow label="Razorpay Fee" value={attempt.razorpayFeePaise != null ? `₹${(attempt.razorpayFeePaise / 100).toFixed(2)}` : null} />
                                              <TechRow label="GST" value={attempt.razorpayTaxPaise != null ? `₹${(attempt.razorpayTaxPaise / 100).toFixed(2)}` : null} />
                                              <TechRow label="Currency" value={attempt.currency} />
                                            </SectionGroup>
                                          )}
                                          {attempt.paymentMethod && (
                                            <SectionGroup title="Payment Method" accent={tAccent}>
                                              <TechRow label="Method" value={attempt.paymentMethod.charAt(0).toUpperCase() + attempt.paymentMethod.slice(1)} />
                                              <TechRow label="Network" value={attempt.cardNetwork} />
                                              <TechRow label="Card" value={attempt.cardLast4 ? `●●●● ${attempt.cardLast4}` : null} />
                                              <TechRow label="Type" value={attempt.cardType ? attempt.cardType.charAt(0).toUpperCase() + attempt.cardType.slice(1) : null} />
                                              <TechRow label="Issuer" value={attempt.cardIssuer} />
                                              <TechRow label="Bank" value={attempt.bankName} />
                                              <TechRow label="UPI ID" value={attempt.vpa} />
                                              <TechRow label="Wallet" value={attempt.wallet} />
                                            </SectionGroup>
                                          )}
                                          {(attempt.bankAuthCode || attempt.bankRrn) && (
                                            <SectionGroup title="Bank & Acquirer" accent={tAccent}>
                                              <TechRow label="Auth Code" value={attempt.bankAuthCode} mono />
                                              <TechRow label="Bank RRN" value={attempt.bankRrn} mono />
                                            </SectionGroup>
                                          )}
                                          {(attempt.rzpCreatedAt || attempt.rzpCapturedAt) && (
                                            <SectionGroup title="Timeline" accent={tAccent}>
                                              <TechRow label="Created" value={attempt.rzpCreatedAt ? formatDateTime(attempt.rzpCreatedAt) : null} />
                                              <TechRow label="Authorized" value={attempt.rzpAuthorizedAt ? formatDateTime(attempt.rzpAuthorizedAt) : null} />
                                              <TechRow label="Captured" value={attempt.rzpCapturedAt ? formatDateTime(attempt.rzpCapturedAt) : null} />
                                            </SectionGroup>
                                          )}
                                          {(attempt.payerName || attempt.payerEmail || attempt.payerContact) && (
                                            <SectionGroup title="Customer" accent={tAccent}>
                                              <TechRow label="Name" value={attempt.payerName} />
                                              <TechRow label="Email" value={maskEmail(attempt.payerEmail)} />
                                              <TechRow label="Phone" value={maskPhone(attempt.payerContact)} />
                                            </SectionGroup>
                                          )}
                                          {attempt.refundId && (
                                            <SectionGroup title="Refund" accent={tAccent}>
                                              <TechRow label="Refund ID" value={attempt.refundId} mono />
                                              <TechRow label="Status" value={attempt.refundStatus} />
                                              <TechRow label="Amount" value={attempt.refundAmountPaise != null ? `₹${(attempt.refundAmountPaise / 100).toLocaleString("en-IN")}` : null} />
                                              <TechRow label="Initiated" value={attempt.refundInitiatedAt ? formatDateTime(attempt.refundInitiatedAt) : null} />
                                              <TechRow label="Processed" value={attempt.refundProcessedAt ? formatDateTime(attempt.refundProcessedAt) : null} />
                                            </SectionGroup>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* ── Friendly failure / cancellation block ─────── */}
                                {isFailed && (() => {
                                  const content = getFriendlyFailureContent(outcome);
                                  const isCancelled = outcome === "Payment Cancelled";
                                  const isExpired   = outcome === "Payment Expired";
                                  const accentColor =
                                    isCancelled ? "#7e22ce" :
                                    isExpired   ? "#c2410c" :
                                                  "#9f1239";
                                  const bg     =
                                    isCancelled ? "rgba(168,85,247,0.05)"  :
                                    isExpired   ? "rgba(249,115,22,0.06)"  :
                                                  "rgba(244,63,94,0.05)";
                                  const border =
                                    isCancelled ? "rgba(168,85,247,0.2)"   :
                                    isExpired   ? "rgba(249,115,22,0.22)"  :
                                                  "rgba(244,63,94,0.18)";
                                  const divider =
                                    isCancelled ? "rgba(168,85,247,0.14)"  :
                                    isExpired   ? "rgba(249,115,22,0.16)"  :
                                                  "rgba(244,63,94,0.14)";
                                  const isOpen = expandedTechnical.has(attempt.id);

                                  const toggleTechnical = () =>
                                    setExpandedTechnical(prev => {
                                      const next = new Set(prev);
                                      isOpen ? next.delete(attempt.id) : next.add(attempt.id);
                                      return next;
                                    });

                                  // Raw technical string — strip verbose Razorpay prefix
                                  const rawError = attempt.errorDescription
                                    ?.replace(/^Razorpay payment (failed|cancelled) \(client-reported\) — /i, "")
                                    ?? null;

                                  return (
                                    <div className="mt-3 rounded-2xl overflow-hidden"
                                      style={{ background: bg, border: `1px solid ${border}` }}>

                                      {/* ── Friendly section ────────────────────── */}
                                      <div className="px-3 pt-3 pb-2.5">
                                        <p className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
                                          style={{ color: accentColor }}>
                                          {content.sectionLabel}
                                        </p>
                                        <p className="text-[12px] text-slate-600 leading-snug">
                                          {content.reason}
                                        </p>
                                        <p className="text-[11px] font-bold mt-2.5 mb-0.5"
                                          style={{ color: accentColor }}>
                                          What can I do?
                                        </p>
                                        <p className="text-[12px] text-slate-500 leading-snug">
                                          {content.advice}
                                        </p>
                                        {/* Bank-debit ambiguity warning — only shown for gateway-sourced failures */}
                                        {(() => {
                                          const gatewayAdvice = getGatewayAdvice(attempt);
                                          return gatewayAdvice ? (
                                            <p className="text-[11px] mt-2 leading-snug font-medium"
                                              style={{ color: accentColor }}>
                                              ⚠ {gatewayAdvice}
                                            </p>
                                          ) : null;
                                        })()}
                                      </div>

                                      {/* ── Technical details accordion (8 structured sections) ── */}
                                      {(attempt.razorpayPaymentId || attempt.razorpayOrderId || attempt.errorCode ||
                                        attempt.cardNetwork || attempt.bankRrn || attempt.bankAuthCode ||
                                        attempt.payerEmail || attempt.rzpCreatedAt || attempt.amountPaise != null) && (
                                        <div style={{ borderTop: `1px solid ${divider}` }}>
                                          <button
                                            onClick={toggleTechnical}
                                            className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold transition-colors"
                                            style={{ background: "transparent", color: isOpen ? accentColor : "#94a3b8" }}>
                                            <span>Technical details</span>
                                            <ChevronDown className="w-3.5 h-3.5 transition-transform"
                                              style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }} />
                                          </button>
                                          {isOpen && (
                                            <div className="px-3 pb-3 space-y-3">
                                              {/* Payment Identification */}
                                              {(attempt.razorpayPaymentId || attempt.razorpayOrderId) && (
                                                <SectionGroup title="Payment Identification" accent={accentColor}>
                                                  <TechRow label="Payment ID" value={attempt.razorpayPaymentId} mono />
                                                  <TechRow label="Order ID" value={attempt.razorpayOrderId} mono />
                                                  {attempt.feeRecordId ? <TechRow label="Fee Record" value={`#${attempt.feeRecordId}`} /> : null}
                                                  <TechRow label="Timestamp" value={formatDateTime(attempt.createdAt)} />
                                                </SectionGroup>
                                              )}
                                              {/* Amount & Financial */}
                                              {attempt.amountPaise != null && (
                                                <SectionGroup title="Amount & Financial" accent={accentColor}>
                                                  <TechRow label="Amount" value={`₹${(attempt.amountPaise / 100).toLocaleString("en-IN")}`} />
                                                  <TechRow label="Razorpay Fee" value={attempt.razorpayFeePaise != null ? `₹${(attempt.razorpayFeePaise / 100).toFixed(2)}` : null} />
                                                  <TechRow label="GST" value={attempt.razorpayTaxPaise != null ? `₹${(attempt.razorpayTaxPaise / 100).toFixed(2)}` : null} />
                                                  <TechRow label="Currency" value={attempt.currency} />
                                                </SectionGroup>
                                              )}
                                              {/* Payment Method */}
                                              {attempt.paymentMethod && (
                                                <SectionGroup title="Payment Method" accent={accentColor}>
                                                  <TechRow label="Method" value={attempt.paymentMethod.charAt(0).toUpperCase() + attempt.paymentMethod.slice(1)} />
                                                  <TechRow label="Network" value={attempt.cardNetwork} />
                                                  <TechRow label="Card" value={attempt.cardLast4 ? `●●●● ${attempt.cardLast4}` : null} />
                                                  <TechRow label="Type" value={attempt.cardType ? attempt.cardType.charAt(0).toUpperCase() + attempt.cardType.slice(1) : null} />
                                                  <TechRow label="Issuer" value={attempt.cardIssuer} />
                                                  <TechRow label="Bank" value={attempt.bankName} />
                                                  <TechRow label="UPI ID" value={attempt.vpa} />
                                                  <TechRow label="Wallet" value={attempt.wallet} />
                                                </SectionGroup>
                                              )}
                                              {/* Bank & Acquirer */}
                                              {(attempt.bankAuthCode || attempt.bankRrn) && (
                                                <SectionGroup title="Bank & Acquirer" accent={accentColor}>
                                                  <TechRow label="Auth Code" value={attempt.bankAuthCode} mono />
                                                  <TechRow label="Bank RRN" value={attempt.bankRrn} mono />
                                                </SectionGroup>
                                              )}
                                              {/* Failure Details */}
                                              {(attempt.errorCode || attempt.errorSource || rawError) && (
                                                <SectionGroup title="Failure Details" accent={accentColor}>
                                                  <TechRow label="Error Code" value={attempt.errorCode} mono />
                                                  <TechRow label="Source" value={attempt.errorSource} />
                                                  <TechRow label="Step" value={attempt.errorStep} />
                                                  <TechRow label="Reason" value={attempt.errorReason} />
                                                  <TechRow label="Description" value={rawError} />
                                                </SectionGroup>
                                              )}
                                              {/* Timeline */}
                                              {(attempt.rzpCreatedAt || attempt.rzpFailedAt) && (
                                                <SectionGroup title="Timeline" accent={accentColor}>
                                                  <TechRow label="Created" value={attempt.rzpCreatedAt ? formatDateTime(attempt.rzpCreatedAt) : null} />
                                                  <TechRow label="Authorized" value={attempt.rzpAuthorizedAt ? formatDateTime(attempt.rzpAuthorizedAt) : null} />
                                                  <TechRow label="Failed at" value={attempt.rzpFailedAt ? formatDateTime(attempt.rzpFailedAt) : null} />
                                                </SectionGroup>
                                              )}
                                              {/* Customer */}
                                              {(attempt.payerName || attempt.payerEmail || attempt.payerContact) && (
                                                <SectionGroup title="Customer" accent={accentColor}>
                                                  <TechRow label="Name" value={attempt.payerName} />
                                                  <TechRow label="Email" value={maskEmail(attempt.payerEmail)} />
                                                  <TechRow label="Phone" value={maskPhone(attempt.payerContact)} />
                                                </SectionGroup>
                                              )}
                                              {/* Refund */}
                                              {attempt.refundId && (
                                                <SectionGroup title="Refund" accent={accentColor}>
                                                  <TechRow label="Refund ID" value={attempt.refundId} mono />
                                                  <TechRow label="Status" value={attempt.refundStatus} />
                                                  <TechRow label="Amount" value={attempt.refundAmountPaise != null ? `₹${(attempt.refundAmountPaise / 100).toLocaleString("en-IN")}` : null} />
                                                  <TechRow label="Initiated" value={attempt.refundInitiatedAt ? formatDateTime(attempt.refundInitiatedAt) : null} />
                                                  <TechRow label="Processed" value={attempt.refundProcessedAt ? formatDateTime(attempt.refundProcessedAt) : null} />
                                                </SectionGroup>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Amount + Receipt download (paid) */}
                              <div className="flex flex-col items-end gap-3 flex-shrink-0">
                                <p className={`text-2xl font-black ${isPaid ? "text-emerald-600" : "text-rose-500"}`}
                                  style={{ fontVariantNumeric: "tabular-nums" }}>
                                  {attempt.amount != null ? formatAmount(attempt.amount) : "—"}
                                </p>
                                {isPaid && (
                                  <a
                                    href={`/api/student/fees/${attempt.feeRecordId ?? attempt.id}/receipt`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-bold transition-all hover:opacity-80 active:scale-95"
                                    style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
                                      color: "#065f46", border: "1px solid #86efac",
                                      boxShadow: "0 2px 8px rgba(16,185,129,0.15)" }}
                                    data-testid={`button-download-receipt-${attempt.id}`}>
                                    <Download className="w-3.5 h-3.5" /> Receipt
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ══ REMINDERS TAB ════════════════════════════════════════════ */}
            {activeTab === "reminders" && (
              <motion.div key="reminders"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.22 }}>
                {notifLoading ? (
                  <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
                  </div>
                ) : notificationHistory.length === 0 ? (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-4 py-20 rounded-3xl"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.8)",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)" }}>
                      <Bell className="w-8 h-8 text-violet-500" />
                    </div>
                    <div className="text-center">
                      <p className="font-extrabold text-slate-700 text-lg">No reminders yet</p>
                      <p className="text-sm text-slate-400 mt-1">Fee reminder notifications will appear here.</p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div variants={container} initial="hidden" animate="show"
                    className="rounded-3xl overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(255,255,255,0.8)",
                      boxShadow: "0 4px 20px rgba(0,0,0,0.07)" }}
                    data-testid="section-notification-history">
                    {notificationHistory.map((entry, idx) => {
                      const isSent = entry.status === "sent";
                      const channelLabel =
                        entry.channel === "email"     ? "Email"
                        : entry.channel === "sms"     ? "SMS"
                        : entry.channel === "whatsapp" ? "WhatsApp"
                        : entry.channel;
                      const stageColors: Record<string, string> = {
                        D0: "#06b6d4", D7: "#f59e0b", D14: "#ef4444", D30: "#7c3aed",
                      };
                      const stageColor = stageColors[entry.stage] ?? "#6366f1";
                      return (
                        <motion.div key={entry.id} variants={item}
                          className="flex items-center gap-3 px-4 py-3.5"
                          style={{ borderBottom: idx < notificationHistory.length - 1 ? "1px solid #f1f5f9" : "none" }}
                          data-testid={`row-notif-${entry.id}`}>
                          {/* Channel icon */}
                          <div className="flex items-center justify-center w-9 h-9 rounded-2xl flex-shrink-0"
                            style={{ background: isSent ? "#f5f3ff" : "#fef2f2",
                              color: isSent ? "#7c3aed" : "#dc2626" }}>
                            <ChannelIcon channel={entry.channel} />
                          </div>

                          {/* Text */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-slate-700">{channelLabel} reminder</p>
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-black"
                                style={{ background: `${stageColor}18`, color: stageColor }}>
                                {entry.stage}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {entry.sentAt
                                ? new Date(entry.sentAt).toLocaleString("en-IN", {
                                    day: "2-digit", month: "short", year: "numeric",
                                    hour: "2-digit", minute: "2-digit",
                                  })
                                : "—"}
                            </p>
                          </div>

                          {/* Status badge */}
                          <span className="text-[10px] font-black px-2.5 py-1 rounded-xl flex-shrink-0"
                            style={isSent
                              ? { background: "linear-gradient(135deg,#d1fae5,#a7f3d0)", color: "#065f46", border: "1px solid #6ee7b7" }
                              : { background: "linear-gradient(135deg,#fee2e2,#fecaca)", color: "#991b1b", border: "1px solid #fca5a5" }}
                            data-testid={`badge-notif-status-${entry.id}`}>
                            {isSent ? "Sent" : "Failed"}
                          </span>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="relative z-10 text-center pb-8 pt-2">
        <p className="text-[10px] text-slate-400">
          © {new Date().getFullYear()} BENIUS · {student.schoolName}
        </p>
      </div>
    </div>
  );
}
