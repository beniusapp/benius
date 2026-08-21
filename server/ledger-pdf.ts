/**
 * ledger-pdf.ts
 * Generates a professional A4-landscape Fee Ledger PDF using PDFKit.
 * All amounts in INR (₹). DejaVu Sans font for ₹ glyph support.
 * Headers repeat on every page; automatic pagination.
 */

import PDFDocument from "pdfkit";
import https from "https";
import http from "http";

const FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// Palette — consistent with invoice/receipt PDF generators
const C_DARK  = "#102b49";
const C_MUTED = "#627386";
const C_RULE  = "#d9e1e8";
const C_WHITE = "#ffffff";
const C_BODY  = "#1a2332";
const C_LIGHT = "#f0f4f8";
const C_THEAD = "#102b49";
const C_ALT   = "#f8fafc";

// Status colours
function statusColor(status: string): string {
  switch (status) {
    case "Paid":     return "#166534";
    case "Overdue":  return "#991b1b";
    case "Due":      return "#92400e";
    case "Partial":  return "#1d4ed8";
    case "Waived":   return "#4b5563";
    default:         return "#374151";
  }
}

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

function fmtINR(n: number): string {
  return "\u20B9" + new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(n);
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

function s(v: unknown): string {
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

export interface LedgerRow {
  invoice_number:  string | null;
  receipt_number:  string | null;
  student_name:    string | null;
  student_id:      string | null;
  class:           string | null;
  section:         string | null;
  fee_name:        string | null;
  fee_type:        string | null;
  frequency:       string | null;
  invoice_amount:  number;
  amount_paid:     number;
  outstanding:     number;
  status:          string;
  due_date:        string | null;
  paid_date:       string | null;
  academic_year:   string | null;
  payment_method:  string | null;
  reference_number:string | null;
  notes:           string | null;
  fee_period_start:string | null;
  fee_period_end:  string | null;
}

export interface LedgerPdfInput {
  school: {
    name: string;
    logoUrl: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    pinCode: string | null;
    phone: string | null;
    email: string | null;
  };
  sessionLabel: string | null;
  filters: {
    search?: string;
    status?: string;
    class?: string;
    feeName?: string;
    feeType?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  rows: LedgerRow[];
  generatedAtIST: string;
}

// ── Column layout (A4 landscape: 841.89 × 595.28 pt, margins 36pt each side)
// Usable width ≈ 770pt  (17 columns)
const COLS: { key: string; label: string; width: number; align?: "right" | "center" }[] = [
  { key: "invoice_number",  label: "Invoice No.",  width: 48 },
  { key: "receipt_number",  label: "Receipt No.",  width: 46 },
  { key: "student_name",    label: "Student",      width: 65 },
  { key: "student_id",      label: "DSID",         width: 36 },
  { key: "class",           label: "Cls",          width: 26 },
  { key: "fee_name",        label: "Fee Name",     width: 58 },
  { key: "fee_type",        label: "Fee Type",     width: 44 },
  { key: "fee_period",      label: "Fee Period",   width: 58 },
  { key: "frequency",       label: "Frequency",    width: 44 },
  { key: "invoice_amount",  label: "Amount",       width: 45, align: "right" },
  { key: "due_date",        label: "Due Date",     width: 43 },
  { key: "status",          label: "Status",       width: 40, align: "center" },
  { key: "paid_date",       label: "Paid On",      width: 42 },
  { key: "amount_paid",     label: "Paid",         width: 42, align: "right" },
  { key: "outstanding",     label: "Outstdg.",     width: 44, align: "right" },
  { key: "payment_method",  label: "Method",       width: 45 },
  { key: "reference_number",label: "Reference",    width: 44 },
];
// Sum: 48+46+65+36+26+58+44+58+44+45+43+40+42+42+44+45+44 = 770
const TABLE_WIDTH = COLS.reduce((s, c) => s + c.width, 0);

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN_H = 36;
const MARGIN_V = 36;
const HEADER_H = 110; // space reserved for the page header
const TABLE_TOP = MARGIN_V + HEADER_H;
const COL_H = 18;     // column header row height
const ROW_H = 15;     // data row height
const FOOTER_H = 20;
const TABLE_LEFT = MARGIN_H;

export async function renderLedgerPdf(input: LedgerPdfInput): Promise<Buffer> {
  const logoBuffer = await safeImage(input.school.logoUrl);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: false });
    doc.registerFont("Reg",  FONT_REG);
    doc.registerFont("Bold", FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  ()          => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const USABLE_H = PAGE_H - MARGIN_V * 2 - HEADER_H - FOOTER_H;
    const rowsPerPage = Math.floor(USABLE_H / ROW_H);

    function drawPageHeader(pageNum: number, totalPages: number) {
      const top = MARGIN_V;

      // ── School logo
      let logoRight = TABLE_LEFT;
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, TABLE_LEFT, top, { width: 42, height: 42, fit: [42, 42] });
          logoRight = TABLE_LEFT + 48;
        } catch { /* skip */ }
      }

      // ── School name + address
      doc.font("Bold").fontSize(13).fillColor(C_DARK)
        .text(input.school.name, logoRight, top, { width: 320, lineBreak: false });
      let addrParts: string[] = [];
      if (input.school.addressLine1) addrParts.push(input.school.addressLine1);
      if (input.school.city)         addrParts.push(input.school.city);
      if (input.school.state)        addrParts.push(input.school.state);
      if (input.school.pinCode)      addrParts.push(input.school.pinCode);
      if (addrParts.length) {
        doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(addrParts.join(", "), logoRight, top + 16, { width: 320 });
      }
      let contactParts: string[] = [];
      if (input.school.phone) contactParts.push(input.school.phone);
      if (input.school.email) contactParts.push(input.school.email);
      if (contactParts.length) {
        doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(contactParts.join("  |  "), logoRight, top + 27, { width: 320 });
      }

      // ── Report title (right side)
      const titleX = TABLE_LEFT + TABLE_WIDTH - 220;
      doc.font("Bold").fontSize(14).fillColor(C_DARK)
        .text("Fee Ledger Report", titleX, top, { width: 220, align: "right" });
      if (input.sessionLabel) {
        doc.font("Reg").fontSize(8).fillColor(C_MUTED)
          .text(`Session: ${input.sessionLabel}`, titleX, top + 18, { width: 220, align: "right" });
      }
      doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`Generated: ${input.generatedAtIST}`, titleX, top + 30, { width: 220, align: "right" });

      // ── Applied filters line
      const filterParts: string[] = [];
      if (input.filters.search)   filterParts.push(`Search: "${input.filters.search}"`);
      if (input.filters.status)   filterParts.push(`Status: ${input.filters.status}`);
      if (input.filters.class)    filterParts.push(`Class: ${input.filters.class}`);
      if (input.filters.feeName)  filterParts.push(`Fee: ${input.filters.feeName}`);
      if (input.filters.feeType)  filterParts.push(`Type: ${input.filters.feeType}`);
      if (input.filters.dateFrom) filterParts.push(`From: ${fmtDate(input.filters.dateFrom)}`);
      if (input.filters.dateTo)   filterParts.push(`To: ${fmtDate(input.filters.dateTo)}`);

      const filterY = top + 44;
      if (filterParts.length) {
        doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(`Filters: ${filterParts.join("  ·  ")}`, TABLE_LEFT, filterY, { width: TABLE_WIDTH });
      }

      // ── Record count
      const countY = filterParts.length ? filterY + 10 : filterY;
      doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`${input.rows.length} record${input.rows.length !== 1 ? "s" : ""}  ·  Page ${pageNum} of ${totalPages}`,
          TABLE_LEFT, countY, { width: TABLE_WIDTH, align: "right" });

      // ── Horizontal rule
      const ruleY = MARGIN_V + HEADER_H - 8;
      doc.moveTo(TABLE_LEFT, ruleY).lineTo(TABLE_LEFT + TABLE_WIDTH, ruleY)
        .strokeColor(C_RULE).lineWidth(0.5).stroke();

      // ── Column headers
      drawColHeaders(MARGIN_V + HEADER_H);
    }

    function drawColHeaders(y: number) {
      // Navy background
      doc.rect(TABLE_LEFT, y, TABLE_WIDTH, COL_H).fill(C_THEAD);
      let x = TABLE_LEFT;
      for (const col of COLS) {
        doc.font("Bold").fontSize(6.5).fillColor(C_WHITE)
          .text(col.label, x + 3, y + 5, { width: col.width - 6, align: col.align ?? "left", lineBreak: false });
        x += col.width;
      }
    }

    function drawFooter(pageNum: number, totalPages: number) {
      const y = PAGE_H - MARGIN_V - 10;
      doc.font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(`${input.school.name} — Fee Ledger Report`, TABLE_LEFT, y, { width: TABLE_WIDTH / 2 });
      doc.font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(`Page ${pageNum} of ${totalPages}`, TABLE_LEFT + TABLE_WIDTH / 2, y,
          { width: TABLE_WIDTH / 2, align: "right" });
    }

    // ── Pre-compute page count
    let totalPages: number;
    if (input.rows.length === 0) {
      totalPages = 1;
    } else {
      totalPages = Math.ceil(input.rows.length / rowsPerPage);
    }

    function addPage(pageNum: number) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawPageHeader(pageNum, totalPages);
      drawFooter(pageNum, totalPages);
    }

    // ── Empty report
    if (input.rows.length === 0) {
      addPage(1);
      doc.font("Reg").fontSize(10).fillColor(C_MUTED)
        .text("No records found for the selected filters.",
          TABLE_LEFT, TABLE_TOP + COL_H + 20, { width: TABLE_WIDTH, align: "center" });
      doc.end();
      return;
    }

    // ── Render rows page by page
    for (let page = 0; page < totalPages; page++) {
      addPage(page + 1);
      const startRow = page * rowsPerPage;
      const endRow   = Math.min(startRow + rowsPerPage, input.rows.length);

      for (let ri = startRow; ri < endRow; ri++) {
        const row = input.rows[ri];
        const y = TABLE_TOP + COL_H + (ri - startRow) * ROW_H;

        // Alternating row background
        if ((ri - startRow) % 2 === 0) {
          doc.rect(TABLE_LEFT, y, TABLE_WIDTH, ROW_H).fill(C_ALT);
        }

        // Bottom border
        doc.moveTo(TABLE_LEFT, y + ROW_H).lineTo(TABLE_LEFT + TABLE_WIDTH, y + ROW_H)
          .strokeColor(C_RULE).lineWidth(0.3).stroke();

        // ── Cells
        let x = TABLE_LEFT;
        for (const col of COLS) {
          let cellText = "";
          let cellColor = C_BODY;

          switch (col.key) {
            case "invoice_number":  cellText = s(row.invoice_number); break;
            case "receipt_number":  cellText = s(row.receipt_number); break;
            case "student_name":    cellText = s(row.student_name); break;
            case "student_id":      cellText = s(row.student_id); break;
            case "class":           cellText = row.section ? `${s(row.class)}-${s(row.section)}` : s(row.class); break;
            case "fee_name":        cellText = s(row.fee_name ?? row.fee_type); break;
            case "fee_type":        cellText = s(row.fee_type); break;
            case "fee_period":      cellText = fmtPeriod(row.fee_period_start, row.fee_period_end); break;
            case "frequency":       cellText = s(row.frequency); break;
            case "invoice_amount":  cellText = fmtINR(Number(row.invoice_amount ?? 0)); break;
            case "due_date":        cellText = fmtDate(row.due_date); break;
            case "status":
              cellText  = s(row.status);
              cellColor = statusColor(row.status);
              break;
            case "paid_date":       cellText = fmtDate(row.paid_date); break;
            case "amount_paid":     cellText = row.amount_paid ? fmtINR(Number(row.amount_paid)) : "—"; break;
            case "outstanding":     cellText = row.outstanding  ? fmtINR(Number(row.outstanding))  : "—"; break;
            case "payment_method":  cellText = s(row.payment_method); break;
            case "reference_number":cellText = s(row.reference_number); break;
            default: cellText = "—";
          }

          const isRight  = col.align === "right";
          const isCenter = col.align === "center";
          doc.font("Reg").fontSize(6.5).fillColor(cellColor)
            .text(cellText, x + 2, y + 4,
              { width: col.width - 4, align: isRight ? "right" : isCenter ? "center" : "left", lineBreak: false });
          x += col.width;
        }
      }

      // ── Summary totals on last page
      if (page === totalPages - 1) {
        const summaryY = TABLE_TOP + COL_H + (endRow - startRow) * ROW_H + 4;
        const totalInvoiced  = input.rows.reduce((s, r) => s + Number(r.invoice_amount  ?? 0), 0);
        const totalPaid      = input.rows.reduce((s, r) => s + Number(r.amount_paid     ?? 0), 0);
        const totalOutstanding = input.rows.reduce((s, r) => s + Number(r.outstanding   ?? 0), 0);

        if (summaryY + 18 < PAGE_H - MARGIN_V - FOOTER_H) {
          doc.rect(TABLE_LEFT, summaryY, TABLE_WIDTH, 18).fill(C_THEAD);
          doc.font("Bold").fontSize(7).fillColor(C_WHITE)
            .text("TOTALS", TABLE_LEFT + 4, summaryY + 5, { width: 200, lineBreak: false });

          // Place totals under their columns
          let sx = TABLE_LEFT;
          for (const col of COLS) {
            let totalText = "";
            if (col.key === "invoice_amount") totalText = fmtINR(totalInvoiced);
            else if (col.key === "amount_paid")   totalText = fmtINR(totalPaid);
            else if (col.key === "outstanding")   totalText = fmtINR(totalOutstanding);
            if (totalText) {
              doc.font("Bold").fontSize(7).fillColor(C_WHITE)
                .text(totalText, sx + 2, summaryY + 5, { width: col.width - 4, align: "right", lineBreak: false });
            }
            sx += col.width;
          }
        }
      }
    }

    doc.end();
  });
}
