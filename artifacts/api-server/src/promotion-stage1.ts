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

export interface PromotionTargetSessionRow {
  id: number;
  schoolId: number;
  status: string;
  sessionName: string;
}

export interface PromotionTargetEnrollmentRow {
  studentId: number;
  schoolId: number;
  sessionId: number;
  className: string;
  sectionName: string;
  rollNo: number | null;
  status: string;
}

export interface PromotionExecutionPlacement {
  studentId: number;
  dsid: string;
  name: string;
  fromClass: string;
  fromSection: string;
  toClass?: string;
  toSection?: string;
  examType?: string;
  totalObtained?: number;
  totalMax?: number;
  percentage?: number;
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

export interface PromotionTermComponent {
  sourceExam: string;
  weight: number;
}

/** Resolve one exact weighted-term key. Raw exam-type aliases are not accepted. */
export function resolvePromotionTermComponents(
  rawWeights: string,
  requestedTerm: string,
): PromotionTermComponent[] {
  if (!requestedTerm || requestedTerm !== requestedTerm.trim()) {
    throw new PromotionStage1Error(
      "Provide the exact configured examination-term key.",
      400,
      "PROMOTION_TERM_INVALID",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawWeights);
  } catch {
    throw new PromotionStage1Error(
      "The configured examination-term policy is invalid.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PromotionStage1Error(
      "The configured examination-term policy is invalid.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  const normalizedMatches = entries.filter(([key]) => key.trim() === requestedTerm);
  if (normalizedMatches.length !== 1 || normalizedMatches[0][0] !== requestedTerm) {
    throw new PromotionStage1Error(
      "The requested term is not one unambiguous, exact configured examination term.",
      400,
      "PROMOTION_TERM_INVALID",
    );
  }

  const configuredComponents = normalizedMatches[0][1];
  if (!Array.isArray(configuredComponents) || configuredComponents.length === 0) {
    throw new PromotionStage1Error(
      "The configured examination term has no applicable assessment components.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }

  const components: PromotionTermComponent[] = [];
  const sourceExams = new Set<string>();
  for (const component of configuredComponents) {
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      throw new PromotionStage1Error(
        "The configured examination-term components are invalid.",
        409,
        "PROMOTION_TERM_POLICY_INVALID",
      );
    }
    const sourceExam = (component as Record<string, unknown>).source_exam;
    const weight = (component as Record<string, unknown>).weight;
    if (
      typeof sourceExam !== "string" || !sourceExam || sourceExam !== sourceExam.trim() ||
      typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0 ||
      sourceExams.has(sourceExam)
    ) {
      throw new PromotionStage1Error(
        "The configured examination-term components are invalid or ambiguous.",
        409,
        "PROMOTION_TERM_POLICY_INVALID",
      );
    }
    sourceExams.add(sourceExam);
    components.push({ sourceExam, weight });
  }

  return components;
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

export function validatePromotionTargetSession(
  schoolId: number,
  sourceSessionId: number,
  targetSessionId: number,
  targetSession: PromotionTargetSessionRow | undefined,
): asserts targetSession is PromotionTargetSessionRow {
  if (!Number.isSafeInteger(targetSessionId) || targetSessionId <= 0) {
    throw new PromotionStage1Error(
      "A valid target Academic Session is required.",
      400,
      "TARGET_SESSION_REQUIRED",
    );
  }
  if (targetSessionId === sourceSessionId) {
    throw new PromotionStage1Error(
      "The target Academic Session must differ from the source session.",
      400,
      "TARGET_SESSION_SAME_AS_SOURCE",
    );
  }
  if (
    !targetSession ||
    targetSession.id !== targetSessionId ||
    targetSession.schoolId !== schoolId ||
    targetSession.status.toLowerCase() === "archived"
  ) {
    throw new PromotionStage1Error(
      "The target Academic Session is not available for this school.",
      403,
      "TARGET_SESSION_NOT_ACCESSIBLE",
    );
  }
}

export function validatePromotionTargetEnrollment(
  schoolId: number,
  targetSessionId: number,
  item: PromotionExecutionItem,
  existingRows: PromotionTargetEnrollmentRow[],
): "create" | "already_prepared" {
  if (existingRows.length === 0) return "create";

  const exactMatch =
    existingRows.length === 1 &&
    existingRows[0].schoolId === schoolId &&
    existingRows[0].studentId === item.studentId &&
    existingRows[0].sessionId === targetSessionId &&
    existingRows[0].className === item.nextClass &&
    existingRows[0].sectionName === item.nextSection &&
    existingRows[0].rollNo === null &&
    existingRows[0].status === "Active";

  if (!exactMatch) {
    throw new PromotionStage1Error(
      "A target-session enrollment already exists with a different school, placement, roll number, or status.",
      409,
      "TARGET_ENROLLMENT_CONFLICT",
    );
  }

  return "already_prepared";
}

export function promotionAlreadyExecutedError(): PromotionStage1Error {
  return new PromotionStage1Error(
    "At least one source-session Promotion decision was already executed.",
    409,
    "PROMOTION_ALREADY_EXECUTED",
  );
}
