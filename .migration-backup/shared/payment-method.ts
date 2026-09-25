/**
 * shared/payment-method.ts
 *
 * Canonical payment-method utilities shared across server and client.
 *
 * History
 * ───────
 * "Online" was the original stored value written to payment_records.payment_method
 * for Student Portal / Razorpay payments.  "Portal Payment" is the correct
 * business-facing label for all such payments.  Both values are treated as
 * semantically identical; normalizePaymentMethod() maps legacy records so all
 * callers receive the correct display value without a forced DB migration.
 *
 * The expansion shim in expandPaymentMethodFilter() ensures filter predicates and
 * SQL GROUP BY match both stored representations so no records are silently dropped.
 * New writes use the canonical value; display normalization covers any legacy rows.
 */

export const PORTAL_PAYMENT_METHOD = "Portal Payment" as const;

/** Legacy stored value written before the Portal Payment rename. */
const LEGACY_PORTAL_METHOD = "Online" as const;

/**
 * Returns the canonical business-facing display value for a stored
 * payment_method.
 *
 * - "Online" (legacy) → "Portal Payment"
 * - "Portal Payment"  → "Portal Payment"
 * - Any other value   → returned unchanged (Cash, BankTransfer, etc.)
 * - null / undefined  → null
 */
export function normalizePaymentMethod(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw === LEGACY_PORTAL_METHOD || raw === PORTAL_PAYMENT_METHOD) {
    return PORTAL_PAYMENT_METHOD;
  }
  return raw;
}

/**
 * Returns true when the stored payment_method represents a Student Portal /
 * Razorpay payment — either the legacy "Online" value or the current
 * "Portal Payment" value.
 */
export function isPortalPayment(method: string | null | undefined): boolean {
  return method === LEGACY_PORTAL_METHOD || method === PORTAL_PAYMENT_METHOD;
}

/**
 * Expands a client-supplied paymentMethods filter array so that a request
 * for "Portal Payment" also matches legacy "Online" rows still in the DB.
 *
 * Call this inside ledger-filter-sql.ts before building SQL predicates.
 * The expansion is always required because legacy "Online" rows may remain
 * in any DB that has not been explicitly migrated.
 */
export function expandPaymentMethodFilter(values: readonly string[]): string[] {
  const out: string[] = [];
  const hasPortal = values.includes(PORTAL_PAYMENT_METHOD);
  const hasLegacy = values.includes(LEGACY_PORTAL_METHOD);
  for (const v of values) {
    out.push(v);
  }
  // Add the legacy value so SQL predicates match both stored representations.
  if (hasPortal && !hasLegacy) {
    out.push(LEGACY_PORTAL_METHOD);
  }
  // Similarly, if someone passes "Online" explicitly (e.g. a stale bookmark),
  // also match "Portal Payment" rows so they don't get empty results.
  if (hasLegacy && !hasPortal) {
    out.push(PORTAL_PAYMENT_METHOD);
  }
  return out;
}
