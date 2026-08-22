/**
 * transaction-pdf.test.ts
 *
 * Unit tests for the upgraded transaction PDF renderer (server/transaction-pdf.ts).
 *
 * Covers:
 *  1. wrapToLines — long IDs / word boundaries / character-break
 *  2. computeSummary — correct math including edge cases
 *  3. buildFilterSummary — every LedgerFilters dimension, selectionLabel
 *  4. statusPillStyle — all named statuses + fallback
 *  5. fmtINR — Indian locale formatting
 *  6. fmtDateTime — Asia/Kolkata timezone rendering
 *  7. s() — em-dash substitution
 *  8. Empty report generation (returns a Buffer)
 *  9. Multi-page generation (> 1 page of rows)
 * 10. TxRow + TransactionPdfInput type contract
 */

import { describe, it, expect } from "vitest";
import {
  wrapToLines,
  computeSummary,
  buildFilterSummary,
  statusPillStyle,
  normalizeStatus,
  statusLabel,
  fmtINR,
  fmtDateTime,
  s,
  getCellLines,
  renderTransactionPdf,
  type TxRow,
  type TransactionPdfInput,
} from "../transaction-pdf";
import { emptyLedgerFilters, type LedgerFilters } from "../../shared/ledger-filters";

// ── Minimal mock PDFKit doc for wrapToLines ───────────────────────────────────
// Simulates widthOfString at a fixed ratio: characters × SCALE pt.
// A 'wide' font (e.g., 8pt bold) would have SCALE ≈ 5.0. We use 6 pt to match
// the realistic proportional width of typical PDFKit Reg font at given sizes.
function mockDoc(charWidth: number) {
  return {
    widthOfString(str: string): number {
      return str.length * charWidth;
    },
  };
}

// ── 1. wrapToLines ────────────────────────────────────────────────────────────
describe("wrapToLines — word boundary wrapping", () => {
  it("returns the text as-is when it fits on one line", () => {
    const doc = mockDoc(5);
    expect(wrapToLines(doc, "Hello World", 100)).toEqual(["Hello World"]);
  });

  it("wraps at word boundary when text is too long", () => {
    // Each char = 5 pt; "Hello" = 25 pt, "World" = 25 pt, together = 55 > 50
    const doc = mockDoc(5);
    const lines = wrapToLines(doc, "Hello World", 50);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Hello");
    expect(lines[1]).toBe("World");
  });

  it("returns em dash for empty string", () => {
    const doc = mockDoc(5);
    expect(wrapToLines(doc, "", 100)).toEqual(["\u2014"]);
  });

  it("returns em dash for em-dash input", () => {
    const doc = mockDoc(5);
    expect(wrapToLines(doc, "\u2014", 100)).toEqual(["\u2014"]);
  });

  it("character-breaks a long unbreakable ID that exceeds column width", () => {
    // Each char = 5 pt; column = 20 pt → max 4 chars per line
    const doc = mockDoc(5);
    const longId = "pay_ABCDEFGHIJ";  // 14 chars = 70 pt, col = 20 pt
    const lines = wrapToLines(doc, longId, 20);
    // Every line should fit within 20 pt (≤ 4 chars)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(4);
    }
    // All characters preserved
    expect(lines.join("")).toBe(longId);
  });

  it("wraps a realistic Razorpay payment ID correctly", () => {
    // pay_ABCD1234EFGH → 18 chars; column 84 pt; charWidth 5 → fits in one line (90 pt)
    const doc = mockDoc(5);
    const id = "pay_ABCD1234EFGH";
    const lines = wrapToLines(doc, id, 84);
    // Should fit on one line (18 × 5 = 90 > 84) → character break expected
    // The point is it must NOT produce a single line that overflows
    for (const line of lines) {
      expect(doc.widthOfString(line)).toBeLessThanOrEqual(84);
    }
  });

  it("handles multiple words with mid-sequence wrapping", () => {
    // charWidth = 4; "Alpha Beta Gamma Delta" — each word = 4×5 = 20 pt, maxW = 45
    const doc = mockDoc(4);
    const lines = wrapToLines(doc, "Alpha Beta Gamma Delta", 45);
    // "Alpha Beta" = 10 chars × 4 = 40 ≤ 45; "Alpha Beta Gamma" = 16 × 4 = 64 > 45
    expect(lines[0]).toBe("Alpha Beta");
    // "Gamma Delta" = 11 × 4 = 44 ≤ 45
    expect(lines[1]).toBe("Gamma Delta");
  });
});

