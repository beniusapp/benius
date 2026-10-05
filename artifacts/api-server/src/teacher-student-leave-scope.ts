import { and, eq, or, type SQL } from "drizzle-orm";
import { enrollments, studentLeaveRequests, students } from "@workspace/db";

export type TeacherStudentLeaveAssignment = {
  className: string;
  section: string;
};

export function teacherStudentLeaveAssignments(
  teacher: { assignedClass?: string | null; assignedSection?: string | null },
  mappings: readonly TeacherStudentLeaveAssignment[],
): TeacherStudentLeaveAssignment[] {
  return [
    ...(teacher.assignedClass && teacher.assignedSection
      ? [{ className: teacher.assignedClass, section: teacher.assignedSection }]
      : []),
    ...mappings.map(({ className, section }) => ({ className, section })),
  ];
}

/**
 * Join a leave request to the enrollment recorded for that request's exact
 * school and session. A NULL-session request cannot match this enrollment.
 */
export function teacherStudentLeaveEnrollmentJoin() {
  return and(
    eq(enrollments.schoolId, studentLeaveRequests.schoolId),
    eq(enrollments.studentId, studentLeaveRequests.studentId),
    eq(enrollments.sessionId, studentLeaveRequests.sessionId),
  )!;
}

export function teacherStudentLeaveStudentJoin() {
  return and(
    eq(students.id, enrollments.studentId),
    eq(students.schoolId, enrollments.schoolId),
  )!;
}

/** Scope pending requests to the authenticated tenant, selected session, and enrollment cohort. */
export function teacherStudentLeaveSessionScope(
  schoolId: number,
  sessionId: number,
  className: string,
  sectionName: string,
) {
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0
    || !Number.isSafeInteger(sessionId) || sessionId <= 0
    || !className.trim() || !sectionName.trim()) {
    throw new Error("Student Leave reads require a school, selected session, class, and section.");
  }

  return and(
    eq(studentLeaveRequests.schoolId, schoolId),
    eq(studentLeaveRequests.sessionId, sessionId),
    eq(studentLeaveRequests.status, "pending_teacher"),
    eq(enrollments.schoolId, schoolId),
    eq(enrollments.sessionId, sessionId),
    eq(enrollments.className, className),
    eq(enrollments.sectionName, sectionName),
    eq(students.schoolId, schoolId),
  )!;
}

/** Limit the Teacher queue to assigned enrollment cohorts in one exact school/session. */
export function teacherStudentLeaveQueueSessionScope(
  schoolId: number,
  sessionId: number,
  assignments: readonly TeacherStudentLeaveAssignment[],
): SQL | undefined {
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0
    || !Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new Error("Student Leave queue reads require a school and selected session.");
  }

  const assignmentConditions = assignments.map(({ className, section }) => and(
    eq(enrollments.className, className),
    eq(enrollments.sectionName, section),
  ));
  const assignmentScope = or(...assignmentConditions);
  if (!assignmentScope) return undefined;

  return and(
    eq(studentLeaveRequests.schoolId, schoolId),
    eq(studentLeaveRequests.sessionId, sessionId),
    eq(studentLeaveRequests.status, "pending_teacher"),
    eq(enrollments.schoolId, schoolId),
    eq(enrollments.sessionId, sessionId),
    eq(students.schoolId, schoolId),
    assignmentScope,
  )!;
}
