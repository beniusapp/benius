import { storage } from "./storage";
import { buildBreakdownSnapshot, warnOnSumMismatch, type BreakdownComponent } from "./invoice-snapshot";
import type { LateFeeConfig } from "@shared/schema";

type ActiveSession = NonNullable<Awaited<ReturnType<typeof storage.getActiveSession>>>;
type Structure = NonNullable<Awaited<ReturnType<typeof storage.getFeeStructureById>>>;
type ExistingFeeRecord = Awaited<ReturnType<typeof storage.getFeeRecordsBySchool>>[number];

export class InvoiceGenerationError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "InvoiceGenerationError";
  }
}

export interface StructureInvoiceContext {
  schoolId: number;
  structure: Structure;
  session: ActiveSession;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  breakdownSnapshot: BreakdownComponent[];
}

interface InvoiceCreationContext {
  schoolId: number;
  session: ActiveSession;
  feeName: string;
  feeType: string;
  amount: number;
  frequency: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  breakdownSnapshot: BreakdownComponent[];
  lateFeeConfig: LateFeeConfig | null;
}

export interface ManualInvoiceContext extends InvoiceCreationContext {}

export interface InvoiceDuplicateIndex {
  byPeriodStart: Map<string, ExistingFeeRecord>;
  legacyByType: Map<string, ExistingFeeRecord>;
}

function normalizedFeeType(feeType: string): string {
  return feeType.trim().toLowerCase();
}

function periodKey(studentId: number, feeType: string, periodStart: string): string {
  return `${studentId}:${normalizedFeeType(feeType)}:${periodStart.slice(0, 10)}`;
}

function legacyKey(studentId: number, feeType: string): string {
  return `${studentId}:${normalizedFeeType(feeType)}`;
}

