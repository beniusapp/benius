import { describe, expect, it } from "vitest";
import { getMultiInvoiceOfflinePaymentError } from "../offline-payment-request-guard";

describe("offline payment single-invoice request guard", () => {
  it("allows a request with one scalar invoice ID", () => {
    expect(getMultiInvoiceOfflinePaymentError({ feeRecordId: 101 })).toBeNull();
  });

  it("rejects the retired FIFO allocation request", () => {
    expect(getMultiInvoiceOfflinePaymentError({ autoFifo: true })).toMatch(/exactly one invoice/i);
  });

  it("rejects crafted requests containing multiple invoice IDs", () => {
    expect(getMultiInvoiceOfflinePaymentError({ feeRecordId: [101, 102] })).toMatch(/exactly one invoice/i);
    expect(getMultiInvoiceOfflinePaymentError({ feeRecordIds: [101, 102] })).toMatch(/exactly one invoice/i);
  });
});