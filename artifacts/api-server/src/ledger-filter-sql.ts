/**
 * server/ledger-filter-sql.ts
 *
 * Reusable Drizzle SQL predicate builder for the fee ledger.
 */
import { expandPaymentMethodFilter } from "@shared/payment-method";
/**
 *
 * Accepts a LedgerFilters object and a mapping of logical field names to the
 * SQL column expressions used in the specific query. Returns a Drizzle SQL
 * fragment that can be appended to a WHERE clause via `AND`.
 *
 * Rules:
 *  - Multiple values within a single field → OR / ANY (union semantics).
 *  - Different fields combine with AND (intersection semantics).
 *  - Global search matches invoice_number, receipt_number, student name, DSID
 *    with case-insensitive ILIKE. It does NOT match fee name/type (per spec).
 *  - Fee-period values are encoded "start|end" and matched as
 *    (col_start = start AND col_end = end) ORed across selected periods.
 *  - All values are parameterized — no raw user SQL is injected.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  type LedgerFilters,
  decodeFeePeriod,
} from "@shared/ledger-filters";

// ── Field expression map ───────────────────────────────────────────────────────

/**
 * Maps each logical filter key to the SQL expression that represents it in a
 * particular query. All expressions should already be valid SQL (column
 * references, COALESCE, etc.) without parameters.
 *
 * Required fields for global search: invoiceNumber, receiptNumber,
 * studentName, dsid.
 */
export interface LedgerFilterFields {
  /** e.g. sql`fr.invoice_number` */
  invoiceNumber: SQL;
  /** e.g. sql`fr.receipt_number` */
  receiptNumber: SQL;
  /** e.g. sql`s.name` */
  studentName: SQL;
  /** e.g. sql`s.digital_student_id` */
  dsid: SQL;
  /** e.g. sql`s.class` */
  class?: SQL;
  /** e.g. sql`s.section` */
  section?: SQL;
  /** e.g. sql`COALESCE(fr.fee_name, fs.name, fr.fee_type)` */
  feeName?: SQL;
  /** e.g. sql`fr.fee_type` */
  feeType?: SQL;
  /** fee period start/end columns e.g. [sql`fr.fee_period_start`, sql`fr.fee_period_end`] */
  feePeriodStartEnd?: [SQL, SQL];
  /** e.g. sql`fr.frequency` */
  frequency?: SQL;
  /** e.g. sql`fr.status` */
  status?: SQL;
  /** e.g. sql`ledger_payment.raw_payment_method` */
  paymentMethod?: SQL;
  /** e.g. sql`fr.academic_year` */
  academicYear?: SQL;
  /** e.g. sql`fr.amount` */
  amount?: SQL;
  /** e.g. sql`fr.due_date` */
  dueDate?: SQL;
  /** e.g. sql`fr.paid_date` */
  paidDate?: SQL;
  /** e.g. sql`p.last_reference` */
  referenceNumber?: SQL;
}

export interface LedgerPaymentDateFields {
  schoolId: SQL;
  feeRecordId: SQL;
}

/**
 * Authoritative successful-payment calendar filter.
 *
 * fee_records.paid_date is only an invoice-level projection and historical
 * online captures could write the prior UTC calendar day there. A Ledger
 * invoice therefore matches a paid-date range when ANY persisted
 * payment_records.received_date for that tenant/invoice is inside the range.
 */
