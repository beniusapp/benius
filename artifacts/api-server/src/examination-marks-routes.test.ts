import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { storage } from "./storage";
import { PromotionStage1Error } from "./promotion-stage1";
import { registerTeacherRoutes } from "./teacher-routes";

test("Web Add Marks is same-school while existing examination read and ledger scopes stay intact", async t => {
  const replacements: Array<{ target: any; name: string; hadOwn: boolean; original: unknown }> = [];
  const replace = (name: string, implementation: (...args: any[]) => any) => {
    replacements.push({
      target: storage,
      name,
      hadOwn: Object.prototype.hasOwnProperty.call(storage, name),
      original: (storage as any)[name],
    });
    (storage as any)[name] = implementation;
  };

  const sessions = new Map<number, { id: number; schoolId: number; isActive: boolean }>([
    [41, { id: 41, schoolId: 11, isActive: false }],
    [42, { id: 42, schoolId: 11, isActive: true }],
    [88, { id: 88, schoolId: 12, isActive: true }],
  ]);
  const scoreWrites: any[][] = [];
  const scoreWriteOptions: any[] = [];
  const adminReads: unknown[][] = [];
  const scopedOptionReads: unknown[][] = [];
  let lockedLedgerBlock = false;
  let teacherIsActive = true;
  let userIsActive = true;
  let facultyMappingReads = 0;
  let schoolMappings: Array<{ className: string; section: string; subject: string | null }> = [];

  replace("getTeacherWithSchool", async (teacherId: number) => teacherId === 7 ? {
    teacher: {
      id: 7,
      userId: 8,
      schoolId: 11,
      isActive: teacherIsActive,
      fullName: "Teacher One",
      assignedClass: "5",
      assignedSection: "A",
      subject: "Mathematics",
    },
    school: { id: 11 },
    user: { id: 8, schoolId: 11, role: "teacher", isActive: userIsActive },
  } : undefined);
  replace("getAcademicSessionForSchool", async (id: number, schoolId: number) => {
    const session = sessions.get(id);
    return session?.schoolId === schoolId ? session : undefined;
  });
  replace("getAcademicSessionById", async (id: number) => sessions.get(id));
  replace("getActiveSession", async () => sessions.get(42));
  replace("getFacultyMappingsForTeacherInSchool", async () => {
    facultyMappingReads += 1;
    return schoolMappings;
  });
  replace("getFacultyMappingsByTeacher", async () => []);
  replace("getClassSubjectsMap", async () => ({
    "5": ["Mathematics", "Science"],
    "6": ["Mathematics", "Science"],
  }));
  replace("getClassSectionsMap", async () => ({
    "5": ["A"],
    "6": ["A"],
  }));
  replace("getClassExamTypesMap", async () => ({
    "5": ["Term 2"],
    "6": ["Term 2"],
  }));
  replace("getAllSchoolMetadata", async () => ({
    classes: ["5", "6"],
    sections: ["A"],
    exam_types: ["Term 2"],
  }));
  replace("getStudentsByClassSectionForExamSession", async (
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
  ) => {
    scopedOptionReads.push(["roster", schoolId, sessionId, cls, section]);
    return [{ id: 7, schoolId, class: cls, section } as any];
  });
  replace("resolveClassPassPolicy", async () => ({ passPercentage: 35 }));
  replace("upsertExamScores", async (scores: any[], options: any) => {
    if (lockedLedgerBlock) {
      throw new PromotionStage1Error(
        "Marks for Term 2 cannot be saved because they affect a locked term; marks are locked pending an authorized correction workflow.",
        409,
        "PROMOTION_DECISION_LOCKED",
      );
    }
    scoreWrites.push(scores);
    scoreWriteOptions.push(options);
    return scores;
  });
  replace("getTeacherExamScoresForSession", async (...args: unknown[]) => {
    adminReads.push(args);
    return [{ id: 500 } as any];
  });
  replace("getTeacherExamScoresByStudentInClassSession", async (...args: unknown[]) => {
    adminReads.push(args);
    return [
      { id: 501, subject: "Mathematics", examType: "Term 2", marks: 72, totalMarks: 100, isAbsent: false },
      { id: 502, subject: "Science", examType: "Term 2", marks: 68, totalMarks: 100, isAbsent: false },
    ] as any;
  });
  replace("getTeacherClassAveragesForSession", async (...args: unknown[]) => {
    adminReads.push(args);
    return [{ examType: "Term 2", avgPercentage: 72 }];
  });
  replace("getDistinctEnrollmentSectionsForExamSession", async (...args: unknown[]) => {
    scopedOptionReads.push(["sections", ...args]);
    return ["A"];
  });
  replace("getDistinctExamTypesForExamSession", async (...args: unknown[]) => {
    scopedOptionReads.push(["exam-types", ...args]);
    return ["Term 2"];
  });
  replace("publishExamScores", async (...args: unknown[]) => {
    adminReads.push(["publish", ...args]);
    return 1;
  });

  t.after(() => {
    for (const { target, name, hadOwn, original } of replacements.reverse()) {
      if (hadOwn) target[name] = original;
      else delete target[name];
    }
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get("x-test-role") ?? "teacher";
    const schoolId = Number(req.get("x-test-school") ?? 11);
    (req as any).session = role === "anonymous"
      ? {}
      : role === "admin"
        ? { userId: 70, userRole: "admin", schoolId }
        : { userId: 8, teacherId: 7, userRole: "teacher", schoolId };
    next();
  });
  registerTeacherRoutes(app);

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      sessionId?: number | string;
      role?: "teacher" | "admin" | "anonymous";
      schoolId?: number;
    } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        connection: "close",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.sessionId === undefined ? {} : { "x-view-session-id": String(options.sessionId) }),
        ...(options.role ? { "x-test-role": options.role } : {}),
        ...(options.schoolId === undefined ? {} : { "x-test-school": String(options.schoolId) }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  const baseSubmission = {
    class: "5",
    section: "A",
    subject: "Mathematics",
    examType: "Term 2",
    totalMarks: 100,
    scores: [{ studentId: 7, marks: 0, isAbsent: false }],
  };

  const missingSessionWrite = await request("/api/exam-scores", {
    method: "POST",
    body: baseSubmission,
  });
  assert.equal(missingSessionWrite.status, 400);

  const archivedWrite = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 41,
    body: baseSubmission,
  });
  assert.equal(archivedWrite.status, 403);

  const foreignWrite = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 88,
    body: baseSubmission,
  });
  assert.equal(foreignWrite.status, 403);

  const invalidSession = await request("/api/exam-scores", {
    method: "POST",
    sessionId: "not-a-session",
    body: baseSubmission,
  });
  assert.equal(invalidSession.status, 400);

  const incompleteWrite = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    body: { ...baseSubmission, scores: [{ studentId: 7, marks: "", isAbsent: false }] },
  });
  assert.equal(incompleteWrite.status, 400);

  const invalidSubject = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    body: { ...baseSubmission, subject: "Chemistry" },
  });
  assert.equal(invalidSubject.status, 400);

  const invalidExamType = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    body: { ...baseSubmission, examType: "Unconfigured Exam" },
  });
  assert.equal(invalidExamType.status, 400);

  const outOfRangeMarks = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    body: { ...baseSubmission, scores: [{ studentId: 7, marks: 101, isAbsent: false }] },
  });
  assert.equal(outOfRangeMarks.status, 400);

  const wrongStudentEnrollment = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    body: { ...baseSubmission, scores: [{ studentId: 99, marks: 25, isAbsent: false }] },
  });
  assert.equal(wrongStudentEnrollment.status, 403);
  assert.equal(scoreWrites.length, 0);

  const unauthenticatedWrite = await request("/api/exam-scores", {
    method: "POST",
    role: "anonymous",
    sessionId: 42,
    body: baseSubmission,
  });
  assert.equal(unauthenticatedWrite.status, 401);

  teacherIsActive = false;
  const inactiveTeacherWrite = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    body: baseSubmission,
  });
  teacherIsActive = true;
  assert.equal(inactiveTeacherWrite.status, 401);

  userIsActive = false;
  const inactiveUserWrite = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    body: baseSubmission,
  });
  userIsActive = true;
  assert.equal(inactiveUserWrite.status, 401);

  const crossSchoolTeacherWrite = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    schoolId: 12,
    body: baseSubmission,
  });
  assert.equal(crossSchoolTeacherWrite.status, 401);
  assert.equal(scoreWrites.length, 0);

  const savedAnotherClassAndSubject = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    body: { ...baseSubmission, class: "6", subject: "Science" },
  });
  assert.equal(savedAnotherClassAndSubject.status, 200, JSON.stringify(savedAnotherClassAndSubject.body));
  assert.equal(scoreWrites.length, 1);
  assert.deepEqual(
    [scoreWrites[0][0].schoolId, scoreWrites[0][0].sessionId, scoreWrites[0][0].class, scoreWrites[0][0].subject],
    [11, 42, "6", "Science"],
  );
  assert.equal(scoreWrites[0][0].teacherId, 7);
  assert.equal(scoreWrites[0][0].updatedBy, "Teacher One");
  assert.equal(scoreWrites[0][0].published, true);
  assert.deepEqual(scoreWriteOptions[0], { enforceTeacherWebRules: true });

  schoolMappings = [{ className: "5", section: "A", subject: "Mathematics" }];
  const savedUnassignedSubject = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    body: { ...baseSubmission, subject: "Science" },
  });
  assert.equal(savedUnassignedSubject.status, 200);
  assert.equal(scoreWrites.length, 2);
  assert.deepEqual(
    [scoreWrites[1][0].class, scoreWrites[1][0].subject, scoreWrites[1][0].teacherId, scoreWrites[1][0].updatedBy],
    ["5", "Science", 7, "Teacher One"],
  );
  assert.equal(facultyMappingReads, 0, "Web Add Marks must not read or require Faculty Mappings");

  const teacherCanViewUnassignedMarks = await request("/api/exam-scores/11/Science/Term%202/6/A", {
    sessionId: 42,
  });
  assert.equal(teacherCanViewUnassignedMarks.status, 200);
  assert.deepEqual(adminReads.at(-1), [11, "Science", "Term 2", "6", "A", 42]);

  const teacherCanReadUnassignedResults = await request("/api/teacher/class-scores/6/A", {
    sessionId: 42,
  });
  assert.equal(teacherCanReadUnassignedResults.status, 200);

  const unassignedLedgerSave = await request("/api/teacher/promotion-decisions", {
    method: "POST",
    sessionId: 42,
    body: {
      class: "6",
      section: "A",
      term: "Term 2",
      lock: true,
      entries: [{
        studentId: 7,
        decision: "promoted",
        targetClass: "7",
        targetSection: "A",
        editCount: 0,
        autoSuggestion: "promoted",
      }],
    },
  });
  assert.equal(unassignedLedgerSave.status, 403);

  lockedLedgerBlock = true;
  const lockedMarks = await request("/api/exam-scores", {
    method: "POST",
    sessionId: 42,
    body: baseSubmission,
  });
  lockedLedgerBlock = false;
  assert.equal(lockedMarks.status, 409);
  assert.match(lockedMarks.body.message, /locked pending an authorized correction workflow/i);
  assert.equal(scoreWrites.length, 2);

  const adminMissingSession = await request(
    "/api/admin/analytics/view-marks/5/A/Mathematics/Term%202",
    { role: "admin" },
  );
  assert.equal(adminMissingSession.status, 400);

  const adminArchivedView = await request(
    "/api/admin/analytics/view-marks/5/A/Mathematics/Term%202",
    { role: "admin", sessionId: 41 },
  );
  assert.equal(adminArchivedView.status, 200);
  assert.deepEqual(adminReads.at(-1), [11, "Mathematics", "Term 2", "5", "A", 41]);

  const adminSections = await request("/api/admin/analytics/sections?class=5", {
    role: "admin",
    sessionId: 41,
  });
  assert.equal(adminSections.status, 200);
  assert.deepEqual(scopedOptionReads.at(-1), ["sections", 11, 41, "5"]);

  const adminExamTypes = await request("/api/admin/analytics/exam-types?class=5&section=A", {
    role: "admin",
    sessionId: 41,
  });
  assert.equal(adminExamTypes.status, 200);
  assert.deepEqual(scopedOptionReads.at(-1), ["exam-types", 11, 41, "5", "A"]);

  const adminStudentScores = await request(
    "/api/admin/analytics/student-scores/7?class=5&section=A",
    { role: "admin", sessionId: 41 },
  );
  assert.equal(adminStudentScores.status, 200);
  assert.deepEqual(adminReads.at(-1), [7, 11, 41, "5", "A"]);

  const adminClassAverage = await request(
    "/api/admin/analytics/class-average/5/A/Mathematics",
    { role: "admin", sessionId: 41 },
  );
  assert.equal(adminClassAverage.status, 200);
  assert.deepEqual(adminReads.at(-1), [11, "5", "A", "Mathematics", 41]);

  const publishArchived = await request("/api/exam-scores/publish", {
    method: "POST",
    role: "admin",
    sessionId: 41,
    body: { class: "5", section: "A", examType: "Term 2", schoolId: 11 },
  });
  assert.equal(publishArchived.status, 403);

  const publishActive = await request("/api/exam-scores/publish", {
    method: "POST",
    role: "admin",
    sessionId: 42,
    body: { class: "5", section: "A", examType: "Term 2", schoolId: 11 },
  });
  assert.equal(publishActive.status, 200);
  assert.deepEqual(adminReads.at(-1), ["publish", 11, "5", "A", "Term 2", 42]);
});
