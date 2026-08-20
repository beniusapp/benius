export type OfflinePaymentMethod = "Cash" | "Cheque" | "BankTransfer" | "DemandDraft" | "UpiQr";

/** Values that must be persisted whenever the entry form displays them as selected. */
export function offlinePaymentEntryDefaults(method: string): {
  instrumentStatus: string | null;
  transferMode: string | null;
} {
  if (method === "UpiQr") return { instrumentStatus: "Verified", transferMode: null };
  if (method === "BankTransfer") return { instrumentStatus: null, transferMode: "NEFT" };
  if (method === "Cheque" || method === "DemandDraft") return { instrumentStatus: "Received", transferMode: null };
  return { instrumentStatus: null, transferMode: null };
}

export interface OfflinePaymentDetail {
  transactionTime?: string | null;
  instrumentStatus?: string | null;
  transferMode?: string | null;
  transactionReference?: string | null;
  receivingBank?: string | null;
  receiverUpiId?: string | null;
  payeeName?: string | null;
  payableAt?: string | null;
  collectionLocation?: string | null;
  depositDate?: string | null;
  depositBank?: string | null;
  depositReference?: string | null;
  returnDate?: string | null;
  returnReason?: string | null;
}

export interface OfflinePaymentFallback {
  referenceNumber?: string | null;
  instrumentDate?: string | null;
  bankName?: string | null;
  branchName?: string | null;
  payerName?: string | null;
  payerUpiId?: string | null;
}

export interface OfflinePaymentDetailRow {
  label: string;
  value: string;
}

export function isValidOfflineCorrectionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Preserves an omitted patch field but makes a blank form date an explicit SQL NULL. */
export function normalizeOptionalOfflineCorrectionDate(
  value: string | null | undefined,
): string | null | undefined {
  return value === "" || value === null ? null : value;
}

function rows(values: Array<[string, string | null | undefined]>): OfflinePaymentDetailRow[] {
  return values
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
}

/**
 * Produces only persisted, method-relevant accounting rows. Older records with
 * no structured detail remain readable through their original payment fields.
 */
export function offlinePaymentDetailRows(
  method: string | null | undefined,
  detail: OfflinePaymentDetail | null | undefined,
  fallback: OfflinePaymentFallback = {},
): OfflinePaymentDetailRow[] {
  const d = detail ?? {};

  switch (method) {
    case "Cash":
      return rows([
        ["Collection location", d.collectionLocation],
      ]);
    case "Cheque":
      return rows([
        ["Cheque number", fallback.referenceNumber],
        ["Cheque date", fallback.instrumentDate],
        ["Cheque status", d.instrumentStatus],
        ["Drawer / payer", fallback.payerName],
        ["Bank", fallback.bankName],
        ["Branch", fallback.branchName],
        ["Payee", d.payeeName],
        ["Deposit date", d.depositDate],
        ["Deposit bank", d.depositBank],
        ["Deposit reference", d.depositReference],
        ["Return / bounce date", d.returnDate],
        ["Return reason", d.returnReason],
      ]);
    case "DemandDraft":
      return rows([
        ["Demand draft number", fallback.referenceNumber],
        ["Demand draft date", fallback.instrumentDate],
        ["Draft status", d.instrumentStatus],
        ["Issuing bank", fallback.bankName],
        ["Branch", fallback.branchName],
        ["Purchaser / payer", fallback.payerName],
        ["Payee", d.payeeName],
        ["Payable at", d.payableAt],
        ["Deposit date", d.depositDate],
        ["Deposit bank", d.depositBank],
        ["Deposit reference", d.depositReference],
      ]);
    case "BankTransfer":
      return rows([
        ["UTR number", fallback.referenceNumber],
        ["Transaction reference", d.transactionReference],
        ["Transfer mode", d.transferMode],
        ["Transfer date", fallback.instrumentDate],
        ["Transfer time", d.transactionTime],
        ["Payer / sender", fallback.payerName],
        ["Payer bank", fallback.bankName],
        ["Branch", fallback.branchName],
        ["Receiving bank", d.receivingBank],
        ["Transfer status", d.instrumentStatus],
      ]);
    case "UpiQr":
      return rows([
        ["UPI transaction ID", fallback.referenceNumber],
        ["UPI reference", d.transactionReference],
        ["Payment date", fallback.instrumentDate],
        ["Payment time", d.transactionTime],
        ["Payer", fallback.payerName],
        ["Payer UPI ID", fallback.payerUpiId],
        ["Receiver UPI ID", d.receiverUpiId],
        ["UPI app / bank", fallback.bankName],
        ["Payment status", d.instrumentStatus],
      ]);
    default:
      return rows([["Reference", fallback.referenceNumber]]);
  }
}