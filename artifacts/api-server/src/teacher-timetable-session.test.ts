import assert from "node:assert/strict";
import type { AcademicSession } from "@workspace/db";
import express, { type RequestHandler } from "express";
import test from "node:test";
import { requireMobileAcademicSession } from "./mobile-auth-routes";
import { registerMobileTeacherModuleRoutes } from "./mobile-teacher-module-routes";
import { storage } from "./storage";
import { registerTeacherRoutes } from "./teacher-routes";

const teacher = {
  id: 9,
  userId: 90,
  schoolId: 1,
  fullName: "Timetable Teacher",
  assignedClass: "5",
  assignedSection: "A",
  subject: "Mathematics",
  isActive: true,
  mustChangePassword: false,
};
const teacherAccount = {
  teacher,
  school: { id: 1, name: "Test School" },
  user: { id: 90, schoolId: 1, role: "teacher", isActive: true },
};
const sessions = [
  { id: 101, schoolId: 1, isActive: true },
  { id: 102, schoolId: 1, isActive: false },
  { id: 201, schoolId: 2, isActive: true },
] as unknown as AcademicSession[];
const entriesBySession = new Map<number, any[]>([
  [101, [{
    id: 1, teacherId: 9, schoolId: 1, sessionId: 101, dayOfWeek: 1, period: 1,
    class: "5", section: "A", subject: "Mathematics", status: "draft",
  }]],
  [102, [
    {
      id: 2, teacherId: 9, schoolId: 1, sessionId: 102, dayOfWeek: 1, period: 1,
      class: "5", section: "A", subject: "History", status: "draft",
    },
    {
      id: 3, teacherId: 9, schoolId: 1, sessionId: 102, dayOfWeek: 1, period: 2,
      class: "5", section: "A", subject: "Science", status: "published",
    },
  ]],
]);

