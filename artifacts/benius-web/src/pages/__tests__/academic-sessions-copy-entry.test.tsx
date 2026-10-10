import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import AcademicSessions from "@/pages/admin-modules/academic-sessions";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const sessions = [
  {
    id: 12, schoolId: 3, sessionName: "2025-2026", startDate: "2025-04-01",
    endDate: "2026-03-31", isActive: false, status: "archived",
    copiedFromSessionId: null, copiedModules: null,
  },
  {
    id: 88, schoolId: 3, sessionName: "2026-2027", startDate: "2026-04-01",
    endDate: "2027-03-31", isActive: false, status: "draft",
    copiedFromSessionId: 12,
    copiedModules: JSON.stringify({ approvedModules: ["classes"] }),
  },
  {
    id: 89, schoolId: 3, sessionName: "2027-2028", startDate: "2027-04-01",
    endDate: "2028-03-31", isActive: false, status: "draft",
    copiedFromSessionId: null, copiedModules: null,
  },
  {
    id: 90, schoolId: 3, sessionName: "2028-2029", startDate: "2028-04-01",
    endDate: "2029-03-31", isActive: false, status: "draft",
    copiedFromSessionId: 999, copiedModules: null,
  },
  {
    id: 91, schoolId: 3, sessionName: "2029-2030", startDate: "2029-04-01",
    endDate: "2030-03-31", isActive: true, status: "active",
    copiedFromSessionId: 88, copiedModules: null,
  },
];

let fetchMock: ReturnType<typeof vi.fn>;
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mount({ archiveMode = false } = {}) {
  window.history.replaceState({}, "", "/admin-dashboard/academic-sessions");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <Router>
      <QueryClientProvider client={client}>
        <Switch>
          <Route path="/admin-dashboard/academic-sessions">
            <AcademicSessions schoolId={3} isArchiveMode={archiveMode} />
          </Route>
        </Switch>
      </QueryClientProvider>
    </Router>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === "/api/admin/academic-sessions") return Promise.resolve(json(sessions));
    if (path === "/api/admin/academic-sessions/module-preview") return Promise.resolve(json({ counts: {} }));
    return Promise.resolve(json({}));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("Academic Sessions copy UI removal", () => {
  it("hides Copy Configuration actions while retaining saved copy-history status", async () => {
    mount();
    await screen.findByTestId("session-card-88");
    expect(screen.queryByRole("button", { name: /Copy Configuration/i })).not.toBeInTheDocument();
    expect(screen.getByText("1 modules copied from session #12")).toBeInTheDocument();
  });

  it("does not offer copying in archive/read-only mode", async () => {
    mount({ archiveMode: true });
    await screen.findByTestId("session-card-88");
    expect(screen.queryByRole("button", { name: /Copy Configuration/i })).not.toBeInTheDocument();
    expect(screen.getByText("1 modules copied from session #12")).toBeInTheDocument();
    expect(screen.queryByTestId("button-add-session")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-activate-88")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-delete-88")).not.toBeInTheDocument();
    expect(screen.getAllByText("View Only")).toHaveLength(sessions.length);
  });
});
