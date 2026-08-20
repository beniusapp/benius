export const OFFLINE_PAYMENT_METHODS = [
  "Cash",
  "BankTransfer",
  "Cheque",
  "DemandDraft",
  "UpiQr",
] as const;

export type OfflinePaymentMethod = typeof OFFLINE_PAYMENT_METHODS[number];

const OFFLINE_PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  banktransfer: "Bank Transfer",
  cheque: "Cheque",
  demanddraft: "Demand Draft",
  upiqr: "UPI/QR",
};

/**
 * Converts a stored, canonical offline payment method to its student-facing
 * label. Unknown and generic historical values deliberately return null so no
 * payment method is invented after the fact.
 */
export function offlinePaymentMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  return OFFLINE_PAYMENT_METHOD_LABELS[method.trim().toLowerCase()] ?? null;
}

/**
 * Formats a known offline method for receipts and payment history. A legacy
 * generic "Offline" value remains generic; unknown values return null for the
 * caller to preserve as-is rather than infer.
 */
export function formatOfflinePaymentMethod(method: string | null | undefined): string | null {
  const label = offlinePaymentMethodLabel(method);
  if (label) return `Offline (${label})`;
  return method?.trim().toLowerCase() === "offline" ? "Offline" : null;
}