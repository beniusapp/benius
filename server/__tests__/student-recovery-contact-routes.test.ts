import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { registerRoutes } from "../routes";
import {
  notificationConfig,
  schools,
  studentRecoveryContactVerificationChallenges,
  students,
} from "@shared/schema";

const nativeFetch = globalThis.fetch;
let server: http.Server;
let baseUrl = "";
let serial = 0;
const schoolIds: number[] = [];
const sessions = new Map<number, Record<string, unknown>>();
const providerFetch = vi.fn();

async function createSchool() {
  const suffix = `${Date.now()}-${serial++}`;
  const [school] = await db.insert(schools).values({
    name: `Contact Route Test ${suffix}`,
    code: `CRT-${suffix}`,
  }).returning();
  schoolIds.push(school.id);
  return school;
}

async function createStudent(schoolId: number, email = `route-${serial}@example.test`) {
  const suffix = `${Date.now()}-${serial++}`;
  const [student] = await db.insert(students).values({
    schoolId,
    digitalStudentId: `CRT-${suffix}`,
    name: `Route Student ${suffix}`,
    class: "9",
    section: "A",
    phone: String(9100000000 + serial).slice(0, 10),
    dob: "2011-01-01",
    passwordHash: "not-used-by-contact-verification",
    email,
  }).returning();
  return student;
}

async function configureEmail(schoolId: number, enabled = true) {
  await db.insert(notificationConfig).values({
    schoolId,
    emailEnabled: enabled,
    emailProvider: "sendgrid",
    sendgridApiKey: `school-${schoolId}-key`,
    sendgridFromEmail: `school-${schoolId}@example.test`,
    sendgridFromName: `School ${schoolId}`,
  });
}

