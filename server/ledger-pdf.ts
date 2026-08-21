/**
 * ledger-pdf.ts
 * Professional A4-landscape Fee Ledger PDF using PDFKit.
 *
 * Design principles
 * ─────────────────
 * • Dynamic row heights — rows expand to fit wrapped content; no text ever clips.
 * • Status colour pills (green / amber / red / blue / grey).
 * • Two-pass layout: widths and page breaks are computed before any drawing begins
 *   so page counts are exact, including a possible overflow page for the totals block.
 * • Totals always appear — if they don't fit on the last data page they move to a
 *   fresh continuation page.
 * • Page number appears only in the footer (never duplicated in the header).
 * • DejaVu Sans throughout for reliable ₹ glyph rendering.
 */

import PDFDocument from "pdfkit";
import https from "https";
import http from "http";

// ── Font paths ────────────────────────────────────────────────────────────────
const FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// ── Palette ───────────────────────────────────────────────────────────────────
const C_DARK  = "#102b49";
const C_MUTED = "#627386";
const C_RULE  = "#d9e1e8";
const C_WHITE = "#ffffff";
const C_BODY  = "#1a2332";
const C_THEAD = "#102b49";
const C_ALT   = "#f7f9fb";   // very-light blue-grey stripe

// Status pill colours (background / foreground text)
const STATUS_BG: Record<string, string> = {
  Paid:    "#dcfce7",
  Overdue: "#fee2e2",
  Due:     "#fef9c3",
  Partial: "#dbeafe",
  Waived:  "#f3f4f6",
};
const STATUS_FG: Record<string, string> = {
  Paid:    "#14532d",
  Overdue: "#7f1d1d",
  Due:     "#78350f",
  Partial: "#1e3a8a",
  Waived:  "#374151",
};
const statusBg = (s: string) => STATUS_BG[s] ?? "#f3f4f6";
const statusFg = (s: string) => STATUS_FG[s] ?? "#374151";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data",  (c: Buffer) => chunks.push(c));
      res.on("end",   ()          => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}
async function safeImage(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try { return await fetchBuffer(url); } catch { return null; }
}

