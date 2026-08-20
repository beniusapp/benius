import { formatPersistedDateTimeIST } from "./persisted-date-time";

type FeeBreakdown = { name: string; purpose?: string; amount: number };

export type InvoiceDocumentData = {
  invoiceNumber: string | null;
  status: string;
  createdAt: string | Date | null;
  feeName: string;
  feeType: string;
  amount: number;
  lateFeeAmount: number;
  frequency: string | null;
  feePeriodStart: string | null;
  feePeriodEnd: string | null;
  academicYear: string | null;
  dueDate: string | null;
  notes: string | null;
  breakdown: FeeBreakdown[];
  lateFeeConfig: {
    enabled?: boolean;
    type?: string;
    grace_period_days?: number;
    flat_amount?: number;
    daily_rate?: number;
    max_cap?: number;
    tiered_slabs?: Array<{ from_day: number; to_day: number; amount: number }>;
  } | null;
  student: {
    name: string;
    digitalStudentId: string;
    guardianName: string | null;
    phone: string | null;
    className: string;
    section: string;
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
    /** Absolute URL to the school's uploaded authorized-signature image (tenant-scoped). */
    signatureUrl: string | null;
    /** Name/designation of the authorized signatory as configured by the school. */
    signatoryName: string | null;
  };
};

function esc(value: unknown): string {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function amountInWords(amount: number): string {
  const value = Math.max(0, Math.round(Number(amount) || 0));
  if (value === 0) return "Zero Rupees Only";
  const underThousand = (n: number): string => {
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
      "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    if (n < 20) return ones[n];
    if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ""}`;
    return `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${underThousand(n % 100)}` : ""}`;
  };
  const parts: string[] = [];
  let remaining = value;
  const groups: Array<[number, string]> = [[10_000_000, "Crore"], [100_000, "Lakh"], [1_000, "Thousand"]];
  for (const [divisor, label] of groups) {
    if (remaining >= divisor) {
      parts.push(`${underThousand(Math.floor(remaining / divisor))} ${label}`);
      remaining %= divisor;
    }
  }
  if (remaining) parts.push(underThousand(remaining));
  return `${parts.join(" ")} Rupees Only`;
}

function frequencyLabel(frequency: string | null): string {
  const labels: Record<string, string> = {
    monthly: "Monthly",
    quarterly: "Quarterly",
    annual: "Annual",
    "one-time": "One-Time",
  };
  return frequency ? (labels[frequency] ?? frequency) : "—";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}

