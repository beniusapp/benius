import type { Express } from "express";
import { z } from "zod";
import type { NotificationConfig } from "@shared/schema";
import { storage } from "./storage";
import {
  buildForgotPasswordResponse,
  createTeacherPasswordRecoveryChallenge,
  PASSWORD_RECOVERY_INVALID_MESSAGE,
  PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE,
  PasswordRecoveryRateLimiter,
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
  rateLimiter: teacherRecoveryRateLimiter,
};

const forgotPasswordSchema = z.object({
  schoolCode: z.string().trim().min(1),
  email: z.string().trim().email(),
});

const verifyOtpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/),
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
}