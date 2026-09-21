import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import {
  PASSWORD_RECOVERY_GENERIC_MESSAGE,
  PASSWORD_RECOVERY_INVALID_MESSAGE,
  PasswordRecoveryRateLimiter,
} from "../password-recovery";
import { registerStudentPasswordRecoveryRoutes } from "../student-password-recovery-routes";

const school = { id: 91001, code: "SCHOOL-A" };
const student = { id: 92001, schoolId: school.id, email: "student@example.test", isActive: true, isActivated: true };

type Harness = {
  server: Server;
  baseUrl: string;
  invalidateChallenge: ReturnType<typeof vi.fn>;
  sendRecoveryEmail: ReturnType<typeof vi.fn>;
  verifyOtp: ReturnType<typeof vi.fn>;
  stop: () => Promise<void>;
};

async function request(harness: Harness, path: string, body?: Record<string, unknown>, cookie?: string) {
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie,
  };
}

async function makeHarness(options: {
  student?: typeof student;
  config?: Record<string, unknown> | null;
  limiter?: PasswordRecoveryRateLimiter;
  createChallenge?: (
    studentId: number,
    schoolId: number,
    otpHash: string,
    otpExpiresAt: Date,
    requestIp: string | null,
  ) => Promise<{ id: number; studentId: number; schoolId: number } | null>;
} = {}): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "student-route-http-secret", resave: false, saveUninitialized: false }));
  const invalidateChallenge = vi.fn(async () => undefined);
  const sendRecoveryEmail = vi.fn(async () => undefined);
  const verifyOtp = vi.fn(async () => "a".repeat(64));
  let challengeId = 94001;
  const currentStudent = options.student ?? student;
  registerStudentPasswordRecoveryRoutes(app, {
    getSchoolByCode: async code => code === school.code ? school : undefined,
    getStudentByDsidAndSchool: async (dsid, schoolId) =>
      dsid === "DSID-001" && schoolId === school.id ? currentStudent : undefined,
    createChallenge: options.createChallenge
      ?? (async (studentId, schoolId) => ({ id: challengeId++, studentId, schoolId })),
    invalidateChallenge,
    getNotificationConfig: async () => options.config === undefined ? {
      id: 95001, schoolId: school.id, emailEnabled: true, emailProvider: "sendgrid",
      sendgridApiKey: "key", sendgridFromEmail: "from@example.test",
    } as any : options.config as any,
    sendRecoveryEmail,
    verifyOtp,
    getPersistedRecoveryState: async () => ({
      flow: "student_password_recovery", stage: "otp_pending",
      challengeId: 94001, studentId: currentStudent.id, schoolId: school.id,
    }),
    isChallengeActive: async () => true,
    rateLimiter: options.limiter ?? new PasswordRecoveryRateLimiter(100),
  } as any);
  const server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    invalidateChallenge,
    sendRecoveryEmail,
    verifyOtp,
    stop: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

const open: Harness[] = [];
beforeEach(() => open.length = 0);
afterEach(async () => { await Promise.all(open.map(harness => harness.stop())); });
async function harness(options: Parameters<typeof makeHarness>[0] = {}) {
  const value = await makeHarness(options);
  open.push(value);
  return value;
}

