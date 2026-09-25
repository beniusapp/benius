export type CheckoutDismissAction = "ignore" | "expired" | "cancelled";

/**
 * A Razorpay modal can close after the SDK has already emitted payment.failed.
 * In that case the failure is the authoritative attempt outcome; recording a
 * second checkout cancellation would misrepresent the same payment attempt.
 */
export function getCheckoutDismissAction(
  gatewayFailureReported: boolean,
  timedOut: boolean,
): CheckoutDismissAction {
  if (gatewayFailureReported) return "ignore";
  return timedOut ? "expired" : "cancelled";
}