export function buildLedgerPaymentDatePredicate(
  filters: LedgerFilters,
  fields: LedgerPaymentDateFields,
): SQL | null {
  const bounds: SQL[] = [];
  if (filters.paidDateFrom) {
    bounds.push(sql`ledger_paid_pr.received_date >= ${filters.paidDateFrom}`);
  }
  if (filters.paidDateTo) {
    bounds.push(sql`ledger_paid_pr.received_date <= ${filters.paidDateTo}`);
  }
  if (bounds.length === 0) return null;

  return sql`EXISTS (
    SELECT 1
    FROM payment_records ledger_paid_pr
    WHERE ledger_paid_pr.school_id = ${fields.schoolId}
      AND ledger_paid_pr.fee_record_id = ${fields.feeRecordId}
      AND ${sql.join(bounds, sql` AND `)}
  )`;
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Build an array of SQL predicates from a normalized LedgerFilters object.
 *
 * Each predicate is a self-contained SQL expression. The caller combines them
 * with AND (e.g. using `sql.join(predicates, sql` AND `)`).
 *
 * Returns an empty array when no filters are active — caller can skip the
 * AND block entirely.
 */
export function buildLedgerFilterPredicates(
  filters: LedgerFilters,
  fields: LedgerFilterFields,
): SQL[] {
  const predicates: SQL[] = [];

  // ── Global search (invoice, receipt, student name, DSID only) ────────────
  if (filters.search.trim()) {
    const pat = `%${escapeLikePattern(filters.search.trim())}%`;
    predicates.push(sql`(
      ${fields.invoiceNumber} ILIKE ${pat} ESCAPE '\\'
      OR ${fields.receiptNumber} ILIKE ${pat} ESCAPE '\\'
      OR ${fields.studentName} ILIKE ${pat} ESCAPE '\\'
      OR ${fields.dsid} ILIKE ${pat} ESCAPE '\\'
    )`);
  }

  // ── Invoice numbers (ILIKE partial contains, OR) ─────────────────────────
  if (filters.invoiceNumbers.length) {
    predicates.push(buildContainsOr(fields.invoiceNumber, filters.invoiceNumbers));
  }

  // ── Receipt numbers (ILIKE partial contains, OR) ─────────────────────────
  if (filters.receiptNumbers.length) {
    predicates.push(buildContainsOr(fields.receiptNumber, filters.receiptNumbers));
  }

  // ── Student names (ILIKE partial contains, OR) ───────────────────────────
  if (filters.studentNames.length) {
    predicates.push(buildContainsOr(fields.studentName, filters.studentNames));
  }

  // ── DSIDs (ILIKE partial contains, OR) ───────────────────────────────────
  if (filters.dsids.length) {
    predicates.push(buildContainsOr(fields.dsid, filters.dsids));
  }

  // ── Reference numbers (ILIKE partial contains, OR) ───────────────────────
  if (filters.referenceNumbers.length && fields.referenceNumber) {
    predicates.push(buildContainsOr(fields.referenceNumber, filters.referenceNumbers));
  }

  // ── Class (exact, OR) ────────────────────────────────────────────────────
  if (filters.classes.length && fields.class) {
    if (filters.classes.length === 1) {
      predicates.push(sql`${fields.class} = ${filters.classes[0]}`);
    } else {
      predicates.push(buildAnyOf(fields.class, filters.classes));
    }
  }

  // ── Section (exact, OR) ──────────────────────────────────────────────────
  if (filters.sections.length && fields.section) {
    if (filters.sections.length === 1) {
      predicates.push(sql`${fields.section} = ${filters.sections[0]}`);
    } else {
      predicates.push(buildAnyOf(fields.section, filters.sections));
    }
  }

  // ── Fee name (exact, OR) ─────────────────────────────────────────────────
  if (filters.feeNames.length && fields.feeName) {
    if (filters.feeNames.length === 1) {
      predicates.push(sql`${fields.feeName} = ${filters.feeNames[0]}`);
    } else {
      predicates.push(buildAnyOf(fields.feeName, filters.feeNames));
    }
  }

  // ── Fee type (exact, OR) ─────────────────────────────────────────────────
  if (filters.feeTypes.length && fields.feeType) {
    if (filters.feeTypes.length === 1) {
      predicates.push(sql`${fields.feeType} = ${filters.feeTypes[0]}`);
    } else {
      predicates.push(buildAnyOf(fields.feeType, filters.feeTypes));
    }
  }

  // ── Fee periods (start|end encoded, OR) ──────────────────────────────────
  if (filters.feePeriods.length && fields.feePeriodStartEnd) {
    const [startCol, endCol] = fields.feePeriodStartEnd;
    const periodClauses: SQL[] = [];
    for (const encoded of filters.feePeriods) {
      const decoded = decodeFeePeriod(encoded);
      if (decoded) {
        periodClauses.push(
          sql`(${startCol} = ${decoded.start} AND ${endCol} = ${decoded.end})`,
        );
      }
    }
    if (periodClauses.length) {
      predicates.push(joinOr(periodClauses));
    }
  }

  // ── Frequency (exact, OR) ────────────────────────────────────────────────
  if (filters.frequencies.length && fields.frequency) {
    if (filters.frequencies.length === 1) {
      predicates.push(sql`${fields.frequency} = ${filters.frequencies[0]}`);
    } else {
      predicates.push(buildAnyOf(fields.frequency, filters.frequencies));
    }
  }

  // ── Status (exact, OR) ───────────────────────────────────────────────────
  if (filters.statuses.length && fields.status) {
    if (filters.statuses.length === 1) {
      predicates.push(sql`${fields.status} = ${filters.statuses[0]}`);
    } else {
      predicates.push(buildAnyOf(fields.status, filters.statuses));
    }
  }

  // ── Payment method (exact, OR) ───────────────────────────────────────────
  // expandPaymentMethodFilter ensures that filtering for "Portal Payment" also
  // matches any legacy "Online" rows still present in the DB, and vice-versa.
  if (filters.paymentMethods.length && fields.paymentMethod) {
    const expanded = expandPaymentMethodFilter(filters.paymentMethods);
    if (expanded.length === 1) {
      predicates.push(sql`${fields.paymentMethod} = ${expanded[0]}`);
    } else {
      predicates.push(buildAnyOf(fields.paymentMethod, expanded));
    }
  }

  // ── Academic year (exact, OR) ────────────────────────────────────────────
  if (filters.academicYears.length && fields.academicYear) {
    if (filters.academicYears.length === 1) {
      predicates.push(sql`${fields.academicYear} = ${filters.academicYears[0]}`);
    } else {
      predicates.push(buildAnyOf(fields.academicYear, filters.academicYears));
    }
  }

  // ── Amount range ─────────────────────────────────────────────────────────
  if (filters.amountMin != null && fields.amount) {
    predicates.push(sql`${fields.amount} >= ${filters.amountMin}`);
  }
  if (filters.amountMax != null && fields.amount) {
    predicates.push(sql`${fields.amount} <= ${filters.amountMax}`);
  }

  // ── Due date range ───────────────────────────────────────────────────────
  if (filters.dueDateFrom && fields.dueDate) {
    predicates.push(sql`${fields.dueDate} >= ${filters.dueDateFrom}`);
  }
  if (filters.dueDateTo && fields.dueDate) {
    predicates.push(sql`${fields.dueDate} <= ${filters.dueDateTo}`);
  }

  // ── Paid date range ──────────────────────────────────────────────────────
  if (filters.paidDateFrom && fields.paidDate) {
    predicates.push(sql`${fields.paidDate} >= ${filters.paidDateFrom}`);
  }
  if (filters.paidDateTo && fields.paidDate) {
    predicates.push(sql`${fields.paidDate} <= ${filters.paidDateTo}`);
  }

  return predicates;
}

// ── Utility: needs payment join? ──────────────────────────────────────────────

/**
 * Returns true when the filters require a payment-record join to evaluate
 * (payment method or reference number filter active).
 */
export function filtersRequirePaymentJoin(filters: LedgerFilters): boolean {
  return filters.paymentMethods.length > 0 || filters.referenceNumbers.length > 0;
}

/**
 * Transaction reports inherit the Ledger's invoice population. Session scope
 * therefore belongs to fee_records, not to each payment row's historical stamp.
 */
export function buildLedgerInvoiceSessionPredicate(sessionId: number | null): SQL | null {
  return sessionId == null ? null : sql`fr.session_id = ${sessionId}`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Build col = ANY(ARRAY[v1, v2, ...]) for uniform-type text arrays. */
function buildAnyOf(col: SQL, values: string[]): SQL {
  // We build a parameterized ARRAY[...] using individual parameters.
  // Drizzle's sql tag can accept arrays if we build it incrementally.
  const parts: SQL[] = [col, sql` = ANY(ARRAY[`];
  values.forEach((v, i) => {
    parts.push(sql`${v}`);
    if (i < values.length - 1) parts.push(sql`, `);
  });
  parts.push(sql`])`);
  return sql.join(parts, sql``);
}

/** Join multiple predicates with OR, wrapping in parens. */
function joinOr(clauses: SQL[]): SQL {
  if (clauses.length === 1) return clauses[0]!;
  return sql`(${sql.join(clauses, sql` OR `)})`;
}

/**
 * Build a case-insensitive partial "contains" predicate: for each value,
 * `col ILIKE %value%`, ORed together. Used for text/ID columns.
 */
function buildContainsOr(col: SQL, values: string[]): SQL {
  const clauses = values.map((v) =>
    sql`${col} ILIKE ${"%" + escapeLikePattern(v) + "%"} ESCAPE '\\'`,
  );
  return joinOr(clauses);
}

/** Escape LIKE metacharacters so "contains" treats user input literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
