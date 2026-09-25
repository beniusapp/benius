import type { AcademicSession } from "@workspace/db";
import type { Express, Request, RequestHandler, Response } from "express";
import { attendanceCorrectionRequests, attendancePolicies, classwork, homework, promotionDecisions, studentProfiles, teacherSelfAttendance } from "@workspace/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "./db";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import sharp, { type Metadata } from "sharp";
import { z } from "zod/v4";
import { calendarDayDifference, formatDateTimeIST, getAcademicYearForISTDate, todayInIST } from "@shared/ist-time";
import { AttendanceLeaveMutationError, storage } from "./storage";
import { evaluateAttendanceStatus, resolvePolicy, utcToISTHHMM, DEFAULT_POLICY } from "./attendance-policy-engine";
import { getTeacherSelfRate } from "./teacher-self-attendance-rate";

type Teacher = NonNullable<Awaited<ReturnType<typeof storage.getTeacherWithSchool>>>;
type TeacherScope = { className: string; section: string; subject: string | null };
type MobileTeacherRequest = Request & {
  mobileAuth?: {
    principal: {
      id: number;
      principalId: number;
      entityId: number | null;
      role: string;
      schoolId: number;
    };
  };
  mobileAcademicSession?: AcademicSession;
  teacherModuleContext?: { account: Teacher; scopes: TeacherScope[]; session: AcademicSession };
  file?: Express.Multer.File;
  teacherUploadRetained?: boolean;
};

const modules = new Set([
  "attendance", "homework", "classwork", "noticeboard", "complaint",
  "examination", "gallery", "faculty-info", "calendar", "library",
  "leave", "timetable", "student-profiles",
]);
const attendanceStatuses = new Set(["present", "absent", "halfday", "late"]);

const moduleParam = z.object({ module: z.string().refine((value) => modules.has(value)) });
const attendanceSchema = z.object({
  className: z.string().trim().min(1).max(20),
  section: z.string().trim().min(1).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  records: z.array(z.object({
    studentId: z.number().int().positive(),
    status: z.string().refine((value) => attendanceStatuses.has(value)),
  })).min(1).max(200),
}).strict();
const homeworkSchema = z.object({
  className: z.string().trim().min(1).max(20),
  section: z.string().trim().min(1).max(10),
  subject: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(20000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict();
const classworkSchema = z.object({
  className: z.string().trim().min(1).max(20),
  section: z.string().trim().min(1).max(10),
  subject: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(20000),
}).strict();
const noticeSchema = z.object({
  content: z.string().trim().min(1).max(20000),
  targetType: z.enum(["student", "whole_school"]),
  className: z.string().trim().min(1).max(20).optional(),
  section: z.string().trim().min(1).max(10).optional(),
  noticeType: z.string().trim().min(1).max(30).default("Routine"),
}).strict();
const complaintSchema = z.object({
  content: z.string().trim().min(1).max(20000),
  complaintType: z.enum(["teacher-to-admin", "teacher-to-student"]),
  studentId: z.number().int().positive().optional(),
  className: z.string().trim().min(1).max(20).optional(),
  section: z.string().trim().min(1).max(10).optional(),
  incidentDate: z.string().datetime().optional(),
}).strict();
const leaveSchema = z.object({
  policyId: z.number().int().positive(),
  leaveType: z.string().trim().min(1).max(60),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1).max(5000),
}).strict();
const profileReviewSchema = z.object({
  studentId: z.number().int().positive(),
  note: z.string().trim().min(1).max(500).optional(),
  corrections: z.record(z.string(), z.string().max(500)).optional(),
}).strict();
const studentLeaveReviewSchema = z.object({
  leaveId: z.number().int().positive(),
  note: z.string().trim().max(1000).optional(),
}).strict();
const privateUploadDirectory = path.join(process.cwd(), "private-data", "teacher-module-files");
const privateFileUrlPrefix = "/api/mobile/teacher/modules/";
const privateFilenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$/i;
const privateDownloadMimeTypes: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
};
class PrivateUploadValidationError extends Error {}
const teacherUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      try {
        fs.mkdirSync(privateUploadDirectory, { recursive: true, mode: 0o700 });
        fs.chmodSync(privateUploadDirectory, 0o700);
        callback(null, privateUploadDirectory);
      } catch (error) { callback(error as Error, privateUploadDirectory); }
    },
    filename: (_req, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12, parts: 14, fieldNameSize: 100, fieldSize: 64 * 1024 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const supported = new Map([
      [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"],
      [".webp", "image/webp"], [".pdf", "application/pdf"],
    ]);
    if (supported.get(ext) !== file.mimetype) {
      callback(new Error("Only matching JPG, PNG, WebP, or PDF attachments are supported."));
      return;
    }
    callback(null, true);
  },
});

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

function attachPrivateUpload(req: Request, res: Response, next: (error?: unknown) => void): void {
  teacherUpload.single("file")(req, res, (error: unknown) => {
    const file = (req as MobileTeacherRequest).file;
    if (!error && !file) { next(); return; }
    if (!error && file) {
      res.once("finish", () => {
        if (!(req as MobileTeacherRequest).teacherUploadRetained || res.statusCode < 200 || res.statusCode >= 300) {
          void fs.promises.unlink(file.path).catch(() => undefined);
        }
      });
      void fs.promises.chmod(file.path, 0o600).then(() => next()).catch(() => {
        void fs.promises.unlink(file.path).catch(() => undefined);
        fail(res, 400, "Unable to securely stage the attachment.");
      });
      return;
    }
    if (file) void fs.promises.unlink(file.path).catch(() => undefined);
    fail(res, 400, error instanceof Error ? error.message : "Attachment upload failed.");
  });
}

async function validatePrivateUpload(req: Request, module: string): Promise<string | null> {
  const file = (req as MobileTeacherRequest).file;
  if (!file) return null;
  const extension = path.extname(file.originalname).toLowerCase().slice(1);
  if (!privateFilenamePattern.test(file.filename)) throw new PrivateUploadValidationError("Invalid private attachment name.");
  if (module === "gallery" && !["jpg", "jpeg", "png", "webp"].includes(extension)) {
    throw new PrivateUploadValidationError("Gallery uploads must be JPG, PNG, or WebP images.");
  }
  if (module === "library" && extension !== "pdf") throw new PrivateUploadValidationError("E-books must be uploaded as PDF files.");
  if (["jpg", "jpeg", "png", "webp"].includes(extension)) {
    let metadata: Metadata;
    try { metadata = await sharp(file.path, { limitInputPixels: 25_000_000 }).metadata(); }
    catch { throw new PrivateUploadValidationError("The selected image is invalid or corrupted."); }
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)
      || (extension === "jpg" || extension === "jpeg" ? metadata.format !== "jpeg" : metadata.format !== extension)) {
      throw new PrivateUploadValidationError("The image file contents do not match the selected file type.");
    }
  } else {
    const header = await fs.promises.open(file.path, "r");
    try {
      const signature = Buffer.alloc(5);
      const { bytesRead } = await header.read(signature, 0, signature.length, 0);
      if (bytesRead < 5 || signature.toString("ascii") !== "%PDF-") throw new PrivateUploadValidationError("The selected file is not a valid PDF.");
    } finally { await header.close(); }
  }
  return `${privateFileUrlPrefix}${module}/private-files/${file.filename}`;
}

