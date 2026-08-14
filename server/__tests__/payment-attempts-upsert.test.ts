/**
 * Integration tests: payment_attempts table — upsertPaymentAttempt
 *
 * Verifies:
 *  1. A row with a Razorpay payment ID is INSERTed correctly.
 *  2. A duplicate delivery (same payment_id) does not create a second row
 *     (idempotent UPSERT using the partial unique index predicate).
 *  3. Captured/refunded are terminal states — a late authorized/failed webhook
 *     does NOT downgrade an already-captured row.
 *  4. A cancelled attempt (no payment ID but with order ID) is idempotent via
 *     the partial unique index on (school_id, razorpay_order_id).
 *  5. The payment_attempts table returns the expected column structure.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "../db";
import { pool } from "../db";
import { schools, students, academicSessions, feeRecords } from "@shared/schema";
import { eq } from "drizzle-orm";
import { upsertPaymentAttempt, type UpsertAttemptData } from "../rzp-enrichment";

// ── helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface Fixture {
  schoolId: number;
  studentId: number;
  feeRecordId: number;
  sessionId: number;
}

async function createFixture(): Promise<Fixture> {
  const code = `PA-${uid()}`;

  const [school] = await db
    .insert(schools)
    .values({ name: `Payment Attempts Test School ${uid()}`, code })
    .returning();

  const [student] = await db
    .insert(students)
    .values({
      schoolId: school.id,
      digitalStudentId: `DS-${uid()}`,
      name: "PA Test Student",
      class: "10",
      section: "B",
      phone: "9900000099",
      dob: "2007-05-15",
      passwordHash: "x",
    })
    .returning();

  const [session] = await db
    .insert(academicSessions)
    .values({
      schoolId: school.id,
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: true,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    })
    .returning();

  const [feeRecord] = await db
    .insert(feeRecords)
    .values({
      schoolId: school.id,
      studentId: student.id,
      sessionId: session.id,
      feeType: "Tuition",
      amount: 8000,
      dueDate: "2025-09-30",
      status: "Due",
    } as any)
    .returning();

  return {
    schoolId: school.id,
    studentId: student.id,
    feeRecordId: feeRecord.id,
    sessionId: session.id,
  };
}

async function teardown(schoolId: number): Promise<void> {
  await pool.query(`DELETE FROM payment_attempts WHERE school_id = $1`, [schoolId]);
  await db.delete(schools).where(eq(schools.id, schoolId));
}

async function getAttemptsBySchool(schoolId: number): Promise<any[]> {
  const result = await pool.query(
    `SELECT * FROM payment_attempts WHERE school_id = $1 ORDER BY created_at ASC`,
    [schoolId],
  );
  return result.rows;
}

function baseData(f: Fixture, paymentId: string): UpsertAttemptData {
  return {
    schoolId: f.schoolId,
    feeRecordId: f.feeRecordId,
    studentId: f.studentId,
    sessionId: f.sessionId,
    outcome: "captured",
    source: "webhook",
    razorpayPaymentId: paymentId,
    razorpayOrderId: `order_${uid()}`,
    amountPaise: 800000,
    currency: "INR",
    paymentMethod: "upi",
    vpa: "student@okicici",
    webhookEvent: "payment.captured",
    webhookVerified: true,
    rzpCreatedAt: new Date("2025-09-15T10:00:00Z"),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("payment_attempts: INSERT with payment ID", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("inserts a new row when the payment ID is new", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    await upsertPaymentAttempt(baseData(fixture, paymentId));

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0].razorpay_payment_id).toBe(paymentId);
    expect(rows[0].outcome).toBe("captured");
    expect(rows[0].school_id).toBe(fixture.schoolId);
    expect(rows[0].student_id).toBe(fixture.studentId);
    expect(rows[0].fee_record_id).toBe(fixture.feeRecordId);
    expect(rows[0].amount_paise).toBe(800000);
    expect(rows[0].vpa).toBe("student@okicici");
    expect(rows[0].source).toBe("webhook");
  });

  it("does NOT create a duplicate row on second delivery of same payment ID", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    // First delivery
    await upsertPaymentAttempt(baseData(fixture, paymentId));
    // Duplicate delivery (webhook retry)
    await upsertPaymentAttempt(baseData(fixture, paymentId));

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0].razorpay_payment_id).toBe(paymentId);
  });

  it("stores error fields correctly for a failed payment", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    await upsertPaymentAttempt({
      ...baseData(fixture, paymentId),
      outcome: "failed",
      errorCode: "BAD_REQUEST_ERROR",
      errorSource: "gateway",
      errorStep: "payment_authorization",
      errorReason: "payment_failed",
      errorDescription: "Card declined",
      webhookEvent: "payment.failed",
    });

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("failed");
    expect(rows[0].error_code).toBe("BAD_REQUEST_ERROR");
    expect(rows[0].error_source).toBe("gateway");
    expect(rows[0].error_step).toBe("payment_authorization");
    expect(rows[0].error_reason).toBe("payment_failed");
  });
});

describe("payment_attempts: monotonic terminal-state protection", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("captured state is never downgraded by a later authorized event", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    // 1. webhook confirms payment.captured
    await upsertPaymentAttempt({ ...baseData(fixture, paymentId), outcome: "captured" });

    // 2. late/retried payment.authorized arrives (out-of-order)
    await upsertPaymentAttempt({
      ...baseData(fixture, paymentId),
      outcome: "authorized",
      webhookEvent: "payment.authorized",
    });

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    // outcome must remain "captured" — must not revert to "authorized"
    expect(rows[0].outcome).toBe("captured");
  });

  it("captured state is never downgraded by a late failed event", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    await upsertPaymentAttempt({ ...baseData(fixture, paymentId), outcome: "captured" });
    await upsertPaymentAttempt({
      ...baseData(fixture, paymentId),
      outcome: "failed",
      errorCode: "SERVER_ERROR",
      webhookEvent: "payment.failed",
    });

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("captured");
    // error fields should not overwrite a captured row
    expect(rows[0].error_code).toBeNull();
  });
});

describe("payment_attempts: cancelled (no payment ID)", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("inserts first cancel for an order successfully", async () => {
    fixture = await createFixture();
    const orderId = `order_${uid()}`;

    await upsertPaymentAttempt({
      schoolId: fixture.schoolId,
      feeRecordId: fixture.feeRecordId,
      studentId: fixture.studentId,
      sessionId: fixture.sessionId,
      outcome: "cancelled",
      source: "client",
      razorpayPaymentId: null,
      razorpayOrderId: orderId,
      amountPaise: null,
      currency: "INR",
      errorDescription: "Checkout closed",
      webhookEvent: "payment_cancelled",
    });

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("cancelled");
    expect(rows[0].razorpay_payment_id).toBeNull();
  });

  it("deduplicates re-submitted cancels for the same order (idempotent via partial index)", async () => {
    fixture = await createFixture();
    const orderId = `order_${uid()}`;

    const cancelData: UpsertAttemptData = {
      schoolId: fixture.schoolId,
      feeRecordId: fixture.feeRecordId,
      studentId: fixture.studentId,
      sessionId: fixture.sessionId,
      outcome: "cancelled",
      source: "client",
      razorpayPaymentId: null,
      razorpayOrderId: orderId,
      amountPaise: null,
      currency: "INR",
      errorDescription: "Checkout closed",
      webhookEvent: "payment_cancelled",
    };

    // Two cancels for the same order — partial index on (school_id, razorpay_order_id)
    // WHERE razorpay_payment_id IS NULL deduplicates them
    await upsertPaymentAttempt(cancelData);
    await upsertPaymentAttempt(cancelData);

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("cancelled");
  });
});

describe("payment_attempts: partial unique index cross-school isolation", () => {
  let fixtureA: Fixture;
  let fixtureB: Fixture;

  afterEach(async () => {
    if (fixtureA) await teardown(fixtureA.schoolId);
    if (fixtureB) await teardown(fixtureB.schoolId);
  });

  it("two different payment IDs in same school create two rows", async () => {
    fixtureA = await createFixture();
    const paymentIdA = `pay_${uid()}`;
    const paymentIdB = `pay_${uid()}`;

    await upsertPaymentAttempt(baseData(fixtureA, paymentIdA));
    await upsertPaymentAttempt(baseData(fixtureA, paymentIdB));

    const rows = await getAttemptsBySchool(fixtureA.schoolId);
    expect(rows).toHaveLength(2);
    const ids = rows.map((r: any) => r.razorpay_payment_id);
    expect(ids).toContain(paymentIdA);
    expect(ids).toContain(paymentIdB);
  });

  it("same payment ID in different schools creates two rows (no cross-school dedup)", async () => {
    fixtureA = await createFixture();
    fixtureB = await createFixture();
    const sharedPaymentId = `pay_${uid()}`;

    await upsertPaymentAttempt({ ...baseData(fixtureA, sharedPaymentId), schoolId: fixtureA.schoolId });
    await upsertPaymentAttempt({ ...baseData(fixtureB, sharedPaymentId), schoolId: fixtureB.schoolId });

    const rowsA = await getAttemptsBySchool(fixtureA.schoolId);
    const rowsB = await getAttemptsBySchool(fixtureB.schoolId);
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
  });
});

describe("payment_attempts: column structure", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("returns expected columns for a captured row", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    await upsertPaymentAttempt(baseData(fixture, paymentId));

    const result = await pool.query(`
      SELECT
        pa.id,
        pa.outcome,
        pa.fee_record_id    AS "feeRecordId",
        pa.amount_paise     AS "amountPaise",
        pa.currency,
        pa.payment_method   AS "paymentMethod",
        pa.card_network     AS "cardNetwork",
        pa.card_last4       AS "cardLast4",
        pa.vpa,
        pa.bank_rrn         AS "bankRrn",
        pa.bank_auth_code   AS "bankAuthCode",
        pa.payer_email      AS "payerEmail",
        pa.error_code       AS "errorCode",
        pa.razorpay_payment_id AS "razorpayPaymentId",
        pa.razorpay_order_id   AS "razorpayOrderId",
        pa.rzp_created_at      AS "rzpCreatedAt",
        pa.rzp_authorized_at   AS "rzpAuthorizedAt",
        pa.rzp_captured_at     AS "rzpCapturedAt",
        pa.rzp_failed_at       AS "rzpFailedAt",
        pa.refund_id           AS "refundId",
        pa.refund_status       AS "refundStatus",
        pa.refund_amount_paise AS "refundAmountPaise",
        pa.api_synced_at       AS "apiSyncedAt",
        pa.source,
        pa.created_at          AS "createdAt"
      FROM payment_attempts pa
      WHERE pa.school_id = $1
    `, [fixture.schoolId]);

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];

    expect(row.outcome).toBe("captured");
    expect(row.razorpayPaymentId).toBe(paymentId);
    expect(row.amountPaise).toBe(800000);
    expect(row.currency).toBe("INR");
    expect(row.paymentMethod).toBe("upi");
    expect(row.vpa).toBe("student@okicici");
    expect(row.source).toBe("webhook");
    // Nullable fields should be null, not undefined
    expect(row.cardNetwork).toBeNull();
    expect(row.cardLast4).toBeNull();
    expect(row.bankRrn).toBeNull();
    expect(row.refundId).toBeNull();
    expect(row.apiSyncedAt).toBeNull();
  });
});

// ── refund transition tests ───────────────────────────────────────────────────

import { updatePaymentAttemptRefund } from "../rzp-enrichment";

describe("payment_attempts: refund state transitions", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("captured → refunded: refund.processed advances outcome to refunded", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    // Start as captured
    await upsertPaymentAttempt(baseData(fixture, paymentId));

    // refund.processed sets outcome to refunded
    await updatePaymentAttemptRefund(
      fixture.schoolId, paymentId,
      `rfnd_${uid()}`, "processed", 800000,
      new Date("2025-10-01T10:00:00Z"), new Date("2025-10-03T12:00:00Z"),
      "refunded",
    );

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("refunded");
    expect(rows[0].refund_status).toBe("processed");
    expect(rows[0].refund_amount_paise).toBe(800000);
  });

  it("refunded → captured retry: a retried payment.captured webhook does NOT downgrade refunded", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    // Advance to refunded
    await upsertPaymentAttempt(baseData(fixture, paymentId));
    await updatePaymentAttemptRefund(
      fixture.schoolId, paymentId,
      `rfnd_${uid()}`, "processed", 800000,
      new Date(), new Date(),
      "refunded",
    );

    // Late/retried payment.captured webhook
    await upsertPaymentAttempt({ ...baseData(fixture, paymentId), outcome: "captured" });

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("refunded");  // must NOT be downgraded to captured
  });

  it("refunded → later refund event (non-processed): outcome stays refunded", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    await upsertPaymentAttempt(baseData(fixture, paymentId));

    // First: refund.processed
    const refundId = `rfnd_${uid()}`;
    await updatePaymentAttemptRefund(
      fixture.schoolId, paymentId,
      refundId, "processed", 800000,
      new Date(), new Date(),
      "refunded",
    );

    // Later: refund.speed_changed — passes "captured" as newOutcome (non-processed event)
    await updatePaymentAttemptRefund(
      fixture.schoolId, paymentId,
      refundId, "updated", 800000,
      null, null,
      "captured",   // non-processed events pass "captured" — must NOT regress
    );

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("refunded");  // must remain refunded
    expect(rows[0].refund_status).toBe("updated");
  });

  it("refund.created → captured: refund initiation keeps outcome as captured (not yet refunded)", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    await upsertPaymentAttempt(baseData(fixture, paymentId));

    // refund.created event — passes "captured" since refund not yet processed
    await updatePaymentAttemptRefund(
      fixture.schoolId, paymentId,
      `rfnd_${uid()}`, "initiated", 800000,
      new Date(), null,
      "captured",   // refund initiated but not yet processed
    );

    const rows = await getAttemptsBySchool(fixture.schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("captured");  // stays captured until processed
    expect(rows[0].refund_status).toBe("initiated");
  });
});
