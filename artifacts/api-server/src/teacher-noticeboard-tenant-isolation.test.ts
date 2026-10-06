import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { storage } from "./storage";
import { registerTeacherRoutes } from "./teacher-routes";

const teacher = {
  id: 9,
  userId: 90,
  schoolId: 1,
  fullName: "Notice Teacher",
  isActive: true,
};

test("Web Noticeboard routes keep Support Staff and Admin within their authenticated school", async (t) => {
  const staffAccount = { id: 7, schoolId: 1, isActive: true };
  const activeSessions = new Map([
    [1, { id: 101, schoolId: 1, isActive: true }],
    [2, { id: 201, schoolId: 2, isActive: true }],
  ]);
  const notices = new Map<number, any>([
    [11, { id: 11, schoolId: 1, sessionId: 101, content: "School A notice" }],
    [22, { id: 22, schoolId: 2, sessionId: 201, content: "School B notice" }],
  ]);
  const calls = {
    targetReads: [] as Array<[number, string, string | undefined, string | undefined, number | null | undefined]>,
    allReads: [] as Array<[number, number | undefined, number | null | undefined]>,
    activeSessionReads: [] as number[],
    createdNotices: [] as any[],
    scopedNoticeReads: [] as Array<[number, number]>,
    deletes: [] as Array<[number, number]>,
    updates: [] as Array<[number, number, string]>,
    bulkDeletes: [] as Array<[number, number]>,
    supportStaffReads: [] as number[],
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

  replaceStorage("getNonTeachingStaffById", async (id: number) => {
    calls.supportStaffReads.push(id);
    if (id === staffAccount.id) return staffAccount;
    if (id === 8) return { id: 8, schoolId: 1, isActive: false };
    return undefined;
  });
  replaceStorage("getActiveSession", async (schoolId: number) => {
    calls.activeSessionReads.push(schoolId);
    return activeSessions.get(schoolId);
  });
  replaceStorage("getNoticesByTarget", async (
    schoolId: number, target: string, cls?: string, section?: string, sessionId?: number | null,
  ) => {
    calls.targetReads.push([schoolId, target, cls, section, sessionId]);
    return [...notices.values()].filter(notice => notice.schoolId === schoolId);
  });
  replaceStorage("getAllSchoolNotices", async (
    schoolId: number, limit?: number, sessionId?: number | null,
  ) => {
    calls.allReads.push([schoolId, limit, sessionId]);
    return [...notices.values()].filter(notice => notice.schoolId === schoolId);
  });
  replaceStorage("createNotice", async (record: any) => {
    const created = { id: 100 + calls.createdNotices.length, ...record };
    calls.createdNotices.push(created);
    notices.set(created.id, created);
    return created;
  });
  replaceStorage("getNoticeByIdForSchool", async (id: number, schoolId: number) => {
    calls.scopedNoticeReads.push([id, schoolId]);
    const notice = notices.get(id);
    return notice?.schoolId === schoolId ? notice : null;
  });
  replaceStorage("deleteNotice", async (id: number, schoolId: number) => {
    calls.deletes.push([id, schoolId]);
    if (notices.get(id)?.schoolId === schoolId) notices.delete(id);
  });
  replaceStorage("updateNotice", async (id: number, schoolId: number, content: string) => {
    calls.updates.push([id, schoolId, content]);
    const notice = notices.get(id);
    if (!notice || notice.schoolId !== schoolId) return null;
    const updated = { ...notice, content };
    notices.set(id, updated);
    return updated;
  });
  replaceStorage("bulkDeleteNotices", async (schoolId: number, olderThanDays: number) => {
    calls.bulkDeletes.push([schoolId, olderThanDays]);
    return 2;
  });
  replaceStorage("getTeacherWithSchool", async (teacherId: number) => teacherId === teacher.id
    ? {
      teacher: { ...teacher },
      school: { id: 1 },
      user: { id: teacher.userId, role: "teacher", schoolId: 1, isActive: true },
    }
    : undefined);
  replaceStorage("getAcademicSessionForSchool", async (sessionId: number, schoolId: number) => {
    const session = activeSessions.get(schoolId);
    return session?.id === sessionId ? session : undefined;
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
    const role = req.get("x-test-role") ?? "support_staff";
    const allowedModules = role === "no_noticeboard_grant"
      ? []
      : role === "legacy_noticeboard_child"
        ? ["noticeboard:view"]
        : ["noticeboard"];
    (req as any).session = role === "anonymous"
      ? {}
      : role === "admin"
        ? { userId: 70, userRole: "admin", schoolId: 1 }
        : role === "teacher"
          ? { teacherId: teacher.id, userId: teacher.userId, userRole: "teacher", schoolId: 1 }
          : role === "mismatched_staff"
            ? { userId: -staffAccount.id, staffId: staffAccount.id, userRole: "support_staff", schoolId: 2, allowedModules }
          : role === "inactive_staff"
            ? { userId: -8, staffId: 8, userRole: "support_staff", schoolId: 1, allowedModules }
            : { userId: -staffAccount.id, staffId: staffAccount.id, userRole: "support_staff", schoolId: 1, allowedModules };
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
    options: { method?: string; body?: unknown; role?: string; sessionId?: number } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.role ? { "x-test-role": options.role } : {}),
        ...(options.sessionId === undefined ? {} : { "x-view-session-id": String(options.sessionId) }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  for (const role of ["no_noticeboard_grant", "legacy_noticeboard_child"]) {
    const deniedRequests = [
      await request("/api/notices/1/all", { role }),
      await request("/api/notices/1?target=student", { role }),
      await request("/api/notices", {
        role,
        method: "POST",
        body: { schoolId: 1, targetType: "whole_school", content: "Must be denied" },
      }),
      await request("/api/notices/11", { role, method: "PUT", body: { content: "Must be denied" } }),
      await request("/api/notices/11", { role, method: "DELETE" }),
      await request("/api/admin/notices/bulk", {
        role,
        method: "DELETE",
        body: { olderThanDays: 30 },
      }),
    ];
    assert.deepEqual(
      deniedRequests.map(response => response.status),
      Array(6).fill(403),
      `${role} must not use protected Noticeboard APIs`,
    );
  }

  const staffSchoolARead = await request("/api/notices/1?target=student&class=7&schoolId=2");
  assert.equal(staffSchoolARead.status, 200);
  assert.deepEqual(calls.targetReads.at(-1), [1, "student", "7", undefined, null]);

  const readsBeforeForeign = calls.targetReads.length;
  const staffSchoolBRead = await request("/api/notices/2?target=student");
  assert.equal(staffSchoolBRead.status, 403);
  assert.deepEqual(calls.targetReads.length, readsBeforeForeign, "foreign notice data is rejected before its query");

  const staffSchoolAFullFeed = await request("/api/notices/1/all?schoolId=2");
  assert.equal(staffSchoolAFullFeed.status, 200);
  assert.deepEqual(calls.allReads.at(-1), [1, 500, 101]);

  const allReadsBeforeForeign = calls.allReads.length;
  const activeReadsBeforeForeign = calls.activeSessionReads.length;
  const staffSchoolBFullFeed = await request("/api/notices/2/all");
  assert.equal(staffSchoolBFullFeed.status, 403);
  assert.equal(calls.allReads.length, allReadsBeforeForeign, "foreign full-feed data is not queried");
  assert.equal(calls.activeSessionReads.length, activeReadsBeforeForeign, "foreign active session is not queried");

  const staffOwnNotice = await request("/api/notices", {
    method: "POST",
    body: { schoolId: 1, targetType: "class", targetClass: "7", targetSection: "A", content: "School A post" },
  });
  assert.equal(staffOwnNotice.status, 201);
  assert.equal(calls.createdNotices.at(-1).schoolId, 1);
  assert.equal(calls.createdNotices.at(-1).sessionId, 101);
  assert.equal(calls.createdNotices.at(-1).targetClass, "7");
  assert.equal(calls.createdNotices.at(-1).targetSection, "A");
  assert.equal(calls.createdNotices.at(-1).creatorRole, "admin", "existing actor attribution remains unchanged");
  assert.equal(calls.createdNotices.at(-1).createdById, -staffAccount.id, "negative compatibility actor ID remains unchanged");

  const writesBeforeForeign = calls.createdNotices.length;
  const activeReadsBeforeForeignWrite = calls.activeSessionReads.length;
  const staffForeignNotice = await request("/api/notices", {
    method: "POST",
    body: { schoolId: 2, targetType: "whole_school", content: "Must not be created" },
  });
  assert.equal(staffForeignNotice.status, 403);
  assert.equal(calls.createdNotices.length, writesBeforeForeign, "foreign notice is never created");
  assert.equal(calls.activeSessionReads.length, activeReadsBeforeForeignWrite, "foreign session is not queried");

  const inactiveStaffRead = await request("/api/notices/1", { role: "inactive_staff" });
  assert.equal(inactiveStaffRead.status, 403, "a Staff ID that cannot be resolved does not authorize a school");
  const mismatchedStaffRead = await request("/api/notices/2", { role: "mismatched_staff" });
  assert.equal(mismatchedStaffRead.status, 403, "the current Staff record's school overrides a mismatched session school");

  const staffEditOwn = await request("/api/notices/11", {
    method: "PUT",
    body: { content: "Updated School A notice" },
  });
  assert.equal(staffEditOwn.status, 200);
  assert.deepEqual(calls.updates.at(-1), [11, 1, "Updated School A notice"]);

  const updatesBeforeForeignEdit = calls.updates.length;
  const staffEditForeign = await request("/api/notices/22", {
    method: "PUT",
    body: { content: "Must not be changed" },
  });
  assert.equal(staffEditForeign.status, 404);
  assert.equal(calls.updates.length, updatesBeforeForeignEdit + 1);
  assert.deepEqual(calls.updates.at(-1), [22, 1, "Must not be changed"]);
  assert.equal(notices.get(22)?.content, "School B notice");

  const staffDeleteOwn = await request("/api/notices/11", { method: "DELETE" });
  assert.equal(staffDeleteOwn.status, 200);
  assert.deepEqual(calls.deletes.at(-1), [11, 1]);

  const staffBulkDelete = await request("/api/admin/notices/bulk", {
    method: "DELETE",
    body: { olderThanDays: 30, schoolId: 2 },
  });
  assert.equal(staffBulkDelete.status, 200);
  assert.deepEqual(calls.bulkDeletes.at(-1), [1, 30], "bulk delete keeps the authenticated school, not a body override");

  const deletesBeforeForeignDelete = calls.deletes.length;
  const staffDeleteForeign = await request("/api/notices/22", { method: "DELETE" });
  assert.equal(staffDeleteForeign.status, 404);
  assert.equal(calls.deletes.length, deletesBeforeForeignDelete);
  assert.equal(notices.has(22), true);

  const adminOwnRead = await request("/api/notices/1", { role: "admin" });
  assert.equal(adminOwnRead.status, 200, "same-school Principal/Admin behavior remains available");
  const adminForeignRead = await request("/api/notices/2", { role: "admin" });
  assert.equal(adminForeignRead.status, 403);

  const adminOwnCreate = await request("/api/notices", {
    role: "admin",
    method: "POST",
    body: { schoolId: 1, targetType: "whole_school", content: "Principal notice" },
  });
  assert.equal(adminOwnCreate.status, 201);
  const adminForeignCreate = await request("/api/notices", {
    role: "admin",
    method: "POST",
    body: { schoolId: 2, targetType: "whole_school", content: "Must not be created" },
  });
  assert.equal(adminForeignCreate.status, 403);

  const teacherRead = await request("/api/notices/1?target=student", {
    role: "teacher",
    sessionId: 101,
  });
  assert.equal(teacherRead.status, 200, "Teacher Noticeboard session behavior remains available");
  assert.deepEqual(calls.targetReads.at(-1), [1, "student", undefined, undefined, 101]);
});
