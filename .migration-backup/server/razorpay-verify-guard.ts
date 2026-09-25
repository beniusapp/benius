/**
 * Validation for the client-side Razorpay success callback.
 *
 * The callback signature proves Razorpay signed a payment/order pair, but it
 * does not by itself prove that the pair belongs to the invoice currently being
 * paid or that the payment was captured for the expected amount. This guard
 * validates those facts against Razorpay's API before a fee can be marked Paid.
 */

export interface CapturedPaymentVerificationInput {
  feeRecordId: number;
  schoolId: number;
  feeAmount: number;
  expectedOrderId: string | null | undefined;
  payment: any;
  order: any;
}

export type CapturedPaymentVerificationResult =
  | { ok: true; lateFeeAmount: number; amountPaise: number }
  | { ok: false; message: string };

export function validateCapturedRazorpayPayment(
  input: CapturedPaymentVerificationInput,
): CapturedPaymentVerificationResult {
  const { feeRecordId, schoolId, feeAmount, expectedOrderId, payment, order } = input;

  if (!expectedOrderId) {
    return { ok: false, message: "This payment session is no longer active. Please wait for the payment status to refresh." };
  }
  if (!payment || !order) {
    return { ok: false, message: "Unable to confirm the payment with Razorpay. Please wait a moment and try again." };
  }
  if (payment.status !== "captured") {
    return { ok: false, message: "Payment has not been captured yet. Please wait for confirmation before trying again." };
  }
  if (order.id !== expectedOrderId || payment.order_id !== expectedOrderId) {
    return { ok: false, message: "Payment order does not match this invoice." };
  }
  if (order.status !== "paid") {
    return { ok: false, message: "Razorpay has not marked this order as paid yet. Please wait for confirmation." };
  }
  if (payment.currency !== "INR" || order.currency !== "INR") {
    return { ok: false, message: "Unexpected payment currency for this invoice." };
  }

  const notes = order.notes ?? {};
  if (String(notes.feeRecordId ?? "") !== String(feeRecordId) ||
      String(notes.schoolId ?? "") !== String(schoolId)) {
    return { ok: false, message: "Payment order does not belong to this invoice." };
  }

  const rawLateFee = Number(notes.lateFeeAmount);
  if (!Number.isFinite(rawLateFee) || rawLateFee < 0) {
    return { ok: false, message: "Payment order is missing its fee snapshot. Please contact the school office." };
  }
  const lateFeeAmount = Math.round(rawLateFee);
  const expectedAmountPaise = Math.round((Number(feeAmount) + lateFeeAmount) * 100);

  if (Number(order.amount) !== expectedAmountPaise || Number(payment.amount) !== expectedAmountPaise) {
    return { ok: false, message: "Payment amount does not match this invoice." };
  }

  return { ok: true, lateFeeAmount, amountPaise: expectedAmountPaise };
}