/** INR whole-rupee formatting: ₹1,00,000 */
function fmtINR(n: number): string {
  return "\u20B9" + new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

/** "22 Apr 2027" — consistent Indian readable date */
function fmtDate(v: string | null | undefined): string {
  if (!v) return "\u2014";
  try {
    const d = /^\d{4}-\d{2}-\d{2}/.test(String(v))
      ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`)
      : new Date(String(v));
    if (isNaN(d.getTime())) return "\u2014";
    return d.toLocaleDateString("en-IN", {
      timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return "\u2014"; }
}

/** Safe string — returns em dash for null / empty */
function s(v: unknown): string {
  if (v == null || v === "") return "\u2014";
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
  return s1 || s2 || "\u2014";
}

// ── Page geometry ─────────────────────────────────────────────────────────────
const PAGE_W   = 841.89;   // A4 landscape width  (pt)
const PAGE_H   = 595.28;   // A4 landscape height (pt)
const MARGIN_H = 32;       // left / right margin
const MARGIN_V = 32;       // top / bottom margin

// Header block: logo + school info + report title + subtitle + session/generated/records
// + filter/scope line + ruled separator
const HEADER_H = 118;
const TABLE_TOP = MARGIN_V + HEADER_H;   // top of the column-header row

const COL_H    = 22;    // column-header row height (pt)
const FOOTER_H = 20;    // space reserved at bottom for footer text

// Available height for data rows on any page
const USABLE_DATA_H = PAGE_H - MARGIN_V * 2 - HEADER_H - COL_H - FOOTER_H;

// Typography
const LINE_H    = 9;    // pt per wrapped text line
const CELL_PAD  = 5;    // vertical padding (top AND bottom) inside a cell
const MIN_ROW_H = LINE_H + CELL_PAD * 2;  // 19 pt minimum row height

// ── Column definitions ────────────────────────────────────────────────────────
//
// Usable table width = PAGE_W − 2 × MARGIN_H = 841.89 − 64 = 777.89 ≈ 778 pt
//
// Priority columns (wider):  Student, Fee Name, Fee Period, Payment Method, Reference No.
// Narrow identifiers:        Invoice No., Receipt No., DSID
// Short values (not padded): Status, Amount, Paid, Outstanding, Due Date, Paid On
//
// wrap: true  → PDFKit lineBreak allowed; row height expands to fit
// wrap: false → single line, lineBreak disabled (values are short and predictable)

interface ColDef {
  key:      string;
  label:    string;
  width:    number;   // pt
  fontSize: number;   // pt
  align?:   "right" | "center";
  wrap:     boolean;
}

const COLS: ColDef[] = [
  // key                 label              width  fs    align     wrap
  { key:"invoice_number",  label:"Invoice No.",    width: 48, fontSize:6.5,                wrap:true  },
  { key:"receipt_number",  label:"Receipt No.",    width: 46, fontSize:6.5,                wrap:true  },
  { key:"student_name",    label:"Student",        width: 76, fontSize:8,                  wrap:true  },
  { key:"student_id",      label:"DSID",           width: 36, fontSize:6.5,                wrap:true  },
  { key:"class",           label:"Class",          width: 22, fontSize:7.5,                wrap:false },
  { key:"fee_name",        label:"Fee Name",       width: 66, fontSize:7.5,                wrap:true  },
  { key:"fee_type",        label:"Fee Type",       width: 40, fontSize:7,                  wrap:true  },
  { key:"fee_period",      label:"Fee Period",     width: 56, fontSize:7,                  wrap:true  },
  { key:"frequency",       label:"Frequency",      width: 36, fontSize:7,                  wrap:false },
  { key:"invoice_amount",  label:"Amount",         width: 48, fontSize:8,   align:"right", wrap:false },
  { key:"due_date",        label:"Due Date",       width: 46, fontSize:7,                  wrap:false },
  { key:"status",          label:"Status",         width: 40, fontSize:7.5, align:"center",wrap:false },
  { key:"paid_date",       label:"Paid On",        width: 46, fontSize:7,                  wrap:false },
  { key:"amount_paid",     label:"Paid",           width: 44, fontSize:8,   align:"right", wrap:false },
  { key:"outstanding",     label:"Outstanding",    width: 48, fontSize:8,   align:"right", wrap:false },
  { key:"payment_method",  label:"Payment Method", width: 48, fontSize:7,                  wrap:true  },
  { key:"reference_number",label:"Reference No.",  width: 32, fontSize:6.5,                wrap:true  },
];
// 48+46+76+36+22+66+40+56+36+48+46+40+46+44+48+48+32 = 778

const TABLE_WIDTH = COLS.reduce((sum, c) => sum + c.width, 0);
const TABLE_LEFT  = MARGIN_H;

// ── Development-time assertion ────────────────────────────────────────────────
// Catches accidental column-width drift immediately.
(function assertTableWidth() {
  const expected = Math.round(PAGE_W - MARGIN_H * 2);   // 778 pt
  if (TABLE_WIDTH !== expected) {
    throw new Error(
      `[ledger-pdf] Column widths sum to ${TABLE_WIDTH} pt but expected ${expected} pt ` +
      `(PAGE_W ${PAGE_W} − 2 × MARGIN_H ${MARGIN_H}). Adjust COLS widths to fix.`
    );
  }
})();

// ── Exported types ────────────────────────────────────────────────────────────
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
  sessionLabel:   string | null;
  filters: {
    search?:    string;
    status?:    string;
    class?:     string;
    feeName?:   string;
    feeType?:   string;
    dateFrom?:  string;
    dateTo?:    string;
  };
  rows:           LedgerRow[];
  generatedAtIST: string;
}

// ── Cell text resolver ────────────────────────────────────────────────────────
function getCellText(row: LedgerRow, key: string): string {
  switch (key) {
    case "invoice_number":
      return s(row.invoice_number);
    case "receipt_number":
      return s(row.receipt_number);
    case "student_name":
      return s(row.student_name);
    case "student_id":
      return s(row.student_id);
    case "class":
      return row.section ? `${s(row.class)}-${s(row.section)}` : s(row.class);
    case "fee_name":
      return s(row.fee_name ?? row.fee_type);
    case "fee_type":
      return s(row.fee_type);
    case "fee_period":
      return fmtPeriod(row.fee_period_start, row.fee_period_end);
    case "frequency":
      return s(row.frequency);
    case "invoice_amount":
      return fmtINR(Number(row.invoice_amount ?? 0));
    case "due_date":
      return fmtDate(row.due_date);
    case "status":
      return s(row.status);
    case "paid_date":
      return fmtDate(row.paid_date);
    case "amount_paid":
      return row.amount_paid ? fmtINR(Number(row.amount_paid)) : "\u2014";
    case "outstanding":
      return row.outstanding  ? fmtINR(Number(row.outstanding))  : "\u2014";
    case "payment_method":
      return s(row.payment_method);
    case "reference_number":
      return s(row.reference_number);
    default:
      return "\u2014";
  }
}

// ── Row-height pre-computation ────────────────────────────────────────────────
/**
 * Estimate how many lines a piece of text needs inside `innerWidth` pt at `fontSize` pt.
 * Uses DejaVu Sans average character width ≈ fontSize × 0.54.
 * Handles long unbreakable tokens (e.g. Razorpay IDs) by treating them as
 * consecutive overflows.
 */
function countLines(text: string, innerWidth: number, fontSize: number): number {
  if (!text || text === "\u2014" || text === "—") return 1;
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
    // Long unbreakable token — spills across multiple lines
    while (col > charsPerLine) {
      lines++;
      col -= charsPerLine;
    }
  }
  return Math.max(1, lines);
}

function computeRowH(row: LedgerRow): number {
  let maxLines = 1;
  for (const col of COLS) {
    if (!col.wrap) continue;
    const text   = getCellText(row, col.key);
    const innerW = col.width - 6;   // 3 pt left + 3 pt right padding
    const lines  = countLines(text, innerW, col.fontSize);
    if (lines > maxLines) maxLines = lines;
  }
  return Math.max(maxLines * LINE_H + CELL_PAD * 2, MIN_ROW_H);
}

// ── Pagination ────────────────────────────────────────────────────────────────
/** Returns an array of pages; each page is an array of row indices. */
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
  if (page.length > 0 || pages.length === 0) pages.push(page);
  return pages;
}

// ── Main renderer ─────────────────────────────────────────────────────────────
export async function renderLedgerPdf(input: LedgerPdfInput): Promise<Buffer> {
  const logoBuffer = await safeImage(input.school.logoUrl);

  // ── Pre-compute layout ─────────────────────────────────────────────────────
  const rowHeights  = input.rows.map(computeRowH);
  const dataPages   = paginate(input.rows, rowHeights);

  // Totals block height: navy bar (22 pt) + three summary text lines (~24 pt) + gap
  const TOTALS_H = 22 + 28;

  // Does the totals block fit on the last data page?
  const lastDataPageRows = dataPages[dataPages.length - 1] ?? [];
  const lastDataPageUsed = lastDataPageRows.reduce((sum, i) => sum + rowHeights[i], 0);
  const totalsNeedExtraPage = (lastDataPageUsed + 8 + TOTALS_H) > USABLE_DATA_H;

  const totalPages = dataPages.length + (totalsNeedExtraPage ? 1 : 0);

  // ── Filter/scope summary line (computed once) ──────────────────────────────
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

  const hasFilters = filterParts.length > 0;

  // ── Totals summary values (computed once from the full dataset) ────────────
  const totalInvoiced    = input.rows.reduce((t, r) => t + Number(r.invoice_amount ?? 0), 0);
  const totalPaid        = input.rows.reduce((t, r) => t + Number(r.amount_paid    ?? 0), 0);
  const totalOutstanding = input.rows.reduce((t, r) => t + Number(r.outstanding    ?? 0), 0);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: false });
    doc.registerFont("Reg",  FONT_REG);
    doc.registerFont("Bold", FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   ()          => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── drawPageHeader ─────────────────────────────────────────────────────
    function drawPageHeader(pageNum: number) {
      const top = MARGIN_V;

      // Logo (top-left)
      let infoX = TABLE_LEFT;
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, TABLE_LEFT, top, { width: 44, height: 44, fit: [44, 44] });
          infoX = TABLE_LEFT + 50;
        } catch { /* logo unavailable */ }
      }

      // School name
      doc.font("Bold").fontSize(12).fillColor(C_DARK)
        .text(input.school.name, infoX, top, { width: 300, lineBreak: false });

      // Address
      const addrParts: string[] = [];
      if (input.school.addressLine1) addrParts.push(input.school.addressLine1);
      if (input.school.city)         addrParts.push(input.school.city);
      if (input.school.state)        addrParts.push(input.school.state);
      if (input.school.pinCode)      addrParts.push(input.school.pinCode);
      if (addrParts.length) {
        doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(addrParts.join(", "), infoX, top + 15, { width: 300 });
      }

      // Contact
      const contactParts: string[] = [];
      if (input.school.phone) contactParts.push(input.school.phone);
      if (input.school.email) contactParts.push(input.school.email);
      if (contactParts.length) {
        doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(contactParts.join("  \u2022  "), infoX, top + 27, { width: 300 });
      }

      // ── Right block — report identity ──────────────────────────────────
      const rightW = 232;
      const rightX = TABLE_LEFT + TABLE_WIDTH - rightW;

      // "FEE LEDGER REPORT"
      doc.font("Bold").fontSize(15).fillColor(C_DARK)
        .text("FEE LEDGER REPORT", rightX, top, { width: rightW, align: "right", lineBreak: false });

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
        .text(
          `Records: ${input.rows.length}`,
          rightX, metaY,
          { width: rightW, align: "right" }
        );

      // ── Filter / scope line (full width, below school block) ───────────
      const filterY = top + 48;
      doc.font(hasFilters ? "Bold" : "Reg")
        .fontSize(7.5)
        .fillColor(hasFilters ? C_DARK : C_MUTED)
        .text(filterLine, TABLE_LEFT, filterY, { width: TABLE_WIDTH - rightW - 8 });

      // ── Horizontal rule ────────────────────────────────────────────────
      const ruleY = MARGIN_V + HEADER_H - 5;
      doc.moveTo(TABLE_LEFT, ruleY)
        .lineTo(TABLE_LEFT + TABLE_WIDTH, ruleY)
        .strokeColor(C_RULE).lineWidth(0.5).stroke();

      // ── Column header row ──────────────────────────────────────────────
      drawColHeaders(MARGIN_V + HEADER_H);
    }

    // ── drawColHeaders ─────────────────────────────────────────────────────
    function drawColHeaders(y: number) {
      // Dark background
      doc.rect(TABLE_LEFT, y, TABLE_WIDTH, COL_H).fill(C_THEAD);

      let x = TABLE_LEFT;
      for (const col of COLS) {
        // Vertically centre the label in COL_H
        const labelY = y + (COL_H - 7.5) / 2;
        doc.font("Bold").fontSize(7.5).fillColor(C_WHITE)
          .text(col.label, x + 3, labelY,
            { width: col.width - 6, align: col.align ?? "left", lineBreak: false });
        x += col.width;
      }
    }

    // ── drawFooter ─────────────────────────────────────────────────────────
    // Page number appears ONLY here.
    function drawFooter(pageNum: number) {
      const y = PAGE_H - MARGIN_V - 12;
      const sessionSuffix = input.sessionLabel
        ? `  \u2022  ${input.sessionLabel}` : "";
      doc.font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(
          `${input.school.name}  \u2022  Fee Ledger Report${sessionSuffix}`,
          TABLE_LEFT, y,
          { width: TABLE_WIDTH * 0.65 }
        );
      doc.font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(
          `Page ${pageNum} of ${totalPages}`,
          TABLE_LEFT + TABLE_WIDTH * 0.65, y,
          { width: TABLE_WIDTH * 0.35, align: "right" }
        );
    }

    // ── drawDataRow ────────────────────────────────────────────────────────
    function drawDataRow(row: LedgerRow, globalIdx: number, y: number, rowH: number) {
      // Alternating row stripe
      if (globalIdx % 2 === 0) {
        doc.rect(TABLE_LEFT, y, TABLE_WIDTH, rowH).fill(C_ALT);
      }
      // Bottom border
      doc.moveTo(TABLE_LEFT, y + rowH)
        .lineTo(TABLE_LEFT + TABLE_WIDTH, y + rowH)
        .strokeColor(C_RULE).lineWidth(0.25).stroke();

      let x = TABLE_LEFT;
      for (const col of COLS) {
        const cellText = getCellText(row, col.key);
        const pad      = 3;           // horizontal padding each side
        const innerW   = col.width - pad * 2;
        const textX    = x + pad;
        const textY    = y + CELL_PAD;

        if (col.key === "status") {
          // Coloured pill
          const pillH = Math.min(rowH - 6, 13);
          const pillY = y + (rowH - pillH) / 2;
          doc.roundedRect(x + 4, pillY, col.width - 8, pillH, 2).fill(statusBg(row.status));
          doc.font("Bold").fontSize(col.fontSize).fillColor(statusFg(row.status))
            .text(cellText, x + 4, pillY + (pillH - col.fontSize) / 2 + 0.5,
              { width: col.width - 8, align: "center", lineBreak: false });
        } else if (col.wrap) {
          doc.font("Reg").fontSize(col.fontSize).fillColor(C_BODY)
            .text(cellText, textX, textY,
              { width: innerW, align: col.align ?? "left", lineBreak: true });
        } else {
          doc.font("Reg").fontSize(col.fontSize).fillColor(C_BODY)
            .text(cellText, textX, textY,
              { width: innerW, align: col.align ?? "left", lineBreak: false });
        }

        x += col.width;
      }
    }

    // ── drawTotals ─────────────────────────────────────────────────────────
    function drawTotals(y: number) {
      // Navy bar
      doc.rect(TABLE_LEFT, y, TABLE_WIDTH, 22).fill(C_THEAD);

      // "TOTALS" label
      doc.font("Bold").fontSize(8).fillColor(C_WHITE)
        .text("TOTALS", TABLE_LEFT + 4, y + (22 - 8) / 2, { width: 80, lineBreak: false });

      // Column-aligned figures inside the bar
      let sx = TABLE_LEFT;
      for (const col of COLS) {
        let txt = "";
        if (col.key === "invoice_amount") txt = fmtINR(totalInvoiced);
        else if (col.key === "amount_paid")    txt = fmtINR(totalPaid);
        else if (col.key === "outstanding")    txt = fmtINR(totalOutstanding);
        if (txt) {
          doc.font("Bold").fontSize(8).fillColor(C_WHITE)
            .text(txt, sx + 2, y + (22 - 8) / 2,
              { width: col.width - 4, align: "right", lineBreak: false });
        }
        sx += col.width;
      }

      // Plain-English three-line summary below the bar
      const sy = y + 26;
      const colW = TABLE_WIDTH / 3 - 8;
      const positions = [TABLE_LEFT, TABLE_LEFT + TABLE_WIDTH / 3, TABLE_LEFT + (TABLE_WIDTH / 3) * 2];
      const labels = [
        `Total Invoiced:   ${fmtINR(totalInvoiced)}`,
        `Total Paid:   ${fmtINR(totalPaid)}`,
        `Total Outstanding:   ${fmtINR(totalOutstanding)}`,
      ];
      for (let i = 0; i < 3; i++) {
        doc.font("Bold").fontSize(8).fillColor(C_DARK)
          .text(labels[i], positions[i], sy, { width: colW, lineBreak: false });
      }
    }

    // ── Render ─────────────────────────────────────────────────────────────

    // Empty-report path
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

    // Data pages
    for (let pi = 0; pi < dataPages.length; pi++) {
      const pageNum  = pi + 1;
      const pageRows = dataPages[pi];
      const isLast   = pi === dataPages.length - 1;

      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawPageHeader(pageNum);
      drawFooter(pageNum);

      let y = TABLE_TOP + COL_H;
      for (const rowIdx of pageRows) {
        const row  = input.rows[rowIdx];
        const rowH = rowHeights[rowIdx];
        drawDataRow(row, rowIdx, y, rowH);
        y += rowH;
      }

      // Totals on this (last data) page, if they fit
      if (isLast && !totalsNeedExtraPage) {
        drawTotals(y + 8);
      }
    }

    // Overflow totals page (when last data page is full)
    if (totalsNeedExtraPage) {
      const overflowPageNum = dataPages.length + 1;
      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawPageHeader(overflowPageNum);
      drawFooter(overflowPageNum);
      // Totals sit right below the column-header row on the continuation page
      drawTotals(TABLE_TOP + COL_H + 10);
    }

    doc.end();
  });
}
