/**
 * Late Fee & Penalty Calculation Engine
 * Shared by the nightly cron and any on-demand recalculation trigger.
 */

import { db } from "./db";
import { academicSessions, feeRecords, feeStructures } from "@shared/schema";
import { and, eq, or } from "drizzle-orm";
import { todayInIST } from "../shared/ist-time";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LateFeeConfig {
  enabled: boolean;
  type: "NONE" | "FLAT" | "DAILY" | "TIERED";
  grace_period_days: number;
  flat_amount: number;
  daily_rate: number;
  max_cap: number;
  tiered_slabs: Array<{ from_day: number; to_day: number; amount: number }>;
}

export const DEFAULT_LATE_FEE_CONFIG: LateFeeConfig = {
  enabled: false,
  type: "NONE",
  grace_period_days: 0,
  flat_amount: 0,
  daily_rate: 0,
  max_cap: 0,
  tiered_slabs: [],
};

// ── Core calculator ───────────────────────────────────────────────────────────

/**
 * Pure function — no DB access.
 * Returns the late fee (integer ₹) for a given invoice + config + reference date.
 */
export function calculateLateFee(
  config: LateFeeConfig,
  dueDateStr: string,   // "YYYY-MM-DD"
  status: string,
  referenceDate: Date = new Date(),
): number {
  if (!config?.enabled || config.type === "NONE") return 0;
  if (status === "Paid") return 0;

  // DATE-only arithmetic remains UTC component math; the business reference
  // date itself is explicitly derived in the school's timezone.
  const [dy, dm, dd] = dueDateStr.split("-").map(Number);
  const refDateStr   = todayInIST(referenceDate);
  const [ry, rm, rd] = refDateStr.split("-").map(Number);
  const msDay    = 24 * 60 * 60 * 1000;
  const dueMs    = Date.UTC(dy, dm - 1, dd);
  const refMs    = Date.UTC(ry, rm - 1, rd);
  const daysOverdue = Math.max(0, Math.floor((refMs - dueMs) / msDay));

  // FLAT fires immediately on overdue — no grace period by spec
  const grace = (config.type === "FLAT") ? 0 : (config.grace_period_days ?? 0);
  if (daysOverdue <= grace) return 0;

  const effectiveDays = daysOverdue - grace;
  let fee = 0;

  switch (config.type) {
    case "FLAT":
      fee = config.flat_amount ?? 0;
      break;

    case "DAILY":
      fee = effectiveDays * (config.daily_rate ?? 0);
      break;

    case "TIERED": {
      const slabs = (config.tiered_slabs ?? []).slice().sort((a, b) => a.from_day - b.from_day);
      // Find the matching slab (based on total daysOverdue, not effectiveDays)
      let matched: { from_day: number; to_day: number; amount: number } | undefined;
      for (const slab of slabs) {
        if (daysOverdue >= slab.from_day && daysOverdue <= slab.to_day) {
          matched = slab;
          break;
        }
      }
      // If beyond all defined slabs, use the last slab
      if (!matched && slabs.length > 0 && daysOverdue > slabs[slabs.length - 1].to_day) {
        matched = slabs[slabs.length - 1];
      }
      fee = matched?.amount ?? 0;
      break;
    }

    default:
      fee = 0;
  }

  // Apply cap
  const cap = config.max_cap ?? 0;
  if (cap > 0) fee = Math.min(fee, cap);

  return Math.max(0, Math.round(fee));
}

// ── Per-invoice details helper ────────────────────────────────────────────────

export interface InvoiceCurrentDetails {
  base_amount: number;
  accrued_late_fee: number;
  amount_paid: number;
  /** base_amount + accrued_late_fee − amount_paid (floored at 0) */
  total_due: number;
}

/**
 * Pure-function snapshot of an invoice's financial state at a given date.
 * Pass the lateFeeConfig already loaded from the matching fee structure.
 * `amountPaid` should be the sum of all payment_records linked to this invoice.
 */
export function getInvoiceCurrentDetails(
  config: LateFeeConfig | null | undefined,
  invoice: { amount: number; dueDate: string; status: string },
  amountPaid: number = 0,
  targetDate: Date = new Date(),
): InvoiceCurrentDetails {
  const base_amount = invoice.amount;
  const accrued_late_fee =
    config?.enabled
      ? calculateLateFee(config, invoice.dueDate, invoice.status, targetDate)
      : 0;
  const total_due = Math.max(0, base_amount + accrued_late_fee - amountPaid);
  return { base_amount, accrued_late_fee, amount_paid: amountPaid, total_due };
}

// ── Bulk recalculation for a school ──────────────────────────────────────────

/**
 * Recalculates and persists `late_fee_amount` for every unpaid invoice in a
 * school that has an invoice-specific or structure-backed late-fee rule.
 * Returns the count of records updated.
 */
export async function recalculateLateFees(schoolId: number): Promise<number> {
  const today = new Date();
  const [activeSession] = await db
    .select({ id: academicSessions.id })
    .from(academicSessions)
    .where(and(
      eq(academicSessions.schoolId, schoolId),
      eq(academicSessions.isActive, true),
    ))
    .limit(1);
  // An archived academic year is immutable, and legacy records without an
  // owner must never be silently adopted by a current-year recalculation.
  if (!activeSession) return 0;

  // 1. Load all fee structures for the school
  const structures = await db
    .select({ feeType: feeStructures.feeType, lateFeeConfig: feeStructures.lateFeeConfig })
    .from(feeStructures)
    .where(eq(feeStructures.schoolId, schoolId));

  // Build feeType → config map (case-insensitive key)
  const configMap = new Map<string, LateFeeConfig>();
  for (const s of structures) {
    const cfg = s.lateFeeConfig as LateFeeConfig | null;
    if (cfg?.enabled) {
      configMap.set(s.feeType.trim().toLowerCase(), cfg);
    }
  }

  // 2. Load all unpaid fee records for the school
  const unpaid = await db
    .select({
      id: feeRecords.id,
      feeType: feeRecords.feeType,
      dueDate: feeRecords.dueDate,
      status: feeRecords.status,
      lateFeeConfig: feeRecords.lateFeeConfig,
    })
    .from(feeRecords)
    .where(and(
      eq(feeRecords.schoolId, schoolId),
      eq(feeRecords.sessionId, activeSession.id),
      or(
        eq(feeRecords.status, "Due"),
        eq(feeRecords.status, "Overdue"),
      ),
    ));

  // 3. Compute and batch-update
  let updated = 0;
  for (const rec of unpaid) {
    const cfg = (rec.lateFeeConfig as LateFeeConfig | null)
      ?? configMap.get(rec.feeType.trim().toLowerCase());
    if (!cfg) continue;
    const lateFee = calculateLateFee(cfg, rec.dueDate, rec.status, today);
    await db
      .update(feeRecords)
      .set({ lateFeeAmount: lateFee } as any)
      .where(eq(feeRecords.id, rec.id));
    updated++;
  }

  return updated;
}
