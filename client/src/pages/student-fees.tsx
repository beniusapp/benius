import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, CreditCard, Loader2, CheckCircle2, Clock, AlertTriangle,
  Receipt, Download, Lock, ExternalLink, Copy, Check, Zap, Bell,
  Mail, MessageSquare, Webhook, TrendingUp, Shield, ChevronRight, ChevronDown,
  Sparkles, CircleDollarSign, CalendarDays, BadgeCheck, WifiOff,
  XCircle, RotateCcw, X, ReceiptText,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { getQueryFn, sessionFetch } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";
import {
  classifyStudentPaymentAttempt,
  type PaymentAttemptOutcome,
  type StudentPaymentHistoryStatus,
} from "@shared/payment-attempt-status";
import { getCheckoutDismissAction } from "@shared/razorpay-checkout-dismiss";
import { paymentAttemptEventTime } from "@shared/payment-attempt-event-time";
import { formatOfflinePaymentMethod } from "@shared/offline-payment-method";
import { formatDateOnly, formatInstantIST, todayInIST } from "@shared/ist-time";

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

// ── Late Fee Policy transparency types ────────────────────────────────────────
// Populated by the server — the frontend never independently calculates
// the late-fee amount; it only renders the pre-computed display object.

interface LateFeeInfoTieredSlab {
  from_day: number;
  to_day: number;
  amount: number;
}

interface LateFeeInfo {
  enabled:            boolean;
  rule:               "NONE" | "FLAT" | "DAILY" | "TIERED";
  daysOverdue:        number;
  inGracePeriod:      boolean;
  graceDaysRemaining: number;
  currentLateFee:     number;
  policyLine:         string;
  statusMessage:      string | null;
  gracePeriodMessage: string | null;
  calculationLine:    string | null;
  tieredSlabs:        LateFeeInfoTieredSlab[] | null;
  activeSlabIndex:    number | null;
}

interface FeeRecord {
  id: number;
  studentId: number;
  schoolId: number;
  feeType: string;
  feeName: string;          // current structure display name — always fresh from server
  frequency?: string | null;
  amount: number;
  dueDate: string;
  paidDate: string | null;
  status: string;
  receiptNumber: string | null;
  invoiceNumber: string | null;
  notes: string | null;
  academicYear: string | null;
  createdAt: string;
  breakdown: BreakdownItem[];
  failed_count?: number;
  last_failed_error?: string | null;
  lateFeeInfo?: LateFeeInfo | null;
}

function formatFeeFrequency(frequency: string | null | undefined): string {
  const labels: Record<string, string> = {
    monthly: "Monthly",
    quarterly: "Quarterly",
    annual: "Annual",
    "one-time": "One-Time",
  };
  const value = frequency?.trim();
  return value ? (labels[value] ?? value) : "";
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
  outcome: PaymentAttemptOutcome;

  feeRecordId: number | null;
  feeType: string | null;
  feeName: string | null;
  /** Original invoice number from the associated fee record, when available. */
  invoiceNumber: string | null;

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
  // ── JSONB-extracted enrichment (no extra DB columns) ─────────────────
  cardId: string | null;             // Razorpay card token e.g. card_TPf…
  feeBearer: string | null;          // "customer" | "merchant"
  description: string | null;        // Order description from Razorpay
  bankTransactionId: string | null;  // Netbanking / UPI bank tx ID
  refundArn: string | null;          // ARN for processed refund
  attemptNumber: number | null;      // 1-based sequence for this fee record
  orderNotes: Record<string, any> | null; // Razorpay order notes object
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatAmount(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(amount);
}

function openSessionDocument(url: string) {
  const popup = window.open("", "_blank");
  if (!popup) return;

  popup.document.title = "Loading document…";
  popup.document.body.innerHTML = "<p style='font-family:system-ui;padding:24px'>Loading document…</p>";
  void sessionFetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error("Unable to open document");
      const blobUrl = URL.createObjectURL(await response.blob());
      popup.location.replace(blobUrl);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    })
    .catch(() => {
      popup.document.title = "Document unavailable";
      popup.document.body.innerHTML = "<p style='font-family:system-ui;padding:24px'>This document is unavailable for the selected academic session.</p>";
    });
}

function formatDate(dateStr: string | null) {
  return formatDateOnly(dateStr);
}

/** Formats any timestamp (ISO string, pg-style string, or Date object) as IST
 *  date + time with seconds.  e.g. "14 Aug 2026, 04:49:24 PM"
 *
 *  Handles the full range of pg TIMESTAMPTZ serialisations:
 *   • "2026-08-14 11:19:24.018887"       (bare UTC, no tz)
 *   • "2026-08-14 11:19:24.018887+00"    (2-digit tz offset)
 *   • "2026-08-14 11:19:24.018887+05:30" (full ±HH:MM)
 *   • "2026-08-14T11:19:24.018Z"         (standard ISO)
 *   • a JavaScript Date object (from pg driver direct row access)
 *
 *  Returns "—" for null/undefined/unparseable input. */
function formatDateTime(dateStr: string | Date | null | undefined): string {
  return formatInstantIST(dateStr);
}

