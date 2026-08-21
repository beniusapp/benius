/**
 * analytics-report.ts
 * Generates a Financial Analytics PDF and emails it as an attachment.
 * The PDF is built with PDFKit (pure JS, no browser required).
 */

import PDFDocument from "pdfkit";
import { db, pool } from "./db";
import { storage } from "./storage";
import { sql } from "drizzle-orm";
import { log } from "./index";
import { formatDateTimeIST, formatMonthYearIST } from "../shared/ist-time";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(n);
}

// ── Fetch analytics data (mirrors /api/fees/analytics) ──────────────────────
async function fetchAnalyticsData(schoolId: number, sessionId: number | null) {
  const sfFR = sessionId ? sql` AND fr.session_id = ${sessionId}` : sql``;
  const sfPR = sessionId
    ? sql` AND (pr.session_id = ${sessionId} OR (pr.session_id IS NULL AND fr2.session_id = ${sessionId}))`
    : sql``;

  // Session-aware payment subquery: when a sessionId is set, only include payments
  // that are linked to fee records belonging to that session.  Without this guard,
  // payments from other sessions would be subtracted from session-scoped billed
  // amounts, causing collected figures to be overstated and outstanding understated.
  const paidSub = (sid: number) => sessionId
    ? sql`
        SELECT pr.fee_record_id, SUM(pr.amount)::int AS paid
        FROM payment_records pr
        JOIN fee_records fr_inner ON fr_inner.id = pr.fee_record_id
        WHERE pr.school_id = ${sid}
          AND pr.fee_record_id IS NOT NULL
          AND fr_inner.session_id = ${sessionId}
        GROUP BY pr.fee_record_id`
    : sql`
        SELECT fee_record_id, SUM(amount)::int AS paid
        FROM payment_records
        WHERE school_id = ${sid} AND fee_record_id IS NOT NULL
        GROUP BY fee_record_id`;

  const [billedRow, payRow, outRow, tsRow, cwRow, chRow, catRow, agRow] = await Promise.all([
    db.execute(sql`
      SELECT COALESCE(SUM(fr.amount), 0)::int AS gross_billed
      FROM fee_records fr WHERE fr.school_id = ${schoolId}${sfFR}`),
    db.execute(sql`
      SELECT
        COALESCE(SUM(pr.amount), 0)::int        AS total_collected,
        COALESCE(SUM(pr.late_fee_paid), 0)::int AS total_late_fees
      FROM payment_records pr
      LEFT JOIN fee_records fr2 ON fr2.id = pr.fee_record_id
      WHERE pr.school_id = ${schoolId}${sfPR}`),
    db.execute(sql`
      SELECT COALESCE(SUM(GREATEST(fr.amount + fr.late_fee_amount - COALESCE(p.paid,0),0)),0)::int AS outstanding
      FROM fee_records fr
      LEFT JOIN (${paidSub(schoolId)}) p ON p.fee_record_id = fr.id
      WHERE fr.school_id = ${schoolId} AND fr.status IN ('Due','Overdue')${sfFR}`),
    db.execute(sql`
      WITH mc AS (
        SELECT DATE_TRUNC('month', pr.received_date::date) AS pd,
               COALESCE(SUM(pr.amount),0)::int AS collected
        FROM payment_records pr
        LEFT JOIN fee_records fr2 ON fr2.id = pr.fee_record_id
        WHERE pr.school_id = ${schoolId}
          AND pr.received_date IS NOT NULL
          AND pr.received_date::date >= CURRENT_DATE - INTERVAL '12 months'
          ${sfPR}
        GROUP BY pd
      ),
      mb AS (
        SELECT DATE_TRUNC('month', fr.due_date::date) AS pd,
               COALESCE(SUM(fr.amount),0)::int AS billed
        FROM fee_records fr
        WHERE fr.school_id = ${schoolId}
          AND fr.due_date IS NOT NULL
          AND fr.due_date::date >= CURRENT_DATE - INTERVAL '12 months'
          ${sfFR}
        GROUP BY pd
      )
      SELECT
        TO_CHAR(COALESCE(mc.pd, mb.pd), 'Mon ''YY') AS period,
        COALESCE(mc.collected, 0) AS collected,
        COALESCE(mb.billed, 0) AS billed
      FROM mc FULL OUTER JOIN mb ON mc.pd = mb.pd
      ORDER BY COALESCE(mc.pd, mb.pd) ASC`),
    db.execute(sql`
      SELECT s.class,
        COALESCE(SUM(fr.amount),0)::int AS billed,
        COALESCE(SUM(COALESCE(p.paid,0)),0)::int AS collected,
        COALESCE(SUM(GREATEST(fr.amount-COALESCE(p.paid,0),0)),0)::int AS outstanding
      FROM fee_records fr
      JOIN students s ON s.id = fr.student_id
      LEFT JOIN (${paidSub(schoolId)}) p ON p.fee_record_id = fr.id
      WHERE fr.school_id = ${schoolId}${sfFR}
      GROUP BY s.class
      ORDER BY CASE WHEN s.class ~ '^[0-9]+$' THEN s.class::int ELSE 999 END, s.class`),
    db.execute(sql`
      SELECT pr.payment_method, COUNT(*)::int AS count,
        COALESCE(SUM(pr.amount),0)::int AS amount
      FROM payment_records pr
      LEFT JOIN fee_records fr2 ON fr2.id = pr.fee_record_id
      WHERE pr.school_id = ${schoolId}${sfPR}
      GROUP BY pr.payment_method ORDER BY amount DESC`),
    db.execute(sql`
      SELECT fr.fee_type,
        COALESCE(SUM(fr.amount),0)::int AS billed,
        COALESCE(SUM(COALESCE(p.paid,0)),0)::int AS collected
      FROM fee_records fr
      LEFT JOIN (${paidSub(schoolId)}) p ON p.fee_record_id = fr.id
      WHERE fr.school_id = ${schoolId}${sfFR}
      GROUP BY fr.fee_type ORDER BY billed DESC LIMIT 10`),
    db.execute(sql`
      SELECT
        CASE
          WHEN CURRENT_DATE - fr.due_date::date BETWEEN 1  AND 30 THEN '1-30'
          WHEN CURRENT_DATE - fr.due_date::date BETWEEN 31 AND 60 THEN '31-60'
          WHEN CURRENT_DATE - fr.due_date::date BETWEEN 61 AND 90 THEN '61-90'
          WHEN CURRENT_DATE - fr.due_date::date > 90              THEN '90+'
        END AS bucket,
        COUNT(*)::int AS count,
        COALESCE(SUM(GREATEST(fr.amount+fr.late_fee_amount-COALESCE(p.paid,0),0)),0)::int AS amount
      FROM fee_records fr
      LEFT JOIN (${paidSub(schoolId)}) p ON p.fee_record_id = fr.id
      WHERE fr.school_id = ${schoolId}
        AND fr.status IN ('Due','Overdue')
        AND fr.due_date IS NOT NULL
        AND CURRENT_DATE > fr.due_date::date
        ${sfFR}
      GROUP BY bucket`),
  ]);

  const grossBilled  = Number(billedRow.rows[0]?.gross_billed ?? 0);
  const netCollected = Number(payRow.rows[0]?.total_collected ?? 0);
  const totalLate    = Number(payRow.rows[0]?.total_late_fees ?? 0);
  const outstanding  = Number(outRow.rows[0]?.outstanding ?? 0);
  const collRate     = grossBilled > 0 ? Math.round((netCollected / grossBilled) * 100) : 0;

  return {
    summary: { grossBilled, netCollected, outstanding, collectionRate: collRate, totalLatePenalties: totalLate },
    timeSeries:      tsRow.rows  as any[],
    classWise:       cwRow.rows  as any[],
    paymentChannels: chRow.rows  as any[],
    feeCategories:   catRow.rows as any[],
    aging:           agRow.rows  as any[],
  };
}

