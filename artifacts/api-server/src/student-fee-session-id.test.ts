import assert from "node:assert/strict";
import test from "node:test";
import { parseStudentFeeSessionHeader } from "./student-fee-session-id";

test("requires one exact positive safe session ID", () => {
  assert.deepEqual(parseStudentFeeSessionHeader("42"), { ok: true, sessionId: 42 });
  for (const value of [undefined, "", "42junk", "42.0", " 42", "0", "-1", "9007199254740992", ["42"]]) {
    assert.equal(parseStudentFeeSessionHeader(value as any).ok, false, String(value));
  }
});
