import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { registerTeacherRoutes } from "../teacher-routes";
import { checkSessionContext } from "../routes";
import { storage } from "../storage";

type Harness = {
  server: Server;
  baseUrl: string;
  cookie: string;
};

const schoolA = 12;
const schoolB = 13;
const sessionA = {
  id: 700,
  schoolId: schoolA,
  isActive: true,
  startDate: "2026-04-01",
  endDate: "2027-03-31",
};
const sessionB = {
  id: 701,
  schoolId: schoolB,
  isActive: true,
  startDate: "2026-04-01",
  endDate: "2027-03-31",
};
const summary = {
  total: 1,
  applicableTotal: 1,
  present: 1,
  absent: 0,
  leave: 0,
  late: 0,
  halfDay: 0,
  missing: 0,
  unknown: 0,
  percentage: 100,
};
const openServers: Server[] = [];

async function makeHarness(
  role: "admin" | "teacher" = "admin",
  authenticatedSchoolId = schoolA,
): Promise<Harness> {
  const app = express();
  app.use(session({
    secret: "attendance-daily-summary-route-test",
    resave: false,
    saveUninitialized: false,
  }));
  app.use(express.json());
  app.use(checkSessionContext);
  app.post("/test/authenticate", (req, res) => {
    req.session.userId = 999;
    req.session.schoolId = authenticatedSchoolId;
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

async function getDailySummary(
  harness: Harness,
  schoolId: number,
  date: string,
  sessionId?: number,
) {
  const response = await fetch(
    `${harness.baseUrl}/api/attendance/daily-summary/${schoolId}/${date}`,
    {
      headers: {
        cookie: harness.cookie,
        ...(sessionId === undefined ? {} : { "x-view-session-id": String(sessionId) }),
      },
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openServers.splice(0).map(server =>
    new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    )
  ));
});

describe("GET /api/attendance/daily-summary/:schoolId/:date", () => {
  beforeEach(() => {
    vi.spyOn(storage, "getAcademicSessionById").mockImplementation(async id => {
      if (id === sessionA.id) return sessionA as any;
      if (id === sessionB.id) return sessionB as any;
      return undefined;
    });
    vi.spyOn(storage, "getDailyAttendanceSummary").mockResolvedValue(summary);
  });

  it("allows an authenticated admin to read the same school's valid date", async () => {
    const summaryQuery = vi.mocked(storage.getDailyAttendanceSummary);
    const harness = await makeHarness("admin", schoolA);

    const result = await getDailySummary(harness, schoolA, "2026-09-24", sessionA.id);

    expect(result.status).toBe(200);
    expect(result.body).toEqual(summary);
    expect(summaryQuery).toHaveBeenCalledWith(schoolA, sessionA.id, "2026-09-24");
  });

  it("rejects a same-session request whose URL school differs from the authenticated school", async () => {
    const summaryQuery = vi.mocked(storage.getDailyAttendanceSummary);
    const harness = await makeHarness("admin", schoolA);

    const result = await getDailySummary(harness, schoolB, "2026-09-24", sessionA.id);

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ message: "Not authorized" });
    expect(summaryQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-admin authenticated role", async () => {
    const summaryQuery = vi.mocked(storage.getDailyAttendanceSummary);
    const harness = await makeHarness("teacher", schoolA);

    const result = await getDailySummary(harness, schoolA, "2026-09-24", sessionA.id);

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ message: "Admin access required" });
    expect(summaryQuery).not.toHaveBeenCalled();
  });

  it("rejects a date before the selected session", async () => {
    const summaryQuery = vi.mocked(storage.getDailyAttendanceSummary);
    const harness = await makeHarness("admin", schoolA);

    const result = await getDailySummary(harness, schoolA, "2026-03-31", sessionA.id);

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      code: "ATTENDANCE_DATE_OUTSIDE_SESSION",
    });
    expect(summaryQuery).not.toHaveBeenCalled();
  });

  it("rejects a date after the selected session", async () => {
    const summaryQuery = vi.mocked(storage.getDailyAttendanceSummary);
    const harness = await makeHarness("admin", schoolA);

    const result = await getDailySummary(harness, schoolA, "2027-04-01", sessionA.id);

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      code: "ATTENDANCE_DATE_OUTSIDE_SESSION",
    });
    expect(summaryQuery).not.toHaveBeenCalled();
  });

  it("allows an inclusive selected-session boundary date", async () => {
    const summaryQuery = vi.mocked(storage.getDailyAttendanceSummary);
    const harness = await makeHarness("admin", schoolA);

    const result = await getDailySummary(harness, schoolA, sessionA.startDate, sessionA.id);

    expect(result.status).toBe(200);
    expect(summaryQuery).toHaveBeenCalledWith(schoolA, sessionA.id, sessionA.startDate);
  });

  it("rejects a selected session owned by another school", async () => {
    vi.mocked(storage.getAcademicSessionById).mockResolvedValue(sessionB as any);
    const summaryQuery = vi.mocked(storage.getDailyAttendanceSummary);
    const harness = await makeHarness("admin", schoolA);

    const result = await getDailySummary(harness, schoolA, "2026-09-24", sessionB.id);

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({
      code: "ATTENDANCE_SESSION_FORBIDDEN",
    });
    expect(summaryQuery).not.toHaveBeenCalled();
  });
});