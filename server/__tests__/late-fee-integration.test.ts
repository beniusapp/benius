/**
 * Integration tests: late-fee through acquireRazorpayOrder
 *
 * Verifies:
 *  1. No fee structure → same behaviour as before (zero late fee, amount = base only).
 *  2. Fee structure with FLAT late fee → order amount = base + late fee.
 *  3. lateFeeAmount is returned in the success result.
 *  4. Order notes carry the lateFeeAmount snapshot.
 *  5. Fee structure with DAILY late fee → correct accumulation.
 *  6. Overdue fee (past due date) accumulates late fee; Due fee on due date does not.
 *  7. Paid invoice blocks regardless of late fee config.
 *  8. calculateLateFee returns 0 for Paid status (unit-level guard).
 *
 * All tests call acquireRazorpayOrder() directly with a mock RzpOrdersApi
 * so no HTTP server or real Razorpay credentials are needed.
 * The real database is used for the SELECT … FOR UPDATE behaviour.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "../db";
import {
  schools,
  students,
  academicSessions,
  feeRecords,
  feeStructures,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { acquireRazorpayOrder, type RzpOrdersApi } from "../fees-routes";
import { calculateLateFee, type LateFeeConfig } from "../late-fee-engine";

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface LFFixture {
  schoolId: number;
  studentId: number;
  sessionId: number;
}

async function createSchool(): Promise<LFFixture> {
  const code = `LF-${uid()}`;

  const [school] = await db
    .insert(schools)
    .values({ name: "Late-Fee Test School", code })
    .returning();

  const [student] = await db
    .insert(students)
    .values({
      schoolId: school.id,
      digitalStudentId: `DS-${uid()}`,
      name: "LF Student",
      class: "10",
      section: "B",
      phone: "9199000000",
      dob: "2007-06-01",
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

  return { schoolId: school.id, studentId: student.id, sessionId: session.id };
}

async function teardown(schoolId: number): Promise<void> {
  await db.execute(sql`DELETE FROM fee_audit_log WHERE school_id = ${schoolId}`);
  await db.delete(schools).where(eq(schools.id, schoolId));
}

/** Insert a fee record with a specific due date and status. */
async function insertFee(
  schoolId: number,
  studentId: number,
  sessionId: number,
  opts: { amount?: number; dueDate: string; status?: string; feeType?: string },
): Promise<number> {
  const [fee] = await db
    .insert(feeRecords)
    .values({
      schoolId,
      studentId,
      sessionId,
      feeType: opts.feeType ?? "Tuition",
      amount: opts.amount ?? 5000,
      dueDate: opts.dueDate,
      status: (opts.status ?? "Due") as "Due",
    })
    .returning();
  return fee.id;
}

/** Insert a fee structure with the given late-fee config. */
async function insertFeeStructure(
  schoolId: number,
  feeType: string,
  lateFeeConfig: LateFeeConfig,
): Promise<void> {
  await db.insert(feeStructures).values({
    schoolId,
    name: `${feeType} Fee`,
    feeType,
    amount: 5000,
    lateFeeConfig: lateFeeConfig as any,
  });
}

/** A Razorpay mock that captures the create() call opts and returns the given orderId. */
function capturingApi(orderId: string): {
  api: RzpOrdersApi;
  getCreateOpts: () => Parameters<RzpOrdersApi["create"]>[0] | undefined;
} {
  let captured: Parameters<RzpOrdersApi["create"]>[0] | undefined;
  const api: RzpOrdersApi = {
    fetch: async () => { throw Object.assign(new Error("not found"), { statusCode: 404 }); },
    create: async (opts) => { captured = opts; return { id: orderId }; },
  };
  return { api, getCreateOpts: () => captured };
}

