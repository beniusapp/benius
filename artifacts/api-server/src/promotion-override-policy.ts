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

export type PromotionFinalDecisionProposal = {
  eventId: number;
  status: string;
  nextClass: string;
  nextSection: string;
  reason: unknown;
  actorId: number | null;
  actorRole: string | null;
  createdAt: Date | string;
  originalTeacherRecommendation: unknown;
};

export type PromotionFinalDecision = {
  status: "PROMOTE" | "RETAIN";
  nextClass: string;
  nextSection: string;
};

export type PromotionFinalDecisionResolution =
  | {
      readiness: "ready";
      teacherRecommendation: PromotionFinalDecision;
      proposal: PromotionFinalDecisionProposal | null;
      finalDecision: PromotionFinalDecision;
      overrideApplied: boolean;
    }
  | {
      readiness: "pending" | "blocked";
      code: string;
      message: string;
      teacherRecommendation: PromotionFinalDecision | null;
      proposal: PromotionFinalDecisionProposal | null;
      finalDecision: null;
      overrideApplied: false;
    };

function decisionTimestamp(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return value === null ? null : null;
}

export function promotionTeacherRecommendationMatchesSnapshot(
  snapshot: unknown,
  decision: (NonNullable<PromotionOverrideCandidate["decision"]> & {
    lockedAt?: Date | string | null;
    processedByTeacherId?: number | null;
  }) | undefined,
): boolean {
  if (!snapshot || typeof snapshot !== "object" || !decision) return false;
  const saved = snapshot as Record<string, unknown>;
  return saved.decision === decision.decision
    && saved.targetClass === decision.targetClass
    && saved.targetSection === decision.targetSection
    && saved.autoSuggestion === decision.autoSuggestion
    && saved.manualIntervention === decision.manualIntervention
    && saved.locked === decision.locked
    && decisionTimestamp(saved.lockedAt) === decisionTimestamp(decision.lockedAt)
    && saved.processedByTeacherId === (decision.processedByTeacherId ?? null);
}

/**
 * The single server-side resolver shared by preview and transactional execution.
 * Legacy rows are diagnostic only: they never authorize an outcome, and an
 * inconsistent legacy row blocks an otherwise valid audited proposal.
 */
