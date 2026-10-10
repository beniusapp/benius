import assert from "node:assert/strict";
import test from "node:test";
import { isStudentFeeRecordOwnedBySelectedSession, parseStudentFeeSessionHeader } from "./student-fee-session-id";

test("requires one exact positive safe session ID", () => {
  assert.deepEqual(parseStudentFeeSessionHeader("42"), { ok: true, sessionId: 42 });
  for (const value of [undefined, "", "42junk", "42.0", " 42", "0", "-1", "9007199254740992", ["42"]]) {
    assert.equal(parseStudentFeeSessionHeader(value as any).ok, false, String(value));
  }
});

test("document ownership requires the exact invoice, Student, school, and session", () => {
  const expected = { feeRecordId: 9, studentId: 4, schoolId: 3, sessionId: 42 };
  const row = { id: 9, studentId: 4, schoolId: 3, sessionId: 42 };
  assert.equal(isStudentFeeRecordOwnedBySelectedSession(row, expected), true);
  assert.equal(isStudentFeeRecordOwnedBySelectedSession({ ...row, studentId: 5 }, expected), false);
  assert.equal(isStudentFeeRecordOwnedBySelectedSession({ ...row, schoolId: 8 }, expected), false);
  assert.equal(isStudentFeeRecordOwnedBySelectedSession({ ...row, sessionId: 41 }, expected), false);
  assert.equal(isStudentFeeRecordOwnedBySelectedSession({ ...row, sessionId: null }, expected), false);
});
