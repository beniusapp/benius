/**
 * server/__tests__/transaction-report-data.test.ts
 *
 * Focused tests for buildTransactionRows() — the shared transaction-report
 * data helper.
 *
 * Scenarios covered:
 *  1. Invoice session vs payment session: session scope is determined by
 *     fr.session_id (the invoice), NOT payment_attempts.session_id or
 *     payment_records.session_id.
 *  2. Tenant scoping: rows from a different school never appear.
 *  3. Explicit selectedIds selection.
 *  4. selectAllMatching with excludedIds.
 *  5. Malformed explicit selection (empty selectedIds with selectAllMatching=false)
 *     must return no rows, not export everything.
 *  6. Dedup: the same online payment_attempt + its payment_record produce a
 *     single row, not two.
 *  7. Mixed statuses: captured, failed, and cancelled rows all appear.
 *  8. Refund aggregation: captured→refunded status derivation.
 *  9. Fallback payment_record rows: offline payments with no attempt row appear.
 * 10. Empty invoice population returns empty rows.
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
import { emptyLedgerFilters } from "@shared/ledger-filters";
import {
  buildTransactionRows,
  matchesPaidDateRange,
  transactionDateInIST,
} from "../transaction-report-data";

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

interface Fixture {
  schoolId:   number;
  studentId:  number;
  session1Id: number;
  session2Id: number;
}

async function createFixture(): Promise<Fixture> {
  const code = `TXR-${uid()}`;

  const [school] = await db
    .insert(schools)
    .values({ name: "Tx Report Test School", code })
    .returning();

  const [student] = await db
    .insert(students)
    .values({
      schoolId: school.id,
      digitalStudentId: `DSID-${uid()}`,
      name: "Test Student",
      class: "5",
      section: "A",
      phone: "9999999999",
      dob: "2012-01-01",
      passwordHash: "x",
    })
    .returning();

  const [session1] = await db
    .insert(academicSessions)
    .values({
      schoolId:              school.id,
      sessionName:           "2024-25",
      startDate:             "2024-04-01",
      endDate:               "2025-03-31",
      isActive:              false,
      status:                "active",
      newAdmissionsEnabled:  false,
      promotionStrategy:     "defer",
    })
    .returning();

  const [session2] = await db
    .insert(academicSessions)
    .values({
      schoolId:              school.id,
      sessionName:           "2025-26",
      startDate:             "2025-04-01",
      endDate:               "2026-03-31",
      isActive:              false,
      status:                "active",
      newAdmissionsEnabled:  false,
      promotionStrategy:     "defer",
    })
    .returning();

  return {
    schoolId:   school.id,
    studentId:  student.id,
    session1Id: session1.id,
    session2Id: session2.id,
  };
}

async function teardown(schoolId: number) {
  await db.delete(schools).where(eq(schools.id, schoolId));
}

/** Insert a payment_attempt row directly via raw SQL (Drizzle ORM doesn't have a schema export for this table). */
async function insertPaymentAttempt(fields: {
  schoolId:          number;
  studentId?:        number | null;
  feeRecordId?:      number | null;
  sessionId?:        number | null;
  outcome:           string;
  amountPaise?:      number;
  capturedPaise?:    number;
  refundedPaise?:    number;
  razorpayPaymentId?: string | null;
  razorpayOrderId?:  string | null;
  externalId?:       string | null;
  paymentMethod?:    string | null;
  receiptNumber?:    string | null;
  attemptNumber?:    number | null;
  errorDescription?: string | null;
}): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO payment_attempts (
      school_id, student_id, fee_record_id, session_id, outcome,
      amount_paise, amount_captured_paise, amount_refunded_paise,
      razorpay_payment_id, razorpay_order_id, external_id,
      payment_method, receipt_number, attempt_number, error_description,
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
      ${fields.razorpayOrderId ?? null},
      ${fields.externalId ?? null},
      ${fields.paymentMethod ?? null},
      ${fields.receiptNumber ?? null},
      ${fields.attemptNumber ?? null},
      ${fields.errorDescription ?? null},
      NOW(), NOW()
    )
    RETURNING id
  `);
  return Number((result.rows[0] as any).id);
}

/** Insert a refund row. */
async function insertRefund(fields: {
  schoolId:              number;
  feeRecordId?:          number | null;
  paymentRecordId?:      number | null;
  paymentAttemptId?:     number | null;
  razorpayPaymentId:     string;
  requestedAmountPaise:  number;
  processedAmountPaise?: number | null;
  localStatus:           string;
  providerProcessedAt?:  string | null;
}): Promise<void> {
  const ikey = `ikey-${uid()}`;
  await db.execute(sql`
    INSERT INTO refunds (
      school_id, fee_record_id, payment_record_id, payment_attempt_id,
      razorpay_payment_id, requested_amount_paise, processed_amount_paise,
      local_status, provider_processed_at, idempotency_key, origin, currency,
      created_at, updated_at
    ) VALUES (
      ${fields.schoolId},
      ${fields.feeRecordId ?? null},
      ${fields.paymentRecordId ?? null},
      ${fields.paymentAttemptId ?? null},
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

// ── Test suites ───────────────────────────────────────────────────────────────

describe("buildTransactionRows — invoice session vs payment session", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("returns rows for invoices in the requested session regardless of attempt.session_id", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id, session2Id } = fixture;

    // Invoice belongs to session 1
    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId,
      sessionId: session1Id,
      feeType: "Tuition",
      amount: 10000,
      dueDate: "2024-09-30",
      status: "Paid",
    }).returning();

    // Payment attempt stamped with session 2 (e.g. a historical migration artifact)
    await insertPaymentAttempt({
      schoolId, studentId,
      feeRecordId: fr.id,
      sessionId:   session2Id,   // <-- different session from invoice
      outcome: "captured",
      amountPaise: 1000000,
      capturedPaise: 1000000,
      razorpayPaymentId: `pay_${uid()}`,
    });

    // Filter by session 1 (invoice session) → should still find the row
    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("captured");
  });

  it("does NOT return rows for invoices outside the session filter", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id, session2Id } = fixture;

    // Invoice belongs to session 2
    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId,
      sessionId: session2Id,
      feeType: "Tuition",
      amount: 5000,
      dueDate: "2025-09-30",
      status: "Due",
    }).returning();

    await insertPaymentAttempt({
      schoolId, studentId,
      feeRecordId: fr.id,
      sessionId:   session1Id,  // payment stamped session 1
      outcome: "captured",
      amountPaise: 500000,
      capturedPaise: 500000,
      razorpayPaymentId: `pay_${uid()}`,
    });

    // Filter by session 1 → invoice is session 2 → should NOT appear
    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows.length).toBe(0);
  });
});

