import type { Express } from "express";
import {
  GetTeacherModuleDotStateHeader,
  GetTeacherModuleDotStateResponse,
  MarkTeacherModuleSeenBody,
  MarkTeacherModuleSeenHeader,
  MarkTeacherModuleSeenResponse,
} from "@workspace/api-zod";
import { resolveTeacherAcademicSession, type TeacherAcademicSessionRequest } from "./teacher-academic-session";
import { storage } from "./storage";
import { hasOnlyTeacherModuleDotKeys } from "./teacher-module-dot-state-core";
import {
  getTeacherModuleDotState,
  persistTeacherModuleSeenCursor,
} from "./teacher-module-dot-state";

export function registerTeacherModuleDotStateRoutes(app: Express): void {
  app.get("/api/teacher/module-dot-state", async (req, res): Promise<void> => {
    const header = GetTeacherModuleDotStateHeader.safeParse({
      "x-view-session-id": req.get("x-view-session-id") ?? undefined,
    });
    if (!header.success) {
      res.status(400).json({ message: "A valid selected Academic Session is required" });
      return;
    }

    const context = await resolveTeacherAcademicSession(
      req as unknown as TeacherAcademicSessionRequest,
      "SELECTED_SESSION_REQUIRED",
      storage,
    );
    if (!context.ok) {
      res.status(context.status).json({ message: context.message });
      return;
    }
    if (!context.session) {
      res.status(503).json({ message: "Unable to verify the selected Academic Session." });
      return;
    }

    const state = await getTeacherModuleDotState({
      schoolId: context.schoolId,
      teacherId: context.teacher.id,
      sessionId: context.session.id,
      teacher: context.teacher,
    });
    res.json(GetTeacherModuleDotStateResponse.parse(state));
  });

  app.post("/api/teacher/module-dot-state/seen", async (req, res): Promise<void> => {
    const header = MarkTeacherModuleSeenHeader.safeParse({
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
      !hasOnlyTeacherModuleDotKeys(rawBody, ["module", "cursor"])
      || !hasOnlyTeacherModuleDotKeys(rawCursor, ["createdAt", "source", "recordId"])
    ) {
      res.status(400).json({ message: "Only a module key and observed activity cursor are accepted" });
      return;
    }

    const body = MarkTeacherModuleSeenBody.safeParse(rawBody);
    if (!body.success) {
      res.status(400).json({ message: "Invalid module or activity cursor" });
      return;
    }

    const context = await resolveTeacherAcademicSession(
      req as unknown as TeacherAcademicSessionRequest,
      "SELECTED_SESSION_REQUIRED",
      storage,
    );
    if (!context.ok) {
      res.status(context.status).json({ message: context.message });
      return;
    }
    if (!context.session) {
      res.status(503).json({ message: "Unable to verify the selected Academic Session." });
      return;
    }

    const persisted = await persistTeacherModuleSeenCursor(
      {
        schoolId: context.schoolId,
        teacherId: context.teacher.id,
        sessionId: context.session.id,
        teacher: context.teacher,
      },
      body.data.module,
      body.data.cursor,
    );
    if (!persisted) {
      res.status(403).json({ message: "The activity cursor is not visible in this Academic Session" });
      return;
    }

    res.json(MarkTeacherModuleSeenResponse.parse({
      module: body.data.module,
      markedSeen: true,
    }));
  });
}
