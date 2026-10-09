import assert from "node:assert/strict";
import test from "node:test";
import {
  studentExamPolicyQueryKey, studentExamScoresQueryKey,
  studentExamResultsQueryKey,
  studentArchiveJourneyQueryKey, studentArchiveTypesQueryKey, studentArchiveScoresQueryKey,
} from "./student-exam-query-keys";

test("P: A → B → A isolates every session-specific Examination and Report Card cache", () => {
  const keys = [
    (id: number) => studentExamPolicyQueryKey(id, "8"),
    (id: number) => studentExamScoresQueryKey(id, "8"),
    studentArchiveJourneyQueryKey,
    studentArchiveTypesQueryKey,
    (id: number) => studentArchiveScoresQueryKey(id, "Annual"),
  ];
  for (const key of keys) {
    assert.notDeepEqual(key(21), key(22));
    assert.deepEqual(key(21), key(21));
  }
  assert.notDeepEqual(studentArchiveScoresQueryKey(21, "Annual"), studentArchiveScoresQueryKey(21, "Term 1"));
});

test("Student Results cache identity includes school, Student, role, session, class, and section", () => {
  const baseline = studentExamResultsQueryKey(1, 17, 21, "8", "A");
  for (const key of [
    studentExamResultsQueryKey(2, 17, 21, "8", "A"),
    studentExamResultsQueryKey(1, 18, 21, "8", "A"),
    studentExamResultsQueryKey(1, 17, 22, "8", "A"),
    studentExamResultsQueryKey(1, 17, 21, "9", "A"),
    studentExamResultsQueryKey(1, 17, 21, "8", "B"),
  ]) {
    assert.notDeepEqual(key, baseline);
  }
  assert.deepEqual(studentExamResultsQueryKey(1, 17, 21, "8", "A"), baseline);
  assert.equal(baseline[2], "student");
});