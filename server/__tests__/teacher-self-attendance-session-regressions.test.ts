import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { addCalendarDays, todayInIST } from "@shared/ist-time";
import {
  academicSessions,
  attendanceCorrectionRequests,
  attendancePolicies,
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
  await db.delete(attendancePolicies).where(eq(attendancePolicies.schoolId, schoolId));
  await db.update(teachers).set({ assignedClass: "5" }).where(eq(teachers.id, teacherId));
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
  it("returns stored Present after a policy change without healing the active Session on GET", async () => {
    const today = todayInIST();
    const [policy] = await db.insert(attendancePolicies).values({
      schoolId, targetRole: "TEACHER", policyName: "Original policy",
      applicableClasses: [], expectedArrivalTime: "09:00", gracePeriodMinutes: 60,
      halfDayCutoffTime: "12:00", schoolEndTime: "17:00", attendanceTarget: 85,
    }).returning({ id: attendancePolicies.id });
    const [record] = await db.insert(teacherSelfAttendance).values(attendanceValues({
      sessionId: sessionAId,
      checkInTime: new Date(`${today}T09:30:00+05:30`),
      status: "Present",
    })).returning();
    await db.update(attendancePolicies).set({ gracePeriodMinutes: 0 })
      .where(eq(attendancePolicies.id, policy.id));

    const result = await request("/api/teacher/self-attendance/today", sessionAId);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: record.id, status: "Present" });

    const [stored] = await db.select().from(teacherSelfAttendance).where(
      eq(teacherSelfAttendance.id, record.id),
    );
    expect(stored.status).toBe("Present");
    expect(stored.updatedAt).toEqual(record.updatedAt);
  });

  it("returns the archived today stored status without reinterpreting it", async () => {
    const today = todayInIST();
    const [record] = await db.insert(teacherSelfAttendance).values(attendanceValues({
      sessionId: sessionBId,
      checkInTime: new Date(`${today}T09:30:00+05:30`),
      status: "Present",
    })).returning();
    await db.insert(attendancePolicies).values({
      schoolId, targetRole: "TEACHER", policyName: "Changed policy",
      applicableClasses: [], expectedArrivalTime: "09:00", gracePeriodMinutes: 0,
      halfDayCutoffTime: "12:00", schoolEndTime: "17:00", attendanceTarget: 85,
    });

    const result = await request("/api/teacher/self-attendance/today", sessionBId);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: record.id, sessionId: sessionBId, status: "Present" });

    const [stored] = await db.select().from(teacherSelfAttendance).where(
      eq(teacherSelfAttendance.id, record.id),
    );
    expect(stored.status).toBe("Present");
    expect(stored.updatedAt).toEqual(record.updatedAt);
  });

  it("returns stored archived history statuses without changing any row", async () => {
    const today = todayInIST();
    const yesterday = addCalendarDays(today, -1);
    const records = await db.insert(teacherSelfAttendance).values([
      attendanceValues({
        sessionId: sessionBId,
        attendanceDate: today,
        checkInTime: new Date(`${today}T09:00:00+05:30`),
        status: "Absent",
      }),
      attendanceValues({
        sessionId: sessionBId,
        attendanceDate: yesterday,
        checkInTime: new Date(`${yesterday}T09:00:00+05:30`),
        status: "Late",
      }),
    ]).returning();

    const result = await request(
      `/api/teacher/self-attendance/history?startDate=${yesterday}&endDate=${today}`,
      sessionBId,
    );
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(2);
    expect(result.body.map((row: any) => row.status)).toEqual(["Absent", "Late"]);

    const stored = await db.select().from(teacherSelfAttendance).where(
      inArray(teacherSelfAttendance.id, records.map(record => record.id)),
    );
    expect(stored).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: records[0].id, status: "Absent" }),
      expect.objectContaining({ id: records[1].id, status: "Late" }),
    ]));
  });

  it("preserves an earlier active-Session Present and an archived Half Day after a policy change", async () => {
    const yesterday = addCalendarDays(todayInIST(), -1);
    const [policy] = await db.insert(attendancePolicies).values({
      schoolId, targetRole: "TEACHER", policyName: "Original thresholds",
      applicableClasses: [], expectedArrivalTime: "09:00", gracePeriodMinutes: 60,
      halfDayCutoffTime: "17:00", schoolEndTime: "18:00", attendanceTarget: 85,
    }).returning({ id: attendancePolicies.id });
    const [active, archived] = await db.insert(teacherSelfAttendance).values([
      attendanceValues({
        sessionId: sessionAId, attendanceDate: yesterday,
        checkInTime: new Date(`${yesterday}T09:30:00+05:30`), status: "Present",
      }),
      attendanceValues({
        sessionId: sessionBId, attendanceDate: yesterday,
        checkInTime: new Date(`${yesterday}T09:00:00+05:30`),
        checkOutTime: new Date(`${yesterday}T16:00:00+05:30`), status: "Half Day",
      }),
    ]).returning();
    await db.update(attendancePolicies).set({
      gracePeriodMinutes: 0, halfDayCutoffTime: "12:00", schoolEndTime: "17:00",
    }).where(eq(attendancePolicies.id, policy.id));

    const path = `/api/teacher/self-attendance/history?startDate=${yesterday}&endDate=${yesterday}`;
    const activeRead = await request(path, sessionAId);
    const archivedRead = await request(path, sessionBId);
    expect(activeRead.body).toMatchObject([{ id: active.id, status: "Present" }]);
    expect(archivedRead.body).toMatchObject([{ id: archived.id, status: "Half Day" }]);
    const stored = await db.select().from(teacherSelfAttendance).where(
      inArray(teacherSelfAttendance.id, [active.id, archived.id]),
    );
    expect(stored).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: active.id, status: "Present", updatedAt: active.updatedAt }),
      expect.objectContaining({ id: archived.id, status: "Half Day", updatedAt: archived.updatedAt }),
    ]));
  });

  it("does not reinterpret stored history after the teacher's current class changes", async () => {
    const yesterday = addCalendarDays(todayInIST(), -1);
    const [record] = await db.insert(teacherSelfAttendance).values(attendanceValues({
      sessionId: sessionBId, attendanceDate: yesterday,
      checkInTime: new Date(`${yesterday}T09:30:00+05:30`), status: "Present",
    })).returning();
    await db.insert(attendancePolicies).values({
      schoolId, targetRole: "TEACHER", policyName: "Class 6 policy",
      applicableClasses: ["6"], expectedArrivalTime: "09:00", gracePeriodMinutes: 0,
      halfDayCutoffTime: "12:00", schoolEndTime: "17:00", attendanceTarget: 85,
    });
    await db.update(teachers).set({ assignedClass: "6" }).where(eq(teachers.id, teacherId));

    const result = await request(
      `/api/teacher/self-attendance/history?startDate=${yesterday}&endDate=${yesterday}`,
      sessionBId,
    );
    expect(result.body).toMatchObject([{ id: record.id, status: "Present" }]);
    const [stored] = await db.select().from(teacherSelfAttendance).where(eq(teacherSelfAttendance.id, record.id));
    expect(stored.status).toBe("Present");
  });

  it("filters detailed history and computes summaries from the same stored statuses", async () => {
    const today = todayInIST();
    const yesterday = addCalendarDays(today, -1);
    const [present, halfDay] = await db.insert(teacherSelfAttendance).values([
      attendanceValues({
        attendanceDate: today, checkInTime: new Date(`${today}T09:30:00+05:30`),
        status: "Present",
      }),
      attendanceValues({
        attendanceDate: yesterday, checkInTime: new Date(`${yesterday}T09:00:00+05:30`),
        checkOutTime: new Date(`${yesterday}T16:00:00+05:30`), status: "Half Day",
      }),
    ]).returning();
    await db.insert(attendancePolicies).values({
      schoolId, targetRole: "TEACHER", policyName: "Current only",
      applicableClasses: [], expectedArrivalTime: "09:00", gracePeriodMinutes: 0,
      halfDayCutoffTime: "12:00", schoolEndTime: "17:00", attendanceTarget: 85,
    });

    const basePath = `/api/teacher/attendance/history?fromDate=${yesterday}&toDate=${today}`;
    const all = await request(basePath, sessionAId);
    expect(all.status).toBe(200);
    expect(all.body.records).toMatchObject([
      { id: present.id, status: "Present" },
      { id: halfDay.id, status: "Half Day" },
    ]);
    expect(all.body.summary).toMatchObject({ present: 1, halfDay: 1, late: 0 });
    expect(all.body.statistics.attendanceRate).toBe(100);
    const filtered = await request(`${basePath}&status=Present`, sessionAId);
    expect(filtered.body.records).toMatchObject([{ id: present.id, status: "Present" }]);
    expect(filtered.body.summary).toMatchObject({ present: 1, halfDay: 0, late: 0 });
    expect(filtered.body.pagination.totalRecords).toBe(1);
    const stored = await db.select().from(teacherSelfAttendance).where(
      inArray(teacherSelfAttendance.id, [present.id, halfDay.id]),
    );
    expect(stored).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: present.id, status: "Present", updatedAt: present.updatedAt }),
      expect.objectContaining({ id: halfDay.id, status: "Half Day", updatedAt: halfDay.updatedAt }),
    ]));
  });

  it("keeps active and archived records isolated while returning archived stored status", async () => {
    const today = todayInIST();
    const [activeRecord, archivedRecord] = await db.insert(teacherSelfAttendance).values([
      attendanceValues({
        sessionId: sessionAId,
        checkInTime: new Date(`${today}T09:00:00+05:30`),
        status: "Late",
      }),
      attendanceValues({
        sessionId: sessionBId,
        checkInTime: new Date(`${today}T09:00:00+05:30`),
        status: "Absent",
      }),
    ]).returning();

    const result = await request("/api/teacher/self-attendance/today", sessionBId);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: archivedRecord.id,
      sessionId: sessionBId,
      status: "Absent",
    });

    const stored = await db.select().from(teacherSelfAttendance).where(
      inArray(teacherSelfAttendance.id, [activeRecord.id, archivedRecord.id]),
    );
    expect(stored).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: activeRecord.id, status: "Late" }),
      expect.objectContaining({ id: archivedRecord.id, status: "Absent" }),
    ]));
  });

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