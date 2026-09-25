import type { Express, Request, RequestHandler, Response } from "express";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod/v4";
import { storage } from "./storage";

type MobileStudentPrincipal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
};

type MobileStudentRequest = Request & {
  mobileAuth?: { principal: MobileStudentPrincipal };
};

const saveProfileSchema = z.object({
  fullName: z.string().optional(),
  class: z.string().optional(),
  section: z.string().optional(),
  rollNo: z.string().optional(),
  fatherName: z.string().optional(),
  motherName: z.string().optional(),
  presentAddress: z.string().optional(),
  aadharNumber: z.string().regex(/^(\d{12})?$/, "Aadhaar must be exactly 12 digits or empty").optional(),
  gender: z.enum(["Boy", "Girl"]).optional(),
  phone: z.string().regex(/^\d{10}$/, "Phone must be 10 digits").optional().or(z.literal("")),
  dob: z.string().optional(),
  enrollmentDate: z.string().optional(),
  guardianName: z.string().optional(),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
});

const changeStudentPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

const photoMimeFormats: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "heif",
};
const MAX_PHOTO_PIXELS = 25_000_000;
const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 4,
    parts: 5,
    fieldNameSize: 100,
    fieldSize: 8 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (Object.hasOwn(photoMimeFormats, file.mimetype)) callback(null, true);
    else callback(new Error("Only supported raster image files are allowed"));
  },
});

