import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { requireStudentLeaveSession, studentLeaveSessionScope } from "./student-leave-scope";

const dialect = new PgDialect();

test("Student Leave scope always binds owner, school and exact selected session", () => {
  const sessionA = dialect.sqlToQuery(studentLeaveSessionScope(17, 4, 21));
  const sessionB = dialect.sqlToQuery(studentLeaveSessionScope(17, 4, 22));
  assert.match(sessionA.sql, /student_id/);
  assert.match(sessionA.sql, /school_id/);
  assert.match(sessionA.sql, /session_id/);
  assert.deepEqual(sessionA.params, [17, 4, 21]);
  assert.deepEqual(sessionB.params, [17, 4, 22]);
  assert.notDeepEqual(sessionA.params, sessionB.params);
  assert.notDeepEqual(sessionA.params, dialect.sqlToQuery(studentLeaveSessionScope(18, 4, 21)).params);
});

test("missing, null and malformed Student Leave sessions fail closed", () => {
  for (const sessionId of [undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => requireStudentLeaveSession(sessionId), /valid academic session/);
    assert.throws(() => studentLeaveSessionScope(17, 4, sessionId as number), /valid academic session/);
  }
  assert.doesNotThrow(() => requireStudentLeaveSession(21));
});