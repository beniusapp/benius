/**
 * Dunning engine — sends fee-overdue notifications via SMS (MSG91),
 * WhatsApp (MSG91) and email (SendGrid/Mailtrap) at four stages:
 *   D0  — due today
 *   D7  — 7 days overdue
 *   D14 — 14 days overdue
 *   D30 — 30 days overdue
 *
 * The engine is idempotent: it reads dunning_log to skip any
 * (feeRecordId, channel, stage) triplet already sent successfully.
 *
 * Simulation mode (simulate=true) — runs the full logic on ALL fee records
 * regardless of status, uses flexible stage matching, skips real API calls,
 * and logs with status "simulated". Used for testing without real keys.
 */

import { db } from "./db";
import {
  feeRecords, students, notificationConfig, dunningLog, academicSessions,
} from "@shared/schema";
import { eq, and, inArray, or, ne } from "drizzle-orm";
function log(msg: string, _tag?: string) { console.log(`[dunning] ${msg}`); }

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "D0" | "D7" | "D14" | "D30";
type Channel = "sms" | "whatsapp" | "email";

interface FeeForDunning {
  feeId: number;
  schoolId: number;
  studentId: number;
  studentName: string;
  studentPhone: string | null;
  studentEmail: string | null;
  guardianName: string | null;
  feeType: string;
  amount: number;
  dueDate: string;
  status: string;
  stage: Stage;
}

export interface SimulationResult {
  totalFees: number;
  entriesLogged: number;
  byChannel: Record<Channel, { would_send: number; missing_contact: number }>;
  entries: Array<{
    studentName: string;
    feeType: string;
    amount: number;
    dueDate: string;
    stage: Stage;
    channel: Channel;
    recipient: string | null;
    issue: string | null;
  }>;
}

// ─── Message templates ───────────────────────────────────────────────────────

const SMS_TEMPLATES: Record<Stage, (f: FeeForDunning) => string> = {
  D0:  f => `Dear ${f.guardianName || "Parent"}, ${f.studentName}'s fee "${f.feeType}" of Rs.${f.amount} is due today. Please pay promptly.`,
  D7:  f => `Reminder: ${f.studentName}'s fee "${f.feeType}" of Rs.${f.amount} is 7 days overdue. Please clear it at the earliest.`,
  D14: f => `2nd Notice: ${f.studentName}'s fee "${f.feeType}" of Rs.${f.amount} is 14 days overdue. Please contact admin immediately.`,
  D30: f => `FINAL NOTICE: ${f.studentName}'s fee "${f.feeType}" of Rs.${f.amount} is 30 days overdue. Account may be flagged.`,
};

const EMAIL_SUBJECTS: Record<Stage, string> = {
  D0:  "Fee Due Today",
  D7:  "Fee Reminder — 7 Days Overdue",
  D14: "Second Notice — Fee 14 Days Overdue",
  D30: "Final Notice — Fee 30 Days Overdue",
};

function emailHtml(f: FeeForDunning, stage: Stage): string {
  const messages: Record<Stage, string> = {
    D0:  `This is a reminder that ${f.studentName}'s fee <strong>"${f.feeType}"</strong> of <strong>₹${f.amount}</strong> is due today. Please pay to avoid late penalties.`,
    D7:  `${f.studentName}'s fee <strong>"${f.feeType}"</strong> of <strong>₹${f.amount}</strong> is <strong>7 days overdue</strong>. Please clear the dues immediately.`,
    D14: `This is a second notice. ${f.studentName}'s fee <strong>"${f.feeType}"</strong> of <strong>₹${f.amount}</strong> is <strong>14 days overdue</strong>. Please contact the school admin without further delay.`,
    D30: `<strong>FINAL NOTICE:</strong> ${f.studentName}'s fee <strong>"${f.feeType}"</strong> of <strong>₹${f.amount}</strong> is <strong>30 days overdue</strong>. Failure to pay may result in account restrictions.`,
  };
  return `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
<div style="max-width:480px;margin:auto;background:#fff;border-radius:8px;padding:24px;border:1px solid #ddd;">
  <h2 style="color:#1a2942;margin-top:0;">Fee Notification</h2>
  <p style="color:#444;">${messages[stage]}</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <tr><td style="padding:6px 0;color:#888;font-size:13px;">Student</td><td style="padding:6px 0;font-weight:600;font-size:13px;">${f.studentName}</td></tr>
    <tr><td style="padding:6px 0;color:#888;font-size:13px;">Fee Type</td><td style="padding:6px 0;font-size:13px;">${f.feeType}</td></tr>
    <tr><td style="padding:6px 0;color:#888;font-size:13px;">Amount</td><td style="padding:6px 0;font-weight:600;color:#e63946;font-size:13px;">₹${f.amount}</td></tr>
    <tr><td style="padding:6px 0;color:#888;font-size:13px;">Due Date</td><td style="padding:6px 0;font-size:13px;">${f.dueDate}</td></tr>
  </table>
  <p style="margin-top:20px;font-size:12px;color:#aaa;">Automated message from your school fee management system.</p>
</div>
</body></html>`;
}

