import assert from "node:assert/strict";
import test from "node:test";
import { studentNoticeQueryKey } from "./student-notice-query-key";

test("Student Noticeboard A → B → A has separate cache identities", () => {
  const a = studentNoticeQueryKey(21);
  const b = studentNoticeQueryKey(22);
  assert.notDeepEqual(a, b);
  assert.deepEqual(studentNoticeQueryKey(21), a);
  assert.equal(a[1], 21);
  assert.equal(b[1], 22);
});