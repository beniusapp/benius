import { examScores } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/** Student-only visibility boundary; Teacher/Admin readers do not use it. */
export function studentPublishedScoreScope(
  schoolId: number,
  studentId: number,
  sessionId: number,
  className: string,
  sectionName: string,
) {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new Error("Student Examination requires a valid academic session");
  }
  return and(
    eq(examScores.schoolId, schoolId),
    eq(examScores.studentId, studentId),
    eq(examScores.sessionId, sessionId),
    eq(examScores.class, className),
    eq(examScores.section, sectionName),
    eq(examScores.published, true),
  )!;
}

/** Rank compares only published scores in the selected enrollment's section. */
export function studentPublishedRankScope(
  schoolId: number,
  sessionId: number,
  className: string,
  sectionName: string,
  examType: string,
) {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new Error("Student rank requires a valid academic session");
  }
  return and(
    eq(examScores.schoolId, schoolId),
    eq(examScores.sessionId, sessionId),
    eq(examScores.class, className),
    eq(examScores.section, sectionName),
    eq(examScores.examType, examType),
    eq(examScores.published, true),
  )!;
}