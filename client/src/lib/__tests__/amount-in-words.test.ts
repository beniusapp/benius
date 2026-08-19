import { describe, expect, it } from "vitest";
import { amountInWords, formatIndianRupees } from "../amount-in-words";

describe("amountInWords", () => {
  it("formats zero and whole rupee amounts", () => {
    expect(amountInWords(0)).toBe("Zero Rupees Only");
    expect(amountInWords(500)).toBe("Five Hundred Rupees Only");
    expect(amountInWords(1000)).toBe("One Thousand Rupees Only");
  });

  it("uses Indian lakh and crore grouping", () => {
    expect(amountInWords(1250)).toBe("One Thousand Two Hundred Fifty Rupees Only");
    expect(amountInWords(100000)).toBe("One Lakh Rupees Only");
    expect(amountInWords(12500000)).toBe("One Crore Twenty Five Lakh Rupees Only");
  });

  it("includes paise when the invoice amount has a fractional rupee", () => {
    expect(amountInWords(1250.5)).toBe("One Thousand Two Hundred Fifty Rupees and Fifty Paise Only");
    expect(amountInWords(0.75)).toBe("Zero Rupees and Seventy Five Paise Only");
  });

  it("rounds to the same two-decimal precision used for currency", () => {
    expect(amountInWords(99.999)).toBe("One Hundred Rupees Only");
    expect(formatIndianRupees(99.999)).toBe("₹100");
    expect(amountInWords(1.005)).toBe("One Rupees and One Paise Only");
    expect(formatIndianRupees(1.005)).toBe("₹1.01");
    expect(amountInWords(10.075)).toBe("Ten Rupees and Eight Paise Only");
    expect(formatIndianRupees(10.075)).toBe("₹10.08");
    expect(amountInWords(-10.075)).toBe("Minus Ten Rupees and Eight Paise Only");
    expect(formatIndianRupees(-10.075)).toBe("-₹10.08");
    expect(amountInWords(100000.005)).toBe("One Lakh Rupees and One Paise Only");
    expect(formatIndianRupees(100000.005)).toBe("₹1,00,000.01");
  });

  it("uses the same normalized paise value in the document number and words", () => {
    expect(formatIndianRupees(1250.5)).toBe("₹1,250.50");
    expect(amountInWords(1250.5)).toBe("One Thousand Two Hundred Fifty Rupees and Fifty Paise Only");
  });

  it("handles negative and invalid values without fabricating a number", () => {
    expect(amountInWords(-500)).toBe("Minus Five Hundred Rupees Only");
    expect(amountInWords(Number.NaN)).toBe("Amount unavailable");
  });
});