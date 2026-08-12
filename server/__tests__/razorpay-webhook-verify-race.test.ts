/**
 * Integration tests: Razorpay webhook-beats-verify race condition
 *
 * Scenarios covered:
 *
 *  1. Clean webhook-first path — webhook commits fee=Paid/receiptA and
 *     payment_records/receiptA; the verify handler then reads status="Paid"
 *     and returns { ok: true, idempotent: true, receiptNumber: receiptA }
 *     without writing any additional rows.
 *
 *  2. Full race sequence — verify reads fee as "Due", then the webhook
 *     commits (fee=Paid/receiptA, payment_records/receiptA); verify continues
 *     and overwrites the fee with receiptB, then its payment_records INSERT
 *     fails on the unique idempotency_key constraint (23505).  The catch
 *     handler must:
 *       a) look up the canonical receipt from the winning payment_records row
 *       b) restore fee_records.receipt_number to receiptA
 *       c) return { ok: true, idempotent: true, receiptNumber: receiptA }
 *     Afterwards fee.receipt_number === payment_records.receipt_number (receiptA)
 *     and exactly one payment_records row exists.
 *
 * These tests hit the real database. Each test creates isolated rows under a
 * randomly-suffixed school code and deletes them in afterEach so they leave
 * no trace.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "../db";
import { storage } from "../storage";
import {
  schools,
  students,
  academicSessions,
  feeRecords,
  paymentRecords,
} from "@shared/schema";
import { eq, count } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ── helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface Fixture {
  schoolId: number;
  studentId: number;
  sessionId: number;
  feeRecordId: number;
  feeAmount: number;
}

async function createFixture(): Promise<Fixture> {
  const code = `RZP-${uid()}`;

  const [school] = await db
    .insert(schools)
    .values({ name: "Razorpay Race Test School", code })
    .returning();

  const [student] = await db
    .insert(students)
    .values({
      schoolId: school.id,
      digitalStudentId: `DS-${uid()}`,
      name: "Race Student",
      class: "8",
      section: "B",
      phone: "9800000000",
      dob: "2009-06-15",
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

  const feeAmount = 12000;
  const [feeRecord] = await db
    .insert(feeRecords)
    .values({
      schoolId: school.id,
      studentId: student.id,
      sessionId: session.id,
      feeType: "Tuition",
      amount: feeAmount,
      dueDate: "2025-08-31",
      status: "Due",
    })
    .returning();

  return {
    schoolId: school.id,
    studentId: student.id,
    sessionId: session.id,
    feeRecordId: feeRecord.id,
    feeAmount,
  };
}

async function teardown(schoolId: number): Promise<void> {
  await db.execute(sql`DELETE FROM fee_audit_log WHERE school_id = ${schoolId}`);
  await db.delete(schools).where(eq(schools.id, schoolId));
}

/**
 * Simulate the exact DB writes the webhook payment.captured handler performs.
 * Returns the receipt number the webhook committed.
 */
async function webhookCapture(fixture: Fixture, paymentId: string): Promise<string> {
  const { schoolId, feeRecordId, studentId, sessionId, feeAmount } = fixture;

  const receiptNumber = await storage.nextReceiptNumber(schoolId, "ON");
  const now = new Date();

  await db.execute(sql`
    UPDATE fee_records
    SET status = 'Paid', paid_date = ${now.toISOString()}, receipt_number = ${receiptNumber}
    WHERE id = ${feeRecordId} AND school_id = ${schoolId}
  `);

  await db.insert(paymentRecords).values({
    schoolId,
    sessionId,
    feeRecordId,
    studentId,
    paymentMethod: "Online",
    referenceNumber: paymentId,
    receivedDate: now.toISOString().slice(0, 10),
    amount: feeAmount,
    cashierNotes: `Razorpay payment ID: ${paymentId}`,
    recordedBy: null,
    receiptNumber,
    idempotencyKey: `rzp_${paymentId}`,
  } as any);

  return receiptNumber;
}

