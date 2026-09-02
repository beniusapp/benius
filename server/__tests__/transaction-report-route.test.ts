/**
 * server/__tests__/transaction-report-route.test.ts
 *
 * Route-level strict-validation tests for the POST selection-aware
 * transaction report endpoint.
 *
 * The invoice-population / projection behavior is exercised in
 * transaction-report-data.test.ts. This file covers ONLY the request
 * validation contract of POST /api/admin/fees/payments/report/pdf:
 *   - non-boolean selectAllMatching → 400
 *   - selectedIds / excludedIds wrong type → 400
 *   - non-positive / non-integer IDs → 400
 *   - explicit mode with no selected IDs → 400 (not a misleading empty 200 PDF)
 *   - valid select-all with no exclusions → allowed (200 PDF)
 *
 * A lightweight middleware injects a valid admin session so adminGuard passes.
 * The school row is created/destroyed per suite so the valid-request case can
 * actually render a (possibly empty) PDF.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { registerFeesRoutes } from "../fees-routes";
import { db } from "../db";
import { academicSessions, schools } from "@shared/schema";
import { eq } from "drizzle-orm";

let server: http.Server;
let baseUrl = "";
let schoolId = 0;
let sessionId = 0;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const ENDPOINT = "/api/admin/fees/payments/report/pdf";

beforeAll(async () => {
  const [school] = await db
    .insert(schools)
    .values({ name: "Tx Route Test School", code: `TXRR-${uid()}` })
    .returning();
  schoolId = school.id;
  const [session] = await db.insert(academicSessions).values({
    schoolId,
    sessionName: "Transaction report fixture session",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    isActive: true,
    status: "active",
  }).returning();
  sessionId = session.id;

  const app = express();
  app.use(express.json());
  // Inject a valid admin session so adminGuard passes.
  app.use((req: any, _res, next) => {
    req.session = { userId: 1, userRole: "admin", schoolId };
    next();
  });
  registerFeesRoutes(app);
  server = await new Promise<http.Server>((resolve) => {
    const next = app.listen(0, () => resolve(next));
  });
  const address = server.address() as any;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId));
});

async function post(body: unknown) {
  return fetch(`${baseUrl}${ENDPOINT}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-view-session-id": String(sessionId),
    },
    body: JSON.stringify(body),
  });
}

describe("POST transaction report — strict selection validation", () => {
  it("rejects non-boolean selectAllMatching with 400", async () => {
    const res = await post({ selectAllMatching: "yes", selectedIds: [1] });
    expect(res.status).toBe(400);
  });

  it("rejects selectedIds that is not an array with 400", async () => {
    const res = await post({ selectAllMatching: false, selectedIds: 5 });
    expect(res.status).toBe(400);
  });

  it("rejects excludedIds that is not an array with 400", async () => {
    const res = await post({ selectAllMatching: true, excludedIds: "1,2,3" });
    expect(res.status).toBe(400);
  });

  it("rejects non-positive integer IDs with 400", async () => {
    const res = await post({ selectAllMatching: false, selectedIds: [1, 0, 2] });
    expect(res.status).toBe(400);
  });

  it("rejects non-integer IDs with 400", async () => {
    const res = await post({ selectAllMatching: false, selectedIds: [1, 2.5] });
    expect(res.status).toBe(400);
  });

  it("rejects explicit mode with no selected IDs (400, not empty 200 PDF)", async () => {
    const res = await post({ selectAllMatching: false, selectedIds: [] });
    expect(res.status).toBe(400);
  });

  it("allows valid select-all with no exclusions (200 PDF)", async () => {
    const res = await post({ selectAllMatching: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
  });

  it("allows a valid explicit selection (200 PDF)", async () => {
    // IDs need not exist — an empty population still renders a valid PDF.
    const res = await post({ selectAllMatching: false, selectedIds: [999999999] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
  });
});
