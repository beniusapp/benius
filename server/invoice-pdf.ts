/**
 * invoice-pdf.ts
 * Generates a professional A4 invoice PDF using PDFKit (pure Node.js).
 * Accepts the same InvoiceDocumentData used by the HTML invoice renderer.
 * No headless browser required.
 */

import PDFDocument from "pdfkit";
import https from "https";
import http from "http";
import type { InvoiceDocumentData } from "./invoice-document";

// DejaVu Sans ships on the host and supports the ₹ (U+20B9) glyph.
const FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// ── Palette (matches invoice-document.ts HTML renderer) ──────────────────────
const C_DARK  = "#102b49";
const C_MUTED = "#627386";
const C_RULE  = "#d9e1e8";
const C_WHITE = "#ffffff";
const C_BODY  = "#172033";
const C_LIGHT = "#f6f9fc";
const C_THEAD = "#102b49";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end",  ()         => resolve(Buffer.concat(chunks)));
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

function amountInWords(amount: number): string {
  const value = Math.max(0, Math.round(Number(amount) || 0));
  if (value === 0) return "Zero Rupees Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const belowHundred = (n: number): string =>
    n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ""}`;
  const belowThousand = (n: number): string =>
    n < 100 ? belowHundred(n)
    : `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${belowHundred(n % 100)}` : ""}`;
  const parts: string[] = [];
  let r = value;
  for (const [div, label] of [[10_000_000, "Crore"], [100_000, "Lakh"], [1_000, "Thousand"]] as [number, string][]) {
    if (r >= div) { parts.push(`${belowThousand(Math.floor(r / div))} ${label}`); r %= div; }
  }
  if (r) parts.push(belowThousand(r));
  return `${parts.join(" ")} Rupees Only`;
}

function frequencyLabel(f: string | null): string {
  return { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", "one-time": "One-Time" }[f ?? ""] ?? (f || "—");
}

function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v))
    ? new Date(`${v}T00:00:00Z`) : new Date(String(v));
  return isNaN(d.getTime()) ? "—"
    : d.toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}

