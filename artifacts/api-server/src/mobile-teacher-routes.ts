import type { Express, Request, RequestHandler, Response } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod/v4";
import { authenticationAttemptIsRevoked } from "./session-revocation";
import { resolveAttendanceReadSession, sendAttendanceReadSessionError } from "./attendance-read-session";
import { storage } from "./storage";

type MobileTeacherPrincipal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
};

type MobileTeacherRequest = Request & {
  mobileAuth?: {
    principal: MobileTeacherPrincipal;
    session: { auth_issued_at: Date };
  };
};

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

const imageFormats: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};
const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1, fields: 0, parts: 1 },
  fileFilter: (_req, file, callback) => {
    if (Object.hasOwn(imageFormats, file.mimetype.toLowerCase())) callback(null, true);
    else callback(new Error("Only JPG, PNG, or WebP images are allowed"));
  },
});

function reject(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

async function getAuthorizedTeacher(req: Request, res: Response) {
  const auth = (req as MobileTeacherRequest).mobileAuth;
  const principal = auth?.principal;
  if (!principal || principal.role !== "teacher"
    || !Number.isSafeInteger(principal.id) || principal.id <= 0
    || !Number.isSafeInteger(principal.principalId) || principal.principalId <= 0
    || principal.entityId !== principal.id
    || !Number.isSafeInteger(principal.schoolId) || principal.schoolId <= 0) {
    reject(res, 403, "Teacher access is required.");
    return null;
  }
  try {
    const data = await storage.getTeacherWithSchool(principal.entityId);
    if (!data
      || data.teacher.id !== principal.id
      || data.teacher.userId !== principal.principalId
      || data.teacher.schoolId !== principal.schoolId
      || data.user.id !== principal.principalId
      || data.user.role !== "teacher"
      || data.user.schoolId !== principal.schoolId
      || data.school.id !== principal.schoolId
      || !data.teacher.isActive
      || !data.user.isActive
      || data.teacher.mustChangePassword) {
      reject(res, 401, "Teacher account is no longer authorized.");
      return null;
    }
    return { ...data, teacherId: principal.id };
  } catch {
    reject(res, 503, "Unable to authorize teacher account.");
    return null;
  }
}

function registerPhotoUpload(app: Express, requireHttps: RequestHandler, requireBearer: RequestHandler) {
  app.post(
    "/api/mobile/teacher/profile-photo",
    requireHttps,
    requireBearer,
    async (req, res, next) => {
      if (!await getAuthorizedTeacher(req, res)) return;
      next();
    },
    (req, res, next) => {
      profilePhotoUpload.single("file")(req, res, (error) => {
        if (!error) {
          next();
          return;
        }
        const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
        reject(res, 400, tooLarge
          ? "File too large. Maximum size is 1 MB."
          : error instanceof Error ? error.message : "Upload error");
      });
    },
    async (req, res) => {
      if (!req.file) {
        reject(res, 400, "No file uploaded");
        return;
      }
      const authorized = await getAuthorizedTeacher(req, res);
      if (!authorized) return;

      const extension = path.extname(req.file.originalname).toLowerCase();
      const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
      const expectedFormat = imageFormats[req.file.mimetype.toLowerCase()];
        const extensionMatchesFormat = expectedFormat === "jpeg"
          ? extension === ".jpg" || extension === ".jpeg"
          : expectedFormat === "png" ? extension === ".png" : extension === ".webp";
        if (!expectedFormat || !allowedExtensions.has(extension) || !extensionMatchesFormat) {
        reject(res, 400, "Only JPG, PNG, or WebP images are allowed");
        return;
      }
      try {
        const metadata = await sharp(req.file.buffer, {
          limitInputPixels: 25_000_000,
          failOn: "error",
        }).metadata();
        if (metadata.format !== expectedFormat
          || !metadata.width || !metadata.height
          || metadata.width * metadata.height > 25_000_000) {
          reject(res, 400, "Uploaded file is not a valid JPG, PNG, or WebP image");
          return;
        }
      } catch {
        reject(res, 400, "Uploaded file is not a valid JPG, PNG, or WebP image");
        return;
      }

      const directory = path.join(
        process.cwd(), "uploads", "schools", String(authorized.school.id),
        "teachers", String(authorized.teacherId),
      );
      const filename = `profile-${Date.now()}-${randomUUID()}${extension}`;
      const outputPath = path.join(directory, filename);
      const profileImageUrl = `/uploads/schools/${authorized.school.id}/teachers/${authorized.teacherId}/${filename}`;
      try {
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(outputPath, req.file.buffer, { flag: "wx" });
        await storage.updateTeacherProfilePicture(authorized.teacherId, profileImageUrl);
        res.json({ message: "Profile picture updated", profileImageUrl });
      } catch {
        await fs.unlink(outputPath).catch(() => undefined);
        reject(res, 503, "Unable to save the profile photo.");
      }
    },
  );
}

export function registerMobileTeacherRoutes(
  app: Express,
  requireHttps: RequestHandler,
  requireBearer: RequestHandler,
): void {
  app.get("/api/mobile/teacher/me", requireHttps, requireBearer, async (req, res) => {
    const authorized = await getAuthorizedTeacher(req, res);
    if (!authorized) return;
    try {
      const attendanceSession = await resolveAttendanceReadSession(
        authorized.school.id, undefined, { allowActiveFallback: true },
      );
      const [attendanceDoneToday, mappings] = await Promise.all([
        storage.hasAttendanceToday(
          authorized.teacher.id,
          authorized.teacher.assignedClass,
          authorized.teacher.assignedSection,
          authorized.teacher.schoolId,
          attendanceSession.id,
        ),
        storage.getFacultyMappingsByTeacher(authorized.teacherId),
      ]);
      return res.json({
        id: authorized.teacher.id,
        userId: authorized.user.id,
        fullName: authorized.teacher.fullName,
        email: authorized.user.email,
        phone: authorized.teacher.phone,
        subject: authorized.teacher.subject,
        assignedClass: authorized.teacher.assignedClass,
        assignedSection: authorized.teacher.assignedSection,
        designation: authorized.teacher.designation || null,
        gender: authorized.teacher.gender || null,
        dateOfBirth: authorized.teacher.dateOfBirth || null,
        govtIdType: authorized.teacher.govtIdType || null,
        govtIdNumber: authorized.teacher.govtIdNumber || null,
        address: authorized.teacher.address || null,
        joiningDate: authorized.teacher.joiningDate || null,
        qualifications: authorized.teacher.qualifications || null,
        mustChangePassword: authorized.teacher.mustChangePassword,
        schoolId: authorized.school.id,
        schoolName: authorized.school.name,
        schoolCode: authorized.school.code,
        attendanceDoneToday,
        profileImageUrl: authorized.teacher.profileImageUrl || null,
        digitalTeacherId: authorized.teacher.digitalTeacherId || null,
        mappings,
      });
    } catch (error) {
      if (sendAttendanceReadSessionError(res, error)) return;
      return reject(res, 503, "Unable to load teacher profile.");
    }
  });

  app.get(
    "/api/mobile/teacher/pending-profiles/count",
    requireHttps,
    requireBearer,
    async (req, res) => {
      const authorized = await getAuthorizedTeacher(req, res);
      if (!authorized) return;
      try {
        const profiles = await storage.getPendingProfilesForTeacher(
          authorized.school.id, authorized.teacherId, undefined, null,
        );
        return res.json({ count: profiles.length });
      } catch {
        return reject(res, 503, "Unable to load pending profile count.");
      }
    },
  );

  app.post(
    "/api/mobile/teacher/change-password",
    requireHttps,
    requireBearer,
    async (req, res) => {
      const authorized = await getAuthorizedTeacher(req, res);
      if (!authorized) return;
      const auth = (req as MobileTeacherRequest).mobileAuth!;
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return reject(res, 400, parsed.error.issues.map((issue) => issue.message).join(", "));
      }
      try {
        if (await authenticationAttemptIsRevoked(auth.principal.principalId, auth.session.auth_issued_at.getTime())) {
          return reject(res, 401, "Session expired. Please log in again.");
        }
      } catch {
        return reject(res, 503, "Unable to verify session security. Please try again.");
      }

      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      let changed: boolean;
      try {
        changed = await storage.changeTeacherPasswordAtomically(
          auth.principal.principalId,
          auth.principal.id,
          auth.principal.schoolId,
          parsed.data.currentPassword,
          passwordHash,
        );
      } catch {
        return reject(res, 500, "Unable to change password securely. Please try again.");
      }
      if (!changed) return reject(res, 400, "Incorrect Current Password");
      try {
        await storage.invalidateUserSessionsStrict(auth.principal.principalId);
      } catch {
        return reject(res, 500, "Unable to complete password change securely. Please contact support.");
      }
      return res.json({ message: "Password changed successfully. Please log in again." });
    },
  );

  registerPhotoUpload(app, requireHttps, requireBearer);
}