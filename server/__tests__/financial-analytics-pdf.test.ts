/**
 * Renderer tests for renderFinancialAnalyticsPdf.
 *
 * Coverage:
 *  A. Every section renders without exception and produces a valid PDF buffer
 *     (starts with %PDF).
 *  B. Edge-case data: empty trend, empty classWise, empty feeCategories,
 *     zero cash, null comparison.
 *  C. complete > summary in bytes.
 *  D. Pagination regression: very long DB-backed labels (class names, fee
 *     category names, payment method names, status strings) and enough rows
 *     to force page breaks — complete section must produce multiple pages and
 *     all individual sections must render without exception.
 *  E. Page count is verified via the PDF object model (/Type /Page occurrences),
 *     not brittle text extraction.
 *
 * No DB, no HTTP, no brittle text extraction.
 */

import { describe, it, expect } from "vitest";
import { renderFinancialAnalyticsPdf, ReportSection } from "../financial-analytics-pdf";
import type { FinancialAnalyticsResult } from "../financial-analytics-data";

// ── Page count helper ─────────────────────────────────────────────────────────
// PDFKit writes '/Type /Page\n' (or with spaces) for each page object and
// '/Type /Pages\n' for the page tree root — so matching /Type /Page[^s] gives
// an exact count of real pages in any conformant PDF.
function countPdfPages(buf: Buffer): number {
  // Use latin1 so every byte is preserved as a single character.
  const str = buf.toString("latin1");
  const re  = /\/Type\s*\/Page[^s]/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) count++;
  return count;
}

// ── Representative canonical data ─────────────────────────────────────────────

