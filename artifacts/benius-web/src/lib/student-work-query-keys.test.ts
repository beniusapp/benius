import assert from "node:assert/strict";
import test from "node:test";
import {
  classworkQueryKey,
  homeworkPendingDatesQueryKey,
  homeworkQueryKey,
} from "./student-work-query-keys";

test("L: A → B → A uses distinct Homework and Classwork cache identities", () => {
  const day = "2026-09-26";
  const month = "2026-09";
  for (const key of [
    (sessionId: number) => homeworkQueryKey(sessionId, day),
    (sessionId: number) => homeworkPendingDatesQueryKey(sessionId, month),
    (sessionId: number) => classworkQueryKey(sessionId, day),
  ]) {
    const firstA = key(21);
    const b = key(22);
    const secondA = key(21);
    assert.notDeepEqual(firstA, b);
    assert.deepEqual(firstA, secondA);
    assert.equal(firstA[1], 21);
    assert.equal(b[1], 22);
  }
});

test("date/month filters also have separate cache identities", () => {
  assert.notDeepEqual(homeworkQueryKey(21, "2026-09-26"), homeworkQueryKey(21, "2026-09-27"));
  assert.notDeepEqual(
    homeworkPendingDatesQueryKey(21, "2026-09"),
    homeworkPendingDatesQueryKey(21, "2026-10"),
  );
});