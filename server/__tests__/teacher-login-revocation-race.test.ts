import { afterAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { registerTeacherRoutes } from "../teacher-routes";
import { storage } from "../storage";
import { pool } from "../db";
import { userSessionRevocationSid } from "../session-revocation";

const userId = 987656001;
const teacherId = 987656002;
const schoolId = 987656003;
let server: Server | undefined;

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close(error => error ? reject(error) : resolve())
    );
  }
  vi.restoreAllMocks();
  await pool.query(`DELETE FROM "session" WHERE sid = $1`, [
    userSessionRevocationSid(userId),
  ]);
});

describe("Teacher login and password-reset revocation race", () => {
  it("does not issue a session when old-password verification overlaps revocation", async () => {
    let releaseTeacherLookup!: () => void;
    const teacherLookupPaused = new Promise<void>(resolve => {
      releaseTeacherLookup = resolve;
    });
    let teacherLookupStarted!: () => void;
    const teacherLookupReached = new Promise<void>(resolve => {
      teacherLookupStarted = resolve;
    });

    vi.spyOn(storage, "getUserByEmail").mockResolvedValue({
      id: userId,
      email: "race-teacher@example.test",
      passwordHash: "old-password-hash",
      role: "teacher",
      schoolId,
      isActive: true,
    } as any);
    vi.spyOn(storage, "getTeacherByUserId").mockImplementation(async () => {
      teacherLookupStarted();
      await teacherLookupPaused;
      return {
        id: teacherId,
        userId,
        schoolId,
        isActive: true,
        mustChangePassword: false,
      } as any;
    });
    vi.spyOn(bcrypt, "compare").mockResolvedValue(true);

    const app = express();
    app.use(express.json());
    app.use(session({
      secret: "teacher-login-revocation-race-secret",
      resave: false,
      saveUninitialized: false,
    }));
    registerTeacherRoutes(app);
    server = await new Promise<Server>(resolve => {
      const next = app.listen(0, "127.0.0.1", () => resolve(next));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const loginPromise = fetch(`${baseUrl}/api/teacher-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "race-teacher@example.test",
        password: "old-password",
      }),
    });
    await teacherLookupReached;
    await storage.invalidateUserSessionsStrict(userId);
    releaseTeacherLookup();

    const response = await loginPromise;
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Invalid Credentials" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(storage.getTeacherByUserId).toHaveBeenCalledWith(userId);
  });
});