type AnalyticsData = Awaited<ReturnType<typeof fetchAnalyticsData>>;

// ── Build PDF buffer with PDFKit ─────────────────────────────────────────────
function buildReportPdf(
  data: AnalyticsData,
  schoolName: string,
  sessionLabel: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  ()        => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W   = doc.page.width - 100; // usable width (margins both sides)
    const s   = data.summary;
    const now = new Date();
    const generatedAt = formatDateTimeIST(now);
    const monthLabel = formatMonthYearIST(now);

    // ── Palette ───────────────────────────────────────────────────────────
    const DARK    = "#0d1f35";
    const ACCENT  = "#D4AF37";
    const CYAN    = "#06b6d4";
    const RED     = "#ef4444";
    const GREEN   = "#10b981";
    const MUTED   = "#64748b";
    const WHITE   = "#ffffff";
    const BORDER  = "#1e3a5f";

    // ── Header ────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 120).fill(DARK);
    doc.fillColor(MUTED).fontSize(9).font("Helvetica")
       .text("MONTHLY BOARD REPORT", 50, 30, { characterSpacing: 3 });
    doc.fillColor(WHITE).fontSize(22).font("Helvetica-Bold")
       .text(schoolName, 50, 48);
    doc.fillColor(MUTED).fontSize(9).font("Helvetica")
       .text(`Session: ${sessionLabel}   |   Generated: ${generatedAt}`, 50, 80);

    // Accent bar under header
    doc.rect(0, 120, doc.page.width, 3).fill(ACCENT);

    let y = 150;

    // ── Section title helper ──────────────────────────────────────────────
    const section = (title: string) => {
      doc.fillColor(MUTED).fontSize(8).font("Helvetica-Bold")
         .text(title.toUpperCase(), 50, y, { characterSpacing: 2 });
      y += 14;
      doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(BORDER).stroke();
      y += 10;
    };

    // ── KPI row helper ────────────────────────────────────────────────────
    const kpiRow = (items: Array<{ label: string; value: string; color: string }>) => {
      const colW = W / items.length;
      items.forEach((item, i) => {
        const x = 50 + i * colW;
        doc.rect(x, y, colW - 6, 52).fillColor("#0f2d4a").fill();
        doc.fillColor(item.color).fontSize(8).font("Helvetica")
           .text(item.label, x + 10, y + 8, { width: colW - 20 });
        doc.fillColor(WHITE).fontSize(15).font("Helvetica-Bold")
           .text(item.value, x + 10, y + 22, { width: colW - 20 });
      });
      y += 62;
    };

    // ── Table helpers ─────────────────────────────────────────────────────
    const tableHeader = (cols: string[], widths: number[]) => {
      doc.rect(50, y, W, 20).fillColor("#1a3a5f").fill();
      let x = 50;
      cols.forEach((col, i) => {
        doc.fillColor(MUTED).fontSize(8).font("Helvetica-Bold")
           .text(col, x + 6, y + 6, { width: widths[i] - 8, align: i > 0 ? "right" : "left" });
        x += widths[i];
      });
      y += 20;
    };

    const tableRow = (cells: string[], widths: number[], even: boolean, colors?: (string | null)[]) => {
      if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
      doc.rect(50, y, W, 18).fillColor(even ? "#0f2d4a" : "#0a1e30").fill();
      let x = 50;
      cells.forEach((cell, i) => {
        const clr = colors?.[i] ?? WHITE;
        doc.fillColor(clr ?? WHITE).fontSize(8).font("Helvetica")
           .text(cell, x + 6, y + 5, { width: widths[i] - 8, align: i > 0 ? "right" : "left" });
        x += widths[i];
      });
      y += 18;
    };

    // ── 1. Executive Summary ──────────────────────────────────────────────
    section("Executive Summary");
    kpiRow([
      { label: "Gross Billed", value: fmtINR(s.grossBilled),  color: MUTED  },
      { label: "Net Collected", value: fmtINR(s.netCollected), color: ACCENT },
    ]);
    kpiRow([
      { label: "Outstanding",      value: fmtINR(s.outstanding),            color: RED   },
      { label: "Collection Rate",  value: `${s.collectionRate}%`,            color: GREEN },
    ]);
    if (s.totalLatePenalties > 0) {
      kpiRow([
        { label: "Late Penalties Collected", value: fmtINR(s.totalLatePenalties), color: "#f97316" },
        { label: "Report Period", value: `${monthLabel}`, color: MUTED },
      ]);
    }
    y += 8;

    // ── 2. Monthly Trend (last 12 months) ────────────────────────────────
    if (data.timeSeries.length > 0) {
      section("Monthly Revenue Trend (Last 12 Months)");
      const colW = [80, (W - 80) / 2, (W - 80) / 2];
      tableHeader(["Period", "Billed", "Collected"], colW);
      data.timeSeries.forEach((r, i) => {
        tableRow(
          [String(r.period), fmtINR(Number(r.billed)), fmtINR(Number(r.collected))],
          colW, i % 2 === 0,
          [null, null, CYAN],
        );
      });
      y += 12;
    }

    // ── 3. Class-Wise Breakdown ───────────────────────────────────────────
    if (data.classWise.length > 0) {
      if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
      section("Class-Wise Breakdown");
      const cw = [60, (W - 60) / 4, (W - 60) / 4, (W - 60) / 4, (W - 60) / 4];
      tableHeader(["Class", "Billed", "Collected", "Outstanding", "Rate"], cw);
      data.classWise.forEach((r, i) => {
        const rate = Number(r.billed) > 0
          ? `${Math.round((Number(r.collected) / Number(r.billed)) * 100)}%` : "—";
        tableRow(
          [`Class ${r.class}`, fmtINR(Number(r.billed)), fmtINR(Number(r.collected)), fmtINR(Number(r.outstanding)), rate],
          cw, i % 2 === 0,
          [null, null, CYAN, RED, GREEN],
        );
      });
      y += 12;
    }

    // ── 4. Fee Categories ─────────────────────────────────────────────────
    if (data.feeCategories.length > 0) {
      if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
      section("Fee Categories");
      const fw = [W / 2, W / 4, W / 4];
      tableHeader(["Fee Type", "Billed", "Collected"], fw);
      data.feeCategories.slice(0, 10).forEach((r, i) => {
        tableRow(
          [String(r.fee_type), fmtINR(Number(r.billed)), fmtINR(Number(r.collected))],
          fw, i % 2 === 0,
          [null, null, CYAN],
        );
      });
      y += 12;
    }

    // ── 5. Payment Channels ────────────────────────────────────────────────
    if (data.paymentChannels.length > 0) {
      if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
      section("Payment Channels");
      // Group channels
      const chGroups: Record<string, number> = {};
      for (const ch of data.paymentChannels) {
        const m   = String(ch.payment_method ?? "Other");
        const cat = ["Portal Payment","Online","Razorpay","UPI","Card","NetBanking"].includes(m) ? "Portal Payment"
                  : m === "Cash" ? "Cash"
                  : ["Cheque","DD","BankTransfer","DemandDraft","Bank Transfer"].includes(m) ? "Cheque/Bank" : m;
        chGroups[cat] = (chGroups[cat] ?? 0) + Number(ch.amount);
      }
      const pw = [W / 2, W / 2];
      tableHeader(["Channel", "Amount Collected"], pw);
      Object.entries(chGroups).forEach(([name, amt], i) => {
        tableRow([name, fmtINR(amt)], pw, i % 2 === 0, [null, CYAN]);
      });
      y += 12;
    }

    // ── 6. AR Aging ────────────────────────────────────────────────────────
    if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
    section("Accounts Receivable Aging");
    const agBuckets = [
      { key: "1-30",  label: "1–30 Days",   color: "#fbbf24" },
      { key: "31-60", label: "31–60 Days",  color: "#f97316" },
      { key: "61-90", label: "61–90 Days",  color: RED       },
      { key: "90+",   label: "90+ Days",    color: "#dc2626" },
    ];
    const agMap = Object.fromEntries(data.aging.map((a: any) => [a.bucket, a]));
    const aw = [W / 3, W / 3, W / 3];
    tableHeader(["Aging Bucket", "Invoices", "Outstanding"], aw);
    agBuckets.forEach((b, i) => {
      const row = agMap[b.key];
      tableRow(
        [b.label, String(Number(row?.count ?? 0)), fmtINR(Number(row?.amount ?? 0))],
        aw, i % 2 === 0,
        [b.color, null, RED],
      );
    });

    // ── Footer ────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 40;
    doc.moveTo(50, footerY - 10).lineTo(50 + W, footerY - 10)
       .lineWidth(0.5).strokeColor(BORDER).stroke();
    doc.fillColor(MUTED).fontSize(7).font("Helvetica")
       .text(
         `Financial Analytics Report — ${schoolName} — ${monthLabel}   |   Confidential — For board use only`,
         50, footerY,
         { align: "center", width: W },
       );

    doc.end();
  });
}

