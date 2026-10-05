import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { storage } from "./storage";
import { registerTeacherRoutes } from "./teacher-routes";

test("Faculty Information is restricted to the authenticated identity's school", async (t) => {
  const teacherLookups: number[] = [];
  const facultyReads: number[] = [];
  const facultyBySchool = new Map([
    [1, [{ id: 101, schoolId: 1, fullName: "Faculty A" }]],
    [2, [{ id: 202, schoolId: 2, fullName: "Faculty B" }]],
  ]);
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

  replaceStorage("getTeacherById", async (teacherId: number) => {
    teacherLookups.push(teacherId);
    return teacherId === 9 ? { id: 9, schoolId: 1, userId: 90 } : undefined;
  });
  replaceStorage("getFacultyBySchoolWithMappings", async (schoolId: number) => {
    facultyReads.push(schoolId);
    return facultyBySchool.get(schoolId) ?? [];
  });

  t.after(() => {
    const target = storage as any;
    for (const { name, hadOwn, original } of replacements.reverse()) {
      if (hadOwn) target[name] = original;
      else delete target[name];
    }
  });

  const app = express();
  app.use((req, _res, next) => {
    const role = req.get("x-test-role") ?? "teacher";
    (req as any).session = role === "anonymous"
      ? {}
      : role === "admin"
        ? { userId: 70, userRole: "admin", schoolId: 1 }
        : { teacherId: 9, userId: 90, userRole: "teacher", schoolId: 2 };
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
  async function request(path: string, role?: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: role ? { "x-test-role": role } : {},
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) as unknown : null,
    };
  }

  const sameSchool = await request("/api/faculty/1");
  assert.equal(sameSchool.status, 200);
  assert.deepEqual(sameSchool.body, facultyBySchool.get(1));
  assert.deepEqual(teacherLookups, [9]);
  assert.deepEqual(facultyReads, [1]);

  const foreignSchool = await request("/api/faculty/2");
  assert.equal(foreignSchool.status, 403);
  assert.deepEqual(foreignSchool.body, { message: "Not authorized" });
  assert.deepEqual(facultyReads, [1], "foreign faculty must not be queried");
  assert.equal(JSON.stringify(foreignSchool.body).includes("Faculty B"), false);

  const unauthenticated = await request("/api/faculty/1", "anonymous");
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(facultyReads, [1], "unauthenticated requests must not query faculty");

  const invalidSchool = await request("/api/faculty/1x");
  assert.equal(invalidSchool.status, 400);
  assert.deepEqual(facultyReads, [1], "invalid school IDs must not query faculty");

  const nonexistentSchool = await request("/api/faculty/999");
  assert.equal(nonexistentSchool.status, 403);
  assert.deepEqual(nonexistentSchool.body, { message: "Not authorized" });
  assert.deepEqual(facultyReads, [1], "nonexistent/foreign IDs must not query faculty");

  const sameSchoolAdmin = await request("/api/faculty/1", "admin");
  assert.equal(sameSchoolAdmin.status, 200, "same-school non-teacher access remains available");
  const foreignSchoolAdmin = await request("/api/faculty/2", "admin");
  assert.equal(foreignSchoolAdmin.status, 403);
  assert.deepEqual(facultyReads, [1, 1], "non-teacher sessions are also kept within their school");
});
