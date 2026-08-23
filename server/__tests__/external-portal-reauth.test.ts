import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import express from "express";
import session from "express-session";
import http from "http";
import { eq, sql } from "drizzle-orm";
import { registerFeesRoutes } from "../fees-routes";
import { checkSessionContext } from "../routes";
import { db } from "../db";
import {
  academicSessions, dunningJobStatus, externalPaymentSettings, feeRecords,
  schools, students, users,
} from "@shared/schema";

const ADMIN_PASSWORD = "External-portal-test-password";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

let schoolAId = 0;
let schoolBId = 0;
let adminAId = 0;
let adminBId = 0;
let schoolASessionId = 0;
let schoolAArchivedSessionId = 0;
let schoolAActiveFeeId = 0;
let server: http.Server;
let baseUrl = "";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "external-portal-reauth-test-secret",
    resave: false,
    saveUninitialized: false,
  }));

  // Test-only session controls. The protected routes still receive the same
  // cookie-backed express-session object used by production.
  app.post("/test/login/:admin", (req, res) => {
    const isA = req.params.admin === "a";
    req.session.userId = isA ? adminAId : adminBId;
    req.session.userRole = "admin";
    req.session.schoolId = isA ? schoolAId : schoolBId;
    res.json({ ok: true });
  });
  app.post("/test/expire-reauth", (req, res) => {
    const approval = (req.session as any).externalPortalReauth;
    if (approval) approval.verifiedAt = Date.now() - 31 * 60 * 1000;
    res.json({ ok: true });
  });
  app.post("/test/forge-school/:schoolId", (req, res) => {
    req.session.schoolId = Number(req.params.schoolId);
    res.json({ ok: true });
  });
  app.post("/test/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.use(checkSessionContext);
  registerFeesRoutes(app);
  return app;
}

async function listen(app: express.Express) {
  return new Promise<http.Server>(resolve => {
    const started = app.listen(0, () => resolve(started));
  });
}

async function login(admin: "a" | "b") {
  const response = await fetch(`${baseUrl}/test/login/${admin}`, { method: "POST" });
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

async function request(
  path: string,
  cookie: string,
  init: RequestInit = {},
) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      cookie,
      ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}),
    },
  });
}

beforeAll(async () => {
  const [schoolA] = await db.insert(schools).values({
    name: "External Portal Reauth School A",
    code: `EPRA-${uid()}`,
  }).returning();
  const [schoolB] = await db.insert(schools).values({
    name: "External Portal Reauth School B",
    code: `EPRB-${uid()}`,
  }).returning();
  schoolAId = schoolA.id;
  schoolBId = schoolB.id;
  const [schoolASession] = await db.insert(academicSessions).values({
    schoolId: schoolAId,
    sessionName: "2026-27",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    isActive: true,
    status: "active",
    newAdmissionsEnabled: false,
    promotionStrategy: "defer",
  }).returning();
  schoolASessionId = schoolASession.id;
  const [schoolAArchivedSession] = await db.insert(academicSessions).values({
    schoolId: schoolAId,
    sessionName: "2025-26",
    startDate: "2025-04-01",
    endDate: "2026-03-31",
    isActive: false,
    status: "archived",
    newAdmissionsEnabled: false,
    promotionStrategy: "defer",
  }).returning();
  schoolAArchivedSessionId = schoolAArchivedSession.id;
  const [student] = await db.insert(students).values({
    schoolId: schoolAId,
    digitalStudentId: `EPRA-STU-${uid()}`,
    name: "External Portal Test Student",
    class: "7",
    section: "A",
    phone: "9999999999",
    dob: "2013-01-01",
    passwordHash: "x",
  }).returning();
  const [activeFee] = await db.insert(feeRecords).values({
    schoolId: schoolAId,
    studentId: student.id,
    sessionId: schoolASessionId,
    feeType: "Tuition",
    amount: 5000,
    dueDate: "2026-06-01",
    status: "Due",
  }).returning();
  schoolAActiveFeeId = activeFee.id;

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const [adminA] = await db.insert(users).values({
    email: `external-portal-a-${uid()}@test.invalid`,
    passwordHash,
    role: "admin",
    schoolId: schoolAId,
    isActive: true,
    isInitialized: true,
  }).returning();
  const [adminB] = await db.insert(users).values({
    email: `external-portal-b-${uid()}@test.invalid`,
    passwordHash,
    role: "admin",
    schoolId: schoolBId,
    isActive: true,
    isInitialized: true,
  }).returning();
  adminAId = adminA.id;
  adminBId = adminB.id;

  await db.insert(externalPaymentSettings).values([
    {
      schoolId: schoolAId,
      isEnabled: true,
      gatewayUrl: "https://school-a.example/pay",
      bannerMessage: "School A payment portal",
    },
    {
      schoolId: schoolBId,
      isEnabled: true,
      gatewayUrl: "https://school-b.example/pay",
      bannerMessage: "School B payment portal",
    },
  ]);

  server = await listen(makeApp());
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.fee_audit_cleanup', 'on', true)`);
    for (const schoolId of [schoolAId, schoolBId]) {
      if (schoolId) await tx.delete(schools).where(eq(schools.id, schoolId));
    }
  });
});

