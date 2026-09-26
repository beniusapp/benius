import assert from "node:assert/strict";
import test from "node:test";
import { studentLeaveQueryKey } from "./student-leave-query-keys";

test("Student Leave A → B → A uses separate session cache identities", () => {
  const firstA = studentLeaveQueryKey(21, 17);
  const sessionB = studentLeaveQueryKey(22, 17);
  const secondA = studentLeaveQueryKey(21, 17);

  assert.notDeepEqual(firstA, sessionB);
  assert.deepEqual(firstA, secondA);
  assert.equal(firstA[1], 21);
  assert.equal(sessionB[1], 22);
  assert.notDeepEqual(studentLeaveQueryKey(null, 17), firstA);
});