describe("buildTransactionRows — tenant scoping", () => {
  let fixture1: Fixture;
  let fixture2: Fixture;

  afterEach(async () => {
    if (fixture1) await teardown(fixture1.schoolId);
    if (fixture2) await teardown(fixture2.schoolId);
  });

  it("never returns rows from a different school", async () => {
    fixture1 = await createFixture();
    fixture2 = await createFixture();

    // Insert fee record and attempt for school 2
    const [fr2] = await db.insert(feeRecords).values({
      schoolId: fixture2.schoolId,
      studentId: fixture2.studentId,
      sessionId: fixture2.session1Id,
      feeType: "Library",
      amount: 3000,
      dueDate: "2024-08-01",
      status: "Paid",
    }).returning();

    await insertPaymentAttempt({
      schoolId: fixture2.schoolId,
      studentId: fixture2.studentId,
      feeRecordId: fr2.id,
      outcome: "captured",
      amountPaise: 300000,
      capturedPaise: 300000,
      razorpayPaymentId: `pay_${uid()}`,
    });

    // Query as school 1 with no session filter → 0 rows
    const rows = await buildTransactionRows(fixture1.schoolId, null, emptyLedgerFilters());
    expect(rows.length).toBe(0);
  });
});

describe("buildTransactionRows — explicit selection", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("returns only rows for the explicitly selected fee_record IDs", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr1] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 5000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    const [fr2] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Library", amount: 1000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    // Two offline payment_records — no attempts
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr1.id, sessionId: session1Id,
      paymentMethod: "Cash", receivedDate: "2024-06-05", amount: 5000,
    });
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr2.id, sessionId: session1Id,
      paymentMethod: "Cash", receivedDate: "2024-06-05", amount: 1000,
    });

    // Only select fr1
    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters(), {
      selectAllMatching: false,
      selectedIds:       [fr1.id],
      excludedIds:       [],
    });

    expect(rows.length).toBe(1);
    expect(rows[0]!.fee_type).toBe("Tuition");
  });

  it("returns empty when selectedIds is empty with selectAllMatching=false (malformed POST)", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 5000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    // Malformed: selectAllMatching=false, selectedIds=[]
    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters(), {
      selectAllMatching: false,
      selectedIds:       [],
      excludedIds:       [],
    });

    expect(rows.length).toBe(0);
  });
});

