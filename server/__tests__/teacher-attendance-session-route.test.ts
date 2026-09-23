import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { addCalendarDays, calendarWeekday, getAcademicYearForISTDate, todayInIST } from "@shared/ist-time";
import { academicSessions, attendanceRecords, schools, students, teachers, users } from "@shared/schema";
import { registerTeacherRoutes } from "../teacher-routes";
import { checkSessionContext } from "../routes";
import { db, pool } from "../db";
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
  app.use(checkSessionContext);
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

function mockSuccessfulDependencies(boundaries?: { startDate: string; endDate: string }) {
  vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
  vi.spyOn(storage, "getActiveSession").mockResolvedValue({
    id: 777, schoolId: teacher.schoolId, isActive: true,
    startDate: boundaries?.startDate ?? addCalendarDays(todayInIST(), -30),
    endDate: boundaries?.endDate ?? addCalendarDays(todayInIST(), 30),
  } as any);
  vi.spyOn(storage, "getHolidayOnDate").mockResolvedValue(undefined);
  vi.spyOn(storage, "getStudentsByIdsForSchool").mockImplementation(async studentIds =>
    studentIds.map(id => ({ id, schoolId: teacher.schoolId })) as any
  );
  vi.spyOn(storage, "getAttendanceRosterForSessionClass").mockResolvedValue([
    { id: 101 }, { id: 102 },
  ] as any);
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

describe("POST /api/attendance server-authoritative active Session", () => {
  it("writes a date strictly inside the active Session for every Student", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies({
      startDate: addCalendarDays(todayInIST(), -2),
      endDate: addCalendarDays(todayInIST(), 2),
    });
    const date = addCalendarDays(todayInIST(), -1);

    const result = await postAttendance(harness, validBody({ date }), null);

    expect(result.status).toBe(200);
    expect(storage.getActiveSession).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][0]).toHaveLength(2);
    expect(upsert.mock.calls[0][0].every(record => record.date === date && record.sessionId === 777)).toBe(true);
  });

  it.each([
    ["start", { startDate: todayInIST(), endDate: addCalendarDays(todayInIST(), 30) }, todayInIST()],
    ["end", { startDate: addCalendarDays(todayInIST(), -30), endDate: todayInIST() }, todayInIST()],
  ])("accepts the inclusive Session %s boundary", async (_edge, boundaries, date) => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies(boundaries);

    const result = await postAttendance(harness, validBody({ date }), null);

    expect(result.status).toBe(200);
    expect(upsert.mock.calls[0][0].every(record => record.date === date && record.sessionId === 777)).toBe(true);
  });

  it.each([
    ["before start", -2, -1, 30],
    ["after end", -2, -30, -3],
  ])("rejects a date immediately %s even within the correction window", async (_edge, dateOffset, startOffset, endOffset) => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies({
      startDate: addCalendarDays(todayInIST(), startOffset),
      endDate: addCalendarDays(todayInIST(), endOffset),
    });

    const result = await postAttendance(harness, validBody({ date: addCalendarDays(todayInIST(), dateOffset) }), null);

    expect(result.status).toBe(400);
    expect(result.body.message).toBe("Attendance date is outside the active academic session period");
    expect(storage.getActiveSession).toHaveBeenCalledWith(teacher.schoolId);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("still rejects an older date even when it is inside the active Session", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();

    const result = await postAttendance(harness, validBody({ date: addCalendarDays(todayInIST(), -8) }), null);

    expect(result.status).toBe(400);
    expect(result.body.message).toBe("Can only edit attendance for the past 7 days");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("still rejects a future date inside the active Session", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();

    const result = await postAttendance(harness, validBody({ date: addCalendarDays(todayInIST(), 1) }), null);

    expect(result.status).toBe(400);
    expect(result.body.message).toBe("Cannot mark attendance for future dates");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a deliberately marked Sunday outside the active Session", async () => {
    const harness = await makeHarness();
    const sunday = addCalendarDays(todayInIST(), -calendarWeekday(todayInIST())!);
    const upsert = mockSuccessfulDependencies({
      startDate: addCalendarDays(sunday, -30),
      endDate: addCalendarDays(sunday, -1),
    });

    const result = await postAttendance(harness, validBody({ date: sunday }), null);

    expect(result.status).toBe(400);
    expect(result.body.message).toBe("Attendance date is outside the active academic session period");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fails closed if the active Session has invalid date boundaries", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies({ startDate: "2026-02-30", endDate: todayInIST() });

    const result = await postAttendance(harness, validBody(), null);

    expect(result.status).toBe(409);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("resolves the authenticated school's active Session once for every Student", async () => {
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
    expect(storage.getActiveSession).toHaveBeenCalledOnce();
    expect(storage.getActiveSession).toHaveBeenCalledWith(teacher.schoolId);
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

  it("marks Attendance without any view-Session header", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    const selectedSession = vi.spyOn(storage, "getAcademicSessionById");

    const result = await postAttendance(harness, validBody(), null);

    expect(result.status).toBe(200);
    expect(storage.getActiveSession).toHaveBeenCalledWith(teacher.schoolId);
    expect(selectedSession).not.toHaveBeenCalled();
    expect(upsert.mock.calls[0][0].every(record => record.sessionId === 777)).toBe(true);
  });

  it("cannot override the server-resolved Session with another active same-school header", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 888,
      schoolId: teacher.schoolId,
      isActive: true,
    } as any);

    const result = await postAttendance(harness, validBody({ sessionId: 999_999 }), 888);

    expect(result.status).toBe(200);
    expect(storage.getActiveSession).toHaveBeenCalledWith(teacher.schoolId);
    expect(upsert.mock.calls[0][0].every(record => record.sessionId === 777)).toBe(true);
  });

  it("rejects a foreign school's header before writing", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 888, schoolId: teacher.schoolId + 1, isActive: true,
    } as any);

    const result = await postAttendance(harness, validBody(), 888);

    expect(result.status).toBe(403);
    expect(result.body.code).toBe("ARCHIVE_READ_ONLY");
    expect(storage.getActiveSession).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("keeps archived same-school Sessions read-only", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    vi.spyOn(storage, "getAcademicSessionById").mockResolvedValue({
      id: 888, schoolId: teacher.schoolId, isActive: false,
    } as any);

    const result = await postAttendance(harness, validBody(), 888);

    expect(result.status).toBe(403);
    expect(result.body.code).toBe("ARCHIVE_READ_ONLY");
    expect(storage.getActiveSession).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fails safely when the authenticated school has no active Session", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    const selectedSession = vi.spyOn(storage, "getAcademicSessionById");
    const activeSession = vi.spyOn(storage, "getActiveSession").mockResolvedValue(undefined);
    const upsert = vi.spyOn(storage, "upsertAttendance");

    const result = await postAttendance(harness, validBody(), null);

    expect(result.status).toBe(409);
    expect(result.body.code).toBe("ATTENDANCE_SESSION_UNAVAILABLE");
    expect(selectedSession).not.toHaveBeenCalled();
    expect(activeSession).toHaveBeenCalledWith(teacher.schoolId);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a Teacher whose school differs from the authenticated school", async () => {
    const harness = await makeHarness();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue({
      ...teacher, schoolId: teacher.schoolId + 1,
    } as any);
    const activeSession = vi.spyOn(storage, "getActiveSession");
    const upsert = vi.spyOn(storage, "upsertAttendance");

    const result = await postAttendance(harness, validBody(), null);

    expect(result.status).toBe(403);
    expect(activeSession).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["future", addCalendarDays(todayInIST(), 1)],
    ["older than seven days", addCalendarDays(todayInIST(), -8)],
  ])("preserves the %s date restriction", async (_label, date) => {
    const harness = await makeHarness();
    const teacherLookup = vi.spyOn(storage, "getTeacherById");
    const activeSession = vi.spyOn(storage, "getActiveSession");
    const upsert = vi.spyOn(storage, "upsertAttendance");

    const result = await postAttendance(harness, validBody({ date }), null);

    expect(result.status).toBe(400);
    expect(teacherLookup).not.toHaveBeenCalled();
    expect(activeSession).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([0, 1, 7])("preserves a date %i days ago as writable", async daysAgo => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    const date = addCalendarDays(todayInIST(), -daysAgo);

    const result = await postAttendance(harness, validBody({ date }), null);

    expect(result.status).toBe(200);
    expect(upsert.mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ date, sessionId: 777 })]),
    );
  });

  it("accepts deliberately marked Sunday under the active Session", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    let sunday = todayInIST();
    while (new Date(`${sunday}T12:00:00+05:30`).getUTCDay() !== 0) {
      sunday = addCalendarDays(sunday, -1);
    }

    const result = await postAttendance(harness, validBody({ date: sunday }), null);

    expect(result.status).toBe(200);
    expect(upsert.mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ date: sunday, sessionId: 777 })]),
    );
  });

  it("preserves the school-holiday restriction", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    vi.mocked(storage.getHolidayOnDate).mockResolvedValue({
      title: "School Holiday",
    } as any);

    const result = await postAttendance(harness, validBody(), null);

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
    vi.mocked(storage.getStudentsByIdsForSchool).mockResolvedValue([
      { id: 101, schoolId: teacher.schoolId },
    ] as any);

    const result = await postAttendance(harness, validBody(), null);

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

  it("rejects a class mismatch without changing Teacher class authorization", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    vi.mocked(storage.getAttendanceRosterForSessionClass).mockResolvedValue([{ id: 101 }] as any);

    const result = await postAttendance(harness, validBody(), null);
    expect(result.status).toBe(400);
    expect(result.body.message).toMatch(/do not belong to this class/);
    expect(storage.getAttendanceRosterForSessionClass).toHaveBeenCalledWith(
      teacher.schoolId, 777, "4", "B",
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("allows a same-school Teacher without a Faculty Mapping to mark another class's valid roster", async () => {
    const harness = await makeHarness();
    const upsert = mockSuccessfulDependencies();
    const result = await postAttendance(harness, validBody(), null);
    expect(result.status).toBe(200);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("rejects an unauthenticated Attendance mark", async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: "unauthenticated-attendance", resave: false, saveUninitialized: false }));
    registerTeacherRoutes(app);
    const server = await new Promise<Server>(resolve => {
      const next = app.listen(0, "127.0.0.1", () => resolve(next));
    });
    openServers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/attendance`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(validBody()),
    });
    expect(response.status).toBe(401);
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
  it("returns a deleted Student snapshot for an archived Session but not the active marking roster", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const date = todayInIST();
    let fixtureSchoolId: number | undefined;
    let sessionId: number | undefined;
    let studentId: number | undefined;
    let fixtureTeacherId: number | undefined;
    let fixtureUserId: number | undefined;

    try {
      const [fixtureSchool] = await db.insert(schools).values({
        name: `Route Fixture School ${suffix}`, code: `TR-${suffix.slice(-7)}`,
      }).returning({ id: schools.id });
      fixtureSchoolId = fixtureSchool.id;
      const [fixtureUser] = await db.insert(users).values({
        email: `teacher-attendance-route-${suffix}@example.test`,
        passwordHash: "test-only",
        role: "teacher",
        schoolId: fixtureSchool.id,
      }).returning({ id: users.id });
      fixtureUserId = fixtureUser.id;
      const [fixtureTeacher] = await db.insert(teachers).values({
        userId: fixtureUser.id,
        schoolId: fixtureSchool.id,
        fullName: `Route Fixture Teacher ${suffix}`,
        phone: "9000000099",
        subject: "Attendance",
        assignedClass: "1",
        assignedSection: "A",
      }).returning({ id: teachers.id });
      fixtureTeacherId = fixtureTeacher.id;
      const [fixtureSession] = await db.insert(academicSessions).values({
        schoolId: fixtureSchool.id,
        sessionName: `Route Fixture ${suffix}`,
        startDate: date,
        endDate: addCalendarDays(date, 30),
        isActive: false,
      }).returning({ id: academicSessions.id });
      sessionId = fixtureSession.id;
      const [fixtureStudent] = await db.insert(students).values({
        schoolId: fixtureSchool.id,
        digitalStudentId: `ROUTE-${suffix}`,
        name: "Deleted Route Student",
        class: "1",
        section: "A",
        phone: "9000000088",
        dob: "2015-01-01",
        passwordHash: "test-only",
      }).returning();
      studentId = fixtureStudent.id;
      await storage.upsertAttendance([{
        studentId: fixtureStudent.id,
        teacherId: fixtureTeacher.id,
        schoolId: fixtureSchool.id,
        sessionId: fixtureSession.id,
        date,
        status: "absent",
        class: "1",
        section: "A",
        markedBy: "Route Fixture Teacher",
      }]);

      // Physical deletion must leave the attendance row and its snapshots behind.
      await pool.query(`DELETE FROM "students" WHERE id = $1`, [fixtureStudent.id]);

      const harness = await makeHarness();
      vi.spyOn(storage, "getTeacherById").mockResolvedValue({ ...teacher, schoolId: fixtureSchool.id } as any);
      let archived = true;
      vi.spyOn(storage, "getAcademicSessionById").mockImplementation(async () => ({
        id: fixtureSession.id,
        schoolId: fixtureSchool.id,
        isActive: !archived,
      } as any));

      const historical = await getTeacherRoute(
        harness,
        `/api/attendance/${fixtureSchool.id}/1/A/${date}`,
        fixtureSession.id,
      );
      expect(historical.status).toBe(200);
      expect(historical.body).toEqual([expect.objectContaining({
        name: "Deleted Route Student",
        dsid: `ROUTE-${suffix}`,
        status: "absent",
        hasRecord: true,
      })]);

      archived = false;
      const live = await getTeacherRoute(
        harness,
        `/api/attendance/${fixtureSchool.id}/1/A/${date}`,
        fixtureSession.id,
      );
      expect(live.status).toBe(200);
      expect(live.body).toEqual([]);
    } finally {
      if (sessionId) await db.delete(attendanceRecords).where(eq(attendanceRecords.sessionId, sessionId));
      if (studentId) await pool.query(`DELETE FROM "students" WHERE id = $1`, [studentId]);
      if (sessionId) await db.delete(academicSessions).where(eq(academicSessions.id, sessionId));
      if (fixtureTeacherId) await db.delete(teachers).where(eq(teachers.id, fixtureTeacherId));
      if (fixtureUserId) await db.delete(users).where(eq(users.id, fixtureUserId));
      if (fixtureSchoolId) await db.delete(schools).where(eq(schools.id, fixtureSchoolId));
    }
  });

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