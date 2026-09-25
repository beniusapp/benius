import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { storage } from "../storage";
import { registerTeacherRoutes } from "../teacher-routes";

describe("legacy calendar school isolation", () => {
  let server: Server;
  let baseUrl: string;
  let readEvents: ReturnType<typeof vi.spyOn>;
  let createEvent: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    readEvents = vi.spyOn(storage, "getCalendarEvents").mockResolvedValue([]);
    createEvent = vi.spyOn(storage, "createCalendarEvent").mockResolvedValue({
      id: 1, schoolId: 12, title: "School event", date: "2026-09-24", eventType: "holiday",
    } as Awaited<ReturnType<typeof storage.createCalendarEvent>>);

    const app = express();
    app.use(express.json());
    app.use(session({ secret: "legacy-calendar-isolation-test", resave: false, saveUninitialized: false }));
    app.post("/test/login/:role", (req, res) => {
      req.session.schoolId = 12;
      if (req.params.role === "teacher") {
        req.session.teacherId = 2;
        req.session.userRole = "teacher";
      } else {
        req.session.userId = 1;
        req.session.userRole = "admin";
      }
      res.json({ ok: true });
    });
    registerTeacherRoutes(app);
    server = await new Promise<Server>(resolve => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  async function login(role: "admin" | "teacher") {
    const response = await fetch(`${baseUrl}/test/login/${role}`, { method: "POST" });
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Test login did not create a session");
    return cookie;
  }

  async function getCalendar(schoolId: string, cookie: string) {
    return fetch(`${baseUrl}/api/calendar/${schoolId}`, { headers: { cookie } });
  }

  async function postCalendar(schoolId: unknown, cookie?: string) {
    return fetch(`${baseUrl}/api/calendar`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ schoolId, title: "School event", date: "2026-09-24", eventType: "holiday" }),
    });
  }

  it.each(["admin", "teacher"] as const)("rejects %s reading a different school's calendar", async role => {
    const response = await getCalendar("34", await login(role));
    expect(response.status).toBe(403);
    expect(readEvents).not.toHaveBeenCalled();
  });

  it.each(["admin", "teacher"] as const)("preserves %s reading their own school's calendar", async role => {
    const response = await getCalendar("12", await login(role));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(readEvents).toHaveBeenCalledWith(12);
  });

  it("rejects an admin creating calendar data for another school", async () => {
    const response = await postCalendar(34, await login("admin"));
    expect(response.status).toBe(403);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("preserves an admin creating calendar data for their own school", async () => {
    const response = await postCalendar("12", await login("admin"));
    expect(response.status).toBe(201);
    expect(createEvent).toHaveBeenCalledWith({
      schoolId: 12, title: "School event", date: "2026-09-24", eventType: "holiday",
    });
  });

  it("keeps the existing POST authorization for unauthenticated and teacher requests", async () => {
    expect((await postCalendar(12)).status).toBe(403);
    expect((await postCalendar(12, await login("teacher"))).status).toBe(403);
    expect(createEvent).not.toHaveBeenCalled();
  });
});