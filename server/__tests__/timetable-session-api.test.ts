import express from "express";
import http, { type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { registerRoutes } from "../routes";
import {
  academicSessions, schools, students, teacherAllocations, teachers,
  timetableEntries, timetableStructure, users,
} from "@shared/schema";

describe("Timetable API session ownership", () => {
  let server: Server;
  let baseUrl: string;
  const schoolIds: number[] = [];
  let schoolId: number;
  let teacherId: number;
  let studentId: number;
  let firstId: number;
  let secondId: number;
  let foreignId: number;

  const slot = { class: "5", section: "A", dayOfWeek: 1, period: 1, subject: "Mathematics" };
  const bell = (startTime: string) => ({
    class: "5",
    rows: [{ periodNumber: 1, label: "Period 1", startTime, endTime: "09:00", isBreak: false, sortOrder: 0 }],
  });
  async function request(role: "admin" | "teacher" | "student", method: string, path: string, sessionId?: number, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json", "x-test-role": role,
        ...(sessionId === undefined ? {} : { "x-view-session-id": String(sessionId) }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }
  const admin = (method: string, path: string, sessionId?: number, body?: unknown) =>
    request("admin", method, path, sessionId, body);
  const teacher = (method: string, path: string, sessionId?: number, body?: unknown) =>
    request("teacher", method, path, sessionId, body);
  const student = (method: string, path: string, sessionId?: number, body?: unknown) =>
    request("student", method, path, sessionId, body);

  async function activateSecond() {
    await db.update(academicSessions).set({ isActive: false, status: "archived" }).where(eq(academicSessions.id, firstId));
    await db.update(academicSessions).set({ isActive: true, status: "active" }).where(eq(academicSessions.id, secondId));
  }

  beforeAll(async () => {
    const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 10000).toString(36)}`;
    const [primary, other] = await db.insert(schools).values([
      { name: `Timetable API ${suffix}`, code: `TA-${suffix}` },
      { name: `Other Timetable API ${suffix}`, code: `TB-${suffix}` },
    ]).returning();
    schoolId = primary.id;
    schoolIds.push(primary.id, other.id);
    const [user] = await db.insert(users).values({
      schoolId, role: "teacher", email: `timetable-api-${suffix}@example.test`, passwordHash: "test",
    }).returning();
    const [teacherRow] = await db.insert(teachers).values({
      schoolId, userId: user.id, fullName: "API Test Teacher", phone: "0000000000",
      subject: "Mathematics", assignedClass: "5", assignedSection: "A",
    }).returning();
    teacherId = teacherRow.id;
    const [studentRow] = await db.insert(students).values({
      schoolId, digitalStudentId: `DS-TT-${suffix}`, name: "API Test Student",
      class: "5", section: "A", phone: "0000000000", dob: "2015-01-01", passwordHash: "test",
    }).returning();
    studentId = studentRow.id;
    await db.insert(teacherAllocations).values({
      schoolId, teacherId, subject: "Mathematics", class: "5", section: "A", weeklyQuota: 6,
    });
    const [first, second, foreign] = await db.insert(academicSessions).values([
      { schoolId, sessionName: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31", isActive: true, status: "active" },
      { schoolId, sessionName: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31", isActive: false, status: "archived" },
      { schoolId: other.id, sessionName: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31", isActive: true, status: "active" },
    ]).returning();
    firstId = first.id;
    secondId = second.id;
    foreignId = foreign.id;

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      const role = req.headers["x-test-role"];
      req.session = role === "teacher"
        ? { teacherId, userId: user.id, userRole: "teacher", schoolId }
        : role === "student"
          ? { studentId }
          : { userId: user.id, userRole: "admin", schoolId };
      next();
    });
    server = http.createServer(app);
    await registerRoutes(server, app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  }, 30_000);

  beforeEach(async () => {
    await db.delete(timetableEntries).where(eq(timetableEntries.schoolId, schoolId));
    await db.delete(timetableStructure).where(eq(timetableStructure.schoolId, schoolId));
    await db.update(academicSessions).set({ isActive: false, status: "archived" }).where(eq(academicSessions.id, secondId));
    await db.update(academicSessions).set({ isActive: true, status: "active" }).where(eq(academicSessions.id, firstId));
  });

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (schoolIds.length) await db.delete(schools).where(inArray(schools.id, schoolIds));
  });

  it("1. uses the selected session for a read instead of the active one", async () => {
    const result = await admin("GET", `/api/timetable/school/${schoolId}`, secondId);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
  });

  it("2. falls back to the active session without a selected header", async () => {
    const created = await admin("POST", "/api/timetable", undefined, { ...slot, teacherId });
    expect(created.status).toBe(201);
    expect(created.body.sessionId).toBe(firstId);
    const read = await admin("GET", `/api/timetable/school/${schoolId}`);
    expect(read.body.map((row: any) => row.id)).toEqual([created.body.id]);
  });

  it("3. rejects a request with neither a selected nor an active session", async () => {
    await db.update(academicSessions).set({ isActive: false }).where(eq(academicSessions.id, firstId));
    expect((await admin("GET", `/api/timetable/school/${schoolId}`)).status).toBe(409);
    expect((await teacher("POST", "/api/timetable/teacher/save-batch", undefined, { changes: [] })).status).toBe(409);
  });

  it("4. rejects a selected session belonging to another school", async () => {
    expect((await admin("GET", `/api/timetable/school/${schoolId}`, foreignId)).status).toBe(403);
    expect((await student("GET", "/api/student/timetable", foreignId)).status).toBe(403);
    expect((await teacher("GET", `/api/timetable/teacher/${teacherId}`, foreignId)).status).toBe(403);
  });

  it("5. rejects mutations of an archived selected session", async () => {
    expect((await admin("PATCH", "/api/timetable/publish", secondId, { class: "5", section: "A" })).status).toBe(403);
    expect((await teacher("POST", "/api/timetable/teacher-slot", secondId, slot)).status).toBe(403);
    expect((await admin("POST", "/api/timetable/structure", secondId, bell("08:00"))).status).toBe(403);
  });

  it("6. permits identical slots in different sessions and scopes admin batch deletion", async () => {
    const change = { ...slot, teacherId };
    const first = await admin("POST", "/api/timetable/admin/save-batch", firstId, { changes: [change] });
    expect(first.body.saved).toHaveLength(1);
    await activateSecond();
    const second = await admin("POST", "/api/timetable/admin/save-batch", secondId, { changes: [change] });
    expect(second.body.saved).toHaveLength(1);
    expect(first.body.saved[0].id).not.toBe(second.body.saved[0].id);
    const removed = await admin("POST", "/api/timetable/admin/save-batch", secondId, {
      changes: [{ ...change, _delete: true }],
    });
    expect(removed.body.errors).toEqual([]);
    expect((await admin("GET", `/api/timetable/school/${schoolId}`, firstId)).body).toHaveLength(1);
    expect((await admin("GET", `/api/timetable/school/${schoolId}`, secondId)).body).toHaveLength(0);
  });

  it("7. scopes teacher, class, occupancy, status and admin ID deletion to one session", async () => {
    const first = await admin("POST", "/api/timetable", firstId, { ...slot, teacherId });
    await activateSecond();
    const second = await admin("POST", "/api/timetable", secondId, { ...slot, teacherId });
    expect((await teacher("GET", `/api/timetable/teacher/${teacherId}`, firstId)).body.map((r: any) => r.id)).toEqual([first.body.id]);
    expect((await teacher("GET", `/api/timetable/class-view?class=5&section=A`, secondId)).body.entries.map((r: any) => r.id)).toEqual([second.body.id]);
    expect((await teacher("GET", "/api/timetable/slot-check?class=5&section=A&dayOfWeek=1&period=1", firstId)).body.taken).toBe(false);
    expect((await admin("GET", "/api/timetable/slot-check?class=5&section=A&dayOfWeek=1&period=1", firstId)).body.taken).toBe(true);
    expect((await admin("GET", "/api/timetable/class-status", secondId)).body[0].totalCount).toBe(1);
    expect((await admin("DELETE", `/api/timetable/${first.body.id}`, secondId)).status).toBe(404);
    expect((await admin("DELETE", `/api/timetable/${second.body.id}`, secondId)).status).toBe(200);
  });

  it("8. saves and reads structure independently for each session", async () => {
    expect((await admin("POST", "/api/timetable/structure", firstId, bell("08:00"))).status).toBe(200);
    await activateSecond();
    const second = await admin("POST", "/api/timetable/structure", secondId, bell("08:30"));
    expect(second.status).toBe(200);
    expect((await admin("GET", "/api/timetable/structure?class=5", firstId)).body[0].startTime).toBe("08:00");
    expect((await teacher("GET", "/api/timetable/structure?class=5", secondId)).body[0].startTime).toBe("08:30");
    expect((await student("GET", "/api/timetable/structure?class=5", firstId)).body[0].startTime).toBe("08:00");
    expect((await admin("DELETE", `/api/timetable/structure/${second.body.saved[0].id}`, secondId)).status).toBe(200);
    expect((await admin("GET", "/api/timetable/structure?class=5", firstId)).body).toHaveLength(1);
  });

  it("9. publishes only the selected session", async () => {
    await admin("POST", "/api/timetable", firstId, { ...slot, teacherId });
    await activateSecond();
    await admin("POST", "/api/timetable", secondId, { ...slot, teacherId });
    expect((await admin("PATCH", "/api/timetable/publish", secondId, { class: "5", section: "A" })).body.count).toBe(1);
    expect((await admin("GET", `/api/timetable/school/${schoolId}`, firstId)).body[0].status).toBe("draft");
    expect((await admin("GET", `/api/timetable/school/${schoolId}`, secondId)).body[0].status).toBe("published");
  });

  it("10. teacher create, update and delete use the selected session", async () => {
    await activateSecond();
    const created = await teacher("POST", "/api/timetable/teacher-slot", secondId, slot);
    expect(created.status).toBe(201);
    expect(created.body.sessionId).toBe(secondId);
    const changed = await teacher("PATCH", `/api/timetable/${created.body.id}/teacher`, secondId, { room: "Lab" });
    expect(changed.status).toBe(200);
    expect(changed.body.room).toBe("Lab");
    expect((await teacher("DELETE", `/api/timetable/${created.body.id}/teacher`, firstId)).status).toBe(403);
    expect((await teacher("DELETE", `/api/timetable/${created.body.id}/teacher`, secondId)).status).toBe(200);
  });

  it("11. teacher batch save and delete use the selected session", async () => {
    await activateSecond();
    const change = { ...slot };
    const saved = await teacher("POST", "/api/timetable/teacher/save-batch", secondId, { changes: [change] });
    expect(saved.status).toBe(200);
    expect(saved.body.saved[0].sessionId).toBe(secondId);
    expect((await teacher("GET", `/api/timetable/teacher/${teacherId}`, firstId)).body).toHaveLength(0);
    const deleted = await teacher("POST", "/api/timetable/teacher/save-batch", secondId, {
      changes: [{ ...change, _delete: true }],
    });
    expect(deleted.status).toBe(200);
    expect((await teacher("GET", `/api/timetable/teacher/${teacherId}`, secondId)).body).toHaveLength(0);
  });

  it("12. student timetable entries and structure use the same selected session", async () => {
    await admin("POST", "/api/timetable", firstId, { ...slot, teacherId });
    await admin("POST", "/api/timetable/structure", firstId, bell("08:00"));
    await activateSecond();
    await admin("POST", "/api/timetable", secondId, { ...slot, teacherId });
    await admin("POST", "/api/timetable/structure", secondId, bell("08:30"));
    const first = await student("GET", "/api/student/timetable", firstId);
    const second = await student("GET", "/api/student/timetable", secondId);
    expect(first.status).toBe(200);
    expect(first.body.entries).toHaveLength(1);
    expect(first.body.entries[0].sessionId).toBe(firstId);
    expect(first.body.structure[0].startTime).toBe("08:00");
    expect(second.body.entries).toHaveLength(1);
    expect(second.body.entries[0].sessionId).toBe(secondId);
    expect(second.body.structure[0].startTime).toBe("08:30");
  });
});