function safe(iso: string | null | undefined, timeSuffix = "T00:00:00"): Date | null {
  if (!iso) return null;
  const d = new Date(String(iso).includes("T") ? iso : iso + timeSuffix);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtDate(iso: string | null | undefined): string {
  const d = safe(iso);
  if (!d) return iso ? String(iso) : "—";
  return d.toLocaleDateString("en-GB");
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function fmtDateTimeAmPm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleDateString("en-GB")}, ${d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })}`;
}

export function fmtDateLong(iso: string | null | undefined): string {
  const d = safe(iso);
  if (!d) return iso ? String(iso) : "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateShort(iso: string | null | undefined): string {
  const d = safe(iso);
  if (!d) return iso ? String(iso) : "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function fmtDateWithWeekday(iso: string | null | undefined): string {
  const d = safe(iso);
  if (!d) return iso ? String(iso) : "—";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