// ── 2. computeSummary ─────────────────────────────────────────────────────────
function makeRow(overrides: Partial<TxRow>): TxRow {
  return {
    id: "r1",
    attempt_number: 1,
    student_name: "Test Student",
    student_id: "DSID001",
    class: "10",
    section: "A",
    invoice_number: "INV-001",
    receipt_number: null,
    fee_name: "Tuition",
    fee_type: "Academic",
    payment_method: "UPI",
    transaction_at: "2024-08-01T10:00:00Z",
    amount: 1000,
    status: "captured",
    payment_id: "pay_abc123",
    order_id: "order_xyz789",
    reference_number: null,
    failure_reason: null,
    refund_amount: 0,
    refund_status: null,
    ...overrides,
  };
}

describe("computeSummary — basic arithmetic", () => {
  it("returns zero for empty rows", () => {
    const s = computeSummary([]);
    expect(s.totalTransactions).toBe(0);
    expect(s.totalAmount).toBe(0);
    expect(s.successfulAmount).toBe(0);
    expect(s.failedAmount).toBe(0);
    expect(s.refundedAmount).toBe(0);
  });

  it("counts total transactions correctly", () => {
    const rows = [makeRow({ id: "r1" }), makeRow({ id: "r2" }), makeRow({ id: "r3" })];
    expect(computeSummary(rows).totalTransactions).toBe(3);
  });

  it("sums totalAmount for every row once", () => {
    const rows = [
      makeRow({ amount: 500, status: "captured" }),
      makeRow({ amount: 300, status: "failed" }),
      makeRow({ amount: 200, status: "pending" }),
    ];
    expect(computeSummary(rows).totalAmount).toBe(1000);
  });

  it("captures successful statuses: captured, settled, refunded, partially refunded", () => {
    const rows = [
      makeRow({ amount: 100, status: "captured" }),
      makeRow({ amount: 200, status: "settled" }),
      makeRow({ amount: 150, status: "refunded" }),
      makeRow({ amount: 50,  status: "partially refunded" }),
      makeRow({ amount: 999, status: "failed" }),    // should NOT count
      makeRow({ amount: 999, status: "pending" }),   // should NOT count
    ];
    expect(computeSummary(rows).successfulAmount).toBe(500);
  });

  it("counts backend canonical partially_refunded (underscore) as successful", () => {
    const rows = [
      makeRow({ amount: 400, status: "partially_refunded", refund_amount: 100 }),
      makeRow({ amount: 300, status: "PARTIALLY-REFUNDED", refund_amount: 50 }),
      makeRow({ amount: 200, status: "failed" }),
    ];
    const res = computeSummary(rows);
    expect(res.successfulAmount).toBe(700);   // both partially_refunded rows count
    expect(res.failedAmount).toBe(200);
    expect(res.refundedAmount).toBe(150);
  });

  it("sums failedAmount only for failed rows", () => {
    const rows = [
      makeRow({ amount: 100, status: "failed" }),
      makeRow({ amount: 200, status: "failed" }),
      makeRow({ amount: 500, status: "captured" }),
    ];
    expect(computeSummary(rows).failedAmount).toBe(300);
  });

  it("sums refundedAmount from refund_amount field, not amount", () => {
    const rows = [
      makeRow({ amount: 1000, status: "refunded",           refund_amount: 800 }),
      makeRow({ amount: 500,  status: "partially refunded", refund_amount: 200 }),
      makeRow({ amount: 300,  status: "captured",           refund_amount: 0   }),
    ];
    const res = computeSummary(rows);
    expect(res.refundedAmount).toBe(1000);
    // totalAmount should be sum of amount, not refund_amount
    expect(res.totalAmount).toBe(1800);
  });

  it("does not double-count any row", () => {
    const rows = [makeRow({ amount: 500, status: "captured", refund_amount: 0 })];
    const res = computeSummary(rows);
    expect(res.totalAmount).toBe(500);
    expect(res.successfulAmount).toBe(500);
    expect(res.failedAmount).toBe(0);
  });

  it("status comparison is case-insensitive", () => {
    const rows = [
      makeRow({ amount: 200, status: "Captured" }),
      makeRow({ amount: 100, status: "FAILED" }),
    ];
    const res = computeSummary(rows);
    expect(res.successfulAmount).toBe(200);
    expect(res.failedAmount).toBe(100);
  });
});

