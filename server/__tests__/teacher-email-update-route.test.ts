import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { storage, TeacherEmailConflictError } from "../storage";
import { registerTeacherRoutes } from "../teacher-routes";

const teacher = {
  id: 321,
  userId: 654,
  schoolId: 12,
  fullName: "Route Teacher",
  phone: "9876543210",
  subject: "Math",
  assignedClass: "1",
  assignedSection: "A",
  designation: null,
  gender: null,
  dateOfBirth: null,
  govtIdType: null,
  govtIdNumber: null,
  address: null,
  joiningDate: null,
  qualifications: null,
  isActive: true,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "teacher-email-route-test", resave: false, saveUninitialized: false }));
  app.get("/test/session/:kind", (req, res) => {
    if (req.params.kind === "admin") {
      req.session.userId = 1;
      req.session.userRole = "admin";
    } else if (req.params.kind === "support") {
      req.session.staffId = 2;
      req.session.userRole = "support_staff";
      req.session.allowedModules = ["teacher-registry:edit"];
    }
    req.session.schoolId = 12;
    res.json({ ok: true });
  });
  registerTeacherRoutes(app);
  return app;
}

async function request(app: express.Express, method: string, path: string, body?: unknown, cookie?: string) {
  const response = await fetch(`http://127.0.0.1:${(app as any).__port}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie,
  };
}

describe("Admin Teacher email edit route", () => {
  let server: Server;
  let app: express.Express;
  let update: ReturnType<typeof vi.spyOn>;

  async function appListen(value: express.Express): Promise<Server> {
    const http = await new Promise<Server>(resolve => {
      const next = value.listen(0, "127.0.0.1", () => resolve(next));
    });
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    (value as any).__port = address.port;
    return http;
  }

  beforeEach(async () => {
    app = makeApp();
    vi.spyOn(storage, "getTeacherById").mockResolvedValue(teacher as any);
    update = vi.spyOn(storage, "updateTeacherAssignment").mockResolvedValue(teacher as any);
    server = await appListen(app);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  async function cookieFor(kind: "admin" | "support") {
    return (await request(app, "GET", `/test/session/${kind}`)).cookie;
  }

  it.each(["admin", "support"] as const)("allows authorized %s to submit trimmed email", async kind => {
    const result = await request(app, "PATCH", "/api/admin/teachers/321", {
      email: "  new-teacher@example.test  ",
    }, await cookieFor(kind));
    expect(result.status).toBe(200);
    expect(update).toHaveBeenCalledWith(321, 12, expect.objectContaining({ email: "new-teacher@example.test" }));
  });

  it("rejects wrong-school teacher IDs", async () => {
    vi.mocked(storage.getTeacherById).mockResolvedValue({ ...teacher, schoolId: 99 } as any);
    const result = await request(app, "PATCH", "/api/admin/teachers/321", {
      email: "new-teacher@example.test",
      schoolId: 99,
    }, await cookieFor("admin"));
    expect(result.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores browser schoolId and userId spoofing", async () => {
    const result = await request(app, "PATCH", "/api/admin/teachers/321", {
      email: "new-teacher@example.test",
      schoolId: 999,
      userId: 999999,
    }, await cookieFor("admin"));
    expect(result.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      321,
      12,
      expect.objectContaining({ email: "new-teacher@example.test" }),
    );
  });

  it.each([
    ["typed conflict", new TeacherEmailConflictError()],
    ["database unique conflict", Object.assign(new Error("duplicate email account@example.test"), { code: "23505" })],
  ])("maps %s to a generic non-enumerating 409", async (_label, error) => {
    update.mockRejectedValueOnce(error);
    const result = await request(app, "PATCH", "/api/admin/teachers/321", {
      email: "account@example.test",
    }, await cookieFor("admin"));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ message: "Unable to update teacher" });
    expect(JSON.stringify(result.body)).not.toMatch(/account@example\.test|duplicate|conflict/i);
  });

  it("rejects unauthorized users and invalid email input", async () => {
    const unauthorized = await request(app, "PATCH", "/api/admin/teachers/321", {
      email: "new-teacher@example.test",
    });
    expect(unauthorized.status).toBe(403);
    const invalid = await request(app, "PATCH", "/api/admin/teachers/321", {
      email: "not-an-email",
    }, await cookieFor("admin"));
    expect(invalid.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});