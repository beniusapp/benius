import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  academicHistory,
  academicSessions,
  academicTermBoundaries,
  attendanceRecords,
  enrollments,
  examPolicyTiers,
  examScores,
  facultyMappings,
  gradingRules,
  gradingTiers,
  promotionDecisions,
  promotionOverrides,
  schoolMetadata,
  schools,
  students,
  teachers,
  users,
} from "@shared/schema";
import { db } from "../db";
import { PromotionConflictError, storage } from "../storage";
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
  studentOverride: number;
  studentSessionA2Only: number;
  studentRollbackOne: number;
  studentRollbackTwo: number;
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

async function setSchoolAPolicy(mode: "percentage" | "grade" | "both", promotionFailRules: object = {}) {
  await db.update(gradingTiers).set({ gradingSystem: mode }).where(eq(gradingTiers.schoolId, ids.schoolA));
  await db.update(examPolicyTiers).set({ promotionFailRules: JSON.stringify(promotionFailRules) })
    .where(eq(examPolicyTiers.schoolId, ids.schoolA));
}

function promotionItem(studentId: number, nextClass = "2", nextSection = "A") {
  return { studentId, fromClass: "1", fromSection: "A", nextClass, nextSection, examType: "Term1" };
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

  const [studentA, studentAIncomplete, studentOverride, studentSessionA2Only, studentRollbackOne, studentRollbackTwo, studentB] = await db.insert(students).values([
    { schoolId: schoolA.id, digitalStudentId: `${token}-SA1`, name: "Fixture Student A", class: "1", section: "A", phone: "8000000001", dob: "2015-01-01", passwordHash: "fixture", isActivated: true },
    { schoolId: schoolA.id, digitalStudentId: `${token}-SA2`, name: "Fixture Student Incomplete", class: "1", section: "A", phone: "8000000002", dob: "2015-01-02", passwordHash: "fixture", isActivated: true },
    { schoolId: schoolA.id, digitalStudentId: `${token}-SA3`, name: "Fixture Override Student", class: "1", section: "A", phone: "8000000004", dob: "2015-01-04", passwordHash: "fixture", isActivated: true },
    { schoolId: schoolA.id, digitalStudentId: `${token}-SA4`, name: "Fixture Other Session", class: "1", section: "A", phone: "8000000005", dob: "2015-01-05", passwordHash: "fixture", isActivated: true },
    { schoolId: schoolA.id, digitalStudentId: `${token}-SA5`, name: "Fixture Rollback One", class: "1", section: "A", phone: "8000000006", dob: "2015-01-06", passwordHash: "fixture", isActivated: true },
    { schoolId: schoolA.id, digitalStudentId: `${token}-SA6`, name: "Fixture Rollback Two", class: "9", section: "A", phone: "8000000007", dob: "2015-01-07", passwordHash: "fixture", isActivated: true },
    { schoolId: schoolB.id, digitalStudentId: `${token}-SB1`, name: "Fixture Student B", class: "1", section: "A", phone: "8000000003", dob: "2015-01-03", passwordHash: "fixture", isActivated: true },
  ]).returning();
  ids.studentA = studentA.id;
  ids.studentAIncomplete = studentAIncomplete.id;
  ids.studentOverride = studentOverride.id;
  ids.studentSessionA2Only = studentSessionA2Only.id;
  ids.studentRollbackOne = studentRollbackOne.id;
  ids.studentRollbackTwo = studentRollbackTwo.id;
  ids.studentB = studentB.id;

  await db.insert(enrollments).values([
    { schoolId: schoolA.id, studentId: studentA.id, sessionId: sessionA.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: studentA.id, sessionId: sessionA2.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: studentAIncomplete.id, sessionId: sessionA.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: studentOverride.id, sessionId: sessionA.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: studentSessionA2Only.id, sessionId: sessionA2.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: studentRollbackOne.id, sessionId: sessionA.id, className: "1", sectionName: "A" },
    { schoolId: schoolA.id, studentId: studentRollbackTwo.id, sessionId: sessionA.id, className: "1", sectionName: "A" },
    { schoolId: schoolB.id, studentId: studentB.id, sessionId: sessionB.id, className: "1", sectionName: "A" },
  ]);
  await Promise.all([addAcademicPolicy(schoolA.id), addAcademicPolicy(schoolB.id)]);
  await db.insert(schoolMetadata).values([
    { schoolId: schoolA.id, metaKey: "classes", metaValue: JSON.stringify(["1", "2", "7"]) },
    { schoolId: schoolA.id, metaKey: "sections", metaValue: JSON.stringify(["A", "B"]) },
    { schoolId: schoolB.id, metaKey: "classes", metaValue: JSON.stringify(["1", "2"]) },
    { schoolId: schoolB.id, metaKey: "sections", metaValue: JSON.stringify(["A"]) },
  ]);

  await db.insert(examScores).values([
    { schoolId: schoolA.id, sessionId: sessionA.id, studentId: studentA.id, teacherId: teacherA.id, class: "1", section: "A", subject: "Math", examType: "Exam", marks: 80, totalMarks: 100, passMarks: 35, published: true },
    { schoolId: schoolA.id, sessionId: sessionA2.id, studentId: studentA.id, teacherId: teacherA.id, class: "1", section: "A", subject: "Math", examType: "Exam", marks: 20, totalMarks: 100, passMarks: 35, published: false },
    { schoolId: schoolA.id, sessionId: sessionA.id, studentId: studentOverride.id, teacherId: teacherA.id, class: "1", section: "A", subject: "Math", examType: "Exam", marks: 80, totalMarks: 100, passMarks: 35, published: true },
    { schoolId: schoolB.id, sessionId: sessionB.id, studentId: studentB.id, teacherId: teacherB.id, class: "1", section: "A", subject: "Math", examType: "Exam", marks: 45, totalMarks: 100, passMarks: 35, published: true },
  ]);
  await db.insert(promotionDecisions).values([
    {
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
    },
    {
      schoolId: schoolA.id, sessionId: sessionA.id, class: "1", section: "A", term: "Term1",
      studentId: studentOverride.id, decision: "promoted", targetClass: "2", targetSection: "A",
      processedByTeacherId: teacherA.id, locked: true,
    },
  ]);

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
  it("preserves fractional percentages in immutable academic history", async () => {
    const [inserted] = await db.insert(academicHistory).values({
      schoolId: ids.schoolA,
      sessionId: ids.sessionA,
      studentId: ids.studentA,
      fromClass: "1",
      fromSection: "A",
      toClass: "2",
      toSection: "A",
      examType: "Fractional persistence",
      totalObtained: 161,
      totalMax: 200,
      percentage: 80.5,
      snapshotJson: { authoritativePercentage: 80.5 },
    }).returning();
    const persisted = await db.query.academicHistory.findFirst({
      where: eq(academicHistory.id, inserted.id),
    });
    expect(persisted?.percentage).toBe(80.5);
    expect(persisted?.snapshotJson).toMatchObject({ authoritativePercentage: 80.5 });
    await db.delete(academicHistory).where(eq(academicHistory.id, inserted.id));
  });

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
    expect(sessionA2.body.results.map((row: any) => row.scope.studentId).sort()).toEqual(
      [ids.studentA, ids.studentSessionA2Only].sort(),
    );
    expect(sessionA2.body.results.find((row: any) => row.scope.studentId === ids.studentA).termAverages.Term1).toBe(20);
    expect(sessionA2.body.results.find((row: any) => row.scope.studentId === ids.studentSessionA2Only).promoted).toBeNull();
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

  it("rejects unauthorized or out-of-session score writes before any score is saved", async () => {
    const before = await db.select().from(examScores).where(and(
      eq(examScores.schoolId, ids.schoolA),
      eq(examScores.sessionId, ids.sessionA),
      eq(examScores.examType, "Authorization Test"),
    ));
    const unauthorizedSubject = await json("/api/exam-scores", {
      method: "POST",
      headers: headers("teacher", ids.schoolA, ids.sessionA, ids.teacherA),
      body: JSON.stringify({
        class: "1", section: "A", subject: "Science", examType: "Authorization Test",
        totalMarks: 100, passMarks: 35, scores: [{ studentId: ids.studentAIncomplete, marks: 70 }],
      }),
    });
    expect(unauthorizedSubject.response.status).toBe(403);

    const outsideSession = await json("/api/exam-scores", {
      method: "POST",
      headers: headers("teacher", ids.schoolA, ids.sessionA, ids.teacherA),
      body: JSON.stringify({
        class: "1", section: "A", subject: "Math", examType: "Authorization Test",
        totalMarks: 100, passMarks: 35, scores: [{ studentId: ids.studentSessionA2Only, marks: 70 }],
      }),
    });
    expect(outsideSession.response.status).toBe(403);
    expect(await db.select().from(examScores).where(and(
      eq(examScores.schoolId, ids.schoolA),
      eq(examScores.sessionId, ids.sessionA),
      eq(examScores.examType, "Authorization Test"),
    ))).toHaveLength(before.length);
  });

  it("does not publish any cohort score when a mapped teacher lacks one batch subject", async () => {
    await db.insert(facultyMappings).values({
      schoolId: ids.schoolA,
      teacherId: ids.teacherA,
      className: "1",
      section: "A",
      subject: "Math",
    });
    await db.insert(examScores).values([
      {
        schoolId: ids.schoolA, sessionId: ids.sessionA, studentId: ids.studentA,
        teacherId: ids.teacherA, class: "1", section: "A", subject: "Math",
        examType: "Subject publish authorization", marks: 80, totalMarks: 100, passMarks: 35, published: false,
      },
      {
        schoolId: ids.schoolA, sessionId: ids.sessionA, studentId: ids.studentAIncomplete,
        teacherId: ids.teacherA, class: "1", section: "A", subject: "Science",
        examType: "Subject publish authorization", marks: 75, totalMarks: 100, passMarks: 35, published: false,
      },
    ]);

    const denied = await json("/api/exam-scores/publish", {
      method: "POST",
      headers: headers("teacher", ids.schoolA, ids.sessionA, ids.teacherA),
      body: JSON.stringify({
        schoolId: ids.schoolA, class: "1", section: "A", examType: "Subject publish authorization",
      }),
    });

    expect(denied.response.status).toBe(403);
    const batch = await db.select().from(examScores).where(and(
      eq(examScores.schoolId, ids.schoolA),
      eq(examScores.sessionId, ids.sessionA),
      eq(examScores.class, "1"),
      eq(examScores.section, "A"),
      eq(examScores.examType, "Subject publish authorization"),
    ));
    expect(batch).toHaveLength(2);
    expect(batch.every(score => !score.published)).toBe(true);
  });

  it("scopes teacher exam reads and promotion verdicts to the selected session", async () => {
    const scoreRead = await json(`/api/exam-scores/student/${ids.studentSessionA2Only}/${ids.schoolA}`, {
      headers: headers("teacher", ids.schoolA, ids.sessionA, ids.teacherA),
    });
    expect(scoreRead.response.status).toBe(403);

    const verdict = await json(`/api/teacher/promotion-verdict/${ids.studentSessionA2Only}?term=Term1&class=1&section=A`, {
      headers: headers("teacher", ids.schoolA, ids.sessionA, ids.teacherA),
    });
    expect(verdict.response.status).toBe(403);
  });

  it("evaluates percentage, grade, and both policies through the authenticated admin handler", async () => {
    for (const mode of ["percentage", "grade", "both"] as const) {
      await setSchoolAPolicy(mode);
      const evaluation = await json("/api/admin/exam-policy-tiers/evaluate", {
        method: "POST",
        headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
        body: JSON.stringify({ studentId: ids.studentA, currentTerm: "Term1" }),
      });
      expect(evaluation.response.status).toBe(200);
      expect(evaluation.body.termAverages.Term1).toBe(80);
      expect(evaluation.body.termGrades.Term1).toMatchObject({ label: "C", gradePoint: "5" });
      expect(evaluation.body.promoted).toBe(true);
    }
  });

  it("applies Rules 1 through 4 through the authenticated evaluation route", async () => {
    await db.update(examScores).set({ marks: 30 }).where(and(
      eq(examScores.schoolId, ids.schoolA),
      eq(examScores.sessionId, ids.sessionA),
      eq(examScores.studentId, ids.studentA),
    ));
    await db.insert(academicTermBoundaries).values({
      schoolId: ids.schoolA, sessionId: ids.sessionA, term: "Term1",
      startDate: "2026-04-01", endDate: "2026-06-30",
    });
    await db.insert(attendanceRecords).values([
      { schoolId: ids.schoolA, sessionId: ids.sessionA, studentId: ids.studentA, teacherId: ids.teacherA, date: "2026-04-01", status: "present", markedBy: "fixture", class: "1", section: "A" },
      { schoolId: ids.schoolA, sessionId: ids.sessionA, studentId: ids.studentA, teacherId: ids.teacherA, date: "2026-04-02", status: "absent", markedBy: "fixture", class: "1", section: "A" },
    ]);
    await setSchoolAPolicy("both", {
      rule1: { enabled: true, rules: [{ term: "Term1", fail_count: 1 }] },
      rule_attendance: { enabled: true, rules: [{ term: "Term1", min_pct: 80 }] },
      rule_term_avg: { enabled: true, term: "Term1", minPct: 40 },
    },);
    await db.update(examPolicyTiers).set({
      resultsConfig: JSON.stringify({
        cumulative: { enabled: true, promotionEnabled: true, triggerTerm: "Term1", termWeights: { Term1: 100 }, minPercent: 40 },
      }),
    }).where(eq(examPolicyTiers.schoolId, ids.schoolA));

    const evaluation = await json("/api/admin/exam-policy-tiers/evaluate", {
      method: "POST",
      headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
      body: JSON.stringify({ studentId: ids.studentA, currentTerm: "Term1" }),
    });
    expect(evaluation.response.status).toBe(200);
    expect(evaluation.body.violations.map((violation: any) => violation.rule))
      .toEqual(expect.arrayContaining(["rule1", "rule2", "rule3", "rule4"]));

    await db.update(examScores).set({ marks: 80 }).where(and(
      eq(examScores.schoolId, ids.schoolA), eq(examScores.sessionId, ids.sessionA), eq(examScores.studentId, ids.studentA),
    ));
    await db.update(examPolicyTiers).set({ resultsConfig: "{}", promotionFailRules: JSON.stringify({ rule1: { enabled: true, rules: [{ term: "Term1", fail_count: 1 }] } }) })
      .where(eq(examPolicyTiers.schoolId, ids.schoolA));
    await setSchoolAPolicy("percentage");
  });

  it("returns 409 when authenticated context selects a stale academic session", async () => {
    const stale = await json("/api/admin/academic-results/1/A?term=Term1", {
      headers: headers("admin", ids.schoolA, 987654321, ids.adminA),
    });
    expect(stale.response.status).toBe(409);
  });

  it("scopes admin overrides to the authenticated tenant and selected session", async () => {
    const base = { examType: "Term1", class: "1", section: "A", overrideStatus: "GRACE_PASS", nextClass: "7", nextSection: "B" };
    const valid = await json("/api/admin/exam/override", {
      method: "POST", headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
      body: JSON.stringify({ ...base, studentId: ids.studentOverride }),
    });
    expect(valid.response.status).toBe(200);
    expect(await db.query.promotionOverrides.findFirst({ where: and(
      eq(promotionOverrides.schoolId, ids.schoolA), eq(promotionOverrides.sessionId, ids.sessionA),
      eq(promotionOverrides.studentId, ids.studentOverride),
    ) })).toMatchObject({ nextClass: "7", nextSection: "B" });

    const crossTenant = await json("/api/admin/exam/override", {
      method: "POST", headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
      body: JSON.stringify({ ...base, studentId: ids.studentB }),
    });
    expect(crossTenant.response.status).toBe(409);
    const crossSession = await json("/api/admin/exam/override", {
      method: "POST", headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
      body: JSON.stringify({ ...base, studentId: ids.studentSessionA2Only }),
    });
    expect(crossSession.response.status).toBe(409);
  });

  it("rejects an invalid bulk override status before saving overrides", async () => {
    const invalid = await json("/api/admin/exam/override/bulk", {
      method: "POST",
      headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
      body: JSON.stringify({
        items: [{
          studentId: ids.studentA,
          examType: "Term1",
          class: "1",
          section: "A",
          overrideStatus: "PROMOTE_ANYWAY",
          nextClass: "2",
          nextSection: "A",
        }],
      }),
    });
    expect(invalid.response.status).toBe(400);
    expect(await db.query.promotionOverrides.findFirst({ where: and(
      eq(promotionOverrides.schoolId, ids.schoolA),
      eq(promotionOverrides.studentId, ids.studentA),
      eq(promotionOverrides.examType, "Term1"),
    ) })).toBeUndefined();
  });

  it("requires a PASS or GRACE_PASS override to execute a retained ledger and consumes an authorized override atomically", async () => {
    await db.insert(promotionDecisions).values([
      {
        schoolId: ids.schoolA, sessionId: ids.sessionA, class: "1", section: "A", term: "Override authorization",
        studentId: ids.studentSessionA2Only, decision: "retained", targetClass: "1", targetSection: "A",
        processedByTeacherId: ids.teacherA, locked: true,
      },
      {
        schoolId: ids.schoolA, sessionId: ids.sessionA, class: "1", section: "A", term: "Override authorization",
        studentId: ids.studentAIncomplete, decision: "retained", targetClass: "1", targetSection: "A",
        processedByTeacherId: ids.teacherA, locked: true,
      },
    ]);
    await storage.upsertPromotionOverride({
      schoolId: ids.schoolA, sessionId: ids.sessionA, studentId: ids.studentSessionA2Only,
      examType: "Override authorization", class: "1", section: "A",
      overrideStatus: "PASS", nextClass: "2", nextSection: "A",
    });
    await storage.upsertPromotionOverride({
      schoolId: ids.schoolA, sessionId: ids.sessionA, studentId: ids.studentAIncomplete,
      examType: "Override authorization", class: "1", section: "A",
      overrideStatus: "FAIL", nextClass: "2", nextSection: "A",
    });
    const history = (studentId: number) => ({
      schoolId: ids.schoolA, sessionId: ids.sessionA, studentId,
      fromClass: "1", fromSection: "A", toClass: "2", toSection: "A",
      examType: "Override authorization", totalObtained: 161, totalMax: 200,
      percentage: 80, gradeLabel: "C", gradePoint: "5", remarks: "Pass",
      snapshotJson: { termAverage: 80 },
    });
    await expect(storage.executePromotionTransaction(ids.schoolA, [{
      studentId: ids.studentSessionA2Only, fromClass: "1", fromSection: "A", nextClass: "2", nextSection: "A",
      examType: "Override authorization", teacherDecision: "retained", adminOverride: "PASS",
    }], [history(ids.studentSessionA2Only)], "Override authorization", ids.sessionA, ids.adminA)).resolves.toBe(1);
    expect(await db.query.promotionOverrides.findFirst({ where: and(
      eq(promotionOverrides.studentId, ids.studentSessionA2Only),
      eq(promotionOverrides.examType, "Override authorization"),
    ) })).toBeUndefined();
    expect((await db.query.promotionDecisions.findFirst({ where: and(
      eq(promotionDecisions.studentId, ids.studentSessionA2Only),
      eq(promotionDecisions.term, "Override authorization"),
    ) }))?.adminExecuted).toBe(true);

    await expect(storage.executePromotionTransaction(ids.schoolA, [{
      studentId: ids.studentAIncomplete, fromClass: "1", fromSection: "A", nextClass: "2", nextSection: "A",
      examType: "Override authorization", teacherDecision: "retained", adminOverride: "FAIL",
    }], [history(ids.studentAIncomplete)], "Override authorization", ids.sessionA, ids.adminA))
      .rejects.toBeInstanceOf(PromotionConflictError);
    expect((await db.query.promotionDecisions.findFirst({ where: and(
      eq(promotionDecisions.studentId, ids.studentAIncomplete),
      eq(promotionDecisions.term, "Override authorization"),
    ) }))?.adminExecuted).toBe(false);
    expect(await db.query.promotionOverrides.findFirst({ where: and(
      eq(promotionOverrides.studentId, ids.studentAIncomplete),
      eq(promotionOverrides.examType, "Override authorization"),
    ) })).toMatchObject({ overrideStatus: "FAIL" });
  });

  it("rejects a stale expected calculation version before promotion execution", async () => {
    const stale = await json("/api/admin/promote", {
      method: "POST", headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
      body: JSON.stringify({ term: "Term1", expectedCalculationVersion: "obsolete-version", items: [promotionItem(ids.studentOverride)] }),
    });
    expect(stale.response.status).toBe(409);
    expect((await db.query.promotionDecisions.findFirst({ where: and(
      eq(promotionDecisions.studentId, ids.studentOverride), eq(promotionDecisions.sessionId, ids.sessionA),
    ) }))?.adminExecuted).toBe(false);
  });

  it("promotes using an authenticated admin override destination and archives its authoritative snapshot", async () => {
    const promotion = await json("/api/admin/promote", {
      method: "POST", headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
      body: JSON.stringify({ term: "Term1", items: [promotionItem(ids.studentOverride)] }),
    });
    expect(promotion.response.status).toBe(200);
    expect(await db.query.students.findFirst({ where: eq(students.id, ids.studentOverride) }))
      .toMatchObject({ class: "7", section: "B", idCardPendingReissue: true });
    expect(await db.query.academicHistory.findFirst({ where: eq(academicHistory.studentId, ids.studentOverride) }))
      .toMatchObject({ toClass: "7", toSection: "B", snapshotJson: { adminOverride: "GRACE_PASS", teacherDecision: "promoted" } });
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

  it("rejects invalid configured destinations without writing history, students, or ledgers", async () => {
    await storage.upsertPromotionOverride({
      schoolId: ids.schoolA, sessionId: ids.sessionA, studentId: ids.studentA,
      examType: "Term1", class: "1", section: "A",
      overrideStatus: "PASS", nextClass: "999", nextSection: "Z",
    });
    const rejected = await json("/api/admin/promote", {
      method: "POST",
      headers: headers("admin", ids.schoolA, ids.sessionA, ids.adminA),
      body: JSON.stringify({ term: "Term1", items: [promotionItem(ids.studentA, "999", "Z")] }),
    });
    expect(rejected.response.status).toBe(409);
    expect(await db.query.students.findFirst({ where: eq(students.id, ids.studentA) }))
      .toMatchObject({ class: "2", section: "A" });
    expect(await db.query.academicHistory.findFirst({ where: and(
      eq(academicHistory.studentId, ids.studentA),
      eq(academicHistory.toClass, "999"),
    ) })).toBeUndefined();
  });

  it("rolls back history, student changes, and ledger execution when a selected row changes", async () => {
    await db.insert(promotionDecisions).values([
      {
        schoolId: ids.schoolA, sessionId: ids.sessionA, class: "1", section: "A", term: "Rollback",
        studentId: ids.studentRollbackOne, decision: "promoted", targetClass: "2", targetSection: "A",
        processedByTeacherId: ids.teacherA, locked: true,
      },
      {
        schoolId: ids.schoolA, sessionId: ids.sessionA, class: "1", section: "A", term: "Rollback",
        studentId: ids.studentRollbackTwo, decision: "promoted", targetClass: "2", targetSection: "A",
        processedByTeacherId: ids.teacherA, locked: true,
      },
    ]);
    const transactionItems = [
      { studentId: ids.studentRollbackOne, fromClass: "1", fromSection: "A", nextClass: "2", nextSection: "A", examType: "Rollback", teacherDecision: "promoted", adminOverride: null },
      // The student has changed to class 9 after the selection was assembled.
      { studentId: ids.studentRollbackTwo, fromClass: "1", fromSection: "A", nextClass: "2", nextSection: "A", examType: "Rollback", teacherDecision: "promoted", adminOverride: null },
    ];
    const historyRecords = transactionItems.map(item => ({
      schoolId: ids.schoolA, sessionId: ids.sessionA, studentId: item.studentId,
      fromClass: item.fromClass, fromSection: item.fromSection, toClass: item.nextClass, toSection: item.nextSection,
      examType: "Rollback", totalObtained: 80, totalMax: 100, percentage: 80,
      gradeLabel: "C", gradePoint: "5", remarks: "Pass", snapshotJson: { fixture: "rollback" },
    }));

    await expect(storage.executePromotionTransaction(ids.schoolA, transactionItems, historyRecords, "Rollback", ids.sessionA, ids.adminA))
      .rejects.toBeInstanceOf(PromotionConflictError);
    expect(await db.query.academicHistory.findFirst({ where: and(
      eq(academicHistory.sessionId, ids.sessionA), eq(academicHistory.studentId, ids.studentRollbackOne),
    ) })).toBeUndefined();
    expect(await db.query.students.findFirst({ where: eq(students.id, ids.studentRollbackOne) }))
      .toMatchObject({ class: "1", section: "A", idCardPendingReissue: false });
    const ledgers = await db.select().from(promotionDecisions).where(and(
      eq(promotionDecisions.sessionId, ids.sessionA), eq(promotionDecisions.term, "Rollback"),
    ));
    expect(ledgers).toHaveLength(2);
    expect(ledgers.every(ledger => !ledger.adminExecuted)).toBe(true);
  });
});