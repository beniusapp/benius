import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { and, eq } from "drizzle-orm";
import { registerRoutes } from "../routes";
import { db } from "../db";
import { academicSessions, schools } from "@shared/schema";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

interface Fixture {
  schoolId: number;
}

const fixtures: Fixture[] = [];
let server: http.Server;
let baseUrl = "";

async function createSchool(name: string): Promise<Fixture> {
  const suffix = uid();
  const [school] = await db.insert(schools).values({
    name: `${name} ${suffix}`,
    code: `ASC-${suffix}`,
  }).returning();
  const fixture = { schoolId: school.id };
  fixtures.push(fixture);
  return fixture;
}

async function postSession(
  fixture: Fixture,
  body: Record<string, unknown>,
  viewSessionId?: number,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-test-school-id": String(fixture.schoolId),
  };
  if (viewSessionId !== undefined) headers["x-view-session-id"] = String(viewSessionId);

  return fetch(`${baseUrl}/api/admin/academic-sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const freshSession = {
  sessionName: "2026-2027",
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  status: "draft",
  setAsActive: false,
  newAdmissionsEnabled: false,
  promotionStrategy: "defer",
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = {
      userId: 1,
      userRole: "admin",
      schoolId: Number(req.headers["x-test-school-id"] ?? 0),
    };
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const fixture of fixtures) {
    await db.delete(schools).where(eq(schools.id, fixture.schoolId));
  }
});

describe("academic session creation", () => {
  it("automatically activates a clean first session without a copy source", async () => {
    const fixture = await createSchool("First Session School");

    const response = await fetch(`${baseUrl}/api/admin/academic-sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-school-id": String(fixture.schoolId),
      },
      body: JSON.stringify(freshSession),
    });

    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({
      sessionName: "2026-2027",
      isActive: true,
      status: "active",
      copiedFromSessionId: null,
    });

    const rows = await db
      .select({
        id: academicSessions.id,
        isActive: academicSessions.isActive,
        status: academicSessions.status,
      })
      .from(academicSessions)
      .where(eq(academicSessions.schoolId, fixture.schoolId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isActive: true, status: "active" });
  });

  it("preserves draft creation for a school with existing sessions", async () => {
    const fixture = await createSchool("Existing Session School");
    const [existing] = await db.insert(academicSessions).values({
      schoolId: fixture.schoolId,
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: true,
      status: "active",
    }).returning();

    const response = await fetch(`${baseUrl}/api/admin/academic-sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-school-id": String(fixture.schoolId),
      },
      body: JSON.stringify({
        ...freshSession,
        sessionName: "2026-2027",
      }),
    });

    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({ isActive: false, status: "draft" });

    const rows = await db
      .select({
        sessionName: academicSessions.sessionName,
        isActive: academicSessions.isActive,
        status: academicSessions.status,
      })
      .from(academicSessions)
      .where(eq(academicSessions.schoolId, fixture.schoolId));

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      { sessionName: "2025-2026", isActive: true, status: "active" },
      { sessionName: "2026-2027", isActive: false, status: "draft" },
    ]));
  });

  it("keeps archived-session writes blocked", async () => {
    const fixture = await createSchool("Archived Session School");
    const [archived] = await db.insert(academicSessions).values({
      schoolId: fixture.schoolId,
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: false,
      status: "archived",
    }).returning();

    const response = await postSession(fixture, {
      ...freshSession,
      sessionName: "2026-2027",
    }, archived.id);

    expect(response.status).toBe(403);

    const rows = await db
      .select({ id: academicSessions.id })
      .from(academicSessions)
      .where(and(
        eq(academicSessions.schoolId, fixture.schoolId),
        eq(academicSessions.sessionName, "2026-2027"),
      ));
    expect(rows).toHaveLength(0);
  });
});