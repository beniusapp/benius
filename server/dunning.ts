/**
 * Dunning engine — sends fee-overdue notifications via SMS (MSG91),
 * WhatsApp (MSG91) and email (SendGrid/Mailtrap) at five stages:
 *   D-2  — 2 days BEFORE the invoice due date (early warning)
 *   D+0  — on the due date
 *   D+3  — 3 days overdue
 *   D+7  — 7 days overdue
 *   D+14 — 14 days overdue
 *
 * All date arithmetic uses India Standard Time (IST / Asia/Kolkata = UTC+5:30)
 * explicitly, regardless of the server's local timezone.
 *
 * Idempotency: the engine reads dunning_log to skip any
 * (feeRecordId, channel, stage) triplet already sent successfully.
 *
 * Catch-up: getStageWithCatchup() also checks the past CATCHUP_DAYS IST
 * calendar days so a stage missed during a brief server outage (restart,
 * deployment, maintenance) is still processed when the server comes back.
 * Dedup via sentSet guarantees no duplicate sends.
 *
 * Retry: transient provider failures (timeout / network / 429 / 5xx) are
 * retried up to MAX_RETRIES times with exponential back-off (1s → 2s → 4s).
 * Non-retryable 4xx config errors are NOT retried.
 *
 * Simulation mode: runs full logic on ALL fee records, uses flexible stage
 * matching, skips all real API calls, logs with status "simulated".
 * Simulated rows never block real sentSet dedup.
 */

import { db, pool } from "./db";
import {
  feeRecords, students, notificationConfig, dunningLog,
  academicSessions, dunningTemplates, dunningJobStatus,
} from "@shared/schema";
import { eq, and, inArray, or } from "drizzle-orm";

function log(msg: string, _tag?: string) { console.log(`[dunning] ${msg}`); }

// ─── Advisory lock ────────────────────────────────────────────────────────────
const DUNNING_LOCK_KEY = 7473328;

// ─── Reliability constants ────────────────────────────────────────────────────
/** Past IST calendar days the catch-up window looks back for missed stages. */
const CATCHUP_DAYS = 2;
/** Total send attempts per channel (1 original + 2 retries). */
const MAX_RETRIES = 3;
/** Back-off delays between retry attempts (ms). */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
/** Hard timeout for every provider fetch (ms). */
const FETCH_TIMEOUT_MS = 12_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Stage = "D-2" | "D+0" | "D+3" | "D+7" | "D+14";
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
  /** Total outstanding amount = base fee + accrued late fee (rupees). */
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

// ─── Formatting utilities (exported so client/tests can use them) ─────────────

/**
 * Format an integer rupee amount with Indian thousand separators.
 * 10000 → "10,000"   5000 → "5,000"
 */
export function formatAmount(amount: number): string {
  return amount.toLocaleString("en-IN");
}

/**
 * Format a "YYYY-MM-DD" string as an Indian-style date.
 * "2027-08-17" → "17 Aug 2027"
 */
export function formatIndianDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (!y || !m || !d || m < 1 || m > 12) return dateStr;
  return `${d} ${months[m - 1]} ${y}`;
}

// ─── Default message templates ────────────────────────────────────────────────

export const DEFAULT_SMS_TEMPLATES: Record<Stage, string> = {
  "D-2":  `Dear {guardian_name}, this is a reminder that {student_name}'s fee "{fee_name}" of Rs.{amount} is due on {due_date}. Please pay before the due date.`,
  "D+0":  `Dear {guardian_name}, {student_name}'s fee "{fee_name}" of Rs.{amount} is due today. Please pay promptly.`,
  "D+3":  `Reminder: {student_name}'s fee "{fee_name}" of Rs.{amount} is 3 days overdue. Please clear it at the earliest.`,
  "D+7":  `Reminder: {student_name}'s fee "{fee_name}" of Rs.{amount} is 7 days overdue. Please clear it immediately.`,
  "D+14": `FINAL NOTICE: {student_name}'s fee "{fee_name}" of Rs.{amount} is 14 days overdue. Please contact admin immediately.`,
};

export const DEFAULT_EMAIL_SUBJECTS: Record<Stage, string> = {
  "D-2":  "Upcoming Fee Due in 2 Days",
  "D+0":  "Fee Due Today",
  "D+3":  "Fee Reminder — 3 Days Overdue",
  "D+7":  "Fee Reminder — 7 Days Overdue",
  "D+14": "Final Notice — Fee 14 Days Overdue",
};

