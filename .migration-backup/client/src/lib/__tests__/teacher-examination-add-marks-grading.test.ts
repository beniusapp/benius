import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectGrade, type GradingRule } from "@shared/examination-calculation-engine";
import { calculateAddMarksPercentage } from "@/pages/teacher-modules/examination";

const source = fs.readFileSync(
  path.join(process.cwd(), "client/src/pages/teacher-modules/examination.tsx"),
  "utf8",
);

const classSixRules: GradingRule[] = [
  { id: 29, tierId: 3, schoolId: 1, gradeLabel: "A", minPercent: 80, maxPercent: 100, gradePoint: "", remarks: "Excellent", sortOrder: 0 },
  { id: 30, tierId: 3, schoolId: 1, gradeLabel: "B", minPercent: 60, maxPercent: 79, gradePoint: "", remarks: "Good", sortOrder: 1 },
  { id: 31, tierId: 3, schoolId: 1, gradeLabel: "C", minPercent: 35, maxPercent: 59, gradePoint: "", remarks: "Below Average", sortOrder: 2 },
  { id: 32, tierId: 3, schoolId: 1, gradeLabel: "D", minPercent: 0, maxPercent: 34, gradePoint: "", remarks: "Poor / Fail", sortOrder: 3 },
];

describe("Teacher Examination Add Marks grading policy wiring", () => {
  it("loads Add Marks rules from selectedClass independently of View Marks", () => {
    expect(source).toContain("const [addMarksGradingRules, setAddMarksGradingRules]");
    expect(source).toContain("if (!selectedClass)");
    expect(source).toContain("/api/teacher/grading-rules/${encodeURIComponent(selectedClass)}");
    expect(source).toContain("computeGrade(pct, addMarksGradingRules)");
    expect(source).not.toContain("computeGrade(pct, viewGradingRules);\n                        const isOverMax");
  });

  it("clears stale Add Marks rules and guards rendering while policy is unavailable", () => {
    expect(source).toContain("setAddMarksGradingRules([])");
    expect(source).toContain("setAddMarksGradingLoading(true)");
    expect(source).toContain('data-testid="add-marks-grading-loading"');
    expect(source).toContain('data-testid="add-marks-grading-error"');
    expect(source).toContain("addMarksGradingRules.length > 0");
  });

  it.each([
    [0, "D"], [34, "D"],
    [35, "C"], [59, "C"],
    [60, "B"], [79, "B"],
    [80, "A"], [100, "A"],
  ])("preserves configured Class 6 boundary %i as grade %s", (percentage, expectedGrade) => {
    expect(selectGrade(percentage, classSixRules).label).toBe(expectedGrade);
  });

  it.each([
    ["0", 20, 0, "D"],
    ["7", 20, 35, "C"],
    ["12", 20, 60, "B"],
    ["16", 20, 80, "A"],
    ["20", 20, 100, "A"],
  ])("calculates valid mark %s/%i as %i%% grade %s", (mark, total, expectedPercentage, expectedGrade) => {
    const percentage = calculateAddMarksPercentage(mark, total);
    expect(percentage).toBe(expectedPercentage);
    expect(selectGrade(percentage!, classSixRules).label).toBe(expectedGrade);
  });

  it.each([
    ["21", 20],
    ["-1", 20],
    ["not-a-number", 20],
    ["193", 100],
    ["20", 0],
    ["20", Number.NaN],
  ])("rejects invalid mark %s with total %s before grade selection", (mark, total) => {
    expect(calculateAddMarksPercentage(mark, total)).toBeNull();
  });

  it("preserves the existing empty-mark display calculation as zero", () => {
    expect(calculateAddMarksPercentage("", 20)).toBe(0);
  });

  it("guards grade selection behind a valid percentage", () => {
    expect(source).toContain("const g = pct !== null ? computeGrade(pct, addMarksGradingRules) : null");
    expect(source).toContain("hasValidTotalMarks && !hasInvalidMarks");
  });
});