import { formatDateOnly, formatDateTimeIST, formatInstantIST } from "@shared/ist-time";

export function fmtDate(iso: string | null | undefined): string {
  return formatDateOnly(iso);
}

export function fmtDateTime(iso: string | null | undefined): string {
  return formatDateTimeIST(iso);
}

export function fmtDateTimeAmPm(iso: string | null | undefined): string {
  return formatInstantIST(iso);
}

export function fmtDateLong(iso: string | null | undefined): string {
  return formatDateOnly(iso);
}

export function fmtDateShort(iso: string | null | undefined): string {
  return formatDateOnly(iso).replace(/\s+\d{4}$/, "");
}

export function fmtDateWithWeekday(iso: string | null | undefined): string {
  return formatDateOnly(iso);
}
