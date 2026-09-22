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

async function makeHarness(role: "teacher" | "admin" = "teacher"): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "teacher-attendance-session-route-test",
    resave: false,
    saveUninitialized: false,
  }));
  app.use((req, _res, next) => {
    const rawSessionId = req.headers["x-view-session-id"];
    if (typeof rawSessionId === "string") {
      const sessionId = Number(rawSessionId);
      if (Number.isInteger(sessionId)) (req as any).viewSessionId = sessionId;
    }
    next();
  });
  app.post("/test/authenticate", (req, res) => {
    if (role === "teacher") req.session.teacherId = teacher.id;
    else req.session.userId = 999;
    req.session.schoolId = teacher.schoolId;
    req.session.userRole = role;
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
  sessionId: number | null = 777,
) {
  const response = await fetch(`${harness.baseUrl}/api/attendance`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: harness.cookie,
      ...(sessionId !== null ? { "x-view-session-id": String(sessionId) } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function getTeacherRoute(
  harness: Harness,
  path: string,
  sessionId?: number,
) {
  const response = await fetch(`${harness.baseUrl}${path}`, {
    headers: {
      cookie: harness.cookie,
      ...(sessionId ? { "x-view-session-id": String(sessionId) } : {}),
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function postTeacherRoute(harness: Harness, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: harness.cookie },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
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
  vi.spyOn(storage, "getStudentsByIdsForSchool").mockImplementation(async studentIds =>
    studentIds.map(id => ({ id, schoolId: teacher.schoolId })) as any
  );
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

describe("POST /api/attendance selected Session resolution", () => {
  it("resolves the selected tenant Session once and passes it with every existing field", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    const selectedSession = vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 777,
      schoolId: teacher.schoolId,
      isActive: true,
    } as any);
    const date = todayInIST();

    const result = await postAttendance(harness, validBody({ date }));

    expect(result.status).toBe(200);
    expect(selectedSession).toHaveBeenCalledTimes(1);
    expect(selectedSession).toHaveBeenCalledWith(777);
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

  it("rejects the request without writing when the selected Session is invalid", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    const selectedSession = vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue(undefined);
    const activeSession = vi.spyOn(storage, "getActiveSession");
    const holiday = vi.spyOn(storage, "getHolidayOnDate");
    const upsert = vi.spyOn(storage, "upsertAttendance");

    const result = await postAttendance(harness, validBody());

    expect(result.status).toBe(403);
    expect(result.body.code).toBe("ATTENDANCE_SESSION_FORBIDDEN");
    expect(selectedSession).toHaveBeenCalledWith(777);
    expect(activeSession).not.toHaveBeenCalled();
    expect(holiday).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a selected Session belonging to another school", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    const selectedSession = vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 888,
      schoolId: teacher.schoolId + 1,
    } as any);
    const activeSession = vi.spyOn(storage, "getActiveSession");
    const upsert = vi.spyOn(storage, "upsertAttendance");

    const result = await postAttendance(harness, validBody(), 888);

    expect(result.status).toBe(403);
    expect(result.body.code).toBe("ATTENDANCE_SESSION_FORBIDDEN");
    expect(selectedSession).toHaveBeenCalledWith(888);
    expect(activeSession).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("requires the selected Session header", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    const selectedSession = vi.spyOn(storage, "getAcademicSessionById");
    const activeSession = vi.spyOn(storage, "getActiveSession");
    const upsert = vi.spyOn(storage, "upsertAttendance");

    const result = await postAttendance(harness, validBody(), null);

    expect(result.status).toBe(400);
    expect(result.body.code).toBe("ATTENDANCE_SESSION_REQUIRED");
    expect(selectedSession).not.toHaveBeenCalled();
    expect(activeSession).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("ignores a body-supplied Session and writes the validated header Session", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    const selectedSession = vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 777,
      schoolId: teacher.schoolId,
    } as any);

    const result = await postAttendance(harness, validBody({ sessionId: 999_999 }));

    expect(result.status).toBe(200);
    const [records] = upsert.mock.calls[0];
    expect(records.every(record => record.sessionId === 777)).toBe(true);
    expect(selectedSession).toHaveBeenCalledWith(777);
    expect(storage.getActiveSession).not.toHaveBeenCalled();
  });

  it.each([
    ["future", addCalendarDays(todayInIST(), 1)],
    ["older than seven days", addCalendarDays(todayInIST(), -8)],
  ])("preserves the %s date restriction", async (_label, date) => {
    const harness = await makeHarness();
    const teacherLookup = vi.spyOn(storage, "getTeacherById");
    const activeSession = vi.spyOn(storage, "getActiveSession");
    const selectedSession = vi.spyOn(storage, "getAcademicSessionById");
    const upsert = vi.spyOn(storage, "upsertAttendance");

    const result = await postAttendance(harness, validBody({ date }));

    expect(result.status).toBe(400);
    expect(teacherLookup).not.toHaveBeenCalled();
    expect(activeSession).not.toHaveBeenCalled();
    expect(selectedSession).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("preserves the school-holiday restriction", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 777,
      schoolId: teacher.schoolId,
    } as any);
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

  it("rejects the whole request when any submitted Student is outside the Teacher's school", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 777,
      schoolId: teacher.schoolId,
    } as any);
    vi.mocked(storage.getStudentsByIdsForSchool).mockResolvedValue([
      { id: 101, schoolId: teacher.schoolId },
    ] as any);

    const result = await postAttendance(harness, validBody());

    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      message: "One or more students are not valid for this school",
    });
    expect(storage.getStudentsByIdsForSchool).toHaveBeenCalledWith(
      [101, 102],
      teacher.schoolId,
    );
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/leave calendar-date validation", () => {
  const validLeave = {
    leaveType: "Casual",
    startDate: "2026-12-31",
    endDate: "2027-01-02",
    reason: "Family event",
  };

  function mockLeaveDependencies() {
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    vi.spyOn(storage, "getActiveLeavePoliciesBySchool").mockResolvedValue([
      { id: 91, name: "Casual" },
    ] as any);
    vi.spyOn(storage, "getTeacherLeaveBalanceByPolicies").mockResolvedValue([
      { policyId: 91, remaining: 10 },
    ] as any);
    vi.spyOn(storage, "getActiveSession").mockResolvedValue({ id: 777 } as any);
    return vi.spyOn(storage, "createLeaveRequest").mockImplementation(async data => ({ id: 1, ...data }) as any);
  }

  it("accepts exact date-only values and counts inclusive days across a year boundary", async () => {
    const harness = await makeHarness();
    const create = mockLeaveDependencies();
    const result = await postTeacherRoute(harness, "/api/leave", validLeave);
    expect(result.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      startDate: "2026-12-31",
      endDate: "2027-01-02",
    }));
  });

  it.each(["2026-12-31T00:00:00Z", "2026/12/31", "2026-02-30"])(
    "rejects non-date-only startDate %s",
    async startDate => {
      const harness = await makeHarness();
      vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
      const result = await postTeacherRoute(harness, "/api/leave", { ...validLeave, startDate });
      expect(result.status).toBe(400);
      expect(result.body.message).toBe("Invalid date range");
    },
  );
});

