/**
 * analytics-report.ts
 * Generates a Financial Analytics PDF and emails it as an attachment.
 *
 * Delegates all PDF building to the canonical renderFinancialAnalyticsPdf()
 * renderer. All analytics data is sourced from buildFinancialAnalytics() —
 * no duplicated SQL here.
 */

import { pool } from "./db";
import { storage } from "./storage";
import { log } from "./index";
import { buildFinancialAnalytics } from "./financial-analytics-data";
import { renderFinancialAnalyticsPdf } from "./financial-analytics-pdf";
import { formatMonthYearIST, formatDateOnly, todayInIST } from "../shared/ist-time";

// ── Plain HTML email body (brief cover note) ─────────────────────────────────
function buildCoverHtml(
  schoolName: string,
  periodLabel: string,
  sessionLabel: string,
  startDate: string,
  endDate: string,
): string {
  const esc = (v: unknown) =>
    String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dateRange = `${formatDateOnly(startDate, false)} – ${formatDateOnly(endDate, false)}`;
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
        <strong>${esc(periodLabel)}</strong> (${esc(dateRange)}) — Session: ${esc(sessionLabel)}.
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#64748b;">
        The PDF covers the full revenue summary, collection trend, online/offline channel
        breakdown with statuses and methods, class-wise breakdown, fee categories,
        AR aging, and cash denomination coverage.
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

  // ── Require an active session ────────────────────────────────────────────────
  const activeSession = await storage.getActiveSession(schoolId);
  if (!activeSession) {
    return {
      sent: 0,
      errors: [
        `School ${schoolId}: no active academic session found. ` +
        "Please mark an academic session as active before sending analytics reports.",
      ],
    };
  }

  // ── Once-per-month atomic guard (scheduled runs only) ────────────────────────
  // Claim the month before doing any work so concurrent cron runners or a
  // restart around the trigger minute cannot both send duplicate board reports.
  // The claim is a soft lock: it is REVERTED below if zero sends ultimately
  // succeed, so that the next cron run can retry a configuration failure or
  // transient provider outage later in the same month.
  const now = new Date();
  const currentMonth = todayInIST().slice(0, 7);

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

    // Fetch school name
    const schoolRow  = await pool.query("SELECT name FROM schools WHERE id = $1", [schoolId]);
    const schoolName = schoolRow.rows[0]?.name ?? "School";

    // ── Build canonical analytics data via the shared data service ─────────────
    const analyticsData = await buildFinancialAnalytics({
      schoolId,
      sessionId: activeSession.id,
      preset: "this_month",
    });

    // Derive period labels from canonical filter data
    const periodLabel = formatMonthYearIST(now);
    const sessionLabel = activeSession.sessionName;

    const subject  = `Financial Analytics Report — ${schoolName} (${periodLabel}: ${analyticsData.filter.startDate} to ${analyticsData.filter.endDate})`;
    const filename = `analytics-${analyticsData.filter.startDate.slice(0, 7)}-${schoolName.replace(/\s+/g, "_")}.pdf`;

    // ── Render PDF using the canonical renderer ─────────────────────────────────
    const pdf = await renderFinancialAnalyticsPdf({
      data: analyticsData,
      school: { name: schoolName },
      section: "complete",
    });

    const htmlCover = buildCoverHtml(
      schoolName,
      periodLabel,
      sessionLabel,
      analyticsData.filter.startDate,
      analyticsData.filter.endDate,
    );

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
