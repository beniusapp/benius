import { feeRecords, paymentRecords } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";

/**
 * The Ledger payment list only treats an invoice link as verified when school
 * and Student ownership match the payment row. Keep this scoped to that read
 * path; Mobile callers continue using the legacy query unless explicitly opted
 * into this Ledger-only mode.
 */
export function buildLedgerPaymentInvoiceJoin() {
  return and(
    eq(paymentRecords.feeRecordId, feeRecords.id),
    eq(paymentRecords.schoolId, feeRecords.schoolId),
    eq(paymentRecords.studentId, feeRecords.studentId),
  )!;
}

/**
 * Preserve non-NULL payment-session filtering. Only a NULL payment session may
 * inherit the selected session from its verified invoice join.
 */
export function buildLedgerPaymentSessionScope(sessionId: number) {
  return or(
    eq(paymentRecords.sessionId, sessionId),
    and(
      isNull(paymentRecords.sessionId),
      eq(feeRecords.sessionId, sessionId),
    ),
  )!;
}

/**
 * Do not return the stored invoice ID unless the joined invoice passed the
 * Ledger's school and Student ownership checks.
 */
export function mapLedgerPaymentListRow<
  TPayment extends { feeRecordId: number | null },
  TInvoice extends { invoiceNumber: string | null } | null,
>(row: { payment_records: TPayment; fee_records: TInvoice }) {
  const invoice = row.fee_records;
  return {
    ...row.payment_records,
    feeRecordId: invoice != null ? row.payment_records.feeRecordId : null,
    invoiceNumber: invoice?.invoiceNumber ?? null,
  };
}
