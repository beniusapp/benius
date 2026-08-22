/**
 * server/financial-analytics-data.ts
 *
 * Canonical server-side Financial Analytics data service.
 *
 * Produces a single structured dataset for a school + academic session
 * across presets: today, this_week, this_month, academic_year, and custom.
 *
 * Design decisions
 * ────────────────
 * 1. Timezone: All calendar calculations use Asia/Kolkata (IST, UTC+5:30).
 * 2. Invoice population: fee_records.session_id scopes to the selected session;
 *    all subqueries also constrain school_id.
 * 3. Billed = invoices whose due_date is in the selected period.
 * 4. Revenue (grossCollected) = payment_records.received_date in period.
 *    Only successful persisted payments are revenue — no payment_attempts.
 * 5. Outstanding: for invoices due in range, lifetime payments are used (not
 *    just period payments).
 * 6. Online = razorpay_payment_id present OR method is Portal Payment/Online.
 *    Offline = everything else.
 * 7. Denominations: only Cash payment_records in range with strict positive
 *    integer keys and positive integer quantities in denomination_breakdown.
 *    Keys must be pure digit strings — "500foo" is rejected.
 * 8. Prior comparison: only when an equal-length preceding period fits within
 *    the same academic session.
 * 9. payment_attempts are used only for status counts. Each attempt is
 *     included only when its outcome-specific lifecycle timestamp falls within
 *     the IST calendar range (not any timestamp on the row).
 * 10. Online methods show the persisted payment_mode instrument when present,
 *     falling back to "Portal Payment". Offline methods use normalised labels.
 * 11. Historical online payment_records without an attempt (no rzp_payment_id
 *     in payment_attempts) appear in online statuses as "captured". They are
 *     identified by having a razorpay_payment_id on the payment_record itself.
 *     Only those not already represented by a payment_attempt are included.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import { normalizePaymentMethod } from "@shared/payment-method";
import {
  SCHOOL_TIME_ZONE,
  todayInIST,
  addCalendarDays,
  calendarWeekday,
} from "@shared/ist-time";

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Analytics timezone. Re-exported from the shared IST-time policy so the
 * Asia/Kolkata constant lives in exactly one place. Preserved as a public
 * export for existing callers and the filter.timezone contract.
 */
export const ANALYTICS_TZ = SCHOOL_TIME_ZONE;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Pure positive-integer denomination key: only digit characters, no leading
 *  zeros unless the whole value is "0" (which we exclude by the >0 check). */
const DENOM_KEY_RE = /^\d+$/;
const MAX_CUSTOM_DAYS = 5 * 366; // 5 years

// ── Public types ───────────────────────────────────────────────────────────────

export type FinancialPreset = "today" | "this_week" | "this_month" | "academic_year" | "custom";

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface FinancialAnalyticsParams {
  schoolId: number;
  sessionId: number;
  preset: FinancialPreset;
  customStart?: string;
  customEnd?: string;
}

export interface FinancialSummary {
  billed: number;
  grossCollected: number;
  netCollected: number;
  outstanding: number;
  /** Net collected ÷ invoices due in the selected period; null when no invoice is due. */
  collectionEfficiency: number | null;
  onlineCollected: number;
  offlineCollected: number;
  overdueAmount: number;
  transactionCount: number;
  totalLatePenalties: number;
}

export interface ComparisonSummary {
  billed: number;
  grossCollected: number;
  netCollected: number;
  billedChange: number | null;
  grossCollectedChange: number | null;
  netCollectedChange: number | null;
}

export interface TrendPoint {
  key: string;
  label: string;
  startDate: string;
  billed: number;
  grossCollected: number;
  netCollected: number;
}

export interface ChannelBreakdown {
  grossCollected: number;
  netCollected: number;
  transactionCount: number;
  averageTransaction: number;
  statuses: Array<{ status: string; count: number; amount: number }>;
  methods: Array<{ method: string; count: number; amount: number }>;
}

export interface ClassWiseRow {
  class: string;
  billed: number;
  grossCollected: number;
  netCollected: number;
  outstanding: number;
}

export interface FeeCategoryRow {
  feeType: string;
  billed: number;
  grossCollected: number;
  netCollected: number;
  outstanding: number;
}

export interface AgingBucket {
  bucket: "1-30" | "31-60" | "61-90" | "90+";
  count: number;
  amount: number;
}

export interface CashDenominations {
  cashCollected: number;
  cashPaymentCount: number;
  withBreakdownCount: number;
  withoutBreakdownCount: number;
  documentedAmount: number;
  denominations: Array<{ denomination: number; quantity: number; total: number }>;
}

export interface SessionInfo {
  id: number;
  sessionName: string;
  startDate: string;
  endDate: string;
}

export interface FilterInfo {
  preset: FinancialPreset;
  startDate: string;
  endDate: string;
  label: string;
  timezone: string;
  comparison: DateRange | null;
}

/**
 * Explicitly documents the record and date authority for every headline
 * metric. Consumers must not infer that receipts and due-period demand share
 * the same date basis.
 */
export interface FinancialAnalyticsAccountingBasis {
  timezone: "Asia/Kolkata";
  billed: {
    label: "Due this period";
    recordAuthority: "fee_records";
    dateAuthority: "due_date";
    description: string;
  };
  grossCollected: {
    label: "Gross collected";
    recordAuthority: "payment_records";
    dateAuthority: "received_date";
    description: string;
  };
  netCollected: { label: "Net collected"; description: string };
  outstanding: { label: "Outstanding"; description: string };
  collectionEfficiency: { label: "Collection efficiency"; description: string };
}

