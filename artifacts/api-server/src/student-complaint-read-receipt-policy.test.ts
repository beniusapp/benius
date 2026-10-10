import assert from "node:assert/strict";
import test from "node:test";
import {
  complaintReadTrackingEnabled,
  inboxContainsComplaint,
  queryReceiptsWhenEnabled,
  receiptScopeKey,
} from "./student-complaint-read-receipt-policy";

test("receipt tracking stays disabled unless explicitly set to true", () => {
  assert.equal(complaintReadTrackingEnabled({}), false);
  assert.equal(complaintReadTrackingEnabled({ nodeEnv: "development", enabled: "" }), false);
  assert.equal(complaintReadTrackingEnabled({ nodeEnv: "development", enabled: "false" }), false);
  assert.equal(complaintReadTrackingEnabled({ nodeEnv: "development", enabled: "TRUE", migrationApplied: "true" }), false);
  assert.equal(complaintReadTrackingEnabled({ nodeEnv: "development", enabled: "true" }), false);
  assert.equal(complaintReadTrackingEnabled({ nodeEnv: "production", enabled: "true", migrationApplied: "true" }), false);
  assert.equal(complaintReadTrackingEnabled({ nodeEnv: "development", enabled: "true", migrationApplied: "true" }), true);
});

test("disabled feature performs no receipt-table query", async () => {
  let calls = 0;
  const result = await queryReceiptsWhenEnabled(false, async () => {
    calls += 1;
    return [1];
  });
  assert.equal(result, undefined);
  assert.equal(calls, 0);
});

test("enabled receipt query runs and database errors propagate", async () => {
  assert.deepEqual(await queryReceiptsWhenEnabled(true, async () => [3]), [3]);
  await assert.rejects(
    queryReceiptsWhenEnabled(true, async () => { throw new Error("missing table"); }),
    /missing table/,
  );
});

test("receipt authorization is limited to IDs from the authenticated Student inbox", () => {
  const inbox = [{ id: 2 }, { id: 7 }];
  assert.equal(inboxContainsComplaint(inbox, 7), true);
  assert.equal(inboxContainsComplaint(inbox, 8), false);
});

test("receipt identity separates Student, School, Session, and complaint", () => {
  const scope = { schoolId: 4, studentId: 11, sessionId: 2026 };
  const key = receiptScopeKey(scope, 5);
  assert.notEqual(receiptScopeKey({ ...scope, studentId: 12 }, 5), key);
  assert.notEqual(receiptScopeKey({ ...scope, schoolId: 9 }, 5), key);
  assert.notEqual(receiptScopeKey({ ...scope, sessionId: 2027 }, 5), key);
  assert.notEqual(receiptScopeKey(scope, 6), key);
});

test("receipt key remains stable across simulated refreshes and devices", () => {
  const key = receiptScopeKey({ schoolId: 4, studentId: 11, sessionId: 2026 }, 5);
  const persistedStore = new Set([key]);
  const secondDeviceKey = receiptScopeKey({ schoolId: 4, studentId: 11, sessionId: 2026 }, 5);
  assert.equal(persistedStore.has(secondDeviceKey), true);
});
