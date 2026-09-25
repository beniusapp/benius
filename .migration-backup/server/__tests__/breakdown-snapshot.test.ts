/**
 * Focused tests for Step 2 — Immutable Fee Component Snapshot.
 *
 * Tests cover:
 *  1.  Structure-based invoice receives non-empty breakdown snapshot
 *  2.  Snapshot contains exact component values (name, purpose, amount)
 *  3.  Empty breakdown produces []
 *  4.  Admin-direct invoice (no structure) produces []
 *  5.  Offline auto-create invoice (no structure) produces []
 *  6.  Negative component amount is rejected (hard failure)
 *  7.  Empty component name is rejected (hard failure)
 *  8.  Non-finite component amount is rejected (hard failure — NaN, Infinity, -Infinity)
 *  9.  Component sum mismatch does NOT block invoice creation
 * 10.  Changing the fee structure after invoice creation does NOT change the stored snapshot
 * 11.  Null / undefined breakdown safely returns []
 * 12.  Zero-amount component is allowed (legitimate placeholder)
 * 13.  Duplicate component names warn but do not block
 * 14.  Missing purpose defaults to "" (not fabricated)
 * 15.  Deep copy — modifying the source array does not mutate the snapshot
 * 16.  warnOnSumMismatch does not throw on mismatch (sum mismatch never blocks)
 * 17.  warnOnSumMismatch is silent when snapshot is empty
 * 18.  Non-object element inside breakdown array is rejected
 *
 * These tests exercise the pure buildBreakdownSnapshot / warnOnSumMismatch
 * functions directly — no HTTP server or DB required.
 */

import { describe, it, expect, vi } from "vitest";
import { buildBreakdownSnapshot, warnOnSumMismatch } from "../invoice-snapshot";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const tuition   = { name: "Tuition",    purpose: "Academic tuition fee", amount: 2200 };
const lab       = { name: "Laboratory", purpose: "Laboratory fee",       amount: 300  };
const library   = { name: "Library",    purpose: "Library fee",          amount: 500  };

