import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { db } from "./db";
import { registerRoutes } from "./routes/routes";
import { storage } from "./storage";

test("Support Staff parent grants gate enterprise modules and registry operations with school/session scope", async (t) => {
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
  const teacherRegistryReads: any[] = [];
  const teacherCreates: any[] = [];
  const teacherUpdates: any[] = [];
  const teacherDeactivations: any[] = [];
  const teacherReactivations: any[] = [];
  const teacherPhysicalDeletes: any[] = [];
  const teacherUserPhysicalDeletes: any[] = [];
  const removedTeacherHistoryEntries: any[] = [];
  const removedTeacherHistorySchoolReads: number[] = [];
  const facultyMappingReads: number[] = [];
  const facultyMappingWrites: any[] = [];
  const facultyMappingDeletes: any[] = [];
  const facultyMappingsBySchool: Record<number, any[]> = {};
  const studentUpdates: any[] = [];
  const studentDeactivations: any[] = [];
  const studentCreates: any[] = [];
  const studentImports: any[] = [];
  const studentEnrollments: any[] = [];
  const studentBulkDeactivations: any[] = [];
  const studentRecords: Record<number, any> = {
    31: {
      id: 31,
      schoolId: 1,
      name: "School A Student",
      digitalStudentId: "A-0031",
      isActive: true,
    },
    32: {
      id: 32,
      schoolId: 2,
      name: "School B Student",
      digitalStudentId: "B-0032",
      isActive: true,
    },
  };
  const staffPassword = "support-staff-registry-test";
  const staffPasswordHash = await bcrypt.hash(staffPassword, 4);
  const adminPassword = "principal-teacher-delete-test";
  const adminPasswordHash = await bcrypt.hash(adminPassword, 4);
  const teachersById: Record<number, any> = {
    11: {
      id: 11,
      schoolId: 1,
      fullName: "School A Teacher",
      subject: "Mathematics",
      assignedClass: "5",
      assignedSection: "A",
      phone: "1234567890",
      userId: 111,
      digitalTeacherId: "A-T011",
    },
    12: {
      id: 12,
      schoolId: 2,
      fullName: "School B Teacher",
      subject: "Science",
      assignedClass: "6",
      assignedSection: "B",
      phone: "1234567891",
      userId: 112,
      digitalTeacherId: "B-T012",
    },
  };
  let nextCreatedTeacherId = 13;

  replace(storage, "getActiveSession", async (schoolId: number) =>
    ({ id: 101, schoolId, isActive: true }),
  );
  replace(storage, "getAcademicSessionById", async (id: number) => ({
    id,
    schoolId: 1,
    isActive: id !== 99,
  }));
  replace(storage, "getAcademicSessionForSchool", async (id: number, schoolId: number) =>
    schoolId === 1 ? { id, schoolId, isActive: id !== 99 } : undefined,
  );
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
    return {
      data: [
        studentRecords[31],
        ...studentCreates.filter(student => student.schoolId === schoolId),
      ],
      total: 1 + studentCreates.filter(student => student.schoolId === schoolId).length,
    };
  });
  replace(storage, "getUserWithSchool", async (userId: number) => ({
    user: { id: userId, role: "admin" },
    school: { id: 1 },
  }));
  replace(storage, "getTeachersBySchool", async (schoolId: number) => {
    teacherReads.push(schoolId);
    return [{ id: 11, schoolId, fullName: "Teacher" }];
  });
  replace(storage, "getTeachersBySchoolPaginated", async (
    schoolId: number,
    query: string,
    page: number,
    pageSize: number,
  ) => {
    teacherRegistryReads.push([schoolId, query, page, pageSize]);
    const records = [
      teachersById[schoolId === 1 ? 11 : 12],
      ...teacherCreates.filter(teacher => teacher.schoolId === schoolId && teachersById[teacher.id]),
    ].filter(Boolean);
    return { data: records, total: records.length };
  });
  replace(storage, "getUserByEmail", async (_email: string) => null);
  replace(storage, "createTeacher", async (data: any, email: string, passwordHash: string) => {
    const id = nextCreatedTeacherId++;
    const created = { id, userId: 100 + id, ...data, email, passwordHash };
    teacherCreates.push(created);
    teachersById[created.id] = created;
    return created;
  });
  replace(storage, "getTeacherById", async (id: number) => teachersById[id] ?? null);
  replace(storage, "updateTeacherAssignment", async (id: number, schoolId: number, data: any) => {
    teacherUpdates.push([id, schoolId, data]);
    if (teachersById[id]?.schoolId !== schoolId) return null;
    teachersById[id] = { ...teachersById[id], ...data };
    return teachersById[id];
  });
  replace(storage, "deactivateTeacher", async (id: number, schoolId: number, reason: string) => {
    teacherDeactivations.push([id, schoolId, reason]);
    if (teachersById[id]?.schoolId !== schoolId) return null;
    teachersById[id] = { ...teachersById[id], isActive: false };
    return teachersById[id];
  });
  replace(storage, "reactivateTeacher", async (id: number, schoolId: number) => {
    teacherReactivations.push([id, schoolId]);
    if (teachersById[id]?.schoolId !== schoolId) return undefined;
    teachersById[id] = { ...teachersById[id], isActive: true };
    return teachersById[id];
  });
  replace(storage, "deleteTeacher", async (id: number, schoolId: number) => {
    const teacher = teachersById[id];
    if (!teacher || teacher.schoolId !== schoolId) return false;
    teacherPhysicalDeletes.push([id, schoolId]);
    teacherUserPhysicalDeletes.push(teacher.userId);
    delete teachersById[id];
    return true;
  });
  replace(storage, "logRemovedTeacher", async (entry: any) => {
    removedTeacherHistoryEntries.push(entry);
  });
  replace(storage, "getFacultyMappingsBySchool", async (schoolId: number) => {
    facultyMappingReads.push(schoolId);
    return facultyMappingsBySchool[schoolId] ?? [];
  });
  replace(storage, "replaceFacultyMappings", async (teacherId: number, schoolId: number, mappings: any[]) => {
    facultyMappingWrites.push([teacherId, schoolId, mappings]);
    facultyMappingsBySchool[schoolId] = mappings.map(mapping => ({ ...mapping, teacherId, schoolId }));
    return facultyMappingsBySchool[schoolId];
  });
  replace(storage, "deleteFacultyMappingsByTeacher", async (teacherId: number, schoolId: number) => {
    facultyMappingDeletes.push([teacherId, schoolId]);
    facultyMappingsBySchool[schoolId] = (facultyMappingsBySchool[schoolId] ?? [])
      .filter(mapping => mapping.teacherId !== teacherId);
  });
  replace(storage, "getNonTeachingStaffById", async (id: number) => ({
    id,
    schoolId: 1,
    email: "accountant@example.test",
    passwordHash: staffPasswordHash,
    isActive: true,
  }));
  replace(storage, "getStudentById", async (id: number) => studentRecords[id] ?? null);
  replace(storage, "deactivateStudent", async (id: number, schoolId: number) => {
    studentDeactivations.push([id, schoolId]);
    return studentRecords[id]?.schoolId === schoolId ? { ...studentRecords[id], isActive: false } : null;
  });
  replace(storage, "bulkDeactivateStudents", async (ids: number[], schoolId: number) => {
    studentBulkDeactivations.push([ids, schoolId]);
    return ids
      .map(id => studentRecords[id])
      .filter(student => student?.schoolId === schoolId)
      .map(student => ({ ...student, isActive: false }));
  });
  replace(storage, "updateStudent", async (id: number, schoolId: number, data: any) => {
    studentUpdates.push([id, schoolId, data]);
    if (studentRecords[id]?.schoolId !== schoolId) return null;
    studentRecords[id] = { ...studentRecords[id], ...data };
    return studentRecords[id];
  });
  replace(storage, "updateStudentWithActiveSessionEnrollment", async (id: number, schoolId: number, data: any) => {
    studentUpdates.push([id, schoolId, data]);
    if (studentRecords[id]?.schoolId !== schoolId) return null;
    studentRecords[id] = { ...studentRecords[id], ...data };
    return studentRecords[id];
  });
  replace(storage, "getSchool", async (schoolId: number) => ({ id: schoolId, code: schoolId === 1 ? "SCHA" : "SCHB" }));
  replace(storage, "issueNextIdSerial", async (_schoolId: number, _kind: string) => 41);
  replace(storage, "issueNextIdSerialRange", async (_schoolId: number, _kind: string, count: number) =>
    Array.from({ length: count }, (_unused, index) => 41 + index),
  );
  replace(storage, "getStudentRegistryImportContext", async () => ({
    sessionId: 101,
    placementMetadata: [
      { metaKey: "classes", metaValue: JSON.stringify(["5"]) },
      { metaKey: "sections", metaValue: JSON.stringify(["A"]) },
      { metaKey: "class_sections", metaValue: JSON.stringify({ "5": ["A"] }) },
    ],
  }));
  replace(storage, "findExistingStudentDsids", async () => new Set<string>());
  replace(storage, "createStudentWithActiveSessionEnrollment", async (data: any, sessionId: number) => {
    const created = { id: 41 + studentCreates.length, ...data };
    studentCreates.push(created);
    studentEnrollments.push({
      schoolId: data.schoolId,
      studentId: created.id,
      sessionId: sessionId ?? 101,
      className: data.class,
      sectionName: data.section,
      rollNo: data.rollNumber ?? null,
      status: "Active",
    });
    return created;
  });
  replace(storage, "bulkCreateStudentsWithActiveSessionEnrollment", async (
    schoolId: number,
    records: any[],
    sessionId: number,
  ) => {
    studentImports.push(records);
    const imported = records.map((student, index) => ({ id: 51 + index, ...student, schoolId }));
    studentCreates.push(...imported);
    studentEnrollments.push(...imported.map(student => ({
      schoolId,
      studentId: student.id,
      sessionId,
      className: student.class,
      sectionName: student.section,
      rollNo: student.rollNumber ?? null,
      status: "Active",
    })));
    return imported;
  });
  replace(storage, "createStudent", async (data: any) => {
    const created = { id: 41, ...data };
    studentCreates.push(created);
    return created;
  });
  replace(storage, "bulkCreateStudents", async (data: any[]) => {
    studentImports.push(data);
    const imported = data.map((student, index) => ({ id: 51 + index, ...student }));
    studentCreates.push(...imported);
    return imported;
  });
  replace(storage, "createEnrollment", async (data: any) => {
    studentEnrollments.push(data);
    return { id: 141, ...data };
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
  let captureTeacherSnapshotInDb = false;
  replace(dbTarget, "select", (selection: Record<string, unknown> = {}) => {
    const fields = Object.keys(selection);
    const rows: any[] = !captureTeacherSnapshotInDb
      ? []
      : fields.includes("email")
        ? [{ email: "school-a-teacher@example.test" }]
        : fields.includes("className")
          ? [
              { className: "5", section: "A", subject: "Mathematics" },
              { className: "6", section: "B", subject: "Science" },
            ]
          : [];
    const query: any = {
      from: () => query,
      where: () => query,
      orderBy: () => query,
      limit: () => query,
      offset: () => query,
      groupBy: () => query,
      leftJoin: () => query,
      innerJoin: () => query,
      then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return query;
  });

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
      formData?: FormData;
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
        ...(options.body === undefined || options.formData
          ? {}
          : { "content-type": "application/json" }),
        ...(options.role ? { "x-test-role": options.role } : {}),
        ...(options.grants ? { "x-test-grants": options.grants.join(",") } : {}),
        ...(options.schoolId ? { "x-test-school": String(options.schoolId) } : {}),
        ...(options.staffId === undefined ? {} : { "x-test-staff-id": String(options.staffId) }),
        ...(options.viewSessionId === undefined
          ? {}
          : { "x-view-session-id": String(options.viewSessionId) }),
      },
      ...(options.formData
        ? { body: options.formData }
        : options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    let body: any = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    return {
      status: response.status,
      body,
      contentType: response.headers.get("content-type"),
    };
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
  assert.equal((await request("/api/admin/analytics/performance?class=5", {
    grants: ["analytics"],
  })).status, 400, "session-dependent analytics requires an explicit selected session");
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
  assert.equal((await request(studentsPath, { grants: ["student-registry:view"] })).status, 403);
  assert.equal((await request(studentsPath, { grants: ["student-registry"] })).status, 200);
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

  assert.equal((await request("/api/admin/teachers")).status, 403);
  assert.equal((await request("/api/admin/teachers", {
    grants: ["teacher-registry:view"],
  })).status, 403);
  const teacherList = await request("/api/admin/teachers", { grants: ["teacher-registry"] });
  assert.equal(teacherList.status, 200);
  assert.equal(teacherList.body.data[0].id, 11);
  assert.equal(teacherRegistryReads.at(-1)[0], 1);
  assert.equal((await request("/api/schools/2/teachers/paginated", {
    grants: ["teacher-registry"],
  })).status, 403, "School A Staff cannot read School B teachers by changing the URL");

  const teacherCreateBody = {
    fullName: "New Registry Teacher",
    email: "new.teacher@example.test",
    password: "teacher-password-123",
    phone: "1234567890",
    subject: "Mathematics",
    assignedClass: "5",
    assignedSection: "A",
  };
  assert.equal((await request("/api/admin/teachers", {
    method: "POST",
    grants: ["teacher-registry", "teacher-registry:delete"],
    body: teacherCreateBody,
  })).status, 403, "Delete Teacher does not grant Add Teacher");
  assert.equal((await request("/api/admin/teachers", {
    method: "POST",
    grants: ["teacher-registry:add"],
    body: teacherCreateBody,
  })).status, 403);
  const createdTeacher = await request("/api/admin/teachers", {
    method: "POST",
    grants: ["teacher-registry"],
    body: teacherCreateBody,
  });
  assert.equal(createdTeacher.status, 403, "the Teacher Registry parent is read-only without Add Teacher");
  const addedTeacher = await request("/api/admin/teachers", {
    method: "POST",
    grants: ["teacher-registry", "teacher-registry:add"],
    body: teacherCreateBody,
  });
  assert.equal(addedTeacher.status, 201);
  assert.equal(teacherCreates.at(-1).schoolId, 1);

  const teacherEditBody = { fullName: "Updated School A Teacher" };
  assert.equal((await request("/api/admin/teachers/12", {
    method: "PATCH",
    grants: ["teacher-registry", "teacher-registry:edit"],
    body: teacherEditBody,
  })).status, 404, "School A Staff cannot edit a School B teacher");
  assert.equal(teacherUpdates.length, 0);
  assert.equal((await request("/api/admin/teachers/11", {
    method: "PATCH",
    grants: ["teacher-registry"],
    body: teacherEditBody,
  })).status, 403, "the Teacher Registry parent is read-only without Edit Teacher");
  assert.equal((await request("/api/admin/teachers/11", {
    method: "PATCH",
    grants: ["teacher-registry", "teacher-registry:edit"],
    body: teacherEditBody,
  })).status, 200);
  assert.equal(teacherUpdates.at(-1)[1], 1);
  assert.equal((await request("/api/admin/teachers/11", {
    method: "PATCH",
    grants: ["teacher-registry", "teacher-registry:delete"],
    body: teacherEditBody,
  })).status, 403, "Delete Teacher does not grant Edit Teacher");
  assert.equal((await request("/api/admin/teachers/11", {
    method: "PATCH",
    grants: ["teacher-registry", "teacher-registry:add", "teacher-registry:edit"],
    body: teacherEditBody,
  })).status, 200, "Add plus Edit grants continue to allow Edit");
  assert.equal(teacherUpdates.at(-1)[1], 1);
  const allTeacherActions = [
    "teacher-registry",
    "teacher-registry:add",
    "teacher-registry:edit",
    "teacher-registry:delete",
  ];
  const allActionsTeacher = await request("/api/admin/teachers", {
    method: "POST",
    grants: allTeacherActions,
    body: teacherCreateBody,
  });
  assert.equal(allActionsTeacher.status, 201, "all three actions include Add");
  assert.equal(allActionsTeacher.body.id, 14);
  assert.equal((await request("/api/admin/teachers/14", {
    method: "PATCH",
    grants: allTeacherActions,
    body: teacherEditBody,
  })).status, 200, "all three actions include Edit");
  assert.equal((await request("/api/admin/teachers/11", {
    method: "DELETE",
    grants: ["teacher-registry"],
    body: { reason: "No longer employed", adminPassword: staffPassword },
  })).status, 403, "the Teacher Registry parent is read-only without Delete Teacher");
  assert.equal((await request("/api/admin/teachers/11", {
    method: "DELETE",
    grants: ["teacher-registry:delete"],
    body: { reason: "No longer employed", adminPassword: staffPassword },
  })).status, 403, "Delete Teacher without its parent module grant is rejected");
  assert.equal((await request("/api/admin/teachers/11", {
    method: "DELETE",
    grants: ["teacher-registry", "teacher-registry:add"],
    body: { reason: "No longer employed", adminPassword: staffPassword },
  })).status, 403, "Add Teacher does not grant Delete Teacher");
  assert.equal((await request("/api/admin/teachers/11", {
    method: "DELETE",
    grants: ["teacher-registry", "teacher-registry:edit"],
    body: { reason: "No longer employed", adminPassword: staffPassword },
  })).status, 403, "Edit Teacher does not grant Delete Teacher");
  assert.equal((await request("/api/admin/teachers/11", {
    method: "DELETE",
    grants: ["teacher-registry", "teacher-registry:add", "teacher-registry:edit"],
    body: { reason: "No longer employed", adminPassword: staffPassword },
  })).status, 403, "Add plus Edit grants do not grant Delete Teacher");
  assert.equal((await request("/api/admin/teachers/11", {
    method: "DELETE",
    grants: ["teacher-registry", "teacher-registry:delete"],
    body: {},
  })).status, 400, "Delete Teacher reaches request validation when explicitly granted");
  assert.equal((await request("/api/admin/teachers/12", {
    method: "DELETE",
    grants: ["teacher-registry", "teacher-registry:delete"],
    body: { reason: "No longer employed", adminPassword: staffPassword },
  })).status, 404, "School A Staff cannot delete a School B teacher");
  assert.equal(teacherPhysicalDeletes.length, 0);
  assert.equal(removedTeacherHistoryEntries.length, 0);

  const passwordBody = { reason: "No longer employed", password: staffPassword };
  assert.equal((await request("/api/schools/2/teachers/12/deactivate", {
    method: "POST",
    grants: ["teacher-registry", "teacher-registry:delete"],
    body: passwordBody,
  })).status, 403, "A manipulated schoolId cannot reach another school's teacher");
  assert.equal((await request("/api/schools/1/teachers/12/deactivate", {
    method: "POST",
    grants: ["teacher-registry", "teacher-registry:delete"],
    body: passwordBody,
  })).status, 404, "School A Staff cannot deactivate a School B teacher");
  assert.equal(teacherDeactivations.length, 0);
  assert.equal((await request("/api/schools/1/teachers/11/deactivate", {
    method: "POST",
    grants: ["teacher-registry"],
    body: passwordBody,
  })).status, 403, "the Teacher Registry parent is read-only without Delete Teacher");
  assert.equal((await request("/api/schools/1/teachers/11/deactivate", {
    method: "POST",
    grants: ["teacher-registry", "teacher-registry:delete"],
    body: passwordBody,
  })).status, 200);
  assert.deepEqual(teacherDeactivations.at(-1), [11, 1, "No longer employed"]);
  assert.equal(visitorAuditEntries.at(-1).entityType, "teacher");
  assert.equal(visitorAuditEntries.at(-1).actionBy, 7);
  assert.equal(visitorAuditEntries.at(-1).actionByRole, "support_staff");
  assert.equal((await request("/api/admin/teachers/11/reactivate", {
    method: "POST",
    grants: ["teacher-registry"],
    body: { adminPassword: staffPassword },
  })).status, 403, "reactivation also requires Delete Teacher");
  assert.equal((await request("/api/admin/teachers/11/reactivate", {
    method: "POST",
    grants: ["teacher-registry", "teacher-registry:delete"],
    body: { adminPassword: staffPassword },
  })).status, 200);
  assert.equal(teachersById[11].isActive, true);
  assert.deepEqual(teacherReactivations.at(-1), [11, 1]);
  assert.deepEqual(
    [visitorAuditEntries.at(-1).actionBy, visitorAuditEntries.at(-1).actionByRole],
    [7, "support_staff"],
    "Teacher reactivation audit uses the positive Staff ID and Support Staff role",
  );

  assert.equal((await request("/api/admin/faculty-mappings")).status, 403);
  assert.equal((await request("/api/admin/faculty-mappings", {
    grants: ["faculty-mapping:assign"],
  })).status, 403);
  const mappings = await request("/api/admin/faculty-mappings?schoolId=2", {
    grants: ["faculty-mapping"],
  });
  assert.equal(mappings.status, 200);
  assert.equal(facultyMappingReads.at(-1), 1, "Mapping reads use the authenticated school, not a query parameter");
  const mappingBody = {
    teacherId: 11,
    mappings: [{ className: "5", section: "A", subject: "Mathematics" }],
  };
  assert.equal((await request("/api/admin/faculty-mappings", {
    method: "POST",
    grants: ["faculty-mapping:assign"],
    body: mappingBody,
  })).status, 403);
  assert.equal((await request("/api/admin/faculty-mappings", {
    method: "POST",
    grants: ["faculty-mapping"],
    body: { ...mappingBody, teacherId: 12 },
  })).status, 404, "School A Staff cannot change a School B teacher's mapping");
  assert.equal(facultyMappingWrites.length, 0);
  assert.equal((await request("/api/admin/faculty-mappings", {
    method: "POST",
    grants: ["faculty-mapping"],
    body: mappingBody,
  })).status, 200);
  assert.equal(facultyMappingWrites.at(-1)[1], 1);
  const principalMappings = await request("/api/admin/faculty-mappings", { role: "admin" });
  assert.equal(principalMappings.status, 200);
  assert.equal(principalMappings.body[0].teacherId, 11);
  assert.equal(principalMappings.body[0].schoolId, 1);
  assert.equal((await request("/api/admin/faculty-mappings/12", {
    method: "DELETE",
    grants: ["faculty-mapping"],
  })).status, 404);
  assert.equal(facultyMappingDeletes.length, 0);
  assert.equal((await request("/api/admin/faculty-mappings/11", {
    method: "DELETE",
    grants: ["faculty-mapping"],
  })).status, 200);
  assert.deepEqual(facultyMappingDeletes.at(-1), [11, 1]);
  assert.equal((await request("/api/schools/1/teachers", {
    grants: ["faculty-mapping"],
  })).status, 200);
  assert.equal((await request("/api/schools/2/teachers", {
    grants: ["faculty-mapping"],
  })).status, 403);

  const studentCreateBody = {
    email: "registry.student@example.test",
    name: "Registry Student",
    class: "5",
    section: "A",
    phone: "9876543210",
    dob: "2000-01-01",
  };
  assert.equal((await request("/api/schools/1/students", {
    method: "POST",
    grants: ["student-registry:add"],
    body: studentCreateBody,
  })).status, 403);
  const createdStudent = await request("/api/schools/1/students", {
    method: "POST",
    grants: ["student-registry"],
    body: studentCreateBody,
  });
  assert.equal(createdStudent.status, 403, "the Student Registry parent is read-only without Add Student");
  const addedStudent = await request("/api/schools/1/students", {
    method: "POST",
    grants: ["student-registry", "student-registry:add"],
    body: studentCreateBody,
  });
  assert.equal(addedStudent.status, 201);
  assert.equal(studentCreates.at(-1).schoolId, 1);
  assert.equal(studentEnrollments.at(-1).schoolId, 1);
  assert.equal(studentEnrollments.at(-1).sessionId, 101);
  assert.equal((await request("/api/schools/2/students", {
    method: "POST",
    grants: ["student-registry", "student-registry:add"],
    body: studentCreateBody,
  })).status, 403, "School A Staff cannot register a student against School B");
  const childImport = new FormData();
  childImport.append(
    "file",
    new Blob(["name,class,section,phone,dob,email\nImported Student,5,A,9876543211,2008-04-02,imported.student@example.test\n"], {
      type: "text/csv",
    }),
    "students.csv",
  );
  assert.equal((await request("/api/schools/1/students/upload", {
    method: "POST",
    grants: ["student-registry:add"],
    formData: childImport,
  })).status, 403);
  const parentOnlyImport = new FormData();
  parentOnlyImport.append(
    "file",
    new Blob(["name,class,section,phone,dob,email\nParent Only,5,A,9876543212,2008-04-02,parent.only@example.test\n"], {
      type: "text/csv",
    }),
    "students.csv",
  );
  assert.equal((await request("/api/schools/1/students/upload", {
    method: "POST",
    grants: ["student-registry"],
    formData: parentOnlyImport,
  })).status, 403, "CSV import follows Add Student, not parent read access");
  const validImport = new FormData();
  validImport.append(
    "file",
    new Blob([
      "name,class,section,phone,dob,email,roll number\n" +
      "Imported Student,5,A,9876543211,2008-04-02,imported.student@example.test,1\n" +
      "Second Imported Student,5,A,9876543213,2008-04-03,second.imported@example.test,2\n",
    ], {
      type: "text/csv",
    }),
    "students.csv",
  );
  const importedStudents = await request("/api/schools/1/students/upload", {
    method: "POST",
    grants: ["student-registry", "student-registry:add"],
    formData: validImport,
  });
  assert.ok(importedStudents.status >= 200 && importedStudents.status < 300);
  assert.equal(importedStudents.body.imported, 2);
  assert.equal(importedStudents.body.failed, 0);
  assert.equal(studentImports.at(-1).length, 2);
  assert.equal(studentImports.at(-1)[0].schoolId, 1);
  assert.equal(studentEnrollments.at(-1).sessionId, 101);
  assert.equal(studentEnrollments.at(-1).status, "Active");

  const studentList = await request(studentsPath, { grants: ["student-registry"] });
  assert.equal(studentList.status, 200);
  assert.equal(studentList.body.data[0].id, 31);
  assert.ok(studentList.body.data.some((student: any) => student.id === 41));
  const principalStudentList = await request(studentsPath, { role: "admin" });
  assert.equal(principalStudentList.status, 200);
  assert.equal(principalStudentList.body.data[0].id, 31, "Principal sees the same school-wide student record");
  assert.ok(principalStudentList.body.data.some((student: any) => student.id === 41), "Principal sees Staff-created students");
  assert.equal((await request("/api/schools/2/students/paginated?page=1", {
    grants: ["student-registry"],
  })).status, 403, "School A Staff cannot read School B students by changing the URL");
  assert.equal((await request("/api/schools/1/students/auto-assign-roll", {
    method: "POST",
    grants: ["student-registry"],
    body: {},
  })).status, 403, "roll-number updates require Edit Student");
  assert.equal((await request("/api/schools/1/students/auto-assign-roll", {
    method: "POST",
    grants: ["student-registry", "student-registry:edit"],
    body: {},
  })).status, 400, "Edit Student reaches the roll-assignment request validation");

  const studentEditBody = {
    name: "Updated Student",
    class: "5",
    section: "A",
    phone: "9876543210",
    dob: "2008-04-01",
    email: "updated.student@example.test",
  };
  assert.equal((await request("/api/admin/students/32", {
    method: "PATCH",
    grants: ["student-registry", "student-registry:edit"],
    body: studentEditBody,
  })).status, 404, "School A Staff cannot edit a School B student");
  assert.deepEqual(studentUpdates.at(-1).slice(0, 2), [32, 1]);
  assert.equal((await request("/api/admin/students/31", {
    method: "PATCH",
    grants: ["student-registry"],
    body: studentEditBody,
  })).status, 403, "the Student Registry parent is read-only without Edit Student");
  assert.equal((await request("/api/admin/students/31", {
    method: "PATCH",
    grants: ["student-registry", "student-registry:edit"],
    body: studentEditBody,
  })).status, 200);
  const principalUpdatedStudents = await request(studentsPath, { role: "admin" });
  assert.equal(
    principalUpdatedStudents.body.data.find((student: any) => student.id === 31).name,
    "Updated Student",
  );

  assert.equal((await request("/api/schools/1/students/32/deactivate", {
    method: "POST",
    grants: ["student-registry", "student-registry:delete"],
    body: { reason: "Transferred", password: staffPassword },
  })).status, 404, "School A Staff cannot deactivate a School B student");
  assert.equal(studentDeactivations.length, 0);
  assert.equal((await request("/api/schools/1/students/31/deactivate", {
    method: "POST",
    grants: ["student-registry"],
    body: { reason: "Transferred", password: staffPassword },
  })).status, 403, "the Student Registry parent is read-only without Delete Student");
  assert.equal((await request("/api/schools/1/students/31/deactivate", {
    method: "POST",
    grants: ["student-registry", "student-registry:delete"],
    body: { reason: "Transferred", password: staffPassword },
  })).status, 200);
  assert.deepEqual(studentDeactivations.at(-1), [31, 1]);
  assert.equal(visitorAuditEntries.at(-1).actionBy, 7);
  assert.equal(visitorAuditEntries.at(-1).actionByRole, "support_staff");

  assert.equal((await request("/api/schools/1/students/bulk-deactivate", {
    method: "POST",
    grants: ["student-registry"],
    body: {
      ids: [31, 32],
      reason: "Graduated",
      batchYear: "2025",
      password: staffPassword,
    },
  })).status, 403, "bulk deactivation requires Delete Student");
  assert.equal((await request("/api/schools/1/students/bulk-deactivate", {
    method: "POST",
    grants: ["student-registry", "student-registry:delete"],
    body: {
      ids: [31, 32],
      reason: "Graduated",
      batchYear: "2025",
      password: staffPassword,
    },
  })).status, 200);
  assert.deepEqual(studentBulkDeactivations.at(-1), [[31, 32], 1]);
  assert.equal(visitorAuditEntries.at(-1).entityId, 31);
  assert.equal(visitorAuditEntries.at(-1).actionBy, 7);
  assert.equal(visitorAuditEntries.at(-1).actionByRole, "support_staff");

  assert.equal((await request("/api/schools/1/students/export", {
    grants: ["student-registry:export"],
  })).status, 403);
  const studentExport = await request("/api/schools/1/students/export", {
    grants: ["student-registry"],
  });
  assert.equal(studentExport.status, 200);
  assert.match(studentExport.contentType ?? "", /spreadsheetml/);
  assert.equal((await request("/api/schools/2/students/export", {
    grants: ["student-registry"],
  })).status, 403);

  assert.equal((await request("/api/admin/verify-password", {
    method: "POST",
    grants: ["student-registry:deactivate"],
    body: { password: staffPassword, moduleId: "student-registry" },
  })).status, 403);
  assert.equal((await request("/api/admin/verify-password", {
    method: "POST",
    grants: ["student-registry"],
    body: { password: staffPassword, moduleId: "student-registry" },
  })).status, 403, "password pre-check also requires Delete Student");
  const passwordCheck = await request("/api/admin/verify-password", {
    method: "POST",
    grants: ["student-registry", "student-registry:delete"],
    body: { password: staffPassword, moduleId: "student-registry" },
  });
  assert.equal(passwordCheck.status, 200);
  assert.equal(passwordCheck.body.valid, true);

  const principalTeachers = await request("/api/admin/teachers", { role: "admin" });
  assert.equal(principalTeachers.status, 200);
  assert.ok(principalTeachers.body.data.some((teacher: any) => teacher.id === 13), "Principal sees Staff-created teachers");
  assert.equal(
    principalTeachers.body.data.find((teacher: any) => teacher.id === 11).fullName,
    "Updated School A Teacher",
  );
  assert.equal((await request("/api/admin/faculty-mappings", { role: "admin" })).status, 200);
  assert.equal((await request("/api/admin/school-config")).status, 403);
  assert.equal((await request("/api/admin/school-config", {
    grants: ["school-setup"],
  })).status, 403, "School Setup grants do not expose its configuration through registry APIs");
  assert.equal((await request("/api/admin/school-config", {
    grants: ["teacher-registry"],
  })).status, 200);
  assert.equal((await request("/api/admin/school-config", {
    grants: ["faculty-mapping"],
  })).status, 200);
  assert.equal((await request("/api/admin/school-config", { role: "admin" })).status, 200);

  replace(storage, "getRemovedTeachersLog", async (schoolId: number) => {
    removedTeacherHistorySchoolReads.push(schoolId);
    const entries = removedTeacherHistoryEntries.filter(entry => entry.schoolId === schoolId);
    return { data: entries, total: entries.length, page: 1, limit: 20 };
  });

  const parentOnlyHistoryRead = await request(
    "/api/admin/teachers/removed-history?schoolId=2",
    { grants: ["teacher-registry"], schoolId: 1 },
  );
  assert.equal(parentOnlyHistoryRead.status, 200, "Teacher Registry parent permission alone allows read-only Removed History");
  assert.equal(removedTeacherHistorySchoolReads.at(-1), 1, "history is scoped to the authenticated school, not the query string");
  assert.equal((await request("/api/admin/teachers/removed-history", {
    grants: [],
    schoolId: 1,
  })).status, 403, "Removed History API rejects Support Staff without the parent permission");
  assert.equal((await request("/api/admin/teachers/removed-history", {
    grants: ["teacher-registry:delete"],
    schoolId: 1,
  })).status, 403, "a legacy child permission alone does not authorize Removed History");

  captureTeacherSnapshotInDb = true;
  const supportStaffDelete = await request("/api/admin/teachers/11", {
    method: "DELETE",
    grants: ["teacher-registry", "teacher-registry:delete"],
    body: { reason: "No longer employed", adminPassword: staffPassword },
  });
  captureTeacherSnapshotInDb = false;
  assert.equal(supportStaffDelete.status, 200);
  assert.equal(teachersById[11], undefined, "Support Staff Delete physically removes the Teacher row");
  assert.deepEqual(teacherPhysicalDeletes, [[11, 1]]);
  assert.deepEqual(teacherUserPhysicalDeletes, [111], "the existing delete path removes the linked User/Login row");
  const supportStaffSnapshot = removedTeacherHistoryEntries.at(-1);
  assert.ok(supportStaffSnapshot, "successful Teacher Delete creates a Removed History snapshot");
  assert.deepEqual(
    {
      schoolId: supportStaffSnapshot.schoolId,
      digitalTeacherId: supportStaffSnapshot.digitalTeacherId,
      fullName: supportStaffSnapshot.fullName,
      email: supportStaffSnapshot.email,
      phone: supportStaffSnapshot.phone,
      subject: supportStaffSnapshot.subject,
      assignedClass: supportStaffSnapshot.assignedClass,
      assignedSection: supportStaffSnapshot.assignedSection,
      removalReason: supportStaffSnapshot.removalReason,
      removedByEmail: supportStaffSnapshot.removedByEmail,
    },
    {
      schoolId: 1,
      digitalTeacherId: "A-T011",
      fullName: "Updated School A Teacher",
      email: "school-a-teacher@example.test",
      phone: "1234567890",
      subject: "Mathematics, Science",
      assignedClass: "5-A, 6-B",
      assignedSection: null,
      removalReason: "No longer employed",
      removedByEmail: "accountant@example.test",
    },
    "Removed History preserves the previous profile and Faculty Mapping snapshot",
  );
  assert.deepEqual(
    [visitorAuditEntries.at(-1).actionType, visitorAuditEntries.at(-1).actionBy, visitorAuditEntries.at(-1).actionByRole],
    ["delete", 7, "support_staff"],
    "Support Staff attribution uses the positive Staff ID and role-aware audit log",
  );
  const staffTeacherListAfterDelete = await request("/api/admin/teachers", {
    grants: ["teacher-registry"],
  });
  assert.equal(staffTeacherListAfterDelete.status, 200);
  assert.equal(
    staffTeacherListAfterDelete.body.data.some((teacher: any) => teacher.id === 11),
    false,
    "a hard-deleted Teacher no longer appears in the normal Registry",
  );
  removedTeacherHistoryEntries.push({
    schoolId: 2,
    digitalTeacherId: "B-T999",
    fullName: "School B Private Teacher",
  });
  const sameSchoolHistory = await request(
    "/api/admin/teachers/removed-history?schoolId=2",
    { grants: ["teacher-registry"], schoolId: 1 },
  );
  assert.equal(sameSchoolHistory.status, 200);
  assert.deepEqual(
    sameSchoolHistory.body.data.map((entry: any) => entry.digitalTeacherId),
    ["A-T011"],
    "Support Staff sees only same-school Removed History even if a different school ID is supplied",
  );
  assert.equal(removedTeacherHistorySchoolReads.at(-1), 1);
  const principalHistory = await request("/api/admin/teachers/removed-history", { role: "admin" });
  assert.equal(principalHistory.status, 200);
  assert.equal(
    principalHistory.body.data.some((entry: any) => entry.digitalTeacherId === "A-T011"),
    true,
    "Principal/Admin can see the Support Staff removal snapshot",
  );

  replace(storage, "getUserById", async (id: number) => id === 70
    ? {
        id: 70,
        role: "admin",
        email: "principal@example.test",
        passwordHash: adminPasswordHash,
      }
    : undefined);
  captureTeacherSnapshotInDb = true;
  const principalDelete = await request("/api/admin/teachers/13", {
    method: "DELETE",
    role: "admin",
    body: { reason: "Position ended", adminPassword },
  });
  captureTeacherSnapshotInDb = false;
  assert.equal(principalDelete.status, 200);
  assert.equal(teachersById[13], undefined, "Principal/Admin Delete physically removes the Teacher row");
  assert.deepEqual(teacherPhysicalDeletes, [[11, 1], [13, 1]]);
  assert.deepEqual(teacherUserPhysicalDeletes, [111, 113]);
  const principalSnapshot = removedTeacherHistoryEntries.at(-1);
  assert.ok(principalSnapshot, "Principal/Admin Delete creates a Removed History snapshot");
  assert.equal(principalSnapshot.removedByEmail, "principal@example.test");
  assert.deepEqual(
    [visitorAuditEntries.at(-1).actionBy, visitorAuditEntries.at(-1).actionByRole],
    [70, "admin"],
    "Principal/Admin attribution uses the real Admin user ID and role",
  );

  captureTeacherSnapshotInDb = true;
  const allActionsDelete = await request("/api/admin/teachers/14", {
    method: "DELETE",
    grants: allTeacherActions,
    body: { reason: "Duplicate record", adminPassword: staffPassword },
  });
  captureTeacherSnapshotInDb = false;
  assert.equal(allActionsDelete.status, 200, "all three actions include Delete");
  assert.equal(teachersById[14], undefined);
  assert.deepEqual(teacherPhysicalDeletes, [[11, 1], [13, 1], [14, 1]]);
  assert.deepEqual(teacherUserPhysicalDeletes, [111, 113, 114]);
  assert.deepEqual(
    [visitorAuditEntries.at(-1).actionBy, visitorAuditEntries.at(-1).actionByRole],
    [7, "support_staff"],
  );
});
