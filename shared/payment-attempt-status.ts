export type PaymentAttemptOutcome =
  | "captured"
  | "failed"
  | "cancelled"
  | "authorized"
  | "refunded"
  | "pending";

export type StudentPaymentHistoryStatus =
  | "Paid"
  | "Payment Cancelled"
  | "Payment Expired"
  | "Payment Failed"
  | "Payment Authorized"
  | "Payment Pending"
  | "Payment Refunded";

export interface PaymentAttemptStatusInput {
  outcome: PaymentAttemptOutcome;
  isCancelled?: boolean | null;
  errorReason?: string | null;
  errorDescription?: string | null;
}

/**
 * Turns the persisted, authoritative attempt outcome into the status shown in
 * payment history. Only genuine gateway failures receive a failure label.
 */
export function classifyStudentPaymentAttempt(
  attempt: PaymentAttemptStatusInput,
): StudentPaymentHistoryStatus {
  switch (attempt.outcome) {
    case "captured":
      return "Paid";
    case "refunded":
      return "Payment Refunded";
    case "authorized":
      return "Payment Authorized";
    case "pending":
      return "Payment Pending";
    case "cancelled":
      return "Payment Cancelled";
    case "failed": {
      const reason = (attempt.errorReason ?? "").toLowerCase();
      const description = (attempt.errorDescription ?? "").toLowerCase();
      if (
        reason === "order_expired" ||
        reason === "expired_order" ||
        description.includes("order_expired") ||
        description.includes("order has expired") ||
        description.includes("session expired") ||
        description.includes("razorpay order expired")
      ) {
        return "Payment Expired";
      }
      return "Payment Failed";
    }
  }
}