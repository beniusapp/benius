import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertSchoolSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/schools", async (_req, res) => {
    const schools = await storage.getSchools();
    res.json(schools);
  });

  app.post("/api/schools", async (req, res) => {
    const parsed = insertSchoolSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    const existing = await storage.getSchoolByCode(parsed.data.code);
    if (existing) {
      return res.status(409).json({ message: "A school with this code already exists" });
    }

    const school = await storage.createSchool(parsed.data);
    res.status(201).json(school);
  });

  return httpServer;
}