/** Simple create-only mock (no capture needed). */
function okCreate(orderId: string): RzpOrdersApi {
  return {
    fetch: async () => { throw Object.assign(new Error("not found"), { statusCode: 404 }); },
    create: async () => ({ id: orderId }),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let fixture: LFFixture | null = null;

afterEach(async () => {
  if (fixture) {
    await teardown(fixture.schoolId);
    fixture = null;
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("acquireRazorpayOrder — late fee integration", () => {

  it("no fee structure → amount = base only (zero late fee, backward-compat)", async () => {
    fixture = await createSchool();
    const { schoolId, studentId, sessionId } = fixture;

    // Past due but no fee structure registered → late fee = 0
    const dueDate = "2025-01-01"; // far in the past
    const feeId = await insertFee(schoolId, studentId, sessionId, {
      amount: 5000, dueDate, status: "Overdue",
    });

    const result = await acquireRazorpayOrder(feeId, schoolId, okCreate("order_no_struct"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amount).toBe(500_000);     // 5000 × 100 paise, no late fee
    expect(result.lateFeeAmount).toBe(0);
  });

  it("FLAT late fee → order amount = base + flat_amount in paise", async () => {
    fixture = await createSchool();
    const { schoolId, studentId, sessionId } = fixture;

    const flatCfg: LateFeeConfig = {
      enabled: true, type: "FLAT",
      grace_period_days: 0, flat_amount: 200,
      daily_rate: 0, max_cap: 0, tiered_slabs: [],
    };
    await insertFeeStructure(schoolId, "Tuition", flatCfg);

    // Past due → late fee should fire
    const dueDate = "2025-01-01";
    const feeId = await insertFee(schoolId, studentId, sessionId, {
      amount: 5000, dueDate, status: "Overdue",
    });

    const result = await acquireRazorpayOrder(feeId, schoolId, okCreate("order_flat_lf"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lateFeeAmount).toBe(200);
    expect(result.amount).toBe(520_000); // (5000 + 200) × 100 = 520000
  });

  it("lateFeeAmount is included in the Razorpay order notes as a string snapshot", async () => {
    fixture = await createSchool();
    const { schoolId, studentId, sessionId } = fixture;

    const flatCfg: LateFeeConfig = {
      enabled: true, type: "FLAT",
      grace_period_days: 0, flat_amount: 150,
      daily_rate: 0, max_cap: 0, tiered_slabs: [],
    };
    await insertFeeStructure(schoolId, "Exam", flatCfg);

    const dueDate = "2025-01-01";
    const feeId = await insertFee(schoolId, studentId, sessionId, {
      amount: 3000, dueDate, status: "Overdue", feeType: "Exam",
    });

    const { api, getCreateOpts } = capturingApi("order_notes_check");
    const result = await acquireRazorpayOrder(feeId, schoolId, api);

    expect(result.ok).toBe(true);
    const opts = getCreateOpts();
    expect(opts).toBeDefined();
    // Notes must carry the late-fee snapshot the webhook will read back
    expect(opts!.notes.lateFeeAmount).toBe("150");
    expect(opts!.notes.feeRecordId).toBe(String(feeId));
    expect(opts!.notes.schoolId).toBe(String(schoolId));
  });

  it("DAILY late fee → order amount accumulates correctly", async () => {
    fixture = await createSchool();
    const { schoolId, studentId, sessionId } = fixture;

    const dailyCfg: LateFeeConfig = {
      enabled: true, type: "DAILY",
      grace_period_days: 0, flat_amount: 0,
      daily_rate: 10, max_cap: 0, tiered_slabs: [],
    };
    await insertFeeStructure(schoolId, "Transport", dailyCfg);

    // Create a fee overdue by exactly 5 days from now
    const dueDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const feeId = await insertFee(schoolId, studentId, sessionId, {
      amount: 2000, dueDate, status: "Overdue", feeType: "Transport",
    });

    const result = await acquireRazorpayOrder(feeId, schoolId, okCreate("order_daily_lf"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 5 days × ₹10/day = ₹50 late fee
    expect(result.lateFeeAmount).toBe(50);
    expect(result.amount).toBe(205_000); // (2000 + 50) × 100
  });

  it("Due fee on its due date → zero late fee even with a FLAT config", async () => {
    fixture = await createSchool();
    const { schoolId, studentId, sessionId } = fixture;

    const flatCfg: LateFeeConfig = {
      enabled: true, type: "FLAT",
      grace_period_days: 0, flat_amount: 500,
      daily_rate: 0, max_cap: 0, tiered_slabs: [],
    };
    await insertFeeStructure(schoolId, "Tuition", flatCfg);

    // Due date = today → not overdue yet
    const today = new Date().toISOString().slice(0, 10);
    const feeId = await insertFee(schoolId, studentId, sessionId, {
      amount: 4000, dueDate: today, status: "Due",
    });

    const result = await acquireRazorpayOrder(feeId, schoolId, okCreate("order_due_today"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lateFeeAmount).toBe(0);
    expect(result.amount).toBe(400_000); // no late fee
  });

  it("Paid invoice → blocked regardless of late fee config", async () => {
    fixture = await createSchool();
    const { schoolId, studentId, sessionId } = fixture;

    const flatCfg: LateFeeConfig = {
      enabled: true, type: "FLAT",
      grace_period_days: 0, flat_amount: 200,
      daily_rate: 0, max_cap: 0, tiered_slabs: [],
    };
    await insertFeeStructure(schoolId, "Tuition", flatCfg);

    const dueDate = "2025-01-01";
    const feeId = await insertFee(schoolId, studentId, sessionId, {
      amount: 5000, dueDate, status: "Paid",
    });

    const result = await acquireRazorpayOrder(feeId, schoolId, okCreate("order_paid_blocked"));

    // Paid invoice should be blocked — exact error code/message depends on implementation
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("calculateLateFee returns 0 for Paid status (unit guard — Paid invoices never accrue)", () => {
    const cfg: LateFeeConfig = {
      enabled: true, type: "FLAT",
      grace_period_days: 0, flat_amount: 999,
      daily_rate: 0, max_cap: 0, tiered_slabs: [],
    };
    // Regardless of days overdue, a Paid invoice must never show a late fee
    const result = calculateLateFee(cfg, "2025-01-01", "Paid");
    expect(result).toBe(0);
  });

  it("FLAT late fee — case-insensitive fee type matching between structure and fee record", async () => {
    fixture = await createSchool();
    const { schoolId, studentId, sessionId } = fixture;

    // Insert structure with mixed-case fee type
    const flatCfg: LateFeeConfig = {
      enabled: true, type: "FLAT",
      grace_period_days: 0, flat_amount: 300,
      daily_rate: 0, max_cap: 0, tiered_slabs: [],
    };
    await insertFeeStructure(schoolId, "TUITION", flatCfg); // uppercase

    // Fee record uses a different casing
    const dueDate = "2025-01-01";
    const feeId = await insertFee(schoolId, studentId, sessionId, {
      amount: 5000, dueDate, status: "Overdue", feeType: "tuition", // lowercase
    });

    const result = await acquireRazorpayOrder(feeId, schoolId, okCreate("order_case_insensitive"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Case-insensitive match → late fee should still apply
    expect(result.lateFeeAmount).toBe(300);
    expect(result.amount).toBe(530_000);
  });

});
