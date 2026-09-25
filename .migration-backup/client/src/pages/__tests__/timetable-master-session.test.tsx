// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import TimetableMaster from "@/pages/admin-modules/timetable-master";
import { SessionViewContext, type AcademicSession } from "@/contexts/session-view-context";
import { queryClient, setViewSessionId } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) =>
    <select value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
}));

const a: AcademicSession = { id: 101, schoolId: 1, sessionName: "A", startDate: "2025-04-01", endDate: "2026-03-31", isActive: true, createdAt: null };
const b: AcademicSession = { ...a, id: 202, sessionName: "B" };
const archived: AcademicSession = { ...b, isActive: false };
const row = (startTime: string) => ({ id: 1, periodNumber: 1, label: "Period 1", startTime, endTime: "09:00", isBreak: false, sortOrder: 0 });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
type Sent = { url: string; method: string; session: string | null; body: any };
let sent: Sent[];
let emptyB = false;
let rejectGrid = false;
let holdA: ((r: Response) => void) | null = null;

function view(session: AcademicSession | null, tab = "schedule", sessions = [a, b]) {
  return <SessionViewContext.Provider value={{
    sessions, selectedSession: session, setSelectedSession: vi.fn(), isArchiveMode: !!session && !session.isActive,
    isSessionsLoading: false, pendingActivation: null, confirmActivation: vi.fn(), subscribeToPaymentUpdate: () => () => {},
  }}>
    <QueryClientProvider client={queryClient}>
      <TimetableMaster schoolId={1} classes={["5"]} sections={["A"]} subjects={["Mathematics"]} initialTab={tab} />
    </QueryClientProvider>
  </SessionViewContext.Provider>;
}

function timetableRequests(method?: string) {
  return sent.filter(r => r.url.startsWith("/api/timetable") && (!method || r.method === method));
}

async function selectGrid() {
  const selectors = screen.getAllByRole("combobox");
  fireEvent.change(selectors[0], { target: { value: "5" } });
  fireEvent.change(selectors[1], { target: { value: "A" } });
  await screen.findByTestId("cell-0-1");
}

async function makeSlotDraft() {
  await selectGrid();
  fireEvent.click(screen.getByTestId("cell-0-1"));
  fireEvent.change(screen.getByTestId("select-pop-teacher-0-1"), { target: { value: "9" } });
  fireEvent.change(screen.getByTestId("select-pop-subject-0-1"), { target: { value: "Mathematics" } });
  fireEvent.click(screen.getByTestId("button-pop-apply-0-1"));
  expect(screen.getByText(/1 unsaved change/)).toBeTruthy();
}

