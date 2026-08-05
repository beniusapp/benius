import { useEffect, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, GraduationCap, Loader2, CreditCard, CheckCircle2, Clock, AlertTriangle, Receipt, Download, Lock, ExternalLink, Copy, Check, Zap } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";
import { ArrowLeft, GraduationCap, Loader2, CreditCard, CheckCircle2, Clock, AlertTriangle, Receipt, Download, Lock, ExternalLink, Copy, Check, Bell, Mail, MessageSquare, Webhook } from "lucide-react";

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

interface FeeRecord {
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

function formatAmount(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusChip({ status }: { status: string }) {
  if (status === "Paid") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold"
        style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}
        data-testid={`badge-fee-status-paid`}
      >
        <CheckCircle2 className="w-3 h-3" /> Paid
      </span>
    );
  }
  if (status === "Overdue") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold"
        style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}
        data-testid={`badge-fee-status-overdue`}
      >
        <AlertTriangle className="w-3 h-3" /> Overdue
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold"
      style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a" }}
      data-testid={`badge-fee-status-due`}
    >
      <Clock className="w-3 h-3" /> Due
    </span>
  );
}

// ── Load Razorpay checkout script dynamically ─────────────────────────────────
function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Razorpay) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout"));
    document.head.appendChild(script);
  });
}