export const DEFAULT_EMAIL_BODIES: Record<Stage, string> = {
  "D-2":  `This is an advance reminder that {student_name}'s fee "{fee_name}" of ₹{amount} is due on {due_date}. Please ensure timely payment to avoid late fees.`,
  "D+0":  `This is a reminder that {student_name}'s fee "{fee_name}" of ₹{amount} is due today. Please pay to avoid late penalties.`,
  "D+3":  `{student_name}'s fee "{fee_name}" of ₹{amount} is 3 days overdue. Please clear the dues as soon as possible.`,
  "D+7":  `{student_name}'s fee "{fee_name}" of ₹{amount} is 7 days overdue. Please clear the dues immediately.`,
  "D+14": `**FINAL NOTICE:** {student_name}'s fee "{fee_name}" of ₹{amount} is 14 days overdue. Please contact the school admin without further delay.`,
};

/** Replace {variable} placeholders with formatted fee data. */
function interpolate(template: string, f: FeeForDunning): string {
  return template
    .replace(/\{student_name\}/g,  f.studentName)
    .replace(/\{guardian_name\}/g, f.guardianName || "Parent")
    .replace(/\{fee_name\}/g,      f.feeType)
    .replace(/\{amount\}/g,        formatAmount(f.amount))
    .replace(/\{due_date\}/g,      formatIndianDate(f.dueDate));
}

// ─── DB template cache ────────────────────────────────────────────────────────

interface TemplateMap {
  sms:   Partial<Record<Stage, string>>;
  email: Partial<Record<Stage, { subject: string; body: string }>>;
}

async function loadTemplates(schoolId: number): Promise<TemplateMap> {
  const rows = await db
    .select()
    .from(dunningTemplates)
    .where(eq(dunningTemplates.schoolId, schoolId));

  const map: TemplateMap = { sms: {}, email: {} };
  for (const row of rows) {
    const stage = row.stage as Stage;
    if (row.channel === "sms") {
      map.sms[stage] = row.bodyText;
    } else if (row.channel === "email") {
      map.email[stage] = {
        subject: row.subjectText || DEFAULT_EMAIL_SUBJECTS[stage],
        body: row.bodyText,
      };
    }
  }
  return map;
}

function getSmsText(tmap: TemplateMap, stage: Stage, f: FeeForDunning): string {
  const tmpl = tmap.sms[stage] ?? DEFAULT_SMS_TEMPLATES[stage];
  return interpolate(tmpl, f);
}

function getEmailSubject(tmap: TemplateMap, stage: Stage, f: FeeForDunning): string {
  const tmpl = tmap.email[stage]?.subject ?? DEFAULT_EMAIL_SUBJECTS[stage];
  return interpolate(tmpl, f);
}

function getEmailBody(tmap: TemplateMap, stage: Stage, f: FeeForDunning): string {
  const body = tmap.email[stage]?.body ?? DEFAULT_EMAIL_BODIES[stage];
  const bodyHtml = interpolate(body, f)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  return `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
<div style="max-width:480px;margin:auto;background:#fff;border-radius:8px;padding:24px;border:1px solid #ddd;">
  <h2 style="color:#1a2942;margin-top:0;">Fee Notification</h2>
  <p style="color:#444;">${bodyHtml}</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <tr><td style="padding:6px 0;color:#888;font-size:13px;">Student</td><td style="padding:6px 0;font-weight:600;font-size:13px;">${f.studentName}</td></tr>
    <tr><td style="padding:6px 0;color:#888;font-size:13px;">Fee Type</td><td style="padding:6px 0;font-size:13px;">${f.feeType}</td></tr>
    <tr><td style="padding:6px 0;color:#888;font-size:13px;">Amount Due</td><td style="padding:6px 0;font-weight:600;color:#e63946;font-size:13px;">₹${formatAmount(f.amount)}</td></tr>
    <tr><td style="padding:6px 0;color:#888;font-size:13px;">Due Date</td><td style="padding:6px 0;font-size:13px;">${formatIndianDate(f.dueDate)}</td></tr>
  </table>
  <p style="margin-top:20px;font-size:12px;color:#aaa;">Automated message from your school fee management system.</p>
</div>
</body></html>`;
}

// ─── Phone normalisation ──────────────────────────────────────────────────────

