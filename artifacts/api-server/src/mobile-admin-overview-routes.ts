import type { Express, NextFunction, Request, Response } from "express";
import { storage } from "./storage";

type MobileAdminPrincipal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
  schoolName: string;
  name: string;
  allowedModules?: string[];
};

type MobileAuthenticatedRequest = Request & {
  mobileAuth?: { principal: MobileAdminPrincipal };
};

type Middleware = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

const ADMIN_MODULE_IDS = [
  "school-setup", "timetable", "school-calendar", "attendance", "exam-controller",
  "complaint-hub", "noticeboard", "approval-center", "leave-requests",
  "teacher-registry", "non-teaching-staff", "faculty-mapping", "student-registry",
  "fees-manager", "analytics", "audit-logs", "visitor-log", "id-card-gen", "assets",
];

function reject(res: Response, status: number, message: string) {
  return res.status(status).json({ message });
}

function initials(displayName: string): string {
  const words = displayName.includes("@")
    ? [displayName.split("@", 1)[0].replace(/[._-]+/g, " ")]
    : [displayName];
  return words[0].trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(word => word[0]).join("").toUpperCase();
}

function hasModule(principal: MobileAdminPrincipal, moduleId: string): boolean {
  return principal.role === "admin" || (principal.allowedModules ?? []).includes(moduleId);
}

export function registerMobileAdminOverviewRoutes(
  app: Express,
  requireHttps: Middleware,
  requireMobileBearer: Middleware,
): void {
  app.get(
    "/api/mobile/admin/overview",
    requireHttps,
    requireMobileBearer,
    async (req, res) => {
      const principal = (req as MobileAuthenticatedRequest).mobileAuth?.principal;
      if (!principal) return reject(res, 401, "Not authenticated.");
      if (principal.role !== "admin" && principal.role !== "support_staff") {
        return reject(res, 403, "Administrator or support staff access is required.");
      }

      try {
        const [studentCount, teacherCount] = await Promise.all([
          hasModule(principal, "student-registry")
            ? storage.getStudentCountBySchoolActive(principal.schoolId)
            : Promise.resolve(null),
          hasModule(principal, "teacher-registry")
            ? storage.getTeacherCountBySchool(principal.schoolId)
            : Promise.resolve(null),
        ]);
        const displayName = principal.name;
        const allowedModuleIds = principal.role === "admin"
          ? ADMIN_MODULE_IDS
          : principal.allowedModules ?? [];

        return res.json({
          role: principal.role,
          schoolName: principal.schoolName,
          schoolCode: (await storage.getSchool(principal.schoolId))?.code ?? null,
          displayName,
          initials: initials(displayName),
          allowedModuleIds,
          studentCount,
          teacherCount,
          // Existing storage has no authoritative, efficient school-wide daily
          // presence or action-required summary methods. Do not infer either.
          dailyPresence: null,
          actionRequiredCount: null,
          badges: {
            complaints: null,
            approvals: null,
            leaveRequests: null,
          },
        });
      } catch {
        return reject(res, 503, "Unable to load the administrator dashboard.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/profile",
    requireHttps,
    requireMobileBearer,
    async (req, res) => {
      const principal = (req as MobileAuthenticatedRequest).mobileAuth?.principal;
      if (!principal) return reject(res, 401, "Not authenticated.");
      if (principal.role !== "admin") return reject(res, 403, "Administrator access is required.");

      try {
        const [user, school] = await Promise.all([
          storage.getUserById(principal.principalId),
          storage.getSchool(principal.schoolId),
        ]);
        if (!user || user.role !== "admin" || !user.isActive || !user.isInitialized
          || user.schoolId !== principal.schoolId) {
          return reject(res, 401, "Administrator account is no longer authorized.");
        }
        return res.json({
          id: user.id,
          email: user.email,
          recoveryEmail: user.recoveryEmail,
          recoveryPhone: user.recoveryPhone,
          isInitialized: user.isInitialized,
          hasPin: !!user.pinHash,
          logoUrl: school?.logoUrl ?? null,
          addressLine1: school?.addressLine1 ?? null,
          addressLine2: school?.addressLine2 ?? null,
          city: school?.city ?? null,
          state: school?.state ?? null,
          pinCode: school?.pinCode ?? null,
          country: school?.country ?? "India",
          schoolPhone: school?.phone ?? null,
          schoolEmail: school?.email ?? null,
          schoolWebsite: school?.website ?? null,
          schoolBoard: school?.board ?? null,
          schoolType: school?.schoolType ?? null,
          affiliationNumber: school?.affiliationNumber ?? null,
          udiseCode: school?.udiseCode ?? null,
          establishedYear: school?.establishedYear ?? null,
          registrationNumber: school?.registrationNumber ?? null,
          pan: school?.pan ?? null,
          gstin: school?.gstin ?? null,
          signatureUrl: (user as typeof user & { signatureUrl?: string | null }).signatureUrl ?? null,
        });
      } catch {
        return reject(res, 503, "Unable to load the administrator profile.");
      }
    },
  );
}