describe("buildTransactionRows — selectAllMatching with exclusions", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("returns all matching minus excluded IDs", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr1] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 5000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    const [fr2] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Library", amount: 1000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr1.id, sessionId: session1Id,
      paymentMethod: "Cash", receivedDate: "2024-06-05", amount: 5000,
    });
    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr2.id, sessionId: session1Id,
      paymentMethod: "Cash", receivedDate: "2024-06-05", amount: 1000,
    });

    // Select all but exclude fr2
    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters(), {
      selectAllMatching: true,
      selectedIds:       [],
      excludedIds:       [fr2.id],
    });

    expect(rows.length).toBe(1);
    expect(rows[0]!.fee_type).toBe("Tuition");
  });
});

describe("buildTransactionRows — deduplication", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("online attempt and its linked payment_record produce one row, not two", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 8000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    const rzpId = `pay_${uid()}`;

    // Insert payment_record with razorpay_payment_id
    const [pr] = await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId: session1Id,
      paymentMethod: "upi", receivedDate: "2024-06-10", amount: 8000,
      razorpayPaymentId: rzpId,
    }).returning();

    // Insert payment_attempt linked via razorpay_payment_id
    await insertPaymentAttempt({
      schoolId, studentId,
      feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 800000,
      capturedPaise: 800000,
      razorpayPaymentId: rzpId,
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());

    // Must deduplicate → exactly 1 row
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("captured");
    expect(rows[0]!.payment_id).toBe(rzpId);
  });

  it("offline attempt linked via external_id does not duplicate its payment_record", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Transport", amount: 2000, dueDate: "2024-07-01", status: "Paid",
    }).returning();

    // Offline payment_record
    const [pr] = await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId: session1Id,
      paymentMethod: "Cash", receivedDate: "2024-07-05", amount: 2000,
    }).returning();

    // Offline payment_attempt linked via external_id = 'pr:' || pr.id
    await insertPaymentAttempt({
      schoolId, studentId,
      feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 200000,
      capturedPaise: 200000,
      externalId: `pr:${pr.id}`,
      paymentMethod: "Cash",
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());

    // Must deduplicate → 1 row from attempt, 0 from fallback
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toMatch(/^pa:/);
  });
});

describe("buildTransactionRows — mixed statuses", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("captures, failed, and cancelled attempts all appear", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    // One invoice, multiple attempts
    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 5000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "failed",
      amountPaise: 500000,
      razorpayPaymentId: `pay_${uid()}`,
      errorDescription: "Insufficient funds",
    });

    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "cancelled",
      amountPaise: 500000,
      razorpayOrderId: `order_${uid()}`,
    });

    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 500000,
      capturedPaise: 500000,
      razorpayPaymentId: `pay_${uid()}`,
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());

    const statuses = rows.map(r => r.status).sort();
    expect(statuses).toContain("captured");
    expect(statuses).toContain("failed");
    expect(statuses).toContain("cancelled");
    expect(rows.length).toBe(3);

    const failedRow = rows.find(r => r.status === "failed");
    expect(failedRow?.failure_reason).toBeTruthy();
  });
});

describe("buildTransactionRows — timestamps and precision", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("authorized attempt uses rzp_authorized_at as the transaction timestamp", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 5000, dueDate: "2024-06-01", status: "Due",
    }).returning();

    const attemptId = await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "authorized",
      amountPaise: 500000,
      razorpayPaymentId: `pay_${uid()}`,
    });

    // Set a distinct rzp_authorized_at directly
    const authTs = "2024-06-15T10:30:00.000Z";
    await db.execute(sql`
      UPDATE payment_attempts
      SET rzp_authorized_at = ${authTs}, rzp_created_at = '2024-06-15T09:00:00.000Z'
      WHERE id = ${attemptId} AND school_id = ${schoolId}
    `);

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("authorized");
    // The authorized timestamp — not the created timestamp — must be chosen.
    expect(new Date(rows[0]!.transaction_at!).toISOString()).toBe(authTs);
  });

  it("preserves fractional-rupee paise precision without rounding", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 1234, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    const rzpId = `pay_${uid()}`;
    // 123456 paise = ₹1234.56 — a value that must NOT be rounded to 1235.
    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 123456,
      capturedPaise: 123456,
      razorpayPaymentId: rzpId,
    });

    // Partial refund of 55555 paise = ₹555.55
    await insertRefund({
      schoolId,
      feeRecordId: fr.id,
      razorpayPaymentId: rzpId,
      requestedAmountPaise: 55555,
      processedAmountPaise: 55555,
      localStatus: "processed",
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBeCloseTo(1234.56, 2);
    expect(rows[0]!.refund_amount).toBeCloseTo(555.55, 2);
    expect(rows[0]!.status).toBe("partially_refunded");
  });
});

