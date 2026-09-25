import type { Express, NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";
import multer from "multer";
import { z } from "zod/v4";
import type { NotificationConfig } from "@workspace/db";
import { storage } from "./storage";
import {
  buildForgotPasswordResponse,
  createTeacherPasswordRecoveryChallenge,
  generatePasswordRecoveryOtp,
  generatePasswordRecoveryToken,
  hashPasswordRecoverySecret,
  passwordRecoverySecretsEqual,
  PASSWORD_RECOVERY_INVALID_MESSAGE,
  PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE,
  PasswordRecoveryRateLimiter,
} from "./password-recovery";
import { sendPasswordRecoveryEmail } from "./password-recovery-email";
import { verifyTeacherPasswordRecoveryOtp } from "./teacher-password-recovery";

type MobilePrincipal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
  schoolName: string;
};
type MobileRequest = Request & { mobileAuth?: { principal: MobilePrincipal }; file?: any };
type Middleware = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
type RecoveryRole = "admin" | "student" | "teacher";
type RecoveryStage = "otp" | "pin" | "reset";
type RecoveryTicket = {
  role: RecoveryRole;
  stage: RecoveryStage;
  challengeId: number;
  principalId: number;
  schoolId: number;
  expiresAt: number;
  resetToken?: string;
};

const genericRecoveryResponse = buildForgotPasswordResponse();
const recoveryRateLimiter = new PasswordRecoveryRateLimiter(10, 15 * 60 * 1000);
const safeRecoveryRateLimiter = new PasswordRecoveryRateLimiter(10, 15 * 60 * 1000);
const allowedImageMimes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

function reject(res: Response, status: number, message: string) {
  return res.status(status).json({ message });
}

function sendRecoveryJson(res: Response, body: unknown) {
  // Recovery tickets are bearer capabilities; avoid the logger's res.json body capture.
  return res.type("application/json").send(JSON.stringify(body));
}

function recoveryKey(): Buffer {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be configured with at least 16 characters for password recovery");
  }
  return createHash("sha256").update("benius-mobile-recovery-v1:").update(secret).digest();
}

