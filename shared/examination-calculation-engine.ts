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

/** Calculates all supplied students without fetching policy or tenant state. */
export function computeAllStudentResults(input: ExaminationCalculationInput): ComputedStudentResult[] {
  const { context, students, policy, attendance, passPercentage, termAverageRule, currentTerm, cumulativeConfig } = input;
  if (policy.schoolId !== context.schoolId) {
    throw new Error(`Examination policy school ${policy.schoolId} does not match calculation school ${context.schoolId}.`);
  }
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
          grade: percentage === null ? null : computeGrade(percentage, input.gradingRules),
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

    const violations: string[] = [];
    const rule1 = rules.rule1 ?? {};
    const ruleAtt = rules.rule_attendance ?? {};
    const attPct = attendanceMap.get(student.studentId)?.attendancePct ?? null;
    if (rule1.enabled !== false && termNames.length > 0) {
      const termRules = Array.isArray(rule1.rules) && rule1.rules.length > 0
        ? (rule1.rules as any[]).map(r => ({ term: String(r.term ?? "").trim(), fail_count: Number(r.fail_count ?? 3) }))
        : rule1.term ? [{ term: String(rule1.term).trim(), fail_count: Number(rule1.max_fails) || 3 }]
          : [{ term: termNames[termNames.length - 1], fail_count: Number(rule1.max_fails) || 3 }];
      for (const tr of termRules) {
        if (tr.fail_count <= 0) continue;
        const fails = allTermFailCounts[tr.term] ?? 0;
        if (fails >= tr.fail_count) {
          const failedNames = (termResults[tr.term] ?? []).filter(s => s.passed === false).map(s => s.subject);
          const maxAllowed = tr.fail_count - 1;
          const nameList = failedNames.length > 0 ? ` (${failedNames.join(", ")})` : "";
          violations.push(`The student failed ${fails} subject${fails !== 1 ? "s" : ""}${nameList} in ${tr.term}, which exceeds the maximum allowed limit of ${maxAllowed} failing subject${maxAllowed !== 1 ? "s" : ""} set by the school board.`);
        }
      }
    }
    if (ruleAtt.enabled === true && Array.isArray(ruleAtt.rules) && ruleAtt.rules.length > 0 && attPct !== null) {
      for (const r of ruleAtt.rules as any[]) {
        const minPct = Number(r.min_pct ?? 0);
        if (minPct <= 0) continue;
        if (attPct < minPct) {
          const termLabel = r.term ? ` in ${r.term}` : "";
          violations.push(`The student achieved an attendance rate of ${attPct.toFixed(1)}%${termLabel}, falling below the required minimum threshold of ${minPct}%.`);
          break;
        }
      }
    }
    if (termAverageRule?.enabled && currentTerm) {
      const scored = (termResults[currentTerm] ?? []).filter(s => s.status === "scored");
      if (scored.length > 0) {
        const rounded = Math.round((scored.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / scored.length) * 10) / 10;
        if (rounded < termAverageRule.minPct) violations.push(`The student's weighted average score for ${currentTerm} was ${rounded}%, which falls below the configured pass threshold of ${termAverageRule.minPct}%.`);
      }
    }
    const isCumulTerm = cumulativeConfig?.enabled && cumulativeConfig.triggerTerm && currentTerm
      ? currentTerm.trim() === cumulativeConfig.triggerTerm.trim() : false;
    if (isCumulTerm && cumulativeConfig?.promotionEnabled) {
      const minPct = cumulativeConfig.minPercent ?? 0;
      if (minPct > 0) {
        if (cumulativePercentage !== null && cumulativePercentage < minPct) {
          violations.push(`The student's cumulative year-end percentage of ${cumulativePercentage}% falls below the required minimum threshold of ${minPct}%.`);
        }
      }
    }
    return {
      schoolId: context.schoolId, sessionId: context.sessionId,
      studentId: student.studentId, name: student.name, digitalStudentId: student.digitalStudentId, rollNumber: student.rollNumber,
      termResults, termAverages, cumulativePercentage, allTermFailCounts, attendancePct: attPct,
      promoted: violations.length === 0,
      promotionReason: violations.length > 0 ? violations[0] : "Meets all promotion criteria.",
      detentionViolations: violations,
    };
  });
}

/** Grade labels and remarks use supplied rules, preserving the former fallback scale. */
export function computeGrade(pct: number, rules: GradingRule[]): ComputedGrade {
  if (rules.length > 0) {
    const sorted = [...rules].sort((a, b) => b.minPercent - a.minPercent);
    for (const rule of sorted) if (pct >= rule.minPercent) return { label: rule.gradeLabel, remarks: rule.remarks };
    const last = sorted[sorted.length - 1];
    return { label: last.gradeLabel, remarks: last.remarks };
  }
  if (pct >= 90) return { label: "A+", remarks: "Outstanding" };
  if (pct >= 80) return { label: "A", remarks: "Excellent" };
  if (pct >= 70) return { label: "B+", remarks: "Very Good" };
  if (pct >= 60) return { label: "B", remarks: "Good" };
  if (pct >= 50) return { label: "C+", remarks: "Average" };
  if (pct >= 40) return { label: "C", remarks: "Below Average" };
  if (pct >= 33) return { label: "D", remarks: "Poor" };
  return { label: "F", remarks: "Fail" };
}