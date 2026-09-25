import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  academicSessions, feeAuditLog, feeRecords, feeStructures, paymentRecords, students,
} from "@workspace/db";
import { db } from "./db";
import { storage } from "./storage";
import { calculateLateFee, DEFAULT_LATE_FEE_CONFIG } from "./late-fee-engine";

type Principal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: string;
  schoolId: number;
  name?: string;
  allowedModules?: string[];
};
type MobileRequest = Request & {
  mobileAuth?: { principal: Principal };
  mobileAcademicSession?: typeof academicSessions.$inferSelect;
};

const conditions = ["New", "Good", "Fair", "Poor", "Broken"] as const;
const assetCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  assetCode: z.string().max(50).optional(),
  category: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(0),
  condition: z.enum(conditions),
  location: z.string().trim().min(1).max(500),
  purchasedDate: z.string().date().nullable().optional(),
  warrantyExpiry: z.string().date().nullable().optional(),
});
const assetUpdateSchema = z.object({
  quantity: z.number().int().min(0).optional(),
  condition: z.enum(conditions).optional(),
  location: z.string().trim().min(1).max(500).optional(),
  purchasedDate: z.string().date().nullable().optional(),
  warrantyExpiry: z.string().date().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one asset field is required.");
const invoiceSchema = z.object({
  studentId: z.number().int().positive(),
  feeName: z.string().trim().min(1).max(100),
  feeType: z.string().trim().min(1).max(100),
  amount: z.number().int().positive(),
  dueDate: z.string().date(),
  notes: z.string().max(500).nullable().optional(),
});
const structureSchema = z.object({
  name: z.string().trim().min(1).max(100),
  feeType: z.string().trim().min(1).max(100),
  amount: z.number().int().positive(),
  frequency: z.enum(["monthly", "quarterly", "annual", "one-time"]).default("annual"),
  applicableClasses: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
  dueDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  breakdown: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    purpose: z.string().trim().max(200).default(""),
    amount: z.number().int().min(0),
  })).max(50).default([]),
});
const paymentSchema = z.object({
  feeRecordId: z.number().int().positive(),
  studentId: z.number().int().positive(),
  paymentMethod: z.enum(["Cash", "Cheque", "BankTransfer", "DemandDraft", "UpiQr"]),
  amount: z.number().int().positive(),
  receivedDate: z.string().date(),
  referenceNumber: z.string().max(100).nullable().optional(),
  cashierNotes: z.string().max(500).nullable().optional(),
  idempotencyKey: z.string().min(1).max(64),
  denominationBreakdown: z.record(z.string(), z.number().int().min(0)).nullable().optional(),
  chequeDate: z.string().date().nullable().optional(),
  branchName: z.string().max(100).nullable().optional(),
  bankName: z.string().max(100).nullable().optional(),
  payerName: z.string().max(200).nullable().optional(),
  payerUpiId: z.string().max(100).nullable().optional(),
});

function reject(res: Response, status: number, message: string) {
  res.status(status).json({ message });
}

function principal(req: Request): Principal | null {
  const value = (req as MobileRequest).mobileAuth?.principal;
  if (!value || (value.role !== "admin" && value.role !== "support_staff")
    || !Number.isSafeInteger(value.principalId) || value.principalId <= 0
    || !Number.isSafeInteger(value.schoolId) || value.schoolId <= 0) return null;
  return value;
}

function hasPermission(user: Principal, moduleId: string, action: string): boolean {
  return user.role === "admin" || (
    (user.allowedModules ?? []).includes(moduleId)
    && (user.allowedModules ?? []).includes(`${moduleId}:${action}`)
  );
}

function requirePermission(moduleId: string, action: string): RequestHandler {
  return (req, res, next) => {
    const user = principal(req);
    if (!user) return reject(res, 403, "Administrator or permitted support staff access is required.");
    if (!hasPermission(user, moduleId, action)) return reject(res, 403, "You do not have permission for this module action.");
    next();
  };
}

function selectedSession(req: Request, schoolId: number) {
  const session = (req as MobileRequest).mobileAcademicSession;
  return session && session.schoolId === schoolId ? session : null;
}

