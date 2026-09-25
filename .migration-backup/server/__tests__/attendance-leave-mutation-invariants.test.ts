import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { addCalendarDays, calendarWeekday, todayInIST } from "@shared/ist-time";
import {
  academicSessions, attendanceRecords, calendarEvents, enrollments,
  schools, studentLeaveRequests, students, teachers, users,
} from "@shared/schema";
import { db } from "../db";
import { registerTeacherRoutes } from "../teacher-routes";
import { checkSessionContext } from "../routes";
import { storage } from "../storage";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let schoolId = 0;
let sessionId = 0;
let otherSessionId = 0;
let studentId = 0;
let teacherId = 0;
let adminId = 0;
const servers: Server[] = [];

function weekday(offset: number): string {
  let date = addCalendarDays(todayInIST(), offset);
  while (calendarWeekday(date) === 0) date = addCalendarDays(date, -1);
  return date;
}

async function leave(startDate: string, endDate = startDate, status = "pending_teacher") {
  const [created] = await db.insert(studentLeaveRequests).values({
    schoolId, studentId, sessionId, startDate, endDate, status, reason: "Test leave",
  }).returning();
  return created;
}

async function approve(
  row: Awaited<ReturnType<typeof leave>>,
  options: { teacher?: number | null; expectedStatus?: "pending_teacher" | "forwarded_to_admin" } = {},
) {
  return storage.approveStudentLeaveWithAttendance({
    leaveId: row.id, studentId, schoolId, sessionId: row.sessionId!,
    teacherId: options.teacher === undefined ? teacherId : options.teacher,
    expectedStatus: options.expectedStatus ?? "pending_teacher",
    reviewedBy: teacherId, reviewerRole: "teacher",
  });
}

async function rows(row: Awaited<ReturnType<typeof leave>>) {
  return db.select().from(attendanceRecords).where(and(
    eq(attendanceRecords.schoolId, schoolId),
    eq(attendanceRecords.sessionId, row.sessionId!),
    eq(attendanceRecords.studentId, studentId),
  ));
}

async function assertUnchanged(row: Awaited<ReturnType<typeof leave>>) {
  const [current] = await db.select().from(studentLeaveRequests)
    .where(eq(studentLeaveRequests.id, row.id));
  expect(current.status).toBe(row.status);
  expect(await rows(row)).toEqual([]);
}