// ─────────────────────────────────────────────────────────────────────────────
// 1. Structure-based invoice — non-empty breakdown
// ─────────────────────────────────────────────────────────────────────────────
describe("buildBreakdownSnapshot — structure-based invoice", () => {
  it("copies components exactly when fee structure has a breakdown", () => {
    const snapshot = buildBreakdownSnapshot([tuition, lab, library]);
    expect(snapshot).toHaveLength(3);
    expect(snapshot[0]).toEqual({ name: "Tuition",    purpose: "Academic tuition fee", amount: 2200 });
    expect(snapshot[1]).toEqual({ name: "Laboratory", purpose: "Laboratory fee",       amount: 300  });
    expect(snapshot[2]).toEqual({ name: "Library",    purpose: "Library fee",          amount: 500  });
  });

  // 2. Exact values
  it("preserves exact name, purpose, and amount for each component", () => {
    const snapshot = buildBreakdownSnapshot([{ name: "Transport", purpose: "Bus route A", amount: 750 }]);
    expect(snapshot[0].name).toBe("Transport");
    expect(snapshot[0].purpose).toBe("Bus route A");
    expect(snapshot[0].amount).toBe(750);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Empty breakdown
// ─────────────────────────────────────────────────────────────────────────────
describe("buildBreakdownSnapshot — empty / no breakdown", () => {
  it("returns [] for an empty array", () => {
    expect(buildBreakdownSnapshot([])).toEqual([]);
  });

  // 11. Null / undefined
  it("returns [] for null", () => {
    expect(buildBreakdownSnapshot(null)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(buildBreakdownSnapshot(undefined)).toEqual([]);
  });

  // 4 & 5: admin-direct and offline paths supply no structure → empty
  it("returns [] when no breakdown is provided (admin-direct / offline path behaviour)", () => {
    // These paths call createFeeRecord without a breakdown source.
    // They rely on the DB default []; buildBreakdownSnapshot is not called.
    // This test confirms the pure function also handles the absence safely.
    expect(buildBreakdownSnapshot(undefined)).toEqual([]);
    expect(buildBreakdownSnapshot([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Negative amount — hard failure
// ─────────────────────────────────────────────────────────────────────────────
describe("buildBreakdownSnapshot — validation failures (hard block)", () => {
  it("throws on negative component amount", () => {
    expect(() =>
      buildBreakdownSnapshot([{ name: "Tuition", purpose: "Test", amount: -500 }]),
    ).toThrow(/negative amount/i);
  });

  // 7. Empty name
  it("throws on empty component name", () => {
    expect(() =>
      buildBreakdownSnapshot([{ name: "", purpose: "Test", amount: 500 }]),
    ).toThrow(/empty or missing name/i);
  });

  it("throws on whitespace-only component name", () => {
    expect(() =>
      buildBreakdownSnapshot([{ name: "   ", purpose: "Test", amount: 500 }]),
    ).toThrow(/empty or missing name/i);
  });

  it("throws on missing name property", () => {
    expect(() =>
      buildBreakdownSnapshot([{ purpose: "Test", amount: 500 }]),
    ).toThrow(/empty or missing name/i);
  });

  // 8. Non-finite amount
  it("throws on NaN component amount", () => {
    expect(() =>
      buildBreakdownSnapshot([{ name: "Tuition", purpose: "Test", amount: NaN }]),
    ).toThrow(/non-finite amount/i);
  });

  it("throws on Infinity component amount", () => {
    expect(() =>
      buildBreakdownSnapshot([{ name: "Tuition", purpose: "Test", amount: Infinity }]),
    ).toThrow(/non-finite amount/i);
  });

  it("throws on -Infinity component amount", () => {
    expect(() =>
      buildBreakdownSnapshot([{ name: "Tuition", purpose: "Test", amount: -Infinity }]),
    ).toThrow(/non-finite amount/i);
  });

  // 18. Non-object element
  it("throws when a component is not a plain object", () => {
    expect(() =>
      buildBreakdownSnapshot(["Tuition"]),
    ).toThrow(/not a valid object/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Component sum mismatch — never blocks
// ─────────────────────────────────────────────────────────────────────────────
describe("buildBreakdownSnapshot — sum mismatch (soft warning only)", () => {
  it("returns the snapshot successfully even when components do not sum to the invoice amount", () => {
    // Components = ₹2,800 but invoice amount = ₹3,000
    const snapshot = buildBreakdownSnapshot([
      { name: "Tuition",    purpose: "", amount: 2200 },
      { name: "Laboratory", purpose: "", amount: 300  },
      // library component missing — components sum to ₹2,500, not ₹3,000
    ]);
    expect(snapshot).toHaveLength(2);
    // Invoice is NOT blocked
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Historical immutability — snapshot is a deep copy
// ─────────────────────────────────────────────────────────────────────────────
describe("buildBreakdownSnapshot — immutability", () => {
  it("returns a deep copy — mutating the source structure does not change the snapshot", () => {
    const source = [
      { name: "Tuition",    purpose: "Academic tuition fee", amount: 2200 },
      { name: "Laboratory", purpose: "Laboratory fee",       amount: 300  },
      { name: "Library",    purpose: "Library fee",          amount: 500  },
    ];
    const snapshot = buildBreakdownSnapshot(source);

    // Simulate administrator changing the fee structure after invoice creation
    source[0].amount = 2500;  // Tuition raised to ₹2,500
    source[1].amount = 300;
    source[2].amount = 200;   // Library reduced to ₹200
    source.push({ name: "Activity", purpose: "New component", amount: 100 });

    // The stored snapshot must reflect the ORIGINAL values
    expect(snapshot).toHaveLength(3);
    expect(snapshot[0].amount).toBe(2200);  // still ₹2,200, not ₹2,500
    expect(snapshot[2].amount).toBe(500);   // still ₹500, not ₹200
  });

  it("does not share object references with the source", () => {
    const source = [{ name: "Tuition", purpose: "Fee", amount: 2200 }];
    const snapshot = buildBreakdownSnapshot(source);
    expect(snapshot[0]).not.toBe(source[0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Zero-amount component — allowed
// ─────────────────────────────────────────────────────────────────────────────
describe("buildBreakdownSnapshot — edge cases", () => {
  it("allows a zero-amount component (legitimate placeholder)", () => {
    const snapshot = buildBreakdownSnapshot([
      { name: "Activity Fee", purpose: "Waived this year", amount: 0 },
    ]);
    expect(snapshot[0].amount).toBe(0);
  });

  // 13. Duplicate names — warn but don't block
  it("allows duplicate component names (warns but does not throw)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      buildBreakdownSnapshot([
        { name: "Tuition", purpose: "Term 1", amount: 1500 },
        { name: "Tuition", purpose: "Term 2", amount: 1500 },
      ]),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Duplicate"));
    warnSpy.mockRestore();
  });

  // 14. Missing purpose
  it("defaults missing purpose to empty string (never fabricates text)", () => {
    const snapshot = buildBreakdownSnapshot([
      { name: "Library", amount: 500 },
    ]);
    expect(snapshot[0].purpose).toBe("");
  });

  it("preserves a provided purpose string unchanged", () => {
    const snapshot = buildBreakdownSnapshot([
      { name: "Library", purpose: "Annual library access", amount: 500 },
    ]);
    expect(snapshot[0].purpose).toBe("Annual library access");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15–17. warnOnSumMismatch
// ─────────────────────────────────────────────────────────────────────────────
describe("warnOnSumMismatch", () => {
  it("does not throw when component sum differs from invoice amount", () => {
    const snapshot = [
      { name: "Tuition", purpose: "", amount: 2200 },
      { name: "Lab",     purpose: "", amount: 300  },
    ];
    // Sum = 2500 but invoice amount = 3000
    expect(() => warnOnSumMismatch(snapshot, 3000, "INV-0001")).not.toThrow();
  });

  it("emits a console warning when sum differs", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = [{ name: "Tuition", purpose: "", amount: 2200 }];
    warnOnSumMismatch(snapshot, 3000, "INV-0042");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("2200"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("3000"));
    warnSpy.mockRestore();
  });

  it("is silent when snapshot is empty (no warning emitted)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnOnSumMismatch([], 3000, "INV-0043");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("is silent when sum matches invoice amount exactly", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = [
      { name: "Tuition", purpose: "", amount: 2200 },
      { name: "Lab",     purpose: "", amount: 800  },
    ];
    warnOnSumMismatch(snapshot, 3000, "INV-0044");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