export interface FinancialAnalyticsResult {
  generatedAt: string;
  sessionInfo: SessionInfo;
  filter: FilterInfo;
  accountingBasis: FinancialAnalyticsAccountingBasis;
  summary: FinancialSummary;
  comparison: ComparisonSummary | null;
  trend: TrendPoint[];
  online: ChannelBreakdown;
  offline: ChannelBreakdown;
  classWise: ClassWiseRow[];
  feeCategories: FeeCategoryRow[];
  aging: AgingBucket[];
  cashDenominations: CashDenominations;
}

const FINANCIAL_ANALYTICS_ACCOUNTING_BASIS: FinancialAnalyticsAccountingBasis = {
  timezone: "Asia/Kolkata",
  billed: {
    label: "Due this period",
    recordAuthority: "fee_records",
    dateAuthority: "due_date",
    description: "Invoices whose due date falls in the selected IST date range.",
  },
  grossCollected: {
    label: "Gross collected",
    recordAuthority: "payment_records",
    dateAuthority: "received_date",
    description: "Successful recorded payments received in the selected IST date range.",
  },
  netCollected: {
    label: "Net collected",
    description: "The same successful payment total reported as gross collected.",
  },
  outstanding: {
    label: "Outstanding",
    description: "Lifetime unpaid balance of invoices due in the selected IST date range, after successful payments.",
  },
  collectionEfficiency: {
    label: "Collection efficiency",
    description: "Net collected divided by due-this-period demand; not applicable when no invoices are due in the selected range.",
  },
};

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Returns true only when `s` is a YYYY-MM-DD string that represents a real
 * calendar date. Impossible dates like 2024-02-31 are rejected via round-trip
 * check: we parse into UTC midnight, format back with en-CA (which gives
 * YYYY-MM-DD) and require an exact match against the original input.
 */
export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) return false;
  // Round-trip: if JS normalised the date (e.g. Feb 31 → Mar 2), the
  // formatted result will differ from the input.
  const roundTrip = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  return roundTrip === s;
}

// ── IST date helpers ───────────────────────────────────────────────────────────

/**
 * Returns the current date in Asia/Kolkata as a YYYY-MM-DD string.
 * Delegates to the shared IST-time policy.
 */
export function todayIST(): string {
  return todayInIST();
}

/**
 * Returns the day-of-week (0=Sun … 6=Sat) for a YYYY-MM-DD string, treated
 * as a host-independent calendar date. Delegates to the shared helper.
 */
function dayOfWeek(date: string): number {
  return calendarWeekday(date) ?? new Date(date + "T00:00:00Z").getUTCDay();
}

/**
 * Adds `n` days to a YYYY-MM-DD string (n may be negative). Host-independent
 * calendar arithmetic via the shared helper.
 */
export function addDays(date: string, n: number): string {
  return addCalendarDays(date, n);
}

/**
 * Returns the calendar-day difference (end − start) between two YYYY-MM-DD
 * strings. Same-day → 0; one day apart → 1.
 */