export function resolvePromotionFinalDecision(input: {
  sourceClass: string;
  sourceSection: string;
  resultStatus: "complete" | "incomplete" | undefined;
  promoted: boolean | null | undefined;
  decision: (NonNullable<PromotionOverrideCandidate["decision"]> & {
    lockedAt?: Date | string | null;
    processedByTeacherId?: number | null;
  }) | undefined;
  teacherIsValid: boolean;
  teacherTargetIsConfigured: boolean;
  overrideTargetIsConfigured: boolean;
  studentIsInSourceRoster: boolean;
  sessionIsActive: boolean;
  adminExecuted: boolean;
  proposal: PromotionFinalDecisionProposal | null;
  legacyOverride?: { overrideStatus: string; nextClass: string; nextSection: string } | null;
}): PromotionFinalDecisionResolution {
  const teacherCheck = checkLockedPromotionDecision({
    resultStatus: input.resultStatus,
    promoted: input.promoted,
    decision: input.decision,
    teacherIsValid: input.teacherIsValid,
    targetPlacementIsConfigured: input.teacherTargetIsConfigured,
    sourceClass: input.sourceClass,
    sourceSection: input.sourceSection,
  });
  const teacherRecommendation = input.decision
    && (input.decision.decision === "promoted" || input.decision.decision === "retained")
    ? {
        status: input.decision.decision === "promoted" ? "PROMOTE" as const : "RETAIN" as const,
        nextClass: input.decision.decision === "retained" ? input.sourceClass : input.decision.targetClass,
        nextSection: input.decision.decision === "retained" ? input.sourceSection : input.decision.targetSection,
      }
    : null;

  const blocked = (
    readiness: "pending" | "blocked",
    code: string,
    message: string,
  ): PromotionFinalDecisionResolution => ({
    readiness,
    code,
    message,
    teacherRecommendation,
    proposal: input.proposal,
    finalDecision: null,
    overrideApplied: false,
  });

  if (input.resultStatus !== "complete" || input.promoted === null || input.promoted === undefined) {
    return blocked("pending", "PROMOTION_RESULT_INCOMPLETE", "Complete applicable examination marks are required.");
  }
  if (!input.studentIsInSourceRoster) {
    return blocked("blocked", "PROMOTION_STUDENT_NOT_IN_SOURCE_ROSTER", "Student is not active in the exact source-session class and section.");
  }
  if (!input.sessionIsActive) {
    return blocked("blocked", "SESSION_NOT_WRITABLE", "Promotion execution requires the school's active Academic Session.");
  }
  if (!input.decision || input.decision.locked !== true) {
    return blocked("pending", "PROMOTION_DECISION_MISSING", "A valid locked Teacher recommendation is required.");
  }
  if (!teacherCheck.ok) {
    const readiness = teacherCheck.code === "PROMOTION_RESULT_INCOMPLETE"
      || (teacherCheck.code === "PROMOTION_DECISION_INVALID" && input.decision.locked !== true)
      ? "pending"
      : "blocked";
    return blocked(readiness, teacherCheck.code, teacherCheck.message);
  }
  if (input.adminExecuted) {
    return blocked("blocked", "PROMOTION_ALREADY_EXECUTED", "This Student already has an executed Promotion decision.");
  }
  if (!teacherRecommendation) {
    return blocked("blocked", "PROMOTION_DECISION_INVALID", "The locked Teacher recommendation is not Promote or Retain.");
  }
  if (!input.proposal) {
    return {
      readiness: "ready",
      teacherRecommendation,
      proposal: null,
      finalDecision: teacherRecommendation,
      overrideApplied: false,
    };
  }

  const proposal = input.proposal;
  if (
    !Number.isSafeInteger(proposal.eventId) || proposal.eventId <= 0 ||
    !Number.isSafeInteger(proposal.actorId) || (proposal.actorId ?? 0) <= 0 ||
    (proposal.actorRole !== "admin" && proposal.actorRole !== "support_staff") ||
    !(proposal.createdAt instanceof Date || typeof proposal.createdAt === "string") ||
    Number.isNaN(new Date(proposal.createdAt).getTime())
  ) {
    return blocked("blocked", "PROMOTION_OVERRIDE_EVENT_INVALID", "The saved proposal is missing valid audit actor or event evidence.");
  }
  let reason: string;
  try {
    reason = requirePromotionOverrideReason(proposal.reason);
  } catch {
    return blocked("blocked", "PROMOTION_OVERRIDE_EVENT_INVALID", "The saved proposal is missing its required reason.");
  }
  if (!reason || !promotionTeacherRecommendationMatchesSnapshot(proposal.originalTeacherRecommendation, input.decision)) {
    return blocked("blocked", "PROMOTION_OVERRIDE_STALE", "The saved proposal no longer matches the current locked Teacher recommendation. Review and save it again.");
  }
  if (
    input.legacyOverride &&
    (input.legacyOverride.overrideStatus !== proposal.status
      || input.legacyOverride.nextClass !== proposal.nextClass
      || input.legacyOverride.nextSection !== proposal.nextSection)
  ) {
    return blocked("blocked", "PROMOTION_OVERRIDE_LEGACY_CONFLICT", "A legacy override conflicts with the audited proposal. Resolve the conflict before execution.");
  }
  try {
    validatePromotionOverrideCandidate({
      status: proposal.status,
      nextClass: proposal.nextClass,
      nextSection: proposal.nextSection,
      sourceClass: input.sourceClass,
      sourceSection: input.sourceSection,
      resultStatus: input.resultStatus,
      promoted: input.promoted,
      decision: input.decision,
      teacherIsValid: input.teacherIsValid,
      teacherTargetIsConfigured: input.teacherTargetIsConfigured,
      overrideTargetIsConfigured: input.overrideTargetIsConfigured,
      studentIsInSourceRoster: input.studentIsInSourceRoster,
      sessionIsActive: input.sessionIsActive,
      adminExecuted: input.adminExecuted,
    });
  } catch (error) {
    return blocked(
      "blocked",
      error instanceof PromotionStage1Error ? error.code : "PROMOTION_OVERRIDE_INVALID",
      error instanceof Error ? error.message : "The saved proposal is no longer valid.",
    );
  }
  return {
    readiness: "ready",
    teacherRecommendation,
    proposal: { ...proposal, reason },
    finalDecision: {
      status: proposal.status as "PROMOTE" | "RETAIN",
      nextClass: proposal.nextClass,
      nextSection: proposal.nextSection,
    },
    overrideApplied: true,
  };
}
