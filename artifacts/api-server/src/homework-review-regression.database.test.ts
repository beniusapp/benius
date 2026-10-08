import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import test from "node:test";

const disposableUrl = process.env.BENIUS_HOMEWORK_TEST_DATABASE_URL;
function isLoopbackTestDatabase(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
      && decodeURIComponent(url.pathname).replace(/^\//, "").endsWith("_test");
  } catch {
    return false;
  }
}

type Fixture = {
  schoolId: number;
  foreignSchoolId: number;
  activeSessionId: number;
  archiveSessionId: number;
  foreignSessionId: number;
  teacherId: number;
  teacherUserId: number;
  unassignedTeacherId: number;
  unassignedTeacherUserId: number;
  foreignTeacherId: number;
  foreignTeacherUserId: number;
  studentAId: number;
  studentBId: number;
  inactiveProfileStudentId: number;
  inactiveEnrollmentStudentId: number;
  activeHomeworkId: number;
  secondHomeworkId: number;
  attachmentHomeworkId: number;
  archiveHomeworkId: number;
  foreignHomeworkId: number;
  email: string;
  teacherName: string;
};

test("Homework review and view tracking regression checks use only a disposable local database", {
  skip: isLoopbackTestDatabase(disposableUrl)
    ? false
    : "Set BENIUS_HOMEWORK_TEST_DATABASE_URL to a loopback database ending in _test",
}, async (t) => {
  assert.equal(
    process.env.DATABASE_URL,
    disposableUrl,
    "DATABASE_URL must point to the same explicitly selected disposable test database",
  );

  const [{ db, pool }, { storage }, schema, { inArray }, { registerRoutes }] =
    await Promise.all([
      import("./db"),
      import("./storage"),
      import("@workspace/db"),
      import("drizzle-orm"),
      import("./routes/routes"),
    ] as const);
  const {
    academicSessions,
    enrollments,
    facultyMappings,
    homework,
    homeworkSubmissions,
    homeworkViews,
    schools,
    students,
    teachers,
    users,
  } = schema;

  const databaseName = await pool.query<{ current_database: string }>(
    "SELECT current_database() AS current_database",
  );
  assert.equal(databaseName.rows[0]?.current_database, "benius_hw_review_test");

  let fixture: Fixture | undefined;
  let server: Server | undefined;
  t.after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      });
    }
    if (fixture) {
      await db.transaction(async (tx) => {
        const homeworkIds = [
          fixture!.activeHomeworkId,
          fixture!.secondHomeworkId,
          fixture!.attachmentHomeworkId,
          fixture!.archiveHomeworkId,
          fixture!.foreignHomeworkId,
        ];
        await tx.delete(homeworkViews).where(inArray(homeworkViews.homeworkId, homeworkIds));
        await tx.delete(homeworkSubmissions).where(inArray(homeworkSubmissions.homeworkId, homeworkIds));
        await tx.delete(homework).where(inArray(homework.id, homeworkIds));
        await tx.delete(enrollments).where(inArray(enrollments.schoolId, [
          fixture!.schoolId,
          fixture!.foreignSchoolId,
        ]));
        await tx.delete(facultyMappings).where(inArray(facultyMappings.schoolId, [
          fixture!.schoolId,
          fixture!.foreignSchoolId,
        ]));
        await tx.delete(students).where(inArray(students.schoolId, [
          fixture!.schoolId,
          fixture!.foreignSchoolId,
        ]));
        await tx.delete(teachers).where(inArray(teachers.schoolId, [
          fixture!.schoolId,
          fixture!.foreignSchoolId,
        ]));
        await tx.delete(users).where(inArray(users.schoolId, [
          fixture!.schoolId,
          fixture!.foreignSchoolId,
        ]));
        await tx.delete(academicSessions).where(inArray(academicSessions.schoolId, [
          fixture!.schoolId,
          fixture!.foreignSchoolId,
        ]));
        await tx.delete(schools).where(inArray(schools.id, [
          fixture!.schoolId,
          fixture!.foreignSchoolId,
        ]));
      });
    }
    await pool.end();
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  fixture = await db.transaction(async (tx): Promise<Fixture> => {
    const [school] = await tx.insert(schools).values({
      name: `Homework Review Fixture ${suffix}`,
      code: `HWR${suffix}`,
    }).returning({ id: schools.id });
    const [foreignSchool] = await tx.insert(schools).values({
      name: `Homework Review Foreign ${suffix}`,
      code: `HWF${suffix}`,
    }).returning({ id: schools.id });

    const [activeSession] = await tx.insert(academicSessions).values({
      schoolId: school.id,
      sessionName: `Active ${suffix}`,
      startDate: "2026-04-01",
      endDate: "2027-03-31",
      isActive: true,
      status: "active",
    }).returning({ id: academicSessions.id });
    const [archiveSession] = await tx.insert(academicSessions).values({
      schoolId: school.id,
      sessionName: `Archive ${suffix}`,
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: false,
      status: "archived",
    }).returning({ id: academicSessions.id });
    const [foreignSession] = await tx.insert(academicSessions).values({
      schoolId: foreignSchool.id,
      sessionName: `Foreign Active ${suffix}`,
      startDate: "2026-04-01",
      endDate: "2027-03-31",
      isActive: true,
      status: "active",
    }).returning({ id: academicSessions.id });

    const [teacherUser] = await tx.insert(users).values({
      email: `teacher-${suffix}@test.invalid`,
      passwordHash: "fixture-hash",
      role: "teacher",
      schoolId: school.id,
    }).returning({ id: users.id });
    const [unassignedTeacherUser] = await tx.insert(users).values({
      email: `unassigned-${suffix}@test.invalid`,
      passwordHash: "fixture-hash",
      role: "teacher",
      schoolId: school.id,
    }).returning({ id: users.id });
    const [foreignTeacherUser] = await tx.insert(users).values({
      email: `foreign-${suffix}@test.invalid`,
      passwordHash: "fixture-hash",
      role: "teacher",
      schoolId: foreignSchool.id,
    }).returning({ id: users.id });

    const [teacher] = await tx.insert(teachers).values({
      userId: teacherUser.id,
      schoolId: school.id,
      fullName: `Assigned Teacher ${suffix}`,
      phone: `9${suffix.slice(0, 9)}`,
      subject: "Mathematics",
      assignedClass: "",
      assignedSection: "",
      mustChangePassword: false,
    }).returning({ id: teachers.id, fullName: teachers.fullName });
    const [unassignedTeacher] = await tx.insert(teachers).values({
      userId: unassignedTeacherUser.id,
      schoolId: school.id,
      fullName: `Unassigned Teacher ${suffix}`,
      phone: `8${suffix.slice(0, 9)}`,
      subject: "Mathematics",
      assignedClass: "",
      assignedSection: "",
      mustChangePassword: false,
    }).returning({ id: teachers.id });
    const [foreignTeacher] = await tx.insert(teachers).values({
      userId: foreignTeacherUser.id,
      schoolId: foreignSchool.id,
      fullName: `Foreign Teacher ${suffix}`,
      phone: `7${suffix.slice(0, 9)}`,
      subject: "Mathematics",
      assignedClass: "",
      assignedSection: "",
      mustChangePassword: false,
    }).returning({ id: teachers.id });
    await tx.insert(facultyMappings).values([
      { teacherId: teacher.id, schoolId: school.id, className: "5", section: "A", subject: "Mathematics" },
      { teacherId: teacher.id, schoolId: school.id, className: "4", section: "A", subject: "Mathematics" },
      { teacherId: foreignTeacher.id, schoolId: foreignSchool.id, className: "5", section: "A", subject: "Mathematics" },
    ]);

    const studentRows = await tx.insert(students).values([
      {
        schoolId: school.id,
        digitalStudentId: `HWR-${suffix}-A`,
        name: `Student A ${suffix}`,
        class: "5",
        section: "A",
        phone: `610${suffix.slice(0, 7)}`,
        dob: "2012-01-01",
        passwordHash: "fixture-hash",
        isActivated: true,
        isActive: true,
      },
      {
        schoolId: school.id,
        digitalStudentId: `HWR-${suffix}-B`,
        name: `Student B ${suffix}`,
        class: "5",
        section: "A",
        phone: `620${suffix.slice(0, 7)}`,
        dob: "2012-02-02",
        passwordHash: "fixture-hash",
        isActivated: true,
        isActive: true,
      },
      {
        schoolId: school.id,
        digitalStudentId: `HWR-${suffix}-I`,
        name: `Inactive Profile ${suffix}`,
        class: "5",
        section: "A",
        phone: `630${suffix.slice(0, 7)}`,
        dob: "2012-03-03",
        passwordHash: "fixture-hash",
        isActivated: true,
        isActive: false,
      },
      {
        schoolId: school.id,
        digitalStudentId: `HWR-${suffix}-E`,
        name: `Inactive Enrollment ${suffix}`,
        class: "5",
        section: "A",
        phone: `640${suffix.slice(0, 7)}`,
        dob: "2012-04-04",
        passwordHash: "fixture-hash",
        isActivated: true,
        isActive: true,
      },
      {
        schoolId: foreignSchool.id,
        digitalStudentId: `HWF-${suffix}-A`,
        name: `Foreign Student ${suffix}`,
        class: "5",
        section: "A",
        phone: `650${suffix.slice(0, 7)}`,
        dob: "2012-05-05",
        passwordHash: "fixture-hash",
        isActivated: true,
        isActive: true,
      },
    ]).returning({ id: students.id });
    const [studentA, studentB, inactiveProfile, inactiveEnrollment, foreignStudent] = studentRows;

    await tx.insert(enrollments).values([
      { schoolId: school.id, studentId: studentA.id, sessionId: activeSession.id, className: "5", sectionName: "A", rollNo: 1, status: "Active" },
      { schoolId: school.id, studentId: studentB.id, sessionId: activeSession.id, className: "5", sectionName: "A", rollNo: 2, status: "Active" },
      { schoolId: school.id, studentId: inactiveProfile.id, sessionId: activeSession.id, className: "5", sectionName: "A", rollNo: 3, status: "Active" },
      { schoolId: school.id, studentId: inactiveEnrollment.id, sessionId: activeSession.id, className: "5", sectionName: "A", rollNo: 4, status: "Inactive" },
      { schoolId: school.id, studentId: studentA.id, sessionId: archiveSession.id, className: "4", sectionName: "A", rollNo: 11, status: "Active" },
      { schoolId: school.id, studentId: studentB.id, sessionId: archiveSession.id, className: "4", sectionName: "A", rollNo: 12, status: "Transferred" },
      { schoolId: school.id, studentId: inactiveProfile.id, sessionId: archiveSession.id, className: "4", sectionName: "A", rollNo: 13, status: "Inactive" },
      { schoolId: school.id, studentId: inactiveEnrollment.id, sessionId: archiveSession.id, className: "4", sectionName: "A", rollNo: 14, status: "Inactive" },
      { schoolId: foreignSchool.id, studentId: foreignStudent.id, sessionId: foreignSession.id, className: "5", sectionName: "A", rollNo: 1, status: "Active" },
    ]);

    const homeworkRows = await tx.insert(homework).values([
      { teacherId: teacher.id, schoolId: school.id, class: "5", section: "A", subject: "Math", content: "Approval lifecycle", dueDate: "2030-01-01", sessionId: activeSession.id },
      { teacherId: teacher.id, schoolId: school.id, class: "5", section: "A", subject: "Math", content: "Resubmission lifecycle", dueDate: "2030-01-01", sessionId: activeSession.id },
      { teacherId: teacher.id, schoolId: school.id, class: "5", section: "A", subject: "Math", content: "Attachment restriction", dueDate: "2030-01-01", sessionId: activeSession.id },
      { teacherId: teacher.id, schoolId: school.id, class: "4", section: "A", subject: "Math", content: "Archived Homework content", dueDate: "2026-03-01", sessionId: archiveSession.id },
      { teacherId: foreignTeacher.id, schoolId: foreignSchool.id, class: "5", section: "A", subject: "Math", content: "Foreign Homework", dueDate: "2030-01-01", sessionId: foreignSession.id },
    ]).returning({ id: homework.id });

    return {
      schoolId: school.id,
      foreignSchoolId: foreignSchool.id,
      activeSessionId: activeSession.id,
      archiveSessionId: archiveSession.id,
      foreignSessionId: foreignSession.id,
      teacherId: teacher.id,
      teacherUserId: teacherUser.id,
      unassignedTeacherId: unassignedTeacher.id,
      unassignedTeacherUserId: unassignedTeacherUser.id,
      foreignTeacherId: foreignTeacher.id,
      foreignTeacherUserId: foreignTeacherUser.id,
      studentAId: studentA.id,
      studentBId: studentB.id,
      inactiveProfileStudentId: inactiveProfile.id,
      inactiveEnrollmentStudentId: inactiveEnrollment.id,
      activeHomeworkId: homeworkRows[0].id,
      secondHomeworkId: homeworkRows[1].id,
      attachmentHomeworkId: homeworkRows[2].id,
      archiveHomeworkId: homeworkRows[3].id,
      foreignHomeworkId: homeworkRows[4].id,
      email: `teacher-${suffix}@test.invalid`,
      teacherName: teacher.fullName,
    };
  });

  const principals = new Map<string, Record<string, unknown>>([
    ["student-a", { studentId: fixture.studentAId, schoolId: fixture.schoolId, userRole: "student" }],
    ["student-b", { studentId: fixture.studentBId, schoolId: fixture.schoolId, userRole: "student" }],
    ["teacher-assigned", { teacherId: fixture.teacherId, userId: fixture.teacherUserId, schoolId: fixture.schoolId, userRole: "teacher" }],
    ["teacher-unassigned", { teacherId: fixture.unassignedTeacherId, userId: fixture.unassignedTeacherUserId, schoolId: fixture.schoolId, userRole: "teacher" }],
    ["teacher-foreign", { teacherId: fixture.foreignTeacherId, userId: fixture.foreignTeacherUserId, schoolId: fixture.foreignSchoolId, userRole: "teacher" }],
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session =
      principals.get(req.get("x-test-principal") ?? "") ?? {};
    next();
  });
  server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  async function request(
    path: string,
    options: {
      principal: string;
      sessionId?: number;
      method?: string;
      json?: unknown;
      form?: FormData;
    },
  ) {
    const headers = new Headers({ "x-test-principal": options.principal });
    if (options.sessionId !== undefined) {
      headers.set("x-view-session-id", String(options.sessionId));
    }
    if (options.json !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.json === undefined
        ? options.form
        : JSON.stringify(options.json),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    return { status: response.status, body };
  }

  const activeListPath = "/api/student/homework";

  await t.test("loading the Student Homework list does not record a view", async () => {
    const before = await storage.getHomeworkViewCount(fixture!.activeHomeworkId);
    const list = await request(activeListPath, {
      principal: "student-a",
      sessionId: fixture!.activeSessionId,
    });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));
    assert.equal(await storage.getHomeworkViewCount(fixture!.activeHomeworkId), before);
  });

  await t.test("Student view tracking is idempotent under concurrent opens", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () =>
      request(`/api/student/homework/${fixture!.activeHomeworkId}/view`, {
        principal: "student-a",
        sessionId: fixture!.activeSessionId,
        method: "POST",
      }),
    ));
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(responses.filter((response) => (response.body as { recorded?: boolean }).recorded).length, 1);
    assert.equal(await storage.getHomeworkViewCount(fixture!.activeHomeworkId), 1);
  });

  await t.test("active and historical view denominators use their selected-session rosters", async () => {
    const activeRoster = await storage.getHomeworkRosterInSession(
      fixture!.schoolId, fixture!.activeSessionId, "5", "A", true,
    );
    assert.deepEqual(activeRoster.map((row: { studentId: number }) => row.studentId).sort((a: number, b: number) => a - b), [
      fixture!.studentAId,
      fixture!.studentBId,
    ].sort((a, b) => a - b));
    await storage.recordHomeworkView(fixture!.activeHomeworkId, fixture!.inactiveProfileStudentId);
    await storage.recordHomeworkView(fixture!.activeHomeworkId, fixture!.inactiveEnrollmentStudentId);
    assert.equal(
      await storage.getHomeworkViewCount(
        fixture!.activeHomeworkId,
        activeRoster.map((row: { studentId: number }) => row.studentId),
      ),
      1,
    );

    const archiveRoster = await storage.getHomeworkRosterInSession(
      fixture!.schoolId, fixture!.archiveSessionId, "4", "A", false,
    );
    assert.equal(archiveRoster.length, 4);
    assert.ok(archiveRoster.some((row: { studentId: number }) => row.studentId === fixture!.inactiveProfileStudentId));
    await storage.recordHomeworkView(fixture!.archiveHomeworkId, fixture!.inactiveProfileStudentId);
    assert.equal(
      await storage.getHomeworkViewCount(
        fixture!.archiveHomeworkId,
        archiveRoster.map((row: { studentId: number }) => row.studentId),
      ),
      1,
    );
  });

  await t.test("text submission, approval, feedback, and approved resubmission rejection work through Web routes", async () => {
    const form = new FormData();
    form.set("textAnswer", "First answer for approval");
    const submit = await request(`/api/student/homework/${fixture!.activeHomeworkId}/submit`, {
      principal: "student-a",
      sessionId: fixture!.activeSessionId,
      method: "POST",
      form,
    });
    assert.equal(submit.status, 200, JSON.stringify(submit.body));

    const reviewList = await request(`/api/homework/${fixture!.activeHomeworkId}/submissions`, {
      principal: "teacher-assigned",
      sessionId: fixture!.activeSessionId,
    });
    assert.equal(reviewList.status, 200);
    const studentEntry = (reviewList.body as Array<{ studentId: number; submission: Record<string, unknown> | null }>)
      .find((entry) => entry.studentId === fixture!.studentAId);
    assert.equal(studentEntry?.submission?.textAnswer, "First answer for approval");
    assert.equal(Object.hasOwn(studentEntry?.submission ?? {}, "fileUrl"), false);
    const teacherVisibleSubmittedAt = (studentEntry!.submission as { submittedAt: string }).submittedAt;
    const reviewSubmissionId = (studentEntry!.submission as { id: number }).id;
    const storedSubmission = await storage.getHomeworkSubmission(
      fixture!.activeHomeworkId,
      fixture!.studentAId,
    );
    const exactTimestamp = await pool.query<{ submitted_at_exact: string }>(
      "SELECT to_char(submitted_at, 'YYYY-MM-DD HH24:MI:SS.US') AS submitted_at_exact FROM homework_submissions WHERE id = $1",
      [reviewSubmissionId],
    );
    assert.equal(storedSubmission?.status, "submitted");
    assert.equal(
      new Date(teacherVisibleSubmittedAt).getTime(),
      storedSubmission?.submittedAt.getTime(),
      "The timestamp displayed in the review roster must match the unchanged submission",
    );
    const timestampEvidence = {
      reviewRosterTimestamp: teacherVisibleSubmittedAt,
      databaseTimestamp: exactTimestamp.rows[0]?.submitted_at_exact,
    };

    const review = await request(
      `/api/homework/${fixture!.activeHomeworkId}/submissions/${reviewSubmissionId}/review`,
      {
        principal: "teacher-assigned",
        sessionId: fixture!.activeSessionId,
        method: "PATCH",
        json: {
          action: "approve",
          comment: "Good work",
          expectedSubmittedAt: teacherVisibleSubmittedAt,
          schoolId: fixture!.foreignSchoolId,
          reviewerId: fixture!.foreignTeacherId,
        },
      },
    );
    assert.equal(review.status, 200, JSON.stringify({ response: review.body, timestampEvidence }));
    assert.equal((review.body as { reviewedBy: number }).reviewedBy, fixture!.teacherId);

    const studentView = await request(activeListPath, {
      principal: "student-a",
      sessionId: fixture!.activeSessionId,
    });
    const approved = (studentView.body as Array<{ id: number; submission: { status: string; teacherComment: string | null } | null }>)
      .find((row) => row.id === fixture!.activeHomeworkId);
    assert.equal(approved?.submission?.status, "approved");
    assert.equal(approved?.submission?.teacherComment, "Good work");

    const resubmitForm = new FormData();
    resubmitForm.set("textAnswer", "Changed after approval");
    const resubmit = await request(`/api/student/homework/${fixture!.activeHomeworkId}/submit`, {
      principal: "student-a",
      sessionId: fixture!.activeSessionId,
      method: "POST",
      form: resubmitForm,
    });
    assert.ok(resubmit.status >= 400);
    assert.equal((resubmit.body as { submission?: { textAnswer?: string } }).submission?.textAnswer, undefined);
  });

  await t.test("resubmission clears prior review metadata and can be reviewed without a comment", async () => {
    const form = new FormData();
    form.set("textAnswer", "Answer requesting a resubmission");
    const first = await request(`/api/student/homework/${fixture!.secondHomeworkId}/submit`, {
      principal: "student-a",
      sessionId: fixture!.activeSessionId,
      method: "POST",
      form,
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const firstSubmission = (first.body as { submission: { id: number; submittedAt: string } }).submission;
    const firstReviewList = await request(`/api/homework/${fixture!.secondHomeworkId}/submissions`, {
      principal: "teacher-assigned",
      sessionId: fixture!.activeSessionId,
    });
    assert.equal(firstReviewList.status, 200);
    const firstTeacherEntry = (firstReviewList.body as Array<{ studentId: number; submission: { submittedAt: string } | null }>)
      .find((entry) => entry.studentId === fixture!.studentAId);
    const firstTeacherVisibleSubmittedAt = firstTeacherEntry!.submission!.submittedAt;

    const requestResubmission = await request(
      `/api/homework/${fixture!.secondHomeworkId}/submissions/${firstSubmission.id}/review`,
      {
        principal: "teacher-assigned",
        sessionId: fixture!.activeSessionId,
        method: "PATCH",
        json: {
          action: "request_resubmission",
          comment: "Please revise the last step",
          expectedSubmittedAt: firstTeacherVisibleSubmittedAt,
        },
      },
    );
    assert.equal(requestResubmission.status, 200, JSON.stringify(requestResubmission.body));

    const requestedList = await request(activeListPath, {
      principal: "student-a",
      sessionId: fixture!.activeSessionId,
    });
    const requested = (requestedList.body as Array<{ id: number; submission: { status: string; teacherComment: string | null } | null }>)
      .find((row) => row.id === fixture!.secondHomeworkId);
    assert.equal(requested?.submission?.status, "rejected");
    assert.equal(requested?.submission?.teacherComment, "Please revise the last step");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const revisedForm = new FormData();
    revisedForm.set("textAnswer", "Revised final answer");
    const revised = await request(`/api/student/homework/${fixture!.secondHomeworkId}/submit`, {
      principal: "student-a",
      sessionId: fixture!.activeSessionId,
      method: "POST",
      form: revisedForm,
    });
    assert.equal(revised.status, 200);
    const revisedSubmission = (revised.body as { submission: {
      id: number;
      status: string;
      submittedAt: string;
      reviewedAt: string | null;
      reviewedBy: number | null;
      teacherComment: string | null;
    } }).submission;
    assert.equal(revisedSubmission.id, firstSubmission.id);
    assert.equal(revisedSubmission.status, "submitted");
    assert.ok(new Date(revisedSubmission.submittedAt) > new Date(firstSubmission.submittedAt));
    assert.equal(revisedSubmission.reviewedAt, null);
    assert.equal(revisedSubmission.reviewedBy, null);
    assert.equal(revisedSubmission.teacherComment, null);
    const revisedReviewList = await request(`/api/homework/${fixture!.secondHomeworkId}/submissions`, {
      principal: "teacher-assigned",
      sessionId: fixture!.activeSessionId,
    });
    assert.equal(revisedReviewList.status, 200);
    const revisedTeacherEntry = (revisedReviewList.body as Array<{ studentId: number; submission: { submittedAt: string } | null }>)
      .find((entry) => entry.studentId === fixture!.studentAId);
    const revisedTeacherVisibleSubmittedAt = revisedTeacherEntry!.submission!.submittedAt;

    const staleReview = await request(
      `/api/homework/${fixture!.secondHomeworkId}/submissions/${revisedSubmission.id}/review`,
      {
        principal: "teacher-assigned",
        sessionId: fixture!.activeSessionId,
        method: "PATCH",
        json: {
          action: "approve",
          expectedSubmittedAt: firstTeacherVisibleSubmittedAt,
        },
      },
    );
    assert.equal(staleReview.status, 409);

    const finalReview = await request(
      `/api/homework/${fixture!.secondHomeworkId}/submissions/${revisedSubmission.id}/review`,
      {
        principal: "teacher-assigned",
        sessionId: fixture!.activeSessionId,
        method: "PATCH",
        json: {
          action: "approve",
          expectedSubmittedAt: revisedTeacherVisibleSubmittedAt,
        },
      },
    );
    assert.equal(finalReview.status, 200);
    assert.equal((finalReview.body as { teacherComment: string | null }).teacherComment, null);
  });

  await t.test("Student sees only their own answer and unauthorized Teachers cannot read submissions", async () => {
    const studentBList = await request(activeListPath, {
      principal: "student-b",
      sessionId: fixture!.activeSessionId,
    });
    const studentBRow = (studentBList.body as Array<{ id: number; submission: unknown | null }>)
      .find((row) => row.id === fixture!.activeHomeworkId);
    assert.equal(studentBRow?.submission, null);

    const unmapped = await request(`/api/homework/${fixture!.activeHomeworkId}/submissions`, {
      principal: "teacher-unassigned",
      sessionId: fixture!.activeSessionId,
    });
    assert.equal(unmapped.status, 403);
    const crossSchool = await request(`/api/homework/${fixture!.activeHomeworkId}/submissions`, {
      principal: "teacher-foreign",
      sessionId: fixture!.activeSessionId,
    });
    assert.equal(crossSchool.status, 403);
  });

  await t.test("attachment submissions expose only hasAttachment and cannot be reviewed", async () => {
    await db.insert(homeworkSubmissions).values({
      homeworkId: fixture!.attachmentHomeworkId,
      studentId: fixture!.studentAId,
      schoolId: fixture!.schoolId,
      fileUrl: "/uploads/homework-submissions/fixture-private-check.pdf",
      textAnswer: "Written answer with an attachment",
      status: "submitted",
    });
    const list = await request(`/api/homework/${fixture!.attachmentHomeworkId}/submissions`, {
      principal: "teacher-assigned",
      sessionId: fixture!.activeSessionId,
    });
    assert.equal(list.status, 200);
    const bodyText = JSON.stringify(list.body);
    assert.equal(bodyText.includes("/uploads/homework-submissions/fixture-private-check.pdf"), false);
    const entry = (list.body as Array<{ studentId: number; submission: { id: number; hasAttachment: boolean } | null }>)
      .find((row) => row.studentId === fixture!.studentAId);
    assert.equal(entry?.submission?.hasAttachment, true);
    const blocked = await request(
      `/api/homework/${fixture!.attachmentHomeworkId}/submissions/${entry!.submission!.id}/review`,
      {
        principal: "teacher-assigned",
        sessionId: fixture!.activeSessionId,
        method: "PATCH",
        json: {
          action: "approve",
          expectedSubmittedAt: new Date().toISOString(),
        },
      },
    );
    assert.equal(blocked.status, 409);
  });

  await t.test("foreign sessions and archived writes are rejected without changing Homework content", async () => {
    const crossSessionRead = await request(`/api/student/homework/${fixture!.archiveHomeworkId}`, {
      principal: "student-a",
      sessionId: fixture!.activeSessionId,
    });
    assert.equal(crossSessionRead.status, 403);

    const historicalRead = await request(`/api/homework/${fixture!.archiveHomeworkId}/submissions`, {
      principal: "teacher-assigned",
      sessionId: fixture!.archiveSessionId,
    });
    assert.equal(historicalRead.status, 200);

    const archivedReview = await request(
      `/api/homework/${fixture!.archiveHomeworkId}/submissions/1/review`,
      {
        principal: "teacher-assigned",
        sessionId: fixture!.archiveSessionId,
        method: "PATCH",
        json: {
          action: "approve",
          expectedSubmittedAt: new Date().toISOString(),
        },
      },
    );
    assert.equal(archivedReview.status, 403);

    const archivedForm = new FormData();
    archivedForm.set("textAnswer", "Should not be saved to archive");
    const archivedSubmit = await request(`/api/student/homework/${fixture!.archiveHomeworkId}/submit`, {
      principal: "student-a",
      sessionId: fixture!.archiveSessionId,
      method: "POST",
      form: archivedForm,
    });
    assert.equal(archivedSubmit.status, 403);
    assert.equal(await storage.getHomeworkSubmission(fixture!.archiveHomeworkId, fixture!.studentAId), undefined);
    assert.equal((await storage.getHomeworkById(fixture!.archiveHomeworkId))?.content, "Archived Homework content");
  });

  await t.test("archive viewing is read-only and does not alter academic content", async () => {
    const before = await storage.getHomeworkById(fixture!.archiveHomeworkId);
    const view = await request(`/api/student/homework/${fixture!.archiveHomeworkId}/view`, {
      principal: "student-a",
      sessionId: fixture!.archiveSessionId,
      method: "POST",
    });
    assert.equal(view.status, 403);
    const after = await storage.getHomeworkById(fixture!.archiveHomeworkId);
    assert.equal(after?.content, before?.content);
  });
});
