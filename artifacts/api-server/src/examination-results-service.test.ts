import assert from "node:assert/strict";
import test from "node:test";
import {
  getClassExaminationResults,
  getStudentExaminationResults,
  type ExaminationResultsStorage,
} from "./examination-results-service";

const weights = JSON.stringify({
  "Term 1": [
    { source_exam: "Unit", weight: 40 },
    { source_exam: "Final", weight: 60 },
  ],
  "Term 2": [{ source_exam: "Midterm", weight: 100 }],
});

const gradingRules = [
  { id: 1, tierId: 1, gradeLabel: "F", minPercent: 0, maxPercent: 49.99, remarks: "Needs work", sortOrder: 1 },
  { id: 2, tierId: 1, gradeLabel: "C", minPercent: 50, maxPercent: 79.99, remarks: "Satisfactory", sortOrder: 2 },
  { id: 3, tierId: 1, gradeLabel: "B", minPercent: 80, maxPercent: 89.99, remarks: "Good", sortOrder: 3 },
  { id: 4, tierId: 1, gradeLabel: "A", minPercent: 90, maxPercent: 100, remarks: "Excellent", sortOrder: 4 },
];

const student = {
  id: 17,
  name: "Test Student",
  digitalStudentId: "DS-17",
  schoolId: 1,
  class: "9",
  section: "B",
  isActive: true,
};

type Score = {
  schoolId: number;
  studentId: number;
  sessionId: number;
  class: string;
  section: string;
  subject: string;
  examType: string;
  marks: number;
  totalMarks: number;
  isAbsent: boolean;
  published: boolean;
};

function score(subject: string, examType: string, marks: number, isAbsent = false, published = true): Score {
  return {
    schoolId: 1, studentId: student.id, sessionId: 21, class: "9", section: "B",
    subject, examType, marks, totalMarks: 100, isAbsent, published,
  };
}

const completeScores = [
  score("Math", "Unit", 80),
  score("Math", "Final", 50),
  score("Science", "Unit", 60),
  score("Science", "Final", 90),
];

function makeStore(scores: Score[] = completeScores) {
  const calls: {
    roster: unknown[][];
    teacherScores: unknown[][];
    studentScores: unknown[][];
  } = { roster: [], teacherScores: [], studentScores: [] };
  const store = {
    async getAcademicSessionForSchool(sessionId: number, schoolId: number) {
      return sessionId === 21 && schoolId === 1
        ? { id: 21, schoolId: 1, isActive: false, startDate: "2024-01-01", endDate: "2024-12-31" }
        : undefined;
    },
    async getExamPolicyTiers(schoolId: number) {
      return schoolId === 1 ? [{
        id: 4, schoolId: 1, tierName: "Standard", applicableClasses: ["9"],
        examWeights: weights, promotionFailRules: "{}", resultsConfig: "{}",
      }] : [];
    },
    async getClassSubjectsMap(schoolId: number) {
      return schoolId === 1 ? { "9": ["Math", "Science"] } : {};
    },
    async resolveClassPassPolicy(schoolId: number, cls: string) {
      return schoolId === 1 && cls === "9"
        ? { id: 1, schoolId: 1, passPercentage: 75 }
        : undefined;
    },
    async getGradingRules(schoolId: number) {
      return schoolId === 1 ? gradingRules : [];
    },
    async getExaminationResultsRosterForSession(...args: unknown[]) {
      calls.roster.push(args);
      return args[0] === 1 && args[1] === 21 && args[2] === "9" && args[3] === "B"
        ? [{ student, rollNumber: 4 }]
        : [];
    },
    async getTeacherExamScoresByStudentInClassSession(...args: unknown[]) {
      calls.teacherScores.push(args);
      return scores;
    },
    async getStudentAllExamScores(...args: unknown[]) {
      calls.studentScores.push(args);
      return scores;
    },
    async getStudentAttendanceAggregatesForSessionClass() {
      return [];
    },
  } as unknown as ExaminationResultsStorage;
  return { store, calls };
}

const classContext = {
  schoolId: 1,
  sessionId: 21,
  className: "9",
  sectionName: "B",
  selectedTerm: "Term 1",
};

test("complete weighted results, configured grades, and evaluated failures come from the shared engine", async () => {
  const { store } = makeStore();
  const response = await getClassExaminationResults(classContext, true, store);
  const result = response.results[0];
  assert.equal(response.promotionAssessmentAvailable, false);
  assert.equal(result.rollNumber, 4);
  assert.equal(result.termResults["Term 1"][0].percentage, 62);
  assert.equal(result.termResults["Term 1"][0].grade?.label, "C");
  assert.equal(result.termAverages["Term 1"], 70);
  assert.equal(result.termGrades["Term 1"]?.label, "C");
  assert.equal(result.allTermFailCounts["Term 1"], 1);
  assert.equal(result.resultStatus, "complete");
  assert.equal(result.promoted, null);
});

