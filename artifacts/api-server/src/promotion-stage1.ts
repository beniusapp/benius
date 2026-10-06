export interface PromotionAcademicSession {
  id: number;
  schoolId: number;
  isActive: boolean;
}

export type PromotionSessionContextResult =
  | { ok: true; sessionId: number; session: PromotionAcademicSession }
  | {
      ok: false;
      status: 400 | 403;
      code: "SESSION_REQUIRED" | "SESSION_NOT_ACCESSIBLE" | "HISTORICAL_SESSION_READ_ONLY";
      message: string;
    };

export function validatePromotionSessionContext(
  rawSessionHeader: unknown,
  schoolId: number,
  session: PromotionAcademicSession | undefined,
  mode: "read" | "write",
): PromotionSessionContextResult {
  const raw = Array.isArray(rawSessionHeader)
    ? rawSessionHeader.length === 1 ? rawSessionHeader[0] : undefined
    : rawSessionHeader;
  const sessionId = typeof raw === "string" && /^\d+$/.test(raw)
    ? Number(raw)
    : Number.NaN;

  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    return {
      ok: false,
      status: 400,
      code: "SESSION_REQUIRED",
      message: "A valid x-view-session-id Academic Session is required.",
    };
  }

  if (
    !Number.isSafeInteger(schoolId) || schoolId <= 0 ||
    !session ||
    session.id !== sessionId ||
    session.schoolId !== schoolId
  ) {
    return {
      ok: false,
      status: 403,
      code: "SESSION_NOT_ACCESSIBLE",
      message: "The selected Academic Session is not accessible.",
    };
  }

  if (mode === "write" && session.isActive !== true) {
    return {
      ok: false,
      status: 403,
      code: "HISTORICAL_SESSION_READ_ONLY",
      message: "Historical Academic Sessions are read-only.",
    };
  }

  return { ok: true, sessionId, session };
}

export interface PromotionExecutionItem {
  studentId: number;
  fromClass: string;
  fromSection: string;
  nextClass: string;
  nextSection: string;
  examType: string;
  totalObtained: number;
  totalMax: number;
  percentage: number;
  gradeLabel?: string | null;
  gradePoint?: string | null;
  gradeRemarks?: string | null;
}

export interface PromotionStudentRow {
  id: number;
  schoolId: number;
  isActive: boolean;
  dsid: string;
  name: string;
}

export interface PromotionEnrollmentRow {
  studentId: number;
  schoolId: number;
  sessionId: number;
  className: string;
  sectionName: string;
  status: string;
}

export interface PromotionExecutionPlacement {
  studentId: number;
  dsid: string;
  name: string;
  fromClass: string;
  fromSection: string;
}

export class PromotionStage1Error extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 409,
    readonly code: string,
  ) {
    super(message);
    this.name = "PromotionStage1Error";
  }
}

export function validatePromotionExecutionBatch(
  items: PromotionExecutionItem[],
  term: string | undefined,
): void {
  if (!term?.trim()) {
    throw new PromotionStage1Error("term is required for Promotion execution.", 400, "TERM_REQUIRED");
  }
  if (items.length === 0) {
    throw new PromotionStage1Error("At least one Student is required.", 400, "STUDENTS_REQUIRED");
  }

  const studentIds = new Set<number>();
  for (const item of items) {
    if (studentIds.has(item.studentId)) {
      throw new PromotionStage1Error(
        "A Student may only appear once in a Promotion request.",
        400,
        "DUPLICATE_STUDENT",
      );
    }
    studentIds.add(item.studentId);
  }

  const first = items[0];
  if (items.some(item =>
    item.fromClass !== first.fromClass ||
    item.fromSection !== first.fromSection ||
    item.examType !== first.examType
  )) {
    throw new PromotionStage1Error(
      "All Students in one Promotion request must belong to the same source class, section, and examination.",
      400,
      "MIXED_PROMOTION_COHORT",
    );
  }
}

export function validatePromotionExecutionRoster(
  schoolId: number,
  sessionId: number,
  items: PromotionExecutionItem[],
  studentRows: PromotionStudentRow[],
  enrollmentRows: PromotionEnrollmentRow[],
): PromotionExecutionPlacement[] {
  const studentsById = new Map(studentRows.map(student => [student.id, student]));
  const enrollmentsById = new Map(enrollmentRows.map(enrollment => [enrollment.studentId, enrollment]));

  return items.map(item => {
    const student = studentsById.get(item.studentId);
    const enrollment = enrollmentsById.get(item.studentId);
    const valid =
      student?.schoolId === schoolId &&
      student.isActive === true &&
      enrollment?.schoolId === schoolId &&
      enrollment.sessionId === sessionId &&
      enrollment.status === "Active" &&
      enrollment.className === item.fromClass &&
      enrollment.sectionName === item.fromSection;

    if (!valid || !student || !enrollment) {
      throw new PromotionStage1Error(
        "One or more Students are not active members of the requested source-session class and section.",
        409,
        "STUDENT_NOT_IN_SOURCE_SESSION",
      );
    }

    return {
      studentId: student.id,
      dsid: student.dsid,
      name: student.name,
      fromClass: enrollment.className,
      fromSection: enrollment.sectionName,
    };
  });
}

export function promotionAlreadyExecutedError(): PromotionStage1Error {
  return new PromotionStage1Error(
    "At least one source-session Promotion decision was already executed.",
    409,
    "PROMOTION_ALREADY_EXECUTED",
  );
}
