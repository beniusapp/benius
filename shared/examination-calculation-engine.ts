/**
 * Pure, caller-supplied examination calculation rules.  The boundary context is
 * carried with every result so callers cannot accidentally treat a calculation
 * from another school or academic session as interchangeable.
 */
export interface ExaminationCalculationContext {
  schoolId: number;
  sessionId: number | null;
}

export interface ExaminationScore {
  subject: string;
  examType: string;
  marks: number;
  totalMarks: number;
  isAbsent: boolean;
}

export interface ExaminationStudent {
  studentId: number;
  name: string;
  digitalStudentId: string;
  rollNumber: number | null;
  scores: ExaminationScore[];
}

export interface ExaminationAttendance {
  studentId: number;
  attendancePct: number | null;
  presentDays: number;
  totalDays: number;
}

export interface ExaminationPolicy {
  schoolId: number;
  examWeights: string;
  promotionFailRules: string;
  resultsConfig?: string;
}

/** The tenant identity of the class grading tier selected by the server. */
export interface ExaminationGradingPolicy {
  schoolId: number;
}

export interface TermAverageRule {
  enabled: boolean;
  minPct: number;
}

export type CumulativeConfig = {
  enabled: boolean;
  triggerTerm: string;
  termWeights: Record<string, number>;
  promotionEnabled?: boolean;
  minPercent?: number;
} | null;

export interface GradingRule {
  id: number;
  tierId: number;
  gradeLabel: string;
  minPercent: number;
  maxPercent: number;
  remarks: string | null;
  sortOrder: number;
}

export interface ExaminationCalculationInput {
  context: ExaminationCalculationContext;
  students: ExaminationStudent[];
  policy: ExaminationPolicy;
  attendance: ExaminationAttendance[];
  passPercentage: number;
  gradingPolicy: ExaminationGradingPolicy;
  gradingRules: GradingRule[];
  termAverageRule?: TermAverageRule;
  currentTerm?: string;
  cumulativeConfig?: CumulativeConfig;
}

export interface ComponentBreakdown {
  sourceExam: string;
  weight: number;
  marks: number | null;
  totalMarks: number | null;
  isAbsent: boolean;
  pct: number | null;
  contribution: number | null;
  status: "scored" | "absent" | "missing";
}

export interface SubjectTermResult {
  subject: string;
  percentage: number | null;
  passed: boolean | null;
  grade: ComputedGrade | null;
  breakdown: ComponentBreakdown[];
  status: "scored" | "absent" | "incomplete";
}

export interface ComputedStudentResult {
  schoolId: number;
  sessionId: number | null;
  studentId: number;
  name: string;
  digitalStudentId: string;
  rollNumber: number | null;
  termResults: Record<string, SubjectTermResult[]>;
  termAverages: Record<string, number | null>;
  cumulativePercentage: number | null;
  allTermFailCounts: Record<string, number>;
  attendancePct: number | null;
  promoted: boolean;
  promotionReason: string;
  detentionViolations: string[];
}

export interface ComputedGrade {
  label: string;
  remarks: string | null;
}

export interface PromotionRuleEvaluationInput {
  context: ExaminationCalculationContext;
  policySchoolId: number;
  maxFailedSubjectRules?: Array<{ term: string; failCount: number }>;
  attendanceRules?: Array<{ term: string; minPercent: number }>;
  termAverageRule?: TermAverageRule;
  cumulativeRule?: {
    enabled: boolean;
    triggerTerm: string;
    minPercent: number;
  };
  termFailCounts: Record<string, number>;
  termAverages: Record<string, number | null>;
  attendancePct: number | null;
  attendanceByTerm?: Record<string, number | null>;
  currentTerm?: string;
  cumulativePercentage: number | null;
  termResults?: Record<string, SubjectTermResult[]>;
}

export interface PromotionRuleEvaluationResult {
  promoted: boolean;
  promotionReason: string;
  violations: string[];
}

