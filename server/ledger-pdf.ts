/**
 * ledger-pdf.ts
 * Professional A4-landscape Fee Ledger PDF using PDFKit.
 * Dynamic row heights — cells wrap rather than clip.
 * Status colour pills, improved header hierarchy, totals block.
 * DejaVu Sans throughout (₹ glyph support).
 */

import PDFDocument from "pdfkit";
import https from "https";
import http from "http";

const FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// ── Palette
const C_DARK   = "#102b49";
const C_MUTED  = "#627386";
const C_RULE   = "#d9e1e8";
const C_WHITE  = "#ffffff";
const C_BODY   = "#1a2332";
const C_THEAD  = "#102b49";
const C_ALT    = "#f8fafc";
const C_TOTAL  = "#0f2238"; // slightly darker than C_THEAD for totals row

// ── Status colours (text + background pill)
type StatusKey = "Paid" | "Due" | "Overdue" | "Partial" | "Waived";
const STATUS_FG: Record<string, string> = {
  Paid:    "#14532d",
  Overdue: "#7f1d1d",
  Due:     "#78350f",
  Partial: "#1e3a8a",
  Waived:  "#374151",
};
const STATUS_BG: Record<string, string> = {
  Paid:    "#dcfce7",
  Overdue: "#fee2e2",
  Due:     "#fef9c3",
  Partial: "#dbeafe",
  Waived:  "#f3f4f6",
};
function statusFg(s: string): string { return STATUS_FG[s] ?? "#374151"; }
function statusBg(s: string): string { return STATUS_BG[s] ?? "#f3f4f6"; }

// ── Helpers
function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end",  ()          => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}
async function safeImage(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try { return await fetchBuffer(url); } catch { return null; }
}

/** Format INR without unnecessary decimals: ₹1,00,000 */
function fmtINR(n: number): string {
  return "\u20B9" + new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    const d = /^\d{4}-\d{2}-\d{2}/.test(String(v))
      ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`)
      : new Date(String(v));
    return isNaN(d.getTime()) ? "—"
      : d.toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
  } catch { return "—"; }
}

function safe(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

function fmtMonthYear(v: string | null | undefined): string {
  if (!v) return "";
  try {
    const d = /^\d{4}-\d{2}-\d{2}/.test(String(v))
      ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`)
      : new Date(String(v));
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short", year: "numeric" });
  } catch { return ""; }
}

function fmtPeriod(start: string | null | undefined, end: string | null | undefined): string {
  const s1 = fmtMonthYear(start);
  const s2 = fmtMonthYear(end);
  if (s1 && s2 && s1 !== s2) return `${s1} – ${s2}`;
  if (s1) return s1;
  if (s2) return s2;
  return "—";
}

// ── Column definition
interface ColDef {
  key:      string;
  label:    string;
  width:    number;
  fontSize: number;
  align?:   "right" | "center";
  wrap:     boolean;  // true → text may wrap to multiple lines
}

// A4 landscape = 841.89 × 595.28 pt
// Margins 32pt each side → usable width = 841.89 − 64 = 777.89 ≈ 778 pt
const MARGIN_H   = 32;
const TABLE_LEFT = MARGIN_H;

// 17 columns totalling 778 pt
const COLS: ColDef[] = [
  { key: "invoice_number",   label: "Invoice No.",     width: 48,  fontSize: 6.5, wrap: true  },
  { key: "receipt_number",   label: "Receipt No.",     width: 46,  fontSize: 6.5, wrap: true  },
  { key: "student_name",     label: "Student",         width: 70,  fontSize: 8,   wrap: true  },
  { key: "student_id",       label: "DSID",            width: 36,  fontSize: 6.5, wrap: false },
  { key: "class",            label: "Class",           width: 22,  fontSize: 7.5, wrap: false },
  { key: "fee_name",         label: "Fee Name",        width: 62,  fontSize: 7.5, wrap: true  },
  { key: "fee_type",         label: "Fee Type",        width: 40,  fontSize: 7,   wrap: false },
  { key: "fee_period",       label: "Fee Period",      width: 56,  fontSize: 7,   wrap: true  },
  { key: "frequency",        label: "Frequency",       width: 36,  fontSize: 7,   wrap: false },
  { key: "invoice_amount",   label: "Amount",          width: 52,  fontSize: 8,   align: "right", wrap: false },
  { key: "due_date",         label: "Due Date",        width: 48,  fontSize: 7,   wrap: false },
  { key: "status",           label: "Status",          width: 42,  fontSize: 7.5, align: "center", wrap: false },
  { key: "paid_date",        label: "Paid On",         width: 48,  fontSize: 7,   wrap: false },
  { key: "amount_paid",      label: "Paid",            width: 46,  fontSize: 8,   align: "right", wrap: false },
  { key: "outstanding",      label: "Outstanding",     width: 50,  fontSize: 8,   align: "right", wrap: false },
  { key: "payment_method",   label: "Payment Method",  width: 46,  fontSize: 7,   wrap: false },
  { key: "reference_number", label: "Reference No.",   width: 30,  fontSize: 6.5, wrap: true  },
];
// Sum: 48+46+70+36+22+62+40+56+36+52+48+42+48+46+50+46+30 = 778

