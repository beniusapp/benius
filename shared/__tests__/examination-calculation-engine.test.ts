import { describe, expect, it } from "vitest";
import { computeAllStudentResults, computeGrade, evaluatePromotionRules, selectGrade, type ExaminationCalculationInput, type PromotionRuleEvaluationInput } from "../examination-calculation-engine";
import { percentageToHundredths } from "../grading-percentage";

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
    gradingPolicy: { schoolId: 11 },
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
  it("parses grading percentages without truncating or rounding", () => {
    expect(percentageToHundredths("59.9")).toBe(5990);
    expect(percentageToHundredths("59.90")).toBe(5990);
    expect(percentageToHundredths("59.99")).toBe(5999);
    expect(percentageToHundredths("100.00")).toBe(10000);
    expect(() => percentageToHundredths("59.999")).toThrow("at most 2 decimal places");
    expect(() => percentageToHundredths("-0.01")).toThrow("between 0.00 and 100.00");
    expect(() => percentageToHundredths("100.01")).toThrow("between 0.00 and 100.00");
    expect(() => percentageToHundredths("not-a-number")).toThrow("finite number");
  });

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
        promotionFailRules: JSON.stringify({ rule1: { enabled: true, rules: [{ term: "Term1", fail_count: 99 }] } }),
      },
      attendance: [{ studentId: 7, attendancePct: 99, presentDays: 198, totalDays: 200 }],
      passPercentage: 50,
      gradingPolicy: { schoolId: 22 },
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
    expect(() => computeGrade(90, [])).toThrow("non-empty configured grading policy");
  });

  it("rejects a policy from another school before calculating", () => {
    expect(() => computeAllStudentResults(input({
      policy: { ...input().policy, schoolId: 99 },
    }))).toThrow("Examination policy school 99 does not match calculation school 11.");
  });

  it("rejects a grading policy from another school independently of the examination policy", () => {
    expect(() => computeAllStudentResults(input({
      gradingPolicy: { schoolId: 99 },
    }))).toThrow("Grading policy school 99 does not match calculation school 11.");
  });

  it("selects only inclusive configured ranges and rejects gaps or invalid configuration", () => {
    const rules = input().gradingRules;
    expect(selectGrade(0, rules).label).toBe("Pass");
    expect(selectGrade(69, rules).label).toBe("Pass");
    expect(selectGrade(70, rules).label).toBe("Distinction");
    expect(selectGrade(100, rules).label).toBe("Distinction");
    expect(() => selectGrade(69.5, rules)).toThrow("No configured grading rule");
    expect(() => selectGrade(50, [{ ...rules[0], minPercent: 70.555 }])).toThrow("at most 2 decimal places");
    expect(() => selectGrade(50, [{ ...rules[0], minPercent: 60, maxPercent: 80 }, { ...rules[1], minPercent: 0, maxPercent: 70 }]))
      .toThrow("must not overlap");
    expect(() => selectGrade(65, [{ ...rules[0], minPercent: 70, maxPercent: 100 }, { ...rules[1], minPercent: 0, maxPercent: 60 }]))
      .toThrow("must not contain gaps");
  });

  it("selects inclusive two-decimal grading boundaries without rounding configured values", () => {
    const rules = [
      { id: 1, tierId: 1, gradeLabel: "D", minPercent: 0, maxPercent: 34.99, remarks: null, sortOrder: 4 },
      { id: 2, tierId: 1, gradeLabel: "C", minPercent: 35, maxPercent: 59.99, remarks: null, sortOrder: 3 },
      { id: 3, tierId: 1, gradeLabel: "B", minPercent: 60, maxPercent: 79.99, remarks: null, sortOrder: 2 },
      { id: 4, tierId: 1, gradeLabel: "A", minPercent: 80, maxPercent: 100, remarks: null, sortOrder: 1 },
    ];
    expect(selectGrade(34.99, rules).label).toBe("D");
    expect(selectGrade(35, rules).label).toBe("C");
    expect(selectGrade(59.7, rules).label).toBe("C");
    expect(selectGrade(59.99, rules).label).toBe("C");
    expect(selectGrade(60, rules).label).toBe("B");
    expect(selectGrade(80, rules).label).toBe("A");
    expect(() => selectGrade(-0.01, rules)).toThrow("between 0.00 and 100.00");
    expect(() => selectGrade(100.01, rules)).toThrow("between 0.00 and 100.00");
    expect(() => selectGrade(59.999, rules)).toThrow("at most 2 decimal places");
  });

  it("rejects decimal overlaps and gaps while preserving legacy integer policies", () => {
    const base = [
      { id: 1, tierId: 1, gradeLabel: "C", minPercent: 0, maxPercent: 59.99, remarks: null, sortOrder: 2 },
      { id: 2, tierId: 1, gradeLabel: "B", minPercent: 60, maxPercent: 100, remarks: null, sortOrder: 1 },
    ];
    expect(() => selectGrade(59, input().gradingRules)).not.toThrow();
    expect(() => selectGrade(50, [{ ...base[0], maxPercent: 60 }, base[1]])).toThrow("must not overlap");
    expect(() => selectGrade(50, [{ ...base[0], maxPercent: 59.98 }, base[1]])).toThrow("must not contain gaps");
  });

  it("keeps grade selection school-scoped while pass/fail remains independent", () => {
    const schoolARules = [
      { id: 1, tierId: 1, gradeLabel: "A grade", minPercent: 70, maxPercent: 100, remarks: null, sortOrder: 1 },
      { id: 2, tierId: 1, gradeLabel: "D grade", minPercent: 0, maxPercent: 69, remarks: null, sortOrder: 2 },
    ];
    const schoolBRules = [
      { id: 3, tierId: 2, gradeLabel: "A grade", minPercent: 80, maxPercent: 100, remarks: null, sortOrder: 1 },
      { id: 4, tierId: 2, gradeLabel: "D grade", minPercent: 0, maxPercent: 79, remarks: null, sortOrder: 2 },
    ];
    expect(selectGrade(75, schoolARules).label).toBe("A grade");
    expect(selectGrade(75, schoolBRules).label).toBe("D grade");
    const oneScore = [{ ...students[0], scores: [{ subject: "Math", examType: "Unit", marks: 75, totalMarks: 100, isAbsent: false }] }];
    const policy = { schoolId: 11, examWeights: JSON.stringify({ Term: [{ source_exam: "Unit", weight: 100 }] }), promotionFailRules: JSON.stringify({ rule1: { enabled: true, rules: [{ term: "Term", fail_count: 99 }] } }) };
    const [result] = computeAllStudentResults(input({ students: oneScore, policy, passPercentage: 40, gradingPolicy: { schoolId: 11 }, gradingRules: schoolBRules }));
    expect(result.termResults.Term[0]).toMatchObject({ grade: { label: "D grade" }, passed: true });
  });

  it("uses the supplied configured pass percentage at exact boundaries without a fallback", () => {
    const boundaryStudents = [{
      ...students[0],
      scores: [{ subject: "Math", examType: "Unit", marks: 39, totalMarks: 100, isAbsent: false }],
    }];
    const policy = {
      schoolId: 11,
      examWeights: JSON.stringify({ Term: [{ source_exam: "Unit", weight: 100 }] }),
      promotionFailRules: JSON.stringify({ rule1: { enabled: true, rules: [{ term: "Term", fail_count: 99 }] } }),
    };
    expect(computeAllStudentResults(input({ students: boundaryStudents, policy, passPercentage: 40 }))[0]
      .termResults.Term[0].passed).toBe(false);
    expect(computeAllStudentResults(input({
      students: [{ ...boundaryStudents[0], scores: [{ subject: "Math", examType: "Unit", marks: 40, totalMarks: 100, isAbsent: false }] }],
      policy, passPercentage: 40,
    }))[0].termResults.Term[0].passed).toBe(true);
    expect(computeAllStudentResults(input({
      students: [{ ...boundaryStudents[0], scores: [{ subject: "Math", examType: "Unit", marks: 49, totalMarks: 100, isAbsent: false }] }],
      policy, passPercentage: 50,
    }))[0].termResults.Term[0].passed).toBe(false);
    expect(computeAllStudentResults(input({
      students: [{ ...boundaryStudents[0], scores: [{ subject: "Math", examType: "Unit", marks: 50, totalMarks: 100, isAbsent: false }] }],
      policy, passPercentage: 50,
    }))[0].termResults.Term[0].passed).toBe(true);
  });

  it("requires a caller-supplied valid pass percentage", () => {
    expect(() => computeAllStudentResults(input({ passPercentage: Number.NaN })))
      .toThrow("configured examination pass percentage");
  });

  it("keeps distinct school policy contexts independent", () => {
    const schoolAScore = [{ ...students[0], scores: [{ subject: "Math", examType: "Unit", marks: 45, totalMarks: 100, isAbsent: false }] }];
    const schoolBScore = [{ ...students[0], scores: [{ subject: "Math", examType: "Unit", marks: 45, totalMarks: 100, isAbsent: false }] }];
    const policy = (schoolId: number) => ({
      schoolId,
      examWeights: JSON.stringify({ Term: [{ source_exam: "Unit", weight: 100 }] }),
      promotionFailRules: JSON.stringify({ rule1: { enabled: false } }),
    });
    const schoolA = computeAllStudentResults(input({
      context: { schoolId: 11, sessionId: 101 }, students: schoolAScore, policy: policy(11), passPercentage: 40,
    }))[0];
    const schoolB = computeAllStudentResults(input({
      context: { schoolId: 22, sessionId: 202 }, students: schoolBScore, policy: policy(22), gradingPolicy: { schoolId: 22 }, passPercentage: 50,
    }))[0];
    expect(schoolA.termResults.Term[0].passed).toBe(true);
    expect(schoolB.termResults.Term[0].passed).toBe(false);
    expect(schoolA.schoolId).toBe(11);
    expect(schoolB.schoolId).toBe(22);
  });
});

