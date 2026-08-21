/**
 * ledger-pdf.ts — Fee Ledger PDF renderer
 *
 * Rendering guarantees
 * ────────────────────
 * 1. NO mid-word character breaks ever.
 *    Pre-computation uses a conservative char-width table (no PDFKit page needed).
 *    Each pre-computed line is drawn with `lineBreak: false` and NO `width` option —
 *    the only way PDFKit guarantees a single line without any wrapping.
 * 2. Right-aligned cells (Amount, Paid, Outstanding, header labels) use
 *    `doc.widthOfString()` at render time (when a page is live) to compute exact X.
 * 3. Totals amounts are rendered without a width constraint — they cannot wrap.
 * 4. Status pills use save/restore to isolate graphics state.
 * 5. Page count is known before any drawing begins.
 */

import PDFDocument from "pdfkit";
import https from "https";
import http from "http";

// ── Fonts ─────────────────────────────────────────────────────────────────────
const FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// ── Palette ───────────────────────────────────────────────────────────────────
const C_DARK  = "#102b49";
const C_MUTED = "#5a6e80";
const C_RULE  = "#d9e1e8";
const C_WHITE = "#ffffff";
const C_BODY  = "#1a2332";
const C_THEAD = "#102b49";
const C_ALT   = "#f5f8fb";

// Status pill colours
const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  Paid:    { bg: "#d1fae5", fg: "#065f46" },
  Overdue: { bg: "#fee2e2", fg: "#7f1d1d" },
  Due:     { bg: "#fef3c7", fg: "#78350f" },
  Partial: { bg: "#dbeafe", fg: "#1e40af" },
  Waived:  { bg: "#e5e7eb", fg: "#374151" },
};
function pillStyle(status: string) {
  return STATUS_STYLE[status] ?? { bg: "#e5e7eb", fg: "#374151" };
}

// ── Conservative char-width table for pre-computation ─────────────────────────
// Values are slightly above the real DejaVu Sans average so we never over-pack
// a line and force PDFKit into character-break territory.
const CHAR_W: Record<number, number> = {
  6.5: 3.90,
  7.0: 4.20,
  7.5: 4.50,
  8.0: 4.80,
};
function charW(fontSize: number): number {
  return CHAR_W[fontSize] ?? fontSize * 0.60;
}
function measureText(text: string, fontSize: number): number {
  return text.length * charW(fontSize);
}

// ── Network helpers ───────────────────────────────────────────────────────────
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

// ── Formatters ────────────────────────────────────────────────────────────────
const EM = "\u2014";

