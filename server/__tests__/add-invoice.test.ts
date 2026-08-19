import { describe, expect, it } from "vitest";
import { z } from "zod";

// Mirrors the narrow POST /api/admin/fees request contract. Canonical invoice
// fields are intentionally absent because the server derives them from the fee
// structure and active academic session.
const addInvoiceBodySchema = z.object({
  studentId: z.number().int().positive(),
  feeStructureId: z.number().int().positive("Fee name is required"),
  feePeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  feePeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().optional().nullable(),
}).superRefine((value, context) => {
  if (!!value.feePeriodStart !== !!value.feePeriodEnd) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fee period start and end must be provided together",
      path: ["feePeriodEnd"],
    });
  } else if (
    value.feePeriodStart
    && value.feePeriodEnd
    && value.feePeriodEnd < value.feePeriodStart
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fee period end must be on or after start",
      path: ["feePeriodEnd"],
    });
  }
});

const validPayload = {
  studentId: 11,
  feeStructureId: 7,
  feePeriodStart: "2026-08-01",
  feePeriodEnd: "2026-08-31",
  notes: "August invoice",
};

describe("Add Invoice request contract", () => {
  it("accepts one student, one fee structure, and a complete period", () => {
    expect(addInvoiceBodySchema.safeParse(validPayload).success).toBe(true);
  });

  it("requires a positive student ID", () => {
    expect(addInvoiceBodySchema.safeParse({ ...validPayload, studentId: 0 }).success).toBe(false);
  });

  it("requires a positive fee structure ID", () => {
    expect(addInvoiceBodySchema.safeParse({ ...validPayload, feeStructureId: 0 }).success).toBe(false);
  });

  it("requires fee-period dates to be supplied together", () => {
    expect(addInvoiceBodySchema.safeParse({
      ...validPayload,
      feePeriodEnd: undefined,
    }).success).toBe(false);
    expect(addInvoiceBodySchema.safeParse({
      ...validPayload,
      feePeriodStart: undefined,
    }).success).toBe(false);
  });

  it("allows the period to be omitted so annual/one-time invoices use session dates", () => {
    expect(addInvoiceBodySchema.safeParse({
      studentId: 11,
      feeStructureId: 7,
      notes: null,
    }).success).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    expect(addInvoiceBodySchema.safeParse({
      ...validPayload,
      feePeriodStart: "2026-08-31",
      feePeriodEnd: "2026-08-01",
    }).success).toBe(false);
  });

  it("strips client attempts to override structure- and session-derived fields", () => {
    const result = addInvoiceBodySchema.safeParse({
      ...validPayload,
      feeType: "Tampered",
      amount: 1,
      dueDate: "2099-01-01",
      academicYear: "2099-00",
      status: "Paid",
      breakdownSnapshot: [],
      invoiceNumber: "INV-0000",
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected schema success");
    expect(result.data).toEqual(validPayload);
  });

  it("contains no payment or receipt fields", () => {
    const result = addInvoiceBodySchema.parse({
      ...validPayload,
      paidDate: "2026-08-01",
      receiptNumber: "RCPT-1",
      razorpayOrderId: "order_1",
    }) as any;
    expect(result.paidDate).toBeUndefined();
    expect(result.receiptNumber).toBeUndefined();
    expect(result.razorpayOrderId).toBeUndefined();
  });
});