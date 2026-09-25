/**
 * Integration tests: Razorpay webhook fallback when notes are incomplete
 *
 * Covers the scenario where a payment.failed (or payment.captured) webhook
 * arrives with notes that are missing feeRecordId and/or studentId — or even
 * schoolId — but the fee_records row was written with razorpay_order_id at
 * order-creation time.  The webhook handler should:
 *
 *  1. Resolve schoolId from fee_records.razorpay_order_id when it is absent
 *     from notes (so HMAC verification can proceed).
 *  2. Resolve feeRecordId and studentId from the same lookup when they are
 *     absent from notes, and write them into the audit log.
 *  3. Log "[context recovered via order_id fallback]" in the description.
 *  4. When the order_id is unknown, leave entity_id / student_id NULL and log
 *     the "no match" warning.
 *
 * These tests exercise the DB-level fallback logic extracted from the handler
 * directly — same approach used in razorpay-webhook-verify-race.test.ts.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "../db";
import { schools, students, academicSessions, feeRecords } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ── helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface Fixture {
  schoolId: number;
  studentId: number;
  feeRecordId: number;
  orderId: string;
}

async function createFixture(): Promise<Fixture> {
  const code = `MN-${uid()}`;
  const orderId = `order_${uid()}`;

  const [school] = await db
    .insert(schools)
    .values({ name: "Missing Notes Test School", code })
    .returning();

  const [student] = await db
    .insert(students)
    .values({
      schoolId: school.id,
      digitalStudentId: `DS-${uid()}`,
      name: "Notes Test Student",
      class: "9",
      section: "A",
      phone: "9900000001",
      dob: "2008-03-10",
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
      amount: 5000,
      dueDate: "2025-09-30",
      status: "Due",
      razorpayOrderId: orderId,
    } as any)
    .returning();

  return {
    schoolId: school.id,
    studentId: student.id,
    feeRecordId: feeRecord.id,
    orderId,
  };
}

async function teardown(schoolId: number): Promise<void> {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.fee_audit_cleanup', 'on', true)`);
    await tx.execute(sql`DELETE FROM schools WHERE id = ${schoolId}`);
  });
}

/**
 * Mirrors the order_id → schoolId fallback in the webhook handler.
 * Returns null when the order_id is unknown.
 */
async function resolveSchoolFromOrderId(orderId: string): Promise<number | null> {
  const row = (
    await db.execute(sql`
      SELECT school_id FROM fee_records
      WHERE razorpay_order_id = ${orderId}
      LIMIT 1
    `)
  ).rows[0] as any;
  return row ? Number(row.school_id) : null;
}

/**
 * Mirrors the order_id → fee/student fallback in the payment.failed branch.
 * Returns null when the order_id is unknown.
 */
async function resolveFeeContextFromOrderId(
  schoolId: number,
  orderId: string,
): Promise<{ feeRecordId: number; studentId: number } | null> {
  const row = (
    await db.execute(sql`
      SELECT id, student_id FROM fee_records
      WHERE school_id = ${schoolId} AND razorpay_order_id = ${orderId}
      LIMIT 1
    `)
  ).rows[0] as any;
  return row
    ? { feeRecordId: Number(row.id), studentId: Number(row.student_id) }
    : null;
}

/**
 * Simulate the audit INSERT the payment.failed handler performs, then return
 * the inserted row so tests can assert on it.
 */
async function insertFailedAuditLog(
  schoolId: number,
  feeRecordId: number | null,
  studentId: number | null,
  paymentId: string,
  fallbackUsed: boolean,
  fallbackFailed: boolean,
): Promise<any> {
  const description =
    `Razorpay payment failed — CARD_DECLINED: Insufficient funds (${paymentId})` +
    (fallbackUsed ? " [context recovered via order_id fallback]" : "") +
    (!feeRecordId && !fallbackUsed && fallbackFailed
      ? " [incomplete notes — student/fee could not be identified]"
      : "");

  const now = new Date().toISOString();
  await db.execute(sql`
    INSERT INTO fee_audit_log
      (school_id, action, entity_type, entity_id, actor_id, actor_name, student_id, description, created_at)
    VALUES
      (${schoolId}, 'payment_failed', 'fee_record',
       ${feeRecordId ?? null}, NULL, 'Razorpay Webhook',
       ${studentId ?? null}, ${description}, ${now})
  `);

  const row = (
    await db.execute(sql`
      SELECT * FROM fee_audit_log
      WHERE school_id = ${schoolId} AND action = 'payment_failed'
      ORDER BY created_at DESC LIMIT 1
    `)
  ).rows[0] as any;
  return row;
}

/**
 * Mirrors the cross-tenant ownership check in create-order:
 *   Number(fee.school_id) !== schoolId  →  403
 * Returns true when the fee belongs to the given school (allowed),
 * false when it belongs to a different school (blocked).
 */
function isFeeOwnedBySchool(fee: { school_id: number }, schoolId: number): boolean {
  return Number(fee.school_id) === schoolId;
}

/**
 * Mirrors the scoped UPDATE:
 *   WHERE id = feeRecordId AND school_id = schoolId
 * Returns the number of rows that would be updated (0 or 1).
 */
