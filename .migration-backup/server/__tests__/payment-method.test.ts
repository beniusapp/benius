/**
 * server/__tests__/payment-method.test.ts
 *
 * Regression tests for the payment-method normalization utilities.
 * Ensures the business-facing "Portal Payment" label is used consistently
 * and that offline payment methods are never misclassified.
 *
 * "Transaction-detail PDF" section (near the bottom) specifically validates the
 * gateway-detection and display-normalization logic used in the
 * GET /api/admin/fees/:id/transaction-pdf route handler:
 *   const isOn = isPortalPayment(pr.payment_method) || Boolean(pr.razorpay_payment_id);
 *   const methodDisplayLabel = normalizePaymentMethod(pr.payment_method) ?? pr.payment_method;
 */

import { describe, it, expect } from "vitest";
import { normalizePaymentMethod, isPortalPayment, expandPaymentMethodFilter } from "@shared/payment-method";

describe("normalizePaymentMethod", () => {
  it('maps the legacy "Online" value to "Portal Payment"', () => {
    expect(normalizePaymentMethod("Online")).toBe("Portal Payment");
  });

  it('keeps "Portal Payment" as-is (idempotent)', () => {
    expect(normalizePaymentMethod("Portal Payment")).toBe("Portal Payment");
  });

  it("leaves Cash unchanged", () => {
    expect(normalizePaymentMethod("Cash")).toBe("Cash");
  });

  it("leaves BankTransfer unchanged", () => {
    expect(normalizePaymentMethod("BankTransfer")).toBe("BankTransfer");
  });

  it("leaves UpiQr unchanged", () => {
    expect(normalizePaymentMethod("UpiQr")).toBe("UpiQr");
  });

  it("leaves DemandDraft unchanged", () => {
    expect(normalizePaymentMethod("DemandDraft")).toBe("DemandDraft");
  });

  it("leaves Cheque unchanged", () => {
    expect(normalizePaymentMethod("Cheque")).toBe("Cheque");
  });

  it("returns null for null input", () => {
    expect(normalizePaymentMethod(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizePaymentMethod(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizePaymentMethod("")).toBeNull();
  });

  it("does NOT convert a non-portal offline method to Portal Payment", () => {
    expect(normalizePaymentMethod("Cash")).not.toBe("Portal Payment");
    expect(normalizePaymentMethod("BankTransfer")).not.toBe("Portal Payment");
    expect(normalizePaymentMethod("Cheque")).not.toBe("Portal Payment");
    expect(normalizePaymentMethod("DemandDraft")).not.toBe("Portal Payment");
    expect(normalizePaymentMethod("UpiQr")).not.toBe("Portal Payment");
  });
});

describe("isPortalPayment", () => {
  it('returns true for the legacy "Online" stored value', () => {
    expect(isPortalPayment("Online")).toBe(true);
  });

  it('returns true for the canonical "Portal Payment" value', () => {
    expect(isPortalPayment("Portal Payment")).toBe(true);
  });

  it("returns false for Cash", () => {
    expect(isPortalPayment("Cash")).toBe(false);
  });

  it("returns false for BankTransfer", () => {
    expect(isPortalPayment("BankTransfer")).toBe(false);
  });

  it("returns false for UpiQr", () => {
    expect(isPortalPayment("UpiQr")).toBe(false);
  });

  it("returns false for DemandDraft", () => {
    expect(isPortalPayment("DemandDraft")).toBe(false);
  });

  it("returns false for Cheque", () => {
    expect(isPortalPayment("Cheque")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isPortalPayment(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPortalPayment(undefined)).toBe(false);
  });
});

describe("expandPaymentMethodFilter", () => {
  it('expands "Portal Payment" to also include the legacy "Online" value', () => {
    const result = expandPaymentMethodFilter(["Portal Payment"]);
    expect(result).toContain("Portal Payment");
    expect(result).toContain("Online");
  });

  it('expands "Online" to also include "Portal Payment"', () => {
    const result = expandPaymentMethodFilter(["Online"]);
    expect(result).toContain("Online");
    expect(result).toContain("Portal Payment");
  });

  it("does not duplicate when both values are already present", () => {
    const result = expandPaymentMethodFilter(["Portal Payment", "Online"]);
    const portalCount = result.filter(v => v === "Portal Payment").length;
    const onlineCount  = result.filter(v => v === "Online").length;
    expect(portalCount).toBe(1);
    expect(onlineCount).toBe(1);
  });

  it("leaves offline methods unchanged", () => {
    const input = ["Cash", "BankTransfer", "Cheque"];
    const result = expandPaymentMethodFilter(input);
    expect(result).toEqual(input);
    expect(result).not.toContain("Portal Payment");
    expect(result).not.toContain("Online");
  });

  it("handles a mixed array of portal and offline methods", () => {
    const result = expandPaymentMethodFilter(["Cash", "Portal Payment", "UpiQr"]);
    expect(result).toContain("Cash");
    expect(result).toContain("Portal Payment");
    expect(result).toContain("Online");   // expanded
    expect(result).toContain("UpiQr");
  });

  it("does not convert a legitimate offline method to a portal value", () => {
    const result = expandPaymentMethodFilter(["Cash"]);
    expect(result).not.toContain("Portal Payment");
    expect(result).not.toContain("Online");
  });

  it("returns empty array for empty input", () => {
    expect(expandPaymentMethodFilter([])).toEqual([]);
  });
});

// ─── Transaction-detail PDF gateway-detection contract ────────────────────────
// Mirrors the isOn logic in GET /api/admin/fees/:id/transaction-pdf:
//   const isOn = isPortalPayment(pr.payment_method) || Boolean(pr.razorpay_payment_id);
// and the display label logic:
//   const methodDisplayLabel = normalizePaymentMethod(pr.payment_method) ?? pr.payment_method;
//
// These must stay in sync whenever the route handler changes.
describe("Transaction-detail PDF — gateway detection and display label", () => {
  function isOn(paymentMethod: string | null | undefined, razorpayPaymentId: string | null | undefined): boolean {
    return isPortalPayment(paymentMethod) || Boolean(razorpayPaymentId);
  }
  function displayLabel(paymentMethod: string | null | undefined): string {
    return normalizePaymentMethod(paymentMethod) ?? (paymentMethod || "—");
  }

  // ── Gateway detection ───────────────────────────────────────────────────────
  it("legacy 'Online' record with no razorpay_payment_id is detected as gateway", () => {
    expect(isOn("Online", null)).toBe(true);
  });

  it("canonical 'Portal Payment' record with no razorpay_payment_id is detected as gateway", () => {
    expect(isOn("Portal Payment", null)).toBe(true);
  });

  it("offline Cash record with a razorpay_payment_id is still detected as gateway (edge case)", () => {
    // razorpay_payment_id is the reliable Razorpay signal regardless of method
    expect(isOn("Cash", "pay_abc123")).toBe(true);
  });

  it("offline Cash record with no razorpay_payment_id is NOT a gateway payment", () => {
    expect(isOn("Cash", null)).toBe(false);
  });

  it("offline BankTransfer record with no razorpay_payment_id is NOT a gateway payment", () => {
    expect(isOn("BankTransfer", null)).toBe(false);
  });

  // ── Display label ───────────────────────────────────────────────────────────
  it("legacy 'Online' stored value displays as 'Portal Payment'", () => {
    expect(displayLabel("Online")).toBe("Portal Payment");
  });

  it("canonical 'Portal Payment' stored value displays as 'Portal Payment'", () => {
    expect(displayLabel("Portal Payment")).toBe("Portal Payment");
  });

  it("offline Cash displays as 'Cash'", () => {
    expect(displayLabel("Cash")).toBe("Cash");
  });

  it("offline BankTransfer displays as 'BankTransfer'", () => {
    expect(displayLabel("BankTransfer")).toBe("BankTransfer");
  });

  it("null payment method falls back to '—'", () => {
    expect(displayLabel(null)).toBe("—");
  });
});

// ─── Transaction-report channel vs. instrument contract ───────────────────────
// Mirrors the isPortalAttempt logic in transaction-report-data.ts Step 3 projection:
//   const isPortalAttempt = prMethodNormalized === "Portal Payment" || Boolean(row.razorpay_payment_id);
//   const paymentMethod = isPortalAttempt ? "Portal Payment" : ...;
//
// Key requirement: portal channel must be "Portal Payment" even for failed or
// cancelled attempts that have NO linked payment_records row (prMethodNormalized
// is null in that case), as long as razorpay_payment_id is present.
describe("Transaction-report — portal channel identification without a linked payment record", () => {
  function isPortalAttempt(prMethod: string | null | undefined, razorpayPaymentId: string | null | undefined): boolean {
    const prMethodNormalized = normalizePaymentMethod(prMethod) ?? null;
    return prMethodNormalized === "Portal Payment" || Boolean(razorpayPaymentId);
  }

  it("captured attempt WITH linked 'Portal Payment' pr → portal channel", () => {
    expect(isPortalAttempt("Portal Payment", "pay_captured")).toBe(true);
  });

  it("captured attempt WITH linked legacy 'Online' pr → portal channel", () => {
    expect(isPortalAttempt("Online", "pay_captured")).toBe(true);
  });

  it("failed attempt WITHOUT linked pr but WITH razorpay_payment_id → portal channel", () => {
    expect(isPortalAttempt(null, "pay_failed_123")).toBe(true);
  });

  it("cancelled attempt WITHOUT linked pr but WITH razorpay_payment_id → portal channel", () => {
    expect(isPortalAttempt(null, "pay_cancelled_abc")).toBe(true);
  });

  it("offline Cash attempt WITHOUT razorpay_payment_id → NOT portal channel", () => {
    expect(isPortalAttempt("Cash", null)).toBe(false);
  });

  it("offline BankTransfer attempt WITHOUT razorpay_payment_id → NOT portal channel", () => {
    expect(isPortalAttempt("BankTransfer", null)).toBe(false);
  });

  it("null pr method AND null razorpay_payment_id → NOT portal channel", () => {
    expect(isPortalAttempt(null, null)).toBe(false);
  });
});