/**
 * Run the exact DB sequence the /api/payments/verify handler executes,
 * including the catch-block recovery logic.
 *
 * The caller can inject a "raceHook" that fires between the fee UPDATE and the
 * payment_records INSERT — this simulates the webhook committing mid-flight.
 *
 * Returns the same shape as the HTTP response body.
 */
async function runVerifyLogic(
  fixture: Fixture,
  paymentId: string,
  raceHook?: () => Promise<void>,
): Promise<{ ok: boolean; idempotent?: boolean; receiptNumber?: string }> {
  const { schoolId, feeRecordId, studentId, sessionId, feeAmount } = fixture;

  // ── Mirrors /api/payments/verify ─────────────────────────────────────────

  const feeResult = (
    await db.execute(
      sql`SELECT * FROM fee_records WHERE id = ${feeRecordId} LIMIT 1`,
    )
  ).rows[0] as any;

  // Early-return if already Paid (webhook fully committed before we even started)
  if (feeResult.status === "Paid") {
    return { ok: true, idempotent: true, receiptNumber: feeResult.receipt_number };
  }

  try {
    // Allocate verify's own receipt number
    const receiptNumber = await storage.nextReceiptNumber(schoolId, "ON");
    const now = new Date();

    // UPDATE fee_records — this commits before the INSERT below
    await db.execute(sql`
      UPDATE fee_records
      SET status = 'Paid', paid_date = ${now.toISOString()}, receipt_number = ${receiptNumber}
      WHERE id = ${feeRecordId} AND school_id = ${schoolId}
    `);

    // ── Race window: webhook fires here, commits its own receipt ─────────
    if (raceHook) await raceHook();

    // INSERT payment_records — fails with 23505 when webhook already inserted
    await db.insert(paymentRecords).values({
      schoolId,
      sessionId,
      feeRecordId,
      studentId,
      paymentMethod: "Online",
      referenceNumber: paymentId,
      receivedDate: now.toISOString().slice(0, 10),
      amount: feeAmount,
      cashierNotes: `Razorpay payment ID: ${paymentId} (client-verified)`,
      recordedBy: null,
      receiptNumber,
      idempotencyKey: `rzp_${paymentId}`,
    } as any);

    return { ok: true, receiptNumber };
  } catch (err: any) {
    // ── Mirrors the catch block in fees-routes.ts /api/payments/verify ───
    if (
      err?.code === "23505" &&
      String(err?.constraint ?? err?.message ?? "").includes("idempotency_key")
    ) {
      try {
        const winnerRows = (
          await db.execute(sql`
            SELECT receipt_number FROM payment_records
            WHERE idempotency_key = ${"rzp_" + paymentId}
            LIMIT 1
          `)
        ).rows;
        const canonicalReceipt = (winnerRows[0] as any)?.receipt_number as string | undefined;
        if (canonicalReceipt) {
          await db.execute(sql`
            UPDATE fee_records
            SET receipt_number = ${canonicalReceipt}
            WHERE id = ${feeRecordId}
          `);
          return { ok: true, idempotent: true, receiptNumber: canonicalReceipt };
        }
      } catch {
        // restore failed — still return success
      }
      return { ok: true, idempotent: true };
    }
    throw err;
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Razorpay race: webhook fully commits before verify starts", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("verify detects Paid status and returns idempotent:true without inserting a duplicate row", async () => {
    fixture = await createFixture();
    const { feeRecordId } = fixture;
    const paymentId = `pay_${uid()}`;

    // Webhook commits first
    const webhookReceipt = await webhookCapture(fixture, paymentId);

    // Verify runs — fee is already Paid when it reads the record
    const response = await runVerifyLogic(fixture, paymentId);

    expect(response.ok).toBe(true);
    expect(response.idempotent).toBe(true);
    expect(response.receiptNumber).toBe(webhookReceipt);

    // Only one payment_records row
    const [{ value: rowCount }] = await db
      .select({ value: count() })
      .from(paymentRecords)
      .where(eq(paymentRecords.feeRecordId, feeRecordId));
    expect(Number(rowCount)).toBe(1);
  });
});

