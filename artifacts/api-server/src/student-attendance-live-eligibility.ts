export type LiveAttendanceScope = {
  schoolId: number;
  sessionId: number;
  className: string;
  sectionName: string;
};

export type LiveAttendanceStudent = {
  id: number;
  schoolId: number;
  isActive: boolean;
};

export type LiveAttendanceEnrollment = {
  studentId: number;
  schoolId: number;
  sessionId: number;
  className: string;
  sectionName: string;
  status: string;
};

export function isEligibleForLiveStudentAttendance(
  student: LiveAttendanceStudent,
  enrollment: LiveAttendanceEnrollment,
  scope: LiveAttendanceScope,
): boolean {
  return student.id === enrollment.studentId
    && student.schoolId === scope.schoolId
    && enrollment.schoolId === scope.schoolId
    && enrollment.sessionId === scope.sessionId
    && enrollment.className === scope.className
    && enrollment.sectionName === scope.sectionName
    && student.isActive
    && enrollment.status === "Active";
}
