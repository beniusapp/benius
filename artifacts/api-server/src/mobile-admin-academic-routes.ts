import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { enrollments, students, type AcademicSession } from "@workspace/db";
import { db } from "./db";
import { storage } from "./storage";

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
type Middleware = RequestHandler;

function reject(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

function principal(req: Request): AdminPrincipal | null {
  const value = (req as MobileRequest).mobileAuth?.principal;
  if (!value || (value.role !== "admin" && value.role !== "support_staff")
    || value.schoolId <= 0 || value.principalId <= 0) return null;
  return value;
}

function requireModule(moduleId: string, submodule?: string): RequestHandler {
  return (req, res, next) => {
    const user = principal(req);
    if (!user) {
      reject(res, 403, "Administrator or permitted support staff access is required.");
      return;
    }
    if (user.role !== "admin") {
      const allowed = user.allowedModules ?? [];
      if (!allowed.includes(moduleId) || (submodule && !allowed.includes(`${moduleId}:${submodule}`))) {
        reject(res, 403, "You do not have permission for this module action.");
        return;
      }
    }
    next();
  };
}

function requireSession(requireAcademicSession: Middleware): RequestHandler {
  return (req, res, next) => {
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

function currentSession(req: Request, schoolId: number): AcademicSession | null {
  const session = (req as MobileRequest).mobileAcademicSession;
  return session && session.schoolId === schoolId ? session : null;
}

function requireActiveSession(req: Request, res: Response, schoolId: number): AcademicSession | null {
  const session = currentSession(req, schoolId);
  if (!session) {
    reject(res, 403, "A school-scoped academic session is required.");
    return null;
  }
  if (!session.isActive) {
    reject(res, 403, "Archived academic sessions are read-only.");
    return null;
  }
  return session;
}

const timetableChangeSchema = z.object({
  changes: z.array(z.object({
    dayOfWeek: z.number().int().min(1).max(6),
    period: z.number().int().min(1).max(20),
    class: z.string().trim().min(1).max(60),
    section: z.string().trim().min(1).max(60),
    teacherId: z.number().int().positive().nullable().optional(),
    subject: z.string().trim().min(1).max(120).nullable().optional(),
    _delete: z.boolean().optional(),
  })).max(240),
});
const structureSchema = z.object({
  class: z.string().trim().min(1).max(60),
  rows: z.array(z.object({
    periodNumber: z.number().int().min(0).max(20),
    label: z.string().trim().min(1).max(80),
    startTime: z.string().max(10),
    endTime: z.string().max(10),
    isBreak: z.boolean(),
    sortOrder: z.number().int().min(0).max(40).optional(),
  })).max(40),
});
const facultyMappingSchema = z.object({
  teacherId: z.number().int().positive(),
  mappings: z.array(z.object({
    className: z.string().trim().min(1).max(60),
    section: z.string().trim().min(1).max(60),
    subject: z.string().trim().max(500).nullable().optional(),
  })).max(300),
});

export function registerMobileAdminAcademicRoutes(
  app: Express,
  requireHttps: Middleware,
  requireBearer: Middleware,
  requireAcademicSession: Middleware,
): void {
  const protect = [requireHttps, requireBearer] as const;
  const sessionGate = requireSession(requireAcademicSession);

  app.get(
    "/api/mobile/admin/modules/timetable/context",
    ...protect,
    requireModule("timetable"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = currentSession(req, user.schoolId);
      if (!session) return reject(res, 403, "A school-scoped academic session is required.");
      try {
        const metadata = await storage.getAllSchoolMetadata(user.schoolId);
        res.json({
          session: { id: session.id, sessionName: session.sessionName, isActive: session.isActive },
          classes: metadata.classes ?? [],
          sections: metadata.sections ?? [],
          subjects: metadata.subjects ?? [],
        });
      } catch {
        reject(res, 503, "Unable to load timetable configuration.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/timetable/teachers",
    ...protect,
    requireModule("timetable", "schedule"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      try {
        const teachers = await storage.getTeachersBySchool(user.schoolId);
        res.json(teachers.map(({ id, fullName, subject }) => ({ id, fullName, subject })));
      } catch {
        reject(res, 503, "Unable to load teachers for timetable assignment.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/timetable/class-view",
    ...protect,
    requireModule("timetable", "schedule"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = currentSession(req, user.schoolId);
      const cls = typeof req.query.class === "string" ? req.query.class : "";
      const section = typeof req.query.section === "string" ? req.query.section : "";
      if (!session) return reject(res, 403, "A school-scoped academic session is required.");
      if (!cls || !section) return reject(res, 400, "Class and section are required.");
      try {
        const [entries, structure] = await Promise.all([
          storage.getTimetableByClassSection(user.schoolId, session.id, cls, section),
          storage.getTimetableStructure(user.schoolId, session.id, cls),
        ]);
        res.json({ entries, structure });
      } catch {
        reject(res, 503, "Unable to load the class timetable.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/timetable/status",
    ...protect,
    requireModule("timetable", "publish"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = currentSession(req, user.schoolId);
      if (!session) return reject(res, 403, "A school-scoped academic session is required.");
      try {
        res.json(await storage.getClassSectionStatus(user.schoolId, session.id));
      } catch {
        reject(res, 503, "Unable to load timetable publication status.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/timetable/structure",
    ...protect,
    requireModule("timetable", "structure"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = currentSession(req, user.schoolId);
      const cls = typeof req.query.class === "string" ? req.query.class : "";
      if (!session) return reject(res, 403, "A school-scoped academic session is required.");
      if (!cls) return reject(res, 400, "Class is required.");
      try {
        res.json(await storage.getTimetableStructure(user.schoolId, session.id, cls));
      } catch {
        reject(res, 503, "Unable to load timetable structure.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/timetable/save",
    ...protect,
    requireModule("timetable", "schedule"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = requireActiveSession(req, res, user.schoolId);
      const parsed = timetableChangeSchema.safeParse(req.body);
      if (!session || !parsed.success) {
        if (!parsed.success) reject(res, 400, "Timetable changes are invalid.");
        return;
      }
      try {
        const saved: unknown[] = [];
        const errors: string[] = [];
        for (const change of parsed.data.changes) {
          try {
            if (change._delete) {
              await storage.deleteTimetableSlot(user.schoolId, session.id, change.class, change.section, change.dayOfWeek, change.period);
              continue;
            }
            if (!change.teacherId || !change.subject) {
              errors.push(`Day ${change.dayOfWeek}, period ${change.period}: teacher and subject are required.`);
              continue;
            }
            const teacher = await storage.getTeacherById(change.teacherId);
            if (!teacher || teacher.schoolId !== user.schoolId) {
              errors.push(`Day ${change.dayOfWeek}, period ${change.period}: teacher is not in this school.`);
              continue;
            }
            saved.push(await storage.upsertTimetableSlot(user.schoolId, session.id, {
              dayOfWeek: change.dayOfWeek,
              period: change.period,
              class: change.class,
              section: change.section,
              teacherId: change.teacherId,
              subject: change.subject,
            }));
          } catch (error) {
            errors.push(error instanceof Error ? error.message : "Unable to save a timetable slot.");
          }
        }
        res.json({ saved, errors });
      } catch {
        reject(res, 503, "Unable to save timetable changes.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/timetable/structure",
    ...protect,
    requireModule("timetable", "structure"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = requireActiveSession(req, res, user.schoolId);
      const parsed = structureSchema.safeParse(req.body);
      if (!session || !parsed.success) {
        if (!parsed.success) reject(res, 400, "Timetable structure is invalid.");
        return;
      }
      try {
        const saved = await storage.saveTimetableStructure(
          user.schoolId,
          session.id,
          parsed.data.class,
          parsed.data.rows.map((row, index) => ({ ...row, sortOrder: index })),
        );
        res.json({ saved });
      } catch {
        reject(res, 503, "Unable to save timetable structure.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/timetable/publish",
    ...protect,
    requireModule("timetable", "publish"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = requireActiveSession(req, res, user.schoolId);
      const parsed = z.object({
        class: z.string().trim().min(1).max(60),
        section: z.string().trim().min(1).max(60),
      }).safeParse(req.body);
      if (!session || !parsed.success) {
        if (!parsed.success) reject(res, 400, "Class and section are required.");
        return;
      }
      try {
        const count = await storage.updateTimetableEntryStatus(user.schoolId, session.id, parsed.data.class, parsed.data.section, "published");
        res.json({ count });
      } catch {
        reject(res, 503, "Unable to publish this timetable.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/faculty-mapping",
    ...protect,
    requireModule("faculty-mapping"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      try {
        const [teachers, mappings, metadata] = await Promise.all([
          storage.getTeachersBySchool(user.schoolId),
          storage.getFacultyMappingsBySchool(user.schoolId),
          storage.getAllSchoolMetadata(user.schoolId),
        ]);
        res.json({
          teachers: teachers.map(({ id, fullName, email, subject }) => ({ id, fullName, email, subject })),
          mappings,
          classes: metadata.classes ?? [],
          sections: metadata.sections ?? [],
          subjects: metadata.subjects ?? [],
        });
      } catch {
        reject(res, 503, "Unable to load faculty assignments.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/faculty-mapping/save",
    ...protect,
    requireModule("faculty-mapping", "assign"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = requireActiveSession(req, res, user.schoolId);
      const parsed = facultyMappingSchema.safeParse(req.body);
      if (!session || !parsed.success) {
        if (!parsed.success) reject(res, 400, "Faculty mapping is invalid.");
        return;
      }
      try {
        const teacher = await storage.getTeacherById(parsed.data.teacherId);
        if (!teacher || teacher.schoolId !== user.schoolId) return reject(res, 404, "Teacher not found for this school.");
        const mappings = await storage.replaceFacultyMappings(parsed.data.teacherId, user.schoolId, parsed.data.mappings);
        res.json(mappings);
      } catch {
        reject(res, 503, "Unable to save faculty assignments.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/faculty-mapping/clear",
    ...protect,
    requireModule("faculty-mapping", "assign"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      if (!requireActiveSession(req, res, user.schoolId)) return;
      const teacherId = typeof req.body?.teacherId === "number" ? req.body.teacherId : NaN;
      if (!Number.isSafeInteger(teacherId) || teacherId <= 0) return reject(res, 400, "A valid teacher is required.");
      try {
        const teacher = await storage.getTeacherById(teacherId);
        if (!teacher || teacher.schoolId !== user.schoolId) return reject(res, 404, "Teacher not found for this school.");
        await storage.deleteFacultyMappingsByTeacher(teacherId, user.schoolId);
        res.json({ cleared: true });
      } catch {
        reject(res, 503, "Unable to clear faculty assignments.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/analytics/context",
    ...protect,
    requireModule("analytics"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      try {
        const [metadata, examPolicyTiers, gradingTiers, gradingRules] = await Promise.all([
          storage.getAllSchoolMetadata(user.schoolId),
          storage.getExamPolicyTiers(user.schoolId),
          storage.getGradingTiers(user.schoolId),
          storage.getGradingRules(user.schoolId),
        ]);
        res.json({
          classes: metadata.classes ?? [],
          sections: metadata.sections ?? [],
          subjects: metadata.subjects ?? [],
          classSections: metadata.class_sections ?? {},
          classSubjects: metadata.class_subjects ?? {},
          examTypes: metadata.exam_types ?? [],
          classExamTypes: metadata.class_exam_types ?? {},
          examPolicyTiers,
          gradingTiers,
          gradingRules,
        });
      } catch {
        reject(res, 503, "Unable to load performance analytics configuration.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/analytics/view",
    ...protect,
    requireModule("analytics", "view"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = currentSession(req, user.schoolId);
      const cls = typeof req.query.class === "string" ? req.query.class : "";
      const section = typeof req.query.section === "string" ? req.query.section : "";
      const subject = typeof req.query.subject === "string" ? req.query.subject : "";
      const examType = typeof req.query.examType === "string" ? req.query.examType : "";
      if (!session) return reject(res, 403, "A school-scoped academic session is required.");
      if (!cls || !section || !subject || !examType) return reject(res, 400, "Class, section, subject, and exam are required.");
      try {
        const roster = await storage.getStudentsByClassSectionInSession(user.schoolId, cls, section, session.id);
        const scores = (await Promise.all(roster.map(async (student) => (
          await storage.getExamScoresByStudent(student.id, user.schoolId, session.id)
        )))).flat()
          .filter((score) => score.subject === subject && score.examType === examType)
          .map((score) => {
            const student = roster.find((entry) => entry.id === score.studentId);
            return student ? { ...score, studentName: student.name, dsid: student.digitalStudentId } : null;
          })
          .filter((score) => score !== null);
        res.json(scores);
      } catch {
        reject(res, 503, "Unable to load marks for this class.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/analytics/results",
    ...protect,
    requireModule("analytics", "results"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = currentSession(req, user.schoolId);
      const cls = typeof req.query.class === "string" ? req.query.class : "";
      const section = typeof req.query.section === "string" ? req.query.section : "";
      if (!session) return reject(res, 403, "A school-scoped academic session is required.");
      if (!cls || !section) return reject(res, 400, "Class and section are required.");
      try {
        const [studentList, tiers] = await Promise.all([
          storage.getStudentsByClassSectionInSession(user.schoolId, cls, section, session.id),
          storage.getExamPolicyTiers(user.schoolId),
        ]);
        const policyTier = tiers.find((tier) => (tier.applicableClasses ?? []).includes(cls)) ?? null;
        const gradeTier = await storage.resolveClassPassPolicy(user.schoolId, cls);
        const gradingRules = gradeTier ? await storage.getGradingRules(user.schoolId, gradeTier.id) : [];
        const attendance = session.startDate && session.endDate
          ? await storage.getStudentAttendanceAggregatesForSessionClass(user.schoolId, session.id, cls, section, session.startDate, session.endDate)
          : [];
        const attendanceByStudent = new Map(attendance.map(({ student, aggregation }) => [
          student.id,
          {
            attendancePct: aggregation.applicableWorkingDays > 0 ? aggregation.percentage : null,
            presentDays: aggregation.weightedAttendance,
            totalDays: aggregation.applicableWorkingDays,
          },
        ]));
        const data = await Promise.all(studentList.map(async (student) => ({
          studentId: student.id,
          name: student.name,
          digitalStudentId: student.digitalStudentId,
          rollNumber: student.rollNumber,
          scores: (await storage.getExamScoresByStudent(student.id, user.schoolId, session.id)).map((score) => ({
            subject: score.subject,
            examType: score.examType,
            marks: score.marks ?? 0,
            totalMarks: score.totalMarks ?? 100,
            isAbsent: score.isAbsent ?? false,
          })),
          attendance: attendanceByStudent.get(student.id) ?? null,
        })));
        res.json({
          students: data,
          policyTier,
          passPercentage: gradeTier?.passPercentage ?? null,
          gradingRules,
          session: { id: session.id, sessionName: session.sessionName },
        });
      } catch {
        reject(res, 503, "Unable to load class results.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/id-card-gen/context",
    ...protect,
    requireModule("id-card-gen"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const accessAllowed = user.role === "admin" || (user.allowedModules ?? []).includes("id-card-gen:student");
      if (!accessAllowed) return reject(res, 403, "Student ID card access is not permitted.");
      try {
        const metadata = await storage.getAllSchoolMetadata(user.schoolId);
        res.json({ classes: metadata.classes ?? [], sections: metadata.sections ?? [] });
      } catch {
        reject(res, 503, "Unable to load ID card filters.");
      }
    },
  );

  app.get(
    "/api/mobile/admin/modules/id-card-gen/roster",
    ...protect,
    requireModule("id-card-gen"),
    sessionGate,
    async (req, res) => {
      const user = principal(req)!;
      const session = currentSession(req, user.schoolId);
      if (!session) return reject(res, 403, "A school-scoped academic session is required.");
      const group = typeof req.query.group === "string" ? req.query.group : "student";
      const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const cls = typeof req.query.class === "string" ? req.query.class : "";
      const section = typeof req.query.section === "string" ? req.query.section : "";
      if (!["student", "teacher", "support-staff"].includes(group)) return reject(res, 400, "Unknown ID card group.");
      if (user.role !== "admin" && !(user.allowedModules ?? []).includes(`id-card-gen:${group}`)) {
        return reject(res, 403, "You do not have permission to view this ID card group.");
      }
      try {
        if (group === "student") {
          const rows = await db.select({ student: students, className: enrollments.className, section: enrollments.sectionName })
            .from(enrollments)
            .innerJoin(students, and(
              eq(students.id, enrollments.studentId),
              eq(students.schoolId, user.schoolId),
            ))
            .where(and(eq(enrollments.schoolId, user.schoolId), eq(enrollments.sessionId, session.id)));
          const roster = rows.map(({ student, className, section: sectionName }) => ({
            id: student.id,
            name: student.name,
            digitalStudentId: student.digitalStudentId,
            rollNumber: student.rollNumber,
            className,
            section: sectionName,
          })).filter((student) => (!cls || student.className === cls)
            && (!section || student.section === section)
            && (!query || `${student.name} ${student.digitalStudentId} ${student.rollNumber ?? ""}`.toLowerCase().includes(query)))
            .slice(0, 100);
          return res.json({ group, roster, session: { id: session.id, sessionName: session.sessionName } });
        }
        if (group === "teacher") {
          const roster = (await storage.getTeachersBySchool(user.schoolId))
            .filter((teacher) => !query || `${teacher.fullName} ${teacher.email} ${teacher.subject ?? ""}`.toLowerCase().includes(query))
            .slice(0, 100)
            .map(({ id, fullName, email, digitalTeacherId, subject }) => ({
              id, name: fullName, email, digitalTeacherId, subject,
            }));
          return res.json({ group, roster, session: { id: session.id, sessionName: session.sessionName } });
        }
        const roster = (await storage.getNonTeachingStaffBySchool(user.schoolId))
          .filter((staff) => !query || `${staff.fullName} ${staff.email ?? ""} ${staff.designation ?? ""}`.toLowerCase().includes(query))
          .slice(0, 100)
          .map(({ id, fullName, email, designation }) => ({
            id, name: fullName, email, role: designation,
          }));
        return res.json({ group, roster, session: { id: session.id, sessionName: session.sessionName } });
      } catch {
        reject(res, 503, "Unable to load ID card records for this school and session.");
      }
    },
  );
}