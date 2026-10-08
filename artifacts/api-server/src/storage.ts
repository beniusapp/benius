import {
  schools, students, users, teachers,
  attendanceRecords, homework, homeworkViews, homeworkSubmissions, classwork, notices, noticeReads,
  complaints, complaintNotes, complaintStudents, examScores, galleryItems, calendarEvents,
  libraryBooks, bookBorrows, leaveRequests, timetableEntries, schoolMetadata,
  studentLeaveRequests, auditLogs, visitorLogs, studentProfiles, teacherAllocations,
  promotionOverrides, gradingTiers, gradingRules, academicHistory,
  schoolAssets, assetLogs, verificationLogs, timetableStructure, securityAudit, leavePolicies,
  nonTeachingStaff, facultyMappings, feeRecords, examPolicyTiers, promotionDecisions,
  academicSessions, enrollments, removedTeachersLog,
  feeStructures, paymentRecords, feeAuditLog, externalPaymentSettings,
  notificationConfig, dunningLog, passwordResetChallenges,
  studentPasswordResetChallenges,
  type FeeStructure, type InsertFeeStructure,
  type PaymentRecord, type InsertPaymentRecord,
  type FeeAuditLog,
  type ExternalPaymentSettings,
  type NotificationConfig, type DunningLog,
  type RemovedTeacherLog,
  type PromotionDecision,
  type School, type InsertSchool, type Student, type InsertStudent,
  type User, type InsertUser, type Teacher, type InsertTeacher,
  type AttendanceRecord, type InsertAttendance,
  type Homework, type InsertHomework, type HomeworkView, type Classwork, type InsertClasswork,
  type HomeworkSubmission,
  type Notice, type InsertNotice, type Complaint, type InsertComplaint,
  type ComplaintNote, type InsertComplaintNote,
  type ExamScore, type InsertExamScore, type GalleryItem, type InsertGalleryItem,
  type CalendarEvent, type InsertCalendarEvent, type LibraryBook, type InsertLibraryBook,
  type BookBorrow, type InsertBookBorrow, type LeaveRequest, type InsertLeaveRequest,
  type TimetableEntry, type InsertTimetableEntry,
  type TeacherAllocation, type InsertTeacherAllocation,
  type SchoolMetadata,
  type StudentLeaveRequest, type InsertStudentLeaveRequest,
  type AuditLog, type InsertAuditLog,
  type VisitorLog, type InsertVisitorLog,
  type StudentProfile, type InsertStudentProfile,
  type PromotionOverride,
  type GradingTier, type InsertGradingTier,
  type GradingRule as StoredGradingRule,
  type InsertAcademicHistory,
  type SchoolAsset, type InsertSchoolAsset,
  type InsertAssetLog,
  type TimetableStructure, type InsertTimetableStructure,
  type LeavePolicy, type InsertLeavePolicy,
  type NonTeachingStaff, type InsertNonTeachingStaff,
  type FacultyMapping, type InsertFacultyMapping,
  type FeeRecord, type InsertFeeRecord,
  type ExamPolicyTier, type InsertExamPolicyTier,
  type AcademicSession, type InsertAcademicSession,
  type Enrollment, type InsertEnrollment,
  type PasswordResetChallenge,
  type StudentPasswordResetChallenge,
} from "@workspace/db";
import { addCalendarDays, calendarDayDifference, calendarWeekday, dateOnlyInIST, dateOnlyParts, isValidDateOnly, todayInIST } from "@shared/ist-time";
import { isAttendanceDateInSession } from "@shared/attendance-session-date";
import { db } from "./db";
import { pool } from "./db";
import {
  activateAcademicSessionInTransaction,
  inspectAcademicSessionActivation,
} from "./academic-session-activation";
import { studentPublishedRankScope, studentPublishedScoreScope } from "./student-examination-score-scope";
import { countUnreadStudentNotices, studentNoticeMatchesAudience, studentNoticeSessionScope } from "./student-notice-visibility";
import { studentTimetableScope } from "./student-timetable-visibility";
import { requireStudentComplaintSession, studentComplaintSessionScope } from "./student-complaint-scope";
import { requireTeacherComplaintSession, teacherComplaintSessionScope } from "./teacher-complaint-scope";
import { requireStudentLeaveSession, studentLeaveSessionScope } from "./student-leave-scope";
import { studentWorkCreatedAtDateSql, type StudentWorkDateMode } from "./student-work-date";
import {
  teacherStudentLeaveEnrollmentJoin,
  teacherStudentLeaveAssignments,
  teacherStudentLeaveQueueSessionScope,
  teacherStudentLeaveSessionScope,
  teacherStudentLeaveStudentJoin,
} from "./teacher-student-leave-scope";
import { eq, sql, like, count, and, asc, desc, gte, gt, lte, lt, or, ilike, isNull, isNotNull, inArray, ne, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  aggregateStudentAttendance,
  type StudentAttendanceAggregation,
} from "./student-attendance-calculation";
import { isEligibleForLiveStudentAttendance } from "./student-attendance-live-eligibility";
import { normalizeAttendanceClassSections } from "./student-attendance-overview";
import { getStudentAttendanceWorkingDates } from "./student-attendance-working-days";
import {
  CURRENT_FEE_AUDIT_ACTION_OPTIONS,
  feeAuditActionLabel,
  normalizeFeeAuditActorDisplay,
  safeFeeAuditDescription,
  safeFeeAuditRecordLabel,
} from "./fee-audit";
import {
  computeAllStudentResults,
  evaluatePromotionRules,
  selectGrade,
  type ExaminationAttendance,
  type ExaminationStudent,
} from "@shared/examination-calculation-engine";
import { percentageToDatabaseValue, percentageToHundredths } from "@shared/grading-percentage";
import {
  SESSION_REVOCATION_TTL_MS,
  studentSessionRevocationSid,
  userSessionRevocationSid,
} from "./session-revocation";
import {
  checkLockedPromotionDecision,
  evaluatePromotionLedgerReadiness,
  PromotionStage1Error,
  promotionAlreadyExecutedError,
  resolvePromotionTermComponents,
  summarizePromotionLedgerReadiness,
  validatePromotionExecutionBatch,
  validatePromotionExecutionRoster,
  validatePromotionTargetEnrollment,
  validatePromotionTargetSession,
  type PromotionExecutionItem,
  type PromotionExecutionPlacement,
  type PromotionTargetEnrollmentRow,
  type PromotionLedgerReadiness,
} from "./promotion-stage1";
import {
  hasActiveStudentPlacementChanged,
  isConfiguredStudentPlacement,
} from "./student-registry-placement";
import { summarizeWebDailyPresence } from "./web-daily-presence";
import {
  generatePasswordRecoveryToken,
  hashPasswordRecoverySecret,
  passwordRecoverySecretsEqual,
} from "./password-recovery-crypto";
import {
  homeworkReviewStatusForAction,
  isHomeworkReviewRosterEligible,
  type HomeworkReviewAction,
} from "./homework-review-policy";

function isValidStudentRecoveryEmail(email: string | null): email is string {
  return typeof email === "string"
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

type GradingRule = Omit<StoredGradingRule, "minPercent" | "maxPercent"> & {
  minPercent: number;
  maxPercent: number;
};

type GradingRuleWrite = Omit<GradingRule, "id" | "tierId" | "schoolId">;

function normalizeStoredGradingRule(rule: StoredGradingRule): GradingRule {
  const minPercent = Number(rule.minPercent);
  const maxPercent = Number(rule.maxPercent);
  percentageToHundredths(minPercent, "Stored grading rule minimum");
  percentageToHundredths(maxPercent, "Stored grading rule maximum");
  return { ...rule, minPercent, maxPercent };
}

function parseStoredPromotionRules(raw: string, rawResultsConfig: string): {
  ruleTermAverage?: { enabled: boolean; minPct: number };
  cumulativeConfig?: {
    enabled: boolean;
    triggerTerm: string;
    termWeights: Record<string, number>;
    promotionEnabled?: boolean;
    minPercent?: number;
  };
} {
  let rules: Record<string, any>;
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    rules = parsed as Record<string, any>;
  } catch {
    throw new PromotionStage1Error(
      "The configured Promotion rules are invalid.",
      409,
      "PROMOTION_POLICY_INVALID",
    );
  }

  const ruleTermAverage = rules.rule_term_avg?.enabled === true
    ? { enabled: true, minPct: Number(rules.rule_term_avg.minPct) }
    : undefined;
  if (ruleTermAverage && (!Number.isFinite(ruleTermAverage.minPct)
    || ruleTermAverage.minPct < 0 || ruleTermAverage.minPct > 100)) {
    throw new PromotionStage1Error(
      "The configured term-average Promotion rule is invalid.",
      409,
      "PROMOTION_POLICY_INVALID",
    );
  }

  let resultsConfig: Record<string, any>;
  try {
    const parsed: unknown = JSON.parse(rawResultsConfig || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    resultsConfig = parsed as Record<string, any>;
  } catch {
    throw new PromotionStage1Error(
      "The configured examination results policy is invalid.",
      409,
      "PROMOTION_POLICY_INVALID",
    );
  }
  const cumulative = resultsConfig.cumulative;
  let cumulativeConfig: {
    enabled: boolean;
    triggerTerm: string;
    termWeights: Record<string, number>;
    promotionEnabled?: boolean;
    minPercent?: number;
  } | undefined;
  if (cumulative && typeof cumulative === "object" && !Array.isArray(cumulative)) {
    const termWeights = cumulative.termWeights;
    if (!termWeights || typeof termWeights !== "object" || Array.isArray(termWeights)) {
      throw new PromotionStage1Error(
        "The configured cumulative examination policy is invalid.",
        409,
        "PROMOTION_POLICY_INVALID",
      );
    }
    cumulativeConfig = {
      enabled: cumulative.enabled === true,
      triggerTerm: String(cumulative.triggerTerm ?? ""),
      termWeights: Object.fromEntries(Object.entries(termWeights).map(([key, value]) => [key, Number(value)])),
      promotionEnabled: cumulative.promotionEnabled === true,
      minPercent: Number(cumulative.minPercent),
    };
  }
  return { ruleTermAverage, cumulativeConfig };
}

function assertPromotionGateEnabled(policy: ExamPolicyTier, term: string): void {
  let config: Record<string, any>;
  try {
    const parsed: unknown = JSON.parse(policy.resultsConfig || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    config = parsed as Record<string, any>;
  } catch {
    throw new PromotionStage1Error(
      "The configured examination results policy is invalid.",
      409,
      "PROMOTION_POLICY_INVALID",
    );
  }
  const termConfig = config.termConfigs?.[term] ?? config[term] ?? {};
  if (termConfig.promotionGate === false) {
    throw new PromotionStage1Error(
      "Promotion decisions are disabled for the selected examination term.",
      409,
      "PROMOTION_TERM_NOT_GATED",
    );
  }
}

async function lockPromotionCohort(
  tx: { execute: (query: SQL<unknown>) => Promise<unknown> },
  schoolId: number,
  sessionId: number,
  cls: string,
  section: string,
): Promise<void> {
  const identity = JSON.stringify([schoolId, sessionId, cls, section]);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
}

async function lockPromotionConfiguration(
  tx: { execute: (query: SQL<unknown>) => Promise<unknown> },
  schoolId: number,
): Promise<void> {
  const identity = `promotion-configuration:${schoolId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
}

function classMetadataValues(map: Record<string, unknown>, cls: string): unknown[] {
  const normalizedClass = cls.trim().toLowerCase().replace(/^class\s+/, "");
  return Object.entries(map)
    .filter(([key]) => key.trim().toLowerCase().replace(/^class\s+/, "") === normalizedClass)
    .map(([, value]) => value);
}

async function loadPromotionCohortEvaluation(
  tx: any,
  schoolId: number,
  sessionId: number,
  cls: string,
  section: string,
  term: string,
  allowArchivedSession = false,
  lockRows = true,
) {
  const withOptionalUpdateLock = (query: any) => lockRows ? query.for("update") : query;
  if (lockRows) await lockPromotionConfiguration(tx, schoolId);
  const [session] = await withOptionalUpdateLock(tx.select({
    id: academicSessions.id,
    schoolId: academicSessions.schoolId,
    isActive: academicSessions.isActive,
    startDate: academicSessions.startDate,
    endDate: academicSessions.endDate,
  }).from(academicSessions).where(and(
    eq(academicSessions.id, sessionId),
    eq(academicSessions.schoolId, schoolId),
  )));
  if (!session || (!session.isActive && !allowArchivedSession)) {
    throw new PromotionStage1Error(
      "Promotion decisions can only be saved for the active Academic Session.",
      403,
      "SESSION_NOT_WRITABLE",
    );
  }

  const policyTiers = await withOptionalUpdateLock(tx.select().from(examPolicyTiers)
    .where(eq(examPolicyTiers.schoolId, schoolId))
    .orderBy(examPolicyTiers.createdAt));
  const matchingPolicies = policyTiers.filter((policy: ExamPolicyTier) =>
    (policy.applicableClasses ?? []).some(value => value.trim() === cls.trim()),
  );
  if (matchingPolicies.length !== 1) {
    throw new PromotionStage1Error(
      matchingPolicies.length === 0
        ? `No examination policy is configured for Class ${cls}.`
        : `More than one examination policy applies to Class ${cls}.`,
      409,
      matchingPolicies.length === 0 ? "PROMOTION_POLICY_MISSING" : "PROMOTION_POLICY_AMBIGUOUS",
    );
  }
  const policy = matchingPolicies[0] as ExamPolicyTier;
  const components = resolvePromotionTermComponents(policy.examWeights, term);
  const parsedWeights: unknown = JSON.parse(policy.examWeights || "{}");
  const allTermKeys = Object.keys(parsedWeights as Record<string, unknown>);
  const allComponents = allTermKeys.flatMap(key => resolvePromotionTermComponents(policy.examWeights, key));
  const allSourceExams = [...new Set(allComponents.map(component => component.sourceExam))];
  if (!allSourceExams.length) {
    throw new PromotionStage1Error(
      "The examination policy has no configured assessment components.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }

  const examMetadataRows = await withOptionalUpdateLock(tx.select({
    metaKey: schoolMetadata.metaKey,
    metaValue: schoolMetadata.metaValue,
  }).from(schoolMetadata).where(and(
    eq(schoolMetadata.schoolId, schoolId),
    inArray(schoolMetadata.metaKey, ["exam_types", "class_exam_types", "class_subjects"]),
  )));
  const examMetadata = new Map<string, string>(examMetadataRows.map((row: {
    metaKey: string; metaValue: string;
  }) => [row.metaKey, row.metaValue]));
  let configuredExamTypes: unknown;
  let classExamTypes: unknown;
  let classSubjectMap: unknown;
  try { configuredExamTypes = JSON.parse(examMetadata.get("exam_types") ?? "[]"); } catch {}
  try { classExamTypes = JSON.parse(examMetadata.get("class_exam_types") ?? "{}"); } catch {}
  try { classSubjectMap = JSON.parse(examMetadata.get("class_subjects") ?? "{}"); } catch {}
  const classSubjectMatches = classSubjectMap && typeof classSubjectMap === "object" && !Array.isArray(classSubjectMap)
    ? classMetadataValues(classSubjectMap as Record<string, unknown>, cls)
    : [];
  const classExamMap = classExamTypes && typeof classExamTypes === "object" && !Array.isArray(classExamTypes)
    ? classExamTypes as Record<string, unknown>
    : {};
  const classExamMatches = classMetadataValues(classExamMap, cls);
  const classSubjects = classSubjectMatches.length === 1 ? classSubjectMatches[0] : undefined;
  const scopedExamTypes = classExamMatches.length === 1 ? classExamMatches[0] : undefined;
  if (!Array.isArray(configuredExamTypes)
    || components.some(component => !configuredExamTypes.includes(component.sourceExam))
    || allSourceExams.some(exam => !configuredExamTypes.includes(exam))) {
    throw new PromotionStage1Error(
      "The examination policy references assessment types that are not configured for this school.",
      409,
      "PROMOTION_TERM_POLICY_INVALID",
    );
  }
  if (
    !Array.isArray(classSubjects) ||
    classSubjectMatches.length !== 1 ||
    classSubjects.length === 0 ||
    classSubjects.some(value => typeof value !== "string" || !value.trim()) ||
    new Set(classSubjects.map(value => (value as string).trim())).size !== classSubjects.length ||
    (scopedExamTypes !== undefined && (
      !Array.isArray(scopedExamTypes) ||
      components.some(component => !scopedExamTypes.includes(component.sourceExam))
    )) ||
    (Object.keys(classExamMap).length > 0 && classExamMatches.length !== 1)
  ) {
    throw new PromotionStage1Error(
      "The exact class subject and assessment mappings are required to validate a complete Promotion result.",
      409,
      "PROMOTION_RESULT_CONFIGURATION_MISSING",
    );
  }
  const configuredSubjects = (classSubjects as string[]).map(subject => subject.trim());

  const rosterRows = await withOptionalUpdateLock(tx.select({
    studentId: students.id,
    schoolId: students.schoolId,
    isActive: students.isActive,
    dsid: students.digitalStudentId,
    name: students.name,
    rollNumber: students.rollNumber,
    identityKey: students.attendanceIdentityKey,
    enrollmentStatus: enrollments.status,
    enrollmentClass: enrollments.className,
    enrollmentSection: enrollments.sectionName,
  }).from(enrollments)
    .innerJoin(students, and(
      eq(students.id, enrollments.studentId),
      eq(students.schoolId, enrollments.schoolId),
    ))
    .where(and(
      eq(enrollments.schoolId, schoolId),
      eq(enrollments.sessionId, sessionId),
      eq(enrollments.className, cls),
      eq(enrollments.sectionName, section),
      eq(enrollments.status, "Active"),
      session.isActive ? eq(students.isActive, true) : undefined,
    ))
    .orderBy(students.id));
  if (!rosterRows.length) {
    throw new PromotionStage1Error(
      "There are no active Students in this exact session and class-section.",
      409,
      "PROMOTION_ROSTER_EMPTY",
    );
  }

  const studentIds = rosterRows.map((row: { studentId: number }) => row.studentId);
  const scoreRows = await withOptionalUpdateLock(tx.select({
    studentId: examScores.studentId,
    subject: examScores.subject,
    examType: examScores.examType,
    marks: examScores.marks,
    totalMarks: examScores.totalMarks,
    isAbsent: examScores.isAbsent,
  }).from(examScores).where(and(
    eq(examScores.schoolId, schoolId),
    eq(examScores.sessionId, sessionId),
    eq(examScores.class, cls),
    eq(examScores.section, section),
    inArray(examScores.studentId, studentIds),
    inArray(examScores.examType, allSourceExams),
  )));
  const applicableScoreRows = scoreRows.filter((row: { subject: string }) =>
    configuredSubjects.includes(row.subject.trim()),
  );

  const storedGradingTiers = await withOptionalUpdateLock(tx.select().from(gradingTiers)
    .where(eq(gradingTiers.schoolId, schoolId))
    .orderBy(gradingTiers.sortOrder));
  const gradingTier = storedGradingTiers.find((tier: GradingTier) =>
    (tier.classes ?? []).some(value => value.trim() === cls.trim()),
  ) as GradingTier | undefined;
  if (!gradingTier) {
    throw new PromotionStage1Error(
      `No grading tier is configured for Class ${cls}.`,
      409,
      "GRADING_POLICY_MISSING",
    );
  }
  const storedRules = await withOptionalUpdateLock(tx.select().from(gradingRules)
    .where(and(
      eq(gradingRules.schoolId, schoolId),
      eq(gradingRules.tierId, gradingTier.id),
    ))
    .orderBy(gradingRules.sortOrder));
  const normalizedRules = storedRules.map((rule: StoredGradingRule) => normalizeStoredGradingRule(rule));
  const { ruleTermAverage, cumulativeConfig } = parseStoredPromotionRules(
    policy.promotionFailRules,
    policy.resultsConfig,
  );

  const attendanceEndDate = session.endDate < todayInIST() ? session.endDate : todayInIST();
  const workingDateRows = attendanceEndDate < session.startDate ? [] : await tx.selectDistinct({
    date: attendanceRecords.date,
  }).from(attendanceRecords).where(and(
    eq(attendanceRecords.schoolId, schoolId),
    eq(attendanceRecords.sessionId, sessionId),
    eq(attendanceRecords.class, cls),
    eq(attendanceRecords.section, section),
    gte(attendanceRecords.date, session.startDate),
    lte(attendanceRecords.date, attendanceEndDate),
  ));
  const workingDates = workingDateRows.map((row: { date: string }) => row.date).sort();
  const attendanceRows = workingDates.length ? await withOptionalUpdateLock(tx.select({
    identityKey: attendanceRecords.identityKey,
    date: attendanceRecords.date,
    status: attendanceRecords.status,
  }).from(attendanceRecords).where(and(
    eq(attendanceRecords.schoolId, schoolId),
    eq(attendanceRecords.sessionId, sessionId),
    eq(attendanceRecords.class, cls),
    eq(attendanceRecords.section, section),
    gte(attendanceRecords.date, session.startDate),
    lte(attendanceRecords.date, attendanceEndDate),
  ))) : [];
  const attendanceByIdentityDate = new Map(attendanceRows.map((row: {
    identityKey: string; date: string; status: string;
  }) => [`${row.identityKey}:${row.date}`, row.status]));
  const attendance: ExaminationAttendance[] = rosterRows.map((student: {
    studentId: number; identityKey: string;
  }) => {
    const aggregation = aggregateStudentAttendance({
      schoolId,
      sessionId,
      statuses: workingDates.map((date: string) =>
        attendanceByIdentityDate.get(`${student.identityKey}:${date}`) ?? null,
      ),
    });
    return {
      studentId: student.studentId,
      attendancePct: aggregation.applicableWorkingDays > 0 ? aggregation.percentage : null,
      presentDays: aggregation.weightedAttendance,
      totalDays: aggregation.applicableWorkingDays,
    };
  });
  const scoresByStudent = new Map<number, ExaminationStudent["scores"]>();
  for (const row of applicableScoreRows) {
    const scores = scoresByStudent.get(row.studentId) ?? [];
    scores.push({
      subject: row.subject,
      examType: row.examType,
      marks: row.marks,
      totalMarks: row.totalMarks,
      isAbsent: row.isAbsent,
    });
    scoresByStudent.set(row.studentId, scores);
  }
  const examinationStudents: ExaminationStudent[] = rosterRows.map((row: {
    studentId: number; name: string; dsid: string; rollNumber: number | null;
  }) => {
    const scores = scoresByStudent.get(row.studentId) ?? [];
    for (const subject of configuredSubjects) {
      if (!scores.some(score => score.subject.trim() === subject)) {
        scores.push({
          subject,
          examType: "__MISSING_APPLICABLE_SCORE__",
          marks: 0,
          totalMarks: 0,
          isAbsent: false,
        });
      }
    }
    return {
      studentId: row.studentId,
      name: row.name,
      digitalStudentId: row.dsid,
      rollNumber: row.rollNumber,
      scores,
    };
  });
  let results;
  try {
    results = computeAllStudentResults({
      context: { schoolId, sessionId },
      students: examinationStudents,
      policy,
      attendance,
      passPercentage: gradingTier.passPercentage,
      gradingPolicy: { schoolId },
      gradingRules: normalizedRules,
      termAverageRule: ruleTermAverage,
      currentTerm: term,
      cumulativeConfig,
    });
  } catch (error) {
    throw new PromotionStage1Error(
      error instanceof Error ? error.message : "Unable to evaluate the configured Promotion policy.",
      409,
      "PROMOTION_POLICY_INVALID",
    );
  }

  return {
    components,
    policy,
    gradingTier,
    gradingRules: normalizedRules,
    rosterRows,
    scoreRows: applicableScoreRows,
    resultsByStudent: new Map(results.map(result => [result.studentId, result])),
  };
}

/**
 * Financial history cannot be detached from its original academic session.
 * Sessions with fee/payment evidence must be archived rather than deleted.
 */
export class AcademicSessionFinancialHistoryError extends Error {
  readonly status = 409;
  readonly code = "SESSION_HAS_FINANCIAL_HISTORY";

  constructor() {
    super("This academic session has financial history and cannot be deleted. Archive it instead.");
    this.name = "AcademicSessionFinancialHistoryError";
  }
}

export class AttendanceLeaveMutationError extends Error {
  constructor(message: string, readonly status: number = 409) {
    super(message);
    this.name = "AttendanceLeaveMutationError";
  }
}

export class StudentRegistryPlacementSessionError extends Error {
  readonly status = 409;

  constructor(readonly code: "NO_ACTIVE_SESSION" | "MULTIPLE_ACTIVE_SESSIONS" | "ACTIVE_SESSION_CHANGED") {
    super(code === "NO_ACTIVE_SESSION"
      ? "An active academic session is required to add a Student or change an active Student's placement."
      : code === "MULTIPLE_ACTIVE_SESSIONS"
        ? "Student placement cannot be synchronized because more than one academic session is active."
        : "The active academic session changed during this import. No further Students were added.");
    this.name = "StudentRegistryPlacementSessionError";
  }
}

export class StudentRegistryPlacementValidationError extends Error {
  readonly status = 400;
  readonly code = "INVALID_STUDENT_PLACEMENT";

  constructor() {
    super("The selected class and section are not configured for this school.");
    this.name = "StudentRegistryPlacementValidationError";
  }
}

type StudentUpdateData = {
  name: string; class: string; section: string; phone: string;
  gender?: string | null; rollNumber?: number | null; guardianName?: string | null;
  dob?: string; enrollmentDate?: string; bloodGroup?: string | null;
  fatherName?: string | null; motherName?: string | null;
  address?: string | null; aadharNumber?: string | null;
  email?: string | null;
};

export class TeacherEmailConflictError extends Error {
  readonly status = 409;

  constructor() {
    super("Unable to update teacher");
    this.name = "TeacherEmailConflictError";
  }
}

const UNSAFE_FEE_AUDIT_SEARCH_PATTERN = String.raw`(^|[^[:alnum:]])(pay|order|rfnd|disp|evt|plink|inv|cust|card)_[[:alnum:]_-]+|(^|[^[:alnum:]_])(signature|token|secret)[[:space:]]*[:=]|(raw_response|payload|gateway_response|error_code|error_source|error_step|error_reason|payer_contact|payer_email|contact|phone|mobile|vpa|card_last4)[[:space:]]*[:=]|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|(^|[^0-9])(\+?91[ -]?)?[6-9][0-9]{9}([^0-9]|$)|([0-9][ -]?){13,19}|([0-9]{1,3}\.){3}[0-9]{1,3}|([[:xdigit:]]{0,4}:){2,}[[:xdigit:].:]{0,}|[[:xdigit:]]{32,}|[[:alnum:]+/_=-]{40,}`;

/**
 * Stored legacy prose can predate the audit redaction contract. Exclude an
 * entire unsafe value from the searchable projection so hidden technical
 * evidence cannot be discovered through result membership.
 */
function searchableFeeAuditText(column: SQL): SQL {
  return sql`CASE
    WHEN COALESCE(${column}, '') ~* ${UNSAFE_FEE_AUDIT_SEARCH_PATTERN} THEN ''
    ELSE COALESCE(${column}, '')
  END`;
}

function buildCalendarAudienceFilter(
  filter?: Array<{ cls: string; sec?: string }>
): SQL | undefined {
  if (!filter || filter.length === 0) return undefined;
  const clauses: SQL[] = [eq(calendarEvents.audienceScope, "All_School")];
  for (const { cls, sec } of filter) {
    clauses.push(
      and(eq(calendarEvents.audienceScope, "Entire_Class"), eq(calendarEvents.targetClass, cls)) as SQL
    );
    if (sec) {
      clauses.push(
        and(
          eq(calendarEvents.audienceScope, "Specific_Section"),
          eq(calendarEvents.targetClass, cls),
          eq(calendarEvents.targetSection, sec)
        ) as SQL
      );
    }
    // Multi_Target: targetClass is a JSON array of classIds; targetSection is a JSON map of classId→sectionIds[]
    // Class matches if classId is in the JSON array.
    // Section matches if sectionIds is empty (= entire class) OR contains the requested section.
    clauses.push(
      sql`CASE WHEN ${calendarEvents.audienceScope} = 'Multi_Target' THEN (
        ${calendarEvents.targetClass}::jsonb @> ${JSON.stringify([cls])}::jsonb
        AND (
          COALESCE(jsonb_array_length(${calendarEvents.targetSection}::jsonb -> ${cls}), 0) = 0
          ${sec ? sql`OR ${calendarEvents.targetSection}::jsonb -> ${cls} @> ${JSON.stringify([sec])}::jsonb` : sql``}
        )
      ) ELSE FALSE END` as unknown as SQL
    );
  }
  return or(...clauses) as SQL;
}

export class DatabaseStorage {
  async getSchools(): Promise<School[]> {
    return await db.select().from(schools);
  }

  async getSchool(id: number): Promise<School | undefined> {
    const [school] = await db.select().from(schools).where(eq(schools.id, id));
    return school || undefined;
  }

  async getSchoolByCode(code: string): Promise<School | undefined> {
    const [school] = await db.select().from(schools).where(eq(schools.code, code));
    return school || undefined;
  }

  async createSchoolWithPrincipal(insertSchool: InsertSchool, email: string, passwordHash: string): Promise<School> {
    return await db.transaction(async (tx) => {
      const [school] = await tx.insert(schools).values(insertSchool).returning();
      await tx.insert(users).values({
        email,
        passwordHash,
        role: "admin",
        // The creator is the initial explicitly authorised financial admin.
        // Later administrators are not automatically granted refund power.
        canRefund: true,
        schoolId: school.id,
      });
      return school;
    });
  }

  async deleteSchool(id: number): Promise<boolean> {
    return await db.transaction(async (tx) => {
      // The payment-attempt event table is append-only during ordinary
      // application operation. Deleting an entire tenant is the authorized
      // erasure path, so enable the database's transaction-local cascade guard
      // only for this controlled operation.
      await tx.execute(sql`SELECT set_config('app.payment_history_cleanup', 'on', true)`);
      await tx.execute(sql`SELECT set_config('app.fee_audit_cleanup', 'on', true)`);
      const result = await tx.delete(schools).where(eq(schools.id, id)).returning();
      return result.length > 0;
    });
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByRecoveryEmail(recoveryEmail: string, schoolId: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(
      and(eq(users.recoveryEmail, recoveryEmail), eq(users.schoolId, schoolId))
    );
    return user || undefined;
  }

  async createPasswordResetChallenge(
    userId: number,
    schoolId: number,
    otpHash: string,
    otpExpiresAt: Date,
    requestIp: string | null,
  ): Promise<PasswordResetChallenge> {
    return db.transaction(async (tx) => {
      await tx.update(passwordResetChallenges)
        .set({ consumedAt: new Date() })
        .where(and(
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          isNull(passwordResetChallenges.consumedAt),
        ));
      const [challenge] = await tx.insert(passwordResetChallenges).values({
        userId,
        schoolId,
        otpHash,
        otpExpiresAt,
        requestIp,
      }).returning();
      return challenge;
    });
  }

  async createTeacherPasswordResetChallenge(
    userId: number,
    teacherId: number,
    schoolId: number,
    otpHash: string,
    otpExpiresAt: Date,
    resetTokenHash: string,
    resetTokenExpiresAt: Date,
    requestIp: string | null,
    now = new Date(),
  ): Promise<PasswordResetChallenge | null> {
    return db.transaction(async (tx) => {
      const [account] = await tx.select({ userId: users.id, teacherId: teachers.id })
        .from(users)
        .innerJoin(teachers, eq(teachers.userId, users.id))
        .where(and(
          eq(users.id, userId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
          eq(users.isActive, true),
          eq(teachers.id, teacherId),
          eq(teachers.schoolId, schoolId),
          eq(teachers.isActive, true),
        ))
        .limit(1)
        .for("update");
      if (!account) return null;

      await tx.update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          isNull(passwordResetChallenges.consumedAt),
        ));
      const [challenge] = await tx.insert(passwordResetChallenges).values({
        userId,
        schoolId,
        otpHash,
        otpExpiresAt,
        resetTokenHash,
        resetTokenExpiresAt,
        attemptCount: 0,
        verifiedAt: null,
        consumedAt: null,
        requestIp,
      }).returning();
      return challenge;
    });
  }

  async getPasswordResetChallenge(id: number): Promise<PasswordResetChallenge | undefined> {
    const [challenge] = await db.select().from(passwordResetChallenges)
      .where(eq(passwordResetChallenges.id, id));
    return challenge || undefined;
  }

  async recordPasswordResetOtpFailure(id: number, now = new Date()): Promise<PasswordResetChallenge | undefined> {
    const [challenge] = await db.update(passwordResetChallenges)
      .set({
        attemptCount: sql`${passwordResetChallenges.attemptCount} + 1`,
        consumedAt: sql`CASE WHEN ${passwordResetChallenges.attemptCount} + 1 >= 5 THEN ${now} ELSE ${passwordResetChallenges.consumedAt} END`,
      })
      .where(and(
        eq(passwordResetChallenges.id, id),
        isNull(passwordResetChallenges.consumedAt),
        isNull(passwordResetChallenges.verifiedAt),
        gt(passwordResetChallenges.otpExpiresAt, now),
        lt(passwordResetChallenges.attemptCount, 5),
      ))
      .returning();
    return challenge || undefined;
  }

  async verifyPasswordResetOtp(
    id: number,
    otpHash: string,
    resetTokenHash: string,
    resetTokenExpiresAt: Date,
    now = new Date(),
  ): Promise<PasswordResetChallenge | undefined> {
    const [challenge] = await db.update(passwordResetChallenges)
      .set({ verifiedAt: now, resetTokenHash, resetTokenExpiresAt })
      .where(and(
        eq(passwordResetChallenges.id, id),
        eq(passwordResetChallenges.otpHash, otpHash),
        isNull(passwordResetChallenges.consumedAt),
        isNull(passwordResetChallenges.verifiedAt),
        gt(passwordResetChallenges.otpExpiresAt, now),
        lt(passwordResetChallenges.attemptCount, 5),
      ))
      .returning();
    return challenge || undefined;
  }

  async resetPasswordForChallenge(
    challengeId: number,
    userId: number,
    schoolId: number,
    resetTokenHash: string,
    passwordHash: string,
    pinHash?: string,
    now = new Date(),
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(and(
        eq(users.id, userId),
        eq(users.schoolId, schoolId),
        eq(users.role, "admin"),
        eq(users.isActive, true),
      ));
      if (!user) return false;
      const [challenge] = await tx.update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(passwordResetChallenges.id, challengeId),
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          eq(passwordResetChallenges.resetTokenHash, resetTokenHash),
          isNull(passwordResetChallenges.consumedAt),
          isNotNull(passwordResetChallenges.verifiedAt),
          gt(passwordResetChallenges.resetTokenExpiresAt, now),
        ))
        .returning();
      if (!challenge) return false;

      const updates: Partial<typeof users.$inferInsert> = { passwordHash };
      if (pinHash) updates.pinHash = pinHash;
      await tx.update(users).set(updates).where(and(eq(users.id, userId), eq(users.schoolId, schoolId)));
      await tx.update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          isNull(passwordResetChallenges.consumedAt),
        ));
      return true;
    });
  }

  async resetTeacherPasswordForChallenge(
    challengeId: number,
    userId: number,
    schoolId: number,
    resetTokenHash: string,
    passwordHash: string,
    now = new Date(),
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [account] = await tx.select({ user: users, teacher: teachers })
        .from(users)
        .innerJoin(teachers, eq(teachers.userId, users.id))
        .where(and(
          eq(users.id, userId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
          eq(users.isActive, true),
          eq(teachers.schoolId, schoolId),
          eq(teachers.isActive, true),
        ))
        .limit(1)
        .for("update");
      if (!account) return false;

      const [challenge] = await tx.update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(passwordResetChallenges.id, challengeId),
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          eq(passwordResetChallenges.resetTokenHash, resetTokenHash),
          isNull(passwordResetChallenges.consumedAt),
          isNotNull(passwordResetChallenges.verifiedAt),
          gte(passwordResetChallenges.resetTokenExpiresAt, now),
        ))
        .returning();
      if (!challenge) return false;

      await tx.update(users)
        .set({ passwordHash })
        .where(and(
          eq(users.id, userId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
          eq(users.isActive, true),
        ));
      await tx.update(teachers)
        .set({ mustChangePassword: false })
        .where(and(
          eq(teachers.id, account.teacher.id),
          eq(teachers.userId, userId),
          eq(teachers.schoolId, schoolId),
        ));
      await tx.update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          isNull(passwordResetChallenges.consumedAt),
        ));
      return true;
    });
  }

  async invalidatePasswordResetChallenges(userId: number, schoolId: number): Promise<void> {
    await db.update(passwordResetChallenges).set({ consumedAt: new Date() }).where(and(
      eq(passwordResetChallenges.userId, userId),
      eq(passwordResetChallenges.schoolId, schoolId),
      isNull(passwordResetChallenges.consumedAt),
    ));
  }

  async invalidateUserSessions(userId: number): Promise<void> {
    try {
      await this.invalidateUserSessionsStrict(userId);
    } catch {
      // Session-store cleanup is best effort because deployments may use another store.
    }
  }

  async invalidateUserSessionsStrict(userId: number): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const revokedAt = Date.now();
      await client.query(
        `INSERT INTO "session" (sid, sess, expire)
         VALUES ($1, $2::json, $3)
         ON CONFLICT (sid) DO UPDATE
         SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [
          userSessionRevocationSid(userId),
          JSON.stringify({ revokedAt }),
          new Date(revokedAt + SESSION_REVOCATION_TTL_MS),
        ],
      );
      await client.query(
        `DELETE FROM "session" WHERE sess->>'userId' = $1`,
        [String(userId)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async invalidateUserSessionsInTransaction(
    tx: { execute: (query: SQL) => Promise<unknown> },
    userId: number,
    revokedAt = Date.now(),
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO "session" (sid, sess, expire)
      VALUES (
        ${userSessionRevocationSid(userId)},
        ${JSON.stringify({ revokedAt })}::json,
        ${new Date(revokedAt + SESSION_REVOCATION_TTL_MS)}
      )
      ON CONFLICT (sid) DO UPDATE
      SET sess = EXCLUDED.sess, expire = EXCLUDED.expire
    `);
    await tx.execute(sql`
      DELETE FROM "session"
      WHERE sess->>'userId' = ${String(userId)}
    `);
  }

  async getUserWithSchool(userId: number): Promise<{ user: User; school: School } | undefined> {
    const result = await db
      .select()
      .from(users)
      .innerJoin(schools, eq(users.schoolId, schools.id))
      .where(eq(users.id, userId));
    if (result.length === 0) return undefined;
    return { user: result[0].users, school: result[0].schools };
  }

  async getStudentsBySchool(schoolId: number): Promise<Student[]> {
    return await db.select().from(students).where(
      and(eq(students.schoolId, schoolId), eq(students.isActive, true))
    );
  }

  async getStudentsByClassSection(schoolId: number, cls: string, section: string): Promise<Student[]> {
    return await db.select().from(students).where(
      and(eq(students.schoolId, schoolId), eq(students.class, cls), eq(students.section, section), eq(students.isActive, true))
    );
  }

  async getStudentCountBySchool(schoolId: number): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(students)
      .where(eq(students.schoolId, schoolId));
    return result?.value ?? 0;
  }

  /**
   * Issues the next unique serial for a school's DTID or DSID.
   * Uses an atomic DB-level increment so the counter NEVER decreases,
   * even if teachers/students are deleted. A serial is never reused.
   */
  async issueNextIdSerial(schoolId: number, type: "dtid" | "dsid"): Promise<number> {
    const result = await pool.query<{ last_issued: number }>(
      `INSERT INTO id_sequences (school_id, type, last_issued)
         VALUES ($1, $2, 1)
       ON CONFLICT (school_id, type) DO UPDATE
         SET last_issued = id_sequences.last_issued + 1
       RETURNING last_issued`,
      [schoolId, type],
    );
    return result.rows[0].last_issued;
  }

  /**
   * Atomically reserve a bounded serial range for bulk Student imports.
   * The upsert preserves the same per-school sequence used by single-row adds.
   */
  async issueNextIdSerialRange(schoolId: number, type: "dtid" | "dsid", count: number): Promise<number[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
      throw new Error("Student ID serial ranges must contain between 1 and 100 IDs.");
    }
    const result = await pool.query<{ first_issued: number; last_issued: number }>(
      `INSERT INTO id_sequences (school_id, type, last_issued)
         VALUES ($1, $2, $3)
       ON CONFLICT (school_id, type) DO UPDATE
         SET last_issued = id_sequences.last_issued + EXCLUDED.last_issued
       RETURNING last_issued - $3 + 1 AS first_issued, last_issued`,
      [schoolId, type, count],
    );
    const first = Number(result.rows[0]?.first_issued);
    if (!Number.isSafeInteger(first) || first < 1) {
      throw new Error("Unable to reserve Student ID serials.");
    }
    return Array.from({ length: count }, (_unused, index) => first + index);
  }

  async getStudentRegistryImportContext(schoolId: number): Promise<{
    sessionId: number;
    placementMetadata: Array<{ metaKey: string; metaValue: string }>;
  }> {
    const activeSessions = await db
      .select({ id: academicSessions.id })
      .from(academicSessions)
      .where(and(
        eq(academicSessions.schoolId, schoolId),
        eq(academicSessions.isActive, true),
      ))
      .limit(2);
    if (activeSessions.length === 0) {
      throw new StudentRegistryPlacementSessionError("NO_ACTIVE_SESSION");
    }
    if (activeSessions.length !== 1) {
      throw new StudentRegistryPlacementSessionError("MULTIPLE_ACTIVE_SESSIONS");
    }

    const placementMetadata = await db
      .select({ metaKey: schoolMetadata.metaKey, metaValue: schoolMetadata.metaValue })
      .from(schoolMetadata)
      .where(and(
        eq(schoolMetadata.schoolId, schoolId),
        inArray(schoolMetadata.metaKey, ["classes", "sections", "class_sections"]),
      ));
    return { sessionId: activeSessions[0].id, placementMetadata };
  }

  async findExistingStudentDsids(schoolId: number, dsids: string[]): Promise<Set<string>> {
    if (dsids.length === 0) return new Set();
    const existing = await db
      .select({ digitalStudentId: students.digitalStudentId })
      .from(students)
      .where(and(
        eq(students.schoolId, schoolId),
        inArray(students.digitalStudentId, dsids),
      ));
    return new Set(existing.map(student => student.digitalStudentId));
  }

  /** @deprecated Use issueNextIdSerial instead */
  async getMaxDsidSerialForSchool(_schoolCode: string): Promise<number> {
    throw new Error("getMaxDsidSerialForSchool is deprecated — use issueNextIdSerial");
  }

  /** @deprecated Use issueNextIdSerial instead */
  async getMaxDtidSerialForSchool(_schoolCode: string): Promise<number> {
    throw new Error("getMaxDtidSerialForSchool is deprecated — use issueNextIdSerial");
  }

  async bulkCreateStudents(studentRecords: InsertStudent[]): Promise<Student[]> {
    if (studentRecords.length === 0) return [];
    return await db.transaction(async (tx) => {
      return await tx.insert(students).values(studentRecords).returning();
    });
  }

  async createStudent(insertStudent: InsertStudent): Promise<Student> {
    const [student] = await db.insert(students).values(insertStudent).returning();
    return student;
  }

  /**
   * Web Student Registry Add: create the profile and its active-session
   * enrollment together. A missing or ambiguous active session is a conflict,
   * not a reason to create an unenrolled Student.
   */
  async createStudentWithActiveSessionEnrollment(
    insertStudent: InsertStudent,
    expectedSessionId?: number,
  ): Promise<Student> {
    const [student] = await this.bulkCreateStudentsWithActiveSessionEnrollment(
      insertStudent.schoolId,
      [insertStudent],
      expectedSessionId,
    );
    if (!student) throw new Error("Student creation did not return a record.");
    return student;
  }

  /**
   * Web Student Registry import/add: each supplied chunk commits Student
   * profiles and matching active-session enrollments in the same transaction.
   * expectedSessionId pins multi-chunk imports to the session resolved up front.
   */
  async bulkCreateStudentsWithActiveSessionEnrollment(
    schoolId: number,
    insertStudents: InsertStudent[],
    expectedSessionId?: number,
  ): Promise<Student[]> {
    if (insertStudents.length === 0) return [];
    if (insertStudents.some(student => student.schoolId !== schoolId)) {
      throw new Error("Student import school does not match the authenticated school.");
    }

    return db.transaction(async (tx) => {
      const activeSessions = await tx
        .select({ id: academicSessions.id })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.schoolId, schoolId),
          eq(academicSessions.isActive, true),
        ))
        .limit(2)
        .for("update");

      if (activeSessions.length === 0) {
        throw new StudentRegistryPlacementSessionError("NO_ACTIVE_SESSION");
      }
      if (activeSessions.length !== 1) {
        throw new StudentRegistryPlacementSessionError("MULTIPLE_ACTIVE_SESSIONS");
      }
      if (expectedSessionId !== undefined && activeSessions[0].id !== expectedSessionId) {
        throw new StudentRegistryPlacementSessionError("ACTIVE_SESSION_CHANGED");
      }

      const placementMetadata = await tx
        .select({ metaKey: schoolMetadata.metaKey, metaValue: schoolMetadata.metaValue })
        .from(schoolMetadata)
        .where(and(
          eq(schoolMetadata.schoolId, schoolId),
          inArray(schoolMetadata.metaKey, ["classes", "sections", "class_sections"]),
        ));
      for (const insertStudent of insertStudents) {
        if (!isConfiguredStudentPlacement(placementMetadata, insertStudent.class, insertStudent.section)) {
          throw new StudentRegistryPlacementValidationError();
        }
      }

      const insertedStudents = await tx.insert(students).values(insertStudents).returning();
      if (insertedStudents.length !== insertStudents.length) {
        throw new Error("Student import did not create every requested profile.");
      }
      await tx.insert(enrollments).values(insertedStudents.map(student => ({
        schoolId,
        studentId: student.id,
        sessionId: activeSessions[0].id,
        className: student.class,
        sectionName: student.section,
        rollNo: student.rollNumber ?? null,
        status: "Active",
      })));
      return insertedStudents;
    });
  }

  async getStudentById(id: number): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.id, id));
    return student || undefined;
  }

  async getStudentsByIdsForSchool(studentIds: number[], schoolId: number): Promise<Student[]> {
    if (studentIds.length === 0) return [];
    return await db.select().from(students).where(and(
      eq(students.schoolId, schoolId),
      inArray(students.id, studentIds),
    ));
  }

  async getStudentByDsid(dsid: string): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.digitalStudentId, dsid));
    return student || undefined;
  }

  async getStudentByDsidAndSchool(
    dsid: string,
    schoolId: number,
  ): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(and(
      eq(students.digitalStudentId, dsid),
      eq(students.schoolId, schoolId),
    ));
    return student || undefined;
  }

  async authenticateStudentByDsidForLogin(
    dsid: string,
    password: string,
  ): Promise<
    | { status: "not_found" }
    | { status: "inactive" }
    | { status: "not_activated" }
    | { status: "invalid" }
    | { status: "success"; student: Student; authIssuedAt: number }
  > {
    // This lookup only selects the lock key. Every security decision below is
    // made from the locked, authoritative row.
    const preliminary = await this.getStudentByDsid(dsid);
    if (!preliminary) return { status: "not_found" };
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${preliminary.schoolId}, ${preliminary.id})`);
      const lockClock = await tx.execute<{ now: Date }>(sql`SELECT clock_timestamp() AS now`);
      const authIssuedAt = new Date(lockClock.rows[0].now).getTime();
      const [student] = await tx.select().from(students).where(and(
        eq(students.id, preliminary.id),
        eq(students.schoolId, preliminary.schoolId),
        eq(students.digitalStudentId, dsid),
      )).for("update");
      if (!student) return { status: "not_found" as const };
      if (!student.isActive) return { status: "inactive" as const };
      if (!student.isActivated) return { status: "not_activated" as const };
      if (!await bcrypt.compare(password, student.passwordHash)) {
        return { status: "invalid" as const };
      }
      const marker = await tx.execute<{ revoked_at: string | null }>(sql`
        SELECT sess->>'revokedAt' AS revoked_at
        FROM "session"
        WHERE sid = ${studentSessionRevocationSid(student.id)}
          AND expire > NOW()
        LIMIT 1
      `);
      const revokedAt = marker.rows.length > 0 ? Number(marker.rows[0].revoked_at) : null;
      if (revokedAt !== null && (!Number.isFinite(revokedAt) || authIssuedAt <= revokedAt)) {
        return { status: "invalid" as const };
      }
      return { status: "success" as const, student, authIssuedAt };
    });
  }

  async getStudentByDsidPhoneDob(dsid: string, phone: string, dob: string): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(
      and(eq(students.digitalStudentId, dsid), eq(students.phone, phone), eq(students.dob, dob))
    );
    return student || undefined;
  }

  async activateStudent(studentId: number, passwordHash: string, enrollmentDate?: string): Promise<Student> {
    const setFields: Partial<typeof students.$inferInsert> = { passwordHash, isActivated: true };
    if (enrollmentDate) setFields.enrollmentDate = enrollmentDate;
    const [student] = await db.update(students).set(setFields).where(eq(students.id, studentId)).returning();
    return student;
  }

  async updateStudentLivePhoto(studentId: number, photoUrl: string): Promise<void> {
    await db.update(students).set({ photoUrl }).where(eq(students.id, studentId));
  }

  async updateStudentLiveFieldsForTeacherApproval(
    studentId: number,
    schoolId: number,
    data: Record<string, unknown>,
  ): Promise<Student | undefined> {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${studentId})`);
      const [before] = await tx.select({ email: students.email })
        .from(students)
        .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)))
        .for("update");
      if (!before) return undefined;

      const [updated] = await tx.update(students)
        .set(data as Partial<typeof students.$inferInsert>)
        .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)))
        .returning();

      const emailChanged = Object.prototype.hasOwnProperty.call(data, "email")
        && String(data.email ?? "").trim().toLowerCase() !== (before.email ?? "").trim().toLowerCase();
      if (emailChanged) {
        await tx.update(studentPasswordResetChallenges)
          .set({ consumedAt: new Date() })
          .where(and(
            eq(studentPasswordResetChallenges.studentId, studentId),
            eq(studentPasswordResetChallenges.schoolId, schoolId),
            isNull(studentPasswordResetChallenges.consumedAt),
          ));
      }
      return updated;
    });
  }

  async updateStudentVerifiedProfile(studentId: number, verifiedProfileJson: string): Promise<void> {
    await db.update(students).set({ verifiedProfile: verifiedProfileJson }).where(eq(students.id, studentId));
  }

  async getStudentWithSchool(studentId: number): Promise<{ student: Student; school: School } | undefined> {
    const result = await db.select().from(students)
      .innerJoin(schools, eq(students.schoolId, schools.id))
      .where(eq(students.id, studentId));
    if (result.length === 0) return undefined;
    return { student: result[0].students, school: result[0].schools };
  }

  // ===== TEACHER METHODS =====
  async createTeacher(teacherData: Omit<InsertTeacher, 'userId'>, email: string, passwordHash: string): Promise<Teacher> {
    return await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        email,
        passwordHash,
        role: "teacher",
        schoolId: teacherData.schoolId,
      }).returning();
      const [teacher] = await tx.insert(teachers).values({
        ...teacherData,
        userId: user.id,
      }).returning();
      return teacher;
    });
  }

  async getTeachersBySchool(schoolId: number): Promise<(Teacher & { email: string })[]> {
    const result = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(eq(teachers.schoolId, schoolId));
    return result.map(r => ({ ...r.teachers, email: r.users.email }));
  }

  async getTeacherCountBySchool(schoolId: number): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(teachers)
      .where(eq(teachers.schoolId, schoolId));
    return result?.value ?? 0;
  }

  async getTeacherByUserId(userId: number): Promise<Teacher | undefined> {
    const [teacher] = await db.select().from(teachers).where(eq(teachers.userId, userId));
    return teacher || undefined;
  }

  async getTeacherById(teacherId: number): Promise<Teacher | undefined> {
    const [teacher] = await db.select().from(teachers).where(eq(teachers.id, teacherId));
    return teacher || undefined;
  }

  async getTeacherWithSchool(teacherId: number): Promise<{ teacher: Teacher; school: School; user: User } | undefined> {
    const result = await db.select().from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(eq(teachers.id, teacherId));
    if (result.length === 0) return undefined;
    return { teacher: result[0].teachers, school: result[0].schools, user: result[0].users };
  }

  async changeTeacherPasswordAtomically(
    userId: number,
    teacherId: number,
    schoolId: number,
    currentPassword: string,
    passwordHash: string,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [account] = await tx.select({ user: users, teacher: teachers })
        .from(users)
        .innerJoin(teachers, eq(teachers.userId, users.id))
        .where(and(
          eq(users.id, userId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
          eq(users.isActive, true),
          eq(teachers.id, teacherId),
          eq(teachers.userId, userId),
          eq(teachers.schoolId, schoolId),
          eq(teachers.isActive, true),
        ))
        .limit(1);
      if (!account) return false;

      const currentPasswordValid = await bcrypt.compare(
        currentPassword,
        account.user.passwordHash,
      );
      if (!currentPasswordValid) return false;

      const [updatedUser] = await tx.update(users)
        .set({ passwordHash })
        .where(and(
          eq(users.id, userId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
          eq(users.isActive, true),
          eq(users.passwordHash, account.user.passwordHash),
        ))
        .returning({ id: users.id });
      if (!updatedUser) return false;

      const [updatedTeacher] = await tx.update(teachers)
        .set({ mustChangePassword: false })
        .where(and(
          eq(teachers.id, teacherId),
          eq(teachers.userId, userId),
          eq(teachers.schoolId, schoolId),
          eq(teachers.isActive, true),
        ))
        .returning({ id: teachers.id });
      if (!updatedTeacher) {
        throw new Error("Teacher password state changed during update");
      }

      await tx.update(passwordResetChallenges)
        .set({ consumedAt: new Date() })
        .where(and(
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          isNull(passwordResetChallenges.consumedAt),
        ));
      return true;
    });
  }

  async deleteTeacher(teacherId: number, schoolId: number): Promise<boolean> {
    const teacher = await this.getTeacherById(teacherId);
    if (!teacher || teacher.schoolId !== schoolId) return false;
    await db.delete(teachers).where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)));
    await db.delete(users).where(eq(users.id, teacher.userId));
    return true;
  }

  async logRemovedTeacher(entry: {
    schoolId: number;
    digitalTeacherId: string | null;
    fullName: string;
    email: string | null;
    phone: string | null;
    subject: string | null;
    assignedClass: string | null;
    assignedSection: string | null;
    designation: string | null;
    gender: string | null;
    dateOfBirth: string | null;
    govtIdType: string | null;
    govtIdNumber: string | null;
    address: string | null;
    joiningDate: string | null;
    qualifications: string | null;
    removalReason: string;
    removedByEmail: string | null;
  }): Promise<void> {
    await db.insert(removedTeachersLog).values(entry);
  }

  async getRemovedTeachersLog(schoolId: number, opts: { page: number; limit: number; q?: string }): Promise<{ data: RemovedTeacherLog[]; total: number; pages: number }> {
    const offset = (opts.page - 1) * opts.limit;
    const baseWhere = opts.q?.trim()
      ? and(
          eq(removedTeachersLog.schoolId, schoolId),
          or(
            ilike(removedTeachersLog.fullName, `%${opts.q}%`),
            ilike(removedTeachersLog.digitalTeacherId, `%${opts.q}%`),
            ilike(removedTeachersLog.email, `%${opts.q}%`),
          )
        )
      : eq(removedTeachersLog.schoolId, schoolId);

    const [totalRow] = await db.select({ count: count() }).from(removedTeachersLog).where(baseWhere);
    const total = Number(totalRow.count);

    const data = await db.select().from(removedTeachersLog)
      .where(baseWhere)
      .orderBy(desc(removedTeachersLog.removedAt))
      .limit(opts.limit)
      .offset(offset);

    return { data, total, pages: Math.max(1, Math.ceil(total / opts.limit)) };
  }

  async deactivateTeacher(teacherId: number, schoolId: number, reason: string): Promise<Teacher | undefined> {
    const teacher = await this.getTeacherById(teacherId);
    if (!teacher || teacher.schoolId !== schoolId) return undefined;
    // Block the teacher's login account
    await db.update(users).set({ isActive: false }).where(eq(users.id, teacher.userId));
    // Record deactivation metadata on the teacher row
    const [updated] = await db.update(teachers)
      .set({ isActive: false, deactivatedAt: new Date(), deactivationReason: reason })
      .where(eq(teachers.id, teacherId))
      .returning();
    return updated;
  }

  async reactivateTeacher(teacherId: number, schoolId: number): Promise<Teacher | undefined> {
    const teacher = await this.getTeacherById(teacherId);
    if (!teacher || teacher.schoolId !== schoolId) return undefined;
    await db.update(users).set({ isActive: true }).where(eq(users.id, teacher.userId));
    const [updated] = await db.update(teachers)
      .set({ isActive: true, deactivatedAt: null, deactivationReason: null })
      .where(eq(teachers.id, teacherId))
      .returning();
    return updated;
  }

  // ===== ATTENDANCE METHODS =====
  async getAttendanceByClassDate(schoolId: number, sessionId: number, cls: string, section: string, date: string): Promise<AttendanceRecord[]> {
    return await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
        eq(attendanceRecords.class, cls),
        eq(attendanceRecords.section, section),
        eq(attendanceRecords.date, date),
      )
    ).then(records => {
      return records;
    });
  }

  async getAttendanceForStudentsOnDate(
    schoolId: number,
    sessionId: number,
    studentIds: number[],
    cls: string,
    section: string,
    date: string,
  ): Promise<AttendanceRecord[]> {
    if (studentIds.length === 0) return [];
    const allRecords = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.class, cls),
      eq(attendanceRecords.section, section),
      eq(attendanceRecords.date, date),
    ));
    return allRecords.filter(r => r.studentId !== null && studentIds.includes(r.studentId));
  }

  async getAttendanceRosterForSessionClass(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
  ): Promise<Student[]> {
    const [session, enrolledInClass, allSessionEnrollments, attendanceStudents, currentStudents] = await Promise.all([
      this.getAcademicSessionForSchool(sessionId, schoolId),
      this.getStudentsByClassSectionInSession(schoolId, cls, section, sessionId),
      db.select({ studentId: enrollments.studentId, identityKey: students.attendanceIdentityKey })
        .from(enrollments).innerJoin(students, and(
          eq(students.id, enrollments.studentId),
          eq(students.schoolId, enrollments.schoolId),
        )).where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
      )),
      db.select({ student: students }).from(students).innerJoin(attendanceRecords, and(
        eq(attendanceRecords.studentId, students.id),
        eq(attendanceRecords.schoolId, students.schoolId),
      )).where(and(
        eq(students.schoolId, schoolId),
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
        eq(attendanceRecords.class, cls),
        eq(attendanceRecords.section, section),
      )),
      this.getStudentsByClassSection(schoolId, cls, section),
    ]);

    const enrolledStudentIds = new Set(allSessionEnrollments.map(row => row.studentId));
    const roster = new Map(enrolledInClass.map(student => [student.id, student]));
    for (const { student } of attendanceStudents) {
      if (!enrolledStudentIds.has(student.id)) roster.set(student.id, student);
    }
    if (session?.isActive) {
      for (const student of currentStudents) {
        if (!enrolledStudentIds.has(student.id)) roster.set(student.id, student);
      }
    }
    return [...roster.values()];
  }

  async getLiveAttendanceRosterForSessionClass(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
  ): Promise<Student[]> {
    const scope = {
      schoolId,
      sessionId,
      className: cls,
      sectionName: section,
    };
    const rows = await db.select({ student: students, enrollment: enrollments })
      .from(enrollments)
      .innerJoin(students, and(
        eq(students.id, enrollments.studentId),
        eq(students.schoolId, enrollments.schoolId),
      ))
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(students.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.className, cls),
        eq(enrollments.sectionName, section),
        eq(enrollments.status, "Active"),
        eq(students.isActive, true),
      ));

    return rows
      .filter(({ student, enrollment }) =>
        isEligibleForLiveStudentAttendance(student, enrollment, scope))
      .map(({ student }) => student);
  }

  async getAttendanceReportRosterForSessionClass(
    schoolId: number, sessionId: number, cls: string, section: string,
  ): Promise<Array<Pick<Student, "id" | "name" | "digitalStudentId" | "class" | "section" | "photoUrl" | "schoolId"> & { identityKey: string }>> {
    const live = await this.getAttendanceRosterForSessionClass(schoolId, sessionId, cls, section);
    const records = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.class, cls), eq(attendanceRecords.section, section),
    ));
    const liveByIdentity = new Set(live.map(student => student.attendanceIdentityKey));
    const result = new Map<string, any>(live.map(student => [student.attendanceIdentityKey, {
      id: student.id, name: student.name, digitalStudentId: student.digitalStudentId,
      class: student.class, section: student.section, photoUrl: student.photoUrl,
      schoolId, identityKey: student.attendanceIdentityKey,
    }]));
    for (const record of records) {
      if (!liveByIdentity.has(record.identityKey) && !result.has(record.identityKey)) {
        result.set(record.identityKey, {
          // Negative row IDs avoid colliding with a later student reusing the
          // deleted student's numeric primary key.
          id: -record.id, name: record.studentNameSnapshot,
          digitalStudentId: record.studentCodeSnapshot, class: cls, section,
          photoUrl: null, schoolId, identityKey: record.identityKey,
        });
      }
    }
    return [...result.values()];
  }

  async getAttendanceClassSectionOptions(
    schoolId: number,
    sessionId: number,
  ): Promise<Array<{ className: string; sectionName: string }>> {
    const session = await this.getAcademicSessionForSchool(sessionId, schoolId);
    if (!session) return [];

    const enrollmentConditions = [
      eq(enrollments.schoolId, schoolId),
      eq(students.schoolId, schoolId),
      eq(enrollments.sessionId, sessionId),
    ];
    if (session.isActive) {
      enrollmentConditions.push(
        eq(enrollments.status, "Active"),
        eq(students.isActive, true),
      );
    }

    const enrollmentRows = await db
      .select({ student: students, enrollment: enrollments })
      .from(enrollments)
      .innerJoin(students, and(
        eq(students.id, enrollments.studentId),
        eq(students.schoolId, enrollments.schoolId),
      ))
      .where(and(...enrollmentConditions));

    const selectedSessionEnrollments = session.isActive
      ? enrollmentRows.filter(({ student, enrollment }) => isEligibleForLiveStudentAttendance(
          student,
          enrollment,
          {
            schoolId,
            sessionId,
            className: enrollment.className,
            sectionName: enrollment.sectionName,
          },
        ))
      : enrollmentRows;

    const historicalAttendanceRows = session.isActive
      ? []
      : await db.selectDistinct({
          className: attendanceRecords.class,
          sectionName: attendanceRecords.section,
        }).from(attendanceRecords).where(and(
          eq(attendanceRecords.schoolId, schoolId),
          eq(attendanceRecords.sessionId, sessionId),
        ));

    return normalizeAttendanceClassSections([
      ...selectedSessionEnrollments.map(({ enrollment }) => ({
        className: enrollment.className,
        sectionName: enrollment.sectionName,
      })),
      ...historicalAttendanceRows,
    ]);
  }

  async getAttendancePopulationForSession(schoolId: number, sessionId: number): Promise<number> {
    const [session, enrolledRows, attendanceRows, currentActiveRows] = await Promise.all([
      this.getAcademicSessionForSchool(sessionId, schoolId),
      db.select({ studentId: enrollments.studentId, identityKey: students.attendanceIdentityKey })
        .from(enrollments).innerJoin(students, and(
          eq(students.id, enrollments.studentId),
          eq(students.schoolId, enrollments.schoolId),
        )).where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
      )),
      db.selectDistinct({ identityKey: attendanceRecords.identityKey }).from(attendanceRecords).where(and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
      )),
      db.select({ studentId: students.id, identityKey: students.attendanceIdentityKey }).from(students).where(and(
        eq(students.schoolId, schoolId),
        eq(students.isActive, true),
      )),
    ]);
    const enrolledStudentIds = new Set(enrolledRows.map(row => row.identityKey));
    return new Set([
      ...enrolledRows.map(row => row.identityKey),
      ...attendanceRows.map(row => row.identityKey),
      ...(session?.isActive
        ? currentActiveRows
            .filter(row => !enrolledStudentIds.has(row.identityKey))
            .map(row => row.identityKey)
        : []),
    ]).size;
  }

  async getStudentsByClassSectionForExamSession(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
  ): Promise<Student[]> {
    const session = await this.getAcademicSessionForSchool(sessionId, schoolId);
    if (!session) return [];

    // Results require an exact active Enrollment. Unlike live Attendance,
    // Registry and Attendance-snapshot fallback placement is never sufficient.
    // Historical sessions retain their enrolled students after later deactivation.
    const rows = await db.select({ student: students })
      .from(enrollments)
      .innerJoin(students, and(
        eq(students.id, enrollments.studentId),
        eq(students.schoolId, enrollments.schoolId),
      ))
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.className, cls),
        eq(enrollments.sectionName, section),
        eq(enrollments.status, "Active"),
        session.isActive ? eq(students.isActive, true) : undefined,
      ))
      .orderBy(enrollments.rollNo, students.digitalStudentId);
    return rows.map(row => row.student);
  }

  async resolveAttendanceClassSectionForStudent(
    schoolId: number,
    sessionId: number,
    studentId: number,
  ): Promise<{ class: string; section: string } | null> {
    const enrollment = await this.resolveEnrollmentForStudentSession(schoolId, studentId, sessionId);
    if (enrollment?.className && enrollment.sectionName) {
      return { class: enrollment.className, section: enrollment.sectionName };
    }
    const [snapshot] = await db.select({
      class: attendanceRecords.class,
      section: attendanceRecords.section,
    }).from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.studentId, studentId),
      isNotNull(attendanceRecords.class),
      isNotNull(attendanceRecords.section),
    )).orderBy(attendanceRecords.date, attendanceRecords.id).limit(1);
    return snapshot?.class && snapshot.section
      ? { class: snapshot.class, section: snapshot.section }
      : null;
  }

  async upsertAttendance(records: { studentId: number; teacherId: number; schoolId: number; sessionId: number; date: string; status: string; markedBy: string; class?: string; section?: string; academicYear?: string }[]): Promise<AttendanceRecord[]> {
    if (records.length === 0) return [];
    return await db.transaction(async (tx) => {
      const results: AttendanceRecord[] = [];
      const studentIds = [...new Set(records.map(record => record.studentId))];
      const teacherIds = [...new Set(records.map(record => record.teacherId))];
      const sessionIds = [...new Set(records.map(record => record.sessionId))];

      if (sessionIds.some(sessionId => !Number.isInteger(sessionId) || sessionId <= 0)) {
        throw new Error("Attendance sessionId is required");
      }

      const promotionCohorts = [...new Set(records
        .filter(record => record.class?.trim() && record.section?.trim())
        .map(record => JSON.stringify([
          record.schoolId, record.sessionId, record.class, record.section,
        ])))].sort();
      for (const key of promotionCohorts) {
        const [cohortSchoolId, cohortSessionId, cls, section] =
          JSON.parse(key) as [number, number, string, string];
        await lockPromotionCohort(tx, cohortSchoolId, cohortSessionId, cls, section);
      }

      const [ownedStudents, ownedTeachers, ownedSessions] = await Promise.all([
        tx.select({ id: students.id, schoolId: students.schoolId, isActive: students.isActive, attendanceIdentityKey: students.attendanceIdentityKey, name: students.name, digitalStudentId: students.digitalStudentId }).from(students)
          .where(inArray(students.id, studentIds)),
        tx.select({ id: teachers.id, schoolId: teachers.schoolId }).from(teachers)
          .where(inArray(teachers.id, teacherIds)),
        tx.select({ id: academicSessions.id, schoolId: academicSessions.schoolId }).from(academicSessions)
          .where(inArray(academicSessions.id, sessionIds)),
      ]);
      const studentSchools = new Map(ownedStudents.map(student => [student.id, student.schoolId]));
      const teacherSchools = new Map(ownedTeachers.map(teacher => [teacher.id, teacher.schoolId]));
      const sessionSchools = new Map(ownedSessions.map(session => [session.id, session.schoolId]));

      for (const rec of records) {
        if (
          studentSchools.get(rec.studentId) !== rec.schoolId ||
          teacherSchools.get(rec.teacherId) !== rec.schoolId ||
          sessionSchools.get(rec.sessionId) !== rec.schoolId
        ) {
          throw new Error("Attendance entities do not belong to the same school");
        }
      }

      for (const rec of records) {
      if (!Number.isInteger(rec.sessionId) || rec.sessionId <= 0) {
        throw new Error("Attendance sessionId is required");
      }
      const existing = await tx.select().from(attendanceRecords).where(
        and(
          eq(attendanceRecords.schoolId, rec.schoolId),
          eq(attendanceRecords.sessionId, rec.sessionId),
          eq(attendanceRecords.identityKey, ownedStudents.find(student => student.id === rec.studentId)!.attendanceIdentityKey),
          eq(attendanceRecords.date, rec.date),
        )
      );
      if (existing.length > 0) {
        const current = existing[0];
        if (current.editCount >= 3) continue;
        const [updated] = await tx.update(attendanceRecords).set({
          status: rec.status,
          editCount: current.editCount + 1,
          markedBy: rec.markedBy,
          markedAt: new Date(),
          ...(rec.class && { class: rec.class }),
          ...(rec.section && { section: rec.section }),
          ...(rec.academicYear && { academicYear: rec.academicYear }),
        }).where(eq(attendanceRecords.id, current.id)).returning();
        results.push(updated);
      } else {
        const [created] = await tx.insert(attendanceRecords).values({
          studentId: rec.studentId,
          teacherId: rec.teacherId,
          schoolId: rec.schoolId,
          sessionId: rec.sessionId,
          date: rec.date,
          status: rec.status,
          editCount: 0,
          markedBy: rec.markedBy,
          markedAt: new Date(),
          class: rec.class,
          section: rec.section,
          academicYear: rec.academicYear,
           originalStudentId: rec.studentId,
           identityKey: ownedStudents.find(student => student.id === rec.studentId)!.attendanceIdentityKey,
           studentNameSnapshot: ownedStudents.find(student => student.id === rec.studentId)!.name,
           studentCodeSnapshot: ownedStudents.find(student => student.id === rec.studentId)!.digitalStudentId,
        }).returning();
        results.push(created);
      }
      }
      return results;
    });
  }

  async getAttendanceHistory(schoolId: number, sessionId: number, cls: string, section: string, startDate: string, endDate: string): Promise<(AttendanceRecord & { studentName: string; dsid: string })[]> {
    const studentList = await this.getAttendanceReportRosterForSessionClass(schoolId, sessionId, cls, section);
    const conditions = [
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.class, cls),
      eq(attendanceRecords.section, section),
      gte(attendanceRecords.date, startDate),
      lte(attendanceRecords.date, endDate),
    ];
    const allRecords = await db.select().from(attendanceRecords).where(and(...conditions));
    const rosterIdentityKeys = new Set(studentList.map(s => s.identityKey));
    const filtered = allRecords.filter(r => rosterIdentityKeys.has(r.identityKey));
    const studentMap = new Map(studentList.map(s => [s.identityKey, s]));
    return filtered.map(r => ({
      ...r,
      studentName: r.studentNameSnapshot,
      dsid: r.studentCodeSnapshot,
    }));
  }

  async hasAttendanceToday(teacherId: number, cls: string, section: string, schoolId: number, sessionId: number): Promise<boolean> {
    const today = todayInIST();
    const studentList = await this.getAttendanceRosterForSessionClass(schoolId, sessionId, cls, section);
    if (studentList.length === 0) return false;
    const studentIds = studentList.map(s => s.id);
    const records = await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
        eq(attendanceRecords.class, cls),
        eq(attendanceRecords.section, section),
        eq(attendanceRecords.date, today),
        eq(attendanceRecords.teacherId, teacherId),
      )
    );
    return records.some(r => r.studentId !== null && studentIds.includes(r.studentId));
  }

  // ===== HOMEWORK METHODS =====
  async createHomework(data: InsertHomework): Promise<Homework> {
    const [hw] = await db.insert(homework).values(data).returning();
    return hw;
  }

  async getHomeworkByClass(schoolId: number, cls: string, section: string, sessionId: number): Promise<Homework[]> {
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      throw new Error("Homework requires a valid academic session");
    }
    return await db.select().from(homework).where(
      and(
        eq(homework.schoolId, schoolId),
        eq(homework.class, cls),
        eq(homework.section, section),
        eq(homework.sessionId, sessionId),
      )
    ).orderBy(desc(homework.createdAt));
  }

  /** Returns the student roster for a specific academic session via the enrollments table.
   *  Used by teacher attendance/roster lookups in archive (look-back) mode. */
  async getStudentsByClassSectionInSession(schoolId: number, cls: string, section: string, sessionId: number): Promise<Student[]> {
    const rows = await db
      .select({ student: students })
      .from(students)
      .innerJoin(enrollments, and(
        eq(enrollments.studentId, students.id),
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.className, cls),
        eq(enrollments.sectionName, section),
      ))
      .where(eq(students.schoolId, schoolId));
    return rows.map(r => r.student);
  }

  async getHomeworkRosterInSession(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    isActiveSession: boolean,
  ) {
    const enrolledRows = await db.select({
      studentId: students.id,
      studentName: students.name,
      digitalStudentId: students.digitalStudentId,
      studentSchoolId: students.schoolId,
      studentIsActive: students.isActive,
      enrollmentSchoolId: enrollments.schoolId,
      enrollmentSessionId: enrollments.sessionId,
      enrollmentStatus: enrollments.status,
      className: enrollments.className,
      sectionName: enrollments.sectionName,
      rollNo: enrollments.rollNo,
    }).from(enrollments)
      .innerJoin(students, eq(enrollments.studentId, students.id))
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.className, cls),
        eq(enrollments.sectionName, section),
        eq(students.schoolId, schoolId),
      ))
      .orderBy(asc(students.name), asc(enrollments.rollNo));

    return enrolledRows.filter((row) =>
      isHomeworkReviewRosterEligible(
        row.studentIsActive,
        row.enrollmentStatus,
        isActiveSession,
      ),
    );
  }

  async getHomeworkReviewRoster(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    homeworkId: number,
    isActiveSession: boolean,
  ) {
    const eligibleRows = await this.getHomeworkRosterInSession(
      schoolId, sessionId, cls, section, isActiveSession,
    );
    if (eligibleRows.length === 0) return [];

    const studentIds = [...new Set(eligibleRows.map((row) => row.studentId))];
    const submissions = await db.select({
      submission: homeworkSubmissions,
      reviewToken: sql<string>`to_char(${homeworkSubmissions.submittedAt}, 'YYYY-MM-DD HH24:MI:SS.US')`,
    }).from(homeworkSubmissions).where(and(
      eq(homeworkSubmissions.homeworkId, homeworkId),
      eq(homeworkSubmissions.schoolId, schoolId),
      inArray(homeworkSubmissions.studentId, studentIds),
    ));
    const latestSubmissionByStudent = new Map<number, (typeof submissions)[number]>();
    for (const row of submissions) {
      const current = latestSubmissionByStudent.get(row.submission.studentId);
      if (!current || row.reviewToken >= current.reviewToken) {
        latestSubmissionByStudent.set(row.submission.studentId, row);
      }
    }

    return eligibleRows.map((row) => {
      const reviewRow = latestSubmissionByStudent.get(row.studentId);
      const submission = reviewRow?.submission;
      return {
        ...row,
        submission: submission && reviewRow ? {
          id: submission.id,
          status: submission.status,
          submittedAt: submission.submittedAt,
          reviewToken: reviewRow.reviewToken,
          textAnswer: submission.textAnswer,
          reviewedAt: submission.reviewedAt,
          reviewedBy: submission.reviewedBy,
          teacherComment: submission.teacherComment,
          hasAttachment: Boolean(submission.fileUrl),
        } : null,
      };
    });
  }

  async updateHomework(
    id: number,
    schoolId: number,
    sessionId: number,
    teacherId: number,
    data: { content: string; subject: string; fileUrl: string | null; dueDate?: string | null },
  ): Promise<Homework | undefined> {
    const [updated] = await db.update(homework).set(data).where(and(
      eq(homework.id, id),
      eq(homework.schoolId, schoolId),
      eq(homework.sessionId, sessionId),
      eq(homework.teacherId, teacherId),
    )).returning();
    return updated;
  }

  async deleteHomework(id: number, schoolId: number, sessionId: number, teacherId: number): Promise<boolean> {
    const deleted = await db.delete(homework).where(and(
      eq(homework.id, id),
      eq(homework.schoolId, schoolId),
      eq(homework.sessionId, sessionId),
      eq(homework.teacherId, teacherId),
    )).returning({ id: homework.id });
    return deleted.length > 0;
  }

  async getHomeworkById(id: number): Promise<Homework | undefined> {
    const [hw] = await db.select().from(homework).where(eq(homework.id, id));
    return hw;
  }

  async recordHomeworkView(homeworkId: number, studentId: number): Promise<boolean> {
    const inserted = await db.insert(homeworkViews).values({ homeworkId, studentId })
      .onConflictDoNothing({
        target: [homeworkViews.homeworkId, homeworkViews.studentId],
      })
      .returning({ id: homeworkViews.id });
    return inserted.length > 0;
  }

  async getHomeworkViewedStudentIds(
    homeworkId: number,
    eligibleStudentIds?: readonly number[],
  ): Promise<number[]> {
    if (eligibleStudentIds && eligibleStudentIds.length === 0) return [];
    const conditions = [eq(homeworkViews.homeworkId, homeworkId)];
    if (eligibleStudentIds) {
      conditions.push(inArray(homeworkViews.studentId, [...new Set(eligibleStudentIds)]));
    }
    const rows = await db.select({ studentId: homeworkViews.studentId })
      .from(homeworkViews)
      .where(and(...conditions));
    return [...new Set(rows.map((row) => row.studentId))];
  }

  async getHomeworkViewCount(
    homeworkId: number,
    eligibleStudentIds?: readonly number[],
  ): Promise<number> {
    return (await this.getHomeworkViewedStudentIds(homeworkId, eligibleStudentIds)).length;
  }

  async getStudentHomework(schoolId: number, cls: string, section: string, studentId: number, date?: string, sessionId?: number | null) {
    return this.getStudentHomeworkWithDateMode(
      schoolId, cls, section, studentId, date, sessionId, "LEGACY_UTC_DATE",
    );
  }

  async getStudentHomeworkForWeb(schoolId: number, cls: string, section: string, studentId: number, date?: string, sessionId?: number | null) {
    return this.getStudentHomeworkWithDateMode(
      schoolId, cls, section, studentId, date, sessionId, "IST_BUSINESS_DATE",
    );
  }

  private async getStudentHomeworkWithDateMode(
    schoolId: number,
    cls: string,
    section: string,
    studentId: number,
    date: string | undefined,
    sessionId: number | null | undefined,
    dateMode: StudentWorkDateMode,
  ): Promise<{
    id: number; schoolId: number; teacherId: number; class: string; section: string;
    subject: string; content: string; fileUrl: string | null; dueDate: string | null;
    createdAt: Date; teacherName: string; submission: HomeworkSubmission | null;
  }[]> {
    if (typeof sessionId !== "number" || !Number.isSafeInteger(sessionId) || sessionId <= 0) {
      throw new Error("Student Homework requires a valid academic session");
    }
    const conditions: SQL<unknown>[] = [
      eq(homework.schoolId, schoolId),
      eq(homework.class, cls),
      eq(homework.section, section),
      eq(homework.sessionId, sessionId),
    ];
    if (date) {
      const createdAtDate = studentWorkCreatedAtDateSql(homework.createdAt, dateMode);
      conditions.push(or(
        sql`${createdAtDate} = ${date}::date`,
        eq(homework.dueDate, date),
      )!);
    }
    const rows = await db.select({
      id: homework.id,
      schoolId: homework.schoolId,
      teacherId: homework.teacherId,
      class: homework.class,
      section: homework.section,
      subject: homework.subject,
      content: homework.content,
      fileUrl: homework.fileUrl,
      dueDate: homework.dueDate,
      createdAt: homework.createdAt,
      teacherName: teachers.fullName,
    }).from(homework)
      .innerJoin(teachers, eq(homework.teacherId, teachers.id))
      .where(and(...conditions))
      .orderBy(desc(homework.createdAt));

    if (rows.length === 0) return [];
    const hwIds = rows.map(r => r.id);
    const subs = await db.select().from(homeworkSubmissions).where(
      and(eq(homeworkSubmissions.studentId, studentId), inArray(homeworkSubmissions.homeworkId, hwIds))
    );
    const subMap = new Map(subs.map(s => [s.homeworkId, s]));
    return rows.map(r => ({ ...r, submission: subMap.get(r.id) ?? null }));
  }

  async getStudentHomeworkPendingDates(schoolId: number, cls: string, section: string, studentId: number, month: string, sessionId?: number | null) {
    return this.getStudentHomeworkPendingDatesWithDateMode(
      schoolId, cls, section, studentId, month, sessionId, "LEGACY_UTC_DATE",
    );
  }

  async getStudentHomeworkPendingDatesForWeb(schoolId: number, cls: string, section: string, studentId: number, month: string, sessionId?: number | null) {
    return this.getStudentHomeworkPendingDatesWithDateMode(
      schoolId, cls, section, studentId, month, sessionId, "IST_BUSINESS_DATE",
    );
  }

  private async getStudentHomeworkPendingDatesWithDateMode(
    schoolId: number,
    cls: string,
    section: string,
    studentId: number,
    month: string,
    sessionId: number | null | undefined,
    dateMode: StudentWorkDateMode,
  ): Promise<string[]> {
    if (typeof sessionId !== "number" || !Number.isSafeInteger(sessionId) || sessionId <= 0) {
      throw new Error("Student Homework dates require a valid academic session");
    }
    // month = "YYYY-MM"
    const [yearStr, monStr] = month.split("-");
    const year = parseInt(yearStr);
    const mon  = parseInt(monStr);
    const startDate = `${month}-01`;
    const lastDay   = new Date(year, mon, 0).getDate();
    const endDate   = `${month}-${String(lastDay).padStart(2, "0")}`;

    const createdAtDate = studentWorkCreatedAtDateSql(homework.createdAt, dateMode);
    const dateConditions: SQL<unknown>[] = [
      eq(homework.schoolId, schoolId),
      eq(homework.class, cls),
      eq(homework.section, section),
      eq(homework.sessionId, sessionId),
      or(
        sql`${createdAtDate} BETWEEN ${startDate}::date AND ${endDate}::date`,
        sql`${homework.dueDate} BETWEEN ${startDate} AND ${endDate}`,
      )!,
    ];

    const rows = await db.select({
      createdAt: homework.createdAt,
      dueDate:   homework.dueDate,
      subStatus: homeworkSubmissions.status,
    }).from(homework)
      .leftJoin(homeworkSubmissions, and(
        eq(homeworkSubmissions.homeworkId, homework.id),
        eq(homeworkSubmissions.studentId, studentId),
      ))
      .where(and(...dateConditions));

    const pendingDates = new Set<string>();
    for (const row of rows) {
      const isPending = !row.subStatus || row.subStatus === "rejected";
      if (isPending) {
        const createdDate = dateOnlyInIST(row.createdAt);
        if (createdDate) pendingDates.add(createdDate);
        if (row.dueDate) pendingDates.add(row.dueDate);
      }
    }
    return Array.from(pendingDates);
  }

  async getStudentClasswork(schoolId: number, cls: string, section: string, date?: string, sessionId?: number | null) {
    return this.getStudentClassworkWithDateMode(
      schoolId, cls, section, date, sessionId, "LEGACY_UTC_DATE",
    );
  }

  async getStudentClassworkForWeb(schoolId: number, cls: string, section: string, date?: string, sessionId?: number | null) {
    return this.getStudentClassworkWithDateMode(
      schoolId, cls, section, date, sessionId, "IST_BUSINESS_DATE",
    );
  }

  private async getStudentClassworkWithDateMode(
    schoolId: number,
    cls: string,
    section: string,
    date: string | undefined,
    sessionId: number | null | undefined,
    dateMode: StudentWorkDateMode,
  ): Promise<{
    id: number; schoolId: number; teacherId: number; class: string; section: string;
    subject: string; content: string; fileUrl: string | null; createdAt: Date; teacherName: string;
  }[]> {
    if (typeof sessionId !== "number" || !Number.isSafeInteger(sessionId) || sessionId <= 0) {
      throw new Error("Student Classwork requires a valid academic session");
    }
    const conditions: SQL<unknown>[] = [
      eq(classwork.schoolId, schoolId),
      eq(classwork.class, cls),
      eq(classwork.section, section),
      eq(classwork.sessionId, sessionId),
    ];
    if (date) {
      const createdAtDate = studentWorkCreatedAtDateSql(classwork.createdAt, dateMode);
      conditions.push(sql`${createdAtDate} = ${date}::date`);
    }
    const rows = await db.select({
      id: classwork.id,
      schoolId: classwork.schoolId,
      teacherId: classwork.teacherId,
      class: classwork.class,
      section: classwork.section,
      subject: classwork.subject,
      content: classwork.content,
      fileUrl: classwork.fileUrl,
      createdAt: classwork.createdAt,
      teacherName: teachers.fullName,
    }).from(classwork)
      .innerJoin(teachers, eq(classwork.teacherId, teachers.id))
      .where(and(...conditions))
      .orderBy(desc(classwork.createdAt));
    return rows;
  }

  async getHomeworkSubmission(homeworkId: number, studentId: number): Promise<HomeworkSubmission | undefined> {
    const [sub] = await db.select().from(homeworkSubmissions).where(
      and(eq(homeworkSubmissions.homeworkId, homeworkId), eq(homeworkSubmissions.studentId, studentId))
    );
    return sub;
  }

  async getHomeworkSubmissionForReview(
    schoolId: number,
    homeworkId: number,
    submissionId: number,
  ): Promise<HomeworkSubmission | undefined> {
    const [submission] = await db.select().from(homeworkSubmissions).where(and(
      eq(homeworkSubmissions.id, submissionId),
      eq(homeworkSubmissions.homeworkId, homeworkId),
      eq(homeworkSubmissions.schoolId, schoolId),
    ));
    return submission;
  }

  async reviewHomeworkSubmission(data: {
    schoolId: number;
    homeworkId: number;
    submissionId: number;
    studentId: number;
    reviewerId: number;
    expectedSubmissionToken: string;
    action: HomeworkReviewAction;
    teacherComment: string | null;
  }): Promise<
    | { kind: "updated"; submission: HomeworkSubmission }
    | { kind: "not_found" }
    | { kind: "conflict" }
  > {
    return db.transaction(async (tx) => {
      // Student resubmission and Teacher review share this lock so a stale
      // review cannot approve or reject a newer answer.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${data.homeworkId}, ${data.studentId})`);
      const [currentRow] = await tx.select({
        submission: homeworkSubmissions,
        reviewToken: sql<string>`to_char(${homeworkSubmissions.submittedAt}, 'YYYY-MM-DD HH24:MI:SS.US')`,
      }).from(homeworkSubmissions).where(and(
        eq(homeworkSubmissions.id, data.submissionId),
        eq(homeworkSubmissions.homeworkId, data.homeworkId),
        eq(homeworkSubmissions.schoolId, data.schoolId),
        eq(homeworkSubmissions.studentId, data.studentId),
      )).limit(1).for("update");
      const current = currentRow?.submission;
      if (!current) return { kind: "not_found" as const };
      if (
        current.status !== "submitted"
        || currentRow.reviewToken !== data.expectedSubmissionToken
      ) {
        return { kind: "conflict" as const };
      }

      const [updated] = await tx.update(homeworkSubmissions).set({
        status: homeworkReviewStatusForAction(data.action),
        reviewedAt: new Date(),
        reviewedBy: data.reviewerId,
        teacherComment: data.teacherComment,
      }).where(and(
        eq(homeworkSubmissions.id, current.id),
        eq(homeworkSubmissions.status, "submitted"),
        sql`${homeworkSubmissions.submittedAt} = ${data.expectedSubmissionToken}::timestamp`,
      )).returning();
      if (!updated) return { kind: "conflict" as const };
      return { kind: "updated" as const, submission: updated };
    });
  }

  async getHomeworkSubmissionByFileUrl(fileUrl: string): Promise<{
    submission: HomeworkSubmission;
    homework: Homework;
  } | undefined> {
    const [row] = await db.select({
      submission: homeworkSubmissions,
      homework,
    }).from(homeworkSubmissions)
      .innerJoin(homework, eq(homeworkSubmissions.homeworkId, homework.id))
      .where(eq(homeworkSubmissions.fileUrl, fileUrl));
    return row;
  }

  async upsertMobileHomeworkSubmission(data: {
    homeworkId: number;
    studentId: number;
    schoolId: number;
    fileUrl?: string | null;
    textAnswer?: string | null;
  }): Promise<{ submission: HomeworkSubmission; replacedFileUrl: string | null }> {
    return db.transaction(async (tx) => {
      // Serialize mobile submissions for this student/homework pair. The guarded
      // update below also prevents a concurrent reviewer approval being reset.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${data.homeworkId}, ${data.studentId})`);
      const [authorizedHomework] = await tx.select({ id: homework.id })
        .from(homework)
        .where(and(
          eq(homework.id, data.homeworkId),
          eq(homework.schoolId, data.schoolId),
        ))
        .limit(1)
        .for("update");
      const [authorizedStudent] = await tx.select({
        id: students.id,
      }).from(students)
        .where(and(
          eq(students.id, data.studentId),
          eq(students.schoolId, data.schoolId),
          eq(students.isActive, true),
          eq(students.isActivated, true),
        ))
        .limit(1)
        .for("update");
      if (!authorizedHomework || !authorizedStudent) {
        throw new Error("HOMEWORK_SUBMISSION_NOT_AUTHORIZED");
      }
      const [existing] = await tx.select().from(homeworkSubmissions).where(and(
        eq(homeworkSubmissions.homeworkId, data.homeworkId),
        eq(homeworkSubmissions.studentId, data.studentId),
      ));
      if (existing?.status === "approved") {
        throw new Error("HOMEWORK_SUBMISSION_APPROVED");
      }
      if (existing) {
        const [updated] = await tx.update(homeworkSubmissions)
          .set({
            fileUrl: data.fileUrl !== undefined ? data.fileUrl : existing.fileUrl,
            textAnswer: data.textAnswer !== undefined ? data.textAnswer : existing.textAnswer,
            status: "submitted",
            submittedAt: new Date(),
          })
          .where(and(
            eq(homeworkSubmissions.id, existing.id),
            ne(homeworkSubmissions.status, "approved"),
          ))
          .returning();
        if (!updated) throw new Error("HOMEWORK_SUBMISSION_APPROVED");
        return { submission: updated, replacedFileUrl: existing.fileUrl };
      }
      const [created] = await tx.insert(homeworkSubmissions).values({
        homeworkId: data.homeworkId,
        studentId: data.studentId,
        schoolId: data.schoolId,
        fileUrl: data.fileUrl ?? null,
        textAnswer: data.textAnswer ?? null,
        status: "submitted",
      }).returning();
      return { submission: created, replacedFileUrl: null };
    });
  }

  async upsertHomeworkSubmission(data: { homeworkId: number; studentId: number; schoolId: number; fileUrl?: string | null; textAnswer?: string | null }): Promise<HomeworkSubmission> {
    return db.transaction(async (tx) => {
      // Serialize the first submit and every resubmission with Teacher review.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${data.homeworkId}, ${data.studentId})`);
      const [existing] = await tx.select().from(homeworkSubmissions).where(and(
        eq(homeworkSubmissions.homeworkId, data.homeworkId),
        eq(homeworkSubmissions.studentId, data.studentId),
        eq(homeworkSubmissions.schoolId, data.schoolId),
      )).orderBy(desc(homeworkSubmissions.submittedAt)).limit(1).for("update");
      if (existing?.status === "approved") {
        throw new Error("HOMEWORK_SUBMISSION_APPROVED");
      }
      if (existing) {
        const [updated] = await tx.update(homeworkSubmissions)
        .set({
          fileUrl: data.fileUrl !== undefined ? data.fileUrl : existing.fileUrl,
          textAnswer: data.textAnswer !== undefined ? data.textAnswer : existing.textAnswer,
          status: "submitted",
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedBy: null,
          teacherComment: null,
        })
        .where(and(
          eq(homeworkSubmissions.id, existing.id),
          ne(homeworkSubmissions.status, "approved"),
        ))
        .returning();
        if (!updated) throw new Error("HOMEWORK_SUBMISSION_APPROVED");
        return updated;
      }
      const [created] = await tx.insert(homeworkSubmissions).values({
        homeworkId: data.homeworkId,
        studentId: data.studentId,
        schoolId: data.schoolId,
        fileUrl: data.fileUrl ?? null,
        textAnswer: data.textAnswer ?? null,
        status: "submitted",
      }).returning();
      return created;
    });
  }

  async getStudentCountByClassSection(schoolId: number, cls: string, section: string): Promise<number> {
    const result = await db.select({ count: count() }).from(students).where(
      and(eq(students.schoolId, schoolId), eq(students.class, cls), eq(students.section, section))
    );
    return result[0]?.count || 0;
  }

  // ===== CLASSWORK METHODS =====
  async createClasswork(data: InsertClasswork): Promise<Classwork> {
    const [cw] = await db.insert(classwork).values(data).returning();
    return cw;
  }

  async getClassworkByClass(schoolId: number, cls: string, section: string, sessionId: number): Promise<Classwork[]> {
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      throw new Error("Classwork requires a valid academic session");
    }
    return await db.select().from(classwork).where(
      and(
        eq(classwork.schoolId, schoolId),
        eq(classwork.class, cls),
        eq(classwork.section, section),
        eq(classwork.sessionId, sessionId),
      )
    ).orderBy(desc(classwork.createdAt));
  }

  async getClassworkById(id: number): Promise<Classwork | undefined> {
    const [cw] = await db.select().from(classwork).where(eq(classwork.id, id));
    return cw;
  }

  async updateClasswork(
    id: number,
    schoolId: number,
    sessionId: number,
    teacherId: number,
    data: { content?: string; subject?: string; fileUrl?: string | null },
  ): Promise<Classwork | undefined> {
    const [cw] = await db.update(classwork).set(data).where(and(
      eq(classwork.id, id),
      eq(classwork.schoolId, schoolId),
      eq(classwork.sessionId, sessionId),
      eq(classwork.teacherId, teacherId),
    )).returning();
    return cw;
  }

  async deleteClasswork(id: number, schoolId: number, sessionId: number, teacherId: number): Promise<boolean> {
    const deleted = await db.delete(classwork).where(and(
      eq(classwork.id, id),
      eq(classwork.schoolId, schoolId),
      eq(classwork.sessionId, sessionId),
      eq(classwork.teacherId, teacherId),
    )).returning({ id: classwork.id });
    return deleted.length > 0;
  }

  // ===== NOTICE METHODS =====
  async createNotice(data: InsertNotice): Promise<Notice> {
    const [n] = await db.insert(notices).values(data).returning();
    return n;
  }

  async getAllSchoolNotices(schoolId: number, limit = 500, sessionId?: number | null): Promise<(Notice & { creatorName: string | null })[]> {
    const conditions: SQL[] = [eq(notices.schoolId, schoolId)];
    if (sessionId != null) conditions.push(eq(notices.sessionId, sessionId));
    const rows = await db
      .select({
        id: notices.id,
        schoolId: notices.schoolId,
        sessionId: notices.sessionId,
        createdById: notices.createdById,
        creatorRole: notices.creatorRole,
        targetType: notices.targetType,
        targetClass: notices.targetClass,
        targetSection: notices.targetSection,
        targetTeacherId: notices.targetTeacherId,
        noticeType: notices.noticeType,
        content: notices.content,
        fileUrl: notices.fileUrl,
        createdAt: notices.createdAt,
        creatorName: teachers.fullName,
      })
      .from(notices)
      .leftJoin(teachers, and(eq(notices.createdById, teachers.id), eq(notices.creatorRole, "teacher")))
      .where(and(...conditions))
      .orderBy(desc(notices.createdAt))
      .limit(limit);
    return rows;
  }

  async bulkDeleteNotices(schoolId: number, olderThanDays: number): Promise<number> {
    const conditions: any[] = [eq(notices.schoolId, schoolId)];
    if (olderThanDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);
      conditions.push(lt(notices.createdAt, cutoff));
    }
    const eligible = await db.select({ id: notices.id })
      .from(notices)
      .where(and(...conditions));
    if (eligible.length === 0) return 0;
    await db.delete(notices).where(inArray(notices.id, eligible.map(r => r.id)));
    return eligible.length;
  }

  async getNoticesByTeacher(teacherId: number, limit = 50): Promise<Notice[]> {
    return await db.select().from(notices)
      .where(and(eq(notices.createdById, teacherId), eq(notices.creatorRole, "teacher")))
      .orderBy(desc(notices.createdAt))
      .limit(limit);
  }

  async getTeacherNoticesForSession(
    schoolId: number,
    teacherId: number,
    sessionId: number,
    limit = 50,
  ): Promise<Notice[]> {
    return await db.select().from(notices)
      .where(and(
        eq(notices.schoolId, schoolId),
        eq(notices.sessionId, sessionId),
        eq(notices.createdById, teacherId),
        eq(notices.creatorRole, "teacher"),
      ))
      .orderBy(desc(notices.createdAt))
      .limit(limit);
  }

  async getNoticeById(id: number): Promise<Notice | null> {
    const [n] = await db.select().from(notices).where(eq(notices.id, id));
    return n ?? null;
  }

  async getNoticeByIdForSchool(id: number, schoolId: number): Promise<Notice | null> {
    const [n] = await db.select().from(notices)
      .where(and(eq(notices.id, id), eq(notices.schoolId, schoolId)));
    return n ?? null;
  }

  async deleteNotice(id: number, schoolId: number): Promise<void> {
    await db.delete(notices).where(and(eq(notices.id, id), eq(notices.schoolId, schoolId)));
  }

  async deleteTeacherNoticeForSession(
    id: number,
    schoolId: number,
    sessionId: number,
    teacherId: number,
  ): Promise<boolean> {
    const deleted = await db.delete(notices).where(and(
      eq(notices.id, id),
      eq(notices.schoolId, schoolId),
      eq(notices.sessionId, sessionId),
      eq(notices.createdById, teacherId),
      eq(notices.creatorRole, "teacher"),
    )).returning({ id: notices.id });
    return deleted.length > 0;
  }

  async updateNotice(id: number, schoolId: number, content: string): Promise<Notice | null> {
    const [n] = await db.update(notices).set({ content }).where(and(eq(notices.id, id), eq(notices.schoolId, schoolId))).returning();
    return n ?? null;
  }

  async updateTeacherNoticeForSession(
    id: number,
    schoolId: number,
    sessionId: number,
    teacherId: number,
    content: string,
  ): Promise<Notice | null> {
    const [n] = await db.update(notices).set({ content }).where(and(
      eq(notices.id, id),
      eq(notices.schoolId, schoolId),
      eq(notices.sessionId, sessionId),
      eq(notices.createdById, teacherId),
      eq(notices.creatorRole, "teacher"),
    )).returning();
    return n ?? null;
  }

  async getNoticesByTarget(schoolId: number, targetType: string, cls?: string, section?: string, sessionId?: number | null): Promise<Notice[]> {
    const typeFilter = targetType === "student"
      ? or(eq(notices.targetType, "student"), eq(notices.targetType, "whole_school"))!
      : eq(notices.targetType, targetType);
    const conditions: any[] = [eq(notices.schoolId, schoolId), typeFilter];
    if (cls) conditions.push(or(eq(notices.targetClass, cls), isNull(notices.targetClass))!);
    if (sessionId != null) conditions.push(eq(notices.sessionId, sessionId));
    return await db.select().from(notices).where(and(...conditions)).orderBy(desc(notices.createdAt));
  }

  async getTeacherByClassSection(schoolId: number, cls: string, section: string): Promise<Teacher | null> {
    const [teacher] = await db.select().from(teachers)
      .where(and(eq(teachers.schoolId, schoolId), eq(teachers.assignedClass, cls), eq(teachers.assignedSection, section)));
    return teacher || null;
  }

  /** Students can NEVER see these notices — the targetType:"teacher" filter in
   * getStudentNotices only fetches targetType "whole_school" / "student" / "class".
   */
  async getTeacherScopedNotices(schoolId: number, teacherId: number, sessionId?: number | null): Promise<Notice[]> {
    const [teacherRecord, mappings] = await Promise.all([
      this.getTeacherById(teacherId),
      this.getFacultyMappingsByTeacher(teacherId),
    ]);

    // Build the full set of class-section pairs this teacher covers
    const assignments: Array<{ className: string; section: string }> = [];

    // 1. Primary assignment stored directly on the teacher row
    if (teacherRecord?.assignedClass && teacherRecord?.assignedSection) {
      assignments.push({ className: teacherRecord.assignedClass, section: teacherRecord.assignedSection });
    }

    // 2. Faculty mapping rows (may include additional class-sections)
    for (const m of mappings) {
      const alreadyIn = assignments.some(
        a => a.className === m.className && a.section === m.section
      );
      if (!alreadyIn) assignments.push({ className: m.className, section: m.section });
    }

    // Fetch all teacher-type AND whole-school notices for this school in one query
    const noticeConditions: any[] = [
      eq(notices.schoolId, schoolId),
      or(
        eq(notices.targetType, "teacher"),
        eq(notices.targetType, "whole_school"),
      ),
    ];
    if (sessionId != null) noticeConditions.push(eq(notices.sessionId, sessionId));
    const allNotices = await db.select().from(notices)
      .where(and(...noticeConditions))
      .orderBy(desc(notices.createdAt));

    return allNotices.filter(notice => {
      // ── Strict pin: targetTeacherId set → only that exact teacher sees it ──
      if (notice.targetTeacherId !== null && notice.targetTeacherId !== undefined) {
        return notice.targetTeacherId === teacherId;
      }
      // ── Whole-school notices are visible to every teacher ──
      if (notice.targetType === "whole_school") return true;
      // ── Teacher broadcast with no class restriction → all teachers see it ──
      if (!notice.targetClass) return true;
      // ── Class-restricted teacher notice: match assignments ──
      if (assignments.length === 0) return false;
      return assignments.some(
        a => a.className === notice.targetClass &&
          (!notice.targetSection || a.section === notice.targetSection)
      );
    });
  }

  async getStudentNotices(studentId: number, schoolId: number, cls: string, section: string, sessionId: number): Promise<(Notice & { isRead: boolean; creatorName: string | null })[]> {
    const classMatch = or(
      isNull(notices.targetClass),
      eq(notices.targetClass, cls),
      sql`${cls} = ANY(string_to_array(${notices.targetClass}, ','))`
    )!;

    const noticeConditions: SQL<unknown>[] = [
      studentNoticeSessionScope(schoolId, sessionId),
      or(
        eq(notices.targetType, "whole_school"),
        and(eq(notices.targetType, "student"), classMatch)!,
        and(eq(notices.targetType, "class"), classMatch)!
      )! as SQL<unknown>,
    ];

    const rows = await db
      .select({
        id: notices.id,
        schoolId: notices.schoolId,
        sessionId: notices.sessionId,
        createdById: notices.createdById,
        creatorRole: notices.creatorRole,
        targetType: notices.targetType,
        targetClass: notices.targetClass,
        targetSection: notices.targetSection,
        targetTeacherId: notices.targetTeacherId,
        noticeType: notices.noticeType,
        content: notices.content,
        fileUrl: notices.fileUrl,
        createdAt: notices.createdAt,
        creatorName: teachers.fullName,
      })
      .from(notices)
      .leftJoin(teachers, and(eq(notices.createdById, teachers.id), eq(notices.creatorRole, "teacher")))
      .where(and(...noticeConditions))
      .orderBy(desc(notices.createdAt));

    if (rows.length === 0) return [];

    // Apply section filtering in application layer.
    const filtered = rows.filter(n => studentNoticeMatchesAudience(n, cls, section));

    if (filtered.length === 0) return [];

    const readRows = await db.select({ noticeId: noticeReads.noticeId })
      .from(noticeReads)
      .where(and(
        eq(noticeReads.studentId, studentId),
        inArray(noticeReads.noticeId, filtered.map(r => r.id))
      ));
    const readSet = new Set(readRows.map(r => r.noticeId));
    return filtered.map(n => ({ ...n, isRead: readSet.has(n.id) }));
  }

  async markNoticesRead(studentId: number, noticeIds: number[]): Promise<void> {
    if (noticeIds.length === 0) return;
    await pool.query(
      `INSERT INTO notice_reads (student_id, notice_id) SELECT $1, unnest($2::int[]) ON CONFLICT (student_id, notice_id) DO NOTHING`,
      [studentId, noticeIds]
    );
  }

  async getUnreadNoticeCount(studentId: number, schoolId: number, cls: string, section: string, sessionId: number): Promise<number> {
    const all = await this.getStudentNotices(studentId, schoolId, cls, section, sessionId);
    return countUnreadStudentNotices(all);
  }

  // ===== COMPLAINT METHODS =====
  async getNextTicketId(schoolId: number): Promise<string> {
    const now = new Date();
    const datePart = todayInIST(now).replace(/-/g, "");
    const prefix = `CMP-${datePart}-`;
    const result = await db.select({ ticketId: complaints.ticketId })
      .from(complaints)
      .where(and(eq(complaints.schoolId, schoolId), like(complaints.ticketId, `${prefix}%`)))
      .orderBy(desc(complaints.id))
      .limit(1);
    let seq = 1;
    if (result.length > 0) {
      const last = result[0].ticketId;
      const num = parseInt(last.split("-").pop() || "0");
      if (!isNaN(num)) seq = num + 1;
    }
    return `${prefix}${String(seq).padStart(6, "0")}`;
  }

  async createComplaint(data: InsertComplaint): Promise<Complaint> {
    requireTeacherComplaintSession(data.schoolId, data.sessionId);
    const [c] = await db.insert(complaints).values(data).returning();
    return c;
  }

  async createComplaintWithStudents(
    data: InsertComplaint,
    studentIds: number[]
  ): Promise<Complaint & { students: { id: number; name: string; class: string | null; section: string | null }[] }> {
    requireTeacherComplaintSession(data.schoolId, data.sessionId);
    const uniqueStudentIds = [...new Set(studentIds)];
    if (uniqueStudentIds.some((studentId) => !Number.isSafeInteger(studentId) || studentId <= 0)) {
      throw new Error("Complaint targets must be valid students in the selected academic session.");
    }
    const enrolledStudents = uniqueStudentIds.length > 0
      ? await this.getComplaintTargetsForSession(data.schoolId, data.sessionId, uniqueStudentIds)
      : [];
    if (enrolledStudents.length !== uniqueStudentIds.length) {
      throw new Error("Complaint targets must belong to the teacher's school and selected academic session.");
    }
    const [c] = await db.insert(complaints).values(data).returning();
    if (uniqueStudentIds.length > 0) {
      await db.insert(complaintStudents).values(
        uniqueStudentIds.map(sid => ({ complaintId: c.id, studentId: sid }))
      );
    }
    return {
      ...c,
      students: enrolledStudents.map((student) => ({
        id: student.id,
        name: student.name,
        class: student.class,
        section: student.section,
      })),
    };
  }

  async searchComplaintTargetsForSession(
    schoolId: number,
    sessionId: number,
    query: string,
    assignments: { className: string; section: string }[],
  ): Promise<{
    id: number;
    name: string;
    digitalStudentId: string;
    class: string;
    section: string;
    photoUrl: string | null;
  }[]> {
    requireTeacherComplaintSession(schoolId, sessionId);
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2 || assignments.length === 0) return [];
    const assignmentConditions = assignments.map((assignment) =>
      and(
        eq(enrollments.className, assignment.className),
        eq(enrollments.sectionName, assignment.section),
      )
    ) as SQL[];
    return await db.select({
      id: students.id,
      name: students.name,
      digitalStudentId: students.digitalStudentId,
      class: enrollments.className,
      section: enrollments.sectionName,
      photoUrl: students.photoUrl,
    }).from(enrollments)
      .innerJoin(students, and(
        eq(enrollments.studentId, students.id),
        eq(enrollments.schoolId, schoolId),
        eq(students.schoolId, schoolId),
      ))
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        or(...assignmentConditions),
        or(
          ilike(students.name, `%${normalizedQuery}%`),
          ilike(students.digitalStudentId, `%${normalizedQuery}%`),
        ),
      ))
      .limit(15);
  }

  async getComplaintTargetsForSession(schoolId: number, sessionId: number, studentIds: number[]): Promise<{
    id: number;
    name: string;
    digitalStudentId: string;
    class: string;
    section: string;
    photoUrl: string | null;
    schoolId: number;
    sessionId: number;
    studentId: number;
    className: string;
    sectionName: string;
  }[]> {
    requireTeacherComplaintSession(schoolId, sessionId);
    const uniqueStudentIds = [...new Set(studentIds)];
    if (uniqueStudentIds.length === 0) return [];
    if (uniqueStudentIds.some((studentId) => !Number.isSafeInteger(studentId) || studentId <= 0)) return [];
    return await db.select({
      id: students.id,
      name: students.name,
      digitalStudentId: students.digitalStudentId,
      class: enrollments.className,
      section: enrollments.sectionName,
      photoUrl: students.photoUrl,
      schoolId: enrollments.schoolId,
      sessionId: enrollments.sessionId,
      studentId: students.id,
      className: enrollments.className,
      sectionName: enrollments.sectionName,
    }).from(enrollments)
      .innerJoin(students, and(
        eq(enrollments.studentId, students.id),
        eq(enrollments.schoolId, schoolId),
        eq(students.schoolId, schoolId),
      ))
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        inArray(enrollments.studentId, uniqueStudentIds),
      ));
  }

  async getComplaintById(id: number): Promise<Complaint | undefined> {
    const [c] = await db.select().from(complaints).where(eq(complaints.id, id));
    return c;
  }

  async getComplaintByIdForSchool(id: number, schoolId: number): Promise<Complaint | undefined> {
    const [c] = await db.select().from(complaints).where(and(eq(complaints.id, id), eq(complaints.schoolId, schoolId)));
    return c;
  }

  async updateComplaint(
    id: number,
    schoolId: number,
    data: { content?: string; fileUrl?: string | null },
    sessionId?: number,
  ): Promise<Complaint> {
    const scope = sessionId === undefined
      ? and(eq(complaints.id, id), eq(complaints.schoolId, schoolId))
      : and(eq(complaints.id, id), teacherComplaintSessionScope(schoolId, sessionId));
    const [c] = await db.update(complaints).set(data).where(scope).returning();
    return c;
  }

  async softDeleteComplaint(id: number, schoolId: number, sessionId?: number): Promise<void> {
    const scope = sessionId === undefined
      ? and(eq(complaints.id, id), eq(complaints.schoolId, schoolId))
      : and(eq(complaints.id, id), teacherComplaintSessionScope(schoolId, sessionId));
    await db.update(complaints).set({ isDeleted: true }).where(scope);
  }

  async updateComplaintStatus(
    id: number,
    schoolId: number,
    status: string,
    resolutionRemarks?: string,
    sessionId?: number,
  ): Promise<Complaint> {
    const updateData: Record<string, unknown> = { status };
    if (resolutionRemarks !== undefined) updateData.resolutionRemarks = resolutionRemarks;
    if (status === "Resolved") updateData.resolvedAt = new Date();
    const scope = sessionId === undefined
      ? and(eq(complaints.id, id), eq(complaints.schoolId, schoolId))
      : and(eq(complaints.id, id), teacherComplaintSessionScope(schoolId, sessionId));
    const [c] = await db.update(complaints).set(updateData).where(scope).returning();
    return c;
  }

  async bulkDeleteComplaints(
    schoolId: number,
    olderThanDays: number,
    deletedByUserId: number,
    deletedByRole: string,
    deletedByName: string,
    complaintTypes?: string[],
  ): Promise<number> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(complaints.schoolId, schoolId),
      eq(complaints.status, "Resolved"),
      eq(complaints.isDeleted, false),
      isNull(complaints.deletedAt),
    ] as any[];
    if (olderThanDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);
      (conditions as any[]).push(lt(complaints.createdAt, cutoff));
    }
    if (complaintTypes && complaintTypes.length > 0) {
      (conditions as any[]).push(inArray(complaints.complaintType, complaintTypes));
    }
    const eligible = await db.select({ id: complaints.id })
      .from(complaints)
      .where(and(...(conditions as any[])));
    if (eligible.length === 0) return 0;
    const ids = eligible.map(r => r.id);
    await db.update(complaints)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: deletedByUserId })
      .where(inArray(complaints.id, ids));
    if (deletedByUserId > 0) {
      const typeDesc = complaintTypes?.length ? ` (types: ${complaintTypes.join(", ")})` : "";
      const ageDesc = olderThanDays === 0 ? "any age" : `older than ${olderThanDays} days`;
      await db.insert(auditLogs).values({
        schoolId, actionType: "bulk_delete", entityType: "complaint", entityId: schoolId,
        actionBy: deletedByUserId, actionByRole: deletedByRole,
        details: `${deletedByName} bulk-deleted ${ids.length} resolved complaint(s)${typeDesc} — ${ageDesc}`,
      });
    }
    return ids.length;
  }

  async getComplaintsBySchool(schoolId: number, sessionId?: number | null): Promise<(Complaint & {
    studentName: string | null;
    teacherName: string | null;
    teacherDtid: string | null;
    complainantName: string | null;
    complainantClass: string | null;
    complainantSection: string | null;
    complainantPhone: string | null;
    students: { id: number; name: string; class: string | null; section: string | null }[];
  })[]> {
    const complainantStudents = alias(students, "complainant_students");
    const result = await db.select({
      complaint: complaints,
      reportedStudent: { name: students.name },
      teacher: { fullName: teachers.fullName, digitalTeacherId: teachers.digitalTeacherId },
      complainant: {
        name: complainantStudents.name,
        class: complainantStudents.class,
        section: complainantStudents.section,
        phone: complainantStudents.phone,
      },
    })
      .from(complaints)
      .leftJoin(students, eq(complaints.studentId, students.id))
      .leftJoin(teachers, eq(complaints.teacherId, teachers.id))
      .leftJoin(complainantStudents, eq(complaints.complainantStudentId, complainantStudents.id))
      .where(and(
        eq(complaints.schoolId, schoolId),
        eq(complaints.isDeleted, false),
        ...(sessionId != null ? [eq(complaints.sessionId, sessionId)] : []),
      ))
      .orderBy(desc(complaints.createdAt));

    const complaintIds = result.map(r => r.complaint.id);
    const studentsByComplaint = new Map<number, { id: number; name: string; class: string | null; section: string | null }[]>();
    if (complaintIds.length > 0) {
      const csRows = await db.select({
        complaintId: complaintStudents.complaintId,
        id: students.id,
        name: students.name,
        cls: students.class,
        sec: students.section,
      })
        .from(complaintStudents)
        .innerJoin(students, eq(complaintStudents.studentId, students.id))
        .where(inArray(complaintStudents.complaintId, complaintIds));
      for (const row of csRows) {
        const list = studentsByComplaint.get(row.complaintId) ?? [];
        list.push({ id: row.id, name: row.name, class: row.cls, section: row.sec });
        studentsByComplaint.set(row.complaintId, list);
      }
    }

    return result.map(r => {
      const csStudents = studentsByComplaint.get(r.complaint.id) ?? [];
      const legacyStudent = r.reportedStudent?.name
        ? [{ id: r.complaint.studentId!, name: r.reportedStudent.name, class: null, section: null }]
        : [];
      return {
        ...r.complaint,
        teacherDtid: r.teacher?.digitalTeacherId ?? null,
        studentName: r.reportedStudent?.name ?? (csStudents[0]?.name ?? null),
        teacherName: r.teacher?.fullName ?? null,
        complainantName: r.complainant?.name ?? null,
        complainantClass: r.complaint.complainantClass ?? r.complainant?.class ?? null,
        complainantSection: r.complaint.complainantSection ?? r.complainant?.section ?? null,
        complainantPhone: r.complaint.contactNumber ?? r.complainant?.phone ?? null,
        students: csStudents.length > 0 ? csStudents : legacyStudent,
      };
    });
  }

  async getComplaintsByTeacher(
    teacherId: number,
    schoolId: number,
    sessionId: number,
    assignedClass?: string,
    assignedSection?: string,
  ): Promise<(Complaint & { studentName: string | null; students: { id: number; name: string; class: string | null; section: string | null }[] })[]> {
    requireTeacherComplaintSession(schoolId, sessionId);
    const STUDENT_FILED_TYPES = ["student-to-staff", "student-peer-report"];
    const ownWhereConditions: any[] = [
      eq(complaints.teacherId, teacherId),
      teacherComplaintSessionScope(schoolId, sessionId),
      sql`${complaints.complaintType} NOT IN ('student-to-staff', 'student-peer-report')`,
    ];
    const ownComplaints = await db.select().from(complaints)
      .leftJoin(students, and(
        eq(complaints.studentId, students.id),
        eq(students.schoolId, schoolId),
      ))
      .where(and(...ownWhereConditions))
      .orderBy(desc(complaints.createdAt));

    const ownResults = ownComplaints.map(r => ({
      ...r.complaints,
      studentName: r.students?.name || null,
    }));

    let allResults = ownResults;

    if (assignedClass && assignedSection) {
      const s2sConditions: any[] = [
        teacherComplaintSessionScope(schoolId, sessionId),
        eq(complaints.complaintType, "student-to-student"),
        sql`${complaints.teacherId} != ${teacherId}`,
        eq(enrollments.className, assignedClass),
        eq(enrollments.sectionName, assignedSection),
      ];
      const s2sFromOthers = await db.select().from(complaints)
        .innerJoin(students, and(
          eq(complaints.studentId, students.id),
          eq(students.schoolId, schoolId),
        ))
        .innerJoin(enrollments, and(
          eq(enrollments.studentId, students.id),
          eq(enrollments.schoolId, schoolId),
          eq(enrollments.sessionId, sessionId),
        ))
        .where(and(...s2sConditions))
        .orderBy(desc(complaints.createdAt));

      const s2sResults = s2sFromOthers.map(r => ({
        ...r.complaints,
        studentName: r.students?.name || null,
      }));

      const merged = [...ownResults, ...s2sResults];
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const seen = new Set<number>();
      allResults = merged.filter(c => {
        if (STUDENT_FILED_TYPES.includes(c.complaintType)) return false;
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    }

    // Fetch all students from junction table for these complaints
    const ids = allResults.map(c => c.id);
    const studentsByComplaint = new Map<number, { id: number; name: string; class: string | null; section: string | null }[]>();
    if (ids.length > 0) {
      const csRows = await db.select({
        complaintId: complaintStudents.complaintId,
        id: students.id,
        name: students.name,
        cls: enrollments.className,
        sec: enrollments.sectionName,
      })
        .from(complaintStudents)
        .innerJoin(students, and(
          eq(complaintStudents.studentId, students.id),
          eq(students.schoolId, schoolId),
        ))
        .leftJoin(enrollments, and(
          eq(enrollments.studentId, students.id),
          eq(enrollments.schoolId, schoolId),
          eq(enrollments.sessionId, sessionId),
        ))
        .where(inArray(complaintStudents.complaintId, ids));
      for (const row of csRows) {
        const list = studentsByComplaint.get(row.complaintId) ?? [];
        list.push({ id: row.id, name: row.name, class: row.cls, section: row.sec });
        studentsByComplaint.set(row.complaintId, list);
      }
    }

    return allResults.map(c => {
      const csStudents = studentsByComplaint.get(c.id) ?? [];
      const legacyList = c.studentName ? [{ id: c.studentId ?? 0, name: c.studentName, class: null, section: null }] : [];
      return {
        ...c,
        students: csStudents.length > 0 ? csStudents : legacyList,
      };
    });
  }

  async getStudentInboxComplaints(studentId: number, schoolId: number, sessionId: number): Promise<(Complaint & { teacherName: string; students: { id: number; name: string; class: string | null; section: string | null }[]; batchPeers: { name: string; class: string | null; section: string | null }[] })[]> {
    // Find complaint IDs via junction table (new-style multi-student complaints)
    const junctionRows = await db.select({ complaintId: complaintStudents.complaintId })
      .from(complaintStudents)
      .where(eq(complaintStudents.studentId, studentId));
    const junctionIds = junctionRows.map(r => r.complaintId);

    // Build WHERE: match either legacy complaints.studentId OR junction table
    const baseConditions: SQL<unknown>[] = [
      studentComplaintSessionScope(schoolId, sessionId),
      eq(complaints.complaintType, "teacher-to-student"),
      eq(complaints.isDeleted, false),
    ];

    const studentMatch = junctionIds.length > 0
      ? or(eq(complaints.studentId, studentId), inArray(complaints.id, junctionIds))!
      : eq(complaints.studentId, studentId);

    const result = await db.select().from(complaints)
      .innerJoin(teachers, and(eq(complaints.teacherId, teachers.id), eq(teachers.schoolId, schoolId)))
      .where(and(...baseConditions, studentMatch))
      .orderBy(desc(complaints.createdAt));

    // For each complaint, get all involved students from junction table
    const complaintIds = result.map(r => r.complaints.id);
    const studentsByComplaint = new Map<number, { id: number; name: string; class: string | null; section: string | null }[]>();
    if (complaintIds.length > 0) {
      const csRows = await db.select({
        complaintId: complaintStudents.complaintId,
        id: students.id,
        name: students.name,
        cls: students.class,
        sec: students.section,
      })
        .from(complaintStudents)
        .innerJoin(students, and(eq(complaintStudents.studentId, students.id), eq(students.schoolId, schoolId)))
        .where(inArray(complaintStudents.complaintId, complaintIds));
      for (const row of csRows) {
        const list = studentsByComplaint.get(row.complaintId) ?? [];
        list.push({ id: row.id, name: row.name, class: row.cls, section: row.sec });
        studentsByComplaint.set(row.complaintId, list);
      }
    }

    // For legacy batchId support, fetch sibling students by batchId
    const batchIds = result.map(r => r.complaints.batchId).filter((b): b is string => !!b);
    const batchPeerMap = new Map<string, { name: string; class: string | null; section: string | null }[]>();
    if (batchIds.length > 0) {
      const uniqueBatchIds = [...new Set(batchIds)];
      const siblings = await db.select({
        batchId: complaints.batchId,
        studentId: complaints.studentId,
        name: students.name,
        class: students.class,
        section: students.section,
      })
        .from(complaints)
        .leftJoin(students, and(eq(complaints.studentId, students.id), eq(students.schoolId, schoolId)))
        .where(and(inArray(complaints.batchId, uniqueBatchIds), studentComplaintSessionScope(schoolId, sessionId), eq(complaints.isDeleted, false)));
      for (const s of siblings) {
        if (!s.batchId || s.studentId === studentId) continue;
        const list = batchPeerMap.get(s.batchId) ?? [];
        list.push({ name: s.name ?? "Unknown", class: s.class ?? null, section: s.section ?? null });
        batchPeerMap.set(s.batchId, list);
      }
    }

    return result.map(r => {
      const csStudents = studentsByComplaint.get(r.complaints.id) ?? [];
      // For legacy single-student complaints (not in junction table), build from legacy fields
      const legacyStudent = r.complaints.studentId && csStudents.length === 0
        ? [{ id: r.complaints.studentId, name: "Student", class: null, section: null }]
        : [];
      const allStudents = csStudents.length > 0 ? csStudents : legacyStudent;
      const batchPeers = r.complaints.batchId ? (batchPeerMap.get(r.complaints.batchId) ?? []) : [];
      return {
        ...r.complaints,
        teacherName: r.teachers.fullName,
        students: allStudents,
        batchPeers,
      };
    });
  }

  async getStudentFiledComplaints(complainantStudentId: number, schoolId: number, sessionId: number): Promise<(Complaint & { teacherName: string | null })[]> {
    const conditions: SQL<unknown>[] = [
      eq(complaints.complainantStudentId, complainantStudentId),
      studentComplaintSessionScope(schoolId, sessionId),
      eq(complaints.isDeleted, false),
      sql`${complaints.complaintType} IN ('student-to-staff', 'student-peer-report')`,
    ];
    const result = await db.select().from(complaints)
      .leftJoin(teachers, and(eq(complaints.teacherId, teachers.id), eq(teachers.schoolId, schoolId)))
      .where(and(...conditions))
      .orderBy(desc(complaints.createdAt));
    return result.map(r => ({ ...r.complaints, teacherName: r.teachers?.fullName || null }));
  }

  async createStudentComplaint(data: InsertComplaint): Promise<Complaint> {
    requireStudentComplaintSession(data.sessionId);
    const [c] = await db.insert(complaints).values(data).returning();
    return c;
  }

  async getClassFeedComplaints(
    schoolId: number,
    sessionId: number,
    mappings: { className: string; section: string }[],
    filterClass?: string,
    filterSection?: string,
  ): Promise<(Complaint & { complainantStudentName: string | null })[]> {
    requireTeacherComplaintSession(schoolId, sessionId);
    // Narrow mappings to the selected filter (if any)
    const activeMappings = filterClass
      ? mappings.filter(m =>
          m.className === filterClass &&
          (!filterSection || filterSection === "all" || m.section === filterSection)
        )
      : mappings;

    if (activeMappings.length === 0) return [];

    // Step 1: find IDs of TARGET students across all active class-section pairs
    const classSectionConditions = activeMappings.map(m =>
      and(eq(enrollments.className, m.className), eq(enrollments.sectionName, m.section))
    ) as SQL[];

    const enrolled = await db.select({ studentId: enrollments.studentId })
      .from(enrollments)
      .innerJoin(students, and(
        eq(enrollments.studentId, students.id),
        eq(enrollments.schoolId, schoolId),
        eq(students.schoolId, schoolId),
      ))
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        or(...classSectionConditions),
      ));
    const targetIds = enrolled.map((student) => student.studentId);
    if (targetIds.length === 0) return [];

    // Step 2: fetch peer-reports where studentId (the TARGET) is in those IDs
    const feedConditions = [
      eq(complaints.schoolId, schoolId),
      eq(complaints.sessionId, sessionId),
      eq(complaints.complaintType, "student-peer-report"),
      inArray(complaints.studentId, targetIds),
      eq(complaints.isDeleted, false),
    ] as SQL[];

    const result = await db.select({
      complaint: complaints,
      complainantStudentName: students.name,
      complainantPhotoUrl: students.photoUrl,
      complainantClass: enrollments.className,
      complainantSection: enrollments.sectionName,
    }).from(complaints)
      .leftJoin(students, and(
        eq(complaints.complainantStudentId, students.id),
        eq(students.schoolId, schoolId),
      ))
      .leftJoin(enrollments, and(
        eq(enrollments.studentId, complaints.complainantStudentId),
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
      ))
      .where(and(...feedConditions))
      .orderBy(desc(complaints.createdAt));
    return result.map(r => ({
      ...r.complaint,
      complainantStudentName: r.complainantClass ? r.complainantStudentName || null : null,
      complainantPhotoUrl: r.complainantClass ? r.complainantPhotoUrl ?? null : null,
      complainantClass: r.complainantClass ?? null,
      complainantSection: r.complainantSection ?? null,
    }));
  }

  async resolveComplaint(id: number, schoolId: number, remarks: string | null, sessionId?: number): Promise<Complaint | null> {
    const scope = sessionId === undefined
      ? and(eq(complaints.id, id), eq(complaints.schoolId, schoolId))
      : and(eq(complaints.id, id), teacherComplaintSessionScope(schoolId, sessionId));
    const [c] = await db.update(complaints)
      .set({ status: "Resolved", ...(remarks != null ? { resolutionRemarks: remarks } : {}) })
      .where(scope)
      .returning();
    return c || null;
  }

  async escalateComplaint(id: number, schoolId: number, sessionId?: number): Promise<Complaint | null> {
    const scope = sessionId === undefined
      ? and(eq(complaints.id, id), eq(complaints.schoolId, schoolId))
      : and(eq(complaints.id, id), teacherComplaintSessionScope(schoolId, sessionId));
    const [c] = await db.update(complaints)
      .set({ escalatedToPrincipal: true, status: "Escalated" })
      .where(scope)
      .returning();
    return c || null;
  }

  async updateTeacherProfilePicture(teacherId: number, profileImageUrl: string): Promise<void> {
    await db.update(teachers).set({ profileImageUrl }).where(eq(teachers.id, teacherId));
  }

  async updateSchoolLogo(schoolId: number, logoUrl: string): Promise<void> {
    await db.update(schools).set({ logoUrl, logoUpdatedAt: new Date() }).where(eq(schools.id, schoolId));
  }

  async clearSchoolLogo(schoolId: number): Promise<void> {
    await db.update(schools).set({ logoUrl: null, logoUpdatedAt: new Date() }).where(eq(schools.id, schoolId));
  }

  async updateSchoolInfo(schoolId: number, data: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    pinCode?: string | null;
    country?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    board?: string | null;
    schoolType?: string | null;
    affiliationNumber?: string | null;
    udiseCode?: string | null;
    establishedYear?: number | null;
    registrationNumber?: string | null;
    pan?: string | null;
    gstin?: string | null;
  }): Promise<void> {
    await db.update(schools).set(data).where(eq(schools.id, schoolId));
  }

  async addComplaintNote(data: InsertComplaintNote): Promise<ComplaintNote> {
    const [n] = await db.insert(complaintNotes).values(data).returning();
    return n;
  }

  async getComplaintNotes(complaintId: number): Promise<ComplaintNote[]> {
    return await db.select().from(complaintNotes)
      .where(eq(complaintNotes.complaintId, complaintId))
      .orderBy(complaintNotes.createdAt);
  }

  // ===== EXAM SCORE METHODS =====
  async upsertExamScores(scores: Array<InsertExamScore & { sessionId: number }>): Promise<ExamScore[]> {
    if (!scores.length) return [];
    if (scores.some(score => !score.class?.trim() || !score.section?.trim())) {
      throw new Error("Class and section are required to save examination scores.");
    }
    return db.transaction(async (tx) => {
      const cohortKeys = [...new Set(scores.map(score =>
        JSON.stringify([score.schoolId, score.sessionId, score.class, score.section]),
      ))].sort();
      for (const key of cohortKeys) {
        const [schoolId, sessionId, cls, section] = JSON.parse(key) as [number, number, string, string];
        await lockPromotionCohort(tx, schoolId, sessionId, cls, section);
      }

      const results: ExamScore[] = [];
      for (const score of scores) {
        const conditions: SQL<unknown>[] = [
          eq(examScores.studentId, score.studentId),
          eq(examScores.schoolId, score.schoolId),
          eq(examScores.subject, score.subject),
          eq(examScores.examType, score.examType),
          eq(examScores.sessionId, score.sessionId),
          eq(examScores.class, score.class!),
          eq(examScores.section, score.section!),
        ];
        const existing = await tx.select().from(examScores).where(and(...conditions)).for("update");
        if (existing.length > 0) {
          const [updated] = await tx.update(examScores)
            .set({
              marks: score.marks,
              totalMarks: score.totalMarks,
              passMarks: score.passMarks ?? 33,
              isAbsent: score.isAbsent,
              class: score.class,
              section: score.section,
              updatedBy: score.updatedBy ?? null,
              updatedAt: new Date(),
              sessionId: score.sessionId,
            })
            .where(eq(examScores.id, existing[0].id)).returning();
          results.push(updated);
        } else {
          const [created] = await tx.insert(examScores).values({
            ...score,
            updatedBy: score.updatedBy ?? null,
            updatedAt: new Date(),
          }).returning();
          results.push(created);
        }
      }
      return results;
    });
  }

  async publishExamScores(schoolId: number, cls: string, section: string, examType: string, sessionId?: number): Promise<number> {
    // When a sessionId is supplied, publish only records for that academic year.
    const conditions = [
      eq(examScores.schoolId, schoolId),
      eq(examScores.class, cls),
      eq(examScores.section, section),
      eq(examScores.examType, examType),
      ...(sessionId != null ? [eq(examScores.sessionId, sessionId)] : []),
    ];
    const updated = await db.update(examScores)
      .set({ published: true })
      .where(and(...conditions))
      .returning();
    return updated.length;
  }

  async getExamScores(schoolId: number, subject: string, examType: string, cls: string, section: string, sessionId?: number): Promise<(ExamScore & { studentName: string; dsid: string })[]> {
    const result = await db.select().from(examScores)
      .innerJoin(students, eq(examScores.studentId, students.id))
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.subject, subject),
        eq(examScores.examType, examType),
        eq(students.class, cls),
        eq(students.section, section),
        ...(sessionId != null ? [eq(examScores.sessionId, sessionId)] : []),
      ));
    return result.map(r => ({
      ...r.exam_scores,
      studentName: r.students.name,
      dsid: r.students.digitalStudentId,
      photoUrl: r.students.photoUrl ?? null,
    }));
  }

  /**
   * Teacher Examination score read. A result must match both the saved score
   * cohort and the student's enrollment in the selected session; permanent
   * student identity is joined only inside the authenticated school.
   */
  async getTeacherExamScoresForSession(
    schoolId: number,
    subject: string,
    examType: string,
    cls: string,
    section: string,
    sessionId: number,
  ): Promise<(ExamScore & { studentName: string; dsid: string })[]> {
    const result = await db.select().from(examScores)
      .innerJoin(enrollments, and(
        eq(enrollments.studentId, examScores.studentId),
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.className, cls),
        eq(enrollments.sectionName, section),
      ))
      .innerJoin(students, and(
        eq(examScores.studentId, students.id),
        eq(students.schoolId, schoolId),
      ))
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.sessionId, sessionId),
        eq(examScores.subject, subject),
        eq(examScores.examType, examType),
        eq(examScores.class, cls),
        eq(examScores.section, section),
      ));
    return result.map(r => ({
      ...r.exam_scores,
      studentName: r.students.name,
      dsid: r.students.digitalStudentId,
      photoUrl: r.students.photoUrl ?? null,
    }));
  }

  async getExamScoresByStudent(studentId: number, schoolId: number, sessionId?: number | null): Promise<ExamScore[]> {
    const conditions = [eq(examScores.studentId, studentId), eq(examScores.schoolId, schoolId), ...(sessionId != null ? [eq(examScores.sessionId, sessionId)] : [])];
    return await db.select().from(examScores).where(and(...conditions)).orderBy(examScores.examType);
  }

  async getTeacherExamScoresByStudentInClassSession(
    studentId: number,
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
  ): Promise<ExamScore[]> {
    const rows = await db.select().from(examScores)
      .innerJoin(enrollments, and(
        eq(enrollments.studentId, examScores.studentId),
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.className, cls),
        eq(enrollments.sectionName, section),
      ))
      .where(and(
        eq(examScores.studentId, studentId),
        eq(examScores.schoolId, schoolId),
        eq(examScores.sessionId, sessionId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
      ))
      .orderBy(examScores.examType);
    return rows.map(row => row.exam_scores);
  }

  async getStudentDistinctClasses(schoolId: number, studentId: number, sessionId: number, cls: string, section: string): Promise<string[]> {
    const rows = await db.selectDistinct({ class: examScores.class })
      .from(examScores)
      .where(studentPublishedScoreScope(schoolId, studentId, sessionId, cls, section))
      .orderBy(sql`${examScores.class} ASC NULLS LAST`);
    return rows.map(r => r.class).filter((c): c is string => c !== null);
  }

  // Student-only types from published results in the selected enrollment cohort.
  async getStudentExamTypesForStudent(schoolId: number, studentId: number, cls: string, sessionId: number, section: string): Promise<string[]> {
    const rows = await db.select({
      examType: examScores.examType,
      minId: sql<number>`MIN(${examScores.id})`,
    })
      .from(examScores)
      .where(studentPublishedScoreScope(schoolId, studentId, sessionId, cls, section))
      .groupBy(examScores.examType)
      .orderBy(sql`MIN(${examScores.id}) ASC`);
    return rows.map(r => r.examType);
  }

  // Legacy class+section variant kept for non-student uses
  async getStudentExamTypes(schoolId: number, cls: string, section: string): Promise<string[]> {
    const rows = await db.select({
      examType: examScores.examType,
      minId: sql<number>`MIN(${examScores.id})`,
    })
      .from(examScores)
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
        eq(examScores.published, true),
      ))
      .groupBy(examScores.examType)
      .orderBy(sql`MIN(${examScores.id}) ASC`);
    return rows.map(r => r.examType);
  }

  // Student-only score fetch; drafts remain visible to Teacher/Admin readers.
  async getStudentExamScores(schoolId: number, studentId: number, cls: string, examType: string, sessionId: number, section: string): Promise<ExamScore[]> {
    return await db.select().from(examScores).where(and(
      studentPublishedScoreScope(schoolId, studentId, sessionId, cls, section),
      eq(examScores.examType, examType),
    )).orderBy(examScores.subject);
  }

  // Student-only history; never broaden a missing session into an unscoped read.
  async getStudentAllExamScores(schoolId: number, studentId: number, cls: string, sessionId: number, section: string): Promise<ExamScore[]> {
    return await db.select().from(examScores)
      .where(studentPublishedScoreScope(schoolId, studentId, sessionId, cls, section))
      .orderBy(examScores.subject, examScores.examType);
  }

  async getClassRank(schoolId: number, cls: string, section: string, examType: string, studentId: number, sessionId: number): Promise<{ rank: number; total: number }> {
    const allScores = await db.select().from(examScores)
      .where(studentPublishedRankScope(schoolId, sessionId, cls, section, examType));

    const byStudent: Record<number, { obtained: number; total: number }> = {};
    for (const s of allScores) {
      if (!byStudent[s.studentId]) byStudent[s.studentId] = { obtained: 0, total: 0 };
      if (!s.isAbsent) byStudent[s.studentId].obtained += s.marks;
      byStudent[s.studentId].total += s.totalMarks;
    }

    const studentPcts = Object.entries(byStudent).map(([sid, d]) => ({
      studentId: parseInt(sid),
      pct: d.total > 0 ? (d.obtained / d.total) * 100 : 0,
    })).sort((a, b) => b.pct - a.pct);

    const rank = studentPcts.findIndex(s => s.studentId === studentId) + 1;
    return { rank: rank || studentPcts.length, total: studentPcts.length };
  }

  async getClassAverages(schoolId: number, cls: string, section: string, subject: string, sessionId?: number | null): Promise<{ examType: string; avgPercentage: number }[]> {
    const studentList = await this.getStudentsByClassSection(schoolId, cls, section);
    const studentIds = studentList.map(s => s.id);
    if (studentIds.length === 0) return [];

    const scoreConditions = [eq(examScores.schoolId, schoolId), eq(examScores.subject, subject), eq(examScores.isAbsent, false)];
    if (sessionId != null) scoreConditions.push(eq(examScores.sessionId, sessionId));
    const allScores = await db.select().from(examScores).where(and(...scoreConditions));

    const filtered = allScores.filter(s => studentIds.includes(s.studentId));
    const grouped: Record<string, { total: number; count: number }> = {};
    for (const s of filtered) {
      if (!grouped[s.examType]) grouped[s.examType] = { total: 0, count: 0 };
      grouped[s.examType].total += Math.round((s.marks / s.totalMarks) * 100);
      grouped[s.examType].count++;
    }

    return Object.entries(grouped).map(([examType, data]) => ({
      examType,
      avgPercentage: Math.round(data.total / data.count),
    }));
  }

  /** Session-pinned Teacher class averages based on persisted cohort snapshots. */
  async getTeacherClassAveragesForSession(
    schoolId: number,
    cls: string,
    section: string,
    subject: string,
    sessionId: number,
  ): Promise<{ examType: string; avgPercentage: number }[]> {
    const scoreRows = await db.select({ score: examScores }).from(examScores)
      .innerJoin(enrollments, and(
        eq(enrollments.studentId, examScores.studentId),
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.className, cls),
        eq(enrollments.sectionName, section),
      ))
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.sessionId, sessionId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
        eq(examScores.subject, subject),
        eq(examScores.isAbsent, false),
      ));
    const grouped: Record<string, { total: number; count: number }> = {};
    for (const { score } of scoreRows) {
      if (!grouped[score.examType]) grouped[score.examType] = { total: 0, count: 0 };
      grouped[score.examType].total += Math.round((score.marks / score.totalMarks) * 100);
      grouped[score.examType].count++;
    }
    return Object.entries(grouped).map(([examType, data]) => ({
      examType,
      avgPercentage: Math.round(data.total / data.count),
    }));
  }

  // ===== GALLERY METHODS =====
  async createGalleryItem(data: InsertGalleryItem): Promise<GalleryItem> {
    const [item] = await db.insert(galleryItems).values(data).returning();
    return item;
  }

  async getGalleryItems(schoolId: number, approvedOnly: boolean = true): Promise<GalleryItem[]> {
    const conditions = [eq(galleryItems.schoolId, schoolId)];
    if (approvedOnly) conditions.push(eq(galleryItems.approved, true));
    return await db.select().from(galleryItems).where(and(...conditions)).orderBy(desc(galleryItems.createdAt));
  }

  async getGalleryItemById(id: number): Promise<GalleryItem | null> {
    const [item] = await db.select().from(galleryItems).where(eq(galleryItems.id, id));
    return item || null;
  }

  async approveGalleryItem(id: number): Promise<GalleryItem> {
    const [item] = await db.update(galleryItems).set({ approved: true }).where(eq(galleryItems.id, id)).returning();
    return item;
  }

  async getAdminGalleryItems(schoolId: number): Promise<Array<GalleryItem & { teacherName: string | null }>> {
    const rows = await db
      .select({
        id: galleryItems.id,
        schoolId: galleryItems.schoolId,
        uploadedById: galleryItems.uploadedById,
        uploaderRole: galleryItems.uploaderRole,
        title: galleryItems.title,
        description: galleryItems.description,
        eventTag: galleryItems.eventTag,
        capturedDate: galleryItems.capturedDate,
        capturedTime: galleryItems.capturedTime,
        location: galleryItems.location,
        imageUrl: galleryItems.imageUrl,
        approved: galleryItems.approved,
        createdAt: galleryItems.createdAt,
        teacherName: teachers.fullName,
      })
      .from(galleryItems)
      .leftJoin(teachers, and(
        eq(galleryItems.uploadedById, teachers.id),
        eq(galleryItems.uploaderRole, "teacher"),
      ))
      .where(eq(galleryItems.schoolId, schoolId))
      .orderBy(desc(galleryItems.createdAt));
    return await Promise.all(rows.map(async row => {
      if (row.uploaderRole !== "support_staff") return row as GalleryItem & { teacherName: string | null };
      const staff = await this.getNonTeachingStaffById(row.uploadedById);
      return {
        ...row,
        teacherName: staff?.schoolId === schoolId ? staff.fullName : null,
      } as GalleryItem & { teacherName: string | null };
    }));
  }

  async deleteGalleryItem(id: number, schoolId: number): Promise<void> {
    await db.delete(galleryItems).where(and(eq(galleryItems.id, id), eq(galleryItems.schoolId, schoolId)));
  }

  async deleteGalleryItems(ids: number[], schoolId: number): Promise<void> {
    if (ids.length === 0) return;
    await db.delete(galleryItems).where(and(inArray(galleryItems.id, ids), eq(galleryItems.schoolId, schoolId)));
  }

  async getApprovedGalleryItems(schoolId: number, tag?: string): Promise<GalleryItem[]> {
    const conditions = [eq(galleryItems.schoolId, schoolId), eq(galleryItems.approved, true)];
    if (tag) conditions.push(eq(galleryItems.eventTag, tag));
    return await db.select().from(galleryItems).where(and(...conditions)).orderBy(desc(galleryItems.createdAt));
  }

  async getGalleryTagsBySchool(schoolId: number): Promise<string[]> {
    const rows = await db.selectDistinct({ eventTag: galleryItems.eventTag })
      .from(galleryItems)
      .where(and(eq(galleryItems.schoolId, schoolId), eq(galleryItems.approved, true)));
    return rows.map(r => r.eventTag).filter((t): t is string => t !== null && t !== "");
  }

  async getFacultyBySchool(schoolId: number): Promise<{
    id: number; fullName: string; subject: string; designation: string | null;
    qualifications: string | null; department: string | null; profileImageUrl: string | null;
  }[]> {
    const rows = await db.select({
      id: teachers.id,
      fullName: teachers.fullName,
      subject: teachers.subject,
      designation: teachers.designation,
      qualifications: teachers.qualifications,
      department: teachers.department,
      profileImageUrl: teachers.profileImageUrl,
    }).from(teachers).where(eq(teachers.schoolId, schoolId)).orderBy(teachers.fullName);
    return rows;
  }

  async getFacultyBySchoolWithMappings(schoolId: number): Promise<{
    id: number; fullName: string; subject: string; phone: string;
    assignedClass: string; assignedSection: string;
    designation: string | null; qualifications: string | null;
    department: string | null; profileImageUrl: string | null;
    digitalTeacherId: string | null;
    mappings: { className: string; section: string; subject: string | null }[];
  }[]> {
    const teacherRows = await db.select({
      id: teachers.id,
      fullName: teachers.fullName,
      subject: teachers.subject,
      phone: teachers.phone,
      assignedClass: teachers.assignedClass,
      assignedSection: teachers.assignedSection,
      designation: teachers.designation,
      qualifications: teachers.qualifications,
      department: teachers.department,
      profileImageUrl: teachers.profileImageUrl,
      digitalTeacherId: teachers.digitalTeacherId,
    }).from(teachers).where(eq(teachers.schoolId, schoolId)).orderBy(teachers.fullName);

    const mappingRows = await db.select({
      teacherId: facultyMappings.teacherId,
      className: facultyMappings.className,
      section: facultyMappings.section,
      subject: facultyMappings.subject,
    }).from(facultyMappings)
      .where(eq(facultyMappings.schoolId, schoolId))
      .orderBy(facultyMappings.className, facultyMappings.section);

    const byTeacher = new Map<number, { className: string; section: string; subject: string | null }[]>();
    for (const m of mappingRows) {
      if (!byTeacher.has(m.teacherId)) byTeacher.set(m.teacherId, []);
      byTeacher.get(m.teacherId)!.push({ className: m.className, section: m.section, subject: m.subject });
    }

    return teacherRows.map(t => ({ ...t, mappings: byTeacher.get(t.id) ?? [] }));
  }

  async getFacultyByClassSection(schoolId: number, className: string, section: string): Promise<{
    id: number; fullName: string; subject: string; designation: string | null;
    qualifications: string | null; department: string | null; profileImageUrl: string | null;
    mappedSubject: string | null;
  }[]> {
    const rows = await db.select({
      id: teachers.id,
      fullName: teachers.fullName,
      subject: teachers.subject,
      designation: teachers.designation,
      qualifications: teachers.qualifications,
      department: teachers.department,
      profileImageUrl: teachers.profileImageUrl,
      mappedSubject: facultyMappings.subject,
    }).from(facultyMappings)
      .innerJoin(teachers, eq(facultyMappings.teacherId, teachers.id))
      .where(and(
        eq(facultyMappings.schoolId, schoolId),
        eq(facultyMappings.className, className),
        eq(facultyMappings.section, section),
      ))
      .orderBy(teachers.fullName);
    return rows;
  }

  // ===== CALENDAR METHODS =====
  async createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent> {
    const [event] = await db.insert(calendarEvents).values(data).returning();
    return event;
  }

  async createCalendarEvents(data: InsertCalendarEvent[]): Promise<CalendarEvent[]> {
    if (data.length === 0) return [];
    return await db.insert(calendarEvents).values(data).returning();
  }

  async getCalendarEvents(schoolId: number, filter?: Array<{ cls: string; sec?: string }>): Promise<CalendarEvent[]> {
    const conditions: SQL[] = [eq(calendarEvents.schoolId, schoolId)];
    const audienceFilter = buildCalendarAudienceFilter(filter);
    if (audienceFilter) conditions.push(audienceFilter);
    return await db.select().from(calendarEvents).where(and(...conditions));
  }

  async getCalendarEventsByRange(schoolId: number, startDate: string, endDate: string, filter?: Array<{ cls: string; sec?: string }>): Promise<CalendarEvent[]> {
    const conditions: SQL[] = [
      eq(calendarEvents.schoolId, schoolId),
      gte(calendarEvents.date, startDate),
      lte(calendarEvents.date, endDate),
    ];
    const audienceFilter = buildCalendarAudienceFilter(filter);
    if (audienceFilter) conditions.push(audienceFilter);
    return await db.select().from(calendarEvents).where(and(...conditions));
  }

  async getHolidayOnDate(schoolId: number, date: string): Promise<CalendarEvent | null> {
    const [event] = await db.select().from(calendarEvents).where(
      and(
        eq(calendarEvents.schoolId, schoolId),
        eq(calendarEvents.date, date),
        eq(calendarEvents.eventType, "holiday"),
        eq(calendarEvents.audienceScope, "All_School"),
      )
    );
    return event || null;
  }

  async deleteCalendarEvent(id: number): Promise<boolean> {
    const result = await db.delete(calendarEvents).where(eq(calendarEvents.id, id)).returning();
    return result.length > 0;
  }

  async updateCalendarEvent(id: number, schoolId: number, data: {
    title?: string;
    date?: string;
    eventType?: string;
    venue?: string | null;
    description?: string | null;
    colorCode?: string | null;
    isRecurring?: boolean;
    audienceScope?: string;
    targetClass?: string | null;
    targetSection?: string | null;
  }): Promise<CalendarEvent | null> {
    const [updated] = await db.update(calendarEvents)
      .set(data)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.schoolId, schoolId)))
      .returning();
    return updated || null;
  }

  async deleteCalendarEventBySchool(id: number, schoolId: number): Promise<boolean> {
    const result = await db.delete(calendarEvents).where(
      and(eq(calendarEvents.id, id), eq(calendarEvents.schoolId, schoolId))
    ).returning();
    return result.length > 0;
  }

  async deleteGoogleSyncedCalendarEvents(schoolId: number): Promise<number> {
    const result = await db.delete(calendarEvents).where(
      and(eq(calendarEvents.schoolId, schoolId), eq(calendarEvents.venue, "gcal-sync"))
    ).returning();
    return result.length;
  }

  async setSchoolMetadataRaw(schoolId: number, metaKey: string, value: unknown): Promise<void> {
    const metaValue = JSON.stringify(value);
    await db.transaction(async tx => {
      await lockPromotionConfiguration(tx, schoolId);
      const existing = await tx.select().from(schoolMetadata)
        .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, metaKey)))
        .for("update");
      if (existing.length > 0) {
        await tx.update(schoolMetadata)
          .set({ metaValue, updatedAt: new Date() })
          .where(eq(schoolMetadata.id, existing[0].id));
      } else {
        await tx.insert(schoolMetadata).values({ schoolId, metaKey, metaValue });
      }
    });
  }

  async getSchoolMetadataRaw(schoolId: number, metaKey: string): Promise<unknown> {
    const [row] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, metaKey)));
    if (!row) return null;
    try { return JSON.parse(row.metaValue); } catch { return null; }
  }

  async getSchoolsWithGoogleAutoSync(): Promise<Array<{ schoolId: number; calendarId: string; apiKey: string }>> {
    const autoSyncRows = await db.select().from(schoolMetadata)
      .where(eq(schoolMetadata.metaKey, "google_calendar_auto_sync"));
    const enabledIds = autoSyncRows
      .filter(r => { try { return JSON.parse(r.metaValue) === true; } catch { return false; } })
      .map(r => r.schoolId);
    if (enabledIds.length === 0) return [];
    const configRows = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.metaKey, "google_calendar_config"), inArray(schoolMetadata.schoolId, enabledIds)));
    const results: Array<{ schoolId: number; calendarId: string; apiKey: string }> = [];
    for (const row of configRows) {
      try {
        const cfg = JSON.parse(row.metaValue) as any;
        if (cfg?.calendarId && cfg?.apiKey) results.push({ schoolId: row.schoolId, calendarId: cfg.calendarId, apiKey: cfg.apiKey });
      } catch {}
    }
    return results;
  }

  // ===== LIBRARY METHODS =====
  async createLibraryBook(data: InsertLibraryBook): Promise<LibraryBook> {
    const [book] = await db.insert(libraryBooks).values(data).returning();
    return book;
  }

  async getLibraryBooks(schoolId: number): Promise<LibraryBook[]> {
    return await db.select().from(libraryBooks).where(eq(libraryBooks.schoolId, schoolId));
  }

  async getMyUploadedEbooks(teacherId: number, schoolId: number): Promise<(LibraryBook & { uploaderName: string | null })[]> {
    const [books, teacherRow] = await Promise.all([
      db.select().from(libraryBooks).where(and(eq(libraryBooks.schoolId, schoolId), eq(libraryBooks.uploadedById, teacherId))),
      db.select().from(teachers).where(eq(teachers.id, teacherId)),
    ]);
    const uploaderName = teacherRow[0]?.fullName ?? null;
    return books.map(b => ({ ...b, uploaderName }));
  }

  async getLibraryBooksWithUploaderNames(schoolId: number): Promise<(LibraryBook & { uploaderName: string | null })[]> {
    const [books, schoolTeachers] = await Promise.all([
      db.select().from(libraryBooks).where(eq(libraryBooks.schoolId, schoolId)),
      db.select().from(teachers).where(eq(teachers.schoolId, schoolId)),
    ]);
    const teacherMap = new Map(schoolTeachers.map(t => [t.id, t.fullName]));
    return books.map(b => ({ ...b, uploaderName: b.uploadedById ? (teacherMap.get(b.uploadedById) ?? null) : null }));
  }

  async searchLibraryBooks(schoolId: number, query: string): Promise<LibraryBook[]> {
    return await db.select().from(libraryBooks).where(
      and(eq(libraryBooks.schoolId, schoolId), or(ilike(libraryBooks.title, `%${query}%`), ilike(libraryBooks.author, `%${query}%`)))
    );
  }

  async borrowBook(bookId: number, borrowerId: number, borrowerType: string, schoolId: number): Promise<BookBorrow | null> {
    const [book] = await db.select().from(libraryBooks).where(eq(libraryBooks.id, bookId));
    if (!book || book.availableCopies <= 0) return null;
    await db.update(libraryBooks).set({ availableCopies: book.availableCopies - 1 }).where(eq(libraryBooks.id, bookId));
    const [borrow] = await db.insert(bookBorrows).values({ bookId, borrowerId, borrowerType, schoolId }).returning();
    return borrow;
  }

  async returnBook(borrowId: number): Promise<void> {
    const [borrow] = await db.select().from(bookBorrows).where(eq(bookBorrows.id, borrowId));
    if (!borrow || borrow.returnedAt) return;
    await db.update(bookBorrows).set({ returnedAt: new Date() }).where(eq(bookBorrows.id, borrowId));
    const [book] = await db.select().from(libraryBooks).where(eq(libraryBooks.id, borrow.bookId));
    if (book) {
      await db.update(libraryBooks).set({ availableCopies: book.availableCopies + 1 }).where(eq(libraryBooks.id, book.id));
    }
  }

  async getMyBorrowedBooks(borrowerId: number, borrowerType: string): Promise<(BookBorrow & { bookTitle: string; bookAuthor: string })[]> {
    const result = await db.select().from(bookBorrows)
      .innerJoin(libraryBooks, eq(bookBorrows.bookId, libraryBooks.id))
      .where(and(eq(bookBorrows.borrowerId, borrowerId), eq(bookBorrows.borrowerType, borrowerType), isNull(bookBorrows.returnedAt)));
    return result.map(r => ({
      ...r.book_borrows,
      bookTitle: r.library_books.title,
      bookAuthor: r.library_books.author,
    }));
  }

  // ===== LEAVE METHODS =====
  async createLeaveRequest(data: InsertLeaveRequest): Promise<LeaveRequest> {
    const [req] = await db.insert(leaveRequests).values(data).returning();
    return req;
  }

  async getLeaveRequestsByTeacher(
    teacherId: number,
    schoolId: number,
    sessionId: number,
  ): Promise<LeaveRequest[]> {
    return await db.select().from(leaveRequests).where(and(
      eq(leaveRequests.teacherId, teacherId),
      eq(leaveRequests.schoolId, schoolId),
      eq(leaveRequests.sessionId, sessionId),
    )).orderBy(desc(leaveRequests.createdAt));
  }

  async getLeaveRequestById(id: number): Promise<LeaveRequest | null> {
    const [req] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
    return req || null;
  }

  async getLeaveRequestsBySchool(schoolId: number, sessionId?: number | null): Promise<(LeaveRequest & { teacherName: string; teacherDtid: string | null })[]> {
    const conditions: any[] = [eq(leaveRequests.schoolId, schoolId)];
    if (sessionId != null) conditions.push(eq(leaveRequests.sessionId, sessionId));
    const result = await db.select().from(leaveRequests)
      .innerJoin(teachers, eq(leaveRequests.teacherId, teachers.id))
      .where(and(...conditions))
      .orderBy(desc(leaveRequests.createdAt));
    return result.map(r => ({ ...r.leave_requests, teacherName: r.teachers.fullName, teacherDtid: r.teachers.digitalTeacherId ?? null }));
  }

  async updateLeaveStatus(id: number, status: string): Promise<LeaveRequest> {
    const [req] = await db.update(leaveRequests).set({ status }).where(eq(leaveRequests.id, id)).returning();
    return req;
  }

  // ===== TIMETABLE METHODS =====
  private async requireTimetableSession(schoolId: number, sessionId: number, writable = false): Promise<void> {
    if (!Number.isInteger(schoolId) || schoolId <= 0 || !Number.isInteger(sessionId) || sessionId <= 0) {
      throw new Error("A valid school and academic session are required for Timetable");
    }
    const [session] = await db.select({ isActive: academicSessions.isActive })
      .from(academicSessions)
      .where(and(eq(academicSessions.id, sessionId), eq(academicSessions.schoolId, schoolId)));
    if (!session) throw new Error("Academic session does not belong to this school");
    if (writable && !session.isActive) throw new Error("Archived academic sessions are read-only");
  }

  async createTimetableEntry(data: InsertTimetableEntry): Promise<TimetableEntry> {
    await this.requireTimetableSession(data.schoolId, data.sessionId, true);
    const [teacher] = await db.select({ id: teachers.id }).from(teachers)
      .where(and(eq(teachers.id, data.teacherId), eq(teachers.schoolId, data.schoolId)));
    if (!teacher) throw new Error("Teacher does not belong to this school");
    const [entry] = await db.insert(timetableEntries).values(data).returning();
    return entry;
  }

  async getTimetableByTeacher(schoolId: number, sessionId: number, teacherId: number): Promise<TimetableEntry[]> {
    await this.requireTimetableSession(schoolId, sessionId);
    return await db.select().from(timetableEntries).where(and(
      eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId),
      eq(timetableEntries.teacherId, teacherId),
    ));
  }

  async getTimetableBySchool(schoolId: number, sessionId: number): Promise<(TimetableEntry & { teacherName: string })[]> {
    await this.requireTimetableSession(schoolId, sessionId);
    const result = await db.select().from(timetableEntries)
      .leftJoin(teachers, eq(timetableEntries.teacherId, teachers.id))
      .where(and(eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId)));
    return result.map(r => ({ ...r.timetable_entries, teacherName: r.teachers?.fullName ?? "" }));
  }

  async deleteTimetableEntry(id: number, schoolId: number, sessionId: number): Promise<boolean> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const result = await db.delete(timetableEntries).where(and(
      eq(timetableEntries.id, id), eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId),
    )).returning();
    return result.length > 0;
  }

  async getTimetableEntryById(id: number, schoolId: number, sessionId: number): Promise<TimetableEntry | null> {
    await this.requireTimetableSession(schoolId, sessionId);
    const [entry] = await db.select().from(timetableEntries).where(and(
      eq(timetableEntries.id, id), eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId),
    ));
    return entry || null;
  }

  async updateTimetableEntry(
    id: number,
    schoolId: number,
    sessionId: number,
    data: Partial<Pick<TimetableEntry, "dayOfWeek" | "period" | "class" | "section" | "subject" | "room" | "startTime" | "endTime" | "status">>
  ): Promise<TimetableEntry | null> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const updateData: Record<string, unknown> = { ...data };
    const [entry] = await db.update(timetableEntries)
      .set(updateData)
      .where(and(eq(timetableEntries.id, id), eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId)))
      .returning();
    return entry || null;
  }

  async updateTimetableEntryStatus(schoolId: number, sessionId: number, cls: string, section: string, status: string): Promise<number> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    // When publishing, only promote draft entries (not already-published ones)
    const whereConditions = and(
      eq(timetableEntries.schoolId, schoolId),
      eq(timetableEntries.sessionId, sessionId),
      eq(timetableEntries.class, cls),
      eq(timetableEntries.section, section),
      status === "published" ? eq(timetableEntries.status, "draft") : undefined,
    );
    const result = await db.update(timetableEntries)
      .set({ status })
      .where(whereConditions)
      .returning();
    return result.length;
  }

  async getClassSectionStatus(schoolId: number, sessionId: number): Promise<{ class: string; section: string; totalCount: number; draftCount: number; publishedCount: number }[]> {
    await this.requireTimetableSession(schoolId, sessionId);
    const entries = await db.select().from(timetableEntries).where(and(eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId)));
    const map: Record<string, { class: string; section: string; totalCount: number; draftCount: number; publishedCount: number }> = {};
    for (const e of entries) {
      const key = `${e.class}-${e.section}`;
      if (!map[key]) map[key] = { class: e.class, section: e.section, totalCount: 0, draftCount: 0, publishedCount: 0 };
      map[key].totalCount++;
      if (e.status === "published") map[key].publishedCount++;
      else map[key].draftCount++;
    }
    return Object.values(map).sort((a, b) => a.class.localeCompare(b.class, undefined, { numeric: true }) || a.section.localeCompare(b.section));
  }

  async validateTimetableEntry(opts: {
    schoolId: number;
    sessionId: number;
    teacherId: number;
    dayOfWeek: number;
    period: number;
    class: string;
    section: string;
    subject: string;
    room?: string | null;
    excludeId?: number;
    requireAllocation?: boolean; // When true: teacher must have an allocation for (subject, class, section)
  }): Promise<{ valid: boolean; error?: string }> {
    const { schoolId, sessionId, teacherId, dayOfWeek, period, excludeId } = opts;
    await this.requireTimetableSession(schoolId, sessionId, true);
    const [teacher] = await db.select({ id: teachers.id }).from(teachers)
      .where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)));
    if (!teacher) return { valid: false, error: "Teacher does not belong to this school" };

    // 1. Allocation boundary check (for teacher self-management)
    if (opts.requireAllocation) {
      const alloc = await db.select().from(teacherAllocations).where(
        and(
          eq(teacherAllocations.schoolId, schoolId),
          eq(teacherAllocations.teacherId, teacherId),
          eq(teacherAllocations.class, opts.class),
          eq(teacherAllocations.section, opts.section),
          eq(teacherAllocations.subject, opts.subject),
        )
      );
      if (alloc.length === 0) {
        return { valid: false, error: `Not allowed: No allocation found for ${opts.subject} in Class ${opts.class}-${opts.section}. Contact your admin.` };
      }
    }

    const existing = await db.select().from(timetableEntries).where(
      and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.sessionId, sessionId),
        eq(timetableEntries.dayOfWeek, dayOfWeek),
        eq(timetableEntries.period, period),
      )
    );

    const others = existing.filter(e => e.id !== (excludeId ?? -1));

    // 2. Teacher conflict (same teacher, same slot)
    const teacherConflict = others.find(e => e.teacherId === teacherId);
    if (teacherConflict) {
      return { valid: false, error: `Conflict: You are already teaching Class ${teacherConflict.class}-${teacherConflict.section} at this time.` };
    }

    // 3. Class conflict (same class+section already has a slot)
    const classConflict = others.find(e => e.class === opts.class && e.section === opts.section);
    if (classConflict) {
      return { valid: false, error: `Conflict: Class ${opts.class}-${opts.section} already has ${classConflict.subject} in this slot.` };
    }

    // 4. Room conflict
    if (opts.room) {
      const roomConflict = others.find(e => e.room && e.room.toLowerCase() === opts.room!.toLowerCase());
      if (roomConflict) {
        return { valid: false, error: `Conflict: Room "${opts.room}" is already occupied by Class ${roomConflict.class}-${roomConflict.section} (${roomConflict.subject}).` };
      }
    }

    // 5. Weekly quota: subject-specific (matches exact allocation row)
    const specificAlloc = await db.select().from(teacherAllocations).where(
      and(
        eq(teacherAllocations.schoolId, schoolId),
        eq(teacherAllocations.teacherId, teacherId),
        eq(teacherAllocations.class, opts.class),
        eq(teacherAllocations.section, opts.section),
        eq(teacherAllocations.subject, opts.subject),
      )
    );

    if (specificAlloc.length > 0) {
      const weeklyQuota = specificAlloc[0].weeklyQuota;
      const weeklyEntries = await db.select().from(timetableEntries).where(
        and(
          eq(timetableEntries.schoolId, schoolId),
          eq(timetableEntries.sessionId, sessionId),
          eq(timetableEntries.teacherId, teacherId),
          eq(timetableEntries.class, opts.class),
          eq(timetableEntries.section, opts.section),
          eq(timetableEntries.subject, opts.subject),
        )
      );
      const currentCount = weeklyEntries.filter(e => e.id !== (excludeId ?? -1)).length;
      if (currentCount >= weeklyQuota) {
        return { valid: false, error: `Quota exceeded: You are limited to ${weeklyQuota} ${opts.subject} periods/week for Class ${opts.class}-${opts.section}.` };
      }
    }

    return { valid: true };
  }

  async getTimetableByClassSection(schoolId: number, sessionId: number, cls: string, section: string): Promise<(TimetableEntry & { teacherName: string })[]> {
    await this.requireTimetableSession(schoolId, sessionId);
    const result = await db.select().from(timetableEntries)
      .leftJoin(teachers, eq(timetableEntries.teacherId, teachers.id))
      .where(studentTimetableScope(schoolId, sessionId, cls, section));
    return result.map(r => ({ ...r.timetable_entries, teacherName: r.teachers?.fullName ?? "" }));
  }

  async upsertTimetableSlot(
    schoolId: number,
    sessionId: number,
    opts: { dayOfWeek: number; period: number; class: string; section: string; teacherId: number; subject: string }
  ): Promise<TimetableEntry> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const [teacher] = await db.select({ id: teachers.id }).from(teachers)
      .where(and(eq(teachers.id, opts.teacherId), eq(teachers.schoolId, schoolId)));
    if (!teacher) throw new Error("Teacher does not belong to this school");
    // Use ON CONFLICT DO UPDATE so the insert is atomic against the unique index
    // timetable_class_slot_unique (school_id, session_id, class, section, day_of_week, period)
    const [result] = await db.insert(timetableEntries).values({
      schoolId,
      sessionId,
      teacherId: opts.teacherId,
      dayOfWeek: opts.dayOfWeek,
      period: opts.period,
      class: opts.class,
      section: opts.section,
      subject: opts.subject,
      status: "draft",
    })
    .onConflictDoUpdate({
      target: [
        timetableEntries.schoolId,
        timetableEntries.sessionId,
        timetableEntries.class,
        timetableEntries.section,
        timetableEntries.dayOfWeek,
        timetableEntries.period,
      ],
      set: {
        teacherId: opts.teacherId,
        subject: opts.subject,
        status: "draft",
      },
    })
    .returning();
    return result;
  }

  async deleteTimetableSlot(schoolId: number, sessionId: number, cls: string, section: string, dayOfWeek: number, period: number): Promise<boolean> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const result = await db.delete(timetableEntries).where(
      and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.sessionId, sessionId),
        eq(timetableEntries.class, cls),
        eq(timetableEntries.section, section),
        eq(timetableEntries.dayOfWeek, dayOfWeek),
        eq(timetableEntries.period, period),
      )
    ).returning();
    return result.length > 0;
  }

  async checkSlotOccupancy(schoolId: number, sessionId: number, cls: string, section: string, dayOfWeek: number, period: number, excludeTeacherId?: number): Promise<{ occupied: boolean; teacherName: string; teacherId: number; subject: string } | null> {
    await this.requireTimetableSession(schoolId, sessionId);
    const rows = await db.select().from(timetableEntries)
      .innerJoin(teachers, eq(timetableEntries.teacherId, teachers.id))
      .where(and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.sessionId, sessionId),
        eq(timetableEntries.class, cls),
        eq(timetableEntries.section, section),
        eq(timetableEntries.dayOfWeek, dayOfWeek),
        eq(timetableEntries.period, period),
      ));
    if (rows.length === 0) return null;
    const row = rows[0];
    if (excludeTeacherId !== undefined && row.timetable_entries.teacherId === excludeTeacherId) return null;
    return {
      occupied: true,
      teacherName: row.teachers.fullName,
      teacherId: row.timetable_entries.teacherId,
      subject: row.timetable_entries.subject,
    };
  }

  async upsertTeacherTimetableSlot(
    schoolId: number,
    sessionId: number,
    teacherId: number,
    opts: { dayOfWeek: number; period: number; class: string; section: string; subject: string; room?: string | null },
  ): Promise<TimetableEntry> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const [teacher] = await db.select({ id: teachers.id }).from(teachers)
      .where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)));
    if (!teacher) throw new Error("Teacher does not belong to this school");
    const conditions: any[] = [
      eq(timetableEntries.schoolId, schoolId),
      eq(timetableEntries.sessionId, sessionId),
      eq(timetableEntries.teacherId, teacherId),
      eq(timetableEntries.dayOfWeek, opts.dayOfWeek),
      eq(timetableEntries.period, opts.period),
    ];
    const existing = await db.select().from(timetableEntries).where(and(...conditions));
    if (existing.length > 0) {
      const [updated] = await db.update(timetableEntries)
        .set({ class: opts.class, section: opts.section, subject: opts.subject, room: opts.room ?? null, status: "draft" })
        .where(and(eq(timetableEntries.id, existing[0].id), eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId)))
        .returning();
      return updated;
    }
    const [created] = await db.insert(timetableEntries).values({
      schoolId,
      teacherId,
      dayOfWeek: opts.dayOfWeek,
      period: opts.period,
      class: opts.class,
      section: opts.section,
      subject: opts.subject,
      room: opts.room ?? null,
      status: "draft",
      sessionId,
    }).returning();
    return created;
  }

  async deleteTeacherTimetableSlot(schoolId: number, sessionId: number, teacherId: number, dayOfWeek: number, period: number): Promise<boolean> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const result = await db.delete(timetableEntries).where(
      and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.sessionId, sessionId),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.dayOfWeek, dayOfWeek),
        eq(timetableEntries.period, period),
      )
    ).returning();
    return result.length > 0;
  }

  // ===== TEACHER ALLOCATION METHODS =====
  async createTeacherAllocation(data: InsertTeacherAllocation): Promise<TeacherAllocation> {
    const [alloc] = await db.insert(teacherAllocations).values(data).returning();
    return alloc;
  }

  async getTeacherAllocationsBySchool(schoolId: number): Promise<(TeacherAllocation & { teacherName: string })[]> {
    const result = await db.select().from(teacherAllocations)
      .innerJoin(teachers, eq(teacherAllocations.teacherId, teachers.id))
      .where(eq(teacherAllocations.schoolId, schoolId));
    return result.map(r => ({ ...r.teacher_allocations, teacherName: r.teachers.fullName }));
  }

  async getTeacherAllocationsByTeacher(teacherId: number, schoolId: number): Promise<TeacherAllocation[]> {
    return await db.select().from(teacherAllocations).where(
      and(eq(teacherAllocations.teacherId, teacherId), eq(teacherAllocations.schoolId, schoolId))
    );
  }

  async deleteTeacherAllocation(id: number, schoolId: number): Promise<boolean> {
    const result = await db.delete(teacherAllocations).where(
      and(eq(teacherAllocations.id, id), eq(teacherAllocations.schoolId, schoolId))
    ).returning();
    return result.length > 0;
  }

  async deleteLibraryBook(id: number): Promise<boolean> {
    const result = await db.delete(libraryBooks).where(eq(libraryBooks.id, id)).returning();
    return result.length > 0;
  }

  async findTeacherByEmailAndPhone(email: string, phone: string): Promise<{ teacher: Teacher; user: User } | null> {
    const result = await db.select().from(users)
      .innerJoin(teachers, eq(users.id, teachers.userId))
      .where(and(eq(users.email, email), eq(teachers.phone, phone), eq(users.role, "teacher")));
    if (result.length === 0) return null;
    return { teacher: result[0].teachers, user: result[0].users };
  }

  async getTeacherUserByEmailAndSchool(email: string, schoolId: number): Promise<{ teacher: Teacher; user: User } | null> {
    const result = await db.select().from(users)
      .innerJoin(teachers, eq(users.id, teachers.userId))
      .where(and(
        eq(users.email, email),
        eq(users.schoolId, schoolId),
        eq(users.role, "teacher"),
        eq(users.isActive, true),
        eq(teachers.schoolId, schoolId),
      ))
      .limit(2);
    if (result.length === 0) return null;
    if (result.length > 1) {
      throw new Error("Ambiguous teacher account for school");
    }
    return { teacher: result[0].teachers, user: result[0].users };
  }

  async setTeacherOtp(teacherId: number, otpCode: string, expiresAt: Date): Promise<void> {
    await db.update(teachers).set({ otpCode, otpExpiresAt: expiresAt }).where(eq(teachers.id, teacherId));
  }

  async verifyTeacherOtp(teacherId: number, otpCode: string): Promise<{ teacher: Teacher; user: User } | null> {
    const result = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(and(eq(teachers.id, teacherId), eq(teachers.otpCode, otpCode)));
    if (result.length === 0) return null;
    const teacher = result[0].teachers;
    if (!teacher.otpExpiresAt || new Date() > teacher.otpExpiresAt) return null;
    return { teacher, user: result[0].users };
  }

  async clearTeacherOtp(teacherId: number): Promise<void> {
    await db.update(teachers).set({ otpCode: null, otpExpiresAt: null }).where(eq(teachers.id, teacherId));
  }

  async setTeacherResetToken(teacherId: number, resetToken: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.update(teachers).set({ resetToken, resetTokenExpiresAt: expiresAt }).where(eq(teachers.id, teacherId));
  }

  async verifyTeacherResetToken(teacherId: number, resetToken: string): Promise<{ teacher: Teacher; user: User } | null> {
    const result = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(and(eq(teachers.id, teacherId), eq(teachers.resetToken, resetToken)));
    if (result.length === 0) return null;
    const teacher = result[0].teachers;
    if (!teacher.resetTokenExpiresAt || new Date() > teacher.resetTokenExpiresAt) return null;
    return { teacher, user: result[0].users };
  }

  async clearTeacherResetToken(teacherId: number): Promise<void> {
    await db.update(teachers).set({ resetToken: null, resetTokenExpiresAt: null }).where(eq(teachers.id, teacherId));
  }

  // ===== SCHOOL METADATA METHODS =====
  async getSchoolMetadata(schoolId: number, metaKey: string): Promise<string[]> {
    const [row] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, metaKey)));
    if (!row) return [];
    try { return JSON.parse(row.metaValue); } catch { return []; }
  }

  async setSchoolMetadata(schoolId: number, metaKey: string, values: string[]): Promise<SchoolMetadata> {
    const metaValue = JSON.stringify(values);
    return db.transaction(async tx => {
      await lockPromotionConfiguration(tx, schoolId);
      const existing = await tx.select().from(schoolMetadata)
        .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, metaKey)))
        .for("update");
      if (existing.length > 0) {
        const [updated] = await tx.update(schoolMetadata)
          .set({ metaValue, updatedAt: new Date() })
          .where(eq(schoolMetadata.id, existing[0].id)).returning();
        return updated;
      }
      const [created] = await tx.insert(schoolMetadata)
        .values({ schoolId, metaKey, metaValue }).returning();
      return created;
    });
  }

  async getAllSchoolMetadata(schoolId: number): Promise<Record<string, string[]>> {
    const rows = await db.select().from(schoolMetadata)
      .where(eq(schoolMetadata.schoolId, schoolId));
    const result: Record<string, string[]> = {};
    for (const row of rows) {
      try { result[row.metaKey] = JSON.parse(row.metaValue); } catch { result[row.metaKey] = []; }
    }
    return result;
  }

  /**
   * Returns the admin-configured class → sections map.
   * Source: `class_sections` key in school_metadata (set by admin in School Setup).
   * If not yet configured, returns {} so that all teacher modules fall back to
   * the full flat sections list for every class (no partial derivation from students
   * or faculty mappings that would silently hide sections from teachers).
   */
  async getClassSectionsMap(schoolId: number): Promise<Record<string, string[]>> {
    const [row] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_sections")));

    if (row) {
      try {
        const parsed = JSON.parse(row.metaValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, string[]>;
        }
      } catch {}
    }

    return {};
  }

  async setClassSectionsMetadata(schoolId: number, map: Record<string, string[]>): Promise<void> {
    await this.setSchoolMetadataRaw(schoolId, "class_sections", map);
  }

  async getClassSubjectsMap(schoolId: number): Promise<Record<string, string[]>> {
    const [row] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_subjects")));
    if (row) {
      try {
        const parsed = JSON.parse(row.metaValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, string[]>;
        }
      } catch {}
    }
    return {};
  }

  async getClassExamTypesMap(schoolId: number): Promise<Record<string, string[]>> {
    const [row] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_exam_types")));
    if (row) {
      try {
        const parsed = JSON.parse(row.metaValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, string[]>;
        }
      } catch {}
    }
    return {};
  }

  async setClassSubjectsMetadata(schoolId: number, map: Record<string, string[]>): Promise<void> {
    await this.setSchoolMetadataRaw(schoolId, "class_subjects", map);
  }

  async setClassExamTypesMetadata(schoolId: number, map: Record<string, string[]>): Promise<void> {
    await this.setSchoolMetadataRaw(schoolId, "class_exam_types", map);
  }

  // ===== STUDENT SEARCH =====
  async searchStudents(schoolId: number, query: string): Promise<Pick<Student, 'id' | 'name' | 'digitalStudentId' | 'class' | 'section' | 'photoUrl'>[]> {
    const results = await db.select({
      id: students.id,
      name: students.name,
      digitalStudentId: students.digitalStudentId,
      class: students.class,
      section: students.section,
      photoUrl: students.photoUrl,
    }).from(students).where(
      and(
        eq(students.schoolId, schoolId),
        eq(students.isActive, true),
        or(ilike(students.name, `%${query}%`), ilike(students.digitalStudentId, `%${query}%`))
      )
    ).limit(15);
    return results;
  }

  // ===== STUDENT LEAVE REQUESTS =====
  async createStudentLeaveRequest(data: InsertStudentLeaveRequest): Promise<StudentLeaveRequest> {
    requireStudentLeaveSession(data.sessionId);
    const [req] = await db.insert(studentLeaveRequests).values(data).returning();
    return req;
  }

  async getStudentLeavesByClassSection(schoolId: number, cls: string, section: string, sessionId?: number | null): Promise<(StudentLeaveRequest & { studentName: string; dsid: string })[]> {
    const conditions: any[] = [
      eq(studentLeaveRequests.schoolId, schoolId),
      eq(students.class, cls),
      eq(students.section, section),
      eq(studentLeaveRequests.status, "pending_teacher"),
    ];
    if (sessionId != null) conditions.push(eq(studentLeaveRequests.sessionId, sessionId));
    const result = await db.select().from(studentLeaveRequests)
      .innerJoin(students, eq(studentLeaveRequests.studentId, students.id))
      .where(and(...conditions))
      .orderBy(desc(studentLeaveRequests.createdAt));
    return result.map(r => ({
      ...r.student_leave_requests,
      studentName: r.students.name,
      dsid: r.students.digitalStudentId,
      photoUrl: r.students.photoUrl ?? null,
    }));
  }

  async getStudentLeavesBySessionClassSection(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
  ): Promise<(StudentLeaveRequest & { studentName: string; dsid: string; photoUrl: string | null })[]> {
    const result = await db.select().from(studentLeaveRequests)
      .innerJoin(enrollments, teacherStudentLeaveEnrollmentJoin())
      .innerJoin(students, teacherStudentLeaveStudentJoin())
      .where(teacherStudentLeaveSessionScope(schoolId, sessionId, cls, section))
      .orderBy(desc(studentLeaveRequests.createdAt));

    return result.map(r => ({
      ...r.student_leave_requests,
      studentName: r.students.name,
      dsid: r.students.digitalStudentId,
      photoUrl: r.students.photoUrl ?? null,
    }));
  }

  // Returns pending teacher-tier leaves for this Teacher's existing mapped and
  // legacy-assigned class/section pairs, using placement from the selected session.
  async getStudentLeavesByTeacher(
    teacherId: number,
    schoolId: number,
    sessionId: number,
  ): Promise<(StudentLeaveRequest & { studentName: string; dsid: string; class: string; section: string })[]> {
    const teacher = await this.getTeacherById(teacherId);
    if (!teacher || teacher.schoolId !== schoolId) return [];

    const mappings = await db
      .select({ className: facultyMappings.className, section: facultyMappings.section })
      .from(facultyMappings)
      .where(and(eq(facultyMappings.teacherId, teacherId), eq(facultyMappings.schoolId, schoolId)));

    const assignments = teacherStudentLeaveAssignments(teacher, mappings);
    const scope = teacherStudentLeaveQueueSessionScope(schoolId, sessionId, assignments);
    if (!scope) return [];

    const result = await db.select().from(studentLeaveRequests)
      .innerJoin(enrollments, teacherStudentLeaveEnrollmentJoin())
      .innerJoin(students, teacherStudentLeaveStudentJoin())
      .where(scope)
      .orderBy(desc(studentLeaveRequests.createdAt));

    // Keep the legacy response shape, but report the selected-session placement.
    const seen = new Set<number>();
    return result
      .filter(r => { if (seen.has(r.student_leave_requests.id)) return false; seen.add(r.student_leave_requests.id); return true; })
      .map(r => ({
        ...r.student_leave_requests,
        studentName: r.students.name,
        dsid: r.students.digitalStudentId,
        photoUrl: r.students.photoUrl ?? null,
        class: r.enrollments.className,
        section: r.enrollments.sectionName,
      }));
  }

  async getStudentLeaveHistoryForTeacher(teacherId: number, schoolId: number): Promise<(StudentLeaveRequest & { studentName: string; dsid: string; class: string; section: string })[]> {
    const result = await db.select().from(studentLeaveRequests)
      .innerJoin(students, eq(studentLeaveRequests.studentId, students.id))
      .where(
        and(
          eq(studentLeaveRequests.schoolId, schoolId),
          eq(studentLeaveRequests.reviewedBy, teacherId),
          eq(studentLeaveRequests.reviewerRole, "teacher")
        )
      )
      .orderBy(desc(studentLeaveRequests.createdAt));

    return result.map(r => ({
      ...r.student_leave_requests,
      studentName: r.students.name,
      dsid: r.students.digitalStudentId,
      photoUrl: r.students.photoUrl ?? null,
      class: r.students.class,
      section: r.students.section,
    }));
  }

  async updateStudentLeaveStatus(id: number, schoolId: number, status: string, reviewedBy: number, reviewerRole: string, rejectionReason?: string, adminComment?: string, teacherComment?: string, sessionId?: number): Promise<StudentLeaveRequest | null> {
    const updateData: Record<string, unknown> = { status, reviewedBy, reviewerRole };
    if (rejectionReason !== undefined) updateData.rejectionReason = rejectionReason;
    if (adminComment !== undefined) updateData.adminComment = adminComment;
    if (teacherComment !== undefined) updateData.teacherComment = teacherComment;
    const [req] = await db.update(studentLeaveRequests)
      .set(updateData)
      .where(and(
        eq(studentLeaveRequests.id, id),
        eq(studentLeaveRequests.schoolId, schoolId),
        ...(sessionId === undefined ? [] : [eq(studentLeaveRequests.sessionId, sessionId)]),
      )).returning();
    return req ?? null;
  }

  async getStudentLeavesByStudent(studentId: number, schoolId: number, sessionId: number): Promise<StudentLeaveRequest[]> {
    return await db.select().from(studentLeaveRequests)
      .where(studentLeaveSessionScope(studentId, schoolId, sessionId))
      .orderBy(desc(studentLeaveRequests.createdAt));
  }

  async getStudentLeaveById(id: number, schoolId: number): Promise<StudentLeaveRequest | null> {
    const [req] = await db.select().from(studentLeaveRequests).where(and(
      eq(studentLeaveRequests.id, id),
      eq(studentLeaveRequests.schoolId, schoolId),
    ));
    return req || null;
  }

  async deleteStudentLeaveRequest(
    id: number,
    studentId: number,
    schoolId: number,
    sessionId: number,
  ): Promise<{ success: boolean; reason?: string }> {
    const scope = studentLeaveSessionScope(studentId, schoolId, sessionId);
    const [leave] = await db.select().from(studentLeaveRequests).where(and(
      eq(studentLeaveRequests.id, id),
      scope,
    ));
    if (!leave) return { success: false, reason: "not_found" };
    if (leave.status !== "pending_teacher") return { success: false, reason: "not_pending" };
    const [deleted] = await db.delete(studentLeaveRequests).where(and(
      eq(studentLeaveRequests.id, id),
      scope,
      eq(studentLeaveRequests.status, "pending_teacher"),
    )).returning({ id: studentLeaveRequests.id });
    if (!deleted) return { success: false, reason: "not_pending" };
    return { success: true };
  }

  async deleteLeaveRequest(
    id: number,
    teacherId: number,
    schoolId: number,
    sessionId: number,
  ): Promise<{ success: boolean; reason?: string }> {
    const leave = await this.getLeaveRequestById(id);
    if (!leave) return { success: false, reason: "not_found" };
    if (leave.teacherId !== teacherId || leave.schoolId !== schoolId) {
      return { success: false, reason: "forbidden" };
    }
    if (leave.sessionId !== sessionId) return { success: false, reason: "not_found" };
    if (leave.status !== "pending") return { success: false, reason: "not_pending" };
    const [deleted] = await db.delete(leaveRequests).where(and(
      eq(leaveRequests.id, id),
      eq(leaveRequests.teacherId, teacherId),
      eq(leaveRequests.schoolId, schoolId),
      eq(leaveRequests.sessionId, sessionId),
      eq(leaveRequests.status, "pending"),
    )).returning({ id: leaveRequests.id });
    if (!deleted) return { success: false, reason: "not_pending" };
    return { success: true };
  }

  async approveStudentLeaveWithAttendance(input: {
    leaveId: number;
    studentId: number;
    teacherId: number | null;
    schoolId: number;
    sessionId: number;
    expectedStatus: "pending_teacher" | "forwarded_to_admin";
    reviewedBy: number;
    reviewerRole: "teacher" | "admin";
    teacherComment?: string;
    adminComment?: string;
  }): Promise<StudentLeaveRequest | null> {
    const { leaveId, studentId, teacherId, schoolId, sessionId } = input;
    return db.transaction(async tx => {
      // Lock the leave and its Session before validating. Activation must wait
      // until this Attendance write commits, rather than archiving it mid-write.
      const [leave] = await tx.select().from(studentLeaveRequests).where(and(
        eq(studentLeaveRequests.id, leaveId),
        eq(studentLeaveRequests.schoolId, schoolId),
      )).for("update");
      if (!leave || leave.status !== input.expectedStatus) return null;
      if (leave.studentId !== studentId || leave.sessionId !== sessionId) {
        throw new AttendanceLeaveMutationError("Leave request does not belong to this Student and Session", 403);
      }
      let [session] = await tx.select().from(academicSessions).where(and(
        eq(academicSessions.id, sessionId),
        eq(academicSessions.schoolId, schoolId),
      ));
      const [active] = await tx.select({ id: academicSessions.id }).from(academicSessions)
        .where(and(eq(academicSessions.schoolId, schoolId), eq(academicSessions.isActive, true))).limit(1);
      if (!session || !session.isActive || active?.id !== sessionId) {
        throw new AttendanceLeaveMutationError("Attendance can only be changed in the active academic session");
      }
      if (!isValidDateOnly(session.startDate) || !isValidDateOnly(session.endDate) ||
          session.startDate > session.endDate ||
          !isValidDateOnly(leave.startDate) || !isValidDateOnly(leave.endDate) ||
          leave.startDate > leave.endDate) {
        throw new AttendanceLeaveMutationError("Invalid Attendance date range", 400);
      }
      const [student] = await tx.select().from(students).where(and(
        eq(students.id, studentId), eq(students.schoolId, schoolId),
      ));
      const [teacher] = teacherId === null ? [null] : await tx.select({ id: teachers.id }).from(teachers)
        .where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)));
      if (!student || (teacherId !== null && !teacher)) {
        throw new AttendanceLeaveMutationError("Leave Attendance entities do not belong to the same school", 403);
      }

      const today = todayInIST();
      const earliest = addCalendarDays(today, -7);
      const dates: string[] = [];
      for (let date = leave.startDate; date <= leave.endDate; date = addCalendarDays(date, 1)) {
        if (calendarWeekday(date) === 0) continue; // Preserve the existing leave-specific Sunday skip.
        if (date < session.startDate || date > session.endDate) {
          throw new AttendanceLeaveMutationError("Attendance date is outside the active academic session period", 400);
        }
        if (date > today) throw new AttendanceLeaveMutationError("Cannot mark attendance for future dates", 400);
        if (date < earliest) throw new AttendanceLeaveMutationError("Can only edit attendance for the past 7 days", 400);
        dates.push(date);
      }
      const holidays = dates.length ? await tx.select({ date: calendarEvents.date }).from(calendarEvents).where(and(
        eq(calendarEvents.schoolId, schoolId),
        eq(calendarEvents.eventType, "holiday"),
        eq(calendarEvents.audienceScope, "All_School"),
        inArray(calendarEvents.date, dates),
      )) : [];
      const holidayDates = new Set(holidays.map(holiday => holiday.date));

      const [enrollment] = await tx.select({
        class: enrollments.className, section: enrollments.sectionName,
      }).from(enrollments).where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.studentId, studentId),
      )).limit(1);
      const [snapshot] = enrollment ? [null] : await tx.select({
        class: attendanceRecords.class, section: attendanceRecords.section,
      }).from(attendanceRecords).where(and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
        eq(attendanceRecords.identityKey, student.attendanceIdentityKey),
        isNotNull(attendanceRecords.class),
        isNotNull(attendanceRecords.section),
      )).orderBy(attendanceRecords.date, attendanceRecords.id).limit(1);
      const cls = enrollment?.class || snapshot?.class || (student.isActive ? student.class : null);
      const section = enrollment?.section || snapshot?.section || (student.isActive ? student.section : null);
      if (cls?.trim() && section?.trim()) {
        await lockPromotionCohort(tx, schoolId, sessionId, cls, section);
      }
      const [lockedSession] = await tx.select().from(academicSessions).where(and(
        eq(academicSessions.id, sessionId),
        eq(academicSessions.schoolId, schoolId),
      )).for("update");
      const [activeAfterLock] = await tx.select({ id: academicSessions.id }).from(academicSessions)
        .where(and(eq(academicSessions.schoolId, schoolId), eq(academicSessions.isActive, true))).limit(1);
      if (!lockedSession || !lockedSession.isActive || activeAfterLock?.id !== sessionId) {
        throw new AttendanceLeaveMutationError("Attendance can only be changed in the active academic session");
      }
      session = lockedSession;
      for (const date of dates) {
        if (date < session.startDate || date > session.endDate) {
          throw new AttendanceLeaveMutationError("Attendance date is outside the active academic session period", 400);
        }
      }

      // Validate every date before the first update; the transaction also rolls
      // back both Attendance and approval if any database write fails.
      const changes: Array<{ date: string; existing: AttendanceRecord | undefined }> = [];
      for (const date of dates) {
        if (holidayDates.has(date)) continue;
        const [existing] = await tx.select().from(attendanceRecords).where(and(
          eq(attendanceRecords.schoolId, schoolId),
          eq(attendanceRecords.sessionId, sessionId),
          eq(attendanceRecords.identityKey, student.attendanceIdentityKey),
          eq(attendanceRecords.date, date),
        ));
        if ((existing && (!existing.class?.trim() || !existing.section?.trim())) ||
            (!existing && teacherId !== null && (!cls?.trim() || !section?.trim()))) {
          throw new AttendanceLeaveMutationError("Authoritative Student class and section are required for Attendance");
        }
        changes.push({ date, existing });
      }
      for (const { date, existing } of changes) {
        if (existing) {
          await tx.update(attendanceRecords)
            .set({ status: "leave", markedBy: "System (Leave Approved)", markedAt: new Date() })
            .where(and(eq(attendanceRecords.id, existing.id),
              eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.sessionId, sessionId)));
        } else if (teacherId !== null) {
          await tx.insert(attendanceRecords).values({
            studentId, originalStudentId: studentId,
            identityKey: student.attendanceIdentityKey,
            studentNameSnapshot: student.name,
            studentCodeSnapshot: student.digitalStudentId,
            teacherId, schoolId, sessionId, date,
            class: cls!, section: section!,
            status: "leave", editCount: 0, markedBy: "System (Leave Approved)", markedAt: new Date(),
          });
        }
        // Preserve admin approval without a class teacher: no new Attendance row.
      }
      const [approved] = await tx.update(studentLeaveRequests).set({
        status: "approved",
        reviewedBy: input.reviewedBy,
        reviewerRole: input.reviewerRole,
        ...(input.teacherComment !== undefined && { teacherComment: input.teacherComment }),
        ...(input.adminComment !== undefined && { adminComment: input.adminComment }),
      }).where(and(
        eq(studentLeaveRequests.id, leaveId),
        eq(studentLeaveRequests.schoolId, schoolId),
        eq(studentLeaveRequests.status, input.expectedStatus),
      )).returning();
      return approved ?? null;
    });
  }

  // ===== AUDIT LOGS =====
  async createAuditLog(data: InsertAuditLog): Promise<AuditLog> {
    let sessionId = data.sessionId;
    if (sessionId === undefined) {
      const active = await this.getActiveSession(data.schoolId);
      sessionId = active?.id ?? null;
    }
    const [log] = await db.insert(auditLogs).values({ ...data, sessionId }).returning();
    return log;
  }

  async getAuditLogs(schoolId: number, limit: number = 100): Promise<AuditLog[]> {
    return await db.select().from(auditLogs)
      .where(eq(auditLogs.schoolId, schoolId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  // ===== ENHANCED LIBRARY =====
  async getLibraryBookById(id: number): Promise<LibraryBook | null> {
    const [book] = await db.select().from(libraryBooks).where(eq(libraryBooks.id, id));
    return book || null;
  }

  async updateBookVerificationStatus(id: number, status: string): Promise<LibraryBook> {
    const [book] = await db.update(libraryBooks)
      .set({ verificationStatus: status })
      .where(eq(libraryBooks.id, id)).returning();
    return book;
  }

  async searchLibraryBooksAdvanced(schoolId: number, query: string): Promise<LibraryBook[]> {
    return await db.select().from(libraryBooks).where(
      and(
        eq(libraryBooks.schoolId, schoolId),
        or(
          ilike(libraryBooks.title, `%${query}%`),
          ilike(libraryBooks.author, `%${query}%`),
          ilike(libraryBooks.targetClass, `%${query}%`)
        )
      )
    );
  }

  // ===== LEAVE POLICIES =====
  async getLeavePoliciesBySchool(schoolId: number): Promise<LeavePolicy[]> {
    return await db.select().from(leavePolicies)
      .where(eq(leavePolicies.schoolId, schoolId))
      .orderBy(leavePolicies.createdAt);
  }

  async getActiveLeavePoliciesBySchool(schoolId: number, requesterRole?: "teacher" | "non_teaching"): Promise<LeavePolicy[]> {
    const all = await db.select().from(leavePolicies)
      .where(and(eq(leavePolicies.schoolId, schoolId), eq(leavePolicies.isActive, true)))
      .orderBy(leavePolicies.createdAt);
    if (!requesterRole) return all;
    return all.filter(p => p.targetRoles === "all" || p.targetRoles === requesterRole);
  }

  async createLeavePolicy(data: InsertLeavePolicy): Promise<LeavePolicy> {
    const [policy] = await db.insert(leavePolicies).values(data).returning();
    return policy;
  }

  async updateLeavePolicy(id: number, schoolId: number, data: Partial<InsertLeavePolicy>): Promise<LeavePolicy> {
    const [policy] = await db.update(leavePolicies).set(data).where(and(eq(leavePolicies.id, id), eq(leavePolicies.schoolId, schoolId))).returning();
    return policy;
  }

  async deleteLeavePolicy(id: number, schoolId: number): Promise<void> {
    await db.delete(leavePolicies).where(and(eq(leavePolicies.id, id), eq(leavePolicies.schoolId, schoolId)));
  }

  async getLeavePolicyById(id: number): Promise<LeavePolicy | null> {
    const [policy] = await db.select().from(leavePolicies).where(eq(leavePolicies.id, id));
    return policy ?? null;
  }

  // ===== TEACHER LEAVE BALANCE (policy-driven) =====
  async getTeacherLeaveBalance(teacherId: number): Promise<{ sick: number; casual: number; earned: number }> {
    const year = dateOnlyParts(todayInIST())!.year;
    const startOfYear = `${year}-01-01`;
    const endOfYear = `${year}-12-31`;
    const approved = await db.select().from(leaveRequests)
      .where(and(
        eq(leaveRequests.teacherId, teacherId),
        eq(leaveRequests.status, "approved"),
        gte(leaveRequests.startDate, startOfYear),
        lte(leaveRequests.endDate, endOfYear)
      ));
    let sick = 0, casual = 0, earned = 0;
    for (const r of approved) {
      const days = (calendarDayDifference(r.startDate, r.endDate) ?? -1) + 1;
      if (days <= 0) continue;
      const type = r.leaveType.toLowerCase();
      if (type.includes("sick")) sick += days;
      else if (type.includes("casual")) casual += days;
      else earned += days;
    }
    return { sick, casual, earned };
  }

  async getTeacherLeaveBalanceByPolicies(teacherId: number, schoolId: number): Promise<{
    policyId: number;
    name: string;
    annualLimit: number;
    carryForward: number;
    used: number;
    remaining: number;
    validUntil: string;
  }[]> {
    const policies = await this.getActiveLeavePoliciesBySchool(schoolId, "teacher");
    if (policies.length === 0) return [];

    const todayStr = todayInIST();
    const todayParts = dateOnlyParts(todayStr)!;
    const result = [];

    for (const policy of policies) {
      const mm = String(policy.renewalMonth).padStart(2, "0");
      const dd = String(policy.renewalDay).padStart(2, "0");
      const renewalThisYear = `${todayParts.year}-${mm}-${dd}`;
      const renewalNextYear = `${todayParts.year + 1}-${mm}-${dd}`;
      const renewalLastYear = `${todayParts.year - 1}-${mm}-${dd}`;

      let periodStart: string;
      let periodEnd: string;
      if (todayStr >= renewalThisYear) {
        periodStart = renewalThisYear;
        periodEnd = addCalendarDays(renewalNextYear, -1);
      } else {
        periodStart = renewalLastYear;
        periodEnd = addCalendarDays(renewalThisYear, -1);
      }

      const currentApproved = await db.select().from(leaveRequests)
        .where(and(
          eq(leaveRequests.teacherId, teacherId),
          eq(leaveRequests.status, "approved"),
          or(eq(leaveRequests.policyId, policy.id), and(sql`${leaveRequests.policyId} IS NULL`, eq(leaveRequests.leaveType, policy.name))),
          lte(leaveRequests.startDate, periodEnd),
          gte(leaveRequests.endDate, periodStart)
        ));

      let used = 0;
      for (const r of currentApproved) {
        const start = r.startDate > periodStart ? r.startDate : periodStart;
        const end = r.endDate < periodEnd ? r.endDate : periodEnd;
        const overlapDays = calendarDayDifference(start, end);
        if (overlapDays !== null && overlapDays >= 0) used += overlapDays + 1;
      }

      let carryForward = 0;
      if (policy.expiryBehavior === "carry_forward") {
        const prevPeriodStart = `${parseInt(periodStart.slice(0, 4)) - 1}${periodStart.slice(4)}`;
        const prevPeriodEnd = addCalendarDays(periodStart, -1);

        // Only carry forward if the policy existed before the current period started.
        // A policy created within the current period has no real previous-period history,
        // so carry-forward would inflate the balance with phantom days.
        const policyCreatedStr = dateOnlyInIST(policy.createdAt) ?? "";
        if (policyCreatedStr < periodStart) {
          const prevApproved = await db.select().from(leaveRequests)
            .where(and(
              eq(leaveRequests.teacherId, teacherId),
              eq(leaveRequests.status, "approved"),
              or(eq(leaveRequests.policyId, policy.id), and(sql`${leaveRequests.policyId} IS NULL`, eq(leaveRequests.leaveType, policy.name))),
              lte(leaveRequests.startDate, prevPeriodEnd),
              gte(leaveRequests.endDate, prevPeriodStart)
            ));

          let prevUsed = 0;
          for (const r of prevApproved) {
            const start = r.startDate > prevPeriodStart ? r.startDate : prevPeriodStart;
            const end = r.endDate < prevPeriodEnd ? r.endDate : prevPeriodEnd;
            const overlapDays = calendarDayDifference(start, end);
            if (overlapDays !== null && overlapDays >= 0) prevUsed += overlapDays + 1;
          }
          carryForward = Math.max(0, policy.annualLimit - prevUsed);
        }
      }

      const effectiveLimit = policy.annualLimit + carryForward;
      const remaining = Math.max(0, effectiveLimit - used);

      result.push({ policyId: policy.id, name: policy.name, annualLimit: policy.annualLimit, carryForward, used, remaining, periodStart, validUntil: periodEnd });
    }

    return result;
  }

  async updateLeaveStatusWithApprover(id: number, schoolId: number, status: string, approvedBy: number): Promise<LeaveRequest | null> {
    const [req] = await db.update(leaveRequests).set({ status, approvedBy }).where(and(
      eq(leaveRequests.id, id),
      eq(leaveRequests.schoolId, schoolId),
    )).returning();
    return req ?? null;
  }

  async updateLeaveStatusBySchool(id: number, schoolId: number, status: string): Promise<LeaveRequest | null> {
    const [req] = await db.update(leaveRequests).set({ status }).where(and(
      eq(leaveRequests.id, id),
      eq(leaveRequests.schoolId, schoolId),
    )).returning();
    return req ?? null;
  }

  // ===== PAGINATED STUDENTS (Big Data) =====
  async getStudentsPaginated(schoolId: number, opts: { q?: string; cls?: string; section?: string; page?: number; pendingReissue?: boolean; sessionId?: number | null }): Promise<{ data: Student[]; total: number }> {
    const { q, cls, section, page = 1, pendingReissue, sessionId } = opts;
    const limit = 50;
    const offset = (page - 1) * limit;

    // When a sessionId is provided, scope results to students enrolled in that
    // session via the enrollments table.  The student's class / section on the
    // returned objects is overridden with the enrollment's className / sectionName
    // so that ID cards printed for a past session show the correct cohort year.
    if (sessionId != null) {
      const joinConds = [
        eq(enrollments.studentId, students.id),
        eq(enrollments.schoolId,  schoolId),
        eq(enrollments.sessionId, sessionId),
        ...(cls     ? [eq(enrollments.className,   cls)]     : []),
        ...(section ? [eq(enrollments.sectionName, section)] : []),
      ] as any[];

      const whereConds = [
        eq(students.schoolId, schoolId),
        eq(students.isActive, true),
        ...(pendingReissue ? [eq(students.idCardPendingReissue, true)] : []),
        ...(q ? [or(
          ilike(students.name, `%${q}%`),
          ilike(students.digitalStudentId, `%${q}%`),
          ilike(students.phone, `%${q}%`),
        )!] : []),
      ] as any[];

      const [{ total }] = await db
        .select({ total: count() })
        .from(students)
        .innerJoin(enrollments, and(...joinConds))
        .where(and(...whereConds));

      const rows = await db
        .select({
          student:         students,
          enrolledClass:   enrollments.className,
          enrolledSection: enrollments.sectionName,
        })
        .from(students)
        .innerJoin(enrollments, and(...joinConds))
        .where(and(...whereConds))
        .orderBy(students.digitalStudentId)
        .limit(limit)
        .offset(offset);

      // Override class / section with session-specific enrollment values.
      const data = rows.map(r => ({
        ...r.student,
        class:   r.enrolledClass,
        section: r.enrolledSection,
      })) as Student[];

      return { data, total: Number(total) };
    }

    const conditions = [eq(students.schoolId, schoolId), eq(students.isActive, true)] as any[];
    if (cls) conditions.push(eq(students.class, cls));
    if (section) conditions.push(eq(students.section, section));
    if (pendingReissue) conditions.push(eq(students.idCardPendingReissue, true));
    if (q) conditions.push(or(ilike(students.name, `%${q}%`), ilike(students.digitalStudentId, `%${q}%`), ilike(students.phone, `%${q}%`))!);
    const [{ total }] = await db.select({ total: count() }).from(students).where(and(...conditions));
    const data = await db.select().from(students).where(and(...conditions)).orderBy(students.digitalStudentId).limit(limit).offset(offset);
    return { data, total: Number(total) };
  }

  async getStudentsForExport(schoolId: number, opts: { q?: string; cls?: string; section?: string }): Promise<Array<{
    digitalStudentId: string; name: string; class: string; section: string;
    rollNo: string | null; rollNumber: number | null; phone: string;
    gender: string | null; guardianName: string | null;
    isActivated: boolean; isActive: boolean; enrollmentDate: string | null;
    dob: string | null; bloodGroup: string | null;
  }>> {
    const { q, cls, section } = opts;
    const conditions = [eq(students.schoolId, schoolId), eq(students.isActive, true)];
    if (cls) conditions.push(eq(students.class, cls));
    if (section) conditions.push(eq(students.section, section));
    if (q) conditions.push(or(ilike(students.name, `%${q}%`), ilike(students.digitalStudentId, `%${q}%`), ilike(students.phone, `%${q}%`))!);
    const rows = await db
      .select({
        digitalStudentId: students.digitalStudentId,
        name: students.name,
        class: students.class,
        section: students.section,
        phone: students.phone,
        email: students.email,
        gender: students.gender,
        rollNumber: students.rollNumber,
        guardianName: students.guardianName,
        isActivated: students.isActivated,
        isActive: students.isActive,
        enrollmentDate: students.enrollmentDate,
        dob: students.dob,
        bloodGroup: students.bloodGroup,
        rollNo: studentProfiles.rollNo,
      })
      .from(students)
      .leftJoin(studentProfiles, eq(studentProfiles.studentId, students.id))
      .where(and(...conditions))
      .orderBy(students.class, students.section, students.digitalStudentId);
    return rows;
  }

  async updateStudent(id: number, schoolId: number, data: StudentUpdateData): Promise<Student | undefined> {
    return this.updateStudentWithinTransaction(id, schoolId, data, false);
  }

  /** Web Student Registry Edit: synchronize only changed placement fields. */
  async updateStudentWithActiveSessionEnrollment(
    id: number,
    schoolId: number,
    data: StudentUpdateData,
  ): Promise<Student | undefined> {
    return this.updateStudentWithinTransaction(id, schoolId, data, true);
  }

  private async updateStudentWithinTransaction(
    id: number,
    schoolId: number,
    data: StudentUpdateData,
    synchronizeActiveSessionPlacement: boolean,
  ): Promise<Student | undefined> {
    const setData: Record<string, unknown> = {
      name: data.name, class: data.class, section: data.section, phone: data.phone,
    };
    if (data.gender !== undefined) setData.gender = data.gender;
    if (data.rollNumber !== undefined) setData.rollNumber = data.rollNumber;
    if (data.guardianName !== undefined) setData.guardianName = data.guardianName;
    if (data.dob) setData.dob = data.dob;
    if (data.enrollmentDate) setData.enrollmentDate = data.enrollmentDate;
    if (data.bloodGroup !== undefined) setData.bloodGroup = data.bloodGroup;
    if (data.fatherName !== undefined) setData.fatherName = data.fatherName;
    if (data.motherName !== undefined) setData.motherName = data.motherName;
    if (data.address !== undefined) setData.address = data.address;
    if (data.aadharNumber !== undefined) setData.aadharNumber = data.aadharNumber;
    if (data.email !== undefined) setData.email = data.email;
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${id})`);
      const [before] = await tx.select({
        email: students.email,
        class: students.class,
        section: students.section,
        rollNumber: students.rollNumber,
        isActive: students.isActive,
      }).from(students)
        .where(and(eq(students.id, id), eq(students.schoolId, schoolId))).for("update");
      if (!before) return undefined;

      const placementChanged = synchronizeActiveSessionPlacement
        && hasActiveStudentPlacementChanged(before, {
          class: data.class,
          section: data.section,
          rollNumber: data.rollNumber ?? null,
        });
      let activeSessionId: number | null = null;
      if (placementChanged) {
        const activeSessions = await tx
          .select({ id: academicSessions.id })
          .from(academicSessions)
          .where(and(
            eq(academicSessions.schoolId, schoolId),
            eq(academicSessions.isActive, true),
          ))
          .limit(2)
          .for("update");
        if (activeSessions.length === 0) {
          throw new StudentRegistryPlacementSessionError("NO_ACTIVE_SESSION");
        }
        if (activeSessions.length !== 1) {
          throw new StudentRegistryPlacementSessionError("MULTIPLE_ACTIVE_SESSIONS");
        }
        activeSessionId = activeSessions[0].id;

        const placementMetadata = await tx
          .select({ metaKey: schoolMetadata.metaKey, metaValue: schoolMetadata.metaValue })
          .from(schoolMetadata)
          .where(and(
            eq(schoolMetadata.schoolId, schoolId),
            inArray(schoolMetadata.metaKey, ["classes", "sections", "class_sections"]),
          ));
        if (!isConfiguredStudentPlacement(placementMetadata, data.class, data.section)) {
          throw new StudentRegistryPlacementValidationError();
        }
      }

      const [updated] = await tx.update(students)
        .set(setData as Partial<typeof students.$inferInsert>)
        .where(and(eq(students.id, id), eq(students.schoolId, schoolId)))
        .returning();
      if (activeSessionId !== null) {
        await tx.insert(enrollments).values({
          schoolId,
          studentId: id,
          sessionId: activeSessionId,
          className: data.class,
          sectionName: data.section,
          rollNo: data.rollNumber ?? null,
          status: "Active",
        }).onConflictDoUpdate({
          target: [enrollments.schoolId, enrollments.studentId, enrollments.sessionId],
          set: {
            className: data.class,
            sectionName: data.section,
            rollNo: data.rollNumber ?? null,
          },
        });
      }
      if (data.email !== undefined && (data.email ?? "").trim().toLowerCase() !== (before.email ?? "").trim().toLowerCase()) {
        const now = new Date();
        await tx.update(studentPasswordResetChallenges).set({ consumedAt: now }).where(and(
          eq(studentPasswordResetChallenges.studentId, id),
          eq(studentPasswordResetChallenges.schoolId, schoolId),
          isNull(studentPasswordResetChallenges.consumedAt),
        ));
      }
      return updated;
    });
  }

  async createStudentPasswordResetChallenge(
    studentId: number,
    schoolId: number,
    expectedEmail: string,
    otpHash: string,
    otpExpiresAt: Date,
    requestIp: string | null,
    now = new Date(),
  ): Promise<StudentPasswordResetChallenge | null> {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${studentId})`);
      const [student] = await tx.select({
        id: students.id,
        schoolId: students.schoolId,
        email: students.email,
        isActive: students.isActive,
        isActivated: students.isActivated,
      }).from(students).where(and(
        eq(students.id, studentId),
        eq(students.schoolId, schoolId),
      )).for("update");
      if (
        !student
        || !student.isActive
        || !student.isActivated
        || !isValidStudentRecoveryEmail(student.email)
        || student.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()
      ) return null;
      const [verifiedRecovery] = await tx.select({ id: studentPasswordResetChallenges.id })
        .from(studentPasswordResetChallenges)
        .where(and(
          eq(studentPasswordResetChallenges.studentId, studentId),
          eq(studentPasswordResetChallenges.schoolId, schoolId),
          eq(studentPasswordResetChallenges.purpose, "student_password_recovery"),
          isNull(studentPasswordResetChallenges.consumedAt),
          isNotNull(studentPasswordResetChallenges.verifiedAt),
          gt(studentPasswordResetChallenges.resetTokenExpiresAt, now),
        ))
        .limit(1)
        .for("update");
      if (verifiedRecovery) return null;
      await tx.update(studentPasswordResetChallenges).set({ consumedAt: now }).where(and(
        eq(studentPasswordResetChallenges.studentId, studentId),
        eq(studentPasswordResetChallenges.schoolId, schoolId),
        isNull(studentPasswordResetChallenges.consumedAt),
      ));
      const [challenge] = await tx.insert(studentPasswordResetChallenges).values({
        schoolId,
        studentId,
        purpose: "student_password_recovery",
        otpHash,
        otpExpiresAt,
        attemptCount: 0,
        requestIp,
        createdAt: now,
      }).returning();
      return challenge;
    });
  }

  async getStudentPasswordResetChallenge(
    challengeId: number,
    studentId: number,
    schoolId: number,
  ): Promise<StudentPasswordResetChallenge | undefined> {
    const [challenge] = await db.select().from(studentPasswordResetChallenges).where(and(
      eq(studentPasswordResetChallenges.id, challengeId),
      eq(studentPasswordResetChallenges.studentId, studentId),
      eq(studentPasswordResetChallenges.schoolId, schoolId),
    )).limit(1);
    return challenge;
  }

  async invalidateStudentPasswordResetChallenge(
    challengeId: number,
    studentId: number,
    schoolId: number,
    now = new Date(),
  ): Promise<void> {
    await db.update(studentPasswordResetChallenges).set({ consumedAt: now }).where(and(
      eq(studentPasswordResetChallenges.id, challengeId),
      eq(studentPasswordResetChallenges.studentId, studentId),
      eq(studentPasswordResetChallenges.schoolId, schoolId),
      isNull(studentPasswordResetChallenges.consumedAt),
    ));
  }

  async verifyStudentPasswordResetOtp(
    challengeId: number,
    studentId: number,
    schoolId: number,
    otp: string,
    now = new Date(),
  ): Promise<string | null> {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${studentId})`);
      const [challenge] = await tx.select().from(studentPasswordResetChallenges).where(and(
        eq(studentPasswordResetChallenges.id, challengeId),
        eq(studentPasswordResetChallenges.studentId, studentId),
        eq(studentPasswordResetChallenges.schoolId, schoolId),
        eq(studentPasswordResetChallenges.purpose, "student_password_recovery"),
      )).for("update");
      if (
        !challenge
        || challenge.consumedAt
        || challenge.verifiedAt
        || challenge.otpExpiresAt <= now
        || challenge.attemptCount >= 5
      ) return null;
      const [student] = await tx.select({
        email: students.email,
        isActive: students.isActive,
        isActivated: students.isActivated,
      }).from(students).where(and(
        eq(students.id, studentId),
        eq(students.schoolId, schoolId),
      )).for("update");
      if (!student || !student.isActive || !student.isActivated || !isValidStudentRecoveryEmail(student.email)) return null;
      const suppliedHash = hashPasswordRecoverySecret(otp);
      if (!passwordRecoverySecretsEqual(challenge.otpHash, suppliedHash)) {
        await tx.update(studentPasswordResetChallenges).set({
          attemptCount: sql`LEAST(${studentPasswordResetChallenges.attemptCount} + 1, 5)`,
        }).where(and(
          eq(studentPasswordResetChallenges.id, challenge.id),
          lt(studentPasswordResetChallenges.attemptCount, 5),
        ));
        return null;
      }
      const resetToken = generatePasswordRecoveryToken();
      const [updated] = await tx.update(studentPasswordResetChallenges).set({
        verifiedAt: now,
        resetTokenHash: hashPasswordRecoverySecret(resetToken),
        resetTokenExpiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      }).where(and(
        eq(studentPasswordResetChallenges.id, challenge.id),
        isNull(studentPasswordResetChallenges.verifiedAt),
        isNull(studentPasswordResetChallenges.consumedAt),
      )).returning({ id: studentPasswordResetChallenges.id });
      return updated ? resetToken : null;
    });
  }

  async resetStudentPasswordAtomically(
    challengeId: number,
    studentId: number,
    schoolId: number,
    resetToken: string,
    passwordHash: string,
  ): Promise<boolean> {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${studentId})`);
      const lockClock = await tx.execute<{ now: Date }>(sql`SELECT clock_timestamp() AS now`);
      const transactionNow = new Date(lockClock.rows[0].now);
      const [challenge] = await tx.select().from(studentPasswordResetChallenges).where(and(
        eq(studentPasswordResetChallenges.id, challengeId),
        eq(studentPasswordResetChallenges.studentId, studentId),
        eq(studentPasswordResetChallenges.schoolId, schoolId),
        eq(studentPasswordResetChallenges.purpose, "student_password_recovery"),
        isNull(studentPasswordResetChallenges.consumedAt),
        isNotNull(studentPasswordResetChallenges.verifiedAt),
        gt(studentPasswordResetChallenges.resetTokenExpiresAt, transactionNow),
      )).for("update");
      if (
        !challenge?.resetTokenHash
        || !challenge.resetTokenExpiresAt
        || !passwordRecoverySecretsEqual(
          challenge.resetTokenHash,
          hashPasswordRecoverySecret(resetToken),
        )
      ) return false;
      const [student] = await tx.select({ id: students.id, email: students.email }).from(students).where(and(
        eq(students.id, studentId),
        eq(students.schoolId, schoolId),
        eq(students.isActive, true),
        eq(students.isActivated, true),
      )).for("update");
      if (!student || !isValidStudentRecoveryEmail(student.email)) return false;
      await tx.update(students).set({ passwordHash }).where(and(
        eq(students.id, studentId),
        eq(students.schoolId, schoolId),
      ));
      await tx.update(studentPasswordResetChallenges).set({ consumedAt: transactionNow }).where(and(
        eq(studentPasswordResetChallenges.studentId, studentId),
        eq(studentPasswordResetChallenges.schoolId, schoolId),
        isNull(studentPasswordResetChallenges.consumedAt),
      ));
      const revokedAt = transactionNow.getTime();
      await tx.execute(sql`
        INSERT INTO "session" (sid, sess, expire)
        VALUES (
          ${studentSessionRevocationSid(studentId)},
          ${JSON.stringify({ revokedAt })}::json,
          ${new Date(revokedAt + SESSION_REVOCATION_TTL_MS)}
        )
        ON CONFLICT (sid) DO UPDATE
        SET sess = EXCLUDED.sess, expire = EXCLUDED.expire
      `);
      await tx.execute(sql`
        DELETE FROM "session"
        WHERE sess->>'studentId' = ${String(studentId)}
      `);
      return true;
    });
  }

  async getStudentStats(schoolId: number, cls?: string, section?: string): Promise<{ total: number; boys: number; girls: number }> {
    const conditions = [eq(students.schoolId, schoolId), eq(students.isActive, true)];
    if (cls) conditions.push(eq(students.class, cls));
    if (section) conditions.push(eq(students.section, section));
    const rows = await db
      .select({ gender: students.gender, cnt: count() })
      .from(students)
      .where(and(...conditions))
      .groupBy(students.gender);
    let total = 0, boys = 0, girls = 0;
    for (const r of rows) {
      const n = Number(r.cnt);
      total += n;
      if (r.gender === "Boy") boys = n;
      else if (r.gender === "Girl") girls = n;
    }
    return { total, boys, girls };
  }

  async autoAssignRollNumbers(schoolId: number, cls: string, section: string): Promise<number> {
    const list = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.class, cls), eq(students.section, section), eq(students.isActive, true)))
      .orderBy(students.name);
    let rollNo = 1;
    for (const s of list) {
      await db.update(students).set({ rollNumber: rollNo }).where(eq(students.id, s.id));
      rollNo++;
    }
    return list.length;
  }

  async bulkDeactivateStudents(
    ids: number[],
    schoolId: number,
  ): Promise<{ id: number; name: string; digitalStudentId: string }[]> {
    if (ids.length === 0) return [];
    const updated = await db.update(students)
      .set({ isActive: false })
      .where(and(inArray(students.id, ids), eq(students.schoolId, schoolId)))
      .returning({ id: students.id, name: students.name, digitalStudentId: students.digitalStudentId });
    return updated;
  }

  // ===== PAGINATED TEACHERS (Big Data) =====
  async updateTeacherAssignment(teacherId: number, schoolId: number, data: { fullName: string; subject: string; assignedClass: string; assignedSection: string; phone?: string; designation?: string; department?: string; gender?: string; dateOfBirth?: string; govtIdType?: string; govtIdNumber?: string; address?: string; joiningDate?: string; qualifications?: string; email?: string }): Promise<Teacher | undefined> {
    const setData: Partial<typeof teachers.$inferInsert> = {
      fullName: data.fullName,
      subject: data.subject,
      assignedClass: data.assignedClass,
      assignedSection: data.assignedSection,
    };
    if (data.phone !== undefined) setData.phone = data.phone;
    if (data.designation !== undefined) setData.designation = data.designation;
    if (data.department !== undefined) setData.department = data.department;
    if (data.gender !== undefined) setData.gender = data.gender;
    if (data.dateOfBirth !== undefined) setData.dateOfBirth = data.dateOfBirth;
    if (data.govtIdType !== undefined) setData.govtIdType = data.govtIdType;
    if (data.govtIdNumber !== undefined) setData.govtIdNumber = data.govtIdNumber;
    if (data.address !== undefined) setData.address = data.address;
    if (data.joiningDate !== undefined) setData.joiningDate = data.joiningDate;
    if (data.qualifications !== undefined) setData.qualifications = data.qualifications;
    return db.transaction(async tx => {
      const [identity] = await tx.select({ teacher: teachers, user: users })
        .from(teachers)
        .innerJoin(users, eq(teachers.userId, users.id))
        .where(and(
          eq(teachers.id, teacherId),
          eq(teachers.schoolId, schoolId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
        ))
        .for("update");
      if (!identity || identity.teacher.userId !== identity.user.id) return undefined;

      if (data.email !== undefined) {
        if (data.email !== identity.user.email) {
          const [owner] = await tx.select({ id: users.id })
            .from(users)
            .where(eq(users.email, data.email))
            .for("update");
          if (owner && owner.id !== identity.user.id) {
            throw new TeacherEmailConflictError();
          }
          await tx.update(users)
            .set({ email: data.email })
            .where(and(
              eq(users.id, identity.user.id),
              eq(users.schoolId, schoolId),
              eq(users.role, "teacher"),
            ));
          await tx.update(passwordResetChallenges)
            .set({ consumedAt: new Date() })
            .where(and(
              eq(passwordResetChallenges.userId, identity.user.id),
              eq(passwordResetChallenges.schoolId, schoolId),
              isNull(passwordResetChallenges.consumedAt),
            ));
          await this.invalidateUserSessionsInTransaction(tx, identity.user.id);
        }
      }

      const [updated] = await tx.update(teachers)
        .set(setData)
        .where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)))
        .returning();
      return updated;
    });
  }

  async getTeachersPaginated(schoolId: number, opts: { q?: string; page?: number }): Promise<{ data: (Teacher & { email: string })[]; total: number }> {
    const { q, page = 1 } = opts;
    const limit = 20;
    const offset = (page - 1) * limit;
    const baseConditions = [eq(teachers.schoolId, schoolId), eq(users.isActive, true)];
    if (q) {
      baseConditions.push(or(
        ilike(teachers.fullName, `%${q}%`),
        ilike(teachers.subject, `%${q}%`),
        ilike(users.email, `%${q}%`)
      )!);
    }
    const [{ total }] = await db.select({ total: count() }).from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(and(...baseConditions));
    const rows = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(and(...baseConditions)).orderBy(teachers.fullName).limit(limit).offset(offset);
    return { data: rows.map(r => ({ ...r.teachers, email: r.users.email })), total: Number(total) };
  }

  // ===== DEACTIVATED STUDENT HISTORY =====
  async getDeactivatedStudents(schoolId: number): Promise<Array<{
    id: number; digitalStudentId: string; name: string; class: string; section: string;
    phone: string; email: string | null; gender: string | null; guardianName: string | null;
    dob: string | null; enrollmentDate: string | null; bloodGroup: string | null;
    rollNumber: number | null;
    deactivatedAt: Date | null; deactivationReason: string | null;
    batchYear: string | null; comments: string | null;
    fatherName: string | null; motherName: string | null;
    address: string | null; aadharNumber: string | null;
  }>> {
    const result = await pool.query<{
      id: number; digital_student_id: string; name: string; class: string; section: string;
      phone: string; email: string | null; gender: string | null; guardian_name: string | null;
      dob: string | null; enrollment_date: string | null; blood_group: string | null;
      roll_number: number | null; deactivated_at: Date | null; deactivation_reason: string | null;
      father_name: string | null; mother_name: string | null;
      address: string | null; aadhar_number: string | null;
    }>(
      `WITH best_log AS (
         SELECT DISTINCT ON (s.id)
           s.id AS student_id,
           a.created_at,
           a.details,
           -- prefer individual 'deactivate' logs over bulk ones
           (a.action_type = 'deactivate') AS is_individual
         FROM students s
         LEFT JOIN audit_logs a ON (
           a.school_id = $1
           AND a.entity_type = 'student'
           AND (
             (a.action_type = 'deactivate' AND a.entity_id = s.id)
             OR
             (a.action_type = 'bulk_deactivate'
              AND SUBSTRING(a.details FROM 'IDs:[[:space:]]*(([[:digit:]]|,)+)')
                  ~ (E'(^|,)' || s.id::text || E'(,|$)'))
           )
         )
         WHERE s.school_id = $1 AND s.is_active = false
         ORDER BY s.id,
                  (a.id IS NOT NULL) DESC,
                  (a.action_type = 'deactivate') DESC,
                  a.created_at DESC NULLS LAST
       )
       SELECT s.id, s.digital_student_id, s.name, s.class, s.section, s.phone, s.email,
              s.gender, s.guardian_name, s.dob, s.enrollment_date, s.blood_group, s.roll_number,
              s.father_name, s.mother_name, s.address, s.aadhar_number,
              bl.created_at AS deactivated_at, bl.details AS deactivation_reason
       FROM students s
       LEFT JOIN best_log bl ON bl.student_id = s.id
       WHERE s.school_id = $1 AND s.is_active = false
       ORDER BY bl.created_at DESC NULLS LAST`,
      [schoolId]
    );
    return result.rows.map(r => {
      const details = r.deactivation_reason ?? "";
      const batchMatch = details.match(/Batch:\s*(\d{4}-\d{4})/);
      // Extract comments; strip trailing ". IDs: ..." that appears in bulk logs
      const rawComments = details.match(/Comments:\s*(.+)/)?.[1] ?? null;
      const comments = rawComments ? rawComments.replace(/\.\s*IDs:.*$/i, "").trim() : null;
      return {
        id: r.id,
        digitalStudentId: r.digital_student_id,
        name: r.name,
        class: r.class,
        section: r.section,
        phone: r.phone,
        email: r.email ?? null,
        gender: r.gender,
        guardianName: r.guardian_name,
        dob: r.dob,
        enrollmentDate: r.enrollment_date,
        bloodGroup: r.blood_group,
        rollNumber: r.roll_number,
        deactivatedAt: r.deactivated_at,
        deactivationReason: r.deactivation_reason,
        batchYear: batchMatch ? batchMatch[1] : null,
        comments,
        fatherName:   r.father_name   ?? null,
        motherName:   r.mother_name   ?? null,
        address:      r.address       ?? null,
        aadharNumber: r.aadhar_number ?? null,
      };
    });
  }

  // ===== DEACTIVATION (Soft Delete) =====
  async deactivateStudent(studentId: number, schoolId: number): Promise<Student> {
    const [s] = await db.update(students).set({ isActive: false }).where(and(eq(students.id, studentId), eq(students.schoolId, schoolId))).returning();
    return s;
  }

  async verifyAdminPassword(userId: number, password: string): Promise<boolean> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return false;
    const bcrypt = await import("bcryptjs");
    return bcrypt.compare(password, user.passwordHash);
  }

  async getStudentCountBySchoolActive(schoolId: number): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.isActive, true)));
    return result?.value ?? 0;
  }

  async getActiveStudentCountsBySchools(): Promise<Record<number, number>> {
    const rows = await db
      .select({ schoolId: students.schoolId, value: count() })
      .from(students)
      .where(eq(students.isActive, true))
      .groupBy(students.schoolId);
    return Object.fromEntries(rows.map(r => [r.schoolId, Number(r.value)]));
  }

  // ===== DAILY ATTENDANCE SUMMARY =====
  async getDailyAttendanceSummary(schoolId: number, sessionId: number, date: string): Promise<{
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
  }> {
    const records = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.date, date),
    ));
    const classSections = new Map<string, { class: string; section: string }>();
    for (const record of records) {
      if (record.class && record.section) {
        classSections.set(`${record.class}\u0000${record.section}`, {
          class: record.class,
          section: record.section,
        });
      }
    }

    const statuses: Array<string | null> = [];
    // A Student can have a session roster placement in one class and a
    // historical mark in another. Count the dated mark once, in its saved
    // class, rather than adding a second "missing" entry from the roster.
    const markedIdentityKeys = new Set(records.map(record => record.identityKey));
    for (const context of classSections.values()) {
      const workingDates = await getStudentAttendanceWorkingDates({
        schoolId,
        sessionId,
        class: context.class,
        section: context.section,
        startDate: date,
        endDate: date,
      });
      if (workingDates.length === 0) continue;

      const roster = await this.getAttendanceReportRosterForSessionClass(
        schoolId, sessionId, context.class, context.section,
      );
      const statusByIdentity = new Map(
        records
          .filter(record =>
            record.class === context.class && record.section === context.section
          )
          .map(record => [record.identityKey, record.status]),
      );
      statuses.push(...roster
        .filter(student => statusByIdentity.has(student.identityKey) || !markedIdentityKeys.has(student.identityKey))
        .map(student => statusByIdentity.get(student.identityKey) ?? null));
    }

    const aggregation = aggregateStudentAttendance({
      schoolId,
      sessionId,
      statuses,
    });
    return {
      total: records.length,
      applicableTotal: aggregation.applicableWorkingDays,
      present: aggregation.present,
      absent: aggregation.absent,
      leave: aggregation.leave,
      late: aggregation.late,
      halfDay: aggregation.halfDay,
      missing: aggregation.missing,
      unknown: aggregation.unknown,
      percentage: aggregation.percentage,
    };
  }

  // Web Admin Dashboard only; keep getDailyAttendanceSummary unchanged for
  // existing Mobile and other consumers.
  async getWebDailyAttendanceSummary(schoolId: number, sessionId: number, date: string) {
    const enrollmentRows = await db
      .select({ student: students, enrollment: enrollments })
      .from(enrollments)
      .innerJoin(students, and(
        eq(students.id, enrollments.studentId),
        eq(students.schoolId, enrollments.schoolId),
      ))
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(students.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.status, "Active"),
        eq(students.isActive, true),
      ));

    const eligibleStudentIds = [...new Set(enrollmentRows
      .filter(({ student, enrollment }) => isEligibleForLiveStudentAttendance(
        student,
        enrollment,
        {
          schoolId,
          sessionId,
          className: enrollment.className,
          sectionName: enrollment.sectionName,
        },
      ))
      .map(({ student }) => student.id))];

    const records = eligibleStudentIds.length === 0
      ? []
      : await db
        .select({
          studentId: attendanceRecords.studentId,
          status: attendanceRecords.status,
        })
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.schoolId, schoolId),
          eq(attendanceRecords.sessionId, sessionId),
          eq(attendanceRecords.date, date),
          inArray(attendanceRecords.studentId, eligibleStudentIds),
        ))
        .orderBy(desc(attendanceRecords.markedAt));

    return summarizeWebDailyPresence({
      schoolId,
      sessionId,
      eligibleStudentIds,
      records,
    });
  }

  // ===== AUDIT LOGS READER =====
  async getAuditLogsBySchool(schoolId: number, limit = 100, sessionId?: number | null): Promise<AuditLog[]> {
    const conditions: any[] = [eq(auditLogs.schoolId, schoolId)];
    if (sessionId != null) conditions.push(eq(auditLogs.sessionId, sessionId));
    return db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }

  // ===== STUDENT LEAVES FOR ADMIN (forwarded_to_admin only — teacher tier stays hidden) =====
  async getStudentLeavesForAdmin(schoolId: number, sessionId?: number | null): Promise<(StudentLeaveRequest & { studentName: string; dsid: string; class: string; section: string; forwardedByTeacherName: string | null })[]> {
    const conditions: any[] = [eq(studentLeaveRequests.schoolId, schoolId), eq(studentLeaveRequests.status, "forwarded_to_admin")];
    if (sessionId != null) conditions.push(eq(studentLeaveRequests.sessionId, sessionId));
    const leaves = await db.select().from(studentLeaveRequests).where(
      and(...conditions)
    ).orderBy(desc(studentLeaveRequests.createdAt));
    const result = [];
    for (const l of leaves) {
      const s = await this.getStudentById(l.studentId);
      let forwardedByTeacherName: string | null = null;
      if (l.reviewedBy && l.reviewerRole === "teacher") {
        const t = await this.getTeacherById(l.reviewedBy);
        forwardedByTeacherName = t?.fullName ?? null;
      }
      result.push({ ...l, studentName: s?.name ?? "Unknown", dsid: s?.digitalStudentId ?? "", class: s?.class ?? "", section: s?.section ?? "", forwardedByTeacherName });
    }
    return result;
  }

  // ===== APPROVAL HISTORY =====
  async getApprovalHistory(schoolId: number, sessionId?: number | null) {
    // 1. Teacher Leave history — scoped to the viewed session when provided
    const tLeaveConditions = [eq(leaveRequests.schoolId, schoolId), inArray(leaveRequests.status, ["approved", "rejected"])] as any[];
    if (sessionId != null) tLeaveConditions.push(eq(leaveRequests.sessionId, sessionId));
    const tLeaves = await db.select().from(leaveRequests)
      .where(and(...tLeaveConditions))
      .orderBy(desc(leaveRequests.createdAt)).limit(100);
    const teacherLeaveHistory = await Promise.all(tLeaves.map(async l => {
      const t = await this.getTeacherById(l.teacherId);
      return { ...l, teacherName: t?.fullName ?? "Unknown" };
    }));

    // 2. Student Leave history (admin-actioned only) — scoped to session when provided
    const sLeaveConditions = [
      eq(studentLeaveRequests.schoolId, schoolId),
      inArray(studentLeaveRequests.reviewerRole, ["admin", "support_staff"]),
      inArray(studentLeaveRequests.status, ["approved", "rejected"]),
    ] as any[];
    if (sessionId != null) sLeaveConditions.push(eq(studentLeaveRequests.sessionId, sessionId));
    const sLeaves = await db.select().from(studentLeaveRequests)
      .where(and(...sLeaveConditions))
      .orderBy(desc(studentLeaveRequests.createdAt)).limit(100);
    const studentLeaveHistory = await Promise.all(sLeaves.map(async l => {
      const s = await this.getStudentById(l.studentId);
      return { ...l, studentName: s?.name ?? "Unknown", dsid: s?.digitalStudentId ?? "", class: s?.class ?? "", section: s?.section ?? "" };
    }));

    // 3. Gallery history (approved items only — no rejected state in schema)
    const gallery = await db.select().from(galleryItems)
      .where(and(eq(galleryItems.schoolId, schoolId), eq(galleryItems.approved, true)))
      .orderBy(desc(galleryItems.createdAt)).limit(100);
    const galleryHistory = await Promise.all(gallery.map(async g => {
      if (g.uploaderRole === "teacher") {
        const teacher = await this.getTeacherById(g.uploadedById);
        return { ...g, uploaderName: teacher?.fullName ?? "Unknown" };
      }
      if (g.uploaderRole === "support_staff") {
        const staff = await this.getNonTeachingStaffById(g.uploadedById);
        return {
          ...g,
          uploaderName: staff?.schoolId === schoolId ? staff.fullName : "Support Staff",
        };
      }
      return { ...g, uploaderName: "Unknown" };
    }));

    // 4. Ebook history (approved or rejected)
    const ebooks = await db.select().from(libraryBooks)
      .where(and(eq(libraryBooks.schoolId, schoolId), inArray(libraryBooks.verificationStatus, ["approved", "rejected"])))
      .orderBy(desc(libraryBooks.id)).limit(100);
    const supportEbookUploads = await db.select({
      entityId: auditLogs.entityId,
      actionBy: auditLogs.actionBy,
    }).from(auditLogs).where(and(
      eq(auditLogs.schoolId, schoolId),
      eq(auditLogs.actionType, "upload"),
      eq(auditLogs.entityType, "ebook"),
      eq(auditLogs.actionByRole, "support_staff"),
    ));
    const supportEbookUploadById = new Map(
      supportEbookUploads
        .filter(log => log.entityId !== null && log.actionBy !== null)
        .map(log => [log.entityId!, log.actionBy!]),
    );
    const ebookHistory = await Promise.all(ebooks.map(async b => {
      const t = b.uploadedById ? await this.getTeacherById(b.uploadedById) : null;
      if (t) return { ...b, uploaderName: t.fullName };
      const staffId = supportEbookUploadById.get(b.id);
      if (staffId !== undefined) {
        const staff = await this.getNonTeachingStaffById(staffId);
        return {
          ...b,
          uploaderName: staff?.schoolId === schoolId ? staff.fullName : "Support Staff",
        };
      }
      return { ...b, uploaderName: "Unknown" };
    }));

    return { teacherLeaves: teacherLeaveHistory, studentLeaves: studentLeaveHistory, gallery: galleryHistory, ebooks: ebookHistory };
  }

  // ===== VISITOR LOGS =====
  async createVisitorLog(data: InsertVisitorLog): Promise<VisitorLog> {
    const [v] = await db.insert(visitorLogs).values(data).returning();
    return v;
  }

  async getVisitorLogsBySchool(schoolId: number, sessionId?: number | null): Promise<VisitorLog[]> {
    const conditions = [eq(visitorLogs.schoolId, schoolId)];
    if (sessionId != null) conditions.push(eq(visitorLogs.sessionId, sessionId));
    return db.select().from(visitorLogs).where(and(...conditions)).orderBy(desc(visitorLogs.createdAt)).limit(200);
  }

  async checkoutVisitor(id: number): Promise<VisitorLog> {
    const [v] = await db.update(visitorLogs).set({ checkOut: new Date() }).where(eq(visitorLogs.id, id)).returning();
    return v;
  }

  // ===== PENDING EBOOKS FOR APPROVAL =====
  async getPendingEbooks(schoolId: number): Promise<LibraryBook[]> {
    return db.select().from(libraryBooks).where(and(eq(libraryBooks.schoolId, schoolId), eq(libraryBooks.verificationStatus, "pending")));
  }

  // ===== EXAM SCORES AGGREGATION FOR ANALYTICS =====
  async getExamScoresBySchool(schoolId: number, sessionId?: number | null): Promise<ExamScore[]> {
    const conditions: any[] = [eq(examScores.schoolId, schoolId)];
    if (sessionId != null) conditions.push(eq(examScores.sessionId, sessionId));
    return db.select().from(examScores).where(and(...conditions)).orderBy(desc(examScores.createdAt)).limit(500);
  }

  // ===== STUDENT PROFILES =====
  async getStudentProfile(studentId: number): Promise<StudentProfile | undefined> {
    const [profile] = await db.select().from(studentProfiles).where(eq(studentProfiles.studentId, studentId));
    return profile || undefined;
  }

  async upsertStudentProfile(
    data: Omit<InsertStudentProfile, "status" | "submittedAt" | "verifiedAt" | "verifiedBy" | "rejectionNote">,
    statusOverride?: string,
  ): Promise<StudentProfile> {
    const existing = await this.getStudentProfile(data.studentId);
    if (existing) {
      const setData: Record<string, unknown> = { ...data, updatedAt: new Date() };
      if (statusOverride) setData.status = statusOverride;
      const [updated] = await db
        .update(studentProfiles)
        .set(setData as Partial<InsertStudentProfile>)
        .where(eq(studentProfiles.studentId, data.studentId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(studentProfiles)
        .values({ ...data, status: "draft", photoStatus: "none" })
        .returning();
      return created;
    }
  }

  async submitStudentProfile(studentId: number): Promise<StudentProfile> {
    const [updated] = await db
      .update(studentProfiles)
      .set({ status: "pending", submittedAt: new Date(), updatedAt: new Date(), rejectionNote: null })
      .where(eq(studentProfiles.studentId, studentId))
      .returning();
    return updated;
  }

  async updateStudentProfilePhoto(studentId: number, photoUrl: string): Promise<StudentProfile> {
    const existing = await this.getStudentProfile(studentId);
    if (!existing) {
      const student = await this.getStudentById(studentId);
      if (!student) throw new Error("Student not found");
      const [created] = await db
        .insert(studentProfiles)
        .values({ studentId, schoolId: student.schoolId, status: "draft", photoUrl, photoStatus: "pending" })
        .returning();
      return created;
    }
    const resetFields: Record<string, unknown> = { photoUrl, photoStatus: "pending", updatedAt: new Date() };
    if (existing && existing.status === "approved") {
      resetFields.status = "draft";
      resetFields.verifiedAt = null;
      resetFields.verifiedBy = null;
    }
    const [updated] = await db
      .update(studentProfiles)
      .set(resetFields as Partial<typeof studentProfiles.$inferInsert>)
      .where(eq(studentProfiles.studentId, studentId))
      .returning();
    return updated;
  }

  async getPendingProfilesForTeacher(
    schoolId: number,
    teacherIdOrPrimaryClass: string | number,
    primarySection?: string,
    sessionId?: number | null,
  ): Promise<(StudentProfile & { studentName: string; dsid: string; currentVerifiedProfile: string | null })[]> {
    // Approval reads are always tied to an explicitly selected session. Do not
    // fall back to current Student placement for legacy or incomplete callers.
    if (typeof sessionId !== "number" || !Number.isSafeInteger(sessionId) || sessionId <= 0) return [];

    // Build the full set of class-sections this teacher covers.
    // Accepts either (schoolId, teacherId) or legacy (schoolId, cls, section).
    const assignments: Array<{ cls: string; sec: string }> = [];

    if (typeof teacherIdOrPrimaryClass === "number") {
      // New path: resolve via teacher record + faculty_mappings
      const [teacherRecord, mappings] = await Promise.all([
        this.getTeacherById(teacherIdOrPrimaryClass),
        this.getFacultyMappingsByTeacher(teacherIdOrPrimaryClass),
      ]);
      if (!teacherRecord || teacherRecord.schoolId !== schoolId) return [];
      if (teacherRecord?.assignedClass && teacherRecord?.assignedSection) {
        assignments.push({ cls: teacherRecord.assignedClass, sec: teacherRecord.assignedSection });
      }
      for (const m of mappings) {
        if (!assignments.some(a => a.cls === m.className && a.sec === m.section)) {
          assignments.push({ cls: m.className, sec: m.section });
        }
      }
    } else {
      // Legacy path: caller passes cls+section strings directly
      const cls = teacherIdOrPrimaryClass;
      const sec = primarySection ?? "";
      if (cls) assignments.push({ cls, sec });
    }

    if (assignments.length === 0) return [];

    // Pre-fetch students from exact selected-session enrollments.
    const allowedStudentIds = new Set<number>();
    for (const { cls, sec } of assignments) {
      const list = await this.getStudentsByClassSectionInSession(schoolId, cls, sec, sessionId);
      list.forEach(s => allowedStudentIds.add(s.id));
    }
    if (allowedStudentIds.size === 0) return [];

    const allPending = await db
      .select()
      .from(studentProfiles)
      .where(and(
        eq(studentProfiles.schoolId, schoolId),
        or(
          eq(studentProfiles.status, "pending"),        // full profile submitted
          eq(studentProfiles.photoStatus, "pending"),   // photo-only upload awaiting review
        ),
      ))
      .orderBy(desc(studentProfiles.updatedAt));

    const result = [];
    for (const p of allPending) {
      if (!allowedStudentIds.has(p.studentId)) continue;
      const [student, enrollment] = await Promise.all([
        this.getStudentById(p.studentId),
        this.resolveEnrollmentForStudentSession(schoolId, p.studentId, sessionId),
      ]);
      if (!student || student.schoolId !== schoolId || !enrollment) continue;
      result.push({
        ...p,
        studentName: student.name,
        dsid: student.digitalStudentId,
        currentVerifiedProfile: student.verifiedProfile || null,
        class: enrollment.className,
        section: enrollment.sectionName,
        rollNo: enrollment.rollNo === null ? null : String(enrollment.rollNo),
      });
    }
    return result;
  }

  async bulkApproveStudentProfiles(
    studentIds: number[],
    teacherId: number,
    schoolId: number,
    sessionId: number,
  ): Promise<{ approved: number; skipped: number }> {
    const teacherRecord = await this.getTeacherById(teacherId);
    if (!teacherRecord || teacherRecord.schoolId !== schoolId
      || !Number.isSafeInteger(sessionId) || sessionId <= 0) {
      return { approved: 0, skipped: studentIds.length };
    }
    const mappings = await this.getFacultyMappingsByTeacher(teacherId);
    const assignments = [
      ...(teacherRecord.assignedClass && teacherRecord.assignedSection
        ? [{ className: teacherRecord.assignedClass, section: teacherRecord.assignedSection }]
        : []),
      ...mappings.map(({ className, section }) => ({ className, section })),
    ];
    const approverName = teacherRecord.fullName ?? "Teacher";
    const eligible: {
      studentId: number;
      snapshot: string;
      profile: StudentProfile;
    }[] = [];
    const photoUpdates: { studentId: number; photoUrl: string }[] = [];

    for (const studentId of studentIds) {
      const [existing, enrollment] = await Promise.all([
        this.getStudentProfile(studentId),
        this.resolveEnrollmentForStudentSession(schoolId, studentId, sessionId),
      ]);
      if (!existing || existing.schoolId !== schoolId || !enrollment
        || !assignments.some((assignment) =>
          assignment.className === enrollment.className && assignment.section === enrollment.sectionName,
        )) continue;
      // Accept full-profile pending OR photo-only pending
      if (existing.status !== "pending" && existing.photoStatus !== "pending") continue;
      const snap = JSON.stringify({
        fullName: existing.fullName, class: enrollment.className, section: enrollment.sectionName,
        rollNo: enrollment.rollNo === null ? null : String(enrollment.rollNo),
        fatherName: existing.fatherName, motherName: existing.motherName,
        presentAddress: existing.presentAddress, aadharNumber: existing.aadharNumber,
        gender: existing.gender, phone: existing.phone, dob: existing.dob,
        enrollmentDate: existing.enrollmentDate, guardianName: existing.guardianName,
        bloodGroup: existing.bloodGroup, photoUrl: existing.photoUrl, approvedAt: new Date().toISOString(),
      });
      eligible.push({ studentId, snapshot: snap, profile: existing });
      if (existing.photoUrl) photoUpdates.push({ studentId, photoUrl: existing.photoUrl });
    }

    const skipped = studentIds.length - eligible.length;

    if (eligible.length === 0) return { approved: 0, skipped };

    await db.transaction(async (tx) => {
      const now = new Date();
      for (const { studentId, snapshot, profile } of eligible) {
        // For photo-only pending (status = draft), only approve the photo — do not flip overall status
        const isPhotoOnly = profile.status !== "pending" && profile.photoStatus === "pending";
        await tx.update(studentProfiles).set({
          ...(isPhotoOnly
            ? { photoStatus: "approved" }
            : {
                status: "approved",
                approvedSnapshot: snapshot,
                verifiedAt: now,
                verifiedBy: teacherId,
                photoStatus: "approved",
              }),
          updatedAt: now,
        }).where(and(
          eq(studentProfiles.studentId, studentId),
          eq(studentProfiles.schoolId, schoolId),
          isPhotoOnly
            ? and(eq(studentProfiles.status, profile.status), eq(studentProfiles.photoStatus, "pending"))!
            : eq(studentProfiles.status, "pending"),
        ));

        // Only write a new verifiedProfile snapshot for full-profile approvals
        if (!isPhotoOnly) {
          const verifiedJson = JSON.stringify({
            ...JSON.parse(snapshot),
            verifiedAt: now.toISOString(),
            approvedByName: approverName,
          });
          await tx.update(students).set({ verifiedProfile: verifiedJson }).where(and(
            eq(students.id, studentId),
            eq(students.schoolId, schoolId),
          ));
        }
      }
      for (const { studentId, photoUrl } of photoUpdates) {
        await tx.update(students).set({ photoUrl }).where(and(
          eq(students.id, studentId),
          eq(students.schoolId, schoolId),
        ));
      }
    });

    return { approved: eligible.length, skipped };
  }

  async approveStudentProfile(
    studentId: number,
    teacherId: number,
    schoolId: number,
    sessionId: number,
  ): Promise<StudentProfile | undefined> {
    const [existing, enrollment] = await Promise.all([
      db.select().from(studentProfiles).where(and(
        eq(studentProfiles.studentId, studentId),
        eq(studentProfiles.schoolId, schoolId),
      )).then((rows) => rows[0]),
      this.resolveEnrollmentForStudentSession(schoolId, studentId, sessionId),
    ]);
    if (!existing || !enrollment) throw new Error("Student profile is unavailable in the selected session");
    if (existing.status !== "pending" && existing.photoStatus !== "pending") {
      throw new Error("Profile is not pending approval");
    }

    // Photo-only approval: profile is still draft/rejected but a new photo is pending
    if (existing.status !== "pending" && existing.photoStatus === "pending") {
      const [updated] = await db
        .update(studentProfiles)
        .set({ photoStatus: "approved", updatedAt: new Date() })
        .where(and(
          eq(studentProfiles.studentId, studentId),
          eq(studentProfiles.schoolId, schoolId),
          eq(studentProfiles.status, existing.status),
          eq(studentProfiles.photoStatus, "pending"),
        ))
        .returning();
      // Propagate the approved photo to the live students record immediately
      if (existing.photoUrl) {
        await db.update(students).set({ photoUrl: existing.photoUrl }).where(and(
          eq(students.id, studentId),
          eq(students.schoolId, schoolId),
        ));
      }
      return updated;
    }

    // Full profile approval
    const snapshot = existing
      ? JSON.stringify({
          fullName:       existing.fullName,
          class:          enrollment.className,
          section:        enrollment.sectionName,
          rollNo:         enrollment.rollNo === null ? null : String(enrollment.rollNo),
          fatherName:     existing.fatherName,
          motherName:     existing.motherName,
          presentAddress: existing.presentAddress,
          aadharNumber:   existing.aadharNumber,
          gender:         existing.gender,
          phone:          existing.phone,
          dob:            existing.dob,
          enrollmentDate: existing.enrollmentDate,
          guardianName:   existing.guardianName,
          bloodGroup:     existing.bloodGroup,
          photoUrl:       existing.photoUrl,
          approvedAt:     new Date().toISOString(),
        })
      : null;
    const [updated] = await db
      .update(studentProfiles)
      .set({
        status: "approved",
        verifiedAt: new Date(),
        verifiedBy: teacherId,
        photoStatus: "approved",
        approvedSnapshot: snapshot,
        updatedAt: new Date(),
      })
      .where(and(
        eq(studentProfiles.studentId, studentId),
        eq(studentProfiles.schoolId, schoolId),
        eq(studentProfiles.status, "pending"),
      ))
      .returning();
    return updated;
  }

  async rejectStudentProfile(
    studentId: number,
    teacherId: number,
    note: string,
    schoolId: number,
    sessionId: number,
  ): Promise<StudentProfile | undefined> {
    const [existing, enrollment] = await Promise.all([
      db.select().from(studentProfiles).where(and(
        eq(studentProfiles.studentId, studentId),
        eq(studentProfiles.schoolId, schoolId),
      )).then((rows) => rows[0]),
      this.resolveEnrollmentForStudentSession(schoolId, studentId, sessionId),
    ]);
    if (!existing || !enrollment
      || (existing.status !== "pending" && existing.photoStatus !== "pending")) {
      throw new Error("Student profile is unavailable for review in the selected session");
    }
    const photoOnly = existing.status !== "pending" && existing.photoStatus === "pending";
    const [updated] = await db
      .update(studentProfiles)
      .set(photoOnly
        ? { photoStatus: "rejected", updatedAt: new Date() }
        : {
            status: "rejected",
            photoStatus: existing.photoStatus === "pending" ? "rejected" : existing.photoStatus,
            verifiedAt: new Date(),
            verifiedBy: teacherId,
            rejectionNote: note,
            updatedAt: new Date(),
          })
      .where(and(
        eq(studentProfiles.studentId, studentId),
        eq(studentProfiles.schoolId, schoolId),
        photoOnly
          ? and(eq(studentProfiles.status, existing.status), eq(studentProfiles.photoStatus, "pending"))!
          : eq(studentProfiles.status, "pending"),
      ))
      .returning();
    return updated;
  }

  async getTeacherApprovalHistory(
    teacherId: number,
    schoolId: number,
    sessionId: number,
  ): Promise<(StudentProfile & { studentName: string; dsid: string; class: string; section: string })[]> {
    const [sess, teacher, mappings] = await Promise.all([
      this.getAcademicSessionForSchool(sessionId, schoolId),
      this.getTeacherById(teacherId),
      this.getFacultyMappingsByTeacher(teacherId),
    ]);
    if (!sess || !teacher || teacher.schoolId !== schoolId) return [];
    const startDate = new Date(sess.startDate + "T00:00:00");
    const endDate = new Date(sess.endDate + "T23:59:59");
    const assignments = [
      ...(teacher.assignedClass && teacher.assignedSection
        ? [{ className: teacher.assignedClass, section: teacher.assignedSection }]
        : []),
      ...mappings.map(({ className, section }) => ({ className, section })),
    ];

    const conditions = [
      eq(studentProfiles.schoolId, schoolId),
      eq(studentProfiles.verifiedBy, teacherId),
      eq(studentProfiles.status, "approved"),
    ] as SQL[];
    conditions.push(gte(studentProfiles.verifiedAt, startDate) as SQL);
    conditions.push(lte(studentProfiles.verifiedAt, endDate) as SQL);

    const approved = await db
      .select()
      .from(studentProfiles)
      .where(and(...conditions))
      .orderBy(desc(studentProfiles.verifiedAt));

    const result = [];
    for (const p of approved) {
      const [student, enrollment] = await Promise.all([
        this.getStudentById(p.studentId),
        this.resolveEnrollmentForStudentSession(schoolId, p.studentId, sessionId),
      ]);
      if (!student || student.schoolId !== schoolId || !enrollment
        || !assignments.some((assignment) =>
          assignment.className === enrollment.className && assignment.section === enrollment.sectionName,
        )) continue;
      result.push({
        ...p,
        studentName: student.name,
        dsid: student.digitalStudentId,
        class: enrollment.className,
        section: enrollment.sectionName,
        rollNo: enrollment.rollNo === null ? null : String(enrollment.rollNo),
      });
    }
    return result;
  }

  async updateStudentPassword(studentId: number, passwordHash: string): Promise<void> {
    await db.update(students).set({ passwordHash }).where(eq(students.id, studentId));
  }

  async getPendingProfilesCountForTeacher(schoolId: number, teacherId: number, sessionId: number): Promise<number> {
    const profiles = await this.getPendingProfilesForTeacher(schoolId, teacherId, undefined, sessionId);
    return profiles.length;
  }

  // ===== STUDENT ATTENDANCE (Student-Facing) =====

  async getStudentMonthlyAttendance(studentId: number, schoolId: number, sessionId: number, year: number, month: number): Promise<{
    date: string;
    dayOfWeek: number;
    status: string;
    teacherId: number | null;
    markedBy: string | null;
    isHoliday: boolean;
    holidayName: string | null;
    isApprovedLeave: boolean;
    isSunday: boolean;
    isFuture: boolean;
    isInSession: boolean;
  }[]> {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const today = todayInIST();
    const session = await this.getAcademicSessionById(sessionId);
    if (!session || session.schoolId !== schoolId) {
      throw new Error("Invalid Academic Session for Student monthly Attendance");
    }
    const studentClassSection = await this.resolveAttendanceClassSectionForStudent(schoolId, sessionId, studentId);
    const holidayAudience = studentClassSection
      ? buildCalendarAudienceFilter([{ cls: studentClassSection.class, sec: studentClassSection.section }])!
      : eq(calendarEvents.audienceScope, "All_School");

    const records = await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
        eq(attendanceRecords.studentId, studentId),
        gte(attendanceRecords.date, startDate),
        lte(attendanceRecords.date, endDate)
      )
    );

    const holidays = await db.select().from(calendarEvents).where(
      and(
        eq(calendarEvents.schoolId, schoolId),
        eq(calendarEvents.eventType, "holiday"),
        holidayAudience,
        gte(calendarEvents.date, startDate),
        lte(calendarEvents.date, endDate)
      )
    );

    const leaves = await db.select().from(studentLeaveRequests).where(
      and(
        eq(studentLeaveRequests.schoolId, schoolId),
        eq(studentLeaveRequests.sessionId, sessionId),
        eq(studentLeaveRequests.studentId, studentId),
        eq(studentLeaveRequests.status, "approved"),
        lte(studentLeaveRequests.startDate, endDate),
        gte(studentLeaveRequests.endDate, startDate)
      )
    );

    const result = [];
    for (let day = 1; day <= lastDay; day++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const isInSession = isAttendanceDateInSession(dateStr, session);
      const dayOfWeek = calendarWeekday(dateStr)!;
      const isSunday = dayOfWeek === 0;
      const isFuture = dateStr > today;

      const record = isInSession ? records.find(r => r.date === dateStr) : undefined;
      const holiday = isInSession ? holidays.find(h => h.date === dateStr) : undefined;
      const isApprovedLeave = isInSession && leaves.some(l => l.startDate <= dateStr && l.endDate >= dateStr);

      result.push({
        date: dateStr,
        dayOfWeek,
        status: record?.status || "none",
        teacherId: record?.teacherId ?? null,
        markedBy: record?.markedBy || null,
        isHoliday: !!holiday,
        holidayName: holiday?.title || null,
        isApprovedLeave,
        isSunday,
        isFuture,
        isInSession,
      });
    }

    return result;
  }

  async getStudentYearlyAttendance(studentId: number, schoolId: number, sessionId: number, cls: string | null, section: string | null, startDate: string, endDate: string): Promise<{
    month: number;
    year: number;
    present: number;
    absent: number;
    halfDay: number;
    late: number;
    leave: number;
    workingDays: number;
    total: number;
  }[]> {
    const myRecordConditions = [
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.studentId, studentId),
      gte(attendanceRecords.date, startDate),
      lte(attendanceRecords.date, endDate),
    ];
    if (cls && section) {
      myRecordConditions.push(
        eq(attendanceRecords.class, cls),
        eq(attendanceRecords.section, section),
      );
    }
    const myRecords = await db.select().from(attendanceRecords).where(
      and(...myRecordConditions),
    );

    // Applicable dates require selected-Session historical class/section context.
    // Raw legacy rows remain readable, but cannot define a class-specific denominator.
    const workingDates = cls && section
      ? await getStudentAttendanceWorkingDates({
          schoolId, sessionId, class: cls, section, startDate, endDate,
        })
      : [];
    const recordMap = new Map(myRecords.map(r => [r.date, r]));

    const monthMap = new Map<string, { month: number; year: number; present: number; absent: number; halfDay: number; late: number; leave: number; workingDays: number; total: number }>();

    for (const dateStr of workingDates) {
      const parts = dateOnlyParts(dateStr);
      if (!parts) continue;
      const { year, month } = parts;
      const key = `${year}-${month}`;
      if (!monthMap.has(key)) {
        monthMap.set(key, { month, year, present: 0, absent: 0, halfDay: 0, late: 0, leave: 0, workingDays: 0, total: 0 });
      }
      const bucket = monthMap.get(key)!;
      bucket.workingDays++;
      bucket.total++;
      const aggregation = aggregateStudentAttendance({
        schoolId,
        sessionId,
        statuses: [recordMap.get(dateStr)?.status ?? null],
      });
      bucket.present += aggregation.present;
      bucket.absent += aggregation.absent;
      bucket.halfDay += aggregation.halfDay;
      bucket.late += aggregation.late;
      bucket.leave += aggregation.leave;
    }

    return Array.from(monthMap.values()).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  }

  async getStudentAttendanceStats(studentId: number, schoolId: number, sessionId: number, cls: string | null, section: string | null, academicStartDate: string, academicEndDate?: string): Promise<{
    overallPercent: number;
    workingDays: number;
    daysPresent: number;
    totalPresent: number;
    totalAbsent: number;
    totalHalfDay: number;
    totalLate: number;
    totalLeave: number;
  }> {
    const today = todayInIST();
    const upperBound = academicEndDate && academicEndDate < today ? academicEndDate : today;

    const myRecordConditions = [
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.studentId, studentId),
      gte(attendanceRecords.date, academicStartDate),
      lte(attendanceRecords.date, upperBound),
    ];
    if (cls && section) {
      myRecordConditions.push(
        eq(attendanceRecords.class, cls),
        eq(attendanceRecords.section, section),
      );
    }
    const myRecords = await db.select().from(attendanceRecords).where(
      and(...myRecordConditions),
    );

    // Applicable dates require selected-Session historical class/section context.
    // Raw legacy rows remain readable, but cannot define a class-specific denominator.
    const workingDates = cls && section
      ? await getStudentAttendanceWorkingDates({
          schoolId,
          sessionId,
          class: cls,
          section,
          startDate: academicStartDate,
          endDate: upperBound,
        })
      : [];
    const recordByDate = new Map(myRecords.map(record => [record.date, record]));
    const aggregation = aggregateStudentAttendance({
      schoolId,
      sessionId,
      statuses: workingDates.map(date => recordByDate.get(date)?.status ?? null),
    });

    return {
      overallPercent: aggregation.percentage,
      workingDays: aggregation.applicableWorkingDays,
      daysPresent: aggregation.weightedAttendance,
      totalPresent: aggregation.present,
      totalAbsent: aggregation.absent,
      totalHalfDay: aggregation.halfDay,
      totalLate: aggregation.late,
      totalLeave: aggregation.leave,
    };
  }

  async getStudentAttendanceAggregatesForSessionClass(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ student: Student; aggregation: StudentAttendanceAggregation }>> {
    const roster = await this.getAttendanceReportRosterForSessionClass(
      schoolId, sessionId, cls, section,
    );
    const [records, workingDates] = await Promise.all([
      this.getAttendanceHistory(
        schoolId, sessionId, cls, section, startDate, endDate,
      ),
      getStudentAttendanceWorkingDates({
        schoolId, sessionId, class: cls, section, startDate, endDate,
      }),
    ]);
    const recordByStudentDate = new Map(
      records.map(record => [`${record.identityKey}:${record.date}`, record]),
    );
    return roster.map(student => ({
      student: student as unknown as Student,
      aggregation: aggregateStudentAttendance({
        schoolId,
        sessionId,
        statuses: workingDates.map(date =>
          recordByStudentDate.get(`${(student as any).identityKey}:${date}`)?.status ?? null
        ),
      }),
    }));
  }

  // ===== ACADEMIC ADVANCEMENT WIZARD =====

  async getPromotionCohortEvaluation(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    term: string,
  ) {
    return db.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
      return loadPromotionCohortEvaluation(tx, schoolId, sessionId, cls, section, term, true, false);
    });
  }

  async getExamAggregated(schoolId: number, cls: string, section: string, examType: string, sessionId: number): Promise<{
    studentId: number; dsid: string; name: string;
    totalObtained: number; totalMax: number; percentage: number; subjects: string[];
  }[]> {
    // Every operational aggregate is bound to exactly one academic year.
    const rows = await db.select().from(examScores)
      .innerJoin(students, and(eq(examScores.studentId, students.id), eq(students.schoolId, schoolId)))
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
        eq(examScores.examType, examType),
        eq(examScores.sessionId, sessionId),
      ));

    const byStudent: Record<number, { dsid: string; name: string; obtained: number; total: number; subjects: string[] }> = {};
    for (const r of rows) {
      const sid = r.exam_scores.studentId;
      if (!byStudent[sid]) byStudent[sid] = { dsid: r.students.digitalStudentId, name: r.students.name, obtained: 0, total: 0, subjects: [] };
      if (!r.exam_scores.isAbsent) byStudent[sid].obtained += r.exam_scores.marks;
      byStudent[sid].total += r.exam_scores.totalMarks;
      if (!byStudent[sid].subjects.includes(r.exam_scores.subject)) byStudent[sid].subjects.push(r.exam_scores.subject);
    }

    return Object.entries(byStudent).map(([id, d]) => ({
      studentId: parseInt(id),
      dsid: d.dsid,
      name: d.name,
      totalObtained: d.obtained,
      totalMax: d.total,
      percentage: d.total > 0 ? parseFloat(((d.obtained / d.total) * 100).toFixed(2)) : 0,
      subjects: d.subjects,
    })).sort((a, b) => a.dsid.localeCompare(b.dsid));
  }

  async upsertPromotionOverride(data: {
    schoolId: number; sessionId: number; studentId: number; examType: string; class: string; section: string;
    overrideStatus: string; nextClass: string; nextSection: string;
  }): Promise<void> {
    await this.bulkUpsertPromotionOverrides([data]);
  }

  async bulkUpsertPromotionOverrides(items: Array<{
    schoolId: number; sessionId: number; studentId: number; examType: string; class: string; section: string;
    overrideStatus: string; nextClass: string; nextSection: string;
  }>): Promise<void> {
    if (items.length === 0) return;
    const first = items[0];
    const studentIds = items.map(item => item.studentId);
    if (
      new Set(studentIds).size !== studentIds.length ||
      items.some(item =>
        item.schoolId !== first.schoolId ||
        item.sessionId !== first.sessionId ||
        item.class !== first.class ||
        item.section !== first.section ||
        item.examType !== first.examType
      )
    ) {
      throw new PromotionStage1Error(
        "Promotion overrides in one request must use one session, cohort, and examination with no duplicate Students.",
        400,
        "MIXED_PROMOTION_COHORT",
      );
    }

    await db.transaction(async (tx) => {
      const [session] = await tx.select({
        id: academicSessions.id,
        isActive: academicSessions.isActive,
      })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, first.sessionId),
          eq(academicSessions.schoolId, first.schoolId),
        ))
        .for("update");
      if (!session?.isActive) {
        throw new PromotionStage1Error(
          "Promotion overrides can only be saved in the school's active Academic Session.",
          403,
          "SESSION_NOT_WRITABLE",
        );
      }

      const [studentRows, enrollmentRows] = await Promise.all([
        tx.select({
          id: students.id,
          schoolId: students.schoolId,
          isActive: students.isActive,
          dsid: students.digitalStudentId,
          name: students.name,
        })
          .from(students)
          .where(and(
            eq(students.schoolId, first.schoolId),
            inArray(students.id, studentIds),
          ))
          .for("update"),
        tx.select({
          studentId: enrollments.studentId,
          schoolId: enrollments.schoolId,
          sessionId: enrollments.sessionId,
          className: enrollments.className,
          sectionName: enrollments.sectionName,
          status: enrollments.status,
        })
          .from(enrollments)
          .where(and(
            eq(enrollments.schoolId, first.schoolId),
            eq(enrollments.sessionId, first.sessionId),
            inArray(enrollments.studentId, studentIds),
          ))
          .for("update"),
      ]);

      validatePromotionExecutionRoster(
        first.schoolId,
        first.sessionId,
        items.map(item => ({
          studentId: item.studentId,
          fromClass: item.class,
          fromSection: item.section,
          nextClass: item.nextClass,
          nextSection: item.nextSection,
          examType: item.examType,
          totalObtained: 0,
          totalMax: 0,
          percentage: 0,
        })),
        studentRows,
        enrollmentRows,
      );

      for (const item of items) {
        await tx.insert(promotionOverrides).values(item)
          .onConflictDoUpdate({
            target: [
              promotionOverrides.schoolId,
              promotionOverrides.sessionId,
              promotionOverrides.studentId,
              promotionOverrides.examType,
              promotionOverrides.class,
              promotionOverrides.section,
            ],
            set: {
              overrideStatus: item.overrideStatus,
              nextClass: item.nextClass,
              nextSection: item.nextSection,
              overriddenAt: new Date(),
            },
          });
      }
    });
  }

  async deleteAllPromotionOverrides(data: {
    schoolId: number; sessionId: number; class: string; section: string; examType: string;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      const [session] = await tx.select({ isActive: academicSessions.isActive })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, data.sessionId),
          eq(academicSessions.schoolId, data.schoolId),
        ))
        .for("update");
      if (!session?.isActive) {
        throw new PromotionStage1Error(
          "Promotion overrides can only be changed in the school's active Academic Session.",
          403,
          "SESSION_NOT_WRITABLE",
        );
      }
      await tx.delete(promotionOverrides).where(and(
        eq(promotionOverrides.schoolId, data.schoolId),
        eq(promotionOverrides.sessionId, data.sessionId),
        eq(promotionOverrides.class, data.class),
        eq(promotionOverrides.section, data.section),
        eq(promotionOverrides.examType, data.examType),
      ));
    });
  }

  async deletePromotionOverride(data: {
    schoolId: number; sessionId: number; studentId: number; examType: string; class: string; section: string;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      const [session] = await tx.select({ isActive: academicSessions.isActive })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, data.sessionId),
          eq(academicSessions.schoolId, data.schoolId),
        ))
        .for("update");
      if (!session?.isActive) {
        throw new PromotionStage1Error(
          "Promotion overrides can only be changed in the school's active Academic Session.",
          403,
          "SESSION_NOT_WRITABLE",
        );
      }
      const [student] = await tx.select({ id: students.id })
        .from(students)
        .where(and(
          eq(students.id, data.studentId),
          eq(students.schoolId, data.schoolId),
        ))
        .for("update");
      if (!student) return;
      await tx.delete(promotionOverrides).where(and(
        eq(promotionOverrides.schoolId, data.schoolId),
        eq(promotionOverrides.sessionId, data.sessionId),
        eq(promotionOverrides.studentId, data.studentId),
        eq(promotionOverrides.examType, data.examType),
        eq(promotionOverrides.class, data.class),
        eq(promotionOverrides.section, data.section),
      ));
    });
  }

  async getPromotionOverrides(schoolId: number, sessionId: number, cls: string, section: string, examType: string): Promise<PromotionOverride[]> {
    return await db.select().from(promotionOverrides).where(and(
      eq(promotionOverrides.schoolId, schoolId),
      eq(promotionOverrides.sessionId, sessionId),
      eq(promotionOverrides.class, cls),
      eq(promotionOverrides.section, section),
      eq(promotionOverrides.examType, examType),
    ));
  }

  async bulkPromoteStudents(schoolId: number, items: { studentId: number; nextClass: string; nextSection: string }[]): Promise<number> {
    let promoted = 0;
    await db.transaction(async (tx) => {
      for (const item of items) {
        const updated = await tx.update(students)
          .set({ class: item.nextClass, section: item.nextSection })
          .where(and(eq(students.id, item.studentId), eq(students.schoolId, schoolId)))
          .returning();
        if (updated.length > 0) promoted++;
      }
    });
    return promoted;
  }

  // ===== GRADING TIERS =====

  async getGradingTiers(schoolId: number): Promise<GradingTier[]> {
    return await db.select().from(gradingTiers)
      .where(eq(gradingTiers.schoolId, schoolId))
      .orderBy(gradingTiers.sortOrder);
  }

  /**
   * Resolves the examination pass policy from the authenticated tenant's
   * class-scoped grading tier. Callers must treat an absent result as a
   * configuration error; there is deliberately no universal fallback.
   */
  async resolveClassPassPolicy(schoolId: number, studentClass: string): Promise<GradingTier | undefined> {
    const normalizedClass = String(studentClass).trim();
    const tiers = await this.getGradingTiers(schoolId);
    return tiers.find(tier =>
      (tier.classes || []).map(value => String(value).trim()).includes(normalizedClass)
    );
  }

  async upsertGradingTier(data: InsertGradingTier & { id?: number }): Promise<GradingTier> {
    return db.transaction(async tx => {
      await lockPromotionConfiguration(tx, data.schoolId);
      if (data.id) {
        const { id, ...rest } = data;
        const [updated] = await tx.update(gradingTiers)
          .set(rest)
          .where(and(eq(gradingTiers.id, id), eq(gradingTiers.schoolId, data.schoolId)))
          .returning();
        return updated;
      }
      const [inserted] = await tx.insert(gradingTiers).values(data).returning();
      return inserted;
    });
  }

  async deleteGradingTier(id: number, schoolId: number): Promise<void> {
    await db.transaction(async tx => {
      await lockPromotionConfiguration(tx, schoolId);
      await tx.delete(gradingTiers)
        .where(and(eq(gradingTiers.id, id), eq(gradingTiers.schoolId, schoolId)));
    });
  }

  // ===== GRADING RULES =====

  async getGradingRules(schoolId: number, tierId?: number): Promise<GradingRule[]> {
    const conditions = tierId
      ? and(eq(gradingRules.schoolId, schoolId), eq(gradingRules.tierId, tierId))
      : eq(gradingRules.schoolId, schoolId);
    const rows = await db.select().from(gradingRules)
      .where(conditions)
      .orderBy(gradingRules.tierId, gradingRules.sortOrder);
    return rows.map(normalizeStoredGradingRule);
  }

  async replaceGradingRules(tierId: number, schoolId: number, rules: GradingRuleWrite[]): Promise<GradingRule[]> {
    return db.transaction(async tx => {
      await lockPromotionConfiguration(tx, schoolId);
      await tx.select({ id: gradingTiers.id }).from(gradingTiers)
        .where(and(eq(gradingTiers.id, tierId), eq(gradingTiers.schoolId, schoolId)))
        .for("update");
      await tx.delete(gradingRules)
        .where(and(eq(gradingRules.tierId, tierId), eq(gradingRules.schoolId, schoolId)));
      if (rules.length === 0) return [];
      const inserted = await tx.insert(gradingRules)
        .values(rules.map((r, i) => ({
          ...r,
          minPercent: percentageToDatabaseValue(r.minPercent),
          maxPercent: percentageToDatabaseValue(r.maxPercent),
          tierId,
          schoolId,
          sortOrder: i,
        })))
        .returning();
      return inserted.map(normalizeStoredGradingRule);
    });
  }

  // ===== ACADEMIC HISTORY =====

  async archiveStudentHistory(records: InsertAcademicHistory[]): Promise<void> {
    if (records.length === 0) return;
    await db.insert(academicHistory).values(records);
  }

  /** Atomic, tenant- and source/target-session-scoped Promotion preparation. */
  async executePromotionTransaction(
    schoolId: number,
    sourceSessionId: number,
    targetSessionId: number,
    items: PromotionExecutionItem[],
    term: string,
    actor: { id: number; role: "admin" | "support_staff" },
  ): Promise<{
    prepared: number;
    alreadyPrepared: number;
    idempotent: boolean;
    targetEnrollmentsCreated: number;
    targetSessionId: number;
    targetSessionName: string;
    students: PromotionExecutionPlacement[];
  }> {
    validatePromotionExecutionBatch(items, term);
    if (!Number.isSafeInteger(actor.id) || actor.id <= 0) {
      throw new PromotionStage1Error("A valid Promotion actor is required.", 403, "ACTOR_NOT_ACCESSIBLE");
    }

    return db.transaction(async (tx) => {
      await lockPromotionCohort(
        tx,
        schoolId,
        sourceSessionId,
        items[0].fromClass,
        items[0].fromSection,
      );
      await lockPromotionConfiguration(tx, schoolId);
      const [sourceSession] = await tx
        .select({
          id: academicSessions.id,
          schoolId: academicSessions.schoolId,
          isActive: academicSessions.isActive,
        })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, sourceSessionId),
          eq(academicSessions.schoolId, schoolId),
          eq(academicSessions.isActive, true),
        ))
        .for("update");

      if (!sourceSession) {
        throw new PromotionStage1Error(
          "The selected Academic Session is not an active session for this school.",
          403,
          "SESSION_NOT_WRITABLE",
        );
      }

      const [targetSession] = await tx
        .select({
          id: academicSessions.id,
          schoolId: academicSessions.schoolId,
          status: academicSessions.status,
          sessionName: academicSessions.sessionName,
        })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, targetSessionId),
          eq(academicSessions.schoolId, schoolId),
        ))
        .for("update");

      validatePromotionTargetSession(
        schoolId,
        sourceSessionId,
        targetSessionId,
        targetSession,
      );

      const metadataRows = await tx
        .select({
          metaKey: schoolMetadata.metaKey,
          metaValue: schoolMetadata.metaValue,
        })
        .from(schoolMetadata)
        .where(and(
          eq(schoolMetadata.schoolId, schoolId),
          inArray(schoolMetadata.metaKey, ["classes", "class_sections"]),
        ))
        .for("update");
      const metadataByKey = new Map(metadataRows.map(row => [row.metaKey, row.metaValue]));
      let configuredClasses: string[] = [];
      let configuredSections: Record<string, unknown> = {};
      try {
        const value: unknown = JSON.parse(metadataByKey.get("classes") ?? "[]");
        if (Array.isArray(value)) configuredClasses = value.filter((item): item is string => typeof item === "string");
      } catch {}
      try {
        const value: unknown = JSON.parse(metadataByKey.get("class_sections") ?? "{}");
        if (value && typeof value === "object" && !Array.isArray(value)) {
          configuredSections = value as Record<string, unknown>;
        }
      } catch {}
      if (items.some(item =>
        !configuredClasses.includes(item.nextClass)
        || !Array.isArray(configuredSections[item.nextClass])
        || !(configuredSections[item.nextClass] as unknown[]).includes(item.nextSection)
      )) {
        throw new PromotionStage1Error(
          "Every target class and section must be configured for this school.",
          400,
          "TARGET_PLACEMENT_NOT_CONFIGURED",
        );
      }

      const studentIds = items.map(item => item.studentId);
      const [studentRows, enrollmentRows] = await Promise.all([
        tx.select({
          id: students.id,
          schoolId: students.schoolId,
          isActive: students.isActive,
          dsid: students.digitalStudentId,
          name: students.name,
        })
          .from(students)
          .where(and(
            eq(students.schoolId, schoolId),
            inArray(students.id, studentIds),
          ))
          .orderBy(students.id)
          .for("update"),
        tx.select({
          studentId: enrollments.studentId,
          schoolId: enrollments.schoolId,
          sessionId: enrollments.sessionId,
          className: enrollments.className,
          sectionName: enrollments.sectionName,
          status: enrollments.status,
        })
          .from(enrollments)
          .where(and(
            eq(enrollments.schoolId, schoolId),
            eq(enrollments.sessionId, sourceSessionId),
            inArray(enrollments.studentId, studentIds),
          ))
          .orderBy(enrollments.studentId)
          .for("update"),
      ]);

      validatePromotionExecutionRoster(
        schoolId,
        sourceSessionId,
        items,
        studentRows,
        enrollmentRows,
      );
      const cohort = items[0];
      if (items.some(item => item.examType !== term)) {
        throw new PromotionStage1Error(
          "Each Promotion item must use the exact configured examination-term key.",
          400,
          "PROMOTION_TERM_INVALID",
        );
      }

      const evaluation = await loadPromotionCohortEvaluation(
        tx,
        schoolId,
        sourceSessionId,
        cohort.fromClass,
        cohort.fromSection,
        term,
      );
      assertPromotionGateEnabled(evaluation.policy, term);
      const resultByStudent = evaluation.resultsByStudent as Map<number, {
        resultStatus: "complete" | "incomplete";
        promoted: boolean | null;
        termAverages: Record<string, number | null>;
      }>;
      const selectedResultRows = items.map(item => {
        const result = resultByStudent.get(item.studentId);
        if (!result || result.resultStatus !== "complete" || result.promoted === null) {
          throw new PromotionStage1Error(
            "Promotion is blocked because this Student has no applicable marks for the selected term (Incomplete / Pending Result).",
            409,
            "PROMOTION_RESULT_INCOMPLETE",
          );
        }
        return { item, result };
      });

      const decisions = await tx.select({
        studentId: promotionDecisions.studentId,
        decision: promotionDecisions.decision,
        targetClass: promotionDecisions.targetClass,
        targetSection: promotionDecisions.targetSection,
        processedByTeacherId: promotionDecisions.processedByTeacherId,
        locked: promotionDecisions.locked,
        autoSuggestion: promotionDecisions.autoSuggestion,
        manualIntervention: promotionDecisions.manualIntervention,
        adminExecuted: promotionDecisions.adminExecuted,
      }).from(promotionDecisions).where(and(
        eq(promotionDecisions.schoolId, schoolId),
        eq(promotionDecisions.sessionId, sourceSessionId),
        eq(promotionDecisions.class, cohort.fromClass),
        eq(promotionDecisions.section, cohort.fromSection),
        eq(promotionDecisions.term, term),
        inArray(promotionDecisions.studentId, studentIds),
      )).orderBy(promotionDecisions.studentId).for("update");
      const decisionByStudent = new Map(decisions.map((decision: {
        studentId: number;
      }) => [decision.studentId, decision]));
      if (decisions.length !== studentIds.length) {
        throw new PromotionStage1Error(
          "Every selected Student needs a matching locked Teacher Promotion decision for this session, class-section and term.",
          409,
          "PROMOTION_DECISION_MISSING",
        );
      }
      const teacherIds = [...new Set(decisions
        .map((decision: { processedByTeacherId: number | null }) => decision.processedByTeacherId)
        .filter((id: number | null): id is number => id !== null))];
      const teacherRows = teacherIds.length ? await tx.select({ id: teachers.id })
        .from(teachers)
        .where(and(
          eq(teachers.schoolId, schoolId),
          inArray(teachers.id, teacherIds),
        ))
        .for("update") : [];
      const validTeacherIds = new Set(teacherRows.map((teacher: { id: number }) => teacher.id));
      const canonicalItems: PromotionExecutionItem[] = [];
      for (const { item, result } of selectedResultRows) {
        const decision = decisionByStudent.get(item.studentId) as PromotionDecision | undefined;
        const decisionCheck = checkLockedPromotionDecision({
          resultStatus: result.resultStatus,
          promoted: result.promoted,
          decision,
          teacherIsValid: !!decision?.processedByTeacherId
            && validTeacherIds.has(decision.processedByTeacherId),
          targetPlacementIsConfigured: !!decision
            && configuredClasses.includes(decision.targetClass)
            && Array.isArray(configuredSections[decision.targetClass])
            && (configuredSections[decision.targetClass] as unknown[]).includes(decision.targetSection),
          sourceClass: cohort.fromClass,
          sourceSection: cohort.fromSection,
          requestedTarget: { className: item.nextClass, sectionName: item.nextSection },
        });
        if (!decisionCheck.ok) {
          throw new PromotionStage1Error(decisionCheck.message, 409, decisionCheck.code);
        }
        if (!decision) {
          throw new PromotionStage1Error(
            "Promotion requires a valid locked Teacher decision.",
            409,
            "PROMOTION_DECISION_INVALID",
          );
        }
        const selectedAverage = result.termAverages[term];
        const percentage = Math.round(selectedAverage ?? 0);
        const gradeRule = evaluation.gradingRules.find((rule: GradingRule) =>
          selectedAverage !== null && selectedAverage !== undefined
          && selectedAverage >= rule.minPercent && selectedAverage <= rule.maxPercent,
        );
        canonicalItems.push({
          studentId: item.studentId,
          fromClass: cohort.fromClass,
          fromSection: cohort.fromSection,
          nextClass: decision.targetClass,
          nextSection: decision.targetSection,
          examType: term,
          totalObtained: percentage,
          totalMax: 100,
          percentage,
          gradeLabel: gradeRule?.gradeLabel ?? null,
          gradePoint: gradeRule?.gradePoint ?? null,
          gradeRemarks: gradeRule?.remarks ?? null,
        });
      }
      items = canonicalItems;

      const priorHistory = await tx
        .select({
          studentId: academicHistory.studentId,
          fromClass: academicHistory.fromClass,
          fromSection: academicHistory.fromSection,
          toClass: academicHistory.toClass,
          toSection: academicHistory.toSection,
          examType: academicHistory.examType,
          totalObtained: academicHistory.totalObtained,
          totalMax: academicHistory.totalMax,
          percentage: academicHistory.percentage,
          gradeLabel: academicHistory.gradeLabel,
          gradePoint: academicHistory.gradePoint,
          remarks: academicHistory.remarks,
        })
        .from(academicHistory)
        .where(and(
          eq(academicHistory.schoolId, schoolId),
          eq(academicHistory.sessionId, sourceSessionId),
          eq(academicHistory.targetSessionId, targetSessionId),
          inArray(academicHistory.studentId, studentIds),
        ))
        .orderBy(academicHistory.studentId, academicHistory.id)
        .for("update");
      const historyByStudent = new Map<number, typeof priorHistory>();
      for (const history of priorHistory) {
        const rows = historyByStudent.get(history.studentId) ?? [];
        rows.push(history);
        historyByStudent.set(history.studentId, rows);
      }

      const targetEnrollmentRows = await tx
        .select({
          studentId: enrollments.studentId,
          schoolId: enrollments.schoolId,
          sessionId: enrollments.sessionId,
          className: enrollments.className,
          sectionName: enrollments.sectionName,
          rollNo: enrollments.rollNo,
          status: enrollments.status,
        })
        .from(enrollments)
        .where(and(
          eq(enrollments.schoolId, schoolId),
          eq(enrollments.sessionId, targetSessionId),
          inArray(enrollments.studentId, studentIds),
        ))
        .orderBy(enrollments.studentId)
        .for("update");

      const targetEnrollmentsByStudent = new Map<number, PromotionTargetEnrollmentRow[]>();
      for (const enrollment of targetEnrollmentRows) {
        const rows = targetEnrollmentsByStudent.get(enrollment.studentId) ?? [];
        rows.push(enrollment);
        targetEnrollmentsByStudent.set(enrollment.studentId, rows);
      }

      const alreadyPreparedIds = new Set<number>();
      for (const item of items) {
        const histories = historyByStudent.get(item.studentId) ?? [];
        if (histories.length === 0) continue;
        const exactHistory = histories.length === 1 && histories.every(history =>
          history.fromClass === item.fromClass
          && history.fromSection === item.fromSection
          && history.toClass === item.nextClass
          && history.toSection === item.nextSection
          && history.examType === item.examType
          && history.totalObtained === item.totalObtained
          && history.totalMax === item.totalMax
          && history.percentage === item.percentage
          && history.gradeLabel === (item.gradeLabel ?? null)
          && history.gradePoint === (item.gradePoint ?? null)
          && history.remarks === (item.gradeRemarks ?? null)
        );
        const existingRows = targetEnrollmentsByStudent.get(item.studentId) ?? [];
        const matchingPreparedEnrollment =
          existingRows.length === 1
          && existingRows[0].schoolId === schoolId
          && existingRows[0].studentId === item.studentId
          && existingRows[0].sessionId === targetSessionId
          && existingRows[0].className === item.nextClass
          && existingRows[0].sectionName === item.nextSection
          && existingRows[0].status === "Active";
        if (!exactHistory || !matchingPreparedEnrollment) {
          throw new PromotionStage1Error(
            "This Student already has a different or incomplete Promotion execution for the selected sessions.",
            409,
            "PROMOTION_EXECUTION_CONFLICT",
          );
        }
        alreadyPreparedIds.add(item.studentId);
      }

      const itemsToPrepare = items.filter(item => !alreadyPreparedIds.has(item.studentId));
      if (itemsToPrepare.length === 0) {
        return {
          prepared: 0,
          alreadyPrepared: alreadyPreparedIds.size,
          idempotent: true,
          targetEnrollmentsCreated: 0,
          targetSessionId,
          targetSessionName: targetSession.sessionName,
          students: [],
        };
      }

      const itemsToPrepareIds = itemsToPrepare.map(item => item.studentId);
      const studentsToPrepare = studentRows.filter(student => itemsToPrepareIds.includes(student.id));
      const enrollmentsToPrepare = enrollmentRows.filter(enrollment =>
        itemsToPrepareIds.includes(enrollment.studentId),
      );
      const roster = validatePromotionExecutionRoster(
        schoolId,
        sourceSessionId,
        itemsToPrepare,
        studentsToPrepare,
        enrollmentsToPrepare,
      );

      const existingDecisions = await tx
        .select({ adminExecuted: promotionDecisions.adminExecuted })
        .from(promotionDecisions)
        .where(and(
          eq(promotionDecisions.schoolId, schoolId),
          eq(promotionDecisions.sessionId, sourceSessionId),
          eq(promotionDecisions.class, cohort.fromClass),
          eq(promotionDecisions.section, cohort.fromSection),
          eq(promotionDecisions.term, term),
          inArray(promotionDecisions.studentId, itemsToPrepareIds),
        ))
        .orderBy(promotionDecisions.studentId)
        .for("update");

      if (existingDecisions.some(decision => decision.adminExecuted)) {
        throw promotionAlreadyExecutedError();
      }

      let targetEnrollmentsCreated = 0;
      for (const item of itemsToPrepare) {
        const existingRows = targetEnrollmentsByStudent.get(item.studentId) ?? [];
        const disposition = validatePromotionTargetEnrollment(
          schoolId,
          targetSessionId,
          item,
          existingRows,
        );
        if (disposition === "already_prepared") continue;

        const [inserted] = await tx
          .insert(enrollments)
          .values({
            schoolId,
            studentId: item.studentId,
            sessionId: targetSessionId,
            className: item.nextClass,
            sectionName: item.nextSection,
            rollNo: null,
            status: "Active",
          })
          .onConflictDoNothing({
            target: [enrollments.schoolId, enrollments.studentId, enrollments.sessionId],
          })
          .returning({ id: enrollments.id });

        if (inserted) {
          targetEnrollmentsCreated += 1;
          continue;
        }

        // A concurrent request may have created this unique enrollment after
        // the initial locked read. Confirm it is the exact requested placement.
        const concurrentRows = await tx
          .select({
            studentId: enrollments.studentId,
            schoolId: enrollments.schoolId,
            sessionId: enrollments.sessionId,
            className: enrollments.className,
            sectionName: enrollments.sectionName,
            rollNo: enrollments.rollNo,
            status: enrollments.status,
          })
          .from(enrollments)
          .where(and(
            eq(enrollments.sessionId, targetSessionId),
            eq(enrollments.studentId, item.studentId),
          ))
          .for("update");
        const concurrentDisposition = validatePromotionTargetEnrollment(
          schoolId,
          targetSessionId,
          item,
          concurrentRows,
        );
        if (concurrentDisposition !== "already_prepared") {
          throw new PromotionStage1Error(
            "A target-session enrollment changed during Promotion preparation.",
            409,
            "TARGET_ENROLLMENT_CONFLICT",
          );
        }
      }

      const selectedTermSources = new Set(evaluation.components.map(component => component.sourceExam));
      const scoreRows = evaluation.scoreRows.filter((score: {
        studentId: number; examType: string;
      }) => itemsToPrepareIds.includes(score.studentId) && selectedTermSources.has(score.examType));

      const scoresByStudent = new Map<number, typeof scoreRows>();
      for (const score of scoreRows) {
        const studentScores = scoresByStudent.get(score.studentId) ?? [];
        studentScores.push(score);
        scoresByStudent.set(score.studentId, studentScores);
      }
      const placementByStudent = new Map(roster.map(placement => [placement.studentId, placement]));
      const archivedAt = new Date();
      const historyRecords: InsertAcademicHistory[] = itemsToPrepare.map(item => {
        const placement = placementByStudent.get(item.studentId)!;
        const actorSnapshot = actor.role === "admin"
          ? { actorRole: "admin", adminId: actor.id }
          : { actorRole: "support_staff", staffId: actor.id };
        return {
          schoolId,
          sessionId: sourceSessionId,
          targetSessionId,
          studentId: placement.studentId,
          fromClass: placement.fromClass,
          fromSection: placement.fromSection,
          toClass: item.nextClass,
          toSection: item.nextSection,
          examType: item.examType,
          totalObtained: item.totalObtained,
          totalMax: item.totalMax,
          percentage: item.percentage,
          gradeLabel: item.gradeLabel ?? null,
          gradePoint: item.gradePoint ?? null,
          remarks: item.gradeRemarks ?? null,
          snapshotJson: {
            archivedAt: archivedAt.toISOString(),
            ...actorSnapshot,
            schoolId,
            sourceSessionId,
            targetSessionId,
            targetSessionName: targetSession.sessionName,
            studentDsid: placement.dsid,
            studentName: placement.name,
            fromClass: placement.fromClass,
            fromSection: placement.fromSection,
            toClass: item.nextClass,
            toSection: item.nextSection,
            examType: item.examType,
            term,
            totalObtained: item.totalObtained,
            totalMax: item.totalMax,
            percentage: item.percentage,
            gradeLabel: item.gradeLabel ?? null,
            gradePoint: item.gradePoint ?? null,
            gradeRemarks: item.gradeRemarks ?? null,
            examBreakdown: (scoresByStudent.get(item.studentId) ?? []).map((score: {
              subject: string; examType: string; marks: number; totalMarks: number; isAbsent: boolean;
            }) => ({
              subject: score.subject,
              examType: score.examType,
              marks: score.marks,
              totalMarks: score.totalMarks,
              isAbsent: score.isAbsent,
            })),
          },
        };
      });

      await tx.insert(academicHistory).values(historyRecords);

      await tx.update(promotionDecisions)
        .set({ adminExecuted: true, adminExecutedAt: archivedAt })
        .where(and(
          eq(promotionDecisions.schoolId, schoolId),
          eq(promotionDecisions.sessionId, sourceSessionId),
          eq(promotionDecisions.class, cohort.fromClass),
          eq(promotionDecisions.section, cohort.fromSection),
          eq(promotionDecisions.term, term),
          eq(promotionDecisions.adminExecuted, false),
          inArray(promotionDecisions.studentId, itemsToPrepareIds),
        ));

      return {
        prepared: itemsToPrepare.length,
        alreadyPrepared: alreadyPreparedIds.size,
        idempotent: itemsToPrepare.length === 0 && alreadyPreparedIds.size > 0,
        targetEnrollmentsCreated,
        targetSessionId,
        targetSessionName: targetSession.sessionName,
        students: itemsToPrepare.map(item => ({
          ...placementByStudent.get(item.studentId)!,
          toClass: item.nextClass,
          toSection: item.nextSection,
          examType: item.examType,
          totalObtained: item.totalObtained,
          totalMax: item.totalMax,
          percentage: item.percentage,
        })),
      };
    });
  }

  async clearIdCardReissueFlag(schoolId: number, studentIds: number[]): Promise<void> {
    if (studentIds.length === 0) return;
    await db.update(students)
      .set({ idCardPendingReissue: false })
      .where(and(eq(students.schoolId, schoolId), inArray(students.id, studentIds)));
  }

  async getExamScoresForStudents(
    schoolId: number, studentIds: number[],
  ): Promise<Array<{ studentId: number; subject: string; examType: string; marks: number; totalMarks: number; isAbsent: boolean }>> {
    if (studentIds.length === 0) return [];
    return db
      .select({
        studentId: examScores.studentId,
        subject:   examScores.subject,
        examType:  examScores.examType,
        marks:     examScores.marks,
        totalMarks: examScores.totalMarks,
        isAbsent:  examScores.isAbsent,
      })
      .from(examScores)
      .where(and(eq(examScores.schoolId, schoolId), inArray(examScores.studentId, studentIds)));
  }

  async getAcademicHistory(schoolId: number, studentId?: number, sessionId?: number | null): Promise<typeof academicHistory.$inferSelect[]> {
    const conditions: any[] = [eq(academicHistory.schoolId, schoolId)];
    if (studentId) conditions.push(eq(academicHistory.studentId, studentId));
    if (sessionId != null) conditions.push(eq(academicHistory.sessionId, sessionId));
    return await db.select().from(academicHistory)
      .where(and(...conditions))
      .orderBy(desc(academicHistory.archivedAt));
  }

  // ===== ASSET LIFECYCLE MANAGER =====

  async getAssets(schoolId: number, filters?: { condition?: string; location?: string; search?: string }): Promise<SchoolAsset[]> {
    const conditions: SQL<unknown>[] = [eq(schoolAssets.schoolId, schoolId)];
    if (filters?.condition) conditions.push(eq(schoolAssets.condition, filters.condition));
    if (filters?.location) conditions.push(eq(schoolAssets.location, filters.location));
    if (filters?.search) conditions.push(or(ilike(schoolAssets.name, `%${filters.search}%`), ilike(schoolAssets.category, `%${filters.search}%`))!);
    return await db.select().from(schoolAssets)
      .where(and(...conditions))
      .orderBy(desc(schoolAssets.createdAt));
  }

  async createAsset(data: InsertSchoolAsset & { purchasedDate?: string | null; warrantyExpiry?: string | null }): Promise<SchoolAsset> {
    const [asset] = await db.insert(schoolAssets).values({
      schoolId: data.schoolId,
      name: data.name,
      category: data.category,
      quantity: data.quantity ?? 0,
      condition: data.condition ?? "Good",
      location: data.location ?? "",
      assetCode: data.assetCode ?? "",
      purchasedDate: data.purchasedDate ?? null,
      warrantyExpiry: data.warrantyExpiry ?? null,
    }).returning();
    if (!data.assetCode) {
      const code = `AST-${String(asset.id).padStart(4, "0")}`;
      const [updated] = await db.update(schoolAssets).set({ assetCode: code }).where(eq(schoolAssets.id, asset.id)).returning();
      return updated;
    }
    return asset;
  }

  async updateAsset(id: number, schoolId: number, data: { quantity?: number; condition?: string; location?: string; purchasedDate?: string | null; warrantyExpiry?: string | null }): Promise<SchoolAsset | null> {
    const setFields: Record<string, unknown> = { updatedAt: new Date() };
    if (data.quantity !== undefined)       setFields.quantity       = data.quantity;
    if (data.condition !== undefined)      setFields.condition      = data.condition;
    if (data.location  !== undefined)      setFields.location       = data.location;
    if ("purchasedDate" in data)           setFields.purchasedDate  = data.purchasedDate ?? null;
    if ("warrantyExpiry" in data)          setFields.warrantyExpiry = data.warrantyExpiry ?? null;
    const [updated] = await db.update(schoolAssets)
      .set(setFields as any)
      .where(and(eq(schoolAssets.id, id), eq(schoolAssets.schoolId, schoolId)))
      .returning();
    return updated || null;
  }

  async deleteAsset(id: number, schoolId: number): Promise<boolean> {
    const result = await db.delete(schoolAssets)
      .where(and(eq(schoolAssets.id, id), eq(schoolAssets.schoolId, schoolId)))
      .returning();
    return result.length > 0;
  }

  async getAssetById(id: number, schoolId: number): Promise<SchoolAsset | null> {
    const [asset] = await db.select().from(schoolAssets)
      .where(and(eq(schoolAssets.id, id), eq(schoolAssets.schoolId, schoolId)));
    return asset || null;
  }

  async logAssetActivity(entry: InsertAssetLog): Promise<void> {
    await db.insert(assetLogs).values(entry);
  }

  // ===== ANALYTICS DATA HELPERS =====

  async getDistinctSectionsByClass(schoolId: number, cls: string): Promise<string[]> {
    const rows = await db.selectDistinct({ section: examScores.section })
      .from(examScores)
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.class, cls),
      ));
    return rows.map(r => r.section).filter(Boolean).sort() as string[];
  }

  async getDistinctExamTypesByClass(schoolId: number, cls: string, section?: string): Promise<string[]> {
    const conditions: SQL<unknown>[] = [
      eq(examScores.schoolId, schoolId),
      eq(examScores.class, cls),
    ];
    if (section) conditions.push(eq(examScores.section, section));
    const rows = await db.selectDistinct({ examType: examScores.examType })
      .from(examScores)
      .where(and(...conditions));
    return rows.map(r => r.examType).filter(Boolean).sort() as string[];
  }

  async getAnalyticsData(
    schoolId: number,
    cls: string,
     opts: { section?: string; examType?: string; subject?: string; search?: string; sessionId: number }
  ): Promise<{
    students: Array<{
      studentId: number; dsid: string; name: string;
      subjectScores: Record<string, { marks: number; totalMarks: number; isAbsent: boolean }>;
      totalObtained: number; totalMax: number; percentage: number;
      gradeLabel: string | null; gradePoint: string | null; gradeRemarks: string | null;
      tierPassThreshold: number; passStatus: "PASS" | "FAIL" | "GRACE_PASS";
      overrideStatus: string | null;
    }>;
    subjectAverages: Array<{ subject: string; average: number }>;
    subjectList: string[];
    passThreshold: number;
  }> {
    const passPolicy = await this.resolveClassPassPolicy(schoolId, cls);
    if (!passPolicy) throw new Error(`No grading tier configured for class ${cls}.`);
    // Admin analytics shows ALL scores regardless of published status —
    // the published flag gates student-facing views only, not principal oversight.
    const conditions: SQL<unknown>[] = [
      eq(examScores.schoolId, schoolId),
      eq(examScores.class, cls),
    ];
    if (opts.section) conditions.push(eq(examScores.section, opts.section));
    if (opts.examType) conditions.push(eq(examScores.examType, opts.examType));
    conditions.push(eq(examScores.sessionId, opts.sessionId));

    const rows = await db.select().from(examScores)
      .innerJoin(students, and(eq(examScores.studentId, students.id), eq(students.schoolId, schoolId)))
      .where(and(...conditions));

    const byStudent: Record<number, {
      dsid: string; name: string;
      subjectScores: Record<string, { marks: number; totalMarks: number; isAbsent: boolean }>;
      obtained: number; total: number;
    }> = {};

    for (const r of rows) {
      const sid = r.exam_scores.studentId;
      if (!byStudent[sid]) {
        byStudent[sid] = { dsid: r.students.digitalStudentId, name: r.students.name, subjectScores: {}, obtained: 0, total: 0 };
      }
      const subj = r.exam_scores.subject;
      if (!(subj in byStudent[sid].subjectScores)) {
        byStudent[sid].subjectScores[subj] = { marks: 0, totalMarks: 0, isAbsent: false };
      }
      if (!r.exam_scores.isAbsent) {
        byStudent[sid].subjectScores[subj].marks += r.exam_scores.marks;
        byStudent[sid].obtained += r.exam_scores.marks;
      }
      byStudent[sid].subjectScores[subj].totalMarks += r.exam_scores.totalMarks;
      byStudent[sid].total += r.exam_scores.totalMarks;
    }

    const overrideMap: Record<number, string> = {};
    if (opts.section && opts.examType) {
      const overrides = await this.getPromotionOverrides(
        schoolId,
        opts.sessionId,
        cls,
        opts.section,
        opts.examType,
      );
      for (const override of overrides) overrideMap[override.studentId] = override.overrideStatus;
    }

    let studentList = await Promise.all(Object.entries(byStudent).map(async ([id, d]) => {
      const studentId = parseInt(id);
      const percentage = d.total > 0 ? parseFloat(((d.obtained / d.total) * 100).toFixed(2)) : 0;
      const grade = await this.resolveGrade(schoolId, cls, percentage);
      const overrideStatus = overrideMap[studentId] ?? null;
      let passStatus: "PASS" | "FAIL" | "GRACE_PASS";
      if (overrideStatus === "GRACE_PASS") passStatus = "GRACE_PASS";
      else if (overrideStatus === "PASS") passStatus = "PASS";
      else if (overrideStatus === "FAIL" || overrideStatus === "REPEAT") passStatus = "FAIL";
      else if (percentage >= grade.passPercentage) passStatus = "PASS";
      else if (percentage >= grade.passPercentage - 5) passStatus = "GRACE_PASS";
      else passStatus = "FAIL";
      return {
        studentId, dsid: d.dsid, name: d.name, subjectScores: d.subjectScores,
        totalObtained: d.obtained, totalMax: d.total, percentage,
        gradeLabel: grade.gradeLabel, gradePoint: grade.gradePoint, gradeRemarks: grade.remarks,
        tierPassThreshold: grade.passPercentage, passStatus, overrideStatus,
      };
    }));

    if (opts.subject) studentList = studentList.filter(s => opts.subject! in s.subjectScores);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      studentList = studentList.filter(s => s.name.toLowerCase().includes(q) || s.dsid.toLowerCase().includes(q));
    }
    studentList.sort((a, b) => a.dsid.localeCompare(b.dsid));

    const subjectSums: Record<string, { sum: number; cnt: number }> = {};
    for (const s of studentList) {
      for (const [subj, score] of Object.entries(s.subjectScores)) {
        if (!score.isAbsent && score.totalMarks > 0) {
          if (!subjectSums[subj]) subjectSums[subj] = { sum: 0, cnt: 0 };
          subjectSums[subj].sum += (score.marks / score.totalMarks) * 100;
          subjectSums[subj].cnt++;
        }
      }
    }
    const subjectAverages = Object.entries(subjectSums)
      .map(([subject, { sum, cnt }]) => ({ subject, average: parseFloat((sum / cnt).toFixed(1)) }))
      .sort((a, b) => b.average - a.average);

    const subjectSet = new Set<string>();
    for (const d of Object.values(byStudent)) for (const s of Object.keys(d.subjectScores)) subjectSet.add(s);
    const subjectList = Array.from(subjectSet);
    const passThreshold = passPolicy.passPercentage;

    return { students: studentList, subjectAverages, subjectList, passThreshold };
  }

  async getStudentJourneyData(studentId: number, schoolId: number): Promise<{
    examTypes: string[];
    subjectRows: { subject: string; scores: (number | null)[] }[];
    totals: number[];
  }> {
    const scores = await db.select().from(examScores)
      .where(and(
        eq(examScores.studentId, studentId),
        eq(examScores.schoolId, schoolId),
      ))
      .orderBy(examScores.id);

    const examTypeOrder: string[] = [];
    const byExamType: Record<string, Record<string, { marks: number; totalMarks: number }>> = {};

    for (const score of scores) {
      if (!examTypeOrder.includes(score.examType)) examTypeOrder.push(score.examType);
      if (!byExamType[score.examType]) byExamType[score.examType] = {};
      if (!score.isAbsent) {
        byExamType[score.examType][score.subject] = { marks: score.marks, totalMarks: score.totalMarks };
      }
    }

    const subjectSet = new Set<string>();
    for (const examSubjects of Object.values(byExamType)) for (const s of Object.keys(examSubjects)) subjectSet.add(s);
    const subjectList = Array.from(subjectSet);

    const subjectRows = subjectList.map(subject => ({
      subject,
      scores: examTypeOrder.map(et => {
        const s = byExamType[et]?.[subject];
        return s ? Math.round((s.marks / s.totalMarks) * 100) : null;
      }),
    }));

    const totals = examTypeOrder.map(et => {
      const subjects = byExamType[et];
      if (!subjects || Object.keys(subjects).length === 0) return 0;
      let obtained = 0, total = 0;
      for (const { marks, totalMarks } of Object.values(subjects)) { obtained += marks; total += totalMarks; }
      return total > 0 ? parseFloat(((obtained / total) * 100).toFixed(1)) : 0;
    });

    return { examTypes: examTypeOrder, subjectRows, totals };
  }

  // ===== TIER-AWARE GRADING HELPER =====

  async resolveGrade(schoolId: number, studentClass: string, percentage: number): Promise<{
    passPercentage: number; gradeLabel: string | null; gradePoint: string | null; remarks: string | null;
  }> {
    const tiers = await this.getGradingTiers(schoolId);
    const allRules = await this.getGradingRules(schoolId);
    const matchedTier = tiers.find(t => Array.isArray(t.classes) && t.classes.includes(studentClass));
    if (!matchedTier) throw new Error(`No grading tier configured for class ${studentClass}.`);
    const tierRules = allRules.filter(r => r.tierId === matchedTier.id);
    const matchedGrade = selectGrade(percentage, tierRules);
    const matchedRule = tierRules.find(r =>
      r.gradeLabel === matchedGrade.label && r.remarks === matchedGrade.remarks &&
      percentage >= r.minPercent && percentage <= r.maxPercent
    );
    return {
      passPercentage: matchedTier.passPercentage,
      gradeLabel: matchedGrade.label,
      gradePoint: matchedRule?.gradePoint ?? null,
      remarks: matchedGrade.remarks,
    };
  }

  async logVerificationRequest(schoolId: number, studentId: number): Promise<void> {
    await db.insert(verificationLogs).values({ schoolId, studentId });
  }

  async countMonthlyVerifications(schoolId: number, studentId: number): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const rows = await db
      .select({ id: verificationLogs.id })
      .from(verificationLogs)
      .where(
        and(
          eq(verificationLogs.schoolId, schoolId),
          eq(verificationLogs.studentId, studentId),
          gte(verificationLogs.submittedAt, startOfMonth),
          lte(verificationLogs.submittedAt, endOfMonth),
        ),
      );
    return rows.length;
  }

  // ===== TIMETABLE STRUCTURE METHODS =====
  async getTimetableStructure(schoolId: number, sessionId: number, cls: string): Promise<TimetableStructure[]> {
    await this.requireTimetableSession(schoolId, sessionId);
    return await db
      .select()
      .from(timetableStructure)
      .where(and(eq(timetableStructure.schoolId, schoolId), eq(timetableStructure.sessionId, sessionId), eq(timetableStructure.class, cls)))
      .orderBy(timetableStructure.sortOrder, timetableStructure.periodNumber);
  }

  async saveTimetableStructure(schoolId: number, sessionId: number, cls: string, rows: Omit<InsertTimetableStructure, "schoolId" | "sessionId" | "class">[]): Promise<TimetableStructure[]> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const toInsert = rows.map((r, idx) => ({
      ...r,
      schoolId,
      sessionId,
      class: cls,
      sortOrder: r.sortOrder ?? idx,
    }));
    return await db.transaction(async (tx) => {
      await tx.delete(timetableStructure).where(
        and(eq(timetableStructure.schoolId, schoolId), eq(timetableStructure.sessionId, sessionId), eq(timetableStructure.class, cls))
      );
      if (toInsert.length === 0) return [];
      return await tx.insert(timetableStructure).values(toInsert).returning();
    });
  }

  async deleteTimetableStructureById(id: number, schoolId: number, sessionId: number): Promise<boolean> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const result = await db.delete(timetableStructure)
      .where(and(eq(timetableStructure.id, id), eq(timetableStructure.schoolId, schoolId), eq(timetableStructure.sessionId, sessionId)))
      .returning();
    return result.length > 0;
  }

  // ===== ADMIN AUTH & PROFILE =====
  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async initializeAdmin(userId: number, pinHash: string, recoveryEmail: string | null, recoveryPhone: string | null): Promise<void> {
    await db.update(users).set({
      pinHash,
      recoveryEmail,
      recoveryPhone,
      isInitialized: true,
      otpCode: null,
      otpExpiresAt: null,
    }).where(eq(users.id, userId));
  }

  async verifyAdminPin(userId: number, pin: string): Promise<boolean> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || !user.pinHash) return false;
    const bcryptLib = await import("bcryptjs");
    return bcryptLib.compare(pin, user.pinHash);
  }

  async updateAdminPin(userId: number, pinHash: string): Promise<void> {
    await db.update(users).set({ pinHash }).where(eq(users.id, userId));
  }

  async updateAdminPassword(userId: number, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  }

  async updateAdminProfile(userId: number, data: { recoveryEmail?: string | null; recoveryPhone?: string | null }): Promise<void> {
    await db.update(users).set(data).where(eq(users.id, userId));
  }

  // Signature is stored scoped to the user. schoolId is passed so the caller
  // can enforce tenant isolation before updating — never trust a client-supplied ID.
  async updateAdminSignature(userId: number, schoolId: number, signatureUrl: string): Promise<void> {
    await db.update(users)
      .set({ signatureUrl })
      .where(and(eq(users.id, userId), eq(users.schoolId, schoolId)));
  }

  async clearAdminSignature(userId: number, schoolId: number): Promise<void> {
    await db.update(users)
      .set({ signatureUrl: null })
      .where(and(eq(users.id, userId), eq(users.schoolId, schoolId)));
  }

  async logSecurityEvent(userId: number | null, schoolId: number | null, action: string, success: boolean, ipAddress: string | null, userAgent: string | null): Promise<void> {
    await db.insert(securityAudit).values({ userId: userId ?? undefined, schoolId: schoolId ?? undefined, action, success, ipAddress, userAgent });
  }

  async getSecurityAuditLog(userId: number, limit = 20): Promise<import("@shared/schema").SecurityAudit[]> {
    return await db.select().from(securityAudit)
      .where(eq(securityAudit.userId, userId))
      .orderBy(desc(securityAudit.createdAt))
      .limit(limit);
  }

  // ===== NON-TEACHING STAFF =====
  async getNonTeachingStaffBySchool(schoolId: number): Promise<NonTeachingStaff[]> {
    return await db.select().from(nonTeachingStaff)
      .where(and(eq(nonTeachingStaff.schoolId, schoolId), eq(nonTeachingStaff.isActive, true)))
      .orderBy(nonTeachingStaff.fullName);
  }

  async createNonTeachingStaff(data: InsertNonTeachingStaff): Promise<NonTeachingStaff> {
    const [record] = await db.insert(nonTeachingStaff).values(data).returning();
    return record;
  }

  async updateNonTeachingStaff(id: number, schoolId: number, data: Partial<InsertNonTeachingStaff>): Promise<NonTeachingStaff | undefined> {
    const [record] = await db.update(nonTeachingStaff)
      .set(data)
      .where(and(eq(nonTeachingStaff.id, id), eq(nonTeachingStaff.schoolId, schoolId)))
      .returning();
    return record;
  }

  async deleteNonTeachingStaff(id: number, schoolId: number): Promise<boolean> {
    const result = await db.update(nonTeachingStaff)
      .set({ isActive: false })
      .where(and(eq(nonTeachingStaff.id, id), eq(nonTeachingStaff.schoolId, schoolId)))
      .returning();
    return result.length > 0;
  }

  async getNonTeachingStaffById(id: number): Promise<NonTeachingStaff | undefined> {
    const [record] = await db.select().from(nonTeachingStaff).where(eq(nonTeachingStaff.id, id));
    return record;
  }

  async getNonTeachingStaffByEmail(email: string): Promise<NonTeachingStaff | undefined> {
    const [record] = await db.select().from(nonTeachingStaff)
      .where(and(eq(nonTeachingStaff.email, email), eq(nonTeachingStaff.isActive, true)));
    return record;
  }

  // ===== FACULTY MAPPINGS =====
  async getFacultyMappingsBySchool(schoolId: number): Promise<(FacultyMapping & { teacherName: string; email: string })[]> {
    const rows = await db.select({
      id: facultyMappings.id,
      teacherId: facultyMappings.teacherId,
      schoolId: facultyMappings.schoolId,
      className: facultyMappings.className,
      section: facultyMappings.section,
      subject: facultyMappings.subject,
      teacherName: teachers.fullName,
      email: users.email,
    }).from(facultyMappings)
      .innerJoin(teachers, eq(facultyMappings.teacherId, teachers.id))
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(eq(facultyMappings.schoolId, schoolId))
      .orderBy(teachers.fullName, facultyMappings.className, facultyMappings.section);
    return rows;
  }

  async replaceFacultyMappings(teacherId: number, schoolId: number, mappings: { className: string; section: string; subject?: string | null }[]): Promise<FacultyMapping[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(facultyMappings).where(
        and(eq(facultyMappings.teacherId, teacherId), eq(facultyMappings.schoolId, schoolId))
      );
      if (mappings.length === 0) return [];
      const rows = await tx.insert(facultyMappings).values(
        mappings.map(m => ({ teacherId, schoolId, className: m.className, section: m.section, subject: m.subject ?? null }))
      ).returning();
      return rows;
    });
  }

  async deleteFacultyMappingsByTeacher(teacherId: number, schoolId: number): Promise<void> {
    await db.delete(facultyMappings).where(
      and(eq(facultyMappings.teacherId, teacherId), eq(facultyMappings.schoolId, schoolId))
    );
  }

  async getFacultyMappingsByTeacher(teacherId: number): Promise<{ className: string; section: string; subject: string | null }[]> {
    return db.select({
      className: facultyMappings.className,
      section: facultyMappings.section,
      subject: facultyMappings.subject,
    }).from(facultyMappings)
      .where(eq(facultyMappings.teacherId, teacherId))
      .orderBy(facultyMappings.className, facultyMappings.section);
  }

  async getTeachersBySchoolPaginated(schoolId: number, q: string, page: number, pageSize: number, filterClass?: string, filterSection?: string): Promise<{ data: (Teacher & { email: string; mappings: { className: string; section: string; subject: string | null }[] })[]; total: number }> {
    const baseWhere = eq(teachers.schoolId, schoolId);
    const searchCondition = q
      ? and(baseWhere, or(
          ilike(teachers.fullName, `%${q}%`),
          ilike(users.email, `%${q}%`),
        ))
      : baseWhere;

    // Build class/section filter: match primary assignment OR any facultyMapping row
    let classFilterCondition: SQL | undefined;
    if (filterClass || filterSection) {
      const mappingConds: SQL[] = [eq(facultyMappings.schoolId, schoolId)];
      if (filterClass) mappingConds.push(eq(facultyMappings.className, filterClass));
      if (filterSection) mappingConds.push(eq(facultyMappings.section, filterSection));

      const mappedRows = await db.select({ teacherId: facultyMappings.teacherId })
        .from(facultyMappings)
        .where(and(...mappingConds));
      const mappedTeacherIds = mappedRows.map(r => r.teacherId);

      const primaryConds: SQL[] = [];
      if (filterClass) primaryConds.push(eq(teachers.assignedClass, filterClass));
      if (filterSection) primaryConds.push(eq(teachers.assignedSection, filterSection));
      const primaryMatch = primaryConds.length > 0 ? and(...primaryConds) : undefined;

      if (mappedTeacherIds.length > 0 && primaryMatch) {
        classFilterCondition = or(primaryMatch, inArray(teachers.id, mappedTeacherIds));
      } else if (mappedTeacherIds.length > 0) {
        classFilterCondition = inArray(teachers.id, mappedTeacherIds);
      } else if (primaryMatch) {
        classFilterCondition = primaryMatch;
      } else {
        classFilterCondition = sql`FALSE`;
      }
    }

    const finalWhere = classFilterCondition
      ? and(searchCondition ?? baseWhere, classFilterCondition)
      : (searchCondition ?? baseWhere);

    const [{ total }] = await db.select({ total: count() }).from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(finalWhere);

    const data = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(finalWhere)
      .orderBy(teachers.fullName)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const teacherIds = data.map(r => r.teachers.id);
    let mappingsByTeacher: Record<number, { className: string; section: string; subject: string | null }[]> = {};

    if (teacherIds.length > 0) {
      const allMappings = await db.select({
        teacherId: facultyMappings.teacherId,
        className: facultyMappings.className,
        section: facultyMappings.section,
        subject: facultyMappings.subject,
      }).from(facultyMappings)
        .where(and(
          eq(facultyMappings.schoolId, schoolId),
          inArray(facultyMappings.teacherId, teacherIds),
        ));

      for (const m of allMappings) {
        if (!mappingsByTeacher[m.teacherId]) mappingsByTeacher[m.teacherId] = [];
        mappingsByTeacher[m.teacherId].push({ className: m.className, section: m.section, subject: m.subject });
      }
    }

    return {
      total,
      data: data.map(r => ({
        ...r.teachers,
        email: r.users.email,
        mappings: mappingsByTeacher[r.teachers.id] ?? [],
      })),
    };
  }

  async createFeeRecord(data: InsertFeeRecord): Promise<FeeRecord> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rec] = await db.insert(feeRecords).values(data as any).returning();
    return rec;
  }

  /**
   * Atomically creates one invoice for a student/type/period.
   * The transaction-scoped advisory lock protects both manual and
   * structure-backed callers from concurrent duplicate creation. Legacy
   * period-less records remain duplicates for the same student/type within the
   * active session.
   */
  async createInvoiceFeeRecordIfAbsent(input: {
    data: Omit<InsertFeeRecord, "invoiceNumber">;
    periodStart: string;
    afterCreate?: (tx: any, record: FeeRecord) => Promise<void>;
  }): Promise<{ created: boolean; record: FeeRecord }> {
    const data = input.data;
    if (!data.sessionId) throw new Error("Invoices require an active session");
    const normalizedType = data.feeType.trim().toLowerCase();
    const lockKey = [
      "fee-invoice",
      data.schoolId,
      data.sessionId,
      data.studentId,
      normalizedType,
      input.periodStart,
    ].join(":");

    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

      const [existing] = await tx.select().from(feeRecords).where(and(
        eq(feeRecords.schoolId, data.schoolId),
        eq(feeRecords.sessionId, data.sessionId!),
        eq(feeRecords.studentId, data.studentId),
        sql`lower(btrim(${feeRecords.feeType})) = ${normalizedType}`,
        or(
          eq(feeRecords.feePeriodStart, input.periodStart),
          isNull(feeRecords.feePeriodStart),
        ),
      )).limit(1);
      if (existing) return { created: false, record: existing };

      const sequenceResult = await tx.execute(
        sql`INSERT INTO receipt_sequences (school_id, prefix, current_number)
            VALUES (${data.schoolId}, ${"INV-"}, 1)
            ON CONFLICT (school_id, prefix) DO UPDATE
              SET current_number = receipt_sequences.current_number + 1
            RETURNING current_number`,
      );
      const sequence = Number((sequenceResult.rows[0] as any).current_number);
      const invoiceNumber = `INV-${String(sequence).padStart(4, "0")}`;
      const [record] = await tx.insert(feeRecords)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ ...data, invoiceNumber } as any)
        .returning();
      if (input.afterCreate) await input.afterCreate(tx, record);
      return { created: true, record };
    });
  }

  async getFeeRecordsByStudent(studentId: number, schoolId: number, sessionId?: number | null): Promise<FeeRecord[]> {
    const conditions: SQL<unknown>[] = [eq(feeRecords.studentId, studentId), eq(feeRecords.schoolId, schoolId)];
    if (sessionId) conditions.push(eq(feeRecords.sessionId, sessionId));
    return await db.select().from(feeRecords)
      .where(and(...conditions))
      .orderBy(desc(feeRecords.dueDate));
  }

  async getFeeRecordsBySchool(schoolId: number, opts?: { studentId?: number; status?: string; sessionId?: number | null }): Promise<FeeRecord[]> {
    const conditions: any[] = [eq(feeRecords.schoolId, schoolId)];
    if (opts?.studentId) conditions.push(eq(feeRecords.studentId, opts.studentId));
    if (opts?.status) conditions.push(eq(feeRecords.status, opts.status));
    if (opts?.sessionId != null) conditions.push(eq(feeRecords.sessionId, opts.sessionId!));
    return await db.select().from(feeRecords)
      .where(and(...conditions))
      .orderBy(desc(feeRecords.createdAt));
  }

  // invoiceNumber is intentionally excluded: it is assigned once at creation and must never be overwritten.
  async updateFeeRecord(id: number, schoolId: number, data: Omit<Partial<InsertFeeRecord>, "invoiceNumber">, executor: any = db): Promise<FeeRecord | undefined> {
    const [rec] = await executor.update(feeRecords)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(data as any)
      .where(and(eq(feeRecords.id, id), eq(feeRecords.schoolId, schoolId)))
      .returning();
    return rec || undefined;
  }

  async deleteFeeRecord(id: number, schoolId: number, executor: any = db): Promise<boolean> {
    // Explicitly remove all dunning_log rows for this fee record before deleting
    // it.  The FK already has ON DELETE CASCADE so the DB would handle this
    // automatically, but we do it explicitly here so the deletion is logged at
    // the application level and so the intent is unambiguous if the FK
    // constraint is ever altered in the future.
    const dunningDeleted = await executor.delete(dunningLog)
      .where(and(eq(dunningLog.feeRecordId, id), eq(dunningLog.schoolId, schoolId)))
      .returning({ id: dunningLog.id });
    if (dunningDeleted.length > 0) {
      console.log(`[fees] deleted ${dunningDeleted.length} dunning_log row(s) for fee_record #${id} (school ${schoolId})`);
    }

    const result = await executor.delete(feeRecords)
      .where(and(eq(feeRecords.id, id), eq(feeRecords.schoolId, schoolId)))
      .returning();
    return result.length > 0;
  }

  /**
   * Finds all "Due" fee records for a school whose due_date has already passed
   * and marks them "Overdue". Returns the updated records so callers can audit-log them.
   */
  async bulkUpdateOverdueFeeRecords(
    schoolId: number,
    afterUpdate?: (tx: any, records: FeeRecord[]) => Promise<void>,
  ): Promise<FeeRecord[]> {
    return db.transaction(async tx => {
      const records = await tx.update(feeRecords)
        .set({ status: "Overdue" })
        .where(
          and(
            eq(feeRecords.schoolId, schoolId),
            eq(feeRecords.status, "Due"),
            lt(feeRecords.dueDate, sql`CURRENT_DATE`),
            sql`EXISTS (
              SELECT 1
              FROM academic_sessions session_scope
              WHERE session_scope.id = ${feeRecords.sessionId}
                AND session_scope.school_id = ${schoolId}
                AND session_scope.is_active = true
            )`,
          )
        )
        .returning();
      if (afterUpdate && records.length > 0) await afterUpdate(tx, records);
      return records;
    });
  }

  // ===== FEE STRUCTURES =====

  async createFeeStructure(data: InsertFeeStructure, executor: any = db): Promise<FeeStructure> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rec] = await executor.insert(feeStructures).values(data as any).returning();
    return rec;
  }

  async getFeeStructuresBySchool(schoolId: number): Promise<FeeStructure[]> {
    return db.select().from(feeStructures)
      .where(eq(feeStructures.schoolId, schoolId))
      .orderBy(feeStructures.name);
  }

  async updateFeeStructure(id: number, schoolId: number, data: Partial<InsertFeeStructure>, executor: any = db): Promise<FeeStructure | undefined> {
    const [rec] = await executor.update(feeStructures)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(data as any)
      .where(and(eq(feeStructures.id, id), eq(feeStructures.schoolId, schoolId)))
      .returning();
    return rec || undefined;
  }

  async deleteFeeStructure(id: number, schoolId: number, executor: any = db): Promise<boolean> {
    const result = await executor.delete(feeStructures)
      .where(and(eq(feeStructures.id, id), eq(feeStructures.schoolId, schoolId)))
      .returning();
    return result.length > 0;
  }

  async getFeeStructureById(id: number, schoolId: number): Promise<FeeStructure | null> {
    const [rec] = await db.select().from(feeStructures)
      .where(and(eq(feeStructures.id, id), eq(feeStructures.schoolId, schoolId)));
    return rec || null;
  }

  /**
   * Bulk-mark all "Due" fee records whose due_date is strictly before today
   * as "Overdue". Only records in each school's active session are eligible:
   * archived and legacy NULL-session financial history must remain immutable.
   * Returns the number of records updated.
   */
  async markOverdueFeeRecords(): Promise<number> {
    const today = todayInIST(); // YYYY-MM-DD
    const result = await db.update(feeRecords)
      .set({ status: "Overdue" })
      .where(and(
        eq(feeRecords.status, "Due"),
        lt(feeRecords.dueDate, today),
        sql`EXISTS (
          SELECT 1
          FROM academic_sessions session_scope
          WHERE session_scope.id = ${feeRecords.sessionId}
            AND session_scope.school_id = ${feeRecords.schoolId}
            AND session_scope.is_active = true
        )`,
      ))
      .returning({ id: feeRecords.id });
    return result.length;
  }

  // ===== PAYMENT RECORDS =====

  async createPaymentRecord(data: InsertPaymentRecord): Promise<PaymentRecord> {
    // A linked invoice is authoritative for school, student, and session.
    // An arrears payment remains in the original invoice year; no client field
    // may move it to another academic session.
    let resolvedSessionId: number | null;
    if (data.feeRecordId != null) {
      const [linked] = await db
        .select({
          studentId: feeRecords.studentId,
          sessionId: feeRecords.sessionId,
        })
        .from(feeRecords)
        .where(and(eq(feeRecords.id, data.feeRecordId), eq(feeRecords.schoolId, data.schoolId)));
      if (!linked) throw new Error("Fee record not found for this school.");
      if (linked.studentId !== data.studentId) {
        throw new Error("Fee record does not belong to the specified student.");
      }
      if (data.sessionId != null && data.sessionId !== linked.sessionId) {
        throw new Error("Payment session must match the linked invoice session.");
      }
      resolvedSessionId = linked.sessionId ?? null;
    } else if (data.sessionId != null) {
      const [session] = await db
        .select({ id: academicSessions.id })
        .from(academicSessions)
        .where(and(eq(academicSessions.id, data.sessionId), eq(academicSessions.schoolId, data.schoolId)));
      if (!session) throw new Error("Academic session does not belong to this school.");
      resolvedSessionId = session.id;
    } else {
      const active = await this.getActiveSession(data.schoolId);
      resolvedSessionId = active?.id ?? null;
    }
    const [rec] = await db.insert(paymentRecords).values({ ...data, sessionId: resolvedSessionId }).returning();
    return rec;
  }

  async getPaymentRecordsBySchool(schoolId: number, opts?: { studentId?: number; feeRecordId?: number; sessionId?: number | null }) {
    const conditions: any[] = [eq(paymentRecords.schoolId, schoolId)];
    if (opts?.studentId) conditions.push(eq(paymentRecords.studentId, opts.studentId));
    if (opts?.feeRecordId !== undefined) conditions.push(eq(paymentRecords.feeRecordId, opts.feeRecordId));
    if (opts?.sessionId != null) conditions.push(eq(paymentRecords.sessionId, opts.sessionId!));
    // LEFT JOIN fee_records to resolve invoice_number without adding a column to payment_records.
    // Orphan records (fee_record_id = NULL) or historical records (invoice_number = NULL) → invoiceNumber: null → shown as "—" in UI.
    const rows = await db
      .select()
      .from(paymentRecords)
      .leftJoin(feeRecords, eq(paymentRecords.feeRecordId, feeRecords.id))
      .where(and(...conditions))
      .orderBy(desc(paymentRecords.createdAt));
    return rows.map(r => ({ ...r.payment_records, invoiceNumber: r.fee_records?.invoiceNumber ?? null }));
  }

  async getPaymentRecordByIdempotencyKey(key: string, schoolId?: number): Promise<PaymentRecord | null> {
    const conditions: any[] = [eq(paymentRecords.idempotencyKey, key)];
    if (schoolId !== undefined) conditions.push(eq(paymentRecords.schoolId, schoolId));
    const [rec] = await db.select().from(paymentRecords).where(and(...conditions));
    return rec || null;
  }

  // ===== RECEIPT SEQUENCES =====

  // Read-only peek — returns what the NEXT number would be without incrementing.
  // Safe to call as many times as needed (modal open previews, no DB writes).
  // padLength controls zero-padding width (default 2 for ON/OF, use 4 for INV-).
  async peekReceiptNumber(schoolId: number, prefix: string, padLength = 2): Promise<string> {
    const result = await db.execute(
      sql`SELECT current_number FROM receipt_sequences WHERE school_id = ${schoolId} AND prefix = ${prefix}`,
    );
    const current = Number((result.rows[0] as any)?.current_number ?? 0);
    return `${prefix}${String(current + 1).padStart(padLength, "0")}`;
  }

  // ===== RECEIPT SEQUENCES =====
  // Atomically increments the counter for `prefix` (e.g. "OF", "INV-") and
  // returns the formatted number (e.g. "OF01", "INV-0001").
  // Uses INSERT … ON CONFLICT DO UPDATE so it self-seeds on first use.
  // Scoped per (school_id, prefix) — each school has its own counter.
  // Deleting ledger rows NEVER touches this table — numbers are permanent.
  //
  // padLength controls zero-padding width:
  //   Default 2 → "ON01", "OF07"
  //   Pass  4  → "INV-0001", "INV-0042"
  //
  // IMPORTANT — INTENTIONAL GAP BEHAVIOUR:
  //   This function is called BEFORE the surrounding DB transaction in the
  //   regular payment flow (POST /api/admin/fees/payments).  If the
  //   transaction rolls back after this call (server crash, overpayment
  //   guard, network failure, etc.) the incremented counter is NOT rolled
  //   back — the number is permanently consumed but never stored.  The
  //   resulting gap in the sequence is deliberate: it guarantees that
  //   no two payments ever share a receipt number, even under concurrent
  //   requests or partial failures.  Gaps do NOT represent missing or
  //   duplicated payments.
  async nextReceiptNumber(schoolId: number, prefix: string, padLength = 2): Promise<string> {
    const result = await db.execute(
      sql`INSERT INTO receipt_sequences (school_id, prefix, current_number)
          VALUES (${schoolId}, ${prefix}, 1)
          ON CONFLICT (school_id, prefix) DO UPDATE
            SET current_number = receipt_sequences.current_number + 1
          RETURNING current_number`,
    );
    const n = Number((result.rows[0] as any).current_number);
    return `${prefix}${String(n).padStart(padLength, "0")}`;
  }

  // ===== FEE AUDIT LOG =====

  async appendFeeAuditLog(entry: {
    schoolId: number; actorId?: number | null; actorName?: string | null;
    ipAddress?: string | null; action: string; entityType?: string | null;
    entityId?: number | null; studentId?: number | null; studentName?: string | null;
    studentIdentifier?: string | null;
    sessionId?: number | null; recordLabel?: string | null; amount?: number | null;
    eventKey?: string | null;
    actorTeacherId?: number | null; actorStaffId?: number | null; actorType?: string;
    actorRole?: string; actorIdentifier?: string; description?: string | null;
  }): Promise<FeeAuditLog> {
    if (entry.sessionId != null) {
      const [session] = await db.select({ id: academicSessions.id })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, entry.sessionId),
          eq(academicSessions.schoolId, entry.schoolId),
        ));
      if (!session) throw new Error("Fee audit session does not belong to this school.");
    }
    const [rec] = await db.insert(feeAuditLog).values(entry as any).returning();
    return rec;
  }

  async getFeeAuditLog(
    schoolId: number,
    limit = 50,
    offset = 0,
    from?: string | null,
    to?: string | null,
    action?: string | null,
    search?: string | null,
    sessionId?: number | null,
  ): Promise<{
    entries: Array<{
      id: number;
      actorName: string;
      actorRole: string;
      actorIdentifier: string;
      actorType: string;
      action: string;
      actionLabel: string;
      entityType: string | null;
      entityId: number | null;
      studentId: number | null;
      studentName: string | null;
      studentIdentifier: string | null;
      recordLabel: string | null;
      amount: number | null;
      currency: string;
      sessionId: number | null;
      description: string;
      createdAt: Date | string;
    }>;
    total: number;
    actionOptions: Array<{ value: string; label: string }>;
  }> {
    const searchTrimmed = search?.trim() || null;
    const searchPat = searchTrimmed
      ? `%${searchTrimmed.replace(/[\\%_]/g, "\\$&")}%`
      : null;
    const fromClause = from
      ? sql`AND (fal.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date`
      : sql``;
    const toClause = to
      ? sql`AND (fal.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date`
      : sql``;
    const actionClause = action ? sql`AND fal.action = ${action}` : sql``;
    const sessionClause = sessionId ? sql`AND fal.session_id = ${sessionId}` : sql``;
    const searchableActorName = searchableFeeAuditText(sql`fal.actor_name`);
    const searchableRecordLabel = searchableFeeAuditText(sql`fal.record_label`);
    const searchableDescription = searchableFeeAuditText(sql`fal.description`);
    const searchClause = searchPat
      ? sql`AND (
          ${searchableActorName} ILIKE ${searchPat}
          OR COALESCE(fal.actor_identifier, '') ILIKE ${searchPat}
          OR COALESCE(fal.student_name, '') ILIKE ${searchPat}
          OR COALESCE(fal.student_identifier, '') ILIKE ${searchPat}
          OR COALESCE(fal.student_id::text, '') ILIKE ${searchPat}
          OR COALESCE(fal.entity_id::text, '') ILIKE ${searchPat}
          OR ${searchableRecordLabel} ILIKE ${searchPat}
          OR ${searchableDescription} ILIKE ${searchPat}
        )`
      : sql``;

    const [countResult, rowsResult] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM fee_audit_log fal
        WHERE fal.school_id = ${schoolId}
          ${fromClause} ${toClause} ${actionClause} ${sessionClause} ${searchClause}
      `),
      db.execute(sql`
        SELECT
          fal.id,
          fal.actor_type,
          fal.actor_name,
          fal.actor_role,
          fal.actor_identifier,
          fal.action,
          fal.entity_type,
          fal.entity_id,
          fal.student_id,
          NULLIF(fal.student_name, '') AS student_name,
          NULLIF(fal.student_identifier, '') AS student_identifier,
          fal.record_label,
          fal.amount,
          COALESCE(fal.currency, 'INR') AS currency,
          fal.session_id,
          COALESCE(NULLIF(fal.description, ''), 'Activity recorded.') AS description,
          fal.created_at
        FROM fee_audit_log fal
        WHERE fal.school_id = ${schoolId}
          ${fromClause} ${toClause} ${actionClause} ${sessionClause} ${searchClause}
        ORDER BY fal.created_at DESC, fal.id DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);

    const entries = (rowsResult.rows as any[]).map((row) => {
      const recordLabel = safeFeeAuditRecordLabel(row.record_label);
      const actor = normalizeFeeAuditActorDisplay({
        actorType: row.actor_type,
        actorName: row.actor_name,
        actorRole: row.actor_role,
        actorIdentifier: row.actor_identifier,
        action: row.action,
        studentId: row.student_id,
        studentName: row.student_name,
        studentIdentifier: row.student_identifier,
      });
      return {
        id: Number(row.id),
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        actorIdentifier: actor.actorIdentifier,
        actorType: actor.actorType,
        action: String(row.action),
        actionLabel: feeAuditActionLabel(String(row.action), row.entity_type, row.entity_id),
        entityType: row.entity_type ?? null,
        entityId: row.entity_id == null ? null : Number(row.entity_id),
        studentId: row.student_id == null ? null : Number(row.student_id),
        studentName: row.student_name ?? null,
        studentIdentifier: row.student_identifier ?? null,
        recordLabel,
        amount: row.amount == null ? null : Number(row.amount),
        currency: String(row.currency ?? "INR"),
        sessionId: row.session_id == null ? null : Number(row.session_id),
        description: safeFeeAuditDescription({
          action: String(row.action),
          description: row.description,
          recordLabel,
        }),
        createdAt: row.created_at,
      };
    });
    return {
      entries,
      total: Number((countResult.rows[0] as any)?.cnt ?? 0),
      actionOptions: CURRENT_FEE_AUDIT_ACTION_OPTIONS.map(option => ({ ...option })),
    };
  }

  // ===== EXTERNAL PAYMENT SETTINGS =====

  async getExternalPaymentSettings(schoolId: number): Promise<ExternalPaymentSettings | null> {
    const [rec] = await db.select().from(externalPaymentSettings)
      .where(eq(externalPaymentSettings.schoolId, schoolId));
    return rec || null;
  }

  async upsertExternalPaymentSettings(schoolId: number, data: {
    isEnabled: boolean; gatewayUrl?: string | null; bannerMessage?: string | null; lastUpdatedBy?: number | null;
    razorpayEnabled?: boolean; razorpayKeyId?: string | null; razorpayKeySecret?: string | null; razorpayWebhookSecret?: string | null; razorpayMode?: string;
  }, executor: any = db): Promise<ExternalPaymentSettings> {
    const [rec] = await executor.insert(externalPaymentSettings)
      .values({ schoolId, ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: externalPaymentSettings.schoolId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return rec;
  }

  // ===== NOTIFICATION CONFIG =====

  async getNotificationConfig(schoolId: number): Promise<NotificationConfig | null> {
    const [rec] = await db.select().from(notificationConfig).where(eq(notificationConfig.schoolId, schoolId));
    return rec || null;
  }

  async upsertNotificationConfig(schoolId: number, data: Partial<Omit<NotificationConfig, "id" | "schoolId" | "updatedAt">>, executor: any = db): Promise<NotificationConfig> {
    const [rec] = await executor.insert(notificationConfig)
      .values({ schoolId, ...data, updatedAt: new Date() } as any)
      .onConflictDoUpdate({
        target: notificationConfig.schoolId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return rec;
  }

  async getDunningLog(schoolId: number, limit = 50): Promise<DunningLog[]> {
    return db.select().from(dunningLog)
      .where(eq(dunningLog.schoolId, schoolId))
      .orderBy(desc(dunningLog.sentAt))
      .limit(limit);
  }

  async getDunningLogByStudent(studentId: number, schoolId: number, sessionId?: number | null): Promise<{ id: number; feeRecordId: number | null; channel: string; stage: string; sentAt: Date | null; status: string; recipient: string | null; studentName: string | null; feeRecordDeleted: boolean }[]> {
    // Filter by student via a sub-select rather than an INNER JOIN so the query
    // does not silently drop dunning_log rows whose fee record was deleted.
    // LEFT JOIN fee_records is kept so we can expose a feeRecordDeleted flag to
    // callers; with ON DELETE CASCADE in place those rows should never exist, but
    // the LEFT JOIN makes the view defensive against manual DB changes.
    const sessionCondition = sessionId != null
      ? sql`AND session_id = ${sessionId}`
      : sql``;
    const result = await db.execute(
      sql`SELECT dl.id, dl.fee_record_id, dl.channel, dl.stage, dl.sent_at, dl.status,
                 dl.recipient, dl.student_name,
                 (fr.id IS NULL) AS fee_record_deleted
          FROM dunning_log dl
          LEFT JOIN fee_records fr ON fr.id = dl.fee_record_id AND fr.school_id = dl.school_id
          WHERE dl.school_id = ${schoolId}
            AND dl.fee_record_id IN (
              SELECT id
              FROM fee_records
              WHERE student_id = ${studentId}
                AND school_id = ${schoolId}
                ${sessionCondition}
            )
          ORDER BY dl.sent_at DESC
          LIMIT 200`
    );
    return (result.rows as any[]).map((row) => ({
      id: Number(row.id),
      feeRecordId: row.fee_record_id == null ? null : Number(row.fee_record_id),
      channel: row.channel,
      stage: row.stage,
      sentAt: row.sent_at ?? null,
      status: row.status,
      recipient: row.recipient ?? null,
      studentName: row.student_name ?? null,
      feeRecordDeleted: Boolean(row.fee_record_deleted),
    }));
  }

  // ===== FEE SUMMARY =====

  async getFeeSummary(schoolId: number, sessionId?: number | null): Promise<{
    totalRevenue: number; outstanding: number; collectionRate: number; offlinePaymentsCount: number;
  }> {
    // Total revenue = actual money received (sum of all payment_records), not invoice amounts.
    const sessionJoin = sessionId != null
      ? sql`AND (pr.session_id = ${sessionId} OR (pr.session_id IS NULL AND fr2.session_id = ${sessionId}))`
      : sql``;
    const revenueRow = await db.execute(sql`
      SELECT COALESCE(SUM(pr.amount), 0)::int AS total_revenue
      FROM payment_records pr
      LEFT JOIN fee_records fr2 ON fr2.id = pr.fee_record_id
      WHERE pr.school_id = ${schoolId}
      ${sessionJoin}
    `);
    const totalRevenue = Number((revenueRow.rows[0] as any)?.total_revenue) || 0;

    // Outstanding = the remaining amount on unpaid invoices.
    const sessionCond = sessionId != null ? sql`AND fr.session_id = ${sessionId}` : sql``;
    const outstandingRow = await db.execute(sql`
      SELECT COALESCE(SUM(GREATEST(fr.amount - COALESCE(p.total_paid, 0), 0)), 0)::int AS outstanding
      FROM fee_records fr
      LEFT JOIN (
        SELECT fee_record_id, SUM(amount)::int AS total_paid
        FROM payment_records
        WHERE school_id = ${schoolId} AND fee_record_id IS NOT NULL
        GROUP BY fee_record_id
      ) p ON p.fee_record_id = fr.id
      WHERE fr.school_id = ${schoolId}
        AND fr.status IN ('Due', 'Overdue')
      ${sessionCond}
    `);
    const outstanding = Number((outstandingRow.rows[0] as any)?.outstanding) || 0;

    const total = totalRevenue + outstanding;
    const collectionRate = total > 0 ? Math.round((totalRevenue / total) * 100) : 0;
    let offlineCount: number;
    if (sessionId != null) {
      // Count payments that belong to this session via either path:
      //   a) payment_records.session_id = sessionId  (new rows + backfilled rows)
      //   b) session_id IS NULL but linked fee_record.session_id = sessionId  (legacy fallback)
      const [{ cnt }] = await db
        .select({ cnt: sql<string>`COUNT(DISTINCT ${paymentRecords.id})` })
        .from(paymentRecords)
        .leftJoin(feeRecords, eq(paymentRecords.feeRecordId, feeRecords.id))
        .where(
          and(
            eq(paymentRecords.schoolId, schoolId),
            or(
              eq(paymentRecords.sessionId, sessionId),
              and(isNull(paymentRecords.sessionId), eq(feeRecords.sessionId, sessionId)),
            ),
          ),
        );
      offlineCount = Number(cnt);
    } else {
      const [{ cnt }] = await db.select({ cnt: count() }).from(paymentRecords)
        .where(eq(paymentRecords.schoolId, schoolId));
      offlineCount = Number(cnt);
    }
    return { totalRevenue, outstanding, collectionRate, offlinePaymentsCount: offlineCount };
  }

  // ===== EXAM POLICY TIERS =====

  async getExamPolicyTiers(schoolId: number): Promise<ExamPolicyTier[]> {
    return await db.select().from(examPolicyTiers)
      .where(eq(examPolicyTiers.schoolId, schoolId))
      .orderBy(examPolicyTiers.createdAt);
  }

  async createExamPolicyTier(data: InsertExamPolicyTier): Promise<ExamPolicyTier> {
    return db.transaction(async tx => {
      await lockPromotionConfiguration(tx, data.schoolId);
      const [inserted] = await tx.insert(examPolicyTiers).values(data).returning();
      return inserted;
    });
  }

  async updateExamPolicyTier(id: number, schoolId: number, data: Partial<InsertExamPolicyTier>): Promise<ExamPolicyTier | undefined> {
    return db.transaction(async tx => {
      await lockPromotionConfiguration(tx, schoolId);
      const [updated] = await tx.update(examPolicyTiers)
        .set(data)
        .where(and(eq(examPolicyTiers.id, id), eq(examPolicyTiers.schoolId, schoolId)))
        .returning();
      return updated ?? undefined;
    });
  }

  async deleteExamPolicyTier(id: number, schoolId: number): Promise<boolean> {
    return db.transaction(async tx => {
      await lockPromotionConfiguration(tx, schoolId);
      const result = await tx.delete(examPolicyTiers)
        .where(and(eq(examPolicyTiers.id, id), eq(examPolicyTiers.schoolId, schoolId)))
        .returning();
      return result.length > 0;
    });
  }

  // ── Promotion Ledger ──────────────────────────────────────────────────────

  /** Fetch saved promotion decisions for one class/section/term in one academic session. */
  async getPromotionDecisions(schoolId: number, cls: string, section: string, term: string, sessionId: number): Promise<PromotionDecision[]> {
    return db.select().from(promotionDecisions).where(
      and(
        eq(promotionDecisions.schoolId, schoolId),
        eq(promotionDecisions.class, cls),
        eq(promotionDecisions.section, section),
        eq(promotionDecisions.term, term),
        eq(promotionDecisions.sessionId, sessionId),
      )
    );
  }

  /** Bulk upsert promotion decisions; optionally lock the ledger for this class/section/term.
   *  sessionId tags every record to the correct academic year for session-scoped isolation. */
  async savePromotionDecisions(
    schoolId: number, cls: string, section: string, term: string,
    teacherId: number, lock: boolean,
    entries: Array<{ studentId: number; decision: string; targetClass: string; targetSection: string; editCount: number; autoSuggestion?: string }>,
    sessionId: number,
  ): Promise<boolean> {
    const now = new Date();
    return db.transaction(async (tx) => {
      await lockPromotionCohort(tx, schoolId, sessionId, cls, section);
      const evaluation = await loadPromotionCohortEvaluation(tx, schoolId, sessionId, cls, section, term);
      assertPromotionGateEnabled(evaluation.policy, term);
      // The conflict identity includes sessionId; serialize concurrent saves
      // only for the same school/session/cohort/student identity.
      const studentIds = [...new Set(entries.map(entry => entry.studentId))].sort((a, b) => a - b);
      if (entries.length === 0 || studentIds.length !== entries.length) {
        throw new PromotionStage1Error(
          "Promotion decisions must contain unique Students.",
          400,
          "PROMOTION_DECISION_INVALID",
        );
      }
      const rosterStudentIds = new Set<number>(evaluation.rosterRows.map((row: { studentId: number }) => row.studentId));
      if (studentIds.some(studentId => !rosterStudentIds.has(studentId))) {
        throw new PromotionStage1Error(
          "Promotion decisions must use the exact active session class-section roster.",
          403,
          "STUDENT_NOT_ACCESSIBLE",
        );
      }
      if (lock && (
        studentIds.length !== rosterStudentIds.size ||
        [...rosterStudentIds].some(studentId => !studentIds.includes(studentId))
      )) {
        throw new PromotionStage1Error(
          "A Teacher cannot lock a ledger until every Student in the active session class-section has a complete decision.",
          409,
          "PROMOTION_LEDGER_INCOMPLETE",
        );
      }
      const [targetMetadata] = await tx.select({
        classes: schoolMetadata.metaValue,
      }).from(schoolMetadata).where(and(
        eq(schoolMetadata.schoolId, schoolId),
        eq(schoolMetadata.metaKey, "classes"),
      )).limit(1).for("update");
      const [sectionMetadata] = await tx.select({
        sections: schoolMetadata.metaValue,
      }).from(schoolMetadata).where(and(
        eq(schoolMetadata.schoolId, schoolId),
        eq(schoolMetadata.metaKey, "class_sections"),
      )).limit(1).for("update");
      let configuredClasses: string[] = [];
      let configuredSections: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(targetMetadata?.classes ?? "[]");
        if (Array.isArray(parsed)) configuredClasses = parsed.filter((value): value is string => typeof value === "string");
      } catch {}
      try {
        const parsed: unknown = JSON.parse(sectionMetadata?.sections ?? "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          configuredSections = parsed as Record<string, unknown>;
        }
      } catch {}
      const resultByStudent = evaluation.resultsByStudent as Map<number, {
        resultStatus: "complete" | "incomplete"; promoted: boolean | null;
      }>;
      for (const entry of entries) {
        const result = resultByStudent.get(entry.studentId);
        const expectedSuggestion = result?.promoted === null || !result
          ? null
          : result.promoted ? "promoted" : "retained";
        if (
          result?.resultStatus !== "complete" ||
          expectedSuggestion === null ||
          entry.autoSuggestion !== expectedSuggestion ||
          !["promoted", "retained"].includes(entry.decision) ||
          !configuredClasses.includes(entry.targetClass) ||
          !Array.isArray(configuredSections[entry.targetClass]) ||
          !(configuredSections[entry.targetClass] as unknown[]).includes(entry.targetSection) ||
          (entry.decision === "retained" &&
            (entry.targetClass !== cls || entry.targetSection !== section))
        ) {
          throw new PromotionStage1Error(
            "Only complete results may receive an explicit, configured Promotion decision; no default is assigned to incomplete Students.",
            409,
            "PROMOTION_DECISION_INVALID",
          );
        }
      }
      const [authorizedTeacher] = await tx.select({ id: teachers.id })
        .from(teachers).where(and(
          eq(teachers.id, teacherId),
          eq(teachers.schoolId, schoolId),
        )).for("update");
      if (!authorizedTeacher) {
        throw new PromotionStage1Error(
          "The decision must be saved by a Teacher in this school.",
          403,
          "TEACHER_NOT_ACCESSIBLE",
        );
      }

      if (studentIds.length > 0) {
        const lockedStudents = await tx
          .select({ id: students.id })
          .from(students)
          .where(and(
            eq(students.schoolId, schoolId),
            inArray(students.id, studentIds),
          ))
          .orderBy(students.id)
          .for("update");
        if (lockedStudents.length !== studentIds.length) {
          throw new PromotionStage1Error(
            "Promotion decisions include a Student outside this school.",
            403,
            "STUDENT_NOT_ACCESSIBLE",
          );
        }
      }
      for (const studentId of studentIds) {
        const conflictIdentity = JSON.stringify([schoolId, sessionId, cls, section, term, studentId]);
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${conflictIdentity}, 0))
        `);
      }

      const existingCohortRows = await tx
        .select({
          studentId: promotionDecisions.studentId,
          decision: promotionDecisions.decision,
          targetClass: promotionDecisions.targetClass,
          targetSection: promotionDecisions.targetSection,
          editCount: promotionDecisions.editCount,
          processedByTeacherId: promotionDecisions.processedByTeacherId,
          locked: promotionDecisions.locked,
          autoSuggestion: promotionDecisions.autoSuggestion,
          manualIntervention: promotionDecisions.manualIntervention,
          adminExecuted: promotionDecisions.adminExecuted,
        })
        .from(promotionDecisions)
        .where(and(
          eq(promotionDecisions.schoolId, schoolId),
          eq(promotionDecisions.class, cls),
          eq(promotionDecisions.section, section),
          eq(promotionDecisions.term, term),
          eq(promotionDecisions.sessionId, sessionId),
        ))
        .orderBy(promotionDecisions.studentId)
        .for("update");
      const affectedStudentIds = new Set([
        ...studentIds,
        ...(!lock ? existingCohortRows.map(row => row.studentId) : []),
      ]);
      if (!lock && existingCohortRows.some(row => row.locked)) {
        throw new PromotionStage1Error(
          "A locked Teacher Promotion ledger cannot be unlocked or edited.",
          409,
          "PROMOTION_DECISION_LOCKED",
        );
      }
      if (existingCohortRows.some(row => row.adminExecuted && affectedStudentIds.has(row.studentId))) {
        throw new PromotionStage1Error(
          "An executed Promotion decision is locked and cannot be changed.",
          409,
          "PROMOTION_DECISION_EXECUTED",
        );
      }

      for (const entry of entries) {
        const existing = existingCohortRows.find(row => row.studentId === entry.studentId);
        if (existing?.locked) {
          const unchanged = existing.decision === entry.decision
            && existing.targetClass === entry.targetClass
            && existing.targetSection === entry.targetSection
            && existing.editCount === entry.editCount
            && existing.processedByTeacherId === teacherId
            && existing.autoSuggestion === entry.autoSuggestion
            && existing.manualIntervention === (entry.autoSuggestion !== entry.decision);
          if (!unchanged) {
            throw new PromotionStage1Error(
              "A locked Teacher decision cannot be changed.",
              409,
              "PROMOTION_DECISION_LOCKED",
            );
          }
          continue;
        }
        const isManual = entry.autoSuggestion !== entry.decision;
        await tx.insert(promotionDecisions).values({
          schoolId, class: cls, section, term,
          studentId: entry.studentId,
          decision: entry.decision,
          targetClass: entry.targetClass,
          targetSection: entry.targetSection,
          editCount: entry.editCount,
          processedByTeacherId: teacherId,
          locked: lock,
          lockedAt: lock ? now : null,
          autoSuggestion: entry.autoSuggestion ?? null,
          manualIntervention: isManual,
          updatedAt: now,
          sessionId,
        }).onConflictDoUpdate({
          target: [
            promotionDecisions.schoolId,
            promotionDecisions.sessionId,
            promotionDecisions.class,
            promotionDecisions.section,
            promotionDecisions.term,
            promotionDecisions.studentId,
          ],
          set: {
            decision: entry.decision,
            targetClass: entry.targetClass,
            targetSection: entry.targetSection,
            editCount: entry.editCount,
            processedByTeacherId: teacherId,
            locked: lock,
            lockedAt: lock ? now : null,
            autoSuggestion: entry.autoSuggestion ?? null,
            manualIntervention: isManual,
            updatedAt: now,
            sessionId,
          },
        });
      }
      return true;
    });
  }

  async getLedgerStatus(schoolId: number, term: string, sessionId: number): Promise<Array<{
    class: string; section: string; term: string;
    status: "none" | "draft" | "locked";
    totalStudents: number; lockedCount: number; manualInterventionCount: number;
    teacherName: string | null; teacherId: number | null; lockedAt: Date | null;
    adminExecuted: boolean;
  }>> {
    // ── 1. School-configured class-sections + ordered class list ─────────────
    const [csRows, classesRows] = await Promise.all([
      db.select().from(schoolMetadata)
        .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_sections")))
        .limit(1),
      db.select().from(schoolMetadata)
        .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "classes")))
        .limit(1),
    ]);
    let classSectionsMap: Record<string, string[]> = {};
    let orderedClasses: string[] = [];
    try {
      const p = JSON.parse(csRows[0]?.metaValue ?? "{}");
      if (p && typeof p === "object" && !Array.isArray(p)) classSectionsMap = p;
    } catch {}
    try { orderedClasses = JSON.parse(classesRows[0]?.metaValue ?? "[]"); } catch {}

    // ── 2. Promotion decisions for this term ──────────────────────────────────
    const rows = await db
      .select({
        class: promotionDecisions.class,
        section: promotionDecisions.section,
        term: promotionDecisions.term,
        locked: promotionDecisions.locked,
        lockedAt: promotionDecisions.lockedAt,
        manualIntervention: promotionDecisions.manualIntervention,
        teacherId: promotionDecisions.processedByTeacherId,
        teacherName: teachers.fullName,
        adminExecuted: promotionDecisions.adminExecuted,
      })
      .from(promotionDecisions)
      .leftJoin(teachers, eq(promotionDecisions.processedByTeacherId, teachers.id))
      .where(and(
        eq(promotionDecisions.schoolId, schoolId),
        eq(promotionDecisions.term, term),
        eq(promotionDecisions.sessionId, sessionId),
      ));

    // ── 3. Faculty mappings → assigned teacher per class-section ─────────────
    const mappingRows = await db
      .select({
        className: facultyMappings.className,
        section: facultyMappings.section,
        teacherName: teachers.fullName,
        teacherId: teachers.id,
      })
      .from(facultyMappings)
      .innerJoin(teachers, eq(facultyMappings.teacherId, teachers.id))
      .where(eq(facultyMappings.schoolId, schoolId));

    const mappedTeacher: Record<string, { name: string; id: number }> = {};
    for (const m of mappingRows) {
      const key = `${m.className}|${m.section}`;
      if (!mappedTeacher[key]) mappedTeacher[key] = { name: m.teacherName, id: m.teacherId };
    }

    // ── 4. Aggregate promotion_decisions into per-class-section buckets ───────
    //   Three student-level state buckets per section:
    //   executedCount  — admin has run the wizard for this student (adminExecuted=true)
    //   readyCount     — teacher locked this student, admin has NOT yet executed
    //   pendingCount   — no lock at all (draft or untouched)
    type AggBucket = {
      cls: string; sec: string;
      total: number; interventionCount: number;
      teacherName: string | null; teacherId: number | null; lockedAt: Date | null;
      executedCount: number;
      readyCount: number;
      pendingCount: number;
    };
    const buckets: Record<string, AggBucket> = {};
    for (const r of rows) {
      const key = `${r.class}|${r.section}`;
      if (!buckets[key]) {
        buckets[key] = {
          cls: r.class, sec: r.section, total: 0, interventionCount: 0,
          teacherName: r.teacherName ?? null, teacherId: r.teacherId ?? null,
          lockedAt: r.lockedAt ?? null,
          executedCount: 0, readyCount: 0, pendingCount: 0,
        };
      }
      const b = buckets[key];
      b.total++;
      if (r.manualIntervention) b.interventionCount++;
      if (r.lockedAt && (!b.lockedAt || r.lockedAt > b.lockedAt)) b.lockedAt = r.lockedAt;
      if (r.teacherName) b.teacherName = r.teacherName;
      if (r.teacherId)   b.teacherId   = r.teacherId;
      if (r.adminExecuted) {
        b.executedCount++;
      } else if (r.locked) {
        b.readyCount++;    // locked by teacher, awaiting admin action
      } else {
        b.pendingCount++;  // not locked — teacher hasn't finalised yet
      }
    }

    // Helper: derive the section-level status from the three counts
    function deriveStatus(b: AggBucket): "none" | "draft" | "locked" {
      if (b.total === 0) return "none";
      // "locked" = every recorded student is either executed or ready (none pending)
      if (b.pendingCount === 0) return "locked";
      return "draft";
    }

    // ── 5. Merge: all configured class-sections + any extras from DB ──────────
    type ResultRow = {
      class: string; section: string; term: string;
      status: "none" | "draft" | "locked";
      totalStudents: number; lockedCount: number; manualInterventionCount: number;
      teacherName: string | null; teacherId: number | null; lockedAt: Date | null;
      // adminExecuted = true ONLY when ALL students in the cohort have been executed
      adminExecuted: boolean;
      executedCount: number;
      readyCount: number;
      pendingCount: number;
    };
    const result: ResultRow[] = [];
    const seen = new Set<string>();

    for (const [cls, sections] of Object.entries(classSectionsMap)) {
      for (const sec of (sections as string[])) {
        const key = `${cls}|${sec}`;
        seen.add(key);
        const b = buckets[key];
        const mapped = mappedTeacher[key];
        result.push(b ? {
          class: cls, section: sec, term,
          status: deriveStatus(b),
          totalStudents: b.total,
          lockedCount: b.readyCount + b.executedCount,   // all processed rows
          manualInterventionCount: b.interventionCount,
          teacherName: b.teacherName || mapped?.name || null,
          teacherId:   b.teacherId   || mapped?.id   || null,
          lockedAt:    b.lockedAt,
          adminExecuted: b.executedCount > 0 && b.readyCount === 0 && b.pendingCount === 0,
          executedCount: b.executedCount,
          readyCount:    b.readyCount,
          pendingCount:  b.pendingCount,
        } : {
          class: cls, section: sec, term,
          status: "none",
          totalStudents: 0, lockedCount: 0, manualInterventionCount: 0,
          teacherName: mapped?.name || null, teacherId: mapped?.id || null,
          lockedAt: null, adminExecuted: false,
          executedCount: 0, readyCount: 0, pendingCount: 0,
        });
      }
    }

    // Include any class-sections from promotion_decisions not in the config map
    for (const [key, b] of Object.entries(buckets)) {
      if (!seen.has(key)) {
        result.push({
          class: b.cls, section: b.sec, term,
          status: deriveStatus(b),
          totalStudents: b.total,
          lockedCount: b.readyCount + b.executedCount,
          manualInterventionCount: b.interventionCount,
          teacherName: b.teacherName, teacherId: b.teacherId,
          lockedAt: b.lockedAt,
          adminExecuted: b.executedCount > 0 && b.readyCount === 0 && b.pendingCount === 0,
          executedCount: b.executedCount,
          readyCount:    b.readyCount,
          pendingCount:  b.pendingCount,
        });
      }
    }

    return result.sort((a, b) => {
      const ia = orderedClasses.indexOf(a.class);
      const ib = orderedClasses.indexOf(b.class);
      const ca = (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return ca !== 0 ? ca : a.section.localeCompare(b.section);
    });
  }

  /**
   * Web-only, read-only readiness projection. Mobile keeps the legacy ledger
   * response contract; execution still revalidates every submitted Student.
   */
  async getPromotionLedgerReadinessStatus(schoolId: number, term: string, sessionId: number) {
    const rows = await this.getLedgerStatus(schoolId, term, sessionId);
    return db.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
      const [session] = await tx.select({
        id: academicSessions.id,
        schoolId: academicSessions.schoolId,
        isActive: academicSessions.isActive,
      }).from(academicSessions).where(and(
        eq(academicSessions.id, sessionId),
        eq(academicSessions.schoolId, schoolId),
      ));
      if (!session) {
        throw new PromotionStage1Error(
          "The selected Academic Session is not accessible.",
          403,
          "SESSION_NOT_ACCESSIBLE",
        );
      }

      const decisions = await tx.select({
        className: promotionDecisions.class,
        sectionName: promotionDecisions.section,
        studentId: promotionDecisions.studentId,
        decision: promotionDecisions.decision,
        targetClass: promotionDecisions.targetClass,
        targetSection: promotionDecisions.targetSection,
        locked: promotionDecisions.locked,
        autoSuggestion: promotionDecisions.autoSuggestion,
        manualIntervention: promotionDecisions.manualIntervention,
        processedByTeacherId: promotionDecisions.processedByTeacherId,
        adminExecuted: promotionDecisions.adminExecuted,
      }).from(promotionDecisions).where(and(
        eq(promotionDecisions.schoolId, schoolId),
        eq(promotionDecisions.sessionId, sessionId),
        eq(promotionDecisions.term, term),
      ));
      const decisionsByCohort = new Map<string, typeof decisions>();
      for (const decision of decisions) {
        const key = `${decision.className}|${decision.sectionName}`;
        const bucket = decisionsByCohort.get(key) ?? [];
        bucket.push(decision);
        decisionsByCohort.set(key, bucket);
      }

      const rosterByCohort = new Map<string, Set<number>>();
      if (session.isActive) {
        const rosterRows = await tx.select({
          studentId: students.id,
          className: enrollments.className,
          sectionName: enrollments.sectionName,
        }).from(enrollments).innerJoin(students, and(
          eq(students.id, enrollments.studentId),
          eq(students.schoolId, enrollments.schoolId),
        )).where(and(
          eq(enrollments.schoolId, schoolId),
          eq(enrollments.sessionId, sessionId),
          eq(enrollments.status, "Active"),
          eq(students.isActive, true),
        ));
        for (const roster of rosterRows) {
          const key = `${roster.className}|${roster.sectionName}`;
          const bucket = rosterByCohort.get(key) ?? new Set<number>();
          bucket.add(roster.studentId);
          rosterByCohort.set(key, bucket);
        }
      }

      const teacherIds = [...new Set(decisions
        .map(decision => decision.processedByTeacherId)
        .filter((id): id is number => id !== null))];
      const validTeacherIds = new Set(teacherIds.length
        ? (await tx.select({ id: teachers.id }).from(teachers).where(and(
            eq(teachers.schoolId, schoolId),
            inArray(teachers.id, teacherIds),
          ))).map(teacher => teacher.id)
        : []);
      const configRows = await tx.select({
        metaKey: schoolMetadata.metaKey,
        metaValue: schoolMetadata.metaValue,
      }).from(schoolMetadata).where(and(
        eq(schoolMetadata.schoolId, schoolId),
        inArray(schoolMetadata.metaKey, ["classes", "class_sections"]),
      ));
      const config = new Map(configRows.map(row => [row.metaKey, row.metaValue]));
      let configuredClasses: string[] = [];
      let configuredSections: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(config.get("classes") ?? "[]");
        if (Array.isArray(parsed)) configuredClasses = parsed.filter((value): value is string => typeof value === "string");
      } catch {}
      try {
        const parsed: unknown = JSON.parse(config.get("class_sections") ?? "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          configuredSections = parsed as Record<string, unknown>;
        }
      } catch {}

      const projectedRows = [];
      for (const row of rows) {
        const key = `${row.class}|${row.section}`;
        const cohortDecisions = decisionsByCohort.get(key) ?? [];
        const rosterIds = rosterByCohort.get(key) ?? new Set<number>();
        let evaluation: Awaited<ReturnType<typeof loadPromotionCohortEvaluation>> | null = null;
        if (session.isActive && cohortDecisions.some(decision => decision.locked && !decision.adminExecuted)) {
          try {
            evaluation = await loadPromotionCohortEvaluation(
              tx, schoolId, sessionId, row.class, row.section, term, true, false,
            );
            assertPromotionGateEnabled(evaluation.policy, term);
          } catch (error) {
            if (!(error instanceof PromotionStage1Error)) throw error;
            evaluation = null;
          }
        }

        const resultsByStudent = evaluation?.resultsByStudent as Map<number, {
          resultStatus: "complete" | "incomplete";
          promoted: boolean | null;
        }> | undefined;
        const decisionsByStudent = new Map<number, typeof cohortDecisions>();
        for (const decision of cohortDecisions) {
          const bucket = decisionsByStudent.get(decision.studentId) ?? [];
          bucket.push(decision);
          decisionsByStudent.set(decision.studentId, bucket);
        }
        const studentIds = new Set<number>([
          ...rosterIds,
          ...decisionsByStudent.keys(),
        ]);
        const readinessEntries: Array<{
          studentId: number;
          readiness: PromotionLedgerReadiness;
        }> = [];
        for (const studentId of studentIds) {
          const studentDecisions = decisionsByStudent.get(studentId) ?? [];
          let readiness: PromotionLedgerReadiness;
          if (studentDecisions.length > 1) {
            readiness = studentDecisions.some(decision => decision.adminExecuted)
              ? "executed"
              : studentDecisions.some(decision => decision.locked) ? "ineligible" : "pending";
          } else {
            const decision = studentDecisions[0];
            const result = resultsByStudent?.get(studentId);
            const targetIsConfigured = !!decision
              && configuredClasses.includes(decision.targetClass)
              && Array.isArray(configuredSections[decision.targetClass])
              && (configuredSections[decision.targetClass] as unknown[]).includes(decision.targetSection);
            readiness = evaluatePromotionLedgerReadiness({
              sessionIsActive: session.isActive,
              studentIsInSourceRoster: rosterIds.has(studentId),
              resultStatus: result?.resultStatus,
              promoted: result?.promoted,
              decision,
              teacherIsValid: !!decision?.processedByTeacherId
                && validTeacherIds.has(decision.processedByTeacherId),
              targetPlacementIsConfigured: targetIsConfigured,
              sourceClass: row.class,
              sourceSection: row.section,
              adminExecuted: decision?.adminExecuted,
            });
          }
          readinessEntries.push({ studentId, readiness });
        }

        const { counts: readinessCounts, studentIds: readinessIds } =
          summarizePromotionLedgerReadiness(readinessEntries);
        const totalStudents = studentIds.size;
        projectedRows.push({
          ...row,
          status: totalStudents === 0 ? "none" as const
            : readinessCounts.pending > 0 ? "draft" as const : "locked" as const,
          totalStudents,
          lockedCount: readinessCounts.ready + readinessCounts.ineligible
            + readinessCounts.historical + readinessCounts.executed,
          adminExecuted: totalStudents > 0 && (
            session.isActive
              ? readinessCounts.executed === totalStudents
              : row.adminExecuted
          ),
          executedCount: readinessCounts.executed,
          readyCount: readinessCounts.ready,
          pendingCount: readinessCounts.pending,
          ineligibleCount: readinessCounts.ineligible,
          historicalCount: readinessCounts.historical,
          readyStudentIds: readinessIds.ready,
          pendingStudentIds: readinessIds.pending,
          ineligibleStudentIds: readinessIds.ineligible,
          historicalStudentIds: readinessIds.historical,
          executedStudentIds: readinessIds.executed,
        });
      }
      return projectedRows;
    });
  }

  // ── Fetch DSID + name map for a set of student IDs (for audit logging) ────
  async getStudentDsidMap(schoolId: number, studentIds: number[]): Promise<Record<number, { dsid: string; name: string }>> {
    if (studentIds.length === 0) return {};
    const rows = await db
      .select({ id: students.id, dsid: students.digitalStudentId, name: students.name })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), inArray(students.id, studentIds)));
    const map: Record<number, { dsid: string; name: string }> = {};
    for (const r of rows) map[r.id] = { dsid: r.dsid, name: r.name };
    return map;
  }

  // ── Delete promotion overrides for a specific set of student IDs ──────────
  async deletePromotionOverridesByStudentIds(schoolId: number, sessionId: number, studentIds: number[], examType: string): Promise<void> {
    if (studentIds.length === 0) return;
    await db.delete(promotionOverrides).where(and(
      eq(promotionOverrides.schoolId, schoolId),
      eq(promotionOverrides.sessionId, sessionId),
      eq(promotionOverrides.examType, examType),
      inArray(promotionOverrides.studentId, studentIds),
    ));
  }

  async setPromotionLedgerLock(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    term: string,
    locked: boolean,
  ): Promise<number> {
    return db.transaction(async (tx) => {
      await lockPromotionCohort(tx, schoolId, sessionId, cls, section);
      if (!locked) {
        throw new PromotionStage1Error(
          "A locked Teacher Promotion ledger cannot be unlocked.",
          409,
          "PROMOTION_DECISION_LOCKED",
        );
      }
      const evaluation = await loadPromotionCohortEvaluation(tx, schoolId, sessionId, cls, section, term);
      assertPromotionGateEnabled(evaluation.policy, term);
      const rosterIds = new Set(evaluation.rosterRows.map((row: { studentId: number }) => row.studentId));
      const entries = await tx
        .select({
          id: promotionDecisions.id,
          studentId: promotionDecisions.studentId,
          decision: promotionDecisions.decision,
          targetClass: promotionDecisions.targetClass,
          targetSection: promotionDecisions.targetSection,
          processedByTeacherId: promotionDecisions.processedByTeacherId,
          autoSuggestion: promotionDecisions.autoSuggestion,
          manualIntervention: promotionDecisions.manualIntervention,
          locked: promotionDecisions.locked,
          adminExecuted: promotionDecisions.adminExecuted,
        })
        .from(promotionDecisions)
        .where(and(
          eq(promotionDecisions.schoolId, schoolId),
          eq(promotionDecisions.sessionId, sessionId),
          eq(promotionDecisions.class, cls),
          eq(promotionDecisions.section, section),
          eq(promotionDecisions.term, term),
        ))
        .orderBy(promotionDecisions.id)
        .for("update");
      if (
        entries.length !== rosterIds.size ||
        entries.some(entry => !rosterIds.has(entry.studentId)) ||
        [...rosterIds].some(studentId => !entries.some(entry => entry.studentId === studentId))
      ) {
        throw new PromotionStage1Error(
          "The complete active-session roster must have decisions before the ledger can be locked.",
          409,
          "PROMOTION_LEDGER_INCOMPLETE",
        );
      }
      if (entries.some(entry => entry.adminExecuted)) {
        throw new PromotionStage1Error(
          "An executed Promotion decision cannot be relocked.",
          409,
          "PROMOTION_DECISION_EXECUTED",
        );
      }
      const resultsByStudent = evaluation.resultsByStudent as Map<number, {
        resultStatus: "complete" | "incomplete"; promoted: boolean | null;
      }>;
      const teacherIds = [...new Set(entries
        .map(entry => entry.processedByTeacherId)
        .filter((id): id is number => id !== null))];
      const validTeachers = await tx.select({ id: teachers.id }).from(teachers).where(and(
        eq(teachers.schoolId, schoolId),
        inArray(teachers.id, teacherIds),
      ));
      const validTeacherIds = new Set(validTeachers.map(teacher => teacher.id));
      if (entries.some(entry => {
        const result = resultsByStudent.get(entry.studentId);
        const suggestion = result?.promoted === null || !result
          ? null
          : result.promoted ? "promoted" : "retained";
        return !entry.processedByTeacherId ||
          !validTeacherIds.has(entry.processedByTeacherId) ||
          !["promoted", "retained"].includes(entry.decision) ||
          result?.resultStatus !== "complete" ||
          suggestion === null ||
          entry.autoSuggestion !== suggestion ||
          entry.manualIntervention !== (entry.decision !== suggestion) ||
          (entry.decision === "retained" &&
            (entry.targetClass !== cls || entry.targetSection !== section));
      })) {
        throw new PromotionStage1Error(
          "Every Student needs a valid complete result and a matching Teacher decision before the ledger can be locked.",
          409,
          "PROMOTION_DECISION_INVALID",
        );
      }
      if (entries.length === 0) return 0;
      const updated = await tx
        .update(promotionDecisions)
        .set({ locked, lockedAt: locked ? new Date() : null, updatedAt: new Date() })
        .where(and(
          eq(promotionDecisions.schoolId, schoolId),
          eq(promotionDecisions.sessionId, sessionId),
          eq(promotionDecisions.class, cls),
          eq(promotionDecisions.section, section),
          eq(promotionDecisions.term, term),
          eq(promotionDecisions.adminExecuted, false),
        ))
        .returning({ id: promotionDecisions.id });
      return updated.length;
    });
  }

  async markLedgerExecuted(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    term: string,
    studentIds: number[],
  ): Promise<void> {
    if (studentIds.length === 0) return;
    await db.update(promotionDecisions)
      .set({ adminExecuted: true, adminExecutedAt: new Date() })
      .where(and(
        eq(promotionDecisions.schoolId, schoolId),
        eq(promotionDecisions.sessionId, sessionId),
        eq(promotionDecisions.class, cls),
        eq(promotionDecisions.section, section),
        eq(promotionDecisions.term, term),
        inArray(promotionDecisions.studentId, studentIds),
      ));
  }

  async getDistinctLedgerTerms(schoolId: number): Promise<string[]> {
    const rows = await db
      .selectDistinct({ term: promotionDecisions.term })
      .from(promotionDecisions)
      .where(eq(promotionDecisions.schoolId, schoolId))
      .orderBy(promotionDecisions.term);
    return rows.map(r => r.term);
  }

  async getPromotionGatedTerms(schoolId: number): Promise<string[]> {
    // Source of truth: exam policy tier config, not stale promotion_decisions rows.
    // Collect every term that has promotionGate: true across all tiers for this school.
    const tiers = await db.select().from(examPolicyTiers)
      .where(eq(examPolicyTiers.schoolId, schoolId));

    const gatedTerms = new Set<string>();
    for (const tier of tiers) {
      let rc: Record<string, any> = {};
      try { rc = JSON.parse(tier.resultsConfig ?? "{}"); } catch {}
      const termConfigs: Record<string, any> = rc.termConfigs ?? {};
      for (const [term, cfg] of Object.entries(termConfigs)) {
        if ((cfg as any).promotionGate === true) gatedTerms.add(term);
      }
    }

    if (gatedTerms.size === 0) return [];

    // Preserve the school's configured exam-type order from school_metadata.
    const metaRow = await db.select({ metaValue: schoolMetadata.metaValue })
      .from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "exam_types")))
      .limit(1);

    let orderedTypes: string[] = [];
    try { orderedTypes = JSON.parse(metaRow[0]?.metaValue ?? "[]"); } catch {}

    // Only show terms that are both promotion-gated AND still exist in the school's exam_types list.
    // This ensures deleted exam types don't linger in the dropdown.
    const ordered = orderedTypes.filter(t => gatedTerms.has(t));
    return ordered;
  }

  private async deletePromotionDecisionRows(
    schoolId: number,
    sessionId: number,
    terms: string[],
    scope?: { className?: string; section?: string; studentId?: number },
  ): Promise<number> {
    const uniqueTerms = [...new Set(terms)];
    if (uniqueTerms.length === 0) return 0;
    const where = and(
      eq(promotionDecisions.schoolId, schoolId),
      eq(promotionDecisions.sessionId, sessionId),
      inArray(promotionDecisions.term, uniqueTerms),
      scope?.className === undefined ? undefined : eq(promotionDecisions.class, scope.className),
      scope?.section === undefined ? undefined : eq(promotionDecisions.section, scope.section),
      scope?.studentId === undefined ? undefined : eq(promotionDecisions.studentId, scope.studentId),
    );
    return db.transaction(async (tx) => {
      const preview = await tx.select({
        className: promotionDecisions.class,
        section: promotionDecisions.section,
      }).from(promotionDecisions).where(where);
      const cohortKeys = [...new Set(preview.map(row =>
        JSON.stringify([schoolId, sessionId, row.className, row.section]),
      ))].sort();
      for (const key of cohortKeys) {
        const [cohortSchoolId, cohortSessionId, cls, section] =
          JSON.parse(key) as [number, number, string, string];
        await lockPromotionCohort(tx, cohortSchoolId, cohortSessionId, cls, section);
      }
      const rows = await tx
        .select({
          id: promotionDecisions.id,
          adminExecuted: promotionDecisions.adminExecuted,
          locked: promotionDecisions.locked,
        })
        .from(promotionDecisions)
        .where(where)
        .orderBy(promotionDecisions.id)
        .for("update");
      if (rows.some(row => row.adminExecuted)) {
        throw new PromotionStage1Error(
          "The selected Promotion ledger contains an executed decision and cannot be deleted.",
          409,
          "PROMOTION_DECISION_EXECUTED",
        );
      }
      if (rows.some(row => row.locked)) {
        throw new PromotionStage1Error(
          "Locked Teacher Promotion decisions cannot be deleted.",
          409,
          "PROMOTION_DECISION_LOCKED",
        );
      }
      const deleted = await tx
        .delete(promotionDecisions)
        .where(where)
        .returning({ id: promotionDecisions.id });
      return deleted.length;
    });
  }

  async deletePromotionDecision(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    term: string,
    studentId: number,
  ): Promise<boolean> {
    return (await this.deletePromotionDecisionRows(schoolId, sessionId, [term], {
      className: cls,
      section,
      studentId,
    })) > 0;
  }

  async deletePromotionDecisionsByCohort(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    term: string,
  ): Promise<number> {
    return this.deletePromotionDecisionRows(schoolId, sessionId, [term], {
      className: cls,
      section,
    });
  }

  async deletePromotionDecisionsByTerms(
    schoolId: number,
    sessionId: number,
    terms: string[],
  ): Promise<number> {
    return this.deletePromotionDecisionRows(schoolId, sessionId, terms);
  }

  async deletePromotionDecisionsByTerm(schoolId: number, sessionId: number, term: string): Promise<number> {
    return this.deletePromotionDecisionsByTerms(schoolId, sessionId, [term]);
  }

  // ── ACADEMIC SESSIONS ───────────────────────────────────────────────────────
  // All methods are tenant-scoped by schoolId to enforce multi-tenant isolation.

  /** Return a single session by its primary key. */
  async getAcademicSessionById(id: number): Promise<AcademicSession | undefined> {
    const [sess] = await db.select().from(academicSessions).where(eq(academicSessions.id, id));
    return sess;
  }

  /** Resolve a session inside its tenant boundary without exposing other tenants' rows. */
  async getAcademicSessionForSchool(id: number, schoolId: number): Promise<AcademicSession | undefined> {
    const [sess] = await db.select().from(academicSessions).where(and(
      eq(academicSessions.id, id),
      eq(academicSessions.schoolId, schoolId),
    ));
    return sess;
  }

  /** Return all sessions for a school, newest first. */
  async getAcademicSessions(schoolId: number): Promise<AcademicSession[]> {
    return await db
      .select()
      .from(academicSessions)
      .where(eq(academicSessions.schoolId, schoolId))
      .orderBy(desc(academicSessions.createdAt));
  }

  /** Return the single active session for a school (or undefined if none set). */
  async getActiveSession(schoolId: number): Promise<AcademicSession | undefined> {
    const [session] = await db
      .select()
      .from(academicSessions)
      .where(and(eq(academicSessions.schoolId, schoolId), eq(academicSessions.isActive, true)));
    return session;
  }

  /** Insert a new academic session. isActive defaults to false from schema. */
  async createAcademicSession(data: InsertAcademicSession): Promise<AcademicSession> {
    const [session] = await db.insert(academicSessions).values(data).returning();
    return session;
  }

  async createAcademicSessionWithActivation(
    data: InsertAcademicSession,
  ) {
    return await db.transaction(async (tx) => {
      const [draft] = await tx
        .insert(academicSessions)
        .values({ ...data, isActive: false, status: "draft" })
        .returning();
      return activateAcademicSessionInTransaction(tx, draft.id, data.schoolId);
    });
  }

  /**
   * Hard-delete only a session with no financial history. Fee and payment
   * foreign keys use SET NULL for legacy compatibility, so the service must
   * prevent a delete from detaching immutable financial evidence.
   */
  async deleteAcademicSession(id: number, schoolId: number): Promise<boolean> {
    return await db.transaction(async (tx) => {
      // Lock the target before checking history to close delete/write races.
      const locked = await tx.execute(sql`
        SELECT id, is_active
        FROM academic_sessions
        WHERE id = ${id} AND school_id = ${schoolId}
        FOR UPDATE
      `);
      const target = locked.rows[0] as { id: number; is_active: boolean } | undefined;
      if (!target) return false;
      // An active session cannot be deleted as a way to implicitly select a
      // different session. The Principal must activate the intended target.
      if (target.is_active) return false;

      // Direct session records and all rows that inherit session via a linked
      // invoice/payment count as financial history. Every predicate is tenant
      // scoped so another school can never block or expose this session.
      const evidence = await tx.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM fee_records
           WHERE school_id = ${schoolId} AND session_id = ${id}
          UNION ALL
          SELECT 1 FROM payment_records pr
           WHERE pr.school_id = ${schoolId}
             AND (pr.session_id = ${id} OR pr.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             ))
          UNION ALL
          SELECT 1 FROM payment_attempts pa
           WHERE pa.school_id = ${schoolId}
             AND (pa.session_id = ${id} OR pa.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             ))
          UNION ALL
          SELECT 1 FROM payment_attempt_events pae
           WHERE pae.school_id = ${schoolId}
             AND (pae.session_id = ${id} OR pae.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             ))
          UNION ALL
          SELECT 1 FROM refunds r
           WHERE r.school_id = ${schoolId}
             AND (r.session_id = ${id} OR r.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             ))
          UNION ALL
          SELECT 1 FROM refund_events re
          JOIN refunds r ON r.id = re.refund_id AND r.school_id = re.school_id
           WHERE re.school_id = ${schoolId}
             AND (r.session_id = ${id} OR re.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             ))
          UNION ALL
          SELECT 1 FROM fee_audit_log
           WHERE school_id = ${schoolId}
             AND (
               session_id = ${id}
               OR (
                 entity_type = 'fee_record'
                 AND entity_id IN (
                   SELECT fr.id FROM fee_records fr
                    WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
                 )
               )
             )
          UNION ALL
          SELECT 1 FROM payment_webhook_events pwe
           WHERE pwe.school_id = ${schoolId}
             AND pwe.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             )
        ) AS has_financial_history
      `);
      if ((evidence.rows[0] as { has_financial_history?: boolean } | undefined)?.has_financial_history) {
        throw new AcademicSessionFinancialHistoryError();
      }

      await tx
        .delete(academicSessions)
        .where(and(eq(academicSessions.id, id), eq(academicSessions.schoolId, schoolId)));
      return true;
    });
  }

  /**
   * Atomically activate one session for a school.
   * CRITICAL MULTI-TENANT LOGIC:
   *   Step 1 — set isActive = false for ALL sessions of this schoolId.
   *   Step 2 — set isActive = true for the target id (same schoolId guard).
   * Both steps run inside a single DB transaction so there is never a window
   * where two sessions are active or no session is active mid-request.
   */
  async getAcademicSessionActivationPreview(id: number, schoolId: number) {
    return await db.transaction(async (tx) => {
      const { plan } = await inspectAcademicSessionActivation(tx, id, schoolId);
      return plan.preview;
    });
  }

  async activateAcademicSessionWithSummary(id: number, schoolId: number) {
    return await db.transaction(async (tx) => (
      activateAcademicSessionInTransaction(tx, id, schoolId)
    ));
  }

  async activateAcademicSession(id: number, schoolId: number): Promise<AcademicSession> {
    const result = await this.activateAcademicSessionWithSummary(id, schoolId);
    return result.session;
  }

  // ── ENROLLMENTS ─────────────────────────────────────────────────────────────

  /**
   * Create a single enrollment record.
   * Called automatically from the student-creation route using the active session.
   * If no active session exists the call is skipped gracefully (non-blocking).
   */
  async createEnrollment(data: InsertEnrollment): Promise<Enrollment> {
    const [enrollment] = await db.insert(enrollments).values(data).returning();
    return enrollment;
  }

  /** List all enrollments for a given session in a school. */
  async getEnrollmentsBySession(schoolId: number, sessionId: number): Promise<Enrollment[]> {
    return await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.schoolId, schoolId), eq(enrollments.sessionId, sessionId)));
  }

  /**
   * Resolve a student's authoritative placement for one school-owned session.
   * Enrollment status is intentionally not interpreted here.
   */
  async resolveEnrollmentForStudentSession(
    schoolId: number,
    studentId: number,
    sessionId: number,
  ): Promise<Enrollment | undefined> {
    const [row] = await db
      .select({ enrollment: enrollments })
      .from(enrollments)
      .innerJoin(students, and(
        eq(students.id, enrollments.studentId),
        eq(students.schoolId, enrollments.schoolId),
      ))
      .innerJoin(academicSessions, and(
        eq(academicSessions.id, enrollments.sessionId),
        eq(academicSessions.schoolId, enrollments.schoolId),
      ))
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.studentId, studentId),
        eq(enrollments.sessionId, sessionId),
      ))
      .limit(1);
    return row?.enrollment;
  }

  /** Get full enrollment history for a single student across all sessions. */
  async getStudentEnrollmentHistory(schoolId: number, studentId: number): Promise<Enrollment[]> {
    return await db.select().from(enrollments)
      .where(and(eq(enrollments.schoolId, schoolId), eq(enrollments.studentId, studentId)))
      .orderBy(desc(enrollments.sessionId));
  }

  /**
   * Insert or update a student enrollment record.
   * Conflict target: (schoolId, studentId, sessionId) — one enrollment per session per student.
   * On conflict: refreshes className/sectionName/status to reflect any class transfer.
   */
  async upsertStudentEnrollment(data: InsertEnrollment): Promise<Enrollment> {
    const [row] = await db.insert(enrollments).values(data)
      .onConflictDoUpdate({
        target: [enrollments.schoolId, enrollments.studentId, enrollments.sessionId],
        set: {
          className: data.className,
          sectionName: data.sectionName,
          status: data.status,
        },
      })
      .returning();
    return row;
  }
}

export const storage = new DatabaseStorage();

// ===== PROMOTION ENGINE =====

interface StudentScoreForEngine {
  subject: string;
  examType: string;
  marks: number;
  totalMarks: number;
  isAbsent: boolean;
}

export interface SubjectAggregate {
  subject: string;
  termResults: Record<string, { percentage: number; status: "pass" | "fail" | "absent" | "incomplete" }>;
}

export interface PromotionResult {
  promoted: boolean;
  reason: string;
  violations: string[];
  subjectAggregates: SubjectAggregate[];
  termFailCounts: Record<string, number>;
}

export function evaluatePromotion(
  scores: StudentScoreForEngine[],
  tier: ExamPolicyTier,
  passPercentage: number,
  termAttendance?: Record<string, number>,
  contextSchoolId: number = tier.schoolId,
  currentTerm?: string,
): PromotionResult {
  if (tier.schoolId !== contextSchoolId) {
    throw new Error(`Promotion policy school ${tier.schoolId} does not match calculation school ${contextSchoolId}.`);
  }
  let weights: Record<string, { source_exam: string; weight: number }[]> = {};
  let rules: {
    max_failed_subjects_final?: number;
    rule1?: {
      enabled?: boolean;
      term?: string;
      max_fails?: number;
      rules?: { term: string; fail_count: number }[];
    };
    rule_attendance?: {
      enabled?: boolean;
      rules?: { term: string; min_pct: number }[];
    };
    composite_fail_rules?: {
      half_yearly_fails_threshold?: number;
      final_fails_allowance_if_half_yearly_tripped?: number;
    };
    rule_term_avg?: {
      enabled?: boolean;
      minPct?: number;
    };
  } = {};

  try { weights = JSON.parse(tier.examWeights || "{}"); } catch { /* use empty */ }
  try { rules = JSON.parse(tier.promotionFailRules || "{}"); } catch { /* use defaults */ }

  const termNames = Object.keys(weights);

  const bySubject: Record<string, StudentScoreForEngine[]> = {};
  for (const s of scores) {
    if (!bySubject[s.subject]) bySubject[s.subject] = [];
    bySubject[s.subject].push(s);
  }

  const subjectAggregates: SubjectAggregate[] = [];

  for (const subject of Object.keys(bySubject)) {
    const subjectScores = bySubject[subject];
    const termResults: SubjectAggregate["termResults"] = {};

    for (const [termName, components] of Object.entries(weights)) {
      let weightedSum = 0;
      let totalWeight = 0;
      let hasAbsent = false;
      let hasData = false;

      for (const comp of components) {
        const record = subjectScores.find(s => s.examType === comp.source_exam);
        if (!record) continue;
        hasData = true;
        if (record.isAbsent) { hasAbsent = true; continue; }
        if (record.totalMarks === 0) continue;
        const pct = (record.marks / record.totalMarks) * 100;
        weightedSum += pct * (comp.weight / 100);
        totalWeight += comp.weight;
      }

      if (!hasData) {
        termResults[termName] = { percentage: 0, status: "incomplete" };
      } else if (hasAbsent) {
        termResults[termName] = { percentage: 0, status: "absent" };
      } else {
        const effectivePct = totalWeight > 0 ? (weightedSum * 100) / totalWeight : 0;
        termResults[termName] = {
          percentage: Math.round(effectivePct * 10) / 10,
          status: effectivePct >= passPercentage ? "pass" : "fail",
        };
      }
    }
    subjectAggregates.push({ subject, termResults });
  }

  const termFailCounts: Record<string, number> = {};
  for (const termName of termNames) {
    termFailCounts[termName] = subjectAggregates.filter(s => {
      const r = s.termResults[termName];
      return r?.status === "fail" || r?.status === "absent";
    }).length;
  }

  const rule1 = rules.rule1;
  const maxFailedSubjectRules = rule1?.enabled === false ? undefined
    : Array.isArray(rule1?.rules) && rule1.rules.length > 0
      ? rule1.rules.map(rule => ({ term: String(rule.term).trim(), failCount: Number(rule.fail_count) }))
      : rule1?.term && rule1.max_fails !== undefined
        ? [{ term: String(rule1.term).trim(), failCount: Number(rule1.max_fails) }]
        : rules.max_failed_subjects_final !== undefined && termNames.length
          ? [{ term: termNames[termNames.length - 1], failCount: Number(rules.max_failed_subjects_final) }]
          : undefined;
  const attendanceRules = rules.rule_attendance?.enabled === true
    ? (rules.rule_attendance.rules ?? []).map(rule => ({ term: String(rule.term).trim(), minPercent: Number(rule.min_pct) }))
    : undefined;
  const termAverages = Object.fromEntries(termNames.map(term => {
    const scored = subjectAggregates.map(subject => subject.termResults[term])
      .filter(result => result?.status === "pass" || result?.status === "fail");
    return [term, scored.length ? Math.round((scored.reduce((sum, result) => sum + result.percentage, 0) / scored.length) * 10) / 10 : null];
  }));
  const promotion = evaluatePromotionRules({
    context: { schoolId: contextSchoolId, sessionId: null },
    policySchoolId: tier.schoolId,
    maxFailedSubjectRules,
    attendanceRules,
    termAverageRule: rules.rule_term_avg?.enabled === true
      ? { enabled: true, minPct: Number(rules.rule_term_avg.minPct) }
      : undefined,
    termFailCounts,
    termAverages,
    attendancePct: null,
    attendanceByTerm: termAttendance,
    currentTerm,
    cumulativePercentage: null,
  });
  return {
    promoted: promotion.promoted,
    reason: promotion.promotionReason,
    violations: promotion.violations,
    subjectAggregates,
    termFailCounts,
  };
}
