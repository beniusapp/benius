// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuditLogPage } from "@/pages/admin-modules/fees-manager";
import { setViewSessionId } from "@/lib/queryClient";

describe("Fees Audit Log session transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setViewSessionId(null);
  });

  it("pins stale and replacement Audit Log requests to their query-key sessions", async () => {
    const requests: Array<{ querySession: number | null; headerSession: number | null; signal?: AbortSignal | null }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      const parsed = new URL(url, "http://app.test");
      const querySession = parsed.searchParams.get("sessionId");
      const headerSession = new Headers(init?.headers).get("x-view-session-id");
      requests.push({
        querySession: querySession == null ? null : Number(querySession),
        headerSession: headerSession == null ? null : Number(headerSession),
        signal: init?.signal,
      });

      if (querySession === "101") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Stale request cancelled", "AbortError")),
            { once: true },
          );
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ entries: [], total: 0 }), { status: 200 }));
    }));

    // React Query can schedule a query for the old key after the dashboard's
    // mutable global selection has advanced. The request must still use 101.
    setViewSessionId(202);
    const staleController = new AbortController();
    const staleRequest = fetchAuditLogPage({
      page: 0, fromDate: "", toDate: "", actionFilter: "", searchTerm: "",
      viewSessionId: 101, signal: staleController.signal,
    });
    expect(requests[0]).toMatchObject({ querySession: 101, headerSession: 101, signal: staleController.signal });

    staleController.abort();
    await expect(staleRequest).rejects.toMatchObject({ name: "AbortError" });

    const replacementController = new AbortController();
    await fetchAuditLogPage({
      page: 0, fromDate: "", toDate: "", actionFilter: "", searchTerm: "",
      viewSessionId: 202, signal: replacementController.signal,
    });
    expect(requests[1]).toMatchObject({ querySession: 202, headerSession: 202, signal: replacementController.signal });
  });
});