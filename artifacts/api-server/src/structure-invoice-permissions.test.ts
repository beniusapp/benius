import assert from "node:assert/strict";
import test from "node:test";
import { InvoiceGenerationError, prepareStructureInvoiceContext } from "./structure-invoice-service";
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
