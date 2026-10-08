import {
  PromotionStage1Error,
  resolvePromotionTermComponents,
} from "./promotion-stage1";

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export interface TeacherExamMarksSubmission {
  className?: string;
  section?: string;
  subject: string;
  examType: string;
  totalMarks: number;
  scores: Array<{
    studentId: number;
    marks: number;
    isAbsent: boolean;
  }>;
}

export type TeacherExamMarksSubmissionResult =
  | { ok: true; data: TeacherExamMarksSubmission }
  | { ok: false; message: string };

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveIntegerInput(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= POSTGRES_INTEGER_MAX
    ? number
    : null;
}

function integerInput(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= POSTGRES_INTEGER_MAX
    ? number
    : null;
}

function optionalScopeName(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= maxLength ? normalized : null;
}

export function parseTeacherExamMarksSubmission(raw: unknown): TeacherExamMarksSubmissionResult {
  const body = recordOf(raw);
  if (!body) return { ok: false, message: "Examination score details are required." };

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const examType = typeof body.examType === "string" ? body.examType.trim() : "";
  if (!subject || subject.length > 100 || !examType || examType.length > 100) {
    return { ok: false, message: "A valid configured subject and examination type are required." };
  }

  const className = optionalScopeName(body.class, 80);
  const section = optionalScopeName(body.section, 40);
  if (className === null || section === null) {
    return { ok: false, message: "Class and section must be valid text values." };
  }

  const totalMarks = positiveIntegerInput(body.totalMarks);
  if (totalMarks === null) {
    return { ok: false, message: "Total marks must be a positive whole number." };
  }
  if (!Array.isArray(body.scores) || body.scores.length === 0) {
    return { ok: false, message: "At least one Student score is required." };
  }

  const seenStudentIds = new Set<number>();
  const scores: TeacherExamMarksSubmission["scores"] = [];
  for (const rawScore of body.scores) {
    const score = recordOf(rawScore);
    if (!score) return { ok: false, message: "Every score entry must be an object." };

    const studentId = positiveIntegerInput(score.studentId);
    if (studentId === null || seenStudentIds.has(studentId)) {
      return { ok: false, message: "Student IDs must be valid and unique within the score batch." };
    }
    seenStudentIds.add(studentId);

    if (typeof score.isAbsent !== "boolean") {
      return { ok: false, message: "Each score must explicitly identify whether the Student was absent." };
    }

    const marks = score.isAbsent ? integerInput(score.marks ?? 0) : integerInput(score.marks);
    if (marks === null) {
      return {
        ok: false,
        message: score.isAbsent
          ? "Absent scores must use zero marks."
          : "Marks are required; a missing mark cannot be saved as zero.",
      };
    }
    if (score.isAbsent && marks !== 0) {
      return { ok: false, message: "Absent scores must use zero marks and remain marked Absent." };
    }
    if (!score.isAbsent && marks > totalMarks) {
      return { ok: false, message: "Marks cannot exceed the total marks." };
    }

    scores.push({ studentId, marks, isAbsent: score.isAbsent });
  }

  return {
    ok: true,
    data: {
      ...(className === undefined ? {} : { className }),
      ...(section === undefined ? {} : { section }),
      subject,
      examType,
      totalMarks,
      scores,
    },
  };
}

function normalizedClassName(value: string): string {
  return value.trim().toLowerCase().replace(/^class\s+/, "");
}

