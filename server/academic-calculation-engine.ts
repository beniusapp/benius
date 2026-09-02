/**
 * Pure, side-effect free academic calculation engine.  Database adapters are
 * deliberately kept outside this module so a verdict can always be reproduced
 * from the policy snapshot and input records returned here.
 */
export type AcademicErrorCode =
  | "POLICY_NOT_CONFIGURED"
  | "POLICY_CONFIGURATION_AMBIGUOUS"
  | "POLICY_CONFIGURATION_INCOMPLETE"
  | "INVALID_POLICY_WEIGHT_CONFIGURATION"
  | "DATA_SCOPE_MISMATCH"
  | "DUPLICATE_SCORE_DATA"
  | "INVALID_SCORE_DATA"
  | "STALE_CALCULATION_VERSION";

export const ACADEMIC_CALCULATION_VERSION = "academic-calculation-engine/v1";

export class AcademicCalculationError extends Error {
  constructor(public readonly code: AcademicErrorCode, message: string) {
    super(message);
    this.name = "AcademicCalculationError";
  }
}

export interface GradingRule {
  min: number;
  max: number;
  grade: string;
  gradePoint?: string | null;
  remarks?: string | null;
}
export interface GradingPolicy {
  id: number | string; schoolId: number; applicableClasses?: string[]; classes?: string[];
  gradingSystem: "percentage" | "grade" | "both"; passPercentage?: number;
  passingGrades?: string[]; gradingRules: GradingRule[];
}
export interface ExamWeight { source_exam: string; weight: number }
export interface ExamPolicy {
  id: number | string; schoolId: number; applicableClasses: string[];
  tierName?: string; examWeights: Record<string, ExamWeight[]> | string;
  promotionFailRules?: unknown | string; resultsConfig?: unknown | string;
}
export interface ScoreRecord {
  schoolId: number; sessionId: number; studentId: number | string; subject: string; examType: string; marks: number;
  totalMarks: number; isAbsent?: boolean; grade?: string;
}
export interface AttendanceRecord {
  schoolId: number; sessionId: number; studentId: number | string; date: string | Date; status: string;
}
export interface TermDateRange { start: string | Date; end: string | Date }
export interface CalculationInput {
  schoolId: number; sessionId: number; className: string; studentId: number | string;
  gradingPolicies: GradingPolicy[]; examPolicies: ExamPolicy[]; scores: ScoreRecord[];
  requiredSubjects: string[];
  attendanceRecords?: AttendanceRecord[]; termDateRanges?: Record<string, TermDateRange>;
  /** The term whose promotion gate is being evaluated; omitted means latest configured term. */
  currentTerm?: string;
  calculationVersion?: string;
}
export type ResultStatus = "pass" | "fail" | "absent" | "incomplete";
export interface Violation { rule: "data" | "rule1" | "rule2" | "rule3" | "rule4"; term?: string; reason: string }

