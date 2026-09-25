const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

const INDIAN_GROUPS: Array<[number, string]> = [
  [1e11, "Kharab"],
  [1e9, "Arab"],
  [1e7, "Crore"],
  [1e5, "Lakh"],
  [1e3, "Thousand"],
];

export function amountToPaise(amount: number): number | null {
  if (!Number.isFinite(amount)) return null;

  const sign = amount < 0 ? -1 : 1;
  const decimal = Math.abs(amount).toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: 20,
  });
  const [wholePart, fractionPart = ""] = decimal.split(".");
  const rupees = Number(wholePart);
  if (!Number.isSafeInteger(rupees)) return null;

  const firstTwoPaiseDigits = fractionPart.slice(0, 2).padEnd(2, "0");
  let paise = Number(firstTwoPaiseDigits);
  if (Number(fractionPart.charAt(2) || "0") >= 5) paise += 1;

  return sign * (rupees * 100 + paise);
}

export function formatIndianRupees(amount: number): string {
  const totalPaise = amountToPaise(amount);
  if (totalPaise === null) return "—";

  const normalized = totalPaise / 100;
  const hasPaise = Math.abs(totalPaise) % 100 !== 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(normalized);
}

function underThousand(value: number): string {
  const words: string[] = [];
  if (value >= 100) {
    words.push(`${ONES[Math.floor(value / 100)]} Hundred`);
    value %= 100;
  }
  if (value >= 20) {
    words.push(TENS[Math.floor(value / 10)]);
    if (value % 10 > 0) words.push(ONES[value % 10]);
  } else if (value > 0) {
    words.push(ONES[value]);
  }
  return words.join(" ");
}

function indianIntegerWords(value: number): string {
  if (value === 0) return ONES[0];

  for (const [divisor, label] of INDIAN_GROUPS) {
    if (value >= divisor) {
      const leading = indianIntegerWords(Math.floor(value / divisor));
      const remainder = value % divisor;
      return `${leading} ${label}${remainder > 0 ? ` ${indianIntegerWords(remainder)}` : ""}`;
    }
  }

  return underThousand(value);
}

/**
 * Formats a numeric amount using Indian numbering terminology.
 * The amount is rounded to paise before splitting into rupees and paise so
 * the words always correspond to the displayed numeric amount.
 */
export function amountInWords(amount: number): string {
  const totalPaise = amountToPaise(amount);
  if (totalPaise === null) return "Amount unavailable";

  const absolutePaise = Math.abs(totalPaise);
  const rupees = Math.floor(absolutePaise / 100);
  const paise = absolutePaise % 100;
  const prefix = totalPaise < 0 ? "Minus " : "";
  const paiseWords = paise > 0 ? ` and ${indianIntegerWords(paise)} Paise` : "";

  return `${prefix}${indianIntegerWords(rupees)} Rupees${paiseWords} Only`;
}