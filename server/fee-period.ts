/**
 * Fee-Period Utility
 *
 * Computes and displays immutable billing periods for school fee invoices.
 * A fee period is independent from the invoice generation date, due date,
 * and payment date.
 *
 * Frequency + Billing-Timing rules:
 *   Monthly  + Advance  → period = current month
 *   Monthly  + Arrears  → period = previous month
 *   Quarterly + Advance → period = current calendar quarter
 *   Quarterly + Arrears → period = previous completed calendar quarter
 *   Annual   (any)      → period = academic session (startDate…endDate)
 *   One-Time (any)      → period = academic session (startDate…endDate)
 *
 * Calendar quarters follow the standard Western year:
 *   Q1 Jan–Mar · Q2 Apr–Jun · Q3 Jul–Sep · Q4 Oct–Dec
 */

export interface FeePeriod {
  /** ISO 8601 date string, e.g. "2026-08-01" */
  start: string;
  /** ISO 8601 date string, e.g. "2026-08-31" */
  end: string;
}

interface AcademicSessionRef {
  startDate: string | Date;
  endDate: string | Date;
  sessionName?: string;
}

/**
 * Compute the fee period for a new invoice.
 *
 * @param frequency      "monthly" | "quarterly" | "annual" | "one-time"
 * @param billingTiming  "advance" | "arrears"  (ignored for annual/one-time)
 * @param referenceDate  The moment generation occurs (typically new Date())
 * @param session        Required for annual/one-time; optional otherwise
 */
export function computeFeePeriod(
  frequency: string,
  billingTiming: string,
  referenceDate: Date,
  session?: AcademicSessionRef | null,
): FeePeriod {
  const year  = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-indexed

  // ── Annual / One-Time ────────────────────────────────────────────────────
  if (frequency === "annual" || frequency === "one-time") {
    const start = session
      ? String(session.startDate).slice(0, 10)
      : `${year}-04-01`;
    const end = session
      ? String(session.endDate).slice(0, 10)
      : `${year + 1}-03-31`;
    return { start, end };
  }

  // ── Monthly ──────────────────────────────────────────────────────────────
  if (frequency === "monthly") {
    const offset  = billingTiming === "arrears" ? -1 : 0;
    const pd      = new Date(year, month + offset, 1);
    const py      = pd.getFullYear();
    const pm      = pd.getMonth();           // 0-indexed
    const lastDay = new Date(py, pm + 1, 0).getDate();
    return {
      start: `${py}-${String(pm + 1).padStart(2, "0")}-01`,
      end:   `${py}-${String(pm + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  // ── Quarterly ────────────────────────────────────────────────────────────
  if (frequency === "quarterly") {
    let qi  = Math.floor(month / 3); // 0=Q1(Jan-Mar)…3=Q4(Oct-Dec)
    let py  = year;
    if (billingTiming === "arrears") {
      if (qi === 0) { qi = 3; py = year - 1; }
      else { qi--; }
    }
    const startMonth = qi * 3;       // 0-indexed
    const endMonth   = startMonth + 2;
    const lastDay    = new Date(py, endMonth + 1, 0).getDate();
    return {
      start: `${py}-${String(startMonth + 1).padStart(2, "0")}-01`,
      end:   `${py}-${String(endMonth   + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    start: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    end:   `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * Derive a human-readable fee-period label from the stored period dates.
 *
 * Infers frequency from the date-range width:
 *   ≤ 31 days  → Monthly   → "August 2026"
 *   ≤ 92 days  → Quarterly → "April–June 2026"
 *    > 92 days → Annual    → "2025–26"  (or academicYear when provided)
 *
 * Returns academicYear when period dates are absent (pre-migration records),
 * ensuring backward-compatible display for all existing invoices.
 */
export function feePeriodLabel(
  feePeriodStart: string | null | undefined,
  feePeriodEnd:   string | null | undefined,
  academicYear?:  string | null,
): string {
  if (!feePeriodStart || !feePeriodEnd) {
    return academicYear ?? "—";
  }

  const s    = new Date(feePeriodStart + "T00:00:00");
  const e    = new Date(feePeriodEnd   + "T00:00:00");
  const days = Math.round((e.getTime() - s.getTime()) / 86400000);

  if (days <= 31) {
    return s.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }

  if (days <= 92) {
    const startLabel = s.toLocaleDateString("en-IN", { month: "long" });
    const endLabel   = e.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    return `${startLabel}–${endLabel}`;
  }

  // Annual
  if (academicYear) return academicYear;
  const y = s.getFullYear();
  return `${y}–${String(y + 1).slice(2)}`;
}
