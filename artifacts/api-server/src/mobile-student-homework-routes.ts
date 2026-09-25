import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import type { AcademicSession } from "@workspace/db";
import { todayInIST } from "@shared/ist-time";
import { storage } from "./storage";

type MobilePrincipal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
};

type MobileRequest = Request & {
  mobileAuth?: { principal: MobilePrincipal };
  mobileAcademicSession?: AcademicSession;
  session?: Request["session"] & {
    studentId?: number;
    teacherId?: number;
    userId?: number;
    userRole?: string;
  };
  mobileHomeworkContext?: {
    student: NonNullable<Awaited<ReturnType<typeof storage.getStudentWithSchool>>>["student"];
    session: AcademicSession;
    class: string;
    section: string;
    homeworkId?: number;
    homework?: Awaited<ReturnType<typeof storage.getHomeworkById>>;
    existingSubmission?: Awaited<ReturnType<typeof storage.getHomeworkSubmission>>;
  };
  file?: Express.Multer.File;
};
type PrivateHomeworkFileRecord = NonNullable<
  Awaited<ReturnType<typeof storage.getHomeworkSubmissionByFileUrl>>
>;

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_DIRECTORY = path.join(process.cwd(), "private-data", "homework-submissions");
const PRIVATE_FILE_URL_PREFIX = "/api/mobile/homework-submission-files/";
const PRIVATE_FILE_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|jpeg|png|webp|pdf)$/;
const DOWNLOAD_MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

const submissionUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      try {
        fs.mkdirSync(UPLOAD_DIRECTORY, { recursive: true, mode: 0o700 });
        fs.chmodSync(UPLOAD_DIRECTORY, 0o700);
        callback(null, UPLOAD_DIRECTORY);
      } catch (error) {
        callback(error as Error, UPLOAD_DIRECTORY);
      }
    },
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 1,
    parts: 2,
    fieldNameSize: 100,
    fieldSize: 64 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIMES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(extension)) {
      callback(new Error("Only JPG, PNG, WebP, and PDF files are allowed for homework submissions"));
      return;
    }
    callback(null, true);
  },
});

function reject(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

function studentOnly(req: Request, res: Response, next: NextFunction): void {
  if ((req as MobileRequest).mobileAuth?.principal.role !== "student") {
    reject(res, 403, "Student access is required.");
    return;
  }
  next();
}

function selectedSession(req: Request): AcademicSession | null {
  return (req as MobileRequest).mobileAcademicSession ?? null;
}

function parseHomeworkId(req: Request, res: Response): number | null {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!/^[1-9]\d*$/.test(raw)) {
    reject(res, 400, "Invalid homework ID");
    return null;
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) {
    reject(res, 400, "Invalid homework ID");
    return null;
  }
  return id;
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number(value.slice(0, 4)) < 1) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validMonth(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 1 && year <= 9999;
}

async function resolveStudent(req: Request, res: Response) {
  const principal = (req as MobileRequest).mobileAuth?.principal;
  if (!principal || principal.role !== "student" || principal.entityId === null
    || principal.id !== principal.principalId || principal.id !== principal.entityId) {
    reject(res, 403, "Student access is required.");
    return null;
  }
  const data = await storage.getStudentWithSchool(principal.id);
  if (!data || data.student.id !== principal.id || data.student.schoolId !== principal.schoolId
    || data.school.id !== principal.schoolId) {
    reject(res, 401, "Student account is no longer authorized.");
    return null;
  }
  return data.student;
}

async function resolveStudentCohort(
  student: NonNullable<Awaited<ReturnType<typeof storage.getStudentWithSchool>>>["student"],
  session: AcademicSession,
): Promise<{ class: string; section: string } | null> {
  const historical = await storage.resolveAttendanceClassSectionForStudent(
    student.schoolId, session.id, student.id,
  );
  if (historical?.class && historical.section) return historical;

  // Current profile class/section is not evidence of membership in a selected
  // historical session. For an active session only, require its own enrollment.
  if (session.isActive === true) {
    const enrollment = await storage.resolveEnrollmentForStudentSession(
      student.schoolId, student.id, session.id,
    );
    if (enrollment) {
      const cls = enrollment.className || student.class;
      const section = enrollment.sectionName || student.section;
      if (cls && section) return { class: cls, section };
    }
  }
  return null;
}