// ── 3. buildFilterSummary ─────────────────────────────────────────────────────
describe("buildFilterSummary — empty filters", () => {
  it("returns empty array for all-empty LedgerFilters", () => {
    expect(buildFilterSummary(emptyLedgerFilters())).toEqual([]);
  });

  it("returns empty array when selectionLabel is also absent", () => {
    expect(buildFilterSummary(emptyLedgerFilters(), null)).toEqual([]);
  });
});

describe("buildFilterSummary — individual dimensions", () => {
  const base = emptyLedgerFilters;

  it("includes search filter", () => {
    const f: LedgerFilters = { ...base(), search: "Rahul" };
    const parts = buildFilterSummary(f);
    expect(parts.some(p => p.includes("Search"))).toBe(true);
    expect(parts.some(p => p.includes("Rahul"))).toBe(true);
  });

  it("includes invoiceNumbers with +N more", () => {
    const f: LedgerFilters = { ...base(), invoiceNumbers: ["INV-001", "INV-002", "INV-003"] };
    const parts = buildFilterSummary(f);
    const part = parts.find(p => p.includes("Invoice"));
    expect(part).toBeDefined();
    expect(part).toContain("+1 more");
  });

  it("includes receiptNumbers", () => {
    const f: LedgerFilters = { ...base(), receiptNumbers: ["ON-100"] };
    expect(buildFilterSummary(f).some(p => p.includes("Receipt"))).toBe(true);
  });

  it("includes studentNames", () => {
    const f: LedgerFilters = { ...base(), studentNames: ["Rahul", "Priya"] };
    expect(buildFilterSummary(f).some(p => p.includes("Student"))).toBe(true);
  });

  it("includes dsids", () => {
    const f: LedgerFilters = { ...base(), dsids: ["DSID001"] };
    expect(buildFilterSummary(f).some(p => p.includes("DSID"))).toBe(true);
  });

  it("includes referenceNumbers", () => {
    const f: LedgerFilters = { ...base(), referenceNumbers: ["REF-XYZ"] };
    expect(buildFilterSummary(f).some(p => p.includes("Ref"))).toBe(true);
  });

  it("includes classes", () => {
    const f: LedgerFilters = { ...base(), classes: ["10A", "10B"] };
    expect(buildFilterSummary(f).some(p => p.includes("Class"))).toBe(true);
  });

  it("includes sections", () => {
    const f: LedgerFilters = { ...base(), sections: ["A"] };
    expect(buildFilterSummary(f).some(p => p.includes("Section"))).toBe(true);
  });

  it("includes feeNames", () => {
    const f: LedgerFilters = { ...base(), feeNames: ["Tuition"] };
    expect(buildFilterSummary(f).some(p => p.includes("Fee:"))).toBe(true);
  });

  it("includes feeTypes", () => {
    const f: LedgerFilters = { ...base(), feeTypes: ["Academic"] };
    expect(buildFilterSummary(f).some(p => p.includes("Fee Type"))).toBe(true);
  });

  it("includes feePeriods", () => {
    const f: LedgerFilters = { ...base(), feePeriods: ["2025-04-01|2025-03-31"] };
    expect(buildFilterSummary(f).some(p => p.includes("Fee Period"))).toBe(true);
  });

  it("includes frequencies", () => {
    const f: LedgerFilters = { ...base(), frequencies: ["Monthly"] };
    expect(buildFilterSummary(f).some(p => p.includes("Frequency"))).toBe(true);
  });

  it("includes statuses", () => {
    const f: LedgerFilters = { ...base(), statuses: ["Paid", "Overdue"] };
    expect(buildFilterSummary(f).some(p => p.includes("Status"))).toBe(true);
  });

  it("includes paymentMethods", () => {
    const f: LedgerFilters = { ...base(), paymentMethods: ["UPI"] };
    expect(buildFilterSummary(f).some(p => p.includes("Method"))).toBe(true);
  });

  it("includes academicYears", () => {
    const f: LedgerFilters = { ...base(), academicYears: ["2024-25"] };
    expect(buildFilterSummary(f).some(p => p.includes("Year"))).toBe(true);
  });

  it("includes amount range (both bounds)", () => {
    const f: LedgerFilters = { ...base(), amountMin: 100, amountMax: 5000 };
    const parts = buildFilterSummary(f);
    expect(parts.some(p => p.includes("Amount"))).toBe(true);
    expect(parts.some(p => p.includes("–"))).toBe(true);
  });

  it("includes amount min only", () => {
    const f: LedgerFilters = { ...base(), amountMin: 500, amountMax: null };
    expect(buildFilterSummary(f).some(p => p.includes("≥"))).toBe(true);
  });

  it("includes amount max only", () => {
    const f: LedgerFilters = { ...base(), amountMin: null, amountMax: 2000 };
    expect(buildFilterSummary(f).some(p => p.includes("≤"))).toBe(true);
  });

  it("includes due date range", () => {
    const f: LedgerFilters = { ...base(), dueDateFrom: "2025-01-01", dueDateTo: "2025-03-31" };
    expect(buildFilterSummary(f).some(p => p.includes("Due:"))).toBe(true);
  });

  it("includes paid date range", () => {
    const f: LedgerFilters = { ...base(), paidDateFrom: "2025-04-01", paidDateTo: null };
    expect(buildFilterSummary(f).some(p => p.includes("Paid:"))).toBe(true);
  });

  it("includes selectionLabel", () => {
    const f = base();
    const parts = buildFilterSummary(f, "Selected 5 students");
    expect(parts.some(p => p.includes("Selected 5 students"))).toBe(true);
  });

  it("includes selectionLabel with other filters", () => {
    const f: LedgerFilters = { ...base(), classes: ["10"] };
    const parts = buildFilterSummary(f, "My selection");
    expect(parts.some(p => p.includes("Class"))).toBe(true);
    expect(parts.some(p => p.includes("My selection"))).toBe(true);
  });
});