test("Teacher and Principal result views return the same academic calculations", async () => {
  const teacher = await getClassExaminationResults(classContext, true, makeStore().store);
  const principal = await getClassExaminationResults(classContext, false, makeStore().store);
  const teacherResult = teacher.results[0];
  const principalResult = principal.results[0];

  assert.deepEqual(principalResult.termResults, teacherResult.termResults);
  assert.deepEqual(principalResult.termAverages, teacherResult.termAverages);
  assert.deepEqual(principalResult.termGrades, teacherResult.termGrades);
  assert.deepEqual(principalResult.allTermFailCounts, teacherResult.allTermFailCounts);
  assert.equal(principalResult.resultStatus, teacherResult.resultStatus);
});

test("missing component or configured subject makes the term incomplete and suppresses final metrics", async () => {
  const missingComponent = completeScores.filter(row => !(row.subject === "Math" && row.examType === "Final"));
  const componentResult = (await getClassExaminationResults(classContext, false, makeStore(missingComponent).store)).results[0];
  assert.equal(componentResult.termResults["Term 1"].find(row => row.subject === "Math")?.status, "incomplete");
  assert.equal(componentResult.resultStatus, "incomplete");
  assert.equal(componentResult.termAverages["Term 1"], null);
  assert.equal(componentResult.termGrades["Term 1"], null);
  assert.equal(componentResult.allTermFailCounts["Term 1"], null);

  const missingSubject = completeScores.filter(row => row.subject !== "Science");
  const subjectResult = (await getClassExaminationResults(classContext, false, makeStore(missingSubject).store)).results[0];
  assert.equal(subjectResult.termResults["Term 1"].find(row => row.subject === "Science")?.status, "incomplete");
  assert.equal(subjectResult.resultStatus, "incomplete");
  assert.equal(subjectResult.termAverages["Term 1"], null);
});

test("a real zero stays scored and Absent remains distinct from missing data", async () => {
  const withZero = completeScores.map(row =>
    row.subject === "Math" ? { ...row, marks: 0 } : row
  );
  const zeroResult = (await getClassExaminationResults(classContext, false, makeStore(withZero).store)).results[0];
  const zeroSubject = zeroResult.termResults["Term 1"].find(row => row.subject === "Math");
  assert.equal(zeroSubject?.status, "scored");
  assert.equal(zeroSubject?.percentage, 0);
  assert.equal(zeroSubject?.passed, false);
  assert.equal(zeroResult.allTermFailCounts["Term 1"], 1);

  const withAbsent = completeScores.map(row =>
    row.subject === "Math" ? { ...row, marks: 0, isAbsent: true } : row
  );
  const absentResult = (await getClassExaminationResults(classContext, false, makeStore(withAbsent).store)).results[0];
  const absentSubject = absentResult.termResults["Term 1"].find(row => row.subject === "Math");
  assert.equal(absentSubject?.status, "absent");
  assert.equal(absentSubject?.percentage, 0);
  assert.equal(absentResult.resultStatus, "complete");
  assert.equal(absentResult.allTermFailCounts["Term 1"], 1);
});

test("a mixed Absent and missing component remains incomplete rather than a partial result", async () => {
  const mixed = completeScores.filter(row => !(row.subject === "Math" && row.examType === "Final"))
    .map(row => row.subject === "Math" ? { ...row, isAbsent: true } : row);
  const result = (await getClassExaminationResults(classContext, false, makeStore(mixed).store)).results[0];
  const math = result.termResults["Term 1"].find(row => row.subject === "Math");
  assert.equal(math?.status, "incomplete");
  assert.equal(math?.percentage, null);
  assert.equal(result.resultStatus, "incomplete");
  assert.equal(result.termAverages["Term 1"], null);
  assert.equal(result.allTermFailCounts["Term 1"], null);
});

test("Student result reads use exact authenticated cohort parameters and published rows only", async () => {
  const rows = [
    score("Math", "Unit", 80, false, true),
    score("Math", "Final", 50, false, false),
    score("Science", "Unit", 60, false, true),
    score("Science", "Final", 90, false, false),
  ];
  const { store, calls } = makeStore(rows);
  const response = await getStudentExaminationResults({
    schoolId: 1,
    sessionId: 21,
    className: "9",
    sectionName: "B",
    student: { id: 17, name: "Test Student", digitalStudentId: "DS-17" },
    rollNumber: 4,
  }, store);
  assert.deepEqual(calls.studentScores, [[1, 17, "9", 21, "B"]]);
  assert.equal(response.result.studentId, 17);
  assert.equal(response.result.resultStatusByTerm["Term 1"], "incomplete");
  assert.equal(response.result.termAverages["Term 1"], null);
  assert.equal(response.result.allTermFailCounts["Term 1"], null);
  assert.equal(response.result.termResults["Term 1"].find(row => row.subject === "Math")?.breakdown[1].status, "missing");
  for (const privateField of ["promoted", "promotionReason", "detentionViolations", "cumulativePercentage"]) {
    assert.equal(privateField in response.result, false);
  }
});

test("class result roster and score reads are fixed to the authenticated school/session/cohort", async () => {
  const { store, calls } = makeStore();
  await getClassExaminationResults(classContext, false, store);
  assert.deepEqual(calls.roster, [[1, 21, "9", "B"]]);
  assert.deepEqual(calls.teacherScores, [[17, 1, 21, "9", "B"]]);
});
