import type { Express } from "express";
import { z } from "zod/v4";
import bcrypt from "bcryptjs";
import type { NotificationConfig } from "@workspace/db";
import { storage } from "./storage";
import {
  buildForgotPasswordResponse,
  createTeacherPasswordRecoveryChallenge,
  PASSWORD_RECOVERY_INVALID_MESSAGE,
  PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE,
  PasswordRecoveryRateLimiter,
  hashPasswordRecoverySecret,
  type TeacherPasswordRecoveryChallenge,
} from "./password-recovery";
import { sendPasswordRecoveryEmail } from "./password-recovery-email";
import { verifyTeacherPasswordRecoveryOtp } from "./teacher-password-recovery";
import {
  clearTeacherPasswordRecoverySession,
  getTeacherPasswordRecoverySession,
  markTeacherPasswordRecoveryVerified,
  startTeacherPasswordRecoverySession,
} from "./teacher-password-recovery-session";

type RecoveryRouteDependencies = {
  getSchoolByCode: (code: string) => Promise<{ id: number } | undefined>;
  createChallenge: (
    email: string,
    schoolId: number,
    requestIp: string | null,
  ) => Promise<TeacherPasswordRecoveryChallenge | null>;
  getNotificationConfig: (schoolId: number) => Promise<NotificationConfig | null>;
  sendRecoveryEmail: (
    config: NotificationConfig,
    recipient: string,
    otp: string,
  ) => Promise<void>;
  invalidateChallenges: (userId: number, schoolId: number) => Promise<void>;
  verifyOtp: typeof verifyTeacherPasswordRecoveryOtp;
  resetPassword: (
    challengeId: number,
    userId: number,
    schoolId: number,
    resetTokenHash: string,
    passwordHash: string,
  ) => Promise<boolean>;
  invalidateUserSessionsStrict: (userId: number) => Promise<void>;
  rateLimiter: PasswordRecoveryRateLimiter;
};

const teacherRecoveryRateLimiter = new PasswordRecoveryRateLimiter();

const defaultDependencies: RecoveryRouteDependencies = {
  getSchoolByCode: code => storage.getSchoolByCode(code),
  createChallenge: (email, schoolId, requestIp) =>
    createTeacherPasswordRecoveryChallenge(email, schoolId, requestIp),
  getNotificationConfig: schoolId => storage.getNotificationConfig(schoolId),
  sendRecoveryEmail: sendPasswordRecoveryEmail,
  invalidateChallenges: (userId, schoolId) =>
    storage.invalidatePasswordResetChallenges(userId, schoolId),
  verifyOtp: verifyTeacherPasswordRecoveryOtp,
  resetPassword: (challengeId, userId, schoolId, resetTokenHash, passwordHash) =>
    storage.resetTeacherPasswordForChallenge(
      challengeId,
      userId,
      schoolId,
      resetTokenHash,
      passwordHash,
    ),
  invalidateUserSessionsStrict: userId => storage.invalidateUserSessionsStrict(userId),
  rateLimiter: teacherRecoveryRateLimiter,
};

const forgotPasswordSchema = z.object({
  schoolCode: z.string().trim().min(1),
  email: z.string().trim().email(),
});

const verifyOtpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6),
  confirmPassword: z.string().min(6),
});

