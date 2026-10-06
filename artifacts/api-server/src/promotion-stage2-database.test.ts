import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  academicHistory,
  academicSessions,
  enrollments,
  promotionDecisions,
  schools,
  students,
} from "@workspace/db";

const developmentDbTestEnabled = process.env.BENIUS_STAGE2B_DEV_DB_TEST === "1";

test("Stage 2B keeps source placement/history scoped and rolls back target conflicts in Development DB", {
  skip: developmentDbTestEnabled ? false : "set BENIUS_STAGE2B_DEV_DB_TEST=1 for disposable Development DB verification",
}, async (t) => {
  let schoolId: number | undefined;
  t.after(async () => {
    if (schoolId === undefined) return;
    await db.transaction(async tx => {
      await tx.delete(academicHistory).where(eq(academicHistory.schoolId, schoolId!));
      await tx.delete(promotionDecisions).where(eq(promotionDecisions.schoolId, schoolId!));
      await tx.delete(enrollments).where(eq(enrollments.schoolId, schoolId!));
      await tx.delete(students).where(eq(students.schoolId, schoolId!));
      await tx.delete(academicSessions).where(eq(academicSessions.schoolId, schoolId!));
      await tx.delete(schools).where(eq(schools.id, schoolId!));
    });
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 17);
  const seeded = await db.transaction(async tx => {
    const [school] = await tx.insert(schools).values({
      name: `Stage 2B disposable ${suffix}`,
      code: `P2B${suffix}`,
    }).returning({ id: schools.id });
    schoolId = school.id;

    const [sourceSession] = await tx.insert(academicSessions).values({
      schoolId: school.id,
      sessionName: `Stage 2B Source ${suffix}`,
      startDate: "2035-04-01",
      endDate: "2036-03-31",
      isActive: true,
      status: "active",
    }).returning({ id: academicSessions.id });
    const [targetSession] = await tx.insert(academicSessions).values({
      schoolId: school.id,
      sessionName: `Stage 2B Target ${suffix}`,
      startDate: "2036-04-01",
      endDate: "2037-03-31",
      isActive: false,
      status: "draft",
    }).returning({ id: academicSessions.id });

    const createdStudents = await tx.insert(students).values([1, 2, 3].map(index => ({
      schoolId: school.id,
      digitalStudentId: `P2B-${suffix}-${index}`,
      name: `Stage 2B Student ${index}`,
      class: "5",
      section: "A",
      phone: `90000000${String(index).padStart(2, "0")}`,
      dob: "2010-01-01",
      passwordHash: "stage2b-disposable-test-hash",
      rollNumber: 77 + index,
      idCardPendingReissue: true,
    }))).returning({
      id: students.id,
      digitalStudentId: students.digitalStudentId,
      class: students.class,
      section: students.section,
      rollNumber: students.rollNumber,
      idCardPendingReissue: students.idCardPendingReissue,
    });

    await tx.insert(enrollments).values(createdStudents.map(student => ({
      schoolId: school.id,
      studentId: student.id,
      sessionId: sourceSession.id,
      className: "5",
      sectionName: "A",
      rollNo: student.rollNumber,
      status: "Active",
    })));
    await tx.insert(enrollments).values({
      schoolId: school.id,
      studentId: createdStudents[1].id,
      sessionId: targetSession.id,
      className: "7",
      sectionName: "A",
      rollNo: null,
      status: "Active",
    });

    await tx.insert(promotionDecisions).values([
      ...createdStudents.map(student => ({
        schoolId: school.id,
        class: "5",
        section: "A",
        term: "Stage 2B Year End",
        studentId: student.id,
        targetClass: "6",
        targetSection: "B",
        sessionId: sourceSession.id,
      })),
      {
        schoolId: school.id,
        class: "5",
        section: "A",
        term: "Stage 2B Year End",
        studentId: createdStudents[2].id,
        targetClass: "6",
        targetSection: "B",
        sessionId: targetSession.id,
      },
      {
        schoolId: school.id,
        class: "4",
        section: "C",
        term: "Stage 2B Year End",
        studentId: createdStudents[2].id,
        targetClass: "5",
        targetSection: "C",
        sessionId: sourceSession.id,
        adminExecuted: true,
      },
      {
        schoolId: school.id,
        class: "7",
        section: "D",
        term: "Stage 2B Year End",
        studentId: createdStudents[2].id,
        targetClass: "8",
        targetSection: "D",
        sessionId: sourceSession.id,
        adminExecuted: false,
      },
    ]);

    return { sourceSession, targetSession, createdStudents };
  });
  const fixtureSchoolId = schoolId;
  if (fixtureSchoolId === undefined) throw new Error("Development fixture school was not created");

  const commonItem = {
    fromClass: "5",
    fromSection: "A",
    nextClass: "6",
    nextSection: "B",
    examType: "Stage 2B Year End",
    totalObtained: 480,
    totalMax: 600,
    percentage: 80,
  };

  await assert.rejects(
    storage.executePromotionTransaction(
      fixtureSchoolId,
      seeded.sourceSession.id,
      seeded.targetSession.id,
      [
        { ...commonItem, studentId: seeded.createdStudents[0].id },
        { ...commonItem, studentId: seeded.createdStudents[1].id },
      ],
      "Stage 2B Year End",
      { id: 7, role: "support_staff" },
    ),
    (error: any) => error?.code === "TARGET_ENROLLMENT_CONFLICT",
  );

  const afterConflictHistory = await db.select({
    id: academicHistory.id,
    studentId: academicHistory.studentId,
  }).from(academicHistory).where(and(
    eq(academicHistory.schoolId, fixtureSchoolId),
    inArray(academicHistory.studentId, seeded.createdStudents.slice(0, 2).map(student => student.id)),
  ));
  assert.deepEqual(afterConflictHistory, []);

  const afterConflictTargetEnrollments = await db.select({
    studentId: enrollments.studentId,
    className: enrollments.className,
  }).from(enrollments).where(and(
    eq(enrollments.schoolId, fixtureSchoolId),
    eq(enrollments.sessionId, seeded.targetSession.id),
    inArray(enrollments.studentId, seeded.createdStudents.slice(0, 2).map(student => student.id)),
  ));
  assert.deepEqual(afterConflictTargetEnrollments, [{
    studentId: seeded.createdStudents[1].id,
    className: "7",
  }]);

  const conflictDecisions = await db.select({
    adminExecuted: promotionDecisions.adminExecuted,
  }).from(promotionDecisions).where(and(
    eq(promotionDecisions.schoolId, fixtureSchoolId),
    eq(promotionDecisions.sessionId, seeded.sourceSession.id),
    inArray(promotionDecisions.studentId, seeded.createdStudents.slice(0, 2).map(student => student.id)),
  ));
  assert.deepEqual(conflictDecisions.map(row => row.adminExecuted), [false, false]);

  const successStudent = seeded.createdStudents[2];
  const result = await storage.executePromotionTransaction(
    fixtureSchoolId,
    seeded.sourceSession.id,
    seeded.targetSession.id,
    [{ ...commonItem, studentId: successStudent.id }],
    "Stage 2B Year End",
    { id: 7, role: "support_staff" },
  );
  assert.equal(result.prepared, 1);
  assert.equal(result.targetEnrollmentsCreated, 1);
  assert.equal(result.targetSessionId, seeded.targetSession.id);

  const [registryStudent] = await db.select({
    class: students.class,
    section: students.section,
    rollNumber: students.rollNumber,
    idCardPendingReissue: students.idCardPendingReissue,
  }).from(students).where(and(
    eq(students.schoolId, fixtureSchoolId),
    eq(students.id, successStudent.id),
  ));
  assert.deepEqual(registryStudent, {
    class: "5",
    section: "A",
    rollNumber: successStudent.rollNumber,
    idCardPendingReissue: true,
  });

  const [sourceEnrollment] = await db.select({
    className: enrollments.className,
    sectionName: enrollments.sectionName,
    rollNo: enrollments.rollNo,
    status: enrollments.status,
  }).from(enrollments).where(and(
    eq(enrollments.schoolId, fixtureSchoolId),
    eq(enrollments.studentId, successStudent.id),
    eq(enrollments.sessionId, seeded.sourceSession.id),
  ));
  assert.deepEqual(sourceEnrollment, {
    className: "5",
    sectionName: "A",
    rollNo: successStudent.rollNumber,
    status: "Active",
  });

  const [targetEnrollment] = await db.select({
    className: enrollments.className,
    sectionName: enrollments.sectionName,
    rollNo: enrollments.rollNo,
    status: enrollments.status,
  }).from(enrollments).where(and(
    eq(enrollments.schoolId, fixtureSchoolId),
    eq(enrollments.studentId, successStudent.id),
    eq(enrollments.sessionId, seeded.targetSession.id),
  ));
  assert.deepEqual(targetEnrollment, {
    className: "6",
    sectionName: "B",
    rollNo: null,
    status: "Active",
  });

  const [history] = await db.select({
    sessionId: academicHistory.sessionId,
    targetSessionId: academicHistory.targetSessionId,
    fromClass: academicHistory.fromClass,
    fromSection: academicHistory.fromSection,
    toClass: academicHistory.toClass,
    toSection: academicHistory.toSection,
  }).from(academicHistory).where(and(
    eq(academicHistory.schoolId, fixtureSchoolId),
    eq(academicHistory.studentId, successStudent.id),
  ));
  assert.deepEqual(history, {
    sessionId: seeded.sourceSession.id,
    targetSessionId: seeded.targetSession.id,
    fromClass: "5",
    fromSection: "A",
    toClass: "6",
    toSection: "B",
  });

  const decisions = await db.select({
    sessionId: promotionDecisions.sessionId,
    class: promotionDecisions.class,
    section: promotionDecisions.section,
    adminExecuted: promotionDecisions.adminExecuted,
  }).from(promotionDecisions).where(and(
    eq(promotionDecisions.schoolId, fixtureSchoolId),
    eq(promotionDecisions.studentId, successStudent.id),
    inArray(promotionDecisions.sessionId, [seeded.sourceSession.id, seeded.targetSession.id]),
  ));
  const decisionFor = (sessionId: number, className: string, section: string) =>
    decisions.find(row =>
      row.sessionId === sessionId && row.class === className && row.section === section,
    );
  assert.equal(decisionFor(seeded.sourceSession.id, "5", "A")?.adminExecuted, true);
  assert.equal(decisionFor(seeded.targetSession.id, "5", "A")?.adminExecuted, false);
  assert.equal(decisionFor(seeded.sourceSession.id, "4", "C")?.adminExecuted, true);
  assert.equal(decisionFor(seeded.sourceSession.id, "7", "D")?.adminExecuted, false);

  const [sourceSessionState] = await db.select({
    id: academicSessions.id,
    isActive: academicSessions.isActive,
    status: academicSessions.status,
  }).from(academicSessions).where(and(
    eq(academicSessions.schoolId, fixtureSchoolId),
    eq(academicSessions.id, seeded.sourceSession.id),
  ));
  const [targetSessionState] = await db.select({
    id: academicSessions.id,
    isActive: academicSessions.isActive,
    status: academicSessions.status,
  }).from(academicSessions).where(and(
    eq(academicSessions.schoolId, fixtureSchoolId),
    eq(academicSessions.id, seeded.targetSession.id),
  ));
  assert.equal(sourceSessionState.id, seeded.sourceSession.id);
  assert.equal(sourceSessionState.isActive, true);
  assert.equal(targetSessionState.id, seeded.targetSession.id);
  assert.equal(targetSessionState.isActive, false);
  assert.equal(targetSessionState.status, "draft");
});
