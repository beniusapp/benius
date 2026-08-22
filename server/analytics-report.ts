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
import { formatDateOnly } from "../shared/ist-time";
import {
  isMonthlyReportDue,
  previousCalendarMonthPeriod,
  reportMonthsAfter,
  reportPeriodForMonth,
  type MonthlyReportPeriod,
} from "./monthly-report-schedule";

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

type PreparedReport = {
  provider: string;
  apiKey: string;
  fromEmail: string;
  fromName: string;
  mailtrapId: string | null;
  subject: string;
  htmlCover: string;
  pdf: Buffer;
  filename: string;
};

async function prepareAnalyticsReport(
  schoolId: number,
  period: MonthlyReportPeriod,
): Promise<PreparedReport> {
  const activeSession = await storage.getActiveSession(schoolId);
  if (!activeSession) {
    throw new Error("No active academic session is configured for this school.");
  }
  const notifConfig = await storage.getNotificationConfig(schoolId);
  if (!notifConfig?.emailEnabled) {
    throw new Error("Email notifications are not enabled. Enable them in Notification Settings.");
  }

  const provider = (notifConfig as any).emailProvider ?? "sendgrid";
  const apiKey = provider === "mailtrap"
    ? (notifConfig as any).mailtrapApiKey
    : (notifConfig as any).sendgridApiKey;
  const fromEmail = (notifConfig as any).sendgridFromEmail ?? "";
  if (!apiKey) throw new Error(`No ${provider} API key is configured in Notification Settings.`);
  if (provider === "sendgrid" && !fromEmail) {
    throw new Error("A SendGrid sender email is required in Notification Settings.");
  }

  const schoolRow = await pool.query("SELECT name FROM schools WHERE id = $1", [schoolId]);
  const schoolName = schoolRow.rows[0]?.name ?? "School";
  const analyticsData = await buildFinancialAnalytics({
    schoolId,
    sessionId: activeSession.id,
    preset: "custom",
    customStart: period.startDate,
    customEnd: period.endDate,
  });
  const pdf = await renderFinancialAnalyticsPdf({
    data: analyticsData,
    school: { name: schoolName },
    section: "complete",
  });
  const filename = `analytics-${period.reportMonth}-${schoolName.replace(/\s+/g, "_")}.pdf`;
  return {
    provider,
    apiKey,
    fromEmail,
    fromName: (notifConfig as any).sendgridFromName ?? "School Finance",
    mailtrapId: (notifConfig as any).mailtrapInboxId ?? null,
    subject: `Financial Analytics Report — ${schoolName} (${period.label}: ${period.startDate} to ${period.endDate})`,
    htmlCover: buildCoverHtml(
      schoolName,
      period.label,
      activeSession.sessionName,
      analyticsData.filter.startDate,
      analyticsData.filter.endDate,
    ),
    pdf,
    filename,
  };
}

