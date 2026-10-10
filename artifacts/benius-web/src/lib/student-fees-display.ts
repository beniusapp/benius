export function isRefundedPaidInvoiceWithBalance(record: {
  status: string;
  processed_refund_amount?: unknown;
  refund_adjusted_total_due?: unknown;
}): boolean {
  return record.status === "Paid"
    && Number(record.processed_refund_amount ?? 0) > 0
    && Number(record.refund_adjusted_total_due ?? 0) > 0;
}

export function canShowStudentPayNow(
  record: Parameters<typeof isRefundedPaidInvoiceWithBalance>[0],
  razorpayActive: boolean,
): boolean {
  return razorpayActive && !isRefundedPaidInvoiceWithBalance(record);
}

export function paymentAttemptPlacementRows(attempt: {
  academicSessionLabel?: string | null;
  historicalPlacementAvailable?: boolean;
  className?: string | null;
  sectionName?: string | null;
  rollNumber?: number | null;
}): [string, string][] {
  const available = attempt.historicalPlacementAvailable === true;
  return [
    ["Academic Session", attempt.academicSessionLabel ?? "Historical session unavailable"],
    ["Class", available ? attempt.className ?? "—" : "Historical placement unavailable"],
    ["Section", available ? attempt.sectionName ?? "—" : "—"],
    ["Roll Number", available && attempt.rollNumber != null ? String(attempt.rollNumber) : "—"],
  ];
}