async function scopedOrderIdUpdate(
  feeRecordId: number,
  schoolId: number,
  orderId: string,
): Promise<number> {
  const result = await db.execute(sql`
    UPDATE fee_records
    SET razorpay_order_id = ${orderId}
    WHERE id = ${feeRecordId} AND school_id = ${schoolId}
  `);
  return result.rowCount ?? 0;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("create-order cross-tenant isolation: admin cannot write order_id to another school's fee", () => {
  let schoolA: Fixture;
  let schoolB: Fixture;

  afterEach(async () => {
    if (schoolA) await teardown(schoolA.schoolId);
    if (schoolB) await teardown(schoolB.schoolId);
  });

  it("ownership check passes when fee belongs to the authenticated school", async () => {
    schoolA = await createFixture();
    const feeRow = { school_id: schoolA.schoolId };
    expect(isFeeOwnedBySchool(feeRow, schoolA.schoolId)).toBe(true);
  });

  it("ownership check fails when fee belongs to a different school", async () => {
    schoolA = await createFixture();
    schoolB = await createFixture();
    const feeRow = { school_id: schoolA.schoolId };
    // School B admin tries to create an order for School A's fee
    expect(isFeeOwnedBySchool(feeRow, schoolB.schoolId)).toBe(false);
  });

  it("scoped UPDATE writes order_id when school matches", async () => {
    schoolA = await createFixture();
    const newOrderId = `order_${uid()}`;
    const updated = await scopedOrderIdUpdate(schoolA.feeRecordId, schoolA.schoolId, newOrderId);
    expect(updated).toBe(1);

    // Confirm the value was actually written
    const row = (
      await db.execute(sql`
        SELECT razorpay_order_id FROM fee_records WHERE id = ${schoolA.feeRecordId}
      `)
    ).rows[0] as any;
    expect(row.razorpay_order_id).toBe(newOrderId);
  });

  it("scoped UPDATE writes zero rows when school does not match (cross-tenant blocked)", async () => {
    schoolA = await createFixture();
    schoolB = await createFixture();
    const attackerOrderId = `order_ATTACKER_${uid()}`;

    // School B admin attempts to overwrite School A's fee record with their order_id
    const updated = await scopedOrderIdUpdate(
      schoolA.feeRecordId,
      schoolB.schoolId, // wrong school
      attackerOrderId,
    );
    expect(updated).toBe(0);

    // Confirm School A's fee record was NOT corrupted
    const row = (
      await db.execute(sql`
        SELECT razorpay_order_id FROM fee_records WHERE id = ${schoolA.feeRecordId}
      `)
    ).rows[0] as any;
    expect(row.razorpay_order_id).not.toBe(attackerOrderId);
  });
});

describe("Webhook fallback: resolve schoolId from order_id when absent from notes", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("finds the school when order_id matches a fee_records row", async () => {
    fixture = await createFixture();
    const resolved = await resolveSchoolFromOrderId(fixture.orderId);
    expect(resolved).toBe(fixture.schoolId);
  });

  it("returns null for an unknown order_id", async () => {
    fixture = await createFixture();
    const resolved = await resolveSchoolFromOrderId("order_UNKNOWN_XYZ");
    expect(resolved).toBeNull();
  });
});

describe("Webhook fallback: resolve feeRecordId and studentId from order_id", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("recovers the correct feeRecordId and studentId", async () => {
    fixture = await createFixture();
    const ctx = await resolveFeeContextFromOrderId(fixture.schoolId, fixture.orderId);
    expect(ctx).not.toBeNull();
    expect(ctx!.feeRecordId).toBe(fixture.feeRecordId);
    expect(ctx!.studentId).toBe(fixture.studentId);
  });

  it("returns null when order_id belongs to a different school", async () => {
    fixture = await createFixture();
    const ctx = await resolveFeeContextFromOrderId(fixture.schoolId + 9999, fixture.orderId);
    expect(ctx).toBeNull();
  });

  it("returns null for an unknown order_id", async () => {
    fixture = await createFixture();
    const ctx = await resolveFeeContextFromOrderId(fixture.schoolId, "order_UNKNOWN");
    expect(ctx).toBeNull();
  });
});

describe("Webhook fallback: audit log attribution after missing-notes recovery", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("audit row carries correct entity_id and student_id when fallback succeeds", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    // Simulate: notes = {} (nothing), but order_id is present → fallback resolves context
    const ctx = await resolveFeeContextFromOrderId(fixture.schoolId, fixture.orderId);
    expect(ctx).not.toBeNull();

    const row = await insertFailedAuditLog(
      fixture.schoolId,
      ctx!.feeRecordId,
      ctx!.studentId,
      paymentId,
      /* fallbackUsed */ true,
      /* fallbackFailed */ false,
    );

    expect(Number(row.entity_id)).toBe(fixture.feeRecordId);
    expect(Number(row.student_id)).toBe(fixture.studentId);
    expect(row.description).toContain("[context recovered via order_id fallback]");
  });

  it("audit row has NULL entity_id and student_id when order_id is also unknown", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    // Simulate: notes = {} and payment.order_id is unknown → both lookups fail
    const ctx = await resolveFeeContextFromOrderId(fixture.schoolId, "order_TOTALLY_UNKNOWN");
    expect(ctx).toBeNull();

    const row = await insertFailedAuditLog(
      fixture.schoolId,
      null,
      null,
      paymentId,
      /* fallbackUsed */ false,
      /* fallbackFailed */ true,
    );

    expect(row.entity_id).toBeNull();
    expect(row.student_id).toBeNull();
    expect(row.description).toContain("[incomplete notes — student/fee could not be identified]");
  });

  it("audit row does NOT carry the fallback tag when notes were complete", async () => {
    fixture = await createFixture();
    const paymentId = `pay_${uid()}`;

    // Simulate: notes were complete — no fallback needed
    const row = await insertFailedAuditLog(
      fixture.schoolId,
      fixture.feeRecordId,
      fixture.studentId,
      paymentId,
      /* fallbackUsed */ false,
      /* fallbackFailed */ false,
    );

    expect(Number(row.entity_id)).toBe(fixture.feeRecordId);
    expect(Number(row.student_id)).toBe(fixture.studentId);
    expect(row.description).not.toContain("fallback");
    expect(row.description).not.toContain("incomplete notes");
  });
});
