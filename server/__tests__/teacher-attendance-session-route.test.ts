import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { addCalendarDays, getAcademicYearForISTDate, todayInIST } from "@shared/ist-time";
import { registerTeacherRoutes } from "../teacher-routes";
import { storage } from "../storage";

type Harness = {
  server: Server;
  baseUrl: string;
  cookie: string;
};

const teacher = {
  id: 321,
  schoolId: 12,
  fullName: "Attendance Teacher",
  assignedClass: "1",
  assignedSection: "A",
};

const openServers: Server[] = [];

async function makeHarness(): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "teacher-attendance-session-route-test",
    resave: false,
    saveUninitialized: false,
  }));
  app.post("/test/authenticate", (req, res) => {
    req.session.teacherId = teacher.id;
    req.session.schoolId = teacher.schoolId;
    req.session.userRole = "teacher";
    res.json({ ok: true });
  });
  registerTeacherRoutes(app);

  const server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  openServers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const auth = await fetch(`${baseUrl}/test/authenticate`, { method: "POST" });
  const cookie = auth.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Test authentication did not return a session cookie");
  return { server, baseUrl, cookie };
}

async function postAttendance(
  harness: Harness,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${harness.baseUrl}/api/attendance`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: harness.cookie,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    date: todayInIST(),
    class: "4",
    section: "B",
    records: [
      { studentId: 101, status: "present" },
      { studentId: 102, status: "absent" },
    ],
    ...overrides,
  };
}

function mockSuccessfulDependencies() {
  vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
  vi.spyOn(storage, "getActiveSession").mockResolvedValue({ id: 777 } as any);
  vi.spyOn(storage, "getHolidayOnDate").mockResolvedValue(undefined);
  return vi.spyOn(storage, "upsertAttendance").mockResolvedValue([]);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openServers.splice(0).map(server =>
    new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    )
  ));
});

describe("POST /api/attendance active Session resolution", () => {
  it("resolves the Teacher school's active Session once and passes it with every existing field", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    const activeSession = vi.mocked(storage.getActiveSession);
    const date = todayInIST();

    const result = await postAttendance(harness, validBody({ date }));

    expect(result.status).toBe(200);
    expect(activeSession).toHaveBeenCalledTimes(1);
    expect(activeSession).toHaveBeenCalledWith(teacher.schoolId);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [records] = upsert.mock.calls[0];
    expect(records).toHaveLength(2);
    expect(records).toEqual([
      expect.objectContaining({
        studentId: 101,
        teacherId: teacher.id,
        schoolId: teacher.schoolId,
        date,
        status: "present",
        markedBy: expect.stringContaining(teacher.fullName),
        class: "4",
        section: "B",
        academicYear: `${getAcademicYearForISTDate(date).slice(0, 4)}-${getAcademicYearForISTDate(date).slice(-2)}`,
        sessionId: 777,
      }),
      expect.objectContaining({
        studentId: 102,
        teacherId: teacher.id,
        schoolId: teacher.schoolId,
        date,
        status: "absent",
        markedBy: expect.stringContaining(teacher.fullName),
        class: "4",
        section: "B",
        sessionId: 777,
      }),
    ]);
  });

  it("rejects the request without writing when the Teacher's school has no active Session", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    const activeSession = vi.spyOn(storage, "getActiveSession").mockResolvedValue(undefined);
    const holiday = vi.spyOn(storage, "getHolidayOnDate");
    const upsert = vi.spyOn(storage, "upsertAttendance");

    const result = await postAttendance(harness, validBody());

    expect(result.status).toBe(409);
    expect(result.body).toEqual({ message: "No active academic session found" });
    expect(activeSession).toHaveBeenCalledOnce();
    expect(activeSession).toHaveBeenCalledWith(teacher.schoolId);
    expect(holiday).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("ignores a browser-supplied Session and uses the active Session selected from the Teacher's school", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();

    const result = await postAttendance(harness, validBody({ sessionId: 999_999 }));

    expect(result.status).toBe(200);
    const [records] = upsert.mock.calls[0];
    expect(records.every(record => record.sessionId === 777)).toBe(true);
    expect(storage.getActiveSession).toHaveBeenCalledWith(teacher.schoolId);
  });

  it.each([
    ["future", addCalendarDays(todayInIST(), 1)],
    ["older than seven days", addCalendarDays(todayInIST(), -8)],
  ])("preserves the %s date restriction", async (_label, date) => {
    const harness = await makeHarness();
    const teacherLookup = vi.spyOn(storage, "getTeacherById");
    const activeSession = vi.spyOn(storage, "getActiveSession");
    const upsert = vi.spyOn(storage, "upsertAttendance");

    const result = await postAttendance(harness, validBody({ date }));

    expect(result.status).toBe(400);
    expect(teacherLookup).not.toHaveBeenCalled();
    expect(activeSession).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("preserves the school-holiday restriction", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    vi.mocked(storage.getHolidayOnDate).mockResolvedValue({
      title: "School Holiday",
    } as any);

    const result = await postAttendance(harness, validBody());

    expect(result.status).toBe(423);
    expect(result.body).toEqual({
      message: 'Attendance is locked. "School Holiday" is a school-wide holiday.',
      holidayName: "School Holiday",
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});