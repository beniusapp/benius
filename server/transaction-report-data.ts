/**
 * server/transaction-report-data.ts
 *
 * Shared data helper for the School-wide Transaction Report PDF.
 *
 * Produces one normalized TxRow per payment_attempt projection plus fallback
 * payment_record rows not already represented by a payment_attempt.
 */
import { normalizePaymentMethod } from "@shared/payment-method";
/**
 *
 * Key design decisions
 * ────────────────────
 * 1. Invoice population first: we resolve the set of fee_record IDs that match
 *    the session scope, ledger filters, and any explicit selection (selectedIds /
 *    selectAllMatching / excludedIds).  This is the ONLY place session / filter
 *    predicates are applied — payment_attempts and payment_records rows are
 *    pulled by fee_record_id ∈ that set, so the invoice's fr.session_id is
 *    always authoritative.
 *
 * 2. payment_attempts come first: every known online attempt has a row here.
 *    Offline attempts are linked via external_id = 'pr:' || payment_record.id.
 *    Online captures link via (school_id, razorpay_payment_id).
 *
 * 3. Fallback payment_records: any payment_record not covered by an attempt
 *    (historical offline payments that pre-date the payment_attempts table, or
 *    manual records that were never attributed) appears as a synthetic row with
 *    status = 'captured'.
 *
 * 4. No dedup duplicates: we deduplicate by (razorpay_payment_id, school_id)
 *    for online rows and by external_id for offline rows.  A payment_record row
 *    is included only when no attempt already covers it.
 *
 * 5. Refund aggregation: aggregate ONLY processed refunds (local_status =
 *    'processed') per refund linkage from the refunds table — no multiplicative
 *    joins, and each refund row is counted exactly once. The latest refund
 *    local_status (any status) is exposed separately so a pending/requested
 *    reservation surfaces in refund_status without altering the captured
 *    amount/status.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "./db";
import {
  buildLedgerFilterPredicates,
  buildLedgerInvoiceSessionPredicate,
  type LedgerFilterFields,
} from "./ledger-filter-sql";
import type { LedgerFilters } from "@shared/ledger-filters";
import type { TxRow } from "./transaction-pdf";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Canonical row shape consumed by the transaction PDF renderer.
 * Aliased directly to the renderer's TxRow so the route can pass rows through
 * with no cast — the two contracts can never drift.
 */
export type TxReportRow = TxRow;

// ── Selection parameters ──────────────────────────────────────────────────────

export interface TxSelectionParams {
  /** true  → export all matching invoices (minus excludedIds) */
  selectAllMatching: boolean;
  /** explicit fee_record IDs; ignored when selectAllMatching=true */
  selectedIds:       number[];
  /** IDs to exclude when selectAllMatching=true */
  excludedIds:       number[];
}

// ── Main helper ───────────────────────────────────────────────────────────────

/**
 * Build transaction report rows for the given school / session / filters /
 * selection.
 *
 * @param schoolId     Authenticated school – all subqueries are scoped to this.
 * @param sessionFilter Session ID from the admin's view (or null = school-wide).
 * @param txFilters    Ledger filters (invoice-population scope).
 * @param selection    Optional selection; omit or pass undefined for no-selection GET export.
 */
