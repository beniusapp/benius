/**
 * Premium Payment Receipt Renderer
 * ─────────────────────────────────
 * Generates a self-contained A4 HTML document suitable for browser print,
 * PDF export, and mobile "Save as PDF". Used by both receipt endpoints:
 *   - /api/admin/fees/:id/receipt          (fee-record based)
 *   - /api/admin/fees/payments/:id/receipt (payment-record based)
 *
 * FINANCIAL INTEGRITY: This module is presentation-only. It never mutates
 * database values, recalculates amounts, or alters invoice/receipt numbers.
 * All values come from the caller-supplied data object, which itself reads
 * only from the database.
 *
 * TIMESTAMPS: All school-facing timestamps must be passed pre-formatted
 * in Asia/Kolkata (IST) using the shared formatInstantIST / formatDateOnly
 * utilities. This renderer does not call those utilities itself; it trusts
 * the caller to have produced correct IST strings.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReceiptSchool {
  name: string;
  logoUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  phone: string | null;
  email: string | null;
  affiliationNumber: string | null;
  gstin: string | null;
}

export interface ReceiptStudent {
  name: string;
  digitalStudentId: string;
  rollNumber: number | null;
  class: string;
  section: string;
  guardianName: string | null;
  phone: string | null;
  email: string | null;
}

export interface ReceiptFee {
  feeType: string;
  feeName: string | null;        // resolved display name
  invoiceNumber: string | null;
  academicYear: string | null;
  feePeriodStart: string | null; // date-only string
  feePeriodEnd: string | null;   // date-only string
  dueDate: string | null;        // IST-formatted date
  amount: number;                // base fee in rupees
  lateFeeAmount: number;         // late fee component in rupees
  breakdown: Array<{ name: string; purpose?: string; amount: number }>;
  notes: string | null;          // fee-level notes (admin)
}

export interface ReceiptPayment {
  receiptNumber: string | null;
  amount: number;                // rupees paid
  lateFeePaid: number;           // late fee component paid
  paymentMethod: string;         // "Online" | "Cash" | "BankTransfer" | "Cheque" | etc.
  receivedDate: string;          // date-only string (IST)
  paymentDateTimeIST: string;    // full IST datetime of the transaction
  cashierNotes: string | null;   // admin notes on the payment record
  // ── Online (Razorpay) ──────────────────────────────────────────────────────
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  paymentMode: string | null;    // upi / card / netbanking / wallet / emi
  bankName: string | null;
  cardLast4: string | null;
  cardNetwork: string | null;
  vpa: string | null;
  payerName: string | null;
  payerEmail: string | null;
  payerContact: string | null;
  gatewayStatus: string | null;
  // Provider timestamps (IST, pre-formatted)
  providerCreatedIST: string | null;
  providerCapturedIST: string | null;
  // ── Offline ────────────────────────────────────────────────────────────────
  denominationBreakdown: Record<string, number> | null;
  referenceNumber: string | null;
  instrumentDate: string | null;  // cheque date / DD date / instrument date (pre-formatted)
  branchName: string | null;      // bank branch name
  offlineDetail: {
    transactionTime: string | null;
    instrumentStatus: string | null;
    transferMode: string | null;
    transactionReference: string | null;
    receivingBank: string | null;
    receiverUpiId: string | null;
    payeeName: string | null;
    payableAt: string | null;
    collectionLocation: string | null;
    depositDate: string | null;
    depositBank: string | null;
    depositReference: string | null;
    returnDate: string | null;
    returnReason: string | null;
  } | null;
  recordedByName: string | null;   // display name (from staff profile) or email fallback
  recordedByRole: string | null;   // e.g. "admin" | "teacher" | "support_staff"
}

export interface ReceiptSignature {
  imageUrl: string | null;
  signatoryName: string | null;
}

export interface ReceiptData {
  school: ReceiptSchool;
  student: ReceiptStudent;
  fee: ReceiptFee;
  payment: ReceiptPayment;
  signature: ReceiptSignature;
  academicSessionLabel: string | null; // e.g. "2025–2026"
  generatedAtIST: string;              // IST datetime of document generation
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function row(label: string, value: string | null | undefined, mono = false): string {
  if (value == null || value === "" || value === "—") return "";
  const cls = mono ? ' class="mono"' : "";
  return `<div class="field-row"><span class="field-label">${esc(label)}</span><span class="field-value"${cls}>${esc(value)}</span></div>`;
}

function sectionHeader(title: string): string {
  return `<div class="section-header">${esc(title)}</div>`;
}

function paymentMethodLabel(method: string): string {
  const m: Record<string, string> = {
    Online: "Online Payment",
    Cash: "Cash",
    BankTransfer: "Bank Transfer",
    Cheque: "Cheque",
    DemandDraft: "Demand Draft",
    UpiQr: "UPI / QR",
    Neft: "NEFT",
    Rtgs: "RTGS",
    Imps: "IMPS",
    WireTransfer: "Wire Transfer",
  };
  return m[method] ?? method;
}

function paymentModeLabel(mode: string | null): string {
  if (!mode) return "";
  const m: Record<string, string> = {
    upi: "UPI",
    card: "Card",
    netbanking: "Netbanking",
    wallet: "Wallet",
    emi: "EMI",
    cardless_emi: "Cardless EMI",
  };
  return m[mode.toLowerCase()] ?? mode;
}

function statusBadge(method: string): string {
  const isOnline = method === "Online";
  return isOnline ? "ONLINE PAYMENT" : "OFFLINE PAYMENT";
}

function roleLabel(role: string | null): string {
  if (!role) return "";
  const m: Record<string, string> = {
    admin: "Administrator",
    teacher: "Teacher",
    support_staff: "Support Staff",
    principal: "Principal",
  };
  return m[role] ?? role;
}

/**
 * Converts a rupee amount (integer or float, rounded to nearest rupee) to
 * Indian-English words: e.g. 1000 → "Rupees One Thousand Only"
 */
