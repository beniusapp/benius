import assert from "node:assert/strict";
import test from "node:test";
import {
  studentComplaintFiledQueryKey,
  studentComplaintInboxQueryKey,
  studentComplaintNotesQueryKey,
} from "./student-complaint-query-keys";

test("Student Complaints A → B → A uses isolated session-specific cache identities", () => {
  const complaintId = 37;
  const keys = [
    (sessionId: number | null) => studentComplaintInboxQueryKey(sessionId),
    (sessionId: number | null) => studentComplaintFiledQueryKey(sessionId),
    (sessionId: number | null) => studentComplaintNotesQueryKey(complaintId, sessionId),
  ];

  for (const key of keys) {
    const firstA = key(21);
    const b = key(22);
    const secondA = key(21);
    assert.notDeepEqual(firstA, b);
    assert.deepEqual(firstA, secondA);
  }

  assert.equal(studentComplaintInboxQueryKey(21)[1], 21);
  assert.equal(studentComplaintFiledQueryKey(22)[1], 22);
  assert.equal(studentComplaintNotesQueryKey(complaintId, 21)[3], 21);
  assert.notDeepEqual(studentComplaintInboxQueryKey(null), studentComplaintInboxQueryKey(21));
});