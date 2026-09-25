import { z } from "zod";

export const manualInvoiceBreakdownItemSchema = z.object({
  name: z.string().min(1).max(100),
  purpose: z.string().max(300).default(""),
  amount: z.number().int().min(0),
});

export const manualInvoiceLateFeeConfigSchema = z.object({
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

/**
 * The production contract for POST /api/admin/fees.
 *
 * Billing details are intentionally manual, but lifecycle, session, payment,
 * receipt, and invoice-number fields are deliberately absent so the server
 * remains authoritative for those values.
 */
export const manualInvoiceBodySchema = z.object({
  studentId: z.number().int().positive(),
  feeName: z.string().trim().min(1).max(100),
  feeType: z.string().trim().min(1).max(100),
  amount: z.number().int().positive(),
  frequency: z.enum(["monthly", "quarterly", "annual", "one-time"]),
  // A logical selection only. The service resolves and persists the canonical
  // fee_period_start/fee_period_end values from the active academic session.
  feePeriod: z.string().trim().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  breakdown: z.array(manualInvoiceBreakdownItemSchema).default([]),
  lateFeeConfig: manualInvoiceLateFeeConfigSchema.default({
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
  const expectedPattern = value.frequency === "monthly"
    ? /^\d{4}-(0[1-9]|1[0-2])$/
    : value.frequency === "quarterly"
      ? /^\d{4}-Q[1-4]$/
      : /^active-session$/;
  if (!expectedPattern.test(value.feePeriod)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: value.frequency === "monthly"
        ? "Select a valid month for the fee period"
        : value.frequency === "quarterly"
          ? "Select a valid calendar quarter for the fee period"
          : "Annual and one-time invoices must use the active academic session",
      path: ["feePeriod"],
    });
  }
});

export type ManualInvoiceBody = z.infer<typeof manualInvoiceBodySchema>;

export type ManualInvoiceStudentCandidate = {
  schoolId: number;
  isActive: boolean | null;
};

/**
 * Returns the public-safe failure message for the one manual student selected
 * by an admin. Class and section are intentionally not considered because
 * manual invoices are not governed by Fee Structure applicability rules.
 */
export function manualInvoiceStudentValidationMessage(
  student: ManualInvoiceStudentCandidate | undefined,
  schoolId: number,
): string | null {
  if (!student || student.schoolId !== schoolId) {
    return "Student does not belong to this school";
  }
  if (student.isActive !== true) {
    return "Select an active student.";
  }
  return null;
}