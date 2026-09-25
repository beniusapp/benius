// @vitest-environment jsdom
/**
 * Focused Fees timezone-correctness tests.
 *
 * Two guarantees are proven here:
 *
 * 1. Persisted INSTANT values (createdAt, generatedAt, payment/audit
 *    timestamps) are formatted with shared Asia/Kolkata formatting, so the
 *    same UTC instant renders identically regardless of the host timezone.
 *    The five 21/22/23 Aug IST boundary instants exercise the exact wall-clock
 *    rollovers around the IST midnight (23:14 UTC on 21 Aug → 22 Aug IST,
 *    18:29:59 vs 18:30:00 UTC boundaries, and a same-day +05:30 instant).
 *
 * 2. Calendar DATE values (fee periods, due dates, month labels) are computed
 *    and formatted calendar-only and NEVER shift, even when the process TZ is
 *    forced to an extreme offset. The Fees module's own period helpers are
 *    exercised directly.
 *
 * Browser timezone independence is proven by mutating process.env.TZ and
 * re-checking the pure calendar helpers produce byte-identical output. The
 * shared instant formatter is timezone-locked by construction (Intl with an
 * explicit timeZone), so its output is stable across hosts by design.
 */

import { describe, expect, it } from "vitest";
import {
  formatDateTimeIST,
  formatInstantIST,
  formatDateOnly,
} from "@shared/ist-time";
import {
  clientFeePeriodLabel,
  addInvoicePeriodOptionsForSession,
  monthEndDateOnly,
} from "@/pages/admin-modules/fees-manager";

// ── 1. Persisted instants — five 21/22/23 Aug IST boundary instants ──────────
describe("Fees persisted instants render in Asia/Kolkata", () => {
  // Each tuple: [label, persisted instant, expected IST rendering].
  const boundaryInstants: Array<[string, string, string]> = [
    // 23:14:01 UTC on 21 Aug is 04:44:01 IST on 22 Aug — crosses IST midnight.
    ["UTC Z form crossing IST midnight", "2026-08-21T23:14:01Z", "22 Aug 2026, 04:44:01 AM IST"],
    // Raw Drizzle short-offset "+00" — same instant, must expand and match.
    ["short +00 offset", "2026-08-21 23:14:01+00", "22 Aug 2026, 04:44:01 AM IST"],
    // Negative offset (server in US) — 04:14 UTC 22 Aug → 09:44:01 IST 22 Aug.
    ["short -05 offset", "2026-08-21 23:14:01-05", "22 Aug 2026, 09:44:01 AM IST"],
    // Native IST +05:30 instant — stays on 21 Aug IST.
    ["native +05:30 instant", "2026-08-21 23:14:01+05:30", "21 Aug 2026, 11:14:01 PM IST"],
    // 18:30:00 UTC on 22 Aug is exactly 00:00 IST on 23 Aug — day rollover.
    ["exact IST midnight rollover to 23 Aug", "2026-08-22T18:30:00Z", "23 Aug 2026, 12:00:00 AM IST"],
  ];

  it("formats each boundary instant identically in IST", () => {
    for (const [, instant, expected] of boundaryInstants) {
      expect(formatInstantIST(instant)).toBe(expected);
    }
  });

  it("formatDateTimeIST (minute precision) also rolls the IST day at 18:30 UTC", () => {
    expect(formatDateTimeIST("2026-08-22T18:29:59Z")).toBe("22 Aug 2026, 11:59 PM IST");
    expect(formatDateTimeIST("2026-08-22T18:30:00Z")).toBe("23 Aug 2026, 12:00 AM IST");
  });

  it("is independent of the host process timezone", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata"]) {
        process.env.TZ = tz;
        for (const [, instant, expected] of boundaryInstants) {
          expect(formatInstantIST(instant)).toBe(expected);
        }
      }
    } finally {
      process.env.TZ = original;
    }
  });
});

// ── 2. Calendar DATE values never shift ──────────────────────────────────────
describe("Fees calendar DATE values are calendar-only", () => {
  it("formatDateOnly keeps a DATE on its own calendar day", () => {
    expect(formatDateOnly("2026-08-21")).toBe("21 Aug 2026");
    expect(formatDateOnly("2026-08-22")).toBe("22 Aug 2026");
    expect(formatDateOnly("2026-08-23")).toBe("23 Aug 2026");
  });

  it("monthEndDateOnly returns the true last calendar day", () => {
    expect(monthEndDateOnly(2026, 7)).toBe("2026-08-31"); // August
    expect(monthEndDateOnly(2024, 1)).toBe("2024-02-29"); // leap February
    expect(monthEndDateOnly(2026, 1)).toBe("2026-02-28");
  });

  it("clientFeePeriodLabel labels DATE ranges without a Date round-trip", () => {
    expect(clientFeePeriodLabel("2026-08-01", "2026-08-31")).toBe("August 2026");
    expect(clientFeePeriodLabel("2026-07-01", "2026-09-30")).toBe("July–September 2026");
    expect(clientFeePeriodLabel("2026-04-01", "2027-03-31")).toBe("2026–27");
  });

  it("addInvoicePeriodOptionsForSession derives month/quarter periods calendar-only", () => {
    const monthly = addInvoicePeriodOptionsForSession("monthly", {
      startDate: "2026-08-01",
      endDate: "2026-10-31",
    });
    expect(monthly.map(o => o.value)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(monthly[0]).toMatchObject({ label: "August 2026", start: "2026-08-01", end: "2026-08-31" });
    expect(monthly[1].end).toBe("2026-09-30");

    const quarterly = addInvoicePeriodOptionsForSession("quarterly", {
      startDate: "2026-08-01",
      endDate: "2026-12-31",
    });
    // Q3 (Jul–Sep) and Q4 (Oct–Dec) — only Q4 is fully within the session.
    expect(quarterly.map(o => o.value)).toEqual(["2026-Q4"]);
    expect(quarterly[0]).toMatchObject({ start: "2026-10-01", end: "2026-12-31" });
  });

  it("produces byte-identical calendar output under any host timezone", () => {
    const original = process.env.TZ;
    const expectedMonthly = addInvoicePeriodOptionsForSession("monthly", {
      startDate: "2026-08-01",
      endDate: "2026-10-31",
    });
    const expectedLabel = clientFeePeriodLabel("2026-07-01", "2026-09-30");
    const expectedEnd = monthEndDateOnly(2026, 7);
    try {
      for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata"]) {
        process.env.TZ = tz;
        expect(addInvoicePeriodOptionsForSession("monthly", {
          startDate: "2026-08-01",
          endDate: "2026-10-31",
        })).toEqual(expectedMonthly);
        expect(clientFeePeriodLabel("2026-07-01", "2026-09-30")).toBe(expectedLabel);
        expect(monthEndDateOnly(2026, 7)).toBe(expectedEnd);
      }
    } finally {
      process.env.TZ = original;
    }
  });
});
