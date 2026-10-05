import assert from "node:assert/strict";
import { facultyMappings } from "@workspace/db";
import { PgDialect } from "drizzle-orm/pg-core";
import test from "node:test";
import { db } from "./db";
import { storage } from "./storage";

const dialect = new PgDialect();

const leaveRows = [
  { id: 101, schoolId: 1, studentId: 11, sessionId: 101, status: "pending_teacher" },
  { id: 102, schoolId: 1, studentId: 11, sessionId: 102, status: "pending_teacher" },
  { id: 103, schoolId: 1, studentId: 11, sessionId: null, status: "pending_teacher" },
  { id: 104, schoolId: 2, studentId: 22, sessionId: 101, status: "pending_teacher" },
  { id: 105, schoolId: 1, studentId: 22, sessionId: 101, status: "pending_teacher" },
  { id: 106, schoolId: 1, studentId: 14, sessionId: 101, status: "pending_teacher" },
  { id: 107, schoolId: 1, studentId: 14, sessionId: 101, status: "forwarded_to_admin" },
];

const enrollmentRows = [
  { schoolId: 1, studentId: 11, sessionId: 101, className: "7", sectionName: "A" },
  { schoolId: 1, studentId: 11, sessionId: 102, className: "8", sectionName: "B" },
  { schoolId: 1, studentId: 14, sessionId: 101, className: "6", sectionName: "C" },
  { schoolId: 2, studentId: 22, sessionId: 101, className: "7", sectionName: "A" },
];

const studentRows = [
  { id: 11, schoolId: 1, name: "Rahul", digitalStudentId: "S-11", photoUrl: null, class: "8", section: "B" },
  { id: 14, schoolId: 1, name: "Mira", digitalStudentId: "S-14", photoUrl: null, class: "9", section: "Z" },
  { id: 22, schoolId: 2, name: "Other School Student", digitalStudentId: "S-22", photoUrl: null, class: "7", section: "A" },
];

function installQueueStorageFixture(
  t: any,
  teacher: { id: number; schoolId: number; assignedClass?: string | null; assignedSection?: string | null },
  mappings: Array<{ className: string; section: string; subject?: string | null }>,
) {
  const target = storage as any;
  const originalSelect = (db as any).select;
  const hadOwnTeacherGetter = Object.prototype.hasOwnProperty.call(target, "getTeacherById");
  const originalTeacherGetter = target.getTeacherById;
  const calls: {
    mappingScopes: unknown[];
    queueScopes: unknown[];
    joins: Array<{ table: unknown; on: unknown }>;
  } = { mappingScopes: [], queueScopes: [], joins: [] };

  target.getTeacherById = async (teacherId: number) =>
    teacherId === teacher.id ? teacher : undefined;

  (db as any).select = () => {
    const state: { table?: unknown } = {};
    const chain: any = {
      from(table: unknown) {
        state.table = table;
        return this;
      },
      innerJoin(table: unknown, on: unknown) {
        calls.joins.push({ table, on });
        return this;
      },
      where(condition: unknown) {
        if (state.table === facultyMappings) {
          calls.mappingScopes.push(condition);
          return Promise.resolve(mappings);
        }
        calls.queueScopes.push(condition);
        return this;
      },
      async orderBy() {
        const query = dialect.sqlToQuery(calls.queueScopes.at(-1) as any);
        const [
          schoolId,
          sessionId,
          pendingStatus,
          enrollmentSchoolId,
          enrollmentSessionId,
          studentSchoolId,
          ...assignmentValues
        ] = query.params as Array<number | string>;
        const assignmentPairs: Array<[number | string, number | string]> = [];
        for (let index = 0; index < assignmentValues.length; index += 2) {
          assignmentPairs.push([
            assignmentValues[index],
            assignmentValues[index + 1],
          ]);
        }

        return leaveRows.flatMap((leave) => {
          if (leave.schoolId !== schoolId
            || leave.sessionId !== sessionId
            || leave.status !== pendingStatus) return [];

          const enrollment = enrollmentRows.find((row) =>
            row.schoolId === enrollmentSchoolId
            && row.sessionId === enrollmentSessionId
            && row.studentId === leave.studentId
            && assignmentPairs.some(([className, section]) =>
              row.className === className && row.sectionName === section,
            ),
          );
          if (!enrollment) return [];

          const student = studentRows.find((row) =>
            row.id === enrollment.studentId
            && row.schoolId === studentSchoolId
            && row.schoolId === enrollment.schoolId,
          );
          if (!student) return [];
          return [{
            student_leave_requests: leave,
            enrollments: enrollment,
            students: student,
          }];
        });
      },
    };
    return chain;
  };

  t.after(() => {
    (db as any).select = originalSelect;
    if (hadOwnTeacherGetter) target.getTeacherById = originalTeacherGetter;
    else delete target.getTeacherById;
  });

  return calls;
}

test("Teacher queue returns each session's enrollment placement and excludes other sessions and tenants", async (t) => {
  const calls = installQueueStorageFixture(
    t,
    { id: 9, schoolId: 1, assignedClass: "6", assignedSection: "C" },
    [{ className: "7", section: "A" }, { className: "8", section: "B" }],
  );

  const historical = await storage.getStudentLeavesByTeacher(9, 1, 101);
  const current = await storage.getStudentLeavesByTeacher(9, 1, 102);

  assert.deepEqual(historical.map(({ id, class: className, section }) => [id, className, section]), [
    [101, "7", "A"],
    [106, "6", "C"],
  ]);
  assert.deepEqual(current.map(({ id, class: className, section }) => [id, className, section]), [
    [102, "8", "B"],
  ]);

  const historicalScope = dialect.sqlToQuery(calls.queueScopes[0] as any);
  const currentScope = dialect.sqlToQuery(calls.queueScopes[1] as any);
  assert.equal(historicalScope.params[1], 101);
  assert.equal(currentScope.params[1], 102);
  for (const scope of [historicalScope, currentScope]) {
    assert.match(scope.sql, /enrollments.*class_name/);
    assert.match(scope.sql, /enrollments.*section_name/);
    assert.equal(scope.sql.includes('"students"."class"'), false);
    assert.equal(scope.sql.includes('"students"."section"'), false);
  }

  const mappingScope = dialect.sqlToQuery(calls.mappingScopes[0] as any);
  assert.deepEqual(mappingScope.params, [9, 1]);
  assert.match(mappingScope.sql, /faculty_mappings.*school_id/);
});

test("Teacher queue retains the legacy assignedClass/assignedSection fallback when mappings are absent", async (t) => {
  const calls = installQueueStorageFixture(
    t,
    { id: 9, schoolId: 1, assignedClass: "7", assignedSection: "A" },
    [],
  );

  const historical = await storage.getStudentLeavesByTeacher(9, 1, 101);

  assert.deepEqual(historical.map(({ id, class: className, section }) => [id, className, section]), [
    [101, "7", "A"],
  ]);
  const scope = dialect.sqlToQuery(calls.queueScopes[0] as any);
  assert.deepEqual(scope.params.slice(-2), ["7", "A"]);
});
