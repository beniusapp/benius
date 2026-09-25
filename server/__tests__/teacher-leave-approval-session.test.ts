import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import { addCalendarDays, todayInIST } from "@shared/ist-time";
import {
  academicSessions,
  leaveRequests,
  schools,
  teacherSelfAttendance,
  teachers,
  users,
} from "@shared/schema";
import { db } from "../db";
import { registerTeacherRoutes } from "../teacher-routes";
import { checkSessionContext } from "../routes";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let schoolId = 0;
let foreignSchoolId = 0;
let teacherId = 0;
let adminId = 0;
let activeSessionId = 0;
let archivedSessionId = 0;
let foreignSessionId = 0;
const servers: Server[] = [];

async function makeHarness() {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "teacher-leave-approval-session-test",
    resave: false,
    saveUninitialized: false,
  }));
  app.use(checkSessionContext);
  app.post("/test/authenticate", (req, res) => {
    req.session.userId = adminId;
    req.session.schoolId = schoolId;
    req.session.userRole = "admin";
    res.json({ ok: true });
  });
  registerTeacherRoutes(app);

  const server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const auth = await fetch(`${baseUrl}/test/authenticate`, { method: "POST" });
  const cookie = auth.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Test authentication did not return a session cookie");
  return { baseUrl, cookie };
}

async function createLeave(sessionId: number, status = "pending") {
  const date = todayInIST();
  const [leave] = await db.insert(leaveRequests).values({
    teacherId,
    schoolId,
    policyId: null,
    leaveType: "Casual",
    startDate: date,
    endDate: date,
    reason: "Session approval test",
    status,
    sessionId,
  }).returning();
  return leave;
}

async function patchStatus(
  harness: { baseUrl: string; cookie: string },
  leaveId: number,
  status: "approved" | "rejected",
) {
  const response = await fetch(`${harness.baseUrl}/api/leave/${leaveId}/status`, {
    method: "PATCH",
    headers: {
      cookie: harness.cookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

beforeAll(async () => {
  const [school] = await db.insert(schools).values({
    name: `Teacher Leave Approval ${suffix}`,
    code: `TLA-${suffix.slice(-8)}`,
  }).returning();
  schoolId = school.id;

  const [foreignSchool] = await db.insert(schools).values({
    name: `Foreign Leave Approval ${suffix}`,
    code: `FLA-${suffix.slice(-8)}`,
  }).returning();
  foreignSchoolId = foreignSchool.id;

  const [teacherUser, adminUser] = await db.insert(users).values([
    {
      email: `teacher-leave-${suffix}@example.test`,
      passwordHash: "test-only",
      role: "teacher",
      schoolId,
    },
    {
      email: `admin-leave-${suffix}@example.test`,
      passwordHash: "test-only",
      role: "admin",
      schoolId,
    },
  ]).returning();
  adminId = adminUser.id;

  const [teacher] = await db.insert(teachers).values({
    userId: teacherUser.id,
    schoolId,
    fullName: "Teacher Leave Approval Test",
    phone: `9${String(teacherUser.id).padStart(9, "0").slice(-9)}`,
    subject: "Attendance",
    assignedClass: "5",
    assignedSection: "A",
  }).returning();
  teacherId = teacher.id;

  const [active, archived] = await db.insert(academicSessions).values([
    {
      schoolId,
      sessionName: `Active Leave ${suffix}`,
      startDate: addCalendarDays(todayInIST(), -30),
      endDate: addCalendarDays(todayInIST(), 30),
      isActive: true,
    },
    {
      schoolId,
      sessionName: `Archived Leave ${suffix}`,
      startDate: addCalendarDays(todayInIST(), -30),
      endDate: addCalendarDays(todayInIST(), 30),
      isActive: false,
    },
  ]).returning();
  activeSessionId = active.id;
  archivedSessionId = archived.id;

  const [foreignSession] = await db.insert(academicSessions).values({
    schoolId: foreignSchoolId,
    sessionName: `Foreign Leave ${suffix}`,
    startDate: addCalendarDays(todayInIST(), -30),
    endDate: addCalendarDays(todayInIST(), 30),
    isActive: true,
  }).returning();
  foreignSessionId = foreignSession.id;
}, 30_000);

beforeEach(async () => {
  await db.delete(leaveRequests).where(eq(leaveRequests.schoolId, schoolId));
  await db.delete(teacherSelfAttendance).where(eq(teacherSelfAttendance.schoolId, schoolId));
});

afterAll(async () => {
  await Promise.all(servers.splice(0).map(server =>
    new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    )
  ));
  if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId));
  if (foreignSchoolId) await db.delete(schools).where(eq(schools.id, foreignSchoolId));
}, 30_000);

describe("PATCH /api/leave/:id/status Teacher Attendance Session guard", () => {
  it("approves an active-Session leave and synchronizes Teacher self-attendance", async () => {
    const leave = await createLeave(activeSessionId);
    const harness = await makeHarness();

    const result = await patchStatus(harness, leave.id, "approved");

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: leave.id, status: "approved" });
    expect(await db.select().from(teacherSelfAttendance).where(and(
      eq(teacherSelfAttendance.teacherId, teacherId),
      eq(teacherSelfAttendance.schoolId, schoolId),
      eq(teacherSelfAttendance.sessionId, activeSessionId),
      eq(teacherSelfAttendance.attendanceDate, todayInIST()),
    ))).toEqual([
      expect.objectContaining({ status: "Leave", totalWorkingMinutes: 0 }),
    ]);
  });

  it("rejects an archived-Session approval before changing leave status or self-attendance", async () => {
    const leave = await createLeave(archivedSessionId);
    const [existing] = await db.insert(teacherSelfAttendance).values({
      teacherId,
      schoolId,
      sessionId: archivedSessionId,
      attendanceDate: todayInIST(),
      status: "Not Marked",
      totalWorkingMinutes: 0,
    }).returning();
    const harness = await makeHarness();

    const result = await patchStatus(harness, leave.id, "approved");

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "ARCHIVE_READ_ONLY" });
    const [unchangedLeave] = await db.select().from(leaveRequests)
      .where(eq(leaveRequests.id, leave.id));
    const [unchangedAttendance] = await db.select().from(teacherSelfAttendance)
      .where(eq(teacherSelfAttendance.id, existing.id));
    expect(unchangedLeave.status).toBe("pending");
    expect(unchangedAttendance).toMatchObject({ id: existing.id, status: "Not Marked" });
  });

  it("rejects a leave whose Session belongs to another school before mutation", async () => {
    const leave = await createLeave(foreignSessionId);
    const harness = await makeHarness();

    const result = await patchStatus(harness, leave.id, "approved");

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ message: "Leave request Session is not valid for this school" });
    const [unchangedLeave] = await db.select().from(leaveRequests)
      .where(eq(leaveRequests.id, leave.id));
    expect(unchangedLeave.status).toBe("pending");
    expect(await db.select().from(teacherSelfAttendance).where(
      eq(teacherSelfAttendance.schoolId, schoolId),
    )).toEqual([]);
  });

  it("preserves rejection behavior without requiring an active leave Session", async () => {
    const leave = await createLeave(archivedSessionId);
    const harness = await makeHarness();

    const result = await patchStatus(harness, leave.id, "rejected");

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: leave.id, status: "rejected" });
    expect(await db.select().from(teacherSelfAttendance).where(
      eq(teacherSelfAttendance.schoolId, schoolId),
    )).toEqual([]);
  });
});