async function removePrivateFileUrl(value: string | null | undefined, module: string): Promise<void> {
  if (!value) return;
  const prefix = `${privateFileUrlPrefix}${module}/private-files/`;
  if (!value.startsWith(prefix)) return;
  const filename = value.slice(prefix.length);
  if (!privateFilenamePattern.test(filename)) return;
  await fs.promises.unlink(path.join(privateUploadDirectory, filename)).catch(() => undefined);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function authorizeTeacher(req: Request, res: Response) {
  const mobile = req as MobileTeacherRequest;
  const principal = mobile.mobileAuth?.principal;
  if (!principal || principal.role !== "teacher"
    || !Number.isSafeInteger(principal.id) || principal.id <= 0
    || principal.id !== principal.entityId || principal.principalId <= 0
    || !Number.isSafeInteger(principal.schoolId) || principal.schoolId <= 0) {
    fail(res, 403, "Teacher access is required.");
    return null;
  }
  try {
    const account = await storage.getTeacherWithSchool(principal.id);
    if (!account || account.teacher.id !== principal.id
      || account.teacher.userId !== principal.principalId
      || account.teacher.schoolId !== principal.schoolId
      || account.school.id !== principal.schoolId
      || account.user.id !== principal.principalId
      || account.user.schoolId !== principal.schoolId
      || account.user.role !== "teacher"
      || !account.user.isActive || !account.teacher.isActive
      || account.teacher.mustChangePassword) {
      fail(res, 401, "Teacher account is no longer authorized.");
      return null;
    }
    return account;
  } catch {
    fail(res, 503, "Unable to authorize teacher account.");
    return null;
  }
}

async function resolveScope(account: Teacher, className: string, section: string): Promise<TeacherScope | null> {
  const mappings = await storage.getFacultyMappingsByTeacher(account.teacher.id);
  const scopes: TeacherScope[] = [
    { className: account.teacher.assignedClass, section: account.teacher.assignedSection, subject: account.teacher.subject || null },
    ...mappings.map((mapping) => ({
      className: mapping.className,
      section: mapping.section,
      subject: mapping.subject,
    })),
  ];
  return scopes.find((scope) => scope.className === className && scope.section === section) ?? null;
}

function isArchived(session: AcademicSession): boolean {
  return session.isActive !== true;
}

function withModuleContext(
  requireHttps: RequestHandler,
  requireBearer: RequestHandler,
  requireAcademicSession: RequestHandler,
): RequestHandler[] {
  return [
    requireHttps,
    requireBearer,
    requireAcademicSession,
    (req, res, next) => {
      const session = (req as MobileTeacherRequest).mobileAcademicSession;
      if (!session || session.schoolId !== (req as MobileTeacherRequest).mobileAuth?.principal.schoolId) {
        fail(res, 403, "The selected academic session is not available.");
        return;
      }
      void authorizeTeacher(req, res).then((account) => {
        if (!account) return;
        void storage.getFacultyMappingsByTeacher(account.teacher.id).then((mappings) => {
          const scopes: TeacherScope[] = [
            { className: account.teacher.assignedClass, section: account.teacher.assignedSection, subject: account.teacher.subject || null },
            ...mappings.map((mapping) => ({ className: mapping.className, section: mapping.section, subject: mapping.subject })),
          ];
          (req as MobileTeacherRequest).teacherModuleContext = { account, scopes, session };
          next();
        }).catch(() => fail(res, 503, "Unable to load teacher class assignments."));
      });
    },
  ];
}

function getContext(req: Request, res: Response) {
  const ctx = (req as MobileTeacherRequest).teacherModuleContext;
  if (!ctx) {
    fail(res, 401, "Teacher request is not authenticated.");
    return null;
  }
  return ctx;
}

function getSelectedScope(req: Request, res: Response, scopes: TeacherScope[]): TeacherScope | null {
  const requestedClass = req.query.class;
  const requestedSection = req.query.section;
  if ((requestedClass === undefined) !== (requestedSection === undefined)) {
    fail(res, 400, "Both class and section are required together.");
    return null;
  }
  if (typeof requestedClass === "string" && typeof requestedSection === "string") {
    const found = scopes.find((scope) => scope.className === requestedClass && scope.section === requestedSection);
    if (!found) fail(res, 403, "This class and section are not assigned to the teacher.");
    return found ?? null;
  }
  return scopes[0] ?? null;
}

function isAssignedSubject(scopes: TeacherScope[], className: string, section: string, subject: string): boolean {
  return scopes.some((scope) => scope.className === className && scope.section === section
    && scope.subject?.trim().toLocaleLowerCase() === subject.trim().toLocaleLowerCase());
}

async function guardWriteSession(req: Request, res: Response): Promise<AcademicSession | null> {
  const session = (req as MobileTeacherRequest).teacherModuleContext?.session;
  if (!session) {
    fail(res, 403, "The selected academic session is not available.");
    return null;
  }
  if (isArchived(session)) {
    fail(res, 403, "This action is not allowed in an archived academic session.");
    return null;
  }
  try {
    const current = await storage.getAcademicSessionForSchool(session.id, session.schoolId);
    if (!current || !current.isActive) {
      fail(res, 403, "This academic session is no longer active; refresh and select the current session.");
      return null;
    }
    return current;
  } catch {
    fail(res, 503, "Unable to verify the selected academic session.");
    return null;
  }
}

async function getModuleData(req: Request, res: Response): Promise<void> {
  const params = moduleParam.safeParse(req.params);
  if (!params.success) {
    fail(res, 404, "Teacher module not found.");
    return;
  }
  const context = getContext(req, res);
  if (!context) return;
  const { account, scopes, session } = context;
  const teacher = account.teacher;
  const classScope = getSelectedScope(req, res, scopes);
  if ((req.query.class !== undefined || req.query.section !== undefined) && !classScope) return;
  if (!classScope && scopes.length > 0 && params.data.module !== "faculty-info"
    && params.data.module !== "gallery" && params.data.module !== "calendar"
    && params.data.module !== "library" && params.data.module !== "leave") return;

  try {
    switch (params.data.module) {
      case "attendance": {
        if (req.query.date !== undefined && (typeof req.query.date !== "string" || !validDate(req.query.date))) {
          fail(res, 400, "date must be a valid YYYY-MM-DD calendar date.");
          return;
        }
        const date = typeof req.query.date === "string" ? req.query.date : todayInIST();
        const [roster, records] = classScope ? await Promise.all([
          storage.getAttendanceRosterForSessionClass(account.school.id, session.id, classScope.className, classScope.section),
          storage.getAttendanceHistory(account.school.id, session.id, classScope.className, classScope.section, date, date),
        ]) : [[], []];
        const recordByIdentity = new Map(records.map((record) => [record.identityKey, record]));
        const [selfRecord] = await db.select().from(teacherSelfAttendance).where(and(
          eq(teacherSelfAttendance.teacherId, teacher.id), eq(teacherSelfAttendance.schoolId, account.school.id),
          eq(teacherSelfAttendance.sessionId, session.id), eq(teacherSelfAttendance.attendanceDate, todayInIST()),
        ));
        const policyRows = await db.select().from(attendancePolicies).where(and(
          eq(attendancePolicies.schoolId, account.school.id), eq(attendancePolicies.isActive, true),
        ));
        const policy = resolvePolicy(policyRows, "TEACHER", teacher.assignedClass ?? "") ?? DEFAULT_POLICY;
        const selfRate = await getTeacherSelfRate(account.school.id, teacher.id, session);
        const selfHistory = await db.select().from(teacherSelfAttendance).where(and(
          eq(teacherSelfAttendance.teacherId, teacher.id), eq(teacherSelfAttendance.schoolId, account.school.id),
          eq(teacherSelfAttendance.sessionId, session.id),
        )).orderBy(desc(teacherSelfAttendance.attendanceDate)).limit(90);
        const corrections = await db.select().from(attendanceCorrectionRequests).where(and(
          eq(attendanceCorrectionRequests.teacherId, teacher.id), eq(attendanceCorrectionRequests.schoolId, account.school.id),
          eq(attendanceCorrectionRequests.sessionId, session.id),
        )).orderBy(desc(attendanceCorrectionRequests.createdAt)).limit(20);
        res.json({
          scopes,
          date,
          entries: roster.map((student) => {
            const record = recordByIdentity.get(student.attendanceIdentityKey);
            return { studentId: student.id, name: student.name, dsid: student.digitalStudentId, status: record?.status ?? null, editCount: record?.editCount ?? 0 };
          }),
          selfAttendance: { today: selfRecord ?? null, policy, rate: selfRate, history: selfHistory, corrections },
        });
        return;
      }
      case "homework":
        res.json({ scopes, className: classScope?.className, section: classScope?.section,
          items: classScope ? (await storage.getHomeworkByClass(account.school.id, classScope.className, classScope.section, session.id))
            .map((item) => ({ ...item, canEdit: item.teacherId === teacher.id })) : [] });
        return;
      case "classwork":
        res.json({ scopes, className: classScope?.className, section: classScope?.section,
          items: classScope ? (await storage.getClassworkByClass(account.school.id, classScope.className, classScope.section, session.id))
            .map((item) => ({ ...item, canEdit: item.teacherId === teacher.id })) : [] });
        return;
      case "noticeboard":
        {
          const [visible, own] = await Promise.all([
            storage.getTeacherScopedNotices(account.school.id, teacher.id, session.id),
            storage.getNoticesByTeacher(teacher.id, 500),
          ]);
          const items = new Map<number, typeof visible[number]>();
          for (const item of visible) items.set(item.id, item);
          for (const item of own) {
            if (item.schoolId === account.school.id && item.sessionId === session.id) items.set(item.id, item);
          }
          res.json({ scopes, items: [...items.values()].sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          ) });
        }
        return;
      case "complaint":
        {
          const rosters = await Promise.all(scopes.map((scope) =>
            storage.getAttendanceRosterForSessionClass(account.school.id, session.id, scope.className, scope.section),
          ));
          const complaints = await storage.getComplaintsByTeacher(
            teacher.id, teacher.assignedClass, teacher.assignedSection, account.school.id, session.id,
          );
          const classFeed = await storage.getClassFeedComplaints(
            account.school.id,
            scopes.map(({ className, section }) => ({ className, section })),
            undefined,
            undefined,
            session.id,
          );
          res.json({
            scopes,
            students: rosters.flat().map((student) => ({ id: student.id, name: student.name, className: student.class, section: student.section, dsid: student.digitalStudentId })),
            items: await Promise.all(complaints.map(async (item) => ({
              ...item,
              notes: await storage.getComplaintNotes(item.id),
            }))),
            classFeed,
          });
        }
        return;
      case "examination": {
        const classSubjects = await storage.getClassSubjectsMap(account.school.id);
        const examTypes = await storage.getClassExamTypesMap(account.school.id);
        const policyTiers = await storage.getExamPolicyTiers(account.school.id);
        const policy = policyTiers.find((tier) =>
          (tier.applicableClasses ?? []).map((name) => String(name).trim()).includes(String(classScope?.className ?? "").trim()),
        );
        let promotionTerms: string[] = [];
        try {
          const configuredTerms = JSON.parse(policy?.examWeights ?? "{}");
          if (configuredTerms && typeof configuredTerms === "object" && !Array.isArray(configuredTerms)) {
            promotionTerms = Object.keys(configuredTerms).map((term) => term.trim()).filter(Boolean);
          }
        } catch { promotionTerms = []; }
        const requestedTerm = typeof req.query.term === "string" ? req.query.term.trim() : "";
        if (requestedTerm && !promotionTerms.includes(requestedTerm)) {
          fail(res, 403, "The selected results term is not configured for this class.");
          return;
        }
        const assignedSubjects = scopes.filter((scope) => scope.className === classScope?.className
          && scope.section === classScope.section && scope.subject).map((scope) => scope.subject!);
        const subjects = (classScope ? classSubjects[classScope.className] ?? [] : [])
          .filter((available) => assignedSubjects.some((assigned) => assigned.toLocaleLowerCase() === available.toLocaleLowerCase()));
        const allowedExamTypes = classScope ? examTypes[classScope.className] ?? [] : [];
        const subject = typeof req.query.subject === "string" ? req.query.subject : classScope?.subject ?? "";
        const examType = typeof req.query.examType === "string" ? req.query.examType : "";
        if ((subject && !subjects.some((candidate) => candidate === subject))
          || (examType && !allowedExamTypes.includes(examType))) {
          fail(res, 403, "The selected subject or examination is not available for this assigned class.");
          return;
        }
        const [scores, roster] = classScope && subject && examType
          ? await Promise.all([
            storage.getExamScores(account.school.id, subject, examType, classScope.className, classScope.section, session.id),
            storage.getAttendanceRosterForSessionClass(account.school.id, session.id, classScope.className, classScope.section),
          ])
          : [[], []];
        const savedLedger = classScope && requestedTerm
          ? await storage.getPromotionDecisions(account.school.id, classScope.className, classScope.section, requestedTerm, session.id)
          : [];
        res.json({
          scopes,
          subjects,
          examTypes: classScope ? (examTypes[classScope.className] ?? []) : [],
          items: scores,
          students: roster.map((student) => ({ studentId: student.id, name: student.name, dsid: student.digitalStudentId })),
          promotionTerms,
          promotionDecisions: savedLedger,
        });
        return;
      }
      case "gallery": {
        const items = await storage.getApprovedGalleryItems(account.school.id);
        const myUploads = (await storage.getGalleryItems(account.school.id, false))
          .filter((item) => item.uploadedById === teacher.id && item.uploaderRole === "teacher");
        res.json({ items, myUploads });
        return;
      }
      case "faculty-info":
        res.json({ items: await storage.getFacultyBySchoolWithMappings(account.school.id) });
        return;
      case "calendar": {
        if (req.query.start !== undefined || req.query.end !== undefined) {
          if (typeof req.query.start !== "string" || typeof req.query.end !== "string"
            || !validDate(req.query.start) || !validDate(req.query.end) || req.query.start > req.query.end) {
            fail(res, 400, "Calendar range must use ordered YYYY-MM-DD dates.");
            return;
          }
          const span = Math.round((Date.parse(`${req.query.end}T00:00:00Z`) - Date.parse(`${req.query.start}T00:00:00Z`)) / 86400000) + 1;
          if (span > 370) { fail(res, 400, "Calendar range cannot exceed one year."); return; }
          const filters = scopes.map((scope) => ({ cls: scope.className, sec: scope.section }));
          res.json({ start: req.query.start, end: req.query.end,
            items: await storage.getCalendarEventsByRange(account.school.id, req.query.start, req.query.end, filters) });
          return;
        }
        if (req.query.year !== undefined && (typeof req.query.year !== "string" || !/^\d{4}$/.test(req.query.year))) {
          fail(res, 400, "year must use YYYY format.");
          return;
        }
        if (req.query.year !== undefined) {
          const year = Number(req.query.year);
          if (year < 2000 || year > 2200) { fail(res, 400, "year is outside the supported calendar range."); return; }
          const filters = scopes.map((scope) => ({ cls: scope.className, sec: scope.section }));
          res.json({ year, items: await storage.getCalendarEventsByRange(account.school.id, `${year}-01-01`, `${year}-12-31`, filters) });
          return;
        }
        if (req.query.month !== undefined && (typeof req.query.month !== "string" || !/^\d{4}-\d{2}$/.test(req.query.month))) {
          fail(res, 400, "month must use YYYY-MM format.");
          return;
        }
        const month = typeof req.query.month === "string" ? req.query.month : todayInIST().slice(0, 7);
        const year = Number(month.slice(0, 4));
        const monthNumber = Number(month.slice(5, 7));
        if (monthNumber < 1 || monthNumber > 12) {
          fail(res, 400, "month must be a valid YYYY-MM calendar month.");
          return;
        }
        const start = `${month}-01`;
        const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
        const filters = scopes.map((scope) => ({ cls: scope.className, sec: scope.section }));
        res.json({ month, items: await storage.getCalendarEventsByRange(account.school.id, start, end, filters) });
        return;
      }
      case "library": {
        const books = await storage.getLibraryBooks(account.school.id);
        const items = books.filter((book) => book.verificationStatus === "approved"
          && (!book.targetClass || scopes.some((scope) => scope.className === book.targetClass)));
        const myEbooks = books.filter((book) => book.uploadedById === teacher.id);
        const myBooks = await storage.getMyBorrowedBooks(teacher.id, "teacher");
        res.json({ items, myEbooks, myBooks: myBooks.filter((borrow) => borrow.returnedAt == null) });
        return;
      }
      case "leave": {
        const [items, balance, policies, studentItems, studentHistory] = await Promise.all([
          storage.getLeaveRequestsByTeacher(teacher.id, session.id),
          storage.getTeacherLeaveBalanceByPolicies(teacher.id, account.school.id),
          storage.getActiveLeavePoliciesBySchool(account.school.id, "teacher"),
          storage.getStudentLeavesByTeacher(teacher.id, account.school.id, session.id),
          storage.getStudentLeaveHistoryForTeacher(teacher.id, account.school.id),
        ]);
        res.json({ items, balance, policies, studentItems, studentHistory });
        return;
      }
      case "timetable":
        res.json({ items: await storage.getTimetableByTeacher(account.school.id, session.id, teacher.id) });
        return;
      case "student-profiles": {
        const [items, history] = await Promise.all([
          storage.getPendingProfilesForTeacher(account.school.id, teacher.id, undefined, session.id),
          storage.getTeacherApprovalHistory(teacher.id, account.school.id, session.id),
        ]);
        const scrubPhoto = (profile: any) => {
          if (profile && typeof profile === "object") {
            const copy = { ...profile };
            if (typeof copy.photoUrl === "string" && !copy.photoUrl.includes("/private-files/")) delete copy.photoUrl;
            if (typeof copy.currentVerifiedProfile === "string") {
              try {
                const verified = JSON.parse(copy.currentVerifiedProfile);
                if (verified && typeof verified === "object" && typeof verified.photoUrl === "string"
                  && !verified.photoUrl.includes("/private-files/")) delete verified.photoUrl;
                copy.currentVerifiedProfile = JSON.stringify(verified);
              } catch { /* preserve opaque verified profile without exposing a URL */ copy.currentVerifiedProfile = null; }
            }
            return copy;
          }
          return profile;
        };
        res.json({ items: items.map(scrubPhoto), history: history.map(scrubPhoto) });
        return;
      }
      default:
        fail(res, 404, "Teacher module not found.");
    }
  } catch {
    fail(res, 503, "Unable to load teacher module.");
  }
}

