import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { registerTeacherRoutes } from "../teacher-routes";
import {
  enforceSessionRevocation,
  userSessionRevocationSid,
} from "../session-revocation";
import { schools, teachers, users } from "@shared/schema";

type Account = {
  userId: number;
  teacherId: number;
  schoolId: number;
  email: string;
  password: string;
};

let server: Server;
let baseUrl = "";
let serial = 0;
const schoolIds: number[] = [];
const userIds: number[] = [];

async function createSchool(): Promise<number> {
  const suffix = `${Date.now().toString(36)}${serial++}`;
  const [school] = await db.insert(schools).values({
    name: `Teacher Password Session ${suffix}`,
    code: `TPS-${suffix}`.slice(0, 20),
  }).returning({ id: schools.id });
  schoolIds.push(school.id);
  return school.id;
}

async function createAccount(schoolId: number): Promise<Account> {
  const password = `old-password-${serial}`;
  const email = `teacher-password-session-${Date.now()}-${serial++}@example.test`;
  const [user] = await db.insert(users).values({
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role: "teacher",
    schoolId,
    isActive: true,
  }).returning({ id: users.id });
  userIds.push(user.id);
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId,
    fullName: `Password Session Teacher ${serial}`,
    phone: `6${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Security",
    assignedClass: "1",
    assignedSection: "A",
    isActive: true,
    mustChangePassword: false,
  }).returning({ id: teachers.id });
  return {
    userId: user.id,
    teacherId: teacher.id,
    schoolId,
    email,
    password,
  };
}

async function post(
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as any,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie,
    setCookie: response.headers.get("set-cookie"),
  };
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as any,
  };
}

async function login(account: Account, password = account.password) {
  return post("/api/teacher-login", {
    email: account.email,
    password,
  });
}

beforeAll(async () => {
  const PgStore = connectPgSimple(session);
  const app = express();
  app.use(express.json());
  app.use(session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: "teacher-password-change-session-integration-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true },
  }));
  app.use(enforceSessionRevocation);
  registerTeacherRoutes(app);
  app.get("/test/protected", (req, res) => {
    if (!req.session.userId || req.session.userRole !== "teacher") {
      return res.status(401).json({ message: "Not authenticated" });
    }
    return res.json({
      userId: req.session.userId,
      teacherId: req.session.teacherId,
      schoolId: req.session.schoolId,
    });
  });
  server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())
  );
  if (userIds.length > 0) {
    await pool.query(
      `DELETE FROM "session"
       WHERE sess->>'userId' = ANY($1::text[])
          OR sid = ANY($2::text[])`,
      [
        userIds.map(String),
        userIds.map(userSessionRevocationSid),
      ],
    );
  }
  if (schoolIds.length > 0) {
    await db.delete(teachers).where(inArray(teachers.schoolId, schoolIds));
    await db.delete(users).where(inArray(users.schoolId, schoolIds));
    await db.delete(schools).where(inArray(schools.id, schoolIds));
  }
});

describe("Teacher password-change session security", () => {
  it("invalidates every target session while preserving unrelated and other-school Teachers", async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const target = await createAccount(schoolA);
    const unrelatedSameSchool = await createAccount(schoolA);
    const unrelatedOtherSchool = await createAccount(schoolB);

    const targetSessionA = await login(target);
    const targetSessionB = await login(target);
    const sameSchoolSession = await login(unrelatedSameSchool);
    const otherSchoolSession = await login(unrelatedOtherSchool);
    expect([
      targetSessionA.status,
      targetSessionB.status,
      sameSchoolSession.status,
      otherSchoolSession.status,
    ]).toEqual([200, 200, 200, 200]);

    const changed = await post(
      "/api/teacher/change-password",
      {
        currentPassword: target.password,
        newPassword: "session-safe-new-password",
      },
      targetSessionA.cookie,
    );
    expect(changed.status).toBe(200);

    expect((await get("/test/protected", targetSessionA.cookie)).status).toBe(401);
    expect((await get("/test/protected", targetSessionB.cookie)).status).toBe(401);
    expect((await get("/test/protected", sameSchoolSession.cookie)).status).toBe(200);
    expect((await get("/test/protected", otherSchoolSession.cookie)).status).toBe(200);

    const marker = await pool.query(
      `SELECT sess->>'revokedAt' AS revoked_at
       FROM "session"
       WHERE sid = $1`,
      [userSessionRevocationSid(target.userId)],
    );
    expect(Number(marker.rows[0]?.revoked_at)).toBeGreaterThan(0);

    expect((await login(target, target.password)).status).toBe(401);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect((await login(target, "session-safe-new-password")).status).toBe(200);
  });

  it("keeps the authenticated session valid after a rejected password change", async () => {
    const schoolId = await createSchool();
    const account = await createAccount(schoolId);
    const authenticated = await login(account);
    expect(authenticated.status).toBe(200);

    const rejected = await post(
      "/api/teacher/change-password",
      {
        currentPassword: "wrong-current-password",
        newPassword: "must-not-be-installed",
      },
      authenticated.cookie,
    );
    expect(rejected.status).toBe(400);
    expect((await get("/test/protected", authenticated.cookie)).status).toBe(200);
    expect((await login(account, "must-not-be-installed")).status).toBe(401);
  });

  it("rejects an old-password login that overlaps successful password-change revocation", async () => {
    const schoolId = await createSchool();
    const account = await createAccount(schoolId);
    const changerSession = await login(account);
    expect(changerSession.status).toBe(200);

    const originalTeacherLookup = storage.getTeacherByUserId.bind(storage);
    let lookupReached!: () => void;
    const reachedLookup = new Promise<void>(resolve => {
      lookupReached = resolve;
    });
    let releaseLookup!: () => void;
    const lookupReleased = new Promise<void>(resolve => {
      releaseLookup = resolve;
    });
    let paused = false;
    vi.spyOn(storage, "getTeacherByUserId").mockImplementation(async userId => {
      if (userId === account.userId && !paused) {
        paused = true;
        lookupReached();
        await lookupReleased;
      }
      return originalTeacherLookup(userId);
    });

    const overlappingLogin = login(account);
    await reachedLookup;

    const changed = await post(
      "/api/teacher/change-password",
      {
        currentPassword: account.password,
        newPassword: "login-race-new-password",
      },
      changerSession.cookie,
    );
    expect(changed.status).toBe(200);

    releaseLookup();
    const rejectedLogin = await overlappingLogin;
    expect(rejectedLogin.status).toBe(401);
    expect(rejectedLogin.body).toEqual({ message: "Invalid Credentials" });
    expect(rejectedLogin.setCookie).toBeNull();
    vi.restoreAllMocks();

    await new Promise(resolve => setTimeout(resolve, 5));
    expect((await login(account, "login-race-new-password")).status).toBe(200);
  });
});