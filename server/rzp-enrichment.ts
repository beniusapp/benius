/**
 * rzp-enrichment.ts
 *
 * Razorpay payment-attempt persistence and API enrichment.
 *
 *  fetchRazorpayData()          — calls payments.fetch + orders.fetch (non-fatal)
 *  mapRazorpayPayment()         — maps a full Razorpay API entity to our column schema
 *  upsertPaymentAttempt()       — idempotent UPSERT into payment_attempts
 *  updatePaymentAttemptRefund() — update refund fields on an existing row
 */

import Razorpay from "razorpay";
import { db } from "./db";
import { sql } from "drizzle-orm";

export interface RzpCredentials {
  keyId: string;
  keySecret: string;
}

/** Convert a Razorpay epoch-seconds timestamp to Date (null-safe). */
function epochToDate(epoch: number | null | undefined): Date | null {
  if (!epoch) return null;
  return new Date(epoch * 1000);
}

/** Full shape accepted by upsertPaymentAttempt. Every field except the
 *  identity trio (schoolId, outcome, source) is optional. */
export interface UpsertAttemptData {
  schoolId:  number;
  outcome:   string;
  source:    "webhook" | "client" | "admin" | "migrated";

  studentId?:    number | null;
  feeRecordId?:  number | null;
  sessionId?:    number | null;

  razorpayPaymentId?: string | null;
  razorpayOrderId?:   string | null;

  amountPaise?:         number | null;
  currency?:            string | null;
  amountCapturedPaise?: number | null;
  amountRefundedPaise?: number | null;
  razorpayFeePaise?:    number | null;
  razorpayTaxPaise?:    number | null;

  paymentMethod?:     string | null;
  cardNetwork?:       string | null;
  cardLast4?:         string | null;
  cardType?:          string | null;
  cardIssuer?:        string | null;
  cardName?:          string | null;
  cardInternational?: boolean | null;
  cardEmi?:           boolean | null;
  bankName?:          string | null;
  bankRrn?:           string | null;
  bankAuthCode?:      string | null;
  vpa?:               string | null;
  wallet?:            string | null;

  payerName?:    string | null;
  payerEmail?:   string | null;
  payerContact?: string | null;

  errorCode?:        string | null;
  errorDescription?: string | null;
  errorSource?:      string | null;
  errorStep?:        string | null;
  errorReason?:      string | null;

  rzpCreatedAt?:    Date | null;
  rzpAuthorizedAt?: Date | null;
  rzpCapturedAt?:   Date | null;
  rzpFailedAt?:     Date | null;

  webhookEvent?:      string | null;
  webhookReceivedAt?: Date | null;
  webhookVerified?:   boolean;
  webhookPayload?:    any;

  apiSyncedAt?:         Date | null;
  razorpayPaymentData?: any;
  razorpayOrderData?:   any;

  receiptNumber?: string | null;
  /** Stable dedup key for backfill rows: 'pr:<id>' or 'fal:<id>'.
   *  Leave undefined/null for all live webhook / client rows. */
  externalId?: string | null;
}

/**
 * Map a Razorpay payments.fetch() entity to our payment_attempts columns.
 * Returns only the fields present in the API response.
 */