function fmtINR(n: number): string {
  return "\u20B9" + new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return EM;
  try {
    const d = /^\d{4}-\d{2}-\d{2}/.test(String(v))
      ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`)
      : new Date(String(v));
    if (isNaN(d.getTime())) return EM;
    return d.toLocaleDateString("en-IN", {
      timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return EM; }
}

function safe(v: unknown): string {
  if (v == null || v === "") return EM;
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

function fmtPeriod(s: string | null | undefined, e: string | null | undefined): string {
  const a = fmtMonthYear(s), b = fmtMonthYear(e);
  if (a && b && a !== b) return `${a} \u2013 ${b}`;
  return a || b || EM;
}

// ── Page geometry ─────────────────────────────────────────────────────────────
const PAGE_W   = 841.89;   // A4 landscape
const PAGE_H   = 595.28;
const MARGIN_H = 32;
const MARGIN_V = 32;

const HEADER_H = 120;                 // top header block height
const TABLE_TOP = MARGIN_V + HEADER_H; // top of column-header row

const COL_H    = 22;   // column-header row height
const FOOTER_H = 22;   // reserved at page bottom for footer

// Usable vertical space for data rows per page
const USABLE_DATA_H = PAGE_H - MARGIN_V * 2 - HEADER_H - COL_H - FOOTER_H;

// Totals block: 8pt gap + 20pt bar + 3 lines × 12pt + 6pt gap = 70pt
const TOTALS_H = 8 + 20 + 3 * 12 + 6;

const LINE_H    = 10;   // px between successive wrapped lines
const CELL_PAD  = 5;    // top + bottom cell padding
const MIN_ROW_H = LINE_H + CELL_PAD * 2;   // 20 pt minimum row height
const H_PAD     = 2;    // horizontal padding inside each cell

const TABLE_LEFT = MARGIN_H;

// ── Column definitions ────────────────────────────────────────────────────────
//
// Table width = PAGE_W − 2×MARGIN_H = 841.89 − 64 = 777.89 → 778 pt (rounded)
//
// Width changes from previous revision:
//   DSID     34 → 32  (-2)    gives room to Reference No.
//   Fee Period 56 → 52  (-4)   gives room to Reference No.
//   Frequency  36 → 34  (-2)   gives room to Reference No.
//   Status     40 → 38  (-2)   gives room to Reference No.
//   Reference No. 36 → 46 (+10) wider for short Razorpay receipt IDs
//
// Payment Method remains 58 pt (inner 54 pt) so "Bank Transfer" / "Demand Draft"
// each measure ≤50.4 pt (12 chars × 4.2) and fit on ONE LINE.

interface ColDef {
  key:      string;
  label:    string;
  width:    number;
  fontSize: number;
  align?:   "right" | "center";
  wrap:     boolean;
}

const COLS: ColDef[] = [
  { key:"invoice_number",   label:"Invoice No.",    width: 46, fontSize:6.5,                wrap:true  },
  { key:"receipt_number",   label:"Receipt No.",    width: 44, fontSize:6.5,                wrap:true  },
  { key:"student_name",     label:"Student",        width: 76, fontSize:8,                  wrap:true  },
  { key:"student_id",       label:"DSID",           width: 32, fontSize:6.5,                wrap:true  },
  { key:"class",            label:"Class",          width: 20, fontSize:7.5,                wrap:false },
  { key:"fee_name",         label:"Fee Name",       width: 66, fontSize:7.5,                wrap:true  },
  { key:"fee_type",         label:"Fee Type",       width: 40, fontSize:7,                  wrap:true  },
  { key:"fee_period",       label:"Fee Period",     width: 52, fontSize:7,                  wrap:true  },
  { key:"frequency",        label:"Frequency",      width: 34, fontSize:7,                  wrap:false },
  { key:"invoice_amount",   label:"Amount",         width: 48, fontSize:8,   align:"right", wrap:false },
  { key:"due_date",         label:"Due Date",       width: 44, fontSize:7,                  wrap:false },
  { key:"status",           label:"Status",         width: 38, fontSize:7.5, align:"center",wrap:false },
  { key:"paid_date",        label:"Paid On",        width: 44, fontSize:7,                  wrap:false },
  { key:"amount_paid",      label:"Paid",           width: 42, fontSize:8,   align:"right", wrap:false },
  { key:"outstanding",      label:"Outstanding",    width: 48, fontSize:8,   align:"right", wrap:false },
  { key:"payment_method",   label:"Payment Method", width: 58, fontSize:7,                  wrap:true  },
  { key:"reference_number", label:"Reference No.",  width: 46, fontSize:6.5,                wrap:true  },
];
// 46+44+76+32+20+66+40+52+34+48+44+38+44+42+48+58+46 = 778

const TABLE_WIDTH = COLS.reduce((s, c) => s + c.width, 0);

// ── Width assertion ───────────────────────────────────────────────────────────
(function () {
  const expected = Math.round(PAGE_W - MARGIN_H * 2);
  if (TABLE_WIDTH !== expected) {
    throw new Error(
      `[ledger-pdf] Column widths sum to ${TABLE_WIDTH} pt but expected ${expected} pt.`
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

// ── Cell text ─────────────────────────────────────────────────────────────────
function getCellText(row: LedgerRow, key: string): string {
  switch (key) {
    case "invoice_number":   return safe(row.invoice_number);
    case "receipt_number":   return safe(row.receipt_number);
    case "student_name":     return safe(row.student_name);
    case "student_id":       return safe(row.student_id);
    case "class":            return row.section
                               ? `${safe(row.class)}-${safe(row.section)}`
                               : safe(row.class);
    case "fee_name":         return safe(row.fee_name ?? row.fee_type);
    case "fee_type":         return safe(row.fee_type);
    case "fee_period":       return fmtPeriod(row.fee_period_start, row.fee_period_end);
    case "frequency":        return safe(row.frequency);
    case "invoice_amount":   return fmtINR(Number(row.invoice_amount ?? 0));
    case "due_date":         return fmtDate(row.due_date);
    case "status":           return safe(row.status);
    case "paid_date":        return fmtDate(row.paid_date);
    case "amount_paid":      return row.amount_paid ? fmtINR(Number(row.amount_paid)) : EM;
    case "outstanding":      return row.outstanding  ? fmtINR(Number(row.outstanding))  : EM;
    case "payment_method":   return safe(row.payment_method);
    case "reference_number": return safe(row.reference_number);
    default:                 return EM;
  }
}

// ── Word-boundary text wrapping ───────────────────────────────────────────────
/**
 * Splits `text` into lines that fit within `maxWidth` using a conservative
 * char-width estimate. Splits ONLY at space boundaries; character-breaks only
 * for genuinely unbreakable tokens (long IDs with no spaces).
 *
 * This function is PURE — it needs no PDFKit page or font state.
 * Rendering each output line with `{ lineBreak: false }` and NO `width` option
 * guarantees PDFKit cannot break it further.
 */
function wrapToLines(text: string, fontSize: number, maxWidth: number): string[] {
  if (!text || text === EM || text === "\u2014") return [text || EM];

  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate, fontSize) <= maxWidth) {
      line = candidate;
    } else {
      if (line) { lines.push(line); line = ""; }
      // Does this word fit alone on a line?
      if (measureText(word, fontSize) <= maxWidth) {
        line = word;
      } else {
        // Character-break — only for very long unbreakable tokens (IDs)
        let partial = "";
        for (const ch of word) {
          if (measureText(partial + ch, fontSize) <= maxWidth) {
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

// ── Main export ───────────────────────────────────────────────────────────────
export async function renderLedgerPdf(input: LedgerPdfInput): Promise<Buffer> {
  const logoBuffer = await safeImage(input.school.logoUrl);

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: false });
  doc.registerFont("Reg",  FONT_REG);
  doc.registerFont("Bold", FONT_BOLD);

  // ── Pre-compute: wrapped lines (pure, no page needed) ─────────────────────
  // maxWidth = col.width - H_PAD  (subtract only the LEFT padding; right side is
  // open since each line is rendered without a `width` constraint).  Using only
  // one side of padding gives enough room for "Bank Transfer" (13 ch × 4.2 ≈ 54.6 pt)
  // to fit in the 58 pt Payment Method column (56 pt effective) on ONE line.
  const allWrapped: Array<Record<string, string[]>> = input.rows.map(row => {
    const w: Record<string, string[]> = {};
    for (const col of COLS) {
      if (!col.wrap) continue;
      const text = getCellText(row, col.key);
      w[col.key] = wrapToLines(text, col.fontSize, col.width - H_PAD);
    }
    return w;
  });

  // ── Pre-compute: row heights ───────────────────────────────────────────────
  const rowHeights = input.rows.map((_, i) => {
    let maxLines = 1;
    for (const col of COLS) {
      if (!col.wrap) continue;
      const n = (allWrapped[i][col.key] ?? [""]).length;
      if (n > maxLines) maxLines = n;
    }
    return Math.max(maxLines * LINE_H + CELL_PAD * 2, MIN_ROW_H);
  });

  // ── Paginate ───────────────────────────────────────────────────────────────
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
    .reduce((s, i) => s + rowHeights[i], 0);
  const totalsNeedExtraPage = lastPageUsed + TOTALS_H > USABLE_DATA_H;
  const totalPages = dataPages.length + (totalsNeedExtraPage ? 1 : 0);

  // ── Filter line ────────────────────────────────────────────────────────────
  const filterParts: string[] = [];
  if (input.filters.search)   filterParts.push(`Search = "${input.filters.search}"`);
  if (input.filters.status)   filterParts.push(`Status = ${input.filters.status}`);
  if (input.filters.class)    filterParts.push(`Class = ${input.filters.class}`);
  if (input.filters.feeName)  filterParts.push(`Fee Name = ${input.filters.feeName}`);
  if (input.filters.feeType)  filterParts.push(`Fee Type = ${input.filters.feeType}`);
  if (input.filters.dateFrom) filterParts.push(`From ${fmtDate(input.filters.dateFrom)}`);
  if (input.filters.dateTo)   filterParts.push(`To ${fmtDate(input.filters.dateTo)}`);
  const filterLine = filterParts.length
    ? `Filters: ${filterParts.join("  \u00b7  ")}`
    : "Scope: All matching records for this session";
  const hasFilters = filterParts.length > 0;

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totInvoiced    = input.rows.reduce((s, r) => s + Number(r.invoice_amount ?? 0), 0);
  const totPaid        = input.rows.reduce((s, r) => s + Number(r.amount_paid    ?? 0), 0);
  const totOutstanding = input.rows.reduce((s, r) => s + Number(r.outstanding    ?? 0), 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   ()          => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Page header ──────────────────────────────────────────────────────────
    function drawHeader() {
      const top = MARGIN_V;

      // Left: logo + school info
      let nameX = TABLE_LEFT;
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, TABLE_LEFT, top + 2, { fit: [40, 40] });
          nameX = TABLE_LEFT + 46;
        } catch { /* skip */ }
      }
      (doc as any).font("Bold").fontSize(11.5).fillColor(C_DARK)
        .text(input.school.name, nameX, top, { width: 290, lineBreak: false });

      const addr: string[] = [];
      if (input.school.addressLine1) addr.push(input.school.addressLine1);
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
        .text("FEE LEDGER REPORT", RX, top, { width: RW, align: "right", lineBreak: false });

      (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(
          "Invoice-wise fee ledger \u2014 billed amount, payments received & outstanding balance.",
          RX, top + 20,
          { width: RW, align: "right" }
        );

      let ry = top + 38;
      if (input.sessionLabel) {
        (doc as any).font("Bold").fontSize(8).fillColor(C_DARK)
          .text(`Academic Session: ${input.sessionLabel}`, RX, ry,
            { width: RW, align: "right", lineBreak: false });
        ry += 13;
      }
      (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`Generated: ${input.generatedAtIST}`, RX, ry,
          { width: RW, align: "right", lineBreak: false });
      ry += 11;
      (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`Records: ${input.rows.length}`, RX, ry,
          { width: RW, align: "right", lineBreak: false });

      // Filter/scope line
      (doc as any).font(hasFilters ? "Bold" : "Reg").fontSize(7.5)
        .fillColor(hasFilters ? C_DARK : C_MUTED)
        .text(filterLine, TABLE_LEFT, top + 56,
          { width: TABLE_WIDTH - RW - 4, lineBreak: false });

      // Horizontal rule
      const ruleY = MARGIN_V + HEADER_H - 6;
      (doc as any)
        .moveTo(TABLE_LEFT, ruleY)
        .lineTo(TABLE_LEFT + TABLE_WIDTH, ruleY)
        .strokeColor(C_RULE).lineWidth(0.5).stroke();
    }

    // ── Column headers ────────────────────────────────────────────────────────
    // Font size 6.5 pt for all headers. No `width` option — labels rendered freely
    // from their start position so narrow columns (Class, Frequency) are never
    // character-broken or clipped by the layout engine.
    // Right/center-aligned labels use widthOfString() for exact positioning.
    function drawColHeaders(y: number) {
      const HFONT = 6.5;
      (doc as any).fillColor(C_THEAD).rect(TABLE_LEFT, y, TABLE_WIDTH, COL_H).fill();

      let x = TABLE_LEFT;
      for (const col of COLS) {
        const labelMidY = y + (COL_H - HFONT) / 2;
        (doc as any).font("Bold").fontSize(HFONT).fillColor(C_WHITE);
        const labelW = (doc as any).widthOfString(col.label);
        let lx: number;
        if (col.align === "right") {
          lx = x + col.width - H_PAD - labelW;
        } else if (col.align === "center") {
          lx = x + (col.width - labelW) / 2;
        } else {
          lx = x + H_PAD;
        }
        (doc as any).text(col.label, lx, labelMidY, { lineBreak: false });
        x += col.width;
      }
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    function drawFooter(pageNum: number) {
      const fy = PAGE_H - MARGIN_V - 13;
      const tag = input.sessionLabel ? `  \u2022  ${input.sessionLabel}` : "";
      (doc as any).font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(`${input.school.name}  \u2022  Fee Ledger Report${tag}`,
          TABLE_LEFT, fy, { width: TABLE_WIDTH * 0.65, lineBreak: false });
      (doc as any).font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(`Page ${pageNum} of ${totalPages}`,
          TABLE_LEFT + TABLE_WIDTH * 0.65, fy,
          { width: TABLE_WIDTH * 0.35, align: "right", lineBreak: false });
    }

    // ── Data row ──────────────────────────────────────────────────────────────
    function drawRow(row: LedgerRow, globalIdx: number, y: number, rowH: number) {
      // Alternating row stripe
      if (globalIdx % 2 === 0) {
        (doc as any).fillColor(C_ALT).rect(TABLE_LEFT, y, TABLE_WIDTH, rowH).fill();
      }
      // Row bottom separator
      (doc as any)
        .moveTo(TABLE_LEFT, y + rowH)
        .lineTo(TABLE_LEFT + TABLE_WIDTH, y + rowH)
        .strokeColor(C_RULE).lineWidth(0.25).stroke();

      let x = TABLE_LEFT;
      for (const col of COLS) {
        const cellText = getCellText(row, col.key);
        const textY    = y + CELL_PAD;

        if (col.key === "status") {
          // ── Rounded colour pill ─────────────────────────────────────────
          const ps    = pillStyle(row.status);
          const pillW = col.width - 8;
          const pillH = Math.min(rowH - 6, 13);
          const pillX = x + 4;
          const pillY = y + (rowH - pillH) / 2;
          // Draw pill background — save/restore protects graphics state
          (doc as any).save();
          (doc as any).fillColor(ps.bg).roundedRect(pillX, pillY, pillW, pillH, 2).fill();
          (doc as any).restore();
          // Status text centred within pill
          (doc as any).font("Bold").fontSize(col.fontSize).fillColor(ps.fg)
            .text(cellText, pillX, pillY + (pillH - col.fontSize) / 2 + 0.5,
              { width: pillW, align: "center", lineBreak: false });

        } else if (col.wrap) {
          // ── Wrapping cell: pre-computed word-boundary lines ─────────────
          // Rendered WITHOUT `width` so PDFKit cannot character-break them.
          const lines = allWrapped[globalIdx]?.[col.key] ?? [cellText];
          for (let li = 0; li < lines.length; li++) {
            (doc as any).font("Reg").fontSize(col.fontSize).fillColor(C_BODY)
              .text(lines[li], x + H_PAD, textY + li * LINE_H, { lineBreak: false });
          }

        } else if (col.align === "right") {
          // ── Right-aligned single-line: measure and place exactly ────────
          // Using widthOfString() at render time (page is live — correct metrics).
          (doc as any).font("Reg").fontSize(col.fontSize).fillColor(C_BODY);
          const tw = (doc as any).widthOfString(cellText);
          (doc as any).text(cellText, x + col.width - H_PAD - tw, textY,
            { lineBreak: false });

        } else {
          // ── Left-aligned single-line ────────────────────────────────────
          // No `width` — cannot wrap, cannot character-break.
          (doc as any).font("Reg").fontSize(col.fontSize).fillColor(C_BODY)
            .text(cellText, x + H_PAD, textY, { lineBreak: false });
        }

        x += col.width;
      }
    }

    // ── Totals block ──────────────────────────────────────────────────────────
    //   [gap]
    //   [════════════ navy bar "TOTALS" ════════════]
    //   Total Invoiced:                       ₹X,XX,XXX
    //   Total Paid:                           ₹X,XX,XXX
    //   Total Outstanding:                    ₹X,XX,XXX
    //
    // Amounts use widthOfString() + manual X (right-aligned) + NO `width` option
    // → zero possibility of wrapping.
    function drawTotals(y: number) {
      const barY = y + 8;
      const barH = 20;

      (doc as any).fillColor(C_THEAD).rect(TABLE_LEFT, barY, TABLE_WIDTH, barH).fill();
      (doc as any).font("Bold").fontSize(8.5).fillColor(C_WHITE)
        .text("TOTALS", TABLE_LEFT + 6, barY + (barH - 8.5) / 2, { lineBreak: false });

      const summaryLines = [
        { label: "Total Invoiced:",    amount: fmtINR(totInvoiced)    },
        { label: "Total Paid:",        amount: fmtINR(totPaid)        },
        { label: "Total Outstanding:", amount: fmtINR(totOutstanding) },
      ];

      const rightEdge = TABLE_LEFT + TABLE_WIDTH - 8;

      for (let i = 0; i < summaryLines.length; i++) {
        const sy = barY + barH + 6 + i * 12;
        const { label, amount } = summaryLines[i];

        // Label — left-aligned, no width constraint
        (doc as any).font("Bold").fontSize(8).fillColor(C_DARK)
          .text(label, TABLE_LEFT + 6, sy, { lineBreak: false });

        // Amount — right-aligned via exact widthOfString measurement, no width constraint
        (doc as any).font("Bold").fontSize(8).fillColor(C_DARK);
        const amtW = (doc as any).widthOfString(amount);
        (doc as any).text(amount, rightEdge - amtW, sy, { lineBreak: false });
      }
    }

    // ── Render loop ───────────────────────────────────────────────────────────
    if (input.rows.length === 0) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawHeader();
      drawColHeaders(MARGIN_V + HEADER_H);
      drawFooter(1);
      (doc as any).font("Reg").fontSize(10).fillColor(C_MUTED)
        .text("No records found for the selected filters.",
          TABLE_LEFT, TABLE_TOP + COL_H + 24,
          { width: TABLE_WIDTH, align: "center", lineBreak: false });
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
        drawRow(input.rows[ri], ri, y, rowHeights[ri]);
        y += rowHeights[ri];
      }

      if (isLast && !totalsNeedExtraPage) {
        drawTotals(y);
      }
    }

    // Overflow totals page (when last data page is full)
    if (totalsNeedExtraPage) {
      const pn = dataPages.length + 1;
      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawHeader();
      drawColHeaders(MARGIN_V + HEADER_H);
      drawFooter(pn);
      drawTotals(TABLE_TOP + COL_H + 8);
    }

    doc.end();
  });
}
