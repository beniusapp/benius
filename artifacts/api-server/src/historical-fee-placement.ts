export const HISTORICAL_PLACEMENT_UNAVAILABLE =
  "Historical placement unavailable";

export interface FeePlacementScope {
  schoolId: number;
  studentId: number;
  sessionId: number | null;
}

export interface FeePlacementCandidate {
  schoolId: number;
  studentId: number;
  sessionId: number;
  className: string | null;
  sectionName: string | null;
  rollNumber: number | null;
}

export interface HistoricalFeePlacement {
  available: boolean;
  reason:
    | null
    | "session_unassigned"
    | "invalid_scope"
    | "not_found"
    | "ambiguous"
    | "incomplete";
  className: string | null;
  sectionName: string | null;
  rollNumber: number | null;
}

const unavailable = (
  reason: HistoricalFeePlacement["reason"],
): HistoricalFeePlacement => ({
  available: false,
  reason,
  className: null,
  sectionName: null,
  rollNumber: null,
});

function isValidId(value: number | null): value is number {
  return value != null && Number.isSafeInteger(value) && value > 0;
}

/**
 * Resolve a fee document's placement only from the exact school/student/session
 * enrollment. The bounded candidate list lets this fail closed on duplicates.
 */
export function resolveHistoricalFeePlacement(
  scope: FeePlacementScope,
  candidates: readonly FeePlacementCandidate[],
): HistoricalFeePlacement {
  if (scope.sessionId == null) return unavailable("session_unassigned");
  if (
    !isValidId(scope.schoolId)
    || !isValidId(scope.studentId)
    || !isValidId(scope.sessionId)
  ) {
    return unavailable("invalid_scope");
  }

  const exact = candidates.filter(candidate =>
    candidate.schoolId === scope.schoolId
    && candidate.studentId === scope.studentId
    && candidate.sessionId === scope.sessionId,
  );
  if (exact.length === 0) return unavailable("not_found");
  if (exact.length !== 1) return unavailable("ambiguous");

  const candidate = exact[0]!;
  if (
    typeof candidate.className !== "string"
    || candidate.className.trim() === ""
    || typeof candidate.sectionName !== "string"
    || candidate.sectionName.trim() === ""
  ) {
    return unavailable("incomplete");
  }

  return {
    available: true,
    reason: null,
    className: candidate.className,
    sectionName: candidate.sectionName,
    rollNumber:
      candidate.rollNumber != null && Number.isFinite(Number(candidate.rollNumber))
        ? Number(candidate.rollNumber)
        : null,
  };
}

export function feePlacementForDisplay(placement: HistoricalFeePlacement): {
  className: string;
  sectionName: string;
  rollNumber: number | null;
} {
  if (!placement.available) {
    return {
      className: HISTORICAL_PLACEMENT_UNAVAILABLE,
      sectionName: "—",
      rollNumber: null,
    };
  }

  return {
    className: placement.className!,
    sectionName: placement.sectionName!,
    rollNumber: placement.rollNumber,
  };
}

function normalizedSessionId(value: unknown): number | null | undefined {
  if (value == null) return null;
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : undefined;
}

export function paymentFeeSessionNotice(
  paymentSessionId: unknown,
  feeSessionId: unknown,
  linkedFeeIsValid = true,
): string | null {
  if (!linkedFeeIsValid) {
    return "No valid linked invoice for this payment. Historical placement is unavailable; no records were changed.";
  }

  const paymentSession = normalizedSessionId(paymentSessionId);
  const feeSession = normalizedSessionId(feeSessionId);
  if (
    paymentSession !== undefined
    && feeSession !== undefined
    && paymentSession === feeSession
  ) {
    return null;
  }

  const formatSession = (value: number | null | undefined) =>
    value === undefined
      ? "invalid"
      : value == null
        ? "unassigned (NULL)"
        : `ID ${value}`;
  return `Session mismatch: payment record session ${formatSession(paymentSession)} differs from invoice session ${formatSession(feeSession)}. Placement is based on the invoice session; no records were changed.`;
}

export function paymentSideSessionNotice(
  paymentSide: "payment attempt" | "payment record",
  paymentSessionId: unknown,
  feeSessionId: unknown,
): string | null {
  const paymentSession = normalizedSessionId(paymentSessionId);
  const feeSession = normalizedSessionId(feeSessionId);
  if (
    paymentSession !== undefined
    && feeSession !== undefined
    && paymentSession === feeSession
  ) {
    return null;
  }

  const formatSession = (value: number | null | undefined) =>
    value === undefined
      ? "invalid"
      : value == null
        ? "unassigned (NULL)"
        : `ID ${value}`;
  return `Session mismatch: ${paymentSide} session ${formatSession(paymentSession)} differs from invoice session ${formatSession(feeSession)}. Placement uses the invoice session; no records were changed.`;
}