describe("buildFilterSummary — combined filter coverage", () => {
  it("produces a part for every active dimension simultaneously", () => {
    const f: LedgerFilters = {
      search: "test",
      invoiceNumbers: ["INV-1"],
      receiptNumbers: ["ON-2"],
      studentNames: ["Alice"],
      dsids: ["D001"],
      referenceNumbers: ["REF-X"],
      classes: ["10"],
      sections: ["B"],
      feeNames: ["Tuition"],
      feeTypes: ["Academic"],
      feePeriods: ["2025-04-01|2025-03-31"],
      frequencies: ["Monthly"],
      statuses: ["Paid"],
      paymentMethods: ["UPI"],
      academicYears: ["2024-25"],
      amountMin: 100,
      amountMax: 9999,
      dueDateFrom: "2025-01-01",
      dueDateTo: "2025-06-30",
      paidDateFrom: "2025-01-01",
      paidDateTo: null,
    };
    const parts = buildFilterSummary(f, "Extra label");
    // All 18 LedgerFilters dimensions + selectionLabel = exactly 19 parts
    // (amount range = 1 even though both bounds set; each date range = 1)
    expect(parts.length).toBe(19);
    // Every dimension label must be represented
    const joined = parts.join(" || ");
    for (const token of [
      "Search", "Invoice", "Receipt", "Student", "DSID", "Ref",
      "Class", "Section", "Fee:", "Fee Type", "Fee Period", "Frequency",
      "Status", "Method", "Year", "Amount", "Due:", "Paid:", "Selection",
    ]) {
      expect(joined).toContain(token);
    }
  });
});

