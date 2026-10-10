import assert from "node:assert/strict";
import test from "node:test";
import { isRefundedPaidInvoiceWithBalance } from "./student-fees-display";

test("only a processed-refund Paid invoice with a positive remaining balance qualifies", () => {
  assert.equal(isRefundedPaidInvoiceWithBalance({
    status: "Paid", processed_refund_amount: 50, refund_adjusted_total_due: 50,
  }), true);
  assert.equal(isRefundedPaidInvoiceWithBalance({
    status: "Paid", processed_refund_amount: 50, refund_adjusted_total_due: 0,
  }), false);
  assert.equal(isRefundedPaidInvoiceWithBalance({
    status: "Due", processed_refund_amount: 50, refund_adjusted_total_due: 50,
  }), false);
});
