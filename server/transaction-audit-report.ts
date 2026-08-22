/**
 * transaction-audit-report.ts
 *
 * Pure HTML renderer for the per-invoice transaction audit report.
 *
 * Exported:
 *   renderTransactionAuditHtml(detail: TransactionAuditDetail): string
 *   maskVpa(vpa: string | null | undefined): string
 *   maskEmail(email: string | null | undefined): string
 *   maskContact(contact: string | null | undefined): string
 *   fmtINR(rupees: number): string
 *   paise(rupees: number): number
 *
 * Security rules enforced:
 *   - Never render razorpay_signature / HMAC values
 *   - Never render raw webhook payloads or raw responses
 *   - Never render IP addresses
 *   - Never render idempotency keys or credentials
 *   - Mask VPA, payer email, payer contact, student phone/email
 *   - Card: only last-four + network; never full PAN
 *
 * Financial reconciliation:
 *   - Total Charged = fee amount + late fee (from fee record)
 *   - Gross Received = sum of payment record amounts (paise)
 *   - Processed Refunds = only refunds with localStatus === "processed"
 *   - Outstanding = max(0, total charged − net retained)
 *   - NEVER defaults missing gateway status to "captured"
 */

import { formatInstantIST, formatDateOnly } from "../shared/ist-time";

type InstantValue = string | Date | null | undefined;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LateFeeConfig {
  enabled?: boolean;
  type?: "NONE" | "FLAT" | "DAILY" | "TIERED";
  grace_period_days?: number;
  flat_amount?: number;
  daily_rate?: number;
  max_cap?: number;
  tiered_slabs?: Array<{ from_day: number; to_day: number; amount: number }>;
}

export interface OfflineDetail {
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
}

export interface PaymentCorrection {
  reason: string;
  changedByName: string | null;
  createdAt: string;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
}

export interface PaymentRecord {
  id: number;
  feeRecordId?: number | null;
  studentId?: number;
  paymentMethod: string;
  amount: number;
  lateFeePaid?: number;
  receivedDate: string;
  referenceNumber: string | null;
  cashierNotes: string | null;
  receiptNumber: string | null;
  invoiceNumber?: string | null;
  razorpayPaymentId?: string | null;
  razorpayOrderId?: string | null;
  razorpaySignature?: string | null; // NEVER rendered
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
  offlineDetail?: OfflineDetail | null;
  corrections?: PaymentCorrection[];
}

export interface AttemptEvent {
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
  payload?: unknown; // NEVER rendered
  webhookEventId: number | null;
}

export interface PaymentAttempt {
  id: number;
  externalId?: string | null;
  paymentRecordId?: number | null;
  attemptNumber: number | null;
  outcome: string;
  source: string;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  amountPaise: number | null;
  amountCapturedPaise?: number | null;
  amountRefundedPaise?: number | null;
  razorpayFeePaise?: number | null;
  razorpayTaxPaise?: number | null;
  currency: string;
  paymentMethod: string | null;
  cardNetwork?: string | null;
  cardLast4?: string | null;
  cardType?: string | null;
  cardIssuer?: string | null;
  cardInternational?: boolean | null;
  cardEmi?: boolean | null;
  bankName?: string | null;
  bankRrn?: string | null;
  bankAuthCode?: string | null;
  vpa?: string | null;
  wallet?: string | null;
  payerName?: string | null;
  payerEmail?: string | null;
  payerContact?: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  errorSource?: string | null;
  errorStep?: string | null;
  errorReason?: string | null;
  rzpCreatedAt?: string | null;
  rzpAuthorizedAt?: string | null;
  rzpCapturedAt?: string | null;
  rzpFailedAt?: string | null;
  refundId?: string | null;
  refundStatus?: string | null;
  refundAmountPaise?: number | null;
  refundInitiatedAt?: string | null;
  refundProcessedAt?: string | null;
  webhookEvent?: string | null;
  webhookReceivedAt?: string | null;
  webhookVerified?: boolean | null;
  apiSyncedAt?: string | null;
  apiEnrichmentStatus: string | null;
  apiEnrichmentError: string | null;
  receiptNumber?: string | null;
  createdAt: string;
  updatedAt: string;
  events: AttemptEvent[];
}

export interface RefundEvent {
  id: number;
  eventType: string;
  localStatus: string | null;
  providerStatus: string | null;
  amountPaise: number | null;
  source: string;
  razorpayRefundId: string | null;
  occurredAt: string | null;
  providerOccurredAt: string | null;
  recordedAt: string;
}

export interface Refund {
  id: number;
  paymentRecordId: number;
  razorpayRefundId: string | null;
  requestedAmountPaise: number;
  processedAmountPaise: number | null;
  currency: string;
  reasonCode: string | null;
  reasonText: string | null;
  internalNote?: string | null;
  localStatus: string;
  providerStatus: string | null;
  origin?: string;
  requestedAt: string;
  providerCreatedAt?: string | null;
  providerProcessedAt: string | null;
  failureCode?: string | null;
  failureMessage: string | null;
  requestedByName?: string | null;
  events?: RefundEvent[];
}

export interface WebhookEvent {
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
  payload?: unknown; // NEVER rendered
}

export interface WebhookProcessingEvent {
  id: number;
  webhookDeliveryId: number;
  status: string;
  error: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  action: string;
  actorName: string | null;
  actorId: number | null;
  ipAddress?: string | null; // NEVER rendered
  description: string | null;
  createdAt: string;
}

export interface TransactionAuditDetail {
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
    academicSessionName?: string | null;
    sessionId?: number | null;
    notes: string | null;
    invoiceNumber: string | null;
    receiptNumber?: string | null;
    frequency: string | null;
    feePeriodStart: string | null;
    feePeriodEnd: string | null;
    lateFeeConfig: LateFeeConfig | null;
    createdAt: string;
    createdBy: number | null;
    createdByName?: string | null;
    breakdown: Array<{ name: string; purpose: string; amount: number }>;
    /** Immutable snapshot frozen at invoice creation. Optional because pre-migration rows lack it. */
    breakdownSnapshot?: Array<{ name: string; purpose: string; amount: number }> | null;
    /** Immutable concession snapshot frozen at invoice creation. Optional. */
    concessionSnapshot?: unknown | null;
  };
  payments: PaymentRecord[];
  payment: PaymentRecord | null;
  refundSummary?: {
    grossCapturedPaise: number;
    processedRefundedPaise: number;
    netRetainedPaise: number;
    remainingRefundablePaise: number;
  };
  refunds?: Refund[];
  paymentAttempts: PaymentAttempt[];
  webhookEvents: WebhookEvent[];
  webhookProcessingEvents: WebhookProcessingEvent[];
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
  auditEntries: AuditEntry[];
}

// ─── Masking helpers (exported for tests) ────────────────────────────────────

/** Masks a UPI VPA: shows first 2 chars, masks middle, shows @domain */
export function maskVpa(vpa: string | null | undefined): string {
  if (!vpa) return "Unavailable";
  const at = vpa.indexOf("@");
  if (at <= 0) return "****" + (vpa.slice(-2) || "");
  const local = vpa.slice(0, at);
  const domain = vpa.slice(at);
  if (local.length <= 3) return "***" + domain;
  return local.slice(0, 2) + "***" + domain;
}

/** Masks an email: shows first 2 chars of local + domain TLD */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "Unavailable";
  const at = email.indexOf("@");
  if (at <= 0) return "****@***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dotIdx = domain.lastIndexOf(".");
  const tld = dotIdx >= 0 ? domain.slice(dotIdx) : "";
  const domainMasked = dotIdx >= 0 ? domain.slice(0, Math.min(2, dotIdx)) + "***" + tld : "***";
  return local.slice(0, 2) + "***@" + domainMasked;
}