// ── 4. statusPillStyle ────────────────────────────────────────────────────────
describe("statusPillStyle — known statuses", () => {
  const KNOWN = [
    "captured", "settled", "authorized",
    "failed", "refunded", "partially refunded",
    "cancelled", "pending",
  ];

  for (const status of KNOWN) {
    it(`returns a distinct style for "${status}"`, () => {
      const style = statusPillStyle(status);
      expect(style).toHaveProperty("bg");
      expect(style).toHaveProperty("fg");
      // Not the generic fallback
      expect(style.bg).not.toBe("#e5e7eb");
    });
  }

  it("returns safe fallback style for unknown status", () => {
    const style = statusPillStyle("unknown_xyz");
    expect(style.bg).toBe("#e5e7eb");
    expect(style.fg).toBe("#374151");
  });

  it("is case-insensitive", () => {
    expect(statusPillStyle("CAPTURED")).toEqual(statusPillStyle("captured"));
    expect(statusPillStyle("Failed")).toEqual(statusPillStyle("failed"));
  });

  it("styles the backend canonical partially_refunded (underscore) as partially refunded", () => {
    const underscore = statusPillStyle("partially_refunded");
    const spaced     = statusPillStyle("partially refunded");
    expect(underscore).toEqual(spaced);
    // Must NOT fall back to the generic grey style
    expect(underscore.bg).not.toBe("#e5e7eb");
  });

  it("normalizes hyphenated and spaced variants to the same style", () => {
    expect(statusPillStyle("partially-refunded")).toEqual(statusPillStyle("partially_refunded"));
    expect(statusPillStyle("PARTIALLY_REFUNDED")).toEqual(statusPillStyle("partially refunded"));
  });
});

// ── 4b. normalizeStatus ───────────────────────────────────────────────────────
describe("normalizeStatus — canonicalization", () => {
  it("collapses underscores to spaces", () => {
    expect(normalizeStatus("partially_refunded")).toBe("partially refunded");
  });

  it("collapses hyphens to spaces", () => {
    expect(normalizeStatus("partially-refunded")).toBe("partially refunded");
  });

  it("lowercases and trims", () => {
    expect(normalizeStatus("  CAPTURED  ")).toBe("captured");
  });

  it("collapses multiple separators and whitespace", () => {
    expect(normalizeStatus("partially__  --refunded")).toBe("partially refunded");
  });

  it("returns empty string for null/undefined", () => {
    expect(normalizeStatus(null)).toBe("");
    expect(normalizeStatus(undefined)).toBe("");
  });
});

// ── 4c. statusLabel ───────────────────────────────────────────────────────────
describe("statusLabel — friendly Title Case", () => {
  it("renders partially_refunded as 'Partially Refunded'", () => {
    expect(statusLabel("partially_refunded")).toBe("Partially Refunded");
  });

  it("renders captured as 'Captured'", () => {
    expect(statusLabel("captured")).toBe("Captured");
  });

  it("never contains raw underscores", () => {
    expect(statusLabel("partially_refunded")).not.toContain("_");
    expect(statusLabel("partially-refunded")).not.toContain("-");
  });

  it("returns em dash for empty status", () => {
    expect(statusLabel("")).toBe("\u2014");
    expect(statusLabel(null)).toBe("\u2014");
  });

  it("Title Cases multi-word statuses", () => {
    expect(statusLabel("partially refunded")).toBe("Partially Refunded");
  });
});

