import { describe, expect, it } from "vitest";
import {
  AcademicCalculationError, calculateAcademicResults, resolveExamPolicy,
  roundHalfUpOneDecimal,
} from "../academic-calculation-engine";

const grading = (schoolId = 1, mode: "percentage" | "grade" | "both" = "percentage") => ({
  id: `g${schoolId}`, schoolId, applicableClasses: ["1"], gradingSystem: mode,
  passPercentage: 35, passingGrades: ["C", "A"],
  gradingRules: [
    { min: 0, max: 34, grade: "F", gradePoint: "0", remarks: "Needs improvement" },
    { min: 35, max: 100, grade: "C", gradePoint: "5", remarks: "Pass" },
  ],
});
const exam = (rules: object = {}, results: object = {}) => ({
  id: "e1", schoolId: 1, applicableClasses: ["1"],
  examWeights: { Term1: [{ source_exam: "Exam", weight: 100 }] },
  promotionFailRules: rules, resultsConfig: results,
});
const score = (marks = 35) => ({ schoolId: 1, sessionId: 11, studentId: 7, subject: "Math", examType: "Exam", marks, totalMarks: 100 });
const input = (extra: object = {}) => ({ schoolId: 1, sessionId: 11, className: "1", studentId: 7, requiredSubjects: ["Math"], gradingPolicies: [grading()], examPolicies: [exam()], scores: [score()], ...extra });

describe("academic calculation engine", () => {
  it("isolates policies by school and requires exactly one", () => {
    expect(calculateAcademicResults({ ...input(), gradingPolicies: [grading(), grading(2)], examPolicies: [exam()] }).policy.gradingId).toBe("g1");
    expect(() => resolveExamPolicy([{ ...exam(), applicableClasses: ["1"] }, { ...exam(), id: "e2", applicableClasses: ["1"] }], 1, "1"))
      .toThrow(expect.objectContaining({ code: "POLICY_CONFIGURATION_AMBIGUOUS" }));
  });
  it("evaluates percentage, grade and both grading modes", () => {
    const result = calculateAcademicResults(input({ gradingPolicies: [grading(1, "percentage")] }));
    expect(result.subjectResults[0].terms.Term1).toMatchObject({
      status: "pass", grade: "C", gradePoint: "5", remarks: "Pass",
    });
    expect(calculateAcademicResults(input({ gradingPolicies: [grading(1, "grade")], scores: [score(34)] })).subjectResults[0].terms.Term1.status).toBe("fail");
    expect(calculateAcademicResults(input({ gradingPolicies: [{ ...grading(1, "both"), passPercentage: 80 }], scores: [score(50)] })).subjectResults[0].terms.Term1.status).toBe("fail");
  });
  it("does not renormalize missing data and detects duplicates", () => {
    const weighted = { ...exam(), examWeights: { Term1: [{ source_exam: "A", weight: 50 }, { source_exam: "B", weight: 50 }] } };
    const incomplete = calculateAcademicResults(input({ examPolicies: [weighted], scores: [{ ...score(), examType: "A" }] }));
    expect(incomplete.complete).toBe(false);
    expect(incomplete.promoted).toBeNull();
    expect(() => calculateAcademicResults(input({ scores: [score(), score()] }))).toThrow(expect.objectContaining({ code: "DUPLICATE_SCORE_DATA" }));
  });
  it("returns no verdict when a required subject has no scores", () => {
    const result = calculateAcademicResults(input({ scores: [] }));
    expect(result.complete).toBe(false);
    expect(result.promoted).toBeNull();
  });
  it("applies rule 1, 3 and 4 and validates weights", () => {
    expect(calculateAcademicResults(input({ examPolicies: [exam({ rule1: { enabled: true, rules: [{ term: "Term1", fail_count: 1 }] }, rule_term_avg: { enabled: true, minPct: 40, term: "Term1" } })], scores: [score(30)] })).violations.map(v => v.rule)).toEqual(["rule1", "rule3"]);
    const cumulative = { cumulative: { enabled: true, promotionEnabled: true, triggerTerm: "Term1", termWeights: { Term1: 100 }, minPercent: 40 } };
    expect(calculateAcademicResults(input({ examPolicies: [exam({}, cumulative)], scores: [score(30)] })).violations.some(v => v.rule === "rule4")).toBe(true);
    expect(() => calculateAcademicResults(input({ examPolicies: [{ ...exam(), examWeights: { Term1: [{ source_exam: "Exam", weight: 99 }] } }] }))).toThrow(AcademicCalculationError);
  });
  it("calculates term attendance and rejects unknown statuses", () => {
    const rules = { rule_attendance: { enabled: true, rules: [{ term: "Term1", min_pct: 80 }] } };
    const result = calculateAcademicResults(input({ examPolicies: [exam(rules)], termDateRanges: { Term1: { start: "2025-01-01", end: "2025-01-31" } }, attendanceRecords: [{ schoolId: 1, sessionId: 11, studentId: 7, date: "2025-01-02", status: "present" }, { schoolId: 1, sessionId: 11, studentId: 7, date: "2025-01-03", status: "half_day" }] }));
    expect(result.attendance.Term1).toBe(75);
    expect(result.violations.some(v => v.rule === "rule2")).toBe(true);
    expect(() => calculateAcademicResults(input({ examPolicies: [exam(rules)], termDateRanges: { Term1: { start: "2025-01-01", end: "2025-01-31" } }, attendanceRecords: [{ schoolId: 1, sessionId: 11, studentId: 7, date: "2025-01-02", status: "remote" }] }))).toThrow(AcademicCalculationError);
  });
  it("rejects score data from another session", () => {
    expect(() => calculateAcademicResults(input({ scores: [{ ...score(), sessionId: 12 }] })))
      .toThrow(expect.objectContaining({ code: "DATA_SCOPE_MISMATCH" }));
  });
  it("rounds decimal boundaries half up", () => {
    expect(roundHalfUpOneDecimal(1.05)).toBe(1.1);
    expect(roundHalfUpOneDecimal(1.04)).toBe(1);
  });
});