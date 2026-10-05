import assert from "node:assert/strict";
import { db } from "./db";
import { PgDialect } from "drizzle-orm/pg-core";
import test from "node:test";
import { storage } from "./storage";
import {
  teacherStudentLeaveAssignments,
  teacherStudentLeaveEnrollmentJoin,
  teacherStudentLeaveQueueSessionScope,
  teacherStudentLeaveSessionScope,
  teacherStudentLeaveStudentJoin,
} from "./teacher-student-leave-scope";

const dialect = new PgDialect();

test("legacy Teacher Student Leave SQL scope binds school, exact session, pending status, and enrollment cohort", () => {
  const query = dialect.sqlToQuery(teacherStudentLeaveSessionScope(4, 21, "7", "A"));

  assert.match(query.sql, /student_leave_requests.*school_id/);
  assert.match(query.sql, /student_leave_requests.*session_id/);
  assert.match(query.sql, /student_leave_requests.*status/);
  assert.match(query.sql, /enrollments.*school_id/);
  assert.match(query.sql, /enrollments.*session_id/);
  assert.match(query.sql, /enrollments.*class_name/);
  assert.match(query.sql, /enrollments.*section_name/);
  assert.match(query.sql, /students.*school_id/);
  assert.doesNotMatch(query.sql, /students.*class/);
  assert.doesNotMatch(query.sql, /students.*section/);
  assert.deepEqual(query.params, [4, 21, "pending_teacher", 4, 21, "7", "A", 4]);
});

test("request joins require the same school and selected-session enrollment", () => {
  const enrollmentJoin = dialect.sqlToQuery(teacherStudentLeaveEnrollmentJoin());
  assert.match(enrollmentJoin.sql, /enrollments.*school_id.*student_leave_requests.*school_id/);
  assert.match(enrollmentJoin.sql, /enrollments.*student_id.*student_leave_requests.*student_id/);
  assert.match(enrollmentJoin.sql, /enrollments.*session_id.*student_leave_requests.*session_id/);
  assert.deepEqual(enrollmentJoin.params, []);

  const studentJoin = dialect.sqlToQuery(teacherStudentLeaveStudentJoin());
  assert.match(studentJoin.sql, /students.*id.*enrollments.*student_id/);
  assert.match(studentJoin.sql, /students.*school_id.*enrollments.*school_id/);
  assert.deepEqual(studentJoin.params, []);
});

test("invalid tenant/session/cohort values fail closed", () => {
  for (const [schoolId, sessionId, className, sectionName] of [
    [0, 21, "7", "A"],
    [4, 0, "7", "A"],
    [4, 21, "", "A"],
    [4, 21, "7", "  "],
  ] as const) {
    assert.throws(() => teacherStudentLeaveSessionScope(
      schoolId, sessionId, className, sectionName,
    ));
  }
});

test("queue assignment and session scope uses enrollment placement, never current profile placement", () => {
  const assignments = teacherStudentLeaveAssignments(
    { assignedClass: "6", assignedSection: "C" },
    [{ className: "7", section: "A" }, { className: "8", section: "B" }],
  );
  const query = dialect.sqlToQuery(teacherStudentLeaveQueueSessionScope(4, 21, assignments)!);

  assert.match(query.sql, /enrollments.*class_name/);
  assert.match(query.sql, /enrollments.*section_name/);
  assert.equal(query.sql.includes('"students"."class"'), false);
  assert.equal(query.sql.includes('"students"."section"'), false);
  assert.deepEqual(query.params, [
    4, 21, "pending_teacher", 4, 21, 4,
    "6", "C", "7", "A", "8", "B",
  ]);
});

test("queue scope returns no query for a Teacher with no existing assignment", () => {
  assert.equal(teacherStudentLeaveQueueSessionScope(4, 21, []), undefined);
  assert.deepEqual(
    teacherStudentLeaveAssignments({}, []),
    [],
  );
});

test("storage applies the SQL scope and preserves the legacy response fields", async () => {
  const originalSelect = (db as any).select;
  const calls: { joins: Array<{ table: unknown; on: unknown }>; where?: unknown } = { joins: [] };
  const sourceLeave = {
    id: 31,
    studentId: 99,
    schoolId: 4,
    sessionId: 21,
    status: "pending_teacher",
  };
  const sourceStudent = {
    name: "Nina",
    digitalStudentId: "D-99",
    photoUrl: "/uploads/student.png",
  };
  const chain = {
    from(_table: unknown) { return this; },
    innerJoin(table: unknown, on: unknown) {
      calls.joins.push({ table, on });
      return this;
    },
    where(condition: unknown) {
      calls.where = condition;
      return this;
    },
    orderBy: async (_order: unknown) => [{
      student_leave_requests: sourceLeave,
      students: sourceStudent,
    }],
  };
  (db as any).select = () => chain;

  try {
    const result = await storage.getStudentLeavesBySessionClassSection(4, 21, "7", "A");
    assert.deepEqual(result, [{
      ...sourceLeave,
      studentName: "Nina",
      dsid: "D-99",
      photoUrl: "/uploads/student.png",
    }]);
    assert.equal(calls.joins.length, 2);
    assert.match(dialect.sqlToQuery(calls.joins[0].on as any).sql, /enrollments.*session_id.*student_leave_requests.*session_id/);
    assert.match(dialect.sqlToQuery(calls.joins[1].on as any).sql, /students.*school_id.*enrollments.*school_id/);
    const query = dialect.sqlToQuery(calls.where as any);
    assert.deepEqual(query.params, [4, 21, "pending_teacher", 4, 21, "7", "A", 4]);
  } finally {
    (db as any).select = originalSelect;
  }
});
