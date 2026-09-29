export type TeacherClassworkScope = {
  teacherId: number;
  schoolId: number;
  sessionId: number;
};

export type TeacherClassworkRecordScope = {
  teacherId: number;
  schoolId: number;
  sessionId: number | null;
};

export function isClassworkOwnedByTeacherInScope(
  record: TeacherClassworkRecordScope,
  scope: TeacherClassworkScope,
): boolean {
  return record.teacherId === scope.teacherId
    && record.schoolId === scope.schoolId
    && record.sessionId === scope.sessionId;
}

export function parsePositiveSafeIntegerPathParam(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}