// ─── Provider send functions ──────────────────────────────────────────────────

async function sendSms(authKey: string, senderId: string, phone: string, text: string): Promise<void> {
  // Normalise to 91XXXXXXXXXX
  const mobile = phone.replace(/\D/g, "").replace(/^0/, "91").replace(/^(?!91)/, "91");
  const res = await fetch("https://api.msg91.com/api/v2/sendsms", {
    method: "POST",
    headers: { authkey: authKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: senderId.substring(0, 6).toUpperCase(),
      route: "4",
      country: "91",
      sms: [{ message: text, to: [mobile] }],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`MSG91 SMS error ${res.status}: ${body}`);
  const json = JSON.parse(body);
  if (json.type === "error") throw new Error(`MSG91 SMS rejected: ${json.message}`);
}

async function sendWhatsapp(
  authKey: string, waNumber: string, templateName: string,
  phone: string, f: FeeForDunning, stage: Stage,
): Promise<void> {
  const mobile = phone.replace(/\D/g, "").replace(/^0/, "91").replace(/^(?!91)/, "91");
  const stageLabel: Record<Stage, string> = {
    D0: "due today", D7: "7 days overdue", D14: "14 days overdue", D30: "30 days overdue",
  };
  const res = await fetch("https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/", {
    method: "POST",
    headers: { authkey: authKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      integrated_number: waNumber,
      content_type: "template",
      payload: {
        messaging_product: "whatsapp",
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: f.guardianName || "Parent" },
              { type: "text", text: f.studentName },
              { type: "text", text: f.feeType },
              { type: "text", text: String(f.amount) },
              { type: "text", text: stageLabel[stage] },
            ],
          }],
        },
        to: mobile,
      },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`MSG91 WhatsApp error ${res.status}: ${body}`);
}

