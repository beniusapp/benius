import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { checkSessionContext } from "./routes/routes";
import { storage } from "./storage";

test("only exact authentication POST routes bypass archived-session write checks", async (t) => {
  const originalGetSession = storage.getAcademicSessionById;
  storage.getAcademicSessionById = async (id: number) => {
    if (id === 41) return { id: 41, schoolId: 11, isActive: false } as any;
    if (id === 88) return { id: 88, schoolId: 12, isActive: true } as any;
    return undefined;
  };
  t.after(() => {
    storage.getAcademicSessionById = originalGetSession;
  });

  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = { userId: 7, schoolId: 11 };
    next();
  });
  app.use(checkSessionContext);

  const authPaths = [
    "/api/login",
    "/api/teacher-login",
    "/api/student-login",
    "/api/admin/verify-pin",
  ];
  for (const path of authPaths) {
    app.post(path, (_req, res) => res.status(204).end());
  }
  app.post("/api/test-academic-write", (_req, res) => res.status(204).end());

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, viewSessionId: number) => fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "x-view-session-id": String(viewSessionId) },
  });

  for (const path of authPaths) {
    const response = await post(path, 41);
    assert.equal(response.status, 204, `${path} reaches its authentication handler`);
  }

  for (const viewSessionId of [41, 88, 999]) {
    const response = await post("/api/test-academic-write", viewSessionId);
    assert.equal(response.status, 403, `session ${viewSessionId} remains blocked for academic writes`);
    const body = await response.json() as { code?: string };
    assert.equal(body.code, "ARCHIVE_READ_ONLY");
  }

  for (const [method, path] of [
    ["PUT", "/api/login"],
    ["POST", "/api/login/"],
    ["POST", "/api/admin/verify-pin/"],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "x-view-session-id": "41" },
    });
    assert.equal(response.status, 403, `${method} ${path} is not exempt`);
  }
});