export function daysBetween(start: string, end: string): number {
  const a = new Date(start + "T00:00:00Z").getTime();
  const b = new Date(end + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * First day of the ISO week (Monday) containing a given YYYY-MM-DD date.
 */
function startOfISOWeek(date: string): string {
  const dow = dayOfWeek(date); // 0=Sun
  const isoDay = dow === 0 ? 7 : dow;
  return addDays(date, -(isoDay - 1));
}

/**
 * First day of the month for a YYYY-MM-DD date.
 */
function startOfMonth(date: string): string {
  return date.slice(0, 7) + "-01";
}

/**
 * Last day of the month for a YYYY-MM-DD date.
 */
function endOfMonth(date: string): string {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month!).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

// ── Human-friendly label helpers ───────────────────────────────────────────────

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Returns a human-friendly daily label, e.g. "01 Apr" from "2024-04-01".
 */
export function dailyLabel(dateStr: string): string {
  const [, mm, dd] = dateStr.split("-");
  const monthIdx = parseInt(mm!, 10) - 1;
  return `${dd} ${MONTH_SHORT[monthIdx] ?? mm}`;
}

/**
 * Returns a human-friendly monthly label, e.g. "Apr 24" from "2024-04".
 */
export function monthlyLabel(ym: string): string {
  const [yyyy, mm] = ym.split("-");
  const monthIdx = parseInt(mm!, 10) - 1;
  const shortYear = String(parseInt(yyyy!, 10)).slice(-2).padStart(2, "0");
  return `${MONTH_SHORT[monthIdx] ?? mm} ${shortYear}`;
}

// ── Period resolution ──────────────────────────────────────────────────────────

export interface ResolvedPeriod {
  startDate: string;
  endDate: string;
  label: string;
  comparison: DateRange | null;
}

/**
 * Resolves the calendar date range and optional comparison window for a preset,
 * constrained by the academic session bounds for academic_year preset.
 *
 * @param preset       One of the five supported presets.
 * @param session      The academic session (provides bounds for academic_year).
 * @param customStart  Required for 'custom' preset (YYYY-MM-DD).
 * @param customEnd    Required for 'custom' preset (YYYY-MM-DD).
 */
export function resolvePeriod(
  preset: FinancialPreset,
  session: SessionInfo,
  customStart?: string,
  customEnd?: string,
): ResolvedPeriod {
  const today = todayIST();

  let start: string;
  let end: string;
  let label: string;

  switch (preset) {
    case "today": {
      start = today;
      end = today;
      label = "Today";
      break;
    }
    case "this_week": {
      start = startOfISOWeek(today);
      end = addDays(start, 6);
      label = "This Week";
      break;
    }
    case "this_month": {
      start = startOfMonth(today);
      end = endOfMonth(today);
      label = "This Month";
      break;
    }
    case "academic_year": {
      start = session.startDate;
      end = session.endDate;
      label = `Academic Year ${session.sessionName}`;
      break;
    }
    case "custom": {
      if (!customStart || !customEnd) {
        throw new Error("customStart and customEnd are required for custom preset");
      }
      if (!isValidDate(customStart) || !isValidDate(customEnd)) {
        throw new Error("Invalid date format: expected YYYY-MM-DD");
      }
      if (customStart > customEnd) {
        throw new Error("customStart must be <= customEnd");
      }
      const spanDays = daysBetween(customStart, customEnd) + 1;
      if (spanDays > MAX_CUSTOM_DAYS) {
        throw new Error(`Custom range may not exceed 5 years (${MAX_CUSTOM_DAYS} days)`);
      }
      start = customStart;
      end = customEnd;
      label = `${start} – ${end}`;
      break;
    }
    default: {
      const _exhaustive: never = preset;
      throw new Error(`Unknown preset: ${_exhaustive}`);
    }
  }

  // Prior comparison: equal-length period immediately before `start`, but only
  // if BOTH the selected range AND the prior range are fully contained within
  // the same academic session.  An out-of-session selected range (e.g. a custom
  // window that straddles the session boundary) suppresses comparison rather
  // than throwing; callers may still query data — they just get no change %.
  const spanDays = daysBetween(start, end) + 1; // inclusive day count
  const priorEnd = addDays(start, -1);
  const priorStart = addDays(priorEnd, -(spanDays - 1));

  const selectedInSession =
    start >= session.startDate && end <= session.endDate;
  const priorInSession =
    priorStart >= session.startDate && priorEnd <= session.endDate;

  const comparison: DateRange | null =
    selectedInSession && priorInSession
      ? { startDate: priorStart, endDate: priorEnd }
      : null;

  return { startDate: start, endDate: end, label, comparison };
}

// ── Channel classification ─────────────────────────────────────────────────────

/**
 * Returns true when a payment record row represents an online (Portal) payment.
 * A record is online if it has a razorpay_payment_id OR its normalised method
 * is Portal Payment.
 */
export function isOnlinePayment(
  method: string | null | undefined,
  razorpayPaymentId: string | null | undefined,
): boolean {
  if (razorpayPaymentId) return true;
  const norm = normalizePaymentMethod(method);
  return norm === "Portal Payment";
}

/**
 * Returns the friendly online method label for a payment record row.
 * Uses the persisted payment_mode (upi → "UPI", card → "Card",
 * netbanking → "Net Banking", wallet → "Wallet", emi → "EMI") when present;
 * falls back to "Portal Payment".
 */
export function onlineMethodLabel(
  paymentMode: string | null | undefined,
): string {
  if (!paymentMode) return "Portal Payment";
  switch (paymentMode.toLowerCase()) {
    case "upi":        return "UPI";
    case "card":       return "Card";
    case "netbanking": return "Net Banking";
    case "wallet":     return "Wallet";
    case "emi":        return "EMI";
    default:           return paymentMode; // preserve unknown but real values
  }
}

/**
 * Returns the normalised friendly label for an offline payment method.
 * Preserves canonical labels (Cash, Cheque, BankTransfer, etc.) as
 * evidence-based display values.
 */
export function offlineMethodLabel(method: string | null | undefined): string {
  if (!method) return "Unknown";
  // Canonical offline method names as stored
  switch (method) {
    case "Cash":          return "Cash";
    case "Cheque":        return "Cheque";
    case "BankTransfer":  return "Bank Transfer";
    case "DemandDraft":   return "Demand Draft";
    case "UpiQr":         return "UPI / QR";
    default:              return method; // pass through unknown stored values verbatim
  }
}

// ── IST calendar range check for a UTC timestamp column ───────────────────────

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Build the complete Financial Analytics dataset for a given school, session,
 * and time preset.
 */
export async function buildFinancialAnalytics(
  params: FinancialAnalyticsParams,
): Promise<FinancialAnalyticsResult> {
  const { schoolId, sessionId, preset, customStart, customEnd } = params;

  // ── Step 1: load and validate session ───────────────────────────────────────
  const sessionResult = await db.execute(sql`
    SELECT id, session_name, start_date, end_date
    FROM academic_sessions
    WHERE id = ${sessionId} AND school_id = ${schoolId}
    LIMIT 1
  `);

  if (sessionResult.rows.length === 0) {
    throw new Error(`Session ${sessionId} not found for school ${schoolId}`);
  }

  const sr = sessionResult.rows[0] as any;
  const sessionInfo: SessionInfo = {
    id: Number(sr.id),
    sessionName: String(sr.session_name),
    startDate: String(sr.start_date).slice(0, 10),
    endDate: String(sr.end_date).slice(0, 10),
  };

  // ── Step 2: resolve period ───────────────────────────────────────────────────
  const period = resolvePeriod(preset, sessionInfo, customStart, customEnd);
  const { startDate, endDate } = period;
  const comparisonRange = period.comparison;

  const filter: FilterInfo = {
    preset,
    startDate,
    endDate,
    label: period.label,
    timezone: ANALYTICS_TZ,
    comparison: comparisonRange,
  };

  const today = todayIST();

  // ── Step 3: Fetch billed invoices (due_date in period, session-scoped) ───────
  // Also fetch lifetime payment data per invoice for outstanding calculation.
  const billedResult = await db.execute(sql`
    SELECT
      fr.id,
      fr.fee_type,
      fr.amount,
      fr.late_fee_amount,
      fr.due_date,
      fr.status,
      fr.student_id,
      s.class AS student_class,
      -- lifetime successful payments for this invoice
      COALESCE((
        SELECT SUM(pr2.amount)
        FROM payment_records pr2
        WHERE pr2.fee_record_id = fr.id
          AND pr2.school_id = ${schoolId}
      ), 0) AS lifetime_paid
    FROM fee_records fr
    JOIN students s ON s.id = fr.student_id AND s.school_id = ${schoolId}
    WHERE fr.school_id = ${schoolId}
      AND fr.session_id = ${sessionId}
      AND fr.due_date >= ${startDate}
      AND fr.due_date <= ${endDate}
  `);

  // ── Step 4: Fetch revenue payments (received_date in period, session-scoped) ─
  const paymentsResult = await db.execute(sql`
    SELECT
      pr.id,
      pr.amount,
      pr.late_fee_paid,
      pr.payment_method,
      pr.razorpay_payment_id,
      pr.payment_mode,
      pr.received_date,
      pr.created_at,
      -- IST wall-clock hour (0-23) of created_at, computed in Postgres so
      -- hourly bucketing never re-derives the offset host-side.
      -- payment_records.created_at is timestamp WITHOUT time zone whose stored
      -- wall clock is UTC by this app convention. The two-step conversion first
      -- reads the naive value AS UTC (yielding a timestamptz instant) and then
      -- renders it in Asia/Kolkata. A single AT TIME ZONE Asia/Kolkata on a
      -- naive column would instead interpret the value as local IST, which is
      -- wrong and depends on the DB session TimeZone.
      EXTRACT(HOUR FROM
        (pr.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
      )::int AS created_hour_ist,
      pr.denomination_breakdown,
      -- True when this payment_record is backed by a payment_attempt row
      -- (regardless of whether that attempt falls inside the selected range).
      -- payment_attempts has no payment_record_id column, so the authoritative
      -- link is the shared non-null razorpay_payment_id, school-scoped.
      EXISTS (
        SELECT 1
        FROM payment_attempts pa
        WHERE pa.school_id = ${schoolId}
          AND pr.razorpay_payment_id IS NOT NULL
          AND pa.razorpay_payment_id = pr.razorpay_payment_id
      ) AS has_payment_attempt,
      fr.id           AS fee_record_id,
      fr.fee_type     AS fee_type,
      s.class         AS student_class
    FROM payment_records pr
    JOIN fee_records fr ON fr.id = pr.fee_record_id
                        AND fr.school_id = ${schoolId}
                        AND fr.session_id = ${sessionId}
    JOIN students s ON s.id = pr.student_id AND s.school_id = ${schoolId}
    WHERE pr.school_id    = ${schoolId}
      AND pr.received_date >= ${startDate}
      AND pr.received_date <= ${endDate}
  `);

  // ── Step 5: payment_attempts — status counts only, NOT revenue ────────────────
  // Each attempt is included only when its outcome-specific lifecycle timestamp
  // (converted to IST calendar date) falls within [startDate, endDate]:
  //   captured          → rzp_captured_at    fallback created_at
  //   authorized        → rzp_authorized_at  fallback created_at
  //   failed            → rzp_failed_at      fallback created_at
  //   refunded /
  //   partially_refunded → updated_at        fallback created_at
  //   cancelled / pending → created_at
  // This prevents a captured attempt whose captured_at is outside the range
  // from being included just because created_at is inside.
  const attemptsResult = await db.execute(sql`
    SELECT
      pa.id         AS attempt_id,
      pa.outcome,
      pa.razorpay_payment_id,
      pa.amount_paise,
      -- Derive the single authoritative status_at timestamp for this outcome
      CASE pa.outcome
        WHEN 'captured'           THEN COALESCE(pa.rzp_captured_at,   pa.created_at)
        WHEN 'authorized'         THEN COALESCE(pa.rzp_authorized_at, pa.created_at)
        WHEN 'failed'             THEN COALESCE(pa.rzp_failed_at,     pa.created_at)
        WHEN 'refunded'           THEN COALESCE(pa.updated_at,        pa.created_at)
        WHEN 'partially_refunded' THEN COALESCE(pa.updated_at,        pa.created_at)
        ELSE pa.created_at
      END AS status_at
    FROM payment_attempts pa
    JOIN fee_records fr ON fr.id = pa.fee_record_id
                        AND fr.school_id = ${schoolId}
                        AND fr.session_id = ${sessionId}
    WHERE pa.school_id = ${schoolId}
      -- Filter: the outcome-derived status_at must land in IST calendar range
      AND (
        CASE pa.outcome
          WHEN 'captured'           THEN COALESCE(pa.rzp_captured_at,   pa.created_at)
          WHEN 'authorized'         THEN COALESCE(pa.rzp_authorized_at, pa.created_at)
          WHEN 'failed'             THEN COALESCE(pa.rzp_failed_at,     pa.created_at)
          WHEN 'refunded'           THEN COALESCE(pa.updated_at,        pa.created_at)
          WHEN 'partially_refunded' THEN COALESCE(pa.updated_at,        pa.created_at)
          ELSE pa.created_at
        END
      ) AT TIME ZONE 'Asia/Kolkata' BETWEEN
        ${startDate}::date AND (${endDate}::date + INTERVAL '1 day' - INTERVAL '1 second')
  `);

  // ── Step 6: Comparison period data (if applicable) ────────────────────────────
  let compPayments: any[] = [];
  let compBilled: any[] = [];

  if (comparisonRange) {
    const cs = comparisonRange.startDate;
    const ce = comparisonRange.endDate;

    const cbResult = await db.execute(sql`
      SELECT fr.amount, fr.late_fee_amount
      FROM fee_records fr
      WHERE fr.school_id  = ${schoolId}
        AND fr.session_id = ${sessionId}
        AND fr.due_date >= ${cs}
        AND fr.due_date <= ${ce}
    `);
    compBilled = cbResult.rows as any[];

    const cpResult = await db.execute(sql`
      SELECT pr.amount
      FROM payment_records pr
      JOIN fee_records fr ON fr.id = pr.fee_record_id
                          AND fr.school_id = ${schoolId}
                          AND fr.session_id = ${sessionId}
      WHERE pr.school_id    = ${schoolId}
        AND pr.received_date >= ${cs}
        AND pr.received_date <= ${ce}
    `);
    compPayments = cpResult.rows as any[];

  }

  // ── Aggregate ──────────────────────────────────────────────────────────────────

  const billedRows   = billedResult.rows   as any[];
  const paymentRows  = paymentsResult.rows as any[];
  const attemptRows  = attemptsResult.rows as any[];

  // ── Billed invoice aggregation ────────────────────────────────────────────────
  let totalBilled    = 0;
  let totalOutstanding = 0;
  let totalOverdue   = 0;

  const classBilled  = new Map<string, { billed: number; outstanding: number }>();
  const catBilled    = new Map<string, { billed: number; outstanding: number }>();
  const agingRaw: Array<{ daysOverdue: number; outstanding: number }> = [];

  for (const row of billedRows) {
    const billed        = Number(row.amount) + Number(row.late_fee_amount ?? 0);
    const lifetimePaid  = Number(row.lifetime_paid   ?? 0);
    const unpaid        = Math.max(0, billed - lifetimePaid);

    totalBilled      += billed;
    totalOutstanding += unpaid;

    const cls = String(row.student_class ?? "Unknown");
    const cat = String(row.fee_type      ?? "Unknown");

    const cbEntry = classBilled.get(cls) ?? { billed: 0, outstanding: 0 };
    cbEntry.billed      += billed;
    cbEntry.outstanding += unpaid;
    classBilled.set(cls, cbEntry);

    const catEntry = catBilled.get(cat) ?? { billed: 0, outstanding: 0 };
    catEntry.billed      += billed;
    catEntry.outstanding += unpaid;
    catBilled.set(cat, catEntry);

    const dueDate = String(row.due_date).slice(0, 10);
    if (unpaid > 0 && dueDate < today) {
      totalOverdue += unpaid;
      const daysOverdue = daysBetween(dueDate, today);
      agingRaw.push({ daysOverdue, outstanding: unpaid });
    }
  }

  // ── Revenue payment aggregation ───────────────────────────────────────────────
  let grossCollected   = 0;
  let onlineGross      = 0;
  let offlineGross     = 0;
  let transactionCount = 0;
  let onlineCount      = 0;
  let offlineCount     = 0;
  let totalLatePenalties = 0;

  const classRevenue = new Map<string, number>();
  const catRevenue   = new Map<string, number>();

  // method label → {count, amount}
  const onlineMethods  = new Map<string, { count: number; amount: number }>();
  const offlineMethods = new Map<string, { count: number; amount: number }>();

  // Cash denomination state
  let cashCollected      = 0;
  let cashPaymentCount   = 0;
  let cashWithBreakdown  = 0;
  let cashWithoutBreakdown = 0;
  let cashDocumentedAmount = 0;
  const denomAgg = new Map<number, number>(); // denomination value → total quantity

  for (const row of paymentRows) {
    const amount  = Number(row.amount  ?? 0);
    const lateFee = Number(row.late_fee_paid ?? 0);
    const method  = String(row.payment_method ?? "");
    const rzpId   = row.razorpay_payment_id ? String(row.razorpay_payment_id) : null;
    const online  = isOnlinePayment(method, rzpId);
    const cls     = String(row.student_class ?? "Unknown");
    const cat     = String(row.fee_type      ?? "Unknown");

    grossCollected   += amount;
    transactionCount += 1;
    totalLatePenalties += lateFee;

    if (online) {
      onlineGross  += amount;
      onlineCount  += 1;
      // Use payment_mode instrument when available, else "Portal Payment"
      const mLabel = onlineMethodLabel(row.payment_mode);
      const om = onlineMethods.get(mLabel) ?? { count: 0, amount: 0 };
      om.count  += 1; om.amount += amount;
      onlineMethods.set(mLabel, om);
    } else {
      offlineGross += amount;
      offlineCount += 1;
      const mLabel = offlineMethodLabel(method);
      const om = offlineMethods.get(mLabel) ?? { count: 0, amount: 0 };
      om.count  += 1; om.amount += amount;
      offlineMethods.set(mLabel, om);
    }

    classRevenue.set(cls, (classRevenue.get(cls) ?? 0) + amount);
    catRevenue.set(cat, (catRevenue.get(cat) ?? 0) + amount);

    // Cash denominations
    if (method === "Cash") {
      cashCollected    += amount;
      cashPaymentCount += 1;
      const breakdown = row.denomination_breakdown;
      let hasValidBreakdown = false;
      if (breakdown && typeof breakdown === "object" && !Array.isArray(breakdown)) {
        let docAmount = 0;
        for (const [denom, qty] of Object.entries(breakdown as Record<string, unknown>)) {
          // Strict key validation: must be a pure digit string (no trailing
          // text like "500foo"). parseInt alone would accept "500foo" = 500.
          if (!DENOM_KEY_RE.test(denom)) continue;
          const denomNum = parseInt(denom, 10);
          // qty may arrive as number or numeric string from JSONB
          const qtyRaw = typeof qty === "number" ? qty : Number(qty);
          const qtyNum = Number.isInteger(qtyRaw) ? qtyRaw : Math.trunc(qtyRaw);
          if (
            Number.isFinite(denomNum) && denomNum > 0 &&
            Number.isInteger(qtyNum)  && qtyNum  > 0
          ) {
            const existing = denomAgg.get(denomNum) ?? 0;
            denomAgg.set(denomNum, existing + qtyNum);
            docAmount += denomNum * qtyNum;
            hasValidBreakdown = true;
          }
        }
        if (hasValidBreakdown) {
          cashWithBreakdown    += 1;
          cashDocumentedAmount += docAmount;
        } else {
          cashWithoutBreakdown += 1;
        }
      } else {
        cashWithoutBreakdown += 1;
      }
    }
  }

  const netCollected = grossCollected;

  const collectionEfficiency = totalBilled > 0
    ? Math.round((netCollected / totalBilled) * 1000) / 10
    : null;

  // ── Online/offline status counts ──────────────────────────────────────────────
  // payment_attempts (online statuses, deduplicated by razorpay_payment_id)
  const onlineStatuses = new Map<string, { count: number; amount: number }>();
  const seenRzpAttempts = new Set<string>();
  const seenAttemptIds  = new Set<number>();

  for (const row of attemptRows) {
    const rzpId     = row.razorpay_payment_id ? String(row.razorpay_payment_id) : null;
    const attemptId = Number(row.attempt_id);

    if (rzpId) {
      if (seenRzpAttempts.has(rzpId)) continue;
      seenRzpAttempts.add(rzpId);
    } else {
      if (seenAttemptIds.has(attemptId)) continue;
      seenAttemptIds.add(attemptId);
    }

    const outcome   = String(row.outcome ?? "pending");
    const amountINR = Number(row.amount_paise ?? 0) / 100;
    const status    = mapAttemptStatus(outcome);

    const bucket = onlineStatuses.get(status) ?? { count: 0, amount: 0 };
    bucket.count  += 1;
    bucket.amount += amountINR;
    onlineStatuses.set(status, bucket);
  }

  // Historical online payment_records not backed by any payment_attempt row:
  // legacy "captured" records. These are identified by has_payment_attempt =
  // false — an EXISTS check that matches a payment_attempt sharing this PR's
  // razorpay_payment_id regardless of whether that attempt falls inside the
  // selected range. This avoids the earlier bug where a PR in range whose
  // linked captured attempt lands OUTSIDE the range was wrongly re-counted as
  // a fallback "captured" (because attemptRzpIds only tracked in-range attempts).
  //
  // Legacy Portal Payment records without a razorpay_payment_id are also
  // included here (has_payment_attempt is false for them). Dedup is by the
  // payment_record id so each PR contributes at most once.
  const seenFallbackPrIds = new Set<number>();
  for (const row of paymentRows) {
    const prId   = Number(row.id);
    const rzpId  = row.razorpay_payment_id ? String(row.razorpay_payment_id) : null;
    const online = isOnlinePayment(String(row.payment_method ?? ""), rzpId);
    const hasAttempt = row.has_payment_attempt === true;
    if (online && !hasAttempt && !seenFallbackPrIds.has(prId)) {
      // Historical/legacy online PR not covered by any attempt at all.
      seenFallbackPrIds.add(prId);
      const bucket = onlineStatuses.get("captured") ?? { count: 0, amount: 0 };
      bucket.count  += 1;
      bucket.amount += Number(row.amount ?? 0);
      onlineStatuses.set("captured", bucket);
    }
  }

  // Offline statuses: all offline payment_records in period.
  // Use the normalised method as the status label (evidence-based, not "captured").
  const offlineStatuses = new Map<string, { count: number; amount: number }>();
  for (const row of paymentRows) {
    const rzpId  = row.razorpay_payment_id ? String(row.razorpay_payment_id) : null;
    const online = isOnlinePayment(String(row.payment_method ?? ""), rzpId);
    if (!online) {
      const statusLabel = offlineMethodLabel(row.payment_method);
      const existing = offlineStatuses.get(statusLabel) ?? { count: 0, amount: 0 };
      existing.count  += 1;
      existing.amount += Number(row.amount ?? 0);
      offlineStatuses.set(statusLabel, existing);
    }
  }

  // ── Build channel breakdown objects ───────────────────────────────────────────
  const onlineNetCollected  = onlineGross;
  const offlineNetCollected = offlineGross;

  const onlineBreakdown: ChannelBreakdown = {
    grossCollected:   onlineGross,
    netCollected:     onlineNetCollected,
    transactionCount: onlineCount,
    averageTransaction: onlineCount > 0
      ? Math.round((onlineGross / onlineCount) * 100) / 100
      : 0,
    statuses: [...onlineStatuses.entries()].map(([status, v]) => ({ status, ...v }))
      .sort((a, b) => b.count - a.count),
    methods: [...onlineMethods.entries()].map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.amount - a.amount),
  };

  const offlineBreakdown: ChannelBreakdown = {
    grossCollected:   offlineGross,
    netCollected:     offlineNetCollected,
    transactionCount: offlineCount,
    averageTransaction: offlineCount > 0
      ? Math.round((offlineGross / offlineCount) * 100) / 100
      : 0,
    statuses: [...offlineStatuses.entries()].map(([status, v]) => ({ status, ...v }))
      .sort((a, b) => b.count - a.count),
    methods: [...offlineMethods.entries()].map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.amount - a.amount),
  };

  // ── Class-wise breakdown ──────────────────────────────────────────────────────
  const allClasses = new Set([...classBilled.keys(), ...classRevenue.keys()]);
  const classWise: ClassWiseRow[] = [];
  for (const cls of [...allClasses].sort()) {
    const b = classBilled.get(cls)  ?? { billed: 0, outstanding: 0 };
    const collected = classRevenue.get(cls) ?? 0;
    classWise.push({
      class:          cls,
      billed:         b.billed,
      grossCollected: collected,
      netCollected:   collected,
      outstanding:    b.outstanding,
    });
  }

  // ── Fee category breakdown ────────────────────────────────────────────────────
  const allCats = new Set([...catBilled.keys(), ...catRevenue.keys()]);
  const feeCategories: FeeCategoryRow[] = [];
  for (const cat of [...allCats].sort()) {
    const b = catBilled.get(cat)  ?? { billed: 0, outstanding: 0 };
    const collected = catRevenue.get(cat) ?? 0;
    feeCategories.push({
      feeType:        cat,
      billed:         b.billed,
      grossCollected: collected,
      netCollected:   collected,
      outstanding:    b.outstanding,
    });
  }

  // ── Aging buckets ─────────────────────────────────────────────────────────────
  const agingBuckets: Record<string, { count: number; amount: number }> = {
    "1-30":  { count: 0, amount: 0 },
    "31-60": { count: 0, amount: 0 },
    "61-90": { count: 0, amount: 0 },
    "90+":   { count: 0, amount: 0 },
  };

  for (const { daysOverdue, outstanding } of agingRaw) {
    let bucket: string;
    if      (daysOverdue <=  30) bucket = "1-30";
    else if (daysOverdue <=  60) bucket = "31-60";
    else if (daysOverdue <=  90) bucket = "61-90";
    else                         bucket = "90+";
    agingBuckets[bucket]!.count  += 1;
    agingBuckets[bucket]!.amount += outstanding;
  }

  const aging: AgingBucket[] = (["1-30", "31-60", "61-90", "90+"] as const).map((bucket) => ({
    bucket,
    count:  agingBuckets[bucket]!.count,
    amount: agingBuckets[bucket]!.amount,
  }));

  // ── Denomination summary ──────────────────────────────────────────────────────
  const denomList = [...denomAgg.entries()]
    .map(([denomination, quantity]) => ({
      denomination,
      quantity,
      total: denomination * quantity,
    }))
    .sort((a, b) => b.denomination - a.denomination);

  const cashDenominations: CashDenominations = {
    cashCollected,
    cashPaymentCount,
    withBreakdownCount:    cashWithBreakdown,
    withoutBreakdownCount: cashWithoutBreakdown,
    documentedAmount:      cashDocumentedAmount,
    denominations:         denomList,
  };

  // ── Trend ─────────────────────────────────────────────────────────────────────
  const trend = buildTrend(preset, startDate, endDate, billedRows, paymentRows);

  // ── Summary ───────────────────────────────────────────────────────────────────
  const summary: FinancialSummary = {
    billed:             totalBilled,
    grossCollected,
    netCollected,
    outstanding:        totalOutstanding,
    collectionEfficiency,
    onlineCollected:    onlineGross,
    offlineCollected:   offlineGross,
    overdueAmount:      totalOverdue,
    transactionCount,
    totalLatePenalties,
  };

  // ── Comparison ────────────────────────────────────────────────────────────────
  let comparison: ComparisonSummary | null = null;
  if (comparisonRange) {
    const cBilled  = compBilled.reduce(
      (acc, r) => acc + Number(r.amount ?? 0) + Number(r.late_fee_amount ?? 0), 0,
    );
    const cGross   = compPayments.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
    const cNet     = cGross;

    comparison = {
      billed:              cBilled,
      grossCollected:      cGross,
      netCollected:        cNet,
      billedChange:        pctChange(cBilled,  totalBilled),
      grossCollectedChange: pctChange(cGross,  grossCollected),
      netCollectedChange:  pctChange(cNet,     netCollected),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    sessionInfo,
    filter,
    accountingBasis: FINANCIAL_ANALYTICS_ACCOUNTING_BASIS,
    summary,
    comparison,
    trend,
    online:  onlineBreakdown,
    offline: offlineBreakdown,
    classWise,
    feeCategories,
    aging,
    cashDenominations,
  };
}

// ── Private helpers ────────────────────────────────────────────────────────────

function pctChange(prev: number, curr: number): number | null {
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function mapAttemptStatus(outcome: string): string {
  switch (outcome) {
    case "captured":           return "captured";
    case "refunded":           return "refunded";
    case "partially_refunded": return "partially_refunded";
    case "failed":             return "failed";
    case "cancelled":          return "cancelled";
    case "authorized":         return "authorized";
    default:                   return "pending";
  }
}

/**
 * Dispatch trend granularity:
 * - today            → 24 hourly buckets (created_at IST hour); billed total
 *                      placed in the first bucket for parity with summary.
 * - academic_year or
 *   custom > 62 days → monthly buckets with "Apr 24" labels.
 * - everything else  → daily buckets with "01 Apr" labels.
 */
function buildTrend(
  preset: FinancialPreset,
  startDate: string,
  endDate: string,
  billedRows: any[],
  paymentRows: any[],
): TrendPoint[] {
  const spanDays = daysBetween(startDate, endDate) + 1;

  if (preset === "today") {
    return buildHourlyTrend(startDate, billedRows, paymentRows);
  } else if (preset === "academic_year" || spanDays > 62) {
    return buildMonthlyTrend(startDate, endDate, billedRows, paymentRows);
  } else {
    return buildDailyTrend(startDate, endDate, billedRows, paymentRows);
  }
}

/**
 * Hourly trend for the "today" preset.
 *
 * - Collected values are placed in the bucket whose IST hour matches
 *   payment_records.created_at (the moment of payment creation).
 * - The entire day-level billed total is placed in bucket "00" (midnight) so
 *   that the sum across all hourly billed values equals summary.billed.
 *   This is clearly documented in the key/label so consumers know to treat
 *   billed as a day-level total rather than an intra-day bucket value.
 */
function buildHourlyTrend(
  date: string,
  billedRows: any[],
  paymentRows: any[],
): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const key   = String(h).padStart(2, "0");
    const label = `${key}:00`;
    points.push({
      key,
      label,
      startDate: `${date}T${key}:00`,
      billed:         0,
      grossCollected: 0,
      netCollected:   0,
    });
  }

  // Billed total for the day goes in bucket 00 (documented convention).
  const dayBilled = billedRows.reduce(
    (acc, row) => acc + Number(row.amount ?? 0) + Number(row.late_fee_amount ?? 0),
    0,
  );
  points[0]!.billed = dayBilled;

  for (const row of paymentRows) {
    // created_hour_ist is the Asia/Kolkata wall-clock hour (0-23) computed in
    // SQL; use it directly rather than re-parsing a timestamp and applying a
    // fixed offset host-side.
    if (row.created_hour_ist === null || row.created_hour_ist === undefined) continue;
    const istHour = Number(row.created_hour_ist);
    const pt      = points[istHour];
    if (pt) pt.grossCollected += Number(row.amount ?? 0);
  }

  for (const pt of points) {
    pt.netCollected = pt.grossCollected;
  }

  return points;
}

