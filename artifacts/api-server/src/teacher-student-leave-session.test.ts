import assert from "node:assert/strict";
import type { AcademicSession } from "@workspace/db";
import express from "express";
import test from "node:test";
import { storage } from "./storage";
import { registerTeacherRoutes } from "./teacher-routes";

const teacher = {
  id: 9,
  userId: 90,
  schoolId: 1,
  fullName: "Leave Teacher",
  assignedClass: "6",
  assignedSection: "C",
  isActive: true,
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

test("legacy Student Leave route requires tenant, selected session, assignment and session roster", async (t) => {
  const calls = {
    selected: [] as Array<[number, number]>,
    activeFallback: [] as number[],
    assignmentReads: [] as number[],
    scopedLeaveReads: [] as Array<[number, number, string, string]>,
    mineReads: [] as Array<[number, number, number]>,
    existingLeaveReads: 0,
    attendanceApprovals: [] as Array<Record<string, unknown>>,
    statusUpdates: [] as unknown[][],
    auditLogWrites: 0,
  };
  const leaves = [
    { id: 1, schoolId: 1, sessionId: 101, studentId: 11, class: "7", section: "A" },
    { id: 2, schoolId: 1, sessionId: 102, studentId: 11, class: "7", section: "A" },
    { id: 3, schoolId: 1, sessionId: null, studentId: 11, class: "7", section: "A" },
    { id: 4, schoolId: 2, sessionId: 101, studentId: 21, class: "7", section: "A" },
    { id: 5, schoolId: 1, sessionId: 101, studentId: 12, class: "7", section: "B" },
    { id: 6, schoolId: 1, sessionId: 101, studentId: 13, class: "6", section: "C" },
  ];
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

  replaceStorage("getTeacherWithSchool", async (id: number) =>
    id === teacher.id ? teacherAccount : undefined);
  replaceStorage("getAcademicSessionForSchool", async (id: number, schoolId: number) => {
    calls.selected.push([id, schoolId]);
    return sessions.find(session => session.id === id && session.schoolId === schoolId);
  });
  replaceStorage("getActiveSession", async (schoolId: number) => {
    calls.activeFallback.push(schoolId);
    return sessions.find(session => session.schoolId === schoolId && session.isActive);
  });
  replaceStorage("getFacultyMappingsByTeacher", async (teacherId: number) => {
    calls.assignmentReads.push(teacherId);
    return teacherId === teacher.id ? [{ className: "7", section: "A", subject: null }] : [];
  });
  replaceStorage("getStudentLeavesBySessionClassSection", async (
    schoolId: number, sessionId: number, className: string, section: string,
  ) => {
    calls.scopedLeaveReads.push([schoolId, sessionId, className, section]);
    return leaves.filter(leave =>
      leave.schoolId === schoolId
      && leave.sessionId === sessionId
      && leave.class === className
      && leave.section === section,
    );
  });
  replaceStorage("getStudentLeavesByTeacher", async (
    teacherId: number, schoolId: number, sessionId: number,
  ) => {
    calls.mineReads.push([teacherId, schoolId, sessionId]);
    return [{ id: 50, schoolId, sessionId }];
  });
  replaceStorage("getStudentLeaveById", async (id: number, schoolId: number) => {
    calls.existingLeaveReads += 1;
    if (schoolId !== 1 || ![1, 2, 3].includes(id)) return undefined;
    return {
      id,
      studentId: 11,
      schoolId,
      sessionId: 101,
      status: "pending_teacher",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    };
  });
  replaceStorage("getStudentById", async (studentId: number) => studentId === 11
    ? { id: studentId, schoolId: 1, class: "7", section: "A" }
    : undefined);
  replaceStorage("approveStudentLeaveWithAttendance", async (input: Record<string, unknown>) => {
    calls.attendanceApprovals.push(input);
    return { id: input.leaveId, schoolId: input.schoolId, sessionId: input.sessionId, status: "approved" };
  });
  replaceStorage("updateStudentLeaveStatus", async (...args: unknown[]) => {
    calls.statusUpdates.push(args);
    return { id: args[0], schoolId: args[1], sessionId: args[8], status: args[2] };
  });
  replaceStorage("createAuditLog", async () => {
    calls.auditLogWrites += 1;
  });

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
    (req as any).session = role === "anonymous"
      ? {}
      : { teacherId: 9, userId: 90, schoolId: 1, userRole: "teacher" };
    next();
  });
  registerTeacherRoutes(app);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
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

  const activeClassPath = "/api/student-leaves/1/7/A";
  assert.equal((await request(activeClassPath, { role: "anonymous", sessionId: 101 })).status, 401);
  assert.equal((await request(activeClassPath)).status, 400, "missing selected session is rejected");
  assert.equal((await request(activeClassPath, { sessionId: 201 })).status, 403, "foreign session is rejected");
  assert.equal((await request("/api/student-leaves/2/7/A", { sessionId: 101 })).status, 403, "URL school spoofing is rejected");

  const active = await request(activeClassPath, { sessionId: 101 });
  assert.equal(active.status, 200);
  assert.deepEqual(active.body.map((leave: any) => leave.id), [1]);
  assert.deepEqual(calls.scopedLeaveReads.at(-1), [1, 101, "7", "A"]);

  const historical = await request(activeClassPath, { sessionId: 102 });
  assert.equal(historical.status, 200, "historical same-school sessions remain readable");
  assert.deepEqual(historical.body.map((leave: any) => leave.id), [2]);
  assert.deepEqual(calls.scopedLeaveReads.at(-1), [1, 102, "7", "A"]);

  for (const action of ["approve", "reject", "forward"]) {
    const historicalWrite = await request(`/api/student-leaves/31/${action}`, {
      method: "PATCH",
      sessionId: 102,
      body: action === "reject" ? { rejectionReason: "Not eligible" } : {},
    });
    assert.equal(historicalWrite.status, 403, `historical ${action} is rejected`);
  }
  assert.equal(calls.existingLeaveReads, 0, "historical writes are rejected before leave lookup");
  assert.deepEqual(calls.attendanceApprovals, []);
  assert.deepEqual(calls.statusUpdates, []);

  const readsBeforeUnassigned = calls.scopedLeaveReads.length;
  assert.equal((await request("/api/student-leaves/1/8/A", { sessionId: 101 })).status, 403);
  assert.equal((await request("/api/student-leaves/1/7/B", { sessionId: 101 })).status, 403);
  assert.equal(calls.scopedLeaveReads.length, readsBeforeUnassigned, "unassigned class/section never reaches the data query");

  const legacyAssignment = await request("/api/student-leaves/1/6/C", { sessionId: 101 });
  assert.equal(legacyAssignment.status, 200, "legacy assignedClass/assignedSection fallback is preserved");
  assert.deepEqual(calls.scopedLeaveReads.at(-1), [1, 101, "6", "C"]);
  assert.equal(calls.activeFallback.length, 0, "the route never substitutes the active session");

  assert.equal((await request("/api/student-leaves/teacher/mine")).status, 400);
  const mine = await request("/api/student-leaves/teacher/mine", { sessionId: 101 });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body, [{ id: 50, schoolId: 1, sessionId: 101 }]);
  const historicalMine = await request("/api/student-leaves/teacher/mine", { sessionId: 102 });
  assert.equal(historicalMine.status, 200, "the same queue remains readable for a selected historical session");
  assert.deepEqual(historicalMine.body, [{ id: 50, schoolId: 1, sessionId: 102 }]);
  assert.equal((await request("/api/student-leaves/teacher/mine", { sessionId: 201 })).status, 403);
  assert.deepEqual(calls.mineReads, [[9, 1, 101], [9, 1, 102]]);
  assert.equal(calls.activeFallback.length, 0, "the queue never substitutes the active session");

  const activeApproval = await request("/api/student-leaves/1/approve", {
    method: "PATCH",
    sessionId: 101,
    body: { teacherComment: "Verified" },
  });
  assert.equal(activeApproval.status, 200);
  assert.equal(calls.attendanceApprovals.length, 1);
  assert.deepEqual(calls.attendanceApprovals[0], {
    leaveId: 1,
    studentId: 11,
    teacherId: 9,
    schoolId: 1,
    sessionId: 101,
    expectedStatus: "pending_teacher",
    reviewedBy: 9,
    reviewerRole: "teacher",
    teacherComment: "Verified",
  });

  const activeRejection = await request("/api/student-leaves/2/reject", {
    method: "PATCH",
    sessionId: 101,
    body: { rejectionReason: "Not eligible" },
  });
  assert.equal(activeRejection.status, 200);
  assert.deepEqual(calls.statusUpdates[0], [
    2, 1, "rejected", 9, "teacher", "Not eligible", undefined, undefined, 101,
  ]);

  const activeForward = await request("/api/student-leaves/3/forward", {
    method: "PATCH",
    sessionId: 101,
    body: { teacherComment: "Please review" },
  });
  assert.equal(activeForward.status, 200);
  assert.deepEqual(calls.statusUpdates[1], [
    3, 1, "forwarded_to_admin", 9, "teacher", undefined, undefined, "Please review", 101,
  ]);
  assert.equal(calls.auditLogWrites, 3);
});
