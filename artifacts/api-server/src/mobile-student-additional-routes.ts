import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import type { AcademicSession } from "@workspace/db";
import { sql } from "drizzle-orm";
import { todayInIST } from "@shared/ist-time";
import { db } from "./db";
import { storage } from "./storage";

type StudentPrincipal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
};

type MobileStudentRequest = Request & {
  mobileAuth?: { principal: StudentPrincipal };
  mobileAcademicSession?: AcademicSession;
};

type StudentRecord = NonNullable<Awaited<ReturnType<typeof storage.getStudentWithSchool>>>["student"];
type StudentCohort = { class: string; section: string };

const LEAVE_CATEGORIES = new Set([
  "Medical Leave",
  "Family Emergency",
  "Personal Reasons",
  "Academic Event",
  "Sports / Co-curricular",
  "Other",
]);
const MAX_LEAVE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const PRIVATE_LEAVE_DIRECTORY = path.join(process.cwd(), "private-data", "student-leave");
const PRIVATE_LEAVE_FILE_PREFIX = "/api/mobile/student/leave-files/";
const PRIVATE_LEAVE_FILE_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|jpeg|png|gif|webp|pdf|doc|docx)$/;
const LEAVE_ATTACHMENT_MIMES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const leaveUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LEAVE_ATTACHMENT_BYTES, files: 1, fields: 8, parts: 9, fieldSize: 64 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase().slice(1);
    const expected = LEAVE_ATTACHMENT_MIMES[extension];
    if (!expected || file.mimetype !== expected) {
      callback(new Error("Choose a JPG, PNG, GIF, WebP, PDF, DOC, or DOCX attachment."));
      return;
    }
    callback(null, true);
  },
});

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

function studentOnly(req: Request, res: Response, next: NextFunction): void {
  if ((req as MobileStudentRequest).mobileAuth?.principal.role !== "student") {
    fail(res, 403, "Student access is required.");
    return;
  }
  next();
}

function selectedSession(req: Request): AcademicSession | null {
  return (req as MobileStudentRequest).mobileAcademicSession ?? null;
}

async function resolveStudent(req: Request, res: Response): Promise<StudentRecord | null> {
  const principal = (req as MobileStudentRequest).mobileAuth?.principal;
  if (!principal || principal.role !== "student" || principal.entityId === null
    || principal.id !== principal.principalId || principal.id !== principal.entityId) {
    fail(res, 403, "Student access is required.");
    return null;
  }
  const data = await storage.getStudentWithSchool(principal.id);
  if (!data || data.student.id !== principal.id || data.student.schoolId !== principal.schoolId
    || data.school.id !== principal.schoolId || !data.student.isActive || !data.student.isActivated) {
    fail(res, 401, "Student account is no longer authorized.");
    return null;
  }
  return data.student;
}

