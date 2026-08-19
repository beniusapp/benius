import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  getFeeStructureById: vi.fn(),
  getFeeRecordsBySchool: vi.fn(),
  createStructureFeeRecordIfAbsent: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));

import {
  InvoiceGenerationError,
  buildInvoiceDuplicateIndex,
  computeStructureInvoiceDueDate,
  createStructureInvoice,
  findDuplicateInvoice,
  isStudentEligibleForStructure,
  prepareStructureInvoiceContext,
  resolveInvoicePeriod,
} from "../structure-invoice-service";

const session = {
  id: 9,
  schoolId: 3,
  sessionName: "2026-27",
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  isActive: true,
};

const structure = {
  id: 7,
  schoolId: 3,
  name: "Annual Tuition",
  feeType: "Tuition",
  amount: 36000,
  frequency: "monthly",
  applicableClasses: ["10"],
  dueDayOfMonth: 10,
  breakdown: [
    { name: "Tuition", purpose: "Core instruction", amount: 33000 },
    { name: "Library", purpose: "Library access", amount: 3000 },
  ],
};

const existingRecord = {
  id: 21,
  schoolId: 3,
  sessionId: 9,
  studentId: 11,
  feeType: "Tuition",
  amount: 36000,
  dueDate: "2026-08-10",
  status: "Due",
  feePeriodStart: "2026-08-01",
  feePeriodEnd: "2026-08-31",
  invoiceNumber: "INV-0001",
};

