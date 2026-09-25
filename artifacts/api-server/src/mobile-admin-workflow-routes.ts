import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod/v4";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { academicSessions, auditLogs, complaints, facultyMappings, libraryBooks, notices, users } from "@workspace/db";
import { db } from "./db";
import { storage } from "./storage";

type MobileAdmin = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
  allowedModules?: string[];
};
type MobileRequest = Request & {
  mobileAuth?: { principal: MobileAdmin };
  mobileAcademicSession?: typeof academicSessions.$inferSelect;
};

const base = "/api/mobile/admin/workflow";
const workflowUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      const directory = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
      callback(null, directory);
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase().slice(0, 12);
      callback(null, `${Date.now()}-${Math.round(Math.random() * 1e8)}${extension}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype === "application/pdf" || file.mimetype === "application/epub+zip") callback(null, true);
    else callback(new Error("Choose a PDF or EPUB file."));
  },
});
const staffPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) callback(null, true);
    else callback(new Error("Choose an image file."));
  },
});
const ids = (input: unknown): number[] => Array.isArray(input)
  ? input.filter((id): id is number => Number.isSafeInteger(id) && (id as number) > 0)
  : [];
const positiveId = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
const reject = (res: Response, status: number, message: string) => res.status(status).json({ message });

function principal(req: Request): MobileAdmin | null {
  const value = (req as MobileRequest).mobileAuth?.principal;
  if (!value || !["admin", "support_staff"].includes(value.role) || value.schoolId <= 0) return null;
  return value;
}
function hasModule(user: MobileAdmin, module: string): boolean {
  return user.role === "admin" || (user.allowedModules ?? []).some(key => key === module || key.startsWith(`${module}:`));
}
function hasSub(user: MobileAdmin, module: string, sub: string): boolean {
  return user.role === "admin" || (user.allowedModules ?? []).includes(`${module}:${sub}`);
}
function requireLiveSession(requireAcademicSession: RequestHandler): RequestHandler {
  return (req, res, next): void => {
    const user = principal(req);
    if (!user) {
      reject(res, 403, "Administrator or permitted support staff access is required.");
      return;
    }
    if (user.role === "support_staff") {
      if (req.get("x-view-session-id")) {
        reject(res, 403, "Support staff cannot select an academic session.");
        return;
      }
      void storage.getActiveSession(user.schoolId).then(session => {
        if (!session) {
          reject(res, 404, "No active academic session is configured for this school.");
          return;
        }
        (req as MobileRequest).mobileAcademicSession = session;
        next();
      }).catch(() => {
        reject(res, 503, "Unable to load the active academic session.");
      });
      return;
    }
    requireAcademicSession(req, res, next);
  };
}
function selectedSession(req: Request) {
  return (req as MobileRequest).mobileAcademicSession ?? null;
}
function writable(req: Request, res: Response): boolean {
  const session = selectedSession(req);
  if (!session) {
    reject(res, 409, "An academic session is required for this workflow.");
    return false;
  }
  if (!session.isActive) {
    reject(res, 403, "Archived academic sessions are read-only.");
    return false;
  }
  return true;
}
const writableAction: RequestHandler = (req, res, next) => {
  if (writable(req, res)) next();
};
const parseWorkflowUpload: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) return next();
  const user = principal(req);
  const isEbookUpload = req.params.moduleId === "approval-center" && user
    && hasModule(user, "approval-center") && hasSub(user, "approval-center", "ebook");
  const canManageStaffPhotos = req.params.moduleId === "non-teaching-staff" && user
    && hasModule(user, "non-teaching-staff")
    && (hasSub(user, "non-teaching-staff", "add") || hasSub(user, "non-teaching-staff", "edit"));
  if (!isEbookUpload && !canManageStaffPhotos) return reject(res, 403, "Permission to upload this file is required.");
  const upload = isEbookUpload ? workflowUpload.single("file") : staffPhotoUpload.single("photo");
  upload(req, res, error => {
    if (error) return next(error);
    const file = (req as Request & { file?: Express.Multer.File }).file;
    const validUpload = isEbookUpload
      ? req.body?.action === "ebook-upload" && file
      : req.body?.action === "staff-photo-upload" && file;
    if (!validUpload) {
      if (file && "path" in file) fs.unlinkSync(file.path);
      return reject(res, 400, "A valid workflow file upload is required.");
    }
    next();
  });
};

const teacherCreate = z.object({
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(128),
  phone: z.string().regex(/^\d{10}$/),
  subject: z.string().max(100).optional().default(""),
  assignedClass: z.string().max(20).optional().default(""),
  assignedSection: z.string().max(10).optional().default(""),
  designation: z.string().max(120).optional(),
  gender: z.string().max(40).optional(),
  dateOfBirth: z.string().max(30).optional(),
  govtIdType: z.string().max(40).optional(),
  govtIdNumber: z.string().max(100).optional(),
  address: z.string().max(1000).optional(),
  joiningDate: z.string().max(30).optional(),
  qualifications: z.string().max(1000).optional(),
});
const teacherEdit = teacherCreate.omit({ password: true }).partial().extend({
  fullName: z.string().trim().min(2).max(200).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
});
const staffInput = z.object({
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(255),
  phone: z.string().max(20).optional().default(""),
  designation: z.string().trim().min(1).max(120),
  password: z.string().min(6).max(128).optional(),
  allowedModules: z.array(z.string().max(100)).max(100).optional(),
});
const noticeInput = z.object({
  content: z.string().trim().min(1).max(10_000),
  targetType: z.enum(["whole_school", "teacher", "student", "class", "class_only"]),
  targetClass: z.string().max(50).optional(),
  targetSection: z.string().max(100).optional(),
  noticeType: z.enum(["Routine", "Academic", "Event", "Urgent"]).default("Routine"),
});

export function registerMobileAdminWorkflowRoutes(
  app: Express,
  requireHttps: RequestHandler,
  requireBearer: RequestHandler,
  requireAcademicSession: RequestHandler,
): void {
  const protect = [requireHttps, requireBearer] as const;
  const protectSession = [...protect, requireLiveSession(requireAcademicSession)] as const;

  app.get(`${base}/:moduleId`, ...protectSession, async (req, res) => {
    const user = principal(req)!;
    const rawModuleId = req.params.moduleId;
    const moduleId = typeof rawModuleId === "string" ? rawModuleId : rawModuleId?.[0] ?? "";
    if (!["complaint-hub", "noticeboard", "approval-center", "leave-requests", "teacher-registry", "non-teaching-staff"].includes(moduleId)
      || !hasModule(user, moduleId)) return reject(res, 403, "You do not have permission for this workflow.");
    const session = selectedSession(req)!;
    if (session.schoolId !== user.schoolId) return reject(res, 403, "The selected session does not belong to this school.");

    try {
      if (moduleId === "complaint-hub") {
        const complaints = await storage.getComplaintsBySchool(user.schoolId, session.id);
        const visibleTypes = new Set([
          ...(hasSub(user, moduleId, "private") ? ["teacher-to-admin"] : []),
          ...(hasSub(user, moduleId, "grievances") ? ["student-to-staff"] : []),
          ...(hasSub(user, moduleId, "escalated") ? ["student-peer-report", "teacher-to-student"] : []),
        ]);
        return res.json({ complaints: complaints.filter(c => visibleTypes.has(c.complaintType)
          && (c.complaintType !== "student-peer-report" || c.escalatedToPrincipal)
          && (c.complaintType !== "teacher-to-student" || c.notifyAdmin)) });
      }
      if (moduleId === "noticeboard") {
        if (!["view", "create", "bulk-delete"].some(sub => hasSub(user, moduleId, sub))) {
          return reject(res, 403, "Noticeboard view permission is required.");
        }
        const notices = await storage.getAllSchoolNotices(user.schoolId, 500, session.id);
        return res.json({ notices });
      }
      if (moduleId === "approval-center") {
        const [gallery, books] = await Promise.all([
          hasSub(user, moduleId, "gallery-hub") ? storage.getAdminGalleryItems(user.schoolId) : [],
          hasSub(user, moduleId, "ebook") ? storage.getLibraryBooksWithUploaderNames(user.schoolId) : [],
        ]);
        return res.json({ gallery, books });
      }
      if (moduleId === "leave-requests") {
        const [teacherLeaves, studentLeaves, history] = await Promise.all([
          hasSub(user, moduleId, "teacher-leave") ? storage.getLeaveRequestsBySchool(user.schoolId, session.id) : [],
          hasSub(user, moduleId, "student-leave") ? storage.getStudentLeavesForAdmin(user.schoolId, session.id) : [],
          hasSub(user, moduleId, "leave-history") ? storage.getApprovalHistory(user.schoolId, session.id) : {},
        ]);
        return res.json({
          teacherLeaves, studentLeaves,
          teacherLeaveHistory: (history as any).teacherLeaves ?? [],
          studentLeaveHistory: (history as any).studentLeaves ?? [],
        });
      }
      if (moduleId === "teacher-registry") {
        if (!hasSub(user, moduleId, "view") && user.role !== "admin") return reject(res, 403, "Teacher registry view permission is required.");
        const [teachersResult, removedHistory] = await Promise.all([
          storage.getTeachersBySchoolPaginated(user.schoolId, "", 1, 100),
          user.role === "admin" ? storage.getRemovedTeachersLog(user.schoolId, { page: 1, limit: 50 }) : Promise.resolve({ data: [] }),
        ]);
        return res.json({ teachers: teachersResult.data, total: teachersResult.total, removedHistory: removedHistory.data });
      }
      if (moduleId === "non-teaching-staff") {
        if (!hasSub(user, moduleId, "view") && user.role !== "admin") return reject(res, 403, "Support staff view permission is required.");
        const staff = await storage.getNonTeachingStaffBySchool(user.schoolId);
        return res.json({ staff: staff.map(({ passwordHash: _hash, ...safe }) => safe) });
      }
      return reject(res, 404, "Workflow not found.");
    } catch (error) {
      console.error("[mobile-admin-workflow] read failed", error);
      return reject(res, 503, "Unable to load this workflow.");
    }
  });

  app.post(`${base}/:moduleId/actions`, ...protectSession, writableAction, parseWorkflowUpload, async (req, res) => {
    const user = principal(req)!;
    const rawModuleId = req.params.moduleId;
    const moduleId = typeof rawModuleId === "string" ? rawModuleId : rawModuleId?.[0] ?? "";
    if (!["complaint-hub", "noticeboard", "approval-center", "leave-requests", "teacher-registry", "non-teaching-staff"].includes(moduleId)
      || !hasModule(user, moduleId)) return reject(res, 403, "You do not have permission for this workflow.");
    const session = selectedSession(req)!;
    if (session.schoolId !== user.schoolId) return reject(res, 403, "The selected session does not belong to this school.");
    const action = req.body?.action;
    if (typeof action !== "string") return reject(res, 400, "An action is required.");
    const needs = (sub: string) => {
      if (!hasSub(user, moduleId, sub)) {
        reject(res, 403, "You do not have permission for this module action.");
        return false;
      }
      return true;
    };
    const adminId = user.role === "admin" ? user.principalId : user.id;

    try {
      if (moduleId === "complaint-hub") {
        if (action === "complaint-status") {
          const id = positiveId(req.body.id);
          const status = req.body.status;
          const allowedType = status === "Resolved" || status === "Investigating" ? status : null;
          if (!id || !allowedType) return reject(res, 400, "Invalid complaint status update.");
          const complaint = await storage.getComplaintByIdForSchool(id, user.schoolId);
          if (!complaint || complaint.isDeleted || complaint.sessionId !== session.id) return reject(res, 404, "Complaint not found in this academic session.");
          if ((complaint.complaintType === "student-peer-report" && !complaint.escalatedToPrincipal)
            || (complaint.complaintType === "teacher-to-student" && !complaint.notifyAdmin)) {
            return reject(res, 404, "Complaint not found in this academic session.");
          }
          const tab = complaint.complaintType === "teacher-to-admin" ? "private"
            : complaint.complaintType === "student-to-staff" ? "grievances" : "escalated";
          if (!needs(tab)) return;
          const remarks = typeof req.body.resolutionRemarks === "string" ? req.body.resolutionRemarks.trim() : undefined;
          if (remarks && (remarks.length > 5000 || !hasSub(user, "complaint-hub", "escalated"))) {
            return reject(res, 403, "Principal remarks are only available for escalated reports.");
          }
          const updated = await storage.updateComplaintStatus(id, user.schoolId, allowedType, remarks);
          return res.json(updated);
        }
        if (action === "complaint-bulk-delete") {
          if (!["private", "grievances", "escalated"].some(sub => hasSub(user, "complaint-hub", sub))) {
            return reject(res, 403, "You do not have permission for complaint deletion.");
          }
          const days = req.body.olderThanDays;
          const types = Array.isArray(req.body.complaintTypes) ? req.body.complaintTypes : [];
          const validTypes = new Set(["teacher-to-admin", "student-to-staff", "student-peer-report", "teacher-to-student"]);
          if (!Number.isInteger(days) || days < 0 || !types.length || types.some((type: string) => !validTypes.has(type))) {
            return reject(res, 400, "Invalid complaint bulk-delete criteria.");
          }
          const authorizedTypes = types.filter((type: string) => hasSub(user, "complaint-hub",
            type === "teacher-to-admin" ? "private" : type === "student-to-staff" ? "grievances" : "escalated"));
          if (authorizedTypes.length !== types.length) return reject(res, 403, "Some complaint types are not permitted.");
          const conditions: any[] = [
            eq(complaints.schoolId, user.schoolId), eq(complaints.sessionId, session.id),
            eq(complaints.status, "Resolved"), eq(complaints.isDeleted, false),
            isNull(complaints.deletedAt), inArray(complaints.complaintType, authorizedTypes),
          ];
          if (authorizedTypes.includes("student-peer-report")) {
            conditions.push(or(ne(complaints.complaintType, "student-peer-report"), eq(complaints.escalatedToPrincipal, true)));
          }
          if (authorizedTypes.includes("teacher-to-student")) {
            conditions.push(or(ne(complaints.complaintType, "teacher-to-student"), eq(complaints.notifyAdmin, true)));
          }
          if (days > 0) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            conditions.push(lt(complaints.createdAt, cutoff));
          }
          const eligible = await db.select({ id: complaints.id }).from(complaints).where(and(...conditions));
          if (!eligible.length) return res.json({ deleted: 0 });
          const complaintIds = eligible.map(row => row.id);
          await db.update(complaints).set({ isDeleted: true, deletedAt: new Date(), deletedBy: adminId })
            .where(and(eq(complaints.schoolId, user.schoolId), eq(complaints.sessionId, session.id), inArray(complaints.id, complaintIds)));
          const actor = user.role === "admin"
            ? (await storage.getUserById(user.principalId))?.email ?? "Admin"
            : (await storage.getNonTeachingStaffById(user.id))?.email ?? "Support staff";
          await db.insert(auditLogs).values({
            schoolId: user.schoolId, sessionId: session.id, actionType: "bulk_delete",
            entityType: "complaint", entityId: user.schoolId, actionBy: adminId, actionByRole: user.role,
            details: `${actor} bulk-deleted ${complaintIds.length} resolved complaint(s) (types: ${authorizedTypes.join(", ")}) — ${days === 0 ? "any age" : `older than ${days} days`}`,
          });
          return res.json({ deleted: complaintIds.length });
        }
      }

      if (moduleId === "noticeboard") {
        if (action === "notice-create") {
          if (!needs("create")) return;
          const parsed = noticeInput.safeParse(req.body);
          if (!parsed.success) return reject(res, 400, parsed.error.issues.map(issue => issue.message).join(", "));
          const { content, targetType, targetClass, targetSection, noticeType } = parsed.data;
          const classTarget = targetType === "class" || targetType === "class_only";
          if (classTarget && !targetClass?.trim()) return reject(res, 400, "Choose a class for this notice.");
          if (targetType === "class" && !targetSection?.trim()) return reject(res, 400, "Choose a section for this notice.");
          const notice = await storage.createNotice({
            schoolId: user.schoolId, sessionId: session.id, createdById: adminId, creatorRole: "admin",
            targetType: classTarget ? "class" : targetType, targetClass: classTarget ? targetClass!.trim() : null,
            targetSection: targetType === "class" ? targetSection!.trim() : null,
            targetTeacherId: null, noticeType, content, fileUrl: null,
          });
          return res.status(201).json(notice);
        }
        if (action === "notice-edit") {
          if (!needs("create")) return;
          const id = positiveId(req.body.id);
          const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
          const notice = id ? await storage.getNoticeById(id) : null;
          if (!notice || notice.schoolId !== user.schoolId || notice.sessionId !== session.id || notice.creatorRole !== "admin" || notice.createdById !== adminId) return reject(res, 404, "Notice not found.");
          if (!content || content.length > 10_000) return reject(res, 400, "Notice text is required.");
          const updated = await storage.updateNotice(id!, user.schoolId, content);
          return res.json(updated);
        }
        if (action === "notice-delete") {
          if (!needs("bulk-delete")) return;
          const id = positiveId(req.body.id);
          const notice = id ? await storage.getNoticeById(id) : null;
          if (!notice || notice.schoolId !== user.schoolId || notice.sessionId !== session.id || notice.creatorRole !== "admin" || notice.createdById !== adminId) return reject(res, 404, "Notice not found.");
          await storage.deleteNotice(id!, user.schoolId);
          return res.json({ deleted: true });
        }
        if (action === "notice-bulk-delete") {
          if (!needs("bulk-delete")) return;
          if (!Number.isInteger(req.body.olderThanDays) || req.body.olderThanDays < 0) return reject(res, 400, "Invalid notice age.");
          const conditions: any[] = [eq(notices.schoolId, user.schoolId), eq(notices.sessionId, session.id)];
          if (req.body.olderThanDays > 0) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - req.body.olderThanDays);
            conditions.push(lt(notices.createdAt, cutoff));
          }
          const deleted = await db.delete(notices).where(and(...conditions)).returning({ id: notices.id });
          return res.json({ deleted: deleted.length });
        }
      }

      if (moduleId === "approval-center") {
        if (action === "gallery-approve" || action === "gallery-delete") {
          if (!needs("gallery-hub")) return;
          const id = positiveId(req.body.id);
          if (action === "gallery-approve") {
            const item = id ? await storage.getGalleryItemById(id) : null;
            if (!item || item.schoolId !== user.schoolId) return reject(res, 404, "Gallery item not found.");
            const updated = await storage.approveGalleryItem(id!);
            await storage.createAuditLog({ schoolId: user.schoolId, sessionId: session.id, actionType: "approve", entityType: "gallery", entityId: id!, actionBy: adminId, actionByRole: user.role, details: `Approved gallery image: ${updated.title}` });
            return res.json(updated);
          }
          const itemIds = ids(req.body.ids);
          if (!itemIds.length) return reject(res, 400, "Select one or more gallery items.");
          const existing = await Promise.all(itemIds.map(itemId => storage.getGalleryItemById(itemId)));
          if (existing.some(item => !item || item.schoolId !== user.schoolId)) return reject(res, 404, "A gallery item was not found.");
          await storage.deleteGalleryItems(itemIds, user.schoolId);
          await storage.createAuditLog({ schoolId: user.schoolId, sessionId: session.id, actionType: req.body.reason === "rejected" ? "reject" : "delete", entityType: "gallery", entityId: 0, actionBy: adminId, actionByRole: user.role, details: `${req.body.reason === "rejected" ? "Rejected" : "Deleted"} ${itemIds.length} gallery image(s)` });
          return res.json({ deleted: itemIds.length });
        }
        if (action === "ebook-upload") {
          if (!needs("ebook")) return;
          const file = (req as Request & { file?: Express.Multer.File }).file;
          const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
          const author = typeof req.body.author === "string" ? req.body.author.trim() : "";
          if (!file) return reject(res, 400, "Select a PDF or EPUB file.");
          if (!title || !author) return reject(res, 400, "Title and author are required.");
          const extension = path.extname(file.originalname).slice(1).toLowerCase() || "pdf";
          const book = await storage.createLibraryBook({
            schoolId: user.schoolId, title, author, isbn: null,
            targetClass: typeof req.body.targetClass === "string" && req.body.targetClass.trim() ? req.body.targetClass.trim() : null,
            category: typeof req.body.category === "string" && req.body.category.trim() ? req.body.category.trim() : null,
            fileUrl: `/uploads/${file.filename}`, fileType: extension,
            uploadedById: null, verificationStatus: "approved", totalCopies: 0, availableCopies: 0,
          });
          await storage.createAuditLog({ schoolId: user.schoolId, sessionId: session.id, actionType: "upload", entityType: "ebook", entityId: book.id, actionBy: adminId, actionByRole: user.role, details: `Admin uploaded e-book: ${title} by ${author}` });
          return res.status(201).json(book);
        }
        if (action === "ebook-verify") {
          if (!needs("ebook")) return;
          const id = positiveId(req.body.id);
          const status = req.body.status;
          if (!id || !["approved", "rejected"].includes(status)) return reject(res, 400, "Invalid e-book decision.");
          const [book] = await db.select().from(libraryBooks).where(and(eq(libraryBooks.id, id), eq(libraryBooks.schoolId, user.schoolId)));
          if (!book) return reject(res, 404, "E-book not found.");
          const [updated] = await db.update(libraryBooks).set({ verificationStatus: status }).where(and(eq(libraryBooks.id, id), eq(libraryBooks.schoolId, user.schoolId))).returning();
          await storage.createAuditLog({ schoolId: user.schoolId, sessionId: session.id, actionType: "verify", entityType: "ebook", entityId: id, actionBy: adminId, actionByRole: user.role, details: `${status === "approved" ? "Approved" : "Rejected"} e-book: ${updated.title}` });
          return res.json(updated);
        }
        if (action === "ebook-delete") {
          if (!needs("ebook")) return;
          const id = positiveId(req.body.id);
          const [book] = id ? await db.select().from(libraryBooks).where(and(eq(libraryBooks.id, id), eq(libraryBooks.schoolId, user.schoolId))) : [];
          if (!book) return reject(res, 404, "E-book not found.");
          await storage.deleteLibraryBook(id!);
          return res.json({ deleted: true });
        }
      }

      if (moduleId === "leave-requests") {
        if (action === "teacher-leave-status") {
          if (!needs("teacher-leave")) return;
          const id = positiveId(req.body.id);
          const status = req.body.status;
          if (!id || !["approved", "rejected"].includes(status)) return reject(res, 400, "Invalid leave decision.");
          const leave = await storage.getLeaveRequestById(id);
          if (!leave || leave.schoolId !== user.schoolId || leave.sessionId !== session.id) return reject(res, 404, "Leave request not found in this academic session.");
          if (status === "approved" && !session.isActive) return reject(res, 403, "Archived academic sessions are read-only.");
          const updated = await storage.updateLeaveStatusWithApprover(id, user.schoolId, status, adminId);
          if (!updated) return reject(res, 404, "Leave request not found.");
          await storage.createAuditLog({ schoolId: user.schoolId, sessionId: session.id, actionType: status, entityType: "teacher_leave", entityId: id, actionBy: adminId, actionByRole: user.role, details: `${status} teacher leave request` });
          return res.json(updated);
        }
        if (action === "student-leave-status") {
          if (!needs("student-leave")) return;
          const id = positiveId(req.body.id);
          const status = req.body.status;
          const leave = id ? await storage.getStudentLeaveById(id, user.schoolId) : null;
          if (!leave || leave.sessionId !== session.id || leave.status !== "forwarded_to_admin") return reject(res, 404, "Student leave is not awaiting an administrator decision.");
          const comment = typeof req.body.comment === "string" ? req.body.comment.trim().slice(0, 5000) : undefined;
          if (status === "rejected") {
            const updated = await storage.updateStudentLeaveStatus(id!, user.schoolId, "rejected", adminId, user.role, undefined, comment);
            await storage.createAuditLog({ schoolId: user.schoolId, sessionId: session.id, actionType: "reject", entityType: "student_leave", entityId: id!, actionBy: adminId, actionByRole: user.role, details: "Admin rejected student leave." });
            return res.json(updated);
          }
          if (status !== "approved") return reject(res, 400, "Invalid student leave decision.");
          const student = await storage.getStudentById(leave.studentId);
          if (!student || student.schoolId !== user.schoolId) return reject(res, 404, "Student not found.");
          const teacher = await storage.getTeacherByClassSection(user.schoolId, student.class, student.section);
          const updated = await storage.approveStudentLeaveWithAttendance({
            leaveId: leave.id, studentId: leave.studentId, teacherId: teacher?.id ?? null,
            schoolId: user.schoolId, sessionId: session.id, expectedStatus: "forwarded_to_admin",
            reviewedBy: adminId, reviewerRole: "admin", adminComment: comment,
          });
          if (updated) await storage.createAuditLog({ schoolId: user.schoolId, sessionId: session.id, actionType: "approve", entityType: "student_leave", entityId: leave.id, actionBy: adminId, actionByRole: user.role, details: `Admin approved student leave for dates ${leave.startDate} to ${leave.endDate}` });
          return res.json(updated);
        }
      }

      if (moduleId === "teacher-registry") {
        if (action === "teacher-create") {
          if (!needs("add")) return;
          const parsed = teacherCreate.safeParse(req.body);
          if (!parsed.success) return reject(res, 400, parsed.error.issues.map(issue => issue.message).join(", "));
          if (await storage.getUserByEmail(parsed.data.email)) return reject(res, 409, "A user with this email already exists.");
          const school = await storage.getSchool(user.schoolId);
          if (!school) return reject(res, 404, "School not found.");
          const serial = await storage.issueNextIdSerial(user.schoolId, "dtid");
          const dtid = `${school.code}-T${String(serial).padStart(3, "0")}`;
          const { password, ...data } = parsed.data;
          const created = await storage.createTeacher({
            schoolId: user.schoolId, ...data, mustChangePassword: true, digitalTeacherId: dtid,
          }, parsed.data.email, await bcrypt.hash(password, 10));
          return res.status(201).json(created);
        }
        if (action === "teacher-edit") {
          if (!needs("edit")) return;
          const id = positiveId(req.body.id);
          const parsed = teacherEdit.safeParse(req.body);
          if (!id || !parsed.success) return reject(res, 400, "Invalid teacher update.");
          const teacher = await storage.getTeacherById(id);
          if (!teacher || teacher.schoolId !== user.schoolId) return reject(res, 404, "Teacher not found.");
          if (parsed.data.email) {
            const existingUser = await storage.getUserByEmail(parsed.data.email);
            if (existingUser && existingUser.id !== teacher.userId) return reject(res, 409, "A user with this email already exists.");
          }
          const updated = await storage.updateTeacherAssignment(id, user.schoolId, {
            fullName: parsed.data.fullName || teacher.fullName, subject: teacher.subject,
            assignedClass: teacher.assignedClass, assignedSection: teacher.assignedSection,
            phone: parsed.data.phone || teacher.phone, designation: parsed.data.designation ?? teacher.designation ?? "",
            gender: parsed.data.gender || teacher.gender || undefined,
            dateOfBirth: parsed.data.dateOfBirth || teacher.dateOfBirth || undefined,
            govtIdType: parsed.data.govtIdType || teacher.govtIdType || undefined,
            govtIdNumber: parsed.data.govtIdNumber || teacher.govtIdNumber || undefined,
            address: parsed.data.address || teacher.address || undefined,
            joiningDate: parsed.data.joiningDate || teacher.joiningDate || undefined,
            qualifications: parsed.data.qualifications || teacher.qualifications || undefined,
            email: parsed.data.email,
          });
          return res.json(updated);
        }
        if (action === "teacher-remove") {
          if (!needs("deactivate")) return;
          const id = positiveId(req.body.id);
          const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
          const password = typeof req.body.adminPassword === "string" ? req.body.adminPassword : "";
          if (!id || reason.length < 5 || !password) return reject(res, 400, "A reason of at least five characters and your password are required.");
          const teacher = await storage.getTeacherById(id);
          if (!teacher || teacher.schoolId !== user.schoolId) return reject(res, 404, "Teacher not found.");
          let credential: string | undefined;
          let removedByEmail = "Support staff";
          if (user.role === "admin") {
            const admin = await storage.getUserById(user.principalId);
            credential = admin?.passwordHash;
            removedByEmail = admin?.email ?? "Admin";
          } else {
            const staffMember = await storage.getNonTeachingStaffById(user.id);
            credential = staffMember?.passwordHash ?? undefined;
            removedByEmail = staffMember?.email ?? removedByEmail;
          }
          if (!credential || !await bcrypt.compare(password, credential)) return reject(res, 401, "Incorrect password.");
          const [teacherUser] = await db.select({ email: users.email }).from(users).where(eq(users.id, teacher.userId));
          const mappings = await db.select().from(facultyMappings).where(and(eq(facultyMappings.teacherId, id), eq(facultyMappings.schoolId, user.schoolId)));
          await storage.logRemovedTeacher({
            schoolId: user.schoolId, digitalTeacherId: teacher.digitalTeacherId ?? null, fullName: teacher.fullName,
            email: teacherUser?.email ?? null, phone: teacher.phone ?? null,
            subject: mappings.map(m => m.subject).filter(Boolean).join(", ") || teacher.subject || null,
            assignedClass: mappings.map(m => `${m.className}-${m.section}`).join(", ") || teacher.assignedClass || null,
            assignedSection: null, designation: teacher.designation ?? null, gender: teacher.gender ?? null,
            dateOfBirth: teacher.dateOfBirth ?? null, govtIdType: teacher.govtIdType ?? null,
            govtIdNumber: teacher.govtIdNumber ?? null, address: teacher.address ?? null,
            joiningDate: teacher.joiningDate ?? null, qualifications: teacher.qualifications ?? null,
            removalReason: reason, removedByEmail,
          });
          await storage.deleteTeacher(id, user.schoolId);
          return res.json({ removed: true });
        }
      }

      if (moduleId === "non-teaching-staff") {
        if (action === "staff-create") {
          if (!needs("add")) return;
          const parsed = staffInput.safeParse(req.body);
          if (!parsed.success || !parsed.data.password) return reject(res, 400, "Complete all required support staff fields.");
          if (await storage.getNonTeachingStaffByEmail(parsed.data.email)) return reject(res, 409, "An account with this email already exists.");
          const { password, ...fields } = parsed.data;
          const created = await storage.createNonTeachingStaff({
            schoolId: user.schoolId, ...fields, allowedModules: fields.allowedModules ?? [],
            passwordHash: await bcrypt.hash(password, 10),
          });
          const { passwordHash: _hash, ...safe } = created;
          return res.status(201).json(safe);
        }
        if (action === "staff-edit" || action === "staff-permissions") {
          if (!needs(action === "staff-edit" ? "edit" : "permissions")) return;
          const id = positiveId(req.body.id);
          if (!id) return reject(res, 400, "Invalid support staff ID.");
          const existing = await storage.getNonTeachingStaffById(id);
          if (!existing || existing.schoolId !== user.schoolId) return reject(res, 404, "Support staff account not found.");
          const update: Record<string, unknown> = {};
          if (action === "staff-permissions") {
            if (!Array.isArray(req.body.allowedModules) || req.body.allowedModules.some((value: unknown) => typeof value !== "string")) return reject(res, 400, "Invalid permission list.");
            update.allowedModules = req.body.allowedModules;
          } else {
            const parsed = staffInput.omit({ password: true, allowedModules: true }).partial().safeParse(req.body);
            if (!parsed.success) return reject(res, 400, "Invalid support staff details.");
            Object.assign(update, parsed.data);
          }
          const updated = await storage.updateNonTeachingStaff(id, user.schoolId, update as any);
          if (!updated) return reject(res, 404, "Support staff account not found.");
          const { passwordHash: _hash, ...safe } = updated;
          return res.json(safe);
        }
        if (action === "staff-delete") {
          if (!needs("permissions")) return;
          const id = positiveId(req.body.id);
          if (!id || !await storage.deleteNonTeachingStaff(id, user.schoolId)) return reject(res, 404, "Support staff account not found.");
          return res.json({ deleted: true });
        }
        if (action === "staff-photo-upload") {
          const id = positiveId(req.body.id);
          if (!id) return reject(res, 400, "Invalid support staff ID.");
          if (!needs("edit")) return;
          const file = (req as Request & { file?: Express.Multer.File }).file;
          if (!file?.buffer) return reject(res, 400, "Choose an image file.");
          const existing = await storage.getNonTeachingStaffById(id);
          if (!existing || existing.schoolId !== user.schoolId) return reject(res, 404, "Support staff account not found.");
          const directory = path.join(process.cwd(), "uploads", "staff-photos");
          fs.mkdirSync(directory, { recursive: true });
          const extension = file.mimetype === "image/png" ? ".png" : file.mimetype === "image/webp" ? ".webp" : ".jpg";
          const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${extension}`;
          const filePath = path.join(directory, filename);
          fs.writeFileSync(filePath, file.buffer);
          const photoUrl = `/uploads/staff-photos/${filename}`;
          try {
            const updated = await storage.updateNonTeachingStaff(id, user.schoolId, { photoUrl } as any);
            if (!updated) {
              fs.unlinkSync(filePath);
              return reject(res, 404, "Support staff account not found.");
            }
            return res.json({ photoUrl });
          } catch (error) {
            fs.unlinkSync(filePath);
            throw error;
          }
        }
      }
      return reject(res, 400, "This action is not available for the requested module.");
    } catch (error) {
      console.error("[mobile-admin-workflow] action failed", error);
      return reject(res, 503, error instanceof Error ? error.message : "Unable to complete this action.");
    }
  });
}