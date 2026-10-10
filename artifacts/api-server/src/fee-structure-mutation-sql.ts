import { and, eq, or, sql } from "drizzle-orm";
import { feeRecords } from "@workspace/db";

export type FeeStructureMutationScope = {
  schoolId: number;
  activeSessionId: number;
  feeStructureId: number;
};

/**
 * Shared SQL guard for every structure-driven invoice mutation. The explicit
 * NOT EXISTS is intentionally repeated in the final UPDATE/DELETE statement
 * so payment history is checked atomically, not only in an application read.
 */
export function feeStructureInvoiceMutationWhere(scope: FeeStructureMutationScope) {
  return and(
    eq(feeRecords.schoolId, scope.schoolId),
    eq(feeRecords.sessionId, scope.activeSessionId),
    eq(feeRecords.feeStructureId, scope.feeStructureId),
    or(eq(feeRecords.status, "Due"), eq(feeRecords.status, "Overdue")),
    sql`EXISTS (
      SELECT 1 FROM academic_sessions fee_structure_active_session
      WHERE fee_structure_active_session.id = ${scope.activeSessionId}
        AND fee_structure_active_session.id = ${feeRecords.sessionId}
        AND fee_structure_active_session.school_id = ${scope.schoolId}
        AND fee_structure_active_session.is_active = TRUE
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM payment_records fee_structure_payment
      WHERE fee_structure_payment.fee_record_id = ${feeRecords.id}
    )`,
  )!;
}