export function assertRealIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvoiceGenerationError(`${label} must be a valid YYYY-MM-DD date.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new InvoiceGenerationError(`${label} must be a real calendar date.`);
  }
}

export function resolveInvoicePeriod(
  frequency: string,
  session: { startDate: string | Date; endDate: string | Date },
  requestedStart?: string | null,
  requestedEnd?: string | null,
): { periodStart: string; periodEnd: string } {
  const sessionStart = String(session.startDate).slice(0, 10);
  const sessionEnd = String(session.endDate).slice(0, 10);

  assertRealIsoDate(sessionStart, "Academic session start");
  assertRealIsoDate(sessionEnd, "Academic session end");
  if (!!requestedStart !== !!requestedEnd) {
    throw new InvoiceGenerationError("Fee period start and end must be provided together.");
  }

  if (frequency === "annual" || frequency === "one-time") {
    if (
      (requestedStart && requestedStart !== sessionStart)
      || (requestedEnd && requestedEnd !== sessionEnd)
    ) {
      throw new InvoiceGenerationError(
        "Annual and one-time invoices must use the full active academic session.",
      );
    }
    return { periodStart: sessionStart, periodEnd: sessionEnd };
  }

  if (!requestedStart || !requestedEnd) {
    throw new InvoiceGenerationError(
      "Select a fee period for monthly or quarterly invoices.",
    );
  }
  assertRealIsoDate(requestedStart, "Fee period start");
  assertRealIsoDate(requestedEnd, "Fee period end");
  if (requestedEnd < requestedStart) {
    throw new InvoiceGenerationError("Fee period end must be on or after start.");
  }
  if (requestedStart < sessionStart || requestedEnd > sessionEnd) {
    throw new InvoiceGenerationError("The selected fee period is outside the active academic session.");
  }

  const [startYear, startMonth, startDay] = requestedStart.split("-").map(Number);
  const [endYear, endMonth, endDay] = requestedEnd.split("-").map(Number);
  if (frequency === "monthly") {
    const lastDay = new Date(Date.UTC(startYear, startMonth, 0)).getUTCDate();
    if (
      startDay !== 1
      || endYear !== startYear
      || endMonth !== startMonth
      || endDay !== lastDay
    ) {
      throw new InvoiceGenerationError("Monthly invoices must use one complete calendar month.");
    }
  } else if (frequency === "quarterly") {
    const validStartMonth = [1, 4, 7, 10].includes(startMonth);
    const quarterEnd = new Date(Date.UTC(startYear, startMonth + 2, 0));
    if (
      !validStartMonth
      || startDay !== 1
      || endYear !== quarterEnd.getUTCFullYear()
      || endMonth !== quarterEnd.getUTCMonth() + 1
      || endDay !== quarterEnd.getUTCDate()
    ) {
      throw new InvoiceGenerationError("Quarterly invoices must use one complete calendar quarter.");
    }
  }
  return { periodStart: requestedStart, periodEnd: requestedEnd };
}

export function computeStructureInvoiceDueDate(
  dueDayOfMonth: number | null | undefined,
  periodStart: string,
  periodEnd: string,
): string {
  if (!dueDayOfMonth) return periodEnd;

  const refDate = new Date(`${periodStart}T00:00:00`);
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(dueDayOfMonth, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildInvoiceDuplicateIndex(records: ExistingFeeRecord[]): InvoiceDuplicateIndex {
  const byPeriodStart = new Map<string, ExistingFeeRecord>();
  const legacyByType = new Map<string, ExistingFeeRecord>();

  for (const record of records) {
    if (record.feePeriodStart) {
      byPeriodStart.set(
        periodKey(record.studentId, record.feeType, String(record.feePeriodStart)),
        record,
      );
    } else {
      legacyByType.set(legacyKey(record.studentId, record.feeType), record);
    }
  }
  return { byPeriodStart, legacyByType };
}

export function findDuplicateInvoice(
  index: InvoiceDuplicateIndex,
  studentId: number,
  feeType: string,
  periodStart: string,
): ExistingFeeRecord | undefined {
  return index.byPeriodStart.get(periodKey(studentId, feeType, periodStart))
    ?? index.legacyByType.get(legacyKey(studentId, feeType));
}

export function isStudentEligibleForStructure(
  structure: Pick<Structure, "applicableClasses">,
  student: { class: string | null; section: string | null; isActive?: boolean | null },
): boolean {
  if (student.isActive === false || !student.class || !student.section) return false;
  const applicableClasses = structure.applicableClasses ?? [];
  return applicableClasses.length === 0 || applicableClasses.includes(student.class);
}

export async function prepareStructureInvoiceContext(input: {
  schoolId: number;
  structureId: number;
  requestedPeriodStart?: string | null;
  requestedPeriodEnd?: string | null;
}): Promise<StructureInvoiceContext> {
  const structure = await storage.getFeeStructureById(input.structureId, input.schoolId);
  if (!structure) throw new InvoiceGenerationError("Fee structure not found.", 404);

  const session = await storage.getActiveSession(input.schoolId);
  if (!session) {
    throw new InvoiceGenerationError("No active academic session found. Please activate a session first.");
  }

  const { periodStart, periodEnd } = resolveInvoicePeriod(
    structure.frequency,
    session,
    input.requestedPeriodStart,
    input.requestedPeriodEnd,
  );
  const dueDate = computeStructureInvoiceDueDate(
    structure.dueDayOfMonth,
    periodStart,
    periodEnd,
  );

  let breakdownSnapshot: BreakdownComponent[];
  try {
    breakdownSnapshot = buildBreakdownSnapshot(structure.breakdown);
    warnOnSumMismatch(breakdownSnapshot, structure.amount, `structure "${structure.name}"`);
  } catch (error: any) {
    throw new InvoiceGenerationError(`Invalid fee component breakdown: ${error.message}`);
  }

  return {
    schoolId: input.schoolId,
    structure,
    session,
    periodStart,
    periodEnd,
    dueDate,
    breakdownSnapshot,
  };
}

export async function prepareManualInvoiceContext(input: {
  schoolId: number;
  feeName: string;
  feeType: string;
  amount: number;
  frequency: string;
  requestedPeriodStart: string;
  requestedPeriodEnd: string;
  dueDate: string;
  breakdown: unknown;
  lateFeeConfig: LateFeeConfig | null;
}): Promise<ManualInvoiceContext> {
  const session = await storage.getActiveSession(input.schoolId);
  if (!session) {
    throw new InvoiceGenerationError("No active academic session found. Please activate a session first.");
  }

  const { periodStart, periodEnd } = resolveInvoicePeriod(
    input.frequency,
    session,
    input.requestedPeriodStart,
    input.requestedPeriodEnd,
  );
  assertRealIsoDate(input.dueDate, "Due date");
  if (input.dueDate < periodStart || input.dueDate > periodEnd) {
    throw new InvoiceGenerationError("Due date must fall within the selected fee period.");
  }

  let breakdownSnapshot: BreakdownComponent[];
  try {
    breakdownSnapshot = buildBreakdownSnapshot(input.breakdown);
  } catch (error: any) {
    throw new InvoiceGenerationError(`Invalid fee component breakdown: ${error.message}`);
  }
  const componentTotal = breakdownSnapshot.reduce((sum, component) => sum + component.amount, 0);
  if (breakdownSnapshot.length > 0 && componentTotal !== input.amount) {
    throw new InvoiceGenerationError(
      `Component total (₹${componentTotal}) must match the invoice amount (₹${input.amount}).`,
    );
  }

  return {
    schoolId: input.schoolId,
    session,
    feeName: input.feeName.trim(),
    feeType: input.feeType.trim(),
    amount: input.amount,
    frequency: input.frequency,
    periodStart,
    periodEnd,
    dueDate: input.dueDate,
    breakdownSnapshot,
    lateFeeConfig: input.lateFeeConfig,
  };
}

async function createInvoiceFromContext(input: {
  context: InvoiceCreationContext;
  studentId: number;
  notes?: string | null;
  createdBy?: number | null;
  duplicateIndex?: InvoiceDuplicateIndex;
}): Promise<
  | { created: false; duplicate: ExistingFeeRecord }
  | { created: true; record: ExistingFeeRecord }
> {
  const existingRecords = input.duplicateIndex
    ? null
    : await storage.getFeeRecordsBySchool(input.context.schoolId, {
        sessionId: input.context.session.id,
      });
  const duplicateIndex = input.duplicateIndex ?? buildInvoiceDuplicateIndex(existingRecords ?? []);
  const duplicate = findDuplicateInvoice(
    duplicateIndex,
    input.studentId,
    input.context.feeType,
    input.context.periodStart,
  );
  if (duplicate) return { created: false, duplicate };

  const atomicResult = await storage.createInvoiceFeeRecordIfAbsent({
    data: {
      schoolId: input.context.schoolId,
      studentId: input.studentId,
      sessionId: input.context.session.id,
      feeName: input.context.feeName,
      feeType: input.context.feeType,
      amount: input.context.amount,
      dueDate: input.context.dueDate,
      status: "Due",
      academicYear: input.context.session.sessionName ?? null,
      notes: input.notes ?? null,
      feePeriodStart: input.context.periodStart,
      feePeriodEnd: input.context.periodEnd,
      breakdownSnapshot: input.context.breakdownSnapshot,
      frequency: input.context.frequency,
      lateFeeConfig: input.context.lateFeeConfig,
      createdBy: input.createdBy ?? null,
    },
    periodStart: input.context.periodStart,
  });
  if (!atomicResult.created) {
    return { created: false, duplicate: atomicResult.record };
  }
  const record = atomicResult.record;

  duplicateIndex.byPeriodStart.set(
    periodKey(input.studentId, input.context.feeType, input.context.periodStart),
    record,
  );
  return { created: true, record };
}

export async function createStructureInvoice(input: {
  context: StructureInvoiceContext;
  studentId: number;
  notes?: string | null;
  createdBy?: number | null;
  duplicateIndex?: InvoiceDuplicateIndex;
}): Promise<
  | { created: false; duplicate: ExistingFeeRecord }
  | { created: true; record: ExistingFeeRecord }
> {
  return createInvoiceFromContext({
    ...input,
    context: {
      schoolId: input.context.schoolId,
      session: input.context.session,
      feeName: input.context.structure.name,
      feeType: input.context.structure.feeType,
      amount: input.context.structure.amount,
      frequency: input.context.structure.frequency,
      periodStart: input.context.periodStart,
      periodEnd: input.context.periodEnd,
      dueDate: input.context.dueDate,
      breakdownSnapshot: input.context.breakdownSnapshot,
      lateFeeConfig: (input.context.structure.lateFeeConfig as LateFeeConfig | null) ?? null,
    },
  });
}

export async function createManualInvoice(input: {
  context: ManualInvoiceContext;
  studentId: number;
  notes?: string | null;
  createdBy?: number | null;
  duplicateIndex?: InvoiceDuplicateIndex;
}): Promise<
  | { created: false; duplicate: ExistingFeeRecord }
  | { created: true; record: ExistingFeeRecord }
> {
  return createInvoiceFromContext(input);
}