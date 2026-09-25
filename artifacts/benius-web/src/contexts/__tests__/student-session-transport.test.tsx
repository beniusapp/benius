// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { StudentSessionProvider } from "@/contexts/student-session-provider";
import { useSessionView } from "@/contexts/session-view-context";
import { sessionFetch, setViewSessionId } from "@/lib/queryClient";

const sessions = [
  {
    id: 101, schoolId: 1, sessionName: "Prior year",
    startDate: "2026-04-01", endDate: "2027-03-31", isActive: false,
    createdAt: "2026-04-01T00:00:00.000Z",
  },
  {
    id: 202, schoolId: 1, sessionName: "Current year",
    startDate: "2027-04-01", endDate: "2028-03-31", isActive: true,
    createdAt: "2027-04-01T00:00:00.000Z",
  },
];

function TransportProbe() {
  const { selectedSession, setSelectedSession } = useSessionView();
  const sessionId = selectedSession?.id ?? null;
  const query = useQuery({
    queryKey: ["/api/student/fees", sessionId],
    enabled: sessionId !== null,
    queryFn: async () => {
      const response = await sessionFetch(`/api/student/fees?querySession=${sessionId}`);
      return response.json() as Promise<{ responseSession: number }>;
    },
  });

  return (
    <div>
      <p data-testid="selection">{sessionId ?? "none"}</p>
      <p data-testid="response">{query.data?.responseSession ?? "loading"}</p>
      <button onClick={() => setSelectedSession(sessions[0])}>Prior</button>
      <button onClick={() => setSelectedSession(sessions[1])}>Current</button>
    </div>
  );
}

describe("StudentSessionProvider session transport", () => {
  const requests: Array<{ querySession: number; headerSession: number | null }> = [];

  beforeEach(() => {
    class MockEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null;
      close() {}
    }
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/student/academic-sessions") {
        return Promise.resolve(new Response(JSON.stringify(sessions), { status: 200 }));
      }

      const parsed = new URL(url, "http://app.test");
      const querySession = Number(parsed.searchParams.get("querySession"));
      const headerSession = new Headers(init?.headers).get("x-view-session-id");
      requests.push({
        querySession,
        headerSession: headerSession == null ? null : Number(headerSession),
      });
      return Promise.resolve(new Response(JSON.stringify({
        responseSession: headerSession == null ? null : Number(headerSession),
      }), { status: 200 }));
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    requests.length = 0;
    window.sessionStorage.clear();
    setViewSessionId(null);
  });

  it("keeps session-keyed requests aligned with headers during initialization and rapid switches", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <StudentSessionProvider>
          <TransportProbe />
        </StudentSessionProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("selection")).toHaveTextContent("202"));
    await waitFor(() => expect(screen.getByTestId("response")).toHaveTextContent("202"));

    // Switch back immediately after the prior-session request has been issued.
    // Each request must keep the cache-key session, transport header, and
    // returned response aligned.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Prior" }));
    });
    await waitFor(() => expect(screen.getByTestId("selection")).toHaveTextContent("101"));
    await waitFor(() => expect(screen.getByTestId("response")).toHaveTextContent("101"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Current" }));
    });
    await waitFor(() => expect(screen.getByTestId("selection")).toHaveTextContent("202"));
    await waitFor(() => expect(screen.getByTestId("response")).toHaveTextContent("202"));

    expect(requests).toHaveLength(3);
    expect(requests).toEqual([
      { querySession: 202, headerSession: 202 },
      { querySession: 101, headerSession: 101 },
      { querySession: 202, headerSession: 202 },
    ]);
  });

  it("rehydrates a valid archived selection before issuing session-keyed requests", async () => {
    window.sessionStorage.setItem("student-selected-session-id", "101");
    setViewSessionId(null);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StudentSessionProvider>
          <TransportProbe />
        </StudentSessionProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("selection")).toHaveTextContent("101"));
    await waitFor(() => expect(screen.getByTestId("response")).toHaveTextContent("101"));
    expect(requests).toEqual([{ querySession: 101, headerSession: 101 }]);
  });
});