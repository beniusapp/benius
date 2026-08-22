/**
 * server/__tests__/ledger-filter-sql.test.ts
 *
 * Pure unit tests for the LedgerFilterSQL predicate builder.
 * Verifies that predicates are built (non-zero length) for active filters
 * and that empty filters produce no predicates. Does NOT run actual SQL.
 */

import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { emptyLedgerFilters, type LedgerFilters } from "@shared/ledger-filters";
import {
  buildLedgerFilterPredicates,
  buildLedgerInvoiceSessionPredicate,
  buildLedgerPaymentDatePredicate,
  filtersRequirePaymentJoin,
  type LedgerFilterFields,
} from "../ledger-filter-sql";

// Render a predicate to its parameterized SQL + params for assertions.
const dialect = new PgDialect();
function render(pred: SQL): { text: string; params: unknown[] } {
  const q = dialect.sqlToQuery(pred);
  return { text: q.sql, params: q.params };
}

// Minimal field expressions for tests
const FIELDS: LedgerFilterFields = {
  invoiceNumber: sql`fr.invoice_number`,
  receiptNumber: sql`fr.receipt_number`,
  studentName:   sql`s.name`,
  dsid:          sql`s.digital_student_id`,
  class:         sql`s.class`,
  section:       sql`s.section`,
  feeName:       sql`COALESCE(fr.fee_name, fs.name, fr.fee_type)`,
  feeType:       sql`fr.fee_type`,
  feePeriodStartEnd: [sql`fr.fee_period_start`, sql`fr.fee_period_end`],
  frequency:     sql`fr.frequency`,
  status:        sql`fr.status`,
  paymentMethod: sql`ledger_payment.raw_payment_method`,
  academicYear:  sql`fr.academic_year`,
  amount:        sql`fr.amount`,
  dueDate:       sql`fr.due_date`,
  paidDate:      sql`fr.paid_date`,
  referenceNumber: sql`p.last_reference`,
};

function withFilter(patch: Partial<LedgerFilters>): LedgerFilters {
  return { ...emptyLedgerFilters(), ...patch };
}