async function request(
  method: string,
  path: string,
  schoolId?: number,
  body?: Record<string, unknown>,
) {
  const response = await nativeFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(schoolId ? { "x-test-admin-school-id": String(schoolId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function sentOtp(): string {
  const [, init] = providerFetch.mock.calls.at(-1) as [string, RequestInit];
  const payload = JSON.parse(String(init.body));
  const html = payload.content[0].value as string;
  const match = html.match(/<strong>(\d{6})<\/strong>/);
  if (!match) throw new Error("Provider payload did not contain a six-digit code");
  return match[1];
}

describe("Student recovery-contact verification routes", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = "student-contact-route-test-secret";
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      const schoolId = Number(req.headers["x-test-admin-school-id"] ?? 0);
      if (!schoolId) {
        req.session = {};
      } else {
        if (!sessions.has(schoolId)) {
          sessions.set(schoolId, {
            userId: schoolId + 100_000,
            userRole: "admin",
            schoolId,
          });
        }
        req.session = sessions.get(schoolId);
      }
      next();
    });
    server = http.createServer(app);
    await registerRoutes(server, app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  }, 30_000);

  beforeEach(() => {
    sessions.clear();
    providerFetch.mockReset();
    providerFetch.mockResolvedValue(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", providerFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (schoolIds.length) await db.delete(schools).where(inArray(schools.id, schoolIds));
  });

  it("requires an authenticated administrator", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    const result = await request("POST", `/api/admin/students/${student.id}/recovery-contact/request`, undefined, {});
    expect(result.status).toBe(403);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("does not let a School A administrator target a School B Student", async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const studentB = await createStudent(schoolB.id);
    await configureEmail(schoolA.id);
    await configureEmail(schoolB.id);

    const result = await request("POST", `/api/admin/students/${studentB.id}/recovery-contact/request`, schoolA.id, {});
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      message: "If the recovery email is eligible, a verification code has been sent.",
    });
    expect(providerFetch).not.toHaveBeenCalled();
    const challenges = await db.select().from(studentRecoveryContactVerificationChallenges)
      .where(eq(studentRecoveryContactVerificationChallenges.studentId, studentB.id));
    expect(challenges).toHaveLength(0);
  });

  it("returns no OTP, challenge identity, Student identity, or provider secret", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    await configureEmail(school.id);

    const result = await request("POST", `/api/admin/students/${student.id}/recovery-contact/request`, school.id, {});
    const serialized = JSON.stringify(result.body);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      message: "If the recovery email is eligible, a verification code has been sent.",
    });
    expect(serialized).not.toContain(student.email!);
    expect(serialized).not.toContain(String(student.id));
    expect(serialized).not.toContain(`school-${school.id}-key`);
    expect(serialized).not.toMatch(/\d{6}/);
  });

  it("uses only the authenticated school's provider configuration", async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const studentA = await createStudent(schoolA.id);
    await configureEmail(schoolA.id);
    await configureEmail(schoolB.id);

    await request("POST", `/api/admin/students/${studentA.id}/recovery-contact/request`, schoolA.id, {});
    expect(providerFetch).toHaveBeenCalledTimes(1);
    const [url, init] = providerFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer school-${schoolA.id}-key`);
    expect((init.headers as Record<string, string>).Authorization).not.toBe(`Bearer school-${schoolB.id}-key`);
    const payload = JSON.parse(String(init.body));
    expect(payload.personalizations[0].to[0].email).toBe(studentA.email);
  });

  it("verifies the recipient-entered OTP and reports the exact email as verified", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    await configureEmail(school.id);
    await request("POST", `/api/admin/students/${student.id}/recovery-contact/request`, school.id, {});
    const otp = sentOtp();

    const wrong = await request("POST", `/api/admin/students/${student.id}/recovery-contact/verify`, school.id, { otp: "000000" });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ message: "Invalid or expired verification code." });
    const correct = await request("POST", `/api/admin/students/${student.id}/recovery-contact/verify`, school.id, { otp });
    expect(correct.status).toBe(200);
    expect(correct.body).toEqual({ success: true, message: "Recovery email verified." });

    const status = await request("GET", `/api/admin/students/${student.id}/recovery-contact`, school.id);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      email: student.email,
      verified: true,
    });
  });

  it("does not create a challenge when school email is disabled", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    await configureEmail(school.id, false);

    const result = await request("POST", `/api/admin/students/${student.id}/recovery-contact/request`, school.id, {});
    expect(result.status).toBe(200);
    expect(providerFetch).not.toHaveBeenCalled();
    const challenges = await db.select().from(studentRecoveryContactVerificationChallenges)
      .where(eq(studentRecoveryContactVerificationChallenges.studentId, student.id));
    expect(challenges).toHaveLength(0);
  });

  it("consumes the challenge and clears server recovery state after provider failure", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    await configureEmail(school.id);
    providerFetch.mockResolvedValueOnce(new Response("provider details", { status: 500 }));

    const result = await request("POST", `/api/admin/students/${student.id}/recovery-contact/request`, school.id, {});
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain("provider details");
    const [challenge] = await db.select().from(studentRecoveryContactVerificationChallenges)
      .where(eq(studentRecoveryContactVerificationChallenges.studentId, student.id));
    expect(challenge.consumedAt).not.toBeNull();
    const verify = await request("POST", `/api/admin/students/${student.id}/recovery-contact/verify`, school.id, { otp: "123456" });
    expect(verify.status).toBe(400);
    expect(verify.body).toEqual({ message: "Invalid or expired verification code." });
  });

  it("does not invalidate a newer delivered challenge when an older delivery fails later", async () => {
    const school = await createSchool();
    const student = await createStudent(school.id);
    await configureEmail(school.id);
    let rejectFirstDelivery!: (error: Error) => void;
    providerFetch
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectFirstDelivery = reject;
      }))
      .mockResolvedValueOnce(new Response("", { status: 202 }));

    const firstRequest = request(
      "POST",
      `/api/admin/students/${student.id}/recovery-contact/request`,
      school.id,
      {},
    );
    await vi.waitFor(() => expect(providerFetch).toHaveBeenCalledTimes(1));
    const secondResult = await request(
      "POST",
      `/api/admin/students/${student.id}/recovery-contact/request`,
      school.id,
      {},
    );
    expect(secondResult.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledTimes(2);
    const [, secondInit] = providerFetch.mock.calls[1] as [string, RequestInit];
    const secondPayload = JSON.parse(String(secondInit.body));
    const secondHtml = secondPayload.content[0].value as string;
    const secondOtp = secondHtml.match(/<strong>(\d{6})<\/strong>/)?.[1];
    expect(secondOtp).toMatch(/^\d{6}$/);

    rejectFirstDelivery(new Error("older delivery failed"));
    expect((await firstRequest).status).toBe(200);

    const rows = await db.select().from(studentRecoveryContactVerificationChallenges)
      .where(eq(studentRecoveryContactVerificationChallenges.studentId, student.id));
    expect(rows).toHaveLength(2);
    expect(rows.filter(row => row.consumedAt === null)).toHaveLength(1);
    const verifyResult = await request(
      "POST",
      `/api/admin/students/${student.id}/recovery-contact/verify`,
      school.id,
      { otp: secondOtp },
    );
    expect(verifyResult.status).toBe(200);
  });
});