beforeEach(() => {
  queryClient.clear();
  sent = [];
  emptyB = false;
  rejectGrid = false;
  holdA = null;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const session = new Headers(init?.headers).get("x-view-session-id");
    const method = init?.method ?? "GET";
    sent.push({ url, session, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.startsWith("/api/schools/")) return Promise.resolve(response([{ id: 9, fullName: "Teacher A" }]));
    if (url.startsWith("/api/timetable/class-view")) {
      if (rejectGrid) return Promise.resolve(response({ message: "Unavailable" }, 503));
      if (session === "101" && holdA) return new Promise<Response>(resolve => { holdA = resolve; });
      return Promise.resolve(response(session === "202" && emptyB ? { entries: [], structure: [] } : {
        entries: [{ id: Number(session), teacherId: 9, dayOfWeek: 0, period: 1, class: "5", section: "A", subject: `Session ${session}`, teacherName: "Teacher A" }],
        structure: [row(session === "101" ? "08:00" : "08:30")],
      }));
    }
    if (url.startsWith("/api/timetable/structure") && method === "GET")
      return Promise.resolve(response(session === "202" && emptyB ? [] : [row(session === "101" ? "08:00" : "08:30")]));
    if (url === "/api/timetable/class-status") return Promise.resolve(response([
      { class: "5", section: "A", totalCount: 1, draftCount: 1, publishedCount: 0 },
    ]));
    if (url === "/api/timetable/admin/save-batch") return Promise.resolve(response({ saved: [], errors: [] }));
    if (url === "/api/timetable/structure") return Promise.resolve(response({ saved: [] }));
    if (url === "/api/timetable/publish") return Promise.resolve(response({ message: "Published" }));
    throw new Error(`Unexpected request: ${method} ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  setViewSessionId(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Admin Timetable session UI", () => {
  it("A/B. gives A and B separate cache keys and pins requests to their keys, not global selection", async () => {
    setViewSessionId(999);
    const rendered = render(view(a));
    await selectGrid();
    expect(screen.getByText("Session 101")).toBeTruthy();
    rendered.rerender(view(b));
    await selectGrid();
    expect(screen.getByText("Session 202")).toBeTruthy();
    const keys = queryClient.getQueryCache().findAll({ queryKey: ["/api/timetable/class-view"] }).map(q => q.queryKey);
    expect(keys).toContainEqual(["/api/timetable/class-view", 101, "5", "A"]);
    expect(keys).toContainEqual(["/api/timetable/class-view", 202, "5", "A"]);
    expect(timetableRequests("GET").filter(r => r.url.startsWith("/api/timetable/class-view")).map(r => r.session)).toEqual(["101", "202"]);
  });

  it("A/B. separates structure and status cache identities and pins their request headers", async () => {
    setViewSessionId(999);
    const rendered = render(view(a, "structure"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5" } });
    await screen.findByTestId("input-struct-start-0");
    rendered.rerender(view(b, "structure"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5" } });
    await screen.findByTestId("input-struct-start-0");
    fireEvent.click(screen.getByTestId("tab-publish"));
    await screen.findByTestId("button-publish-5-A");
    rendered.rerender(view(a, "publish"));
    await screen.findByTestId("button-publish-5-A");
    const keys = queryClient.getQueryCache().findAll().map(q => q.queryKey);
    expect(keys).toContainEqual(["/api/timetable/structure", 101, "5"]);
    expect(keys).toContainEqual(["/api/timetable/structure", 202, "5"]);
    expect(keys).toContainEqual(["/api/timetable/class-status", 101]);
    expect(keys).toContainEqual(["/api/timetable/class-status", 202]);
    expect(timetableRequests("GET").filter(r => r.url.startsWith("/api/timetable/structure")).map(r => r.session)).toEqual(["101", "202"]);
    expect(timetableRequests("GET").filter(r => r.url === "/api/timetable/class-status").map(r => r.session)).toEqual(["202", "101"]);
  });

  it("C. explicitly publishes the selected B session and refreshes only B status", async () => {
    const invalidations = vi.spyOn(queryClient, "invalidateQueries");
    render(view(b, "publish"));
    fireEvent.click(await screen.findByTestId("button-publish-5-A"));
    await waitFor(() => expect(timetableRequests("PATCH")).toHaveLength(1));
    expect(timetableRequests("PATCH")[0]).toMatchObject({ session: "202", body: { class: "5", section: "A" } });
    await waitFor(() => expect(invalidations).toHaveBeenCalledWith({ queryKey: ["/api/timetable/class-status", 202] }));
  });

  it("D/F. clears A slot drafts on switching and cannot submit them into B", async () => {
    const rendered = render(view(a));
    await makeSlotDraft();
    rendered.rerender(view(b));
    await selectGrid();
    expect(screen.queryByText(/unsaved change/)).toBeNull();
    expect(screen.queryByTestId("button-save-changes")).toBeNull();
    expect(timetableRequests("POST")).toHaveLength(0);
  });

  it("E. discards A's dirty structure on switching to B", async () => {
    const rendered = render(view(a, "structure"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5" } });
    expect((await screen.findByTestId("input-struct-start-0") as HTMLInputElement).value).toBe("08:00");
    fireEvent.click(screen.getByTestId("button-add-break"));
    expect(screen.getByTestId("button-struct-save")).toBeTruthy();
    rendered.rerender(view(b, "structure"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5" } });
    await waitFor(() => expect((screen.getByTestId("input-struct-start-0") as HTMLInputElement).value).toBe("08:30"));
    expect(screen.queryByTestId("struct-row-1")).toBeNull();
    expect(screen.queryByTestId("button-struct-save")).toBeNull();
  });

  it("G. allows archived reads but disables schedule, structure, and publish mutations", async () => {
    const rendered = render(view(archived));
    await selectGrid();
    expect(screen.getByText("Session 202")).toBeTruthy();
    fireEvent.click(screen.getByTestId("cell-0-1"));
    expect(screen.queryByTestId("select-pop-teacher-0-1")).toBeNull();
    rendered.rerender(view(archived, "structure"));
    fireEvent.click(screen.getByTestId("tab-structure"));
    const selector = screen.getByRole("combobox");
    fireEvent.change(selector, { target: { value: "5" } });
    await screen.findByTestId("input-struct-start-0");
    expect((screen.getByTestId("input-struct-start-0") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("button-struct-delete-0") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("button-add-period") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("button-add-break") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("tab-publish"));
    expect((await screen.findByTestId("button-publish-5-A") as HTMLButtonElement).disabled).toBe(true);
    expect(timetableRequests("GET").every(r => r.session === "202")).toBe(true);
  });

  it("H. batch save invalidates only current-session class-view and status", async () => {
    const invalidations = vi.spyOn(queryClient, "invalidateQueries");
    render(view(b));
    await makeSlotDraft();
    fireEvent.click(screen.getByTestId("button-save-changes"));
    await waitFor(() => expect(timetableRequests("POST")).toHaveLength(1));
    expect(timetableRequests("POST")[0].session).toBe("202");
    await waitFor(() => {
      expect(invalidations).toHaveBeenCalledWith({ queryKey: ["/api/timetable/class-view", 202, "5", "A"] });
      expect(invalidations).toHaveBeenCalledWith({ queryKey: ["/api/timetable/class-status", 202] });
    });
  });

  it("H. structure replacement invalidates only current-session structure and class-view", async () => {
    const invalidations = vi.spyOn(queryClient, "invalidateQueries");
    render(view(b, "structure"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5" } });
    await screen.findByTestId("input-struct-start-0");
    fireEvent.click(screen.getByTestId("button-add-break"));
    fireEvent.click(screen.getByTestId("button-struct-save"));
    await waitFor(() => expect(timetableRequests("POST")).toHaveLength(1));
    expect(timetableRequests("POST")[0].session).toBe("202");
    await waitFor(() => {
      expect(invalidations).toHaveBeenCalledWith({ queryKey: ["/api/timetable/structure", 202, "5"] });
      expect(invalidations).toHaveBeenCalledWith({ queryKey: ["/api/timetable/class-view", 202, "5"] });
    });
  });

  it("I. shows an empty fresh session without A entries or drafts", async () => {
    emptyB = true;
    const rendered = render(view(a));
    await makeSlotDraft();
    rendered.rerender(view(b));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "5" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "A" } });
    await screen.findByText("Bell schedule not configured");
    expect(screen.queryByText(/unsaved change/)).toBeNull();
    expect(screen.queryByText("Session 101")).toBeNull();
  });

  it("J. keeps a late A response out of the B editor and saves new B drafts into B", async () => {
    holdA = () => {};
    const rendered = render(view(a));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "5" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "A" } });
    await waitFor(() => expect(holdA).not.toBeNull());
    const resolveA = holdA!;
    rendered.rerender(view(b));
    await makeSlotDraft();
    await act(async () => resolveA(response({
      entries: [{ id: 101, teacherId: 9, dayOfWeek: 0, period: 1, class: "5", section: "A", subject: "Late A", teacherName: "Teacher A" }],
      structure: [row("08:00")],
    })));
    expect(screen.queryByText("Late A")).toBeNull();
    fireEvent.click(screen.getByTestId("button-save-changes"));
    await waitFor(() => expect(timetableRequests("POST")[0]?.session).toBe("202"));
  });

  it("does not request Timetable data without a resolved session or mistake errors for empty data", async () => {
    const rendered = render(view(null, "publish", []));
    expect(screen.getByText("No academic session available for Timetable.")).toBeTruthy();
    expect(timetableRequests()).toHaveLength(0);
    rejectGrid = true;
    rendered.rerender(view(a));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "5" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "A" } });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Timetable could not be loaded (503)");
  });
});