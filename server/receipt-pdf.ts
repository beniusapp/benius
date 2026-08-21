/**
 * receipt-pdf.ts
 * Generates a professional A4 payment receipt PDF using PDFKit (pure Node.js).
 * Accepts the same ReceiptData used by the HTML receipt renderer.
 * Supports all payment methods: Online, Cash, Demand Draft, Cheque, UPI/QR,
 * Bank Transfer / NEFT / RTGS / IMPS / Wire Transfer.
 * No headless browser required.
 */

import PDFDocument from "pdfkit";
import https from "https";
import http from "http";
import type { ReceiptData } from "./receipt-renderer";

const FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// ── Palette (matches receipt-renderer.ts HTML renderer) ──────────────────────
const C_DARK   = "#0a1929";
const C_ACCENT = "#1565c0";
const C_BODY   = "#1a2332";
const C_MUTED  = "#6b7280";
const C_RULE   = "#d1d9e0";
const C_WHITE  = "#ffffff";
const C_THEAD  = "#102b49";
const C_LIGHT  = "#f4f7fa";
const C_GREEN  = "#166534";
const C_GREEN_BG = "#dcfce7";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function amountInWords(amount: number): string {
  const n = Math.round(Math.max(0, Number(amount) || 0));
  if (n === 0) return "Rupees Zero Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tenList = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const bH = (x: number): string => x < 20 ? ones[x] : `${tenList[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ""}`;
  const bT = (x: number): string => x < 100 ? bH(x) : `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${bH(x % 100)}` : ""}`;
  const conv = (x: number): string => {
    if (x === 0) return "";
    if (x < 1000) return bT(x);
    if (x < 100_000) return `${bT(Math.floor(x / 1000))} Thousand${x % 1000 ? ` ${bT(x % 1000)}` : ""}`;
    if (x < 10_000_000) return `${bT(Math.floor(x / 100_000))} Lakh${x % 100_000 ? ` ${conv(x % 100_000)}` : ""}`;
    return `${bT(Math.floor(x / 10_000_000))} Crore${x % 10_000_000 ? ` ${conv(x % 10_000_000)}` : ""}`;
  };
  return `Rupees ${conv(n)} Only`;
}

function paymentMethodLabel(method: string): string {
  return ({
    Online: "Online Payment", Cash: "Cash", BankTransfer: "Bank Transfer",
    Cheque: "Cheque", DemandDraft: "Demand Draft", UpiQr: "UPI / QR",
    Neft: "NEFT", Rtgs: "RTGS", Imps: "IMPS", WireTransfer: "Wire Transfer",
  } as Record<string, string>)[method] ?? method;
}

function paymentModeLabel(mode: string | null): string {
  if (!mode) return "";
  return ({ upi: "UPI", card: "Card", netbanking: "Netbanking", wallet: "Wallet", emi: "EMI", cardless_emi: "Cardless EMI" } as Record<string, string>)[mode.toLowerCase()] ?? mode;
}

function roleLabel(role: string | null): string {
  if (!role) return "";
  return ({ admin: "Administrator", teacher: "Teacher", support_staff: "Support Staff", principal: "Principal" } as Record<string, string>)[role] ?? role;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function renderReceiptPdf(data: ReceiptData): Promise<Buffer> {
  const [logoBuffer, sigBuffer] = await Promise.all([
    safeImage(data.school.logoUrl),
    safeImage(data.signature.imageUrl),
  ]);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4", margin: 40,
      info: { Title: `Receipt ${data.payment.receiptNumber ?? ""}`, Author: data.school.name },
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
    const W  = PW - M * 2;

    const safeY = (needed: number, cur: number): number => {
      if (cur + needed > PH - M - 10) { doc.addPage(); return M; }
      return cur;
    };
    const hline = (y: number, color = C_RULE, lw = 0.5) =>
      doc.moveTo(M, y).lineTo(M + W, y).lineWidth(lw).strokeColor(color).stroke();

    // ── Header band ───────────────────────────────────────────────────────────
    // Dark background header
    const hdrH = 64;
    doc.rect(0, 0, PW, hdrH).fillColor(C_DARK).fill();
    doc.rect(0, hdrH, PW, 3).fillColor(C_ACCENT).fill();

    let y = 0;
    const logoSz = 44;
    let schoolTX = M;

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, M, 10, { fit: [logoSz, logoSz] });
        schoolTX = M + logoSz + 10;
      } catch { /* skip */ }
    }

    doc.font("Bold").fontSize(15).fillColor(C_WHITE)
       .text(data.school.name, schoolTX, 14, { width: W * 0.62 - (schoolTX - M) });

    const addrParts = [
      data.school.addressLine1,
      data.school.addressLine2,
      [data.school.city, data.school.state, data.school.pinCode].filter(Boolean).join(", "),
    ].filter(Boolean) as string[];
    if (addrParts.length)
      doc.font("Regular").fontSize(7.5).fillColor("#8eb4d4")
         .text(addrParts.join(", "), schoolTX, 32, { width: W * 0.62 - (schoolTX - M) });

    // "PAYMENT RECEIPT" right side
    const isOnline = data.payment.paymentMethod === "Online";
    const rcptLabel = isOnline ? "ONLINE RECEIPT" : "OFFLINE RECEIPT";
    doc.font("Bold").fontSize(9).fillColor("#8eb4d4")
       .text(rcptLabel, M + W * 0.62, 14, { width: W * 0.38, align: "right" });
    doc.font("Bold").fontSize(18).fillColor(C_WHITE)
       .text("PAYMENT RECEIPT", M + W * 0.62, 26, { width: W * 0.38, align: "right" });

    y = hdrH + 3 + 12; // after accent bar

    // ── ID Strip ──────────────────────────────────────────────────────────────
    // 5 equal cells: Invoice No | Receipt No | Payment Date & Time | Payment Mode | Status
    const stripH = 38;
    doc.rect(M, y, W, stripH).fillColor(C_LIGHT).fill();
    doc.rect(M, y, W, stripH).lineWidth(0.5).strokeColor(C_RULE).stroke();

    const stripCols = [
      { label: "Invoice No.",         value: data.fee.invoiceNumber ?? "\u2014" },
      { label: "Receipt No.",         value: data.payment.receiptNumber ?? "\u2014" },
      { label: "Payment Date & Time", value: data.payment.paymentDateTimeIST },
      { label: "Payment Mode",        value: paymentMethodLabel(data.payment.paymentMethod) },
      { label: "Status",              value: isOnline ? "CAPTURED" : "RECORDED" },
    ];
    const cellW = W / stripCols.length;

    stripCols.forEach((cell, i) => {
      const cx = M + i * cellW;
      if (i > 0)
        doc.moveTo(cx, y + 6).lineTo(cx, y + stripH - 6).lineWidth(0.5).strokeColor(C_RULE).stroke();
      doc.font("Regular").fontSize(6.5).fillColor(C_MUTED)
         .text(cell.label, cx + 6, y + 7, { width: cellW - 12, align: "center" });
      const isStatus = cell.label === "Status";
      doc.font("Bold").fontSize(isStatus ? 7.5 : 8).fillColor(isStatus ? "#166534" : C_BODY)
         .text(cell.value, cx + 6, y + 18, { width: cellW - 12, align: "center" });
    });
    y += stripH + 12;

    // ── Two-column: Student | Fee Info ────────────────────────────────────────
    const colW  = (W - 12) / 2;
    const col2X = M + colW + 12;
    const gridY = y;

    // Student
    doc.font("Bold").fontSize(7).fillColor(C_ACCENT).text("STUDENT DETAILS", M, y);
    y += 10;
    doc.font("Bold").fontSize(12).fillColor(C_BODY).text(data.student.name, M, y, { width: colW });
    y = doc.y + 2;
    doc.font("Regular").fontSize(8).fillColor(C_MUTED).text(`MIS ID: ${data.student.digitalStudentId}`, M, y, { width: colW });
    y += 11;
    const stuRows: [string, string][] = [
      ["Class / Section", `${data.student.class} \u2013 ${data.student.section}`],
      ["Parent / Guardian", data.student.guardianName ?? "\u2014"],
      ["Phone", data.student.phone ?? "\u2014"],
    ];
    if (data.student.rollNumber != null)
      stuRows.splice(1, 0, ["Roll Number", String(data.student.rollNumber)]);
    const lblW = colW * 0.50;
    const valX = M + lblW;
    const valW = colW - lblW;
    for (const [l, v] of stuRows) {
      doc.font("Bold").fontSize(7.5).fillColor(C_MUTED).text(l, M, y, { width: lblW });
      doc.font("Regular").fontSize(8).fillColor(C_BODY).text(v, valX, y, { width: valW, align: "right" });
      y += 13;
    }
    const leftEnd = y;

    // Fee Info (right column)
    let ry = gridY;
    doc.font("Bold").fontSize(7).fillColor(C_ACCENT).text("FEE INFORMATION", col2X, ry);
    ry += 10;
    const feeName = data.fee.feeName && data.fee.feeName !== data.fee.feeType
      ? data.fee.feeName : data.fee.feeType;
    doc.font("Bold").fontSize(10).fillColor(C_BODY).text(feeName, col2X, ry, { width: colW });
    ry = doc.y + 2;

    const feeRows: [string, string][] = [
      ["Fee Type",         data.fee.feeType],
      ["Invoice Amount",   fmtINR(data.fee.amount)],
      ["Academic Session", data.academicSessionLabel ?? data.fee.academicYear ?? "\u2014"],
      ["Due Date",         data.fee.dueDate ?? "\u2014"],
    ];
    if (data.fee.lateFeeAmount > 0)
      feeRows.push(["Late Fee",  fmtINR(data.fee.lateFeeAmount)]);
    if (data.fee.feePeriodStart && data.fee.feePeriodEnd)
      feeRows.push(["Fee Period", `${data.fee.feePeriodStart} \u2013 ${data.fee.feePeriodEnd}`]);

    const flW = colW * 0.50;
    const fvX = col2X + flW;
    const fvW = colW - flW;
    for (const [l, v] of feeRows) {
      doc.font("Bold").fontSize(7.5).fillColor(C_MUTED).text(l, col2X, ry, { width: flW });
      doc.font("Regular").fontSize(8).fillColor(C_BODY).text(v, fvX, ry, { width: fvW, align: "right" });
      ry += 13;
    }

    // Vertical divider
    doc.moveTo(M + colW + 6, gridY - 2).lineTo(M + colW + 6, Math.max(leftEnd, ry) - 2)
       .lineWidth(0.5).strokeColor(C_RULE).stroke();

    y = Math.max(leftEnd, ry) + 10;
    hline(y - 2);

    // ── Amount Summary dark card ───────────────────────────────────────────────
    y = safeY(80, y + 8);
    const cardH = 72;
    doc.rect(M, y, W, cardH).fillColor(C_DARK).fill();

    // Large amount
    doc.font("Bold").fontSize(28).fillColor(C_WHITE)
       .text(fmtINR(data.payment.amount), M + 16, y + 10, { width: W * 0.55 });
    // Words (italic style — just smaller regular)
    doc.font("Regular").fontSize(8).fillColor("#8eb4d4")
       .text(amountInWords(data.payment.amount), M + 16, y + 44, { width: W * 0.55 });

    // Meta mini-grid (right side of card)
    const metaX = M + W * 0.58;
    const metaW = W * 0.42 - 8;
    const cardMeta: [string, string][] = [
      ["Invoice No.", data.fee.invoiceNumber ?? "\u2014"],
      ["Receipt No.", data.payment.receiptNumber ?? "\u2014"],
      ["Payment Mode", paymentMethodLabel(data.payment.paymentMethod)],
      ["Session", data.academicSessionLabel ?? data.fee.academicYear ?? "\u2014"],
    ];
    if (data.payment.lateFeePaid > 0)
      cardMeta.push(["Late Fee Paid", fmtINR(data.payment.lateFeePaid)]);

    let cmy = y + 8;
    for (const [l, v] of cardMeta) {
      if (cmy > y + cardH - 12) break;
      doc.font("Regular").fontSize(7).fillColor("#8eb4d4").text(l, metaX, cmy, { width: metaW * 0.45 });
      doc.font("Bold").fontSize(7.5).fillColor(C_WHITE).text(v, metaX + metaW * 0.45, cmy, { width: metaW * 0.55, align: "right" });
      cmy += 13;
    }

    y += cardH + 12;

    // ── Fee Breakdown ─────────────────────────────────────────────────────────
    if (data.fee.breakdown && data.fee.breakdown.length > 0) {
      y = safeY(60, y);
      doc.font("Bold").fontSize(7).fillColor(C_ACCENT).text("FEE BREAKDOWN", M, y);
      y += 9;

      type Col = { label: string; x: number; w: number; align?: "left" | "right" };
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

      data.fee.breakdown.forEach((comp, i) => {
        y = safeY(16, y);
        doc.rect(M, y, W, 16).fillColor(i % 2 === 0 ? "#f6f8fa" : C_WHITE).fill();
        doc.font("Bold").fontSize(8).fillColor(C_BODY).text(comp.name, bCols[0].x + 4, y + 4, { width: bCols[0].w - 8 });
        doc.font("Regular").fontSize(8).fillColor(C_MUTED).text(comp.purpose ?? "\u2014", bCols[1].x + 4, y + 4, { width: bCols[1].w - 8 });
        doc.font("Regular").fontSize(8).fillColor(C_BODY).text(fmtINR(Number(comp.amount)), bCols[2].x + 4, y + 4, { width: bCols[2].w - 8, align: "right" });
        y += 16;
      });
      hline(y);
      y += 12;
    }

    // ── Payment Method-Specific Section ───────────────────────────────────────
    y = safeY(40, y);
    const isCash        = data.payment.paymentMethod === "Cash";
    const isDemandDraft = data.payment.paymentMethod === "DemandDraft";
    const isCheque      = data.payment.paymentMethod === "Cheque";
    const isUpi         = data.payment.paymentMethod === "UpiQr";
    const isBankLike    = ["BankTransfer", "Neft", "Rtgs", "Imps", "WireTransfer"].includes(data.payment.paymentMethod);

    const sectionTitle = (title: string) => {
      doc.font("Bold").fontSize(7).fillColor(C_ACCENT).text(title, M, y);
      y += 9;
    };

    const fieldRow = (label: string, value: string | null | undefined, mono = false) => {
      if (!value) return;
      y = safeY(16, y);
      doc.font("Bold").fontSize(7.5).fillColor(C_MUTED)
         .text(label, M, y, { width: W * 0.42 });
      doc.font(mono ? "Regular" : "Regular").fontSize(8).fillColor(C_BODY)
         .text(value, M + W * 0.42, y, { width: W * 0.58, align: "right" });
      y += 14;
    };

    // ── Online Payment ─────────────────────────────────────────────────────────
    if (isOnline) {
      sectionTitle("ONLINE PAYMENT DETAILS");
      doc.rect(M, y - 1, W, 0.5).fillColor(C_RULE).fill();
      y += 4;

      const mode = paymentModeLabel(data.payment.paymentMode);
      fieldRow("Razorpay Payment ID",  data.payment.razorpayPaymentId, true);
      fieldRow("Razorpay Order ID",    data.payment.razorpayOrderId, true);
      if (mode) fieldRow("Payment Mode", mode);
      if (data.payment.bankName) fieldRow("Bank", data.payment.bankName);
      if (data.payment.cardLast4) {
        const cardStr = data.payment.cardNetwork
          ? `${data.payment.cardNetwork} \u2014 **** **** **** ${data.payment.cardLast4}`
          : `**** **** **** ${data.payment.cardLast4}`;
        fieldRow("Card", cardStr);
      }
      if (data.payment.vpa) fieldRow("UPI / VPA", data.payment.vpa);
      if (data.payment.payerName) fieldRow("Payer Name", data.payment.payerName);
      if (data.payment.gatewayStatus) fieldRow("Gateway Status", data.payment.gatewayStatus.toUpperCase());
      if (data.payment.providerCreatedIST)  fieldRow("Order Created (IST)",  data.payment.providerCreatedIST);
      if (data.payment.providerCapturedIST) fieldRow("Amount Captured (IST)", data.payment.providerCapturedIST);

      // Transaction verification box
      if (data.payment.razorpayPaymentId) {
        y = safeY(34, y + 4);
        doc.rect(M, y, W, 30).fillColor(C_GREEN_BG).fill();
        doc.rect(M, y, W, 30).lineWidth(0.5).strokeColor("#86efac").stroke();
        doc.font("Bold").fontSize(8).fillColor(C_GREEN)
           .text("\u2713  Transaction Verified", M + 10, y + 8, { width: W * 0.5 });
        doc.font("Regular").fontSize(7.5).fillColor(C_GREEN)
           .text("Payment captured and confirmed by Razorpay.", M + 10, y + 18, { width: W - 20 });
        y += 34;
      }

      // Processed By (only when a real staff member is attributed)
      if (data.payment.recordedByName) {
        y += 4;
        const displayName = data.payment.recordedByName;
        const roleStr = roleLabel(data.payment.recordedByRole);
        fieldRow("Processed By", roleStr ? `${displayName} \u2014 ${roleStr}` : displayName);
      }
    }

    // ── Demand Draft ───────────────────────────────────────────────────────────
    if (isDemandDraft) {
      sectionTitle("DEMAND DRAFT DETAILS");
      doc.rect(M, y - 1, W, 0.5).fillColor(C_RULE).fill();
      y += 4;
      fieldRow("DD Number",    data.payment.referenceNumber);
      fieldRow("DD Date",      data.payment.instrumentDate ?? data.payment.offlineDetail?.transactionTime ?? null);
      fieldRow("Bank Name",    data.payment.bankName ?? data.payment.offlineDetail?.receivingBank ?? null);
      fieldRow("Branch",       data.payment.branchName);
      fieldRow("Payable At",   data.payment.offlineDetail?.payableAt ?? null);
      fieldRow("Amount",       fmtINR(data.payment.amount));
      const pb = data.payment.recordedByName ?? "School Finance Office";
      const rl = data.payment.recordedByName ? roleLabel(data.payment.recordedByRole) : "";
      fieldRow("Processed By", rl ? `${pb} \u2014 ${rl}` : pb);
    }

    // ── Cheque ────────────────────────────────────────────────────────────────
    if (isCheque) {
      sectionTitle("CHEQUE DETAILS");
      doc.rect(M, y - 1, W, 0.5).fillColor(C_RULE).fill();
      y += 4;
      fieldRow("Cheque Number", data.payment.referenceNumber);
      fieldRow("Cheque Date",   data.payment.instrumentDate ?? null);
      fieldRow("Bank Name",     data.payment.bankName ?? data.payment.offlineDetail?.receivingBank ?? null);
      fieldRow("Branch",        data.payment.branchName);
      fieldRow("Amount",        fmtINR(data.payment.amount));
      const pb = data.payment.recordedByName ?? "School Finance Office";
      const rl = data.payment.recordedByName ? roleLabel(data.payment.recordedByRole) : "";
      fieldRow("Processed By", rl ? `${pb} \u2014 ${rl}` : pb);
    }

    // ── UPI / QR ──────────────────────────────────────────────────────────────
    if (isUpi) {
      sectionTitle("UPI / QR PAYMENT DETAILS");
      doc.rect(M, y - 1, W, 0.5).fillColor(C_RULE).fill();
      y += 4;
      fieldRow("UPI Transaction ID",  data.payment.referenceNumber ?? data.payment.offlineDetail?.transactionReference ?? null, true);
      fieldRow("Receiver UPI ID",     data.payment.offlineDetail?.receiverUpiId ?? null);
      fieldRow("Transaction Date",    data.payment.offlineDetail?.transactionTime ?? data.payment.receivedDate);
      fieldRow("Amount",              fmtINR(data.payment.amount));
      const pb = data.payment.recordedByName ?? "School Finance Office";
      const rl = data.payment.recordedByName ? roleLabel(data.payment.recordedByRole) : "";
      fieldRow("Processed By", rl ? `${pb} \u2014 ${rl}` : pb);
    }

    // ── Bank Transfer / NEFT / RTGS / IMPS / Wire ─────────────────────────────
    if (isBankLike) {
      sectionTitle("BANK TRANSFER DETAILS");
      doc.rect(M, y - 1, W, 0.5).fillColor(C_RULE).fill();
      y += 4;
      fieldRow("UTR / Reference",  data.payment.referenceNumber ?? data.payment.offlineDetail?.transactionReference ?? null, true);
      fieldRow("Transfer Mode",    paymentMethodLabel(data.payment.paymentMethod));
      fieldRow("Bank",             data.payment.bankName ?? data.payment.offlineDetail?.receivingBank ?? null);
      fieldRow("Branch",           data.payment.branchName);
      fieldRow("Transaction Date", data.payment.offlineDetail?.transactionTime ?? data.payment.receivedDate);
      fieldRow("Amount",           fmtINR(data.payment.amount));
      const pb = data.payment.recordedByName ?? "School Finance Office";
      const rl = data.payment.recordedByName ? roleLabel(data.payment.recordedByRole) : "";
      fieldRow("Processed By", rl ? `${pb} \u2014 ${rl}` : pb);
    }

    // ── Cash Denomination Table ────────────────────────────────────────────────
    if (isCash) {
      sectionTitle("CASH PAYMENT DETAILS");
      doc.rect(M, y - 1, W, 0.5).fillColor(C_RULE).fill();
      y += 4;

      if (data.payment.denominationBreakdown) {
        const denomOrder = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
        const activeRows = denomOrder
          .filter(d => {
            const qty = Number(data.payment.denominationBreakdown![String(d)] ?? 0);
            return qty > 0;
          })
          .map(d => ({ denom: d, qty: Number(data.payment.denominationBreakdown![String(d)]) }));

        if (activeRows.length > 0) {
          y = safeY(activeRows.length * 16 + 60, y);
          // Table header
          const dCols = [
            { label: "Denomination", x: M,            w: W * 0.33 },
            { label: "Quantity",     x: M + W * 0.33, w: W * 0.33, align: "right" as const },
            { label: "Subtotal",     x: M + W * 0.66, w: W * 0.34, align: "right" as const },
          ];
          doc.rect(M, y, W, 16).fillColor(C_THEAD).fill();
          for (const col of dCols)
            doc.font("Bold").fontSize(7).fillColor(C_WHITE)
               .text(col.label, col.x + 4, y + 4, { width: col.w - 8, align: col.align ?? "left" });
          y += 16;

          let cashTotal = 0;
          activeRows.forEach((r, i) => {
            const sub = r.denom * r.qty;
            cashTotal += sub;
            y = safeY(16, y);
            doc.rect(M, y, W, 16).fillColor(i % 2 === 0 ? "#f6f8fa" : C_WHITE).fill();
            doc.font("Regular").fontSize(8).fillColor(C_BODY)
               .text(`\u20B9${r.denom}`, dCols[0].x + 4, y + 4, { width: dCols[0].w - 8 });
            doc.font("Regular").fontSize(8).fillColor(C_BODY)
               .text(String(r.qty), dCols[1].x + 4, y + 4, { width: dCols[1].w - 8, align: "right" });
            doc.font("Regular").fontSize(8).fillColor(C_BODY)
               .text(fmtINR(sub), dCols[2].x + 4, y + 4, { width: dCols[2].w - 8, align: "right" });
            y += 16;
          });

          // Total received row
          y = safeY(18, y);
          doc.rect(M, y, W, 18).fillColor(C_DARK).fill();
          doc.font("Bold").fontSize(8).fillColor(C_WHITE)
             .text("Total Received", M + 4, y + 4, { width: W * 0.66 - 8 });
          doc.font("Bold").fontSize(9).fillColor(C_WHITE)
             .text(fmtINR(cashTotal), M + W * 0.66 + 4, y + 4, { width: W * 0.34 - 8, align: "right" });
          y += 18;
          y += 4;
        }
      }

      const pb = data.payment.recordedByName ?? "School Finance Office";
      const rl = data.payment.recordedByName ? roleLabel(data.payment.recordedByRole) : "";
      fieldRow("Processed By", rl ? `${pb} \u2014 ${rl}` : pb);
    }

    // ── Cashier Notes / Payment Notes ─────────────────────────────────────────
    if (data.payment.cashierNotes || data.fee.notes) {
      y = safeY(40, y + 4);
      hline(y - 2);
      y += 6;
      doc.font("Bold").fontSize(7).fillColor(C_ACCENT).text("NOTES", M, y);
      y += 9;
      if (data.payment.cashierNotes) {
        doc.font("Regular").fontSize(8.5).fillColor(C_BODY).text(data.payment.cashierNotes, M, y, { width: W });
        y = doc.y + 5;
      }
      if (data.fee.notes) {
        doc.font("Regular").fontSize(8.5).fillColor(C_MUTED).text(data.fee.notes, M, y, { width: W });
        y = doc.y + 5;
      }
    }

    // ── Signature block (right-aligned) ───────────────────────────────────────
    y = safeY(90, y + 10);
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
    if (data.signature.signatoryName) {
      doc.font("Regular").fontSize(7.5).fillColor("#334155")
         .text(data.signature.signatoryName, sigBoxX, y, { width: sigBoxW, align: "center" });
      y += 11;
    }
    doc.font("Regular").fontSize(7).fillColor(C_MUTED)
       .text(data.school.name, sigBoxX, y, { width: sigBoxW, align: "center" });
    y += 14;

    // ── Footer ────────────────────────────────────────────────────────────────
    y = safeY(30, y + 6);
    hline(y - 2);
    doc.font("Regular").fontSize(7).fillColor(C_MUTED).text(
      `Generated: ${data.generatedAtIST}  \u2014  This is an official payment receipt issued by ${data.school.name}.\n` +
      "Computer-generated document. Please retain for your records.",
      M, y + 4, { width: W, align: "center" },
    );

    doc.end();
  });
}
