/**
 * Integration tests: Razorpay create-order concurrency guard
 *
 * Scenarios covered:
 *
 *  1. No existing order → succeeds, persists razorpay_order_id + razorpay_order_expires_at.
 *  2. Existing "created" order + future razorpay_order_expires_at → 409.
 *  3. Existing "attempted" order (any deadline) → 409 — payment may still be settling.
 *  4. Existing "expired" order (Razorpay-authoritative) → succeeds.
 *  5. Existing "created" + past razorpay_order_expires_at → succeeds (checkout window elapsed).
 *  6. Existing "created" + NULL deadline + recent order.created_at → 409 (legacy fallback).
 *  7. Existing "created" + NULL deadline + old order.created_at → succeeds (legacy fallback).
 *  8. Existing "attempted" + elapsed deadline → 409 (never released by local deadline).
 *  9. Razorpay fetch error → 503 ORDER_STATUS_UNKNOWN; no duplicate order.
 * 10. Two concurrent calls → exactly ONE succeeds, one 409.
 * 11. Concurrent loser's fetch fails → 503, not a second order.
 *
 * All tests call acquireRazorpayOrder() directly with a mock RzpOrdersApi so
 * no HTTP server or real Razorpay credentials are required.  The real database
 * is used for the SELECT … FOR UPDATE locking behaviour.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "../db";
import {
  schools,
  students,
  academicSessions,
  feeRecords,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { acquireRazorpayOrder, type RzpOrdersApi } from "../fees-routes";

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface Fixture {
  schoolId: number;
  studentId: number;
  sessionId: number;
  feeRecordId: number;
}

async function createFixture(amount = 8000): Promise<Fixture> {
  const code = `COC-${uid()}`;

  const [school] = await db
    .insert(schools)
    .values({ name: "Concurrency Test School", code })
    .returning();

  const [student] = await db
    .insert(students)
    .values({
      schoolId: school.id,
      digitalStudentId: `DS-${uid()}`,
      name: "Concurrency Student",
      class: "9",
      section: "A",
      phone: "9100000000",
      dob: "2008-03-15",
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

  const [fee] = await db
    .insert(feeRecords)
    .values({
      schoolId: school.id,
      studentId: student.id,
      sessionId: session.id,
      feeType: "Tuition",
      amount,
      dueDate: "2025-08-31",
      status: "Due",
    })
    .returning();

  return {
    schoolId: school.id,
    studentId: student.id,
    sessionId: session.id,
    feeRecordId: fee.id,
  };
}

async function teardown(schoolId: number): Promise<void> {
  await db.execute(sql`DELETE FROM fee_audit_log WHERE school_id = ${schoolId}`);
  await db.delete(schools).where(eq(schools.id, schoolId));
}

/** Read the razorpay_order_id stored on the given fee record. */
async function storedOrderId(feeRecordId: number): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT razorpay_order_id FROM fee_records WHERE id = ${feeRecordId}
  `);
  return (rows.rows[0] as any)?.razorpay_order_id ?? null;
}

// ── Fake Razorpay helpers ─────────────────────────────────────────────────────

function okCreate(orderId: string, delayMs = 0): RzpOrdersApi {
  return {
    fetch: async () => { throw Object.assign(new Error("not found"), { statusCode: 404 }); },
    create: async () => {
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      return { id: orderId };
    },
  };
}

function existingOrderApi(orderId: string, existingStatus: string): RzpOrdersApi {
  return {
    fetch: async (id: string) => {
      if (id === orderId) return { status: existingStatus };
      throw Object.assign(new Error("not found"), { statusCode: 404 });
    },
    create: async () => { throw new Error("create should not be called"); },
  };
}

/** Seed razorpay_order_expires_at on a fee record (ISO string). */
async function setOrderExpiresAt(feeRecordId: number, isoDate: string): Promise<void> {
  await db.execute(sql`
    UPDATE fee_records SET razorpay_order_expires_at = ${isoDate}::timestamptz
    WHERE id = ${feeRecordId}
  `);
}

/** Read razorpay_order_expires_at from a fee record (returns null if not set). */
async function storedExpiresAt(feeRecordId: number): Promise<Date | null> {
  const rows = await db.execute(sql`
    SELECT razorpay_order_expires_at FROM fee_records WHERE id = ${feeRecordId}
  `);
  const raw = (rows.rows[0] as any)?.razorpay_order_expires_at;
  return raw ? new Date(raw) : null;
}

/** Returns an ISO timestamp offset from now by offsetMs milliseconds. */
function nowPlusMs(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("acquireRazorpayOrder: basic paths", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("creates a new order and persists razorpay_order_id when no order exists", async () => {
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    const result = await acquireRazorpayOrder(
      feeRecordId,
      schoolId,
      okCreate("order_new_001"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.orderId).toBe("order_new_001");
    expect(result.amount).toBe(800000); // 8000 rupees → 800000 paise

    // Order ID must be persisted in the DB
    expect(await storedOrderId(feeRecordId)).toBe("order_new_001");
  });

  it("returns 409 PAYMENT_IN_PROGRESS when existing order is 'created'", async () => {
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    // Seed an existing open order on the fee record
    await db.execute(sql`
      UPDATE fee_records SET razorpay_order_id = 'order_open_001'
      WHERE id = ${feeRecordId}
    `);

    const result = await acquireRazorpayOrder(
      feeRecordId,
      schoolId,
      existingOrderApi("order_open_001", "created"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect((result as any).code).toBe("PAYMENT_IN_PROGRESS");
    expect(result.message).toMatch(/payment window is already open/i);
  });

  it("returns 409 PAYMENT_IN_PROGRESS when existing order is 'attempted'", async () => {
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    await db.execute(sql`
      UPDATE fee_records SET razorpay_order_id = 'order_attempted_001'
      WHERE id = ${feeRecordId}
    `);

    const result = await acquireRazorpayOrder(
      feeRecordId,
      schoolId,
      existingOrderApi("order_attempted_001", "attempted"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect((result as any).code).toBe("PAYMENT_IN_PROGRESS");
  });

  it("creates a new order when the existing order is 'expired'", async () => {
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    await db.execute(sql`
      UPDATE fee_records SET razorpay_order_id = 'order_expired_001'
      WHERE id = ${feeRecordId}
    `);

    // expired → fetch returns "expired" but create is allowed
    const api: RzpOrdersApi = {
      fetch: async () => ({ status: "expired" }),
      create: async () => ({ id: "order_fresh_001" }),
    };

    const result = await acquireRazorpayOrder(feeRecordId, schoolId, api);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orderId).toBe("order_fresh_001");
    // New order_id must be persisted
    expect(await storedOrderId(feeRecordId)).toBe("order_fresh_001");
  });

  it("creates a new order when 'created' order's checkout window has elapsed (razorpay_order_expires_at in the past)", async () => {
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    // Seed a stale order and a deadline that has already passed (5 minutes ago).
    // Razorpay still reports "created" because it does not update the status
    // immediately when the client checkout modal times out.
    await db.execute(sql`
      UPDATE fee_records SET razorpay_order_id = 'order_stale_created_001'
      WHERE id = ${feeRecordId}
    `);
    await setOrderExpiresAt(feeRecordId, nowPlusMs(-5 * 60 * 1000));

    const api: RzpOrdersApi = {
      fetch: async () => ({ status: "created" }),
      create: async () => ({ id: "order_fresh_after_window_elapsed_001" }),
    };

    const result = await acquireRazorpayOrder(feeRecordId, schoolId, api);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orderId).toBe("order_fresh_after_window_elapsed_001");
    // New order ID and a fresh deadline must be persisted
    expect(await storedOrderId(feeRecordId)).toBe("order_fresh_after_window_elapsed_001");
    const newExpiry = await storedExpiresAt(feeRecordId);
    expect(newExpiry).not.toBeNull();
    expect(newExpiry!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 409 when 'attempted' order's checkout window has elapsed — payment may still be settling", async () => {
    // An "attempted" order means a payment form was submitted; Razorpay may
    // still capture / webhook even after the client modal closes.  A local
    // deadline is not authoritative proof of failure, so the server must keep
    // blocking until Razorpay reports a terminal status.
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    await db.execute(sql`
      UPDATE fee_records SET razorpay_order_id = 'order_attempted_past_deadline_001'
      WHERE id = ${feeRecordId}
    `);
    // Deadline elapsed 5 minutes ago — but status is still "attempted"
    await setOrderExpiresAt(feeRecordId, nowPlusMs(-5 * 60 * 1000));

    let createCalled = false;
    const api: RzpOrdersApi = {
      fetch: async () => ({ status: "attempted" }),
      create: async () => { createCalled = true; return { id: "should_not_be_created" }; },
    };

    const result = await acquireRazorpayOrder(feeRecordId, schoolId, api);

    // Must block — do not create a second order while a capture may be pending
    expect(createCalled).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect((result as any).code).toBe("PAYMENT_IN_PROGRESS");
  });

  it("returns 409 when 'created' order has a future razorpay_order_expires_at (checkout still open)", async () => {
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    await db.execute(sql`
      UPDATE fee_records SET razorpay_order_id = 'order_still_live_001'
      WHERE id = ${feeRecordId}
    `);
    // Deadline is 10 minutes in the future — checkout window still open
    await setOrderExpiresAt(feeRecordId, nowPlusMs(10 * 60 * 1000));

    const result = await acquireRazorpayOrder(
      feeRecordId,
      schoolId,
      existingOrderApi("order_still_live_001", "created"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect((result as any).code).toBe("PAYMENT_IN_PROGRESS");
  });

  it("returns 409 for legacy 'created' order with NULL deadline when created_at is recent (window still open)", async () => {
    // Legacy rows pre-dating razorpay_order_expires_at fall back to the order's
    // created_at Unix timestamp from Razorpay.  A recently-created order still
    // has an active checkout window and must not be replaced.
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    await db.execute(sql`
      UPDATE fee_records
      SET razorpay_order_id = 'order_legacy_recent_001', razorpay_order_expires_at = NULL
      WHERE id = ${feeRecordId}
    `);

    // created_at is 60 seconds ago — well within the 600 s checkout window
    const recentCreatedAt = Math.floor(Date.now() / 1000) - 60;
    const api: RzpOrdersApi = {
      fetch: async () => ({ status: "created", created_at: recentCreatedAt }),
      create: async () => { throw new Error("create should not be called"); },
    };

    const result = await acquireRazorpayOrder(feeRecordId, schoolId, api);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect((result as any).code).toBe("PAYMENT_IN_PROGRESS");
  });

  it("creates a new order for legacy 'created' order with NULL deadline when created_at is old (window elapsed)", async () => {
    // Legacy rows pre-dating razorpay_order_expires_at fall back to the order's
    // created_at Unix timestamp from Razorpay.  An order older than
    // CHECKOUT_TIMEOUT_SECONDS (600 s) can no longer have an active checkout
    // window, so it is safe to create a replacement.
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    await db.execute(sql`
      UPDATE fee_records
      SET razorpay_order_id = 'order_legacy_old_001', razorpay_order_expires_at = NULL
      WHERE id = ${feeRecordId}
    `);

    // created_at is 20 minutes ago — well past the 600 s checkout window
    const staleCreatedAt = Math.floor(Date.now() / 1000) - 20 * 60;
    const api: RzpOrdersApi = {
      fetch: async () => ({ status: "created", created_at: staleCreatedAt }),
      create: async () => ({ id: "order_fresh_after_legacy_expiry_001" }),
    };

    const result = await acquireRazorpayOrder(feeRecordId, schoolId, api);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orderId).toBe("order_fresh_after_legacy_expiry_001");
    // New order ID and a deadline must be persisted
    expect(await storedOrderId(feeRecordId)).toBe("order_fresh_after_legacy_expiry_001");
    const newExpiry = await storedExpiresAt(feeRecordId);
    expect(newExpiry).not.toBeNull();
    expect(newExpiry!.getTime()).toBeGreaterThan(Date.now());
  });

  it("persists razorpay_order_expires_at in the future when a new order is created", async () => {
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    const before = Date.now();
    const result = await acquireRazorpayOrder(feeRecordId, schoolId, okCreate("order_deadline_check_001"));

    expect(result.ok).toBe(true);
    const expiresAt = await storedExpiresAt(feeRecordId);
    expect(expiresAt).not.toBeNull();
    // Deadline must be in the future and at least CHECKOUT_TIMEOUT_SECONDS (600) seconds ahead
    expect(expiresAt!.getTime()).toBeGreaterThan(before + 599_000);
  });

  it("returns 503 ORDER_STATUS_UNKNOWN when Razorpay fetch fails — does NOT create a duplicate order", async () => {
    fixture = await createFixture();
    const { feeRecordId, schoolId } = fixture;

    // Seed an existing order_id on the fee record (as if a prior request persisted one)
    await db.execute(sql`
      UPDATE fee_records SET razorpay_order_id = 'order_unknown_001'
      WHERE id = ${feeRecordId}
    `);

    let createCalled = false;

    // Fetch throws a transient error (timeout, 5xx, network blip, etc.)
    const api: RzpOrdersApi = {
      fetch: async () => { throw new Error("connect ETIMEDOUT"); },
      create: async () => {
        createCalled = true;
        return { id: "order_should_not_be_created" };
      },
    };

    const result = await acquireRazorpayOrder(feeRecordId, schoolId, api);

    // Must NOT create a second order — state is unknown
    expect(createCalled).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(503);
    expect((result as any).code).toBe("ORDER_STATUS_UNKNOWN");
    expect(result.message).toMatch(/try again/i);

    // The original order_id must still be in the DB (not overwritten)
    expect(await storedOrderId(feeRecordId)).toBe("order_unknown_001");
  });
});

describe("acquireRazorpayOrder: concurrent calls for the same fee", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("serialises two simultaneous calls: one succeeds, one returns 409, Razorpay create is called exactly once", async () => {
    fixture = await createFixture(5000);
    const { feeRecordId, schoolId } = fixture;

    // Track calls to the Razorpay API
    let createCalls = 0;
    let fetchCalls = 0;

    // The create mock has a small delay so the second concurrent request
    // reaches the SELECT … FOR UPDATE while the first is still inside its
    // transaction.  The DB lock serialises them: the loser blocks until the
    // winner commits (persisting the order_id), then reads the order_id and
    // calls fetch(), which returns "created" → 409.
    const api: RzpOrdersApi = {
      fetch: async (orderId: string) => {
        fetchCalls++;
        if (orderId === "order_race_001") return { status: "created" };
        throw Object.assign(new Error("not found"), { statusCode: 404 });
      },
      create: async () => {
        createCalls++;
        // Yield so the second concurrent request can start its transaction
        // and block on the FOR UPDATE lock while we're inside ours.
        await new Promise(r => setTimeout(r, 40));
        return { id: "order_race_001" };
      },
    };

    const [r1, r2] = await Promise.all([
      acquireRazorpayOrder(feeRecordId, schoolId, api),
      acquireRazorpayOrder(feeRecordId, schoolId, api),
    ]);

    const results = [r1, r2];
    const successes = results.filter(r => r.ok);
    const conflicts = results.filter(r => !r.ok && r.status === 409);

    // Exactly one order created, exactly one request blocked
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    // Razorpay create was called only once — no duplicate order
    expect(createCalls).toBe(1);

    // Razorpay fetch was called once (by the losing request checking the
    // order_id the winner persisted)
    expect(fetchCalls).toBe(1);

    // The 409 carries the correct code
    const conflict = conflicts[0] as Extract<typeof conflicts[0], { ok: false }>;
    expect((conflict as any).code).toBe("PAYMENT_IN_PROGRESS");

    // The persisted order_id must be the one the winner created
    expect(await storedOrderId(feeRecordId)).toBe("order_race_001");
  });

  it("returns 503 (not a new order) when the concurrent loser's Razorpay fetch fails", async () => {
    fixture = await createFixture(3000);
    const { feeRecordId, schoolId } = fixture;

    let createCalls = 0;

    // The winner's create succeeds and persists "order_fetchfail_001".
    // The loser then calls fetch() for that order_id, but fetch throws a
    // transient error.  The loser must return 503 — not call create() again.
    const api: RzpOrdersApi = {
      fetch: async () => {
        // Simulate a transient Razorpay error when the loser checks the order
        throw new Error("connect ECONNRESET");
      },
      create: async () => {
        createCalls++;
        // Delay so both concurrent requests start their transactions before
        // the first one commits.
        await new Promise(r => setTimeout(r, 40));
        return { id: "order_fetchfail_001" };
      },
    };

    const [r1, r2] = await Promise.all([
      acquireRazorpayOrder(feeRecordId, schoolId, api),
      acquireRazorpayOrder(feeRecordId, schoolId, api),
    ]);

    const results = [r1, r2];
    const successes = results.filter(r => r.ok);
    const unknowns  = results.filter(r => !r.ok && r.status === 503);

    // Exactly one succeeds, one returns 503 ORDER_STATUS_UNKNOWN
    expect(successes).toHaveLength(1);
    expect(unknowns).toHaveLength(1);

    // Razorpay create must be called exactly once — no duplicate order
    expect(createCalls).toBe(1);

    // The unknown-status response must carry the right code
    const unknown = unknowns[0] as Extract<typeof unknowns[0], { ok: false }>;
    expect((unknown as any).code).toBe("ORDER_STATUS_UNKNOWN");

    // The persisted order_id must be the winner's
    expect(await storedOrderId(feeRecordId)).toBe("order_fetchfail_001");
  });
});
