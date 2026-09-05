import { describe, expect, it } from "vitest";
import { computeAllStudentResults, computeGrade, type ExaminationCalculationInput } from "../examination-calculation-engine";

const students = [{
  studentId: 7, name: "Asha", digitalStudentId: "DS-7", rollNumber: 1,
  scores: [
    { subject: "Math", examType: "Unit", marks: 40, totalMarks: 50, isAbsent: false },
    { subject: "Math", examType: "Final", marks: 60, totalMarks: 100, isAbsent: false },
    { subject: "Science", examType: "Quiz", marks: 9, totalMarks: 10, isAbsent: false },
    { subject: "History", examType: "Unit", marks: 0, totalMarks: 50, isAbsent: true },
  ],
}];

function input(overrides: Partial<ExaminationCalculationInput> = {}): ExaminationCalculationInput {
  return {
    context: { schoolId: 11, sessionId: 101 },
    students,
    attendance: [{ studentId: 7, attendancePct: 74.5, presentDays: 149, totalDays: 200 }],
    policy: {
      schoolId: 11,
      examWeights: JSON.stringify({
        " Term 1 ": [{ source_exam: "Unit", weight: 40 }, { source_exam: "Final", weight: 60 }],
        Term2: [{ source_exam: "Unit", weight: 100 }],
      }),
      promotionFailRules: JSON.stringify({
        rule1: { enabled: true, rules: [{ term: "Term 1", fail_count: 2 }] },
        rule_attendance: { enabled: true, rules: [{ term: "Term 1", min_pct: 75 }] },
      }),
    },
    passPercentage: 65,
    gradingRules: [
      { id: 1, tierId: 1, gradeLabel: "Distinction", minPercent: 70, maxPercent: 100, remarks: "Great", sortOrder: 1 },
      { id: 2, tierId: 1, gradeLabel: "Pass", minPercent: 0, maxPercent: 69, remarks: "Keep going", sortOrder: 2 },
    ],
    termAverageRule: { enabled: true, minPct: 71 },
    currentTerm: "Term 1",
    cumulativeConfig: { enabled: true, triggerTerm: "Term 1", termWeights: { "Term 1": 50, Term2: 50 }, promotionEnabled: true, minPercent: 70 },
    ...overrides,
  };
}

describe("examination calculation engine", () => {
  it("uses supplied weights and policies, retaining existing scored/missing/absent arithmetic", () => {
    const [result] = computeAllStudentResults(input());
    const term1 = result.termResults["Term 1"];
    expect(term1.find(s => s.subject === "Math")).toMatchObject({
      percentage: 68, passed: true, status: "scored",
      breakdown: [{ status: "scored", contribution: 32 }, { status: "scored", contribution: 36 }],
    });
    expect(term1.find(s => s.subject === "Science")).toMatchObject({ percentage: null, passed: null, status: "incomplete" });
    expect(term1.find(s => s.subject === "History")).toMatchObject({ percentage: 0, passed: false, status: "absent" });
    expect(result.allTermFailCounts["Term 1"]).toBe(1);
    expect(result.detentionViolations).toEqual([
      "The student achieved an attendance rate of 74.5% in Term 1, falling below the required minimum threshold of 75%.",
      "The student's weighted average score for Term 1 was 68%, which falls below the configured pass threshold of 71%.",
    ]);
    // Term2 has scored records, so the supplied cumulative weights make its
    // 80% Math result and Term 1's 68% Math average exactly 74%.
    expect(result.termResults.Term2.find(s => s.subject === "Math")?.percentage).toBe(80);
    expect(result.promoted).toBe(false);
  });

  it("keeps school/session context at the input boundary and changes only with supplied policy", () => {
    const first = computeAllStudentResults(input())[0];
    const second = computeAllStudentResults(input({
      context: { schoolId: 22, sessionId: 202 },
      policy: {
        schoolId: 22,
        examWeights: JSON.stringify({ Term1: [{ source_exam: "Final", weight: 100 }] }),
        promotionFailRules: JSON.stringify({ rule1: { enabled: false } }),
      },
      attendance: [{ studentId: 7, attendancePct: 99, presentDays: 198, totalDays: 200 }],
      passPercentage: 50,
      gradingRules: [{ id: 3, tierId: 2, gradeLabel: "School Two Merit", minPercent: 50, maxPercent: 100, remarks: "School two", sortOrder: 1 }],
      termAverageRule: { enabled: false, minPct: 0 },
      currentTerm: "Term1",
      cumulativeConfig: null,
    }))[0];
    expect(first.schoolId).toBe(11);
    expect(first.sessionId).toBe(101);
    expect(second.schoolId).toBe(22);
    expect(second.sessionId).toBe(202);
    expect(second.termResults.Term1.find(s => s.subject === "Math")).toMatchObject({ percentage: 60, passed: true });
    expect(second.termResults.Term1.find(s => s.subject === "Math")?.grade).toEqual({ label: "School Two Merit", remarks: "School two" });
    expect(first.termAverages["Term 1"]).toBe(68);
    expect(first.cumulativePercentage).toBe(74);
    expect(second.promoted).toBe(true);
    expect(computeGrade(68, input().gradingRules)).toEqual({ label: "Pass", remarks: "Keep going" });
    expect(computeGrade(90, [])).toEqual({ label: "A+", remarks: "Outstanding" });
  });

  it("rejects a policy from another school before calculating", () => {
    expect(() => computeAllStudentResults(input({
      policy: { ...input().policy, schoolId: 99 },
    }))).toThrow("Examination policy school 99 does not match calculation school 11.");
  });
});