import { describe, expect, it } from "vitest";
import {
  formatOfflinePaymentMethod,
  offlinePaymentMethodLabel,
} from "../offline-payment-method";

describe("offline payment method labels", () => {
  it.each([
    ["Cash", "Cash", "Offline (Cash)"],
    ["BankTransfer", "Bank Transfer", "Offline (Bank Transfer)"],
    ["Cheque", "Cheque", "Offline (Cheque)"],
    ["DemandDraft", "Demand Draft", "Offline (Demand Draft)"],
    ["UpiQr", "UPI/QR", "Offline (UPI/QR)"],
  ])("formats %s consistently for history and receipts", (stored, label, display) => {
    expect(offlinePaymentMethodLabel(stored)).toBe(label);
    expect(formatOfflinePaymentMethod(stored)).toBe(display);
  });

  it("keeps generic legacy Offline records generic", () => {
    expect(offlinePaymentMethodLabel("Offline")).toBeNull();
    expect(formatOfflinePaymentMethod("Offline")).toBe("Offline");
  });

  it("does not infer an unknown historical method", () => {
    expect(offlinePaymentMethodLabel("Counter collection")).toBeNull();
    expect(formatOfflinePaymentMethod("Counter collection")).toBeNull();
    expect(formatOfflinePaymentMethod(null)).toBeNull();
  });
});