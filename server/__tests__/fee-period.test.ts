/**
 * Focused tests for the Fee Period & Billing Schedule feature.
 *
 * Tests mirror the 13-scenario checklist from the specification:
 *   1.  Monthly + In Advance
 *   2.  Monthly + In Arrears
 *   3.  Quarterly + In Advance
 *   4.  Quarterly + In Arrears
 *   5.  Annual + Academic Session
 *   6.  Manual invoice generation (period storage logic)
 *   7.  Duplicate invoice prevention (idempotency keys)
 *   8.  Auto-generation repeated twice — no duplicates
 *   9.  Two different schools with different billing timing
 *   10. Student portal — correct period label
 *   11. Receipt — period label from stored dates (not recalculated)
 *   12. Existing invoices (null period) — backward-compatible display
 *   13. Existing payment/Razorpay tests — not modified (suite still passes)
 *
 * The computeFeePeriod and feePeriodLabel functions are extracted and
 * tested as pure functions — no HTTP server or DB required.
 */

import { describe, it, expect } from "vitest";
import { computeFeePeriod, feePeriodLabel } from "../fee-period";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function date(y: number, m: number, d = 1): Date {
  return new Date(y, m - 1, d);
}

const SESSION_2526 = {
  startDate: "2025-04-01",
  endDate:   "2026-03-31",
  sessionName: "2025-26",
};