describe("Student password recovery HTTP boundary", () => {
  it("sends the authoritative Registry email without a recovery-contact record", async () => {
    const app = await harness();
    const result = await request(app, "/api/student/forgot-password", { schoolCode: " school-a ", dsid: "DSID-001" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ message: PASSWORD_RECOVERY_GENERIC_MESSAGE });
    expect(app.sendRecoveryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: school.id }), student.email, expect.stringMatching(/^\d{6}$/),
    );
    const verified = await request(app, "/api/student/verify-recovery-otp", { otp: "123456" }, result.cookie);
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ success: true, message: "Verification successful." });
    expect(JSON.stringify(verified.body)).not.toMatch(/resetToken|challengeId|studentId|schoolId/i);
  });

  it("does not send an observed A address after the authoritative row changes to B before challenge creation", async () => {
    const racedStudent = { ...student };
    let activeChallenge = false;
    const app = await harness({
      student: racedStudent,
      createChallenge: async () => {
        racedStudent.email = "authoritative-b@example.test";
        activeChallenge = false;
        return null;
      },
    });
    const result = await request(app, "/api/student/forgot-password", {
      schoolCode: school.code,
      dsid: "DSID-001",
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ message: PASSWORD_RECOVERY_GENERIC_MESSAGE });
    expect(racedStudent.email).toBe("authoritative-b@example.test");
    expect(activeChallenge).toBe(false);
    expect(app.sendRecoveryEmail).not.toHaveBeenCalled();
    expect(app.sendRecoveryEmail).not.toHaveBeenCalledWith(
      expect.anything(),
      "student@example.test",
      expect.anything(),
    );
  });

  it("sends the exact normalized Registry email selected by the route", async () => {
    const app = await harness({
      student: { ...student, email: "  Registry.Student@example.test  " },
    });
    const result = await request(app, "/api/student/forgot-password", {
      schoolCode: school.code,
      dsid: "DSID-001",
    });
    expect(result.body).toEqual({ message: PASSWORD_RECOVERY_GENERIC_MESSAGE });
    expect(app.sendRecoveryEmail).toHaveBeenCalledWith(
      expect.anything(),
      "Registry.Student@example.test",
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it.each([
    ["unknown school", { schoolCode: "MISSING", dsid: "DSID-001" }],
    ["unknown DSID", { schoolCode: school.code, dsid: "MISSING" }],
    ["browser email", { schoolCode: school.code, dsid: "DSID-001", email: "wrong@example.test" }],
  ])("uses the same generic response for %s", async (_label, body) => {
    const app = await harness();
    const result = await request(app, "/api/student/forgot-password", body);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ message: PASSWORD_RECOVERY_GENERIC_MESSAGE });
  });

  it.each([
    ["missing email", null],
    ["invalid email", "not-an-email"],
  ])("anti-enumerates a Student with %s", async (_label, email) => {
    const app = await harness({ student: { ...student, email } as typeof student });
    const result = await request(app, "/api/student/forgot-password", { schoolCode: school.code, dsid: "DSID-001" });
    expect(result.body).toEqual({ message: PASSWORD_RECOVERY_GENERIC_MESSAGE });
    expect(app.sendRecoveryEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["inactive", { isActive: false }],
    ["unactivated", { isActivated: false }],
  ])("anti-enumerates a Student that is %s", async (_label, state) => {
    const app = await harness({ student: { ...student, ...state } });
    const result = await request(app, "/api/student/forgot-password", { schoolCode: school.code, dsid: "DSID-001" });
    expect(result.body).toEqual({ message: PASSWORD_RECOVERY_GENERIC_MESSAGE });
    expect(app.sendRecoveryEmail).not.toHaveBeenCalled();
  });

  it("invalidates the exact challenge on school configuration failure", async () => {
    const app = await harness({ config: { id: 95002, schoolId: 999, emailEnabled: true, emailProvider: "sendgrid" } });
    const result = await request(app, "/api/student/forgot-password", { schoolCode: school.code, dsid: "DSID-001" });
    expect(result.body).toEqual({ message: PASSWORD_RECOVERY_GENERIC_MESSAGE });
    expect(app.sendRecoveryEmail).not.toHaveBeenCalled();
    expect(app.invalidateChallenge).toHaveBeenCalledWith(94001, student.id, school.id);
  });

  it("rejects malformed browser OTP authority fields", async () => {
    const app = await harness();
    const result = await request(app, "/api/student/verify-recovery-otp", { otp: "12", challengeId: 94001 });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    expect(app.verifyOtp).not.toHaveBeenCalled();
  });

  it("applies the limiter to both endpoints", async () => {
    const app = await harness({ limiter: new PasswordRecoveryRateLimiter(1) });
    expect((await request(app, "/api/student/forgot-password", { schoolCode: school.code, dsid: "DSID-001" })).status).toBe(200);
    expect((await request(app, "/api/student/forgot-password", { schoolCode: school.code, dsid: "DSID-001" })).status).toBe(429);
    expect((await request(app, "/api/student/verify-recovery-otp", { otp: "123456" })).status).toBe(400);
    expect((await request(app, "/api/student/verify-recovery-otp", { otp: "123456" })).status).toBe(429);
  });
});