export function mapRazorpayPayment(p: any): Partial<UpsertAttemptData> {
  if (!p) return {};

  const card = p.card ?? {};
  const acq  = p.acquirer_data ?? {};

  // Auth code: card.auth_code is the most reliable source; fall back to acquirer_data
  const authCode = card.auth_code ?? acq.auth_code ?? null;
  // RRN: Razorpay sometimes returns "--" / "---" placeholders — treat those as absent
  const rawRrn   = acq.rrn ?? acq.upi_transaction_id ?? null;
  const bankRrn  = rawRrn && rawRrn !== "--" && rawRrn !== "---" ? String(rawRrn) : null;

  const outcomeMap: Record<string, string> = {
    captured: "captured", authorized: "authorized",
    failed:   "failed",   created:    "pending",   refunded: "refunded",
  };

  const out: Partial<UpsertAttemptData> = {};

  if (p.id)         out.razorpayPaymentId = p.id;
  if (p.order_id)   out.razorpayOrderId   = p.order_id;
  if (p.status)     out.outcome = outcomeMap[p.status] ?? p.status;
  if (p.amount   != null) out.amountPaise = Number(p.amount);
  out.currency = p.currency ?? "INR";
  if (p.amount   != null)
    out.amountCapturedPaise = Math.max(0, Number(p.amount) - Number(p.amount_refunded ?? 0));
  out.amountRefundedPaise = p.amount_refunded != null ? Number(p.amount_refunded) : 0;
  if (p.fee      != null) out.razorpayFeePaise = Number(p.fee);
  if (p.tax      != null) out.razorpayTaxPaise = Number(p.tax);
  if (p.method)     out.paymentMethod = p.method;
  if (card.network) out.cardNetwork   = card.network;
  if (card.last4)   out.cardLast4     = card.last4;
  if (card.type)    out.cardType      = card.type;
  if (card.issuer)  out.cardIssuer    = card.issuer;
  if (card.name && card.name !== "---") out.cardName = card.name;
  if (card.international != null) out.cardInternational = Boolean(card.international);
  if (card.emi       != null) out.cardEmi = Boolean(card.emi);
  if (p.bank)       out.bankName    = p.bank;
  if (bankRrn)      out.bankRrn     = bankRrn;
  if (authCode && authCode !== "--") out.bankAuthCode = String(authCode);
  if (p.vpa)        out.vpa         = p.vpa;
  if (p.wallet)     out.wallet      = p.wallet;
  if (p.email)      out.payerEmail  = p.email;
  if (p.contact)    out.payerContact = p.contact;
  if (p.error_code)        out.errorCode        = p.error_code;
  if (p.error_description) out.errorDescription = p.error_description;
  if (p.error_source)      out.errorSource      = p.error_source;
  if (p.error_step)        out.errorStep        = p.error_step;
  if (p.error_reason)      out.errorReason      = p.error_reason;
  if (p.created_at) out.rzpCreatedAt = epochToDate(p.created_at);
  if (p.status === "captured")
    out.rzpCapturedAt = epochToDate(p.captured_at ?? p.created_at);
  if (p.status === "failed")
    out.rzpFailedAt = epochToDate(p.created_at);

  out.razorpayPaymentData = p;
  out.apiSyncedAt = new Date();

  return out;
}

/**
 * Fetch authoritative payment + order data from Razorpay API.
 * Both calls are non-fatal — individual failures are logged and nulled.
 */
export async function fetchRazorpayData(
  paymentId: string | null,
  orderId:   string | null,
  creds:     RzpCredentials,
): Promise<{ paymentData: any; orderData: any }> {
  const rzp = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });

  const [payResult, ordResult] = await Promise.allSettled([
    paymentId ? (rzp.payments as any).fetch(paymentId) : Promise.resolve(null),
    orderId   ? (rzp.orders   as any).fetch(orderId)   : Promise.resolve(null),
  ]);

  if (payResult.status === "rejected")
    console.warn(`[rzp-enrichment] payments.fetch(${paymentId}) failed:`,
      (payResult.reason as any)?.message ?? payResult.reason);
  if (ordResult.status === "rejected")
    console.warn(`[rzp-enrichment] orders.fetch(${orderId}) failed:`,
      (ordResult.reason as any)?.message ?? ordResult.reason);

  return {
    paymentData: payResult.status === "fulfilled" ? payResult.value : null,
    orderData:   ordResult.status  === "fulfilled" ? ordResult.value  : null,
  };
}

/**
 * Idempotent upsert into payment_attempts.
 *
 * When razorpay_payment_id is present:
 *   UPSERT on (school_id, razorpay_payment_id) — duplicate webhook deliveries
 *   update the existing row.  "Captured" and "refunded" are terminal outcomes
 *   that are never downgraded.
 *
 * When absent (cancelled / pending):
 *   Plain INSERT guarded by the partial unique index on
 *   (school_id, razorpay_order_id) — duplicate cancellations for the same
 *   order are silently ignored.
 *
 * Returns the row id (0 when a conflict-skipped INSERT returned nothing).
 */
