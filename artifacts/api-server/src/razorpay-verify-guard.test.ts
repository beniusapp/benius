import assert from "node:assert/strict";
import test from "node:test";
import { validateCapturedRazorpayPayment } from "./razorpay-verify-guard";

const base = {
  feeRecordId: 19, schoolId: 7, feeAmount: 100,
  expectedOrderId: "order_fee19",
  payment: { status: "captured", order_id: "order_fee19", currency: "INR", amount: 10500 },
  order: {
    id: "order_fee19", status: "paid", currency: "INR", amount: 10500,
    notes: { feeRecordId: "19", schoolId: "7", lateFeeAmount: "5" },
  },
};

test("native verification accepts only the exact captured fee order", () => {
  assert.equal(validateCapturedRazorpayPayment(base).ok, true);
  assert.equal(validateCapturedRazorpayPayment({
    ...base, payment: { ...base.payment, order_id: "order_other" },
  }).ok, false);
  assert.equal(validateCapturedRazorpayPayment({
    ...base, order: { ...base.order, notes: { ...base.order.notes, schoolId: "8" } },
  }).ok, false);
  assert.equal(validateCapturedRazorpayPayment({
    ...base, payment: { ...base.payment, amount: 10400 },
  }).ok, false);
});

test("unpaid or unsigned provider states cannot settle", () => {
  assert.equal(validateCapturedRazorpayPayment({
    ...base, payment: { ...base.payment, status: "authorized" },
  }).ok, false);
  assert.equal(validateCapturedRazorpayPayment({
    ...base, order: { ...base.order, status: "created" },
  }).ok, false);
});