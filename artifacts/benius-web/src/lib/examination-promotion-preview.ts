export type ExaminationResultStatus = "complete" | "incomplete";

export function reportCardAverage(
  resultStatus: ExaminationResultStatus,
  average: number | null,
): number | null {
  return resultStatus === "complete" ? average : null;
}

export function reportCardFailureCount(
  resultStatus: ExaminationResultStatus,
  count: number,
): number | null {
  return resultStatus === "complete" ? count : null;
}

export type PromotionReadiness =
  | "ready"
  | "pending"
  | "ineligible"
  | "historical"
  | "executed";

export type PromotionPreviewOutcome =
  | "promoted"
  | "retained"
  | "grace_pass"
  | "pending"
  | "review"
  | "historical";

export interface PromotionPreviewInput {
  resultStatus: ExaminationResultStatus;
  readiness: PromotionReadiness;
  override?: {
    status: "promote" | "retain" | "grace_pass";
    nextClass: string;
    nextSection: string;
  };
  ledgerDecision?: {
    decision: string;
    targetClass: string;
    targetSection: string;
  } | null;
  sourceClass: string;
  sourceSection: string;
}

export interface PromotionPreview {
  outcome: PromotionPreviewOutcome;
  destination: { className: string; sectionName: string } | null;
}

export function getPromotionPreview(input: PromotionPreviewInput): PromotionPreview {
  if (input.resultStatus === "incomplete" || input.readiness === "pending") {
    return { outcome: "pending", destination: null };
  }
  if (input.readiness === "ineligible") {
    return { outcome: "review", destination: null };
  }
  if (input.readiness === "historical") {
    return { outcome: "historical", destination: null };
  }

  let outcome: "promoted" | "retained" | "grace_pass";
  if (input.override) {
    outcome = input.override.status === "promote"
      ? "promoted"
      : input.override.status === "retain" ? "retained" : "grace_pass";
  } else if (input.ledgerDecision?.decision === "retained") {
    outcome = "retained";
  } else if (input.ledgerDecision?.decision === "promoted") {
    outcome = "promoted";
  } else {
    return { outcome: "pending", destination: null };
  }

  if (outcome === "retained") {
    return {
      outcome,
      destination: {
        className: input.override?.nextClass ?? input.sourceClass,
        sectionName: input.override?.nextSection ?? input.sourceSection,
      },
    };
  }
  if (input.override) {
    return {
      outcome,
      destination: {
        className: input.override.nextClass,
        sectionName: input.override.nextSection,
      },
    };
  }
  if (!input.ledgerDecision) return { outcome: "pending", destination: null };
  return {
    outcome,
    destination: {
      className: input.ledgerDecision.targetClass,
      sectionName: input.ledgerDecision.targetSection,
    },
  };
}

export function summarizePromotionPreviews(previews: PromotionPreview[]) {
  return previews.reduce((counts, preview) => {
    counts[preview.outcome]++;
    return counts;
  }, {
    promoted: 0,
    retained: 0,
    grace_pass: 0,
    pending: 0,
    review: 0,
    historical: 0,
  });
}
