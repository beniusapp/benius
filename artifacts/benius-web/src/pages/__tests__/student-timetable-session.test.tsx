// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StudentTimetable from "@/pages/student-timetable";
import { StudentSessionProvider } from "@/contexts/student-session-provider";
import { useSessionView, type AcademicSession } from "@/contexts/session-view-context";
import { getQueryFn, setViewSessionId } from "@/lib/queryClient";

vi.mock("wouter", () => ({ useLocation: () => ["/student/timetable", vi.fn()] }));
vi.mock("@/hooks/use-ist-today", () => ({ useISTToday: () => "2026-09-21" }));
vi.mock("framer-motion", () => ({
  motion: {
    main: ({ children, initial, animate, transition, ...props }: any) => <main {...props}>{children}</main>,
    div: ({ children, initial, animate, transition, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

const a: AcademicSession = {
  id: 101, schoolId: 1, sessionName: "Session A",
  startDate: "2025-04-01", endDate: "2026-03-31", isActive: true, createdAt: null,
};
const b: AcademicSession = {
  id: 202, schoolId: 1, sessionName: "Session B",
  startDate: "2026-04-01", endDate: "2027-03-31", isActive: false, createdAt: null,
};
let schoolSessions: AcademicSession[];
let emptyB: boolean;
let failureStatus: number | null;
let networkFailure: boolean;
let holdA: boolean;
let resolveA: ((response: Response) => void) | null;
type Call = { url: string; session: string | null; method: string; signal?: AbortSignal | null };
let calls: Call[];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const timetable = (session: string | null) => ({
  entries: [{
    id: Number(session), schoolId: 1, teacherId: 9, dayOfWeek: 0,
    period: 1, class: "5", section: "A", subject: session === "101" ? "A Algebra" : "B Biology",
    startTime: null, endTime: null,
  }],
  structure: [{ id: Number(session), periodNumber: 1, label: "Period 1", startTime: "08:00", endTime: "09:00", isBreak: false, sortOrder: 0 }],
});

function Controls() {
  const { selectedSession, setSelectedSession } = useSessionView();
  return (
    <aside>
      <span data-testid="selected-session">{selectedSession?.id ?? "none"}</span>
      <button onClick={() => setSelectedSession(a)}>Select A</button>
      <button onClick={() => setSelectedSession(b)}>Select B</button>
    </aside>
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <StudentSessionProvider>
        <Controls />
        <StudentTimetable />
      </StudentSessionProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

const timetableCalls = () => calls.filter(call => call.url === "/api/student/timetable");

beforeEach(() => {
  class MockEventSource {
    onmessage: ((event: MessageEvent) => void) | null = null;
    close() {}
  }
  vi.stubGlobal("EventSource", MockEventSource);
  schoolSessions = [a, b];
  emptyB = false;
  failureStatus = null;
  networkFailure = false;
  holdA = false;
  resolveA = null;
  calls = [];
  window.sessionStorage.clear();
  setViewSessionId(null);
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const session = new Headers(init?.headers).get("x-view-session-id");
    calls.push({ url, session, method: init?.method ?? "GET", signal: init?.signal });
    if (url === "/api/student/academic-sessions") return Promise.resolve(json(schoolSessions));
    if (url === "/api/student-me") return Promise.resolve(json({ id: 7, class: "5", section: "A", name: "Student", schoolName: "School" }));
    if (url === "/api/student/calendar") return Promise.resolve(json([]));
    if (url === "/api/student/timetable") {
      if (networkFailure) return Promise.reject(new Error("Network offline"));
      if (failureStatus !== null) return Promise.resolve(json({ message: "Unable" }, failureStatus));
      if (holdA && session === "101") return new Promise<Response>(resolve => { resolveA = resolve; });
      return Promise.resolve(json(session === "202" && emptyB ? { entries: [], structure: [] } : timetable(session)));
    }
    throw new Error(`Unexpected request ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  setViewSessionId(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Student Timetable selected Academic Session", () => {
  it("A/D/G. restores selected archived B over active A and sends B through the explicit transport", async () => {
    window.sessionStorage.setItem("student-selected-session-id", "202");
    renderPage();
    expect(await screen.findByText("B Biology")).toBeInTheDocument();
    expect(screen.getByText(/Session B/)).toBeInTheDocument();
    expect(screen.queryByText("A Algebra")).not.toBeInTheDocument();
    expect(timetableCalls()).toHaveLength(1);
    expect(timetableCalls()[0]).toMatchObject({ session: "202", method: "GET" });
    expect(timetableCalls()[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls.every(call => call.method === "GET")).toBe(true);
    expect(screen.queryByRole("button", { name: /save|edit|delete|remove/i })).not.toBeInTheDocument();
  });

  it("B. uses active A when there is no deliberate selection", async () => {
    renderPage();
    expect(await screen.findByText("A Algebra")).toBeInTheDocument();
    expect(screen.getByTestId("selected-session")).toHaveTextContent("101");
    expect(timetableCalls().map(call => call.session)).toEqual(["101"]);
  });

  it("C. neither selection nor active session chooses a first archived session or makes a timetable request", async () => {
    schoolSessions = [{ ...a, isActive: false }, b];
    renderPage();
    expect(await screen.findByText("No academic session available for timetable.")).toBeInTheDocument();
    expect(screen.getByTestId("selected-session")).toHaveTextContent("none");
    expect(timetableCalls()).toHaveLength(0);
    expect(screen.queryByText("No periods scheduled")).not.toBeInTheDocument();
  });

  it("E/F/J/K/M. separates both query keys and request IDs on A → B → A without mutation controls", async () => {
    const { client } = renderPage();
    expect(await screen.findByText("A Algebra")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select B" }));
    expect(await screen.findByText("B Biology")).toBeInTheDocument();
    expect(screen.queryByText("A Algebra")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select A" }));
    expect(await screen.findByText("A Algebra")).toBeInTheDocument();
    expect(screen.queryByText("B Biology")).not.toBeInTheDocument();
    expect(client.getQueryData<{ entries: Array<{ subject: string }> }>(["/api/student/timetable", 101])?.entries[0].subject).toBe("A Algebra");
    expect(client.getQueryData<{ entries: Array<{ subject: string }> }>(["/api/student/timetable", 202])?.entries[0].subject).toBe("B Biology");
    expect(timetableCalls().map(call => call.session)).toEqual(["101", "202"]);
    expect(calls.every(call => call.method === "GET")).toBe(true);
  });

  it("H. a successful empty B response has no A entries or bell structure", async () => {
    emptyB = true;
    renderPage();
    expect(await screen.findByText("A Algebra")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select B" }));
    expect(await screen.findByText("No periods scheduled")).toBeInTheDocument();
    expect(screen.queryByText("A Algebra")).not.toBeInTheDocument();
    expect(screen.queryByText("Free Period")).not.toBeInTheDocument();
    expect(timetableCalls().map(call => call.session)).toEqual(["101", "202"]);
  });

  it.each([403, 404, 409, 500])("I. treats HTTP %i as an error, not an empty timetable", async status => {
    failureStatus = status;
    renderPage();
    expect(await screen.findByText(`Unable to load timetable (${status}).`)).toHaveAttribute("role", "alert");
    expect(screen.queryByText("No periods scheduled")).not.toBeInTheDocument();
  });

  it("I. distinguishes a failed network request from a successful empty timetable", async () => {
    networkFailure = true;
    renderPage();
    expect(await screen.findByText("Network offline")).toHaveAttribute("role", "alert");
    expect(screen.queryByText("No periods scheduled")).not.toBeInTheDocument();
  });

  it("L. a late A response cannot populate B's UI or cache", async () => {
    holdA = true;
    const { client } = renderPage();
    await waitFor(() => expect(resolveA).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Select B" }));
    expect(await screen.findByText("B Biology")).toBeInTheDocument();
    await act(async () => resolveA!(json(timetable("101"))));
    expect(screen.queryByText("A Algebra")).not.toBeInTheDocument();
    expect(client.getQueryData<{ entries: Array<{ subject: string }> }>(["/api/student/timetable", 202])?.entries[0].subject).toBe("B Biology");
    expect(timetableCalls().map(call => call.session)).toEqual(["101", "202"]);
  });
});