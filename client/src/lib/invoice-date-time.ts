import { formatInstantIST } from "@shared/ist-time";

/**
 * Formats a persisted invoice timestamp in the parent-facing IST format.
 * This function receives the stored fee_records.created_at value; it never
 * reads the current device time or creates a replacement timestamp.
 *
 * Persisted timestamp-without-time-zone values follow the app's bare-UTC
 * convention (see shared/ist-time.ts): a value such as "2026-08-19 15:38:34"
 * with no zone designator is the UTC wall-clock instant and must be rendered
 * in Asia/Kolkata. Parsing is delegated to the shared helper so the bare-UTC
 * convention and IST rendering are defined in exactly one place rather than
 * duplicated here (naive `new Date("2026-08-19 15:38:34")` would incorrectly
 * treat the value as host-local time).
 */
export function formatPersistedInvoiceDateTimeIST(value: string | Date | null | undefined): string {
  return formatInstantIST(value);
}
