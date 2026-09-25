// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import TimetableModule from "@/pages/teacher-modules/timetable";
import type { TeacherMe } from "@/pages/teacher-dashboard";
import { queryClient, setViewSessionId } from "@/lib/queryClient";

type Session = { id: number; isActive: boolean };
let selected: Session | null;
vi.mock("@/pages/teacher-dashboard", () => ({ useTeacherSelectedSession: () => selected }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-school-config", () => ({
  useSchoolConfigStrict: () => ({
    classes: ["5"], sections: ["A"], subjects: ["Mathematics"], isLoading: false,
    hasClasses: true, hasSections: true, hasSubjects: true, isFullyConfigured: true,
    getSubjectsForClass: () => ["Mathematics"],
  }),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) =>
    <select value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
}));

const a = { id: 101, isActive: true };
const b = { id: 202, isActive: true };
const archivedB = { id: 202, isActive: false };
const teacher = {
  id: 9, schoolId: 1, assignedClass: "5", assignedSection: "A",
  fullName: "Teacher A",
} as TeacherMe;
const entry = (session: number) => ({
  id: session, dayOfWeek: 0, period: 1, class: "5", section: "A",
  teacherId: 9, teacherName: "Teacher A", subject: `Session ${session}`,
});
const row = (time: string) => ({
  id: 1, periodNumber: 1, label: "Period 1", startTime: time,
  endTime: "09:00", isBreak: false, sortOrder: 0,
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
type Request = { url: string; method: string; session: string | null; body: any };
let sent: Request[];
let emptyB: boolean;
let rejectGrid: boolean;
let rejectStructure: boolean;
let rejectTeacher: boolean;
let rejectCollision: boolean;
let occupiedA: boolean;
let holdA: ((r: Response) => void) | null;

function view() {
  return <QueryClientProvider client={queryClient}><TimetableModule teacher={teacher} /></QueryClientProvider>;
}

function timetableRequests(method?: string) {
  return sent.filter(r => r.url.startsWith("/api/timetable") && (!method || r.method === method));
}

async function selectGrid() {
  await waitFor(() => expect(screen.getAllByRole("combobox")).toHaveLength(2));
  const selectors = screen.getAllByRole("combobox");
  fireEvent.change(selectors[0], { target: { value: "5" } });
  fireEvent.change(selectors[1], { target: { value: "A" } });
  await screen.findByTestId("explorer-cell-0-1");
}

async function openOwnSlot() {
  await selectGrid();
  fireEvent.click(screen.getByTestId("slot-own-0-1"));
  await waitFor(() => expect((screen.getByTestId("button-modal-save") as HTMLButtonElement).disabled).toBe(false));
}

beforeEach(() => {
  queryClient.clear();
  selected = a;
  sent = [];
  emptyB = false;
  rejectGrid = false;
  rejectStructure = false;
  rejectTeacher = false;
  rejectCollision = false;
  occupiedA = false;
  holdA = null;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const session = new Headers(init?.headers).get("x-view-session-id");
    const method = init?.method ?? "GET";
    sent.push({ url, session, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const id = Number(session);
    if (url.startsWith("/api/timetable/teacher/")) {
      if (rejectTeacher) return Promise.resolve(response({ message: "Unavailable" }, 503));
      if (session === "101" && holdA) return new Promise<Response>(resolve => { holdA = resolve; });
      return Promise.resolve(response(id === 202 && emptyB ? [] : [entry(id)]));
    }
    if (url.startsWith("/api/timetable/class-view")) {
      if (rejectGrid) return Promise.resolve(response({ message: "Unavailable" }, 503));
      return Promise.resolve(response(id === 202 && emptyB ? { entries: [], structure: [] } : {
        entries: [entry(id)], structure: [row(id === 101 ? "08:00" : "08:30")],
      }));
    }
    if (url.startsWith("/api/timetable/structure")) {
      if (rejectStructure) return Promise.resolve(response({ message: "Unavailable" }, 503));
      return Promise.resolve(response(id === 202 && emptyB ? [] : [row(id === 101 ? "08:00" : "08:30")]));
    }
    if (url.startsWith("/api/timetable/slot-check")) {
      if (rejectCollision) return Promise.resolve(response({ message: "Unavailable" }, 503));
      return Promise.resolve(response({ taken: session === "101" && occupiedA }));
    }
    if (url === "/api/timetable/teacher/save-batch") return Promise.resolve(response({ saved: [{}], conflicts: [] }));
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

describe("Teacher Timetable selected Academic Session", () => {
  it("A/D. uses selected B over active A for all four GETs, independent of the global header", async () => {
    selected = archivedB;
    setViewSessionId(101);
    render(view());
    await selectGrid();
    fireEvent.click(screen.getByTestId("tab-my-schedule"));
    fireEvent.click(screen.getByTestId("tab-class-explorer"));
    // A separate active B view permits opening a modal to exercise slot-check.
    selected = b;
    cleanup();
    render(view());
    await openOwnSlot();
    expect(timetableRequests("GET").map(r => [r.url.split("?")[0], r.session])).toEqual(expect.arrayContaining([
      ["/api/timetable/teacher/9", "202"], ["/api/timetable/class-view", "202"],
      ["/api/timetable/structure", "202"], ["/api/timetable/slot-check", "202"],
    ]));
    expect(timetableRequests("GET").every(r => r.session === "202")).toBe(true);
  });

  it("B/C. falls back to the active session; with neither session, makes no Timetable request", async () => {
    selected = a;
    render(view());
    await screen.findByTestId("tab-my-schedule");
    expect(timetableRequests("GET").every(r => r.session === "101")).toBe(true);
    cleanup();
    selected = null;
    sent = [];
    render(view());
    expect(screen.getByRole("alert").textContent).toMatch(/No academic session available/);
    expect(timetableRequests()).toHaveLength(0);
  });

  it("E/K. separates A and B query keys; a late A response cannot replace B", async () => {
    holdA = () => {};
    const rendered = render(view());
    await waitFor(() => expect(holdA).not.toBeNull());
    const resolveA = holdA!;
    selected = b;
    rendered.rerender(view());
    await selectGrid();
    expect(screen.getByText("Session 202")).toBeTruthy();
    await act(async () => resolveA(response([entry(101)])));
    expect(screen.queryByText("Session 101")).toBeNull();
    const keys = queryClient.getQueryCache().findAll().map(q => q.queryKey);
    expect(keys).toContainEqual(["/api/timetable/teacher", 101, 9]);
    expect(keys).toContainEqual(["/api/timetable/teacher", 202, 9]);
    expect(keys).toContainEqual(["/api/timetable/class-view", 202, "5", "A"]);
    expect(keys).toContainEqual(["/api/timetable/structure", 202, "5"]);
  });

  it("F. explicitly targets B on save and invalidates only B timetable queries", async () => {
    selected = b;
    setViewSessionId(101);
    const invalidations = vi.spyOn(queryClient, "invalidateQueries");
    render(view());
    await openOwnSlot();
    fireEvent.click(screen.getByTestId("button-modal-save"));
    await waitFor(() => expect(timetableRequests("POST")).toHaveLength(1));
    expect(timetableRequests("POST")[0]).toMatchObject({ session: "202", body: { changes: [{ subject: "Session 202", class: "5", section: "A" }] } });
    await waitFor(() => {
      expect(invalidations).toHaveBeenCalledWith({ queryKey: ["/api/timetable/teacher", 202, 9] });
      expect(invalidations).toHaveBeenCalledWith({ queryKey: ["/api/timetable/class-view", 202, "5", "A"] });
      expect(invalidations).toHaveBeenCalledWith({ queryKey: ["/api/timetable/slot-check", 202, "5", "A"] });
    });
    expect(invalidations.mock.calls.filter(([options]) => String(options?.queryKey?.[0]).startsWith("/api/timetable"))
      .every(([options]) => options?.queryKey?.[1] === 202)).toBe(true);
  });

  it("G. explicitly targets B on delete, including the originating slot identity", async () => {
    selected = b;
    setViewSessionId(101);
    render(view());
    await openOwnSlot();
    fireEvent.click(screen.getByTestId("button-modal-delete"));
    await waitFor(() => expect(timetableRequests("POST")).toHaveLength(1));
    expect(timetableRequests("POST")[0]).toMatchObject({ session: "202", body: {
      changes: [{ dayOfWeek: 0, period: 1, class: "5", section: "A", _delete: true }],
    } });
  });

  it("H. closes an A modal immediately on switching to B, so no stale save or delete runs", async () => {
    const rendered = render(view());
    await openOwnSlot();
    fireEvent.change(screen.getByTestId("input-modal-room"), { target: { value: "A room" } });
    selected = b;
    rendered.rerender(view());
    expect(screen.queryByTestId("button-modal-save")).toBeNull();
    expect(screen.queryByTestId("input-modal-room")).toBeNull();
    await selectGrid();
    expect(timetableRequests("POST")).toHaveLength(0);
  });

  it("I. reads archived B but disables add/edit and all modal mutation controls", async () => {
    selected = archivedB;
    render(view());
    await selectGrid();
    expect(screen.getByText("Session 202")).toBeTruthy();
    expect((screen.getByTestId("slot-own-0-1") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("button-add-slot-1-1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("slot-own-0-1"));
    expect(screen.queryByTestId("button-modal-save")).toBeNull();
    expect(timetableRequests("POST")).toHaveLength(0);
  });

  it("J. renders an empty fresh B without A schedule, class grid, or occupancy data", async () => {
    occupiedA = true;
    const rendered = render(view());
    await selectGrid();
    fireEvent.click(screen.getByTestId("button-add-slot-1-1"));
    expect(await screen.findByText("This slot is taken — save blocked")).toBeTruthy();
    emptyB = true;
    selected = b;
    rendered.rerender(view());
    await selectGrid();
    expect(screen.queryByText("Session 101")).toBeNull();
    expect(screen.queryByTestId("button-modal-save")).toBeNull();
    expect(screen.getByTestId("banner-no-structure")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-add-slot-1-1"));
    fireEvent.change(screen.getByTestId("select-modal-subject"), { target: { value: "Mathematics" } });
    await waitFor(() => expect((screen.getByTestId("button-modal-save") as HTMLButtonElement).disabled).toBe(false));
    const keys = queryClient.getQueryCache().findAll().map(q => q.queryKey);
    for (const id of [101, 202]) {
      expect(keys).toContainEqual(["/api/timetable/class-view", id, "5", "A"]);
      expect(keys).toContainEqual(["/api/timetable/structure", id, "5"]);
      expect(keys).toContainEqual(["/api/timetable/slot-check", id, "5", "A", 1, 1]);
    }
    expect(timetableRequests("GET").filter(r => r.url.startsWith("/api/timetable/slot-check")).map(r => r.session)).toEqual(["101", "202"]);
  });

  it("L. fails closed on unknown occupancy and displays read errors instead of empty/free data", async () => {
    rejectCollision = true;
    render(view());
    await selectGrid();
    fireEvent.click(screen.getByTestId("slot-own-0-1"));
    expect(await screen.findByText(/Slot availability could not be checked/)).toBeTruthy();
    expect((screen.getByTestId("button-modal-save") as HTMLButtonElement).disabled).toBe(true);
    expect(timetableRequests("POST")).toHaveLength(0);
  });

  it("L. does not render a failed class-view as an empty editable grid", async () => {
    rejectGrid = true;
    render(view());
    await waitFor(() => expect(screen.getAllByRole("combobox")).toHaveLength(2));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "5" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "A" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Class timetable could not be loaded \(503\)/);
    expect(screen.queryByTestId("explorer-cell-0-1")).toBeNull();
  });

  it("L. shows failed teacher and structure reads instead of silently using empty data", async () => {
    rejectTeacher = true;
    const rendered = render(view());
    expect((await screen.findByRole("alert")).textContent).toMatch(/Teacher timetable could not be loaded \(503\)/);
    cleanup();
    queryClient.clear();
    rejectTeacher = false;
    rejectStructure = true;
    render(view());
    await screen.findByTestId("tab-my-schedule");
    fireEvent.click(screen.getByTestId("tab-my-schedule"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Bell schedule could not be loaded \(503\)/);
  });
});