const TABLE_WIDTH = COLS.reduce((s, c) => s + c.width, 0); // 778

const PAGE_W   = 841.89;
const PAGE_H   = 595.28;
const MARGIN_V = 32;

// Header block height: logo + school info + report title + subtitle + session + generated + filters/scope + rule
const HEADER_H = 114;
const TABLE_TOP = MARGIN_V + HEADER_H;   // where the col-header row starts
const COL_H    = 20;                     // column header row height
const FOOTER_H = 22;
const USABLE_DATA_H = PAGE_H - MARGIN_V * 2 - HEADER_H - COL_H - FOOTER_H;

const LINE_H    = 9;    // pt per wrapped text line
const CELL_PAD  = 5;    // vertical padding per side inside a cell (top + bottom = 10pt total)
const MIN_ROW_H = LINE_H + CELL_PAD * 2; // 19 pt minimum

// ── Types
export interface LedgerRow {
  invoice_number:   string | null;
  receipt_number:   string | null;
  student_name:     string | null;
  student_id:       string | null;
  class:            string | null;
  section:          string | null;
  fee_name:         string | null;
  fee_type:         string | null;
  frequency:        string | null;
  invoice_amount:   number;
  amount_paid:      number;
  outstanding:      number;
  status:           string;
  due_date:         string | null;
  paid_date:        string | null;
  academic_year:    string | null;
  payment_method:   string | null;
  reference_number: string | null;
  notes:            string | null;
  fee_period_start: string | null;
  fee_period_end:   string | null;
}

export interface LedgerPdfInput {
  school: {
    name:         string;
    logoUrl:      string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city:         string | null;
    state:        string | null;
    pinCode:      string | null;
    phone:        string | null;
    email:        string | null;
  };
  sessionLabel:  string | null;
  filters: {
    search?:   string;
    status?:   string;
    class?:    string;
    feeName?:  string;
    feeType?:  string;
    dateFrom?: string;
    dateTo?:   string;
  };
  rows:           LedgerRow[];
  generatedAtIST: string;
}

// ── Resolve the display text for each cell key
function getCellText(row: LedgerRow, key: string): string {
  switch (key) {
    case "invoice_number":   return safe(row.invoice_number);
    case "receipt_number":   return safe(row.receipt_number);
    case "student_name":     return safe(row.student_name);
    case "student_id":       return safe(row.student_id);
    case "class":            return row.section ? `${safe(row.class)}-${safe(row.section)}` : safe(row.class);
    case "fee_name":         return safe(row.fee_name ?? row.fee_type);
    case "fee_type":         return safe(row.fee_type);
    case "fee_period":       return fmtPeriod(row.fee_period_start, row.fee_period_end);
    case "frequency":        return safe(row.frequency);
    case "invoice_amount":   return fmtINR(Number(row.invoice_amount ?? 0));
    case "due_date":         return fmtDate(row.due_date);
    case "status":           return safe(row.status);
    case "paid_date":        return fmtDate(row.paid_date);
    case "amount_paid":      return row.amount_paid ? fmtINR(Number(row.amount_paid)) : "—";
    case "outstanding":      return row.outstanding  ? fmtINR(Number(row.outstanding))  : "—";
    case "payment_method":   return safe(row.payment_method);
    case "reference_number": return safe(row.reference_number);
    default: return "—";
  }
}

/**
 * Estimate how many wrapped lines a piece of text occupies at a given column
 * inner width and font size. Uses DejaVu Sans average char width ≈ fontSize × 0.54.
 */
