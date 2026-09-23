import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import { eq } from "drizzle-orm";
import { todayInIST } from "@shared/ist-time";
import {
  academicSessions, attendancePolicies, schools, teacherSelfAttendance, teachers, users,
} from "@shared/schema";
import { db } from "../db";
import { registerRoutes } from "../routes";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
let schoolId = 0;
let sessionId = 0;
let teacherId = 0;
let recordId = 0;
let policyId = 0;
let server: http.Server;
let baseUrl = "";

beforeAll(async () => {
  const [school] = await db.insert(schools).values({
    name: `Stored Status Admin ${suffix}`, code: `SSA-${suffix.slice(-8)}`,
  }).returning({ id: schools.id });
  schoolId = school.id;
  const [user] = await db.insert(users).values({
    email: `stored-status-${suffix}@example.test`, passwordHash: "test-only",
    role: "teacher", schoolId,
  }).returning({ id: users.id });
  const [teacher] = await db.insert(teachers).values({
    userId: user.id, schoolId, fullName: "Historical Teacher",
    phone: `7${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Attendance", assignedClass: "5", assignedSection: "A",
  }).returning({ id: teachers.id });
  teacherId = teacher.id;
  const [academicSession] = await db.insert(academicSessions).values({
    schoolId, sessionName: `Archived ${suffix}`, startDate: "2025-04-01",
    endDate: "2041-03-31", isActive: false, status: "archived",
  }).returning({ id: academicSessions.id });
  sessionId = academicSession.id;
  const today = todayInIST();
  const [record] = await db.insert(teacherSelfAttendance).values({
    teacherId, schoolId, sessionId, attendanceDate: today,
    checkInTime: new Date(`${today}T09:30:00+05:30`), status: "Present",
  }).returning({ id: teacherSelfAttendance.id });
  recordId = record.id;
  const [policy] = await db.insert(attendancePolicies).values({
    schoolId, targetRole: "TEACHER", policyName: "Initial policy",
    applicableClasses: [], expectedArrivalTime: "09:00", gracePeriodMinutes: 60,
    halfDayCutoffTime: "12:00", schoolEndTime: "17:00", attendanceTarget: 85,
  }).returning({ id: attendancePolicies.id });
  policyId = policy.id;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = { userId: 1, userRole: "admin", schoolId };
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId));
});

describe("Admin Teacher self-attendance stored status", () => {
  it("returns archived stored Present and counts it after current policy becomes stricter", async () => {
    await db.update(attendancePolicies).set({
      gracePeriodMinutes: 0, updatedAt: new Date(),
    }).where(eq(attendancePolicies.id, policyId));
    await db.update(teachers).set({ assignedClass: "6" }).where(eq(teachers.id, teacherId));

    const response = await fetch(
      `${baseUrl}/api/admin/attendance/teacher-summary?date=${todayInIST()}`,
      { headers: { "x-view-session-id": String(sessionId) } },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.teachers).toEqual(expect.arrayContaining([
      expect.objectContaining({ teacherId, selfStatus: "Present", isLate: false }),
    ]));
    expect(body.summary).toMatchObject({ present: 1, lateArrivals: 0, halfDay: 0 });
    const [stored] = await db.select().from(teacherSelfAttendance).where(
      eq(teacherSelfAttendance.id, recordId),
    );
    expect(stored.status).toBe("Present");
  });
});