test("Teacher Timetable routes require the selected session and preserve non-Teacher resolution", async (t) => {
  const calls = {
    selected: [] as Array<[number, number]>,
    active: [] as number[],
    teacherReads: [] as Array<[number, number, number]>,
    classReads: [] as Array<[number, number, string, string]>,
    structureReads: [] as Array<[number, number, string]>,
    writes: [] as string[],
    writeScopes: [] as Array<[number, number, number]>,
    schoolReads: [] as Array<[number, number]>,
  };

  const replacements: Array<{ name: string; hadOwn: boolean; original: unknown }> = [];
  const replaceStorage = (name: string, implementation: (...args: any[]) => any) => {
    const target = storage as any;
    replacements.push({
      name,
      hadOwn: Object.prototype.hasOwnProperty.call(target, name),
      original: target[name],
    });
    target[name] = implementation;
  };
  replaceStorage("getTeacherWithSchool", async (id: number) => id === teacher.id ? teacherAccount : undefined);
  replaceStorage("getTeacherById", async (id: number) => id === teacher.id ? teacher : undefined);
  replaceStorage("getStudentById", async (id: number) => id === 50 ? { id, schoolId: 1, class: "5", section: "A" } : undefined);
  replaceStorage("getAcademicSessionForSchool", async (id: number, schoolId: number) => {
    calls.selected.push([id, schoolId]);
    return sessions.find((session) => session.id === id && session.schoolId === schoolId);
  });
  replaceStorage("getActiveSession", async (schoolId: number) => {
    calls.active.push(schoolId);
    return schoolId === 1 ? sessions[0] : undefined;
  });
  replaceStorage("getTimetableByTeacher", async (schoolId: number, sessionId: number, teacherId: number) => {
    calls.teacherReads.push([schoolId, sessionId, teacherId]);
    return (entriesBySession.get(sessionId) ?? []).filter((entry) => entry.teacherId === teacherId);
  });
  replaceStorage("getTimetableByClassSection", async (schoolId: number, sessionId: number, cls: string, section: string) => {
    calls.classReads.push([schoolId, sessionId, cls, section]);
    return (entriesBySession.get(sessionId) ?? []).filter((entry) => entry.class === cls && entry.section === section);
  });
  replaceStorage("getTimetableStructure", async (schoolId: number, sessionId: number, cls: string) => {
    calls.structureReads.push([schoolId, sessionId, cls]);
    return [{ schoolId, sessionId, class: cls, periodNumber: 1, label: "Period 1" }];
  });
  replaceStorage("getTimetableBySchool", async (schoolId: number, sessionId: number) => {
    calls.schoolReads.push([schoolId, sessionId]);
    return entriesBySession.get(sessionId) ?? [];
  });
  replaceStorage("checkSlotOccupancy", async () => null);
  replaceStorage("validateTimetableEntry", async () => ({ valid: true }));
  replaceStorage("createTimetableEntry", async (data: Record<string, unknown>) => {
    calls.writes.push("create");
    calls.writeScopes.push([data.schoolId as number, data.sessionId as number, data.teacherId as number]);
    return { id: 90, ...data };
  });
  replaceStorage("getTimetableEntryById", async (id: number, schoolId: number, sessionId: number) => {
    const entry = (entriesBySession.get(sessionId) ?? []).find((candidate) => candidate.id === id);
    return entry?.schoolId === schoolId ? entry : null;
  });
  replaceStorage("updateTimetableEntry", async (id: number, schoolId: number, sessionId: number) => {
    calls.writes.push("update");
    calls.writeScopes.push([schoolId, sessionId, teacher.id]);
    return { id, schoolId, sessionId, teacherId: teacher.id };
  });
  replaceStorage("deleteTimetableEntry", async (_id: number, schoolId: number, sessionId: number) => {
    calls.writes.push("delete-entry");
    calls.writeScopes.push([schoolId, sessionId, teacher.id]);
    return true;
  });
  replaceStorage("upsertTeacherTimetableSlot", async (schoolId: number, sessionId: number, teacherId: number) => {
    calls.writes.push("upsert-slot");
    calls.writeScopes.push([schoolId, sessionId, teacherId]);
    return { id: 91, schoolId, sessionId, teacherId };
  });
  replaceStorage("deleteTeacherTimetableSlot", async (schoolId: number, sessionId: number, teacherId: number) => {
    calls.writes.push("delete-slot");
    calls.writeScopes.push([schoolId, sessionId, teacherId]);
    return true;
  });
  replaceStorage("getFacultyMappingsByTeacher", async () => []);
  t.after(() => {
    const target = storage as any;
    for (const { name, hadOwn, original } of replacements.reverse()) {
      if (hadOwn) target[name] = original;
      else delete target[name];
    }
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get("x-test-role") ?? "teacher";
    (req as any).session = role === "student"
      ? { userId: 50, studentId: 50, schoolId: 1, userRole: "student" }
      : role === "admin"
        ? { userId: 99, schoolId: 1, userRole: "admin" }
        : role === "anonymous"
          ? {}
          : { teacherId: 9, userId: 90, schoolId: 1, userRole: "teacher" };
    if (req.path.startsWith("/api/mobile/teacher/") && role !== "anonymous") {
      (req as any).mobileAuth = {
        principal: { id: 9, principalId: 90, entityId: 9, role: "teacher", schoolId: 1 },
      };
    }
    next();
  });
  registerTeacherRoutes(app);
  const pass: RequestHandler = (_req, _res, next) => next();
  registerMobileTeacherModuleRoutes(app, pass, pass, requireMobileAcademicSession);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(
    path: string,
    options: { method?: string; body?: unknown; sessionId?: number | string; role?: string } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.sessionId === undefined ? {} : { "x-view-session-id": String(options.sessionId) }),
        ...(options.role ? { "x-test-role": options.role } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }
  function resetCalls() {
    calls.selected.length = 0;
    calls.active.length = 0;
    calls.teacherReads.length = 0;
    calls.classReads.length = 0;
    calls.structureReads.length = 0;
    calls.writes.length = 0;
    calls.writeScopes.length = 0;
    calls.schoolReads.length = 0;
  }

  const ownRead = await request("/api/timetable/teacher/9", { sessionId: 101 });
  assert.equal(ownRead.status, 200);
  assert.deepEqual(ownRead.body.map((entry: any) => entry.sessionId), [101]);
  assert.deepEqual(calls.teacherReads, [[1, 101, 9]]);
  assert.deepEqual(calls.selected, [[101, 1]]);
  assert.deepEqual(calls.active, []);

  resetCalls();
  assert.equal((await request("/api/timetable/teacher/9")).status, 400);
  assert.equal((await request("/api/timetable/teacher/9", { sessionId: "10x" })).status, 400);
  assert.deepEqual(calls.active, [], "Teacher reads must not fall back to the active session");
  assert.equal((await request("/api/timetable/teacher/10", { sessionId: 101 })).status, 403);
  assert.equal(calls.teacherReads.length, 0, "A Teacher cannot read another Teacher's timetable");
  assert.equal((await request("/api/timetable/teacher/9", { sessionId: 201 })).status, 403);
  const historicalRead = await request("/api/timetable/teacher/9", { sessionId: 102 });
  assert.equal(historicalRead.status, 200);
  assert.deepEqual(historicalRead.body.map((entry: any) => entry.sessionId), [102, 102]);

  resetCalls();
  const archiveClass = await request("/api/timetable/class-view?class=5&section=A", { sessionId: 102 });
  assert.equal(archiveClass.status, 200);
  assert.deepEqual(calls.classReads, [[1, 102, "5", "A"]]);
  assert.deepEqual(archiveClass.body.entries.map((entry: any) => entry.status), ["draft", "published"]);
  assert.deepEqual(calls.structureReads, [[1, 102, "5"]]);
  assert.equal((await request("/api/timetable/slot-check?class=5&section=A&dayOfWeek=1&period=1", { sessionId: 102 })).status, 200);
  assert.equal((await request("/api/timetable/structure?class=5", { sessionId: 102 })).status, 200);
  resetCalls();
  assert.equal((await request("/api/timetable/class-view?class=5&section=A")).status, 400);
  assert.equal((await request("/api/timetable/slot-check?class=5&section=A&dayOfWeek=1&period=1")).status, 400);
  assert.equal((await request("/api/timetable/structure?class=5")).status, 400);
  assert.deepEqual(calls.active, [], "Shared Teacher reads must not use an implicit active-session fallback");

  const writeRequests = [
    { path: "/api/timetable/teacher-slot", method: "POST", body: { dayOfWeek: 1, period: 1, class: "5", section: "A", subject: "Math" } },
    { path: "/api/timetable/1/teacher", method: "PATCH", body: {} },
    { path: "/api/timetable/1/teacher", method: "DELETE" },
    { path: "/api/timetable/teacher/save-batch", method: "POST", body: { changes: [] } },
  ];
  resetCalls();
  for (const item of writeRequests) {
    assert.equal((await request(item.path, {
      method: item.method, body: item.body, role: "anonymous",
    })).status, 401);
  }
  assert.equal((await request("/api/timetable/teacher/save-batch", {
    method: "POST", role: "admin", body: { changes: [] },
  })).status, 403);
  resetCalls();
  for (const item of writeRequests) {
    assert.equal((await request(item.path, { method: item.method, body: item.body })).status, 400);
  }
  assert.deepEqual(calls.active, [], "Teacher writes must require an explicit session, not fall back");
  assert.deepEqual(calls.writes, []);

  resetCalls();
  const saved = await request("/api/timetable/teacher/save-batch", {
    method: "POST",
    sessionId: 101,
    body: {
      teacherId: 77,
      schoolId: 2,
      changes: [{ dayOfWeek: 1, period: 2, class: "5", section: "A", subject: "Mathematics" }],
    },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(calls.writeScopes, [[1, 101, 9]], "Writes must use the authenticated Teacher and selected school/session");

  resetCalls();
  assert.equal((await request("/api/timetable/teacher/save-batch", {
    method: "POST", sessionId: 102, body: { changes: [{ dayOfWeek: 1, period: 2, class: "5", section: "A", subject: "Math" }] },
  })).status, 403);
  assert.equal((await request("/api/timetable/teacher/save-batch", {
    method: "POST", sessionId: 201, body: { changes: [{ dayOfWeek: 1, period: 2, class: "5", section: "A", subject: "Math" }] },
  })).status, 403);
  assert.deepEqual(calls.writes, [], "Archived and foreign sessions must not reach timetable writes");

  resetCalls();
  assert.equal((await request("/api/timetable/teacher-slot", {
    method: "POST", sessionId: 101,
    body: { dayOfWeek: 1, period: 1, class: "5", section: "A", subject: "Mathematics" },
  })).status, 201);
  assert.equal((await request("/api/timetable/1/teacher", { method: "PATCH", sessionId: 101, body: {} })).status, 200);
  assert.equal((await request("/api/timetable/1/teacher", { method: "DELETE", sessionId: 101 })).status, 200);
  assert.deepEqual(calls.writeScopes, [[1, 101, 9], [1, 101, 9], [1, 101, 9]]);

  resetCalls();
  const historicalMobileRead = await request("/api/mobile/teacher/modules/timetable", { sessionId: 102 });
  assert.equal(historicalMobileRead.status, 200);
  assert.deepEqual(historicalMobileRead.body.items.map((entry: any) => entry.sessionId), [102, 102]);
  assert.deepEqual(calls.teacherReads, [[1, 102, 9]]);
  assert.equal((await request("/api/mobile/teacher/modules/timetable")).status, 400);
  resetCalls();
  const mobileSave = {
    dayOfWeek: 1, period: 2, className: "5", section: "A", subject: "Mathematics",
  };
  assert.equal((await request("/api/mobile/teacher/modules/timetable/save", {
    method: "POST", sessionId: 101, body: mobileSave,
  })).status, 200);
  assert.deepEqual(calls.writeScopes, [[1, 101, 9]]);
  resetCalls();
  assert.equal((await request("/api/mobile/teacher/modules/timetable/save", {
    method: "POST", sessionId: 102, body: mobileSave,
  })).status, 403);
  assert.equal((await request("/api/mobile/teacher/modules/timetable/save", {
    method: "POST", sessionId: 201, body: mobileSave,
  })).status, 403);
  assert.deepEqual(calls.writes, []);

  resetCalls();
  assert.equal((await request("/api/timetable/school/1", { role: "admin" })).status, 200);
  assert.deepEqual(calls.active, [1]);
  assert.deepEqual(calls.schoolReads, [[1, 101]]);
  resetCalls();
  assert.equal((await request("/api/timetable/structure?class=5", { role: "student" })).status, 200);
  assert.deepEqual(calls.active, [1]);
  assert.deepEqual(calls.structureReads, [[1, 101, "5"]]);
});