function countWrappedLines(text: string, innerWidth: number, fontSize: number): number {
  if (!text || text === "—") return 1;
  const charsPerLine = Math.max(1, Math.floor(innerWidth / (fontSize * 0.54)));
  let lines = 1;
  let col   = 0;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const wlen = word.length;
    if (col === 0) {
      col = wlen;
    } else if (col + 1 + wlen <= charsPerLine) {
      col += 1 + wlen;
    } else {
      lines++;
      col = wlen;
    }
    // Very long unbreakable token overflows across multiple lines
    while (col > charsPerLine) {
      lines++;
      col -= charsPerLine;
    }
  }
  return Math.max(1, lines);
}

/** Compute the pixel height needed for a data row based on wrapping columns. */
function computeRowH(row: LedgerRow): number {
  let maxLines = 1;
  for (const col of COLS) {
    if (!col.wrap) continue;
    const text     = getCellText(row, col.key);
    const innerW   = col.width - 6; // 3pt left + 3pt right padding
    const lines    = countWrappedLines(text, innerW, col.fontSize);
    if (lines > maxLines) maxLines = lines;
  }
  return Math.max(maxLines * LINE_H + CELL_PAD * 2, MIN_ROW_H);
}

/** Paginate rows by accumulated height, not by count. */
function paginate(rows: LedgerRow[], heights: number[]): number[][] {
  const pages: number[][] = [];
  let page: number[] = [];
  let used = 0;
  for (let i = 0; i < rows.length; i++) {
    if (page.length > 0 && used + heights[i] > USABLE_DATA_H) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(i);
    used += heights[i];
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

// ── Main export
export async function renderLedgerPdf(input: LedgerPdfInput): Promise<Buffer> {
  const logoBuffer = await safeImage(input.school.logoUrl);

  // Pre-compute row heights
  const rowHeights = input.rows.map(computeRowH);
  // Paginate
  const pages = input.rows.length === 0 ? [[]] : paginate(input.rows, rowHeights);
  const totalPages = pages.length;

  // Build filter summary string once
  const filterParts: string[] = [];
  if (input.filters.search)   filterParts.push(`Search = "${input.filters.search}"`);
  if (input.filters.status)   filterParts.push(`Status = ${input.filters.status}`);
  if (input.filters.class)    filterParts.push(`Class = ${input.filters.class}`);
  if (input.filters.feeName)  filterParts.push(`Fee Name = ${input.filters.feeName}`);
  if (input.filters.feeType)  filterParts.push(`Fee Type = ${input.filters.feeType}`);
  if (input.filters.dateFrom) filterParts.push(`From ${fmtDate(input.filters.dateFrom)}`);
  if (input.filters.dateTo)   filterParts.push(`To ${fmtDate(input.filters.dateTo)}`);
  const filterLine = filterParts.length
    ? `Filters: ${filterParts.join("  |  ")}`
    : "Scope: All matching records for this session";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: false });
    doc.registerFont("Reg",  FONT_REG);
    doc.registerFont("Bold", FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   ()          => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Page header
    function drawPageHeader(pageNum: number) {
      const top = MARGIN_V;

      // Logo (top-left)
      let logoRight = TABLE_LEFT;
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, TABLE_LEFT, top, { width: 44, height: 44, fit: [44, 44] });
          logoRight = TABLE_LEFT + 50;
        } catch { /* skip on error */ }
      }

      // School name + address (left block)
      doc.font("Bold").fontSize(12).fillColor(C_DARK)
        .text(input.school.name, logoRight, top, { width: 310, lineBreak: false });

      const addrParts: string[] = [];
      if (input.school.addressLine1) addrParts.push(input.school.addressLine1);
      if (input.school.city)         addrParts.push(input.school.city);
      if (input.school.state)        addrParts.push(input.school.state);
      if (input.school.pinCode)      addrParts.push(input.school.pinCode);
      if (addrParts.length) {
        doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(addrParts.join(", "), logoRight, top + 15, { width: 310 });
      }
      const contactParts: string[] = [];
      if (input.school.phone) contactParts.push(input.school.phone);
      if (input.school.email) contactParts.push(input.school.email);
      if (contactParts.length) {
        doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(contactParts.join("  |  "), logoRight, top + 27, { width: 310 });
      }

      // Right block — report title + meta
      const rightX = TABLE_LEFT + TABLE_WIDTH - 230;
      const rightW = 230;

      // "FEE LEDGER REPORT" — large bold title
      doc.font("Bold").fontSize(15).fillColor(C_DARK)
        .text("FEE LEDGER REPORT", rightX, top, { width: rightW, align: "right" });

      // Subtitle
      doc.font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(
          "Invoice-wise fee ledger showing billed amount, payments received, and outstanding balance.",
          rightX, top + 19,
          { width: rightW, align: "right" }
        );

      let metaY = top + 34;
      if (input.sessionLabel) {
        doc.font("Reg").fontSize(8).fillColor(C_DARK)
          .text(`Academic Session: ${input.sessionLabel}`, rightX, metaY, { width: rightW, align: "right" });
        metaY += 12;
      }
      doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`Generated: ${input.generatedAtIST}`, rightX, metaY, { width: rightW, align: "right" });
      metaY += 11;
      doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`Records: ${input.rows.length}`, rightX, metaY, { width: rightW, align: "right" });

      // Filter / scope line (full width, below left block)
      const filterY = top + 46;
      doc.font("Reg").fontSize(7.5).fillColor(filterParts.length ? C_DARK : C_MUTED)
        .text(filterLine, TABLE_LEFT, filterY, { width: TABLE_WIDTH - rightW - 8 });

      // Page indicator — bottom right of filter row
      doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`Page ${pageNum} of ${totalPages}`, rightX, filterY, { width: rightW, align: "right" });

      // Horizontal rule
      const ruleY = MARGIN_V + HEADER_H - 6;
      doc.moveTo(TABLE_LEFT, ruleY).lineTo(TABLE_LEFT + TABLE_WIDTH, ruleY)
        .strokeColor(C_RULE).lineWidth(0.5).stroke();

      // Column header row
      drawColHeaders(MARGIN_V + HEADER_H);
    }

    // ── Column header row
    function drawColHeaders(y: number) {
      doc.rect(TABLE_LEFT, y, TABLE_WIDTH, COL_H).fill(C_THEAD);
      let x = TABLE_LEFT;
      for (const col of COLS) {
        doc.font("Bold").fontSize(7.5).fillColor(C_WHITE)
          .text(col.label, x + 3, y + (COL_H - 7.5) / 2,
            { width: col.width - 6, align: col.align ?? "left", lineBreak: false });
        x += col.width;
      }
    }

    // ── Footer
    function drawFooter(pageNum: number) {
      const y = PAGE_H - MARGIN_V - 12;
      const sessionSuffix = input.sessionLabel ? `  •  ${input.sessionLabel}` : "";
      doc.font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(
          `${input.school.name}  •  Fee Ledger Report${sessionSuffix}`,
          TABLE_LEFT, y, { width: TABLE_WIDTH * 0.65 }
        );
      doc.font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(`Page ${pageNum} of ${totalPages}`,
          TABLE_LEFT + TABLE_WIDTH * 0.65, y,
          { width: TABLE_WIDTH * 0.35, align: "right" });
    }

    // ── Data row renderer
    function drawDataRow(row: LedgerRow, rowIdx: number, y: number, rowH: number) {
      // Alternating stripe
      if (rowIdx % 2 === 0) {
        doc.rect(TABLE_LEFT, y, TABLE_WIDTH, rowH).fill(C_ALT);
      }
      // Bottom border
      doc.moveTo(TABLE_LEFT, y + rowH)
        .lineTo(TABLE_LEFT + TABLE_WIDTH, y + rowH)
        .strokeColor(C_RULE).lineWidth(0.25).stroke();

      let x = TABLE_LEFT;
      for (const col of COLS) {
        const cellText = getCellText(row, col.key);
        const pad      = 3;   // horizontal padding (each side)
        const innerW   = col.width - pad * 2;
        const textX    = x + pad;
        const textY    = y + CELL_PAD;

        if (col.key === "status") {
          // Coloured pill background
          const pillH = Math.min(rowH - 6, 14);
          const pillY = y + (rowH - pillH) / 2;
          doc.roundedRect(x + 4, pillY, col.width - 8, pillH, 2).fill(statusBg(row.status));
          doc.font("Bold").fontSize(col.fontSize).fillColor(statusFg(row.status))
            .text(cellText, x + 4, pillY + (pillH - col.fontSize) / 2 + 0.5,
              { width: col.width - 8, align: "center", lineBreak: false });
        } else {
          const textColor = C_BODY;
          if (col.wrap) {
            doc.font("Reg").fontSize(col.fontSize).fillColor(textColor)
              .text(cellText, textX, textY,
                { width: innerW, align: col.align ?? "left", lineBreak: true });
          } else {
            doc.font("Reg").fontSize(col.fontSize).fillColor(textColor)
              .text(cellText, textX, textY,
                { width: innerW, align: col.align ?? "left", lineBreak: false });
          }
        }

        x += col.width;
      }
    }

    // ── Totals row
    function drawTotals(y: number) {
      const totalInvoiced    = input.rows.reduce((s, r) => s + Number(r.invoice_amount ?? 0), 0);
      const totalPaid        = input.rows.reduce((s, r) => s + Number(r.amount_paid    ?? 0), 0);
      const totalOutstanding = input.rows.reduce((s, r) => s + Number(r.outstanding    ?? 0), 0);

      const TOTAL_H = 22;
      doc.rect(TABLE_LEFT, y, TABLE_WIDTH, TOTAL_H).fill(C_TOTAL);

      // "TOTALS" label
      doc.font("Bold").fontSize(8).fillColor(C_WHITE)
        .text("TOTALS", TABLE_LEFT + 4, y + (TOTAL_H - 8) / 2, { width: 80, lineBreak: false });

      // Place numeric totals under their respective columns
      let sx = TABLE_LEFT;
      for (const col of COLS) {
        let totalText = "";
        if (col.key === "invoice_amount") totalText = fmtINR(totalInvoiced);
        else if (col.key === "amount_paid")   totalText = fmtINR(totalPaid);
        else if (col.key === "outstanding")   totalText = fmtINR(totalOutstanding);

        if (totalText) {
          doc.font("Bold").fontSize(8).fillColor(C_WHITE)
            .text(totalText, sx + 2, y + (TOTAL_H - 8) / 2,
              { width: col.width - 4, align: "right", lineBreak: false });
        }
        sx += col.width;
      }

      // Human-readable summary lines below the row
      const summaryY = y + TOTAL_H + 6;
      const col1X = TABLE_LEFT;
      const col2X = TABLE_LEFT + TABLE_WIDTH / 3;
      const col3X = TABLE_LEFT + (TABLE_WIDTH / 3) * 2;
      const colW  = TABLE_WIDTH / 3 - 4;

      doc.font("Bold").fontSize(8).fillColor(C_DARK)
        .text(`Total Invoiced:  ${fmtINR(totalInvoiced)}`, col1X, summaryY, { width: colW, lineBreak: false });
      doc.font("Bold").fontSize(8).fillColor(C_DARK)
        .text(`Total Paid:  ${fmtINR(totalPaid)}`, col2X, summaryY, { width: colW, lineBreak: false });
      doc.font("Bold").fontSize(8).fillColor(C_DARK)
        .text(`Total Outstanding:  ${fmtINR(totalOutstanding)}`, col3X, summaryY, { width: colW, lineBreak: false });
    }

    // ── Empty report
    if (input.rows.length === 0) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawPageHeader(1);
      drawFooter(1);
      doc.font("Reg").fontSize(10).fillColor(C_MUTED)
        .text("No records found for the selected filters.",
          TABLE_LEFT, TABLE_TOP + COL_H + 24, { width: TABLE_WIDTH, align: "center" });
      doc.end();
      return;
    }

    // ── Render each page
    for (let pi = 0; pi < pages.length; pi++) {
      const pageNum   = pi + 1;
      const pageRows  = pages[pi];
      const isLast    = pi === pages.length - 1;

      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawPageHeader(pageNum);
      drawFooter(pageNum);

      // Data rows
      let y = TABLE_TOP + COL_H;
      for (let ri = 0; ri < pageRows.length; ri++) {
        const rowIdx = pageRows[ri];
        const row    = input.rows[rowIdx];
        const rowH   = rowHeights[rowIdx];
        drawDataRow(row, rowIdx, y, rowH);
        y += rowH;
      }

      // Totals only on the last page, if they fit
      if (isLast) {
        const TOTAL_BLOCK_H = 22 + 18; // bar + summary text
        if (y + TOTAL_BLOCK_H + 4 < PAGE_H - MARGIN_V - FOOTER_H) {
          drawTotals(y + 6);
        }
        // If totals don't fit, they're omitted (edge case: extremely dense last page)
      }
    }

    doc.end();
  });
}
