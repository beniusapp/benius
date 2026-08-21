/**
 * transaction-pdf.ts
 * Generates a professional A4-landscape Payment Transaction Report PDF using PDFKit.
 * All amounts in INR (₹). DejaVu Sans font for ₹ glyph support.
 * Headers repeat on every page; automatic pagination.
 */

import PDFDocument from "pdfkit";
import https from "https";
import http from "http";

const FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const C_DARK  = "#102b49";
const C_MUTED = "#627386";
const C_RULE  = "#d9e1e8";
const C_WHITE = "#ffffff";
const C_BODY  = "#1a2332";
const C_ALT   = "#f8fafc";
const C_THEAD = "#102b49";

function statusColor(status: string): string {
  switch (status) {
    case "captured":  return "#166534";
    case "refunded":  return "#1d4ed8";
    case "failed":    return "#991b1b";
    default:          return "#374151";
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

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    const d = new Date(String(v));
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return "—"; }
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

export interface TxRow {
  id:                    number;
  student_name:          string | null;
  student_id:            string | null;   // DSID
  invoice_number:        string | null;
  receipt_number:        string | null;
  payment_method:        string | null;
  received_date:         string | null;
  created_at:            string | null;
  amount:                number;
  late_fee_paid:         number;
  gateway_status:        string | null;
  razorpay_payment_id:   string | null;
  razorpay_order_id:     string | null;
  reference_number:      string | null;
  fee_type:              string | null;
  fee_name:              string | null;
}

export interface TransactionPdfInput {
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
    method?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  rows: TxRow[];
  generatedAtIST: string;
}

// ── Column layout (A4 landscape usable width ≈ 770pt)
const COLS: { key: string; label: string; width: number; align?: "right" | "center" }[] = [
  { key: "sno",                  label: "#",           width: 22 },
  { key: "student_name",         label: "Student",     width: 90 },
  { key: "student_id",           label: "DSID",        width: 50 },
  { key: "invoice_number",       label: "Invoice No.", width: 62 },
  { key: "receipt_number",       label: "Receipt No.", width: 58 },
  { key: "fee_name",             label: "Fee",         width: 70 },
  { key: "received_date",        label: "Date",        width: 55 },
  { key: "payment_method",       label: "Method",      width: 58 },
  { key: "amount",               label: "Amount",      width: 55, align: "right" },
  { key: "late_fee_paid",        label: "Late Fee",    width: 48, align: "right" },
  { key: "gateway_status",       label: "Status",      width: 48, align: "center" },
  { key: "razorpay_payment_id",  label: "Payment ID",  width: 90 },
  { key: "reference_number",     label: "Reference",   width: 64 },
];
// 22+90+50+62+58+70+55+58+55+48+48+90+64 = 770 ✓
const TABLE_WIDTH = COLS.reduce((s, c) => s + c.width, 0);

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN_H = 36;
const MARGIN_V = 36;
const HEADER_H = 110;
const TABLE_TOP = MARGIN_V + HEADER_H;
const COL_H = 18;
const ROW_H = 15;
const FOOTER_H = 20;
const TABLE_LEFT = MARGIN_H;

export async function renderTransactionPdf(input: TransactionPdfInput): Promise<Buffer> {
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

      // Logo
      let logoRight = TABLE_LEFT;
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, TABLE_LEFT, top, { width: 42, height: 42, fit: [42, 42] });
          logoRight = TABLE_LEFT + 48;
        } catch { /* skip */ }
      }

      // School info
      doc.font("Bold").fontSize(13).fillColor(C_DARK)
        .text(input.school.name, logoRight, top, { width: 320, lineBreak: false });
      const addrParts: string[] = [];
      if (input.school.addressLine1) addrParts.push(input.school.addressLine1);
      if (input.school.city)         addrParts.push(input.school.city);
      if (input.school.state)        addrParts.push(input.school.state);
      if (input.school.pinCode)      addrParts.push(input.school.pinCode);
      if (addrParts.length) {
        doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(addrParts.join(", "), logoRight, top + 16, { width: 320 });
      }
      const contactParts: string[] = [];
      if (input.school.phone) contactParts.push(input.school.phone);
      if (input.school.email) contactParts.push(input.school.email);
      if (contactParts.length) {
        doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(contactParts.join("  |  "), logoRight, top + 27, { width: 320 });
      }

      // Report title
      const titleX = TABLE_LEFT + TABLE_WIDTH - 240;
      doc.font("Bold").fontSize(14).fillColor(C_DARK)
        .text("Payment Transaction Report", titleX, top, { width: 240, align: "right" });
      if (input.sessionLabel) {
        doc.font("Reg").fontSize(8).fillColor(C_MUTED)
          .text(`Session: ${input.sessionLabel}`, titleX, top + 18, { width: 240, align: "right" });
      }
      doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`Generated: ${input.generatedAtIST}`, titleX, top + 30, { width: 240, align: "right" });

      // Filters
      const filterParts: string[] = [];
      if (input.filters.search)   filterParts.push(`Search: "${input.filters.search}"`);
      if (input.filters.method)   filterParts.push(`Method: ${input.filters.method}`);
      if (input.filters.status)   filterParts.push(`Status: ${input.filters.status}`);
      if (input.filters.dateFrom) filterParts.push(`From: ${fmtDate(input.filters.dateFrom)}`);
      if (input.filters.dateTo)   filterParts.push(`To: ${fmtDate(input.filters.dateTo)}`);
      const filterY = top + 44;
      if (filterParts.length) {
        doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
          .text(`Filters: ${filterParts.join("  ·  ")}`, TABLE_LEFT, filterY, { width: TABLE_WIDTH });
      }

      // Record count
      const countY = filterParts.length ? filterY + 10 : filterY;
      doc.font("Reg").fontSize(7.5).fillColor(C_MUTED)
        .text(`${input.rows.length} transaction${input.rows.length !== 1 ? "s" : ""}  ·  Page ${pageNum} of ${totalPages}`,
          TABLE_LEFT, countY, { width: TABLE_WIDTH, align: "right" });

      // Rule
      const ruleY = MARGIN_V + HEADER_H - 8;
      doc.moveTo(TABLE_LEFT, ruleY).lineTo(TABLE_LEFT + TABLE_WIDTH, ruleY)
        .strokeColor(C_RULE).lineWidth(0.5).stroke();

      // Column headers
      drawColHeaders(MARGIN_V + HEADER_H);
    }

    function drawColHeaders(y: number) {
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
        .text(`${input.school.name} — Payment Transaction Report`, TABLE_LEFT, y, { width: TABLE_WIDTH / 2 });
      doc.font("Reg").fontSize(7).fillColor(C_MUTED)
        .text(`Page ${pageNum} of ${totalPages}`, TABLE_LEFT + TABLE_WIDTH / 2, y,
          { width: TABLE_WIDTH / 2, align: "right" });
    }

    const totalPages = input.rows.length === 0 ? 1 : Math.ceil(input.rows.length / rowsPerPage);

    function addPage(pageNum: number) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
      drawPageHeader(pageNum, totalPages);
      drawFooter(pageNum, totalPages);
    }

    // Empty report
    if (input.rows.length === 0) {
      addPage(1);
      doc.font("Reg").fontSize(10).fillColor(C_MUTED)
        .text("No transactions found for the selected filters.",
          TABLE_LEFT, TABLE_TOP + COL_H + 20, { width: TABLE_WIDTH, align: "center" });
      doc.end();
      return;
    }

    // Render pages
    for (let page = 0; page < totalPages; page++) {
      addPage(page + 1);
      const startRow = page * rowsPerPage;
      const endRow   = Math.min(startRow + rowsPerPage, input.rows.length);

      for (let ri = startRow; ri < endRow; ri++) {
        const row = input.rows[ri];
        const y = TABLE_TOP + COL_H + (ri - startRow) * ROW_H;

        if ((ri - startRow) % 2 === 0) {
          doc.rect(TABLE_LEFT, y, TABLE_WIDTH, ROW_H).fill(C_ALT);
        }
        doc.moveTo(TABLE_LEFT, y + ROW_H).lineTo(TABLE_LEFT + TABLE_WIDTH, y + ROW_H)
          .strokeColor(C_RULE).lineWidth(0.3).stroke();

        let x = TABLE_LEFT;
        for (const col of COLS) {
          let cellText = "";
          let cellColor = C_BODY;

          switch (col.key) {
            case "sno":                 cellText = String(ri + 1); break;
            case "student_name":        cellText = s(row.student_name); break;
            case "student_id":          cellText = s(row.student_id); break;
            case "invoice_number":      cellText = s(row.invoice_number); break;
            case "receipt_number":      cellText = s(row.receipt_number); break;
            case "fee_name":            cellText = s(row.fee_name ?? row.fee_type); break;
            case "received_date":       cellText = fmtDate(row.received_date); break;
            case "payment_method":      cellText = s(row.payment_method); break;
            case "amount":              cellText = fmtINR(Number(row.amount ?? 0)); break;
            case "late_fee_paid":       cellText = Number(row.late_fee_paid ?? 0) > 0 ? fmtINR(Number(row.late_fee_paid)) : "—"; break;
            case "gateway_status":
              cellText  = s(row.gateway_status ?? (row.razorpay_payment_id ? "captured" : "offline"));
              cellColor = statusColor(cellText);
              break;
            case "razorpay_payment_id":
              cellText = row.razorpay_payment_id
                ? `${row.razorpay_payment_id}${row.razorpay_order_id ? ` / ${row.razorpay_order_id}` : ""}`
                : "—";
              break;
            case "reference_number":    cellText = s(row.reference_number); break;
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

      // Totals on last page
      if (page === totalPages - 1) {
        const summaryY = TABLE_TOP + COL_H + (endRow - startRow) * ROW_H + 4;
        const totalAmount    = input.rows.reduce((s, r) => s + Number(r.amount     ?? 0), 0);
        const totalLateFee   = input.rows.reduce((s, r) => s + Number(r.late_fee_paid ?? 0), 0);

        if (summaryY + 18 < PAGE_H - MARGIN_V - FOOTER_H) {
          doc.rect(TABLE_LEFT, summaryY, TABLE_WIDTH, 18).fill(C_THEAD);
          doc.font("Bold").fontSize(7).fillColor(C_WHITE)
            .text("TOTALS", TABLE_LEFT + 4, summaryY + 5, { width: 200, lineBreak: false });

          let sx = TABLE_LEFT;
          for (const col of COLS) {
            let totalText = "";
            if (col.key === "amount")       totalText = fmtINR(totalAmount);
            else if (col.key === "late_fee_paid" && totalLateFee > 0) totalText = fmtINR(totalLateFee);
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
