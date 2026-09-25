const ONE_INVOICE_MESSAGE =
  "One offline payment can be applied to exactly one invoice. Select and record each invoice separately.";

/**
 * Reject legacy or crafted request shapes that represent a bulk offline
 * payment before route validation or any payment/receipt write occurs.
 */
export function getMultiInvoiceOfflinePaymentError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as Record<string, unknown>;

  if (
    payload.autoFifo === true ||
    Array.isArray(payload.feeRecordId) ||
    Array.isArray(payload.feeRecordIds)
  ) {
    return ONE_INVOICE_MESSAGE;
  }
  return null;
}