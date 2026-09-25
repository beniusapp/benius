/**
 * shared/ledger-filters.ts
 *
 * Canonical contract for the fee-ledger filter panel.
 *
 * Single source of truth shared between the server (validation/SQL) and the
 * client (UI state / URL serialization). The client files are NOT modified by
 * this task — they continue to import only what they already use. New exports
 * added here are consumed only from server-side modules unless the client
 * explicitly starts importing them.
 */

// ── Constants ──────────────────────────────────────────────────────────────────

/** Maximum characters accepted in free-text search / individual string fields. */
export const MAX_STR_LEN = 200;

/** Maximum number of values accepted in any single array filter field. */
export const MAX_ARRAY_SIZE = 100;

// ── ISO date validation ────────────────────────────────────────────────────────

/**
 * Returns true when the string is a valid YYYY-MM-DD date.
 * Rejects impossible calendar dates (e.g. 2026-02-31, 2025-13-01) by verifying
 * that the parsed UTC components round-trip exactly — JS Date silently rolls
 * over out-of-range days, so a strict component comparison is required.
 */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

// ── Core contract ──────────────────────────────────────────────────────────────

export interface LedgerFilters {
  // ── Free-text global search ────────────────────────────────────────────────
  search: string;

  // ── Exact-match arrays (OR within field, AND between fields) ─────────────
  /** One or more invoice numbers (INV-xxxx). */
  invoiceNumbers: string[];
  /** One or more receipt numbers (ON-xxxx / OF-xxxx). */
  receiptNumbers: string[];
  /** Student name substrings — partial match applied per value. */
  studentNames: string[];
  /** Digital Student IDs (DSID). */
  dsids: string[];
  /** Reference numbers from payment records. */
  referenceNumbers: string[];

  // ── Categorical filters ───────────────────────────────────────────────────
  classes:        string[];
  sections:       string[];
  feeNames:       string[];
  feeTypes:       string[];
  /** Encoded as "startDate|endDate", e.g. "2025-08-01|2025-08-31". */
  feePeriods:     string[];
  frequencies:    string[];
  statuses:       string[];
  paymentMethods: string[];
  academicYears:  string[];

  // ── Numeric range ─────────────────────────────────────────────────────────
  amountMin: number | null;
  amountMax: number | null;

  // ── Date ranges ───────────────────────────────────────────────────────────
  dueDateFrom:  string | null;
  dueDateTo:    string | null;
  paidDateFrom: string | null;
  paidDateTo:   string | null;
}

// ── Default / empty state ──────────────────────────────────────────────────────

export function emptyLedgerFilters(): LedgerFilters {
  return {
    search: "",
    invoiceNumbers: [],
    receiptNumbers: [],
    studentNames: [],
    dsids: [],
    referenceNumbers: [],
    classes: [],
    sections: [],
    feeNames: [],
    feeTypes: [],
    feePeriods: [],
    frequencies: [],
    statuses: [],
    paymentMethods: [],
    academicYears: [],
    amountMin: null,
    amountMax: null,
    dueDateFrom: null,
    dueDateTo: null,
    paidDateFrom: null,
    paidDateTo: null,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function cleanStr(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim().slice(0, MAX_STR_LEN);
  return s;
}

function cleanStrArr(v: unknown): string[] {
  if (v == null || v === "") return [];

  let raw: unknown[];
  if (Array.isArray(v)) {
    // Repeated query params or a real JSON array arrive as an array already.
    raw = v;
  } else if (typeof v === "string") {
    const trimmed = v.trim();
    // Recognise a JSON array string, e.g. '["8A","8B"]'
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        raw = Array.isArray(parsed) ? parsed : [trimmed];
      } catch {
        // Malformed JSON → treat as a CSV string
        raw = trimmed.split(",");
      }
    } else {
      // Old CSV string, e.g. "8A,8B"
      raw = trimmed.split(",");
    }
  } else {
    raw = [v];
  }

  // Clean, drop empties, then de-duplicate while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const s = cleanStr(x);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      if (out.length >= MAX_ARRAY_SIZE) break;
    }
  }
  return out;
}

function cleanNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().slice(0, 10);
  return isValidDate(s) ? s : null;
}

// ── Normalization ──────────────────────────────────────────────────────────────

/**
 * Normalise a raw query-string object (all values are string | string[] | undefined)
 * into a strict LedgerFilters. Handles old singular field names for compatibility:
 *   class → classes[0]
 *   status → statuses[0]  (unless "all")
 *   feeName → feeNames[0]
 *   feeType → feeTypes[0]
 */
export function normalizeLedgerFiltersFromQuery(q: Record<string, unknown>): LedgerFilters {
  const f = emptyLedgerFilters();

  f.search = cleanStr(q.search);

  f.invoiceNumbers  = cleanStrArr(q.invoiceNumbers  ?? q.invoiceNumber);
  f.receiptNumbers  = cleanStrArr(q.receiptNumbers  ?? q.receiptNumber);
  f.studentNames    = cleanStrArr(q.studentNames    ?? q.studentName);
  f.dsids           = cleanStrArr(q.dsids           ?? q.dsid);
  f.referenceNumbers = cleanStrArr(q.referenceNumbers ?? q.referenceNumber);

  // Categorical — new plural form wins; old singular falls back
  f.classes   = cleanStrArr(q.classes   ?? (q.class   && q.class   !== "all" ? q.class   : undefined));
  f.sections  = cleanStrArr(q.sections  ?? q.section);
  f.feeNames  = cleanStrArr(q.feeNames  ?? (q.feeName  && q.feeName  !== "all" ? q.feeName  : undefined));
  f.feeTypes  = cleanStrArr(q.feeTypes  ?? (q.feeType  && q.feeType  !== "all" ? q.feeType  : undefined));
  f.feePeriods = cleanStrArr(q.feePeriods ?? q.feePeriod);
  f.frequencies = cleanStrArr(q.frequencies ?? q.frequency);

  // statuses — old singular "status" supports "all" to mean no filter
  const rawStatuses = q.statuses ?? (q.status && q.status !== "all" ? q.status : undefined);
  f.statuses = cleanStrArr(rawStatuses).filter(s => ["Due", "Paid", "Overdue"].includes(s));

  f.paymentMethods = cleanStrArr(q.paymentMethods ?? q.paymentMethod);
  f.academicYears  = cleanStrArr(q.academicYears  ?? q.academicYear);

  f.amountMin = cleanNum(q.amountMin);
  f.amountMax = cleanNum(q.amountMax);

  f.dueDateFrom  = cleanDate(q.dueDateFrom  ?? q.dateFrom);
  f.dueDateTo    = cleanDate(q.dueDateTo    ?? q.dateTo);
  f.paidDateFrom = cleanDate(q.paidDateFrom);
  f.paidDateTo   = cleanDate(q.paidDateTo);

  return f;
}

/**
 * Normalise a raw request body (JSON) into a strict LedgerFilters.
 * Same old-singular-field compatibility as the query normalizer.
 */
export function normalizeLedgerFiltersFromBody(b: Record<string, unknown>): LedgerFilters {
  // Body parsing is identical to query parsing for our purposes
  return normalizeLedgerFiltersFromQuery(b);
}

// ── Active filter count ────────────────────────────────────────────────────────

/**
 * Returns the number of non-empty filter dimensions. Useful for UI badges.
 * Each range counts as a single dimension: the amount range (min/max together)
 * and each date range (from/to together) are one dimension apiece, regardless
 * of whether one or both bounds are set.
 */
