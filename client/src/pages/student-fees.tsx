import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, CreditCard, Loader2, CheckCircle2, Clock, AlertTriangle,
  Receipt, Download, Lock, ExternalLink, Copy, Check, Zap, Bell,
  Mail, MessageSquare, Webhook, TrendingUp, Shield, ChevronRight,
  Sparkles, CircleDollarSign, CalendarDays, BadgeCheck, WifiOff,
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

class RazorpayScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RazorpayScriptError";
  }
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
  const [activeTab, setActiveTab] = useState<"outstanding" | "history" | "reminders">("outstanding");

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
  });

  const { data: feesSummary, refetch: refetchSummary } = useQuery<FeesSummary>({
    queryKey: ["/api/student/fees/summary"],
    enabled: !!student,
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

        const options = {
          key: keyId, amount, currency,
          name: studentData.schoolName,
          description: rec.feeType,
          order_id: orderId,
          prefill: { name: studentData.name, contact: "", email: "" },
          theme: { color: "#6366f1" },
          handler: (response: any) => {
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
              }),
            })
              .then(r => r.json())
              .catch(() => ({ ok: false }))
              .finally(() => refreshFeesData());
            resolve();
          },
          // Auto-close the checkout after 10 minutes.  Razorpay fires ondismiss
          // when the timeout elapses, which rejects the promise and clears
          // payingFeeId via the finally block below.  This handles the
          // in-session case where the student opened the modal, switched away
          // within the SPA, and the component is still mounted in the background.
          timeout: 600,
          modal: { ondismiss: () => reject(new Error("dismissed")) },
        };

        const rzp = new (window as any).Razorpay(options);

        // Capture payment failures from the Razorpay SDK (card declined, etc.)
        rzp.on("payment.failed", (response: any) => {
          const desc = response?.error?.description ?? response?.error?.reason ?? "Payment failed";
          reject(new Error(desc));
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
    { key: "history"     as const, label: "History",     count: paidRecords.length },
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

        {/* ── Pay error banner ────────────────────────────────────────────── */}
        <AnimatePresence>
          {payError && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mt-4 flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: "rgba(239,68,68,0.1)", border: "1.5px solid rgba(239,68,68,0.3)" }}>
              <WifiOff className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300 flex-1">{payError}</p>
              <button onClick={() => setPayError(null)}
                className="text-red-400 hover:text-red-200 text-xs font-semibold transition-colors">✕</button>
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
                        {/* Accent top bar */}
                        <div className="h-1 w-full"
                          style={{ background: rec.status === "Overdue"
                            ? "linear-gradient(90deg,#ef4444,#f87171)"
                            : "linear-gradient(90deg,#f59e0b,#fbbf24)" }} />
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <StatusPill status={rec.status} />
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
                              {/* Razorpay Pay Now — shown only when toggle is ON and live keys are saved */}
                              {razorpayActive && (
                                <button
                                  onClick={() => handlePayNow(rec, student)}
                                  disabled={payingFeeId === rec.id}
                                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black text-white transition-all active:scale-95 disabled:opacity-60"
                                  style={{ background: payingFeeId === rec.id
                                    ? "linear-gradient(135deg,#94a3b8,#cbd5e1)"
                                    : "linear-gradient(135deg,#6366f1,#818cf8)",
                                    boxShadow: payingFeeId === rec.id ? "none" : "0 4px 18px rgba(99,102,241,0.45)" }}
                                  data-testid={`button-pay-now-${rec.id}`}>
                                  {payingFeeId === rec.id
                                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                                    : <><Zap className="w-3.5 h-3.5" /> Pay Now</>}
                                </button>
                              )}
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
                {feesLoading ? (
                  <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                  </div>
                ) : paidRecords.length === 0 ? (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-4 py-20 rounded-3xl"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.8)",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg,#e0e7ff,#c7d2fe)" }}>
                      <Receipt className="w-8 h-8 text-indigo-500" />
                    </div>
                    <div className="text-center">
                      <p className="font-extrabold text-slate-700 text-lg">No payments yet</p>
                      <p className="text-sm text-slate-400 mt-1">Paid fees and receipts will appear here.</p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
                    {paidRecords.map((rec) => (
                      <motion.div key={rec.id} variants={item}
                        className="rounded-3xl overflow-hidden"
                        style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(255,255,255,0.8)",
                          boxShadow: "0 4px 20px rgba(0,0,0,0.07)" }}
                        data-testid={`card-fee-paid-${rec.id}`}>
                        <div className="h-1 w-full"
                          style={{ background: "linear-gradient(90deg,#10b981,#34d399)" }} />
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <StatusPill status={rec.status} />
                                {rec.academicYear && (
                                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold"
                                    style={{ background: "#f1f5f9", color: "#64748b" }}>
                                    {rec.academicYear}
                                  </span>
                                )}
                                {rec.receiptNumber?.startsWith("ON") && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                                    style={{ background: "linear-gradient(135deg,#eff6ff,#dbeafe)", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
                                    <Sparkles className="w-2.5 h-2.5" /> Online
                                  </span>
                                )}
                              </div>
                              <p className="font-extrabold text-slate-800 text-base leading-tight">{rec.feeName || rec.feeType}</p>
                              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-400">
                                <CalendarDays className="w-3 h-3 flex-shrink-0" />
                                Paid {formatDate(rec.paidDate)}
                              </div>
                              {rec.receiptNumber && (
                                <div className="flex items-center gap-2 mt-2.5" data-testid={`text-receipt-${rec.id}`}>
                                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
                                    style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "1px solid #86efac" }}>
                                    <Receipt className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                                    <span className="font-mono text-xs font-black tracking-widest text-emerald-700">{rec.receiptNumber}</span>
                                  </div>
                                  <button
                                    onClick={() => copyReceiptNumber(rec.id, rec.receiptNumber!)}
                                    className="flex items-center justify-center w-7 h-7 rounded-xl transition-all active:scale-90"
                                    style={{ background: copiedReceiptId === rec.id ? "#d1fae5" : "#f1f5f9",
                                      color: copiedReceiptId === rec.id ? "#059669" : "#94a3b8",
                                      border: `1px solid ${copiedReceiptId === rec.id ? "#6ee7b7" : "#e2e8f0"}` }}
                                    title="Copy receipt number"
                                    data-testid={`button-copy-receipt-${rec.id}`}>
                                    {copiedReceiptId === rec.id
                                      ? <Check className="w-3.5 h-3.5" />
                                      : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              )}
                              {rec.notes && <p className="text-xs text-slate-400 mt-1.5 italic">{rec.notes}</p>}
                            </div>
                            <div className="flex flex-col items-end gap-3 flex-shrink-0">
                              <p className="text-2xl font-black text-emerald-600"
                                style={{ fontVariantNumeric: "tabular-nums" }}>
                                {formatAmount(rec.amount)}
                              </p>
                              <a
                                href={`/api/student/fees/${rec.id}/receipt`}
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-bold transition-all hover:opacity-80 active:scale-95"
                                style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
                                  color: "#065f46", border: "1px solid #86efac",
                                  boxShadow: "0 2px 8px rgba(16,185,129,0.15)" }}
                                data-testid={`button-download-receipt-${rec.id}`}>
                                <Download className="w-3.5 h-3.5" /> Receipt
                              </a>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
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
