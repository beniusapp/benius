import assert from "node:assert/strict";
import test from "node:test";
import { academicSessions, enrollments, promotionDecisions, schoolMetadata } from "@workspace/db";
import { db } from "./db";
import { storage } from "./storage";

test("Web readiness projection is read-only and includes active Students without ledger decisions as Pending", async t => {
  const originalTransaction = (db as any).transaction;
  const originalGetLedgerStatus = storage.getLedgerStatus;
  let readOnlyTransactions = 0;
  const ledgerCalls: Array<[number, string, number]> = [];

  const baseRow = {
    class: "5",
    section: "A",
    term: "Term 2",
    status: "none" as const,
    totalStudents: 0,
    lockedCount: 0,
    manualInterventionCount: 0,
    teacherName: null,
    teacherId: null,
    lockedAt: null,
    adminExecuted: false,
    executedCount: 0,
    readyCount: 0,
    pendingCount: 0,
  };
  storage.getLedgerStatus = async (schoolId, term, sessionId) => {
    ledgerCalls.push([schoolId, term, sessionId]);
    return [baseRow];
  };

  const rowsFor = (table: unknown) => {
    if (table === academicSessions) return [{ id: 41, schoolId: 11, isActive: true }];
    if (table === promotionDecisions) return [];
    if (table === enrollments) return [
      { studentId: 101, className: "5", sectionName: "A" },
      { studentId: 102, className: "5", sectionName: "A" },
    ];
    if (table === schoolMetadata) return [
      { metaKey: "classes", metaValue: '["5","6"]' },
      { metaKey: "class_sections", metaValue: '{"5":["A"],"6":["A"]}' },
    ];
    return [];
  };
  const tx = {
    execute: async () => { readOnlyTransactions++; return {}; },
    select: () => {
      let table: unknown;
      const query: any = {
        from(value: unknown) { table = value; return query; },
        innerJoin() { return query; },
        where() { return query; },
        orderBy() { return query; },
        for() { return query; },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve(rowsFor(table)).then(resolve, reject);
        },
      };
      return query;
    },
  };
  (db as any).transaction = async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx);
  t.after(() => {
    (db as any).transaction = originalTransaction;
    storage.getLedgerStatus = originalGetLedgerStatus;
  });

  const result = await storage.getPromotionLedgerReadinessStatus(11, "Term 2", 41);
  assert.deepEqual(ledgerCalls, [[11, "Term 2", 41]]);
  assert.equal(readOnlyTransactions, 1);
  assert.equal(result[0].status, "draft");
  assert.equal(result[0].totalStudents, 2);
  assert.equal(result[0].readyCount, 0);
  assert.equal(result[0].pendingCount, 2);
  assert.deepEqual(result[0].pendingStudentIds, [101, 102]);
  assert.deepEqual(result[0].readyStudentIds, []);
});