export function countActiveLedgerFilters(f: LedgerFilters): number {
  let n = 0;
  if (f.search)                  n++;
  if (f.invoiceNumbers.length)   n++;
  if (f.receiptNumbers.length)   n++;
  if (f.studentNames.length)     n++;
  if (f.dsids.length)            n++;
  if (f.referenceNumbers.length) n++;
  if (f.classes.length)          n++;
  if (f.sections.length)         n++;
  if (f.feeNames.length)         n++;
  if (f.feeTypes.length)         n++;
  if (f.feePeriods.length)       n++;
  if (f.frequencies.length)      n++;
  if (f.statuses.length)         n++;
  if (f.paymentMethods.length)   n++;
  if (f.academicYears.length)    n++;
  // Amount range → one dimension (min and/or max)
  if (f.amountMin != null || f.amountMax != null)   n++;
  // Due-date range → one dimension (from and/or to)
  if (f.dueDateFrom || f.dueDateTo)                 n++;
  // Paid-date range → one dimension (from and/or to)
  if (f.paidDateFrom || f.paidDateTo)               n++;
  return n;
}

/** Returns true when no filter is active. */
export function isEmptyLedgerFilters(f: LedgerFilters): boolean {
  return countActiveLedgerFilters(f) === 0;
}

// ── Serialization ──────────────────────────────────────────────────────────────

/** Serialize to URL query params (string record suitable for URLSearchParams). */
export function ledgerFiltersToQuery(f: LedgerFilters): Record<string, string> {
  const out: Record<string, string> = {};

  if (f.search)               out.search = f.search;
  if (f.invoiceNumbers.length)  out.invoiceNumbers  = f.invoiceNumbers.join(",");
  if (f.receiptNumbers.length)  out.receiptNumbers  = f.receiptNumbers.join(",");
  if (f.studentNames.length)    out.studentNames    = f.studentNames.join(",");
  if (f.dsids.length)           out.dsids           = f.dsids.join(",");
  if (f.referenceNumbers.length) out.referenceNumbers = f.referenceNumbers.join(",");
  if (f.classes.length)         out.classes         = f.classes.join(",");
  if (f.sections.length)        out.sections        = f.sections.join(",");
  if (f.feeNames.length)        out.feeNames        = f.feeNames.join(",");
  if (f.feeTypes.length)        out.feeTypes        = f.feeTypes.join(",");
  if (f.feePeriods.length)      out.feePeriods      = f.feePeriods.join(",");
  if (f.frequencies.length)     out.frequencies     = f.frequencies.join(",");
  if (f.statuses.length)        out.statuses        = f.statuses.join(",");
  if (f.paymentMethods.length)  out.paymentMethods  = f.paymentMethods.join(",");
  if (f.academicYears.length)   out.academicYears   = f.academicYears.join(",");
  if (f.amountMin != null)      out.amountMin       = String(f.amountMin);
  if (f.amountMax != null)      out.amountMax       = String(f.amountMax);
  if (f.dueDateFrom)            out.dueDateFrom     = f.dueDateFrom;
  if (f.dueDateTo)              out.dueDateTo       = f.dueDateTo;
  if (f.paidDateFrom)           out.paidDateFrom    = f.paidDateFrom;
  if (f.paidDateTo)             out.paidDateTo      = f.paidDateTo;

  return out;
}

/**
 * Browser-safe serializer that appends every array value as a REPEATED query
 * parameter (e.g. classes=8A&classes=8B) — never JSON, never comma-joined.
 * The server's normalizer receives these as string[] via Express query parsing.
 *
 * This is the canonical serializer for client → server ledger requests.
 */
export function ledgerFiltersToSearchParams(f: LedgerFilters): URLSearchParams {
  const params = new URLSearchParams();

  const appendEach = (key: string, values: string[]) => {
    for (const v of values) params.append(key, v);
  };

  if (f.search)               params.append("search", f.search);
  appendEach("invoiceNumbers",   f.invoiceNumbers);
  appendEach("receiptNumbers",   f.receiptNumbers);
  appendEach("studentNames",     f.studentNames);
  appendEach("dsids",            f.dsids);
  appendEach("referenceNumbers", f.referenceNumbers);
  appendEach("classes",          f.classes);
  appendEach("sections",         f.sections);
  appendEach("feeNames",         f.feeNames);
  appendEach("feeTypes",         f.feeTypes);
  appendEach("feePeriods",       f.feePeriods);
  appendEach("frequencies",      f.frequencies);
  appendEach("statuses",         f.statuses);
  appendEach("paymentMethods",   f.paymentMethods);
  appendEach("academicYears",    f.academicYears);
  if (f.amountMin != null)      params.append("amountMin",    String(f.amountMin));
  if (f.amountMax != null)      params.append("amountMax",    String(f.amountMax));
  if (f.dueDateFrom)            params.append("dueDateFrom",  f.dueDateFrom);
  if (f.dueDateTo)              params.append("dueDateTo",    f.dueDateTo);
  if (f.paidDateFrom)           params.append("paidDateFrom", f.paidDateFrom);
  if (f.paidDateTo)             params.append("paidDateTo",   f.paidDateTo);

  return params;
}