async function postModuleAction(req: Request, res: Response): Promise<void> {
  const params = z.object({
    module: z.string().refine((value) => modules.has(value)),
    action: z.string().min(1).max(30),
  }).safeParse(req.params);
  if (!params.success) {
    fail(res, 404, "Teacher action not found.");
    return;
  }
  const context = getContext(req, res);
  if (!context) return;
  const { account, scopes } = context;
  const session = await guardWriteSession(req, res);
  if (!session) return;
  const teacher = account.teacher;

  try {
    const { module, action } = params.data;
    if (module === "timetable" && (action === "save" || action === "delete")) {
      const body = z.object({
        dayOfWeek: z.coerce.number().int().min(0).max(6),
        period: z.coerce.number().int().positive().max(30),
        className: z.string().trim().min(1).max(20),
        section: z.string().trim().min(1).max(10),
        subject: z.string().trim().min(1).max(100).optional(),
        room: z.string().trim().max(100).nullable().optional(),
      }).strict().safeParse(req.body);
      if (!body.success) { fail(res, 400, "Invalid timetable slot."); return; }
      if (!await resolveScope(account, body.data.className, body.data.section)) {
        fail(res, 403, "This class and section are not assigned to the teacher."); return;
      }
      if (action === "delete") {
        res.json({ deleted: await storage.deleteTeacherTimetableSlot(account.school.id, session.id, teacher.id, body.data.dayOfWeek, body.data.period) });
        return;
      }
      if (!body.data.subject) { fail(res, 400, "Subject is required."); return; }
      const valid = await storage.validateTimetableEntry({
        schoolId: account.school.id, sessionId: session.id, teacherId: teacher.id,
        dayOfWeek: body.data.dayOfWeek, period: body.data.period, class: body.data.className,
        section: body.data.section, subject: body.data.subject, room: body.data.room ?? null,
        requireAllocation: true,
      });
      if (!valid.valid) { fail(res, 409, valid.error ?? "Timetable collision."); return; }
      res.json({ item: await storage.upsertTeacherTimetableSlot(account.school.id, session.id, teacher.id, {
        dayOfWeek: body.data.dayOfWeek, period: body.data.period, class: body.data.className,
        section: body.data.section, subject: body.data.subject, room: body.data.room ?? null,
      }) });
      return;
    }
    if (module === "attendance" && ["self-check-in", "self-check-out", "self-correction"].includes(action)) {
      if (!session.startDate || !session.endDate || todayInIST() < session.startDate || todayInIST() > session.endDate) {
        fail(res, 403, "Self attendance is unavailable outside the selected academic session.");
        return;
      }
      const today = todayInIST();
      if (action === "self-correction") {
        const body = z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          requestedCheckIn: z.string().regex(/^\d{2}:\d{2}$/),
          requestedCheckOut: z.string().regex(/^\d{2}:\d{2}$/),
          reason: z.string().trim().min(1).max(1000),
        }).strict().safeParse(req.body);
        const correctionMinimum = new Date(`${today}T00:00:00.000Z`);
        correctionMinimum.setUTCDate(correctionMinimum.getUTCDate() - 6);
        if (!body.success || body.data.date < session.startDate || body.data.date > session.endDate
          || body.data.date > today || body.data.date < correctionMinimum.toISOString().slice(0, 10)) {
          fail(res, 400, "Correction date or details are invalid.");
          return;
        }
        const [record] = await db.insert(attendanceCorrectionRequests).values({
          teacherId: teacher.id, schoolId: account.school.id, sessionId: session.id,
          attendanceDate: body.data.date, requestedCheckIn: body.data.requestedCheckIn,
          requestedCheckOut: body.data.requestedCheckOut,
          reason: body.data.reason, status: "Pending",
        }).returning();
        res.json({ correction: record });
        return;
      }
      const [existing] = await db.select().from(teacherSelfAttendance).where(and(
        eq(teacherSelfAttendance.teacherId, teacher.id), eq(teacherSelfAttendance.schoolId, account.school.id),
        eq(teacherSelfAttendance.sessionId, session.id), eq(teacherSelfAttendance.attendanceDate, today),
      ));
      if (action === "self-check-in") {
        if (existing?.checkInTime) { fail(res, 409, "Already checked in for today."); return; }
        const rows = await db.select().from(attendancePolicies).where(and(
          eq(attendancePolicies.schoolId, account.school.id), eq(attendancePolicies.isActive, true),
        ));
        const policy = resolvePolicy(rows, "TEACHER", teacher.assignedClass ?? "") ?? DEFAULT_POLICY;
        const now = new Date();
        const evaluated = evaluateAttendanceStatus(utcToISTHHMM(now), policy);
        const [record] = existing
          ? await db.update(teacherSelfAttendance).set({
            checkInTime: now, status: evaluated.displayStatus, locationVerified: false, updatedAt: now,
          }).where(and(eq(teacherSelfAttendance.id, existing.id), eq(teacherSelfAttendance.teacherId, teacher.id),
            eq(teacherSelfAttendance.schoolId, account.school.id), eq(teacherSelfAttendance.sessionId, session.id))).returning()
          : await db.insert(teacherSelfAttendance).values({
            teacherId: teacher.id, schoolId: account.school.id, sessionId: session.id,
            attendanceDate: today, checkInTime: now, status: evaluated.displayStatus, locationVerified: false,
          }).returning();
        res.json({ record });
        return;
      }
      if (!existing?.checkInTime) { fail(res, 409, "Check in before checking out."); return; }
      if (existing.checkOutTime) { fail(res, 409, "Already checked out for today."); return; }
      const now = new Date();
      const [record] = await db.update(teacherSelfAttendance).set({
        checkOutTime: now, totalWorkingMinutes: Math.max(0, Math.floor((now.getTime() - new Date(existing.checkInTime).getTime()) / 60000)),
        updatedAt: now,
      }).where(and(eq(teacherSelfAttendance.id, existing.id), eq(teacherSelfAttendance.teacherId, teacher.id),
        eq(teacherSelfAttendance.schoolId, account.school.id), eq(teacherSelfAttendance.sessionId, session.id))).returning();
      res.json({ record });
      return;
    }
    if (module === "attendance" && action === "submit") {
      const body = attendanceSchema.safeParse(req.body);
      if (!body.success) {
        fail(res, 400, "Invalid attendance details.");
        return;
      }
      if (!validDate(body.data.date)) { fail(res, 400, "Attendance date is invalid."); return; }
      const scope = await resolveScope(account, body.data.className, body.data.section);
      if (!scope) { fail(res, 403, "This class and section are not assigned to the teacher."); return; }
      if (body.data.date > todayInIST()) { fail(res, 400, "Attendance cannot be marked for a future date."); return; }
      const attendanceMinDate = new Date(`${todayInIST()}T00:00:00.000Z`);
      attendanceMinDate.setUTCDate(attendanceMinDate.getUTCDate() - 6);
      if (body.data.date < attendanceMinDate.toISOString().slice(0, 10)
        || !session.startDate || !session.endDate
        || body.data.date < session.startDate || body.data.date > session.endDate) {
        fail(res, 400, "Attendance date must be within the selected session and the recent seven-day marking window.");
        return;
      }
      if (await storage.getHolidayOnDate(account.school.id, body.data.date)) {
        fail(res, 400, "Attendance cannot be marked on a school holiday.");
        return;
      }
      const [roster, history] = await Promise.all([
        storage.getAttendanceRosterForSessionClass(account.school.id, session.id, scope.className, scope.section),
        storage.getAttendanceHistory(account.school.id, session.id, scope.className, scope.section, body.data.date, body.data.date),
      ]);
      const enrolled = new Set(roster.map((student) => student.id));
      if (body.data.records.some((entry) => !enrolled.has(entry.studentId))) {
        fail(res, 403, "Attendance includes a student outside the selected session roster.");
        return;
      }
      const identityByStudentId = new Map(roster.map((student) => [student.id, student.attendanceIdentityKey]));
      const editCountByIdentity = new Map(history.map((record) => [record.identityKey, record.editCount]));
      if (body.data.records.some((entry) => (editCountByIdentity.get(identityByStudentId.get(entry.studentId) ?? "") ?? 0) >= 3)) {
        fail(res, 409, "One or more students have reached the attendance edit limit for this date.");
        return;
      }
      const records = await storage.upsertAttendance(body.data.records.map((entry) => ({
        studentId: entry.studentId,
        teacherId: teacher.id,
        schoolId: account.school.id,
        sessionId: session.id,
        date: body.data.date,
        status: entry.status,
        markedBy: `${teacher.fullName} at ${formatDateTimeIST(new Date())}`,
        class: scope.className,
        section: scope.section,
        academicYear: (() => {
          const [startYear, endYear] = getAcademicYearForISTDate(body.data.date).split("-");
          return `${startYear}-${endYear.slice(-2)}`;
        })(),
      })));
      res.json({ records });
      return;
    }
    if (module === "homework" && action === "create") {
      const body = homeworkSchema.safeParse(req.body);
      if (!body.success) { fail(res, 400, body.error.issues[0]?.message ?? "Invalid homework details."); return; }
      const scope = await resolveScope(account, body.data.className, body.data.section);
      if (!scope) { fail(res, 403, "This class and section are not assigned to the teacher."); return; }
      if (!isAssignedSubject(scopes, scope.className, scope.section, body.data.subject)) {
        fail(res, 403, "This subject is not assigned to the teacher for this class.");
        return;
      }
      if (body.data.dueDate && (!validDate(body.data.dueDate) || body.data.dueDate < todayInIST())) {
        fail(res, 400, "Due date must be a valid date today or later.");
        return;
      }
      const fileUrl = await validatePrivateUpload(req, module);
      const item = await storage.createHomework({
        teacherId: teacher.id, schoolId: account.school.id, class: scope.className,
        section: scope.section, subject: body.data.subject, content: body.data.content,
        dueDate: body.data.dueDate ?? null, fileUrl, sessionId: session.id,
      });
      if (fileUrl) (req as MobileTeacherRequest).teacherUploadRetained = true;
      res.json({ item });
      return;
    }
    if (module === "classwork" && action === "create") {
      const body = classworkSchema.safeParse(req.body);
      if (!body.success) { fail(res, 400, body.error.issues[0]?.message ?? "Invalid classwork details."); return; }
      const scope = await resolveScope(account, body.data.className, body.data.section);
      if (!scope) { fail(res, 403, "This class and section are not assigned to the teacher."); return; }
      if (!isAssignedSubject(scopes, scope.className, scope.section, body.data.subject)) {
        fail(res, 403, "This subject is not assigned to the teacher for this class.");
        return;
      }
      const fileUrl = await validatePrivateUpload(req, module);
      const item = await storage.createClasswork({
        teacherId: teacher.id, schoolId: account.school.id, class: scope.className,
        section: scope.section, subject: body.data.subject, content: body.data.content,
        fileUrl, sessionId: session.id,
      });
      if (fileUrl) (req as MobileTeacherRequest).teacherUploadRetained = true;
      res.json({ item });
      return;
    }
    if ((module === "homework" || module === "classwork") && action === "edit") {
      const body = z.object({
        itemId: z.coerce.number().int().positive(),
        content: z.string().trim().min(1).max(20000).optional(),
        subject: z.string().trim().min(1).max(100).optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        removeAttachment: z.preprocess((value) => value === true || value === "true", z.boolean()).optional(),
      }).strict().safeParse(req.body);
      if (!body.success || (!body.data.content && !body.data.subject && body.data.dueDate === undefined && !body.data.removeAttachment && !(req as MobileTeacherRequest).file)) {
        fail(res, 400, "Provide at least one change to the assignment.");
        return;
      }
      const fileUrl = await validatePrivateUpload(req, module);
      if (module === "homework") {
        const item = await storage.getHomeworkById(body.data.itemId);
        if (!item || item.schoolId !== account.school.id || item.sessionId !== session.id || item.teacherId !== teacher.id
          || !await resolveScope(account, item.class, item.section)
          || !isAssignedSubject(scopes, item.class, item.section, body.data.subject ?? item.subject)) {
          fail(res, 403, "This homework is not editable by this teacher in the selected session.");
          return;
        }
        if (body.data.dueDate && (!validDate(body.data.dueDate) || body.data.dueDate < todayInIST())) {
          fail(res, 400, "Due date must be a valid date today or later.");
          return;
        }
        const updated = await storage.updateHomework(item.id, account.school.id, {
          content: body.data.content ?? item.content,
          subject: body.data.subject ?? item.subject,
          dueDate: body.data.dueDate === undefined ? item.dueDate : body.data.dueDate,
          fileUrl: fileUrl ?? (body.data.removeAttachment ? null : item.fileUrl),
        });
        if (fileUrl) (req as MobileTeacherRequest).teacherUploadRetained = true;
        if (updated.fileUrl !== item.fileUrl) await removePrivateFileUrl(item.fileUrl, module);
        res.json({ item: updated });
      } else {
        const item = await storage.getClassworkById(body.data.itemId);
        if (!item || item.schoolId !== account.school.id || item.sessionId !== session.id || item.teacherId !== teacher.id
          || !await resolveScope(account, item.class, item.section)
          || !isAssignedSubject(scopes, item.class, item.section, body.data.subject ?? item.subject)) {
          fail(res, 403, "This classwork is not editable by this teacher in the selected session.");
          return;
        }
        const updated = await storage.updateClasswork(item.id, account.school.id, {
          content: body.data.content ?? item.content,
          subject: body.data.subject ?? item.subject,
          fileUrl: fileUrl ?? (body.data.removeAttachment ? null : item.fileUrl),
        });
        if (fileUrl) (req as MobileTeacherRequest).teacherUploadRetained = true;
        if (updated.fileUrl !== item.fileUrl) await removePrivateFileUrl(item.fileUrl, module);
        res.json({ item: updated });
      }
      return;
    }
    if ((module === "homework" || module === "classwork") && action === "delete") {
      const body = z.object({ itemId: z.coerce.number().int().positive() }).strict().safeParse(req.body);
      if (!body.success) { fail(res, 400, "Invalid assignment."); return; }
      if (module === "homework") {
        const item = await storage.getHomeworkById(body.data.itemId);
        if (!item || item.schoolId !== account.school.id || item.sessionId !== session.id || item.teacherId !== teacher.id
          || !await resolveScope(account, item.class, item.section)) {
          fail(res, 403, "This homework is not editable by this teacher in the selected session.");
          return;
        }
        await storage.deleteHomework(item.id, account.school.id);
        await removePrivateFileUrl(item.fileUrl, module);
      } else {
        const item = await storage.getClassworkById(body.data.itemId);
        if (!item || item.schoolId !== account.school.id || item.sessionId !== session.id || item.teacherId !== teacher.id
          || !await resolveScope(account, item.class, item.section)) {
          fail(res, 403, "This classwork is not editable by this teacher in the selected session.");
          return;
        }
        await storage.deleteClasswork(item.id, account.school.id);
        await removePrivateFileUrl(item.fileUrl, module);
      }
      res.json({ deleted: true });
      return;
    }
    if (module === "gallery" && action === "upload") {
      const body = z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(20000).optional(),
        eventTag: z.string().trim().max(200).optional(),
        capturedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        capturedTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        location: z.string().trim().max(200).optional(),
      }).strict().safeParse(req.body);
      if (!body.success || !(req as MobileTeacherRequest).file) {
        fail(res, 400, "A title and image file are required.");
        return;
      }
      const imageUrl = await validatePrivateUpload(req, module);
      if (!imageUrl) { fail(res, 400, "An image file is required."); return; }
      if (body.data.capturedDate && !validDate(body.data.capturedDate)) {
        fail(res, 400, "Captured date is invalid.");
        return;
      }
      const item = await storage.createGalleryItem({
        schoolId: account.school.id, uploadedById: teacher.id, uploaderRole: "teacher",
        title: body.data.title, description: body.data.description || null,
        eventTag: body.data.eventTag || null, capturedDate: body.data.capturedDate || null,
        capturedTime: body.data.capturedTime || null, location: body.data.location || null,
        imageUrl, approved: false,
      });
      (req as MobileTeacherRequest).teacherUploadRetained = true;
      res.json({ item });
      return;
    }
    if (module === "library" && action === "upload-ebook") {
      const body = z.object({
        title: z.string().trim().min(1).max(300),
        author: z.string().trim().min(1).max(300),
        targetClass: z.string().trim().max(20).optional(),
        category: z.string().trim().max(100).optional(),
      }).strict().safeParse(req.body);
      if (!body.success || !(req as MobileTeacherRequest).file) {
        fail(res, 400, "An e-book title, author, and PDF file are required.");
        return;
      }
      if (body.data.targetClass && !scopes.some((scope) => scope.className === body.data.targetClass)) {
        fail(res, 403, "E-book class visibility must be limited to a class assigned to the teacher.");
        return;
      }
      const fileUrl = await validatePrivateUpload(req, module);
      if (!fileUrl) { fail(res, 400, "A PDF file is required."); return; }
      const item = await storage.createLibraryBook({
        schoolId: account.school.id, title: body.data.title, author: body.data.author,
        isbn: null, targetClass: body.data.targetClass || null, category: body.data.category || null,
        fileUrl, fileType: "pdf", uploadedById: teacher.id, verificationStatus: "pending",
        totalCopies: 0, availableCopies: 0,
      });
      try {
        await storage.createAuditLog({
          schoolId: account.school.id, actionType: "upload", entityType: "ebook",
          entityId: item.id, actionBy: teacher.id, actionByRole: "teacher",
          details: `Uploaded e-book: ${item.title} by ${item.author}`,
        });
      } catch (error) {
        await storage.deleteLibraryBook(item.id);
        throw error;
      }
      (req as MobileTeacherRequest).teacherUploadRetained = true;
      res.json({ item });
      return;
    }
    if (module === "examination" && action === "save-scores") {
      const body = z.object({
        className: z.string().trim().min(1).max(20),
        section: z.string().trim().min(1).max(10),
        subject: z.string().trim().min(1).max(100),
        examType: z.string().trim().min(1).max(100),
        totalMarks: z.number().int().positive().max(100000),
        scores: z.array(z.object({
          studentId: z.number().int().positive(),
          marks: z.number().int().min(0).max(100000),
          isAbsent: z.boolean(),
        }).strict()).min(1).max(500),
      }).strict().safeParse(req.body);
      if (!body.success) { fail(res, 400, "Invalid examination score details."); return; }
      const { className, section, subject, examType, totalMarks } = body.data;
      const scope = await resolveScope(account, className, section);
      if (!scope) { fail(res, 403, "This class and section are not assigned to the teacher."); return; }
      if (!isAssignedSubject(scopes, className, section, subject)) {
        fail(res, 403, "This subject is not assigned to the teacher for this class.");
        return;
      }
      const examTypes = await storage.getClassExamTypesMap(account.school.id);
      if (!(examTypes[className] ?? []).includes(examType)) {
        fail(res, 403, "This examination is not configured for the selected class.");
        return;
      }
      if (body.data.scores.some((score) => !score.isAbsent && score.marks > totalMarks)) {
        fail(res, 400, "Marks cannot exceed the total marks.");
        return;
      }
      const roster = await storage.getAttendanceRosterForSessionClass(account.school.id, session.id, className, section);
      const enrolledIds = new Set(roster.map((student) => student.id));
      const submittedIds = body.data.scores.map((score) => score.studentId);
      if (new Set(submittedIds).size !== submittedIds.length || submittedIds.some((id) => !enrolledIds.has(id))) {
        fail(res, 403, "Scores include a duplicate or a student outside the selected session roster.");
        return;
      }
      const passPolicy = await storage.resolveClassPassPolicy(account.school.id, className);
      if (!passPolicy) { fail(res, 404, `No grading tier configured for class ${className}.`); return; }
      const passMarks = Math.ceil(totalMarks * passPolicy.passPercentage / 100);
      const saved = await storage.upsertExamScores(body.data.scores.map((score) => ({
        studentId: score.studentId,
        teacherId: teacher.id,
        schoolId: account.school.id,
        subject,
        examType,
        marks: score.isAbsent ? 0 : score.marks,
        totalMarks,
        passMarks,
        isAbsent: score.isAbsent,
        class: className,
        section,
        updatedBy: teacher.fullName,
        sessionId: session.id,
      })));
      res.json({ message: `Saved ${saved.length} scores`, count: saved.length });
      return;
    }
    if (module === "examination" && action === "publish-scores") {
      const body = z.object({
        className: z.string().trim().min(1).max(20),
        section: z.string().trim().min(1).max(10),
        examType: z.string().trim().min(1).max(100),
      }).strict().safeParse(req.body);
      if (!body.success) { fail(res, 400, "Invalid examination publication details."); return; }
      const { className, section, examType } = body.data;
      if (!await resolveScope(account, className, section)) {
        fail(res, 403, "This class and section are not assigned to the teacher.");
        return;
      }
      const examTypes = await storage.getClassExamTypesMap(account.school.id);
      if (!(examTypes[className] ?? []).includes(examType)) {
        fail(res, 403, "This examination is not configured for the selected class.");
        return;
      }
      const count = await storage.publishExamScores(account.school.id, className, section, examType, session.id);
      res.json({ message: `Published ${count} scores`, count });
      return;
    }
    if (module === "complaint" && action === "resolve-peer") {
      const body = z.object({
        complaintId: z.number().int().positive(),
        resolutionRemarks: z.string().trim().min(1).max(5000),
      }).strict().safeParse(req.body);
      if (!body.success) { fail(res, 400, "Resolution remarks are required."); return; }
      const item = await storage.getComplaintByIdForSchool(body.data.complaintId, account.school.id);
      if (!item || item.sessionId !== session.id || item.complaintType !== "student-peer-report" || !item.studentId) {
        fail(res, 404, "Assigned-class complaint was not found in the selected session.");
        return;
      }
      const student = await storage.getStudentById(item.studentId);
      if (!student || student.schoolId !== account.school.id || !scopes.some((scope) =>
        scope.className === student.class && scope.section === student.section,
      )) {
        fail(res, 403, "This complaint's student is outside the teacher's assigned classes.");
        return;
      }
      if (item.status === "Resolved") { fail(res, 409, "This complaint is already resolved."); return; }
      const updated = await storage.resolveComplaint(item.id, account.school.id, body.data.resolutionRemarks);
      if (!updated) { fail(res, 404, "Complaint not found."); return; }
      res.json({ item: updated });
      return;
    }
    if (module === "library" && action === "borrow") {
      const body = z.object({ bookId: z.number().int().positive() }).strict().safeParse(req.body);
      if (!body.success) { fail(res, 400, "Invalid book selection."); return; }
      const book = await storage.getLibraryBookById(body.data.bookId);
      if (!book || book.schoolId !== account.school.id || book.verificationStatus !== "approved"
        || (book.targetClass && !scopes.some((scope) => scope.className === book.targetClass))) {
        fail(res, 403, "This book is not available to this teacher.");
        return;
      }
      const borrow = await storage.borrowBook(book.id, teacher.id, "teacher", account.school.id);
      if (!borrow) { fail(res, 409, "No copies of this book are currently available."); return; }
      res.json({ item: borrow });
      return;
    }
    if (module === "library" && action === "return") {
      const body = z.object({ borrowId: z.number().int().positive() }).strict().safeParse(req.body);
      if (!body.success) { fail(res, 400, "Invalid borrowed book."); return; }
      const mine = await storage.getMyBorrowedBooks(teacher.id, "teacher");
      const borrow = mine.find((entry) => entry.id === body.data.borrowId && entry.returnedAt == null);
      if (!borrow) { fail(res, 403, "This borrowed book does not belong to this teacher or is already returned."); return; }
      await storage.returnBook(borrow.id);
      res.json({ returned: true });
      return;
    }
    if (module === "complaint" && ["add-note", "edit", "delete", "self-resolve"].includes(action)) {
      const body = z.object({
        complaintId: z.number().int().positive(),
        content: z.string().trim().min(1).max(20000).optional(),
      }).strict().safeParse(req.body);
      if (!body.success) { fail(res, 400, "Invalid complaint action."); return; }
      const item = await storage.getComplaintByIdForSchool(body.data.complaintId, account.school.id);
      if (!item || item.sessionId !== session.id) {
        fail(res, 404, "Complaint does not belong to the selected session and school.");
        return;
      }
      if (item.teacherId !== teacher.id || item.isDeleted
        || !["teacher-to-admin", "teacher-to-student"].includes(item.complaintType)) {
        fail(res, 403, "This complaint is not available to this teacher.");
        return;
      }
      if (action === "add-note") {
        if (!body.data.content) { fail(res, 400, "A complaint update is required."); return; }
        const note = await storage.addComplaintNote({
          complaintId: item.id, authorId: teacher.id, authorRole: "teacher",
          authorName: teacher.fullName || "Teacher", content: body.data.content,
        });
        res.json({ item: note });
        return;
      }
      if (action === "edit") {
        if (item.status !== "Pending") { fail(res, 409, "Only pending complaints can be edited."); return; }
        if (!body.data.content) { fail(res, 400, "Complaint details are required."); return; }
        const updated = await storage.updateComplaint(item.id, account.school.id, { content: body.data.content });
        res.json({ item: updated });
        return;
      }
      if (action === "delete") {
        if (item.status !== "Pending") { fail(res, 409, "Only pending complaints can be deleted."); return; }
        await storage.softDeleteComplaint(item.id, account.school.id);
        res.json({ deleted: true });
        return;
      }
      if (item.complaintType !== "teacher-to-student") {
        fail(res, 403, "Only teacher-to-student complaints can be self-resolved.");
        return;
      }
      if (item.status === "Resolved") { fail(res, 409, "This complaint is already resolved."); return; }
      const updated = await storage.resolveComplaint(item.id, account.school.id, null);
      if (!updated) { fail(res, 404, "Complaint not found."); return; }
      res.json({ item: updated });
      return;
    }
    if (module === "noticeboard" && action === "create") {
      const body = noticeSchema.safeParse(req.body);
      if (!body.success) { fail(res, 400, body.error.issues[0]?.message ?? "Invalid notice details."); return; }
      if (body.data.className || body.data.section) {
        if (!body.data.className || !body.data.section
          || !await resolveScope(account, body.data.className, body.data.section)) {
          fail(res, 403, "Choose a class and section assigned to the teacher.");
          return;
        }
      }
      const item = await storage.createNotice({
        schoolId: account.school.id, createdById: teacher.id, creatorRole: "teacher",
        targetType: body.data.targetType,
        targetClass: body.data.targetType === "student" ? body.data.className ?? null : null,
        targetSection: body.data.targetType === "student" ? body.data.section ?? null : null,
        targetTeacherId: null, noticeType: body.data.noticeType, content: body.data.content,
         fileUrl: await validatePrivateUpload(req, module), sessionId: session.id,
      });
      if ((req as MobileTeacherRequest).file) (req as MobileTeacherRequest).teacherUploadRetained = true;
      res.json({ item });
      return;
    }
    if (module === "noticeboard" && (action === "edit" || action === "delete")) {
      const body = z.object({
        noticeId: z.coerce.number().int().positive(),
        content: z.string().trim().min(1).max(20000).optional(),
      }).strict().safeParse(req.body);
      if (!body.success || (action === "edit" && !body.data.content)) {
        fail(res, 400, "A notice id and valid content are required.");
        return;
      }
      const notice = await storage.getNoticeById(body.data.noticeId);
      if (!notice || notice.schoolId !== account.school.id || notice.sessionId !== session.id
        || notice.createdById !== teacher.id || notice.creatorRole !== "teacher") {
        fail(res, 403, "Only your notice in the selected academic session can be changed.");
        return;
      }
      if (action === "delete") {
        await storage.deleteNotice(notice.id, account.school.id);
        res.json({ deleted: true });
      } else {
        const updated = await storage.updateNotice(notice.id, account.school.id, body.data.content!);
        res.json({ item: updated });
      }
      return;
    }
    if (module === "complaint" && action === "create") {
      const body = complaintSchema.safeParse(req.body);
      if (!body.success) { fail(res, 400, body.error.issues[0]?.message ?? "Invalid complaint details."); return; }
      let item;
      if (body.data.complaintType === "teacher-to-student") {
        if (!body.data.studentId) { fail(res, 400, "Choose an assigned student for this complaint."); return; }
        const requestedScopes = scopes.filter((scope) => !body.data.className
          || (scope.className === body.data.className && scope.section === body.data.section));
        if (!requestedScopes.length) { fail(res, 403, "This class and section are not assigned to the teacher."); return; }
        const rosters = await Promise.all(requestedScopes.map((scope) =>
          storage.getAttendanceRosterForSessionClass(account.school.id, session.id, scope.className, scope.section),
        ));
        const student = rosters.flat().find((candidate) => candidate.id === body.data.studentId);
        if (!student) { fail(res, 403, "This Student is not enrolled in the teacher's selected session assignments."); return; }
        const ticketId = await storage.getNextTicketId(account.school.id);
        item = await storage.createComplaintWithStudents({
          ticketId, teacherId: teacher.id, studentId: null, schoolId: account.school.id,
          complaintType: body.data.complaintType, status: "Pending", content: body.data.content,
           reportedStudentName: student.name, fileUrl: await validatePrivateUpload(req, module), escalatedToPrincipal: false,
          notifyAdmin: false, sessionId: session.id,
        }, [student.id]);
      } else {
        const ticketId = await storage.getNextTicketId(account.school.id);
        item = await storage.createComplaint({
          ticketId, teacherId: teacher.id, studentId: null, schoolId: account.school.id,
          complaintType: body.data.complaintType, status: "Pending", content: body.data.content,
           reportedStudentName: null, fileUrl: await validatePrivateUpload(req, module), isDeleted: false,
          escalatedToPrincipal: false, notifyAdmin: false,
          incidentDate: body.data.incidentDate ? new Date(body.data.incidentDate) : null,
          sessionId: session.id,
        });
      }
      if ((req as MobileTeacherRequest).file) (req as MobileTeacherRequest).teacherUploadRetained = true;
      res.json({ item });
      return;
    }
    if (module === "leave" && action === "apply") {
      const body = leaveSchema.safeParse(req.body);
      if (!body.success) { fail(res, 400, body.error.issues[0]?.message ?? "Invalid leave request."); return; }
      const policies = await storage.getActiveLeavePoliciesBySchool(account.school.id, "teacher");
      const policy = policies.find((candidate) => candidate.id === body.data.policyId);
      if (!policy || policy.name.toLowerCase() !== body.data.leaveType.toLowerCase()) {
        fail(res, 403, "Choose an active leave policy available to this account.");
        return;
      }
      if (!validDate(body.data.startDate) || !validDate(body.data.endDate)
        || body.data.endDate < body.data.startDate) {
        fail(res, 400, "Leave dates are invalid.");
        return;
      }
      const dateDifference = calendarDayDifference(body.data.startDate, body.data.endDate);
      if (dateDifference == null) { fail(res, 400, "Leave dates are invalid."); return; }
      const daysRequested = dateDifference + 1;
      const balances = await storage.getTeacherLeaveBalanceByPolicies(teacher.id, account.school.id);
      const remaining = balances.find((balance) => balance.policyId === policy.id);
      if (remaining && remaining.remaining < daysRequested) {
        fail(res, 400, `Insufficient ${policy.name} balance. ${remaining.remaining} day(s) remain.`);
        return;
      }
      const item = await storage.createLeaveRequest({
        teacherId: teacher.id, schoolId: account.school.id,
        policyId: policy.id, leaveType: policy.name,
        startDate: body.data.startDate, endDate: body.data.endDate,
        reason: body.data.reason, status: "pending", approvedBy: null, sessionId: session.id,
      });
      res.json({ item });
      return;
    }
    if (module === "leave" && ["approve-student", "forward-student", "reject-student"].includes(action)) {
      const body = studentLeaveReviewSchema.safeParse(req.body);
      if (!body.success) { fail(res, 400, "Invalid student leave review."); return; }
      const leave = await storage.getStudentLeaveById(body.data.leaveId, account.school.id);
      if (!leave || leave.sessionId !== session.id) {
        fail(res, 403, "Student leave request does not belong to the selected session and school.");
        return;
      }
      if (leave.status !== "pending_teacher") {
        fail(res, 409, "This Student leave request is no longer awaiting teacher review.");
        return;
      }
      const student = await storage.getStudentById(leave.studentId);
      if (!student || student.schoolId !== account.school.id || !scopes.some((scope) =>
        scope.className === student.class && scope.section === student.section,
      )) {
        fail(res, 403, "This Student is not in the teacher's assigned classes.");
        return;
      }
      let updated;
      if (action === "approve-student") {
        try {
          updated = await storage.approveStudentLeaveWithAttendance({
            leaveId: leave.id, studentId: leave.studentId, teacherId: teacher.id,
            schoolId: account.school.id, sessionId: session.id,
            expectedStatus: "pending_teacher", reviewedBy: teacher.id, reviewerRole: "teacher",
            teacherComment: body.data.note || undefined,
          });
        } catch (error) {
          if (error instanceof AttendanceLeaveMutationError) {
            fail(res, error.status, error.message);
            return;
          }
          throw error;
        }
        if (!updated) { fail(res, 409, "Student leave is no longer pending teacher approval."); return; }
        await storage.createAuditLog({
          schoolId: account.school.id, actionType: "approve", entityType: "student_leave",
          entityId: leave.id, actionBy: teacher.id, actionByRole: "teacher",
          details: `Approved student leave and synced attendance for dates ${leave.startDate} to ${leave.endDate}`,
        });
      } else if (action === "forward-student") {
        updated = await storage.updateStudentLeaveStatus(
          leave.id, account.school.id, "forwarded_to_admin", teacher.id, "teacher",
          undefined, undefined, body.data.note || undefined,
        );
        if (!updated) { fail(res, 404, "Student leave request not found."); return; }
        await storage.createAuditLog({
          schoolId: account.school.id, actionType: "forward", entityType: "student_leave",
          entityId: leave.id, actionBy: teacher.id, actionByRole: "teacher",
          details: "Forwarded student leave to principal for final approval",
        });
      } else {
        updated = await storage.updateStudentLeaveStatus(
          leave.id, account.school.id, "rejected", teacher.id, "teacher", body.data.note || undefined,
        );
        if (!updated) { fail(res, 404, "Student leave request not found."); return; }
        await storage.createAuditLog({
          schoolId: account.school.id, actionType: "reject", entityType: "student_leave",
          entityId: leave.id, actionBy: teacher.id, actionByRole: "teacher",
          details: `Teacher rejected student leave${body.data.note ? `: ${body.data.note}` : ""}`,
        });
      }
      res.json({ item: updated });
      return;
    }
    if (module === "student-profiles" && (action === "approve" || action === "reject")) {
      const body = profileReviewSchema.safeParse(req.body);
      if (!body.success) { fail(res, 400, "Invalid profile review."); return; }
      const pending = await storage.getPendingProfilesForTeacher(account.school.id, teacher.id, undefined, session.id);
      if (!pending.some((profile) => profile.studentId === body.data.studentId)) {
        fail(res, 403, "This Student profile is not assigned for review.");
        return;
      }
      if (action === "approve") {
        const corrections = body.data.corrections ?? {};
        const allowed = new Set(["fullName", "rollNo", "fatherName", "motherName", "guardianName",
          "presentAddress", "aadharNumber", "gender", "phone", "email", "dob", "enrollmentDate",
          "bloodGroup", "class", "section"]);
        if (Object.keys(corrections).some((key) => !allowed.has(key))) {
          fail(res, 400, "Profile correction contains an unsupported field.");
          return;
        }
        const pendingProfile = pending.find((profile) => profile.studentId === body.data.studentId)!;
        const correctedClass = corrections.class ?? pendingProfile.class;
        const correctedSection = corrections.section ?? pendingProfile.section;
        if (!await resolveScope(account, correctedClass, correctedSection)) {
          fail(res, 403, "Corrected class and section must remain assigned to this teacher.");
          return;
        }
        if (Object.keys(corrections).length) {
          await db.update(studentProfiles).set(corrections).where(and(
            eq(studentProfiles.studentId, body.data.studentId),
            eq(studentProfiles.schoolId, account.school.id),
            eq(studentProfiles.status, "pending"),
          ));
        }
        res.json({ item: await storage.approveStudentProfile(body.data.studentId, teacher.id) });
      } else {
        res.json({ item: await storage.rejectStudentProfile(body.data.studentId, teacher.id, body.data.note ?? "Returned for correction.") });
      }
      return;
    }
    if (module === "student-profiles" && action === "approve-all") {
      const pending = await storage.getPendingProfilesForTeacher(account.school.id, teacher.id, undefined, session.id);
      if (!pending.length) { res.json({ approved: 0, skipped: 0 }); return; }
      const result = await storage.bulkApproveStudentProfiles(
        pending.map((profile) => profile.studentId), teacher.id,
      );
      res.json(result);
      return;
    }
    if (module === "examination" && action === "toggle-promotion-lock") {
      const body = z.object({
        className: z.string().trim().min(1).max(20),
        section: z.string().trim().min(1).max(10),
        term: z.string().trim().min(1).max(100),
        locked: z.boolean(),
      }).strict().safeParse(req.body);
      if (!body.success) { fail(res, 400, "Invalid promotion-ledger lock request."); return; }
      const { className, section, term, locked } = body.data;
      if (!await resolveScope(account, className, section)) {
        fail(res, 403, "This class and section are not assigned to the teacher.");
        return;
      }
      const tiers = await storage.getExamPolicyTiers(account.school.id);
      const policy = tiers.find((tier) =>
        (tier.applicableClasses ?? []).map((name) => String(name).trim()).includes(className),
      );
      let terms: string[] = [];
      try { terms = Object.keys(JSON.parse(policy?.examWeights ?? "{}")).map((value) => value.trim()); }
      catch { terms = []; }
      if (!terms.includes(term)) { fail(res, 403, "This Results term is not configured for the selected class."); return; }
      const entries = await storage.getPromotionDecisions(account.school.id, className, section, term, session.id);
      if (!entries.length) { fail(res, 409, "There are no saved promotion decisions to lock or unlock."); return; }
      const roster = await storage.getAttendanceRosterForSessionClass(account.school.id, session.id, className, section);
      const rosterIds = new Set(roster.map((student) => student.id));
      if (entries.some((entry) => !rosterIds.has(entry.studentId))) {
        fail(res, 409, "The saved promotion ledger contains a student outside this session roster; it was not changed.");
        return;
      }
      const updated = await db.update(promotionDecisions)
        .set({ locked, lockedAt: locked ? new Date() : null, updatedAt: new Date() })
        .where(and(
          eq(promotionDecisions.schoolId, account.school.id),
          eq(promotionDecisions.class, className),
          eq(promotionDecisions.section, section),
          eq(promotionDecisions.term, term),
          eq(promotionDecisions.sessionId, session.id),
        ))
        .returning({ id: promotionDecisions.id });
      if (!updated.length) { fail(res, 409, "No promotion decisions for this session were changed."); return; }
      res.json({ locked, count: updated.length });
      return;
    }
    fail(res, 404, "This action is not available.");
  } catch (error) {
    if (error instanceof PrivateUploadValidationError) {
      fail(res, 400, error.message);
      return;
    }
    fail(res, 503, "Unable to save teacher module changes.");
  }
}