/**
 * Normalise an Indian mobile number to 91XXXXXXXXXX (12 digits).
 * Returns null if the input is empty, whitespace-only, or not a plausible
 * Indian mobile number after normalisation.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.trim().replace(/\D/g, "");
  if (!digits) return null;
  let mobile = digits;
  if (mobile.startsWith("0"))        mobile = "91" + mobile.slice(1);
  else if (!mobile.startsWith("91")) mobile = "91" + mobile;
  // Exactly 12 digits: country code "91" + 10-digit number
  if (mobile.length !== 12) return null;
  return mobile;
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

/**
 * Execute fn up to MAX_RETRIES times with exponential back-off.
 * Retries: timeout, network errors, HTTP 429, HTTP 5xx (500/502/503/504).
 * Does NOT retry: HTTP 4xx config errors (wrong key, bad sender, etc.)
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: Error = new Error("unknown");
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message;
      // HTTP 4xx (except 429) = configuration error — do not retry
      const is4xx = /HTTP (4\d\d)/.test(msg) && !/HTTP 429/.test(msg);
      if (is4xx || attempt === MAX_RETRIES) break;
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 4_000;
      log(`${label} attempt ${attempt} failed (${msg.slice(0, 80)}…), retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── Provider send functions ──────────────────────────────────────────────────

async function sendSms(authKey: string, senderId: string, phone: string, text: string): Promise<void> {
  const mobile = normalizePhone(phone);
  if (!mobile) throw new Error(`SMS HTTP 400: Invalid phone number after normalisation — "${phone.trim()}"`);

  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.msg91.com/api/v2/sendsms", {
        method: "POST",
        headers: { authkey: authKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender:  senderId.substring(0, 6).toUpperCase(),
          route:   "4",
          country: "91",
          sms: [{ message: text, to: [mobile] }],
        }),
        signal: controller.signal,
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`SMS HTTP ${res.status}: ${body.slice(0, 200)}`);
      // MSG91 returns { "type": "success" | "error", "message": "..." }
      // HTTP 200 with type="success" means MSG91 accepted the request for queued delivery.
      // HTTP 200 with type="error" means MSG91 rejected it — treat as failure.
      let json: any;
      try { json = JSON.parse(body); } catch { /* non-JSON — assume accepted */ }
      if (json?.type === "error") throw new Error(`SMS HTTP 400: MSG91 rejected — ${json.message ?? body.slice(0, 200)}`);
    } finally {
      clearTimeout(timer);
    }
  }, "SMS");
}

async function sendWhatsapp(
  authKey: string, waNumber: string, templateName: string,
  phone: string, f: FeeForDunning, stage: Stage,
): Promise<void> {
  const mobile = normalizePhone(phone);
  if (!mobile) throw new Error(`WhatsApp HTTP 400: Invalid phone number after normalisation — "${phone.trim()}"`);

  // Stage labels for the 5th template parameter
  const stageLabel: Record<Stage, string> = {
    "D-2":  "due in 2 days",
    "D+0":  "due today",
    "D+3":  "3 days overdue",
    "D+7":  "7 days overdue",
    "D+14": "14 days overdue",
  };

  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
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
                  { type: "text", text: f.guardianName || "Parent" },  // {{1}}
                  { type: "text", text: f.studentName },                // {{2}}
                  { type: "text", text: f.feeType },                    // {{3}}
                  { type: "text", text: formatAmount(f.amount) },       // {{4}}
                  { type: "text", text: stageLabel[stage] },            // {{5}}
                ],
              }],
            },
            to: mobile,
          },
        }),
        signal: controller.signal,
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`WhatsApp HTTP ${res.status}: ${body.slice(0, 200)}`);

      // MSG91 WhatsApp can return HTTP 200 with a JSON error body.
      // We must detect this to avoid a false "sent" record.
      let json: any;
      try { json = JSON.parse(body); } catch { /* non-JSON — assume accepted */ }
      if (json) {
        if (json.type     === "error") throw new Error(`WhatsApp HTTP 400: MSG91 rejected — ${json.message  ?? body.slice(0, 200)}`);
        if (json.message  === "error") throw new Error(`WhatsApp HTTP 400: MSG91 error   — ${json.error    ?? body.slice(0, 200)}`);
        if (json.status   === "error") throw new Error(`WhatsApp HTTP 400: MSG91 status  — ${json.message  ?? body.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }, "WhatsApp");
}

async function sendEmail(
  provider: string,
  apiKey: string, fromEmail: string, fromName: string,
  toEmail: string, toName: string, subject: string, html: string,
  mailtrapInboxId?: string | null,
): Promise<void> {
  // Pre-call validation — fail fast with a descriptive error, no API round-trip
  if (!fromEmail || !fromEmail.includes("@")) {
    throw new Error(`Email HTTP 400: Missing or invalid From Email (${provider}) — set sendgridFromEmail in Notification Settings`);
  }
  if (!toEmail || !toEmail.includes("@")) {
    throw new Error(`Email HTTP 400: Invalid recipient email — "${toEmail}"`);
  }

  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      if (provider === "mailtrap") {
        // Mailtrap sandbox — for development/testing only, not for real delivery
        const inboxId = mailtrapInboxId || "default";
        const res = await fetch(`https://sandbox.api.mailtrap.io/api/send/${inboxId}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: { email: fromEmail, name: fromName || "School Admin" },
            to: [{ email: toEmail, name: toName }],
            subject,
            html,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const b = await res.text();
          throw new Error(`Email HTTP ${res.status}: Mailtrap — ${b.slice(0, 200)}`);
        }
      } else {
        // SendGrid — production email provider
        const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: toEmail, name: toName }] }],
            from: { email: fromEmail, name: fromName || "School Admin" },
            subject,
            content: [{ type: "text/html", value: html }],
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const b = await res.text();
          throw new Error(`Email HTTP ${res.status}: SendGrid — ${b.slice(0, 200)}`);
        }
        // SendGrid returns HTTP 202 with empty body on success — nothing more to check
      }
    } finally {
      clearTimeout(timer);
    }
  }, `Email(${provider})`);
}

