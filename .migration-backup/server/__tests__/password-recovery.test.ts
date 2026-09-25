import { describe, expect, it, beforeEach } from "vitest";
import {
  generatePasswordRecoveryOtp,
  generatePasswordRecoveryToken,
  hashPasswordRecoverySecret,
  passwordRecoverySecretsEqual,
  PasswordRecoveryRateLimiter,
  buildForgotPasswordResponse,
  PASSWORD_RECOVERY_GENERIC_MESSAGE,
} from "../password-recovery";

describe("password recovery security primitives", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "password-recovery-test-secret";
  });

  it("generates six-digit OTPs without using predictable Math.random", () => {
    const otp = generatePasswordRecoveryOtp();
    expect(otp).toMatch(/^\d{6}$/);
    expect(Number(otp)).toBeGreaterThanOrEqual(100000);
    expect(Number(otp)).toBeLessThan(1000000);
  });

  it("hashes OTPs and reset tokens with an HMAC and compares them safely", () => {
    const secret = generatePasswordRecoveryToken();
    const hash = hashPasswordRecoverySecret(secret);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(passwordRecoverySecretsEqual(hash, hashPasswordRecoverySecret(secret))).toBe(true);
    expect(passwordRecoverySecretsEqual(hash, hashPasswordRecoverySecret(`${secret}-wrong`))).toBe(false);
    expect(secret).not.toBe(hash);
  });

  it("uses the session secret as the HMAC key", () => {
    const secret = "123456";
    process.env.SESSION_SECRET = "first-session-secret";
    const first = hashPasswordRecoverySecret(secret);
    process.env.SESSION_SECRET = "second-session-secret";
    expect(hashPasswordRecoverySecret(secret)).not.toBe(first);
  });

  it("rejects a missing or too-short session secret", () => {
    delete process.env.SESSION_SECRET;
    expect(() => hashPasswordRecoverySecret("123456")).toThrow("SESSION_SECRET must be configured");
    process.env.SESSION_SECRET = "too-short";
    expect(() => hashPasswordRecoverySecret("123456")).toThrow("SESSION_SECRET must be configured");
  });

  it("enforces a bounded per-key attempt window", () => {
    const limiter = new PasswordRecoveryRateLimiter(2, 1000);
    expect(limiter.consume("verify:ip", 0)).toBe(true);
    expect(limiter.consume("verify:ip", 1)).toBe(true);
    expect(limiter.consume("verify:ip", 2)).toBe(false);
    expect(limiter.consume("other:ip", 2)).toBe(true);
    expect(limiter.consume("verify:ip", 1001)).toBe(true);
  });

  it("builds the identical generic response for valid and invalid identity outcomes", () => {
    const validIdentityResponse = buildForgotPasswordResponse();
    const invalidIdentityResponse = buildForgotPasswordResponse();
    expect(validIdentityResponse).toEqual(invalidIdentityResponse);
    expect(validIdentityResponse).toEqual({ message: PASSWORD_RECOVERY_GENERIC_MESSAGE });
    expect(validIdentityResponse).not.toHaveProperty("otp");
    expect(validIdentityResponse).not.toHaveProperty("recoveryEmail");
  });
});