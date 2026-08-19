const LEDGER_PAYMENT_METHOD_LABELS: Record<string, string> = {
  Cash: "Cash",
  Cheque: "Cheque",
  BankTransfer: "Bank Transfer",
  DemandDraft: "Demand Draft",
  UpiQr: "UPI / QR",
  Online: "Portal Payment",
};

/**
 * Converts a stored successful payment-record method to its Ledger label.
 * Unknown or legacy values deliberately return null so the UI displays "—"
 * instead of inferring a payment method.
 */
export function ledgerPaymentMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  return LEDGER_PAYMENT_METHOD_LABELS[method] ?? null;
}