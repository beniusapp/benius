import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildLedgerPdfAuthorizedWhere } from "./ledger-pdf-selection-sql";

const dialect = new PgDialect();

test("explicit Ledger PDF scope binds school and session before active filters and IDs", () => {
  const where = buildLedgerPdfAuthorizedWhere({
    schoolId: 71,
    sessionId: 202,
    filterPredicates: [
      sql`historical_placement.class_name = ${"Class 7"}`,
      sql`fr.status = ${"Due"}`,
    ],
    selectAllMatching: false,
    selectedIdsArray: sql`${sql.param([12, 24])}::int[]`,
    excludedIdsArray: null,
  });
  const query = dialect.sqlToQuery(where);
  const normalized = query.sql.replace(/\s+/g, " ");

  assert.match(normalized, /fr\.school_id = \$1 AND fr\.session_id = \$2/);
  assert.match(normalized, /historical_placement\.class_name = \$3/);
  assert.match(normalized, /fr\.status = \$4/);
  assert.match(normalized, /fr\.id = ANY\(\$5::int\[\]\)/);
  assert.deepEqual(query.params, [71, 202, "Class 7", "Due", [12, 24]]);
});

test("select-all exclusions are applied only inside the same school/session/filter scope", () => {
  const where = buildLedgerPdfAuthorizedWhere({
    schoolId: 71,
    sessionId: 303,
    filterPredicates: [sql`fr.status = ${"Paid"}`],
    selectAllMatching: true,
    selectedIdsArray: null,
    excludedIdsArray: sql`${sql.param([48])}::int[]`,
  });
  const query = dialect.sqlToQuery(where);
  const normalized = query.sql.replace(/\s+/g, " ");

  assert.match(normalized, /fr\.school_id = \$1 AND fr\.session_id = \$2/);
  assert.match(normalized, /fr\.status = \$3/);
  assert.match(normalized, /fr\.id != ALL\(\$4::int\[\]\)/);
  assert.doesNotMatch(normalized, /fr\.id = ANY/);
  assert.deepEqual(query.params, [71, 303, "Paid", [48]]);
});

test("an explicit selection without an ID predicate fails closed instead of exporting every match", () => {
  const where = buildLedgerPdfAuthorizedWhere({
    schoolId: 71,
    sessionId: 202,
    filterPredicates: [],
    selectAllMatching: false,
    selectedIdsArray: null,
    excludedIdsArray: null,
  });
  const normalized = dialect.sqlToQuery(where).sql.replace(/\s+/g, " ");

  assert.match(normalized, /fr\.school_id = \$1 AND fr\.session_id = \$2/);
  assert.match(normalized, /AND FALSE/);
  assert.doesNotMatch(normalized, /fr\.id = ANY/);
});