function requirePercentage(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a configured percentage between 0 and 100.`);
  }
}

/**
 * Authoritative interpretation of the four existing promotion rules.
 * A failed-subject threshold is a retention trigger (fails >= N); percentage
 * minimums are inclusive eligibility boundaries (value < minimum is retained).
 */
export function evaluatePromotionRules(input: PromotionRuleEvaluationInput): PromotionRuleEvaluationResult {
  if (input.policySchoolId !== input.context.schoolId) {
    throw new Error(`Promotion policy school ${input.policySchoolId} does not match calculation school ${input.context.schoolId}.`);
  }

  const activeRuleCount =
    (input.maxFailedSubjectRules ? 1 : 0) +
    (input.attendanceRules ? 1 : 0) +
    (input.termAverageRule?.enabled ? 1 : 0) +
    (input.cumulativeRule?.enabled ? 1 : 0);
  if (activeRuleCount === 0) {
    throw new Error("At least one configured promotion rule is required.");
  }

  const violations: string[] = [];
  if (input.maxFailedSubjectRules) {
    if (input.maxFailedSubjectRules.length === 0) throw new Error("The enabled failed-subject promotion rule requires at least one term threshold.");
    for (const rule of input.maxFailedSubjectRules) {
      if (!rule.term.trim() || !Number.isInteger(rule.failCount) || rule.failCount < 0) {
        throw new Error("Each failed-subject promotion rule requires a term and a non-negative integer threshold.");
      }
      const fails = input.termFailCounts[rule.term];
      if (fails === undefined) continue;
      if (fails >= rule.failCount) {
        const failedNames = (input.termResults?.[rule.term] ?? []).filter(s => s.passed === false).map(s => s.subject);
        const nameList = failedNames.length > 0 ? ` (${failedNames.join(", ")})` : "";
        violations.push(`The student failed ${fails} subject${fails !== 1 ? "s" : ""}${nameList} in ${rule.term}, meeting the school's retention threshold of ${rule.failCount} failed subject${rule.failCount !== 1 ? "s" : ""}.`);
      }
    }
  }

  if (input.attendanceRules) {
    if (input.attendanceRules.length === 0) throw new Error("The enabled attendance promotion rule requires at least one term threshold.");
    for (const rule of input.attendanceRules) {
      if (!rule.term.trim()) throw new Error("Each attendance promotion rule requires a term.");
      requirePercentage(rule.minPercent, "The attendance promotion threshold");
      const attendance = input.attendanceByTerm?.[rule.term] ?? input.attendancePct;
      if (attendance !== null && attendance !== undefined && attendance < rule.minPercent) {
        violations.push(`The student achieved an attendance rate of ${attendance.toFixed(1)}% in ${rule.term}, falling below the required minimum threshold of ${rule.minPercent}%.`);
        break;
      }
    }
  }

  if (input.termAverageRule?.enabled) {
    requirePercentage(input.termAverageRule.minPct, "The term-average promotion threshold");
    if (input.currentTerm) {
      const average = input.termAverages[input.currentTerm];
      if (average !== null && average !== undefined && average < input.termAverageRule.minPct) {
        violations.push(`The student's weighted average score for ${input.currentTerm} was ${average}%, which falls below the configured pass threshold of ${input.termAverageRule.minPct}%.`);
      }
    }
  }

  if (input.cumulativeRule?.enabled) {
    if (!input.cumulativeRule.triggerTerm.trim()) throw new Error("The enabled cumulative promotion rule requires a trigger term.");
    requirePercentage(input.cumulativeRule.minPercent, "The cumulative promotion threshold");
    if (
      input.currentTerm?.trim() === input.cumulativeRule.triggerTerm.trim() &&
      input.cumulativePercentage !== null &&
      input.cumulativePercentage < input.cumulativeRule.minPercent
    ) {
      violations.push(`The student's cumulative year-end percentage of ${input.cumulativePercentage}% falls below the required minimum threshold of ${input.cumulativeRule.minPercent}%.`);
    }
  }

  return {
    promoted: violations.length === 0,
    promotionReason: violations[0] ?? "Meets all promotion criteria.",
    violations,
  };
}

