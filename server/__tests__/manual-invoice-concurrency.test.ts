/**
 * Integration test for the manual Add Invoice duplicate guard.
 *
 * It exercises the same service called by POST /api/admin/fees and the real
 * database advisory lock/sequence transaction. No HTTP server, credentials,
 * or external payment provider is needed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { createManualInvoice, prepareManualInvoiceContext } from "../structure-invoice-service";
import { academicSessions, feeRecords, receiptSequences, schools, students } from "@shared/schema";

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

type Fixture = {
  schoolId: number;
  studentId: number;
};

async function createFixture(): Promise<Fixture> {
  const [school] = await db.insert(schools).values({
    name: "Manual Invoice Concurrency School",
    code: `MIC-${uid()}`,
  }).returning();
  const [student] = await db.insert(students).values({
    schoolId: school.id,
    digitalStudentId: `DS-${uid()}`,
    name: "Manual Invoice Student",
    class: "9",
    section: "A",
    phone: "9100000000",
    dob: "2008-03-15",
    passwordHash: "x",
    isActive: true,
  }).returning();
  await db.insert(academicSessions).values({
    schoolId: school.id,
    sessionName: "2026-27",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    isActive: true,
    status: "active",
    newAdmissionsEnabled: false,
    promotionStrategy: "defer",
  });
  return { schoolId: school.id, studentId: student.id };
}

async function teardown(schoolId: number): Promise<void> {
  await db.delete(receiptSequences).where(eq(receiptSequences.schoolId, schoolId));
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.fee_audit_cleanup', 'on', true)`);
    await tx.execute(sql`DELETE FROM schools WHERE id = ${schoolId}`);
  });
}

describe("manual Add Invoice concurrency", () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("creates one invoice, one sequence number, and one duplicate result for concurrent requests", async () => {
    fixture = await createFixture();
    const context = await prepareManualInvoiceContext({
      schoolId: fixture.schoolId,
      feeName: "Mathematics Book",
      feeType: "Books",
      amount: 450,
      frequency: "one-time",
      feePeriod: "active-session",
      dueDate: "2026-04-15",
      breakdown: [
        { name: "Mathematics Book", purpose: "Required textbook", amount: 400 },
        { name: "Activity Charge", purpose: "Workbook materials", amount: 50 },
      ],
      lateFeeConfig: {
        enabled: true,
        type: "FLAT",
        grace_period_days: 10,
        flat_amount: 50,
        daily_rate: 0,
        max_cap: 0,
        tiered_slabs: [],
      },
    });

    const results = await Promise.all([
      createManualInvoice({ context, studentId: fixture.studentId }),
      createManualInvoice({ context, studentId: fixture.studentId }),
    ]);

    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(results.filter(result => !result.created)).toHaveLength(1);

    const records = await db.select().from(feeRecords).where(eq(feeRecords.schoolId, fixture.schoolId));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      feeName: "Mathematics Book",
      feeType: "Books",
      amount: 450,
      frequency: "one-time",
      dueDate: "2026-04-15",
      status: "Due",
      invoiceNumber: "INV-0001",
      feePeriodStart: "2026-04-01",
      feePeriodEnd: "2027-03-31",
      breakdownSnapshot: [
        { name: "Mathematics Book", purpose: "Required textbook", amount: 400 },
        { name: "Activity Charge", purpose: "Workbook materials", amount: 50 },
      ],
      lateFeeConfig: expect.objectContaining({
        enabled: true,
        type: "FLAT",
        grace_period_days: 10,
        flat_amount: 50,
      }),
    });
    const sequences = await db.select().from(receiptSequences)
      .where(eq(receiptSequences.schoolId, fixture.schoolId));
    expect(sequences).toEqual([expect.objectContaining({
      prefix: "INV-",
      currentNumber: 1,
    })]);
  });
});