export async function buildTransactionRows(
  schoolId:     number,
  sessionFilter: number | null,
  txFilters:    LedgerFilters,
  selection?:   TxSelectionParams,
): Promise<TxReportRow[]> {

  // ── Step 1: resolve invoice ID scope ────────────────────────────────────────
  // Build the canonical invoice population filter predicates (identical to
  // Ledger/CSV so the same filter set produces the same invoice population).

  const invoiceFields: LedgerFilterFields = {
    invoiceNumber:     sql`COALESCE(fr.invoice_number, '')`,
    receiptNumber:     sql`COALESCE(fr.receipt_number, '')`,
    studentName:       sql`COALESCE(s.name, '')`,
    dsid:              sql`COALESCE(s.digital_student_id, '')`,
    class:             sql`s.class`,
    section:           sql`s.section`,
    feeName:           sql`COALESCE(fr.fee_name, structure.fee_name, fr.fee_type)`,
    feeType:           sql`fr.fee_type`,
    feePeriodStartEnd: [sql`fr.fee_period_start`, sql`fr.fee_period_end`],
    frequency:         sql`fr.frequency`,
    status:            sql`fr.status`,
    academicYear:      sql`fr.academic_year`,
    amount:            sql`fr.amount`,
    dueDate:           sql`fr.due_date`,
    paidDate:          sql`fr.paid_date`,
    // canonical filters resolve against the fee record's latest non-auto payment
    referenceNumber:   sql`COALESCE(lp.raw_reference_number, '')`,
    paymentMethod:     sql`lp.raw_payment_method`,
  };

  const invoicePredicates = buildLedgerFilterPredicates(txFilters, invoiceFields);
  const sessionPredicate  = buildLedgerInvoiceSessionPredicate(sessionFilter);

  const sessionCond: SQL = sessionPredicate ? sql`AND ${sessionPredicate}` : sql``;
  const extraWhere:  SQL = invoicePredicates.length > 0
    ? sql`AND ${sql.join(invoicePredicates, sql` AND `)}`
    : sql``;

  // Selection scoping applied to fee_record IDs
  const sel = selection;
  let selectionCond: SQL = sql``;
  if (sel) {
    if (!sel.selectAllMatching && sel.selectedIds.length > 0) {
      // Explicit selection — only these IDs
      const arr = sql.raw(`ARRAY[${sel.selectedIds.join(",")}]::int[]`);
      selectionCond = sql`AND fr.id = ANY(${arr})`;
    } else if (!sel.selectAllMatching && sel.selectedIds.length === 0) {
      // Explicit selection with empty list → no rows (malformed selection must
      // not silently export all). The route validates this and returns 400, but
      // this is a defensive backstop.
      return [];
    } else if (sel.selectAllMatching && sel.excludedIds.length > 0) {
      // All matching minus exclusions
      const arr = sql.raw(`ARRAY[${sel.excludedIds.join(",")}]::int[]`);
      selectionCond = sql`AND fr.id != ALL(${arr})`;
    }
    // else: selectAllMatching with no exclusions → no extra condition
  }

  // Resolve the invoice ID set
  const invoiceIdResult = await db.execute(sql`
    SELECT fr.id AS fr_id
    FROM fee_records fr
    LEFT JOIN students s ON s.id = fr.student_id AND s.school_id = fr.school_id
    LEFT JOIN LATERAL (
      SELECT fs.name AS fee_name
      FROM fee_structures fs
      WHERE fs.school_id = fr.school_id
        AND lower(trim(fs.fee_type)) = lower(trim(fr.fee_type))
      ORDER BY fs.id ASC
      LIMIT 1
    ) structure ON true
    LEFT JOIN LATERAL (
      SELECT pr2.payment_method  AS raw_payment_method,
             pr2.reference_number AS raw_reference_number
      FROM payment_records pr2
      WHERE pr2.school_id     = fr.school_id
        AND pr2.fee_record_id = fr.id
        AND (pr2.cashier_notes IS NULL OR pr2.cashier_notes <> 'Auto-recorded from Add Fee Record')
      ORDER BY pr2.created_at DESC, pr2.id DESC
      LIMIT 1
    ) lp ON true
    WHERE fr.school_id = ${schoolId}
      ${sessionCond}
      ${extraWhere}
      ${selectionCond}
  `);

  const invoiceIds: number[] = (invoiceIdResult.rows as any[]).map(r => Number(r.fr_id));
  if (invoiceIds.length === 0) return [];

  // Build a safe SQL ARRAY literal for the invoice ID list
  const invoiceIdsArr = sql.raw(`ARRAY[${invoiceIds.join(",")}]::int[]`);

  // ── Step 2: refund aggregates ──────────────────────────────────────────────
  // Aggregate from the refunds table with NO multiplicative join. Each refund
  // row is counted at most once:
  //   * refundedPaise sums COALESCE(processed_amount_paise, requested_amount_paise)
  //     but ONLY over local_status = 'processed' rows — pending / requested /
  //     failed / cancelled reservations never count as refunded money.
  //   * latestStatus / latestProcessedAt reflect the newest refund of ANY status
  //     so a pending request still surfaces in refund_status.
  const refundResult = await db.execute(sql`
    SELECT
      rf.id                    AS refund_id,
      rf.fee_record_id         AS fee_record_id,
      rf.payment_attempt_id    AS payment_attempt_id,
      rf.payment_record_id     AS payment_record_id,
      rf.razorpay_payment_id   AS razorpay_payment_id,
      rf.local_status          AS local_status,
      COALESCE(rf.processed_amount_paise, rf.requested_amount_paise) AS amount_paise,
      rf.provider_processed_at AS provider_processed_at,
      rf.requested_at          AS requested_at,
      rf.updated_at            AS updated_at
    FROM refunds rf
    WHERE rf.school_id     = ${schoolId}
      AND rf.fee_record_id = ANY(${invoiceIdsArr})
    ORDER BY rf.updated_at ASC, rf.id ASC
  `);

  // Index each raw refund contribution under every available linkage. A
  // transaction can legitimately have multiple refund rows written at
  // different times with different linkage completeness (for example, one row
  // linked by payment_attempt_id and an older row linked only by payment ID).
  // resolveRefund() unions all matching buckets and de-duplicates by refund ID,
  // so no refund is missed and no multi-linked refund is counted twice.
  interface RefundContribution {
    id: number;
    processedPaise: number;
    status: string | null;
    processedAt: string | null;
    updatedAt: string | null;
  }
  interface RefundAgg {
    processedPaise: number;
    latestStatus: string | null;
    latestProcessedAt: string | null;
  }
  const byAttempt = new Map<number, RefundContribution[]>();
  const byRecord = new Map<number, RefundContribution[]>();
  const byPaymentId = new Map<string, RefundContribution[]>();

  function addContribution<K>(
    index: Map<K, RefundContribution[]>,
    key: K,
    contribution: RefundContribution,
  ) {
    const bucket = index.get(key);
    if (bucket) bucket.push(contribution);
    else index.set(key, [contribution]);
  }

  for (const r of refundResult.rows as any[]) {
    const status = r.local_status != null ? String(r.local_status) : null;
    const contribution: RefundContribution = {
      id: Number(r.refund_id),
      processedPaise: status === "processed" ? Number(r.amount_paise ?? 0) : 0,
      status,
      processedAt: status === "processed"
        ? String(r.provider_processed_at ?? r.updated_at ?? r.requested_at ?? "") || null
        : null,
      updatedAt: r.updated_at != null ? String(r.updated_at) : null,
    };
    if (r.payment_attempt_id != null) {
      addContribution(byAttempt, Number(r.payment_attempt_id), contribution);
    }
    if (r.payment_record_id != null) {
      addContribution(byRecord, Number(r.payment_record_id), contribution);
    }
    if (r.razorpay_payment_id != null && r.fee_record_id != null) {
      const k = `${Number(r.fee_record_id)}|${String(r.razorpay_payment_id)}`;
      addContribution(byPaymentId, k, contribution);
    }
  }

  /**
   * Resolve all refunds associated through any valid linkage, de-duplicating a
   * refund that appears in more than one index by its immutable refund ID.
   */
  function resolveRefund(
    attemptId:  number | null,
    recordId:   number | null,
    feeRecordId: number | null,
    rzpId:      string | null,
  ): RefundAgg | null {
    const matches: RefundContribution[] = [];
    if (attemptId != null) matches.push(...(byAttempt.get(attemptId) ?? []));
    if (recordId != null) matches.push(...(byRecord.get(recordId) ?? []));
    if (rzpId != null && feeRecordId != null) {
      const k = `${feeRecordId}|${rzpId}`;
      matches.push(...(byPaymentId.get(k) ?? []));
    }
    if (matches.length === 0) return null;

    const unique = [...new Map(matches.map((refund) => [refund.id, refund])).values()]
      .sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return aTime - bTime || a.id - b.id;
      });

    let processedPaise = 0;
    let latestStatus: string | null = null;
    let latestProcessedAt: string | null = null;
    for (const refund of unique) {
      processedPaise += refund.processedPaise;
      latestStatus = refund.status ?? latestStatus;
      if (refund.processedAt) latestProcessedAt = refund.processedAt;
    }
    return { processedPaise, latestStatus, latestProcessedAt };
  }

  // ── Step 3: payment_attempts for these invoices ──────────────────────────────
  const paResult = await db.execute(sql`
    SELECT
      pa.id,
      pa.attempt_number,
      pa.outcome,
      pa.fee_record_id,
      pa.razorpay_payment_id,
      pa.razorpay_order_id,
      pa.external_id,
      pa.payment_method,
      pa.amount_paise,
      pa.amount_captured_paise,
      pa.amount_refunded_paise,
      pa.receipt_number,
      pa.error_description,
      pa.error_code,
      pa.bank_rrn,
      pa.bank_auth_code,
      pa.vpa,
      pa.rzp_captured_at,
      pa.rzp_authorized_at,
      pa.rzp_failed_at,
      pa.rzp_created_at,
      pa.created_at,
      pa.updated_at,
      -- fee record
      fr.invoice_number    AS fr_invoice_number,
      fr.fee_type          AS fr_fee_type,
      fr.student_id        AS fr_student_id,
      COALESCE(fr.fee_name, structure.fee_name, fr.fee_type) AS fr_fee_name,
      -- student
      s.name               AS student_name,
      s.digital_student_id AS student_id,
      s.class              AS class,
      s.section            AS section,
      -- payment_record link (for dedup + method/reference/receipt coalesce)
      pr.id                AS linked_pr_id,
      pr.reference_number  AS pr_reference_number,
      pr.payment_method    AS pr_payment_method,
      pr.receipt_number    AS pr_receipt_number
    FROM payment_attempts pa
    JOIN fee_records fr        ON fr.id = pa.fee_record_id AND fr.school_id = ${schoolId}
    LEFT JOIN students s       ON s.id = fr.student_id AND s.school_id = ${schoolId}
    LEFT JOIN LATERAL (
      SELECT fs.name AS fee_name
      FROM fee_structures fs
      WHERE fs.school_id = fr.school_id
        AND lower(trim(fs.fee_type)) = lower(trim(fr.fee_type))
      ORDER BY fs.id ASC
      LIMIT 1
    ) structure ON true
    -- link to payment_record for dedup tracking + field coalesce
    LEFT JOIN payment_records pr
           ON pr.school_id = ${schoolId}
          AND (
            -- offline attempt link: external_id = 'pr:' || pr.id
            (pa.external_id IS NOT NULL AND pa.external_id = ('pr:' || pr.id::text))
            OR
            -- online capture link: same razorpay_payment_id within the school
            (pa.razorpay_payment_id IS NOT NULL AND pr.razorpay_payment_id = pa.razorpay_payment_id)
          )
    WHERE pa.school_id       = ${schoolId}
      AND pa.fee_record_id   = ANY(${invoiceIdsArr})
    ORDER BY pa.fee_record_id, pa.created_at ASC
  `);

  // Track which payment_record IDs are already covered by an attempt
  const coveredPrIds = new Set<number>();
  // Track unique (school, razorpay_payment_id) to prevent duplicates from
  // multiple payment_record rows for the same online payment
  const seenRzpIds  = new Set<string>();

  const txRows: TxReportRow[] = [];

  for (const row of paResult.rows as any[]) {
    // Dedup online payment_attempts by razorpay_payment_id
    const rzpId: string | null = row.razorpay_payment_id ?? null;
    if (rzpId) {
      if (seenRzpIds.has(rzpId)) continue;
      seenRzpIds.add(rzpId);
    }

    // Mark linked payment_record as covered
    if (row.linked_pr_id != null) {
      coveredPrIds.add(Number(row.linked_pr_id));
    }

    const feeRecordId = row.fee_record_id != null ? Number(row.fee_record_id) : null;
    const linkedPrId  = row.linked_pr_id != null ? Number(row.linked_pr_id) : null;
    const refundInfo  = resolveRefund(Number(row.id), linkedPrId, feeRecordId, rzpId);

    const amountPaise:    number = Number(row.amount_paise    ?? 0);
    const capturedPaise:  number = row.amount_captured_paise != null
      ? Number(row.amount_captured_paise)
      : amountPaise;
    const attemptRefundedPaise = Number(row.amount_refunded_paise ?? 0);
    // payment_attempts.amount_refunded_paise is a provider-backed projection.
    // Refund rows are the immutable audit trail. Taking the maximum includes
    // either representation without double-counting the same refund.
    const refundedPaise: number = Math.max(
      refundInfo?.processedPaise ?? 0,
      attemptRefundedPaise,
    );
    // Preserve paise precision — do NOT round.
    const amountINR:      number = (capturedPaise > 0 ? capturedPaise : amountPaise) / 100;
    const refundINR:      number = refundedPaise / 100;

    const outcome: string = String(row.outcome ?? 'pending');
    const status = deriveStatus(outcome, capturedPaise, refundedPaise);

    const transactionAt = pickTimestamp(
      outcome,
      row.rzp_captured_at,
      row.rzp_authorized_at,
      row.rzp_failed_at,
      row.rzp_created_at,
      row.created_at,
      row.updated_at,
      refundInfo?.latestProcessedAt
        ?? (outcome === "refunded" && attemptRefundedPaise > 0
          ? String(row.updated_at ?? row.created_at ?? "")
          : null),
      status,
    );

    // Method / reference coalesce with linked payment record + attempt fields.
    //
    // Business channel vs. payment instrument:
    //   pr.payment_method  ("Portal Payment" / "Cash" / etc.) = the authoritative
    //     business-facing channel written when the payment was recorded.
    //   pa.payment_method  ("card" / "upi" / "netbanking" / etc.) = the underlying
    //     Razorpay instrument, useful for technical detail but NOT the channel.
    //
    // A portal attempt is identified by either:
    //   (a) its linked payment_record carrying the canonical channel value
    //       ("Portal Payment" or legacy "Online"), OR
    //   (b) the attempt itself having a razorpay_payment_id — the authoritative
    //       Razorpay origin signal, present even for failed/cancelled attempts
    //       that have no linked payment_records row.
    //
    // In both cases the business-facing Method must be "Portal Payment"; the
    // Razorpay instrument is retained only for secondary detail display.
    const prMethodNormalized = normalizePaymentMethod(row.pr_payment_method) ?? null;
    const isPortalAttempt = prMethodNormalized === "Portal Payment" || Boolean(row.razorpay_payment_id);
    const paymentMethod = isPortalAttempt
      ? "Portal Payment"
      : normalizePaymentMethod(row.payment_method ?? row.pr_payment_method) ?? null;
    const reference = row.pr_reference_number
      ?? row.bank_rrn
      ?? row.bank_auth_code
      ?? row.vpa
      ?? null;

    // Receipt: attempt receipt → linked PR receipt only. Never fall back to the
    // invoice receipt (a failed/cancelled attempt must not display a paid
    // invoice's receipt number).
    const receiptNumber = row.receipt_number ?? row.pr_receipt_number ?? null;

    txRows.push({
      id:               `pa:${row.id}`,
      attempt_number:   row.attempt_number != null ? Number(row.attempt_number) : null,
      student_name:     row.student_name   ?? null,
      student_id:       row.student_id     ?? null,
      class:            row.class          ?? null,
      section:          row.section        ?? null,
      invoice_number:   row.fr_invoice_number  ?? null,
      receipt_number:   receiptNumber,
      fee_name:         row.fr_fee_name    ?? null,
      fee_type:         row.fr_fee_type    ?? null,
      payment_method:   paymentMethod,
      transaction_at:   transactionAt,
      amount:           amountINR,
      status,
      payment_id:       rzpId,
      order_id:         row.razorpay_order_id ?? null,
      reference_number: reference,
      failure_reason:   outcome === 'failed'
                          ? (row.error_description ?? row.error_code ?? null)
                          : null,
      refund_amount:    refundINR,
      refund_status:    refundInfo?.latestStatus
        ?? (attemptRefundedPaise > 0 ? "processed" : null),
    });
  }

  // ── Step 4: fallback payment_record rows not covered by any attempt ──────────
  const prResult = await db.execute(sql`
    SELECT
      pr.id,
      pr.amount,
      pr.late_fee_paid,
      pr.payment_method,
      pr.received_date,
      pr.created_at,
      pr.receipt_number      AS pr_receipt_number,
      pr.razorpay_payment_id,
      pr.razorpay_order_id,
      pr.reference_number,
      pr.gateway_status,
      pr.fee_record_id,
      -- fee record
      fr.invoice_number    AS fr_invoice_number,
      fr.fee_type          AS fr_fee_type,
      COALESCE(fr.fee_name, structure.fee_name, fr.fee_type) AS fr_fee_name,
      -- student
      s.name               AS student_name,
      s.digital_student_id AS student_id,
      s.class              AS class,
      s.section            AS section
    FROM payment_records pr
    JOIN fee_records fr        ON fr.id = pr.fee_record_id AND fr.school_id = ${schoolId}
    LEFT JOIN students s       ON s.id = fr.student_id AND s.school_id = ${schoolId}
    LEFT JOIN LATERAL (
      SELECT fs.name AS fee_name
      FROM fee_structures fs
      WHERE fs.school_id = fr.school_id
        AND lower(trim(fs.fee_type)) = lower(trim(fr.fee_type))
      ORDER BY fs.id ASC
      LIMIT 1
    ) structure ON true
    WHERE pr.school_id       = ${schoolId}
      AND pr.fee_record_id   = ANY(${invoiceIdsArr})
    ORDER BY pr.fee_record_id, pr.created_at ASC
  `);

  for (const row of prResult.rows as any[]) {
    const prId = Number(row.id);
    if (coveredPrIds.has(prId)) continue;

    // Also deduplicate online payment_records by razorpay_payment_id
    const rzpId: string | null = row.razorpay_payment_id ?? null;
    if (rzpId) {
      if (seenRzpIds.has(rzpId)) continue;
      seenRzpIds.add(rzpId);
    }

    const feeRecordId = row.fee_record_id != null ? Number(row.fee_record_id) : null;
    const refundInfo = resolveRefund(null, prId, feeRecordId, rzpId);

    // Preserve paise precision — payment_records.amount is stored in whole INR.
    const amountINR:  number = Number(row.amount ?? 0);
    const capturedPaise: number = amountINR * 100;
    const refundedPaise: number = refundInfo?.processedPaise ?? 0;
    const refundINR:  number = refundedPaise / 100;

    // payment_records-only rows are successful captured/settled records
    const gwStatus = row.gateway_status ?? (rzpId ? 'captured' : 'offline');
    const status = deriveStatusFromPr(gwStatus, capturedPaise, refundedPaise);

    // Refund rows use the processed refund timestamp; otherwise preserve the
    // original payment date/time.
    const transactionAt =
      (status === "refunded" || status === "partially_refunded")
        && refundInfo?.latestProcessedAt
        ? refundInfo.latestProcessedAt
        : row.received_date
          ? String(row.received_date)
          : (row.created_at ? String(row.created_at) : null);

    txRows.push({
      id:               `pr:${prId}`,
      attempt_number:   null,
      student_name:     row.student_name   ?? null,
      student_id:       row.student_id     ?? null,
      class:            row.class          ?? null,
      section:          row.section        ?? null,
      invoice_number:   row.fr_invoice_number ?? null,
      // Fallback PR rows may use their own receipt; never the invoice receipt.
      receipt_number:   row.pr_receipt_number ?? null,
      fee_name:         row.fr_fee_name    ?? null,
      fee_type:         row.fr_fee_type    ?? null,
      payment_method:   row.payment_method ?? null,
      transaction_at:   transactionAt,
      amount:           amountINR,
      status,
      payment_id:       rzpId,
      order_id:         row.razorpay_order_id ?? null,
      reference_number: row.reference_number  ?? null,
      failure_reason:   null,
      refund_amount:    refundINR,
      refund_status:    refundInfo?.latestStatus ?? null,
    });
  }

  // ── Step 5: sort newest first with stable tiebreakers ───────────────────────
  txRows.sort((a, b) => {
    const ta = a.transaction_at ?? '';
    const tb = b.transaction_at ?? '';
    // newest first
    if (ta !== tb) return ta < tb ? 1 : -1;
    const inv = (b.invoice_number ?? '').localeCompare(a.invoice_number ?? '');
    if (inv !== 0) return inv;
    // stable final tiebreaker on synthetic id
    return b.id.localeCompare(a.id);
  });

  return txRows;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Derive a display status from a payment_attempt outcome + processed refund.
 * Refund status is derived ONLY from actually processed refund money — a
 * pending/requested reservation never changes captured → refunded here.
 */
