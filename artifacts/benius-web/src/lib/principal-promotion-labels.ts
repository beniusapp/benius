export type PrincipalPromotionEntry = {
  decision: "promoted" | "retained";
  adminExecuted?: boolean;
};

export function getPrincipalPromotionLabels(entry?: PrincipalPromotionEntry) {
  const hasDecision = entry !== undefined;
  const isFinal = hasDecision && entry.adminExecuted === true;

  return {
    isFinal,
    recommendationPrefix: hasDecision ? "Teacher Recommended" : "Pending Teacher Recommendation",
    principalPrefix: isFinal ? "Principal Final" : null,
    principalStatus: isFinal ? "Principal Final Decision" : "Pending Principal Decision",
    reportPrefix: !hasDecision
      ? "Pending Teacher Recommendation"
      : isFinal ? "Principal Final" : "Teacher Recommended",
    badgePrefix: !hasDecision ? null : isFinal ? "FINAL" : "RECOMMEND",
  };
}