// ─── Stage calculators ────────────────────────────────────────────────────────

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30 in ms

/**
 * Days elapsed since the invoice due date, in IST calendar days.
 * Positive = overdue. Negative = not yet due. Zero = due today in IST.
 * Exported so tests can set vi.setSystemTime() without DB involvement.
 */
export function daysSinceIST(dueDateStr: string): number {
  const nowIST   = new Date(Date.now() + IST_OFFSET_MS);
  const todayUTC = Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate());
  const [y, m, d] = dueDateStr.split("-").map(Number);
  const dueUTC    = Date.UTC(y, m - 1, d);
  return Math.round((todayUTC - dueUTC) / (1_000 * 60 * 60 * 24));
}

/** Map a day offset to its stage (exact match only), or null. Internal helper. */
function getStageByDays(days: number): Stage | null {
  if (days === -2) return "D-2";
  if (days ===  0) return "D+0";
  if (days ===  3) return "D+3";
  if (days ===  7) return "D+7";
  if (days === 14) return "D+14";
  return null;
}

/**
 * Exact-day match — only fires on the precise IST calendar day.
 * Exported for tests.
 */
export function getStage(dueDateStr: string): Stage | null {
  return getStageByDays(daysSinceIST(dueDateStr));
}

/**
 * Exact-day match with a catch-up window of up to CATCHUP_DAYS past days.
 * Used by the real cron job.
 *
 * Example: server was down on D+7 (day 7). Today is D+9 (day 9).
 *   days=9 → no exact match
 *   i=1:  check day 9−1=8 → no match
 *   i=2:  check day 9−2=7 → "D+7" ← catch-up fires!
 *   sentSet dedup guarantees no duplicate.
 *
 * Exported for tests.
 */
export function getStageWithCatchup(dueDateStr: string, maxCatchupDays = CATCHUP_DAYS): Stage | null {
  const days = daysSinceIST(dueDateStr);
  const exact = getStageByDays(days);
  if (exact) return exact;
  for (let i = 1; i <= maxCatchupDays; i++) {
    const s = getStageByDays(days - i);
    if (s) return s;
  }
  return null;
}

/**
 * Nearest-bucket match — always returns a non-null stage.
 * Used for admin "Send Reminder" manual trigger.
 * Exported for tests.
 */
export function getStageForManualTrigger(dueDateStr: string): Stage {
  const days = daysSinceIST(dueDateStr);
  if (days <= -2) return "D-2";
  if (days <=  1) return "D+0";
  if (days <=  5) return "D+3";
  if (days <= 10) return "D+7";
  return "D+14";
}

/**
 * Same nearest-bucket logic as manual trigger.
 * Used only in simulation (all fee statuses, any day).
 * Exported for tests.
 */
export function getStageForSimulation(dueDateStr: string): Stage {
  const days = daysSinceIST(dueDateStr);
  if (days <= -2) return "D-2";
  if (days <=  1) return "D+0";
  if (days <=  5) return "D+3";
  if (days <= 10) return "D+7";
  return "D+14";
}

// ─── Fetch fee rows ───────────────────────────────────────────────────────────

async function fetchFeeRows(schoolId: number, statusFilter: string[] | null, sessionId?: number | null) {
  const conditions: any[] = [eq(feeRecords.schoolId, schoolId)];
  if (statusFilter)    conditions.push(inArray(feeRecords.status, statusFilter));
  if (sessionId != null) conditions.push(eq(feeRecords.sessionId, sessionId));
  return db
    .select({
      feeId:         feeRecords.id,
      schoolId:      feeRecords.schoolId,
      studentId:     feeRecords.studentId,
      studentName:   students.name,
      studentPhone:  students.phone,
      studentEmail:  students.email,
      guardianName:  students.guardianName,
      feeType:       feeRecords.feeType,
      amount:        feeRecords.amount,
      lateFeeAmount: feeRecords.lateFeeAmount,
      dueDate:       feeRecords.dueDate,
      status:        feeRecords.status,
    })
    .from(feeRecords)
    .innerJoin(students, eq(feeRecords.studentId, students.id))
    .where(and(...conditions));
}

