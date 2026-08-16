/**
 * Late Fee Display Helper
 *
 * Builds the student-facing, display-oriented LateFeeInfo object from the
 * authoritative LateFeeConfig. This is a pure string-building layer —
 * it does NOT recalculate the actual late fee amount; it receives the
 * already-computed `accruedLateFee` from `calculateLateFee()` and uses it
 * only for display purposes.
 *
 * Nothing in this file affects payment amounts, Razorpay orders, webhooks,
 * offline validation, FIFO allocation, or the nightly cron.
 */

import type { LateFeeConfig } from "./late-fee-engine";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LateFeeInfoTieredSlab {
  from_day: number;
  to_day: number;
  amount: number;
}

export interface LateFeeInfo {
  /** Whether a late-fee policy is active for this invoice. */
  enabled: boolean;
  /** The rule type in force. */
  rule: "NONE" | "FLAT" | "DAILY" | "TIERED";
  /** Calendar days since the due date (0 = on or before due date). */
  daysOverdue: number;
  /** True when daysOverdue > 0 but still within the grace window. */
  inGracePeriod: boolean;
  /** How many grace days remain (> 0 only when inGracePeriod is true). */
  graceDaysRemaining: number;
  /** The authoritative calculated late fee — equal to accrued_late_fee. */
  currentLateFee: number;
  /** Human-readable policy summary, e.g. "₹20 per day after the due date." */
  policyLine: string;
  /** Parent/student-friendly overdue status, e.g. "You are 3 days past the due date."
   *  null when not yet overdue or when inGracePeriod is true (use gracePeriodMessage). */
  statusMessage: string | null;
  /** Full grace-period narrative — shown instead of statusMessage during the grace window. */
  gracePeriodMessage: string | null;
  /** Secondary technical breakdown, e.g. "1 billable day × ₹20 = ₹20". null for FLAT/TIERED. */
  calculationLine: string | null;
  /** Tiered schedule (sorted ascending). Non-null only when rule is "TIERED". */
  tieredSlabs: LateFeeInfoTieredSlab[] | null;
  /** Index into tieredSlabs[] that is currently active. null when not overdue. */
  activeSlabIndex: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const DISABLED: LateFeeInfo = {
  enabled: false, rule: "NONE", daysOverdue: 0,
  inGracePeriod: false, graceDaysRemaining: 0, currentLateFee: 0,
  policyLine: "", statusMessage: null, gracePeriodMessage: null,
  calculationLine: null, tieredSlabs: null, activeSlabIndex: null,
};

function fmtRs(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

function dayWord(n: number): string {
  return n === 1 ? "day" : "days";
}

// ── Main builder ───────────────────────────────────────────────────────────────

/**
 * Builds a display-oriented LateFeeInfo object for the student portal.
 *
 * @param cfg            The fee structure's lateFeeConfig (may be null/undefined).
 * @param dueDate        ISO date string "YYYY-MM-DD" from the fee record.
 * @param status         Invoice status ("Due", "Overdue", "Partial", "Paid", "Waived").
 * @param now            Reference date (pass new Date() in production).
 * @param accruedLateFee The amount already returned by calculateLateFee() — reused here,
 *                       never recalculated.
 */
export function buildLateFeeInfo(
  cfg: LateFeeConfig | null | undefined,
  dueDate: string,
  status: string,
  now: Date,
  accruedLateFee: number,
): LateFeeInfo {
  // Guard: no policy, or invoice is already settled
  if (!cfg?.enabled || cfg.type === "NONE") return { ...DISABLED };
  if (status === "Paid" || status === "Waived") return { ...DISABLED };

  // ── Compute daysOverdue using the same UTC arithmetic as calculateLateFee() ──
  const [dy, dm, dd] = dueDate.split("-").map(Number);
  const refDateStr   = now.toISOString().split("T")[0];
  const [ry, rm, rd] = refDateStr.split("-").map(Number);
  const msDay        = 24 * 60 * 60 * 1000;
  const dueMs        = Date.UTC(dy, dm - 1, dd);
  const refMs        = Date.UTC(ry, rm - 1, rd);
  const daysOverdue  = Math.max(0, Math.floor((refMs - dueMs) / msDay));

  const rule  = cfg.type as "FLAT" | "DAILY" | "TIERED";
  // FLAT and TIERED do not use a grace period
  const grace = (rule === "FLAT" || rule === "TIERED") ? 0 : (cfg.grace_period_days ?? 0);
  const inGracePeriod      = daysOverdue > 0 && daysOverdue <= grace;
  const graceDaysRemaining = Math.max(0, grace - daysOverdue);
  const effectiveDays      = Math.max(0, daysOverdue - grace);
  const cap                = cfg.max_cap ?? 0;

  // ── Policy line ────────────────────────────────────────────────────────────
  let policyLine = "";
  if (rule === "FLAT") {
    policyLine = `${fmtRs(cfg.flat_amount ?? 0)} one-time penalty after the due date.`;
  } else if (rule === "DAILY") {
    const rate = cfg.daily_rate ?? 0;
    let base   = `${fmtRs(rate)} per day`;
    base      += grace > 0 ? ` after a ${grace}-day grace period` : " after the due date";
    policyLine = cap > 0 ? `${base}. Maximum late fee ${fmtRs(cap)}.` : `${base}.`;
  } else {
    policyLine = "A tiered penalty applies after the due date.";
  }

  // ── Grace period narrative ─────────────────────────────────────────────────
  let gracePeriodMessage: string | null = null;
  if (inGracePeriod) {
    if (graceDaysRemaining === 0) {
      // daysOverdue === grace — the very last day of grace
      gracePeriodMessage =
        `Your ${grace}-day grace period ends today. No late fee is charged yet. ` +
        `A late fee will apply from tomorrow.`;
    } else {
      gracePeriodMessage =
        `You are ${daysOverdue} ${dayWord(daysOverdue)} past the due date. ` +
        `Your ${grace}-day grace period is still active. No late fee is charged yet.`;
    }
  }

  // ── Status message (primary, parent-friendly) ──────────────────────────────
  let statusMessage: string | null = null;
  if (!inGracePeriod && daysOverdue > 0) {
    if (grace > 0) {
      statusMessage =
        `Your ${grace}-day grace period has ended. ` +
        `You are ${daysOverdue} ${dayWord(daysOverdue)} past the due date.`;
    } else {
      statusMessage = `You are ${daysOverdue} ${dayWord(daysOverdue)} past the due date.`;
    }
  }

  // ── Calculation line (secondary, technical) ────────────────────────────────
  let calculationLine: string | null = null;
  if (accruedLateFee > 0) {
    if (rule === "DAILY") {
      const rate       = cfg.daily_rate ?? 0;
      const cappedNote = (cap > 0 && accruedLateFee >= cap) ? ` (capped at ${fmtRs(cap)})` : "";
      if (grace > 0 && effectiveDays < daysOverdue) {
        calculationLine =
          `${effectiveDays} billable ${dayWord(effectiveDays)} × ${fmtRs(rate)} = ${fmtRs(accruedLateFee)}${cappedNote}`;
      } else {
        calculationLine =
          `${effectiveDays} ${dayWord(effectiveDays)} × ${fmtRs(rate)}/day = ${fmtRs(accruedLateFee)}${cappedNote}`;
      }
    }
    // FLAT: policyLine is self-explanatory — no calculationLine needed
    // TIERED: the highlighted slab table serves as the visual explanation
  }

  // ── Tiered slabs ──────────────────────────────────────────────────────────
  let tieredSlabs: LateFeeInfoTieredSlab[] | null = null;
  let activeSlabIndex: number | null = null;
  if (rule === "TIERED") {
    const sorted = (cfg.tiered_slabs ?? []).slice().sort((a, b) => a.from_day - b.from_day);
    tieredSlabs = sorted;
    if (daysOverdue > 0 && sorted.length > 0) {
      let idx = sorted.findIndex(s => daysOverdue >= s.from_day && daysOverdue <= s.to_day);
      if (idx === -1 && daysOverdue > sorted[sorted.length - 1].to_day) {
        idx = sorted.length - 1; // beyond last slab — pin to last
      }
      activeSlabIndex = idx >= 0 ? idx : null;
    }
  }

  return {
    enabled: true,
    rule,
    daysOverdue,
    inGracePeriod,
    graceDaysRemaining,
    currentLateFee: accruedLateFee,
    policyLine,
    statusMessage,
    gracePeriodMessage,
    calculationLine,
    tieredSlabs,
    activeSlabIndex,
  };
}
