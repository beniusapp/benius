export type TeacherLeaveApplicationStatus = "pending" | "approved" | "rejected";

export interface TeacherLeaveApplication {
  id: number;
  teacherId: number;
  schoolId: number;
  sessionId: number | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface ScopedTeacherLeaveApplication extends TeacherLeaveApplication {
  status: TeacherLeaveApplicationStatus;
}

export function scopeTeacherLeaveApplications(
  applications: TeacherLeaveApplication[],
  teacherId: number,
  schoolId: number,
  sessionId: number,
  sessionStart: string,
  sessionEnd: string,
): ScopedTeacherLeaveApplication[] {
  return applications.flatMap((application) => {
    const status = application.status.toLowerCase();
    const startDate = application.startDate.slice(0, 10);
    const endDate = application.endDate.slice(0, 10);
    if (
      application.teacherId !== teacherId
      || application.schoolId !== schoolId
      || application.sessionId !== sessionId
      || !["pending", "approved", "rejected"].includes(status)
      || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
      || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
      || startDate > endDate
      || endDate < sessionStart
      || startDate > sessionEnd
    ) {
      return [];
    }

    return [{
      ...application,
      startDate: startDate < sessionStart ? sessionStart : startDate,
      endDate: endDate > sessionEnd ? sessionEnd : endDate,
      status: status as TeacherLeaveApplicationStatus,
    }];
  });
}

export function teacherLeaveApplicationsForDate(
  applications: ScopedTeacherLeaveApplication[],
  date: string,
): ScopedTeacherLeaveApplication[] {
  return applications.filter((application) => application.startDate <= date && application.endDate >= date);
}

export function upcomingTeacherLeaveApplications(
  applications: ScopedTeacherLeaveApplication[],
  tomorrow: string,
): Array<{ application: ScopedTeacherLeaveApplication; startDate: string }> {
  return applications
    .filter((application) => application.endDate >= tomorrow)
    .map((application) => ({
      application,
      startDate: application.startDate < tomorrow ? tomorrow : application.startDate,
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.application.id - b.application.id);
}

export function teacherLeaveStatusLabel(status: TeacherLeaveApplicationStatus): string {
  return `${status[0].toUpperCase()}${status.slice(1)} Leave`;
}
