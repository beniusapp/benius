import { describe, expect, it } from "vitest";
import { classifyStudentPaymentAttempt } from "@shared/payment-attempt-status";
import { mapRazorpayPayment } from "../rzp-enrichment";

describe("student payment-attempt status mapping", () => {
  it("preserves the authoritative non-failure lifecycle states", () => {
    expect(classifyStudentPaymentAttempt({ outcome: "captured" })).toBe("Paid");
    expect(classifyStudentPaymentAttempt({ outcome: "authorized" })).toBe("Payment Authorized");
    expect(classifyStudentPaymentAttempt({ outcome: "pending" })).toBe("Payment Pending");
    expect(classifyStudentPaymentAttempt({ outcome: "refunded" })).toBe("Payment Refunded");
  });

  it("keeps checkout cancellation separate from a real gateway failure", () => {
    expect(classifyStudentPaymentAttempt({ outcome: "cancelled" })).toBe("Payment Cancelled");
    expect(classifyStudentPaymentAttempt({
      outcome: "failed",
      errorReason: "payment_failed",
    })).toBe("Payment Failed");
  });

  it("shows an expired gateway failure as expired, not cancelled", () => {
    expect(classifyStudentPaymentAttempt({
      outcome: "failed",
      errorDescription: "The Razorpay order has expired",
    })).toBe("Payment Expired");
  });

  it("keeps the original captured amount separate from a partial refund", () => {
    expect(mapRazorpayPayment({
      id: "pay_partial_refund",
      status: "captured",
      amount: 100000,
      amount_refunded: 25000,
      currency: "INR",
    })).toMatchObject({
      amountCapturedPaise: 100000,
      amountRefundedPaise: 25000,
    });
  });
});