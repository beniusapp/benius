import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationConfig } from "@shared/schema";
import {
  sendPasswordRecoveryEmail,
  sendStudentRecoveryContactVerificationEmail,
} from "../password-recovery-email";

const baseConfig = (overrides: Partial<NotificationConfig> = {}): NotificationConfig => ({
  id: 1,
  schoolId: 1,
  smsEnabled: false,
  msg91AuthKey: null,
  msg91SenderId: null,
  waEnabled: false,
  msg91WaNumber: null,
  msg91WaTemplate: null,
  emailEnabled: true,
  emailProvider: "sendgrid",
  sendgridApiKey: "sendgrid-test-key",
  sendgridFromEmail: "school@example.test",
  sendgridFromName: "School Admin",
  mailtrapApiKey: null,
  mailtrapInboxId: null,
  updatedAt: new Date(),
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("password recovery email sender", () => {
  it("sends a SendGrid payload without rendering the recipient", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendPasswordRecoveryEmail(baseConfig(), "recovery@example.test", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(init.headers.Authorization).toBe("Bearer sendgrid-test-key");
    const body = JSON.parse(init.body);
    expect(body.personalizations[0].to[0].email).toBe("recovery@example.test");
    expect(body.content[0].value).toContain("<strong>123456</strong>");
    expect(body.content[0].value).not.toContain("recovery@example.test");
  });

  it("sends a Mailtrap payload through the configured inbox", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendPasswordRecoveryEmail(
      baseConfig({
        emailProvider: "mailtrap",
        mailtrapApiKey: "mailtrap-test-key",
        mailtrapInboxId: "123",
      }),
      "recovery@example.test",
      "654321",
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.api.mailtrap.io/api/send/123");
    expect(init.headers.Authorization).toBe("Bearer mailtrap-test-key");
    expect(JSON.parse(init.body).to[0].email).toBe("recovery@example.test");
  });

  it("rejects unknown providers and never sends a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendPasswordRecoveryEmail(
      baseConfig({ emailProvider: "smtp" }),
      "recovery@example.test",
      "123456",
    )).rejects.toThrow("Unsupported password recovery email provider");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates provider failures without exposing secret content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("provider details", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendPasswordRecoveryEmail(
      baseConfig(),
      "recovery@example.test",
      "123456",
    )).rejects.toThrow("Password recovery email failed: 500");
    await expect(sendPasswordRecoveryEmail(
      baseConfig(),
      "recovery@example.test",
      "<12345",
    )).rejects.toThrow("Invalid password recovery OTP");
  });
});

describe("Student recovery-contact verification email sender", () => {
  it("uses the tenant SendGrid configuration and verification-specific content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendStudentRecoveryContactVerificationEmail(
      baseConfig(),
      "student@example.test",
      "314159",
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(init.headers.Authorization).toBe("Bearer sendgrid-test-key");
    const body = JSON.parse(init.body);
    expect(body.personalizations[0].to[0].email).toBe("student@example.test");
    expect(body.subject).toBe("Student recovery email verification");
    expect(body.content[0].value).toContain("<strong>314159</strong>");
    expect(body.content[0].value).not.toContain("student@example.test");
  });

  it("uses only the configured Mailtrap inbox and credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendStudentRecoveryContactVerificationEmail(
      baseConfig({
        emailProvider: "mailtrap",
        sendgridApiKey: "must-not-be-used",
        mailtrapApiKey: "student-mailtrap-key",
        mailtrapInboxId: "student-inbox",
      }),
      "student@example.test",
      "271828",
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.api.mailtrap.io/api/send/student-inbox");
    expect(init.headers.Authorization).toBe("Bearer student-mailtrap-key");
    expect(JSON.stringify(init.body)).not.toContain("must-not-be-used");
  });

  it("rejects disabled or incomplete configuration without a provider request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendStudentRecoveryContactVerificationEmail(
      baseConfig({ emailEnabled: false }),
      "student@example.test",
      "123456",
    )).rejects.toThrow("disabled");
    await expect(sendStudentRecoveryContactVerificationEmail(
      baseConfig({ sendgridApiKey: null }),
      "student@example.test",
      "123456",
    )).rejects.toThrow("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never includes provider response bodies or credentials in thrown errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("sensitive provider body", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    let error: Error | undefined;
    try {
      await sendStudentRecoveryContactVerificationEmail(
        baseConfig({ sendgridApiKey: "secret-provider-key" }),
        "student@example.test",
        "123456",
      );
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).toBe("Student recovery contact verification email failed: 500");
    expect(error?.message).not.toContain("sensitive provider body");
    expect(error?.message).not.toContain("secret-provider-key");
  });
});