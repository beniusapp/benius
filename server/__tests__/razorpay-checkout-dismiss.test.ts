import { describe, expect, it } from "vitest";
import { getCheckoutDismissAction } from "@shared/razorpay-checkout-dismiss";

describe("Razorpay checkout dismissal classification", () => {
  it("does not create a cancellation after a genuine gateway failure", () => {
    expect(getCheckoutDismissAction(true, false)).toBe("ignore");
  });

  it("keeps timeout and voluntary dismissal distinct", () => {
    expect(getCheckoutDismissAction(false, true)).toBe("expired");
    expect(getCheckoutDismissAction(false, false)).toBe("cancelled");
  });
});