import { and, eq, inArray } from "drizzle-orm";
import { studentComplaintReadReceipts } from "@workspace/db";
import { db } from "./db";
import {
  complaintReadTrackingEnabled,
  queryReceiptsWhenEnabled,
  type StudentComplaintReceiptScope,
} from "./student-complaint-read-receipt-policy";

export const STUDENT_COMPLAINT_READ_RECEIPTS_ENV =
  "BENIUS_STUDENT_COMPLAINT_READ_RECEIPTS_ENABLED";
export const STUDENT_COMPLAINT_READ_RECEIPTS_MIGRATION_ENV =
  "BENIUS_STUDENT_COMPLAINT_READ_RECEIPTS_MIGRATION_APPLIED";

export function studentComplaintReadReceiptsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return complaintReadTrackingEnabled({
    nodeEnv: env.NODE_ENV,
    enabled: env[STUDENT_COMPLAINT_READ_RECEIPTS_ENV],
    migrationApplied: env[STUDENT_COMPLAINT_READ_RECEIPTS_MIGRATION_ENV],
  });
}

export type StudentComplaintReadScope = StudentComplaintReceiptScope;

export async function getStudentComplaintReadIds(
  scope: StudentComplaintReadScope,
  complaintIds: readonly number[],
): Promise<Set<number>> {
  if (complaintIds.length === 0) return new Set();
  const rows = await queryReceiptsWhenEnabled(studentComplaintReadReceiptsEnabled(), () =>
    db.select({ complaintId: studentComplaintReadReceipts.complaintId })
      .from(studentComplaintReadReceipts)
      .where(and(
        eq(studentComplaintReadReceipts.schoolId, scope.schoolId),
        eq(studentComplaintReadReceipts.studentId, scope.studentId),
        eq(studentComplaintReadReceipts.sessionId, scope.sessionId),
        inArray(studentComplaintReadReceipts.complaintId, [...complaintIds]),
      )),
  );
  return new Set(rows?.map(row => row.complaintId) ?? []);
}

export async function markStudentComplaintRead(
  scope: StudentComplaintReadScope,
  complaintId: number,
): Promise<void> {
  if (!studentComplaintReadReceiptsEnabled()) {
    throw new Error("Student complaint read receipts are disabled");
  }
  await db.insert(studentComplaintReadReceipts).values({ ...scope, complaintId })
    .onConflictDoNothing({
      target: [
        studentComplaintReadReceipts.schoolId,
        studentComplaintReadReceipts.studentId,
        studentComplaintReadReceipts.sessionId,
        studentComplaintReadReceipts.complaintId,
      ],
    });
}
