export const MAX_FEE_RECORD_SERIAL_ID = 2_147_483_647;

export interface LedgerPdfSelection {
  selectAllMatching: boolean;
  selectedIds: number[];
  excludedIds: number[];
}

export type LedgerPdfSelectionValidation =
  | { ok: true; selection: LedgerPdfSelection }
  | { ok: false; message: string };

type IdArrayValidation =
  | { ok: true; ids: number[] }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validateIdArray(
  body: Record<string, unknown>,
  key: "selectedIds" | "excludedIds",
  required: boolean,
): IdArrayValidation {
  if (!hasOwn(body, key)) {
    return required
      ? { ok: false, message: "selectedIds must be an array of positive 32-bit integer IDs." }
      : { ok: true, ids: [] };
  }

  const value = body[key];
  if (!Array.isArray(value)) {
    return { ok: false, message: `${key} must be an array of positive 32-bit integer IDs.` };
  }

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const id of value) {
    if (
      typeof id !== "number"
      || !Number.isSafeInteger(id)
      || id <= 0
      || id > MAX_FEE_RECORD_SERIAL_ID
    ) {
      return { ok: false, message: `${key} must contain only positive 32-bit integer IDs.` };
    }
    if (seen.has(id)) {
      return { ok: false, message: `${key} cannot contain duplicate IDs.` };
    }
    seen.add(id);
    ids.push(id);
  }

  return { ok: true, ids };
}

/**
 * Validate the selection portion of a Ledger PDF POST body.
 * Filters remain in the original body and are normalized by the existing path.
 */
export function validateLedgerPdfSelection(input: unknown): LedgerPdfSelectionValidation {
  if (!isRecord(input)) {
    return { ok: false, message: "Ledger PDF request body must be an object." };
  }

  const hasSelectAll = hasOwn(input, "selectAllMatching");
  const rawSelectAll = input.selectAllMatching;
  if (hasSelectAll && typeof rawSelectAll !== "boolean") {
    return { ok: false, message: "selectAllMatching must be a boolean." };
  }
  const selectAllMatching = rawSelectAll === true;

  const selectedResult = validateIdArray(input, "selectedIds", !selectAllMatching);
  if (!selectedResult.ok) return selectedResult;

  const excludedResult = validateIdArray(input, "excludedIds", false);
  if (!excludedResult.ok) return excludedResult;

  if (selectAllMatching && selectedResult.ids.length > 0) {
    return { ok: false, message: "selectedIds must be empty when selectAllMatching is true." };
  }
  if (!selectAllMatching && excludedResult.ids.length > 0) {
    return { ok: false, message: "excludedIds can only be used with selectAllMatching=true." };
  }
  if (!selectAllMatching && selectedResult.ids.length === 0) {
    return { ok: false, message: "Explicit selection requires at least one selected invoice ID." };
  }

  return {
    ok: true,
    selection: {
      selectAllMatching,
      selectedIds: selectedResult.ids,
      excludedIds: excludedResult.ids,
    },
  };
}

/**
 * The query result is already restricted by school, session and active filters.
 * Explicit selection is valid only if every requested fee-record ID appears in it.
 */
export function hasEveryRequestedLedgerPdfId(
  requestedIds: readonly number[],
  matchingIds: readonly unknown[],
): boolean {
  if (requestedIds.length === 0) return false;

  const matched = new Set(
    matchingIds.filter(
      (id): id is number => typeof id === "number" && Number.isSafeInteger(id),
    ),
  );
  return requestedIds.every((id) => matched.has(id));
}
