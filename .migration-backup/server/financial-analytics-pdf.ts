/**
 * server/financial-analytics-pdf.ts
 *
 * Canonical Financial Analytics PDF renderer.
 *
 * Produces a professional A4-portrait PDF from a FinancialAnalyticsResult
 * produced by buildFinancialAnalytics().
 *
 * Design guarantees
 * ─────────────────
 * 1. No network I/O — all fonts are local DejaVu TTFs.
 * 2. No SQL — data is entirely sourced from the passed FinancialAnalyticsResult.
 * 3. Every export includes: school name, academic session, exact date range,
 *    filter label, timezone, and generated IST timestamp from data.generatedAt.
 * 4. Robust A4 pagination: every table row is measured with PDFKit's actual
 *    glyph metrics before drawing; ensureSpace() is called with the measured
 *    height, so no row ever bleeds into the footer or across a page boundary.
 * 5. Header rows are also measured — long translated column labels wrap safely.
 * 6. Supports sections: complete | summary | trend | channels | classes |
 *    categories | aging | cash.
 */

import PDFDocument from "pdfkit";
import {
  FinancialAnalyticsResult,
} from "./financial-analytics-data";
import { formatDateTimeIST, formatDateOnly } from "../shared/ist-time";

// ── Fonts ─────────────────────────────────────────────────────────────────────
const FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// ── Palette ───────────────────────────────────────────────────────────────────
const C_DARK   = "#0d1f35";
const C_ACCENT = "#D4AF37";
const C_CYAN   = "#06b6d4";
const C_RED    = "#ef4444";
const C_GREEN  = "#10b981";
const C_MUTED  = "#64748b";
const C_WHITE  = "#ffffff";
const C_BORDER = "#1e3a5f";
const C_ROW_A  = "#0f2d4a";
const C_ROW_B  = "#0a1e30";
const C_THEAD  = "#1a3a5f";
const C_KPI_BG = "#0f2d4a";

// ── Section type ──────────────────────────────────────────────────────────────
export type ReportSection =
  | "complete"
  | "summary"
  | "trend"
  | "channels"
  | "classes"
  | "categories"
  | "aging"
  | "cash";