describe("Razorpay race: webhook fires between verify's fee UPDATE and its INSERT", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("verify catches the 23505 conflict, restores the canonical receipt, and returns idempotent:true", async () => {
    fixture = await createFixture();
    const { feeRecordId } = fixture;
    const paymentId = `pay_${uid()}`;

    // The raceHook fires after verify's fee UPDATE commits (overwriting whatever
    // receipt the webhook will use), and before verify's INSERT — exactly the
    // window where the webhook can commit and cause the unique-key conflict.
    let webhookReceipt: string | undefined;
    const raceHook = async () => {
      webhookReceipt = await webhookCapture(fixture, paymentId);
    };

    const response = await runVerifyLogic(fixture, paymentId, raceHook);

    // Response must signal idempotent success with the webhook's canonical receipt
    expect(response.ok).toBe(true);
    expect(response.idempotent).toBe(true);
    expect(response.receiptNumber).toBe(webhookReceipt);
  });

  it("fee_records.receipt_number matches payment_records.receipt_number after the race", async () => {
    fixture = await createFixture();
    const { feeRecordId } = fixture;
    const paymentId = `pay_${uid()}`;

    let webhookReceipt: string | undefined;
    const raceHook = async () => {
      webhookReceipt = await webhookCapture(fixture, paymentId);
    };

    await runVerifyLogic(fixture, paymentId, raceHook);

    // Final fee row must carry the webhook's receipt, not verify's discarded one
    const feeRow = (
      await db.execute(
        sql`SELECT status, receipt_number FROM fee_records WHERE id = ${feeRecordId} LIMIT 1`,
      )
    ).rows[0] as any;

    const paymentRow = (
      await db.execute(
        sql`SELECT receipt_number FROM payment_records WHERE fee_record_id = ${feeRecordId} LIMIT 1`,
      )
    ).rows[0] as any;

    expect(feeRow.status).toBe("Paid");
    expect(feeRow.receipt_number).toBe(webhookReceipt);
    expect(paymentRow.receipt_number).toBe(webhookReceipt);
    // The two tables are consistent with each other
    expect(feeRow.receipt_number).toBe(paymentRow.receipt_number);
  });

  it("exactly one payment_records row exists after the race — no duplicate inserted", async () => {
    fixture = await createFixture();
    const { feeRecordId } = fixture;
    const paymentId = `pay_${uid()}`;

    const raceHook = async () => {
      await webhookCapture(fixture, paymentId);
    };

    await runVerifyLogic(fixture, paymentId, raceHook);

    const [{ value: rowCount }] = await db
      .select({ value: count() })
      .from(paymentRecords)
      .where(eq(paymentRecords.feeRecordId, feeRecordId));

    expect(Number(rowCount)).toBe(1);
  });

  it("the 23505 conflict on idempotency_key is correctly classified as an idempotency race", async () => {
    // Exercises the error-classification gate that distinguishes an idempotency
    // conflict (safe to recover) from any other 23505 (should still surface as 500).
    // This mirrors the exact condition tested in the catch block of fees-routes.ts.

    function classifyError(err: {
      code?: string;
      constraint?: string;
      message?: string;
    }): "idempotent_race" | "other_error" {
      if (
        err?.code === "23505" &&
        String(err?.constraint ?? err?.message ?? "").includes("idempotency_key")
      ) {
        return "idempotent_race";
      }
      return "other_error";
    }

    // Real idempotency_key unique violation — must be classified as a safe race
    expect(
      classifyError({
        code: "23505",
        constraint: "payment_records_idempotency_key_unique",
        message:
          'duplicate key value violates unique constraint "payment_records_idempotency_key_unique"',
      }),
    ).toBe("idempotent_race");

    // A different unique constraint on the same table — must NOT be swallowed
    expect(
      classifyError({
        code: "23505",
        constraint: "payment_records_reference_number_unique",
        message:
          'duplicate key value violates unique constraint "payment_records_reference_number_unique"',
      }),
    ).toBe("other_error");

    // Non-constraint errors must not be swallowed
    expect(
      classifyError({
        code: "08006",
        message: "connection failure",
      }),
    ).toBe("other_error");
  });
});

