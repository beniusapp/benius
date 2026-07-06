import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertSchoolSchema, attendanceRecords, studentProfiles, students, schools, teacherSelfAttendance, attendanceCorrectionRequests, facultyMappings, attendancePolicies, insertAttendancePolicySchema } from "@shared/schema";
import { resolvePolicy, isLateCheckIn, DEFAULT_POLICY, recomputeStatus } from "./attendance-policy-engine";
import bcrypt from "bcryptjs";
import { z } from "zod";
import multer from "multer";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { registerTeacherRoutes } from "./teacher-routes";
import { db } from "./db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    schoolId?: number;
    userRole?: string;
    studentId?: number;
    teacherId?: number;
    pendingInitUserId?: number;
    pendingPinUserId?: number;
    pendingPinToken?: string;
    pendingForgotUserId?: number;
    pendingResetUserId?: number;
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const createSchoolBodySchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(20),
  principalEmail: z.string().email(),
  principalPassword: z.string().min(6),
});

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseUploadedFile(buffer: Buffer, filename: string): Record<string, string>[] {
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "csv") {
    const content = buffer.toString("utf-8");
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
    return records.map((row: Record<string, string>) => {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[normalizeHeader(key)] = value;
      }
      return normalized;
    });
  }

  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    return jsonData.map((row) => {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[normalizeHeader(key)] = String(value).trim();
      }
      return normalized;
    });
  }

  throw new Error("Unsupported file format. Please upload a .csv, .xlsx, or .xls file.");
}

function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  return cleaned.length >= 7 && /^\d+$/.test(cleaned);
}

function parseDate(value: string): string | null {
  if (!value) return null;

  const num = Number(value);
  if (!isNaN(num) && num > 10000 && num < 100000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + num * 86400000);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0];
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return value;
  }

  const slashMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    const [, p1, p2, p3] = slashMatch;
    let year = parseInt(p3, 10);
    if (year < 100) year += 2000;
    const month = parseInt(p1, 10);
    const day = parseInt(p2, 10);
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split("T")[0];
    }
  }

  const dashMatch = value.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dashMatch) {
    const [, p1, p2, p3] = dashMatch;
    let year = parseInt(p3, 10);
    if (year < 100) year += 2000;
    const d = new Date(year, parseInt(p1, 10) - 1, parseInt(p2, 10));
    if (!isNaN(d.getTime())) {
      return d.toISOString().split("T")[0];
    }
  }

  const parsed = new Date(value);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return null;
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * checkSessionContext — global middleware that runs on EVERY incoming request.
 *
 * For ALL request methods (GET included):
 *   Reads x-view-session-id from the request headers and attaches its parsed
 *   integer value to (req as any).viewSessionId.  Route handlers can then
 *   optionally scope their database queries:
 *     WHERE session_id = req.viewSessionId
 *
 * For mutation methods (POST / PUT / PATCH / DELETE) only:
 *   Validates the session against the database.  If the referenced session is
 *   archived (is_active = false for that school), the request is aborted with
 *   403 so historical data can never be accidentally overwritten through the UI.
 *
 * Fails open on any database error so that a middleware issue never blocks
 * legitimate traffic.
 */
