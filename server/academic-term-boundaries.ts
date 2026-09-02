import type { AcademicSession } from "@shared/schema";

export interface TermBoundaryInput {
  term: string;
  startDate: string;
  endDate: string;
}

export class AcademicTermBoundaryError extends Error {
  constructor(public readonly code:
    | "INVALID_TERM_BOUNDARY"
    | "DUPLICATE_TERM_BOUNDARY"
    | "OVERLAPPING_TERM_BOUNDARY"
    | "TERM_NOT_IN_POLICY", message: string) {
    super(message);
    this.name = "AcademicTermBoundaryError";
  }
}

function day(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const [year, month, date] = value.split("-").map(Number);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return NaN;
  const candidate = new Date(parsed);
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === date ? parsed : NaN;
}

export function validateAcademicTermBoundaries(
  boundaries: TermBoundaryInput[],
  session: Pick<AcademicSession, "startDate" | "endDate">,
  /** Complete set of terms configured by the applicable exam policy. */
  configuredTerms: Set<string>,
): void {
  const sessionStart = day(session.startDate);
  const sessionEnd = day(session.endDate);
  if (!Number.isFinite(sessionStart) || !Number.isFinite(sessionEnd) || sessionStart > sessionEnd) {
    throw new AcademicTermBoundaryError("INVALID_TERM_BOUNDARY", "Academic session dates are invalid.");
  }

  const seen = new Set<string>();
  const normalized = boundaries.map(boundary => {
    const term = boundary.term.trim();
    const start = day(boundary.startDate);
    const end = day(boundary.endDate);
    if (!term || !Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      throw new AcademicTermBoundaryError("INVALID_TERM_BOUNDARY", `Invalid date range for term "${term || "(unnamed)"}".`);
    }
    if (!configuredTerms.has(term)) {
      throw new AcademicTermBoundaryError("TERM_NOT_IN_POLICY", `Term "${term}" is not configured in an exam policy.`);
    }
    if (seen.has(term)) {
      throw new AcademicTermBoundaryError("DUPLICATE_TERM_BOUNDARY", `Term "${term}" has more than one boundary.`);
    }
    seen.add(term);
    if (start < sessionStart || end > sessionEnd) {
      throw new AcademicTermBoundaryError("INVALID_TERM_BOUNDARY", `Term "${term}" must fall within the academic session.`);
    }
    return { term, start, end };
  });

  for (const term of configuredTerms) {
    if (!seen.has(term)) {
      throw new AcademicTermBoundaryError(
        "INVALID_TERM_BOUNDARY",
        `A boundary is required for configured term "${term}".`,
      );
    }
  }

  normalized.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index].start <= normalized[index - 1].end) {
      throw new AcademicTermBoundaryError(
        "OVERLAPPING_TERM_BOUNDARY",
        `Terms "${normalized[index - 1].term}" and "${normalized[index].term}" overlap.`,
      );
    }
  }
}