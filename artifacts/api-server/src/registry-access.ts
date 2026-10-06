import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { adminModuleAccessAllowed } from "./support-staff-module-permissions";
import { storage } from "./storage";

export type RegistryActor = {
  id: number;
  role: "admin" | "support_staff";
  email?: string;
};

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasValidSchoolSession(req: Request): boolean {
  return positiveSafeInteger(req.session.schoolId);
}

export function registryModuleAccessAllowed(req: Request, moduleId: string): boolean {
  if (!hasValidSchoolSession(req)) return false;
  if (req.session.userRole === "admin") {
    return positiveSafeInteger(req.session.userId);
  }
  return req.session.userRole === "support_staff"
    && positiveSafeInteger(req.session.staffId)
    && adminModuleAccessAllowed(
      req.session.userRole,
      req.session.allowedModules,
      moduleId,
    );
}

export function registryAnyModuleAccessAllowed(
  req: Request,
  moduleIds: readonly string[],
): boolean {
  return moduleIds.some(moduleId => registryModuleAccessAllowed(req, moduleId));
}

export function requireRegistryModuleAccess(
  req: Request,
  res: Response,
  moduleId: string,
  moduleLabel: string,
): boolean {
  if (registryModuleAccessAllowed(req, moduleId)) return true;
  res.status(403).json({ message: `${moduleLabel} access required` });
  return false;
}

export function requireRegistryAnyModuleAccess(
  req: Request,
  res: Response,
  moduleIds: readonly string[],
  moduleLabel: string,
): boolean {
  if (registryAnyModuleAccessAllowed(req, moduleIds)) return true;
  res.status(403).json({ message: `${moduleLabel} access required` });
  return false;
}

export function getRegistryAuditActor(req: Request): RegistryActor | null {
  if (!hasValidSchoolSession(req)) return null;
  if (req.session.userRole === "admin" && positiveSafeInteger(req.session.userId)) {
    return { id: req.session.userId, role: "admin" };
  }
  if (req.session.userRole === "support_staff" && positiveSafeInteger(req.session.staffId)) {
    return { id: req.session.staffId, role: "support_staff" };
  }
  return null;
}

export async function authenticateRegistryActorPassword(
  req: Request,
  password: string,
): Promise<RegistryActor | null> {
  const actor = getRegistryAuditActor(req);
  if (!actor || !password) return null;

  if (actor.role === "admin") {
    const user = await storage.getUserById(actor.id);
    if (!user || user.role !== "admin" || !await bcrypt.compare(password, user.passwordHash)) {
      return null;
    }
    return { ...actor, email: user.email };
  }

  const staff = await storage.getNonTeachingStaffById(actor.id);
  if (
    !staff
    || staff.schoolId !== req.session.schoolId
    || !staff.isActive
    || !staff.passwordHash
    || !await bcrypt.compare(password, staff.passwordHash)
  ) {
    return null;
  }
  return { ...actor, email: staff.email };
}
