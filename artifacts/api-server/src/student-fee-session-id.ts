export type StudentFeeSessionHeaderResult =
  | { ok: true; sessionId: number }
  | { ok: false; reason: "required" | "invalid" };

export function parseStudentFeeSessionHeader(
  header: string | string[] | undefined,
): StudentFeeSessionHeaderResult {
  if (header === undefined) return { ok: false, reason: "required" };
  if (typeof header !== "string" || !/^[1-9]\d*$/.test(header)) {
    return { ok: false, reason: "invalid" };
  }
  const sessionId = Number(header);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, sessionId };
}

export function isStudentFeeRecordOwnedBySelectedSession(
  record: {
    id: number;
    studentId: number;
    schoolId: number;
    sessionId: number | string | null;
  },
  expected: { feeRecordId: number; studentId: number; schoolId: number; sessionId: number },
): boolean {
  return record.id === expected.feeRecordId
    && record.studentId === expected.studentId
    && record.schoolId === expected.schoolId
    && record.sessionId != null
    && Number(record.sessionId) === expected.sessionId;
}
