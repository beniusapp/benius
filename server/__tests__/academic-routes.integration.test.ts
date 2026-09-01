import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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
import { registerTeacherRoutes } from "../teacher-routes";

type FixtureIds = {
  schoolA: number;
  schoolB: number;
  sessionA: number;
  sessionA2: number;
  sessionB: number;
  adminA: number;
  teacherA: number;
  studentA: number;
  studentAIncomplete: number;
  studentB: number;
};

const ids = {} as FixtureIds;
let origin = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

function headers(role: "admin" | "teacher" | "student", schoolId: number, sessionId: number, actorId: number) {
  return {
    "content-type": "application/json",
    "x-test-role": role,
    "x-test-school": String(schoolId),
    "x-test-session": String(sessionId),
    "x-test-actor": String(actorId),
  };
}

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${origin}${path}`, init);
  const body = await response.json();
  return { response, body };
}

async function addAcademicPolicy(schoolId: number) {
  const [tier] = await db.insert(gradingTiers).values({
    schoolId,
    name: "Phase 5 percentage policy",
    classes: ["1", "2"],
    passPercentage: 35,
    gradingSystem: "percentage",
    passingGrades: ["C"],
  }).returning();
  await db.insert(gradingRules).values([
    { tierId: tier.id, schoolId, gradeLabel: "F", minPercent: 0, maxPercent: 34, gradePoint: "0", remarks: "Fail", sortOrder: 0 },
    { tierId: tier.id, schoolId, gradeLabel: "C", minPercent: 35, maxPercent: 100, gradePoint: "5", remarks: "Pass", sortOrder: 1 },
  ]);
  await db.insert(examPolicyTiers).values({
    schoolId,
    tierName: "Phase 5 exam policy",
    applicableClasses: ["1", "2"],
    examWeights: JSON.stringify({ Term1: [{ source_exam: "Exam", weight: 100 }] }),
    promotionFailRules: JSON.stringify({ rule1: { enabled: true, rules: [{ term: "Term1", fail_count: 1 }] } }),
    resultsConfig: "{}",
  });
  await db.insert(schoolMetadata).values({
    schoolId,
    metaKey: "class_subjects",
    metaValue: JSON.stringify({ "1": ["Math"], "2": ["Math"] }),
  });
}

beforeAll(async () => {
  const token = `p5_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const [schoolA, schoolB] = await db.insert(schools).values([
    { name: `${token} School A`, code: `${token.slice(-8)}A` },
    { name: `${token} School B`, code: `${token.slice(-8)}B` },
  ]).returning();
  ids.schoolA = schoolA.id;
  ids.schoolB = schoolB.id;

  const [sessionA, sessionA2, sessionB] = await db.insert(academicSessions).values([
    { schoolId: schoolA.id, sessionName: `${token}-A1`, startDate: "2026-04-01", endDate: "2027-03-31", isActive: true, status: "active" },
    { schoolId: schoolA.id, sessionName: `${token}-A2`, startDate: "2027-04-01", endDate: "2028-03-31", isActive: false, status: "draft" },
    { schoolId: schoolB.id, sessionName: `${token}-B1`, startDate: "2026-04-01", endDate: "2027-03-31", isActive: true, status: "active" },
  ]).returning();
  ids.sessionA = sessionA.id;
  ids.sessionA2 = sessionA2.id;
  ids.sessionB = sessionB.id;

  const [adminA, teacherUserA, teacherUserB] = await db.insert(users).values([
    { schoolId: schoolA.id, email: `${token}-admin-a@example.test`, passwordHash: "fixture", role: "admin", isInitialized: true },
    { schoolId: schoolA.id, email: `${token}-teacher-a@example.test`, passwordHash: "fixture", role: "teacher", isInitialized: true },
    { schoolId: schoolB.id, email: `${token}-teacher-b@example.test`, passwordHash: "fixture", role: "teacher", isInitialized: true },
  ]).returning();
  ids.adminA = adminA.id;
  const [teacherA, teacherB] = await db.insert(teachers).values([
    { userId: teacherUserA.id, schoolId: schoolA.id, fullName: "Fixture Teacher A", phone: "9000000001", subject: "Math", assignedClass: "1", assignedSection: "A", mustChangePassword: false },
    { userId: teacherUserB.id, schoolId: schoolB.id, fullName: "Fixture Teacher B", phone: "9000000002", subject: "Math", assignedClass: "1", assignedSection: "A", mustChangePassword: false },
  ]).returning();
  ids.teacherA = teacherA.id;

  const [studentA, studentAIncomplete, studentB] = await db.insert(students).values([
    { schoolId: schoolA.id, digitalStudentId: `${token}-SA1`, name: "Fixture Student A", class: "1", section: "A", phone: "8000000001", dob: "2015-01-01", passwordHash: "fixture", isActivated: true },
    { schoolId: schoolA.id, digitalStudentId: `${token}-SA2`, name: "Fixture Student Incomplete", class: "1", section: "A", phone: "8000000002", dob: "2015-01-02", passwordHash: "fixture", isActivated: true },
    { schoolId: schoolB.id, digitalStudentId: `${token}-SB1`, name: "Fixture Student B", class: "1", section: "A", phone: "8000000003", dob: "2015-01-03", passwordHash: "fixture", isActivated: true },
  ]).returning();
  ids.studentA = studentA.id;
  ids.studentAIncomplete = studentAIncomplete.id;
  ids.studentB = studentB.id;

  await db.insert(enrollments).values([
    { schoolId: schoolA.id, studentId: studentA.id, sessionId: sessionA.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: studentA.id, sessionId: sessionA2.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: studentAIncomplete.id, sessionId: sessionA.id, className: "1", sectionName: "A" },
    { schoolId: schoolB.id, studentId: studentB.id, sessionId: sessionB.id, className: "1", sectionName: "A" },
  ]);
  await Promise.all([addAcademicPolicy(schoolA.id), addAcademicPolicy(schoolB.id)]);

  await db.insert(examScores).values([
    { schoolId: schoolA.id, sessionId: sessionA.id, studentId: studentA.id, teacherId: teacherA.id, class: "1", section: "A", subject: "Math", examType: "Exam", marks: 80, totalMarks: 100, passMarks: 35, published: true },
    { schoolId: schoolA.id, sessionId: sessionA2.id, studentId: studentA.id, teacherId: teacherA.id, class: "1", section: "A", subject: "Math", examType: "Exam", marks: 20, totalMarks: 100, passMarks: 35, published: false },
    { schoolId: schoolB.id, sessionId: sessionB.id, studentId: studentB.id, teacherId: teacherB.id, class: "1", section: "A", subject: "Math", examType: "Exam", marks: 45, totalMarks: 100, passMarks: 35, published: true },
  ]);
  await db.insert(promotionDecisions).values({
    schoolId: schoolA.id,
    sessionId: sessionA.id,
    class: "1",
    section: "A",
    term: "Term1",
    studentId: studentA.id,
    decision: "promoted",
    targetClass: "2",
    targetSection: "A",
    processedByTeacherId: teacherA.id,
    locked: true,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.header("x-test-role");
    const schoolId = Number(req.header("x-test-school"));
    const actorId = Number(req.header("x-test-actor"));
    (req as any).viewSessionId = Number(req.header("x-test-session"));
    (req as any).session = {
      schoolId,
      ...(role === "admin" ? { userId: actorId, userRole: "admin" } : {}),
      ...(role === "teacher" ? { teacherId: actorId, userRole: "teacher" } : {}),
      ...(role === "student" ? { studentId: actorId, userRole: "student" } : {}),
    };
    next();
  });
  registerTeacherRoutes(app);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Integration server did not bind.");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (ids.schoolA) await db.delete(schools).where(eq(schools.id, ids.schoolA));
  if (ids.schoolB) await db.delete(schools).where(eq(schools.id, ids.schoolB));
});

