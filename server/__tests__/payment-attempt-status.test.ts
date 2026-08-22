import { describe, expect, it } from "vitest";
import { classifyStudentPaymentAttempt } from "@shared/payment-attempt-status";
import {
  mapRazorpayPayment,
  razorpayPaymentBusinessDateIST,
  razorpayPaymentCapturedAt,
} from "../rzp-enrichment";

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

  it.each([
    ["2026-08-21T18:29:59Z", "2026-08-21"],
    ["2026-08-21T18:30:00Z", "2026-08-22"],
    ["2026-08-21T18:30:01Z", "2026-08-22"],
    ["2026-08-22T18:29:59Z", "2026-08-22"],
    ["2026-08-22T18:30:00Z", "2026-08-23"],
  ])("derives the payment business date at IST midnight: %s", (instant, expectedDate) => {
    expect(razorpayPaymentBusinessDateIST({
      status: "captured",
      created_at: Date.parse(instant) / 1000,
    })).toBe(expectedDate);
  });

  it("prefers a real provider capture instant, then the signed capture-event instant", () => {
    const paymentCreatedAt = Date.parse("2026-08-21T18:29:00Z") / 1000;
    const eventCreatedAt = Date.parse("2026-08-21T18:30:00Z") / 1000;
    const capturedAt = Date.parse("2026-08-22T18:30:00Z") / 1000;

    expect(razorpayPaymentBusinessDateIST(
      { status: "captured", created_at: paymentCreatedAt },
      { event: "payment.captured", created_at: eventCreatedAt },
    )).toBe("2026-08-22");

    const selected = razorpayPaymentCapturedAt(
      { status: "captured", created_at: paymentCreatedAt, captured_at: capturedAt },
      { event: "payment.captured", created_at: eventCreatedAt },
    );
    expect(selected?.toISOString()).toBe("2026-08-22T18:30:00.000Z");
    expect(razorpayPaymentBusinessDateIST(
      { status: "captured", created_at: paymentCreatedAt, captured_at: capturedAt },
      { event: "payment.captured", created_at: eventCreatedAt },
    )).toBe("2026-08-23");
  });
});