function classifyAttempt(attempt: PaymentAttempt): StudentPaymentHistoryStatus {
  return classifyStudentPaymentAttempt(attempt);
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
  const rawMode = attempt.paymentMode ?? attempt.paymentMethod ?? "";
  const offlineLabel = formatOfflinePaymentMethod(rawMode);
  if (offlineLabel) return offlineLabel;
  const mode = rawMode.toLowerCase().trim();
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

/** Like TechRow but ALWAYS renders, showing "—" when value is absent.
 *  Use for spec-required fields that must display even without data. */
function TechRowFull({ label, value, mono = false }: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  const display = (value != null && value !== "") ? String(value) : "—";
  return (
    <div className="flex gap-2">
      <span className="text-[9.5px] font-semibold flex-shrink-0 mt-px"
        style={{ color: "#94a3b8", minWidth: 96 }}>
        {label}
      </span>
      <span className={`text-[10px] leading-snug break-all ${mono ? "font-mono" : ""}`}
        style={{ color: display === "—" ? "#cbd5e1" : "#475569" }}>
        {display}
      </span>
    </div>
  );
}

// ── Copy text builder ─────────────────────────────────────────────────────────
function buildPaymentCopyText(
  attempt: PaymentAttempt,
  feeTitle: string,
  studentName: string,
  dsid: string,
): string {
  const fp = (p: number | null | undefined) =>
    p != null ? `₹${(p / 100).toLocaleString("en-IN")}` : "—";
  const fpFixed = (p: number | null | undefined) =>
    p != null ? `₹${(p / 100).toFixed(2)}` : "—";
  const attemptLabel = attempt.attemptNumber != null
    ? `ATTEMPT-${String(attempt.attemptNumber).padStart(4, "0")}` : "—";
  const outcomeMap: Record<string, string> = {
    captured: "Captured", failed: "Failed", cancelled: "Cancelled",
    authorized: "Authorized", refunded: "Refunded", pending: "Pending",
  };
  const isFailed = attempt.outcome === "failed" || attempt.outcome === "cancelled";
  const rawErr = attempt.errorDescription
    ?.replace(/^Razorpay payment (failed|cancelled) \(client-reported\) — /i, "") ?? "—";

  const L = (label: string, value: string) =>
    `${label.padEnd(14, " ")}: ${value}`;

  const lines: string[] = [
    "--- PAYMENT ATTEMPT DETAILS ---",
    L("Student", studentName),
    L("DSID", dsid),
    L("Fee", feeTitle),
    "",
    "[PAYMENT IDENTIFICATION]",
    L("Payment ID", attempt.razorpayPaymentId ?? "—"),
    L("Order ID", attempt.razorpayOrderId ?? "—"),
    L("Fee Record", `#${attempt.feeRecordId}`),
    L("Attempt", attemptLabel),
    L("Status", outcomeMap[attempt.outcome] ?? attempt.outcome),
    L("Timestamp", formatDateTime(paymentAttemptEventTime(attempt))),
    "",
    "[AMOUNT & FINANCIAL]",
    L("Amount", fp(attempt.amountPaise)),
    L("Currency", attempt.currency ?? "INR"),
    L("Captured", isFailed ? "₹0" : fp(attempt.amountCapturedPaise)),
    L("Refunded", fp(attempt.amountRefundedPaise)),
    L("Gateway Fee", fpFixed(attempt.razorpayFeePaise)),
    L("GST on Fee", fpFixed(attempt.razorpayTaxPaise)),
  ];

  if (isFailed) {
    lines.push("", "[FAILURE DETAILS]",
      L("Error Code", attempt.errorCode ?? "—"),
      L("Source", attempt.errorSource ?? "—"),
      L("Step", attempt.errorStep ?? "—"),
      L("Reason", attempt.errorReason ?? "—"),
      L("Description", rawErr),
    );
  }

  if (attempt.paymentMethod) {
    lines.push("", "[PAYMENT METHOD]",
      L("Method", formatPaymentMode(attempt) ?? attempt.paymentMethod),
    );
    if (attempt.paymentMethod === "card") {
      lines.push(
        L("Card", [attempt.cardNetwork, attempt.cardLast4 ? `•••• ${attempt.cardLast4}` : null].filter(Boolean).join(" ") || "—"),
        L("Issuer", attempt.cardIssuer ?? "—"),
        L("Auth Code", attempt.bankAuthCode ?? "—"),
      );
    }
    if (attempt.paymentMethod === "upi")        lines.push(L("UPI VPA", attempt.vpa ?? "—"));
    if (attempt.paymentMethod === "netbanking") lines.push(L("Bank", attempt.bankName ?? "—"));
    if (attempt.paymentMethod === "wallet")     lines.push(L("Wallet", attempt.wallet ?? "—"));
  }

  lines.push("", "[BANK & ACQUIRER]",
    L("Bank RRN", attempt.bankRrn ?? "—"),
    L("Auth Code", attempt.bankAuthCode ?? "—"),
    L("Bank Tx ID", attempt.bankTransactionId ?? "—"),
  );

  if (attempt.payerEmail || attempt.payerContact) {
    lines.push("", "[CUSTOMER DETAILS]");
    if (attempt.payerName)    lines.push(L("Name",  attempt.payerName));
    if (attempt.payerEmail)   lines.push(L("Email", maskEmail(attempt.payerEmail) ?? "—"));
    if (attempt.payerContact) lines.push(L("Phone", maskPhone(attempt.payerContact) ?? "—"));
  }

  lines.push("", "[REFUND STATUS]");
  if (attempt.refundId) {
    lines.push(
      L("Refund ID", attempt.refundId),
      L("Amount", fp(attempt.refundAmountPaise)),
      L("ARN", attempt.refundArn ?? "—"),
    );
    if (attempt.refundInitiatedAt) lines.push(L("Initiated", formatDateTime(attempt.refundInitiatedAt)));
    if (attempt.refundProcessedAt) lines.push(L("Processed", formatDateTime(attempt.refundProcessedAt)));
  } else {
    lines.push(L("Status", "No refund issued"));
  }

  lines.push("-------------------------------");
  return lines.join("\n");
}

// ── PDF generator ─────────────────────────────────────────────────────────────
function downloadPaymentPDF(
  attempt: PaymentAttempt,
  feeTitle: string,
  studentName: string,
  dsid: string,
  schoolName: string,
): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210; // A4 width mm
  const margin = 16;
  const colLabel = margin;
  const colValue = margin + 46;
  let y = 0;

  const fp = (p: number | null | undefined) =>
    p != null ? `INR ${(p / 100).toLocaleString("en-IN")}` : "—";
  const fpFixed = (p: number | null | undefined) =>
    p != null ? `INR ${(p / 100).toFixed(2)}` : "—";

  // ── Header band ──
  doc.setFillColor(30, 41, 59);       // slate-800
  doc.rect(0, 0, W, 30, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text("PAYMENT ATTEMPT STATEMENT", margin, 13);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);   // slate-400
  doc.text(schoolName, margin, 20);
  doc.text(`Generated: ${formatDateTime(new Date().toISOString())}`, margin, 26);
  y = 38;

  // ── Student info block ──
  doc.setFillColor(241, 245, 249);   // slate-100
  doc.roundedRect(margin, y, W - margin * 2, 22, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text("STUDENT", margin + 4, y + 7);
  doc.setFont("helvetica", "normal");
  doc.text(studentName, margin + 4, y + 14);
  doc.setFont("helvetica", "bold");
  doc.text("DSID", margin + 70, y + 7);
  doc.setFont("helvetica", "normal");
  doc.text(dsid, margin + 70, y + 14);
  doc.setFont("helvetica", "bold");
  doc.text("FEE", margin + 120, y + 7);
  doc.setFont("helvetica", "normal");
  doc.text(feeTitle, margin + 120, y + 14);
  y += 30;

  const sectionHeader = (title: string) => {
    doc.setFillColor(226, 232, 240);  // slate-200
    doc.rect(margin, y, W - margin * 2, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);    // slate-600
    doc.text(title, margin + 2, y + 5);
    y += 9;
  };

  const row = (label: string, value: string, mono = false) => {
    if (y > 272) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);  // slate-500
    doc.text(label, colLabel, y);
    doc.setFont(mono ? "courier" : "helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);     // slate-800
    const wrapped = doc.splitTextToSize(value, W - colValue - margin);
    doc.text(wrapped, colValue, y);
    y += Math.max(wrapped.length * 5, 6);
  };

  const outcomeMap: Record<string, string> = {
    captured: "Captured", failed: "Failed", cancelled: "Cancelled",
    authorized: "Authorized", refunded: "Refunded", pending: "Pending",
  };
  const isFailed = attempt.outcome === "failed" || attempt.outcome === "cancelled";
  const attemptLabel = attempt.attemptNumber != null
    ? `ATTEMPT-${String(attempt.attemptNumber).padStart(4, "0")}` : "—";

  // A: Identification
  sectionHeader("A  ·  PAYMENT IDENTIFICATION");
  row("Payment ID",  attempt.razorpayPaymentId ?? "—", true);
  row("Order ID",    attempt.razorpayOrderId ?? "—", true);
  row("Fee Record",  `#${attempt.feeRecordId}`);
  row("Attempt",     attemptLabel, true);
  row("Status",      outcomeMap[attempt.outcome] ?? attempt.outcome);
  row("Timestamp",   formatDateTime(paymentAttemptEventTime(attempt)));
  y += 2;

  // B: Amount
  sectionHeader("B  ·  AMOUNT & FINANCIAL");
  row("Amount",      fp(attempt.amountPaise));
  row("Currency",    attempt.currency ?? "INR");
  row("Captured",    isFailed ? "INR 0" : fp(attempt.amountCapturedPaise));
  row("Refunded",    fp(attempt.amountRefundedPaise));
  row("Gateway Fee", fpFixed(attempt.razorpayFeePaise));
  row("GST on Fee",  fpFixed(attempt.razorpayTaxPaise));
  y += 2;

  // C: Failure (conditional)
  if (isFailed) {
    sectionHeader("C  ·  FAILURE DETAILS");
    row("Error Code",  attempt.errorCode ?? "—", true);
    row("Source",      attempt.errorSource ?? "—");
    row("Step",        attempt.errorStep ?? "—");
    row("Reason",      attempt.errorReason ?? "—");
    const rawErr = attempt.errorDescription
      ?.replace(/^Razorpay payment (failed|cancelled) \(client-reported\) — /i, "") ?? "—";
    row("Description", rawErr);
    y += 2;
  }

  // D: Payment Method
  if (attempt.paymentMethod) {
    sectionHeader("D  ·  PAYMENT METHOD");
    row("Method", formatPaymentMode(attempt) ?? attempt.paymentMethod);
    if (attempt.paymentMethod === "card") {
      row("Card",    [attempt.cardNetwork, attempt.cardLast4 ? `**** ${attempt.cardLast4}` : null].filter(Boolean).join(" ") || "—");
      row("Issuer",  attempt.cardIssuer ?? "—");
    }
    if (attempt.paymentMethod === "upi")        row("UPI VPA", attempt.vpa ?? "—", true);
    if (attempt.paymentMethod === "netbanking") row("Bank",    attempt.bankName ?? "—");
    if (attempt.paymentMethod === "wallet")     row("Wallet",  attempt.wallet ?? "—");
    y += 2;
  }

  // E: Bank & Acquirer
  sectionHeader("E  ·  BANK & ACQUIRER");
  row("Bank RRN",   attempt.bankRrn ?? "—", true);
  row("Auth Code",  attempt.bankAuthCode ?? "—", true);
  row("Bank Tx ID", attempt.bankTransactionId ?? "—", true);
  y += 2;

  // F: Customer
  if (attempt.payerEmail || attempt.payerContact || attempt.payerName) {
    sectionHeader("F  ·  CUSTOMER DETAILS");
    if (attempt.payerName)    row("Name",  attempt.payerName);
    if (attempt.payerEmail)   row("Email", maskEmail(attempt.payerEmail) ?? "—");
    if (attempt.payerContact) row("Phone", maskPhone(attempt.payerContact) ?? "—");
    y += 2;
  }

  // G: Notes
  if (attempt.description || attempt.orderNotes) {
    sectionHeader("G  ·  DESCRIPTION & NOTES");
    if (attempt.description) row("Description", attempt.description);
    if (attempt.orderNotes && typeof attempt.orderNotes === "object") {
      Object.entries(attempt.orderNotes).forEach(([k, v]) => row(k, String(v)));
    }
    y += 2;
  }

  // H: Refund
  sectionHeader("H  ·  REFUND STATUS");
  if (attempt.refundId) {
    const refundLabel = attempt.refundAmountPaise != null && attempt.amountPaise != null &&
      attempt.refundAmountPaise >= attempt.amountPaise ? "Full Refund" : "Partial Refund";
    row("Status",    refundLabel);
    row("Refund ID", attempt.refundId, true);
    row("Amount",    fp(attempt.refundAmountPaise));
    if (attempt.refundArn)         row("ARN",       attempt.refundArn, true);
    if (attempt.refundInitiatedAt) row("Initiated",  formatDateTime(attempt.refundInitiatedAt));
    if (attempt.refundProcessedAt) row("Processed",  formatDateTime(attempt.refundProcessedAt));
  } else {
    row("Status", "No refund issued");
  }
  y += 6;

  // ── Footer ──
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(241, 245, 249);
    doc.rect(0, 285, W, 12, "F");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text("Generated automatically via Student Portal. This is a system-generated statement.", margin, 291);
    doc.text(`Page ${i} of ${pageCount}`, W - margin, 291, { align: "right" });
  }

  // ── Save ──
  // Stamp the filename with the IST calendar date so the generated report's
  // date is stable regardless of the host/browser timezone (a report made
  // near IST midnight must not shift a calendar day based on the device).
  const fileDate = formatDateOnly(todayInIST()).replace(/\s+/g, "");
  doc.save(`Payment_Statement_${attempt.feeRecordId}_${attemptLabel}_${fileDate}.pdf`);
}

