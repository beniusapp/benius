import type { Express } from "express";
import { storage, evaluatePromotion } from "./storage";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";
import { db } from "./db";
import { teacherSelfAttendance, attendanceCorrectionRequests, attendancePolicies } from "@shared/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { evaluateAttendanceStatus, resolvePolicy, utcToISTHHMM, DEFAULT_POLICY, recomputeStatus } from "./attendance-policy-engine";

const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
      cb(null, unique + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const createTeacherSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(7),
  subject: z.string().optional().default(""),
  assignedClass: z.string().optional().default(""),
  assignedSection: z.string().optional().default(""),
  designation: z.string().optional(),
});

const teacherLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(7),
});

const verifyOtpSchema = z.object({
  teacherId: z.number(),
  otp: z.string().length(6),
});

const resetPasswordSchema = z.object({
  teacherId: z.number(),
  resetToken: z.string().min(1),
  newPassword: z.string().min(6),
});

export function registerTeacherRoutes(app: Express) {
  // ===== TEACHER CRUD (Principal) =====
  app.post("/api/schools/:schoolId/teachers", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
      const schoolId = parseInt(req.params.schoolId);
      if (isNaN(schoolId)) return res.status(400).json({ message: "Invalid school ID" });

      const userData = await storage.getUserWithSchool(req.session.userId);
      if (!userData || userData.school.id !== schoolId || userData.user.role !== "admin")
        return res.status(403).json({ message: "Access denied" });

      const parsed = createTeacherSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

      const existing = await storage.getUserByEmail(parsed.data.email);
      if (existing) return res.status(409).json({ message: "A user with this email already exists" });

      const passwordHash = await bcrypt.hash(parsed.data.password, 10);
      const teacher = await storage.createTeacher({
        schoolId,
        fullName: parsed.data.fullName,
        phone: parsed.data.phone,
        subject: parsed.data.subject,
        assignedClass: parsed.data.assignedClass,
        assignedSection: parsed.data.assignedSection,
        mustChangePassword: true,
      }, parsed.data.email, passwordHash);

      res.status(201).json(teacher);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create teacher" });
    }
  });

  app.get("/api/schools/:schoolId/teachers", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const schoolId = parseInt(req.params.schoolId);
    if (isNaN(schoolId)) return res.status(400).json({ message: "Invalid school ID" });
    const userData = await storage.getUserWithSchool(req.session.userId);
    if (!userData || userData.school.id !== schoolId || userData.user.role !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const teacherList = await storage.getTeachersBySchool(schoolId);
    res.json(teacherList);
  });

  app.delete("/api/teachers/:id", async (_req, res) => {
    res.status(410).json({ message: "Hard deletion is disabled. Use the deactivation endpoint instead." });
  });

  // ===== TEACHER AUTH =====
  app.post("/api/teacher-login", async (req, res) => {
    const parsed = teacherLoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Email and password are required" });

    const user = await storage.getUserByEmail(parsed.data.email);
    if (!user || user.role !== "teacher") return res.status(401).json({ message: "Invalid Credentials" });

    if (!user.isActive) {
      return res.status(403).json({ message: "This account has been deactivated. Please contact your administrator." });
    }

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) return res.status(401).json({ message: "Invalid Credentials" });

    const teacher = await storage.getTeacherByUserId(user.id);
    if (!teacher) return res.status(401).json({ message: "Teacher record not found" });

    req.session.teacherId = teacher.id;
    req.session.userId = user.id;
    req.session.schoolId = teacher.schoolId;
    req.session.userRole = "teacher";
    res.json({ message: "Login successful", mustChangePassword: teacher.mustChangePassword });
  });

  app.get("/api/teacher-me", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });

    const data = await storage.getTeacherWithSchool(req.session.teacherId);
    if (!data) return res.status(401).json({ message: "Teacher not found" });

    const [todayDone, mappings] = await Promise.all([
      storage.hasAttendanceToday(
        data.teacher.id, data.teacher.assignedClass, data.teacher.assignedSection, data.teacher.schoolId
      ),
      storage.getFacultyMappingsByTeacher(data.teacher.id),
    ]);

    res.json({
      id: data.teacher.id,
      userId: data.user.id,
      fullName: data.teacher.fullName,
      email: data.user.email,
      phone: data.teacher.phone,
      subject: data.teacher.subject,
      assignedClass: data.teacher.assignedClass,
      assignedSection: data.teacher.assignedSection,
      mustChangePassword: data.teacher.mustChangePassword,
      schoolId: data.school.id,
      schoolName: data.school.name,
      schoolCode: data.school.code,
      attendanceDoneToday: todayDone,
      profileImageUrl: data.teacher.profileImageUrl || null,
      mappings,
    });
  });

  // ── ACADEMIC SESSIONS (read-only for teachers) ────────────────────────────
  // Returns all sessions for the teacher's school, newest first.
  // Lets the frontend populate the "View Past Records" session picker.
  app.get("/api/teacher/academic-sessions", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const sessions = await storage.getAcademicSessions(teacher.schoolId);
    res.json(sessions);
  });

  app.post("/api/teacher/change-password", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const data = await storage.getTeacherWithSchool(req.session.teacherId);
    if (!data) return res.status(401).json({ message: "Teacher not found" });

    if (data.teacher.schoolId !== req.session.schoolId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const currentValid = await bcrypt.compare(parsed.data.currentPassword, data.user.passwordHash);
    if (!currentValid) return res.status(400).json({ message: "Incorrect Current Password" });

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await storage.updateTeacherPassword(data.user.id, passwordHash, false);
    res.json({ message: "Password changed successfully" });
  });

  app.post("/api/teacher/profile-picture", diskUpload.single("file"), async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
    const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp"];
    const fileMime = req.file.mimetype?.toLowerCase() ?? "";
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    if (!ALLOWED_MIME.includes(fileMime) || !ALLOWED_EXT.includes(fileExt)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: "Only JPG, PNG, or WebP images are allowed" });
    }

    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const schoolDir = path.join(process.cwd(), "uploads", "schools", String(teacher.schoolId), "teachers", String(teacher.id));
    if (!fs.existsSync(schoolDir)) fs.mkdirSync(schoolDir, { recursive: true });
    const destFilename = `profile-${Date.now()}${fileExt}`;
    const destPath = path.join(schoolDir, destFilename);
    fs.renameSync(req.file.path, destPath);
    const profileImageUrl = `/uploads/schools/${teacher.schoolId}/teachers/${teacher.id}/${destFilename}`;
    await storage.updateTeacherProfilePicture(teacher.id, profileImageUrl);
    res.json({ message: "Profile picture updated", profileImageUrl });
  });

  // ===== FORGOT PASSWORD / OTP =====
  app.post("/api/teacher/forgot-password", async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Email and phone number are required" });

    const match = await storage.findTeacherByEmailAndPhone(parsed.data.email, parsed.data.phone);
    if (!match) return res.status(404).json({ message: "Details not found. Please contact the Principal." });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await storage.setTeacherOtp(match.teacher.id, otp, expiresAt);

    console.log(`[DEV OTP] ${parsed.data.email} → ${otp}`);
    res.json({ message: "OTP sent to your phone", teacherId: match.teacher.id });
  });

  app.post("/api/teacher/verify-otp", async (req, res) => {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Teacher ID and OTP are required" });

    const verified = await storage.verifyTeacherOtp(parsed.data.teacherId, parsed.data.otp);
    if (!verified) return res.status(400).json({ message: "Invalid or expired OTP. Please try again." });

    const resetToken = crypto.randomBytes(32).toString("hex");
    await storage.setTeacherResetToken(parsed.data.teacherId, resetToken);
    await storage.clearTeacherOtp(parsed.data.teacherId);

    res.json({ message: "OTP verified", verified: true, resetToken });
  });

  app.post("/api/teacher/reset-password", async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const teacher = await storage.verifyTeacherResetToken(parsed.data.teacherId, parsed.data.resetToken);
    if (!teacher) return res.status(400).json({ message: "Invalid or expired reset token. Please request a new OTP." });

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await storage.updateTeacherPassword(teacher.user.id, passwordHash, false);
    await storage.clearTeacherResetToken(parsed.data.teacherId);

    res.json({ message: "Password reset successfully" });
  });

  app.post("/api/teacher-logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ message: "Failed to logout" });
      res.json({ message: "Logged out" });
    });
  });

  // ===== ATTENDANCE =====
  app.get("/api/attendance/:schoolId/:class/:section/:date", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const { schoolId, class: cls, section, date } = req.params;
    const sid = parseInt(schoolId);
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;

    // Archive look-back: resolve roster via enrollments for the viewed session.
    // Active-session view: use current student fields (class/section/isActive).
    const studentList = viewSessionId
      ? await storage.getStudentsByClassSectionInSession(sid, cls, section, viewSessionId)
      : await storage.getStudentsByClassSection(sid, cls, section);
    const records = await storage.getAttendanceForStudentsOnDate(studentList.map(s => s.id), date);

    const result = studentList.map(student => {
      const record = records.find(r => r.studentId === student.id);
      return {
        studentId: student.id,
        name: student.name,
        dsid: student.digitalStudentId,
        // Never default to "present" — an unmarked student is "not-marked"
        status: (record && record.status) ? record.status : "not-marked",
        editCount: record?.editCount ?? 0,
        markedBy: record?.markedBy ?? null,
        markedAt: record?.markedAt ?? null,
        hasRecord: !!record,
      };
    });
    res.json(result);
  });

  app.post("/api/attendance", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });

    const { date, records, class: cls, section } = req.body;
    if (!date || !Array.isArray(records)) return res.status(400).json({ message: "Invalid data" });

    const today = new Date().toISOString().split("T")[0];
    if (date > today) return res.status(400).json({ message: "Cannot mark attendance for future dates" });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const minDate = sevenDaysAgo.toISOString().split("T")[0];
    if (date < minDate) return res.status(400).json({ message: "Can only edit attendance for the past 7 days" });

    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    // Rule A — Holiday Lockdown: reject attendance if the date is a school-wide holiday.
    // This is the single source of truth enforced at the API layer so no attendance
    // record (and therefore no working-day count) can ever be created on a holiday.
    const holiday = await storage.getHolidayOnDate(teacher.schoolId, date);
    if (holiday) {
      return res.status(423).json({
        message: `Attendance is locked. "${holiday.title}" is a school-wide holiday.`,
        holidayName: holiday.title,
      });
    }

    // Compute academic year from the date (Indian academic year: April–March)
    const dateObj = new Date(date);
    const yr = dateObj.getFullYear();
    const mo = dateObj.getMonth(); // 0-indexed; March=2, April=3
    const academicYear = mo >= 3 ? `${yr}-${String(yr + 1).slice(-2)}` : `${yr - 1}-${String(yr).slice(-2)}`;

    const markedBy = `${teacher.fullName} at ${new Date().toISOString()}`;
    const formattedRecords = records.map((r: any) => ({
      studentId: r.studentId,
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
      date,
      status: r.status,
      markedBy,
      class: cls || teacher.assignedClass,
      section: section || teacher.assignedSection,
      academicYear,
    }));

    const saved = await storage.upsertAttendance(formattedRecords);
    res.json({ message: `Attendance saved for ${saved.length} students`, count: saved.length });
  });

  app.get("/api/attendance/history/:schoolId/:class/:section/:startDate/:endDate", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const { schoolId, class: cls, section, startDate, endDate } = req.params;
    const sid = parseInt(schoolId);
    try {
      const records = await storage.getAttendanceHistory(sid, cls, section, startDate, endDate);
      res.json(records);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch attendance history" });
    }
  });

  app.get("/api/attendance/status/:teacherId", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacherId = parseInt(req.params.teacherId);
    const teacher = await storage.getTeacherById(teacherId);
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });
    const done = await storage.hasAttendanceToday(teacherId, teacher.assignedClass, teacher.assignedSection, teacher.schoolId);
    res.json({ done });
  });

  // ===== HOMEWORK =====
  app.post("/api/homework", diskUpload.single("file"), async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const { content, subject, class: cls, section, dueDate } = req.body;
    if (!content || !cls || !section) return res.status(400).json({ message: "Content, class, and section required" });

    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const activeSession = await storage.getActiveSession(teacher.schoolId);
    const hw = await storage.createHomework({
      teacherId: teacher.id, schoolId: teacher.schoolId, class: cls, section, subject: subject || "General", content, fileUrl, dueDate: dueDate || null,
      sessionId: activeSession?.id ?? null,
    });
    res.status(201).json(hw);
  });

  app.get("/api/homework/:schoolId/:class/:section", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const sid = parseInt(req.params.schoolId);
    if (isNaN(sid)) return res.status(400).json({ message: "Invalid school ID" });

    const sessionTeacher = await storage.getTeacherById(req.session.teacherId);
    if (!sessionTeacher || sessionTeacher.schoolId !== sid) return res.status(403).json({ message: "Not authorized for this school" });

    const cls = req.params.class;
    const section = req.params.section;
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const list = await storage.getHomeworkByClass(sid, cls, section, viewSessionId ?? undefined);
    const totalStudents = await storage.getStudentCountByClassSection(sid, cls, section);

    const teacherCache = new Map<number, string>();
    const enriched = await Promise.all(list.map(async (hw) => {
      const viewCount = await storage.getHomeworkViewCount(hw.id);
      if (!teacherCache.has(hw.teacherId)) {
        const t = await storage.getTeacherById(hw.teacherId);
        teacherCache.set(hw.teacherId, t?.fullName || "Unknown");
      }
      return { ...hw, viewCount, totalStudents, teacherName: teacherCache.get(hw.teacherId)! };
    }));
    res.json(enriched);
  });

  app.patch("/api/homework/:id", diskUpload.single("file"), async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);
    const hw = await storage.getHomeworkById(id);
    if (!hw) return res.status(404).json({ message: "Homework not found" });
    if (hw.teacherId !== req.session.teacherId) return res.status(403).json({ message: "Not authorized" });

    const { content, subject, dueDate } = req.body;
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : (req.body.keepFile === "true" ? hw.fileUrl : null);
    const updated = await storage.updateHomework(id, { content: content || hw.content, subject: subject || hw.subject, fileUrl, dueDate: dueDate !== undefined ? (dueDate || null) : hw.dueDate });
    res.json(updated);
  });

  app.delete("/api/homework/:id", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);
    const hw = await storage.getHomeworkById(id);
    if (!hw) return res.status(404).json({ message: "Homework not found" });
    if (hw.teacherId !== req.session.teacherId) return res.status(403).json({ message: "Not authorized" });
    await storage.deleteHomework(id);
    res.json({ message: "Homework deleted" });
  });

  // ===== CLASSWORK =====
  app.post("/api/classwork", diskUpload.single("file"), async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const { content, class: cls, section, subject } = req.body;
    if (!content || !cls || !section) return res.status(400).json({ message: "Content, class, and section required" });

    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const activeSession = await storage.getActiveSession(teacher.schoolId);
    const cw = await storage.createClasswork({
      teacherId: teacher.id, schoolId: teacher.schoolId, class: cls, section,
      subject: subject || "General", content, fileUrl,
      sessionId: activeSession?.id ?? null,
    });
    res.status(201).json(cw);
  });

  app.get("/api/classwork/:schoolId/:class/:section", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const sid = parseInt(req.params.schoolId);

    const sessionTeacher = await storage.getTeacherById(req.session.teacherId);
    if (!sessionTeacher || sessionTeacher.schoolId !== sid) return res.status(403).json({ message: "Not authorized for this school" });

    const cls = req.params.class;
    const section = req.params.section;
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const list = await storage.getClassworkByClass(sid, cls, section, viewSessionId ?? undefined);

    const teacherCache = new Map<number, string>();
    const enriched = await Promise.all(list.map(async (cw) => {
      if (!teacherCache.has(cw.teacherId)) {
        const t = await storage.getTeacherById(cw.teacherId);
        teacherCache.set(cw.teacherId, t?.fullName || "Unknown");
      }
      return { ...cw, teacherName: teacherCache.get(cw.teacherId)! };
    }));
    res.json(enriched);
  });

  app.patch("/api/classwork/:id", diskUpload.single("file"), async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);
    const cw = await storage.getClassworkById(id);
    if (!cw) return res.status(404).json({ message: "Classwork not found" });
    if (cw.teacherId !== req.session.teacherId) return res.status(403).json({ message: "Not authorized" });

    const { content, subject } = req.body;
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : (req.body.keepFile === "true" ? cw.fileUrl : null);
    const updated = await storage.updateClasswork(id, { content: content || cw.content, subject: subject || cw.subject, fileUrl });
    res.json(updated);
  });

  app.delete("/api/classwork/:id", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);
    const cw = await storage.getClassworkById(id);
    if (!cw) return res.status(404).json({ message: "Classwork not found" });
    if (cw.teacherId !== req.session.teacherId) return res.status(403).json({ message: "Not authorized" });
    await storage.deleteClasswork(id);
    res.json({ message: "Classwork deleted" });
  });

  // ===== NOTICES =====
  app.post("/api/notices", diskUpload.single("file"), async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const { content, targetType, targetClass, targetSection, schoolId, noticeType } = req.body;
    if (!content || !targetType || !schoolId) return res.status(400).json({ message: "Content, targetType, and schoolId required" });

    if (req.session.teacherId) {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher || teacher.schoolId !== parseInt(schoolId)) return res.status(403).json({ message: "Not authorized for this school" });
    }

    const creatorRole = req.session.teacherId ? "teacher" : "admin";
    const createdById = req.session.teacherId || req.session.userId;
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

    // Normalise section: empty string and the sentinel "all" both mean no section restriction
    const resolvedSection = (targetSection && targetSection !== "all") ? targetSection : null;

    const notice = await storage.createNotice({
      schoolId: parseInt(schoolId), createdById: createdById!, creatorRole, targetType,
      targetClass: targetClass || null, targetSection: resolvedSection,
      noticeType: noticeType || "Routine", content, fileUrl,
    });
    res.status(201).json(notice);
  });

  app.get("/api/notices/:schoolId", async (req, res) => {
    if (!req.session.userId && !req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const sid = parseInt(req.params.schoolId);

    if (req.session.teacherId) {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher || teacher.schoolId !== sid) return res.status(403).json({ message: "Not authorized for this school" });
    }

    const targetType = (req.query.target as string) || "teacher";

    // When a teacher requests their own notices, scope strictly to their
    // class-section assignments so they only see notices relevant to them.
    if (targetType === "teacher" && req.session.teacherId) {
      const list = await storage.getTeacherScopedNotices(sid, req.session.teacherId);
      return res.json(list);
    }

    const cls = req.query.class as string | undefined;
    const section = req.query.section as string | undefined;
    const list = await storage.getNoticesByTarget(sid, targetType, cls, section);
    res.json(list);
  });

  app.get("/api/notices/:schoolId/all", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const sid = parseInt(req.params.schoolId);
    const list = await storage.getAllSchoolNotices(sid, 500);
    res.json(list);
  });

  app.delete("/api/admin/notices/bulk", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Admin only" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(400).json({ message: "No school context" });
    const { olderThanDays } = req.body;
    if (typeof olderThanDays !== "number" || olderThanDays < 0) return res.status(400).json({ message: "Invalid olderThanDays (0 = delete all)" });
    const deleted = await storage.bulkDeleteNotices(schoolId, olderThanDays);
    res.json({ deleted });
  });

  app.get("/api/notices/teacher/mine", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.getNoticesByTeacher(req.session.teacherId, 50);
    res.json(list);
  });

  app.delete("/api/notices/:id", async (req, res) => {
    if (!req.session.userId && !req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    if (req.session.teacherId) {
      const notice = await storage.getNoticeById(id);
      if (!notice) return res.status(404).json({ message: "Notice not found" });
      if (notice.createdById !== req.session.teacherId || notice.creatorRole !== "teacher") {
        return res.status(403).json({ message: "Not authorized to delete this notice" });
      }
    }
    await storage.deleteNotice(id);
    res.json({ message: "Notice deleted" });
  });

  app.put("/api/notices/:id", async (req, res) => {
    if (!req.session.userId && !req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ message: "Content is required" });
    if (req.session.teacherId) {
      const notice = await storage.getNoticeById(id);
      if (!notice) return res.status(404).json({ message: "Notice not found" });
      if (notice.createdById !== req.session.teacherId || notice.creatorRole !== "teacher") {
        return res.status(403).json({ message: "Not authorized to edit this notice" });
      }
    }
    const updated = await storage.updateNotice(id, content.trim());
    if (!updated) return res.status(404).json({ message: "Notice not found" });
    res.json(updated);
  });

  // ===== COMPLAINTS =====
  app.post("/api/complaints", diskUpload.single("file"), async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const { content, complaintType, reportedStudentName, notifyAdmin } = req.body;
    if (!content) return res.status(400).json({ message: "Content required" });

    // Parse student IDs for teacher-to-student complaints (one complaint for all students)
    let studentIds: number[] = [];
    if ((complaintType || "teacher-to-student") !== "teacher-to-admin") {
      try {
        const raw = req.body.studentIds;
        studentIds = raw ? JSON.parse(raw) : [];
      } catch { studentIds = []; }
      if (studentIds.length === 0) return res.status(400).json({ message: "At least one student required" });
    }

    const ticketId = await storage.getNextTicketId(teacher.schoolId);
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const isTeacherToStudent = (complaintType || "teacher-to-student") === "teacher-to-student";
    const shouldNotifyAdmin = isTeacherToStudent && (notifyAdmin === "true" || notifyAdmin === true);

    const complaint = await storage.createComplaintWithStudents({
      ticketId,
      teacherId: teacher.id,
      studentId: null,
      schoolId: teacher.schoolId,
      complaintType: complaintType || "teacher-to-student",
      content,
      reportedStudentName: reportedStudentName || null,
      fileUrl,
      escalatedToPrincipal: shouldNotifyAdmin,
      notifyAdmin: shouldNotifyAdmin,
      status: shouldNotifyAdmin ? "Escalated" : "Pending",
      batchId: null,
    }, studentIds);

    res.status(201).json(complaint);
  });

  app.get("/api/complaints/teacher/:teacherId", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const tid = parseInt(req.params.teacherId);
    if (tid !== req.session.teacherId) return res.status(403).json({ message: "Not authorized" });
    const teacher = await storage.getTeacherById(tid);
    const list = await storage.getComplaintsByTeacher(tid, teacher?.assignedClass, teacher?.assignedSection, teacher?.schoolId);
    res.json(list);
  });

  const STUDENT_ONLY_TYPES = ["student-to-staff", "student-peer-report"] as const;

  app.patch("/api/complaints/:id", diskUpload.single("file"), async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const id = parseInt(req.params.id);
    const c = await storage.getComplaintByIdForSchool(id, teacher.schoolId);
    if (!c) return res.status(404).json({ message: "Complaint not found" });
    if (STUDENT_ONLY_TYPES.includes(c.complaintType as typeof STUDENT_ONLY_TYPES[number])) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (c.teacherId !== req.session.teacherId) return res.status(403).json({ message: "Not authorized" });
    if (c.status !== "Pending") return res.status(400).json({ message: "Cannot edit — complaint is no longer pending" });

    const { content } = req.body;
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : (req.body.keepFile === "true" ? c.fileUrl : null);
    const updated = await storage.updateComplaint(id, teacher.schoolId, { content: content || c.content, fileUrl });
    res.json(updated);
  });

  app.delete("/api/complaints/:id", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const id = parseInt(req.params.id);
    const c = await storage.getComplaintByIdForSchool(id, teacher.schoolId);
    if (!c) return res.status(404).json({ message: "Complaint not found" });
    if (STUDENT_ONLY_TYPES.includes(c.complaintType as typeof STUDENT_ONLY_TYPES[number])) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (c.teacherId !== req.session.teacherId) return res.status(403).json({ message: "Not authorized" });
    if (c.status !== "Pending") return res.status(400).json({ message: "Cannot delete — complaint is no longer pending" });
    await storage.softDeleteComplaint(id, teacher.schoolId);
    res.json({ message: "Complaint deleted" });
  });

  app.patch("/api/complaints/:id/status", async (req, res) => {
    if (!req.session.userId && !req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);

    if (req.session.teacherId) {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });
      const c = await storage.getComplaintByIdForSchool(id, teacher.schoolId);
      if (!c) return res.status(404).json({ message: "Complaint not found" });
      // Verify ownership — teachers can only update their own complaints
      if (c.teacherId !== teacher.id) return res.status(403).json({ message: "Not authorized: not your complaint" });
      if (STUDENT_ONLY_TYPES.includes(c.complaintType as typeof STUDENT_ONLY_TYPES[number])) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { status } = req.body;
      if (!["Pending", "Investigating", "Resolved"].includes(status)) return res.status(400).json({ message: "Invalid status" });
      const updated = await storage.updateComplaintStatus(id, teacher.schoolId, status);
      return res.json(updated);
    }

    const adminSchoolId = req.session.schoolId;
    if (!adminSchoolId) return res.status(403).json({ message: "Admin school context missing" });
    const c = await storage.getComplaintByIdForSchool(id, adminSchoolId);
    if (!c) return res.status(404).json({ message: "Complaint not found" });
    const { status, resolutionRemarks } = req.body;
    if (!["Pending", "Investigating", "Resolved", "Escalated"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const updated = await storage.updateComplaintStatus(id, adminSchoolId, status, resolutionRemarks?.trim() || undefined);
    res.json(updated);
  });

  app.post("/api/complaints/:id/notes", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const complaintId = parseInt(req.params.id);

    let actorSchoolId: number | undefined;
    let teacher = null;
    if (req.session.teacherId) {
      teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });
      actorSchoolId = teacher.schoolId;
    } else if (req.session.userId && req.session.schoolId) {
      actorSchoolId = req.session.schoolId;
    }

    if (!actorSchoolId) return res.status(403).json({ message: "School context missing" });
    const c = await storage.getComplaintByIdForSchool(complaintId, actorSchoolId);
    if (!c) return res.status(404).json({ message: "Complaint not found" });

    if (teacher) {
      if (STUDENT_ONLY_TYPES.includes(c.complaintType as typeof STUDENT_ONLY_TYPES[number])) {
        return res.status(403).json({ message: "Access denied" });
      }
      // Private teacher-to-admin complaints: only the filing teacher may access notes
      if (c.complaintType === "teacher-to-admin" && c.teacherId !== teacher.id) {
        return res.status(403).json({ message: "Access denied: not your private complaint" });
      }
    }

    const { content } = req.body;
    if (!content) return res.status(400).json({ message: "Content required" });

    let authorName = "Admin";
    let authorRole = "admin";
    let authorId = req.session.userId || 0;
    if (teacher) {
      authorName = teacher.fullName || "Teacher";
      authorRole = "teacher";
      authorId = req.session.teacherId!;
    }

    const note = await storage.addComplaintNote({ complaintId, authorId, authorRole, authorName, content });
    res.status(201).json(note);
  });

  app.get("/api/complaints/:id/notes", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const complaintId = parseInt(req.params.id);

    let actorSchoolId: number | undefined;
    if (req.session.teacherId) {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });
      actorSchoolId = teacher.schoolId;
    } else if (req.session.userId && req.session.schoolId) {
      actorSchoolId = req.session.schoolId;
    }

    if (!actorSchoolId) return res.status(403).json({ message: "School context missing" });
    const c = await storage.getComplaintByIdForSchool(complaintId, actorSchoolId);
    if (!c) return res.status(404).json({ message: "Complaint not found" });

    if (req.session.teacherId) {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });
      if (STUDENT_ONLY_TYPES.includes(c.complaintType as typeof STUDENT_ONLY_TYPES[number])) {
        return res.status(403).json({ message: "Access denied" });
      }
      // Private teacher-to-admin complaints: only the filing teacher may read notes
      if (c.complaintType === "teacher-to-admin" && c.teacherId !== teacher.id) {
        return res.status(403).json({ message: "Access denied: not your private complaint" });
      }
    }

    const notes = await storage.getComplaintNotes(complaintId);
    res.json(notes);
  });

  // ===== CLASS FEED (Peer Reports for Class Teacher) =====
  app.get("/api/complaints/class-feed", async (req, res) => {
    if (!req.session.teacherId) return res.status(403).json({ message: "Teacher access required" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const fmMappings = await storage.getFacultyMappingsByTeacher(req.session.teacherId);

    // Merge faculty_mappings with the legacy assignedClass/assignedSection field so
    // teachers whose assignments were saved only in the teachers table are not excluded.
    const allMappings = [...fmMappings];
    if (teacher.assignedClass && teacher.assignedSection) {
      const alreadyPresent = allMappings.some(
        m => m.className === teacher.assignedClass && m.section === teacher.assignedSection
      );
      if (!alreadyPresent) {
        allMappings.push({ className: teacher.assignedClass, section: teacher.assignedSection, subject: null });
      }
    }

    console.log(
      `[ClassFeed] Teacher ${teacher.id} (${teacher.fullName}) — effective class assignments:`,
      allMappings.map(m => `${m.className}-${m.section}`)
    );

    const filterClass = (req.query.cls as string) || undefined;
    const filterSection = (req.query.section as string) || undefined;
    const list = await storage.getClassFeedComplaints(teacher.schoolId, allMappings, filterClass, filterSection);
    res.json(list);
  });

  app.patch("/api/complaints/:id/resolve", async (req, res) => {
    if (!req.session.teacherId) return res.status(403).json({ message: "Teacher access required" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const id = parseInt(req.params.id);
    const { resolutionRemarks } = req.body;
    if (!resolutionRemarks?.trim()) return res.status(400).json({ message: "Resolution remarks are required" });
    const complaint = await storage.getComplaintByIdForSchool(id, teacher.schoolId);
    if (!complaint) return res.status(404).json({ message: "Complaint not found" });
    if (complaint.complaintType !== "student-peer-report") return res.status(403).json({ message: "Access denied" });
    // Hard-fail if no target studentId — peer reports must always have one
    if (!complaint.studentId) return res.status(403).json({ message: "Complaint has no target student" });
    const targetStudent = await storage.getStudentById(complaint.studentId);
    const fmForResolve = await storage.getFacultyMappingsByTeacher(teacher.id);
    const effectiveForResolve = [...fmForResolve];
    if (teacher.assignedClass && teacher.assignedSection &&
        !effectiveForResolve.some(m => m.className === teacher.assignedClass && m.section === teacher.assignedSection)) {
      effectiveForResolve.push({ className: teacher.assignedClass, section: teacher.assignedSection, subject: null });
    }
    const isAuthorizedToResolve = effectiveForResolve.some(
      m => m.className === targetStudent?.class && m.section === targetStudent?.section
    );
    if (!targetStudent || !isAuthorizedToResolve) {
      return res.status(403).json({ message: "Not authorized: target student not in your assigned classes" });
    }
    const updated = await storage.resolveComplaint(id, teacher.schoolId, resolutionRemarks.trim());
    if (!updated) return res.status(404).json({ message: "Complaint not found" });
    res.json(updated);
  });

  // Teacher self-resolves their own teacher-to-student complaint
  app.patch("/api/teacher/complaints/:id/self-resolve", async (req, res) => {
    if (!req.session.teacherId) return res.status(403).json({ message: "Teacher access required" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const id = parseInt(req.params.id);
    const complaint = await storage.getComplaintByIdForSchool(id, teacher.schoolId);
    if (!complaint) return res.status(404).json({ message: "Complaint not found" });
    if (complaint.complaintType !== "teacher-to-student") return res.status(403).json({ message: "Only teacher-to-student complaints can be self-resolved" });
    if (complaint.teacherId !== teacher.id) return res.status(403).json({ message: "Not authorized: not your complaint" });
    if (complaint.status === "Resolved") return res.status(409).json({ message: "Already resolved" });
    const updated = await storage.resolveComplaint(id, teacher.schoolId, null);
    if (!updated) return res.status(404).json({ message: "Complaint not found" });
    res.json(updated);
  });

  app.patch("/api/complaints/:id/escalate", async (req, res) => {
    if (!req.session.teacherId) return res.status(403).json({ message: "Teacher access required" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const id = parseInt(req.params.id);
    const complaint = await storage.getComplaintByIdForSchool(id, teacher.schoolId);
    if (!complaint) return res.status(404).json({ message: "Complaint not found" });
    if (complaint.complaintType !== "student-peer-report") return res.status(403).json({ message: "Access denied" });
    // Hard-fail if no target studentId — peer reports must always have one
    if (!complaint.studentId) return res.status(403).json({ message: "Complaint has no target student" });
    const targetStudent = await storage.getStudentById(complaint.studentId);
    const fmForEscalate = await storage.getFacultyMappingsByTeacher(teacher.id);
    const effectiveForEscalate = [...fmForEscalate];
    if (teacher.assignedClass && teacher.assignedSection &&
        !effectiveForEscalate.some(m => m.className === teacher.assignedClass && m.section === teacher.assignedSection)) {
      effectiveForEscalate.push({ className: teacher.assignedClass, section: teacher.assignedSection, subject: null });
    }
    const isAuthorizedToEscalate = effectiveForEscalate.some(
      m => m.className === targetStudent?.class && m.section === targetStudent?.section
    );
    if (!targetStudent || !isAuthorizedToEscalate) {
      return res.status(403).json({ message: "Not authorized: target student not in your assigned classes" });
    }
    const updated = await storage.escalateComplaint(id, teacher.schoolId);
    if (!updated) return res.status(404).json({ message: "Complaint not found" });
    res.json(updated);
  });

  // ===== COMPLAINT BULK DELETE (Admin only) =====
  app.delete("/api/admin/complaints/bulk", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Admin only" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(400).json({ message: "No school context" });
    const { olderThanDays, complaintTypes } = req.body;
    if (typeof olderThanDays !== "number" || olderThanDays < 0) return res.status(400).json({ message: "Invalid olderThanDays (0 = no age restriction)" });
    const user = await storage.getUserById(req.session.userId);
    const types = Array.isArray(complaintTypes) ? complaintTypes : undefined;
    const deleted = await storage.bulkDeleteComplaints(schoolId, olderThanDays, req.session.userId, "admin", user?.email ?? "Admin", types);
    res.json({ deleted });
  });

  // ===== EXAMINATION =====
  app.post("/api/exam-scores", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });

      const { scores, subject, examType, totalMarks, passMarks, class: cls, section } = req.body;
      if (!Array.isArray(scores) || !subject || !examType) return res.status(400).json({ message: "Scores, subject, and examType required" });

      const resolvedClass = cls || teacher.assignedClass || null;
      const resolvedSection = section || teacher.assignedSection || null;
      const maxMarks = parseInt(totalMarks) || 100;
      const pMarks = parseInt(passMarks) || 33;
      // Tag each score with the academic session. Prefer the header value
      // (admin previewing an archived year); otherwise resolve the school's
      // active session so teacher-submitted scores are always year-tagged.
      const activeSessionForTag = (req as any).viewSessionId
        ? null
        : await storage.getActiveSession(teacher.schoolId);
      const scoreSessionId: number | null =
        (req as any).viewSessionId ?? activeSessionForTag?.id ?? null;

      const formattedScores = scores.map((s: any) => ({
        studentId: parseInt(s.studentId),
        teacherId: teacher.id,
        schoolId: teacher.schoolId,
        subject,
        examType,
        marks: s.isAbsent ? 0 : parseInt(s.marks) || 0,
        totalMarks: maxMarks,
        passMarks: pMarks,
        isAbsent: !!s.isAbsent,
        class: resolvedClass || null,
        section: resolvedSection || null,
        updatedBy: teacher.fullName,
        sessionId: scoreSessionId,
      }));

      const saved = await storage.upsertExamScores(formattedScores);
      res.json({ message: `Saved ${saved.length} scores`, count: saved.length });
    } catch (err: any) {
      console.error("POST /api/exam-scores error:", err);
      res.status(500).json({ message: err?.message || "Failed to save exam scores" });
    }
  });

  app.post("/api/exam-scores/publish", async (req, res) => {
    if (!req.session.teacherId && (!req.session.userId || req.session.userRole !== "admin")) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const { class: cls, section, examType, schoolId } = req.body;
      if (!cls || !section || !examType || !schoolId) {
        return res.status(400).json({ message: "class, section, examType, schoolId required" });
      }
      const sid = parseInt(schoolId);
      if (req.session.teacherId) {
        const teacher = await storage.getTeacherById(req.session.teacherId);
        if (!teacher || teacher.schoolId !== sid) return res.status(403).json({ message: "Not authorized for this school" });
      } else if (req.session.schoolId !== sid) {
        return res.status(403).json({ message: "Not authorized for this school" });
      }
      const count = await storage.publishExamScores(sid, cls, section, examType, (req as any).viewSessionId ?? undefined);
      res.json({ message: `Published ${count} scores`, count });
    } catch (err: any) {
      console.error("POST /api/exam-scores/publish error:", err);
      res.status(500).json({ message: err?.message || "Failed to publish scores" });
    }
  });

  // IMPORTANT: specific routes must be registered before the parameterized wildcard route
  app.get("/api/exam-scores/class-average/:schoolId/:class/:section/:subject", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const { schoolId, class: cls, section, subject } = req.params;
      const sid = parseInt(schoolId);
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher || teacher.schoolId !== sid) return res.status(403).json({ message: "Not authorized for this school" });
      const averages = await storage.getClassAverages(sid, decodeURIComponent(cls), decodeURIComponent(section), decodeURIComponent(subject));
      res.json(averages);
    } catch (err: any) {
      console.error("GET /api/exam-scores/class-average error:", err);
      res.status(500).json({ message: err?.message || "Failed to fetch class averages" });
    }
  });

  app.get("/api/exam-scores/student/:studentId/:schoolId", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const studentId = parseInt(req.params.studentId);
      const schoolId = parseInt(req.params.schoolId);
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher || teacher.schoolId !== schoolId) return res.status(403).json({ message: "Not authorized for this school" });
      const list = await storage.getExamScoresByStudent(studentId, schoolId);
      res.json(list);
    } catch (err: any) {
      console.error("GET /api/exam-scores/student error:", err);
      res.status(500).json({ message: err?.message || "Failed to fetch student scores" });
    }
  });

  app.get("/api/exam-scores/:schoolId/:subject/:examType/:class/:section", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const { schoolId, subject, examType, class: cls, section } = req.params;
      const list = await storage.getExamScores(parseInt(schoolId), decodeURIComponent(subject), decodeURIComponent(examType), cls, section, (req as any).viewSessionId ?? undefined);
      res.json(list);
    } catch (err: any) {
      console.error("GET /api/exam-scores error:", err);
      res.status(500).json({ message: err?.message || "Failed to fetch exam scores" });
    }
  });

  // ===== SCHOOL CONFIG (Teacher Read-Only) =====
  app.get("/api/school-config/:schoolId", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const schoolId = parseInt(req.params.schoolId);
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher || teacher.schoolId !== schoolId) return res.status(403).json({ message: "Not authorized" });
    const [meta, classSections, classSubjects, classExamTypes] = await Promise.all([
      storage.getAllSchoolMetadata(schoolId),
      storage.getClassSectionsMap(schoolId),
      storage.getClassSubjectsMap(schoolId),
      storage.getClassExamTypesMap(schoolId),
    ]);

    // Derive classes: prefer the explicit flat list saved by the admin;
    // fall back to the keys of the class-sections map (set in School Setup).
    const rawClasses: string[] = meta.classes?.length
      ? meta.classes
      : Object.keys(classSections);

    // Sort numerically where possible (e.g. "6","7","8") then alphabetically for non-numeric (LKG, UKG).
    const classes = [...rawClasses].sort((a, b) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      if (!isNaN(na)) return 1;   // numeric after alpha
      if (!isNaN(nb)) return -1;
      return a.localeCompare(b);
    });

    // Derive sections: prefer explicit flat list; fall back to union of all classSections values.
    const rawSections: string[] = meta.sections?.length
      ? meta.sections
      : [...new Set(Object.values(classSections).flat())].sort();

    res.json({
      classes,
      sections: rawSections,
      subjects: meta.subjects || [],
      examTypes: meta.exam_types || [],
      classSections,
      classSubjects,
      classExamTypes,
    });
  });

  // ===== STUDENT SEARCH =====
  app.get("/api/students/search/:schoolId", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const schoolId = parseInt(req.params.schoolId);
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher || teacher.schoolId !== schoolId) return res.status(403).json({ message: "Not authorized" });
    const q = (req.query.q as string) || "";
    if (q.length < 2) return res.json([]);
    const results = await storage.searchStudents(schoolId, q);
    res.json(results);
  });

  // ===== GALLERY =====
  app.post("/api/gallery", diskUpload.single("image"), async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    if (!req.file) return res.status(400).json({ message: "Image file required" });

    const { title, schoolId, description, eventTag } = req.body;
    if (!title || !schoolId) return res.status(400).json({ message: "Title and schoolId required" });

    const sid = parseInt(schoolId);
    if (req.session.teacherId) {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher || teacher.schoolId !== sid) return res.status(403).json({ message: "Not authorized for this school" });
    } else if (req.session.schoolId !== sid) {
      return res.status(403).json({ message: "Not authorized for this school" });
    }

    const item = await storage.createGalleryItem({
      schoolId: sid,
      uploadedById: req.session.teacherId || req.session.userId!,
      title,
      description: description || null,
      eventTag: eventTag || null,
      imageUrl: `/uploads/${req.file.filename}`,
      approved: !!req.session.userId && !req.session.teacherId,
    });
    await storage.createAuditLog({
      schoolId: sid, actionType: "upload", entityType: "gallery", entityId: item.id,
      actionBy: req.session.teacherId || req.session.userId!, actionByRole: req.session.teacherId ? "teacher" : "admin",
      details: `Uploaded gallery image: ${title}`,
    });
    res.status(201).json(item);
  });

  app.post("/api/gallery/batch", diskUpload.array("images", 10), async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ message: "At least one image required" });

    const { title, schoolId, description, eventTag } = req.body;
    if (!title || !schoolId) return res.status(400).json({ message: "Title and schoolId required" });

    const sid = parseInt(schoolId);
    if (req.session.teacherId) {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher || teacher.schoolId !== sid) return res.status(403).json({ message: "Not authorized for this school" });
    } else if (req.session.schoolId !== sid) {
      return res.status(403).json({ message: "Not authorized for this school" });
    }

    const uploaderId = req.session.teacherId || req.session.userId!;
    const isAdmin = !!req.session.userId && !req.session.teacherId;
    const items = [];
    for (const file of files) {
      const item = await storage.createGalleryItem({
        schoolId: sid, uploadedById: uploaderId, title,
        description: description || null, eventTag: eventTag || null,
        imageUrl: `/uploads/${file.filename}`, approved: isAdmin,
      });
      await storage.createAuditLog({
        schoolId: sid, actionType: "batch_upload", entityType: "gallery", entityId: item.id,
        actionBy: uploaderId, actionByRole: req.session.teacherId ? "teacher" : "admin",
        details: `Batch uploaded gallery image: ${title}`,
      });
      items.push(item);
    }
    res.status(201).json(items);
  });

  app.get("/api/gallery/:schoolId", async (req, res) => {
    if (!req.session.userId && !req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const approvedOnly = req.query.all !== "true";
    const list = await storage.getGalleryItems(parseInt(req.params.schoolId), approvedOnly);
    res.json(list);
  });

  app.patch("/api/gallery/:id/approve", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const existing = await storage.getGalleryItemById(parseInt(req.params.id));
    if (!existing || existing.schoolId !== req.session.schoolId) return res.status(403).json({ message: "Not authorized" });
    const item = await storage.approveGalleryItem(existing.id);
    await storage.createAuditLog({
      schoolId: item.schoolId, actionType: "approve", entityType: "gallery", entityId: item.id,
      actionBy: req.session.userId!, actionByRole: "admin",
      details: `Approved gallery image: ${item.title}`,
    });
    res.json(item);
  });

  // ===== CALENDAR =====
  app.post("/api/calendar", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const { title, date, eventType, schoolId } = req.body;
    if (!title || !date || !eventType || !schoolId) return res.status(400).json({ message: "All fields required" });
    const event = await storage.createCalendarEvent({ schoolId: parseInt(schoolId), title, date, eventType });
    res.status(201).json(event);
  });

  app.get("/api/calendar/:schoolId", async (req, res) => {
    if (!req.session.userId && !req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.getCalendarEvents(parseInt(req.params.schoolId));
    res.json(list);
  });

  app.delete("/api/calendar/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    await storage.deleteCalendarEvent(parseInt(req.params.id));
    res.json({ message: "Event deleted" });
  });

  // ===== LIBRARY =====
  app.post("/api/library/books", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const { title, author, isbn, totalCopies, schoolId } = req.body;
    if (!title || !author || !schoolId) return res.status(400).json({ message: "Title, author, and schoolId required" });
    const copies = parseInt(totalCopies) || 1;
    const book = await storage.createLibraryBook({ schoolId: parseInt(schoolId), title, author, isbn: isbn || null, totalCopies: copies, availableCopies: copies });
    res.status(201).json(book);
  });

  app.get("/api/library/books/:schoolId", async (req, res) => {
    if (!req.session.userId && !req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const q = req.query.q as string;
    const sid = parseInt(req.params.schoolId);
    const list = q ? await storage.searchLibraryBooksAdvanced(sid, q) : await storage.getLibraryBooks(sid);
    res.json(list);
  });

  app.post("/api/library/ebooks", diskUpload.single("file"), async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    if (!req.file) return res.status(400).json({ message: "File required" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const { title, author, targetClass, category } = req.body;
    if (!title || !author) return res.status(400).json({ message: "Title and author required" });

    const ext = req.file.originalname.split(".").pop()?.toLowerCase();
    const book = await storage.createLibraryBook({
      schoolId: teacher.schoolId, title, author, isbn: null,
      targetClass: targetClass || null, category: category || null,
      fileUrl: `/uploads/${req.file.filename}`, fileType: ext || "pdf",
      uploadedById: teacher.id, verificationStatus: "pending",
      totalCopies: 0, availableCopies: 0,
    });
    await storage.createAuditLog({
      schoolId: teacher.schoolId, actionType: "upload", entityType: "ebook", entityId: book.id,
      actionBy: teacher.id, actionByRole: "teacher",
      details: `Uploaded e-book: ${title} by ${author}`,
    });
    res.status(201).json(book);
  });

  app.patch("/api/library/books/:id/verify", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const { status } = req.body;
    if (!["approved", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const existing = await storage.getLibraryBookById(parseInt(req.params.id));
    if (!existing || existing.schoolId !== req.session.schoolId) return res.status(403).json({ message: "Not authorized" });
    const book = await storage.updateBookVerificationStatus(existing.id, status);
    await storage.createAuditLog({
      schoolId: book.schoolId, actionType: "verify", entityType: "ebook", entityId: book.id,
      actionBy: req.session.userId!, actionByRole: "admin",
      details: `${status === "approved" ? "Approved" : "Rejected"} e-book: ${book.title}`,
    });
    res.json(book);
  });

  app.post("/api/library/borrow", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const { bookId } = req.body;
    if (!bookId) return res.status(400).json({ message: "bookId required" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const borrow = await storage.borrowBook(parseInt(bookId), teacher.id, "teacher", teacher.schoolId);
    if (!borrow) return res.status(400).json({ message: "Book not available" });
    res.status(201).json(borrow);
  });

  app.post("/api/library/return/:borrowId", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    await storage.returnBook(parseInt(req.params.borrowId));
    res.json({ message: "Book returned" });
  });

  app.get("/api/library/my-books", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.getMyBorrowedBooks(req.session.teacherId, "teacher");
    res.json(list);
  });

  app.delete("/api/library/books/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    await storage.deleteLibraryBook(parseInt(req.params.id));
    res.json({ message: "Book deleted" });
  });

  // ===== LEAVE =====
  app.post("/api/leave", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const { leaveType, startDate, endDate, reason } = req.body;
    if (!leaveType || !startDate || !endDate || !reason) return res.status(400).json({ message: "All fields required" });

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
      return res.status(400).json({ message: "Invalid date range" });
    }
    const daysRequested = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const eligiblePolicies = await storage.getActiveLeavePoliciesBySchool(teacher.schoolId, "teacher");
    const matchedPolicy = eligiblePolicies.find(p => p.name.toLowerCase() === leaveType.toLowerCase());
    if (!matchedPolicy) {
      return res.status(400).json({ message: `"${leaveType}" is not an active leave type for your school.` });
    }

    const balances = await storage.getTeacherLeaveBalanceByPolicies(teacher.id, teacher.schoolId);
    const matchedBalance = balances.find(b => b.policyId === matchedPolicy.id);
    if (matchedBalance !== undefined && matchedBalance.remaining < daysRequested) {
      return res.status(400).json({
        message: `Insufficient ${leaveType} balance. ${matchedBalance.remaining} day(s) remaining, ${daysRequested} day(s) requested.`,
      });
    }

    const leave = await storage.createLeaveRequest({
      teacherId: teacher.id, schoolId: teacher.schoolId, policyId: matchedPolicy.id,
      leaveType, startDate, endDate, reason, status: "pending",
    });
    res.status(201).json(leave);
  });

  app.get("/api/leave/teacher/:teacherId", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.getLeaveRequestsByTeacher(parseInt(req.params.teacherId));
    res.json(list);
  });

  app.get("/api/leave/school/:schoolId", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    if (req.session.schoolId !== parseInt(req.params.schoolId)) return res.status(403).json({ message: "Not authorized" });
    const list = await storage.getLeaveRequestsBySchool(parseInt(req.params.schoolId));
    res.json(list);
  });

  app.patch("/api/leave/:id/status", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const { status } = req.body;
    if (!["approved", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const leave = await storage.getLeaveRequestById(parseInt(req.params.id));
    if (!leave || leave.schoolId !== req.session.schoolId) return res.status(403).json({ message: "Not authorized" });
    const updated = await storage.updateLeaveStatusWithApprover(leave.id, status, req.session.userId!);
    await storage.createAuditLog({
      schoolId: updated.schoolId, actionType: status, entityType: "teacher_leave", entityId: updated.id,
      actionBy: req.session.userId!, actionByRole: "admin",
      details: `${status === "approved" ? "Approved" : "Rejected"} teacher leave request`,
    });

    // When approved: sync attendance records as "Leave" for all leave dates
    if (status === "approved" && leave.teacherId) {
      const now = new Date();
      const startD = new Date(leave.startDate + "T00:00:00Z");
      const endD   = new Date(leave.endDate   + "T00:00:00Z");
      for (let d = new Date(startD); d <= endD; d.setUTCDate(d.getUTCDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const [existing] = await db.select().from(teacherSelfAttendance)
          .where(and(eq(teacherSelfAttendance.teacherId, leave.teacherId), eq(teacherSelfAttendance.attendanceDate, dateStr)));
        if (!existing) {
          await db.insert(teacherSelfAttendance).values({
            teacherId: leave.teacherId, schoolId: leave.schoolId,
            attendanceDate: dateStr, status: "Leave",
            totalWorkingMinutes: 0,
          });
        } else if (!["Present", "Late", "Half Day"].includes(existing.status ?? "")) {
          await db.update(teacherSelfAttendance)
            .set({ status: "Leave", updatedAt: now })
            .where(eq(teacherSelfAttendance.id, existing.id));
        }
      }
    }

    res.json(updated);
  });

  app.get("/api/leave/balance/:teacherId", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const tid = parseInt(req.params.teacherId);
    if (tid !== req.session.teacherId) return res.status(403).json({ message: "Not authorized" });
    const teacher = await storage.getTeacherById(tid);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const balance = await storage.getTeacherLeaveBalanceByPolicies(tid, teacher.schoolId);
    res.json(balance);
  });

  app.delete("/api/leave/:id", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const result = await storage.deleteLeaveRequest(id, req.session.teacherId);
    if (!result.success) {
      if (result.reason === "not_found") return res.status(404).json({ message: "Leave request not found" });
      if (result.reason === "forbidden") return res.status(403).json({ message: "Not authorized" });
      if (result.reason === "not_pending") return res.status(400).json({ message: "Only pending leave requests can be deleted" });
    }
    res.json({ message: "Leave request deleted" });
  });

  app.get("/api/leave/policies/:schoolId", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const schoolId = parseInt(req.params.schoolId);
    if (isNaN(schoolId)) return res.status(400).json({ message: "Invalid school ID" });
    if (req.session.schoolId !== schoolId) return res.status(403).json({ message: "Not authorized" });
    const isAdmin = !!req.session.userId && req.session.userRole !== "teacher";
    const policies = await storage.getActiveLeavePoliciesBySchool(schoolId, isAdmin ? undefined : "teacher");
    res.json(policies);
  });

  app.get("/api/admin/leave-policies", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(400).json({ message: "No school context" });
    const policies = await storage.getLeavePoliciesBySchool(schoolId);
    res.json(policies);
  });

  app.post("/api/admin/leave-policies", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(400).json({ message: "No school context" });
    const { name, annualLimit, targetRoles, renewalMonth, renewalDay, expiryBehavior, isActive } = req.body;
    if (!name || !annualLimit) return res.status(400).json({ message: "Name and annual limit are required" });
    const parsedLimit = parseInt(annualLimit);
    if (isNaN(parsedLimit) || parsedLimit < 1) return res.status(400).json({ message: "Annual limit must be a positive number" });
    const validRoles = ["all", "teacher", "non_teaching"];
    if (targetRoles && !validRoles.includes(targetRoles)) return res.status(400).json({ message: "Invalid target roles" });
    const validExpiry = ["expire", "carry_forward"];
    if (expiryBehavior && !validExpiry.includes(expiryBehavior)) return res.status(400).json({ message: "Invalid expiry behavior" });
    const parsedMonth = parseInt(renewalMonth) || 1;
    const parsedDay = parseInt(renewalDay) || 1;
    if (parsedMonth < 1 || parsedMonth > 12) return res.status(400).json({ message: "Renewal month must be 1–12" });
    if (parsedDay < 1 || parsedDay > 31) return res.status(400).json({ message: "Renewal day must be 1–31" });
    const existing = await storage.getLeavePoliciesBySchool(schoolId);
    if (existing.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      return res.status(409).json({ message: `A leave policy named "${name.trim()}" already exists for this school.` });
    }
    const policy = await storage.createLeavePolicy({
      schoolId, name: name.trim(),
      annualLimit: parseInt(annualLimit) || 12,
      targetRoles: targetRoles || "all",
      renewalMonth: parseInt(renewalMonth) || 1,
      renewalDay: parseInt(renewalDay) || 1,
      expiryBehavior: expiryBehavior || "expire",
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    });
    res.status(201).json(policy);
  });

  app.patch("/api/admin/leave-policies/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const existing = await storage.getLeavePolicyById(id);
    if (!existing || existing.schoolId !== req.session.schoolId) return res.status(403).json({ message: "Not authorized" });
    const { name, annualLimit, targetRoles, renewalMonth, renewalDay, expiryBehavior, isActive } = req.body;
    if (name !== undefined) {
      const validRoles = ["all", "teacher", "non_teaching"];
      const validExpiry = ["expire", "carry_forward"];
      if (targetRoles && !validRoles.includes(targetRoles)) return res.status(400).json({ message: "Invalid target roles" });
      if (expiryBehavior && !validExpiry.includes(expiryBehavior)) return res.status(400).json({ message: "Invalid expiry behavior" });
      if (renewalMonth && (parseInt(renewalMonth) < 1 || parseInt(renewalMonth) > 12)) return res.status(400).json({ message: "Renewal month must be 1–12" });
      if (renewalDay && (parseInt(renewalDay) < 1 || parseInt(renewalDay) > 31)) return res.status(400).json({ message: "Renewal day must be 1–31" });
      const allPolicies = await storage.getLeavePoliciesBySchool(req.session.schoolId!);
      if (allPolicies.some(p => p.id !== id && p.name.toLowerCase() === name.trim().toLowerCase())) {
        return res.status(409).json({ message: `A leave policy named "${name.trim()}" already exists for this school.` });
      }
    }
    const updated = await storage.updateLeavePolicy(id, {
      ...(name !== undefined && { name: name.trim() }),
      ...(annualLimit !== undefined && { annualLimit: parseInt(annualLimit) }),
      ...(targetRoles !== undefined && { targetRoles }),
      ...(renewalMonth !== undefined && { renewalMonth: parseInt(renewalMonth) }),
      ...(renewalDay !== undefined && { renewalDay: parseInt(renewalDay) }),
      ...(expiryBehavior !== undefined && { expiryBehavior }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) }),
    });
    res.json(updated);
  });

  app.delete("/api/admin/leave-policies/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const existing = await storage.getLeavePolicyById(id);
    if (!existing || existing.schoolId !== req.session.schoolId) return res.status(403).json({ message: "Not authorized" });
    await storage.deleteLeavePolicy(id);
    res.json({ message: "Policy deleted" });
  });

  // ===== STUDENT LEAVE REQUESTS =====
  app.get("/api/student-leaves/:schoolId/:class/:section", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    const sid = parseInt(req.params.schoolId);
    if (!teacher || teacher.schoolId !== sid) return res.status(403).json({ message: "Not authorized for this school" });
    if (teacher.assignedClass !== req.params.class || teacher.assignedSection !== req.params.section) {
      return res.status(403).json({ message: "Not authorized for this class/section" });
    }
    const list = await storage.getStudentLeavesByClassSection(sid, req.params.class, req.params.section);
    res.json(list);
  });

  app.patch("/api/student-leaves/:id/approve", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const leave = await storage.getStudentLeaveById(parseInt(req.params.id));
    if (!leave || leave.schoolId !== teacher.schoolId) return res.status(403).json({ message: "Not authorized" });
    const student = await storage.getStudentById(leave.studentId);
    if (!student || student.class !== teacher.assignedClass || student.section !== teacher.assignedSection) {
      return res.status(403).json({ message: "Not authorized for this student's class/section" });
    }
    const updated = await storage.updateStudentLeaveStatus(leave.id, "approved", teacher.id, "teacher");
    await storage.markAttendanceAsLeave(leave.studentId, teacher.id, teacher.schoolId, leave.startDate, leave.endDate);
    await storage.createAuditLog({
      schoolId: teacher.schoolId, actionType: "approve", entityType: "student_leave", entityId: leave.id,
      actionBy: teacher.id, actionByRole: "teacher",
      details: `Approved student leave and synced attendance for dates ${leave.startDate} to ${leave.endDate}`,
    });
    res.json(updated);
  });

  app.patch("/api/student-leaves/:id/forward", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const leave = await storage.getStudentLeaveById(parseInt(req.params.id));
    if (!leave || leave.schoolId !== teacher.schoolId) return res.status(403).json({ message: "Not authorized" });
    const student = await storage.getStudentById(leave.studentId);
    if (!student || student.class !== teacher.assignedClass || student.section !== teacher.assignedSection) {
      return res.status(403).json({ message: "Not authorized for this student's class/section" });
    }
    const updated = await storage.updateStudentLeaveStatus(leave.id, "forwarded", teacher.id, "teacher");
    await storage.createAuditLog({
      schoolId: teacher.schoolId, actionType: "forward", entityType: "student_leave", entityId: leave.id,
      actionBy: teacher.id, actionByRole: "teacher",
      details: `Forwarded student leave to principal`,
    });
    res.json(updated);
  });


  // ===== TIMETABLE =====
  app.post("/api/timetable", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const { teacherId, dayOfWeek, period, class: cls, section, subject } = req.body;
    if (teacherId === undefined || dayOfWeek === undefined || period === undefined || !cls || !section || !subject)
      return res.status(400).json({ message: "All fields required" });
    // Always use session schoolId — never trust body schoolId
    const sessionSchoolId = req.session.schoolId!;
    // Verify teacher belongs to admin's school
    const tid = parseInt(teacherId);
    const teacher = await storage.getTeacherById(tid);
    if (!teacher || teacher.schoolId !== sessionSchoolId) return res.status(403).json({ message: "Teacher does not belong to your school" });
    const entry = await storage.createTimetableEntry({
      teacherId: tid, schoolId: sessionSchoolId,
      dayOfWeek: parseInt(dayOfWeek), period: parseInt(period), class: cls, section, subject,
    });
    res.status(201).json(entry);
  });

  app.get("/api/timetable/teacher/:teacherId", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const tid = parseInt(req.params.teacherId);
    // Teachers can only view their own timetable
    if (req.session.teacherId && req.session.teacherId !== tid)
      return res.status(403).json({ message: "Not authorized" });
    // Admins can only view teachers in their own school
    if (req.session.userId) {
      const teacher = await storage.getTeacherById(tid);
      if (!teacher || teacher.schoolId !== req.session.schoolId)
        return res.status(403).json({ message: "Not authorized" });
    }
    const list = await storage.getTimetableByTeacher(tid);
    res.json(list);
  });

  app.get("/api/timetable/school/:schoolId", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    // Enforce session school — never trust path param for authorization
    const requestedSchoolId = parseInt(req.params.schoolId);
    if (requestedSchoolId !== req.session.schoolId)
      return res.status(403).json({ message: "Not authorized" });
    const list = await storage.getTimetableBySchool(req.session.schoolId!);
    res.json(list);
  });

  app.delete("/api/timetable/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    // Pass schoolId to enforce tenant isolation at storage query level
    const entry = await storage.getTimetableEntryById(parseInt(req.params.id), req.session.schoolId!);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    await storage.deleteTimetableEntry(entry.id, req.session.schoolId!);
    res.json({ message: "Entry deleted" });
  });

  // ===== TEACHER ALLOCATION ROUTES (Admin only) =====

  app.post("/api/teacher-allocations", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const { teacherId, subject, class: cls, section, weeklyQuota } = req.body;
    if (!teacherId || !subject || !cls || !section) return res.status(400).json({ message: "teacherId, subject, class, section required" });
    // Verify teacher belongs to admin's school
    const tid = parseInt(teacherId);
    const teacher = await storage.getTeacherById(tid);
    if (!teacher || teacher.schoolId !== req.session.schoolId) return res.status(403).json({ message: "Teacher does not belong to your school" });
    const alloc = await storage.createTeacherAllocation({
      schoolId: req.session.schoolId!,
      teacherId: tid,
      subject,
      class: cls,
      section,
      weeklyQuota: weeklyQuota ? parseInt(weeklyQuota) : 6,
    });
    res.status(201).json(alloc);
  });

  app.get("/api/teacher-allocations", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const list = await storage.getTeacherAllocationsBySchool(req.session.schoolId!);
    res.json(list);
  });

  app.get("/api/teacher-allocations/teacher/:teacherId", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const tid = parseInt(req.params.teacherId);
    if (req.session.teacherId) {
      // Teachers can only access their own allocations
      if (req.session.teacherId !== tid) return res.status(403).json({ message: "Not authorized" });
    }
    const schoolId = req.session.teacherId
      ? (await storage.getTeacherById(req.session.teacherId))?.schoolId
      : req.session.schoolId;
    if (!schoolId) return res.status(403).json({ message: "Not authorized" });
    const list = await storage.getTeacherAllocationsByTeacher(tid, schoolId);
    res.json(list);
  });

  app.delete("/api/teacher-allocations/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const ok = await storage.deleteTeacherAllocation(parseInt(req.params.id), req.session.schoolId!);
    if (!ok) return res.status(404).json({ message: "Allocation not found" });
    res.json({ message: "Allocation deleted" });
  });

  // ===== TEACHER SELF-MANAGEMENT TIMETABLE ROUTES =====

  app.post("/api/timetable/teacher-slot", async (req, res) => {
    if (!req.session.teacherId) return res.status(403).json({ message: "Teacher access required" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const { dayOfWeek, period, class: cls, section, subject, room, startTime, endTime } = req.body;
    if (dayOfWeek === undefined || period === undefined || !cls || !section || !subject)
      return res.status(400).json({ message: "dayOfWeek, period, class, section, subject required" });
    const validation = await storage.validateTimetableEntry({
      schoolId: teacher.schoolId,
      teacherId: teacher.id,
      dayOfWeek: parseInt(dayOfWeek),
      period: parseInt(period),
      class: cls,
      section,
      subject,
      room: room || null,
      requireAllocation: true,
    });
    if (!validation.valid) return res.status(409).json({ message: validation.error });
    const entry = await storage.createTimetableEntry({
      schoolId: teacher.schoolId,
      teacherId: teacher.id,
      dayOfWeek: parseInt(dayOfWeek),
      period: parseInt(period),
      class: cls,
      section,
      subject,
      room: room || null,
      startTime: startTime || null,
      endTime: endTime || null,
      status: "draft",
    });
    res.status(201).json(entry);
  });

  app.patch("/api/timetable/:id/teacher", async (req, res) => {
    if (!req.session.teacherId) return res.status(403).json({ message: "Teacher access required" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    // Pass teacher.schoolId and teacher.id for school+ownership isolation at query level
    const entry = await storage.getTimetableEntryById(parseInt(req.params.id), teacher.schoolId);
    if (!entry || entry.teacherId !== teacher.id)
      return res.status(403).json({ message: "Not authorized" });
    const { dayOfWeek, period, class: cls, section, subject, room, startTime, endTime } = req.body;
    const newDay = dayOfWeek !== undefined ? parseInt(dayOfWeek) : entry.dayOfWeek;
    const newPeriod = period !== undefined ? parseInt(period) : entry.period;
    const newClass = cls || entry.class;
    const newSection = section || entry.section;
    const newSubject = subject || entry.subject;
    const validation = await storage.validateTimetableEntry({
      schoolId: teacher.schoolId,
      teacherId: teacher.id,
      dayOfWeek: newDay,
      period: newPeriod,
      class: newClass,
      section: newSection,
      subject: newSubject,
      room: room !== undefined ? (room || null) : entry.room,
      excludeId: entry.id,
      requireAllocation: true,
    });
    if (!validation.valid) return res.status(409).json({ message: validation.error });
    const updated = await storage.updateTimetableEntry(entry.id, teacher.schoolId, {
      dayOfWeek: newDay,
      period: newPeriod,
      class: newClass,
      section: newSection,
      subject: newSubject,
      room: room !== undefined ? (room || null) : entry.room,
      startTime: startTime !== undefined ? (startTime || null) : entry.startTime,
      endTime: endTime !== undefined ? (endTime || null) : entry.endTime,
      status: entry.status === "published" ? "draft" : entry.status,
    });
    if (!updated) return res.status(404).json({ message: "Entry not found" });
    res.json(updated);
  });

  app.delete("/api/timetable/:id/teacher", async (req, res) => {
    if (!req.session.teacherId) return res.status(403).json({ message: "Teacher access required" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    // School-scoped query at storage level: null returned if ID belongs to another school
    const entry = await storage.getTimetableEntryById(parseInt(req.params.id), teacher.schoolId);
    if (!entry || entry.teacherId !== teacher.id)
      return res.status(403).json({ message: "Not authorized" });
    await storage.deleteTimetableEntry(entry.id, teacher.schoolId);
    res.json({ message: "Entry deleted" });
  });

  // ===== ADMIN PUBLISH ROUTE =====

  app.patch("/api/timetable/publish", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const { class: cls, section } = req.body;
    if (!cls || !section) return res.status(400).json({ message: "class and section required" });
    const count = await storage.updateTimetableEntryStatus(req.session.schoolId!, cls, section, "published");
    res.json({ message: `Published ${count} entries for Class ${cls}-${section}`, count });
  });

  app.get("/api/timetable/class-status", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const statuses = await storage.getClassSectionStatus(req.session.schoolId!);
    res.json(statuses);
  });

  // ===== CLASS-VIEW: full grid for a class (admin + teacher) =====
  app.get("/api/timetable/class-view", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const { class: cls, section } = req.query as { class?: string; section?: string };
    if (!cls || !section) return res.status(400).json({ message: "class and section query params required" });
    let schoolId: number;
    if (req.session.teacherId) {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });
      schoolId = teacher.schoolId;
    } else {
      schoolId = req.session.schoolId!;
    }
    const list = await storage.getTimetableByClassSection(schoolId, cls, section);
    const structure = await storage.getTimetableStructure(schoolId, cls);
    res.json({ entries: list, structure });
  });

  // ===== SLOT CHECK: real-time collision check for teacher popover =====
  app.get("/api/timetable/slot-check", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const { class: cls, section, dayOfWeek, period } = req.query as { class?: string; section?: string; dayOfWeek?: string; period?: string };
    if (!cls || !section || dayOfWeek === undefined || period === undefined) {
      return res.status(400).json({ message: "class, section, dayOfWeek, period required" });
    }
    let schoolId: number;
    let excludeTeacherId: number | undefined;
    if (req.session.teacherId) {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });
      schoolId = teacher.schoolId;
      excludeTeacherId = teacher.id;
    } else {
      schoolId = req.session.schoolId!;
    }
    const occupancy = await storage.checkSlotOccupancy(schoolId, cls, section, parseInt(dayOfWeek), parseInt(period), excludeTeacherId);
    if (!occupancy) {
      return res.json({ taken: false });
    }
    return res.json({ taken: true, teacherName: occupancy.teacherName, subject: occupancy.subject });
  });

  // ===== ADMIN BATCH SAVE =====
  app.post("/api/timetable/admin/save-batch", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(400).json({ message: "School session missing — please log in again" });
    const { changes } = req.body as {
      changes: Array<{
        dayOfWeek: number;
        period: number;
        class: string;
        section: string;
        teacherId: number | null;
        subject: string | null;
        _delete?: boolean;
      }>;
    };
    if (!Array.isArray(changes)) return res.status(400).json({ message: "changes array required" });
    const saved: unknown[] = [];
    const errors: string[] = [];
    for (const change of changes) {
      const { dayOfWeek, period, class: cls, section, teacherId, subject } = change;
      try {
        if (change._delete) {
          await storage.deleteTimetableSlot(schoolId, cls, section, dayOfWeek, period);
          continue;
        }
        // Guard: teacherId must be a valid integer
        if (teacherId === null || teacherId === undefined || !Number.isInteger(teacherId)) {
          errors.push(`Slot Day${dayOfWeek} P${period}: a valid teacher must be selected`);
          continue;
        }
        if (!subject) {
          errors.push(`Slot Day${dayOfWeek} P${period}: subject is required`);
          continue;
        }
        const teacher = await storage.getTeacherById(teacherId);
        if (!teacher || teacher.schoolId !== schoolId) {
          errors.push(`Slot Day${dayOfWeek} P${period}: teacher not found in your school`);
          continue;
        }
        const entry = await storage.upsertTimetableSlot(schoolId, { dayOfWeek, period, class: cls, section, teacherId, subject });
        saved.push(entry);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[save-batch] slot Day${dayOfWeek} P${period} error:`, msg);
        if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("conflict")) {
          errors.push(`Slot Day${dayOfWeek} P${period} (${cls}-${section}): conflict — slot already assigned`);
        } else {
          errors.push(`Slot Day${dayOfWeek} P${period}: ${msg}`);
        }
      }
    }
    res.json({ saved, errors });
  });

  // ===== TEACHER BATCH SAVE with collision detection =====
  app.post("/api/timetable/teacher/save-batch", async (req, res) => {
    if (!req.session.teacherId) return res.status(403).json({ message: "Teacher access required" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const { changes } = req.body as {
      changes: Array<{
        dayOfWeek: number;
        period: number;
        class: string;
        section: string;
        subject: string;
        room?: string;
        _delete?: boolean;
      }>;
    };
    if (!Array.isArray(changes)) return res.status(400).json({ message: "changes array required" });
    const saved: unknown[] = [];
    const conflicts: Array<{ dayOfWeek: number; period: number; teacherName: string; subject: string }> = [];
    for (const change of changes) {
      const { dayOfWeek, period, class: cls, section, subject, room } = change;
      if (change._delete) {
        await storage.deleteTeacherTimetableSlot(teacher.schoolId, teacher.id, dayOfWeek, period);
        continue;
      }
      const occupancy = await storage.checkSlotOccupancy(teacher.schoolId, cls, section, dayOfWeek, period, teacher.id);
      if (occupancy) {
        conflicts.push({ dayOfWeek, period, teacherName: occupancy.teacherName, subject: occupancy.subject });
        continue;
      }
      const entry = await storage.upsertTeacherTimetableSlot(teacher.schoolId, teacher.id, { dayOfWeek, period, class: cls, section, subject, room: room || null });
      saved.push(entry);
    }
    res.json({ saved, conflicts });
  });

  // ===== TIMETABLE STRUCTURE (Period Bell Schedule) =====
  app.get("/api/timetable/structure", async (req, res) => {
    // Allow admin, teacher, and student sessions
    let schoolId: number | undefined;
    if (req.session.userId) {
      schoolId = req.session.schoolId;
    } else if (req.session.teacherId) {
      schoolId = req.session.schoolId;
    } else if (req.session.studentId) {
      const student = await storage.getStudentById(req.session.studentId);
      if (!student) return res.status(401).json({ message: "Student not found" });
      schoolId = student.schoolId;
    } else {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!schoolId) return res.status(401).json({ message: "School not found" });
    const cls = req.query.class as string;
    if (!cls) return res.status(400).json({ message: "class query param required" });
    const rows = await storage.getTimetableStructure(schoolId, cls);
    res.json(rows);
  });

  app.post("/api/timetable/structure", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId;
    if (!schoolId) return res.status(400).json({ message: "School session missing — please log in again" });
    const { class: cls, rows } = req.body as {
      class: string;
      rows: Array<{
        periodNumber: number;
        label: string;
        startTime: string;
        endTime: string;
        isBreak: boolean;
        sortOrder?: number;
      }>;
    };
    if (!cls || !Array.isArray(rows)) return res.status(400).json({ message: "class and rows required" });
    try {
      const saved = await storage.saveTimetableStructure(schoolId, cls, rows);
      res.json({ saved });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[timetable/structure POST] error:", msg);
      res.status(500).json({ message: `Failed to save structure: ${msg}` });
    }
  });

  app.delete("/api/timetable/structure/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const deleted = await storage.deleteTimetableStructureById(id, schoolId);
    if (!deleted) return res.status(404).json({ message: "Structure row not found" });
    res.json({ deleted: true });
  });

  // ===== FACULTY INFO =====
  app.get("/api/faculty/:schoolId", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.getFacultyBySchoolWithMappings(parseInt(req.params.schoolId));
    res.json(list);
  });

  // ===== PAGINATED STUDENTS (Big Data) =====
  app.get("/api/schools/:schoolId/students/paginated", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
    if (req.session.schoolId !== parseInt(req.params.schoolId)) return res.status(403).json({ message: "Not authorized" });
    const { q, cls, section, page, pendingReissue } = req.query;
    const result = await storage.getStudentsPaginated(parseInt(req.params.schoolId), {
      q: q as string, cls: cls as string, section: section as string,
      page: page ? parseInt(page as string) : 1,
      pendingReissue: pendingReissue === "true",
    });
    res.json(result);
  });

  app.get("/api/schools/:schoolId/students/export", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
      const schoolId = parseInt(req.params.schoolId);
      if (req.session.schoolId !== schoolId) return res.status(403).json({ message: "Not authorized" });

      const { q, cls, section } = req.query;
      const rows = await storage.getStudentsForExport(schoolId, {
        q: q as string | undefined,
        cls: cls as string | undefined,
        section: section as string | undefined,
      });

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "BENIUS";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet("Student Registry", {
        views: [{ state: "frozen", ySplit: 1 }],
      });

      sheet.columns = [
        { header: "Student ID",    key: "digitalStudentId", width: 20 },
        { header: "Full Name",     key: "name",             width: 28 },
        { header: "Class",         key: "class",            width: 10 },
        { header: "Section",       key: "section",          width: 10 },
        { header: "Roll Number",   key: "rollNumber",       width: 14 },
        { header: "Gender",        key: "gender",           width: 12 },
        { header: "Guardian Name", key: "guardianName",     width: 26 },
        { header: "Phone",         key: "phone",            width: 18 },
        { header: "Status",        key: "status",           width: 14 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FF1A1A1A" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4AF37" } };
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FFB8962E" } },
        };
      });
      headerRow.height = 20;

      for (const r of rows) {
        sheet.addRow({
          digitalStudentId: r.digitalStudentId,
          name:             r.name,
          class:            r.class,
          section:          r.section,
          rollNumber:       r.rollNumber ?? r.rollNo ?? "",
          gender:           r.gender ?? "",
          guardianName:     r.guardianName ?? "",
          phone:            r.phone,
          status:           r.isActivated ? "Active" : "Pending",
        });
      }

      const filterParts: string[] = [];
      if (cls)     filterParts.push(`Class ${cls}`);
      if (section) filterParts.push(`Section ${section}`);
      if (q)       filterParts.push(`Search "${q}"`);
      const filterLabel = filterParts.length ? ` (${filterParts.join(", ")})` : "";
      const filename = `students${filterLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`
        .replace(/[^\w\s()._-]/g, "_");

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("Export error:", err);
      res.status(500).json({ message: "Export failed" });
    }
  });

  // ===== STUDENT EDIT (Admin only) =====
  const updateStudentSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    class: z.string().min(1, "Class is required"),
    section: z.string().min(1, "Section is required"),
    phone: z.string().regex(/^[0-9+\-\s()]{7,15}$/, "Invalid phone number"),
  });

  app.patch("/api/admin/students/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid student ID" });

    const parsed = updateStudentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const student = await storage.getStudentById(id);
    if (!student || student.schoolId !== req.session.schoolId)
      return res.status(404).json({ message: "Student not found" });

    const updated = await storage.updateStudent(id, req.session.schoolId!, parsed.data);
    if (!updated) return res.status(404).json({ message: "Update failed" });

    res.json(updated);
  });

  // ===== GRADING TIERS & RULES =====

  app.get("/api/admin/grading-tiers", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;
    const [tiers, rules] = await Promise.all([
      storage.getGradingTiers(schoolId),
      storage.getGradingRules(schoolId),
    ]);
    res.json({ tiers, rules });
  });

  app.post("/api/admin/grading-tiers", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schema = z.object({
      id: z.number().int().positive().optional(),
      name: z.string().min(1),
      classes: z.array(z.string()).min(1, "At least one class must be selected"),
      passPercentage: z.number().int().min(0).max(100).default(35),
      gradingSystem: z.enum(["percentage", "grade", "both"]).default("percentage"),
      passingGrades: z.array(z.string()).default([]),
      sortOrder: z.number().int().default(0),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const tier = await storage.upsertGradingTier({ ...parsed.data, schoolId: req.session.schoolId! });
    res.json(tier);
  });

  app.delete("/api/admin/grading-tiers/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    await storage.deleteGradingTier(id, req.session.schoolId!);
    res.json({ message: "Deleted" });
  });

  app.get("/api/admin/grading-rules/:tierId", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const tierId = parseInt(req.params.tierId as string);
    if (isNaN(tierId)) return res.status(400).json({ message: "Invalid tierId" });
    const rules = await storage.getGradingRules(req.session.schoolId!, tierId);
    res.json(rules);
  });

  app.post("/api/admin/grading-rules/:tierId", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const tierId = parseInt(req.params.tierId as string);
    if (isNaN(tierId)) return res.status(400).json({ message: "Invalid tierId" });
    const ruleSchema = z.array(z.object({
      gradeLabel: z.string().min(1),
      minPercent: z.number().int().min(0).max(100),
      maxPercent: z.number().int().min(0).max(100),
      gradePoint: z.string().default(""),
      remarks: z.string().default(""),
      sortOrder: z.number().int().default(0),
    }));
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const tierCheck = await storage.getGradingTiers(schoolId);
    const validTier = tierCheck.find(t => t.id === tierId);
    if (!validTier) return res.status(403).json({ message: "Tier not found for this school" });
    const rules = await storage.replaceGradingRules(tierId, schoolId, parsed.data);
    res.json(rules);
  });

  // ===== EXAM POLICY TIERS =====

  app.get("/api/admin/exam-policy-tiers", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    try {
      const tiers = await storage.getExamPolicyTiers(req.session.schoolId!);
      res.json(tiers);
    } catch { res.status(500).json({ message: "Failed to fetch exam policy tiers" }); }
  });

  app.post("/api/admin/exam-policy-tiers", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schema = z.object({
      tierName: z.string().min(1, "Tier name is required"),
      applicableClasses: z.array(z.string()).min(1, "At least one class must be selected"),
      examWeights: z.string().default("{}"),
      promotionFailRules: z.string().default("{}"),
      resultsConfig: z.string().default("{}"),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    try {
      const tier = await storage.createExamPolicyTier({ ...parsed.data, schoolId: req.session.schoolId! });
      res.status(201).json(tier);
    } catch { res.status(500).json({ message: "Failed to create exam policy tier" }); }
  });

  app.patch("/api/admin/exam-policy-tiers/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const schema = z.object({
      tierName: z.string().min(1).optional(),
      applicableClasses: z.array(z.string()).optional(),
      examWeights: z.string().optional(),
      promotionFailRules: z.string().optional(),
      resultsConfig: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    try {
      const updated = await storage.updateExamPolicyTier(id, req.session.schoolId!, parsed.data);
      if (!updated) return res.status(404).json({ message: "Tier not found" });
      res.json(updated);
    } catch { res.status(500).json({ message: "Failed to update exam policy tier" }); }
  });

  app.delete("/api/admin/exam-policy-tiers/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      await storage.deleteExamPolicyTier(id, req.session.schoolId!);
      res.json({ message: "Deleted" });
    } catch { res.status(500).json({ message: "Failed to delete exam policy tier" }); }
  });

  app.post("/api/admin/exam-policy-tiers/evaluate", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schema = z.object({
      studentClass: z.string().min(1),
      scores: z.array(z.object({
        subject: z.string(),
        examType: z.string(),
        marks: z.number(),
        totalMarks: z.number(),
        isAbsent: z.boolean().default(false),
      })),
      passPercentage: z.number().min(0).max(100).optional(),
      termAttendance: z.record(z.string(), z.number()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const tiers = await storage.getExamPolicyTiers(schoolId);
    const matchingTier = tiers.find(t => (t.applicableClasses || []).includes(parsed.data.studentClass));
    if (!matchingTier) return res.status(404).json({ message: `No exam policy tier found for class "${parsed.data.studentClass}"` });
    const gradingTiers = await storage.getGradingTiers(schoolId);
    const matchingGradingTier = gradingTiers.find(t => (t.classes || []).includes(parsed.data.studentClass));
    const passPercentage = parsed.data.passPercentage ?? matchingGradingTier?.passPercentage ?? 35;
    const result = evaluatePromotion(parsed.data.scores, matchingTier, passPercentage, parsed.data.termAttendance);
    res.json({ tier: matchingTier.tierName, passPercentage, ...result });
  });

  // ===== ACADEMIC ADVANCEMENT WIZARD =====

  // ── Ledger Status Overview (admin) ──────────────────────────────────────────
  app.get("/api/admin/ledger-status", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const { term } = req.query as Record<string, string>;
    if (!term) return res.status(400).json({ message: "term is required" });
    try {
      // Forward the view session so getLedgerStatus scopes promotion decisions
      // to the correct academic year when the admin is browsing an archived session.
      const data = await storage.getLedgerStatus(req.session.schoolId!, term, (req as any).viewSessionId ?? undefined);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to fetch ledger status" });
    }
  });

  // ── Available terms — all exam types configured in school setup ─────────────
  app.get("/api/admin/ledger-terms", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    try {
      const terms = await storage.getSchoolMetadata(req.session.schoolId!, "exam_types");
      res.json(terms);
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to fetch terms" });
    }
  });

  // ── Delete all promotion decisions for a term (purge old/stale ledger) ────────
  app.delete("/api/admin/ledger-term/:term", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const term = decodeURIComponent(req.params.term);
    if (!term) return res.status(400).json({ message: "term is required" });
    try {
      const deleted = await storage.deletePromotionDecisionsByTerm(req.session.schoolId!, term);
      res.json({ deleted, message: `Removed ${deleted} promotion record(s) for "${term}"` });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to delete term ledger" });
    }
  });

  // ── Professional reminder notice copy ─────────────────────────────────────
  function buildReminderNotice(className: string, section: string, term: string): string {
    return `⚠️ URGENT: Marks Ledger Submission Pending — ${term}

Dear Faculty Member,

This is an official administrative reminder that the academic marks ledger for Class ${className} — Section ${section} for ${term} is currently incomplete or awaiting your final lock.

Please review your grading data, complete any missing entries, and lock the ledger inside your workspace as soon as possible to prevent delays in final academic advancement processing.

Thank you for your prompt attention to this matter.
— School Administration`;
  }

  // ── Send ledger reminder to a specific teacher's noticeboard ──────────────
  // Looks up the teacher assigned to className/section via faculty_mappings or
  // teacher.assignedClass/Section, then pins the notice to that teacher's ID.
  // targetType:"teacher" + targetTeacherId guarantee ZERO student leakage.
  app.post("/api/admin/send-ledger-reminder", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const { className, section, term } = req.body as Record<string, string>;
    if (!className || !section || !term)
      return res.status(400).json({ message: "className, section, and term are required" });
    const schoolId = req.session.schoolId!;
    try {
      // Look up the specific teacher assigned to this class-section
      const assignedTeacher = await storage.getTeacherByClassSection(schoolId, className, section);

      await storage.createNotice({
        schoolId,
        createdById: req.session.userId!,
        creatorRole: "admin",
        targetType: "teacher",            // hard-blocks student notice feeds
        targetClass: className,           // retained for display / fallback context
        targetSection: section,
        targetTeacherId: assignedTeacher?.id ?? null,  // strict pin — only this teacher sees it
        noticeType: "Urgent",
        content: buildReminderNotice(className, section, term),
      });

      const recipient = assignedTeacher
        ? `${assignedTeacher.fullName} (Class ${className}-${section})`
        : `Class ${className}-${section} teacher (unassigned — notice stored for when teacher is mapped)`;

      res.json({ message: `Reminder dispatched to ${recipient}` });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to send reminder" });
    }
  });

  // ── Bulk: send tailored notices to every pending teacher's noticeboard ────
  // For each pending class-section, resolves the assigned teacher and pins the
  // notice directly to their ID.  Teachers with multiple pending ledgers each
  // receive a separate notice per class-section they manage.
  app.post("/api/admin/send-ledger-reminder-all", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const { term } = req.body as Record<string, string>;
    if (!term) return res.status(400).json({ message: "term is required" });
    const schoolId = req.session.schoolId!;
    try {
      const statuses = await storage.getLedgerStatus(schoolId, term);
      const pending = statuses.filter(s => s.status !== "locked" && !s.adminExecuted);

      // Resolve teachers in parallel, then create one notice per pending ledger
      const teacherLookups = await Promise.all(
        pending.map(row => storage.getTeacherByClassSection(schoolId, row.class, row.section))
      );

      await Promise.all(pending.map((row, i) =>
        storage.createNotice({
          schoolId,
          createdById: req.session.userId!,
          creatorRole: "admin",
          targetType: "teacher",              // hard-blocks student notice feeds
          targetClass: row.class,
          targetSection: row.section,
          targetTeacherId: teacherLookups[i]?.id ?? null,  // strict per-teacher pin
          noticeType: "Urgent",
          content: buildReminderNotice(row.class, row.section, term),
        })
      ));

      const assignedCount = teacherLookups.filter(Boolean).length;
      const unassignedCount = pending.length - assignedCount;

      res.json({
        count: pending.length,
        message: pending.length > 0
          ? `Reminders dispatched to ${assignedCount} assigned teacher(s)${unassignedCount > 0 ? `; ${unassignedCount} section(s) have no teacher mapped yet` : ""}`
          : "All ledgers are already locked — no reminders needed",
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to send reminders" });
    }
  });

  app.get("/api/admin/exam/aggregated", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const { class: cls, section, examType, term } = req.query as Record<string, string>;
    if (!cls || !section || !examType)
      return res.status(400).json({ message: "class, section, and examType are required" });
    const schoolId = req.session.schoolId!;
    // Extract the view session so both score aggregation and ledger decisions
    // are scoped to the same academic year when the admin is in archive mode.
    const viewSessionId: number | undefined = (req as any).viewSessionId ?? undefined;
    const [studentsData, overrides, meta, classSubjectsMap] = await Promise.all([
      storage.getExamAggregated(schoolId, cls, section, examType, viewSessionId),
      storage.getPromotionOverrides(schoolId, cls, section, examType),
      storage.getAllSchoolMetadata(schoolId),
      storage.getClassSubjectsMap(schoolId),
    ]);

    // Resolve the subjects that are actually mapped to this class.
    // Keys in classSubjectsMap may be "Class 6" or "6" — normalise before comparing.
    const clsNoPrefix = cls.trim().toLowerCase().replace(/^class\s+/, "");
    let mappedSubjectsForClass: string[] | null = null;
    for (const [key, subjects] of Object.entries(classSubjectsMap)) {
      if (key.trim().toLowerCase().replace(/^class\s+/, "") === clsNoPrefix) {
        mappedSubjectsForClass = subjects;
        break;
      }
    }
    // Audit only the subjects that are mapped to this class.
    // Fall back to the school-wide list if no per-class mapping has been configured.
    const configuredSubjects: string[] =
      mappedSubjectsForClass !== null && mappedSubjectsForClass.length > 0
        ? mappedSubjectsForClass
        : (meta.subjects || []);

    const presentSubjects = Array.from(new Set(studentsData.flatMap(s => s.subjects)));
    const missingSubjects = configuredSubjects.filter(s => !presentSubjects.includes(s));
    const rawThreshold = meta.pass_threshold;
    const legacyThreshold = (Array.isArray(rawThreshold) && rawThreshold.length > 0)
      ? (parseInt(rawThreshold[0]) || 35)
      : 35;
    const studentsWithGrades = await Promise.all(studentsData.map(async (s) => {
      const grade = await storage.resolveGrade(schoolId, cls, s.percentage);
      return { ...s, gradeLabel: grade.gradeLabel, gradePoint: grade.gradePoint, gradeRemarks: grade.remarks, tierPassThreshold: grade.passPercentage };
    }));
    const passThreshold = studentsWithGrades.length > 0 ? studentsWithGrades[0].tierPassThreshold : legacyThreshold;

    // If a term is provided, enrich each student with their ledger row
    let ledgerDecisions: import("../shared/schema").PromotionDecision[] = [];
    if (term) {
      ledgerDecisions = await storage.getPromotionDecisions(schoolId, cls, section, term, viewSessionId);
    }
    const ledgerMap = new Map(ledgerDecisions.map(d => [d.studentId, d]));
    const studentsEnriched = studentsWithGrades.map(s => ({
      ...s,
      ledger: ledgerMap.get(s.studentId) ?? null,
    }));

    res.json({ students: studentsEnriched, overrides, missingSubjects, passThreshold });
  });

  app.post("/api/admin/exam/override", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const overrideSchema = z.object({
      studentId: z.number().int().positive(),
      examType: z.string().min(1),
      class: z.string().min(1),
      section: z.string().min(1),
      overrideStatus: z.enum(["PASS", "FAIL", "GRACE_PASS", "REPEAT"]),
      nextClass: z.string().min(1),
      nextSection: z.string().min(1),
    });
    const parsed = overrideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    await storage.upsertPromotionOverride({ ...parsed.data, schoolId: req.session.schoolId! });
    res.json({ message: "Override saved" });
  });

  app.post("/api/admin/exam/override/bulk", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const itemSchema = z.object({
      studentId: z.number().int().positive(),
      examType: z.string().min(1),
      class: z.string().min(1),
      section: z.string().min(1),
      overrideStatus: z.string().min(1),
      nextClass: z.string().min(1),
      nextSection: z.string().min(1),
    });
    const parsed = z.object({ items: z.array(itemSchema).min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    await storage.bulkUpsertPromotionOverrides(parsed.data.items.map(i => ({ ...i, schoolId })));
    res.json({ message: "Bulk overrides saved", count: parsed.data.items.length });
  });

  app.delete("/api/admin/exam/override/cohort", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schema = z.object({
      class: z.string().min(1),
      section: z.string().min(1),
      examType: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    await storage.deleteAllPromotionOverrides({ ...parsed.data, schoolId: req.session.schoolId! });
    res.json({ message: "All overrides cleared" });
  });

  app.delete("/api/admin/exam/override", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const clearSchema = z.object({
      studentId: z.number().int().positive(),
      examType: z.string().min(1),
      class: z.string().min(1),
      section: z.string().min(1),
    });
    const parsed = clearSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    await storage.deletePromotionOverride({ ...parsed.data, schoolId: req.session.schoolId! });
    res.json({ message: "Override cleared" });
  });

  app.post("/api/admin/promote", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const promoteSchema = z.object({
      term: z.string().optional(),
      items: z.array(z.object({
        studentId: z.number().int().positive(),
        nextClass: z.string().min(1),
        nextSection: z.string().min(1),
        fromClass: z.string().min(1),
        fromSection: z.string().min(1),
        examType: z.string().min(1),
        totalObtained: z.number().int().min(0),
        totalMax: z.number().int().min(0),
        percentage: z.number().int().min(0),
        gradeLabel: z.string().nullable().optional(),
        gradePoint: z.string().nullable().optional(),
        gradeRemarks: z.string().nullable().optional(),
      })).min(1),
    });
    const parsed = promoteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const schoolId  = req.session.schoolId!;
    const adminId   = req.session.userId!;
    const items     = parsed.data.items;
    const studentIds = items.map(i => i.studentId);
    const term      = parsed.data.term;

    // ── 1. Pre-fetch student DSID/name map AND exam scores BEFORE the transaction
    //       (needed for accurate audit log + cold-storage snapshot JSON).         ─
    const [dsidMap, rawScores] = await Promise.all([
      storage.getStudentDsidMap(schoolId, studentIds),
      storage.getExamScoresForStudents(schoolId, studentIds),
    ]);

    // ── 2. Build enriched academic history records with cold-storage snapshot ──
    //       snapshotJson packs student metadata + per-subject score breakdown    ─
    const historyRecords = items.map(item => {
      const info = dsidMap[item.studentId];
      const scoreBreakdown = rawScores
        .filter(s => s.studentId === item.studentId)
        .map(s => ({
          subject: s.subject, examType: s.examType,
          marks: s.marks, totalMarks: s.totalMarks, isAbsent: s.isAbsent,
        }));
      return {
        schoolId,
        studentId:     item.studentId,
        fromClass:     item.fromClass,
        fromSection:   item.fromSection,
        toClass:       item.nextClass,
        toSection:     item.nextSection,
        examType:      item.examType,
        totalObtained: item.totalObtained,
        totalMax:      item.totalMax,
        percentage:    item.percentage,
        gradeLabel:    item.gradeLabel ?? null,
        gradePoint:    item.gradePoint ?? null,
        remarks:       item.gradeRemarks ?? null,
        snapshotJson: {
          archivedAt:    new Date().toISOString(),
          adminId,
          schoolId,
          studentDsid:   info?.dsid ?? `ID:${item.studentId}`,
          studentName:   info?.name ?? "Unknown",
          fromClass:     item.fromClass,
          fromSection:   item.fromSection,
          toClass:       item.nextClass,
          toSection:     item.nextSection,
          examType:      item.examType,
          term:          term ?? null,
          totalObtained: item.totalObtained,
          totalMax:      item.totalMax,
          percentage:    item.percentage,
          gradeLabel:    item.gradeLabel ?? null,
          gradePoint:    item.gradePoint ?? null,
          gradeRemarks:  item.gradeRemarks ?? null,
          examBreakdown: scoreBreakdown,
        },
      };
    });

    // ── 3. Execute atomic transaction: history + student update + ledger mark ──
    //       Full automatic rollback on any failure — student records revert.     ─
    const promoted = await storage.executePromotionTransaction(
      schoolId, items, historyRecords, term,
    );

    // ── 4. Respond immediately — post-pipeline runs without blocking client ───
    res.json({ promoted, pipelineQueued: true });

    // ── 6. Async post-promotion pipeline (fire-and-forget after response) ─────
    // All mutations below are tenant-isolated via schoolId guard.
    (async () => {
      try {
        const now = new Date();
        const ts  = now.toISOString().replace("T", " ").slice(0, 19);
        const examType = items[0]?.examType ?? parsed.data.term ?? "—";

        // 6a. Structured audit log per student
        // Format: [Timestamp] - Admin [ID] successfully updated Student DSID from Class X-A to Class Y-A via Manual Wizard Execution.
        for (const item of items) {
          const info = dsidMap[item.studentId];
          const dsid = info?.dsid ?? `ID:${item.studentId}`;
          const name = info?.name ?? "Unknown";
          await storage.createAuditLog({
            schoolId,
            actionType:    "PROMOTION_EXECUTED",
            entityType:    "student",
            entityId:      item.studentId,
            actionBy:      adminId,
            actionByRole:  "admin",
            details: `[${ts}] - Admin ${adminId} successfully updated Student ${dsid} (${name}) from Class ${item.fromClass}-${item.fromSection} to Class ${item.nextClass}-${item.nextSection} via Manual Wizard Execution. Exam: ${examType}. Marks: ${item.totalObtained}/${item.totalMax} (${item.percentage}%).`,
          });
        }

        // 6b. Clean up executed promotion override records (stale data prevention)
        await storage.deletePromotionOverridesByStudentIds(schoolId, studentIds, examType);

      } catch (pipelineErr) {
        // Pipeline errors are non-fatal — core promotion already succeeded
        console.error("[promote pipeline]", pipelineErr);
      }
    })();
  });

  // ===== CLEAR ID CARD REISSUE FLAG =====
  app.post("/api/admin/students/clear-reissue-flag", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const { studentIds } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0)
      return res.status(400).json({ message: "studentIds array required" });
    await storage.clearIdCardReissueFlag(req.session.schoolId!, studentIds);
    res.json({ cleared: studentIds.length });
  });

  // ===== PAGINATED TEACHERS (Big Data) =====
  app.get("/api/schools/:schoolId/teachers/paginated", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
    if (req.session.schoolId !== parseInt(req.params.schoolId)) return res.status(403).json({ message: "Not authorized" });
    const { q, page } = req.query;
    const result = await storage.getTeachersPaginated(parseInt(req.params.schoolId), {
      q: q as string, page: page ? parseInt(page as string) : 1,
    });
    res.json(result);
  });

  // ===== DAILY ATTENDANCE SUMMARY =====
  app.get("/api/attendance/daily-summary/:schoolId/:date", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
    if (req.session.schoolId !== parseInt(req.params.schoolId)) return res.status(403).json({ message: "Not authorized" });
    const summary = await storage.getDailyAttendanceSummary(parseInt(req.params.schoolId), req.params.date);
    res.json(summary);
  });

  // ===== COMPLAINTS BY SCHOOL (Admin only — teachers excluded) =====
  app.get("/api/complaints/school/:schoolId", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    if (req.session.schoolId !== parseInt(req.params.schoolId)) return res.status(403).json({ message: "Not authorized" });
    const list = await storage.getComplaintsBySchool(parseInt(req.params.schoolId));
    res.json(list);
  });

  // ===== AUDIT LOGS (Admin) =====
  app.get("/api/audit-logs/:schoolId", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
    if (req.session.schoolId !== parseInt(req.params.schoolId)) return res.status(403).json({ message: "Not authorized" });
    const list = await storage.getAuditLogsBySchool(parseInt(req.params.schoolId));
    res.json(list);
  });

  // ===== STUDENT LEAVES FOR ADMIN =====
  app.get("/api/student-leaves/school/:schoolId", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
    if (req.session.schoolId !== parseInt(req.params.schoolId)) return res.status(403).json({ message: "Not authorized" });
    const list = await storage.getStudentLeavesForAdmin(parseInt(req.params.schoolId));
    res.json(list);
  });

  app.patch("/api/student-leaves/:id/admin-approve", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
    const leave = await storage.getStudentLeaveById(parseInt(req.params.id));
    if (!leave || leave.schoolId !== req.session.schoolId) return res.status(403).json({ message: "Not authorized" });
    const updated = await storage.updateStudentLeaveStatus(leave.id, "approved", req.session.userId!, "admin");
    // Look up student's class teacher to use as the FK-valid teacherId for attendance records.
    // If no teacher found for that class/section, pass null — existing records are updated, new ones skipped.
    const student = await storage.getStudentById(leave.studentId);
    const classTeacher = student
      ? await storage.getTeacherByClassSection(leave.schoolId, student.class, student.section)
      : null;
    await storage.markAttendanceAsLeave(leave.studentId, classTeacher?.id ?? null, leave.schoolId, leave.startDate, leave.endDate);
    await storage.createAuditLog({
      schoolId: leave.schoolId, actionType: "approve", entityType: "student_leave", entityId: leave.id,
      actionBy: req.session.userId!, actionByRole: "admin",
      details: `Admin approved student leave for dates ${leave.startDate} to ${leave.endDate}`,
    });
    res.json(updated);
  });

  app.patch("/api/student-leaves/:id/reject", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const leave = await storage.getStudentLeaveById(parseInt(req.params.id));
    if (!leave) return res.status(404).json({ message: "Leave request not found" });
    const { rejectionReason } = req.body;

    // Teacher path: class/section scoped rejection
    if (req.session.teacherId) {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });
      if (leave.schoolId !== teacher.schoolId) return res.status(403).json({ message: "Not authorized" });
      const student = await storage.getStudentById(leave.studentId);
      if (!student || student.class !== teacher.assignedClass || student.section !== teacher.assignedSection) {
        return res.status(403).json({ message: "Not authorized for this student's class/section" });
      }
      const updated = await storage.updateStudentLeaveStatus(leave.id, "rejected", teacher.id, "teacher", rejectionReason || undefined);
      await storage.createAuditLog({
        schoolId: teacher.schoolId, actionType: "reject", entityType: "student_leave", entityId: leave.id,
        actionBy: teacher.id, actionByRole: "teacher",
        details: `Teacher rejected student leave${rejectionReason ? `: ${rejectionReason}` : ""}`,
      });
      return res.json(updated);
    }

    // Admin path: school-scoped rejection
    if (req.session.userId) {
      if (leave.schoolId !== req.session.schoolId) return res.status(403).json({ message: "Not authorized" });
      const updated = await storage.updateStudentLeaveStatus(leave.id, "rejected", req.session.userId!, "admin", rejectionReason || undefined);
      await storage.createAuditLog({
        schoolId: req.session.schoolId!, actionType: "reject", entityType: "student_leave", entityId: leave.id,
        actionBy: req.session.userId!, actionByRole: "admin",
        details: `Admin rejected student leave${rejectionReason ? `: ${rejectionReason}` : ""}`,
      });
      return res.json(updated);
    }

    return res.status(401).json({ message: "Not authenticated" });
  });

  // ===== PENDING EBOOKS (Admin) =====
  app.get("/api/library/books/:schoolId/pending", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
    if (req.session.schoolId !== parseInt(req.params.schoolId)) return res.status(403).json({ message: "Not authorized" });
    const list = await storage.getPendingEbooks(parseInt(req.params.schoolId));
    res.json(list);
  });

  // ===== VISITOR LOGS =====
  app.post("/api/visitor-logs", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
    const { visitorName, purpose, hostName, phone, badge } = req.body;
    if (!visitorName || !purpose || !hostName) return res.status(400).json({ message: "Name, purpose, and host are required" });
    const v = await storage.createVisitorLog({ schoolId: req.session.schoolId!, visitorName, purpose, hostName, phone: phone || null, badge: badge || null });
    await storage.createAuditLog({
      schoolId: req.session.schoolId!, actionType: "checkin", entityType: "visitor", entityId: v.id,
      actionBy: req.session.userId!, actionByRole: "admin",
      details: `Visitor checked in: ${visitorName}`,
    });
    res.status(201).json(v);
  });

  app.get("/api/visitor-logs/:schoolId", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
    if (req.session.schoolId !== parseInt(req.params.schoolId)) return res.status(403).json({ message: "Not authorized" });
    const list = await storage.getVisitorLogsBySchool(parseInt(req.params.schoolId));
    res.json(list);
  });

  app.patch("/api/visitor-logs/:id/checkout", async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ message: "Admin access required" });
    const v = await storage.checkoutVisitor(parseInt(req.params.id));
    res.json(v);
  });

  // ===== STUDENT PROFILE VERIFICATION (Teacher) =====
  app.post("/api/teacher/profiles/bulk-approve", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const parsed = z.object({ studentIds: z.array(z.number()).min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid student IDs" });

    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const uniqueIds = Array.from(new Set(parsed.data.studentIds));
    const validIds: number[] = [];
    for (const sid of uniqueIds) {
      const student = await storage.getStudentById(sid);
      if (!student || student.schoolId !== teacher.schoolId) continue;
      if (student.class !== teacher.assignedClass || student.section !== teacher.assignedSection) continue;
      validIds.push(sid);
    }

    const result = await storage.bulkApproveStudentProfiles(validIds, req.session.teacherId);
    res.json(result);
  });

  app.get("/api/teacher/pending-profiles", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const profiles = await storage.getPendingProfilesForTeacher(teacher.schoolId, teacher.assignedClass, teacher.assignedSection);
    res.json(profiles);
  });

  app.get("/api/teacher/pending-profiles/count", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const count = await storage.getPendingProfilesCountForTeacher(teacher.schoolId, teacher.assignedClass, teacher.assignedSection);
    res.json({ count });
  });

  app.post("/api/teacher/profiles/:studentId/approve", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const studentId = parseInt(req.params.studentId);
    if (isNaN(studentId)) return res.status(400).json({ message: "Invalid student ID" });

    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const student = await storage.getStudentById(studentId);
    if (!student || student.schoolId !== teacher.schoolId) return res.status(403).json({ message: "Access denied" });
    if (student.class !== teacher.assignedClass || student.section !== teacher.assignedSection)
      return res.status(403).json({ message: "Student is not in your assigned class" });

    const existing = await storage.getStudentProfile(studentId);
    if (!existing) return res.status(404).json({ message: "Student profile not found" });
    if (existing.status !== "pending") return res.status(409).json({ message: "Profile is not in pending state" });

    const profile = await storage.approveStudentProfile(studentId, req.session.teacherId);
    if (!profile) return res.status(500).json({ message: "Failed to approve profile" });
    if (profile.photoUrl) {
      await storage.updateStudentLivePhoto(studentId, profile.photoUrl);
    }
    const verifiedProfileJson = JSON.stringify({
      fullName: profile.fullName,
      class: profile.class,
      section: profile.section,
      rollNo: profile.rollNo,
      fatherName: profile.fatherName,
      motherName: profile.motherName,
      presentAddress: profile.presentAddress,
      photoUrl: profile.photoUrl,
      verifiedAt: profile.verifiedAt,
    });
    await storage.updateStudentVerifiedProfile(studentId, verifiedProfileJson);
    res.json(profile);
  });

  const rejectProfileSchema = z.object({
    note: z.string().optional().default(""),
  });

  app.post("/api/teacher/profiles/:studentId/reject", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const studentId = parseInt(req.params.studentId);
    if (isNaN(studentId)) return res.status(400).json({ message: "Invalid student ID" });

    const parsed = rejectProfileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const student = await storage.getStudentById(studentId);
    if (!student || student.schoolId !== teacher.schoolId) return res.status(403).json({ message: "Access denied" });
    if (student.class !== teacher.assignedClass || student.section !== teacher.assignedSection)
      return res.status(403).json({ message: "Student is not in your assigned class" });

    const existing = await storage.getStudentProfile(studentId);
    if (!existing) return res.status(404).json({ message: "Student profile not found" });
    if (existing.status !== "pending") return res.status(409).json({ message: "Profile is not in pending state" });

    const profile = await storage.rejectStudentProfile(studentId, req.session.teacherId, parsed.data.note ?? "");
    if (!profile) return res.status(500).json({ message: "Failed to reject profile" });
    res.json(profile);
  });

  // ===== ASSET LIFECYCLE MANAGER =====

  const createAssetSchema = z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    quantity: z.number().int().min(0),
    condition: z.enum(["New", "Good", "Fair", "Poor", "Broken"]),
    location: z.string().min(1),
  });

  const updateAssetSchema = z.object({
    quantity: z.number().int().min(0).optional(),
    condition: z.enum(["New", "Good", "Fair", "Poor", "Broken"]).optional(),
    location: z.string().min(1).optional(),
  });

  app.get("/api/admin/assets", async (req, res) => {
    try {
      if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      const schoolId = req.session.schoolId!;
      const assets = await storage.getAssets(schoolId);
      res.json(assets);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch assets" });
    }
  });

  app.post("/api/admin/assets", async (req, res) => {
    try {
      if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      const schoolId = req.session.schoolId!;
      const parsed = createAssetSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
      const asset = await storage.createAsset({ ...parsed.data, schoolId });
      res.status(201).json(asset);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create asset" });
    }
  });

  app.patch("/api/admin/assets/:id", async (req, res) => {
    try {
      if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      const schoolId = req.session.schoolId!;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid asset ID" });

      const parsed = updateAssetSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

      const before = await storage.getAssetById(id, schoolId);
      if (!before) return res.status(404).json({ message: "Asset not found" });

      const updated = await storage.updateAsset(id, schoolId, parsed.data);
      if (!updated) return res.status(404).json({ message: "Asset not found" });

      await storage.logAssetActivity({
        schoolId,
        assetId: id,
        userId: req.session.userId!,
        action: "edit",
        snapshot: JSON.stringify({ before, after: updated }),
      }).catch((logErr: Error) => console.warn(`[asset-log] Failed to log edit for asset ${id}:`, logErr.message));

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update asset" });
    }
  });

  app.delete("/api/admin/assets/:id", async (req, res) => {
    try {
      if (!req.session.userId || req.session.userRole !== "admin") return res.status(403).json({ message: "Admin access required" });
      const schoolId = req.session.schoolId!;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid asset ID" });

      const before = await storage.getAssetById(id, schoolId);
      if (!before) return res.status(404).json({ message: "Asset not found" });

      const deleted = await storage.deleteAsset(id, schoolId);
      if (!deleted) return res.status(404).json({ message: "Asset not found" });

      await storage.logAssetActivity({
        schoolId,
        assetId: id,
        userId: req.session.userId!,
        action: "delete",
        snapshot: JSON.stringify({ before }),
      }).catch((logErr: Error) => console.warn(`[asset-log] Failed to log delete for asset ${id}:`, logErr.message));

      res.json({ message: "Asset deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete asset" });
    }
  });

  // ===== ACADEMIC INTELLIGENCE ANALYTICS =====

  app.get("/api/admin/analytics/sections", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const { class: cls } = req.query as Record<string, string>;
    if (!cls) return res.status(400).json({ message: "class is required" });
    const schoolId = req.session.schoolId!;
    try {
      const sections = await storage.getDistinctSectionsByClass(schoolId, cls);
      res.json(sections);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch sections" });
    }
  });

  app.get("/api/admin/analytics/performance", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const { class: cls, section, examType, subject, search } = req.query as Record<string, string>;
    if (!cls) return res.status(400).json({ message: "class is required" });
    const schoolId = req.session.schoolId!;
    try {
      const data = await storage.getAnalyticsData(schoolId, cls, {
        section: section || undefined,
        examType: examType || undefined,
        subject: subject || undefined,
        search: search || undefined,
      });
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch analytics data" });
    }
  });

  app.get("/api/admin/analytics/student-journey/:studentId", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const studentId = parseInt(req.params.studentId);
    if (isNaN(studentId)) return res.status(400).json({ message: "Invalid student ID" });
    const schoolId = req.session.schoolId!;
    try {
      const data = await storage.getStudentJourneyData(studentId, schoolId);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch student journey" });
    }
  });

  // ===== TEACHER REGISTRY — /api/admin/teachers CRUD (session-scoped) =====
  app.get("/api/admin/teachers", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;
    const q = (req.query.q as string) || "";
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = 20;
    const filterClass = (req.query.filterClass as string) || undefined;
    const filterSection = (req.query.filterSection as string) || undefined;
    try {
      const result = await storage.getTeachersBySchoolPaginated(schoolId, q, page, pageSize, filterClass, filterSection);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch teachers" });
    }
  });

  app.post("/api/admin/teachers", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;
    const parsed = createTeacherSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    try {
      const existing = await storage.getUserByEmail(parsed.data.email);
      if (existing) return res.status(409).json({ message: "A user with this email already exists" });
      const passwordHash = await bcrypt.hash(parsed.data.password, 10);
      const teacher = await storage.createTeacher({
        schoolId,
        fullName: parsed.data.fullName,
        phone: parsed.data.phone,
        subject: parsed.data.subject,
        assignedClass: parsed.data.assignedClass,
        assignedSection: parsed.data.assignedSection,
        designation: parsed.data.designation,
        mustChangePassword: true,
      }, parsed.data.email, passwordHash);
      res.status(201).json(teacher);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to create teacher" });
    }
  });

  app.patch("/api/admin/teachers/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;
    const teacherId = parseInt(req.params.id);
    if (isNaN(teacherId)) return res.status(400).json({ message: "Invalid teacher ID" });
    const editSchema = z.object({
      fullName: z.string().min(2).optional(),
      phone: z.string().min(7).optional(),
      designation: z.string().optional(),
    });
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    try {
      const teacher = await storage.getTeacherById(teacherId);
      if (!teacher || teacher.schoolId !== schoolId)
        return res.status(404).json({ message: "Teacher not found" });
      const updated = await storage.updateTeacherAssignment(teacherId, schoolId, {
        fullName: parsed.data.fullName ?? teacher.fullName,
        subject: teacher.subject,
        assignedClass: teacher.assignedClass,
        assignedSection: teacher.assignedSection,
        phone: parsed.data.phone ?? teacher.phone,
        designation: parsed.data.designation ?? teacher.designation ?? "",
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to update teacher" });
    }
  });

  app.delete("/api/admin/teachers/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const schoolId = req.session.schoolId!;
    const teacherId = parseInt(req.params.id);
    if (isNaN(teacherId)) return res.status(400).json({ message: "Invalid teacher ID" });
    try {
      const teacher = await storage.getTeacherById(teacherId);
      if (!teacher || teacher.schoolId !== schoolId)
        return res.status(404).json({ message: "Teacher not found" });
      await storage.deleteTeacher(teacherId);
      res.json({ message: "Teacher removed from registry" });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to delete teacher" });
    }
  });

  // ===== NON-TEACHING STAFF (admin CRUD) =====
  const ntsCreateSchema = z.object({
    fullName: z.string().min(2),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().optional().or(z.literal("")),
    designation: z.string().min(1),
  });

  app.get("/api/admin/non-teaching-staff", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    try {
      const data = await storage.getNonTeachingStaffBySchool(req.session.schoolId!);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch staff" });
    }
  });

  app.post("/api/admin/non-teaching-staff", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const parsed = ntsCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    try {
      const record = await storage.createNonTeachingStaff({
        schoolId: req.session.schoolId!,
        fullName: parsed.data.fullName,
        email: parsed.data.email || "",
        phone: parsed.data.phone || "",
        designation: parsed.data.designation,
        isActive: true,
      });
      res.status(201).json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to create staff" });
    }
  });

  app.patch("/api/admin/non-teaching-staff/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const parsed = ntsCreateSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    try {
      const updated = await storage.updateNonTeachingStaff(id, req.session.schoolId!, parsed.data);
      if (!updated) return res.status(404).json({ message: "Staff not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to update staff" });
    }
  });

  app.delete("/api/admin/non-teaching-staff/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    try {
      const deleted = await storage.deleteNonTeachingStaff(id, req.session.schoolId!);
      if (!deleted) return res.status(404).json({ message: "Staff not found" });
      res.json({ message: "Staff removed" });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to delete staff" });
    }
  });

  // ===== FACULTY MAPPINGS (admin) =====
  app.get("/api/admin/faculty-mappings", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    try {
      const mappings = await storage.getFacultyMappingsBySchool(req.session.schoolId!);
      res.json(mappings);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch mappings" });
    }
  });

  const facultyMappingSchema = z.object({
    teacherId: z.number().int().positive(),
    mappings: z.array(z.object({ className: z.string().min(1), section: z.string().min(1), subject: z.string().optional().nullable() })),
  });

  app.post("/api/admin/faculty-mappings", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const parsed = facultyMappingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    try {
      const teacher = await storage.getTeacherById(parsed.data.teacherId);
      if (!teacher || teacher.schoolId !== schoolId)
        return res.status(404).json({ message: "Teacher not found" });
      const rows = await storage.replaceFacultyMappings(parsed.data.teacherId, schoolId, parsed.data.mappings);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to save mappings" });
    }
  });

  app.delete("/api/admin/faculty-mappings/:teacherId", async (req, res) => {
    if (!req.session.userId || req.session.userRole !== "admin")
      return res.status(403).json({ message: "Admin access required" });
    const teacherId = parseInt(req.params.teacherId);
    if (isNaN(teacherId)) return res.status(400).json({ message: "Invalid teacher ID" });
    try {
      await storage.deleteFacultyMappingsByTeacher(teacherId, req.session.schoolId!);
      res.json({ message: "Mappings cleared" });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to delete mappings" });
    }
  });

  // ===== TEACHER CALENDAR ROUTE =====
  app.get("/api/teacher/calendar", async (req, res) => {
    const teacherId = req.session.teacherId;
    if (!teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(teacherId);
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });
    const mappings = await storage.getFacultyMappingsByTeacher(teacherId);
    const seen = new Set<string>();
    const assignments: Array<{ cls: string; sec?: string }> = [];
    if (teacher.assignedClass) {
      const key = `${teacher.assignedClass}|${teacher.assignedSection}`;
      seen.add(key);
      assignments.push({ cls: teacher.assignedClass, sec: teacher.assignedSection || undefined });
    }
    for (const m of mappings) {
      const key = `${m.className}|${m.section}`;
      if (!seen.has(key)) {
        seen.add(key);
        assignments.push({ cls: m.className, sec: m.section });
      }
    }
    const teacherFilter = assignments.length > 0 ? assignments : undefined;
    const { month, year } = req.query;
    if (year && !month) {
      const y = parseInt(year as string);
      const events = await storage.getCalendarEventsByRange(teacher.schoolId, `${y}-01-01`, `${y}-12-31`, teacherFilter);
      return res.json(events);
    }
    if (month && year) {
      const m = parseInt(month as string);
      const y = parseInt(year as string);
      const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const endDate = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const events = await storage.getCalendarEventsByRange(teacher.schoolId, startDate, endDate, teacherFilter);
      return res.json(events);
    }
    const events = await storage.getCalendarEvents(teacher.schoolId, teacherFilter);
    res.json(events);
  });

  // ===== RESULTS ENGINE — TEACHER READ-ONLY =====

  app.get("/api/teacher/grading-rules/:class", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const cls = decodeURIComponent(req.params.class);
    try {
      const tiers = await storage.getGradingTiers(teacher.schoolId);
      const tier = tiers.find(t => (t.classes || []).map(String).includes(String(cls).trim()));
      if (!tier) return res.json({ rules: [], passPercentage: 35 });
      const rules = await storage.getGradingRules(teacher.schoolId, tier.id);
      res.json({ rules, passPercentage: tier.passPercentage });
    } catch (err) {
      console.error("[grading-rules] error:", err);
      res.status(500).json({ message: "Failed to fetch grading rules" });
    }
  });

  app.get("/api/teacher/exam-policy/:class", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const cls = decodeURIComponent(req.params.class);
    try {
      const tiers = await storage.getExamPolicyTiers(teacher.schoolId);
      const tier = tiers.find(t =>
        (t.applicableClasses || []).map((c: string) => String(c).trim()).includes(String(cls).trim())
      );
      if (!tier) return res.status(404).json({ message: "No exam policy configured for this class" });
      res.json(tier);
    } catch {
      res.status(500).json({ message: "Failed to fetch exam policy" });
    }
  });

  app.get("/api/teacher/class-scores/:class/:section", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const cls = decodeURIComponent(req.params.class);
    const section = decodeURIComponent(req.params.section);
    const schoolId = teacher.schoolId;
    try {
      const studentList = await storage.getStudentsByClassSection(schoolId, cls, section);
      const results = await Promise.all(studentList.map(async (s) => {
        const scores = await storage.getExamScoresByStudent(s.id, schoolId);
        return {
          studentId: s.id,
          name: s.name,
          digitalStudentId: s.digitalStudentId,
          rollNumber: s.rollNumber,
          scores: scores.map(sc => ({
            subject: sc.subject,
            examType: sc.examType,
            marks: sc.marks ?? 0,
            totalMarks: sc.totalMarks ?? 100,
            isAbsent: sc.isAbsent ?? false,
          })),
        };
      }));
      res.json(results);
    } catch { res.status(500).json({ message: "Failed to fetch class scores" }); }
  });

  app.get("/api/teacher/attendance-summary/:class/:section", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    const cls = decodeURIComponent(req.params.class);
    const section = decodeURIComponent(req.params.section);
    const schoolId = teacher.schoolId;
    try {
      const today = new Date().toISOString().split("T")[0];
      const year = new Date().getFullYear();
      const aprThisYear = `${year}-04-01`;
      const aprLastYear = `${year - 1}-04-01`;
      const yearStart = today >= aprThisYear ? aprThisYear : aprLastYear;
      const records = await storage.getAttendanceHistory(schoolId, cls, section, yearStart, today);
      const byStudent: Record<number, { present: number; total: number }> = {};
      for (const r of records) {
        const sid = (r as any).studentId as number;
        if (!byStudent[sid]) byStudent[sid] = { present: 0, total: 0 };
        byStudent[sid].total++;
        if ((r as any).status === "present") byStudent[sid].present++;
      }
      const summary = Object.entries(byStudent).map(([sid, data]) => ({
        studentId: parseInt(sid),
        attendancePct: data.total > 0 ? Math.round((data.present / data.total) * 100) : null,
        presentDays: data.present,
        totalDays: data.total,
      }));
      res.json(summary);
    } catch { res.status(500).json({ message: "Failed to fetch attendance summary" }); }
  });

  // ── Promotion Ledger ─────────────────────────────────────────────────────

  /** GET /api/teacher/promotion-decisions/:class/:section/:term
   *  Returns all stored promotion decisions for the given class/section/term.
   *  Any authenticated teacher can view (read-only unless they are the assigned teacher). */
  app.get("/api/teacher/promotion-decisions/:class/:section/:term", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    try {
      const cls = decodeURIComponent(req.params.class);
      const section = decodeURIComponent(req.params.section);
      const term = decodeURIComponent(req.params.term);
      const decisions = await storage.getPromotionDecisions(teacher.schoolId, cls, section, term, (req as any).viewSessionId ?? undefined);
      res.json(decisions);
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to fetch promotion decisions" });
    }
  });

  /** POST /api/teacher/promotion-decisions
   *  Bulk upserts promotion decisions for a class/section/term.
   *  Body: { class, section, term, lock: boolean, entries: [...] }
   *  Authorization: caller must have a faculty mapping for the given class-section. */
  app.post("/api/teacher/promotion-decisions", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    try {
      const { class: cls, section, term, lock, entries } = req.body;
      if (!cls || !section || !term || !Array.isArray(entries)) {
        return res.status(400).json({ message: "class, section, term, and entries are required" });
      }
      // Verify teacher is assigned to this class-section
      const allMappings = await storage.getFacultyMappingsByTeacher(teacher.id);
      const isAssigned = allMappings.some(m => m.className === cls && m.section === section)
        || (teacher.assignedClass === cls && teacher.assignedSection === section);
      if (!isAssigned) {
        return res.status(403).json({ message: "Not authorized: you are not assigned to this class-section" });
      }
      // Tag the ledger with the academic session. Prefer the header value
      // (admin previewing a session); otherwise resolve the active session
      // so teacher-submitted decisions are always year-tagged correctly.
      const activeSessForTag = (req as any).viewSessionId
        ? null
        : await storage.getActiveSession(teacher.schoolId);
      const ledgerSessionId: number | null =
        (req as any).viewSessionId ?? activeSessForTag?.id ?? null;

      await storage.savePromotionDecisions(teacher.schoolId, cls, section, term, teacher.id, !!lock, entries, ledgerSessionId ?? undefined);
      res.json({ message: lock ? "Ledger locked and saved" : "Ledger draft saved" });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to save promotion decisions" });
    }
  });

  /** GET /api/teacher/promotion-verdict/:studentId?term=...&class=...&section=...
   *  Backend utility: evaluates whether promotionGateVerdict is active for the term
   *  (checks the policy config) then returns the verdict from the Promotion Ledger.
   *  Returns { omit: true } when the term has promotionGateVerdict disabled. */
  app.get("/api/teacher/promotion-verdict/:studentId", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });
    try {
      const studentId = parseInt(req.params.studentId, 10);
      const term = decodeURIComponent((req.query.term as string) ?? "");
      const cls  = decodeURIComponent((req.query.class as string) ?? "");
      const section = decodeURIComponent((req.query.section as string) ?? "");

      if (!term || !cls || !section) {
        return res.status(400).json({ message: "term, class and section query params are required" });
      }

      // ── Step 1: check policy config to see if promotionGateVerdict is enabled ──
      const tiers = await storage.getExamPolicyTiers(teacher.schoolId);
      const tier = tiers.find(t =>
        (t.applicableClasses || []).map((c: string) => String(c).trim()).includes(String(cls).trim())
      );
      if (!tier) return res.status(404).json({ message: "No exam policy for this class" });

      let resultsConfig: Record<string, any> = {};
      try { resultsConfig = JSON.parse(tier.resultsConfig ?? "{}"); } catch {}
      const termConfig = resultsConfig[term] ?? {};
      const promotionGateVerdict: boolean = !!(termConfig.promotionGate ?? false);

      // If the term has promotionGateVerdict disabled, instruct the client to omit the block
      if (!promotionGateVerdict) {
        return res.json({ omit: true, reason: "Promotion gate is not active for this term." });
      }

      // ── Step 2: fetch the verdict from the Promotion Ledger ──
      const decisions = await storage.getPromotionDecisions(teacher.schoolId, cls, section, term);
      const verdict = decisions.find(d => d.studentId === studentId);

      if (!verdict) {
        return res.json({
          omit: false,
          promotionGateVerdict: true,
          pending: true,
          message: "Ledger entry not yet set for this student.",
        });
      }

      res.json({
        omit: false,
        promotionGateVerdict: true,
        pending: false,
        studentId: verdict.studentId,
        decision: verdict.decision,          // "promoted" | "retained"
        targetClass: verdict.targetClass,
        targetSection: verdict.targetSection,
        destination: `${verdict.targetClass}-${verdict.targetSection}`,
        locked: verdict.locked,
        processedAt: verdict.updatedAt ?? verdict.createdAt,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to fetch promotion verdict" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEACHER SELF ATTENDANCE
  // ═══════════════════════════════════════════════════════════════════════════

  // GET today's self-attendance record
  /** IST-aware "today" date string — adds 5h30m to UTC so midnight in India rolls correctly */
  const istToday = () => new Date(Date.now() + 19800000).toISOString().split("T")[0];

  app.get("/api/teacher/self-attendance/today", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const today = istToday();
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });

      const [[record], policyRows] = await Promise.all([
        db.select().from(teacherSelfAttendance).where(
          and(eq(teacherSelfAttendance.teacherId, req.session.teacherId), eq(teacherSelfAttendance.attendanceDate, today))
        ),
        db.select().from(attendancePolicies).where(
          and(eq(attendancePolicies.schoolId, teacher.schoolId), eq(attendancePolicies.isActive, true))
        ),
      ]);

      if (!record) return res.json(null);

      // Re-evaluate status against current policy and heal stale records
      const policy        = resolvePolicy(policyRows, "TEACHER", teacher.assignedClass ?? "");
      const correctStatus = recomputeStatus(record, policy);
      if (correctStatus !== record.status) {
        const [updated] = await db.update(teacherSelfAttendance)
          .set({ status: correctStatus, updatedAt: new Date() })
          .where(eq(teacherSelfAttendance.id, record.id))
          .returning();
        return res.json(updated);
      }
      res.json(record);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch today's record" });
    }
  });

  // GET resolved attendance policy for the current teacher
  app.get("/api/teacher/attendance-policy", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });
      const policyRows = await db.select().from(attendancePolicies).where(
        and(eq(attendancePolicies.schoolId, teacher.schoolId), eq(attendancePolicies.isActive, true))
      );
      const resolved = resolvePolicy(policyRows, "TEACHER", teacher.assignedClass ?? "");
      res.json(resolved);
    } catch {
      res.json(DEFAULT_POLICY);
    }
  });

  // POST check-in
  app.post("/api/teacher/self-attendance/check-in", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });
      const today = istToday();
      const { latitude, longitude, locationVerified } = req.body;

      const [existing] = await db.select().from(teacherSelfAttendance).where(
        and(eq(teacherSelfAttendance.teacherId, req.session.teacherId), eq(teacherSelfAttendance.attendanceDate, today))
      );
      if (existing?.checkInTime) return res.status(400).json({ message: "Already checked in for today" });

      const now = new Date();

      // Resolve policy and evaluate check-in status
      const policyRows = await db.select().from(attendancePolicies).where(
        and(eq(attendancePolicies.schoolId, teacher.schoolId), eq(attendancePolicies.isActive, true))
      );
      const policy = resolvePolicy(policyRows, "TEACHER", teacher.assignedClass ?? "");
      const evalResult = evaluateAttendanceStatus(utcToISTHHMM(now), policy);
      const status = evalResult.displayStatus; // "Present", "Late", "Half Day", or "Leave"

      let record;
      if (existing) {
        [record] = await db.update(teacherSelfAttendance)
          .set({ checkInTime: now, status, locationVerified: !!locationVerified, latitude: latitude?.toString() ?? null, longitude: longitude?.toString() ?? null, updatedAt: now })
          .where(eq(teacherSelfAttendance.id, existing.id)).returning();
      } else {
        [record] = await db.insert(teacherSelfAttendance).values({
          teacherId: req.session.teacherId, schoolId: teacher.schoolId, attendanceDate: today,
          checkInTime: now, status, locationVerified: !!locationVerified,
          latitude: latitude?.toString() ?? null, longitude: longitude?.toString() ?? null,
        }).returning();
      }
      res.json(record);
    } catch (err) {
      res.status(500).json({ message: "Check-in failed" });
    }
  });

  // POST check-out
  app.post("/api/teacher/self-attendance/check-out", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const today = istToday();
      const [existing] = await db.select().from(teacherSelfAttendance).where(
        and(eq(teacherSelfAttendance.teacherId, req.session.teacherId), eq(teacherSelfAttendance.attendanceDate, today))
      );
      if (!existing?.checkInTime) return res.status(400).json({ message: "Not checked in yet" });
      if (existing.checkOutTime)  return res.status(400).json({ message: "Already checked out" });

      const now = new Date();
      const workingMinutes = Math.floor((now.getTime() - new Date(existing.checkInTime).getTime()) / 60000);
      let [record] = await db.update(teacherSelfAttendance)
        .set({ checkOutTime: now, totalWorkingMinutes: workingMinutes, updatedAt: now })
        .where(eq(teacherSelfAttendance.id, existing.id)).returning();

      // Early check-out: if checkout time (IST) < halfDayCutoffTime → mark as Half Day
      const teacher = await storage.getTeacherById(req.session.teacherId!);
      if (teacher) {
        const policyRowsCO = await db.select().from(attendancePolicies).where(
          and(eq(attendancePolicies.schoolId, teacher.schoolId), eq(attendancePolicies.isActive, true))
        );
        const coPolicy = resolvePolicy(policyRowsCO, "TEACHER", teacher.assignedClass ?? "");
        const coIST = utcToISTHHMM(now);
        const [coh, com] = coIST.split(":").map(Number);
        const coMin = coh * 60 + com;
        const [hch, hcm] = (coPolicy.halfDayCutoffTime || "12:00").split(":").map(Number);
        const halfMin = hch * 60 + hcm;
        if (coMin < halfMin) {
          [record] = await db.update(teacherSelfAttendance)
            .set({ status: "Half Day", updatedAt: now })
            .where(eq(teacherSelfAttendance.id, record.id)).returning();
        }
      }

      res.json(record);
    } catch (err) {
      res.status(500).json({ message: "Check-out failed" });
    }
  });

  // GET history (default last 30 days)
  app.get("/api/teacher/self-attendance/history", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const days   = Math.min(parseInt(req.query.days as string) || 30, 90);
      const istNow = Date.now() + 19800000;
      const end    = new Date(istNow).toISOString().split("T")[0];
      const start  = new Date(istNow - (days - 1) * 86400000).toISOString().split("T")[0];

      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });

      const [records, policyRows] = await Promise.all([
        db.select().from(teacherSelfAttendance).where(
          and(eq(teacherSelfAttendance.teacherId, req.session.teacherId), gte(teacherSelfAttendance.attendanceDate, start), lte(teacherSelfAttendance.attendanceDate, end))
        ).orderBy(desc(teacherSelfAttendance.attendanceDate)),
        db.select().from(attendancePolicies).where(
          and(eq(attendancePolicies.schoolId, teacher.schoolId), eq(attendancePolicies.isActive, true))
        ),
      ]);

      const policy = resolvePolicy(policyRows, "TEACHER", teacher.assignedClass ?? "");
      const now    = new Date();

      // Re-evaluate and heal every record that has a check-in
      const healed = await Promise.all(records.map(async r => {
        if (!r.checkInTime) return r;
        const correct = recomputeStatus(r, policy);
        if (correct === r.status) return r;
        const [updated] = await db.update(teacherSelfAttendance)
          .set({ status: correct, updatedAt: now })
          .where(eq(teacherSelfAttendance.id, r.id))
          .returning();
        return updated;
      }));

      res.json(healed);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch history" });
    }
  });

  // POST self-correction — applies immediately, no admin approval needed
  app.post("/api/teacher/self-attendance/correction", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });
      const { date, requestedCheckIn, requestedCheckOut, reason } = req.body;
      if (!date || !requestedCheckIn || !requestedCheckOut || !reason?.trim())
        return res.status(400).json({ message: "All fields are required" });
      const diffDays = Math.floor((Date.now() - new Date(date + "T00:00:00").getTime()) / 86400000);
      if (diffDays < 0 || diffDays > 7) return res.status(400).json({ message: "Corrections only allowed within the last 7 days" });

      // Parse times as IST (teachers enter local Indian time)
      const checkInIST  = new Date(`${date}T${requestedCheckIn}:00+05:30`);
      const checkOutIST = new Date(`${date}T${requestedCheckOut}:00+05:30`);
      if (checkOutIST <= checkInIST) return res.status(400).json({ message: "Check-out must be after check-in" });

      const workingMinutes = Math.floor((checkOutIST.getTime() - checkInIST.getTime()) / 60000);

      // Evaluate status from corrected times using current policy
      const corrPolicyRows = await db.select().from(attendancePolicies).where(
        and(eq(attendancePolicies.schoolId, teacher.schoolId), eq(attendancePolicies.isActive, true))
      );
      const corrPolicy = resolvePolicy(corrPolicyRows, "TEACHER", teacher.assignedClass ?? "");
      const status = recomputeStatus({ checkInTime: checkInIST, checkOutTime: checkOutIST }, corrPolicy);
      const now = new Date();

      // Upsert the attendance record — select first then insert or update
      const [existing] = await db.select().from(teacherSelfAttendance).where(
        and(eq(teacherSelfAttendance.teacherId, req.session.teacherId), eq(teacherSelfAttendance.attendanceDate, date))
      );
      let attendanceRecord;
      if (existing) {
        [attendanceRecord] = await db.update(teacherSelfAttendance)
          .set({ checkInTime: checkInIST, checkOutTime: checkOutIST, totalWorkingMinutes: workingMinutes, status, locationVerified: existing.locationVerified, updatedAt: now })
          .where(eq(teacherSelfAttendance.id, existing.id)).returning();
      } else {
        [attendanceRecord] = await db.insert(teacherSelfAttendance).values({
          teacherId: req.session.teacherId, schoolId: teacher.schoolId, attendanceDate: date,
          checkInTime: checkInIST, checkOutTime: checkOutIST, totalWorkingMinutes: workingMinutes,
          status, locationVerified: false,
        }).returning();
      }

      // Log the correction as auto-approved for audit history
      const [correction] = await db.insert(attendanceCorrectionRequests).values({
        teacherId: req.session.teacherId, schoolId: teacher.schoolId, attendanceDate: date,
        requestedCheckIn, requestedCheckOut, reason: reason.trim(), status: "Approved",
      }).returning();

      res.json({ correction, attendanceRecord });
    } catch (err) {
      res.status(500).json({ message: "Failed to apply correction" });
    }
  });

  // GET correction requests
  app.get("/api/teacher/self-attendance/corrections", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const corrections = await db.select().from(attendanceCorrectionRequests)
        .where(eq(attendanceCorrectionRequests.teacherId, req.session.teacherId))
        .orderBy(desc(attendanceCorrectionRequests.createdAt)).limit(20);
      res.json(corrections);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch corrections" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/teacher/attendance/history — paginated, policy-healed history
  // Security: teacherId is ALWAYS taken from the authenticated session.
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/teacher/attendance/history", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const teacher = await storage.getTeacherById(req.session.teacherId);
      if (!teacher) return res.status(401).json({ message: "Teacher not found" });

      const {
        fromDate, toDate,
        status,
        page     = "1",
        pageSize = "200",
      } = req.query as Record<string, string>;

      // Build conditions — teacherId always comes from session, never from query params
      const conditions: ReturnType<typeof eq>[] = [
        eq(teacherSelfAttendance.teacherId, req.session.teacherId),
        eq(teacherSelfAttendance.schoolId,  teacher.schoolId),
      ];
      if (fromDate) conditions.push(gte(teacherSelfAttendance.attendanceDate, fromDate) as any);
      if (toDate)   conditions.push(lte(teacherSelfAttendance.attendanceDate, toDate) as any);
      if (status && status !== "all") conditions.push(eq(teacherSelfAttendance.status, status) as any);

      const [dbRecords, policyRows] = await Promise.all([
        db.select().from(teacherSelfAttendance)
          .where(and(...(conditions as any[])))
          .orderBy(desc(teacherSelfAttendance.attendanceDate)),
        db.select().from(attendancePolicies).where(
          and(eq(attendancePolicies.schoolId, teacher.schoolId), eq(attendancePolicies.isActive, true))
        ),
      ]);

      const policy = resolvePolicy(policyRows, "TEACHER", teacher.assignedClass ?? "");

      // Heal stale statuses on the fly (no DB writes here — reads are fast)
      const records = dbRecords.map(r => {
        if (!r.checkInTime) return r;
        const correct = recomputeStatus(r, policy);
        return correct !== r.status ? { ...r, status: correct } : r;
      });

      // ── Summary (only over DB records — absent days are generated client-side) ──
      const present  = records.filter(r => r.status === "Present").length;
      const late     = records.filter(r => r.status === "Late").length;
      const halfDay  = records.filter(r => r.status === "Half Day").length;
      const absent   = records.filter(r => r.status === "Absent").length;
      const leave    = records.filter(r => r.status === "Leave").length;
      const totalWorkingMinutes = records.reduce((s, r) => s + (r.totalWorkingMinutes ?? 0), 0);
      const workedCount         = records.filter(r => (r.totalWorkingMinutes ?? 0) > 0).length;
      const avgWorkingMinutes   = workedCount > 0 ? Math.round(totalWorkingMinutes / workedCount) : 0;

      const summary = { present, late, halfDay, absent, leave, totalWorkingMinutes, avgWorkingMinutes };

      // ── Statistics ────────────────────────────────────────────────────────
      const attended = present + late + halfDay;
      const total    = attended + absent + leave;
      const attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;

      // Streak: consecutive Present/Late/Half Day working days (most-recent first)
      const sorted = [...records].sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate));
      let streak = 0, longestStreak = 0, cur = 0;
      for (const r of sorted) {
        const dow = new Date(r.attendanceDate + "T12:00:00").getDay();
        if (dow === 0 || dow === 6) continue;
        const ok = r.status === "Present" || r.status === "Late" || r.status === "Half Day";
        if (ok) { cur++; if (cur > longestStreak) longestStreak = cur; }
        else    { if (streak === 0) streak = cur; cur = 0; }
      }
      if (streak === 0) streak = cur;

      const statistics = {
        attendanceRate,
        streak,
        longestStreak,
        totalWorkingHours: +(totalWorkingMinutes / 60).toFixed(1),
        avgDailyHours:     +(avgWorkingMinutes   / 60).toFixed(1),
      };

      // ── Pagination ────────────────────────────────────────────────────────
      const pageNum     = Math.max(1, parseInt(page));
      const pageSizeNum = Math.min(500, Math.max(1, parseInt(pageSize)));
      const totalRecords = records.length;
      const totalPages   = Math.ceil(totalRecords / pageSizeNum);
      const paginatedRecords = records.slice((pageNum - 1) * pageSizeNum, pageNum * pageSizeNum);

      console.log(`[attendance/history] teacherId=${req.session.teacherId} from=${fromDate} to=${toDate} records=${paginatedRecords.length} dates=${paginatedRecords.map((r: any) => r.attendanceDate).join(",")}`);
      res.json({
        records: paginatedRecords,
        summary,
        statistics,
        pagination: { page: pageNum, pageSize: pageSizeNum, totalRecords, totalPages },
      });
    } catch (err) {
      console.error("[attendance/history]", err);
      res.status(500).json({ message: "Failed to fetch attendance history" });
    }
  });
}
