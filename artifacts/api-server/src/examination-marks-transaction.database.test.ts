import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import test from "node:test";

const disposableUrl = process.env.BENIUS_EXAM_TEST_DATABASE_URL;

function isLoopbackExamTestDatabase(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:"
      ? ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
        && decodeURIComponent(url.pathname).replace(/^\//, "") === "benius_exam_stage1_test"
      : false;
  } catch {
    return false;
  }
}

test("Stage 1 locked-ledger writes use only the isolated disposable PostgreSQL test database", {
  skip: isLoopbackExamTestDatabase(disposableUrl)
    ? false
    : "Set BENIUS_EXAM_TEST_DATABASE_URL to the isolated loopback benius_exam_stage1_test database",
}, async t => {
  assert.ok(disposableUrl);
  assert.ok(
    process.env.DATABASE_URL === disposableUrl,
    "DATABASE_URL must exactly match the explicitly selected isolated test database",
  );
  assert.equal(
    ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"]
      .some(key => process.env[key] !== undefined),
    false,
    "PostgreSQL fallback environment variables must be absent during this test",
  );

  const parsedUrl = new URL(disposableUrl);
  assert.equal(parsedUrl.hostname, "127.0.0.1");

  const [
    { db, pool },
    { storage },
    schema,
    { and, eq, inArray },
    { registerTeacherRoutes },
  ] = await Promise.all([
    import("./db"),
    import("./storage"),
    import("@workspace/db"),
    import("drizzle-orm"),
    import("./teacher-routes"),
  ] as const);
  const {
    academicSessions,
    enrollments,
    examPolicyTiers,
    examScores,
    facultyMappings,
    promotionDecisions,
    schoolMetadata,
    schools,
    students,
    teachers,
    users,
  } = schema;

  const connectionIdentity = await pool.query<{
    database_name: string;
    server_address: string;
    server_port: number;
    data_directory: string;
  }>(`
    SELECT current_database() AS database_name,
           host(inet_server_addr()) AS server_address,
           inet_server_port() AS server_port,
           current_setting('data_directory') AS data_directory
  `);
  assert.deepEqual(connectionIdentity.rows[0], {
    database_name: "benius_exam_stage1_test",
    server_address: "127.0.0.1",
    server_port: 55432,
    data_directory: "/tmp/benius-exam-stage1-pgdata",
  });

  type Fixture = {
    schoolAId: number;
    schoolBId: number;
    sessionAId: number;
    archivedSessionAId: number;
    sessionBId: number;
    teacherAId: number;
    userAId: number;
    teacherBId: number;
    userBId: number;
    studentAId: number;
    studentBId: number;
    studentSectionBId: number;
    studentClass6AId: number;
    studentClass6BId: number;
    foreignStudentId: number;
    initialLockedScoreId: number;
    initialClass6ScoreId: number;
    lockedDecisionId: number;
    unlockedDecisionId: number;
    archivedLockedDecisionId: number;
  };

  let fixture: Fixture | undefined;
  let server: Server | undefined;
  let rollbackConstraint: string | undefined;
  const storageHadOwnPassPolicy = Object.prototype.hasOwnProperty.call(storage, "resolveClassPassPolicy");
  const originalPassPolicy = (storage as any).resolveClassPassPolicy;
  (storage as any).resolveClassPassPolicy = async () => ({ passPercentage: 35 });

  t.after(async () => {
    try {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server!.close(error => error ? reject(error) : resolve());
        });
      }
      if (rollbackConstraint) {
        await pool.query(`ALTER TABLE exam_scores DROP CONSTRAINT IF EXISTS ${rollbackConstraint}`);
      }
      if (fixture) {
        await db.delete(schools).where(inArray(schools.id, [
          fixture.schoolAId,
          fixture.schoolBId,
        ]));
      }
    } finally {
      if (storageHadOwnPassPolicy) {
        (storage as any).resolveClassPassPolicy = originalPassPolicy;
      } else {
        delete (storage as any).resolveClassPassPolicy;
      }
      await pool.end();
    }
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  fixture = await db.transaction(async tx => {
    const createdSchools = await tx.insert(schools).values([
      { name: `Exam Stage 1 Fixture A ${suffix}`, code: `E1A${suffix}` },
      { name: `Exam Stage 1 Fixture B ${suffix}`, code: `E1B${suffix}` },
    ]).returning({ id: schools.id });
    const [schoolA, schoolB] = createdSchools;

    const createdSessions = await tx.insert(academicSessions).values([
      {
        schoolId: schoolA.id,
        sessionName: `Archive ${suffix}`,
        startDate: "2024-04-01",
        endDate: "2025-03-31",
        isActive: false,
        status: "archived",
      },
      {
        schoolId: schoolA.id,
        sessionName: `Active A ${suffix}`,
        startDate: "2025-04-01",
        endDate: "2026-03-31",
        isActive: true,
        status: "active",
      },
      {
        schoolId: schoolB.id,
        sessionName: `Active B ${suffix}`,
        startDate: "2025-04-01",
        endDate: "2026-03-31",
        isActive: true,
        status: "active",
      },
    ]).returning({ id: academicSessions.id, schoolId: academicSessions.schoolId });
    const archivedSessionA = createdSessions.find(row => row.schoolId === schoolA.id && row.id === createdSessions[0].id)!;
    const sessionA = createdSessions.find(row => row.schoolId === schoolA.id && row.id !== archivedSessionA.id)!;
    const sessionB = createdSessions.find(row => row.schoolId === schoolB.id)!;

    const createdUsers = await tx.insert(users).values([
      {
        email: `exam-stage1-a-${suffix}@test.invalid`,
        passwordHash: "test-only-hash",
        role: "teacher",
        schoolId: schoolA.id,
        isActive: true,
      },
      {
        email: `exam-stage1-b-${suffix}@test.invalid`,
        passwordHash: "test-only-hash",
        role: "teacher",
        schoolId: schoolB.id,
        isActive: true,
      },
    ]).returning({ id: users.id, schoolId: users.schoolId });
    const userA = createdUsers.find(row => row.schoolId === schoolA.id)!;
    const userB = createdUsers.find(row => row.schoolId === schoolB.id)!;

    const createdTeachers = await tx.insert(teachers).values([
      {
        userId: userA.id,
        schoolId: schoolA.id,
        fullName: `Stage 1 Teacher A ${suffix}`,
        phone: `71${suffix.slice(0, 8)}`,
        subject: "Mathematics",
        assignedClass: "5",
        assignedSection: "A",
        mustChangePassword: false,
        isActive: true,
      },
      {
        userId: userB.id,
        schoolId: schoolB.id,
        fullName: `Stage 1 Teacher B ${suffix}`,
        phone: `72${suffix.slice(0, 8)}`,
        subject: "Mathematics",
        assignedClass: "5",
        assignedSection: "A",
        mustChangePassword: false,
        isActive: true,
      },
    ]).returning({ id: teachers.id, schoolId: teachers.schoolId });
    const teacherA = createdTeachers.find(row => row.schoolId === schoolA.id)!;
    const teacherB = createdTeachers.find(row => row.schoolId === schoolB.id)!;

    await tx.insert(facultyMappings).values([
      { teacherId: teacherA.id, schoolId: schoolA.id, className: "5", section: "A", subject: "Mathematics" },
      { teacherId: teacherA.id, schoolId: schoolA.id, className: "5", section: "B", subject: "Mathematics" },
      { teacherId: teacherA.id, schoolId: schoolA.id, className: "6", section: "A", subject: "Mathematics" },
      { teacherId: teacherB.id, schoolId: schoolB.id, className: "5", section: "A", subject: "Mathematics" },
    ]);

    const createdStudents = await tx.insert(students).values([
      { schoolId: schoolA.id, digitalStudentId: `E1-${suffix}-A`, name: "Stage1 Student A", class: "5", section: "A", phone: `610${suffix.slice(0, 7)}`, dob: "2012-01-01", passwordHash: "test-only-hash", isActive: true },
      { schoolId: schoolA.id, digitalStudentId: `E1-${suffix}-B`, name: "Stage1 Student B", class: "5", section: "A", phone: `620${suffix.slice(0, 7)}`, dob: "2012-02-02", passwordHash: "test-only-hash", isActive: true },
      { schoolId: schoolA.id, digitalStudentId: `E1-${suffix}-S`, name: "Stage1 Section B", class: "5", section: "B", phone: `630${suffix.slice(0, 7)}`, dob: "2012-03-03", passwordHash: "test-only-hash", isActive: true },
      { schoolId: schoolA.id, digitalStudentId: `E1-${suffix}-6A`, name: "Stage1 Class 6 A", class: "6", section: "A", phone: `640${suffix.slice(0, 7)}`, dob: "2012-04-04", passwordHash: "test-only-hash", isActive: true },
      { schoolId: schoolA.id, digitalStudentId: `E1-${suffix}-6B`, name: "Stage1 Class 6 B", class: "6", section: "A", phone: `650${suffix.slice(0, 7)}`, dob: "2012-05-05", passwordHash: "test-only-hash", isActive: true },
      { schoolId: schoolB.id, digitalStudentId: `E1-${suffix}-F`, name: "Stage1 Foreign Student", class: "5", section: "A", phone: `660${suffix.slice(0, 7)}`, dob: "2012-06-06", passwordHash: "test-only-hash", isActive: true },
    ]).returning({ id: students.id, schoolId: students.schoolId });
    const studentA = createdStudents.find(row => row.schoolId === schoolA.id && row.id === createdStudents[0].id)!;
    const studentB = createdStudents.find(row => row.schoolId === schoolA.id && row.id === createdStudents[1].id)!;
    const studentSectionB = createdStudents.find(row => row.schoolId === schoolA.id && row.id === createdStudents[2].id)!;
    const studentClass6A = createdStudents.find(row => row.schoolId === schoolA.id && row.id === createdStudents[3].id)!;
    const studentClass6B = createdStudents.find(row => row.schoolId === schoolA.id && row.id === createdStudents[4].id)!;
    const foreignStudent = createdStudents.find(row => row.schoolId === schoolB.id)!;

    await tx.insert(enrollments).values([
      { schoolId: schoolA.id, studentId: studentA.id, sessionId: sessionA.id, className: "5", sectionName: "A", rollNo: 1, status: "Active" },
      { schoolId: schoolA.id, studentId: studentB.id, sessionId: sessionA.id, className: "5", sectionName: "A", rollNo: 2, status: "Active" },
      { schoolId: schoolA.id, studentId: studentSectionB.id, sessionId: sessionA.id, className: "5", sectionName: "B", rollNo: 1, status: "Active" },
      { schoolId: schoolA.id, studentId: studentClass6A.id, sessionId: sessionA.id, className: "6", sectionName: "A", rollNo: 1, status: "Active" },
      { schoolId: schoolA.id, studentId: studentClass6B.id, sessionId: sessionA.id, className: "6", sectionName: "A", rollNo: 2, status: "Active" },
      { schoolId: schoolA.id, studentId: studentA.id, sessionId: archivedSessionA.id, className: "5", sectionName: "A", rollNo: 1, status: "Active" },
      { schoolId: schoolB.id, studentId: foreignStudent.id, sessionId: sessionB.id, className: "5", sectionName: "A", rollNo: 1, status: "Active" },
    ]);

    const schoolConfigs = [
      {
        schoolId: schoolA.id,
        values: {
          classes: ["5", "6"],
          sections: ["A", "B"],
          exam_types: ["Term 1 Test", "Term 2 Test", "Final Exam"],
          class_sections: { "5": ["A", "B"], "6": ["A"] },
          class_subjects: { "5": ["Mathematics"], "6": ["Mathematics"] },
          class_exam_types: {
            "5": ["Term 1 Test", "Term 2 Test", "Final Exam"],
            "6": ["Term 1 Test", "Term 2 Test", "Final Exam"],
          },
        },
      },
      {
        schoolId: schoolB.id,
        values: {
          classes: ["5"],
          sections: ["A"],
          exam_types: ["Term 1 Test", "Term 2 Test", "Final Exam"],
          class_sections: { "5": ["A"] },
          class_subjects: { "5": ["Mathematics"] },
          class_exam_types: { "5": ["Term 1 Test", "Term 2 Test", "Final Exam"] },
        },
      },
    ];
    await tx.insert(schoolMetadata).values(schoolConfigs.flatMap(({ schoolId, values }) =>
      Object.entries(values).map(([metaKey, value]) => ({
        schoolId,
        metaKey,
        metaValue: JSON.stringify(value),
      }))
    ));

    const weights = JSON.stringify({
      "Term 1": [{ source_exam: "Term 1 Test", weight: 100 }],
      "Term 2": [{ source_exam: "Term 2 Test", weight: 100 }],
      "Final Term": [{ source_exam: "Final Exam", weight: 100 }],
    });
    await tx.insert(examPolicyTiers).values([
      {
        schoolId: schoolA.id,
        tierName: "Stage 1 test policy A",
        applicableClasses: ["5", "6"],
        examWeights: weights,
        promotionFailRules: "{}",
        resultsConfig: "{}",
      },
      {
        schoolId: schoolB.id,
        tierName: "Stage 1 test policy B",
        applicableClasses: ["5"],
        examWeights: weights,
        promotionFailRules: "{}",
        resultsConfig: "{}",
      },
    ]);

    const decisions = await tx.insert(promotionDecisions).values([
      {
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        class: "5",
        section: "A",
        term: "Term 1",
        studentId: studentA.id,
        decision: "promoted",
        targetClass: "6",
        targetSection: "A",
        processedByTeacherId: teacherA.id,
        locked: true,
        lockedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        class: "5",
        section: "A",
        term: "Term 2",
        studentId: studentB.id,
        decision: "promoted",
        targetClass: "6",
        targetSection: "A",
        processedByTeacherId: teacherA.id,
        locked: false,
      },
      {
        schoolId: schoolA.id,
        sessionId: archivedSessionA.id,
        class: "5",
        section: "A",
        term: "Term 2",
        studentId: studentA.id,
        decision: "promoted",
        targetClass: "6",
        targetSection: "A",
        processedByTeacherId: teacherA.id,
        locked: true,
        lockedAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ]).returning({ id: promotionDecisions.id, sessionId: promotionDecisions.sessionId, term: promotionDecisions.term });

    const scores = await tx.insert(examScores).values([
      {
        studentId: studentA.id,
        teacherId: teacherA.id,
        schoolId: schoolA.id,
        subject: "Mathematics",
        examType: "Term 1 Test",
        marks: 41,
        totalMarks: 100,
        passMarks: 35,
        isAbsent: false,
        class: "5",
        section: "A",
        published: false,
        sessionId: sessionA.id,
        updatedBy: "fixture",
      },
      {
        studentId: studentClass6A.id,
        teacherId: teacherA.id,
        schoolId: schoolA.id,
        subject: "Mathematics",
        examType: "Term 2 Test",
        marks: 27,
        totalMarks: 100,
        passMarks: 35,
        isAbsent: false,
        class: "6",
        section: "A",
        published: false,
        sessionId: sessionA.id,
        updatedBy: "fixture",
      },
      {
        studentId: studentA.id,
        teacherId: teacherA.id,
        schoolId: schoolA.id,
        subject: "Mathematics",
        examType: "Term 2 Test",
        marks: 61,
        totalMarks: 100,
        passMarks: 35,
        isAbsent: false,
        class: "5",
        section: "A",
        published: false,
        sessionId: archivedSessionA.id,
        updatedBy: "fixture",
      },
    ]).returning({ id: examScores.id, studentId: examScores.studentId, sessionId: examScores.sessionId });

    return {
      schoolAId: schoolA.id,
      schoolBId: schoolB.id,
      sessionAId: sessionA.id,
      archivedSessionAId: archivedSessionA.id,
      sessionBId: sessionB.id,
      teacherAId: teacherA.id,
      userAId: userA.id,
      teacherBId: teacherB.id,
      userBId: userB.id,
      studentAId: studentA.id,
      studentBId: studentB.id,
      studentSectionBId: studentSectionB.id,
      studentClass6AId: studentClass6A.id,
      studentClass6BId: studentClass6B.id,
      foreignStudentId: foreignStudent.id,
      initialLockedScoreId: scores.find(row => row.studentId === studentA.id && row.sessionId === sessionA.id)!.id,
      initialClass6ScoreId: scores.find(row => row.studentId === studentClass6A.id)!.id,
      lockedDecisionId: decisions.find(row => row.sessionId === sessionA.id && row.term === "Term 1")!.id,
      unlockedDecisionId: decisions.find(row => row.sessionId === sessionA.id && row.term === "Term 2")!.id,
      archivedLockedDecisionId: decisions.find(row => row.sessionId === archivedSessionA.id)!.id,
    };
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const schoolId = Number(req.get("x-test-school") ?? fixture!.schoolAId);
    const teacherId = Number(req.get("x-test-teacher") ?? fixture!.teacherAId);
    const userId = Number(req.get("x-test-user") ?? fixture!.userAId);
    (req as any).session = { teacherId, userId, schoolId, userRole: "teacher" };
    next();
  });
  server = createServer(app);
  registerTeacherRoutes(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  async function request(
    options: {
      sessionId: number;
      schoolId?: number;
      teacherId?: number;
      userId?: number;
      body: unknown;
    },
  ) {
    const response = await fetch(`${baseUrl}/api/exam-scores`, {
      method: "POST",
      headers: {
        connection: "close",
        "content-type": "application/json",
        "x-view-session-id": String(options.sessionId),
        ...(options.schoolId === undefined ? {} : { "x-test-school": String(options.schoolId) }),
        ...(options.teacherId === undefined ? {} : { "x-test-teacher": String(options.teacherId) }),
        ...(options.userId === undefined ? {} : { "x-test-user": String(options.userId) }),
      },
      body: JSON.stringify(options.body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  async function getScore(
    studentId: number,
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    examType: string,
  ) {
    const [row] = await db.select().from(examScores).where(and(
      eq(examScores.studentId, studentId),
      eq(examScores.schoolId, schoolId),
      eq(examScores.sessionId, sessionId),
      eq(examScores.class, cls),
      eq(examScores.section, section),
      eq(examScores.subject, "Mathematics"),
      eq(examScores.examType, examType),
    )).limit(1);
    return row;
  }

  const baseSubmission = {
    subject: "Mathematics",
    totalMarks: 100,
    scores: [{ studentId: fixture.studentAId, marks: 78, isAbsent: false }],
  };

  await t.test("an unrelated active-session term commits and immediately publishes only its saved row", async () => {
    const response = await request({
      sessionId: fixture!.sessionAId,
      body: { ...baseSubmission, class: "5", section: "A", examType: "Term 2 Test" },
    });
    assert.equal(response.status, 200);
    const activeScore = await getScore(fixture!.studentAId, fixture!.schoolAId, fixture!.sessionAId, "5", "A", "Term 2 Test");
    assert.equal(activeScore?.marks, 78);
    assert.equal(activeScore?.published, true);
    const historicalScore = await getScore(fixture!.studentAId, fixture!.schoolAId, fixture!.archivedSessionAId, "5", "A", "Term 2 Test");
    assert.equal(historicalScore?.marks, 61);
    assert.equal(historicalScore?.published, false);
  });

  await t.test("a locked-term write returns HTTP 409 and rejects the whole batch without changing marks", async () => {
    const response = await request({
      sessionId: fixture!.sessionAId,
      body: {
        ...baseSubmission,
        class: "5",
        section: "A",
        examType: "Term 1 Test",
        scores: [
          { studentId: fixture!.studentAId, marks: 95, isAbsent: false },
          { studentId: fixture!.studentBId, marks: 88, isAbsent: false },
        ],
      },
    });
    assert.equal(response.status, 409);
    assert.match(response.body.message, /locked pending an authorized correction workflow/i);
    assert.equal((await getScore(fixture!.studentAId, fixture!.schoolAId, fixture!.sessionAId, "5", "A", "Term 1 Test"))?.marks, 41);
    assert.equal(await getScore(fixture!.studentBId, fixture!.schoolAId, fixture!.sessionAId, "5", "A", "Term 1 Test"), undefined);
    assert.equal((await db.select().from(examScores).where(eq(examScores.id, fixture!.initialLockedScoreId)))[0]?.published, false);
  });

  await t.test("other sections and classes remain writable", async () => {
    const sectionResponse = await request({
      sessionId: fixture!.sessionAId,
      body: { ...baseSubmission, class: "5", section: "B", examType: "Term 1 Test", scores: [{ studentId: fixture!.studentSectionBId, marks: 71, isAbsent: false }] },
    });
    assert.equal(sectionResponse.status, 200);

    const classResponse = await request({
      sessionId: fixture!.sessionAId,
      body: { ...baseSubmission, class: "6", section: "A", examType: "Term 1 Test", scores: [{ studentId: fixture!.studentClass6AId, marks: 72, isAbsent: false }] },
    });
    assert.equal(classResponse.status, 200);
  });

  await t.test("school and Academic Session boundaries reject foreign writes but allow the other tenant's own active cohort", async () => {
    const foreignStudentResponse = await request({
      sessionId: fixture!.sessionAId,
      body: { ...baseSubmission, class: "5", section: "A", examType: "Final Exam", scores: [{ studentId: fixture!.foreignStudentId, marks: 70, isAbsent: false }] },
    });
    assert.equal(foreignStudentResponse.status, 403);

    const foreignSessionResponse = await request({
      sessionId: fixture!.sessionAId,
      schoolId: fixture!.schoolBId,
      teacherId: fixture!.teacherBId,
      userId: fixture!.userBId,
      body: { ...baseSubmission, class: "5", section: "A", examType: "Term 1 Test", scores: [{ studentId: fixture!.foreignStudentId, marks: 70, isAbsent: false }] },
    });
    assert.equal(foreignSessionResponse.status, 403);

    const ownTenantResponse = await request({
      sessionId: fixture!.sessionBId,
      schoolId: fixture!.schoolBId,
      teacherId: fixture!.teacherBId,
      userId: fixture!.userBId,
      body: { ...baseSubmission, class: "5", section: "A", examType: "Term 1 Test", scores: [{ studentId: fixture!.foreignStudentId, marks: 74, isAbsent: false }] },
    });
    assert.equal(ownTenantResponse.status, 200);
    assert.equal((await getScore(fixture!.foreignStudentId, fixture!.schoolBId, fixture!.sessionBId, "5", "A", "Term 1 Test"))?.published, true);

    await assert.rejects(
      storage.upsertExamScores([{
        studentId: fixture!.foreignStudentId,
        teacherId: fixture!.teacherAId,
        schoolId: fixture!.schoolAId,
        subject: "Mathematics",
        examType: "Final Exam",
        marks: 70,
        totalMarks: 100,
        passMarks: 35,
        isAbsent: false,
        class: "5",
        section: "A",
        sessionId: fixture!.sessionAId,
      }], { enforceTeacherWebRules: true }),
      (error: any) => error?.statusCode === 403 && error?.code === "STUDENT_ENROLLMENT_REQUIRED",
    );
  });

  await t.test("archived-session requests are rejected and do not change historical records", async () => {
    const response = await request({
      sessionId: fixture!.archivedSessionAId,
      body: { ...baseSubmission, class: "5", section: "A", examType: "Term 2 Test" },
    });
    assert.equal(response.status, 403);
    assert.equal((await getScore(fixture!.studentAId, fixture!.schoolAId, fixture!.archivedSessionAId, "5", "A", "Term 2 Test"))?.marks, 61);
  });

  await t.test("invalid score batches reject before any row can change", async () => {
    const response = await request({
      sessionId: fixture!.sessionAId,
      body: {
        ...baseSubmission,
        class: "6",
        section: "A",
        examType: "Term 2 Test",
        scores: [
          { studentId: fixture!.studentClass6AId, marks: 90, isAbsent: false },
          { studentId: fixture!.studentClass6BId, marks: 101, isAbsent: false },
        ],
      },
    });
    assert.equal(response.status, 400);
    assert.equal((await db.select().from(examScores).where(eq(examScores.id, fixture!.initialClass6ScoreId)))[0]?.marks, 27);
    assert.equal(await getScore(fixture!.studentClass6BId, fixture!.schoolAId, fixture!.sessionAId, "6", "A", "Term 2 Test"), undefined);
  });

  await t.test("a database failure after the first row rolls back both marks and publication", async () => {
    rollbackConstraint = `exam_scores_stage1_reject_${suffix}`;
    assert.ok(Number.isSafeInteger(fixture!.studentClass6BId) && fixture!.studentClass6BId > 0);
    await pool.query(
      `ALTER TABLE exam_scores ADD CONSTRAINT ${rollbackConstraint} CHECK (student_id <> ${fixture!.studentClass6BId})`,
    );
    try {
      await assert.rejects(storage.upsertExamScores([
        {
          studentId: fixture!.studentClass6AId,
          teacherId: fixture!.teacherAId,
          schoolId: fixture!.schoolAId,
          subject: "Mathematics",
          examType: "Term 2 Test",
          marks: 91,
          totalMarks: 100,
          passMarks: 35,
          isAbsent: false,
          class: "6",
          section: "A",
          sessionId: fixture!.sessionAId,
          published: true,
        },
        {
          studentId: fixture!.studentClass6BId,
          teacherId: fixture!.teacherAId,
          schoolId: fixture!.schoolAId,
          subject: "Mathematics",
          examType: "Term 2 Test",
          marks: 81,
          totalMarks: 100,
          passMarks: 35,
          isAbsent: false,
          class: "6",
          section: "A",
          sessionId: fixture!.sessionAId,
          published: true,
        },
      ], { enforceTeacherWebRules: true }));
    } finally {
      await pool.query(`ALTER TABLE exam_scores DROP CONSTRAINT IF EXISTS ${rollbackConstraint}`);
      rollbackConstraint = undefined;
    }
    const unchanged = await db.select().from(examScores).where(eq(examScores.id, fixture!.initialClass6ScoreId));
    assert.equal(unchanged[0]?.marks, 27);
    assert.equal(unchanged[0]?.published, false);
    assert.equal(await getScore(fixture!.studentClass6BId, fixture!.schoolAId, fixture!.sessionAId, "6", "A", "Term 2 Test"), undefined);
  });

  await t.test("ambiguous policy configuration fails closed without altering locked marks", async () => {
    const [ambiguousPolicy] = await db.insert(examPolicyTiers).values({
      schoolId: fixture!.schoolAId,
      tierName: `Ambiguous Stage 1 policy ${suffix}`,
      applicableClasses: ["5"],
      examWeights: JSON.stringify({ "Term 1": [{ source_exam: "Term 1 Test", weight: 100 }] }),
      promotionFailRules: "{}",
      resultsConfig: "{}",
    }).returning({ id: examPolicyTiers.id });
    try {
      const response = await request({
        sessionId: fixture!.sessionAId,
        body: { ...baseSubmission, class: "5", section: "A", examType: "Term 1 Test" },
      });
      assert.equal(response.status, 409);
      assert.match(response.body.message, /unambiguous examination policy/i);
      assert.equal((await db.select().from(examScores).where(eq(examScores.id, fixture!.initialLockedScoreId)))[0]?.marks, 41);
    } finally {
      await db.delete(examPolicyTiers).where(eq(examPolicyTiers.id, ambiguousPolicy.id));
    }
  });

  await t.test("simultaneous writes wait on the cohort lock and all fail against the locked decision", async () => {
    const identity = JSON.stringify([
      fixture!.schoolAId,
      fixture!.sessionAId,
      "5",
      "A",
    ]);
    const blocker = await pool.connect();
    let blockerOpen = true;
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [identity],
    );
    const concurrentWrites = Array.from({ length: 5 }, (_, index) =>
      storage.upsertExamScores([{
        studentId: fixture!.studentAId,
        teacherId: fixture!.teacherAId,
        schoolId: fixture!.schoolAId,
        subject: "Mathematics",
        examType: "Term 1 Test",
        marks: 50 + index,
        totalMarks: 100,
        passMarks: 35,
        isAbsent: false,
        class: "5",
        section: "A",
        sessionId: fixture!.sessionAId,
      }], { enforceTeacherWebRules: true }),
    );

    try {
      let waitingWriters = 0;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const result = await pool.query<{ waiting: number }>(`
          SELECT count(*)::int AS waiting
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND wait_event = 'advisory'
        `);
        waitingWriters = result.rows[0]?.waiting ?? 0;
        if (waitingWriters >= concurrentWrites.length) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(waitingWriters, concurrentWrites.length, "all write transactions must be observed waiting on the real PostgreSQL cohort advisory lock");
      await blocker.query("COMMIT");
      blockerOpen = false;
    } finally {
      if (blockerOpen) await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }

    const outcomes = await Promise.allSettled(concurrentWrites);
    assert.equal(outcomes.length, 5);
    for (const outcome of outcomes) {
      assert.equal(outcome.status, "rejected");
      if (outcome.status === "rejected") {
        assert.equal((outcome.reason as any)?.statusCode, 409);
        assert.equal((outcome.reason as any)?.code, "PROMOTION_DECISION_LOCKED");
      }
    }
    assert.equal((await db.select().from(examScores).where(eq(examScores.id, fixture!.initialLockedScoreId)))[0]?.marks, 41);
  });

  await t.test("locked, unlocked, and archived decisions remain unchanged", async () => {
    const decisions = await db.select().from(promotionDecisions).where(inArray(promotionDecisions.id, [
      fixture!.lockedDecisionId,
      fixture!.unlockedDecisionId,
      fixture!.archivedLockedDecisionId,
    ]));
    assert.equal(decisions.length, 3);
    assert.equal(decisions.find(row => row.id === fixture!.lockedDecisionId)?.locked, true);
    assert.equal(decisions.find(row => row.id === fixture!.unlockedDecisionId)?.locked, false);
    assert.equal(decisions.find(row => row.id === fixture!.archivedLockedDecisionId)?.locked, true);
  });
});
