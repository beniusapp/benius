/**
 * Unit tests: calculateLateFee() pure function
 *
 * No database access — all tests are deterministic given a fixed
 * LateFeeConfig and a reference date offset from the due date.
 *
 * Scenarios:
 *  FLAT    – fires on day 1, stays constant, ignores grace_period_days
 *  DAILY   – accumulates each day after grace period, respects max_cap
 *  TIERED  – matches correct slab, uses last slab when beyond range
 *  GUARDS  – Paid status → always 0; disabled config → always 0
 */

import { describe, it, expect } from "vitest";
import {
  calculateLateFee,
  DEFAULT_LATE_FEE_CONFIG,
  type LateFeeConfig,
} from "../late-fee-engine";

// ── Helper ────────────────────────────────────────────────────────────────────

/** Return a Date that is `days` days after the given due-date string (UTC). */
function daysAfterDue(dueDate: string, days: number): Date {
  const [y, m, d] = dueDate.split("-").map(Number);
  const base = Date.UTC(y!, m! - 1, d!);
  return new Date(base + days * 24 * 60 * 60 * 1000);
}

const DUE = "2026-01-15"; // arbitrary reference due date

// ── FLAT ──────────────────────────────────────────────────────────────────────

describe("calculateLateFee — FLAT", () => {
  const cfg: LateFeeConfig = {
    enabled: true, type: "FLAT",
    grace_period_days: 5, // must be ignored for FLAT
    flat_amount: 150,
    daily_rate: 0, max_cap: 0, tiered_slabs: [],
  };

  it("returns 0 on the due date itself (day 0)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 0))).toBe(0);
  });

  it("fires flat_amount on day 1", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 1))).toBe(150);
  });

  it("stays constant at flat_amount on day 5 (does not accumulate)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 5))).toBe(150);
  });

  it("grace_period_days is ignored for FLAT — still fires on day 1", () => {
    // grace_period_days = 5 but FLAT overrides it to 0 by design
    expect(calculateLateFee(cfg, DUE, "Overdue", daysAfterDue(DUE, 2))).toBe(150);
  });
});

// ── DAILY ─────────────────────────────────────────────────────────────────────

describe("calculateLateFee — DAILY (no grace, no cap)", () => {
  const cfg: LateFeeConfig = {
    enabled: true, type: "DAILY",
    grace_period_days: 0, flat_amount: 0,
    daily_rate: 10, max_cap: 0, tiered_slabs: [],
  };

  it("returns 0 on due date (day 0)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 0))).toBe(0);
  });

  it("₹10 on day 1", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 1))).toBe(10);
  });

  it("₹50 on day 5 (5 × ₹10)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 5))).toBe(50);
  });

  it("₹300 on day 30 (30 × ₹10)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 30))).toBe(300);
  });
});

describe("calculateLateFee — DAILY with grace period", () => {
  const cfg: LateFeeConfig = {
    enabled: true, type: "DAILY",
    grace_period_days: 3, flat_amount: 0,
    daily_rate: 10, max_cap: 0, tiered_slabs: [],
  };

  it("₹0 within grace (day 1)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 1))).toBe(0);
  });

  it("₹0 on last grace day (day 3)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 3))).toBe(0);
  });

  it("₹10 on first day after grace (day 4, effectiveDays = 1)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 4))).toBe(10);
  });

  it("₹30 on day 6 (effectiveDays = 3)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 6))).toBe(30);
  });
});

describe("calculateLateFee — DAILY with max_cap", () => {
  const cfg: LateFeeConfig = {
    enabled: true, type: "DAILY",
    grace_period_days: 0, flat_amount: 0,
    daily_rate: 20, max_cap: 50, tiered_slabs: [],
  };

  it("uncapped on day 2: 2 × ₹20 = ₹40 (below cap)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 2))).toBe(40);
  });

  it("capped at ₹50 on day 5 (5 × ₹20 = ₹100, capped to ₹50)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 5))).toBe(50);
  });

  it("still capped at ₹50 on day 100", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 100))).toBe(50);
  });
});

