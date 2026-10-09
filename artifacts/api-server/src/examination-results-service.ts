import {
  computeAllStudentResults,
  selectGrade,
  type ComputedGrade,
  type ComputedStudentResult,
  type ExaminationAttendance,
  type ExaminationStudent,
  type ExaminationScore,
  type GradingRule,
  type SubjectTermResult,
} from "./shared/examination-calculation-engine";
import { todayInIST } from "./shared/ist-time";
import { parseStoredPromotionRules, storage } from "./storage";

export type ExaminationResultsStorage = Pick<typeof storage,
  | "getAcademicSessionForSchool"
  | "getExaminationResultsRosterForSession"
  | "getTeacherExamScoresByStudentInClassSession"
  | "getStudentAllExamScores"
  | "getClassSubjectsMap"
  | "getExamPolicyTiers"
  | "resolveClassPassPolicy"
  | "getGradingRules"
  | "getStudentAttendanceAggregatesForSessionClass"
>;

type TermComponent = { source_exam: string; weight: number };
type ResultStatus = "complete" | "incomplete";

export class ExaminationResultsError extends Error {
  constructor(message: string, readonly status: number = 409) {
    super(message);
    this.name = "ExaminationResultsError";
  }
}

export type ExaminationResultRecord = Omit<
  ComputedStudentResult,
  "termAverages" | "cumulativePercentage" | "allTermFailCounts" | "promoted"
> & {
  termAverages: Record<string, number | null>;
  termGrades: Record<string, ComputedGrade | null>;
  cumulativePercentage: number | null;
  cumulativeGrade: ComputedGrade | null;
  allTermFailCounts: Record<string, number | null>;
  resultStatus: ResultStatus;
  resultStatusByTerm: Record<string, ResultStatus>;
  promoted: boolean | null;
};

export interface ClassExaminationResultsResponse {
  schoolId: number;
  sessionId: number;
  className: string;
  sectionName: string;
  terms: string[];
  selectedTerm: string;
  promotionAssessmentAvailable: boolean;
  results: ExaminationResultRecord[];
}

export interface StudentExaminationResultView {
  studentId: number;
  termResults: Record<string, SubjectTermResult[]>;
  termAverages: Record<string, number | null>;
  termGrades: Record<string, ComputedGrade | null>;
  allTermFailCounts: Record<string, number | null>;
  resultStatusByTerm: Record<string, ResultStatus>;
  attendancePct: number | null;
}

export interface StudentExaminationResultsResponse {
  schoolId: number;
  sessionId: number;
  className: string;
  sectionName: string;
  terms: string[];
  result: StudentExaminationResultView;
}

interface CalculationContext {
  schoolId: number;
  sessionId: number;
  className: string;
  sectionName: string;
}

interface CalculationInput extends CalculationContext {
  policy: {
    schoolId: number;
    examWeights: string;
    promotionFailRules: string;
    resultsConfig: string;
  };
  students: ExaminationStudent[];
  configuredSubjects: string[];
  attendance: ExaminationAttendance[];
  passPercentage: number;
  gradingRules: GradingRule[];
  selectedTerm?: string;
  includePromotionAssessment: boolean;
}

function invalidConfiguration(message: string): never {
  throw new ExaminationResultsError(message, 409);
}

function parseTermWeights(raw: string): Record<string, TermComponent[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return invalidConfiguration("The configured examination weights are invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalidConfiguration("The configured examination weights are invalid.");
  }

  const weights: Record<string, TermComponent[]> = {};
  for (const [rawTerm, rawComponents] of Object.entries(parsed)) {
    const term = rawTerm.trim();
    if (!term || Object.hasOwn(weights, term) || !Array.isArray(rawComponents)) {
      return invalidConfiguration("The configured examination terms are invalid or ambiguous.");
    }
    const components = rawComponents.map((rawComponent): TermComponent => {
      if (!rawComponent || typeof rawComponent !== "object" || Array.isArray(rawComponent)) {
        return invalidConfiguration(`The examination components for ${term} are invalid.`);
      }
      const component = rawComponent as Record<string, unknown>;
      const source = typeof component.source_exam === "string" ? component.source_exam : "";
      const weight = Number(component.weight);
      if (!source.trim() || !Number.isFinite(weight)) {
        return invalidConfiguration(`The examination components for ${term} are invalid.`);
      }
      return { source_exam: source, weight };
    });
    weights[term] = components;
  }
  if (Object.keys(weights).length === 0) {
    return invalidConfiguration("No examination terms are configured for this class.");
  }
  return weights;
}

