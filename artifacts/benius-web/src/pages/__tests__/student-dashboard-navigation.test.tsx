import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import { SessionViewContext } from "@/contexts/session-view-context";
import { getQueryFn } from "@/lib/queryClient";
import StudentDashboard from "@/pages/student-dashboard";

vi.mock("framer-motion", async () => {
  const ReactModule = await import("react");
  const plain = (tag: string) => ({ children, ...props }: any) => {
    const {
      initial, animate, exit, transition, variants, whileHover, whileTap,
      layoutId, layout, ...domProps
    } = props;
    return ReactModule.createElement(tag, domProps, children);
  };
  return {
    motion: {
      div: plain("div"),
      button: plain("button"),
      p: plain("p"),
      span: plain("span"),
      header: plain("header"),
      section: plain("section"),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const SESSION = {
  id: 5101,
  schoolId: 9,
  sessionName: "2026-2027",
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  isActive: true,
  createdAt: "2026-04-01T00:00:00.000Z",
};

const STUDENT = {
  id: 7101,
  name: "Test Student",
  digitalStudentId: "TEST-7101",
  class: "2",
  section: "A",
  phone: "",
  dob: "",
  schoolName: "Test School",
  schoolCode: "TST",
  schoolId: 9,
};

let resolveMarkSeen: ((response: Response) => void) | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

function responseFor(url: string, init?: RequestInit): Promise<Response> {
  const path = new URL(url, window.location.origin).pathname;
  if (path === "/api/student-me") return json(STUDENT);
  if (path === "/api/student/module-dot-state" && init?.method !== "POST") {
    const cursor = { createdAt: "2026-10-10T10:00:00.000Z", recordId: 12 };
    return json({
      homework: { hasNewActivity: false, latestActivityCursor: null },
      classwork: { hasNewActivity: false, latestActivityCursor: null },
      noticeboard: { hasNewActivity: false, latestActivityCursor: null },
      complaints: { hasNewActivity: true, latestActivityCursor: cursor },
    });
  }
  if (path === "/api/student/module-dot-state/seen") {
    return new Promise<Response>((resolve) => { resolveMarkSeen = resolve; });
  }
  if (path.startsWith("/api/student/attendance/stats")) {
    return json({ overallPercent: 90, workingDays: 10, daysPresent: 9 });
  }
  if (path === "/api/student/homework" || path === "/api/student/fees") return json([]);
  if (path === "/api/student/fees/portal-info") {
    return json({ isEnabled: false, gatewayUrl: null, bannerMessage: null });
  }
  return json({});
}

function mountDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) },
      mutations: { retry: false },
    },
  });
  const sessionValue = {
    sessions: [SESSION],
    selectedSession: SESSION,
    setSelectedSession: vi.fn(),
    isArchiveMode: false,
    isSessionsLoading: false,
    pendingActivation: null,
    confirmActivation: vi.fn(),
    subscribeToPaymentUpdate: () => () => undefined,
  };

  return {
    queryClient,
    ...render(
      <Router>
        <QueryClientProvider client={queryClient}>
          <SessionViewContext.Provider value={sessionValue}>
            <Switch>
              <Route path="/student-dashboard" component={StudentDashboard} />
              <Route path="/student/complaints">
                <main data-testid="complaints-route">Complaints route</main>
              </Route>
              <Route path="/student/attendance">
                <main data-testid="attendance-route">Attendance route</main>
              </Route>
            </Switch>
          </SessionViewContext.Provider>
        </QueryClientProvider>
      </Router>,
    ),
  };
}

beforeEach(() => {
  window.history.replaceState({}, "", "/student-dashboard");
  resolveMarkSeen = undefined;
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    responseFor(String(input), init),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => {
    resolveMarkSeen?.(new Response(JSON.stringify({ error: "test cleanup" }), { status: 500 }));
    await Promise.resolve();
  });
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("Student Dashboard first-click navigation", () => {
  it("navigates to Complaints on the first click while mark-seen is still pending", async () => {
    mountDashboard();
    const tile = await screen.findByTestId("tile-complaints");
    await screen.findByTestId("badge-complaints-pulse");

    fireEvent.click(tile);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/student/module-dot-state/seen",
      expect.objectContaining({ method: "POST" }),
    );
    expect(window.location.pathname).toBe("/student/complaints");
    expect(await screen.findByTestId("complaints-route")).toBeInTheDocument();

    // A failed asynchronous mark-seen response must not undo the route change.
    await act(async () => {
      resolveMarkSeen?.(new Response(JSON.stringify({ error: "temporary failure" }), { status: 500 }));
      await Promise.resolve();
    });
    expect(screen.getByTestId("complaints-route")).toBeInTheDocument();
  });

  it("navigates to another module on the first click without a mark-seen request", async () => {
    mountDashboard();
    fireEvent.click(await screen.findByTestId("tile-attendance"));

    expect(await screen.findByTestId("attendance-route")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/student/attendance");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/module-dot-state/seen"))).toBe(false);
  });

  it("responds to browser back/forward popstate route changes", async () => {
    mountDashboard();
    fireEvent.click(await screen.findByTestId("tile-complaints"));
    expect(await screen.findByTestId("complaints-route")).toBeInTheDocument();

    await act(async () => {
      window.history.replaceState({}, "", "/student-dashboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(screen.getByTestId("tile-complaints")).toBeInTheDocument());
    expect(window.location.pathname).toBe("/student-dashboard");

    await act(async () => {
      window.history.replaceState({}, "", "/student/complaints");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByTestId("complaints-route")).toBeInTheDocument();
  });

  it("keeps navigation correct after rapid repeated clicks", async () => {
    mountDashboard();
    const tile = await screen.findByTestId("tile-complaints");
    await screen.findByTestId("badge-complaints-pulse");
    let clickEvents = 0;
    tile.addEventListener("click", () => { clickEvents += 1; });

    act(() => {
      tile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      tile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(clickEvents).toBe(2);
    expect(await screen.findByTestId("complaints-route")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/student/complaints");
  });
});
