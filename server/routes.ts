import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertSchoolSchema, attendanceRecords } from "@shared/schema";
import bcrypt from "bcryptjs";
import { z } from "zod";
import multer from "multer";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { registerTeacherRoutes } from "./teacher-routes";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    userId: number;
    schoolId: number;
    userRole: string;
    studentId: number;
    teacherId: number;
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
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: "This account has been deactivated. Please contact your administrator." });
    }

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const userData = await storage.getUserWithSchool(user.id);
    req.session.userId = user.id;
    if (userData) {
      req.session.schoolId = userData.school.id;
      req.session.userRole = userData.user.role;
    }
    res.json({ message: "Login successful" });
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

  app.post("/api/student/profile/submit", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });

    const existing = await storage.getStudentProfile(req.session.studentId);
    if (!existing) return res.status(400).json({ message: "Please save a draft before submitting" });
    if (existing.status === "pending") return res.status(409).json({ message: "Profile is already pending review" });
    if (existing.status === "approved") return res.status(409).json({ message: "Profile is already approved" });

    if (!existing.fullName || !existing.fatherName || !existing.motherName || !existing.presentAddress) {
      return res.status(400).json({ message: "Please fill in all required fields: Full Name, Father's Name, Mother's Name, and Present Address" });
    }

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

  // ===== STUDENT CALENDAR ROUTES =====

  app.get("/api/student/calendar", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
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
    res.json(entries);
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

  app.post("/api/student/complaints/peer-report", async (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });
    const { reportedStudentName, incidentDate, content } = req.body;
    if (!reportedStudentName?.trim() || !content?.trim()) {
      return res.status(400).json({ message: "Reported student name and description are required" });
    }
    const ticketId = await storage.getNextTicketId(student.schoolId);
    const complaint = await storage.createStudentComplaint({
      ticketId,
      complainantStudentId: student.id,
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

  // ===== ADMIN SCHOOL CONFIG (strict session-scoped) =====
  app.get("/api/admin/school-config", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
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
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "No school associated with session" });
    const { class: cls, section, date } = req.query as { class?: string; section?: string; date?: string };
    if (!cls || !section || !date) return res.status(400).json({ message: "class, section, and date are required" });
    try {
      const studentList = await storage.getStudentsByClassSection(schoolId, cls, section);
      // SQL-level school_id + date filter — strict isolation
      const records = await db.select().from(attendanceRecords).where(
        and(
          eq(attendanceRecords.schoolId, schoolId),
          eq(attendanceRecords.date, date)
        )
      );
      const studentIds = new Set(studentList.map(s => s.id));
      const filteredRecords = records.filter(r => studentIds.has(r.studentId));
      const result = studentList.map(student => {
        const record = filteredRecords.find(r => r.studentId === student.id);
        return {
          studentId: student.id,
          name: student.name,
          rollNo: "",
          digitalStudentId: student.digitalStudentId,
          status: record?.status ?? "present",
        };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch class attendance" });
    }
  });

  // ===== ADMIN ATTENDANCE: TEACHER SUMMARY =====
  app.get("/api/admin/attendance/teacher-summary", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
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