describe("buildTransactionRows — refund aggregation", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("full refund → status becomes refunded", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 6000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    const rzpId = `pay_${uid()}`;
    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 600000,
      capturedPaise: 600000,
      razorpayPaymentId: rzpId,
    });

    // Full refund processed
    await insertRefund({
      schoolId,
      feeRecordId: fr.id,
      razorpayPaymentId: rzpId,
      requestedAmountPaise: 600000,
      processedAmountPaise: 600000,
      localStatus: "processed",
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("refunded");
    expect(rows[0]!.refund_amount).toBe(6000);
    expect(rows[0]!.refund_status).toBe("processed");
  });

  it("partial refund → status becomes partially_refunded", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Library", amount: 4000, dueDate: "2024-07-01", status: "Paid",
    }).returning();

    const rzpId = `pay_${uid()}`;
    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 400000,
      capturedPaise: 400000,
      razorpayPaymentId: rzpId,
    });

    // Partial refund
    await insertRefund({
      schoolId,
      feeRecordId: fr.id,
      razorpayPaymentId: rzpId,
      requestedAmountPaise: 100000,
      processedAmountPaise: 100000,
      localStatus: "processed",
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("partially_refunded");
    expect(rows[0]!.refund_amount).toBe(1000);
  });

  it("pending/requested refund does NOT count as refunded but exposes refund_status", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 5000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    const rzpId = `pay_${uid()}`;
    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 500000,
      capturedPaise: 500000,
      razorpayPaymentId: rzpId,
    });

    // A refund that is only REQUESTED (not processed) — must not affect the money
    await insertRefund({
      schoolId,
      feeRecordId: fr.id,
      razorpayPaymentId: rzpId,
      requestedAmountPaise: 500000,
      processedAmountPaise: null,
      localStatus: "requested",
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows.length).toBe(1);
    // Captured status/amount unchanged by a pending reservation.
    expect(rows[0]!.status).toBe("captured");
    expect(rows[0]!.refund_amount).toBe(0);
    // But the pending request still surfaces in refund_status.
    expect(rows[0]!.refund_status).toBe("requested");
  });

  it("refund_amount is 0 when there are no refunds", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 5000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 500000,
      capturedPaise: 500000,
      razorpayPaymentId: `pay_${uid()}`,
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows.length).toBe(1);
    expect(rows[0]!.refund_amount).toBe(0);
    expect(rows[0]!.refund_status).toBeNull();
  });

  it("refund linked by payment_attempt_id is associated to the right row", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 7000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    const rzpId = `pay_${uid()}`;
    const attemptId = await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 700000,
      capturedPaise: 700000,
      razorpayPaymentId: rzpId,
    });

    // Refund linked ONLY by payment_attempt_id (no payment_record_id)
    await insertRefund({
      schoolId,
      feeRecordId: fr.id,
      paymentAttemptId: attemptId,
      razorpayPaymentId: rzpId,
      requestedAmountPaise: 700000,
      processedAmountPaise: 700000,
      localStatus: "processed",
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(`pa:${attemptId}`);
    expect(rows[0]!.status).toBe("refunded");
    expect(rows[0]!.refund_amount).toBe(7000);
  });

  it("a refund with multiple link fields is counted only once", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 9000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    const rzpId = `pay_${uid()}`;
    // Online payment record + linked attempt
    const [pr] = await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId: session1Id,
      paymentMethod: "upi", receivedDate: "2024-06-10", amount: 9000,
      razorpayPaymentId: rzpId,
    }).returning();
    const attemptId = await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 900000,
      capturedPaise: 900000,
      razorpayPaymentId: rzpId,
    });

    // A single processed refund carrying attempt id + record id + payment id
    await insertRefund({
      schoolId,
      feeRecordId: fr.id,
      paymentAttemptId: attemptId,
      paymentRecordId: pr.id,
      razorpayPaymentId: rzpId,
      requestedAmountPaise: 900000,
      processedAmountPaise: 900000,
      localStatus: "processed",
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    // Deduped to a single row, refund counted exactly once (9000, not 18000/27000).
    expect(rows.length).toBe(1);
    expect(rows[0]!.refund_amount).toBe(9000);
    expect(rows[0]!.status).toBe("refunded");
  });

  it("combines multiple processed refunds written with different linkage completeness", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 10000, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    const rzpId = `pay_${uid()}`;
    const attemptId = await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "captured",
      amountPaise: 1000000,
      capturedPaise: 1000000,
      razorpayPaymentId: rzpId,
    });

    await insertRefund({
      schoolId,
      feeRecordId: fr.id,
      paymentAttemptId: attemptId,
      razorpayPaymentId: rzpId,
      requestedAmountPaise: 200000,
      processedAmountPaise: 200000,
      localStatus: "processed",
    });
    await insertRefund({
      schoolId,
      feeRecordId: fr.id,
      razorpayPaymentId: rzpId,
      requestedAmountPaise: 300000,
      processedAmountPaise: 300000,
      localStatus: "processed",
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refund_amount).toBe(5000);
    expect(rows[0]!.status).toBe("partially_refunded");
  });

  it("uses the provider-backed attempt refund projection when no refund row exists", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Tuition", amount: 2500, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    await insertPaymentAttempt({
      schoolId, studentId, feeRecordId: fr.id,
      outcome: "refunded",
      amountPaise: 250000,
      capturedPaise: 250000,
      refundedPaise: 250000,
      razorpayPaymentId: `pay_${uid()}`,
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refund_amount).toBe(2500);
    expect(rows[0]!.refund_status).toBe("processed");
    expect(rows[0]!.status).toBe("refunded");
  });
});