async function checkSessionContext(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
) {
  const rawHeader = req.headers["x-view-session-id"];

  // ── Step 1: Attach viewSessionId to the request for every HTTP method ────
  // This allows any downstream route handler — GET or mutation — to read
  // req.viewSessionId and append a session-scoped WHERE clause to its query.
  if (rawHeader) {
    const sid = parseInt(Array.isArray(rawHeader) ? rawHeader[0] : rawHeader, 10);
    if (!isNaN(sid)) {
      (req as any).viewSessionId = sid;
    }
  }

  // ── Step 2: Archive write guard (mutations only) ──────────────────────────
  // If the admin is viewing an archived session and attempts any write, reject
  // it immediately before it reaches any route handler.
  if (
    MUTATION_METHODS.has(req.method) &&
    (req as any).viewSessionId &&
    req.session?.schoolId
  ) {
    try {
      const activeSession = await storage.getActiveSession(req.session.schoolId);
      if (activeSession && activeSession.id !== (req as any).viewSessionId) {
        // Give teachers a role-specific message; admins get the general archive message.
        return res.status(403).json({
          error: "Security Restriction: Write operations are strictly blocked for archived school years.",
          code: "ARCHIVE_READ_ONLY",
        });
      }
    } catch {
      // Fail open — never let a middleware DB error block legitimate traffic.
    }
  }

  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  /* ── Session context middleware: applied globally to ALL routes ── */
  app.use(checkSessionContext);

  app.get("/api/schools", async (_req, res) => {
    const schools = await storage.getSchools();
    const counts = await storage.getActiveStudentCountsBySchools();
    const enriched = schools.map(s => ({ ...s, activeStudentCount: counts[s.id] ?? 0 }));
    res.json(enriched);
  });

  app.post("/api/schools", async (req, res) => {
    const parsed = createSchoolBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    }

    const { name, code, principalEmail, principalPassword } = parsed.data;

    const existingSchool = await storage.getSchoolByCode(code);
    if (existingSchool) {
      return res.status(409).json({ message: "A school with this code already exists" });
    }

    const existingUser = await storage.getUserByEmail(principalEmail);
    if (existingUser) {
      return res.status(409).json({ message: "A user with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(principalPassword, 10);
    const school = await storage.createSchoolWithPrincipal({ name, code }, principalEmail, passwordHash);
    res.status(201).json(school);
  });

  app.delete("/api/schools/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid school ID" });
    }
    const deleted = await storage.deleteSchool(id);
    if (!deleted) {
      return res.status(404).json({ message: "School not found" });
    }
    res.json({ message: "School deleted" });
  });

  app.post("/api/login", async (req, res) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid email or password format" });
    }

    const user = await storage.getUserByEmail(parsed.data.email);
    if (!user) {
      await storage.logSecurityEvent(null, null, "login_unknown_email", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!user.isActive) {
      await storage.logSecurityEvent(user.id, user.schoolId, "login_deactivated", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(403).json({ message: "This account has been deactivated. Please contact your administrator." });
    }

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) {
      await storage.logSecurityEvent(user.id, user.schoolId, "login_failed", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (user.role !== "admin") {
      await storage.logSecurityEvent(user.id, user.schoolId, "login_wrong_role", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(403).json({ message: "This login is for school administrators only." });
    }

    if (!user.isInitialized) {
      req.session.pendingInitUserId = user.id;
      req.session.pendingPinUserId = undefined;
      req.session.userId = undefined;
      req.session.teacherId = undefined;
      await storage.logSecurityEvent(user.id, user.schoolId, "init_required", true, req.ip || null, req.headers["user-agent"] || null);
      return res.json({ requiresInit: true });
    }

    const tempToken = randomBytes(32).toString("hex");
    req.session.pendingPinUserId = user.id;
    req.session.pendingPinToken = tempToken;
    req.session.pendingInitUserId = undefined;
    req.session.userId = undefined;
    req.session.teacherId = undefined;
    await storage.logSecurityEvent(user.id, user.schoolId, "pin_required", true, req.ip || null, req.headers["user-agent"] || null);
    return res.json({ requiresPin: true, tempToken });
  });

  app.post("/api/admin/initialize", async (req, res) => {
    const pendingInitUserId = req.session.pendingInitUserId;
    if (!pendingInitUserId) return res.status(401).json({ message: "No pending init session" });

    const userCheck = await storage.getUserById(pendingInitUserId);
    if (!userCheck || userCheck.role !== "admin") return res.status(403).json({ message: "Not authorized" });
    if (userCheck.isInitialized) return res.status(403).json({ message: "Account already initialized" });

    const schema = z.object({
      newPassword: z.string().min(6, "New password must be at least 6 characters"),
      confirmPassword: z.string().min(6),
      pin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits"),
      confirmPin: z.string().length(6),
      recoveryEmail: z.string().email("Enter a valid recovery email"),
      recoveryPhone: z.string().min(7, "Enter a valid phone number").max(20),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid data" });
    if (parsed.data.newPassword !== parsed.data.confirmPassword) return res.status(400).json({ message: "Passwords do not match" });
    if (parsed.data.pin !== parsed.data.confirmPin) return res.status(400).json({ message: "PINs do not match" });

    const newPasswordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    const pinHash = await bcrypt.hash(parsed.data.pin, 12);
    await storage.updateAdminPassword(pendingInitUserId, newPasswordHash);
    await storage.initializeAdmin(
      pendingInitUserId,
      pinHash,
      parsed.data.recoveryEmail,
      parsed.data.recoveryPhone || null,
    );

    const userData = await storage.getUserWithSchool(pendingInitUserId);
    req.session.pendingInitUserId = undefined;
    req.session.userId = pendingInitUserId;
    req.session.teacherId = undefined;
    if (userData) {
      req.session.schoolId = userData.school.id;
      req.session.userRole = userData.user.role;
    }
    await storage.logSecurityEvent(pendingInitUserId, req.session.schoolId ?? null, "init_complete", true, req.ip || null, req.headers["user-agent"] || null);
    await storage.logSecurityEvent(pendingInitUserId, req.session.schoolId ?? null, "login_success", true, req.ip || null, req.headers["user-agent"] || null);
    await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.json({ message: "Account initialized" });
  });

  app.post("/api/admin/verify-pin", async (req, res) => {
    const pendingPinUserId = req.session.pendingPinUserId;
    if (!pendingPinUserId) return res.status(401).json({ message: "No pending PIN session" });

    const schema = z.object({ pin: z.string().length(6), tempToken: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

    if (!req.session.pendingPinToken || parsed.data.tempToken !== req.session.pendingPinToken) {
      await storage.logSecurityEvent(pendingPinUserId, null, "invalid_challenge_token", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(401).json({ message: "Invalid or expired challenge token" });
    }

    const user = await storage.getUserById(pendingPinUserId);
    if (!user || user.role !== "admin") return res.status(403).json({ message: "Not authorized" });
    const schoolId = user.schoolId ?? null;

    const valid = await storage.verifyAdminPin(pendingPinUserId, parsed.data.pin);
    if (!valid) {
      await storage.logSecurityEvent(pendingPinUserId, schoolId, "pin_failed", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(401).json({ message: "Incorrect PIN" });
    }

    const userData = await storage.getUserWithSchool(pendingPinUserId);
    req.session.pendingPinUserId = undefined;
    req.session.pendingPinToken = undefined;
    req.session.userId = pendingPinUserId;
    req.session.teacherId = undefined;
    if (userData) {
      req.session.schoolId = userData.school.id;
      req.session.userRole = userData.user.role;
    }
    await storage.logSecurityEvent(pendingPinUserId, req.session.schoolId ?? null, "login_success", true, req.ip || null, req.headers["user-agent"] || null);
    await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.json({ message: "Login successful" });
  });

  app.post("/api/admin/forgot-password", async (req, res) => {
    const schema = z.object({ recoveryEmail: z.string().email(), schoolCode: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

    const school = await storage.getSchoolByCode(parsed.data.schoolCode.toUpperCase());
    if (!school) {
      return res.json({ message: "If those details match, an OTP has been sent to your recovery email.", otp: null, expiresIn: 10, recoveryEmail: null });
    }

    const user = await storage.getUserByRecoveryEmail(parsed.data.recoveryEmail, school.id);
    if (!user) {
      return res.json({ message: "If those details match, an OTP has been sent to your recovery email.", otp: null, expiresIn: 10, recoveryEmail: null });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await storage.setAdminOtp(user.id, otp, expiresAt);
    req.session.pendingForgotUserId = user.id;
    const recoveryEmailMasked = user.recoveryEmail
      ? user.recoveryEmail.replace(/(.{2}).*(@.*)/, "$1***$2")
      : null;
    res.json({ message: "OTP generated", otp, expiresIn: 10, recoveryEmail: recoveryEmailMasked });
  });

  app.get("/api/admin/pending-session", (req, res) => {
    res.json({ pending: !!req.session.pendingInitUserId });
  });

  app.post("/api/admin/verify-otp", async (req, res) => {
    const pendingForgotUserId = req.session.pendingForgotUserId;
    if (!pendingForgotUserId) return res.status(401).json({ message: "No pending forgot-password session" });

    const schema = z.object({ otp: z.string().length(6) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

    const user = await storage.getUserById(pendingForgotUserId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const valid = await storage.verifyAndConsumeAdminOtp(user.id, parsed.data.otp);
    if (!valid) {
      await storage.logSecurityEvent(user.id, user.schoolId, "otp_failed", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    await storage.logSecurityEvent(user.id, user.schoolId, "otp_verified", true, req.ip || null, req.headers["user-agent"] || null);
    req.session.pendingForgotUserId = undefined;
    req.session.pendingResetUserId = user.id;
    const hasPinSetup = !!user.pinHash;

    if (!hasPinSetup) {
      const updatedUser = await storage.getUserById(user.id);
      return res.json({ message: "OTP verified", requiresPin: false, resetToken: updatedUser?.resetToken });
    }

    res.json({ message: "OTP verified", requiresPin: true });
  });

  app.post("/api/admin/verify-reset-pin", async (req, res) => {
    const pendingResetUserId = req.session.pendingResetUserId;
    if (!pendingResetUserId) return res.status(401).json({ message: "No pending reset session" });

    const schema = z.object({ pin: z.string().length(6) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid PIN format" });

    const user = await storage.getUserById(pendingResetUserId);
    const valid = await storage.verifyAdminPin(pendingResetUserId, parsed.data.pin);
    if (!valid) {
      await storage.logSecurityEvent(pendingResetUserId, user?.schoolId ?? null, "pin_failed", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(401).json({ message: "Incorrect PIN" });
    }

    await storage.logSecurityEvent(pendingResetUserId, user?.schoolId ?? null, "reset_pin_verified", true, req.ip || null, req.headers["user-agent"] || null);
    const updatedUser = await storage.getUserById(pendingResetUserId);
    res.json({ message: "PIN verified", resetToken: updatedUser?.resetToken });
  });

  app.post("/api/admin/reset-password", async (req, res) => {
    const pendingResetUserId = req.session.pendingResetUserId;
    if (!pendingResetUserId) return res.status(401).json({ message: "No pending reset session" });

    const schema = z.object({
      resetToken: z.string().min(1),
      newPassword: z.string().min(6),
      newPin: z.string().length(6).regex(/^\d{6}$/).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid data" });

    const user = await storage.getUserById(pendingResetUserId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const newPasswordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    const newPinHash = parsed.data.newPin ? await bcrypt.hash(parsed.data.newPin, 12) : undefined;
    const ok = await storage.resetAdminPasswordWithToken(user.email, parsed.data.resetToken, newPasswordHash, newPinHash);
    if (!ok) return res.status(400).json({ message: "Invalid or expired reset token" });
    req.session.pendingResetUserId = undefined;
    await storage.logSecurityEvent(user.id, user.schoolId, "password_reset", true, req.ip || null, req.headers["user-agent"] || null);
    res.json({ message: "Password reset successful" });
  });

  app.get("/api/admin/profile", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUserById(req.session.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({
      id: user.id,
      email: user.email,
      recoveryEmail: user.recoveryEmail,
      recoveryPhone: user.recoveryPhone,
      isInitialized: user.isInitialized,
      hasPin: !!user.pinHash,
    });
  });

  app.patch("/api/admin/profile", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(401).json({ message: "Not authenticated" });
    const schema = z.object({
      recoveryEmail: z.string().email().optional().or(z.literal("")),
      recoveryPhone: z.string().min(7, "Enter a valid phone number").max(20).optional().or(z.literal("")),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data" });
    await storage.updateAdminProfile(req.session.userId, {
      recoveryEmail: parsed.data.recoveryEmail || null,
      recoveryPhone: parsed.data.recoveryPhone || null,
    });
    res.json({ message: "Profile updated" });
  });

  app.post("/api/admin/change-password", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(401).json({ message: "Not authenticated" });
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(6),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid data" });
    const ok = await storage.verifyAdminPassword(req.session.userId, parsed.data.currentPassword);
    if (!ok) {
      await storage.logSecurityEvent(req.session.userId, req.session.schoolId ?? null, "password_change_failed", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(401).json({ message: "Current password is incorrect" });
    }
    const hash = await bcrypt.hash(parsed.data.newPassword, 10);
    await storage.updateAdminPassword(req.session.userId, hash);
    await storage.logSecurityEvent(req.session.userId, req.session.schoolId ?? null, "password_changed", true, req.ip || null, req.headers["user-agent"] || null);
    res.json({ message: "Password changed successfully" });
  });

  app.post("/api/admin/change-pin", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(401).json({ message: "Not authenticated" });
    const schema = z.object({
      currentPin: z.string().length(6),
      newPin: z.string().length(6).regex(/^\d{6}$/, "New PIN must be 6 digits"),
      confirmPin: z.string().length(6),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid data" });
    if (parsed.data.newPin !== parsed.data.confirmPin) return res.status(400).json({ message: "New PINs do not match" });
    const ok = await storage.verifyAdminPin(req.session.userId, parsed.data.currentPin);
    if (!ok) {
      await storage.logSecurityEvent(req.session.userId, req.session.schoolId ?? null, "pin_change_failed", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(401).json({ message: "Current PIN is incorrect" });
    }
    const hash = await bcrypt.hash(parsed.data.newPin, 12);
    await storage.updateAdminPin(req.session.userId, hash);
    await storage.logSecurityEvent(req.session.userId, req.session.schoolId ?? null, "pin_changed", true, req.ip || null, req.headers["user-agent"] || null);
    res.json({ message: "PIN changed successfully" });
  });

  app.get("/api/admin/security-log", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(401).json({ message: "Not authenticated" });
    const logs = await storage.getSecurityAuditLog(req.session.userId, 20);
    res.json(logs);
  });

  app.get("/api/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const data = await storage.getUserWithSchool(req.session.userId);
    if (!data) {
      return res.status(401).json({ message: "User not found" });
    }

    const studentCount = await storage.getStudentCountBySchoolActive(data.school.id);

    res.json({
      id: data.user.id,
      email: data.user.email,
      role: data.user.role,
      schoolId: data.school.id,
      schoolName: data.school.name,
      schoolCode: data.school.code,
      studentCount,
    });
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/schools/:schoolId/students", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const schoolId = parseInt(req.params.schoolId);
    if (isNaN(schoolId)) {
      return res.status(400).json({ message: "Invalid school ID" });
    }

    const userData = await storage.getUserWithSchool(req.session.userId);
    if (!userData || userData.school.id !== schoolId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const studentList = await storage.getStudentsBySchool(schoolId);
    res.json(studentList);
  });

  app.post("/api/schools/:schoolId/students/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const schoolId = parseInt(req.params.schoolId);
      if (isNaN(schoolId)) {
        return res.status(400).json({ message: "Invalid school ID" });
      }

      const userData = await storage.getUserWithSchool(req.session.userId);
      if (!userData || userData.school.id !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const rows = parseUploadedFile(req.file.buffer, req.file.originalname);
      if (rows.length === 0) {
        return res.status(400).json({ message: "The uploaded file contains no data rows" });
      }

      const schoolCode = userData.school.code;
      let currentSerial = await storage.getMaxDsidSerialForSchool(schoolCode);

      const warnings: string[] = [];
      const validStudents: {
        schoolId: number;
        digitalStudentId: string;
        name: string;
        class: string;
        section: string;
        phone: string;
        dob: string;
        passwordHash: string;
        isActivated: boolean;
      }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        const name = row["name"] || "";
        const cls = row["class"] || "";
        const section = row["section"] || "";
        const phone = row["phone"] || row["phonenumber"] || row["mobile"] || row["contact"] || "";
        const dobRaw = row["dob"] || row["dateofbirth"] || row["birthdate"] || "";

        if (!name) {
          warnings.push(`Row ${rowNum}: Skipped — missing Name`);
          continue;
        }

        if (!phone || !isValidPhone(phone)) {
          warnings.push(`Row ${rowNum}: Skipped "${name}" — missing or invalid phone number`);
          continue;
        }

        if (!dobRaw) {
          warnings.push(`Row ${rowNum}: Skipped "${name}" — missing Date of Birth`);
          continue;
        }

        const dob = parseDate(dobRaw);
        if (!dob) {
          warnings.push(`Row ${rowNum}: Skipped "${name}" — invalid date format "${dobRaw}"`);
          continue;
        }

        currentSerial++;
        const dsid = `${schoolCode}-${String(currentSerial).padStart(4, "0")}`;
        const passwordHash = await bcrypt.hash(dsid, 10);

        validStudents.push({
          schoolId,
          digitalStudentId: dsid,
          name,
          class: cls,
          section,
          phone,
          dob,
          passwordHash,
          isActivated: false,
        });
      }

      if (validStudents.length > 0) {
        await storage.bulkCreateStudents(validStudents);
      }

      res.json({
        count: validStudents.length,
        skipped: rows.length - validStudents.length,
        warnings,
        message: `Successfully generated ${validStudents.length} student IDs`,
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ message: error.message || "Failed to process the uploaded file" });
    }
  });

  const manualStudentSchema = z.object({
    name: z.string().min(1),
    class: z.string().min(1),
    section: z.string().min(1),
    phone: z.string().min(7),
    dob: z.string().min(1),
    gender: z.enum(["Boy", "Girl"]).optional(),
    rollNumber: z.number().int().positive().optional().nullable(),
    guardianName: z.string().optional(),
  });

  app.post("/api/schools/:schoolId/students", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const schoolId = parseInt(req.params.schoolId);
      if (isNaN(schoolId)) {
        return res.status(400).json({ message: "Invalid school ID" });
      }

      const userData = await storage.getUserWithSchool(req.session.userId);
      if (!userData || userData.school.id !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const parsed = manualStudentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
      }

      const { name, class: cls, section, phone, dob: dobRaw, gender, rollNumber, guardianName } = parsed.data;

      if (!isValidPhone(phone)) {
        return res.status(400).json({ message: "Invalid phone number" });
      }

      const dob = parseDate(dobRaw);
      if (!dob) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      if (rollNumber) {
        const existing = await db.select({ id: students.id }).from(students)
          .where(and(eq(students.schoolId, schoolId), eq(students.class, cls), eq(students.section, section), eq(students.rollNumber, rollNumber), eq(students.isActive, true)));
        if (existing.length > 0) {
          return res.status(409).json({ message: `Roll number ${rollNumber} is already assigned in ${cls}-${section}` });
        }
      }

      const schoolCode = userData.school.code;
      const currentSerial = await storage.getMaxDsidSerialForSchool(schoolCode);
      const dsid = `${schoolCode}-${String(currentSerial + 1).padStart(4, "0")}`;
      const passwordHash = await bcrypt.hash(dsid, 10);

      const student = await storage.createStudent({
        schoolId,
        digitalStudentId: dsid,
        name,
        class: cls,
        section,
        phone,
        dob,
        passwordHash,
        isActivated: false,
        ...(gender ? { gender } : {}),
        ...(rollNumber ? { rollNumber } : {}),
        ...(guardianName ? { guardianName } : {}),
      });

      // Auto-enrollment: silently attach the student to the currently active
      // academic session for this school. If no session is active yet, skip
      // gracefully — enrollment can be assigned later when a session is created.
      try {
        const activeSession = await storage.getActiveSession(schoolId);
        if (activeSession) {
          await storage.createEnrollment({
            schoolId,
            studentId: student.id,
            sessionId: activeSession.id,
            className: cls,
            sectionName: section,
            ...(rollNumber ? { rollNo: rollNumber } : {}),
            status: "Active",
          });
        }
      } catch (enrollErr) {
        // Non-fatal: student row was created successfully; log and continue.
        console.warn("Auto-enrollment skipped:", enrollErr);
      }

      res.status(201).json(student);
    } catch (error: any) {
      console.error("Manual student add error:", error);
      res.status(500).json({ message: error.message || "Failed to add student" });
    }
  });

  const verifyStudentSchema = z.object({
    dsid: z.string().min(1),
    phone: z.string().min(1),
    dob: z.string().min(1),
  });

  app.post("/api/students/verify", async (req, res) => {
    const parsed = verifyStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const { dsid, phone, dob: dobRaw } = parsed.data;
    const dob = parseDate(dobRaw);
    if (!dob) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const student = await storage.getStudentByDsidPhoneDob(dsid, phone, dob);
    if (!student) {
      return res.status(404).json({ message: "No matching student record found. Please check your DSID, phone number, and date of birth." });
    }

    if (student.isActivated) {
      return res.status(409).json({ message: "This account has already been activated. Please log in instead." });
    }

    res.json({ message: "Student verified", studentName: student.name });
  });

  const activateStudentSchema = z.object({
    dsid: z.string().min(1),
    phone: z.string().min(1),
    dob: z.string().min(1),
    password: z.string().min(6, "Password must be at least 6 characters"),
  });

  app.post("/api/students/activate", async (req, res) => {
    const parsed = activateStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    }

    const { dsid, phone, dob: dobRaw, password } = parsed.data;
    const dob = parseDate(dobRaw);
    if (!dob) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const student = await storage.getStudentByDsidPhoneDob(dsid, phone, dob);
    if (!student) {
      return res.status(404).json({ message: "No matching student record found" });
    }

    if (student.isActivated) {
      return res.status(409).json({ message: "This account has already been activated" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const enrollmentDate = new Date().toISOString().split("T")[0];
    await storage.activateStudent(student.id, passwordHash, enrollmentDate);

    res.json({ message: "Account activated successfully. You can now log in." });
  });

  const studentLoginSchema = z.object({
    dsid: z.string().min(1),
    password: z.string().min(1),
  });

  app.post("/api/student-login", async (req, res) => {
    const parsed = studentLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "DSID and password are required" });
    }

    const { dsid, password } = parsed.data;

    const student = await storage.getStudentByDsid(dsid);
    if (!student) {
      return res.status(401).json({ message: "Invalid DSID or password" });
    }

    if (!student.isActive) {
      return res.status(403).json({ message: "This account has been deactivated. Please contact your administrator." });
    }

    if (!student.isActivated) {
      return res.status(403).json({ message: "Account not activated. Please register first at /register." });
    }

    const valid = await bcrypt.compare(password, student.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid DSID or password" });
    }

    req.session.studentId = student.id;
    res.json({ message: "Login successful" });
  });

  app.get("/api/student-me", async (req, res) => {
    if (!req.session.studentId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const data = await storage.getStudentWithSchool(req.session.studentId);
    if (!data) {
      return res.status(401).json({ message: "Student not found" });
    }

    res.json({
      id: data.student.id,
      name: data.student.name,
      digitalStudentId: data.student.digitalStudentId,
      class: data.student.class,
      section: data.student.section,
      phone: data.student.phone,
      dob: data.student.dob,
      photoUrl: data.student.photoUrl,
      enrollmentDate: data.student.enrollmentDate,
      verifiedProfile: data.student.verifiedProfile
        ? (() => { try { return JSON.parse(data.student.verifiedProfile); } catch { return null; } })()
        : null,
      schoolName: data.school.name,
      schoolCode: data.school.code,
      schoolId: data.student.schoolId,
    });
  });

  app.post("/api/student-logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out" });
    });
  });

  // ===== SCHOOL METADATA (Admin) =====
  app.get("/api/school-metadata/:schoolId", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(401).json({ message: "Not authenticated" });
    const schoolId = parseInt(req.params.schoolId);
    if (req.session.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
    const meta = await storage.getAllSchoolMetadata(schoolId);
    res.json(meta);
  });

  app.put("/api/school-metadata/:schoolId/class-sections-map", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(401).json({ message: "Not authenticated" });
    const schoolId = parseInt(req.params.schoolId);
    if (req.session.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
    const { classSections } = req.body;
    if (!classSections || typeof classSections !== "object" || Array.isArray(classSections)) {
      return res.status(400).json({ message: "classSections must be an object" });
    }
    await storage.setClassSectionsMetadata(schoolId, classSections);
    res.json({ message: "Class-section mapping saved" });
  });

  app.put("/api/school-metadata/:schoolId/class-subjects-map", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(401).json({ message: "Not authenticated" });
    const schoolId = parseInt(req.params.schoolId);
    if (req.session.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
    const { classSubjects } = req.body;
    if (!classSubjects || typeof classSubjects !== "object" || Array.isArray(classSubjects)) {
      return res.status(400).json({ message: "classSubjects must be an object" });
    }
    await storage.setClassSubjectsMetadata(schoolId, classSubjects);
    res.json({ message: "Class-subject mapping saved" });
  });

  app.put("/api/school-metadata/:schoolId/class-exam-types-map", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(401).json({ message: "Not authenticated" });
    const schoolId = parseInt(req.params.schoolId);
    if (req.session.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
    const { classExamTypes } = req.body;
    if (!classExamTypes || typeof classExamTypes !== "object" || Array.isArray(classExamTypes)) {
      return res.status(400).json({ message: "classExamTypes must be an object" });
    }
    await storage.setClassExamTypesMetadata(schoolId, classExamTypes);
    res.json({ message: "Class-exam-type mapping saved" });
  });

  app.put("/api/school-metadata/:schoolId/:metaKey", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(401).json({ message: "Not authenticated" });
    const schoolId = parseInt(req.params.schoolId);
    if (req.session.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
    const { metaKey } = req.params;
    const validKeys = ["classes", "sections", "subjects", "exam_types"];
    if (!validKeys.includes(metaKey)) return res.status(400).json({ message: "Invalid meta key" });
    const { values } = req.body;
    if (!Array.isArray(values)) return res.status(400).json({ message: "Values must be an array" });
    const result = await storage.setSchoolMetadata(schoolId, metaKey, values);
    res.json(result);
  });

  // ===== ADMIN PASSWORD VERIFICATION (for Double-Lock Modal) =====
  app.post("/api/admin/verify-password", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: "Password is required" });
    const ok = await storage.verifyAdminPassword(req.session.userId, password);
    res.json({ valid: ok });
  });

  // ===== STUDENT DEACTIVATION =====
  app.post("/api/schools/:schoolId/students/:studentId/deactivate", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    const schoolId = parseInt(req.params.schoolId);
    const studentId = parseInt(req.params.studentId);
    if (isNaN(schoolId) || isNaN(studentId)) return res.status(400).json({ message: "Invalid ID" });
    if (req.session.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

    const { reason, password } = req.body;
    if (!reason) return res.status(400).json({ message: "Reason is required" });
    if (!password) return res.status(400).json({ message: "Admin password confirmation is required" });

    const passwordOk = await storage.verifyAdminPassword(req.session.userId, password);
    if (!passwordOk) return res.status(401).json({ message: "Incorrect password" });

    const student = await storage.getStudentById(studentId);
    if (!student || student.schoolId !== schoolId) return res.status(404).json({ message: "Student not found" });
    if (!student.isActive) return res.status(409).json({ message: "Student is already deactivated" });

    await storage.deactivateStudent(studentId);
    await storage.createAuditLog({
      schoolId,
      actionType: "deactivate",
      entityType: "student",
      entityId: studentId,
      actionBy: req.session.userId!,
      actionByRole: "admin",
      details: `Student ${student.name} (${student.digitalStudentId}) deactivated. Reason: ${reason}`,
    });
    res.json({ message: "Student deactivated successfully" });
  });

  // ===== TEACHER DEACTIVATION =====
  app.post("/api/schools/:schoolId/teachers/:teacherId/deactivate", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    const schoolId = parseInt(req.params.schoolId);
    const teacherId = parseInt(req.params.teacherId);
    if (isNaN(schoolId) || isNaN(teacherId)) return res.status(400).json({ message: "Invalid ID" });
    if (req.session.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

    const { reason, password } = req.body;
    if (!reason) return res.status(400).json({ message: "Reason is required" });
    if (!password) return res.status(400).json({ message: "Admin password confirmation is required" });

    const passwordOk = await storage.verifyAdminPassword(req.session.userId, password);
    if (!passwordOk) return res.status(401).json({ message: "Incorrect password" });

    const teacher = await storage.getTeacherById(teacherId);
    if (!teacher || teacher.schoolId !== schoolId) return res.status(404).json({ message: "Teacher not found" });

    await storage.deactivateTeacher(teacherId);
    await storage.createAuditLog({
      schoolId,
      actionType: "deactivate",
      entityType: "teacher",
      entityId: teacherId,
      actionBy: req.session.userId!,
      actionByRole: "admin",
      details: `Teacher ${teacher.fullName} deactivated. Reason: ${reason}`,
    });
    res.json({ message: "Teacher deactivated successfully" });
  });

  // ===== PATCH ALIASES (canonical contract) =====
  app.patch("/api/students/:studentId/deactivate", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    const studentId = parseInt(req.params.studentId);
    if (isNaN(studentId)) return res.status(400).json({ message: "Invalid student ID" });

    const { reason, password } = req.body;
    if (!reason) return res.status(400).json({ message: "Reason is required" });
    if (!password) return res.status(400).json({ message: "Admin password confirmation is required" });

    const passwordOk = await storage.verifyAdminPassword(req.session.userId, password);
    if (!passwordOk) return res.status(401).json({ message: "Incorrect password" });

    const student = await storage.getStudentById(studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    if (student.schoolId !== req.session.schoolId) return res.status(403).json({ message: "Access denied" });
    if (!student.isActive) return res.status(409).json({ message: "Student is already deactivated" });

    await storage.deactivateStudent(studentId);
    await storage.createAuditLog({
      schoolId: req.session.schoolId!,
      actionType: "deactivate",
      entityType: "student",
      entityId: studentId,
      actionBy: req.session.userId!,
      actionByRole: "admin",
      details: `Student ${student.name} (${student.digitalStudentId}) deactivated. Reason: ${reason}`,
    });
    res.json({ message: "Student deactivated successfully" });
  });

  // ===== ADMIN: STUDENT PROFILE SUMMARY (for Quick Action in attendance) =====
  app.get("/api/admin/students/:studentId/summary", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const studentId = parseInt(req.params.studentId);
    if (isNaN(studentId)) return res.status(400).json({ message: "Invalid student ID" });
    const { students: studentsTable } = await import("@shared/schema");
    const [row] = await db
      .select({
        id: studentsTable.id,
        name: studentsTable.name,
        class: studentsTable.class,
        section: studentsTable.section,
        digitalStudentId: studentsTable.digitalStudentId,
        phone: studentsTable.phone,
        isActive: studentsTable.isActive,
        rollNo: sql<string>`COALESCE(${studentProfiles.rollNo}, '')`.as("roll_no"),
        fatherName: sql<string>`COALESCE(${studentProfiles.fatherName}, '')`.as("father_name"),
        presentAddress: sql<string>`COALESCE(${studentProfiles.presentAddress}, '')`.as("present_address"),
      })
      .from(studentsTable)
      .leftJoin(studentProfiles, eq(studentProfiles.studentId, studentsTable.id))
      .where(and(eq(studentsTable.id, studentId), eq(studentsTable.schoolId, schoolId)));
    if (!row) return res.status(404).json({ message: "Student not found" });
    res.json(row);
  });

  app.patch("/api/teachers/:teacherId/deactivate", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    const teacherId = parseInt(req.params.teacherId);
    if (isNaN(teacherId)) return res.status(400).json({ message: "Invalid teacher ID" });

    const { reason, password } = req.body;
    if (!reason) return res.status(400).json({ message: "Reason is required" });
    if (!password) return res.status(400).json({ message: "Admin password confirmation is required" });

    const passwordOk = await storage.verifyAdminPassword(req.session.userId, password);
    if (!passwordOk) return res.status(401).json({ message: "Incorrect password" });

    const teacher = await storage.getTeacherById(teacherId);
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });
    if (teacher.schoolId !== req.session.schoolId) return res.status(403).json({ message: "Access denied" });

    await storage.deactivateTeacher(teacherId);
    await storage.createAuditLog({
      schoolId: req.session.schoolId!,
      actionType: "deactivate",
      entityType: "teacher",
      entityId: teacherId,
      actionBy: req.session.userId!,
      actionByRole: "admin",
      details: `Teacher ${teacher.fullName} deactivated. Reason: ${reason}`,
    });
    res.json({ message: "Teacher deactivated successfully" });
  });

  // ===== STUDENT PROFILE (Self-Service) =====
  const profileDiskUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(process.cwd(), "uploads", "student-photos");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const mimeToExt: Record<string, string> = {
          "image/jpeg": ".jpg",
          "image/jpg": ".jpg",
          "image/png": ".png",
          "image/gif": ".gif",
          "image/webp": ".webp",
          "image/avif": ".avif",
        };
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
        const ext = mimeToExt[file.mimetype] || ".jpg";
        cb(null, unique + ext);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

  app.get("/api/student/profile", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const profile = await storage.getStudentProfile(req.session.studentId);
    const approvedSnapshot = profile?.approvedSnapshot
      ? (() => { try { return JSON.parse(profile.approvedSnapshot); } catch { return null; } })()
      : null;
    res.json({
      profile: profile || null,
      approvedSnapshot,
      liveData: {
        name: student.name,
        class: student.class,
        section: student.section,
        digitalStudentId: student.digitalStudentId,
        photoUrl: student.photoUrl,
        enrollmentDate: student.enrollmentDate,
        verifiedProfile: student.verifiedProfile
          ? (() => { try { return JSON.parse(student.verifiedProfile); } catch { return null; } })()
          : null,
      },
    });
  });

  const saveProfileSchema = z.object({
    fullName: z.string().optional(),
    class: z.string().optional(),
    section: z.string().optional(),
    rollNo: z.string().optional(),
    fatherName: z.string().optional(),
    motherName: z.string().optional(),
    presentAddress: z.string().optional(),
  });

  app.post("/api/student/profile", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });

    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const existing = await storage.getStudentProfile(req.session.studentId);

    const parsed = saveProfileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const resetStatus = existing?.status === "approved" ? "draft" : undefined;

    const profile = await storage.upsertStudentProfile(
      {
        studentId: req.session.studentId,
        schoolId: student.schoolId,
        ...parsed.data,
      },
      resetStatus,
    );
    res.json(profile);
  });

  app.get("/api/student/verification-limit", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const allowed = 3;
    const used = await storage.countMonthlyVerifications(student.schoolId, req.session.studentId);
    const remaining = Math.max(0, allowed - used);
    res.json({ used, remaining, allowed });
  });

  app.post("/api/student/profile/submit", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });

    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const allowed = 3;
    const used = await storage.countMonthlyVerifications(student.schoolId, req.session.studentId);
    if (used >= allowed) {
      return res.status(429).json({ message: `You have used all ${allowed} verification submissions for this month. Please try again next month.` });
    }

    const existing = await storage.getStudentProfile(req.session.studentId);
    if (!existing) return res.status(400).json({ message: "Please save a draft before submitting" });
    if (existing.status === "pending") return res.status(409).json({ message: "Profile is already pending review" });
    if (existing.status === "approved") return res.status(409).json({ message: "Profile is already approved" });

    if (!existing.fullName || !existing.fatherName || !existing.motherName || !existing.presentAddress) {
      return res.status(400).json({ message: "Please fill in all required fields: Full Name, Father's Name, Mother's Name, and Present Address" });
    }

    await storage.logVerificationRequest(student.schoolId, req.session.studentId);
    const profile = await storage.submitStudentProfile(req.session.studentId);
    res.json(profile);
  });

  app.post(
    "/api/student/profile/photo",
    (req, res, next) => {
      if (!req.session.studentId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }
      next();
    },
    profileDiskUpload.single("photo"),
    async (req, res) => {
      if (!req.file) return res.status(400).json({ message: "No image uploaded" });
      const photoUrl = `/uploads/student-photos/${req.file.filename}`;
      const profile = await storage.updateStudentProfilePhoto(req.session.studentId!, photoUrl);
      res.json(profile);
    },
  );

  const changeStudentPasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6, "New password must be at least 6 characters"),
  });

  app.post("/api/student/change-password", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });

    const parsed = changeStudentPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const valid = await bcrypt.compare(parsed.data.currentPassword, student.passwordHash);
    if (!valid) return res.status(401).json({ message: "Current password is incorrect" });

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await storage.updateStudentPassword(req.session.studentId, passwordHash);
    res.json({ message: "Password changed successfully" });
  });

  // ===== STUDENT ATTENDANCE (Student-Facing Analytics) =====

  function getAcademicYearDates(academicYear: string): { startDate: string; endDate: string } | null {
    const match = academicYear.match(/^(\d{4})-(\d{2,4})$/);
    if (!match) return null;
    const startYear = parseInt(match[1], 10);
    const endYear = startYear + 1;
    const endSuffix = match[2];
    const expectedSuffix2 = String(endYear).slice(-2);
    const expectedSuffix4 = String(endYear);
    if (endSuffix !== expectedSuffix2 && endSuffix !== expectedSuffix4) return null;
    return {
      startDate: `${startYear}-04-01`,
      endDate: `${endYear}-03-31`,
    };
  }

  app.get("/api/student/attendance/monthly", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });

    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ message: "Invalid year or month" });
    }

    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const data = await storage.getStudentMonthlyAttendance(student.id, student.schoolId, year, month);
    res.json({ schoolId: student.schoolId, studentId: student.id, year, month, days: data });
  });

  app.get("/api/student/attendance/yearly", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });

    const academicYear = (req.query.academicYear as string) || "";
    const dates = getAcademicYearDates(academicYear);
    if (!dates) return res.status(400).json({ message: "Invalid academicYear format. Use YYYY-YY (e.g. 2025-26)" });

    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const data = await storage.getStudentYearlyAttendance(student.id, student.schoolId, student.class, student.section, dates.startDate, dates.endDate);
    res.json({ schoolId: student.schoolId, studentId: student.id, academicYear, months: data });
  });

  app.get("/api/student/attendance/stats", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });

    const academicYear = (req.query.academicYear as string) || "";
    const dates = academicYear ? getAcademicYearDates(academicYear) : null;

    const now = new Date();
    const academicStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const startDate = dates ? dates.startDate : `${academicStartYear}-04-01`;

    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const endDate = dates ? dates.endDate : undefined;
    const stats = await storage.getStudentAttendanceStats(student.id, student.schoolId, student.class, student.section, startDate, endDate);
    res.json({ schoolId: student.schoolId, studentId: student.id, startDate, ...stats });
  });

  // GET resolved attendance policy for the current student
  app.get("/api/student/attendance-policy", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const student = await storage.getStudentById(req.session.studentId);
      if (!student) return res.status(401).json({ message: "Student not found" });
      const policyRows = await db.select().from(attendancePolicies).where(
        and(eq(attendancePolicies.schoolId, student.schoolId), eq(attendancePolicies.isActive, true))
      );
      const resolved = resolvePolicy(policyRows, "STUDENT", student.class ?? "");
      res.json(resolved);
    } catch {
      res.json(DEFAULT_POLICY);
    }
  });

  // ===== STUDENT HOMEWORK ROUTES =====
  app.get("/api/student/homework", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const date = (req.query.date as string) || undefined;
    const items = await storage.getStudentHomework(student.schoolId, student.class, student.section, student.id, date);
    res.json(items);
  });

  app.get("/api/student/homework/:id", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const hwId = parseInt(req.params.id);
    if (isNaN(hwId)) return res.status(400).json({ message: "Invalid homework ID" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const hw = await storage.getHomeworkById(hwId);
    if (!hw) return res.status(404).json({ message: "Homework not found" });
    if (hw.schoolId !== student.schoolId || hw.class !== student.class || hw.section !== student.section) {
      return res.status(403).json({ message: "Access denied" });
    }
    const submission = await storage.getHomeworkSubmission(hwId, student.id);
    res.json({ ...hw, submission: submission || null });
  });

  {
    const ALLOWED_SUBMISSION_MIMES = new Set([
      "image/jpeg", "image/png", "image/webp",
      "application/pdf",
    ]);
    const ALLOWED_SUBMISSION_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);

    const homeworkSubmissionUpload = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
          const dir = path.join(process.cwd(), "uploads", "homework-submissions");
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
          cb(null, unique + path.extname(file.originalname).toLowerCase());
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_SUBMISSION_MIMES.has(file.mimetype) && ALLOWED_SUBMISSION_EXTS.has(ext)) {
          cb(null, true);
        } else {
          cb(new Error("Only JPG, PNG, WebP, and PDF files are allowed for homework submissions"));
        }
      },
    });

    app.post("/api/student/homework/:id/submit", async (req, res, next) => {
      if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
      next();
    }, (req, res, next) => {
      homeworkSubmissionUpload.single("file")(req, res, (err) => {
        if (err) return res.status(400).json({ message: err.message || "File upload failed" });
        next();
      });
    }, async (req, res) => {
      const hwId = parseInt(req.params.id);
      if (isNaN(hwId)) return res.status(400).json({ message: "Invalid homework ID" });
      const student = await storage.getStudentById(req.session.studentId!);
      if (!student) return res.status(404).json({ message: "Student not found" });
      const hw = await storage.getHomeworkById(hwId);
      if (!hw) return res.status(404).json({ message: "Homework not found" });
      if (hw.schoolId !== student.schoolId || hw.class !== student.class || hw.section !== student.section) {
        return res.status(403).json({ message: "Access denied" });
      }
      const existing = await storage.getHomeworkSubmission(hwId, student.id);
      if (existing?.status === "approved") {
        return res.status(400).json({ message: "This homework has already been approved and cannot be re-submitted" });
      }
      const fileUrl = req.file ? `/uploads/homework-submissions/${req.file.filename}` : undefined;
      const textAnswer = typeof req.body?.textAnswer === "string" && req.body.textAnswer.trim()
        ? req.body.textAnswer.trim()
        : undefined;
      if (!fileUrl && !textAnswer && !existing) {
        return res.status(400).json({ message: "Please write an answer or upload a file before submitting." });
      }
      const today = new Date().toISOString().split("T")[0];
      const isLate = hw.dueDate ? hw.dueDate < today : false;
      const submission = await storage.upsertHomeworkSubmission({
        homeworkId: hwId,
        studentId: student.id,
        schoolId: student.schoolId,
        fileUrl,
        textAnswer,
      });
      res.json({ submission, isLate });
    });
  }

  // ===== STUDENT EXAM ROUTES =====
  app.get("/api/student/exam/classes", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const classes = await storage.getStudentDistinctClasses(student.schoolId, student.id);
    res.json({ classes });
  });

  app.get("/api/student/exam/types", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const requestedCls = (req.query.class as string) || student.class;
    const allowedClasses = await storage.getStudentDistinctClasses(student.schoolId, student.id);
    const cls = (requestedCls === student.class || allowedClasses.includes(requestedCls))
      ? requestedCls : student.class;
    const examTypes = await storage.getStudentExamTypes(student.schoolId, cls, student.section);
    res.json({ examTypes });
  });

  app.get("/api/student/exam/scores", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const requestedCls = (req.query.class as string) || student.class;
    const allowedClasses = await storage.getStudentDistinctClasses(student.schoolId, student.id);
    const cls = (requestedCls === student.class || allowedClasses.includes(requestedCls))
      ? requestedCls : student.class;
    const examType = req.query.examType as string;
    if (!examType) return res.status(400).json({ message: "examType is required" });
    const scores = await storage.getStudentExamScores(student.schoolId, student.id, cls, examType);
    let rank: { rank: number; total: number } | null = null;
    if (scores.length > 0) {
      rank = await storage.getClassRank(student.schoolId, cls, student.section, examType, student.id);
    }
    const totalObtained = scores.filter(s => !s.isAbsent).reduce((sum, s) => sum + s.marks, 0);
    const totalMax = scores.reduce((sum, s) => sum + s.totalMarks, 0);
    const percentage = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100 * 10) / 10 : 0;
    const grade = percentage >= 90 ? "A+" : percentage >= 80 ? "A" : percentage >= 70 ? "B+" :
      percentage >= 60 ? "B" : percentage >= 50 ? "C" : percentage >= 40 ? "D" : "F";
    res.json({ scores, summary: { totalObtained, totalMax, percentage, grade, rank } });
  });

  app.get("/api/student/exam/journey", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const classes = await storage.getStudentDistinctClasses(student.schoolId, student.id);
    const allClasses = classes.length > 0 ? classes : [student.class];
    const journey: { cls: string; examType: string; percentage: number }[] = [];
    for (const cls of allClasses) {
      const examTypes = await storage.getStudentExamTypes(student.schoolId, cls, student.section);
      if (examTypes.length === 0) continue;
      const finalExamType = examTypes.includes("Annual") ? "Annual" : examTypes[examTypes.length - 1];
      const scores = await storage.getStudentExamScores(student.schoolId, student.id, cls, finalExamType);
      if (scores.length === 0) continue;
      const obtained = scores.filter(s => !s.isAbsent).reduce((sum, s) => sum + s.marks, 0);
      const total = scores.reduce((sum, s) => sum + s.totalMarks, 0);
      const pct = total > 0 ? Math.round((obtained / total) * 100 * 10) / 10 : 0;
      journey.push({ cls, examType: finalExamType, percentage: pct });
    }
    res.json({ journey });
  });

  // ===== STUDENT CLASSWORK ROUTES =====
  app.get("/api/student/classwork", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const date = (req.query.date as string) || undefined;
    const items = await storage.getStudentClasswork(student.schoolId, student.class, student.section, date);
    res.json(items);
  });

  // ===== STUDENT GALLERY ROUTES =====

  app.get("/api/student/gallery/tags", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const tags = await storage.getGalleryTagsBySchool(student.schoolId);
    res.json(tags);
  });

  app.get("/api/student/gallery", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const tag = (req.query.tag as string) || undefined;
    const items = await storage.getApprovedGalleryItems(student.schoolId, tag);
    res.json(items);
  });

  // ===== STUDENT FACULTY ROUTES =====

  app.get("/api/student/faculty", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const mapped = await storage.getFacultyByClassSection(student.schoolId, student.class, student.section);
    if (mapped.length > 0) {
      res.json(mapped);
    } else {
      const faculty = await storage.getFacultyBySchool(student.schoolId);
      res.json(faculty);
    }
  });

  // ===== ADMIN CALENDAR ROUTES =====

  app.get("/api/admin/calendar", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;
    const { month, year } = req.query;
    if (month && year) {
      const m = parseInt(month as string);
      const y = parseInt(year as string);
      const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const endDate = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const events = await storage.getCalendarEventsByRange(schoolId, startDate, endDate);
      return res.json(events);
    }
    const events = await storage.getCalendarEvents(schoolId);
    res.json(events);
  });

  app.post("/api/admin/calendar", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;
    const { title, description, eventType, startDate, endDate, isRecurring, colorCode, audienceScope, targetClass, targetSection } = req.body;
    if (!title || !eventType || !startDate) return res.status(400).json({ message: "title, eventType, startDate required" });
    let scopeValue: string = "All_School";
    if (audienceScope === "Multi_Target") {
      scopeValue = "Multi_Target";
    } else if (targetClass && targetSection) {
      scopeValue = "Specific_Section";
    } else if (targetClass) {
      scopeValue = "Entire_Class";
    } else if (audienceScope === "Entire_Class") {
      scopeValue = "Entire_Class";
    } else if (audienceScope === "Specific_Section") {
      scopeValue = "Specific_Section";
    }
    if (scopeValue !== "All_School" && !targetClass) {
      return res.status(400).json({ message: "targetClass is required for class-targeted events" });
    }
    const color = colorCode || (eventType === "holiday" ? "#ef4444" : eventType === "examination" ? "#3b82f6" : "#10b981");

    const baseInsert = {
      schoolId, title, description: description || null, eventType, venue: null, colorCode: color,
      isRecurring: !!isRecurring, audienceScope: scopeValue,
      targetClass: scopeValue !== "All_School" ? (targetClass as string) : null,
      targetSection: (scopeValue === "Specific_Section" || scopeValue === "Multi_Target") ? (targetSection as string) : null,
    };
    const entries: { schoolId: number; title: string; description: string | null; eventType: string; venue: null; colorCode: string; isRecurring: boolean; date: string; audienceScope: string; targetClass: string | null; targetSection: string | null }[] = [];

    const start = new Date(startDate + "T00:00:00");
    const end = endDate ? new Date(endDate + "T00:00:00") : start;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      entries.push({ ...baseInsert, date: dateStr });
    }

    if (isRecurring) {
      const CALENDAR_HORIZON = 2126;
      const startYear = new Date(startDate + "T00:00:00").getFullYear();
      const extraYears = Math.max(0, CALENDAR_HORIZON - startYear);
      const baseEntries = [...entries];
      for (let yearOffset = 1; yearOffset <= extraYears; yearOffset++) {
        baseEntries.forEach(e => {
          const origDate = new Date(e.date + "T00:00:00");
          origDate.setFullYear(origDate.getFullYear() + yearOffset);
          const futureDate = `${origDate.getFullYear()}-${String(origDate.getMonth() + 1).padStart(2, "0")}-${String(origDate.getDate()).padStart(2, "0")}`;
          entries.push({ ...e, date: futureDate });
        });
      }
    }

    const created = await storage.createCalendarEvents(entries);
    res.status(201).json(created);
  });

  app.patch("/api/admin/calendar/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const { title, description, eventType, date, venue, colorCode, isRecurring, audienceScope, targetClass, targetSection } = req.body;
    if (!title || !eventType || !date) return res.status(400).json({ message: "title, eventType, date required" });
    let scopeValue: string = "All_School";
    if (audienceScope === "Multi_Target") {
      scopeValue = "Multi_Target";
    } else if (targetClass && targetSection) {
      scopeValue = "Specific_Section";
    } else if (targetClass) {
      scopeValue = "Entire_Class";
    } else if (audienceScope === "Entire_Class") {
      scopeValue = "Entire_Class";
    } else if (audienceScope === "Specific_Section") {
      scopeValue = "Specific_Section";
    }
    const color = colorCode || (eventType === "holiday" ? "#ef4444" : eventType === "examination" ? "#3b82f6" : "#10b981");
    const updated = await storage.updateCalendarEvent(id, schoolId, {
      title, description: description || null, eventType, date, venue: venue || null, colorCode: color,
      isRecurring: !!isRecurring, audienceScope: scopeValue,
      targetClass: scopeValue !== "All_School" ? (targetClass || null) : null,
      targetSection: (scopeValue === "Specific_Section" || scopeValue === "Multi_Target") ? (targetSection || null) : null,
    });
    if (!updated) return res.status(404).json({ message: "Event not found or access denied" });
    res.json(updated);
  });

  app.delete("/api/admin/calendar/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const ok = await storage.deleteCalendarEventBySchool(id, schoolId);
    if (!ok) return res.status(404).json({ message: "Event not found or access denied" });
    res.json({ message: "Deleted" });
  });

  // seed-holidays endpoint removed — all calendar entries must be created manually by the admin.

  // ===== STUDENT CALENDAR ROUTES =====

  app.get("/api/student/calendar", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const studentFilter = student.class ? [{ cls: student.class, sec: student.section || undefined }] : undefined;
    const monthParam = req.query.month !== undefined ? parseInt(req.query.month as string) : null;
    const yearParam = req.query.year ? parseInt(req.query.year as string) : null;
    if (yearParam !== null && monthParam === null) {
      const startDate = `${yearParam}-01-01`;
      const endDate = `${yearParam}-12-31`;
      const events = await storage.getCalendarEventsByRange(student.schoolId, startDate, endDate, studentFilter);
      return res.json(events);
    }
    if (monthParam !== null && yearParam !== null) {
      const firstDay = new Date(yearParam, monthParam, 1);
      const lastDay = new Date(yearParam, monthParam + 1, 0);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const events = await storage.getCalendarEventsByRange(student.schoolId, fmt(firstDay), fmt(lastDay), studentFilter);
      return res.json(events);
    }
    const events = await storage.getCalendarEvents(student.schoolId, studentFilter);
    res.json(events);
  });

  // ===== STUDENT TIMETABLE ROUTES =====

  app.get("/api/student/timetable", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const all = await storage.getTimetableBySchool(student.schoolId);
    // Show all configured entries (draft + published) — students should see
    // their schedule as soon as it is set up, regardless of publish status.
    const entries = all.filter(e =>
      e.class === student.class && e.section === student.section
    );
    const structure = await storage.getTimetableStructure(student.schoolId, student.class || "");
    res.json({ entries, structure });
  });

  // ===== STUDENT LEAVE ROUTES =====

  // Memory-storage multer — avoids diskStorage callback complexity that prevented req.body from being populated
  const leaveMemUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // Single atomic endpoint: fields + optional file arrive together, file written to disk from buffer
  app.post("/api/student/leave", leaveMemUpload.single("file"), async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    // Archive-mode guard
    const viewSessionId = req.headers["x-view-session-id"];
    if (viewSessionId) {
      const sessionId = parseInt(viewSessionId as string, 10);
      if (!isNaN(sessionId)) {
        const sessions = await storage.getAcademicSessions(student.schoolId);
        const targetSession = sessions.find(s => s.id === sessionId);
        if (targetSession && !targetSession.isActive) {
          return res.status(403).json({ error: "Security Block: Leave applications cannot be submitted for historical academic terms." });
        }
      }
    }

    const startDate  = req.body?.startDate  ?? req.body?.start_date;
    const endDate    = req.body?.endDate    ?? req.body?.end_date;
    const reason     = req.body?.reason;
    const category   = req.body?.category;

    if (!startDate || !endDate || !reason) {
      return res.status(400).json({ message: "startDate, endDate, and reason are required" });
    }

    // Save uploaded file buffer to disk (if any)
    let attachmentUrl: string | null = null;
    if (req.file?.buffer) {
      const dir = path.join(process.cwd(), "uploads", "leave-attachments");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(req.file.originalname) || ".bin";
      const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      fs.writeFileSync(path.join(dir, filename), req.file.buffer);
      attachmentUrl = `/uploads/leave-attachments/${filename}`;
    }

    const leave = await storage.createStudentLeaveRequest({
      studentId: student.id,
      schoolId: student.schoolId,
      startDate,
      endDate,
      reason,
      status: "pending_teacher",
      category: category || null,
      attachmentUrl,
    });
    res.status(201).json(leave);
  });

  app.get("/api/student/leave", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const leaves = await storage.getStudentLeavesByStudent(req.session.studentId);
    res.json(leaves);
  });

  app.delete("/api/student/leave/:id", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const result = await storage.deleteStudentLeaveRequest(id, req.session.studentId);
    if (!result.success) {
      if (result.reason === "not_found") return res.status(404).json({ message: "Leave request not found" });
      if (result.reason === "forbidden") return res.status(403).json({ message: "Not authorized" });
      if (result.reason === "not_pending") return res.status(400).json({ message: "Only pending leave requests can be deleted" });
    }
    res.json({ message: "Leave request deleted" });
  });

  // ===== STUDENT NOTICEBOARD ROUTES =====

  app.get("/api/student/notices", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const noticesWithRead = await storage.getStudentNotices(
      student.id,
      student.schoolId,
      student.class || "",
      student.section || ""
    );
    res.json(noticesWithRead);
  });

  app.post("/api/student/notices/mark-read", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const { noticeIds } = req.body;
    if (!Array.isArray(noticeIds)) return res.status(400).json({ message: "noticeIds must be an array" });
    const requestedIds = noticeIds.map(Number).filter(n => !isNaN(n));
    if (requestedIds.length === 0) return res.json({ marked: 0 });
    // Only allow marking notices that are actually visible to this student
    const eligibleNotices = await storage.getStudentNotices(
      student.id,
      student.schoolId,
      student.class || "",
      student.section || ""
    );
    const eligibleIds = new Set(eligibleNotices.map(n => n.id));
    const ids = requestedIds.filter(id => eligibleIds.has(id));
    await storage.markNoticesRead(req.session.studentId, ids);
    res.json({ marked: ids.length });
  });

  app.get("/api/student/notices/unread-count", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const count = await storage.getUnreadNoticeCount(
      student.id,
      student.schoolId,
      student.class || "",
      student.section || ""
    );
    res.json({ count });
  });

  // ===== STUDENT COMPLAINT ROUTES =====

  app.get("/api/student/complaints/inbox", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const list = await storage.getStudentInboxComplaints(student.id, student.schoolId);
    res.json(list);
  });

  app.get("/api/student/complaints/filed", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const list = await storage.getStudentFiledComplaints(student.id, student.schoolId);
    res.json(list);
  });

  app.get("/api/student/complaint-teachers", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const teachers = await storage.getTeachersBySchool(student.schoolId);
    res.json(teachers.map(t => ({ id: t.id, name: t.fullName, subject: t.subject })));
  });

  app.post("/api/student/complaints/staff-grievance", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const { teacherId, content, contactNumber, suggestions } = req.body;
    if (!teacherId || !content?.trim()) {
      return res.status(400).json({ message: "Teacher and complaint description are required" });
    }
    const targetTeacher = await storage.getTeacherById(parseInt(teacherId));
    if (!targetTeacher || targetTeacher.schoolId !== student.schoolId) {
      return res.status(400).json({ message: "Invalid staff member" });
    }
    const ticketId = await storage.getNextTicketId(student.schoolId);
    const complaint = await storage.createStudentComplaint({
      ticketId,
      teacherId: targetTeacher.id,
      complainantStudentId: student.id,
      schoolId: student.schoolId,
      complaintType: "student-to-staff",
      content: content.trim(),
      contactNumber: contactNumber?.trim() || null,
      suggestions: suggestions?.trim() || null,
      status: "Pending",
      isDeleted: false,
    });
    res.status(201).json(complaint);
  });

  // Student peer-search (student-session only, excludes self)
  app.get("/api/student/search-peers", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const q = (req.query.q as string) || "";
    if (q.length < 2) return res.json([]);
    const results = await storage.searchStudents(student.schoolId, q);
    res.json(results.filter(s => s.id !== req.session.studentId));
  });

  app.post("/api/student/complaints/peer-report", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const { reportedStudentName, reportedStudentId, incidentDate, content } = req.body;
    if (!reportedStudentName?.trim() || !content?.trim()) {
      return res.status(400).json({ message: "Reported student name and description are required" });
    }
    const ticketId = await storage.getNextTicketId(student.schoolId);
    const complaint = await storage.createStudentComplaint({
      ticketId,
      complainantStudentId: student.id,
      studentId: reportedStudentId ? parseInt(reportedStudentId) : null,
      schoolId: student.schoolId,
      complaintType: "student-peer-report",
      content: content.trim(),
      reportedStudentName: reportedStudentName.trim(),
      incidentDate: incidentDate ? new Date(incidentDate) : null,
      status: "Pending",
      isDeleted: false,
      complainantClass: student.class,
      complainantSection: student.section,
    });
    res.status(201).json(complaint);
  });

  // ===== STUDENT COMPLAINT NOTES =====
  // GET notes for a complaint the student is a party to
  app.get("/api/student/complaints/:id/notes", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(401).json({ message: "Student not found" });
    const complaintId = parseInt(req.params.id);
    if (isNaN(complaintId)) return res.status(400).json({ message: "Invalid id" });
    const c = await storage.getComplaintByIdForSchool(complaintId, student.schoolId);
    if (!c) return res.status(404).json({ message: "Complaint not found" });
    // Only allow if this student is the recipient (inbox) or the filer
    const isRecipient = c.studentId === student.id;
    const isFiler = c.complainantStudentId === student.id;
    if (!isRecipient && !isFiler) return res.status(403).json({ message: "Access denied" });
    const notes = await storage.getComplaintNotes(complaintId);
    res.json(notes);
  });

  // POST a comment on a complaint the student is a party to
  app.post("/api/student/complaints/:id/notes", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(401).json({ message: "Student not found" });
    const complaintId = parseInt(req.params.id);
    if (isNaN(complaintId)) return res.status(400).json({ message: "Invalid id" });
    const c = await storage.getComplaintByIdForSchool(complaintId, student.schoolId);
    if (!c) return res.status(404).json({ message: "Complaint not found" });
    const isRecipient = c.studentId === student.id;
    const isFiler = c.complainantStudentId === student.id;
    if (!isRecipient && !isFiler) return res.status(403).json({ message: "Access denied" });
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ message: "Content required" });
    const note = await storage.addComplaintNote({
      complaintId,
      authorId: student.id,
      authorRole: "student",
      authorName: student.name,
      content: content.trim(),
    });
    res.status(201).json(note);
  });

  // ===== ADMIN TEACHERS: PATCH (edit assignment — strict session-scoped) =====
  const editTeacherSchema = z.object({
    fullName: z.string().min(2, "Name must be at least 2 characters").optional(),
    phone: z.string().min(7).optional(),
    designation: z.string().optional(),
  });

  app.patch("/api/admin/teachers/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school associated with session" });
    const teacherId = parseInt(req.params.id);
    if (isNaN(teacherId)) return res.status(400).json({ message: "Invalid teacher ID" });
    const parsed = editTeacherSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    try {
      const existing = await storage.getTeacherById(teacherId);
      if (!existing || existing.schoolId !== schoolId) return res.status(404).json({ message: "Teacher not found" });
      const updated = await storage.updateTeacherAssignment(teacherId, schoolId, {
        fullName: parsed.data.fullName ?? existing.fullName,
        subject: existing.subject,
        assignedClass: existing.assignedClass,
        assignedSection: existing.assignedSection,
        phone: parsed.data.phone ?? existing.phone,
        designation: parsed.data.designation ?? existing.designation ?? "",
      });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Failed to update teacher" });
    }
  });

  // ===== ADMIN SCHOOL CONFIG (strict session-scoped) =====
  app.get("/api/admin/school-config", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school associated with session" });
    try {
      const meta = await storage.getAllSchoolMetadata(schoolId);
      const classSections = await storage.getClassSectionsMap(schoolId);
      res.json({
        classes: meta["classes"] ?? [],
        sections: meta["sections"] ?? [],
        subjects: meta["subjects"] ?? [],
        classSections,
      });
    } catch {
      res.json({ classes: [], sections: [], subjects: [], classSections: {} });
    }
  });

  // ===== ADMIN ATTENDANCE: CLASS DETAIL =====
  app.get("/api/admin/attendance/class-detail", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school associated with session" });
    const { class: cls, section, date } = req.query as { class?: string; section?: string; date?: string };
    if (!cls || !section || !date) return res.status(400).json({ message: "class, section, and date are required" });
    console.log(`[class-detail] schoolId=${schoolId} class=${cls} section=${section} date=${date}`);
    try {
      const { students: studentsTable } = await import("@shared/schema");
      // Fetch students with their rollNo via LEFT JOIN on student_profiles
      const studentRows = await db
        .select({
          id: studentsTable.id,
          name: studentsTable.name,
          digitalStudentId: studentsTable.digitalStudentId,
          rollNo: sql<string>`COALESCE(${studentProfiles.rollNo}, '')`.as("roll_no"),
        })
        .from(studentsTable)
        .leftJoin(studentProfiles, eq(studentProfiles.studentId, studentsTable.id))
        .where(
          and(
            eq(studentsTable.schoolId, schoolId),
            eq(studentsTable.class, cls),
            eq(studentsTable.section, section),
            eq(studentsTable.isActive, true)
          )
        );
      // SQL-level filter: school_id + date + student_id IN (...) — no in-memory scan
      const studentIdList = studentRows.map(s => s.id);
      const filteredRecords = studentIdList.length > 0
        ? await db.select().from(attendanceRecords).where(
            and(
              eq(attendanceRecords.schoolId, schoolId),
              eq(attendanceRecords.date, date),
              inArray(attendanceRecords.studentId, studentIdList)
            )
          )
        : [];
      const result = studentRows.map(student => {
        const record = filteredRecords.find(r => r.studentId === student.id);
        return {
          studentId: student.id,
          name: student.name,
          rollNo: student.rollNo ?? "",
          digitalStudentId: student.digitalStudentId,
          status: (record && record.status) ? record.status : "not-marked",
        };
      });

      // Build submission metadata from attendance_records
      const submittedRecs = filteredRecords.filter(r => r.markedAt).sort(
        (a, b) => new Date(a.markedAt as Date).getTime() - new Date(b.markedAt as Date).getTime()
      );
      const firstSubmitted = submittedRecs[0] ?? null;
      const editedRecs = filteredRecords
        .filter(r => (r.editCount ?? 0) > 0 && r.markedAt)
        .sort((a, b) => new Date(b.markedAt as Date).getTime() - new Date(a.markedAt as Date).getTime());
      const lastEdited = editedRecs[0] ?? null;

      const meta = {
        isSubmitted: filteredRecords.length > 0,
        submittedBy: firstSubmitted?.markedBy ?? null,
        submittedAt: firstSubmitted?.markedAt ? new Date(firstSubmitted.markedAt as Date).toISOString() : null,
        lastModifiedAt: lastEdited?.markedAt ? new Date(lastEdited.markedAt as Date).toISOString() : null,
        modifiedBy: lastEdited?.markedBy ?? null,
      };

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.json({ meta, students: result });
    } catch (err) {
      console.error("class-detail error:", err);
      res.status(500).json({ message: "Failed to fetch class attendance" });
    }
  });

  // ===== ADMIN ATTENDANCE: SCHOOL-WIDE OVERVIEW (enrollment-based) =====
  app.get("/api/admin/attendance/overview", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school associated with session" });
    const { date } = req.query as { date?: string };
    if (!date) return res.status(400).json({ message: "date is required" });
    try {
      const { students: studentsTable } = await import("@shared/schema");
      const enrolledRows = await db.select({ id: studentsTable.id })
        .from(studentsTable)
        .where(and(eq(studentsTable.schoolId, schoolId), eq(studentsTable.isActive, true)));
      const enrolledTotal = enrolledRows.length;

      const recs = await db.select().from(attendanceRecords)
        .where(and(eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.date, date)));

      const markedTotal = recs.length;
      const present = recs.filter(r => r.status === "present").length;
      const absent = recs.filter(r => r.status === "absent").length;
      const leave = recs.filter(r => r.status === "leave").length;
      const percentage = markedTotal > 0 ? Math.round((present / markedTotal) * 100) : 0;

      res.json({ enrolledTotal, markedTotal, present, absent, leave, percentage });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch attendance overview" });
    }
  });

  app.get("/api/admin/attendance/teacher-summary", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school associated with session" });
    const { date } = req.query as { date?: string };
    if (!date) return res.status(400).json({ message: "date is required" });
    try {
      const [allTeachers, selfAttRows, mappingRows, corrRows, studentRecords, policyRows] = await Promise.all([
        storage.getTeachersBySchool(schoolId),
        db.select().from(teacherSelfAttendance).where(
          and(eq(teacherSelfAttendance.schoolId, schoolId), eq(teacherSelfAttendance.attendanceDate, date))
        ),
        db.select().from(facultyMappings).where(eq(facultyMappings.schoolId, schoolId)),
        db.select().from(attendanceCorrectionRequests).where(
          and(eq(attendanceCorrectionRequests.schoolId, schoolId), eq(attendanceCorrectionRequests.attendanceDate, date))
        ),
        db.select().from(attendanceRecords).where(
          and(eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.date, date))
        ),
        db.select().from(attendancePolicies).where(
          and(eq(attendancePolicies.schoolId, schoolId), eq(attendancePolicies.isActive, true))
        ),
      ]);

      // Self-attendance map: teacherId → record
      const selfMap = new Map<number, typeof selfAttRows[0]>();
      for (const r of selfAttRows) selfMap.set(r.teacherId, r);

      // Faculty mappings: teacherId → unique subjects array
      const subjMap = new Map<number, Set<string>>();
      for (const m of mappingRows) {
        if (!subjMap.has(m.teacherId)) subjMap.set(m.teacherId, new Set());
        if (m.subject) subjMap.get(m.teacherId)!.add(m.subject);
      }

      // Faculty mappings: teacherId → unique class-section pairs (e.g. ["6-A", "7-B"])
      const csMap = new Map<number, Set<string>>();
      for (const m of mappingRows) {
        if (!csMap.has(m.teacherId)) csMap.set(m.teacherId, new Set());
        csMap.get(m.teacherId)!.add(`${m.className}-${m.section}`);
      }

      // Correction counts per teacher for this date
      const corrMap = new Map<number, number>();
      for (const c of corrRows) corrMap.set(c.teacherId, (corrMap.get(c.teacherId) ?? 0) + 1);

      // Student-marking map: teacherId → earliest markedAt
      const markMap = new Map<number, Date>();
      for (const r of studentRecords) {
        if (!r.markedAt) continue;
        const existing = markMap.get(r.teacherId);
        if (!existing || r.markedAt < existing) markMap.set(r.teacherId, r.markedAt);
      }

      const result = allTeachers.map(t => {
        const selfRec = selfMap.get(t.id) ?? null;
        const subjectsFromMappings = Array.from(subjMap.get(t.id) ?? []);
        const primarySubject = subjectsFromMappings[0] ?? t.subject ?? "";
        const department = primarySubject || t.department || "";
        // All subjects across all faculty mappings for this teacher
        const subjects = subjectsFromMappings.length > 0
          ? subjectsFromMappings
          : (t.subject ? [t.subject] : []);
        const corrCount = corrMap.get(t.id) ?? 0;
        const studentMarkAt = markMap.get(t.id) ?? null;

        // Re-evaluate status against current policy (heals stale records)
        const teacherPolicy = resolvePolicy(policyRows, "TEACHER", t.assignedClass ?? "");
        const selfStatus    = selfRec
          ? recomputeStatus(selfRec, teacherPolicy)
          : "Not Marked";
        const isLate = selfStatus === "Late";

        // Collect all class-section assignments from faculty mappings
        const assignedClassSections = Array.from(csMap.get(t.id) ?? []).sort();

        return {
          teacherId: t.id,
          name: t.fullName,
          assignedClass: t.assignedClass ?? "",
          assignedSection: t.assignedSection ?? "",
          assignedClassSections,
          subject: primarySubject,
          subjects,
          department,
          selfStatus,
          selfCheckIn: selfRec?.checkInTime ? (selfRec.checkInTime as Date).toISOString() : null,
          selfCheckOut: selfRec?.checkOutTime ? (selfRec.checkOutTime as Date).toISOString() : null,
          selfWorkedMinutes: selfRec?.totalWorkingMinutes ?? 0,
          isLate,
          hasCorrectionAudit: corrCount > 0,
          correctionCount: corrCount,
          studentMarkStatus: studentMarkAt ? "marked" : "not-marked",
          submittedAt: studentMarkAt ? studentMarkAt.toISOString() : null,
        };
      });

      const totalFaculty = result.length;
      const present = result.filter(r => r.selfStatus === "Present").length;
      const notMarked = result.filter(r => r.selfStatus === "Not Marked").length;
      const lateArrivals = result.filter(r => r.selfStatus === "Late").length;
      const onLeave = result.filter(r => r.selfStatus === "Leave").length;
      const halfDay = result.filter(r => r.selfStatus === "Half Day").length;
      const pendingCorrections = corrRows.filter(c => c.status === "Pending").length;
      const totalCorrections = corrRows.length;

      res.json({
        summary: { totalFaculty, present, notMarked, lateArrivals, onLeave, halfDay, pendingCorrections, totalCorrections },
        teachers: result,
      });
    } catch (err) {
      console.error("teacher-summary error:", err);
      res.status(500).json({ message: "Failed to fetch teacher attendance summary" });
    }
  });

  // ===== ACADEMIC SESSIONS API =====
  // All routes are admin-only and strictly scoped to req.session.schoolId (tenant isolation).

  app.get("/api/admin/academic-sessions", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    try {
      const rows = await storage.getAcademicSessions(schoolId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message || "Failed to fetch sessions" });
    }
  });

  app.post("/api/admin/academic-sessions", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    try {
      const schema = z.object({
        sessionName: z.string().min(1, "Session name is required"),
        startDate:   z.string().min(1, "Start date is required"),
        endDate:     z.string().min(1, "End date is required"),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

      const session = await storage.createAcademicSession({
        schoolId,
        sessionName: parsed.data.sessionName.trim(),
        startDate:   parsed.data.startDate,
        endDate:     parsed.data.endDate,
        isActive:    false, // always starts inactive; admin must explicitly activate
      });
      res.status(201).json(session);
    } catch (e: any) {
      res.status(500).json({ message: e.message || "Failed to create session" });
    }
  });

  /**
   * Activate a session — atomically deactivates all sibling sessions for this
   * school before marking the target active (see storage.activateAcademicSession).
   */
  app.patch("/api/admin/academic-sessions/:id/activate", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
    try {
      const updated = await storage.activateAcademicSession(id, schoolId);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message || "Failed to activate session" });
    }
  });

  app.delete("/api/admin/academic-sessions/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
    try {
      await storage.deleteAcademicSession(id, schoolId);
      res.json({ message: "Session deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "Failed to delete session" });
    }
  });

  // ===== ATTENDANCE POLICY ENGINE — CRUD =====

  app.get("/api/admin/attendance-policies", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    try {
      const rows = await db.select().from(attendancePolicies)
        .where(eq(attendancePolicies.schoolId, schoolId))
        .orderBy(attendancePolicies.id);
      res.json(rows);
    } catch { res.status(500).json({ message: "Failed to fetch policies" }); }
  });

  app.get("/api/admin/attendance-policies/resolve", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const { role, class: cls } = req.query as { role?: string; class?: string };
    if (!role) return res.status(400).json({ message: "role is required" });
    try {
      const rows = await db.select().from(attendancePolicies)
        .where(and(eq(attendancePolicies.schoolId, schoolId), eq(attendancePolicies.isActive, true)));
      res.json(resolvePolicy(rows, role, cls ?? ""));
    } catch { res.status(500).json({ message: "Failed to resolve policy" }); }
  });

  app.post("/api/admin/attendance-policies", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    try {
      const parsed = insertAttendancePolicySchema.parse({ ...req.body, schoolId });
      const [created] = await db.insert(attendancePolicies).values(parsed).returning();
      res.status(201).json(created);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: err.errors });
      res.status(500).json({ message: "Failed to create policy" });
    }
  });

  app.put("/api/admin/attendance-policies/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    try {
      const [existing] = await db.select().from(attendancePolicies)
        .where(and(eq(attendancePolicies.id, id), eq(attendancePolicies.schoolId, schoolId)));
      if (!existing) return res.status(404).json({ message: "Policy not found" });
      const { id: _id, schoolId: _sid, createdAt: _c, ...rest } = req.body;
      const [updated] = await db.update(attendancePolicies)
        .set({ ...rest, updatedAt: new Date() })
        .where(and(eq(attendancePolicies.id, id), eq(attendancePolicies.schoolId, schoolId)))
        .returning();
      res.json(updated);
    } catch { res.status(500).json({ message: "Failed to update policy" }); }
  });

  app.delete("/api/admin/attendance-policies/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    try {
      const [deleted] = await db.delete(attendancePolicies)
        .where(and(eq(attendancePolicies.id, id), eq(attendancePolicies.schoolId, schoolId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Policy not found" });
      res.json({ message: "Policy deleted" });
    } catch { res.status(500).json({ message: "Failed to delete policy" }); }
  });

  // ===== ADMIN: EDIT STUDENT =====
  const updateStudentSchema = z.object({
    name: z.string().min(2),
    class: z.string().min(1),
    section: z.string().min(1),
    phone: z.string().regex(/^[0-9+\-\s()]{7,15}$/),
    gender: z.enum(["Boy", "Girl"]).optional().nullable(),
    rollNumber: z.number().int().positive().optional().nullable(),
    guardianName: z.string().optional().nullable(),
  });

  app.patch("/api/admin/students/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid student ID" });
    const parsed = updateStudentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const { rollNumber, ...rest } = parsed.data;
    if (rollNumber) {
      const conflict = await db.select({ id: students.id }).from(students)
        .where(and(eq(students.schoolId, schoolId), eq(students.class, rest.class), eq(students.section, rest.section), eq(students.rollNumber, rollNumber), eq(students.isActive, true)));
      if (conflict.length > 0 && conflict[0].id !== id) {
        return res.status(409).json({ message: `Roll number ${rollNumber} is already assigned in ${rest.class}-${rest.section}` });
      }
    }
    const updated = await storage.updateStudent(id, schoolId, { ...rest, rollNumber: rollNumber ?? null });
    if (!updated) return res.status(404).json({ message: "Student not found" });
    res.json(updated);
  });

  // ===== ADMIN: STUDENT GENDER STATS =====
  app.get("/api/schools/:schoolId/students/stats", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = parseInt(req.params.schoolId);
    if (isNaN(schoolId) || req.session.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
    const { cls, section } = req.query as { cls?: string; section?: string };
    const stats = await storage.getStudentStats(schoolId, cls || undefined, section || undefined);
    res.json(stats);
  });

  // ===== ADMIN: AUTO-ASSIGN ROLL NUMBERS =====
  app.post("/api/schools/:schoolId/students/auto-assign-roll", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = parseInt(req.params.schoolId);
    if (isNaN(schoolId) || req.session.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
    const { cls, section } = req.body;
    if (!cls || !section) return res.status(400).json({ message: "Class and section are required" });
    const assigned = await storage.autoAssignRollNumbers(schoolId, cls, section);
    res.json({ assigned, message: `Roll numbers 1–${assigned} assigned to ${cls}-${section} alphabetically` });
  });

  // ===== ADMIN: BULK DEACTIVATE STUDENTS =====
  app.post("/api/schools/:schoolId/students/bulk-deactivate", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = parseInt(req.params.schoolId);
    if (isNaN(schoolId) || req.session.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids must be a non-empty array" });
    const numIds = ids.map(Number).filter(n => !isNaN(n));
    const deactivated = await storage.bulkDeactivateStudents(numIds, schoolId);
    await storage.createAuditLog({
      schoolId,
      actionType: "bulk_deactivate",
      entityType: "student",
      entityId: schoolId,
      actionBy: req.session.userId!,
      actionByRole: "admin",
      details: `Bulk deactivated ${deactivated} students (IDs: ${numIds.slice(0, 20).join(",")})`,
    });
    res.json({ deactivated });
  });

  // ===== ADMIN: FEE RECORDS =====
  const feeRecordBodySchema = z.object({
    studentId: z.number().int().positive(),
    feeType: z.string().min(1).max(100),
    amount: z.number().int().positive(),
    dueDate: z.string().min(1),
    paidDate: z.string().optional().nullable(),
    status: z.enum(["Due", "Paid", "Overdue"]),
    receiptNumber: z.string().max(50).optional().nullable(),
    notes: z.string().optional().nullable(),
    academicYear: z.string().max(20).optional().nullable(),
  });

  app.get("/api/admin/fees", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const { studentId, status } = req.query as { studentId?: string; status?: string };
    const opts: { studentId?: number; status?: string } = {};
    if (studentId) opts.studentId = parseInt(studentId);
    if (status) opts.status = status;
    const records = await storage.getFeeRecordsBySchool(schoolId, opts);
    const studentIds = [...new Set(records.map(r => r.studentId))];
    let studentMap: Record<number, { name: string; class: string; section: string; digitalStudentId: string }> = {};
    if (studentIds.length > 0) {
      const stList = await db.select({ id: students.id, name: students.name, class: students.class, section: students.section, digitalStudentId: students.digitalStudentId })
        .from(students)
        .where(and(inArray(students.id, studentIds), eq(students.schoolId, schoolId)));
      for (const s of stList) studentMap[s.id] = s;
    }
    res.json(records.map(r => ({ ...r, student: studentMap[r.studentId] ?? null })));
  });

  app.post("/api/admin/fees", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const parsed = feeRecordBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const [studentCheck] = await db.select({ id: students.id }).from(students)
      .where(and(eq(students.id, parsed.data.studentId), eq(students.schoolId, schoolId)));
    if (!studentCheck) return res.status(400).json({ message: "Student does not belong to this school" });
    const rec = await storage.createFeeRecord({ ...parsed.data, schoolId, createdBy: req.session.userId });
    res.status(201).json(rec);
  });

  app.patch("/api/admin/fees/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid fee record ID" });
    const parsed = feeRecordBodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    if (parsed.data.studentId !== undefined) {
      const [studentCheck] = await db.select({ id: students.id }).from(students)
        .where(and(eq(students.id, parsed.data.studentId), eq(students.schoolId, schoolId)));
      if (!studentCheck) return res.status(400).json({ message: "Student does not belong to this school" });
    }
    const updated = await storage.updateFeeRecord(id, schoolId, parsed.data);
    if (!updated) return res.status(404).json({ message: "Fee record not found" });
    res.json(updated);
  });

  app.delete("/api/admin/fees/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school in session" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid fee record ID" });
    const deleted = await storage.deleteFeeRecord(id, schoolId);
    if (!deleted) return res.status(404).json({ message: "Fee record not found" });
    res.json({ success: true });
  });

  // ===== STUDENT: VIEW OWN FEES =====
  app.get("/api/student/academic-sessions", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const sessions = await storage.getAcademicSessions(student.schoolId);
    res.json(sessions);
  });

  app.get("/api/student/fees", async (req, res) => {
    if (!req.session.studentId) return res.status(403).json({ message: "Student access required" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(403).json({ message: "Student not found" });
    const records = await storage.getFeeRecordsByStudent(req.session.studentId, student.schoolId);
    res.json(records);
  });

  // ===== STUDENT: DOWNLOAD RECEIPT =====
  app.get("/api/student/fees/:id/receipt", async (req, res) => {
    if (!req.session.studentId) return res.status(403).json({ message: "Student access required" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(403).json({ message: "Student not found" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid fee record ID" });
    const records = await storage.getFeeRecordsByStudent(req.session.studentId, student.schoolId);
    const rec = records.find(r => r.id === id);
    if (!rec) return res.status(404).json({ message: "Fee record not found" });
    if (rec.status !== "Paid") return res.status(400).json({ message: "Receipt only available for paid records" });
    const [school] = await db.select({ name: schools.name }).from(schools).where(eq(schools.id, student.schoolId));
    const esc = (s: string | null | undefined) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const paidDateStr = rec.paidDate ? new Date(rec.paidDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—";
    const dueDateStr = new Date(rec.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    const amountStr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(rec.amount);
    const schoolName = esc(school?.name ?? "School");
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Fee Receipt</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#1e293b;background:#fff;}
  .receipt{max-width:580px;margin:auto;border:2px solid #06b6d4;border-radius:12px;padding:32px;}
  .header{text-align:center;border-bottom:2px solid #e2e8f0;padding-bottom:20px;margin-bottom:20px;}
  .header h1{margin:0 0 4px;font-size:22px;color:#0891b2;}
  .header p{margin:0;font-size:13px;color:#64748b;}
  .badge{display:inline-block;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:20px;padding:4px 14px;font-weight:700;font-size:13px;margin-bottom:16px;}
  table{width:100%;border-collapse:collapse;margin-top:8px;}
  td{padding:9px 6px;font-size:14px;border-bottom:1px solid #f1f5f9;}
  td:first-child{color:#64748b;width:45%;}
  td:last-child{font-weight:600;}
  .amount-row td:last-child{font-size:18px;font-weight:800;color:#0891b2;}
  .footer{margin-top:24px;text-align:center;font-size:11px;color:#94a3b8;}
  @media print{body{padding:0;}button{display:none;}}
</style></head><body>
<div class="receipt">
  <div class="header">
    <h1>${schoolName}</h1>
    <p>Official Fee Payment Receipt</p>
  </div>
  <div style="text-align:center;margin-bottom:16px;">
    <span class="badge">&#10003; PAID</span>
  </div>
  <table>
    <tr><td>Receipt No.</td><td>${esc(rec.receiptNumber) || "—"}</td></tr>
    <tr><td>Student Name</td><td>${esc(student?.name) || "—"}</td></tr>
    <tr><td>Student ID</td><td>${esc(student?.digitalStudentId) || "—"}</td></tr>
    <tr><td>Class / Section</td><td>${esc(student?.class) || "—"} / ${esc(student?.section) || "—"}</td></tr>
    <tr><td>Fee Type</td><td>${esc(rec.feeType)}</td></tr>
    ${rec.academicYear ? `<tr><td>Academic Year</td><td>${esc(rec.academicYear)}</td></tr>` : ""}
    <tr><td>Due Date</td><td>${esc(dueDateStr)}</td></tr>
    <tr><td>Payment Date</td><td>${esc(paidDateStr)}</td></tr>
    ${rec.notes ? `<tr><td>Notes</td><td>${esc(rec.notes)}</td></tr>` : ""}
    <tr class="amount-row"><td>Amount Paid</td><td>${esc(amountStr)}</td></tr>
  </table>
  <div class="footer">
    <p>This is a computer-generated receipt. No signature required.</p>
    <p>&#169; ${new Date().getFullYear()} BENIUS &middot; ${schoolName}</p>
  </div>
</div>
<script>window.print();</script>
</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="receipt-${rec.id}.html"`);
    res.send(html);
  });

  registerTeacherRoutes(app);

  return httpServer;
}