// ── 5. fmtINR ─────────────────────────────────────────────────────────────────
describe("fmtINR — Indian currency formatting", () => {
  it("formats zero as ₹0", () => {
    expect(fmtINR(0)).toBe("₹0");
  });

  it("formats 1000 with comma separator", () => {
    expect(fmtINR(1000)).toContain("1,000");
  });

  it("formats lakh values", () => {
    expect(fmtINR(100000)).toContain("1,00,000");
  });

  it("formats decimal amounts (up to 2 places)", () => {
    const s = fmtINR(1234.56);
    expect(s).toContain("1,234");
    expect(s).toContain("56");
  });

  it("starts with ₹ symbol", () => {
    expect(fmtINR(500)).toMatch(/^₹/);
  });
});

// ── 6. fmtDateTime ────────────────────────────────────────────────────────────
describe("fmtDateTime — Asia/Kolkata timezone", () => {
  it("returns em dash for null", () => {
    expect(fmtDateTime(null)).toBe("—");
  });

  it("returns em dash for invalid date", () => {
    expect(fmtDateTime("not-a-date")).toBe("—");
  });

  it("returns a non-empty string for a valid ISO timestamp", () => {
    const result = fmtDateTime("2024-08-15T10:30:00Z");
    expect(result).not.toBe("—");
    expect(result.length).toBeGreaterThan(5);
  });

  it("includes year 2024 for a 2024 timestamp", () => {
    const result = fmtDateTime("2024-08-15T10:30:00Z");
    expect(result).toContain("2024");
  });

  // ── IST timezone standardization boundary cases ─────────────────────────────
  // Five persisted-instant forms around the 22-Aug-2026 IST boundary. Each is a
  // timestamp that must display in Asia/Kolkata with an explicit " IST" suffix,
  // host-timezone independent. Covers PostgreSQL bare (UTC convention), short
  // offsets ("+00" / "-05"), full offset ("+05:30"), and ISO "Z".
  it("renders the five persisted-instant boundary forms in IST with suffix", () => {
    // PostgreSQL bare timestamp-without-time-zone (treated as UTC by convention)
    expect(fmtDateTime("2026-08-21 23:14:01")).toBe("22 Aug 2026, 04:44:01 AM IST");
    // Short offset "+00"
    expect(fmtDateTime("2026-08-21 23:14:01+00")).toBe("22 Aug 2026, 04:44:01 AM IST");
    // Short offset "-05"
    expect(fmtDateTime("2026-08-21 23:14:01-05")).toBe("22 Aug 2026, 09:44:01 AM IST");
    // Full offset "+05:30" (already IST) — stays on 21 Aug in IST
    expect(fmtDateTime("2026-08-21 23:14:01+05:30")).toBe("21 Aug 2026, 11:14:01 PM IST");
    // ISO "Z"
    expect(fmtDateTime("2026-08-21T23:14:01Z")).toBe("22 Aug 2026, 04:44:01 AM IST");
  });

  it("always appends an IST suffix to a rendered timestamp", () => {
    expect(fmtDateTime("2026-08-21T23:14:01Z")).toMatch(/ IST$/);
  });
});

// ── 7. s() helper ─────────────────────────────────────────────────────────────
describe("s() — safe string with em-dash fallback", () => {
  it("returns em dash for null", () => {
    expect(s(null)).toBe("—");
  });

  it("returns em dash for undefined", () => {
    expect(s(undefined)).toBe("—");
  });

  it("returns em dash for empty string", () => {
    expect(s("")).toBe("—");
  });

  it("returns the string value when non-empty", () => {
    expect(s("hello")).toBe("hello");
  });

  it("returns string representation of numbers", () => {
    expect(s(42)).toBe("42");
  });
});

