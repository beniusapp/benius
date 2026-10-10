export function isRefundedPaidInvoiceWithBalance(record: {
  status: string;
  processed_refund_amount?: unknown;
  refund_adjusted_total_due?: unknown;
}): boolean {
  return record.status === "Paid"
    && Number(record.processed_refund_amount ?? 0) > 0
    && Number(record.refund_adjusted_total_due ?? 0) > 0;
}
