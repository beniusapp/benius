import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const PASSWORD_RECOVERY_GENERIC_MESSAGE =
  "If those details match, an OTP has been sent to your recovery email. Please check and try again.";
export const PASSWORD_RECOVERY_INVALID_MESSAGE = "Invalid or expired OTP. Please request a new OTP.";
export const PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE = "Too many recovery attempts. Please try again later.";

export function buildForgotPasswordResponse(): { message: string } {
  return { message: PASSWORD_RECOVERY_GENERIC_MESSAGE };
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be configured with at least 16 characters for password recovery");
  }
  return secret;
}

export function generatePasswordRecoveryOtp(): string {
  return String(randomInt(100000, 1000000));
}

export function generatePasswordRecoveryToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashPasswordRecoverySecret(secret: string): string {
  return createHmac("sha256", sessionSecret()).update(secret).digest("hex");
}

export function passwordRecoverySecretsEqual(expectedHash: string, actualHash: string): boolean {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

type RateLimitEntry = { startedAt: number; count: number };

export class PasswordRecoveryRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  consume(key: string, now = Date.now()): boolean {
    const existing = this.entries.get(key);
    if (!existing || now - existing.startedAt >= this.windowMs) {
      this.entries.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (existing.count >= this.maxAttempts) return false;
    existing.count += 1;
    return true;
  }

  clear(): void {
    this.entries.clear();
  }
}