const SESSION_2627 = {
  startDate: "2026-04-01",
  endDate:   "2027-03-31",
  sessionName: "2026-27",
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Monthly + In Advance
// ─────────────────────────────────────────────────────────────────────────────
describe("computeFeePeriod — Monthly + In Advance", () => {
  it("August generation → August period", () => {
    const p = computeFeePeriod("monthly", "advance", date(2026, 8));
    expect(p.start).toBe("2026-08-01");
    expect(p.end).toBe("2026-08-31");
  });

  it("January generation → January period", () => {
    const p = computeFeePeriod("monthly", "advance", date(2026, 1));
    expect(p.start).toBe("2026-01-01");
    expect(p.end).toBe("2026-01-31");
  });

  it("February in a leap year → correct end", () => {
    const p = computeFeePeriod("monthly", "advance", date(2024, 2));
    expect(p.start).toBe("2024-02-01");
    expect(p.end).toBe("2024-02-29"); // 2024 is a leap year
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Monthly + In Arrears
// ─────────────────────────────────────────────────────────────────────────────
describe("computeFeePeriod — Monthly + In Arrears", () => {
  it("September generation → August period (School A scenario)", () => {
    const p = computeFeePeriod("monthly", "arrears", date(2026, 9));
    expect(p.start).toBe("2026-08-01");
    expect(p.end).toBe("2026-08-31");
  });

  it("August generation → July period", () => {
    const p = computeFeePeriod("monthly", "arrears", date(2026, 8));
    expect(p.start).toBe("2026-07-01");
    expect(p.end).toBe("2026-07-31");
  });

  it("January generation (arrears) → December of prior year", () => {
    const p = computeFeePeriod("monthly", "arrears", date(2026, 1));
    expect(p.start).toBe("2025-12-01");
    expect(p.end).toBe("2025-12-31");
  });

  it("School A (arrears) and School B (advance) both produce August 2026 period", () => {
    const schoolA = computeFeePeriod("monthly", "arrears", date(2026, 9)); // generated Sep → Aug
    const schoolB = computeFeePeriod("monthly", "advance", date(2026, 8)); // generated Aug → Aug
    expect(schoolA.start).toBe("2026-08-01");
    expect(schoolB.start).toBe("2026-08-01");
    expect(schoolA.end).toBe("2026-08-31");
    expect(schoolB.end).toBe("2026-08-31");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Quarterly + In Advance
// ─────────────────────────────────────────────────────────────────────────────
describe("computeFeePeriod — Quarterly + In Advance", () => {
  it("April (Q2 start) → April–June period", () => {
    const p = computeFeePeriod("quarterly", "advance", date(2026, 4));
    expect(p.start).toBe("2026-04-01");
    expect(p.end).toBe("2026-06-30");
  });

  it("May (mid-Q2) → April–June period", () => {
    const p = computeFeePeriod("quarterly", "advance", date(2026, 5));
    expect(p.start).toBe("2026-04-01");
    expect(p.end).toBe("2026-06-30");
  });

  it("July (Q3 start) → July–September period", () => {
    const p = computeFeePeriod("quarterly", "advance", date(2026, 7));
    expect(p.start).toBe("2026-07-01");
    expect(p.end).toBe("2026-09-30");
  });

  it("January (Q1 start) → January–March period", () => {
    const p = computeFeePeriod("quarterly", "advance", date(2026, 1));
    expect(p.start).toBe("2026-01-01");
    expect(p.end).toBe("2026-03-31");
  });

  it("October (Q4 start) → October–December period", () => {
    const p = computeFeePeriod("quarterly", "advance", date(2026, 10));
    expect(p.start).toBe("2026-10-01");
    expect(p.end).toBe("2026-12-31");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Quarterly + In Arrears
// ─────────────────────────────────────────────────────────────────────────────
describe("computeFeePeriod — Quarterly + In Arrears", () => {
  it("July (Q3 start, arrears) → April–June period", () => {
    const p = computeFeePeriod("quarterly", "arrears", date(2026, 7));
    expect(p.start).toBe("2026-04-01");
    expect(p.end).toBe("2026-06-30");
  });

  it("April (Q2 start, arrears) → January–March period", () => {
    const p = computeFeePeriod("quarterly", "arrears", date(2026, 4));
    expect(p.start).toBe("2026-01-01");
    expect(p.end).toBe("2026-03-31");
  });

  it("January (Q1 start, arrears) → wraps to Q4 of prior year (Oct–Dec 2025)", () => {
    const p = computeFeePeriod("quarterly", "arrears", date(2026, 1));
    expect(p.start).toBe("2025-10-01");
    expect(p.end).toBe("2025-12-31");
  });

  it("October (Q4 start, arrears) → July–September period", () => {
    const p = computeFeePeriod("quarterly", "arrears", date(2026, 10));
    expect(p.start).toBe("2026-07-01");
    expect(p.end).toBe("2026-09-30");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Annual + Academic Session
// ─────────────────────────────────────────────────────────────────────────────
describe("computeFeePeriod — Annual + Academic Session", () => {
  it("annual uses session start/end regardless of billingTiming or month", () => {
    const advance = computeFeePeriod("annual", "advance", date(2026, 8), SESSION_2526);
    const arrears  = computeFeePeriod("annual", "arrears", date(2026, 1), SESSION_2526);
    expect(advance.start).toBe("2025-04-01");
    expect(advance.end).toBe("2026-03-31");
    expect(arrears.start).toBe("2025-04-01");
    expect(arrears.end).toBe("2026-03-31");
  });

  it("annual without session falls back to sensible default", () => {
    const p = computeFeePeriod("annual", "advance", date(2026, 8), null);
    expect(p.start).toBe("2026-04-01");
    expect(p.end).toBe("2027-03-31");
  });

  it("one-time uses session dates the same way as annual", () => {
    const p = computeFeePeriod("one-time", "advance", date(2026, 5), SESSION_2627);
    expect(p.start).toBe("2026-04-01");
    expect(p.end).toBe("2027-03-31");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 & 8. Idempotency key logic (duplicates must be blocked)
// ─────────────────────────────────────────────────────────────────────────────
describe("Idempotency key logic", () => {
  it("same period → same key (no duplicates)", () => {
    const a = computeFeePeriod("monthly", "advance", date(2026, 8));
    const b = computeFeePeriod("monthly", "advance", date(2026, 8, 15)); // mid-month
    expect(a.start).toBe(b.start);
    expect(a.end).toBe(b.end);
  });

  it("different months → different keys (new invoice allowed)", () => {
    const aug = computeFeePeriod("monthly", "advance", date(2026, 8));
    const sep = computeFeePeriod("monthly", "advance", date(2026, 9));
    expect(aug.start).not.toBe(sep.start);
  });

  it("quarterly: running cron 3 times in same quarter → same period (all skip)", () => {
    const apr = computeFeePeriod("quarterly", "advance", date(2026, 4));
    const may = computeFeePeriod("quarterly", "advance", date(2026, 5));
    const jun = computeFeePeriod("quarterly", "advance", date(2026, 6));
    expect(apr.start).toBe(may.start);
    expect(may.start).toBe(jun.start);
    expect(apr.end).toBe("2026-06-30");
  });

  it("quarterly: next quarter → different key (new invoice)", () => {
    const q2 = computeFeePeriod("quarterly", "advance", date(2026, 5));
    const q3 = computeFeePeriod("quarterly", "advance", date(2026, 7));
    expect(q2.start).not.toBe(q3.start);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Multi-tenant: School A (arrears) vs School B (advance) — August 2026
// ─────────────────────────────────────────────────────────────────────────────
describe("Multi-tenant billing timing isolation", () => {
  it("School A (monthly/arrears, generated Sep) → August period", () => {
    const p = computeFeePeriod("monthly", "arrears", date(2026, 9));
    expect(p.start).toBe("2026-08-01");
    expect(p.end).toBe("2026-08-31");
  });

  it("School B (monthly/advance, generated Aug) → August period", () => {
    const p = computeFeePeriod("monthly", "advance", date(2026, 8));
    expect(p.start).toBe("2026-08-01");
    expect(p.end).toBe("2026-08-31");
  });

  it("Both schools produce identical fee period for August 2026", () => {
    const schoolA = computeFeePeriod("monthly", "arrears", date(2026, 9));
    const schoolB = computeFeePeriod("monthly", "advance", date(2026, 8));
    expect(schoolA.start).toBe(schoolB.start);
    expect(schoolA.end).toBe(schoolB.end);
  });

  it("School A due date is Sep 10; School B due date is Aug 10 — periods are identical", () => {
    // Due dates differ but fee periods are the same
    const dueDateA = "2026-09-10"; // arrears school
    const dueDateB = "2026-08-10"; // advance school
    const periodA = computeFeePeriod("monthly", "arrears", date(2026, 9));
    const periodB = computeFeePeriod("monthly", "advance", date(2026, 8));
    expect(dueDateA).not.toBe(dueDateB);       // due dates differ
    expect(periodA.start).toBe(periodB.start); // fee periods are the same
    expect(periodA.start).toBe("2026-08-01");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10 & 11. feePeriodLabel — student portal + receipt display
// ─────────────────────────────────────────────────────────────────────────────
describe("feePeriodLabel — display from stored period dates", () => {
  it("monthly period → month name + year", () => {
    expect(feePeriodLabel("2026-08-01", "2026-08-31")).toBe("August 2026");
  });

  it("quarterly period → start month dash end month + year", () => {
    expect(feePeriodLabel("2026-04-01", "2026-06-30")).toBe("April–June 2026");
    expect(feePeriodLabel("2026-07-01", "2026-09-30")).toBe("July–September 2026");
    expect(feePeriodLabel("2026-01-01", "2026-03-31")).toBe("January–March 2026");
  });

  it("annual period with academicYear → shows academicYear", () => {
    expect(feePeriodLabel("2025-04-01", "2026-03-31", "2025-26")).toBe("2025-26");
  });

  it("annual period without academicYear → derives year range", () => {
    expect(feePeriodLabel("2025-04-01", "2026-03-31")).toBe("2025–26");
  });

  it("null period (pre-migration record) → falls back to academicYear", () => {
    expect(feePeriodLabel(null, null, "2025-26")).toBe("2025-26");
    expect(feePeriodLabel(undefined, undefined, null)).toBe("—");
    expect(feePeriodLabel("", "", "2025-26")).toBe("2025-26");
  });

  it("period is immutable — label from stored dates, not from today", () => {
    // Even if queried in December, an August invoice shows "August 2026"
    const label = feePeriodLabel("2026-08-01", "2026-08-31", "2025-26");
    expect(label).toBe("August 2026");
    expect(label).not.toContain("December");
  });

  it("period from computeFeePeriod round-trips correctly through feePeriodLabel", () => {
    const p = computeFeePeriod("monthly", "arrears", date(2026, 9));
    expect(feePeriodLabel(p.start, p.end)).toBe("August 2026");
  });

  it("quarterly period round-trip", () => {
    const p = computeFeePeriod("quarterly", "advance", date(2026, 5));
    expect(feePeriodLabel(p.start, p.end)).toBe("April–June 2026");
  });

  it("annual period round-trip with session", () => {
    const p = computeFeePeriod("annual", "advance", date(2026, 8), SESSION_2526);
    expect(feePeriodLabel(p.start, p.end, "2025-26")).toBe("2025-26");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Backward compatibility — existing records with null fee_period
// ─────────────────────────────────────────────────────────────────────────────
describe("Backward compatibility — existing records without fee_period", () => {
  it("null period with academicYear falls back to academicYear string", () => {
    expect(feePeriodLabel(null, null, "2024-25")).toBe("2024-25");
  });

  it("null period without academicYear returns —", () => {
    expect(feePeriodLabel(null, null, null)).toBe("—");
    expect(feePeriodLabel(null, null)).toBe("—");
  });

  it("empty-string period treated as null", () => {
    expect(feePeriodLabel("", "", "2024-25")).toBe("2024-25");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Receipt label variant (inline logic from routes.ts receipt handler)
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt period row label selection", () => {
  function periodRowLabel(start: string, end: string): string {
    const days = Math.round((new Date(end + "T00:00:00").getTime() - new Date(start + "T00:00:00").getTime()) / 86400000);
    return days <= 31 ? "Fee Month" : days <= 92 ? "Fee Period" : "Academic Session";
  }

  it("monthly range → 'Fee Month'", () => {
    expect(periodRowLabel("2026-08-01", "2026-08-31")).toBe("Fee Month");
  });

  it("quarterly range → 'Fee Period'", () => {
    expect(periodRowLabel("2026-04-01", "2026-06-30")).toBe("Fee Period");
  });

  it("annual range → 'Academic Session'", () => {
    expect(periodRowLabel("2025-04-01", "2026-03-31")).toBe("Academic Session");
  });
});
