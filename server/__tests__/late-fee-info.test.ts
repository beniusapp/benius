/**
 * Unit tests for buildLateFeeInfo() in server/late-fee-display.ts
 *
 * These tests verify the display-oriented object produced by buildLateFeeInfo()
 * for every rule type and every meaningful state combination.
 *
 * IMPORTANT: These tests do NOT import calculateLateFee() — they pass the
 * already-computed accruedLateFee value directly, exactly as routes.ts does.
 * This keeps the display layer independent of the calculation engine.
 */

import { describe, test, expect } from "vitest";
import { buildLateFeeInfo } from "../late-fee-display";
import { type LateFeeConfig } from "../late-fee-engine";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DUE_DATE      = "2026-08-10"; // Monday 10 Aug 2026
const BEFORE_DUE    = new Date("2026-08-08T00:00:00Z"); // 2 days before due
const ON_DUE        = new Date("2026-08-10T00:00:00Z"); // due date itself
const DAY1_AFTER    = new Date("2026-08-11T00:00:00Z"); // 1 day overdue
const DAY2_AFTER    = new Date("2026-08-12T00:00:00Z"); // 2 days overdue
const DAY3_AFTER    = new Date("2026-08-13T00:00:00Z"); // 3 days overdue
const DAY10_AFTER   = new Date("2026-08-20T00:00:00Z"); // 10 days overdue
const DAY30_AFTER   = new Date("2026-09-09T00:00:00Z"); // 30 days overdue
const DAY40_AFTER   = new Date("2026-09-19T00:00:00Z"); // 40 days overdue

const FLAT_CFG: LateFeeConfig = {
  enabled: true, type: "FLAT",
  flat_amount: 100, daily_rate: 0, grace_period_days: 0, max_cap: 0, tiered_slabs: [],
};

const DAILY_CFG: LateFeeConfig = {
  enabled: true, type: "DAILY",
  flat_amount: 0, daily_rate: 20, grace_period_days: 0, max_cap: 0, tiered_slabs: [],
};

const DAILY_GRACE_CFG: LateFeeConfig = {
  enabled: true, type: "DAILY",
  flat_amount: 0, daily_rate: 20, grace_period_days: 2, max_cap: 0, tiered_slabs: [],
};

const DAILY_CAP_CFG: LateFeeConfig = {
  enabled: true, type: "DAILY",
  flat_amount: 0, daily_rate: 20, grace_period_days: 0, max_cap: 100, tiered_slabs: [],
};

const DAILY_GRACE_CAP_CFG: LateFeeConfig = {
  enabled: true, type: "DAILY",
  flat_amount: 0, daily_rate: 20, grace_period_days: 2, max_cap: 100, tiered_slabs: [],
};

const TIERED_CFG: LateFeeConfig = {
  enabled: true, type: "TIERED",
  flat_amount: 0, daily_rate: 0, grace_period_days: 0, max_cap: 0,
  tiered_slabs: [
    { from_day: 1,  to_day: 7,  amount: 100 },
    { from_day: 8,  to_day: 14, amount: 120 },
    { from_day: 15, to_day: 30, amount: 150 },
  ],
};