/** Calculates all supplied students without fetching policy or tenant state. */
export function computeAllStudentResults(input: ExaminationCalculationInput): ComputedStudentResult[] {
  const { context, students, policy, attendance, passPercentage, gradingPolicy, termAverageRule, currentTerm, cumulativeConfig } = input;
  if (policy.schoolId !== context.schoolId) {
    throw new Error(`Examination policy school ${policy.schoolId} does not match calculation school ${context.schoolId}.`);
  }
  if (!gradingPolicy || gradingPolicy.schoolId !== context.schoolId) {
    throw new Error(`Grading policy school ${gradingPolicy?.schoolId ?? "missing"} does not match calculation school ${context.schoolId}.`);
  }
  if (!Number.isFinite(passPercentage) || passPercentage < 0 || passPercentage > 100) {
    throw new Error("A configured examination pass percentage between 0 and 100 is required.");
  }
  validateGradingRules(input.gradingRules);
  let rawWeights: Record<string, { source_exam: string; weight: number }[]> = {};
  let rules: any = {};
  try { rawWeights = JSON.parse(policy.examWeights || "{}"); } catch {}
  try { rules = JSON.parse(policy.promotionFailRules || "{}"); } catch {}

  const weights: Record<string, { source_exam: string; weight: number }[]> = {};
  for (const [k, v] of Object.entries(rawWeights)) weights[k.trim()] = v;
  const termNames = Object.keys(weights);
  const attendanceMap = new Map(attendance.map(a => [a.studentId, a]));

  return students.map(student => {
    const bySubject: Record<string, ExaminationScore[]> = {};
    for (const sc of student.scores) (bySubject[sc.subject] ??= []).push(sc);
    const termResults: Record<string, SubjectTermResult[]> = {};
    const allTermFailCounts: Record<string, number> = {};

    for (const termName of termNames) {
      const subjectResults: SubjectTermResult[] = [];
      for (const subject of Object.keys(bySubject)) {
        const subjectScores = bySubject[subject];
        let weightedSum = 0, totalWeight = 0, hasAbsent = false, hasData = false;
        const breakdown: ComponentBreakdown[] = [];
        for (const comp of weights[termName] || []) {
          const record = subjectScores.find(s => s.examType === comp.source_exam);
          if (!record) {
            breakdown.push({ sourceExam: comp.source_exam, weight: comp.weight, marks: null, totalMarks: null, isAbsent: false, pct: null, contribution: null, status: "missing" });
            continue;
          }
          hasData = true;
          if (record.isAbsent) {
            hasAbsent = true;
            breakdown.push({ sourceExam: comp.source_exam, weight: comp.weight, marks: 0, totalMarks: record.totalMarks, isAbsent: true, pct: null, contribution: null, status: "absent" });
            continue;
          }
          const pct = record.totalMarks > 0 ? (record.marks / record.totalMarks) * 100 : 0;
          const contribution = pct * (comp.weight / 100);
          weightedSum += contribution;
          totalWeight += comp.weight;
          breakdown.push({ sourceExam: comp.source_exam, weight: comp.weight, marks: record.marks, totalMarks: record.totalMarks, isAbsent: false, pct, contribution, status: "scored" });
        }
        let percentage: number | null = null, passed: boolean | null = null;
        let status: SubjectTermResult["status"] = "incomplete";
        if (!hasData) status = "incomplete";
        else if (hasAbsent) { status = "absent"; percentage = 0; passed = false; }
        else {
          const ep = totalWeight > 0 ? (weightedSum * 100) / totalWeight : 0;
          percentage = Math.round(ep * 10) / 10;
          passed = ep >= passPercentage;
          status = "scored";
        }
        subjectResults.push({
          subject, percentage, passed,
          grade: percentage === null ? null : selectGrade(percentage, input.gradingRules),
          breakdown, status,
        });
      }
      termResults[termName] = subjectResults;
      allTermFailCounts[termName] = subjectResults.filter(s => s.passed === false).length;
    }
    const termAverages: Record<string, number | null> = {};
    for (const termName of termNames) {
      const scored = (termResults[termName] ?? []).filter(s => s.status === "scored");
      termAverages[termName] = scored.length > 0
        ? Math.round((scored.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / scored.length) * 10) / 10
        : null;
    }
    let cumulativePercentage: number | null = null;
    if (cumulativeConfig?.enabled) {
      const entries = Object.entries(cumulativeConfig.termWeights ?? {});
      let totalContrib = 0, allHaveData = entries.length > 0;
      for (const [termName, weight] of entries) {
        const average = termAverages[termName.trim()];
        if (average === null || average === undefined) { allHaveData = false; break; }
        totalContrib += average * (Number(weight) / 100);
      }
      if (allHaveData) cumulativePercentage = Math.round(totalContrib * 10) / 10;
    }

    const rule1 = rules.rule1 ?? {};
    const ruleAtt = rules.rule_attendance ?? {};
    const attPct = attendanceMap.get(student.studentId)?.attendancePct ?? null;
    const maxFailedSubjectRules = rule1.enabled === false ? undefined
      : Array.isArray(rule1.rules) && rule1.rules.length > 0
        ? (rule1.rules as any[]).map(r => ({ term: String(r.term ?? "").trim(), failCount: Number(r.fail_count) }))
        : rule1.term && rule1.max_fails !== undefined
          ? [{ term: String(rule1.term).trim(), failCount: Number(rule1.max_fails) }]
          : undefined;
    const attendanceRules = ruleAtt.enabled === true
      ? (Array.isArray(ruleAtt.rules) ? (ruleAtt.rules as any[]).map(r => ({
          term: String(r.term ?? "").trim(), minPercent: Number(r.min_pct),
        })) : [])
      : undefined;
    const promotion = evaluatePromotionRules({
      context,
      policySchoolId: policy.schoolId,
      maxFailedSubjectRules,
      attendanceRules,
      termAverageRule,
      cumulativeRule: cumulativeConfig?.promotionEnabled ? {
        enabled: true,
        triggerTerm: cumulativeConfig.triggerTerm,
        minPercent: Number(cumulativeConfig.minPercent),
      } : undefined,
      termFailCounts: allTermFailCounts,
      termAverages,
      attendancePct: attPct,
      currentTerm,
      cumulativePercentage,
      termResults,
    });
    return {
      schoolId: context.schoolId, sessionId: context.sessionId,
      studentId: student.studentId, name: student.name, digitalStudentId: student.digitalStudentId, rollNumber: student.rollNumber,
      termResults, termAverages, cumulativePercentage, allTermFailCounts, attendancePct: attPct,
      promoted: promotion.promoted,
      promotionReason: promotion.promotionReason,
      detentionViolations: promotion.violations,
    };
  });
}

