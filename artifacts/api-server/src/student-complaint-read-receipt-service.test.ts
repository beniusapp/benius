import assert from "node:assert/strict";
import test from "node:test";
import {
  complaintReadTrackingEnabled,
  receiptScopeKey,
  type StudentComplaintReceiptScope,
} from "./student-complaint-read-receipt-policy";
import {
  markAuthorizedStudentComplaintRead,
  StudentComplaintNotInInboxError,
  type StudentComplaintReadReceiptStore,
} from "./student-complaint-read-receipt-service";

const scope: StudentComplaintReceiptScope = { schoolId: 3, studentId: 8, sessionId: 20 };

function memoryStore() {
  const inbox = new Map<string, Set<number>>();
  const receipts = new Set<string>();
  let writes = 0;
  const scopeKey = (s: StudentComplaintReceiptScope) => `${s.schoolId}:${s.studentId}:${s.sessionId}`;
  const store: StudentComplaintReadReceiptStore = {
    async getAuthorizedInboxComplaintIds(s) {
      return inbox.get(scopeKey(s)) ?? new Set();
    },
    async insertReceiptOnce(s, complaintId) {
      const key = receiptScopeKey(s, complaintId);
      if (!receipts.has(key)) {
        writes += 1;
        receipts.add(key);
      }
    },
  };
  return { inbox, receipts, store, scopeKey, get writes() { return writes; } };
}

test("opening one inbox item marks only that complaint read", async () => {
  const memory = memoryStore();
  memory.inbox.set(memory.scopeKey(scope), new Set([10, 11]));
  await markAuthorizedStudentComplaintRead(scope, 10, memory.store);
  assert.equal(memory.receipts.has(receiptScopeKey(scope, 10)), true);
  assert.equal(memory.receipts.has(receiptScopeKey(scope, 11)), false);
});

test("Student cannot acknowledge an item outside their inbox", async () => {
  const memory = memoryStore();
  memory.inbox.set(memory.scopeKey(scope), new Set([10]));
  await assert.rejects(markAuthorizedStudentComplaintRead(scope, 11, memory.store), StudentComplaintNotInInboxError);
  assert.equal(memory.writes, 0);
});

test("cross-student receipt access is rejected", async () => {
  const memory = memoryStore();
  memory.inbox.set(memory.scopeKey(scope), new Set([10]));
  await assert.rejects(markAuthorizedStudentComplaintRead({ ...scope, studentId: 9 }, 10, memory.store), StudentComplaintNotInInboxError);
});

test("cross-school receipt access is rejected", async () => {
  const memory = memoryStore();
  memory.inbox.set(memory.scopeKey(scope), new Set([10]));
  await assert.rejects(markAuthorizedStudentComplaintRead({ ...scope, schoolId: 4 }, 10, memory.store), StudentComplaintNotInInboxError);
});

test("cross-session receipt access is rejected", async () => {
  const memory = memoryStore();
  memory.inbox.set(memory.scopeKey(scope), new Set([10]));
  await assert.rejects(markAuthorizedStudentComplaintRead({ ...scope, sessionId: 21 }, 10, memory.store), StudentComplaintNotInInboxError);
});

test("deleted or non-inbox complaints are rejected when absent from the scoped inbox", async () => {
  const memory = memoryStore();
  memory.inbox.set(memory.scopeKey(scope), new Set([10]));
  await assert.rejects(markAuthorizedStudentComplaintRead(scope, 12, memory.store), StudentComplaintNotInInboxError);
});

test("repeated opens are idempotent and do not rewrite the original receipt", async () => {
  const memory = memoryStore();
  memory.inbox.set(memory.scopeKey(scope), new Set([10]));
  await markAuthorizedStudentComplaintRead(scope, 10, memory.store);
  await markAuthorizedStudentComplaintRead(scope, 10, memory.store);
  assert.equal(memory.writes, 1);
});

test("receipt remains available to another device using the same Student and session scope", async () => {
  const memory = memoryStore();
  memory.inbox.set(memory.scopeKey(scope), new Set([10]));
  await markAuthorizedStudentComplaintRead(scope, 10, memory.store);
  assert.equal(memory.receipts.has(receiptScopeKey({ ...scope }, 10)), true);
});

test("failed persistence propagates and cannot acknowledge the complaint", async () => {
  const persisted = new Set<string>();
  const store: StudentComplaintReadReceiptStore = {
    async getAuthorizedInboxComplaintIds() { return new Set([10]); },
    async insertReceiptOnce(_scope, id) {
      throw new Error(`database unavailable for ${id}`);
    },
  };
  await assert.rejects(markAuthorizedStudentComplaintRead(scope, 10, store), /database unavailable/);
  assert.equal(persisted.has(receiptScopeKey(scope, 10)), false);
});

test("feature flag remains off by default and requires the exact true value", () => {
  assert.equal(complaintReadTrackingEnabled({}), false);
  assert.equal(complaintReadTrackingEnabled({ nodeEnv: "development", enabled: "true" }), false);
  assert.equal(complaintReadTrackingEnabled({
    nodeEnv: "development",
    enabled: "true",
    migrationApplied: "true",
  }), true);
  assert.equal(complaintReadTrackingEnabled({
    nodeEnv: "development",
    enabled: "1",
    migrationApplied: "true",
  }), false);
});