function normalizeClassKey(value: string): string {
  return value.trim().toLowerCase().replace(/^class\s+/, "");
}

function resolveConfiguredSubjects(classSubjects: Record<string, string[]>, className: string): string[] {
  const matches = Object.entries(classSubjects)
    .filter(([key]) => normalizeClassKey(key) === normalizeClassKey(className))
    .map(([, subjects]) => subjects);
  if (matches.length !== 1 || !Array.isArray(matches[0])) {
    return invalidConfiguration("A unique Class–Subject mapping is required to calculate examination results.");
  }
  const subjects = matches[0].map(subject => String(subject).trim()).filter(Boolean);
  if (subjects.length === 0 || new Set(subjects).size !== subjects.length) {
    return invalidConfiguration("A unique Class–Subject mapping is required to calculate examination results.");
  }
  return subjects;
}

function resolveExamPolicy(
  tiers: Awaited<ReturnType<typeof storage.getExamPolicyTiers>>,
  className: string,
) {
  const matching = tiers.filter(tier =>
    (tier.applicableClasses || []).some(value => String(value).trim() === className.trim())
  );
  if (matching.length !== 1) {
    return invalidConfiguration(
      matching.length === 0
        ? `No examination policy is configured for Class ${className}.`
        : `Multiple examination policies match Class ${className}.`,
    );
  }
  return matching[0];
}

type StoredResultScore = Awaited<ReturnType<ExaminationResultsStorage["getStudentAllExamScores"]>>[number];

