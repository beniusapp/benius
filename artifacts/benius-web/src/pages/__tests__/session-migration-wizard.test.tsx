import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import SessionMigrationPage from "@/pages/admin-modules/session-migration";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const SOURCE = {
  id: 12, sessionName: "2025-2026", startDate: "2025-04-01",
  endDate: "2026-03-31", isActive: true, status: "active", copiedFromSessionId: null,
};
const CREATED = {
  id: 88, sessionName: "2026-2027", startDate: "2026-04-01",
  endDate: "2027-03-31", isActive: false, status: "draft", copiedFromSessionId: 12,
};

let fetchMock: ReturnType<typeof vi.fn>;
let postResponse: Response;
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function mount(path: string) {
  window.history.replaceState({}, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
  return render(
    <Router>
      <QueryClientProvider client={client}>
        <Switch>
          <Route path="/admin-dashboard/school-setup/session-migration" component={SessionMigrationPage} />
          <Route path="/admin-dashboard/academic-sessions"><div data-testid="sessions-route" /></Route>
          <Route path="/session-copy-center/:id">{params => <div data-testid="copy-route">{params.id}</div>}</Route>
          <Route path="/admin-dashboard/exam-controller"><div data-testid="promotion-route" /></Route>
        </Switch>
      </QueryClientProvider>
    </Router>,
  );
}

beforeEach(() => {
  postResponse = json(CREATED);
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === "/api/me") return Promise.resolve(json({ role: "admin" }));
    if (path === "/api/admin/academic-sessions" && init?.method !== "POST") return Promise.resolve(json([SOURCE]));
    if (path === "/api/admin/academic-sessions" && init?.method === "POST") return Promise.resolve(postResponse);
    return Promise.resolve(json({}));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("Academic Session review/create flow", () => {
  it("does not create until Create New Session is clicked, then submits once and shows server status", async () => {
    mount("/admin-dashboard/school-setup/session-migration?name=2026-2027&start=2026-04-01&end=2027-03-31");
    expect(await screen.findByText("Review New Academic Session")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByText("Session-Archived Modules")).not.toBeVisible();
    const createButton = screen.getByTestId("button-create-new-session");
    fireEvent.click(createButton);
    fireEvent.click(createButton);
    await screen.findByText(/Status: draft/);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("copy-modules"))).toBe(false);
  });

  it("does not show success when creation fails", async () => {
    postResponse = json({ message: "Dates overlap with another session" }, 400);
    mount("/admin-dashboard/school-setup/session-migration?name=2026-2027&start=2026-04-01&end=2027-03-31");
    fireEvent.click(await screen.findByTestId("button-create-new-session"));
    expect(await screen.findByText("Failed to create session")).toBeInTheDocument();
    expect(screen.queryByText("Session created successfully")).not.toBeInTheDocument();
  });

  it("preserves source context and shows only the two Page 3 navigation actions without copying automatically", async () => {
    mount("/admin-dashboard/school-setup/session-migration?name=2026-2027&start=2026-04-01&end=2027-03-31&copyFrom=12");
    expect(await screen.findByText(/Copy source:/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-create-new-session"));
    await screen.findByTestId("button-proceed-promote-students");
    expect(screen.getByText(/Status: draft/)).toBeInTheDocument();
    expect(screen.queryByTestId("button-copy-configuration")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-proceed-promote-students")).toBeInTheDocument();
    expect(screen.getByTestId("button-go-to-sessions")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("copy-modules"))).toBe(false);
  });

  it("keeps promotion navigation explicit and does not execute promotion", async () => {
    mount("/admin-dashboard/school-setup/session-migration?name=2026-2027&start=2026-04-01&end=2027-03-31");
    fireEvent.click(await screen.findByTestId("button-create-new-session"));
    fireEvent.click(await screen.findByTestId("button-proceed-promote-students"));
    await waitFor(() => expect(screen.getByTestId("promotion-route")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/admin/promote"))).toBe(false);
  });

  it("returns to Page 1 with all review values preserved", async () => {
    mount("/admin-dashboard/school-setup/session-migration?name=2026-2027&start=2026-04-01&end=2027-03-31&copyFrom=12");
    fireEvent.click(await screen.findByTestId("button-step2-previous"));
    await screen.findByTestId("sessions-route");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("restoreCreate")).toBe("1");
    expect(params.get("name")).toBe("2026-2027");
    expect(params.get("start")).toBe("2026-04-01");
    expect(params.get("end")).toBe("2027-03-31");
    expect(params.get("copyFrom")).toBe("12");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps Back to Academic Sessions available on the success screen", async () => {
    mount("/admin-dashboard/school-setup/session-migration?name=2026-2027&start=2026-04-01&end=2027-03-31");
    fireEvent.click(await screen.findByTestId("button-create-new-session"));
    fireEvent.click(await screen.findByTestId("button-go-to-sessions"));
    await screen.findByTestId("sessions-route");
    expect(window.location.pathname).toBe("/admin-dashboard/academic-sessions");
  });
});
