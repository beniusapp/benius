import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { insertSchoolSchema } from "@shared/schema";
import bcrypt from "bcryptjs";
import { z } from "zod";

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

const createSchoolBodySchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(20),
  principalEmail: z.string().email(),
  principalPassword: z.string().min(6),
});

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/schools", async (_req, res) => {
    const schools = await storage.getSchools();
    res.json(schools);
  });

  app.post("/api/schools", async (req, res) => {
    const parsed = createSchoolBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    }

    const { name, code, principalEmail, principalPassword } = parsed.data;

    const existingSchool = await storage.getSchoolByCode(code);
    if (existingSchool) {
      return res.status(409).json({ message: "A school with this code already exists" });
    }

    const existingUser = await storage.getUserByEmail(principalEmail);
    if (existingUser) {
      return res.status(409).json({ message: "A user with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(principalPassword, 10);
    const school = await storage.createSchoolWithPrincipal({ name, code }, principalEmail, passwordHash);
    res.status(201).json(school);
  });

  app.delete("/api/schools/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid school ID" });
    }
    const deleted = await storage.deleteSchool(id);
    if (!deleted) {
      return res.status(404).json({ message: "School not found" });
    }
    res.json({ message: "School deleted" });
  });

  app.post("/api/login", async (req, res) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid email or password format" });
    }

    const user = await storage.getUserByEmail(parsed.data.email);
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    req.session.userId = user.id;
    res.json({ message: "Login successful" });
  });

  app.get("/api/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const data = await storage.getUserWithSchool(req.session.userId);
    if (!data) {
      return res.status(401).json({ message: "User not found" });
    }

    res.json({
      id: data.user.id,
      email: data.user.email,
      role: data.user.role,
      schoolId: data.school.id,
      schoolName: data.school.name,
    });
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out" });
    });
  });

  return httpServer;
}