export function configuredClassName(
  configuredClasses: string[],
  classConfigMap: Record<string, unknown>,
  requested: string,
): string | undefined {
  const normalizedRequested = normalizedClassName(requested);
  const globalMatches = configuredClasses.filter(value =>
    typeof value === "string" && normalizedClassName(value) === normalizedRequested
  );
  const candidates = globalMatches.length > 0
    ? globalMatches
    : Object.keys(classConfigMap).filter(value => normalizedClassName(value) === normalizedRequested);
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function classScopedConfigValues(
  map: Record<string, unknown>,
  className: string,
): string[] | null {
  const normalizedClassName = className.trim().toLowerCase().replace(/^class\s+/, "");
  const matches = Object.entries(map).filter(([key]) =>
    key.trim().toLowerCase().replace(/^class\s+/, "") === normalizedClassName
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1 || !Array.isArray(matches[0][1])) return [];
  return matches[0][1]
    .filter((value): value is string => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean);
}

export function configuredName(values: string[], requested: string): string | undefined {
  const normalized = requested.trim().toLowerCase();
  return values.find(value => value.trim().toLowerCase() === normalized);
}

export function publicationStateForExamScore(
  published: boolean | undefined,
): { published?: boolean } {
  return published === undefined ? {} : { published };
}

function parseConfigObject(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw new PromotionStage1Error(
      `Cannot verify locked-ledger impact because the configured ${label} is invalid.`,
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }
  const record = recordOf(parsed);
  if (!record) {
    throw new PromotionStage1Error(
      `Cannot verify locked-ledger impact because the configured ${label} is invalid.`,
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }
  return record;
}

function configuredRuleTerms(rule1: Record<string, unknown>): Array<{ term: string; failCount: number }> {
  if (rule1.enabled !== undefined && typeof rule1.enabled !== "boolean") {
    throw new PromotionStage1Error(
      "Cannot verify locked-ledger impact because the configured failed-subject rule is invalid.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }
  if (rule1.enabled === false) return [];
  if (Array.isArray(rule1.rules)) {
    return rule1.rules.flatMap(rule => {
      const entry = recordOf(rule);
      if (!entry || typeof entry.term !== "string" || entry.term.trim() !== entry.term) {
        throw new PromotionStage1Error(
          "Cannot verify locked-ledger impact because the configured failed-subject rule is invalid.",
          409,
          "PROMOTION_TERM_POLICY_INVALID",
        );
      }
      const term = entry.term.trim();
      const failCount = Number(entry.fail_count);
      if (!term || !Number.isFinite(failCount) || !Number.isInteger(failCount) || failCount < 0) {
        throw new PromotionStage1Error(
          "Cannot verify locked-ledger impact because the configured failed-subject rule is invalid.",
          409,
          "PROMOTION_TERM_POLICY_INVALID",
        );
      }
      return failCount > 0 ? [{ term, failCount }] : [];
    });
  }
  if (rule1.rules !== undefined && !Array.isArray(rule1.rules)) {
    throw new PromotionStage1Error(
      "Cannot verify locked-ledger impact because the configured failed-subject rule is invalid.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }
  if (rule1.term !== undefined || rule1.max_fails !== undefined) {
    if (typeof rule1.term !== "string" || rule1.term.trim() !== rule1.term) {
      throw new PromotionStage1Error(
        "Cannot verify locked-ledger impact because the configured failed-subject rule is invalid.",
        409,
        "PROMOTION_TERM_POLICY_INVALID",
      );
    }
    const term = rule1.term.trim();
    const failCount = Number(rule1.max_fails);
    if (!term || !Number.isFinite(failCount) || !Number.isInteger(failCount) || failCount < 0) {
      throw new PromotionStage1Error(
        "Cannot verify locked-ledger impact because the configured failed-subject rule is invalid.",
        409,
        "PROMOTION_TERM_POLICY_INVALID",
      );
    }
    return failCount > 0 ? [{ term, failCount }] : [];
  }
  if (rule1.enabled === true) {
    throw new PromotionStage1Error(
      "Cannot verify locked-ledger impact because the configured failed-subject rule is invalid.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }
  return [];
}

/** Whether a changed exam component can affect a specific locked decision term. */
export function examTypeAffectsLockedPromotionTerm(input: {
  examWeights: string;
  promotionFailRules: string;
  resultsConfig: string;
  examType: string;
  lockedTerm: string;
}): boolean {
  const weights = parseConfigObject(input.examWeights, "examination-term policy");
  const rules = parseConfigObject(input.promotionFailRules, "Promotion rules");
  const results = parseConfigObject(input.resultsConfig, "examination results policy");

  const lockedTerm = input.lockedTerm.trim();
  if (!lockedTerm || lockedTerm !== input.lockedTerm) {
    throw new PromotionStage1Error(
      "Cannot verify locked-ledger impact because the locked term key is invalid.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }

  const relevantSourceTerms = new Set<string>([lockedTerm]);
  if (rules.rule1 !== undefined && rules.rule1 !== null && !recordOf(rules.rule1)) {
    throw new PromotionStage1Error(
      "Cannot verify locked-ledger impact because the configured failed-subject rule is invalid.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }
  const rule1 = recordOf(rules.rule1) ?? {};
  // The existing failed-subject rule can inspect a prior term while evaluating
  // a different current ledger term, so those configured dependencies count.
  for (const rule of configuredRuleTerms(rule1)) {
    relevantSourceTerms.add(rule.term);
  }

  // Cumulative promotion can depend on weighted results from earlier terms.
  if (results.cumulative !== undefined && results.cumulative !== null && !recordOf(results.cumulative)) {
    throw new PromotionStage1Error(
      "Cannot verify locked-ledger impact because the cumulative examination policy is invalid.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }
  const cumulative = recordOf(results.cumulative);
  if (
    cumulative?.enabled === true &&
    cumulative.promotionEnabled === true &&
    typeof cumulative.triggerTerm === "string" &&
    cumulative.triggerTerm.trim() === lockedTerm
  ) {
    const termWeights = recordOf(cumulative.termWeights);
    if (!termWeights) {
      throw new PromotionStage1Error(
        "Cannot verify locked-ledger impact because the cumulative examination policy is invalid.",
        409,
        "PROMOTION_TERM_POLICY_INVALID",
      );
    }
    for (const [term, rawWeight] of Object.entries(termWeights)) {
      const weight = Number(rawWeight);
      if (!Number.isFinite(weight)) {
        throw new PromotionStage1Error(
          "Cannot verify locked-ledger impact because a cumulative term weight is invalid.",
          409,
          "PROMOTION_TERM_POLICY_INVALID",
        );
      }
      if (weight !== 0 && term.trim()) relevantSourceTerms.add(term.trim());
    }
  }

  for (const term of relevantSourceTerms) {
    const normalizedMatches = Object.keys(weights).filter(key => key.trim() === term);
    if (normalizedMatches.length !== 1 || normalizedMatches[0] !== term) {
      throw new PromotionStage1Error(
        `Cannot verify locked-ledger impact because the configured ${term} term is missing or ambiguous.`,
        409,
        "PROMOTION_TERM_POLICY_INVALID",
      );
    }
    const components = resolvePromotionTermComponents(input.examWeights, term);
    if (components.some(component => component.sourceExam === input.examType)) return true;
  }

  return false;
}
