/**
 * Append-only audit trail for online Razorpay payment attempts.
 *
 * Source of truth split:
 * - payment_attempts: mutable current projection from client, webhook and API data.
 * - payment_attempt_events: immutable application/provider lifecycle history.
 * - payment_webhook_events: durable webhook delivery record (including retries).
 *
 * Never place a secret, full PAN, CVV, or auth token in these payloads.
 */
import crypto from "node:crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";

export type PaymentHistorySource = "client" | "webhook" | "admin" | "migrated" | "system";

export type AttemptEventInput = {
  schoolId: number;
  paymentAttemptId?: number | null;
  feeRecordId?: number | null;
  studentId?: number | null;
  sessionId?: number | null;
  eventType: string;
  outcome?: string | null;
  razorpayPaymentId?: string | null;
  razorpayOrderId?: string | null;
  refundId?: string | null;
  disputeId?: string | null;
  amountPaise?: number | null;
  currency?: string | null;
  source: PaymentHistorySource;
  webhookEventId?: number | null;
  idempotencyKey: string;
  payload?: unknown;
  providerOccurredAt?: Date | null;
  occurredAt?: Date | null;
  historical?: boolean;
};

export type WebhookDeliveryInput = {
  schoolId: number | null;
  eventType: string;
  rawBody: string;
  payload: unknown;
  razorpayPaymentId?: string | null;
  razorpayOrderId?: string | null;
  feeRecordId?: number | null;
  feeResolutionSource?: "notes" | "payment_id" | "order_id" | null;
  providerOccurredAt?: Date | null;
};

const sensitivePayloadKeys = new Set([
  "cvv", "pan", "card_number", "cardnumber", "full_card_number",
  "token", "secret", "api_key", "apikey", "authorization",
  "razorpay_signature", "webhook_signature",
]);

/** Drops only prohibited credentials/card fields; retains safe Razorpay metadata. */
export function sanitizePaymentPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePaymentPayload);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (sensitivePayloadKeys.has(key.toLowerCase())) continue;
    out[key] = sanitizePaymentPayload(raw);
  }
  return out;
}

function payloadJson(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(sanitizePaymentPayload(value));
}

