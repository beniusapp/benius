/**
 * server/__tests__/ledger-filters.test.ts
 *
 * Pure unit tests for shared/ledger-filters normalization, serialization,
 * active-count, and label helpers. No database or HTTP required.
 */

import { describe, expect, it } from "vitest";
import {
  emptyLedgerFilters,
  normalizeLedgerFiltersFromQuery,
  normalizeLedgerFiltersFromBody,
  countActiveLedgerFilters,
  isEmptyLedgerFilters,
  ledgerFiltersToQuery,
  ledgerFiltersToSearchParams,
  ledgerFiltersToBody,
  ledgerFilterLabel,
  firstLedgerFilterValue,
  joinedLedgerFilterLabel,
  encodeFeePeriod,
  decodeFeePeriod,
  isValidDate,
  MAX_STR_LEN,
  MAX_ARRAY_SIZE,
} from "@shared/ledger-filters";

// ── emptyLedgerFilters ────────────────────────────────────────────────────────

describe("emptyLedgerFilters", () => {
  it("returns an object with empty search and empty arrays", () => {
    const f = emptyLedgerFilters();
    expect(f.search).toBe("");
    expect(f.invoiceNumbers).toEqual([]);
    expect(f.classes).toEqual([]);
    expect(f.statuses).toEqual([]);
    expect(f.amountMin).toBeNull();
    expect(f.dueDateFrom).toBeNull();
  });
});

// ── isValidDate ───────────────────────────────────────────────────────────────

