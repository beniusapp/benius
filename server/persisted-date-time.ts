import { formatInstantIST } from "../shared/ist-time";

/**
 * Formats an already-persisted event timestamp for finance documents.
 * It never creates a new timestamp or uses the server's current time.
 */
export function formatPersistedDateTimeIST(value: string | Date | null | undefined): string {
  return formatInstantIST(value);
}