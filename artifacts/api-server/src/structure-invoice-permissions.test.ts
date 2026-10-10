import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { feeRecords } from "@workspace/db/schema";
import {
  InvoiceGenerationError,
  buildInvoiceDuplicateIndex,
  createStructureInvoice,
  prepareStructureInvoiceContext,
} from "./structure-invoice-service";
import { storage } from "./storage";

test("bulk generation context stays in the caller's school and requires its active session", async (t) => {
  const lookups: Array<[number, number]> = [];
  const activeSessionLookups: number[] = [];
  const target = storage as any;
  const replacements: Array<{ name: string; hadOwn: boolean; original: unknown }> = [];
  const replaceStorage = (name: string, implementation: (...args: any[]) => any) => {
    replacements.push({
      name,
      hadOwn: Object.prototype.hasOwnProperty.call(target, name),
      original: target[name],
    });
    target[name] = implementation;
  };

  replaceStorage("getFeeStructureById", async (structureId: number, schoolId: number) => {
    lookups.push([structureId, schoolId]);
    return structureId === 22 && schoolId === 2
      ? { id: structureId, schoolId } as any
      : null;
  });
  replaceStorage("getActiveSession", async (schoolId: number) => {
    activeSessionLookups.push(schoolId);
    return undefined;
  });

  t.after(() => {
    for (const { name, hadOwn, original } of replacements.reverse()) {
      if (hadOwn) target[name] = original;
      else delete target[name];
    }
  });

  await assert.rejects(
    prepareStructureInvoiceContext({ schoolId: 1, structureId: 22 }),
    error => error instanceof InvoiceGenerationError && error.statusCode === 404,
  );
  assert.deepEqual(lookups, [[22, 1]]);
  assert.deepEqual(activeSessionLookups, []);

  await assert.rejects(
    prepareStructureInvoiceContext({ schoolId: 2, structureId: 22 }),
    error => error instanceof InvoiceGenerationError && error.statusCode === 400,
  );
  assert.deepEqual(lookups, [[22, 1], [22, 2]]);
  assert.deepEqual(activeSessionLookups, [2]);
});

test("structure-generated invoices persist their exact source structure ID", async (t) => {
  const target = storage as any;
  const hadOwn = Object.prototype.hasOwnProperty.call(target, "createInvoiceFeeRecordIfAbsent");
  const original = target.createInvoiceFeeRecordIfAbsent;
  let inserted: any;
  target.createInvoiceFeeRecordIfAbsent = async ({ data }: any) => {
    inserted = data;
    return { created: true, record: { id: 91, ...data } };
  };
  t.after(() => {
    if (hadOwn) target.createInvoiceFeeRecordIfAbsent = original;
    else delete target.createInvoiceFeeRecordIfAbsent;
  });

  const context = {
    schoolId: 4,
    feeStructureId: 61,
    structure: {
      id: 61, schoolId: 4, name: "Tuition", feeType: "Tuition",
      amount: 1000, frequency: "annual", lateFeeConfig: null,
    },
    session: { id: 12, sessionName: "2026–27" },
    periodStart: "2026-04-01",
    periodEnd: "2027-03-31",
    dueDate: "2026-04-30",
    breakdownSnapshot: [{ name: "Tuition", purpose: "", amount: 1000 }],
  } as any;

  await createStructureInvoice({
    context,
    studentId: 33,
    duplicateIndex: buildInvoiceDuplicateIndex([]),
  });
  assert.equal(inserted.feeStructureId, 61);

  const query = new PgDialect().sqlToQuery(new PgDialect().buildInsertQuery({
    table: feeRecords,
    values: [{ feeStructureId: inserted.feeStructureId }],
  }));
  assert.match(query.sql, /fee_structure_id/);
  assert.ok(query.params.includes(61));
});

test("structure invoice generation rejects a stored component total mismatch", async (t) => {
  const target = storage as any;
  const names = ["getFeeStructureById", "getActiveSession"];
  const originals = names.map(name => ({
    name,
    hadOwn: Object.prototype.hasOwnProperty.call(target, name),
    original: target[name],
  }));
  target.getFeeStructureById = async (structureId: number, schoolId: number) => ({
    id: structureId,
    schoolId,
    name: "Tuition",
    feeType: "Tuition",
    amount: 1000,
    frequency: "annual",
    dueDayOfMonth: 15,
    breakdown: [{ name: "Tuition", purpose: "", amount: 900 }],
    lateFeeConfig: null,
  });
  target.getActiveSession = async () => ({
    id: 12,
    sessionName: "2026-2027",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
  });
  t.after(() => {
    for (const { name, hadOwn, original } of originals.reverse()) {
      if (hadOwn) target[name] = original;
      else delete target[name];
    }
  });

  await assert.rejects(
    prepareStructureInvoiceContext({ schoolId: 4, structureId: 61 }),
    error => error instanceof InvoiceGenerationError && /must match/.test(error.message),
  );
});