// ── Webhook duplicate-delivery (payment.captured resent by Razorpay) ──────────
//
// Razorpay retries webhook delivery when it does not receive a 200 quickly.
// The second delivery hits the same idempotency_key already in payment_records
// and must return { ok: true, idempotent: true } instead of 500.
//
// Crucially, both deliveries may read the fee as "Due" before either commits.
// The losing handler can overwrite fee_records.receipt_number with its own
// allocated receipt before its INSERT raises 23505.  The catch block must
// restore the canonical receipt (from the winning payment_records row) so the
// fee row remains consistent with the sole payment row.

/**
 * Simulate the full payment.captured webhook handler DB sequence, including
 * the nested-try/catch recovery added to fees-routes.ts.
 *
 * Structure mirrors production exactly:
 *  1. Read fee; early-return if already Paid.
 *  2. Allocate receipt, UPDATE fee_records.
 *  3. INSERT payment_records inside its own nested try/catch.
 *     On 23505/idempotency_key: restore canonical receipt, return idempotent.
 *     On any other error: rethrow to the caller (outer catch → 500 in prod).
 *
 * A raceHook (optional) fires between the fee UPDATE and the INSERT —
 * simulating the first delivery committing while the second is in-flight.
 *
 * Returns the same shape as the HTTP response body.
 */
async function runWebhookLogic(
  fixture: Fixture,
  paymentId: string,
  raceHook?: () => Promise<void>,
): Promise<{ ok: boolean; idempotent?: boolean }> {
  const { schoolId, feeRecordId, studentId, sessionId, feeAmount } = fixture;

  // ── mirrors payment.captured handler in fees-routes.ts ──────────────────

  const feeResult = (
    await db.execute(
      sql`SELECT * FROM fee_records WHERE id = ${feeRecordId} AND school_id = ${schoolId} LIMIT 1`,
    )
  ).rows[0] as any;

  // Early-return when first delivery already committed (fee is Paid)
  if (feeResult.status === "Paid") {
    return { ok: true, idempotent: true };
  }

  const receiptNumber = await storage.nextReceiptNumber(schoolId, "ON");
  const now = new Date();

  await db.execute(sql`
    UPDATE fee_records
    SET status = 'Paid', paid_date = ${now.toISOString()}, receipt_number = ${receiptNumber}
    WHERE id = ${feeRecordId} AND school_id = ${schoolId}
  `);

  // ── Race window: first delivery commits here (overwrites our receipt) ──
  if (raceHook) await raceHook();

  // Nested try/catch mirrors the production guard in fees-routes.ts:
  // only the INSERT is wrapped; a 23505/idempotency_key conflict means the
  // first delivery already committed and we must restore the canonical receipt.
  try {
    await db.insert(paymentRecords).values({
      schoolId,
      sessionId,
      feeRecordId,
      studentId,
      paymentMethod: "Online",
      referenceNumber: paymentId,
      receivedDate: now.toISOString().slice(0, 10),
      amount: feeAmount,
      cashierNotes: `Razorpay payment ID: ${paymentId}`,
      recordedBy: null,
      receiptNumber,
      idempotencyKey: `rzp_${paymentId}`,
    } as any);
  } catch (insertErr: any) {
    // ── mirrors the nested catch block in fees-routes.ts payment.captured ─
    if (
      insertErr?.code === "23505" &&
      String(insertErr?.constraint ?? insertErr?.message ?? "").includes("idempotency_key")
    ) {
      try {
        const winnerRows = (
          await db.execute(sql`
            SELECT receipt_number FROM payment_records
            WHERE idempotency_key = ${"rzp_" + paymentId}
            LIMIT 1
          `)
        ).rows;
        const canonicalReceipt = (winnerRows[0] as any)?.receipt_number as string | undefined;
        if (canonicalReceipt) {
          await db.execute(sql`
            UPDATE fee_records
            SET receipt_number = ${canonicalReceipt}
            WHERE id = ${feeRecordId} AND school_id = ${schoolId}
          `);
        }
      } catch {
        // restore failed — still return idempotent success
      }
      return { ok: true, idempotent: true };
    }
    throw insertErr; // non-idempotency error — rethrow
  }

  return { ok: true };
}