/**
 * Validates the persisted class-tier rules. Ranges are inclusive at both ends,
 * therefore equal endpoints across two rows are an overlap.
 */
export function validateGradingRules(rules: GradingRule[]): void {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error("A non-empty configured grading policy is required.");
  }
  for (const rule of rules) {
    if (
      !Number.isFinite(rule.minPercent) ||
      !Number.isInteger(rule.minPercent) ||
      !Number.isFinite(rule.maxPercent) ||
      !Number.isInteger(rule.maxPercent) ||
      rule.minPercent < 0 ||
      rule.maxPercent > 100 ||
      rule.minPercent >= rule.maxPercent
    ) {
      throw new Error("Configured grading rules must use integer min/max percentages from 0 to 100 with min less than max.");
    }
  }
  const sorted = [...rules].sort((a, b) => a.minPercent - b.minPercent);
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].minPercent <= sorted[index - 1].maxPercent) {
      throw new Error("Configured grading rule ranges must not overlap.");
    }
    if (sorted[index].minPercent > sorted[index - 1].maxPercent + 1) {
      throw new Error("Configured grading rule ranges must not contain gaps.");
    }
  }
}

/**
 * The authoritative, pure grade selector. It never supplies a default scale:
 * a percentage outside an intentionally configured range is a policy error.
 */
export function selectGrade(pct: number, rules: GradingRule[]): ComputedGrade {
  validateGradingRules(rules);
  if (!Number.isFinite(pct)) {
    throw new Error("A finite percentage is required to select a configured grade.");
  }
  const match = rules.find(rule => pct >= rule.minPercent && pct <= rule.maxPercent);
  if (!match) {
    throw new Error(`No configured grading rule matches percentage ${pct}.`);
  }
  return { label: match.gradeLabel, remarks: match.remarks };
}

/** @deprecated Use selectGrade for authoritative configured grade selection. */
export function computeGrade(pct: number, rules: GradingRule[]): ComputedGrade {
  return selectGrade(pct, rules);
}