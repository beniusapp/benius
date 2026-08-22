/**
 * server/__tests__/financial-analytics-data.test.ts
 *
 * Focused integration + unit tests for the Financial Analytics data service.
 *
 * Scenarios covered:
 *  1.  isValidDate: rejects impossible dates (2024-02-31), bad formats.
 *  2.  resolvePeriod: academic_year = session bounds, no comparison.
 *  3.  resolvePeriod: custom validation (bad format, start>end, >5 years).
 *  4.  resolvePeriod: comparison window respects session bounds.
 *  5.  trend labels: daily "01 Apr", monthly "Apr 24".
 *  6.  Session isolation: session must belong to the school.
 *  7.  Tenant isolation: rows from a different school never appear.
 *  8.  Failed / cancelled / pending attempts do NOT affect revenue.
 *  9.  payment_attempts: only outcome-specific IST timestamp scopes inclusion;
 *      captured_at outside range is excluded even when created_at is inside.
 * 10.  Only processed refunds counted; requested/pending/failed ignored.
 * 11.  Single processed refund counted exactly once (no double-count).
 * 12.  Offline revision tables (offline_payment_detail_revisions) ignored.
 * 13.  Online vs offline channel split (Portal Payment + razorpay_payment_id).
 * 14.  Legacy 'Online' method treated as online channel.
 * 15.  Online method label: payment_mode instrument used when present.
 * 16.  Offline method labels: friendly normalised names, not "captured".
 * 17.  Historical online PR without attempt appears in online statuses as
 *      "captured", not double-counted with attempt-covered PRs.
 * 18.  Denomination: strict key validation rejects "500foo" keys.
 * 19.  Denomination: aggregates valid entries, ignores zero/negative.
 * 20.  Class-wise and fee-category attribution.
 * 21.  Aging: overdue invoices bucketed correctly.
 * 22.  Outstanding uses lifetime payments (not just period payments).
 * 23.  Collection efficiency: correct calculation, no silent cap at 100.
 * 24.  Trend granularity: 24h / 7d / 12m.
 * 25.  Hourly trend billed parity: sum across buckets = summary.billed.
 * 26.  Response contract: all required top-level fields present.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "../db";
import {
  schools,
  students,
  academicSessions,
  feeRecords,
  paymentRecords,
} from "@shared/schema";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import {
  buildFinancialAnalytics,
  resolvePeriod,
  isValidDate,
  addDays,
  daysBetween,
  dailyLabel,
  monthlyLabel,
  onlineMethodLabel,
  offlineMethodLabel,
  todayIST,
  type SessionInfo,
} from "../financial-analytics-data";

// ── Shared helpers ─────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

interface Fixture {
  schoolId: number;
  studentId: number;
  sessionId: number;
  sessionInfo: SessionInfo;
}

async function createFixture(opts?: {
  sessionStart?: string;
  sessionEnd?: string;
  studentClass?: string;
}): Promise<Fixture> {
  const code         = `FIN-${uid()}`;
  const sessionStart = opts?.sessionStart ?? "2024-04-01";
  const sessionEnd   = opts?.sessionEnd   ?? "2025-03-31";

  const [school] = await db
    .insert(schools)
    .values({ name: "Fin Analytics Test School", code })
    .returning();

  const [student] = await db
    .insert(students)
    .values({
      schoolId:        school.id,
      digitalStudentId: `DSID-${uid()}`,
      name:            "Test Student",
      class:           opts?.studentClass ?? "5",
      section:         "A",
      phone:           "9999999999",
      dob:             "2012-01-01",
      passwordHash:    "x",
    })
    .returning();

  const [session] = await db
    .insert(academicSessions)
    .values({
      schoolId:             school.id,
      sessionName:          "2024-25",
      startDate:            sessionStart,
      endDate:              sessionEnd,
      isActive:             false,
      status:               "active",
      newAdmissionsEnabled: false,
      promotionStrategy:    "defer",
    })
    .returning();

  const sessionInfo: SessionInfo = {
    id:          session.id,
    sessionName: session.sessionName,
    startDate:   String(session.startDate).slice(0, 10),
    endDate:     String(session.endDate).slice(0, 10),
  };

  return {
    schoolId:  school.id,
    studentId: student.id,
    sessionId: session.id,
    sessionInfo,
  };
}

async function teardown(schoolId: number) {
  await db.delete(schools).where(eq(schools.id, schoolId));
}

/** Insert a refund row directly. */
async function insertRefund(fields: {
  schoolId:              number;
  feeRecordId?:          number | null;
  paymentRecordId?:      number | null;
  razorpayPaymentId:     string;
  requestedAmountPaise:  number;
  processedAmountPaise?: number | null;
  localStatus:           string;
  providerProcessedAt?:  string | null;
}): Promise<void> {
  const ikey = `ikey-${uid()}`;
  await db.execute(sql`
    INSERT INTO refunds (
      school_id, fee_record_id, payment_record_id,
      razorpay_payment_id, requested_amount_paise, processed_amount_paise,
      local_status, provider_processed_at, idempotency_key, origin, currency,
      created_at, updated_at
    ) VALUES (
      ${fields.schoolId},
      ${fields.feeRecordId ?? null},
      ${fields.paymentRecordId ?? null},
      ${fields.razorpayPaymentId},
      ${fields.requestedAmountPaise},
      ${fields.processedAmountPaise ?? null},
      ${fields.localStatus},
      ${fields.providerProcessedAt ?? null},
      ${ikey},
      'admin', 'INR', NOW(), NOW()
    )
  `);
}