async function prepareHomework(
  req: Request,
  res: Response,
  next: NextFunction,
  forWrite: boolean,
): Promise<void> {
  try {
    const mobileReq = req as MobileRequest;
    const session = selectedSession(req);
    if (!session || session.schoolId !== mobileReq.mobileAuth?.principal.schoolId) {
      reject(res, 403, "The selected academic session is not available.");
      return;
    }
    if (forWrite && session.isActive !== true) {
      reject(res, 403, "Homework submissions are not allowed for an archived academic session.");
      return;
    }
    const student = await resolveStudent(req, res);
    if (!student) return;
    const cohort = await resolveStudentCohort(student, session);
    if (!cohort) {
      reject(res, 403, "The student is not enrolled in the selected academic session.");
      return;
    }
    const homeworkId = parseHomeworkId(req, res);
    if (homeworkId === null) return;
    const homework = await storage.getHomeworkById(homeworkId);
    if (!homework) {
      reject(res, 404, "Homework not found");
      return;
    }
    if (homework.schoolId !== student.schoolId || homework.class !== cohort.class
      || homework.section !== cohort.section || homework.sessionId !== session.id) {
      reject(res, 403, "Access denied");
      return;
    }
    const existingSubmission = forWrite
      ? await storage.getHomeworkSubmission(homeworkId, student.id)
      : undefined;
    if (forWrite && existingSubmission?.status === "approved") {
      reject(res, 400, "This homework has already been approved and cannot be re-submitted");
      return;
    }
    mobileReq.mobileHomeworkContext = {
      student, session, class: cohort.class, section: cohort.section,
      homeworkId, homework, existingSubmission,
    };
    next();
  } catch {
    reject(res, 503, "Unable to authorize homework request.");
  }
}

async function getFileSignatureError(file: Express.Multer.File): Promise<string | null> {
  const bytes = fs.readFileSync(file.path);
  const extension = path.extname(file.originalname).toLowerCase();
  let matches = extension === ".jpg" || extension === ".jpeg"
    ? file.mimetype === "image/jpeg" && bytes.length >= 3
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : extension === ".png"
      ? file.mimetype === "image/png" && bytes.length >= 8
        && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : extension === ".webp"
        ? file.mimetype === "image/webp" && bytes.length >= 12
          && bytes.toString("ascii", 0, 4) === "RIFF"
          && bytes.toString("ascii", 8, 12) === "WEBP"
        : extension === ".pdf"
          ? file.mimetype === "application/pdf" && bytes.length >= 5
            && bytes.toString("ascii", 0, 5) === "%PDF-"
            && bytes.subarray(Math.max(0, bytes.length - 1024)).includes(Buffer.from("%%EOF"))
          : false;
  if (matches && extension !== ".pdf") {
    try {
      const metadata = await sharp(file.path, { limitInputPixels: 40_000_000 }).metadata();
      const expectedFormat = extension === ".jpg" || extension === ".jpeg" ? "jpeg" : extension.slice(1);
      matches = metadata.format === expectedFormat && !!metadata.width && !!metadata.height;
    } catch {
      matches = false;
    }
  }
  return matches ? null : "Uploaded file content does not match its declared type.";
}

function removeUploadedFile(req: Request): Promise<void> {
  const file = (req as MobileRequest).file;
  return file ? fsPromises.unlink(file.path).catch(() => undefined) : Promise.resolve();
}

function privateFilenameFromUrl(fileUrl: string | null | undefined): string | null {
  if (typeof fileUrl !== "string" || !fileUrl.startsWith(PRIVATE_FILE_URL_PREFIX)) return null;
  const filename = fileUrl.slice(PRIVATE_FILE_URL_PREFIX.length);
  return PRIVATE_FILE_PATTERN.test(filename) ? filename : null;
}

