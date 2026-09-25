const NUMERIC_PERCENTAGE = /^-?\d+(?:\.\d+)?$/;
const TWO_DECIMAL_PERCENTAGE = /^-?\d+(?:\.\d{1,2})?$/;
const MAX_PERCENTAGE_HUNDREDTHS = 10_000;

/**
 * Parses an exact percentage without truncating or rounding excess precision.
 * The returned integer hundredths are safe for comparisons and continuity checks.
 */
export function percentageToHundredths(value: string | number, label = "Percentage"): number {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!NUMERIC_PERCENTAGE.test(trimmed)) {
      throw new Error(`${label} must be a finite number.`);
    }
    if (!TWO_DECIMAL_PERCENTAGE.test(trimmed)) {
      throw new Error(`${label} must have at most 2 decimal places.`);
    }
    const numericValue = Number(trimmed);
    if (!Number.isFinite(numericValue)) {
      throw new Error(`${label} must be a finite number.`);
    }
    if (numericValue < 0 || numericValue > 100) {
      throw new Error(`${label} must be between 0.00 and 100.00.`);
    }
    const hundredths = Math.round(numericValue * 100);
    if (!Number.isSafeInteger(hundredths) || hundredths > MAX_PERCENTAGE_HUNDREDTHS) {
      throw new Error(`${label} must be between 0.00 and 100.00.`);
    }
    return hundredths;
  }

  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  if (value < 0 || value > 100) {
    throw new Error(`${label} must be between 0.00 and 100.00.`);
  }
  const scaled = value * 100;
  const hundredths = Math.round(scaled);
  if (Math.abs(scaled - hundredths) > 1e-8) {
    throw new Error(`${label} must have at most 2 decimal places.`);
  }
  return hundredths;
}

export function normalizePercentageToTwoDecimals(value: number, label = "Percentage"): number {
  return percentageToHundredths(value, label) / 100;
}

export function percentageToDatabaseValue(value: number): string {
  return (percentageToHundredths(value) / 100).toFixed(2);
}
