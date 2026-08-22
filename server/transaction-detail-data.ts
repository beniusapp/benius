import { sql } from "drizzle-orm";
import { db } from "./db";
import {
  calculateLateFee,
  DEFAULT_LATE_FEE_CONFIG,
  type LateFeeConfig,
} from "./late-fee-engine";
import { formatOfflinePaymentMethod } from "@shared/offline-payment-method";
import { isPortalPayment, normalizePaymentMethod } from "@shared/payment-method";

function rowsOf(result: { rows?: unknown[] }): any[] {
  return Array.isArray(result.rows) ? result.rows : [];
}

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

/**
 * Loads the complete, tenant-scoped transaction evidence for one invoice.
 *
 * Both the admin JSON detail endpoint and printable audit report use this
 * function so they cannot silently drift to different financial or lifecycle
 * sources.
 */
export async function loadTransactionDetailData(
  schoolId: number,
  feeRecordId: number,
): Promise<Record<string, any> | null> {
  const feeResult = await db.execute(sql`
    SELECT
      fr.*,
      s.name AS student_name,
      s.digital_student_id,
      s.class,
      s.section,
      s.roll_number,
      s.guardian_name,
      s.phone,
      s.email AS student_email,
      sc.name AS school_name,
      sc.logo_url AS school_logo_url,
      sc.address_line1 AS school_address_line1,
      sc.address_line2 AS school_address_line2,
      sc.city AS school_city,
      sc.state AS school_state,
      sc.pin_code AS school_pin_code,
      sc.country AS school_country,
      sc.phone AS school_phone,
      sc.email AS school_email,
      sc.affiliation_number AS school_affiliation_number,
      sc.gstin AS school_gstin,
      sess.session_name AS academic_session_name,
      creator.email AS created_by_name
    FROM fee_records fr
    JOIN students s
      ON s.id = fr.student_id
     AND s.school_id = fr.school_id
    JOIN schools sc
      ON sc.id = fr.school_id
    LEFT JOIN academic_sessions sess
      ON sess.id = fr.session_id
     AND sess.school_id = fr.school_id
    LEFT JOIN users creator
      ON creator.id = fr.created_by
     AND creator.school_id = fr.school_id
    WHERE fr.id = ${feeRecordId}
      AND fr.school_id = ${schoolId}
    LIMIT 1
  `);
  const feeRow = rowsOf(feeResult)[0];
  if (!feeRow) return null;

  const [
    paymentResult,
    refundResult,
    attemptResult,
    auditResult,
  ] = await Promise.all([
    db.execute(sql`
      SELECT
        pr.*,
        recorder.email AS recorded_by_name,
        opd.transaction_time,
        opd.instrument_status,
        opd.transfer_mode,
        opd.transaction_reference,
        opd.receiving_bank,
        opd.receiver_upi_id,
        opd.payee_name,
        opd.payable_at,
        opd.collection_location,
        opd.deposit_date,
        opd.deposit_bank,
        opd.deposit_reference,
        opd.return_date,
        opd.return_reason
      FROM payment_records pr
      LEFT JOIN users recorder
        ON recorder.id = pr.recorded_by
       AND recorder.school_id = pr.school_id
      LEFT JOIN offline_payment_details opd
        ON opd.payment_record_id = pr.id
       AND opd.school_id = pr.school_id
      WHERE pr.fee_record_id = ${feeRecordId}
        AND pr.school_id = ${schoolId}
      ORDER BY pr.created_at DESC, pr.id DESC
    `),
    db.execute(sql`
      SELECT
        r.id,
        r.payment_record_id,
        r.payment_attempt_id,
        r.razorpay_payment_id,
        r.razorpay_order_id,
        r.razorpay_refund_id,
        r.requested_amount_paise,
        r.processed_amount_paise,
        r.currency,
        r.reason_code,
        r.reason_text,
        r.internal_note,
        r.origin,
        r.local_status,
        r.provider_status,
        r.requested_by,
        requester.email AS requested_by_name,
        r.requested_at,
        r.provider_created_at,
        r.provider_processed_at,
        r.last_reconciled_at,
        r.failure_code,
        r.failure_message,
        r.created_at,
        r.updated_at
      FROM refunds r
      LEFT JOIN users requester
        ON requester.id = r.requested_by
       AND requester.school_id = r.school_id
      WHERE r.fee_record_id = ${feeRecordId}
        AND r.school_id = ${schoolId}
      ORDER BY r.requested_at ASC, r.id ASC
    `),
    db.execute(sql`
      SELECT
        id,
        external_id,
        attempt_number,
        student_id,
        fee_record_id,
        session_id,
        outcome,
        source,
        razorpay_payment_id,
        razorpay_order_id,
        amount_paise,
        amount_captured_paise,
        amount_refunded_paise,
        razorpay_fee_paise,
        razorpay_tax_paise,
        currency,
        payment_method,
        card_network,
        card_last4,
        card_type,
        card_issuer,
        card_name,
        card_international,
        card_emi,
        bank_name,
        bank_rrn,
        bank_auth_code,
        vpa,
        wallet,
        payer_name,
        payer_email,
        payer_contact,
        error_code,
        error_description,
        error_source,
        error_step,
        error_reason,
        rzp_created_at,
        rzp_authorized_at,
        rzp_captured_at,
        rzp_failed_at,
        refund_id,
        refund_status,
        refund_amount_paise,
        refund_initiated_at,
        refund_processed_at,
        webhook_event,
        webhook_received_at,
        webhook_verified,
        api_synced_at,
        api_enrichment_status,
        api_enrichment_error,
        receipt_number,
        created_at,
        updated_at
      FROM payment_attempts
      WHERE fee_record_id = ${feeRecordId}
        AND school_id = ${schoolId}
      ORDER BY COALESCE(attempt_number, 0) ASC, created_at ASC, id ASC
    `),
    db.execute(sql`
      SELECT
        id,
        action,
        entity_type,
        entity_id,
        actor_name,
        actor_id,
        student_id,
        session_id,
        razorpay_payment_id,
        razorpay_order_id,
        amount,
        currency,
        error_code,
        error_source,
        error_step,
        error_reason,
        payment_method,
        description,
        created_at
      FROM fee_audit_log
      WHERE school_id = ${schoolId}
        AND entity_type = 'fee_record'
        AND entity_id = ${feeRecordId}
      ORDER BY created_at ASC, id ASC
    `),
  ]);

  const paymentRows = rowsOf(paymentResult);
  const refundRows = rowsOf(refundResult);
  const attemptRows = rowsOf(attemptResult);
  const auditRows = rowsOf(auditResult);
  const paymentIds = paymentRows.map((row) => Number(row.id));
  const attemptIds = attemptRows.map((row) => Number(row.id));
  const refundIds = refundRows.map((row) => Number(row.id));

  const [
    correctionResult,
    attemptEventResult,
    webhookResult,
    refundEventResult,
  ] = await Promise.all([
    paymentIds.length > 0
      ? db.execute(sql`
          SELECT
            rev.id,
            rev.payment_record_id,
            rev.reason,
            rev.previous_values,
            rev.new_values,
            rev.changed_by,
            rev.created_at,
            u.email AS changed_by_name
          FROM offline_payment_detail_revisions rev
          LEFT JOIN users u
            ON u.id = rev.changed_by
           AND u.school_id = rev.school_id
          WHERE rev.school_id = ${schoolId}
            AND rev.payment_record_id = ANY(${paymentIds}::int[])
          ORDER BY rev.created_at ASC, rev.id ASC
        `)
      : Promise.resolve({ rows: [] }),
    attemptIds.length > 0
      ? db.execute(sql`
          SELECT
            id,
            payment_attempt_id,
            event_type,
            outcome,
            source,
            razorpay_payment_id,
            razorpay_order_id,
            refund_id,
            dispute_id,
            amount_paise,
            currency,
            provider_occurred_at,
            occurred_at,
            recorded_at,
            historical,
            payload,
            webhook_event_id
          FROM payment_attempt_events
          WHERE school_id = ${schoolId}
            AND fee_record_id = ${feeRecordId}
            AND payment_attempt_id = ANY(${attemptIds}::int[])
          ORDER BY COALESCE(provider_occurred_at, occurred_at, recorded_at) ASC, id ASC
        `)
      : Promise.resolve({ rows: [] }),
    db.execute(sql`
      SELECT
        pwe.id,
        pwe.provider_event_id,
        pwe.event_type,
        pwe.razorpay_payment_id,
        pwe.razorpay_order_id,
        pwe.razorpay_refund_id,
        pwe.razorpay_dispute_id,
        pwe.signature_verified,
        pwe.verification_status,
        pwe.provider_occurred_at,
        pwe.fee_resolution_source,
        pwe.fee_resolution_status,
        pwe.resolution_reason,
        pwe.processing_status,
        pwe.processing_error,
        pwe.received_at,
        pwe.last_received_at,
        pwe.processed_at,
        pwe.delivery_count,
        pwe.payload
      FROM payment_webhook_events pwe
      WHERE pwe.school_id = ${schoolId}
        AND (
          pwe.fee_record_id = ${feeRecordId}
          OR EXISTS (
            SELECT 1
            FROM payment_attempts pa
            WHERE pa.school_id = ${schoolId}
              AND pa.fee_record_id = ${feeRecordId}
              AND (
                (pwe.razorpay_payment_id IS NOT NULL
                  AND pa.razorpay_payment_id = pwe.razorpay_payment_id)
                OR
                (pwe.razorpay_order_id IS NOT NULL
                  AND pa.razorpay_order_id = pwe.razorpay_order_id)
              )
          )
        )
      ORDER BY pwe.received_at ASC, pwe.id ASC
    `),
    refundIds.length > 0
      ? db.execute(sql`
          SELECT
            id,
            refund_id,
            fee_record_id,
            payment_record_id,
            payment_attempt_id,
            event_type,
            local_status,
            provider_status,
            razorpay_payment_id,
            razorpay_order_id,
            razorpay_refund_id,
            amount_paise,
            currency,
            source,
            webhook_delivery_id,
            provider_occurred_at,
            occurred_at,
            recorded_at
          FROM refund_events
          WHERE school_id = ${schoolId}
            AND fee_record_id = ${feeRecordId}
            AND refund_id = ANY(${refundIds}::int[])
          ORDER BY COALESCE(provider_occurred_at, occurred_at, recorded_at) ASC, id ASC
        `)
      : Promise.resolve({ rows: [] }),
  ]);

  const correctionRows = rowsOf(correctionResult);
  const attemptEventRows = rowsOf(attemptEventResult);
  const webhookRows = rowsOf(webhookResult);
  const refundEventRows = rowsOf(refundEventResult);
  const webhookIds = webhookRows.map((row) => Number(row.id));

  const webhookProcessingRows = webhookIds.length > 0
    ? rowsOf(await db.execute(sql`
        SELECT
          wpe.id,
          wpe.webhook_delivery_id,
          wpe.status,
          wpe.error,
          wpe.created_at
        FROM payment_webhook_processing_events wpe
        JOIN payment_webhook_events pwe
          ON pwe.id = wpe.webhook_delivery_id
         AND pwe.school_id = ${schoolId}
        WHERE wpe.school_id = ${schoolId}
          AND wpe.webhook_delivery_id = ANY(${webhookIds}::int[])
        ORDER BY wpe.created_at ASC, wpe.id ASC
      `))
    : [];

  const correctionsByPayment = new Map<number, any[]>();
  for (const revision of correctionRows) {
    const paymentRecordId = Number(revision.payment_record_id);
    const corrections = correctionsByPayment.get(paymentRecordId) ?? [];
    corrections.push({
      id: Number(revision.id),
      reason: revision.reason,
      changedBy: numberOrNull(revision.changed_by),
      changedByName: revision.changed_by_name ?? null,
      previousValues: revision.previous_values ?? {},
      newValues: revision.new_values ?? {},
      createdAt: revision.created_at,
    });
    correctionsByPayment.set(paymentRecordId, corrections);
  }

  const eventsByAttempt = new Map<number, any[]>();
  const paymentAttemptEvents = attemptEventRows.map((event) => {
    const mapped = {
      id: Number(event.id),
      paymentAttemptId: Number(event.payment_attempt_id),
      eventType: event.event_type,
      outcome: event.outcome ?? null,
      source: event.source,
      razorpayPaymentId: event.razorpay_payment_id ?? null,
      razorpayOrderId: event.razorpay_order_id ?? null,
      refundId: event.refund_id ?? null,
      disputeId: event.dispute_id ?? null,
      amountPaise: numberOrNull(event.amount_paise),
      currency: event.currency ?? "INR",
      providerOccurredAt: event.provider_occurred_at ?? null,
      occurredAt: event.occurred_at ?? null,
      recordedAt: event.recorded_at,
      historical: Boolean(event.historical),
      payload: event.payload ?? null,
      webhookEventId: numberOrNull(event.webhook_event_id),
    };
    const events = eventsByAttempt.get(mapped.paymentAttemptId) ?? [];
    events.push(mapped);
    eventsByAttempt.set(mapped.paymentAttemptId, events);
    return mapped;
  });

  const mapPayment = (row: any) => {
    const online = isPortalPayment(row.payment_method);
    const offlineDetail = online ? null : {
      transactionTime: row.transaction_time ?? null,
      instrumentStatus: row.instrument_status ?? null,
      transferMode: row.transfer_mode ?? null,
      transactionReference: row.transaction_reference ?? null,
      receivingBank: row.receiving_bank ?? null,
      receiverUpiId: row.receiver_upi_id ?? null,
      payeeName: row.payee_name ?? null,
      payableAt: row.payable_at ?? null,
      collectionLocation: row.collection_location ?? null,
      depositDate: row.deposit_date ?? null,
      depositBank: row.deposit_bank ?? null,
      depositReference: row.deposit_reference ?? null,
      returnDate: row.return_date ?? null,
      returnReason: row.return_reason ?? null,
    };
    return {
      id: Number(row.id),
      feeRecordId: numberOrNull(row.fee_record_id),
      studentId: Number(row.student_id),
      paymentMethod: online
        ? (normalizePaymentMethod(row.payment_method) ?? row.payment_method ?? "Unavailable")
        : (formatOfflinePaymentMethod(row.payment_method) ?? row.payment_method ?? "Unavailable"),
      rawPaymentMethod: row.payment_method,
      amount: Number(row.amount),
      lateFeePaid: Number(row.late_fee_paid ?? 0),
      receivedDate: row.received_date,
      referenceNumber: row.reference_number ?? null,
      cashierNotes: row.cashier_notes ?? null,
      receiptNumber: row.receipt_number ?? null,
      razorpayPaymentId: row.razorpay_payment_id ?? null,
      razorpayOrderId: row.razorpay_order_id ?? null,
      razorpaySignature: row.razorpay_signature ?? null,
      paymentMode: row.payment_mode ?? null,
      bankName: row.bank_name ?? null,
      cardLast4: row.card_last4 ?? null,
      vpa: row.vpa ?? null,
      payerName: row.payer_name ?? null,
      payerEmail: row.payer_email ?? null,
      payerContact: row.payer_contact ?? null,
      gatewayStatus: row.gateway_status ?? null,
      createdAt: row.created_at,
      denominationBreakdown: row.denomination_breakdown ?? null,
      instrumentDate: row.cheque_date ?? null,
      branchName: row.branch_name ?? null,
      recordedBy: numberOrNull(row.recorded_by),
      recordedByName: row.recorded_by_name ?? null,
      offlineDetail,
      corrections: correctionsByPayment.get(Number(row.id)) ?? [],
    };
  };

  const payments = paymentRows.map(mapPayment);
  const paymentRecordByExternalId = new Map<string, number>();
  const paymentRecordByGatewayId = new Map<string, number>();
  for (const payment of payments) {
    paymentRecordByExternalId.set(`pr:${payment.id}`, payment.id);
    if (payment.razorpayPaymentId) {
      paymentRecordByGatewayId.set(payment.razorpayPaymentId, payment.id);
    }
  }

  const paymentAttempts = attemptRows.map((attempt) => ({
    id: Number(attempt.id),
    externalId: attempt.external_id ?? null,
    paymentRecordId:
      (attempt.external_id
        ? paymentRecordByExternalId.get(attempt.external_id)
        : undefined)
      ?? (attempt.razorpay_payment_id
        ? paymentRecordByGatewayId.get(attempt.razorpay_payment_id)
        : undefined)
      ?? null,
    attemptNumber: numberOrNull(attempt.attempt_number),
    studentId: numberOrNull(attempt.student_id),
    feeRecordId: numberOrNull(attempt.fee_record_id),
    sessionId: numberOrNull(attempt.session_id),
    outcome: attempt.outcome,
    source: attempt.source,
    razorpayPaymentId: attempt.razorpay_payment_id ?? null,
    razorpayOrderId: attempt.razorpay_order_id ?? null,
    amountPaise: numberOrNull(attempt.amount_paise),
    amountCapturedPaise: numberOrNull(attempt.amount_captured_paise),
    amountRefundedPaise: numberOrNull(attempt.amount_refunded_paise),
    razorpayFeePaise: numberOrNull(attempt.razorpay_fee_paise),
    razorpayTaxPaise: numberOrNull(attempt.razorpay_tax_paise),
    currency: attempt.currency ?? "INR",
    paymentMethod: attempt.payment_method ?? null,
    cardNetwork: attempt.card_network ?? null,
    cardLast4: attempt.card_last4 ?? null,
    cardType: attempt.card_type ?? null,
    cardIssuer: attempt.card_issuer ?? null,
    cardName: attempt.card_name ?? null,
    cardInternational: attempt.card_international == null
      ? null
      : Boolean(attempt.card_international),
    cardEmi: attempt.card_emi == null ? null : Boolean(attempt.card_emi),
    bankName: attempt.bank_name ?? null,
    bankRrn: attempt.bank_rrn ?? null,
    bankAuthCode: attempt.bank_auth_code ?? null,
    vpa: attempt.vpa ?? null,
    wallet: attempt.wallet ?? null,
    payerName: attempt.payer_name ?? null,
    payerEmail: attempt.payer_email ?? null,
    payerContact: attempt.payer_contact ?? null,
    errorCode: attempt.error_code ?? null,
    errorDescription: attempt.error_description ?? null,
    errorSource: attempt.error_source ?? null,
    errorStep: attempt.error_step ?? null,
    errorReason: attempt.error_reason ?? null,
    rzpCreatedAt: attempt.rzp_created_at ?? null,
    rzpAuthorizedAt: attempt.rzp_authorized_at ?? null,
    rzpCapturedAt: attempt.rzp_captured_at ?? null,
    rzpFailedAt: attempt.rzp_failed_at ?? null,
    refundId: attempt.refund_id ?? null,
    refundStatus: attempt.refund_status ?? null,
    refundAmountPaise: numberOrNull(attempt.refund_amount_paise),
    refundInitiatedAt: attempt.refund_initiated_at ?? null,
    refundProcessedAt: attempt.refund_processed_at ?? null,
    webhookEvent: attempt.webhook_event ?? null,
    webhookReceivedAt: attempt.webhook_received_at ?? null,
    webhookVerified: attempt.webhook_verified == null
      ? null
      : Boolean(attempt.webhook_verified),
    apiSyncedAt: attempt.api_synced_at ?? null,
    apiEnrichmentStatus: attempt.api_enrichment_status ?? null,
    apiEnrichmentError: attempt.api_enrichment_error ?? null,
    receiptNumber: attempt.receipt_number ?? null,
    createdAt: attempt.created_at,
    updatedAt: attempt.updated_at,
    events: eventsByAttempt.get(Number(attempt.id)) ?? [],
  }));

  const refundEvents = refundEventRows.map((event) => ({
    id: Number(event.id),
    refundId: Number(event.refund_id),
    feeRecordId: numberOrNull(event.fee_record_id),
    paymentRecordId: numberOrNull(event.payment_record_id),
    paymentAttemptId: numberOrNull(event.payment_attempt_id),
    eventType: event.event_type,
    localStatus: event.local_status ?? null,
    providerStatus: event.provider_status ?? null,
    razorpayPaymentId: event.razorpay_payment_id ?? null,
    razorpayOrderId: event.razorpay_order_id ?? null,
    razorpayRefundId: event.razorpay_refund_id ?? null,
    amountPaise: numberOrNull(event.amount_paise),
    currency: event.currency ?? "INR",
    source: event.source,
    webhookDeliveryId: numberOrNull(event.webhook_delivery_id),
    providerOccurredAt: event.provider_occurred_at ?? null,
    occurredAt: event.occurred_at ?? null,
    recordedAt: event.recorded_at,
  }));
  const eventsByRefund = new Map<number, any[]>();
  for (const event of refundEvents) {
    const events = eventsByRefund.get(event.refundId) ?? [];
    events.push(event);
    eventsByRefund.set(event.refundId, events);
  }

  const refunds = refundRows.map((refund) => ({
    id: Number(refund.id),
    paymentRecordId: Number(refund.payment_record_id),
    paymentAttemptId: numberOrNull(refund.payment_attempt_id),
    razorpayPaymentId: refund.razorpay_payment_id,
    razorpayOrderId: refund.razorpay_order_id ?? null,
    razorpayRefundId: refund.razorpay_refund_id ?? null,
    requestedAmountPaise: Number(refund.requested_amount_paise),
    processedAmountPaise: numberOrNull(refund.processed_amount_paise),
    currency: refund.currency ?? "INR",
    reasonCode: refund.reason_code ?? null,
    reasonText: refund.reason_text ?? null,
    internalNote: refund.internal_note ?? null,
    origin: refund.origin,
    localStatus: refund.local_status,
    providerStatus: refund.provider_status ?? null,
    requestedBy: numberOrNull(refund.requested_by),
    requestedByName: refund.requested_by_name ?? null,
    requestedAt: refund.requested_at,
    providerCreatedAt: refund.provider_created_at ?? null,
    providerProcessedAt: refund.provider_processed_at ?? null,
    lastReconciledAt: refund.last_reconciled_at ?? null,
    failureCode: refund.failure_code ?? null,
    failureMessage: refund.failure_message ?? null,
    createdAt: refund.created_at,
    updatedAt: refund.updated_at,
    events: eventsByRefund.get(Number(refund.id)) ?? [],
  }));

  const grossCapturedPaise = payments.reduce(
    (sum, payment) => sum + Math.max(0, Number(payment.amount || 0)) * 100,
    0,
  );
  const processedRefundedPaise = refunds.reduce(
    (sum, refund) => refund.localStatus === "processed"
      ? sum + Math.max(
          0,
          Number(refund.processedAmountPaise ?? refund.requestedAmountPaise ?? 0),
        )
      : sum,
    0,
  );
  const netRetainedPaise = Math.max(
    0,
    grossCapturedPaise - processedRefundedPaise,
  );
  const remainingRefundablePaise = Math.max(
    0,
    grossCapturedPaise - processedRefundedPaise,
  );
  const totalChargedPaise =
    (Number(feeRow.amount ?? 0) + Number(feeRow.late_fee_amount ?? 0)) * 100;

  const lateFeeConfig = (feeRow.late_fee_config ?? null) as LateFeeConfig | null;
  let computedLateFee = Number(feeRow.late_fee_amount ?? 0);
  if (feeRow.status !== "Paid" && lateFeeConfig?.enabled) {
    computedLateFee = calculateLateFee(
      lateFeeConfig ?? DEFAULT_LATE_FEE_CONFIG,
      String(feeRow.due_date),
      String(feeRow.status),
    );
  }

  return {
    feeRecord: {
      id: Number(feeRow.id),
      feeType: feeRow.fee_type,
      feeName: feeRow.fee_name ?? feeRow.fee_type,
      amount: Number(feeRow.amount),
      lateFeeAmount: Number(feeRow.late_fee_amount ?? 0),
      accruedLateFee: computedLateFee,
      dueDate: feeRow.due_date,
      paidDate: feeRow.paid_date ?? null,
      status: feeRow.status,
      academicYear: feeRow.academic_year ?? null,
      academicSessionName: feeRow.academic_session_name ?? null,
      sessionId: numberOrNull(feeRow.session_id),
      notes: feeRow.notes ?? null,
      invoiceNumber: feeRow.invoice_number ?? null,
      receiptNumber: feeRow.receipt_number ?? null,
      razorpayOrderId: feeRow.razorpay_order_id ?? null,
      frequency: feeRow.frequency ?? null,
      feePeriodStart: feeRow.fee_period_start ?? null,
      feePeriodEnd: feeRow.fee_period_end ?? null,
      lateFeeConfig,
      createdAt: feeRow.created_at,
      createdBy: numberOrNull(feeRow.created_by),
      createdByName: feeRow.created_by_name ?? null,
      breakdown: Array.isArray(feeRow.breakdown_snapshot)
        ? feeRow.breakdown_snapshot
        : [],
      breakdownSnapshot: Array.isArray(feeRow.breakdown_snapshot)
        ? feeRow.breakdown_snapshot
        : [],
      concessionSnapshot: null,
    },
    payments,
    payment: payments.length > 0 ? payments[0] : null,
    refundSummary: {
      grossCapturedPaise,
      processedRefundedPaise,
      netRetainedPaise,
      remainingRefundablePaise,
      totalChargedPaise,
      outstandingPaise: Math.max(0, totalChargedPaise - netRetainedPaise),
    },
    refunds,
    refundEvents,
    paymentAttempts,
    paymentAttemptEvents,
    webhookEvents: webhookRows.map((event) => ({
      id: Number(event.id),
      providerEventId: event.provider_event_id,
      eventType: event.event_type,
      razorpayPaymentId: event.razorpay_payment_id ?? null,
      razorpayOrderId: event.razorpay_order_id ?? null,
      razorpayRefundId: event.razorpay_refund_id ?? null,
      razorpayDisputeId: event.razorpay_dispute_id ?? null,
      signatureVerified: Boolean(event.signature_verified),
      verificationStatus:
        event.verification_status
        ?? (event.signature_verified ? "verified" : "unverified"),
      processingStatus: event.processing_status,
      processingError: event.processing_error ?? null,
      providerOccurredAt: event.provider_occurred_at ?? null,
      resolutionSource: event.fee_resolution_source ?? null,
      resolutionStatus: event.fee_resolution_status ?? "unresolved",
      resolutionReason: event.resolution_reason ?? null,
      receivedAt: event.received_at,
      lastReceivedAt: event.last_received_at,
      processedAt: event.processed_at ?? null,
      deliveryCount: Number(event.delivery_count ?? 1),
      payload: event.payload ?? null,
    })),
    webhookProcessingEvents: webhookProcessingRows.map((event) => ({
      id: Number(event.id),
      webhookDeliveryId: Number(event.webhook_delivery_id),
      status: event.status,
      error: event.error ?? null,
      createdAt: event.created_at,
    })),
    student: {
      name: feeRow.student_name,
      digitalStudentId: feeRow.digital_student_id,
      class: feeRow.class,
      section: feeRow.section,
      rollNumber: numberOrNull(feeRow.roll_number),
      guardianName: feeRow.guardian_name ?? null,
      phone: feeRow.phone ?? null,
      email: feeRow.student_email ?? null,
    },
    school: {
      name: feeRow.school_name,
      logoUrl: feeRow.school_logo_url ?? null,
      addressLine1: feeRow.school_address_line1 ?? null,
      addressLine2: feeRow.school_address_line2 ?? null,
      city: feeRow.school_city ?? null,
      state: feeRow.school_state ?? null,
      pinCode: feeRow.school_pin_code ?? null,
      country: feeRow.school_country ?? null,
      phone: feeRow.school_phone ?? null,
      email: feeRow.school_email ?? null,
      affiliationNumber: feeRow.school_affiliation_number ?? null,
      gstin: feeRow.school_gstin ?? null,
    },
    auditEntries: auditRows.map((entry) => ({
      id: Number(entry.id),
      action: entry.action,
      entityType: entry.entity_type ?? null,
      entityId: numberOrNull(entry.entity_id),
      actorName: entry.actor_name ?? null,
      actorId: numberOrNull(entry.actor_id),
      studentId: numberOrNull(entry.student_id),
      sessionId: numberOrNull(entry.session_id),
      razorpayPaymentId: entry.razorpay_payment_id ?? null,
      razorpayOrderId: entry.razorpay_order_id ?? null,
      amountPaise: numberOrNull(entry.amount),
      currency: entry.currency ?? "INR",
      errorCode: entry.error_code ?? null,
      errorSource: entry.error_source ?? null,
      errorStep: entry.error_step ?? null,
      errorReason: entry.error_reason ?? null,
      paymentMethod: entry.payment_method ?? null,
      description: entry.description ?? null,
      createdAt: entry.created_at,
    })),
  };
}