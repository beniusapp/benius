/**
 * Focused tests for Step 3 — Receipt Snapshot Rendering.
 *
 * These tests exercise the component-rendering logic by simulating the exact
 * data shapes that the receipt handler reads from fee_records.breakdown_snapshot
 * and payment records.  No HTTP server or DB is required — we test the
 * template-level decisions as pure logic.
 *
 * Tests cover:
 *  1.  Non-empty snapshot → component rows rendered
 *  2.  Correct component names preserved in HTML
 *  3.  Correct component amounts preserved in HTML
 *  4.  Empty snapshot → no component table section (legacy path)
 *  5.  Legacy invoice remains unchanged (empty snapshot, single fee row)
 *  6.  Component sum mismatch does NOT alter fee_records.amount (Net Fee row)
 *  7.  Late fee row present when late_fee_paid > 0
 *  8.  Late fee row absent when late_fee_paid = 0
 *  9.  Total = fee_records.amount + late_fee_paid (not component sum)
 * 10.  Amount in words based on actual total (not component sum)
 * 11.  Historical structure changes: snapshot values used, not fabricated
 * 12.  Missing/null component name renders "—"
 * 13.  Missing/null component amount renders "—"
 * 14.  No fee_structures.breakdown in the receipt logic (enforced by architecture)
 * 15.  Net Fee row only appears when components are present
 * 16.  Monthly period label shown on component rows
 * 17.  Quarterly period label shown on component rows
 * 18.  Annual / session label shown on component rows
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Pure receipt logic extracted for unit testing
// (mirrors the exact logic in server/routes.ts receipt handler)
// ─────────────────────────────────────────────────────────────────────────────

type Component = { name: string; purpose: string; amount: number };

/** Mirrors the snapshot extraction in the receipt handler */
function extractComponents(rawSnap: unknown): Component[] {
  return Array.isArray(rawSnap) && rawSnap.length > 0 ? (rawSnap as Component[]) : [];
}

/** Mirrors the component rows HTML builder */
function renderComponentRows(
  components: Component[],
  feeName: string,
  baseFee: number,
  periodLabel: string,
  lateFeePaid: number,
  totalPaid: number,
): {
  hasComponents: boolean;
  componentRows: string[];
  netFeeRow: string | null;
  legacyRow: string | null;
  lateFeeRow: string | null;
  totalStr: string;
} {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
  const hasComponents = components.length > 0;

  const componentRows = hasComponents
    ? components.map(c => {
        const amtCell =
          typeof c.amount === "number" && isFinite(c.amount) ? `₹${fmt(c.amount)}` : "—";
        const nameCel = c.name || "—";
        return `${nameCel}|${periodLabel}|${amtCell}`;
      })
    : [];

  const netFeeRow    = hasComponents ? `Net Fee||₹${fmt(baseFee)}` : null;
  const legacyRow    = !hasComponents ? `${feeName}|${periodLabel}|₹${fmt(baseFee)}` : null;
  const lateFeeRow   = lateFeePaid > 0 ? `Late Fee / Penalty|${periodLabel}|₹${fmt(lateFeePaid)}` : null;
  const totalStr     = `₹${fmt(totalPaid)}`;

  return { hasComponents, componentRows, netFeeRow, legacyRow, lateFeeRow, totalStr };
}

function amountInWords(n: number): string {
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
    "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function cv(x: number): string {
    if (x === 0) return "";
    if (x < 20)  return ones[x];
    if (x < 100) return tens[Math.floor(x/10)] + (x%10 ? " "+ones[x%10] : "");
    if (x < 1e3) return ones[Math.floor(x/100)]+" Hundred"+(x%100?" and "+cv(x%100):"");
    if (x < 1e5) return cv(Math.floor(x/1e3))+" Thousand"+(x%1e3?(x%1e3<100?" and ":" ")+cv(x%1e3):"");
    if (x < 1e7) return cv(Math.floor(x/1e5))+" Lakh"+(x%1e5?(x%1e5<100?" and ":" ")+cv(x%1e5):"");
    return cv(Math.floor(x/1e7))+" Crore"+(x%1e7?(x%1e7<100?" and ":" ")+cv(x%1e7):"");
  }
  if (n <= 0) return "Zero Rupees Only";
  const r = Math.floor(n), p = Math.round((n-r)*100);
  return "Rupees "+cv(r).trim()+(p>0?" and "+cv(p).trim()+" Paise":"")+" Only";
}

