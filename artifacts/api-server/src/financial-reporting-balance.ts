export type ReportingRefund = {
  localStatus: string;
  processedAmountPaise: number | null;
  requestedAmountPaise: number;
};

/** Refunds affect reporting only after processing; amounts are stored in paise. */
export function processedRefundTotalRupees(refunds: ReportingRefund[]): number {
  return refunds.reduce((total, refund) => {
    if (refund.localStatus !== "processed") return total;
    return total + (refund.processedAmountPaise ?? refund.requestedAmountPaise) / 100;
  }, 0);
}

export function refundAdjustedOutstanding(billed: number, paid: number, processedRefunds: number): number {
  return Math.max(0, billed - paid + processedRefunds);
}

/**
 * The existing Student open-fee total displays the invoice total when there is
 * no refund. Keep that baseline; only switch to retained-payment balance when a
 * processed refund exists.
 */
export function studentOpenFeeDisplayBalance(
  invoiceTotal: number,
  paid: number,
  processedRefunds: number,
): number {
  return processedRefunds > 0
    ? refundAdjustedOutstanding(invoiceTotal, paid, processedRefunds)
    : invoiceTotal;
}