function amountInWords(amount: number): string {
  const n = Math.round(amount);
  if (n === 0) return "Rupees Zero Only";

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function belowHundred(x: number): string {
    if (x < 20) return ones[x];
    return tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
  }

  function belowThousand(x: number): string {
    if (x < 100) return belowHundred(x);
    return ones[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + belowHundred(x % 100) : "");
  }

  function convert(x: number): string {
    if (x === 0) return "";
    if (x < 1000) return belowThousand(x);
    if (x < 100_000)
      return belowThousand(Math.floor(x / 1000)) + " Thousand" +
        (x % 1000 ? " " + belowThousand(x % 1000) : "");
    if (x < 10_000_000)
      return belowThousand(Math.floor(x / 100_000)) + " Lakh" +
        (x % 100_000 ? " " + convert(x % 100_000) : "");
    return belowThousand(Math.floor(x / 10_000_000)) + " Crore" +
      (x % 10_000_000 ? " " + convert(x % 10_000_000) : "");
  }

  return "Rupees " + convert(n) + " Only";
}

// ── Renderer ─────────────────────────────────────────────────────────────────

export function renderReceiptHtml(data: ReceiptData): string {
  const { school, student, fee, payment, signature, academicSessionLabel, generatedAtIST } = data;

  const isOnline = payment.paymentMethod === "Online";
  const isCash = payment.paymentMethod === "Cash";
  const isDemandDraft = payment.paymentMethod === "DemandDraft";
  const isCheque = payment.paymentMethod === "Cheque";
  const isUpi = payment.paymentMethod === "UpiQr";
  const isBankLike = ["BankTransfer", "Neft", "Rtgs", "Imps", "WireTransfer"].includes(payment.paymentMethod);

  // Build school address block
  const addressParts: string[] = [];
  if (school.addressLine1) addressParts.push(esc(school.addressLine1));
  if (school.addressLine2) addressParts.push(esc(school.addressLine2));
  const cityLine = [school.city, school.state, school.pinCode ? `PIN ${school.pinCode}` : null]
    .filter(Boolean).join(", ");
  if (cityLine) addressParts.push(esc(cityLine));

  const schoolAddressHtml = addressParts.map(p => `<div class="school-addr-line">${p}</div>`).join("");

  const schoolContactParts: string[] = [];
  if (school.phone) schoolContactParts.push(`Tel: ${esc(school.phone)}`);
  if (school.email) schoolContactParts.push(esc(school.email));
  const schoolContactHtml = schoolContactParts.length
    ? `<div class="school-contact">${schoolContactParts.join("  &bull;  ")}</div>`
    : "";

  const affiliationHtml = school.affiliationNumber
    ? `<div class="school-affiliation">Affiliation No. ${esc(school.affiliationNumber)}</div>`
    : "";

  // Logo or initials
  const schoolInitials = school.name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  const logoHtml = school.logoUrl
    ? `<img class="school-logo" src="${esc(school.logoUrl)}" alt="${esc(school.name)} Logo" />`
    : `<div class="school-logo-initials">${esc(schoolInitials)}</div>`;

  // Fee display name
  const feeName = fee.feeName && fee.feeName !== fee.feeType ? fee.feeName : fee.feeType;

  // Total amount
  const totalFee = fee.amount + fee.lateFeeAmount;
  const amountPaidStr = inr(payment.amount);
  const totalFeeStr = inr(totalFee);
  const amountWords = amountInWords(payment.amount);

  // Fee period label
  let feePeriodStr = "";
  if (fee.feePeriodStart && fee.feePeriodEnd) {
    feePeriodStr = `${esc(fee.feePeriodStart)} – ${esc(fee.feePeriodEnd)}`;
  } else if (fee.feePeriodStart) {
    feePeriodStr = esc(fee.feePeriodStart);
  }

  // Build breakdown table rows
  let breakdownRowsHtml = "";
  if (fee.breakdown && fee.breakdown.length > 0) {
    breakdownRowsHtml = fee.breakdown.map(b =>
      `<tr><td>${esc(b.name)}</td><td class="amount-col">${esc(inr(b.amount))}</td></tr>`
    ).join("");
    if (fee.lateFeeAmount > 0) {
      breakdownRowsHtml += `<tr class="late-fee-row"><td>Late Fee</td><td class="amount-col">${esc(inr(fee.lateFeeAmount))}</td></tr>`;
    }
    breakdownRowsHtml += `<tr class="total-row"><td><strong>Total Fee</strong></td><td class="amount-col"><strong>${esc(totalFeeStr)}</strong></td></tr>`;
  } else {
    // Single-row fallback
    const rows: string[] = [];
    rows.push(`<tr><td>${esc(feeName)}</td><td class="amount-col">${esc(inr(fee.amount))}</td></tr>`);
    if (fee.lateFeeAmount > 0) {
      rows.push(`<tr class="late-fee-row"><td>Late Fee</td><td class="amount-col">${esc(inr(fee.lateFeeAmount))}</td></tr>`);
    }
    if (fee.lateFeeAmount > 0) {
      rows.push(`<tr class="total-row"><td><strong>Total Fee</strong></td><td class="amount-col"><strong>${esc(totalFeeStr)}</strong></td></tr>`);
    }
    breakdownRowsHtml = rows.join("");
  }

  // ── Online payment section ─────────────────────────────────────────────────
  let onlineSectionHtml = "";
  if (isOnline) {
    const modeLabel = paymentModeLabel(payment.paymentMode);
    const methodDisplay = [
      payment.paymentMode ? modeLabel : null,
      payment.cardNetwork ? payment.cardNetwork : null,
      payment.cardLast4 ? `••••${payment.cardLast4}` : null,
      payment.bankName ?? null,
      payment.vpa ?? null,
    ].filter(Boolean).join(" · ");

    onlineSectionHtml = `
      <div class="card online-card">
        ${sectionHeader("Online Transaction Details")}
        <div class="field-grid">
          ${row("Payment Gateway", "Razorpay")}
          ${payment.razorpayPaymentId ? `<div class="field-row"><span class="field-label">Payment ID</span><span class="field-value mono razorpay-id">${esc(payment.razorpayPaymentId)}</span></div>` : ""}
          ${payment.razorpayOrderId ? `<div class="field-row"><span class="field-label">Order ID</span><span class="field-value mono">${esc(payment.razorpayOrderId)}</span></div>` : ""}
          ${methodDisplay ? row("Payment Mode", methodDisplay) : ""}
          ${payment.gatewayStatus ? row("Transaction Status", payment.gatewayStatus.charAt(0).toUpperCase() + payment.gatewayStatus.slice(1)) : ""}
          ${payment.providerCreatedIST ? row("Payment Initiated", payment.providerCreatedIST) : ""}
          ${payment.providerCapturedIST ? row("Payment Captured", payment.providerCapturedIST) : ""}
          ${payment.paymentDateTimeIST ? row("Application Recorded", payment.paymentDateTimeIST) : ""}
          ${payment.recordedByName ? `<div class="field-row"><span class="field-label">Processed By</span><span class="field-value" style="text-align:right;">${esc(payment.recordedByName)}${payment.recordedByRole ? `<span style="display:block;font-size:10.5px;font-weight:400;color:#6b7280;">${esc(roleLabel(payment.recordedByRole))}</span>` : ""}</span></div>` : ""}
        </div>
      </div>`;
  }

  // ── Processed By block (offline payments only) ───────────────────────────
  // Never falls back to an email address — uses "School Finance Office" when
  // the staff profile cannot be resolved. Email addresses must not appear on
  // school-facing or parent-facing receipt documents.
  function processedByHtml(): string {
    const displayName = payment.recordedByName ?? "School Finance Office";
    const roleTxt = payment.recordedByName ? roleLabel(payment.recordedByRole) : "";
    return `<div class="field-row">
      <span class="field-label">Processed By</span>
      <span class="field-value" style="text-align:right;">
        ${esc(displayName)}
        ${roleTxt ? `<span style="display:block;font-size:10.5px;font-weight:400;color:#6b7280;">${esc(roleTxt)}</span>` : ""}
      </span>
    </div>`;
  }

  // ── Offline payment section ────────────────────────────────────────────────
  let offlineSectionHtml = "";
  if (!isOnline) {
    const od = payment.offlineDetail;
    let offlineRows = "";
    const offlineFieldRows: string[] = [];

    // ── Cash ──────────────────────────────────────────────────────────────────
    if (isCash) {
      if (payment.denominationBreakdown) {
        const denoms = Object.entries(payment.denominationBreakdown)
          .filter(([, qty]) => Number(qty) > 0)
          .sort(([a], [b]) => Number(b) - Number(a));
        if (denoms.length > 0) {
          const denomTotal = denoms.reduce((sum, [denom, qty]) => sum + Number(denom) * Number(qty), 0);
          const denomRowsHtml = denoms.map(([denom, qty]) =>
            `<tr><td class="denom-cell">₹${esc(denom)}</td><td class="qty-cell">${esc(String(qty))}</td><td class="subtotal-cell">${esc(inr(Number(denom) * Number(qty)))}</td></tr>`
          ).join("");
          offlineRows += `
            <div class="denomination-wrap">
              <div class="denomination-label">Cash Denominations</div>
              <table class="denomination-table">
                <thead><tr><th>Denomination</th><th>Quantity</th><th>Sub-total</th></tr></thead>
                <tbody>${denomRowsHtml}</tbody>
                <tfoot><tr><td colspan="2"><strong>Total Received</strong></td><td class="subtotal-cell"><strong>${esc(inr(denomTotal))}</strong></td></tr></tfoot>
              </table>
            </div>`;
        }
      }
      offlineFieldRows.push(row("Amount Received", inr(payment.amount)));
      if (od?.collectionLocation) offlineFieldRows.push(row("Collection Location", od.collectionLocation));
      offlineFieldRows.push(processedByHtml());

    // ── Demand Draft ──────────────────────────────────────────────────────────
    } else if (isDemandDraft) {
      if (payment.referenceNumber) offlineFieldRows.push(row("DD Number", payment.referenceNumber, true));
      if (payment.instrumentDate) offlineFieldRows.push(row("DD Date", payment.instrumentDate));
      if (od?.receivingBank) offlineFieldRows.push(row("Bank Name", od.receivingBank));
      else if (od?.payeeName) offlineFieldRows.push(row("Drawn On (Bank)", od.payeeName));
      if (payment.branchName) offlineFieldRows.push(row("Branch", payment.branchName));
      if (od?.payableAt) offlineFieldRows.push(row("Payable At", od.payableAt));
      if (od?.instrumentStatus) offlineFieldRows.push(row("Status", od.instrumentStatus));
      offlineFieldRows.push(row("Amount", inr(payment.amount)));
      if (od?.depositDate) offlineFieldRows.push(row("Deposit Date", od.depositDate));
      if (od?.depositBank) offlineFieldRows.push(row("Deposit Bank", od.depositBank));
      if (od?.depositReference) offlineFieldRows.push(row("Deposit Reference", od.depositReference, true));
      if (od?.returnDate) offlineFieldRows.push(row("Return Date", od.returnDate));
      if (od?.returnReason) offlineFieldRows.push(row("Return Reason", od.returnReason));
      offlineFieldRows.push(processedByHtml());

    // ── Cheque ────────────────────────────────────────────────────────────────
    } else if (isCheque) {
      if (payment.referenceNumber) offlineFieldRows.push(row("Cheque Number", payment.referenceNumber, true));
      if (payment.instrumentDate) offlineFieldRows.push(row("Cheque Date", payment.instrumentDate));
      if (od?.receivingBank) offlineFieldRows.push(row("Bank Name", od.receivingBank));
      else if (od?.payeeName) offlineFieldRows.push(row("Drawn On (Bank)", od.payeeName));
      if (payment.branchName) offlineFieldRows.push(row("Branch", payment.branchName));
      if (od?.instrumentStatus) offlineFieldRows.push(row("Status", od.instrumentStatus));
      offlineFieldRows.push(row("Amount", inr(payment.amount)));
      if (od?.depositDate) offlineFieldRows.push(row("Deposit Date", od.depositDate));
      if (od?.depositBank) offlineFieldRows.push(row("Deposit Bank", od.depositBank));
      if (od?.depositReference) offlineFieldRows.push(row("Deposit Reference", od.depositReference, true));
      if (od?.returnDate) offlineFieldRows.push(row("Return Date", od.returnDate));
      if (od?.returnReason) offlineFieldRows.push(row("Return Reason", od.returnReason));
      offlineFieldRows.push(processedByHtml());

    // ── UPI / QR ──────────────────────────────────────────────────────────────
    } else if (isUpi) {
      const upiRef = payment.referenceNumber ?? od?.transactionReference;
      if (upiRef) offlineFieldRows.push(row("UPI Transaction ID", upiRef, true));
      if (od?.receiverUpiId) offlineFieldRows.push(row("Receiver UPI ID", od.receiverUpiId, true));
      if (od?.transactionTime) offlineFieldRows.push(row("Transaction Date / Time", od.transactionTime));
      offlineFieldRows.push(row("Amount", inr(payment.amount)));
      if (od?.instrumentStatus) offlineFieldRows.push(row("Status", od.instrumentStatus));
      offlineFieldRows.push(processedByHtml());

    // ── Bank Transfer / NEFT / RTGS / IMPS / Wire ─────────────────────────────
    } else {
      const utr = payment.referenceNumber ?? od?.transactionReference;
      if (utr) offlineFieldRows.push(row("UTR / Transaction Reference", utr, true));
      if (od?.transferMode) offlineFieldRows.push(row("Transfer Mode", od.transferMode));
      else if (isBankLike) offlineFieldRows.push(row("Transfer Mode", paymentMethodLabel(payment.paymentMethod)));
      if (od?.receivingBank) offlineFieldRows.push(row("Bank", od.receivingBank));
      if (payment.branchName) offlineFieldRows.push(row("Branch", payment.branchName));
      if (od?.transactionTime) offlineFieldRows.push(row("Transaction Date / Time", od.transactionTime));
      if (od?.instrumentStatus) offlineFieldRows.push(row("Status", od.instrumentStatus));
      offlineFieldRows.push(row("Amount", inr(payment.amount)));
      offlineFieldRows.push(processedByHtml());
    }

    const nonEmpty = offlineFieldRows.filter(s => s.trim() !== "");
    if (nonEmpty.length > 0 || offlineRows) {
      offlineSectionHtml = `
        <div class="card offline-card">
          ${sectionHeader("Payment Details")}
          ${offlineRows}
          ${nonEmpty.length > 0 ? `<div class="field-grid">${nonEmpty.join("")}</div>` : ""}
        </div>`;
    }
  }

  // ── Signature ──────────────────────────────────────────────────────────────
  const sigHtml = `
    <div class="sig-area">
      <div class="sig-box">
        ${signature.imageUrl
          ? `<img class="sig-img" src="${esc(signature.imageUrl)}" alt="Authorized Signature" />`
          : `<div class="sig-placeholder"></div>`}
        <div class="sig-line"></div>
        <div class="sig-label">Authorized Signatory</div>
        ${signature.signatoryName ? `<div class="sig-name">${esc(signature.signatoryName)}</div>` : ""}
        <div class="sig-school">${esc(school.name)}</div>
      </div>
    </div>`;

  // ── Notes ─────────────────────────────────────────────────────────────────
  // Filter out Razorpay-internal notes from cashierNotes — they have their own section
  const isRawRazorpayNote = payment.cashierNotes &&
    /^Razorpay payment ID:/i.test(payment.cashierNotes.trim());
  const cleanNote = isRawRazorpayNote ? null : payment.cashierNotes;
  const feeNotes = fee.notes;

  const notesHtml = (cleanNote || feeNotes) ? `
    <div class="card notes-card">
      ${sectionHeader("Notes")}
      ${cleanNote ? `<p class="note-text">${esc(cleanNote)}</p>` : ""}
      ${feeNotes ? `<p class="note-text">${esc(feeNotes)}</p>` : ""}
    </div>` : "";

  // ── Online verification block (compact, secondary) ─────────────────────────
  const verificationHtml = isOnline && payment.razorpayPaymentId ? `
    <div class="card verification-card">
      ${sectionHeader("Transaction Verification")}
      <div class="verification-grid">
        ${payment.razorpayPaymentId ? `<div class="v-pair"><span class="v-label">Payment ID</span><span class="v-value mono">${esc(payment.razorpayPaymentId)}</span></div>` : ""}
        ${payment.razorpayOrderId ? `<div class="v-pair"><span class="v-label">Order ID</span><span class="v-value mono">${esc(payment.razorpayOrderId)}</span></div>` : ""}
        <div class="v-pair"><span class="v-label">Provider</span><span class="v-value">Razorpay</span></div>
        <div class="v-pair"><span class="v-label">Signature Verified</span><span class="v-value verified-yes">✓ Verified</span></div>
        ${payment.providerCapturedIST ? `<div class="v-pair"><span class="v-label">Captured at (provider)</span><span class="v-value">${esc(payment.providerCapturedIST)}</span></div>` : ""}
        <div class="v-pair"><span class="v-label">Recorded at (system)</span><span class="v-value">${esc(payment.paymentDateTimeIST)}</span></div>
      </div>
    </div>` : "";

  // ── Full HTML ──────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Payment Receipt — ${esc(payment.receiptNumber ?? "")}</title>
<style>
/* ── Reset & Page ───────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

@page {
  size: A4 portrait;
  margin: 8mm;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: #111827;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ── Page wrapper ───────────────────────────────────────────────────────── */
.page {
  max-width: 780px;
  margin: 0 auto;
  padding: 28px 32px 24px;
  background: #fff;
}

@media screen {
  body { background: #f3f4f6; padding: 20px 16px; }
  .page {
    box-shadow: 0 1px 3px rgba(0,0,0,.10), 0 8px 32px rgba(0,0,0,.06);
    border-radius: 4px;
    min-height: 297mm;
  }
}

@media print {
  body { background: #fff; padding: 0; font-size: 10px; line-height: 1.35; }
  .page { padding: 0; box-shadow: none; max-width: 100%; }
  .no-print { display: none !important; }

  /* ── Header ── */
  .receipt-header { padding-bottom: 10px; margin-bottom: 10px; gap: 12px; }
  .school-logo { max-width: 48px; max-height: 48px; }
  .school-logo-initials { width: 44px; height: 44px; font-size: 16px; }
  .school-name { font-size: 13px; margin-bottom: 2px; }
  .school-addr-line { font-size: 9.5px; line-height: 1.3; }
  .school-contact { font-size: 9px; margin-top: 1px; }
  .school-affiliation { font-size: 9px; margin-top: 1px; }
  .doc-title { font-size: 12px; letter-spacing: 1px; margin-bottom: 3px; }
  .doc-session { font-size: 9px; margin-bottom: 5px; }
  .status-badge { font-size: 8.5px; padding: 2px 7px; }

  /* ── ID strip ── */
  .receipt-id-strip { margin-bottom: 10px; }
  .id-cell { padding: 7px 10px; }
  .id-cell-label { font-size: 8px; margin-bottom: 1px; }
  .id-cell-value { font-size: 10.5px; }
  .id-cell-value.primary { font-size: 11px; }

  /* ── Two-column layout ── */
  .two-col { gap: 10px; margin-bottom: 10px; break-inside: avoid; page-break-inside: avoid; }

  /* ── Cards ── */
  .card { padding: 9px 11px; margin-bottom: 9px; border-radius: 5px; break-inside: avoid; page-break-inside: avoid; }

  /* ── Section headers ── */
  .section-header { font-size: 8px; margin-bottom: 6px; padding-bottom: 3px; }

  /* ── Student name ── */
  .student-name-line { font-size: 12px; margin-bottom: 5px; }

  /* ── Field rows ── */
  .field-grid { gap: 2px; }
  .field-row { font-size: 10px; padding: 1px 0; }
  .field-label { font-size: 9.5px; min-width: 108px; }
  .field-value { font-size: 10px; }
  .field-value.mono { font-size: 9.5px; }

  /* ── Payment summary (navy card) ── */
  .amount-display { padding: 4px 0 7px; }
  .amount-label { font-size: 9px; }
  .amount-figure { font-size: 26px; letter-spacing: -0.5px; }
  .amount-words { font-size: 9px; margin-top: 2px; }
  .payment-meta-grid { margin-top: 8px; padding-top: 8px; gap: 5px 10px; }
  .pm-label { font-size: 8.5px; }
  .pm-value { font-size: 11px; }

  /* ── Breakdown table ── */
  .breakdown-table { font-size: 10px; }
  .breakdown-table thead th { font-size: 8px; padding: 4px 6px; }
  .breakdown-table tbody td { padding: 4px 6px; }
  .breakdown-table tr.total-row td { padding-top: 5px; font-size: 10.5px; }

  /* ── Denomination table ── */
  .denomination-wrap { margin-bottom: 8px; }
  .denomination-label { font-size: 8px; margin-bottom: 3px; }
  .denomination-table { font-size: 10px; }
  .denomination-table th { font-size: 8px; padding: 3px 6px; }
  .denomination-table td { padding: 3px 6px; }

  /* ── Verification grid ── */
  .v-label { font-size: 8.5px; }
  .v-value { font-size: 9.5px; }
  .v-value.mono { font-size: 9px; }

  /* ── Notes ── */
  .note-text { font-size: 10px; line-height: 1.4; }

  /* ── Signature ── */
  .sig-area { padding-top: 8px; margin-top: 0; margin-bottom: 8px; break-inside: avoid; page-break-inside: avoid; }
  .sig-img { max-height: 40px; max-width: 140px; margin-bottom: 3px; }
  .sig-placeholder { height: 40px; }
  .sig-line { margin: 4px auto 3px; }
  .sig-label { font-size: 8.5px; }
  .sig-name { font-size: 9px; margin-top: 1px; }
  .sig-school { font-size: 8.5px; }

  /* ── Footer ── */
  .receipt-footer { padding-top: 6px; break-inside: avoid; page-break-inside: avoid; }
  .footer-disclaimer { font-size: 8.5px; }
  .footer-meta { font-size: 8.5px; }

  /* ── Receipt ID strip & header: no breaks ── */
  .receipt-id-strip { break-inside: avoid; page-break-inside: avoid; }
  .receipt-header { break-inside: avoid; page-break-inside: avoid; }
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.receipt-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 20px;
  align-items: flex-start;
  padding-bottom: 18px;
  border-bottom: 2px solid #1e3a5f;
  margin-bottom: 18px;
}

.school-logo {
  display: block;
  max-width: 72px;
  max-height: 72px;
  object-fit: contain;
}

.school-logo-initials {
  width: 64px;
  height: 64px;
  background: #1e3a5f;
  color: #fff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.5px;
  flex-shrink: 0;
}

.school-info { text-align: center; }
.school-name {
  font-size: 18px;
  font-weight: 700;
  color: #1e3a5f;
  letter-spacing: -0.3px;
  margin-bottom: 4px;
}
.school-addr-line { font-size: 11.5px; color: #4b5563; line-height: 1.45; }
.school-contact { font-size: 11px; color: #6b7280; margin-top: 3px; }
.school-affiliation { font-size: 10.5px; color: #9ca3af; margin-top: 2px; letter-spacing: 0.2px; }

.doc-identity { text-align: right; min-width: 160px; }
.doc-title {
  font-size: 15px;
  font-weight: 800;
  color: #1e3a5f;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 5px;
}
.doc-session { font-size: 11px; color: #6b7280; margin-bottom: 8px; }
.status-badge {
  display: inline-block;
  padding: 4px 11px;
  border-radius: 100px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}
.status-paid {
  background: #f0fdf4;
  color: #166534;
  border: 1.5px solid #bbf7d0;
}
.status-online { background: #eff6ff; color: #1d4ed8; border: 1.5px solid #bfdbfe; }
.status-offline { background: #fefce8; color: #854d0e; border: 1.5px solid #fde68a; }

/* ── Receipt ID strip ───────────────────────────────────────────────────── */
.receipt-id-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1px;
  background: #e5e7eb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 18px;
}
.id-cell {
  background: #f9fafb;
  padding: 11px 14px;
}
.id-cell:first-child { border-radius: 8px 0 0 8px; }
.id-cell:last-child { border-radius: 0 8px 8px 0; }
.id-cell-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: #9ca3af;
  margin-bottom: 3px;
}
.id-cell-value {
  font-size: 12.5px;
  font-weight: 700;
  color: #111827;
  letter-spacing: -0.2px;
  overflow-wrap: break-word;
  word-break: normal;
}
.id-cell-value.primary {
  color: #1e3a5f;
  font-size: 13px;
}

/* ── 2-column layout ────────────────────────────────────────────────────── */
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}

/* ── Cards ──────────────────────────────────────────────────────────────── */
.card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 14px;
}

.payment-summary-card {
  background: #1e3a5f;
  border: none;
  color: #fff;
}

.section-header {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #9ca3af;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #e5e7eb;
}

.payment-summary-card .section-header {
  color: rgba(255,255,255,0.55);
  border-bottom-color: rgba(255,255,255,0.15);
}

/* ── Field rows ─────────────────────────────────────────────────────────── */
.field-grid { display: flex; flex-direction: column; gap: 5px; }

.field-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  padding: 2px 0;
}
.field-label {
  color: #6b7280;
  flex-shrink: 0;
  min-width: 130px;
  font-size: 12px;
}
.field-value {
  color: #111827;
  font-weight: 600;
  text-align: right;
  word-break: break-all;
}
.field-value.mono { font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', monospace; font-weight: 500; font-size: 11.5px; }

/* ── Student name ───────────────────────────────────────────────────────── */
.student-name-line {
  font-size: 15px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 8px;
  letter-spacing: -0.2px;
}

/* ── Payment summary ────────────────────────────────────────────────────── */
.amount-display {
  text-align: center;
  padding: 8px 0 12px;
}
.amount-label { font-size: 11px; color: rgba(255,255,255,0.65); letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px; }
.amount-figure {
  font-size: 38px;
  font-weight: 800;
  color: #fff;
  letter-spacing: -1px;
  line-height: 1.1;
}
.amount-words { font-size: 10.5px; color: rgba(255,255,255,0.55); margin-top: 4px; font-style: italic; }

.payment-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.15);
}
.payment-meta-item { }
.pm-label { font-size: 10px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
.pm-value { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.95); }

/* ── Breakdown table ────────────────────────────────────────────────────── */
.breakdown-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  margin-top: 2px;
}
.breakdown-table thead th {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: #9ca3af;
  font-weight: 700;
  padding: 6px 8px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
}
.breakdown-table thead th.amount-col { text-align: right; }
.breakdown-table tbody td {
  padding: 7px 8px;
  color: #374151;
  border-bottom: 1px solid #f3f4f6;
}
.breakdown-table tbody td.amount-col { text-align: right; font-weight: 600; }
.breakdown-table tr.late-fee-row td { color: #b45309; }
.breakdown-table tr.total-row td {
  padding-top: 9px;
  border-top: 1.5px solid #d1d5db;
  border-bottom: none;
  font-size: 13px;
}
.breakdown-table tr.total-row td.amount-col { color: #1e3a5f; }

/* ── Online card ────────────────────────────────────────────────────────── */
.online-card { border-left: 3px solid #1d4ed8; }
.razorpay-id { color: #1d4ed8 !important; }

/* ── Denomination table ─────────────────────────────────────────────────── */
.denomination-wrap { margin-bottom: 12px; }
.denomination-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: #9ca3af;
  margin-bottom: 6px;
}
.denomination-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.denomination-table th {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #9ca3af;
  font-weight: 700;
  padding: 5px 8px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
}
.denomination-table td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; }
.denomination-table .denom-cell { font-weight: 600; color: #374151; }
.denomination-table .qty-cell { color: #6b7280; }
.denomination-table .subtotal-cell { text-align: right; font-weight: 600; }
.denomination-table tfoot td {
  border-top: 1.5px solid #d1d5db;
  border-bottom: none;
  padding-top: 7px;
  font-size: 12.5px;
}

/* ── Verification ───────────────────────────────────────────────────────── */
.verification-card { border-left: 3px solid #9ca3af; }
.verification-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 16px; }
.v-pair { display: flex; flex-direction: column; gap: 1px; padding: 3px 0; }
.v-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
.v-value { font-size: 11.5px; color: #374151; font-weight: 500; word-break: break-all; }
.v-value.mono { font-family: 'SFMono-Regular', 'Consolas', monospace; font-size: 11px; }
.verified-yes { color: #166534; font-weight: 700; }

/* ── Notes ──────────────────────────────────────────────────────────────── */
.notes-card { border-left: 3px solid #d97706; }
.note-text { font-size: 12.5px; color: #374151; line-height: 1.55; }
.note-text + .note-text { margin-top: 6px; }

/* ── Signature ──────────────────────────────────────────────────────────── */
.sig-area {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid #e5e7eb;
  margin-bottom: 16px;
}
.sig-box { text-align: center; min-width: 150px; }
.sig-img { max-height: 52px; max-width: 180px; object-fit: contain; display: block; margin: 0 auto 6px; }
.sig-placeholder { height: 52px; }
.sig-line { width: 150px; border-top: 1.5px solid #374151; margin: 6px auto 5px; }
.sig-label { font-size: 10px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.5px; }
.sig-name { font-size: 11px; color: #374151; margin-top: 2px; }
.sig-school { font-size: 10px; color: #9ca3af; margin-top: 1px; }

/* ── Footer ─────────────────────────────────────────────────────────────── */
.receipt-footer {
  border-top: 1px solid #e5e7eb;
  padding-top: 10px;
  text-align: center;
}
.footer-disclaimer { font-size: 10px; color: #9ca3af; margin-bottom: 3px; }
.footer-meta { font-size: 10px; color: #d1d5db; }

/* ── Mono ───────────────────────────────────────────────────────────────── */
.mono { font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', monospace; }
</style>
</head>
<body>
<div class="page">

  <!-- ── HEADER ─────────────────────────────────────────────────────────── -->
  <div class="receipt-header">
    <div class="logo-col">${logoHtml}</div>
    <div class="school-info">
      <div class="school-name">${esc(school.name)}</div>
      ${schoolAddressHtml}
      ${schoolContactHtml}
      ${affiliationHtml}
    </div>
    <div class="doc-identity">
      <div class="doc-title">Payment Receipt</div>
      ${academicSessionLabel ? `<div class="doc-session">Academic Session: ${esc(academicSessionLabel)}</div>` : ""}
      <span class="status-badge status-paid">&#10003; Payment Received</span><br/>
      <span class="status-badge ${isOnline ? "status-online" : "status-offline"}" style="margin-top:5px;">${statusBadge(payment.paymentMethod)}</span>
    </div>
  </div>

  <!-- ── RECEIPT ID STRIP ────────────────────────────────────────────────── -->
  <div class="receipt-id-strip">
    <div class="id-cell">
      <div class="id-cell-label">Invoice No.</div>
      <div class="id-cell-value primary">${esc(fee.invoiceNumber ?? "—")}</div>
    </div>
    <div class="id-cell">
      <div class="id-cell-label">Receipt No.</div>
      <div class="id-cell-value primary">${esc(payment.receiptNumber ?? "—")}</div>
    </div>
    <div class="id-cell">
      <div class="id-cell-label">Payment Date &amp; Time</div>
      <div class="id-cell-value">${esc(payment.paymentDateTimeIST)}</div>
    </div>
    <div class="id-cell">
      <div class="id-cell-label">Payment Mode</div>
      <div class="id-cell-value">${esc(paymentMethodLabel(payment.paymentMethod))}${isOnline && payment.paymentMode ? `<span style="font-size:10.5px;font-weight:400;color:#6b7280;display:block;">${esc(paymentModeLabel(payment.paymentMode))}</span>` : ""}</div>
    </div>
    <div class="id-cell">
      <div class="id-cell-label">Status</div>
      <div class="id-cell-value" style="color:#166534;">PAID ✓</div>
    </div>
  </div>

  <!-- ── BODY ───────────────────────────────────────────────────────────── -->
  <div class="two-col">

    <!-- Student information -->
    <div class="card" style="margin-bottom:0;">
      ${sectionHeader("Student Information")}
      <div class="student-name-line">${esc(student.name)}</div>
      <div class="field-grid">
        ${row("Student ID (DSID)", student.digitalStudentId, true)}
        ${student.rollNumber ? row("Roll Number", String(student.rollNumber)) : ""}
        ${row("Class & Section", `${student.class} — ${student.section}`)}
        ${student.guardianName ? row("Parent / Guardian", student.guardianName) : ""}
        ${student.phone ? row("Phone", student.phone) : ""}
        ${student.email ? row("Email", student.email) : ""}
        ${academicSessionLabel ? row("Academic Session", academicSessionLabel) : ""}
      </div>
    </div>

    <!-- Payment summary -->
    <div class="card payment-summary-card" style="margin-bottom:0;">
      ${sectionHeader("Payment Summary")}
      <div class="amount-display">
        <div class="amount-label">Amount Received</div>
        <div class="amount-figure">${esc(amountPaidStr)}</div>
        <div class="amount-words">${esc(amountWords)}</div>
      </div>
      <div class="payment-meta-grid">
        <div class="payment-meta-item">
          <div class="pm-label">Invoice No.</div>
          <div class="pm-value" style="font-size:11.5px;">${esc(fee.invoiceNumber ?? "—")}</div>
        </div>
        <div class="payment-meta-item">
          <div class="pm-label">Receipt No.</div>
          <div class="pm-value" style="font-size:11.5px;">${esc(payment.receiptNumber ?? "—")}</div>
        </div>
        <div class="payment-meta-item">
          <div class="pm-label">Payment Mode</div>
          <div class="pm-value" style="font-size:12px;">${esc(paymentMethodLabel(payment.paymentMethod))}</div>
        </div>
        <div class="payment-meta-item">
          <div class="pm-label">Academic Session</div>
          <div class="pm-value" style="font-size:12px;">${esc(academicSessionLabel ?? fee.academicYear ?? "—")}</div>
        </div>
        ${fee.lateFeeAmount > 0 ? `
        <div class="payment-meta-item">
          <div class="pm-label">Base Fee</div>
          <div class="pm-value">${esc(inr(fee.amount))}</div>
        </div>
        <div class="payment-meta-item">
          <div class="pm-label">Late Fee</div>
          <div class="pm-value">${esc(inr(fee.lateFeeAmount))}</div>
        </div>` : ""}
      </div>
    </div>

  </div>

  <!-- ── FEE DETAILS ────────────────────────────────────────────────────── -->
  <div class="card">
    ${sectionHeader("Fee Details")}
    <div class="field-grid" style="margin-bottom:12px;">
      ${row("Fee Name", feeName)}
      ${fee.feeType !== feeName ? row("Fee Type", fee.feeType) : ""}
      ${fee.invoiceNumber ? row("Invoice Number", fee.invoiceNumber, true) : ""}
      ${feePeriodStr ? row("Fee Period", feePeriodStr) : ""}
      ${fee.academicYear ? row("Academic Year", fee.academicYear) : ""}
      ${fee.dueDate ? row("Due Date", fee.dueDate) : ""}
    </div>
    <table class="breakdown-table">
      <thead>
        <tr><th>Description</th><th class="amount-col">Amount</th></tr>
      </thead>
      <tbody>${breakdownRowsHtml}</tbody>
    </table>
  </div>

  <!-- ── ONLINE PAYMENT DETAILS ─────────────────────────────────────────── -->
  ${onlineSectionHtml}

  <!-- ── OFFLINE PAYMENT DETAILS ────────────────────────────────────────── -->
  ${offlineSectionHtml}

  <!-- ── NOTES ─────────────────────────────────────────────────────────── -->
  ${notesHtml}

  <!-- ── TRANSACTION VERIFICATION ──────────────────────────────────────── -->
  ${verificationHtml}

  <!-- ── SIGNATURE ─────────────────────────────────────────────────────── -->
  ${sigHtml}

  <!-- ── FOOTER ────────────────────────────────────────────────────────── -->
  <div class="receipt-footer">
    <div class="footer-disclaimer">Computer-generated receipt. No physical signature is required where a digital signature is configured.</div>
    <div class="footer-meta">Generated on ${esc(generatedAtIST)} &nbsp;&bull;&nbsp; ${esc(school.name)} &nbsp;&bull;&nbsp; BENIUS School ERP</div>
  </div>

</div>
<script>
// Auto-trigger print for browser-based print/PDF export
if (window.location.search.indexOf('print=1') !== -1) {
  window.onload = function() { window.print(); };
}
</script>
</body>
</html>`;
}
