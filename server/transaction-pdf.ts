/**
 * transaction-pdf.ts
 * Generates a professional A4-landscape Payment Transaction Report PDF using PDFKit.
 *
 * Rendering guarantees
 * ────────────────────
 * 1. Word-boundary wrapping using PDFKit widthOfString() — char-break only for
 *    genuinely unbreakable tokens such as Razorpay IDs.
 * 2. Row heights are pre-computed before pagination so no row is ever split across
 *    pages or clipped.
 * 3. Table column headers repeat on every page.
 * 4. Status pills use save/restore to isolate graphics state.
 * 5. Page count is known before drawing begins.
 * 6. INR amounts via en-IN locale; em dash for absent values.
 * 7. All timestamps displayed in Asia/Kolkata timezone.
 */

import PDFDocument from "pdfkit";
import { LedgerFilters } from "../shared/ledger-filters";
import { normalizePaymentMethod } from "@shared/payment-method";
import { formatInstantIST, formatDateOnly } from "@shared/ist-time";

// ── Fonts ─────────────────────────────────────────────────────────────────────
const FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// ── Palette — aligned with ledger-pdf.ts ──────────────────────────────────────
const C_DARK  = "#102b49";
const C_MUTED = "#5a6e80";
const C_RULE  = "#d9e1e8";
const C_WHITE = "#ffffff";
const C_BODY  = "#1a2332";
const C_THEAD = "#102b49";
const C_ALT   = "#f5f8fb";

const EM = "\u2014";

// ── Status normalization ────────────────────────────────────────────────────────
/**
 * Canonicalizes a status token to lowercase words separated by single spaces,
 * collapsing underscores, hyphens and repeated whitespace. This lets the renderer
 * treat backend variants (partially_refunded, partially-refunded, "partially
 * refunded") as one canonical status for styling, labels, and summary math.
 */