function archivedWriteBlocked(session: typeof academicSessions.$inferSelect, res: Response): boolean {
  if (session.isActive) return false;
  reject(res, 403, "Archived academic sessions are read-only.");
  return true;
}

function parseId(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function allowedSubs(user: Principal, moduleId: string, actions: string[]): string[] {
  return actions.filter((action) => hasPermission(user, moduleId, action));
}

function feeAuditEntry(input: {
  schoolId: number; actor: Principal; sessionId: number; action: string; entityType: string;
  entityId: number; studentId?: number | null; studentName?: string | null;
  recordLabel?: string | null; amount?: number | null; description: string;
}, executor: any = db) {
  const adminActor = input.actor.role === "admin";
  return executor.insert(feeAuditLog).values({
    schoolId: input.schoolId,
    actorId: adminActor ? input.actor.principalId : null,
    actorStaffId: adminActor ? null : input.actor.entityId,
    actorType: adminActor ? "admin" : "support_staff",
    actorName: input.actor.name ?? null,
    actorRole: adminActor ? "Admin" : "Support Staff",
    actorIdentifier: adminActor ? `user:${input.actor.principalId}` : `staff:${input.actor.entityId}`,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    studentId: input.studentId ?? null,
    studentName: input.studentName ?? null,
    sessionId: input.sessionId,
    recordLabel: input.recordLabel ?? null,
    amount: input.amount ?? null,
    currency: "INR",
    description: input.description,
  });
}

export function registerMobileAdminFinanceRoutes(
  app: Express,
  requireHttps: RequestHandler,
  requireBearer: RequestHandler,
  requireAcademicSession: RequestHandler,
): void {
  const protect = [requireHttps, requireBearer] as const;

  // Physical asset records are permanent school-wide data, not session-bound.
  app.get("/api/mobile/admin/modules/assets", ...protect, requirePermission("assets", "view"), async (req, res) => {
    const user = principal(req)!;
    try {
      const assets = await storage.getAssets(user.schoolId);
      res.json({ assets, allowedSubs: allowedSubs(user, "assets", ["add", "edit", "delete"]) });
    } catch {
      reject(res, 503, "Unable to load the school's asset inventory.");
    }
  });

  app.post("/api/mobile/admin/modules/assets/create", ...protect, requirePermission("assets", "add"), async (req, res) => {
    const user = principal(req)!;
    const parsed = assetCreateSchema.safeParse(req.body);
    if (!parsed.success) return reject(res, 400, parsed.error.issues[0]?.message ?? "Asset details are invalid.");
    try {
      const asset = await storage.createAsset({ ...parsed.data, schoolId: user.schoolId });
      res.status(201).json(asset);
    } catch {
      reject(res, 503, "Unable to add the asset.");
    }
  });

  app.post("/api/mobile/admin/modules/assets/update", ...protect, requirePermission("assets", "edit"), async (req, res) => {
    const user = principal(req)!;
    const id = parseId(req.body?.id);
    const parsed = assetUpdateSchema.safeParse(req.body?.changes);
    if (!id) return reject(res, 400, "A valid asset ID is required.");
    if (!parsed.success) return reject(res, 400, parsed.error.issues[0]?.message ?? "Asset changes are invalid.");
    try {
      const before = await storage.getAssetById(id, user.schoolId);
      if (!before) return reject(res, 404, "Asset not found.");
      const updated = await storage.updateAsset(id, user.schoolId, parsed.data);
      if (!updated) return reject(res, 404, "Asset not found.");
      await storage.logAssetActivity({
        schoolId: user.schoolId, assetId: id, userId: user.principalId, action: "edit",
        snapshot: JSON.stringify({ before, after: updated }),
      }).catch(() => undefined);
      res.json(updated);
    } catch {
      reject(res, 503, "Unable to update the asset.");
    }
  });

  app.post("/api/mobile/admin/modules/assets/delete", ...protect, requirePermission("assets", "delete"), async (req, res) => {
    const user = principal(req)!;
    const id = parseId(req.body?.id);
    if (!id) return reject(res, 400, "A valid asset ID is required.");
    try {
      const before = await storage.getAssetById(id, user.schoolId);
      if (!before) return reject(res, 404, "Asset not found.");
      const deleted = await storage.deleteAsset(id, user.schoolId);
      if (!deleted) return reject(res, 404, "Asset not found.");
      await storage.logAssetActivity({
        schoolId: user.schoolId, assetId: id, userId: user.principalId, action: "delete",
        snapshot: JSON.stringify({ before }),
      }).catch(() => undefined);
      res.json({ message: "Asset deleted." });
    } catch {
      reject(res, 503, "Unable to delete the asset.");
    }
  });

  app.get(
    "/api/mobile/admin/modules/fees",
    ...protect,
    requirePermission("fees-manager", "view"),
    requireAcademicSession,
    async (req, res) => {
      const user = principal(req)!;
      const session = selectedSession(req, user.schoolId);
      if (!session) return reject(res, 409, "Select an academic session to view fee records.");
      try {
        const [records, payments, structures, summary, audit, studentRows] = await Promise.all([
          storage.getFeeRecordsBySchool(user.schoolId, { sessionId: session.id }),
          storage.getPaymentRecordsBySchool(user.schoolId, { sessionId: session.id }),
          storage.getFeeStructuresBySchool(user.schoolId),
          storage.getFeeSummary(user.schoolId, session.id),
          storage.getFeeAuditLog(user.schoolId, 50, 0, undefined, undefined, undefined, undefined, session.id),
          db.select({ id: students.id, name: students.name, class: students.class, section: students.section, digitalStudentId: students.digitalStudentId })
            .from(students).where(eq(students.schoolId, user.schoolId)).orderBy(students.name),
        ]);
        res.json({
          session: { id: session.id, name: session.sessionName, isActive: session.isActive },
          records, payments, structures, summary, audit: audit.entries, students: studentRows,
          allowedSubs: allowedSubs(user, "fees-manager", ["record", "export"]),
        });
      } catch {
        reject(res, 503, "Unable to load fees and payment records.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/fees/invoices",
    ...protect,
    requirePermission("fees-manager", "record"),
    requireAcademicSession,
    async (req, res) => {
      const user = principal(req)!;
      const session = selectedSession(req, user.schoolId);
      if (!session) return reject(res, 409, "Select an academic session before creating an invoice.");
      if (archivedWriteBlocked(session, res)) return;
      const parsed = invoiceSchema.safeParse(req.body);
      if (!parsed.success) return reject(res, 400, parsed.error.issues[0]?.message ?? "Invoice details are invalid.");
      const [student] = await db.select({ id: students.id, name: students.name, isActive: students.isActive })
        .from(students).where(and(eq(students.id, parsed.data.studentId), eq(students.schoolId, user.schoolId)));
      if (!student || !student.isActive) return reject(res, 400, "Choose an active student from this school.");
      try {
        const periodStart = `${parsed.data.dueDate.slice(0, 7)}-01`;
        const end = new Date(`${periodStart}T00:00:00.000Z`);
        end.setUTCMonth(end.getUTCMonth() + 1);
        end.setUTCDate(0);
        const periodEnd = end.toISOString().slice(0, 10);
        const created = await storage.createInvoiceFeeRecordIfAbsent({
          periodStart,
          data: {
            schoolId: user.schoolId, sessionId: session.id, studentId: student.id,
            feeName: parsed.data.feeName, feeType: parsed.data.feeType, amount: parsed.data.amount,
            dueDate: parsed.data.dueDate, status: "Due", paidDate: null, receiptNumber: null,
            notes: parsed.data.notes?.trim() || null, feePeriodStart: periodStart, feePeriodEnd: periodEnd,
            frequency: "one-time", breakdownSnapshot: [], createdBy: user.role === "admin" ? user.principalId : null,
          },
          afterCreate: async (tx, record) => {
            await feeAuditEntry({
              schoolId: user.schoolId, actor: user, sessionId: session.id, action: "create",
              entityType: "fee_record", entityId: record.id, studentId: student.id, studentName: student.name,
              recordLabel: record.invoiceNumber, amount: record.amount,
              description: `Created invoice ${record.invoiceNumber ?? ""} for ${student.name}: ${parsed.data.feeName}, ₹${parsed.data.amount}, due ${parsed.data.dueDate}.`,
            }, tx);
          },
        });
        if (!created.created) return reject(res, 409, "An invoice of this fee type already exists for this student in that fee period.");
        res.status(201).json(created.record);
      } catch {
        reject(res, 503, "Unable to create the invoice.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/fees/payments",
    ...protect,
    requirePermission("fees-manager", "record"),
    requireAcademicSession,
    async (req, res) => {
      const user = principal(req)!;
      const session = selectedSession(req, user.schoolId);
      if (!session) return reject(res, 409, "Select an academic session before recording a payment.");
      if (archivedWriteBlocked(session, res)) return;
      const parsed = paymentSchema.safeParse(req.body);
      if (!parsed.success) return reject(res, 400, parsed.error.issues[0]?.message ?? "Payment details are invalid.");
      const payment = parsed.data;
      if (payment.paymentMethod === "UpiQr" && !payment.referenceNumber?.trim())
        return reject(res, 400, "UPI Transaction ID / UTR is required.");
      if (payment.paymentMethod === "Cash") {
        const denominationValues = [500, 200, 100, 50, 20, 10, 5, 2, 1];
        const total = denominationValues.reduce((sum, value) => sum + value * (payment.denominationBreakdown?.[String(value)] ?? 0), 0);
        if (!payment.denominationBreakdown || total !== payment.amount)
          return reject(res, 400, "Cash denomination total must equal the payment amount.");
      }
      const existing = await storage.getPaymentRecordByIdempotencyKey(payment.idempotencyKey, user.schoolId);
      if (existing) return res.json({ ...existing, idempotent: true });
      const [student] = await db.select({ id: students.id, name: students.name })
        .from(students).where(and(eq(students.id, payment.studentId), eq(students.schoolId, user.schoolId)));
      if (!student) return reject(res, 400, "Student does not belong to this school.");
      const [invoice] = await db.select().from(feeRecords).where(and(
        eq(feeRecords.id, payment.feeRecordId), eq(feeRecords.schoolId, user.schoolId),
        eq(feeRecords.studentId, payment.studentId), eq(feeRecords.sessionId, session.id),
      ));
      if (!invoice) return reject(res, 404, "Invoice not found for this student in the selected academic session.");
      if (invoice.status === "Paid") return reject(res, 409, "This invoice has already been paid in full.");
      try {
        const [structure] = await db.select({ lateFeeConfig: feeStructures.lateFeeConfig }).from(feeStructures)
          .where(and(eq(feeStructures.schoolId, user.schoolId), eq(feeStructures.feeType, invoice.feeType))).limit(1);
        const lateFeeConfig = invoice.lateFeeConfig ?? structure?.lateFeeConfig ?? DEFAULT_LATE_FEE_CONFIG;
        const lateFee = calculateLateFee(lateFeeConfig, invoice.dueDate ?? "", invoice.status);
        const expectedAmount = Number(invoice.amount) + lateFee;
        if (payment.amount !== expectedAmount) {
          return reject(res, 400, `Payment must equal the full invoice balance of ₹${expectedAmount.toLocaleString("en-IN")}.`);
        }
        const receiptNumber = await storage.nextReceiptNumber(user.schoolId, "OF");
        const result = await db.transaction(async (tx) => {
          const locked = await tx.execute(sql`
            SELECT status, amount, due_date, late_fee_config FROM fee_records
            WHERE id = ${invoice.id} AND school_id = ${user.schoolId} AND session_id = ${session.id}
            FOR UPDATE
          `);
          const current = locked.rows[0] as { status: string; amount: number; due_date: string; late_fee_config: typeof invoice.lateFeeConfig | null } | undefined;
          if (!current || current.status === "Paid") throw new Error("PAID");
          const currentLateFee = calculateLateFee(current.late_fee_config ?? lateFeeConfig, current.due_date ?? "", current.status);
          const currentTotal = Number(current.amount) + currentLateFee;
          if (payment.amount !== currentTotal) throw new Error("BALANCE_CHANGED");
          const [saved] = await tx.insert(paymentRecords).values({
            schoolId: user.schoolId, sessionId: session.id, feeRecordId: invoice.id,
            studentId: payment.studentId, paymentMethod: payment.paymentMethod,
            referenceNumber: payment.referenceNumber?.trim() || null, receivedDate: payment.receivedDate,
            amount: payment.amount, cashierNotes: payment.cashierNotes?.trim() || null,
            idempotencyKey: payment.idempotencyKey, recordedBy: user.role === "admin" ? user.principalId : null,
            receiptNumber, lateFeePaid: currentLateFee,
            denominationBreakdown: payment.denominationBreakdown ?? null,
            chequeDate: payment.chequeDate ?? null, branchName: payment.branchName ?? null,
            bankName: payment.bankName ?? null, payerName: payment.payerName ?? null,
            vpa: payment.payerUpiId ?? null,
          }).returning();
          await tx.update(feeRecords).set({
            status: "Paid", paidDate: payment.receivedDate, receiptNumber,
          }).where(and(eq(feeRecords.id, invoice.id), eq(feeRecords.schoolId, user.schoolId)));
          await feeAuditEntry({
            schoolId: user.schoolId, actor: user, sessionId: session.id, action: "payment",
            entityType: "payment_record", entityId: saved.id, studentId: student.id, studentName: student.name,
            recordLabel: receiptNumber, amount: payment.amount,
            description: `Recorded ₹${payment.amount.toLocaleString("en-IN")} by ${payment.paymentMethod} for ${student.name}; receipt ${receiptNumber}.`,
          }, tx);
          return saved;
        });
        res.status(201).json(result);
      } catch (error) {
        if (error instanceof Error && error.message === "PAID") return reject(res, 409, "This invoice has already been paid in full.");
        if (error instanceof Error && error.message === "BALANCE_CHANGED") return reject(res, 409, "The invoice balance changed. Refresh and try again.");
        reject(res, 503, "Payment was not recorded. Refresh the invoice and try again.");
      }
    },
  );

  app.post(
    "/api/mobile/admin/modules/fees/structures",
    ...protect,
    requirePermission("fees-manager", "record"),
    requireAcademicSession,
    async (req, res) => {
      const user = principal(req)!;
      const session = selectedSession(req, user.schoolId);
      if (!session) return reject(res, 409, "Select an academic session before managing fee structures.");
      if (archivedWriteBlocked(session, res)) return;
      const action = req.body?.action;
      const id = parseId(req.body?.id);
      try {
        if (action === "delete") {
          if (!id) return reject(res, 400, "A valid fee structure ID is required.");
          const deleted = await storage.deleteFeeStructure(id, user.schoolId);
          return deleted ? res.json({ message: "Fee structure deleted." }) : reject(res, 404, "Fee structure not found.");
        }
        const parsed = structureSchema.safeParse(req.body?.structure);
        if (!parsed.success) return reject(res, 400, parsed.error.issues[0]?.message ?? "Fee structure details are invalid.");
        const total = parsed.data.breakdown.reduce((sum, item) => sum + item.amount, 0);
        if (parsed.data.breakdown.length && total !== parsed.data.amount)
          return reject(res, 400, "Fee component totals must equal the structure amount.");
        const values = {
          schoolId: user.schoolId, createdBy: user.role === "admin" ? user.principalId : null, ...parsed.data,
          applicableClasses: [...new Set(parsed.data.applicableClasses)],
          dueDayOfMonth: parsed.data.dueDayOfMonth ?? null,
          lateFeeConfig: DEFAULT_LATE_FEE_CONFIG,
        };
        if (action === "update") {
          if (!id) return reject(res, 400, "A valid fee structure ID is required.");
          const { schoolId: _schoolId, createdBy: _createdBy, lateFeeConfig: _lateFeeConfig, ...changes } = values;
          const updated = await storage.updateFeeStructure(id, user.schoolId, changes);
          return updated ? res.json(updated) : reject(res, 404, "Fee structure not found.");
        }
        if (action !== "create") return reject(res, 400, "Choose a valid fee structure action.");
        res.status(201).json(await storage.createFeeStructure(values));
      } catch {
        reject(res, 503, "Unable to save the fee structure.");
      }
    },
  );
}