function sealRecoveryTicket(ticket: RecoveryTicket): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", recoveryKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(ticket), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function openRecoveryTicket(value: unknown, role: RecoveryRole, stage: RecoveryStage): RecoveryTicket | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const [ivPart, tagPart, bodyPart, ...extra] = value.split(".");
    if (!ivPart || !tagPart || !bodyPart || extra.length) return null;
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", recoveryKey(), iv);
    decipher.setAuthTag(tag);
    const body = Buffer.concat([
      decipher.update(Buffer.from(bodyPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const ticket = JSON.parse(body) as Partial<RecoveryTicket>;
    if (ticket.role !== role || ticket.stage !== stage
      || !Number.isSafeInteger(ticket.challengeId) || (ticket.challengeId ?? 0) <= 0
      || !Number.isSafeInteger(ticket.principalId) || (ticket.principalId ?? 0) <= 0
      || !Number.isSafeInteger(ticket.schoolId) || (ticket.schoolId ?? 0) <= 0
      || !Number.isSafeInteger(ticket.expiresAt) || (ticket.expiresAt ?? 0) <= Date.now()) return null;
    if ((stage === "pin" || stage === "reset")
      && (typeof ticket.resetToken !== "string" || !ticket.resetToken)) return null;
    return ticket as RecoveryTicket;
  } catch {
    return null;
  }
}

function decoyTicket(role: RecoveryRole): string {
  return sealRecoveryTicket({
    role,
    stage: "otp",
    challengeId: randomInt(1, 2_000_000_000),
    principalId: randomInt(1, 2_000_000_000),
    schoolId: randomInt(1, 2_000_000_000),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
}

function supportedProvider(config: NotificationConfig): boolean {
  if (config.emailProvider !== "sendgrid" && config.emailProvider !== "mailtrap") return false;
  if (config.emailProvider === "mailtrap") {
    return typeof config.mailtrapInboxId === "string" && config.mailtrapInboxId.trim().length > 0;
  }
  return true;
}

function consumeRecoveryLimit(req: Request, res: Response, action: string): boolean {
  if (recoveryRateLimiter.consume(`mobile-recovery:${action}:${req.ip || "unknown"}`)) return true;
  reject(res, 429, PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE);
  return false;
}

function consumeSecurityLimit(req: Request, res: Response, action: string): boolean {
  if (safeRecoveryRateLimiter.consume(`mobile-admin:${action}:${req.ip || "unknown"}`)) return true;
  reject(res, 429, PASSWORD_RECOVERY_RATE_LIMIT_MESSAGE);
  return false;
}

function parseUpload(req: Request, res: Response, upload: ReturnType<typeof multer>, label: string): Promise<boolean> {
  return new Promise(resolve => {
    upload.single("file")(req, res, error => {
      if (!error) return resolve(true);
      if (error.code === "LIMIT_FILE_SIZE") reject(res, 400, `File too large. Maximum size is ${label}.`);
      else reject(res, 400, error.message || "Upload error.");
      resolve(false);
    });
  });
}

function safeManagedPath(url: string | null | undefined, schoolId: number): string | null {
  if (!url || !url.startsWith(`/uploads/schools/${schoolId}/`)) return null;
  const root = path.resolve(process.cwd(), "uploads", "schools", String(schoolId));
  const candidate = path.resolve(process.cwd(), `.${url}`);
  return candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

function validImageHeader(filePath: string, mime: string): boolean {
  try {
    const bytes = fs.readFileSync(filePath);
    if (mime === "image/jpeg" || mime === "image/jpg") {
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (mime === "image/png") {
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    if (mime === "image/webp") {
      return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF"
        && bytes.toString("ascii", 8, 12) === "WEBP";
    }
  } catch {
    return false;
  }
  return false;
}

function removeFile(filePath: string | null | undefined): void {
  if (filePath) {
    try { fs.unlinkSync(filePath); } catch { /* best-effort cleanup */ }
  }
}

async function validAdmin(req: Request, res: Response): Promise<MobilePrincipal | null> {
  const principal = (req as MobileRequest).mobileAuth?.principal;
  if (!principal) {
    reject(res, 401, "Not authenticated.");
    return null;
  }
  if (principal.role !== "admin") {
    reject(res, 403, "Administrator access is required.");
    return null;
  }
  const user = await storage.getUserById(principal.principalId);
  if (!user || user.role !== "admin" || !user.isActive || !user.isInitialized
    || user.schoolId !== principal.schoolId) {
    reject(res, 401, "Administrator account is no longer authorized.");
    return null;
  }
  return principal;
}

function routeWithAdmin(
  app: Express,
  method: "get" | "post" | "delete",
  route: string,
  requireHttps: Middleware,
  requireMobileBearer: Middleware,
  handler: (req: Request, res: Response, principal: MobilePrincipal) => unknown,
): void {
  const routeHandler = async (req: Request, res: Response) => {
    try {
      const principal = await validAdmin(req, res);
      if (!principal) return;
      return await handler(req, res, principal);
    } catch {
      return reject(res, 503, "Unable to complete the account action.");
    }
  };
  if (method === "get") app.get(route, requireHttps, requireMobileBearer, routeHandler);
  else if (method === "post") app.post(route, requireHttps, requireMobileBearer, routeHandler);
  else app.delete(route, requireHttps, requireMobileBearer, routeHandler);
}

export function registerMobileAccountRoutes(
  app: Express,
  requireHttps: Middleware,
  requireMobileBearer: Middleware,
): void {
  // Password recovery carries only encrypted, short-lived challenge authority; it
  // never reads, creates, or depends on an Express/browser session.
  app.use("/api/mobile/auth/recovery", requireHttps);
  app.post("/api/mobile/auth/recovery/student/start", async (req, res) => {
    if (!consumeRecoveryLimit(req, res, "student-start")) return;
    const parsed = z.object({
      schoolCode: z.string().trim().min(1).max(30),
      dsid: z.string().trim().min(1).max(100),
    }).strict().safeParse(req.body);
    if (!parsed.success) return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("student") });
    try {
      const school = await storage.getSchoolByCode(parsed.data.schoolCode.toUpperCase());
      const student = school ? await storage.getStudentByDsidAndSchool(parsed.data.dsid, school.id) : undefined;
      if (!school || !student || student.schoolId !== school.id || !student.isActive || !student.isActivated
        || !student.email || !z.string().email().safeParse(student.email.trim()).success) {
        return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("student") });
      }
      const otp = generatePasswordRecoveryOtp();
      const created = await storage.createStudentPasswordResetChallenge(
        student.id,
        school.id,
        student.email.trim().toLowerCase(),
        hashPasswordRecoverySecret(otp),
        new Date(Date.now() + 10 * 60 * 1000),
        req.ip || null,
      );
      if (!created || created.studentId !== student.id || created.schoolId !== school.id) {
        return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("student") });
      }
      try {
        const config = await storage.getNotificationConfig(school.id);
        if (!config || config.schoolId !== school.id || !config.emailEnabled || !supportedProvider(config)) {
          throw new Error("Recovery email is not configured.");
        }
        await sendPasswordRecoveryEmail(config, student.email.trim(), otp);
      } catch {
        await storage.invalidateStudentPasswordResetChallenge(created.id, student.id, school.id).catch(() => undefined);
        return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("student") });
      }
      const ticket = sealRecoveryTicket({
        role: "student",
        stage: "otp",
        challengeId: created.id,
        principalId: student.id,
        schoolId: school.id,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket });
    } catch {
      return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("student") });
    }
  });

  app.post("/api/mobile/auth/recovery/student/verify", async (req, res) => {
    if (!consumeRecoveryLimit(req, res, "student-verify")) return;
    const parsed = z.object({ ticket: z.string(), otp: z.string().regex(/^\d{6}$/) }).strict().safeParse(req.body);
    if (!parsed.success) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    const ticket = openRecoveryTicket(parsed.data.ticket, "student", "otp");
    if (!ticket) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    try {
      const resetToken = await storage.verifyStudentPasswordResetOtp(
        ticket.challengeId, ticket.principalId, ticket.schoolId, parsed.data.otp,
      );
      if (!resetToken) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
      const recoveryToken = sealRecoveryTicket({
        ...ticket,
        stage: "reset",
        expiresAt: Date.now() + 15 * 60 * 1000,
        resetToken,
      });
      return sendRecoveryJson(res, { success: true, recoveryToken });
    } catch {
      return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    }
  });

  app.post("/api/mobile/auth/recovery/student/reset", async (req, res) => {
    if (!consumeRecoveryLimit(req, res, "student-reset")) return;
    const parsed = z.object({ recoveryToken: z.string(), newPassword: z.string().min(6).max(200) })
      .strict().safeParse(req.body);
    if (!parsed.success) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    const ticket = openRecoveryTicket(parsed.data.recoveryToken, "student", "reset");
    if (!ticket?.resetToken) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    try {
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      const reset = await storage.resetStudentPasswordAtomically(
        ticket.challengeId,
        ticket.principalId,
        ticket.schoolId,
        ticket.resetToken,
        passwordHash,
      );
      if (!reset) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
      return res.json({ success: true, message: "Password reset successful." });
    } catch {
      return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    }
  });

  app.post("/api/mobile/auth/recovery/admin/start", async (req, res) => {
    if (!consumeRecoveryLimit(req, res, "admin-start")) return;
    const parsed = z.object({
      recoveryEmail: z.string().trim().email().max(254),
      schoolCode: z.string().trim().min(1).max(30),
    }).strict().safeParse(req.body);
    if (!parsed.success) return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("admin") });
    try {
      const school = await storage.getSchoolByCode(parsed.data.schoolCode.toUpperCase());
      const user = school
        ? await storage.getUserByRecoveryEmail(parsed.data.recoveryEmail, school.id)
        : undefined;
      if (!school || !user || user.role !== "admin" || !user.isActive
        || user.schoolId !== school.id || !user.recoveryEmail) {
        return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("admin") });
      }
      const otp = generatePasswordRecoveryOtp();
      const challenge = await storage.createPasswordResetChallenge(
        user.id,
        school.id,
        hashPasswordRecoverySecret(otp),
        new Date(Date.now() + 10 * 60 * 1000),
        req.ip || null,
      );
      try {
        const config = await storage.getNotificationConfig(school.id);
        if (!config || config.schoolId !== school.id) throw new Error("Recovery email is not configured.");
        await sendPasswordRecoveryEmail(config, user.recoveryEmail, otp);
      } catch {
        await storage.invalidatePasswordResetChallenges(user.id, school.id).catch(() => undefined);
        return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("admin") });
      }
      return sendRecoveryJson(res, {
        ...genericRecoveryResponse,
        ticket: sealRecoveryTicket({
          role: "admin",
          stage: "otp",
          challengeId: challenge.id,
          principalId: user.id,
          schoolId: school.id,
          expiresAt: Date.now() + 10 * 60 * 1000,
        }),
      });
    } catch {
      return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("admin") });
    }
  });

  app.post("/api/mobile/auth/recovery/admin/verify", async (req, res) => {
    if (!consumeRecoveryLimit(req, res, "admin-verify")) return;
    const parsed = z.object({ ticket: z.string(), otp: z.string().length(6) }).strict().safeParse(req.body);
    if (!parsed.success) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    const ticket = openRecoveryTicket(parsed.data.ticket, "admin", "otp");
    if (!ticket) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    try {
      const challenge = await storage.getPasswordResetChallenge(ticket.challengeId);
      const user = challenge ? await storage.getUserById(ticket.principalId) : undefined;
      const validIdentity = !!challenge && !!user
        && challenge.userId === ticket.principalId
        && challenge.schoolId === ticket.schoolId
        && user.role === "admin"
        && user.isActive
        && user.schoolId === ticket.schoolId;
      const otpHash = hashPasswordRecoverySecret(parsed.data.otp);
      if (!validIdentity || !passwordRecoverySecretsEqual(challenge!.otpHash, otpHash)) {
        if (challenge) {
          await storage.recordPasswordResetOtpFailure(challenge.id);
          if (user) {
            await storage.logSecurityEvent(
              user.id, user.schoolId, "otp_failed", false, req.ip || null, req.headers["user-agent"] || null,
            );
          }
        }
        return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
      }
      const resetToken = generatePasswordRecoveryToken();
      const verified = await storage.verifyPasswordResetOtp(
        challenge!.id,
        otpHash,
        hashPasswordRecoverySecret(resetToken),
        new Date(Date.now() + 15 * 60 * 1000),
      );
      if (!verified || !user) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
      await storage.logSecurityEvent(
        user.id, user.schoolId, "otp_verified", true, req.ip || null, req.headers["user-agent"] || null,
      );
      const requiresPin = !!user.pinHash;
      return sendRecoveryJson(res, {
        success: true,
        requiresPin,
        recoveryToken: sealRecoveryTicket({
          ...ticket,
          stage: requiresPin ? "pin" : "reset",
          expiresAt: Date.now() + 15 * 60 * 1000,
          resetToken,
        }),
      });
    } catch {
      return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    }
  });

  app.post("/api/mobile/auth/recovery/admin/verify-pin", async (req, res) => {
    if (!consumeRecoveryLimit(req, res, "admin-verify-pin")) return;
    const parsed = z.object({
      recoveryToken: z.string(),
      pin: z.string().regex(/^\d{6}$/),
    }).strict().safeParse(req.body);
    if (!parsed.success) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    const ticket = openRecoveryTicket(parsed.data.recoveryToken, "admin", "pin");
    if (!ticket?.resetToken) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    try {
      const [user, challenge] = await Promise.all([
        storage.getUserById(ticket.principalId),
        storage.getPasswordResetChallenge(ticket.challengeId),
      ]);
      if (!user || user.role !== "admin" || !user.isActive || user.schoolId !== ticket.schoolId
        || !challenge || challenge.userId !== user.id || challenge.schoolId !== user.schoolId
        || !challenge.verifiedAt || challenge.consumedAt
        || (challenge.resetTokenExpiresAt && challenge.resetTokenExpiresAt <= new Date())) {
        return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
      }
      if (!await storage.verifyAdminPin(user.id, parsed.data.pin)) {
        await storage.logSecurityEvent(
          user.id, user.schoolId, "pin_failed", false, req.ip || null, req.headers["user-agent"] || null,
        );
        return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
      }
      await storage.logSecurityEvent(
        user.id, user.schoolId, "reset_pin_verified", true, req.ip || null, req.headers["user-agent"] || null,
      );
      return sendRecoveryJson(res, {
        success: true,
        recoveryToken: sealRecoveryTicket({
          ...ticket,
          stage: "reset",
          expiresAt: challenge.resetTokenExpiresAt?.getTime() ?? Date.now() + 15 * 60 * 1000,
        }),
      });
    } catch {
      return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    }
  });

  app.post("/api/mobile/auth/recovery/admin/reset", async (req, res) => {
    if (!consumeRecoveryLimit(req, res, "admin-reset")) return;
    const parsed = z.object({
      recoveryToken: z.string(),
      newPassword: z.string().min(6),
      confirmPassword: z.string().min(6),
      newPin: z.string().regex(/^\d{6}$/).optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) {
      return reject(res, 400, parsed.error.issues[0]?.message || "Invalid data.");
    }
    if (parsed.data.newPassword !== parsed.data.confirmPassword) {
      return reject(res, 400, "Passwords do not match.");
    }
    const ticket = openRecoveryTicket(parsed.data.recoveryToken, "admin", "reset");
    if (!ticket?.resetToken) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    try {
      const user = await storage.getUserById(ticket.principalId);
      const challenge = await storage.getPasswordResetChallenge(ticket.challengeId);
      if (!user || user.role !== "admin" || !user.isActive || user.schoolId !== ticket.schoolId
        || !challenge || challenge.userId !== user.id || challenge.schoolId !== user.schoolId) {
        return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
      }
      const newPasswordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      const newPinHash = parsed.data.newPin ? await bcrypt.hash(parsed.data.newPin, 12) : undefined;
      const reset = await storage.resetPasswordForChallenge(
        challenge.id,
        user.id,
        user.schoolId,
        hashPasswordRecoverySecret(ticket.resetToken),
        newPasswordHash,
        newPinHash,
      );
      if (!reset) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
      await storage.logSecurityEvent(
        user.id, user.schoolId, "password_reset", true, req.ip || null, req.headers["user-agent"] || null,
      );
      await storage.invalidateUserSessions(user.id);
      return res.json({ success: true, message: "Password reset successful." });
    } catch {
      return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    }
  });

  app.post("/api/mobile/auth/recovery/teacher/start", async (req, res) => {
    if (!consumeRecoveryLimit(req, res, "teacher-start")) return;
    const parsed = z.object({
      schoolCode: z.string().trim().min(1).max(30),
      email: z.string().trim().email().max(254),
    }).strict().safeParse(req.body);
    if (!parsed.success) return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("teacher") });
    try {
      const school = await storage.getSchoolByCode(parsed.data.schoolCode.toUpperCase());
      const email = parsed.data.email;
      const created = school
        ? await createTeacherPasswordRecoveryChallenge(email, school.id, req.ip || null)
        : null;
      if (!school || !created || created.challenge.schoolId !== school.id) {
        return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("teacher") });
      }
      try {
        const config = await storage.getNotificationConfig(school.id);
        if (!config || config.schoolId !== school.id) throw new Error("Recovery email is not configured.");
        await sendPasswordRecoveryEmail(config, email, created.otp);
      } catch {
        await storage.invalidatePasswordResetChallenges(created.challenge.userId, school.id).catch(() => undefined);
        return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("teacher") });
      }
      const ticket = sealRecoveryTicket({
        role: "teacher",
        stage: "otp",
        challengeId: created.challenge.id,
        principalId: created.challenge.userId,
        schoolId: created.challenge.schoolId,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket });
    } catch {
      return sendRecoveryJson(res, { ...genericRecoveryResponse, ticket: decoyTicket("teacher") });
    }
  });

  app.post("/api/mobile/auth/recovery/teacher/verify", async (req, res) => {
    if (!consumeRecoveryLimit(req, res, "teacher-verify")) return;
    const parsed = z.object({ ticket: z.string(), otp: z.string().regex(/^\d{6}$/) }).strict().safeParse(req.body);
    if (!parsed.success) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    const ticket = openRecoveryTicket(parsed.data.ticket, "teacher", "otp");
    if (!ticket) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    try {
      const result = await verifyTeacherPasswordRecoveryOtp(
        ticket.challengeId, ticket.principalId, ticket.schoolId, parsed.data.otp,
      );
      if (!result.success) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
      const recoveryToken = sealRecoveryTicket({
        ...ticket,
        stage: "reset",
        expiresAt: Date.now() + 15 * 60 * 1000,
        resetToken: result.resetToken,
      });
      return sendRecoveryJson(res, { success: true, recoveryToken });
    } catch {
      return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    }
  });

  app.post("/api/mobile/auth/recovery/teacher/reset", async (req, res) => {
    if (!consumeRecoveryLimit(req, res, "teacher-reset")) return;
    const parsed = z.object({
      recoveryToken: z.string(),
      newPassword: z.string().min(6).max(200),
      confirmPassword: z.string().min(6).max(200),
    }).strict().safeParse(req.body);
    if (!parsed.success || parsed.data.newPassword !== parsed.data.confirmPassword) {
      return reject(res, 400, "Invalid password reset request.");
    }
    const ticket = openRecoveryTicket(parsed.data.recoveryToken, "teacher", "reset");
    if (!ticket?.resetToken) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
    try {
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      const reset = await storage.resetTeacherPasswordForChallenge(
        ticket.challengeId,
        ticket.principalId,
        ticket.schoolId,
        hashPasswordRecoverySecret(ticket.resetToken),
        passwordHash,
      );
      if (!reset) return reject(res, 400, PASSWORD_RECOVERY_INVALID_MESSAGE);
      await storage.invalidateUserSessionsStrict(ticket.principalId);
      return res.json({
        success: true,
        message: "Your password has been reset successfully. Please log in again.",
      });
    } catch {
      return reject(res, 503, "Unable to complete password reset securely. Please contact support.");
    }
  });

  // The existing GET profile route is retained; these POST endpoints provide
  // bearer-authenticated native equivalents for the web modal's actions.
  routeWithAdmin(app, "post", "/api/mobile/auth/admin/profile/update", requireHttps, requireMobileBearer,
    async (req, res, principal) => {
      const parsed = z.object({
        recoveryEmail: z.string().trim().email().max(254),
        recoveryPhone: z.string().regex(/^\d{10}$/).or(z.literal("")),
      }).strict().safeParse(req.body);
      if (!parsed.success) return reject(res, 400, "Enter a valid recovery email and 10-digit phone number.");
      await storage.updateAdminProfile(principal.principalId, {
        recoveryEmail: parsed.data.recoveryEmail,
        recoveryPhone: parsed.data.recoveryPhone || null,
      });
      return res.json({ message: "Profile updated." });
    });

  routeWithAdmin(app, "post", "/api/mobile/auth/admin/school/info", requireHttps, requireMobileBearer,
    async (req, res, principal) => {
      const optional = (max: number) => z.string().max(max).optional().or(z.literal(""));
      const parsed = z.object({
        addressLine1: z.string().min(1).max(200),
        addressLine2: optional(200),
        city: z.string().min(1).max(100),
        state: z.string().min(1).max(100),
        pinCode: z.string().regex(/^[1-9]\d{5}$/),
        country: optional(60),
        schoolPhone: z.string().regex(/^[\d\s+\-()/]{7,20}$/),
        schoolEmail: z.string().email().max(254),
        schoolWebsite: z.string().url().or(z.literal("")).optional(),
        schoolBoard: optional(100),
        schoolType: optional(60),
        affiliationNumber: optional(50),
        udiseCode: z.string().regex(/^(\d{11})?$/).optional().or(z.literal("")),
        establishedYear: z.string().regex(/^\d{4}$/).optional().or(z.literal("")),
        registrationNumber: optional(100),
        pan: optional(20),
        gstin: optional(20),
      }).strict().safeParse(req.body);
      if (!parsed.success) return reject(res, 400, "Review the school information fields and try again.");
      const currentYear = new Date().getFullYear();
      const year = parsed.data.establishedYear ? Number(parsed.data.establishedYear) : null;
      if (year !== null && (year < 1800 || year > currentYear)) {
        return reject(res, 400, `Established year must be between 1800 and ${currentYear}.`);
      }
      await storage.updateSchoolInfo(principal.schoolId, {
        addressLine1: parsed.data.addressLine1,
        addressLine2: parsed.data.addressLine2 || null,
        city: parsed.data.city,
        state: parsed.data.state,
        pinCode: parsed.data.pinCode,
        country: parsed.data.country || "India",
        phone: parsed.data.schoolPhone,
        email: parsed.data.schoolEmail,
        website: parsed.data.schoolWebsite || null,
        board: parsed.data.schoolBoard || null,
        schoolType: parsed.data.schoolType || null,
        affiliationNumber: parsed.data.affiliationNumber || null,
        udiseCode: parsed.data.udiseCode || null,
        establishedYear: year,
        registrationNumber: parsed.data.registrationNumber || null,
        pan: parsed.data.pan || null,
        gstin: parsed.data.gstin || null,
      });
      return res.json({ message: "School information updated." });
    });

  routeWithAdmin(app, "post", "/api/mobile/auth/admin/change-password", requireHttps, requireMobileBearer,
    async (req, res, principal) => {
      if (!consumeSecurityLimit(req, res, "password")) return;
      const parsed = z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(6).max(200),
        confirmPassword: z.string().min(6).max(200),
      }).strict().safeParse(req.body);
      if (!parsed.success || parsed.data.newPassword !== parsed.data.confirmPassword) {
        return reject(res, 400, "Passwords must match and contain at least 6 characters.");
      }
      if (!await storage.verifyAdminPassword(principal.principalId, parsed.data.currentPassword)) {
        await storage.logSecurityEvent(principal.principalId, principal.schoolId, "password_change_failed", false,
          req.ip || null, req.headers["user-agent"] || null);
        return reject(res, 400, "Current password is incorrect.");
      }
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      await storage.updateAdminPassword(principal.principalId, passwordHash);
      await storage.logSecurityEvent(principal.principalId, principal.schoolId, "password_changed", true,
        req.ip || null, req.headers["user-agent"] || null);
      return res.json({ message: "Password changed. Sign in again with the new password." });
    });

  routeWithAdmin(app, "post", "/api/mobile/auth/admin/change-pin", requireHttps, requireMobileBearer,
    async (req, res, principal) => {
      if (!consumeSecurityLimit(req, res, "pin")) return;
      const parsed = z.object({
        currentPin: z.string().regex(/^\d{6}$/),
        newPin: z.string().regex(/^\d{6}$/),
        confirmPin: z.string().regex(/^\d{6}$/),
      }).strict().safeParse(req.body);
      if (!parsed.success || parsed.data.newPin !== parsed.data.confirmPin) {
        return reject(res, 400, "PINs must match and contain exactly 6 digits.");
      }
      if (!await storage.verifyAdminPin(principal.principalId, parsed.data.currentPin)) {
        await storage.logSecurityEvent(principal.principalId, principal.schoolId, "pin_change_failed", false,
          req.ip || null, req.headers["user-agent"] || null);
        return reject(res, 400, "Current PIN is incorrect.");
      }
      await storage.updateAdminPin(principal.principalId, await bcrypt.hash(parsed.data.newPin, 12));
      await storage.logSecurityEvent(principal.principalId, principal.schoolId, "pin_changed", true,
        req.ip || null, req.headers["user-agent"] || null);
      return res.json({ message: "PIN changed successfully." });
    });

  routeWithAdmin(app, "get", "/api/mobile/auth/admin/security-log", requireHttps, requireMobileBearer,
    async (_req, res, principal) => res.json(await storage.getSecurityAuditLog(principal.principalId, 20)));

  const logoUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => {
        const directory = path.join(process.cwd(), "uploads");
        fs.mkdirSync(directory, { recursive: true });
        callback(null, directory);
      },
      filename: (_req, _file, callback) => callback(null, `mobile-${randomBytes(12).toString("hex")}.upload`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, allowedImageMimes.has(file.mimetype.toLowerCase())),
  });
  routeWithAdmin(app, "post", "/api/mobile/auth/admin/school/logo", requireHttps, requireMobileBearer,
    async (req, res, principal) => {
      if (!await parseUpload(req, res, logoUpload, "5 MB")) return;
      const file = (req as MobileRequest).file;
      if (!file) return reject(res, 400, "No file uploaded.");
      const extension = path.extname(file.originalname).toLowerCase();
      const mime = file.mimetype.toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension) || !validImageHeader(file.path, mime)) {
        removeFile(file.path);
        return reject(res, 400, "Only valid JPG, PNG, or WebP images are allowed.");
      }
      const currentSchool = await storage.getSchool(principal.schoolId);
      const destination = path.join(process.cwd(), "uploads", "schools", String(principal.schoolId));
      fs.mkdirSync(destination, { recursive: true });
      const filename = `logo-${randomBytes(12).toString("hex")}${extension}`;
      const finalPath = path.join(destination, filename);
      try {
        fs.renameSync(file.path, finalPath);
        await storage.updateSchoolLogo(principal.schoolId, `/uploads/schools/${principal.schoolId}/${filename}`);
      } catch {
        removeFile(finalPath);
        removeFile(file.path);
        return reject(res, 500, "Failed to save logo.");
      }
      removeFile(safeManagedPath(currentSchool?.logoUrl, principal.schoolId));
      return res.json({ message: "Logo updated.", logoUrl: `/uploads/schools/${principal.schoolId}/${filename}` });
    });

  routeWithAdmin(app, "post", "/api/mobile/auth/admin/school/logo/remove", requireHttps, requireMobileBearer,
    async (_req, res, principal) => {
      const existing = await storage.getSchool(principal.schoolId);
      await storage.clearSchoolLogo(principal.schoolId);
      removeFile(safeManagedPath(existing?.logoUrl, principal.schoolId));
      return res.json({ message: "Logo removed." });
    });

  const signatureUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => {
        const directory = path.join(process.cwd(), "uploads");
        fs.mkdirSync(directory, { recursive: true });
        callback(null, directory);
      },
      filename: (_req, _file, callback) => callback(null, `mobile-${randomBytes(12).toString("hex")}.upload`),
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, allowedImageMimes.has(file.mimetype.toLowerCase())),
  });
  routeWithAdmin(app, "post", "/api/mobile/auth/admin/profile/signature", requireHttps, requireMobileBearer,
    async (req, res, principal) => {
      if (!await parseUpload(req, res, signatureUpload, "2 MB")) return;
      const file = (req as MobileRequest).file;
      if (!file) return reject(res, 400, "No file uploaded.");
      const extension = path.extname(file.originalname).toLowerCase();
      const mime = file.mimetype.toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension) || !validImageHeader(file.path, mime)) {
        removeFile(file.path);
        return reject(res, 400, "Only valid JPG, PNG, or WebP images are allowed.");
      }
      const user = await storage.getUserById(principal.principalId);
      const previousUrl = (user as typeof user & { signatureUrl?: string | null } | undefined)?.signatureUrl;
      const directory = path.join(process.cwd(), "uploads", "schools", String(principal.schoolId), "signatures", String(principal.principalId));
      fs.mkdirSync(directory, { recursive: true });
      const filename = `sig-${randomBytes(12).toString("hex")}${extension}`;
      const finalPath = path.join(directory, filename);
      try {
        fs.renameSync(file.path, finalPath);
        await storage.updateAdminSignature(principal.principalId, principal.schoolId,
          `/uploads/schools/${principal.schoolId}/signatures/${principal.principalId}/${filename}`);
      } catch {
        removeFile(finalPath);
        removeFile(file.path);
        return reject(res, 500, "Failed to save signature.");
      }
      removeFile(safeManagedPath(previousUrl, principal.schoolId));
      return res.json({
        message: "Signature saved.",
        signatureUrl: `/uploads/schools/${principal.schoolId}/signatures/${principal.principalId}/${filename}`,
      });
    });

  routeWithAdmin(app, "post", "/api/mobile/auth/admin/profile/signature/remove", requireHttps, requireMobileBearer,
    async (_req, res, principal) => {
      const user = await storage.getUserById(principal.principalId);
      if (!user || user.schoolId !== principal.schoolId) return reject(res, 403, "Access denied.");
      const signatureUrl = (user as typeof user & { signatureUrl?: string | null }).signatureUrl;
      await storage.clearAdminSignature(principal.principalId, principal.schoolId);
      removeFile(safeManagedPath(signatureUrl, principal.schoolId));
      return res.json({ message: "Signature removed." });
    });
}