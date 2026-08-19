import { describe, expect, it } from "vitest";
import {
  manualInvoiceBodySchema,
  manualInvoiceStudentValidationMessage,
} from "../manual-invoice-validation";

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

describe("Add Invoice production request contract", () => {
  it("accepts one student with explicit manual invoice details", () => {
    expect(manualInvoiceBodySchema.safeParse(validPayload).success).toBe(true);
  });

  it.each(["monthly", "quarterly", "annual", "one-time"] as const)(
    "accepts supported %s frequency",
    frequency => {
      expect(manualInvoiceBodySchema.safeParse({ ...validPayload, frequency }).success).toBe(true);
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
      expect(manualInvoiceBodySchema.safeParse(payload).success).toBe(false);
    }
  });

  it("rejects an inverted period and malformed late-fee/component input", () => {
    expect(manualInvoiceBodySchema.safeParse({
      ...validPayload,
      feePeriodStart: "2026-08-31",
      feePeriodEnd: "2026-08-01",
    }).success).toBe(false);
    expect(manualInvoiceBodySchema.safeParse({
      ...validPayload,
      breakdown: [{ name: "", purpose: "", amount: 1 }],
    }).success).toBe(false);
    expect(manualInvoiceBodySchema.safeParse({
      ...validPayload,
      lateFeeConfig: { ...validPayload.lateFeeConfig, type: "WEEKLY" },
    }).success).toBe(false);
  });

  it("strips payment, receipt, status, and invoice-number overrides", () => {
    const result = manualInvoiceBodySchema.parse({
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

describe("Add Invoice production student authorization", () => {
  it("allows only an active student in the authenticated school", () => {
    expect(manualInvoiceStudentValidationMessage({
      schoolId: 8,
      isActive: true,
    }, 8)).toBeNull();
  });

  it("rejects an invalid, cross-school, or inactive student without class applicability checks", () => {
    expect(manualInvoiceStudentValidationMessage(undefined, 8))
      .toBe("Student does not belong to this school");
    expect(manualInvoiceStudentValidationMessage({
      schoolId: 9,
      isActive: true,
    }, 8)).toBe("Student does not belong to this school");
    expect(manualInvoiceStudentValidationMessage({
      schoolId: 8,
      isActive: false,
    }, 8)).toBe("Select an active student.");
  });
});