/** Masks a phone/contact: shows last 4 digits, masks the rest */
export function maskContact(contact: string | null | undefined): string {
  if (!contact) return "Unavailable";
  const digits = contact.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return "****" + digits.slice(-4);
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function fmtINR(rupees: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(rupees);
}

export function paise(rupees: number): number {
  return Math.round(rupees * 100);
}

function fmtPaise(p: number): string {
  return fmtINR(p / 100);
}

function esc(value: unknown): string {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeCorrectionValues(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      /(signature|payload|rawresponse|idempotency|password|credential|secret|token|ipaddress)/.test(
        normalized,
      )
    ) {
      output[key] = "[REDACTED]";
    } else if (/(vpa|upiid)/.test(normalized)) {
      output[key] = maskVpa(typeof value === "string" ? value : null);
    } else if (normalized.includes("email")) {
      output[key] = maskEmail(typeof value === "string" ? value : null);
    } else if (/(phone|contact)/.test(normalized)) {
      output[key] = maskContact(typeof value === "string" ? value : null);
    } else if (Array.isArray(value)) {
      output[key] = value.map((item) =>
        item && typeof item === "object"
          ? Array.isArray(item)
            ? item.map((nested) =>
              nested && typeof nested === "object"
                ? sanitizeCorrectionValues(nested as Record<string, unknown>)
                : nested,
            )
            : sanitizeCorrectionValues(item as Record<string, unknown>)
          : item,
      );
    } else if (value && typeof value === "object") {
      output[key] = sanitizeCorrectionValues(value as Record<string, unknown>);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function val(value: unknown, fallback = "Unavailable"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return esc(value);
}

/** Format an instant (timestamp) with IST — uses formatInstantIST from shared */
function fmtInstant(value: InstantValue): string {
  const formatted = formatInstantIST(value);
  return formatted === "—" ? "Unavailable" : formatted;
}

function instantMillis(value: InstantValue): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = value instanceof Date
    ? value
    : new Date(String(value).replace(" ", "T"));
  const millis = date.getTime();
  return Number.isNaN(millis) ? Number.POSITIVE_INFINITY : millis;
}

/** Format a DATE-only value — never parse as timestamp */
function fmtDate(value: string | null | undefined): string {
  const formatted = formatDateOnly(value);
  return formatted === "—" ? "Unavailable" : formatted;
}

function linkedAttempt(
  detail: TransactionAuditDetail,
  payment: PaymentRecord,
): PaymentAttempt | undefined {
  return detail.paymentAttempts.find(
    (attempt) =>
      attempt.paymentRecordId === payment.id
      || (
        payment.razorpayPaymentId != null
        && attempt.razorpayPaymentId === payment.razorpayPaymentId
      ),
  );
}

function capturedInstant(attempt: PaymentAttempt | undefined): InstantValue {
  if (!attempt) return null;
  if (attempt.rzpCapturedAt) return attempt.rzpCapturedAt;
  const capturedEvent = attempt.events.find((event) =>
    /captur|payment_paid/.test(event.eventType.toLowerCase()),
  );
  return capturedEvent
    ? capturedEvent.providerOccurredAt
      ?? capturedEvent.occurredAt
      ?? capturedEvent.recordedAt
    : null;
}

function authoritativePaidInstant(
  detail: TransactionAuditDetail,
): InstantValue {
  const instants = detail.paymentAttempts
    .map((attempt) => capturedInstant(attempt))
    .filter((value): value is string | Date => Boolean(value))
    .sort((a, b) => instantMillis(a) - instantMillis(b));
  return instants.at(-1) ?? null;
}

function badge(text: string, cls: string): string {
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

function statusBadge(status: string | null | undefined): string {
  if (!status) return `<span class="na">Unavailable</span>`;
  const s = status.toLowerCase();
  let cls = "badge-gray";
  if (s === "captured" || s === "paid" || s === "processed" || s === "settled") cls = "badge-green";
  else if (s === "authorized") cls = "badge-blue";
  else if (s === "failed" || s === "failed_" || s === "overdue") cls = "badge-red";
  else if (s === "pending" || s === "requested" || s === "created") cls = "badge-amber";
  else if (s === "refunded" || s.includes("refund")) cls = "badge-purple";
  return badge(status, cls);
}

function row(label: string, value: string, labelWidth = "38%"): string {
  return `<tr><td class="lbl" style="width:${labelWidth}">${esc(label)}</td><td class="val">${value}</td></tr>`;
}

function sectionHeader(num: number, title: string): string {
  return `<div class="section-title"><span class="section-num">${num}</span>${esc(title)}</div>`;
}

function openSection(num: number, title: string): string {
  return `<div class="section">${sectionHeader(num, title)}<table>`;
}

function closeSection(): string {
  return `</table></div>`;
}

function noDataRow(msg = "No records."): string {
  return `<tr><td colspan="2" class="na">${esc(msg)}</td></tr>`;
}

// ─── Timeline helpers ─────────────────────────────────────────────────────────

interface TimelineEvent {
  /** Best timestamp to use for sorting and display */
  ts: InstantValue;
  label: string;
  detail?: string;
  badge?: string;
  badgeCls?: string;
}

function renderTimeline(events: TimelineEvent[]): string {
  if (events.length === 0) return `<p class="na" style="margin:8px 14px;">No timeline events found.</p>`;
  return `
    <div class="timeline">
      ${events
        .map(
          (e) => `
        <div class="tl-item">
          <div class="tl-dot"></div>
          <div class="tl-body">
            <div class="tl-time">${fmtInstant(e.ts)}</div>
            <div class="tl-label">${esc(e.label)}${e.badge ? ` ${badge(e.badge, e.badgeCls ?? "badge-gray")}` : ""}</div>
            ${e.detail ? `<div class="tl-detail">${esc(e.detail)}</div>` : ""}
          </div>
        </div>`,
        )
        .join("")}
    </div>`;
}

// ─── Section renderers ────────────────────────────────────────────────────────

function renderSection1(detail: TransactionAuditDetail): string {
  const { feeRecord, payment, payments } = detail;
  const totalCharged = feeRecord.amount + feeRecord.lateFeeAmount;
  const grossReceived = payments.reduce((s, p) => s + p.amount, 0);
  const processedRefundedPaise = (detail.refunds ?? [])
    .filter((refund) => refund.localStatus === "processed")
    .reduce(
      (sum, refund) =>
        sum + (refund.processedAmountPaise ?? refund.requestedAmountPaise),
      0,
    );
  const netRetainedPaise = Math.max(
    0,
    paise(grossReceived) - processedRefundedPaise,
  );
  const outstandingPaise = Math.max(
    0,
    paise(totalCharged) - netRetainedPaise,
  );
  const primaryPayment = payment ?? (payments.length > 0 ? payments[0] : null);
  const gatewayStatus = primaryPayment?.gatewayStatus ?? null;
  const paidInstant = authoritativePaidInstant(detail);

  let html = openSection(1, "Transaction Summary");
  html += row("School", val(detail.school.name));
  html += row("Invoice Number", val(feeRecord.invoiceNumber));
  html += row("Fee Record ID", val(feeRecord.id));
  html += row("Fee Name / Type", `${esc(feeRecord.feeName)} / ${esc(feeRecord.feeType)}`);
  html += row(
    "Academic Session",
    val(feeRecord.academicSessionName ?? feeRecord.academicYear),
  );
  html += row("Fee Status", statusBadge(feeRecord.status));
  html += row("Total Charged (Fee + Late Fee)", fmtINR(totalCharged));
  html += row("Gross Received (sum of payments)", fmtINR(grossReceived));
  html += row("Processed Refunds", fmtPaise(processedRefundedPaise));
  html += row("Net Retained", fmtPaise(netRetainedPaise));
  html += row("Outstanding Balance", fmtPaise(outstandingPaise));
  html += row(
    "Gateway / Provider Status",
    gatewayStatus ? statusBadge(gatewayStatus) : `<span class="na">Unavailable</span>`,
  );
  html += row("Primary Receipt Number", val(primaryPayment?.receiptNumber));
  html += row("Due Date", fmtDate(feeRecord.dueDate));
  html += row(
    "Paid Date & Time (authoritative)",
    paidInstant ? fmtInstant(paidInstant) : "Unavailable",
  );
  html += row("Paid Date (calendar field)", fmtDate(feeRecord.paidDate));
  html += closeSection();
  return html;
}

function renderSection2(detail: TransactionAuditDetail): string {
  const { feeRecord } = detail;
  const totalCharged = feeRecord.amount + feeRecord.lateFeeAmount;

  let html = openSection(2, "Fee & Invoice Details");
  html += row("Fee Record ID", val(feeRecord.id));
  html += row("Invoice Number", val(feeRecord.invoiceNumber));
  html += row("Fee Name", val(feeRecord.feeName));
  html += row("Fee Type", val(feeRecord.feeType));
  html += row(
    "Academic Session",
    val(feeRecord.academicSessionName ?? feeRecord.academicYear),
  );
  html += row("Session ID", val(feeRecord.sessionId));
  html += row("Frequency", val(feeRecord.frequency));
  html += row("Fee Period Start", fmtDate(feeRecord.feePeriodStart));
  html += row("Fee Period End", fmtDate(feeRecord.feePeriodEnd));
  html += row("Base Fee Amount", fmtINR(feeRecord.amount));
  html += row(
    "Late Fee Amount",
    feeRecord.lateFeeAmount > 0 ? fmtINR(feeRecord.lateFeeAmount) : "—",
  );
  html += row("Total Charged", fmtINR(totalCharged));
  html += row("Due Date", fmtDate(feeRecord.dueDate));
  const paidInstant = authoritativePaidInstant(detail);
  html += row(
    "Paid Date & Time (authoritative)",
    paidInstant ? fmtInstant(paidInstant) : "Unavailable",
  );
  html += row("Paid Date (calendar field)", fmtDate(feeRecord.paidDate));
  html += row("Status", statusBadge(feeRecord.status));
  html += row("Created At", fmtInstant(feeRecord.createdAt));
  html += row("Created By", val(feeRecord.createdByName ?? feeRecord.createdBy));
  html += row("Receipt Number", val(feeRecord.receiptNumber));
  html += row("Notes", val(feeRecord.notes));

  // Immutable breakdown snapshot
  const snapshot = feeRecord.breakdownSnapshot ?? feeRecord.breakdown;
  if (Array.isArray(snapshot) && snapshot.length > 0) {
    html += `<tr><td colspan="2" class="subsection-hdr">Invoice Breakdown (Immutable Snapshot)</td></tr>`;
    for (const item of snapshot) {
      html += row(`  ${item.name}`, `${esc(item.purpose ?? "")} — ${fmtINR(item.amount)}`);
    }
  } else {
    html += `<tr><td colspan="2" class="na" style="font-size:11px;">Breakdown snapshot not available (pre-migration record).</td></tr>`;
  }

  // Concession snapshot — only if explicitly present
  if (feeRecord.concessionSnapshot != null) {
    html += `<tr><td colspan="2" class="subsection-hdr">Concession Snapshot</td></tr>`;
    html += `<tr><td colspan="2"><pre class="pre">${esc(JSON.stringify(feeRecord.concessionSnapshot, null, 2))}</pre></td></tr>`;
  } else {
    html += row("Historical Concession / Original Values", "Unavailable");
  }

  // Late fee config
  if (feeRecord.lateFeeConfig) {
    html += `<tr><td colspan="2" class="subsection-hdr">Late Fee Configuration</td></tr>`;
    const lfc = feeRecord.lateFeeConfig;
    html += row("  Type", val(lfc.type));
    if (lfc.grace_period_days != null) html += row("  Grace Period (days)", val(lfc.grace_period_days));
    if (lfc.flat_amount != null) html += row("  Flat Amount", fmtINR(lfc.flat_amount));
    if (lfc.daily_rate != null) html += row("  Daily Rate (₹)", fmtINR(lfc.daily_rate));
    if (lfc.max_cap != null) html += row("  Maximum Cap", fmtINR(lfc.max_cap));
  }

  html += closeSection();
  return html;
}

function renderSection3(detail: TransactionAuditDetail): string {
  const { student } = detail;
  let html = openSection(3, "Student Details");
  html += row("Student Name", val(student.name));
  html += row("Digital Student ID (DSID)", val(student.digitalStudentId));
  html += row("Class", val(student.class));
  html += row("Section", val(student.section));
  html += row("Roll Number", val(student.rollNumber));
  html += row("Guardian Name", val(student.guardianName));
  // Masked sensitive fields
  html += row("Phone (masked)", maskContact(student.phone));
  html += row("Email (masked)", maskEmail(student.email));
  html += closeSection();
  return html;
}

function renderSection4(detail: TransactionAuditDetail): string {
  const { payments } = detail;
  let html = `<div class="section">${sectionHeader(4, `Payment Details (${payments.length} payment record${payments.length !== 1 ? "s" : ""})`)}<table>`;

  if (payments.length === 0) {
    html += noDataRow("No payment records found for this fee.");
  } else {
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i]!;
      const attempt = linkedAttempt(detail, p);
      const authoritativeCaptureAt = capturedInstant(attempt);
      const isOnline =
        p.paymentMethod?.toLowerCase().includes("portal") ||
        p.paymentMethod?.toLowerCase() === "online" ||
        !!p.razorpayPaymentId;

      html += `<tr class="payment-header">
        <td colspan="2" class="payment-hdr-cell">
          Payment ${payments.length > 1 ? `#${i + 1} of ${payments.length}` : ""}
          &nbsp;·&nbsp; ${esc(p.paymentMethod)}
          &nbsp;·&nbsp; ${fmtINR(p.amount)}
          <span style="float:right;font-weight:400;color:#64748b">${fmtDate(p.receivedDate)}</span>
        </td>
      </tr>`;
      html += row("Payment Record ID", val(p.id));
      html += row("Linked Attempt ID", val(attempt?.id));
      html += row("Linked Attempt Number", val(attempt?.attemptNumber));
      html += row("Amount", fmtINR(p.amount));
      html += row(
        "Requested Amount",
        attempt?.amountPaise != null
          ? fmtPaise(attempt.amountPaise)
          : "Unavailable",
      );
      html += row(
        "Captured Amount",
        attempt?.amountCapturedPaise != null
          ? fmtPaise(attempt.amountCapturedPaise)
          : "Unavailable",
      );
      html += row("Late Fee Paid", p.lateFeePaid && p.lateFeePaid > 0 ? fmtINR(p.lateFeePaid) : "—");
      html += row("Received Date", fmtDate(p.receivedDate));
      html += row(
        "Payment Date & Time (authoritative)",
        authoritativeCaptureAt
          ? fmtInstant(authoritativeCaptureAt)
          : "Unavailable",
      );
      html += row("Payment Method", val(p.paymentMethod));
      html += row("Receipt Number", val(p.receiptNumber));
      html += row("Invoice Number", val(p.invoiceNumber));
      html += row("Payment Record Created At", fmtInstant(p.createdAt));
      html += row("Recorded By", val(p.recordedByName));

      if (isOnline) {
        html += `<tr><td colspan="2" class="subsection-hdr">Online / Gateway Fields</td></tr>`;
        html += row("Razorpay Payment ID", val(p.razorpayPaymentId));
        html += row("Razorpay Order ID", val(p.razorpayOrderId));
        // razorpaySignature NEVER rendered
        html += row("Payment Mode", val(p.paymentMode));
        html += row("Bank", val(p.bankName));
        html += row(
          "Card (last 4 / network)",
          (attempt?.cardLast4 ?? p.cardLast4)
            ? `●●●● ${esc(attempt?.cardLast4 ?? p.cardLast4)}${
              attempt?.cardNetwork ? ` · ${esc(attempt.cardNetwork)}` : ""
            }`
            : "Unavailable",
        );
        html += row("UPI VPA (masked)", maskVpa(p.vpa));
        html += row("Payer Name", val(p.payerName));
        html += row("Payer Email (masked)", maskEmail(p.payerEmail));
        html += row("Payer Contact (masked)", maskContact(p.payerContact));
        // NEVER default missing gateway status to "captured"
        html += row(
          "Gateway Status",
          p.gatewayStatus ? statusBadge(p.gatewayStatus) : `<span class="na">Unavailable</span>`,
        );
        html += row(
          "Gateway Fee",
          attempt?.razorpayFeePaise != null
            ? fmtPaise(attempt.razorpayFeePaise)
            : "Unavailable",
        );
        html += row(
          "Gateway Tax",
          attempt?.razorpayTaxPaise != null
            ? fmtPaise(attempt.razorpayTaxPaise)
            : "Unavailable",
        );
        html += row("Bank RRN", val(attempt?.bankRrn));
        html += row("Bank Authorization Code", val(attempt?.bankAuthCode));
      } else {
        html += `<tr><td colspan="2" class="subsection-hdr">Offline Payment Fields</td></tr>`;
        html += row("Reference Number", val(p.referenceNumber));
        html += row("Instrument Date", fmtDate(p.instrumentDate));
        html += row("Branch Name", val(p.branchName));
      }

      html += row("Cashier Notes", val(p.cashierNotes));

      // Denomination breakdown (cash)
      if (p.denominationBreakdown && Object.keys(p.denominationBreakdown).length > 0) {
        html += `<tr><td colspan="2" class="subsection-hdr">Cash Denomination Breakdown</td></tr>`;
        for (const [denom, count] of Object.entries(p.denominationBreakdown)) {
          html += row(`  ₹${esc(denom)} × ${esc(count)}`, fmtINR(Number(denom) * count));
        }
      }

      // Offline detail
      if (p.offlineDetail) {
        html += `<tr><td colspan="2" class="subsection-hdr">Offline Payment Detail</td></tr>`;
        const od = p.offlineDetail;
        html += row(
          "  Offline Transaction Date & Time",
          od.transactionTime
            ? `${fmtDate(p.receivedDate)} ${esc(od.transactionTime)} (recorded local time)`
            : "Unavailable",
        );
        html += row("  Instrument Status", val(od.instrumentStatus));
        html += row("  Transfer Mode", val(od.transferMode));
        html += row("  Transaction Reference", val(od.transactionReference));
        html += row("  Receiving Bank", val(od.receivingBank));
        if (od.receiverUpiId) html += row("  Receiver UPI ID", maskVpa(od.receiverUpiId));
        html += row("  Payee Name", val(od.payeeName));
        html += row("  Payable At", val(od.payableAt));
        html += row("  Collection Location", val(od.collectionLocation));
        if (od.depositDate) html += row("  Deposit Date", fmtDate(od.depositDate));
        html += row("  Deposit Bank", val(od.depositBank));
        html += row("  Deposit Reference", val(od.depositReference));
        if (od.returnDate) html += row("  Return Date", fmtDate(od.returnDate));
        html += row("  Return Reason", val(od.returnReason));
      }

      // Correction history
      if (p.corrections && p.corrections.length > 0) {
        html += `<tr><td colspan="2" class="subsection-hdr">Correction History (${p.corrections.length})</td></tr>`;
        for (const c of p.corrections) {
          const previousValues = sanitizeCorrectionValues(c.previousValues);
          const newValues = sanitizeCorrectionValues(c.newValues);
          html += `<tr><td class="lbl">${fmtInstant(c.createdAt)}<br><small>${esc(c.changedByName ?? "System")}</small></td>
            <td class="val"><strong>Reason:</strong> ${esc(c.reason)}<br>
            <small>Previous: ${esc(JSON.stringify(previousValues))}</small><br>
            <small>New: ${esc(JSON.stringify(newValues))}</small></td></tr>`;
        }
      }
    }
  }

  html += closeSection();
  return html;
}

function renderSection5(detail: TransactionAuditDetail): string {
  const gatewayAttempts = detail.paymentAttempts.filter(
    (attempt) =>
      Boolean(attempt.razorpayPaymentId)
      || Boolean(attempt.razorpayOrderId)
      || attempt.source === "webhook",
  );
  let html = openSection(5, "Razorpay / Gateway Details");

  if (gatewayAttempts.length === 0) {
    html += noDataRow(
      "No online/Razorpay gateway attempts associated with this fee record.",
    );
  } else {
    for (const attempt of gatewayAttempts) {
      html += `<tr class="payment-header"><td colspan="2" class="payment-hdr-cell">
        Attempt ${attempt.attemptNumber ?? "—"} (ID: ${attempt.id})
        &nbsp;·&nbsp; ${statusBadge(attempt.outcome)}
        ${attempt.amountPaise != null ? `&nbsp;·&nbsp; ${fmtPaise(attempt.amountPaise)}` : ""}
      </td></tr>`;
      html += row("Linked Payment Record ID", val(attempt.paymentRecordId));
      html += row("Razorpay Payment ID", val(attempt.razorpayPaymentId));
      html += row("Razorpay Order ID", val(attempt.razorpayOrderId));
      html += row("Gateway Outcome", statusBadge(attempt.outcome));
      html += row("Payment Method", val(attempt.paymentMethod));
      html += row(
        "Requested Amount",
        attempt.amountPaise != null ? fmtPaise(attempt.amountPaise) : "Unavailable",
      );
      html += row(
        "Captured Amount",
        attempt.amountCapturedPaise != null
          ? fmtPaise(attempt.amountCapturedPaise)
          : "Unavailable",
      );
      html += row(
        "Gateway Fee",
        attempt.razorpayFeePaise != null
          ? fmtPaise(attempt.razorpayFeePaise)
          : "Unavailable",
      );
      html += row(
        "Gateway Tax",
        attempt.razorpayTaxPaise != null
          ? fmtPaise(attempt.razorpayTaxPaise)
          : "Unavailable",
      );
      html += row("Bank", val(attempt.bankName));
      html += row("Bank RRN", val(attempt.bankRrn));
      html += row("Bank Authorization Code", val(attempt.bankAuthCode));
      html += row(
        "Card (last 4 / network)",
        attempt.cardLast4
          ? `●●●● ${esc(attempt.cardLast4)}${
            attempt.cardNetwork ? ` · ${esc(attempt.cardNetwork)}` : ""
          }`
          : "Unavailable",
      );
      html += row("Card Type", val(attempt.cardType));
      html += row("Card Issuer", val(attempt.cardIssuer));
      html += row(
        "International Card",
        attempt.cardInternational == null
          ? "Unavailable"
          : attempt.cardInternational ? "Yes" : "No",
      );
      html += row(
        "EMI",
        attempt.cardEmi == null ? "Unavailable" : attempt.cardEmi ? "Yes" : "No",
      );
      html += row("UPI VPA (masked)", maskVpa(attempt.vpa));
      html += row("Wallet", val(attempt.wallet));
      html += row("Payer Name", val(attempt.payerName));
      html += row("Payer Email (masked)", maskEmail(attempt.payerEmail));
      html += row("Payer Contact (masked)", maskContact(attempt.payerContact));
      html += row("Provider Created At", fmtInstant(attempt.rzpCreatedAt));
      html += row("Authorized At", fmtInstant(attempt.rzpAuthorizedAt));
      html += row("Captured At", fmtInstant(attempt.rzpCapturedAt));
      html += row("Failed At", fmtInstant(attempt.rzpFailedAt));
      // Signature / HMAC / raw_response / idempotency keys: NEVER rendered
    }
  }

  html += closeSection();
  return html;
}

function renderSection6(detail: TransactionAuditDetail): string {
  const { paymentAttempts } = detail;
  let html = `<div class="section">${sectionHeader(6, `Complete Payment Attempt History (${paymentAttempts.length} attempt${paymentAttempts.length !== 1 ? "s" : ""})`)}<table>`;

  if (paymentAttempts.length === 0) {
    html += noDataRow("No payment attempts recorded.");
  } else {
    for (const attempt of paymentAttempts) {
      html += `<tr class="payment-header"><td colspan="2" class="payment-hdr-cell">
        Attempt ${attempt.attemptNumber ?? "—"} (ID: ${attempt.id})
        &nbsp;·&nbsp; ${esc(attempt.outcome)}
        &nbsp;·&nbsp; ${esc(attempt.source)}
        ${attempt.amountPaise != null ? `&nbsp;·&nbsp; ${fmtPaise(attempt.amountPaise)}` : ""}
      </td></tr>`;
      html += row("Attempt ID", val(attempt.id));
      html += row("Linked Payment Record ID", val(attempt.paymentRecordId));
      html += row("Attempt Number", val(attempt.attemptNumber));
      html += row("Outcome", statusBadge(attempt.outcome));
      html += row("Source", val(attempt.source));
      html += row("Razorpay Payment ID", val(attempt.razorpayPaymentId));
      html += row("Razorpay Order ID", val(attempt.razorpayOrderId));
      html += row("Amount", attempt.amountPaise != null ? fmtPaise(attempt.amountPaise) : "Unavailable");
      html += row(
        "Amount Captured",
        attempt.amountCapturedPaise != null
          ? fmtPaise(attempt.amountCapturedPaise)
          : "Unavailable",
      );
      html += row(
        "Amount Refunded",
        attempt.amountRefundedPaise != null
          ? fmtPaise(attempt.amountRefundedPaise)
          : "Unavailable",
      );
      html += row("Currency", val(attempt.currency));
      html += row("Payment Method", val(attempt.paymentMethod));
      html += row(
        "Card (last 4 / network)",
        attempt.cardLast4
          ? `●●●● ${esc(attempt.cardLast4)}${
            attempt.cardNetwork ? ` · ${esc(attempt.cardNetwork)}` : ""
          }`
          : "Unavailable",
      );
      html += row("Bank", val(attempt.bankName));
      html += row("Bank RRN", val(attempt.bankRrn));
      html += row("Bank Authorization Code", val(attempt.bankAuthCode));
      html += row("UPI VPA (masked)", maskVpa(attempt.vpa));
      html += row("Wallet", val(attempt.wallet));
      html += row("Payer Email (masked)", maskEmail(attempt.payerEmail));
      html += row("Payer Contact (masked)", maskContact(attempt.payerContact));
      html += row("Error Code", val(attempt.errorCode));
      html += row("Error Description", val(attempt.errorDescription));
      html += row("Error Source", val(attempt.errorSource));
      html += row("Error Step", val(attempt.errorStep));
      html += row("Error Reason", val(attempt.errorReason));
      html += row("Provider Created At", fmtInstant(attempt.rzpCreatedAt));
      html += row("Authorized At", fmtInstant(attempt.rzpAuthorizedAt));
      html += row("Captured At", fmtInstant(attempt.rzpCapturedAt));
      html += row("Failed At", fmtInstant(attempt.rzpFailedAt));
      html += row("Refund ID", val(attempt.refundId));
      html += row("Refund Status", val(attempt.refundStatus));
      html += row(
        "Refund Amount",
        attempt.refundAmountPaise != null
          ? fmtPaise(attempt.refundAmountPaise)
          : "Unavailable",
      );
      html += row("Refund Initiated At", fmtInstant(attempt.refundInitiatedAt));
      html += row("Refund Processed At", fmtInstant(attempt.refundProcessedAt));
      html += row("Webhook Event", val(attempt.webhookEvent));
      html += row("Webhook Received At", fmtInstant(attempt.webhookReceivedAt));
      html += row(
        "Webhook Verified",
        attempt.webhookVerified == null
          ? "Unavailable"
          : attempt.webhookVerified ? "Yes" : "No",
      );
      html += row("API Synced At", fmtInstant(attempt.apiSyncedAt));
      html += row("API Enrichment Status", val(attempt.apiEnrichmentStatus));
      html += row("API Enrichment Error", val(attempt.apiEnrichmentError));
      html += row("Created At", fmtInstant(attempt.createdAt));
      html += row("Updated At", fmtInstant(attempt.updatedAt));

      if (attempt.events.length > 0) {
        html += `<tr><td colspan="2" class="subsection-hdr">Attempt Events (${attempt.events.length})</td></tr>`;
        for (const ev of attempt.events) {
          // Use providerOccurredAt as authoritative lifecycle time when available
          const displayTime = ev.providerOccurredAt ?? ev.occurredAt ?? ev.recordedAt;
          html += `<tr>
            <td class="lbl">${fmtInstant(displayTime)}<br>
              <small>${esc(ev.source)}${ev.historical ? " · historical" : ""}</small>
            </td>
            <td class="val">
              <strong>${esc(ev.eventType)}</strong>
              ${ev.outcome ? ` ${statusBadge(ev.outcome)}` : ""}
              ${ev.amountPaise != null ? ` — ${fmtPaise(ev.amountPaise)}` : ""}
              ${ev.razorpayPaymentId ? `<br><small>pay_id: ${esc(ev.razorpayPaymentId)}</small>` : ""}
              ${ev.razorpayOrderId ? `<br><small>order_id: ${esc(ev.razorpayOrderId)}</small>` : ""}
              ${ev.refundId ? `<br><small>refund_id: ${esc(ev.refundId)}</small>` : ""}
              ${ev.webhookEventId != null ? `<br><small>webhook_event_id: ${ev.webhookEventId}</small>` : ""}
            </td>
          </tr>`;
          // payload: NEVER rendered
        }
      }
    }
  }

  html += closeSection();
  return html;
}

function renderSection7(detail: TransactionAuditDetail): string {
  // Build a comprehensive chronological timeline from all event sources
  interface RawEvent {
    ts: InstantValue;
    label: string;
    detail?: string;
    badge?: string;
    badgeCls?: string;
  }

  const events: RawEvent[] = [];

  // Fee record created
  events.push({
    ts: detail.feeRecord.createdAt,
    label: "Fee record created",
    detail: `Invoice: ${detail.feeRecord.invoiceNumber ?? "—"}`,
  });

  // Payment records
  for (const p of detail.payments) {
    // Use createdAt as the lifecycle instant; receivedDate is DATE-only
    events.push({
      ts: p.createdAt,
      label: `Payment recorded — ${p.paymentMethod} — ${fmtINR(p.amount)}`,
      detail: p.receiptNumber ? `Receipt: ${p.receiptNumber}` : undefined,
      badge: p.gatewayStatus ?? undefined,
      badgeCls: p.gatewayStatus ? "badge-green" : undefined,
    });
  }

  // Attempt events — use providerOccurredAt as the authoritative lifecycle timestamp
  for (const attempt of detail.paymentAttempts) {
    events.push({
      ts: attempt.createdAt,
      label: `Attempt ${attempt.attemptNumber ?? "?"} record created`,
      detail: attempt.razorpayOrderId ? `order: ${attempt.razorpayOrderId}` : undefined,
      badge: attempt.outcome,
      badgeCls: attempt.outcome === "captured" ? "badge-green" : "badge-gray",
    });
    if (attempt.rzpCreatedAt) {
      events.push({
        ts: attempt.rzpCreatedAt,
        label: `Attempt ${attempt.attemptNumber ?? "?"}: provider payment created`,
        detail: attempt.razorpayPaymentId
          ? `pay: ${attempt.razorpayPaymentId}`
          : undefined,
      });
    }
    if (attempt.rzpAuthorizedAt) {
      events.push({
        ts: attempt.rzpAuthorizedAt,
        label: `Attempt ${attempt.attemptNumber ?? "?"}: payment authorized`,
        badge: "authorized",
        badgeCls: "badge-blue",
      });
    }
    if (attempt.rzpCapturedAt) {
      events.push({
        ts: attempt.rzpCapturedAt,
        label: `Attempt ${attempt.attemptNumber ?? "?"}: payment captured`,
        badge: "captured",
        badgeCls: "badge-green",
      });
    }
    if (attempt.rzpFailedAt) {
      events.push({
        ts: attempt.rzpFailedAt,
        label: `Attempt ${attempt.attemptNumber ?? "?"}: payment failed`,
        detail: attempt.errorDescription ?? attempt.errorCode ?? undefined,
        badge: "failed",
        badgeCls: "badge-red",
      });
    }
    if (attempt.refundInitiatedAt) {
      events.push({
        ts: attempt.refundInitiatedAt,
        label: `Attempt ${attempt.attemptNumber ?? "?"}: refund initiated`,
        detail: attempt.refundId ? `refund: ${attempt.refundId}` : undefined,
        badge: attempt.refundStatus ?? "initiated",
        badgeCls: "badge-amber",
      });
    }
    if (attempt.refundProcessedAt) {
      events.push({
        ts: attempt.refundProcessedAt,
        label: `Attempt ${attempt.attemptNumber ?? "?"}: refund processed`,
        detail: attempt.refundId ? `refund: ${attempt.refundId}` : undefined,
        badge: "processed",
        badgeCls: "badge-green",
      });
    }

    for (const ev of attempt.events) {
      const ts = ev.providerOccurredAt ?? ev.occurredAt ?? ev.recordedAt;
      events.push({
        ts,
        label: `${ev.eventType}`,
        detail: ev.razorpayPaymentId ? `pay: ${ev.razorpayPaymentId}` : undefined,
        badge: ev.outcome ?? undefined,
        badgeCls: ev.outcome === "captured" ? "badge-green" : ev.outcome === "failed" ? "badge-red" : "badge-gray",
      });
    }
  }

  // Webhook events — use providerOccurredAt when available, else receivedAt
  for (const wh of detail.webhookEvents) {
    const ts = wh.providerOccurredAt ?? wh.receivedAt;
    events.push({
      ts,
      label: `Webhook: ${wh.eventType}`,
      detail: wh.razorpayPaymentId ? `pay: ${wh.razorpayPaymentId}` : wh.razorpayOrderId ? `order: ${wh.razorpayOrderId}` : undefined,
      badge: wh.processingStatus,
      badgeCls: wh.processingStatus === "processed" ? "badge-green" : "badge-amber",
    });
  }

  // Refund events
  for (const refund of detail.refunds ?? []) {
    events.push({
      ts: refund.requestedAt,
      label: `Refund requested — ${fmtPaise(refund.requestedAmountPaise)}`,
      badge: refund.localStatus,
      badgeCls: refund.localStatus === "processed" ? "badge-green" : "badge-amber",
    });
    if (refund.providerProcessedAt) {
      events.push({
        ts: refund.providerProcessedAt,
        label: `Refund processed — ${fmtPaise(refund.processedAmountPaise ?? refund.requestedAmountPaise)}`,
        badge: "processed",
        badgeCls: "badge-green",
      });
    }
    for (const rev of refund.events ?? []) {
      const ts = rev.providerOccurredAt ?? rev.occurredAt ?? rev.recordedAt;
      events.push({
        ts,
        label: `Refund event: ${rev.eventType}`,
        badge: rev.localStatus ?? undefined,
        badgeCls: rev.localStatus === "processed" ? "badge-green" : "badge-amber",
      });
    }
  }

  // Audit entries
  for (const ae of detail.auditEntries) {
    events.push({
      ts: ae.createdAt,
      label: `Audit: ${ae.action}`,
      detail: ae.description ?? undefined,
    });
  }

  // Sort chronologically; null/undefined timestamps go last
  events.sort((a, b) => instantMillis(a.ts) - instantMillis(b.ts));

  let html = `<div class="section">${sectionHeader(7, "Payment Lifecycle Timeline")}`;
  html += renderTimeline(
    events.map((e) => ({
      ts: e.ts,
      label: e.label,
      detail: e.detail,
      badge: e.badge,
      badgeCls: e.badgeCls,
    })),
  );
  html += `</div>`;
  return html;
}

function renderSection8(detail: TransactionAuditDetail): string {
  const refunds = detail.refunds ?? [];
  let html = `<div class="section">${sectionHeader(8, `Refund & Reversal Details (${refunds.length} refund${refunds.length !== 1 ? "s" : ""})`)}<table>`;

  if (refunds.length === 0) {
    html += noDataRow("No refunds or reversals on record.");
  } else {
    for (const refund of refunds) {
      html += `<tr class="payment-header"><td colspan="2" class="payment-hdr-cell">
        Refund #${refund.id} — ${statusBadge(refund.localStatus)}
        &nbsp;·&nbsp; Requested: ${fmtPaise(refund.requestedAmountPaise)}
        ${refund.processedAmountPaise != null ? `&nbsp;·&nbsp; Processed: ${fmtPaise(refund.processedAmountPaise)}` : ""}
      </td></tr>`;
      html += row("Refund ID", val(refund.id));
      html += row("Payment Record ID", val(refund.paymentRecordId));
      html += row("Razorpay Refund ID", val(refund.razorpayRefundId));
      html += row("Requested Amount", fmtPaise(refund.requestedAmountPaise));
      html += row(
        "Processed Amount",
        refund.processedAmountPaise != null ? fmtPaise(refund.processedAmountPaise) : "Unavailable",
      );
      html += row("Currency", val(refund.currency));
      html += row("Local Status", statusBadge(refund.localStatus));
      html += row("Provider Status", refund.providerStatus ? statusBadge(refund.providerStatus) : `<span class="na">Unavailable</span>`);
      html += row("Reason Code", val(refund.reasonCode));
      html += row("Reason Text", val(refund.reasonText));
      html += row("Requested At", fmtInstant(refund.requestedAt));
      html += row("Provider Created At", refund.providerCreatedAt ? fmtInstant(refund.providerCreatedAt) : "Unavailable");
      html += row("Provider Processed At", refund.providerProcessedAt ? fmtInstant(refund.providerProcessedAt) : "Unavailable");
      html += row("Failure Code", val(refund.failureCode));
      html += row("Failure Message", val(refund.failureMessage));
      html += row("Requested By", val(refund.requestedByName));

      // Refund events
      const revEvents = refund.events ?? [];
      if (revEvents.length > 0) {
        html += `<tr><td colspan="2" class="subsection-hdr">Refund Events (${revEvents.length})</td></tr>`;
        for (const ev of revEvents) {
          const ts = ev.providerOccurredAt ?? ev.occurredAt ?? ev.recordedAt;
          html += `<tr>
            <td class="lbl">${fmtInstant(ts)}<br><small>${esc(ev.source)}</small></td>
            <td class="val"><strong>${esc(ev.eventType)}</strong>
              ${ev.localStatus ? ` ${statusBadge(ev.localStatus)}` : ""}
              ${ev.amountPaise != null ? ` — ${fmtPaise(ev.amountPaise)}` : ""}
              ${ev.razorpayRefundId ? `<br><small>refund_id: ${esc(ev.razorpayRefundId)}</small>` : ""}
            </td>
          </tr>`;
        }
      }
    }
  }

  html += closeSection();
  return html;
}

function renderSection9(detail: TransactionAuditDetail): string {
  const { feeRecord, payments, refundSummary } = detail;
  const refunds = detail.refunds ?? [];

  const totalCharged = feeRecord.amount + feeRecord.lateFeeAmount;
  const grossReceivedRupees = payments.reduce((s, p) => s + p.amount, 0);
  const grossReceivedPaise = paise(grossReceivedRupees);

  // Only count localStatus === "processed" refunds — never pending/requested
  const processedRefunds = refunds.filter((r) => r.localStatus === "processed");
  const processedRefundedPaise = processedRefunds.reduce(
    (s, r) => s + (r.processedAmountPaise ?? r.requestedAmountPaise),
    0,
  );
  const netRetainedPaise = Math.max(0, grossReceivedPaise - processedRefundedPaise);
  const totalChargedPaise = paise(totalCharged);
  const outstandingPaise = Math.max(0, totalChargedPaise - netRetainedPaise);

  // If the route provides a refundSummary, use it for cross-check
  const serverGross = refundSummary?.grossCapturedPaise;
  const serverNet = refundSummary?.netRetainedPaise;
  const serverProcessedRefund = refundSummary?.processedRefundedPaise;

  let html = openSection(9, "Financial Reconciliation");
  html += row("Fee Base Amount", fmtINR(feeRecord.amount));
  html += row("Late Fee Amount", feeRecord.lateFeeAmount > 0 ? fmtINR(feeRecord.lateFeeAmount) : "—");
  html += row("Total Charged (Fee + Late Fee)", fmtINR(totalCharged));
  html += row("Number of Payment Records", val(payments.length));
  html += row("Gross Received (sum of payment records)", fmtPaise(grossReceivedPaise));
  html += row(
    `Processed Refunds (${processedRefunds.length} of ${refunds.length} refunds)`,
    fmtPaise(processedRefundedPaise),
  );
  html += row("Net Retained (Gross − Processed Refunds)", fmtPaise(netRetainedPaise));
  html += row("Outstanding (Total Charged − Net Retained)", fmtPaise(outstandingPaise));

  if (serverGross != null || serverNet != null) {
    html += `<tr><td colspan="2" class="subsection-hdr">Server-Side Reconciliation Cross-Check</td></tr>`;
    if (serverGross != null) html += row("  Server Gross Captured", fmtPaise(serverGross));
    if (serverProcessedRefund != null) html += row("  Server Processed Refunded", fmtPaise(serverProcessedRefund));
    if (serverNet != null) html += row("  Server Net Retained", fmtPaise(serverNet));
    if (refundSummary?.remainingRefundablePaise != null)
      html += row("  Remaining Refundable", fmtPaise(refundSummary.remainingRefundablePaise));
  }

  // Note about pending/requested refunds
  const pendingRefunds = refunds.filter((r) =>
    ["requested", "pending", "created", "reconciliation_required"].includes(r.localStatus),
  );
  if (pendingRefunds.length > 0) {
    const pendingTotal = pendingRefunds.reduce((s, r) => s + r.requestedAmountPaise, 0);
    html += `<tr><td colspan="2" class="na" style="font-size:11px;">
      Note: ${pendingRefunds.length} pending/requested refund(s) totalling ${fmtPaise(pendingTotal)} are NOT counted in processed refunds.
    </td></tr>`;
  }

  html += closeSection();
  return html;
}

function renderSection10(detail: TransactionAuditDetail): string {
  const { webhookEvents, webhookProcessingEvents } = detail;

  let html = `<div class="section">${sectionHeader(10, `Verification & Webhook Status (${webhookEvents.length} webhook event${webhookEvents.length !== 1 ? "s" : ""})`)}<table>`;

  if (detail.paymentAttempts.length > 0) {
    html += `<tr><td colspan="2" class="subsection-hdr">Attempt Verification & API Enrichment</td></tr>`;
    for (const attempt of detail.paymentAttempts) {
      html += `<tr class="payment-header"><td colspan="2" class="payment-hdr-cell">
        Attempt ${attempt.attemptNumber ?? "—"} (ID: ${attempt.id})
      </td></tr>`;
      html += row("Source", val(attempt.source));
      html += row(
        "Webhook Verified",
        attempt.webhookVerified == null
          ? "Unavailable"
          : attempt.webhookVerified
            ? badge("Verified", "badge-green")
            : badge("Not verified", "badge-red"),
      );
      html += row("Webhook Event", val(attempt.webhookEvent));
      html += row("Webhook Received At", fmtInstant(attempt.webhookReceivedAt));
      html += row("API Enrichment Status", val(attempt.apiEnrichmentStatus));
      html += row("API Synced At", fmtInstant(attempt.apiSyncedAt));
      html += row("API Enrichment Error", val(attempt.apiEnrichmentError));
    }
  }

  if (webhookEvents.length === 0) {
    html += noDataRow("No webhook events found for this fee record.");
  } else {
    for (const wh of webhookEvents) {
      const ts = wh.providerOccurredAt ?? wh.receivedAt;
      html += `<tr class="payment-header"><td colspan="2" class="payment-hdr-cell">
        Webhook #${wh.id} — ${esc(wh.eventType)}
        <span style="float:right;font-weight:400;">${fmtInstant(ts)}</span>
      </td></tr>`;
      html += row("Webhook Event ID", val(wh.id));
      html += row("Provider Event ID", val(wh.providerEventId));
      html += row("Event Type", val(wh.eventType));
      html += row("Razorpay Payment ID", val(wh.razorpayPaymentId));
      html += row("Razorpay Order ID", val(wh.razorpayOrderId));
      html += row("Razorpay Refund ID", val(wh.razorpayRefundId));
      html += row("Signature Verified", wh.signatureVerified ? badge("Verified", "badge-green") : badge("NOT Verified", "badge-red"));
      html += row("Verification Status", statusBadge(wh.verificationStatus));
      html += row("Processing Status", statusBadge(wh.processingStatus));
      html += row("Processing Error", val(wh.processingError));
      html += row("Provider Occurred At", fmtInstant(wh.providerOccurredAt));
      html += row("Received At", fmtInstant(wh.receivedAt));
      html += row("Last Received At", fmtInstant(wh.lastReceivedAt));
      html += row("Processed At", wh.processedAt ? fmtInstant(wh.processedAt) : "Unavailable");
      html += row("Delivery Count", val(wh.deliveryCount));
      html += row("Resolution Source", val(wh.resolutionSource));
      html += row("Resolution Status", statusBadge(wh.resolutionStatus));
      html += row("Resolution Reason", val(wh.resolutionReason));
      // payload: NEVER rendered

      // Processing events for this webhook
      const procEvs = webhookProcessingEvents.filter((pe) => pe.webhookDeliveryId === wh.id);
      if (procEvs.length > 0) {
        html += `<tr><td colspan="2" class="subsection-hdr">Processing Events (${procEvs.length})</td></tr>`;
        for (const pe of procEvs) {
          html += `<tr>
            <td class="lbl">${fmtInstant(pe.createdAt)}</td>
            <td class="val">${statusBadge(pe.status)}${pe.error ? ` — ${esc(pe.error)}` : ""}</td>
          </tr>`;
        }
      }
    }
  }

  html += closeSection();
  return html;
}

function renderSection11(detail: TransactionAuditDetail): string {
  // Complete audit timeline: all audit entries + refund events + attempt events, chronological
  interface AuditItem {
    ts: InstantValue;
    source: string;
    label: string;
    detail?: string;
  }

  const items: AuditItem[] = [];

  items.push({
    ts: detail.feeRecord.createdAt,
    source: detail.feeRecord.createdByName
      ?? (detail.feeRecord.createdBy != null
        ? `User ${detail.feeRecord.createdBy}`
        : "System"),
    label: "Invoice created",
    detail: detail.feeRecord.invoiceNumber
      ? `Invoice: ${detail.feeRecord.invoiceNumber}`
      : undefined,
  });

  for (const payment of detail.payments) {
    items.push({
      ts: payment.createdAt,
      source: payment.recordedByName ?? "System",
      label: `Payment record created (${payment.paymentMethod})`,
      detail: `${fmtINR(payment.amount)}${
        payment.receiptNumber ? ` · receipt ${payment.receiptNumber}` : ""
      }`,
    });
    for (const correction of payment.corrections ?? []) {
      items.push({
        ts: correction.createdAt,
        source: correction.changedByName ?? "System",
        label: `Offline payment detail corrected (payment ${payment.id})`,
        detail: correction.reason,
      });
    }
  }

  // Fee audit log entries
  for (const ae of detail.auditEntries) {
    items.push({
      ts: ae.createdAt,
      source: ae.actorName ? `${ae.actorName} (ID: ${ae.actorId ?? "?"})` : "System",
      label: ae.action,
      detail: ae.description ?? undefined,
      // ipAddress: NEVER rendered
    });
  }

  // All attempt events
  for (const attempt of detail.paymentAttempts) {
    const directEvents: Array<{
      ts: InstantValue;
      label: string;
    }> = [
      { ts: attempt.rzpCreatedAt, label: "Provider payment created" },
      { ts: attempt.rzpAuthorizedAt, label: "Payment authorized" },
      { ts: attempt.rzpCapturedAt, label: "Payment captured" },
      { ts: attempt.rzpFailedAt, label: "Payment failed" },
      { ts: attempt.refundInitiatedAt, label: "Refund initiated" },
      { ts: attempt.refundProcessedAt, label: "Refund processed" },
      { ts: attempt.webhookReceivedAt, label: "Webhook received" },
      { ts: attempt.apiSyncedAt, label: "Provider API enrichment synced" },
    ];
    for (const directEvent of directEvents) {
      if (!directEvent.ts) continue;
      items.push({
        ts: directEvent.ts,
        source: attempt.source,
        label: `[Attempt ${attempt.attemptNumber ?? "?"}] ${directEvent.label}`,
        detail: attempt.razorpayPaymentId
          ? `pay: ${attempt.razorpayPaymentId}`
          : undefined,
      });
    }
    for (const ev of attempt.events) {
      const ts = ev.providerOccurredAt ?? ev.occurredAt ?? ev.recordedAt;
      items.push({
        ts,
        source: ev.source,
        label: `[Attempt ${attempt.attemptNumber ?? "?"}] ${ev.eventType}`,
        detail: ev.razorpayPaymentId ? `pay: ${ev.razorpayPaymentId}` : undefined,
      });
    }
  }

  // All refund events
  for (const refund of detail.refunds ?? []) {
    items.push({
      ts: refund.requestedAt,
      source: refund.origin ?? "system",
      label: `[Refund ${refund.id}] requested`,
      detail: `${fmtPaise(refund.requestedAmountPaise)} · ${refund.localStatus}`,
    });
    if (refund.providerProcessedAt) {
      items.push({
        ts: refund.providerProcessedAt,
        source: "provider",
        label: `[Refund ${refund.id}] provider processing completed`,
        detail: refund.processedAmountPaise != null
          ? fmtPaise(refund.processedAmountPaise)
          : undefined,
      });
    }
    for (const rev of refund.events ?? []) {
      const ts = rev.providerOccurredAt ?? rev.occurredAt ?? rev.recordedAt;
      items.push({
        ts,
        source: rev.source,
        label: `[Refund ${refund.id}] ${rev.eventType}`,
        detail: rev.razorpayRefundId ? `refund_id: ${rev.razorpayRefundId}` : undefined,
      });
    }
  }

  // Webhook processing events
  for (const webhook of detail.webhookEvents) {
    items.push({
      ts: webhook.providerOccurredAt ?? webhook.receivedAt,
      source: "Razorpay webhook",
      label: webhook.eventType,
      detail: `${webhook.verificationStatus} · ${webhook.processingStatus}`,
    });
  }

  for (const pe of detail.webhookProcessingEvents) {
    items.push({
      ts: pe.createdAt,
      source: "webhook-processor",
      label: `Webhook processing: ${pe.status}`,
      detail: pe.error ?? undefined,
    });
  }

  items.sort((a, b) => instantMillis(a.ts) - instantMillis(b.ts));

  let html = `<div class="section">${sectionHeader(11, `Complete Audit Timeline (${items.length} entries)`)}<table>`;

  if (items.length === 0) {
    html += noDataRow("No audit entries found.");
  } else {
    for (const item of items) {
      html += `<tr>
        <td class="lbl">${fmtInstant(item.ts)}<br><small>${esc(item.source)}</small></td>
        <td class="val"><strong>${esc(item.label)}</strong>${item.detail ? `<br><small>${esc(item.detail)}</small>` : ""}</td>
      </tr>`;
    }
  }

  html += closeSection();
  return html;
}

function renderSection12(detail: TransactionAuditDetail): string {
  const notes: string[] = [];

  if (detail.feeRecord.notes) notes.push(`Fee Notes: ${detail.feeRecord.notes}`);

  const cashierNotes = detail.payments
    .filter((p) => p.cashierNotes)
    .map((p) => `Payment #${p.id}: ${p.cashierNotes}`);
  notes.push(...cashierNotes);

  let html = openSection(12, "Notes");
  if (notes.length === 0) {
    html += noDataRow("No notes recorded.");
  } else {
    for (const note of notes) {
      html += `<tr><td colspan="2" class="val" style="padding:8px 14px;">${esc(note)}</td></tr>`;
    }
  }
  html += closeSection();
  return html;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  font-size: 13px;
  color: #1e293b;
  background: #fff;
  padding: 28px 32px;
  max-width: 960px;
  margin: 0 auto;
}
.report-header { margin-bottom: 24px; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; }
.school-name { font-size: 20px; font-weight: 700; color: #0f172a; }
.report-title { font-size: 15px; font-weight: 600; color: #0891b2; margin-top: 4px; }
.report-meta { font-size: 11px; color: #64748b; margin-top: 6px; }
.print-btn {
  float: right;
  background: #0891b2; color: #fff; border: none;
  padding: 8px 18px; border-radius: 6px; font-size: 13px;
  cursor: pointer; font-weight: 600;
}
.print-btn:hover { background: #0e7490; }
.section {
  margin-bottom: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  page-break-inside: avoid;
}
.section-title {
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  padding: 9px 14px;
  font-weight: 700;
  font-size: 12px;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: .05em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-num {
  background: #0891b2;
  color: #fff;
  border-radius: 50%;
  width: 20px; height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.subsection-hdr {
  background: #f1f5f9;
  color: #475569;
  font-weight: 700;
  font-size: 11px;
  padding: 5px 14px;
  text-transform: uppercase;
  letter-spacing: .04em;
  border-bottom: 1px solid #e2e8f0;
}
table { width: 100%; border-collapse: collapse; }
td { padding: 6px 14px; font-size: 13px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
td:last-child { border-bottom: 1px solid #f1f5f9; }
.lbl { color: #64748b; width: 38%; font-size: 12px; }
.val { font-weight: 500; word-break: break-word; }
.payment-header { }
.payment-hdr-cell {
  background: #f0f9ff;
  font-weight: 700;
  color: #0369a1;
  font-size: 12px;
  border-top: 2px solid #bae6fd;
  padding: 7px 14px;
}
.na { color: #94a3b8; font-style: italic; font-weight: 400; }
.badge {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
}
.badge-green  { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
.badge-blue   { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.badge-amber  { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
.badge-red    { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
.badge-purple { background: #faf5ff; color: #7e22ce; border: 1px solid #e9d5ff; }
.badge-gray   { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
/* Timeline */
.timeline { padding: 12px 14px; }
.tl-item { display: flex; gap: 12px; margin-bottom: 14px; position: relative; }
.tl-item::before {
  content: "";
  position: absolute;
  left: 7px;
  top: 18px;
  bottom: -10px;
  width: 2px;
  background: #e2e8f0;
}
.tl-item:last-child::before { display: none; }
.tl-dot {
  width: 16px; height: 16px;
  border-radius: 50%;
  background: #0891b2;
  flex-shrink: 0;
  margin-top: 2px;
}
.tl-body { flex: 1; }
.tl-time { font-size: 11px; color: #64748b; margin-bottom: 2px; }
.tl-label { font-weight: 600; font-size: 13px; color: #1e293b; }
.tl-detail { font-size: 11px; color: #64748b; margin-top: 2px; }
pre.pre {
  font-family: "Courier New", monospace;
  font-size: 11px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.footer {
  margin-top: 28px;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
  text-align: center;
  font-size: 11px;
  color: #94a3b8;
}
.security-note {
  background: #fefce8;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 11px;
  color: #92400e;
  margin-bottom: 16px;
}
@media print {
  .print-btn { display: none !important; }
  body { padding: 12px; }
  .section { page-break-inside: avoid; }
  @page { size: A4; margin: 15mm 12mm; }
}
`;

// ─── Main export ──────────────────────────────────────────────────────────────

export function renderTransactionAuditHtml(detail: TransactionAuditDetail): string {
  const school = detail.school;
  const feeRecord = detail.feeRecord;

  const schoolAddress = [
    school.addressLine1,
    school.addressLine2,
    school.city,
    school.state,
    school.pinCode,
    school.country,
  ]
    .filter(Boolean)
    .join(", ");

  const now = new Date();
  const generatedAt = formatInstantIST(now.toISOString());

  const schoolInfo = [
    school.phone ? `Ph: ${esc(school.phone)}` : null,
    school.email ? `Email: ${esc(school.email)}` : null,
    school.affiliationNumber
      ? `Affiliation: ${esc(school.affiliationNumber)}`
      : null,
    school.gstin ? `GSTIN: ${esc(school.gstin)}` : null,
  ]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");

  const sections = [
    renderSection1(detail),
    renderSection2(detail),
    renderSection3(detail),
    renderSection4(detail),
    renderSection5(detail),
    renderSection6(detail),
    renderSection7(detail),
    renderSection8(detail),
    renderSection9(detail),
    renderSection10(detail),
    renderSection11(detail),
    renderSection12(detail),
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transaction Audit Report — ${esc(feeRecord.invoiceNumber ?? String(feeRecord.id))} — ${esc(school.name)}</title>
  <style>${CSS}</style>
</head>
<body>

<div class="report-header">
  <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
  ${school.logoUrl ? `<img src="${esc(school.logoUrl)}" alt="${esc(school.name)} logo" style="height:48px;float:right;margin-right:80px;margin-top:-4px;">` : ""}
  <div class="school-name">${esc(school.name)}</div>
  ${schoolAddress ? `<div class="report-meta">${esc(schoolAddress)}</div>` : ""}
  ${schoolInfo ? `<div class="report-meta">${schoolInfo}</div>` : ""}
  <div class="report-title">Transaction Audit Report</div>
  <div class="report-meta">
    Invoice: <strong>${esc(feeRecord.invoiceNumber ?? "—")}</strong>
    &nbsp;·&nbsp; Fee Record ID: <strong>${feeRecord.id}</strong>
    &nbsp;·&nbsp; Status: ${statusBadge(feeRecord.status)}
    &nbsp;·&nbsp; Generated: ${generatedAt}
  </div>
</div>

<div class="security-note">
  ⚠ This report is for authorised administrative use only. Sensitive fields
  (card numbers, passwords, HMAC signatures, raw payloads, IP addresses, and
  full contact details) have been masked or excluded.
</div>

${sections}

<div class="footer">
  <p>Computer-generated transaction audit record &nbsp;·&nbsp; ${esc(school.name)} &nbsp;·&nbsp; BENIUS School Management System</p>
  <p>Generated at ${generatedAt} &nbsp;·&nbsp; This document is valid only when printed on official letterhead.</p>
</div>

<script>
  // Auto-print when opened directly (suppress if loaded in an iframe or embed)
  if (window.self === window.top) {
    window.addEventListener("load", function() {
      // Small delay so the browser renders styles before print dialog
      setTimeout(function() { window.print(); }, 400);
    });
  }
</script>

</body>
</html>`;
}