function reject(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

async function getAuthorizedStudent(req: Request, res: Response) {
  const auth = (req as MobileStudentRequest).mobileAuth;
  if (!auth || auth.principal.role !== "student"
    || auth.principal.entityId === null
    || auth.principal.id !== auth.principal.principalId
    || auth.principal.id !== auth.principal.entityId) {
    reject(res, 403, "Student access is required.");
    return null;
  }
  const data = await storage.getStudentWithSchool(auth.principal.id);
  if (!data || data.student.id !== auth.principal.id
    || data.student.schoolId !== auth.principal.schoolId
    || data.school.id !== auth.principal.schoolId) {
    reject(res, 401, "Student account is no longer authorized.");
    return null;
  }
  return { ...data, studentId: auth.principal.id };
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function registerPhotoRoute(app: Express, requireBearer: RequestHandler): void {
  app.post(
    "/api/mobile/student/profile/photo",
    requireBearer,
    async (req, res, next) => {
      try {
        if (!await getAuthorizedStudent(req, res)) return;
        next();
      } catch {
        reject(res, 503, "Unable to authorize student profile.");
      }
    },
    (req, res, next) => {
      profileUpload.single("photo")(req, res, (error) => {
        if (!error) {
          next();
          return;
        }
        const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
        const message = tooLarge
          ? "Photo must be 5 MB or smaller."
          : error instanceof multer.MulterError
            ? "Photo upload contains too many files, fields, or parts."
            : error.message;
        reject(res, tooLarge ? 413 : 400, message);
      });
    },
    async (req, res) => {
      if (!req.file) {
        reject(res, 400, "No image uploaded");
        return;
      }
      const student = await getAuthorizedStudent(req, res);
      if (!student) return;
      const expectedFormat = photoMimeFormats[req.file.mimetype];
      let jpegBuffer: Buffer;
      try {
        const source = sharp(req.file.buffer, {
          limitInputPixels: MAX_PHOTO_PIXELS,
          failOn: "error",
        });
        const metadata = await source.metadata();
        if (metadata.format !== expectedFormat
          || (expectedFormat === "heif" && metadata.compression && metadata.compression !== "av1")
          || !metadata.width || !metadata.height
          || metadata.width * metadata.height > MAX_PHOTO_PIXELS) {
          reject(res, 400, "Uploaded file is not a valid supported raster image.");
          return;
        }
        jpegBuffer = await sharp(req.file.buffer, {
          limitInputPixels: MAX_PHOTO_PIXELS,
          failOn: "error",
        }).rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      } catch {
        reject(res, 400, "Uploaded file is not a valid supported raster image.");
        return;
      }

      const directory = path.join(process.cwd(), "uploads", "student-photos");
      const filename = `${randomUUID()}.jpg`;
      const outputPath = path.join(directory, filename);
      const photoUrl = `/uploads/student-photos/${filename}`;
      try {
        await fs.promises.mkdir(directory, { recursive: true });
        await fs.promises.writeFile(outputPath, jpegBuffer, { flag: "wx" });
        const profile = await storage.updateStudentProfilePhoto(student.studentId, photoUrl);
        res.json(profile);
      } catch {
        await fs.promises.unlink(outputPath).catch(() => undefined);
        reject(res, 503, "Unable to save the profile photo.");
      }
    },
  );
}

export function registerMobileStudentProfileRoutes(
  app: Express,
  requireBearer: RequestHandler,
): void {
  app.get("/api/mobile/student/profile", requireBearer, async (req, res) => {
    const authorized = await getAuthorizedStudent(req, res);
    if (!authorized) return;
    const { student, school, studentId } = authorized;
    const [profile, used] = await Promise.all([
      storage.getStudentProfile(studentId),
      storage.countMonthlyVerifications(school.id, studentId),
    ]);
    res.json({
      student: {
        id: student.id,
        name: student.name,
        digitalStudentId: student.digitalStudentId,
        class: student.class,
        section: student.section,
        phone: student.phone,
        dob: student.dob,
        photoUrl: student.photoUrl,
        enrollmentDate: student.enrollmentDate,
        gender: student.gender,
        rollNumber: student.rollNumber,
        guardianName: student.guardianName,
        bloodGroup: student.bloodGroup,
        fatherName: student.fatherName,
        motherName: student.motherName,
        address: student.address,
        aadharNumber: student.aadharNumber,
        email: student.email ?? null,
        verifiedProfile: parseJson(student.verifiedProfile),
        schoolName: school.name,
        schoolCode: school.code,
        schoolId: student.schoolId,
      },
      profile: profile ?? null,
      approvedSnapshot: parseJson(profile?.approvedSnapshot),
      liveData: {
        name: student.name,
        class: student.class,
        section: student.section,
        digitalStudentId: student.digitalStudentId,
        photoUrl: student.photoUrl,
        enrollmentDate: student.enrollmentDate,
        verifiedProfile: parseJson(student.verifiedProfile),
      },
      verificationLimit: { used, remaining: Math.max(0, 3 - used), allowed: 3 },
    });
  });

  app.post("/api/mobile/student/profile", requireBearer, async (req, res) => {
    const authorized = await getAuthorizedStudent(req, res);
    if (!authorized) return;
    const parsed = saveProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      reject(res, 400, parsed.error.issues.map((issue) => issue.message).join(", "));
      return;
    }
    const existing = await storage.getStudentProfile(authorized.studentId);
    const profile = await storage.upsertStudentProfile({
      ...parsed.data,
      studentId: authorized.studentId,
      schoolId: authorized.student.schoolId,
      class: authorized.student.class,
      section: authorized.student.section,
    }, existing?.status === "approved" ? "draft" : undefined);
    res.json(profile);
  });

  app.post("/api/mobile/student/profile/submit", requireBearer, async (req, res) => {
    const authorized = await getAuthorizedStudent(req, res);
    if (!authorized) return;
    const allowed = 3;
    const used = await storage.countMonthlyVerifications(authorized.school.id, authorized.studentId);
    if (used >= allowed) {
      reject(res, 429, `You have used all ${allowed} verification submissions for this month. Please try again next month.`);
      return;
    }
    const existing = await storage.getStudentProfile(authorized.studentId);
    if (!existing) {
      reject(res, 400, "Please save a draft before submitting");
      return;
    }
    if (existing.status === "pending") {
      reject(res, 409, "Profile is already pending review");
      return;
    }
    if (existing.status === "approved") {
      reject(res, 409, "Profile is already approved");
      return;
    }
    if (!existing.fullName || !existing.fatherName || !existing.motherName || !existing.presentAddress) {
      reject(res, 400, "Please fill in all required fields: Full Name, Father's Name, Mother's Name, and Present Address");
      return;
    }
    await storage.logVerificationRequest(authorized.school.id, authorized.studentId);
    res.json(await storage.submitStudentProfile(authorized.studentId));
  });

  app.post("/api/mobile/student/profile/change-password", requireBearer, async (req, res) => {
    const authorized = await getAuthorizedStudent(req, res);
    if (!authorized) return;
    const parsed = changeStudentPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      reject(res, 400, parsed.error.issues.map((issue) => issue.message).join(", "));
      return;
    }
    const valid = await bcrypt.compare(parsed.data.currentPassword, authorized.student.passwordHash);
    if (!valid) {
      reject(res, 400, "Current password is incorrect");
      return;
    }
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await storage.updateStudentPassword(authorized.studentId, passwordHash);
    res.json({ message: "Password changed successfully" });
  });

  registerPhotoRoute(app, requireBearer);
}