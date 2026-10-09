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
  | "blocked"
  | "historical"
  | "executed";

export type PromotionPreviewOutcome =
  | "promoted"
  | "retained"
  | "grace_pass"
  | "executed"
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
  resolved?: {
    readiness: "ready" | "pending" | "blocked" | "historical" | "executed";
    finalDecision: {
      status: "PROMOTE" | "RETAIN" | null;
      nextClass: string;
      nextSection: string;
    } | null;
  };
  sourceClass: string;
  sourceSection: string;
}

export interface PromotionPreview {
  outcome: PromotionPreviewOutcome;
  destination: { className: string; sectionName: string } | null;
}

export function getPromotionPreview(input: PromotionPreviewInput): PromotionPreview {
  if (input.resolved) {
    if (input.resolved.readiness === "historical") {
      return { outcome: "historical", destination: null };
    }
    if (input.resolved.readiness === "pending" || !input.resolved.finalDecision) {
      return {
        outcome: input.resolved.readiness === "blocked" ? "review" : "pending",
        destination: null,
      };
    }
    const destination = {
      className: input.resolved.finalDecision.nextClass,
      sectionName: input.resolved.finalDecision.nextSection,
    };
    if (input.resolved.readiness === "executed") {
      return { outcome: "executed", destination };
    }
    return {
      outcome: input.resolved.finalDecision.status === "RETAIN" ? "retained" : "promoted",
      destination,
    };
  }
  if (input.resultStatus === "incomplete" || input.readiness === "pending") {
    return { outcome: "pending", destination: null };
  }
  if (input.readiness === "ineligible" || input.readiness === "blocked") {
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
    executed: 0,
    pending: 0,
    review: 0,
    historical: 0,
  });
}