describe.sequential("authenticated academic route isolation", () => {
  it("keeps admin cohort reads inside the authenticated school and selected session", async () => {
    const sessionA = await json("/api/admin/academic-results/1/A?term=Term1", {
      headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
    });
    expect(sessionA.response.status).toBe(200);
    expect(sessionA.body.results.map((row: any) => row.scope.studentId)).toEqual(
      expect.arrayContaining([ids.studentA, ids.studentAIncomplete]),
    );
    expect(sessionA.body.results.some((row: any) => row.scope.studentId === ids.studentB)).toBe(false);
    expect(sessionA.body.results.find((row: any) => row.scope.studentId === ids.studentA).termAverages.Term1).toBe(80);
    expect(sessionA.body.results.find((row: any) => row.scope.studentId === ids.studentAIncomplete).promoted).toBeNull();

    const sessionA2 = await json("/api/admin/academic-results/1/A?term=Term1", {
      headers: headers("admin", ids.schoolA, ids.sessionA2, ids.adminA),
    });
    expect(sessionA2.response.status).toBe(200);
    expect(sessionA2.body.results).toHaveLength(1);
    expect(sessionA2.body.results[0].termAverages.Term1).toBe(20);
  });

  it("prevents student cross-student access and hides unpublished student scores", async () => {
    const own = await json("/api/student/academic-result?term=Term1", {
      headers: headers("student", ids.schoolA, ids.sessionA, ids.studentA),
    });
    expect(own.response.status).toBe(200);
    expect(own.body.scope.studentId).toBe(ids.studentA);
    expect(own.body.termAverages.Term1).toBe(80);

    const other = await json(`/api/academic-calculation/${ids.studentB}?term=Term1`, {
      headers: headers("student", ids.schoolA, ids.sessionA, ids.studentA),
    });
    expect(other.response.status).toBe(403);

    const unpublished = await json("/api/student/academic-result?term=Term1", {
      headers: headers("student", ids.schoolA, ids.sessionA2, ids.studentA),
    });
    expect(unpublished.response.status).toBe(200);
    expect(unpublished.body.termAverages.Term1).toBeNull();
    expect(unpublished.body.promoted).toBeNull();
  });

  it("prevents teachers from reading unauthorized class-sections", async () => {
    const allowed = await json("/api/teacher/academic-results/1/A?term=Term1", {
      headers: headers("teacher", ids.schoolA, ids.sessionA, ids.teacherA),
    });
    expect(allowed.response.status).toBe(200);
    const denied = await json("/api/teacher/academic-results/2/B?term=Term1", {
      headers: headers("teacher", ids.schoolA, ids.sessionA, ids.teacherA),
    });
    expect(denied.response.status).toBe(403);
  });

  it("promotes only the selected student and stores an authoritative immutable snapshot", async () => {
    const promotion = await json("/api/admin/promote", {
      method: "POST",
      headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
      body: JSON.stringify({
        term: "Term1",
        items: [{
          studentId: ids.studentA,
          fromClass: "1",
          fromSection: "A",
          nextClass: "99",
          nextSection: "Z",
          examType: "Term1",
        }],
      }),
    });
    expect(promotion.response.status).toBe(200);
    expect(promotion.body.promoted).toBe(1);

    const selected = await db.query.students.findFirst({ where: eq(students.id, ids.studentA) });
    const unselected = await db.query.students.findFirst({ where: eq(students.id, ids.studentAIncomplete) });
    expect(selected).toMatchObject({ class: "2", section: "A", idCardPendingReissue: true });
    expect(unselected).toMatchObject({ class: "1", section: "A" });

    const history = await db.query.academicHistory.findFirst({ where: eq(academicHistory.studentId, ids.studentA) });
    expect(history).toMatchObject({
      schoolId: ids.schoolA,
      sessionId: ids.sessionA,
      fromClass: "1",
      toClass: "2",
      percentage: 80,
    });
    expect(history?.snapshotJson).toMatchObject({
      systemPolicyVerdict: true,
      teacherDecision: "promoted",
      calculationVersion: expect.any(String),
    });
  });
});