import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { feeRecords, feeStructures } from "@workspace/db/schema";
import { feeStructureInvoiceMutationWhere } from "./fee-structure-mutation-sql";
import { calculateLateFee } from "./late-fee-engine";

const dialect = new PgDialect();
const scope = { schoolId: 17, activeSessionId: 29, feeStructureId: 43 };

test("same-type structures compile to an exact source-ID guard, not feeType ownership", () => {
  const structureA = dialect.sqlToQuery(feeStructureInvoiceMutationWhere(scope));
  const structureB = dialect.sqlToQuery(feeStructureInvoiceMutationWhere({ ...scope, feeStructureId: 44 }));
  assert.match(structureA.sql, /fee_structure_id/);
  assert.doesNotMatch(structureA.sql, /fee_type/);
  assert.notDeepEqual(structureA.params, structureB.params);
});

test("class-narrowing delete guard uses the same exact source, school and active-session scope", () => {
  const query = dialect.sqlToQuery(feeStructureInvoiceMutationWhere(scope));
  assert.match(query.sql, /school_id/);
  assert.match(query.sql, /session_id/);
  assert.match(query.sql, /fee_structure_id/);
  assert.deepEqual(query.params.slice(0, 3), [17, 29, 43]);
});

test("unlinked legacy invoices cannot satisfy the linked-source mutation predicate", () => {
  const query = dialect.sqlToQuery(feeStructureInvoiceMutationWhere(scope));
  assert.match(query.sql, /fee_structure_id/);
  assert.ok(query.params.includes(43));
});

test("cross-school and archived-session invoice rows are excluded by exact scope parameters", () => {
  const query = dialect.sqlToQuery(feeStructureInvoiceMutationWhere(scope));
  assert.deepEqual(query.params.slice(0, 2), [scope.schoolId, scope.activeSessionId]);
  assert.match(query.sql, /academic_sessions/);
  assert.match(query.sql, /is_active/);
});

test("paid statuses are excluded while the existing Due/Overdue eligibility is retained", () => {
  const query = dialect.sqlToQuery(feeStructureInvoiceMutationWhere(scope));
  assert.match(query.sql, /status/);
  assert.deepEqual(query.params.filter(value => value === "Due" || value === "Overdue"), ["Due", "Overdue"]);
  assert.doesNotMatch(query.sql, /status.*Paid/);
});

test("payment history is excluded by an explicit correlated NOT EXISTS predicate", () => {
  const query = dialect.sqlToQuery(feeStructureInvoiceMutationWhere(scope));
  assert.match(query.sql, /NOT EXISTS/);
  assert.match(query.sql, /payment_records/);
  assert.match(query.sql, /fee_record_id/);
});

test("fee-record source ID has no FK that could erase history when a structure is deleted", () => {
  const foreignKeys = getTableConfig(feeRecords).foreignKeys;
  assert.ok(foreignKeys.every(foreignKey => foreignKey.reference().foreignTable !== feeStructures));
});

test("late-fee calculation keeps the existing daily formula and grace-period behavior", () => {
  assert.equal(calculateLateFee({
    enabled: true,
    type: "DAILY",
    grace_period_days: 1,
    daily_rate: 10,
    flat_amount: 0,
    max_cap: 0,
    tiered_slabs: [],
  }, "2026-10-07", "Due", new Date("2026-10-10T12:00:00.000Z")), 20);
});
