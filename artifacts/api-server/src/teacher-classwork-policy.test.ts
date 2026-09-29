import assert from "node:assert/strict";
import test from "node:test";
import {
  isClassworkOwnedByTeacherInScope,
  parsePositiveSafeIntegerPathParam,
  type TeacherClassworkScope,
} from "./teacher-classwork-policy";

const scope: TeacherClassworkScope = { teacherId: 10, schoolId: 20, sessionId: 30 };

test("Classwork mutation scope requires the authenticated teacher, school, and selected session", () => {
  const record = { teacherId: 10, schoolId: 20, sessionId: 30 };
  assert.equal(isClassworkOwnedByTeacherInScope(record, scope), true);
  assert.equal(isClassworkOwnedByTeacherInScope({ ...record, teacherId: 11 }, scope), false);
  assert.equal(isClassworkOwnedByTeacherInScope({ ...record, schoolId: 21 }, scope), false);
  assert.equal(isClassworkOwnedByTeacherInScope({ ...record, sessionId: 31 }, scope), false);
  assert.equal(isClassworkOwnedByTeacherInScope({ ...record, sessionId: null }, scope), false);
});

test("Classwork route IDs accept only positive safe-integer path values", () => {
  assert.equal(parsePositiveSafeIntegerPathParam("42"), 42);
  for (const invalid of [undefined, 42, "", "0", "-1", "01", "42x", "9007199254740992", ["42"]]) {
    assert.equal(parsePositiveSafeIntegerPathParam(invalid), null);
  }
});