// ─── Job status helper ────────────────────────────────────────────────────────

async function setJobStatus(isRunning: boolean): Promise<void> {
  try {
    await db
      .insert(dunningJobStatus)
      .values({
        id: 1, isRunning,
        startedAt:       isRunning ? new Date() : undefined,
        lastCompletedAt: isRunning ? undefined  : new Date(),
      })
      .onConflictDoUpdate({
        target: dunningJobStatus.id,
        set: isRunning
          ? { isRunning: true,  startedAt: new Date() }
          : { isRunning: false, lastCompletedAt: new Date() },
      });
  } catch (err) {
    log(`setJobStatus error: ${String(err)}`);
  }
}

// ─── Main dunning job ─────────────────────────────────────────────────────────

export async function runDunningJob(): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [DUNNING_LOCK_KEY],
    );
    locked = rows[0]?.acquired === true;
    if (!locked) {
      log("already running (advisory lock held) — skipping");
      return;
    }

    await setJobStatus(true);

    const configs = await db.select().from(notificationConfig).where(
      or(
        eq(notificationConfig.smsEnabled,   true),
        eq(notificationConfig.waEnabled,    true),
        eq(notificationConfig.emailEnabled, true),
      ),
    );
    if (configs.length === 0) return;

    for (const cfg of configs) {
      try {
        await processDunningForSchool(cfg);
      } catch (err) {
        log(`school ${cfg.schoolId} error: ${String(err)}`);
      }
    }
  } finally {
    if (locked) {
      await setJobStatus(false);
      await client.query("SELECT pg_advisory_unlock($1)", [DUNNING_LOCK_KEY]);
    }
    client.release();
  }
}

// ─── Simulation ───────────────────────────────────────────────────────────────

/**
 * Dry-run for a given school.
 * - ALL fee statuses (so admin sees the full picture)
 * - Flexible stage matching (nearest bucket)
 * - NO real API calls
 * - Logs status="simulated" — never blocks real sentSet dedup
 */
export async function runDunningSimulation(schoolId: number, sessionId?: number | null): Promise<SimulationResult> {
  const rows = await fetchFeeRows(schoolId, null, sessionId);

  const result: SimulationResult = {
    totalFees: rows.length,
    entriesLogged: 0,
    byChannel: {
      sms:      { would_send: 0, missing_contact: 0 },
      whatsapp: { would_send: 0, missing_contact: 0 },
      email:    { would_send: 0, missing_contact: 0 },
    },
    entries: [],
  };
  if (rows.length === 0) return result;

  const channels: Channel[] = ["sms", "whatsapp", "email"];

  for (const row of rows) {
    const stage       = getStageForSimulation(String(row.dueDate));
    const totalAmount = (row.amount ?? 0) + (row.lateFeeAmount ?? 0);
    const fee: FeeForDunning = {
      feeId:        row.feeId,
      schoolId:     row.schoolId,
      studentId:    row.studentId,
      studentName:  row.studentName,
      studentPhone: row.studentPhone ?? null,
      studentEmail: row.studentEmail ?? null,
      guardianName: row.guardianName ?? null,
      feeType:      row.feeType,
      amount:       totalAmount,
      dueDate:      String(row.dueDate),
      status:       row.status,
      stage,
    };

    for (const channel of channels) {
      let recipient: string | null = null;
      let issue:     string | null = null;

      if (channel === "sms" || channel === "whatsapp") {
        const norm = fee.studentPhone ? normalizePhone(fee.studentPhone) : null;
        if (norm) {
          recipient = fee.studentPhone;
          result.byChannel[channel].would_send++;
        } else {
          issue = fee.studentPhone ? "Invalid phone number format" : "No phone number on student record";
          result.byChannel[channel].missing_contact++;
        }
      } else {
        if (fee.studentEmail && fee.studentEmail.includes("@")) {
          recipient = fee.studentEmail;
          result.byChannel.email.would_send++;
        } else {
          issue = fee.studentEmail ? "Invalid email address" : "No email address on student record";
          result.byChannel.email.missing_contact++;
        }
      }

      result.entries.push({ studentName: fee.studentName, feeType: fee.feeType, amount: fee.amount, dueDate: fee.dueDate, stage, channel, recipient, issue });

      await db.insert(dunningLog).values({
        schoolId, feeRecordId: fee.feeId, channel, stage,
        status: "simulated", errorMessage: issue ?? null,
        recipient, studentName: fee.studentName,
      });
      result.entriesLogged++;
    }
  }

  log(`Simulation school ${schoolId}: ${result.totalFees} fees × 3 ch = ${result.entriesLogged} entries`);
  return result;
}

