import { formatDateTimeIST } from "@shared/ist-time";

/** Render older "person at UTC ISO" marks in school time without changing stored history. */
export function formatAttendanceMarkedBy(value: string): string {
  const legacy = /^(.*) at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/i.exec(value);
  return legacy ? `${legacy[1]} at ${formatDateTimeIST(legacy[2])}` : value;
}