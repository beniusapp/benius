import type { Express } from "express";
import { storage } from "./storage";
import bcrypt from "bcryptjs";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";

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
  subject: z.string().min(1),
  assignedClass: z.string().min(1),
  assignedSection: z.string().min(1),
});

const teacherLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
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

  app.delete("/api/teachers/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid teacher ID" });
    const deleted = await storage.deleteTeacher(id);
    if (!deleted) return res.status(404).json({ message: "Teacher not found" });
    res.json({ message: "Teacher deleted" });
  });

  // ===== TEACHER AUTH =====
  app.post("/api/teacher-login", async (req, res) => {
    const parsed = teacherLoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Email and password are required" });

    const user = await storage.getUserByEmail(parsed.data.email);
    if (!user || user.role !== "teacher") return res.status(401).json({ message: "Invalid email or password" });

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) return res.status(401).json({ message: "Invalid email or password" });

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

    const todayDone = await storage.hasAttendanceToday(
      data.teacher.id, data.teacher.assignedClass, data.teacher.assignedSection, data.teacher.schoolId
    );

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
    });
  });

  app.post("/api/teacher/change-password", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const data = await storage.getTeacherWithSchool(req.session.teacherId);
    if (!data) return res.status(401).json({ message: "Teacher not found" });

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await storage.updateTeacherPassword(data.user.id, passwordHash, false);
    res.json({ message: "Password changed successfully" });
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

    const studentList = await storage.getStudentsByClassSection(sid, cls, section);
    const records = await storage.getAttendanceForStudentsOnDate(studentList.map(s => s.id), date);

    const result = studentList.map(student => {
      const record = records.find(r => r.studentId === student.id);
      return {
        studentId: student.id,
        name: student.name,
        dsid: student.digitalStudentId,
        status: record?.status || "present",
        editCount: record?.editCount || 0,
        markedBy: record?.markedBy || null,
        markedAt: record?.markedAt || null,
        hasRecord: !!record,
      };
    });
    res.json(result);
  });

  app.post("/api/attendance", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });

    const { date, records } = req.body;
    if (!date || !Array.isArray(records)) return res.status(400).json({ message: "Invalid data" });

    const today = new Date().toISOString().split("T")[0];
    if (date > today) return res.status(400).json({ message: "Cannot mark attendance for future dates" });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const minDate = sevenDaysAgo.toISOString().split("T")[0];
    if (date < minDate) return res.status(400).json({ message: "Can only edit attendance for the past 7 days" });

    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const markedBy = `${teacher.fullName} at ${new Date().toISOString()}`;
    const formattedRecords = records.map((r: any) => ({
      studentId: r.studentId,
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
      date,
      status: r.status,
      markedBy,
    }));

    const saved = await storage.upsertAttendance(formattedRecords);
    res.json({ message: `Attendance saved for ${saved.length} students`, count: saved.length });
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

    const { content, class: cls, section } = req.body;
    if (!content || !cls || !section) return res.status(400).json({ message: "Content, class, and section required" });

    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const hw = await storage.createHomework({
      teacherId: teacher.id, schoolId: teacher.schoolId, class: cls, section, content, fileUrl,
    });
    res.status(201).json(hw);
  });

  app.get("/api/homework/:schoolId/:class/:section", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const sid = parseInt(req.params.schoolId);
    const list = await storage.getHomeworkByClass(sid, req.params.class, req.params.section);
    res.json(list);
  });

  // ===== CLASSWORK =====
  app.post("/api/classwork", diskUpload.single("file"), async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const { content, class: cls, section } = req.body;
    if (!content || !cls || !section) return res.status(400).json({ message: "Content, class, and section required" });

    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const cw = await storage.createClasswork({
      teacherId: teacher.id, schoolId: teacher.schoolId, class: cls, section, content, fileUrl,
    });
    res.status(201).json(cw);
  });

  app.get("/api/classwork/:schoolId/:class/:section", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const sid = parseInt(req.params.schoolId);
    const list = await storage.getClassworkByClass(sid, req.params.class, req.params.section);
    res.json(list);
  });

  // ===== NOTICES =====
  app.post("/api/notices", diskUpload.single("file"), async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const { content, targetType, targetClass, targetSection, schoolId } = req.body;
    if (!content || !targetType || !schoolId) return res.status(400).json({ message: "Content, targetType, and schoolId required" });

    const creatorRole = req.session.teacherId ? "teacher" : "admin";
    const createdById = req.session.teacherId || req.session.userId;
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const notice = await storage.createNotice({
      schoolId: parseInt(schoolId), createdById: createdById!, creatorRole, targetType,
      targetClass: targetClass || null, targetSection: targetSection || null, content, fileUrl,
    });
    res.status(201).json(notice);
  });

  app.get("/api/notices/:schoolId", async (req, res) => {
    if (!req.session.userId && !req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const sid = parseInt(req.params.schoolId);
    const targetType = (req.query.target as string) || "teacher";
    const cls = req.query.class as string | undefined;
    const section = req.query.section as string | undefined;
    const list = await storage.getNoticesByTarget(sid, targetType, cls, section);
    res.json(list);
  });

  // ===== COMPLAINTS =====
  app.post("/api/complaints", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const { studentId, content } = req.body;
    if (!studentId || !content) return res.status(400).json({ message: "Student and content required" });

    const complaint = await storage.createComplaint({
      teacherId: teacher.id, studentId: parseInt(studentId), schoolId: teacher.schoolId, content,
    });
    res.status(201).json(complaint);
  });

  app.get("/api/complaints/teacher/:teacherId", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.getComplaintsByTeacher(parseInt(req.params.teacherId));
    res.json(list);
  });

  // ===== EXAMINATION =====
  app.post("/api/exam-scores", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const teacher = await storage.getTeacherById(req.session.teacherId);
    if (!teacher) return res.status(401).json({ message: "Teacher not found" });

    const { scores, subject, examType } = req.body;
    if (!Array.isArray(scores) || !subject || !examType) return res.status(400).json({ message: "Scores, subject, and examType required" });

    const formattedScores = scores.map((s: any) => ({
      studentId: s.studentId,
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
      subject,
      examType,
      marks: parseInt(s.marks),
    }));

    const saved = await storage.upsertExamScores(formattedScores);
    res.json({ message: `Saved ${saved.length} scores`, count: saved.length });
  });

  app.get("/api/exam-scores/:schoolId/:subject/:examType/:class/:section", async (req, res) => {
    if (!req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const { schoolId, subject, examType, class: cls, section } = req.params;
    const list = await storage.getExamScores(parseInt(schoolId), decodeURIComponent(subject), decodeURIComponent(examType), cls, section);
    res.json(list);
  });

  // ===== GALLERY =====
  app.post("/api/gallery", diskUpload.single("image"), async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    if (!req.file) return res.status(400).json({ message: "Image file required" });

    const { title, schoolId } = req.body;
    if (!title || !schoolId) return res.status(400).json({ message: "Title and schoolId required" });

    const item = await storage.createGalleryItem({
      schoolId: parseInt(schoolId),
      uploadedById: req.session.teacherId || req.session.userId!,
      title,
      imageUrl: `/uploads/${req.file.filename}`,
      approved: !!req.session.userId && !req.session.teacherId,
    });
    res.status(201).json(item);
  });

  app.get("/api/gallery/:schoolId", async (req, res) => {
    if (!req.session.userId && !req.session.teacherId) return res.status(401).json({ message: "Not authenticated" });
    const approvedOnly = req.query.all !== "true";
    const list = await storage.getGalleryItems(parseInt(req.params.schoolId), approvedOnly);
    res.json(list);
  });

  app.patch("/api/gallery/:id/approve", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const item = await storage.approveGalleryItem(parseInt(req.params.id));
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
    const list = q ? await storage.searchLibraryBooks(sid, q) : await storage.getLibraryBooks(sid);
    res.json(list);
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

    const leave = await storage.createLeaveRequest({
      teacherId: teacher.id, schoolId: teacher.schoolId, leaveType, startDate, endDate, reason, status: "pending",
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
    const list = await storage.getLeaveRequestsBySchool(parseInt(req.params.schoolId));
    res.json(list);
  });

  app.patch("/api/leave/:id/status", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const { status } = req.body;
    if (!["approved", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const updated = await storage.updateLeaveStatus(parseInt(req.params.id), status);
    res.json(updated);
  });

  // ===== TIMETABLE =====
  app.post("/api/timetable", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const { teacherId, schoolId, dayOfWeek, period, class: cls, section, subject } = req.body;
    if (teacherId === undefined || !schoolId || dayOfWeek === undefined || period === undefined || !cls || !section || !subject)
      return res.status(400).json({ message: "All fields required" });
    const entry = await storage.createTimetableEntry({
      teacherId: parseInt(teacherId), schoolId: parseInt(schoolId),
      dayOfWeek: parseInt(dayOfWeek), period: parseInt(period), class: cls, section, subject,
    });
    res.status(201).json(entry);
  });

  app.get("/api/timetable/teacher/:teacherId", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.getTimetableByTeacher(parseInt(req.params.teacherId));
    res.json(list);
  });

  app.get("/api/timetable/school/:schoolId", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    const list = await storage.getTimetableBySchool(parseInt(req.params.schoolId));
    res.json(list);
  });

  app.delete("/api/timetable/:id", async (req, res) => {
    if (!req.session.userId || req.session.userRole === "teacher") return res.status(403).json({ message: "Admin access required" });
    await storage.deleteTimetableEntry(parseInt(req.params.id));
    res.json({ message: "Entry deleted" });
  });

  // ===== FACULTY INFO =====
  app.get("/api/faculty/:schoolId", async (req, res) => {
    if (!req.session.teacherId && !req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.getTeachersBySchool(parseInt(req.params.schoolId));
    res.json(list.map(t => ({ id: t.id, fullName: t.fullName, subject: t.subject, phone: t.phone, assignedClass: t.assignedClass, assignedSection: t.assignedSection })));
  });
}
