import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { todayInIST } from "@shared/ist-time";
import {
  attendanceCorrectionRequests,
  academicSessions,
  schools,
  teacherSelfAttendance,
  teachers,
  users,
} from "@shared/schema";
import { db } from "../db";
import { registerTeacherRoutes } from "../teacher-routes";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const schoolIds: number[] = [];
let teacherAId = 0;
let teacherBId = 0;
let teacherARecordId = 0;
let teacherASessionBRecordId = 0;
let teacherBRecordId = 0;
let sessionAId = 0;
let sessionBId = 0;
let foreignSessionId = 0;
let server: Server;
let baseUrl = "";
let cookie = "";

async function createTeacher(schoolId: number, label: string) {
  const [user] = await db.insert(users).values({
    email: `self-attendance-${label}-${suffix}@example.test`,
    passwordHash: "test-only",
    role: "teacher",
    schoolId,
  }).returning({ id: users.id });
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId,
    fullName: `Self Attendance Teacher ${label}`,
    phone: `8${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Attendance",
    assignedClass: "5",
    assignedSection: "A",
  }).returning({ id: teachers.id });
  return teacher.id;
}

async function request(path: string, sessionId: number, method = "GET") {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie,
      "x-view-session-id": String(sessionId),
      ...(method !== "GET" ? { "content-type": "application/json" } : {}),
    },
    ...(method !== "GET" ? { body: "{}" } : {}),
  });
  return {
    status: response.status,
    body: await response.json() as any,
  };
}

beforeAll(async () => {
  const [schoolA, schoolB] = await db.insert(schools).values([
    { name: `Self Attendance A ${suffix}`, code: `SAA-${suffix.slice(-8)}` },
    { name: `Self Attendance B ${suffix}`, code: `SAB-${suffix.slice(-8)}` },
  ]).returning({ id: schools.id });
  schoolIds.push(schoolA.id, schoolB.id);
  teacherAId = await createTeacher(schoolA.id, "a");
  teacherBId = await createTeacher(schoolB.id, "b");

  const [sessionA, sessionB] = await db.insert(academicSessions).values([
    {
      schoolId: schoolA.id,
      sessionName: `Self-Attendance-A-${suffix}`,
      startDate: "2025-04-01",
      endDate: "2041-03-31",
      isActive: true,
      status: "active",
    },
    {
      schoolId: schoolA.id,
      sessionName: `Self-Attendance-B-${suffix}`,
      startDate: "2025-04-01",
      endDate: "2042-03-31",
      isActive: true,
      status: "active",
    },
  ]).returning({ id: academicSessions.id });
  sessionAId = sessionA.id;
  sessionBId = sessionB.id;
  const [foreignSession] = await db.insert(academicSessions).values({
    schoolId: schoolB.id,
    sessionName: `Self-Attendance-Foreign-${suffix}`,
    startDate: "2025-04-01",
    endDate: "2041-03-31",
    isActive: true,
    status: "active",
  }).returning({ id: academicSessions.id });
  foreignSessionId = foreignSession.id;

  const attendanceDate = todayInIST();
  const checkInTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const [recordA, recordASessionB, recordB] = await db.insert(teacherSelfAttendance).values([
    {
      teacherId: teacherAId,
      schoolId: schoolA.id,
      sessionId: sessionAId,
      attendanceDate,
      checkInTime,
      status: "Present",
    },
    {
      teacherId: teacherAId,
      schoolId: schoolA.id,
      sessionId: sessionBId,
      attendanceDate,
      checkInTime,
      status: "Late",
    },
    {
      teacherId: teacherBId,
      schoolId: schoolB.id,
      sessionId: foreignSessionId,
      attendanceDate,
      checkInTime,
      status: "Leave",
    },
  ]).returning({ id: teacherSelfAttendance.id });
  teacherARecordId = recordA.id;
  teacherASessionBRecordId = recordASessionB.id;
  teacherBRecordId = recordB.id;

  await db.insert(attendanceCorrectionRequests).values([
    {
      teacherId: teacherAId,
      schoolId: schoolA.id,
      sessionId: sessionAId,
      attendanceDate,
      requestedCheckIn: "09:00",
      requestedCheckOut: "16:00",
      reason: "School A correction",
      status: "Approved",
    },
    {
      teacherId: teacherAId,
      schoolId: schoolA.id,
      sessionId: sessionBId,
      attendanceDate,
      requestedCheckIn: "10:00",
      requestedCheckOut: "17:00",
      reason: "Session B correction",
      status: "Approved",
    },
    {
      teacherId: teacherAId,
      schoolId: schoolB.id,
      sessionId: foreignSessionId,
      attendanceDate,
      requestedCheckIn: "11:00",
      requestedCheckOut: "18:00",
      reason: "Session B correction",
      status: "Approved",
    },
  ]);

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "teacher-self-attendance-tenant-isolation-test",
    resave: false,
    saveUninitialized: false,
  }));
  app.use((req, _res, next) => {
    const rawSessionId = req.headers["x-view-session-id"];
    if (typeof rawSessionId === "string") {
      const viewSessionId = Number(rawSessionId);
      if (Number.isInteger(viewSessionId)) (req as any).viewSessionId = viewSessionId;
    }
    next();
  });
  app.post("/test/authenticate", (req, res) => {
    req.session.teacherId = teacherAId;
    req.session.schoolId = schoolA.id;
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
  if (!cookie) throw new Error("Test authentication did not return a session cookie");
}, 30_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    );
  }
  if (schoolIds.length) {
    await db.delete(schools).where(inArray(schools.id, schoolIds));
  }
});

describe("Teacher self-attendance tenant isolation", () => {
  it("returns only the authenticated Teacher's school-owned record", async () => {
     const result = await request("/api/teacher/self-attendance/today", sessionAId);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: teacherARecordId,
      teacherId: teacherAId,
      schoolId: schoolIds[0],
    });
    expect(result.body.id).not.toBe(teacherBRecordId);
  });

  it("returns the same teacher/date from only the selected school-owned session", async () => {
    const sessionBResult = await request("/api/teacher/self-attendance/today", sessionBId);

    expect(sessionBResult.status).toBe(200);
    expect(sessionBResult.body).toMatchObject({
      id: teacherASessionBRecordId,
      teacherId: teacherAId,
      schoolId: schoolIds[0],
      sessionId: sessionBId,
    });
    expect(sessionBResult.body.id).not.toBe(teacherARecordId);
  });

  it("updates only the authenticated Teacher's school-owned record", async () => {
    const result = await request("/api/teacher/self-attendance/check-out", sessionAId, "POST");

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: teacherARecordId,
      teacherId: teacherAId,
      schoolId: schoolIds[0],
    });

    const [foreignRecord] = await db.select().from(teacherSelfAttendance)
      .where(eq(teacherSelfAttendance.id, teacherBRecordId));
    expect(foreignRecord.checkOutTime).toBeNull();
    expect(foreignRecord.status).toBe("Leave");
  });

  it("returns history only for the selected session", async () => {
    const [sessionAResult, sessionBResult] = await Promise.all([
      request(`/api/teacher/self-attendance/history?startDate=${todayInIST()}&endDate=${todayInIST()}`, sessionAId),
      request(`/api/teacher/self-attendance/history?startDate=${todayInIST()}&endDate=${todayInIST()}`, sessionBId),
    ]);

    expect(sessionAResult.status).toBe(200);
    expect(sessionAResult.body).toHaveLength(1);
    expect(sessionAResult.body[0]).toMatchObject({ id: teacherARecordId, sessionId: sessionAId });
    expect(sessionBResult.status).toBe(200);
    expect(sessionBResult.body).toHaveLength(1);
    expect(sessionBResult.body[0]).toMatchObject({ id: teacherASessionBRecordId, sessionId: sessionBId });
  });

  it("rejects a malformed self-attendance row carrying the authenticated Teacher ID under another school", async () => {
    await db.delete(teacherSelfAttendance).where(eq(teacherSelfAttendance.id, teacherARecordId));
    await db.update(teacherSelfAttendance).set({ teacherId: teacherAId })
      .where(eq(teacherSelfAttendance.id, teacherBRecordId));
    const readResult = await request("/api/teacher/self-attendance/today", sessionAId);
    expect(readResult.status).toBe(200);
    expect(readResult.body).toBeNull();
    const updateResult = await request("/api/teacher/self-attendance/check-out", sessionAId, "POST");
    expect(updateResult.status).toBe(400);
    expect(updateResult.body).toEqual({ message: "Not checked in yet" });
    const [foreignRecord] = await db.select().from(teacherSelfAttendance)
      .where(eq(teacherSelfAttendance.id, teacherBRecordId));
    expect(foreignRecord.checkOutTime).toBeNull();
    expect(foreignRecord.schoolId).toBe(schoolIds[1]);
  });

  it("returns only the authenticated Teacher's school-owned correction history", async () => {
    const result = await request("/api/teacher/self-attendance/corrections", sessionAId);

    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(1);
    expect(result.body[0]).toMatchObject({
      teacherId: teacherAId,
      schoolId: schoolIds[0],
      sessionId: sessionAId,
      reason: "School A correction",
    });
  });

  it("returns corrections only for the selected session", async () => {
    const sessionBResult = await request("/api/teacher/self-attendance/corrections", sessionBId);

    expect(sessionBResult.status).toBe(200);
    expect(sessionBResult.body).toHaveLength(1);
    expect(sessionBResult.body[0]).toMatchObject({
      teacherId: teacherAId,
      schoolId: schoolIds[0],
      sessionId: sessionBId,
      reason: "Session B correction",
    });
  });
});