import "../test-support/stage3b4-test-entry-guard.cjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  academicHistory,
  academicSessions,
  enrollments,
  promotionDecisions,
  schoolMetadata,
  schools,
  students,
} from "@workspace/db";
import {
  AcademicSessionActivationBlockedError,
  AcademicSessionActivationNotFoundError,
} from "./academic-session-activation";
import { db, pool } from "./db";
import { storage } from "./storage";

const developmentDbTestEnabled = process.env.BENIUS_STAGE3_DEV_DB_TEST === "1";

test("Stage 3 activation synchronizes valid current placement, blocks conflicts, and rolls back update failures", {
  skip: developmentDbTestEnabled
    ? false
    : "set BENIUS_STAGE3_DEV_DB_TEST=1 only through the verified Stage 3B-4 test runner",
}, async (t) => {
  let schoolId: number | undefined;
  let otherSchoolId: number | undefined;
  let rollbackTriggerName: string | undefined;
  let rollbackFunctionName: string | undefined;

  t.after(async () => {
    if (rollbackTriggerName && schoolId !== undefined) {
      await pool.query(`DROP TRIGGER IF EXISTS ${rollbackTriggerName} ON students`);
    }
    if (rollbackFunctionName) {
      await pool.query(`DROP FUNCTION IF EXISTS ${rollbackFunctionName}()`);
    }
    await db.transaction(async (tx) => {
      if (schoolId !== undefined) {
        await tx.delete(academicHistory).where(eq(academicHistory.schoolId, schoolId));
        await tx.delete(promotionDecisions).where(eq(promotionDecisions.schoolId, schoolId));
        await tx.delete(enrollments).where(eq(enrollments.schoolId, schoolId));
        await tx.delete(students).where(eq(students.schoolId, schoolId));
        await tx.delete(academicSessions).where(eq(academicSessions.schoolId, schoolId));
        await tx.delete(schoolMetadata).where(eq(schoolMetadata.schoolId, schoolId));
        await tx.delete(schools).where(eq(schools.id, schoolId));
      }
      if (otherSchoolId !== undefined) {
        await tx.delete(enrollments).where(eq(enrollments.schoolId, otherSchoolId));
        await tx.delete(students).where(eq(students.schoolId, otherSchoolId));
        await tx.delete(academicSessions).where(eq(academicSessions.schoolId, otherSchoolId));
        await tx.delete(schoolMetadata).where(eq(schoolMetadata.schoolId, otherSchoolId));
        await tx.delete(schools).where(eq(schools.id, otherSchoolId));
      }
    });
    for (const fixtureId of [schoolId, otherSchoolId]) {
      if (fixtureId === undefined) continue;
      for (const table of ["schools", "students", "academic_sessions", "enrollments", "school_metadata", "promotion_decisions", "academic_history"]) {
        const result: { rows: { count: number }[] } = await pool.query(
          `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${table === "schools" ? "id" : "school_id"} = $1`,
          [fixtureId],
        );
        assert.equal(result.rows[0]?.count, 0, `fixture cleanup left rows in ${table}`);
      }
    }
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const seeded = await db.transaction(async (tx) => {
    const [school] = await tx.insert(schools).values({
      name: `Stage 3 disposable ${suffix}`,
      code: `S3${suffix}`,
    }).returning({ id: schools.id });
    schoolId = school.id;

    const [otherSchool] = await tx.insert(schools).values({
      name: `Stage 3 foreign ${suffix}`,
      code: `F3${suffix}`,
    }).returning({ id: schools.id });
    otherSchoolId = otherSchool.id;

    const [sourceSession] = await tx.insert(academicSessions).values({
      schoolId: school.id,
      sessionName: `Stage 3 Source ${suffix}`,
      startDate: "2035-04-01",
      endDate: "2036-03-31",
      isActive: true,
      status: "active",
    }).returning({ id: academicSessions.id });
    const [targetSession] = await tx.insert(academicSessions).values({
      schoolId: school.id,
      sessionName: `Stage 3 Target ${suffix}`,
      startDate: "2036-04-01",
      endDate: "2037-03-31",
      isActive: false,
      status: "draft",
    }).returning({ id: academicSessions.id });
    const [otherActiveSession] = await tx.insert(academicSessions).values({
      schoolId: otherSchool.id,
      sessionName: `Foreign Active ${suffix}`,
      startDate: "2036-04-01",
      endDate: "2037-03-31",
      isActive: true,
      status: "active",
    }).returning({ id: academicSessions.id });

    await tx.insert(schoolMetadata).values([
      {
        schoolId: school.id,
        metaKey: "classes",
        metaValue: '["4","5","6","7"]',
      },
      {
        schoolId: school.id,
        metaKey: "sections",
        metaValue: '["A","B","C"]',
      },
      {
        schoolId: school.id,
        metaKey: "class_sections",
        metaValue: '{"4":["C"],"5":["A"],"6":["B"],"7":["C"]}',
      },
    ]);

    const fixtureStudents = await tx.insert(students).values([
      {
        schoolId: school.id,
        digitalStudentId: `S3-${suffix}-1`,
        name: "Stage 3 Changed Student",
        class: "5",
        section: "A",
        phone: "9000000001",
        dob: "2010-01-01",
        passwordHash: "stage3-disposable-test-hash",
        rollNumber: 11,
        idCardPendingReissue: false,
        isActive: true,
      },
      {
        schoolId: school.id,
        digitalStudentId: `S3-${suffix}-2`,
        name: "Stage 3 Unchanged Student",
        class: "5",
        section: "A",
        phone: "9000000002",
        dob: "2010-02-02",
        passwordHash: "stage3-disposable-test-hash",
        rollNumber: 21,
        idCardPendingReissue: false,
        isActive: true,
      },
      {
        schoolId: school.id,
        digitalStudentId: `S3-${suffix}-3`,
        name: "Stage 3 Missing Student",
        class: "4",
        section: "C",
        phone: "9000000003",
        dob: "2010-03-03",
        passwordHash: "stage3-disposable-test-hash",
        rollNumber: 31,
        idCardPendingReissue: false,
        isActive: true,
      },
      {
        schoolId: school.id,
        digitalStudentId: `S3-${suffix}-4`,
        name: "Stage 3 Inactive Student",
        class: "4",
        section: "C",
        phone: "9000000004",
        dob: "2010-04-04",
        passwordHash: "stage3-disposable-test-hash",
        rollNumber: 41,
        idCardPendingReissue: false,
        isActive: false,
      },
    ]).returning({
      id: students.id,
      name: students.name,
      class: students.class,
      section: students.section,
      rollNumber: students.rollNumber,
      isActive: students.isActive,
    });

    const [foreignStudent] = await tx.insert(students).values({
      schoolId: otherSchool.id,
      digitalStudentId: `F3-${suffix}-1`,
      name: "Stage 3 Foreign Student",
      class: "5",
      section: "A",
      phone: "9000000010",
      dob: "2010-01-10",
      passwordHash: "stage3-disposable-test-hash",
      rollNumber: 10,
      isActive: true,
    }).returning({ id: students.id });

    await tx.insert(enrollments).values(fixtureStudents.map((student) => ({
      schoolId: school.id,
      studentId: student.id,
      sessionId: sourceSession.id,
      className: student.class,
      sectionName: student.section,
      rollNo: student.rollNumber,
      status: "Active",
    })));
    const [invalidTargetEnrollment] = await tx.insert(enrollments).values([
      {
        schoolId: school.id,
        studentId: fixtureStudents[0].id,
        sessionId: targetSession.id,
        className: "99",
        sectionName: "A",
        rollNo: 90,
        status: "Active",
      },
      {
        schoolId: school.id,
        studentId: fixtureStudents[1].id,
        sessionId: targetSession.id,
        className: "5",
        sectionName: "A",
        rollNo: 21,
        status: "Active",
      },
      {
        schoolId: school.id,
        studentId: fixtureStudents[3].id,
        sessionId: targetSession.id,
        className: "6",
        sectionName: "B",
        rollNo: 44,
        status: "Active",
      },
      {
        schoolId: school.id,
        studentId: foreignStudent.id,
        sessionId: targetSession.id,
        className: "6",
        sectionName: "B",
        rollNo: 90,
        status: "Active",
      },
    ]).returning({ id: enrollments.id });

    const [promotionDecision] = await tx.insert(promotionDecisions).values({
      schoolId: school.id,
      class: "5",
      section: "A",
      term: `Stage 3 decision ${suffix}`,
      studentId: fixtureStudents[0].id,
      decision: "promoted",
      targetClass: "6",
      targetSection: "B",
      sessionId: sourceSession.id,
    }).returning({ id: promotionDecisions.id });

    return {
      sourceSession,
      targetSession,
      otherActiveSession,
      foreignStudent,
      fixtureStudents,
      invalidTargetEnrollment,
      promotionDecision,
    };
  });
  const fixtureSchoolId = schoolId;
  const fixtureOtherSchoolId = otherSchoolId;
  if (fixtureSchoolId === undefined || fixtureOtherSchoolId === undefined) {
    throw new Error("Development fixture schools were not created");
  }

  const initialTargetRows = await db.select({
    studentId: enrollments.studentId,
    className: enrollments.className,
    sectionName: enrollments.sectionName,
    rollNo: enrollments.rollNo,
    status: enrollments.status,
  }).from(enrollments).where(and(
    eq(enrollments.schoolId, fixtureSchoolId),
    eq(enrollments.sessionId, seeded.targetSession.id),
  )).orderBy(enrollments.studentId);

  await assert.rejects(
    storage.activateAcademicSessionWithSummary(seeded.targetSession.id, fixtureSchoolId),
    (error: unknown) => {
      assert.ok(error instanceof AcademicSessionActivationBlockedError);
      assert.equal(error.preview.activeStudentsMissingTargetEnrollment, 1);
      assert.equal(error.preview.invalidTargetPlacements, 1);
      assert.equal(error.preview.foreignOrMissingStudentEnrollments, 1);
      return true;
    },
  );
  assert.deepEqual(
    await db.select({
      id: academicSessions.id,
      isActive: academicSessions.isActive,
      status: academicSessions.status,
    }).from(academicSessions).where(eq(academicSessions.schoolId, fixtureSchoolId))
      .orderBy(academicSessions.id),
    [
      { id: seeded.sourceSession.id, isActive: true, status: "active" },
      { id: seeded.targetSession.id, isActive: false, status: "draft" },
    ],
  );
  assert.deepEqual(
    await db.select({
      id: students.id,
      class: students.class,
      section: students.section,
      rollNumber: students.rollNumber,
      idCardPendingReissue: students.idCardPendingReissue,
    }).from(students).where(eq(students.schoolId, fixtureSchoolId)).orderBy(students.id),
    seeded.fixtureStudents.map((student) => ({
      id: student.id,
      class: student.class,
      section: student.section,
      rollNumber: student.rollNumber,
      idCardPendingReissue: false,
    })),
  );
  assert.deepEqual(
    await db.select({
      studentId: enrollments.studentId,
      className: enrollments.className,
      sectionName: enrollments.sectionName,
      rollNo: enrollments.rollNo,
      status: enrollments.status,
    }).from(enrollments).where(and(
      eq(enrollments.schoolId, fixtureSchoolId),
      eq(enrollments.sessionId, seeded.targetSession.id),
    )).orderBy(enrollments.studentId),
    initialTargetRows,
  );

  await assert.rejects(
    storage.activateAcademicSessionWithSummary(seeded.targetSession.id, fixtureOtherSchoolId),
    (error: unknown) => error instanceof AcademicSessionActivationNotFoundError,
  );
  const [foreignSchoolSessionBeforeRepair] = await db.select({
    isActive: academicSessions.isActive,
    status: academicSessions.status,
  }).from(academicSessions).where(and(
    eq(academicSessions.schoolId, fixtureOtherSchoolId),
    eq(academicSessions.id, seeded.otherActiveSession.id),
  ));
  assert.deepEqual(foreignSchoolSessionBeforeRepair, { isActive: true, status: "active" });

  await db.transaction(async (tx) => {
    await tx.update(enrollments).set({
      className: "6",
      sectionName: "B",
      rollNo: null,
    }).where(eq(enrollments.id, seeded.invalidTargetEnrollment.id));
    await tx.delete(enrollments).where(and(
      eq(enrollments.schoolId, fixtureSchoolId),
      eq(enrollments.sessionId, seeded.targetSession.id),
      eq(enrollments.studentId, seeded.foreignStudent.id),
    ));
    await tx.insert(enrollments).values({
      schoolId: fixtureSchoolId,
      studentId: seeded.fixtureStudents[2].id,
      sessionId: seeded.targetSession.id,
      className: "6",
      sectionName: "B",
      rollNo: 32,
      status: "Active",
    });
  });

  const activated = await storage.activateAcademicSessionWithSummary(
    seeded.targetSession.id,
    fixtureSchoolId,
  );
  assert.deepEqual(activated.summary, {
    activeStudents: 3,
    activeTargetSessionEnrollments: 4,
    studentsSynchronized: 3,
    studentsUpdated: 2,
    studentsUnchanged: 1,
    inactiveStudentsSkipped: 1,
  });

  const registryAfterActivation = await db.select({
    id: students.id,
    name: students.name,
    class: students.class,
    section: students.section,
    rollNumber: students.rollNumber,
    phone: students.phone,
    dob: students.dob,
    isActive: students.isActive,
    idCardPendingReissue: students.idCardPendingReissue,
  }).from(students).where(eq(students.schoolId, fixtureSchoolId)).orderBy(students.id);
  assert.deepEqual(registryAfterActivation, [
    {
      id: seeded.fixtureStudents[0].id,
      name: "Stage 3 Changed Student",
      class: "6",
      section: "B",
      rollNumber: null,
      phone: "9000000001",
      dob: "2010-01-01",
      isActive: true,
      idCardPendingReissue: true,
    },
    {
      id: seeded.fixtureStudents[1].id,
      name: "Stage 3 Unchanged Student",
      class: "5",
      section: "A",
      rollNumber: 21,
      phone: "9000000002",
      dob: "2010-02-02",
      isActive: true,
      idCardPendingReissue: false,
    },
    {
      id: seeded.fixtureStudents[2].id,
      name: "Stage 3 Missing Student",
      class: "6",
      section: "B",
      rollNumber: 32,
      phone: "9000000003",
      dob: "2010-03-03",
      isActive: true,
      idCardPendingReissue: true,
    },
    {
      id: seeded.fixtureStudents[3].id,
      name: "Stage 3 Inactive Student",
      class: "4",
      section: "C",
      rollNumber: 41,
      phone: "9000000004",
      dob: "2010-04-04",
      isActive: false,
      idCardPendingReissue: false,
    },
  ]);

  const sessionStates = await db.select({
    id: academicSessions.id,
    isActive: academicSessions.isActive,
    status: academicSessions.status,
  }).from(academicSessions).where(eq(academicSessions.schoolId, fixtureSchoolId))
    .orderBy(academicSessions.id);
  assert.deepEqual(sessionStates, [
    { id: seeded.sourceSession.id, isActive: false, status: "archived" },
    { id: seeded.targetSession.id, isActive: true, status: "active" },
  ]);
  assert.equal(sessionStates.filter((session) => session.isActive).length, 1);
  assert.equal(await storage.deleteAcademicSession(seeded.targetSession.id, fixtureSchoolId), false);
  assert.equal(
    (await db.select({ id: academicSessions.id })
      .from(academicSessions)
      .where(and(
        eq(academicSessions.schoolId, fixtureSchoolId),
        eq(academicSessions.isActive, true),
      ))).length,
    1,
  );

  const sourceEnrollmentsAfterActivation = await db.select({
    studentId: enrollments.studentId,
    className: enrollments.className,
    sectionName: enrollments.sectionName,
    rollNo: enrollments.rollNo,
  }).from(enrollments).where(and(
    eq(enrollments.schoolId, fixtureSchoolId),
    eq(enrollments.sessionId, seeded.sourceSession.id),
  )).orderBy(enrollments.studentId);
  assert.deepEqual(sourceEnrollmentsAfterActivation, seeded.fixtureStudents.map((student) => ({
    studentId: student.id,
    className: student.class,
    sectionName: student.section,
    rollNo: student.rollNumber,
  })));
  const [preservedTargetEnrollment] = await db.select({
    className: enrollments.className,
    sectionName: enrollments.sectionName,
    rollNo: enrollments.rollNo,
  }).from(enrollments).where(and(
    eq(enrollments.schoolId, fixtureSchoolId),
    eq(enrollments.sessionId, seeded.targetSession.id),
    eq(enrollments.studentId, seeded.fixtureStudents[0].id),
  ));
  assert.deepEqual(preservedTargetEnrollment, {
    className: "6",
    sectionName: "B",
    rollNo: null,
  });
  const [preservedPromotionDecision] = await db.select({
    id: promotionDecisions.id,
    decision: promotionDecisions.decision,
    targetClass: promotionDecisions.targetClass,
    targetSection: promotionDecisions.targetSection,
  }).from(promotionDecisions).where(and(
    eq(promotionDecisions.schoolId, fixtureSchoolId),
    eq(promotionDecisions.id, seeded.promotionDecision.id),
  ));
  assert.deepEqual(preservedPromotionDecision, {
    id: seeded.promotionDecision.id,
    decision: "promoted",
    targetClass: "6",
    targetSection: "B",
  });

  const [rollbackSession] = await db.insert(academicSessions).values({
    schoolId: fixtureSchoolId,
    sessionName: `Stage 3 Rollback ${suffix}`,
    startDate: "2037-04-01",
    endDate: "2038-03-31",
    isActive: false,
    status: "draft",
  }).returning({ id: academicSessions.id });
  await db.insert(enrollments).values([
    {
      schoolId: fixtureSchoolId,
      studentId: seeded.fixtureStudents[0].id,
      sessionId: rollbackSession.id,
      className: "7",
      sectionName: "C",
      rollNo: 71,
      status: "Active",
    },
    {
      schoolId: fixtureSchoolId,
      studentId: seeded.fixtureStudents[1].id,
      sessionId: rollbackSession.id,
      className: "5",
      sectionName: "A",
      rollNo: 21,
      status: "Active",
    },
    {
      schoolId: fixtureSchoolId,
      studentId: seeded.fixtureStudents[2].id,
      sessionId: rollbackSession.id,
      className: "7",
      sectionName: "C",
      rollNo: 73,
      status: "Active",
    },
  ]);

  rollbackFunctionName = `stage3_activation_failure_${fixtureSchoolId}`;
  rollbackTriggerName = `stage3_activation_failure_${fixtureSchoolId}`;
  await pool.query(`
    CREATE FUNCTION ${rollbackFunctionName}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id = ${seeded.fixtureStudents[0].id} THEN
        RAISE EXCEPTION 'forced Stage 3 activation update failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER ${rollbackTriggerName}
    BEFORE UPDATE OF class, section, roll_number, id_card_pending_reissue
    ON students FOR EACH ROW
    EXECUTE FUNCTION ${rollbackFunctionName}()
  `);

  await assert.rejects(
    storage.activateAcademicSessionWithSummary(rollbackSession.id, fixtureSchoolId),
    (error: unknown) => {
      const cause = (error as { cause?: { message?: string } }).cause;
      assert.equal(cause?.message, "forced Stage 3 activation update failure");
      return true;
    },
  );
  await pool.query(`DROP TRIGGER IF EXISTS ${rollbackTriggerName} ON students`);
  await pool.query(`DROP FUNCTION IF EXISTS ${rollbackFunctionName}()`);
  rollbackTriggerName = undefined;
  rollbackFunctionName = undefined;

  const rollbackStates = await db.select({
    id: academicSessions.id,
    isActive: academicSessions.isActive,
    status: academicSessions.status,
  }).from(academicSessions).where(eq(academicSessions.schoolId, fixtureSchoolId))
    .orderBy(academicSessions.id);
  assert.deepEqual(rollbackStates, [
    { id: seeded.sourceSession.id, isActive: false, status: "archived" },
    { id: seeded.targetSession.id, isActive: true, status: "active" },
    { id: rollbackSession.id, isActive: false, status: "draft" },
  ]);
  assert.equal(rollbackStates.filter((session) => session.isActive).length, 1);
  const [registryAfterRollback] = await db.select({
    class: students.class,
    section: students.section,
    rollNumber: students.rollNumber,
    idCardPendingReissue: students.idCardPendingReissue,
  }).from(students).where(and(
    eq(students.schoolId, fixtureSchoolId),
    eq(students.id, seeded.fixtureStudents[0].id),
  ));
  assert.deepEqual(registryAfterRollback, {
    class: "6",
    section: "B",
    rollNumber: null,
    idCardPendingReissue: true,
  });
  const [foreignSchoolSessionAfterRollback] = await db.select({
    isActive: academicSessions.isActive,
    status: academicSessions.status,
  }).from(academicSessions).where(and(
    eq(academicSessions.schoolId, fixtureOtherSchoolId),
    eq(academicSessions.id, seeded.otherActiveSession.id),
  ));
  assert.deepEqual(foreignSchoolSessionAfterRollback, { isActive: true, status: "active" });
});