function providerTimestamp(value: any): Date | null {
  const raw = value?.created_at ?? value?.createdAt
    ?? value?.payload?.payment?.entity?.created_at
    ?? value?.payload?.refund?.entity?.created_at
    ?? value?.payload?.dispute?.entity?.created_at
    ?? value?.payload?.order?.entity?.created_at;
  if (typeof raw === "number" && raw > 0) return new Date(raw * 1000);
  if (typeof raw === "string") {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Stable retry identity even when Razorpay does not include a top-level event id. */
export function webhookProviderEventId(rawBody: string, payload: any): string {
  const supplied = payload?.id ?? payload?.event_id ?? payload?.eventId;
  if (supplied) return String(supplied);
  return `sha256:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
}

/**
 * Retains a webhook delivery before payment-specific business handling.
 * Exact retries increment a count and timestamp but never replace the payload.
 */
export async function recordWebhookDelivery(input: WebhookDeliveryInput): Promise<number> {
  const providerEventId = webhookProviderEventId(input.rawBody, input.payload);
  const result = await db.execute(sql`
    INSERT INTO payment_webhook_events (
      school_id, provider, provider_event_id, event_type, razorpay_payment_id,
      razorpay_order_id, fee_record_id, fee_resolution_source, fee_resolution_status,
      provider_occurred_at, payload, received_at, last_received_at,
      processing_status, delivery_count
    ) VALUES (
      ${input.schoolId}, 'razorpay', ${providerEventId}, ${input.eventType},
      ${input.razorpayPaymentId ?? null}, ${input.razorpayOrderId ?? null},
      ${input.feeRecordId ?? null}, ${input.feeResolutionSource ?? null},
      ${input.feeRecordId != null ? "resolved" : "unresolved"},
      ${(input.providerOccurredAt ?? providerTimestamp(input.payload))?.toISOString() ?? null}, ${payloadJson(input.payload)}::jsonb, NOW(), NOW(),
      'received', 1
    )
    RETURNING id
  `);
  return Number((result.rows[0] as any)?.id ?? 0);
}

export async function updateWebhookDelivery(
  webhookEventId: number,
  patch: { verified?: boolean; status?: "received" | "processed" | "failed" | "ignored"; error?: string | null; feeRecordId?: number | null; resolutionSource?: "notes" | "payment_id" | "order_id" | null; resolutionStatus?: "resolved" | "unresolved" },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO payment_webhook_processing_events (webhook_delivery_id, status, error)
    VALUES (${webhookEventId}, ${patch.status ?? (patch.verified ? "verified" : "received")}, ${patch.error ?? null})
  `);
}

/** Looks up the current projection without ever crossing tenant boundaries. */
export async function resolvePaymentAttemptId(input: Pick<AttemptEventInput,
  "schoolId" | "paymentAttemptId" | "razorpayPaymentId" | "razorpayOrderId" | "feeRecordId"
>): Promise<number | null> {
  if (input.paymentAttemptId) return input.paymentAttemptId;
  const result = await db.execute(sql`
    SELECT id
    FROM payment_attempts
    WHERE school_id = ${input.schoolId}
      AND (
        (${input.razorpayPaymentId ?? null}::text IS NOT NULL
          AND razorpay_payment_id = ${input.razorpayPaymentId ?? null})
        OR (${input.razorpayOrderId ?? null}::text IS NOT NULL
          AND razorpay_order_id = ${input.razorpayOrderId ?? null})
      )
      ${input.feeRecordId != null ? sql`AND fee_record_id = ${input.feeRecordId}` : sql``}
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `);
  const id = (result.rows[0] as any)?.id;
  return id == null ? null : Number(id);
}

/** Inserts one immutable event. The database trigger rejects subsequent UPDATE/DELETE. */
export async function appendPaymentAttemptEvent(input: AttemptEventInput): Promise<number | null> {
  const attemptId = await resolvePaymentAttemptId(input);
  if (!attemptId) return null;
  const result = await db.execute(sql`
    INSERT INTO payment_attempt_events (
      school_id, payment_attempt_id, student_id, fee_record_id, session_id,
      event_type, outcome, razorpay_payment_id, razorpay_order_id, refund_id,
      dispute_id, amount_paise, currency, source, webhook_event_id,
      idempotency_key, payload, provider_occurred_at, occurred_at, historical
    ) VALUES (
      ${input.schoolId}, ${attemptId}, ${input.studentId ?? null}, ${input.feeRecordId ?? null},
      ${input.sessionId ?? null}, ${input.eventType}, ${input.outcome ?? null},
      ${input.razorpayPaymentId ?? null}, ${input.razorpayOrderId ?? null},
      ${input.refundId ?? null}, ${input.disputeId ?? null}, ${input.amountPaise ?? null},
      ${input.currency ?? "INR"}, ${input.source}, ${input.webhookEventId ?? null},
      ${input.idempotencyKey}, ${payloadJson(input.payload)}::jsonb,
      ${(input.providerOccurredAt ?? providerTimestamp(input.payload))?.toISOString() ?? null},
      ${input.occurredAt?.toISOString() ?? null}, ${input.historical ?? false}
    )
    ON CONFLICT (school_id, idempotency_key) DO NOTHING
    RETURNING id
  `);
  const id = (result.rows[0] as any)?.id;
  return id == null ? null : Number(id);
}

export async function updateAttemptEnrichmentState(input: {
  schoolId: number;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  status: "started" | "completed" | "failed";
  error?: string | null;
}): Promise<void> {
  await db.execute(sql`
    UPDATE payment_attempts
    SET api_enrichment_status = ${input.status},
        api_enrichment_error = ${input.error ?? null},
        api_synced_at = CASE WHEN ${input.status} = 'completed' THEN NOW() ELSE api_synced_at END,
        updated_at = NOW()
    WHERE school_id = ${input.schoolId}
      AND (
        (${input.razorpayPaymentId ?? null}::text IS NOT NULL AND razorpay_payment_id = ${input.razorpayPaymentId ?? null})
        OR (${input.razorpayOrderId ?? null}::text IS NOT NULL AND razorpay_order_id = ${input.razorpayOrderId ?? null})
      )
  `);
}