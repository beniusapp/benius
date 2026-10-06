import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { storage } from "./storage";
import { registerTeacherRoutes } from "./teacher-routes";

test("School Setup policy APIs deny Support Staff with legacy grants and preserve Admin access", async (t) => {
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
    leavePolicyReads: 0,
    activeLeavePolicyReads: 0,
    leavePolicyCreates: [] as any[],
    leavePolicyUpdates: [] as any[],
    leavePolicyDeletes: [] as number[],
    staffCreates: [] as any[],
    staffUpdates: [] as Array<{ id: number; schoolId: number; update: any }>,
  };

  replaceStorage("getLeavePoliciesBySchool", async () => {
    calls.leavePolicyReads++;
    return [{ id: 1, schoolId: 1, name: "Existing" }];
  });
  replaceStorage("getActiveLeavePoliciesBySchool", async () => {
    calls.activeLeavePolicyReads++;
    return [{ id: 1, schoolId: 1, name: "Active" }];
  });
  replaceStorage("createLeavePolicy", async (policy: any) => {
    calls.leavePolicyCreates.push(policy);
    return { id: 2, ...policy };
  });
  replaceStorage("getLeavePolicyById", async (id: number) => ({
    id,
    schoolId: 1,
    name: "Existing",
  }));
  replaceStorage("updateLeavePolicy", async (id: number, schoolId: number, update: any) => {
    calls.leavePolicyUpdates.push({ id, schoolId, update });
    return { id, schoolId, ...update };
  });
  replaceStorage("deleteLeavePolicy", async (id: number) => {
    calls.leavePolicyDeletes.push(id);
  });
  replaceStorage("createNonTeachingStaff", async (record: any) => {
    calls.staffCreates.push(record);
    return { id: 2, ...record };
  });
  replaceStorage("updateNonTeachingStaff", async (id: number, schoolId: number, update: any) => {
    calls.staffUpdates.push({ id, schoolId, update });
    return { id, schoolId, ...update };
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
    (req as any).session = role === "admin"
      ? { userId: 70, userRole: "admin", schoolId: 1 }
      : {
        userId: -7,
        staffId: 7,
        userRole: "support_staff",
        schoolId: 1,
        allowedModules: ["school-setup", "school-setup:leave-policy"],
      };
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
    options: { method?: string; body?: unknown; role?: "admin" | "support_staff" } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.role ? { "x-test-role": options.role } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  const staffRequests = [
    await request("/api/admin/leave-policies"),
    await request("/api/admin/leave-policies", {
      method: "POST",
      body: { name: "Support Leave", annualLimit: 12 },
    }),
    await request("/api/admin/leave-policies/1", {
      method: "PATCH",
      body: { name: "Changed" },
    }),
    await request("/api/admin/leave-policies/1", { method: "DELETE" }),
    await request("/api/admin/grading-tiers"),
    await request("/api/admin/grading-rules/1"),
    await request("/api/admin/exam-policy-tiers"),
  ];
  assert.deepEqual(
    staffRequests.map(response => response.status),
    [403, 403, 403, 403, 403, 403, 403],
    "legacy School Setup grants do not authorize policy APIs",
  );
  assert.equal(calls.leavePolicyReads, 0);
  assert.equal(calls.leavePolicyCreates.length, 0);
  assert.equal(calls.leavePolicyUpdates.length, 0);
  assert.equal(calls.leavePolicyDeletes.length, 0);

  const staffOperationalPolicyRead = await request("/api/leave/policies/1");
  assert.equal(staffOperationalPolicyRead.status, 200, "the separate operational leave-policy read remains available");
  assert.equal(calls.activeLeavePolicyReads, 1);

  assert.equal((await request("/api/admin/leave-policies", { role: "admin" })).status, 200);
  assert.equal((await request("/api/admin/leave-policies", {
    role: "admin",
    method: "POST",
    body: { name: "Admin Leave", annualLimit: 12 },
  })).status, 201);
  assert.equal((await request("/api/admin/leave-policies/1", {
    role: "admin",
    method: "PATCH",
    body: { name: "Updated" },
  })).status, 200);
  assert.equal((await request("/api/admin/leave-policies/1", {
    role: "admin",
    method: "DELETE",
  })).status, 200);

  const legacyGrants = [
    "school-setup",
    "school-setup:classes",
    "timetable",
    "timetable:schedule",
    "timetable:structure",
    "school-calendar",
    "school-calendar:events",
    "school-calendar:holidays",
    "attendance",
    "fees-manager",
  ];
  const createStaffResponse = await request("/api/admin/non-teaching-staff", {
    role: "admin",
    method: "POST",
    body: {
      fullName: "New Staff",
      email: "new-staff@example.com",
      designation: "Accountant",
      allowedModules: legacyGrants,
    },
  });
  assert.equal(createStaffResponse.status, 201);
  assert.deepEqual(calls.staffCreates[0].allowedModules, [
    "timetable",
    "school-calendar",
    "attendance",
    "fees-manager",
  ]);

  const updateStaffResponse = await request("/api/admin/non-teaching-staff/2", {
    role: "admin",
    method: "PATCH",
    body: { allowedModules: legacyGrants },
  });
  assert.equal(updateStaffResponse.status, 200);
  assert.deepEqual(calls.staffUpdates[0].update.allowedModules, [
    "timetable",
    "school-calendar",
    "attendance",
    "fees-manager",
  ]);
});
