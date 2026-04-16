import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertSchoolSchema, attendanceRecords, studentProfiles } from "@shared/schema";
import bcrypt from "bcryptjs";
import { z } from "zod";
import multer from "multer";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { registerTeacherRoutes } from "./teacher-routes";
import { db } from "./db";
import { eq, and, sql, inArray } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    schoolId?: number;
    userRole?: string;
    studentId?: number;
    teacherId?: number;
    pendingInitUserId?: number;
    pendingPinUserId?: number;
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/schools", async (_req, res) => {
    const schools = await storage.getSchools();
    res.json(schools);
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

    if (!user.isInitialized) {
      req.session.pendingInitUserId = user.id;
      req.session.pendingPinUserId = undefined;
      req.session.userId = undefined;
      req.session.teacherId = undefined;
      return res.json({ requiresInit: true });
    }

    req.session.pendingPinUserId = user.id;
    req.session.pendingInitUserId = undefined;
    req.session.userId = undefined;
    req.session.teacherId = undefined;
    return res.json({ requiresPin: true });
  });

  app.post("/api/admin/initialize", async (req, res) => {
    const pendingInitUserId = req.session.pendingInitUserId;
    if (!pendingInitUserId) return res.status(401).json({ message: "No pending init session" });

    const userCheck = await storage.getUserById(pendingInitUserId);
    if (!userCheck || userCheck.isInitialized) return res.status(403).json({ message: "Account already initialized or not found" });

    const schema = z.object({
      newPassword: z.string().min(6, "New password must be at least 6 characters"),
      confirmPassword: z.string().min(6),
      pin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits"),
      confirmPin: z.string().length(6),
      recoveryEmail: z.string().email("Enter a valid recovery email"),
      recoveryPhone: z.string().max(20).optional().or(z.literal("")),
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
    res.json({ message: "Account initialized" });
  });

  app.post("/api/admin/verify-pin", async (req, res) => {
    const pendingPinUserId = req.session.pendingPinUserId;
    if (!pendingPinUserId) return res.status(401).json({ message: "No pending PIN session" });

    const schema = z.object({ pin: z.string().length(6) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid PIN format" });

    const user = await storage.getUserById(pendingPinUserId);
    const schoolId = user?.schoolId ?? null;

    const valid = await storage.verifyAdminPin(pendingPinUserId, parsed.data.pin);
    if (!valid) {
      await storage.logSecurityEvent(pendingPinUserId, schoolId, "pin_failed", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(401).json({ message: "Incorrect PIN" });
    }

    const userData = await storage.getUserWithSchool(pendingPinUserId);
    req.session.pendingPinUserId = undefined;
    req.session.userId = pendingPinUserId;
    req.session.teacherId = undefined;
    if (userData) {
      req.session.schoolId = userData.school.id;
      req.session.userRole = userData.user.role;
    }
    await storage.logSecurityEvent(pendingPinUserId, req.session.schoolId ?? null, "login_success", true, req.ip || null, req.headers["user-agent"] || null);
    res.json({ message: "Login successful" });
  });

  app.post("/api/admin/forgot-password", async (req, res) => {
    const schema = z.object({ recoveryEmail: z.string().email(), schoolCode: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

    const school = await storage.getSchoolByCode(parsed.data.schoolCode.toUpperCase());
    if (!school) return res.status(404).json({ message: "School code not found" });

    const user = await storage.getUserByRecoveryEmail(parsed.data.recoveryEmail, school.id);
    if (!user) {
      return res.status(404).json({ message: "No account found with that recovery email and school code" });
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
    if (!valid) return res.status(400).json({ message: "Invalid or expired OTP" });

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
      recoveryPhone: z.string().max(20).optional().or(z.literal("")),
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
      await storage.logSecurityEvent(req.session.userId, req.session.schoolId ?? 0, "password_change_failed", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(401).json({ message: "Current password is incorrect" });
    }
    const hash = await bcrypt.hash(parsed.data.newPassword, 10);
    await storage.updateAdminPassword(req.session.userId, hash);
    await storage.logSecurityEvent(req.session.userId, req.session.schoolId ?? 0, "password_changed", true, req.ip || null, req.headers["user-agent"] || null);
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
      await storage.logSecurityEvent(req.session.userId, req.session.schoolId ?? 0, "pin_change_failed", false, req.ip || null, req.headers["user-agent"] || null);
      return res.status(401).json({ message: "Current PIN is incorrect" });
    }
    const hash = await bcrypt.hash(parsed.data.newPin, 12);
    await storage.updateAdminPin(req.session.userId, hash);
    await storage.logSecurityEvent(req.session.userId, req.session.schoolId ?? 0, "pin_changed", true, req.ip || null, req.headers["user-agent"] || null);
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

      const { name, class: cls, section, phone, dob: dobRaw } = parsed.data;

      if (!isValidPhone(phone)) {
        return res.status(400).json({ message: "Invalid phone number" });
      }

      const dob = parseDate(dobRaw);
      if (!dob) {
        return res.status(400).json({ message: "Invalid date format" });
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
      });

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
        const path = require("path");
        const fs = require("fs");
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

    const data = await storage.getStudentYearlyAttendance(student.id, student.schoolId, dates.startDate, dates.endDate);
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
    const stats = await storage.getStudentAttendanceStats(student.id, student.schoolId, startDate, endDate);
    res.json({ schoolId: student.schoolId, studentId: student.id, startDate, ...stats });
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
          const pathMod = require("path");
          const fsMod = require("fs");
          const dir = pathMod.join(process.cwd(), "uploads", "homework-submissions");
          if (!fsMod.existsSync(dir)) fsMod.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const pathMod = require("path");
          const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
          cb(null, unique + pathMod.extname(file.originalname).toLowerCase());
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const pathMod = require("path");
        const ext = pathMod.extname(file.originalname).toLowerCase();
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
      const today = new Date().toISOString().split("T")[0];
      const isLate = hw.dueDate ? hw.dueDate < today : false;
      const submission = await storage.upsertHomeworkSubmission({
        homeworkId: hwId,
        studentId: student.id,
        schoolId: student.schoolId,
        fileUrl,
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
    const faculty = await storage.getFacultyBySchool(student.schoolId);
    res.json(faculty);
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
    const { title, description, eventType, startDate, endDate, isRecurring, colorCode } = req.body;
    if (!title || !eventType || !startDate) return res.status(400).json({ message: "title, eventType, startDate required" });
    const color = colorCode || (eventType === "holiday" ? "#ef4444" : eventType === "academic" || eventType === "examination" ? "#3b82f6" : "#10b981");

    const baseInsert = { schoolId, title, description: description || null, eventType, venue: null, colorCode: color, isRecurring: !!isRecurring };
    const entries: { schoolId: number; title: string; description: string | null; eventType: string; venue: null; colorCode: string; isRecurring: boolean; date: string }[] = [];

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
    const { title, description, eventType, date, venue, colorCode, isRecurring } = req.body;
    if (!title || !eventType || !date) return res.status(400).json({ message: "title, eventType, date required" });
    const color = colorCode || (eventType === "holiday" ? "#ef4444" : eventType === "academic" || eventType === "examination" ? "#3b82f6" : "#10b981");
    const updated = await storage.updateCalendarEvent(id, schoolId, {
      title, description: description || null, eventType, date, venue: venue || null, colorCode: color, isRecurring: !!isRecurring,
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

  app.post("/api/admin/calendar/seed-holidays", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;

    const FIXED_HOLIDAYS = [
      { month: 1, day: 1, title: "New Year's Day" },
      { month: 1, day: 26, title: "Republic Day" },
      { month: 8, day: 15, title: "Independence Day" },
      { month: 10, day: 2, title: "Gandhi Jayanti" },
      { month: 12, day: 25, title: "Christmas Day" },
    ];

    const VARIABLE_HOLIDAYS: Record<number, { month: number; day: number; title: string }[]> = {
      2026: [
        { month: 2, day: 26, title: "Maha Shivaratri" },
        { month: 3, day: 3, title: "Holi" },
        { month: 3, day: 30, title: "Eid ul-Fitr" },
        { month: 4, day: 2, title: "Ram Navami" },
        { month: 4, day: 14, title: "Dr. Ambedkar Jayanti" },
        { month: 6, day: 7, title: "Eid ul-Adha" },
        { month: 8, day: 1, title: "Muharram" },
        { month: 8, day: 25, title: "Janmashtami" },
        { month: 9, day: 29, title: "Dussehra" },
        { month: 10, day: 19, title: "Diwali" },
        { month: 11, day: 6, title: "Guru Nanak Jayanti" },
      ],
      2027: [
        { month: 2, day: 16, title: "Maha Shivaratri" },
        { month: 3, day: 22, title: "Holi" },
        { month: 3, day: 20, title: "Eid ul-Fitr" },
        { month: 4, day: 14, title: "Dr. Ambedkar Jayanti" },
        { month: 5, day: 27, title: "Eid ul-Adha" },
        { month: 8, day: 11, title: "Janmashtami" },
        { month: 9, day: 19, title: "Dussehra" },
        { month: 10, day: 8, title: "Diwali" },
        { month: 11, day: 25, title: "Guru Nanak Jayanti" },
      ],
      2028: [
        { month: 3, day: 7, title: "Maha Shivaratri" },
        { month: 3, day: 11, title: "Holi" },
        { month: 4, day: 7, title: "Eid ul-Fitr" },
        { month: 4, day: 14, title: "Dr. Ambedkar Jayanti" },
        { month: 6, day: 15, title: "Eid ul-Adha" },
        { month: 8, day: 29, title: "Janmashtami" },
        { month: 10, day: 2, title: "Diwali" },
        { month: 10, day: 18, title: "Dussehra" },
        { month: 11, day: 13, title: "Guru Nanak Jayanti" },
      ],
      2029: [
        { month: 2, day: 24, title: "Maha Shivaratri" },
        { month: 3, day: 1, title: "Holi" },
        { month: 3, day: 27, title: "Eid ul-Fitr" },
        { month: 4, day: 14, title: "Dr. Ambedkar Jayanti" },
        { month: 6, day: 4, title: "Eid ul-Adha" },
        { month: 8, day: 19, title: "Janmashtami" },
        { month: 10, day: 7, title: "Dussehra" },
        { month: 10, day: 19, title: "Diwali" },
      ],
      2030: [
        { month: 2, day: 14, title: "Maha Shivaratri" },
        { month: 3, day: 20, title: "Holi" },
        { month: 3, day: 16, title: "Eid ul-Fitr" },
        { month: 4, day: 14, title: "Dr. Ambedkar Jayanti" },
        { month: 5, day: 24, title: "Eid ul-Adha" },
        { month: 8, day: 8, title: "Janmashtami" },
        { month: 9, day: 27, title: "Dussehra" },
        { month: 10, day: 9, title: "Diwali" },
      ],
      2031: [
        { month: 3, day: 5, title: "Maha Shivaratri" },
        { month: 3, day: 10, title: "Holi" },
        { month: 4, day: 4, title: "Eid ul-Fitr" },
        { month: 4, day: 14, title: "Dr. Ambedkar Jayanti" },
        { month: 6, day: 12, title: "Eid ul-Adha" },
        { month: 8, day: 27, title: "Janmashtami" },
        { month: 10, day: 5, title: "Dussehra" },
        { month: 10, day: 25, title: "Diwali" },
        { month: 11, day: 1, title: "Guru Nanak Jayanti" },
      ],
    };

    const targetYear = req.body.year ? parseInt(req.body.year) : null;
    const currentYear = new Date().getFullYear();
    const years = targetYear ? [targetYear] : Array.from({ length: 6 }, (_, i) => currentYear + i);
    const existing = await storage.getCalendarEvents(schoolId);
    const existingTitles = new Set(existing.map(e => `${e.date}::${e.title}`));

    const toInsert: { schoolId: number; title: string; description: null; eventType: string; venue: null; colorCode: string; isRecurring: boolean; date: string }[] = [];

    for (const year of years) {
      for (const h of FIXED_HOLIDAYS) {
        const date = `${year}-${String(h.month).padStart(2, "0")}-${String(h.day).padStart(2, "0")}`;
        const key = `${date}::${h.title}`;
        if (!existingTitles.has(key)) {
          toInsert.push({ schoolId, title: h.title, description: null, eventType: "holiday", venue: null, colorCode: "#ef4444", isRecurring: true, date });
        }
      }
      const varHolidays = VARIABLE_HOLIDAYS[year] || [];
      for (const h of varHolidays) {
        const date = `${year}-${String(h.month).padStart(2, "0")}-${String(h.day).padStart(2, "0")}`;
        const key = `${date}::${h.title}`;
        if (!existingTitles.has(key)) {
          toInsert.push({ schoolId, title: h.title, description: null, eventType: "holiday", venue: null, colorCode: "#ef4444", isRecurring: false, date });
        }
      }
    }

    const created = await storage.createCalendarEvents(toInsert);
    res.json({ message: `Seeded ${created.length} holidays`, count: created.length });
  });

  // ===== STUDENT CALENDAR ROUTES =====

  app.get("/api/student/calendar", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const monthParam = req.query.month !== undefined ? parseInt(req.query.month as string) : null;
    const yearParam = req.query.year ? parseInt(req.query.year as string) : null;
    if (yearParam !== null && monthParam === null) {
      const startDate = `${yearParam}-01-01`;
      const endDate = `${yearParam}-12-31`;
      const events = await storage.getCalendarEventsByRange(student.schoolId, startDate, endDate);
      return res.json(events);
    }
    if (monthParam !== null && yearParam !== null) {
      const firstDay = new Date(yearParam, monthParam, 1);
      const lastDay = new Date(yearParam, monthParam + 1, 0);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const events = await storage.getCalendarEventsByRange(student.schoolId, fmt(firstDay), fmt(lastDay));
      return res.json(events);
    }
    const events = await storage.getCalendarEvents(student.schoolId);
    res.json(events);
  });

  // ===== STUDENT TIMETABLE ROUTES =====

  app.get("/api/student/timetable", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const all = await storage.getTimetableBySchool(student.schoolId);
    const entries = all.filter(e =>
      e.class === student.class && e.section === student.section && e.status === "published"
    );
    const structure = await storage.getTimetableStructure(student.schoolId, student.class || "");
    res.json({ entries, structure });
  });

  // ===== STUDENT LEAVE ROUTES =====

  app.post("/api/student/leave", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const { startDate, endDate, reason, category, attachmentUrl } = req.body;
    if (!startDate || !endDate || !reason) return res.status(400).json({ message: "startDate, endDate, and reason are required" });
    const leave = await storage.createStudentLeaveRequest({
      studentId: student.id,
      schoolId: student.schoolId,
      startDate,
      endDate,
      reason,
      category: category || null,
      attachmentUrl: attachmentUrl || null,
    });
    res.status(201).json(leave);
  });

  app.get("/api/student/leave", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const leaves = await storage.getStudentLeavesByStudent(req.session.studentId);
    res.json(leaves);
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

  // ===== ADMIN TEACHERS: PATCH (edit assignment — strict session-scoped) =====
  const editTeacherSchema = z.object({
    fullName: z.string().min(2, "Name must be at least 2 characters"),
    subject: z.string().min(1, "Subject is required"),
    assignedClass: z.string().min(1, "Class is required"),
    assignedSection: z.string().min(1, "Section is required"),
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
      const updated = await storage.updateTeacherAssignment(teacherId, schoolId, parsed.data);
      if (!updated) return res.status(404).json({ message: "Teacher not found or does not belong to this school" });
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
      res.json({
        classes: meta["classes"] ?? [],
        sections: meta["sections"] ?? [],
        subjects: meta["subjects"] ?? [],
      });
    } catch {
      res.json({ classes: [], sections: [], subjects: [] });
    }
  });

  // ===== ADMIN ATTENDANCE: CLASS DETAIL =====
  app.get("/api/admin/attendance/class-detail", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school associated with session" });
    const { class: cls, section, date } = req.query as { class?: string; section?: string; date?: string };
    if (!cls || !section || !date) return res.status(400).json({ message: "class, section, and date are required" });
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
          status: record?.status ?? "present",
        };
      });
      res.json(result);
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
      const allTeachers = await storage.getTeachersBySchool(schoolId);
      const records = await db.select().from(attendanceRecords)
        .where(and(eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.date, date)));

      const teacherMap = new Map<number, { firstMarkAt: Date | null }>();
      for (const r of records) {
        const existing = teacherMap.get(r.teacherId);
        if (!existing) {
          teacherMap.set(r.teacherId, { firstMarkAt: r.markedAt });
        } else if (r.markedAt < (existing.firstMarkAt ?? r.markedAt)) {
          existing.firstMarkAt = r.markedAt;
        }
      }

      const result = allTeachers.map(t => {
        const markInfo = teacherMap.get(t.id);
        const hasMarked = !!markInfo;
        const firstMarkAt = markInfo?.firstMarkAt ?? null;
        let status = "not-marked";
        let isLate = false;
        if (hasMarked && firstMarkAt) {
          status = "marked";
          const h = firstMarkAt.getHours();
          const m = firstMarkAt.getMinutes();
          if (h > 9 || (h === 9 && m > 0)) isLate = true;
        }
        return {
          teacherId: t.id,
          name: t.fullName,
          assignedClass: t.assignedClass,
          assignedSection: t.assignedSection,
          subject: t.subject,
          department: t.department ?? "",
          status,
          isLate,
          submittedAt: firstMarkAt ? firstMarkAt.toISOString() : null,
        };
      });

      const totalFaculty = result.length;
      const marked = result.filter(r => r.status === "marked").length;
      const notMarked = result.filter(r => r.status === "not-marked").length;

      res.json({ summary: { totalFaculty, marked, notMarked }, teachers: result });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch teacher attendance summary" });
    }
  });

  registerTeacherRoutes(app);

  return httpServer;
}
