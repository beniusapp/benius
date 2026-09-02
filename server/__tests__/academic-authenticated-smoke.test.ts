import express from "express";
import session from "express-session";
import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  academicHistory,
  academicSessions,
  enrollments,
  examPolicyTiers,
  examScores,
  gradingRules,
  gradingTiers,
  promotionDecisions,
  schoolMetadata,
  schools,
  students,
  teachers,
  users,
} from "@shared/schema";
import { db } from "../db";
import { registerRoutes } from "../routes";

type Fixture = {
  schoolA: number;
  schoolB: number;
  sessionA: number;
  sessionA2: number;
  sessionB: number;
  admin: number;
  teacher: number;
  student: number;
  incomplete: number;
  override: number;
};

const fixture = {} as Fixture;
let server: Server;
let origin = "";
let token = "";
const password = "Smoke-pass-2026";
const pin = "482951";

class CookieJar {
  private values = new Map<string, string>();

  absorb(response: Response) {
    const cookies = response.headers.getSetCookie?.() ?? (
      response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []
    );
    for (const cookie of cookies) {
      const pair = cookie.split(";", 1)[0];
      const equals = pair.indexOf("=");
      if (equals > 0) this.values.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
  }

  header() {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

async function request(jar: CookieJar, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (jar.header()) headers.set("cookie", jar.header());
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  jar.absorb(response);
  return { response, body: await response.json() };
}

async function addPolicy(schoolId: number) {
  const [tier] = await db.insert(gradingTiers).values({
    schoolId,
    name: `${token}-percentage`,
    classes: ["1"],
    passPercentage: 35,
    gradingSystem: "percentage",
    passingGrades: ["C"],
  }).returning();
  await db.insert(gradingRules).values([
    { schoolId, tierId: tier.id, gradeLabel: "F", minPercent: 0, maxPercent: 34, gradePoint: "0", remarks: "Fail", sortOrder: 0 },
    { schoolId, tierId: tier.id, gradeLabel: "C", minPercent: 35, maxPercent: 100, gradePoint: "5", remarks: "Pass", sortOrder: 1 },
  ]);
  await db.insert(examPolicyTiers).values({
    schoolId,
    tierName: `${token}-exam`,
    applicableClasses: ["1"],
    examWeights: JSON.stringify({ Term1: [{ source_exam: "Exam", weight: 100 }] }),
    promotionFailRules: JSON.stringify({ rule1: { enabled: true, rules: [{ term: "Term1", fail_count: 1 }] } }),
    resultsConfig: "{}",
  });
  await db.insert(schoolMetadata).values({
    schoolId, metaKey: "class_subjects", metaValue: JSON.stringify({ "1": ["Math"] }),
  });
}

beforeAll(async () => {
  token = `auth_smoke_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const passwordHash = await bcrypt.hash(password, 10);
  const pinHash = await bcrypt.hash(pin, 10);
  const [schoolA, schoolB] = await db.insert(schools).values([
    { name: `${token}-A`, code: `${token.slice(-7).toUpperCase()}A` },
    { name: `${token}-B`, code: `${token.slice(-7).toUpperCase()}B` },
  ]).returning();
  fixture.schoolA = schoolA.id;
  fixture.schoolB = schoolB.id;

  const [sessionA, sessionA2, sessionB] = await db.insert(academicSessions).values([
    { schoolId: schoolA.id, sessionName: `${token}-A1`, startDate: "2026-04-01", endDate: "2027-03-31", isActive: true, status: "active" },
    { schoolId: schoolA.id, sessionName: `${token}-A2`, startDate: "2027-04-01", endDate: "2028-03-31", isActive: false, status: "draft" },
    { schoolId: schoolB.id, sessionName: `${token}-B1`, startDate: "2026-04-01", endDate: "2027-03-31", isActive: true, status: "active" },
  ]).returning();
  fixture.sessionA = sessionA.id;
  fixture.sessionA2 = sessionA2.id;
  fixture.sessionB = sessionB.id;

  const [adminUser, teacherUser] = await db.insert(users).values([
    { schoolId: schoolA.id, email: `${token}-admin@example.test`, passwordHash, pinHash, role: "admin", isInitialized: true },
    { schoolId: schoolA.id, email: `${token}-teacher@example.test`, passwordHash, role: "teacher", isInitialized: true },
  ]).returning();
  fixture.admin = adminUser.id;
  const [teacher] = await db.insert(teachers).values({
    userId: teacherUser.id, schoolId: schoolA.id, fullName: "Academic Smoke Teacher", phone: "9000000001",
    subject: "Math", assignedClass: "1", assignedSection: "A", mustChangePassword: false,
  }).returning();
  fixture.teacher = teacher.id;

  const [student, incomplete, override] = await db.insert(students).values([
    { schoolId: schoolA.id, digitalStudentId: `${token}-student`, name: "Academic Smoke Student", class: "1", section: "A", phone: "8000000001", dob: "2015-01-01", passwordHash, isActivated: true },
    { schoolId: schoolA.id, digitalStudentId: `${token}-incomplete`, name: "Academic Smoke Incomplete", class: "1", section: "A", phone: "8000000002", dob: "2015-01-02", passwordHash, isActivated: true },
    { schoolId: schoolA.id, digitalStudentId: `${token}-override`, name: "Academic Smoke Override", class: "1", section: "A", phone: "8000000003", dob: "2015-01-03", passwordHash, isActivated: true },
  ]).returning();
  fixture.student = student.id;
  fixture.incomplete = incomplete.id;
  fixture.override = override.id;
  await db.insert(enrollments).values([
    { schoolId: schoolA.id, studentId: student.id, sessionId: sessionA.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: student.id, sessionId: sessionA2.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: incomplete.id, sessionId: sessionA.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: override.id, sessionId: sessionA.id, className: "1", sectionName: "A" },
  ]);
  await Promise.all([addPolicy(schoolA.id), addPolicy(schoolB.id)]);
  await db.insert(examScores).values([
    { schoolId: schoolA.id, sessionId: sessionA.id, studentId: student.id, teacherId: teacher.id, class: "1", section: "A", subject: "Math", examType: "Exam", marks: 80, totalMarks: 100, passMarks: 35, published: true },
    { schoolId: schoolA.id, sessionId: sessionA2.id, studentId: student.id, teacherId: teacher.id, class: "1", section: "A", subject: "Math", examType: "Exam", marks: 20, totalMarks: 100, passMarks: 35, published: false },
    { schoolId: schoolA.id, sessionId: sessionA.id, studentId: override.id, teacherId: teacher.id, class: "1", section: "A", subject: "Math", examType: "Exam", marks: 80, totalMarks: 100, passMarks: 35, published: true },
  ]);
  await db.insert(promotionDecisions).values([
    { schoolId: schoolA.id, sessionId: sessionA.id, class: "1", section: "A", term: "Term1", studentId: override.id, decision: "promoted", targetClass: "2", targetSection: "A", processedByTeacherId: teacher.id, locked: true },
    { schoolId: schoolA.id, sessionId: sessionA.id, class: "1", section: "A", term: "OtherTerm", studentId: override.id, decision: "promoted", targetClass: "9", targetSection: "Z", processedByTeacherId: teacher.id, locked: true },
  ]);

  const app = express();
  app.use(express.json());
  app.use(session({ secret: `${token}-session`, resave: false, saveUninitialized: false }));
  server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Smoke server did not bind.");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (fixture.schoolA) await db.delete(schools).where(eq(schools.id, fixture.schoolA));
  if (fixture.schoolB) await db.delete(schools).where(eq(schools.id, fixture.schoolB));
});

describe.sequential("authenticated academic smoke", () => {
  it("authenticates roles, isolates sessions, and promotes from authoritative data", async () => {
    const admin = new CookieJar();
    const adminStart = await request(admin, "/api/login", {
      method: "POST", body: JSON.stringify({ email: `${token}-admin@example.test`, password }),
    });
    expect(adminStart.response.status).toBe(200);
    expect(adminStart.body.requiresPin).toBe(true);
    const adminPin = await request(admin, "/api/admin/verify-pin", {
      method: "POST", body: JSON.stringify({ pin, tempToken: adminStart.body.tempToken }),
    });
    expect(adminPin.response.status).toBe(200);

    const teacher = new CookieJar();
    expect((await request(teacher, "/api/teacher-login", {
      method: "POST", body: JSON.stringify({ email: `${token}-teacher@example.test`, password }),
    })).response.status).toBe(200);

    const student = new CookieJar();
    expect((await request(student, "/api/student-login", {
      method: "POST", body: JSON.stringify({ dsid: `${token}-student`, password }),
    })).response.status).toBe(200);

    expect((await request(teacher, "/api/admin/academic-results/1/A?term=Term1")).response.status).toBe(403);
    const crossSchool = await request(admin, "/api/admin/academic-results/1/A?term=Term1", {
      headers: { "x-view-session-id": String(fixture.sessionB) },
    });
    expect([404, 409]).toContain(crossSchool.response.status);

    const adminA = await request(admin, "/api/admin/academic-results/1/A?term=Term1");
    expect(adminA.response.status).toBe(200);
    expect(adminA.body.sessionId).toBe(fixture.sessionA);
    expect(adminA.body.results.find((row: any) => row.scope.studentId === fixture.incomplete).promoted).toBeNull();

    const adminA2 = await request(admin, "/api/admin/academic-results/1/A?term=Term1", {
      headers: { "x-view-session-id": String(fixture.sessionA2) },
    });
    expect(adminA2.response.status).toBe(200);
    expect(adminA2.body.sessionId).toBe(fixture.sessionA2);
    expect(adminA2.body.results.find((row: any) => row.scope.studentId === fixture.student).termAverages.Term1).toBe(20);

    const studentA = await request(student, "/api/student/academic-result?term=Term1");
    expect(studentA.response.status).toBe(200);
    expect(studentA.body.termAverages.Term1).toBe(80);
    const studentA2 = await request(student, "/api/student/academic-result?term=Term1", {
      headers: { "x-view-session-id": String(fixture.sessionA2) },
    });
    expect(studentA2.response.status).toBe(200);
    expect(studentA2.body.termAverages.Term1).toBeNull();
    expect(studentA2.body.promoted).toBeNull();

    expect((await request(teacher, "/api/teacher/academic-results/1/A?term=Term1")).response.status).toBe(200);
    expect((await request(teacher, "/api/teacher/academic-results/2/B?term=Term1")).response.status).toBe(403);

    const override = await request(admin, "/api/admin/exam/override", {
      method: "POST",
      body: JSON.stringify({ studentId: fixture.override, examType: "Term1", class: "1", section: "A", overrideStatus: "GRACE_PASS", nextClass: "7", nextSection: "B" }),
    });
    expect(override.response.status).toBe(200);
    const promotion = await request(admin, "/api/admin/promote", {
      method: "POST",
      body: JSON.stringify({ term: "Term1", items: [{ studentId: fixture.override, fromClass: "1", fromSection: "A", nextClass: "2", nextSection: "A", examType: "Term1" }] }),
    });
    expect(promotion.response.status).toBe(200);
    expect(promotion.body.promoted).toBe(1);

    const [promotedStudent, history, termLedger, otherLedger] = await Promise.all([
      db.query.students.findFirst({ where: eq(students.id, fixture.override) }),
      db.query.academicHistory.findFirst({ where: and(eq(academicHistory.schoolId, fixture.schoolA), eq(academicHistory.sessionId, fixture.sessionA), eq(academicHistory.studentId, fixture.override)) }),
      db.query.promotionDecisions.findFirst({ where: and(eq(promotionDecisions.studentId, fixture.override), eq(promotionDecisions.term, "Term1")) }),
      db.query.promotionDecisions.findFirst({ where: and(eq(promotionDecisions.studentId, fixture.override), eq(promotionDecisions.term, "OtherTerm")) }),
    ]);
    expect(promotedStudent).toMatchObject({ class: "7", section: "B", idCardPendingReissue: true });
    expect(history).toMatchObject({ toClass: "7", toSection: "B", snapshotJson: { teacherDecision: "promoted", adminOverride: "GRACE_PASS" } });
    expect(termLedger?.adminExecuted).toBe(true);
    expect(otherLedger?.adminExecuted).toBe(false);
  });
});