function deriveStatus(
  outcome:        string,
  capturedPaise:  number,
  refundedPaise:  number,
): string {
  if (outcome === 'refunded' || (refundedPaise > 0 && capturedPaise > 0 && refundedPaise >= capturedPaise)) {
    return 'refunded';
  }
  if (outcome === 'captured' && refundedPaise > 0 && refundedPaise < capturedPaise) {
    return 'partially_refunded';
  }
  if (outcome === 'captured') return 'captured';
  if (outcome === 'failed')   return 'failed';
  if (outcome === 'cancelled') return 'cancelled';
  if (outcome === 'authorized') return 'authorized';
  return outcome || 'pending';
}

/**
 * Derive status for a payment_record-only row (no attempt).
 * These are always successful receipts unless gateway_status/processed refund
 * says otherwise.
 */
function deriveStatusFromPr(
  gatewayStatus:  string,
  capturedPaise:  number,
  refundedPaise:  number,
): string {
  if (gatewayStatus === 'refunded' || (refundedPaise > 0 && capturedPaise > 0 && refundedPaise >= capturedPaise)) {
    return 'refunded';
  }
  if (refundedPaise > 0 && capturedPaise > 0 && refundedPaise < capturedPaise) {
    return 'partially_refunded';
  }
  if (gatewayStatus === 'captured' || gatewayStatus === 'settled') return 'captured';
  if (gatewayStatus === 'offline') return 'captured'; // offline payments are always successful
  return gatewayStatus || 'captured';
}

