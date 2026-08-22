/**
 * Refund financial authority.
 *
 * payment_records remain the immutable gross-capture/receipt record.  refunds
 * and refund_events carry every separately traceable refund.  The functions in
 * this module are the only place that may reserve a refund or apply a verified
 * provider refund lifecycle update to invoice/payment projections.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";
import { sanitizePaymentPayload } from "./payment-attempt-history";
import { todayInIST } from "@shared/ist-time";
import { isPortalPayment } from "@shared/payment-method";

export const REFUND_REASON_CODES = [
  "duplicate_payment",
  "payment_made_by_mistake",
  "fee_correction",
  "student_withdrawal",
  "excess_payment",
  "administrative_correction",
  "other",
] as const;
export type RefundReasonCode = typeof REFUND_REASON_CODES[number];

const ACTIVE_RESERVATION_STATUSES = ["requested", "pending", "created", "reconciliation_required"];

export type RefundPaymentContext = {
  paymentRecordId: number;
  paymentAttemptId: number | null;
  schoolId: number;
  sessionId: number | null;
  studentId: number;
  feeRecordId: number;
  invoiceNumber: string | null;
  studentName: string;
  digitalStudentId: string;
  capturedAmountPaise: number;
  currency: string;
  paymentMethod: string;
  gatewayStatus: string | null;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  paymentCreatedAt: Date | string | null;
};

export type RefundFinancialSummary = {
  processedRefundedPaise: number;
  reservedPaise: number;
  netRetainedPaise: number;
  currentlyRefundablePaise: number;
  paymentState: "captured" | "refund_pending" | "partially_refunded" | "fully_refunded";
};

export type RefundEligibility = RefundPaymentContext & RefundFinancialSummary & {
  eligible: boolean;
  ineligibleReason: string | null;
};

function amountToPaise(amount: unknown): number {
  return Math.round(Number(amount ?? 0) * 100);
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function providerDate(entity: any): Date | null {
  return typeof entity?.created_at === "number" ? new Date(entity.created_at * 1000) : null;
}

async function findPaymentContext(
  executor: { execute: (query: any) => Promise<any> },
  schoolId: number,
  paymentRecordId: number,
  lock = false,
): Promise<RefundPaymentContext | null> {
  const lockClause = lock ? sql`FOR UPDATE` : sql``;
  const result = await executor.execute(sql`
    SELECT
      pr.id AS payment_record_id,
      pr.school_id,
      pr.session_id,
      pr.student_id,
      pr.fee_record_id,
      pr.amount,
      pr.payment_method,
      pr.gateway_status,
      pr.razorpay_payment_id,
      pr.razorpay_order_id,
      pr.created_at AS payment_created_at,
      fr.session_id AS fee_session_id,
      fr.invoice_number,
      s.name AS student_name,
      s.digital_student_id,
      pa.id AS payment_attempt_id
    FROM payment_records pr
    JOIN fee_records fr ON fr.id = pr.fee_record_id AND fr.school_id = pr.school_id
    JOIN students s ON s.id = pr.student_id AND s.school_id = pr.school_id
    LEFT JOIN LATERAL (
      SELECT id
      FROM payment_attempts
      WHERE school_id = pr.school_id
        AND razorpay_payment_id = pr.razorpay_payment_id
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    ) pa ON TRUE
    WHERE pr.id = ${paymentRecordId}
      AND pr.school_id = ${schoolId}
    ${lockClause}
  `);
  const row = result.rows[0] as any;
  if (!row) return null;
  return {
    paymentRecordId: Number(row.payment_record_id),
    paymentAttemptId: row.payment_attempt_id == null ? null : Number(row.payment_attempt_id),
    schoolId: Number(row.school_id),
    sessionId: row.session_id ?? row.fee_session_id ?? null,
    studentId: Number(row.student_id),
    feeRecordId: Number(row.fee_record_id),
    invoiceNumber: row.invoice_number ?? null,
    studentName: String(row.student_name),
    digitalStudentId: String(row.digital_student_id),
    capturedAmountPaise: amountToPaise(row.amount),
    currency: "INR",
    paymentMethod: String(row.payment_method),
    gatewayStatus: row.gateway_status ?? null,
    razorpayPaymentId: row.razorpay_payment_id ?? null,
    razorpayOrderId: row.razorpay_order_id ?? null,
    paymentCreatedAt: row.payment_created_at ?? null,
  };
}

async function getSummary(
  executor: { execute: (query: any) => Promise<any> },
  schoolId: number,
  paymentRecordId: number,
  capturedAmountPaise: number,
): Promise<RefundFinancialSummary> {
  const result = await executor.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN local_status = 'processed'
        THEN COALESCE(processed_amount_paise, requested_amount_paise) ELSE 0 END), 0)::int AS processed_paise,
      COALESCE(SUM(CASE WHEN local_status = ANY(${ACTIVE_RESERVATION_STATUSES}::text[])
        THEN requested_amount_paise ELSE 0 END), 0)::int AS reserved_paise
    FROM refunds
    WHERE school_id = ${schoolId} AND payment_record_id = ${paymentRecordId}
  `);
  const row = result.rows[0] as any;
  const processedRefundedPaise = Number(row?.processed_paise ?? 0);
  const reservedPaise = Number(row?.reserved_paise ?? 0);
  const netRetainedPaise = Math.max(capturedAmountPaise - processedRefundedPaise, 0);
  const currentlyRefundablePaise = Math.max(netRetainedPaise - reservedPaise, 0);
  const paymentState =
    processedRefundedPaise >= capturedAmountPaise && capturedAmountPaise > 0 ? "fully_refunded" :
    processedRefundedPaise > 0 ? "partially_refunded" :
    reservedPaise > 0 ? "refund_pending" : "captured";
  return { processedRefundedPaise, reservedPaise, netRetainedPaise, currentlyRefundablePaise, paymentState };
}

export async function getRefundEligibility(schoolId: number, paymentRecordId: number): Promise<RefundEligibility | null> {
  const context = await findPaymentContext(db, schoolId, paymentRecordId);
  if (!context) return null;
  const summary = await getSummary(db, schoolId, paymentRecordId, context.capturedAmountPaise);
  let ineligibleReason: string | null = null;
  if (!isPortalPayment(context.paymentMethod)) ineligibleReason = "Only Razorpay portal payments can be refunded here.";
  else if (!context.razorpayPaymentId) ineligibleReason = "This online payment has no Razorpay payment ID.";
  else if (!["captured", null].includes(context.gatewayStatus)) ineligibleReason = "This payment is not captured.";
  else if (summary.currentlyRefundablePaise <= 0) ineligibleReason = "This payment has no refundable amount remaining.";
  return { ...context, ...summary, eligible: ineligibleReason == null, ineligibleReason };
}

async function appendRefundEvent(
  executor: { execute: (query: any) => Promise<any> },
  input: {
    schoolId: number; refundId: number; feeRecordId: number; paymentRecordId: number;
    paymentAttemptId?: number | null; eventType: string; localStatus?: string | null;
    providerStatus?: string | null; razorpayPaymentId: string; razorpayOrderId?: string | null;
    razorpayRefundId?: string | null; amountPaise?: number | null; currency?: string;
    source: "admin" | "webhook" | "system"; webhookDeliveryId?: number | null;
    correlationKey: string; payload?: unknown; providerOccurredAt?: Date | null; occurredAt?: Date | null;
  },
): Promise<void> {
  await executor.execute(sql`
    INSERT INTO refund_events (
      school_id, refund_id, fee_record_id, payment_record_id, payment_attempt_id,
      event_type, local_status, provider_status, razorpay_payment_id, razorpay_order_id,
      razorpay_refund_id, amount_paise, currency, source, webhook_delivery_id,
      correlation_key, payload, provider_occurred_at, occurred_at
    ) VALUES (
      ${input.schoolId}, ${input.refundId}, ${input.feeRecordId}, ${input.paymentRecordId}, ${input.paymentAttemptId ?? null},
      ${input.eventType}, ${input.localStatus ?? null}, ${input.providerStatus ?? null},
      ${input.razorpayPaymentId}, ${input.razorpayOrderId ?? null}, ${input.razorpayRefundId ?? null},
      ${input.amountPaise ?? null}, ${input.currency ?? "INR"}, ${input.source}, ${input.webhookDeliveryId ?? null},
      ${input.correlationKey}, ${input.payload == null ? null : JSON.stringify(sanitizePaymentPayload(input.payload))}::jsonb,
      ${input.providerOccurredAt?.toISOString() ?? null}, ${input.occurredAt?.toISOString() ?? null}
    )
    ON CONFLICT (school_id, correlation_key) DO NOTHING
  `);
}

async function recalculateFinancialProjection(
  executor: { execute: (query: any) => Promise<any> },
  context: RefundPaymentContext,
): Promise<RefundFinancialSummary> {
  const summary = await getSummary(executor, context.schoolId, context.paymentRecordId, context.capturedAmountPaise);
  const feeTotals = await executor.execute(sql`
    SELECT
      fr.amount, fr.late_fee_amount, fr.due_date,
      COALESCE(SUM(pr.amount), 0)::int AS gross_paid
    FROM fee_records fr
    LEFT JOIN payment_records pr
      ON pr.fee_record_id = fr.id AND pr.school_id = fr.school_id
    WHERE fr.id = ${context.feeRecordId} AND fr.school_id = ${context.schoolId}
    GROUP BY fr.id
  `);
  const fee = feeTotals.rows[0] as any;
  if (!fee) return summary;
  const refundTotals = await executor.execute(sql`
    SELECT COALESCE(SUM(COALESCE(processed_amount_paise, requested_amount_paise)), 0)::int AS refunded_paise
    FROM refunds
    WHERE school_id = ${context.schoolId}
      AND fee_record_id = ${context.feeRecordId}
      AND local_status = 'processed'
  `);
  const grossPaidPaise = amountToPaise(fee.gross_paid);
  const refundedPaise = Number((refundTotals.rows[0] as any)?.refunded_paise ?? 0);
  const invoicePaise = amountToPaise(Number(fee.amount ?? 0) + Number(fee.late_fee_amount ?? 0));
  const netPaidPaise = Math.max(grossPaidPaise - refundedPaise, 0);
  const outstandingPaise = Math.max(invoicePaise - netPaidPaise, 0);
  const dueDate = String(fee.due_date ?? "").slice(0, 10);
  const nextStatus = outstandingPaise <= 0 ? "Paid" : (dueDate && dueDate < todayInIST() ? "Overdue" : "Due");

  await executor.execute(sql`
    UPDATE fee_records
    SET status = ${nextStatus}
    WHERE id = ${context.feeRecordId} AND school_id = ${context.schoolId}
  `);

  if (context.paymentAttemptId) {
    const nextAttemptOutcome = summary.processedRefundedPaise >= context.capturedAmountPaise
      ? "refunded"
      : "captured";
    await executor.execute(sql`
      UPDATE payment_attempts
      SET amount_refunded_paise = ${summary.processedRefundedPaise},
          outcome = ${nextAttemptOutcome},
          updated_at = NOW()
      WHERE id = ${context.paymentAttemptId} AND school_id = ${context.schoolId}
    `);
    // Backward-compatible student projection: the student portal deliberately
    // receives the aggregate/refund-safe status, never Admin-only notes.
    await executor.execute(sql`
      UPDATE payment_attempts pa
      SET refund_id = latest.razorpay_refund_id,
          refund_status = 'processed',
          refund_amount_paise = ${summary.processedRefundedPaise},
          refund_processed_at = latest.provider_processed_at,
          refund_initiated_at = COALESCE(pa.refund_initiated_at, latest.requested_at)
      FROM (
        SELECT razorpay_refund_id, provider_processed_at, requested_at
        FROM refunds
        WHERE school_id = ${context.schoolId} AND payment_record_id = ${context.paymentRecordId}
          AND local_status = 'processed'
        ORDER BY provider_processed_at DESC NULLS LAST, id DESC LIMIT 1
      ) latest
      WHERE pa.id = ${context.paymentAttemptId} AND pa.school_id = ${context.schoolId}
    `);
  }
  return summary;
}

export async function reserveRefundRequest(input: {
  schoolId: number; paymentRecordId: number; amountPaise: number; reasonCode: RefundReasonCode;
  reasonText?: string | null; internalNote?: string | null; idempotencyKey: string;
  requestedBy: number; requesterIp?: string | null;
  afterReserve?: (tx: any, context: RefundPaymentContext, refund: any) => Promise<void>;
}): Promise<{ refund: any; summary: RefundFinancialSummary; idempotent: boolean; context: RefundPaymentContext }> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error("Refund amount must be a positive whole number of paise.");
  if (!REFUND_REASON_CODES.includes(input.reasonCode)) throw new Error("Choose a valid refund reason.");
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${input.schoolId}, ${input.paymentRecordId})`);
    const duplicate = await tx.execute(sql`
      SELECT * FROM refunds
      WHERE school_id = ${input.schoolId} AND idempotency_key = ${input.idempotencyKey}
      LIMIT 1
    `);
    const existing = duplicate.rows[0] as any;
    const context = await findPaymentContext(tx, input.schoolId, input.paymentRecordId, true);
    if (!context) throw new Error("Payment record not found.");
    const summary = await getSummary(tx, input.schoolId, input.paymentRecordId, context.capturedAmountPaise);
    if (existing) return { refund: existing, summary, idempotent: true, context };
    if (!isPortalPayment(context.paymentMethod) || !context.razorpayPaymentId) throw new Error("Only captured Razorpay portal payments can be refunded.");
    if (!["captured", null].includes(context.gatewayStatus)) throw new Error("This payment is not captured.");
    if (input.amountPaise > summary.currentlyRefundablePaise) throw new Error("Refund amount exceeds the currently refundable amount.");

    const inserted = await tx.execute(sql`
      INSERT INTO refunds (
        school_id, session_id, student_id, fee_record_id, payment_record_id, payment_attempt_id,
        razorpay_payment_id, razorpay_order_id, requested_amount_paise, currency, reason_code,
        reason_text, internal_note, origin, local_status, idempotency_key, requested_by, requester_ip
      ) VALUES (
        ${input.schoolId}, ${context.sessionId}, ${context.studentId}, ${context.feeRecordId},
        ${context.paymentRecordId}, ${context.paymentAttemptId}, ${context.razorpayPaymentId},
        ${context.razorpayOrderId}, ${input.amountPaise}, ${context.currency}, ${input.reasonCode},
        ${input.reasonText ?? null}, ${input.internalNote ?? null}, 'admin', 'requested',
        ${input.idempotencyKey}, ${input.requestedBy}, ${input.requesterIp ?? null}
      ) RETURNING *
    `);
    const refund = inserted.rows[0] as any;
    await appendRefundEvent(tx, {
      schoolId: input.schoolId, refundId: Number(refund.id), feeRecordId: context.feeRecordId,
      paymentRecordId: context.paymentRecordId, paymentAttemptId: context.paymentAttemptId,
      eventType: "refund_requested", localStatus: "requested", razorpayPaymentId: context.razorpayPaymentId,
      razorpayOrderId: context.razorpayOrderId, amountPaise: input.amountPaise, source: "admin",
      correlationKey: `request:${input.schoolId}:${input.idempotencyKey}`,
      payload: { reasonCode: input.reasonCode, reasonText: input.reasonText ?? null },
      occurredAt: new Date(),
    });
    if (input.afterReserve) await input.afterReserve(tx, context, refund);
    return {
      refund,
      summary: { ...summary, reservedPaise: summary.reservedPaise + input.amountPaise, currentlyRefundablePaise: summary.currentlyRefundablePaise - input.amountPaise, paymentState: "refund_pending" },
      idempotent: false,
      context,
    };
  });
}

export async function recordRefundApiSubmission(
  schoolId: number,
  refundId: number,
  providerRefund: any,
  options?: {
    afterSubmission?: (
      tx: any,
      context: RefundPaymentContext,
      state: { action: "refund_created"; refundId: number; amountPaise: number },
    ) => Promise<void>;
    afterSuperseded?: (
      tx: any,
      context: RefundPaymentContext,
      state: { action: "refund_superseded"; refundId: number; amountPaise: number },
    ) => Promise<void>;
  },
): Promise<any> {
  const result = await db.transaction(async tx => {
    const providerId = providerRefund?.id ?? null;
    // A webhook may arrive before the synchronous Razorpay API response. Keep
    // the webhook-authoritative entity and retire the local reservation rather
    // than colliding on the provider-refund uniqueness constraint.
    if (providerId) {
      const webhookWinner = (await tx.execute(sql`
        SELECT * FROM refunds
        WHERE school_id = ${schoolId} AND razorpay_refund_id = ${providerId} AND id <> ${refundId}
        LIMIT 1 FOR UPDATE
      `)).rows[0] as any;
      if (webhookWinner) {
        const retired = (await tx.execute(sql`
          UPDATE refunds SET local_status = 'superseded', last_reconciled_at = NOW(), updated_at = NOW()
          WHERE id = ${refundId} AND school_id = ${schoolId} RETURNING *
        `)).rows[0] as any;
        if (retired) await appendRefundEvent(tx, {
          schoolId, refundId, feeRecordId: Number(retired.fee_record_id), paymentRecordId: Number(retired.payment_record_id),
          paymentAttemptId: retired.payment_attempt_id == null ? null : Number(retired.payment_attempt_id),
          eventType: "refund_api_reconciled_to_webhook", localStatus: "superseded",
          razorpayPaymentId: retired.razorpay_payment_id, razorpayOrderId: retired.razorpay_order_id,
          razorpayRefundId: providerId, amountPaise: Number(retired.requested_amount_paise), source: "system",
          correlationKey: `api-webhook-race:${schoolId}:${refundId}:${providerId}`, payload: providerRefund, occurredAt: new Date(),
        });
        if (retired && options?.afterSuperseded) {
          const context = await findPaymentContext(tx, schoolId, Number(retired.payment_record_id));
          if (!context) throw new Error("Refund payment context not found.");
          await options.afterSuperseded(tx, context, {
            action: "refund_superseded",
            refundId,
            amountPaise: Number(retired.requested_amount_paise),
          });
        }
        return webhookWinner;
      }
    }
    const current = (await tx.execute(sql`
      SELECT r.*, pr.id AS payment_record_id, pr.amount, pr.razorpay_payment_id, pr.razorpay_order_id,
             pa.id AS payment_attempt_id
      FROM refunds r
      JOIN payment_records pr ON pr.id = r.payment_record_id AND pr.school_id = r.school_id
      LEFT JOIN payment_attempts pa ON pa.school_id = r.school_id AND pa.razorpay_payment_id = pr.razorpay_payment_id
      WHERE r.id = ${refundId} AND r.school_id = ${schoolId}
      LIMIT 1
    `)).rows[0] as any;
    if (!current) throw new Error("Refund request not found.");
    const status = String(providerRefund?.status ?? "created");
    const update = await tx.execute(sql`
      UPDATE refunds
      SET local_status = 'created',
          provider_status = ${status},
          razorpay_refund_id = COALESCE(${providerId}, razorpay_refund_id),
          provider_created_at = COALESCE(${providerDate(providerRefund)?.toISOString() ?? null}::timestamptz, provider_created_at),
          provider_payload = ${JSON.stringify(sanitizePaymentPayload(providerRefund ?? {}))}::jsonb,
          last_reconciled_at = NOW(),
          updated_at = NOW()
      WHERE id = ${refundId} AND school_id = ${schoolId}
      RETURNING *
    `);
    const stored = update.rows[0] as any;
    await appendRefundEvent(tx, {
      schoolId, refundId, feeRecordId: Number(current.fee_record_id), paymentRecordId: Number(current.payment_record_id),
      paymentAttemptId: current.payment_attempt_id == null ? null : Number(current.payment_attempt_id),
      eventType: "refund_api_submitted", localStatus: "created", providerStatus: status,
      razorpayPaymentId: current.razorpay_payment_id, razorpayOrderId: current.razorpay_order_id,
      razorpayRefundId: providerId, amountPaise: Number(providerRefund?.amount ?? current.requested_amount_paise),
      source: "system", correlationKey: `api:${schoolId}:${refundId}:${providerId ?? "without-id"}`,
      payload: providerRefund, providerOccurredAt: providerDate(providerRefund), occurredAt: new Date(),
    });
    if (options?.afterSubmission) {
      const context = await findPaymentContext(tx, schoolId, Number(current.payment_record_id));
      if (!context) throw new Error("Refund payment context not found.");
      await options.afterSubmission(tx, context, {
        action: "refund_created",
        refundId,
        amountPaise: Number(providerRefund?.amount ?? current.requested_amount_paise),
      });
    }
    return stored;
  });
  return result;
}

export async function markRefundReconciliationRequired(
  schoolId: number,
  refundId: number,
  error: unknown,
  options?: {
    afterUpdate?: (
      tx: any,
      context: RefundPaymentContext,
      state: { action: "refund_reconciliation_required"; refundId: number; amountPaise: number },
    ) => Promise<void>;
  },
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.transaction(async tx => {
    const row = (await tx.execute(sql`
      UPDATE refunds
      SET local_status = 'reconciliation_required', failure_message = ${message},
          last_reconciled_at = NOW(), updated_at = NOW()
      WHERE id = ${refundId} AND school_id = ${schoolId}
      RETURNING *
    `)).rows[0] as any;
    if (!row) return;
    await appendRefundEvent(tx, {
      schoolId, refundId, feeRecordId: Number(row.fee_record_id), paymentRecordId: Number(row.payment_record_id),
      paymentAttemptId: row.payment_attempt_id == null ? null : Number(row.payment_attempt_id),
      eventType: "refund_reconciliation_required", localStatus: "reconciliation_required",
      providerStatus: row.provider_status ?? null, razorpayPaymentId: row.razorpay_payment_id,
      razorpayOrderId: row.razorpay_order_id, razorpayRefundId: row.razorpay_refund_id,
      amountPaise: Number(row.requested_amount_paise), source: "system",
      correlationKey: `reconciliation-required:${schoolId}:${refundId}:${row.updated_at}`,
      payload: { error: message }, occurredAt: new Date(),
    });
    if (options?.afterUpdate) {
      const context = await findPaymentContext(tx, schoolId, Number(row.payment_record_id));
      if (!context) throw new Error("Refund payment context not found.");
      await options.afterUpdate(tx, context, {
        action: "refund_reconciliation_required",
        refundId,
        amountPaise: Number(row.requested_amount_paise),
      });
    }
  });
}

export async function markRefundProviderFailure(
  schoolId: number,
  refundId: number,
  error: unknown,
  options?: {
    afterFailure?: (
      tx: any,
      context: RefundPaymentContext,
      state: { action: "refund_failed"; refundId: number; amountPaise: number },
    ) => Promise<void>;
  },
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.transaction(async tx => {
    const row = (await tx.execute(sql`
      UPDATE refunds SET local_status = 'failed', failure_message = ${message}, updated_at = NOW()
      WHERE id = ${refundId} AND school_id = ${schoolId} RETURNING *
    `)).rows[0] as any;
    if (!row) return;
    await appendRefundEvent(tx, {
      schoolId, refundId, feeRecordId: Number(row.fee_record_id), paymentRecordId: Number(row.payment_record_id),
      paymentAttemptId: row.payment_attempt_id == null ? null : Number(row.payment_attempt_id),
      eventType: "refund_provider_rejected", localStatus: "failed", razorpayPaymentId: row.razorpay_payment_id,
      razorpayOrderId: row.razorpay_order_id, amountPaise: Number(row.requested_amount_paise), source: "system",
      correlationKey: `provider-rejected:${schoolId}:${refundId}`, payload: { error: message }, occurredAt: new Date(),
    });
    if (options?.afterFailure) {
      const context = await findPaymentContext(tx, schoolId, Number(row.payment_record_id));
      if (!context) throw new Error("Refund payment context not found.");
      await options.afterFailure(tx, context, {
        action: "refund_failed",
        refundId,
        amountPaise: Number(row.requested_amount_paise),
      });
    }
  });
}

export async function reconcileRefundWebhook(input: {
  schoolId: number; refund: any; eventType: "refund.created" | "refund.processed" | "refund.failed" | "refund.speed_changed";
  webhookDeliveryId: number; fallbackFeeRecordId?: number | null; fallbackStudentId?: number | null; fallbackSessionId?: number | null;
  afterReconcile?: (
    tx: any,
    context: RefundPaymentContext,
    state: { action: string; localStatus: string; amountPaise: number; refundId: number },
  ) => Promise<void>;
}): Promise<{ refundId: number | null; feeRecordId: number | null; paymentRecordId: number | null; summary: RefundFinancialSummary | null }> {
  const razorpayRefundId = input.refund?.id ? String(input.refund.id) : null;
  const razorpayPaymentId = input.refund?.payment_id ? String(input.refund.payment_id) : null;
  if (!razorpayRefundId || !razorpayPaymentId) return { refundId: null, feeRecordId: input.fallbackFeeRecordId ?? null, paymentRecordId: null, summary: null };
  return db.transaction(async tx => {
    const existing = (await tx.execute(sql`
      SELECT * FROM refunds
      WHERE school_id = ${input.schoolId} AND razorpay_refund_id = ${razorpayRefundId}
      LIMIT 1
      FOR UPDATE
    `)).rows[0] as any;
    let row = existing;
    let context: RefundPaymentContext | null = null;
    if (row) {
      context = await findPaymentContext(tx, input.schoolId, Number(row.payment_record_id), true);
    } else {
      const paymentRow = (await tx.execute(sql`
        SELECT id FROM payment_records
        WHERE school_id = ${input.schoolId}
          AND payment_method IN ('Online', 'Portal Payment')
          AND razorpay_payment_id = ${razorpayPaymentId}
        LIMIT 2
      `)).rows as any[];
      if (paymentRow.length !== 1) return { refundId: null, feeRecordId: input.fallbackFeeRecordId ?? null, paymentRecordId: null, summary: null };
      context = await findPaymentContext(tx, input.schoolId, Number(paymentRow[0].id), true);
      if (!context) return { refundId: null, feeRecordId: input.fallbackFeeRecordId ?? null, paymentRecordId: null, summary: null };
      const created = await tx.execute(sql`
        INSERT INTO refunds (
          school_id, session_id, student_id, fee_record_id, payment_record_id, payment_attempt_id,
          razorpay_payment_id, razorpay_order_id, razorpay_refund_id, requested_amount_paise,
          currency, origin, local_status, provider_status, idempotency_key, requested_at, provider_payload
        ) VALUES (
          ${input.schoolId}, ${context.sessionId}, ${context.studentId}, ${context.feeRecordId},
          ${context.paymentRecordId}, ${context.paymentAttemptId}, ${razorpayPaymentId}, ${context.razorpayOrderId},
          ${razorpayRefundId}, ${Number(input.refund.amount ?? 0)}, ${input.refund.currency ?? "INR"},
          'webhook', 'created', ${input.refund.status ?? null}, ${`webhook-refund:${razorpayRefundId}`}, NOW(),
          ${JSON.stringify(sanitizePaymentPayload(input.refund))}::jsonb
        )
        ON CONFLICT (school_id, razorpay_refund_id) WHERE razorpay_refund_id IS NOT NULL
        DO UPDATE SET updated_at = NOW()
        RETURNING *
      `);
      row = created.rows[0] as any;
    }
    if (!context) return { refundId: null, feeRecordId: null, paymentRecordId: null, summary: null };
    const map = input.eventType === "refund.processed"
      ? { local: "processed", event: "refund_processed" }
      : input.eventType === "refund.failed"
        ? { local: "failed", event: "refund_failed" }
        : input.eventType === "refund.created"
          ? { local: "created", event: "refund_created" }
          : { local: "created", event: "refund_speed_changed" };
    // Provider deliveries can be duplicated or delayed. A processed refund is
    // financially terminal and must never be regressed by a stale created/failed
    // callback. Every delivery is still retained below as an append-only event.
    const effectiveLocal = row.local_status === "processed" ? "processed" : map.local;
    const processed = effectiveLocal === "processed";
    const failure = effectiveLocal === "failed";
    const amount = Number(input.refund.amount ?? row.requested_amount_paise);
    const updated = await tx.execute(sql`
      UPDATE refunds
      SET local_status = ${effectiveLocal},
          provider_status = ${input.refund.status ?? map.local},
          processed_amount_paise = CASE WHEN ${processed} THEN ${amount} ELSE processed_amount_paise END,
          provider_created_at = COALESCE(${providerDate(input.refund)?.toISOString() ?? null}::timestamptz, provider_created_at),
          provider_processed_at = CASE WHEN ${processed} THEN COALESCE(${providerDate(input.refund)?.toISOString() ?? null}::timestamptz, NOW()) ELSE provider_processed_at END,
          failure_code = CASE WHEN ${failure} THEN ${input.refund?.error_code ?? null} ELSE failure_code END,
          failure_message = CASE WHEN ${failure} THEN ${input.refund?.error_description ?? null} ELSE failure_message END,
          provider_payload = ${JSON.stringify(sanitizePaymentPayload(input.refund))}::jsonb,
          last_reconciled_at = NOW(), updated_at = NOW()
      WHERE id = ${Number(row.id)} AND school_id = ${input.schoolId}
      RETURNING *
    `);
    const stored = updated.rows[0] as any;
    await appendRefundEvent(tx, {
      schoolId: input.schoolId, refundId: Number(stored.id), feeRecordId: context.feeRecordId,
      paymentRecordId: context.paymentRecordId, paymentAttemptId: context.paymentAttemptId,
      eventType: map.event, localStatus: effectiveLocal, providerStatus: stored.provider_status,
      razorpayPaymentId, razorpayOrderId: context.razorpayOrderId, razorpayRefundId,
      amountPaise: amount, source: "webhook", webhookDeliveryId: input.webhookDeliveryId,
      correlationKey: `webhook-refund:${input.webhookDeliveryId}:${razorpayRefundId}:${map.event}`,
      payload: input.refund, providerOccurredAt: providerDate(input.refund), occurredAt: new Date(),
    });
    const summary = await recalculateFinancialProjection(tx, context);
    if (input.afterReconcile) {
      await input.afterReconcile(tx, context, {
        action: map.event,
        localStatus: effectiveLocal,
        amountPaise: amount,
        refundId: Number(stored.id),
      });
    }
    return { refundId: Number(stored.id), feeRecordId: context.feeRecordId, paymentRecordId: context.paymentRecordId, summary };
  });
}