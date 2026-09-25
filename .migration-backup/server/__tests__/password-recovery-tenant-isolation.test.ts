import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { storage } from "../storage";
import { PASSWORD_RECOVERY_GENERIC_MESSAGE } from "../password-recovery";

const MIS = {
  school: { id: 41001, code: "MIS", name: "Mary Immaculate School" },
  user: {
    id: 42001,
    schoolId: 41001,
    role: "admin",
    isActive: true,
    recoveryEmail: "mary-test@example.test",
  },
  config: {
    id: 43001,
    schoolId: 41001,
    emailEnabled: true,
    emailProvider: "sendgrid",
    sendgridApiKey: "fake-MIS-key",
    sendgridFromEmail: "mary@example.test",
    sendgridFromName: "Mary School Admin",
  },
} as const;

const PPS = {
  school: { id: 41002, code: "PPS", name: "Prabha Public School" },
  user: {
    id: 42002,
    schoolId: 41002,
    role: "admin",
    isActive: true,
    recoveryEmail: "prabha-test@example.test",
  },
  config: {
    id: 43002,
    schoolId: 41002,
    emailEnabled: true,
    emailProvider: "sendgrid",
    sendgridApiKey: "fake-PPS-key",
    sendgridFromEmail: "prabha@example.test",
    sendgridFromName: "Prabha School Admin",
  },
} as const;

const SHARED_EMAIL = "shared-test@example.test";
const sharedMisUser = { ...MIS.user, id: 42003, recoveryEmail: SHARED_EMAIL };
const sharedPpsUser = { ...PPS.user, id: 42004, recoveryEmail: SHARED_EMAIL };

let server: http.Server;
let baseUrl = "";
let missingMisConfiguration = false;
const nativeFetch = globalThis.fetch;

const schoolSpy = vi.spyOn(storage, "getSchoolByCode");
const userSpy = vi.spyOn(storage, "getUserByRecoveryEmail");
const challengeSpy = vi.spyOn(storage, "createPasswordResetChallenge");
const configSpy = vi.spyOn(storage, "getNotificationConfig");
const invalidateSpy = vi.spyOn(storage, "invalidatePasswordResetChallenges");
const providerFetch = vi.fn();

function userFor(recoveryEmail: string, schoolId: number) {
  if (schoolId === MIS.school.id) {
    if (recoveryEmail === MIS.user.recoveryEmail) return MIS.user;
    if (recoveryEmail === SHARED_EMAIL) return sharedMisUser;
  }
  if (schoolId === PPS.school.id) {
    if (recoveryEmail === PPS.user.recoveryEmail) return PPS.user;
    if (recoveryEmail === SHARED_EMAIL) return sharedPpsUser;
  }
  return undefined;
}

