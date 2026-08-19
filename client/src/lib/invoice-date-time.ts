/**
 * Formats a persisted invoice timestamp in the parent-facing IST format.
 * This function receives the stored fee_records.created_at value; it never
 * reads the current device time or creates a replacement timestamp.
 */
export function formatPersistedInvoiceDateTimeIST(value: string | Date | null | undefined): string {
  if (!value) return "—";

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const dateParts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const timeParts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part(dateParts, "day")} ${part(dateParts, "month")} ${part(dateParts, "year")}, ${part(timeParts, "hour")}:${part(timeParts, "minute")}:${part(timeParts, "second")} ${part(timeParts, "dayPeriod").toUpperCase()} IST`;
}