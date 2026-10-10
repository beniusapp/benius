import assert from "node:assert/strict";
import test from "node:test";
import { canShowStudentPayNow, isRefundedPaidInvoiceWithBalance, paymentAttemptPlacementRows } from "./student-fees-display";

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
  assert.equal(canShowStudentPayNow({
    status: "Paid", processed_refund_amount: 50, refund_adjusted_total_due: 50,
  }, true), false);
  assert.equal(canShowStudentPayNow({
    status: "Due",
  }, true), true);
});

test("payment statement placement follows the newly selected session's returned data", () => {
  const selectedSessionRows = paymentAttemptPlacementRows({
    academicSessionLabel: "2026–27",
    historicalPlacementAvailable: true,
    className: "Class 4",
    sectionName: "B",
    rollNumber: 17,
  });
  assert.deepEqual(selectedSessionRows, [
    ["Academic Session", "2026–27"],
    ["Class", "Class 4"],
    ["Section", "B"],
    ["Roll Number", "17"],
  ]);
  assert.equal(paymentAttemptPlacementRows({
    academicSessionLabel: "2025–26",
    historicalPlacementAvailable: false,
    className: "Class 4",
    sectionName: "B",
    rollNumber: 17,
  })[1]?.[1], "Historical placement unavailable");
});