function hasPromotionRulesConfigured(
  promotionRulesJson: string,
  termAverageRule: { enabled: boolean; minPct: number } | undefined,
  cumulativeConfig: { promotionEnabled?: boolean } | undefined,
): boolean {
  let rules: Record<string, any>;
  try {
    const parsed: unknown = JSON.parse(promotionRulesJson || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    rules = parsed as Record<string, any>;
  } catch {
    return false;
  }
  const maxFail = rules.rule1 ?? {};
  const hasMaxFailRule = maxFail.enabled !== false && (
    (Array.isArray(maxFail.rules) && maxFail.rules.length > 0) ||
    (maxFail.term && maxFail.max_fails !== undefined)
  );
  const attendance = rules.rule_attendance ?? {};
  const hasAttendanceRule = attendance.enabled === true &&
    Array.isArray(attendance.rules) && attendance.rules.length > 0;
  return Boolean(
    hasMaxFailRule ||
    hasAttendanceRule ||
    termAverageRule?.enabled ||
    cumulativeConfig?.promotionEnabled,
  );
}

function mapScore(score: StoredResultScore): ExaminationScore {
  return {
    subject: score.subject,
    examType: score.examType,
    marks: score.marks ?? 0,
    totalMarks: score.totalMarks ?? 100,
    isAbsent: score.isAbsent ?? false,
  };
}

function calculateResults(input: CalculationInput): {
  terms: string[];
  promotionAssessmentAvailable: boolean;
  results: ExaminationResultRecord[];
} {
  const examPolicy = {
    schoolId: input.policy.schoolId,
    examWeights: input.policy.examWeights,
    promotionFailRules: input.policy.promotionFailRules,
    resultsConfig: input.policy.resultsConfig,
  };
  const terms = Object.keys(parseTermWeights(examPolicy.examWeights));
  const { ruleTermAverage, cumulativeConfig } = parseStoredPromotionRules(
    examPolicy.promotionFailRules,
    examPolicy.resultsConfig,
  );
  // The shared engine requires at least one explicit promotion rule.
  // Keep no-rule cohorts calculable for academics without inventing a decision.
  const promotionAssessmentAvailable =
    input.includePromotionAssessment &&
    hasPromotionRulesConfigured(examPolicy.promotionFailRules, ruleTermAverage, cumulativeConfig);

  const computed = computeAllStudentResults({
    context: { schoolId: input.schoolId, sessionId: input.sessionId },
    students: input.students,
    policy: examPolicy,
    attendance: input.attendance,
    passPercentage: input.passPercentage,
    gradingPolicy: { schoolId: input.schoolId },
    gradingRules: input.gradingRules,
    termAverageRule: ruleTermAverage,
    currentTerm: input.selectedTerm,
    cumulativeConfig,
    includePromotionAssessment: promotionAssessmentAvailable,
  });

  const weights = parseTermWeights(examPolicy.examWeights);
  const results = computed.map(result => {
    const sourceStudent = input.students.find(student => student.studentId === result.studentId);
    const resultStatusByTerm: Record<string, ResultStatus> = {};
    for (const term of terms) {
      const termSubjects = result.termResults[term] ?? [];
      const hasApplicableMark = (weights[term] ?? []).some(component =>
        sourceStudent?.scores.some(score => score.examType === component.source_exam)
      );
      resultStatusByTerm[term] =
        hasApplicableMark &&
        termSubjects.length === input.configuredSubjects.length &&
        termSubjects.every(subject => subject.status !== "incomplete")
          ? "complete"
          : "incomplete";
    }

    const termAverages: Record<string, number | null> = {};
    const termGrades: Record<string, ComputedGrade | null> = {};
    const allTermFailCounts: Record<string, number | null> = {};
    for (const term of terms) {
      const complete = resultStatusByTerm[term] === "complete";
      const average = complete ? result.termAverages[term] ?? null : null;
      termAverages[term] = average;
      termGrades[term] = average === null ? null : selectGrade(average, input.gradingRules);
      allTermFailCounts[term] = complete ? result.allTermFailCounts[term] ?? 0 : null;
    }

    const selectedTermStatus = input.selectedTerm
      ? resultStatusByTerm[input.selectedTerm] ?? "incomplete"
      : result.resultStatus;
    const cumulativeTerms = Object.keys(cumulativeConfig?.termWeights ?? {}).map(term => term.trim());
    const cumulativeComplete = Boolean(
      cumulativeConfig?.enabled &&
      cumulativeTerms.length > 0 &&
      cumulativeTerms.every(term => resultStatusByTerm[term] === "complete"),
    );

    const cumulativePercentage = cumulativeComplete ? result.cumulativePercentage : null;
    return {
      ...result,
      termAverages,
      termGrades,
      allTermFailCounts,
      resultStatus: selectedTermStatus,
      resultStatusByTerm,
      cumulativePercentage,
      cumulativeGrade: cumulativePercentage === null
        ? null
        : selectGrade(cumulativePercentage, input.gradingRules),
      promoted: promotionAssessmentAvailable && selectedTermStatus === "complete" ? result.promoted : null,
      promotionReason: promotionAssessmentAvailable
        ? result.promotionReason
        : "Promotion assessment is not configured.",
      detentionViolations: promotionAssessmentAvailable ? result.detentionViolations : [],
    };
  });

  return { terms, promotionAssessmentAvailable, results };
}

function resultStudentsForConfiguredSubjects(
  scoreRows: StoredResultScore[],
  configuredSubjects: string[],
): ExaminationScore[] {
  const allowed = new Set(configuredSubjects);
  const scores = scoreRows
    .filter(score => allowed.has(score.subject.trim()))
    .map(mapScore);
  for (const subject of configuredSubjects) {
    if (!scores.some(score => score.subject.trim() === subject)) {
      scores.push({
        subject,
        examType: "__MISSING_APPLICABLE_SCORE__",
        marks: 0,
        totalMarks: 0,
        isAbsent: false,
      });
    }
  }
  return scores;
}

export async function getClassExaminationResults(
  context: CalculationContext & { selectedTerm: string },
  includePromotionAssessment: boolean,
  store: ExaminationResultsStorage = storage,
): Promise<ClassExaminationResultsResponse> {
  const session = await store.getAcademicSessionForSchool(context.sessionId, context.schoolId);
  if (!session) throw new ExaminationResultsError("Invalid academic session.", 403);
  const policy = resolveExamPolicy(await store.getExamPolicyTiers(context.schoolId), context.className);
  const weights = parseTermWeights(policy.examWeights);
  const selectedTerm = context.selectedTerm.trim();
  if (!selectedTerm || !Object.hasOwn(weights, selectedTerm)) {
    throw new ExaminationResultsError("The selected examination term is not configured for this class.", 400);
  }
  const configuredSubjects = resolveConfiguredSubjects(
    await store.getClassSubjectsMap(context.schoolId),
    context.className,
  );
  const gradingTier = await store.resolveClassPassPolicy(context.schoolId, context.className);
  if (!gradingTier) throw new ExaminationResultsError("No grading tier is configured for this class.", 409);
  const gradingRules = await store.getGradingRules(context.schoolId, gradingTier.id);

  const roster = await store.getExaminationResultsRosterForSession(
    context.schoolId,
    context.sessionId,
    context.className,
    context.sectionName,
  );
  const scoreRows = await Promise.all(roster.map(({ student }) =>
    store.getTeacherExamScoresByStudentInClassSession(
      student.id,
      context.schoolId,
      context.sessionId,
      context.className,
      context.sectionName,
    )
  ));
  const students: ExaminationStudent[] = roster.map(({ student, rollNumber }, index) => ({
    studentId: student.id,
    name: student.name,
    digitalStudentId: student.digitalStudentId,
    rollNumber,
    scores: resultStudentsForConfiguredSubjects(scoreRows[index] ?? [], configuredSubjects),
  }));

  const today = todayInIST();
  const endDate = session.endDate < today ? session.endDate : today;
  const attendanceRows = session.startDate <= endDate
    ? await store.getStudentAttendanceAggregatesForSessionClass(
        context.schoolId,
        context.sessionId,
        context.className,
        context.sectionName,
        session.startDate,
        endDate,
      )
    : [];
  const attendance: ExaminationAttendance[] = attendanceRows.map(({ student, aggregation }) => ({
    studentId: student.id,
    attendancePct: aggregation.applicableWorkingDays > 0 ? aggregation.percentage : null,
    presentDays: aggregation.weightedAttendance,
    totalDays: aggregation.applicableWorkingDays,
  }));

  const calculated = calculateResults({
    ...context,
    policy,
    students,
    configuredSubjects,
    attendance,
    passPercentage: gradingTier.passPercentage,
    gradingRules,
    selectedTerm,
    includePromotionAssessment,
  });
  return {
    schoolId: context.schoolId,
    sessionId: context.sessionId,
    className: context.className,
    sectionName: context.sectionName,
    terms: calculated.terms,
    selectedTerm,
    promotionAssessmentAvailable: calculated.promotionAssessmentAvailable,
    results: calculated.results,
  };
}

export async function getStudentExaminationResults(
  context: CalculationContext & {
    student: { id: number; name: string; digitalStudentId: string };
    rollNumber: number | null;
  },
  store: ExaminationResultsStorage = storage,
): Promise<StudentExaminationResultsResponse> {
  const session = await store.getAcademicSessionForSchool(context.sessionId, context.schoolId);
  if (!session) throw new ExaminationResultsError("Invalid academic session.", 403);
  const policy = resolveExamPolicy(await store.getExamPolicyTiers(context.schoolId), context.className);
  const configuredSubjects = resolveConfiguredSubjects(
    await store.getClassSubjectsMap(context.schoolId),
    context.className,
  );
  const gradingTier = await store.resolveClassPassPolicy(context.schoolId, context.className);
  if (!gradingTier) throw new ExaminationResultsError("No grading tier is configured for this class.", 409);
  const gradingRules = await store.getGradingRules(context.schoolId, gradingTier.id);
  const publishedScores = (await store.getStudentAllExamScores(
    context.schoolId,
    context.student.id,
    context.className,
    context.sessionId,
    context.sectionName,
  )).filter(score => score.published === true);
  const students: ExaminationStudent[] = [{
    studentId: context.student.id,
    name: context.student.name,
    digitalStudentId: context.student.digitalStudentId,
    rollNumber: context.rollNumber,
    scores: resultStudentsForConfiguredSubjects(publishedScores, configuredSubjects),
  }];
  const calculated = calculateResults({
    ...context,
    policy,
    students,
    configuredSubjects,
    attendance: [],
    passPercentage: gradingTier.passPercentage,
    gradingRules,
    includePromotionAssessment: false,
  });
  const studentResult = calculated.results[0];
  return {
    schoolId: context.schoolId,
    sessionId: context.sessionId,
    className: context.className,
    sectionName: context.sectionName,
    terms: calculated.terms,
    result: {
      studentId: studentResult.studentId,
      termResults: studentResult.termResults,
      termAverages: studentResult.termAverages,
      termGrades: studentResult.termGrades,
      allTermFailCounts: studentResult.allTermFailCounts,
      resultStatusByTerm: studentResult.resultStatusByTerm,
      attendancePct: studentResult.attendancePct,
    },
  };
}

export function examinationResultsErrorStatus(error: unknown): number {
  if (error instanceof ExaminationResultsError) return error.status;
  const status = Number((error as { status?: unknown; statusCode?: unknown } | null)?.status
    ?? (error as { statusCode?: unknown } | null)?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

export function examinationResultsErrorMessage(error: unknown): string {
  const status = examinationResultsErrorStatus(error);
  if (status === 500) return "Failed to calculate examination results.";
  return error instanceof Error ? error.message : "Examination results are unavailable.";
}