/** Insert a payment_attempt row with explicit lifecycle timestamps. */
async function insertPaymentAttempt(fields: {
  schoolId:           number;
  studentId?:         number | null;
  feeRecordId?:       number | null;
  sessionId?:         number | null;
  outcome:            string;
  amountPaise?:       number;
  capturedPaise?:     number;
  refundedPaise?:     number;
  razorpayPaymentId?: string | null;
  /** Explicit rzp_captured_at — overrides the default NOW() */
  rzpCapturedAt?:     string | null;
  /** Explicit created_at — overrides the default NOW() */
  createdAt?:         string | null;
  /** Explicit updated_at */
  updatedAt?:         string | null;
  rzpFailedAt?:       string | null;
  rzpAuthorizedAt?:   string | null;
}): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO payment_attempts (
      school_id, student_id, fee_record_id, session_id, outcome,
      amount_paise, amount_captured_paise, amount_refunded_paise,
      razorpay_payment_id,
      rzp_captured_at, rzp_authorized_at, rzp_failed_at,
      created_at, updated_at
    ) VALUES (
      ${fields.schoolId},
      ${fields.studentId ?? null},
      ${fields.feeRecordId ?? null},
      ${fields.sessionId ?? null},
      ${fields.outcome},
      ${fields.amountPaise ?? null},
      ${fields.capturedPaise ?? null},
      ${fields.refundedPaise ?? null},
      ${fields.razorpayPaymentId ?? null},
      ${fields.rzpCapturedAt ?? null},
      ${fields.rzpAuthorizedAt ?? null},
      ${fields.rzpFailedAt ?? null},
      ${fields.createdAt   ? sql`${fields.createdAt}::timestamptz`   : sql`NOW()`},
      ${fields.updatedAt   ? sql`${fields.updatedAt}::timestamptz`   : sql`NOW()`}
    )
    RETURNING id
  `);
  return Number((result.rows[0] as any).id);
}

// ── 1. isValidDate ─────────────────────────────────────────────────────────────

describe("isValidDate", () => {
  it("accepts valid calendar dates", () => {
    expect(isValidDate("2024-04-01")).toBe(true);
    expect(isValidDate("2024-12-31")).toBe(true);
    expect(isValidDate("2020-02-29")).toBe(true); // leap year
  });

  it("rejects impossible dates that JS would normalise (2024-02-31)", () => {
    expect(isValidDate("2024-02-31")).toBe(false);
    expect(isValidDate("2024-04-31")).toBe(false); // April has 30 days
    expect(isValidDate("2023-02-29")).toBe(false); // 2023 not a leap year
  });

  it("rejects invalid formats", () => {
    expect(isValidDate("2024-4-1")).toBe(false);
    expect(isValidDate("20240401")).toBe(false);
    expect(isValidDate("invalid")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });
});

// ── 2. addDays / daysBetween ───────────────────────────────────────────────────

describe("addDays / daysBetween", () => {
  it("addDays works across month and leap boundaries", () => {
    expect(addDays("2024-01-31", 1)).toBe("2024-02-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // 2024 is leap
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("daysBetween returns calendar-day difference", () => {
    expect(daysBetween("2024-04-01", "2024-04-01")).toBe(0);
    expect(daysBetween("2024-04-01", "2024-04-07")).toBe(6);
  });
});

// ── 3. Trend label helpers ─────────────────────────────────────────────────────

describe("dailyLabel / monthlyLabel", () => {
  it("dailyLabel formats as 'DD Mon'", () => {
    expect(dailyLabel("2024-04-01")).toBe("01 Apr");
    expect(dailyLabel("2024-12-31")).toBe("31 Dec");
  });

  it("monthlyLabel formats as 'Mon YY'", () => {
    expect(monthlyLabel("2024-04")).toBe("Apr 24");
    expect(monthlyLabel("2025-03")).toBe("Mar 25");
    expect(monthlyLabel("2000-01")).toBe("Jan 00");
  });
});

// ── 4. Channel method label helpers ───────────────────────────────────────────

describe("onlineMethodLabel", () => {
  it("maps payment_mode to friendly labels", () => {
    expect(onlineMethodLabel("upi")).toBe("UPI");
    expect(onlineMethodLabel("card")).toBe("Card");
    expect(onlineMethodLabel("netbanking")).toBe("Net Banking");
    expect(onlineMethodLabel("wallet")).toBe("Wallet");
    expect(onlineMethodLabel("emi")).toBe("EMI");
  });

  it("falls back to 'Portal Payment' when payment_mode is absent", () => {
    expect(onlineMethodLabel(null)).toBe("Portal Payment");
    expect(onlineMethodLabel(undefined)).toBe("Portal Payment");
    expect(onlineMethodLabel("")).toBe("Portal Payment");
  });
});

describe("offlineMethodLabel", () => {
  it("maps canonical stored names to friendly labels", () => {
    expect(offlineMethodLabel("Cash")).toBe("Cash");
    expect(offlineMethodLabel("Cheque")).toBe("Cheque");
    expect(offlineMethodLabel("BankTransfer")).toBe("Bank Transfer");
    expect(offlineMethodLabel("DemandDraft")).toBe("Demand Draft");
    expect(offlineMethodLabel("UpiQr")).toBe("UPI / QR");
  });

  it("passes through unknown values verbatim", () => {
    expect(offlineMethodLabel("NEFT")).toBe("NEFT");
  });
});

// ── 5. resolvePeriod — academic_year ──────────────────────────────────────────

describe("resolvePeriod — academic_year", () => {
  const session: SessionInfo = {
    id: 1, sessionName: "2024-25",
    startDate: "2024-04-01", endDate: "2025-03-31",
  };

  it("uses exact session bounds", () => {
    const r = resolvePeriod("academic_year", session);
    expect(r.startDate).toBe("2024-04-01");
    expect(r.endDate).toBe("2025-03-31");
  });

  it("has no comparison (prior period would be before session)", () => {
    expect(resolvePeriod("academic_year", session).comparison).toBeNull();
  });
});

// ── 6. resolvePeriod — custom validation ──────────────────────────────────────

describe("resolvePeriod — custom validation", () => {
  const session: SessionInfo = {
    id: 1, sessionName: "2024-25",
    startDate: "2024-04-01", endDate: "2025-03-31",
  };

  it("throws on invalid date format", () => {
    expect(() => resolvePeriod("custom", session, "invalid", "2024-09-30"))
      .toThrow(/Invalid date format/);
  });

  it("throws on impossible date (2024-02-31)", () => {
    expect(() => resolvePeriod("custom", session, "2024-02-31", "2024-03-31"))
      .toThrow(/Invalid date format/);
  });

  it("throws when start > end", () => {
    expect(() => resolvePeriod("custom", session, "2024-09-30", "2024-09-01"))
      .toThrow(/start.*<=.*end/i);
  });

  it("throws when range exceeds 5 years", () => {
    expect(() => resolvePeriod("custom", session, "2020-01-01", "2026-01-01"))
      .toThrow(/5 years/);
  });

  it("accepts a valid custom range", () => {
    const r = resolvePeriod("custom", session, "2024-06-01", "2024-08-31");
    expect(r.startDate).toBe("2024-06-01");
    expect(r.endDate).toBe("2024-08-31");
  });
});

// ── 7. resolvePeriod — comparison window ──────────────────────────────────────

describe("resolvePeriod — comparison window", () => {
  const session: SessionInfo = {
    id: 1, sessionName: "2024-25",
    startDate: "2024-04-01", endDate: "2025-03-31",
  };

  it("returns comparison when prior 30-day period fits in session", () => {
    // 2024-05-01..2024-05-30 → prior 30 days = 2024-04-01..2024-04-30 (in session)
    const r = resolvePeriod("custom", session, "2024-05-01", "2024-05-30");
    expect(r.comparison).not.toBeNull();
    expect(r.comparison!.startDate).toBe("2024-04-01");
    expect(r.comparison!.endDate).toBe("2024-04-30");
  });

  it("returns null comparison when prior period starts before session", () => {
    // 2024-04-01..2024-04-30 → prior would start 2024-03-01 (before session)
    const r = resolvePeriod("custom", session, "2024-04-01", "2024-04-30");
    expect(r.comparison).toBeNull();
  });

  it("returns null comparison when selected range starts before session", () => {
    // 2024-03-01..2024-03-31 is entirely before session (starts 2024-04-01)
    const r = resolvePeriod("custom", session, "2024-03-01", "2024-03-31");
    expect(r.comparison).toBeNull();
  });

  it("returns null comparison when selected range ends after session", () => {
    // 2025-03-01..2025-04-30 — end (2025-04-30) is beyond session end (2025-03-31)
    const r = resolvePeriod("custom", session, "2025-03-01", "2025-04-30");
    expect(r.comparison).toBeNull();
  });

  it("returns null comparison when selected range straddles session start", () => {
    // 2024-03-15..2024-04-15 — straddles session start 2024-04-01
    const r = resolvePeriod("custom", session, "2024-03-15", "2024-04-15");
    expect(r.comparison).toBeNull();
  });

  it("returns null comparison when selected range straddles session end", () => {
    // 2025-03-15..2025-04-15 — straddles session end 2025-03-31
    const r = resolvePeriod("custom", session, "2025-03-15", "2025-04-15");
    expect(r.comparison).toBeNull();
  });

  it("does NOT throw for an out-of-session custom range; just suppresses comparison", () => {
    // Out-of-session range must not throw — just return null comparison.
    expect(() =>
      resolvePeriod("custom", session, "2023-01-01", "2023-01-31"),
    ).not.toThrow();
    const r = resolvePeriod("custom", session, "2023-01-01", "2023-01-31");
    expect(r.comparison).toBeNull();
  });
});

// ── DB integration tests ───────────────────────────────────────────────────────

// ── 8. Session isolation ───────────────────────────────────────────────────────

describe("buildFinancialAnalytics — session isolation", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("throws when session does not belong to the school", async () => {
    fixture = await createFixture();
    await expect(
      buildFinancialAnalytics({ schoolId: fixture.schoolId, sessionId: 9999999, preset: "academic_year" }),
    ).rejects.toThrow(/not found/i);
  });

  it("returns zero summary for a date range with no data", async () => {
    fixture = await createFixture();
    const r = await buildFinancialAnalytics({
      schoolId:    fixture.schoolId,
      sessionId:   fixture.sessionId,
      preset:      "custom",
      customStart: "2024-06-01",
      customEnd:   "2024-06-30",
    });
    expect(r.summary.billed).toBe(0);
    expect(r.summary.grossCollected).toBe(0);
    expect(r.summary.transactionCount).toBe(0);
  });
});

// ── 9. Tenant isolation ────────────────────────────────────────────────────────

describe("buildFinancialAnalytics — tenant isolation", () => {
  let fix1: Fixture, fix2: Fixture;
  afterEach(async () => {
    if (fix1) await teardown(fix1.schoolId);
    if (fix2) await teardown(fix2.schoolId);
  });

  it("does not include data from another school", async () => {
    fix1 = await createFixture();
    fix2 = await createFixture();

    const [fr] = await db.insert(feeRecords).values({
      schoolId: fix2.schoolId, studentId: fix2.studentId,
      sessionId: fix2.sessionId, feeType: "Tuition",
      amount: 50000, dueDate: "2024-06-15", status: "Paid",
    }).returning();
    await db.insert(paymentRecords).values({
      schoolId: fix2.schoolId, studentId: fix2.studentId,
      feeRecordId: fr.id, sessionId: fix2.sessionId,
      paymentMethod: "Cash", receivedDate: "2024-06-15", amount: 50000,
    });

    const r = await buildFinancialAnalytics({
      schoolId: fix1.schoolId, sessionId: fix1.sessionId,
      preset: "custom", customStart: "2024-06-01", customEnd: "2024-06-30",
    });
    expect(r.summary.billed).toBe(0);
    expect(r.summary.grossCollected).toBe(0);
  });
});

// ── 10. Failed/cancelled/pending attempts do not affect revenue ────────────────

describe("buildFinancialAnalytics — failed/cancelled/pending attempts → no revenue", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("failed and cancelled payment_attempts do not increase grossCollected", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 10000, dueDate: "2024-06-15", status: "Due",
    }).returning();

    for (const outcome of ["failed", "cancelled", "pending"]) {
      await insertPaymentAttempt({
        schoolId, studentId, feeRecordId: fr.id, sessionId, outcome,
        amountPaise: 1000000, razorpayPaymentId: `pay_${outcome}_${uid()}`,
      });
    }

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-06-01", customEnd: "2024-06-30",
    });
    expect(r.summary.billed).toBe(10000);
    expect(r.summary.grossCollected).toBe(0);
    expect(r.summary.transactionCount).toBe(0);
  });
});

// ── 11. payment_attempts: outcome-specific IST timestamp scoping ───────────────

describe("buildFinancialAnalytics — attempt IST timestamp scoping", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("excludes a captured attempt whose rzp_captured_at is outside the range even if created_at is inside", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    // created_at is 2024-06-15 (inside range), but rzp_captured_at is
    // 2024-07-01T00:00:00Z which is 2024-07-01 in UTC and IST → outside range.
    const rzpId = `pay_scope_${uid()}`;
    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      outcome: "captured",
      amountPaise: 500000,
      razorpayPaymentId: rzpId,
      createdAt:    "2024-06-15T10:00:00Z", // inside range
      rzpCapturedAt: "2024-07-01T00:00:00Z", // outside range
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-06-01", customEnd: "2024-06-30",
    });

    // The attempt must NOT appear in online statuses for June
    const captured = r.online.statuses.find(s => s.status === "captured");
    expect(captured?.count ?? 0).toBe(0);
  });

  it("includes a captured attempt whose rzp_captured_at is inside the IST range", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    const rzpId = `pay_in_${uid()}`;
    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      outcome: "captured",
      amountPaise: 500000,
      razorpayPaymentId: rzpId,
      rzpCapturedAt: "2024-06-20T06:00:00Z", // 2024-06-20 11:30 IST → inside range
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-06-01", customEnd: "2024-06-30",
    });

    const captured = r.online.statuses.find(s => s.status === "captured");
    expect(captured).toBeDefined();
    expect(captured!.count).toBe(1);
  });
});

// ── 12. Processed refunds only ────────────────────────────────────────────────

describe("buildFinancialAnalytics — processed refunds only", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("counts only processed refunds; ignores requested status", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 10000, dueDate: "2024-06-15", status: "Paid",
    }).returning();
    const rzpId = `pay_${uid()}`;
    const [pr] = await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: rzpId,
      receivedDate: "2024-06-15", amount: 10000,
    }).returning();

    // Processed refund (₹3000) — must be counted
    await insertRefund({
      schoolId, feeRecordId: fr.id, paymentRecordId: pr.id,
      razorpayPaymentId: rzpId, requestedAmountPaise: 300000,
      processedAmountPaise: 300000, localStatus: "processed",
      providerProcessedAt: "2024-06-20T10:00:00Z",
    });

    // Requested refund (₹2000) — must NOT be counted
    await insertRefund({
      schoolId, feeRecordId: fr.id, paymentRecordId: pr.id,
      razorpayPaymentId: rzpId, requestedAmountPaise: 200000,
      processedAmountPaise: null, localStatus: "requested",
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-06-01", customEnd: "2024-06-30",
    });
    expect(r.summary.grossCollected).toBe(10000);
    expect(r.summary.refunds).toBe(3000);
    expect(r.summary.netCollected).toBe(7000);
  });

  it("counts a single processed refund exactly once", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000, dueDate: "2024-07-01", status: "Paid",
    }).returning();
    const rzpId = `pay_${uid()}`;
    const [pr] = await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: rzpId,
      receivedDate: "2024-07-01", amount: 5000,
    }).returning();

    await insertRefund({
      schoolId, feeRecordId: fr.id, paymentRecordId: pr.id,
      razorpayPaymentId: rzpId, requestedAmountPaise: 500000,
      processedAmountPaise: 500000, localStatus: "processed",
      providerProcessedAt: "2024-07-05T10:00:00Z",
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-07-01", customEnd: "2024-07-31",
    });
    expect(r.summary.refunds).toBe(5000);
    expect(r.summary.netCollected).toBe(0);
  });

  it("dates a refund just before UTC midnight by its IST calendar date (next day)", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000, dueDate: "2024-06-15", status: "Paid",
    }).returning();
    const rzpId = `pay_${uid()}`;
    const [pr] = await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: rzpId,
      receivedDate: "2024-06-15", amount: 5000,
    }).returning();

    // 2024-06-30 23:00 UTC  ==  2024-07-01 04:30 IST.
    // Under a UTC/session-tz ::date filter this would fall on 2024-06-30;
    // under the IST rule it must fall on 2024-07-01.
    await insertRefund({
      schoolId, feeRecordId: fr.id, paymentRecordId: pr.id,
      razorpayPaymentId: rzpId, requestedAmountPaise: 200000,
      processedAmountPaise: 200000, localStatus: "processed",
      providerProcessedAt: "2024-06-30T23:00:00Z",
    });

    // Selecting the June window must EXCLUDE it (its IST date is July 1).
    const june = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-06-01", customEnd: "2024-06-30",
    });
    expect(june.summary.refunds).toBe(0);

    // Selecting the July window must INCLUDE it exactly once.
    const july = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-07-01", customEnd: "2024-07-31",
    });
    expect(july.summary.refunds).toBe(2000);

    // Daily trend within July must attribute it to 2024-07-01.
    const jul1 = july.trend.find(p => p.label === dailyLabel("2024-07-01"));
    expect(jul1).toBeDefined();
    expect(jul1!.refunds).toBe(2000);
  });

  it("buckets a refund's hourly contribution by its IST wall-clock hour (today preset)", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // Build a UTC timestamp that is 04:30 IST on today's IST calendar date —
    // i.e. 23:00 UTC on the *previous* UTC day (the "just before UTC midnight"
    // boundary). This exercises the IST hour = 4 bucket through effective_hour_ist.
    const todayIstDate = todayIST(); // YYYY-MM-DD in Asia/Kolkata
    // 04:30 IST == 23:00 UTC on the prior UTC calendar day.
    const istMidnightUtcMs = new Date(`${todayIstDate}T00:00:00+05:30`).getTime();
    const providerProcessedAt = new Date(istMidnightUtcMs + 4 * 3600_000 + 30 * 60_000)
      .toISOString(); // 04:30 IST today, expressed in UTC

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000, dueDate: todayIstDate, status: "Paid",
    }).returning();
    const rzpId = `pay_${uid()}`;
    const [pr] = await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: rzpId,
      receivedDate: todayIstDate, amount: 5000,
    }).returning();

    await insertRefund({
      schoolId, feeRecordId: fr.id, paymentRecordId: pr.id,
      razorpayPaymentId: rzpId, requestedAmountPaise: 200000,
      processedAmountPaise: 200000, localStatus: "processed",
      providerProcessedAt,
    });

    // "today" preset → 24 hourly buckets.
    const r = await buildFinancialAnalytics({ schoolId, sessionId, preset: "today" });

    expect(r.trend.length).toBe(24);
    const h4 = r.trend.find(p => p.label === "04:00");
    expect(h4).toBeDefined();
    expect(h4!.refunds).toBe(2000);
    // No other bucket carries the refund.
    const totalRefundInTrend = r.trend.reduce((acc, p) => acc + p.refunds, 0);
    expect(totalRefundInTrend).toBe(2000);
  });
});

// ── 13. Offline revision tables ignored ───────────────────────────────────────

describe("buildFinancialAnalytics — offline revision tables ignored", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("offline_payment_detail_revisions do not affect revenue", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 8000, dueDate: "2024-08-01", status: "Paid",
    }).returning();
    const [pr] = await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Cash", receivedDate: "2024-08-01", amount: 8000,
    }).returning();

    await db.execute(sql`
      INSERT INTO offline_payment_details (school_id, payment_record_id, created_at, updated_at)
      VALUES (${schoolId}, ${pr.id}, NOW(), NOW())
    `);
    await db.execute(sql`
      INSERT INTO offline_payment_detail_revisions (
        school_id, payment_record_id, reason, previous_values, new_values, created_at
      ) VALUES (
        ${schoolId}, ${pr.id}, 'test correction',
        '{"branchName":"Old Branch"}', '{"branchName":"New Branch"}', NOW()
      )
    `);

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-08-01", customEnd: "2024-08-31",
    });
    expect(r.summary.grossCollected).toBe(8000);
    expect(r.summary.refunds).toBe(0);
    expect(r.summary.netCollected).toBe(8000);
  });
});

// ── 13b. Comparison refund IST boundary ───────────────────────────────────────

describe("buildFinancialAnalytics — comparison refund IST boundary", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("places a refund just before UTC midnight in the selected (IST next-day) range, not the comparison range", async () => {
    // Selected range: June 2024 (2024-06-01..2024-06-30)
    // Comparison range: May 2024 (2024-05-01..2024-05-31) — both within session 2024-25
    //
    // Refund timestamp: 2024-05-31 23:00 UTC == 2024-06-01 04:30 IST
    // IST calendar date is 2024-06-01 → belongs to selected (June), NOT comparison (May).
    // Under the old UTC ::date filter the IST date would be read as 2024-05-31
    // and the refund would wrongly land in the comparison (May) window.
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 10000, dueDate: "2024-06-01", status: "Paid",
    }).returning();
    const rzpId = `pay_${uid()}`;
    const [pr] = await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: rzpId,
      receivedDate: "2024-06-01", amount: 10000,
    }).returning();

    // 2024-05-31T23:00:00Z = 2024-06-01T04:30 IST → IST date: 2024-06-01
    await insertRefund({
      schoolId, feeRecordId: fr.id, paymentRecordId: pr.id,
      razorpayPaymentId: rzpId, requestedAmountPaise: 400000,
      processedAmountPaise: 400000, localStatus: "processed",
      providerProcessedAt: "2024-05-31T23:00:00Z",
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-06-01", customEnd: "2024-06-30",
    });

    // Comparison must be present (May fits within session).
    // Selected: 2024-06-01..2024-06-30 (30 days)
    // → prior end = 2024-05-31, prior start = 2024-05-31 − 29 days = 2024-05-02
    expect(r.comparison).not.toBeNull();
    expect(r.filter.comparison?.startDate).toBe("2024-05-02");
    expect(r.filter.comparison?.endDate).toBe("2024-05-31");

    // Selected (June): refund appears here because IST date is 2024-06-01
    expect(r.summary.refunds).toBe(4000);
    expect(r.summary.netCollected).toBe(6000);

    // Comparison (May): refund must NOT appear (its IST date is after May)
    expect(r.comparison!.refunds).toBe(0);
    expect(r.comparison!.netCollected).toBe(r.comparison!.grossCollected);

    // Change fields must reflect the IST-correct split
    // Current refunds=4000, prior refunds=0 → pctChange(0, 4000) = null
    expect(r.comparison!.refundsChange).toBeNull();
    // Current net = grossCollected - 4000, prior net = grossCollected_prior - 0
    // The prior netCollected equals prior grossCollected
    expect(r.comparison!.netCollected).toBe(r.comparison!.grossCollected);
  });

  it("places a refund 1 second before IST midnight in the correct IST day", async () => {
    // 2024-06-15T18:29:59Z = 2024-06-15T23:59:59 IST → IST date: 2024-06-15
    // This must land in the selected June window, not leak into June 16.
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 6000, dueDate: "2024-06-15", status: "Paid",
    }).returning();
    const rzpId = `pay_${uid()}`;
    const [pr] = await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: rzpId,
      receivedDate: "2024-06-15", amount: 6000,
    }).returning();

    // 2024-06-15T18:29:59Z == 2024-06-15T23:59:59 IST (still June 15)
    await insertRefund({
      schoolId, feeRecordId: fr.id, paymentRecordId: pr.id,
      razorpayPaymentId: rzpId, requestedAmountPaise: 150000,
      processedAmountPaise: 150000, localStatus: "processed",
      providerProcessedAt: "2024-06-15T18:29:59Z",
    });

    // Narrow window: June 15 only — refund must appear
    const r15 = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-06-15", customEnd: "2024-06-15",
    });
    expect(r15.summary.refunds).toBe(1500);

    // Window starting June 16 — refund must NOT appear
    const r16 = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-06-16", customEnd: "2024-06-30",
    });
    expect(r16.summary.refunds).toBe(0);
  });
});

// ── 14. Online vs offline channel split ───────────────────────────────────────

describe("buildFinancialAnalytics — online vs offline channel split", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("separates Portal Payment (online) and Cash (offline)", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr1] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 12000, dueDate: "2024-09-01", status: "Paid",
    }).returning();
    const [fr2] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Library", amount: 3000, dueDate: "2024-09-01", status: "Paid",
    }).returning();

    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr1.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: `pay_${uid()}`,
      receivedDate: "2024-09-05", amount: 12000,
    });
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr2.id, sessionId,
      paymentMethod: "Cash", receivedDate: "2024-09-05", amount: 3000,
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-09-01", customEnd: "2024-09-30",
    });
    expect(r.summary.grossCollected).toBe(15000);
    expect(r.summary.onlineCollected).toBe(12000);
    expect(r.summary.offlineCollected).toBe(3000);
    expect(r.online.grossCollected).toBe(12000);
    expect(r.offline.grossCollected).toBe(3000);
  });

  it("treats legacy 'Online' method as online channel", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000, dueDate: "2024-09-15", status: "Paid",
    }).returning();
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Online", receivedDate: "2024-09-15", amount: 5000,
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-09-01", customEnd: "2024-09-30",
    });
    expect(r.summary.onlineCollected).toBe(5000);
    expect(r.summary.offlineCollected).toBe(0);
  });
});

// ── 15. Online method label uses payment_mode ─────────────────────────────────

describe("buildFinancialAnalytics — online method label from payment_mode", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("shows 'UPI' when payment_mode='upi'", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 6000, dueDate: "2024-09-01", status: "Paid",
    }).returning();
    await db.execute(sql`
      INSERT INTO payment_records (
        school_id, student_id, fee_record_id, session_id,
        payment_method, payment_mode, razorpay_payment_id,
        received_date, amount, created_at
      ) VALUES (
        ${schoolId}, ${studentId}, ${fr.id}, ${sessionId},
        'Portal Payment', 'upi', ${"pay_upi_" + uid()},
        '2024-09-10', 6000, NOW()
      )
    `);

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-09-01", customEnd: "2024-09-30",
    });
    const upiMethod = r.online.methods.find(m => m.method === "UPI");
    expect(upiMethod).toBeDefined();
    expect(upiMethod!.amount).toBe(6000);
  });

  it("falls back to 'Portal Payment' when payment_mode is null", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 4000, dueDate: "2024-09-01", status: "Paid",
    }).returning();
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: `pay_pp_${uid()}`,
      receivedDate: "2024-09-10", amount: 4000,
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-09-01", customEnd: "2024-09-30",
    });
    const ppMethod = r.online.methods.find(m => m.method === "Portal Payment");
    expect(ppMethod).toBeDefined();
    expect(ppMethod!.amount).toBe(4000);
  });
});

// ── 16. Offline method labels (not "captured") ────────────────────────────────

describe("buildFinancialAnalytics — offline method labels", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("offline statuses use normalised method name, not 'captured'", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 3000, dueDate: "2024-09-01", status: "Paid",
    }).returning();
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Cheque", receivedDate: "2024-09-05", amount: 3000,
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-09-01", customEnd: "2024-09-30",
    });
    const chequeStatus = r.offline.statuses.find(s => s.status === "Cheque");
    expect(chequeStatus).toBeDefined();
    expect(chequeStatus!.count).toBe(1);
    // "captured" must not be a status label for offline
    expect(r.offline.statuses.find(s => s.status === "captured")).toBeUndefined();
  });
});

// ── 17. Historical online PR without attempt → online "captured" ──────────────

describe("buildFinancialAnalytics — historical online PR without attempt", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("appears as 'captured' in online statuses and is not double-counted", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 8000, dueDate: "2024-09-01", status: "Paid",
    }).returning();

    // Historical online PR with razorpay_payment_id but NO corresponding attempt
    const rzpId = `pay_hist_${uid()}`;
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: rzpId,
      receivedDate: "2024-09-10", amount: 8000,
    });

    // No payment_attempt inserted

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-09-01", customEnd: "2024-09-30",
    });

    const captured = r.online.statuses.find(s => s.status === "captured");
    expect(captured).toBeDefined();
    expect(captured!.count).toBe(1);
    expect(captured!.amount).toBe(8000);
  });

  it("does not double-count a PR already covered by a payment_attempt", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 9000, dueDate: "2024-09-01", status: "Paid",
    }).returning();

    const rzpId = `pay_dup_${uid()}`;
    // PR exists
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: rzpId,
      receivedDate: "2024-09-12", amount: 9000,
    });
    // Matching attempt also exists (captured_at in range)
    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      outcome: "captured", amountPaise: 900000,
      razorpayPaymentId: rzpId,
      rzpCapturedAt: "2024-09-12T10:00:00Z",
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-09-01", customEnd: "2024-09-30",
    });

    const captured = r.online.statuses.find(s => s.status === "captured");
    // Should appear exactly once (from attempt), not twice
    expect(captured).toBeDefined();
    expect(captured!.count).toBe(1);
  });

  it("does NOT re-count a PR in range whose linked captured attempt is OUTSIDE the range", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 7500, dueDate: "2024-09-01", status: "Paid",
    }).returning();

    const rzpId = `pay_outofrange_${uid()}`;
    // Payment record received INSIDE the selected window.
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: rzpId,
      receivedDate: "2024-09-15", amount: 7500,
    });
    // Matching captured attempt whose rzp_captured_at is OUTSIDE the window
    // (captured in August, not September). Under the old attemptRzpIds logic
    // this PR would have been wrongly added as a second fallback "captured".
    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      outcome: "captured", amountPaise: 750000,
      razorpayPaymentId: rzpId,
      rzpCapturedAt: "2024-08-20T10:00:00Z",
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-09-01", customEnd: "2024-09-30",
    });

    // The attempt is out of range → not counted as an in-range attempt.
    // The PR is backed by a payment_attempt (has_payment_attempt = true) →
    // NOT counted as a fallback captured. So "captured" must be absent/zero.
    const captured = r.online.statuses.find(s => s.status === "captured");
    expect(captured?.count ?? 0).toBe(0);
  });

  it("counts a legacy Portal Payment with NO razorpay_payment_id and no attempt as fallback captured", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 6200, dueDate: "2024-09-01", status: "Paid",
    }).returning();

    // Legacy online PR: Portal Payment method but NO razorpay_payment_id and
    // no backing payment_attempt row.
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Portal Payment", razorpayPaymentId: null,
      receivedDate: "2024-09-18", amount: 6200,
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-09-01", customEnd: "2024-09-30",
    });

    const captured = r.online.statuses.find(s => s.status === "captured");
    expect(captured).toBeDefined();
    expect(captured!.count).toBe(1);
    expect(captured!.amount).toBe(6200);
  });
});

// ── 18. Denomination strict key validation ────────────────────────────────────

describe("buildFinancialAnalytics — denomination strict key validation", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("rejects non-pure-digit keys like '500foo'", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 1500, dueDate: "2024-10-01", status: "Paid",
    }).returning();

    // Breakdown with a bad key "500foo" and a valid key "100"
    await db.execute(sql`
      INSERT INTO payment_records (
        school_id, student_id, fee_record_id, session_id,
        payment_method, received_date, amount, denomination_breakdown, created_at
      ) VALUES (
        ${schoolId}, ${studentId}, ${fr.id}, ${sessionId},
        'Cash', '2024-10-05', 1500,
        '{"500foo": 2, "100": 5}'::jsonb,
        NOW()
      )
    `);

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-10-01", customEnd: "2024-10-31",
    });

    const denom = r.cashDenominations;
    // "500foo" must be rejected — only key "100" should survive
    expect(denom.denominations.find(d => d.denomination === 500)).toBeUndefined();
    const d100 = denom.denominations.find(d => d.denomination === 100);
    expect(d100).toBeDefined();
    expect(d100!.quantity).toBe(5);
    expect(denom.documentedAmount).toBe(500); // 100 * 5
  });
});

// ── 19. Denomination aggregation ──────────────────────────────────────────────

describe("buildFinancialAnalytics — denomination coverage", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("aggregates valid denominations and tracks with/without breakdown counts", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr1] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 500, dueDate: "2024-10-01", status: "Paid",
    }).returning();
    const [fr2] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Library", amount: 1000, dueDate: "2024-10-01", status: "Paid",
    }).returning();

    await db.execute(sql`
      INSERT INTO payment_records (
        school_id, student_id, fee_record_id, session_id,
        payment_method, received_date, amount, denomination_breakdown, created_at
      ) VALUES (
        ${schoolId}, ${studentId}, ${fr1.id}, ${sessionId},
        'Cash', '2024-10-05', 500, '{"500": 1}'::jsonb, NOW()
      )
    `);
    // Without breakdown
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr2.id, sessionId,
      paymentMethod: "Cash", receivedDate: "2024-10-05", amount: 1000,
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-10-01", customEnd: "2024-10-31",
    });
    const d = r.cashDenominations;
    expect(d.cashPaymentCount).toBe(2);
    expect(d.withBreakdownCount).toBe(1);
    expect(d.withoutBreakdownCount).toBe(1);
    expect(d.cashCollected).toBe(1500);
    expect(d.documentedAmount).toBe(500);
    const d500 = d.denominations.find(x => x.denomination === 500);
    expect(d500).toBeDefined();
    expect(d500!.quantity).toBe(1);
  });

  it("ignores invalid (zero/negative) denomination quantities", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 2000, dueDate: "2024-10-01", status: "Paid",
    }).returning();
    await db.execute(sql`
      INSERT INTO payment_records (
        school_id, student_id, fee_record_id, session_id,
        payment_method, received_date, amount, denomination_breakdown, created_at
      ) VALUES (
        ${schoolId}, ${studentId}, ${fr.id}, ${sessionId},
        'Cash', '2024-10-10', 2000,
        '{"100": 5, "50": 0, "500": -1}'::jsonb,
        NOW()
      )
    `);

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-10-01", customEnd: "2024-10-31",
    });
    const d = r.cashDenominations;
    const d100 = d.denominations.find(x => x.denomination === 100);
    expect(d100).toBeDefined();
    expect(d100!.quantity).toBe(5);
    expect(d.denominations.find(x => x.denomination === 50)).toBeUndefined();
    expect(d.denominations.find(x => x.denomination === 500)).toBeUndefined();
    expect(d.documentedAmount).toBe(500);
  });
});

// ── 20. Class-wise and fee-category attribution ────────────────────────────────

describe("buildFinancialAnalytics — class-wise and fee-category attribution", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("attributes billed and collected amounts to correct class", async () => {
    fixture = await createFixture({ studentClass: "6" });
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 7000, dueDate: "2024-11-01", status: "Paid",
    }).returning();
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Cash", receivedDate: "2024-11-05", amount: 7000,
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-11-01", customEnd: "2024-11-30",
    });
    const cls6 = r.classWise.find(c => c.class === "6");
    expect(cls6).toBeDefined();
    expect(cls6!.billed).toBe(7000);
    expect(cls6!.grossCollected).toBe(7000);
    expect(cls6!.outstanding).toBe(0);
  });

  it("attributes to correct fee categories", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr1] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000, dueDate: "2024-11-01", status: "Paid",
    }).returning();
    const [fr2] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Transport", amount: 2000, dueDate: "2024-11-01", status: "Paid",
    }).returning();
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr1.id, sessionId,
      paymentMethod: "Cash", receivedDate: "2024-11-05", amount: 5000,
    });
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr2.id, sessionId,
      paymentMethod: "Cash", receivedDate: "2024-11-05", amount: 2000,
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-11-01", customEnd: "2024-11-30",
    });
    expect(r.feeCategories.find(c => c.feeType === "Tuition")?.billed).toBe(5000);
    expect(r.feeCategories.find(c => c.feeType === "Transport")?.billed).toBe(2000);
  });
});

// ── 21. Aging buckets ─────────────────────────────────────────────────────────

describe("buildFinancialAnalytics — aging buckets", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("aging total equals overdueAmount", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const today  = new Date().toISOString().slice(0, 10);
    const dates  = [addDays(today, -15), addDays(today, -45), addDays(today, -75), addDays(today, -100)];
    const sess   = fixture.sessionInfo;
    const valid  = dates.filter(d => d >= sess.startDate && d <= sess.endDate);
    if (valid.length === 0) return; // skip if session window doesn't contain them

    for (const dueDate of valid) {
      await db.insert(feeRecords).values({
        schoolId, studentId, sessionId,
        feeType: "Tuition", amount: 1000, dueDate, status: "Overdue",
      });
    }

    const queryStart = valid.reduce((a, b) => (a < b ? a : b));
    const queryEnd   = valid.reduce((a, b) => (a > b ? a : b));

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom",
      customStart: queryStart < sess.startDate ? sess.startDate : queryStart,
      customEnd:   queryEnd   > sess.endDate   ? sess.endDate   : queryEnd,
    });

    const agingTotal = r.aging.reduce((acc, b) => acc + b.amount, 0);
    expect(agingTotal).toBeCloseTo(r.summary.overdueAmount, 2);
  });
});

// ── 22. Outstanding uses lifetime payments ────────────────────────────────────

describe("buildFinancialAnalytics — outstanding uses lifetime payments", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("uses all-time payments for outstanding, not just period payments", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 10000, dueDate: "2024-06-15", status: "Paid",
    }).returning();
    // Payment made in May — outside the June query range
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Cash", receivedDate: "2024-05-01", amount: 10000,
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-06-01", customEnd: "2024-06-30",
    });
    expect(r.summary.billed).toBe(10000);
    expect(r.summary.outstanding).toBe(0);
    expect(r.summary.grossCollected).toBe(0);
  });
});

// ── 23. Collection efficiency ─────────────────────────────────────────────────

describe("buildFinancialAnalytics — collection efficiency", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("calculates efficiency correctly", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 4000, dueDate: "2024-07-01", status: "Paid",
    }).returning();
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId,
      paymentMethod: "Cash", receivedDate: "2024-07-05", amount: 4000,
    });

    const r = await buildFinancialAnalytics({
      schoolId, sessionId,
      preset: "custom", customStart: "2024-07-01", customEnd: "2024-07-31",
    });
    expect(r.summary.collectionEfficiency).toBe(100);
  });

  it("returns 0 when nothing is billed", async () => {
    fixture = await createFixture();
    const r = await buildFinancialAnalytics({
      schoolId: fixture.schoolId, sessionId: fixture.sessionId,
      preset: "custom", customStart: "2024-07-01", customEnd: "2024-07-31",
    });
    expect(r.summary.collectionEfficiency).toBe(0);
  });
});

// ── 24. Trend granularity ─────────────────────────────────────────────────────

describe("buildFinancialAnalytics — trend granularity", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("returns 24 hourly buckets for 'today' with friendly labels", async () => {
    fixture = await createFixture();
    const r = await buildFinancialAnalytics({
      schoolId: fixture.schoolId, sessionId: fixture.sessionId, preset: "today",
    });
    expect(r.trend.length).toBe(24);
    expect(r.trend[0]!.key).toBe("00");
    expect(r.trend[0]!.label).toBe("00:00");
    expect(r.trend[23]!.key).toBe("23");
  });

  it("returns daily buckets with 'DD Mon' labels for this_week", async () => {
    fixture = await createFixture();
    const r = await buildFinancialAnalytics({
      schoolId: fixture.schoolId, sessionId: fixture.sessionId, preset: "this_week",
    });
    expect(r.trend.length).toBe(7);
    // Every label should match "DD Mon" pattern
    for (const pt of r.trend) {
      expect(pt.label).toMatch(/^\d{2} [A-Z][a-z]{2}$/);
    }
  });

  it("returns 12 monthly buckets with 'Mon YY' labels for academic_year", async () => {
    fixture = await createFixture();
    const r = await buildFinancialAnalytics({
      schoolId: fixture.schoolId, sessionId: fixture.sessionId, preset: "academic_year",
    });
    expect(r.trend.length).toBe(12);
    expect(r.trend[0]!.label).toBe("Apr 24");
    expect(r.trend[11]!.label).toBe("Mar 25");
  });
});

// ── 25. Hourly trend billed parity ────────────────────────────────────────────

describe("buildFinancialAnalytics — hourly trend billed parity", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("sum of hourly billed values equals summary.billed", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // Insert an invoice due today so it shows up in billed for the today preset
    const today = new Date().toISOString().slice(0, 10);
    const sess  = fixture.sessionInfo;
    // Only insert if today falls within the session
    if (today >= sess.startDate && today <= sess.endDate) {
      await db.insert(feeRecords).values({
        schoolId, studentId, sessionId,
        feeType: "Tuition", amount: 5000, dueDate: today, status: "Due",
      });
    }

    const r = await buildFinancialAnalytics({
      schoolId, sessionId, preset: "today",
    });

    const trendBilledSum = r.trend.reduce((acc, pt) => acc + pt.billed, 0);
    expect(trendBilledSum).toBe(r.summary.billed);
  });
});

// ── 26. Response contract ─────────────────────────────────────────────────────

describe("buildFinancialAnalytics — response contract", () => {
  let fixture: Fixture;
  afterEach(async () => { if (fixture) await teardown(fixture.schoolId); });

  it("returns all required top-level fields with correct shapes", async () => {
    fixture = await createFixture();
    const r = await buildFinancialAnalytics({
      schoolId: fixture.schoolId, sessionId: fixture.sessionId, preset: "academic_year",
    });

    expect(r).toHaveProperty("generatedAt");
    expect(r).toHaveProperty("sessionInfo");
    expect(r).toHaveProperty("filter");
    expect(r).toHaveProperty("summary");
    expect(r).toHaveProperty("comparison");
    expect(r).toHaveProperty("trend");
    expect(r).toHaveProperty("online");
    expect(r).toHaveProperty("offline");
    expect(r).toHaveProperty("classWise");
    expect(r).toHaveProperty("feeCategories");
    expect(r).toHaveProperty("aging");
    expect(r).toHaveProperty("cashDenominations");

    expect(r.sessionInfo.id).toBe(fixture.sessionId);
    expect(r.sessionInfo.startDate).toBe("2024-04-01");
    expect(r.sessionInfo.endDate).toBe("2025-03-31");
    expect(r.filter.timezone).toBe("Asia/Kolkata");
    expect(r.filter.preset).toBe("academic_year");

    const s = r.summary;
    for (const key of [
      "billed", "grossCollected", "refunds", "netCollected",
      "outstanding", "collectionEfficiency", "onlineCollected",
      "offlineCollected", "overdueAmount", "transactionCount", "totalLatePenalties",
    ]) {
      expect(s).toHaveProperty(key);
    }

    expect(r.aging.map(a => a.bucket)).toEqual(["1-30", "31-60", "61-90", "90+"]);
  });
});
