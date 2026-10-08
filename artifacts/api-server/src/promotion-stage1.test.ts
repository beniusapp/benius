import assert from "node:assert/strict";
import test from "node:test";
import {
  PromotionStage1Error,
  validatePromotionExecutionBatch,
  validatePromotionExecutionRoster,
  validatePromotionSessionContext,
  type PromotionExecutionItem,
  type PromotionStudentRow,
  type PromotionEnrollmentRow,
} from "./promotion-stage1";
import { computeAllStudentResults } from "./shared/examination-calculation-engine";

const activeSession = { id: 42, schoolId: 11, isActive: true };
const archivedSession = { id: 41, schoolId: 11, isActive: false };

function result(header: unknown, session: typeof activeSession | typeof archivedSession | undefined, mode: "read" | "write" = "write") {
  return validatePromotionSessionContext(header, 11, session, mode);
}

test("Promotion session context requires a well-formed, school-owned session", () => {
  assert.equal(result(undefined, activeSession).ok, false);
  assert.equal(result("42abc", activeSession).ok, false);
  assert.equal(result(["42", "43"], activeSession).ok, false);
  assert.equal(result("42", undefined).ok, false);
  assert.equal(validatePromotionSessionContext("42", 12, activeSession, "write").ok, false);
  assert.equal(result("42", activeSession).ok, true);
});

test("Promotion permits archived-session reads but denies archived-session writes", () => {
  assert.equal(result("41", archivedSession, "read").ok, true);
  const denied = result("41", archivedSession, "write");
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.status, 403);
    assert.equal(denied.code, "HISTORICAL_SESSION_READ_ONLY");
  }
});

const item: PromotionExecutionItem = {
  studentId: 7,
  fromClass: "5",
  fromSection: "A",
  nextClass: "6",
  nextSection: "A",
  examType: "Term 2",
  totalObtained: 480,
  totalMax: 600,
  percentage: 80,
};
const student: PromotionStudentRow = {
  id: 7, schoolId: 11, isActive: true, dsid: "B-007", name: "Student One",
};
const enrollment: PromotionEnrollmentRow = {
  studentId: 7,
  schoolId: 11,
  sessionId: 42,
  className: "5",
  sectionName: "A",
  status: "Active",
};

test("Promotion batch rejects missing terms, duplicate Students, and mixed cohorts", () => {
  assert.throws(() => validatePromotionExecutionBatch([item], undefined), PromotionStage1Error);
  assert.throws(() => validatePromotionExecutionBatch([item, item], "Term 2"), PromotionStage1Error);
  assert.throws(() => validatePromotionExecutionBatch([
    item,
    { ...item, studentId: 8, fromSection: "B" },
  ], "Term 2"), PromotionStage1Error);
  assert.doesNotThrow(() => validatePromotionExecutionBatch([item], "Term 2"));
});

test("Promotion results distinguish no marks, partial components, real zero, and completed absence", () => {
  const score = (examType: string, marks: number, isAbsent = false) => ({
    subject: "Mathematics",
    examType,
    marks,
    totalMarks: 100,
    isAbsent,
  });
  const calculate = (scores: ReturnType<typeof score>[]) => computeAllStudentResults({
    context: { schoolId: 11, sessionId: 42 },
    students: [{
      studentId: 7, name: "Student One", digitalStudentId: "B-007", rollNumber: 1, scores,
    }],
    policy: {
      schoolId: 11,
      examWeights: JSON.stringify({
        "Annual result": [
          { source_exam: "Midterm", weight: 40 },
          { source_exam: "Annual", weight: 60 },
        ],
      }),
      promotionFailRules: "{}",
    },
    attendance: [],
    passPercentage: 40,
    gradingPolicy: { schoolId: 11 },
    gradingRules: [{
      id: 1, tierId: 1, gradeLabel: "Pass", minPercent: 0, maxPercent: 100,
      remarks: null, sortOrder: 0,
    }],
    termAverageRule: { enabled: true, minPct: 0 },
    currentTerm: "Annual result",
  })[0];

  assert.equal(calculate([]).resultStatus, "incomplete");
  assert.equal(calculate([]).promoted, null);
  assert.equal(calculate([score("Midterm", 0)]).resultStatus, "incomplete");
  assert.equal(calculate([score("Midterm", 0), score("Annual", 100)]).resultStatus, "complete");
  assert.equal(calculate([score("Midterm", 0, true)]).resultStatus, "incomplete");
  assert.equal(calculate([score("Midterm", 0, true), score("Annual", 10)]).resultStatus, "complete");
});

test("Promotion roster accepts only an active owned Student with an active matching source enrollment", () => {
  const placements = validatePromotionExecutionRoster(11, 42, [item], [student], [enrollment]);
  assert.deepEqual(placements, [{
    studentId: 7,
    dsid: "B-007",
    name: "Student One",
    fromClass: "5",
    fromSection: "A",
  }]);

  const invalidCases: Array<{
    students: PromotionStudentRow[];
    enrollments: PromotionEnrollmentRow[];
  }> = [
    { students: [], enrollments: [enrollment] },
    { students: [{ ...student, schoolId: 12 }], enrollments: [enrollment] },
    { students: [{ ...student, isActive: false }], enrollments: [enrollment] },
    { students: [student], enrollments: [] },
    { students: [student], enrollments: [{ ...enrollment, status: "Inactive" }] },
    { students: [student], enrollments: [{ ...enrollment, sessionId: 41 }] },
    { students: [student], enrollments: [{ ...enrollment, schoolId: 12 }] },
    { students: [student], enrollments: [{ ...enrollment, className: "4" }] },
    { students: [student], enrollments: [{ ...enrollment, sectionName: "B" }] },
  ];

  for (const testCase of invalidCases) {
    assert.throws(
      () => validatePromotionExecutionRoster(11, 42, [item], testCase.students, testCase.enrollments),
      error => error instanceof PromotionStage1Error && error.code === "STUDENT_NOT_IN_SOURCE_SESSION",
    );
  }
});
