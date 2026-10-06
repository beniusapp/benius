import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { db } from "./db";
import { registerRoutes } from "./routes/routes";
import { storage } from "./storage";

test("Support Staff parent grants gate the five enterprise modules and retain school/session scope", async (t) => {
  const replacements: Array<{ target: any; name: string; hadOwn: boolean; original: unknown }> = [];
  const replace = (target: any, name: string, implementation: (...args: any[]) => any) => {
    replacements.push({
      target,
      name,
      hadOwn: Object.prototype.hasOwnProperty.call(target, name),
      original: target[name],
    });
    target[name] = implementation;
  };

  const analyticsReads: Array<[number, string, number | null | undefined]> = [];
  const metadataReads: number[] = [];
  const auditReads: Array<[number, number, number | null | undefined]> = [];
  const visitorReads: Array<[number, number | null | undefined]> = [];
  const visitorCreates: any[] = [];
  const visitorAuditEntries: any[] = [];
  const assetReads: number[] = [];
  const assetCreates: any[] = [];
  const assetUpdates: Array<[number, number, any]> = [];
  const assetDeletes: Array<[number, number]> = [];
  const assetActivity: any[] = [];
  const assetAuditEntries: any[] = [];
  const studentReads: any[] = [];
  const teacherReads: number[] = [];

  replace(storage, "getActiveSession", async (schoolId: number) =>
    ({ id: 101, schoolId, isActive: true }),
  );
  replace(storage, "getAcademicSessionById", async (id: number) => ({
    id,
    schoolId: 1,
    isActive: id !== 99,
  }));
  replace(storage, "getAllSchoolMetadata", async (schoolId: number) => {
    metadataReads.push(schoolId);
    return {
      classes: ["5"],
      sections: ["A"],
      subjects: ["Mathematics"],
      exam_types: ["Midterm"],
      class_sections: { "5": ["A"] },
      class_subjects: { "5": ["Mathematics"] },
      class_exam_types: { "5": ["Midterm"] },
    };
  });
  replace(storage, "getDistinctSectionsByClass", async (schoolId: number, cls: string) => {
    analyticsReads.push([schoolId, cls, undefined]);
    return ["A"];
  });
  replace(storage, "resolveClassPassPolicy", async () => ({ id: 9 }));
  replace(storage, "getAnalyticsData", async (
    schoolId: number,
    cls: string,
    options: { sessionId?: number | null },
  ) => {
    analyticsReads.push([schoolId, cls, options.sessionId]);
    return [{ class: cls, sessionId: options.sessionId }];
  });
  replace(storage, "getAuditLogsBySchool", async (
    schoolId: number,
    limit: number,
    sessionId?: number | null,
  ) => {
    auditReads.push([schoolId, limit, sessionId]);
    return [{ id: 1, schoolId, sessionId, actionBy: 7, actionByRole: "support_staff" }];
  });
  replace(storage, "createVisitorLog", async (data: any) => {
    visitorCreates.push(data);
    return { id: 31, ...data };
  });
  replace(storage, "getVisitorLogsBySchool", async (
    schoolId: number,
    sessionId?: number | null,
  ) => {
    visitorReads.push([schoolId, sessionId]);
    const entries = [{
      id: 31,
      schoolId: 1,
      sessionId: 101,
      visitorName: "Test Visitor",
      checkOut: null,
    }];
    return entries.filter(entry =>
      entry.schoolId === schoolId && (sessionId == null || entry.sessionId === sessionId),
    );
  });
  replace(storage, "checkoutVisitor", async (id: number) => ({
    id,
    schoolId: 1,
    sessionId: 101,
    visitorName: "Test Visitor",
    checkOut: new Date(),
  }));
  replace(storage, "createAuditLog", async (entry: any) => {
    visitorAuditEntries.push(entry);
    if (entry.entityType === "asset") assetAuditEntries.push(entry);
    return { id: visitorAuditEntries.length, ...entry };
  });
  replace(storage, "getAssets", async (schoolId: number) => {
    assetReads.push(schoolId);
    return [{ id: 4, schoolId, name: "Projector" }];
  });
  replace(storage, "createAsset", async (data: any) => {
    assetCreates.push(data);
    return { id: 5, ...data };
  });
  replace(storage, "getAssetById", async (id: number, schoolId: number) => {
    if (id === 4 && schoolId === 1) return { id, schoolId, name: "Projector", quantity: 1 };
    if (id === 8 && schoolId === 2) return { id, schoolId, name: "School B Laptop", quantity: 1 };
    return null;
  });
  replace(storage, "updateAsset", async (id: number, schoolId: number, data: any) => {
    assetUpdates.push([id, schoolId, data]);
    return { id, schoolId, name: id === 4 ? "Projector" : "School B Laptop", ...data };
  });
  replace(storage, "deleteAsset", async (id: number, schoolId: number) => {
    assetDeletes.push([id, schoolId]);
    return true;
  });
  replace(storage, "logAssetActivity", async (entry: any) => {
    assetActivity.push(entry);
  });
  replace(storage, "getStudentsPaginated", async (schoolId: number, options: any) => {
    studentReads.push([schoolId, options]);
    return { data: [], total: 0 };
  });
  replace(storage, "getUserWithSchool", async (userId: number) => ({
    user: { id: userId, role: "admin" },
    school: { id: 1 },
  }));
  replace(storage, "getTeachersBySchool", async (schoolId: number) => {
    teacherReads.push(schoolId);
    return [{ id: 11, schoolId, fullName: "Teacher" }];
  });
  replace(storage, "getNonTeachingStaffBySchool", async (schoolId: number) => [{
    id: 8,
    schoolId,
    fullName: "Support Staff",
    email: "staff@example.test",
    phone: "1234567890",
    designation: "Accountant",
    passwordHash: "must-not-leak",
    allowedModules: ["id-card-gen"],
    isActive: true,
  }]);

  const dbTarget = db as any;
  replace(dbTarget, "select", () => ({
    from: () => ({
      where: async () => [],
    }),
  }));

  t.after(() => {
    for (const { target, name, hadOwn, original } of replacements.reverse()) {
      if (hadOwn) target[name] = original;
      else delete target[name];
    }
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get("x-test-role") ?? "support_staff";
    const allowedModules = (req.get("x-test-grants") ?? "").split(",").filter(Boolean);
    const schoolId = Number(req.get("x-test-school") ?? 1);
    (req as any).session = role === "admin"
      ? { userId: 70, userRole: "admin", schoolId, allowedModules }
      : {
          userId: -7,
          staffId: Number(req.get("x-test-staff-id") ?? 7),
          userRole: "support_staff",
          schoolId,
          allowedModules,
        };
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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
      schoolId?: number;
      staffId?: number;
      viewSessionId?: number;
    } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.role ? { "x-test-role": options.role } : {}),
        ...(options.grants ? { "x-test-grants": options.grants.join(",") } : {}),
        ...(options.schoolId ? { "x-test-school": String(options.schoolId) } : {}),
        ...(options.staffId === undefined ? {} : { "x-test-staff-id": String(options.staffId) }),
        ...(options.viewSessionId === undefined
          ? {}
          : { "x-view-session-id": String(options.viewSessionId) }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  const analyticsPath = "/api/admin/analytics/sections?class=5";
  assert.equal((await request(analyticsPath)).status, 403);
  assert.equal((await request(analyticsPath, { grants: ["analytics:view"] })).status, 403);
  assert.equal((await request(analyticsPath, { grants: ["analytics"], schoolId: 2 })).status, 200);
  assert.deepEqual(analyticsReads.at(-1), [2, "5", undefined]);
  assert.equal((await request("/api/school-metadata/1", { grants: ["analytics:results"] })).status, 403);
  const metadata = await request("/api/school-metadata/1", { grants: ["analytics"] });
  assert.equal(metadata.status, 200);
  assert.deepEqual(metadataReads, [1]);
  const cardMetadata = await request("/api/school-metadata/1", { grants: ["id-card-gen"] });
  assert.equal(cardMetadata.status, 200);
  assert.deepEqual(cardMetadata.body.classes, ["5"]);
  assert.deepEqual(cardMetadata.body.sections, ["A"]);
  assert.deepEqual(cardMetadata.body.subjects, []);
  assert.deepEqual(cardMetadata.body.class_sections, {});
  assert.equal((await request("/api/school-metadata/2", {
    grants: ["id-card-gen"],
  })).status, 403);
  const archivedAnalytics = await request("/api/admin/analytics/performance?class=5", {
    grants: ["analytics"],
    viewSessionId: 99,
  });
  assert.equal(archivedAnalytics.status, 200);
  assert.deepEqual(analyticsReads.at(-1), [1, "5", 99]);
  assert.equal((await request(analyticsPath, { role: "admin" })).status, 200);

  assert.equal((await request("/api/audit-logs/1")).status, 403);
  assert.equal((await request("/api/audit-logs/1", { grants: ["audit-logs:view"] })).status, 403);
  const auditLogs = await request("/api/audit-logs/1", {
    grants: ["audit-logs"],
    viewSessionId: 99,
  });
  assert.equal(auditLogs.status, 200);
  assert.deepEqual(auditReads.at(-1), [1, 100, 99]);
  assert.equal((await request("/api/audit-logs/2", { grants: ["audit-logs"] })).status, 403);
  assert.equal((await request("/api/audit-logs/1", { role: "admin" })).status, 200);

  assert.equal((await request("/api/visitor-logs/1")).status, 403);
  assert.equal((await request("/api/visitor-logs/1", { grants: ["visitor-log:checkin"] })).status, 403);
  const visitorList = await request("/api/visitor-logs/1", {
    grants: ["visitor-log"],
    viewSessionId: 99,
  });
  assert.equal(visitorList.status, 200);
  assert.deepEqual(visitorReads.at(-1), [1, 99]);
  assert.equal((await request("/api/visitor-logs/2", { grants: ["visitor-log"] })).status, 403);

  const visitorBody = {
    schoolId: 2,
    visitorName: "New Visitor",
    purpose: "Meeting",
    hostName: "Office",
  };
  assert.equal((await request("/api/visitor-logs", {
    method: "POST",
    body: visitorBody,
  })).status, 403);
  assert.equal((await request("/api/visitor-logs", {
    method: "POST",
    grants: ["visitor-log"],
    body: visitorBody,
  })).status, 201);
  assert.equal(visitorCreates.at(-1).schoolId, 1, "visitor ownership comes from the authenticated school");
  assert.equal(visitorCreates.at(-1).sessionId, 101);
  assert.equal(visitorAuditEntries.at(-1).actionBy, 7);
  assert.equal(visitorAuditEntries.at(-1).actionByRole, "support_staff");
  assert.equal((await request("/api/visitor-logs/31/checkout", {
    method: "PATCH",
    grants: ["visitor-log"],
    viewSessionId: 99,
  })).status, 403, "archived visitor sessions remain read-only");
  assert.equal((await request("/api/visitor-logs/999/checkout", {
    method: "PATCH",
    grants: ["visitor-log"],
  })).status, 403, "visitor IDs are limited to the authenticated school's records");
  assert.equal((await request("/api/visitor-logs/31/checkout", {
    method: "PATCH",
    grants: ["visitor-log"],
  })).status, 200);
  assert.equal(visitorAuditEntries.at(-1).actionBy, 7);
  assert.equal(visitorAuditEntries.at(-1).actionByRole, "support_staff");

  assert.equal((await request("/api/admin/assets")).status, 403);
  assert.equal((await request("/api/admin/assets", { grants: ["assets:view"] })).status, 403);
  assert.equal((await request("/api/admin/assets", { grants: ["assets"] })).status, 200);
  assert.equal(assetReads.at(-1), 1);
  const assetBody = {
    schoolId: 2,
    name: "Laptop",
    category: "Electronics",
    quantity: 1,
    condition: "Good",
    location: "Office",
  };
  assert.equal((await request("/api/admin/assets", {
    method: "POST",
    body: assetBody,
  })).status, 403);
  assert.equal((await request("/api/admin/assets", {
    method: "POST",
    grants: ["assets"],
    body: assetBody,
  })).status, 201);
  assert.equal(assetCreates.at(-1).schoolId, 1, "asset ownership comes from the authenticated school");
  assert.equal(assetAuditEntries.at(-1).actionType, "create");
  assert.equal(assetAuditEntries.at(-1).entityType, "asset");
  assert.equal(assetAuditEntries.at(-1).entityId, 5);
  assert.equal(assetAuditEntries.at(-1).schoolId, 1);
  assert.equal(assetAuditEntries.at(-1).actionBy, 7);
  assert.equal(assetAuditEntries.at(-1).actionByRole, "support_staff");
  const invalidActorEdit = await request("/api/admin/assets/4", {
    method: "PATCH",
    grants: ["assets"],
    staffId: -7,
    body: { quantity: 4 },
  });
  assert.equal(invalidActorEdit.status, 403);
  assert.equal(assetUpdates.length, 0, "invalid Staff actors cannot mutate assets");
  assert.equal(assetAuditEntries.at(-1).actionBy, 7);
  const staffAssetEdit = await request("/api/admin/assets/4", {
    method: "PATCH",
    grants: ["assets"],
    body: { quantity: 2 },
  });
  assert.equal(staffAssetEdit.status, 200);
  assert.deepEqual(assetUpdates.at(-1), [4, 1, { quantity: 2 }]);
  assert.equal(assetAuditEntries.at(-1).actionType, "update");
  assert.equal(assetAuditEntries.at(-1).entityId, 4);
  assert.equal(assetAuditEntries.at(-1).schoolId, 1);
  assert.equal(assetAuditEntries.at(-1).actionBy, 7);
  assert.equal(assetAuditEntries.at(-1).actionByRole, "support_staff");
  assert.equal((await request("/api/admin/assets/4", {
    method: "PATCH",
    body: { quantity: 2 },
  })).status, 403);
  assert.equal((await request("/api/admin/assets/4", {
    method: "DELETE",
    grants: ["assets"],
  })).status, 200);
  assert.deepEqual(assetDeletes.at(-1), [4, 1]);
  assert.equal(assetAuditEntries.at(-1).actionType, "delete");
  assert.equal(assetAuditEntries.at(-1).entityId, 4);
  assert.equal(assetAuditEntries.at(-1).schoolId, 1);
  assert.equal(assetAuditEntries.at(-1).actionBy, 7);
  assert.equal(assetAuditEntries.at(-1).actionByRole, "support_staff");
  assert.equal((await request("/api/admin/assets/4", {
    method: "DELETE",
  })).status, 403);
  assert.equal((await request("/api/admin/assets/8", {
    method: "PATCH",
    grants: ["assets"],
    body: { quantity: 3 },
  })).status, 404, "School A Support Staff cannot edit a School B asset");
  assert.equal((await request("/api/admin/assets/8", {
    method: "DELETE",
    grants: ["assets"],
  })).status, 404, "School A Support Staff cannot delete a School B asset");
  assert.deepEqual(assetUpdates.at(-1), [4, 1, { quantity: 2 }]);
  assert.deepEqual(assetDeletes.at(-1), [4, 1]);
  assert.equal(assetActivity.length, 0, "Support Staff IDs are never written into the Admin-user foreign key");
  assert.equal((await request("/api/admin/assets/4", {
    method: "PATCH",
    role: "admin",
    body: { quantity: 2 },
  })).status, 200, "Admin asset editing remains unchanged");
  assert.equal(assetActivity.at(-1).userId, 70);
  assert.equal((await request("/api/admin/assets/4", {
    method: "DELETE",
    role: "admin",
  })).status, 200, "Admin asset deletion remains unchanged");
  assert.equal(assetActivity.at(-1).userId, 70);

  const studentsPath = "/api/schools/1/students/paginated?page=1";
  assert.equal((await request(studentsPath)).status, 403);
  assert.equal((await request(studentsPath, { grants: ["id-card-gen:search"] })).status, 403);
  assert.equal((await request(studentsPath, { grants: ["id-card-gen"] })).status, 200);
  assert.equal((await request(studentsPath, { grants: ["student-registry:view"] })).status, 200);
  assert.equal((await request("/api/schools/2/students/paginated?page=1", {
    grants: ["id-card-gen"],
  })).status, 403);
  const archivedStudents = await request(studentsPath, {
    grants: ["id-card-gen"],
    viewSessionId: 99,
  });
  assert.equal(archivedStudents.status, 200);
  assert.equal(studentReads.at(-1)[1].sessionId, 99);

  assert.equal((await request("/api/schools/1/teachers")).status, 403);
  assert.equal((await request("/api/schools/1/teachers", { grants: ["id-card-gen:search"] })).status, 403);
  assert.equal((await request("/api/schools/1/teachers", { grants: ["id-card-gen"] })).status, 200);
  assert.deepEqual(teacherReads, [1]);
  assert.equal((await request("/api/schools/2/teachers", { grants: ["id-card-gen"] })).status, 403);

  assert.equal((await request("/api/admin/non-teaching-staff")).status, 403);
  assert.equal((await request("/api/admin/non-teaching-staff", {
    grants: ["id-card-gen:reissue"],
  })).status, 403);
  const cardStaff = await request("/api/admin/non-teaching-staff", {
    grants: ["id-card-gen"],
  });
  assert.equal(cardStaff.status, 200);
  assert.equal("passwordHash" in cardStaff.body[0], false);
  assert.equal("allowedModules" in cardStaff.body[0], false);
  const adminStaff = await request("/api/admin/non-teaching-staff", { role: "admin" });
  assert.equal(adminStaff.status, 200);
  assert.equal(adminStaff.body[0].passwordHash, "must-not-leak");
});
