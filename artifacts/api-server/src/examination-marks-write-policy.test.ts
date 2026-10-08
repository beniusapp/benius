import assert from "node:assert/strict";
import test from "node:test";
import {
  classScopedConfigValues,
  configuredClassName,
  configuredName,
  examTypeAffectsLockedPromotionTerm,
  parseTeacherExamMarksSubmission,
  publicationStateForExamScore,
} from "./examination-marks-write-policy";
import { PromotionStage1Error } from "./promotion-stage1";

const validSubmission = {
  class: "Class 5",
  section: "A",
  subject: "Mathematics",
  examType: "Term 1",
  totalMarks: 50,
  scores: [{ studentId: 10, marks: 36, isAbsent: false }],
};

test("accepts a fully marked score batch with an explicit total", () => {
  const result = parseTeacherExamMarksSubmission(validSubmission);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.totalMarks, 50);
    assert.equal(result.data.scores[0].marks, 36);
  }
});

test("rejects an omitted mark instead of silently converting it to zero", () => {
  const result = parseTeacherExamMarksSubmission({
    ...validSubmission,
    scores: [{ studentId: 10, isAbsent: false }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /missing mark cannot be saved as zero/i);
});

test("rejects a blank present-student mark", () => {
  const result = parseTeacherExamMarksSubmission({
    ...validSubmission,
    scores: [{ studentId: 10, marks: "", isAbsent: false }],
  });
  assert.equal(result.ok, false);
});

test("accepts an explicitly absent Student as zero with a separate absent flag", () => {
  const result = parseTeacherExamMarksSubmission({
    ...validSubmission,
    scores: [{ studentId: 10, isAbsent: true }],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data.scores[0], { studentId: 10, marks: 0, isAbsent: true });
});

test("rejects non-zero marks on an absent Student", () => {
  const result = parseTeacherExamMarksSubmission({
    ...validSubmission,
    scores: [{ studentId: 10, marks: 1, isAbsent: true }],
  });
  assert.equal(result.ok, false);
});

test("rejects marks greater than total marks", () => {
  const result = parseTeacherExamMarksSubmission({
    ...validSubmission,
    scores: [{ studentId: 10, marks: 51, isAbsent: false }],
  });
  assert.equal(result.ok, false);
});

test("rejects negative marks", () => {
  const result = parseTeacherExamMarksSubmission({
    ...validSubmission,
    scores: [{ studentId: 10, marks: -1, isAbsent: false }],
  });
  assert.equal(result.ok, false);
});

test("rejects non-integer mark values", () => {
  const result = parseTeacherExamMarksSubmission({
    ...validSubmission,
    scores: [{ studentId: 10, marks: 2.5, isAbsent: false }],
  });
  assert.equal(result.ok, false);
});

test("rejects a missing or invalid total-mark maximum", () => {
  for (const totalMarks of [undefined, 0, -1, 2.25, ""]) {
    const result = parseTeacherExamMarksSubmission({ ...validSubmission, totalMarks });
    assert.equal(result.ok, false);
  }
});

test("rejects duplicate Student entries in one atomic batch", () => {
  const result = parseTeacherExamMarksSubmission({
    ...validSubmission,
    scores: [
      { studentId: 10, marks: 36, isAbsent: false },
      { studentId: 10, marks: 40, isAbsent: false },
    ],
  });
  assert.equal(result.ok, false);
});

test("requires the request to explicitly identify absence status", () => {
  const result = parseTeacherExamMarksSubmission({
    ...validSubmission,
    scores: [{ studentId: 10, marks: 0 }],
  });
  assert.equal(result.ok, false);
});

test("class-scoped configuration resolves equivalent Class labels", () => {
  const values = classScopedConfigValues({ "Class 5": ["Mathematics"] }, "5");
  assert.deepEqual(values, ["Mathematics"]);
  assert.equal(configuredName(values ?? [], "mathematics"), "Mathematics");
  assert.equal(configuredClassName(["Class 5"], { "5": [] }, "5"), "Class 5");
});

test("class-scoped configuration rejects ambiguous duplicate class keys", () => {
  assert.deepEqual(
    classScopedConfigValues({ "5": ["Mathematics"], "Class 5": ["Science"] }, "Class 5"),
    [],
  );
});

test("Web visibility can be set explicitly while legacy writes preserve the existing published state", () => {
  assert.deepEqual(publicationStateForExamScore(true), { published: true });
  assert.deepEqual(publicationStateForExamScore(false), { published: false });
  assert.deepEqual(publicationStateForExamScore(undefined), {});
});

const termPolicy = {
  examWeights: JSON.stringify({
    "Term 1": [{ source_exam: "Unit Test", weight: 100 }],
    "Term 2": [{ source_exam: "Final Exam", weight: 100 }],
    "Final Term": [{ source_exam: "Final Exam", weight: 100 }],
  }),
  promotionFailRules: "{}",
  resultsConfig: "{}",
};

test("blocks a mark write when its exam component is in the locked decision term", () => {
  assert.equal(examTypeAffectsLockedPromotionTerm({
    ...termPolicy,
    examType: "Unit Test",
    lockedTerm: "Term 1",
  }), true);
});

test("does not block an unrelated examination term", () => {
  assert.equal(examTypeAffectsLockedPromotionTerm({
    ...termPolicy,
    examType: "Final Exam",
    lockedTerm: "Term 1",
  }), false);
});

test("blocks a prior-term score when the locked decision's failure rule references it", () => {
  assert.equal(examTypeAffectsLockedPromotionTerm({
    ...termPolicy,
    promotionFailRules: JSON.stringify({
      rule1: { enabled: true, rules: [{ term: "Term 1", fail_count: 2 }] },
    }),
    examType: "Unit Test",
    lockedTerm: "Term 2",
  }), true);
});

test("does not block a prior-term score when the failure rule threshold is disabled", () => {
  assert.equal(examTypeAffectsLockedPromotionTerm({
    ...termPolicy,
    promotionFailRules: JSON.stringify({
      rule1: { enabled: true, rules: [{ term: "Term 1", fail_count: 0 }] },
    }),
    examType: "Unit Test",
    lockedTerm: "Term 2",
  }), false);
});

test("blocks a source term used by an enabled cumulative promotion trigger", () => {
  assert.equal(examTypeAffectsLockedPromotionTerm({
    ...termPolicy,
    resultsConfig: JSON.stringify({
      cumulative: {
        enabled: true,
        promotionEnabled: true,
        triggerTerm: "Final Term",
        termWeights: { "Term 1": 40, "Term 2": 60 },
      },
    }),
    examType: "Unit Test",
    lockedTerm: "Final Term",
  }), true);
});

test("does not apply a cumulative dependency to a different locked trigger term", () => {
  assert.equal(examTypeAffectsLockedPromotionTerm({
    ...termPolicy,
    resultsConfig: JSON.stringify({
      cumulative: {
        enabled: true,
        promotionEnabled: true,
        triggerTerm: "Final Term",
        termWeights: { "Term 1": 40, "Term 2": 60 },
      },
    }),
    examType: "Unit Test",
    lockedTerm: "Term 2",
  }), false);
});

test("fails closed when a locked-ledger policy cannot be parsed", () => {
  assert.throws(() => examTypeAffectsLockedPromotionTerm({
    ...termPolicy,
    examWeights: "{",
    examType: "Unit Test",
    lockedTerm: "Term 1",
  }), PromotionStage1Error);
});