const BASE_DATA: FinancialAnalyticsResult = {
  generatedAt: "2025-01-15T10:30:00.000Z",
  sessionInfo: {
    id: 1,
    sessionName: "2024-2025",
    startDate: "2024-04-01",
    endDate:   "2025-03-31",
  },
  filter: {
    preset:     "this_month",
    startDate:  "2025-01-01",
    endDate:    "2025-01-31",
    label:      "January 2025",
    timezone:   "Asia/Kolkata",
    comparison: null,
  },
  summary: {
    billed:               1250000,
    grossCollected:        980000,
    refunds:                15000,
    netCollected:          965000,
    outstanding:           270000,
    collectionEfficiency:    78.4,
    onlineCollected:       620000,
    offlineCollected:      360000,
    overdueAmount:         120000,
    transactionCount:         142,
    totalLatePenalties:      8500,
  },
  comparison: {
    billed:                1180000,
    grossCollected:         920000,
    refunds:                 12000,
    netCollected:           908000,
    billedChange:              5.93,
    grossCollectedChange:      6.52,
    netCollectedChange:        6.28,
    refundsChange:            25.0,
  },
  trend: [
    { key: "2024-10", label: "Oct '24", startDate: "2024-10-01", billed: 400000, grossCollected: 310000, refunds: 5000,  netCollected: 305000 },
    { key: "2024-11", label: "Nov '24", startDate: "2024-11-01", billed: 420000, grossCollected: 330000, refunds: 6000,  netCollected: 324000 },
    { key: "2024-12", label: "Dec '24", startDate: "2024-12-01", billed: 430000, grossCollected: 340000, refunds: 7000,  netCollected: 333000 },
    { key: "2025-01", label: "Jan '25", startDate: "2025-01-01", billed: 1250000, grossCollected: 980000, refunds: 15000, netCollected: 965000 },
  ],
  online: {
    grossCollected:  620000,
    refunds:          10000,
    netCollected:    610000,
    transactionCount:    89,
    averageTransaction: 6966,
    statuses: [
      { status: "captured", count: 85, amount: 610000 },
      { status: "refunded", count:  4, amount:  10000 },
    ],
    methods: [
      { method: "Razorpay UPI",  count: 52, amount: 380000 },
      { method: "Net Banking",   count: 20, amount: 160000 },
      { method: "Card",          count: 17, amount:  80000 },
    ],
  },
  offline: {
    grossCollected:  360000,
    refunds:           5000,
    netCollected:    355000,
    transactionCount:    53,
    averageTransaction: 6792,
    statuses: [
      { status: "Paid",   count: 50, amount: 355000 },
      { status: "Refund", count:  3, amount:   5000 },
    ],
    methods: [
      { method: "Cash",   count: 35, amount: 240000 },
      { method: "Cheque", count: 18, amount: 120000 },
    ],
  },
  classWise: [
    { class: "1",  billed:  80000, grossCollected:  65000, refunds:    0, netCollected:  65000, outstanding: 15000 },
    { class: "2",  billed:  85000, grossCollected:  70000, refunds: 1000, netCollected:  69000, outstanding: 15000 },
    { class: "5",  billed: 120000, grossCollected:  95000, refunds: 2000, netCollected:  93000, outstanding: 25000 },
    { class: "10", billed: 200000, grossCollected: 160000, refunds: 5000, netCollected: 155000, outstanding: 40000 },
  ],
  feeCategories: [
    { feeType: "Tuition Fee",   billed: 800000, grossCollected: 630000, refunds: 10000, netCollected: 620000, outstanding: 170000 },
    { feeType: "Transport Fee", billed: 180000, grossCollected: 140000, refunds:  2000, netCollected: 138000, outstanding:  40000 },
    { feeType: "Activity Fee",  billed: 120000, grossCollected:  95000, refunds:  1000, netCollected:  94000, outstanding:  25000 },
    { feeType: "Library Fee",   billed:  60000, grossCollected:  50000, refunds:   500, netCollected:  49500, outstanding:  10000 },
    { feeType: "Exam Fee",      billed:  90000, grossCollected:  65000, refunds:  1500, netCollected:  63500, outstanding:  25000 },
  ],
  aging: [
    { bucket: "1-30",  count: 28, amount: 85000 },
    { bucket: "31-60", count: 15, amount: 62000 },
    { bucket: "61-90", count:  8, amount: 43000 },
    { bucket: "90+",   count:  5, amount: 30000 },
  ],
  cashDenominations: {
    cashCollected:        240000,
    cashPaymentCount:         35,
    withBreakdownCount:       28,
    withoutBreakdownCount:     7,
    documentedAmount:     215000,
    denominations: [
      { denomination: 2000, quantity:  42, total:  84000 },
      { denomination:  500, quantity: 185, total:  92500 },
      { denomination:  200, quantity:  60, total:  12000 },
      { denomination:  100, quantity: 265, total:  26500 },
    ],
  },
};

const SCHOOL = { name: "Sunrise International School" };

// ── Stress data: long labels + enough rows to force page breaks ───────────────
//
// This dataset is specifically designed to trigger the pagination defect that
// existed in the fixed-height (18 px) implementation:
//
//  • classWise: 40 rows with very long class/section names that wrap in the
//    narrow first column — e.g. "LKG - Lower Kindergarten Morning Batch A"
//  • feeCategories: 30 rows with long fee-type strings
//  • online.methods: long payment-method names that wrap in the method column
//  • online.statuses: long status strings
//  • offline.methods / offline.statuses: same treatment
//
// With the old fixed-height rows all of these would silently bleed text out of
// their row backgrounds and eventually into the footer.  With the fix every row
// is pre-measured so the background, text, and page-break decision all agree.

