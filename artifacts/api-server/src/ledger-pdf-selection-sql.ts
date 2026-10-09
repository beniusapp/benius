import { sql, type SQL } from "drizzle-orm";

export interface LedgerPdfAuthorizedWhereInput {
  schoolId: number;
  sessionId: number | null;
  filterPredicates: SQL[];
  selectAllMatching: boolean;
  selectedIdsArray: SQL | null;
  excludedIdsArray: SQL | null;
}

/**
 * Build the exact eligible fee-record population before selection is applied.
 * Explicit mode fails closed if its validated ID-array predicate is absent.
 */
export function buildLedgerPdfAuthorizedWhere(
  input: LedgerPdfAuthorizedWhereInput,
): SQL {
  const filterConditions = input.filterPredicates.length > 0
    ? sql`AND ${sql.join(input.filterPredicates, sql` AND `)}`
    : sql``;
  const selectedCondition = input.selectAllMatching
    ? sql``
    : input.selectedIdsArray
      ? sql`AND fr.id = ANY(${input.selectedIdsArray})`
      : sql`AND FALSE`;
  const excludedCondition = input.selectAllMatching && input.excludedIdsArray
    ? sql`AND fr.id != ALL(${input.excludedIdsArray})`
    : sql``;

  return sql`
    fr.school_id = ${input.schoolId}
    AND fr.session_id = ${input.sessionId}
    ${filterConditions}
    ${selectedCondition}
    ${excludedCondition}
  `;
}
