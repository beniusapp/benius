import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import {
  isValidOfflineCorrectionDate,
  normalizeOptionalOfflineCorrectionDate,
  offlinePaymentEntryDefaults,
  offlinePaymentDetailRows,
} from "../../shared/offline-payment-details";
import * as schema from "../../shared/schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

describe("offlinePaymentDetailRows", () => {
  it("uses named bank-transfer fields instead of a generic reference label", () => {
    expect(offlinePaymentDetailRows("BankTransfer", {
      transferMode: "NEFT",
      transactionReference: "BANK-REF-7",
      receivingBank: "HDFC Bank",
    }, {
      referenceNumber: "UTR123456",
      instrumentDate: "2026-08-20",
      bankName: "SBI",
      payerName: "Parent Name",
    })).toEqual([
      { label: "UTR number", value: "UTR123456" },
      { label: "Transaction reference", value: "BANK-REF-7" },
      { label: "Transfer mode", value: "NEFT" },
      { label: "Transfer date", value: "2026-08-20" },
      { label: "Payer / sender", value: "Parent Name" },
      { label: "Payer bank", value: "SBI" },
      { label: "Receiving bank", value: "HDFC Bank" },
    ]);
  });

  it("shows persisted cash context only and never fabricates a reference", () => {
    expect(offlinePaymentDetailRows("Cash", { collectionLocation: "Main counter" }, {
      referenceNumber: "should-not-render",
    })).toEqual([{ label: "Collection location", value: "Main counter" }]);
  });

  it("keeps a historical generic method readable without inventing values", () => {
    expect(offlinePaymentDetailRows("LegacyOffline", null, {
      referenceNumber: null,
    })).toEqual([]);
  });

  it("normalizes blank optional correction dates to null while rejecting impossible dates", () => {
    expect(normalizeOptionalOfflineCorrectionDate("")).toBeNull();
    expect(normalizeOptionalOfflineCorrectionDate(undefined)).toBeUndefined();
    expect(isValidOfflineCorrectionDate("2026-08-20")).toBe(true);
    expect(isValidOfflineCorrectionDate("2026-02-30")).toBe(false);
    expect(isValidOfflineCorrectionDate("20/08/2026")).toBe(false);
  });

  it("matches every default shown by the new-payment form with a persisted value", () => {
    expect(offlinePaymentEntryDefaults("Cash")).toEqual({ instrumentStatus: null, transferMode: null });
    expect(offlinePaymentEntryDefaults("UpiQr")).toEqual({ instrumentStatus: "Verified", transferMode: null });
    expect(offlinePaymentEntryDefaults("BankTransfer")).toEqual({ instrumentStatus: null, transferMode: "NEFT" });
    expect(offlinePaymentEntryDefaults("Cheque")).toEqual({ instrumentStatus: "Received", transferMode: null });
    expect(offlinePaymentEntryDefaults("DemandDraft")).toEqual({ instrumentStatus: "Received", transferMode: null });
  });
});

