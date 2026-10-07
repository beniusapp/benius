import type { summarizeWebDailyPresence } from "./web-daily-presence";

export type AttendanceClassSectionOption = {
  className: string;
  sectionName: string;
};

export type AttendanceClassSectionRow = {
  className: string | null | undefined;
  sectionName: string | null | undefined;
};

export function normalizeAttendanceClassSections(
  rows: readonly AttendanceClassSectionRow[],
): AttendanceClassSectionOption[] {
  const pairs = new Map<string, AttendanceClassSectionOption>();
  for (const row of rows) {
    if (!row.className?.trim() || !row.sectionName?.trim()) continue;
    const pair = { className: row.className, sectionName: row.sectionName };
    pairs.set(`${pair.className}\u0000${pair.sectionName}`, pair);
  }
  return [...pairs.values()].sort((a, b) =>
    a.className.localeCompare(b.className, undefined, { numeric: true, sensitivity: "base" })
    || a.sectionName.localeCompare(b.sectionName, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function selectAttendanceRoster<T>(
  sessionIsActive: boolean,
  liveRoster: readonly T[],
  historicalRoster: readonly T[],
): T[] {
  return [...(sessionIsActive ? liveRoster : historicalRoster)];
}

export function mapEnrollmentRollNumbers(
  rows: readonly { studentId: number; rollNo: string | number | null }[],
): Map<number, string> {
  const rollNumbers = new Map<number, string>();
  for (const row of rows) {
    if (!rollNumbers.has(row.studentId)) {
      rollNumbers.set(row.studentId, row.rollNo == null ? "" : String(row.rollNo));
    }
  }
  return rollNumbers;
}

type LiveAttendanceSummary = ReturnType<typeof summarizeWebDailyPresence>;

type HistoricalAttendanceSummary = {
  total: number;
  applicableTotal: number;
  present: number;
  absent: number;
  leave: number;
  late: number;
  halfDay: number;
  missing: number;
  unknown: number;
  percentage: number;
};

export type StudentAttendanceOverviewPayload = {
  enrolledTotal: number;
  markedTotal: number;
  applicableTotal: number;
  present: number;
  absent: number;
  leave: number;
  late: number;
  halfDay: number;
  missing: number;
  unknown: number;
  percentage: number | null;
};

export function buildLiveStudentAttendanceOverview(
  summary: LiveAttendanceSummary,
): StudentAttendanceOverviewPayload {
  return {
    enrolledTotal: summary.eligibleTotal,
    markedTotal: summary.total,
    applicableTotal: summary.applicableTotal,
    present: summary.present,
    absent: summary.absent,
    leave: summary.leave,
    late: summary.late,
    halfDay: summary.halfDay,
    missing: summary.missing,
    unknown: summary.unknown,
    percentage: summary.percentage,
  };
}

export function buildHistoricalStudentAttendanceOverview(
  enrolledTotal: number,
  summary: HistoricalAttendanceSummary,
): StudentAttendanceOverviewPayload {
  return {
    enrolledTotal,
    markedTotal: summary.total,
    applicableTotal: summary.applicableTotal,
    present: summary.present,
    absent: summary.absent,
    leave: summary.leave,
    late: summary.late,
    halfDay: summary.halfDay,
    missing: summary.missing,
    unknown: summary.unknown,
    percentage: summary.total > 0 ? summary.percentage : null,
  };
}