async function removePrivateFileUrl(fileUrl: string | null | undefined): Promise<void> {
  const filename = privateFilenameFromUrl(fileUrl);
  if (!filename) return;
  const directory = path.resolve(UPLOAD_DIRECTORY);
  const target = path.resolve(directory, filename);
  if (!target.startsWith(`${directory}${path.sep}`)) return;
  await fsPromises.unlink(target).catch(() => undefined);
}

function requireDownloadAuthentication(
  requireBearer: RequestHandler,
): RequestHandler {
  return (req, res, next) => {
    // An Authorization header always selects bearer authentication; a bad or
    // unsupported credential must never fall back to a valid browser cookie.
    if (req.get("authorization") !== undefined) {
      requireBearer(req, res, next);
      return;
    }
    next();
  };
}

async function authorizePrivateDownload(
  req: Request,
  res: Response,
  record: PrivateHomeworkFileRecord,
): Promise<boolean> {
  const mobileReq = req as MobileRequest;
  const mobilePrincipal = mobileReq.mobileAuth?.principal;
  if (mobilePrincipal) {
    if (mobilePrincipal.role !== "student" || mobilePrincipal.entityId === null
      || mobilePrincipal.id !== mobilePrincipal.principalId
      || mobilePrincipal.id !== mobilePrincipal.entityId
      || record.submission.studentId !== mobilePrincipal.id
      || record.submission.schoolId !== mobilePrincipal.schoolId
      || record.homework.schoolId !== mobilePrincipal.schoolId) {
      reject(res, 403, "Access denied.");
      return false;
    }
    const studentData = await storage.getStudentWithSchool(mobilePrincipal.id);
    if (!studentData || studentData.student.id !== mobilePrincipal.id
      || studentData.student.schoolId !== mobilePrincipal.schoolId
      || studentData.school.id !== mobilePrincipal.schoolId
      || !studentData.student.isActive || !studentData.student.isActivated) {
      reject(res, 401, "Student account is no longer authorized.");
      return false;
    }
    return true;
  }

  const session = mobileReq.session;
  if (session?.studentId) {
    const studentData = await storage.getStudentWithSchool(session.studentId);
    if (!studentData || !studentData.student.isActive || !studentData.student.isActivated
      || studentData.student.id !== record.submission.studentId
      || studentData.student.schoolId !== record.submission.schoolId
      || studentData.student.schoolId !== record.homework.schoolId
      || studentData.school.id !== studentData.student.schoolId) {
      reject(res, 403, "Access denied.");
      return false;
    }
    return true;
  }

  if (session?.teacherId && session.userRole === "teacher" && session.userId) {
    const teacherData = await storage.getTeacherWithSchool(session.teacherId);
    if (!teacherData || teacherData.teacher.id !== session.teacherId
      || teacherData.teacher.userId !== session.userId
      || record.homework.teacherId !== session.teacherId
      || teacherData.teacher.schoolId !== record.homework.schoolId
      || teacherData.school.id !== record.homework.schoolId
      || teacherData.user.id !== session.userId
      || teacherData.user.schoolId !== record.homework.schoolId
      || teacherData.user.role !== "teacher"
      || !teacherData.user.isActive || !teacherData.teacher.isActive) {
      reject(res, 403, "Access denied.");
      return false;
    }
    return true;
  }
  reject(res, 401, "Not authenticated.");
  return false;
}

