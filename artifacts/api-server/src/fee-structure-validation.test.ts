import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeeStructureAmountSyncPatch,
  feeBreakdownTotalError,
  tieredSlabsError,
} from "./fee-structure-validation";

test("fee-structure breakdown validation accepts empty breakdowns and exact integer totals", () => {
  assert.equal(feeBreakdownTotalError(1000, []), null);
  assert.equal(feeBreakdownTotalError(1000, [
    { name: "Tuition", amount: 700 },
    { name: "Library", amount: 300 },
  ]), null);
  assert.match(feeBreakdownTotalError(1000, [{ name: "Tuition", amount: 999 }]) ?? "", /must match/);
});

test("tiered late-fee validation permits adjacent ranges and rejects reversed or overlapping ranges", () => {
  assert.equal(tieredSlabsError([
    { from_day: 1, to_day: 5, amount: 10 },
    { from_day: 6, to_day: 10, amount: 20 },
  ]), null);
  assert.match(tieredSlabsError([{ from_day: 5, to_day: 4, amount: 10 }]) ?? "", /start on or before/);
  assert.match(tieredSlabsError([
    { from_day: 1, to_day: 5, amount: 10 },
    { from_day: 5, to_day: 8, amount: 20 },
  ]) ?? "", /must not overlap/);
  assert.match(tieredSlabsError([{ from_day: 0, to_day: 4, amount: 10 }]) ?? "", /positive integers/);
});

test("eligible amount sync produces amount and matching snapshot as one patch", () => {
  assert.deepEqual(
    buildFeeStructureAmountSyncPatch(1200, [
      { name: "Tuition", purpose: "Annual", amount: 900 },
      { name: "Library", amount: 300 },
    ]),
    {
      amount: 1200,
      breakdownSnapshot: [
        { name: "Tuition", purpose: "Annual", amount: 900 },
        { name: "Library", purpose: "", amount: 300 },
      ],
    },
  );
});
