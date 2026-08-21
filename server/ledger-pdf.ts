/**
 * ledger-pdf.ts — Fee Ledger PDF renderer
 *
 * Key guarantees
 * ──────────────
 * 1. Text is NEVER mid-word broken: word wrapping uses doc.widthOfString() (actual
 *    PDFKit font metrics) with character-break fallback only for unbreakable long tokens
 *    (e.g. Razorpay IDs). Each wrapped line is drawn individually with lineBreak:false.
 * 2. Dynamic row heights: every row measures its tallest wrapping cell and sizes itself
 *    accordingly. No text is clipped.
 * 3. Totals block always appears: pre-flight check determines whether it fits on the
 *    last data page; if not, a continuation page is added BEFORE any drawing starts so
 *    the page-count in every header is correct from the beginning.
 * 4. Status pills are real rounded rectangles rendered with save/restore so the graphics
 *    state never bleeds across cells.
 * 5. Page number appears ONLY in the footer.
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

// Status pill — background + foreground pairs
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

function fmtPeriod(start: string | null | undefined, end: string | null | undefined): string {
  const s1 = fmtMonthYear(start);
  const s2 = fmtMonthYear(end);
  if (s1 && s2 && s1 !== s2) return `${s1} \u2013 ${s2}`;
  return s1 || s2 || EM;
}

// ── Page geometry ─────────────────────────────────────────────────────────────
// A4 landscape: 841.89 × 595.28 pt
const PAGE_W   = 841.89;
const PAGE_H   = 595.28;
const MARGIN_H = 32;          // left + right margin
const MARGIN_V = 32;          // top + bottom margin

// Header block (logo + school info + title + subtitle + session/generated/records
//               + filter/scope line + horizontal rule + small gap)
const HEADER_H = 120;
const TABLE_TOP = MARGIN_V + HEADER_H;   // where the column-header row starts

const COL_H    = 22;  // column-header row height
const FOOTER_H = 22;  // space kept at page bottom for the footer line

// Data-row area per page (space available for actual invoice rows)
const USABLE_DATA_H = PAGE_H - MARGIN_V * 2 - HEADER_H - COL_H - FOOTER_H;

// Totals block: navy bar (20 pt) + top gap (8 pt) + 3 summary lines × 12 pt + bottom gap (6 pt)
const TOTALS_H = 8 + 20 + 3 * 12 + 6;  // = 70 pt

const LINE_H    = 10;   // vertical distance between consecutive wrapped lines
const CELL_PAD  = 5;    // top AND bottom padding inside a data cell
const MIN_ROW_H = LINE_H + CELL_PAD * 2;   // 20 pt minimum

const TABLE_LEFT = MARGIN_H;

// ── Column definitions ────────────────────────────────────────────────────────
//
// Usable table width = PAGE_W − 2×MARGIN_H = 841.89 − 64 = 777.89 → 778 pt
//
// wrap:true  → text uses wrapToLines(); row height expands as needed
// wrap:false → single line, lineBreak:false; values are inherently short
//
// Width priorities (wider): Student, Fee Name, Fee Period, Payment Method, Reference No.
// Width savings (narrower): DSID, Class, Invoice/Receipt No., Date columns

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
  { key:"student_id",       label:"DSID",           width: 34, fontSize:6.5,                wrap:true  },
  { key:"class",            label:"Class",          width: 20, fontSize:7.5,                wrap:false },
  { key:"fee_name",         label:"Fee Name",       width: 66, fontSize:7.5,                wrap:true  },
  { key:"fee_type",         label:"Fee Type",       width: 40, fontSize:7,                  wrap:true  },
  { key:"fee_period",       label:"Fee Period",     width: 56, fontSize:7,                  wrap:true  },
  { key:"frequency",        label:"Frequency",      width: 36, fontSize:7,                  wrap:false },
  { key:"invoice_amount",   label:"Amount",         width: 48, fontSize:8,   align:"right", wrap:false },
  { key:"due_date",         label:"Due Date",       width: 44, fontSize:7,                  wrap:false },
  { key:"status",           label:"Status",         width: 40, fontSize:7.5, align:"center",wrap:false },
  { key:"paid_date",        label:"Paid On",        width: 44, fontSize:7,                  wrap:false },
  { key:"amount_paid",      label:"Paid",           width: 42, fontSize:8,   align:"right", wrap:false },
  { key:"outstanding",      label:"Outstanding",    width: 48, fontSize:8,   align:"right", wrap:false },
  { key:"payment_method",   label:"Payment Method", width: 58, fontSize:7,                  wrap:true  },
  { key:"reference_number", label:"Reference No.",  width: 36, fontSize:6.5,                wrap:true  },
];
// 46+44+76+34+20+66+40+56+36+48+44+40+44+42+48+58+36 = 778

const TABLE_WIDTH = COLS.reduce((s, c) => s + c.width, 0);

// ── Width assertion (catches drift immediately at startup) ────────────────────
(function () {
  const expected = Math.round(PAGE_W - MARGIN_H * 2);
  if (TABLE_WIDTH !== expected) {
    throw new Error(
      `[ledger-pdf] Column widths sum to ${TABLE_WIDTH} pt but expected ${expected} pt. ` +
      `Adjust COLS to fix (PAGE_W=${PAGE_W}, MARGIN_H=${MARGIN_H}).`
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
    case "class":            return row.section ? `${safe(row.class)}-${safe(row.section)}` : safe(row.class);
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

// ── Word-aware text wrapping using actual PDFKit font metrics ─────────────────
/**
 * Splits `text` into lines that fit within `maxWidth` pt, using the font and size
 * already set on `doc`. Breaks at space boundaries; falls back to character breaks
 * only for tokens (like Razorpay IDs) that are individually wider than the column.
 *
 * IMPORTANT: call doc.font(name).fontSize(size) before calling this function.
 */
