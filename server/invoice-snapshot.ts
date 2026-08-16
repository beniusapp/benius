/**
 * invoice-snapshot.ts
 *
 * Pure utility for building an immutable fee-component snapshot at invoice
 * creation time.  The snapshot is written once into fee_records.breakdown_snapshot
 * and must never be updated afterwards.
 *
 * This module has NO side-effects on fee structures, payment records, or
 * any other part of the system.  It only validates and deep-copies component
 * data from a fee_structures.breakdown value.
 */

export type BreakdownComponent = {
  name: string;
  purpose: string;
  amount: number;
};

/**
 * Validates and deep-copies a fee_structures.breakdown array into an
 * immutable invoice snapshot.
 *
 * HARD FAILURES (throws — blocks invoice creation):
 *   - Component has an empty or missing name
 *   - Component amount is NaN, Infinity, or -Infinity
 *   - Component amount is negative
 *
 * SOFT WARNINGS (console.warn — never blocks):
 *   - Duplicate component names within the same breakdown
 *
 * SAFE DEFAULTS (never fabricates data):
 *   - null / undefined / non-array breakdown → returns []
 *   - Empty breakdown → returns []
 *   - Missing purpose → preserved as ""
 *
 * @param breakdown  Raw value from fee_structures.breakdown (unknown type for safety)
 * @returns          Deep-copied, validated array safe to store in fee_records
 * @throws           Error if any component fails a hard validation rule
 */
export function buildBreakdownSnapshot(breakdown: unknown): BreakdownComponent[] {
  // Null / undefined / non-array / empty → empty snapshot; never fabricate
  if (!Array.isArray(breakdown) || breakdown.length === 0) return [];

  const seen = new Set<string>();
  const snapshot: BreakdownComponent[] = [];

  for (let i = 0; i < breakdown.length; i++) {
    const raw = breakdown[i];

    if (!raw || typeof raw !== "object") {
      throw new Error(
        `Fee component at index ${i} is not a valid object. All components must be plain objects.`,
      );
    }

    // ── name ──────────────────────────────────────────────────────────────────
    const name: string =
      typeof (raw as any).name === "string" ? (raw as any).name.trim() : "";
    if (!name) {
      throw new Error(
        `Fee component at index ${i} has an empty or missing name. ` +
          `All components must have a valid name before an invoice can be created.`,
      );
    }

    // ── amount ────────────────────────────────────────────────────────────────
    const rawAmount = (raw as any).amount;
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount)) {
      throw new Error(
        `Fee component "${name}" has a non-finite amount (${rawAmount}). ` +
          `Component amounts must be finite numbers.`,
      );
    }
    if (amount < 0) {
      throw new Error(
        `Fee component "${name}" has a negative amount (${amount}). ` +
          `Component amounts must be zero or positive.`,
      );
    }

    // ── purpose ───────────────────────────────────────────────────────────────
    // Optional — default to "" if missing; never invent a value
    const purpose: string =
      typeof (raw as any).purpose === "string" ? (raw as any).purpose : "";

    // ── duplicate name (soft warning only) ────────────────────────────────────
    if (seen.has(name)) {
      console.warn(
        `[invoice-snapshot] Duplicate component name "${name}" in fee structure breakdown.`,
      );
    }
    seen.add(name);

    // Deep copy — no reference to the original structure object
    snapshot.push({ name, purpose, amount });
  }

  return snapshot;
}

/**
 * Emits a console warning when the sum of component amounts does not equal
 * the authoritative invoice amount.  Never throws — sum mismatch is never
 * a blocker.  The authoritative amount is always fee_records.amount.
 *
 * @param snapshot      Validated breakdown snapshot
 * @param invoiceAmount fee_records.amount (the authoritative net fee)
 * @param context       Short string for the log message (e.g. "INV-0042")
 */
export function warnOnSumMismatch(
  snapshot: BreakdownComponent[],
  invoiceAmount: number,
  context: string,
): void {
  if (snapshot.length === 0) return;
  const sum = snapshot.reduce((acc, c) => acc + c.amount, 0);
  if (sum !== invoiceAmount) {
    console.warn(
      `[invoice-snapshot] Component sum (${sum}) ≠ invoice amount (${invoiceAmount}) for ${context}. ` +
        `The authoritative invoice amount is fee_records.amount.`,
    );
  }
}