describe("offline payment detail persistence", () => {
  const createdSchoolIds: number[] = [];
  let schoolAId: number;
  let schoolBId: number;
  let paymentId: number;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const [schoolA, schoolB] = await db.insert(schema.schools).values([
      { name: `Offline Detail A ${suffix}`, code: `ODA${suffix.slice(-5)}`, address: "A Street", phone: "1000000000", email: `a-${suffix}@test.com`, subdomain: `oda-${suffix}` },
      { name: `Offline Detail B ${suffix}`, code: `ODB${suffix.slice(-5)}`, address: "B Street", phone: "2000000000", email: `b-${suffix}@test.com`, subdomain: `odb-${suffix}` },
    ]).returning();
    schoolAId = schoolA.id;
    schoolBId = schoolB.id;
    createdSchoolIds.push(schoolAId, schoolBId);
    const [student] = await db.insert(schema.students).values({
      schoolId: schoolAId, name: "Offline Detail Student", class: "10", section: "A",
      digitalStudentId: `ODS-${suffix}`, phone: "9999999999", dob: "2010-01-01",
      passwordHash: "test-hash", isActive: true,
    }).returning();
    const [payment] = await db.insert(schema.paymentRecords).values({
      schoolId: schoolAId, studentId: student.id, paymentMethod: "Cheque",
      receivedDate: "2026-08-20", amount: 2000, receiptNumber: `OD${Date.now().toString().slice(-8)}`,
      idempotencyKey: `offline-details-${suffix}`, lateFeePaid: 0,
    }).returning();
    paymentId = payment.id;
    await db.insert(schema.offlinePaymentDetails).values({
      schoolId: schoolAId, paymentRecordId: paymentId, instrumentStatus: "Received",
      collectionLocation: "Fee Counter",
    });
    await db.insert(schema.offlinePaymentDetailRevisions).values({
      schoolId: schoolAId, paymentRecordId: paymentId, reason: "Cheque cleared after bank confirmation",
      previousValues: { instrumentStatus: "Received" },
      newValues: { instrumentStatus: "Cleared" },
    });
  });

  afterAll(async () => {
    for (const schoolId of createdSchoolIds) {
      await db.delete(schema.schools).where(eq(schema.schools.id, schoolId));
    }
    await pool.end();
  });

  it("does not expose another school's detail row when both tenant and payment ID are required", async () => {
    const sameTenant = await db.select().from(schema.offlinePaymentDetails).where(and(
      eq(schema.offlinePaymentDetails.schoolId, schoolAId),
      eq(schema.offlinePaymentDetails.paymentRecordId, paymentId),
    ));
    const otherTenant = await db.select().from(schema.offlinePaymentDetails).where(and(
      eq(schema.offlinePaymentDetails.schoolId, schoolBId),
      eq(schema.offlinePaymentDetails.paymentRecordId, paymentId),
    ));
    expect(sameTenant).toHaveLength(1);
    expect(otherTenant).toHaveLength(0);
  });

  it("preserves immutable before-and-after snapshots for an offline-detail correction", async () => {
    const revisions = await db.select().from(schema.offlinePaymentDetailRevisions).where(and(
      eq(schema.offlinePaymentDetailRevisions.schoolId, schoolAId),
      eq(schema.offlinePaymentDetailRevisions.paymentRecordId, paymentId),
    ));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      reason: "Cheque cleared after bank confirmation",
      previousValues: { instrumentStatus: "Received" },
      newValues: { instrumentStatus: "Cleared" },
    });
  });

  it("accepts blank optional cheque and demand-draft correction dates as explicit clears", async () => {
    // These are the exact normalized values the PATCH schema writes for the
    // date inputs when an administrator leaves Deposit/Return Date blank.
    const chequePatch = {
      depositDate: normalizeOptionalOfflineCorrectionDate(""),
      returnDate: normalizeOptionalOfflineCorrectionDate(""),
    };
    const demandDraftPatch = {
      depositDate: normalizeOptionalOfflineCorrectionDate(""),
      returnDate: normalizeOptionalOfflineCorrectionDate(""),
    };
    expect(chequePatch).toEqual({ depositDate: null, returnDate: null });
    expect(demandDraftPatch).toEqual({ depositDate: null, returnDate: null });

    // PostgreSQL DATE columns accept these explicit NULL values. This mirrors
    // the detail upsert in the correction endpoint and would fail if "" leaked
    // through from the browser form.
    await db.update(schema.offlinePaymentDetails).set({
      instrumentStatus: "Cleared",
      depositDate: chequePatch.depositDate,
      returnDate: chequePatch.returnDate,
    }).where(and(
      eq(schema.offlinePaymentDetails.schoolId, schoolAId),
      eq(schema.offlinePaymentDetails.paymentRecordId, paymentId),
    ));
    await db.insert(schema.offlinePaymentDetailRevisions).values({
      schoolId: schoolAId,
      paymentRecordId: paymentId,
      reason: "Cleared blank optional dates during cheque correction",
      previousValues: { depositDate: null, returnDate: null },
      newValues: chequePatch,
    });

    const [detail] = await db.select().from(schema.offlinePaymentDetails).where(and(
      eq(schema.offlinePaymentDetails.schoolId, schoolAId),
      eq(schema.offlinePaymentDetails.paymentRecordId, paymentId),
    ));
    const revisions = await db.select().from(schema.offlinePaymentDetailRevisions).where(and(
      eq(schema.offlinePaymentDetailRevisions.schoolId, schoolAId),
      eq(schema.offlinePaymentDetailRevisions.paymentRecordId, paymentId),
    ));
    expect(detail.depositDate).toBeNull();
    expect(detail.returnDate).toBeNull();
    expect(revisions).toHaveLength(2);
    expect(revisions[1].newValues).toEqual(demandDraftPatch);
  });
});