// ── Core: send analytics report for one school ───────────────────────────────
// forceEnabled=true is a manual test/send. It uses the same previous-month PDF
// pipeline but does not create or complete an automatic monthly delivery claim.
export async function sendAnalyticsReport(
  schoolId: number,
  {
    forceEnabled = false,
    now = new Date(),
    reportMonth,
  }: { forceEnabled?: boolean; now?: Date; reportMonth?: string } = {},
): Promise<{ sent: number; errors: string[]; reportMonth: string }> {
  const schedule = await storage.getReportEmailSchedule(schoolId);
  const period = reportMonth ? reportPeriodForMonth(reportMonth) : previousCalendarMonthPeriod(now);

  if (!schedule || !schedule.recipients || schedule.recipients.length === 0) {
    return { sent: 0, errors: ["No recipients configured"], reportMonth: period.reportMonth };
  }
  if (!forceEnabled && !schedule.enabled) {
    return { sent: 0, errors: [], reportMonth: period.reportMonth };
  }
  if (!forceEnabled && schedule.lastSentMonth === period.reportMonth) {
    return { sent: 0, errors: [], reportMonth: period.reportMonth };
  }

  if (!forceEnabled) {
    await storage.ensureReportEmailDeliveries(schoolId, period.reportMonth, schedule.recipients);
  }

  const errors: string[] = [];
  let sent = 0;
  let prepared: PreparedReport | null = null;
  let preparationError: string | null = null;
  try {
    prepared = await prepareAnalyticsReport(schoolId, period);
  } catch (error: any) {
    preparationError = String(error?.message ?? error);
  }

  for (const toEmail of schedule.recipients) {
    const claim = forceEnabled
      ? { claimed: true, attempts: 0, claimToken: null }
      : await storage.claimReportEmailDelivery(schoolId, period.reportMonth, toEmail);
    if (!claim.claimed) continue;
    try {
      if (preparationError || !prepared) throw new Error(preparationError ?? "Report preparation failed");
      await sendEmailWithPdfAttachment(
        prepared.provider,
        prepared.apiKey,
        prepared.fromEmail,
        prepared.fromName,
        toEmail,
        prepared.subject,
        prepared.htmlCover,
        prepared.pdf,
        prepared.filename,
        prepared.mailtrapId,
      );
      sent++;
      if (!forceEnabled) {
        const recorded = await storage.completeReportEmailDelivery(
          schoolId,
          period.reportMonth,
          toEmail,
          claim.claimToken!,
        );
        if (!recorded) {
          errors.push(`${toEmail}: delivery was accepted but its ownership lease expired before completion could be recorded`);
        }
      }
    } catch (error: any) {
      const message = String(error?.message ?? error);
      errors.push(`${toEmail}: ${message}`);
      if (!forceEnabled) {
        await storage.failReportEmailDelivery(
          schoolId,
          period.reportMonth,
          toEmail,
          claim.attempts,
          message,
          claim.claimToken!,
        );
      }
    }
  }

  if (!forceEnabled) {
    const complete = await storage.completeReportMonthIfDelivered(schoolId, period.reportMonth);
    if (complete) {
      log(`School ${schoolId}: completed monthly report delivery for ${period.reportMonth}`, "cron");
    }
  }

  return { sent, errors, reportMonth: period.reportMonth };
}

// ── Public: run for all schools (called by cron) ─────────────────────────────
export async function runMonthlyAnalyticsReport(now: Date = new Date()): Promise<void> {
  try {
    const schedules = await storage.getEnabledReportEmailSchedules();
    if (schedules.length === 0) return;
    let attempted = false;
    for (const schedule of schedules) {
      try {
        if (!isMonthlyReportDue(schedule, now)) continue;
        const currentPeriod = previousCalendarMonthPeriod(now);
        const incompleteMonths = await storage.getIncompleteReportEmailMonths(schedule.schoolId, currentPeriod.reportMonth);
        const reportMonths = new Set<string>([
          ...(schedule.lastSentMonth
            ? reportMonthsAfter(schedule.lastSentMonth, currentPeriod.reportMonth)
            : [currentPeriod.reportMonth]),
          ...incompleteMonths,
        ]);
        for (const reportMonth of [...reportMonths].sort()) {
          const result = await sendAnalyticsReport(schedule.schoolId, {
            forceEnabled: false,
            now,
            reportMonth,
          });
          attempted ||= result.sent > 0 || result.errors.length > 0;
          if (result.sent > 0) {
            log(`School ${schedule.schoolId}: analytics PDF for ${reportMonth} emailed to ${result.sent} recipient(s)`, "cron");
          }
          if (result.errors.length > 0) {
            log(`School ${schedule.schoolId}: ${reportMonth} report errors: ${result.errors.join("; ")}`, "cron");
          }
        }
      } catch (err) {
        log(`School ${schedule.schoolId}: analytics report failed: ${String(err)}`, "cron");
      }
    }
    if (attempted) log("Monthly analytics report job complete", "cron");
  } catch (err) {
    log(`Monthly analytics report job error: ${String(err)}`, "cron");
  }
}
