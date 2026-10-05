import { and, eq } from "drizzle-orm";
import { enrollments, studentLeaveRequests, students } from "@workspace/db";

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
