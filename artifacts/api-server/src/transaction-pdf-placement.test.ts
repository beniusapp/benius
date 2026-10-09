import assert from "node:assert/strict";
import test from "node:test";
import { getCellLines, type TxRow } from "./transaction-pdf";

const row: TxRow = {
  id: "pa:1",
  attempt_number: 1,
  student_name: "Synthetic Student",
  student_id: "S-1",
  class: "1",
  section: "A",
  placement_warning: "Session mismatch: payment attempt session ID 201 differs from invoice session ID 202.",
  invoice_number: "INV-1",
  receipt_number: null,
  fee_name: "Tuition",
  fee_type: "Tuition",
  payment_method: "Portal Payment",
  transaction_at: "2026-05-01T10:00:00Z",
  amount: 1250,
  status: "captured",
  payment_id: "pay-1",
  order_id: "order-1",
  reference_number: null,
  failure_reason: null,
  refund_amount: 0,
  refund_status: null,
};

test("transaction PDF places a session mismatch warning in the placement cell", () => {
  assert.deepEqual(getCellLines(row, "class"), [
    "1-A",
    "Warning: Session mismatch: payment attempt session ID 201 differs from invoice session ID 202.",
  ]);
  assert.equal(row.amount, 1250);
  assert.equal(row.status, "captured");
});
