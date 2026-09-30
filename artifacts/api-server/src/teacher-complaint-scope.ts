import { and, eq } from "drizzle-orm";
import { complaints, type Complaint } from "@workspace/db";

export type TeacherComplaintAssignment = {
  className: string;
  section: string;
};

export type TeacherComplaintEnrollment = {
  schoolId: number;
  studentId: number;
  sessionId: number;
  className: string;
  sectionName: string;
};

export function requireTeacherComplaintSession(
  schoolId: number,
  sessionId: number | null | undefined,
): asserts sessionId is number {
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0
    || !Number.isSafeInteger(sessionId) || Number(sessionId) <= 0) {
    throw new Error("Teacher Complaints require a valid school and selected academic session.");
  }
}

export function teacherComplaintSessionScope(schoolId: number, sessionId: number) {
  requireTeacherComplaintSession(schoolId, sessionId);
  return and(
    eq(complaints.schoolId, schoolId),
    eq(complaints.sessionId, sessionId),
    eq(complaints.isDeleted, false),
  )!;
}

export function teacherComplaintMatchesSession(
  complaint: Pick<Complaint, "schoolId" | "sessionId" | "isDeleted">,
  schoolId: number,
  sessionId: number,
): boolean {
  return complaint.schoolId === schoolId
    && complaint.sessionId === sessionId
    && !complaint.isDeleted;
}

export function teacherOwnsComplaintInSession(
  complaint: Pick<Complaint, "teacherId" | "schoolId" | "sessionId" | "isDeleted">,
  teacherId: number,
  schoolId: number,
  sessionId: number,
): boolean {
  return teacherComplaintMatchesSession(complaint, schoolId, sessionId)
    && complaint.teacherId === teacherId;
}

export function teacherHasAssignedEnrollment(
  enrollment: TeacherComplaintEnrollment | null | undefined,
  schoolId: number,
  sessionId: number,
  studentId: number,
  assignments: TeacherComplaintAssignment[],
): boolean {
  return !!enrollment
    && enrollment.schoolId === schoolId
    && enrollment.studentId === studentId
    && enrollment.sessionId === sessionId
    && assignments.some((assignment) =>
      assignment.className === enrollment.className
      && assignment.section === enrollment.sectionName,
    );
}

export function teacherCanAccessAssignedPeerReport(
  complaint: Pick<Complaint, "schoolId" | "sessionId" | "isDeleted" | "complaintType" | "studentId">,
  schoolId: number,
  sessionId: number,
  assignments: TeacherComplaintAssignment[],
  enrollment: TeacherComplaintEnrollment | null | undefined,
): boolean {
  if (!teacherComplaintMatchesSession(complaint, schoolId, sessionId)
    || complaint.complaintType !== "student-peer-report"
    || !complaint.studentId
    || !teacherHasAssignedEnrollment(enrollment, schoolId, sessionId, complaint.studentId, assignments)) {
    return false;
  }
  return true;
}