function makeStressData(): FinancialAnalyticsResult {
  // 40 class rows with long names
  const classWise = Array.from({ length: 40 }, (_, i) => ({
    class: `Class ${i + 1} - Long Section Name for Testing Row Height (Batch ${String.fromCharCode(65 + (i % 6))})`,
    billed:          (i + 1) * 50000,
    grossCollected:  (i + 1) * 42000,
    refunds:         (i + 1) * 500,
    netCollected:    (i + 1) * 41500,
    outstanding:     (i + 1) * 8500,
  }));

  // 30 fee category rows with long names
  const feeCategories = Array.from({ length: 30 }, (_, i) => ({
    feeType: `Annual Development and Infrastructure Maintenance Levy — Category ${i + 1}`,
    billed:         (i + 1) * 30000,
    grossCollected: (i + 1) * 25000,
    refunds:        (i + 1) * 300,
    netCollected:   (i + 1) * 24700,
    outstanding:    (i + 1) * 5000,
  }));

  // 20 trend rows so trend table also crosses pages
  const trend = Array.from({ length: 20 }, (_, i) => ({
    key:           `2023-${String(i + 1).padStart(2, "0")}`,
    label:         `Month ${i + 1} of Academic Session 2023-2024 (Long Label)`,
    startDate:     `2023-${String(i + 1).padStart(2, "0")}-01`,
    billed:        (i + 1) * 100000,
    grossCollected:(i + 1) * 85000,
    refunds:       (i + 1) * 1000,
    netCollected:  (i + 1) * 84000,
  }));

  // Long payment method and status strings
  const onlineMethods = Array.from({ length: 12 }, (_, i) => ({
    method: `Razorpay Online Portal Payment via ${["UPI", "Net Banking", "Credit Card", "Debit Card", "EMI", "Wallet", "NEFT", "RTGS", "IMPS", "QR Code", "Link", "International"][i]}`,
    count:  10 + i,
    amount: (10 + i) * 5000,
  }));

  const onlineStatuses = [
    { status: "Payment Captured and Settled Successfully by Gateway", count: 200, amount: 1000000 },
    { status: "Partially Refunded — Refund Initiated and Pending Settlement", count: 12, amount: 60000 },
    { status: "Failed — Insufficient Funds or Network Timeout at Acquiring Bank", count: 5, amount: 0 },
    { status: "Authorized but not Captured — Order Expired", count: 3, amount: 0 },
  ];

  const offlineMethods = Array.from({ length: 8 }, (_, i) => ({
    method: `${["Cash at Counter", "Demand Draft drawn on SBI", "Account Transfer via NEFT", "Crossed Cheque (Outstation)", "Pay Order from Co-operative Bank", "RTGS Wire Transfer", "Mobile Banking Transfer", "Direct Debit Mandate"][i]}`,
    count:  5 + i,
    amount: (5 + i) * 8000,
  }));

  const offlineStatuses = [
    { status: "Verified and Recorded — Cleared by Finance Department", count: 150, amount: 900000 },
    { status: "Pending Clearance — Cheque Under Process at Bank", count: 18, amount: 108000 },
    { status: "Bounced — Insufficient Funds in Student Account", count: 4, amount: 0 },
  ];

  return {
    ...BASE_DATA,
    trend,
    classWise,
    feeCategories,
    online: {
      ...BASE_DATA.online,
      methods:  onlineMethods,
      statuses: onlineStatuses,
    },
    offline: {
      ...BASE_DATA.offline,
      methods:  offlineMethods,
      statuses: offlineStatuses,
    },
  };
}

const STRESS_DATA  = makeStressData();
const STRESS_SCHOOL = { name: "Dr. Rajendra Prasad Memorial International Academy of Higher Learning" };

// ── Tests ─────────────────────────────────────────────────────────────────────

const ALL_SECTIONS: ReportSection[] = [
  "complete",
  "summary",
  "trend",
  "channels",
  "classes",
  "categories",
  "aging",
  "cash",
];

