/**
 * server/__tests__/financial-analytics-route.test.ts
 *
 * Route-level regression coverage for the canonical Financial Analytics
 * endpoints:
 *   - GET /api/fees/analytics            (JSON)
 *   - GET /api/fees/analytics/pdf        (PDF export)
 *   - GET /api/fees/analytics/aging-students (bucket detail)
 *
 * The data-service behaviour is exercised in financial-analytics-data.test.ts;
 * this file covers ONLY the HTTP request/response contract of the three
 * routes: preset/section/bucket validation, custom-range validation, session
 * resolution (active vs selected), tenant ownership of the selected session,
 * canonical response shape, and the caching / content-type / disposition
 * headers.
 *
 * Session model (matches production):
 *   - A global admin session is injected so adminGuard passes.
 *   - checkSessionContext (the real middleware) reads the x-view-session-id
 *     header and attaches req.viewSessionId, exactly as production does. Tests
 *     that need a "selected session" send that header; tests that omit it fall
 *     back to the school's active session.
 *
 * Three lightweight Express apps are used:
 *   - `app`      : admin session bound to the primary tenant school (has an
 *                  active session). Drives the bulk of the cases.
 *   - `noSesApp` : admin session bound to a school with NO active session,
 *                  used for the 409 "no active/selected session" case.
 *
 * The foreign-tenant 404 cases send the OTHER tenant's session id via the
 * x-view-session-id header against `app` (whose session.schoolId is the primary
 * school), so ownership validation rejects it.
 *
 * All schools/sessions are tenant-scoped and cleaned up in afterAll.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { registerFeesRoutes } from "../fees-routes";
import { checkSessionContext } from "../routes";
import { db } from "../db";
import { schools, academicSessions } from "@shared/schema";
import { eq } from "drizzle-orm";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Primary tenant (has an active session)
let primarySchoolId = 0;
let primarySessionId = 0;

// Foreign tenant (its session is used to assert cross-tenant 404s)
let foreignSchoolId = 0;
let foreignSessionId = 0;

// School with NO active session (drives the 409 case)
let noSesSchoolId = 0;

let server: http.Server;
let noSesServer: http.Server;
let baseUrl = "";
let noSesUrl = "";

function makeApp(schoolId: number) {
  const app = express();
  app.use(express.json());
  // Inject a valid admin session so adminGuard passes.
  app.use((req: any, _res, next) => {
    req.session = { userId: 1, userRole: "admin", schoolId };
    next();
  });
  // Real session-context middleware: reads x-view-session-id → req.viewSessionId.
  app.use(checkSessionContext);
  registerFeesRoutes(app);
  return app;
}

async function listen(app: express.Express): Promise<http.Server> {
  return new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
}

beforeAll(async () => {
  // ── Primary tenant + active session ──────────────────────────────────────
  const [primarySchool] = await db
    .insert(schools)
    .values({ name: "Fin Analytics Route School", code: `FARR-${uid()}` })
    .returning();
  primarySchoolId = primarySchool.id;

  const [primarySession] = await db
    .insert(academicSessions)
    .values({
      schoolId: primarySchoolId,
      sessionName: "2024-25",
      startDate: "2024-04-01",
      endDate: "2025-03-31",
      isActive: true,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    })
    .returning();
  primarySessionId = primarySession.id;

  // ── Foreign tenant + its own session ─────────────────────────────────────
  const [foreignSchool] = await db
    .insert(schools)
    .values({ name: "Fin Analytics Foreign School", code: `FARF-${uid()}` })
    .returning();
  foreignSchoolId = foreignSchool.id;

  const [foreignSession] = await db
    .insert(academicSessions)
    .values({
      schoolId: foreignSchoolId,
      sessionName: "2024-25",
      startDate: "2024-04-01",
      endDate: "2025-03-31",
      isActive: true,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    })
    .returning();
  foreignSessionId = foreignSession.id;

  // ── School with NO active session ────────────────────────────────────────
  const [noSesSchool] = await db
    .insert(schools)
    .values({ name: "Fin Analytics NoSession School", code: `FARN-${uid()}` })
    .returning();
  noSesSchoolId = noSesSchool.id;

  server = await listen(makeApp(primarySchoolId));
  noSesServer = await listen(makeApp(noSesSchoolId));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  noSesUrl = `http://127.0.0.1:${(noSesServer.address() as any).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => noSesServer.close(() => resolve()));
  // Sessions cascade with their schools; delete schools tenant-scoped.
  for (const id of [primarySchoolId, foreignSchoolId, noSesSchoolId]) {
    if (id) await db.delete(schools).where(eq(schools.id, id));
  }
});

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function getJson(qs: string, viewSessionId?: number) {
  const headers: Record<string, string> = {};
  if (viewSessionId !== undefined) headers["x-view-session-id"] = String(viewSessionId);
  return fetch(`${baseUrl}/api/fees/analytics${qs}`, { headers });
}
function getPdf(qs: string, viewSessionId?: number) {
  const headers: Record<string, string> = {};
  if (viewSessionId !== undefined) headers["x-view-session-id"] = String(viewSessionId);
  return fetch(`${baseUrl}/api/fees/analytics/pdf${qs}`, { headers });
}
function getAging(qs: string, viewSessionId?: number) {
  const headers: Record<string, string> = {};
  if (viewSessionId !== undefined) headers["x-view-session-id"] = String(viewSessionId);
  return fetch(`${baseUrl}/api/fees/analytics/aging-students${qs}`, { headers });
}

// ── GET /api/fees/analytics (JSON) ─────────────────────────────────────────────

describe("GET /api/fees/analytics — JSON contract", () => {
  it("returns 409 when there is no active or selected session", async () => {
    const res = await fetch(`${noSesUrl}/api/fees/analytics`);
    expect(res.status).toBe(409);
  });

  it("returns 200 with canonical shape and Cache-Control: no-store on default preset", async () => {
    const res = await getJson("");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body: any = await res.json();
    // Canonical top-level fields.
    for (const key of [
      "generatedAt",
      "sessionInfo",
      "filter",
      "summary",
      "trend",
      "online",
      "offline",
      "classWise",
      "feeCategories",
      "aging",
      "cashDenominations",
    ]) {
      expect(body).toHaveProperty(key);
    }
    // Default preset resolves to academic_year with session bounds.
    expect(body.filter.preset).toBe("academic_year");
    expect(body.filter.startDate).toBe("2024-04-01");
    expect(body.filter.endDate).toBe("2025-03-31");
    expect(body.sessionInfo.id).toBe(primarySessionId);
    expect(Array.isArray(body.trend)).toBe(true);
    expect(Array.isArray(body.aging)).toBe(true);
  });

  it("returns 200 for an explicit academic_year preset", async () => {
    const res = await getJson("?preset=academic_year");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.filter.preset).toBe("academic_year");
  });

  it("returns 400 for an unknown preset", async () => {
    const res = await getJson("?preset=quarterly");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an array preset", async () => {
    const res = await getJson("?preset=today&preset=custom");
    expect(res.status).toBe(400);
  });

  it("returns 400 for custom preset with missing dates", async () => {
    const res = await getJson("?preset=custom");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an impossible custom date", async () => {
    const res = await getJson("?preset=custom&startDate=2024-02-31&endDate=2024-03-01");
    expect(res.status).toBe(400);
  });

  it("returns 400 for a reversed custom range", async () => {
    const res = await getJson("?preset=custom&startDate=2024-05-01&endDate=2024-04-01");
    expect(res.status).toBe(400);
  });

  it("returns 400 for a custom range exceeding 5 years", async () => {
    const res = await getJson("?preset=custom&startDate=2018-01-01&endDate=2025-01-01");
    expect(res.status).toBe(400);
  });

  it("returns 200 with exact filter start/end for a valid custom range", async () => {
    const res = await getJson("?preset=custom&startDate=2024-06-01&endDate=2024-06-30");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.filter.preset).toBe("custom");
    expect(body.filter.startDate).toBe("2024-06-01");
    expect(body.filter.endDate).toBe("2024-06-30");
  });

  it("returns 404 when the selected session belongs to another tenant", async () => {
    const res = await getJson("", foreignSessionId);
    expect(res.status).toBe(404);
  });
});

// ── GET /api/fees/analytics/pdf ────────────────────────────────────────────────

describe("GET /api/fees/analytics/pdf — export contract", () => {
  it("returns 200 application/pdf with attachment filename and no-store on default section", async () => {
    const res = await getPdf("");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const disp = res.headers.get("content-disposition") ?? "";
    expect(disp).toContain("attachment");
    expect(disp).toContain("filename=");
    expect(disp).toContain(".pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("returns 200 application/pdf for the summary section", async () => {
    const res = await getPdf("?section=summary");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("returns 400 for an unknown section", async () => {
    const res = await getPdf("?section=nonsense");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an array section", async () => {
    const res = await getPdf("?section=summary&section=trend");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown preset (shared validation)", async () => {
    const res = await getPdf("?preset=quarterly");
    expect(res.status).toBe(400);
  });

  it("returns 404 when the selected session belongs to another tenant", async () => {
    const res = await getPdf("", foreignSessionId);
    expect(res.status).toBe(404);
  });
});

// ── GET /api/fees/analytics/aging-students ─────────────────────────────────────

describe("GET /api/fees/analytics/aging-students — bucket detail contract", () => {
  it("returns 400 when dates are missing", async () => {
    const res = await getAging("?bucket=1-30");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown bucket", async () => {
    const res = await getAging("?bucket=0-99&startDate=2024-04-01&endDate=2024-06-30");
    expect(res.status).toBe(400);
  });

  it("returns 200 with an empty array for a valid range with no defaulters", async () => {
    const res = await getAging("?bucket=1-30&startDate=2024-04-01&endDate=2024-06-30");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([]);
  });

  it("returns 404 when the selected session belongs to another tenant", async () => {
    const res = await getAging(
      "?bucket=1-30&startDate=2024-04-01&endDate=2024-06-30",
      foreignSessionId,
    );
    expect(res.status).toBe(404);
  });
});
