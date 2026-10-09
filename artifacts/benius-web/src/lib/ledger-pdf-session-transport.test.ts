import assert from "node:assert/strict";
import test from "node:test";
import { sessionFetchForViewSession, setViewSessionId } from "./queryClient";

test("Ledger PDF transport keeps the captured session header when the dashboard selection changes", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string | URL | Request; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: input, init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    setViewSessionId(303);
    await sessionFetchForViewSession(
      "/api/admin/fees/ledger/pdf",
      202,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIds: [12] }),
      },
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/admin/fees/ledger/pdf");
    assert.equal(new Headers(requests[0].init?.headers).get("x-view-session-id"), "202");
    assert.equal(requests[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { selectedIds: [12] });
  } finally {
    globalThis.fetch = originalFetch;
    setViewSessionId(null);
  }
});
