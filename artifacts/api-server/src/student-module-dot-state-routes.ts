import type { Express } from "express";
import {
  GetStudentModuleDotStateHeader,
  GetStudentModuleDotStateResponse,
  MarkStudentModuleSeenBody,
  MarkStudentModuleSeenHeader,
  MarkStudentModuleSeenResponse,
} from "@workspace/api-zod";
import { resolveStudentAcademicSession } from "./student-academic-session";
import { storage } from "./storage";
import { hasOnlyOwnKeys } from "./student-module-dot-state-core";
import {
  getStudentModuleDotState,
  persistStudentModuleSeenCursor,
} from "./student-module-dot-state";

export function registerStudentModuleDotStateRoutes(app: Express): void {
  app.get("/api/student/module-dot-state", async (req, res): Promise<void> => {
    const header = GetStudentModuleDotStateHeader.safeParse({
      "x-view-session-id": req.get("x-view-session-id") ?? undefined,
    });
    if (!header.success) {
      res.status(400).json({ message: "A valid selected Academic Session is required" });
      return;
    }

    const context = await resolveStudentAcademicSession(
      req.session.studentId,
      header.data["x-view-session-id"],
      "SELECTED_SESSION_REQUIRED",
      storage,
    );
    if (!context.ok) {
      res.status(context.status).json({ message: context.message, code: context.code });
      return;
    }

    const enrollment = await storage.resolveEnrollmentForStudentSession(
      context.schoolId,
      context.student.id,
      context.sessionId!,
    );
    const state = await getStudentModuleDotState({
      schoolId: context.schoolId,
      studentId: context.student.id,
      sessionId: context.sessionId!,
      enrollment: enrollment
        ? { className: enrollment.className, sectionName: enrollment.sectionName }
        : null,
    });
    res.json(GetStudentModuleDotStateResponse.parse(state));
  });

  app.post("/api/student/module-dot-state/seen", async (req, res): Promise<void> => {
    const header = MarkStudentModuleSeenHeader.safeParse({
      "x-view-session-id": req.get("x-view-session-id") ?? undefined,
    });
    if (!header.success) {
      res.status(400).json({ message: "A valid selected Academic Session is required" });
      return;
    }

    const rawBody: unknown = req.body;
    const rawCursor = (
      rawBody !== null
      && typeof rawBody === "object"
      && !Array.isArray(rawBody)
    )
      ? (rawBody as Record<string, unknown>).cursor
      : undefined;
    if (
      !hasOnlyOwnKeys(rawBody, ["module", "cursor"])
      || !hasOnlyOwnKeys(rawCursor, ["createdAt", "recordId"])
    ) {
      res.status(400).json({ message: "Only a module key and observed activity cursor are accepted" });
      return;
    }

    const body = MarkStudentModuleSeenBody.safeParse(rawBody);
    if (!body.success) {
      res.status(400).json({ message: "Invalid module or activity cursor" });
      return;
    }

    const context = await resolveStudentAcademicSession(
      req.session.studentId,
      header.data["x-view-session-id"],
      "SELECTED_SESSION_REQUIRED",
      storage,
    );
    if (!context.ok) {
      res.status(context.status).json({ message: context.message, code: context.code });
      return;
    }

    const enrollment = await storage.resolveEnrollmentForStudentSession(
      context.schoolId,
      context.student.id,
      context.sessionId!,
    );
    const persisted = await persistStudentModuleSeenCursor(
      {
        schoolId: context.schoolId,
        studentId: context.student.id,
        sessionId: context.sessionId!,
        enrollment: enrollment
          ? { className: enrollment.className, sectionName: enrollment.sectionName }
          : null,
      },
      body.data.module,
      body.data.cursor,
    );
    if (!persisted) {
      res.status(403).json({ message: "The activity cursor is not visible in this Academic Session" });
      return;
    }

    res.json(MarkStudentModuleSeenResponse.parse({
      module: body.data.module,
      markedSeen: true,
    }));
  });
}