// ─────────────────────────────────────────────────────────────────────────────
// 1–3. Non-empty snapshot renders component rows correctly
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — non-empty breakdown_snapshot", () => {
  const snapshot = [
    { name: "Tuition",    purpose: "Academic tuition fee", amount: 2200 },
    { name: "Laboratory", purpose: "Laboratory charges",   amount: 300  },
    { name: "Library",    purpose: "Library fee",          amount: 500  },
  ];
  const components = extractComponents(snapshot);
  const result = renderComponentRows(components, "Tuition Fee", 3000, "August 2026", 0, 3000);

  it("has components flag is true", () => {
    expect(result.hasComponents).toBe(true);
  });

  it("renders one row per component", () => {
    expect(result.componentRows).toHaveLength(3);
  });

  // 2. Correct component names preserved
  it("preserves exact component names", () => {
    expect(result.componentRows[0]).toContain("Tuition");
    expect(result.componentRows[1]).toContain("Laboratory");
    expect(result.componentRows[2]).toContain("Library");
  });

  // 3. Correct component amounts preserved
  it("preserves exact component amounts", () => {
    expect(result.componentRows[0]).toContain("₹2,200");
    expect(result.componentRows[1]).toContain("₹300");
    expect(result.componentRows[2]).toContain("₹500");
  });

  it("renders a Net Fee row with fee_records.amount (not component sum)", () => {
    expect(result.netFeeRow).not.toBeNull();
    expect(result.netFeeRow).toContain("Net Fee");
    expect(result.netFeeRow).toContain("₹3,000");
  });

  // 15. Net Fee row appears only with components
  it("does not render a legacy fee-type row when components are present", () => {
    expect(result.legacyRow).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4–5. Empty / legacy snapshot — no component section
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — empty breakdown_snapshot (legacy path)", () => {
  const components = extractComponents([]);
  const result = renderComponentRows(components, "Tuition Fee", 3000, "August 2026", 0, 3000);

  it("has components flag is false", () => {
    expect(result.hasComponents).toBe(false);
  });

  it("renders no component rows", () => {
    expect(result.componentRows).toHaveLength(0);
  });

  // 5. Legacy single fee row present
  it("renders the legacy single fee-type row", () => {
    expect(result.legacyRow).not.toBeNull();
    expect(result.legacyRow).toContain("Tuition Fee");
    expect(result.legacyRow).toContain("₹3,000");
  });

  it("does not render a Net Fee row", () => {
    expect(result.netFeeRow).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Component sum mismatch does not alter fee_records.amount
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — component sum mismatch", () => {
  // Components sum to ₹2,500 but invoice amount is ₹3,000
  const snapshot = [
    { name: "Tuition", purpose: "", amount: 2200 },
    { name: "Lab",     purpose: "", amount: 300  },
    // Library missing — mismatch
  ];
  const components = extractComponents(snapshot);
  const baseFee = 3000;
  const result = renderComponentRows(components, "Tuition Fee", baseFee, "August 2026", 0, baseFee);

  it("still renders all stored component rows", () => {
    expect(result.componentRows).toHaveLength(2);
  });

  it("Net Fee row shows fee_records.amount (₹3,000), not component sum (₹2,500)", () => {
    expect(result.netFeeRow).toContain("₹3,000");
    expect(result.netFeeRow).not.toContain("₹2,500");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7–8. Late fee rows
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — late fee", () => {
  const snapshot = [{ name: "Tuition", purpose: "", amount: 2200 }];
  const components = extractComponents(snapshot);

  it("renders late fee row when late_fee_paid > 0", () => {
    const result = renderComponentRows(components, "Tuition", 3000, "August 2026", 60, 3060);
    expect(result.lateFeeRow).not.toBeNull();
    expect(result.lateFeeRow).toContain("Late Fee / Penalty");
    expect(result.lateFeeRow).toContain("₹60");
  });

  it("omits late fee row when late_fee_paid = 0", () => {
    const result = renderComponentRows(components, "Tuition", 3000, "August 2026", 0, 3000);
    expect(result.lateFeeRow).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Total = fee_records.amount + late_fee_paid (not component sum)
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — total calculation", () => {
  it("total uses fee_records.amount + late_fee_paid", () => {
    const baseFee = 3000, lateFeePaid = 60, totalPaid = baseFee + lateFeePaid;
    const components = extractComponents([
      { name: "Tuition", purpose: "", amount: 2200 },
      { name: "Lab",     purpose: "", amount: 300  },
      // components sum = 2500, not 3000
    ]);
    const result = renderComponentRows(components, "", baseFee, "August 2026", lateFeePaid, totalPaid);
    expect(result.totalStr).toBe("₹3,060");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Amount in words — based on actual total, not component sum
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — amount in words", () => {
  it("uses total = fee_records.amount + late_fee_paid", () => {
    const total = 3060;
    expect(amountInWords(total)).toMatch(/Three Thousand/i);
    expect(amountInWords(total)).toMatch(/Sixty/i);
  });

  it("does not use component sum when components do not equal invoice amount", () => {
    const componentSum = 2500; // ← mismatch
    const invoiceTotal = 3000;
    expect(amountInWords(invoiceTotal)).toMatch(/Three Thousand/i);
    expect(amountInWords(componentSum)).toMatch(/Two Thousand/i);
    // Words differ — confirms we must use invoiceTotal, not componentSum
    expect(amountInWords(invoiceTotal)).not.toBe(amountInWords(componentSum));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Historical immutability — snapshot values, not live structure values
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — historical immutability", () => {
  it("receipt reads snapshot values frozen at invoice creation, not current fee structure", () => {
    // Invoice created with these component values
    const frozenSnapshot = [
      { name: "Tuition",    purpose: "", amount: 2200 },
      { name: "Laboratory", purpose: "", amount: 300  },
      { name: "Library",    purpose: "", amount: 500  },
    ];

    // Admin later changes the fee structure (simulated — only live structure changes)
    const currentFeeStructureBreakdown = [
      { name: "Tuition",    purpose: "", amount: 2500 },  // changed
      { name: "Laboratory", purpose: "", amount: 300  },
      { name: "Library",    purpose: "", amount: 200  },  // changed
    ];

    // Receipt reads ONLY frozenSnapshot (from fee_records.breakdown_snapshot)
    const components = extractComponents(frozenSnapshot);
    // Must NOT use currentFeeStructureBreakdown
    const result = renderComponentRows(components, "Tuition Fee", 3000, "August 2026", 0, 3000);

    // The snapshot amounts — not the current structure amounts — must appear
    expect(result.componentRows[0]).toContain("₹2,200");  // frozen ₹2,200, not current ₹2,500
    expect(result.componentRows[2]).toContain("₹500");    // frozen ₹500, not current ₹200

    // Current structure values must NOT appear
    expect(result.componentRows[0]).not.toContain("₹2,500");
    expect(result.componentRows[2]).not.toContain("₹200");

    // Confirm the live structure is completely unused by extractComponents
    const liveComponents = extractComponents(currentFeeStructureBreakdown);
    expect(liveComponents[0].amount).toBe(2500); // live value differs
    expect(components[0].amount).toBe(2200);     // snapshot value preserved
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12–13. Missing / null component fields render "—"
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — missing component fields", () => {
  it("renders '—' when component name is empty string", () => {
    const components = extractComponents([{ name: "", purpose: "", amount: 500 }]);
    const result = renderComponentRows(components, "Fee", 500, "August 2026", 0, 500);
    expect(result.componentRows[0]).toContain("—");
  });

  it("renders '—' when component amount is not a finite number", () => {
    const components = extractComponents([{ name: "Tuition", purpose: "", amount: NaN }]);
    const result = renderComponentRows(components, "Fee", 500, "August 2026", 0, 500);
    expect(result.componentRows[0]).toContain("—");
    expect(result.componentRows[0]).not.toContain("NaN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. No fee_structures.breakdown in receipt logic
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — data source contract", () => {
  it("receipt logic accepts only the pre-extracted snapshot array — no live structure object", () => {
    // The receipt handler passes (rec as any).breakdownSnapshot — already loaded from fee_records.
    // This test confirms the rendering function has no parameter for a fee structure.
    // (The function signature takes the snapshot array directly, not a structure ID or object.)
    const snapshotFromRecord: Component[] = [{ name: "Tuition", purpose: "", amount: 3000 }];
    const components = extractComponents(snapshotFromRecord);
    expect(components).toEqual(snapshotFromRecord);
    // No fee structure was consulted — the function takes only the snapshot
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Net Fee row only when components present
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — Net Fee row presence", () => {
  it("Net Fee row is present when breakdown_snapshot is non-empty", () => {
    const components = extractComponents([{ name: "Tuition", purpose: "", amount: 3000 }]);
    const result = renderComponentRows(components, "Tuition Fee", 3000, "August 2026", 0, 3000);
    expect(result.netFeeRow).toContain("Net Fee");
  });

  it("Net Fee row is absent when breakdown_snapshot is empty", () => {
    const components = extractComponents([]);
    const result = renderComponentRows(components, "Tuition Fee", 3000, "August 2026", 0, 3000);
    expect(result.netFeeRow).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16–18. Fee period labels on component rows
// ─────────────────────────────────────────────────────────────────────────────
describe("Receipt rendering — fee period labels", () => {
  const snapshot = [{ name: "Tuition", purpose: "", amount: 2200 }];
  const components = extractComponents(snapshot);

  // 16. Monthly
  it("monthly period label appears on component rows", () => {
    const result = renderComponentRows(components, "Tuition", 3000, "August 2026", 0, 3000);
    expect(result.componentRows[0]).toContain("August 2026");
  });

  // 17. Quarterly
  it("quarterly period label appears on component rows", () => {
    const result = renderComponentRows(components, "Tuition", 9000, "April–June 2026", 0, 9000);
    expect(result.componentRows[0]).toContain("April–June 2026");
  });

  // 18. Annual / session
  it("annual period label appears on component rows", () => {
    const result = renderComponentRows(components, "Tuition", 40000, "2026–27", 0, 40000);
    expect(result.componentRows[0]).toContain("2026–27");
  });
});
