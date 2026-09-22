export type CanonicalStudentAttendanceStatus =
  | "present"
  | "absent"
  | "late"
  | "halfday"
  | "leave";

export interface StudentAttendanceAggregation {
  schoolId: number;
  sessionId: number;
  applicableWorkingDays: number;
  markedTotal: number;
  weightedAttendance: number;
  percentage: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
  missing: number;
  unknown: number;
}

export function normalizeStudentAttendanceStatus(
  status: string | null | undefined,
): CanonicalStudentAttendanceStatus | "unknown" | null {
  if (status == null || status.trim() === "") return null;
  const normalized = status.trim().toLowerCase();
  if (normalized === "half_day") return "halfday";
  if (
    normalized === "present" ||
    normalized === "absent" ||
    normalized === "late" ||
    normalized === "halfday" ||
    normalized === "leave"
  ) {
    return normalized;
  }
  return "unknown";
}

export function aggregateStudentAttendance(input: {
  schoolId: number;
  sessionId: number;
  statuses: readonly (string | null | undefined)[];
}): StudentAttendanceAggregation {
  if (!Number.isInteger(input.schoolId) || input.schoolId <= 0) {
    throw new Error("A valid schoolId is required for Student Attendance aggregation");
  }
  if (!Number.isInteger(input.sessionId) || input.sessionId <= 0) {
    throw new Error("A valid sessionId is required for Student Attendance aggregation");
  }

  let present = 0;
  let absent = 0;
  let late = 0;
  let halfDay = 0;
  let leave = 0;
  let missing = 0;
  let unknown = 0;
  let weightedAttendance = 0;

  for (const rawStatus of input.statuses) {
    const status = normalizeStudentAttendanceStatus(rawStatus);
    if (status === null) {
      missing++;
    } else if (status === "present") {
      present++;
      weightedAttendance += 1;
    } else if (status === "late") {
      late++;
      weightedAttendance += 1;
    } else if (status === "leave") {
      leave++;
      weightedAttendance += 1;
    } else if (status === "halfday") {
      halfDay++;
      weightedAttendance += 0.5;
    } else if (status === "absent") {
      absent++;
    } else {
      unknown++;
    }
  }

  const applicableWorkingDays = input.statuses.length;
  const percentage = applicableWorkingDays > 0
    ? Math.round((weightedAttendance / applicableWorkingDays) * 1000) / 10
    : 0;

  return {
    schoolId: input.schoolId,
    sessionId: input.sessionId,
    applicableWorkingDays,
    markedTotal: applicableWorkingDays - missing,
    weightedAttendance: Math.round(weightedAttendance * 10) / 10,
    percentage,
    present,
    absent,
    late,
    halfDay,
    leave,
    missing,
    unknown,
  };
}