async function sendEmail(
  provider: string,
  apiKey: string, fromEmail: string, fromName: string,
  toEmail: string, toName: string, subject: string, html: string,
  mailtrapInboxId?: string | null,
): Promise<void> {
  if (provider === "mailtrap") {
    // Mailtrap sandbox API — https://api.mailtrap.io/api/send/{inbox_id}
    const inboxId = mailtrapInboxId || "default";
    const res = await fetch(`https://sandbox.api.mailtrap.io/api/send/${inboxId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { email: fromEmail || "fees@school.local", name: fromName || "School Admin" },
        to: [{ email: toEmail, name: toName }],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Mailtrap error ${res.status}: ${body.substring(0, 200)}`);
    }
  } else {
    // SendGrid
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail, name: toName }] }],
        from: { email: fromEmail, name: fromName || "School Admin" },
        subject,
        content: [{ type: "text/html", value: html }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SendGrid error ${res.status}: ${body.substring(0, 200)}`);
    }
  }
}

// ─── Stage calculators ────────────────────────────────────────────────────────


/** Exact match — only returns a stage on the precise day. Used by the real cron job. */
function getStage(dueDateStr: string): Stage | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0)  return "D0";
  if (days === 7)  return "D7";
  if (days === 14) return "D14";
  if (days === 30) return "D30";
  return null;
}

/** Flexible match — assigns the nearest stage to ANY fee. Used only in simulation. */
function getStageForSimulation(dueDateStr: string): Stage {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0)  return "D0";
  if (days <= 10) return "D7";
  if (days <= 22) return "D14";
  return "D30";
}

// ─── Fetch fee rows helper ────────────────────────────────────────────────────

async function fetchFeeRows(schoolId: number, statusFilter: string[] | null, sessionId?: number | null) {
  const conditions: any[] = [eq(feeRecords.schoolId, schoolId)];
  if (statusFilter) conditions.push(inArray(feeRecords.status, statusFilter));
  if (sessionId != null) conditions.push(eq(feeRecords.sessionId, sessionId));
  return db
    .select({
      feeId: feeRecords.id,
      schoolId: feeRecords.schoolId,
      studentId: feeRecords.studentId,
      studentName: students.name,
      studentPhone: students.phone,
      studentEmail: students.email,
      guardianName: students.guardianName,
      feeType: feeRecords.feeType,
      amount: feeRecords.amount,
      dueDate: feeRecords.dueDate,
      status: feeRecords.status,
    })
    .from(feeRecords)
    .innerJoin(students, eq(feeRecords.studentId, students.id))
    .where(and(...conditions));
}

// ─── Main dunning runner ──────────────────────────────────────────────────────

export async function runDunningJob(): Promise<void> {
  const configs = await db.select().from(notificationConfig).where(
    or(
      eq(notificationConfig.smsEnabled, true),
      eq(notificationConfig.waEnabled, true),
      eq(notificationConfig.emailEnabled, true),
    ),
  );
  if (configs.length === 0) return;

  for (const cfg of configs) {
    try {
      await processDunningForSchool(cfg, false);
    } catch (err) {
      log(`school ${cfg.schoolId} error: ${String(err)}`);
    }
  }
}

// ─── Simulation runner ────────────────────────────────────────────────────────

/**
 * Runs the dunning engine in dry-run mode for a given school.
 * - Processes ALL fee records regardless of status (so tests work even if all are Paid)
 * - Uses flexible stage matching instead of exact day
 * - Does NOT call MSG91 or SendGrid — just logs what would be sent
 * - Logs each entry with status "simulated"
 * - Does NOT deduplicate against prior simulations (each run is fresh)
 * - Returns a detailed report
 */
export async function runDunningSimulation(schoolId: number, sessionId?: number | null): Promise<SimulationResult> {
  const rows = await fetchFeeRows(schoolId, null, sessionId); // ALL statuses for viewed session

  const result: SimulationResult = {
    totalFees: rows.length,
    entriesLogged: 0,
    byChannel: {
      sms:       { would_send: 0, missing_contact: 0 },
      whatsapp:  { would_send: 0, missing_contact: 0 },
      email:     { would_send: 0, missing_contact: 0 },
    },
    entries: [],
  };

  if (rows.length === 0) return result;

  const channels: Channel[] = ["sms", "whatsapp", "email"];

  for (const row of rows) {
    const stage = getStageForSimulation(String(row.dueDate));
    const fee: FeeForDunning = {
      feeId: row.feeId,
      schoolId: row.schoolId,
      studentId: row.studentId,
      studentName: row.studentName,
      studentPhone: row.studentPhone ?? null,
      studentEmail: row.studentEmail ?? null,
      guardianName: row.guardianName ?? null,
      feeType: row.feeType,
      amount: row.amount,
      dueDate: String(row.dueDate),
      status: row.status,
      stage,
    };

    for (const channel of channels) {
      let recipient: string | null = null;
      let issue: string | null = null;

      if (channel === "sms" || channel === "whatsapp") {
        if (fee.studentPhone) {
          recipient = fee.studentPhone;
          result.byChannel[channel].would_send++;
        } else {
          issue = "No phone number on student record";
          result.byChannel[channel].missing_contact++;
        }
      } else if (channel === "email") {
        if (fee.studentEmail) {
          recipient = fee.studentEmail;
          result.byChannel.email.would_send++;
        } else {
          issue = "No email address on student record";
          result.byChannel.email.missing_contact++;
        }
      }

      result.entries.push({
        studentName: fee.studentName,
        feeType: fee.feeType,
        amount: fee.amount,
        dueDate: fee.dueDate,
        stage,
        channel,
        recipient,
        issue,
      });

      // Log to dunning_log as "simulated"
      await db.insert(dunningLog).values({
        schoolId,
        feeRecordId: fee.feeId,
        channel,
        stage,
        status: "simulated",
        errorMessage: issue ?? null,
        recipient,
        studentName: fee.studentName,
      });
      result.entriesLogged++;
    }
  }

  log(`Simulation for school ${schoolId}: ${result.totalFees} fees × 3 channels = ${result.entriesLogged} entries logged`);
  return result;
}

// ─── Per-school real processing ───────────────────────────────────────────────

async function processDunningForSchool(
  cfg: typeof notificationConfig.$inferSelect,
  _simulate: boolean,
): Promise<void> {
  // Scope to the school's active session — never send reminders for archived sessions
  const activeSession = await db.select({ id: academicSessions.id })
    .from(academicSessions)
    .where(and(eq(academicSessions.schoolId, cfg.schoolId), eq(academicSessions.isActive, true)))
    .limit(1);
  const sessionId = activeSession[0]?.id ?? null;
  const rows = await fetchFeeRows(cfg.schoolId, ["Due", "Overdue"], sessionId);
  if (rows.length === 0) return;

  const feeIds = rows.map(r => r.feeId);
  const existingLogs = await db
    .select({ feeRecordId: dunningLog.feeRecordId, channel: dunningLog.channel, stage: dunningLog.stage })
    .from(dunningLog)
    .where(
      and(
        eq(dunningLog.schoolId, cfg.schoolId),
        eq(dunningLog.status, "sent"),
        inArray(dunningLog.feeRecordId, feeIds),
      ),
    );

  const sentSet = new Set(existingLogs.map(l => `${l.feeRecordId}|${l.channel}|${l.stage}`));

  const channels: Channel[] = [];
  if (cfg.smsEnabled)   channels.push("sms");
  if (cfg.waEnabled)    channels.push("whatsapp");
  if (cfg.emailEnabled) channels.push("email");

  for (const row of rows) {
    const stage = getStage(String(row.dueDate));
    if (!stage) continue;

    const fee: FeeForDunning = {
      feeId: row.feeId,
      schoolId: row.schoolId,
      studentId: row.studentId,
      studentName: row.studentName,
      studentPhone: row.studentPhone ?? null,
      studentEmail: row.studentEmail ?? null,
      guardianName: row.guardianName ?? null,
      feeType: row.feeType,
      amount: row.amount,
      dueDate: String(row.dueDate),
      status: row.status,
      stage,
    };

    // Re-check fee status immediately before sending — the fee may have been
    // paid or waived after the initial SELECT (race-window guard).
    const freshRow = await db
      .select({ status: feeRecords.status })
      .from(feeRecords)
      .where(eq(feeRecords.id, fee.feeId))
      .limit(1);
    const freshStatus = freshRow[0]?.status ?? fee.status;
    if (freshStatus === "Paid" || freshStatus === "Waived") {
      log(`fee #${fee.feeId} (${fee.studentName}) is now ${freshStatus} — skipping all channels`);
      for (const channel of channels) {
        const key = `${fee.feeId}|${channel}|${stage}`;
        if (sentSet.has(key)) continue;
        await db.insert(dunningLog).values({
          schoolId: cfg.schoolId,
          feeRecordId: fee.feeId,
          channel,
          stage,
          status: "skipped",
          errorMessage: `skipped — ${freshStatus.toLowerCase()} after job queued`,
          recipient: null,
          studentName: fee.studentName,
        });
      }
      continue;
    }

    for (const channel of channels) {
      const key = `${fee.feeId}|${channel}|${stage}`;
      if (sentSet.has(key)) continue;

      let status: "sent" | "failed" = "failed";
      let errorMessage: string | undefined;
      let recipient: string | undefined;

      try {
        if (channel === "sms") {
          if (!cfg.msg91AuthKey || !cfg.msg91SenderId || !fee.studentPhone) {
            errorMessage = "Missing SMS config or student phone";
          } else {
            recipient = fee.studentPhone;
            await sendSms(cfg.msg91AuthKey, cfg.msg91SenderId, fee.studentPhone, SMS_TEMPLATES[stage](fee));
            status = "sent";
          }
        } else if (channel === "whatsapp") {
          if (!cfg.msg91AuthKey || !cfg.msg91WaNumber || !cfg.msg91WaTemplate || !fee.studentPhone) {
            errorMessage = "Missing WhatsApp config or student phone";
          } else {
            recipient = fee.studentPhone;
            await sendWhatsapp(cfg.msg91AuthKey, cfg.msg91WaNumber, cfg.msg91WaTemplate, fee.studentPhone, fee, stage);
            status = "sent";
          }
        } else if (channel === "email") {
          const provider = cfg.emailProvider ?? "sendgrid";
          const apiKey = provider === "mailtrap" ? cfg.mailtrapApiKey : cfg.sendgridApiKey;
          const fromEmail = provider === "mailtrap" ? "fees@school.local" : (cfg.sendgridFromEmail ?? "");
          if (!apiKey || !fee.studentEmail) {
            errorMessage = `Missing ${provider} API key or student email`;
          } else {
            recipient = fee.studentEmail;
            await sendEmail(
              provider,
              apiKey, fromEmail, cfg.sendgridFromName || "School Admin",
              fee.studentEmail, fee.guardianName || fee.studentName,
              `${EMAIL_SUBJECTS[stage]} — ${fee.studentName}`,
              emailHtml(fee, stage),
              cfg.mailtrapInboxId,
            );
            status = "sent";
          }
        }
      } catch (err) {
        status = "failed";
        errorMessage = String(err);
      }

      await db.insert(dunningLog).values({
        schoolId: cfg.schoolId,
        feeRecordId: fee.feeId,
        channel,
        stage,
        status,
        errorMessage: errorMessage ?? null,
        recipient: recipient ?? null,
        studentName: fee.studentName,
      });

      if (status === "sent") {
        sentSet.add(key);
        log(`${channel} ${stage} → ${fee.studentName} (fee #${fee.feeId}) sent`);
      } else {
        log(`${channel} ${stage} → ${fee.studentName} FAILED: ${errorMessage}`);
      }
    }
  }
}