/** Serialize to a JSON-safe body object. */
export function ledgerFiltersToBody(f: LedgerFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (f.search)               out.search = f.search;
  if (f.invoiceNumbers.length)  out.invoiceNumbers  = f.invoiceNumbers;
  if (f.receiptNumbers.length)  out.receiptNumbers  = f.receiptNumbers;
  if (f.studentNames.length)    out.studentNames    = f.studentNames;
  if (f.dsids.length)           out.dsids           = f.dsids;
  if (f.referenceNumbers.length) out.referenceNumbers = f.referenceNumbers;
  if (f.classes.length)         out.classes         = f.classes;
  if (f.sections.length)        out.sections        = f.sections;
  if (f.feeNames.length)        out.feeNames        = f.feeNames;
  if (f.feeTypes.length)        out.feeTypes        = f.feeTypes;
  if (f.feePeriods.length)      out.feePeriods      = f.feePeriods;
  if (f.frequencies.length)     out.frequencies     = f.frequencies;
  if (f.statuses.length)        out.statuses        = f.statuses;
  if (f.paymentMethods.length)  out.paymentMethods  = f.paymentMethods;
  if (f.academicYears.length)   out.academicYears   = f.academicYears;
  if (f.amountMin != null)      out.amountMin       = f.amountMin;
  if (f.amountMax != null)      out.amountMax       = f.amountMax;
  if (f.dueDateFrom)            out.dueDateFrom     = f.dueDateFrom;
  if (f.dueDateTo)              out.dueDateTo       = f.dueDateTo;
  if (f.paidDateFrom)           out.paidDateFrom    = f.paidDateFrom;
  if (f.paidDateTo)             out.paidDateTo      = f.paidDateTo;

  return out;
}

// ── Label helpers ──────────────────────────────────────────────────────────────

/**
 * Returns a short summary label for a single filter dimension.
 * Joins up to 2 values then appends "+N more" if there are more.
 */
export function ledgerFilterLabel(values: string[], singular: string, plural: string): string {
  if (!values.length) return "";
  if (values.length === 1) return `${singular}: ${values[0]}`;
  if (values.length === 2) return `${plural}: ${values[0]}, ${values[1]}`;
  return `${plural}: ${values[0]}, ${values[1]} +${values.length - 2} more`;
}

/**
 * Returns the first selected value (for backward-compat renderer metadata)
 * or undefined when nothing is selected.
 */
export function firstLedgerFilterValue(values: string[]): string | undefined {
  return values.length > 0 ? values[0] : undefined;
}

/**
 * Returns a joined label from an array, suitable for PDF filter summaries.
 * e.g. ["A", "B", "C"] → "A, B, C"
 */
export function joinedLedgerFilterLabel(values: string[]): string | undefined {
  return values.length > 0 ? values.join(", ") : undefined;
}

// ── Fee period encoding helpers ────────────────────────────────────────────────

/** Encode a (start, end) date pair into the canonical period token. */
export function encodeFeePeriod(start: string, end: string): string {
  return `${start}|${end}`;
}

/** Decode a period token back into {start, end}. Returns null if malformed. */
export function decodeFeePeriod(token: string): { start: string; end: string } | null {
  const [start, end] = token.split("|");
  if (!start || !end) return null;
  if (!isValidDate(start) || !isValidDate(end)) return null;
  return { start, end };
}
