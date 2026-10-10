import assert from "node:assert/strict";
import test from "node:test";
import { studentFeeDisplayLateFee } from "./late-fee-engine";

test("uses the current policy calculation for display and preserves stored fallback", () => {
  const referenceDate = new Date("2026-10-10T12:00:00Z");
  const config = {
    enabled: true, type: "FLAT" as const, grace_period_days: 0,
    flat_amount: 25, daily_rate: 0, max_cap: 0, tiered_slabs: [],
  };
  assert.equal(studentFeeDisplayLateFee(config, "2026-10-01", "Due", 10, referenceDate), 25);
  assert.equal(studentFeeDisplayLateFee(null, "2026-10-01", "Due", 10, referenceDate), 10);
});
