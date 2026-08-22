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
import { sanitizePaymentPayload } from "./payment-attempt-history";
import { dateOnlyInIST } from "../shared/ist-time";

export interface RzpCredentials {
  keyId: string;
  keySecret: string;
}

/** Convert a Razorpay epoch-seconds timestamp to Date (null-safe). */
export function razorpayEpochToDate(epoch: number | string | null | undefined): Date | null {
  if (epoch == null || epoch === "") return null;
  const numericEpoch = Number(epoch);
  if (!Number.isFinite(numericEpoch) || numericEpoch <= 0) return null;
  const date = new Date(numericEpoch * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Provider creation is distinct from capture and from application receipt. */
export function razorpayPaymentCreatedAt(payment: any): Date | null {
  return razorpayEpochToDate(payment?.created_at);
}

/**
 * Best available provider occurrence for a successful capture.
 *
 * Razorpay payment entities do not always expose a separate captured_at. A
 * signed payment.captured webhook does expose the provider event creation time,
 * which is a better capture occurrence than the later application receipt time.
 * Client verification has no signed event, so it falls back to the payment's
 * provider-created instant rather than inventing a capture instant from Date.now().
 */
export function razorpayPaymentCapturedAt(payment: any, event?: any): Date | null {
  return razorpayEpochToDate(payment?.captured_at)
    ?? (event?.event === "payment.captured" ? razorpayEpochToDate(event?.created_at) : null)
    ?? razorpayPaymentCreatedAt(payment);
}

/** Successful-payment business date, derived from the provider occurrence in IST. */
export function razorpayPaymentBusinessDateIST(payment: any, event?: any): string | null {
  const capturedAt = razorpayPaymentCapturedAt(payment, event);
  return capturedAt ? dateOnlyInIST(capturedAt) : null;
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
  // Razorpay's payment amount is the amount originally captured. A refund is
  // recorded separately below; subtracting it here would mislabel the net
  // retained amount as the captured amount in payment history.
  if (p.amount != null && (p.status === "captured" || p.status === "refunded"))
    out.amountCapturedPaise = Number(p.amount);
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
  if (p.created_at) out.rzpCreatedAt = razorpayPaymentCreatedAt(p);
  if (p.status === "captured")
    out.rzpCapturedAt = razorpayPaymentCapturedAt(p);
  if (p.status === "failed")
    out.rzpFailedAt = razorpayPaymentCreatedAt(p);

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

  const wJson = d.webhookPayload      ? JSON.stringify(sanitizePaymentPayload(d.webhookPayload))      : null;
  const pJson = d.razorpayPaymentData ? JSON.stringify(sanitizePaymentPayload(d.razorpayPaymentData)) : null;
  const oJson = d.razorpayOrderData   ? JSON.stringify(sanitizePaymentPayload(d.razorpayOrderData))   : null;

  // The lookup, promotion, next-number allocation, and write must be one
  // critical section. Distinct payment IDs can arrive concurrently for the
  // same Razorpay order; without this lock both callbacks could allocate the
  // same next attempt number.
  return await db.transaction(async (tx) => {
  if (d.feeRecordId != null) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${d.schoolId}, ${d.feeRecordId})`);
  }

  // An order is an attempt identity. A pending row created at checkout must be
  // promoted by its payment callback rather than becoming a misleading second
  // projection. Attempt numbers are per-invoice and allocated only for online
  // identities, preserving previous retries forever.
  // Payment ID is the strongest identity. Razorpay can create more than one
  // payment attempt against a single order, so an existing *different* payment
  // ID must never be collapsed into its sibling attempt. Only an order-only
  // pending projection is eligible to be promoted by the first payment ID.
  const exactPayment = d.razorpayPaymentId ? (await tx.execute(sql`
    SELECT id, attempt_number, razorpay_payment_id
    FROM payment_attempts
    WHERE school_id = ${d.schoolId}
      AND razorpay_payment_id = ${d.razorpayPaymentId}
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `)).rows[0] as any : null;
  const orderOnlyProjection = d.razorpayOrderId ? (await tx.execute(sql`
    SELECT id, attempt_number, razorpay_payment_id
    FROM payment_attempts
    WHERE school_id = ${d.schoolId}
      AND razorpay_order_id = ${d.razorpayOrderId}
      AND razorpay_payment_id IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `)).rows[0] as any : null;
  const matching = d.razorpayPaymentId
    ? (exactPayment ?? orderOnlyProjection)
    : orderOnlyProjection;
  let attemptNumber: number | null = matching?.attempt_number == null ? null : Number(matching.attempt_number);
  if (!matching && d.feeRecordId != null && (d.razorpayPaymentId || d.razorpayOrderId)) {
    const next = (await tx.execute(sql`
      SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt
      FROM payment_attempts
      WHERE school_id = ${d.schoolId} AND fee_record_id = ${d.feeRecordId}
    `)).rows[0] as any;
    attemptNumber = Number(next?.next_attempt ?? 1);
  }

  // Promote the existing order projection before the payment-ID uniqueness
  // upsert. A payment ID can otherwise leave both "pending" and "failed" rows
  // for one checkout attempt.
  if (d.razorpayPaymentId && d.razorpayOrderId && matching?.id && !matching?.razorpay_payment_id) {
    await tx.execute(sql`
      UPDATE payment_attempts
      SET razorpay_payment_id = ${d.razorpayPaymentId}, updated_at = ${now}
      WHERE id = ${Number(matching.id)} AND school_id = ${d.schoolId}
    `);
  }

  if (d.razorpayPaymentId) {
    // ── UPSERT keyed on (school_id, razorpay_payment_id) ───────────────────
    const result = await tx.execute(sql`
      INSERT INTO payment_attempts (
        school_id, student_id, fee_record_id, session_id, attempt_number, outcome,
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
        source, receipt_number, api_enrichment_status, created_at, updated_at
      ) VALUES (
        ${d.schoolId}, ${d.studentId ?? null}, ${d.feeRecordId ?? null},
        ${d.sessionId ?? null}, ${attemptNumber}, ${d.outcome},
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
        ${d.source}, ${d.receiptNumber ?? null}, ${d.apiSyncedAt ? "completed" : null},
        ${now}, ${now}
      )
      ON CONFLICT (school_id, razorpay_payment_id)
        WHERE razorpay_payment_id IS NOT NULL
      DO UPDATE SET
        -- Monotonic forward-only transition policy:
        --   refunded  → always preserved (no event can undo a refund)
        --   captured  → can only advance to refunded; all other events keep captured
        --   anything else → accept the new outcome
        outcome               = CASE
                                  WHEN payment_attempts.outcome = 'refunded'  THEN 'refunded'
                                  WHEN payment_attempts.outcome = 'captured'
                                    AND EXCLUDED.outcome       = 'refunded'   THEN 'refunded'
                                  WHEN payment_attempts.outcome = 'captured'               THEN 'captured'
                                  ELSE EXCLUDED.outcome
                                END,
        student_id            = COALESCE(EXCLUDED.student_id,            payment_attempts.student_id),
        fee_record_id         = COALESCE(EXCLUDED.fee_record_id,         payment_attempts.fee_record_id),
        session_id            = COALESCE(EXCLUDED.session_id,            payment_attempts.session_id),
        attempt_number        = COALESCE(payment_attempts.attempt_number, EXCLUDED.attempt_number),
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
        -- Error fields must not overwrite a terminal (captured/refunded) row.
        -- A late failed/authorized webhook must not inject error data into a row
        -- whose outcome is already protected above.
        error_code            = CASE
                                  WHEN payment_attempts.outcome IN ('captured','refunded') THEN payment_attempts.error_code
                                  ELSE COALESCE(EXCLUDED.error_code,        payment_attempts.error_code)
                                END,
        error_description     = CASE
                                  WHEN payment_attempts.outcome IN ('captured','refunded') THEN payment_attempts.error_description
                                  ELSE COALESCE(EXCLUDED.error_description, payment_attempts.error_description)
                                END,
        error_source          = CASE
                                  WHEN payment_attempts.outcome IN ('captured','refunded') THEN payment_attempts.error_source
                                  ELSE COALESCE(EXCLUDED.error_source,      payment_attempts.error_source)
                                END,
        error_step            = CASE
                                  WHEN payment_attempts.outcome IN ('captured','refunded') THEN payment_attempts.error_step
                                  ELSE COALESCE(EXCLUDED.error_step,        payment_attempts.error_step)
                                END,
        error_reason          = CASE
                                  WHEN payment_attempts.outcome IN ('captured','refunded') THEN payment_attempts.error_reason
                                  ELSE COALESCE(EXCLUDED.error_reason,      payment_attempts.error_reason)
                                END,
        rzp_created_at        = COALESCE(EXCLUDED.rzp_created_at,        payment_attempts.rzp_created_at),
        rzp_authorized_at     = COALESCE(EXCLUDED.rzp_authorized_at,     payment_attempts.rzp_authorized_at),
        rzp_captured_at       = COALESCE(EXCLUDED.rzp_captured_at,       payment_attempts.rzp_captured_at),
        rzp_failed_at         = COALESCE(EXCLUDED.rzp_failed_at,         payment_attempts.rzp_failed_at),
        webhook_event         = COALESCE(EXCLUDED.webhook_event,         payment_attempts.webhook_event),
        webhook_received_at   = COALESCE(EXCLUDED.webhook_received_at,   payment_attempts.webhook_received_at),
        webhook_verified      = payment_attempts.webhook_verified OR EXCLUDED.webhook_verified,
        webhook_payload       = COALESCE(EXCLUDED.webhook_payload,       payment_attempts.webhook_payload),
        api_synced_at         = COALESCE(EXCLUDED.api_synced_at,         payment_attempts.api_synced_at),
        api_enrichment_status = COALESCE(EXCLUDED.api_enrichment_status, payment_attempts.api_enrichment_status),
        razorpay_payment_data = COALESCE(EXCLUDED.razorpay_payment_data, payment_attempts.razorpay_payment_data),
        razorpay_order_data   = COALESCE(EXCLUDED.razorpay_order_data,   payment_attempts.razorpay_order_data),
        receipt_number        = COALESCE(EXCLUDED.receipt_number,        payment_attempts.receipt_number),
        updated_at            = ${now}
      RETURNING id
    `);
    return Number((result.rows[0] as any)?.id ?? 0);

  } else {
    // ── INSERT: pending / cancelled / no-payment-ID attempts ─────────────────
    // Repeated browser notifications for one order update its projection. The
    // immutable event table retains every separately observed lifecycle action.
    if (matching?.id) {
      const result = await tx.execute(sql`
        UPDATE payment_attempts
        SET outcome = CASE
                        WHEN outcome IN ('captured', 'refunded') THEN outcome
                        ELSE ${d.outcome}
                      END,
            error_code = COALESCE(${d.errorCode ?? null}, error_code),
            error_description = COALESCE(${d.errorDescription ?? null}, error_description),
            error_source = COALESCE(${d.errorSource ?? null}, error_source),
            error_step = COALESCE(${d.errorStep ?? null}, error_step),
            error_reason = COALESCE(${d.errorReason ?? null}, error_reason),
            updated_at = ${now}
        WHERE id = ${Number(matching.id)} AND school_id = ${d.schoolId}
        RETURNING id
      `);
      return Number((result.rows[0] as any)?.id ?? 0);
    }
    const result = await tx.execute(sql`
      INSERT INTO payment_attempts (
        school_id, student_id, fee_record_id, session_id, attempt_number, outcome,
        razorpay_order_id, amount_paise, currency,
        payment_method, vpa, wallet,
        payer_name, payer_email, payer_contact,
        error_code, error_description, error_source, error_step, error_reason,
        rzp_created_at,
        webhook_event, webhook_received_at, webhook_verified, webhook_payload,
        api_synced_at, razorpay_payment_data, razorpay_order_data,
        source, receipt_number, api_enrichment_status, created_at, updated_at
      ) VALUES (
        ${d.schoolId}, ${d.studentId ?? null}, ${d.feeRecordId ?? null},
        ${d.sessionId ?? null}, ${attemptNumber}, ${d.outcome},
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
        ${d.source}, ${d.receiptNumber ?? null}, ${d.apiSyncedAt ? "completed" : null},
        ${now}, ${now}
      )
      RETURNING id
    `);
    return Number((result.rows[0] as any)?.id ?? 0);
  }
  });
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
      -- Only advance outcome to 'refunded'; never regress from 'refunded' back to
      -- 'captured' (which the caller passes for refund.created / refund.failed /
      -- refund.speed_changed events).
      outcome             = CASE
                              WHEN ${newOutcome} = 'refunded' THEN 'refunded'
                              ELSE outcome
                            END,
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
