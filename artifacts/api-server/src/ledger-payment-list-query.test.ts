import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { feeRecords, paymentRecords } from "@workspace/db";
import {
  buildLedgerPaymentInvoiceJoin,
  buildLedgerPaymentSessionScope,
  mapLedgerPaymentListRow,
} from "./ledger-payment-list-query";

const dialect = new PgDialect();

test("Ledger invoice join verifies ID, authenticated school, and Student ownership", () => {
  const query = dialect.sqlToQuery(buildLedgerPaymentInvoiceJoin());
  const normalized = query.sql.replace(/"/g, "").replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /payment_records\.fee_record_id = fee_records\.id/);
  assert.match(normalized, /payment_records\.school_id = fee_records\.school_id/);
  assert.match(normalized, /payment_records\.student_id = fee_records\.student_id/);
  assert.equal(query.params.length, 0);
});

test("selected-session predicate preserves payment session and allows only NULL fallback via invoice", () => {
  const query = dialect.sqlToQuery(buildLedgerPaymentSessionScope(202));
  const normalized = query.sql.replace(/"/g, "").replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /payment_records\.session_id = \$1/);
  assert.match(
    normalized,
    /payment_records\.session_id is null and fee_records\.session_id = \$2/,
  );
  assert.deepEqual(query.params, [202, 202]);
});

test("conflicting non-NULL sessions do not receive invoice-session fallback", () => {
  const query = dialect.sqlToQuery(buildLedgerPaymentSessionScope(202));
  const normalized = query.sql.replace(/"/g, "").replace(/\s+/g, " ").toLowerCase();

  // A non-NULL payment must match the selected session itself. Invoice session
  // is consulted only inside the branch that explicitly requires NULL.
  assert.match(normalized, /^\(payment_records\.session_id = \$1 or \(payment_records\.session_id is null and fee_records\.session_id = \$2\)\)$/);
  assert.equal(query.params[0], 202);
  assert.equal(query.params[1], 202);
});

test("invalid or missing invoice joins expose neither invoice number nor invoice ID", () => {
  const payment = {
    id: 11,
    schoolId: 1,
    sessionId: null,
    feeRecordId: 901,
    studentId: 7,
    paymentMethod: "Cash",
    referenceNumber: null,
    receivedDate: "2026-05-01",
    amount: 5000,
  };

  const crossSchoolOrStudentLink = mapLedgerPaymentListRow({
    payment_records: payment,
    fee_records: null,
  });
  assert.equal(crossSchoolOrStudentLink.feeRecordId, null);
  assert.equal(crossSchoolOrStudentLink.invoiceNumber, null);
  assert.equal(payment.feeRecordId, 901, "the stored payment object is not mutated");
});

test("verified invoice keeps the existing response fields and invoice number", () => {
  const payment = {
    id: 12,
    schoolId: 1,
    sessionId: null,
    feeRecordId: 902,
    studentId: 7,
    paymentMethod: "Cash",
    referenceNumber: "ref-1",
    receivedDate: "2026-05-01",
    amount: 5000,
  };
  const invoice = {
    id: 902,
    schoolId: 1,
    studentId: 7,
    sessionId: 202,
    invoiceNumber: "INV-0902",
  };

  const row = mapLedgerPaymentListRow({
    payment_records: payment,
    fee_records: invoice,
  });
  assert.equal(row.feeRecordId, 902);
  assert.equal(row.invoiceNumber, "INV-0902");
  assert.equal(row.amount, 5000);
  assert.equal(row.paymentMethod, "Cash");
  assert.equal(row.receivedDate, "2026-05-01");
});
