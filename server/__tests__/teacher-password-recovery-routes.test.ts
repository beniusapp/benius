import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import {
  hashPasswordRecoverySecret,
  PASSWORD_RECOVERY_GENERIC_MESSAGE,
  PASSWORD_RECOVERY_INVALID_MESSAGE,
  PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE,
  PasswordRecoveryRateLimiter,
  type TeacherPasswordRecoveryChallenge,
} from "../password-recovery";
import { registerTeacherPasswordRecoveryRoutes } from "../teacher-password-recovery-routes";

const schoolA = { id: 61001, code: "SCHOOL-A" };
const schoolB = { id: 61002, code: "SCHOOL-B" };
const sharedEmail = "shared-teacher@example.test";
const schoolAOnlyEmail = "teacher-a@example.test";
const schoolBOnlyEmail = "teacher-b@example.test";
const inactiveEmail = "inactive@example.test";
const nonTeacherEmail = "admin@example.test";

const accountA = { userId: 62001, teacherId: 63001 };
const accountB = { userId: 62002, teacherId: 63002 };
const otpA = "111111";
const otpB = "222222";
const resetTokenA = "step-4-reset-token-a";
const resetTokenB = "step-4-reset-token-b";

const configA = {
  id: 64001,
  schoolId: schoolA.id,
  emailEnabled: true,
  emailProvider: "sendgrid",
  sendgridApiKey: "sendgrid-key-a",
  sendgridFromEmail: "recovery-a@example.test",
  sendgridFromName: "School A",
} as any;

const configB = {
  id: 64002,
  schoolId: schoolB.id,
  emailEnabled: true,
  emailProvider: "sendgrid",
  sendgridApiKey: "sendgrid-key-b",
  sendgridFromEmail: "recovery-b@example.test",
  sendgridFromName: "School B",
} as any;

type RouteHarness = {
  server: Server;
  baseUrl: string;
  sendRecoveryEmail: ReturnType<typeof vi.fn>;
  invalidateChallenges: ReturnType<typeof vi.fn>;
  verifyOtp: ReturnType<typeof vi.fn>;
  createChallenge: ReturnType<typeof vi.fn>;
  resetPassword: ReturnType<typeof vi.fn>;
  invalidateUserSessionsStrict: ReturnType<typeof vi.fn>;
  stop: () => Promise<void>;
};

function challenge(
  schoolId: number,
  userId: number,
  teacherId: number,
  otp: string,
): TeacherPasswordRecoveryChallenge {
  return {
    teacherId,
    otp,
    resetToken: "unused-in-step-6",
    challenge: {
      id: userId + 1000,
      userId,
      schoolId,
      otpHash: "server-hash",
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      resetTokenHash: "server-reset-hash",
      resetTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      attemptCount: 0,
      verifiedAt: null,
      consumedAt: null,
      createdAt: new Date(),
      requestIp: "127.0.0.1",
    },
  };
}

function accountFor(email: string, schoolId: number) {
  if (email === inactiveEmail || email === nonTeacherEmail) return null;
  if (
    schoolId === schoolA.id
    && (email === sharedEmail || email === schoolAOnlyEmail)
  ) {
    return { ...accountA, otp: otpA };
  }
  if (
    schoolId === schoolB.id
    && (email === sharedEmail || email === schoolBOnlyEmail)
  ) {
    return { ...accountB, otp: otpB };
  }
  return null;
}