describe("PATCH /api/leave/:id/status Session validation", () => {
  const leave = {
    id: 55,
    teacherId: teacher.id,
    schoolId: teacher.schoolId,
    startDate: "2026-03-30",
    endDate: "2026-04-03",
  };

  it("rejects approval with no leave Session before status mutation", async () => {
    const harness = await makeHarness("admin");
    vi.spyOn(storage, "getLeaveRequestById").mockResolvedValue({ ...leave, sessionId: null } as any);
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    const update = vi.spyOn(storage, "updateLeaveStatusWithApprover");
    const result = await fetch(`${harness.baseUrl}/api/leave/55/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: harness.cookie },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(result.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a foreign leave Session before status mutation", async () => {
    const harness = await makeHarness("admin");
    vi.spyOn(storage, "getLeaveRequestById").mockResolvedValue({ ...leave, sessionId: 888 } as any);
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 888, schoolId: teacher.schoolId + 1, startDate: "2026-04-01", endDate: "2027-03-31",
    } as any);
    const update = vi.spyOn(storage, "updateLeaveStatusWithApprover");
    const result = await fetch(`${harness.baseUrl}/api/leave/55/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: harness.cookie },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(result.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("Teacher Attendance read Session isolation", () => {
  it("passes a validated tenant Session to the daily Attendance storage reader", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 777,
      schoolId: teacher.schoolId,
      isActive: true,
    } as any);
    vi.spyOn(storage, "getAttendanceRosterForSessionClass").mockResolvedValue([
      { id: 101, name: "Student", digitalStudentId: "S-101" },
    ] as any);
    const read = vi.spyOn(storage, "getAttendanceForStudentsOnDate").mockResolvedValue([]);

    const result = await getTeacherRoute(
      harness,
      `/api/attendance/${teacher.schoolId}/1/A/${todayInIST()}`,
      777,
    );

    expect(result.status).toBe(200);
    expect(storage.getAcademicSessionById).toHaveBeenCalledWith(777);
    expect(read).toHaveBeenCalledWith(
      teacher.schoolId, 777, [101], "1", "A", todayInIST(),
    );
  });

  it("fails the daily Attendance read closed when Session context is missing", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    const read = vi.spyOn(storage, "getAttendanceForStudentsOnDate");

    const result = await getTeacherRoute(
      harness,
      `/api/attendance/${teacher.schoolId}/1/A/${todayInIST()}`,
    );

    expect(result.status).toBe(400);
    expect(result.body.code).toBe("ATTENDANCE_SESSION_REQUIRED");
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects another school's Session before reading Attendance", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 888,
      schoolId: teacher.schoolId + 1,
      isActive: false,
    } as any);
    const read = vi.spyOn(storage, "getAttendanceForStudentsOnDate");

    const result = await getTeacherRoute(
      harness,
      `/api/attendance/${teacher.schoolId}/1/A/${todayInIST()}`,
      888,
    );

    expect(result.status).toBe(403);
    expect(result.body.code).toBe("ATTENDANCE_SESSION_FORBIDDEN");
    expect(read).not.toHaveBeenCalled();
  });

  it("passes a validated tenant Session to Attendance history", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 777,
      schoolId: teacher.schoolId,
    } as any);
    const history = vi.spyOn(storage, "getAttendanceHistory").mockResolvedValue([]);

    const result = await getTeacherRoute(
      harness,
      `/api/attendance/history/${teacher.schoolId}/1/A/2040-04-01/2041-03-31`,
      777,
    );

    expect(result.status).toBe(200);
    expect(history).toHaveBeenCalledWith(
      teacher.schoolId, 777, "1", "A", "2040-04-01", "2041-03-31",
    );
  });

  it.each([
    ["malformed start date", "not-a-date", "2041-03-31"],
    ["malformed end date", "2040-04-01", "not-a-date"],
    ["reversed dates", "2041-03-31", "2040-04-01"],
  ])("rejects %s before reading Attendance history", async (_label, startDate, endDate) => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    const selectedSession = vi.spyOn(storage, "getAcademicSessionById");
    const history = vi.spyOn(storage, "getAttendanceHistory");

    const result = await getTeacherRoute(
      harness,
      `/api/attendance/history/${teacher.schoolId}/1/A/${startDate}/${endDate}`,
      777,
    );

    expect(result.status).toBe(400);
    expect(result.body.message).toBe("Invalid Attendance date range");
    expect(selectedSession).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it("uses the authenticated school's active Session for completion status", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    vi.spyOn(storage, "getActiveSession").mockResolvedValue({
      id: 777,
      schoolId: teacher.schoolId,
    } as any);
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 777,
      schoolId: teacher.schoolId,
    } as any);
    const completion = vi.spyOn(storage, "hasAttendanceToday").mockResolvedValue(true);

    const result = await getTeacherRoute(
      harness,
      `/api/attendance/status/${teacher.id}`,
    );

    expect(result.status).toBe(200);
    expect(result.body.done).toBe(true);
    expect(completion).toHaveBeenCalledWith(
      teacher.id, teacher.assignedClass, teacher.assignedSection,
      teacher.schoolId, 777,
    );
  });
});