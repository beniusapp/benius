import type { Express, Request } from "express";
import { z } from "zod";
import type { NotificationConfig } from "@shared/schema";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import {
  buildForgotPasswordResponse,
  generatePasswordRecoveryOtp,
  hashPasswordRecoverySecret,
  PASSWORD_RECOVERY_INVALID_MESSAGE,
  PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE,
  passwordRecoveryRateLimiter,
} from "./password-recovery";
import { sendPasswordRecoveryEmail } from "./password-recovery-email";
import {
  clearStudentPasswordRecoverySessionIfMatches,
  clearStudentPasswordRecoverySessionIfMatchesInMemory,
  getStudentPasswordRecoverySession,
  markStudentPasswordRecoveryVerified,
  startStudentPasswordRecoverySession,
} from "./student-password-recovery-session";
import {
  getPersistedStudentRecoveryState,
  suppressStudentRecoveryStaleSessionWrite,
} from "./student-recovery-session-store";

type StudentRecoveryRouteDependencies = {
  getSchoolByCode: (code: string) => Promise<{ id: number } | undefined>;
  getStudentByDsidAndSchool: (dsid: string, schoolId: number) => Promise<{
    id: number;
    schoolId: number;
    email: string | null;
    isActive: boolean;
    isActivated: boolean;
  } | undefined>;
  getVerifiedRecoveryContact: (studentId: number, schoolId: number) => Promise<{
    id: number;
    contactValueNormalized: string;
    verifiedAt: Date | null;
  } | undefined>;
  createChallenge: (
    studentId: number,
    schoolId: number,
    contactId: number,
    otpHash: string,
    otpExpiresAt: Date,
    requestIp: string | null,
  ) => Promise<{ id: number; studentId: number; schoolId: number } | null>;
  invalidateChallenge: (challengeId: number, studentId: number, schoolId: number) => Promise<void>;
  getNotificationConfig: (schoolId: number) => Promise<NotificationConfig | null>;
  sendRecoveryEmail: (
    config: NotificationConfig,
    recipient: string,
    otp: string,
  ) => Promise<void>;
  verifyOtp: (
    challengeId: number,
    studentId: number,
    schoolId: number,
    otp: string,
  ) => Promise<string | null>;
  rateLimiter: typeof passwordRecoveryRateLimiter;
  getPersistedRecoveryState: (sessionId: string) => Promise<unknown>;
  isChallengeActive: (challengeId: number, studentId: number, schoolId: number) => Promise<boolean>;
  resetPassword?: (
    challengeId: number,
    studentId: number,
    schoolId: number,
    resetToken: string,
    passwordHash: string,
  ) => Promise<boolean>;
};

const defaultDependencies: StudentRecoveryRouteDependencies = {
  getSchoolByCode: code => storage.getSchoolByCode(code),
  getStudentByDsidAndSchool: (dsid, schoolId) =>
    storage.getStudentByDsidAndSchool(dsid, schoolId),
  getVerifiedRecoveryContact: (studentId, schoolId) =>
    storage.getStudentVerifiedRecoveryContact(studentId, schoolId),
  createChallenge: (studentId, schoolId, contactId, otpHash, otpExpiresAt, requestIp) =>
    storage.createStudentPasswordResetChallenge(
      studentId,
      schoolId,
      contactId,
      otpHash,
      otpExpiresAt,
      requestIp,
    ),
  invalidateChallenge: (challengeId, studentId, schoolId) =>
    storage.invalidateStudentPasswordResetChallenge(challengeId, studentId, schoolId),
  getNotificationConfig: schoolId => storage.getNotificationConfig(schoolId),
  sendRecoveryEmail: sendPasswordRecoveryEmail,
  verifyOtp: (challengeId, studentId, schoolId, otp) =>
    storage.verifyStudentPasswordResetOtp(challengeId, studentId, schoolId, otp),
  rateLimiter: passwordRecoveryRateLimiter,
  getPersistedRecoveryState: sessionId => getPersistedStudentRecoveryState(sessionId),
  isChallengeActive: async (challengeId, studentId, schoolId) => {
    const challenge = await storage.getStudentPasswordResetChallenge(
      challengeId,
      studentId,
      schoolId,
    );
    return !!challenge && !challenge.consumedAt && !challenge.verifiedAt;
  },
  resetPassword: (challengeId, studentId, schoolId, resetToken, passwordHash) =>
    storage.resetStudentPasswordAtomically(
      challengeId,
      studentId,
      schoolId,
      resetToken,
      passwordHash,
    ),
};

