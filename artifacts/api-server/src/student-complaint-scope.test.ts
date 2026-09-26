import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  requireStudentComplaintSession,
  studentComplaintMatchesSession,
  studentComplaintSessionScope,
  validStudentPeerTarget,
} from "./student-complaint-scope";

const dialect = new PgDialect();

test("complaint list scope always binds both school and selected session", () => {
  const sessionA = dialect.sqlToQuery(studentComplaintSessionScope(4, 21));
  const sessionB = dialect.sqlToQuery(studentComplaintSessionScope(4, 22));
  assert.match(sessionA.sql, /school_id/);
  assert.match(sessionA.sql, /session_id/);
  assert.deepEqual(sessionA.params, [4, 21]);
  assert.deepEqual(sessionB.params, [4, 22]);
  assert.notDeepEqual(sessionA.params, sessionB.params);
});

test("missing, malformed and null-session complaint writes fail closed", () => {
  for (const sessionId of [undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => requireStudentComplaintSession(sessionId), /valid academic session/);
  }
  assert.doesNotThrow(() => requireStudentComplaintSession(21));
});

test("complaint detail and notes reject a different session, school or deleted case", () => {
  const complaint = { schoolId: 4, sessionId: 21, isDeleted: false };
  assert.equal(studentComplaintMatchesSession(complaint, 4, 21), true);
  assert.equal(studentComplaintMatchesSession(complaint, 4, 22), false);
  assert.equal(studentComplaintMatchesSession(complaint, 5, 21), false);
  assert.equal(studentComplaintMatchesSession({ ...complaint, sessionId: null }, 4, 21), false);
  assert.equal(studentComplaintMatchesSession({ ...complaint, isDeleted: true }, 4, 21), false);
});

test("peer reports permit same-school peers only and reject self or foreign-school targets", () => {
  const reporter = { id: 17, schoolId: 4 };
  assert.equal(validStudentPeerTarget(reporter, { id: 18, schoolId: 4 }), true);
  assert.equal(validStudentPeerTarget(reporter, { id: 17, schoolId: 4 }), false);
  assert.equal(validStudentPeerTarget(reporter, { id: 18, schoolId: 5 }), false);
  assert.equal(validStudentPeerTarget(reporter, null), false);
});