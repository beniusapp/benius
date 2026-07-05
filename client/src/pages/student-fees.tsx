import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, GraduationCap, Loader2, CreditCard, CheckCircle2, Clock, AlertTriangle, Receipt, Download, Lock } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";

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

export default function StudentFees() {
  const [, setLocation] = useLocation();
  const { isArchiveMode, selectedSession } = useSessionView();

  const { data: student, isLoading: studentLoading, isError } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: feeRecords = [], isLoading: feesLoading } = useQuery<FeeRecord[]>({
    queryKey: ["/api/student/fees"],
    enabled: !!student,
  });

  useEffect(() => {
    if (!studentLoading && (isError || !student || !student.schoolId)) {
      setLocation("/student-login");
    }
  }, [studentLoading, isError, student, setLocation]);

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
                        <div className="text-right flex-shrink-0">
                          <p className="text-lg font-extrabold text-slate-800" data-testid={`text-fee-amount-${rec.id}`}>{formatAmount(rec.amount)}</p>
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
                          </div>
                          <p className="font-bold text-slate-800 text-sm mt-1">{rec.feeType}</p>
                          <p className="text-xs text-slate-400 mt-0.5">Paid on: {formatDate(rec.paidDate)}</p>
                          {rec.receiptNumber && (
                            <p className="text-xs text-emerald-600 font-semibold mt-0.5" data-testid={`text-receipt-${rec.id}`}>
                              Receipt: {rec.receiptNumber}
                            </p>
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
