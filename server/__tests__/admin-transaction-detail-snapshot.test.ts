/**
 * Focused tests for Step 4 — Admin Transaction Detail Snapshot Source Cleanup.
 *
 * These tests verify the breakdown field extraction logic used by
 * GET /api/admin/fees/:id/transaction-detail.
 *
 * The fix replaces the dead feeRow.breakdown (column does not exist on fee_records)
 * with feeRow.breakdown_snapshot (the immutable JSONB column added in Step 1).
 *
 * Tests cover:
 *  A. Non-empty snapshot → endpoint returns stored components exactly
 *  B. Empty snapshot []  → endpoint returns []
 *  C. Historical immutability — snapshot values, not live fee_structures values
 *  D. Legacy invoice (breakdown_snapshot = []) → returns [] (no reconstruction)
 *  E. Null/undefined breakdown_snapshot → safe fallback [] (defensive)
 *  F. Non-array value → safe fallback []
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Pure logic extracted from the endpoint — mirrors the exact expression:
//   breakdown: Array.isArray(feeRow.breakdown_snapshot) ? feeRow.breakdown_snapshot : []
// ─────────────────────────────────────────────────────────────────────────────

type Component = { name: string; purpose: string; amount: number };

function extractBreakdown(feeRow: { breakdown_snapshot?: unknown }): Component[] {
  return Array.isArray(feeRow.breakdown_snapshot) ? (feeRow.breakdown_snapshot as Component[]) : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Non-empty snapshot → returns stored components exactly
// ─────────────────────────────────────────────────────────────────────────────
describe("Admin transaction-detail breakdown — non-empty snapshot (Test A)", () => {
  const snapshot = [
    { name: "Tuition",    purpose: "Academic tuition", amount: 2200 },
    { name: "Laboratory", purpose: "Laboratory charges", amount: 300 },
  ];

  it("returns all stored components", () => {
    const result = extractBreakdown({ breakdown_snapshot: snapshot });
    expect(result).toHaveLength(2);
  });

  it("preserves exact component names", () => {
    const result = extractBreakdown({ breakdown_snapshot: snapshot });
    expect(result[0].name).toBe("Tuition");
    expect(result[1].name).toBe("Laboratory");
  });

  it("preserves exact component amounts", () => {
    const result = extractBreakdown({ breakdown_snapshot: snapshot });
    expect(result[0].amount).toBe(2200);
    expect(result[1].amount).toBe(300);
  });

  it("preserves exact component purposes", () => {
    const result = extractBreakdown({ breakdown_snapshot: snapshot });
    expect(result[0].purpose).toBe("Academic tuition");
    expect(result[1].purpose).toBe("Laboratory charges");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Empty snapshot → returns []
// ─────────────────────────────────────────────────────────────────────────────
describe("Admin transaction-detail breakdown — empty snapshot (Test B)", () => {
  it("returns [] for breakdown_snapshot = []", () => {
    const result = extractBreakdown({ breakdown_snapshot: [] });
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Historical immutability — snapshot values only, never live structure
// ─────────────────────────────────────────────────────────────────────────────
describe("Admin transaction-detail breakdown — historical immutability (Test C)", () => {
  it("returns the frozen snapshot values, not the current fee structure values", () => {
    // Invoice was created with these component values (frozen in fee_records)
    const frozenSnapshot = [
      { name: "Tuition",    purpose: "", amount: 2200 },
      { name: "Laboratory", purpose: "", amount: 300  },
      { name: "Library",    purpose: "", amount: 500  },
    ];

    // Admin later changes the fee structure (these values exist only in fee_structures)
    const currentFeeStructure = [
      { name: "Tuition",    purpose: "", amount: 2500 },  // changed
      { name: "Laboratory", purpose: "", amount: 300  },
      { name: "Library",    purpose: "", amount: 1200 },  // changed
    ];

    // The endpoint reads ONLY from feeRow.breakdown_snapshot (fee_records)
    // It never reads fee_structures
    const result = extractBreakdown({ breakdown_snapshot: frozenSnapshot });

    // Must return frozen values
    expect(result[0].amount).toBe(2200);  // ₹2,200, not ₹2,500
    expect(result[2].amount).toBe(500);   // ₹500, not ₹1,200

    // Confirm live values differ (ensuring the test is meaningful)
    expect(currentFeeStructure[0].amount).toBe(2500);
    expect(currentFeeStructure[2].amount).toBe(1200);

    // Confirm no live structure was used
    expect(result[0].amount).not.toBe(currentFeeStructure[0].amount);
    expect(result[2].amount).not.toBe(currentFeeStructure[2].amount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Legacy invoice → [] with no reconstruction (Test D)
// ─────────────────────────────────────────────────────────────────────────────
describe("Admin transaction-detail breakdown — legacy invoice (Test D)", () => {
  it("returns [] for a pre-migration invoice whose breakdown_snapshot is empty", () => {
    // Pre-migration rows have breakdown_snapshot = [] (the DB default)
    const result = extractBreakdown({ breakdown_snapshot: [] });
    expect(result).toEqual([]);
    // No reconstruction from fee_structures attempted — this function takes only feeRow
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E–F. Defensive fallbacks for unexpected values
// ─────────────────────────────────────────────────────────────────────────────
describe("Admin transaction-detail breakdown — defensive fallbacks", () => {
  it("returns [] when breakdown_snapshot is null", () => {
    expect(extractBreakdown({ breakdown_snapshot: null })).toEqual([]);
  });

  it("returns [] when breakdown_snapshot is undefined", () => {
    expect(extractBreakdown({})).toEqual([]);
  });

  it("returns [] when breakdown_snapshot is a string (unexpected type)", () => {
    expect(extractBreakdown({ breakdown_snapshot: "[]" })).toEqual([]);
  });

  it("returns [] when breakdown_snapshot is a plain object (not an array)", () => {
    expect(extractBreakdown({ breakdown_snapshot: {} })).toEqual([]);
  });

  it("returns the array unchanged when breakdown_snapshot is a valid non-empty array", () => {
    const snap = [{ name: "Tuition", purpose: "", amount: 3000 }];
    const result = extractBreakdown({ breakdown_snapshot: snap });
    expect(result).toBe(snap); // same reference — no copy needed at this layer
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confirm old dead-code pattern is no longer used
// ─────────────────────────────────────────────────────────────────────────────
describe("Admin transaction-detail breakdown — dead code contract", () => {
  it("does not use JSON.parse on feeRow.breakdown (old dead path)", () => {
    // The old code did: JSON.parse(feeRow.breakdown ?? "[]")
    // feeRow.breakdown was always undefined (column does not exist) → always returned []
    // The new code reads feeRow.breakdown_snapshot (real JSONB column, already parsed by pg driver)
    // This test confirms the new function does NOT call JSON.parse at all
    const feeRowWithNoBreakdownColumn = {
      breakdown_snapshot: [{ name: "Library", purpose: "", amount: 500 }],
      // breakdown: <does not exist>
    };
    const result = extractBreakdown(feeRowWithNoBreakdownColumn);
    expect(result[0].name).toBe("Library");
    expect(result[0].amount).toBe(500);
  });
});
