import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_LOG_DESCRIPTION,
  auditLogErrorMessage,
  auditLogsQueryKey,
  formatAuditActor,
  getAuditLogsViewState,
  sortAuditLogsNewestFirst,
} from "../admin-modules/audit-logs-utils";
import { sessionFetchForViewSession } from "../../lib/queryClient";

test("Audit Logs copy and actor identifier use accurate existing data", () => {
  assert.equal(
    AUDIT_LOG_DESCRIPTION,
    "View recorded school activities for the selected Academic Session.",
  );
  assert.equal(formatAuditActor(73, "admin"), "ID 73 · admin");
  assert.equal(formatAuditActor(null, "teacher"), "Unknown actor · teacher");
  assert.equal(formatAuditActor(undefined, null), "Unknown actor");
});

test("empty, denied, server-error, and loading states remain distinct", () => {
  assert.equal(getAuditLogsViewState({ isLoading: true, isError: false, hasEntries: false }), "loading");
  assert.equal(getAuditLogsViewState({ isLoading: false, isError: false, hasEntries: false }), "empty");
  assert.equal(getAuditLogsViewState({ isLoading: false, isError: true, hasEntries: false }), "error");
  assert.equal(auditLogErrorMessage(403), "You do not have permission to view Audit Logs for this school.");
  assert.equal(auditLogErrorMessage(500), "Audit Logs could not be loaded. Please try again.");
  assert.equal(auditLogErrorMessage(null), "Audit Logs could not be loaded. Please try again.");
});

test("events sort newest-first and higher IDs break equal-timestamp ties", () => {
  const sameTime = "2026-10-10T10:00:00.000Z";
  const sorted = sortAuditLogsNewestFirst([
    { id: 5, createdAt: sameTime },
    { id: 7, createdAt: sameTime },
    { id: 6, createdAt: "2026-10-11T10:00:00.000Z" },
  ]);
  assert.deepEqual(sorted.map(entry => entry.id), [6, 7, 5]);
});

test("session is part of the cache key and pinned to the request header", async () => {
  assert.deepEqual(auditLogsQueryKey(12, 42), ["/api/audit-logs", 12, 42]);
  const originalFetch = globalThis.fetch;
  let capturedHeader: string | null = null;
  globalThis.fetch = (async (_input, init) => {
    capturedHeader = new Headers(init?.headers).get("x-view-session-id");
    return new Response("[]", { status: 200 });
  }) as typeof fetch;

  try {
    await sessionFetchForViewSession("/api/audit-logs/12", 42);
    assert.equal(capturedHeader, "42");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