describe("External Portal recent password verification", () => {
  it("rejects a direct settings read before re-authentication without returning configuration", async () => {
    const cookie = await login("a");
    const response = await request("/api/admin/fees/external-settings", cookie);
    expect(response.status).toBe(403);
    const body: any = await response.json();
    expect(body).toEqual({
      message: "Admin verification is required to access External Payment Portal settings.",
      code: "EXTERNAL_PORTAL_REAUTH_REQUIRED",
    });
    expect(JSON.stringify(body)).not.toContain("school-a.example");
  });

  it("rejects direct configuration mutations before re-authentication and leaves settings unchanged", async () => {
    const cookie = await login("a");
    const response = await request("/api/admin/fees/external-settings/portal", cookie, {
      method: "PUT",
      body: JSON.stringify({
        isEnabled: true,
        gatewayUrl: "https://attacker.example/pay",
        bannerMessage: "unauthorized",
      }),
    });
    expect(response.status).toBe(403);

    const [settings] = await db.select().from(externalPaymentSettings)
      .where(eq(externalPaymentSettings.schoolId, schoolAId));
    expect(settings.gatewayUrl).toBe("https://school-a.example/pay");
  });

  it("rejects an incorrect password without leaking settings, account, or hash data", async () => {
    const cookie = await login("a");
    const response = await request("/api/admin/fees/external-settings/verify-access", cookie, {
      method: "POST",
      body: JSON.stringify({ password: "wrong-password" }),
    });
    expect(response.status).toBe(401);
    const body: any = await response.json();
    expect(body).toEqual({ message: "Incorrect password. Please try again." });
    expect(JSON.stringify(body)).not.toContain("hash");
    expect(JSON.stringify(body)).not.toContain("school-a.example");

    const followUp = await request("/api/admin/fees/external-settings", cookie);
    expect(followUp.status).toBe(403);
  });

  it("accepts the current password and permits the existing settings view and mutation for that school only", async () => {
    const cookie = await login("a");
    const verified = await request("/api/admin/fees/external-settings/verify-access", cookie, {
      method: "POST",
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    expect(verified.status).toBe(200);
    expect((await verified.json()).expiresAt).toBeTruthy();

    const read = await request("/api/admin/fees/external-settings", cookie);
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    const settings: any = await read.json();
    expect(settings.gatewayUrl).toBe("https://school-a.example/pay");
    expect(JSON.stringify(settings)).not.toContain("school-b.example");

    const update = await request("/api/admin/fees/external-settings/portal", cookie, {
      method: "PUT",
      body: JSON.stringify({
        isEnabled: true,
        gatewayUrl: "https://school-a.example/updated",
        bannerMessage: "School A updated payment portal",
      }),
    });
    expect(update.status).toBe(200);

    const [schoolBSettings] = await db.select().from(externalPaymentSettings)
      .where(eq(externalPaymentSettings.schoolId, schoolBId));
    expect(schoolBSettings.gatewayUrl).toBe("https://school-b.example/pay");
  });

  it("rejects a School A approval when a forged session school is changed to School B", async () => {
    const cookie = await login("a");
    const verified = await request("/api/admin/fees/external-settings/verify-access", cookie, {
      method: "POST",
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    expect(verified.status).toBe(200);

    await request(`/test/forge-school/${schoolBId}`, cookie, { method: "POST" });
    const read = await request("/api/admin/fees/external-settings", cookie);
    expect(read.status).toBe(403);
    expect((await read.json()).message).toBe("Admin verification is required to access External Payment Portal settings.");

    const forgedVerify = await request("/api/admin/fees/external-settings/verify-access", cookie, {
      method: "POST",
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    expect(forgedVerify.status).toBe(403);
  });

  it("rejects an expired verification", async () => {
    const cookie = await login("a");
    await request("/api/admin/fees/external-settings/verify-access", cookie, {
      method: "POST",
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    await request("/test/expire-reauth", cookie, { method: "POST" });

    const response = await request("/api/admin/fees/external-settings", cookie);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("EXTERNAL_PORTAL_REAUTH_REQUIRED");
  });

  it("allows receipt-signature upload and removal only after verification for the selected session", async () => {
    const cookie = await login("a");
    const selectedSessionHeaders = { "x-view-session-id": String(schoolASessionId) };

    const blockedUpload = new FormData();
    blockedUpload.append("file", new Blob(["signature"], { type: "image/png" }), "signature.png");
    const blocked = await request("/api/admin/fees/external-portal/signature", cookie, {
      method: "POST",
      body: blockedUpload,
      headers: selectedSessionHeaders,
    });
    expect(blocked.status).toBe(403);

    const verified = await request("/api/admin/fees/external-settings/verify-access", cookie, {
      method: "POST",
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
      headers: selectedSessionHeaders,
    });
    expect(verified.status).toBe(200);

    const upload = new FormData();
    upload.append("file", new Blob(["signature"], { type: "image/png" }), "signature.png");
    const uploaded = await request("/api/admin/fees/external-portal/signature", cookie, {
      method: "POST",
      body: upload,
      headers: selectedSessionHeaders,
    });
    expect(uploaded.status).toBe(200);
    expect((await uploaded.json()).feeReceiptSignatureUrl).toContain(`/uploads/schools/${schoolAId}/receipt-signature/`);

    const removed = await request("/api/admin/fees/external-portal/signature", cookie, {
      method: "DELETE",
      headers: selectedSessionHeaders,
    });
    expect(removed.status).toBe(200);
  });

  it("cannot reuse verification after logout", async () => {
    const cookie = await login("b");
    await request("/api/admin/fees/external-settings/verify-access", cookie, {
      method: "POST",
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    await request("/test/logout", cookie, { method: "POST" });

    const response = await request("/api/admin/fees/external-settings", cookie);
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Admin access required");
  });
});

describe("Fees tenant and session boundaries", () => {
  it("does not expose another school's dunning job status", async () => {
    await db.insert(dunningJobStatus).values({
      schoolId: schoolBId,
      isRunning: true,
      startedAt: new Date(),
    });

    const cookie = await login("a");
    const response = await request("/api/admin/fees/dunning-job-status", cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isRunning: false,
      startedAt: null,
      lastCompletedAt: null,
    });

    await db.insert(dunningJobStatus).values({
      schoolId: schoolAId,
      isRunning: true,
      startedAt: new Date(),
    });
    const ownResponse = await request("/api/admin/fees/dunning-job-status", cookie);
    expect(ownResponse.status).toBe(200);
    expect((await ownResponse.json()).isRunning).toBe(true);
  });

  it("does not resolve an active-year fee payment lookup while a different year is selected", async () => {
    const cookie = await login("a");
    const response = await request(
      `/api/admin/fees/payments?feeRecordId=${schoolAActiveFeeId}`,
      cookie,
      { headers: { "x-view-session-id": String(schoolAArchivedSessionId) } },
    );
    expect(response.status).toBe(404);
  });

  it("blocks manual dunning from an archived academic session before any reminder runs", async () => {
    const cookie = await login("a");
    const response = await request("/api/admin/fees/dunning-trigger", cookie, {
      method: "POST",
      headers: { "x-view-session-id": String(schoolAArchivedSessionId) },
      body: JSON.stringify({ feeRecordId: schoolAActiveFeeId }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ARCHIVE_READ_ONLY" });
  });
});