// ── TIERED ────────────────────────────────────────────────────────────────────

describe("calculateLateFee — TIERED", () => {
  const cfg: LateFeeConfig = {
    enabled: true, type: "TIERED",
    grace_period_days: 0, flat_amount: 0,
    daily_rate: 0, max_cap: 0,
    tiered_slabs: [
      { from_day: 1,  to_day: 7,  amount: 100 },
      { from_day: 8,  to_day: 30, amount: 200 },
      { from_day: 31, to_day: 90, amount: 500 },
    ],
  };

  it("₹0 on due date (day 0, before first slab from_day=1)", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 0))).toBe(0);
  });

  it("slab 1 on day 1: ₹100", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 1))).toBe(100);
  });

  it("slab 1 on day 7 (boundary): ₹100", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 7))).toBe(100);
  });

  it("slab 2 on day 8 (boundary): ₹200", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 8))).toBe(200);
  });

  it("slab 3 on day 31: ₹500", () => {
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 31))).toBe(500);
  });

  it("beyond last slab (day 200): uses last slab amount (₹500)", () => {
    // Engine spec: when beyond all defined slabs, use the last slab
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 200))).toBe(500);
  });
});

// ── STATUS GUARDS ─────────────────────────────────────────────────────────────

describe("calculateLateFee — status guards", () => {
  const activeCfg: LateFeeConfig = {
    enabled: true, type: "FLAT",
    grace_period_days: 0, flat_amount: 500,
    daily_rate: 0, max_cap: 0, tiered_slabs: [],
  };

  it("returns 0 for Paid status regardless of config and overdue days", () => {
    expect(calculateLateFee(activeCfg, DUE, "Paid", daysAfterDue(DUE, 10))).toBe(0);
  });

  it("non-zero for Overdue status", () => {
    expect(calculateLateFee(activeCfg, DUE, "Overdue", daysAfterDue(DUE, 5))).toBe(500);
  });
});

// ── DISABLED / NONE ───────────────────────────────────────────────────────────

describe("calculateLateFee — disabled or NONE", () => {
  it("returns 0 when enabled=false", () => {
    const cfg: LateFeeConfig = { ...DEFAULT_LATE_FEE_CONFIG, enabled: false };
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 10))).toBe(0);
  });

  it("returns 0 for DEFAULT_LATE_FEE_CONFIG (type NONE, enabled false)", () => {
    expect(calculateLateFee(DEFAULT_LATE_FEE_CONFIG, DUE, "Due", daysAfterDue(DUE, 30))).toBe(0);
  });

  it("returns 0 for type NONE even with flat_amount set", () => {
    const cfg: LateFeeConfig = {
      ...DEFAULT_LATE_FEE_CONFIG,
      enabled: true, type: "NONE", flat_amount: 999,
    };
    expect(calculateLateFee(cfg, DUE, "Due", daysAfterDue(DUE, 10))).toBe(0);
  });
});

describe("calculateLateFee — IST business-date boundaries", () => {
  const cfg: LateFeeConfig = {
    enabled: true,
    type: "DAILY",
    grace_period_days: 0,
    flat_amount: 0,
    daily_rate: 10,
    max_cap: 0,
    tiered_slabs: [],
  };

  it.each([
    ["2026-08-21T18:29:59Z", 0],
    ["2026-08-21T18:30:00Z", 10],
    ["2026-08-21T18:30:01Z", 10],
    ["2026-08-22T18:29:59Z", 10],
    ["2026-08-22T18:30:00Z", 20],
  ])("uses the IST calendar day for %s", (instant, expectedFee) => {
    expect(calculateLateFee(cfg, "2026-08-21", "Due", new Date(instant)))
      .toBe(expectedFee);
  });
});