async function sendPrivateSubmissionFile(req: Request, res: Response): Promise<void> {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "private, no-store");
  res.set("Content-Disposition", "inline");
  const rawFilename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
  if (!PRIVATE_FILE_PATTERN.test(rawFilename)) {
    reject(res, 404, "File not found.");
    return;
  }
  const fileUrl = `${PRIVATE_FILE_URL_PREFIX}${rawFilename}`;
  try {
    // Resolve exact persisted ownership before checking or opening the file.
    const record = await storage.getHomeworkSubmissionByFileUrl(fileUrl);
    if (!record) {
      reject(res, 404, "File not found.");
      return;
    }
    if (record.submission.fileUrl !== fileUrl
      || record.submission.homeworkId !== record.homework.id
      || record.submission.schoolId !== record.homework.schoolId) {
      reject(res, 404, "File not found.");
      return;
    }
    if (!await authorizePrivateDownload(req, res, record)) return;

    const directory = await fsPromises.realpath(UPLOAD_DIRECTORY);
    const filePath = await fsPromises.realpath(path.join(directory, rawFilename));
    if (!filePath.startsWith(`${directory}${path.sep}`)) {
      reject(res, 404, "File not found.");
      return;
    }
    const fileStat = await fsPromises.stat(filePath);
    if (!fileStat.isFile()) {
      reject(res, 404, "File not found.");
      return;
    }
    const extension = rawFilename.slice(rawFilename.lastIndexOf(".") + 1);
    res.set("Content-Type", DOWNLOAD_MIME_TYPES[extension]);
    res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) reject(res, 404, "File not found.");
    });
  } catch {
    if (!res.headersSent) reject(res, 503, "Unable to load homework attachment.");
  }
}

function uploadSingleFile(req: Request, res: Response, next: NextFunction): void {
  submissionUpload.single("file")(req, res, (error: unknown) => {
    if (!error) {
      const file = (req as MobileRequest).file;
      if (!file) {
        next();
        return;
      }
      void fsPromises.chmod(file.path, 0o600).then(next).catch((chmodError: unknown) => {
        void removeUploadedFile(req).finally(() => {
          reject(res, 400, chmodError instanceof Error ? "Unable to securely stage homework attachment." : "File upload failed");
        });
      });
      return;
    }
    void removeUploadedFile(req).finally(() => {
      reject(res, 400, error instanceof Error ? error.message : "File upload failed");
    });
  });
}