// ─── Manual single-fee trigger ────────────────────────────────────────────────

/**
 * Fire dunning for one specific fee from the admin UI.
 * Uses nearest-bucket stage (works any day). Always attempts regardless of
 * prior history (intentional manual override). Writes dunning_log so the
 * automatic cron will see the "sent" row and not duplicate it automatically.
 */
export async function runDunningForSingleFee(
  schoolId: number,
  feeRecordId: number,
): Promise<{ sent: string[]; failed: string[]; skipped: string[] }> {
  const sent: string[] = [], failed: string[] = [], skipped: string[] = [];

  const rows = await db
    .select({
      feeId:         feeRecords.id,
      schoolId:      feeRecords.schoolId,
      studentId:     feeRecords.studentId,
      studentName:   students.name,
      studentPhone:  students.phone,
      studentEmail:  students.email,
      guardianName:  students.guardianName,
      feeType:       feeRecords.feeType,
      amount:        feeRecords.amount,
      lateFeeAmount: feeRecords.lateFeeAmount,
      dueDate:       feeRecords.dueDate,
      status:        feeRecords.status,
    })
    .from(feeRecords)
    .innerJoin(students, eq(feeRecords.studentId, students.id))
    .where(and(eq(feeRecords.id, feeRecordId), eq(feeRecords.schoolId, schoolId)))
    .limit(1);

  if (rows.length === 0) throw new Error("Fee record not found or does not belong to this school");

  const row = rows[0];
  if (row.status === "Paid") {
    return { sent, failed, skipped: [`${row.status} — no reminder needed`] };
  }

  const cfgRows = await db.select().from(notificationConfig)
    .where(eq(notificationConfig.schoolId, schoolId)).limit(1);
  if (cfgRows.length === 0) {
    return { sent, failed, skipped: ["No notification config for this school"] };
  }

  const c = cfgRows[0];
  const channels: Channel[] = [];
  if (c.smsEnabled)   channels.push("sms");
  if (c.waEnabled)    channels.push("whatsapp");
  if (c.emailEnabled) channels.push("email");
  if (channels.length === 0) {
    return { sent, failed, skipped: ["No notification channels enabled"] };
  }

  let tmap: TemplateMap = { sms: {}, email: {} };
  try { tmap = await loadTemplates(schoolId); } catch { /* use defaults */ }

  const stage       = getStageForManualTrigger(String(row.dueDate));
  const totalAmount = (row.amount ?? 0) + (row.lateFeeAmount ?? 0);

  const fee: FeeForDunning = {
    feeId:        row.feeId,   schoolId: row.schoolId,
    studentId:    row.studentId, studentName: row.studentName,
    studentPhone: row.studentPhone ?? null, studentEmail: row.studentEmail ?? null,
    guardianName: row.guardianName ?? null, feeType: row.feeType,
    amount: totalAmount, dueDate: String(row.dueDate), status: row.status, stage,
  };

  for (const channel of channels) {
    let status: "sent" | "failed" = "failed";
    let errorMessage: string | undefined;
    let recipient: string | undefined;

    try {
      if (channel === "sms") {
        if (!c.msg91AuthKey)   { errorMessage = "Missing MSG91 Auth Key"; }
        else if (!c.msg91SenderId) { errorMessage = "Missing MSG91 Sender ID"; }
        else if (!fee.studentPhone) { errorMessage = "No phone number on student record"; }
        else {
          recipient = fee.studentPhone;
          await sendSms(c.msg91AuthKey, c.msg91SenderId, fee.studentPhone, getSmsText(tmap, stage, fee));
          status = "sent";
        }
      } else if (channel === "whatsapp") {
        if (!c.msg91AuthKey)     { errorMessage = "Missing MSG91 Auth Key"; }
        else if (!c.msg91WaNumber)  { errorMessage = "Missing WhatsApp Integrated Number"; }
        else if (!c.msg91WaTemplate){ errorMessage = "Missing WhatsApp Template Name"; }
        else if (!fee.studentPhone) { errorMessage = "No phone number on student record"; }
        else {
          recipient = fee.studentPhone;
          await sendWhatsapp(c.msg91AuthKey, c.msg91WaNumber, c.msg91WaTemplate, fee.studentPhone, fee, stage);
          status = "sent";
        }
      } else {
        const provider  = c.emailProvider ?? "sendgrid";
        const apiKey    = provider === "mailtrap" ? c.mailtrapApiKey : c.sendgridApiKey;
        const fromEmail = provider === "mailtrap"
          ? (c.sendgridFromEmail ?? "fees@school.local")
          : (c.sendgridFromEmail ?? "");
        if (!apiKey)    { errorMessage = `Missing ${provider === "mailtrap" ? "Mailtrap" : "SendGrid"} API Key`; }
        else if (!fromEmail || !fromEmail.includes("@")) {
          errorMessage = "Missing or invalid From Email — configure sendgridFromEmail in Notification Settings";
        }
        else if (!fee.studentEmail) { errorMessage = "No email address on student record"; }
        else {
          recipient = fee.studentEmail;
          await sendEmail(
            provider, apiKey, fromEmail, c.sendgridFromName || "School Admin",
            fee.studentEmail, fee.guardianName || fee.studentName,
            `${getEmailSubject(tmap, stage, fee)} — ${fee.studentName}`,
            getEmailBody(tmap, stage, fee), c.mailtrapInboxId,
          );
          status = "sent";
        }
      }
    } catch (err) {
      status = "failed";
      errorMessage = String(err);
    }

    await db.insert(dunningLog).values({
      schoolId, feeRecordId: fee.feeId, channel, stage,
      status: errorMessage && status === "failed" ? "failed" : status,
      errorMessage: errorMessage ?? null,
      recipient: recipient ?? null, studentName: fee.studentName,
    });

    if (status === "sent")       sent.push(channel);
    else if (errorMessage) skipped.push(`${channel}: ${errorMessage}`);
    else                       failed.push(channel);
  }

  return { sent, failed, skipped };
}

