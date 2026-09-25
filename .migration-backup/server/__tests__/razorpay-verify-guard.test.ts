import { describe, expect, it } from "vitest";
import { validateCapturedRazorpayPayment } from "../razorpay-verify-guard";

function validInput() {
  return {
    feeRecordId: 42,
    schoolId: 7,
    feeAmount: 1200,
    expectedOrderId: "order_invoice_42",
    payment: {
      id: "pay_captured_42",
      order_id: "order_invoice_42",
      status: "captured",
      amount: 125000,
      currency: "INR",
    },
    order: {
      id: "order_invoice_42",
      status: "paid",
      amount: 125000,
      currency: "INR",
      notes: { feeRecordId: "42", schoolId: "7", lateFeeAmount: "50" },
    },
  };
}

describe("client Razorpay verification guard", () => {
  it("accepts only a captured payment for the active invoice order and frozen amount", () => {
    expect(validateCapturedRazorpayPayment(validInput())).toEqual({
      ok: true,
      lateFeeAmount: 50,
      amountPaise: 125000,
    });
  });

  it("rejects an authorized payment so it cannot mark a fee paid early", () => {
    const input = validInput();
    input.payment.status = "authorized";

    expect(validateCapturedRazorpayPayment(input)).toMatchObject({
      ok: false,
      message: expect.stringContaining("not been captured"),
    });
  });

  it("rejects a valid payment signature pair that belongs to another order", () => {
    const input = validInput();
    input.payment.order_id = "order_other_invoice";

    expect(validateCapturedRazorpayPayment(input)).toMatchObject({
      ok: false,
      message: expect.stringContaining("does not match"),
    });
  });

  it("rejects a captured payment whose order notes or amount do not belong to the invoice", () => {
    const wrongNotes = validInput();
    wrongNotes.order.notes.feeRecordId = "99";
    expect(validateCapturedRazorpayPayment(wrongNotes)).toMatchObject({
      ok: false,
      message: expect.stringContaining("does not belong"),
    });

    const wrongAmount = validInput();
    wrongAmount.payment.amount = 120000;
    expect(validateCapturedRazorpayPayment(wrongAmount)).toMatchObject({
      ok: false,
      message: expect.stringContaining("amount does not match"),
    });
  });
});