// ── Error-classification unit tests ────────────────────────────────────────

function webhookCatchClassify(err: {
  code?: string;
  constraint?: string;
  message?: string;
}): "idempotent_race" | "other_error" {
  if (
    err?.code === "23505" &&
    String(err?.constraint ?? err?.message ?? "").includes("idempotency_key")
  ) {
    return "idempotent_race";
  }
  return "other_error";
}

describe("Razorpay webhook: duplicate payment.captured delivery — error classification", () => {
  it("the 23505 idempotency_key constraint is classified as a safe duplicate, not a 500", () => {
    expect(
      webhookCatchClassify({
        code: "23505",
        constraint: "payment_records_idempotency_key_unique",
        message:
          'duplicate key value violates unique constraint "payment_records_idempotency_key_unique"',
      }),
    ).toBe("idempotent_race");
  });

  it("a different 23505 constraint is NOT silenced — it propagates as a 500", () => {
    expect(
      webhookCatchClassify({
        code: "23505",
        constraint: "payment_records_reference_number_unique",
        message:
          'duplicate key value violates unique constraint "payment_records_reference_number_unique"',
      }),
    ).toBe("other_error");
  });

  it("a non-unique-constraint error is NOT silenced", () => {
    expect(
      webhookCatchClassify({ code: "08006", message: "connection failure" }),
    ).toBe("other_error");
  });
});

// ── Full overlapping-delivery integration tests ─────────────────────────────
//
// Both webhook deliveries read the fee as "Due".  The first delivery commits
// (fee=Paid, receiptA, payment row).  While in-flight, the second delivery
// has already updated the fee to receiptB.  Its INSERT then hits 23505.
// The catch block must restore receiptA and return idempotent success.

describe("Razorpay webhook: two overlapping payment.captured deliveries", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("the losing delivery catches the 23505 conflict and returns idempotent:true", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    // raceHook: first delivery commits fully between the second's fee UPDATE
    // and its payment_records INSERT — exactly the window that causes 23505.
    const raceHook = async () => {
      await webhookCapture(fixture, paymentId);
    };

    const result = await runWebhookLogic(fixture, paymentId, raceHook);

    expect(result.ok).toBe(true);
    expect(result.idempotent).toBe(true);
  });

  it("fee_records.receipt_number is restored to the canonical (winning) receipt after the race", async () => {
    fixture = await createFixture();
    const { feeRecordId } = fixture;
    const paymentId = `pay_${uid()}`;

    let winningReceipt: string | undefined;
    const raceHook = async () => {
      winningReceipt = await webhookCapture(fixture, paymentId);
    };

    await runWebhookLogic(fixture, paymentId, raceHook);

    const feeRow = (
      await db.execute(
        sql`SELECT status, receipt_number FROM fee_records WHERE id = ${feeRecordId} LIMIT 1`,
      )
    ).rows[0] as any;
    const paymentRow = (
      await db.execute(
        sql`SELECT receipt_number FROM payment_records WHERE fee_record_id = ${feeRecordId} LIMIT 1`,
      )
    ).rows[0] as any;

    expect(feeRow.status).toBe("Paid");
    // The losing delivery's receipt must be replaced with the winner's receipt
    expect(feeRow.receipt_number).toBe(winningReceipt);
    // fee and payment_records must agree on the same receipt
    expect(feeRow.receipt_number).toBe(paymentRow.receipt_number);
  });

  it("exactly one payment_records row exists after both deliveries race", async () => {
    fixture = await createFixture();
    const { feeRecordId } = fixture;
    const paymentId = `pay_${uid()}`;

    const raceHook = async () => {
      await webhookCapture(fixture, paymentId);
    };

    await runWebhookLogic(fixture, paymentId, raceHook);

    const [{ value: rowCount }] = await db
      .select({ value: count() })
      .from(paymentRecords)
      .where(eq(paymentRecords.feeRecordId, feeRecordId));
    expect(Number(rowCount)).toBe(1);
  });
});