async function makeHarness(options?: {
  missingConfigSchoolId?: number;
  providerFailureSchoolId?: number;
  mismatchedChallengeForSchoolId?: number;
  mismatchedConfigForSchoolId?: number;
  limiter?: PasswordRecoveryRateLimiter;
}): Promise<RouteHarness> {
  const sendRecoveryEmail = vi.fn(async (config: any) => {
    if (config.schoolId === options?.providerFailureSchoolId) {
      throw new Error(`Provider rejected ${config.sendgridApiKey}`);
    }
  });
  const invalidateChallenges = vi.fn(async () => undefined);
  const createChallenge = vi.fn(async (
    email: string,
    schoolId: number,
    _requestIp: string | null,
  ) => {
    const account = accountFor(email, schoolId);
    if (!account) return null;
    const challengeSchoolId = schoolId === options?.mismatchedChallengeForSchoolId
      ? schoolB.id
      : schoolId;
    return challenge(
      challengeSchoolId,
      account.userId,
      account.teacherId,
      account.otp,
    );
  });
  const verifyOtp = vi.fn(async (
    challengeId: number,
    userId: number,
    schoolId: number,
    otp: string,
  ) => {
    const expected = schoolId === schoolA.id
      ? { challengeId: accountA.userId + 1000, userId: accountA.userId, otp: otpA, token: resetTokenA }
      : { challengeId: accountB.userId + 1000, userId: accountB.userId, otp: otpB, token: resetTokenB };
    return challengeId === expected.challengeId
      && userId === expected.userId
      && otp === expected.otp
      ? { success: true as const, resetToken: expected.token }
      : { success: false as const };
  });
  const resetPassword = vi.fn(async () => true);
  const invalidateUserSessionsStrict = vi.fn(async () => undefined);

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "teacher-http-recovery-test-secret",
    resave: false,
    saveUninitialized: false,
  }));
  registerTeacherPasswordRecoveryRoutes(app, {
    getSchoolByCode: async code => {
      if (code === schoolA.code) return schoolA;
      if (code === schoolB.code) return schoolB;
      return undefined;
    },
    createChallenge,
    getNotificationConfig: async schoolId => {
      if (schoolId === options?.missingConfigSchoolId) return null;
      if (schoolId === options?.mismatchedConfigForSchoolId) return configB;
      if (schoolId === schoolA.id) return configA;
      if (schoolId === schoolB.id) return configB;
      return null;
    },
    sendRecoveryEmail,
    invalidateChallenges,
    verifyOtp: verifyOtp as any,
    resetPassword,
    invalidateUserSessionsStrict,
    rateLimiter: options?.limiter ?? new PasswordRecoveryRateLimiter(1000),
  });
  app.get("/test/session", (req, res) => {
    res.json({
      recovery: req.session.teacherPasswordRecovery ?? null,
      auth: {
        userId: req.session.userId,
        teacherId: req.session.teacherId,
        schoolId: req.session.schoolId,
        userRole: req.session.userRole,
      },
      admin: {
        pendingForgotChallengeId: req.session.pendingForgotChallengeId,
        pendingResetToken: req.session.pendingResetToken,
      },
    });
  });
  app.post("/test/admin-state", (req, res) => {
    req.session.pendingForgotChallengeId = 70001;
    req.session.pendingResetToken = "admin-reset-token";
    res.json({ ok: true });
  });
  app.post("/test/auth-state", (req, res) => {
    req.session.userId = req.body.userId ?? 71001;
    req.session.teacherId = req.body.teacherId ?? 72001;
    req.session.schoolId = req.body.schoolId ?? 73001;
    req.session.userRole = "teacher";
    res.json({ ok: true });
  });
  app.post("/test/recovery-state", (req, res) => {
    req.session.teacherPasswordRecovery = req.body.recovery;
    res.json({ ok: true });
  });

  const server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    sendRecoveryEmail,
    invalidateChallenges,
    verifyOtp,
    createChallenge,
    resetPassword,
    invalidateUserSessionsStrict,
    stop: () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    ),
  };
}

async function request(
  harness: RouteHarness,
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

function expectGenericForgot(result: Awaited<ReturnType<typeof request>>) {
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ message: PASSWORD_RECOVERY_GENERIC_MESSAGE });
  for (const key of [
    "otp",
    "resetToken",
    "challengeId",
    "teacherId",
    "userId",
    "schoolId",
    "provider",
    "providerError",
  ]) {
    expect(result.body).not.toHaveProperty(key);
  }
}