export default function StudentFees() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { isArchiveMode, selectedSession } = useSessionView();
  const [copiedReceiptId, setCopiedReceiptId] = useState<number | null>(null);
  const [payingFeeId, setPayingFeeId] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

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

  const { data: portalInfo } = useQuery<PortalInfo>({
    queryKey: ["/api/student/fees/portal-info"],
    enabled: !!student,
    staleTime: 60_000,
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

  // ── Razorpay Pay Now handler ────────────────────────────────────────────────
  const handlePayNow = useCallback(async (rec: FeeRecord, studentData: StudentMeResponse) => {
    if (!portalInfo?.razorpayEnabled || !portalInfo.razorpayKeyId) return;
    setPayingFeeId(rec.id);
    setPayError(null);
    try {
      // 1. Load SDK
      await loadRazorpayScript();

      // 2. Create Razorpay order via backend
      const resp = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeRecordId: rec.id }),
        credentials: "include",
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message ?? "Failed to create order");
      }
      const { orderId, amount, currency, keyId } = await resp.json();

      // 3. Open Razorpay checkout
      await new Promise<void>((resolve, reject) => {
        const options = {
          key: keyId,
          amount,
          currency,
          name: studentData.schoolName,
          description: rec.feeType,
          order_id: orderId,
          prefill: {
            name: studentData.name,
            contact: "",
            email: "",
          },
          theme: { color: "#06b6d4" },
          handler: () => {
            // Payment succeeded — webhook will update DB; refetch after a moment
            setTimeout(() => {
              refetchFees();
              queryClient.invalidateQueries({ queryKey: ["/api/student/fees"] });
            }, 2000);
            resolve();
          },
          modal: {
            ondismiss: () => reject(new Error("dismissed")),
          },
        };
        const rzp = new (window as any).Razorpay(options);
        rzp.open();
      });
    } catch (err: any) {
      if (err?.message !== "dismissed") {
        setPayError(err?.message ?? "Payment failed");
      }
    } finally {
      setPayingFeeId(null);
    }
  }, [portalInfo, refetchFees, queryClient]);

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <Loader2 className="w-10 h-10 animate-spin text-cyan-500" />
      </div>
    );
  }

  const totalDue = feeRecords.filter(r => r.status !== "Paid").reduce((s, r) => s + r.amount, 0);
  const totalPaid = feeRecords.filter(r => r.status === "Paid").reduce((s, r) => s + r.amount, 0);
  const overdueCount = feeRecords.filter(r => r.status === "Overdue").length;

  const paidRecords = feeRecords.filter(r => r.status === "Paid");
  const pendingRecords = feeRecords.filter(r => r.status !== "Paid");

  const razorpayActive = !isArchiveMode && (portalInfo?.razorpayEnabled ?? false) && !!portalInfo?.razorpayKeyId;

  return (
    <div className="min-h-screen" style={{ background: "#f8fafc" }}>
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
      </div>

      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          background: "rgba(255, 255, 255, 0.75)",
          borderBottom: "1px solid rgba(255,255,255,0.7)",
          boxShadow: "0 1px 28px rgba(0,0,0,0.07)",
        }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-9 h-9 rounded-xl transition-all hover:bg-slate-100"
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div
            className="flex items-center justify-center w-9 h-9 rounded-xl"
            style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
          >
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <p className="font-bold text-base text-slate-800 tracking-tight">Fees & Payments</p>
            <p className="text-[11px] text-slate-400 font-medium">{student.schoolName}</p>
          </div>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative z-10 max-w-4xl mx-auto w-full px-4 sm:px-6 pt-24 pb-12 space-y-6"
      >

        {/* Archive mode banner */}
        {isArchiveMode && selectedSession && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: "#fefce8", border: "1.5px solid #fde68a", boxShadow: "0 2px 10px rgba(234,179,8,0.12)" }}
            data-testid="banner-archive-fees"
          >
            <Lock className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-amber-800">Archive Mode — Read Only</p>
              <p className="text-xs text-amber-600 mt-0.5">Viewing fee records for <span className="font-semibold">{selectedSession.sessionName}</span>. No payments can be processed.</p>
            </div>
          </motion.div>
        )}

        {/* Pay error banner */}
        {payError && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: "#fef2f2", border: "1.5px solid #fecaca" }}
          >
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700 flex-1">{payError}</p>
            <button onClick={() => setPayError(null)} className="text-red-400 hover:text-red-600 text-xs font-semibold">Dismiss</button>
          </motion.div>
        )}

        {/* External payment portal banner (legacy external link) */}
        {portalInfo?.isEnabled && !portalInfo.razorpayEnabled && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-2xl p-4"
            style={{
              background: "rgba(255,255,255,0.82)",
              border: "1px solid rgba(255,255,255,0.75)",
              boxShadow: "0 4px 18px rgba(0,0,0,0.06)",
              borderTop: "4px solid #06b6d4",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div
                className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
              >
                <CreditCard className="w-4 h-4 text-white" />
              </div>
              <p className="font-bold text-slate-800 text-sm">Pay Fees Online</p>
            </div>
            {portalInfo.bannerMessage && (
              <p className="text-sm text-slate-600 mb-3">{portalInfo.bannerMessage}</p>
            )}
            {portalInfo.gatewayUrl && (
              <a
                href={portalInfo.gatewayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
              >
                <ExternalLink className="w-4 h-4" />
                Pay Now
              </a>
            )}
          </motion.div>
        )}

        {/* Summary cards */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="grid grid-cols-3 gap-3"
        >
          <div
            className="rounded-2xl p-4 text-center"
            style={{ background: "rgba(255,255,255,0.82)", border: "1px solid rgba(255,255,255,0.75)", boxShadow: "0 4px 18px rgba(0,0,0,0.06)", borderTop: "4px solid #ef4444" }}
            data-testid="card-total-due"
          >
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Outstanding</p>
            <p className="text-lg sm:text-xl font-extrabold text-red-500">{formatAmount(totalDue)}</p>
            {overdueCount > 0 && <p className="text-[10px] text-red-400 font-medium mt-0.5">{overdueCount} overdue</p>}
          </div>
          <div
            className="rounded-2xl p-4 text-center"
            style={{ background: "rgba(255,255,255,0.82)", border: "1px solid rgba(255,255,255,0.75)", boxShadow: "0 4px 18px rgba(0,0,0,0.06)", borderTop: "4px solid #10b981" }}
            data-testid="card-total-paid"
          >
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Paid</p>
            <p className="text-lg sm:text-xl font-extrabold text-emerald-500">{formatAmount(totalPaid)}</p>
          </div>
          <div
            className="rounded-2xl p-4 text-center"
            style={{ background: "rgba(255,255,255,0.82)", border: "1px solid rgba(255,255,255,0.75)", boxShadow: "0 4px 18px rgba(0,0,0,0.06)", borderTop: "4px solid #06b6d4" }}
            data-testid="card-total-records"
          >
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Records</p>
            <p className="text-lg sm:text-xl font-extrabold text-cyan-500">{feeRecords.length}</p>
          </div>
        </motion.div>

        {feesLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        ) : feeRecords.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="rounded-2xl p-10 flex flex-col items-center gap-3 text-center"
            style={{ background: "rgba(255,255,255,0.82)", border: "1px solid rgba(255,255,255,0.75)", boxShadow: "0 4px 18px rgba(0,0,0,0.06)" }}
            data-testid="section-no-fees"
          >
            <div className="text-4xl">💳</div>
            <p className="font-bold text-slate-700 text-base">No fee records yet</p>
            <p className="text-sm text-slate-400">Your school has not posted any fee records for you yet.</p>
          </motion.div>
        ) : (
          <>
            {/* Pending/Overdue fees */}
            {pendingRecords.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.4 }}
              >
                <h2 className="text-sm font-bold text-slate-600 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Outstanding Fees
                </h2>
                <div className="space-y-3">
                  {pendingRecords.map((rec) => (
                    <div
                      key={rec.id}
                      className="rounded-2xl p-4"
                      style={{
                        background: "rgba(255,255,255,0.82)",
                        border: rec.status === "Overdue" ? "1px solid #fecaca" : "1px solid rgba(255,255,255,0.75)",
                        boxShadow: "0 4px 18px rgba(0,0,0,0.06)",
                        borderLeft: `4px solid ${rec.status === "Overdue" ? "#ef4444" : "#f59e0b"}`,
                      }}
                      data-testid={`card-fee-${rec.id}`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusChip status={rec.status} />
                            {rec.academicYear && (
                              <span className="text-[10px] font-medium text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">{rec.academicYear}</span>
                            )}
                          </div>
                          <p className="font-bold text-slate-800 text-sm mt-1" data-testid={`text-fee-type-${rec.id}`}>{rec.feeType}</p>
                          <p className="text-xs text-slate-400 mt-0.5">Due: {formatDate(rec.dueDate)}</p>
                          {rec.notes && <p className="text-xs text-slate-400 mt-0.5 italic">{rec.notes}</p>}
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <p className="text-lg font-extrabold text-slate-800" data-testid={`text-fee-amount-${rec.id}`}>{formatAmount(rec.amount)}</p>
                          {/* Razorpay Pay Now button */}
                          {razorpayActive && (
                            <button
                              onClick={() => handlePayNow(rec, student)}
                              disabled={payingFeeId === rec.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-60"
                              style={{ background: payingFeeId === rec.id ? "#94a3b8" : "linear-gradient(135deg,#528FF0,#2D6EE8)" }}
                              data-testid={`button-pay-now-${rec.id}`}
                            >
                              {payingFeeId === rec.id
                                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                                : <><Zap className="w-3.5 h-3.5" /> Pay Now</>}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Payment history */}
            {paidRecords.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.4 }}
              >
                <h2 className="text-sm font-bold text-slate-600 mb-3 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-emerald-500" />
                  Payment History
                </h2>
                <div className="space-y-3">
                  {paidRecords.map((rec) => (
                    <div
                      key={rec.id}
                      className="rounded-2xl p-4"
                      style={{
                        background: "rgba(255,255,255,0.82)",
                        border: "1px solid rgba(255,255,255,0.75)",
                        boxShadow: "0 4px 18px rgba(0,0,0,0.06)",
                        borderLeft: "4px solid #10b981",
                      }}
                      data-testid={`card-fee-paid-${rec.id}`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusChip status={rec.status} />
                            {rec.academicYear && (
                              <span className="text-[10px] font-medium text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">{rec.academicYear}</span>
                            )}
                            {/* Online payment badge */}
                            {rec.receiptNumber?.startsWith("ON") && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}>
                                Online
                              </span>
                            )}
                          </div>
                          <p className="font-bold text-slate-800 text-sm mt-1">{rec.feeType}</p>
                          <p className="text-xs text-slate-400 mt-0.5">Paid on: {formatDate(rec.paidDate)}</p>
                          {rec.receiptNumber && (
                            <div className="flex items-center gap-1.5 mt-1.5" data-testid={`text-receipt-${rec.id}`}>
                              <Receipt className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                              <span
                                className="font-mono text-xs font-bold tracking-wider px-2 py-0.5 rounded"
                                style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", letterSpacing: "0.08em" }}
                              >
                                {rec.receiptNumber}
                              </span>
                              <button
                                onClick={() => copyReceiptNumber(rec.id, rec.receiptNumber!)}
                                className="flex items-center justify-center w-6 h-6 rounded-md transition-all hover:bg-emerald-50 active:scale-90"
                                style={{ color: copiedReceiptId === rec.id ? "#16a34a" : "#94a3b8" }}
                                title="Copy receipt number"
                                data-testid={`button-copy-receipt-${rec.id}`}
                              >
                                {copiedReceiptId === rec.id
                                  ? <Check className="w-3.5 h-3.5" />
                                  : <Copy className="w-3.5 h-3.5" />
                                }
                              </button>
                            </div>
                          )}
                          {rec.notes && <p className="text-xs text-slate-400 mt-0.5 italic">{rec.notes}</p>}
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <p className="text-lg font-extrabold text-emerald-600">{formatAmount(rec.amount)}</p>
                          <a
                            href={`/api/student/fees/${rec.id}/receipt`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                            style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}
                            data-testid={`button-download-receipt-${rec.id}`}
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download Receipt
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </>
        )}

        {/* Reminders Sent section */}
        {(notifLoading || notificationHistory.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
          >
            <h2 className="text-sm font-bold text-slate-600 mb-3 flex items-center gap-2">
              <Bell className="w-4 h-4 text-violet-500" />
              Reminders Sent
            </h2>
            {notifLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
              </div>
            ) : (
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.82)",
                  border: "1px solid rgba(255,255,255,0.75)",
                  boxShadow: "0 4px 18px rgba(0,0,0,0.06)",
                }}
                data-testid="section-notification-history"
              >
                <div className="divide-y divide-slate-100">
                  {notificationHistory.map((entry) => {
                    const ChannelIcon = entry.channel === "email" ? Mail : entry.channel === "sms" ? MessageSquare : Webhook;
                    const channelLabel = entry.channel === "email" ? "Email" : entry.channel === "sms" ? "SMS" : entry.channel === "whatsapp" ? "WhatsApp" : entry.channel;
                    const isSent = entry.status === "sent";
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 px-4 py-3"
                        data-testid={`row-notif-${entry.id}`}
                      >
                        <div
                          className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
                          style={{
                            background: isSent ? "#f5f3ff" : "#fef2f2",
                            color: isSent ? "#7c3aed" : "#dc2626",
                          }}
                        >
                          <ChannelIcon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-700">
                            {channelLabel} reminder
                            <span className="ml-1.5 font-normal text-slate-400">· Stage {entry.stage}</span>
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {entry.sentAt
                              ? new Date(entry.sentAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                              : "—"}
                          </p>
                        </div>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={isSent
                            ? { background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }
                            : { background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}
                          data-testid={`badge-notif-status-${entry.id}`}
                        >
                          {isSent ? "Sent" : "Failed"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.4 }}
          className="text-center text-[11px] text-slate-400 pb-2"
        >
          © {new Date().getFullYear()} BENIUS · {student.schoolName}
        </motion.p>
      </motion.main>
    </div>
  );
}