const forgotPasswordSchema = z.object({
  schoolCode: z.string().trim().min(1),
  dsid: z.string().trim().min(1),
}).strict();

const verifyOtpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/),
}).strict();

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6),
}).strict();

function supportedProvider(config: NotificationConfig): boolean {
  return config.emailProvider === "sendgrid" || config.emailProvider === "mailtrap";
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
}

function reloadSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.reload(error => error ? reject(error) : resolve());
  });
}

function sessionMatchesIdentity(state: unknown, identity: {
  challengeId: number;
  studentId: number;
  schoolId: number;
}): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const value = state as Record<string, unknown>;
  return value.flow === "student_password_recovery"
    && value.stage === "otp_pending"
    && value.challengeId === identity.challengeId
    && value.studentId === identity.studentId
    && value.schoolId === identity.schoolId;
}

async function cleanupCreatedChallenge(
  req: Request,
  created: { id: number; studentId: number; schoolId: number },
  dependencies: StudentRecoveryRouteDependencies,
): Promise<void> {
  const invalidation = dependencies.invalidateChallenge(
    created.id,
    created.studentId,
    created.schoolId,
  ).catch(() => undefined);
  const sessionClear = clearStudentPasswordRecoverySessionIfMatches(
    req,
    created.id,
    created.studentId,
    created.schoolId,
  ).catch(() => false);
  const [, cleared] = await Promise.all([invalidation, sessionClear]);
  if (!cleared) {
    clearStudentPasswordRecoverySessionIfMatchesInMemory(req, {
      challengeId: created.id,
      studentId: created.studentId,
      schoolId: created.schoolId,
    });
  }
}