describe("buildLedgerFilterPredicates", () => {
  it("returns empty array for empty filters", () => {
    const preds = buildLedgerFilterPredicates(emptyLedgerFilters(), FIELDS);
    expect(preds).toHaveLength(0);
  });

  it("adds one predicate for global search", () => {
    const f = withFilter({ search: "Alice" });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("ignores whitespace-only search", () => {
    const f = withFilter({ search: "   " });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(0);
  });

  it("adds one predicate for single status", () => {
    const f = withFilter({ statuses: ["Paid"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("adds one predicate for multiple statuses (OR)", () => {
    const f = withFilter({ statuses: ["Paid", "Overdue"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1); // single OR expression
  });

  it("adds predicates for each active field (AND between fields)", () => {
    const f = withFilter({
      statuses: ["Paid"],
      classes: ["8A"],
      feeTypes: ["Tuition"],
    });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(3); // one per active field
  });

  it("adds predicate for amount range (min and max separately)", () => {
    const f = withFilter({ amountMin: 100, amountMax: 5000 });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(2);
  });

  it("adds predicates for due date range", () => {
    const f = withFilter({ dueDateFrom: "2025-01-01", dueDateTo: "2025-12-31" });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(2);
  });

  it("adds predicates for paid date range", () => {
    const f = withFilter({ paidDateFrom: "2025-06-01", paidDateTo: "2025-06-30" });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(2);
  });

  it("adds predicate for invoice numbers", () => {
    const f = withFilter({ invoiceNumbers: ["INV-0001"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("adds predicate for multiple invoice numbers (ANY)", () => {
    const f = withFilter({ invoiceNumbers: ["INV-0001", "INV-0002"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("adds predicate for receipt numbers", () => {
    const f = withFilter({ receiptNumbers: ["ON-0001"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("adds predicate for student names (ILIKE partial)", () => {
    const f = withFilter({ studentNames: ["Alice", "Bob"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("adds predicate for dsids", () => {
    const f = withFilter({ dsids: ["DSID-001"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("adds predicate for reference numbers", () => {
    const f = withFilter({ referenceNumbers: ["REF-123"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("adds predicate for fee periods (encoded)", () => {
    const f = withFilter({ feePeriods: ["2025-08-01|2025-08-31"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("skips malformed fee period tokens gracefully", () => {
    const f = withFilter({ feePeriods: ["bad-token"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    // malformed token decoded to null → 0 period clauses → no predicate
    expect(preds).toHaveLength(0);
  });

  it("skips fee period filter when feePeriodStartEnd not provided in fields", () => {
    const fieldsWithoutPeriod: LedgerFilterFields = { ...FIELDS, feePeriodStartEnd: undefined };
    const f = withFilter({ feePeriods: ["2025-08-01|2025-08-31"] });
    const preds = buildLedgerFilterPredicates(f, fieldsWithoutPeriod);
    expect(preds).toHaveLength(0);
  });

  it("adds predicate for frequencies", () => {
    const f = withFilter({ frequencies: ["monthly"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("adds predicate for payment methods", () => {
    const f = withFilter({ paymentMethods: ["Cash"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("adds predicate for academic years", () => {
    const f = withFilter({ academicYears: ["2025-26"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("adds predicate for sections", () => {
    const f = withFilter({ sections: ["A"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
  });

  it("combines all filters into AND", () => {
    const f = withFilter({
      search: "Alice",
      statuses: ["Paid"],
      classes: ["8A"],
      dueDateFrom: "2025-01-01",
    });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(4);
  });
});

// ── filtersRequirePaymentJoin ─────────────────────────────────────────────────

describe("filtersRequirePaymentJoin", () => {
  it("returns false for empty filters", () => {
    expect(filtersRequirePaymentJoin(emptyLedgerFilters())).toBe(false);
  });

  it("returns true when paymentMethods is active", () => {
    const f = withFilter({ paymentMethods: ["Cash"] });
    expect(filtersRequirePaymentJoin(f)).toBe(true);
  });

  it("returns true when referenceNumbers is active", () => {
    const f = withFilter({ referenceNumbers: ["REF-001"] });
    expect(filtersRequirePaymentJoin(f)).toBe(true);
  });

  it("returns false when only non-payment filters are active", () => {
    const f = withFilter({ statuses: ["Paid"], classes: ["8A"] });
    expect(filtersRequirePaymentJoin(f)).toBe(false);
  });
});

describe("buildLedgerInvoiceSessionPredicate", () => {
  it("scopes transaction reports by the invoice session, not payment session", () => {
    const predicate = buildLedgerInvoiceSessionPredicate(42);
    expect(predicate).not.toBeNull();
    const { text, params } = render(predicate!);
    expect(text).toContain("fr.session_id");
    expect(text).not.toContain("pr.session_id");
    expect(params).toEqual([42]);
  });

  it("returns no predicate when there is no session scope", () => {
    expect(buildLedgerInvoiceSessionPredicate(null)).toBeNull();
  });
});

describe("buildLedgerPaymentDatePredicate", () => {
  it("uses a tenant-bound EXISTS over authoritative payment received dates", () => {
    const predicate = buildLedgerPaymentDatePredicate(
      withFilter({ paidDateFrom: "2026-08-22", paidDateTo: "2026-08-22" }),
      { schoolId: sql`fr.school_id`, feeRecordId: sql`fr.id` },
    );

    expect(predicate).not.toBeNull();
    const { text, params } = render(predicate!);
    expect(text.toUpperCase()).toContain("EXISTS");
    expect(text).toContain("payment_records");
    expect(text).toContain("ledger_paid_pr.school_id = fr.school_id");
    expect(text).toContain("ledger_paid_pr.fee_record_id = fr.id");
    expect(text).toContain("ledger_paid_pr.received_date");
    expect(text).not.toContain("fr.paid_date");
    expect(params).toEqual(["2026-08-22", "2026-08-22"]);
  });

  it("returns no predicate when paid-date bounds are empty", () => {
    expect(
      buildLedgerPaymentDatePredicate(emptyLedgerFilters(), {
        schoolId: sql`fr.school_id`,
        feeRecordId: sql`fr.id`,
      }),
    ).toBeNull();
  });
});

// ── text/ID columns use case-insensitive partial contains (ILIKE %v%) ───────────

describe("text/ID columns contains behavior", () => {
  const textFields: Array<[keyof LedgerFilters, string]> = [
    ["invoiceNumbers", "INV"],
    ["receiptNumbers", "ON"],
    ["studentNames", "Ali"],
    ["dsids", "DSID"],
    ["referenceNumbers", "REF"],
  ];

  for (const [field, value] of textFields) {
    it(`uses ILIKE %value% for ${String(field)}`, () => {
      const f = withFilter({ [field]: [value] } as Partial<LedgerFilters>);
      const preds = buildLedgerFilterPredicates(f, FIELDS);
      expect(preds).toHaveLength(1);
      const { text, params } = render(preds[0]!);
      expect(text.toUpperCase()).toContain("ILIKE");
      expect(params).toContain(`%${value}%`);
    });
  }

  it("ORs multiple values within a single text field", () => {
    const f = withFilter({ invoiceNumbers: ["INV-1", "INV-2"] });
    const preds = buildLedgerFilterPredicates(f, FIELDS);
    expect(preds).toHaveLength(1);
    const { text, params } = render(preds[0]!);
    expect(text.toUpperCase()).toContain(" OR ");
    expect(params).toContain("%INV-1%");
    expect(params).toContain("%INV-2%");
  });

  it("treats LIKE metacharacters literally in text and global-search filters", () => {
    const value = String.raw`INV_50%\draft`;
    const escaped = String.raw`%INV\_50\%\\draft%`;

    const textPredicate = buildLedgerFilterPredicates(
      withFilter({ invoiceNumbers: [value] }),
      FIELDS,
    )[0]!;
    const globalPredicate = buildLedgerFilterPredicates(
      withFilter({ search: value }),
      FIELDS,
    )[0]!;

    expect(render(textPredicate).params).toContain(escaped);
    expect(render(textPredicate).text.toUpperCase()).toContain("ESCAPE");
    expect(render(globalPredicate).params).toContain(escaped);
    expect(render(globalPredicate).text.toUpperCase()).toContain("ESCAPE");
  });

  it("does not use exact equality for ID columns anymore", () => {
    const f = withFilter({ dsids: ["DSID-001"] });
    const { text } = render(buildLedgerFilterPredicates(f, FIELDS)[0]!);
    expect(text.toUpperCase()).toContain("ILIKE");
    // no "= ANY(ARRAY" nor bare "=" equality for a single value
    expect(text.toUpperCase()).not.toContain("= ANY");
  });
});