async function resolveSessionCohort(
  student: StudentRecord,
  session: AcademicSession,
): Promise<StudentCohort | null> {
  const historical = await storage.resolveAttendanceClassSectionForStudent(
    student.schoolId, session.id, student.id,
  );
  if (historical?.class && historical.section) return historical;

  // A current profile is not proof of membership in an archived session.
  if (session.isActive !== true) return null;
  const enrollment = await storage.resolveEnrollmentForStudentSession(
    student.schoolId, student.id, session.id,
  );
  if (!enrollment) return null;
  const cls = enrollment.className || student.class;
  const section = enrollment.sectionName || student.section;
  return cls && section ? { class: cls, section } : null;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function validIntegerParam(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function validLeaveAttachment(file: Express.Multer.File): Promise<boolean> {
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  const bytes = file.buffer;
  if (ext === "jpg" || ext === "jpeg") {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false;
  } else if (ext === "png") {
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return false;
  } else if (ext === "gif") {
    const signature = bytes.subarray(0, 6).toString("ascii");
    if (signature !== "GIF87a" && signature !== "GIF89a") return false;
  } else if (ext === "webp") {
    if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return false;
  } else if (ext === "pdf") {
    if (bytes.length < 8 || bytes.toString("ascii", 0, 5) !== "%PDF-" || !bytes.subarray(Math.max(0, bytes.length - 1024)).includes(Buffer.from("%%EOF"))) return false;
  } else if (ext === "doc") {
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return false;
  } else if (ext === "docx") {
    if (bytes.length < 4 || bytes.toString("ascii", 0, 4) !== "PK\u0003\u0004") return false;
  } else return false;

  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
    try {
      const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
      const expected = ext === "jpg" ? "jpeg" : ext;
      return metadata.format === expected && !!metadata.width && !!metadata.height;
    } catch { return false; }
  }
  return true;
}

async function sessionStudentContext(
  req: Request,
  res: Response,
): Promise<{ student: StudentRecord; session: AcademicSession; cohort: StudentCohort } | null> {
  const mobileReq = req as MobileStudentRequest;
  const session = selectedSession(req);
  if (!session || session.schoolId !== mobileReq.mobileAuth?.principal.schoolId) {
    fail(res, 403, "The selected academic session is not available.");
    return null;
  }
  const student = await resolveStudent(req, res);
  if (!student) return null;
  const cohort = await resolveSessionCohort(student, session);
  if (!cohort) {
    fail(res, 403, "The student is not enrolled in the selected academic session.");
    return null;
  }
  return { student, session, cohort };
}

function sendFailure(res: Response, message: string): void {
  if (!res.headersSent) fail(res, 503, message);
}

function parseLeaveAttachment(req: Request, res: Response, next: NextFunction): void {
  leaveUpload.single("file")(req, res, error => {
    if (error) {
      fail(res, 400, error.message || "Unable to read the leave attachment.");
      return;
    }
    next();
  });
}

/**
 * Session-sensitive Student portal routes intentionally keep the web
 * application's semantics while authenticating only the native bearer
 * principal. Calendar, faculty, gallery, and library are school-wide/global
 * data in the web source and therefore do not take an academic-session header.
 */
export function registerMobileStudentAdditionalRoutes(
  app: Express,
  requireHttps: RequestHandler,
  requireBearer: RequestHandler,
  requireAcademicSession: RequestHandler,
): void {
  const identityRoutes = [requireHttps, requireBearer, studentOnly] as const;
  const sessionRoutes = [...identityRoutes, requireAcademicSession] as const;

  app.get("/api/mobile/student/notices", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const notices = await storage.getStudentNotices(
        context.student.id, context.student.schoolId, context.cohort.class,
        context.cohort.section, context.session.id,
      );
      res.json(notices);
    } catch {
      sendFailure(res, "Unable to load Student notices.");
    }
  });

  app.post("/api/mobile/student/notices/mark-read", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      if (context.session.isActive !== true) {
        fail(res, 403, "Notices cannot be marked read in an archived academic session.");
        return;
      }
      const ids = req.body?.noticeIds;
      if (!Array.isArray(ids) || ids.length > 500
        || ids.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) <= 0)) {
        fail(res, 400, "noticeIds must be a list of positive notice IDs.");
        return;
      }
      const visible = await storage.getStudentNotices(
        context.student.id, context.student.schoolId, context.cohort.class,
        context.cohort.section, context.session.id,
      );
      const allowed = new Set(visible.map(notice => notice.id));
      if (ids.some((id: number) => !allowed.has(id))) {
        fail(res, 403, "One or more notices are not available to this Student.");
        return;
      }
      await storage.markNoticesRead(context.student.id, ids as number[]);
      res.json({ message: "Notices marked read." });
    } catch {
      sendFailure(res, "Unable to update Student notice status.");
    }
  });

  app.get("/api/mobile/student/fees", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const records = await storage.getFeeRecordsByStudent(
        context.student.id, context.student.schoolId, context.session.id,
      );
      res.json(records);
    } catch {
      sendFailure(res, "Unable to load Student fee records.");
    }
  });

  app.get("/api/mobile/student/fees/summary", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const today = todayInIST();
      const currentMonth = `${today.slice(0, 4)}-${today.slice(5, 7)}`;
      const sessionId = context.session.id;
      const outstandingRows = await db.execute(sql`
        SELECT fr.amount, fr.late_fee_amount, fr.due_date,
          GREATEST(fr.amount + fr.late_fee_amount - COALESCE(p.total_paid, 0), 0)::int AS net_balance
        FROM fee_records fr
        LEFT JOIN (
          SELECT fee_record_id, SUM(amount)::int AS total_paid
          FROM payment_records
          WHERE school_id = ${context.student.schoolId} AND fee_record_id IS NOT NULL
          GROUP BY fee_record_id
        ) p ON p.fee_record_id = fr.id
        WHERE fr.student_id = ${context.student.id}
          AND fr.school_id = ${context.student.schoolId}
          AND fr.session_id = ${sessionId}
          AND fr.status IN ('Due', 'Overdue')
      `);
      let previousArrears = 0;
      let currentMonthCharges = 0;
      for (const row of outstandingRows.rows as any[]) {
        const net = Number(row.net_balance) || 0;
        if (String(row.due_date).slice(0, 7) < currentMonth) previousArrears += net;
        else currentMonthCharges += net;
      }
      const paidRow = await db.execute(sql`
        SELECT COALESCE(SUM(pr.amount), 0)::int AS total_paid
        FROM payment_records pr
        LEFT JOIN fee_records fr ON fr.id = pr.fee_record_id AND fr.school_id = pr.school_id
        WHERE pr.student_id = ${context.student.id}
          AND pr.school_id = ${context.student.schoolId}
          AND COALESCE(fr.session_id, pr.session_id) = ${sessionId}
      `);
      const totalPaid = Number((paidRow.rows[0] as any)?.total_paid) || 0;
      res.json({
        previousArrears,
        currentMonthCharges,
        totalOutstanding: previousArrears + currentMonthCharges,
        totalPaid,
        currentMonth,
      });
    } catch {
      sendFailure(res, "Unable to load the Student fee summary.");
    }
  });

  app.get("/api/mobile/student/fees/payment-attempts", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const rows = await db.execute(sql`
        SELECT pa.id, pa.outcome,
          (pa.outcome = 'cancelled') AS "isCancelled",
          pa.fee_record_id AS "feeRecordId",
          fr.fee_type AS "feeType",
          COALESCE(fr.fee_name, fr.fee_type) AS "feeName",
          fr.invoice_number AS "invoiceNumber",
          COALESCE(pa.amount_paise, fr.amount * 100) / 100 AS amount,
          pa.amount_paise AS "amountPaise",
          pa.amount_captured_paise AS "amountCapturedPaise",
          pa.amount_refunded_paise AS "amountRefundedPaise",
          pa.currency, pa.created_at AS "createdAt",
          pa.razorpay_payment_id AS "razorpayPaymentId",
          pa.razorpay_order_id AS "razorpayOrderId",
          pa.payment_method AS "paymentMethod",
          pa.error_code AS "errorCode",
          pa.error_description AS "errorDescription",
          pa.error_source AS "errorSource",
          pa.error_step AS "errorStep",
          pa.error_reason AS "errorReason",
          COALESCE(pa.attempt_number, ROW_NUMBER() OVER (
            PARTITION BY COALESCE(pa.fee_record_id, pa.id) ORDER BY pa.created_at ASC
          )::integer) AS "attemptNumber"
        FROM payment_attempts pa
        LEFT JOIN fee_records fr ON fr.id = pa.fee_record_id AND fr.school_id = pa.school_id
        WHERE pa.school_id = ${context.student.schoolId}
          AND (pa.student_id = ${context.student.id}
            OR (pa.student_id IS NULL AND fr.student_id = ${context.student.id}))
          AND COALESCE(fr.session_id, pa.session_id) = ${context.session.id}
        ORDER BY pa.created_at DESC
        LIMIT 400
      `);
      res.json(rows.rows);
    } catch {
      sendFailure(res, "Unable to load Student payment history.");
    }
  });

  app.get("/api/mobile/student/fees/notification-history", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const rows = await storage.getDunningLogByStudent(
        context.student.id, context.student.schoolId, context.session.id,
      );
      res.json(rows.map(row => ({
        id: row.id,
        feeRecordId: row.feeRecordId,
        channel: row.channel,
        stage: row.stage,
        sentAt: row.sentAt,
        status: row.status,
        recipient: row.recipient,
      })));
    } catch {
      sendFailure(res, "Unable to load Student fee reminders.");
    }
  });

  app.get("/api/mobile/student/fees/portal-info", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const settings = await storage.getExternalPaymentSettings(context.student.schoolId);
      res.json({
        isEnabled: settings?.isEnabled ?? false,
        gatewayUrl: settings?.gatewayUrl ?? null,
        bannerMessage: settings?.bannerMessage ?? null,
      });
    } catch {
      sendFailure(res, "Unable to load school payment portal settings.");
    }
  });

  app.get("/api/mobile/student/examination/classes", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const classes = await storage.getStudentDistinctClasses(
        context.student.schoolId, context.student.id, context.session.id,
      );
      res.json({ classes });
    } catch {
      sendFailure(res, "Unable to load Student examination classes.");
    }
  });

  app.get("/api/mobile/student/examination/types", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const examTypes = await storage.getStudentExamTypesForStudent(
        context.student.schoolId, context.student.id, context.cohort.class, context.session.id,
      );
      res.json({ examTypes });
    } catch {
      sendFailure(res, "Unable to load Student examination types.");
    }
  });

  app.get("/api/mobile/student/examination/all-scores", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const scores = await storage.getStudentAllExamScores(
        context.student.schoolId, context.student.id, context.cohort.class, context.session.id,
      );
      res.json({ scores, cls: context.cohort.class });
    } catch {
      sendFailure(res, "Unable to load the Student examination history.");
    }
  });

  app.get("/api/mobile/student/examination/journey", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const classes = await storage.getStudentDistinctClasses(
        context.student.schoolId, context.student.id, context.session.id,
      );
      const journey: { cls: string; examType: string; percentage: number }[] = [];
      for (const cls of classes.length ? classes : [context.cohort.class]) {
        const examTypes = await storage.getStudentExamTypesForStudent(
          context.student.schoolId, context.student.id, cls, context.session.id,
        );
        if (examTypes.length === 0) continue;
        const examType = examTypes.includes("Annual") ? "Annual" : examTypes[examTypes.length - 1];
        const scores = await storage.getStudentExamScores(
          context.student.schoolId, context.student.id, cls, examType, context.session.id,
        );
        if (scores.length === 0) continue;
        const obtained = scores.filter(score => !score.isAbsent).reduce((sum, score) => sum + score.marks, 0);
        const total = scores.reduce((sum, score) => sum + score.totalMarks, 0);
        journey.push({ cls, examType, percentage: total > 0 ? Math.round((obtained / total) * 1000) / 10 : 0 });
      }
      res.json({ journey });
    } catch {
      sendFailure(res, "Unable to load the Student examination journey.");
    }
  });

  app.get("/api/mobile/student/examination/policy", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const requestedClass = req.query.class;
      if (requestedClass !== undefined
        && (typeof requestedClass !== "string" || requestedClass.trim() !== context.cohort.class.trim())) {
        fail(res, 403, "Exam policy is only available for the enrolled class in this academic session.");
        return;
      }
      const cls = context.cohort.class;
      const tiers = await storage.getExamPolicyTiers(context.student.schoolId);
      const tier = tiers.find(item =>
        (item.applicableClasses || []).map(value => String(value).trim()).includes(cls.trim()),
      );
      if (!tier) {
        fail(res, 404, `No exam policy configured for Class ${cls}.`);
        return;
      }
      const passPolicy = await storage.resolveClassPassPolicy(context.student.schoolId, cls);
      if (!passPolicy) {
        fail(res, 404, `No grading tier configured for Class ${cls}.`);
        return;
      }
      const gradingRules = await storage.getGradingRules(context.student.schoolId, passPolicy.id);
      const { validateGradingRules } = await import("@shared/examination-calculation-engine");
      validateGradingRules(gradingRules);
      res.json({
        ...tier,
        passPercentage: passPolicy.passPercentage,
        gradingRules,
        gradingPolicy: { schoolId: context.student.schoolId, tierId: passPolicy.id },
      });
    } catch (error: any) {
      fail(res, 409, error?.message || "Grading policy is not configured correctly.");
    }
  });

  app.get("/api/mobile/student/examination/scores", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const examType = req.query.examType;
      if (typeof examType !== "string" || !examType.trim() || examType.length > 100) {
        fail(res, 400, "examType is required.");
        return;
      }
      const scores = await storage.getStudentExamScores(
        context.student.schoolId, context.student.id, context.cohort.class,
        examType, context.session.id,
      );
      res.json({ scores, class: context.cohort.class, examType });
    } catch {
      sendFailure(res, "Unable to load Student examination scores.");
    }
  });

  app.get("/api/mobile/student/timetable", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const [entries, structure] = await Promise.all([
        storage.getTimetableByClassSection(
          context.student.schoolId, context.session.id, context.cohort.class, context.cohort.section,
        ),
        storage.getTimetableStructure(
          context.student.schoolId, context.session.id, context.cohort.class,
        ),
      ]);
      res.json({
        entries,
        structure,
        class: context.cohort.class,
        section: context.cohort.section,
        sessionId: context.session.id,
      });
    } catch {
      sendFailure(res, "Unable to load the Student timetable.");
    }
  });

  app.get("/api/mobile/student/leave", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      res.json(await storage.getStudentLeavesByStudent(context.student.id, context.session.id));
    } catch {
      sendFailure(res, "Unable to load Student leave applications.");
    }
  });

  app.post("/api/mobile/student/leave", ...sessionRoutes, parseLeaveAttachment, async (req, res) => {
    let storedPath: string | null = null;
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      if (context.session.isActive !== true) {
        fail(res, 403, "Leave applications cannot be submitted for a historical academic session.");
        return;
      }
      const { startDate, endDate, reason, category } = req.body ?? {};
      const start = parseDate(startDate);
      const end = parseDate(endDate);
      if (!start || !end || start > end || end < todayInIST()) {
        fail(res, 400, "Choose a valid leave date range that has not already ended.");
        return;
      }
      if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 2000) {
        fail(res, 400, "Enter a reason for leave (maximum 2,000 characters).");
        return;
      }
      if (category !== undefined && category !== null
        && (typeof category !== "string" || !LEAVE_CATEGORIES.has(category))) {
        fail(res, 400, "Select a valid leave category.");
        return;
      }
      let attachmentUrl: string | null = null;
      const uploaded = (req as Request & { file?: Express.Multer.File }).file;
      if (uploaded) {
        if (!await validLeaveAttachment(uploaded)) {
          fail(res, 400, "The attachment contents do not match the selected file type.");
          return;
        }
        const extension = path.extname(uploaded.originalname).toLowerCase();
        const filename = `${randomUUID()}${extension}`;
        await fs.mkdir(PRIVATE_LEAVE_DIRECTORY, { recursive: true, mode: 0o700 });
        await fs.chmod(PRIVATE_LEAVE_DIRECTORY, 0o700);
        storedPath = path.join(PRIVATE_LEAVE_DIRECTORY, filename);
        await fs.writeFile(storedPath, uploaded.buffer, { mode: 0o600, flag: "wx" });
        attachmentUrl = `${PRIVATE_LEAVE_FILE_PREFIX}${filename}`;
      }
      const leave = await storage.createStudentLeaveRequest({
        studentId: context.student.id,
        schoolId: context.student.schoolId,
        sessionId: context.session.id,
        startDate: start,
        endDate: end,
        reason: reason.trim(),
        status: "pending_teacher",
        category: category || null,
        attachmentUrl,
      });
      storedPath = null;
      res.status(201).json(leave);
    } catch {
      if (storedPath) await fs.unlink(storedPath).catch(() => undefined);
      sendFailure(res, "Unable to submit the Student leave application.");
    }
  });

  app.post("/api/mobile/student/leave/delete", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      if (context.session.isActive !== true) {
        fail(res, 403, "Leave applications cannot be changed in an archived academic session.");
        return;
      }
      const id = validIntegerParam(req.body?.id);
      if (id === null) {
        fail(res, 400, "Invalid leave application ID.");
        return;
      }
      const scopedLeaves = await storage.getStudentLeavesByStudent(context.student.id, context.session.id);
      const scopedLeave = scopedLeaves.find(leave => leave.id === id);
      if (!scopedLeave) {
        fail(res, 404, "Leave application not found in the selected academic session.");
        return;
      }
      const result = await storage.deleteStudentLeaveRequest(id, context.student.id);
      if (!result.success) {
        if (result.reason === "not_found") fail(res, 404, "Leave application not found.");
        else if (result.reason === "forbidden") fail(res, 403, "Access denied.");
        else fail(res, 400, "Only pending leave applications can be deleted.");
        return;
      }
      if (scopedLeave.attachmentUrl?.startsWith(PRIVATE_LEAVE_FILE_PREFIX)) {
        const filename = scopedLeave.attachmentUrl.slice(PRIVATE_LEAVE_FILE_PREFIX.length);
        if (PRIVATE_LEAVE_FILE_PATTERN.test(filename)) {
          await fs.unlink(path.join(PRIVATE_LEAVE_DIRECTORY, filename)).catch(() => undefined);
        }
      }
      res.json({ message: "Leave application deleted." });
    } catch {
      sendFailure(res, "Unable to delete the Student leave application.");
    }
  });

  app.get("/api/mobile/student/leave-files/:filename", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const filename = typeof req.params.filename === "string" ? req.params.filename : "";
      const match = PRIVATE_LEAVE_FILE_PATTERN.exec(filename);
      if (!match || filename !== path.basename(filename)) {
        fail(res, 400, "Invalid leave attachment address.");
        return;
      }
      const attachmentUrl = `${PRIVATE_LEAVE_FILE_PREFIX}${filename}`;
      const leaves = await storage.getStudentLeavesByStudent(context.student.id, context.session.id);
      if (!leaves.some(leave => leave.attachmentUrl === attachmentUrl)) {
        fail(res, 404, "Leave attachment not found.");
        return;
      }
      const filePath = path.join(PRIVATE_LEAVE_DIRECTORY, filename);
      const bytes = await fs.readFile(filePath);
      if (bytes.byteLength > MAX_LEAVE_ATTACHMENT_BYTES) {
        fail(res, 413, "Leave attachment exceeds the device download limit.");
        return;
      }
      const extension = match[2];
      res.set("Cache-Control", "private, no-store");
      res.set("X-Content-Type-Options", "nosniff");
      res.json({
        fileName: `leave-attachment.${extension}`,
        mimeType: LEAVE_ATTACHMENT_MIMES[extension],
        data: bytes.toString("base64"),
      });
    } catch {
      sendFailure(res, "Unable to open the leave attachment.");
    }
  });

  app.get("/api/mobile/student/complaints/inbox", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      res.json(await storage.getStudentInboxComplaints(
        context.student.id, context.student.schoolId, context.session.id,
      ));
    } catch {
      sendFailure(res, "Unable to load Student complaint inbox.");
    }
  });

  app.get("/api/mobile/student/complaints/filed", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      res.json(await storage.getStudentFiledComplaints(
        context.student.id, context.student.schoolId, context.session.id,
      ));
    } catch {
      sendFailure(res, "Unable to load filed Student complaints.");
    }
  });

  app.get("/api/mobile/student/complaints/teachers", ...identityRoutes, async (req, res) => {
    try {
      const student = await resolveStudent(req, res);
      if (!student) return;
      const teachers = await storage.getTeachersBySchool(student.schoolId);
      res.json(teachers.map(teacher => ({ id: teacher.id, name: teacher.fullName, subject: teacher.subject })));
    } catch {
      sendFailure(res, "Unable to load school faculty for a complaint.");
    }
  });

  app.get("/api/mobile/student/complaints/peers", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const query = req.query.q;
      if (typeof query !== "string" || query.length < 2) {
        res.json([]);
        return;
      }
      if (query.length > 100) {
        fail(res, 400, "Peer search is too long.");
        return;
      }
      const peers = await storage.searchStudents(context.student.schoolId, query);
      res.json(peers.filter(peer => peer.id !== context.student.id));
    } catch {
      sendFailure(res, "Unable to search Students.");
    }
  });

  app.post("/api/mobile/student/complaints/staff-grievance", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      if (context.session.isActive !== true) {
        fail(res, 403, "Complaints cannot be submitted in an archived academic session.");
        return;
      }
      const teacherId = validIntegerParam(req.body?.teacherId);
      const content = req.body?.content;
      const contactNumber = req.body?.contactNumber;
      const suggestions = req.body?.suggestions;
      if (!teacherId || typeof content !== "string" || !content.trim()) {
        fail(res, 400, "Teacher and complaint description are required.");
        return;
      }
      if (content.trim().length > 10_000
        || (contactNumber !== undefined && (typeof contactNumber !== "string" || contactNumber.length > 100))
        || (suggestions !== undefined && (typeof suggestions !== "string" || suggestions.length > 10_000))) {
        fail(res, 400, "Complaint details exceed the allowed length.");
        return;
      }
      const teacher = await storage.getTeacherById(teacherId);
      if (!teacher || teacher.schoolId !== context.student.schoolId) {
        fail(res, 400, "Select a valid staff member from your school.");
        return;
      }
      const ticketId = await storage.getNextTicketId(context.student.schoolId);
      const complaint = await storage.createStudentComplaint({
        ticketId,
        teacherId: teacher.id,
        complainantStudentId: context.student.id,
        schoolId: context.student.schoolId,
        sessionId: context.session.id,
        complaintType: "student-to-staff",
        content: content.trim(),
        contactNumber: typeof contactNumber === "string" ? contactNumber.trim() || null : null,
        suggestions: typeof suggestions === "string" ? suggestions.trim() || null : null,
        status: "Pending",
        isDeleted: false,
      });
      res.status(201).json(complaint);
    } catch {
      sendFailure(res, "Unable to submit the staff grievance.");
    }
  });

  app.post("/api/mobile/student/complaints/peer-report", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      if (context.session.isActive !== true) {
        fail(res, 403, "Complaints cannot be submitted in an archived academic session.");
        return;
      }
      const reportedStudentName = req.body?.reportedStudentName;
      const content = req.body?.content;
      const reportedStudentId = req.body?.reportedStudentId === undefined || req.body?.reportedStudentId === null
        ? null : validIntegerParam(req.body.reportedStudentId);
      const incidentDate = req.body?.incidentDate === undefined || req.body?.incidentDate === null || req.body.incidentDate === ""
        ? null : parseDate(req.body.incidentDate);
      if (typeof reportedStudentName !== "string" || !reportedStudentName.trim()
        || typeof content !== "string" || !content.trim()) {
        fail(res, 400, "Reported Student name and incident description are required.");
        return;
      }
      if (reportedStudentName.trim().length > 200 || content.trim().length > 10_000
        || (req.body?.incidentDate && !incidentDate)) {
        fail(res, 400, "Incident details are invalid or too long.");
        return;
      }
      if (req.body?.reportedStudentId !== undefined && req.body?.reportedStudentId !== null && !reportedStudentId) {
        fail(res, 400, "Select a valid reported Student.");
        return;
      }
      if (reportedStudentId) {
        const peer = await storage.getStudentById(reportedStudentId);
        if (!peer || peer.schoolId !== context.student.schoolId || peer.id === context.student.id) {
          fail(res, 400, "Select a valid other Student from your school.");
          return;
        }
      }
      const ticketId = await storage.getNextTicketId(context.student.schoolId);
      const complaint = await storage.createStudentComplaint({
        ticketId,
        complainantStudentId: context.student.id,
        studentId: reportedStudentId,
        schoolId: context.student.schoolId,
        sessionId: context.session.id,
        complaintType: "student-peer-report",
        content: content.trim(),
        reportedStudentName: reportedStudentName.trim(),
        incidentDate: incidentDate ? new Date(`${incidentDate}T00:00:00.000Z`) : null,
        status: "Pending",
        isDeleted: false,
        complainantClass: context.cohort.class,
        complainantSection: context.cohort.section,
      });
      res.status(201).json(complaint);
    } catch {
      sendFailure(res, "Unable to submit the Student peer report.");
    }
  });

  app.get("/api/mobile/student/complaints/:id/notes", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      const complaintId = validIntegerParam(req.params.id);
      if (!complaintId) {
        fail(res, 400, "Invalid complaint ID.");
        return;
      }
      const complaint = await storage.getComplaintByIdForSchool(complaintId, context.student.schoolId);
      if (!complaint || complaint.sessionId !== context.session.id || complaint.isDeleted) {
        fail(res, 404, "Complaint not found.");
        return;
      }
      const [inbox, filed] = await Promise.all([
        storage.getStudentInboxComplaints(context.student.id, context.student.schoolId, context.session.id),
        storage.getStudentFiledComplaints(context.student.id, context.student.schoolId, context.session.id),
      ]);
      if (![...inbox, ...filed].some(item => item.id === complaintId)) {
        fail(res, 403, "Access denied.");
        return;
      }
      res.json(await storage.getComplaintNotes(complaintId));
    } catch {
      sendFailure(res, "Unable to load the complaint conversation.");
    }
  });

  app.post("/api/mobile/student/complaints/:id/notes", ...sessionRoutes, async (req, res) => {
    try {
      const context = await sessionStudentContext(req, res);
      if (!context) return;
      if (context.session.isActive !== true) {
        fail(res, 403, "Archived complaint conversations are read-only.");
        return;
      }
      const complaintId = validIntegerParam(req.params.id);
      const content = req.body?.content;
      if (!complaintId || typeof content !== "string" || !content.trim() || content.trim().length > 5000) {
        fail(res, 400, "A complaint ID and message (maximum 5,000 characters) are required.");
        return;
      }
      const complaint = await storage.getComplaintByIdForSchool(complaintId, context.student.schoolId);
      if (!complaint || complaint.sessionId !== context.session.id || complaint.isDeleted) {
        fail(res, 404, "Complaint not found.");
        return;
      }
      const [inbox, filed] = await Promise.all([
        storage.getStudentInboxComplaints(context.student.id, context.student.schoolId, context.session.id),
        storage.getStudentFiledComplaints(context.student.id, context.student.schoolId, context.session.id),
      ]);
      if (![...inbox, ...filed].some(item => item.id === complaintId)) {
        fail(res, 403, "Access denied.");
        return;
      }
      const note = await storage.addComplaintNote({
        complaintId,
        authorId: context.student.id,
        authorRole: "student",
        authorName: context.student.name,
        content: content.trim(),
      });
      res.status(201).json(note);
    } catch {
      sendFailure(res, "Unable to send the complaint message.");
    }
  });

  app.get("/api/mobile/student/calendar", ...identityRoutes, async (req, res) => {
    try {
      const student = await resolveStudent(req, res);
      if (!student) return;
      const month = req.query.month;
      const year = req.query.year;
      let events;
      if (month !== undefined || year !== undefined) {
        if (typeof month !== "string" || !/^(0|[1-9]|1[0-1])$/.test(month)
          || typeof year !== "string" || !/^\d{4}$/.test(year)
          || Number(year) < 1 || Number(year) > 9999) {
          fail(res, 400, "month (0-11) and year (YYYY) are required together.");
          return;
        }
        const numericYear = Number(year);
        const numericMonth = Number(month);
        const start = `${year}-${String(numericMonth + 1).padStart(2, "0")}-01`;
        const lastDay = new Date(numericYear, numericMonth + 1, 0).getDate();
        const end = `${year}-${String(numericMonth + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        events = await storage.getCalendarEventsByRange(
          student.schoolId, start, end,
          student.class ? [{ cls: student.class, sec: student.section || undefined }] : undefined,
        );
      } else {
        events = await storage.getCalendarEvents(
          student.schoolId,
          student.class ? [{ cls: student.class, sec: student.section || undefined }] : undefined,
        );
      }
      res.json(events);
    } catch {
      sendFailure(res, "Unable to load the school calendar.");
    }
  });

  app.get("/api/mobile/student/faculty", ...identityRoutes, async (req, res) => {
    try {
      const student = await resolveStudent(req, res);
      if (!student) return;
      res.json(await storage.getFacultyBySchoolWithMappings(student.schoolId));
    } catch {
      sendFailure(res, "Unable to load Student faculty information.");
    }
  });

  app.get("/api/mobile/student/gallery/tags", ...identityRoutes, async (req, res) => {
    try {
      const student = await resolveStudent(req, res);
      if (!student) return;
      res.json(await storage.getGalleryTagsBySchool(student.schoolId));
    } catch {
      sendFailure(res, "Unable to load school gallery categories.");
    }
  });

  app.get("/api/mobile/student/gallery", ...identityRoutes, async (req, res) => {
    try {
      const student = await resolveStudent(req, res);
      if (!student) return;
      const tag = req.query.tag;
      if (tag !== undefined && (typeof tag !== "string" || tag.length > 100)) {
        fail(res, 400, "Invalid gallery category.");
        return;
      }
      res.json(await storage.getApprovedGalleryItems(student.schoolId, tag as string | undefined));
    } catch {
      sendFailure(res, "Unable to load the school gallery.");
    }
  });

  app.get("/api/mobile/student/library", ...identityRoutes, async (req, res) => {
    try {
      const student = await resolveStudent(req, res);
      if (!student) return;
      const books = await storage.getLibraryBooksWithUploaderNames(student.schoolId);
      res.json(books.filter(book => book.verificationStatus === "approved"));
    } catch {
      sendFailure(res, "Unable to load the school E-Library.");
    }
  });
}