/**
 * Pick the most semantically appropriate timestamp for a payment_attempt row.
 *   captured / refunded / partially_refunded → processed refund time (if refunded)
 *                                               else rzp_captured_at
 *                                               else payment-record/created fallback
 *   authorized → rzp_authorized_at → rzp_created_at → created_at
 *   failed     → rzp_failed_at → rzp_created_at → created_at
 *   cancelled  → created_at → updated_at (local lifecycle timestamp)
 *   pending    → rzp_created_at → created_at
 */
function pickTimestamp(
  outcome:         string,
  rzpCapturedAt:   unknown,
  rzpAuthorizedAt: unknown,
  rzpFailedAt:     unknown,
  rzpCreatedAt:    unknown,
  createdAt:       unknown,
  updatedAt:       unknown,
  refundProcessedAt: string | null,
  status:          string,
): string | null {
  const v = (x: unknown): string | null => x != null ? String(x) : null;

  if (status === 'refunded' || status === 'partially_refunded') {
    return refundProcessedAt ?? v(rzpCapturedAt) ?? v(rzpCreatedAt) ?? v(createdAt);
  }
  if (outcome === 'captured') {
    return v(rzpCapturedAt) ?? v(rzpCreatedAt) ?? v(createdAt);
  }
  if (outcome === 'authorized') {
    return v(rzpAuthorizedAt) ?? v(rzpCreatedAt) ?? v(createdAt);
  }
  if (outcome === 'failed') {
    return v(rzpFailedAt) ?? v(rzpCreatedAt) ?? v(createdAt);
  }
  if (outcome === 'cancelled') {
    return v(createdAt) ?? v(updatedAt);
  }
  // pending / other
  return v(rzpCreatedAt) ?? v(createdAt);
}
