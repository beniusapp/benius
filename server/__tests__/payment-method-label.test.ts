import { describe, expect, it } from "vitest";
import { ledgerPaymentMethodLabel } from "../payment-method-label";

describe("ledgerPaymentMethodLabel", () => {
  it.each([
    ["Cash", "Cash"],
    ["Cheque", "Cheque"],
    ["BankTransfer", "Bank Transfer"],
    ["DemandDraft", "Demand Draft"],
    ["UpiQr", "UPI / QR"],
    ["Online", "Portal Payment"],          // legacy stored value
    ["Portal Payment", "Portal Payment"],  // canonical stored value (post-migration)
  ])("maps %s to %s", (storedMethod, expectedLabel) => {
    expect(ledgerPaymentMethodLabel(storedMethod)).toBe(expectedLabel);
  });

  it("does not infer labels for missing or unknown historical values", () => {
    expect(ledgerPaymentMethodLabel(null)).toBeNull();
    expect(ledgerPaymentMethodLabel("Razorpay")).toBeNull();
  });
});