function feePeriodLabel(data: InvoiceDocumentData): string {
  if (!data.feePeriodStart || !data.feePeriodEnd) return "—";
  if ((data.frequency === "annual" || data.frequency === "one-time") && data.academicYear) return data.academicYear;
  const start = new Date(`${data.feePeriodStart}T00:00:00Z`);
  const end = new Date(`${data.feePeriodEnd}T00:00:00Z`);
  const sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  if (sameMonth) return start.toLocaleDateString("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });
  return `${start.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short", year: "numeric" })} – ${end.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short", year: "numeric" })}`;
}

export function renderInvoiceDocument(data: InvoiceDocumentData): string {
  const totalPayable = data.amount + Math.max(0, data.lateFeeAmount);
  const period = feePeriodLabel(data);
  const schoolAddress = [
    data.school.addressLine1,
    data.school.addressLine2,
    [data.school.city, data.school.state, data.school.pinCode].filter(Boolean).join(", "),
    data.school.country && data.school.country !== "India" ? data.school.country : null,
  ].filter(Boolean).map(esc).join("<br>");
  const contact = [
    data.school.phone ? `Phone: ${esc(data.school.phone)}` : null,
    data.school.email ? `Email: ${esc(data.school.email)}` : null,
  ].filter(Boolean).join(" &nbsp;|&nbsp; ");
  const regulatory = [
    data.school.affiliationNumber ? `Affiliation No. ${esc(data.school.affiliationNumber)}` : null,
    data.school.gstin ? `GSTIN ${esc(data.school.gstin)}` : null,
  ].filter(Boolean).join(" &nbsp;|&nbsp; ");
  const components = data.breakdown.length > 0 ? `
    <section class="section">
      <h2>Fee Breakdown</h2>
      <table><thead><tr><th>Component</th><th>Description</th><th class="amount">Amount</th></tr></thead>
      <tbody>${data.breakdown.map((component) => `<tr><td>${esc(component.name)}</td><td>${esc(component.purpose || "—")}</td><td class="amount">${esc(formatAmount(Number(component.amount)))}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="2">Component subtotal</td><td class="amount">${esc(formatAmount(data.breakdown.reduce((sum, component) => sum + Number(component.amount || 0), 0)))}</td></tr></tfoot></table>
    </section>` : "";
  const lateFee = data.lateFeeConfig?.enabled
    ? `<section class="policy"><h2>Late Fee &amp; Penalty <strong>Enabled</strong></h2><p><b>Rule type:</b> ${esc(data.lateFeeConfig.type ?? "—")}${data.lateFeeConfig.type === "FLAT" ? ` &nbsp; <b>Penalty:</b> ${esc(formatAmount(Number(data.lateFeeConfig.flat_amount ?? 0)))}` : ""}${data.lateFeeConfig.type === "DAILY" ? ` &nbsp; <b>Daily penalty:</b> ${esc(formatAmount(Number(data.lateFeeConfig.daily_rate ?? 0)))} / day` : ""}</p></section>`
    : `<section class="policy muted"><h2>Late Fee &amp; Penalty <strong>Disabled</strong></h2></section>`;
  const statusClass = data.status === "Overdue" ? "overdue" : "due";
  const logo = data.school.logoUrl ? `<img class="logo" src="${esc(data.school.logoUrl)}" alt="">` : "";

  // ── Authorized signature block ────────────────────────────────────────────
  // Uses the school's configured signature image and signatory name.
  // Falls back to a blank space if not configured — never fabricated.
  const sigBlock = `
    <div class="sig-row">
      <div class="sig-box">
        ${data.school.signatureUrl
          ? `<img class="sig-img" src="${esc(data.school.signatureUrl)}" alt="Authorized Signature">`
          : `<div class="sig-space"></div>`}
        <div class="sig-line"></div>
        <p class="sig-lbl">Authorized Signatory</p>
        ${data.school.signatoryName ? `<p class="sig-name">${esc(data.school.signatoryName)}</p>` : ""}
        <p class="sig-school">${esc(data.school.name)}</p>
      </div>
    </div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice ${esc(data.invoiceNumber)}</title><style>
  @page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#172033;font:10.5pt/1.45 Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.invoice{width:min(100%,180mm);margin:24px auto;padding:11mm;background:#fff;box-shadow:0 8px 28px #0f274324}.header{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #14395d;padding-bottom:20px}.school{display:flex;gap:12px}.logo{width:44px;height:44px;object-fit:contain}.school h1{margin:0 0 4px;color:#102b49;font-size:17pt}.school p,.muted{margin:2px 0;color:#627386;font-size:8.6pt}.title{text-align:right}.title h2{margin:0;color:#102b49;font-size:24pt;letter-spacing:.14em}.number{font-size:15pt;font-weight:800;color:#102b49}.status{display:inline-block;margin-top:8px;padding:4px 8px;border:1px solid #d6a33c;font-size:8pt;font-weight:800;letter-spacing:.08em}.due{background:#fff7e8;color:#8b5a08}.overdue{background:#fff0f0;color:#9b1c1c;border-color:#e29a9a}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:22px 0;border-bottom:1px solid #d9e1e8}.grid>div+div{border-left:1px solid #d9e1e8;padding-left:18px}.eyebrow,h2{margin:0 0 8px;color:#102b49;font-size:8pt;text-transform:uppercase;letter-spacing:.1em}.student{font-size:13pt;font-weight:800}.rows{display:grid;grid-template-columns:auto 1fr;gap:5px 12px}.rows span:nth-child(odd){color:#708196;font-size:7.5pt;font-weight:800;text-transform:uppercase}.rows span:nth-child(even){text-align:right;font-weight:600}.section,.policy{margin-top:20px;break-inside:avoid}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#102b49;color:#fff;padding:8px;text-align:left;font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase}td{padding:8px;border-bottom:1px solid #dce4eb;overflow-wrap:anywhere}td:first-child{font-weight:700}.amount{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}tfoot td{background:#f6f8fa;font-weight:800}.policy{border-left:3px solid #3b6388;background:#f6f9fc;padding:10px}.policy h2{display:flex;justify-content:space-between}.summary{margin-top:20px;margin-left:auto;width:70mm;border:1px solid #b9c7d4;break-inside:avoid}.summary h2{margin:0;padding:8px 10px;background:#eef4f8}.summary p{display:flex;justify-content:space-between;gap:12px;margin:0;padding:6px 10px}.words{border-top:1px solid #dce4eb;background:#fafbfc;font-weight:700}.total{background:#102b49;color:#fff;font-size:11pt;font-weight:800;text-transform:uppercase}.total strong{font-size:15pt}.sig-row{display:flex;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid #d9e1e8;break-inside:avoid}.sig-box{text-align:center;min-width:140px}.sig-img{max-height:48px;max-width:160px;object-fit:contain;display:block;margin:0 auto 6px}.sig-space{height:48px}.sig-line{width:140px;border-top:1.5px solid #475569;margin:6px auto 4px}.sig-lbl{font-size:8pt;font-weight:700;color:#334155;margin:0}.sig-name{font-size:7.5pt;color:#334155;margin:2px 0 0}.sig-school{font-size:7pt;color:#708196;margin:2px 0 0}.footer{margin-top:16px;padding-top:12px;border-top:1px solid #d9e1e8;text-align:center;color:#617387;font-size:7.5pt}@media print{body{background:#fff}.invoice{width:auto;margin:0;box-shadow:none;padding:0}.section,.policy,.summary,.sig-row{break-inside:avoid}}@media(max-width:600px){.grid{grid-template-columns:1fr}.grid>div+div{border:0;border-top:1px solid #d9e1e8;padding:16px 0 0}.header{gap:12px}.title h2{font-size:18pt}}@media print{body{font-size:9pt;line-height:1.3}.invoice{max-width:none}.header{gap:12px;padding-bottom:10px}.school{gap:8px}.logo{width:36px;height:36px}.school h1{font-size:14pt;margin-bottom:2px}.school p,.muted{font-size:7.5pt;margin:1px 0}.title h2{font-size:20pt}.number{font-size:13pt}.status{margin-top:4px;padding:3px 6px;font-size:7pt}.grid{gap:12px;padding:12px 0}.grid>div+div{padding-left:12px}.eyebrow,h2{font-size:7pt;margin-bottom:5px}.student{font-size:11pt}.rows{gap:3px 8px}.rows span:nth-child(odd){font-size:6.7pt}.rows span:nth-child(even){font-size:8.2pt}.section,.policy{margin-top:11px}.section{break-inside:auto;page-break-inside:auto}th{padding:5px;font-size:6.7pt}td{padding:5px;font-size:8.2pt}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}.policy{padding:6px}.policy p{margin:2px 0;font-size:8pt}.summary{margin-top:11px;width:68mm}.summary h2{padding:5px 7px}.summary p{padding:4px 7px;font-size:8pt}.words{display:block}.words span{display:block}.words span:first-child{margin-bottom:2px;font-size:7pt;text-transform:uppercase;letter-spacing:.06em}.total{font-size:9.5pt}.total strong{font-size:12pt}.end-matter{break-inside:avoid;page-break-inside:avoid}.sig-row{margin-top:11px;padding-top:8px}.sig-img{max-height:30px}.sig-space{height:30px}.sig-line{margin:3px auto 2px}.sig-lbl{font-size:7pt}.sig-name{font-size:6.8pt}.sig-school{font-size:6.5pt}.footer{margin-top:9px;padding-top:7px;font-size:6.5pt}}</style></head><body>
  <article class="invoice"><header class="header"><div class="school">${logo}<div><h1>${esc(data.school.name)}</h1>${schoolAddress ? `<p>${schoolAddress}</p>` : ""}${contact ? `<p>${contact}</p>` : ""}${regulatory ? `<p>${regulatory}</p>` : ""}</div></div><div class="title"><h2>INVOICE</h2><span>Invoice No.</span><div class="number">${esc(data.invoiceNumber)}</div><span class="status ${statusClass}">STATUS: ${esc(data.status.toUpperCase())}</span></div></header>
  <section class="grid"><div><p class="eyebrow">Billed To / Student Details</p><p class="student">${esc(data.student.name)}</p><p class="muted">Student ID / MIS ID: ${esc(data.student.digitalStudentId)}</p><div class="rows"><span>Parent / Guardian</span><span>${esc(data.student.guardianName?.trim() || "Not available")}</span><span>Student Phone</span><span>${esc(data.student.phone?.trim() || "Not available")}</span><span>Class</span><span>${esc(data.student.className)}</span><span>Section</span><span>${esc(data.student.section)}</span></div></div><div><p class="eyebrow">Invoice Metadata</p><div class="rows"><span>Invoice Date &amp; Time</span><span>${esc(formatPersistedDateTimeIST(data.createdAt))}</span><span>Academic Session</span><span>${esc(data.academicYear)}</span><span>Frequency</span><span>${esc(frequencyLabel(data.frequency))}</span><span>Fee Period</span><span>${esc(period)}</span><span>Due Date</span><span>${esc(formatDate(data.dueDate))}</span></div></div></section>
  <section class="section"><h2>Invoice Details</h2><table><thead><tr><th>Description</th><th>Fee Type</th><th>Frequency</th><th>Fee Period</th><th class="amount">Amount</th></tr></thead><tbody><tr><td>${esc(data.feeName)}</td><td>${esc(data.feeType)}</td><td>${esc(frequencyLabel(data.frequency))}</td><td>${esc(period)}</td><td class="amount">${esc(formatAmount(data.amount))}</td></tr></tbody></table></section>
  ${components}${lateFee}<section class="summary"><h2>Amount Summary</h2><p><span>Invoice amount</span><strong>${esc(formatAmount(data.amount))}</strong></p>${data.lateFeeAmount > 0 ? `<p><span>Late fee assessed</span><strong>${esc(formatAmount(data.lateFeeAmount))}</strong></p>` : ""}<p class="words"><span>Amount in Words</span><span>${esc(amountInWords(data.amount))}</span></p><p class="total"><span>Total Payable</span><strong>${esc(formatAmount(totalPayable))}</strong></p></section>
   ${data.notes ? `<section class="policy"><h2>Notes</h2><p>${esc(data.notes)}</p></section>` : ""}<div class="end-matter">${sigBlock}<footer class="footer">This document is an invoice and confirms the amount due. A payment receipt is issued separately after successful payment.<br>Computer-generated document. No physical signature is required where a digital signature is configured.</footer></div></article><script>window.print()</script></body></html>`;
}