import assert from "node:assert/strict";
import test from "node:test";
import {
  processedRefundTotalRupees,
  refundAdjustedOutstanding,
  studentOpenFeeDisplayBalance,
} from "./financial-reporting-balance";

test("keeps paid and partially paid no-refund open totals unchanged", () => {
  assert.equal(refundAdjustedOutstanding(10_000, 10_000, 0), 0);
  assert.equal(studentOpenFeeDisplayBalance(10_000, 10_000, 0), 10_000);
  assert.equal(studentOpenFeeDisplayBalance(10_000, 4_000, 0), 10_000);
});

test("processed refunds restore the refund-aware remaining balance", () => {
  assert.equal(studentOpenFeeDisplayBalance(10_000, 10_000, 2_000), 2_000);
  assert.equal(studentOpenFeeDisplayBalance(10_000, 10_000, 10_000), 10_000);
});

test("pending and failed refunds do not affect retained-payment balances", () => {
  const refunds = [
    { localStatus: "pending", processedAmountPaise: null, requestedAmountPaise: 200_000 },
    { localStatus: "failed", processedAmountPaise: null, requestedAmountPaise: 300_000 },
  ];
  const processed = processedRefundTotalRupees(refunds);
  assert.equal(processed, 0);
  assert.equal(refundAdjustedOutstanding(10_000, 10_000, processed), 0);
});

test("multiple processed refunds are summed once from the refund rows", () => {
  const processed = processedRefundTotalRupees([
    { localStatus: "processed", processedAmountPaise: 100_000, requestedAmountPaise: 100_000 },
    { localStatus: "processed", processedAmountPaise: 100_000, requestedAmountPaise: 100_000 },
  ]);
  assert.equal(processed, 2_000);
  assert.equal(refundAdjustedOutstanding(10_000, 10_000, processed), 2_000);
});

test("processed refunds remain lifetime balance inputs regardless of report-period date", () => {
  const processed = processedRefundTotalRupees([
    { localStatus: "processed", processedAmountPaise: 200_000, requestedAmountPaise: 200_000 },
  ]);
  assert.equal(refundAdjustedOutstanding(10_000, 10_000, processed), 2_000);
});