async function postForgotPassword(body: Record<string, unknown>) {
  const response = await nativeFetch(`${baseUrl}/api/admin/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function postTestEmail(
  schoolId: number,
  body: Record<string, unknown>,
) {
  const response = await nativeFetch(`${baseUrl}/api/admin/fees/notification-config/test`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-admin-school-id": String(schoolId),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function waitForProviderCalls(count: number) {
  await vi.waitFor(() => expect(providerFetch).toHaveBeenCalledTimes(count));
}

function providerRequest(index = 0) {
  const [url, init] = providerFetch.mock.calls[index] as [string, RequestInit];
  return {
    url,
    authorization: (init.headers as Record<string, string>).Authorization,
    payload: JSON.parse(String(init.body)),
  };
}

function expectGenericResponse(result: Awaited<ReturnType<typeof postForgotPassword>>) {
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ message: PASSWORD_RECOVERY_GENERIC_MESSAGE });
  expect(result.body).not.toHaveProperty("userId");
  expect(result.body).not.toHaveProperty("schoolId");
  expect(result.body).not.toHaveProperty("recoveryEmail");
}

beforeAll(async () => {
  process.env.SESSION_SECRET = "tenant-isolation-test-session-secret";

  schoolSpy.mockImplementation(async code => {
    if (code === MIS.school.code) return MIS.school as any;
    if (code === PPS.school.code) return PPS.school as any;
    return undefined;
  });
  userSpy.mockImplementation(async (recoveryEmail, schoolId) =>
    userFor(recoveryEmail, schoolId) as any
  );
  challengeSpy.mockImplementation(async (userId, schoolId, otpHash, otpExpiresAt, requestIp) => ({
    id: userId + 1000,
    userId,
    schoolId,
    otpHash,
    otpExpiresAt,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
    attemptCount: 0,
    verifiedAt: null,
    consumedAt: null,
    createdAt: new Date(),
    requestIp,
  }));
  configSpy.mockImplementation(async schoolId => {
    if (schoolId === MIS.school.id) {
      if (missingMisConfiguration) return null;
      return MIS.config as any;
    }
    if (schoolId === PPS.school.id) return PPS.config as any;
    return null;
  });
  invalidateSpy.mockResolvedValue();

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const adminSchoolId = Number(req.headers["x-test-admin-school-id"] ?? 0);
    req.session = adminSchoolId
      ? { userId: 99001, userRole: "admin", schoolId: adminSchoolId }
      : {};
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
}, 30_000);

beforeEach(() => {
  missingMisConfiguration = false;
  providerFetch.mockReset();
  providerFetch.mockResolvedValue(new Response("", { status: 202 }));
  vi.stubGlobal("fetch", providerFetch);
  schoolSpy.mockClear();
  userSpy.mockClear();
  challengeSpy.mockClear();
  configSpy.mockClear();
  invalidateSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.restoreAllMocks();
});

describe("Forgot Password HTTP tenant isolation", () => {
  it("uses only the MIS user and SendGrid configuration for a valid MIS request", async () => {
    const result = await postForgotPassword({
      recoveryEmail: MIS.user.recoveryEmail,
      schoolCode: MIS.school.code,
    });
    expectGenericResponse(result);
    await waitForProviderCalls(1);

    expect(userSpy).toHaveBeenCalledWith(MIS.user.recoveryEmail, MIS.school.id);
    expect(challengeSpy).toHaveBeenCalledWith(
      MIS.user.id,
      MIS.school.id,
      expect.any(String),
      expect.any(Date),
      expect.anything(),
    );
    expect(configSpy).toHaveBeenCalledTimes(1);
    expect(configSpy).toHaveBeenCalledWith(MIS.school.id);
    expect(configSpy).not.toHaveBeenCalledWith(PPS.school.id);

    const request = providerRequest();
    expect(request.url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(request.authorization).toBe(`Bearer ${MIS.config.sendgridApiKey}`);
    expect(request.authorization).not.toBe(`Bearer ${PPS.config.sendgridApiKey}`);
    expect(request.payload.from).toEqual({
      email: MIS.config.sendgridFromEmail,
      name: MIS.config.sendgridFromName,
    });
    expect(request.payload.personalizations[0].to[0].email).toBe(MIS.user.recoveryEmail);
  });

  it("uses only the PPS user and SendGrid configuration for a valid PPS request", async () => {
    const result = await postForgotPassword({
      recoveryEmail: PPS.user.recoveryEmail,
      schoolCode: PPS.school.code,
    });
    expectGenericResponse(result);
    await waitForProviderCalls(1);

    expect(userSpy).toHaveBeenCalledWith(PPS.user.recoveryEmail, PPS.school.id);
    expect(challengeSpy).toHaveBeenCalledWith(
      PPS.user.id,
      PPS.school.id,
      expect.any(String),
      expect.any(Date),
      expect.anything(),
    );
    expect(configSpy).toHaveBeenCalledTimes(1);
    expect(configSpy).toHaveBeenCalledWith(PPS.school.id);
    expect(configSpy).not.toHaveBeenCalledWith(MIS.school.id);

    const request = providerRequest();
    expect(request.authorization).toBe(`Bearer ${PPS.config.sendgridApiKey}`);
    expect(request.authorization).not.toBe(`Bearer ${MIS.config.sendgridApiKey}`);
    expect(request.payload.from).toEqual({
      email: PPS.config.sendgridFromEmail,
      name: PPS.config.sendgridFromName,
    });
    expect(request.payload.personalizations[0].to[0].email).toBe(PPS.user.recoveryEmail);
  });

  it("does not resolve PPS data when the MIS code is paired with the PPS email", async () => {
    const result = await postForgotPassword({
      recoveryEmail: PPS.user.recoveryEmail,
      schoolCode: MIS.school.code,
    });
    expectGenericResponse(result);

    expect(userSpy).toHaveBeenCalledWith(PPS.user.recoveryEmail, MIS.school.id);
    expect(userSpy).not.toHaveBeenCalledWith(PPS.user.recoveryEmail, PPS.school.id);
    expect(challengeSpy).not.toHaveBeenCalled();
    expect(configSpy).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("does not resolve MIS data when the PPS code is paired with the MIS email", async () => {
    const result = await postForgotPassword({
      recoveryEmail: MIS.user.recoveryEmail,
      schoolCode: PPS.school.code,
    });
    expectGenericResponse(result);

    expect(userSpy).toHaveBeenCalledWith(MIS.user.recoveryEmail, PPS.school.id);
    expect(userSpy).not.toHaveBeenCalledWith(MIS.user.recoveryEmail, MIS.school.id);
    expect(challengeSpy).not.toHaveBeenCalled();
    expect(configSpy).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("selects the correct tenant when the same recovery email exists in both schools", async () => {
    const misResult = await postForgotPassword({
      recoveryEmail: SHARED_EMAIL,
      schoolCode: MIS.school.code,
    });
    expectGenericResponse(misResult);
    await waitForProviderCalls(1);
    expect(userSpy).toHaveBeenNthCalledWith(1, SHARED_EMAIL, MIS.school.id);
    expect(configSpy).toHaveBeenNthCalledWith(1, MIS.school.id);
    expect(providerRequest(0).authorization).toBe(`Bearer ${MIS.config.sendgridApiKey}`);

    const ppsResult = await postForgotPassword({
      recoveryEmail: SHARED_EMAIL,
      schoolCode: PPS.school.code,
    });
    expectGenericResponse(ppsResult);
    await waitForProviderCalls(2);
    expect(userSpy).toHaveBeenNthCalledWith(2, SHARED_EMAIL, PPS.school.id);
    expect(configSpy).toHaveBeenNthCalledWith(2, PPS.school.id);
    expect(providerRequest(1).authorization).toBe(`Bearer ${PPS.config.sendgridApiKey}`);
  });

  it("ignores conflicting client-supplied schoolId and tenantId fields", async () => {
    const result = await postForgotPassword({
      recoveryEmail: MIS.user.recoveryEmail,
      schoolCode: MIS.school.code,
      schoolId: PPS.school.id,
      tenantId: PPS.school.id,
    });
    expectGenericResponse(result);
    await waitForProviderCalls(1);

    expect(userSpy).toHaveBeenCalledWith(MIS.user.recoveryEmail, MIS.school.id);
    expect(configSpy).toHaveBeenCalledTimes(1);
    expect(configSpy).toHaveBeenCalledWith(MIS.school.id);
    expect(configSpy).not.toHaveBeenCalledWith(PPS.school.id);
    expect(providerRequest().authorization).toBe(`Bearer ${MIS.config.sendgridApiKey}`);
  });

  it("returns the generic response without tenant lookups for an invalid school code", async () => {
    const result = await postForgotPassword({
      recoveryEmail: MIS.user.recoveryEmail,
      schoolCode: "NOT-A-REAL-SCHOOL",
    });
    expectGenericResponse(result);

    expect(userSpy).not.toHaveBeenCalled();
    expect(challengeSpy).not.toHaveBeenCalled();
    expect(configSpy).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("returns the generic response without sending for a valid school and foreign email", async () => {
    const result = await postForgotPassword({
      recoveryEmail: "does-not-belong-to-MIS@example.test",
      schoolCode: MIS.school.code,
    });
    expectGenericResponse(result);

    expect(userSpy).toHaveBeenCalledWith("does-not-belong-to-MIS@example.test", MIS.school.id);
    expect(challengeSpy).not.toHaveBeenCalled();
    expect(configSpy).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("does not fall back to another tenant when MIS has no notification configuration", async () => {
    missingMisConfiguration = true;
    const result = await postForgotPassword({
      recoveryEmail: MIS.user.recoveryEmail,
      schoolCode: MIS.school.code,
    });
    expectGenericResponse(result);
    await vi.waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(MIS.user.id, MIS.school.id)
    );

    expect(configSpy).toHaveBeenCalledTimes(1);
    expect(configSpy).toHaveBeenCalledWith(MIS.school.id);
    expect(configSpy).not.toHaveBeenCalledWith(PPS.school.id);
    expect(providerFetch).not.toHaveBeenCalled();
  });
});

describe("Test Send HTTP tenant isolation", () => {
  it("binds Test Send to the authenticated school and ignores client tenant overrides", async () => {
    const misResult = await postTestEmail(MIS.school.id, {
      channel: "email",
      recipient: "mis-test-recipient@example.test",
      schoolId: PPS.school.id,
      tenantId: PPS.school.id,
    });
    expect(misResult).toEqual({ status: 200, body: { ok: true } });
    expect(configSpy).toHaveBeenNthCalledWith(1, MIS.school.id);
    expect(providerRequest(0).authorization).toBe(`Bearer ${MIS.config.sendgridApiKey}`);
    expect(providerRequest(0).payload.from.email).toBe(MIS.config.sendgridFromEmail);

    const ppsResult = await postTestEmail(PPS.school.id, {
      channel: "email",
      recipient: "pps-test-recipient@example.test",
      schoolId: MIS.school.id,
      tenantId: MIS.school.id,
    });
    expect(ppsResult).toEqual({ status: 200, body: { ok: true } });
    expect(configSpy).toHaveBeenNthCalledWith(2, PPS.school.id);
    expect(providerRequest(1).authorization).toBe(`Bearer ${PPS.config.sendgridApiKey}`);
    expect(providerRequest(1).payload.from.email).toBe(PPS.config.sendgridFromEmail);
  });
});