// ── 7b. getCellLines — class/section formatting ───────────────────────────────
describe("getCellLines — class/section cell", () => {
  it("formats class + section with a hyphen separator (10-A, not 10A)", () => {
    const row = makeRow({ class: "10", section: "A" });
    expect(getCellLines(row, "class")).toEqual(["10-A"]);
  });

  it("renders class only when no section", () => {
    const row = makeRow({ class: "10", section: null });
    expect(getCellLines(row, "class")).toEqual(["10"]);
  });

  it("renders section only when no class", () => {
    const row = makeRow({ class: null, section: "A" });
    expect(getCellLines(row, "class")).toEqual(["A"]);
  });

  it("renders em dash when both absent", () => {
    const row = makeRow({ class: null, section: null });
    expect(getCellLines(row, "class")).toEqual(["\u2014"]);
  });

  it("does not accidentally concatenate class and section", () => {
    const row = makeRow({ class: "12", section: "B" });
    const out = getCellLines(row, "class")[0];
    expect(out).not.toBe("12B");
    expect(out).toBe("12-B");
  });
});

// ── 7c. getCellLines — status cell uses friendly label ─────────────────────────
describe("getCellLines — status cell", () => {
  it("renders partially_refunded as friendly Title Case label", () => {
    const row = makeRow({ status: "partially_refunded" });
    expect(getCellLines(row, "status")).toEqual(["Partially Refunded"]);
  });

  it("never renders raw underscores in the status cell", () => {
    const row = makeRow({ status: "partially_refunded" });
    expect(getCellLines(row, "status")[0]).not.toContain("_");
  });
});

// ── 8. Empty report generation ────────────────────────────────────────────────
describe("renderTransactionPdf — empty report", () => {
  it("resolves to a non-empty Buffer even with zero rows", async () => {
    const input: TransactionPdfInput = {
      school: {
        name: "Test School",
        logoUrl: null,
        addressLine1: "123 Main St",
        addressLine2: null,
        city: "Mumbai",
        state: "Maharashtra",
        pinCode: "400001",
        phone: "9876543210",
        email: "school@example.com",
      },
      sessionLabel: "2024-25",
      filters: emptyLedgerFilters(),
      selectionLabel: null,
      rows: [],
      generatedAtIST: "15 Aug 2024, 10:00 AM",
    };

    const buf = await renderTransactionPdf(input);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
  }, 30000);

  it("PDF starts with the %PDF- header", async () => {
    const input: TransactionPdfInput = {
      school: {
        name: "Empty School",
        logoUrl: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        pinCode: null,
        phone: null,
        email: null,
      },
      sessionLabel: null,
      filters: emptyLedgerFilters(),
      selectionLabel: null,
      rows: [],
      generatedAtIST: "15 Aug 2024, 10:00 AM",
    };

    const buf = await renderTransactionPdf(input);
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  }, 30000);
});

