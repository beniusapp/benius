import assert from "node:assert/strict";
import test from "node:test";
import {
  PromotionStage1Error,
  validatePromotionTargetEnrollment,
  validatePromotionTargetSession,
  type PromotionExecutionItem,
  type PromotionTargetEnrollmentRow,
  type PromotionTargetSessionRow,
} from "./promotion-stage1";

const promotionItem: PromotionExecutionItem = {
  studentId: 7,
  fromClass: "5",
  fromSection: "A",
  nextClass: "6",
  nextSection: "B",
  examType: "Term 2",
  totalObtained: 480,
  totalMax: 600,
  percentage: 80,
};

const draftTargetSession: PromotionTargetSessionRow = {
  id: 44,
  schoolId: 11,
  status: "draft",
  sessionName: "2027–2028",
};

const expectedEnrollment: PromotionTargetEnrollmentRow = {
  studentId: 7,
  schoolId: 11,
  sessionId: 44,
  className: "6",
  sectionName: "B",
  rollNo: null,
  status: "Active",
};

test("Promotion target must be explicit, school-owned, different from source, and non-archived", () => {
  assert.doesNotThrow(() =>
    validatePromotionTargetSession(11, 42, 44, draftTargetSession),
  );

  const invalidTargets: Array<{
    sourceId: number;
    targetId: number;
    session: PromotionTargetSessionRow | undefined;
    code: string;
  }> = [
    { sourceId: 42, targetId: 42, session: draftTargetSession, code: "TARGET_SESSION_SAME_AS_SOURCE" },
    { sourceId: 42, targetId: 44, session: undefined, code: "TARGET_SESSION_NOT_ACCESSIBLE" },
    { sourceId: 42, targetId: 44, session: { ...draftTargetSession, schoolId: 12 }, code: "TARGET_SESSION_NOT_ACCESSIBLE" },
    { sourceId: 42, targetId: 44, session: { ...draftTargetSession, status: "archived" }, code: "TARGET_SESSION_NOT_ACCESSIBLE" },
  ];

  for (const invalid of invalidTargets) {
    assert.throws(
      () => validatePromotionTargetSession(11, invalid.sourceId, invalid.targetId, invalid.session),
      (error: unknown) => error instanceof PromotionStage1Error && error.code === invalid.code,
    );
  }

  assert.throws(
    () => validatePromotionTargetSession(11, 42, 0, draftTargetSession),
    (error: unknown) => error instanceof PromotionStage1Error && error.code === "TARGET_SESSION_REQUIRED",
  );
});

test("Promotion creates a target enrollment only when none exists and accepts only an exact prior preparation", () => {
  assert.equal(validatePromotionTargetEnrollment(11, 44, promotionItem, []), "create");
  assert.equal(
    validatePromotionTargetEnrollment(11, 44, promotionItem, [expectedEnrollment]),
    "already_prepared",
  );

  const conflicts: PromotionTargetEnrollmentRow[][] = [
    [{ ...expectedEnrollment, schoolId: 12 }],
    [{ ...expectedEnrollment, sessionId: 45 }],
    [{ ...expectedEnrollment, className: "7" }],
    [{ ...expectedEnrollment, sectionName: "A" }],
    [{ ...expectedEnrollment, rollNo: 12 }],
    [{ ...expectedEnrollment, status: "Inactive" }],
    [expectedEnrollment, expectedEnrollment],
  ];

  for (const rows of conflicts) {
    assert.throws(
      () => validatePromotionTargetEnrollment(11, 44, promotionItem, rows),
      (error: unknown) => error instanceof PromotionStage1Error &&
        error.statusCode === 409 &&
        error.code === "TARGET_ENROLLMENT_CONFLICT",
    );
  }
});
