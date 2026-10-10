import assert from "node:assert/strict";
import test from "node:test";
import { attachStatementSessionPlacement } from "./student-fee-statement";

test("payment statement placement follows its selected fee session and never current registry", () => {
  const placement = {
    available: true as const, reason: null, className: "Class 4", sectionName: "B", rollNumber: 17,
  };
  const rows = attachStatementSessionPlacement([
    { id: 1, feeRecordId: 11, feeSessionId: 22 },
    { id: 2, feeRecordId: 12, feeSessionId: 21 },
    { id: 3, feeRecordId: null, feeSessionId: 22 },
  ], 22, "2026–27", placement);
  assert.equal(rows[0]?.className, "Class 4");
  assert.equal(rows[0]?.rollNumber, 17);
  assert.equal(rows[0]?.academicSessionLabel, "2026–27");
  assert.equal(rows[1]?.historicalPlacementAvailable, false);
  assert.equal(rows[2]?.historicalPlacementAvailable, false);
});
