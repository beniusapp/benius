import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertSchoolSchema } from "@shared/schema";
import bcrypt from "bcryptjs";
import { z } from "zod";
import multer from "multer";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { registerTeacherRoutes } from "./teacher-routes";

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
    await storage.activateStudent(student.id, passwordHash);

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
      schoolName: data.school.name,
      schoolCode: data.school.code,
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

  registerTeacherRoutes(app);

  return httpServer;
}