export function registerTeacherPasswordRecoveryRoutes(
  app: Express,
  dependencies: RecoveryRouteDependencies = defaultDependencies,
): void {
  app.post("/api/teacher/forgot-password", async (req, res) => {
    clearTeacherPasswordRecoverySession(req);
    if (!dependencies.rateLimiter.consume(`teacher-forgot:${req.ip || "unknown"}`)) {
      return res.status(429).json({ message: PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE });
    }

    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.json(buildForgotPasswordResponse());

    const schoolCode = parsed.data.schoolCode.toUpperCase();
    const email = parsed.data.email;
    try {
      const school = await dependencies.getSchoolByCode(schoolCode);
      if (!school) return res.json(buildForgotPasswordResponse());

      const created = await dependencies.createChallenge(email, school.id, req.ip || null);
      if (!created) return res.json(buildForgotPasswordResponse());
      if (created.challenge.schoolId !== school.id) {
        return res.json(buildForgotPasswordResponse());
      }

      const sessionStarted = startTeacherPasswordRecoverySession(req, {
        challengeId: created.challenge.id,
        userId: created.challenge.userId,
        schoolId: created.challenge.schoolId,
        teacherId: created.teacherId,
      });
      if (!sessionStarted) {
        await dependencies.invalidateChallenges(created.challenge.userId, school.id);
        return res.json(buildForgotPasswordResponse());
      }

      try {
        const config = await dependencies.getNotificationConfig(school.id);
        if (!config || config.schoolId !== school.id) {
          throw new Error("Missing or inconsistent notification configuration");
        }
        await dependencies.sendRecoveryEmail(config, email, created.otp);
      } catch {
        clearTeacherPasswordRecoverySession(req);
        await dependencies.invalidateChallenges(created.challenge.userId, school.id);
      }
      return res.json(buildForgotPasswordResponse());
    } catch {
      clearTeacherPasswordRecoverySession(req);
      return res.json(buildForgotPasswordResponse());
    }
  });

  app.post("/api/teacher/verify-otp", async (req, res) => {
    if (!dependencies.rateLimiter.consume(`teacher-verify-otp:${req.ip || "unknown"}`)) {
      return res.status(429).json({ message: PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE });
    }

    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }
    const recovery = getTeacherPasswordRecoverySession(req, "otp_pending");
    if (!recovery || recovery.stage !== "otp_pending") {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }

    try {
      const result = await dependencies.verifyOtp(
        recovery.challengeId,
        recovery.userId,
        recovery.schoolId,
        parsed.data.otp,
      );
      if (!result.success) {
        return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
      }
      if (!markTeacherPasswordRecoveryVerified(req, result.resetToken)) {
        return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
      }
      return res.json({ success: true, message: "Verification successful." });
    } catch {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }
  });

  app.post("/api/teacher/reset-password", async (req, res) => {
    if (!dependencies.rateLimiter.consume(`teacher-reset-password:${req.ip || "unknown"}`)) {
      return res.status(429).json({ message: PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE });
    }

    const recovery = getTeacherPasswordRecoverySession(req, "password_reset");
    if (!recovery || recovery.stage !== "password_reset") {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.newPassword !== parsed.data.confirmPassword) {
      return res.status(400).json({ message: "Invalid password reset request." });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    const resetTokenHash = hashPasswordRecoverySecret(recovery.resetToken);
    let reset: boolean;
    try {
      reset = await dependencies.resetPassword(
        recovery.challengeId,
        recovery.userId,
        recovery.schoolId,
        resetTokenHash,
        passwordHash,
      );
    } catch {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }
    if (!reset) {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }

    try {
      await dependencies.invalidateUserSessionsStrict(recovery.userId);
    } catch {
      clearTeacherPasswordRecoverySession(req);
      if (req.session.userId === recovery.userId) {
        await new Promise<void>(resolve => req.session.destroy(() => resolve()));
      }
      console.error("Teacher password reset session invalidation failed");
      return res.status(500).json({
        message: "Unable to complete password reset securely. Please contact support.",
      });
    }

    clearTeacherPasswordRecoverySession(req);
    if (req.session.userId === recovery.userId) {
      try {
        await new Promise<void>((resolve, reject) => {
          req.session.destroy(error => error ? reject(error) : resolve());
        });
      } catch {
        console.error("Teacher password reset current-session destruction failed");
        return res.status(500).json({
          message: "Unable to complete password reset securely. Please contact support.",
        });
      }
    }
    return res.json({
      success: true,
      message: "Your password has been reset successfully. Please log in again.",
    });
  });
}