export function registerMobileStudentHomeworkRoutes(
  app: Express,
  requireHttps: RequestHandler,
  requireBearer: RequestHandler,
  requireAcademicSession: RequestHandler,
): void {
  const protectedRoute = [requireHttps, requireBearer, studentOnly, requireAcademicSession] as const;
  app.get(
    `${PRIVATE_FILE_URL_PREFIX}:filename`,
    requireHttps,
    requireDownloadAuthentication(requireBearer),
    (req, res) => { void sendPrivateSubmissionFile(req, res); },
  );

  app.get("/api/mobile/student/homework", ...protectedRoute, async (req, res) => {
    const date = req.query.date;
    if (date !== undefined && (typeof date !== "string" || !validCalendarDate(date))) {
      reject(res, 400, "date must be YYYY-MM-DD");
      return;
    }
    try {
      const student = await resolveStudent(req, res);
      if (!student) return;
      const session = selectedSession(req)!;
      const cohort = await resolveStudentCohort(student, session);
      if (!cohort) {
        reject(res, 403, "The student is not enrolled in the selected academic session.");
        return;
      }
      const items = await storage.getStudentHomework(
        student.schoolId, cohort.class, cohort.section, student.id, date as string | undefined, session.id,
      );
      res.json(items);
    } catch {
      reject(res, 503, "Unable to load student homework.");
    }
  });

  app.get("/api/mobile/student/homework/pending-dates", ...protectedRoute, async (req, res) => {
    const month = req.query.month;
    if (typeof month !== "string" || !validMonth(month)) {
      reject(res, 400, "month must be YYYY-MM");
      return;
    }
    try {
      const student = await resolveStudent(req, res);
      if (!student) return;
      const session = selectedSession(req)!;
      const cohort = await resolveStudentCohort(student, session);
      if (!cohort) {
        reject(res, 403, "The student is not enrolled in the selected academic session.");
        return;
      }
      const dates = await storage.getStudentHomeworkPendingDates(
        student.schoolId, cohort.class, cohort.section, student.id, month, session.id,
      );
      res.json(dates);
    } catch {
      reject(res, 503, "Unable to load pending homework dates.");
    }
  });

  app.get(
    "/api/mobile/student/homework/:id",
    ...protectedRoute,
    (req, res, next) => { void prepareHomework(req, res, next, false); },
    async (req, res) => {
      try {
        const context = (req as MobileRequest).mobileHomeworkContext!;
        const submission = await storage.getHomeworkSubmission(context.homeworkId!, context.student.id);
        res.json({ ...context.homework, submission: submission || null });
      } catch {
        reject(res, 503, "Unable to load homework details.");
      }
    },
  );

  app.post(
    "/api/mobile/student/homework/:id/submit",
    ...protectedRoute,
    (req, res, next) => { void prepareHomework(req, res, next, true); },
    uploadSingleFile,
    async (req, res) => {
      const context = (req as MobileRequest).mobileHomeworkContext!;
      const file = (req as MobileRequest).file;
      let submissionPersisted = false;
      try {
        if (Object.keys(req.body ?? {}).some((key) => key !== "textAnswer")
          || (req.body?.textAnswer !== undefined && typeof req.body.textAnswer !== "string")) {
          await removeUploadedFile(req);
          reject(res, 400, "Invalid homework submission fields.");
          return;
        }
        if (file && await getFileSignatureError(file)) {
          await removeUploadedFile(req);
          reject(res, 400, "Uploaded file content does not match its declared type.");
          return;
        }
        const textAnswer = typeof req.body?.textAnswer === "string" && req.body.textAnswer.trim()
          ? req.body.textAnswer.trim()
          : undefined;
        if (!file && !textAnswer && !context.existingSubmission) {
          reject(res, 400, "Please write an answer or upload a file before submitting.");
          return;
        }
        const today = todayInIST();
        const isLate = context.homework!.dueDate ? context.homework!.dueDate < today : false;
        let saved: Awaited<ReturnType<typeof storage.upsertMobileHomeworkSubmission>>;
        try {
          saved = await storage.upsertMobileHomeworkSubmission({
            homeworkId: context.homeworkId!,
            studentId: context.student.id,
            schoolId: context.student.schoolId,
            fileUrl: file ? `${PRIVATE_FILE_URL_PREFIX}${file.filename}` : undefined,
            textAnswer,
          });
        } catch (error) {
          await removeUploadedFile(req);
          if (error instanceof Error && error.message === "HOMEWORK_SUBMISSION_APPROVED") {
            reject(res, 400, "This homework has already been approved and cannot be re-submitted");
          } else {
            reject(res, 503, "Unable to submit homework.");
          }
          return;
        }
        submissionPersisted = true;
        if (file && saved.replacedFileUrl !== saved.submission.fileUrl) {
          await removePrivateFileUrl(saved.replacedFileUrl);
        }
        res.json({ submission: saved.submission, isLate });
      } catch {
        if (!submissionPersisted) await removeUploadedFile(req);
        reject(res, 503, "Unable to submit homework.");
      }
    },
  );

  app.get("/api/mobile/student/classwork", ...protectedRoute, async (req, res) => {
    const date = req.query.date;
    if (date !== undefined && (typeof date !== "string" || !validCalendarDate(date))) {
      reject(res, 400, "date must be YYYY-MM-DD");
      return;
    }
    try {
      const student = await resolveStudent(req, res);
      if (!student) return;
      const session = selectedSession(req)!;
      const cohort = await resolveStudentCohort(student, session);
      if (!cohort) {
        reject(res, 403, "The student is not enrolled in the selected academic session.");
        return;
      }
      const items = await storage.getStudentClasswork(
        student.schoolId, cohort.class, cohort.section, date as string | undefined, session.id,
      );
      res.json(items);
    } catch {
      reject(res, 503, "Unable to load student classwork.");
    }
  });
}