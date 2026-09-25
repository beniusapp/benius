import { storage } from "./storage";
import type { PasswordResetChallenge } from "@workspace/db";
import {
  generatePasswordRecoveryOtp,
  generatePasswordRecoveryToken,
  hashPasswordRecoverySecret,
} from "./password-recovery-crypto";
export {
  generatePasswordRecoveryOtp,
  generatePasswordRecoveryToken,
  hashPasswordRecoverySecret,
  passwordRecoverySecretsEqual,
} from "./password-recovery-crypto";

export const PASSWORD_RECOVERY_GENERIC_MESSAGE =
  "If those details match, an OTP has been sent to your recovery email. Please check and try again.";
export const PASSWORD_RECOVERY_INVALID_MESSAGE = "Invalid or expired OTP. Please request a new OTP.";
export const PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE = "Too many recovery attempts. Please try again later.";

export function buildForgotPasswordResponse(): { message: string } {
  return { message: PASSWORD_RECOVERY_GENERIC_MESSAGE };
}

export type TeacherPasswordRecoveryChallenge = {
  challenge: PasswordResetChallenge;
  teacherId: number;
  otp: string;
  resetToken: string;
};

export async function createTeacherPasswordRecoveryChallenge(
  email: string,
  schoolId: number,
  requestIp: string | null,
  now = new Date(),
): Promise<TeacherPasswordRecoveryChallenge | null> {
  const account = await storage.getTeacherUserByEmailAndSchool(email, schoolId);
  if (!account || !account.teacher.isActive) return null;

  const otp = generatePasswordRecoveryOtp();
  const resetToken = generatePasswordRecoveryToken();
  const challenge = await storage.createTeacherPasswordResetChallenge(
    account.user.id,
    account.teacher.id,
    schoolId,
    hashPasswordRecoverySecret(otp),
    new Date(now.getTime() + 10 * 60 * 1000),
    hashPasswordRecoverySecret(resetToken),
    new Date(now.getTime() + 15 * 60 * 1000),
    requestIp,
    now,
  );
  if (!challenge) return null;
  return { challenge, teacherId: account.teacher.id, otp, resetToken };
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

export const passwordRecoveryRateLimiter = new PasswordRecoveryRateLimiter();