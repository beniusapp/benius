import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { registerTeacherRoutes } from "../teacher-routes";
import { storage } from "../storage";

type Harness = {
  server: Server;
  baseUrl: string;
  stop: () => Promise<void>;
};

const openHarnesses: Harness[] = [];
let serial = 0;

async function makeHarness(): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "teacher-password-change-route-test-secret",
    resave: false,
    saveUninitialized: false,
  }));
  registerTeacherRoutes(app);
  app.post("/test/authenticate", (req, res) => {
    req.session.userId = req.body.userId;
    req.session.teacherId = req.body.teacherId;
    req.session.schoolId = req.body.schoolId;
    req.session.userRole = "teacher";
    req.session.authIssuedAt = Date.now();
    res.json({ ok: true });
  });
  app.get("/test/session", (req, res) => {
    res.json({
      userId: req.session.userId,
      teacherId: req.session.teacherId,
      schoolId: req.session.schoolId,
      authIssuedAt: req.session.authIssuedAt,
    });
  });

  const server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  const harness = {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    ),
  };
  openHarnesses.push(harness);
  return harness;
}

async function request(
  harness: Harness,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  cookie?: string,
) {
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as any,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie,
  };
}

async function authenticatedHarness() {
  const harness = await makeHarness();
  const base = 991_000_000 + serial++ * 10;
  const identity = {
    userId: base + 1,
    teacherId: base + 2,
    schoolId: base + 3,
  };
  const authenticated = await request(
    harness,
    "/test/authenticate",
    "POST",
    identity,
  );
  return { harness, identity, cookie: authenticated.cookie! };
}

afterEach(async () => {
  await Promise.all(openHarnesses.splice(0).map(harness => harness.stop()));
  vi.restoreAllMocks();
});

describe("authenticated Teacher password-change route", () => {
  it("uses only server-side identity, revokes all sessions, and destroys the current session", async () => {
    const { harness, identity, cookie } = await authenticatedHarness();
    const change = vi.spyOn(storage, "changeTeacherPasswordAtomically")
      .mockResolvedValue(true);
    const invalidate = vi.spyOn(storage, "invalidateUserSessionsStrict")
      .mockResolvedValue();

    const result = await request(
      harness,
      "/api/teacher/change-password",
      "POST",
      {
        currentPassword: "current-password",
        newPassword: "new-password",
        userId: 1,
        teacherId: 2,
        schoolId: 3,
        tenantId: 4,
      },
      cookie,
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      message: "Password changed successfully. Please log in again.",
    });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0].slice(0, 4)).toEqual([
      identity.userId,
      identity.teacherId,
      identity.schoolId,
      "current-password",
    ]);
    expect(invalidate).toHaveBeenCalledWith(identity.userId);

    const sessionState = await request(harness, "/test/session", "GET", undefined, cookie);
    expect(sessionState.body).toEqual({});
  });

  it("does not invalidate the session when the current password is wrong or stale", async () => {
    const { harness, cookie } = await authenticatedHarness();
    vi.spyOn(storage, "changeTeacherPasswordAtomically").mockResolvedValue(false);
    const invalidate = vi.spyOn(storage, "invalidateUserSessionsStrict");

    const result = await request(
      harness,
      "/api/teacher/change-password",
      "POST",
      {
        currentPassword: "wrong-password",
        newPassword: "new-password",
      },
      cookie,
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ message: "Incorrect Current Password" });
    expect(invalidate).not.toHaveBeenCalled();
    const sessionState = await request(harness, "/test/session", "GET", undefined, cookie);
    expect(sessionState.body.userId).toBeTypeOf("number");
  });

  it("fails closed and destroys the current session when strict invalidation fails", async () => {
    const { harness, cookie } = await authenticatedHarness();
    vi.spyOn(storage, "changeTeacherPasswordAtomically").mockResolvedValue(true);
    vi.spyOn(storage, "invalidateUserSessionsStrict")
      .mockRejectedValue(new Error("session store unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await request(
      harness,
      "/api/teacher/change-password",
      "POST",
      {
        currentPassword: "current-password",
        newPassword: "new-password",
      },
      cookie,
    );

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      message: "Unable to complete password change securely. Please contact support.",
    });
    expect(errorLog).toHaveBeenCalledWith(
      "Teacher password change session invalidation failed",
    );
    const sessionState = await request(harness, "/test/session", "GET", undefined, cookie);
    expect(sessionState.body).toEqual({});
  });

  it("does not report success or invalidate sessions when the atomic mutation fails", async () => {
    const { harness, cookie } = await authenticatedHarness();
    vi.spyOn(storage, "changeTeacherPasswordAtomically")
      .mockRejectedValue(new Error("database unavailable"));
    const invalidate = vi.spyOn(storage, "invalidateUserSessionsStrict");

    const result = await request(
      harness,
      "/api/teacher/change-password",
      "POST",
      {
        currentPassword: "current-password",
        newPassword: "new-password",
      },
      cookie,
    );

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      message: "Unable to change password securely. Please try again.",
    });
    expect(invalidate).not.toHaveBeenCalled();
    const sessionState = await request(harness, "/test/session", "GET", undefined, cookie);
    expect(sessionState.body.userId).toBeTypeOf("number");
  });

  it("requires complete authenticated Teacher session identity", async () => {
    const harness = await makeHarness();
    const change = vi.spyOn(storage, "changeTeacherPasswordAtomically");
    const result = await request(
      harness,
      "/api/teacher/change-password",
      "POST",
      {
        currentPassword: "current-password",
        newPassword: "new-password",
      },
    );
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ message: "Not authenticated" });
    expect(change).not.toHaveBeenCalled();
  });
});