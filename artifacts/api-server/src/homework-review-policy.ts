export type HomeworkReviewAssignment = {
  className: string;
  section: string;
};

export type TeacherHomeworkReviewScope = {
  authenticatedSchoolId: number;
  teacherSchoolId: number;
  homeworkSchoolId: number;
  selectedSessionId: number;
  homeworkSessionId: number | null;
  homeworkClass: string;
  homeworkSection: string;
};

export type HomeworkStudentReviewScope = TeacherHomeworkReviewScope & {
  studentSchoolId: number;
  enrollmentSchoolId: number;
  enrollmentSessionId: number;
  enrollmentClass: string;
  enrollmentSection: string;
};

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function teacherMayReviewHomework(
  assignments: readonly HomeworkReviewAssignment[],
  scope: TeacherHomeworkReviewScope,
): boolean {
  if (
    !isPositiveSafeInteger(scope.authenticatedSchoolId)
    || !isPositiveSafeInteger(scope.teacherSchoolId)
    || !isPositiveSafeInteger(scope.homeworkSchoolId)
    || !isPositiveSafeInteger(scope.selectedSessionId)
    || !isPositiveSafeInteger(scope.homeworkSessionId ?? 0)
  ) {
    return false;
  }

  return scope.teacherSchoolId === scope.authenticatedSchoolId
    && scope.homeworkSchoolId === scope.authenticatedSchoolId
    && scope.homeworkSessionId === scope.selectedSessionId
    && assignments.some((assignment) =>
      assignment.className === scope.homeworkClass
      && assignment.section === scope.homeworkSection,
    );
}

export function teacherMayReviewStudentHomework(
  assignments: readonly HomeworkReviewAssignment[],
  scope: HomeworkStudentReviewScope,
): boolean {
  return teacherMayReviewHomework(assignments, scope)
    && scope.studentSchoolId === scope.authenticatedSchoolId
    && scope.enrollmentSchoolId === scope.authenticatedSchoolId
    && scope.enrollmentSessionId === scope.selectedSessionId
    && scope.enrollmentClass === scope.homeworkClass
    && scope.enrollmentSection === scope.homeworkSection
    && assignments.some((assignment) =>
      assignment.className === scope.enrollmentClass
      && assignment.section === scope.enrollmentSection,
    );
}

export function isHomeworkReviewRosterEligible(
  studentIsActive: boolean,
  enrollmentStatus: string,
  isActiveSession: boolean,
): boolean {
  return !isActiveSession || (studentIsActive && enrollmentStatus === "Active");
}

export type HomeworkReviewAction = "approve" | "request_resubmission";

export function homeworkReviewStatusForAction(
  action: HomeworkReviewAction,
): "approved" | "rejected" {
  return action === "approve" ? "approved" : "rejected";
}
