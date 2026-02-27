import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertSchoolSchema } from "@shared/schema";
import bcrypt from "bcryptjs";
import { z } from "zod";
import multer from "multer";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

declare module "express-session" {
  interface SessionData {
    userId: number;
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

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    req.session.userId = user.id;
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

    const studentCount = await storage.getStudentCountBySchool(data.school.id);

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

  return httpServer;
}