export async function upsertPaymentAttempt(data: UpsertAttemptData): Promise<number> {
  const now = new Date().toISOString();
  const d   = data;

  const wJson = d.webhookPayload      ? JSON.stringify(d.webhookPayload)      : null;
  const pJson = d.razorpayPaymentData ? JSON.stringify(d.razorpayPaymentData) : null;
  const oJson = d.razorpayOrderData   ? JSON.stringify(d.razorpayOrderData)   : null;

  if (d.razorpayPaymentId) {
    // ── UPSERT keyed on (school_id, razorpay_payment_id) ───────────────────
    const result = await db.execute(sql`
      INSERT INTO payment_attempts (
        school_id, student_id, fee_record_id, session_id, outcome,
        razorpay_payment_id, razorpay_order_id,
        amount_paise, currency, amount_captured_paise, amount_refunded_paise,
        razorpay_fee_paise, razorpay_tax_paise,
        payment_method, card_network, card_last4, card_type, card_issuer,
        card_name, card_international, card_emi,
        bank_name, bank_rrn, bank_auth_code, vpa, wallet,
        payer_name, payer_email, payer_contact,
        error_code, error_description, error_source, error_step, error_reason,
        rzp_created_at, rzp_authorized_at, rzp_captured_at, rzp_failed_at,
        webhook_event, webhook_received_at, webhook_verified, webhook_payload,
        api_synced_at, razorpay_payment_data, razorpay_order_data,
        source, receipt_number, created_at, updated_at
      ) VALUES (
        ${d.schoolId}, ${d.studentId ?? null}, ${d.feeRecordId ?? null},
        ${d.sessionId ?? null}, ${d.outcome},
        ${d.razorpayPaymentId}, ${d.razorpayOrderId ?? null},
        ${d.amountPaise ?? null}, ${d.currency ?? "INR"},
        ${d.amountCapturedPaise ?? null}, ${d.amountRefundedPaise ?? null},
        ${d.razorpayFeePaise ?? null}, ${d.razorpayTaxPaise ?? null},
        ${d.paymentMethod ?? null}, ${d.cardNetwork ?? null}, ${d.cardLast4 ?? null},
        ${d.cardType ?? null}, ${d.cardIssuer ?? null}, ${d.cardName ?? null},
        ${d.cardInternational ?? null}, ${d.cardEmi ?? null},
        ${d.bankName ?? null}, ${d.bankRrn ?? null}, ${d.bankAuthCode ?? null},
        ${d.vpa ?? null}, ${d.wallet ?? null},
        ${d.payerName ?? null}, ${d.payerEmail ?? null}, ${d.payerContact ?? null},
        ${d.errorCode ?? null}, ${d.errorDescription ?? null},
        ${d.errorSource ?? null}, ${d.errorStep ?? null}, ${d.errorReason ?? null},
        ${d.rzpCreatedAt?.toISOString() ?? null},
        ${d.rzpAuthorizedAt?.toISOString() ?? null},
        ${d.rzpCapturedAt?.toISOString() ?? null},
        ${d.rzpFailedAt?.toISOString() ?? null},
        ${d.webhookEvent ?? null},
        ${d.webhookReceivedAt?.toISOString() ?? null},
        ${d.webhookVerified ?? false},
        ${wJson}::jsonb,
        ${d.apiSyncedAt?.toISOString() ?? null},
        ${pJson}::jsonb, ${oJson}::jsonb,
        ${d.source}, ${d.receiptNumber ?? null},
        ${now}, ${now}
      )
      ON CONFLICT (school_id, razorpay_payment_id)
        WHERE razorpay_payment_id IS NOT NULL
      DO UPDATE SET
        outcome               = CASE
                                  WHEN EXCLUDED.outcome IN ('captured','refunded') THEN EXCLUDED.outcome
                                  WHEN payment_attempts.outcome IN ('captured','refunded') THEN payment_attempts.outcome
                                  ELSE EXCLUDED.outcome
                                END,
        student_id            = COALESCE(EXCLUDED.student_id,            payment_attempts.student_id),
        fee_record_id         = COALESCE(EXCLUDED.fee_record_id,         payment_attempts.fee_record_id),
        session_id            = COALESCE(EXCLUDED.session_id,            payment_attempts.session_id),
        razorpay_order_id     = COALESCE(EXCLUDED.razorpay_order_id,     payment_attempts.razorpay_order_id),
        amount_paise          = COALESCE(EXCLUDED.amount_paise,          payment_attempts.amount_paise),
        amount_captured_paise = COALESCE(EXCLUDED.amount_captured_paise, payment_attempts.amount_captured_paise),
        amount_refunded_paise = COALESCE(EXCLUDED.amount_refunded_paise, payment_attempts.amount_refunded_paise),
        razorpay_fee_paise    = COALESCE(EXCLUDED.razorpay_fee_paise,    payment_attempts.razorpay_fee_paise),
        razorpay_tax_paise    = COALESCE(EXCLUDED.razorpay_tax_paise,    payment_attempts.razorpay_tax_paise),
        payment_method        = COALESCE(EXCLUDED.payment_method,        payment_attempts.payment_method),
        card_network          = COALESCE(EXCLUDED.card_network,          payment_attempts.card_network),
        card_last4            = COALESCE(EXCLUDED.card_last4,            payment_attempts.card_last4),
        card_type             = COALESCE(EXCLUDED.card_type,             payment_attempts.card_type),
        card_issuer           = COALESCE(EXCLUDED.card_issuer,           payment_attempts.card_issuer),
        card_name             = COALESCE(EXCLUDED.card_name,             payment_attempts.card_name),
        card_international    = COALESCE(EXCLUDED.card_international,    payment_attempts.card_international),
        card_emi              = COALESCE(EXCLUDED.card_emi,              payment_attempts.card_emi),
        bank_name             = COALESCE(EXCLUDED.bank_name,             payment_attempts.bank_name),
        bank_rrn              = COALESCE(EXCLUDED.bank_rrn,              payment_attempts.bank_rrn),
        bank_auth_code        = COALESCE(EXCLUDED.bank_auth_code,        payment_attempts.bank_auth_code),
        vpa                   = COALESCE(EXCLUDED.vpa,                   payment_attempts.vpa),
        wallet                = COALESCE(EXCLUDED.wallet,                payment_attempts.wallet),
        payer_name            = COALESCE(EXCLUDED.payer_name,            payment_attempts.payer_name),
        payer_email           = COALESCE(EXCLUDED.payer_email,           payment_attempts.payer_email),
        payer_contact         = COALESCE(EXCLUDED.payer_contact,         payment_attempts.payer_contact),
        error_code            = COALESCE(EXCLUDED.error_code,            payment_attempts.error_code),
        error_description     = COALESCE(EXCLUDED.error_description,     payment_attempts.error_description),
        error_source          = COALESCE(EXCLUDED.error_source,          payment_attempts.error_source),
        error_step            = COALESCE(EXCLUDED.error_step,            payment_attempts.error_step),
        error_reason          = COALESCE(EXCLUDED.error_reason,          payment_attempts.error_reason),
        rzp_created_at        = COALESCE(EXCLUDED.rzp_created_at,        payment_attempts.rzp_created_at),
        rzp_authorized_at     = COALESCE(EXCLUDED.rzp_authorized_at,     payment_attempts.rzp_authorized_at),
        rzp_captured_at       = COALESCE(EXCLUDED.rzp_captured_at,       payment_attempts.rzp_captured_at),
        rzp_failed_at         = COALESCE(EXCLUDED.rzp_failed_at,         payment_attempts.rzp_failed_at),
        webhook_event         = COALESCE(EXCLUDED.webhook_event,         payment_attempts.webhook_event),
        webhook_received_at   = COALESCE(EXCLUDED.webhook_received_at,   payment_attempts.webhook_received_at),
        webhook_verified      = payment_attempts.webhook_verified OR EXCLUDED.webhook_verified,
        webhook_payload       = COALESCE(EXCLUDED.webhook_payload,       payment_attempts.webhook_payload),
        api_synced_at         = COALESCE(EXCLUDED.api_synced_at,         payment_attempts.api_synced_at),
        razorpay_payment_data = COALESCE(EXCLUDED.razorpay_payment_data, payment_attempts.razorpay_payment_data),
        razorpay_order_data   = COALESCE(EXCLUDED.razorpay_order_data,   payment_attempts.razorpay_order_data),
        receipt_number        = COALESCE(EXCLUDED.receipt_number,        payment_attempts.receipt_number),
        updated_at            = ${now}
      RETURNING id
    `);
    return Number((result.rows[0] as any)?.id ?? 0);

  } else {
    // ── INSERT: cancelled / no-payment-ID attempts ──────────────────────────
    // Guarded by partial unique index (school_id, razorpay_order_id) where
    // razorpay_payment_id IS NULL — silently ignores duplicate reports.
    const result = await db.execute(sql`
      INSERT INTO payment_attempts (
        school_id, student_id, fee_record_id, session_id, outcome,
        razorpay_order_id, amount_paise, currency,
        payment_method, vpa, wallet,
        payer_name, payer_email, payer_contact,
        error_code, error_description, error_source, error_step, error_reason,
        rzp_created_at,
        webhook_event, webhook_received_at, webhook_verified, webhook_payload,
        api_synced_at, razorpay_payment_data, razorpay_order_data,
        source, receipt_number, created_at, updated_at
      ) VALUES (
        ${d.schoolId}, ${d.studentId ?? null}, ${d.feeRecordId ?? null},
        ${d.sessionId ?? null}, ${d.outcome},
        ${d.razorpayOrderId ?? null},
        ${d.amountPaise ?? null}, ${d.currency ?? "INR"},
        ${d.paymentMethod ?? null}, ${d.vpa ?? null}, ${d.wallet ?? null},
        ${d.payerName ?? null}, ${d.payerEmail ?? null}, ${d.payerContact ?? null},
        ${d.errorCode ?? null}, ${d.errorDescription ?? null},
        ${d.errorSource ?? null}, ${d.errorStep ?? null}, ${d.errorReason ?? null},
        ${d.rzpCreatedAt?.toISOString() ?? null},
        ${d.webhookEvent ?? null},
        ${d.webhookReceivedAt?.toISOString() ?? null},
        ${d.webhookVerified ?? false}, ${wJson}::jsonb,
        ${d.apiSyncedAt?.toISOString() ?? null},
        ${pJson}::jsonb, ${oJson}::jsonb,
        ${d.source}, ${d.receiptNumber ?? null},
        ${now}, ${now}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    return Number((result.rows[0] as any)?.id ?? 0);
  }
}

/**
 * Update refund fields on an existing payment_attempts row.
 * Called from the refund.* webhook branch.
 */
export async function updatePaymentAttemptRefund(
  schoolId:          number,
  razorpayPaymentId: string,
  refundId:          string,
  refundStatus:      string,
  refundAmountPaise: number | null,
  refundInitiatedAt: Date   | null,
  refundProcessedAt: Date   | null,
  newOutcome:        "captured" | "refunded",
): Promise<void> {
  await db.execute(sql`
    UPDATE payment_attempts
    SET
      outcome             = ${newOutcome},
      refund_id           = ${refundId},
      refund_status       = ${refundStatus},
      refund_amount_paise = COALESCE(${refundAmountPaise ?? null}, refund_amount_paise),
      refund_initiated_at = COALESCE(
        ${refundInitiatedAt?.toISOString() ?? null}::timestamptz,
        refund_initiated_at
      ),
      refund_processed_at = COALESCE(
        ${refundProcessedAt?.toISOString() ?? null}::timestamptz,
        refund_processed_at
      ),
      updated_at = NOW()
    WHERE school_id          = ${schoolId}
      AND razorpay_payment_id = ${razorpayPaymentId}
  `);
}
