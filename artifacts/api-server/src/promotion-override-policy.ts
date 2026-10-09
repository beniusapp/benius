import { hasSupportStaffModuleAccess } from "./support-staff-module-permissions";
import {
  checkLockedPromotionDecision,
  PromotionStage1Error,
  type LockedPromotionDecisionInput,
} from "./promotion-stage1";

export type PromotionOverrideActor = {
  id: number;
  role: "admin" | "support_staff";
};

export type PromotionOverrideStatus = "PROMOTE" | "RETAIN";

export type PromotionOverrideActorRecord = {
  id: number;
  schoolId: number;
  isActive: boolean;
  role?: string;
  allowedModules?: unknown;
};

export function promotionOverrideActorFromSession(session: {
  userRole?: string | null;
  userId?: number | null;
  staffId?: number | null;
}): PromotionOverrideActor | null {
  const staffId = session.staffId;
  const userId = session.userId;
  if (
    session.userRole === "admin" &&
    Number.isSafeInteger(userId) &&
    (userId ?? 0) > 0
  ) {
    return { id: userId!, role: "admin" };
  }
  if (
    session.userRole === "support_staff" &&
    typeof staffId === "number" &&
    Number.isSafeInteger(staffId) &&
    staffId > 0 &&
    userId === -staffId
  ) {
    return { id: staffId, role: "support_staff" };
  }
  return null;
}

export type PromotionOverrideCandidate = {
  status: string;
  nextClass: string;
  nextSection: string;
  sourceClass: string;
  sourceSection: string;
  resultStatus: LockedPromotionDecisionInput["resultStatus"];
  promoted: LockedPromotionDecisionInput["promoted"];
  decision: LockedPromotionDecisionInput["decision"];
  teacherIsValid: boolean;
  teacherTargetIsConfigured: boolean;
  overrideTargetIsConfigured: boolean;
  studentIsInSourceRoster: boolean;
  sessionIsActive: boolean;
  adminExecuted: boolean;
};

export function requirePromotionOverrideReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason || reason.length > 500) {
    throw new PromotionStage1Error(
      "Enter a reason of 1–500 characters for this Promotion override change.",
      400,
      "PROMOTION_OVERRIDE_REASON_REQUIRED",
    );
  }
  return reason;
}

export function assertPromotionOverrideActorRecord(
  actor: PromotionOverrideActor,
  schoolId: number,
  record: PromotionOverrideActorRecord | undefined,
): void {
  if (
    !record ||
    record.id !== actor.id ||
    record.schoolId !== schoolId ||
    record.isActive !== true
  ) {
    throw new PromotionStage1Error(
      "An active account in this school is required to change Promotion overrides.",
      403,
      "PROMOTION_OVERRIDE_ACTOR_INVALID",
    );
  }

  if (actor.role === "admin" && record.role === "admin") return;
  if (
    actor.role === "support_staff" &&
    Array.isArray(record.allowedModules) &&
    hasSupportStaffModuleAccess(record.allowedModules as string[], "exam-controller")
  ) {
    return;
  }

  throw new PromotionStage1Error(
    "An active Admin or Support Staff member with Exam Controller access is required.",
    403,
    "PROMOTION_OVERRIDE_ACTOR_INVALID",
  );
}

export function assertPromotionOverrideBatch(
  items: Array<{
    schoolId: number;
    sessionId: number;
    studentId: number;
    examType: string;
    class: string;
    section: string;
  }>,
): void {
  if (items.length === 0) return;
  const first = items[0];
  const studentIds = items.map(item => item.studentId);
  if (
    new Set(studentIds).size !== studentIds.length ||
    items.some(item =>
      item.schoolId !== first.schoolId ||
      item.sessionId !== first.sessionId ||
      item.class !== first.class ||
      item.section !== first.section ||
      item.examType !== first.examType
    )
  ) {
    throw new PromotionStage1Error(
      "Promotion overrides in one request must use one school, session, cohort, and examination with no duplicate Students.",
      400,
      "MIXED_PROMOTION_COHORT",
    );
  }
}

export function validatePromotionOverrideCandidate(input: PromotionOverrideCandidate): void {
  if (input.status !== "PROMOTE" && input.status !== "RETAIN") {
    throw new PromotionStage1Error(
      "New Promotion overrides may only Promote or Retain. Existing Grace records remain unchanged.",
      400,
      "PROMOTION_OVERRIDE_OUTCOME_INVALID",
    );
  }
  if (!input.sessionIsActive) {
    throw new PromotionStage1Error(
      "Promotion overrides can only be changed in the school's active Academic Session.",
      403,
      "SESSION_NOT_WRITABLE",
    );
  }
  if (input.adminExecuted) {
    throw new PromotionStage1Error(
      "This Student's Promotion has already been executed. The saved override cannot be changed or deleted.",
      409,
      "PROMOTION_ALREADY_EXECUTED",
    );
  }
  if (!input.studentIsInSourceRoster) {
    throw new PromotionStage1Error(
      "This Student is not active in the selected Academic Session and exact source class-section.",
      409,
      "PROMOTION_STUDENT_NOT_IN_SOURCE_ROSTER",
    );
  }
  if (!input.overrideTargetIsConfigured) {
    throw new PromotionStage1Error(
      "The selected override destination must be configured for this school.",
      400,
      "TARGET_PLACEMENT_NOT_CONFIGURED",
    );
  }
  if (
    input.status === "RETAIN" &&
    (input.nextClass !== input.sourceClass || input.nextSection !== input.sourceSection)
  ) {
    throw new PromotionStage1Error(
      "A Retain override must keep the Student in the current class and section.",
      400,
      "PROMOTION_OVERRIDE_TARGET_INVALID",
    );
  }

  const decisionCheck = checkLockedPromotionDecision({
    resultStatus: input.resultStatus,
    promoted: input.promoted,
    decision: input.decision,
    teacherIsValid: input.teacherIsValid,
    targetPlacementIsConfigured: input.teacherTargetIsConfigured,
    sourceClass: input.sourceClass,
    sourceSection: input.sourceSection,
  });
  if (!decisionCheck.ok) {
    throw new PromotionStage1Error(decisionCheck.message, 409, decisionCheck.code);
  }
}