async function getPrivateFile(req: Request, res: Response): Promise<void> {
  const params = z.object({ module: z.string().refine((value) => ["homework", "classwork", "gallery", "library", "noticeboard", "complaint"].includes(value)),
    filename: z.string().regex(privateFilenamePattern) }).safeParse(req.params);
  if (!params.success) { fail(res, 404, "Private attachment not found."); return; }
  const context = getContext(req, res);
  if (!context) return;
  const { account, scopes, session } = context;
  const expectedUrl = `${privateFileUrlPrefix}${params.data.module}/private-files/${params.data.filename}`;
  let authorized = false;
  try {
    if (params.data.module === "homework") {
      const [item] = await db.select().from(homework).where(and(
        eq(homework.fileUrl, expectedUrl),
        eq(homework.schoolId, account.school.id),
        eq(homework.sessionId, session.id),
      )).limit(1);
      authorized = !!item && (item.teacherId === context.account.teacher.id
        || scopes.some((scope) => scope.className === item.class && scope.section === item.section));
    } else if (params.data.module === "classwork") {
      const [item] = await db.select().from(classwork).where(and(
        eq(classwork.fileUrl, expectedUrl),
        eq(classwork.schoolId, account.school.id),
        eq(classwork.sessionId, session.id),
      )).limit(1);
      authorized = !!item && (item.teacherId === context.account.teacher.id
        || scopes.some((scope) => scope.className === item.class && scope.section === item.section));
    } else if (params.data.module === "complaint") {
      const complaints = await storage.getComplaintsByTeacher(context.account.teacher.id, context.account.teacher.assignedClass,
        context.account.teacher.assignedSection, account.school.id, session.id);
      const classFeed = await storage.getClassFeedComplaints(account.school.id,
        scopes.map(({ className, section }) => ({ className, section })), undefined, undefined, session.id);
      authorized = complaints.some((item) => item.fileUrl === expectedUrl && item.teacherId === context.account.teacher.id)
        || classFeed.some((item) => item.fileUrl === expectedUrl && item.schoolId === account.school.id && item.status !== "Deleted");
    } else if (params.data.module === "noticeboard") {
      const notices = await storage.getNoticesByTeacher(context.account.teacher.id, 500);
      authorized = notices.some((item) => item.fileUrl === expectedUrl && item.schoolId === account.school.id
        && item.sessionId === session.id && item.createdById === context.account.teacher.id && item.creatorRole === "teacher");
    } else if (params.data.module === "gallery") {
      const items = await storage.getGalleryItems(account.school.id, false);
      authorized = items.some((item) => item.imageUrl === expectedUrl && item.schoolId === account.school.id
        && (item.approved || (item.uploadedById === context.account.teacher.id && item.uploaderRole === "teacher")));
    } else {
      const books = await storage.getLibraryBooks(account.school.id);
      authorized = books.some((book) => book.fileUrl === expectedUrl && book.schoolId === account.school.id
        && (book.uploadedById === context.account.teacher.id
          || (book.verificationStatus === "approved"
            && (!book.targetClass || scopes.some((scope) => scope.className === book.targetClass)))));
    }
    if (!authorized) { fail(res, 403, "You are not authorized to access this private attachment."); return; }
    if (req.query.check === "1") { res.json({ authorized: true }); return; }
    const extension = path.extname(params.data.filename).slice(1).toLowerCase();
    res.set({
      "Content-Type": privateDownloadMimeTypes[extension],
      "Content-Disposition": `attachment; filename="teacher-file.${extension}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.sendFile(params.data.filename, { root: privateUploadDirectory }, (error) => {
      if (error && !res.headersSent) fail(res, 404, "Private attachment file was not found.");
    });
  } catch {
    fail(res, 503, "Unable to authorize private attachment access.");
  }
}

export function registerMobileTeacherModuleRoutes(
  app: Express,
  requireHttps: RequestHandler,
  requireBearer: RequestHandler,
  requireAcademicSession: RequestHandler,
): void {
  const middleware = withModuleContext(requireHttps, requireBearer, requireAcademicSession);
  app.get("/api/mobile/teacher/modules/:module", ...middleware, (req, res) => { void getModuleData(req, res); });
  app.get("/api/mobile/teacher/modules/:module/private-files/:filename", ...middleware, (req, res) => { void getPrivateFile(req, res); });
  app.post("/api/mobile/teacher/modules/:module/:action", ...middleware, attachPrivateUpload, (req, res) => { void postModuleAction(req, res); });
}