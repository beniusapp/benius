import assert from "node:assert/strict";
import test from "node:test";
import { sessionFetchForViewSession } from "./queryClient";

test("session-keyed requests retain their captured session during a later selection", async () => {
  const originalFetch = globalThis.fetch;
  const headersSeen: string[] = [];
  globalThis.fetch = async (_input, init) => {
    headersSeen.push(new Headers(init?.headers).get("x-view-session-id") ?? "");
    return new Response("{}", { status: 200 });
  };
  try {
    await sessionFetchForViewSession("/api/student/fees", 41);
    await sessionFetchForViewSession("/api/student/fees", 42);
    await sessionFetchForViewSession("/api/student/fees", null);
    assert.deepEqual(headersSeen, ["41", "42", ""]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