export interface RenderFinancialAnalyticsPdfOptions {
  data: FinancialAnalyticsResult;
  school: { name: string };
  section: ReportSection;
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtINR(n: number): string {
  return "\u20B9" + new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: string): string {
  return formatDateOnly(d, false);
}

// ── Page geometry (A4 portrait) ────────────────────────────────────────────────
const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const MARGIN_H  = 50;
const MARGIN_V  = 50;
const CONTENT_W = PAGE_W - MARGIN_H * 2;  // 495.28 pt

// Header height for identity block
const HEADER_H  = 125;
// Footer height
const FOOTER_H  = 30;
// Usable body start Y (first usable pixel below header accent bar)
const BODY_START = MARGIN_V + HEADER_H;   // 175
// Usable body end Y (must stay above footer rule line)
const BODY_END   = PAGE_H - FOOTER_H - 12; // ~799
// Minimum row height — ensures even a 1-line cell has comfortable padding
const ROW_MIN_H  = 18;
// Vertical padding inside every table cell (top + bottom each)
const CELL_PAD_V = 5;
// Horizontal inner pad: text starts at column-left + CELL_PAD_H
const CELL_PAD_H = 5;

// ── PDFKit document type alias (avoid TypeScript `any` spray) ─────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDoc = any;

// ── Context passed around during rendering ─────────────────────────────────────

interface Ctx {
  doc: PdfDoc;
  y: number;
  pageNum: number;
  data: FinancialAnalyticsResult;
  school: { name: string };
  identityLine1: string;
  identityLine2: string;
  identityLine3: string;
}

// ── Identity strings ───────────────────────────────────────────────────────────

function buildIdentityLines(
  data: FinancialAnalyticsResult,
  school: { name: string },
): { line1: string; line2: string; line3: string } {
  const { filter, sessionInfo } = data;
  const line1 = school.name;
  const sessionPart    = `Session: ${sessionInfo.sessionName}`;
  const dateRangePart  = `${fmtDate(filter.startDate)} \u2013 ${fmtDate(filter.endDate)}`;
  const filterLabelPart = `Filter: ${filter.label}`;
  const tzPart         = `Timezone: ${filter.timezone}`;
  const line2 = `${sessionPart}   |   ${dateRangePart}   |   ${filterLabelPart}`;
  const generatedAtIST = formatDateTimeIST(data.generatedAt);
  const line3 = `${tzPart}   |   Generated: ${generatedAtIST}`;
  return { line1, line2, line3 };
}

// ── Draw the per-page header (identity block) ──────────────────────────────────

function drawHeader(ctx: Ctx): void {
  const { doc } = ctx;

  // Dark header background
  doc.rect(0, 0, PAGE_W, HEADER_H).fill(C_DARK);

  // Accent bar beneath header
  doc.rect(0, HEADER_H, PAGE_W, 3).fill(C_ACCENT);

  // School name
  doc.font(FONT_BOLD).fontSize(18).fillColor(C_WHITE)
     .text(ctx.identityLine1, MARGIN_H, MARGIN_V - 5, { width: CONTENT_W, lineBreak: false });

  // Session / date range / filter
  doc.font(FONT_REG).fontSize(8).fillColor(C_MUTED)
     .text(ctx.identityLine2, MARGIN_H, MARGIN_V + 22, { width: CONTENT_W });

  // Timezone / generated
  doc.font(FONT_REG).fontSize(8).fillColor(C_MUTED)
     .text(ctx.identityLine3, MARGIN_H, MARGIN_V + 35, { width: CONTENT_W });

  // Report type label
  doc.font(FONT_REG).fontSize(8).fillColor(C_MUTED)
     .text("FINANCIAL ANALYTICS REPORT", MARGIN_H, MARGIN_V + 52, {
       width: CONTENT_W, characterSpacing: 2, lineBreak: false,
     });
}

// ── Draw the per-page footer ───────────────────────────────────────────────────

function drawFooter(ctx: Ctx): void {
  const { doc } = ctx;
  const footerY = PAGE_H - FOOTER_H;

  doc.moveTo(MARGIN_H, footerY)
     .lineTo(PAGE_W - MARGIN_H, footerY)
     .lineWidth(0.5).strokeColor(C_BORDER).stroke();

  doc.font(FONT_REG).fontSize(7).fillColor(C_MUTED)
     .text(
       `${ctx.identityLine1}   |   Financial Analytics   |   Confidential \u2014 For board use only   |   Page ${ctx.pageNum}`,
       MARGIN_H, footerY + 8,
       { width: CONTENT_W, align: "center", lineBreak: false },
     );
}

// ── Add a new page, draw header + footer, reset ctx.y ─────────────────────────

function addPage(ctx: Ctx): void {
  ctx.doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
  ctx.pageNum++;
  drawHeader(ctx);
  drawFooter(ctx);
  ctx.y = BODY_START + 10;
}

// ── Ensure enough vertical space; add new page if not enough ─────────────────

function ensureSpace(ctx: Ctx, needed: number): void {
  if (ctx.y + needed > BODY_END) {
    addPage(ctx);
  }
}

// ── Section title ─────────────────────────────────────────────────────────────

function drawSectionTitle(ctx: Ctx, title: string, keepWith = 0): void {
  // Keep a heading with the first meaningful block of its section. Without
  // this reservation a heading could render at the page bottom while its KPI
  // row or table header started on the following page.
  ensureSpace(ctx, 30 + keepWith);
  ctx.doc.font(FONT_BOLD).fontSize(8).fillColor(C_MUTED)
     .text(title.toUpperCase(), MARGIN_H, ctx.y, { characterSpacing: 2, width: CONTENT_W, lineBreak: false });
  ctx.y += 13;
  ctx.doc.moveTo(MARGIN_H, ctx.y)
     .lineTo(MARGIN_H + CONTENT_W, ctx.y)
     .lineWidth(0.5).strokeColor(C_BORDER).stroke();
  ctx.y += 8;
}

// ── KPI card row ──────────────────────────────────────────────────────────────

interface KpiItem { label: string; value: string; color: string; subvalue?: string }

function drawKpiRow(ctx: Ctx, items: KpiItem[]): void {
  ensureSpace(ctx, 60);
  const colW = CONTENT_W / items.length;
  items.forEach((item, i) => {
    const x = MARGIN_H + i * colW;
    ctx.doc.rect(x, ctx.y, colW - 6, 52).fillColor(C_KPI_BG).fill();
    ctx.doc.font(FONT_REG).fontSize(7.5).fillColor(C_MUTED)
       .text(item.label, x + 10, ctx.y + 8, { width: colW - 20 });
    ctx.doc.font(FONT_BOLD).fontSize(14).fillColor(item.color)
       .text(item.value, x + 10, ctx.y + 21, { width: colW - 20, lineBreak: false });
    if (item.subvalue) {
      ctx.doc.font(FONT_REG).fontSize(7).fillColor(C_MUTED)
         .text(item.subvalue, x + 10, ctx.y + 39, { width: colW - 20 });
    }
  });
  ctx.y += 60;
}

// ── Table row height measurement ──────────────────────────────────────────────
//
// For each cell: set the correct font+size, call doc.heightOfString(cell, {width})
// where width = colWidth - (CELL_PAD_H * 2) — the usable inner text width.
// Take the maximum across all cells, add CELL_PAD_V top + bottom, enforce ROW_MIN_H.
//
// Column 0 (labels) uses FONT_REG / size 8 with left-align and CAN wrap.
// Numeric columns (i > 0) also use FONT_REG / size 8 but INR amounts never wrap
// in practice; we still measure them so a pathological value can't overflow.

function measureRowHeight(doc: PdfDoc, cells: string[], widths: number[]): number {
  doc.font(FONT_REG).fontSize(8);
  let maxTextH = 0;
  cells.forEach((cell, i) => {
    const innerW  = Math.max(widths[i] - CELL_PAD_H * 2, 1);
    const textH   = doc.heightOfString(cell, { width: innerW });
    if (textH > maxTextH) maxTextH = textH;
  });
  return Math.max(maxTextH + CELL_PAD_V * 2, ROW_MIN_H);
}

// ── Table header height measurement ──────────────────────────────────────────
// Header labels use FONT_BOLD / size 7.5.  Same logic — measure to handle
// translated or long column labels.

function measureHeaderHeight(doc: PdfDoc, cols: string[], widths: number[]): number {
  doc.font(FONT_BOLD).fontSize(7.5);
  let maxTextH = 0;
  cols.forEach((col, i) => {
    const innerW = Math.max(widths[i] - CELL_PAD_H * 2, 1);
    const textH  = doc.heightOfString(col, { width: innerW });
    if (textH > maxTextH) maxTextH = textH;
  });
  return Math.max(maxTextH + CELL_PAD_V * 2, ROW_MIN_H);
}

// ── Draw table header ─────────────────────────────────────────────────────────

function drawTableHeader(ctx: Ctx, cols: string[], widths: number[]): void {
  const rowH = measureHeaderHeight(ctx.doc, cols, widths);
  ensureSpace(ctx, rowH);

  ctx.doc.rect(MARGIN_H, ctx.y, CONTENT_W, rowH).fillColor(C_THEAD).fill();

  let x = MARGIN_H;
  cols.forEach((col, i) => {
    const innerW = widths[i] - CELL_PAD_H * 2;
    ctx.doc.font(FONT_BOLD).fontSize(7.5).fillColor(C_MUTED)
       .text(col, x + CELL_PAD_H, ctx.y + CELL_PAD_V, {
         width: innerW,
         align: i > 0 ? "right" : "left",
         // Allow header labels to wrap — they are measured and the row is sized
       });
    x += widths[i];
  });

  ctx.y += rowH;
}

// ── Draw table data row ───────────────────────────────────────────────────────
// Height is computed from actual glyph metrics before drawing anything.
// The background rect, each cell text, and ctx.y advance all use the same height.

function drawTableRow(
  ctx: Ctx,
  cells: string[],
  widths: number[],
  even: boolean,
  colors?: (string | null)[],
): void {
  const rowH = measureRowHeight(ctx.doc, cells, widths);
  ensureSpace(ctx, rowH);

  // Background
  ctx.doc.rect(MARGIN_H, ctx.y, CONTENT_W, rowH)
     .fillColor(even ? C_ROW_A : C_ROW_B).fill();

  // Cell text — top-aligned within the row
  let x = MARGIN_H;
  cells.forEach((cell, i) => {
    const clr    = colors?.[i] ?? C_WHITE;
    const innerW = widths[i] - CELL_PAD_H * 2;
    ctx.doc.font(FONT_REG).fontSize(8).fillColor(clr ?? C_WHITE)
       .text(cell, x + CELL_PAD_H, ctx.y + CELL_PAD_V, {
         width: innerW,
         align: i > 0 ? "right" : "left",
         // Wrapping is enabled (no lineBreak:false); the row is pre-measured
         // to fit all wrapped lines without overflow.
       });
    x += widths[i];
  });

  ctx.y += rowH;
}

// ── Section renderers ─────────────────────────────────────────────────────────

function renderSummarySection(ctx: Ctx): void {
  const s = ctx.data.summary;
  const c = ctx.data.comparison;

  drawSectionTitle(ctx, "Executive Summary", 60);

  drawKpiRow(ctx, [
    {
      label: "Due This Period",
      value: fmtINR(s.billed),
      color: C_MUTED,
      subvalue: c
        ? (c.billedChange !== null
            ? `${c.billedChange >= 0 ? "+" : ""}${c.billedChange.toFixed(1)}% vs prior period`
            : undefined)
        : undefined,
    },
    {
      label: "Gross Collected",
      value: fmtINR(s.grossCollected),
      color: C_ACCENT,
      subvalue: c
        ? (c.grossCollectedChange !== null
            ? `${c.grossCollectedChange >= 0 ? "+" : ""}${c.grossCollectedChange.toFixed(1)}% vs prior period`
            : undefined)
        : undefined,
    },
  ]);
  ctx.y += 4;

  drawKpiRow(ctx, [
    {
      label: "Net Collected",
      value: fmtINR(s.netCollected),
      color: C_GREEN,
      subvalue: c
        ? (c.netCollectedChange !== null
            ? `${c.netCollectedChange >= 0 ? "+" : ""}${c.netCollectedChange.toFixed(1)}% vs prior period`
            : undefined)
        : undefined,
    },
  ]);
  ctx.y += 4;

  drawKpiRow(ctx, [
    { label: "Outstanding", value: fmtINR(s.outstanding), color: C_RED },
    {
      label: "Collection Efficiency",
      value: s.collectionEfficiency == null ? "N/A" : `${s.collectionEfficiency.toFixed(1)}%`,
      color: s.collectionEfficiency == null ? C_MUTED
           : s.collectionEfficiency >= 80 ? C_GREEN
           : s.collectionEfficiency >= 50 ? C_ACCENT : C_RED,
    },
  ]);
  ctx.y += 4;

  drawKpiRow(ctx, [
    { label: "Online Collected",  value: fmtINR(s.onlineCollected),  color: C_CYAN  },
    { label: "Offline Collected", value: fmtINR(s.offlineCollected), color: C_MUTED },
  ]);
  ctx.y += 4;

  drawKpiRow(ctx, [
    { label: "Overdue Amount", value: fmtINR(s.overdueAmount),       color: "#f97316" },
    { label: "Transactions",   value: String(s.transactionCount),    color: C_MUTED   },
  ]);

  ctx.y += 4;
  ctx.doc.font(FONT_REG).fontSize(7).fillColor(C_MUTED).text(
    "Due This Period uses invoice due dates. Collections use payment received dates; efficiency is N/A when no invoices are due.",
    MARGIN_H,
    ctx.y,
    { width: CONTENT_W },
  );
  ctx.y += 16;

  if (s.totalLatePenalties > 0) {
    ctx.y += 4;
    drawKpiRow(ctx, [
      { label: "Late Penalties Collected", value: fmtINR(s.totalLatePenalties), color: "#f97316" },
      { label: "Report Period",            value: ctx.data.filter.label,         color: C_MUTED   },
    ]);
  }

  ctx.y += 10;
}

function renderTrendSection(ctx: Ctx): void {
  const trend = ctx.data.trend;
  if (!trend.length) return;

  drawSectionTitle(ctx, "Collection Trend", 40);

  const colW = [80, (CONTENT_W - 80) / 3, (CONTENT_W - 80) / 3, (CONTENT_W - 80) / 3];
  drawTableHeader(ctx, ["Period", "Due This Period", "Collected", "Net Collected"], colW);
  trend.forEach((pt, i) => {
    drawTableRow(
      ctx,
      [pt.label, fmtINR(pt.billed), fmtINR(pt.grossCollected), fmtINR(pt.netCollected)],
      colW, i % 2 === 0,
      [null, null, C_CYAN, C_GREEN],
    );
  });
  ctx.y += 12;
}

function renderChannelsSection(ctx: Ctx): void {
  const { online, offline, paymentChannelSplit } = ctx.data;

  drawSectionTitle(ctx, "Payment Channel Split", 78);
  drawKpiRow(ctx, [
    { label: "Total Collected", value: fmtINR(paymentChannelSplit.totalCollected), color: C_GREEN },
    { label: "Transactions", value: String(paymentChannelSplit.totalTransactions), color: C_MUTED },
  ]);
  ctx.doc.font(FONT_REG).fontSize(7).fillColor(C_MUTED).text(
    "Successful recorded payments in the selected IST date range. This total reconciles to Gross Collected.",
    MARGIN_H,
    ctx.y,
    { width: CONTENT_W },
  );
  ctx.y += 18;
  if (paymentChannelSplit.channels.length > 0) {
    const channelWidths = [CONTENT_W * 0.4, CONTENT_W * 0.18, CONTENT_W * 0.25, CONTENT_W * 0.17];
    drawTableHeader(ctx, ["Payment Channel", "Transactions", "Collected", "Share"], channelWidths);
    paymentChannelSplit.channels.forEach((channel, i) => {
      drawTableRow(
        ctx,
        [channel.method, String(channel.count), fmtINR(channel.amount), `${channel.percentage.toFixed(2)}%`],
        channelWidths,
        i % 2 === 0,
        [null, null, C_GREEN, C_CYAN],
      );
    });
  } else {
    ctx.doc.font(FONT_REG).fontSize(8).fillColor(C_MUTED)
      .text("No successful recorded payments were received in this range.", MARGIN_H, ctx.y, { width: CONTENT_W });
    ctx.y += 18;
  }
  ctx.y += 10;

  drawSectionTitle(ctx, "Online Channel", 118);
  drawKpiRow(ctx, [
    { label: "Gross Collected", value: fmtINR(online.grossCollected), color: C_CYAN  },
    { label: "Transactions",    value: String(online.transactionCount), color: C_MUTED },
  ]);
  drawKpiRow(ctx, [
    { label: "Net Collected", value: fmtINR(online.netCollected), color: C_GREEN },
  ]);
  ctx.y += 4;

  if (online.methods.length > 0) {
    const mw = [CONTENT_W / 3, CONTENT_W / 3, CONTENT_W / 3];
    drawTableHeader(ctx, ["Successful Payment Method", "Transactions", "Collected"], mw);
    online.methods.forEach((m, i) => {
      drawTableRow(ctx, [m.method, String(m.count), fmtINR(m.amount)], mw, i % 2 === 0, [null, null, C_CYAN]);
    });
    ctx.y += 10;
  }

  drawSectionTitle(ctx, "Offline Channel", 118);
  drawKpiRow(ctx, [
    { label: "Gross Collected", value: fmtINR(offline.grossCollected), color: C_ACCENT },
    { label: "Transactions",    value: String(offline.transactionCount), color: C_MUTED },
  ]);
  drawKpiRow(ctx, [
    { label: "Net Collected", value: fmtINR(offline.netCollected), color: C_GREEN },
  ]);
  ctx.y += 4;

  if (offline.methods.length > 0) {
    const mw = [CONTENT_W / 3, CONTENT_W / 3, CONTENT_W / 3];
    drawTableHeader(ctx, ["Successful Payment Method", "Transactions", "Collected"], mw);
    offline.methods.forEach((m, i) => {
      drawTableRow(ctx, [m.method, String(m.count), fmtINR(m.amount)], mw, i % 2 === 0, [null, null, C_ACCENT]);
    });
    ctx.y += 10;
  }

  // Payment attempts are operational portal-lifecycle information, not
  // successful-payment revenue. Keeping them out of Online Channel prevents
  // failed/cancelled attempt amounts from being read as channel collections.
  if (online.statuses.length > 0) {
    drawSectionTitle(ctx, "Portal Payment Lifecycle / Payment Attempts", 62);
    ctx.doc.font(FONT_REG).fontSize(7).fillColor(C_MUTED).text(
      "Portal gateway outcomes in the selected IST date range. These counts and requested amounts are operational only and do not reconcile to collected revenue.",
      MARGIN_H,
      ctx.y,
      { width: CONTENT_W },
    );
    ctx.y += 26;
    const sw = [CONTENT_W / 3, CONTENT_W / 3, CONTENT_W / 3];
    drawTableHeader(ctx, ["Portal Outcome", "Attempts", "Requested Amount"], sw);
    online.statuses.forEach((s, i) => {
      drawTableRow(ctx, [s.status, String(s.count), fmtINR(s.amount)], sw, i % 2 === 0, [null, null, C_CYAN]);
    });
    ctx.y += 10;
  }
}

function renderClassesSection(ctx: Ctx): void {
  const cw = ctx.data.classWise;
  if (!cw.length) return;

  drawSectionTitle(ctx, "Class-Wise Breakdown", 40);
  const w = [
    80,
    (CONTENT_W - 80) / 4,
    (CONTENT_W - 80) / 4,
    (CONTENT_W - 80) / 4,
    (CONTENT_W - 80) / 4,
  ];
  drawTableHeader(ctx, ["Class / Section", "Due This Period", "Collected", "Outstanding", "Efficiency"], w);
  cw.forEach((r, i) => {
    const eff = r.billed > 0 ? `${Math.round((r.grossCollected / r.billed) * 100)}%` : "\u2014";
    drawTableRow(
      ctx,
      [r.class, fmtINR(r.billed), fmtINR(r.grossCollected), fmtINR(r.outstanding), eff],
      w, i % 2 === 0,
      [null, null, C_CYAN, C_RED, C_GREEN],
    );
  });
  ctx.y += 12;
}

function renderCategoriesSection(ctx: Ctx): void {
  const cats = ctx.data.feeCategories;
  if (!cats.length) return;

  drawSectionTitle(ctx, "Fee Categories", 40);
  // Give the label column more room; numeric cols are narrow but sufficient
  const w = [CONTENT_W * 0.50, CONTENT_W * 0.25, CONTENT_W * 0.25];
  drawTableHeader(ctx, ["Fee Type", "Due This Period", "Collected"], w);
  cats.forEach((r, i) => {
    drawTableRow(
      ctx,
      [r.feeType, fmtINR(r.billed), fmtINR(r.grossCollected)],
      w, i % 2 === 0,
      [null, null, C_CYAN],
    );
  });
  ctx.y += 12;
}

function renderAgingSection(ctx: Ctx): void {
  const aging = ctx.data.aging;

  drawSectionTitle(ctx, "Accounts Receivable Aging", 40);

  const BUCKETS: Array<{ bucket: string; label: string; color: string }> = [
    { bucket: "1-30",  label: "1\u201330 Days",  color: "#fbbf24" },
    { bucket: "31-60", label: "31\u201360 Days",  color: "#f97316" },
    { bucket: "61-90", label: "61\u201390 Days",  color: C_RED     },
    { bucket: "90+",   label: "90+ Days",          color: "#dc2626" },
  ];

  const agMap = Object.fromEntries(aging.map(a => [a.bucket, a]));
  const aw = [CONTENT_W / 3, CONTENT_W / 3, CONTENT_W / 3];
  drawTableHeader(ctx, ["Aging Bucket", "Invoices", "Outstanding"], aw);
  BUCKETS.forEach((b, i) => {
    const row = agMap[b.bucket];
    drawTableRow(
      ctx,
      [b.label, String(Number(row?.count ?? 0)), fmtINR(Number(row?.amount ?? 0))],
      aw, i % 2 === 0,
      [b.color, null, C_RED],
    );
  });
  ctx.y += 12;
}

function renderCashSection(ctx: Ctx): void {
  const cd = ctx.data.cashDenominations;

  drawSectionTitle(ctx, "Cash Denomination Coverage", 60);

  drawKpiRow(ctx, [
    { label: "Cash Collected",  value: fmtINR(cd.cashCollected),       color: C_ACCENT },
    { label: "Cash Payments",   value: String(cd.cashPaymentCount),     color: C_MUTED  },
  ]);
  drawKpiRow(ctx, [
    { label: "With Denomination Breakdown", value: String(cd.withBreakdownCount),    color: C_GREEN },
    { label: "Without Breakdown",           value: String(cd.withoutBreakdownCount), color: C_RED   },
  ]);
  drawKpiRow(ctx, [
    { label: "Documented Amount", value: fmtINR(cd.documentedAmount), color: C_CYAN },
    {
      label: "Coverage",
      value: cd.cashCollected > 0
        ? `${Math.round((cd.documentedAmount / cd.cashCollected) * 100)}%`
        : "\u2014",
      color: C_MUTED,
    },
  ]);
  ctx.y += 6;

  if (cd.denominations.length > 0) {
    const dw = [CONTENT_W / 3, CONTENT_W / 3, CONTENT_W / 3];
    drawTableHeader(ctx, ["Denomination (\u20B9)", "Quantity", "Total"], dw);
    cd.denominations.forEach((d, i) => {
      drawTableRow(
        ctx,
        [`\u20B9${d.denomination}`, String(d.quantity), fmtINR(d.total)],
        dw, i % 2 === 0,
        [null, null, C_ACCENT],
      );
    });
  }
  ctx.y += 12;
}

// ── Main export ────────────────────────────────────────────────────────────────

export function renderFinancialAnalyticsPdf(
  opts: RenderFinancialAnalyticsPdfOptions,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const { data, school, section } = opts;

    const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0, autoFirstPage: false });

    doc.registerFont("Reg",  FONT_REG);
    doc.registerFont("Bold", FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   ()          => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { line1, line2, line3 } = buildIdentityLines(data, school);

    const ctx: Ctx = {
      doc,
      y: BODY_START + 10,
      pageNum: 0,
      data,
      school,
      identityLine1: line1,
      identityLine2: line2,
      identityLine3: line3,
    };

    // Open first page
    addPage(ctx);

    // Render sections according to the requested section key
    if (section === "complete") {
      renderSummarySection(ctx);
      renderTrendSection(ctx);
      renderChannelsSection(ctx);
      renderClassesSection(ctx);
      renderCategoriesSection(ctx);
      renderAgingSection(ctx);
      renderCashSection(ctx);
    } else if (section === "summary") {
      renderSummarySection(ctx);
    } else if (section === "trend") {
      renderTrendSection(ctx);
    } else if (section === "channels") {
      renderChannelsSection(ctx);
    } else if (section === "classes") {
      renderClassesSection(ctx);
    } else if (section === "categories") {
      renderCategoriesSection(ctx);
    } else if (section === "aging") {
      renderAgingSection(ctx);
    } else if (section === "cash") {
      renderCashSection(ctx);
    }

    doc.end();
  });
}
