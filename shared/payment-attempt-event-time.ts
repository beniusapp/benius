import type { PaymentAttemptOutcome } from "./payment-attempt-status";

export interface PaymentAttemptEventTimeInput {
  outcome: PaymentAttemptOutcome;
  createdAt?: string | null;
  rzpCreatedAt?: string | null;
  rzpAuthorizedAt?: string | null;
  rzpCapturedAt?: string | null;
  rzpFailedAt?: string | null;
  refundInitiatedAt?: string | null;
  refundProcessedAt?: string | null;
}

/**
 * Selects the timestamp that represents the status being shown, rather than
 * the time the local history row happened to be inserted.
 */
export function paymentAttemptEventTime(attempt: PaymentAttemptEventTimeInput): string | null {
  switch (attempt.outcome) {
    case "captured":
      return attempt.rzpCapturedAt ?? attempt.rzpCreatedAt ?? attempt.createdAt ?? null;
    case "refunded":
      return attempt.refundProcessedAt ?? attempt.refundInitiatedAt ??
        attempt.rzpCapturedAt ?? attempt.createdAt ?? null;
    case "authorized":
      return attempt.rzpAuthorizedAt ?? attempt.rzpCreatedAt ?? attempt.createdAt ?? null;
    case "failed":
      return attempt.rzpFailedAt ?? attempt.rzpCreatedAt ?? attempt.createdAt ?? null;
    case "pending":
      return attempt.rzpCreatedAt ?? attempt.createdAt ?? null;
    case "cancelled":
      return attempt.createdAt ?? null;
  }
}