const openHarnesses: RouteHarness[] = [];

beforeEach(() => {
  openHarnesses.length = 0;
});

afterEach(async () => {
  await Promise.all(openHarnesses.map(harness => harness.stop()));
  vi.restoreAllMocks();
});

async function harness(options?: Parameters<typeof makeHarness>[0]) {
  const created = await makeHarness(options);
  openHarnesses.push(created);
  return created;
}

describe("Teacher password recovery HTTP boundary", () => {
  it("creates tenant-bound OTP_PENDING sessions and uses each school's provider configuration", async () => {
    const app = await harness();
    const a = await request(app, "/api/teacher/forgot-password", "POST", {
      schoolCode: " school-a ",
      email: sharedEmail,
      schoolId: schoolB.id,
      tenantId: schoolB.id,
      teacherId: accountB.teacherId,
      userId: accountB.userId,
      challengeId: 999999,
      otp: otpB,
      resetToken: "browser-token",
    });
    expectGenericForgot(a);
    const aSession = await request(app, "/test/session", "GET", undefined, a.cookie);
    expect(aSession.body.recovery).toMatchObject({
      flow: "teacher_password_recovery",
      stage: "otp_pending",
      challengeId: accountA.userId + 1000,
      userId: accountA.userId,
      schoolId: schoolA.id,
      teacherId: accountA.teacherId,
    });
    expect(aSession.body.recovery).not.toHaveProperty("resetToken");
    expect(app.sendRecoveryEmail).toHaveBeenNthCalledWith(1, configA, sharedEmail, otpA);

    const b = await request(app, "/api/teacher/forgot-password", "POST", {
      schoolCode: "school-b",
      email: sharedEmail,
    });
    expectGenericForgot(b);
    const bSession = await request(app, "/test/session", "GET", undefined, b.cookie);
    expect(bSession.body.recovery).toMatchObject({
      challengeId: accountB.userId + 1000,
      userId: accountB.userId,
      schoolId: schoolB.id,
      teacherId: accountB.teacherId,
    });
    expect(app.sendRecoveryEmail).toHaveBeenNthCalledWith(2, configB, sharedEmail, otpB);
    expect(app.sendRecoveryEmail.mock.calls[0][0]).not.toBe(configB);
    expect(app.sendRecoveryEmail.mock.calls[1][0]).not.toBe(configA);
  });

  it.each([
    ["invalid school", { schoolCode: "missing", email: schoolAOnlyEmail }],
    ["cross-school email", { schoolCode: schoolA.code, email: schoolBOnlyEmail }],
    ["inactive Teacher", { schoolCode: schoolA.code, email: inactiveEmail }],
    ["non-Teacher account", { schoolCode: schoolA.code, email: nonTeacherEmail }],
    ["malformed body", { schoolCode: "", email: "not-an-email" }],
  ])("returns the same generic response for %s", async (_label, body) => {
    const app = await harness();
    const result = await request(app, "/api/teacher/forgot-password", "POST", body);
    expectGenericForgot(result);
    expect(app.sendRecoveryEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["missing tenant configuration", { missingConfigSchoolId: schoolA.id }],
    ["provider failure", { providerFailureSchoolId: schoolA.id }],
    ["cross-tenant notification configuration", { mismatchedConfigForSchoolId: schoolA.id }],
  ])("hides %s and clears unusable recovery state", async (_label, options) => {
    const app = await harness(options);
    const result = await request(app, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: schoolAOnlyEmail,
    });
    expectGenericForgot(result);
    const current = await request(app, "/test/session", "GET", undefined, result.cookie);
    expect(current.body.recovery).toBeNull();
    expect(app.invalidateChallenges).toHaveBeenCalledWith(accountA.userId, schoolA.id);
    if (options.missingConfigSchoolId) expect(app.sendRecoveryEmail).not.toHaveBeenCalled();
    if (options.mismatchedConfigForSchoolId) expect(app.sendRecoveryEmail).not.toHaveBeenCalled();
  });

  it("rejects an inconsistent cross-tenant challenge before session creation or email delivery", async () => {
    const app = await harness({ mismatchedChallengeForSchoolId: schoolA.id });
    const result = await request(app, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: schoolAOnlyEmail,
    });
    expectGenericForgot(result);
    const current = await request(app, "/test/session", "GET", undefined, result.cookie);
    expect(current.body.recovery).toBeNull();
    expect(app.sendRecoveryEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed body", { schoolCode: "", email: "bad" }],
    ["invalid school", { schoolCode: "missing", email: schoolAOnlyEmail }],
    ["missing account", { schoolCode: schoolA.code, email: schoolBOnlyEmail }],
  ])("clears stale recovery state before a new %s attempt", async (_label, nextBody) => {
    const app = await harness();
    const started = await request(app, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: schoolAOnlyEmail,
    });
    const next = await request(
      app,
      "/api/teacher/forgot-password",
      "POST",
      nextBody,
      started.cookie,
    );
    const current = await request(app, "/test/session", "GET", undefined, next.cookie);
    expect(current.body.recovery).toBeNull();
  });

  it("fails OTP verification generically without an OTP_PENDING session", async () => {
    const app = await harness();
    const result = await request(app, "/api/teacher/verify-otp", "POST", { otp: otpA });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    expect(app.verifyOtp).not.toHaveBeenCalled();
  });

  it("uses only School A session identity and keeps the fresh reset token server-side", async () => {
    const app = await harness();
    const forgot = await request(app, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: sharedEmail,
    });
    const verified = await request(app, "/api/teacher/verify-otp", "POST", {
      otp: otpA,
      schoolId: schoolB.id,
      tenantId: schoolB.id,
      userId: accountB.userId,
      teacherId: accountB.teacherId,
      challengeId: accountB.userId + 1000,
      resetToken: "browser-token",
      email: schoolBOnlyEmail,
      schoolCode: schoolB.code,
    }, forgot.cookie);

    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ success: true, message: "Verification successful." });
    expect(JSON.stringify(verified.body)).not.toMatch(
      /resetToken|challengeId|teacherId|userId|schoolId/i,
    );
    expect(app.verifyOtp).toHaveBeenCalledWith(
      accountA.userId + 1000,
      accountA.userId,
      schoolA.id,
      otpA,
    );
    const current = await request(app, "/test/session", "GET", undefined, forgot.cookie);
    expect(current.body.recovery).toMatchObject({
      stage: "password_reset",
      challengeId: accountA.userId + 1000,
      userId: accountA.userId,
      schoolId: schoolA.id,
      teacherId: accountA.teacherId,
      resetToken: resetTokenA,
    });
  });

  it("does not advance recovery state for wrong or malformed OTPs", async () => {
    const app = await harness();
    const forgot = await request(app, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: schoolAOnlyEmail,
    });
    const wrong = await request(app, "/api/teacher/verify-otp", "POST", {
      otp: "999999",
    }, forgot.cookie);
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    let current = await request(app, "/test/session", "GET", undefined, forgot.cookie);
    expect(current.body.recovery.stage).toBe("otp_pending");

    const malformed = await request(app, "/api/teacher/verify-otp", "POST", {
      otp: "123",
      challengeId: accountB.userId + 1000,
    }, forgot.cookie);
    expect(malformed.status).toBe(400);
    current = await request(app, "/test/session", "GET", undefined, forgot.cookie);
    expect(current.body.recovery.stage).toBe("otp_pending");
  });

  it("rejects expired and wrong-stage sessions before calling OTP verification", async () => {
    const app = await harness();
    const expired = {
      flow: "teacher_password_recovery",
      stage: "otp_pending",
      challengeId: accountA.userId + 1000,
      userId: accountA.userId,
      schoolId: schoolA.id,
      teacherId: accountA.teacherId,
      createdAt: Date.now() - 31 * 60 * 1000,
      updatedAt: Date.now() - 31 * 60 * 1000,
    };
    const seeded = await request(app, "/test/recovery-state", "POST", { recovery: expired });
    const expiredResult = await request(app, "/api/teacher/verify-otp", "POST", {
      otp: otpA,
    }, seeded.cookie);
    expect(expiredResult.status).toBe(400);
    expect(app.verifyOtp).not.toHaveBeenCalled();

    const wrongStage = {
      ...expired,
      stage: "password_reset",
      resetToken: resetTokenA,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const reseeded = await request(
      app,
      "/test/recovery-state",
      "POST",
      { recovery: wrongStage },
      seeded.cookie,
    );
    const wrongStageResult = await request(app, "/api/teacher/verify-otp", "POST", {
      otp: otpA,
    }, reseeded.cookie);
    expect(wrongStageResult.status).toBe(400);
    expect(app.verifyOtp).not.toHaveBeenCalled();
  });

  it("never bypasses the Step 4 verifier's five-attempt authority", async () => {
    const app = await harness();
    let attempts = 0;
    app.verifyOtp.mockImplementation(async () => {
      attempts += 1;
      return { success: false };
    });
    const forgot = await request(app, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: schoolAOnlyEmail,
    });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await request(app, "/api/teacher/verify-otp", "POST", {
        otp: "999999",
      }, forgot.cookie);
      expect(result.status).toBe(400);
    }
    expect(attempts).toBe(6);
    const current = await request(app, "/test/session", "GET", undefined, forgot.cookie);
    expect(current.body.recovery.stage).toBe("otp_pending");
  });

  it("leaves Admin recovery and normal authentication session fields untouched", async () => {
    const app = await harness();
    const admin = await request(app, "/test/admin-state", "POST", {});
    const auth = await request(app, "/test/auth-state", "POST", {}, admin.cookie);
    const forgot = await request(app, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: schoolAOnlyEmail,
    }, auth.cookie);
    const verified = await request(app, "/api/teacher/verify-otp", "POST", {
      otp: otpA,
    }, forgot.cookie);
    expect(verified.status).toBe(200);

    const current = await request(app, "/test/session", "GET", undefined, forgot.cookie);
    expect(current.body.admin).toEqual({
      pendingForgotChallengeId: 70001,
      pendingResetToken: "admin-reset-token",
    });
    expect(current.body.auth).toEqual({
      userId: 71001,
      teacherId: 72001,
      schoolId: 73001,
      userRole: "teacher",
    });
  });

  it("applies the existing recovery limiter convention to both endpoints", async () => {
    const forgotApp = await harness({ limiter: new PasswordRecoveryRateLimiter(1) });
    const first = await request(forgotApp, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: schoolAOnlyEmail,
    });
    expectGenericForgot(first);
    const second = await request(forgotApp, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: schoolAOnlyEmail,
    });
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ message: PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE });
    const cleared = await request(forgotApp, "/test/session", "GET", undefined, second.cookie);
    expect(cleared.body.recovery).toBeNull();

    const verifyApp = await harness({ limiter: new PasswordRecoveryRateLimiter(1) });
    const missing = await request(verifyApp, "/api/teacher/verify-otp", "POST", { otp: otpA });
    expect(missing.status).toBe(400);
    const limited = await request(verifyApp, "/api/teacher/verify-otp", "POST", { otp: otpA });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE });
  });

  it("does not log secrets during successful or failed recovery", async () => {
    const logs = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const app = await harness();
    const forgot = await request(app, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: schoolAOnlyEmail,
    });
    await request(app, "/api/teacher/verify-otp", "POST", { otp: otpA }, forgot.cookie);
    const failedApp = await harness({ providerFailureSchoolId: schoolA.id });
    await request(failedApp, "/api/teacher/forgot-password", "POST", {
      schoolCode: schoolA.code,
      email: schoolAOnlyEmail,
    });
    const serializedLogs = JSON.stringify(logs.flatMap(spy => spy.mock.calls));
    expect(serializedLogs).not.toContain(otpA);
    expect(serializedLogs).not.toContain(resetTokenA);
    expect(serializedLogs).not.toContain("unused-in-step-6");
    expect(serializedLogs).not.toContain(configA.sendgridApiKey);
    expect(serializedLogs).not.toContain("Provider rejected");
  });

  it.each([
    ["missing newPassword", { confirmPassword: "valid-password" }],
    ["missing confirmPassword", { newPassword: "valid-password" }],
    ["non-string password", { newPassword: 123456, confirmPassword: 123456 }],
    ["mismatched passwords", { newPassword: "valid-password", confirmPassword: "different-password" }],
    ["password below policy", { newPassword: "short", confirmPassword: "short" }],
  ])("rejects %s without consuming PASSWORD_RESET state", async (_label, body) => {
    const app = await harness();
    const now = Date.now();
    const recovery = {
      flow: "teacher_password_recovery",
      stage: "password_reset",
      challengeId: accountA.userId + 1000,
      userId: accountA.userId,
      schoolId: schoolA.id,
      teacherId: accountA.teacherId,
      resetToken: resetTokenA,
      createdAt: now,
      updatedAt: now,
    };
    const seeded = await request(app, "/test/recovery-state", "POST", { recovery });
    const result = await request(app, "/api/teacher/reset-password", "POST", body, seeded.cookie);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ message: "Invalid password reset request." });
    expect(app.resetPassword).not.toHaveBeenCalled();
    const current = await request(app, "/test/session", "GET", undefined, seeded.cookie);
    expect(current.body.recovery).toMatchObject(recovery);
  });

  it("ignores injected identity and token fields, hashes exact Unicode input, then prevents replay", async () => {
    const app = await harness();
    const password = "नया-पासवर्ड-🔐";
    const logs = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const now = Date.now();
    const recovery = {
      flow: "teacher_password_recovery",
      stage: "password_reset",
      challengeId: accountA.userId + 1000,
      userId: accountA.userId,
      schoolId: schoolA.id,
      teacherId: accountA.teacherId,
      resetToken: resetTokenA,
      createdAt: now,
      updatedAt: now,
    };
    const seeded = await request(app, "/test/recovery-state", "POST", { recovery });
    const result = await request(app, "/api/teacher/reset-password", "POST", {
      newPassword: password,
      confirmPassword: password,
      schoolId: schoolB.id,
      tenantId: schoolB.id,
      userId: accountB.userId,
      teacherId: accountB.teacherId,
      challengeId: accountB.userId + 1000,
      resetToken: resetTokenB,
      email: schoolBOnlyEmail,
      schoolCode: schoolB.code,
    }, seeded.cookie);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      message: "Your password has been reset successfully. Please log in again.",
    });
    expect(app.resetPassword).toHaveBeenCalledTimes(1);
    const [challengeId, userId, schoolId, tokenHash, passwordHash] =
      app.resetPassword.mock.calls[0];
    expect({ challengeId, userId, schoolId }).toEqual({
      challengeId: accountA.userId + 1000,
      userId: accountA.userId,
      schoolId: schoolA.id,
    });
    expect(tokenHash).toBe(hashPasswordRecoverySecret(resetTokenA));
    expect(tokenHash).not.toBe(resetTokenA);
    expect(await (await import("bcryptjs")).default.compare(password, passwordHash)).toBe(true);
    expect(app.invalidateUserSessionsStrict).toHaveBeenCalledWith(accountA.userId);
    expect(JSON.stringify(result.body)).not.toContain(password);
    expect(JSON.stringify(result.body)).not.toContain(resetTokenA);
    expect(JSON.stringify(result.body)).not.toContain(passwordHash);
    const serializedLogs = JSON.stringify(logs.flatMap(spy => spy.mock.calls));
    expect(serializedLogs).not.toContain(password);
    expect(serializedLogs).not.toContain(resetTokenA);
    expect(serializedLogs).not.toContain(tokenHash);
    expect(serializedLogs).not.toContain(passwordHash);

    const current = await request(app, "/test/session", "GET", undefined, seeded.cookie);
    expect(current.body.recovery).toBeNull();
    const replay = await request(app, "/api/teacher/reset-password", "POST", {
      newPassword: password,
      confirmPassword: password,
    }, seeded.cookie);
    expect(replay.status).toBe(400);
    expect(app.resetPassword).toHaveBeenCalledTimes(1);
  });

  it("does not report success when strict session invalidation fails", async () => {
    const app = await harness();
    app.invalidateUserSessionsStrict.mockRejectedValueOnce(new Error("session-store unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const auth = await request(app, "/test/auth-state", "POST", {
      userId: accountA.userId,
      teacherId: accountA.teacherId,
      schoolId: schoolA.id,
    });
    const now = Date.now();
    const seeded = await request(app, "/test/recovery-state", "POST", {
      recovery: {
        flow: "teacher_password_recovery",
        stage: "password_reset",
        challengeId: accountA.userId + 1000,
        userId: accountA.userId,
        schoolId: schoolA.id,
        teacherId: accountA.teacherId,
        resetToken: resetTokenA,
        createdAt: now,
        updatedAt: now,
      },
    }, auth.cookie);
    const result = await request(app, "/api/teacher/reset-password", "POST", {
      newPassword: "new-secure-password",
      confirmPassword: "new-secure-password",
    }, seeded.cookie);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      message: "Unable to complete password reset securely. Please contact support.",
    });
    expect(errorLog).toHaveBeenCalled();
    const current = await request(app, "/test/session", "GET", undefined, seeded.cookie);
    expect(current.body.recovery).toBeNull();
    expect(current.body.auth).toEqual({});
  });

  it("invalidates the current affected authenticated session without logging the Teacher back in", async () => {
    const app = await harness();
    const auth = await request(app, "/test/auth-state", "POST", {
      userId: accountA.userId,
      teacherId: accountA.teacherId,
      schoolId: schoolA.id,
    });
    const now = Date.now();
    const seeded = await request(app, "/test/recovery-state", "POST", {
      recovery: {
        flow: "teacher_password_recovery",
        stage: "password_reset",
        challengeId: accountA.userId + 1000,
        userId: accountA.userId,
        schoolId: schoolA.id,
        teacherId: accountA.teacherId,
        resetToken: resetTokenA,
        createdAt: now,
        updatedAt: now,
      },
    }, auth.cookie);
    const result = await request(app, "/api/teacher/reset-password", "POST", {
      newPassword: "new-secure-password",
      confirmPassword: "new-secure-password",
    }, seeded.cookie);
    expect(result.status).toBe(200);
    const current = await request(app, "/test/session", "GET", undefined, seeded.cookie);
    expect(current.body.auth).toEqual({});
    expect(current.body.recovery).toBeNull();
  });

  it("allows exactly one of two concurrent reset requests to succeed", async () => {
    const app = await harness();
    let consumed = false;
    app.resetPassword.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (consumed) return false;
      consumed = true;
      return true;
    });
    const now = Date.now();
    const seeded = await request(app, "/test/recovery-state", "POST", {
      recovery: {
        flow: "teacher_password_recovery",
        stage: "password_reset",
        challengeId: accountA.userId + 1000,
        userId: accountA.userId,
        schoolId: schoolA.id,
        teacherId: accountA.teacherId,
        resetToken: resetTokenA,
        createdAt: now,
        updatedAt: now,
      },
    });
    const body = {
      newPassword: "concurrent-secure-password",
      confirmPassword: "concurrent-secure-password",
    };
    const results = await Promise.all([
      request(app, "/api/teacher/reset-password", "POST", body, seeded.cookie),
      request(app, "/api/teacher/reset-password", "POST", body, seeded.cookie),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 400]);
    expect(app.invalidateUserSessionsStrict).toHaveBeenCalledTimes(1);
  });
});