export function registerStudentPasswordRecoveryRoutes(
  app: Express,
  dependencies: StudentRecoveryRouteDependencies = defaultDependencies,
): void {
  app.post("/api/student/forgot-password", async (req, res) => {
    try {
      await saveSession(req);
    } catch {
      return res.json(buildForgotPasswordResponse());
    }
    if (!dependencies.rateLimiter.consume(`student-forgot:${req.ip || "unknown"}`)) {
      return res.status(429).json({ message: PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE });
    }
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.json(buildForgotPasswordResponse());

    try {
      const school = await dependencies.getSchoolByCode(parsed.data.schoolCode.toUpperCase());
      if (!school) return res.json(buildForgotPasswordResponse());
      const student = await dependencies.getStudentByDsidAndSchool(parsed.data.dsid, school.id);
      if (!student || student.schoolId !== school.id || !student.isActive || !student.isActivated) {
        return res.json(buildForgotPasswordResponse());
      }
      const contact = await dependencies.getVerifiedRecoveryContact(student.id, school.id);
      if (
        !student.email
        || !contact
        || !contact.verifiedAt
        || contact.contactValueNormalized !== student.email.trim().toLowerCase()
      ) {
        return res.json(buildForgotPasswordResponse());
      }

      const otp = generatePasswordRecoveryOtp();
      const created = await dependencies.createChallenge(
        student.id,
        school.id,
        contact.id,
        hashPasswordRecoverySecret(otp),
        new Date(Date.now() + 10 * 60 * 1000),
        req.ip || null,
      );
      if (!created || created.studentId !== student.id || created.schoolId !== school.id) {
        return res.json(buildForgotPasswordResponse());
      }

      const started = startStudentPasswordRecoverySession(req, {
        challengeId: created.id,
        studentId: student.id,
        schoolId: school.id,
      });
      if (!started) {
        await cleanupCreatedChallenge(req, created, dependencies);
        return res.json(buildForgotPasswordResponse());
      }

      try {
        // Persist the new OTP_PENDING state before delivery. Otherwise a
        // delivery failure could race the normal end-of-request session save
        // and leave a session pointing at an invalidated challenge.
        let persisted = false;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          if (!await dependencies.isChallengeActive(created.id, student.id, school.id)) {
            await cleanupCreatedChallenge(req, created, dependencies);
            return res.json(buildForgotPasswordResponse());
          }
          await saveSession(req);
          persisted = sessionMatchesIdentity(
            await dependencies.getPersistedRecoveryState(req.sessionID),
            {
              challengeId: created.id,
              studentId: created.studentId,
              schoolId: created.schoolId,
            },
          );
          if (persisted) break;
          await reloadSession(req);
          if (!await dependencies.isChallengeActive(created.id, student.id, school.id)) {
            await cleanupCreatedChallenge(req, created, dependencies);
            return res.json(buildForgotPasswordResponse());
          }
          startStudentPasswordRecoverySession(req, {
            challengeId: created.id,
            studentId: student.id,
            schoolId: school.id,
          });
        }
        if (!persisted || !await dependencies.isChallengeActive(created.id, student.id, school.id)) {
          const stillActive = await dependencies.isChallengeActive(created.id, student.id, school.id);
          if (stillActive) {
            // This request owns the still-active challenge. A competing stale
            // full-session save may have won the row lock, so leave the
            // challenge authoritative and do not invalidate it merely because
            // this request could not converge its session in this attempt.
            return res.json(buildForgotPasswordResponse());
          }
          await cleanupCreatedChallenge(req, created, dependencies);
          return res.json(buildForgotPasswordResponse());
        }
        const config = await dependencies.getNotificationConfig(school.id);
        if (
          !config
          || config.schoolId !== school.id
          || !config.emailEnabled
          || !supportedProvider(config)
        ) {
          throw new Error("Missing or inconsistent notification configuration");
        }
        await dependencies.sendRecoveryEmail(config, student.email, otp);
      } catch {
        await cleanupCreatedChallenge(req, created, dependencies);
      }
      return res.json(buildForgotPasswordResponse());
    } catch {
      return res.json(buildForgotPasswordResponse());
    }
  });

  app.post("/api/student/verify-recovery-otp", async (req, res) => {
    if (!dependencies.rateLimiter.consume(`student-verify-otp:${req.ip || "unknown"}`)) {
      return res.status(429).json({ message: PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE });
    }
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }
    const recovery = getStudentPasswordRecoverySession(req, "otp_pending");
    if (!recovery || recovery.stage !== "otp_pending") {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }
    try {
      const resetToken = await dependencies.verifyOtp(
        recovery.challengeId,
        recovery.studentId,
        recovery.schoolId,
        parsed.data.otp,
      );
      if (!resetToken || !markStudentPasswordRecoveryVerified(req, resetToken)) {
        return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
      }
      return res.json({ success: true, message: "Verification successful." });
    } catch {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }
  });

  app.post("/api/student/reset-password", async (req, res) => {
    if (!dependencies.rateLimiter.consume(`student-reset-password:${req.ip || "unknown"}`)) {
      return res.status(429).json({ message: PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE });
    }
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }
    const recovery = getStudentPasswordRecoverySession(req, "password_reset");
    if (!recovery || recovery.stage !== "password_reset") {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }
    try {
      // Keep the recovery state intact until the database transaction commits.
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      if (!dependencies.resetPassword) {
        return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
      }
      const reset = await dependencies.resetPassword(
        recovery.challengeId,
        recovery.studentId,
        recovery.schoolId,
        recovery.resetToken,
        passwordHash,
      );
      if (!reset) {
        return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
      }
      // The reset transaction removes this session row along with every old
      // Student session. Clear only the exact recovery authority; a newer
      // recovery state must never be erased by this stale request.
      const cleared = await clearStudentPasswordRecoverySessionIfMatches(
        req,
        recovery.challengeId,
        recovery.studentId,
        recovery.schoolId,
      ).catch(() => false);
      if (!cleared) {
        clearStudentPasswordRecoverySessionIfMatchesInMemory(req, recovery);
      }
      // Remove authentication fields only when this request's session still
      // represents the reset Student, never a different Student identity.
      if (req.session.studentId === recovery.studentId) {
        req.session.studentId = undefined;
        req.session.studentAuthIssuedAt = undefined;
        req.session.authIssuedAt = undefined;
      }
      // Prevent this request's stale session snapshot from recreating deleted
      // authentication/recovery authority after the transaction commits.
      suppressStudentRecoveryStaleSessionWrite(req.session);
      return res.json({ success: true, message: "Password reset successful." });
    } catch {
      return res.status(400).json({ message: PASSWORD_RECOVERY_INVALID_MESSAGE });
    }
  });
}