// ── Copy + Download action buttons rendered inside the expanded drawer ────────
function PaymentActions({
  attempt, feeTitle, studentName, dsid, schoolName,
}: {
  attempt: PaymentAttempt;
  feeTitle: string;
  studentName: string;
  dsid: string;
  schoolName: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        buildPaymentCopyText(attempt, feeTitle, studentName, dsid),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {/* clipboard blocked */ }
  };

  const handlePDF = () =>
    downloadPaymentPDF(attempt, feeTitle, studentName, dsid, schoolName);

  return (
    <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 z-10">
      {/* Copy */}
      <div className="relative group">
        <button onClick={handleCopy}
          title={copied ? "Copied!" : "Copy Details to Clipboard"}
          className="flex items-center justify-center w-6 h-6 rounded-lg transition-all active:scale-90"
          style={{
            background: copied ? "#d1fae5" : "#f1f5f9",
            color:      copied ? "#059669" : "#64748b",
            border:     `1px solid ${copied ? "#6ee7b7" : "#e2e8f0"}`,
          }}>
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
        <span className="absolute right-7 top-0.5 whitespace-nowrap text-[10px] font-medium
          px-1.5 py-0.5 rounded bg-slate-800 text-white
          opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          {copied ? "Copied!" : "Copy Details to Clipboard"}
        </span>
      </div>
      {/* Download PDF */}
      <div className="relative group">
        <button onClick={handlePDF}
          title="Download Payment Statement (PDF)"
          className="flex items-center justify-center w-6 h-6 rounded-lg transition-all active:scale-90"
          style={{ background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" }}>
          <Download className="w-3 h-3" />
        </button>
        <span className="absolute right-7 top-0.5 whitespace-nowrap text-[10px] font-medium
          px-1.5 py-0.5 rounded bg-slate-800 text-white
          opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          Download Payment Statement (PDF)
        </span>
      </div>
    </div>
  );
}

/** Full 8-section payment details — shared by paid AND failed/cancelled attempt accordions. */
function PaymentSections({ attempt, accent }: { attempt: PaymentAttempt; accent: string }) {
  const paise  = (p: number | null | undefined) =>
    p != null ? `₹${(p / 100).toLocaleString("en-IN")}` : null;
  const paiseF = (p: number | null | undefined) =>
    p != null ? `₹${(p / 100).toFixed(2)}` : null;

  const attemptLabel = attempt.attemptNumber != null
    ? `ATTEMPT-${String(attempt.attemptNumber).padStart(4, "0")}` : null;

  const outcomeLabel: Record<string, string> = {
    captured: "Captured", failed: "Failed", cancelled: "Cancelled",
    authorized: "Authorized", refunded: "Refunded", pending: "Pending",
  };
  const statusLabel = outcomeLabel[attempt.outcome] ?? attempt.outcome;

  const cardTypeDesc = [
    attempt.cardInternational === false ? "Domestic"      :
    attempt.cardInternational === true  ? "International" : null,
    attempt.cardType
      ? attempt.cardType.charAt(0).toUpperCase() + attempt.cardType.slice(1)
      : null,
    "card",
  ].filter(Boolean).join(" ");

  const feeBearerLabel =
    attempt.feeBearer === "customer" ? "You pay the Razorpay platform fee"      :
    attempt.feeBearer === "merchant" ? "Merchant pays the Razorpay platform fee" :
    null;

  const refundStatusLabel = attempt.refundId
    ? (attempt.refundAmountPaise != null && attempt.amountPaise != null &&
       attempt.refundAmountPaise >= attempt.amountPaise ? "Full Refund" : "Partial Refund")
    : "No refund issued";

  const rawError = attempt.errorDescription
    ?.replace(/^Razorpay payment (failed|cancelled) \(client-reported\) — /i, "")
    ?? null;

  return (
    <>
      {/* A: Payment Identification */}
      <SectionGroup title="Payment Identification" accent={accent}>
        <TechRowFull label="Payment ID" value={attempt.razorpayPaymentId} mono />
        <TechRowFull label="Order ID"   value={attempt.razorpayOrderId} mono />
        <TechRowFull label="Fee Record" value={attempt.feeRecordId ? `#${attempt.feeRecordId}` : null} />
        <TechRowFull label="Attempt"    value={attemptLabel} />
        <TechRowFull label="Status"     value={statusLabel} />
        <TechRowFull label="Timestamp"  value={formatDateTime(paymentAttemptEventTime(attempt))} />
      </SectionGroup>

      {/* B: Amount & Financial */}
      <SectionGroup title="Amount & Financial" accent={accent}>
        <TechRowFull label="Amount"      value={paise(attempt.amountPaise)} />
        <TechRowFull label="Currency"    value={attempt.currency ?? "INR"} />
        <TechRowFull label="Captured"    value={
          (attempt.outcome === "failed" || attempt.outcome === "cancelled")
            ? "₹0"
            : paise(attempt.amountCapturedPaise)
        } />
        <TechRowFull label="Refunded"    value={paise(attempt.amountRefundedPaise)} />
        <TechRowFull label="Gateway Fee" value={paiseF(attempt.razorpayFeePaise)} />
        <TechRowFull label="GST on Fee"  value={paiseF(attempt.razorpayTaxPaise)} />
        {feeBearerLabel && <TechRowFull label="Fee Bearer" value={feeBearerLabel} />}
      </SectionGroup>

      {/* C: Failure Details — only for failed/cancelled outcomes */}
      {(attempt.outcome === "failed" || attempt.outcome === "cancelled") && (
        <SectionGroup title="Failure Details" accent={accent}>
          <TechRowFull label="Error Code"  value={attempt.errorCode} mono />
          <TechRowFull label="Source"      value={attempt.errorSource} />
          <TechRowFull label="Step"        value={attempt.errorStep} />
          <TechRowFull label="Reason"      value={attempt.errorReason} />
          <TechRowFull label="Description" value={rawError} />
        </SectionGroup>
      )}

      {/* D: Payment Method */}
      {attempt.paymentMethod && (
        <SectionGroup title="Payment Method" accent={accent}>
          <TechRow label="Method"
            value={formatPaymentMode(attempt) ?? attempt.paymentMethod} />
          {attempt.paymentMethod === "card" && (<>
            <TechRow label="Card Type"  value={cardTypeDesc} />
            <TechRow label="Network"    value={attempt.cardNetwork} />
            <TechRow label="Issuer"     value={attempt.cardIssuer} />
            <TechRow label="Card No."   value={attempt.cardLast4 ? `●●●● ${attempt.cardLast4}` : null} />
            <TechRow label="Card Token" value={attempt.cardId} mono />
            <TechRow label="Cardholder"
              value={attempt.cardName && attempt.cardName !== "---" ? attempt.cardName : null} />
          </>)}
          {attempt.paymentMethod === "upi"        && <TechRow label="UPI VPA" value={attempt.vpa} />}
          {attempt.paymentMethod === "netbanking" && <TechRow label="Bank"    value={attempt.bankName} />}
          {attempt.paymentMethod === "wallet"     && <TechRow label="Wallet"  value={attempt.wallet} />}
        </SectionGroup>
      )}

      {/* E: Bank & Acquirer */}
      <SectionGroup title="Bank & Acquirer" accent={accent}>
        <TechRowFull label="Bank RRN"   value={attempt.bankRrn} mono />
        <TechRowFull label="Auth Code"  value={attempt.bankAuthCode} mono />
        <TechRowFull label="Bank Tx ID" value={attempt.bankTransactionId} mono />
      </SectionGroup>

      {/* F: Customer Details */}
      {(attempt.payerName || attempt.payerEmail || attempt.payerContact) && (
        <SectionGroup title="Customer Details" accent={accent}>
          <TechRow label="Name"  value={attempt.payerName} />
          <TechRow label="Email" value={maskEmail(attempt.payerEmail)} />
          <TechRow label="Phone" value={maskPhone(attempt.payerContact)} />
        </SectionGroup>
      )}

      {/* G: Description & Internal References */}
      {(attempt.description || attempt.orderNotes) && (
        <SectionGroup title="Description & Notes" accent={accent}>
          <TechRow label="Description" value={attempt.description} />
          {attempt.orderNotes && Object.entries(attempt.orderNotes).map(([k, v]) => (
            <TechRow key={k} label={k} value={String(v)} />
          ))}
        </SectionGroup>
      )}

      {/* H: Refund Status — always shown */}
      <SectionGroup title="Refund Status" accent={accent}>
        <TechRow label="Status" value={refundStatusLabel} />
        {attempt.refundId && (<>
          <TechRow label="Refund ID"  value={attempt.refundId} mono />
          <TechRow label="Amount"     value={paise(attempt.refundAmountPaise)} />
          <TechRow label="ARN"        value={attempt.refundArn} mono />
          <TechRow label="Initiated"  value={formatDateTime(attempt.refundInitiatedAt)} />
          <TechRow label="Processed"  value={formatDateTime(attempt.refundProcessedAt)} />
        </>)}
      </SectionGroup>
    </>
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
  if (status === "Payment Authorized") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide"
      style={{ background: "linear-gradient(135deg,#dbeafe,#bfdbfe)", color: "#1d4ed8", border: "1px solid #93c5fd" }}>
      <Clock className="w-3 h-3" /> Payment Authorized
    </span>
  );
  if (status === "Payment Pending") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide"
      style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)", color: "#92400e", border: "1px solid #fcd34d" }}>
      <Clock className="w-3 h-3" /> Payment Pending
    </span>
  );
  if (status === "Payment Refunded") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide"
      style={{ background: "linear-gradient(135deg,#e0f2fe,#bae6fd)", color: "#0369a1", border: "1px solid #7dd3fc" }}>
      <RotateCcw className="w-3 h-3" /> Payment Refunded
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

// ── Late Fee Policy transparency panel ────────────────────────────────────────
// Pure display component. Renders only when lateFeeInfo.enabled is true and
// the invoice is not Paid. Never calculates any amounts — only
// renders server-supplied strings and pre-computed values.

function LateFeeInfoPanel({
  info,
  baseAmount,
  status,
}: {
  info: LateFeeInfo | null | undefined;
  baseAmount: number;
  status: string;
}) {
  // Explicit status guard per architectural requirement — do not rely solely
  // on currentLateFee === 0, because the policy may still be enabled even
  // when no fee is yet accrued.
  if (!info?.enabled) return null;
  if (status === "Paid") return null;

  const isOverdue  = !info.inGracePeriod && info.daysOverdue > 0 && info.currentLateFee > 0;
  const isGrace    = info.inGracePeriod;

  // Colour scheme: amber when overdue/grace, indigo when upcoming
  const borderColor = (isOverdue || isGrace)
    ? "rgba(245,158,11,0.28)"
    : "rgba(99,102,241,0.18)";
  const bgColor = (isOverdue || isGrace)
    ? "rgba(255,251,235,0.85)"
    : "rgba(238,242,255,0.75)";
  const headerTextColor = (isOverdue || isGrace) ? "#92400e" : "#3730a3";
  const bodyTextColor   = (isOverdue || isGrace) ? "#78350f" : "#3730a3";
  const subtleColor     = (isOverdue || isGrace) ? "#b45309" : "#4338ca";

  const headerLabel = isOverdue ? "Late Fee" : isGrace ? "Grace Period Active" : "Late Fee Policy";

  return (
    <div
      className="mt-2.5 w-full rounded-xl overflow-hidden"
      style={{ border: `1px solid ${borderColor}`, background: bgColor }}
    >
      {/* Header row */}
      <div
        className="px-2.5 py-1.5 flex items-center gap-1.5"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        {isOverdue
          ? <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: headerTextColor }} />
          : isGrace
          ? <Clock className="w-3 h-3 flex-shrink-0" style={{ color: headerTextColor }} />
          : <Bell className="w-3 h-3 flex-shrink-0" style={{ color: headerTextColor }} />
        }
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: headerTextColor }}>
          {headerLabel}
        </p>
      </div>

      <div className="px-2.5 py-2 space-y-1.5">

        {/* ── Grace period: full narrative replaces the normal display ── */}
        {isGrace && info.gracePeriodMessage && (
          <p className="text-xs leading-snug" style={{ color: bodyTextColor }}>
            {info.gracePeriodMessage}
          </p>
        )}

        {/* ── Not in grace: show the policy description ── */}
        {!isGrace && (
          <p className="text-xs leading-snug" style={{ color: bodyTextColor }}>
            {info.policyLine}
          </p>
        )}

        {/* ── Overdue: parent-friendly status message (primary) ── */}
        {isOverdue && info.statusMessage && (
          <p className="text-xs font-semibold leading-snug" style={{ color: bodyTextColor }}>
            {info.statusMessage}
          </p>
        )}

        {/* ── Overdue: technical calculation (secondary, smaller) ── */}
        {isOverdue && info.calculationLine && (
          <p
            className="text-[11px] leading-snug font-mono"
            style={{ color: subtleColor }}
          >
            {info.calculationLine}
          </p>
        )}

        {/* ── Tiered schedule table ── */}
        {info.rule === "TIERED" && info.tieredSlabs && info.tieredSlabs.length > 0 && (
          <div className="rounded-lg overflow-hidden mt-1" style={{ border: `1px solid ${borderColor}` }}>
            {info.tieredSlabs.map((slab, i) => {
              const isActive = info.activeSlabIndex === i;
              // Detect "pinned to last slab" scenario for the label
              const isLastSlab = i === info.tieredSlabs!.length - 1;
              const pinnedBeyond = isLastSlab && info.activeSlabIndex === i && info.daysOverdue > slab.to_day;
              const label = pinnedBeyond
                ? `Days ${slab.from_day}+`
                : `Days ${slab.from_day}–${slab.to_day}`;
              return (
                <div
                  key={i}
                  className="flex items-center justify-between px-2 py-1 text-xs"
                  style={{
                    borderBottom: i < info.tieredSlabs!.length - 1 ? `1px solid ${borderColor}` : undefined,
                    background:   isActive ? "rgba(245,158,11,0.13)" : "transparent",
                    fontWeight:   isActive ? 700 : undefined,
                    color:        isActive ? "#92400e" : "#78716c",
                  }}
                >
                  <span>{isActive ? "▶ " : "    "}{label}</span>
                  <span className="tabular-nums">{formatAmount(slab.amount)}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Breakdown row: base + late fee = total (shown when fee > 0) ── */}
        {isOverdue && info.currentLateFee > 0 && (
          <div
            className="pt-1.5 mt-0.5 space-y-0.5"
            style={{ borderTop: `1px solid ${borderColor}` }}
          >
            <div className="flex justify-between text-[11px]" style={{ color: subtleColor }}>
              <span>Base fee</span>
              <span className="tabular-nums">{formatAmount(baseAmount)}</span>
            </div>
            <div className="flex justify-between text-[11px] font-bold" style={{ color: subtleColor }}>
              <span>Late fee</span>
              <span className="tabular-nums">+{formatAmount(info.currentLateFee)}</span>
            </div>
            <div
              className="flex justify-between text-xs font-black"
              style={{ color: headerTextColor }}
            >
              <span>Total payable</span>
              <span className="tabular-nums">{formatAmount(baseAmount + info.currentLateFee)}</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function StudentFees() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { isArchiveMode, selectedSession, subscribeToPaymentUpdate } = useSessionView();
  const sessionCacheId = selectedSession?.id ?? "unselected";
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
    queryKey: ["/api/student/fees", sessionCacheId],
    enabled: !!student && !!selectedSession,
    staleTime: 0,               // always treat as stale — payment status must never be served from cache
    refetchOnWindowFocus: true, // re-check status the moment the student returns to this tab
  });

  const { data: feesSummary, refetch: refetchSummary } = useQuery<FeesSummary>({
    queryKey: ["/api/student/fees/summary", sessionCacheId],
    enabled: !!student && !!selectedSession,
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
    queryKey: ["/api/student/fees/notification-history", sessionCacheId],
    enabled: !!student && !!selectedSession,
    staleTime: 30_000,
  });

  const { data: paymentAttempts = [], isLoading: attemptsLoading } = useQuery<PaymentAttempt[]>({
    queryKey: ["/api/student/fees/payment-attempts", sessionCacheId],
    enabled: !!student && !!selectedSession,
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
      const resp = await sessionFetch("/api/payments/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeRecordId: rec.id }),
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
          // Invalidate payment-attempts so the History tab shows the new paid
          // attempt immediately — without this the tab only updates via SSE.
          queryClient.invalidateQueries({ queryKey: ["/api/student/fees/payment-attempts"] });
        };

        // ── Checkout-timeout tracking ────────────────────────────────────────
        // Razorpay fires `ondismiss` for both voluntary closes (user clicks ✕)
        // and automatic closes when the configured `timeout` elapses — there is
        // no separate callback for the two cases.  We use a parallel timer that
        // fires 500 ms before Razorpay's own timeout to set a flag; when
        // ondismiss then fires, the flag tells us which path triggered it.
        const CHECKOUT_TIMEOUT_S  = 600;
        let   timedOut            = false;
        let   gatewayFailureReported = false;
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
            sessionFetch("/api/payments/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
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
              const dismissAction = getCheckoutDismissAction(gatewayFailureReported, timedOut);
              if (dismissAction === "ignore") {
                // payment.failed already created the authoritative failed
                // attempt. Do not add a second, inaccurate cancellation.
                return;
              }
              if (dismissAction === "expired") {
                // The checkout window closed because the timeout elapsed — the
                // student likely stepped away.  Show a friendly "try again" prompt.
                reject(new RazorpayOrderExpiredError());
              } else {
                // Voluntary close by the student — release the order lock
                // immediately so the student can retry this invoice or pay a
                // different one without waiting for the 10-minute checkout
                // window to elapse.  The endpoint is a no-op if the fee is
                // already Paid (status guard on the server prevents the UPDATE).
                sessionFetch("/api/payments/clear-failed-order", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
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
          gatewayFailureReported = true;
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
          sessionFetch("/api/payments/clear-failed-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
                              {(rec.feeType?.trim() || rec.frequency) && (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-500">
                                  {rec.feeType?.trim() && (
                                    <span data-testid={`text-fee-type-detail-${rec.id}`}>
                                      <span className="font-semibold text-slate-400">Fee Type:</span>{" "}
                                      {rec.feeType.trim()}
                                    </span>
                                  )}
                                  {formatFeeFrequency(rec.frequency) && (
                                    <span data-testid={`text-fee-frequency-${rec.id}`}>
                                      <span className="font-semibold text-slate-400">Frequency:</span>{" "}
                                      {formatFeeFrequency(rec.frequency)}
                                    </span>
                                  )}
                                </div>
                              )}
                              {rec.invoiceNumber && (
                                <p className="text-[11px] text-slate-400 mt-0.5 font-mono tracking-wide"
                                  data-testid={`text-invoice-number-${rec.id}`}>
                                  {rec.invoiceNumber}
                                </p>
                              )}
                              {(rec as any).feePeriodLabel && (rec as any).feePeriodLabel !== "—" && (rec as any).feePeriodLabel !== rec.academicYear && (
                                <p className="text-[11px] text-indigo-400 font-medium mt-0.5"
                                  data-testid={`text-fee-period-${rec.id}`}>
                                  Fee Period: {(rec as any).feePeriodLabel}
                                </p>
                              )}
                              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-400">
                                <CalendarDays className="w-3 h-3 flex-shrink-0" />
                                Due {formatDate(rec.dueDate)}
                              </div>
                              {rec.notes && (
                                <p className="text-xs text-slate-400 mt-1 italic">{rec.notes}</p>
                              )}
                              {/* Late Fee Policy transparency panel — display-only, no payment logic */}
                              {rec.status !== "Paid" && (
                                <LateFeeInfoPanel
                                  info={rec.lateFeeInfo}
                                  baseAmount={rec.amount}
                                  status={rec.status}
                                />
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
                              {/* View Invoice — opens the server-rendered invoice in a new tab */}
                              {rec.invoiceNumber && (
                                <button
                                  onClick={() => openSessionDocument(`/api/student/fees/${rec.id}/invoice`)}
                                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-bold transition-all active:scale-95"
                                  style={{
                                    background: "#f5f3ff",
                                    color: "#6d28d9",
                                    border: "1.5px solid #c4b5fd",
                                  }}
                                  data-testid={`button-view-invoice-${rec.id}`}>
                                  <ReceiptText className="w-3.5 h-3.5" /> View Invoice
                                </button>
                              )}
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
                  <motion.div variants={container} initial="hidden" animate="show" className="space-y-2">
                    {paymentAttempts.map((attempt, idx) => {
                       const isPaid   = attempt.outcome === "captured";
                      const outcome  = classifyAttempt(attempt);
                       const isFailed =
                         outcome === "Payment Failed" ||
                         outcome === "Payment Cancelled" ||
                         outcome === "Payment Expired";
                      // The history endpoint provides the authoritative invoice number.
                      // Keep the loaded-record lookup as a safe fallback for older responses.
                      const attemptInvoiceNo = attempt.invoiceNumber ?? (
                        attempt.feeRecordId
                          ? feeRecords.find(r => r.id === attempt.feeRecordId)?.invoiceNumber ?? null
                          : null
                      );
                      const accentGradient =
                        outcome === "Paid"              ? "linear-gradient(90deg,#10b981,#34d399)" :
                        outcome === "Payment Cancelled" ? "linear-gradient(90deg,#a855f7,#c084fc)" :
                        outcome === "Payment Expired"   ? "linear-gradient(90deg,#f97316,#fb923c)" :
                         outcome === "Payment Refunded"  ? "linear-gradient(90deg,#0ea5e9,#38bdf8)" :
                         outcome === "Payment Authorized"? "linear-gradient(90deg,#2563eb,#60a5fa)" :
                         outcome === "Payment Pending"   ? "linear-gradient(90deg,#d97706,#fbbf24)" :
                                                         "linear-gradient(90deg,#f43f5e,#fb7185)";
                      const dateLineLabel =
                        outcome === "Paid"              ? "Paid" :
                        outcome === "Payment Cancelled" ? "Cancelled" :
                        outcome === "Payment Expired"   ? "Expired" :
                         outcome === "Payment Refunded"  ? "Refunded" :
                         outcome === "Payment Authorized"? "Authorized" :
                         outcome === "Payment Pending"   ? "Pending" :
                                                         "Failed";
                      return (
                        <motion.div key={`${attempt.type}-${attempt.id}-${idx}`} variants={item}
                          className="rounded-3xl overflow-hidden"
                          style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(255,255,255,0.8)",
                            boxShadow: "0 4px 20px rgba(0,0,0,0.07)" }}
                          data-testid={isPaid ? `card-fee-paid-${attempt.feeRecordId ?? attempt.id}` : `card-attempt-failed-${attempt.id}`}>
                          {/* Accent bar */}
                          <div className="h-1 w-full" style={{ background: accentGradient }} />
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                {/* Status pill + Online badge + payment mode */}
                                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                  <StatusPill status={outcome} />
                                  {isPaid && attempt.receiptNumber?.startsWith("ON") && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                                      style={{ background: "linear-gradient(135deg,#eff6ff,#dbeafe)", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
                                      <Sparkles className="w-2.5 h-2.5" /> Portal Payment
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
                                  {/* Attempt number badge */}
                                  {attempt.attemptNumber != null && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9.5px] font-bold"
                                      style={{ background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" }}>
                                      #{attempt.attemptNumber}
                                    </span>
                                  )}
                                </div>

                                {/* Fee name */}
                                <p className="font-extrabold text-slate-800 text-[13.5px] leading-tight">
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
                                   {dateLineLabel} {formatDateTime(paymentAttemptEventTime(attempt))}
                                </div>

                                {/* Original invoice number from the associated fee record. */}
                                {attemptInvoiceNo && (
                                  <div className="flex items-center gap-1 mt-1.5">
                                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg"
                                      style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)", border: "1px solid #c4b5fd" }}>
                                      <ReceiptText className="w-3 h-3 text-violet-500 flex-shrink-0" />
                                      <span className="font-mono text-[11px] font-semibold tracking-widest text-violet-700"
                                        data-testid={`text-attempt-invoice-${attempt.id}`}>
                                        {attemptInvoiceNo}
                                      </span>
                                    </div>
                                  </div>
                                )}
                                {/* Receipt row (paid only) */}
                                {isPaid && attempt.receiptNumber && (
                                  <div className="flex items-center gap-1.5 mt-1.5"
                                    data-testid={`text-attempt-receipt-${attempt.id}`}>
                                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg"
                                      style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "1px solid #86efac" }}>
                                      <Receipt className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                                      <span className="font-mono text-[11px] font-black tracking-widest text-emerald-700">
                                        {attempt.receiptNumber}
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => copyReceiptNumber(attempt.id, attempt.receiptNumber!)}
                                      className="flex items-center justify-center w-6 h-6 rounded-lg transition-all active:scale-90"
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

                                {/* ── Payment Details (paid attempts) ─────────────────────────────── */}
                                {isPaid && (() => {
                                  const isTOpen = expandedTechnical.has(attempt.id);
                                  const toggleT = () =>
                                    setExpandedTechnical(prev => {
                                      const next = new Set(prev);
                                      isTOpen ? next.delete(attempt.id) : next.add(attempt.id);
                                      return next;
                                    });
                                  const tAccent = "#475569";
                                  return (
                                    <div className="mt-2 rounded-xl overflow-hidden"
                                      style={{ background: "rgba(248,250,252,0.9)", border: isTOpen ? "1px solid rgba(99,102,241,0.25)" : "1px solid rgba(226,232,240,0.8)" }}>
                                      <button onClick={toggleT}
                                        className="w-full flex items-center justify-between px-3.5 py-2.5 group transition-all duration-200"
                                        style={{ background: isTOpen ? "rgba(238,242,255,0.7)" : "transparent" }}>
                                        <div className="flex items-center gap-2.5">
                                          <div className="p-1.5 rounded-lg transition-transform duration-200 group-hover:scale-105"
                                            style={{
                                              background: isTOpen ? "rgba(99,102,241,0.15)" : "rgba(226,232,240,0.8)",
                                              color: isTOpen ? "#4f46e5" : "#64748b",
                                            }}>
                                            <ReceiptText className="w-3.5 h-3.5" />
                                          </div>
                                          <span className="text-[12.5px] font-bold tracking-tight transition-colors duration-200"
                                            style={{ color: isTOpen ? "#4338ca" : "#475569" }}>
                                            Payment Details
                                          </span>
                                        </div>
                                        <ChevronDown className="w-3.5 h-3.5 transition-transform duration-300"
                                          style={{
                                            transform: isTOpen ? "rotate(180deg)" : "rotate(0deg)",
                                            color: isTOpen ? "#4f46e5" : "#94a3b8",
                                          }} />
                                      </button>
                                      {isTOpen && (
                                        <div className="px-3 pb-2 space-y-2 relative"
                                          style={{ borderTop: "1px solid rgba(226,232,240,0.6)" }}>
                                          <PaymentActions
                                            attempt={attempt}
                                            feeTitle={attempt.feeName || attempt.feeType || ""}
                                            studentName={student?.name ?? ""}
                                            dsid={student?.digitalStudentId ?? ""}
                                            schoolName={student?.schoolName ?? ""}
                                          />
                                          <PaymentSections attempt={attempt} accent={tAccent} />
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
                                    <div className="mt-2 rounded-xl overflow-hidden"
                                      style={{ background: bg, border: `1px solid ${border}` }}>

                                      {/* ── Friendly section ────────────────────── */}
                                      <div className="px-3 pt-2 pb-2">
                                        <p className="text-[10.5px] font-bold uppercase tracking-wider mb-1"
                                          style={{ color: accentColor }}>
                                          {content.sectionLabel}
                                        </p>
                                        <p className="text-[11.5px] text-slate-600 leading-snug">
                                          {content.reason}
                                        </p>
                                        <p className="text-[11px] font-bold mt-2 mb-0"
                                          style={{ color: accentColor }}>
                                          What can I do?
                                        </p>
                                        <p className="text-[11.5px] text-slate-500 leading-snug">
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

                                      {/* ── Payment Details accordion ─────────────────────────────────── */}
                                      <div style={{ borderTop: `1px solid ${divider}` }}>
                                        <button
                                          onClick={toggleTechnical}
                                          className="w-full flex items-center justify-between px-3.5 py-2.5 group transition-all duration-200"
                                          style={{ background: isOpen ? "rgba(238,242,255,0.5)" : "transparent" }}>
                                          <div className="flex items-center gap-2.5">
                                            <div className="p-1.5 rounded-lg transition-transform duration-200 group-hover:scale-105"
                                              style={{
                                                background: isOpen ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.5)",
                                                color: isOpen ? "#4f46e5" : "#94a3b8",
                                              }}>
                                              <ReceiptText className="w-3.5 h-3.5" />
                                            </div>
                                            <span className="text-[12.5px] font-bold tracking-tight transition-colors duration-200"
                                              style={{ color: isOpen ? "#4338ca" : "#64748b" }}>
                                              Payment Details
                                            </span>
                                          </div>
                                          <ChevronDown className="w-3.5 h-3.5 transition-transform duration-300"
                                            style={{
                                              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                                              color: isOpen ? "#4f46e5" : "#94a3b8",
                                            }} />
                                        </button>
                                        {isOpen && (
                                          <div className="px-3 pb-2 space-y-2 relative">
                                            <PaymentActions
                                              attempt={attempt}
                                              feeTitle={attempt.feeName || attempt.feeType || ""}
                                              studentName={student?.name ?? ""}
                                              dsid={student?.digitalStudentId ?? ""}
                                              schoolName={student?.schoolName ?? ""}
                                            />
                                            <PaymentSections attempt={attempt} accent={accentColor} />
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Amount + Receipt download (paid) */}
                              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                <p className={`text-xl font-black ${isPaid ? "text-emerald-600" : "text-rose-500"}`}
                                  style={{ fontVariantNumeric: "tabular-nums" }}>
                                  {attempt.amount != null ? formatAmount(attempt.amount) : "—"}
                                </p>
                                {isPaid && (
                                  <a
                                    href={`/api/student/fees/${attempt.feeRecordId ?? attempt.id}/receipt`}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      openSessionDocument(`/api/student/fees/${attempt.feeRecordId ?? attempt.id}/receipt`);
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:opacity-80 active:scale-95"
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
                        "D-2": "#8b5cf6", "D+0": "#06b6d4", "D+3": "#10b981", "D+7": "#f59e0b", "D+14": "#ef4444",
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
                              {formatDateTime(entry.sentAt)}
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
          © {todayInIST().slice(0, 4)} BENIUS · {student.schoolName}
        </p>
      </div>
    </div>
  );
}