// ── Email dispatch (SendGrid or Mailtrap) with PDF attachment ────────────────
async function sendEmailWithPdfAttachment(
  provider: string,
  apiKey: string,
  fromEmail: string,
  fromName: string,
  toEmail: string,
  subject: string,
  htmlBody: string,
  pdfBuffer: Buffer,
  filename: string,
  mailtrapInboxId?: string | null,
): Promise<void> {
  const pdfBase64 = pdfBuffer.toString("base64");

  if (provider === "mailtrap") {
    const res = await fetch(
      `https://sandbox.api.mailtrap.io/api/send/${mailtrapInboxId || "default"}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: { email: fromEmail || "fees@school.local", name: fromName || "School Finance" },
          to: [{ email: toEmail }],
          subject,
          html: htmlBody,
          attachments: [{
            content:     pdfBase64,
            filename,
            type:        "application/pdf",
            disposition: "attachment",
          }],
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Mailtrap error ${res.status}: ${body.substring(0, 300)}`);
    }
  } else {
    // SendGrid
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: fromEmail, name: fromName || "School Finance" },
        subject,
        content: [{ type: "text/html", value: htmlBody }],
        attachments: [{
          content:     pdfBase64,
          filename,
          type:        "application/pdf",
          disposition: "attachment",
        }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SendGrid error ${res.status}: ${body.substring(0, 300)}`);
    }
  }
}

// ── Plain HTML email body (brief cover note) ─────────────────────────────────
function buildCoverHtml(schoolName: string, monthLabel: string, sessionLabel: string): string {
  const esc = (v: unknown) =>
    String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <div style="max-width:520px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#0d1f35;padding:28px 32px;text-align:center;">
      <p style="margin:0 0 4px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#64a0c8;">Monthly Board Report</p>
      <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">${esc(schoolName)}</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 16px;font-size:14px;color:#334155;">
        Please find attached the <strong>Financial Analytics Report</strong> for
        <strong>${esc(monthLabel)}</strong> (Session: ${esc(sessionLabel)}).
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#64748b;">
        The PDF covers the full revenue summary, monthly collection trend, class-wise breakdown,
        fee categories, payment channels, and AR aging analysis.
      </p>
      <p style="margin:0;font-size:11px;color:#94a3b8;">
        This is an automated report. Please do not reply to this email.
      </p>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:10px;color:#94a3b8;">Confidential — For board use only</p>
    </div>
  </div>
</body></html>`;
}

