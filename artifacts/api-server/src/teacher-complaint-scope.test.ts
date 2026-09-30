import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  requireTeacherComplaintSession,
  teacherCanAccessAssignedPeerReport,
  teacherComplaintMatchesSession,
  teacherComplaintSessionScope,
  teacherHasAssignedEnrollment,
  teacherOwnsComplaintInSession,
} from "./teacher-complaint-scope";

const dialect = new PgDialect();

test("Teacher Complaint SQL scope binds school, exact session, and visible records", () => {
  const query = dialect.sqlToQuery(teacherComplaintSessionScope(4, 21));
  assert.match(query.sql, /school_id/);
  assert.match(query.sql, /session_id/);
  assert.match(query.sql, /is_deleted/);
  assert.deepEqual(query.params, [4, 21, false]);
});

test("selected-session reads allow historical same-school records but exclude other, null, and deleted records", () => {
  const complaint = { schoolId: 4, sessionId: 21, isDeleted: false };
  assert.equal(teacherComplaintMatchesSession(complaint, 4, 21), true);
  assert.equal(teacherComplaintMatchesSession(complaint, 4, 22), false);
  assert.equal(teacherComplaintMatchesSession(complaint, 5, 21), false);
  assert.equal(teacherComplaintMatchesSession({ ...complaint, sessionId: null }, 4, 21), false);
  assert.equal(teacherComplaintMatchesSession({ ...complaint, isDeleted: true }, 4, 21), false);
});

test("Teacher Complaint ownership is required in addition to school and session scope", () => {
  const complaint = { schoolId: 4, sessionId: 21, isDeleted: false, teacherId: 8 };
  assert.equal(teacherOwnsComplaintInSession(complaint, 8, 4, 21), true);
  assert.equal(teacherOwnsComplaintInSession(complaint, 9, 4, 21), false);
  assert.equal(teacherOwnsComplaintInSession(complaint, 8, 4, 22), false);
  assert.equal(teacherOwnsComplaintInSession(complaint, 8, 5, 21), false);
});

test("assigned peer-report access uses the selected-session enrollment, not current profile placement", () => {
  const complaint = {
    schoolId: 4,
    sessionId: 21,
    isDeleted: false,
    complaintType: "student-peer-report",
    studentId: 51,
  };
  const assignments = [{ className: "7", section: "A" }];
  const historicalEnrollment = {
    schoolId: 4,
    studentId: 51,
    sessionId: 21,
    className: "7",
    sectionName: "A",
  };
  assert.equal(teacherCanAccessAssignedPeerReport(
    complaint, 4, 21, assignments, historicalEnrollment,
  ), true);
  assert.equal(teacherCanAccessAssignedPeerReport(
    complaint, 4, 21, assignments, { ...historicalEnrollment, sessionId: 22, className: "8", sectionName: "B" },
  ), false);
  assert.equal(teacherCanAccessAssignedPeerReport(
    complaint, 4, 21, assignments, { ...historicalEnrollment, schoolId: 5 },
  ), false);
  assert.equal(teacherCanAccessAssignedPeerReport(
    complaint, 4, 21, assignments, { ...historicalEnrollment, sectionName: "B" },
  ), false);
  assert.equal(teacherCanAccessAssignedPeerReport(
    { ...complaint, sessionId: 22 }, 4, 21, assignments, historicalEnrollment,
  ), false);
  assert.equal(teacherHasAssignedEnrollment(
    historicalEnrollment, 4, 21, 51, assignments,
  ), true);
  assert.equal(teacherHasAssignedEnrollment(
    historicalEnrollment, 4, 22, 51, assignments,
  ), false);
});

test("missing or invalid school/session scope fails closed", () => {
  for (const [schoolId, sessionId] of [
    [4, null],
    [4, undefined],
    [0, 21],
    [4, 0],
  ] as const) {
    assert.throws(() => requireTeacherComplaintSession(schoolId, sessionId));
  }
  assert.doesNotThrow(() => requireTeacherComplaintSession(4, 21));
});