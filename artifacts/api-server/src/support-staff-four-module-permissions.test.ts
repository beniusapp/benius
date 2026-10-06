import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { db } from "./db";
import { checkSessionContext } from "./routes/routes";
import { storage } from "./storage";
import { registerTeacherRoutes } from "./teacher-routes";

test("Support Staff parent grants gate the four module contexts and Admin operations", async (t) => {
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

  const metadataReads: number[] = [];
  const complaintReads: Array<[number, number | null | undefined]> = [];
  const complaintUpdates: Array<[number, number, string]> = [];
  const bulkComplaintDeletes: number[] = [];

  replace(storage, "getAllSchoolMetadata", async (schoolId: number) => {
    metadataReads.push(schoolId);
    return {
      classes: ["5"],
      sections: ["A"],
      subjects: ["Mathematics"],
      exam_types: ["Midterm"],
    };
  });
  replace(storage, "getActiveSession", async (schoolId: number) =>
    ({ id: 101, schoolId, isActive: true }),
  );
  replace(storage, "getAcademicSessionById", async (id: number) => ({
    id,
    schoolId: 1,
    isActive: id !== 99,
  }));
  replace(storage, "getLedgerStatus", async () => []);
  replace(storage, "getSchoolMetadata", async () => ["Midterm"]);
  replace(storage, "deletePromotionDecisionsByTerm", async () => 0);
  replace(storage, "getComplaintsBySchool", async (
    schoolId: number,
    sessionId: number | null | undefined,
  ) => {
    complaintReads.push([schoolId, sessionId]);
    return [{ id: 1, schoolId, sessionId, complaintType: "teacher-to-admin", status: "Pending" }];
  });
  replace(storage, "getComplaintByIdForSchool", async (id: number, schoolId: number) =>
    id === 1 && schoolId === 1
      ? { id, schoolId, sessionId: 101, complaintType: "teacher-to-admin", status: "Pending" }
      : null,
  );
  replace(storage, "updateComplaintStatus", async (
    id: number,
    schoolId: number,
    status: string,
  ) => {
    complaintUpdates.push([id, schoolId, status]);
    return { id, schoolId, sessionId: 101, status };
  });
  replace(storage, "getUserById", async () => ({ email: "principal@example.test" }));
  replace(storage, "bulkDeleteComplaints", async (schoolId: number) => {
    bulkComplaintDeletes.push(schoolId);
    return 1;
  });

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
      : { userId: -7, staffId: 7, userRole: "support_staff", schoolId, allowedModules };
    const selectedSession = req.get("x-view-session-id");
    if (selectedSession !== undefined) (req as any).viewSessionId = Number(selectedSession);
    next();
  });
  app.use(checkSessionContext);
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
    options: {
      method?: string;
      body?: unknown;
      role?: "admin" | "support_staff";
      grants?: string[];
      schoolId?: number;
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
        ...(options.viewSessionId === undefined
          ? {}
          : { "x-view-session-id": String(options.viewSessionId) }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  const moduleContexts = [
    {
      path: "/api/admin/attendance/context",
      moduleId: "attendance",
      expected: {
        classes: ["5"],
        sections: ["A"],
        subjects: ["Mathematics"],
        attendanceTarget: 85,
      },
    },
    {
      path: "/api/admin/exam-controller/context",
      moduleId: "exam-controller",
      expected: { classes: ["5"], sections: ["A"], exam_types: ["Midterm"] },
    },
    {
      path: "/api/admin/noticeboard/context",
      moduleId: "noticeboard",
      expected: { classes: ["5"], sections: ["A"] },
    },
  ];

  for (const { path, moduleId, expected } of moduleContexts) {
    const readsBeforeDenied = metadataReads.length;
    assert.equal((await request(path)).status, 403, `${moduleId} context requires the parent grant`);
    assert.equal(
      (await request(path, { grants: [`${moduleId}:legacy-child`] })).status,
      403,
      `${moduleId} legacy child grant must not authorize the context`,
    );
    assert.equal(metadataReads.length, readsBeforeDenied, "denied requests do not read school metadata");

    const granted = await request(path, { grants: [moduleId], schoolId: 2 });
    assert.equal(granted.status, 200);
    assert.deepEqual(granted.body, expected);
    assert.equal(metadataReads.at(-1), 2, "context is derived from the authenticated school");
  }

  assert.equal((await request("/api/admin/ledger-terms")).status, 403);
  assert.equal(
    (await request("/api/admin/ledger-terms", { grants: ["exam-controller:ledger"] })).status,
    403,
  );
  const terms = await request("/api/admin/ledger-terms", { grants: ["exam-controller"] });
  assert.equal(terms.status, 200);
  assert.deepEqual(terms.body, ["Midterm"]);
  assert.equal((await request("/api/admin/ledger-status?term=Midterm")).status, 403);
  assert.equal((await request("/api/admin/ledger-term/Midterm", { method: "DELETE" })).status, 403);
  assert.equal((await request("/api/admin/ledger-term/Midterm", {
    method: "DELETE",
    grants: ["exam-controller"],
  })).status, 200);
  assert.equal((await request("/api/admin/promote", {
    method: "POST",
    body: {},
  })).status, 403);
  assert.equal((await request("/api/admin/promote", {
    method: "POST",
    grants: ["exam-controller"],
    body: {},
  })).status, 400, "the parent grant reaches normal promotion validation");
  const archivedPromotion = await request("/api/admin/promote", {
    method: "POST",
    grants: ["exam-controller"],
    body: {},
    viewSessionId: 99,
  });
  assert.equal(archivedPromotion.status, 403);
  assert.equal(archivedPromotion.body.code, "ARCHIVE_READ_ONLY");

  assert.equal((await request("/api/complaints/school/1", {
    viewSessionId: 101,
  })).status, 403);
  assert.equal((await request("/api/complaints/school/1", {
    grants: ["complaint-hub:private"],
    viewSessionId: 101,
  })).status, 403);
  const complaints = await request("/api/complaints/school/1", {
    grants: ["complaint-hub"],
    viewSessionId: 101,
  });
  assert.equal(complaints.status, 200);
  assert.deepEqual(complaintReads.at(-1), [1, 101]);

  assert.equal((await request("/api/complaints/1/status", {
    method: "PATCH",
    body: { status: "Investigating" },
    viewSessionId: 101,
  })).status, 403);
  assert.equal((await request("/api/complaints/1/status", {
    method: "PATCH",
    grants: ["complaint-hub"],
    body: { status: "Investigating" },
    viewSessionId: 102,
  })).status, 404, "Support Staff cannot mutate a complaint from another selected session");
  const statusUpdate = await request("/api/complaints/1/status", {
    method: "PATCH",
    grants: ["complaint-hub"],
    body: { status: "Investigating" },
    viewSessionId: 101,
  });
  assert.equal(statusUpdate.status, 200);
  assert.deepEqual(complaintUpdates.at(-1), [1, 1, "Investigating"]);

  assert.equal((await request("/api/admin/complaints/bulk", {
    method: "DELETE",
    body: { olderThanDays: 30 },
  })).status, 403);
  const bulkDelete = await request("/api/admin/complaints/bulk", {
    method: "DELETE",
    grants: ["complaint-hub"],
    body: { olderThanDays: 30 },
  });
  assert.equal(bulkDelete.status, 200);
  assert.deepEqual(bulkComplaintDeletes, [1]);

  const adminContext = await request("/api/admin/exam-controller/context", {
    role: "admin",
  });
  assert.equal(adminContext.status, 200, "Principal/Admin context access remains unchanged");
});