const fail = (code: AcademicErrorCode, message: string): never => { throw new AcademicCalculationError(code, message); };
const asObject = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { fail("POLICY_CONFIGURATION_INCOMPLETE", `${label} is not valid JSON`); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("POLICY_CONFIGURATION_INCOMPLETE", `${label} is required`);
  return value as Record<string, unknown>;
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Decimal-safe, deterministic round-half-up to one decimal place. */
export function roundHalfUpOneDecimal(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Cannot round a non-finite number");
  const sign = value < 0 ? -1 : 1;
  // Converting through fixed notation avoids binary multiplication surprises
  // for ordinary mark percentages (e.g. 1.005).
  const text = Math.abs(value).toFixed(12);
  const [whole, fraction = ""] = text.split(".");
  const scaled = BigInt(whole + (fraction + "000000000000").slice(0, 12));
  const roundedTenths = (scaled + BigInt("50000000000")) / BigInt("100000000000");
  return sign * Number(roundedTenths) / 10;
}

function exactlyOne<T extends { schoolId: number }>(items: T[], schoolId: number, className: string, classes: (item: T) => string[] | undefined, label: string): T {
  const matches = items.filter(p => p.schoolId === schoolId && (classes(p) ?? []).includes(className));
  if (!matches.length) fail("POLICY_NOT_CONFIGURED", `No ${label} is configured for school ${schoolId}, class ${className}`);
  if (matches.length !== 1) fail("POLICY_CONFIGURATION_AMBIGUOUS", `More than one ${label} applies to school ${schoolId}, class ${className}`);
  return matches[0];
}
export function resolveGradingPolicy(policies: GradingPolicy[], schoolId: number, className: string): GradingPolicy {
  return exactlyOne(policies, schoolId, className, p => p.applicableClasses ?? p.classes, "grading policy");
}
export function resolveExamPolicy(policies: ExamPolicy[], schoolId: number, className: string): ExamPolicy {
  return exactlyOne(policies, schoolId, className, p => p.applicableClasses, "exam policy");
}

export function validateGradingRules(rules: GradingRule[]): void {
  if (!Array.isArray(rules) || !rules.length) fail("POLICY_CONFIGURATION_INCOMPLETE", "At least one grading rule is required");
  const sorted = [...rules].sort((a, b) => a.min - b.min);
  let expected = 0;
  for (const rule of sorted) {
    if (!finite(rule.min) || !finite(rule.max) || !rule.grade || rule.min < 0 || rule.max > 100 || rule.min > rule.max)
      fail("POLICY_CONFIGURATION_INCOMPLETE", "Grading rules must have valid min, max, and grade values");
    if (rule.min !== expected) fail("POLICY_CONFIGURATION_INCOMPLETE", "Grading rules must cover 0..100 without gaps or overlaps");
    expected = rule.max + 1;
  }
  if (expected !== 101) fail("POLICY_CONFIGURATION_INCOMPLETE", "Grading rules must cover 0..100 without gaps or overlaps");
}

function validateWeights(raw: unknown): Record<string, ExamWeight[]> {
  const weights = asObject(raw, "Exam weights") as Record<string, unknown>;
  if (!Object.keys(weights).length) fail("POLICY_CONFIGURATION_INCOMPLETE", "At least one target term is required");
  for (const [term, components] of Object.entries(weights)) {
    if (!term || !Array.isArray(components) || !components.length) fail("INVALID_POLICY_WEIGHT_CONFIGURATION", `Term ${term || "(unnamed)"} has no components`);
    const names = new Set<string>(); let sum = 0;
    for (const item of components as unknown[]) {
      if (!item || typeof item !== "object") fail("INVALID_POLICY_WEIGHT_CONFIGURATION", `Term ${term} has an invalid component`);
      const c = item as ExamWeight;
      if (!c.source_exam || names.has(c.source_exam) || !finite(c.weight) || c.weight <= 0)
        fail("INVALID_POLICY_WEIGHT_CONFIGURATION", `Term ${term} has duplicate, non-positive, or invalid weights`);
      names.add(c.source_exam); sum += c.weight;
    }
    if (sum !== 100) fail("INVALID_POLICY_WEIGHT_CONFIGURATION", `Term ${term} weights must sum exactly to 100`);
  }
  return weights as Record<string, ExamWeight[]>;
}
function gradeFor(policy: GradingPolicy, percentage: number): GradingRule {
  return policy.gradingRules.find(r => percentage >= r.min && percentage <= r.max)!;
}
function passing(policy: GradingPolicy, percentage: number, grade: string): boolean {
  const pctOk = finite(policy.passPercentage) && percentage >= policy.passPercentage!;
  const gradeOk = (policy.passingGrades ?? []).includes(grade);
  if (policy.gradingSystem === "percentage") return pctOk;
  if (policy.gradingSystem === "grade") return gradeOk;
  return pctOk && gradeOk;
}

export function calculateAcademicResults(input: CalculationInput) {
  if (input.calculationVersion && input.calculationVersion !== ACADEMIC_CALCULATION_VERSION) {
    fail("STALE_CALCULATION_VERSION", "The requested academic calculation version is no longer current.");
  }
  const grading = resolveGradingPolicy(input.gradingPolicies, input.schoolId, input.className);
  const exam = resolveExamPolicy(input.examPolicies, input.schoolId, input.className);
  validateGradingRules(grading.gradingRules);
  if (!["percentage", "grade", "both"].includes(grading.gradingSystem) ||
      (grading.gradingSystem !== "grade" && !finite(grading.passPercentage)) ||
      (grading.gradingSystem !== "percentage" && !(grading.passingGrades?.length)))
    fail("POLICY_CONFIGURATION_INCOMPLETE", "Grading policy is incomplete for its grading mode");
  const weights = validateWeights(exam.examWeights);
  const rules = asObject(exam.promotionFailRules ?? {}, "Promotion rules");
  const resultsConfig = asObject(exam.resultsConfig ?? {}, "Results configuration");
  const configuredTerms = new Set(Object.keys(weights));
  if (input.currentTerm && !configuredTerms.has(input.currentTerm)) {
    fail("POLICY_CONFIGURATION_INCOMPLETE", "The selected term is not configured in the current exam policy.");
  }
  if (!Array.isArray(input.requiredSubjects) || !input.requiredSubjects.length ||
      input.requiredSubjects.some(subject => typeof subject !== "string" || !subject.trim())) {
    fail("POLICY_CONFIGURATION_INCOMPLETE", "The class must have at least one configured subject.");
  }
  if (input.scores.some(s =>
    s.schoolId !== input.schoolId ||
    s.sessionId !== input.sessionId ||
    s.studentId !== input.studentId
  )) {
    fail("DATA_SCOPE_MISMATCH", "Score data does not match the requested school, session, and student.");
  }
  if ((input.attendanceRecords ?? []).some(a =>
    a.schoolId !== input.schoolId ||
    a.sessionId !== input.sessionId ||
    a.studentId !== input.studentId
  )) {
    fail("DATA_SCOPE_MISMATCH", "Attendance data does not match the requested school, session, and student.");
  }
  const scores = input.scores;
  const requiredSubjects = [...new Set(input.requiredSubjects.map(subject => subject.trim()))].sort();
  if (scores.some(score => !requiredSubjects.includes(score.subject))) {
    fail("INVALID_SCORE_DATA", "Score data contains a subject that is not configured for this class.");
  }
  const seen = new Set<string>();
  for (const s of scores) {
    const key = `${s.subject}\u0000${s.examType}`;
    if (seen.has(key)) fail("DUPLICATE_SCORE_DATA", `Duplicate score for ${s.subject} / ${s.examType}`);
    seen.add(key);
    if (!Number.isInteger(s.marks) || !Number.isInteger(s.totalMarks) || s.totalMarks <= 0 || s.marks < 0 || s.marks > s.totalMarks)
      fail("INVALID_SCORE_DATA", `Invalid score for ${s.subject} / ${s.examType}`);
  }
  const subjects = requiredSubjects;
  const violations: Violation[] = [];
  const subjectResults = subjects.map(subject => {
    const terms: Record<string, {
      percentage: number | null;
      grade: string | null;
      gradePoint: string | null;
      remarks: string | null;
      status: ResultStatus;
      breakdown: Array<{
        sourceExam: string; weight: number; marks: number | null; totalMarks: number | null;
        isAbsent: boolean; pct: number | null; contribution: number | null;
        status: "scored" | "absent" | "missing";
      }>;
    }> = {};
    for (const [term, components] of Object.entries(weights)) {
      const records = components.map(c => scores.find(s => s.subject === subject && s.examType === c.source_exam));
      const breakdown = components.map((component, index) => {
        const record = records[index];
        if (!record) return {
          sourceExam: component.source_exam, weight: component.weight, marks: null, totalMarks: null,
          isAbsent: false, pct: null, contribution: null, status: "missing" as const,
        };
        if (record.isAbsent) return {
          sourceExam: component.source_exam, weight: component.weight, marks: record.marks, totalMarks: record.totalMarks,
          isAbsent: true, pct: null, contribution: null, status: "absent" as const,
        };
        const pct = record.marks / record.totalMarks * 100;
        return {
          sourceExam: component.source_exam, weight: component.weight, marks: record.marks, totalMarks: record.totalMarks,
          isAbsent: false, pct, contribution: pct * component.weight / 100, status: "scored" as const,
        };
      });
      if (records.some(r => !r)) {
        terms[term] = { percentage: null, grade: null, gradePoint: null, remarks: null, status: "incomplete", breakdown };
        violations.push({ rule: "data", term, reason: `${subject}: missing weighted exam component` }); continue;
      }
      if (records.some(r => r!.isAbsent)) {
        terms[term] = { percentage: null, grade: null, gradePoint: null, remarks: null, status: "absent", breakdown };
        continue;
      }
      const percentage = roundHalfUpOneDecimal(records.reduce((sum, r, i) => sum + (r!.marks / r!.totalMarks * 100) * components[i].weight / 100, 0));
      const grade = gradeFor(grading, percentage);
      terms[term] = {
        percentage,
        grade: grade.grade,
        gradePoint: grade.gradePoint ?? null,
        remarks: grade.remarks ?? null,
        status: passing(grading, percentage, grade.grade) ? "pass" : "fail",
        breakdown,
      };
    }
    return { subject, terms };
  });
  const termAverages: Record<string, number | null> = {};
  const termGrades: Record<string, { label: string; gradePoint: string | null; remarks: string | null } | null> = {};
  for (const term of Object.keys(weights)) {
    const values = subjectResults.map(s => s.terms[term].percentage);
    termAverages[term] = values.length && values.every((v): v is number => v !== null)
      ? roundHalfUpOneDecimal(values.reduce((a, b) => a + b, 0) / values.length) : null;
    termGrades[term] = termAverages[term] === null ? null : (() => {
      const grade = gradeFor(grading, termAverages[term]!);
      return { label: grade.grade, gradePoint: grade.gradePoint ?? null, remarks: grade.remarks ?? null };
    })();
  }
  const attendance: Record<string, number | null> = {};
  const failedSubjectCounts: Record<string, number> = {};
  for (const term of Object.keys(weights)) {
    failedSubjectCounts[term] = subjectResults.filter(subject => {
      const status = subject.terms[term]?.status;
      return status === "fail" || status === "absent";
    }).length;
  }
  const attendanceRules = (rules.rule_attendance as { enabled?: boolean; rules?: { term: string; min_pct: number }[] } | undefined);
  if (attendanceRules?.enabled && (!Array.isArray(attendanceRules.rules) || !attendanceRules.rules.length)) {
    fail("POLICY_CONFIGURATION_INCOMPLETE", "Attendance rules are enabled but not configured.");
  }
  if (attendanceRules?.enabled) for (const r of attendanceRules.rules ?? []) {
    if (!configuredTerms.has(r.term) || !finite(r.min_pct) || r.min_pct < 0 || r.min_pct > 100) {
      fail("POLICY_CONFIGURATION_INCOMPLETE", "Attendance rules contain an invalid term or threshold.");
    }
    const range = input.termDateRanges?.[r.term];
    if (!range) { attendance[r.term] = null; violations.push({ rule: "data", term: r.term, reason: "Attendance term date range is missing" }); continue; }
    const start = new Date(range.start).getTime(), end = new Date(range.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      fail("POLICY_CONFIGURATION_INCOMPLETE", `Attendance term date range is invalid for ${r.term}`);
    }
    const records = (input.attendanceRecords ?? []).filter(a => a.studentId === input.studentId && new Date(a.date).getTime() >= start && new Date(a.date).getTime() <= end);
    const values: Record<string, number> = { present: 1, late: 1, leave: 1, halfday: .5, half_day: .5, absent: 0 };
    let earned = 0;
    for (const a of records) {
      if (!Number.isFinite(new Date(a.date).getTime())) fail("INVALID_SCORE_DATA", `Invalid attendance date: ${a.date}`);
      if (!(a.status in values)) fail("POLICY_CONFIGURATION_INCOMPLETE", `Unknown attendance status: ${a.status}`);
      earned += values[a.status];
    }
    if (!records.length) { attendance[r.term] = null; violations.push({ rule: "data", term: r.term, reason: "Attendance records are missing" }); continue; }
    attendance[r.term] = roundHalfUpOneDecimal(earned / records.length * 100);
    if (attendance[r.term]! < r.min_pct) violations.push({ rule: "rule2", term: r.term, reason: `Attendance is below ${r.min_pct}%` });
  }
  const rule1 = rules.rule1 as { enabled?: boolean; rules?: { term: string; fail_count: number }[] } | undefined;
  if (rule1?.enabled && (!Array.isArray(rule1.rules) || !rule1.rules.length)) {
    fail("POLICY_CONFIGURATION_INCOMPLETE", "Failed-subject rules are enabled but not configured.");
  }
  if (rule1?.enabled) for (const r of rule1.rules ?? []) {
    if (!configuredTerms.has(r.term) || !Number.isInteger(r.fail_count) || r.fail_count <= 0) {
      fail("POLICY_CONFIGURATION_INCOMPLETE", "Failed-subject rules contain an invalid term or threshold.");
    }
    const fails = failedSubjectCounts[r.term] ?? 0;
    if (fails >= r.fail_count) violations.push({ rule: "rule1", term: r.term, reason: `${fails} failed subjects meets threshold ${r.fail_count}` });
  }
  const rule3 = rules.rule_term_avg as { enabled?: boolean; minPct?: number; term?: string } | undefined;
  if (rule3?.enabled) {
    const term = rule3.term ?? input.currentTerm ?? Object.keys(weights).at(-1)!;
    if (!configuredTerms.has(term) || !finite(rule3.minPct) || rule3.minPct < 0 || rule3.minPct > 100) {
      fail("POLICY_CONFIGURATION_INCOMPLETE", "Term-average rule contains an invalid term or threshold.");
    }
    if (termAverages[term] === null) violations.push({ rule: "data", term, reason: "Current term average is incomplete" });
    else if (!finite(rule3.minPct) || termAverages[term]! < rule3.minPct) violations.push({ rule: "rule3", term, reason: `Term average is below ${rule3.minPct}%` });
  }
  const cumulative = (resultsConfig.cumulative ?? {}) as { enabled?: boolean; promotionEnabled?: boolean; triggerTerm?: string; termWeights?: Record<string, number>; minPercent?: number };
  let cumulativeAverage: number | null = null;
  let cumulativeGrade: { label: string; gradePoint: string | null; remarks: string | null } | null = null;
  if (cumulative.enabled) {
    const tw = cumulative.termWeights ?? {}; const entries = Object.entries(tw);
    if (!entries.length || entries.some(([, w]) => !finite(w) || w <= 0) || entries.reduce((n, [, w]) => n + w, 0) !== 100)
      fail("INVALID_POLICY_WEIGHT_CONFIGURATION", "Cumulative term weights must be positive and sum exactly to 100");
    if (entries.some(([term]) => !configuredTerms.has(term))) {
      fail("POLICY_CONFIGURATION_INCOMPLETE", "Cumulative weights reference an unknown term.");
    }
    if (cumulative.promotionEnabled && (
      !cumulative.triggerTerm ||
      !configuredTerms.has(cumulative.triggerTerm) ||
      !finite(cumulative.minPercent) ||
      cumulative.minPercent < 0 ||
      cumulative.minPercent > 100
    )) {
      fail("POLICY_CONFIGURATION_INCOMPLETE", "Cumulative promotion rule is incomplete.");
    }
    if (entries.some(([term]) => termAverages[term] === null || termAverages[term] === undefined)) violations.push({ rule: "data", reason: "Cumulative average is incomplete" });
    else {
      cumulativeAverage = roundHalfUpOneDecimal(entries.reduce((n, [term, w]) => n + termAverages[term]! * w / 100, 0));
      const grade = gradeFor(grading, cumulativeAverage);
      cumulativeGrade = { label: grade.grade, gradePoint: grade.gradePoint ?? null, remarks: grade.remarks ?? null };
    }
    if (cumulative.promotionEnabled && cumulativeAverage !== null && cumulative.triggerTerm &&
        (input.currentTerm ?? cumulative.triggerTerm) === cumulative.triggerTerm &&
        cumulativeAverage < (cumulative.minPercent ?? NaN))
      violations.push({ rule: "rule4", term: cumulative.triggerTerm, reason: `Cumulative average is below ${cumulative.minPercent}%` });
  }
  const complete = !violations.some(v => v.rule === "data") && subjectResults.every(s => Object.values(s.terms).every(t => t.status !== "incomplete"));
  return {
    calculationVersion: ACADEMIC_CALCULATION_VERSION,
    scope: { schoolId: input.schoolId, sessionId: input.sessionId, studentId: input.studentId, className: input.className },
    policy: { gradingId: grading.id, examId: exam.id, gradingSnapshot: grading, examSnapshot: exam },
    subjectResults,
    termAverages,
    termGrades,
    failedSubjectCounts,
    cumulativeAverage,
    cumulativeGrade,
    attendance,
    violations,
    complete,
    promoted: complete ? !violations.some(v => v.rule !== "data") : null,
  };
}