// ── 9. Multi-page generation ──────────────────────────────────────────────────
describe("renderTransactionPdf — multi-page generation", () => {
  function makeRows(n: number): TxRow[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `txn_${i}`,
      attempt_number: 1,
      student_name: `Student Number ${i + 1}`,
      student_id: `DSID${String(i + 1).padStart(4, "0")}`,
      class: "10",
      section: "A",
      invoice_number: `INV-${String(i + 1).padStart(4, "0")}`,
      receipt_number: i % 2 === 0 ? `ON-${String(i + 1).padStart(4, "0")}` : null,
      fee_name: "Annual Tuition Fee",
      fee_type: "Academic",
      payment_method: "UPI",
      transaction_at: "2024-08-01T10:00:00Z",
      amount: 5000 + i * 100,
      status: i % 5 === 0 ? "failed" : "captured",
      payment_id: `pay_${Math.random().toString(36).slice(2, 12)}ABCDEFGH`,
      order_id: `order_${Math.random().toString(36).slice(2, 12)}XYZ`,
      reference_number: null,
      failure_reason: i % 5 === 0 ? "Insufficient funds" : null,
      refund_amount: i % 7 === 0 ? 100 : 0,
      refund_status: i % 7 === 0 ? "processed" : null,
    }));
  }

  it("renders 50 rows to a Buffer without error", async () => {
    const input: TransactionPdfInput = {
      school: {
        name: "Big School",
        logoUrl: null,
        addressLine1: "456 School Road",
        addressLine2: null,
        city: "Delhi",
        state: "Delhi",
        pinCode: "110001",
        phone: "9111111111",
        email: "big@school.edu",
      },
      sessionLabel: "2024-25",
      filters: emptyLedgerFilters(),
      selectionLabel: null,
      rows: makeRows(50),
      generatedAtIST: "01 Aug 2024, 12:00 PM",
    };

    const buf = await renderTransactionPdf(input);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(5000);
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  }, 60000);

  it("renders 200 rows (multi-page) to a valid PDF", async () => {
    const input: TransactionPdfInput = {
      school: {
        name: "Large School",
        logoUrl: null,
        addressLine1: null,
        addressLine2: null,
        city: "Chennai",
        state: "Tamil Nadu",
        pinCode: "600001",
        phone: null,
        email: null,
      },
      sessionLabel: "2024-25",
      filters: {
        ...emptyLedgerFilters(),
        classes: ["10", "11"],
        paymentMethods: ["UPI", "Card"],
        statuses: ["Paid"],
      },
      selectionLabel: "Class 10 and 11 students",
      rows: makeRows(200),
      generatedAtIST: "01 Aug 2024, 12:00 PM",
    };

    const buf = await renderTransactionPdf(input);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
    // 200 rows should produce multiple pages — PDF should be substantial
    expect(buf.length).toBeGreaterThan(20000);
  }, 60000);

  it("bounds an exceptionally long failure reason so one row cannot cross the footer", async () => {
    const rows = makeRows(1);
    rows[0]!.status = "failed";
    rows[0]!.failure_reason = Array.from(
      { length: 2500 },
      (_, index) => `failure-segment-${index}`,
    ).join(" ");

    const input: TransactionPdfInput = {
      school: {
        name: "Long Failure School",
        logoUrl: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        pinCode: null,
        phone: null,
        email: null,
      },
      sessionLabel: "2024-25",
      filters: emptyLedgerFilters(),
      selectionLabel: null,
      rows,
      generatedAtIST: "01 Aug 2024, 12:00 PM",
    };

    const buf = await renderTransactionPdf(input);
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
    const pageObjects = buf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pageObjects.length).toBeGreaterThanOrEqual(2);
    expect(pageObjects.length).toBeLessThanOrEqual(3);
  }, 60000);

  it("computeSummary matches expected totals for 50 rows", () => {
    const rows = makeRows(50);
    const res = computeSummary(rows);
    expect(res.totalTransactions).toBe(50);
    // totalAmount = sum of (5000 + i*100) for i in 0..49
    // = 50*5000 + 100*(0+1+...+49) = 250000 + 100*1225 = 250000 + 122500 = 372500
    expect(res.totalAmount).toBe(372500);
  });
});

// ── 10. TxRow contract ────────────────────────────────────────────────────────
describe("TxRow contract — all required fields present", () => {
  it("accepts a minimal TxRow with required nullable fields as null", () => {
    const row: TxRow = {
      id: "txn_1",
      attempt_number: null,
      student_name: null,
      student_id: null,
      class: null,
      section: null,
      invoice_number: null,
      receipt_number: null,
      fee_name: null,
      fee_type: null,
      payment_method: null,
      transaction_at: null,
      amount: 0,
      status: "pending",
      payment_id: null,
      order_id: null,
      reference_number: null,
      failure_reason: null,
      refund_amount: 0,
      refund_status: null,
    };
    // Should compile and computeSummary should handle gracefully
    const res = computeSummary([row]);
    expect(res.totalTransactions).toBe(1);
    expect(res.totalAmount).toBe(0);
  });
});
