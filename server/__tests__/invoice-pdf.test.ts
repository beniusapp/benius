/**
 * invoice-pdf.test.ts
 *
 * Boundary tests for the IST timezone standardization of the invoice PDF
 * renderer (server/invoice-pdf.ts).
 *
 * Covers:
 *  1. formatInvoiceInstant — persisted instants display in Asia/Kolkata with an
 *     IST suffix (five boundary forms around 22-Aug-2026 IST).
 *  2. formatDate — calendar DATE values stay calendar-only, no timezone shift.
 *  3. feePeriodLabel — fee-period month/year stays date-only, host-independent.
 */

import { describe, it, expect } from "vitest";
import {
  formatInvoiceInstant,
  formatDate,
  feePeriodLabel,
} from "../invoice-pdf";
import type { InvoiceDocumentData } from "../invoice-document";

// ── 1. formatInvoiceInstant — persisted instant in IST ──────────────────────────
describe("invoice PDF — formatInvoiceInstant (persisted instant → IST)", () => {
  it("renders the five persisted-instant boundary forms in IST with suffix", () => {
    // PostgreSQL bare timestamp-without-time-zone (UTC by deployment convention)
    expect(formatInvoiceInstant("2026-08-21 23:14:01")).toBe("22 Aug 2026, 04:44:01 AM IST");
    // Short offset "+00"
    expect(formatInvoiceInstant("2026-08-21 23:14:01+00")).toBe("22 Aug 2026, 04:44:01 AM IST");
    // Short offset "-05"
    expect(formatInvoiceInstant("2026-08-21 23:14:01-05")).toBe("22 Aug 2026, 09:44:01 AM IST");
    // Full offset "+05:30" (already IST) — stays on 21 Aug in IST
    expect(formatInvoiceInstant("2026-08-21 23:14:01+05:30")).toBe("21 Aug 2026, 11:14:01 PM IST");
    // ISO "Z"
    expect(formatInvoiceInstant("2026-08-21T23:14:01Z")).toBe("22 Aug 2026, 04:44:01 AM IST");
  });

  it("accepts Date instances and renders them in IST", () => {
    expect(formatInvoiceInstant(new Date("2026-08-21T23:14:01.000Z")))
      .toBe("22 Aug 2026, 04:44:01 AM IST");
  });

  it("returns em dash for missing/invalid instants", () => {
    expect(formatInvoiceInstant(null)).toBe("\u2014");
    expect(formatInvoiceInstant("not-a-timestamp")).toBe("\u2014");
  });
});

// ── 2. formatDate — calendar DATE value, calendar-only ──────────────────────────
describe("invoice PDF — formatDate (calendar DATE → date-only)", () => {
  it("keeps a DATE value calendar-only with no timezone shift", () => {
    expect(formatDate("2026-08-22")).toBe("22 Aug 2026");
    expect(formatDate("2026-04-01")).toBe("01 Apr 2026");
  });

  it("ignores any trailing time component on a DATE-derived string", () => {
    expect(formatDate("2026-08-22T00:00:00Z")).toBe("22 Aug 2026");
  });

  it("returns em dash for empty/null", () => {
    expect(formatDate(null)).toBe("\u2014");
    expect(formatDate("")).toBe("\u2014");
  });
});

// ── 3. feePeriodLabel — date-only, host-independent ─────────────────────────────
function makeData(overrides: Partial<InvoiceDocumentData>): InvoiceDocumentData {
  return {
    invoiceNumber: "INV-1",
    status: "Due",
    createdAt: null,
    feeName: "Tuition",
    feeType: "Academic",
    amount: 1000,
    lateFeeAmount: 0,
    frequency: "monthly",
    feePeriodStart: null,
    feePeriodEnd: null,
    academicYear: null,
    dueDate: null,
    notes: null,
    breakdown: [],
    lateFeeConfig: null,
    student: {
      name: "S", digitalStudentId: "D", guardianName: null, phone: null,
      className: "10", section: "A",
    },
    school: {
      name: "School", logoUrl: null, addressLine1: null, addressLine2: null,
      city: null, state: null, pinCode: null, country: null, phone: null,
      email: null, affiliationNumber: null, gstin: null, signatureUrl: null,
      signatoryName: null,
    },
    ...overrides,
  };
}

describe("invoice PDF — feePeriodLabel (fee period → date-only)", () => {
  it("renders a single-month period as long month + year", () => {
    const data = makeData({ feePeriodStart: "2026-08-01", feePeriodEnd: "2026-08-31" });
    expect(feePeriodLabel(data)).toBe("August 2026");
  });

  it("renders a multi-month period as short month + year range", () => {
    const data = makeData({ feePeriodStart: "2026-07-01", feePeriodEnd: "2026-09-30" });
    expect(feePeriodLabel(data)).toBe("Jul 2026 \u2013 Sep 2026");
  });

  it("uses academic year for annual/one-time frequency", () => {
    const data = makeData({
      frequency: "annual", academicYear: "2026-2027",
      feePeriodStart: "2026-04-01", feePeriodEnd: "2027-03-31",
    });
    expect(feePeriodLabel(data)).toBe("2026-2027");
  });

  it("does not shift the month across a UTC/IST boundary date (host-independent)", () => {
    // 2026-08-31 as a UTC instant is still August in IST; date-only keeps August.
    const data = makeData({ feePeriodStart: "2026-08-01", feePeriodEnd: "2026-08-31" });
    expect(feePeriodLabel(data)).toBe("August 2026");
  });

  it("returns em dash when boundaries are missing", () => {
    expect(feePeriodLabel(makeData({ feePeriodStart: null, feePeriodEnd: null }))).toBe("\u2014");
  });
});
