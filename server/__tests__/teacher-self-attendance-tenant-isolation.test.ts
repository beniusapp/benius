import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { todayInIST } from "@shared/ist-time";
import {
  attendanceCorrectionRequests,
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
let teacherBRecordId = 0;
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

async function request(path: string, method = "GET") {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie,
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

  const attendanceDate = todayInIST();
  const checkInTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const [recordA, recordB] = await db.insert(teacherSelfAttendance).values([
    {
      teacherId: teacherAId,
      schoolId: schoolA.id,
      attendanceDate,
      checkInTime,
      status: "Present",
    },
    {
      teacherId: teacherBId,
      schoolId: schoolB.id,
      attendanceDate,
      checkInTime,
      status: "Leave",
    },
  ]).returning({ id: teacherSelfAttendance.id });
  teacherARecordId = recordA.id;
  teacherBRecordId = recordB.id;

  await db.insert(attendanceCorrectionRequests).values([
    {
      teacherId: teacherAId,
      schoolId: schoolA.id,
      attendanceDate,
      requestedCheckIn: "09:00",
      requestedCheckOut: "16:00",
      reason: "School A correction",
      status: "Approved",
    },
    {
      teacherId: teacherAId,
      schoolId: schoolB.id,
      attendanceDate,
      requestedCheckIn: "10:00",
      requestedCheckOut: "17:00",
      reason: "School B correction",
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
    const result = await request("/api/teacher/self-attendance/today");

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: teacherARecordId,
      teacherId: teacherAId,
      schoolId: schoolIds[0],
    });
    expect(result.body.id).not.toBe(teacherBRecordId);
  });

  it("updates only the authenticated Teacher's school-owned record", async () => {
    const result = await request("/api/teacher/self-attendance/check-out", "POST");

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

  it("rejects a malformed self-attendance row carrying the authenticated Teacher ID under another school", async () => {
    await db.delete(teacherSelfAttendance).where(eq(teacherSelfAttendance.id, teacherARecordId));
    await db.update(teacherSelfAttendance)
      .set({ teacherId: teacherAId })
      .where(eq(teacherSelfAttendance.id, teacherBRecordId));

    const readResult = await request("/api/teacher/self-attendance/today");
    expect(readResult.status).toBe(200);
    expect(readResult.body).toBeNull();

    const updateResult = await request("/api/teacher/self-attendance/check-out", "POST");
    expect(updateResult.status).toBe(400);
    expect(updateResult.body).toEqual({ message: "Not checked in yet" });

    const [foreignRecord] = await db.select().from(teacherSelfAttendance)
      .where(eq(teacherSelfAttendance.id, teacherBRecordId));
    expect(foreignRecord.checkOutTime).toBeNull();
    expect(foreignRecord.schoolId).toBe(schoolIds[1]);
  });

  it("returns only the authenticated Teacher's school-owned correction history", async () => {
    const result = await request("/api/teacher/self-attendance/corrections");

    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(1);
    expect(result.body[0]).toMatchObject({
      teacherId: teacherAId,
      schoolId: schoolIds[0],
      reason: "School A correction",
    });
  });
});