import assert from "node:assert/strict";
import test from "node:test";
import {
  studentExamPolicyQueryKey, studentExamScoresQueryKey,
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