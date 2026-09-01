import { and, eq } from "drizzle-orm";
import {
  academicSessions,
  attendanceRecords,
  enrollments,
  examPolicyTiers,
  examScores,
  gradingRules,
  gradingTiers,
  schoolMetadata,
  academicTermBoundaries,
  students,
} from "@shared/schema";
import { db } from "./db";
import {
  calculateAcademicResults,
  type AttendanceRecord,
  type ExamPolicy,
  type GradingPolicy,
  type ScoreRecord,
  type TermDateRange,
} from "./academic-calculation-engine";

export type AcademicScopeErrorCode =
  | "SESSION_NOT_FOUND"
  | "STUDENT_NOT_FOUND"
  | "ENROLLMENT_NOT_FOUND";

export class AcademicScopeError extends Error {
  constructor(public readonly code: AcademicScopeErrorCode, message: string) {
    super(message);
    this.name = "AcademicScopeError";
  }
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // The pure engine will produce the public policy error for malformed policy JSON.
  }
  return { __invalidPolicyJson: label };
}

export async function calculateStudentAcademicResult(input: {
  schoolId: number;
  sessionId: number;
  studentId: number;
  currentTerm?: string;
  publishedOnly?: boolean;
}) {
  const [session, student, enrollment] = await Promise.all([
    db.query.academicSessions.findFirst({
      where: and(
        eq(academicSessions.id, input.sessionId),
        eq(academicSessions.schoolId, input.schoolId),
      ),
    }),
    db.query.students.findFirst({
      where: and(eq(students.id, input.studentId), eq(students.schoolId, input.schoolId)),
    }),
    db.query.enrollments.findFirst({
      where: and(
        eq(enrollments.schoolId, input.schoolId),
        eq(enrollments.sessionId, input.sessionId),
        eq(enrollments.studentId, input.studentId),
      ),
    }),
  ]);

  if (!session) throw new AcademicScopeError("SESSION_NOT_FOUND", "Academic session was not found for this school.");
  if (!student) throw new AcademicScopeError("STUDENT_NOT_FOUND", "Student was not found for this school.");
  if (!enrollment) throw new AcademicScopeError("ENROLLMENT_NOT_FOUND", "Student has no enrollment in this academic session.");

  const [tierRows, ruleRows, examPolicyRows, scoreRows, attendanceRows, subjectMeta, boundaryRows] = await Promise.all([
    db.select().from(gradingTiers).where(eq(gradingTiers.schoolId, input.schoolId)),
    db.select().from(gradingRules).where(eq(gradingRules.schoolId, input.schoolId)),
    db.select().from(examPolicyTiers).where(eq(examPolicyTiers.schoolId, input.schoolId)),
    db.select().from(examScores).where(and(
      eq(examScores.schoolId, input.schoolId),
      eq(examScores.sessionId, input.sessionId),
      eq(examScores.studentId, input.studentId),
      eq(examScores.class, enrollment.className),
      eq(examScores.section, enrollment.sectionName),
      ...(input.publishedOnly ? [eq(examScores.published, true)] : []),
    )),
    db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, input.schoolId),
      eq(attendanceRecords.sessionId, input.sessionId),
      eq(attendanceRecords.studentId, input.studentId),
    )),
    db.select().from(schoolMetadata).where(and(
      eq(schoolMetadata.schoolId, input.schoolId),
      eq(schoolMetadata.metaKey, "class_subjects"),
    )).limit(1),
    db.select().from(academicTermBoundaries).where(and(
      eq(academicTermBoundaries.schoolId, input.schoolId),
      eq(academicTermBoundaries.sessionId, input.sessionId),
    )),
  ]);

  const gradingPolicies: GradingPolicy[] = tierRows.map(tier => ({
    id: tier.id,
    schoolId: tier.schoolId,
    classes: tier.classes,
    gradingSystem: tier.gradingSystem as GradingPolicy["gradingSystem"],
    passPercentage: tier.passPercentage,
    passingGrades: tier.passingGrades,
    gradingRules: ruleRows
      .filter(rule => rule.tierId === tier.id)
      .map(rule => ({
        min: rule.minPercent,
        max: rule.maxPercent,
        grade: rule.gradeLabel,
        gradePoint: rule.gradePoint,
        remarks: rule.remarks,
      })),
  }));

  const examPolicies: ExamPolicy[] = examPolicyRows.map(policy => ({
    id: policy.id,
    schoolId: policy.schoolId,
    tierName: policy.tierName,
    applicableClasses: policy.applicableClasses,
    examWeights: policy.examWeights,
    promotionFailRules: policy.promotionFailRules,
    resultsConfig: policy.resultsConfig,
  }));

  const scores: ScoreRecord[] = scoreRows.map(score => ({
    schoolId: score.schoolId,
    sessionId: score.sessionId!,
    studentId: score.studentId,
    subject: score.subject,
    examType: score.examType,
    marks: score.marks,
    totalMarks: score.totalMarks,
    isAbsent: score.isAbsent,
  }));

  const attendance: AttendanceRecord[] = attendanceRows.map(record => ({
    schoolId: record.schoolId,
    sessionId: record.sessionId!,
    studentId: record.studentId,
    date: record.date,
    status: record.status,
  }));

  const matchingExamPolicies = examPolicyRows.filter(policy =>
    policy.applicableClasses.includes(enrollment.className)
  );
  const termDateRanges: Record<string, TermDateRange> = Object.fromEntries(
    boundaryRows.map(boundary => [boundary.term, { start: boundary.startDate, end: boundary.endDate }]),
  );
  let classSubjectMap: Record<string, string[]> = {};
  try { classSubjectMap = JSON.parse(subjectMeta[0]?.metaValue ?? "{}"); } catch {}
  const normalizedClass = enrollment.className.trim().toLowerCase().replace(/^class\s+/, "");
  const requiredSubjects = Object.entries(classSubjectMap)
    .find(([className]) => className.trim().toLowerCase().replace(/^class\s+/, "") === normalizedClass)?.[1] ?? [];

  return calculateAcademicResults({
    schoolId: input.schoolId,
    sessionId: input.sessionId,
    studentId: input.studentId,
    className: enrollment.className,
    gradingPolicies,
    examPolicies,
    requiredSubjects,
    scores,
    attendanceRecords: attendance,
    termDateRanges,
    currentTerm: input.currentTerm,
  });
}