describe("isValidDate", () => {
  it("accepts valid YYYY-MM-DD", () => {
    expect(isValidDate("2025-01-31")).toBe(true);
    expect(isValidDate("2000-02-29")).toBe(true); // leap year
  });

  it("rejects invalid formats", () => {
    expect(isValidDate("25-01-31")).toBe(false);
    expect(isValidDate("2025/01/31")).toBe(false);
    expect(isValidDate("not-a-date")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });

  it("rejects impossible calendar dates", () => {
    expect(isValidDate("2025-13-01")).toBe(false);
    expect(isValidDate("2025-00-01")).toBe(false);
  });
});

// ── normalizeLedgerFiltersFromQuery ───────────────────────────────────────────

describe("normalizeLedgerFiltersFromQuery", () => {
  it("returns empty filters for empty query", () => {
    const f = normalizeLedgerFiltersFromQuery({});
    expect(isEmptyLedgerFilters(f)).toBe(true);
  });

  it("parses global search", () => {
    const f = normalizeLedgerFiltersFromQuery({ search: "  Alice  " });
    expect(f.search).toBe("Alice");
  });

  it("parses plural array fields", () => {
    const f = normalizeLedgerFiltersFromQuery({
      classes: "8A,8B",
      statuses: "Paid,Due",
    });
    expect(f.classes).toEqual(["8A", "8B"]);
    expect(f.statuses).toEqual(["Paid", "Due"]);
  });

  it("backward-compat: old singular class maps to classes[0]", () => {
    const f = normalizeLedgerFiltersFromQuery({ class: "8A" });
    expect(f.classes).toEqual(["8A"]);
  });

  it("backward-compat: old singular class=all means no filter", () => {
    const f = normalizeLedgerFiltersFromQuery({ class: "all" });
    expect(f.classes).toEqual([]);
  });

  it("backward-compat: old singular status maps to statuses[0]", () => {
    const f = normalizeLedgerFiltersFromQuery({ status: "Paid" });
    expect(f.statuses).toEqual(["Paid"]);
  });

  it("backward-compat: old singular status=all means no filter", () => {
    const f = normalizeLedgerFiltersFromQuery({ status: "all" });
    expect(f.statuses).toEqual([]);
  });

  it("backward-compat: old singular feeName maps to feeNames[0]", () => {
    const f = normalizeLedgerFiltersFromQuery({ feeName: "Tuition" });
    expect(f.feeNames).toEqual(["Tuition"]);
  });

  it("backward-compat: old singular feeName=all means no filter", () => {
    const f = normalizeLedgerFiltersFromQuery({ feeName: "all" });
    expect(f.feeNames).toEqual([]);
  });

  it("backward-compat: old singular feeType maps to feeTypes[0]", () => {
    const f = normalizeLedgerFiltersFromQuery({ feeType: "Tuition" });
    expect(f.feeTypes).toEqual(["Tuition"]);
  });

  it("backward-compat: dateFrom/dateTo map to dueDateFrom/dueDateTo", () => {
    const f = normalizeLedgerFiltersFromQuery({ dateFrom: "2025-01-01", dateTo: "2025-12-31" });
    expect(f.dueDateFrom).toBe("2025-01-01");
    expect(f.dueDateTo).toBe("2025-12-31");
  });

  it("filters out invalid status values", () => {
    const f = normalizeLedgerFiltersFromQuery({ statuses: "Paid,Bogus,Overdue" });
    expect(f.statuses).toEqual(["Paid", "Overdue"]);
  });

  it("strips invalid dates", () => {
    const f = normalizeLedgerFiltersFromQuery({ dueDateFrom: "not-a-date" });
    expect(f.dueDateFrom).toBeNull();
  });

  it("accepts valid amount numbers", () => {
    const f = normalizeLedgerFiltersFromQuery({ amountMin: "100", amountMax: "5000" });
    expect(f.amountMin).toBe(100);
    expect(f.amountMax).toBe(5000);
  });

  it("rejects non-numeric amounts", () => {
    const f = normalizeLedgerFiltersFromQuery({ amountMin: "abc" });
    expect(f.amountMin).toBeNull();
  });

  it("truncates strings to MAX_STR_LEN", () => {
    const long = "x".repeat(MAX_STR_LEN + 50);
    const f = normalizeLedgerFiltersFromQuery({ search: long });
    expect(f.search.length).toBe(MAX_STR_LEN);
  });

  it("limits array size to MAX_ARRAY_SIZE", () => {
    const many = Array.from({ length: MAX_ARRAY_SIZE + 20 }, (_, i) => `Paid`).join(",");
    const f = normalizeLedgerFiltersFromQuery({ statuses: many });
    // Only valid statuses count but array limit applies before filtering
    expect(f.statuses.length).toBeLessThanOrEqual(MAX_ARRAY_SIZE);
  });

  it("parses feePeriods as array", () => {
    const f = normalizeLedgerFiltersFromQuery({ feePeriods: "2025-08-01|2025-08-31" });
    expect(f.feePeriods).toEqual(["2025-08-01|2025-08-31"]);
  });
});

// ── normalizeLedgerFiltersFromBody ────────────────────────────────────────────

describe("normalizeLedgerFiltersFromBody", () => {
  it("accepts array values directly (JSON body)", () => {
    const f = normalizeLedgerFiltersFromBody({ classes: ["8A", "8B"] });
    expect(f.classes).toEqual(["8A", "8B"]);
  });

  it("backward-compat: old singular body fields", () => {
    const f = normalizeLedgerFiltersFromBody({ feeName: "Tuition", status: "Paid" });
    expect(f.feeNames).toEqual(["Tuition"]);
    expect(f.statuses).toEqual(["Paid"]);
  });
});

// ── countActiveLedgerFilters ──────────────────────────────────────────────────

describe("countActiveLedgerFilters", () => {
  it("returns 0 for empty filters", () => {
    expect(countActiveLedgerFilters(emptyLedgerFilters())).toBe(0);
  });

  it("counts each active dimension once", () => {
    const f = emptyLedgerFilters();
    f.search = "Alice";
    f.classes = ["8A"];
    f.statuses = ["Paid"];
    f.amountMin = 100;
    f.dueDateFrom = "2025-01-01";
    expect(countActiveLedgerFilters(f)).toBe(5);
  });

  it("counts amountMin and amountMax together as ONE range dimension", () => {
    const f = emptyLedgerFilters();
    f.amountMin = 0;
    f.amountMax = 999;
    expect(countActiveLedgerFilters(f)).toBe(1);
  });
});

// ── ledgerFiltersToQuery ──────────────────────────────────────────────────────

describe("ledgerFiltersToQuery", () => {
  it("returns empty object for empty filters", () => {
    expect(ledgerFiltersToQuery(emptyLedgerFilters())).toEqual({});
  });

  it("serializes arrays as comma-joined strings", () => {
    const f = emptyLedgerFilters();
    f.classes = ["8A", "8B"];
    f.statuses = ["Paid", "Due"];
    const q = ledgerFiltersToQuery(f);
    expect(q.classes).toBe("8A,8B");
    expect(q.statuses).toBe("Paid,Due");
  });

  it("round-trips through normalize", () => {
    const f = emptyLedgerFilters();
    f.search = "test";
    f.classes = ["8A"];
    f.dueDateFrom = "2025-01-01";
    f.amountMin = 100;
    const q = ledgerFiltersToQuery(f);
    const f2 = normalizeLedgerFiltersFromQuery(q);
    expect(f2.search).toBe("test");
    expect(f2.classes).toEqual(["8A"]);
    expect(f2.dueDateFrom).toBe("2025-01-01");
    expect(f2.amountMin).toBe(100);
  });
});

// ── ledgerFiltersToBody ───────────────────────────────────────────────────────

describe("ledgerFiltersToBody", () => {
  it("serializes arrays as actual arrays", () => {
    const f = emptyLedgerFilters();
    f.classes = ["8A", "8B"];
    const b = ledgerFiltersToBody(f);
    expect(b.classes).toEqual(["8A", "8B"]);
  });

  it("omits empty fields", () => {
    const b = ledgerFiltersToBody(emptyLedgerFilters());
    expect(Object.keys(b).length).toBe(0);
  });
});

// ── Label helpers ─────────────────────────────────────────────────────────────

describe("ledgerFilterLabel", () => {
  it("returns empty string for empty array", () => {
    expect(ledgerFilterLabel([], "Class", "Classes")).toBe("");
  });

  it("singular for one value", () => {
    expect(ledgerFilterLabel(["8A"], "Class", "Classes")).toBe("Class: 8A");
  });

  it("plural + both for two values", () => {
    expect(ledgerFilterLabel(["8A", "8B"], "Class", "Classes")).toBe("Classes: 8A, 8B");
  });

  it("shows +N more for 3+", () => {
    expect(ledgerFilterLabel(["8A", "8B", "9A"], "Class", "Classes"))
      .toBe("Classes: 8A, 8B +1 more");
  });
});

describe("firstLedgerFilterValue", () => {
  it("returns undefined for empty", () => {
    expect(firstLedgerFilterValue([])).toBeUndefined();
  });

  it("returns first element", () => {
    expect(firstLedgerFilterValue(["Paid", "Due"])).toBe("Paid");
  });
});

describe("joinedLedgerFilterLabel", () => {
  it("returns undefined for empty", () => {
    expect(joinedLedgerFilterLabel([])).toBeUndefined();
  });

  it("joins with comma", () => {
    expect(joinedLedgerFilterLabel(["A", "B", "C"])).toBe("A, B, C");
  });
});

// ── Fee period encoding ───────────────────────────────────────────────────────

describe("encodeFeePeriod / decodeFeePeriod", () => {
  it("encodes as start|end", () => {
    expect(encodeFeePeriod("2025-08-01", "2025-08-31")).toBe("2025-08-01|2025-08-31");
  });

  it("decodes valid token", () => {
    const decoded = decodeFeePeriod("2025-08-01|2025-08-31");
    expect(decoded).toEqual({ start: "2025-08-01", end: "2025-08-31" });
  });

  it("returns null for malformed token (no pipe)", () => {
    expect(decodeFeePeriod("2025-08-01")).toBeNull();
  });

  it("returns null for invalid dates", () => {
    expect(decodeFeePeriod("bad-date|2025-08-31")).toBeNull();
    expect(decodeFeePeriod("2025-08-01|bad-date")).toBeNull();
  });

  it("round-trips", () => {
    const start = "2025-04-01";
    const end   = "2025-06-30";
    const token = encodeFeePeriod(start, end);
    const decoded = decodeFeePeriod(token)!;
    expect(decoded.start).toBe(start);
    expect(decoded.end).toBe(end);
  });
});

// ── isValidDate: impossible calendar dates ──────────────────────────────────────

describe("isValidDate impossible dates", () => {
  it("accepts real dates", () => {
    expect(isValidDate("2025-08-31")).toBe(true);
    expect(isValidDate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects impossible days that JS Date would roll over", () => {
    expect(isValidDate("2026-02-31")).toBe(false);
    expect(isValidDate("2025-02-29")).toBe(false); // non-leap year
    expect(isValidDate("2025-04-31")).toBe(false); // April has 30 days
    expect(isValidDate("2025-06-31")).toBe(false);
  });

  it("rejects out-of-range months and days", () => {
    expect(isValidDate("2025-13-01")).toBe(false);
    expect(isValidDate("2025-00-10")).toBe(false);
    expect(isValidDate("2025-05-00")).toBe(false);
    expect(isValidDate("2025-05-32")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isValidDate("2025-8-1")).toBe(false);
    expect(isValidDate("not-a-date")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });
});

// ── ledgerFiltersToSearchParams: repeated params ────────────────────────────────

describe("ledgerFiltersToSearchParams", () => {
  it("appends each array value as a REPEATED param (no CSV, no JSON)", () => {
    const f = emptyLedgerFilters();
    f.classes = ["8A", "8B"];
    f.statuses = ["paid"];
    const params = ledgerFiltersToSearchParams(f);
    expect(params.getAll("classes")).toEqual(["8A", "8B"]);
    expect(params.getAll("statuses")).toEqual(["paid"]);
    // Never comma-joined:
    expect(params.get("classes")).toBe("8A");
    expect(params.toString()).not.toContain("8A%2C8B");
    expect(params.toString()).not.toContain("8A,8B");
  });

  it("serializes search, ranges, and dates once", () => {
    const f = emptyLedgerFilters();
    f.search = "john";
    f.amountMin = 100;
    f.amountMax = 500;
    f.dueDateFrom = "2025-04-01";
    f.paidDateTo = "2025-06-30";
    const params = ledgerFiltersToSearchParams(f);
    expect(params.get("search")).toBe("john");
    expect(params.get("amountMin")).toBe("100");
    expect(params.get("amountMax")).toBe("500");
    expect(params.get("dueDateFrom")).toBe("2025-04-01");
    expect(params.get("paidDateTo")).toBe("2025-06-30");
  });

  it("round-trips through the query normalizer", () => {
    const f = emptyLedgerFilters();
    f.classes = ["8A", "8B"];
    f.invoiceNumbers = ["INV-1"];
    const params = ledgerFiltersToSearchParams(f);
    // Emulate Express query parsing of repeated params → string[]
    const q: Record<string, unknown> = {
      classes: params.getAll("classes"),
      invoiceNumbers: params.getAll("invoiceNumbers"),
    };
    const round = normalizeLedgerFiltersFromQuery(q);
    expect(round.classes).toEqual(["8A", "8B"]);
    expect(round.invoiceNumbers).toEqual(["INV-1"]);
  });
});

// ── array normalization: JSON, CSV, repeated, dedup ─────────────────────────────

describe("array normalization compatibility", () => {
  it("accepts a repeated-param array", () => {
    const f = normalizeLedgerFiltersFromQuery({ classes: ["8A", "8B"] });
    expect(f.classes).toEqual(["8A", "8B"]);
  });

  it("accepts a JSON-array string", () => {
    const f = normalizeLedgerFiltersFromQuery({ classes: '["8A","8B"]' });
    expect(f.classes).toEqual(["8A", "8B"]);
  });

  it("accepts an old CSV string", () => {
    const f = normalizeLedgerFiltersFromQuery({ classes: "8A,8B" });
    expect(f.classes).toEqual(["8A", "8B"]);
  });

  it("de-duplicates while preserving order", () => {
    const f = normalizeLedgerFiltersFromQuery({ classes: ["8A", "8B", "8A"] });
    expect(f.classes).toEqual(["8A", "8B"]);
  });

  it("falls back to CSV parsing for malformed JSON", () => {
    const f = normalizeLedgerFiltersFromQuery({ classes: "[8A,8B" });
    expect(f.classes).toEqual(["[8A", "8B"]);
  });
});

// ── active-count treats ranges as one dimension ─────────────────────────────────

describe("countActiveLedgerFilters ranges", () => {
  it("counts an amount range with both bounds as ONE dimension", () => {
    const f = emptyLedgerFilters();
    f.amountMin = 100;
    f.amountMax = 500;
    expect(countActiveLedgerFilters(f)).toBe(1);
  });

  it("counts an amount range with a single bound as ONE dimension", () => {
    const f = emptyLedgerFilters();
    f.amountMin = 100;
    expect(countActiveLedgerFilters(f)).toBe(1);
  });

  it("counts each date range as ONE dimension", () => {
    const f = emptyLedgerFilters();
    f.dueDateFrom = "2025-04-01";
    f.dueDateTo = "2025-06-30";
    f.paidDateFrom = "2025-05-01";
    expect(countActiveLedgerFilters(f)).toBe(2);
  });

  it("combines ranges with array dimensions correctly", () => {
    const f = emptyLedgerFilters();
    f.classes = ["8A"];
    f.amountMin = 100;
    f.amountMax = 500;
    f.dueDateFrom = "2025-04-01";
    f.dueDateTo = "2025-06-30";
    // classes (1) + amount range (1) + due-date range (1) = 3
    expect(countActiveLedgerFilters(f)).toBe(3);
  });
});