function promotionInput(overrides: Partial<PromotionRuleEvaluationInput> = {}): PromotionRuleEvaluationInput {
  return {
    context: { schoolId: 11, sessionId: 101 },
    policySchoolId: 11,
    maxFailedSubjectRules: [{ term: "Final", failCount: 2 }],
    attendanceRules: [{ term: "Final", minPercent: 75 }],
    termAverageRule: { enabled: true, minPct: 40 },
    cumulativeRule: { enabled: true, triggerTerm: "Final", minPercent: 45 },
    termFailCounts: { Final: 1 },
    termAverages: { Final: 40 },
    attendancePct: 75,
    currentTerm: "Final",
    cumulativePercentage: 45,
    ...overrides,
  };
}

describe("authoritative promotion rule evaluator", () => {
  it("promotes when every configured requirement is met exactly at its boundary", () => {
    expect(evaluatePromotionRules(promotionInput())).toEqual({
      promoted: true,
      promotionReason: "Meets all promotion criteria.",
      violations: [],
    });
  });

  it("treats the failed-subject threshold as an inclusive retention trigger", () => {
    expect(evaluatePromotionRules(promotionInput({ termFailCounts: { Final: 2 } })).promoted).toBe(false);
    expect(evaluatePromotionRules(promotionInput({ termFailCounts: { Final: 3 } })).promoted).toBe(false);
    expect(evaluatePromotionRules(promotionInput({ termFailCounts: { Final: 1 } })).promoted).toBe(true);
  });

  it("allows exact percentage minimums and retains below them", () => {
    expect(evaluatePromotionRules(promotionInput({ termAverages: { Final: 40 } })).promoted).toBe(true);
    expect(evaluatePromotionRules(promotionInput({ termAverages: { Final: 39.9 } })).violations)
      .toContain("The student's weighted average score for Final was 39.9%, which falls below the configured pass threshold of 40%.");
    expect(evaluatePromotionRules(promotionInput({ cumulativePercentage: 44.9 })).violations)
      .toContain("The student's cumulative year-end percentage of 44.9% falls below the required minimum threshold of 45%.");
    expect(evaluatePromotionRules(promotionInput({ attendancePct: 74.9 })).violations[0]).toContain("74.9%");
  });

  it("accumulates simultaneous violations while preserving the first reason", () => {
    const result = evaluatePromotionRules(promotionInput({
      termFailCounts: { Final: 2 },
      termAverages: { Final: 39 },
      attendancePct: 70,
      cumulativePercentage: 44,
    }));
    expect(result.violations).toHaveLength(4);
    expect(result.promotionReason).toBe(result.violations[0]);
  });

  it("ignores disabled optional rules but rejects a wholly missing required policy", () => {
    expect(evaluatePromotionRules(promotionInput({
      attendanceRules: undefined,
      termAverageRule: undefined,
      cumulativeRule: undefined,
    })).promoted).toBe(true);
    expect(() => evaluatePromotionRules(promotionInput({
      maxFailedSubjectRules: undefined,
      attendanceRules: undefined,
      termAverageRule: undefined,
      cumulativeRule: undefined,
    }))).toThrow("At least one configured promotion rule");
  });

  it("does not invent a violation when configured result data is unavailable", () => {
    expect(evaluatePromotionRules(promotionInput({
      termFailCounts: {},
      termAverages: { Final: null },
      attendancePct: null,
      cumulativePercentage: null,
    })).promoted).toBe(true);
  });

  it("preserves explicit zero thresholds without substituting defaults", () => {
    expect(evaluatePromotionRules(promotionInput({
      maxFailedSubjectRules: [{ term: "Final", failCount: 0 }],
      attendanceRules: undefined,
      termAverageRule: undefined,
      cumulativeRule: undefined,
      termFailCounts: { Final: 0 },
    })).promoted).toBe(false);
    expect(evaluatePromotionRules(promotionInput({
      maxFailedSubjectRules: undefined,
      attendanceRules: [{ term: "Final", minPercent: 0 }],
      termAverageRule: undefined,
      cumulativeRule: undefined,
      attendancePct: 0,
    })).promoted).toBe(true);
  });

  it("rejects missing or invalid enabled-rule configuration instead of using a fallback", () => {
    expect(() => evaluatePromotionRules(promotionInput({ maxFailedSubjectRules: [] })))
      .toThrow("requires at least one term threshold");
    expect(() => evaluatePromotionRules(promotionInput({
      maxFailedSubjectRules: undefined,
      attendanceRules: undefined,
      cumulativeRule: undefined,
      termAverageRule: { enabled: true, minPct: Number.NaN },
    }))).toThrow("configured percentage");
  });

  it("rejects a promotion policy from another tenant", () => {
    expect(() => evaluatePromotionRules(promotionInput({ policySchoolId: 22 })))
      .toThrow("Promotion policy school 22 does not match calculation school 11");
  });

  it("keeps the selected session in the surrounding examination result", () => {
    const [result] = computeAllStudentResults(input());
    expect(result.sessionId).toBe(101);
    expect(result.schoolId).toBe(11);
  });
});