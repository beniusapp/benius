import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { attendancePolicies } from "@workspace/db";
import { db } from "./db";
import { resolvePolicy } from "./attendance-policy-engine";
import { storage } from "./storage";

type StudentPrincipal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
};

type AcademicSession = {
  id: number;
  schoolId: number;
  sessionName: string;
  startDate: string;
  endDate: string;
};

type MobileStudentRequest = Request & {
  mobileAuth?: { principal: StudentPrincipal };
  mobileAcademicSession?: AcademicSession;
};

function reject(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

async function getAuthorizedStudent(req: Request, res: Response) {
  const principal = (req as MobileStudentRequest).mobileAuth?.principal;
  if (!principal || principal.role !== "student"
    || principal.entityId === null
    || principal.id !== principal.principalId
    || principal.id !== principal.entityId) {
    reject(res, 403, "Student access is required.");
    return null;
  }

  const data = await storage.getStudentWithSchool(principal.id);
  if (!data || data.student.id !== principal.id || data.student.schoolId !== principal.schoolId
    || data.school.id !== principal.schoolId) {
    reject(res, 401, "Student account is no longer authorized.");
    return null;
  }
  return { student: data.student, schoolId: principal.schoolId };
}

function getSelectedSession(req: Request): AcademicSession | null {
  const session = (req as MobileStudentRequest).mobileAcademicSession;
  return session ?? null;
}

function requireStudent(req: Request, res: Response, next: (error?: unknown) => void): void {
  const principal = (req as MobileStudentRequest).mobileAuth?.principal;
  if (principal?.role !== "student") {
    reject(res, 403, "Student access is required.");
    return;
  }
  next();
}

function parseMonthAndYear(req: Request): { year: number; month: number } | null {
  const yearRaw = req.query.year;
  const monthRaw = req.query.month;
  if (typeof yearRaw !== "string" || !/^\d{4}$/.test(yearRaw)
    || typeof monthRaw !== "string" || !/^(?:[1-9]|1[0-2])$/.test(monthRaw)) {
    return null;
  }
  const year = Number(yearRaw);
  if (year < 1 || year > 9999) return null;
  return { year, month: Number(monthRaw) };
}

export function registerMobileStudentAttendanceRoutes(
  app: Express,
  requireHttps: RequestHandler,
  requireBearer: RequestHandler,
  requireAcademicSession: RequestHandler,
): void {
  const protectedRoute = [requireHttps, requireBearer, requireStudent, requireAcademicSession] as const;

  app.get("/api/mobile/student/attendance/monthly", ...protectedRoute, async (req, res) => {
    const parsed = parseMonthAndYear(req);
    if (!parsed) {
      reject(res, 400, "Invalid year or month");
      return;
    }
    try {
      const authorized = await getAuthorizedStudent(req, res);
      if (!authorized) return;
      const session = getSelectedSession(req);
      if (!session || session.schoolId !== authorized.schoolId) {
        reject(res, 403, "The selected academic session is not available.");
        return;
      }
      const days = await storage.getStudentMonthlyAttendance(
        authorized.student.id, authorized.schoolId, session.id, parsed.year, parsed.month,
      );
      res.json({
        schoolId: authorized.schoolId,
        studentId: authorized.student.id,
        sessionId: session.id,
        year: parsed.year,
        month: parsed.month,
        days,
      });
    } catch {
      reject(res, 503, "Unable to load student attendance.");
    }
  });

  app.get("/api/mobile/student/attendance/yearly", ...protectedRoute, async (req, res) => {
    try {
      const authorized = await getAuthorizedStudent(req, res);
      if (!authorized) return;
      const session = getSelectedSession(req);
      if (!session || session.schoolId !== authorized.schoolId) {
        reject(res, 403, "The selected academic session is not available.");
        return;
      }
      const historicalContext = await storage.resolveAttendanceClassSectionForStudent(
        authorized.schoolId, session.id, authorized.student.id,
      );
      const months = await storage.getStudentYearlyAttendance(
        authorized.student.id, authorized.schoolId, session.id,
        historicalContext?.class ?? null, historicalContext?.section ?? null,
        session.startDate, session.endDate,
      );
      res.json({
        schoolId: authorized.schoolId,
        studentId: authorized.student.id,
        sessionId: session.id,
        sessionName: session.sessionName,
        months,
      });
    } catch {
      reject(res, 503, "Unable to load student attendance.");
    }
  });

  app.get("/api/mobile/student/attendance/stats", ...protectedRoute, async (req, res) => {
    try {
      const authorized = await getAuthorizedStudent(req, res);
      if (!authorized) return;
      const session = getSelectedSession(req);
      if (!session || session.schoolId !== authorized.schoolId) {
        reject(res, 403, "The selected academic session is not available.");
        return;
      }
      const historicalContext = await storage.resolveAttendanceClassSectionForStudent(
        authorized.schoolId, session.id, authorized.student.id,
      );
      const stats = await storage.getStudentAttendanceStats(
        authorized.student.id, authorized.schoolId, session.id,
        historicalContext?.class ?? null, historicalContext?.section ?? null,
        session.startDate, session.endDate,
      );
      res.json({
        schoolId: authorized.schoolId,
        studentId: authorized.student.id,
        sessionId: session.id,
        startDate: session.startDate,
        ...stats,
      });
    } catch {
      reject(res, 503, "Unable to load student attendance.");
    }
  });

  app.get(
    "/api/mobile/student/attendance/policy",
    requireHttps,
    requireBearer,
    requireStudent,
    async (req, res) => {
      try {
        const authorized = await getAuthorizedStudent(req, res);
        if (!authorized) return;
        const policyRows = await db.select().from(attendancePolicies).where(
          and(eq(attendancePolicies.schoolId, authorized.schoolId), eq(attendancePolicies.isActive, true)),
        );
        res.json(resolvePolicy(policyRows, "STUDENT", authorized.student.class ?? ""));
      } catch {
        reject(res, 503, "Unable to load attendance policy");
      }
    },
  );
}