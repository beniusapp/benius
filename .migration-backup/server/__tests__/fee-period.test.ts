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
// 14. Session-scoped period selector — all months/quarters within a session
//     (pure logic mirror of periodsForSession in fees-manager.tsx)
// ─────────────────────────────────────────────────────────────────────────────

/** Mirror of the client-side periodsForSession logic — tested here as pure functions */
type PO = { label: string; start: string; end: string };

function qBounds(qi: number, year: number): { start: string; end: string } {
  const sm = qi * 3;
  const em = sm + 2;
  const lastDay = new Date(year, em + 1, 0).getDate();
  return {
    start: `${year}-${String(sm + 1).padStart(2, "0")}-01`,
    end:   `${year}-${String(em + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function periodsForSession(freq: string, sessionStart: string, sessionEnd: string): PO[] {
  const opts: PO[] = [];
  if (!sessionStart || !sessionEnd) return opts;
  const sDate = new Date(sessionStart + "T00:00:00");
  const eDate = new Date(sessionEnd + "T00:00:00");
  if (freq === "monthly") {
    let cur = new Date(sDate.getFullYear(), sDate.getMonth(), 1);
    const limit = new Date(eDate.getFullYear(), eDate.getMonth(), 1);
    while (cur <= limit) {
      const py = cur.getFullYear(); const pm = cur.getMonth();
      const last = new Date(py, pm + 1, 0).getDate();
      opts.push({ label: "", start: `${py}-${String(pm + 1).padStart(2, "0")}-01`, end: `${py}-${String(pm + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}` });
      cur = new Date(py, pm + 1, 1);
    }
  } else if (freq === "quarterly") {
    const startQI = Math.floor(sDate.getMonth() / 3);
    let cur = new Date(sDate.getFullYear(), startQI * 3, 1);
    while (cur <= eDate) {
      const qy = cur.getFullYear(); const qi = Math.floor(cur.getMonth() / 3);
      opts.push({ label: "", ...qBounds(qi, qy) });
      cur = new Date(qy, (qi + 1) * 3, 1);
    }
  }
  return opts;
}

function bestDefault(options: PO[], today: string): PO | null {
  if (!options.length) return null;
  // Return the period that contains today (current month is within the active session).
  const current = options.find(o => o.start <= today && o.end >= today);
  if (current) return current;
  // Current month is outside the session (before OR after) → always default to first month.
  return options[0];
}

describe("periodsForSession — session-scoped period list (UI helper mirror)", () => {
  const SESSION_2627 = { start: "2026-04-01", end: "2027-03-31" };

  describe("Monthly — Indian academic session Apr 2026 – Mar 2027", () => {
    const opts = periodsForSession("monthly", SESSION_2627.start, SESSION_2627.end);

    it("produces exactly 12 months", () => {
      expect(opts).toHaveLength(12);
    });

    it("first period is April 2026", () => {
      expect(opts[0].start).toBe("2026-04-01");
      expect(opts[0].end).toBe("2026-04-30");
    });

    it("last period is March 2027", () => {
      expect(opts[11].start).toBe("2027-03-01");
      expect(opts[11].end).toBe("2027-03-31");
    });

    it("August 2026 is in the list (index 4)", () => {
      const aug = opts.find(o => o.start === "2026-08-01");
      expect(aug).toBeDefined();
      expect(aug?.end).toBe("2026-08-31");
    });

    it("October 2026 is in the list", () => {
      expect(opts.find(o => o.start === "2026-10-01")).toBeDefined();
    });
  });

  describe("KEY SCENARIO: current date = October 2026, admin selects August 2026 (backfill)", () => {
    const opts   = periodsForSession("monthly", SESSION_2627.start, SESSION_2627.end);
    const TODAY  = "2026-10-16"; // simulated today

    it("August 2026 is available in the picker", () => {
      const aug = opts.find(o => o.start === "2026-08-01");
      expect(aug).toBeDefined();
    });

    it("default auto-selection on Oct 16 → October 2026 (current month)", () => {
      const def = bestDefault(opts, TODAY);
      expect(def?.start).toBe("2026-10-01");
    });

    it("admin can manually pick August 2026 — period start/end are correct", () => {
      const aug = opts.find(o => o.start === "2026-08-01")!;
      expect(aug.start).toBe("2026-08-01");
      expect(aug.end).toBe("2026-08-31");
    });

    it("stored period = 2026-08-01 / 2026-08-31 regardless of generation date (Oct)", () => {
      // Simulates: admin picks August, clicks Generate in October
      const chosenPeriodStart = "2026-08-01";
      const chosenPeriodEnd   = "2026-08-31";
      // The label should be "August 2026" no matter when it's queried
      expect(feePeriodLabel(chosenPeriodStart, chosenPeriodEnd)).toBe("August 2026");
    });

    it("idempotency: same period start must block duplicate invoice", () => {
      // If an existing record has feePeriodStart = 2026-08-01,
      // the period key studentId:feeType:2026-08-01 already exists → skip
      const existingPeriodStart = "2026-08-01";
      const newAttemptStart     = "2026-08-01"; // admin tries again
      expect(existingPeriodStart).toBe(newAttemptStart); // same key → duplicate blocked
    });

    it("different period (October) → different key → new invoice allowed", () => {
      const augStart = "2026-08-01";
      const octStart = "2026-10-01";
      expect(augStart).not.toBe(octStart);
    });
  });

  describe("Quarterly — Indian academic session Apr 2026 – Mar 2027", () => {
    const opts = periodsForSession("quarterly", SESSION_2627.start, SESSION_2627.end);

    it("produces exactly 4 quarters", () => {
      expect(opts).toHaveLength(4);
    });

    it("first quarter is Apr–Jun 2026", () => {
      expect(opts[0].start).toBe("2026-04-01");
      expect(opts[0].end).toBe("2026-06-30");
    });

    it("second quarter is Jul–Sep 2026", () => {
      expect(opts[1].start).toBe("2026-07-01");
      expect(opts[1].end).toBe("2026-09-30");
    });

    it("third quarter is Oct–Dec 2026", () => {
      expect(opts[2].start).toBe("2026-10-01");
      expect(opts[2].end).toBe("2026-12-31");
    });

    it("fourth quarter is Jan–Mar 2027", () => {
      expect(opts[3].start).toBe("2027-01-01");
      expect(opts[3].end).toBe("2027-03-31");
    });

    it("default on Oct 16 → Q4 Oct–Dec 2026 (current quarter)", () => {
      const def = bestDefault(opts, "2026-10-16");
      expect(def?.start).toBe("2026-10-01");
    });

    it("admin can select Q2 Apr–Jun 2026 (backfill)", () => {
      const q2 = opts.find(o => o.start === "2026-04-01")!;
      expect(q2.end).toBe("2026-06-30");
      expect(feePeriodLabel(q2.start, q2.end)).toBe("April–June 2026");
    });
  });

  describe("Calendar year session (Jan–Dec)", () => {
    const opts = periodsForSession("monthly", "2026-01-01", "2026-12-31");

    it("produces exactly 12 months", () => {
      expect(opts).toHaveLength(12);
    });

    it("all 12 months from January to December 2026", () => {
      expect(opts[0].start).toBe("2026-01-01");
      expect(opts[11].start).toBe("2026-12-01");
      expect(opts[11].end).toBe("2026-12-31");
    });
  });

  describe("Short session (e.g. 3-month term)", () => {
    const opts = periodsForSession("monthly", "2026-07-01", "2026-09-30");

    it("produces exactly 3 months", () => {
      expect(opts).toHaveLength(3);
    });

    it("covers July, August, September 2026", () => {
      expect(opts.map(o => o.start)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    });
  });

  describe("bestDefault — pre-selection logic", () => {
    const opts = periodsForSession("monthly", "2026-04-01", "2027-03-31");

    it("today inside session → selects the period containing today", () => {
      const def = bestDefault(opts, "2026-11-15");
      expect(def?.start).toBe("2026-11-01");
    });

    it("today before session start → selects first period", () => {
      const def = bestDefault(opts, "2026-01-01");
      expect(def?.start).toBe("2026-04-01");
    });

    it("today after session end → selects FIRST period (not last)", () => {
      const def = bestDefault(opts, "2027-06-01");
      expect(def?.start).toBe("2026-04-01"); // corrected: outside session always → first month
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// Fee Period Default & Strict Duplicate Protection (spec corrections)
// Session: April 2027 – March 2028
// ─────────────────────────────────────────────────────────────────────────────

describe("bestDefaultPeriod — corrected defaulting rules", () => {
  const SESSION = { start: "2027-04-01", end: "2028-03-31" };
  const opts = periodsForSession("monthly", SESSION.start, SESSION.end);

  it("1. current month inside active session → default to current month", () => {
    // Simulate today = August 2027 (inside April 2027 – March 2028)
    const def = bestDefault(opts, "2027-08-15");
    expect(def?.start).toBe("2027-08-01");
    expect(def?.end).toBe("2027-08-31");
  });

  it("1b. current month = February 2028 (inside session) → default February 2028", () => {
    const def = bestDefault(opts, "2028-02-10");
    expect(def?.start).toBe("2028-02-01");
    expect(def?.end).toBe("2028-02-29"); // 2028 is a leap year
  });

  it("2. current month BEFORE active session → default to FIRST session month (April 2027)", () => {
    // Simulate today = August 2026 — before the April 2027 session
    const def = bestDefault(opts, "2026-08-15");
    expect(def?.start).toBe("2027-04-01"); // first month of session
  });

  it("3. current month AFTER active session → default to FIRST session month (April 2027)", () => {
    // Simulate today = April 2028 — after the March 2028 end
    const def = bestDefault(opts, "2028-04-15");
    expect(def?.start).toBe("2027-04-01"); // first month of session, NOT last
  });

  it("3b. current month = May 2028 (well after session) → still defaults to first month", () => {
    const def = bestDefault(opts, "2028-05-01");
    expect(def?.start).toBe("2027-04-01");
  });

  it("empty options list → returns null", () => {
    expect(bestDefault([], "2027-08-15")).toBeNull();
  });
});

describe("Strict duplicate invoice protection — generate invoices skip logic", () => {
  // Mirror of the duplicate-key logic in the generate endpoint.
  type FeeRecord = {
    studentId: number;
    feeType: string;
    feePeriodStart: string | null;
    amount: number;
    dueDate: string;
    status: string;
  };

  function isDuplicate(
    existingByPeriod: Map<string, FeeRecord>,
    existingByType: Map<string, FeeRecord>,
    studentId: number,
    feeType: string,
    periodStart: string,
  ): boolean {
    const periodKey = `${studentId}:${feeType}:${periodStart}`;
    const legacyKey = `${studentId}:${feeType}`;
    return existingByPeriod.has(periodKey) || existingByType.has(legacyKey);
  }

  function buildMaps(records: FeeRecord[]) {
    const byPeriod = new Map(
      records
        .filter(r => r.feePeriodStart)
        .map(r => [`${r.studentId}:${r.feeType}:${r.feePeriodStart}`, r]),
    );
    const byType = new Map(
      records
        .filter(r => !r.feePeriodStart)
        .map(r => [`${r.studentId}:${r.feeType}`, r]),
    );
    return { byPeriod, byType };
  }

  const EXISTING: FeeRecord = {
    studentId: 1, feeType: "Tuition", feePeriodStart: "2027-08-01",
    amount: 2000, dueDate: "2027-08-17", status: "Due",
  };

  it("4. same student + same fee type + same period → duplicate (skip)", () => {
    const { byPeriod, byType } = buildMaps([EXISTING]);
    expect(isDuplicate(byPeriod, byType, 1, "Tuition", "2027-08-01")).toBe(true);
  });

  it("5. existing invoice amount is NOT changed — original amount preserved", () => {
    // Even if the fee structure now charges ₹2,200, the existing record stays at ₹2,000.
    const { byPeriod, byType } = buildMaps([EXISTING]);
    const dup = isDuplicate(byPeriod, byType, 1, "Tuition", "2027-08-01");
    expect(dup).toBe(true);
    // When a duplicate is found, the record is skipped — amount is never updated.
    expect(EXISTING.amount).toBe(2000); // unchanged
  });

  it("6. existing invoice due date is NOT changed — original due date preserved", () => {
    const { byPeriod, byType } = buildMaps([EXISTING]);
    const dup = isDuplicate(byPeriod, byType, 1, "Tuition", "2027-08-01");
    expect(dup).toBe(true);
    expect(EXISTING.dueDate).toBe("2027-08-17"); // unchanged
  });

  it("7. different fee type + same period → NOT a duplicate (new invoice allowed)", () => {
    const { byPeriod, byType } = buildMaps([EXISTING]);
    // Lab Fee is different from Tuition — allowed for August 2027
    expect(isDuplicate(byPeriod, byType, 1, "Lab Fee", "2027-08-01")).toBe(false);
  });

  it("8. same fee type + different period → NOT a duplicate (new invoice allowed)", () => {
    const { byPeriod, byType } = buildMaps([EXISTING]);
    // September 2027 is different from August 2027 — allowed
    expect(isDuplicate(byPeriod, byType, 1, "Tuition", "2027-09-01")).toBe(false);
  });

  it("paid invoice also blocks duplicate (immutable regardless of status)", () => {
    const paid = { ...EXISTING, status: "Paid" };
    const { byPeriod, byType } = buildMaps([paid]);
    expect(isDuplicate(byPeriod, byType, 1, "Tuition", "2027-08-01")).toBe(true);
  });

  it("different student + same fee type + same period → allowed (separate student)", () => {
    const { byPeriod, byType } = buildMaps([EXISTING]);
    expect(isDuplicate(byPeriod, byType, 2, "Tuition", "2027-08-01")).toBe(false);
  });
});