describe("renderFinancialAnalyticsPdf — basic validity", () => {
  for (const section of ALL_SECTIONS) {
    it(`section="${section}" produces a valid PDF buffer starting with %PDF`, async () => {
      const buf = await renderFinancialAnalyticsPdf({
        data: BASE_DATA,
        school: SCHOOL,
        section,
      });
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(500);
      expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    });
  }

  it("handles empty trend gracefully", async () => {
    const data: FinancialAnalyticsResult = { ...BASE_DATA, trend: [] };
    const buf = await renderFinancialAnalyticsPdf({ data, school: SCHOOL, section: "trend" });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("handles empty classWise gracefully", async () => {
    const data: FinancialAnalyticsResult = { ...BASE_DATA, classWise: [] };
    const buf = await renderFinancialAnalyticsPdf({ data, school: SCHOOL, section: "classes" });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("handles empty feeCategories gracefully", async () => {
    const data: FinancialAnalyticsResult = { ...BASE_DATA, feeCategories: [] };
    const buf = await renderFinancialAnalyticsPdf({ data, school: SCHOOL, section: "categories" });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("handles zero cash collected gracefully", async () => {
    const data: FinancialAnalyticsResult = {
      ...BASE_DATA,
      cashDenominations: {
        cashCollected: 0, cashPaymentCount: 0,
        withBreakdownCount: 0, withoutBreakdownCount: 0,
        documentedAmount: 0, denominations: [],
      },
    };
    const buf = await renderFinancialAnalyticsPdf({ data, school: SCHOOL, section: "cash" });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("handles null comparison in summary", async () => {
    const data: FinancialAnalyticsResult = { ...BASE_DATA, comparison: null };
    const buf = await renderFinancialAnalyticsPdf({ data, school: SCHOOL, section: "summary" });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("complete section produces a larger PDF than single-section", async () => {
    const completeBuf = await renderFinancialAnalyticsPdf({ data: BASE_DATA, school: SCHOOL, section: "complete" });
    const summaryBuf  = await renderFinancialAnalyticsPdf({ data: BASE_DATA, school: SCHOOL, section: "summary" });
    expect(completeBuf.length).toBeGreaterThan(summaryBuf.length);
  });
});

describe("renderFinancialAnalyticsPdf — pagination regression (long labels + many rows)", () => {
  it("all sections render without exception on stress data", async () => {
    for (const section of ALL_SECTIONS) {
      const buf = await renderFinancialAnalyticsPdf({
        data:   STRESS_DATA,
        school: STRESS_SCHOOL,
        section,
      });
      expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    }
  });

  it("complete section with stress data produces multiple pages", async () => {
    const buf = await renderFinancialAnalyticsPdf({
      data:   STRESS_DATA,
      school: STRESS_SCHOOL,
      section: "complete",
    });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    const pages = countPdfPages(buf);
    // 40 class rows + 30 category rows + 20 trend rows + many channel rows
    // must exceed a single A4 portrait page.
    expect(pages).toBeGreaterThan(1);
  });

  it("classes section with 40 long rows produces multiple pages", async () => {
    const buf = await renderFinancialAnalyticsPdf({
      data:   STRESS_DATA,
      school: STRESS_SCHOOL,
      section: "classes",
    });
    const pages = countPdfPages(buf);
    expect(pages).toBeGreaterThan(1);
  });

  it("categories section with 30 long fee-type rows produces multiple pages", async () => {
    const buf = await renderFinancialAnalyticsPdf({
      data:   STRESS_DATA,
      school: STRESS_SCHOOL,
      section: "categories",
    });
    const pages = countPdfPages(buf);
    expect(pages).toBeGreaterThan(1);
  });

  it("trend section with 20 rows renders correctly", async () => {
    const buf = await renderFinancialAnalyticsPdf({
      data:   STRESS_DATA,
      school: STRESS_SCHOOL,
      section: "trend",
    });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    // 20 rows — may or may not paginate depending on row heights, but must not throw
    const pages = countPdfPages(buf);
    expect(pages).toBeGreaterThanOrEqual(1);
  });

  it("channels section with long method and status strings renders correctly", async () => {
    const buf = await renderFinancialAnalyticsPdf({
      data:   STRESS_DATA,
      school: STRESS_SCHOOL,
      section: "channels",
    });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    const pages = countPdfPages(buf);
    expect(pages).toBeGreaterThanOrEqual(1);
  });

  it("page count is stable across two renders of identical stress data", async () => {
    const buf1 = await renderFinancialAnalyticsPdf({ data: STRESS_DATA, school: STRESS_SCHOOL, section: "complete" });
    const buf2 = await renderFinancialAnalyticsPdf({ data: STRESS_DATA, school: STRESS_SCHOOL, section: "complete" });
    expect(countPdfPages(buf1)).toBe(countPdfPages(buf2));
  });
});