function feePeriodLabel(data: InvoiceDocumentData): string {
  if (!data.feePeriodStart || !data.feePeriodEnd) return "—";
  if ((data.frequency === "annual" || data.frequency === "one-time") && data.academicYear)
    return data.academicYear;
  const s = new Date(`${data.feePeriodStart}T00:00:00Z`);
  const e = new Date(`${data.feePeriodEnd}T00:00:00Z`);
  if (s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth())
    return s.toLocaleDateString("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });
  return `${s.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short", year: "numeric" })} \u2013 ${e.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short", year: "numeric" })}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function renderInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  const [logoBuffer, sigBuffer] = await Promise.all([
    safeImage(data.school.logoUrl),
    safeImage(data.school.signatureUrl),
  ]);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4", margin: 40,
      info: { Title: `Invoice ${data.invoiceNumber ?? ""}`, Author: data.school.name },
    });
    doc.registerFont("Regular", FONT_REG);
    doc.registerFont("Bold",    FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   ()          => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const M  = 40;
    const PW = doc.page.width;
    const PH = doc.page.height;
    const W  = PW - M * 2;           // usable width ≈ 515

    // ── Ensure we don't overflow: add page when nearing bottom ───────────────
    const safeY = (neededH: number, current: number): number => {
      if (current + neededH > PH - M - 10) { doc.addPage(); return M; }
      return current;
    };

    const hline = (y: number, color = C_RULE, lw = 0.5) =>
      doc.moveTo(M, y).lineTo(M + W, y).lineWidth(lw).strokeColor(color).stroke();

    // ── Header ────────────────────────────────────────────────────────────────
    let y = M;
    const logoSz = 44;
    let schoolTextX = M;

    if (logoBuffer) {
      try { doc.image(logoBuffer, M, y, { fit: [logoSz, logoSz] }); schoolTextX = M + logoSz + 10; }
      catch { /* skip logo */ }
    }

    const leftColW = W * 0.60;
    const rightX   = M + W * 0.63;
    const rightW   = W * 0.37;

    // School name & address (left)
    doc.font("Bold").fontSize(15).fillColor(C_DARK)
       .text(data.school.name, schoolTextX, y, { width: leftColW - (schoolTextX - M) });
    y = doc.y + 2;

    const addrParts = [
      data.school.addressLine1,
      data.school.addressLine2,
      [data.school.city, data.school.state, data.school.pinCode].filter(Boolean).join(", "),
    ].filter(Boolean) as string[];
    if (addrParts.length)
      doc.font("Regular").fontSize(8).fillColor(C_MUTED)
         .text(addrParts.join(", "), schoolTextX, y, { width: leftColW - (schoolTextX - M) });

    const contactParts = [
      data.school.phone ? `Ph: ${data.school.phone}` : null,
      data.school.email ? `Email: ${data.school.email}` : null,
    ].filter(Boolean) as string[];
    if (contactParts.length) {
      y = doc.y + 1;
      doc.font("Regular").fontSize(8).fillColor(C_MUTED)
         .text(contactParts.join("  |  "), schoolTextX, y, { width: leftColW - (schoolTextX - M) });
    }

    const regParts = [
      data.school.affiliationNumber ? `Aff. No. ${data.school.affiliationNumber}` : null,
      data.school.gstin ? `GSTIN ${data.school.gstin}` : null,
    ].filter(Boolean) as string[];
    if (regParts.length) {
      y = doc.y + 1;
      doc.font("Regular").fontSize(8).fillColor(C_MUTED)
         .text(regParts.join("  |  "), schoolTextX, y, { width: leftColW - (schoolTextX - M) });
    }
    const leftBottom = doc.y;

    // "INVOICE" + number + status (right, top-aligned)
    doc.font("Bold").fontSize(26).fillColor(C_DARK)
       .text("INVOICE", rightX, M, { width: rightW, align: "right" });

    doc.font("Regular").fontSize(8).fillColor(C_MUTED)
       .text("Invoice No.", rightX, M + 33, { width: rightW, align: "right" });
    doc.font("Bold").fontSize(13).fillColor(C_DARK)
       .text(data.invoiceNumber ?? "\u2014", rightX, M + 43, { width: rightW, align: "right" });

    // Status badge
    const statusText  = `STATUS: ${(data.status ?? "").toUpperCase()}`;
    const isOverdue   = data.status === "Overdue";
    const badgeBg     = isOverdue ? "#fff0f0" : "#fff7e8";
    const badgeFg     = isOverdue ? "#9b1c1c" : "#8b5a08";
    const badgeBorder = isOverdue ? "#e29a9a" : "#d6a33c";
    doc.font("Bold").fontSize(7.5);
    const bStrW = doc.widthOfString(statusText) + 14;
    const badgeX = M + W - bStrW;
    const badgeY = M + 62;
    doc.rect(badgeX, badgeY, bStrW, 14).fillColor(badgeBg).fill();
    doc.rect(badgeX, badgeY, bStrW, 14).lineWidth(0.5).strokeColor(badgeBorder).stroke();
    doc.fillColor(badgeFg).text(statusText, badgeX + 7, badgeY + 3, { width: bStrW - 10 });

    y = Math.max(leftBottom, badgeY + 17) + 8;
    hline(y, C_DARK, 1.5);
    y += 14;

    // ── Two-column grid ───────────────────────────────────────────────────────
    const colW    = (W - 12) / 2;
    const col2X   = M + colW + 12;
    const gridTop = y;

    // Left: Student details
    doc.font("Bold").fontSize(7).fillColor(C_DARK)
       .text("BILLED TO / STUDENT DETAILS", M, y);
    y += 11;
    doc.font("Bold").fontSize(12).fillColor(C_DARK)
       .text(data.student.name, M, y, { width: colW });
    y = doc.y + 2;
    doc.font("Regular").fontSize(8).fillColor(C_MUTED)
       .text(`Student ID / MIS ID: ${data.student.digitalStudentId}`, M, y, { width: colW });
    y += 12;

    const studentRows: [string, string][] = [
      ["Parent / Guardian", data.student.guardianName?.trim() || "Not available"],
      ["Student Phone",     data.student.phone?.trim()        || "Not available"],
      ["Class",             data.student.className],
      ["Section",           data.student.section],
    ];
    const lbW = colW * 0.50;
    const vbX = M + lbW;
    const vbW = colW - lbW;
    for (const [label, value] of studentRows) {
      doc.font("Bold").fontSize(7.5).fillColor(C_MUTED)
         .text(label, M, y, { width: lbW });
      doc.font("Regular").fontSize(8).fillColor(C_BODY)
         .text(value, vbX, y, { width: vbW, align: "right" });
      y += 13;
    }
    const leftEnd = y;

    // Right: Invoice metadata
    let ry = gridTop;
    doc.font("Bold").fontSize(7).fillColor(C_DARK)
       .text("INVOICE METADATA", col2X, ry);
    ry += 11;

    const period = feePeriodLabel(data);
    const metaRows: [string, string][] = [
      ["Invoice Date & Time", formatDate(typeof data.createdAt === "string"
        ? data.createdAt : (data.createdAt as Date | null)?.toISOString() ?? null)],
      ["Academic Session",    data.academicYear ?? "\u2014"],
      ["Frequency",           frequencyLabel(data.frequency)],
      ["Fee Period",          period],
      ["Due Date",            formatDate(data.dueDate)],
    ];
    const mlW = colW * 0.52;
    const mvX = col2X + mlW;
    const mvW = colW - mlW;
    for (const [label, value] of metaRows) {
      doc.font("Bold").fontSize(7.5).fillColor(C_MUTED)
         .text(label, col2X, ry, { width: mlW });
      doc.font("Regular").fontSize(8).fillColor(C_BODY)
         .text(value, mvX, ry, { width: mvW, align: "right" });
      ry += 13;
    }

    // Vertical divider
    doc.moveTo(M + colW + 6, gridTop - 2).lineTo(M + colW + 6, Math.max(leftEnd, ry) - 2)
       .lineWidth(0.5).strokeColor(C_RULE).stroke();

    y = Math.max(leftEnd, ry) + 8;
    hline(y - 2);
    y += 12;

    // ── Invoice Details table ─────────────────────────────────────────────────
    y = safeY(80, y);
    doc.font("Bold").fontSize(7).fillColor(C_DARK).text("INVOICE DETAILS", M, y);
    y += 9;

    type Col = { label: string; x: number; w: number; align?: "left" | "right" };
    const tCols: Col[] = [
      { label: "Description", x: M,              w: W * 0.30 },
      { label: "Fee Type",    x: M + W * 0.30,   w: W * 0.18 },
      { label: "Frequency",   x: M + W * 0.48,   w: W * 0.17 },
      { label: "Fee Period",  x: M + W * 0.65,   w: W * 0.18 },
      { label: "Amount",      x: M + W * 0.83,   w: W * 0.17, align: "right" },
    ];

    doc.rect(M, y, W, 18).fillColor(C_THEAD).fill();
    for (const col of tCols)
      doc.font("Bold").fontSize(7).fillColor(C_WHITE)
         .text(col.label, col.x + 4, y + 5, { width: col.w - 8, align: col.align ?? "left" });
    y += 18;

    doc.rect(M, y, W, 20).fillColor("#f0f4f8").fill();
    for (const col of tCols) {
      const val = col.label === "Description" ? data.feeName
        : col.label === "Fee Type"   ? data.feeType
        : col.label === "Frequency"  ? frequencyLabel(data.frequency)
        : col.label === "Fee Period" ? period
        :                              fmtINR(data.amount);
      doc.font("Regular").fontSize(8.5).fillColor(C_BODY)
         .text(val, col.x + 4, y + 5, { width: col.w - 8, align: col.align ?? "left" });
    }
    y += 20;
    hline(y);
    y += 14;

    // ── Fee Breakdown ─────────────────────────────────────────────────────────
    if (data.breakdown.length > 0) {
      y = safeY(80, y);
      doc.font("Bold").fontSize(7).fillColor(C_DARK).text("FEE BREAKDOWN", M, y);
      y += 9;

      const bCols: Col[] = [
        { label: "Component",   x: M,            w: W * 0.32 },
        { label: "Description", x: M + W * 0.32, w: W * 0.48 },
        { label: "Amount",      x: M + W * 0.80, w: W * 0.20, align: "right" },
      ];

      doc.rect(M, y, W, 16).fillColor(C_THEAD).fill();
      for (const col of bCols)
        doc.font("Bold").fontSize(7).fillColor(C_WHITE)
           .text(col.label, col.x + 4, y + 4, { width: col.w - 8, align: col.align ?? "left" });
      y += 16;

      let subtotal = 0;
      data.breakdown.forEach((comp, i) => {
        y = safeY(20, y);
        doc.rect(M, y, W, 16).fillColor(i % 2 === 0 ? "#f6f8fa" : C_WHITE).fill();
        doc.font("Bold").fontSize(8).fillColor(C_BODY)
           .text(comp.name, bCols[0].x + 4, y + 4, { width: bCols[0].w - 8 });
        doc.font("Regular").fontSize(8).fillColor(C_MUTED)
           .text(comp.purpose ?? "\u2014", bCols[1].x + 4, y + 4, { width: bCols[1].w - 8 });
        doc.font("Regular").fontSize(8).fillColor(C_BODY)
           .text(fmtINR(Number(comp.amount)), bCols[2].x + 4, y + 4, { width: bCols[2].w - 8, align: "right" });
        subtotal += Number(comp.amount || 0);
        y += 16;
      });

      // Subtotal footer row
      y = safeY(16, y);
      doc.rect(M, y, W, 16).fillColor(C_LIGHT).fill();
      doc.font("Bold").fontSize(8).fillColor(C_DARK)
         .text("Component subtotal", M + 4, y + 4, { width: W * 0.80 - 8 });
      doc.font("Bold").fontSize(8).fillColor(C_DARK)
         .text(fmtINR(subtotal), M + W * 0.80 + 4, y + 4, { width: W * 0.20 - 8, align: "right" });
      y += 16;
      hline(y);
      y += 14;
    }

    // ── Late Fee Policy ───────────────────────────────────────────────────────
    y = safeY(40, y);
    const lfEnabled = data.lateFeeConfig?.enabled;
    doc.rect(M, y, 3, 28).fillColor(lfEnabled ? "#3b6388" : C_RULE).fill();
    doc.font("Bold").fontSize(8).fillColor(C_DARK)
       .text(`Late Fee & Penalty  \u2014  ${lfEnabled ? "ENABLED" : "DISABLED"}`, M + 8, y + 4, { width: W - 16 });
    if (lfEnabled && data.lateFeeConfig) {
      const lf = data.lateFeeConfig;
      const parts = [
        `Type: ${lf.type ?? "\u2014"}`,
        lf.type === "FLAT"  ? `Penalty: ${fmtINR(Number(lf.flat_amount  ?? 0))}` : null,
        lf.type === "DAILY" ? `Daily: ${fmtINR(Number(lf.daily_rate ?? 0))}/day`  : null,
        lf.grace_period_days != null ? `Grace: ${lf.grace_period_days} day(s)` : null,
      ].filter(Boolean).join("   ");
      doc.font("Regular").fontSize(8).fillColor(C_MUTED)
         .text(parts, M + 8, y + 16, { width: W - 16 });
    }
    y += 34;

    // ── Amount Summary (right-aligned box) ────────────────────────────────────
    y = safeY(100, y);
    const totalPayable = data.amount + Math.max(0, data.lateFeeAmount);
    const sumX = M + W * 0.32;
    const sumW = W * 0.68;
    y += 6;

    doc.font("Bold").fontSize(7).fillColor(C_DARK).text("AMOUNT SUMMARY", sumX, y);
    y += 9;

    const drawSumRow = (label: string, value: string, bg: string, fgL: string, fgV: string, ht = 19) => {
      doc.rect(sumX, y, sumW, ht).fillColor(bg).fill();
      doc.font("Regular").fontSize(8.5).fillColor(fgL)
         .text(label, sumX + 8, y + Math.floor((ht - 10) / 2), { width: sumW * 0.52 });
      doc.font("Bold").fontSize(9).fillColor(fgV)
         .text(value, sumX + sumW * 0.52 + 4, y + Math.floor((ht - 10) / 2), { width: sumW * 0.48 - 12, align: "right" });
      y += ht;
    };

    const sumBg = "#eef4f8";
    drawSumRow("Invoice amount", fmtINR(data.amount), sumBg, C_MUTED, C_BODY);
    if (data.lateFeeAmount > 0)
      drawSumRow("Late fee assessed", fmtINR(data.lateFeeAmount), sumBg, C_MUTED, "#b45309");

    // Words row
    const wordsText = amountInWords(totalPayable);
    doc.rect(sumX, y, sumW, 28).fillColor("#f0f5f9").fill();
    doc.font("Bold").fontSize(7).fillColor(C_MUTED)
       .text("AMOUNT IN WORDS", sumX + 8, y + 4, { width: sumW - 16 });
    doc.font("Bold").fontSize(7.5).fillColor(C_BODY)
       .text(wordsText, sumX + 8, y + 14, { width: sumW - 16 });
    y += 28;

    // Total row
    doc.rect(sumX, y, sumW, 24).fillColor(C_DARK).fill();
    doc.font("Regular").fontSize(9).fillColor(C_WHITE)
       .text("TOTAL PAYABLE", sumX + 8, y + 7, { width: sumW * 0.48 });
    doc.font("Bold").fontSize(13).fillColor(C_WHITE)
       .text(fmtINR(totalPayable), sumX + sumW * 0.48, y + 4, { width: sumW * 0.52 - 8, align: "right" });
    y += 24;

    // ── Notes ─────────────────────────────────────────────────────────────────
    if (data.notes) {
      y = safeY(40, y);
      y += 10;
      hline(y - 2);
      y += 6;
      doc.font("Bold").fontSize(8).fillColor(C_DARK).text("NOTES", M, y);
      y += 11;
      doc.font("Regular").fontSize(8.5).fillColor(C_BODY).text(data.notes, M, y, { width: W });
      y = doc.y + 8;
    }

    // ── Signature block (right-aligned) ───────────────────────────────────────
    y = safeY(90, y);
    y += 14;
    hline(y - 2);

    const sigBoxW = 150;
    const sigBoxX = M + W - sigBoxW;

    if (sigBuffer) {
      try { doc.image(sigBuffer, sigBoxX, y, { fit: [sigBoxW, 42], align: "center" }); }
      catch { /* skip */ }
    }
    y += 46;

    doc.moveTo(sigBoxX, y).lineTo(sigBoxX + sigBoxW, y).lineWidth(1).strokeColor("#475569").stroke();
    y += 5;
    doc.font("Bold").fontSize(7.5).fillColor("#334155")
       .text("Authorized Signatory", sigBoxX, y, { width: sigBoxW, align: "center" });
    y += 11;
    if (data.school.signatoryName) {
      doc.font("Regular").fontSize(7.5).fillColor("#334155")
         .text(data.school.signatoryName, sigBoxX, y, { width: sigBoxW, align: "center" });
      y += 11;
    }
    doc.font("Regular").fontSize(7).fillColor(C_MUTED)
       .text(data.school.name, sigBoxX, y, { width: sigBoxW, align: "center" });
    y += 14;

    // ── Footer ────────────────────────────────────────────────────────────────
    y = safeY(30, y);
    y += 6;
    hline(y - 2);
    doc.font("Regular").fontSize(7).fillColor(C_MUTED).text(
      "This document is an invoice and confirms the amount due. A payment receipt is issued separately after successful payment.\n" +
      "Computer-generated document. No physical signature is required where a digital signature is configured.",
      M, y + 4, { width: W, align: "center" },
    );

    doc.end();
  });
}