const DISABLED_CFG: LateFeeConfig = {
  enabled: false, type: "NONE",
  flat_amount: 0, daily_rate: 0, grace_period_days: 0, max_cap: 0, tiered_slabs: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function info(cfg: LateFeeConfig | null, now: Date, lateFee: number, status = "Due") {
  return buildLateFeeInfo(cfg, DUE_DATE, status, now, lateFee);
}

// ── Toggle disabled ───────────────────────────────────────────────────────────

describe("buildLateFeeInfo — late fee disabled", () => {
  test("null config returns enabled:false", () => {
    const r = info(null, DAY3_AFTER, 60);
    expect(r.enabled).toBe(false);
  });

  test("enabled:false config returns enabled:false", () => {
    const r = info(DISABLED_CFG, DAY3_AFTER, 0);
    expect(r.enabled).toBe(false);
  });

  test("Paid invoice returns enabled:false even with active config", () => {
    const r = buildLateFeeInfo(DAILY_CFG, DUE_DATE, "Paid", DAY3_AFTER, 0);
    expect(r.enabled).toBe(false);
  });

  test("Waived invoice returns enabled:false even with active config", () => {
    const r = buildLateFeeInfo(DAILY_CFG, DUE_DATE, "Waived", DAY3_AFTER, 0);
    expect(r.enabled).toBe(false);
  });
});

// ── Before due date ───────────────────────────────────────────────────────────

describe("buildLateFeeInfo — before due date", () => {
  test("FLAT: enabled, daysOverdue=0, no calculationLine", () => {
    const r = info(FLAT_CFG, BEFORE_DUE, 0);
    expect(r.enabled).toBe(true);
    expect(r.rule).toBe("FLAT");
    expect(r.daysOverdue).toBe(0);
    expect(r.inGracePeriod).toBe(false);
    expect(r.currentLateFee).toBe(0);
    expect(r.policyLine).toBe("₹100 one-time penalty after the due date.");
    expect(r.statusMessage).toBeNull();
    expect(r.calculationLine).toBeNull();
    expect(r.tieredSlabs).toBeNull();
  });

  test("DAILY: correct policyLine, no status/calc", () => {
    const r = info(DAILY_CFG, ON_DUE, 0);
    expect(r.daysOverdue).toBe(0);
    expect(r.policyLine).toBe("₹20 per day after the due date.");
    expect(r.statusMessage).toBeNull();
    expect(r.calculationLine).toBeNull();
  });

  test("DAILY with grace: policyLine mentions grace", () => {
    const r = info(DAILY_GRACE_CFG, BEFORE_DUE, 0);
    expect(r.policyLine).toBe("₹20 per day after a 2-day grace period.");
  });

  test("DAILY with cap: policyLine mentions max", () => {
    const r = info(DAILY_CAP_CFG, BEFORE_DUE, 0);
    expect(r.policyLine).toBe("₹20 per day after the due date. Maximum late fee ₹100.");
  });

  test("DAILY with grace + cap: policyLine includes both", () => {
    const r = info(DAILY_GRACE_CAP_CFG, BEFORE_DUE, 0);
    expect(r.policyLine).toBe("₹20 per day after a 2-day grace period. Maximum late fee ₹100.");
  });

  test("TIERED: all slabs present, none active, no calculationLine", () => {
    const r = info(TIERED_CFG, BEFORE_DUE, 0);
    expect(r.rule).toBe("TIERED");
    expect(r.tieredSlabs).toHaveLength(3);
    expect(r.activeSlabIndex).toBeNull();
    expect(r.calculationLine).toBeNull();
  });
});

// ── Grace period messaging ────────────────────────────────────────────────────

describe("buildLateFeeInfo — grace period", () => {
  test("Day 1 overdue, grace=2: inGracePeriod, correct narrative", () => {
    const r = info(DAILY_GRACE_CFG, DAY1_AFTER, 0);
    expect(r.inGracePeriod).toBe(true);
    expect(r.graceDaysRemaining).toBe(1);
    expect(r.currentLateFee).toBe(0);
    expect(r.gracePeriodMessage).toBe(
      "You are 1 day past the due date. Your 2-day grace period is still active. No late fee is charged yet."
    );
    expect(r.statusMessage).toBeNull();
    expect(r.calculationLine).toBeNull();
  });

  test("Day 2 overdue, grace=2: last day of grace — ends today message", () => {
    const r = info(DAILY_GRACE_CFG, DAY2_AFTER, 0);
    expect(r.inGracePeriod).toBe(true);
    expect(r.graceDaysRemaining).toBe(0);
    expect(r.gracePeriodMessage).toBe(
      "Your 2-day grace period ends today. No late fee is charged yet. A late fee will apply from tomorrow."
    );
  });

  test("Day 3 overdue, grace=2: grace has ended, fee starts", () => {
    const r = info(DAILY_GRACE_CFG, DAY3_AFTER, 20); // 1 billable day × ₹20
    expect(r.inGracePeriod).toBe(false);
    expect(r.graceDaysRemaining).toBe(0);
    expect(r.statusMessage).toBe(
      "Your 2-day grace period has ended. You are 3 days past the due date."
    );
    expect(r.calculationLine).toBe("1 billable day × ₹20 = ₹20");
    expect(r.gracePeriodMessage).toBeNull();
  });
});

// ── FLAT rule — overdue ───────────────────────────────────────────────────────

describe("buildLateFeeInfo — FLAT rule overdue", () => {
  test("Day 1 overdue: flat penalty, no calculationLine", () => {
    const r = info(FLAT_CFG, DAY1_AFTER, 100);
    expect(r.enabled).toBe(true);
    expect(r.currentLateFee).toBe(100);
    expect(r.daysOverdue).toBe(1);
    expect(r.statusMessage).toBe("You are 1 day past the due date.");
    // FLAT has no calculationLine — the policyLine is self-explanatory
    expect(r.calculationLine).toBeNull();
  });

  test("Day 15 overdue: flat penalty stays same, no calculationLine", () => {
    const r = info(FLAT_CFG, DAY10_AFTER, 100);
    expect(r.currentLateFee).toBe(100);
    expect(r.calculationLine).toBeNull();
    expect(r.policyLine).toBe("₹100 one-time penalty after the due date.");
  });
});

// ── DAILY rule — overdue ─────────────────────────────────────────────────────

describe("buildLateFeeInfo — DAILY rule overdue", () => {
  test("Day 3 overdue, no grace, no cap: calculation line", () => {
    const r = info(DAILY_CFG, DAY3_AFTER, 60);
    expect(r.daysOverdue).toBe(3);
    expect(r.statusMessage).toBe("You are 3 days past the due date.");
    expect(r.calculationLine).toBe("3 days × ₹20/day = ₹60");
    expect(r.currentLateFee).toBe(60);
  });

  test("Day 1 overdue: singular 'day'", () => {
    const r = info(DAILY_CFG, DAY1_AFTER, 20);
    expect(r.statusMessage).toBe("You are 1 day past the due date.");
    expect(r.calculationLine).toBe("1 day × ₹20/day = ₹20");
  });

  test("Day 10 overdue with cap=100 reached: capped note in calculationLine", () => {
    const r = info(DAILY_CAP_CFG, DAY10_AFTER, 100); // 10×₹20=₹200 but capped at ₹100
    expect(r.calculationLine).toBe("10 days × ₹20/day = ₹100 (capped at ₹100)");
    expect(r.currentLateFee).toBe(100);
  });

  test("Day 10 overdue without cap reached: no capped note", () => {
    const r = info(DAILY_CFG, DAY10_AFTER, 200);
    expect(r.calculationLine).toBe("10 days × ₹20/day = ₹200");
    expect(r.calculationLine).not.toContain("capped");
  });
});

// ── TIERED rule — overdue ─────────────────────────────────────────────────────

describe("buildLateFeeInfo — TIERED rule overdue", () => {
  test("Day 5 overdue: slab 1–7 active (index 0)", () => {
    const r = info(TIERED_CFG, new Date("2026-08-15T00:00:00Z"), 100);
    expect(r.activeSlabIndex).toBe(0);
    expect(r.tieredSlabs![0]).toEqual({ from_day: 1, to_day: 7, amount: 100 });
    expect(r.calculationLine).toBeNull(); // TIERED uses highlighted slab, not calculationLine
  });

  test("Day 10 overdue: slab 8–14 active (index 1)", () => {
    const r = info(TIERED_CFG, DAY10_AFTER, 120);
    expect(r.activeSlabIndex).toBe(1);
    expect(r.tieredSlabs![1]).toEqual({ from_day: 8, to_day: 14, amount: 120 });
  });

  test("Day 20 overdue: slab 15–30 active (index 2)", () => {
    const r = info(TIERED_CFG, new Date("2026-08-30T00:00:00Z"), 150);
    expect(r.activeSlabIndex).toBe(2);
  });

  test("Day 40 overdue: beyond last slab — pins to last slab (index 2)", () => {
    const r = info(TIERED_CFG, DAY40_AFTER, 150);
    expect(r.activeSlabIndex).toBe(2);
  });

  test("Before due: activeSlabIndex is null", () => {
    const r = info(TIERED_CFG, BEFORE_DUE, 0);
    expect(r.activeSlabIndex).toBeNull();
    expect(r.tieredSlabs).toHaveLength(3);
  });

  test("Slabs are sorted ascending by from_day", () => {
    const unsortedCfg: LateFeeConfig = {
      ...TIERED_CFG,
      tiered_slabs: [
        { from_day: 15, to_day: 30, amount: 150 },
        { from_day: 1,  to_day: 7,  amount: 100 },
        { from_day: 8,  to_day: 14, amount: 120 },
      ],
    };
    const r = info(unsortedCfg, DAY10_AFTER, 120);
    expect(r.tieredSlabs![0].from_day).toBe(1);
    expect(r.tieredSlabs![1].from_day).toBe(8);
    expect(r.tieredSlabs![2].from_day).toBe(15);
    expect(r.activeSlabIndex).toBe(1);
  });
});

// ── Status — Partial ──────────────────────────────────────────────────────────

describe("buildLateFeeInfo — Partial status", () => {
  test("Partial invoice: treated as overdue (not disabled)", () => {
    const r = buildLateFeeInfo(DAILY_CFG, DUE_DATE, "Partial", DAY3_AFTER, 60);
    expect(r.enabled).toBe(true);
    expect(r.daysOverdue).toBe(3);
    expect(r.currentLateFee).toBe(60);
  });
});

// ── daysOverdue arithmetic ────────────────────────────────────────────────────

describe("buildLateFeeInfo — daysOverdue computation", () => {
  test("Due date itself: daysOverdue=0", () => {
    const r = info(FLAT_CFG, ON_DUE, 0);
    expect(r.daysOverdue).toBe(0);
  });

  test("30 days overdue: correct count", () => {
    const r = info(DAILY_CFG, DAY30_AFTER, 600);
    expect(r.daysOverdue).toBe(30);
  });
});
