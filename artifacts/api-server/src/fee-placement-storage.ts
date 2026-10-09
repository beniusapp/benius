import { and, eq } from "drizzle-orm";
import { enrollments } from "@workspace/db";
import { db } from "./db";
import {
  resolveHistoricalFeePlacement,
  type FeePlacementScope,
} from "./historical-fee-placement";

/**
 * Read-only lookup for a fee document. It never consults current Student
 * Registry placement and limits results to detect duplicate historical rows.
 */
export async function loadHistoricalFeePlacement(scope: FeePlacementScope) {
  if (
    scope.sessionId == null
    || !Number.isSafeInteger(scope.schoolId)
    || !Number.isSafeInteger(scope.studentId)
    || !Number.isSafeInteger(scope.sessionId)
  ) {
    return resolveHistoricalFeePlacement(scope, []);
  }

  const candidates = await db
    .select({
      schoolId: enrollments.schoolId,
      studentId: enrollments.studentId,
      sessionId: enrollments.sessionId,
      className: enrollments.className,
      sectionName: enrollments.sectionName,
      rollNumber: enrollments.rollNo,
    })
    .from(enrollments)
    .where(and(
      eq(enrollments.schoolId, scope.schoolId),
      eq(enrollments.studentId, scope.studentId),
      eq(enrollments.sessionId, scope.sessionId),
    ))
    .limit(2);

  return resolveHistoricalFeePlacement(scope, candidates);
}
