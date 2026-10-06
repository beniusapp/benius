import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { storage } from "./storage";
import { registerTeacherRoutes } from "./teacher-routes";

test("Support Staff Approval Center and Leave Requests grants isolate UI-backed API operations", async (t) => {
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

  const calls = {
    auditLogs: [] as any[],
    historySessions: [] as number[],
    leaveListSessions: [] as number[],
    leaveStatusUpdates: [] as any[],
    studentApprovals: [] as any[],
    studentListSessions: [] as number[],
    studentStatusUpdates: [] as any[],
  };

  replaceStorage("getAdminGalleryItems", async (schoolId: number) => [{ id: 11, schoolId }]);
  replaceStorage("getGalleryItems", async (schoolId: number) => [{ id: 11, schoolId, approved: false }]);
  replaceStorage("getGalleryItemById", async (id: number) => ({ id, schoolId: 1, title: "Photo" }));
  replaceStorage("approveGalleryItem", async (id: number) => ({ id, schoolId: 1, title: "Photo" }));
  replaceStorage("deleteGalleryItem", async () => undefined);
  replaceStorage("deleteGalleryItems", async () => undefined);
  replaceStorage("getLibraryBooksWithUploaderNames", async (schoolId: number) => [{ id: 21, schoolId, title: "Book" }]);
  replaceStorage("getPendingEbooks", async (schoolId: number) => [{ id: 21, schoolId, title: "Book" }]);
  replaceStorage("getLibraryBookById", async (id: number) => ({ id, schoolId: 1, title: "Book" }));
  replaceStorage("updateBookVerificationStatus", async (id: number, status: string) => ({ id, schoolId: 1, title: "Book", verificationStatus: status }));
  replaceStorage("deleteLibraryBook", async () => undefined);
  replaceStorage("getLeaveRequestsBySchool", async (schoolId: number, sessionId: number) => {
    calls.leaveListSessions.push(sessionId);
    return [{ id: 31, schoolId, sessionId }];
  });
  replaceStorage("getLeaveRequestById", async (id: number) => ({
    id,
    schoolId: 1,
    sessionId: id === 41 || id === 51 ? 101 : 100,
    teacherId: 3,
    status: "pending",
  }));
  replaceStorage("updateLeaveStatusBySchool", async (id: number, schoolId: number, status: string) => {
    calls.leaveStatusUpdates.push({ id, schoolId, status });
    return { id, schoolId, status };
  });
  replaceStorage("updateLeaveStatusWithApprover", async (id: number, schoolId: number, status: string, approvedBy: number) => {
    calls.leaveStatusUpdates.push({ id, schoolId, status, approvedBy });
    return { id, schoolId, status, approvedBy };
  });
  replaceStorage("getStudentLeavesForAdmin", async (schoolId: number, sessionId: number) => {
    calls.studentListSessions.push(sessionId);
    return [{ id: 51, schoolId, sessionId }];
  });
  replaceStorage("getApprovalHistory", async (_schoolId: number, sessionId: number) => {
    calls.historySessions.push(sessionId);
    return {
      teacherLeaves: [{ id: 61, type: "teacher" }],
      studentLeaves: [{ id: 62, type: "student" }],
      gallery: [{ id: 63, type: "gallery" }],
      ebooks: [{ id: 64, type: "ebook" }],
    };
  });
  replaceStorage("getStudentLeaveById", async (id: number, schoolId: number) => ({
    id,
    schoolId,
    studentId: 5,
    sessionId: id === 41 || id === 51 ? 101 : 100,
    status: "forwarded_to_admin",
    startDate: "2026-08-01",
    endDate: "2026-08-02",
  }));
  replaceStorage("getStudentById", async (id: number) => ({ id, schoolId: 1, class: "5", section: "A" }));
  replaceStorage("getTeacherByClassSection", async () => null);
  replaceStorage("approveStudentLeaveWithAttendance", async (args: any) => {
    calls.studentApprovals.push(args);
    return { id: args.leaveId, schoolId: args.schoolId, status: "approved" };
  });
  replaceStorage("updateStudentLeaveStatus", async (...args: any[]) => {
    calls.studentStatusUpdates.push(args);
    return { id: args[0], schoolId: args[1], status: args[2] };
  });
  replaceStorage("getActiveSession", async (schoolId: number) => ({
    id: 100, schoolId, isActive: true, name: "Current",
    startDate: "2026-04-01", endDate: "2027-03-31",
  }));
  replaceStorage("getAcademicSessionForSchool", async (id: number, schoolId: number) => {
    if (id === 100) return {
      id, schoolId, isActive: true, name: "Current",
      startDate: "2026-04-01", endDate: "2027-03-31",
    };
    if (id === 101) return {
      id, schoolId, isActive: false, name: "Archived",
      startDate: "2025-04-01", endDate: "2026-03-31",
    };
    return undefined;
  });
  replaceStorage("getNonTeachingStaffBySchool", async () => [{
    id: 7, schoolId: 1, fullName: "Staff Member", passwordHash: "hidden",
    allowedModules: ["id-card-gen"],
  }]);
  replaceStorage("createAuditLog", async (entry: any) => {
    calls.auditLogs.push(entry);
    return entry;
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
    const grants = JSON.parse(req.get("x-test-grants") ?? "[]") as string[];
    (req as any).session = role === "admin"
      ? { userId: 70, userRole: "admin", schoolId: 1, allowedModules: grants }
      : {
        userId: -7, staffId: 7, userRole: "support_staff",
        schoolId: 1, allowedModules: grants,
      };
    const viewSessionId = req.get("x-test-view-session");
    if (viewSessionId) (req as any).viewSessionId = Number(viewSessionId);
    next();
  });
  registerTeacherRoutes(app);

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
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
    options: {
      method?: string;
      body?: unknown;
      role?: "admin" | "support_staff";
      grants?: string[];
      viewSessionId?: number;
    } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "x-test-role": options.role ?? "support_staff",
        "x-test-grants": JSON.stringify(options.grants ?? []),
        ...(options.viewSessionId === undefined ? {} : { "x-test-view-session": String(options.viewSessionId) }),
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  const galleryGrant = ["approval-center", "approval-center:gallery-hub"];
  const ebookGrant = ["approval-center", "approval-center:ebook"];
  const teacherLeaveGrant = ["leave-requests", "leave-requests:teacher-leave"];
  const studentLeaveGrant = ["leave-requests", "leave-requests:student-leave"];
  const historyGrant = ["leave-requests", "leave-requests:leave-history"];

  assert.equal((await request("/api/admin/gallery/1", { grants: ebookGrant })).status, 403);
  assert.equal((await request("/api/admin/gallery/1", { grants: galleryGrant })).status, 200);
  assert.equal((await request("/api/gallery/1?all=true", { grants: ebookGrant })).status, 403);
  assert.equal((await request("/api/gallery/1?all=true", { grants: galleryGrant })).status, 200);
  assert.equal((await request("/api/gallery", { method: "POST", grants: ebookGrant })).status, 403);
  assert.equal((await request("/api/gallery", { method: "POST", grants: galleryGrant })).status, 400);
  assert.equal((await request("/api/gallery/batch", { method: "POST", grants: ebookGrant })).status, 403);
  assert.equal((await request("/api/gallery/batch", { method: "POST", grants: galleryGrant })).status, 400);
  assert.equal((await request("/api/library/books/1/pending", { grants: galleryGrant })).status, 403);
  assert.equal((await request("/api/library/books/1/pending", { grants: ebookGrant })).status, 200);
  assert.equal((await request("/api/library/books/1", { grants: galleryGrant })).status, 403);
  assert.equal((await request("/api/library/books/1", { grants: ebookGrant })).status, 200);
  assert.equal((await request("/api/library/ebooks/admin", {
    method: "POST", grants: galleryGrant,
  })).status, 403);
  assert.equal((await request("/api/library/ebooks/admin", {
    method: "POST", grants: ebookGrant,
  })).status, 400);
  assert.equal((await request("/api/admin/gallery/2", { grants: galleryGrant })).status, 403);

  const galleryHistory = await request("/api/approval-history/1", { grants: galleryGrant });
  assert.equal(galleryHistory.status, 200);
  assert.deepEqual(galleryHistory.body.gallery, [{ id: 63, type: "gallery" }]);
  assert.deepEqual(galleryHistory.body.ebooks, []);
  assert.deepEqual(galleryHistory.body.teacherLeaves, []);
  const leaveHistory = await request("/api/approval-history/1", { grants: historyGrant });
  assert.equal(leaveHistory.status, 200);
  assert.equal(leaveHistory.body.teacherLeaves.length, 1);
  assert.equal(leaveHistory.body.studentLeaves.length, 1);
  assert.deepEqual(leaveHistory.body.gallery, []);
  assert.deepEqual(leaveHistory.body.ebooks, []);
  assert.equal((await request("/api/approval-history/1", {
    grants: historyGrant, viewSessionId: 101,
  })).status, 200);
  assert.equal(calls.historySessions.at(-1), 101);
  assert.equal((await request("/api/approval-history/1")).status, 403);

  assert.equal((await request("/api/leave/school/1", { grants: studentLeaveGrant })).status, 403);
  assert.equal((await request("/api/leave/school/1", { grants: teacherLeaveGrant })).status, 200);
  assert.equal((await request("/api/leave/school/1", {
    grants: teacherLeaveGrant, viewSessionId: 101,
  })).status, 200);
  assert.equal(calls.leaveListSessions.at(-1), 101, "selected archived sessions remain authoritative for reads");
  assert.equal((await request("/api/student-leaves/school/1", { grants: teacherLeaveGrant })).status, 403);
  assert.equal((await request("/api/student-leaves/school/1", { grants: studentLeaveGrant })).status, 200);
  assert.equal((await request("/api/student-leaves/school/1", {
    grants: studentLeaveGrant, viewSessionId: 101,
  })).status, 200);
  assert.equal(calls.studentListSessions.at(-1), 101);

  assert.equal((await request("/api/gallery/11/approve", {
    method: "PATCH", grants: ebookGrant,
  })).status, 403);
  assert.equal((await request("/api/gallery/11/approve", {
    method: "PATCH", grants: galleryGrant,
  })).status, 200);
  assert.equal((await request("/api/library/books/21/verify", {
    method: "PATCH", grants: galleryGrant, body: { status: "approved" },
  })).status, 403);
  assert.equal((await request("/api/library/books/21/verify", {
    method: "PATCH", grants: ebookGrant, body: { status: "approved" },
  })).status, 200);
  assert.equal((await request("/api/library/books/21", {
    method: "DELETE", grants: galleryGrant,
  })).status, 403);
  assert.equal((await request("/api/library/books/21", {
    method: "DELETE", grants: ebookGrant,
  })).status, 200);

  assert.equal((await request("/api/leave/40/status", {
    method: "PATCH", grants: teacherLeaveGrant, body: { status: "rejected" },
  })).status, 200);
  assert.equal(calls.leaveStatusUpdates.at(-1).approvedBy, undefined, "Support Staff IDs are not written into the untyped approvedBy field");
  assert.equal(calls.auditLogs.at(-1).actionBy, 7);
  assert.equal(calls.auditLogs.at(-1).actionByRole, "support_staff");
  assert.equal((await request("/api/leave/40/status", {
    method: "PATCH", grants: historyGrant, body: { status: "rejected" },
  })).status, 403);
  const archivedTeacherLeave = await request("/api/leave/41/status", {
    method: "PATCH", grants: teacherLeaveGrant, viewSessionId: 101,
    body: { status: "rejected" },
  });
  assert.equal(archivedTeacherLeave.status, 403);
  assert.equal(archivedTeacherLeave.body.code, "ARCHIVE_READ_ONLY");
  assert.equal((await request("/api/leave/41/status", {
    method: "PATCH", grants: teacherLeaveGrant, viewSessionId: 100,
    body: { status: "rejected" },
  })).status, 404);

  assert.equal((await request("/api/student-leaves/50/admin-approve", {
    method: "PATCH", grants: teacherLeaveGrant,
  })).status, 403);
  assert.equal((await request("/api/student-leaves/50/admin-approve", {
    method: "PATCH", grants: studentLeaveGrant, body: {},
  })).status, 200);
  assert.equal(calls.studentApprovals.at(-1).reviewedBy, 7);
  assert.equal(calls.studentApprovals.at(-1).reviewerRole, "support_staff");
  assert.equal((await request("/api/student-leaves/50/reject", {
    method: "PATCH", grants: studentLeaveGrant, body: {},
  })).status, 200);
  assert.equal(calls.studentStatusUpdates.at(-1)[3], 7);
  assert.equal(calls.studentStatusUpdates.at(-1)[4], "support_staff");
  const archivedStudentLeave = await request("/api/student-leaves/51/admin-approve", {
    method: "PATCH", grants: studentLeaveGrant, viewSessionId: 101, body: {},
  });
  assert.equal(archivedStudentLeave.status, 403);
  assert.equal(archivedStudentLeave.body.code, "ARCHIVE_READ_ONLY");
  assert.equal((await request("/api/student-leaves/51/reject", {
    method: "PATCH", grants: studentLeaveGrant, viewSessionId: 101, body: {},
  })).status, 403);

  const supportGalleryAudit = calls.auditLogs.find(log => log.entityType === "gallery");
  assert.equal(supportGalleryAudit.actionBy, 7);
  assert.equal(supportGalleryAudit.actionByRole, "support_staff");
  const adminGallery = await request("/api/gallery/11/approve", {
    method: "PATCH", role: "admin",
  });
  assert.equal(adminGallery.status, 200, "Admin gallery access remains unrestricted by Support Staff grants");
  assert.equal(calls.auditLogs.at(-1).actionBy, 70);
  assert.equal(calls.auditLogs.at(-1).actionByRole, "admin");

  assert.equal((await request("/api/admin/non-teaching-staff", {
    grants: ["non-teaching-staff"],
  })).status, 403);
  const cardRead = await request("/api/admin/non-teaching-staff", { grants: ["id-card-gen"] });
  assert.equal(cardRead.status, 200, "the existing ID Card Gen read path remains available");
  assert.equal("passwordHash" in cardRead.body[0], false);
  assert.equal("allowedModules" in cardRead.body[0], false);
  for (const [method, path] of [
    ["POST", "/api/admin/non-teaching-staff"],
    ["PATCH", "/api/admin/non-teaching-staff/7"],
    ["DELETE", "/api/admin/non-teaching-staff/7"],
    ["POST", "/api/admin/non-teaching-staff/7/photo"],
  ] as const) {
    assert.equal((await request(path, {
      method, grants: ["id-card-gen", "non-teaching-staff"],
    })).status, 403, `${method} ${path} remains Admin-only`);
  }
});
