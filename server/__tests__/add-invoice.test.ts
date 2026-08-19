import { describe, expect, it } from "vitest";
import { z } from "zod";

const breakdownItemSchema = z.object({
  name: z.string().min(1).max(100),
  purpose: z.string().max(300).default(""),
  amount: z.number().int().min(0),
});

const lateFeeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(["NONE", "FLAT", "DAILY", "TIERED"]).default("NONE"),
  grace_period_days: z.number().int().min(0).default(0),
  flat_amount: z.number().int().min(0).default(0),
  daily_rate: z.number().min(0).default(0),
  max_cap: z.number().int().min(0).default(0),
  tiered_slabs: z.array(z.object({
    from_day: z.number().int().min(1),
    to_day: z.number().int().min(1),
    amount: z.number().int().min(0),
  })).default([]),
});

// Mirrors POST /api/admin/fees. Payment, status, session, numbering, and receipt
// fields remain server-controlled; manual invoice details are explicit inputs.
const addInvoiceBodySchema = z.object({
  studentId: z.number().int().positive(),
  feeName: z.string().trim().min(1).max(100),
  feeType: z.string().trim().min(1).max(100),
  amount: z.number().int().positive(),
  frequency: z.enum(["monthly", "quarterly", "annual", "one-time"]),
  feePeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  feePeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  breakdown: z.array(breakdownItemSchema).default([]),
  lateFeeConfig: lateFeeConfigSchema.default({
    enabled: false,
    type: "NONE",
    grace_period_days: 0,
    flat_amount: 0,
    daily_rate: 0,
    max_cap: 0,
    tiered_slabs: [],
  }),
  notes: z.string().optional().nullable(),
}).superRefine((value, context) => {
  if (value.feePeriodEnd < value.feePeriodStart) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fee period end must be on or after start",
      path: ["feePeriodEnd"],
    });
  }
});

const validPayload = {
  studentId: 11,
  feeName: "August Tuition",
  feeType: "Tuition",
  amount: 3600,
  frequency: "monthly" as const,
  feePeriodStart: "2026-08-01",
  feePeriodEnd: "2026-08-31",
  dueDate: "2026-08-10",
  breakdown: [{ name: "Instruction", purpose: "August classes", amount: 3600 }],
  lateFeeConfig: {
    enabled: true,
    type: "DAILY" as const,
    grace_period_days: 3,
    flat_amount: 0,
    daily_rate: 25,
    max_cap: 300,
    tiered_slabs: [],
  },
  notes: "August invoice",
};

describe("Add Invoice manual request contract", () => {
  it("accepts one student with explicit manual invoice details", () => {
    expect(addInvoiceBodySchema.safeParse(validPayload).success).toBe(true);
  });

  it.each(["monthly", "quarterly", "annual", "one-time"] as const)(
    "accepts supported %s frequency",
    frequency => {
      expect(addInvoiceBodySchema.safeParse({ ...validPayload, frequency }).success).toBe(true);
    },
  );

  it("requires student, fee name/type, amount, frequency, period, and due date", () => {
    for (const payload of [
      { ...validPayload, studentId: 0 },
      { ...validPayload, feeName: " " },
      { ...validPayload, feeType: " " },
      { ...validPayload, amount: 0 },
      { ...validPayload, frequency: "weekly" },
      { ...validPayload, feePeriodStart: undefined },
      { ...validPayload, dueDate: undefined },
    ]) {
      expect(addInvoiceBodySchema.safeParse(payload).success).toBe(false);
    }
  });

  it("rejects an inverted period and malformed late-fee/component input", () => {
    expect(addInvoiceBodySchema.safeParse({
      ...validPayload,
      feePeriodStart: "2026-08-31",
      feePeriodEnd: "2026-08-01",
    }).success).toBe(false);
    expect(addInvoiceBodySchema.safeParse({
      ...validPayload,
      breakdown: [{ name: "", purpose: "", amount: 1 }],
    }).success).toBe(false);
    expect(addInvoiceBodySchema.safeParse({
      ...validPayload,
      lateFeeConfig: { ...validPayload.lateFeeConfig, type: "WEEKLY" },
    }).success).toBe(false);
  });

  it("strips payment, receipt, status, and invoice-number overrides", () => {
    const result = addInvoiceBodySchema.parse({
      ...validPayload,
      status: "Paid",
      paidDate: "2026-08-01",
      receiptNumber: "RCPT-1",
      invoiceNumber: "INV-0000",
      sessionId: 999,
      feeStructureId: 7,
    }) as any;
    expect(result.status).toBeUndefined();
    expect(result.paidDate).toBeUndefined();
    expect(result.receiptNumber).toBeUndefined();
    expect(result.invoiceNumber).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
    expect(result.feeStructureId).toBeUndefined();
  });
});