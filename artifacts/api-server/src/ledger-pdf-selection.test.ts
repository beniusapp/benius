import assert from "node:assert/strict";
import test from "node:test";
import {
  hasEveryRequestedLedgerPdfId,
  MAX_FEE_RECORD_SERIAL_ID,
  validateLedgerPdfSelection,
} from "./ledger-pdf-selection";

function expectValid(body: unknown) {
  const result = validateLedgerPdfSelection(body);
  if (!result.ok) throw new Error(result.message);
  return result.selection;
}

function expectInvalid(body: unknown, messagePart?: string) {
  const result = validateLedgerPdfSelection(body);
  if (result.ok) throw new Error("Expected Ledger PDF selection to be rejected.");
  if (messagePart) assert.match(result.message, new RegExp(messagePart));
}

test("accepts one or many explicit 32-bit fee-record IDs with the current Web empty-exclusion field", () => {
  assert.deepEqual(
    expectValid({ selectedIds: [12], excludedIds: [] }),
    { selectAllMatching: false, selectedIds: [12], excludedIds: [] },
  );
  assert.deepEqual(
    expectValid({ selectAllMatching: false, selectedIds: [12, 24], excludedIds: [] }),
    { selectAllMatching: false, selectedIds: [12, 24], excludedIds: [] },
  );
  assert.deepEqual(
    expectValid({ selectedIds: [MAX_FEE_RECORD_SERIAL_ID] }).selectedIds,
    [MAX_FEE_RECORD_SERIAL_ID],
  );
});

test("rejects malformed explicit selections instead of dropping IDs or exporting all matches", () => {
  expectInvalid({ selectAllMatching: false }, "selectedIds");
  expectInvalid({ selectAllMatching: false, selectedIds: [] }, "at least one");
  expectInvalid({ selectAllMatching: false, selectedIds: "12" }, "array");
  expectInvalid({ selectAllMatching: false, selectedIds: [12, "bad"] }, "positive 32-bit");
  expectInvalid({ selectAllMatching: false, selectedIds: ["12"] }, "positive 32-bit");
  expectInvalid({ selectAllMatching: false, selectedIds: [0] }, "positive 32-bit");
  expectInvalid({ selectAllMatching: false, selectedIds: [-12] }, "positive 32-bit");
  expectInvalid({ selectAllMatching: false, selectedIds: [1.5] }, "positive 32-bit");
  expectInvalid({ selectAllMatching: false, selectedIds: [Number.MAX_SAFE_INTEGER + 1] }, "positive 32-bit");
  expectInvalid({ selectAllMatching: false, selectedIds: [MAX_FEE_RECORD_SERIAL_ID + 1] }, "positive 32-bit");
  expectInvalid({ selectAllMatching: false, selectedIds: [12, 12] }, "duplicate");
  expectInvalid({ selectAllMatching: false, selectedIds: [12], excludedIds: [24] }, "only be used");
});

test("rejects non-boolean modes and conflicting select-all parameters", () => {
  expectInvalid({ selectAllMatching: "true", selectedIds: [12] }, "boolean");
  expectInvalid({ selectAllMatching: null, selectedIds: [12] }, "boolean");
  expectInvalid({ selectAllMatching: true, selectedIds: [12], excludedIds: [] }, "must be empty");
  expectInvalid({ selectAllMatching: true, selectedIds: [], excludedIds: [12, 12] }, "duplicate");
  expectInvalid({ selectAllMatching: true, selectedIds: [], excludedIds: [12, "bad"] }, "positive 32-bit");
  expectInvalid({ selectAllMatching: true, selectedIds: [], excludedIds: 0 }, "array");
  expectInvalid({ selectAllMatching: true, selectedIds: null, excludedIds: [] }, "array");
});

test("preserves select-all with absent or valid exclusions", () => {
  assert.deepEqual(
    expectValid({ selectAllMatching: true }),
    { selectAllMatching: true, selectedIds: [], excludedIds: [] },
  );
  assert.deepEqual(
    expectValid({ selectAllMatching: true, selectedIds: [], excludedIds: [24, 48] }),
    { selectAllMatching: true, selectedIds: [], excludedIds: [24, 48] },
  );
});

test("explicit authorization requires every requested ID in the already scoped result set", () => {
  assert.equal(hasEveryRequestedLedgerPdfId([12], [12]), true);
  assert.equal(hasEveryRequestedLedgerPdfId([12, 24], [12, 24]), true);
  assert.equal(hasEveryRequestedLedgerPdfId([12, 24], [24, 12, 12]), true);

  // These all appear identically as absent from the school/session/filter-scoped query.
  for (const absentId of [101, 202, 303, 404]) {
    assert.equal(hasEveryRequestedLedgerPdfId([12, absentId], [12, 24]), false);
  }
  assert.equal(hasEveryRequestedLedgerPdfId([], [12, 24]), false);
  assert.equal(hasEveryRequestedLedgerPdfId([12], ["12"]), false);
});