function wrapToLines(doc: InstanceType<typeof PDFDocument>, text: string, maxWidth: number): string[] {
  if (!text || text === EM || text === "\u2014") return [text || EM];

  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if ((doc as any).widthOfString(candidate) <= maxWidth) {
      line = candidate;
    } else {
      if (line) { lines.push(line); line = ""; }
      // Word fits on its own?
      if ((doc as any).widthOfString(word) <= maxWidth) {
        line = word;
      } else {
        // Character-break for very long unbreakable tokens
        let partial = "";
        for (const ch of word) {
          const test = partial + ch;
          if ((doc as any).widthOfString(test) <= maxWidth) {
            partial = test;
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

  // Create the doc early so we can use widthOfString() for pre-computation.
  // No page is added yet.
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: false });
  doc.registerFont("Reg",  FONT_REG);
  doc.registerFont("Bold", FONT_BOLD);

  // ── Pre-compute: wrapped lines for every wrapping cell ────────────────────
  // Cache: allWrapped[rowIndex][colKey] = string[]
  const allWrapped: Array<Record<string, string[]>> = input.rows.map(row => {
    const w: Record<string, string[]> = {};
    for (const col of COLS) {
      if (!col.wrap) continue;
      const text = getCellText(row, col.key);
      (doc as any).font("Reg").fontSize(col.fontSize);
      w[col.key] = wrapToLines(doc as any, text, col.width - 6); // 3pt padding each side
    }
    return w;
  });

  // ── Pre-compute: row heights ──────────────────────────────────────────────
  const rowHeights = input.rows.map((_, i) => {
    let maxLines = 1;
    for (const col of COLS) {
      if (!col.wrap) continue;
      const lines = (allWrapped[i][col.key] ?? [""]).length;
      if (lines > maxLines) maxLines = lines;
    }
    return Math.max(maxLines * LINE_H + CELL_PAD * 2, MIN_ROW_H);
  });

  // ── Paginate (by accumulated height, not fixed count) ────────────────────
  function paginate(): number[][] {
    const pages: number[][] = [];
    let page: number[] = [];
    let used = 0;
    for (let i = 0; i < input.rows.length; i++) {
      if (page.length > 0 && used + rowHeights[i] > USABLE_DATA_H) {
        pages.push(page);
        page = [];
        used = 0;
      }
      page.push(i);
      used += rowHeights[i];
    }
    if (page.length > 0 || pages.length === 0) pages.push(page);
    return pages;
  }

  const dataPages = paginate();

  // Does totals block fit on the last data page?
  const lastPageUsed = (dataPages[dataPages.length - 1] ?? [])
    .reduce((s, i) => s + rowHeights[i], 0);
  const totalsNeedExtraPage = lastPageUsed + TOTALS_H > USABLE_DATA_H;
  const totalPages = dataPages.length + (totalsNeedExtraPage ? 1 : 0);

  // ── Filter/scope line ────────────────────────────────────────────────────
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

  // ── Totals values (computed once from the full exported dataset) ──────────
  const totInvoiced    = input.rows.reduce((s, r) => s + Number(r.invoice_amount ?? 0), 0);
  const totPaid        = input.rows.reduce((s, r) => s + Number(r.amount_paid    ?? 0), 0);
  const totOutstanding = input.rows.reduce((s, r) => s + Number(r.outstanding    ?? 0), 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   ()          => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Page header ──────────────────────────────────────────────────────
    function drawHeader(pageNum: number) {
      const top = MARGIN_V;      // 32 pt from top of page

      // ── Left block: logo + school info ─────────────────────────────
      let nameX = TABLE_LEFT;    // X where school name starts
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, TABLE_LEFT, top + 2, { fit: [40, 40] });
          nameX = TABLE_LEFT + 46;
        } catch { /* logo unavailable */ }
      }

      // School name
      (doc as any).font("Bold").fontSize(11.5).fillColor(C_DARK)
        .text(input.school.name, nameX, top, { width: 290, lineBreak: false });

      // Address
      const addr: string[] = [];
      if (input.school.addressLine1) addr.push(input.school.addressLine1);
      if (input.school.city)         addr.push(input.school.city);
      if (input.school.state)        addr.push(input.school.state);
      if (input.school.pinCode)      addr.push(input.school.pinCode);
      if (addr.length) {
        (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(addr.join(", "), nameX, top + 15, { width: 290, lineBreak: true });
      }

      // Phone / email
      const contact: string[] = [];
      if (input.school.phone) contact.push(input.school.phone);
      if (input.school.email) contact.push(input.school.email);
      if (contact.length) {
        (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(contact.join("  \u2022  "), nameX, top + 28, { width: 290, lineBreak: false });
      }

      // ── Right block: report identity ────────────────────────────────
      const RW  = 240;                              // right-block width
      const RX  = TABLE_LEFT + TABLE_WIDTH - RW;   // right-block X start = 570

      // Title — large, dark, right-aligned
      (doc as any).font("Bold").fontSize(14.5).fillColor(C_DARK)
        .text("FEE LEDGER REPORT", RX, top, { width: RW, align: "right", lineBreak: false });

      // Subtitle — muted, italic-style (just Reg), two lines OK
      (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(
          "Invoice-wise fee ledger \u2014 billed amount, payments received & outstanding balance.",
          RX, top + 20,
          { width: RW, align: "right" }
        );

      // Session, generated, records
      let ry = top + 38;
      if (input.sessionLabel) {
        (doc as any).font("Bold").fontSize(8).fillColor(C_DARK)
          .text(`Academic Session: ${input.sessionLabel}`, RX, ry, { width: RW, align: "right", lineBreak: false });
        ry += 13;
      }
      (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`Generated: ${input.generatedAtIST}`, RX, ry, { width: RW, align: "right", lineBreak: false });
      ry += 11;
      (doc as any).font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`Records: ${input.rows.length}`, RX, ry, { width: RW, align: "right", lineBreak: false });

      // ── Filter / scope line — below the left block, left-aligned ────
      const filterY = top + 56;
      (doc as any).font(hasFilters ? "Bold" : "Reg").fontSize(7.5)
        .fillColor(hasFilters ? C_DARK : C_MUTED)
        .text(filterLine, TABLE_LEFT, filterY, { width: TABLE_WIDTH - RW - 4, lineBreak: false });

      // ── Horizontal rule ─────────────────────────────────────────────
      const ruleY = MARGIN_V + HEADER_H - 6;
      (doc as any)
        .moveTo(TABLE_LEFT, ruleY)
        .lineTo(TABLE_LEFT + TABLE_WIDTH, ruleY)
        .strokeColor(C_RULE).lineWidth(0.5).stroke();

      // ── Column-header row ────────────────────────────────────────────
      drawColHeaders(MARGIN_V + HEADER_H);
    }

    // ── Column headers ───────────────────────────────────────────────────
    function drawColHeaders(y: number) {
      // Background
      (doc as any).fillColor(C_THEAD).rect(TABLE_LEFT, y, TABLE_WIDTH, COL_H).fill();

      let x = TABLE_LEFT;
      for (const col of COLS) {
        const labelY = y + (COL_H - 7.5) / 2;   // vertically centred
        (doc as any).font("Bold").fontSize(7.5).fillColor(C_WHITE)
          .text(col.label, x + 3, labelY,
            { width: col.width - 6, align: col.align ?? "left", lineBreak: false });
        x += col.width;
      }
    }

    // ── Footer (page number ONLY here, never in header) ──────────────────
    function drawFooter(pageNum: number) {
      const fy = PAGE_H - MARGIN_V - 13;
      const sessionTag = input.sessionLabel ? `  \u2022  ${input.sessionLabel}` : "";
      (doc as any).font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(
          `${input.school.name}  \u2022  Fee Ledger Report${sessionTag}`,
          TABLE_LEFT, fy,
          { width: TABLE_WIDTH * 0.65, lineBreak: false }
        );
      (doc as any).font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(
          `Page ${pageNum} of ${totalPages}`,
          TABLE_LEFT + TABLE_WIDTH * 0.65, fy,
          { width: TABLE_WIDTH * 0.35, align: "right", lineBreak: false }
        );
    }

    // ── Data row ─────────────────────────────────────────────────────────
    function drawRow(row: LedgerRow, globalIdx: number, y: number, rowH: number) {
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
        const cellText = getCellText(row, col.key);
        const pad      = 3;
        const innerW   = col.width - pad * 2;
        const textX    = x + pad;
        const textY    = y + CELL_PAD;

        if (col.key === "status") {
          // ── Rounded status pill ───────────────────────────────────
          const ps      = pillStyle(row.status);
          const pillW   = col.width - 8;
          const pillH   = Math.min(rowH - 6, 13);
          const pillX   = x + 4;
          const pillY   = y + (rowH - pillH) / 2;
          const textPY  = pillY + (pillH - col.fontSize) / 2;

          // Draw pill background with save/restore to protect graphics state
          (doc as any).save();
          (doc as any).fillColor(ps.bg)
            .roundedRect(pillX, pillY, pillW, pillH, 2).fill();
          (doc as any).restore();

          // Draw status text on top
          (doc as any).font("Bold").fontSize(col.fontSize).fillColor(ps.fg)
            .text(cellText, pillX, textPY + 0.5,
              { width: pillW, align: "center", lineBreak: false });

        } else if (col.wrap) {
          // ── Word-wrapped cell: render pre-computed lines one by one ──
          const lines = allWrapped[globalIdx]?.[col.key] ?? [cellText];
          for (let li = 0; li < lines.length; li++) {
            (doc as any).font("Reg").fontSize(col.fontSize).fillColor(C_BODY)
              .text(lines[li], textX, textY + li * LINE_H,
                { width: innerW, align: col.align ?? "left", lineBreak: false });
          }

        } else {
          // ── Single-line cell ────────────────────────────────────────
          (doc as any).font("Reg").fontSize(col.fontSize).fillColor(C_BODY)
            .text(cellText, textX, textY,
              { width: innerW, align: col.align ?? "left", lineBreak: false });
        }

        x += col.width;
      }
    }

    // ── Totals block ──────────────────────────────────────────────────────
    //  Structure:
    //   [  gap  ]
    //   [ ═══ navy separator bar with TOTALS label ═══ ]
    //   [ Total Invoiced:    ₹X,XX,XXX ]
    //   [ Total Paid:        ₹X,XX,XXX ]
    //   [ Total Outstanding: ₹X,XX,XXX ]
    function drawTotals(y: number) {
      const barY = y + 8;
      const barH = 20;

      // Navy bar
      (doc as any).fillColor(C_THEAD).rect(TABLE_LEFT, barY, TABLE_WIDTH, barH).fill();
      (doc as any).font("Bold").fontSize(8.5).fillColor(C_WHITE)
        .text("TOTALS", TABLE_LEFT + 6, barY + (barH - 8.5) / 2,
          { width: 100, lineBreak: false });

      // Three stacked summary lines below the bar
      const lines = [
        { label: "Total Invoiced:",    amount: fmtINR(totInvoiced)    },
        { label: "Total Paid:",        amount: fmtINR(totPaid)        },
        { label: "Total Outstanding:", amount: fmtINR(totOutstanding) },
      ];

      const LW = 160;   // label column width
      const AW = 100;   // amount column width (right-aligned)
      const LX = TABLE_LEFT + 6;
      const AX = TABLE_LEFT + LW + 10;

      for (let i = 0; i < lines.length; i++) {
        const ly = barY + barH + 6 + i * 12;
        (doc as any).font("Bold").fontSize(8).fillColor(C_DARK)
          .text(lines[i].label, LX, ly, { width: LW, lineBreak: false });
        (doc as any).font("Bold").fontSize(8).fillColor(C_DARK)
          .text(lines[i].amount, AX, ly, { width: AW, lineBreak: false });
      }
    }

    // ── Render loop ───────────────────────────────────────────────────────
    if (input.rows.length === 0) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawHeader(1);
      drawFooter(1);
      (doc as any).font("Reg").fontSize(10).fillColor(C_MUTED)
        .text("No records found for the selected filters.",
          TABLE_LEFT, TABLE_TOP + COL_H + 24, { width: TABLE_WIDTH, align: "center" });
      doc.end();
      return;
    }

    for (let pi = 0; pi < dataPages.length; pi++) {
      const pageNum  = pi + 1;
      const pageRows = dataPages[pi];
      const isLast   = pi === dataPages.length - 1;

      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawHeader(pageNum);
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

    // Overflow totals page
    if (totalsNeedExtraPage) {
      const pn = dataPages.length + 1;
      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawHeader(pn);
      drawFooter(pn);
      drawTotals(TABLE_TOP + COL_H + 8);
    }

    doc.end();
  });
}