describe("buildTransactionRows — fallback payment_record rows", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("offline payment_record with no attempt appears as captured row", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1Id,
      feeType: "Lab", amount: 1500, dueDate: "2024-06-01", status: "Paid",
    }).returning();

    await db.insert(paymentRecords).values({
      schoolId, studentId, feeRecordId: fr.id, sessionId: session1Id,
      paymentMethod: "Cash", receivedDate: "2024-06-10", amount: 1500,
    });

    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toMatch(/^pr:/);
    expect(rows[0]!.status).toBe("captured");
    expect(rows[0]!.amount).toBe(1500);
  });
});

describe("buildTransactionRows — empty invoice population", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("returns empty array when no invoices match", async () => {
    fixture = await createFixture();
    const { schoolId, session1Id } = fixture;

    // No fee records inserted
    const rows = await buildTransactionRows(schoolId, session1Id, emptyLedgerFilters());
    expect(rows).toEqual([]);
  });
});

describe("transaction report paid-date authority", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("converts the prior UTC day to the correct IST calendar date", () => {
    expect(transactionDateInIST("2026-08-21T22:51:24.997Z")).toBe("2026-08-22");
    expect(transactionDateInIST("2026-08-22")).toBe("2026-08-22");
    expect(matchesPaidDateRange("2026-08-22", {
      paidDateFrom: "2026-08-22",
      paidDateTo: "2026-08-22",
    })).toBe(true);
  });

  it("matches an invoice by any payment in range and excludes its unrelated transactions", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, session1Id } = fixture;

    const [matchingInvoice] = await db.insert(feeRecords).values({
      schoolId,
      studentId,
      sessionId: session1Id,
      feeType: "Tuition",
      amount: 3000,
      dueDate: "2024-06-01",
      paidDate: "2024-06-09",
      status: "Paid",
    }).returning();

    await db.insert(paymentRecords).values([
      {
        schoolId,
        studentId,
        sessionId: session1Id,
        feeRecordId: matchingInvoice.id,
        paymentMethod: "Cash",
        receivedDate: "2024-06-10",
        amount: 1000,
      },
      {
        schoolId,
        studentId,
        sessionId: session1Id,
        feeRecordId: matchingInvoice.id,
        paymentMethod: "Cash",
        receivedDate: "2024-07-10",
        amount: 2000,
      },
    ]);

    const [projectionOnlyInvoice] = await db.insert(feeRecords).values({
      schoolId,
      studentId,
      sessionId: session1Id,
      feeType: "Transport",
      amount: 4000,
      dueDate: "2024-06-01",
      paidDate: "2024-06-10",
      status: "Paid",
    }).returning();
    await db.insert(paymentRecords).values({
      schoolId,
      studentId,
      sessionId: session1Id,
      feeRecordId: projectionOnlyInvoice.id,
      paymentMethod: "Cash",
      receivedDate: "2024-07-10",
      amount: 4000,
    });

    const rows = await buildTransactionRows(schoolId, session1Id, {
      ...emptyLedgerFilters(),
      paidDateFrom: "2024-06-10",
      paidDateTo: "2024-06-10",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(1000);
    expect(rows[0]!.transaction_at).toBe("2024-06-10");
  });
});
