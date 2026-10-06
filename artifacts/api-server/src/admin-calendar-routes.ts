import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { adminModuleAccessAllowed } from "./support-staff-module-permissions";

function canManageCalendar(req: Request): boolean {
  return Boolean(req.session.userId) &&
    adminModuleAccessAllowed(
      req.session.userRole,
      req.session.allowedModules,
      "school-calendar",
    );
}

function sendCalendarAccessDenied(res: Response): void {
  res.status(403).json({ message: "Admin access required" });
}

export function registerAdminCalendarRoutes(app: Express): void {
  app.get("/api/admin/calendar/context", async (req, res): Promise<void> => {
    if (!canManageCalendar(req)) {
      res.status(403).json({ message: "School Calendar access required" });
      return;
    }
    const schoolId = req.session.schoolId;
    if (!schoolId) {
      res.status(403).json({ message: "School access denied" });
      return;
    }
    const metadata = await storage.getAllSchoolMetadata(schoolId);
    const classSections = await storage.getClassSectionsMap(schoolId);
    res.json({
      classes: metadata.classes ?? [],
      sections: metadata.sections ?? [],
      classSections,
    });
  });

  app.get("/api/admin/calendar", async (req, res): Promise<void> => {
    if (!canManageCalendar(req)) {
      sendCalendarAccessDenied(res);
      return;
    }
    const schoolId = req.session.schoolId!;
    const { month, year } = req.query;
    if (month && year) {
      const m = parseInt(month as string);
      const y = parseInt(year as string);
      const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const endDate = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const events = await storage.getCalendarEventsByRange(schoolId, startDate, endDate);
      res.json(events);
      return;
    }
    const events = await storage.getCalendarEvents(schoolId);
    res.json(events);
  });

  app.post("/api/admin/calendar", async (req, res): Promise<void> => {
    if (!canManageCalendar(req)) {
      sendCalendarAccessDenied(res);
      return;
    }
    const schoolId = req.session.schoolId!;
    const {
      title, description, eventType, startDate, endDate, isRecurring, colorCode,
      audienceScope, targetClass, targetSection,
    } = req.body;
    if (!title || !eventType || !startDate) {
      res.status(400).json({ message: "title, eventType, startDate required" });
      return;
    }
    let scopeValue: string = "All_School";
    if (audienceScope === "Multi_Target") {
      scopeValue = "Multi_Target";
    } else if (targetClass && targetSection) {
      scopeValue = "Specific_Section";
    } else if (targetClass) {
      scopeValue = "Entire_Class";
    } else if (audienceScope === "Entire_Class") {
      scopeValue = "Entire_Class";
    } else if (audienceScope === "Specific_Section") {
      scopeValue = "Specific_Section";
    }
    if (scopeValue !== "All_School" && !targetClass) {
      res.status(400).json({ message: "targetClass is required for class-targeted events" });
      return;
    }
    const color = colorCode ||
      (eventType === "holiday" ? "#ef4444" : eventType === "examination" ? "#3b82f6" : "#10b981");

    const baseInsert = {
      schoolId,
      title,
      description: description || null,
      eventType,
      venue: null,
      colorCode: color,
      isRecurring: !!isRecurring,
      audienceScope: scopeValue,
      targetClass: scopeValue !== "All_School" ? (targetClass as string) : null,
      targetSection: (scopeValue === "Specific_Section" || scopeValue === "Multi_Target")
        ? (targetSection as string)
        : null,
    };
    const entries: {
      schoolId: number;
      title: string;
      description: string | null;
      eventType: string;
      venue: null;
      colorCode: string;
      isRecurring: boolean;
      date: string;
      audienceScope: string;
      targetClass: string | null;
      targetSection: string | null;
    }[] = [];

    const start = new Date(startDate + "T00:00:00");
    const end = endDate ? new Date(endDate + "T00:00:00") : start;
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      entries.push({ ...baseInsert, date: dateString });
    }

    if (isRecurring) {
      const CALENDAR_HORIZON = 2126;
      const startYear = new Date(startDate + "T00:00:00").getFullYear();
      const extraYears = Math.max(0, CALENDAR_HORIZON - startYear);
      const baseEntries = [...entries];
      for (let yearOffset = 1; yearOffset <= extraYears; yearOffset++) {
        baseEntries.forEach(entry => {
          const originalDate = new Date(entry.date + "T00:00:00");
          originalDate.setFullYear(originalDate.getFullYear() + yearOffset);
          const futureDate = `${originalDate.getFullYear()}-${String(originalDate.getMonth() + 1).padStart(2, "0")}-${String(originalDate.getDate()).padStart(2, "0")}`;
          entries.push({ ...entry, date: futureDate });
        });
      }
    }

    const created = await storage.createCalendarEvents(entries);
    res.status(201).json(created);
  });

  app.patch("/api/admin/calendar/:id", async (req, res): Promise<void> => {
    if (!canManageCalendar(req)) {
      sendCalendarAccessDenied(res);
      return;
    }
    const schoolId = req.session.schoolId!;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) {
      res.status(400).json({ message: "Invalid id" });
      return;
    }
    const {
      title, description, eventType, date, venue, colorCode, isRecurring,
      audienceScope, targetClass, targetSection,
    } = req.body;
    if (!title || !eventType || !date) {
      res.status(400).json({ message: "title, eventType, date required" });
      return;
    }
    let scopeValue: string = "All_School";
    if (audienceScope === "Multi_Target") {
      scopeValue = "Multi_Target";
    } else if (targetClass && targetSection) {
      scopeValue = "Specific_Section";
    } else if (targetClass) {
      scopeValue = "Entire_Class";
    } else if (audienceScope === "Entire_Class") {
      scopeValue = "Entire_Class";
    } else if (audienceScope === "Specific_Section") {
      scopeValue = "Specific_Section";
    }
    const color = colorCode ||
      (eventType === "holiday" ? "#ef4444" : eventType === "examination" ? "#3b82f6" : "#10b981");
    const updated = await storage.updateCalendarEvent(id, schoolId, {
      title,
      description: description || null,
      eventType,
      date,
      venue: venue || null,
      colorCode: color,
      isRecurring: !!isRecurring,
      audienceScope: scopeValue,
      targetClass: scopeValue !== "All_School" ? (targetClass || null) : null,
      targetSection: (scopeValue === "Specific_Section" || scopeValue === "Multi_Target")
        ? (targetSection || null)
        : null,
    });
    if (!updated) {
      res.status(404).json({ message: "Event not found or access denied" });
      return;
    }
    res.json(updated);
  });

  app.delete("/api/admin/calendar/:id", async (req, res): Promise<void> => {
    if (!canManageCalendar(req)) {
      sendCalendarAccessDenied(res);
      return;
    }
    const schoolId = req.session.schoolId!;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) {
      res.status(400).json({ message: "Invalid id" });
      return;
    }
    const deleted = await storage.deleteCalendarEventBySchool(id, schoolId);
    if (!deleted) {
      res.status(404).json({ message: "Event not found or access denied" });
      return;
    }
    res.json({ message: "Deleted" });
  });
}