/**
 * Daily trend with "01 Apr" labels.
 */
function buildDailyTrend(
  startDate: string,
  endDate: string,
  billedRows: any[],
  paymentRows: any[],
): TrendPoint[] {
  const days   = daysBetween(startDate, endDate) + 1;
  const points: TrendPoint[] = [];

  for (let i = 0; i < days; i++) {
    const d = addDays(startDate, i);
    points.push({
      key:            d,
      label:          dailyLabel(d),
      startDate:      d,
      billed:         0,
      grossCollected: 0,
      netCollected:   0,
    });
  }

  const idx = new Map(points.map((p, i) => [p.key, i]));

  for (const row of billedRows) {
    const due = String(row.due_date).slice(0, 10);
    const i   = idx.get(due);
    if (i !== undefined)
      points[i]!.billed += Number(row.amount ?? 0) + Number(row.late_fee_amount ?? 0);
  }

  for (const row of paymentRows) {
    const recv = String(row.received_date).slice(0, 10);
    const i    = idx.get(recv);
    if (i !== undefined)
      points[i]!.grossCollected += Number(row.amount ?? 0);
  }

  for (const pt of points) pt.netCollected = pt.grossCollected;

  return points;
}

/**
 * Monthly trend with "Apr 24" labels.
 */
function buildMonthlyTrend(
  startDate: string,
  endDate: string,
  billedRows: any[],
  paymentRows: any[],
): TrendPoint[] {
  const points: TrendPoint[] = [];
  let cursor  = startDate.slice(0, 7); // YYYY-MM
  const endYM = endDate.slice(0, 7);

  while (cursor <= endYM) {
    points.push({
      key:            cursor,
      label:          monthlyLabel(cursor),
      startDate:      cursor + "-01",
      billed:         0,
      grossCollected: 0,
      netCollected:   0,
    });
    const [y, m] = cursor.split("-").map(Number);
    const nm     = m! + 1;
    cursor = nm > 12
      ? `${y! + 1}-01`
      : `${String(y).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
  }

  const idx = new Map(points.map((p, i) => [p.key, i]));

  for (const row of billedRows) {
    const ym = String(row.due_date).slice(0, 7);
    const i  = idx.get(ym);
    if (i !== undefined)
      points[i]!.billed += Number(row.amount ?? 0) + Number(row.late_fee_amount ?? 0);
  }

  for (const row of paymentRows) {
    const ym = String(row.received_date).slice(0, 7);
    const i  = idx.get(ym);
    if (i !== undefined)
      points[i]!.grossCollected += Number(row.amount ?? 0);
  }

  for (const pt of points) pt.netCollected = pt.grossCollected;

  return points;
}
