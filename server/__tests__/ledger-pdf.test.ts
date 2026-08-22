/**
 * ledger-pdf.test.ts
 *
 * Boundary tests for the IST timezone standardization of the fee-ledger PDF
 * renderer (server/ledger-pdf.ts).
 *
 * Covers:
 *  1. fmtDate — calendar DATE values (due/paid/filter dates) stay calendar-only.
 *  2. fmtMonthYear / fmtPeriod — fee-period month/year stays date-only and
 *     host-independent.
 */

import { describe, it, expect } from "vitest";
import { fmtDate, fmtMonthYear, fmtPeriod } from "../ledger-pdf";

const EM = "\u2014";

// ── 1. fmtDate — calendar DATE, calendar-only ───────────────────────────────────
describe("ledger PDF — fmtDate (calendar DATE → date-only)", () => {
  it("keeps a DATE value calendar-only with no timezone shift", () => {
    expect(fmtDate("2026-08-22")).toBe("22 Aug 2026");
    expect(fmtDate("2026-04-01")).toBe("01 Apr 2026");
  });

  it("ignores a trailing time component and never shifts the calendar day", () => {
    // A bare/short-offset form sliced to its DATE portion stays on the same day.
    expect(fmtDate("2026-08-22 23:14:01+00")).toBe("22 Aug 2026");
    expect(fmtDate("2026-08-22T00:00:00Z")).toBe("22 Aug 2026");
  });

  it("returns em dash for null/empty", () => {
    expect(fmtDate(null)).toBe(EM);
    expect(fmtDate(undefined)).toBe(EM);
    expect(fmtDate("")).toBe(EM);
  });
});

// ── 2. fmtMonthYear / fmtPeriod — fee period date-only, host-independent ────────
describe("ledger PDF — fmtMonthYear (fee-period boundary → date-only)", () => {
  it("renders short month + year", () => {
    expect(fmtMonthYear("2026-08-01")).toBe("Aug 2026");
    expect(fmtMonthYear("2026-04-30")).toBe("Apr 2026");
  });

  it("does not shift month across a UTC/IST boundary date (host-independent)", () => {
    // 2026-08-31 evening UTC would roll into September only if wrongly parsed as
    // an instant. Date-only keeps it in August.
    expect(fmtMonthYear("2026-08-31")).toBe("Aug 2026");
  });

  it("returns empty string for null/invalid", () => {
    expect(fmtMonthYear(null)).toBe("");
    expect(fmtMonthYear("not-a-date")).toBe("");
  });
});

describe("ledger PDF — fmtPeriod (fee-period range → date-only)", () => {
  it("collapses a single-month period to one label", () => {
    expect(fmtPeriod("2026-08-01", "2026-08-31")).toBe("Aug 2026");
  });

  it("renders a multi-month range with an en dash", () => {
    expect(fmtPeriod("2026-07-01", "2026-09-30")).toBe("Jul 2026 \u2013 Sep 2026");
  });

  it("falls back to the single available boundary", () => {
    expect(fmtPeriod("2026-08-01", null)).toBe("Aug 2026");
    expect(fmtPeriod(null, "2026-08-01")).toBe("Aug 2026");
  });

  it("returns em dash when both boundaries are absent", () => {
    expect(fmtPeriod(null, null)).toBe(EM);
  });
});
