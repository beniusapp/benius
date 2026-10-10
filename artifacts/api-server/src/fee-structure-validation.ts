export type FeeBreakdownItem = { name: string; purpose?: string; amount: number };
export type TieredLateFeeSlab = { from_day: number; to_day: number; amount: number };

export function feeBreakdownTotalError(
  amount: number,
  breakdown: readonly FeeBreakdownItem[],
): string | null {
  if (breakdown.length === 0) return null;
  const total = breakdown.reduce((sum, item) => sum + item.amount, 0);
  return total === amount
    ? null
    : `Component total (₹${total}) must match the fee amount (₹${amount}).`;
}

export function tieredSlabsError(slabs: readonly TieredLateFeeSlab[]): string | null {
  const sorted = [...slabs].sort((a, b) => a.from_day - b.from_day || a.to_day - b.to_day);
  for (let index = 0; index < sorted.length; index++) {
    const current = sorted[index];
    if (
      !Number.isInteger(current.from_day)
      || !Number.isInteger(current.to_day)
      || current.from_day < 1
      || current.to_day < 1
    ) {
      return "Tiered late-fee day bounds must be positive integers.";
    }
    if (current.from_day > current.to_day) {
      return "Each tiered late-fee range must start on or before it ends.";
    }
    if (index > 0 && current.from_day <= sorted[index - 1].to_day) {
      return "Tiered late-fee ranges must not overlap.";
    }
  }
  return null;
}