async function harness(role: "teacher" | "admin", authenticated = true) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "leave-invariants-test", resave: false, saveUninitialized: false }));
  app.use(checkSessionContext);
  app.post("/test/auth", (req, res) => {
    if (role === "teacher") req.session.teacherId = teacherId;
    else req.session.userId = adminId;
    req.session.schoolId = schoolId;
    req.session.userRole = role;
    res.json({ ok: true });
  });
  registerTeacherRoutes(app);
  const server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  const url = `http://127.0.0.1:${address.port}`;
  const auth = authenticated ? await fetch(`${url}/test/auth`, { method: "POST" }) : null;
  return { url, cookie: auth?.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

async function patchApproval(url: string, cookie: string, path: string) {
  const response = await fetch(`${url}${path}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return response.status;
}

beforeAll(async () => {
  const [school] = await db.insert(schools).values({
    name: `Attendance invariants ${suffix}`, code: `A5A-${suffix.slice(-8)}`,
  }).returning();
  schoolId = school.id;
  const [teacherUser, adminUser] = await db.insert(users).values([
    { schoolId, email: `teacher-${suffix}@example.test`, passwordHash: "test", role: "teacher" },
    { schoolId, email: `admin-${suffix}@example.test`, passwordHash: "test", role: "admin" },
  ]).returning();
  adminId = adminUser.id;
  const [teacher] = await db.insert(teachers).values({
    schoolId, userId: teacherUser.id, fullName: "Leave Test Teacher",
    phone: `8${String(teacherUser.id).padStart(9, "0").slice(-9)}`,
    subject: "Attendance", assignedClass: "5", assignedSection: "A",
  }).returning();
  teacherId = teacher.id;
  const [student] = await db.insert(students).values({
    schoolId, name: "Leave Test Student", digitalStudentId: `L5A-${suffix}`,
    class: "5", section: "A", phone: `7${String(teacherUser.id).padStart(9, "0").slice(-9)}`,
    dob: "2015-01-01", passwordHash: "test",
  }).returning();
  studentId = student.id;
  const [active, archive] = await db.insert(academicSessions).values([
    {
      schoolId, sessionName: `Active-${suffix}`,
      startDate: addCalendarDays(todayInIST(), -30),
      endDate: addCalendarDays(todayInIST(), 30), isActive: true,
    },
    {
      schoolId, sessionName: `Archive-${suffix}`,
      startDate: addCalendarDays(todayInIST(), -30),
      endDate: addCalendarDays(todayInIST(), 30), isActive: false,
    },
  ]).returning();
  sessionId = active.id;
  otherSessionId = archive.id;
  await db.insert(enrollments).values({
    schoolId, studentId, sessionId, className: "5", sectionName: "B",
  });
}, 30_000);

beforeEach(async () => {
  await db.delete(attendanceRecords).where(eq(attendanceRecords.schoolId, schoolId));
});

afterAll(async () => {
  await Promise.all(servers.splice(0).map(server =>
    new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  ));
  if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId));
}, 30_000);

describe("Student leave Attendance mutation invariants", () => {
  it("rejects an archived Session without any Attendance or leave-status mutation", async () => {
    const row = await leave(weekday(-1));
    await db.update(studentLeaveRequests).set({ sessionId: otherSessionId }).where(eq(studentLeaveRequests.id, row.id));
    const archived = { ...row, sessionId: otherSessionId };
    await expect(approve(archived)).rejects.toMatchObject({ status: 409 });
    await assertUnchanged(archived);
  });

  it("rejects when a formerly active leave Session is archived before approval", async () => {
    const row = await leave(weekday(-1));
    await db.update(academicSessions).set({ isActive: false }).where(eq(academicSessions.id, sessionId));
    await db.update(academicSessions).set({ isActive: true }).where(eq(academicSessions.id, otherSessionId));
    try {
      await expect(approve(row)).rejects.toMatchObject({ status: 409 });
      await assertUnchanged(row);
    } finally {
      await db.update(academicSessions).set({ isActive: false }).where(eq(academicSessions.id, otherSessionId));
      await db.update(academicSessions).set({ isActive: true }).where(eq(academicSessions.id, sessionId));
    }
  });

  it.each([
    ["older than 7 days", weekday(-9)],
    ["future", addCalendarDays(todayInIST(), 1)],
  ])("rejects %s without partial approval", async (_label, date) => {
    const row = await leave(date);
    await expect(approve(row)).rejects.toMatchObject({ status: 400 });
    await assertUnchanged(row);
  });

  it.each(["before", "after"])("rejects a date %s the Session boundary", async edge => {
    const date = weekday(-1);
    const row = await leave(date);
    await db.update(academicSessions).set(edge === "before"
      ? { startDate: addCalendarDays(todayInIST(), 1) }
      : { endDate: addCalendarDays(todayInIST(), -2) }).where(eq(academicSessions.id, sessionId));
    try {
      await expect(approve(row)).rejects.toMatchObject({ status: 400 });
      await assertUnchanged(row);
    } finally {
      await db.update(academicSessions).set({
        startDate: addCalendarDays(todayInIST(), -30), endDate: addCalendarDays(todayInIST(), 30),
      }).where(eq(academicSessions.id, sessionId));
    }
  });

  it("creates a valid past-day leave mark with Session enrollment class/section, not current Registry placement", async () => {
    const row = await leave(weekday(-1));
    expect((await approve(row))?.status).toBe("approved");
    expect(await rows(row)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        date: row.startDate, status: "leave", class: "5", section: "B",
        schoolId, sessionId, studentId,
      }),
    ]));
  });

  it("skips holidays even when a stored Attendance mark exists, without changing that mark", async () => {
    const date = weekday(-1);
    const [holiday] = await db.insert(calendarEvents).values({
      schoolId, date, title: "Holiday", eventType: "holiday",
    }).returning();
    const row = await leave(date);
    const [mark] = await db.insert(attendanceRecords).values({
      schoolId, sessionId, studentId, originalStudentId: studentId,
      teacherId, date, class: "5", section: "B", status: "present", markedBy: "Test",
    }).returning();
    try {
      expect((await approve(row))?.status).toBe("approved");
      const [unchanged] = await db.select().from(attendanceRecords).where(eq(attendanceRecords.id, mark.id));
      expect(unchanged.status).toBe("present");
      expect(unchanged.markedBy).toBe("Test");
    } finally {
      await db.delete(attendanceRecords).where(eq(attendanceRecords.id, mark.id));
      await db.delete(calendarEvents).where(eq(calendarEvents.id, holiday.id));
    }
  });

  it("does not create an Attendance record or working-date evidence on a school holiday", async () => {
    const date = weekday(-1);
    const [holiday] = await db.insert(calendarEvents).values({
      schoolId, date, title: "No mark holiday", eventType: "holiday",
    }).returning();
    const row = await leave(date);
    try {
      expect((await approve(row))?.status).toBe("approved");
      expect(await rows(row)).toEqual([]);
    } finally {
      await db.delete(calendarEvents).where(eq(calendarEvents.id, holiday.id));
    }
  });

  it("does not insert without any authoritative Student/Session placement", async () => {
    const row = await leave(weekday(-1));
    await db.delete(enrollments).where(and(
      eq(enrollments.studentId, studentId), eq(enrollments.sessionId, sessionId),
    ));
    await db.update(students).set({ isActive: false }).where(eq(students.id, studentId));
    try {
      await expect(approve(row)).rejects.toMatchObject({ status: 409 });
      await assertUnchanged(row);
    } finally {
      await db.update(students).set({ isActive: true }).where(eq(students.id, studentId));
      await db.insert(enrollments).values({ schoolId, studentId, sessionId, className: "5", sectionName: "B" });
    }
  });

  it("rejects a mixed multi-day request atomically rather than writing the valid date", async () => {
    const row = await leave(weekday(-9), weekday(-1));
    const [holiday] = await db.insert(calendarEvents).values({
      schoolId, date: weekday(-2), title: "Mixed-range holiday", eventType: "holiday",
    }).returning();
    try {
      await expect(approve(row)).rejects.toMatchObject({ status: 400 });
      await assertUnchanged(row);
    } finally {
      await db.delete(calendarEvents).where(eq(calendarEvents.id, holiday.id));
    }
  });

  it("updates an existing mark's status without moving its stored class or historical identity", async () => {
    const date = weekday(-1);
    const row = await leave(date);
    const [original] = await db.insert(attendanceRecords).values({
      schoolId, sessionId, studentId, originalStudentId: studentId,
      teacherId, date, class: "5", section: "A", status: "present", markedBy: "Original",
    }).returning();
    await approve(row);
    const [updated] = await db.select().from(attendanceRecords).where(eq(attendanceRecords.id, original.id));
    expect(updated).toMatchObject({
      id: original.id, schoolId, sessionId, studentId,
      identityKey: original.identityKey, originalStudentId: original.originalStudentId,
      class: "5", section: "A", status: "leave",
    });
  });

  it("Teacher approval uses the same guarded operation even without an archive header", async () => {
    const row = await leave(weekday(-1));
    const { url, cookie } = await harness("teacher");
    expect(await patchApproval(url, cookie, `/api/student-leaves/${row.id}/approve`)).toBe(200);
    expect((await rows(row)).some(record => record.date === row.startDate && record.status === "leave")).toBe(true);
  });

  it("Admin approval rejects archived Attendance without an archive header", async () => {
    const row = await leave(weekday(-1), weekday(-1), "forwarded_to_admin");
    await db.update(studentLeaveRequests).set({ sessionId: otherSessionId }).where(eq(studentLeaveRequests.id, row.id));
    const archived = { ...row, sessionId: otherSessionId };
    const { url, cookie } = await harness("admin");
    expect(await patchApproval(url, cookie, `/api/student-leaves/${row.id}/admin-approve`)).toBe(409);
    await assertUnchanged(archived);
  });

  it("Admin approval preserves the no-class-teacher behavior without inventing an Attendance row", async () => {
    const row = await leave(weekday(-1), weekday(-1), "forwarded_to_admin");
    const result = await approve(row, { teacher: null, expectedStatus: "forwarded_to_admin" });
    expect(result?.status).toBe("approved");
    expect(await rows(row)).toEqual([]);
  });
});