// ─── Per-school processing (real cron) ───────────────────────────────────────

/**
 * Process dunning for a single school. Called by runDunningJob (which wraps it
 * with the advisory lock guard) and exported for direct use in integration tests
 * that want to test business logic without the advisory lock layer.
 */
export async function processDunningForSchool(cfg: typeof notificationConfig.$inferSelect): Promise<void> {
  // Always scope to the active session — archived sessions never get reminders
  const activeSession = await db.select({ id: academicSessions.id })
    .from(academicSessions)
    .where(and(eq(academicSessions.schoolId, cfg.schoolId), eq(academicSessions.isActive, true)))
    .limit(1);
  const sessionId = activeSession[0]?.id ?? null;

  const rows = await fetchFeeRows(cfg.schoolId, ["Due", "Overdue"], sessionId);
  if (rows.length === 0) return;

  let tmap: TemplateMap = { sms: {}, email: {} };
  try { tmap = await loadTemplates(cfg.schoolId); } catch { /* use defaults */ }

  // Load all successfully sent records for this batch of fees.
  // Only "sent" rows count — "failed"/"simulated"/"skipped" do not block re-sending.
  const feeIds = rows.map(r => r.feeId);
  const existingLogs = await db
    .select({ feeRecordId: dunningLog.feeRecordId, channel: dunningLog.channel, stage: dunningLog.stage })
    .from(dunningLog)
    .where(and(
      eq(dunningLog.schoolId, cfg.schoolId),
      eq(dunningLog.status,   "sent"),
      inArray(dunningLog.feeRecordId, feeIds),
    ));
  const sentSet = new Set(existingLogs.map(l => `${l.feeRecordId}|${l.channel}|${l.stage}`));

  const channels: Channel[] = [];
  if (cfg.smsEnabled)   channels.push("sms");
  if (cfg.waEnabled)    channels.push("whatsapp");
  if (cfg.emailEnabled) channels.push("email");

  for (const row of rows) {
    // Use catch-up matching: fires the correct stage today OR recovers a stage
    // missed in the past CATCHUP_DAYS days that has not been successfully sent.
    const stage = getStageWithCatchup(String(row.dueDate));
    if (!stage) continue;

    const totalAmount = (row.amount ?? 0) + (row.lateFeeAmount ?? 0);
    const fee: FeeForDunning = {
      feeId:        row.feeId,        schoolId:     row.schoolId,
      studentId:    row.studentId,    studentName:  row.studentName,
      studentPhone: row.studentPhone  ?? null,
      studentEmail: row.studentEmail  ?? null,
      guardianName: row.guardianName  ?? null,
      feeType:      row.feeType,      amount:       totalAmount,
      dueDate:      String(row.dueDate), status:    row.status,  stage,
    };

    // ── Race-condition guard ─────────────────────────────────────────────────
    // Re-check status immediately before sending. The student may have paid
    // between the bulk SELECT and now.
    const freshRow = await db
      .select({ status: feeRecords.status })
      .from(feeRecords)
      .where(eq(feeRecords.id, fee.feeId))
      .limit(1);

    if (!freshRow[0]) {
      // Hard-deleted between SELECT and re-check — skip without log (FK would throw)
      log(`fee #${fee.feeId} (${fee.studentName}) deleted — skipping`);
      continue;
    }
    const freshStatus = freshRow[0].status;
    if (freshStatus === "Paid") {
      log(`fee #${fee.feeId} (${fee.studentName}) now ${freshStatus} — skipping`);
      for (const channel of channels) {
        const key = `${fee.feeId}|${channel}|${stage}`;
        if (sentSet.has(key)) continue;
        await db.insert(dunningLog).values({
          schoolId: cfg.schoolId, feeRecordId: fee.feeId, channel, stage,
          status: "skipped",
          errorMessage: `skipped — ${freshStatus.toLowerCase()} after job queued`,
          recipient: null, studentName: fee.studentName,
        });
      }
      continue;
    }
    // ────────────────────────────────────────────────────────────────────────

    for (const channel of channels) {
      const key = `${fee.feeId}|${channel}|${stage}`;
      if (sentSet.has(key)) continue;

      let status: "sent" | "failed" = "failed";
      let errorMessage: string | undefined;
      let recipient: string | undefined;

      try {
        if (channel === "sms") {
          if (!cfg.msg91AuthKey)    { errorMessage = "Missing MSG91 Auth Key"; }
          else if (!cfg.msg91SenderId) { errorMessage = "Missing MSG91 Sender ID"; }
          else if (!fee.studentPhone)  { errorMessage = "No phone number on student record"; }
          else {
            recipient = fee.studentPhone;
            await sendSms(cfg.msg91AuthKey, cfg.msg91SenderId, fee.studentPhone, getSmsText(tmap, stage, fee));
            status = "sent";
          }
        } else if (channel === "whatsapp") {
          if (!cfg.msg91AuthKey)      { errorMessage = "Missing MSG91 Auth Key"; }
          else if (!cfg.msg91WaNumber)   { errorMessage = "Missing WhatsApp Integrated Number"; }
          else if (!cfg.msg91WaTemplate) { errorMessage = "Missing WhatsApp Template Name"; }
          else if (!fee.studentPhone)    { errorMessage = "No phone number on student record"; }
          else {
            recipient = fee.studentPhone;
            await sendWhatsapp(cfg.msg91AuthKey, cfg.msg91WaNumber, cfg.msg91WaTemplate, fee.studentPhone, fee, stage);
            status = "sent";
          }
        } else {
          const provider  = cfg.emailProvider ?? "sendgrid";
          const apiKey    = provider === "mailtrap" ? cfg.mailtrapApiKey : cfg.sendgridApiKey;
          const fromEmail = provider === "mailtrap"
            ? (cfg.sendgridFromEmail ?? "fees@school.local")
            : (cfg.sendgridFromEmail ?? "");
          if (!apiKey)    { errorMessage = `Missing ${provider === "mailtrap" ? "Mailtrap" : "SendGrid"} API Key`; }
          else if (!fromEmail || !fromEmail.includes("@")) {
            errorMessage = "Missing or invalid From Email — configure sendgridFromEmail in Notification Settings";
          }
          else if (!fee.studentEmail) { errorMessage = "No email address on student record"; }
          else {
            recipient = fee.studentEmail;
            await sendEmail(
              provider, apiKey, fromEmail, cfg.sendgridFromName || "School Admin",
              fee.studentEmail, fee.guardianName || fee.studentName,
              `${getEmailSubject(tmap, stage, fee)} — ${fee.studentName}`,
              getEmailBody(tmap, stage, fee), cfg.mailtrapInboxId,
            );
            status = "sent";
          }
        }
      } catch (err) {
        status = "failed";
        errorMessage = String(err);
      }

      await db.insert(dunningLog).values({
        schoolId:    cfg.schoolId,
        feeRecordId: fee.feeId,
        channel, stage, status,
        errorMessage: errorMessage ?? null,
        recipient:    recipient    ?? null,
        studentName:  fee.studentName,
      });

      if (status === "sent") {
        sentSet.add(key);
        log(`${channel} ${stage} → ${fee.studentName} (#${fee.feeId}) sent`);
      } else {
        log(`${channel} ${stage} → ${fee.studentName} FAILED: ${errorMessage}`);
      }
    }
  }
}