describe("shared structure invoice service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getFeeStructureById.mockResolvedValue(structure);
    storageMock.getActiveSession.mockResolvedValue(session);
    storageMock.getFeeRecordsBySchool.mockResolvedValue([]);
    storageMock.createStructureFeeRecordIfAbsent.mockImplementation(async ({ data }) => ({
      created: true,
      record: { id: 42, invoiceNumber: "INV-0042", ...data },
    }));
  });

  it("resolves and validates a selected period inside the active session", () => {
    expect(resolveInvoicePeriod("monthly", session, "2026-08-01", "2026-08-31")).toEqual({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });
    expect(() => resolveInvoicePeriod("monthly", session, "2026-03-01", "2026-03-31"))
      .toThrow(InvoiceGenerationError);
  });

  it("uses active-session dates when no explicit period is supplied", () => {
    expect(resolveInvoicePeriod("annual", session)).toEqual({
      periodStart: "2026-04-01",
      periodEnd: "2027-03-31",
    });
  });

  it("rejects impossible dates and non-canonical monthly or quarterly ranges", () => {
    expect(() => resolveInvoicePeriod("monthly", session, "2026-04-31", "2026-05-31"))
      .toThrow(/real calendar date/i);
    expect(() => resolveInvoicePeriod("monthly", session, "2026-08-02", "2026-08-31"))
      .toThrow(/complete calendar month/i);
    expect(() => resolveInvoicePeriod("quarterly", session, "2026-05-01", "2026-07-31"))
      .toThrow(/complete calendar quarter/i);
    expect(() => resolveInvoicePeriod("monthly", session))
      .toThrow(/select a fee period/i);
  });

  it("does not allow annual or one-time periods to override the active session", () => {
    expect(() => resolveInvoicePeriod("annual", session, "2026-08-01", "2026-08-31"))
      .toThrow(/full active academic session/i);
    expect(resolveInvoicePeriod("one-time", session, session.startDate, session.endDate)).toEqual({
      periodStart: session.startDate,
      periodEnd: session.endDate,
    });
  });

  it("derives the due date from the structure due day and clamps short months", () => {
    expect(computeStructureInvoiceDueDate(10, "2026-08-01", "2026-08-31")).toBe("2026-08-10");
    expect(computeStructureInvoiceDueDate(31, "2026-02-01", "2026-02-28")).toBe("2026-02-28");
    expect(computeStructureInvoiceDueDate(null, "2026-08-01", "2026-08-31")).toBe("2026-08-31");
  });

  it("enforces applicable class, active status, class, and section", () => {
    expect(isStudentEligibleForStructure(structure as any, {
      class: "10",
      section: "A",
      isActive: true,
    })).toBe(true);
    expect(isStudentEligibleForStructure(structure as any, {
      class: "9",
      section: "A",
      isActive: true,
    })).toBe(false);
    expect(isStudentEligibleForStructure(structure as any, {
      class: "10",
      section: "A",
      isActive: false,
    })).toBe(false);
  });

  it("prepares canonical period, due date, and immutable breakdown snapshot", async () => {
    const context = await prepareStructureInvoiceContext({
      schoolId: 3,
      structureId: 7,
      requestedPeriodStart: "2026-08-01",
      requestedPeriodEnd: "2026-08-31",
    });

    expect(context.structure).toBe(structure);
    expect(context.session).toBe(session);
    expect(context.periodStart).toBe("2026-08-01");
    expect(context.periodEnd).toBe("2026-08-31");
    expect(context.dueDate).toBe("2026-08-10");
    expect(context.breakdownSnapshot).toEqual(structure.breakdown);
    expect(context.breakdownSnapshot).not.toBe(structure.breakdown);
  });

  it("creates a Due invoice entirely from structure and active-session values", async () => {
    const context = await prepareStructureInvoiceContext({
      schoolId: 3,
      structureId: 7,
      requestedPeriodStart: "2026-08-01",
      requestedPeriodEnd: "2026-08-31",
    });
    const result = await createStructureInvoice({
      context,
      studentId: 11,
      notes: "August invoice",
      createdBy: 99,
    });

    expect(result.created).toBe(true);
    expect(storageMock.createStructureFeeRecordIfAbsent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schoolId: 3,
        studentId: 11,
        sessionId: 9,
        feeType: "Tuition",
        amount: 36000,
        dueDate: "2026-08-10",
        status: "Due",
        academicYear: "2026-27",
        feePeriodStart: "2026-08-01",
        feePeriodEnd: "2026-08-31",
        breakdownSnapshot: structure.breakdown,
        notes: "August invoice",
        createdBy: 99,
      }),
      periodStart: "2026-08-01",
    });
  });

  it("uses the same case-insensitive duplicate identity for single and bulk callers", () => {
    const index = buildInvoiceDuplicateIndex([existingRecord] as any);
    expect(findDuplicateInvoice(index, 11, " tuition ", "2026-08-01")).toBe(existingRecord);
    expect(findDuplicateInvoice(index, 11, "Tuition", "2026-09-01")).toBeUndefined();
    expect(findDuplicateInvoice(index, 11, "Transport", "2026-08-01")).toBeUndefined();
  });

  it("skips duplicate creation without consuming an invoice number", async () => {
    const context = await prepareStructureInvoiceContext({
      schoolId: 3,
      structureId: 7,
      requestedPeriodStart: "2026-08-01",
      requestedPeriodEnd: "2026-08-31",
    });
    const result = await createStructureInvoice({
      context,
      studentId: 11,
      duplicateIndex: buildInvoiceDuplicateIndex([existingRecord] as any),
    });

    expect(result).toEqual({ created: false, duplicate: existingRecord });
    expect(storageMock.createStructureFeeRecordIfAbsent).not.toHaveBeenCalled();
  });

  it("treats a legacy invoice with no stored period as a duplicate", () => {
    const legacy = { ...existingRecord, feePeriodStart: null, feePeriodEnd: null };
    const index = buildInvoiceDuplicateIndex([legacy] as any);
    expect(findDuplicateInvoice(index, 11, "Tuition", "2026-09-01")).toBe(legacy);
  });

  it("fails clearly when the structure or active session is unavailable", async () => {
    storageMock.getFeeStructureById.mockResolvedValueOnce(null);
    await expect(prepareStructureInvoiceContext({ schoolId: 3, structureId: 999 }))
      .rejects.toMatchObject({ statusCode: 404 });

    storageMock.getActiveSession.mockResolvedValueOnce(null);
    await expect(prepareStructureInvoiceContext({ schoolId: 3, structureId: 7 }))
      .rejects.toThrow(/active academic session/i);
  });
});