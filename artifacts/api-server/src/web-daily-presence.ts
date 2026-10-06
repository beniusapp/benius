import { aggregateStudentAttendance } from "./student-attendance-calculation";

export type WebDailyPresenceRecord = {
  studentId: number | null;
  status: string | null;
};

export function summarizeWebDailyPresence(input: {
  schoolId: number;
  sessionId: number;
  eligibleStudentIds: readonly number[];
  records: readonly WebDailyPresenceRecord[];
}) {
  const eligibleStudentIds = new Set(input.eligibleStudentIds);
  const markedStatuses = new Map<number, string | null>();

  for (const record of input.records) {
    if (record.studentId == null
      || !eligibleStudentIds.has(record.studentId)
      || markedStatuses.has(record.studentId)) {
      continue;
    }
    markedStatuses.set(record.studentId, record.status);
  }

  const statuses = [...markedStatuses.values()];
  const aggregation = aggregateStudentAttendance({
    schoolId: input.schoolId,
    sessionId: input.sessionId,
    statuses,
  });

  return {
    total: markedStatuses.size,
    eligibleTotal: eligibleStudentIds.size,
    notMarked: eligibleStudentIds.size - markedStatuses.size,
    applicableTotal: aggregation.applicableWorkingDays,
    present: aggregation.present,
    absent: aggregation.absent,
    leave: aggregation.leave,
    late: aggregation.late,
    halfDay: aggregation.halfDay,
    missing: aggregation.missing,
    unknown: aggregation.unknown,
    percentage: statuses.length > 0 ? aggregation.percentage : null,
  };
}
