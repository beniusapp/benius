import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod/v4";
import {
  academicHistory, attendanceCorrectionRequests, attendancePolicies, attendanceRecords,
  academicSessions, auditLogs, calendarEvents, examPolicyTiers, examScores, facultyMappings, gradingTiers, insertAttendancePolicySchema, promotionDecisions,
  studentProfiles, students, teacherSelfAttendance,
  type AcademicSession, type InsertAcademicSession, type InsertCalendarEvent,
} from "@workspace/db";
import { db } from "./db";
import { storage } from "./storage";
import { aggregateStudentAttendance } from "./student-attendance-calculation";
import { getStudentAttendanceWorkingDates } from "./student-attendance-working-days";
import { replaceCalendarYear } from "@shared/ist-time";

type AdminPrincipal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
  allowedModules?: string[];
};
type MobileRequest = Request & {
  mobileAuth?: { principal: AdminPrincipal };
  mobileAcademicSession?: AcademicSession;
};

const visitorInput = z.object({
  visitorName: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1).max(500),
  hostName: z.string().trim().min(1).max(200),
  phone: z.string().trim().regex(/^\d{10}$/).optional().nullable(),
  email: z.string().trim().email().max(255).optional().nullable().or(z.literal("")),
  visitorIdNumber: z.string().trim().max(100).optional().nullable(),
  address: z.string().trim().max(1000).optional().nullable(),
});
const calendarInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  eventType: z.enum(["holiday", "academic", "examination", "event"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  venue: z.string().max(300).optional().nullable(),
  colorCode: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  isRecurring: z.boolean().optional(),
  audienceScope: z.enum(["All_School", "Entire_Class", "Specific_Section"]).optional(),
  targetClass: z.string().max(60).optional().nullable(),
  targetSection: z.string().max(60).optional().nullable(),
}).refine((value) => value.date || value.startDate, "Event date is required");

function reject(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

function principal(req: Request): AdminPrincipal | null {
  const value = (req as MobileRequest).mobileAuth?.principal;
  if (!value || value.role !== "admin" && value.role !== "support_staff"
    || value.schoolId <= 0 || value.principalId <= 0) return null;
  return value;
}

function allowedModule(value: AdminPrincipal, moduleId: string): boolean {
  return value.role === "admin" || (value.allowedModules ?? []).includes(moduleId);
}

function allowedSubmodule(value: AdminPrincipal, moduleId: string, submodule: string): boolean {
  return value.role === "admin" || (value.allowedModules ?? []).includes(`${moduleId}:${submodule}`);
}

function requireModule(moduleId: string, submodule?: string): RequestHandler {
  return (req, res, next) => {
    const user = principal(req);
    if (!user) {
      reject(res, 403, "Administrator or permitted support staff access is required.");
      return;
    }
    if (!allowedModule(user, moduleId)
      || (submodule && !allowedSubmodule(user, moduleId, submodule))) {
      reject(res, 403, "You do not have permission for this module action.");
      return;
    }
    next();
  };
}

function requireLiveSession(requireAcademicSession: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const user = principal(req);
    if (!user) {
      reject(res, 403, "Administrator or permitted support staff access is required.");
      return;
    }
    if (user.role === "support_staff") {
      const header = req.get("x-view-session-id");
      if (header) {
        reject(res, 403, "Support staff cannot select an academic session.");
        return;
      }
      void storage.getActiveSession(user.schoolId).then((session) => {
        if (!session) {
          reject(res, 404, "No active academic session is configured for this school.");
          return;
        }
        (req as MobileRequest).mobileAcademicSession = session;
        next();
      }).catch(() => reject(res, 503, "Unable to load the active academic session."));
      return;
    }
    requireAcademicSession(req, res, next);
  };
}

function selectedSession(req: Request): AcademicSession | null {
  return (req as MobileRequest).mobileAcademicSession ?? null;
}

function requireExamSession(requireAcademicSession: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const user = principal(req);
    if (!user) {
      reject(res, 403, "Administrator access is required.");
      return;
    }
    if (user.role === "support_staff") {
      if (req.get("x-view-session-id")) {
        reject(res, 403, "Support staff cannot select an academic session.");
        return;
      }
      void storage.getActiveSession(user.schoolId).then((session) => {
        if (!session) {
          reject(res, 404, "No active academic session is configured for this school.");
          return;
        }
        (req as MobileRequest).mobileAcademicSession = session;
        next();
      }).catch(() => reject(res, 503, "Unable to load the active academic session."));
      return;
    }
    requireAcademicSession(req, res, next);
  };
}

function examSession(req: Request, schoolId: number): AcademicSession | null {
  const session = selectedSession(req);
  return session && session.schoolId === schoolId ? session : null;
}

function isolatedTerm(sessionId: number, term: string): string {
  return `mobile-session-${sessionId}:${term}`;
}

function parseId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function publicStudent<T extends { passwordHash?: unknown; attendanceIdentityKey?: unknown }>(student: T) {
  const { passwordHash: _passwordHash, attendanceIdentityKey: _attendanceIdentityKey, ...safe } = student;
  return safe;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isSupportedCalendarDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  return isDate(value) && year >= 2026 && year <= 2126;
}

function monthRange(month: string): { from: string; to: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, number] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: `${year}-${String(number).padStart(2, "0")}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`,
  };
}

function calendarPayload(
  schoolId: number,
  value: z.infer<typeof calendarInput>,
): InsertCalendarEvent {
  const date = value.date ?? value.startDate;
  const scope = value.audienceScope ?? (value.targetClass
    ? value.targetSection ? "Specific_Section" : "Entire_Class"
    : "All_School");
  return {
    schoolId,
    title: value.title,
    date,
    eventType: value.eventType,
    venue: value.venue?.trim() || null,
    description: value.description?.trim() || null,
    colorCode: value.colorCode || (value.eventType === "holiday" ? "#ef4444"
      : value.eventType === "examination" ? "#3b82f6" : "#10b981"),
    isRecurring: value.isRecurring === true,
    audienceScope: scope,
    targetClass: scope === "All_School" ? null : value.targetClass?.trim() || null,
    targetSection: scope === "Specific_Section" ? value.targetSection?.trim() || null : null,
  };
}

function expandDates(startDate: string, endDate: string, recurring: boolean): string[] {
  const dates: string[] = [];
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
    || start > end || (end.getTime() - start.getTime()) / 86_400_000 > 366) return [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  if (!recurring) return dates;
  const lastYear = Math.max(2126, start.getUTCFullYear());
  const base = [...dates];
  for (let year = start.getUTCFullYear() + 1; year <= lastYear; year++) {
    for (const date of base) {
      const original = new Date(`${date}T00:00:00.000Z`);
      original.setUTCFullYear(year);
      dates.push(original.toISOString().slice(0, 10));
    }
  }
  if (dates.length > 50_000) return [];
  return dates;
}

