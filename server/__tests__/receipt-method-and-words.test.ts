/**
 * Focused tests for two receipt-display fixes in server/routes.ts:
 *
 *  A) Offline payment-method label mapping
 *     payment_records.payment_method  →  display label on receipt
 *
 *  B) amountInWords() "and" placement for Indian numbering
 *     The function must insert "and" between the last complete denomination
 *     group and any remaining amount below 100, per Indian banking convention.
 *
 * These tests exercise the pure logic extracted from the receipt handler.
 * No HTTP server or DB is needed.
 */

import { describe, it, expect } from "vitest";
import { formatOfflinePaymentMethod } from "../../shared/offline-payment-method";

// ── A: Offline method label mapping ──────────────────────────────────────────
// Mirrors the logic at routes.ts lines 4809-4821 exactly.

function methodDesc(paMethod: string | null | undefined, prMethodRaw: string): string {
  // Gateway methods remain gateway-specific; every known offline record uses
  // the shared receipt/history display contract.
  if (prMethodRaw === "Online" || prMethodRaw === "Portal Payment") return paMethod ?? "Portal Payment";
  return formatOfflinePaymentMethod(prMethodRaw) ?? (prMethodRaw || "—");
}

describe("Offline payment-method label mapping", () => {
  it('Cash → "Offline (Cash)"', () => {
    expect(methodDesc(null, "Cash")).toBe("Offline (Cash)");
  });

  it('Cheque → "Offline (Cheque)"', () => {
    expect(methodDesc(null, "Cheque")).toBe("Offline (Cheque)");
  });

  it('BankTransfer → "Offline (Bank Transfer)"', () => {
    expect(methodDesc(null, "BankTransfer")).toBe("Offline (Bank Transfer)");
  });

  it('DemandDraft → "Offline (Demand Draft)"', () => {
    expect(methodDesc(null, "DemandDraft")).toBe("Offline (Demand Draft)");
  });

  it('UpiQr → "Offline (UPI/QR)"', () => {
    expect(methodDesc(null, "UpiQr")).toBe("Offline (UPI/QR)");
  });

  it("missing pr.payment_method → —", () => {
    expect(methodDesc(null, "")).toBe("—");
    expect(methodDesc(null, undefined as unknown as string)).toBe("—");
  });

  it("Online Razorpay: pa.payment_method takes priority over pr method", () => {
    // pa is not null → online path → use pa method directly (before card/upi enrichment)
    expect(methodDesc("card", "Online")).toBe("card");
    expect(methodDesc("upi", "Online")).toBe("upi");
    expect(methodDesc("netbanking", "Online")).toBe("netbanking");
    expect(methodDesc("wallet", "Online")).toBe("wallet");
  });
});

// ── B: amountInWords() ────────────────────────────────────────────────────────
// Extracted verbatim from server/routes.ts lines 4739-4755 (fixed version).

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

describe("amountInWords — core cases from approved scope", () => {
  it("₹3,060 → Rupees Three Thousand and Sixty Only", () => {
    expect(amountInWords(3060)).toBe("Rupees Three Thousand and Sixty Only");
  });

  it("₹3,560 → Rupees Three Thousand Five Hundred and Sixty Only", () => {
    expect(amountInWords(3560)).toBe("Rupees Three Thousand Five Hundred and Sixty Only");
  });

  it("₹3,500 → Rupees Three Thousand Five Hundred Only (no trailing 'and')", () => {
    expect(amountInWords(3500)).toBe("Rupees Three Thousand Five Hundred Only");
  });

  it("₹3,000 → Rupees Three Thousand Only (no 'and')", () => {
    expect(amountInWords(3000)).toBe("Rupees Three Thousand Only");
  });

  it("₹1,03,060 → Rupees One Lakh Three Thousand and Sixty Only", () => {
    expect(amountInWords(103060)).toBe("Rupees One Lakh Three Thousand and Sixty Only");
  });
});

describe("amountInWords — boundary and regression cases", () => {
  it("₹0 → Zero Rupees Only", () => {
    expect(amountInWords(0)).toBe("Zero Rupees Only");
  });

  it("₹1 → Rupees One Only", () => {
    expect(amountInWords(1)).toBe("Rupees One Only");
  });

  it("₹100 → Rupees One Hundred Only (no 'and')", () => {
    expect(amountInWords(100)).toBe("Rupees One Hundred Only");
  });

  it("₹101 → Rupees One Hundred and One Only", () => {
    expect(amountInWords(101)).toBe("Rupees One Hundred and One Only");
  });

  it("₹1,000 → Rupees One Thousand Only", () => {
    expect(amountInWords(1000)).toBe("Rupees One Thousand Only");
  });

  it("₹1,001 → Rupees One Thousand and One Only", () => {
    expect(amountInWords(1001)).toBe("Rupees One Thousand and One Only");
  });

  it("₹1,100 → Rupees One Thousand One Hundred Only", () => {
    expect(amountInWords(1100)).toBe("Rupees One Thousand One Hundred Only");
  });

  it("₹1,101 → Rupees One Thousand One Hundred and One Only", () => {
    expect(amountInWords(1101)).toBe("Rupees One Thousand One Hundred and One Only");
  });

  it("₹20,000 → Rupees Twenty Thousand Only", () => {
    expect(amountInWords(20000)).toBe("Rupees Twenty Thousand Only");
  });

  it("₹20,060 → Rupees Twenty Thousand and Sixty Only", () => {
    expect(amountInWords(20060)).toBe("Rupees Twenty Thousand and Sixty Only");
  });

  it("₹1,00,000 → Rupees One Lakh Only", () => {
    expect(amountInWords(100000)).toBe("Rupees One Lakh Only");
  });

  it("₹1,00,060 → Rupees One Lakh and Sixty Only", () => {
    expect(amountInWords(100060)).toBe("Rupees One Lakh and Sixty Only");
  });

  it("₹1,00,560 → Rupees One Lakh Five Hundred and Sixty Only", () => {
    expect(amountInWords(100560)).toBe("Rupees One Lakh Five Hundred and Sixty Only");
  });

  it("₹1,00,500 → Rupees One Lakh Five Hundred Only", () => {
    expect(amountInWords(100500)).toBe("Rupees One Lakh Five Hundred Only");
  });

  it("₹1,00,00,060 → Rupees One Crore and Sixty Only", () => {
    expect(amountInWords(10000060)).toBe("Rupees One Crore and Sixty Only");
  });

  it("paise: ₹3,000.50 → Rupees Three Thousand and Fifty Paise Only", () => {
    expect(amountInWords(3000.50)).toBe("Rupees Three Thousand and Fifty Paise Only");
  });

  it("paise + rupees: ₹3,060.50 → Rupees Three Thousand and Sixty and Fifty Paise Only", () => {
    expect(amountInWords(3060.50)).toBe("Rupees Three Thousand and Sixty and Fifty Paise Only");
  });

  it("existing amount ₹20,000 unchanged (no regression on prior fee records)", () => {
    expect(amountInWords(20000)).toBe("Rupees Twenty Thousand Only");
  });
});