export function normalizeStatus(status: string | null | undefined): string {
  return String(status ?? "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Renders a canonical status as a friendly Title Case label (e.g. "Partially Refunded"). */
export function statusLabel(status: string | null | undefined): string {
  const norm = normalizeStatus(status);
  if (!norm) return EM;
  return norm
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Status pill styles (keyed by canonical normalized status) ──────────────────
const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  "captured":            { bg: "#d1fae5", fg: "#065f46" },
  "settled":             { bg: "#a7f3d0", fg: "#064e3b" },
  "authorized":          { bg: "#dbeafe", fg: "#1e40af" },
  "failed":              { bg: "#fee2e2", fg: "#7f1d1d" },
  "refunded":            { bg: "#ede9fe", fg: "#4c1d95" },
  "partially refunded":  { bg: "#e0e7ff", fg: "#3730a3" },
  "cancelled":           { bg: "#f3f4f6", fg: "#374151" },
  "pending":             { bg: "#fef3c7", fg: "#78350f" },
};

export function statusPillStyle(status: string): { bg: string; fg: string } {
  const key = normalizeStatus(status);
  return STATUS_PILL[key] ?? { bg: "#e5e7eb", fg: "#374151" };
}

// ── Formatters ─────────────────────────────────────────────────────────────────

export function fmtINR(n: number): string {
  return "\u20B9" + new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(n);
}

// Persisted transaction instants display in Asia/Kolkata with an IST suffix.
export function fmtDateTime(v: string | null | undefined): string {
  return formatInstantIST(v);
}

// Calendar DATE values (filter date ranges) render date-only, no timezone shift.
export function fmtDate(v: string | null | undefined): string {
  if (!v) return EM;
  return formatDateOnly(String(v).slice(0, 10));
}

export function s(v: unknown): string {
  if (v == null || v === "") return EM;
  return String(v);
}

// ── Filter summary ─────────────────────────────────────────────────────────────
/**
 * Builds a human-readable filter summary covering every LedgerFilters dimension.
 * Returns array of label strings; empty array means no active filters.
 */
export function buildFilterSummary(filters: LedgerFilters, selectionLabel?: string | null): string[] {
  const parts: string[] = [];

  if (filters.search)                 parts.push(`Search: "${filters.search}"`);
  if (filters.invoiceNumbers.length)  parts.push(`Invoice: ${filters.invoiceNumbers.slice(0, 2).join(", ")}${filters.invoiceNumbers.length > 2 ? ` +${filters.invoiceNumbers.length - 2} more` : ""}`);
  if (filters.receiptNumbers.length)  parts.push(`Receipt: ${filters.receiptNumbers.slice(0, 2).join(", ")}${filters.receiptNumbers.length > 2 ? ` +${filters.receiptNumbers.length - 2} more` : ""}`);
  if (filters.studentNames.length)    parts.push(`Student: ${filters.studentNames.slice(0, 2).join(", ")}${filters.studentNames.length > 2 ? ` +${filters.studentNames.length - 2} more` : ""}`);
  if (filters.dsids.length)           parts.push(`DSID: ${filters.dsids.slice(0, 2).join(", ")}${filters.dsids.length > 2 ? ` +${filters.dsids.length - 2} more` : ""}`);
  if (filters.referenceNumbers.length) parts.push(`Ref: ${filters.referenceNumbers.slice(0, 2).join(", ")}${filters.referenceNumbers.length > 2 ? ` +${filters.referenceNumbers.length - 2} more` : ""}`);
  if (filters.classes.length)         parts.push(`Class: ${filters.classes.join(", ")}`);
  if (filters.sections.length)        parts.push(`Section: ${filters.sections.join(", ")}`);
  if (filters.feeNames.length)        parts.push(`Fee: ${filters.feeNames.slice(0, 2).join(", ")}${filters.feeNames.length > 2 ? ` +${filters.feeNames.length - 2} more` : ""}`);
  if (filters.feeTypes.length)        parts.push(`Fee Type: ${filters.feeTypes.join(", ")}`);
  if (filters.feePeriods.length)      parts.push(`Fee Period: ${filters.feePeriods.slice(0, 2).join(", ")}${filters.feePeriods.length > 2 ? ` +${filters.feePeriods.length - 2} more` : ""}`);
  if (filters.frequencies.length)     parts.push(`Frequency: ${filters.frequencies.join(", ")}`);
  if (filters.statuses.length)        parts.push(`Status: ${filters.statuses.join(", ")}`);
  if (filters.paymentMethods.length)  parts.push(`Method: ${filters.paymentMethods.join(", ")}`);
  if (filters.academicYears.length)   parts.push(`Year: ${filters.academicYears.join(", ")}`);
  if (filters.amountMin != null && filters.amountMax != null)
    parts.push(`Amount: ${fmtINR(filters.amountMin)}–${fmtINR(filters.amountMax)}`);
  else if (filters.amountMin != null) parts.push(`Amount ≥ ${fmtINR(filters.amountMin)}`);
  else if (filters.amountMax != null) parts.push(`Amount ≤ ${fmtINR(filters.amountMax)}`);
  if (filters.dueDateFrom || filters.dueDateTo) {
    const from = filters.dueDateFrom ? fmtDate(filters.dueDateFrom) : "any";
    const to   = filters.dueDateTo   ? fmtDate(filters.dueDateTo)   : "any";
    parts.push(`Due: ${from} – ${to}`);
  }
  if (filters.paidDateFrom || filters.paidDateTo) {
    const from = filters.paidDateFrom ? fmtDate(filters.paidDateFrom) : "any";
    const to   = filters.paidDateTo   ? fmtDate(filters.paidDateTo)   : "any";
    parts.push(`Paid: ${from} – ${to}`);
  }
  if (selectionLabel) parts.push(`Selection: ${selectionLabel}`);

  return parts;
}

// ── Summary math ───────────────────────────────────────────────────────────────
export interface TxSummary {
  totalTransactions:  number;
  totalAmount:        number;   // lifecycle amount across every displayed row; not collected revenue
  successfulAmount:   number;   // captured/settled/refunded/partially-refunded rows
  failedAmount:       number;   // failed rows
  refundedAmount:     number;   // sum of refund_amount
}

const SUCCESSFUL_STATUSES = new Set(["captured", "settled", "refunded", "partially refunded"]);

export function computeSummary(rows: TxRow[]): TxSummary {
  let totalAmount      = 0;
  let successfulAmount = 0;
  let failedAmount     = 0;
  let refundedAmount   = 0;

  for (const r of rows) {
    const amt    = Number(r.amount       ?? 0);
    const refund = Number(r.refund_amount ?? 0);
    const st     = normalizeStatus(r.status);

    totalAmount += amt;
    if (SUCCESSFUL_STATUSES.has(st)) successfulAmount += amt;
    if (st === "failed")             failedAmount     += amt;
    refundedAmount += refund;
  }

  return {
    totalTransactions: rows.length,
    totalAmount,
    successfulAmount,
    failedAmount,
    refundedAmount,
  };
}

// ── Word-boundary text wrapping ───────────────────────────────────────────────
/**
 * Splits `text` into lines that fit within `maxWidth` using PDFKit's actual
 * glyph metrics. Splits only at whitespace boundaries; char-breaks only for
 * genuinely unbreakable tokens (long Razorpay/reference IDs).
 */
export function wrapToLines(
  doc: { widthOfString(s: string): number },
  text: string,
  maxWidth: number,
): string[] {
  if (!text || text === EM || text === "\u2014") return [text || EM];

  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (doc.widthOfString(candidate) <= maxWidth) {
      line = candidate;
    } else {
      if (line) { lines.push(line); line = ""; }
      if (doc.widthOfString(word) <= maxWidth) {
        line = word;
      } else {
        // Character-break — only for very long unbreakable tokens (IDs)
        let partial = "";
        for (const ch of word) {
          if (doc.widthOfString(partial + ch) <= maxWidth) {
            partial += ch;
          } else {
            if (partial) lines.push(partial);
            partial = ch;
          }
        }
        line = partial;
      }
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : [EM];
}

// ── Exported types ─────────────────────────────────────────────────────────────

/** Canonical TxRow contract (snake_case). */
export interface TxRow {
  id:                 string;
  attempt_number:     number | null;
  student_name:       string | null;
  student_id:         string | null;   // DSID
  class:              string | null;
  section:            string | null;
  invoice_number:     string | null;
  receipt_number:     string | null;
  fee_name:           string | null;
  fee_type:           string | null;
  payment_method:     string | null;
  transaction_at:     string | null;   // ISO timestamp
  amount:             number;
  status:             string;
  payment_id:         string | null;
  order_id:           string | null;
  reference_number:   string | null;
  failure_reason:     string | null;
  refund_amount:      number;
  refund_status:      string | null;
}

export interface TransactionPdfInput {
  school: {
    name:         string;
    /** Retained for input compatibility; transaction PDFs never fetch remote URLs. */
    logoUrl:      string | null;
    /** Trusted logo bytes loaded server-side from the tenant's local upload. */
    logoData?:    Buffer | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city:         string | null;
    state:        string | null;
    pinCode:      string | null;
    phone:        string | null;
    email:        string | null;
  };
  sessionLabel:    string | null;
  filters:         LedgerFilters;
  selectionLabel?: string | null;
  rows:            TxRow[];
  generatedAtIST:  string;
}

// ── Page geometry ──────────────────────────────────────────────────────────────
const PAGE_W    = 841.89;   // A4 landscape
const PAGE_H    = 595.28;
const MARGIN_H  = 32;
const MARGIN_V  = 32;
const HEADER_H  = 130;                    // top header block height
const TABLE_TOP = MARGIN_V + HEADER_H;    // top of column-header row
const COL_H     = 22;                     // column-header row height
const FOOTER_H  = 22;
const TABLE_LEFT = MARGIN_H;

// Usable vertical space for data rows per page
const USABLE_DATA_H = PAGE_H - MARGIN_V * 2 - HEADER_H - COL_H - FOOTER_H;

// Summary block height
const SUMMARY_H = 120;

const LINE_H    = 10;
const CELL_PAD  = 5;
const MIN_ROW_H = LINE_H + CELL_PAD * 2;
const H_PAD     = 3;
const MAX_ROW_LINES = Math.max(
  1,
  Math.floor((USABLE_DATA_H - CELL_PAD * 2) / LINE_H),
);

// ── Column definitions ────────────────────────────────────────────────────────
// A4 landscape usable = 841.89 − 2×32 = 777.89 → 778 pt
//
// Combined cells to stay readable:
//   student_name+student_id  →  "Student" col (name + DSID on next line)
//   class+section            →  "Class" col
//   invoice_number+receipt_number → "Invoice/Receipt" col
//   fee_name+fee_type        →  "Fee" col
//   failure_reason+refund    →  "Failure/Refund" col (compact)
//   payment_id / order_id / reference_number → separate wrap-independent cols

interface TxColDef {
  key:      string;
  label:    string;
  width:    number;
  fontSize: number;
  align?:   "right" | "center";
  wrap:     boolean;
}

const COLS: TxColDef[] = [
  { key: "sno",           label: "#",           width: 20,  fontSize: 7,   wrap: false },
  { key: "student",       label: "Student/DSID", width: 82,  fontSize: 7.5, wrap: true  },
  { key: "class",         label: "Cls/Sec",      width: 34,  fontSize: 7,   wrap: true  },
  { key: "inv_rec",       label: "Inv/Rcpt",     width: 56,  fontSize: 6.5, wrap: true  },
  { key: "fee",           label: "Fee/Type",     width: 72,  fontSize: 7,   wrap: true  },
  { key: "method",        label: "Method",       width: 56,  fontSize: 7,   wrap: true  },
  { key: "transaction_at",label: "Date/Time",    width: 72,  fontSize: 6.5, wrap: true  },
  { key: "amount",        label: "Amount",       width: 50,  fontSize: 7.5, align: "right", wrap: false },
  { key: "status",        label: "Status",       width: 66,  fontSize: 6.5, align: "center", wrap: false },
  { key: "payment_id",    label: "Payment ID",   width: 84,  fontSize: 6,   wrap: true  },
  { key: "order_id",      label: "Order ID",     width: 74,  fontSize: 6,   wrap: true  },
  { key: "reference",     label: "Reference",    width: 56,  fontSize: 6.5, wrap: true  },
  { key: "failure_refund",label: "Fail/Refund",  width: 56,  fontSize: 6.5, wrap: true  },
];
// 20+82+34+56+72+56+72+50+66+84+74+56+56 = 778 ✓

const TABLE_WIDTH = COLS.reduce((acc, c) => acc + c.width, 0);

// ── Assertion ─────────────────────────────────────────────────────────────────
(function () {
  const expected = Math.round(PAGE_W - MARGIN_H * 2);
  if (TABLE_WIDTH !== expected) {
    throw new Error(
      `[transaction-pdf] Column widths sum to ${TABLE_WIDTH} pt but expected ${expected} pt.`
    );
  }
})();

// ── Cell text helpers ─────────────────────────────────────────────────────────
export function getCellLines(row: TxRow, key: string): string[] {
  switch (key) {
    case "sno": return [""];  // filled by index
    case "student": {
      const name = s(row.student_name);
      const dsid = row.student_id ? `DSID: ${row.student_id}` : "";
      return dsid ? [name, dsid] : [name];
    }
    case "class": {
      const hasCls = row.class != null && String(row.class) !== "";
      const hasSec = row.section != null && String(row.section) !== "";
      if (hasCls && hasSec) return [`${row.class}-${row.section}`];
      if (hasCls)           return [String(row.class)];
      if (hasSec)           return [String(row.section)];
      return [EM];
    }
    case "inv_rec": {
      const inv = row.invoice_number ? `${row.invoice_number}` : EM;
      const rec = row.receipt_number ? `R: ${row.receipt_number}` : "";
      return rec ? [inv, rec] : [inv];
    }
    case "fee": {
      const fn  = s(row.fee_name ?? row.fee_type);
      const ft  = row.fee_type && row.fee_name && row.fee_type !== row.fee_name
        ? row.fee_type : "";
      return ft ? [fn, ft] : [fn];
    }
    case "method":        return [s(normalizePaymentMethod(row.payment_method) ?? row.payment_method)];
    case "transaction_at": {
      const value = fmtDateTime(row.transaction_at);
      if (value === EM) return [EM];
      const comma = value.indexOf(",");
      return comma > 0
        ? [value.slice(0, comma).trim(), value.slice(comma + 1).trim()]
        : [value];
    }
    case "amount":        return [fmtINR(Number(row.amount ?? 0))];
    case "status":        return [statusLabel(row.status)];
    case "payment_id":    return [s(row.payment_id)];
    case "order_id":      return [s(row.order_id)];
    case "reference":     return [s(row.reference_number)];
    case "failure_refund": {
      const parts: string[] = [];
      if (row.failure_reason) parts.push(row.failure_reason);
      if (Number(row.refund_amount) > 0) {
        parts.push(`Refund: ${fmtINR(Number(row.refund_amount))}${row.refund_status ? ` (${row.refund_status})` : ""}`);
      }
      return parts.length ? parts : [EM];
    }
    default: return [EM];
  }
}

// ── Main export ────────────────────────────────────────────────────────────────
export async function renderTransactionPdf(input: TransactionPdfInput): Promise<Buffer> {
  const logoBuffer = input.school.logoData ?? null;

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: false });
  doc.registerFont("Reg",  FONT_REG);
  doc.registerFont("Bold", FONT_BOLD);

  // ── Pre-compute wrapped lines for every wrappable cell ─────────────────────
  const allWrapped: Array<Record<string, string[]>> = input.rows.map(row => {
    const w: Record<string, string[]> = {};
    for (const col of COLS) {
      if (!col.wrap) continue;
      // Get semantic lines (e.g. name on line 1, DSID on line 2)
      const semantic = getCellLines(row, col.key);
      const maxW = col.width - H_PAD;
      const finalLines: string[] = [];
      (doc as any).font("Reg").fontSize(col.fontSize);
      for (const ln of semantic) {
        const wrapped = wrapToLines(doc as any, ln, maxW);
        finalLines.push(...wrapped);
      }
      if (finalLines.length > MAX_ROW_LINES) {
        const clipped = finalLines.slice(0, MAX_ROW_LINES);
        let last = clipped[MAX_ROW_LINES - 1] ?? "";
        while (last && (doc as any).widthOfString(`${last}\u2026`) > maxW) {
          last = last.slice(0, -1);
        }
        clipped[MAX_ROW_LINES - 1] = `${last}\u2026`;
        w[col.key] = clipped;
      } else {
        w[col.key] = finalLines.length ? finalLines : [EM];
      }
    }
    return w;
  });

  // ── Pre-compute row heights ────────────────────────────────────────────────
  const rowHeights = input.rows.map((row, i) => {
    let maxLines = 1;
    // Check wrapping cells
    for (const col of COLS) {
      if (!col.wrap) continue;
      const n = (allWrapped[i][col.key] ?? [""]).length;
      if (n > maxLines) maxLines = n;
    }
    // Non-wrap cells that may have semantic multi-lines
    for (const col of COLS) {
      if (col.wrap) continue;
      const sem = getCellLines(row, col.key);
      if (sem.length > maxLines) maxLines = sem.length;
    }
    (doc as any).font("Bold").fontSize(6.5);
    const statusLines = wrapToLines(
      doc as any,
      statusLabel(row.status),
      (COLS.find((col) => col.key === "status")?.width ?? 66) - 12,
    );
    if (statusLines.length > maxLines) maxLines = statusLines.length;
    return Math.max(maxLines * LINE_H + CELL_PAD * 2, MIN_ROW_H);
  });

  // ── Pagination ─────────────────────────────────────────────────────────────
  function paginate(): number[][] {
    const pages: number[][] = [];
    let page: number[] = [];
    let used = 0;
    for (let i = 0; i < input.rows.length; i++) {
      if (page.length > 0 && used + rowHeights[i] > USABLE_DATA_H) {
        pages.push(page); page = []; used = 0;
      }
      page.push(i);
      used += rowHeights[i];
    }
    if (page.length > 0 || pages.length === 0) pages.push(page);
    return pages;
  }

  const dataPages = paginate();
  const lastPageUsed = (dataPages[dataPages.length - 1] ?? [])
    .reduce((acc, i) => acc + rowHeights[i], 0);
  const summaryNeedsExtraPage = lastPageUsed + SUMMARY_H > USABLE_DATA_H;
  const totalPages = dataPages.length + (summaryNeedsExtraPage ? 1 : 0);

  // ── Filter summary line ───────────────────────────────────────────────────
  const filterParts = buildFilterSummary(input.filters, input.selectionLabel);
  const hasFilters  = filterParts.length > 0;
  const filterLine  = hasFilters
    ? `Filters: ${filterParts.join("  \u00b7  ")}`
    : "Scope: All transactions for matching invoices in this session";

  // ── Summary computation ───────────────────────────────────────────────────
  const summary = computeSummary(input.rows);

  // ── Render ────────────────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   ()          => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Page header ───────────────────────────────────────────────────────
    function drawHeader() {
      const top = MARGIN_V;

      // Left: logo + school info
      let nameX = TABLE_LEFT;
      if (logoBuffer) {
        try {
          (doc as any).image(logoBuffer, TABLE_LEFT, top + 2, { fit: [40, 40] });
          nameX = TABLE_LEFT + 46;
        } catch { /* skip */ }
      }
      (doc as any).font("Bold").fontSize(11.5).fillColor(C_DARK)
        .text(input.school.name, nameX, top, { width: 290, lineBreak: false });

      const addr: string[] = [];
      if (input.school.addressLine1) addr.push(input.school.addressLine1);
      if (input.school.addressLine2) addr.push(input.school.addressLine2);
      if (input.school.city)         addr.push(input.school.city);
      if (input.school.state)        addr.push(input.school.state);
      if (input.school.pinCode)      addr.push(input.school.pinCode);
      if (addr.length) {
        (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(addr.join(", "), nameX, top + 15, { width: 290, lineBreak: true });
      }
      const contact: string[] = [];
      if (input.school.phone) contact.push(input.school.phone);
      if (input.school.email) contact.push(input.school.email);
      if (contact.length) {
        (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(contact.join("  \u2022  "), nameX, top + 28, { width: 290, lineBreak: false });
      }

      // Right: report identity
      const RW = 240;
      const RX = TABLE_LEFT + TABLE_WIDTH - RW;

      (doc as any).font("Bold").fontSize(14.5).fillColor(C_DARK)
        .text("TRANSACTION REPORT", RX, top, { width: RW, align: "right", lineBreak: false });

      (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(
          "Invoice-scoped payment history. Each row is a payment attempt or an unmatched legacy/offline payment record.",
          RX, top + 20,
          { width: RW, align: "right" }
        );

      let ry = top + 40;
      if (input.sessionLabel) {
        (doc as any).font("Bold").fontSize(8).fillColor(C_DARK)
          .text(`Session: ${input.sessionLabel}`, RX, ry,
            { width: RW, align: "right", lineBreak: false });
        ry += 13;
      }
      (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`Generated: ${input.generatedAtIST}`, RX, ry,
          { width: RW, align: "right", lineBreak: false });
      ry += 11;
      (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(
          `${input.rows.length} transaction${input.rows.length !== 1 ? "s" : ""}`,
          RX, ry, { width: RW, align: "right", lineBreak: false }
        );

      // Filter / scope line (left side, below school info)
      (doc as any).font(hasFilters ? "Bold" : "Reg").fontSize(7.5)
        .fillColor(hasFilters ? C_DARK : C_MUTED)
        .text(filterLine, TABLE_LEFT, top + 60,
          { width: TABLE_WIDTH - RW - 4, lineBreak: true });

      // Horizontal rule
      const ruleY = MARGIN_V + HEADER_H - 6;
      (doc as any)
        .moveTo(TABLE_LEFT, ruleY)
        .lineTo(TABLE_LEFT + TABLE_WIDTH, ruleY)
        .strokeColor(C_RULE).lineWidth(0.5).stroke();
    }

    // ── Column headers ────────────────────────────────────────────────────
    function drawColHeaders(y: number) {
      const HFONT = 6;
      (doc as any).fillColor(C_THEAD).rect(TABLE_LEFT, y, TABLE_WIDTH, COL_H).fill();
      let x = TABLE_LEFT;
      for (const col of COLS) {
        const midY = y + (COL_H - HFONT) / 2;
        (doc as any).font("Bold").fontSize(HFONT).fillColor(C_WHITE);
        const lw = (doc as any).widthOfString(col.label);
        let lx: number;
        if (col.align === "right")  lx = x + col.width - H_PAD - lw;
        else if (col.align === "center") lx = x + (col.width - lw) / 2;
        else lx = x + H_PAD;
        (doc as any).text(col.label, lx, midY, { lineBreak: false });
        x += col.width;
      }
    }

    // ── Footer ────────────────────────────────────────────────────────────
    function drawFooter(pageNum: number) {
      const fy = PAGE_H - MARGIN_V - 13;
      const tag = input.sessionLabel ? `  \u2022  ${input.sessionLabel}` : "";
      (doc as any).font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(`${input.school.name}  \u2022  Transaction Report${tag}`,
          TABLE_LEFT, fy, { width: TABLE_WIDTH * 0.65, lineBreak: false });
      (doc as any).font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(`Page ${pageNum} of ${totalPages}`,
          TABLE_LEFT + TABLE_WIDTH * 0.65, fy,
          { width: TABLE_WIDTH * 0.35, align: "right", lineBreak: false });
    }

    // ── Data row ──────────────────────────────────────────────────────────
    function drawRow(row: TxRow, globalIdx: number, rowIdx: number, y: number, rowH: number) {
      // Alternating stripe
      if (globalIdx % 2 === 0) {
        (doc as any).fillColor(C_ALT).rect(TABLE_LEFT, y, TABLE_WIDTH, rowH).fill();
      }
      // Bottom separator
      (doc as any)
        .moveTo(TABLE_LEFT, y + rowH)
        .lineTo(TABLE_LEFT + TABLE_WIDTH, y + rowH)
        .strokeColor(C_RULE).lineWidth(0.25).stroke();

      let x = TABLE_LEFT;
      for (const col of COLS) {
        const textY = y + CELL_PAD;

        if (col.key === "sno") {
          (doc as any).font("Reg").fontSize(6.5).fillColor(C_MUTED)
            .text(String(globalIdx + 1), x + H_PAD, textY, { lineBreak: false });

        } else if (col.key === "status") {
          // ── Status pill ───────────────────────────────────────────────
          const ps    = statusPillStyle(row.status);
          const label = statusLabel(row.status);
          (doc as any).font("Bold").fontSize(col.fontSize);
          const labelLines = wrapToLines(doc as any, label, col.width - 12);
          const pillW = col.width - 8;
          const statusLineH = 8;
          const pillH = Math.min(rowH - 6, labelLines.length * statusLineH + 5);
          const pillX = x + 4;
          const pillY = y + (rowH - pillH) / 2;
          (doc as any).save();
          (doc as any).fillColor(ps.bg).roundedRect(pillX, pillY, pillW, pillH, 2).fill();
          (doc as any).restore();
          (doc as any).save();
          (doc as any).font("Bold").fontSize(col.fontSize).fillColor(ps.fg);
          for (let lineIndex = 0; lineIndex < labelLines.length; lineIndex++) {
            const line = labelLines[lineIndex];
            const stw = (doc as any).widthOfString(line);
            (doc as any).text(
              line,
              pillX + (pillW - stw) / 2,
              pillY + 3 + lineIndex * statusLineH,
              { lineBreak: false },
            );
          }
          (doc as any).restore();

        } else if (col.wrap) {
          // ── Wrapping cell (pre-computed) ──────────────────────────────
          const lines = allWrapped[rowIdx]?.[col.key] ?? [EM];
          for (let li = 0; li < lines.length; li++) {
            (doc as any).font("Reg").fontSize(col.fontSize).fillColor(C_BODY);
            const lw  = (doc as any).widthOfString(lines[li]);
            const lx  = col.align === "right"
              ? x + col.width - H_PAD - lw
              : x + H_PAD;
            (doc as any).text(lines[li], lx, textY + li * LINE_H, { lineBreak: false });
          }

        } else if (col.align === "right") {
          // ── Right-aligned single-line ─────────────────────────────────
          const ct = getCellLines(row, col.key)[0];
          (doc as any).font("Reg").fontSize(col.fontSize).fillColor(C_BODY);
          const tw = (doc as any).widthOfString(ct);
          (doc as any).text(ct, x + col.width - H_PAD - tw, textY, { lineBreak: false });

        } else {
          // ── Left-aligned single-line ──────────────────────────────────
          const ct = getCellLines(row, col.key)[0];
          const color = col.key === "transaction_at" ? C_MUTED : C_BODY;
          (doc as any).font("Reg").fontSize(col.fontSize).fillColor(color)
            .text(ct, x + H_PAD, textY, { lineBreak: false });
        }

        x += col.width;
      }
    }

    // ── Transaction summary block ─────────────────────────────────────────
    function drawSummary(y: number) {
      const SEC_GAP    = 10;
      const HEADING_FS = 9;
      const SUBTITLE_FS = 7.5;
      const HEADING_H  = 13;
      const SUBTITLE_H = 11;
      const PRE_CARD   = 8;
      const CARD_GAP   = 6;
      const CARD_H     = 64;
      const CARD_PAD_X = 10;
      const CARD_PAD_T = 10;
      const NUM_CARDS  = 5;

      const headY  = y + SEC_GAP;
      const cardsY = headY + HEADING_H + SUBTITLE_H + PRE_CARD;
      const cardW  = (TABLE_WIDTH - CARD_GAP * (NUM_CARDS - 1)) / NUM_CARDS;

      (doc as any).font("Bold").fontSize(HEADING_FS).fillColor(C_DARK)
        .text("TRANSACTION SUMMARY", TABLE_LEFT, headY, { lineBreak: false });
      (doc as any).font("Reg").fontSize(SUBTITLE_FS).fillColor(C_MUTED)
        .text("Lifecycle amounts for this report — only Successful Amount is collected revenue",
          TABLE_LEFT, headY + HEADING_H, { lineBreak: false });

      const CARDS = [
        {
          label: "TOTAL TRANSACTIONS",
          value: String(summary.totalTransactions),
          isAmount: false,
          borderColor: "#c8d6e0",
          accentColor: C_DARK,
          labelColor:  C_MUTED,
          amtColor:    C_DARK,
        },
        {
          label: "ALL STATUS AMOUNT",
          value: fmtINR(summary.totalAmount),
          isAmount: true,
          borderColor: "#c8d6e0",
          accentColor: C_DARK,
          labelColor:  C_MUTED,
          amtColor:    C_DARK,
        },
        {
          label: "SUCCESSFUL AMOUNT",
          value: fmtINR(summary.successfulAmount),
          isAmount: true,
          borderColor: "#6ee7b7",
          accentColor: "#059669",
          labelColor:  "#065f46",
          amtColor:    "#065f46",
        },
        {
          label: "FAILED AMOUNT",
          value: fmtINR(summary.failedAmount),
          isAmount: true,
          borderColor: "#fca5a5",
          accentColor: "#dc2626",
          labelColor:  "#7f1d1d",
          amtColor:    "#7f1d1d",
        },
        {
          label: "REFUNDED AMOUNT",
          value: fmtINR(summary.refundedAmount),
          isAmount: true,
          borderColor: "#c4b5fd",
          accentColor: "#7c3aed",
          labelColor:  "#4c1d95",
          amtColor:    "#4c1d95",
        },
      ];

      for (let ci = 0; ci < CARDS.length; ci++) {
        const cx  = TABLE_LEFT + ci * (cardW + CARD_GAP);
        const cd  = CARDS[ci];
        const lx  = cx + CARD_PAD_X;
        const lyt = cardsY + CARD_PAD_T;

        // White card
        (doc as any).save()
          .fillColor("#ffffff")
          .roundedRect(cx, cardsY, cardW, CARD_H, 4)
          .fill()
          .restore();

        // Accent stripe
        (doc as any).save()
          .roundedRect(cx, cardsY, cardW, CARD_H, 4)
          .clip()
          .fillColor(cd.accentColor)
          .rect(cx, cardsY, cardW, 3)
          .fill()
          .restore();

        // Border
        (doc as any)
          .roundedRect(cx, cardsY, cardW, CARD_H, 4)
          .strokeColor(cd.borderColor)
          .lineWidth(0.75)
          .stroke();

        // Label
        (doc as any).font("Bold").fontSize(6).fillColor(cd.labelColor)
          .text(cd.label, lx, lyt, { lineBreak: false });

        // Value
        (doc as any).font("Bold").fontSize(14).fillColor(cd.amtColor)
          .text(cd.value, lx, lyt + 13, { lineBreak: false });
      }
    }

    // ── Render loop ───────────────────────────────────────────────────────
    if (input.rows.length === 0) {
      // Empty report: still render header, footer, the "no results" notice AND
      // the zero-value transaction summary so accountants see explicit totals.
      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawHeader();
      drawColHeaders(MARGIN_V + HEADER_H);
      drawFooter(1);
      (doc as any).font("Reg").fontSize(10).fillColor(C_MUTED)
        .text("No transactions found for the selected filters.",
          TABLE_LEFT, TABLE_TOP + COL_H + 24,
          { width: TABLE_WIDTH, align: "center", lineBreak: false });
      drawSummary(TABLE_TOP + COL_H + 40);
      doc.end();
      return;
    }

    for (let pi = 0; pi < dataPages.length; pi++) {
      const pageNum  = pi + 1;
      const pageRows = dataPages[pi];
      const isLast   = pi === dataPages.length - 1;

      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawHeader();
      drawColHeaders(MARGIN_V + HEADER_H);
      drawFooter(pageNum);

      let y = TABLE_TOP + COL_H;
      for (const ri of pageRows) {
        drawRow(input.rows[ri], ri, ri, y, rowHeights[ri]);
        y += rowHeights[ri];
      }

      if (isLast && !summaryNeedsExtraPage) {
        drawSummary(y);
      }
    }

    // Overflow summary page — report header/footer + summary only.
    // No column headers here: an empty table header on a data-less page is
    // meaningless and looks like a rendering bug.
    if (summaryNeedsExtraPage) {
      const pn = dataPages.length + 1;
      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawHeader();
      drawFooter(pn);
      drawSummary(MARGIN_V + HEADER_H + 8);
    }

    doc.end();
  });
}