export function registerMobileAdminModuleRoutes(
  app: Express,
  requireHttps: RequestHandler,
  requireBearer: RequestHandler,
  requireAcademicSession: RequestHandler,
): void {
  const protect = [requireHttps, requireBearer] as const;

  app.get(
    "/api/mobile/admin/modules/school-setup",
    ...protect,
    requireModule("school-setup"),
    async (req, res) => {
      const user = principal(req)!;
      try {
        const [metadata, sessions, gradingTiers, gradingRules, examPolicyTiers, leavePolicies, policies] = await Promise.all([
          storage.getAllSchoolMetadata(user.schoolId),
          storage.getAcademicSessions(user.schoolId),
          storage.getGradingTiers(user.schoolId),
          storage.getGradingRules(user.schoolId),
          storage.getExamPolicyTiers(user.schoolId),
          storage.getLeavePoliciesBySchool(user.schoolId),
          db.select().from(attendancePolicies).where(eq(attendancePolicies.schoolId, user.schoolId)),
        ]);
        res.json({ metadata, sessions, gradingTiers, gradingRules, examPolicyTiers, leavePolicies, attendancePolicies: policies });
      } catch {
        reject(res, 503, "Unable to load school setup.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/metadata",
    ...protect,
    async (req, res) => {
      const user = principal(req);
      if (!user || !allowedModule(user, "school-setup")) {
        reject(res, 403, "School setup access is required.");
        return;
      }
      const key = req.body?.key;
      const listSubmodule: Record<string, string> = {
        classes: "classes", sections: "sections", subjects: "subjects", exam_types: "exam-types",
      };
      const mappingSubmodule: Record<string, string> = {
        class_sections: "class-section-mapping",
        class_subjects: "class-subject-mapping",
        class_exam_types: "class-examtype-mapping",
      };
      try {
        if (typeof key !== "string") {
          reject(res, 400, "A school metadata key is required.");
          return;
        }
        if (listSubmodule[key]) {
          if (!allowedSubmodule(user, "school-setup", listSubmodule[key])) {
            reject(res, 403, "You do not have permission to edit this school setup list.");
            return;
          }
          const values = z.array(z.string().trim().min(1).max(100)).safeParse(req.body?.values);
          if (!values.success || new Set(values.data).size !== values.data.length) {
            reject(res, 400, "Values must be a unique list of non-empty names.");
            return;
          }
          await storage.setSchoolMetadata(user.schoolId, key, values.data);
          res.json({ message: "School setup list saved.", values: values.data });
          return;
        }
        const mappingPermission = mappingSubmodule[key];
        if (!mappingPermission || !allowedSubmodule(user, "school-setup", mappingPermission)) {
          reject(res, 403, "You do not have permission to edit this school setup mapping.");
          return;
        }
        const mapping = z.record(z.string().min(1), z.array(z.string().min(1))).safeParse(req.body?.mapping);
        if (!mapping.success) {
          reject(res, 400, "Mapping must be an object of configured names to name lists.");
          return;
        }
        if (key === "class_sections") await storage.setClassSectionsMetadata(user.schoolId, mapping.data);
        else if (key === "class_subjects") await storage.setClassSubjectsMetadata(user.schoolId, mapping.data);
        else await storage.setClassExamTypesMetadata(user.schoolId, mapping.data);
        res.json({ message: "School setup mapping saved.", mapping: mapping.data });
      } catch {
        reject(res, 503, "Unable to save school setup.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/sessions",
    ...protect,
    requireModule("school-setup", "academic-sessions"),
    async (req, res) => {
      const user = principal(req)!;
      const parsed = z.object({
        sessionName: z.string().trim().min(1).max(50),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        setAsActive: z.boolean().default(false),
        newAdmissionsEnabled: z.boolean().default(false),
        promotionStrategy: z.enum(["defer", "immediate"]).default("defer"),
      }).safeParse(req.body);
      if (!parsed.success || !isDate(parsed.data.startDate) || !isDate(parsed.data.endDate)
        || parsed.data.startDate >= parsed.data.endDate) {
        reject(res, 400, "Provide a unique session name and a valid date range.");
        return;
      }
      try {
        const existing = await storage.getAcademicSessions(user.schoolId);
        if (existing.some(item => item.sessionName.trim().toLowerCase() === parsed.data.sessionName.toLowerCase())) {
          reject(res, 409, "A session with that name already exists.");
          return;
        }
        if (existing.some(item => parsed.data.startDate <= String(item.endDate) && parsed.data.endDate >= String(item.startDate))) {
          reject(res, 409, "The selected date range overlaps an existing academic session.");
          return;
        }
        const input: InsertAcademicSession = {
          schoolId: user.schoolId,
          sessionName: parsed.data.sessionName,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          isActive: false,
          status: parsed.data.setAsActive ? "active" : "draft",
          newAdmissionsEnabled: parsed.data.newAdmissionsEnabled,
          promotionStrategy: parsed.data.promotionStrategy,
          copiedFromSessionId: null,
          copiedModules: null,
        };
        let created = await storage.createAcademicSession(input);
        if (parsed.data.setAsActive || existing.length === 0) {
          created = await storage.activateAcademicSession(created.id, user.schoolId);
        }
        res.status(201).json(created);
      } catch {
        reject(res, 503, "Unable to create the academic session.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/sessions/:id/copy-modules",
    ...protect,
    requireModule("school-setup", "academic-sessions"),
    async (req, res) => {
      const user = principal(req)!;
      const destinationId = parseId(req.params.id);
      if (user.role !== "admin") {
        reject(res, 403, "Only an administrator can copy session configuration.");
        return;
      }
      const parsed = z.object({
        sourceSessionId: z.number().int().positive(),
        subModuleIds: z.array(z.string().min(1)).min(1).max(20),
      }).safeParse(req.body);
      if (!destinationId || !parsed.success || parsed.data.sourceSessionId === destinationId) {
        reject(res, 400, "Provide different source and destination sessions and at least one configuration section.");
        return;
      }
      const definitions: Record<string, { parentModule: string; label: string; metaKey?: string; kind: "meta" | "shared" | "calendar"; note: string }> = {
        classes: { parentModule: "School Setup", label: "Classes", metaKey: "classes", kind: "meta", note: "Shared across all sessions" },
        sections: { parentModule: "School Setup", label: "Sections", metaKey: "sections", kind: "meta", note: "Shared across all sessions" },
        subjects: { parentModule: "School Setup", label: "Subjects", metaKey: "subjects", kind: "meta", note: "Shared across all sessions" },
        "exam-types": { parentModule: "School Setup", label: "Exam Types", metaKey: "exam_types", kind: "meta", note: "Shared across all sessions" },
        "class-mapping": { parentModule: "School Setup", label: "Class–Section Mapping", metaKey: "class_sections", kind: "meta", note: "Shared across all sessions" },
        "subject-mapping": { parentModule: "School Setup", label: "Class–Subject Mapping", metaKey: "class_subjects", kind: "meta", note: "Shared across all sessions" },
        "class-exam-type-mapping": { parentModule: "School Setup", label: "Class–Exam Type Mapping", metaKey: "class_exam_types", kind: "meta", note: "Shared across all sessions" },
        "grading-policy": { parentModule: "School Setup", label: "Academic Grading (Tiers)", kind: "shared", note: "Shared across all sessions" },
        "promotion-policy": { parentModule: "School Setup", label: "Promotion Policy", kind: "shared", note: "Shared across all sessions" },
        "attendance-policy": { parentModule: "School Setup", label: "Attendance Policy", kind: "shared", note: "Shared across all sessions" },
        "leave-policy": { parentModule: "School Setup", label: "Leave Policy", kind: "shared", note: "Shared across all sessions" },
        "holiday-templates": { parentModule: "School Calendar", label: "Holiday Templates", kind: "calendar", note: "Recurring events duplicated with dates advanced" },
        "recurring-events": { parentModule: "School Calendar", label: "Recurring Events", kind: "calendar", note: "Recurring events duplicated with dates advanced" },
      };
      if (parsed.data.subModuleIds.some(id => !definitions[id])) {
        reject(res, 400, "Only School Setup and recurring calendar configuration can be copied from this screen.");
        return;
      }
      try {
        const result = await db.transaction(async tx => {
          const [destination] = await tx.select().from(academicSessions).where(and(
            eq(academicSessions.id, destinationId), eq(academicSessions.schoolId, user.schoolId),
          ));
          const [source] = await tx.select().from(academicSessions).where(and(
            eq(academicSessions.id, parsed.data.sourceSessionId), eq(academicSessions.schoolId, user.schoolId),
          ));
          if (!destination || !source) throw new Error("session-not-found");
          if (destination.status === "archived") throw new Error("destination-archived");
          let prior: any = null;
          try {
            const value = destination.copiedModules ? JSON.parse(destination.copiedModules) : null;
            if (value && Array.isArray(value.approvedModules)) prior = value;
          } catch { /* Preserve existing result only when it is valid JSON. */ }
          const copied = [...(prior?.copied ?? [])];
          const sharedSchoolwide = [...(prior?.sharedSchoolwide ?? [])];
          const requestedButEmpty = [...(prior?.requestedButEmpty ?? [])];
          const completed = new Set([...copied, ...sharedSchoolwide, ...requestedButEmpty].map(item => item.module));
          const metadata = await storage.getAllSchoolMetadata(user.schoolId);
          const recurring = parsed.data.subModuleIds.some(id => definitions[id].kind === "calendar")
            ? await tx.select().from(calendarEvents).where(and(
                eq(calendarEvents.schoolId, user.schoolId), eq(calendarEvents.isRecurring, true),
              ))
            : [];
          let recurringCopied = false;
          let recurringCount = 0;
          const yearDelta = new Date(destination.startDate).getUTCFullYear() - new Date(source.startDate).getUTCFullYear();
          for (const id of parsed.data.subModuleIds) {
            if (completed.has(id)) continue;
            const item = definitions[id];
            let count = 0;
            if (item.kind === "meta") {
              const value = (metadata as Record<string, unknown>)[item.metaKey!];
              count = Array.isArray(value) ? value.length
                : value && typeof value === "object" ? Object.keys(value).length : 0;
            } else if (item.kind === "shared") {
              if (id === "grading-policy") count = (await tx.select().from(gradingTiers).where(eq(gradingTiers.schoolId, user.schoolId))).length;
              else if (id === "promotion-policy") count = (await tx.select().from(examPolicyTiers).where(eq(examPolicyTiers.schoolId, user.schoolId))).length;
              else if (id === "attendance-policy") count = (await tx.select().from(attendancePolicies).where(eq(attendancePolicies.schoolId, user.schoolId))).length;
              else count = (await storage.getLeavePoliciesBySchool(user.schoolId)).length;
            } else {
              if (recurringCopied) {
                copied.push({ module: id, parentModule: item.parentModule, label: item.label, count: recurringCount, note: item.note });
                continue;
              }
              if (recurring.length) {
                await tx.insert(calendarEvents).values(recurring.map(event => ({
                  schoolId: user.schoolId,
                  title: event.title,
                  date: replaceCalendarYear(String(event.date), Number(String(event.date).slice(0, 4)) + yearDelta),
                  eventType: event.eventType,
                  venue: event.venue,
                  description: event.description,
                  colorCode: event.colorCode,
                  isRecurring: true,
                  audienceScope: event.audienceScope,
                  targetClass: event.targetClass,
                  targetSection: event.targetSection,
                })));
              }
              recurringCopied = true;
              recurringCount = recurring.length;
              count = recurringCount;
            }
            const entry = { module: id, parentModule: item.parentModule, label: item.label, count, note: count ? item.note : item.kind === "calendar" ? "No recurring events found" : "Not configured yet" };
            (item.kind === "calendar" && count > 0 ? copied : count > 0 || item.kind === "meta" ? sharedSchoolwide : requestedButEmpty).push(entry);
          }
          const newResult = {
            sourceSessionId: source.id,
            sourceSessionName: source.sessionName,
            destSessionId: destination.id,
            approvedModules: [...(prior?.approvedModules ?? []), ...parsed.data.subModuleIds.filter(id => !completed.has(id))],
            copied,
            sharedSchoolwide,
            requestedButEmpty,
            cleanSlate: ["student-registry", "exam-controller", "attendance", "complaint-hub", "noticeboard", "visitor-log", "audit-logs"],
            totalRecordsCopied: copied.reduce((sum, entry) => sum + entry.count, 0),
            timestamp: new Date().toISOString(),
          };
          await tx.update(academicSessions).set({ copiedModules: JSON.stringify(newResult) }).where(and(
            eq(academicSessions.id, destination.id), eq(academicSessions.schoolId, user.schoolId),
          ));
          await tx.insert(auditLogs).values({
            schoolId: user.schoolId,
            actionType: "UPDATE",
            entityType: "academic_session",
            entityId: destination.id,
            actionBy: user.id,
            actionByRole: user.role,
            details: JSON.stringify({ action: "copy-modules", subModuleIds: parsed.data.subModuleIds, sourceSessionId: source.id, totalRecordsCopied: newResult.totalRecordsCopied, timestamp: newResult.timestamp }),
          });
          return newResult;
        });
        res.json(result);
      } catch (error) {
        reject(res,
          error instanceof Error && error.message === "session-not-found" ? 404 : error instanceof Error && error.message === "destination-archived" ? 403 : 503,
          error instanceof Error && error.message === "session-not-found" ? "Source or destination session not found for this school."
            : error instanceof Error && error.message === "destination-archived" ? "Archived sessions are read-only."
              : "Unable to copy session configuration.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/sessions/:id/activate",
    ...protect,
    requireModule("school-setup", "academic-sessions"),
    async (req, res) => {
      const user = principal(req)!;
      const id = parseId(req.params.id);
      if (!id) {
        reject(res, 400, "Invalid academic session ID.");
        return;
      }
      try {
        res.json(await storage.activateAcademicSession(id, user.schoolId));
      } catch {
        reject(res, 404, "Academic session not found for this school.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/sessions/:id/delete",
    ...protect,
    requireModule("school-setup", "academic-sessions"),
    async (req, res) => {
      const user = principal(req)!;
      const id = parseId(req.params.id);
      if (!id) {
        reject(res, 400, "Invalid academic session ID.");
        return;
      }
      try {
        const deleted = await storage.deleteAcademicSession(id, user.schoolId);
        if (!deleted) {
          reject(res, 409, "Session was not found, is active, or contains protected financial history.");
          return;
        }
        res.json({ message: "Academic session deleted." });
      } catch {
        reject(res, 503, "Unable to delete the academic session.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/grading-tiers",
    ...protect,
    requireModule("school-setup", "grading"),
    async (req, res) => {
      const user = principal(req)!;
      const parsed = z.object({
        id: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(100),
        classes: z.array(z.string().min(1)).min(1),
        passPercentage: z.number().int().min(0).max(100),
        gradingSystem: z.enum(["percentage", "grade", "both"]),
        passingGrades: z.array(z.string().min(1)),
        sortOrder: z.number().int().nonnegative(),
        rules: z.array(z.object({
          gradeLabel: z.string().trim().min(1).max(20),
          minPercent: z.number().min(0).max(100),
          maxPercent: z.number().min(0).max(100),
          gradePoint: z.string().max(20),
          remarks: z.string().max(200),
        })).min(1),
      }).safeParse(req.body);
      if (!parsed.success || parsed.data.rules.some(rule => rule.minPercent > rule.maxPercent)) {
        reject(res, 400, "Provide a valid grading tier and non-empty grade ranges.");
        return;
      }
      try {
        const tier = await storage.upsertGradingTier({
          schoolId: user.schoolId,
          id: parsed.data.id,
          name: parsed.data.name,
          classes: parsed.data.classes,
          passPercentage: parsed.data.passPercentage,
          gradingSystem: parsed.data.gradingSystem,
          passingGrades: parsed.data.passingGrades,
          sortOrder: parsed.data.sortOrder,
        });
        const rules = await storage.replaceGradingRules(tier.id, user.schoolId, parsed.data.rules.map(rule => ({
          ...rule,
          sortOrder: 0,
        })));
        res.json({ tier, rules });
      } catch {
        reject(res, 503, "Unable to save the grading tier.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/grading-tiers/:id/delete",
    ...protect,
    requireModule("school-setup", "grading"),
    async (req, res) => {
      const user = principal(req)!;
      const id = parseId(req.params.id);
      if (!id) {
        reject(res, 400, "Invalid grading tier ID.");
        return;
      }
      try {
        await storage.deleteGradingTier(id, user.schoolId);
        res.json({ message: "Grading tier deleted." });
      } catch {
        reject(res, 503, "Unable to delete the grading tier.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/exam-policy-tiers",
    ...protect,
    requireModule("school-setup", "exam-policy"),
    async (req, res) => {
      const user = principal(req)!;
      const parsed = z.object({
        id: z.number().int().positive().optional(),
        tierName: z.string().trim().min(1).max(100),
        applicableClasses: z.array(z.string().min(1)).min(1),
        examWeights: z.string().max(100_000),
        promotionFailRules: z.string().max(30_000),
        resultsConfig: z.string().max(50_000),
      }).safeParse(req.body);
      if (!parsed.success) {
        reject(res, 400, "Provide a policy name, at least one class and valid policy configuration.");
        return;
      }
      try {
        for (const json of [parsed.data.examWeights, parsed.data.promotionFailRules, parsed.data.resultsConfig]) JSON.parse(json);
        const { id, ...values } = parsed.data;
        const tier = id
          ? await storage.updateExamPolicyTier(id, user.schoolId, values)
          : await storage.createExamPolicyTier({ ...values, schoolId: user.schoolId });
        if (!tier) {
          reject(res, 404, "Exam policy tier not found for this school.");
          return;
        }
        res.json(tier);
      } catch (error) {
        reject(res, error instanceof SyntaxError ? 400 : 503,
          error instanceof SyntaxError ? "Exam policy configuration must be valid JSON." : "Unable to save the exam policy.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/exam-policy-tiers/:id/delete",
    ...protect,
    requireModule("school-setup", "exam-policy"),
    async (req, res) => {
      const user = principal(req)!;
      const id = parseId(req.params.id);
      if (!id) {
        reject(res, 400, "Invalid exam policy tier ID.");
        return;
      }
      try {
        const deleted = await storage.deleteExamPolicyTier(id, user.schoolId);
        if (!deleted) {
          reject(res, 404, "Exam policy tier not found for this school.");
          return;
        }
        res.json({ message: "Exam policy tier deleted." });
      } catch {
        reject(res, 503, "Unable to delete the exam policy.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/leave-policies",
    ...protect,
    async (req, res) => {
      const user = principal(req);
      if (!user || !allowedModule(user, "school-setup") || !allowedSubmodule(user, "school-setup", "leave-policy")) {
        reject(res, 403, "You do not have permission to manage leave policies.");
        return;
      }
      const schema = z.object({
        id: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(100),
        annualLimit: z.number().int().min(0).max(366),
        targetRoles: z.enum(["all", "teacher", "non_teaching"]),
        renewalMonth: z.number().int().min(1).max(12),
        renewalDay: z.number().int().min(1).max(31),
        expiryBehavior: z.enum(["expire", "carry_forward"]),
        isActive: z.boolean(),
      }).safeParse(req.body);
      if (!schema.success) {
        reject(res, 400, "Provide a valid leave policy.");
        return;
      }
      try {
        const { id, ...data } = schema.data;
        const policy = id
          ? await storage.updateLeavePolicy(id, user.schoolId, data)
          : await storage.createLeavePolicy({ ...data, schoolId: user.schoolId });
        res.json(policy);
      } catch {
        reject(res, 503, "Unable to save the leave policy.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/leave-policies/:id/delete",
    ...protect,
    requireModule("school-setup", "leave-policy"),
    async (req, res) => {
      const user = principal(req)!;
      const id = parseId(req.params.id);
      if (!id) {
        reject(res, 400, "Invalid leave policy ID.");
        return;
      }
      try {
        await storage.deleteLeavePolicy(id, user.schoolId);
        res.json({ message: "Leave policy deleted." });
      } catch {
        reject(res, 503, "Unable to delete the leave policy.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/attendance-policies",
    ...protect,
    async (req, res) => {
      const user = principal(req);
      if (!user || !allowedModule(user, "school-setup") || !allowedSubmodule(user, "school-setup", "attendance-policy")) {
        reject(res, 403, "You do not have permission to manage attendance policies.");
        return;
      }
      const id = typeof req.body?.id === "number" ? req.body.id : undefined;
      const parsed = insertAttendancePolicySchema.safeParse({ ...req.body, schoolId: user.schoolId });
      if (!parsed.success || id !== undefined && (!Number.isSafeInteger(id) || id < 1)) {
        reject(res, 400, "Provide a valid attendance policy.");
        return;
      }
      try {
        let saved;
        if (id) {
          const [updated] = await db.update(attendancePolicies)
            .set({ ...parsed.data, updatedAt: new Date() })
            .where(and(eq(attendancePolicies.id, id), eq(attendancePolicies.schoolId, user.schoolId)))
            .returning();
          saved = updated;
        } else {
          const [created] = await db.insert(attendancePolicies).values(parsed.data).returning();
          saved = created;
        }
        if (!saved) {
          reject(res, 404, "Attendance policy not found for this school.");
          return;
        }
        res.json(saved);
      } catch {
        reject(res, 503, "Unable to save the attendance policy.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-setup/attendance-policies/:id/delete",
    ...protect,
    requireModule("school-setup", "attendance-policy"),
    async (req, res) => {
      const user = principal(req)!;
      const id = parseId(req.params.id);
      if (!id) {
        reject(res, 400, "Invalid attendance policy ID.");
        return;
      }
      try {
        const [deleted] = await db.delete(attendancePolicies)
          .where(and(eq(attendancePolicies.id, id), eq(attendancePolicies.schoolId, user.schoolId)))
          .returning();
        if (!deleted) {
          reject(res, 404, "Attendance policy not found for this school.");
          return;
        }
        res.json({ message: "Attendance policy deleted." });
      } catch {
        reject(res, 503, "Unable to delete the attendance policy.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/student-registry",
    ...protect,
    requireModule("student-registry"),
    async (req, res) => {
      const user = principal(req)!;
      const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
      const cls = typeof req.query.class === "string" ? req.query.class : undefined;
      const section = typeof req.query.section === "string" ? req.query.section : undefined;
      const pageValue = typeof req.query.page === "string" ? Number(req.query.page) : 1;
      if (!Number.isSafeInteger(pageValue) || pageValue < 1 || pageValue > 100_000 || (section && !cls)) {
        reject(res, 400, "Provide a valid page and class/section filters.");
        return;
      }
      try {
        const [classes, sections, classSections, page] = await Promise.all([
          storage.getSchoolMetadata(user.schoolId, "classes"),
          storage.getSchoolMetadata(user.schoolId, "sections"),
          storage.getClassSectionsMap(user.schoolId),
          storage.getStudentsPaginated(user.schoolId, { q, cls, section, page: pageValue, sessionId: null }),
        ]);
        if (cls && !classes.includes(cls) || section && !(classSections[cls!] || []).includes(section)) {
          reject(res, 400, "The requested class or section is not configured for this school.");
          return;
        }
        res.json({ data: page.data.map(publicStudent), total: page.total, page: pageValue, pageSize: 50, classes, sections, classSections });
      } catch {
        reject(res, 503, "Unable to load the school-wide student registry.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/student-registry/stats",
    ...protect,
    requireModule("student-registry"),
    async (req, res) => {
      const user = principal(req)!;
      const cls = typeof req.query.class === "string" ? req.query.class : undefined;
      const section = typeof req.query.section === "string" ? req.query.section : undefined;
      if (section && !cls) {
        reject(res, 400, "A class is required when filtering student statistics by section.");
        return;
      }
      try {
        if (cls) {
          const classes = await storage.getSchoolMetadata(user.schoolId, "classes");
          const mapping = await storage.getClassSectionsMap(user.schoolId);
          if (!classes.includes(cls) || section && !(mapping[cls] || []).includes(section)) {
            reject(res, 400, "The requested class or section is not configured for this school.");
            return;
          }
        }
        res.json(await storage.getStudentStats(user.schoolId, cls, section));
      } catch {
        reject(res, 503, "Unable to load school-wide student statistics.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/student-registry/auto-assign-roll",
    ...protect,
    requireModule("student-registry", "edit"),
    async (req, res) => {
      const user = principal(req)!;
      if (user.role !== "admin") {
        reject(res, 403, "Only an administrator can assign roll numbers.");
        return;
      }
      const parsed = z.object({ class: z.string().trim().min(1), section: z.string().trim().min(1) }).safeParse(req.body);
      if (!parsed.success) {
        reject(res, 400, "Choose a configured class and section.");
        return;
      }
      try {
        const classes = await storage.getSchoolMetadata(user.schoolId, "classes");
        const mapping = await storage.getClassSectionsMap(user.schoolId);
        if (!classes.includes(parsed.data.class) || !(mapping[parsed.data.class] || []).includes(parsed.data.section)) {
          reject(res, 400, "The requested class or section is not configured for this school.");
          return;
        }
        const assigned = await storage.autoAssignRollNumbers(user.schoolId, parsed.data.class, parsed.data.section);
        res.json({ assigned, message: `Roll numbers 1–${assigned} assigned alphabetically.` });
      } catch {
        reject(res, 503, "Unable to assign roll numbers.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/student-registry/bulk-deactivate",
    ...protect,
    requireModule("student-registry", "deactivate"),
    async (req, res) => {
      const user = principal(req)!;
      if (user.role !== "admin") {
        reject(res, 403, "Only an administrator can bulk-deactivate students.");
        return;
      }
      const parsed = z.object({
        ids: z.array(z.number().int().positive()).min(1).max(500),
        reason: z.string().trim().min(2).max(300),
        batchYear: z.string().trim().min(1).max(30),
        comments: z.string().trim().min(1).max(1000),
        password: z.string().min(1).max(200),
      }).safeParse(req.body);
      if (!parsed.success) {
        reject(res, 400, "Choose unique student IDs and provide a reason, batch year, comments, and password.");
        return;
      }
      if (new Set(parsed.data.ids).size !== parsed.data.ids.length) {
        reject(res, 400, "Choose unique student IDs.");
        return;
      }
      try {
        if (!await storage.verifyAdminPassword(user.id, parsed.data.password)) {
          reject(res, 401, "Incorrect administrator password.");
          return;
        }
        const deactivated = await storage.bulkDeactivateStudents(parsed.data.ids, user.schoolId);
        await Promise.all(deactivated.map(student => storage.createAuditLog({
          schoolId: user.schoolId,
          actionType: "deactivate",
          entityType: "student",
          entityId: student.id,
          actionBy: user.id,
          actionByRole: user.role,
          details: `Student ${student.name} (${student.digitalStudentId}) deactivated. Reason: ${parsed.data.reason}. Batch: ${parsed.data.batchYear}. Comments: ${parsed.data.comments}`,
        })));
        res.json({ deactivated: deactivated.length });
      } catch {
        reject(res, 503, "Unable to bulk-deactivate the selected students.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/student-registry/students",
    ...protect,
    requireModule("student-registry", "add"),
    async (req, res) => {
      const user = principal(req)!;
      const parsed = z.object({
        name: z.string().trim().min(1).max(150),
        class: z.string().trim().min(1).max(40),
        section: z.string().trim().min(1).max(20),
        phone: z.string().regex(/^\d{10}$/),
        dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        enrollmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        gender: z.enum(["Boy", "Girl"]).optional(),
        rollNumber: z.number().int().positive().optional().nullable(),
        guardianName: z.string().max(150).optional(),
        bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional(),
        fatherName: z.string().max(150).optional(),
        motherName: z.string().max(150).optional(),
        address: z.string().max(1000).optional(),
        aadharNumber: z.string().regex(/^\d{12}$/).optional(),
        email: z.string().email().max(255).optional().or(z.literal("")),
      }).safeParse(req.body);
      if (!parsed.success || !isDate(parsed.data.dob) || parsed.data.enrollmentDate && !isDate(parsed.data.enrollmentDate)) {
        reject(res, 400, "Provide a valid student profile, phone number, and dates.");
        return;
      }
      try {
        const [classes, classSections, school] = await Promise.all([
          storage.getSchoolMetadata(user.schoolId, "classes"),
          storage.getClassSectionsMap(user.schoolId),
          storage.getSchool(user.schoolId),
        ]);
        if (!classes.includes(parsed.data.class) || !(classSections[parsed.data.class] || []).includes(parsed.data.section)) {
          reject(res, 400, "Student class and section must be configured for this school.");
          return;
        }
        if (!school) {
          reject(res, 403, "School identity could not be verified for this account.");
          return;
        }
        if (parsed.data.rollNumber) {
          const existing = await storage.getStudentsByClassSection(user.schoolId, parsed.data.class, parsed.data.section);
          if (existing.some(student => student.rollNumber === parsed.data.rollNumber)) {
            reject(res, 409, `Roll number ${parsed.data.rollNumber} is already assigned in ${parsed.data.class}-${parsed.data.section}.`);
            return;
          }
        }
        const serial = await storage.issueNextIdSerial(user.schoolId, "dsid");
        const dsid = `${school.code}-${String(serial).padStart(4, "0")}`;
        const created = await storage.createStudent({
          schoolId: user.schoolId,
          digitalStudentId: dsid,
          name: parsed.data.name,
          class: parsed.data.class,
          section: parsed.data.section,
          phone: parsed.data.phone,
          dob: parsed.data.dob,
          passwordHash: await bcrypt.hash(dsid, 10),
          isActivated: false,
          ...(parsed.data.enrollmentDate ? { enrollmentDate: parsed.data.enrollmentDate } : {}),
          ...(parsed.data.gender ? { gender: parsed.data.gender } : {}),
          ...(parsed.data.rollNumber ? { rollNumber: parsed.data.rollNumber } : {}),
          ...(parsed.data.guardianName ? { guardianName: parsed.data.guardianName } : {}),
          ...(parsed.data.bloodGroup ? { bloodGroup: parsed.data.bloodGroup } : {}),
          ...(parsed.data.fatherName ? { fatherName: parsed.data.fatherName } : {}),
          ...(parsed.data.motherName ? { motherName: parsed.data.motherName } : {}),
          ...(parsed.data.address ? { address: parsed.data.address } : {}),
          ...(parsed.data.aadharNumber ? { aadharNumber: parsed.data.aadharNumber } : {}),
          email: parsed.data.email || null,
        });
        try {
          const active = await storage.getActiveSession(user.schoolId);
          if (active) await storage.createEnrollment({
            schoolId: user.schoolId,
            studentId: created.id,
            sessionId: active.id,
            className: parsed.data.class,
            sectionName: parsed.data.section,
            ...(parsed.data.rollNumber ? { rollNo: parsed.data.rollNumber } : {}),
            status: "Active",
          });
        } catch {
          // The registry record is already durable; enrollment can be assigned from the active session workflow.
        }
        res.status(201).json(publicStudent(created));
      } catch {
        reject(res, 503, "Unable to create this student record.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/student-registry/students/:id/update",
    ...protect,
    requireModule("student-registry", "edit"),
    async (req, res) => {
      const user = principal(req)!;
      const id = parseId(req.params.id);
      const parsed = z.object({
        name: z.string().trim().min(1).max(150),
        class: z.string().trim().min(1).max(40),
        section: z.string().trim().min(1).max(20),
        phone: z.string().regex(/^\d{10}$/),
        dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        enrollmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
        gender: z.enum(["Boy", "Girl"]).optional().nullable(),
        rollNumber: z.number().int().positive().optional().nullable(),
        guardianName: z.string().max(150).optional().nullable(),
        bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional().nullable(),
        fatherName: z.string().max(150).optional().nullable(),
        motherName: z.string().max(150).optional().nullable(),
        address: z.string().max(1000).optional().nullable(),
        aadharNumber: z.string().regex(/^\d{12}$/).optional().nullable(),
        email: z.string().email().max(255).optional().nullable().or(z.literal("")),
      }).safeParse(req.body);
      if (!id || !parsed.success || !isDate(parsed.data.dob)
        || parsed.data.enrollmentDate && parsed.data.enrollmentDate !== "" && !isDate(parsed.data.enrollmentDate)) {
        reject(res, 400, "Provide a valid student ID and profile fields.");
        return;
      }
      try {
        const [classes, classSections] = await Promise.all([
          storage.getSchoolMetadata(user.schoolId, "classes"),
          storage.getClassSectionsMap(user.schoolId),
        ]);
        if (!classes.includes(parsed.data.class) || !(classSections[parsed.data.class] || []).includes(parsed.data.section)) {
          reject(res, 400, "Student class and section must be configured for this school.");
          return;
        }
        if (parsed.data.rollNumber) {
          const existing = await storage.getStudentsByClassSection(user.schoolId, parsed.data.class, parsed.data.section);
          if (existing.some(student => student.id !== id && student.rollNumber === parsed.data.rollNumber)) {
            reject(res, 409, `Roll number ${parsed.data.rollNumber} is already assigned in ${parsed.data.class}-${parsed.data.section}.`);
            return;
          }
        }
        const updated = await storage.updateStudent(id, user.schoolId, {
          ...parsed.data,
          enrollmentDate: parsed.data.enrollmentDate || undefined,
          rollNumber: parsed.data.rollNumber ?? null,
          fatherName: parsed.data.fatherName ?? null,
          motherName: parsed.data.motherName ?? null,
          address: parsed.data.address ?? null,
          aadharNumber: parsed.data.aadharNumber ?? null,
          email: parsed.data.email || null,
        });
        if (!updated) {
          reject(res, 404, "Student not found for this school.");
          return;
        }
        res.json(publicStudent(updated));
      } catch {
        reject(res, 503, "Unable to update this student record.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/student-registry/students/:id/deactivate",
    ...protect,
    requireModule("student-registry", "deactivate"),
    async (req, res) => {
      const user = principal(req)!;
      const id = parseId(req.params.id);
      const parsed = z.object({
        password: z.string().min(1).max(200),
        reason: z.string().trim().min(3).max(500),
      }).safeParse(req.body);
      if (!id || !parsed.success) {
        reject(res, 400, "A student ID, account password, and deactivation reason are required.");
        return;
      }
      try {
        const passwordMatches = user.role === "admin"
          ? await storage.verifyAdminPassword(user.principalId, parsed.data.password)
          : await (async () => {
              const staff = await storage.getNonTeachingStaffById(user.entityId ?? user.id);
              return !!staff?.passwordHash && staff.schoolId === user.schoolId
                && await bcrypt.compare(parsed.data.password, staff.passwordHash);
            })();
        if (!passwordMatches) {
          reject(res, 403, "The account password is incorrect.");
          return;
        }
        const existing = await storage.getStudentsByIdsForSchool([id], user.schoolId);
        const student = existing.find(item => item.id === id);
        if (!student || !student.isActive) {
          reject(res, 404, "Active student not found for this school.");
          return;
        }
        const deactivated = await storage.deactivateStudent(id, user.schoolId);
        const active = await storage.getActiveSession(user.schoolId);
        await storage.createAuditLog({
          schoolId: user.schoolId,
          sessionId: active?.id ?? null,
          actionType: "deactivate",
          entityType: "student",
          entityId: id,
          actionBy: user.id,
          actionByRole: user.role,
          details: `Student ${student.name} (${student.digitalStudentId}) deactivated. Reason: ${parsed.data.reason}`,
        });
        res.json(publicStudent(deactivated));
      } catch {
        reject(res, 503, "Unable to deactivate this student.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/attendance-overview",
    ...protect,
    requireModule("attendance-overview"),
    requireExamSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = examSession(req, user.schoolId);
      const date = req.query.date;
      const cls = typeof req.query.class === "string" ? req.query.class : "";
      const section = typeof req.query.section === "string" ? req.query.section : "";
      if (!session) {
        reject(res, 403, "A school-scoped academic session is required.");
        return;
      }
      if (typeof date !== "string" || !isDate(date)) {
        reject(res, 400, "A valid attendance date in YYYY-MM-DD format is required.");
        return;
      }
      if (date < String(session.startDate) || date > String(session.endDate)) {
        reject(res, 400, "Attendance date must fall within the selected academic session.");
        return;
      }
      if (!!cls !== !!section) {
        reject(res, 400, "Class and section filters must be supplied together.");
        return;
      }
      try {
        const [classes, classSections, population, overview, teachers, selfRows, mappingRows, correctionRows, studentRecords, policies] = await Promise.all([
          storage.getSchoolMetadata(user.schoolId, "classes"),
          storage.getClassSectionsMap(user.schoolId),
          storage.getAttendancePopulationForSession(user.schoolId, session.id),
          storage.getDailyAttendanceSummary(user.schoolId, session.id, date),
          storage.getTeachersBySchool(user.schoolId),
          db.select().from(teacherSelfAttendance).where(and(
            eq(teacherSelfAttendance.schoolId, user.schoolId),
            eq(teacherSelfAttendance.attendanceDate, date),
            eq(teacherSelfAttendance.sessionId, session.id),
          )),
          db.select().from(facultyMappings).where(eq(facultyMappings.schoolId, user.schoolId)),
          db.select().from(attendanceCorrectionRequests).where(and(
            eq(attendanceCorrectionRequests.schoolId, user.schoolId),
            eq(attendanceCorrectionRequests.attendanceDate, date),
            eq(attendanceCorrectionRequests.sessionId, session.id),
          )),
          db.select().from(attendanceRecords).where(and(
            eq(attendanceRecords.schoolId, user.schoolId),
            eq(attendanceRecords.date, date),
            eq(attendanceRecords.sessionId, session.id),
          )),
          db.select().from(attendancePolicies).where(and(
            eq(attendancePolicies.schoolId, user.schoolId),
            eq(attendancePolicies.targetRole, "STUDENT"),
            eq(attendancePolicies.isActive, true),
          )),
        ]);
        if (cls && (!classes.includes(cls) || !(classSections[cls] || []).includes(section))) {
          reject(res, 400, "The selected class and section are not configured for this school.");
          return;
        }
        const selfByTeacher = new Map(selfRows.map(record => [record.teacherId, record]));
        const subjectsByTeacher = new Map<number, Set<string>>();
        const classesByTeacher = new Map<number, Set<string>>();
        for (const mapping of mappingRows) {
          const subjects = subjectsByTeacher.get(mapping.teacherId) ?? new Set<string>();
          if (mapping.subject) subjects.add(mapping.subject);
          subjectsByTeacher.set(mapping.teacherId, subjects);
          const assigned = classesByTeacher.get(mapping.teacherId) ?? new Set<string>();
          assigned.add(`${mapping.className}-${mapping.section}`);
          classesByTeacher.set(mapping.teacherId, assigned);
        }
        const correctionCounts = new Map<number, number>();
        for (const correction of correctionRows) correctionCounts.set(correction.teacherId, (correctionCounts.get(correction.teacherId) ?? 0) + 1);
        const submittedAtByTeacher = new Map<number, Date>();
        for (const record of studentRecords) {
          if (!record.markedAt) continue;
          const earlier = submittedAtByTeacher.get(record.teacherId);
          if (!earlier || record.markedAt < earlier) submittedAtByTeacher.set(record.teacherId, record.markedAt);
        }
        const teacherRows = teachers.map(teacher => {
          const self = selfByTeacher.get(teacher.id);
          const mappedSubjects = [...(subjectsByTeacher.get(teacher.id) || [])];
          const teacherCorrections = correctionCounts.get(teacher.id) || 0;
          const status = self?.status || "Not Marked";
          return {
            teacherId: teacher.id,
            name: teacher.fullName,
            digitalTeacherId: teacher.digitalTeacherId || null,
            assignedClass: teacher.assignedClass || "",
            assignedSection: teacher.assignedSection || "",
            assignedClassSections: [...(classesByTeacher.get(teacher.id) || [])].sort(),
            subject: mappedSubjects[0] || teacher.subject || "",
            subjects: mappedSubjects.length ? mappedSubjects : teacher.subject ? [teacher.subject] : [],
            department: mappedSubjects[0] || teacher.department || "",
            selfStatus: status,
            selfCheckIn: self?.checkInTime || null,
            selfCheckOut: self?.checkOutTime || null,
            selfWorkedMinutes: self?.totalWorkingMinutes || 0,
            isLate: status === "Late",
            hasCorrectionAudit: teacherCorrections > 0,
            correctionCount: teacherCorrections,
            studentMarkStatus: submittedAtByTeacher.has(teacher.id) ? "marked" : "not-marked",
            submittedAt: submittedAtByTeacher.get(teacher.id)?.toISOString() || null,
          };
        });
        const teacherSummary = {
          totalFaculty: teacherRows.length,
          present: teacherRows.filter(row => row.selfStatus === "Present").length,
          notMarked: teacherRows.filter(row => row.selfStatus === "Not Marked").length,
          lateArrivals: teacherRows.filter(row => row.selfStatus === "Late").length,
          pendingCorrections: correctionRows.filter(row => row.status.toLowerCase() === "pending").length,
          totalCorrections: correctionRows.length,
        };
        let classDetail = null;
        if (cls && section) {
          const [roster, records, profileRows, workingDates] = await Promise.all([
            storage.getAttendanceReportRosterForSessionClass(user.schoolId, session.id, cls, section),
            storage.getAttendanceHistory(user.schoolId, session.id, cls, section, date, date),
            db.select({ studentId: studentProfiles.studentId, rollNo: studentProfiles.rollNo })
              .from(studentProfiles)
              .where(inArray(studentProfiles.studentId, (await storage.getAttendanceReportRosterForSessionClass(user.schoolId, session.id, cls, section)).map(student => student.id).filter(id => id > 0))),
            getStudentAttendanceWorkingDates({ schoolId: user.schoolId, sessionId: session.id, class: cls, section, startDate: date, endDate: date }),
          ]);
          const profileByStudent = new Map(profileRows.map(profile => [profile.studentId, profile.rollNo || ""]));
          const recordByIdentity = new Map(records.map(record => [record.identityKey, record]));
          const detailStudents = roster.map(student => ({
            studentId: student.id,
            identityKey: student.identityKey,
            name: student.name,
            photoUrl: student.photoUrl,
            digitalStudentId: student.digitalStudentId,
            rollNo: student.id > 0 ? profileByStudent.get(student.id) || "" : "",
            status: recordByIdentity.get(student.identityKey)?.status || "not-marked",
          }));
          const summary = aggregateStudentAttendance({
            schoolId: user.schoolId,
            sessionId: session.id,
            statuses: workingDates.length
              ? detailStudents.map(student => student.status === "not-marked" ? null : student.status)
              : [],
          });
          const submitted = records.filter(record => record.markedAt).sort((a, b) =>
            new Date(a.markedAt as Date).getTime() - new Date(b.markedAt as Date).getTime());
          const edited = records.filter(record => (record.editCount || 0) > 0 && record.markedAt).sort((a, b) =>
            new Date(b.markedAt as Date).getTime() - new Date(a.markedAt as Date).getTime());
          classDetail = {
            meta: {
              isSubmitted: records.length > 0,
              submittedBy: submitted[0]?.markedBy || null,
              submittedAt: submitted[0]?.markedAt?.toISOString() || null,
              lastModifiedAt: edited[0]?.markedAt?.toISOString() || null,
              modifiedBy: edited[0]?.markedBy || null,
            },
            students: detailStudents.map(({ identityKey: _identityKey, ...student }) => student),
            summary: { percentage: summary.percentage },
          };
        }
        const applicablePolicy = policies.find(policy => policy.applicableClasses.length === 0
          || (cls && policy.applicableClasses.includes(cls)))
          || policies.find(policy => policy.applicableClasses.length === 0);
        res.json({
          session: { id: session.id, sessionName: session.sessionName, isActive: session.isActive, startDate: session.startDate, endDate: session.endDate },
          config: { classes, classSections },
          overview: { enrolledTotal: population, ...overview },
          teacherSummary: { summary: teacherSummary, teachers: teacherRows },
          studentPolicy: { attendanceTarget: applicablePolicy?.attendanceTarget ?? 85 },
          classDetail,
        });
      } catch {
        reject(res, 503, "Unable to load attendance overview for the selected school session.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/exam-controller",
    ...protect,
    requireModule("exam-controller"),
    requireExamSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = examSession(req, user.schoolId);
      if (!session) {
        reject(res, 403, "A school-scoped academic session is required.");
        return;
      }
      try {
        const [classes, sections, examTypes, classSections, gradingTiers, examPolicyTiers] = await Promise.all([
          storage.getSchoolMetadata(user.schoolId, "classes"),
          storage.getSchoolMetadata(user.schoolId, "sections"),
          storage.getSchoolMetadata(user.schoolId, "exam_types"),
          storage.getClassSectionsMap(user.schoolId),
          storage.getGradingTiers(user.schoolId),
          storage.getExamPolicyTiers(user.schoolId),
        ]);
        res.json({ session: { id: session.id, sessionName: session.sessionName, isActive: session.isActive }, classes, sections, examTypes, classSections, gradingTiers, examPolicyTiers });
      } catch {
        reject(res, 503, "Unable to load the Exam Controller configuration.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/exam-controller/ledger",
    ...protect,
    requireModule("exam-controller", "ledger"),
    requireExamSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = examSession(req, user.schoolId);
      const term = req.query.term;
      if (!session) {
        reject(res, 403, "A school-scoped academic session is required.");
        return;
      }
      if (typeof term !== "string" || !term.trim()) {
        reject(res, 400, "An exam type is required.");
        return;
      }
      try {
        const configuredTerms = await storage.getSchoolMetadata(user.schoolId, "exam_types");
        if (!configuredTerms.includes(term)) {
          reject(res, 400, "The selected exam type is not configured for this school.");
          return;
        }
        const [scopedRows, legacyRows] = await Promise.all([
          storage.getLedgerStatus(user.schoolId, isolatedTerm(session.id, term), session.id),
          storage.getLedgerStatus(user.schoolId, term, session.id),
        ]);
        const byCohort = new Map<string, (typeof scopedRows)[number]>();
        for (const row of legacyRows) byCohort.set(`${row.class}|${row.section}`, row);
        for (const row of scopedRows) {
          const key = `${row.class}|${row.section}`;
          const old = byCohort.get(key);
          if (!old || row.status !== "none" || !old.totalStudents) byCohort.set(key, row);
        }
        res.json({ term, rows: [...byCohort.values()].map(row => ({ ...row, term })) });
      } catch {
        reject(res, 503, "Unable to load session-scoped promotion ledger status.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/exam-controller/cohort",
    ...protect,
    requireModule("exam-controller", "wizard"),
    requireExamSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = examSession(req, user.schoolId);
      const cls = req.query.class;
      const section = req.query.section;
      const term = req.query.term;
      if (!session) {
        reject(res, 403, "A school-scoped academic session is required.");
        return;
      }
      if (typeof cls !== "string" || !cls.trim() || typeof section !== "string" || !section.trim()
        || typeof term !== "string" || !term.trim()) {
        reject(res, 400, "class, section and exam type are required.");
        return;
      }
      try {
        const [configuredClasses, classSections, configuredTerms, configuredSubjects, subjectsByClass, classOrder] = await Promise.all([
          storage.getSchoolMetadata(user.schoolId, "classes"),
          storage.getClassSectionsMap(user.schoolId),
          storage.getSchoolMetadata(user.schoolId, "exam_types"),
          storage.getSchoolMetadata(user.schoolId, "subjects"),
          storage.getClassSubjectsMap(user.schoolId),
          storage.getSchoolMetadata(user.schoolId, "classes"),
        ]);
        if (!configuredClasses.includes(cls) || !configuredTerms.includes(term)
          || !(classSections[cls] || []).includes(section)) {
          reject(res, 400, "The requested class, section or exam type is not configured for this school.");
          return;
        }
        const passPolicy = await storage.resolveClassPassPolicy(user.schoolId, cls);
        if (!passPolicy) {
          reject(res, 409, `No grading tier is configured for ${cls}.`);
          return;
        }
        const [rawStudents, scopedLedger, legacyLedger] = await Promise.all([
          storage.getExamAggregated(user.schoolId, cls, section, term, session.id),
          storage.getPromotionDecisions(user.schoolId, cls, section, isolatedTerm(session.id, term), session.id),
          storage.getPromotionDecisions(user.schoolId, cls, section, term, session.id),
        ]);
        const ledgerRows = scopedLedger.length ? scopedLedger : legacyLedger;
        const ledgerByStudent = new Map(ledgerRows.map(row => [row.studentId, row]));
        const normalizedClass = cls.trim().toLowerCase().replace(/^class\s+/, "");
        const mappedClassEntry = Object.entries(subjectsByClass).find(([name]) =>
          name.trim().toLowerCase().replace(/^class\s+/, "") === normalizedClass);
        const applicableSubjects = mappedClassEntry?.[1]?.length ? mappedClassEntry[1] : configuredSubjects;
        const presentSubjects = new Set(rawStudents.flatMap(student => student.subjects));
        const missingSubjects = applicableSubjects.filter(subject => !presentSubjects.has(subject));
        const studentsWithGrades = await Promise.all(rawStudents.map(async student => {
          const grade = await storage.resolveGrade(user.schoolId, cls, student.percentage);
          const ledger = ledgerByStudent.get(student.studentId);
          return {
            ...student,
            gradeLabel: grade?.gradeLabel ?? null,
            gradePoint: grade?.gradePoint ?? null,
            gradeRemarks: grade?.remarks ?? null,
            tierPassThreshold: passPolicy.passPercentage,
            ledger: ledger ? {
              studentId: ledger.studentId,
              decision: ledger.decision,
              targetClass: ledger.targetClass,
              targetSection: ledger.targetSection,
              autoSuggestion: ledger.autoSuggestion,
              manualIntervention: ledger.manualIntervention,
              locked: ledger.locked,
              lockedAt: ledger.lockedAt,
              adminExecuted: ledger.adminExecuted,
            } : null,
          };
        }));
        const threshold = passPolicy.passPercentage;
        const classes = classOrder;
        const classIndex = classes.findIndex(name => name === cls);
        const nextClass = classIndex >= 0 && classIndex < classes.length - 1 ? classes[classIndex + 1] : cls;
        res.json({ class: cls, section, term, sessionId: session.id, students: studentsWithGrades, missingSubjects, passThreshold: threshold, nextClass });
      } catch {
        reject(res, 503, "Unable to load exam results for this class and session.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/exam-controller/decision",
    ...protect,
    requireModule("exam-controller", "wizard"),
    requireExamSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = examSession(req, user.schoolId);
      if (!session) {
        reject(res, 403, "A school-scoped academic session is required.");
        return;
      }
      if (!session.isActive) {
        reject(res, 403, "Exam decisions cannot be changed for an archived academic session.");
        return;
      }
      const parsed = z.object({
        class: z.string().trim().min(1).max(80),
        section: z.string().trim().min(1).max(40),
        term: z.string().trim().min(1).max(80),
        studentId: z.number().int().positive(),
        decision: z.enum(["promote", "retain", "grace_pass"]),
        targetClass: z.string().trim().min(1).max(80),
        targetSection: z.string().trim().min(1).max(40),
      }).safeParse(req.body);
      if (!parsed.success) {
        reject(res, 400, "Provide a valid student decision and destination.");
        return;
      }
      const { class: cls, section, term, studentId, decision, targetClass, targetSection } = parsed.data;
      try {
        const [configuredClasses, classSections, configuredTerms, scores, passPolicy, prior] = await Promise.all([
          storage.getSchoolMetadata(user.schoolId, "classes"),
          storage.getClassSectionsMap(user.schoolId),
          storage.getSchoolMetadata(user.schoolId, "exam_types"),
          storage.getExamAggregated(user.schoolId, cls, section, term, session.id),
          storage.resolveClassPassPolicy(user.schoolId, cls),
          storage.getPromotionDecisions(user.schoolId, cls, section, isolatedTerm(session.id, term), session.id),
        ]);
        const student = scores.find(item => item.studentId === studentId);
        if (!student || !configuredTerms.includes(term) || !(classSections[cls] || []).includes(section)) {
          reject(res, 404, "Student result not found for this class, exam type and academic session.");
          return;
        }
        if (!configuredClasses.includes(targetClass) || !(classSections[targetClass] || []).includes(targetSection)) {
          reject(res, 400, "The destination class and section must be configured for this school.");
          return;
        }
        const autoSuggestion = passPolicy && student.percentage >= passPolicy.passPercentage ? "promoted" : "retained";
        await storage.savePromotionDecisions(
          user.schoolId,
          cls,
          section,
          isolatedTerm(session.id, term),
          user.id,
          true,
          [{
            studentId,
            decision: decision === "retain" ? "retained" : decision === "grace_pass" ? "grace_pass" : "promoted",
            targetClass,
            targetSection,
            editCount: (prior.find(item => item.studentId === studentId)?.editCount ?? 0) + 1,
            autoSuggestion,
          }],
          session.id,
        );
        res.json({ message: "Session-scoped exam decision saved.", sessionId: session.id });
      } catch {
        reject(res, 503, "Unable to save the exam decision.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/exam-controller/decision/clear",
    ...protect,
    requireModule("exam-controller", "wizard"),
    requireExamSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = examSession(req, user.schoolId);
      if (!session || !session.isActive) {
        reject(res, 403, "Exam decisions can only be cleared in an active academic session.");
        return;
      }
      const parsed = z.object({
        class: z.string().trim().min(1).max(80),
        section: z.string().trim().min(1).max(40),
        term: z.string().trim().min(1).max(80),
        studentId: z.number().int().positive(),
      }).safeParse(req.body);
      if (!parsed.success) {
        reject(res, 400, "Provide the class, section, exam term, and student ID.");
        return;
      }
      try {
        const [configuredTerms, mapping, prior] = await Promise.all([
          storage.getSchoolMetadata(user.schoolId, "exam_types"),
          storage.getClassSectionsMap(user.schoolId),
          storage.getPromotionDecisions(user.schoolId, parsed.data.class, parsed.data.section, isolatedTerm(session.id, parsed.data.term), session.id),
        ]);
        if (!configuredTerms.includes(parsed.data.term) || !(mapping[parsed.data.class] || []).includes(parsed.data.section)) {
          reject(res, 400, "The exam cohort is not configured for this school.");
          return;
        }
        const decision = prior.find(item => item.studentId === parsed.data.studentId);
        if (decision?.adminExecuted) {
          reject(res, 409, "An executed promotion decision cannot be cleared.");
          return;
        }
        if (decision) {
          await db.delete(promotionDecisions).where(and(
            eq(promotionDecisions.schoolId, user.schoolId),
            eq(promotionDecisions.sessionId, session.id),
            eq(promotionDecisions.class, parsed.data.class),
            eq(promotionDecisions.section, parsed.data.section),
            eq(promotionDecisions.term, isolatedTerm(session.id, parsed.data.term)),
            eq(promotionDecisions.studentId, parsed.data.studentId),
          ));
        }
        res.json({ message: "Session-scoped exam decision cleared.", sessionId: session.id });
      } catch {
        reject(res, 503, "Unable to clear the exam decision.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/exam-controller/execute",
    ...protect,
    requireModule("exam-controller", "wizard"),
    requireExamSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = examSession(req, user.schoolId);
      if (!session) {
        reject(res, 403, "A school-scoped academic session is required.");
        return;
      }
      if (!session.isActive) {
        reject(res, 403, "Promotion execution is disabled for an archived academic session.");
        return;
      }
      const parsed = z.object({
        class: z.string().trim().min(1).max(80),
        section: z.string().trim().min(1).max(40),
        term: z.string().trim().min(1).max(80),
        studentIds: z.array(z.number().int().positive()).optional(),
      }).safeParse(req.body);
      if (!parsed.success) {
        reject(res, 400, "Provide a class, section, exam type, and optional student ID selection.");
        return;
      }
      const cls = parsed.data.class;
      const section = parsed.data.section;
      const term = parsed.data.term;
      try {
        const configuredTerms = await storage.getSchoolMetadata(user.schoolId, "exam_types");
        const configuredClasses = await storage.getSchoolMetadata(user.schoolId, "classes");
        const classSections = await storage.getClassSectionsMap(user.schoolId);
        if (!configuredTerms.includes(term) || !configuredClasses.includes(cls) || !(classSections[cls] || []).includes(section)) {
          reject(res, 400, "The requested promotion cohort is not configured for this school.");
          return;
        }
        const passPolicy = await storage.resolveClassPassPolicy(user.schoolId, cls);
        if (!passPolicy) {
          reject(res, 409, `No grading tier is configured for ${cls}.`);
          return;
        }
        const cohort = await storage.getExamAggregated(user.schoolId, cls, section, term, session.id);
        const selectedIds = parsed.data.studentIds ?? cohort.map(student => student.studentId);
        if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length
          || selectedIds.some(id => !cohort.some(student => student.studentId === id))) {
          reject(res, 400, "Every selected student must have results in this class, exam type, and academic session.");
          return;
        }
        const [scopedDecisions, legacyDecisions, rules, scoreRows, studentRows] = await Promise.all([
          storage.getPromotionDecisions(user.schoolId, cls, section, isolatedTerm(session.id, term), session.id),
          storage.getPromotionDecisions(user.schoolId, cls, section, term, session.id),
          storage.getGradingRules(user.schoolId, passPolicy.id),
          db.select({
            studentId: examScores.studentId, subject: examScores.subject, marks: examScores.marks,
            totalMarks: examScores.totalMarks, isAbsent: examScores.isAbsent,
          }).from(examScores).where(and(
            eq(examScores.schoolId, user.schoolId),
            eq(examScores.class, cls),
            eq(examScores.section, section),
            eq(examScores.examType, term),
            eq(examScores.sessionId, session.id),
            inArray(examScores.studentId, selectedIds),
          )),
          db.select().from(students).where(and(
            eq(students.schoolId, user.schoolId),
            eq(students.class, cls),
            eq(students.section, section),
            inArray(students.id, selectedIds),
          )),
        ]);
        const savedDecisions = scopedDecisions.length ? scopedDecisions : legacyDecisions;
        if (savedDecisions.some(item => selectedIds.includes(item.studentId) && item.adminExecuted)) {
          reject(res, 409, "One or more selected students have already been executed in this academic session.");
          return;
        }
        if (studentRows.length !== selectedIds.length) {
          reject(res, 409, "One or more selected students are no longer enrolled in this cohort.");
          return;
        }
        const classIndex = configuredClasses.findIndex(name => name === cls);
        const defaultNextClass = classIndex >= 0 && classIndex < configuredClasses.length - 1
          ? configuredClasses[classIndex + 1] : cls;
        const decisionByStudent = new Map(savedDecisions.map(item => [item.studentId, item]));
        const scoreByStudent = new Map<number, typeof scoreRows>();
        for (const score of scoreRows) {
          const list = scoreByStudent.get(score.studentId) ?? [];
          list.push(score);
          scoreByStudent.set(score.studentId, list);
        }
        const now = new Date();
        const historyRows = selectedIds.map(studentId => {
          const studentResult = cohort.find(item => item.studentId === studentId)!;
          const saved = decisionByStudent.get(studentId);
          const retained = saved?.decision === "retained";
          const targetClass = retained ? cls : saved?.targetClass || defaultNextClass;
          const targetSection = retained ? section : saved?.targetSection || section;
          const percentage = Math.round(studentResult.percentage);
          const grade = rules.find(rule => percentage >= Number(rule.minPercent) && percentage <= Number(rule.maxPercent));
          const breakdown = scoreByStudent.get(studentId) ?? [];
          return {
            schoolId: user.schoolId,
            sessionId: session.id,
            studentId,
            fromClass: cls,
            fromSection: section,
            toClass: targetClass,
            toSection: targetSection,
            examType: term,
            totalObtained: studentResult.totalObtained,
            totalMax: studentResult.totalMax,
            percentage,
            gradeLabel: grade?.gradeLabel ?? null,
            gradePoint: grade?.gradePoint ?? null,
            remarks: grade?.remarks ?? null,
            snapshotJson: {
              archivedAt: now.toISOString(),
              adminId: user.id,
              schoolId: user.schoolId,
              sessionId: session.id,
              studentDsid: studentResult.dsid,
              studentName: studentResult.name,
              fromClass: cls,
              fromSection: section,
              toClass: targetClass,
              toSection: targetSection,
              examType: term,
              term,
              totalObtained: studentResult.totalObtained,
              totalMax: studentResult.totalMax,
              percentage,
              gradeLabel: grade?.gradeLabel ?? null,
              gradePoint: grade?.gradePoint ?? null,
              gradeRemarks: grade?.remarks ?? null,
              examBreakdown: breakdown,
            },
          };
        });
        if (historyRows.some(history =>
          !configuredClasses.includes(history.toClass)
          || !(classSections[history.toClass] || []).includes(history.toSection)
        )) {
          reject(res, 409, "A saved promotion destination is no longer configured for this school.");
          return;
        }
        const promoted = await db.transaction(async (tx) => {
          await tx.insert(academicHistory).values(historyRows);
          for (const history of historyRows) {
            const updated = await tx.update(students)
              .set({ class: history.toClass, section: history.toSection, idCardPendingReissue: true })
              .where(and(
                eq(students.id, history.studentId),
                eq(students.schoolId, user.schoolId),
                eq(students.class, cls),
                eq(students.section, section),
              ))
              .returning({ id: students.id });
            if (!updated.length) throw new Error("Student cohort changed during promotion.");
            const previous = decisionByStudent.get(history.studentId);
            const autoSuggestion = studentResultFor(history.studentId).percentage >= passPolicy.passPercentage ? "promoted" : "retained";
            await tx.insert(promotionDecisions).values({
              schoolId: user.schoolId,
              class: cls,
              section,
              term: isolatedTerm(session.id, term),
              studentId: history.studentId,
              decision: previous?.decision ?? autoSuggestion,
              targetClass: history.toClass,
              targetSection: history.toSection,
              editCount: previous?.editCount ?? 0,
              processedByTeacherId: null,
              locked: true,
              lockedAt: now,
              autoSuggestion,
              manualIntervention: !!previous?.manualIntervention,
              adminExecuted: true,
              adminExecutedAt: now,
              updatedAt: now,
              sessionId: session.id,
            }).onConflictDoUpdate({
              target: [promotionDecisions.schoolId, promotionDecisions.class, promotionDecisions.section, promotionDecisions.term, promotionDecisions.studentId],
              set: {
                targetClass: history.toClass,
                targetSection: history.toSection,
                locked: true,
                lockedAt: now,
                adminExecuted: true,
                adminExecutedAt: now,
                updatedAt: now,
                sessionId: session.id,
              },
            });
          }
          return historyRows.length;
        });
        res.json({ message: "Promotion executed and session history archived.", promoted, sessionId: session.id });
        function studentResultFor(studentId: number) {
          return cohort.find(item => item.studentId === studentId)!;
        }
      } catch (error) {
        reject(res, 503, error instanceof Error && error.message === "Student cohort changed during promotion."
          ? error.message : "Unable to execute promotion for this academic session.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/exam-controller/ledger/delete",
    ...protect,
    requireModule("exam-controller", "ledger"),
    requireExamSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = examSession(req, user.schoolId);
      if (!session) {
        reject(res, 403, "A school-scoped academic session is required.");
        return;
      }
      if (!session.isActive) {
        reject(res, 403, "Promotion ledger deletion is disabled for an archived academic session.");
        return;
      }
      const term = z.string().trim().min(1).max(80).safeParse(req.body?.term);
      if (!term.success) {
        reject(res, 400, "An exam type is required.");
        return;
      }
      try {
        const configuredTerms = await storage.getSchoolMetadata(user.schoolId, "exam_types");
        if (!configuredTerms.includes(term.data)) {
          reject(res, 400, "The selected exam type is not configured for this school.");
          return;
        }
        await db.delete(promotionDecisions).where(and(
          eq(promotionDecisions.schoolId, user.schoolId),
          eq(promotionDecisions.sessionId, session.id),
          inArray(promotionDecisions.term, [isolatedTerm(session.id, term.data), term.data]),
        ));
        res.json({ message: "Session promotion ledger deleted." });
      } catch {
        reject(res, 503, "Unable to delete the promotion ledger.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/exam-controller/history",
    ...protect,
    requireModule("exam-controller", "history"),
    requireExamSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = examSession(req, user.schoolId);
      if (!session) {
        reject(res, 403, "A school-scoped academic session is required.");
        return;
      }
      const parsedStudentId = req.query.studentId === undefined ? undefined : parseId(req.query.studentId);
      if (req.query.studentId !== undefined && !parsedStudentId) {
        reject(res, 400, "Invalid student ID.");
        return;
      }
      const studentId: number | undefined = parsedStudentId ?? undefined;
      try {
        res.json(await storage.getAcademicHistory(user.schoolId, studentId, session.id));
      } catch {
        reject(res, 503, "Unable to load session-scoped promotion history.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/audit-logs",
    ...protect,
    requireModule("audit-logs", "view"),
    requireLiveSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      try {
        const session = selectedSession(req);
        if (!session || session.schoolId !== user.schoolId) {
          reject(res, 403, "A school-scoped academic session is required.");
          return;
        }
        res.json(await storage.getAuditLogsBySchool(user.schoolId, 100, session.id));
      } catch {
        reject(res, 503, "Unable to load the audit trail.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/visitor-log",
    ...protect,
    requireModule("visitor-log"),
    requireLiveSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      try {
        const session = selectedSession(req);
        if (!session || session.schoolId !== user.schoolId) {
          reject(res, 403, "A school-scoped academic session is required.");
          return;
        }
        res.json(await storage.getVisitorLogsBySchool(user.schoolId, session.id));
      } catch {
        reject(res, 503, "Unable to load the visitor log.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/visitor-log/check-in",
    ...protect,
    requireModule("visitor-log", "checkin"),
    requireLiveSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = selectedSession(req);
      const parsed = visitorInput.safeParse(req.body);
      if (!session || session.schoolId !== user.schoolId) {
        reject(res, 403, "A school-scoped academic session is required.");
        return;
      }
      if (!session.isActive) {
        reject(res, 403, "Visitor check-in is disabled for an archived academic session.");
        return;
      }
      if (!parsed.success) {
        reject(res, 400, "Visitor name, purpose and host are required; optional contact details must be valid.");
        return;
      }
      try {
        const entry = await storage.createVisitorLog({
          schoolId: user.schoolId,
          sessionId: session.id,
          visitorName: parsed.data.visitorName,
          purpose: parsed.data.purpose,
          hostName: parsed.data.hostName,
          phone: parsed.data.phone || null,
          email: parsed.data.email || null,
          visitorIdNumber: parsed.data.visitorIdNumber || null,
          address: parsed.data.address || null,
          badge: null,
        });
        await storage.createAuditLog({
          schoolId: user.schoolId,
          sessionId: session.id,
          actionType: "checkin",
          entityType: "visitor",
          entityId: entry.id,
          actionBy: user.id,
          actionByRole: user.role,
          details: `Visitor checked in: ${parsed.data.visitorName}`,
        });
        res.status(201).json(entry);
      } catch {
        reject(res, 503, "Unable to check in this visitor.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/visitor-log/:id/check-out",
    ...protect,
    requireModule("visitor-log", "checkout"),
    requireLiveSession(requireAcademicSession),
    async (req, res) => {
      const user = principal(req)!;
      const session = selectedSession(req);
      const id = parseId(req.params.id);
      if (!id) {
        reject(res, 400, "Invalid visitor entry ID.");
        return;
      }
      if (!session || session.schoolId !== user.schoolId) {
        reject(res, 403, "A school-scoped academic session is required.");
        return;
      }
      if (!session.isActive) {
        reject(res, 403, "Visitor check-out is disabled for an archived academic session.");
        return;
      }
      try {
        const entries = await storage.getVisitorLogsBySchool(user.schoolId, session.id);
        const existing = entries.find((entry) => entry.id === id);
        if (!existing || existing.checkOut) {
          reject(res, 404, "Active visitor entry not found for this school and session.");
          return;
        }
        const entry = await storage.checkoutVisitor(id);
        await storage.createAuditLog({
          schoolId: user.schoolId,
          sessionId: session.id,
          actionType: "checkout",
          entityType: "visitor",
          entityId: entry.id,
          actionBy: user.id,
          actionByRole: user.role,
          details: `Visitor checked out: ${entry.visitorName}`,
        });
        res.json(entry);
      } catch {
        reject(res, 503, "Unable to check out this visitor.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/school-calendar",
    ...protect,
    requireModule("school-calendar"),
    async (req, res) => {
      const user = principal(req)!;
      const month = req.query.month;
      if (typeof month !== "string" || !monthRange(month)) {
        reject(res, 400, "month must use YYYY-MM format.");
        return;
      }
      try {
        const range = monthRange(month)!;
        const [events, classes, classSections] = await Promise.all([
          storage.getCalendarEventsByRange(user.schoolId, range.from, range.to),
          storage.getSchoolMetadata(user.schoolId, "classes"),
          storage.getClassSectionsMap(user.schoolId),
        ]);
        res.json({ events, classes, classSections });
      } catch {
        reject(res, 503, "Unable to load the school calendar.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-calendar",
    ...protect,
    requireModule("school-calendar", "events"),
    async (req, res) => {
      const user = principal(req)!;
      const parsed = calendarInput.safeParse(req.body);
      if (!parsed.success) {
        reject(res, 400, "Enter a title and valid event date.");
        return;
      }
      const startDate = parsed.data.date ?? parsed.data.startDate;
      const endDate = parsed.data.endDate || startDate;
      if (!isSupportedCalendarDate(startDate) || !isSupportedCalendarDate(endDate) || startDate > endDate) {
        reject(res, 400, "Choose a valid 2026–2126 date range with an end date on or after the start date.");
        return;
      }
      const payload = calendarPayload(user.schoolId, parsed.data);
      if ((payload.audienceScope === "Entire_Class" || payload.audienceScope === "Specific_Section")
        && !payload.targetClass) {
        reject(res, 400, "Choose a class for a class- or section-specific event.");
        return;
      }
      if (payload.audienceScope === "Specific_Section" && !payload.targetSection) {
        reject(res, 400, "Choose a section for a section-specific event.");
        return;
      }
      const dates = expandDates(startDate, endDate, payload.isRecurring === true);
      if (!dates.length) {
        reject(res, 400, "Event date range is invalid or exceeds the supported limit.");
        return;
      }
      try {
        const created = await storage.createCalendarEvents(dates.map((date) => ({ ...payload, date })));
        res.status(201).json(created);
      } catch {
        reject(res, 503, "Unable to save this calendar event.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-calendar/:id/update",
    ...protect,
    requireModule("school-calendar", "events"),
    async (req, res) => {
      const user = principal(req)!;
      const id = parseId(req.params.id);
      const parsed = calendarInput.safeParse({
        ...req.body,
        date: req.body?.date ?? req.body?.startDate,
        startDate: req.body?.startDate ?? req.body?.date,
      });
      if (!id || !parsed.success) {
        reject(res, 400, "A valid event ID, title and date are required.");
        return;
      }
      const date = parsed.data.date ?? parsed.data.startDate;
      if (!isSupportedCalendarDate(date)) {
        reject(res, 400, "Enter a valid calendar date between 2026 and 2126.");
        return;
      }
      const payload = calendarPayload(user.schoolId, parsed.data);
      try {
        const updated = await storage.updateCalendarEvent(id, user.schoolId, {
          title: payload.title,
          description: payload.description,
          eventType: payload.eventType,
          date,
          venue: payload.venue,
          colorCode: payload.colorCode,
          isRecurring: payload.isRecurring,
          audienceScope: payload.audienceScope,
          targetClass: payload.targetClass,
          targetSection: payload.targetSection,
        });
        if (!updated) {
          reject(res, 404, "Calendar event not found for this school.");
          return;
        }
        res.json(updated);
      } catch {
        reject(res, 503, "Unable to update this calendar event.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/school-calendar/:id/delete",
    ...protect,
    requireModule("school-calendar", "events"),
    async (req, res) => {
      const user = principal(req)!;
      const id = parseId(req.params.id);
      if (!id) {
        reject(res, 400, "Invalid calendar event ID.");
        return;
      }
      try {
        if (!await storage.deleteCalendarEventBySchool(id, user.schoolId)) {
          reject(res, 404, "Calendar event not found for this school.");
          return;
        }
        res.json({ message: "Calendar event deleted." });
      } catch {
        reject(res, 503, "Unable to delete this calendar event.");
      }
    },
  );

}