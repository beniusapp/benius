import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  academicHistory,
  academicSessions,
  auditLogs,
  examPolicyTiers,
  examScores,
  enrollments,
  gradingRules,
  gradingTiers,
  nonTeachingStaff,
  promotionDecisions,
  schoolMetadata,
  teachers,
  schools,
  students,
  users,
} from "@workspace/db";

const developmentDbTestEnabled = process.env.BENIUS_STAGE2B_DEV_DB_TEST === "1";

test("Stage 2B keeps source placement/history scoped and rolls back target conflicts in Development DB", {
  skip: developmentDbTestEnabled ? false : "set BENIUS_STAGE2B_DEV_DB_TEST=1 for disposable Development DB verification",
}, async (t) => {
  let schoolId: number | undefined;
  let foreignSchoolId: number | undefined;
  t.after(async () => {
    if (schoolId === undefined) return;
    await db.transaction(async tx => {
      await tx.delete(academicHistory).where(eq(academicHistory.schoolId, schoolId!));
      await tx.delete(auditLogs).where(eq(auditLogs.schoolId, schoolId!));
      await tx.delete(promotionDecisions).where(eq(promotionDecisions.schoolId, schoolId!));
      await tx.delete(enrollments).where(eq(enrollments.schoolId, schoolId!));
      await tx.delete(students).where(eq(students.schoolId, schoolId!));
      await tx.delete(academicSessions).where(eq(academicSessions.schoolId, schoolId!));
      await tx.delete(schools).where(eq(schools.id, schoolId!));
      if (foreignSchoolId !== undefined) {
        await tx.delete(schools).where(eq(schools.id, foreignSchoolId));
      }
    });
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 17);
  const seeded = await db.transaction(async tx => {
    const [school] = await tx.insert(schools).values({
      name: `Stage 2B disposable ${suffix}`,
      code: `P2B${suffix}`,
    }).returning({ id: schools.id });
    schoolId = school.id;
    const [foreignSchool] = await tx.insert(schools).values({
      name: `Stage 2B foreign ${suffix}`,
      code: `F${suffix}`,
    }).returning({ id: schools.id });
    foreignSchoolId = foreignSchool.id;
    const [promotionActor] = await tx.insert(nonTeachingStaff).values({
      schoolId: school.id,
      fullName: `Stage 2B Support Staff ${suffix}`,
      designation: "Exam Controller",
      allowedModules: ["exam-controller"],
      isActive: true,
    }).returning({ id: nonTeachingStaff.id });
    const [teacherUser] = await tx.insert(users).values({
      email: `stage2b-teacher-${suffix}@test.invalid`,
      passwordHash: "stage2b-disposable-test-hash",
      role: "teacher",
      schoolId: school.id,
      isActive: true,
    }).returning({ id: users.id });
    const [teacher] = await tx.insert(teachers).values({
      userId: teacherUser.id,
      schoolId: school.id,
      fullName: `Stage 2B Teacher ${suffix}`,
      phone: `71${suffix.slice(0, 8)}`,
      subject: "Mathematics",
      assignedClass: "5",
      assignedSection: "A",
      mustChangePassword: false,
      isActive: true,
    }).returning({ id: teachers.id });
    await tx.insert(schoolMetadata).values([
      {
        schoolId: school.id,
        metaKey: "classes",
        metaValue: JSON.stringify(["4", "5", "6", "7"]),
      },
      {
        schoolId: school.id,
        metaKey: "class_sections",
        metaValue: JSON.stringify({ "4": ["C"], "5": ["A"], "6": ["B"], "7": ["A"] }),
      },
      {
        schoolId: foreignSchool.id,
        metaKey: "classes",
        metaValue: JSON.stringify(["9"]),
      },
      {
        schoolId: foreignSchool.id,
        metaKey: "class_sections",
        metaValue: JSON.stringify({ "9": ["Z"] }),
      },
      {
        schoolId: school.id,
        metaKey: "exam_types",
        metaValue: JSON.stringify(["Stage 2B Assessment"]),
      },
      {
        schoolId: school.id,
        metaKey: "class_subjects",
        metaValue: JSON.stringify({ "4": ["Mathematics"], "5": ["Mathematics"] }),
      },
      {
        schoolId: school.id,
        metaKey: "class_exam_types",
        metaValue: JSON.stringify({
          "4": ["Stage 2B Assessment"],
          "5": ["Stage 2B Assessment"],
        }),
      },
    ]);
    const examWeights = JSON.stringify({
      "Stage 2B Year End": [{ source_exam: "Stage 2B Assessment", weight: 100 }],
    });
    await tx.insert(examPolicyTiers).values({
      schoolId: school.id,
      tierName: `Stage 2B policy ${suffix}`,
      applicableClasses: ["4", "5"],
      examWeights,
      promotionFailRules: JSON.stringify({ rule_term_avg: { enabled: true, minPct: 35 } }),
      resultsConfig: "{}",
    });
    const [gradingTier] = await tx.insert(gradingTiers).values({
      schoolId: school.id,
      name: `Stage 2B grading ${suffix}`,
      classes: ["4", "5"],
      passPercentage: 35,
      gradingSystem: "percentage",
      passingGrades: [],
      sortOrder: 1,
    }).returning({ id: gradingTiers.id });
    await tx.insert(gradingRules).values({
      schoolId: school.id,
      tierId: gradingTier.id,
      gradeLabel: "Pass",
      minPercent: "0",
      maxPercent: "100",
      gradePoint: "4",
      remarks: "Pass",
      sortOrder: 1,
    });

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

    const createdStudents = await tx.insert(students).values([1, 2, 3, 4, 5].map(index => ({
      schoolId: school.id,
      digitalStudentId: `P2B-${suffix}-${index}`,
      name: `Stage 2B Student ${index}`,
      class: index === 4 ? "4" : "5",
      section: index === 4 ? "C" : "A",
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

    await tx.insert(enrollments).values(createdStudents.map((student, index) => ({
      schoolId: school.id,
      studentId: student.id,
      sessionId: sourceSession.id,
      className: index === 3 ? "4" : "5",
      sectionName: index === 3 ? "C" : "A",
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
    await tx.insert(examScores).values(createdStudents.map(student => ({
      schoolId: school.id,
      studentId: student.id,
      teacherId: teacher.id,
      sessionId: sourceSession.id,
      class: student.id === createdStudents[3].id ? "4" : "5",
      section: student.id === createdStudents[3].id ? "C" : "A",
      subject: "Mathematics",
      examType: "Stage 2B Assessment",
      marks: 80,
      totalMarks: 100,
      isAbsent: false,
    })));

    await tx.insert(promotionDecisions).values([
      ...createdStudents.slice(0, 3).map(student => ({
        schoolId: school.id,
        class: "5",
        section: "A",
        term: "Stage 2B Year End",
        studentId: student.id,
        decision: "promoted",
        targetClass: "6",
        targetSection: "B",
        sessionId: sourceSession.id,
        processedByTeacherId: teacher.id,
        autoSuggestion: "promoted",
        manualIntervention: false,
        locked: true,
        lockedAt: new Date("2035-12-01T10:00:00.000Z"),
      })),
      {
        schoolId: school.id,
        class: "5",
        section: "A",
        term: "Stage 2B Year End",
        studentId: createdStudents[4].id,
        targetClass: "6",
        targetSection: "B",
        sessionId: sourceSession.id,
        processedByTeacherId: teacher.id,
        autoSuggestion: "promoted",
        manualIntervention: false,
        locked: true,
        lockedAt: new Date("2035-12-01T10:00:00.000Z"),
      },
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

    return { sourceSession, targetSession, createdStudents, promotionActor, teacher };
  });
  const fixtureSchoolId = schoolId;
  if (fixtureSchoolId === undefined) throw new Error("Development fixture school was not created");
  const executionActor = { id: seeded.promotionActor.id, role: "support_staff" as const };

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

  const invalidClassItem = {
    ...commonItem,
    studentId: seeded.createdStudents[0].id,
    nextClass: "9",
    nextSection: "Z",
  };
  await assert.rejects(
    storage.executePromotionTransaction(
      fixtureSchoolId,
      seeded.sourceSession.id,
      seeded.targetSession.id,
      [invalidClassItem],
      "Stage 2B Year End",
      executionActor,
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_CONFLICT",
  );
  await assert.rejects(
    storage.executePromotionTransaction(
      fixtureSchoolId,
      seeded.sourceSession.id,
      seeded.targetSession.id,
      [{ ...commonItem, studentId: seeded.createdStudents[0].id, nextSection: "Z" }],
      "Stage 2B Year End",
      executionActor,
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_CONFLICT",
  );

  await assert.rejects(
    storage.executePromotionTransaction(
      fixtureSchoolId,
      seeded.sourceSession.id,
      seeded.targetSession.id,
      [
        { ...commonItem, studentId: seeded.createdStudents[0].id },
        { ...commonItem, studentId: seeded.createdStudents[2].id, nextSection: "Z" },
      ],
      "Stage 2B Year End",
      executionActor,
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_CONFLICT",
  );
  const afterInvalidDestination = await db.select({
    studentId: academicHistory.studentId,
  }).from(academicHistory).where(and(
    eq(academicHistory.schoolId, fixtureSchoolId),
    inArray(academicHistory.studentId, [seeded.createdStudents[0].id, seeded.createdStudents[2].id]),
  ));
  assert.deepEqual(afterInvalidDestination, []);
  const afterInvalidTargetEnrollments = await db.select({
    studentId: enrollments.studentId,
  }).from(enrollments).where(and(
    eq(enrollments.schoolId, fixtureSchoolId),
    eq(enrollments.sessionId, seeded.targetSession.id),
    inArray(enrollments.studentId, [seeded.createdStudents[0].id, seeded.createdStudents[2].id]),
  ));
  assert.deepEqual(afterInvalidTargetEnrollments, []);

  const nonExecutedLockCount = await storage.setPromotionLedgerLock(
    fixtureSchoolId,
    seeded.sourceSession.id,
    "5",
    "A",
    "Stage 2B Year End",
    true,
  );
  assert.equal(nonExecutedLockCount, 4, "the locked cohort still reports its four ledger rows");
  await assert.rejects(
    storage.setPromotionLedgerLock(
      fixtureSchoolId,
      seeded.sourceSession.id,
      "5",
      "A",
      "Stage 2B Year End",
      false,
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_LOCKED",
  );

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
      executionActor,
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

  const auditedProposalStudent = seeded.createdStudents[0];
  await storage.upsertPromotionOverride({
    schoolId: fixtureSchoolId,
    sessionId: seeded.sourceSession.id,
    studentId: auditedProposalStudent.id,
    examType: "Stage 2B Year End",
    class: "5",
    section: "A",
    overrideStatus: "RETAIN",
    nextClass: "5",
    nextSection: "A",
    reason: "Keep the reviewed placement in the source class.",
  }, executionActor);
  const auditedOverrideExecutions = await Promise.all([1, 2].map(() =>
    storage.executePromotionTransaction(
      fixtureSchoolId,
      seeded.sourceSession.id,
      seeded.targetSession.id,
      [{ ...commonItem, studentId: auditedProposalStudent.id }],
      "Stage 2B Year End",
      executionActor,
      { mode: "web-audited" },
    ),
  ));
  const auditedOverrideExecution = auditedOverrideExecutions.find(result => result.prepared === 1);
  assert.ok(auditedOverrideExecution);
  assert.equal(auditedOverrideExecutions.reduce((sum, result) => sum + result.prepared, 0), 1);
  assert.equal(auditedOverrideExecutions.reduce((sum, result) => sum + result.alreadyPrepared, 0), 1);
  assert.equal(auditedOverrideExecution.prepared, 1);
  assert.equal(auditedOverrideExecution.students[0].toClass, "5");
  assert.equal(auditedOverrideExecution.students[0].toSection, "A");
  const auditedOverrideHistory = await db.select({
    toClass: academicHistory.toClass,
    toSection: academicHistory.toSection,
  }).from(academicHistory).where(and(
    eq(academicHistory.schoolId, fixtureSchoolId),
    eq(academicHistory.sessionId, seeded.sourceSession.id),
    eq(academicHistory.targetSessionId, seeded.targetSession.id),
    eq(academicHistory.studentId, auditedProposalStudent.id),
  ));
  assert.deepEqual(auditedOverrideHistory, [{ toClass: "5", toSection: "A" }]);
  const finalDecisionAuditRows = await db.select().from(auditLogs).where(and(
    eq(auditLogs.schoolId, fixtureSchoolId),
    eq(auditLogs.sessionId, seeded.sourceSession.id),
    eq(auditLogs.actionType, "PROMOTION_FINAL_DECISION_EXECUTED"),
    eq(auditLogs.entityId, auditedProposalStudent.id),
  ));
  const finalDecisionAudit = finalDecisionAuditRows[0];
  assert.ok(finalDecisionAudit?.details);
  const finalDecisionAuditDetails = JSON.parse(finalDecisionAudit.details);
  assert.equal(finalDecisionAuditDetails.finalDecision.status, "RETAIN");
  assert.equal(finalDecisionAuditDetails.finalDecision.nextClass, "5");
  assert.equal(finalDecisionAuditDetails.overrideApplied, true);
  assert.equal(finalDecisionAuditDetails.proposal.reason, "Keep the reviewed placement in the source class.");
  assert.equal(finalDecisionAuditDetails.executionActor.id, executionActor.id);
  const resolvedWebCohort = await storage.getPromotionCohortFinalDecisions(
    fixtureSchoolId,
    seeded.sourceSession.id,
    "5",
    "A",
    "Stage 2B Year End",
  );
  const resolvedWebStudent = resolvedWebCohort.finalDecisions.find(
    row => row.studentId === auditedProposalStudent.id,
  );
  assert.equal(resolvedWebStudent?.readiness, "executed");
  assert.deepEqual(resolvedWebStudent?.finalDecision, {
    status: "RETAIN",
    nextClass: "5",
    nextSection: "A",
  });
  assert.equal(resolvedWebStudent?.overrideApplied, true);
  const auditedOverrideReplay = await storage.executePromotionTransaction(
    fixtureSchoolId,
    seeded.sourceSession.id,
    seeded.targetSession.id,
    [{ ...commonItem, studentId: auditedProposalStudent.id }],
    "Stage 2B Year End",
    executionActor,
    { mode: "web-audited" },
  );
  assert.equal(auditedOverrideReplay.prepared, 0);
  assert.equal(auditedOverrideReplay.alreadyPrepared, 1);
  assert.equal(auditedOverrideReplay.idempotent, true);

  const concurrentProposalStudent = seeded.createdStudents[4];
  const proposalScope = {
    schoolId: fixtureSchoolId,
    sessionId: seeded.sourceSession.id,
    studentId: concurrentProposalStudent.id,
    examType: "Stage 2B Year End",
    class: "5",
    section: "A",
  };
  await storage.upsertPromotionOverride({
    ...proposalScope,
    overrideStatus: "RETAIN",
    nextClass: "5",
    nextSection: "A",
    reason: "Initial reviewed proposal.",
  }, executionActor);
  await storage.upsertPromotionOverride({
    ...proposalScope,
    overrideStatus: "PROMOTE",
    nextClass: "6",
    nextSection: "B",
    reason: "Replacement proposal after review.",
  }, executionActor);
  const editedProposal = (await storage.getPromotionOverridesWithAudit(
    fixtureSchoolId,
    seeded.sourceSession.id,
    "5",
    "A",
    "Stage 2B Year End",
    [concurrentProposalStudent.id],
  )).find(row => row.studentId === concurrentProposalStudent.id);
  assert.equal(editedProposal?.overrideStatus, "PROMOTE");
  assert.equal(editedProposal?.nextClass, "6");
  assert.equal(editedProposal?.nextSection, "B");
  assert.equal(editedProposal?.audit?.reason, "Replacement proposal after review.");
  assert.equal(editedProposal?.audit?.actorId, executionActor.id);
  assert.equal(editedProposal?.isProposal, true);

  await storage.deletePromotionOverride({
    ...proposalScope,
    reason: "Withdraw the proposal and use the locked Teacher decision.",
  }, executionActor);
  const overridesAfterClear = await storage.getPromotionOverridesWithAudit(
    fixtureSchoolId,
    seeded.sourceSession.id,
    "5",
    "A",
    "Stage 2B Year End",
    [concurrentProposalStudent.id],
  );
  assert.equal(overridesAfterClear.some(row => row.studentId === concurrentProposalStudent.id), false);
  const finalAfterClear = (await storage.getPromotionCohortFinalDecisions(
    fixtureSchoolId,
    seeded.sourceSession.id,
    "5",
    "A",
    "Stage 2B Year End",
  )).finalDecisions.find(row => row.studentId === concurrentProposalStudent.id);
  assert.equal(finalAfterClear?.readiness, "ready");
  assert.deepEqual(finalAfterClear?.finalDecision, {
    status: "PROMOTE",
    nextClass: "6",
    nextSection: "B",
  });
  assert.equal(finalAfterClear?.overrideApplied, false);

  const [concurrentProposalWrite, concurrentExecution] = await Promise.allSettled([
    storage.upsertPromotionOverride({
      ...proposalScope,
      overrideStatus: "RETAIN",
      nextClass: "5",
      nextSection: "A",
      reason: "Proposal submitted concurrently with final execution.",
    }, executionActor),
    storage.executePromotionTransaction(
      fixtureSchoolId,
      seeded.sourceSession.id,
      seeded.targetSession.id,
      [{ ...commonItem, studentId: concurrentProposalStudent.id }],
      "Stage 2B Year End",
      executionActor,
      { mode: "web-audited" },
    ),
  ]);
  if (concurrentExecution.status === "rejected") throw concurrentExecution.reason;
  const concurrentFinal = (await storage.getPromotionCohortFinalDecisions(
    fixtureSchoolId,
    seeded.sourceSession.id,
    "5",
    "A",
    "Stage 2B Year End",
  )).finalDecisions.find(row => row.studentId === concurrentProposalStudent.id);
  assert.equal(concurrentFinal?.readiness, "executed");
  if (concurrentProposalWrite.status === "fulfilled") {
    assert.deepEqual(concurrentFinal?.finalDecision, {
      status: "RETAIN",
      nextClass: "5",
      nextSection: "A",
    });
    assert.equal(concurrentFinal?.overrideApplied, true);
    assert.equal(concurrentFinal?.proposal?.reason, "Proposal submitted concurrently with final execution.");
  } else {
    assert.equal((concurrentProposalWrite.reason as any)?.code, "PROMOTION_ALREADY_EXECUTED");
    assert.deepEqual(concurrentFinal?.finalDecision, {
      status: "PROMOTE",
      nextClass: "6",
      nextSection: "B",
    });
    assert.equal(concurrentFinal?.overrideApplied, false);
  }

  const successStudent = seeded.createdStudents[2];
  await storage.upsertPromotionOverride({
    schoolId: fixtureSchoolId,
    sessionId: seeded.sourceSession.id,
    studentId: successStudent.id,
    examType: "Stage 2B Year End",
    class: "5",
    section: "A",
    overrideStatus: "RETAIN",
    nextClass: "5",
    nextSection: "A",
    reason: "Web-only proposal must not change the legacy Teacher-led execution contract.",
  }, executionActor);
  const result = await storage.executePromotionTransaction(
    fixtureSchoolId,
    seeded.sourceSession.id,
    seeded.targetSession.id,
    [{ ...commonItem, studentId: successStudent.id }],
    "Stage 2B Year End",
    executionActor,
  );
  assert.equal(result.prepared, 1);
  assert.equal(result.targetEnrollmentsCreated, 1);
  assert.equal(result.targetSessionId, seeded.targetSession.id);
  assert.equal(result.students[0].toClass, "6");
  assert.equal(result.students[0].toSection, "B");

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

  const executedReplay = await storage.executePromotionTransaction(
    fixtureSchoolId,
    seeded.sourceSession.id,
    seeded.targetSession.id,
    [{ ...commonItem, studentId: successStudent.id }],
    "Stage 2B Year End",
    executionActor,
  );
  assert.equal(executedReplay.prepared, 0);
  assert.equal(executedReplay.alreadyPrepared, 1);
  assert.equal(executedReplay.idempotent, true);
  assert.equal(executedReplay.targetEnrollmentsCreated, 0);
  const replayedHistory = await db.select({
    id: academicHistory.id,
  }).from(academicHistory).where(and(
    eq(academicHistory.schoolId, fixtureSchoolId),
    eq(academicHistory.sessionId, seeded.sourceSession.id),
    eq(academicHistory.targetSessionId, seeded.targetSession.id),
    eq(academicHistory.studentId, successStudent.id),
  ));
  assert.equal(replayedHistory.length, 1);
  const replayedTargetEnrollments = await db.select({
    id: enrollments.id,
  }).from(enrollments).where(and(
    eq(enrollments.schoolId, fixtureSchoolId),
    eq(enrollments.sessionId, seeded.targetSession.id),
    eq(enrollments.studentId, successStudent.id),
  ));
  assert.equal(replayedTargetEnrollments.length, 1);

  await assert.rejects(
    storage.savePromotionDecisions(
      fixtureSchoolId,
      "5",
      "A",
      "Stage 2B Year End",
      seeded.teacher.id,
      false,
      [{
        studentId: successStudent.id,
        decision: "promoted",
        targetClass: "6",
        targetSection: "B",
        editCount: 3,
        autoSuggestion: "promoted",
      }],
      seeded.sourceSession.id,
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_LOCKED",
  );
  await assert.rejects(
    storage.setPromotionLedgerLock(
      fixtureSchoolId,
      seeded.sourceSession.id,
      "5",
      "A",
      "Stage 2B Year End",
      false,
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_LOCKED",
  );
  await assert.rejects(
    storage.deletePromotionDecision(
      fixtureSchoolId,
      seeded.sourceSession.id,
      "5",
      "A",
      "Stage 2B Year End",
      successStudent.id,
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_EXECUTED",
  );
  await assert.rejects(
    storage.deletePromotionDecisionsByCohort(
      fixtureSchoolId,
      seeded.sourceSession.id,
      "5",
      "A",
      "Stage 2B Year End",
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_EXECUTED",
  );
  await assert.rejects(
    storage.deletePromotionDecisionsByTerm(
      fixtureSchoolId,
      seeded.sourceSession.id,
      "Stage 2B Year End",
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_EXECUTED",
  );
  await assert.rejects(
    storage.deletePromotionDecisionsByTerms(
      fixtureSchoolId,
      seeded.sourceSession.id,
      [
        "Stage 2B Year End",
        `mobile-session-${seeded.sourceSession.id}:Stage 2B Year End`,
      ],
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_EXECUTED",
  );

  const noLedgerStudent = seeded.createdStudents[3];
  const noLedgerDecisions = await db.select({
    id: promotionDecisions.id,
  }).from(promotionDecisions).where(and(
    eq(promotionDecisions.schoolId, fixtureSchoolId),
    eq(promotionDecisions.sessionId, seeded.sourceSession.id),
    eq(promotionDecisions.class, "5"),
    eq(promotionDecisions.section, "A"),
    eq(promotionDecisions.term, "Stage 2B Year End"),
    eq(promotionDecisions.studentId, noLedgerStudent.id),
  ));
  assert.deepEqual(noLedgerDecisions, []);
  const noLedgerItem = {
    ...commonItem,
    studentId: noLedgerStudent.id,
    fromClass: "4",
    fromSection: "C",
    nextClass: "5",
    nextSection: "C",
  };
  await assert.rejects(
    storage.executePromotionTransaction(
      fixtureSchoolId,
      seeded.sourceSession.id,
      seeded.targetSession.id,
      [noLedgerItem],
      "Stage 2B Year End",
      executionActor,
    ),
    (error: any) => error?.code === "PROMOTION_DECISION_MISSING",
  );
  const noLedgerHistory = await db.select({
    id: academicHistory.id,
  }).from(academicHistory).where(and(
    eq(academicHistory.schoolId, fixtureSchoolId),
    eq(academicHistory.sessionId, seeded.sourceSession.id),
    eq(academicHistory.targetSessionId, seeded.targetSession.id),
    eq(academicHistory.studentId, noLedgerStudent.id),
  ));
  assert.deepEqual(noLedgerHistory, []);
  const noLedgerTargetEnrollments = await db.select({
    id: enrollments.id,
  }).from(enrollments).where(and(
    eq(enrollments.schoolId, fixtureSchoolId),
    eq(enrollments.sessionId, seeded.targetSession.id),
    eq(enrollments.studentId, noLedgerStudent.id),
  ));
  assert.deepEqual(noLedgerTargetEnrollments, []);
  const noLedgerRegistry = await db.select({
    class: students.class,
    section: students.section,
    rollNumber: students.rollNumber,
  }).from(students).where(and(
    eq(students.schoolId, fixtureSchoolId),
    eq(students.id, noLedgerStudent.id),
  ));
  assert.deepEqual(noLedgerRegistry, [{
    class: "4",
    section: "C",
    rollNumber: noLedgerStudent.rollNumber,
  }]);
  const noLedgerSourceEnrollment = await db.select({
    className: enrollments.className,
    sectionName: enrollments.sectionName,
    rollNo: enrollments.rollNo,
    status: enrollments.status,
  }).from(enrollments).where(and(
    eq(enrollments.schoolId, fixtureSchoolId),
    eq(enrollments.sessionId, seeded.sourceSession.id),
    eq(enrollments.studentId, noLedgerStudent.id),
  ));
  assert.deepEqual(noLedgerSourceEnrollment, [{
    className: "4",
    sectionName: "C",
    rollNo: noLedgerStudent.rollNumber,
    status: "Active",
  }]);

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
