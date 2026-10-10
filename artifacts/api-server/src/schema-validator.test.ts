import assert from "node:assert/strict";
import test from "node:test";
import { validateSchemaColumns } from "./schema-validator";

const receiptTable = "student_complaint_read_receipts";
const expectedReceiptColumns = [
  "school_id",
  "student_id",
  "session_id",
  "complaint_id",
  "read_at",
];

function createEmptySchemaPool() {
  return {
    query: async () => ({ rows: [] }),
  } as any;
}

test("disabled receipt tracking excludes only the optional receipt table", async () => {
  const missing = await validateSchemaColumns(createEmptySchemaPool(), {
    studentComplaintReadReceiptsEnabled: false,
  });

  assert.equal(missing.some(({ table }) => table === receiptTable), false);
  assert.equal(missing.some(({ table }) => table === "students"), true);
});

test("enabled receipt tracking requires every receipt-table column", async () => {
  const missing = await validateSchemaColumns(createEmptySchemaPool(), {
    studentComplaintReadReceiptsEnabled: true,
  });

  assert.deepEqual(
    missing
      .filter(({ table }) => table === receiptTable)
      .map(({ column }) => column)
      .sort(),
    [...expectedReceiptColumns].sort(),
  );
});