// ── Core: send analytics report for one school ───────────────────────────────
// forceEnabled:
//   false (default) — scheduled run; respects the enabled flag and enforces a
//                     once-per-month atomic delivery guard so concurrent runners
//                     or restarts cannot send duplicate board reports.
//   true            — manual "Send Now"; ignores enabled flag and monthly guard.
export async function sendAnalyticsReport(
  schoolId: number,
  { forceEnabled = false }: { forceEnabled?: boolean } = {},
): Promise<{ sent: number; errors: string[] }> {
  const schedule = await storage.getReportEmailSchedule(schoolId);

  if (!schedule || !schedule.recipients || schedule.recipients.length === 0) {
    return { sent: 0, errors: ["No recipients configured"] };
  }
  if (!forceEnabled && !schedule.enabled) {
    // Scheduled run but schedule is disabled — skip silently
    return { sent: 0, errors: [] };
  }

  // ── Once-per-month atomic guard (scheduled runs only) ────────────────────
  // Claim the month before doing any work so concurrent cron runners or a
  // restart around the trigger minute cannot both send duplicate board reports.
  // The claim is a soft lock: it is REVERTED below if zero sends ultimately
  // succeed, so that the next cron run can retry a configuration failure or
  // transient provider outage later in the same month.
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (!forceEnabled) {
    const claimed = await storage.claimReportMonthForSend(schoolId, currentMonth);
    if (!claimed) {
      log(`School ${schoolId}: analytics report already sent for ${currentMonth} — skipping`, "cron");
      return { sent: 0, errors: [] };
    }
  }

  // All post-claim work lives inside try/finally so that every failure path —
  // missing credentials, data-fetch error, PDF generation error, or all
  // recipients failing — reverts the soft lock and allows cron to retry later
  // in the same month after configuration is corrected.
  const errors: string[] = [];
  let sent = 0;
  try {
    const notifConfig = await storage.getNotificationConfig(schoolId);
    if (!notifConfig?.emailEnabled) {
      errors.push("Email notifications are not enabled for this school. Enable them under Notification Settings.");
      return { sent: 0, errors };
    }

    const provider   = (notifConfig as any).emailProvider ?? "sendgrid";
    const apiKey     = provider === "mailtrap"
      ? (notifConfig as any).mailtrapApiKey
      : (notifConfig as any).sendgridApiKey;
    const fromEmail  = (notifConfig as any).sendgridFromEmail ?? "";
    const fromName   = (notifConfig as any).sendgridFromName ?? "School Finance";
    const mailtrapId = (notifConfig as any).mailtrapInboxId ?? null;

    if (!apiKey) {
      errors.push(`No ${provider} API key configured. Add one under Notification Settings.`);
      return { sent: 0, errors };
    }

    // Fetch school name + active session
    const schoolRow     = await pool.query("SELECT name FROM schools WHERE id = $1", [schoolId]);
    const schoolName    = schoolRow.rows[0]?.name ?? "School";
    const activeSession = await storage.getActiveSession(schoolId);
    const sessionLabel  = activeSession?.sessionName ?? "All Sessions";

    const monthLabel = formatMonthYearIST(now);
    const subject    = `Financial Analytics Report — ${schoolName} (${monthLabel})`;
    const filename   = `analytics-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${schoolName.replace(/\s+/g, "_")}.pdf`;

    // Generate analytics data + PDF (may throw; caught by outer try/finally)
    const data      = await fetchAnalyticsData(schoolId, activeSession?.id ?? null);
    const pdf       = await buildReportPdf(data, schoolName, sessionLabel);
    const htmlCover = buildCoverHtml(schoolName, monthLabel, sessionLabel);

    for (const toEmail of schedule.recipients) {
      try {
        await sendEmailWithPdfAttachment(
          provider, apiKey, fromEmail, fromName,
          toEmail, subject, htmlCover, pdf, filename, mailtrapId,
        );
        sent++;
      } catch (err: any) {
        errors.push(`${toEmail}: ${err.message}`);
      }
    }

    // At least one delivery succeeded — persist the confirmed sent timestamp.
    // For scheduled runs, last_sent_month was already written atomically by
    // claimReportMonthForSend; we just update last_sent_at here.
    if (sent > 0) {
      await storage.upsertReportEmailSchedule(schoolId, { lastSentAt: new Date() });
    }
  } finally {
    // If zero sends succeeded for a scheduled run, revert the month claim so
    // the next cron invocation this month can retry after the admin fixes
    // configuration.  clearMonthClaim is a no-op if a concurrent runner
    // already committed a successful send in the interim.
    if (sent === 0 && !forceEnabled) {
      await storage.clearMonthClaim(schoolId, currentMonth);
    }
  }

  return { sent, errors };
}

// ── Public: run for all schools (called by cron) ─────────────────────────────
export async function runMonthlyAnalyticsReport(): Promise<void> {
  log("Monthly analytics report job starting…", "cron");
  try {
    const allSchools = await storage.getSchools();
    for (const school of allSchools) {
      try {
        // forceEnabled=false — respects the enabled flag during scheduled runs
        const result = await sendAnalyticsReport(school.id, { forceEnabled: false });
        if (result.sent > 0) {
          log(`School ${school.id}: analytics PDF emailed to ${result.sent} recipient(s)`, "cron");
        }
        if (result.errors.length > 0) {
          log(`School ${school.id}: analytics report errors: ${result.errors.join("; ")}`, "cron");
        }
      } catch (err) {
        log(`School ${school.id}: analytics report failed: ${String(err)}`, "cron");
      }
    }
    log("Monthly analytics report job complete", "cron");
  } catch (err) {
    log(`Monthly analytics report job error: ${String(err)}`, "cron");
  }
}
