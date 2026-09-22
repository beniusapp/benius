import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { todayInIST } from "@shared/ist-time";
import {
  academicSessions,
  attendanceCorrectionRequests,
  schools,
  teacherSelfAttendance,
  teachers,
  users,
} from "@shared/schema";
import { db } from "../db";
import { registerTeacherRoutes } from "../teacher-routes";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
let schoolId = 0;
let sessionAId = 0;
let sessionBId = 0;
let teacherId = 0;
let secondTeacherId = 0;
let server: Server;
let baseUrl = "";
let cookie = "";

async function createTeacher(label: string) {
  const [user] = await db.insert(users).values({
    email: `self-session-${label}-${suffix}@example.test`,
    passwordHash: "test-only",
    role: "teacher",
    schoolId,
  }).returning({ id: users.id });
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId,
    fullName: `Session Regression ${label}`,
    phone: `7${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Attendance",
    assignedClass: "5",
    assignedSection: "A",
  }).returning({ id: teachers.id });
  return teacher.id;
}

async function request(
  path: string,
  selectedSessionId: number,
  method = "GET",
  body: Record<string, unknown> = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie,
      "x-view-session-id": String(selectedSessionId),
      ...(method !== "GET" ? { "content-type": "application/json" } : {}),
    },
    ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() as any };
}

function attendanceValues(overrides: Record<string, unknown> = {}) {
  return {
    teacherId,
    schoolId,
    sessionId: sessionAId,
    attendanceDate: todayInIST(),
    checkInTime: new Date(Date.now() - 60 * 60 * 1000),
    status: "Present",
    ...overrides,
  };
}

beforeAll(async () => {
  const [school] = await db.insert(schools).values({
    name: `Self Session Regression ${suffix}`,
    code: `SSR-${suffix.slice(-8)}`,
  }).returning({ id: schools.id });
  schoolId = school.id;
  teacherId = await createTeacher("primary");
  secondTeacherId = await createTeacher("secondary");
  const [sessionA, sessionB] = await db.insert(academicSessions).values([
    {
      schoolId,
      sessionName: `Session A ${suffix}`,
      startDate: "2025-04-01",
      endDate: "2041-03-31",
      isActive: true,
      status: "active",
    },
    {
      schoolId,
      sessionName: `Session B ${suffix}`,
      startDate: "2025-04-01",
      endDate: "2042-03-31",
      isActive: false,
      status: "archived",
    },
  ]).returning({ id: academicSessions.id });
  sessionAId = sessionA.id;
  sessionBId = sessionB.id;

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "teacher-self-attendance-session-regressions",
    resave: false,
    saveUninitialized: false,
  }));
  app.use((req, _res, next) => {
    const raw = req.headers["x-view-session-id"];
    if (typeof raw === "string" && Number.isInteger(Number(raw))) {
      (req as any).viewSessionId = Number(raw);
    }
    next();
  });
  app.post("/test/authenticate", (req, res) => {
    req.session.teacherId = teacherId;
    req.session.schoolId = schoolId;
    req.session.userRole = "teacher";
    res.json({ ok: true });
  });
  registerTeacherRoutes(app);
  server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const auth = await fetch(`${baseUrl}/test/authenticate`, { method: "POST" });
  cookie = auth.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!cookie) throw new Error("Authentication did not return a cookie");
}, 30_000);

beforeEach(async () => {
  await db.delete(attendanceCorrectionRequests).where(
    inArray(attendanceCorrectionRequests.teacherId, [teacherId, secondTeacherId]),
  );
  await db.delete(teacherSelfAttendance).where(
    inArray(teacherSelfAttendance.teacherId, [teacherId, secondTeacherId]),
  );
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    );
  }
  if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId));
});

describe("Teacher self-attendance Session regression coverage", () => {
  it("enforces teacher, Session, and date uniqueness while allowing valid neighboring identities", async () => {
    const date = todayInIST();
    await db.insert(teacherSelfAttendance).values(attendanceValues());

    await expect(
      db.insert(teacherSelfAttendance).values(attendanceValues()),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(db.insert(teacherSelfAttendance).values(
      attendanceValues({ sessionId: sessionBId }),
    )).resolves.toBeDefined();
    await expect(db.insert(teacherSelfAttendance).values(
      attendanceValues({ teacherId: secondTeacherId }),
    )).resolves.toBeDefined();

    const rows = await db.select().from(teacherSelfAttendance).where(
      eq(teacherSelfAttendance.attendanceDate, date),
    );
    expect(rows.filter(row => [teacherId, secondTeacherId].includes(row.teacherId))).toHaveLength(3);
  });

  it("cannot check out, correct, or status-heal a Session B-only row from Session A", async () => {
    const today = todayInIST();
    const [sessionBRecord] = await db.insert(teacherSelfAttendance).values(
      attendanceValues({ sessionId: sessionBId, status: "Absent" }),
    ).returning();

    const checkout = await request("/api/teacher/self-attendance/check-out", sessionAId, "POST");
    expect(checkout.status).toBe(400);
    expect(checkout.body.message).toBe("Not checked in yet");

    const todayRead = await request("/api/teacher/self-attendance/today", sessionAId);
    expect(todayRead.status).toBe(200);
    expect(todayRead.body).toBeNull();

    const correction = await request("/api/teacher/self-attendance/correction", sessionAId, "POST", {
      date: today,
      requestedCheckIn: "09:00",
      requestedCheckOut: "16:00",
      reason: "Session A correction",
    });
    expect(correction.status).toBe(200);
    expect(correction.body.attendanceRecord.sessionId).toBe(sessionAId);

    const [unchangedB] = await db.select().from(teacherSelfAttendance).where(
      eq(teacherSelfAttendance.id, sessionBRecord.id),
    );
    expect(unchangedB.sessionId).toBe(sessionBId);
    expect(unchangedB.status).toBe("Absent");
    expect(unchangedB.checkOutTime).toBeNull();
  });

  it("excludes legacy NULL-Session rows from today, history, check-in, and correction lookups", async () => {
    const today = todayInIST();
    const [legacyToday] = await db.insert(teacherSelfAttendance).values(
      attendanceValues({ sessionId: null, status: "Absent" }),
    ).returning();

    expect((await request("/api/teacher/self-attendance/today", sessionAId)).body).toBeNull();
    const historyBefore = await request(
      `/api/teacher/self-attendance/history?startDate=${today}&endDate=${today}`,
      sessionAId,
    );
    expect(historyBefore.body).toEqual([]);

    const checkIn = await request("/api/teacher/self-attendance/check-in", sessionAId, "POST");
    expect(checkIn.status).toBe(200);
    expect(checkIn.body.sessionId).toBe(sessionAId);

    const correction = await request("/api/teacher/self-attendance/correction", sessionBId, "POST", {
      date: today,
      requestedCheckIn: "09:15",
      requestedCheckOut: "16:15",
      reason: "Session B correction beside legacy row",
    });
    expect(correction.status).toBe(200);
    expect(correction.body.attendanceRecord.sessionId).toBe(sessionBId);

    const [unchangedLegacy] = await db.select().from(teacherSelfAttendance).where(
      eq(teacherSelfAttendance.id, legacyToday.id),
    );
    expect(unchangedLegacy.sessionId).toBeNull();
    expect(unchangedLegacy.status).toBe("Absent");
    expect(unchangedLegacy.checkOutTime).toBeNull();
  });

  it("keeps correction history and both history routes isolated by selected Session", async () => {
    const today = todayInIST();
    const [recordA, recordB] = await db.insert(teacherSelfAttendance).values([
      attendanceValues({ sessionId: sessionAId, status: "Present" }),
      attendanceValues({ sessionId: sessionBId, status: "Late" }),
    ]).returning();
    await db.insert(attendanceCorrectionRequests).values([
      {
        teacherId, schoolId, sessionId: sessionAId, attendanceDate: today,
        requestedCheckIn: "09:00", requestedCheckOut: "16:00",
        reason: "Session A history", status: "Approved",
      },
      {
        teacherId, schoolId, sessionId: sessionBId, attendanceDate: today,
        requestedCheckIn: "10:00", requestedCheckOut: "17:00",
        reason: "Session B history", status: "Approved",
      },
    ]);

    const correctionsA = await request("/api/teacher/self-attendance/corrections", sessionAId);
    expect(correctionsA.body).toHaveLength(1);
    expect(correctionsA.body[0]).toMatchObject({ sessionId: sessionAId, reason: "Session A history" });

    const historyA = await request(
      `/api/teacher/self-attendance/history?startDate=${today}&endDate=${today}`,
      sessionAId,
    );
    expect(historyA.body).toHaveLength(1);
    expect(historyA.body[0]).toMatchObject({ id: recordA.id, sessionId: sessionAId });

    const detailedA = await request(
      `/api/teacher/attendance/history?fromDate=${today}&toDate=${today}`,
      sessionAId,
    );
    expect(detailedA.body.records).toHaveLength(1);
    expect(detailedA.body.records[0]).toMatchObject({ id: recordA.id, sessionId: sessionAId });
    expect(detailedA.body.records[0].id).not.toBe(recordB.id);
  });
});